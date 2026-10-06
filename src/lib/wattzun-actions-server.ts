import { POST as postTradeCrm } from "@/app/api/trade-crm/route";
import { POST as postTradeQuotes } from "@/app/api/trade-quotes/route";
import { authenticateWattzun, requireWattzunAccess, wattzunAccessFailure, type WattzunAccess } from "./wattzun-portal-access-server";
import { requireInstallerTeamAccess, canCreateJobs, canManageQuotes, type TeamAccess } from "./trade-team-server";
import { integrationEnvironment } from "./trade-integrations-server";
import { resolveTradeAddressProvenance, TradeAddressVerificationError, type TradeAddressInput, type TradeAddressProvenance } from "./trade-address-verification";
import { normaliseTradeQuoteLines } from "./trade-quote";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";
import { findDirectCustomerDuplicates } from "./trade-customer-dedup-server";
import { readBoundedJsonRequest, BoundedJsonRequestError } from "./bounded-json-request";
import { WattzunInputError } from "./wattzun-portal";
import { parseWattzunConfirmedAction, type WattzunConfirmedAction, type WattzunActionReceipt } from "./wattzun-actions";

type Row = Record<string, unknown>;
export type WattzunActionDependencies = {
  authenticate: (request: Request) => Promise<void>;
  access: typeof requireWattzunAccess;
  team: (request: Request) => Promise<TeamAccess>;
  address: (input: TradeAddressInput, options: { ownerUid: string; secret: string }) => Promise<TradeAddressProvenance>;
  secret: () => string;
  crm: (request: Request) => Promise<Response>;
  quotes: (request: Request) => Promise<Response>;
};
const defaults: WattzunActionDependencies = {
  authenticate: authenticateWattzun, access: requireWattzunAccess, team: requireInstallerTeamAccess,
  address: resolveTradeAddressProvenance,
  secret: () => String(integrationEnvironment().CRM_INTEGRATION_ENCRYPTION_KEY || ""),
  crm: postTradeCrm, quotes: postTradeQuotes,
};
class ActionError extends Error {
  constructor(readonly status: number, message: string, readonly partial?: { workOrderId: string; href: string }) { super(message); }
}
function record(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value); }
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function scopedRequest(request: Request, scopeId: string, path?: string, body?: object) {
  const headers = new Headers(request.headers);
  headers.set("X-TLink-Business", scopeId);
  headers.delete("Content-Length"); headers.delete("Content-Type");
  if (body) headers.set("Content-Type", "application/json");
  return new Request(new URL(path || request.url, request.url), {
    headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: request.signal,
  });
}
function jobHref(access: TeamAccess, id: string) {
  return `/direct-trade/${access.isOwner ? "dashboard" : "team"}?workspace=work&jobId=${encodeURIComponent(id)}&jobTab=quote`;
}
async function result(response: Response) {
  let body: unknown;
  try { body = await response.json(); } catch { throw new ActionError(503, "TLink could not confirm this action. Retry the same review safely."); }
  if (!response.ok || !record(body) || body.ok !== true) {
    throw new ActionError(response.status >= 400 && response.status <= 599 ? response.status : 503,
      record(body) && typeof body.error === "string" ? body.error : "TLink could not confirm this action. Retry the same review safely.");
  }
  return body;
}
async function latestAccess(request: Request, input: WattzunConfirmedAction, previous: WattzunAccess, deps: WattzunActionDependencies) {
  if (request.signal.aborted) throw new ActionError(409, "This review was closed. Open it again before saving.");
  const current = await deps.access(request, "trade", input.scopeId);
  const team = await deps.team(scopedRequest(request, input.scopeId));
  if (current.actorUid !== previous.actorUid || current.scope.scopeId !== previous.scope.scopeId
    || current.scope.portal !== "trade" || team.ownerUid !== input.scopeId || team.actorUid !== previous.actorUid) {
    throw new ActionError(403, "Your workspace changed. Review the action again.");
  }
  if (input.action.kind === "create_customer" && !team.canManageCustomers) throw new ActionError(403, "Customer management permission is required.");
  if (input.action.kind === "prepare_quote" && (!canCreateJobs(team) || !canManageQuotes(team)
    || (!team.isOwner && team.jobScope !== "team") || (input.action.customerMode === "new" && !team.canManageCustomers))) {
    throw new ActionError(403, "Creating this quote needs current job, quote and customer permissions.");
  }
  if (request.signal.aborted) throw new ActionError(409, "This review was closed. Open it again before saving.");
  return team;
}
async function verifyCustomerSite(access: WattzunAccess, input: WattzunConfirmedAction, customerId: string, serviceSiteId: string) {
  const action = input.action;
  const customer = await access.db.prepare(`SELECT c.first_name, c.last_name, c.business_name, c.email, c.phone,
      s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode
    FROM trade_crm_customers c JOIN trade_crm_service_sites s
      ON s.customer_id=c.id AND s.firebase_uid=c.firebase_uid
    WHERE c.id=? AND s.id=? AND c.firebase_uid=? AND c.record_status='active' AND s.record_status='active'`)
    .bind(customerId, serviceSiteId, input.scopeId).first<Row>();
  if (!customer) throw new ActionError(404, "That customer or property is no longer available in this business.");
  const name = String(customer.business_name || [customer.first_name, customer.last_name].filter(Boolean).join(" ")).trim();
  if (name !== action.customerName || String(customer.first_name || "") !== action.firstName
    || String(customer.last_name || "") !== action.lastName || String(customer.email || "").toLowerCase() !== action.email.toLowerCase()
    || String(customer.phone || "").replace(/\D/g, "") !== action.phone.replace(/\D/g, "")) {
    throw new ActionError(409, "The customer's details changed. Select their saved record and confirm the name again.");
  }
  const components = [["addressLine1", "address_line_1"], ["addressLine2", "address_line_2"], ["suburb", "suburb"], ["addressState", "address_state"], ["postcode", "postcode"]] as const;
  for (const [key, column] of components) {
    const selected = action.address[key];
    if (String(customer[column] || "").trim().toLowerCase() !== selected.trim().toLowerCase()) {
      throw new ActionError(409, "The Google address differs from this saved property. Update the customer property, then select it again.");
    }
  }
}
async function verifyReviewedJob(access: WattzunAccess, team: TeamAccess, input: WattzunConfirmedAction, workOrderId: string, clientRequestId: string, requestKey: string) {
  const partial = { workOrderId, href: jobHref(team, workOrderId) };
  const saved = await access.db.prepare(`SELECT w.source_reference,w.service_category,d.description,d.customer_source,d.crm_customer_id,d.service_site_id
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.work_type='job'
      AND w.source_type='internal' AND w.record_status='active'`)
    .bind(workOrderId, input.scopeId).first<Row>();
  if (!saved) throw new ActionError(503, "The saved quote job could not be confirmed. Retry this same review safely.");
  if (saved.source_reference !== `quick-quote:${clientRequestId}` || saved.service_category !== input.action.serviceCategory
    || saved.description !== input.action.description || saved.customer_source !== "trade_owned"
    || typeof saved.crm_customer_id !== "string" || !saved.crm_customer_id || typeof saved.service_site_id !== "string" || !saved.service_site_id
    || (input.action.customerMode === "existing" && (saved.crm_customer_id !== input.action.customerId || saved.service_site_id !== input.action.serviceSiteId))) {
    throw new ActionError(409, "The saved quote job no longer matches this review. Open it before making changes.", partial);
  }
  try { await verifyCustomerSite(access, input, saved.crm_customer_id, saved.service_site_id); }
  catch (error) { if (error instanceof ActionError) throw new ActionError(error.status, error.message, partial); throw error; }
  // New-customer IDs are created by the existing CRM service. Freeze their verified
  // association without copying names, addresses or contact details into the audit.
  const fingerprint = await hash(JSON.stringify({ workOrderId, customerId: saved.crm_customer_id, serviceSiteId: saved.service_site_id }));
  const id = `wattzun-job-${requestKey}`;
  await access.db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
    VALUES (?,?,'wattzun.verified_job_binding','trade_business',?,'Verified the saved job association for a reviewed Wattzun action.',?,?)
    ON CONFLICT(id) DO NOTHING`).bind(id, access.actorUid, input.scopeId, JSON.stringify({ fingerprint }), new Date().toISOString()).run();
  const binding = await access.db.prepare("SELECT admin_uid,entity_id,action,metadata FROM admin_audit_log WHERE id=?").bind(id).first<Row>();
  if (!binding || binding.admin_uid !== access.actorUid || binding.entity_id !== input.scopeId || binding.action !== "wattzun.verified_job_binding") {
    throw new ActionError(503, "The saved job association could not be confirmed. Retry the same review.", partial);
  }
  let metadata: unknown;
  try { metadata = JSON.parse(String(binding.metadata)); } catch { throw new ActionError(503, "The saved job association could not be read. Try again.", partial); }
  if (!record(metadata) || metadata.fingerprint !== fingerprint) {
    throw new ActionError(409, "The saved quote job's customer or property has changed. Open it before making changes.", partial);
  }
}
async function freezeReview(access: WattzunAccess, input: WattzunConfirmedAction, requestKey: string) {
  const address = { ...input.action.address, addressSelectionProof: undefined };
  const fingerprint = await hash(JSON.stringify({ ...input.action, address, addressQuery: "" }));
  const id = `wattzun-review-${requestKey}`;
  await access.db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
    VALUES (?,?,'wattzun.reviewed_intent','trade_business',?,'User reviewed a Wattzun customer or quote action.',?,?)
    ON CONFLICT(id) DO NOTHING`).bind(id, access.actorUid, input.scopeId, JSON.stringify({ fingerprint, kind: input.action.kind }), new Date().toISOString()).run();
  const saved = await access.db.prepare("SELECT admin_uid,entity_id,action,metadata FROM admin_audit_log WHERE id=?")
    .bind(id).first<Row>();
  if (!saved || saved.admin_uid !== access.actorUid || saved.entity_id !== input.scopeId || saved.action !== "wattzun.reviewed_intent") {
    throw new ActionError(503, "The reviewed action could not be recorded. Your customer and quote records have not changed.");
  }
  let metadata: unknown;
  try { metadata = JSON.parse(String(saved.metadata)); } catch { throw new ActionError(503, "The reviewed action could not be read. Try again."); }
  if (!record(metadata) || metadata.fingerprint !== fingerprint || metadata.kind !== input.action.kind) {
    throw new ActionError(409, "This review was already submitted with different details. Start a new review for those changes.");
  }
}
async function existingDraft(access: WattzunAccess, team: TeamAccess, workOrderId: string, input: WattzunConfirmedAction): Promise<WattzunActionReceipt | null> {
  const row = await access.db.prepare(`SELECT q.id quote_id,q.status quote_status,q.crm_customer_id,q.service_site_id,
      d.crm_customer_id job_customer_id,d.service_site_id job_site_id,v.id version_id,v.status version_status,v.acceptance_email,
      v.terms,v.customer_message,v.valid_until
    FROM trade_crm_quotes q JOIN trade_crm_quote_versions v ON v.quote_id=q.id AND v.firebase_uid=q.firebase_uid
      AND v.version_number=q.current_version_number
    JOIN trade_crm_job_details d ON d.work_order_id=q.work_order_id AND d.firebase_uid=q.firebase_uid
    WHERE q.work_order_id=? AND q.firebase_uid=?`)
    .bind(workOrderId, access.scope.scopeId).first<Row>();
  if (!row) return null;
  if (row.crm_customer_id !== row.job_customer_id || row.service_site_id !== row.job_site_id) {
    throw new ActionError(409, "The saved quote's customer or property has changed. Open the saved job to review it.", { workOrderId, href: jobHref(team, workOrderId) });
  }
  if (row.quote_status !== "draft" || row.version_status !== "draft") throw new ActionError(409, "This quote has moved beyond its original draft. Open the saved job to review it.", { workOrderId, href: jobHref(team, workOrderId) });
  if (typeof row.quote_id !== "string" || !row.quote_id || typeof row.version_id !== "string" || !row.version_id) {
    throw new ActionError(503, "The saved draft receipt could not be read.", { workOrderId, href: jobHref(team, workOrderId) });
  }
  const stored = await access.db.prepare(`SELECT line_type,description,quantity_milli,unit_price_cents,tax_code,quote_choice_id
    FROM trade_crm_quote_items WHERE quote_version_id=? AND firebase_uid=? ORDER BY position,id`)
    .bind(row.version_id, access.scope.scopeId).all<Row>();
  const expected = normaliseTradeQuoteLines(input.action.lines, value => String(value || "").trim()).lines;
  if (String(row.acceptance_email || "").toLowerCase() !== input.action.email.toLowerCase()
    || row.terms !== "" || row.customer_message !== "" || row.valid_until !== "" || stored.results.length !== expected.length
    || stored.results.some((line, index) => {
      const reviewed = expected[index];
      return line.quote_choice_id || line.line_type !== reviewed.lineType || line.description !== reviewed.description
        || Number(line.quantity_milli) !== reviewed.quantityMilli || Number(line.unit_price_cents) !== reviewed.unitPriceCents || line.tax_code !== reviewed.taxCode;
    })) {
    throw new ActionError(409, "The saved draft has changed since this review. Open the saved quote before making further changes.", { workOrderId, href: jobHref(team, workOrderId) });
  }
  return { kind: "quote_draft", id: row.quote_id, workOrderId, versionId: row.version_id, href: jobHref(team, workOrderId), label: "Open saved quote draft" };
}

