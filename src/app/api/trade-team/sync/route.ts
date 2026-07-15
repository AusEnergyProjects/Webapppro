import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";

export const runtime = "edge";

const CONTRACT_VERSION = 1;
const MAX_ACTIONS = 50;
const MAX_CHANGES = 200;
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const TASK_STATUSES = new Set(["pending", "done"]);
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

type OfflineAction = Record<string, unknown>;

function syncError(error: unknown) {
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
  const [jobRows, taskRows] = await Promise.all([
    db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.stage, w.priority,
        w.scheduled_start, w.scheduled_end, w.assignee_member_id, w.assignee_label, w.source_type,
        w.revision, w.updated_at, d.customer_source, c.address_line_1, c.address_line_2, c.suburb,
        c.address_state, c.postcode
      FROM trade_work_orders w
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
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
  ]);
  return new Map(jobRows.results.map((row) => {
    const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
    const serviceAddress = protectedJob ? "" : [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode]
      .map((part) => String(part || "").trim()).filter(Boolean).join(", ");
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
      serviceAddress,
      revision: Number(row.revision || 1),
      updatedAt: row.updated_at,
      offlinePolicy: {
        containsPersonalData: Boolean(serviceAddress),
        maxAgeSeconds: serviceAddress ? 86_400 : 604_800,
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
        devicePolicy: { encryptedStorageRequired: true, purgeOnSignOut: true, protectedCustomerContactDataAllowed: false },
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
      nextCursor: `v1:${next}`, hasMore, changes });
  } catch (error) { return syncError(error); }
}

function actionRecordStatement(
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
  return db.prepare(`INSERT INTO trade_offline_actions
    (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type,
     entity_type, entity_id, base_revision, result_revision, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'job', ?, ?, ?, 'applied', ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, access.actorUid, access.memberId, deviceId,
      cleanAdminText(action.clientActionId, 120), hash, cleanAdminText(action.type, 40), entityId,
      baseRevision, resultRevision, now);
}

async function replayResult(access: TeamAccess, action: OfflineAction, hash: string) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const existing = await getD1().prepare(`SELECT payload_hash, action_type, entity_id, result_revision, status, created_at
    FROM trade_offline_actions WHERE owner_uid = ? AND client_action_id = ?`)
    .bind(access.ownerUid, clientActionId).first<Record<string, unknown>>();
  if (!existing) return null;
  if (existing.payload_hash !== hash) return { clientActionId, status: "rejected", code: "IDEMPOTENCY_MISMATCH",
    error: "This action ID was already used for different content." };
  return { clientActionId, status: "duplicate", actionType: existing.action_type, entityId: existing.entity_id,
    resultRevision: Number(existing.result_revision), appliedAt: existing.created_at };
}

async function applyAction(access: TeamAccess, deviceId: string, action: OfflineAction) {
  const clientActionId = cleanAdminText(action.clientActionId, 120);
  const actionType = cleanAdminText(action.type, 40);
  if (!CLIENT_ID_PATTERN.test(clientActionId)) return { clientActionId, status: "rejected", code: "INVALID_ACTION_ID",
    error: "Use a stable action ID with at least eight letters or numbers." };
  const hash = await payloadHash(action);
  const replay = await replayResult(access, action, hash);
  if (replay) return replay;
  const db = getD1();
  const now = new Date().toISOString();

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
    const resultRevision = nextJobRevision(job.revision);
    const update = await db.prepare(`UPDATE trade_work_orders SET stage = ?, revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(stage, resultRevision, now, workOrderId, access.ownerUid, baseRevision).run();
    if (!update.meta.changes) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: workOrderId };
    await db.batch([
      actionRecordStatement(db, access, deviceId, action, hash, workOrderId, baseRevision, resultRevision, now),
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
    const taskRevision = nextJobRevision(task.revision);
    const update = await db.prepare(`UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ?`)
      .bind(status, status === "done" ? now : "", taskRevision, now, taskId, access.ownerUid, baseRevision).run();
    if (!update.meta.changes) return { clientActionId, status: "conflict", code: "REVISION_CONFLICT", entityId: taskId };
    const jobRevision = nextJobRevision(job.revision);
    await db.batch([
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(jobRevision, now, workOrderId, access.ownerUid),
      actionRecordStatement(db, access, deviceId, action, hash, workOrderId, baseRevision, jobRevision, now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'offline_task_update', 'Field app updated a checklist item.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision: jobRevision,
        changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return { clientActionId, status: "applied", actionType, entityId: workOrderId, taskId, resultRevision: jobRevision,
      taskRevision, appliedAt: now };
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
    const resultRevision = nextJobRevision(job.revision);
    await db.batch([
      db.prepare(`INSERT INTO trade_crm_time_entries
        (id, work_order_id, firebase_uid, staff_label, work_date, duration_minutes, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, access.displayName, workDate, durationMinutes, notes, now, now),
      db.prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(resultRevision, now, workOrderId, access.ownerUid),
      actionRecordStatement(db, access, deviceId, action, hash, workOrderId, Number(job.revision), resultRevision, now),
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
    if (!CLIENT_ID_PATTERN.test(deviceId)) return adminJson({ ok: false, error: "Register a stable device ID before syncing field actions." }, 400);
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
      conflicts: results.filter((item) => item.status === "conflict").length, results });
  } catch (error) { return syncError(error); }
}
