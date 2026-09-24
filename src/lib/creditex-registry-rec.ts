import { creditexRawSha256 } from "./creditex-interchange-preflight";
import { registrySchemeForProgram, type RegistryStatus } from "./creditex-registry";
import {
  CreditexRegistryError, insertRegistryResult, persistRegistryEvidence, registryCapabilities,
  requireRegistryAccount, requireRegistryClaimBinding, type RegistryActor, type RegistryOptions,
} from "./creditex-registry-server";

const REC_ENDPOINT = "https://rec-registry.gov.au/rec-registry/app/api/public-register/certificate-actions";
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const SYNC_INTERVAL_MS = 60_000;
const SOURCE_SPECIFICATION = "https://cer.gov.au/document/rec-registry-api-specifications";
type JsonRecord = Record<string, unknown>;
type RecRange = Readonly<{
  certificateType: string; accreditationCode: string; ownerAccountId: string;
  generationYear: number; generationState: string; fuelSource: string; registeredPersonNumber: string;
  startSerialNumber: number; endSerialNumber: number; status: string; raw: JsonRecord;
}>;
type RecAction = Readonly<{ actionType: string; completedTime: string; ranges: readonly RecRange[] }>;
export type RecSyncSummary = Readonly<{
  sourceDate: string; checkedAt: string; matchedClaims: number; updatedClaims: number; unresolvedClaims: number;
  matches: readonly Readonly<{ packetId: string; evidenceId: string; confirmed: boolean }>[];
}>;

function fail(code: string, message: string, status = 409): never { throw new CreditexRegistryError(code, status, message); }
function record(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identifier(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,19}$/.test(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}
function requiredString(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 255; }
function sydneyDate(timestamp: string) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}

/** CER documents one-day latency. Sydney dates prevent UTC midnight from exposing today's incomplete feed. */
export function validateRecSourceDate(value: unknown, timestamp: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value || value >= sydneyDate(timestamp)) {
    fail("REC_SOURCE_DATE_INVALID", "Choose a completed day before today in Australia/Sydney. REC data has a one-day delay.", 400);
  }
  return value;
}

async function fetchRecActions(date: string, options: RegistryOptions) {
  const sourceUrl = `${REC_ENDPOINT}?date=${date}`, controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CreditexRegistryError("REC_SOURCE_TIMEOUT", 504, "REC Registry did not respond in time. Existing claim statuses have been preserved."));
    }, FETCH_TIMEOUT_MS);
  });
  const fetchAndRead = async () => {
    const response = await (options.fetchImpl || fetch)(sourceUrl, { method: "GET", redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) fail("REC_SOURCE_UNAVAILABLE", "REC Registry could not be checked. Existing claim statuses have been preserved.", 502);
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) fail("REC_SOURCE_TOO_LARGE", "The REC response exceeds the supported size. Use reviewed registry evidence for this date.", 502);
    if (!response.body) fail("REC_SOURCE_INVALID", "REC Registry returned an empty response.", 502);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail("REC_SOURCE_TOO_LARGE", "The REC response exceeds the supported size. Use reviewed registry evidence for this date.", 502);
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { fail("REC_SOURCE_INVALID", "REC Registry returned invalid JSON. No result has been confirmed.", 502); }
    return { payload, sourceUrl, sourceSha256: creditexRawSha256(bytes) };
  };
  try { return await Promise.race([fetchAndRead(), timeout]); }
  catch (error) {
    controller.abort();
    if (error instanceof CreditexRegistryError) throw error;
    fail("REC_SOURCE_UNAVAILABLE", "REC Registry could not be checked. Existing claim statuses have been preserved.", 502);
  } finally { if (timer) clearTimeout(timer); }
}

