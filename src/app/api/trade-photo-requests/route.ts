import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { assignedJob, canDispatch, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import {
  defaultPhotoRequirements,
  hashPhotoRequestSecret,
  newPhotoRequestSecret,
  normalisePhotoRequirements,
  normalisePhotoTemplateFeedback,
  photoRequirementsEqual,
  photoRequestExpiry,
  type PhotoRequirement,
} from "@/lib/trade-photo-requests";

export const runtime = "edge";

type PhotoRequestRecord = {
  id: string;
  work_order_id: string;
  firebase_uid: string;
  crm_customer_id: string;
  token_hash: string;
  status: string;
  requirements: string;
  revision: number;
  expires_at: string;
  last_shared_at: string;
  source_template_id: string;
  source_template_version_id: string;
  source_template_version: number;
  source_template_edited: number;
  template_feedback: string;
  template_missing_feedback: number;
  created_at: string;
  updated_at: string;
};

type PhotoTemplateVersion = {
  id: string;
  template_id: string;
  version: number;
  name: string;
  service_category: string;
  requirements: string;
};

type DirectJob = {
  id: string;
  work_number: string;
  title: string;
  service_category: string;
  source_type: string;
  revision: number;
  assignee_member_id: string;
  crm_customer_id: string;
  customer_source: string;
};

function responseForError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  }
  if (code === "PHOTO_REQUEST_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can manage customer photo requests." }, 403);
  if (code === "JOB_NOT_FOUND" || code === "DIRECT_JOB_NOT_FOUND") return adminJson({ ok: false, error: "Direct customer job not found." }, 404);
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "Link a customer your business owns before requesting photos." }, 409);
  if (code === "PROTECTED_CUSTOMER") return adminJson({ ok: false, error: "AEA protected customer evidence must stay in the AEA customer pathway." }, 403);
  if (code === "INVALID_PHOTO_REQUIREMENTS") return adminJson({ ok: false, error: "Add between 1 and 12 complete, uniquely named photo requirements." }, 400);
  if (code === "PHOTO_REQUEST_NOT_FOUND") return adminJson({ ok: false, error: "Create the photo request before issuing a link." }, 404);
  if (code === "PHOTO_REQUEST_CHANGED") return adminJson({ ok: false, error: "This request changed in another session. Reload before saving again." }, 409);
  if (code === "PHOTO_TEMPLATE_NOT_AVAILABLE") return adminJson({ ok: false, error: "That published photo template is no longer available. Choose another template or use the service defaults." }, 409);
  if (code === "PHOTO_TEMPLATE_REQUIRED") return adminJson({ ok: false, error: "This request was not created from a business photo template." }, 409);
  return adminJson({ ok: false, error: "The customer photo request could not be completed." }, 500);
}

