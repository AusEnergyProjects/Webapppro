import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { mobileAppPolicy, mobileErrorResponse, MOBILE_CLIENT_ID_PATTERN, MOBILE_CONTRACT_VERSION,
  requireRegisteredMobileDevice } from "@/lib/trade-mobile-server";
import { normalizeTradeFormAnswers, tradeFormCompletion } from "@/lib/trade-form-library.mjs";
import { addMonthsToIsoDate } from "@/lib/asset-lifecycle.mjs";
import { photoRequestProofOverview } from "@/lib/photo-request-review-server";
import { normalisePhotoRequirements } from "@/lib/trade-photo-requests";

export const runtime = "edge";

const CONTRACT_VERSION = MOBILE_CONTRACT_VERSION;
const MAX_ACTIONS = 50;
const MAX_CHANGES = 200;
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const TASK_STATUSES = new Set(["pending", "done"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

type OfflineAction = Record<string, unknown>;

function syncError(error: unknown) {
  const mobile = mobileErrorResponse(error);
  if (mobile) return adminJson({ ok: false, code: mobile.code, error: mobile.error,
    ...(mobile.minimumVersion ? { minimumVersion: mobile.minimumVersion } : {}) }, mobile.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Offline team sync requires team access on the installer account." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Offline sync is available to installer teams only." }, 403);
  return adminJson({ ok: false, error: "The offline sync request could not be completed." }, 500);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function payloadHash(action: OfflineAction) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(action))));
  return base64Url(new Uint8Array(digest));
}

function privateDataDetected(value: string) {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value);
}

