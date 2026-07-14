import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import type { PartnerType } from "@/lib/direct-trade-entitlements";

export const runtime = "edge";

const FREE_ACTIVE_LIMIT = 5;
const MEMBER_ACTIVE_LIMIT = 500;
const FREE_TASK_LIMIT = 10;
const MEMBER_TASK_LIMIT = 50;
const STAGES = new Set([
  "backlog",
  "ready",
  "scheduled",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
]);
const PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const SOURCE_TYPES = new Set(["internal", "opportunity", "product_enquiry"]);
const SERVICE_CATEGORIES = new Set([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "insulation-draughts",
  "ev-charging",
  "product-fulfilment",
  "other",
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

type TradeIdentity = {
  uid: string;
  partnerType: PartnerType;
  businessName: string;
  fullAccess: boolean;
  teamAccess: boolean;
};

function privateDataDetected(value: string) {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value);
}

function dateValue(value: unknown) {
  const clean = cleanAdminText(value, 10);
  if (!clean) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00Z`))) {
    throw new Error("INVALID_DATE");
  }
  return clean;
}

function eventStatement(
  db: D1Database,
  firebaseUid: string,
  workOrderId: string,
  eventType: string,
  summary: string,
  createdAt: string,
) {
  return db.prepare(`INSERT INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workOrderId, firebaseUid, eventType, summary, createdAt);
}

async function tradeIdentity(request: Request): Promise<TradeIdentity> {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid)
    .first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  const partnerType = String(account.partner_type) === "supplier" ? "supplier" : "installer";
  const entitlements = await accountEntitlements(identity.uid, partnerType, account.billing_status);
  return {
    uid: identity.uid,
    partnerType,
    businessName: String(account.business_name || "Trade business"),
    fullAccess: entitlements.features.business_operations,
    teamAccess: entitlements.features.team_access,
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the trade profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This trade account is not active." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Converting platform work requires paid Business Hub access or an administrator grant." }, 403);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Crew assignment requires the Team access premium feature." }, 403);
  if (code === "FREE_LIMIT_REACHED") return adminJson({ ok: false, error: `Free accounts can manage up to ${FREE_ACTIVE_LIMIT} active work records. Complete, archive or upgrade to add more.` }, 409);
  if (code === "MEMBER_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its active work-record fair-use limit." }, 409);
  if (code === "TASK_LIMIT_REACHED") return adminJson({ ok: false, error: "This work record has reached its checklist limit." }, 409);
  if (code === "WORK_NOT_FOUND") return adminJson({ ok: false, error: "Work record not found." }, 404);
  if (code === "SOURCE_NOT_FOUND") return adminJson({ ok: false, error: "That platform work item is no longer available to convert." }, 404);
  if (code === "SOURCE_ALREADY_USED") return adminJson({ ok: false, error: "That platform work item already has a Business Hub record." }, 409);
  if (code === "PRIVATE_DATA") return adminJson({ ok: false, error: "Keep names, email addresses and phone numbers out of Business Hub labels and checklists." }, 400);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose a valid schedule or due date." }, 400);
  return adminJson({ ok: false, error: "The Business Hub request could not be completed." }, 500);
}

