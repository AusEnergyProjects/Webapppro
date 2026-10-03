import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { hasAllowedSignature, sanitiseQuotingPhoto } from "@/lib/private-image-evidence";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { photoRequestEvidenceKey } from "@/lib/photo-request-review";
import { photoRequestProofOverview } from "@/lib/photo-request-review-server";
import { australianAppointmentTimeZone, customerAppointmentCalendar } from "@/lib/customer-appointment-calendar";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import { ensureCreditexSchemaGuards } from "@/lib/creditex-schema-guards";
import type { AuthorisedTradeQuoteDecisionLink } from "@/lib/trade-quote-decision-server";
import { customerJobScope } from "@/lib/customer-job-journey-server";
import {
  hashPhotoRequestSecret,
  normalisePhotoRequirements,
  parsePhotoRequestToken,
  PHOTO_REQUEST_CHECKLIST_VERSION,
  type PhotoRequirement,
} from "@/lib/trade-photo-requests";

export const runtime = "edge";

const MAX_FILE_BYTES = 650 * 1024;
const MAX_REQUEST_FILES = 36;
const MAX_REQUIREMENT_FILES = 3;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type RouteContext = { params: Promise<{ token: string }>; quoteLink?: AuthorisedTradeQuoteDecisionLink };
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
  appointment_starts_at: string;
  appointment_ends_at: string;
  appointment_state: string;
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
      w.revision job_revision, w.assignee_member_id, a.business_name,
      COALESCE((SELECT appointment.starts_at FROM trade_crm_appointments appointment
        WHERE appointment.work_order_id = w.id AND appointment.firebase_uid = w.firebase_uid
          AND appointment.status = 'scheduled' ORDER BY appointment.starts_at LIMIT 1), '') appointment_starts_at,
      COALESCE((SELECT appointment.ends_at FROM trade_crm_appointments appointment
        WHERE appointment.work_order_id = w.id AND appointment.firebase_uid = w.firebase_uid
          AND appointment.status = 'scheduled' ORDER BY appointment.starts_at LIMIT 1), '') appointment_ends_at,
      COALESCE(site.address_state, a.address_state, 'NSW') appointment_state
    FROM trade_crm_photo_requests r
    JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      AND d.crm_customer_id = r.crm_customer_id AND d.customer_source = 'trade_owned'
    LEFT JOIN trade_crm_service_sites site ON site.id = d.service_site_id AND site.firebase_uid = d.firebase_uid
    JOIN trade_accounts a ON a.firebase_uid = r.firebase_uid
    WHERE r.id = ? AND w.partner_type = 'installer' AND w.record_status = 'active' AND w.source_type <> 'opportunity'
      AND a.partner_type = 'installer' AND ${verifiedTradeAccountPredicate("a")}`)
    .bind(parsed.requestId).first<PublicRequestRecord>();
  if (!record || !record.token_hash || record.token_hash !== await hashPhotoRequestSecret(parsed.secret)) throw new Error("REQUEST_NOT_FOUND");
  if (record.status !== "active") throw new Error("REQUEST_REVOKED");
  if (record.expires_at <= new Date().toISOString()) throw new Error("REQUEST_EXPIRED");
  let requirements: PhotoRequirement[];
  try { requirements = normalisePhotoRequirements(JSON.parse(record.requirements)); }
  catch { throw new Error("REQUEST_UNAVAILABLE"); }
  return { record, requirements };
}

function currentScope(record: PublicRequestRecord, context: RouteContext) {
  const now = new Date().toISOString();
  const quote = context.quoteLink ? customerJobScope(context.quoteLink, now) : null;
  return {
    sql: `EXISTS (SELECT 1 FROM trade_crm_photo_requests r
      JOIN trade_work_orders w ON w.id=r.work_order_id AND w.firebase_uid=r.firebase_uid
      JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
        AND d.crm_customer_id=r.crm_customer_id AND d.customer_source='trade_owned'
      JOIN trade_accounts a ON a.firebase_uid=r.firebase_uid
      WHERE r.id=? AND r.firebase_uid=? AND r.work_order_id=? AND r.token_hash=? AND r.revision=?
        AND r.status='active' AND r.expires_at>? AND w.record_status='active' AND w.source_type<>'opportunity'
        AND w.partner_type='installer' AND a.partner_type='installer' AND ${verifiedTradeAccountPredicate("a")})
      ${quote ? `AND EXISTS (SELECT 1 ${quote.sql} AND work.stage<>'cancelled')` : ""}`,
    bindings: [record.id, record.firebase_uid, record.work_order_id, record.token_hash, record.revision, now, ...(quote?.bindings || [])],
  };
}

// A failed NOT NULL assertion aborts the entire D1 batch. Valid access inserts
// nothing; revoked access can never leave a mutation or a misleading audit event.
function writeGuard(db: D1Database, record: PublicRequestRecord, context: RouteContext) {
  const scope = currentScope(record, context);
  return db.prepare(`INSERT INTO trade_crm_photo_request_events
    (id,photo_request_id,work_order_id,firebase_uid,actor_type,event_type,request_revision,created_at)
    SELECT ?,?,?,?,'customer_link',NULL,?,? WHERE NOT (${scope.sql})`)
    .bind(crypto.randomUUID(), record.id, record.work_order_id, record.firebase_uid, record.revision, new Date().toISOString(), ...scope.bindings);
}

async function publicPayload(record: PublicRequestRecord, requirements: PhotoRequirement[], context: RouteContext) {
  const [rows, proof] = await Promise.all([getD1().prepare(`SELECT id, photo_requirement_id, caption, content_type, size_bytes, created_at
    FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'
    ORDER BY created_at DESC`)
    .bind(record.firebase_uid, record.work_order_id, record.id).all<Record<string, unknown>>(),
  photoRequestProofOverview({ ownerUid: record.firebase_uid, workOrderId: record.work_order_id, requestId: record.id,
    requestRevision: Number(record.revision), requirements })]);
  const timeZone = australianAppointmentTimeZone(record.appointment_state);
  const calendar = customerAppointmentCalendar({ workNumber: record.work_number, businessName: record.business_name,
    startsAt: record.appointment_starts_at, endsAt: record.appointment_ends_at, timeZone });
  const scope = currentScope(record, context);
  if (!await getD1().prepare(`SELECT 1 WHERE ${scope.sql}`).bind(...scope.bindings).first()) throw new Error("REQUEST_REVOKED");
  return {
    businessName: record.business_name,
    job: { workNumber: record.work_number, title: record.title, serviceCategory: record.service_category },
    request: { revision: Number(record.revision), expiresAt: record.expires_at, checklistVersion: PHOTO_REQUEST_CHECKLIST_VERSION,
      requirements, completion: proof.completion, reviews: proof.reviews, outstandingRequirementIds: proof.outstandingRequirementIds,
      proofReady: proof.proofReady },
    appointment: calendar ? { startsAt: record.appointment_starts_at, endsAt: record.appointment_ends_at, timeZone,
      googleCalendarUrl: calendar.googleUrl } : null,
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
  if (code === "REQUEST_REVOKED" || code.includes("NOT NULL constraint failed: trade_crm_photo_request_events.event_type")) return json({ ok: false, error: "This photo request link is no longer active. Ask the installer for a new link." }, 410);
  if (code === "REQUEST_NOT_FOUND") return json({ ok: false, error: "This photo request link was not recognised." }, 404);
  if (code === "STORAGE_UNAVAILABLE") return json({ ok: false, error: "Private photo storage is temporarily unavailable." }, 503);
  return json({ ok: false, error: "This photo request is temporarily unavailable." }, 500);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { record, requirements } = await authorisedRequest(context);
    return json({ ok: true, ...(await publicPayload(record, requirements, context)) });
  } catch (error) { return publicError(error); }
}

export async function POST(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { record, requirements } = await authorisedRequest(context);
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      if (body.action !== "complete_request") return json({ ok: false, error: "Unsupported photo request action." }, 400);
      if (body.checklistVersion !== PHOTO_REQUEST_CHECKLIST_VERSION || body.confirmed !== true) {
        return json({ ok: false, error: "Confirm that the required photos are ready for installer review." }, 400);
      }
      const proof = await photoRequestProofOverview({ ownerUid: record.firebase_uid, workOrderId: record.work_order_id,
        requestId: record.id, requestRevision: Number(record.revision), requirements });
      if (proof.outstandingRequirementIds.length) {
        const labels = requirements.filter((item) => proof.outstandingRequirementIds.includes(item.id)).map((item) => item.label);
        return json({ ok: false, error: "Add or retake every outstanding photo before finishing.", missingRequirements: labels }, 409);
      }
      const media = await getD1().prepare(`SELECT id FROM trade_crm_job_media
        WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request' ORDER BY id`)
        .bind(record.firebase_uid, record.work_order_id, record.id).all<{ id: string }>();
      const evidenceKey = await photoRequestEvidenceKey({ requestId: record.id, requestRevision: Number(record.revision),
        checklistVersion: PHOTO_REQUEST_CHECKLIST_VERSION, mediaIds: media.results.map((item) => item.id) });
      const previous = await getD1().prepare(`SELECT MAX(completion_revision) revision FROM trade_crm_photo_request_completions
        WHERE photo_request_id = ?`).bind(record.id).first<{ revision: number }>();
      const completionRevision = Number(previous?.revision || 0) + 1;
      const now = new Date().toISOString(); const completionId = crypto.randomUUID();
      const db = getD1();
      const completed = { sql: "EXISTS (SELECT 1 FROM trade_crm_photo_request_completions WHERE id=?)", values: [completionId] };
      const jobRevision = nextJobRevision(record.job_revision);
      await db.batch([
        writeGuard(db, record, context),
        db.prepare(`INSERT OR IGNORE INTO trade_crm_photo_request_completions
        (id, photo_request_id, work_order_id, firebase_uid, request_revision, completion_revision, checklist_version,
         evidence_key, required_count, supplied_count, completed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(completionId, record.id, record.work_order_id, record.firebase_uid, Number(record.revision), completionRevision,
          PHOTO_REQUEST_CHECKLIST_VERSION, evidenceKey, requirements.filter((item) => item.required).length,
          proof.counts.supplied, now, now),
          db.prepare(`INSERT INTO trade_crm_photo_request_events
            (id, photo_request_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type, request_revision, created_at)
            SELECT ?, ?, ?, ?, 'customer_link', '', 'request_completed', ?, ? WHERE ${completed.sql}`)
            .bind(crypto.randomUUID(), record.id, record.work_order_id, record.firebase_uid, Number(record.revision), now, ...completed.values),
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            SELECT ?, ?, ?, 'customer_photo_request_completed', 'Customer marked the requested photos ready for review.', ? WHERE ${completed.sql}`)
            .bind(crypto.randomUUID(), record.work_order_id, record.firebase_uid, now, ...completed.values),
          db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND ${completed.sql}`)
            .bind(jobRevision, now, record.work_order_id, record.firebase_uid, ...completed.values),
          ...jobSyncChangeStatements(db, { ownerUid: record.firebase_uid, workOrderId: record.work_order_id,
            revision: jobRevision, changedAt: now, audienceMemberId: record.assignee_member_id }, completed),
        ]);
        record.job_revision = jobRevision;
      return json({ ok: true, ...(await publicPayload(record, requirements, context)) });
    }
    let form: FormData;
    try { form = await request.formData(); }
    catch { return json({ ok: false, error: "The selected photo could not be read." }, 400); }
    const requirementId = cleanAdminText(form.get("requirementId"), 80);
    const requirement = requirements.find((item) => item.id === requirementId);
    const file = form.get("file");
    if (!requirement) return json({ ok: false, error: "Choose one of the requested photo categories." }, 400);
    if (!(file instanceof File) || !file.name) return json({ ok: false, error: "Choose or take a photo." }, 400);
    if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a JPEG, PNG or WebP photo. Phone photos are converted to JPEG before sending." }, 400);
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "This photo is still too large to send. Choose it again so a smaller copy can be prepared." }, 413);
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
    if (Number(counts?.total || 0) >= MAX_REQUEST_FILES) return json({ ok: false, error: "This request already has its maximum of 36 photos." }, 409);
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
        writeGuard(db, record, context),
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
    } catch (error) {
      // A lost batch response can follow a successful commit. Never delete its evidence.
      const committed = await getD1().prepare(`SELECT id FROM trade_crm_job_media
        WHERE id = ? AND firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND object_key = ?`)
        .bind(id, record.firebase_uid, record.work_order_id, record.id, objectKey).first();
      if (!committed) { await store.delete(objectKey); throw error; }
    }
    return json({ ok: true, ...(await publicPayload({ ...record, job_revision: jobRevision }, requirements, context)) }, 201);
  } catch (error) { return publicError(error); }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const { record, requirements } = await authorisedRequest(context);
    await ensureCreditexSchemaGuards(getD1());
    const mediaId = cleanAdminText(new URL(request.url).searchParams.get("id"), 180);
    const media = await getD1().prepare(`SELECT id, object_key, photo_requirement_id FROM trade_crm_job_media
      WHERE id = ? AND firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'`)
      .bind(mediaId, record.firebase_uid, record.work_order_id, record.id).first<{ id: string; object_key: string; photo_requirement_id: string }>();
    if (!media) return json({ ok: false, error: "Requested photo not found." }, 404);
    const reviewed = await getD1().prepare(`SELECT 1 reviewed FROM trade_crm_photo_requirement_reviews
      WHERE photo_request_id = ? AND photo_requirement_id = ? LIMIT 1`)
      .bind(record.id, media.photo_requirement_id).first();
    if (reviewed) return json({ ok: false, error: "This photo is part of the review history and cannot be removed. Add a replacement instead." }, 409);
    const governedEvidence = await getD1().prepare(`SELECT 1 AS governed
      FROM compliance_case_evidence
      WHERE job_media_id = ?
      LIMIT 1`).bind(media.id).first();
    if (governedEvidence) {
      return json({
        ok: false,
        error: "This photo is part of a compliance evidence record and cannot be removed. Add a replacement instead.",
      }, 409);
    }
    const store = bucket();
    const now = new Date().toISOString();
    const jobRevision = nextJobRevision(record.job_revision);
    const db = getD1();
    await db.batch([
      writeGuard(db, record, context),
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
    await store.delete(media.object_key);
    return json({ ok: true, ...(await publicPayload({ ...record, job_revision: jobRevision }, requirements, context)) });
  } catch (error) { return publicError(error); }
}
