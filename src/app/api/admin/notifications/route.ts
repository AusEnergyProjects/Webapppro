import { getD1 } from "../../../../../db";
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_PRIORITIES,
  adminNotificationDueAt,
  backfillActionableAdminNotifications,
  createAdminNotification,
} from "@/lib/admin-notifications";
import {
  adminNotificationDeliveryConfiguration,
  dispatchAdminNotificationDeliveries,
} from "@/lib/admin-notification-delivery";
import {
  adminError,
  adminJson,
  cleanAdminText,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";

export const runtime = "edge";

const STATUSES = new Set(["open", "read", "resolved"]);
const CATEGORIES = new Set<string>(ADMIN_NOTIFICATION_CATEGORIES);
const PRIORITIES = new Set<string>(ADMIN_NOTIFICATION_PRIORITIES);

function parseMetadata(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

type ActivityItem = {
  id: string;
  action: string;
  summary: string;
  administrator: string;
  createdAt: string;
};

function shape(row: Record<string, unknown>, assignees: Map<string, string>, activity: Map<string, ActivityItem[]>) {
  const dueAt = String(row.due_at || "");
  const unresolved = row.status !== "resolved";
  const dueTime = Date.parse(dueAt);
  const now = Date.now();
  return {
    id: row.id,
    eventType: row.event_type,
    category: row.category,
    priority: row.priority,
    title: row.title,
    summary: row.summary,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    actorUid: row.actor_uid,
    requiresAction: Boolean(row.requires_action),
    status: row.status,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    deliveryStatus: row.delivery_status || "not_queued",
    deliveryAttempts: Number(row.delivery_attempts || 0),
    deliveryLastAttemptAt: row.delivery_last_attempt_at || "",
    deliveryDeliveredAt: row.delivery_delivered_at || "",
    deliveryLastError: row.delivery_last_error || "",
    assignedToUid: row.assigned_to_uid,
    assignedToName: assignees.get(String(row.assigned_to_uid || "")) || "",
    assignedAt: row.assigned_at,
    dueAt,
    slaState: unresolved && Number.isFinite(dueTime)
      ? dueTime <= now ? "overdue" : dueTime <= now + 4 * 60 * 60 * 1000 ? "due_soon" : "on_track"
      : "none",
    activity: activity.get(String(row.id)) || [],
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    await backfillActionableAdminNotifications();
    await dispatchAdminNotificationDeliveries();
    const url = new URL(request.url);
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const category = cleanAdminText(url.searchParams.get("category"), 30);
    const priority = cleanAdminText(url.searchParams.get("priority"), 30);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const requiresAction = url.searchParams.get("requiresAction");
    const queue = cleanAdminText(url.searchParams.get("queue"), 30);
    const assignedTo = cleanAdminText(url.searchParams.get("assignedTo"), 180);
    const clauses: string[] = ["event_type != 'platform.backfill_marker'"];
    const bindings: Array<string | number> = [];
    if (STATUSES.has(status)) { clauses.push("status = ?"); bindings.push(status); }
    if (CATEGORIES.has(category)) { clauses.push("category = ?"); bindings.push(category); }
    if (PRIORITIES.has(priority)) { clauses.push("priority = ?"); bindings.push(priority); }
    if (requiresAction === "true" || requiresAction === "false") {
      clauses.push("requires_action = ?");
      bindings.push(requiresAction === "true" ? 1 : 0);
    }
    if (search) {
      clauses.push("(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(event_type) LIKE ? OR LOWER(entity_id) LIKE ?)");
      const term = `%${search}%`;
      bindings.push(term, term, term, term);
    }
    const now = new Date().toISOString();
    const soon = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    if (queue === "mine") { clauses.push("assigned_to_uid = ? AND status != 'resolved'"); bindings.push(admin.uid); }
    if (queue === "unassigned") clauses.push("assigned_to_uid = '' AND requires_action = 1 AND status != 'resolved'");
    if (queue === "overdue") { clauses.push("due_at != '' AND due_at <= ? AND status != 'resolved'"); bindings.push(now); }
    if (queue === "due_soon") { clauses.push("due_at > ? AND due_at <= ? AND status != 'resolved'"); bindings.push(now, soon); }
    if (assignedTo === "unassigned") clauses.push("assigned_to_uid = ''");
    else if (assignedTo) { clauses.push("assigned_to_uid = ?"); bindings.push(assignedTo); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = getD1();
    const statement = db.prepare(`SELECT n.*,
      COALESCE((SELECT d.status FROM admin_notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'webhook' LIMIT 1), 'not_queued') delivery_status,
      COALESCE((SELECT d.attempts FROM admin_notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'webhook' LIMIT 1), 0) delivery_attempts,
      COALESCE((SELECT d.last_attempt_at FROM admin_notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'webhook' LIMIT 1), '') delivery_last_attempt_at,
      COALESCE((SELECT d.delivered_at FROM admin_notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'webhook' LIMIT 1), '') delivery_delivered_at,
      COALESCE((SELECT d.last_error FROM admin_notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'webhook' LIMIT 1), '') delivery_last_error
      FROM admin_notifications n ${where}
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        CASE status WHEN 'open' THEN 0 WHEN 'read' THEN 1 ELSE 2 END, created_at DESC LIMIT 250`);
    const [rows, counts, adminRows, auditRows, deliveryCounts] = await Promise.all([
      bindings.length
        ? statement.bind(...bindings).all<Record<string, unknown>>()
        : statement.all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) unread,
        SUM(CASE WHEN requires_action = 1 AND status != 'resolved' THEN 1 ELSE 0 END) action_required,
        SUM(CASE WHEN priority = 'urgent' AND status != 'resolved' THEN 1 ELSE 0 END) urgent,
        SUM(CASE WHEN requires_action = 1 AND status != 'resolved' AND assigned_to_uid = '' THEN 1 ELSE 0 END) unassigned,
        SUM(CASE WHEN status != 'resolved' AND due_at != '' AND due_at <= ? THEN 1 ELSE 0 END) overdue,
        SUM(CASE WHEN status != 'resolved' AND due_at > ? AND due_at <= ? THEN 1 ELSE 0 END) due_soon,
        SUM(CASE WHEN status != 'resolved' AND assigned_to_uid = ? THEN 1 ELSE 0 END) mine,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) resolved
        FROM admin_notifications WHERE event_type != 'platform.backfill_marker'`)
        .bind(now, now, soon, admin.uid).first<Record<string, number>>(),
      db.prepare(`SELECT firebase_uid, email, display_name, role
        FROM admin_users WHERE status = 'active' AND firebase_uid NOT LIKE 'pending:%'
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, display_name, email`)
        .all<Record<string, unknown>>(),
      db.prepare(`SELECT l.id, l.action, l.entity_id, l.summary, l.created_at,
        COALESCE(a.display_name, a.email, 'Former administrator') administrator
        FROM admin_audit_log l LEFT JOIN admin_users a ON a.firebase_uid = l.admin_uid
        WHERE l.entity_type = 'admin_notification' ORDER BY l.created_at DESC LIMIT 500`)
        .all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) delivered,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status = 'waiting_for_channel' THEN 1 ELSE 0 END) waiting_for_channel,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) skipped
        FROM admin_notification_deliveries`).first<Record<string, number>>(),
    ]);
    const assigneeNames = new Map<string, string>(adminRows.results.map((row: Record<string, unknown>) => [
      String(row.firebase_uid),
      String(row.display_name || row.email),
    ] as [string, string]));
    const activity = new Map<string, ActivityItem[]>();
    auditRows.results.forEach((row: Record<string, unknown>) => {
      const entityId = String(row.entity_id);
      const items = activity.get(entityId) || [];
      items.push({
        id: String(row.id),
        action: String(row.action),
        summary: String(row.summary),
        administrator: String(row.administrator),
        createdAt: String(row.created_at),
      });
      activity.set(entityId, items);
    });
    return adminJson({
      ok: true,
      notifications: rows.results.map((row: Record<string, unknown>) => shape(row, assigneeNames, activity)),
      counts: counts || {},
      currentAdminUid: admin.uid,
      assignees: adminRows.results.map((row: Record<string, unknown>) => ({
        uid: row.firebase_uid,
        name: row.display_name || row.email,
        email: row.email,
        role: row.role,
      })),
      delivery: {
        ...adminNotificationDeliveryConfiguration(),
        counts: deliveryCounts || {},
      },
    });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid notification update." }, 400); }
    const action = cleanAdminText(body.action, 30);
    const id = cleanAdminText(body.id, 180);
    const note = cleanAdminText(body.note, 800);
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "mark_all_read") {
      await db.prepare("UPDATE admin_notifications SET status = 'read', read_at = ?, read_by_uid = ?, updated_at = ? WHERE status = 'open' AND event_type != 'platform.backfill_marker'")
        .bind(now, admin.uid, now).run();
      return adminJson({ ok: true });
    }
    if (action === "send_test") {
      if (!["owner", "admin"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Only owners and administrators can test off-screen delivery." }, 403);
      }
      if (!adminNotificationDeliveryConfiguration().configured) {
        return adminJson({ ok: false, error: "Connect a private off-screen alert destination before sending a test." }, 503);
      }
      await createAdminNotification({
        eventKey: `platform:admin-alert-test:${crypto.randomUUID()}`,
        eventType: "platform.admin_alert_test",
        category: "platform",
        priority: "high",
        title: "AEA operations alert test",
        summary: "The private off-screen operations alert channel is connected and accepting privacy-safe notifications.",
        entityType: "platform_service",
        entityId: "admin_alert_delivery",
        actorType: "admin",
        actorUid: admin.uid,
        requiresAction: false,
      });
      await writeAdminAudit(admin, "notification.delivery_test", "platform_service", "admin_alert_delivery", "Sent a privacy-safe operations alert test.");
      return adminJson({ ok: true });
    }
    if (!id) return adminJson({ ok: false, error: "Choose a notification." }, 400);
    const current = await db.prepare("SELECT id, title, status, priority, requires_action, assigned_to_uid, due_at FROM admin_notifications WHERE id = ?")
      .bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Notification not found." }, 404);

    if (action === "mark_read") {
      await db.prepare(`UPDATE admin_notifications SET status = CASE WHEN status = 'open' THEN 'read' ELSE status END,
        read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, updated_at = ? WHERE id = ?`)
        .bind(now, admin.uid, now, id).run();
      return adminJson({ ok: true });
    }
    if (action === "retry_delivery") {
      if (!["owner", "admin"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Only owners and administrators can retry off-screen delivery." }, 403);
      }
      if (!adminNotificationDeliveryConfiguration().configured) {
        return adminJson({ ok: false, error: "Connect a private off-screen alert destination before retrying delivery." }, 503);
      }
      const result = await dispatchAdminNotificationDeliveries({ notificationId: id, force: true });
      await writeAdminAudit(admin, "notification.delivery_retry", "admin_notification", id, `Retried off-screen notification delivery.`, result);
      return adminJson({ ok: true, delivery: result });
    }
    if (action === "add_note") {
      if (!note) return adminJson({ ok: false, error: "Enter an internal case note." }, 400);
      await writeAdminAudit(admin, "notification.note", "admin_notification", id, `Internal note: ${note}`, { note });
      await db.prepare("UPDATE admin_notifications SET updated_at = ? WHERE id = ?").bind(now, id).run();
      return adminJson({ ok: true });
    }
    if (action === "assign") {
      const assignedToUid = cleanAdminText(body.assignedToUid, 180);
      const canAssignAnyone = ["owner", "admin"].includes(admin.role);
      if (assignedToUid && !canAssignAnyone && assignedToUid !== admin.uid) {
        return adminJson({ ok: false, error: "Your operations role can only assign a case to yourself." }, 403);
      }
      if (!assignedToUid && !canAssignAnyone && current.assigned_to_uid !== admin.uid) {
        return adminJson({ ok: false, error: "Only the current assignee or an administrator can unassign this case." }, 403);
      }
      let assigneeName = "Unassigned";
      if (assignedToUid) {
        const target = await db.prepare(`SELECT firebase_uid, email, display_name FROM admin_users
          WHERE firebase_uid = ? AND status = 'active' AND firebase_uid NOT LIKE 'pending:%'`)
          .bind(assignedToUid).first<Record<string, unknown>>();
        if (!target) return adminJson({ ok: false, error: "Choose an active operations account." }, 400);
        assigneeName = String(target.display_name || target.email);
      }
      await db.prepare("UPDATE admin_notifications SET assigned_to_uid = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
        .bind(assignedToUid, assignedToUid ? now : "", now, id).run();
      await writeAdminAudit(admin, "notification.assign", "admin_notification", id, `${assignedToUid ? `Assigned case to ${assigneeName}` : "Returned case to the unassigned queue"}.`, { assignedToUid });
      return adminJson({ ok: true });
    }
    if (action === "set_due") {
      if (!["owner", "admin", "reviewer"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Your operations role cannot change case due dates." }, 403);
      }
      const dueAtValue = cleanAdminText(body.dueAt, 60);
      const dueTime = Date.parse(dueAtValue);
      if (!dueAtValue || !Number.isFinite(dueTime) || dueTime < Date.now() - 5 * 60 * 1000 || dueTime > Date.now() + 366 * 24 * 60 * 60 * 1000) {
        return adminJson({ ok: false, error: "Choose a valid future due date within one year." }, 400);
      }
      const dueAt = new Date(dueTime).toISOString();
      await db.prepare("UPDATE admin_notifications SET due_at = ?, updated_at = ? WHERE id = ?").bind(dueAt, now, id).run();
      await writeAdminAudit(admin, "notification.due_date", "admin_notification", id, `Changed case due date to ${dueAt}.`, { before: current.due_at, dueAt });
      return adminJson({ ok: true });
    }
    if (action === "set_priority") {
      if (!["owner", "admin", "reviewer"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Your operations role cannot change case priority." }, 403);
      }
      const priority = cleanAdminText(body.priority, 30);
      if (!PRIORITIES.has(priority)) return adminJson({ ok: false, error: "Choose a valid case priority." }, 400);
      await db.prepare("UPDATE admin_notifications SET priority = ?, updated_at = ? WHERE id = ?").bind(priority, now, id).run();
      if (Boolean(current.requires_action) || ["high", "urgent"].includes(priority)) {
        await db.prepare(`INSERT OR IGNORE INTO admin_notification_deliveries
          (id, notification_id, channel, status, attempts, next_attempt_at, last_attempt_at, delivered_at,
           last_error, response_code, created_at, updated_at)
          VALUES (?, ?, 'webhook', 'pending', 0, '', '', '', '', 0, ?, ?)`)
          .bind(crypto.randomUUID(), id, now, now).run();
        await dispatchAdminNotificationDeliveries({ notificationId: id });
      }
      await writeAdminAudit(admin, "notification.priority", "admin_notification", id, `Changed case priority from ${String(current.priority)} to ${priority}.`, { before: current.priority, priority });
      return adminJson({ ok: true });
    }
    if (action === "resolve") {
      if (!["owner", "admin", "reviewer"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Your operations role cannot resolve notifications." }, 403);
      }
      if (Boolean(current.requires_action) && !note) {
        return adminJson({ ok: false, error: "Record how the action was resolved." }, 400);
      }
      await db.prepare(`UPDATE admin_notifications SET status = 'resolved', read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, resolved_at = ?, resolved_by_uid = ?,
        resolution_note = ?, updated_at = ? WHERE id = ?`)
        .bind(now, admin.uid, now, admin.uid, note, now, id).run();
      await db.prepare(`UPDATE admin_notification_deliveries SET status = CASE WHEN status = 'delivered' THEN status ELSE 'skipped' END,
        last_error = CASE WHEN status = 'delivered' THEN last_error ELSE 'Notification was resolved before off-screen delivery.' END,
        updated_at = ? WHERE notification_id = ?`).bind(now, id).run();
      await writeAdminAudit(admin, "notification.resolve", "admin_notification", id, `Resolved notification: ${String(current.title).slice(0, 180)}.`, { note });
      return adminJson({ ok: true });
    }
    if (action === "reopen") {
      if (!["owner", "admin"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Only owners and administrators can reopen notifications." }, 403);
      }
      const dueAt = adminNotificationDueAt({
        occurredAt: now,
        priority: String(current.priority) as typeof ADMIN_NOTIFICATION_PRIORITIES[number],
        requiresAction: Boolean(current.requires_action),
      });
      await db.prepare("UPDATE admin_notifications SET status = 'open', resolved_at = '', resolved_by_uid = '', resolution_note = '', due_at = ?, updated_at = ? WHERE id = ?")
        .bind(dueAt, now, id).run();
      await db.prepare(`UPDATE admin_notification_deliveries SET status = 'pending', attempts = 0, next_attempt_at = '',
        last_attempt_at = '', delivered_at = '', last_error = '', response_code = 0, updated_at = ? WHERE notification_id = ?`)
        .bind(now, id).run();
      await dispatchAdminNotificationDeliveries({ notificationId: id });
      await writeAdminAudit(admin, "notification.reopen", "admin_notification", id, `Reopened notification: ${String(current.title).slice(0, 180)}.`);
      return adminJson({ ok: true });
    }
    return adminJson({ ok: false, error: "Choose a valid notification action." }, 400);
  } catch (error) {
    return adminError(error);
  }
}
