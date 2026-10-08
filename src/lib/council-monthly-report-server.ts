import { encryptProtectedPayload, decryptProtectedPayload, keyedProtectedAuditHash } from "./trade-integration-crypto";
import { fetchCommunitySnapshot } from "./council-community-server";
import { communityReport, isCommunitySnapshot, type CommunitySnapshot } from "./council-community";
import { loadCouncilVeuSnapshot, runtimeCouncilVeuCache } from "./council-veu-server";
import { councilVeuReport } from "./council-veu";
import { readCouncilProfile } from "./council-profile-server";
import type { CouncilProfile } from "./council-profile";
import { loadCouncilReport } from "./council-reporting-server";
import { loadCouncilEnquiries } from "./council-enquiries-server";
import { councilMonthlyFilename, councilMonthlyScopeKey, parseCouncilMonthlySettings, type CouncilMonthlySettings, type CouncilMonthlySettingsInput, type CouncilMonthlyReportBundle } from "./council-monthly-report";
import { reminderProviderFailureOutcome, sendServiceReminderProviderMessage, serviceReminderProviderConfiguration, type ReminderProviderMessage } from "./service-reminder-delivery";
import type { CustomerProjectEvidenceBucket } from "./customer-project-evidence-bucket";

type CryptoOptions = {
  encrypt?: typeof encryptProtectedPayload; decrypt?: typeof decryptProtectedPayload;
  recipientHash?: typeof keyedProtectedAuditHash;
};
type Scope = { councilId: string; name: string; state: string; postcodes: string[] };
type SettingsRow = { council_id: string; enabled: number; encrypted_payload: string; revision: number; configured_by_uid: string; updated_at: string };
type ContextRow = SettingsRow & { name: string; state: string; postcodes_json: string };
type ReportRow = { id: string; council_id: string; source_as_of: string; scope_key: string; settings_revision: number; status: string; generation_attempts: number; claim_token: string; lease_expires_at: string; encrypted_payload: string; pdf_object_key: string; pdf_sha256: string; pdf_size_bytes: number; generated_at: string; created_at: string; updated_at: string };
type DeliveryRow = { id: string; report_id: string; recipient_index: number; recipient_hash: string; status: string; attempts: number; first_attempt_at: string; next_attempt_at: string; claim_token: string; lease_expires_at: string };
type FrozenMessage = { recipients: string[]; subject: string; body: string; filename: string };
export type CouncilMonthlyArtifactStore = Pick<CustomerProjectEvidenceBucket, "put" | "get" | "delete">;
type Sender = (message: ReminderProviderMessage) => Promise<{ provider: string; providerMessageId: string; providerStatus: string }>;
const DAY = 86400_000;
const RETRY_WINDOW = 23 * 3600_000;
const MAX_PDF = 12_000_000;
const authority = `c.status='active' AND EXISTS (SELECT 1 FROM council_memberships m WHERE m.council_id=c.id
  AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor'))`;
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)), byte => byte.toString(16).padStart(2,"0")).join("");
const clamp = (value: number | undefined, maximum = 25) => Math.max(1, Math.min(maximum, Math.floor(value || 10)));

// The scheduler acts under the current explicitly configured council manager.
async function enabledContext(db: D1Database, councilId: string): Promise<ContextRow | null> {
  return db.prepare(`SELECT s.*,c.name,c.state,
    (SELECT json_group_array(postcode) FROM (SELECT postcode FROM council_postcodes WHERE council_id=c.id AND state=c.state ORDER BY postcode)) postcodes_json
    FROM council_monthly_report_settings s JOIN council_organisations c ON c.id=s.council_id
    WHERE s.council_id=? AND s.enabled=1 AND c.status='active' AND EXISTS (SELECT 1 FROM council_postcodes p WHERE p.council_id=c.id AND p.state=c.state) AND EXISTS (
      SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=s.configured_by_uid
        AND m.status='active' AND m.role IN ('owner','editor'))`).bind(councilId).first<ContextRow>();
}

