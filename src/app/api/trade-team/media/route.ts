import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { mobileErrorResponse, MOBILE_CLIENT_ID_PATTERN, requireRegisteredMobileDevice } from "@/lib/trade-mobile-server";

export const runtime = "edge";

const PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SESSION_HOURS = 24;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MEDIA_CATEGORIES = new Set(["before", "progress", "after", "document"]);
const PRIVATE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\s().-]*){8,}/i;

type UploadedPart = { partNumber: number; etag: string };
type MultipartUpload = {
  uploadId: string;
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<unknown>;
  abort(): Promise<void>;
};
type EvidenceBucket = {
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};
type UploadSession = {
  id: string; owner_uid: string; actor_uid: string; member_id: string; device_id: string; client_upload_id: string;
  metadata_hash: string; work_order_id: string; object_key: string; upload_id: string; file_name: string;
  content_type: string; size_bytes: number; category: string; caption: string; part_size_bytes: number;
  status: string; media_id: string; expires_at: string; completed_at: string;
};

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

function safeName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "field-file";
}

function base64Url(bytes: Uint8Array) {
  let binary = ""; bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashMetadata(value: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return base64Url(new Uint8Array(digest));
}

function mediaError(error: unknown) {
  const mobile = mobileErrorResponse(error);
  if (mobile) return adminJson({ ok: false, code: mobile.code, error: mobile.error,
    ...(mobile.minimumVersion ? { minimumVersion: mobile.minimumVersion } : {}) }, mobile.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Offline uploads require installer team access." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Offline uploads are available to installer teams only." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is no longer assigned to this device." }, 403);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Field file storage is unavailable." }, 503);
  return adminJson({ ok: false, error: "The field upload could not be completed." }, 500);
}

async function sessionParts(sessionId: string) {
  const rows = await getD1().prepare(`SELECT part_number, etag, size_bytes FROM trade_mobile_upload_parts
    WHERE session_id = ? ORDER BY part_number`).bind(sessionId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ partNumber: Number(row.part_number), etag: String(row.etag), sizeBytes: Number(row.size_bytes) }));
}

async function sessionPayload(session: UploadSession) {
  const parts = await sessionParts(session.id);
  return { id: session.id, clientUploadId: session.client_upload_id, workOrderId: session.work_order_id,
    fileName: session.file_name, contentType: session.content_type, sizeBytes: Number(session.size_bytes),
    category: session.category, caption: session.caption, partSizeBytes: Number(session.part_size_bytes),
    totalParts: Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes)), status: session.status,
    mediaId: session.media_id, expiresAt: session.expires_at, completedAt: session.completed_at, parts };
}

async function findSession(access: TeamAccess, id: string) {
  const row = await getD1().prepare(`SELECT * FROM trade_mobile_upload_sessions WHERE id = ? AND owner_uid = ?`)
    .bind(id, access.ownerUid).first<UploadSession>();
  if (!row || row.actor_uid !== access.actorUid || row.member_id !== access.memberId) throw new Error("UPLOAD_NOT_FOUND");
  return row;
}