async function sourceOptions(identity: TradeIdentity) {
  if (!identity.fullAccess) return [];
  const db = getD1();
  if (identity.partnerType === "installer") {
    const rows = await db.prepare(`SELECT m.id, o.title, o.state, o.service_categories
      FROM trade_opportunity_matches m
      JOIN trade_opportunities o ON o.id = m.opportunity_id
      WHERE m.firebase_uid = ? AND m.status IN ('interested', 'connected')
        AND NOT EXISTS (
          SELECT 1 FROM trade_work_orders w
          WHERE w.firebase_uid = m.firebase_uid AND w.source_type = 'opportunity'
            AND w.source_reference = m.id
        )
      ORDER BY m.updated_at DESC LIMIT 50`).bind(identity.uid).all<Record<string, unknown>>();
    return rows.results.map((row: Record<string, unknown>) => {
      let categories: string[] = [];
      try { categories = JSON.parse(String(row.service_categories || "[]")); } catch { categories = []; }
      return {
        id: row.id,
        sourceType: "opportunity",
        label: row.title,
        serviceCategory: categories.find((item) => SERVICE_CATEGORIES.has(item)) || "other",
        siteArea: row.state,
      };
    });
  }
  const rows = await db.prepare(`SELECT e.id, l.name
    FROM supplier_product_enquiries e
    JOIN installer_product_lists l ON l.id = e.list_id
    WHERE e.supplier_uid = ? AND e.status IN ('new', 'viewed', 'responded')
      AND NOT EXISTS (
        SELECT 1 FROM trade_work_orders w
        WHERE w.firebase_uid = e.supplier_uid AND w.source_type = 'product_enquiry'
          AND w.source_reference = e.id
      )
    ORDER BY e.updated_at DESC LIMIT 50`).bind(identity.uid).all<Record<string, unknown>>();
  return rows.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    sourceType: "product_enquiry",
    label: `Product request: ${String(row.name || "installer equipment list")}`,
    serviceCategory: "product-fulfilment",
    siteArea: "",
  }));
}