function cursorValue(value: string | null) {
  if (value === null) return null;
  const match = /^v1:(\d+)$/.exec(value);
  if (!match) return Number.NaN;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

async function accessibleJobs(access: TeamAccess) {
  const db = getD1();
  const [jobRows, taskRows, mediaRows, formRows] = await Promise.all([
    db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.stage, w.priority,
        w.scheduled_start, w.scheduled_end, w.assignee_member_id, w.assignee_label, w.source_type,
        w.revision, w.updated_at, d.customer_source, d.description,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
        COALESCE((SELECT cc.phone FROM trade_crm_site_contacts sc JOIN trade_crm_customer_contacts cc
          ON cc.id = sc.customer_contact_id AND cc.firebase_uid = sc.firebase_uid
          WHERE sc.service_site_id = ss.id AND sc.firebase_uid = w.firebase_uid AND sc.record_status = 'active' AND cc.record_status = 'active'
          AND cc.phone <> '' ORDER BY sc.is_primary DESC, sc.created_at LIMIT 1), c.phone, '') customer_phone,
        ss.site_label, ss.address_line_1, ss.address_line_2, ss.suburb, ss.address_state, ss.postcode,
        a.id appointment_id, a.status appointment_status, a.starts_at appointment_starts_at, a.ends_at appointment_ends_at,
        a.travel_started_at, a.arrived_at, a.work_started_at, a.completed_at,
        (SELECT COUNT(*) FROM trade_crm_job_notes n WHERE n.work_order_id = w.id AND n.firebase_uid = w.firebase_uid AND n.note_type = 'issue' AND n.issue_status = 'open') open_issues
      FROM trade_work_orders w
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_service_sites ss ON ss.id = d.service_site_id AND ss.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_appointments a ON a.id = (SELECT fa.id FROM trade_crm_appointments fa WHERE fa.work_order_id = w.id AND fa.firebase_uid = w.firebase_uid
        AND fa.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
        ORDER BY CASE fa.status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, fa.starts_at DESC LIMIT 1)
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
        AND (? <> 'technician' OR w.assignee_member_id = ?)
      ORDER BY w.scheduled_start = '', w.scheduled_start, w.updated_at DESC LIMIT 500`)
      .bind(access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT t.id, t.work_order_id, t.title, t.due_at, t.status, t.completed_at, t.revision, t.updated_at
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
      WHERE t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'technician' OR w.assignee_member_id = ?)
      ORDER BY t.status = 'done', t.due_at = '', t.due_at, t.created_at`)
      .bind(access.ownerUid, access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT m.id, m.work_order_id, m.category, m.file_name, m.content_type, m.size_bytes, m.caption, m.created_at
      FROM trade_crm_job_media m JOIN trade_work_orders w ON w.id = m.work_order_id
      WHERE m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'technician' OR w.assignee_member_id = ?)
      ORDER BY m.created_at DESC`)
      .bind(access.ownerUid, access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT f.id, f.work_order_id, f.template_key, f.template_version, f.template_name, f.jurisdiction,
        f.template_snapshot, f.answers, f.status, f.revision, f.completed_at, f.updated_at
      FROM trade_job_forms f JOIN trade_work_orders w ON w.id = f.work_order_id
      WHERE f.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
        AND (? <> 'technician' OR w.assignee_member_id = ?)
      ORDER BY f.status = 'complete', f.created_at`)
      .bind(access.ownerUid, access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>(),
  ]);
  return new Map(jobRows.results.map((row) => {
    const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
    const directCustomer = !protectedJob && row.customer_source === "trade_owned";
    const serviceAddress = directCustomer ? [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode]
      .map((part) => String(part || "").trim()).filter(Boolean).join(", ") : "";
    return [String(row.id), {
      id: row.id,
      workNumber: row.work_number,
      title: row.title,
      serviceCategory: row.service_category,
      siteArea: row.site_area,
      stage: row.stage,
      priority: row.priority,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      assigneeMemberId: row.assignee_member_id,
      assigneeLabel: row.assignee_label,
      protectedJob,
      customerName: protectedJob ? "AEA protected customer" : directCustomer ? String(row.customer_name || "Direct customer") : "Internal job",
      customerPhone: directCustomer ? String(row.customer_phone || "") : "",
      serviceAddress,
      appointmentId: row.appointment_id || "",
      appointmentStatus: row.appointment_status || "",
      appointmentStartsAt: row.appointment_starts_at || "",
      appointmentEndsAt: row.appointment_ends_at || "",
      travelStartedAt: row.travel_started_at || "",
      arrivedAt: row.arrived_at || "",
      workStartedAt: row.work_started_at || "",
      completedAt: row.completed_at || "",
      description: row.description || "",
      openIssues: Number(row.open_issues || 0),
      revision: Number(row.revision || 1),
      updatedAt: row.updated_at,
      offlinePolicy: {
        containsPersonalData: Boolean(serviceAddress || (directCustomer && row.customer_phone)),
        maxAgeSeconds: serviceAddress || (directCustomer && row.customer_phone) ? 86_400 : 604_800,
        purgeWhenUnassigned: true,
      },
      tasks: taskRows.results.filter((task) => task.work_order_id === row.id).map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.due_at,
        status: task.status,
        completedAt: task.completed_at,
        revision: Number(task.revision || 1),
        updatedAt: task.updated_at,
      })),
      media: mediaRows.results.filter((media) => media.work_order_id === row.id).map((media) => ({
        id: media.id, category: media.category, fileName: protectedJob ? "Protected field file" : media.file_name,
        contentType: media.content_type, sizeBytes: Number(media.size_bytes),
        caption: protectedJob ? "" : media.caption, createdAt: media.created_at,
      })),
      forms: formRows.results.filter((form) => form.work_order_id === row.id).map((form) => {
        const template = (() => { try { return JSON.parse(String(form.template_snapshot || "{}")); } catch { return { fields: [] }; } })();
        const answers = (() => { try { return JSON.parse(String(form.answers || "{}")); } catch { return {}; } })();
        const completion = tradeFormCompletion(template, answers);
        return { id: form.id, templateKey: form.template_key, templateVersion: Number(form.template_version),
          name: form.template_name, jurisdiction: form.jurisdiction, template, answers, status: form.status,
          revision: Number(form.revision || 1), ready: completion.ready, missing: completion.missing,
          completedAt: form.completed_at, updatedAt: form.updated_at };
      }),
    }];
  }));
}