async function expireSessions(access: TeamAccess, deviceId: string) {
  const now = new Date().toISOString();
  const rows = await getD1().prepare(`SELECT id, object_key, upload_id FROM trade_mobile_upload_sessions
    WHERE owner_uid = ? AND actor_uid = ? AND device_id = ? AND status IN ('initiated', 'uploading')
      AND expires_at <= ? LIMIT 10`).bind(access.ownerUid, access.actorUid, deviceId, now).all<Record<string, unknown>>();
  for (const row of rows.results) {
    try { await bucket().resumeMultipartUpload(String(row.object_key), String(row.upload_id)).abort(); } catch { /* already absent */ }
    await getD1().batch([
      getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'expired', last_error = 'expired', updated_at = ? WHERE id = ?`)
        .bind(now, row.id),
      getD1().prepare("DELETE FROM trade_mobile_upload_parts WHERE session_id = ?").bind(row.id),
    ]);
  }
}

async function initiate(request: Request, access: TeamAccess, body: Record<string, unknown>) {
  const deviceId = cleanAdminText(body.deviceId, 120);
  await requireRegisteredMobileDevice(request, access, deviceId, cleanAdminText(body.platform, 20), cleanAdminText(body.appVersion, 40));
  await expireSessions(access, deviceId);
  const clientUploadId = cleanAdminText(body.clientUploadId, 120);
  const workOrderId = cleanAdminText(body.workOrderId, 180);
  const fileName = safeName(cleanAdminText(body.fileName, 180));
  const contentType = cleanAdminText(body.contentType, 100);
  const sizeBytes = Number(body.sizeBytes);
  const categoryValue = cleanAdminText(body.category, 20);
  const category = MEDIA_CATEGORIES.has(categoryValue) ? categoryValue : "progress";
  const caption = cleanAdminText(body.caption, 300);
  if (!MOBILE_CLIENT_ID_PATTERN.test(clientUploadId) || !ALLOWED_TYPES.has(contentType) ||
    !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) {
    return adminJson({ ok: false, error: "Add a stable upload ID and a JPEG, PNG, WebP or PDF no larger than 50 MB." }, 400);
  }
  const job = await assignedJob(access, workOrderId);
  if (job.source_type === "opportunity" && (PRIVATE_PATTERN.test(fileName) || PRIVATE_PATTERN.test(caption))) {
    return adminJson({ ok: false, code: "PROTECTED_CUSTOMER_DATA", error: "Remove contact details from the protected job filename and caption." }, 400);
  }
  const metadata = { clientUploadId, workOrderId, fileName, contentType, sizeBytes, category, caption };
  const metadataHash = await hashMetadata(metadata);
  const existing = await getD1().prepare(`SELECT * FROM trade_mobile_upload_sessions WHERE owner_uid = ? AND client_upload_id = ?`)
    .bind(access.ownerUid, clientUploadId).first<UploadSession>();
  if (existing) {
    if (existing.metadata_hash !== metadataHash) return adminJson({ ok: false, code: "IDEMPOTENCY_MISMATCH",
      error: "This upload ID was already used for different file details." }, 409);
    return adminJson({ ok: true, duplicate: true, contractVersion: 2, upload: await sessionPayload(existing) });
  }
  const id = crypto.randomUUID(); const objectKey = `crm-job-media/${access.ownerUid}/${workOrderId}/${id}`;
  const now = new Date().toISOString(); const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  const multipart = await bucket().createMultipartUpload(objectKey, { httpMetadata: { contentType },
    customMetadata: { owner: access.ownerUid, actor: access.actorUid, workOrderId, uploadSessionId: id } });
  try {
    await getD1().prepare(`INSERT INTO trade_mobile_upload_sessions
      (id, owner_uid, actor_uid, member_id, device_id, client_upload_id, metadata_hash, work_order_id,
       object_key, upload_id, file_name, content_type, size_bytes, category, caption, part_size_bytes,
       status, media_id, expires_at, completed_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', '', ?, '', '', ?, ?)`)
      .bind(id, access.ownerUid, access.actorUid, access.memberId, deviceId, clientUploadId, metadataHash,
        workOrderId, objectKey, multipart.uploadId, fileName, contentType, sizeBytes, category, caption,
        PART_SIZE_BYTES, expiresAt, now, now).run();
  } catch (error) { await multipart.abort(); throw error; }
  const session = await findSession(access, id);
  return adminJson({ ok: true, contractVersion: 2, upload: await sessionPayload(session) }, 201);
}

async function uploadPart(request: Request, access: TeamAccess, form: FormData) {
  const deviceId = cleanAdminText(form.get("deviceId"), 120);
  await requireRegisteredMobileDevice(request, access, deviceId, cleanAdminText(form.get("platform"), 20), cleanAdminText(form.get("appVersion"), 40));
  const session = await findSession(access, cleanAdminText(form.get("sessionId"), 180));
  if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
  if (!["initiated", "uploading"].includes(session.status)) return adminJson({ ok: false, error: "This upload is no longer accepting parts." }, 409);
  if (session.expires_at <= new Date().toISOString()) return adminJson({ ok: false, code: "UPLOAD_EXPIRED", error: "This upload expired. Start it again." }, 410);
  await assignedJob(access, session.work_order_id);
  const partNumber = Number(form.get("partNumber")); const part = form.get("file");
  const totalParts = Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes));
  if (!(part instanceof File) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
    return adminJson({ ok: false, error: "Add a valid upload part." }, 400);
  }
  const expectedBytes = partNumber === totalParts
    ? Number(session.size_bytes) - Number(session.part_size_bytes) * (totalParts - 1)
    : Number(session.part_size_bytes);
  if (part.size !== expectedBytes) return adminJson({ ok: false, error: `Upload part ${partNumber} must contain exactly ${expectedBytes} bytes.` }, 400);
  const uploaded = await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
    .uploadPart(partNumber, await part.arrayBuffer());
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare(`INSERT INTO trade_mobile_upload_parts (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, part_number) DO UPDATE SET etag = excluded.etag,
      size_bytes = excluded.size_bytes, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), session.id, partNumber, uploaded.etag, part.size, now, now),
    getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'uploading', last_error = '', updated_at = ? WHERE id = ?`)
      .bind(now, session.id),
  ]);
  return adminJson({ ok: true, contractVersion: 2, upload: await sessionPayload({ ...session, status: "uploading" }) });
}

async function finalise(access: TeamAccess, session: UploadSession) {
  const job = await assignedJob(access, session.work_order_id); const now = new Date().toISOString();
  const revision = nextJobRevision(job.revision); const mediaId = session.media_id || crypto.randomUUID(); const db = getD1();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO trade_crm_job_media
      (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mediaId, session.work_order_id, access.ownerUid, session.category, session.file_name,
        session.content_type, session.size_bytes, session.object_key, session.caption, now, now),
    db.prepare(`INSERT INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'offline_field_file_added', 'Field app uploaded a photo or document.', ?)`)
      .bind(crypto.randomUUID(), session.work_order_id, access.ownerUid, now),
    db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(revision, now, session.work_order_id, access.ownerUid),
    db.prepare(`UPDATE trade_mobile_upload_sessions SET status = 'completed', media_id = ?, completed_at = ?,
      last_error = '', updated_at = ? WHERE id = ? AND owner_uid = ?`).bind(mediaId, now, now, session.id, access.ownerUid),
    ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: session.work_order_id, revision,
      changedAt: now, audienceMemberId: job.assignee_member_id }),
  ]);
  return { revision, mediaId, completedAt: now };
}

