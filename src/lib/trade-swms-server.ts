import { jobMemberSql } from "./trade-job-collaboration.ts";
import { messageActorGuard } from "./trade-message-media-access.ts";
import { jobSyncChangeStatements, nextJobRevision } from "./trade-team-sync-server.ts";
import { SWMS_TEMPLATE, emptySwmsAnswers, type SwmsAnswers, type SwmsContext, type SwmsPayload, type SwmsRecord, type SwmsSignatureStroke } from "./trade-swms.ts";
import type { TeamAccess } from "./trade-team-server";

export class SwmsError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
type Row = { id: string; firebase_uid: string; work_order_id: string; template_key: string; template_name: string; template_version: number;
  template_snapshot: string; context_json: string; answers_json: string; signature_json: string; status: "draft" | "complete"; revision: number;
  last_request_sha256: string; snapshot_sha256: string; last_actor_uid: string; last_actor_member_id: string; completed_at: string; created_at: string; updated_at: string };
type Visit = { id: string; memberId: string; name: string };
type ContextSnapshot = Omit<SwmsContext, "scheduledWorker" | "signer"> & { leadId: string; leadName: string; signerId: string; signerName: string; visits: Visit[] };
type Job = { id: string; stage: string; pipeline_stage: string; revision: number; assignee_member_id: string; can_manage: number; context_snapshot: string; context: SwmsContext };

const JOB_FROM = `FROM trade_work_orders w JOIN trade_accounts business ON business.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_service_sites site ON site.id=d.service_site_id AND site.firebase_uid=w.firebase_uid
    AND site.customer_id=d.crm_customer_id AND site.record_status='active'
  LEFT JOIN trade_team_members lead ON lead.id=w.assignee_member_id AND lead.owner_uid=w.firebase_uid AND lead.status='active'
  JOIN trade_team_members swms_actor ON swms_actor.id=? AND swms_actor.owner_uid=w.firebase_uid`;
const CONTEXT_SQL = `json_object('businessName',business.business_name,'abn',COALESCE(NULLIF(business.verified_abn,''),business.abn),
  'workNumber',w.work_number,'jobTitle',CASE WHEN w.source_type='opportunity' OR d.customer_source='platform_private' THEN 'Protected job' ELSE w.title END,
  'siteAddress',CASE WHEN w.source_type<>'opportunity' AND d.customer_source IN ('trade_owned','public_lead_released')
    THEN trim(COALESCE(site.address_line_1,'') || ' ' || COALESCE(site.address_line_2,'') || ' ' || COALESCE(site.suburb,'') || ' ' || COALESCE(site.address_state,'') || ' ' || COALESCE(site.postcode,'')) ELSE '' END,
  'leadId',COALESCE(lead.id,''),'leadName',COALESCE(lead.display_name,''),'signerId',swms_actor.id,'signerName',swms_actor.display_name,
  'visits',json(COALESCE((SELECT json_group_array(json(ordered_visit.item)) FROM (
    SELECT json_object('id',visit.id,'memberId',worker.id,'name',worker.display_name) item
    FROM trade_crm_appointments visit JOIN trade_team_members worker ON worker.id=visit.assignee_member_id
      AND worker.owner_uid=visit.firebase_uid AND worker.status='active'
    WHERE visit.work_order_id=w.id AND visit.firebase_uid=w.firebase_uid AND visit.status IN ('scheduled','en_route','arrived','in_progress')
    ORDER BY CASE visit.status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 ELSE 3 END,visit.starts_at,visit.id
  ) ordered_visit),'[]')))`;