async function highWater(access: TeamAccess) {
  const audience = access.role === "technician" ? access.memberId : "";
  const row = await getD1().prepare(`SELECT COALESCE(MAX(sequence), 0) sequence FROM trade_team_sync_changes
    WHERE owner_uid = ? AND audience_member_id = ?`).bind(access.ownerUid, audience).first<Record<string, unknown>>();
  return Number(row?.sequence || 0);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const url = new URL(request.url);
    const deviceId = cleanAdminText(url.searchParams.get("deviceId") || request.headers.get("x-aea-device-id"), 120);
    const device = await requireRegisteredMobileDevice(request, access, deviceId,
      cleanAdminText(url.searchParams.get("platform"), 20), cleanAdminText(url.searchParams.get("appVersion"), 40));
    const cursor = cursorValue(url.searchParams.get("cursor"));
    if (Number.isNaN(cursor)) return adminJson({ ok: false, error: "The sync cursor is invalid. Start a fresh sync." }, 400);
    const requestedLimit = Number(url.searchParams.get("limit") || 100);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(MAX_CHANGES, requestedLimit)) : 100;
    const serverTime = new Date().toISOString();

    if (cursor === null) {
      const next = await highWater(access);
      const jobs = await accessibleJobs(access);
      return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, bootstrap: true, serverTime,
        nextCursor: `v1:${next}`, hasMore: false,
        device: { id: device.deviceId, name: device.deviceName, platform: device.platform },
        devicePolicy: mobileAppPolicy(device.platform),
        changes: [...jobs.values()].map((entity) => ({ sequence: next, entityType: "job", entityId: entity.id,
          operation: "upsert", revision: entity.revision, entity })) });
    }

    const audience = access.role === "technician" ? access.memberId : "";
    const rows = await getD1().prepare(`SELECT sequence, entity_type, entity_id, operation, revision, changed_at
      FROM trade_team_sync_changes WHERE owner_uid = ? AND audience_member_id = ? AND sequence > ?
      ORDER BY sequence LIMIT ?`).bind(access.ownerUid, audience, cursor, limit + 1).all<Record<string, unknown>>();
    const jobs = await accessibleJobs(access);
    const hasMore = rows.results.length > limit;
    const page = rows.results.slice(0, limit);
    const latest = new Map<string, Record<string, unknown>>();
    page.forEach((row) => latest.set(`${row.entity_type}:${row.entity_id}`, row));
    const changes = [...latest.values()].map((row) => {
      const entity = jobs.get(String(row.entity_id));
      if (row.operation === "delete" || !entity) return { sequence: Number(row.sequence), entityType: row.entity_type,
        entityId: row.entity_id, operation: "delete", revision: Number(row.revision), changedAt: row.changed_at };
      return { sequence: Number(row.sequence), entityType: row.entity_type, entityId: row.entity_id,
        operation: "upsert", revision: entity.revision, changedAt: row.changed_at, entity };
    });
    const next = page.length ? Number(page.at(-1)?.sequence || cursor) : cursor;
    return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, bootstrap: false, serverTime,
      nextCursor: `v1:${next}`, hasMore, devicePolicy: mobileAppPolicy(device.platform), changes });
  } catch (error) { return syncError(error); }
}

function actionReceiptStatement(
  db: D1Database,
  access: TeamAccess,
  deviceId: string,
  action: OfflineAction,
  hash: string,
  entityId: string,
  baseRevision: number,
  resultRevision: number,
  now: string,
) {
  return db.prepare(`UPDATE trade_offline_actions SET result_revision = ?, status = 'applied', lease_until = '',
    error_code = '', updated_at = ? WHERE owner_uid = ? AND client_action_id = ? AND payload_hash = ?
      AND device_id = ? AND entity_id = ? AND base_revision = ? AND status = 'processing'`)
    .bind(resultRevision, now, access.ownerUid, cleanAdminText(action.clientActionId, 120), hash,
      deviceId, entityId, baseRevision);
}