function parseRecActions(payload: unknown, sourceDate: string, accountReference: string): RecAction[] {
  if (!record(payload) || payload.status !== "Success" || !Array.isArray(payload.result)) fail("REC_SOURCE_INVALID", "REC Registry returned an unsupported response.", 502);
  const actions: RecAction[] = [];
  for (const entry of payload.result) {
    if (!record(entry) || !requiredString(entry.actionType) || typeof entry.completedTime !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(entry.completedTime)
      || !Number.isFinite(Date.parse(entry.completedTime)) || sydneyDate(entry.completedTime) !== sourceDate || !Array.isArray(entry.certificateRanges)) {
      fail("REC_SOURCE_INVALID", "REC Registry returned an invalid action or date. No result has been confirmed.", 502);
    }
    const ranges: RecRange[] = [];
    for (const range of entry.certificateRanges) {
      if (!record(range) || !requiredString(range.certificateType)) fail("REC_SOURCE_INVALID", "REC Registry returned an invalid certificate range.", 502);
      if (range.certificateType !== "STC") continue;
      // The current response uses ownerAccountId; CER's published dictionary spells it ownerAccountID.
      const owner = identifier(range.ownerAccountId ?? range.ownerAccountID);
      if (owner === null || (range.ownerAccountId !== undefined && range.ownerAccountID !== undefined && identifier(range.ownerAccountID) !== owner)) {
        fail("REC_SOURCE_INVALID", "REC Registry returned an ambiguous account identity.", 502);
      }
      if (owner !== accountReference) continue;
      const person = identifier(range.registeredPersonNumber);
      if (!requiredString(range.accreditationCode) || !requiredString(range.status) || !requiredString(range.generationState)
        || !requiredString(range.fuelSource) || person === null || typeof range.generationYear !== "number" || !Number.isSafeInteger(range.generationYear)
        || typeof range.startSerialNumber !== "number" || typeof range.endSerialNumber !== "number"
        || !Number.isSafeInteger(range.startSerialNumber) || !Number.isSafeInteger(range.endSerialNumber)
        || range.startSerialNumber < 0 || range.endSerialNumber < range.startSerialNumber) {
        fail("REC_SOURCE_INVALID", "REC Registry returned an invalid matching certificate range. No result has been confirmed.", 502);
      }
      ranges.push({ certificateType: "STC", accreditationCode: range.accreditationCode, ownerAccountId: owner,
        generationYear: range.generationYear, generationState: range.generationState, fuelSource: range.fuelSource,
        registeredPersonNumber: person, startSerialNumber: range.startSerialNumber, endSerialNumber: range.endSerialNumber, status: range.status, raw: range });
    }
    if (ranges.length) actions.push({ actionType: entry.actionType, completedTime: new Date(entry.completedTime).toISOString(), ranges });
  }
  return actions;
}

function mappedStatus(action: RecAction, range: RecRange): RegistryStatus | null {
  if ((action.actionType === "STC registered" || action.actionType === "STC audit passed") && range.status === "Registered") return "registered";
  if (action.actionType === "STC audit failed" && range.status === "Invalid due to audit") return "rejected";
  if ((action.actionType === "STC created" && range.status === "Pending audit")
    || (action.actionType === "STC audit passed" && range.status === "Pending creation fee payment")) return "assessment";
  return null;
}

/** A daily action feed is not a holdings snapshot. Confirm only a complete, unambiguous issuance event. */
function resolveResult(actions: readonly RecAction[], expectedQuantity: string) {
  const issuance = actions.filter(action => ["STC registered", "STC audit passed", "STC audit failed", "STC created"].includes(action.actionType));
  if (!issuance.length || !/^[1-9]\d{0,14}$/.test(expectedQuantity)) return null;
  const occurredAt = issuance.reduce((latest, action) => action.completedTime > latest ? action.completedTime : latest, "");
  const latest = issuance.filter(action => action.completedTime === occurredAt);
  const ranges = latest.flatMap(action => action.ranges.map(range => ({ range, status: mappedStatus(action, range) })));
  const status = ranges[0]?.status;
  if (!status || ranges.some(item => item.status !== status)) return null;
  // Different generations or creators can reuse a serial range. They cannot establish this claim's exact quantity.
  const identities = new Set(ranges.map(({ range }) => JSON.stringify([range.generationYear, range.generationState, range.fuelSource, range.registeredPersonNumber])));
  if (identities.size !== 1) return null;
  ranges.sort((a, b) => a.range.startSerialNumber - b.range.startSerialNumber);
  let count = BigInt(0), previousEnd = -1;
  for (const { range } of ranges) {
    if (range.startSerialNumber <= previousEnd) return null;
    count += BigInt(range.endSerialNumber) - BigInt(range.startSerialNumber) + BigInt(1);
    previousEnd = range.endSerialNumber;
  }
  if (count !== BigInt(expectedQuantity)) return null;
  return { registryStatus: status, quantity: expectedQuantity, occurredAt };
}

