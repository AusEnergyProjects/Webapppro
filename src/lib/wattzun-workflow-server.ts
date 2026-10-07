import { POST as postPriceBook } from "@/app/api/trade-price-book/route";
import { authenticateWattzun, requireWattzunAccess, wattzunAccessFailure, type WattzunAccess } from "./wattzun-portal-access-server";
import { requireInstallerTeamAccess, type TeamAccess } from "./trade-team-server";
import { jobMemberSql } from "./trade-job-collaboration";
import { encryptProtectedPayload, decryptProtectedPayload } from "./trade-integration-crypto";
import { sendTradeSms } from "./trade-sms-server";
import { sendTradeCustomerEmail, tradeEmailSettings } from "./trade-email-server";
import { resolveTradeEmailRecipient } from "./trade-email-recipient-server";
import { normalizeAustralianMobile, ReminderProviderDeliveryError } from "./service-reminder-delivery";
import { normalisePriceBookInput, PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_UNITS } from "./trade-price-book";
import { normaliseQuoteEquipment } from "./trade-quote-equipment";
import { smsSegments, tradeSmsBody } from "./trade-sms";
import { SMS_PART_PRICE_MICRO } from "./trade-sms-billing";
import { australiaLocalDateTime } from "./trade-schedule";
import { projectTradeInvoiceRegisterFinance, TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL } from "./trade-invoice-register";
import { smsWallet } from "./trade-sms-wallet-server";
import { readBoundedJsonRequest, BoundedJsonRequestError } from "./bounded-json-request";
import { parseWattzunWorkflowProposal, isWattzunWorkflowResult, type WattzunWorkflowOperation, type WattzunWorkflowProposal,
  type WattzunWorkflowResult, type WattzunWorkflowReview, type WattzunWorkflowReceipt, type WattzunWorkflowJobChoice } from "./wattzun-workflow";
import { prepareWattzunExistingQuote, executeWattzunExistingQuote, WattzunExistingQuoteError, type WattzunExistingQuotePrepared } from "./wattzun-existing-quote-server";

type Row = Record<string, unknown>;
type Job = { id: string; work_number: string; title: string; revision: number; updated_at: string; detail_updated_at: string;
  customer_id: string; customer_name: string; email: string; phone: string; customer_updated_at: string; site_updated_at: string;
  address_line_1: string; address_line_2: string; suburb: string; address_state: string; postcode: string; scheduled_at: string; completed_at: string };
type Invoice = { id: string; number: string; total: number; credited: number; paid: number; due: string; updated: string; kind: string };
type SmsReadiness = { connectionId: string; number: string; provider: string; phone: string; consentAt: string; segments: number; priceMicro: number };
type MessagePrepared = { job: Job; channel: "sms" | "email"; recipient: string; subject: string; body: string;
  sms?: SmsReadiness; email?: { from: string; provider: string }; invoice?: Invoice };
type PricePrepared = { input: ReturnType<typeof normalisePriceBookInput>; payload: Row };
type Prepared = { proposal: WattzunWorkflowOperation; sourceSha256: string; review: WattzunWorkflowReview;
  message?: MessagePrepared; price?: PricePrepared; quote?: WattzunExistingQuotePrepared };
type ReviewMetadata = { fingerprint: string; expiresAt: string; kind: WattzunWorkflowOperation["kind"]; sourceSha256: string;
  encrypted: string; state: "prepared" | "executing" | "complete"; receipt?: WattzunWorkflowReceipt };
export type WattzunWorkflowDependencies = {
  authenticate: typeof authenticateWattzun; access: typeof requireWattzunAccess; team: typeof requireInstallerTeamAccess;
  encrypt: typeof encryptProtectedPayload; decrypt: typeof decryptProtectedPayload;
  sms: typeof sendTradeSms; email: typeof sendTradeCustomerEmail; emailSettings: typeof tradeEmailSettings;
  emailRecipient: typeof resolveTradeEmailRecipient; wallet: typeof smsWallet; priceBook: typeof postPriceBook;
  prepareQuote: typeof prepareWattzunExistingQuote; executeQuote: typeof executeWattzunExistingQuote; now: () => number;
};
const defaults: WattzunWorkflowDependencies = { authenticate: authenticateWattzun, access: requireWattzunAccess, team: requireInstallerTeamAccess,
  encrypt: encryptProtectedPayload, decrypt: decryptProtectedPayload, sms: sendTradeSms, email: sendTradeCustomerEmail,
  emailSettings: tradeEmailSettings, emailRecipient: resolveTradeEmailRecipient, wallet: smsWallet, priceBook: postPriceBook,
  prepareQuote: prepareWattzunExistingQuote, executeQuote: executeWattzunExistingQuote, now: Date.now };