export async function postWattzunAction(request: Request, deps: WattzunActionDependencies = defaults): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the reviewed action as JSON." }, 415);
  try {
    await deps.authenticate(request);
    const input = parseWattzunConfirmedAction(await readBoundedJsonRequest(request, 40_000));
    if (input.action.kind === "prepare_quote") {
      if (!ENERGY_SERVICE_IDS.some(id => id === input.action.serviceCategory)) throw new WattzunInputError("Choose the quote's work category.");
      try { normaliseTradeQuoteLines(input.action.lines, value => String(value || "").trim()); }
      catch { throw new WattzunInputError("Review the quote quantities, prices and GST treatment. The total must be greater than zero."); }
    }
    const access = await deps.access(request, "trade", input.scopeId);
    const team = await latestAccess(request, input, access, deps);
    await deps.address({ ...input.action.address, addressEntryMode: "provider_selected" }, { ownerUid: input.scopeId, secret: deps.secret() });
    if (input.action.customerMode === "existing") await verifyCustomerSite(access, input, input.action.customerId, input.action.serviceSiteId);
    const requestKey = (await hash(`${input.scopeId}|${access.actorUid}|${input.requestId}`)).slice(0, 48);
    await latestAccess(request, input, access, deps);
    await freezeReview(access, input, requestKey);
    const action = input.action;
    const customer = { customerType: "residential", firstName: action.firstName, lastName: action.lastName,
      email: action.email, phone: action.phone, ...action.address, addressEntryMode: "provider_selected" };
    const clientRequestId = `wattzun-${requestKey}`;
    if (action.kind === "create_customer") {
      const existing = await access.db.prepare("SELECT id FROM trade_crm_customers WHERE id=? AND firebase_uid=?")
        .bind(`customer-request-${(await hash(`${input.scopeId}|${access.actorUid}|${clientRequestId}`)).slice(0, 48)}`, input.scopeId).first<Row>();
      if (!existing && (await findDirectCustomerDuplicates(access.db, input.scopeId, customer)).length) {
        throw new ActionError(409, "A matching customer already exists. Open Customers and choose the saved record before creating another.");
      }
      await latestAccess(request, input, access, deps);
      const created = await result(await deps.crm(scopedRequest(request, input.scopeId, "/api/trade-crm", { action: "create_customer", clientRequestId, ...customer })));
      if (typeof created.id !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(created.id)) throw new ActionError(503, "TLink could not confirm the saved customer. Retry this same review safely.");
      const persisted = await access.db.prepare("SELECT id FROM trade_crm_customers WHERE id=? AND firebase_uid=? AND record_status='active'")
        .bind(created.id, input.scopeId).first<Row>();
      if (!persisted) throw new ActionError(503, "The saved customer could not be confirmed. Retry this same review safely.");
      await latestAccess(request, input, access, deps);
      const receipt: WattzunActionReceipt = { kind: "customer", id: created.id, href: `/direct-trade/${team.isOwner ? "dashboard" : "team"}?workspace=work&customerId=${encodeURIComponent(created.id)}`, label: "Open saved customer" };
      return json({ ok: true, receipt }, 201);
    }
    await latestAccess(request, input, access, deps);
    const created = await result(await deps.crm(scopedRequest(request, input.scopeId, "/api/trade-crm", {
      action: "create_quick_quote_job", clientRequestId, customerMode: action.customerMode,
      ...(action.customerMode === "new" ? customer : { crmCustomerId: action.customerId, serviceSiteId: action.serviceSiteId, email: action.email }),
      serviceCategory: action.serviceCategory, description: action.description,
    })));
    if (typeof created.id !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(created.id)) throw new ActionError(503, "The quote job could not be confirmed. Retry this same review safely.");
    const workOrderId = created.id;
    const persistedJob = await access.db.prepare("SELECT id FROM trade_work_orders WHERE id=? AND firebase_uid=? AND record_status='active'")
      .bind(workOrderId, input.scopeId).first<Row>();
    if (!persistedJob) throw new ActionError(503, "The saved quote job could not be confirmed. Retry this same review safely.");
    try {
      await verifyReviewedJob(access, team, input, workOrderId, clientRequestId, requestKey);
      const existing = await existingDraft(access, team, workOrderId, input);
      if (existing) { await latestAccess(request, input, access, deps); return json({ ok: true, receipt: existing, replayed: true }); }
      await latestAccess(request, input, access, deps);
      const saved = await result(await deps.quotes(scopedRequest(request, input.scopeId, "/api/trade-quotes", {
        action: "save_draft", workOrderId, expectedVersionId: "", expectedUpdatedAt: "",
        customerEmail: action.email, lines: action.lines, choices: [], terms: "", customerMessage: "", validUntil: "",
      })));
      await verifyReviewedJob(access, team, input, workOrderId, clientRequestId, requestKey);
      const receipt = await existingDraft(access, team, workOrderId, input);
      if (!receipt || saved.draftVersionId !== receipt.versionId) throw new ActionError(503, "The saved quote version could not be confirmed.");
      await latestAccess(request, input, access, deps);
      return json({ ok: true, receipt }, 201);
    } catch (error) {
      if (wattzunAccessFailure(error) || request.signal.aborted || error instanceof ActionError && (error.status === 401 || error.status === 403)) throw error;
      await latestAccess(request, input, access, deps);
      if (error instanceof ActionError && error.partial) throw error;
      throw new ActionError(error instanceof ActionError ? error.status : 503,
        "The customer and quote job were saved, but the priced draft could not be confirmed. Retry this same review or open the saved job.", { workOrderId, href: jobHref(team, workOrderId) });
    }
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return json({ ok: false, error: error.code === "REQUEST_TOO_LARGE"
      ? "This action is too large. Reduce its quote lines." : "This reviewed action could not be read. Send valid JSON." }, error.status);
    const access = wattzunAccessFailure(error);
    if (access) return json({ ok: false, error: access.message }, access.status);
    if (error instanceof ActionError) return json({ ok: false, error: error.message, ...(error.partial ? { partial: error.partial } : {}) }, error.status);
    if (error instanceof WattzunInputError || error instanceof SyntaxError || error instanceof TradeAddressVerificationError) {
      return json({ ok: false, error: error instanceof SyntaxError ? "This reviewed action could not be read." : error.message }, error instanceof TradeAddressVerificationError && error.code === "ADDRESS_PROOF_KEY_INVALID" ? 503 : 400);
    }
    return json({ ok: false, error: "TLink could not confirm this action. Retry the same review safely." }, 503);
  }
}