async function replayResult(access: TeamAccess, action: OfflineAction, hash: string) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const existing = await getD1().prepare(`SELECT id, payload_hash, action_type, entity_id, base_revision, result_revision,
      status, lease_until, error_code, created_at, updated_at
    FROM trade_offline_actions WHERE owner_uid = ? AND client_action_id = ?`)
    .bind(access.ownerUid, clientActionId).first<Record<string, unknown>>();
  if (!existing) return null;
  if (existing.payload_hash !== hash) return { clientActionId, status: "rejected", code: "IDEMPOTENCY_MISMATCH",
    error: "This action ID was already used for different content." };
  if (existing.status === "processing") {
    const now = new Date().toISOString();
    if (String(existing.lease_until || "") <= now) {
      await getD1().prepare(`DELETE FROM trade_offline_actions WHERE id = ? AND owner_uid = ?
        AND status = 'processing' AND lease_until <= ?`).bind(existing.id, access.ownerUid, now).run();
      return null;
    }
    return { clientActionId, status: "retry", code: "ACTION_IN_PROGRESS",
      retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(String(existing.lease_until)) - Date.now()) / 1000)) };
  }
  if (existing.status === "conflict") return { clientActionId, status: "conflict", code: existing.error_code || "REVISION_CONFLICT",
    entityId: existing.entity_id, baseRevision: Number(existing.base_revision), currentRevision: Number(existing.result_revision) };
  return { clientActionId, status: "duplicate", actionType: existing.action_type, entityId: existing.entity_id,
    resultRevision: Number(existing.result_revision), appliedAt: existing.updated_at || existing.created_at };
}

async function reserveAction(access: TeamAccess, deviceId: string, action: OfflineAction, hash: string,
  entityId: string, baseRevision: number, now: string) {
  const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const result = await getD1().prepare(`INSERT OR IGNORE INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type,
     entity_type, entity_id, base_revision, result_revision, status, lease_until, error_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'job', ?, ?, 0, 'processing', ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, access.actorUid, access.memberId, deviceId,
      cleanAdminText(action.clientActionId, 120), hash, cleanAdminText(action.type, 40), entityId,
      baseRevision, leaseUntil, now, now).run();
  if (result.meta.changes) return null;
  return replayResult(access, action, hash);
}

async function releaseConflict(access: TeamAccess, action: OfflineAction, currentRevision: number, now: string) {
  await getD1().prepare(`UPDATE trade_offline_actions SET status = 'conflict', result_revision = ?, lease_until = '',
    error_code = 'REVISION_CONFLICT', updated_at = ? WHERE owner_uid = ? AND client_action_id = ? AND status = 'processing'`)
    .bind(currentRevision, now, access.ownerUid, cleanAdminText(action.clientActionId, 120)).run();
}

async function fieldFinishBlockers(ownerUid: string, workOrderId: string) {
  const db = getD1();
  const [tasks, forms, issues, plan, request] = await Promise.all([
    db.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'done'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'complete'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_crm_job_notes WHERE work_order_id = ? AND firebase_uid = ? AND note_type = 'issue' AND issue_status = 'open'").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) count FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id = r.job_plan_id AND p.firebase_uid = r.firebase_uid
      WHERE p.work_order_id = ? AND p.firebase_uid = ? AND r.status NOT IN ('installed', 'complete', 'completed', 'done', 'not_required')`).bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
    db.prepare("SELECT id, revision, requirements, status FROM trade_crm_photo_requests WHERE work_order_id = ? AND firebase_uid = ?").bind(workOrderId, ownerUid).first<Record<string, unknown>>(),
  ]);
  const blockers = [Number(tasks?.count || 0) ? "assigned tasks" : "", Number(forms?.count || 0) ? "required forms" : "", Number(issues?.count || 0) ? "open issues" : "", Number(plan?.count || 0) ? "work-plan items" : ""].filter(Boolean);
  if (request && request.status !== "revoked") {
    try { const proof = await photoRequestProofOverview({ ownerUid, workOrderId, requestId: String(request.id), requestRevision: Number(request.revision), requirements: normalisePhotoRequirements(JSON.parse(String(request.requirements || "[]"))) }); if (!proof.proofReady) blockers.push("required photo proof"); }
    catch { blockers.push("required photo proof"); }
  }
  return blockers;
}