async function complete(request: Request, access: TeamAccess, body: Record<string, unknown>) {
  const deviceId = cleanAdminText(body.deviceId, 120);
  await requireRegisteredMobileDevice(request, access, deviceId, cleanAdminText(body.platform, 20), cleanAdminText(body.appVersion, 40));
  let session = await findSession(access, cleanAdminText(body.sessionId, 180));
  if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
  if (session.status === "completed") return adminJson({ ok: true, duplicate: true, contractVersion: 2, upload: await sessionPayload(session) });
  if (!["initiated", "uploading", "completing"].includes(session.status)) return adminJson({ ok: false, error: "This upload cannot be completed." }, 409);
  if (session.expires_at <= new Date().toISOString()) return adminJson({ ok: false, code: "UPLOAD_EXPIRED", error: "This upload expired. Start it again." }, 410);
  await assignedJob(access, session.work_order_id);
  const parts = await sessionParts(session.id); const totalParts = Math.ceil(Number(session.size_bytes) / Number(session.part_size_bytes));
  if (parts.length !== totalParts || parts.reduce((sum, part) => sum + part.sizeBytes, 0) !== Number(session.size_bytes)) {
    return adminJson({ ok: false, code: "UPLOAD_INCOMPLETE", error: "Upload every file part before completing this file.",
      uploadedParts: parts.length, totalParts }, 409);
  }
  const now = new Date().toISOString();
  if (session.status !== "completing") {
    await getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'completing', updated_at = ? WHERE id = ?`)
      .bind(now, session.id).run();
    try {
      await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
        .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    } catch (error) {
      await getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'uploading', last_error = 'complete_failed', updated_at = ? WHERE id = ?`)
        .bind(new Date().toISOString(), session.id).run();
      throw error;
    }
    session = { ...session, status: "completing" };
  } else if (!await bucket().head(session.object_key)) {
    try {
      await bucket().resumeMultipartUpload(session.object_key, session.upload_id)
        .complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    } catch {
      await getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'uploading',
        last_error = 'recovery_failed', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), session.id).run();
      return adminJson({ ok: false, code: "UPLOAD_RECOVERY_REQUIRED", error: "The interrupted upload could not be assembled. Resume its saved parts and try again." }, 409);
    }
  }
  const result = await finalise(access, session);
  const completed = await findSession(access, session.id);
  return adminJson({ ok: true, contractVersion: 2, result, upload: await sessionPayload(completed) }, 201);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const url = new URL(request.url);
    const deviceId = cleanAdminText(url.searchParams.get("deviceId"), 120);
    await requireRegisteredMobileDevice(request, access, deviceId);
    const session = await findSession(access, cleanAdminText(url.searchParams.get("sessionId"), 180));
    if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
    await assignedJob(access, session.work_order_id);
    return adminJson({ ok: true, contractVersion: 2, upload: await sessionPayload(session) });
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await request.formData();
      if (cleanAdminText(form.get("action"), 30) !== "upload_part") return adminJson({ ok: false, error: "Unsupported upload action." }, 400);
      return await uploadPart(request, access, form);
    }
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "The upload request is invalid." }, 400); }
    const action = cleanAdminText(body.action, 30);
    if (action === "initiate") return await initiate(request, access, body);
    if (action === "complete") return await complete(request, access, body);
    return adminJson({ ok: false, error: "Unsupported upload action." }, 400);
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); const url = new URL(request.url);
    const deviceId = cleanAdminText(url.searchParams.get("deviceId"), 120);
    await requireRegisteredMobileDevice(request, access, deviceId);
    const session = await findSession(access, cleanAdminText(url.searchParams.get("sessionId"), 180));
    if (session.device_id !== deviceId) return adminJson({ ok: false, error: "This upload belongs to a different device." }, 403);
    if (["initiated", "uploading", "completing"].includes(session.status)) {
      try {
        if (session.status === "completing" && await bucket().head(session.object_key)) await bucket().delete(session.object_key);
        else await bucket().resumeMultipartUpload(session.object_key, session.upload_id).abort();
      } catch { /* already absent */ }
    }
    const now = new Date().toISOString();
    await getD1().batch([
      getD1().prepare(`UPDATE trade_mobile_upload_sessions SET status = 'aborted', last_error = '', updated_at = ?
        WHERE id = ? AND owner_uid = ? AND status <> 'completed'`).bind(now, session.id, access.ownerUid),
      getD1().prepare("DELETE FROM trade_mobile_upload_parts WHERE session_id = ?").bind(session.id),
    ]);
    return adminJson({ ok: true, aborted: session.status !== "completed" });
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_NOT_FOUND") return adminJson({ ok: false, error: "Upload session not found." }, 404);
    return mediaError(error);
  }
}
