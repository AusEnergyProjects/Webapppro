import { getD1 } from "../../../../../db";
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_PRIORITIES,
  backfillActionableAdminNotifications,
} from "@/lib/admin-notifications";
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

function shape(row: Record<string, unknown>) {
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
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    await backfillActionableAdminNotifications();
    const url = new URL(request.url);
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const category = cleanAdminText(url.searchParams.get("category"), 30);
    const priority = cleanAdminText(url.searchParams.get("priority"), 30);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const requiresAction = url.searchParams.get("requiresAction");
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
      clauses.push("(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(event_type) LIKE ?)");
      const term = `%${search}%`;
      bindings.push(term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = getD1();
    const statement = db.prepare(`SELECT * FROM admin_notifications ${where}
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        CASE status WHEN 'open' THEN 0 WHEN 'read' THEN 1 ELSE 2 END, created_at DESC LIMIT 250`);
    const [rows, counts] = await Promise.all([
      bindings.length
        ? statement.bind(...bindings).all<Record<string, unknown>>()
        : statement.all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) unread,
        SUM(CASE WHEN requires_action = 1 AND status != 'resolved' THEN 1 ELSE 0 END) action_required,
        SUM(CASE WHEN priority = 'urgent' AND status != 'resolved' THEN 1 ELSE 0 END) urgent,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) resolved
        FROM admin_notifications WHERE event_type != 'platform.backfill_marker'`).first<Record<string, number>>(),
    ]);
    return adminJson({ ok: true, notifications: rows.results.map(shape), counts: counts || {} });
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
      await db.prepare("UPDATE admin_notifications SET status = 'read', read_at = ?, read_by_uid = ?, updated_at = ? WHERE status = 'open'")
        .bind(now, admin.uid, now).run();
      return adminJson({ ok: true });
    }
    if (!id) return adminJson({ ok: false, error: "Choose a notification." }, 400);
    const current = await db.prepare("SELECT id, title, status, requires_action FROM admin_notifications WHERE id = ?")
      .bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Notification not found." }, 404);

    if (action === "mark_read") {
      await db.prepare(`UPDATE admin_notifications SET status = CASE WHEN status = 'open' THEN 'read' ELSE status END,
        read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
        read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END, updated_at = ? WHERE id = ?`)
        .bind(now, admin.uid, now, id).run();
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
      await writeAdminAudit(admin, "notification.resolve", "admin_notification", id, `Resolved notification: ${String(current.title).slice(0, 180)}.`, { note });
      return adminJson({ ok: true });
    }
    if (action === "reopen") {
      if (!["owner", "admin"].includes(admin.role)) {
        return adminJson({ ok: false, error: "Only owners and administrators can reopen notifications." }, 403);
      }
      await db.prepare("UPDATE admin_notifications SET status = 'open', resolved_at = '', resolved_by_uid = '', resolution_note = '', updated_at = ? WHERE id = ?")
        .bind(now, id).run();
      await writeAdminAudit(admin, "notification.reopen", "admin_notification", id, `Reopened notification: ${String(current.title).slice(0, 180)}.`);
      return adminJson({ ok: true });
    }
    return adminJson({ ok: false, error: "Choose a valid notification action." }, 400);
  } catch (error) {
    return adminError(error);
  }
}
