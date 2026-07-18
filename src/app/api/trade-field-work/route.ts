import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MEDIA_CATEGORIES = new Set(["before", "progress", "after", "document"]);
const SIGNER_ROLES = new Set(["technician", "customer"]);

type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

function safeName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "job-file";
}

function fieldError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Field tools are available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using field tools." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not assigned to your team account." }, 403);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Field tools require team access on the installer account." }, 403);
  if (code === "PROTECTED_CUSTOMER") return adminJson({ ok: false, error: "Customer sign-off for an AEA protected job must stay in the AEA customer pathway." }, 403);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Job file storage is not available." }, 503);
  return adminJson({ ok: false, error: "The field-work record could not be completed." }, 500);
}

async function payload(firebaseUid: string, workOrderId: string) {
  const db = getD1();
  const [time, media, signoffs] = await Promise.all([
    db.prepare(`SELECT id, staff_label, work_date, duration_minutes, notes, created_at
      FROM trade_crm_time_entries WHERE firebase_uid = ? AND work_order_id = ? ORDER BY work_date DESC, created_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, category, file_name, content_type, size_bytes, caption, source, photo_requirement_id,
      request_revision, checklist_version, customer_acknowledged_at, created_at
      FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? ORDER BY created_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, signer_role, signer_name, confirmation_text, method, signed_at
      FROM trade_crm_signoffs WHERE firebase_uid = ? AND work_order_id = ? ORDER BY signed_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
  ]);
  return {
    timeEntries: time.results.map((row) => ({ id: row.id, staffLabel: row.staff_label, workDate: row.work_date,
      durationMinutes: Number(row.duration_minutes), notes: row.notes, createdAt: row.created_at })),
    media: media.results.map((row) => ({ id: row.id, category: row.category, fileName: row.file_name,
      contentType: row.content_type, sizeBytes: Number(row.size_bytes), caption: row.caption, source: row.source,
      photoRequirementId: row.photo_requirement_id, requestRevision: Number(row.request_revision || 0),
      checklistVersion: row.checklist_version, customerAcknowledgedAt: row.customer_acknowledged_at, createdAt: row.created_at })),
    signoffs: signoffs.results.map((row) => ({ id: row.id, signerRole: row.signer_role, signerName: row.signer_name,
      confirmationText: row.confirmation_text, method: row.method, signedAt: row.signed_at })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const url = new URL(request.url);
    const downloadId = cleanAdminText(url.searchParams.get("download"), 180);
    if (downloadId) {
      const record = await getD1().prepare(`SELECT m.object_key, m.file_name, m.content_type, m.work_order_id FROM trade_crm_job_media m
        JOIN trade_work_orders w ON w.id = m.work_order_id
        WHERE m.id = ? AND m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(downloadId, access.ownerUid, access.ownerUid).first<{ object_key: string; file_name: string; content_type: string; work_order_id: string }>();
      if (!record) return adminJson({ ok: false, error: "Job file not found." }, 404);
      await assignedJob(access, record.work_order_id);
      const object = await bucket().get(record.object_key);
      if (!object) return adminJson({ ok: false, error: "Stored job file not found." }, 404);
      return new Response(object.body, { headers: { "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${safeName(record.file_name)}"`,
        "Content-Type": object.httpMetadata?.contentType || record.content_type, "X-Content-Type-Options": "nosniff" } });
    }
    const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    const job = await assignedJob(access, workOrderId);
    return adminJson({ ok: true, protectedJob: job.source_type === "opportunity", revision: Number(job.revision),
      ...(await payload(access.ownerUid, workOrderId)) });
  } catch (error) { return fieldError(error); }
}

async function upload(request: Request, access: TeamAccess) {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return adminJson({ ok: false, error: "The job upload could not be read." }, 400); }
  const workOrderId = cleanAdminText(form.get("workOrderId"), 180);
  const job = await assignedJob(access, workOrderId);
  const file = form.get("file");
  const categoryValue = cleanAdminText(form.get("category"), 20);
  const category = MEDIA_CATEGORIES.has(categoryValue) ? categoryValue : "progress";
  if (!(file instanceof File) || !file.name) return adminJson({ ok: false, error: "Choose a photo or PDF." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return adminJson({ ok: false, error: "Upload a JPEG, PNG, WebP or PDF file." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return adminJson({ ok: false, error: "The file must be no larger than 8 MB." }, 400);
  const id = crypto.randomUUID();
  const objectKey = `crm-job-media/${access.ownerUid}/${workOrderId}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const revision = nextJobRevision(job.revision);
  const store = bucket();
  await store.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type },
    customMetadata: { owner: access.ownerUid, actor: access.actorUid, workOrderId, mediaId: id } });
  try {
    await getD1().batch([
      getD1().prepare(`INSERT INTO trade_crm_job_media
        (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, workOrderId, access.ownerUid, category, safeName(file.name), file.type, file.size, objectKey,
          cleanAdminText(form.get("caption"), 300), now, now),
      getD1().prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'field_file_added', 'Field photo or document added.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: job.assignee_member_id }),
    ]);
  } catch (error) { await store.delete(objectKey); throw error; }
  return adminJson({ ok: true, revision, ...(await payload(access.ownerUid, workOrderId)) }, 201);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) return await upload(request, access);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid field-work request." }, 400); }
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await assignedJob(access, workOrderId);
    const action = cleanAdminText(body.action, 30);
    const now = new Date().toISOString();
    let recordStatement: D1PreparedStatement;
    if (action === "add_time") {
      const duration = Number(body.durationMinutes);
      const workDate = cleanAdminText(body.workDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
        return adminJson({ ok: false, error: "Add a valid work date and between 1 minute and 24 hours." }, 400);
      }
      recordStatement = getD1().prepare(`INSERT INTO trade_crm_time_entries
        (id, work_order_id, firebase_uid, staff_label, work_date, duration_minutes, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, access.isOwner ? cleanAdminText(body.staffLabel, 80) : access.displayName, workDate,
          duration, cleanAdminText(body.notes, 500), now, now);
    } else if (action === "add_signoff") {
      const signerRole = cleanAdminText(body.signerRole, 20);
      const signerName = cleanAdminText(body.signerName, 100);
      if (!SIGNER_ROLES.has(signerRole) || !signerName || body.confirmed !== true) {
        return adminJson({ ok: false, error: "Choose the signer, enter their name and confirm the statement." }, 400);
      }
      if (job.source_type === "opportunity" && signerRole === "customer") throw new Error("PROTECTED_CUSTOMER");
      const confirmation = signerRole === "customer"
        ? "I confirm the recorded work has been presented to me for review."
        : "I confirm the field record is accurate to the best of my knowledge.";
      recordStatement = getD1().prepare(`INSERT INTO trade_crm_signoffs
        (id, work_order_id, firebase_uid, signer_role, signer_name, confirmation_text, method, signed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'typed', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, signerRole, signerName, confirmation, now, now);
    } else return adminJson({ ok: false, error: "Unsupported field-work action." }, 400);
    const revision = nextJobRevision(job.revision);
    await getD1().batch([
      recordStatement,
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: job.assignee_member_id }),
    ]);
    return adminJson({ ok: true, protectedJob: job.source_type === "opportunity", revision,
      ...(await payload(access.ownerUid, workOrderId)) }, 201);
  } catch (error) { return fieldError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const id = cleanAdminText(new URL(request.url).searchParams.get("id"), 180);
    const record = await getD1().prepare(`SELECT m.object_key, m.work_order_id FROM trade_crm_job_media m
      JOIN trade_work_orders w ON w.id = m.work_order_id
      WHERE m.id = ? AND m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
      .bind(id, access.ownerUid, access.ownerUid).first<{ object_key: string; work_order_id: string }>();
    if (!record) return adminJson({ ok: false, error: "Job file not found." }, 404);
    const job = await assignedJob(access, record.work_order_id);
    await bucket().delete(record.object_key);
    const now = new Date().toISOString(); const revision = nextJobRevision(job.revision);
    await getD1().batch([
      getD1().prepare("DELETE FROM trade_crm_job_media WHERE id = ? AND firebase_uid = ?").bind(id, access.ownerUid),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, record.work_order_id, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId: record.work_order_id,
        revision, changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return adminJson({ ok: true, revision, ...(await payload(access.ownerUid, record.work_order_id)) });
  } catch (error) { return fieldError(error); }
}
