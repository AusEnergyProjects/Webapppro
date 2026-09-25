import { strToU8, zipSync, type Zippable } from "fflate";
import { ensureCreditexJobLifecycleSchemaGuards } from "./creditex-job-lifecycle-schema-guards";
import { creditexCanonicalSha256 } from "./creditex-interchange-preflight";
import { downloadRegistryExport } from "./creditex-registry-exports";
import { listRegistryFormats } from "./creditex-registry-formats";
import { loadCreditexOutputAction, loadCreditexOutputDispatchIntent, recheckOutputDispatchEvidence,
  recordManualCreditexOutputSubmission } from "./creditex-output-action-server";
import { CreditexRegistryError, registryCapabilities, requireRegistryAccount, requireRegistryClaimBinding,
  persistRegistryEvidence, downloadRegistryEvidence, type RegistryActor, type RegistryOptions } from "./creditex-registry-server";
import { REGISTRY_SCHEMES, REGISTRY_SCHEME_KEYS, registrySchemeForProgram, type RegistryAccount, type RegistrySchemeKey } from "./creditex-registry";
import { creditexIntentCompletionSnapshotSql } from "./creditex-job-lifecycle-sql";

const MAX_BATCH_PACKETS = 3000;
const MAX_LODGEMENT_PACKETS = 20;
type Packet = Awaited<ReturnType<typeof loadCreditexOutputAction>>;
export type RegistryReadyGroup = Readonly<{
  key: string; scheme: RegistrySchemeKey; accountId: string; accountName: string;
  kind: "official_upload" | "provider_handover"; formatKey: string; formatLabel: string;
  baseVintage: string; exportId: string; packetIds: readonly string[]; jobReferences: readonly string[]; quantity: string; unit: string;
}>;
export type RegistryBatchItem = Readonly<{
  packetId: string; accountId: string; scheme: RegistrySchemeKey; jobReference: string; status: string; providerReference: string;
}>;
export type RegistryBatchSummary = Readonly<{
  id: string; createdAt: string; createdByUid: string; packetCount: number; submittedCount: number;
  groups: readonly RegistryReadyGroup[]; items: readonly RegistryBatchItem[];
}>;
export type RegistryBatchWorkspace = Readonly<{
  readyGroups: readonly RegistryReadyGroup[];
  blockedClaims: readonly Readonly<{ packetId: string; jobReference: string; scheme: RegistrySchemeKey; reason: string; code: string }>[];
  batches: readonly RegistryBatchSummary[]; capabilities: Readonly<{ canOperate: boolean }>;
}>;
export type RegistryBatchLodgementOutcome = Readonly<{
  batchId: string; submittedCount: number; failedCount: number; remainingCount: number;
  results: readonly Readonly<{ packetId: string; status: "submitted" | "already_submitted" | "failed"; providerReference: string; code?: string; error?: string }>[];
}>;
type ExportRow = { id: string; account_id: string; format_key: string; base_vintage: string; packet_ids: string; packet_hashes: string; account_version: number; format_sha256: string };
type BatchRow = { id: string; request_sha256: string; evidence_id: string; manifest_snapshot: string; manifest_sha256: string; created_by_uid: string; created_at: string };
type BatchItemRow = { packet_id: string; packet_sha256: string; account_id: string; account_version: number; scheme: RegistrySchemeKey; group_key: string; export_id: string };
type Manifest = { contract: "creditex-registry-batch/v1"; id: string; createdAt: string; groups: RegistryReadyGroup[];
  claims: { packetId: string; packetSha256: string; accountId: string; jobReference: string }[] };
type ReadyClaim = { packet: Packet; account: RegistryAccount; scheme: RegistrySchemeKey };

