import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { hasAllowedSignature, sanitiseQuotingPhoto } from "@/lib/private-image-evidence";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import {
  hashPhotoRequestSecret,
  normalisePhotoRequirements,
  parsePhotoRequestToken,
  PHOTO_REQUEST_CHECKLIST_VERSION,
  type PhotoRequirement,
} from "@/lib/trade-photo-requests";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_FILES = 24;
const MAX_REQUIREMENT_FILES = 3;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type RouteContext = { params: Promise<{ token: string }> };
type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};
type PublicRequestRecord = {
  id: string;
  work_order_id: string;
  firebase_uid: string;
  token_hash: string;
  status: string;
  requirements: string;
  revision: number;
  expires_at: string;
  work_number: string;
  title: string;
  service_category: string;
  job_revision: number;
  assignee_member_id: string;
  business_name: string;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
}

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

function extension(contentType: string) {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

async function authorisedRequest(context: RouteContext) {
  const { token } = await context.params;
  const parsed = parsePhotoRequestToken(decodeURIComponent(token || ""));
  if (!parsed) throw new Error("REQUEST_NOT_FOUND");
  const record = await getD1().prepare(`SELECT r.id, r.work_order_id, r.firebase_uid, r.token_hash, r.status,
      r.requirements, r.revision, r.expires_at, w.work_number, w.title, w.service_category,
      w.revision job_revision, w.assignee_member_id, a.business_name
    FROM trade_crm_photo_requests r
    JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
    JOIN trade_accounts a ON a.firebase_uid = r.firebase_uid
    WHERE r.id = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND a.partner_type = 'installer' AND a.account_status = 'active'`)
    .bind(parsed.requestId).first<PublicRequestRecord>();
  if (!record || !record.token_hash || record.token_hash !== await hashPhotoRequestSecret(parsed.secret)) throw new Error("REQUEST_NOT_FOUND");
  if (record.status !== "active") throw new Error("REQUEST_REVOKED");
  if (record.expires_at <= new Date().toISOString()) throw new Error("REQUEST_EXPIRED");
  let requirements: PhotoRequirement[];
  try { requirements = normalisePhotoRequirements(JSON.parse(record.requirements)); }
  catch { throw new Error("REQUEST_UNAVAILABLE"); }
  return { record, requirements };
}

async function publicPayload(record: PublicRequestRecord, requirements: PhotoRequirement[]) {
  const rows = await getD1().prepare(`SELECT id, photo_requirement_id, caption, content_type, size_bytes, created_at
    FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'
    ORDER BY created_at DESC`)
    .bind(record.firebase_uid, record.work_order_id, record.id).all<Record<string, unknown>>();
  return {
    businessName: record.business_name,
    job: { workNumber: record.work_number, title: record.title, serviceCategory: record.service_category },
    request: { revision: Number(record.revision), expiresAt: record.expires_at, checklistVersion: PHOTO_REQUEST_CHECKLIST_VERSION, requirements },
    uploads: rows.results.map((row) => ({
      id: row.id,
      requirementId: row.photo_requirement_id,
      label: row.caption,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      createdAt: row.created_at,
    })),
  };
}

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "REQUEST_EXPIRED") return json({ ok: false, error: "This photo request link has expired. Ask the installer for a new link." }, 410);
  if (code === "REQUEST_REVOKED") return json({ ok: false, error: "This photo request link is no longer active. Ask the installer for a new link." }, 410);
  if (code === "REQUEST_NOT_FOUND") return json({ ok: false, error: "This photo request link was not recognised." }, 404);
  if (code === "STORAGE_UNAVAILABLE") return json({ ok: false, error: "Private photo storage is temporarily unavailable." }, 503);
  return json({ ok: false, error: "This photo request is temporarily unavailable." }, 500);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { record, requirements } = await authorisedRequest(context);
    return json({ ok: true, ...(await publicPayload(record, requirements)) });
  } catch (error) { return publicError(error); }
}