async function applyAction(access: TeamAccess, deviceId: string, action: OfflineAction) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const actionType = cleanAdminText(action.type, 40);
  if (!MOBILE_CLIENT_ID_PATTERN.test(clientActionId)) return { clientActionId, status: "rejected", code: "INVALID_ACTION_ID",
    error: "Use a stable action ID with at least eight letters or numbers." };
  const hash = await payloadHash(action);
  const replay = await replayResult(access, action, hash);
  if (replay) return replay;
  const db = getD1();
  const now = new Date().toISOString();

  if (actionType === "advance_field_job") {
    const workOrderId = cleanAdminText(action.workOrderId, 180); const transitionName = cleanAdminText(action.transition, 30);
    const transitions: Record<string, { from: string; to: string; timestamp: string; label: string }> = {
      start_travel: { from: "scheduled", to: "en_route", timestamp: "travel_started_at", label: "Start travel" },
      arrive: { from: "en_route", to: "arrived", timestamp: "arrived_at", label: "Arrive" },
      start_work: { from: "arrived", to: "in_progress", timestamp: "work_started_at", label: "Start work" },
      finish: { from: "in_progress", to: "completed", timestamp: "completed_at", label: "Finish" },
    };
    const transition = transitions[transitionName]; const baseRevision = Number(action.baseRevision);
    if (!transition || !Number.isInteger(baseRevision) || baseRevision < 1) return { clientActionId, status: "rejected", code: "INVALID_FIELD_TRANSITION", error: "Use the next available field-job action." };
    const job = await assignedJob(access, workOrderId);
    if (Number(job.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: workOrderId, baseRevision, currentRevision: Number(job.revision) };
    const appointment = await db.prepare(`SELECT * FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ?
      AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed') ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, starts_at DESC LIMIT 1`)
      .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
    if (!appointment) return { clientActionId, status: "rejected", code: "APPOINTMENT_REQUIRED", error: "Schedule this job before starting field work." };
    if (appointment.status !== transition.from) return { clientActionId, status: "rejected", code: "OUT_OF_ORDER", error: `This action is out of order. The appointment is ${String(appointment.status).replaceAll("_", " ")}.` };
    if (transitionName === "finish") { const blockers = await fieldFinishBlockers(access.ownerUid, workOrderId); if (blockers.length) return { clientActionId, status: "rejected", code: "FINISH_BLOCKED", error: `Complete ${blockers.join(", ")} before finishing.` }; }
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now); if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    const guard = `EXISTS (SELECT 1 FROM trade_crm_appointments fa WHERE fa.id = ? AND fa.firebase_uid = ?
      AND fa.status = ? AND fa.${transition.timestamp} = ? AND fa.last_transition_by_uid = ?)`;
    const results = await db.batch([
      db.prepare(`UPDATE trade_crm_appointments SET status = ?, ${transition.timestamp} = ?, last_transition_by_uid = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = ?`).bind(transition.to, now, access.actorUid, now, appointment.id, access.ownerUid, transition.from),
      db.prepare(`UPDATE trade_work_orders SET stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'completed' ELSE stage END,
        revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND ${guard}`)
        .bind(transitionName, transitionName, resultRevision, now, workOrderId, access.ownerUid, appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`UPDATE trade_crm_job_details SET pipeline_stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'complete' ELSE pipeline_stage END,
        updated_at = ? WHERE work_order_id = ? AND firebase_uid = ? AND ${guard}`)
        .bind(transitionName, transitionName, now, workOrderId, access.ownerUid, appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`UPDATE trade_crm_job_plans SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ? AND ? = 'finish' AND ${guard}`)
        .bind(now, now, workOrderId, access.ownerUid, transitionName, appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`UPDATE trade_crm_job_plan_phases SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)
        AND ? = 'finish' AND ${guard}`)
        .bind(now, now, access.ownerUid, workOrderId, access.ownerUid, transitionName, appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`UPDATE trade_offline_actions SET result_revision = ?, status = 'applied', lease_until = '', error_code = '', updated_at = ?
        WHERE owner_uid = ? AND client_action_id = ? AND payload_hash = ? AND device_id = ? AND entity_id = ? AND base_revision = ?
        AND status = 'processing' AND ${guard}`)
        .bind(resultRevision, now, access.ownerUid, clientActionId, hash, deviceId, workOrderId, baseRevision,
          appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'field_state_changed', ?, ? WHERE ${guard}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${transition.label} recorded in the field app.`, now,
          appointment.id, access.ownerUid, transition.to, now, access.actorUid),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, ?, ?, 'job_completed', 'Required work, forms, proof and blockers cleared. Invoice and handover preparation are ready.', ?
        WHERE ? = 'finish' AND ${guard}`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now, transitionName,
          appointment.id, access.ownerUid, transition.to, now, access.actorUid),
    ]);
    if (!results[0]?.meta.changes) { await releaseConflict(access, action, Number(job.revision), now); return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: workOrderId }; }
    await db.batch(jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: resultRevision, changedAt: now, audienceMemberId: job.assignee_member_id }));
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  if (actionType === "set_job_stage") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const stage = cleanAdminText(action.stage, 30);
    const baseRevision = Number(action.baseRevision);
    if (!WORK_STAGES.has(stage) || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_JOB_UPDATE", error: "Add a valid job stage and base revision." };
    }
    const job = await assignedJob(access, workOrderId);
    if (Number(job.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: workOrderId, baseRevision, currentRevision: Number(job.revision) };
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    const update = await db.prepare(`UPDATE trade_work_orders SET stage = ?, revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(stage, resultRevision, now, workOrderId, access.ownerUid, baseRevision).run();
    if (!update.meta.changes) { await releaseConflict(access, action, Number(job.revision), now);
      return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: workOrderId }; }
    await db.batch([
      actionReceiptStatement(db, access, deviceId, action, hash, workOrderId, baseRevision, resultRevision, now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'offline_stage_update', ?, ?)`).bind(crypto.randomUUID(), workOrderId, access.ownerUid,
        `Field app changed the job stage to ${stage.replaceAll("_", " ")}.`, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: resultRevision,
        changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  if (actionType === "set_task_status") {
    const taskId = cleanAdminText(action.taskId, 180);
    const status = cleanAdminText(action.status, 20);
    const baseRevision = Number(action.baseRevision);
    if (!TASK_STATUSES.has(status) || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_TASK_UPDATE", error: "Add a valid task status and base revision." };
    }
    const task = await db.prepare(`SELECT t.work_order_id, t.revision
      FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
      WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
      .bind(taskId, access.ownerUid, access.ownerUid).first<Record<string, unknown>>();
    if (!task) return { clientActionId, status: "rejected", code: "TASK_NOT_FOUND", error: "The checklist item is no longer available." };
    const workOrderId = String(task.work_order_id); const job = await assignedJob(access, workOrderId);
    if (Number(task.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: taskId, baseRevision, currentRevision: Number(task.revision) };
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const taskRevision = nextJobRevision(task.revision);
    const update = await db.prepare(`UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?`)
      .bind(status, status === "done" ? now : "", taskRevision, now, taskId, access.ownerUid, baseRevision).run();
    if (!update.meta.changes) { await releaseConflict(access, action, Number(task.revision), now);
      return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: taskId }; }
    const jobRevision = nextJobRevision(job.revision);
    await db.batch([
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(jobRevision, now, workOrderId, access.ownerUid),
      actionReceiptStatement(db, access, deviceId, action, hash, workOrderId, baseRevision, jobRevision, now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'offline_task_update', 'Field app updated a checklist item.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision,
        changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, taskId, resultRevision: jobRevision,
      taskRevision, appliedAt: now };
  }

  if (actionType === "save_job_form") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const formId = cleanAdminText(action.formId, 180);
    const baseRevision = Number(action.baseRevision);
    const complete = action.complete === true;
    if (!workOrderId || !formId || !Number.isInteger(baseRevision) || baseRevision < 1) {
      return { clientActionId, status: "rejected", code: "INVALID_FORM_UPDATE", error: "Add a valid form and base revision." };
    }
    const job = await assignedJob(access, workOrderId);
    const form = await db.prepare(`SELECT id, template_key, template_snapshot, status, revision FROM trade_job_forms
      WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`).bind(formId, workOrderId, access.ownerUid).first<Record<string, unknown>>();
    if (!form) return { clientActionId, status: "rejected", code: "FORM_NOT_FOUND", error: "The field form is no longer available." };
    if (form.status === "complete") return { clientActionId, status: "rejected", code: "FORM_LOCKED", error: "This completed form is locked." };
    if (Number(form.revision) !== baseRevision) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT",
      entityId: formId, baseRevision, currentRevision: Number(form.revision) };
    let template: Record<string, unknown>;
    try { template = JSON.parse(String(form.template_snapshot || "{}")) as Record<string, unknown>; }
    catch { return { clientActionId, status: "rejected", code: "INVALID_FORM", error: "The saved form template is invalid." }; }
    const answers = normalizeTradeFormAnswers(template, action.answers);
    if (privateDataDetected(JSON.stringify(answers))) return { clientActionId, status: "rejected", code: "PROTECTED_CUSTOMER_DATA",
      error: "Remove customer email or phone details from the technical form." };
    const completion = tradeFormCompletion(template, answers);
    if (complete && !completion.ready) return { clientActionId, status: "rejected", code: "FORM_INCOMPLETE",
      error: `Complete the required fields: ${completion.missing.join(", ")}.` };
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, baseRevision, now);
    if (reserved) return reserved;
    const formRevision = nextJobRevision(form.revision);
    const update = await db.prepare(`UPDATE trade_job_forms SET answers = ?, status = ?, revision = ?, completed_by_uid = ?,
      completed_at = ?, updated_at = ? WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND revision = ?`)
      .bind(JSON.stringify(answers), complete ? "complete" : "draft", formRevision, complete ? access.actorUid : "",
        complete ? now : "", now, formId, workOrderId, access.ownerUid, baseRevision).run();
    if (!update.meta.changes) {
      await releaseConflict(access, action, Number(form.revision), now);
      return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: formId };
    }
    const jobRevision = nextJobRevision(job.revision);
    const lifecycle: D1PreparedStatement[] = [];
    if (complete && form.template_key === "service-visit-support" && job.source_type === "recurring_service" && job.source_reference) {
      const plan = await db.prepare(`SELECT id, asset_id, handover_pack_id, work_order_id, cadence_months
        FROM trade_asset_service_plans WHERE id = ? AND firebase_uid = ?`).bind(job.source_reference, access.ownerUid).first<Record<string, unknown>>();
      if (plan) {
        const servicedAt = String(answers.work_date || now.slice(0, 10)); const nextDueAt = addMonthsToIsoDate(servicedAt, Number(plan.cadence_months));
        lifecycle.push(
          db.prepare(`INSERT INTO trade_asset_service_events
            (id, service_plan_id, asset_id, handover_pack_id, work_order_id, firebase_uid, event_type,
             serviced_at, summary, provider_reference, next_due_at, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, 'service_completed', ?, 'Scheduled service form completed.', ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM trade_asset_service_events WHERE service_plan_id = ? AND event_type = 'service_completed' AND provider_reference = ?)`)
            .bind(crypto.randomUUID(), plan.id, plan.asset_id, plan.handover_pack_id, plan.work_order_id, access.ownerUid,
              servicedAt, workOrderId, nextDueAt, now, now, plan.id, workOrderId),
          db.prepare("UPDATE trade_asset_service_plans SET next_due_at = ?, status = 'active', updated_at = ? WHERE id = ? AND firebase_uid = ?")
            .bind(nextDueAt, now, plan.id, access.ownerUid),
        );
      }
    }
    await db.batch([
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(jobRevision, now, workOrderId, access.ownerUid),
      actionReceiptStatement(db, access, deviceId, action, hash, workOrderId, baseRevision, jobRevision, now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), workOrderId, access.ownerUid,
          complete ? "offline_field_form_completed" : "offline_field_form_saved",
          complete ? `${String(template.name || "Field form")} completed in the field app.` : `${String(template.name || "Field form")} saved in the field app.`, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision,
        changedAt: now, audienceMemberId: job.assignee_member_id }), ...lifecycle,
    ]);
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, formId,
      resultRevision: jobRevision, formRevision, appliedAt: now };
  }

  if (actionType === "add_time_entry") {
    const workOrderId = cleanAdminText(action.workOrderId, 180);
    const workDate = cleanAdminText(action.workDate, 10);
    const durationMinutes = Number(action.durationMinutes);
    const notes = cleanAdminText(action.notes, 500);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`)) ||
      !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      return { clientActionId, status: "rejected", code: "INVALID_TIME_ENTRY", error: "Add a valid work date and duration." };
    }
    const job = await assignedJob(access, workOrderId);
    if (job.source_type === "opportunity" && privateDataDetected(notes)) {
      return { clientActionId, status: "rejected", code: "PROTECTED_CUSTOMER_DATA", error: "Remove contact details from protected job notes." };
    }
    const reserved = await reserveAction(access, deviceId, action, hash, workOrderId, Number(job.revision), now);
    if (reserved) return reserved;
    const resultRevision = nextJobRevision(job.revision);
    await db.batch([
      db.prepare(`INSERT INTO trade_crm_time_entries
        (id, work_order_id, firebase_uid, staff_label, work_date, duration_minutes, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, access.displayName, workDate, durationMinutes, notes, now, now),
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(resultRevision, now, workOrderId, access.ownerUid),
      actionReceiptStatement(db, access, deviceId, action, hash, workOrderId, Number(job.revision), resultRevision, now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'offline_time_added', 'Field app added a technician time entry.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: resultRevision,
        changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, resultRevision, appliedAt: now };
  }

  return { clientActionId, status: "rejected", code: "UNSUPPORTED_ACTION", error: "This offline action is not supported." };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "The offline action batch is invalid." }, 400); }
    const deviceId = cleanAdminText(body.deviceId, 100);
    const actions = Array.isArray(body.actions) ? body.actions.filter((item): item is OfflineAction => Boolean(item && typeof item === "object")) : [];
    if (!MOBILE_CLIENT_ID_PATTERN.test(deviceId)) return adminJson({ ok: false, error: "Register a stable device ID before syncing field actions." }, 400);
    const device = await requireRegisteredMobileDevice(request, access, deviceId,
      cleanAdminText(body.platform, 20), cleanAdminText(body.appVersion, 40));
    if (!actions.length || actions.length > MAX_ACTIONS) return adminJson({ ok: false, error: `Send between 1 and ${MAX_ACTIONS} offline actions at a time.` }, 400);
    const results = [];
    for (const action of actions) {
      try { results.push(await applyAction(access, deviceId, action)); }
      catch (error) {
        const code = error instanceof Error ? error.message : "ACTION_FAILED";
        results.push({ clientActionId: cleanAdminText(action.clientActionId, 120), status: "rejected", code,
          error: code === "JOB_NOT_ASSIGNED" ? "This job is no longer assigned to this team account." : "The action could not be applied." });
      }
    }
    return adminJson({ ok: true, contractVersion: CONTRACT_VERSION, serverTime: new Date().toISOString(),
      accepted: results.filter((item) => item.status === "applied" || item.status === "duplicate").length,
      conflicts: results.filter((item) => item.status === "conflict").length,
      retrying: results.filter((item) => item.status === "retry").length,
      devicePolicy: mobileAppPolicy(device.platform), results });
  } catch (error) { return syncError(error); }
}