export async function syncRecRegistry(db: D1Database, actor: RegistryActor, input: Readonly<{ accountId: unknown; date: unknown }>, options: RegistryOptions = {}): Promise<RecSyncSummary> {
  if (!(await registryCapabilities(db, actor)).canOperate) fail("REGISTRY_PERMISSION_DENIED", "Your role cannot check registry results.", 403);
  const timestamp = options.now?.() || new Date().toISOString(), sourceDate = validateRecSourceDate(input.date, timestamp);
  const account = await requireRegistryAccount(db, actor, input.accountId, true, options);
  if (account.scheme !== "stc") fail("REC_SCHEME_UNSUPPORTED", "Automatic public-register reconciliation currently supports STC installation claims only.", 400);
  const links = await db.prepare("SELECT packet_id FROM creditex_registry_claim_accounts WHERE organisation_id=? AND account_id=? ORDER BY packet_id")
    .bind(actor.organisationId, account.id).all<{ packet_id: string }>();
  const claims = [];
  for (const link of links.results) {
    const packet = await requireRegistryClaimBinding(db, actor, link.packet_id, account.id);
    if (registrySchemeForProgram(packet.programCode) === "stc" && packet.status !== "prepared" && packet.providerReference) claims.push(packet);
  }
  if (!claims.length) fail("REC_SUBMITTED_CLAIMS_REQUIRED", "Record the submitted REC references for this account before checking its results.");
  const reserved = await db.prepare(`INSERT INTO creditex_registry_sync_runs (organisation_id,account_id,source_date,attempted_at) VALUES (?,?,?,?)
    ON CONFLICT(organisation_id,account_id,source_date) DO UPDATE SET attempted_at=excluded.attempted_at
    WHERE creditex_registry_sync_runs.attempted_at<=?`).bind(actor.organisationId, account.id, sourceDate, timestamp,
      new Date(Date.parse(timestamp) - SYNC_INTERVAL_MS).toISOString()).run();
  if (!reserved.meta.changes) fail("REC_SYNC_RECENT", "This date was just checked or is being checked. Wait a minute before checking it again.", 429);
  const source = await fetchRecActions(sourceDate, options), actions = parseRecActions(source.payload, sourceDate, account.accountReference);
  // Recheck live authorisation after the network wait; an old browser cannot keep operating a changed account.
  if (!(await registryCapabilities(db, actor)).canOperate) fail("REGISTRY_PERMISSION_DENIED", "Your registry permissions changed. Refresh before continuing.", 403);
  const current = await requireRegistryAccount(db, actor, account.id, true, options);
  if (current.version !== account.version) fail("REGISTRY_ACCOUNT_CHANGED", "The account changed during the registry check. Refresh before trying again.");
  let matchedClaims = 0, updatedClaims = 0, unresolvedClaims = 0;
  const matches: { packetId: string; evidenceId: string; confirmed: boolean }[] = [];
  const references = new Map<string, number>();
  for (const claim of claims) references.set(claim.providerReference, (references.get(claim.providerReference) || 0) + 1);
  for (const claim of claims) {
    const matched = actions.flatMap(action => {
      const ranges = action.ranges.filter(range => range.accreditationCode === claim.providerReference);
      return ranges.length ? [{ ...action, ranges }] : [];
    });
    if (!matched.length) continue;
    matchedClaims++;
    const result = references.get(claim.providerReference) === 1 ? resolveResult(matched.filter(action => Date.parse(action.completedTime) >= Date.parse(claim.preparedAt)), claim.quantity) : null;
    // Retain only this account and installation's ranges, not other participants' public records.
    const evidence = { contract: "tlink-rec-public-register-extract/v1", sourceUrl: source.sourceUrl, sourceSpecification: SOURCE_SPECIFICATION,
      sourceDate, fetchedAt: timestamp, fullResponseSha256: source.sourceSha256, accountReference: account.accountReference,
      accreditationCode: claim.providerReference, extraction: "Only ranges matching this exact owner account and installation are retained.",
      outcome: result ? "exact_issuance_event" : "unresolved_requires_review", actions: matched.map(action => ({ actionType: action.actionType, completedTime: action.completedTime, certificateRanges: action.ranges.map(range => range.raw) })) };
    const evidenceId = await persistRegistryEvidence(db, actor, { filename: `rec-${sourceDate}-${claim.id}.json`, mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify(evidence)).buffer }, options);
    if (result) {
      const rechecked = await requireRegistryClaimBinding(db, actor, claim.id, account.id);
      if (rechecked.packetSha256 !== claim.packetSha256 || rechecked.providerReference !== claim.providerReference) fail("REGISTRY_PACKET_CHANGED", "A claim changed during the registry check. Refresh before trying again.");
      await insertRegistryResult(db, actor, { packetId: claim.id, accountId: account.id, externalReference: claim.providerReference, ...result, evidenceId,
        note: `REC public register: exact account, installation and ${claim.quantity} certificates matched for ${sourceDate}. This is issuance evidence, not confirmation of payment or current holdings.`, source: "rec_public_register" }, options);
      updatedClaims++;
    } else unresolvedClaims++;
    await db.prepare(`INSERT INTO creditex_registry_sync_matches (organisation_id,account_id,source_date,packet_id,evidence_id,confirmed,checked_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(organisation_id,account_id,source_date,packet_id)
      DO UPDATE SET evidence_id=excluded.evidence_id,confirmed=excluded.confirmed,checked_at=excluded.checked_at
      WHERE creditex_registry_sync_matches.checked_at<=excluded.checked_at`)
      .bind(actor.organisationId, account.id, sourceDate, claim.id, evidenceId, result ? 1 : 0, timestamp).run();
    matches.push({ packetId: claim.id, evidenceId, confirmed: Boolean(result) });
  }
  await db.prepare(`UPDATE creditex_registry_sync_runs SET completed_at=?,source_sha256=?,matched_count=? WHERE organisation_id=? AND account_id=? AND source_date=? AND attempted_at=?`)
    .bind(timestamp, source.sourceSha256, matchedClaims, actor.organisationId, account.id, sourceDate, timestamp).run();
  return { sourceDate, checkedAt: timestamp, matchedClaims, updatedClaims, unresolvedClaims, matches };
}
