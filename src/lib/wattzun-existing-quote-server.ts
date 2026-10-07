import type { WattzunActionReceipt } from "./wattzun-actions.ts";
import type { WattzunWorkflowOperation } from "./wattzun-workflow.ts";
import type { TeamAccess } from "./trade-team-server.ts";
import { normaliseTradeQuoteLineGroup, overallTradeQuoteDiscountKind, persistedOverallDiscountUnitPrice } from "./trade-quote.ts";
import { normaliseQuoteEquipment, type QuoteEquipment } from "./trade-quote-equipment.ts";

export type WattzunExistingQuoteProposal = Extract<WattzunWorkflowOperation, { kind: "draft_job_quote" }>;
export type WattzunExistingQuoteLine = {
  lineType: "product" | "labour" | "adjustment"; description: string; quantity: string;
  unitPrice: string; taxCode: "gst" | "none"; sectionHeading: string;
  priceBookItemId: string; jobPacketId: string; jobPacketLineId: string;
};
type SavedLine = WattzunExistingQuoteLine & { quantityMilli: number; unitPriceCents: number; totalCents: number; priceBookItemType: string; jobPacketRevision: number; unitCostCentsExGst: number | null; marginBasisPoints: number | null };
type Choice = { clientKey: string; kind: "package" | "addon" | "choose_one"; groupKey: string; name: string; summary: string; recommended: boolean; lines: WattzunExistingQuoteLine[] };
type Version = {
  id: string; updatedAt: string; status: string; customerEmail: string; terms: string;
  customerMessage: string; validUntil: string; equipment: QuoteEquipment; designId: string;
  roofImageSha256: string | null; lines: SavedLine[]; choices: Choice[]; choiceSavedLines: SavedLine[];
};
export type WattzunExistingQuoteSavePayload = {
  action: "save_draft"; workOrderId: string; expectedVersionId: string; expectedUpdatedAt: string;
  lines: WattzunExistingQuoteLine[]; choices: Choice[]; customerEmail: string; terms: string;
  customerMessage: string; validUntil: string; equipment: QuoteEquipment; designId: string;
};
export type WattzunExistingQuotePrepared = {
  sourceSha256: string; authoritySha256: string;
  job: { id: string; workNumber: string; customerName: string; siteSummary: string };
  original: { quoteId: string; versionId: string; updatedAt: string; roofImageSha256: string | null };
  savePayload: WattzunExistingQuoteSavePayload;
  review: { title: string; summary: string; fields: Array<{ label: string; value: string }> };
};
export type WattzunExistingQuoteDependencies = {
  team: (request: Request) => Promise<TeamAccess>;
  getQuote: (request: Request) => Promise<Response>;
  saveQuote: (request: Request) => Promise<Response>;
};
const defaults: WattzunExistingQuoteDependencies = {
  team: async request => (await import("./trade-team-server.ts")).requireInstallerTeamAccess(request),
  getQuote: async request => (await import("@/app/api/trade-quotes/route")).GET(request),
  saveQuote: async request => (await import("@/app/api/trade-quotes/route")).POST(request),
};
export class WattzunExistingQuoteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
type Row = Record<string, unknown>;
function record(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, max = 4000): string {
  if (typeof value !== "string" || value.length > max) throw new WattzunExistingQuoteError(503, "The saved quote could not be read. Open its quote editor before continuing.");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new WattzunExistingQuoteError(503, "The saved quote amounts could not be read.");
  return value;
}
function rows(value: unknown, maximum: number): Row[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every(record)) throw new WattzunExistingQuoteError(503, "The saved quote is too large or could not be read. Open its quote editor.");
  return value;
}
function line(value: Row): SavedLine {
  const lineType = value.lineType; const taxCode = value.taxCode;
  if (!(lineType === "product" || lineType === "labour" || lineType === "adjustment") || !(taxCode === "gst" || taxCode === "none")) throw new WattzunExistingQuoteError(503, "A saved quote line could not be read.");
  const quantityMilli = integer(value.quantityMilli); const unitPriceCents = integer(value.unitPriceCents); const totalCents = integer(value.totalCents);
  const sectionHeading = text(value.sectionHeading, 120);
  return { lineType, taxCode, description: text(value.description, 500), sectionHeading,
    quantityMilli, unitPriceCents, totalCents, quantity: String(quantityMilli / 1000),
    unitPrice: persistedOverallDiscountUnitPrice({ sectionHeading, unitPriceCents, totalCents }),
    priceBookItemId: text(value.priceBookItemId, 180), jobPacketId: text(value.jobPacketId, 180),
    jobPacketLineId: text(value.jobPacketLineId, 180), jobPacketRevision: integer(value.jobPacketRevision),
    priceBookItemType: text(value.priceBookItemType, 40),
    unitCostCentsExGst: value.unitCostCentsExGst === undefined ? null : integer(value.unitCostCentsExGst),
    marginBasisPoints: value.marginBasisPoints === undefined ? null : integer(value.marginBasisPoints) };
}
function saveLine(value: SavedLine): WattzunExistingQuoteLine {
  return { lineType: value.lineType, description: value.description, quantity: value.quantity,
    unitPrice: overallTradeQuoteDiscountKind(value) === "percent" ? "0.00" : value.unitPrice,
    taxCode: value.taxCode, sectionHeading: value.sectionHeading, priceBookItemId: value.priceBookItemId,
    jobPacketId: value.jobPacketId, jobPacketLineId: value.jobPacketLineId };
}
function version(value: Row): Version {
  const choiceSavedLines: SavedLine[] = [];
  const choices: Choice[] = rows(value.choices, 20).map(choice => {
    if (!(choice.kind === "package" || choice.kind === "addon" || choice.kind === "choose_one") || typeof choice.recommended !== "boolean") throw new WattzunExistingQuoteError(503, "A saved quote choice could not be read.");
    const saved = rows(choice.items, 100).map(line); choiceSavedLines.push(...saved);
    return { clientKey: text(choice.clientKey, 64), kind: choice.kind, groupKey: text(choice.groupKey, 64),
      name: text(choice.name, 120), summary: text(choice.summary, 500), recommended: choice.recommended, lines: saved.map(saveLine) };
  });
  if (value.roofImage !== null && value.roofImage !== undefined && !record(value.roofImage)) throw new WattzunExistingQuoteError(503, "The saved roof image could not be read.");
  return { id: text(value.id, 180), updatedAt: text(value.updatedAt, 40), status: text(value.status, 40),
    customerEmail: text(value.customerEmail, 180), terms: text(value.terms), customerMessage: text(value.customerMessage, 1200),
    validUntil: text(value.validUntil, 10), equipment: normaliseQuoteEquipment(value.equipment), designId: text(value.designId, 180),
    roofImageSha256: record(value.roofImage) ? text(value.roofImage.sha256, 64) : null,
    lines: rows(value.items, 100).map(line), choices, choiceSavedLines };
}
function scopedRequest(request: Request, scopeId: string, jobId: string, payload?: WattzunExistingQuoteSavePayload): Request {
  const headers = new Headers(request.headers);
  headers.set("X-TLink-Business", scopeId); headers.delete("Content-Length"); headers.delete("Content-Type");
  if (payload) headers.set("Content-Type", "application/json");
  return new Request(new URL(`/api/trade-quotes${payload ? "" : `?workOrderId=${encodeURIComponent(jobId)}`}`, request.url), {
    headers, method: payload ? "POST" : "GET", ...(payload ? { body: JSON.stringify(payload) } : {}), signal: request.signal,
  });
}
async function result(response: Response): Promise<Row> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new WattzunExistingQuoteError(503, "TLink could not confirm the quote. Retry this same review to check the saved result."); }
  if (!response.ok || !record(body) || body.ok !== true) throw new WattzunExistingQuoteError(response.status >= 400 ? response.status : 503,
    record(body) && typeof body.error === "string" ? body.error : "TLink could not confirm the quote. Retry this same review.");
  return body;
}
async function hash(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Reuses the quote service's authority projection with a freshly verified team. */
export async function wattzunExistingQuoteAuthoritySha256(team: TeamAccess, input: { scopeId: string; actorUid: string }): Promise<string> {
  const { scopeId, actorUid } = input;
  if (team.ownerUid !== scopeId || team.actorUid !== actorUid || !(team.isOwner || team.canViewQuotes) || !(team.isOwner || team.canManageQuotes)) throw new WattzunExistingQuoteError(403, "Current permission to view and manage this job's quotes is required.");
  return hash({ ownerUid: team.ownerUid, actorUid: team.actorUid, memberId: team.memberId, isOwner: team.isOwner,
    jobScope: team.jobScope, crewId: team.crewId || "", crewLead: Boolean(team.crewLead), crewMemberIds: team.crewMemberIds || [],
    canViewQuotes: team.canViewQuotes, canManageQuotes: team.canManageQuotes, canViewPriceBook: team.canViewPriceBook, canApplyDiscounts: team.canApplyDiscounts });
}
async function authority(request: Request, scopeId: string, actorUid: string, jobId: string, deps: WattzunExistingQuoteDependencies) {
  if (request.signal.aborted) throw new WattzunExistingQuoteError(409, "This quote review was closed. Review it again.");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(scopeId) || !/^[A-Za-z0-9:_-]{1,180}$/.test(jobId)) throw new WattzunExistingQuoteError(400, "Choose an exact saved job before preparing its quote.");
  const team = await deps.team(scopedRequest(request, scopeId, jobId));
  const fingerprint = await wattzunExistingQuoteAuthoritySha256(team, { scopeId, actorUid });
  return { team, fingerprint };
}
function libraryProjection(payload: Row, saved: SavedLine[]): Row[] {
  const projected: Row[] = [];
  const itemIds = new Set(saved.map(item => item.priceBookItemId).filter(Boolean));
  const packetIds = new Set(saved.map(item => item.jobPacketId).filter(Boolean));
  const items = itemIds.size ? rows(payload.priceBookItems, 5000) : [];
  const packets = packetIds.size ? rows(payload.jobPackets, 200) : [];
  for (const savedLine of saved) {
    if (savedLine.priceBookItemId) {
      const item = items.find(candidate => candidate.id === savedLine.priceBookItemId);
      if (!item || item.lineType !== savedLine.lineType || (item.description || item.name) !== savedLine.description
        || item.itemType !== savedLine.priceBookItemType || item.sellPriceCentsExGst !== savedLine.unitPriceCents || item.taxCode !== savedLine.taxCode
        || item.unitCostCentsExGst !== savedLine.unitCostCentsExGst || item.marginBasisPoints !== savedLine.marginBasisPoints) throw new WattzunExistingQuoteError(409, "A saved price book item has changed. Open this quote to review its existing prices before Wattzun edits it.");
      if (!projected.some(entry => entry.itemId === item.id)) projected.push({ itemId: item.id, lineType: item.lineType,
        description: item.description || item.name, price: item.sellPriceCentsExGst, taxCode: item.taxCode, cost: item.unitCostCentsExGst, margin: item.marginBasisPoints });
    }
    if (savedLine.jobPacketId || savedLine.jobPacketLineId) {
      const packet = packets.find(candidate => candidate.id === savedLine.jobPacketId);
      const packetLine = packet && rows(packet.lines, 100).find(candidate => candidate.id === savedLine.jobPacketLineId);
      if (!packet || packet.revision !== savedLine.jobPacketRevision || !packetLine || packetLine.priceBookItemId !== savedLine.priceBookItemId) throw new WattzunExistingQuoteError(409, "This quote's saved job packet has changed. Open the quote to review it before Wattzun edits it.");
      projected.push({ packetId: packet.id, revision: packet.revision, packetLineId: packetLine.id, priceBookItemId: packetLine.priceBookItemId });
    }
  }
  return projected;
}
async function load(request: Request, input: { scopeId: string; actorUid: string; jobId: string }, deps: WattzunExistingQuoteDependencies) {
  const before = await authority(request, input.scopeId, input.actorUid, input.jobId, deps);
  // The existing service performs exact current job assignment and public-lead consent checks.
  const payload = await result(await deps.getQuote(scopedRequest(request, input.scopeId, input.jobId)));
  if (!record(payload.job) || !record(payload.access) || payload.access.canManageQuotes !== true) throw new WattzunExistingQuoteError(403, "This job's quote is no longer available for editing.");
  const job = { id: input.jobId, workNumber: text(payload.job.workNumber, 100), customerName: text(payload.job.customerName, 240), siteSummary: text(payload.job.siteSummary, 500) };
  let quoteId = ""; let current: Version | null = null;
  if (payload.quote !== null) {
    if (!record(payload.quote) || payload.quote.workOrderId !== input.jobId || payload.quote.customerId !== payload.job.customerId) throw new WattzunExistingQuoteError(409, "The quote no longer belongs to the selected job and customer.");
    if (payload.quote.status !== "draft") throw new WattzunExistingQuoteError(409, "This quote has already been issued or decided. Open its quote editor to explicitly start a revision.");
    quoteId = text(payload.quote.id, 180);
    if (!record(payload.quote.editableDraft)) throw new WattzunExistingQuoteError(409, "This quote has no editable draft. Open its quote editor.");
    // Keep the revision chosen by the authoritative service, rather than choosing any historical draft.
    const draftId = text(payload.quote.editableDraft.id, 180);
    const selected = rows(payload.quote.versions, 100).find(candidate => candidate.id === draftId);
    if (!selected) throw new WattzunExistingQuoteError(503, "The current quote draft could not be read.");
    current = version(selected);
    if (current.status !== "draft" || current.updatedAt !== payload.quote.editableDraft.updatedAt) throw new WattzunExistingQuoteError(409, "This quote draft changed. Review it again.");
  }
  const library = current ? libraryProjection(payload, [...current.lines, ...current.choiceSavedLines]) : [];
  const after = await authority(request, input.scopeId, input.actorUid, input.jobId, deps);
  if (before.fingerprint !== after.fingerprint) throw new WattzunExistingQuoteError(403, "Your job or quote permissions changed. Review this quote again.");
  const business = record(payload.business) ? { terms: text(payload.business.quoteDefaultTerms), message: text(payload.business.quoteEmailIntro, 1200) } : { terms: "", message: "" };
  const authorisedEmails = Array.isArray(payload.authorisedEmails) && payload.authorisedEmails.every(value => typeof value === "string") ? payload.authorisedEmails : [];
  const sourceSha256 = await hash({ job, customerId: payload.job.customerId, publicLead: payload.job.publicLead, quoteId, current, library,
    business, authorisedEmails, authority: after.fingerprint });
  return { job, quoteId, current, business, authorisedEmails, sourceSha256, authoritySha256: after.fingerprint, team: after.team };
}
function suppliedLines(proposal: WattzunExistingQuoteProposal): WattzunExistingQuoteLine[] {
  if (!Array.isArray(proposal.lines) || !proposal.lines.length || proposal.lines.length > 30) throw new WattzunExistingQuoteError(400, "What line items should I include in this quote, with quantity, unit price before GST and GST treatment?");
  const missing = proposal.lines.flatMap((item, index) => {
    const fields = [!item.description.trim() && "description", !(item.quantity || "").trim() && "quantity", !(item.unitPrice || "").trim() && "unit price before GST", item.taxCode === null && "GST treatment"].filter(Boolean);
    return fields.length ? [`line ${index + 1}: ${fields.join(", ")}`] : [];
  });
  if (missing.length) throw new WattzunExistingQuoteError(400, `Please confirm ${missing.join("; ")} before I prepare the quote.`);
  const lines = proposal.lines.map(item => {
    if (item.taxCode === null || item.quantity === null || item.unitPrice === null) throw new WattzunExistingQuoteError(400, "Confirm quantity, price before GST and GST treatment for every line.");
    return { lineType: item.lineType, description: item.description.trim(), quantity: item.quantity.trim(), unitPrice: item.unitPrice.trim(),
      taxCode: item.taxCode, sectionHeading: "Included work", priceBookItemId: "", jobPacketId: "", jobPacketLineId: "" };
  });
  try {
    const calculated = normaliseTradeQuoteLineGroup(lines, value => String(value || "").trim());
    return lines.map((item, index) => ({ ...item, quantity: String(calculated.lines[index].quantityMilli / 1000), unitPrice: (calculated.lines[index].unitPriceCents / 100).toFixed(2) }));
  }
  catch { throw new WattzunExistingQuoteError(400, "Check each quote line's quantity, price before GST and GST treatment. The quote total must be greater than zero."); }
}
export async function prepareWattzunExistingQuote(request: Request, input: { scopeId: string; actorUid: string; proposal: WattzunExistingQuoteProposal }, deps: WattzunExistingQuoteDependencies = defaults): Promise<WattzunExistingQuotePrepared> {
  if (!(input.proposal.mode === "append" || input.proposal.mode === "replace")) throw new WattzunExistingQuoteError(400, "Should I add these lines to the quote or replace its included items?");
  const additions = suppliedLines(input.proposal);
  const loaded = await load(request, { ...input, jobId: input.proposal.jobId }, deps);
  const savedLines = loaded.current?.lines || [];
  const retained = input.proposal.mode === "append" ? savedLines : savedLines.filter(item => item.lineType === "adjustment" || item.unitPriceCents < 0 || ["discount", "rebate"].includes(item.priceBookItemType) || overallTradeQuoteDiscountKind(item));
  const lines = retained.map(saveLine); const finalPercentIndex = lines.findIndex(item => overallTradeQuoteDiscountKind(item) === "percent");
  lines.splice(finalPercentIndex < 0 ? lines.length : finalPercentIndex, 0, ...additions);
  const choices = loaded.current?.choices || [];
  let calculated;
  try { calculated = normaliseTradeQuoteLineGroup(lines, value => String(value || "").trim(), choices.length > 0); }
  catch { throw new WattzunExistingQuoteError(400, "The proposed quote lines and retained discounts need review in the quote editor."); }
  const canonicalLines = lines.map((item, index) => ({ ...item, taxCode: calculated.lines[index].taxCode,
    quantity: String(calculated.lines[index].quantityMilli / 1000),
    unitPrice: overallTradeQuoteDiscountKind(item) === "percent" ? "0.00" : overallTradeQuoteDiscountKind(item) === "fixed"
      ? (Math.abs(calculated.lines[index].totalCents) / 100).toFixed(2) : (calculated.lines[index].unitPriceCents / 100).toFixed(2) }));
  const savePayload: WattzunExistingQuoteSavePayload = { action: "save_draft", workOrderId: loaded.job.id,
    expectedVersionId: loaded.current?.id || "", expectedUpdatedAt: loaded.current?.updatedAt || "", lines: canonicalLines, choices,
    customerEmail: loaded.current ? loaded.current.customerEmail : loaded.authorisedEmails[0] || "",
    terms: loaded.current ? loaded.current.terms : loaded.business.terms, customerMessage: loaded.current ? loaded.current.customerMessage : loaded.business.message,
    validUntil: loaded.current?.validUntil || "", equipment: loaded.current?.equipment || { common: [], choices: [] }, designId: loaded.current?.designId || "" };
  const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
  return { sourceSha256: loaded.sourceSha256, authoritySha256: loaded.authoritySha256, job: loaded.job,
    original: { quoteId: loaded.quoteId, versionId: savePayload.expectedVersionId, updatedAt: savePayload.expectedUpdatedAt, roofImageSha256: loaded.current?.roofImageSha256 || null }, savePayload,
    review: { title: `Quote draft for ${loaded.job.workNumber}`, summary: `${input.proposal.mode === "append" ? "Add" : "Replace included items with"} ${additions.length} supplied line${additions.length === 1 ? "" : "s"}. Saved choices, discounts, terms and quote settings are retained.`,
      fields: [{ label: "Customer", value: loaded.job.customerName }, { label: "Job site", value: loaded.job.siteSummary },
        ...(input.proposal.description.trim() ? [{ label: "Requested brief", value: `${input.proposal.description.trim()} (job scope is unchanged)` }] : []),
        { label: "Included quote total", value: `${money(calculated.subtotalCents)} ex GST; ${money(calculated.totalCents)} incl GST` },
        ...additions.map((item, index) => ({ label: `New line ${index + 1}`, value: `${item.description}: ${item.quantity} × $${item.unitPrice} ex GST (${item.taxCode === "gst" ? "GST 10%" : "No GST"})` })),
        { label: "Save result", value: "Save a draft into this existing job's real quote editor. No quote is issued or sent." }] } };
}
function matchesSavedTarget(loaded: Awaited<ReturnType<typeof load>>, prepared: WattzunExistingQuotePrepared): boolean {
  if (!loaded.current || (prepared.original.quoteId && prepared.original.quoteId !== loaded.quoteId)
    || (prepared.original.versionId && prepared.original.versionId !== loaded.current.id)
    || loaded.current.roofImageSha256 !== prepared.original.roofImageSha256) return false;
  const target = prepared.savePayload;
  return JSON.stringify({ lines: loaded.current.lines.map(saveLine), choices: loaded.current.choices,
    customerEmail: loaded.current.customerEmail, terms: loaded.current.terms, customerMessage: loaded.current.customerMessage,
    validUntil: loaded.current.validUntil, equipment: loaded.current.equipment, designId: loaded.current.designId })
    === JSON.stringify({ lines: target.lines, choices: target.choices, customerEmail: target.customerEmail,
      terms: target.terms, customerMessage: target.customerMessage, validUntil: target.validUntil, equipment: target.equipment, designId: target.designId });
}
function receipt(loaded: Awaited<ReturnType<typeof load>>): WattzunActionReceipt {
  if (!loaded.current || !loaded.quoteId) throw new WattzunExistingQuoteError(503, "The saved quote receipt could not be confirmed. Retry this same review.");
  return { kind: "quote_draft", id: loaded.quoteId, workOrderId: loaded.job.id, versionId: loaded.current.id,
    href: `/direct-trade/${loaded.team.isOwner ? "dashboard" : "team"}?workspace=work&jobId=${encodeURIComponent(loaded.job.id)}&jobTab=quote`, label: "Open saved quote draft" };
}
/** `prepared` is the server's frozen review, never a browser-supplied save payload. */
export async function executeWattzunExistingQuote(request: Request, input: { scopeId: string; actorUid: string; prepared: WattzunExistingQuotePrepared; expectedSourceSha256: string; allowSave?: boolean }, deps: WattzunExistingQuoteDependencies = defaults): Promise<WattzunActionReceipt> {
  const { prepared } = input;
  if (input.expectedSourceSha256 !== prepared.sourceSha256 || prepared.job.id !== prepared.savePayload.workOrderId) throw new WattzunExistingQuoteError(409, "This quote review changed. Prepare a fresh review.");
  let loaded = await load(request, { ...input, jobId: prepared.job.id }, deps);
  if (loaded.authoritySha256 !== prepared.authoritySha256) throw new WattzunExistingQuoteError(403, "Your quote permissions changed. Review the quote again.");
  if (input.allowSave === false) {
    if (matchesSavedTarget(loaded, prepared)) return receipt(loaded);
    throw new WattzunExistingQuoteError(409, "This review expired and its saved result is not confirmed. Check the quote editor before preparing another change.");
  }
  if (loaded.sourceSha256 !== prepared.sourceSha256) {
    if (matchesSavedTarget(loaded, prepared)) return receipt(loaded);
    throw new WattzunExistingQuoteError(409, "This job, quote or saved pricing changed. Review a fresh quote draft before saving.");
  }
  // Save exactly the frozen full draft, never re-append to a potentially saved result.
  await result(await deps.saveQuote(scopedRequest(request, input.scopeId, prepared.job.id, prepared.savePayload)));
  loaded = await load(request, { ...input, jobId: prepared.job.id }, deps);
  if (loaded.authoritySha256 !== prepared.authoritySha256) throw new WattzunExistingQuoteError(403, "Your quote permissions changed. The saved result needs a fresh authorised review.");
  if (!matchesSavedTarget(loaded, prepared)) throw new WattzunExistingQuoteError(409, "The saved quote differs from this review. Open the job's quote editor before making further changes.");
  return receipt(loaded);
}