function scopeOf(context: ContextRow): Scope {
  const postcodes: unknown = JSON.parse(context.postcodes_json);
  if (!Array.isArray(postcodes) || postcodes.some(value => typeof value !== "string")) throw new Error("COUNCIL_MONTHLY_SCOPE_INVALID");
  const scope = { councilId: context.council_id, name: context.name, state: context.state, postcodes };
  councilMonthlyScopeKey(scope);
  return scope;
}
async function settingsRecipients(row: SettingsRow, options: CryptoOptions): Promise<string[]> {
  const value = await (options.decrypt ?? decryptProtectedPayload)(row.encrypted_payload);
  return parseCouncilMonthlySettings({ enabled: Boolean(row.enabled), recipients: value.recipients }).recipients;
}

export async function readCouncilMonthlySettings(db: D1Database, councilId: string, actorUid: string, options: CryptoOptions & { emailConfigured?: boolean } = {}): Promise<CouncilMonthlySettings | null> {
  const member = await db.prepare(`SELECT m.role FROM council_memberships m JOIN council_organisations c ON c.id=m.council_id
    WHERE c.id=? AND c.status='active' AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor','viewer')`).bind(councilId,actorUid).first<{ role: string }>();
  if (!member) return null;
  const row = await db.prepare("SELECT * FROM council_monthly_report_settings WHERE council_id=?").bind(councilId).first<SettingsRow>();
  const source = await db.prepare("SELECT source_as_of,first_observed_at FROM council_monthly_source_observations ORDER BY source_as_of DESC LIMIT 1").first<{ source_as_of: string; first_observed_at: string }>();
  const latest = await db.prepare(`SELECT r.id,r.source_as_of,r.generated_at,r.status,
    (SELECT COUNT(*) FROM council_monthly_report_deliveries d WHERE d.report_id=r.id AND d.status='accepted') accepted,
    (SELECT COUNT(*) FROM council_monthly_report_deliveries d WHERE d.report_id=r.id AND d.status='unknown') unknown,
    (SELECT COUNT(*) FROM council_monthly_report_deliveries d WHERE d.report_id=r.id AND d.status='failed') failed,
    (SELECT COUNT(*) FROM council_monthly_report_deliveries d WHERE d.report_id=r.id AND d.status='cancelled') cancelled,
    (SELECT COUNT(*) FROM council_monthly_report_deliveries d WHERE d.report_id=r.id) total
    FROM council_monthly_reports r WHERE r.council_id=? ORDER BY r.source_as_of DESC LIMIT 1`).bind(councilId).first<{ id: string; source_as_of: string; generated_at: string; status: string; accepted: number; unknown: number; failed: number; cancelled: number; total: number }>();
  const status=latest?.status==='ready' ? latest.accepted===latest.total && latest.total>0 ? "accepted" : latest.unknown ? "unknown" : latest.failed ? "failed" : latest.cancelled ? "cancelled" : "queued" : latest?.status;
  const recipients=row && member.role!=="viewer" ? await settingsRecipients(row,options) : [];
  const current=await db.prepare(`SELECT m.role FROM council_memberships m JOIN council_organisations c ON c.id=m.council_id
    WHERE c.id=? AND c.status='active' AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor','viewer')`).bind(councilId,actorUid).first<{role:string}>();
  if(!current || current.role!==member.role)return null;
  return { enabled: Boolean(row?.enabled), recipients, canManage: member.role !== "viewer",
    latestSourceAsOf: source?.source_as_of ?? null, nextEligibleAt: source ? new Date(Date.parse(source.first_observed_at) + DAY).toISOString() : null,
    lastReport: latest ? { id:latest.id,sourceAsOf: latest.source_as_of, generatedAt: latest.generated_at, status: status || latest.status, acceptedRecipients: latest.accepted, totalRecipients: latest.total } : null,
    emailConfigured: options.emailConfigured ?? serviceReminderProviderConfiguration().email.configured };
}

