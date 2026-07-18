import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { assignedJob, canDispatch, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import {
  defaultPhotoRequirements,
  hashPhotoRequestSecret,
  newPhotoRequestSecret,
  normalisePhotoRequirements,
  photoRequestExpiry,
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
  created_at: string;
  updated_at: string;
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

async function requestPayload(access: TeamAccess, job: DirectJob, shareUrl = "") {
  const record = await getD1().prepare(`SELECT * FROM trade_crm_photo_requests WHERE work_order_id = ? AND firebase_uid = ?`)
    .bind(job.id, access.ownerUid).first<PhotoRequestRecord>();
  const media = record ? await getD1().prepare(`SELECT photo_requirement_id, COUNT(*) count
      FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ?
      GROUP BY photo_requirement_id`)
    .bind(access.ownerUid, job.id, record.id).all<Record<string, unknown>>() : { results: [] };
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
    } : null,
    defaults: defaultPhotoRequirements(job.service_category),
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
        const updated = await db.prepare(`UPDATE trade_crm_photo_requests SET requirements = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ?`)
          .bind(JSON.stringify(requirements), nextRevision, now, current.id, access.ownerUid, expectedRevision).run();
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
        const tokenHash = await hashPhotoRequestSecret(secret);
        const expiresAt = photoRequestExpiry(new Date(now));
        await db.batch([
          db.prepare(`INSERT INTO trade_crm_photo_requests
            (id, work_order_id, firebase_uid, crm_customer_id, token_hash, status, requirements, revision,
             expires_at, last_shared_at, created_by_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?, ?)`)
            .bind(requestId, workOrderId, access.ownerUid, job.crm_customer_id, tokenHash, JSON.stringify(requirements), expiresAt, now, access.actorUid, now, now),
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