export class WattzunWorkflowError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function record(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
const clean = (value: unknown, length: number) => String(value ?? "").trim().slice(0, length);
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
async function hash(value: unknown) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function scopedRequest(request: Request, scopeId: string, path?: string, body?: object) {
  const headers = new Headers(request.headers); headers.set("X-TLink-Business", scopeId); headers.delete("Content-Length");
  if (body) headers.set("Content-Type", "application/json");
  return new Request(new URL(path || request.url, request.url), { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: request.signal });
}
function href(team: TeamAccess, workspace: string, jobId = "") {
  return `/direct-trade/${team.isOwner ? "dashboard" : "team"}?workspace=${workspace}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`;
}
function priceBookHref(team: TeamAccess) {
  return team.isOwner ? href(team, "finance") + "&financeView=pricebook" : href(team, "pricebook");
}
function authority(team: TeamAccess) {
  return { ownerUid: team.ownerUid, actorUid: team.actorUid, memberId: team.memberId, businessName: team.businessName, isOwner: team.isOwner, jobScope: team.jobScope,
    canViewCustomers: team.canViewCustomers, canSendSms: !!team.canSendSms, canManageCustomers: team.canManageCustomers,
    canManageJobs: team.canManageJobs, canSendQuotes: team.canSendQuotes, canViewInvoices: team.canViewInvoices,
    canManageInvoices: team.canManageInvoices, canManagePriceBook: team.canManagePriceBook };
}
async function currentTeam(request: Request, access: WattzunAccess, deps: WattzunWorkflowDependencies) {
  if (access.scope.portal !== "trade") throw new WattzunWorkflowError(403, "Operational trade actions require your TLink business workspace.");
  if (request.signal.aborted) throw new WattzunWorkflowError(409, "This action was closed. Prepare it again before continuing.");
  const current = await deps.access(request, "trade", access.scope.scopeId);
  const team = await deps.team(scopedRequest(request, access.scope.scopeId));
  if (current.actorUid !== access.actorUid || current.scope.portal !== "trade" || current.scope.scopeId !== access.scope.scopeId
    || team.ownerUid !== access.scope.scopeId || team.actorUid !== access.actorUid) throw new WattzunWorkflowError(403, "Your business or access changed. Prepare this action again.");
  return team;
}
function permissions(team: TeamAccess, proposal: WattzunWorkflowOperation) {
  if (proposal.kind === "add_price_book_item") {
    if (!team.isOwner && !team.canManagePriceBook) throw new WattzunWorkflowError(403, "Price-book management permission is required.");
    return;
  }
  if (!team.canViewCustomers) throw new WattzunWorkflowError(403, "Customer access is required to choose this job.");
  if (proposal.kind === "invoice_reminder" && !(team.isOwner || team.canViewInvoices && team.canManageInvoices)) {
    throw new WattzunWorkflowError(403, "Invoice viewing and management permission is required to send invoice reminders.");
  }
  if (proposal.kind === "customer_message" || proposal.kind === "invoice_reminder") {
    if (proposal.channel === "sms" && !team.isOwner && !team.canSendSms) throw new WattzunWorkflowError(403, "SMS permission is required for this business.");
    if (proposal.channel === "email" && !(team.isOwner || team.canManageCustomers || team.canManageJobs || team.canSendQuotes || team.canManageInvoices)) {
      throw new WattzunWorkflowError(403, "Customer email permission is required for this business.");
    }
  }
}
function choice(job: Job): WattzunWorkflowJobChoice {
  return { jobId: job.id, workNumber: clean(job.work_number, 100), title: clean(job.title, 300), customerName: clean(job.customer_name, 180),
    address: [job.address_line_1, job.address_line_2, job.suburb, job.address_state, job.postcode].filter(Boolean).join(", ").slice(0, 400),
    scheduledAt: clean(job.scheduled_at, 50), completedAt: clean(job.completed_at, 50) };
}
// Every disclosed name, street and contact belongs to an active, locally owned
// customer/site and a job inside the current member's operational scope.
const JOB_SELECT = `SELECT w.id,w.work_number,w.title,w.revision,w.updated_at,d.updated_at detail_updated_at,
  c.id customer_id,CASE WHEN c.business_name<>'' THEN c.business_name ELSE TRIM(c.first_name||' '||c.last_name) END customer_name,
  c.email,c.phone,c.updated_at customer_updated_at,s.updated_at site_updated_at,
  s.address_line_1,s.address_line_2,s.suburb,s.address_state,s.postcode,
  COALESCE((SELECT MAX(a.starts_at) FROM trade_crm_appointments a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid AND a.status<>'cancelled'),'') scheduled_at,
  COALESCE((SELECT MAX(a.completed_at) FROM trade_crm_appointments a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid AND a.status='completed'),'') completed_at
  FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  JOIN trade_crm_customers c ON c.id=d.crm_customer_id AND c.firebase_uid=w.firebase_uid AND c.record_status='active'
  JOIN trade_crm_service_sites s ON s.id=d.service_site_id AND s.customer_id=c.id AND s.firebase_uid=w.firebase_uid AND s.record_status='active'
  WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.work_type='job' AND w.record_status='active'
    AND w.source_type NOT IN ('opportunity','public_lead') AND d.customer_source IN ('trade_owned','internal')
    AND (?=1 OR ${jobMemberSql("w")})`;
function queryParts(query: string, now: number) {
  let remaining = query.toLowerCase(); let range: { from: string; until: string } | undefined;
  const date = new Date(australiaLocalDateTime("NSW", new Date(now)).slice(0, 10) + "T00:00:00Z");
  if (/\blast week\b/.test(remaining)) {
    const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000;
    range = { from: new Date(monday - 7 * 86_400_000).toISOString().slice(0, 10), until: new Date(monday).toISOString().slice(0, 10) };
    remaining = remaining.replace(/\blast week\b/g, " ");
  } else if (/\byesterday\b/.test(remaining)) {
    range = { from: new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10), until: date.toISOString().slice(0, 10) };
    remaining = remaining.replace(/\byesterday\b/g, " ");
  }
  const ignored = new Set(["the", "job", "jobs", "customer", "at", "in", "for", "that", "from", "please", "a", "an", "to"]);
  return { terms: remaining.split(/[^a-z0-9]+/).filter(term => term && !ignored.has(term)).slice(0, 10), range };
}
function sydneyDayBoundary(date: string) {
  const civil = Date.parse(`${date}T00:00:00Z`); let instant = civil;
  // Reuse the scheduler's IANA-zone conversion, including DST, to translate
  // civil day boundaries for UTC completion/creation timestamps.
  for (let attempt = 0; attempt < 2; attempt++) {
    const wallClock = Date.parse(australiaLocalDateTime("NSW", new Date(instant)) + ":00Z");
    instant += civil - wallClock;
  }
  return new Date(instant).toISOString();
}
async function findJobs(access: WattzunAccess, team: TeamAccess, proposal: Exclude<WattzunWorkflowOperation, { kind: "add_price_book_item" }>, deps: WattzunWorkflowDependencies) {
  const values: (string | number)[] = [team.ownerUid, team.isOwner || team.jobScope === "team" ? 1 : 0, team.memberId];
  let sql = JOB_SELECT;
  if (proposal.jobId) { sql += " AND w.id=?"; values.push(proposal.jobId); }
  else {
    const { terms, range } = queryParts(proposal.jobQuery, deps.now());
    if (!terms.length && !range) return [];
    for (const term of terms) {
      sql += ` AND (LOWER(w.title||' '||w.work_number||' '||c.first_name||' '||c.last_name||' '||c.business_name||' '||s.address_line_1||' '||s.suburb||' '||s.postcode) LIKE ?)`;
      values.push(`%${term}%`);
    }
    if (range) {
      sql += ` AND (EXISTS(SELECT 1 FROM trade_crm_appointments date_visit WHERE date_visit.work_order_id=w.id AND date_visit.firebase_uid=w.firebase_uid
        AND date_visit.status<>'cancelled' AND ((substr(date_visit.starts_at,1,10)>=? AND substr(date_visit.starts_at,1,10)<?)
          OR (julianday(date_visit.completed_at)>=julianday(?) AND julianday(date_visit.completed_at)<julianday(?))))
        OR (julianday(w.created_at)>=julianday(?) AND julianday(w.created_at)<julianday(?)))`;
      const fromInstant = sydneyDayBoundary(range.from), untilInstant = sydneyDayBoundary(range.until);
      values.push(range.from, range.until, fromInstant, untilInstant, fromInstant, untilInstant);
    }
  }
  return (await access.db.prepare(sql + " ORDER BY w.updated_at DESC,w.id LIMIT 6").bind(...values).all<Job>()).results;
}
async function invoices(access: WattzunAccess, job: Job) {
  const rows = (await access.db.prepare(`SELECT d.paid_value_cents,d.invoiced_value_cents,d.payment_due_at,
      h.total_cents accepted_total_cents,h.accepted_at,
      ai.id accepted_invoice_id,ai.invoice_number accepted_invoice_number,ai.total_cents accepted_invoice_total_cents,
      ai.status accepted_invoice_status,ai.issue_blocker_code accepted_invoice_blocker_code,ai.due_at accepted_invoice_due_at,
      ai.created_at accepted_invoice_created_at,ai.updated_at accepted_updated,
      a.id accounting_document_id,a.status accounting_status,a.provider,a.external_number,a.external_document_id,
      a.amount_cents accounting_amount_cents,a.paid_amount_cents accounting_paid_amount_cents,a.due_at accounting_due_at,
      a.created_at accounting_created_at,a.updated_at accounting_updated,a.last_error,
      q.id quick_invoice_id,q.invoice_number quick_invoice_number,q.total_cents quick_total_cents,q.status quick_invoice_status,
      q.due_at quick_due_at,q.delivery_status quick_delivery_status,q.sent_at quick_sent_at,q.updated_at quick_updated,q.last_error quick_last_error,
      COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit WHERE credit.invoice_id=q.id AND credit.status='issued'),0) quick_credited_cents
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    ${TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL}
    LEFT JOIN trade_crm_accepted_invoices ai ON ai.commercial_handoff_id=h.id AND ai.acceptance_id=h.acceptance_id
      AND ai.quote_version_id=h.quote_version_id AND ai.work_order_id=w.id AND ai.firebase_uid=w.firebase_uid AND ai.crm_customer_id=d.crm_customer_id
    LEFT JOIN trade_crm_accounting_documents a ON a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid AND a.document_type='invoice'
    LEFT JOIN trade_crm_quick_invoices q ON q.work_order_id=w.id AND q.firebase_uid=w.firebase_uid AND q.status<>'void'
    WHERE w.id=? AND w.firebase_uid=? AND d.crm_customer_id=? LIMIT 6`).bind(job.id, access.scope.scopeId, job.customer_id).all<Row>()).results;
  const unique = new Map<string, Invoice>();
  for (const row of rows) {
    const finance = projectTradeInvoiceRegisterFinance(row);
    const kind = row.quick_invoice_number ? "quick" : row.accounting_document_id ? "accounting" : "accepted";
    const issued = kind === "quick" ? ["issued", "part_credited"].includes(String(row.quick_invoice_status))
      : kind === "accounting" ? ["issued", "part_paid", "overdue"].includes(String(row.accounting_status)) && !!row.external_document_id
        : row.accepted_invoice_status === "issued";
    if (!issued || !finance.externalNumber || finance.outstandingCents < 1 || finance.status === "attention") continue;
    const invoice: Invoice = { id: String(kind === "quick" ? row.quick_invoice_id : kind === "accounting" ? row.accounting_document_id : row.accepted_invoice_id),
      number: finance.externalNumber, total: finance.totalCents, credited: 0, paid: finance.paidCents, due: finance.dueAt,
      updated: String(kind === "quick" ? row.quick_updated : kind === "accounting" ? row.accounting_updated : row.accepted_updated), kind };
    const previous = unique.get(invoice.id);
    if (!previous || invoice.paid > previous.paid) unique.set(invoice.id, invoice);
  }
  return [...unique.values()];
}
async function smsReady(access: WattzunAccess, team: TeamAccess, job: Job, body: string, deps: WattzunWorkflowDependencies): Promise<SmsReadiness> {
  const phone = normalizeAustralianMobile(job.phone);
  if (!phone) throw new WattzunWorkflowError(409, "Save an Australian mobile number for this customer before preparing a text.");
  const connection = await access.db.prepare("SELECT id,phone_number,provider,status,daily_limit FROM trade_sms_connections WHERE firebase_uid=? AND status='connected'")
    .bind(team.ownerUid).first<{ id: string; phone_number: string; provider: string; status: string; daily_limit: number }>();
  if (!connection) throw new WattzunWorkflowError(409, "Connect your business SMS number in Connect before sending this text.");
  const recipient = await access.db.prepare("SELECT customer_id,consent_at,opted_out_at FROM trade_sms_recipients WHERE connection_id=? AND firebase_uid=? AND phone_number=?")
    .bind(connection.id, team.ownerUid, phone).first<{ customer_id: string; consent_at: string; opted_out_at: string }>();
  if (!recipient || recipient.customer_id !== job.customer_id || !recipient.consent_at) throw new WattzunWorkflowError(409, "Record this customer's permission for service texts in Connect first.");
  if (recipient.opted_out_at) throw new WattzunWorkflowError(409, "This customer opted out of texts. They need to text START before another service message can be sent.");
  const fullBody = tradeSmsBody(body, team.businessName) + `\nJob ${job.work_number}`;
  const segments = smsSegments(fullBody); const priceMicro = connection.provider === "clicksend" ? segments * SMS_PART_PRICE_MICRO : 0;
  const used = await access.db.prepare("SELECT COALESCE(SUM(segments),0) total FROM trade_sms_messages WHERE firebase_uid=? AND direction='outbound' AND created_at>=?")
    .bind(team.ownerUid, new Date(deps.now()).toISOString().slice(0, 10) + "T00:00:00.000Z").first<{ total: number }>();
  if (Number(used?.total || 0) + segments > connection.daily_limit) throw new WattzunWorkflowError(409, "The business daily SMS limit is reached. Open Connect to review it.");
  if (priceMicro && (await deps.wallet(team.ownerUid, access.db)).balanceMicro < priceMicro) throw new WattzunWorkflowError(409, "Add enough SMS credit in Connect to cover this text.");
  return { connectionId: connection.id, number: connection.phone_number, provider: connection.provider, phone, consentAt: recipient.consent_at, segments, priceMicro };
}
async function messagePrepared(request: Request, access: WattzunAccess, team: TeamAccess,
  proposal: Extract<WattzunWorkflowOperation, { kind: "customer_message" | "invoice_reminder" }>, job: Job, deps: WattzunWorkflowDependencies) {
  const questions: string[] = [];
  if (!proposal.channel) questions.push("Would you like to send a text or an email?");
  if (proposal.kind === "customer_message" && !proposal.body.trim()) questions.push("What would you like the message to say?");
  if (proposal.kind === "customer_message" && proposal.channel === "email" && !proposal.subject.trim()) questions.push("What subject should the email use?");
  if (questions.length) return { state: "needs_details", questions } satisfies WattzunWorkflowResult;
  let invoice: Invoice | undefined;
  if (proposal.kind === "invoice_reminder") {
    const available = await invoices(access, job);
    const selected = proposal.invoiceId ? available.filter(value => value.id === proposal.invoiceId || value.number.toLowerCase() === proposal.invoiceId.toLowerCase()) : available;
    if (selected.length !== 1) {
      let question = "Which issued invoice should I remind them about?";
      for (const value of selected.slice(0, 5)) {
        const option = `${value.number} ($${((value.total - value.credited - value.paid) / 100).toFixed(2)} outstanding)`;
        if (question.length + option.length + 2 > 430) break;
        question += ` ${option};`;
      }
      return { state: "needs_details", questions: [selected.length
        ? question + " Tell me the exact invoice number."
        : "There is no matching issued invoice with an outstanding balance on this job. Which unpaid issued invoice did you mean?"] } satisfies WattzunWorkflowResult;
    }
    invoice = selected[0];
  }
  const subject = invoice ? `Reminder: invoice ${invoice.number}` : proposal.kind === "customer_message" ? proposal.subject.trim() : "";
  const reminder = invoice ? `Hi ${job.customer_name}, a quick reminder about invoice ${invoice.number} for job ${job.work_number}. The outstanding balance is $${((invoice.total - invoice.credited - invoice.paid) / 100).toFixed(2)}${invoice.due ? `, due ${invoice.due}` : ""}. Please let us know if you have any questions. Thanks!` : "";
  const body = invoice ? [proposal.body.trim(), reminder].filter(Boolean).join("\n\n") : proposal.body.trim();
  const channel = proposal.channel;
  if (channel !== "sms" && channel !== "email") throw new WattzunWorkflowError(400, "Choose text or email.");
  if (channel === "sms" && body.length > 480) return { state: "needs_details", questions: ["This text would exceed the 480-character service-message limit. Would you like a shorter version, or would you prefer an email?"] } satisfies WattzunWorkflowResult;
  const prepared: MessagePrepared = { job, channel, recipient: "", subject, body, ...(invoice ? { invoice } : {}) };
  if (channel === "sms") {
    prepared.sms = await smsReady(access, team, job, body, deps); prepared.recipient = prepared.sms.phone;
  } else {
    const settings = await deps.emailSettings(team.ownerUid, access.db);
    if (!settings.connection || settings.connection.status !== "connected" || !settings.providers.some(provider => provider.id === settings.connection!.provider && provider.available)) {
      throw new WattzunWorkflowError(409, "Ask the business owner to connect or reconnect the business email in Settings before sending.");
    }
    prepared.recipient = await deps.emailRecipient(team, { workOrderId: job.id }, access.db);
    if (prepared.recipient !== job.email.trim()) throw new WattzunWorkflowError(409, "The customer's saved email changed. Prepare the message again.");
    prepared.email = { from: settings.connection.email, provider: settings.connection.provider };
  }
  return prepared;
}
async function buildPrepared(request: Request, access: WattzunAccess, team: TeamAccess, proposal: WattzunWorkflowOperation,
  reviewId: string, expiresAt: string, deps: WattzunWorkflowDependencies): Promise<Prepared | WattzunWorkflowResult> {
  permissions(team, proposal);
  const base = { state: "review" as const, reviewId, expiresAt, kind: proposal.kind };
  if (proposal.kind === "add_price_book_item") {
    const questions: string[] = [];
    if (!proposal.name.trim()) questions.push("What is the item name?");
    if (proposal.unitPrice === null) questions.push("What is its selling price excluding GST?");
    if (!proposal.itemType || !PRICE_BOOK_ITEM_TYPES.some(value => value === proposal.itemType)) questions.push("What type of item is this, such as material, labour or equipment?");
    if (proposal.unitLabel && !PRICE_BOOK_UNITS.some(([value]) => value === proposal.unitLabel)) questions.push("How is it charged: each, hour, metre or another unit?");
    if (proposal.taxCode === null) questions.push("Does GST apply to this item?");
    if (questions.length) return { state: "needs_details", questions: questions.slice(0, 5) };
    if (proposal.name.length > 140 || proposal.description.length > 500) throw new WattzunWorkflowError(400, "Use an item name up to 140 characters and description up to 500 characters.");
    const payload = { action: "create", name: proposal.name, description: proposal.description, itemType: proposal.itemType,
      unitLabel: proposal.unitLabel || "each", sellPrice: proposal.unitPrice, supplierCost: proposal.supplierCost ?? "0", taxCode: proposal.taxCode,
      expectedDurationMinutes: 0, requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "", category: "" };
    const input = normalisePriceBookInput(payload, clean);
    const review: WattzunWorkflowReview = { ...base, heading: "Add price-book item", summary: "Save this item in your business price book.", confirmationLabel: "Save price-book item",
      lines: [{ label: "Item", value: input.name }, { label: "Type / unit", value: `${input.itemType} / ${input.unitLabel}` },
        { label: "Sell price excluding GST", value: `$${(input.sellPriceCentsExGst / 100).toFixed(2)}` },
        { label: "Supplier cost excluding GST", value: proposal.supplierCost === null ? "Not supplied. Price-book default is $0.00; no supplier cost was estimated." : `$${(input.supplierCostCentsExGst / 100).toFixed(2)}` },
        ...(proposal.unitLabel ? [] : [{ label: "Unit", value: "Not supplied. Price-book default is each." }]),
        { label: "GST", value: input.taxCode === "gst" ? "10% GST applies" : "No GST" },
        { label: "Other fields", value: "No supplier, SKU, category or required skill. Duration is zero minutes." },
        ...(input.description ? [{ label: "Description", value: input.description }] : [])], href: priceBookHref(team) };
    return { proposal, review, price: { input, payload }, sourceSha256: await hash({ authority: authority(team), input }) };
  }
  const jobs = await findJobs(access, team, proposal, deps);
  if (jobs.length !== 1) return { state: "choose_job", proposal, question: jobs.length
    ? `${jobs.length > 5 ? "Several" : jobs.length} jobs match. Which customer and address did you mean?${jobs.length > 5 ? " Narrow the name, street or dates if it is not listed." : ""}`
    : "I could not find a matching accessible job. What is the customer name, street or job number?", choices: jobs.slice(0, 5).map(choice) };
  const job = jobs[0];
  const exactProposal = { ...proposal, jobId: job.id };
  if (proposal.kind === "draft_job_quote") {
    const questions = proposal.lines.length === 0 ? ["What items or work should the quote include, with quantities, prices excluding GST and GST treatment?"]
      : proposal.lines.filter(line => !line.description.trim() || line.quantity === null || line.unitPrice === null || line.taxCode === null)
        .slice(0, 5).map(line => `For ${line.description.trim() || "this quote item"}, what quantity and selling price excluding GST should I use, and does GST apply?`);
    if (questions.length) return { state: "needs_details", questions };
    const quote = await deps.prepareQuote(scopedRequest(request, access.scope.scopeId), { scopeId: access.scope.scopeId, actorUid: access.actorUid, proposal: { ...proposal, jobId: job.id } });
    return { proposal: exactProposal, quote, sourceSha256: quote.sourceSha256,
      review: { ...base, heading: quote.review.title, summary: quote.review.summary, confirmationLabel: "Save quote draft", lines: quote.review.fields, target: choice(job), href: href(team, "work", job.id) + "&jobTab=quote" } };
  }
  const message = await messagePrepared(request, access, team, proposal, job, deps);
  if ("state" in message) return message;
  const previewBody = message.channel === "sms" ? tradeSmsBody(message.body, team.businessName) + `\nJob ${job.work_number}` : message.body;
  const review: WattzunWorkflowReview = { ...base, heading: proposal.kind === "invoice_reminder" ? "Send invoice reminder" : "Send customer message",
    summary: `Send one ${message.channel === "sms" ? "service text" : "email"} to the saved customer for this job.`, confirmationLabel: message.channel === "sms" ? "Send text" : "Send email",
    target: choice(job), preview: { subject: message.channel === "email" ? message.subject : "", body: previewBody }, href: href(team, "work", job.id),
    lines: [{ label: "Customer", value: job.customer_name }, { label: "Recipient", value: message.recipient },
      { label: "From", value: message.sms?.number || message.email?.from || "" },
      ...(message.sms ? [{ label: "SMS parts / cost", value: `${message.sms.segments} part${message.sms.segments === 1 ? "" : "s"}${message.sms.priceMicro ? `, $${(message.sms.priceMicro / 1_000_000).toFixed(3)} including GST` : ", billed by your SMS provider"}` }] : []),
      ...(message.invoice ? [{ label: "Invoice", value: message.invoice.number }, { label: "Outstanding", value: `$${((message.invoice.total - message.invoice.credited - message.invoice.paid) / 100).toFixed(2)}` }, { label: "Due", value: message.invoice.due || "No due date recorded" }] : [])] };
  return { proposal: exactProposal, review, message, sourceSha256: await hash({ authority: authority(team), message }) };
}
function isFrozenPrepared(value: unknown): value is Prepared {
  if (!record(value) || !/^[a-f0-9]{64}$/.test(String(value.sourceSha256)) || !isWattzunWorkflowResult(value.review) || value.review.state !== "review") return false;
  let proposal: WattzunWorkflowProposal;
  try { proposal = parseWattzunWorkflowProposal(value.proposal); } catch { return false; }
  if (proposal.kind === "confirm_workflow" || proposal.kind !== value.review.kind || value.review.expiresAt.length !== 24 || !Number.isFinite(Date.parse(value.review.expiresAt))) return false;
  const text = (raw: unknown, max = 4000): raw is string => typeof raw === "string" && raw.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw);
  const strings = (raw: Row, keys: string[], max = 4000) => keys.every(key => text(raw[key], max));
  const id = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(raw);
  const nonnegative = (raw: unknown): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0;
  if (proposal.kind === "add_price_book_item") {
    if (!record(value.price) || !record(value.price.payload) || !record(value.price.input) || value.message !== undefined || value.quote !== undefined) return false;
    const payload = value.price.payload;
    if (payload.action !== "create" || payload.name !== proposal.name || payload.description !== proposal.description || payload.itemType !== proposal.itemType
      || payload.unitLabel !== (proposal.unitLabel || "each") || payload.sellPrice !== proposal.unitPrice || payload.supplierCost !== (proposal.supplierCost ?? "0") || payload.taxCode !== proposal.taxCode
      || Object.keys(payload).some(key => !["action", "name", "description", "itemType", "unitLabel", "sellPrice", "supplierCost", "taxCode", "expectedDurationMinutes", "requiredSkill", "supplierName", "supplierSku", "supplierProductId", "category"].includes(key))) return false;
    try { return JSON.stringify(normalisePriceBookInput(payload, clean)) === JSON.stringify(value.price.input); } catch { return false; }
  }
  if (!id(proposal.jobId)) return false;
  if (proposal.kind === "draft_job_quote") {
    if (!record(value.quote) || value.message !== undefined || value.price !== undefined) return false;
    const quote = value.quote;
    if (!record(quote.job) || !record(quote.original) || !record(quote.savePayload) || !record(quote.review)
      || quote.sourceSha256 !== value.sourceSha256 || !/^[a-f0-9]{64}$/.test(String(quote.authoritySha256))
      || quote.job.id !== proposal.jobId || !strings(quote.job, ["id", "workNumber", "customerName", "siteSummary"])
      || !strings(quote.original, ["quoteId", "versionId", "updatedAt"]) || !(quote.original.roofImageSha256 === null || /^[a-f0-9]{64}$/.test(String(quote.original.roofImageSha256)))
      || !strings(quote.review, ["title", "summary"]) || !Array.isArray(quote.review.fields) || quote.review.fields.length > 40
      || !quote.review.fields.every(field => record(field) && strings(field, ["label", "value"])) ) return false;
    const payload = quote.savePayload;
    const line = (raw: unknown) => record(raw) && ["product", "labour", "adjustment"].includes(String(raw.lineType))
      && strings(raw, ["description", "quantity", "unitPrice", "taxCode", "sectionHeading", "priceBookItemId", "jobPacketId", "jobPacketLineId"])
      && ["gst", "none"].includes(String(raw.taxCode)) && /^\d{1,9}(?:\.\d{1,3})?$/.test(String(raw.quantity)) && /^-?\d{1,9}(?:\.\d{1,2})?$/.test(String(raw.unitPrice));
    if (payload.action !== "save_draft" || payload.workOrderId !== proposal.jobId || !strings(payload, ["expectedVersionId", "expectedUpdatedAt", "customerEmail", "terms", "customerMessage", "validUntil", "designId"], 50_000)
      || !Array.isArray(payload.lines) || payload.lines.length > 100 || !payload.lines.every(line) || !Array.isArray(payload.choices) || payload.choices.length > 20
      || !payload.choices.every(choice => record(choice) && strings(choice, ["clientKey", "groupKey", "name", "summary"])
        && ["package", "addon", "choose_one"].includes(String(choice.kind)) && typeof choice.recommended === "boolean"
        && Array.isArray(choice.lines) && choice.lines.length <= 100 && choice.lines.every(line))) return false;
    try { return JSON.stringify(normaliseQuoteEquipment(payload.equipment)) === JSON.stringify(payload.equipment); } catch { return false; }
  }
  if (!record(value.message) || value.quote !== undefined || value.price !== undefined) return false;
  const message = value.message;
  if (!record(message.job) || !strings(message.job, ["id", "work_number", "title", "updated_at", "detail_updated_at", "customer_id", "customer_name", "email", "phone", "customer_updated_at", "site_updated_at", "address_line_1", "address_line_2", "suburb", "address_state", "postcode", "scheduled_at", "completed_at"])
    || message.job.id !== proposal.jobId || !nonnegative(message.job.revision) || !id(message.job.customer_id)
    || message.channel !== proposal.channel || !strings(message, ["recipient", "subject", "body"]) || !message.body) return false;
  if (message.channel === "sms") {
    if (!record(message.sms) || message.email !== undefined || !strings(message.sms, ["connectionId", "number", "provider", "phone", "consentAt"])
      || message.sms.phone !== message.recipient || !/^\+614\d{8}$/.test(String(message.recipient)) || !nonnegative(message.sms.segments) || message.sms.segments < 1 || !nonnegative(message.sms.priceMicro)) return false;
  } else if (message.channel === "email") {
    if (!record(message.email) || message.sms !== undefined || !strings(message.email, ["from", "provider"]) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(message.recipient))) return false;
  } else return false;
  if (proposal.kind === "invoice_reminder") {
    if (!record(message.invoice) || !strings(message.invoice, ["id", "number", "due", "updated", "kind"])
      || !nonnegative(message.invoice.total) || !nonnegative(message.invoice.credited) || !nonnegative(message.invoice.paid)
      || message.invoice.total <= message.invoice.credited + message.invoice.paid) return false;
  } else if (message.invoice !== undefined || message.body !== proposal.body.trim()) return false;
  return true;
}
function isReviewMetadata(value: unknown): value is ReviewMetadata {
  return record(value) && typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) && typeof value.encrypted === "string"
    && typeof value.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.sourceSha256)
    && ["add_price_book_item", "customer_message", "invoice_reminder", "draft_job_quote"].includes(String(value.kind))
    && ["prepared", "executing", "complete"].includes(String(value.state))
    && (value.receipt === undefined || isWattzunWorkflowResult({ state: "complete", receipt: value.receipt }));
}
function metadata(row: Row): ReviewMetadata {
  let value: unknown;
  try { value = JSON.parse(String(row.metadata)); } catch { throw new WattzunWorkflowError(503, "The saved review could not be read. Prepare it again."); }
  if (!isReviewMetadata(value)) throw new WattzunWorkflowError(503, "The saved review could not be verified.");
  return value;
}
async function readReview(access: WattzunAccess, reviewId: string, deps: WattzunWorkflowDependencies) {
  if (!/^wr_[a-f0-9]{48}$/.test(reviewId)) throw new WattzunWorkflowError(400, "Choose a current Wattzun review.");
  const row = await access.db.prepare("SELECT id,admin_uid,entity_id,action,metadata FROM admin_audit_log WHERE id=?").bind(reviewId).first<Row>();
  if (!row || row.admin_uid !== access.actorUid || row.entity_id !== access.scope.scopeId || row.action !== "wattzun.workflow_review") throw new WattzunWorkflowError(404, "This review is not available in your current business.");
  const saved = metadata(row);
  if (saved.state === "prepared" && Date.parse(saved.expiresAt) <= deps.now()) throw new WattzunWorkflowError(409, "This review expired. Ask Wattzun to prepare a fresh review.");
  const raw = await deps.decrypt(saved.encrypted);
  if (!isFrozenPrepared(raw.prepared)) throw new WattzunWorkflowError(503, "The saved review could not be decrypted or its workflow fields are invalid.");
  const prepared = raw.prepared;
  if (!isWattzunWorkflowResult(prepared.review) || prepared.review.state !== "review" || prepared.review.reviewId !== reviewId
    || prepared.review.expiresAt !== saved.expiresAt || prepared.sourceSha256 !== saved.sourceSha256 || prepared.proposal.kind !== saved.kind) throw new WattzunWorkflowError(503, "The saved action no longer matches its review.");
  return { row, saved, prepared };
}
/** The portal can prepare an action, but execution is available only through the reviewed endpoint. */
export async function prepareWattzunWorkflow(request: Request, access: WattzunAccess, proposal: WattzunWorkflowOperation, requestId: string,
  deps: WattzunWorkflowDependencies = defaults): Promise<WattzunWorkflowResult> {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new WattzunWorkflowError(400, "Start a fresh action request.");
  const team = await currentTeam(request, access, deps); permissions(team, proposal);
  const reviewId = `wr_${(await hash([access.scope.scopeId, access.actorUid, requestId])).slice(0, 48)}`;
  const fingerprint = await hash(proposal);
  const previous = await access.db.prepare("SELECT id,admin_uid,entity_id,action,metadata FROM admin_audit_log WHERE id=?").bind(reviewId).first<Row>();
  if (previous) {
    const saved = metadata(previous);
    if (saved.fingerprint !== fingerprint) throw new WattzunWorkflowError(409, "This request was already prepared with different details. Start a new review.");
    return loadWattzunWorkflowReview(request, access, reviewId, deps);
  }
  const expiresAt = new Date(deps.now() + 15 * 60_000).toISOString();
  const prepared = await buildPrepared(request, access, team, proposal, reviewId, expiresAt, deps);
  const after = await currentTeam(request, access, deps);
  permissions(after, proposal);
  if (JSON.stringify(authority(after)) !== JSON.stringify(authority(team))) throw new WattzunWorkflowError(409, "Your permissions changed while preparing this action. Try again.");
  if ("state" in prepared) {
    if (proposal.kind !== "add_price_book_item") {
      const fresh = await buildPrepared(request, access, after, proposal, reviewId, expiresAt, deps);
      if (!("state" in fresh) || JSON.stringify(fresh) !== JSON.stringify(prepared)) throw new WattzunWorkflowError(409, "The matching jobs, invoices or customer access changed. Ask Wattzun to check again.");
      const finalTeam = await currentTeam(request, access, deps); permissions(finalTeam, proposal);
      if (JSON.stringify(authority(finalTeam)) !== JSON.stringify(authority(after))) throw new WattzunWorkflowError(409, "Your permissions changed before these choices could be shown. Try again.");
      if (fresh.state === "choose_job") {
        const finalJobs = await findJobs(access, finalTeam, proposal, deps);
        if (JSON.stringify(finalJobs.slice(0, 5).map(choice)) !== JSON.stringify(fresh.choices)) throw new WattzunWorkflowError(409, "The job choices changed before they could be shown. Ask Wattzun to check again.");
      } else if (proposal.kind === "invoice_reminder") {
        const final = await buildPrepared(request, access, finalTeam, proposal, reviewId, expiresAt, deps);
        if (!("state" in final) || JSON.stringify(final) !== JSON.stringify(fresh)) throw new WattzunWorkflowError(409, "The invoice choices changed before they could be shown. Ask Wattzun to check again.");
      }
    }
    return prepared;
  }
  const encrypted = await deps.encrypt({ prepared });
  const saved: ReviewMetadata = { fingerprint, expiresAt, kind: proposal.kind, sourceSha256: prepared.sourceSha256, encrypted, state: "prepared" };
  await access.db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
    VALUES (?,?,'wattzun.workflow_review','trade_business',?,'Prepared a user-reviewed Wattzun workflow.',?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(reviewId, access.actorUid, access.scope.scopeId, JSON.stringify(saved), new Date(deps.now()).toISOString()).run();
  const frozen = await readReview(access, reviewId, deps);
  if (frozen.saved.fingerprint !== fingerprint) throw new WattzunWorkflowError(409, "This review was prepared with different details. Start another review.");
  return loadWattzunWorkflowReview(request, access, reviewId, deps);
}
export async function loadWattzunWorkflowReview(request: Request, access: WattzunAccess, reviewId: string,
  deps: WattzunWorkflowDependencies = defaults): Promise<WattzunWorkflowResult> {
  const team = await currentTeam(request, access, deps); const frozen = await readReview(access, reviewId, deps);
  permissions(team, frozen.prepared.proposal);
  await verifyTarget(access, team, frozen.prepared, deps);
  const existingMessage = await journalledMessage(access, team, frozen.prepared, reviewId);
  if (existingMessage) return checkedComplete(request, access, frozen.prepared, existingMessage, deps);
  if (frozen.saved.state === "complete" && frozen.saved.receipt && Date.parse(frozen.saved.expiresAt) > deps.now()) return checkedComplete(request, access, frozen.prepared, frozen.saved.receipt, deps);
  if (Date.parse(frozen.saved.expiresAt) <= deps.now()) {
    const recovered = await recoverExpired(request, access, team, frozen.prepared, reviewId, deps);
    if (recovered) return checkedComplete(request, access, frozen.prepared, recovered, deps);
    throw new WattzunWorkflowError(409, "This expired review has no confirmed saved or sent result. Nothing new will be sent from it. Prepare a fresh review.");
  }
  if (frozen.saved.state !== "prepared") throw new WattzunWorkflowError(409, "This review has already been submitted. Check its result before preparing another action.");
  const fresh = await buildPrepared(request, access, team, frozen.prepared.proposal, reviewId, frozen.saved.expiresAt, deps);
  if ("state" in fresh || fresh.sourceSha256 !== frozen.saved.sourceSha256) throw new WattzunWorkflowError(409, "The job, invoice, recipient or connection changed. Prepare a fresh review.");
  const finalTeam = await currentTeam(request, access, deps); permissions(finalTeam, frozen.prepared.proposal);
  if (JSON.stringify(authority(finalTeam)) !== JSON.stringify(authority(team))) throw new WattzunWorkflowError(409, "Your permissions changed before the review could be shown. Prepare it again.");
  await verifyTarget(access, finalTeam, frozen.prepared, deps);
  return frozen.prepared.review;
}
async function checkedComplete(request: Request, access: WattzunAccess, prepared: Prepared, receipt: WattzunWorkflowReceipt, deps: WattzunWorkflowDependencies): Promise<WattzunWorkflowResult> {
  const team = await currentTeam(request, access, deps); permissions(team, prepared.proposal); await verifyTarget(access, team, prepared, deps);
  return { state: "complete", receipt };
}
async function verifyTarget(access: WattzunAccess, team: TeamAccess, prepared: Prepared, deps: WattzunWorkflowDependencies) {
  if (prepared.proposal.kind !== "add_price_book_item") {
    const jobs = await findJobs(access, team, prepared.proposal, deps);
    if (jobs.length !== 1 || jobs[0].id !== prepared.proposal.jobId) throw new WattzunWorkflowError(403, "This job is no longer available within your current permissions.");
  }
}
function messageReceipt(team: TeamAccess, prepared: Prepared, id: string, status: WattzunWorkflowReceipt["status"]): WattzunWorkflowReceipt {
  return { kind: prepared.proposal.kind, id, status, label: "Open job", href: href(team, "work", prepared.message!.job.id),
    message: status === "delivered" ? "The provider confirmed delivery." : status === "failed" ? "The provider did not deliver this message. Open Connect to check the failed send."
      : status === "unknown" ? "The send result is not confirmed. Check this same review or Connect before sending another copy."
        : "The provider accepted the message for sending. Delivery is not yet confirmed." };
}
async function journalledMessage(access: WattzunAccess, team: TeamAccess, prepared: Prepared, reviewId: string) {
  const message = prepared.message;
  if (!message) return null;
  const requestKey = `wattzun-${reviewId}`;
  if (message.channel === "sms") {
    const existing = await access.db.prepare("SELECT id,status,customer_id,work_order_id,actor_uid,body,purpose FROM trade_sms_messages WHERE firebase_uid=? AND request_id=? AND direction='outbound'")
      .bind(team.ownerUid, requestKey).first<Row>();
    if (!existing) return null;
    if (existing.customer_id !== message.job.customer_id || existing.work_order_id !== message.job.id || existing.actor_uid !== access.actorUid
      || existing.body !== prepared.review.preview?.body || existing.purpose !== "service") throw new WattzunWorkflowError(409, "The saved message differs from this review. Open Connect to check it.");
    const status = existing.status === "delivered" ? "delivered" : existing.status === "failed" ? "failed" : existing.status === "unknown" ? "unknown" : existing.status === "queued" ? "queued" : "submitted";
    return messageReceipt(team, prepared, String(existing.id), status);
  }
  const existing = await access.db.prepare("SELECT id,status,actor_uid,content_hash,provider_message_id,sender_email,recipient_email FROM trade_email_submissions WHERE owner_uid=? AND request_key=?")
    .bind(team.ownerUid, requestKey).first<Row>();
  if (!existing) return null;
  const contentHash = await hash({ recipient: message.recipient, subject: message.subject, body: message.body, html: "", attachments: [] });
  if (existing.actor_uid !== access.actorUid || existing.content_hash !== contentHash || existing.sender_email !== message.email?.from || existing.recipient_email !== message.recipient) {
    throw new WattzunWorkflowError(409, "The saved email differs from this review. Check the business mailbox before sending another copy.");
  }
  if (existing.status === "failed") return null; // The canonical service permits only its explicitly failed journal to retry.
  return messageReceipt(team, prepared, String(existing.provider_message_id || `submission:${existing.id}`), existing.status === "accepted" ? "submitted" : "unknown");
}
function priceReceipt(team: TeamAccess, prepared: Prepared, id: string): WattzunWorkflowReceipt {
  return { kind: prepared.proposal.kind, id, label: "Open price book", href: priceBookHref(team), status: "saved", message: "The item is saved in your business price book." };
}
async function recoverExpired(request: Request, access: WattzunAccess, team: TeamAccess, prepared: Prepared, reviewId: string, deps: WattzunWorkflowDependencies) {
  if (prepared.quote) {
    const found = await deps.executeQuote(scopedRequest(request, access.scope.scopeId), { scopeId: access.scope.scopeId, actorUid: access.actorUid,
      prepared: prepared.quote, expectedSourceSha256: prepared.sourceSha256, allowSave: false });
    return { kind: prepared.proposal.kind, id: found.id, label: found.label, href: found.href, status: "saved", message: "The matching quote draft is already saved. Nothing new was saved or sent." } satisfies WattzunWorkflowReceipt;
  }
  if (!prepared.price) return null;
  const id = `price-book-request-${(await hash([access.scope.scopeId, access.actorUid, `wattzun-${reviewId}`])).slice(0, 48)}`;
  const row = await access.db.prepare("SELECT * FROM trade_price_book_items WHERE id=? AND firebase_uid=?").bind(id, access.scope.scopeId).first<Row>();
  if (!row || row.record_status !== "active" || Number(row.price_revision) !== 1 || row.created_by_uid !== access.actorUid
    || row.coverage_m2_per_unit_milli != null || String(row.solar_panel_json || "null") !== "null") return null;
  try {
    const input = normalisePriceBookInput({ name: row.name, description: row.description, itemType: row.item_type, category: String(row.category || ""), unitLabel: row.unit_label,
      supplierCost: (Number(row.supplier_cost_cents_ex_gst) / 100).toFixed(2), sellPrice: (Number(row.sell_price_cents_ex_gst) / 100).toFixed(2),
      taxCode: row.tax_code, expectedDurationMinutes: row.expected_duration_minutes, requiredSkill: row.required_skill,
      supplierName: row.supplier_name, supplierSku: row.supplier_sku, supplierProductId: row.supplier_product_id }, clean);
    if (JSON.stringify(input) !== JSON.stringify(prepared.price.input)) return null;
  } catch { return null; }
  return priceReceipt(team, prepared, id);
}
async function sendPrepared(request: Request, access: WattzunAccess, team: TeamAccess, prepared: Prepared, reviewId: string, deps: WattzunWorkflowDependencies) {
  const requestKey = `wattzun-${reviewId}`;
  if (prepared.quote) {
    const result = await deps.executeQuote(scopedRequest(request, access.scope.scopeId), { scopeId: access.scope.scopeId, actorUid: access.actorUid,
      prepared: prepared.quote, expectedSourceSha256: prepared.sourceSha256 });
    return { kind: prepared.proposal.kind, id: result.id, label: result.label, href: result.href, status: "saved", message: "The draft is saved in the real quote editor. It has not been sent or accepted." } satisfies WattzunWorkflowReceipt;
  }
  if (prepared.price) {
    const response = await deps.priceBook(scopedRequest(request, access.scope.scopeId, "/api/trade-price-book", { ...prepared.price.payload, clientRequestId: requestKey }));
    const body: unknown = await response.json();
    if (!response.ok || !record(body) || body.ok !== true || !record(body.item) || typeof body.item.id !== "string") {
      throw new WattzunWorkflowError(response.status >= 400 ? response.status : 503, record(body) && typeof body.error === "string" ? body.error : "The price-book save could not be confirmed. Retry this same review.");
    }
    return priceReceipt(team, prepared, body.item.id);
  }
  const message = prepared.message;
  if (!message) throw new WattzunWorkflowError(503, "This reviewed action could not be read.");
  const beforeSend = async () => {
    const current = await currentTeam(request, access, deps); permissions(current, prepared.proposal);
    const fresh = await buildPrepared(request, access, current, prepared.proposal, reviewId, prepared.review.expiresAt, deps);
    if ("state" in fresh || fresh.sourceSha256 !== prepared.sourceSha256) throw new WattzunWorkflowError(409, "The reviewed customer, invoice or sending account changed. Nothing further was sent.");
  };
  if (message.channel === "sms") {
    const sent = await deps.sms(team, message.job.customer_id, message.body, requestKey, message.job.id, access.db, undefined, { purpose: "service", expectedPhone: message.recipient, beforeSend });
    const status = sent.status === "delivered" ? "delivered" : sent.status === "failed" ? "failed" : sent.status === "unknown" ? "unknown" : sent.status === "queued" ? "queued" : "submitted";
    return messageReceipt(team, prepared, sent.id, status);
  }
  const sent = await deps.email(team.ownerUid, team.actorUid, { channel: "email", recipient: message.recipient, subject: message.subject, body: message.body,
    idempotencyKey: requestKey, callbackUrl: "", messageType: "trade_customer_email" }, { db: access.db, requireConnection: true, beforeSend });
  return messageReceipt(team, prepared, sent.providerMessageId, "submitted");
}
async function execute(request: Request, access: WattzunAccess, reviewId: string, deps: WattzunWorkflowDependencies): Promise<WattzunWorkflowResult> {
  const team = await currentTeam(request, access, deps); const frozen = await readReview(access, reviewId, deps);
  permissions(team, frozen.prepared.proposal);
  await verifyTarget(access, team, frozen.prepared, deps);
  const existingMessage = await journalledMessage(access, team, frozen.prepared, reviewId);
  if (existingMessage) return { state: "complete", receipt: existingMessage };
  if (frozen.saved.state === "complete" && frozen.saved.receipt && Date.parse(frozen.saved.expiresAt) > deps.now()) return { state: "complete", receipt: frozen.saved.receipt };
  if (Date.parse(frozen.saved.expiresAt) <= deps.now()) {
    const recovered = await recoverExpired(request, access, team, frozen.prepared, reviewId, deps);
    if (recovered) return { state: "complete", receipt: recovered };
    throw new WattzunWorkflowError(409, "This expired review has no confirmed saved or sent result. Nothing new will be sent from it. Prepare a fresh review.");
  }
  // Message services journal their own request IDs; quote saves reconcile their
  // exact frozen target; price-book creation uses the same deterministic key.
  // On retry they never manufacture a new send or append the same quote twice.
  if (!frozen.prepared.quote) {
    const fresh = await buildPrepared(request, access, team, frozen.prepared.proposal, reviewId, frozen.saved.expiresAt, deps);
    if ("state" in fresh || fresh.sourceSha256 !== frozen.saved.sourceSha256) throw new WattzunWorkflowError(409, "The job, invoice, recipient or connection changed. Prepare a fresh review.");
  }
  if (frozen.saved.state === "prepared") {
    const changed = await access.db.prepare("UPDATE admin_audit_log SET metadata=? WHERE id=? AND admin_uid=? AND entity_id=? AND metadata=?")
      .bind(JSON.stringify({ ...frozen.saved, state: "executing" }), reviewId, access.actorUid, access.scope.scopeId, String(frozen.row.metadata)).run();
    if (changed.meta.changes !== 1) throw new WattzunWorkflowError(409, "This review is already being processed. Check the same review again.");
  }
  const current = await currentTeam(request, access, deps); permissions(current, frozen.prepared.proposal);
  let receipt: WattzunWorkflowReceipt;
  try { receipt = await sendPrepared(request, access, current, frozen.prepared, reviewId, deps); }
  catch (error) {
    if (!(error instanceof ReminderProviderDeliveryError) || !frozen.prepared.message) throw error;
    receipt = messageReceipt(current, frozen.prepared, reviewId, error.outcome === "indeterminate" ? "unknown" : "failed");
  }
  await access.db.prepare("UPDATE admin_audit_log SET metadata=? WHERE id=? AND admin_uid=? AND entity_id=? AND json_extract(metadata,'$.state')='executing'")
    .bind(JSON.stringify({ ...frozen.saved, state: receipt.status === "unknown" ? "executing" : "complete", receipt }), reviewId, access.actorUid, access.scope.scopeId).run();
  await currentTeam(request, access, deps);
  return { state: "complete", receipt };
}
export async function postWattzunWorkflow(request: Request, deps: WattzunWorkflowDependencies = defaults): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the reviewed workflow as JSON." }, 415);
  try {
    await deps.authenticate(request); const raw = await readBoundedJsonRequest(request, 40_000);
    if (!record(raw) || raw.portal !== "trade" || typeof raw.scopeId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(raw.scopeId)
      || typeof raw.requestId !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(raw.requestId)) throw new WattzunWorkflowError(400, "Choose a current TLink business and action request.");
    const access = await deps.access(request, "trade", raw.scopeId);
    let result: WattzunWorkflowResult;
    if (raw.stage === "prepare" && Object.keys(raw).length === 5) {
      let proposal: WattzunWorkflowProposal;
      try { proposal = parseWattzunWorkflowProposal(raw.proposal); } catch { throw new WattzunWorkflowError(400, "The workflow proposal could not be read. Ask Wattzun to prepare it again."); }
      if (proposal.kind === "confirm_workflow") throw new WattzunWorkflowError(400, "Confirm the visible review before executing it.");
      result = await prepareWattzunWorkflow(request, access, proposal, raw.requestId, deps);
    } else if (raw.stage === "execute" && Object.keys(raw).length === 6 && raw.reviewed === true && typeof raw.reviewId === "string") {
      result = await execute(request, access, raw.reviewId, deps);
      const finalTeam = await currentTeam(request, access, deps); const currentReview = await readReview(access, raw.reviewId, deps);
      permissions(finalTeam, currentReview.prepared.proposal); await verifyTarget(access, finalTeam, currentReview.prepared, deps);
    } else throw new WattzunWorkflowError(400, "Prepare the action, then confirm its current review before executing.");
    if (!isWattzunWorkflowResult(result)) throw new WattzunWorkflowError(503, "The action result could not be verified. Check the same review before starting another action.");
    return json({ ok: true, result });
  } catch (error) {
    const failure = wattzunAccessFailure(error);
    if (failure) return json({ ok: false, error: failure.message }, failure.status);
    if (error instanceof WattzunWorkflowError || error instanceof BoundedJsonRequestError || error instanceof WattzunExistingQuoteError) return json({ ok: false, error: error.message }, error.status);
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("INVALID_PRICE_BOOK") || code === "INVALID_MONEY" || code === "INVALID_DECIMAL") return json({ ok: false, error: "Check the item type, unit, cost, selling price and GST treatment." }, 400);
    if (code === "SMS_BODY_INVALID") return json({ ok: false, error: "Keep the text and invoice reminder together within 480 characters." }, 400);
    if (code.startsWith("SMS_") || code.startsWith("EMAIL_")) return json({ ok: false, error: "The business messaging setup or customer permission changed. Check Connect before retrying this same review." }, 409);
    return json({ ok: false, error: "This action could not be confirmed. Retry the same review before starting another action." }, 503);
  }
}