export async function saveCouncilMonthlySettings(db: D1Database, councilId: string, actorUid: string, input: CouncilMonthlySettingsInput, options: CryptoOptions & { now?: Date; emailConfigured?: boolean } = {}): Promise<CouncilMonthlySettings | null> {
  const clean = parseCouncilMonthlySettings(input);
  const encrypted = await (options.encrypt ?? encryptProtectedPayload)({ recipients: clean.recipients });
  const now = (options.now ?? new Date()).toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
      SELECT ?,?,'council.monthly_reports_configured','council',c.id,'Updated monthly council report delivery settings.',?,?
      FROM council_organisations c WHERE c.id=? AND ${authority}`).bind(crypto.randomUUID(),actorUid,JSON.stringify({ enabled: clean.enabled, recipientCount: clean.recipients.length }),now,councilId,actorUid),
    db.prepare(`INSERT INTO council_monthly_report_settings(council_id,enabled,encrypted_payload,configured_by_uid,updated_at)
      SELECT c.id,?,?,?,? FROM council_organisations c WHERE c.id=? AND ${authority}
      ON CONFLICT(council_id) DO UPDATE SET enabled=excluded.enabled,encrypted_payload=excluded.encrypted_payload,
        configured_by_uid=excluded.configured_by_uid,revision=council_monthly_report_settings.revision+1,updated_at=excluded.updated_at`)
      .bind(clean.enabled ? 1 : 0,encrypted,actorUid,now,councilId,actorUid),
  ]);
  if (!results[1].meta.changes) return null;
  return readCouncilMonthlySettings(db,councilId,actorUid,options);
}

export async function readCouncilMonthlyReportPdf(db: D1Database, councilId: string, actorUid: string, artifactStore: CouncilMonthlyArtifactStore, reportId?:string) {
  const profile=await readCouncilProfile(db,councilId,actorUid);
  if(!profile)return null;
  const report=await db.prepare(`SELECT * FROM council_monthly_reports WHERE council_id=? AND status='ready' ${reportId ? "AND id=?" : ""} ORDER BY source_as_of DESC LIMIT 1`).bind(councilId,...(reportId?[reportId]:[])).first<ReportRow>();
  if(!report || report.scope_key!==councilMonthlyScopeKey(profile))return null;
  const object=await artifactStore.get(report.pdf_object_key);
  if(!object)return null;
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.byteLength!==report.pdf_size_bytes || bytes.byteLength>MAX_PDF || await sha256(bytes)!==report.pdf_sha256)throw new Error("COUNCIL_MONTHLY_PDF_STORAGE_FAILED");
  const current=await readCouncilProfile(db,councilId,actorUid);
  if(!current || councilMonthlyScopeKey(current)!==report.scope_key)return null;
  return { bytes,filename:councilMonthlyFilename(profile,report.source_as_of) };
}

export async function buildCouncilMonthlyBundle(db: D1Database, scope: Scope, profile: CouncilProfile, source: CommunitySnapshot, now = new Date()): Promise<CouncilMonthlyReportBundle> {
  if(councilMonthlyScopeKey(profile)!==councilMonthlyScopeKey(scope) || !isCommunitySnapshot(source))throw new Error("COUNCIL_MONTHLY_SCOPE_INVALID");
  const input = { ...scope, period: "year" as const };
  const [tlink,enquiries] = await Promise.all([loadCouncilReport(db,input,now),loadCouncilEnquiries(db,input,now)]);
  tlink.enquiries = enquiries;
  let veu: CouncilMonthlyReportBundle["veu"] = null;
  if (scope.state === "VIC") {
    try {
      const loaded = await loadCouncilVeuSnapshot(scope.postcodes,"year", { now: now.getTime(), cache: await runtimeCouncilVeuCache() });
      veu = councilVeuReport(loaded.snapshot,scope,{ checkedAt: loaded.checkedAt, refreshFailed: loaded.refreshFailed, dataOrigin: loaded.dataOrigin },now.getTime());
    } catch { /* The PDF labels a missing official VEU source as unavailable. */ }
  }
  return { profile, community: communityReport(source,scope,"year",{ checkedAt: source.fetchedAt, refreshFailed: false, dataOrigin: "live" },now.getTime()), veu, tlink, generatedAt: now.toISOString(), demonstration: false };
}

type RunOptions = CryptoOptions & {
  db: D1Database; artifactStore: CouncilMonthlyArtifactStore; now?: Date; limit?: number;
  loadFreshSource?: () => Promise<CommunitySnapshot>;
  buildPdf: (bundle: CouncilMonthlyReportBundle) => Promise<Uint8Array>;
  buildBundle?: typeof buildCouncilMonthlyBundle;
};

async function dueCouncilMonthlySubscriptions(db: D1Database, sourceAsOf: string, current: string, limit: number) {
  return db.prepare(`SELECT s.council_id FROM council_monthly_report_settings s JOIN council_organisations c ON c.id=s.council_id
    LEFT JOIN council_monthly_reports r ON r.council_id=c.id AND r.source_as_of=?
    WHERE s.enabled=1 AND c.status='active'
      AND (SELECT COUNT(*) FROM council_postcodes p WHERE p.council_id=c.id AND p.state=c.state) BETWEEN 1 AND 100
      AND EXISTS (SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=s.configured_by_uid AND m.status='active' AND m.role IN ('owner','editor'))
      AND (r.id IS NULL OR (r.status IN ('preparing','failed') AND r.generation_attempts<4 AND (r.lease_expires_at='' OR r.lease_expires_at<=?)
        AND r.scope_key=json_array(c.id,c.state,json((SELECT json_group_array(postcode) FROM (SELECT postcode FROM council_postcodes WHERE council_id=c.id AND state=c.state ORDER BY postcode))))))
    ORDER BY s.council_id LIMIT ?`).bind(sourceAsOf,current,limit).all<{ council_id: string }>();
}

/** The frequent scheduler checks journal state only; idle calls never fetch official sources or build PDFs. */
export async function hasDueCouncilMonthlyReports(db: D1Database, now = new Date()): Promise<boolean> {
  const latest = await db.prepare("SELECT source_as_of,first_observed_at FROM council_monthly_source_observations ORDER BY source_as_of DESC LIMIT 1")
    .first<{ source_as_of: string; first_observed_at: string }>();
  if (!latest || now.getTime()-Date.parse(latest.first_observed_at)<DAY || now.getTime()-Date.parse(latest.source_as_of)>75*DAY) return false;
  const councils = await dueCouncilMonthlySubscriptions(db,latest.source_as_of,now.toISOString(),1);
  return councils.results.length>0;
}

export async function runCouncilMonthlyReports(options: RunOptions) {
  const { db,artifactStore } = options;
  const now = options.now ?? new Date(), current = now.toISOString();
  const source = await (options.loadFreshSource ?? (() => fetchCommunitySnapshot({ now: now.getTime() })))();
  if (!isCommunitySnapshot(source) || Date.parse(source.fetchedAt)>now.getTime() || now.getTime()-Date.parse(source.fetchedAt)>3600_000
    || now.getTime()-Date.parse(source.sourceAsOf)>75*DAY) throw new Error("COUNCIL_MONTHLY_FRESH_SOURCE_REQUIRED");
  const latestSource=await db.prepare("SELECT source_as_of FROM council_monthly_source_observations ORDER BY source_as_of DESC LIMIT 1").first<{source_as_of:string}>();
  if(latestSource && source.sourceAsOf<latestSource.source_as_of)throw new Error("COUNCIL_MONTHLY_SOURCE_REGRESSED");
  const sourceHash = await sha256(new TextEncoder().encode(JSON.stringify({ sourceAsOf: source.sourceAsOf, sourcePage: source.sourcePage, datasets: source.datasets.map(value=>({ id:value.id,sha256:value.sha256 })) })));
  await db.prepare(`INSERT INTO council_monthly_source_observations(source_as_of,first_observed_at,last_checked_at,snapshot_sha256)
    VALUES (?,?,?,?) ON CONFLICT(source_as_of) DO UPDATE SET last_checked_at=excluded.last_checked_at,snapshot_sha256=excluded.snapshot_sha256`).bind(source.sourceAsOf,current,current,sourceHash).run();
  const observation = await db.prepare("SELECT first_observed_at FROM council_monthly_source_observations WHERE source_as_of=?").bind(source.sourceAsOf).first<{ first_observed_at: string }>();
  if (!observation || now.getTime()-Date.parse(observation.first_observed_at)<DAY) return { sourceAsOf: source.sourceAsOf, generated: 0, failed: 0, waitingForSourceDay: true };
  const councils = await dueCouncilMonthlySubscriptions(db,source.sourceAsOf,current,clamp(options.limit));
  let generated=0,failed=0;
  for (const council of councils.results) {
    const context = await enabledContext(db,council.council_id);
    if (!context) continue;
      const scope = scopeOf(context), scopeKey = councilMonthlyScopeKey(scope);
    const id = crypto.randomUUID();
    await db.prepare(`INSERT OR IGNORE INTO council_monthly_reports(id,council_id,source_as_of,scope_key,settings_revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).bind(id,council.council_id,source.sourceAsOf,scopeKey,context.revision,current,current).run();
    const report = await db.prepare("SELECT * FROM council_monthly_reports WHERE council_id=? AND source_as_of=?").bind(council.council_id,source.sourceAsOf).first<ReportRow>();
    if (!report) continue;
    const claim = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE council_monthly_reports SET claim_token=?,lease_expires_at=?,generation_attempts=generation_attempts+1,status='preparing',updated_at=?
      WHERE id=? AND status IN ('preparing','failed') AND generation_attempts<4 AND (lease_expires_at='' OR lease_expires_at<=?)`).bind(claim,new Date(now.getTime()+10*60_000).toISOString(),current,report.id,current).run();
    if (!claimed.meta.changes) continue;
    let objectKey="";
    try {
      if (report.scope_key!==scopeKey) throw new Error("COUNCIL_MONTHLY_SCOPE_CHANGED");
      const recipients = await settingsRecipients(context,options);
      const profile = await readCouncilProfile(db,council.council_id,context.configured_by_uid);
      if (!profile || councilMonthlyScopeKey(profile)!==scopeKey) throw new Error("COUNCIL_MONTHLY_SCOPE_CHANGED");
      const bundle = await (options.buildBundle ?? buildCouncilMonthlyBundle)(db,scope,profile,source,now);
      const pdf = await options.buildPdf(bundle);
      if (pdf.byteLength<8 || pdf.byteLength>MAX_PDF || new TextDecoder().decode(pdf.subarray(0,5))!=="%PDF-") throw new Error("COUNCIL_MONTHLY_PDF_INVALID");
      const live = await enabledContext(db,council.council_id);
      if (!live || councilMonthlyScopeKey(scopeOf(live))!==scopeKey) throw new Error("COUNCIL_MONTHLY_SCOPE_CHANGED");
      if (live.revision!==context.revision) throw new Error("COUNCIL_MONTHLY_SETTINGS_CHANGED");
      const digest = await sha256(pdf);
      objectKey=`council/monthly/${council.council_id}/${report.id}/${crypto.randomUUID()}.pdf`;
      await artifactStore.put(objectKey,Uint8Array.from(pdf).buffer,{ httpMetadata:{ contentType:"application/pdf" },customMetadata:{ councilId:council.council_id,sourceAsOf:source.sourceAsOf,sha256:digest } });
      const retained = await artifactStore.get(objectKey);
      if (!retained || await sha256(new Uint8Array(await retained.arrayBuffer()))!==digest) throw new Error("COUNCIL_MONTHLY_PDF_STORAGE_FAILED");
      const message: FrozenMessage = { recipients, subject:`${profile.name}: monthly energy progress`,
        body:`Your council energy progress report is attached. It includes the latest CER release through ${source.sourceAsOf}, your selected postcodes, available business and residential activity data and the coverage behind each figure.\n\nPrepared by TLink. Change monthly report recipients in your council workspace.`, filename:councilMonthlyFilename(profile,source.sourceAsOf) };
      const encrypted = await (options.encrypt ?? encryptProtectedPayload)(message);
      const recipientHashes = await Promise.all(recipients.map(email=>(options.recipientHash ?? keyedProtectedAuditHash)("council-monthly-recipient",`${council.council_id}|${email}`)));
      const finalContext = await enabledContext(db,council.council_id);
      if (!finalContext || councilMonthlyScopeKey(scopeOf(finalContext))!==scopeKey) throw new Error("COUNCIL_MONTHLY_SCOPE_CHANGED");
      if (finalContext.revision!==context.revision) throw new Error("COUNCIL_MONTHLY_SETTINGS_CHANGED");
      const result = await db.batch([
        db.prepare(`UPDATE council_monthly_reports AS r SET status='ready',settings_revision=?,encrypted_payload=?,pdf_object_key=?,pdf_sha256=?,pdf_size_bytes=?,generated_at=?,claim_token='',lease_expires_at='',updated_at=?
          WHERE r.id=? AND r.status='preparing' AND r.claim_token=? AND EXISTS (
            SELECT 1 FROM council_monthly_report_settings s JOIN council_organisations c ON c.id=s.council_id
            WHERE s.council_id=r.council_id AND s.enabled=1 AND s.revision=? AND c.status='active'
              AND EXISTS (SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=s.configured_by_uid AND m.status='active' AND m.role IN ('owner','editor'))
              AND json_array(c.id,c.state,json((SELECT json_group_array(postcode) FROM (SELECT postcode FROM council_postcodes WHERE council_id=c.id AND state=c.state ORDER BY postcode))))=r.scope_key
          )`).bind(context.revision,encrypted,objectKey,digest,pdf.byteLength,current,current,report.id,claim,context.revision),
        ...recipients.map((_,index)=>db.prepare(`INSERT OR IGNORE INTO council_monthly_report_deliveries(id,report_id,recipient_index,recipient_hash,created_at,updated_at)
          SELECT ?,r.id,?,?,?,? FROM council_monthly_reports r WHERE r.id=? AND r.status='ready' AND r.pdf_object_key=?`).bind(crypto.randomUUID(),index,recipientHashes[index],current,current,report.id,objectKey)),
      ]);
      if (!result[0].meta.changes) {
        const latest = await enabledContext(db,council.council_id);
        if (!latest || councilMonthlyScopeKey(scopeOf(latest))!==scopeKey) throw new Error("COUNCIL_MONTHLY_SCOPE_CHANGED");
        if (latest.revision!==context.revision) throw new Error("COUNCIL_MONTHLY_SETTINGS_CHANGED");
        throw new Error("COUNCIL_MONTHLY_CLAIM_LOST");
      }
      objectKey=""; generated++;
    } catch (error) {
      if (objectKey) await artifactStore.delete(objectKey).catch(()=>undefined);
      const cancelled = error instanceof Error && error.message==="COUNCIL_MONTHLY_SCOPE_CHANGED";
      const invalidated = error instanceof Error && error.message==="COUNCIL_MONTHLY_SETTINGS_CHANGED";
      await db.prepare(`UPDATE council_monthly_reports SET status=?,generation_attempts=generation_attempts-?,claim_token='',lease_expires_at='',updated_at=? WHERE id=? AND claim_token=? AND status='preparing'`)
        .bind(cancelled ? "cancelled" : "failed",invalidated ? 1 : 0,current,report.id,claim).run();
      failed++;
    }
  }
  return { sourceAsOf:source.sourceAsOf,generated,failed,waitingForSourceDay:false };
}

function frozenMessage(value: Record<string,unknown>): FrozenMessage {
  const recipients = parseCouncilMonthlySettings({ enabled:true,recipients:value.recipients }).recipients;
  if (typeof value.subject!=="string" || typeof value.body!=="string" || typeof value.filename!=="string" || value.subject.length>220 || value.body.length>3000 || !/^[a-zA-Z0-9-]+\.pdf$/.test(value.filename)) throw new Error("COUNCIL_MONTHLY_PAYLOAD_INVALID");
  return { recipients,subject:value.subject,body:value.body,filename:value.filename };
}
const base64 = (bytes: Uint8Array) => { let value=""; for (let i=0;i<bytes.length;i+=8192) value+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(value); };

export async function drainCouncilMonthlyReportEmails(options: CryptoOptions & { db:D1Database;artifactStore:CouncilMonthlyArtifactStore;now?:Date;limit?:number;emailConfigured?:boolean;sendEmail?:Sender }) {
  const { db,artifactStore }=options,now=options.now??new Date(),current=now.toISOString();
  if (!(options.emailConfigured??serviceReminderProviderConfiguration().email.configured)) return { attempted:0,accepted:0,failed:0,cancelled:0 };
  const cutoff=new Date(now.getTime()-RETRY_WINDOW).toISOString();
  // A crashed sender can only replay the same encrypted message and idempotency key within the provider's retention window.
  await db.prepare(`UPDATE council_monthly_report_deliveries SET status=CASE WHEN first_attempt_at>? AND attempts<4 THEN 'retry' ELSE 'unknown' END,
    claim_token='',lease_expires_at='',next_attempt_at=?,failure_code='DELIVERY_INTERRUPTED',updated_at=? WHERE status='sending' AND lease_expires_at<>'' AND lease_expires_at<=?`).bind(cutoff,current,current,current).run();
  await db.prepare(`UPDATE council_monthly_report_deliveries SET status='unknown',failure_code='IDEMPOTENCY_WINDOW_EXPIRED',next_attempt_at='',updated_at=? WHERE status='retry' AND first_attempt_at<>'' AND first_attempt_at<=?`).bind(current,cutoff).run();
  const rows=await db.prepare(`SELECT d.* FROM council_monthly_report_deliveries d JOIN council_monthly_reports r ON r.id=d.report_id AND r.status='ready'
    WHERE d.status IN ('queued','retry') AND d.attempts<4 AND (d.next_attempt_at='' OR d.next_attempt_at<=?) ORDER BY d.created_at,d.id LIMIT ?`).bind(current,clamp(options.limit,100)).all<DeliveryRow>();
  let attempted=0,accepted=0,failed=0,cancelled=0;
  for (const delivery of rows.results) {
    const claim=crypto.randomUUID();
    const claimed=await db.prepare(`UPDATE council_monthly_report_deliveries SET status='sending',attempts=attempts+1,first_attempt_at=CASE WHEN first_attempt_at='' THEN ? ELSE first_attempt_at END,
      claim_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND status IN ('queued','retry') AND attempts=? AND (next_attempt_at='' OR next_attempt_at<=?)`)
      .bind(current,claim,new Date(now.getTime()+120_000).toISOString(),current,delivery.id,delivery.attempts,current).run();
    if (!claimed.meta.changes) continue;
    let providerStarted=false,providerAccepted=false;
    try {
      const report=await db.prepare("SELECT * FROM council_monthly_reports WHERE id=? AND status='ready'").bind(delivery.report_id).first<ReportRow>();
      if (!report) throw new Error("COUNCIL_MONTHLY_CANCELLED");
      const frozen=frozenMessage(await (options.decrypt??decryptProtectedPayload)(report.encrypted_payload));
      const email=frozen.recipients[delivery.recipient_index];
      if (!email || await (options.recipientHash??keyedProtectedAuditHash)("council-monthly-recipient",`${report.council_id}|${email}`)!==delivery.recipient_hash) throw new Error("COUNCIL_MONTHLY_PAYLOAD_INVALID");
      const context=await enabledContext(db,report.council_id);
      if (!context || councilMonthlyScopeKey(scopeOf(context))!==report.scope_key || !(await settingsRecipients(context,options)).includes(email)) throw new Error("COUNCIL_MONTHLY_CANCELLED");
      const object=await artifactStore.get(report.pdf_object_key);
      if (!object) throw new Error("COUNCIL_MONTHLY_PDF_STORAGE_FAILED");
      const pdf=new Uint8Array(await object.arrayBuffer());
      if (pdf.byteLength!==report.pdf_size_bytes || pdf.byteLength>MAX_PDF || await sha256(pdf)!==report.pdf_sha256) throw new Error("COUNCIL_MONTHLY_PDF_STORAGE_FAILED");
      const attachment=base64(pdf);
      // Recheck immediately before provider dispatch, after potentially slow storage/decryption.
      const latest=await enabledContext(db,report.council_id);
      if (!latest || councilMonthlyScopeKey(scopeOf(latest))!==report.scope_key || !(await settingsRecipients(latest,options)).includes(email)) throw new Error("COUNCIL_MONTHLY_CANCELLED");
      const authorityCheck=await db.prepare(`UPDATE council_monthly_report_deliveries AS d SET lease_expires_at=? WHERE d.id=? AND d.status='sending' AND d.claim_token=? AND EXISTS (
        SELECT 1 FROM council_monthly_reports r JOIN council_monthly_report_settings s ON s.council_id=r.council_id JOIN council_organisations c ON c.id=r.council_id
        WHERE r.id=d.report_id AND r.status='ready' AND s.enabled=1 AND s.revision=? AND c.status='active'
          AND EXISTS (SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=s.configured_by_uid AND m.status='active' AND m.role IN ('owner','editor'))
          AND json_array(c.id,c.state,json((SELECT json_group_array(postcode) FROM (SELECT postcode FROM council_postcodes WHERE council_id=c.id AND state=c.state ORDER BY postcode))))=r.scope_key
        )`).bind(new Date(now.getTime()+120_000).toISOString(),delivery.id,claim,latest.revision).run();
      if(!authorityCheck.meta.changes)throw new Error("COUNCIL_MONTHLY_CANCELLED");
      providerStarted=true; attempted++;
      const result=await (options.sendEmail??sendServiceReminderProviderMessage)({ channel:"email",recipient:email,subject:frozen.subject,body:frozen.body,
        idempotencyKey:`council-monthly-${delivery.id}`,callbackUrl:"",messageType:"council_monthly_report",attachments:[{ filename:frozen.filename,content:attachment,contentType:"application/pdf" }] });
      if (!result.providerMessageId) throw new Error("COUNCIL_MONTHLY_PROVIDER_RECEIPT_MISSING");
      providerAccepted=true;
      const saved=await db.prepare(`UPDATE council_monthly_report_deliveries SET status='accepted',provider_message_id=?,accepted_at=?,claim_token='',lease_expires_at='',next_attempt_at='',failure_code='',updated_at=? WHERE id=? AND status='sending' AND claim_token=?`)
        .bind(result.providerMessageId,current,current,delivery.id,claim).run();
      if (saved.meta.changes) accepted++;
    } catch (error) {
      const isCancelled=error instanceof Error && error.message==="COUNCIL_MONTHLY_CANCELLED";
      const indeterminate=providerStarted && (providerAccepted || reminderProviderFailureOutcome(error)==="indeterminate" || error instanceof Error && error.message==="COUNCIL_MONTHLY_PROVIDER_RECEIPT_MISSING");
      const first=delivery.first_attempt_at||current;
      const canRetry=indeterminate && delivery.attempts+1<4 && now.getTime()-Date.parse(first)<RETRY_WINDOW;
      const status=isCancelled?"cancelled":canRetry?"retry":indeterminate?"unknown":"failed";
      await db.prepare(`UPDATE council_monthly_report_deliveries SET status=?,failure_code=?,next_attempt_at=?,claim_token='',lease_expires_at='',updated_at=? WHERE id=? AND status='sending' AND claim_token=?`)
        .bind(status,isCancelled?"SETTINGS_OR_SCOPE_CHANGED":indeterminate?"PROVIDER_OUTCOME_UNCONFIRMED":"DELIVERY_FAILED",canRetry?new Date(now.getTime()+[5,30,120][Math.min(delivery.attempts,2)]*60_000).toISOString():"",current,delivery.id,claim).run();
      if(isCancelled)cancelled++;else failed++;
    }
  }
  return { attempted,accepted,failed,cancelled };
}