function accessSql(access: TeamAccess, write = false) {
  const actor = messageActorGuard(access);
  return { sql: `${actor.sql} AND swms_actor.can_view_field_evidence=1 ${write ? "AND swms_actor.can_manage_field_evidence=1" : ""}
    AND (swms_actor.member_uid=swms_actor.owner_uid OR (
      swms_actor.job_scope='team' AND NOT EXISTS (SELECT 1 FROM trade_crew_members restriction
        WHERE restriction.owner_uid=swms_actor.owner_uid AND restriction.member_id=swms_actor.id)) OR ${jobMemberSql("w", "swms_actor.id")})`, values: actor.values };
}
async function currentJob(db: D1Database, access: TeamAccess, workOrderId: string): Promise<Job> {
  const guard = accessSql(access);
  const row = await db.prepare(`SELECT w.id,w.stage,w.revision,w.assignee_member_id,COALESCE(d.pipeline_stage,'') pipeline_stage,
    swms_actor.can_manage_field_evidence can_manage,${CONTEXT_SQL} context_snapshot ${JOB_FROM}
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND ${guard.sql}`)
    .bind(access.memberId, workOrderId, access.ownerUid, ...guard.values).first<Omit<Job, "context">>();
  if (!row) throw new SwmsError("This job is unavailable or outside your current field access.", 403);
  const snapshot: ContextSnapshot = JSON.parse(row.context_snapshot);
  const visit = snapshot.visits.find(item => item.memberId === access.memberId)
    || snapshot.visits.find(item => item.memberId === snapshot.leadId) || snapshot.visits[0];
  const scheduledWorker: SwmsContext["scheduledWorker"] = visit ? { memberId: visit.memberId, name: visit.name, appointmentId: visit.id, source: "appointment" }
    : snapshot.leadId ? { memberId: snapshot.leadId, name: snapshot.leadName, appointmentId: "", source: "job" }
      : { memberId: "", name: "", appointmentId: "", source: "unassigned" };
  return { ...row, context: { businessName: snapshot.businessName, abn: snapshot.abn, workNumber: snapshot.workNumber,
    jobTitle: snapshot.jobTitle, siteAddress: snapshot.siteAddress, scheduledWorker, signer: { memberId: snapshot.signerId, name: snapshot.signerName } } };
}
function capabilities(job: Job, row: Row | null): SwmsPayload["capabilities"] {
  if (row?.status === "complete") return { canEdit: false, canSign: false, reason: "This signed SWMS is retained with the job and cannot be changed." };
  if (["imported", "completed", "cancelled"].includes(job.stage) || ["lost", "imported", "complete", "invoiced", "paid"].includes(job.pipeline_stage))
    return { canEdit: false, canSign: false, reason: "This job is closed or has not been started in TLink. Its SWMS is read-only." };
  if (!job.can_manage) return { canEdit: false, canSign: false, reason: "Your current team access allows viewing this SWMS only." };
  if (!job.context.scheduledWorker.memberId) return { canEdit: true, canSign: false, reason: "Assign this job to a team member before signing." };
  if (job.context.scheduledWorker.memberId !== job.context.signer.memberId) return { canEdit: true, canSign: false,
    reason: `${job.context.scheduledWorker.name || "The assigned worker"} must sign in to review and sign this SWMS.` };
  return { canEdit: true, canSign: true };
}
function record(row: Row, currentContext?: SwmsContext): SwmsRecord {
  return { id: row.id, workOrderId: row.work_order_id, templateName: row.template_name, templateVersion: Number(row.template_version),
    status: row.status, revision: Number(row.revision), answers: JSON.parse(row.answers_json),
    context: row.status === "draft" && currentContext ? currentContext : JSON.parse(row.context_json),
    signature: row.signature_json ? JSON.parse(row.signature_json) : null, completedAt: row.completed_at,
    pdfUrl: row.status === "complete" ? `/api/trade-swms?workOrderId=${encodeURIComponent(row.work_order_id)}&download=1` : "",
    createdAt: row.created_at, updatedAt: row.updated_at };
}
async function saved(db: D1Database, access: TeamAccess, workOrderId: string) {
  return db.prepare("SELECT * FROM trade_job_swms WHERE work_order_id=? AND firebase_uid=?").bind(workOrderId, access.ownerUid).first<Row>();
}
export async function loadSwms(db: D1Database, access: TeamAccess, workOrderId: string): Promise<SwmsPayload> {
  const job = await currentJob(db, access, workOrderId), row = await saved(db, access, workOrderId);
  return { ok: true, jobRevision: Number(job.revision), template: row ? JSON.parse(row.template_snapshot) : SWMS_TEMPLATE,
    context: job.context, record: row ? record(row, job.context) : null, capabilities: capabilities(job, row) };
}