function fail(code: string, message: string, status = 409): never { throw new CreditexRegistryError(code, status, message); }
function text(value: unknown, label: string, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("REGISTRY_BATCH_INPUT", `Enter ${label}.`, 400);
  return value.trim();
}
function knownError(error: unknown): { code: string; message: string } | null {
  if (error instanceof Error && "code" in error && typeof error.code === "string" && /^(REGISTRY_|OUTPUT_ACTION_|WORK_PACK_)/.test(error.code))
    return { code: error.code, message: error.message };
  return null;
}
function schemeValue(value: unknown): RegistrySchemeKey | undefined {
  if (value === undefined || value === "" || value === "all") return undefined;
  const found = REGISTRY_SCHEME_KEYS.find(key => key === value);
  if (!found) fail("REGISTRY_BATCH_SCHEME", "Choose a supported program.", 400);
  return found;
}
function expectedIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > MAX_BATCH_PACKETS) fail("REGISTRY_BATCH_INPUT", "Choose between 1 and 3000 ready jobs.", 400);
  const ids = value.map(id => text(id, "claim identifier")).sort();
  if (new Set(ids).size !== ids.length) fail("REGISTRY_BATCH_INPUT", "Choose each claim once.", 400);
  return ids;
}
async function operate(db: D1Database, actor: RegistryActor) {
  if (!(await registryCapabilities(db, actor)).canOperate) fail("REGISTRY_PERMISSION_DENIED", "Your role cannot export or record lodgement.", 403);
  await ensureCreditexJobLifecycleSchemaGuards(db);
}
function audit(db: D1Database, actor: RegistryActor, id: string, at: string) {
  return db.prepare(`INSERT INTO compliance_audit_events(id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    VALUES(?,?,?,?, 'registry_batch_exported','registry_batch',?,'Reviewed jobs exported; external lodgement has not been recorded.','{}',?)`)
    .bind(crypto.randomUUID(), actor.organisationId, actor.actorKind === "admin" ? "platform" : "compliance", actor.actorUid, id, at);
}
async function readyClaim(db: D1Database, actor: RegistryActor, packet: Packet, accountId: string, options: RegistryOptions): Promise<ReadyClaim> {
  const scheme = registrySchemeForProgram(packet.programCode);
  if (!scheme) fail("REGISTRY_BATCH_SCHEME", "This claim has no supported program.");
  if (packet.status !== "prepared" || packet.providerReference) fail("REGISTRY_BATCH_ALREADY_LODGED", "A submission or provider outcome is already recorded.");
  if (packet.review?.decision !== "approved") fail("REGISTRY_APPROVAL_REQUIRED", "Independent claim approval is required.");
  const activeJob = await db.prepare(`SELECT work.id FROM compliance_cases compliance_case
    JOIN trade_work_orders work ON work.id=compliance_case.work_order_id AND work.firebase_uid=compliance_case.installer_uid
    WHERE compliance_case.organisation_id=? AND compliance_case.id=? AND work.record_status='active' AND work.stage<>'cancelled'`)
    .bind(actor.organisationId, packet.complianceCaseId).first<{ id: string }>();
  if (!activeJob) fail("REGISTRY_BATCH_JOB_INACTIVE", "Cancelled, deleted or unavailable jobs cannot be exported or lodged.");
  const reviewedJob = await db.prepare(`SELECT intent.id FROM compliance_cases compliance_case
    JOIN trade_work_order_compliance_intents intent ON intent.id=compliance_case.compliance_intent_id
      AND intent.compliance_organisation_id=compliance_case.organisation_id AND intent.installer_uid=compliance_case.installer_uid
      AND intent.work_order_id=compliance_case.work_order_id
    WHERE compliance_case.organisation_id=? AND compliance_case.id=?
      AND compliance_case.status<>'changes_requested' AND compliance_case.evidence_status<>'changes_required'
      AND intent.status IN ('planned','case_linked')
      AND EXISTS(SELECT 1 FROM creditex_job_lifecycle_events review WHERE review.organisation_id=intent.compliance_organisation_id
        AND review.work_order_id=intent.work_order_id AND review.owner_uid=intent.installer_uid AND review.intent_id=intent.id
        AND review.action='reviewed' AND review.actor_kind='trade' AND review.source_snapshot=${creditexIntentCompletionSnapshotSql()}
        AND NOT EXISTS(SELECT 1 FROM creditex_job_lifecycle_events later WHERE later.organisation_id=review.organisation_id
          AND later.work_order_id=review.work_order_id AND later.owner_uid=review.owner_uid AND later.intent_id=review.intent_id
          AND later.action IN ('reviewed','correction_required')
          AND (later.created_at>review.created_at OR (later.created_at=review.created_at AND later.id>review.id))))`)
    .bind(actor.organisationId, packet.complianceCaseId).first<{ id: string }>();
  if (!reviewedJob) fail("REGISTRY_BATCH_REVIEW_REQUIRED", "Resolve corrections and complete the trade business review of the current job before export or lodgement.");
  if (!accountId) fail("REGISTRY_CLAIM_ACCOUNT_REQUIRED", "Choose the claiming account for this job.");
  const account = await requireRegistryAccount(db, actor, accountId, true, options);
  if (scheme !== account.scheme || !account.activityScope.includes(packet.activityTemplateId)) fail("REGISTRY_ACTIVITY_NOT_AUTHORISED", "The account does not authorise this activity.");
  await requireRegistryClaimBinding(db, actor, packet.id, account.id);
  if (await loadCreditexOutputDispatchIntent(db, actor, packet.id)) fail("REGISTRY_EXPORT_DISPATCH_RESERVED", "Reconcile the existing external submission attempt first.");
  await recheckOutputDispatchEvidence(db, actor, packet);
  return { packet, account, scheme };
}
function group(claims: ReadyClaim[], output?: ExportRow): RegistryReadyGroup {
  const first = claims[0], format = output && listRegistryFormats().find(item => item.key === output.format_key);
  const units = new Set(claims.map(item => item.packet.unit));
  const quantities = claims.map(item => item.packet.quantity);
  return {
    key: output ? `official:${output.id}` : `provider:${first.account.id}`, scheme: first.scheme,
    accountId: first.account.id, accountName: first.account.legalName, kind: output ? "official_upload" : "provider_handover",
    formatKey: output?.format_key || "", formatLabel: format?.label || "Provider handover (not a government upload)",
    baseVintage: output?.base_vintage || "", exportId: output?.id || "", packetIds: claims.map(item => item.packet.id),
    jobReferences: claims.map(item => item.packet.jobReference),
    quantity: units.size === 1 && quantities.every(value => /^\d+$/.test(value)) ? quantities.reduce((sum, value) => sum + BigInt(value), BigInt(0)).toString() : "",
    unit: units.size === 1 ? first.packet.unit : "",
  };
}
async function plan(db: D1Database, actor: RegistryActor, options: RegistryOptions, selectedScheme?: RegistrySchemeKey) {
  await registryCapabilities(db, actor);
  const candidates = await db.prepare(`SELECT packet.id,COALESCE(binding.account_id,'') account_id,
      COALESCE(item.batch_id,'') batch_id FROM compliance_output_action_packets packet
    LEFT JOIN creditex_registry_claim_accounts binding ON binding.organisation_id=packet.organisation_id AND binding.packet_id=packet.id
    LEFT JOIN creditex_registry_batch_items item ON item.organisation_id=packet.organisation_id AND item.packet_id=packet.id
    WHERE packet.organisation_id=? AND item.batch_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM compliance_output_action_events event WHERE event.organisation_id=packet.organisation_id
        AND event.packet_id=packet.id AND event.to_status<>'prepared')
    ORDER BY packet.prepared_at,packet.id`).bind(actor.organisationId)
    .all<{ id: string; account_id: string; batch_id: string }>();
  const ready = new Map<string, ReadyClaim>(), blocked: RegistryBatchWorkspace["blockedClaims"][number][] = [];
  for (const candidate of candidates.results) {
    const packet = await loadCreditexOutputAction(db, actor.organisationId, candidate.id), scheme = registrySchemeForProgram(packet.programCode);
    if (!scheme || (selectedScheme && scheme !== selectedScheme) || candidate.batch_id || packet.status !== "prepared") continue;
    try { ready.set(packet.id, await readyClaim(db, actor, packet, candidate.account_id, options)); }
    catch (error) { const issue = knownError(error); if (!issue) throw error; blocked.push({ packetId: packet.id, jobReference: packet.jobReference, scheme, code: issue.code, reason: issue.message }); }
  }
  const outputs = await db.prepare(`SELECT output.* FROM creditex_registry_exports output
    JOIN creditex_registry_export_reviews review ON review.organisation_id=output.organisation_id AND review.export_id=output.id AND review.decision='approved'
    WHERE output.organisation_id=? ORDER BY output.created_at DESC,output.id DESC`).bind(actor.organisationId).all<ExportRow>();
  const groups: RegistryReadyGroup[] = [], used = new Set<string>();
  for (const output of outputs.results) {
    const ids: string[] = JSON.parse(output.packet_ids), hashes: string[] = JSON.parse(output.packet_hashes);
    const format = listRegistryFormats().find(item => item.key === output.format_key);
    if (!ids.length || !format || ids.some(id => !ready.has(id) || used.has(id))) continue;
    const claims = ids.map(id => ready.get(id)!);
    if (claims.some((claim, index) => claim.account.id !== output.account_id || claim.account.version !== output.account_version || claim.packet.packetSha256 !== hashes[index])
      || creditexCanonicalSha256(format) !== output.format_sha256) continue;
    groups.push(group(claims, output)); ids.forEach(id => used.add(id));
  }
  const handovers = new Map<string, ReadyClaim[]>();
  for (const claim of ready.values()) {
    if (used.has(claim.packet.id)) continue;
    if (["nsw_esc", "nsw_prc", "stc"].includes(claim.scheme)) {
      blocked.push({ packetId: claim.packet.id, jobReference: claim.packet.jobReference, scheme: claim.scheme,
        code: "REGISTRY_BATCH_APPROVED_FILE_REQUIRED", reason: "Prepare and independently approve the complete official submission file first." });
    } else { const list = handovers.get(claim.account.id) || []; list.push(claim); handovers.set(claim.account.id, list); }
  }
  for (const claims of handovers.values()) groups.push(group(claims));
  groups.sort((a, b) => a.scheme.localeCompare(b.scheme) || a.key.localeCompare(b.key));
  return { groups, blocked, ready };
}
async function batchRow(db: D1Database, actor: RegistryActor, id: unknown) {
  const row = await db.prepare("SELECT * FROM creditex_registry_batches WHERE organisation_id=? AND id=?")
    .bind(actor.organisationId, text(id, "batch identifier")).first<BatchRow>();
  if (!row) fail("REGISTRY_BATCH_NOT_FOUND", "The export batch was not found.", 404);
  return row;
}
function manifest(row: BatchRow): Manifest {
  const value: Manifest = JSON.parse(row.manifest_snapshot);
  if (creditexCanonicalSha256(value) !== row.manifest_sha256 || value.id !== row.id || value.contract !== "creditex-registry-batch/v1")
    fail("REGISTRY_BATCH_INTEGRITY", "The retained batch manifest failed its integrity check.");
  return value;
}
async function summary(db: D1Database, actor: RegistryActor, row: BatchRow): Promise<RegistryBatchSummary> {
  const retained = manifest(row), items: RegistryBatchItem[] = [];
  const packets = await db.prepare(`SELECT packet.id,packet.program_code,packet.packet_sha256,
      COALESCE((SELECT event.to_status FROM compliance_output_action_events event
        WHERE event.organisation_id=packet.organisation_id AND event.packet_id=packet.id ORDER BY event.sequence DESC LIMIT 1),'prepared') status,
      COALESCE((SELECT receipt.provider_reference FROM compliance_output_action_adapter_receipts receipt
        WHERE receipt.organisation_id=packet.organisation_id AND receipt.packet_id=packet.id AND receipt.provider_reference<>''
        ORDER BY receipt.response_received_at DESC,receipt.id DESC LIMIT 1),'') provider_reference,
      EXISTS (SELECT 1 FROM compliance_output_action_events event WHERE event.organisation_id=packet.organisation_id
        AND event.packet_id=packet.id AND event.to_status='submitted') lodged
    FROM creditex_registry_batch_items item JOIN compliance_output_action_packets packet
      ON packet.organisation_id=item.organisation_id AND packet.id=item.packet_id
    WHERE item.organisation_id=? AND item.batch_id=?`).bind(actor.organisationId,row.id)
    .all<{id:string;program_code:string;packet_sha256:string;status:string;provider_reference:string;lodged:number}>();
  const byId = new Map(packets.results.map(packet => [packet.id, packet]));
  for (const claim of retained.claims) {
    const packet = byId.get(claim.packetId), scheme = packet && registrySchemeForProgram(packet.program_code);
    if (!packet || !scheme || packet.packet_sha256 !== claim.packetSha256) fail("REGISTRY_BATCH_INTEGRITY", "A retained batch claim no longer matches its immutable packet.");
    items.push({ packetId: packet.id, accountId: claim.accountId, scheme, jobReference: claim.jobReference, status: packet.status, providerReference: packet.lodged ? packet.provider_reference : "" });
  }
  return { id: row.id, createdAt: row.created_at, createdByUid: row.created_by_uid, packetCount: items.length,
    submittedCount: packets.results.filter(packet => packet.lodged).length, groups: retained.groups, items };
}
export async function loadRegistryBatchWorkspace(db: D1Database, actor: RegistryActor, options: RegistryOptions = {}): Promise<RegistryBatchWorkspace> {
  const capabilities = await registryCapabilities(db, actor), current = await plan(db, actor, options);
  const rows = await db.prepare("SELECT * FROM creditex_registry_batches WHERE organisation_id=? ORDER BY created_at DESC,id DESC LIMIT 100")
    .bind(actor.organisationId).all<BatchRow>();
  const batches = [];
  for (const row of rows.results) batches.push(await summary(db, actor, row));
  return { readyGroups: current.groups, blockedClaims: current.blocked, batches, capabilities: { canOperate: capabilities.canOperate } };
}
export async function exportReadyRegistryBatch(db: D1Database, actor: RegistryActor,
  input: Readonly<Record<string, unknown>>, options: RegistryOptions = {}): Promise<RegistryBatchSummary> {
  await operate(db, actor);
  const scheme = schemeValue(input.scheme), expected = expectedIds(input.expectedPacketIds), requestId = text(input.requestId, "export request identifier", 120);
  const requestHash = creditexCanonicalSha256({ scheme: scheme || "all", expectedPacketIds: expected || null });
  const replay = async () => {
    const prior = await db.prepare("SELECT * FROM creditex_registry_batches WHERE organisation_id=? AND request_id=?").bind(actor.organisationId, requestId).first<BatchRow>();
    if (prior && prior.request_sha256 !== requestHash) fail("REGISTRY_BATCH_REQUEST_CONFLICT", "This export request already contains different jobs.");
    return prior;
  };
  const prior = await replay(); if (prior) return summary(db, actor, prior);
  const current = await plan(db, actor, options, scheme), selected = new Set(expected);
  const groups = expected ? current.groups.filter(item => item.packetIds.some(id => selected.has(id))) : current.groups;
  const ids = groups.flatMap(item => [...item.packetIds]).sort();
  if (!ids.length) fail("REGISTRY_BATCH_NOT_READY", "There are no ready jobs to export.");
  if (ids.length > MAX_BATCH_PACKETS) fail("REGISTRY_BATCH_LIMIT", "Export at most 3000 jobs at a time. Choose a program or a smaller set.", 400);
  if (expected && JSON.stringify(ids) !== JSON.stringify(expected)) fail("REGISTRY_BATCH_CHANGED", "The ready jobs changed or a selected official file would be split. Refresh and export the complete ready group.");
  const id = crypto.randomUUID(), createdAt = options.now?.() || new Date().toISOString();
  const retained: Manifest = { contract: "creditex-registry-batch/v1", id, createdAt, groups,
    claims: ids.map(packetId => { const claim = current.ready.get(packetId)!; return { packetId, packetSha256: claim.packet.packetSha256, accountId: claim.account.id, jobReference: claim.packet.jobReference }; }) };
  const zip: Zippable = {}, zipOptions = { mtime: new Date("2026-01-01T00:00:00.000Z") };
  zip["manifest.json"] = [strToU8(JSON.stringify(retained, null, 2)), zipOptions];
  zip["README.txt"] = [strToU8("TLink reviewed job export\n\nExporting does not submit jobs to a government registry or retailer.\nOfficial upload CSV files are the exact independently approved files. Upload each to its stated account and base vintage.\nProvider handover folders contain the retained claim packet JSON and manifest only. They are not government upload formats and do not include the complete evidence or signed document package.\nAfter actual lodgement, record the returned reference and time in TLink to update the included jobs to Submitted.\n"), zipOptions];
  for (const [index, item] of groups.entries()) {
    const folder = `${String(index + 1).padStart(3, "0")}-${item.scheme}`;
    if (item.kind === "official_upload") {
      const response = await downloadRegistryExport(db, actor, item.exportId, options);
      zip[`${folder}/${item.formatKey}${item.baseVintage ? `-${item.baseVintage}` : ""}.csv`] = [new Uint8Array(await response.arrayBuffer()), zipOptions];
    } else {
      for (const [claimIndex, packetId] of item.packetIds.entries())
        zip[`${folder}/provider-handover/claim-${claimIndex + 1}.json`] = [strToU8(JSON.stringify(current.ready.get(packetId)!.packet.packet, null, 2)), zipOptions];
    }
  }
  const bytes = zipSync(zip, { level: 6 });
  if (bytes.byteLength > 25 * 1024 * 1024) fail("REGISTRY_BATCH_SIZE", "This export exceeds 25 MB. Choose fewer complete groups.", 400);
  const exactBytes = new Uint8Array(bytes.byteLength); exactBytes.set(bytes);
  const evidenceId = await persistRegistryEvidence(db, actor, { bytes: exactBytes.buffer, filename: `tlink-submissions-${id}.zip`, mime: "application/zip" }, options);
  const statements = [db.prepare(`INSERT INTO creditex_registry_batches(id,organisation_id,request_id,request_sha256,evidence_id,manifest_snapshot,manifest_sha256,created_by_uid,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id, actor.organisationId, requestId, requestHash, evidenceId, JSON.stringify(retained), creditexCanonicalSha256(retained), actor.actorUid, createdAt)];
  for (const item of groups) for (const packetId of item.packetIds) {
    const claim = current.ready.get(packetId)!;
    statements.push(db.prepare(`INSERT INTO creditex_registry_batch_items(organisation_id,batch_id,packet_id,packet_sha256,account_id,account_version,scheme,group_key,export_id) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(actor.organisationId, id, packetId, claim.packet.packetSha256, claim.account.id, claim.account.version, item.scheme, item.key, item.exportId));
  }
  statements.push(audit(db, actor, id, createdAt));
  try { await db.batch(statements); }
  catch (error) {
    const raced = await replay(); if (raced) return summary(db, actor, raced);
    const message = error instanceof Error ? error.message : "";
    if (/REGISTRY_BATCH_|UNIQUE constraint failed: creditex_registry_batch_items/.test(message)) fail("REGISTRY_BATCH_CHANGED", "One or more jobs changed or were exported by another team member. Refresh the batch list.");
    throw error;
  }
  return summary(db, actor, await batchRow(db, actor, id));
}
export async function downloadRegistryBatch(db: D1Database, actor: RegistryActor, id: unknown, options: RegistryOptions = {}) {
  await registryCapabilities(db, actor);
  const row = await batchRow(db, actor, id); manifest(row);
  return downloadRegistryEvidence(db, actor, row.evidence_id, options);
}
export async function recordRegistryBatchLodgement(db: D1Database, actor: RegistryActor,
  input: Readonly<Record<string, unknown>>, options: RegistryOptions = {}): Promise<RegistryBatchLodgementOutcome> {
  await operate(db, actor);
  const row = await batchRow(db, actor, input.batchId); manifest(row);
  const account = await requireRegistryAccount(db, actor, input.accountId, true, options);
  const rows = await db.prepare("SELECT * FROM creditex_registry_batch_items WHERE organisation_id=? AND batch_id=? AND account_id=? ORDER BY packet_id")
    .bind(actor.organisationId, row.id, account.id).all<BatchItemRow>();
  if (!rows.results.length) fail("REGISTRY_BATCH_ACCOUNT", "This account does not belong to the export batch.", 400);
  const selectedIds = expectedIds(input.packetIds);
  if (selectedIds?.some(id => !rows.results.some(item => item.packet_id === id))) fail("REGISTRY_BATCH_REFERENCE_SCOPE", "Selected jobs must belong to this batch and account.", 400);
  const items = selectedIds ? rows.results.filter(item => selectedIds.includes(item.packet_id)) : rows.results;
  const commonReference = input.providerReference === undefined || input.providerReference === "" ? "" : text(input.providerReference, "the returned lodgement reference");
  const overrides = new Map<string, string>();
  if (input.packetReferences !== undefined) {
    if (!Array.isArray(input.packetReferences) || input.packetReferences.length > MAX_BATCH_PACKETS) fail("REGISTRY_BATCH_INPUT", "Provide valid job references.", 400);
    for (const override of input.packetReferences) {
      if (!override || typeof override !== "object" || !("packetId" in override) || !("providerReference" in override)) fail("REGISTRY_BATCH_INPUT", "Provide a claim and returned reference for each override.", 400);
      const id = text(override.packetId, "claim identifier"), reference = text(override.providerReference, "returned lodgement reference");
      if (overrides.has(id) || !items.some(item => item.packet_id === id)) fail("REGISTRY_BATCH_REFERENCE_SCOPE", "References must identify distinct selected jobs belonging to this batch and account.", 400);
      overrides.set(id, reference);
    }
  }
  const occurred = text(input.submittedAt, "actual lodgement time", 40), timestamp = Date.parse(occurred), now = options.now?.() || new Date().toISOString();
  if (!Number.isFinite(timestamp) || timestamp > Date.parse(now) + 300000 || timestamp < Date.parse(row.created_at)) fail("REGISTRY_BATCH_DATE", "Lodgement must be after this export and cannot be in the future.", 400);
  const submittedAt = new Date(timestamp).toISOString();
  const providerName = `${REGISTRY_SCHEMES.find(item => item.key === account.scheme)!.title}: ${account.legalName}`.slice(0, 180);
  const submissionMethod = `TLink batch ${row.id} external lodgement`;
  // Validate every supplied reference before any packet can be changed.
  const references = new Map(items.map(item => [item.packet_id, overrides.get(item.packet_id) || commonReference]));
  if ([...references.values()].some(value => !value)) fail("REGISTRY_BATCH_REFERENCE_REQUIRED", "Enter the returned batch reference or a returned reference for every job.", 400);
  const results: RegistryBatchLodgementOutcome["results"][number][] = [];
  let remainingCount = 0, attempted = 0;
  const replayRows = await db.prepare(`SELECT receipt.packet_id,receipt.provider_reference FROM compliance_output_action_adapter_receipts receipt
    JOIN creditex_registry_batch_items item ON item.organisation_id=receipt.organisation_id AND item.packet_id=receipt.packet_id
    WHERE item.organisation_id=? AND item.batch_id=? AND item.account_id=? AND receipt.adapter_id='manual-provider-record/v1'
      AND receipt.provider_name=? AND receipt.response_received_at=? AND json_extract(receipt.response_snapshot,'$.method')=?`)
    .bind(actor.organisationId,row.id,account.id,providerName,submittedAt,submissionMethod).all<{packet_id:string;provider_reference:string}>();
  const knownReplays = new Map(replayRows.results.map(receipt => [receipt.packet_id,receipt.provider_reference]));
  const exactReplay = async (item: BatchItemRow, reference: string) => Boolean(await db.prepare(`SELECT id FROM compliance_output_action_adapter_receipts
    WHERE organisation_id=? AND packet_id=? AND adapter_id='manual-provider-record/v1' AND provider_name=? AND provider_reference=?
      AND response_received_at=? AND json_extract(response_snapshot,'$.method')=? LIMIT 1`)
    .bind(actor.organisationId, item.packet_id, providerName, reference, submittedAt, submissionMethod).first<{ id: string }>());
  for (const item of items) {
    const reference = references.get(item.packet_id)!;
    if (knownReplays.get(item.packet_id) === reference) { results.push({ packetId: item.packet_id, status: "already_submitted", providerReference: reference }); continue; }
    if (attempted >= MAX_LODGEMENT_PACKETS) { remainingCount++; continue; }
    attempted++;
    try {
      const packet = await requireRegistryClaimBinding(db, actor, item.packet_id, account.id);
      if (packet.packetSha256 !== item.packet_sha256) fail("REGISTRY_BATCH_CHANGED", "This claim no longer matches the exported batch.");
      await readyClaim(db, actor, packet, account.id, options);
      await recordManualCreditexOutputSubmission(db, actor, { packetId: item.packet_id, expectedPacketSha256: item.packet_sha256,
        providerName, providerReference: reference, submittedAt, submissionMethod }, { now: options.now });
      results.push({ packetId: item.packet_id, status: "submitted", providerReference: reference });
    } catch (error) {
      if (await exactReplay(item, reference)) { results.push({ packetId: item.packet_id, status: "already_submitted", providerReference: reference }); continue; }
      const issue = knownError(error);
      results.push({ packetId: item.packet_id, status: "failed", providerReference: reference,
        code: issue?.code || "REGISTRY_BATCH_RECORD_FAILED", error: issue?.message || "The result could not be retained. Retry this batch to reconcile the stored outcome before continuing." });
    }
  }
  return { batchId: row.id, results, submittedCount: results.filter(item => item.status !== "failed").length,
    failedCount: results.filter(item => item.status === "failed").length, remainingCount };
}