export async function POST(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { record, requirements } = await authorisedRequest(context);
    let form: FormData;
    try { form = await request.formData(); }
    catch { return json({ ok: false, error: "The selected photo could not be read." }, 400); }
    const requirementId = cleanAdminText(form.get("requirementId"), 80);
    const requirement = requirements.find((item) => item.id === requirementId);
    const file = form.get("file");
    if (!requirement) return json({ ok: false, error: "Choose one of the requested photo categories." }, 400);
    if (!(file instanceof File) || !file.name) return json({ ok: false, error: "Choose or take a photo." }, 400);
    if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a JPEG, PNG or WebP photo. Phone photos are converted to JPEG before sending." }, 400);
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "Each photo must be no larger than 8 MB." }, 400);
    if (form.get("checklistVersion") !== PHOTO_REQUEST_CHECKLIST_VERSION
      || form.get("confirmClarity") !== "true"
      || form.get("confirmRelevance") !== "true"
      || form.get("confirmPrivacy") !== "true") {
      return json({ ok: false, error: "Review clarity, relevance and private information before sending the photo." }, 400);
    }
    const counts = await getD1().prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN photo_requirement_id = ? THEN 1 ELSE 0 END) requirement_total
      FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'`)
      .bind(requirementId, record.firebase_uid, record.work_order_id, record.id).first<{ total: number; requirement_total: number }>();
    if (Number(counts?.total || 0) >= MAX_REQUEST_FILES) return json({ ok: false, error: "This request already has its maximum of 24 photos." }, 409);
    if (Number(counts?.requirement_total || 0) >= MAX_REQUIREMENT_FILES) return json({ ok: false, error: "This photo requirement already has its maximum of 3 photos." }, 409);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasAllowedSignature(bytes, file.type, false)) return json({ ok: false, error: "The selected file contents do not match a supported photo type." }, 400);
    const storedBytes = sanitiseQuotingPhoto(bytes, file.type);
    if (!storedBytes) return json({ ok: false, error: "This photo could not be made safe for sharing. Try taking it again." }, 400);

    const id = crypto.randomUUID();
    const objectKey = `crm-job-media/${record.firebase_uid}/${record.work_order_id}/customer-requests/${record.id}/${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const jobRevision = nextJobRevision(record.job_revision);
    const store = bucket();
    await store.put(objectKey, storedBytes.buffer, { httpMetadata: { contentType: file.type },
      customMetadata: { owner: record.firebase_uid, workOrderId: record.work_order_id, mediaId: id, photoRequestId: record.id } });
    try {
      const db = getD1();
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_job_media
          (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption,
           source, photo_request_id, photo_requirement_id, request_revision, checklist_version, customer_acknowledged_at,
           created_at, updated_at)
          VALUES (?, ?, ?, 'before', ?, ?, ?, ?, ?, 'customer_request', ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, record.work_order_id, record.firebase_uid, `customer-photo-${requirement.id}.${extension(file.type)}`,
            file.type, storedBytes.byteLength, objectKey, requirement.label, record.id, requirement.id, Number(record.revision),
            PHOTO_REQUEST_CHECKLIST_VERSION, now, now, now),
        db.prepare(`INSERT INTO trade_crm_photo_request_events
          (id, photo_request_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type, request_revision, created_at)
          VALUES (?, ?, ?, ?, 'customer_link', '', 'photo_uploaded', ?, ?)`)
          .bind(crypto.randomUUID(), record.id, record.work_order_id, record.firebase_uid, Number(record.revision), now),
        db.prepare(`INSERT INTO trade_work_order_events
          (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'customer_photo_added', 'Customer added a requested job photo.', ?)`)
          .bind(crypto.randomUUID(), record.work_order_id, record.firebase_uid, now),
        db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(jobRevision, now, record.work_order_id, record.firebase_uid),
        ...jobSyncChangeStatements(db, { ownerUid: record.firebase_uid, workOrderId: record.work_order_id,
          revision: jobRevision, changedAt: now, audienceMemberId: record.assignee_member_id }),
      ]);
    } catch (error) { await store.delete(objectKey); throw error; }
    return json({ ok: true, ...(await publicPayload({ ...record, job_revision: jobRevision }, requirements)) }, 201);
  } catch (error) { return publicError(error); }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { record, requirements } = await authorisedRequest(context);
    const mediaId = cleanAdminText(new URL(request.url).searchParams.get("id"), 180);
    const media = await getD1().prepare(`SELECT id, object_key FROM trade_crm_job_media
      WHERE id = ? AND firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'`)
      .bind(mediaId, record.firebase_uid, record.work_order_id, record.id).first<{ id: string; object_key: string }>();
    if (!media) return json({ ok: false, error: "Requested photo not found." }, 404);
    await bucket().delete(media.object_key);
    const now = new Date().toISOString();
    const jobRevision = nextJobRevision(record.job_revision);
    const db = getD1();
    await db.batch([
      db.prepare("DELETE FROM trade_crm_job_media WHERE id = ? AND photo_request_id = ?").bind(media.id, record.id),
      db.prepare(`INSERT INTO trade_crm_photo_request_events
        (id, photo_request_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type, request_revision, created_at)
        VALUES (?, ?, ?, ?, 'customer_link', '', 'photo_removed', ?, ?)`)
        .bind(crypto.randomUUID(), record.id, record.work_order_id, record.firebase_uid, Number(record.revision), now),
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(jobRevision, now, record.work_order_id, record.firebase_uid),
      ...jobSyncChangeStatements(db, { ownerUid: record.firebase_uid, workOrderId: record.work_order_id,
        revision: jobRevision, changedAt: now, audienceMemberId: record.assignee_member_id }),
    ]);
    return json({ ok: true, ...(await publicPayload({ ...record, job_revision: jobRevision }, requirements)) });
  } catch (error) { return publicError(error); }
}