async function workOrderPayload(identity: TradeIdentity) {
  const db = getD1();
  const orderRows = await db.prepare(`SELECT id, partner_type, work_type, source_type, source_reference,
    work_number, title, service_category, site_area, stage, priority, scheduled_start, scheduled_end,
    assignee_label, record_status, created_at, updated_at
    FROM trade_work_orders WHERE firebase_uid = ? AND record_status = 'active'
    ORDER BY CASE stage
      WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'ready' THEN 2
      WHEN 'blocked' THEN 3 WHEN 'backlog' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
      scheduled_start = '', scheduled_start, updated_at DESC LIMIT 500`)
    .bind(identity.uid).all<Record<string, unknown>>();
  const ids = orderRows.results.map((row: Record<string, unknown>) => String(row.id));
  let tasks: Record<string, unknown>[] = [];
  let events: Record<string, unknown>[] = [];
  if (ids.length) {
    const [taskRows, eventRows] = await Promise.all([
      db.prepare(`SELECT id, work_order_id, title, due_at, status, completed_at, sort_order, created_at, updated_at
        FROM trade_work_order_tasks t
        WHERE t.firebase_uid = ? AND EXISTS (
          SELECT 1 FROM trade_work_orders w
          WHERE w.id = t.work_order_id AND w.firebase_uid = ? AND w.record_status = 'active'
        )
        ORDER BY status = 'done', sort_order, due_at = '', due_at, created_at`)
        .bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, work_order_id, event_type, summary, created_at
        FROM trade_work_order_events e
        WHERE e.firebase_uid = ? AND EXISTS (
          SELECT 1 FROM trade_work_orders w
          WHERE w.id = e.work_order_id AND w.firebase_uid = ? AND w.record_status = 'active'
        )
        ORDER BY created_at DESC LIMIT 100`)
        .bind(identity.uid, identity.uid).all<Record<string, unknown>>(),
    ]);
    tasks = taskRows.results;
    events = eventRows.results;
  }
  const activeCount = orderRows.results.filter((row: Record<string, unknown>) => !["completed", "cancelled"].includes(String(row.stage))).length;
  return {
    workOrders: orderRows.results.map((row: Record<string, unknown>) => {
      const workTasks = tasks.filter((task) => task.work_order_id === row.id);
      const lastEvent = events.find((event) => event.work_order_id === row.id);
      return {
        id: row.id,
        partnerType: row.partner_type,
        workType: row.work_type,
        sourceType: row.source_type,
        sourceReference: row.source_reference,
        workNumber: row.work_number,
        title: row.title,
        serviceCategory: row.service_category,
        siteArea: row.site_area,
        stage: row.stage,
        priority: row.priority,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        assigneeLabel: row.assignee_label,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tasks: workTasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueAt: task.due_at,
          status: task.status,
          completedAt: task.completed_at,
          sortOrder: Number(task.sort_order),
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        })),
        lastEvent: lastEvent ? {
          eventType: lastEvent.event_type,
          summary: lastEvent.summary,
          createdAt: lastEvent.created_at,
        } : null,
      };
    }),
    recentActivity: events.slice(0, 8).map((event) => ({
      id: event.id,
      workOrderId: event.work_order_id,
      eventType: event.event_type,
      summary: event.summary,
      createdAt: event.created_at,
    })),
    sourceOptions: await sourceOptions(identity),
    access: {
      fullAccess: identity.fullAccess,
      teamAccess: identity.teamAccess,
      activeCount,
      activeLimit: identity.fullAccess ? MEMBER_ACTIVE_LIMIT : FREE_ACTIVE_LIMIT,
      taskLimit: identity.fullAccess ? MEMBER_TASK_LIMIT : FREE_TASK_LIMIT,
    },
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    return adminJson({ ok: true, ...(await workOrderPayload(identity)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid Business Hub request." }, 400); }
    const action = cleanAdminText(body.action, 40) || "create_work_order";
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "add_task") {
      const workOrderId = cleanAdminText(body.workOrderId, 180);
      const title = cleanAdminText(body.title, 180);
      const dueAt = dateValue(body.dueAt);
      if (!workOrderId || !title) return adminJson({ ok: false, error: "Add a checklist item." }, 400);
      if (privateDataDetected(title)) throw new Error("PRIVATE_DATA");
      const order = await db.prepare("SELECT id FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND record_status = 'active'")
        .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
      if (!order) throw new Error("WORK_NOT_FOUND");
      const count = await db.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ?")
        .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
      const taskLimit = identity.fullAccess ? MEMBER_TASK_LIMIT : FREE_TASK_LIMIT;
      if (Number(count?.count || 0) >= taskLimit) throw new Error("TASK_LIMIT_REACHED");
      const taskId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO trade_work_order_tasks
          (id, work_order_id, firebase_uid, title, due_at, status, completed_at, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?, ?)`)
          .bind(taskId, workOrderId, identity.uid, title, dueAt, Number(count?.count || 0), now, now),
        db.prepare("UPDATE trade_work_orders SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, workOrderId, identity.uid),
        eventStatement(db, identity.uid, workOrderId, "task_added", `Checklist item added: ${title}`, now),
      ]);
      return adminJson({ ok: true, ...(await workOrderPayload(identity)) });
    }

    if (action !== "create_work_order") return adminJson({ ok: false, error: "Unsupported Business Hub action." }, 400);
    const current = await db.prepare(`SELECT COUNT(*) count FROM trade_work_orders
      WHERE firebase_uid = ? AND record_status = 'active' AND stage NOT IN ('completed', 'cancelled')`)
      .bind(identity.uid).first<Record<string, unknown>>();
    const activeCount = Number(current?.count || 0);
    if (!identity.fullAccess && activeCount >= FREE_ACTIVE_LIMIT) throw new Error("FREE_LIMIT_REACHED");
    if (identity.fullAccess && activeCount >= MEMBER_ACTIVE_LIMIT) throw new Error("MEMBER_LIMIT_REACHED");

    const requestedSourceType = cleanAdminText(body.sourceType, 40) || "internal";
    const sourceType = SOURCE_TYPES.has(requestedSourceType) ? requestedSourceType : "internal";
    const sourceReference = cleanAdminText(body.sourceReference, 180);
    if (sourceType !== "internal" && !identity.fullAccess) throw new Error("FULL_ACCESS_REQUIRED");
    let title = cleanAdminText(body.title, 160);
    let serviceCategory = cleanAdminText(body.serviceCategory, 60);
    let siteArea = cleanAdminText(body.siteArea, 80);
    if (!SERVICE_CATEGORIES.has(serviceCategory)) serviceCategory = "other";
    if (privateDataDetected(`${title} ${siteArea}`)) throw new Error("PRIVATE_DATA");

    if (sourceType === "opportunity") {
      if (identity.partnerType !== "installer" || !sourceReference) throw new Error("SOURCE_NOT_FOUND");
      const source = await db.prepare(`SELECT o.title, o.state, o.service_categories
        FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
        WHERE m.id = ? AND m.firebase_uid = ? AND m.status IN ('interested', 'connected')`)
        .bind(sourceReference, identity.uid).first<Record<string, unknown>>();
      if (!source) throw new Error("SOURCE_NOT_FOUND");
      let categories: string[] = [];
      try { categories = JSON.parse(String(source.service_categories || "[]")); } catch { categories = []; }
      title = cleanAdminText(source.title, 160);
      serviceCategory = categories.find((item) => SERVICE_CATEGORIES.has(item)) || "other";
      siteArea = cleanAdminText(source.state, 80);
    } else if (sourceType === "product_enquiry") {
      if (identity.partnerType !== "supplier" || !sourceReference) throw new Error("SOURCE_NOT_FOUND");
      const source = await db.prepare(`SELECT l.name FROM supplier_product_enquiries e
        JOIN installer_product_lists l ON l.id = e.list_id
        WHERE e.id = ? AND e.supplier_uid = ? AND e.status IN ('new', 'viewed', 'responded')`)
        .bind(sourceReference, identity.uid).first<Record<string, unknown>>();
      if (!source) throw new Error("SOURCE_NOT_FOUND");
      title = `Product request: ${cleanAdminText(source.name, 130) || "equipment list"}`;
      serviceCategory = "product-fulfilment";
      siteArea = "";
    }
    if (privateDataDetected(`${title} ${siteArea}`)) throw new Error("PRIVATE_DATA");
    if (!title) return adminJson({ ok: false, error: "Add a short work title without customer details." }, 400);
    if (sourceType !== "internal") {
      const used = await db.prepare(`SELECT id FROM trade_work_orders
        WHERE firebase_uid = ? AND source_type = ? AND source_reference = ? LIMIT 1`)
        .bind(identity.uid, sourceType, sourceReference).first<Record<string, unknown>>();
      if (used) throw new Error("SOURCE_ALREADY_USED");
    }
    const priority = PRIORITIES.has(cleanAdminText(body.priority, 20)) ? cleanAdminText(body.priority, 20) : "standard";
    const scheduledStart = dateValue(body.scheduledStart);
    const scheduledEnd = dateValue(body.scheduledEnd);
    if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) {
      return adminJson({ ok: false, error: "The planned finish cannot be before the planned start." }, 400);
    }
    const requestedAssignee = cleanAdminText(body.assigneeLabel, 80);
    if (requestedAssignee && !identity.teamAccess) throw new Error("TEAM_ACCESS_REQUIRED");
    if (privateDataDetected(requestedAssignee)) throw new Error("PRIVATE_DATA");
    const workOrderId = crypto.randomUUID();
    const dateCode = now.slice(2, 7).replace("-", "");
    const randomCode = workOrderId.replaceAll("-", "").slice(0, 5).toUpperCase();
    const workNumber = `${identity.partnerType === "supplier" ? "FUL" : "JOB"}-${dateCode}-${randomCode}`;
    const workType = identity.partnerType === "supplier" ? "fulfilment" : "job";
    await db.batch([
      db.prepare(`INSERT INTO trade_work_orders
        (id, firebase_uid, partner_type, work_type, source_type, source_reference, work_number, title,
         service_category, site_area, stage, priority, scheduled_start, scheduled_end, assignee_label,
         record_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(workOrderId, identity.uid, identity.partnerType, workType, sourceType, sourceReference,
          workNumber, title, serviceCategory, siteArea, priority, scheduledStart, scheduledEnd,
          requestedAssignee, now, now),
      eventStatement(db, identity.uid, workOrderId, "work_created", `${workNumber} created in Business Hub.`, now),
    ]);
    return adminJson({ ok: true, ...(await workOrderPayload(identity)) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await tradeIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid Business Hub update." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "update_task") {
      const taskId = cleanAdminText(body.taskId, 180);
      const status = cleanAdminText(body.status, 20);
      if (!taskId || !["pending", "done"].includes(status)) return adminJson({ ok: false, error: "Choose a valid checklist status." }, 400);
      const task = await db.prepare(`SELECT t.work_order_id, t.title FROM trade_work_order_tasks t
        JOIN trade_work_orders w ON w.id = t.work_order_id
        WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(taskId, identity.uid, identity.uid).first<Record<string, unknown>>();
      if (!task) throw new Error("WORK_NOT_FOUND");
      await db.batch([
        db.prepare("UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(status, status === "done" ? now : "", now, taskId, identity.uid),
        db.prepare("UPDATE trade_work_orders SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, task.work_order_id, identity.uid),
        eventStatement(db, identity.uid, String(task.work_order_id), status === "done" ? "task_completed" : "task_reopened", `${status === "done" ? "Completed" : "Reopened"}: ${String(task.title)}`, now),
      ]);
      return adminJson({ ok: true, ...(await workOrderPayload(identity)) });
    }

    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const current = await db.prepare(`SELECT id, stage, priority, scheduled_start, scheduled_end, assignee_label
      FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
      .bind(workOrderId, identity.uid).first<Record<string, unknown>>();
    if (!current) throw new Error("WORK_NOT_FOUND");

    if (action === "archive_work_order") {
      if (!["completed", "cancelled"].includes(String(current.stage))) {
        return adminJson({ ok: false, error: "Complete or cancel the work record before archiving it." }, 409);
      }
      await db.batch([
        db.prepare("UPDATE trade_work_orders SET record_status = 'archived', updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(now, workOrderId, identity.uid),
        eventStatement(db, identity.uid, workOrderId, "work_archived", "Work record archived.", now),
      ]);
      return adminJson({ ok: true, ...(await workOrderPayload(identity)) });
    }
    if (action !== "update_work_order") return adminJson({ ok: false, error: "Unsupported Business Hub update." }, 400);

    const requestedStage = body.stage === undefined ? String(current.stage) : cleanAdminText(body.stage, 30);
    const requestedPriority = body.priority === undefined ? String(current.priority) : cleanAdminText(body.priority, 20);
    if (!STAGES.has(requestedStage) || !PRIORITIES.has(requestedPriority)) {
      return adminJson({ ok: false, error: "Choose a valid work stage and priority." }, 400);
    }
    const scheduledStart = body.scheduledStart === undefined ? String(current.scheduled_start) : dateValue(body.scheduledStart);
    const scheduledEnd = body.scheduledEnd === undefined ? String(current.scheduled_end) : dateValue(body.scheduledEnd);
    if (scheduledStart && scheduledEnd && scheduledEnd < scheduledStart) {
      return adminJson({ ok: false, error: "The planned finish cannot be before the planned start." }, 400);
    }
    const assigneeLabel = body.assigneeLabel === undefined ? String(current.assignee_label) : cleanAdminText(body.assigneeLabel, 80);
    if (assigneeLabel && !identity.teamAccess) throw new Error("TEAM_ACCESS_REQUIRED");
    if (privateDataDetected(assigneeLabel)) throw new Error("PRIVATE_DATA");
    const changes: string[] = [];
    if (requestedStage !== current.stage) changes.push(`Stage changed to ${requestedStage.replaceAll("_", " ")}.`);
    if (requestedPriority !== current.priority) changes.push(`Priority changed to ${requestedPriority}.`);
    if (scheduledStart !== current.scheduled_start || scheduledEnd !== current.scheduled_end) changes.push("Schedule updated.");
    if (assigneeLabel !== current.assignee_label) changes.push(assigneeLabel ? `Assigned to ${assigneeLabel}.` : "Crew assignment cleared.");
    await db.batch([
      db.prepare(`UPDATE trade_work_orders SET stage = ?, priority = ?, scheduled_start = ?, scheduled_end = ?,
        assignee_label = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(requestedStage, requestedPriority, scheduledStart, scheduledEnd, assigneeLabel, now, workOrderId, identity.uid),
      eventStatement(db, identity.uid, workOrderId, "work_updated", changes.join(" ") || "Work record reviewed.", now),
    ]);
    return adminJson({ ok: true, ...(await workOrderPayload(identity)) });
  } catch (error) {
    return errorResponse(error);
  }
}