function eventStatement(db: D1Database, values: {
  requestId: string; workOrderId: string; ownerUid: string; actorUid: string; eventType: string; revision: number; now: string;
}) {
  return db.prepare(`INSERT INTO trade_crm_photo_request_events
    (id, photo_request_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type, request_revision, created_at)
    VALUES (?, ?, ?, ?, 'installer', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), values.requestId, values.workOrderId, values.ownerUid, values.actorUid, values.eventType, values.revision, values.now);
}

async function managedDirectJob(access: TeamAccess, workOrderId: string) {
  if (!canDispatch(access)) throw new Error("PHOTO_REQUEST_MANAGEMENT_REQUIRED");
  await assignedJob(access, workOrderId);
  const job = await getD1().prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.source_type, w.revision,
      w.assignee_member_id, d.crm_customer_id, d.customer_source
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, access.ownerUid).first<DirectJob>();
  if (!job) throw new Error("DIRECT_JOB_NOT_FOUND");
  if (job.source_type === "opportunity" || job.customer_source === "platform_private") throw new Error("PROTECTED_CUSTOMER");
  if (!job.crm_customer_id || job.customer_source !== "trade_owned") throw new Error("DIRECT_CUSTOMER_REQUIRED");
  return job;
}

function parseRequirements(record: PhotoRequestRecord | null, serviceCategory: string) {
  if (!record) return defaultPhotoRequirements(serviceCategory);
  try { return normalisePhotoRequirements(JSON.parse(record.requirements)); }
  catch { return defaultPhotoRequirements(serviceCategory); }
}

function storedRequirements(value: string): PhotoRequirement[] {
  try { return normalisePhotoRequirements(JSON.parse(value)); }
  catch { return []; }
}

async function templateVersion(ownerUid: string, versionId: string, mustBeCurrent = false) {
  if (!versionId) return null;
  const availability = mustBeCurrent ? "AND t.status <> 'archived' AND t.published_version = v.version" : "";
  return getD1().prepare(`SELECT v.id, v.template_id, v.version, v.name, v.service_category, v.requirements
    FROM trade_crm_photo_template_versions v JOIN trade_crm_photo_templates t
      ON t.id = v.template_id AND t.firebase_uid = v.firebase_uid
    WHERE v.id = ? AND v.firebase_uid = ? ${availability}`).bind(versionId, ownerUid).first<PhotoTemplateVersion>();
}

async function publishedTemplateOptions(ownerUid: string) {
  const rows = await getD1().prepare(`SELECT v.id, v.template_id, v.version, v.name, v.service_category, v.requirements
    FROM trade_crm_photo_templates t JOIN trade_crm_photo_template_versions v
      ON v.template_id = t.id AND v.firebase_uid = t.firebase_uid AND v.version = t.published_version
    WHERE t.firebase_uid = ? AND t.status <> 'archived'
    ORDER BY v.service_category, v.name COLLATE NOCASE`).bind(ownerUid).all<PhotoTemplateVersion>();
  return rows.results.map((row) => ({ id: row.template_id, versionId: row.id, version: Number(row.version),
    name: row.name, serviceCategory: row.service_category, requirements: storedRequirements(row.requirements) }));
}

async function requestPayload(access: TeamAccess, job: DirectJob, shareUrl = "") {
  const record = await getD1().prepare(`SELECT * FROM trade_crm_photo_requests WHERE work_order_id = ? AND firebase_uid = ?`)
    .bind(job.id, access.ownerUid).first<PhotoRequestRecord>();
  const [media, templates, sourceVersion] = await Promise.all([
    record ? getD1().prepare(`SELECT photo_requirement_id, COUNT(*) count
      FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ?
      GROUP BY photo_requirement_id`)
      .bind(access.ownerUid, job.id, record.id).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    publishedTemplateOptions(access.ownerUid),
    record?.source_template_version_id ? templateVersion(access.ownerUid, record.source_template_version_id) : Promise.resolve(null),
  ]);
  const sourceRequirements = sourceVersion ? storedRequirements(sourceVersion.requirements) : [];
  let templateFeedback = {};
  try { templateFeedback = normalisePhotoTemplateFeedback(JSON.parse(record?.template_feedback || "{}"), sourceRequirements); }
  catch { templateFeedback = {}; }
  return {
    request: record ? {
      id: record.id,
      status: record.status,
      revision: Number(record.revision),
      requirements: parseRequirements(record, job.service_category),
      expiresAt: record.expires_at,
      lastSharedAt: record.last_shared_at,
      linkActive: record.status === "active" && record.expires_at > new Date().toISOString(),
      uploadCounts: Object.fromEntries(media.results.map((row) => [String(row.photo_requirement_id), Number(row.count)])),
      sourceTemplate: sourceVersion ? { id: sourceVersion.template_id, versionId: sourceVersion.id,
        version: Number(sourceVersion.version), name: sourceVersion.name, serviceCategory: sourceVersion.service_category,
        requirements: sourceRequirements } : null,
      sourceTemplateEdited: Boolean(record.source_template_edited),
      templateFeedback,
      templateMissingFeedback: Boolean(record.template_missing_feedback),
    } : null,
    defaults: defaultPhotoRequirements(job.service_category),
    templates,
    job: { id: job.id, workNumber: job.work_number, title: job.title, serviceCategory: job.service_category },
    shareUrl,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const job = await managedDirectJob(access, workOrderId);
    return adminJson({ ok: true, ...(await requestPayload(access, job)) });
  } catch (error) { return responseForError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 30) || "save_request";
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await managedDirectJob(access, workOrderId);
    const db = getD1();
    const current = await db.prepare(`SELECT * FROM trade_crm_photo_requests WHERE work_order_id = ? AND firebase_uid = ?`)
      .bind(workOrderId, access.ownerUid).first<PhotoRequestRecord>();
    const now = new Date().toISOString();
    let shareUrl = "";

    if (action === "save_request") {
      const requirements = normalisePhotoRequirements(body.requirements);
      const secret = current ? "" : newPhotoRequestSecret();
      const requestId = current?.id || crypto.randomUUID();
      const nextRevision = current ? Number(current.revision) + 1 : 1;
      const jobRevision = nextJobRevision(job.revision);
      if (current) {
        const expectedRevision = Number(body.expectedRevision || 0);
        if (expectedRevision !== Number(current.revision)) throw new Error("PHOTO_REQUEST_CHANGED");
        const sourceVersion = await templateVersion(access.ownerUid, current.source_template_version_id);
        const sourceEdited = sourceVersion ? !photoRequirementsEqual(storedRequirements(sourceVersion.requirements), requirements) : false;
        const updated = await db.prepare(`UPDATE trade_crm_photo_requests SET requirements = ?, revision = ?, source_template_edited = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ?`)
          .bind(JSON.stringify(requirements), nextRevision, sourceEdited ? 1 : 0, now, current.id, access.ownerUid, expectedRevision).run();
        if (!updated.meta.changes) throw new Error("PHOTO_REQUEST_CHANGED");
        await db.batch([
          eventStatement(db, { requestId, workOrderId, ownerUid: access.ownerUid, actorUid: access.actorUid, eventType: "requirements_updated", revision: nextRevision, now }),
          db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'customer_photo_request_updated', 'Customer photo requirements updated.', ?)`)
            .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
          db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
            .bind(jobRevision, now, workOrderId, access.ownerUid),
          ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision, changedAt: now, audienceMemberId: job.assignee_member_id }),
        ]);
      } else {
        const requestedVersionId = cleanAdminText(body.sourceTemplateVersionId, 180);
        const sourceVersion = requestedVersionId ? await templateVersion(access.ownerUid, requestedVersionId, true) : null;
        if (requestedVersionId && !sourceVersion) throw new Error("PHOTO_TEMPLATE_NOT_AVAILABLE");
        const sourceRequirements = sourceVersion ? storedRequirements(sourceVersion.requirements) : [];
        const sourceEdited = sourceVersion ? !photoRequirementsEqual(sourceRequirements, requirements) : false;
        const tokenHash = await hashPhotoRequestSecret(secret);
        const expiresAt = photoRequestExpiry(new Date(now));
        await db.batch([
          db.prepare(`INSERT INTO trade_crm_photo_requests
            (id, work_order_id, firebase_uid, crm_customer_id, token_hash, status, requirements, revision,
             expires_at, last_shared_at, source_template_id, source_template_version_id, source_template_version,
             source_template_edited, template_feedback, template_missing_feedback, created_by_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?, ?, ?, '{}', 0, ?, ?, ?)`)
            .bind(requestId, workOrderId, access.ownerUid, job.crm_customer_id, tokenHash, JSON.stringify(requirements), expiresAt, now,
              sourceVersion?.template_id || "", sourceVersion?.id || "", Number(sourceVersion?.version || 0), sourceEdited ? 1 : 0,
              access.actorUid, now, now),
          eventStatement(db, { requestId, workOrderId, ownerUid: access.ownerUid, actorUid: access.actorUid, eventType: "request_created", revision: 1, now }),
          db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'customer_photo_request_created', 'Secure customer photo request created.', ?)`)
            .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
          db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
            .bind(jobRevision, now, workOrderId, access.ownerUid),
          ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision, changedAt: now, audienceMemberId: job.assignee_member_id }),
        ]);
        shareUrl = `${new URL(request.url).origin}/job-information/${requestId}.${secret}`;
      }
    } else if (action === "save_feedback") {
      if (!current) throw new Error("PHOTO_REQUEST_NOT_FOUND");
      const sourceVersion = await templateVersion(access.ownerUid, current.source_template_version_id);
      if (!sourceVersion) throw new Error("PHOTO_TEMPLATE_REQUIRED");
      const feedback = normalisePhotoTemplateFeedback(body.templateFeedback, storedRequirements(sourceVersion.requirements));
      await db.batch([
        db.prepare(`UPDATE trade_crm_photo_requests SET template_feedback = ?, template_missing_feedback = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(JSON.stringify(feedback), body.templateMissingFeedback === true ? 1 : 0, now, current.id, access.ownerUid),
        eventStatement(db, { requestId: current.id, workOrderId, ownerUid: access.ownerUid, actorUid: access.actorUid,
          eventType: "template_feedback_updated", revision: Number(current.revision), now }),
      ]);
    } else if (action === "issue_link") {
      if (!current) throw new Error("PHOTO_REQUEST_NOT_FOUND");
      const secret = newPhotoRequestSecret();
      const tokenHash = await hashPhotoRequestSecret(secret);
      const expiresAt = photoRequestExpiry(new Date(now));
      await db.batch([
        db.prepare(`UPDATE trade_crm_photo_requests SET token_hash = ?, status = 'active', expires_at = ?, last_shared_at = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(tokenHash, expiresAt, now, now, current.id, access.ownerUid),
        eventStatement(db, { requestId: current.id, workOrderId, ownerUid: access.ownerUid, actorUid: access.actorUid, eventType: "link_issued", revision: Number(current.revision), now }),
      ]);
      shareUrl = `${new URL(request.url).origin}/job-information/${current.id}.${secret}`;
    } else {
      return adminJson({ ok: false, error: "Unsupported photo request action." }, 400);
    }
    const refreshedJob = await managedDirectJob(access, workOrderId);
    return adminJson({ ok: true, ...(await requestPayload(access, refreshedJob, shareUrl)) }, current ? 200 : 201);
  } catch (error) { return responseForError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const job = await managedDirectJob(access, workOrderId);
    const db = getD1();
    const current = await db.prepare(`SELECT * FROM trade_crm_photo_requests WHERE work_order_id = ? AND firebase_uid = ?`)
      .bind(workOrderId, access.ownerUid).first<PhotoRequestRecord>();
    if (!current) throw new Error("PHOTO_REQUEST_NOT_FOUND");
    const now = new Date().toISOString();
    const jobRevision = nextJobRevision(job.revision);
    await db.batch([
      db.prepare(`UPDATE trade_crm_photo_requests SET status = 'revoked', token_hash = '', updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(now, current.id, access.ownerUid),
      eventStatement(db, { requestId: current.id, workOrderId, ownerUid: access.ownerUid, actorUid: access.actorUid, eventType: "request_revoked", revision: Number(current.revision), now }),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'customer_photo_request_revoked', 'Customer photo request link revoked.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(jobRevision, now, workOrderId, access.ownerUid),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision, changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return adminJson({ ok: true, ...(await requestPayload(access, { ...job, revision: jobRevision })) });
  } catch (error) { return responseForError(error); }
}