function mutationGuard(db: D1Database, access: TeamAccess, job: Job, now: string, row?: Row) {
  const actor = accessSql(access, true);
  return db.prepare(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at)
    SELECT ?,?,?,'online_mutation_guard',NULL,? WHERE NOT EXISTS (SELECT 1 ${JOB_FROM}
      WHERE w.id=? AND w.firebase_uid=? AND w.record_status='active' AND w.partner_type='installer'
        AND w.revision=? AND w.stage=? AND COALESCE(d.pipeline_stage,'')=? AND ${CONTEXT_SQL}=? AND ${actor.sql}
        ${row ? "AND EXISTS (SELECT 1 FROM trade_job_swms current_swms WHERE current_swms.id=? AND current_swms.firebase_uid=w.firebase_uid AND current_swms.work_order_id=w.id AND current_swms.status='draft' AND current_swms.revision=?)" : "AND NOT EXISTS (SELECT 1 FROM trade_job_swms current_swms WHERE current_swms.firebase_uid=w.firebase_uid AND current_swms.work_order_id=w.id)"})`)
    .bind(crypto.randomUUID(), job.id, access.ownerUid, now, access.memberId, job.id, access.ownerUid, job.revision, job.stage, job.pipeline_stage,
      job.context_snapshot, ...actor.values, ...(row ? [row.id, row.revision] : []));
}
const conflict = () => new SwmsError("This job or SWMS changed. Refresh it before saving.");
function revision(value: unknown, expected: number) { if (!Number.isSafeInteger(value) || value !== expected) throw conflict(); }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function swmsAnswers(value: unknown, complete = false): SwmsAnswers {
  if (!isObject(value)) throw new SwmsError("Complete the SWMS fields before saving.", 400);
  const result = emptySwmsAnswers();
  for (const field of SWMS_TEMPLATE.fields) {
    const answer = value[field.key];
    if (typeof answer !== "string" || answer.length > 4000 || (complete && !answer.trim())) throw new SwmsError(`${field.label} must ${complete ? "be completed and " : ""}contain no more than 4,000 characters.`, 400);
    result[field.key] = answer.trim();
  }
  return result;
}
export function swmsSignature(value: unknown): readonly SwmsSignatureStroke[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new SwmsError("Draw your signature before signing.", 400);
  let count = 0, distance = 0;
  const strokes: SwmsSignatureStroke[] = [];
  for (const stroke of value) {
    if (!isObject(stroke) || !Array.isArray(stroke.points) || !stroke.points.length || (count += stroke.points.length) > 10000) throw new SwmsError("The signature has too many points or is invalid. Clear it and sign again.", 400);
    const points: SwmsSignatureStroke["points"][number][] = [];
    for (const point of stroke.points) {
      if (!isObject(point) || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1
        || (point.pressure !== null && (typeof point.pressure !== "number" || !Number.isFinite(point.pressure) || point.pressure < 0 || point.pressure > 1))
        || typeof point.capturedAtOffsetMs !== "number" || !Number.isSafeInteger(point.capturedAtOffsetMs) || point.capturedAtOffsetMs < 0 || point.capturedAtOffsetMs > 3600000)
        throw new SwmsError("The signature is invalid. Clear it and sign again.", 400);
      const prior = points.at(-1);
      if (prior) distance += Math.hypot(point.x - prior.x, point.y - prior.y);
      points.push({ x: point.x, y: point.y, pressure: point.pressure, capturedAtOffsetMs: point.capturedAtOffsetMs });
    }
    strokes.push({ points });
  }
  if (distance < 0.02) throw new SwmsError("Draw your signature inside the box. A dot is not a signature.", 400);
  return strokes;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function signedSnapshot(row: Pick<Row, "id" | "work_order_id" | "template_snapshot" | "context_json" | "answers_json" | "signature_json" | "completed_at">) {
  return JSON.stringify({ id: row.id, workOrderId: row.work_order_id, template: JSON.parse(row.template_snapshot), context: JSON.parse(row.context_json),
    answers: JSON.parse(row.answers_json), signature: JSON.parse(row.signature_json), completedAt: row.completed_at });
}
export async function startSwms(db: D1Database, access: TeamAccess, workOrderId: string, expectedJobRevision: unknown, now = new Date().toISOString()): Promise<SwmsPayload> {
  const job = await currentJob(db, access, workOrderId);
  if (await saved(db, access, workOrderId)) return { ...await loadSwms(db, access, workOrderId), duplicate: true };
  const permission = capabilities(job, null);
  if (!permission.canEdit) throw new SwmsError(permission.reason || "This SWMS is read-only.", 403);
  revision(expectedJobRevision, Number(job.revision));
  const answers = emptySwmsAnswers();
  if (job.context.jobTitle !== "Protected job") answers.workDescription = job.context.jobTitle;
  try {
    await db.batch([mutationGuard(db, access, job, now), db.prepare(`INSERT INTO trade_job_swms
      (id,firebase_uid,work_order_id,template_key,template_name,template_version,template_snapshot,context_json,answers_json,last_actor_uid,last_actor_member_id,created_by_uid,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), access.ownerUid, workOrderId, SWMS_TEMPLATE.key, SWMS_TEMPLATE.name, SWMS_TEMPLATE.version,
        JSON.stringify(SWMS_TEMPLATE), JSON.stringify(job.context), JSON.stringify(answers), access.actorUid, access.memberId, access.actorUid, now, now)]);
  } catch (error) {
    if (await saved(db, access, workOrderId)) return { ...await loadSwms(db, access, workOrderId), duplicate: true };
    if (error instanceof Error && /NOT NULL|UNIQUE constraint/.test(error.message)) throw conflict();
    throw error;
  }
  return loadSwms(db, access, workOrderId);
}
export async function saveSwms(db: D1Database, access: TeamAccess, input: Record<string, unknown>, now = new Date().toISOString()): Promise<SwmsPayload> {
  const workOrderId = typeof input.workOrderId === "string" ? input.workOrderId : "";
  const job = await currentJob(db, access, workOrderId), row = await saved(db, access, workOrderId);
  if (!row || row.id !== input.id) throw new SwmsError("Start this job's SWMS before saving.", 404);
  if (input.finalize !== undefined && typeof input.finalize !== "boolean") throw new SwmsError("Choose save draft or sign SWMS.", 400);
  const complete = input.finalize === true, answers = swmsAnswers(input.answers, complete), strokes = complete ? swmsSignature(input.signature) : [];
  const requestHash = await sha256(JSON.stringify({ id: row.id, expectedRevision: input.expectedRevision, expectedJobRevision: input.expectedJobRevision, answers, complete, strokes, actor: access.actorUid, member: access.memberId }));
  const replay = (value: Row | null) => value && value.last_request_sha256 === requestHash && value.last_actor_uid === access.actorUid
    && value.last_actor_member_id === access.memberId && value.revision === Number(input.expectedRevision) + 1;
  if (replay(row)) return { ...await loadSwms(db, access, workOrderId), duplicate: true };
  const permission = capabilities(job, row);
  if (!permission.canEdit || (complete && !permission.canSign)) throw new SwmsError(permission.reason || "This SWMS is read-only.", 403);
  revision(input.expectedRevision, Number(row.revision)); revision(input.expectedJobRevision, Number(job.revision));
  const signature = complete ? { strokes, signerName: job.context.signer.name, signerMemberId: access.memberId, signedAt: now } : null;
  const next = { ...row, context_json: JSON.stringify(job.context), answers_json: JSON.stringify(answers), signature_json: signature ? JSON.stringify(signature) : "", completed_at: complete ? now : "" };
  const snapshotHash = complete ? await sha256(signedSnapshot(next)) : "";
  const jobRevision = complete ? nextJobRevision(job.revision) : Number(job.revision);
  try {
    await db.batch([mutationGuard(db, access, job, now, row), db.prepare(`UPDATE trade_job_swms SET context_json=?,answers_json=?,signature_json=?,status=?,revision=revision+1,
      last_request_sha256=?,snapshot_sha256=?,last_actor_uid=?,last_actor_member_id=?,completed_at=?,updated_at=? WHERE id=? AND firebase_uid=?`)
      .bind(next.context_json, next.answers_json, next.signature_json, complete ? "complete" : "draft", requestHash, snapshotHash, access.actorUid, access.memberId, next.completed_at, now, row.id, access.ownerUid),
    ...(complete ? [db.prepare("UPDATE trade_work_orders SET revision=?,updated_at=? WHERE id=? AND firebase_uid=?").bind(jobRevision, now, workOrderId, access.ownerUid),
      db.prepare(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at) VALUES (?,?,?,'swms_signed',?,?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `SWMS signed by ${job.context.signer.name}. Optional job document retained.`, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision, changedAt: now, audienceMemberId: job.assignee_member_id })] : [])]);
  } catch (error) {
    if (replay(await saved(db, access, workOrderId))) return { ...await loadSwms(db, access, workOrderId), duplicate: true };
    if (error instanceof Error && /NOT NULL|UNIQUE constraint/.test(error.message)) throw conflict();
    throw error;
  }
  return loadSwms(db, access, workOrderId);
}
export async function swmsPdfRecord(db: D1Database, access: TeamAccess, workOrderId: string) {
  await currentJob(db, access, workOrderId);
  const row = await saved(db, access, workOrderId);
  if (!row || row.status !== "complete") throw new SwmsError("Sign the SWMS before downloading its PDF.", 404);
  if (await sha256(signedSnapshot(row)) !== row.snapshot_sha256) throw new SwmsError("This signed record could not be verified.", 409);
  return { record: record(row), template: JSON.parse(row.template_snapshot) as typeof SWMS_TEMPLATE, sha256: row.snapshot_sha256 };
}
