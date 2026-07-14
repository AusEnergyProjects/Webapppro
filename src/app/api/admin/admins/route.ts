import { getD1 } from "../../../../../db";
import { ADMIN_ROLES, adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit, type AdminRole } from "@/lib/admin-server";

export const runtime = "edge";
const STATUSES = new Set(["active", "suspended"]);

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner"]);
    const rows = await getD1().prepare(`SELECT id, email, display_name, role, status, invited_by_uid, last_login_at, created_at, updated_at,
      CASE WHEN firebase_uid LIKE 'pending:%' THEN 1 ELSE 0 END pending
      FROM admin_users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, created_at`).all<Record<string, unknown>>();
    return adminJson({ ok: true, admins: rows.results });
  } catch (error) { return adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid administrator invitation." }, 400); }
    const email = cleanAdminText(body.email, 254).toLowerCase();
    const displayName = cleanAdminText(body.displayName, 120);
    const role = cleanAdminText(body.role, 30) as AdminRole;
    if (!/^\S+@\S+\.\S+$/.test(email) || !ADMIN_ROLES.includes(role)) return adminJson({ ok: false, error: "Enter a valid email and operations role." }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await getD1().prepare(`INSERT INTO admin_users
        (id, firebase_uid, email, display_name, role, status, invited_by_uid, last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, '', ?, ?)`)
        .bind(id, `pending:${id}`, email, displayName, role, admin.uid, now, now).run();
    } catch {
      return adminJson({ ok: false, error: "That email already has an operations account or invitation." }, 409);
    }
    await writeAdminAudit(admin, "admin.invite", "admin_user", id, `Invited ${email} as ${role}.`);
    return adminJson({ ok: true }, 201);
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid administrator update." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const role = cleanAdminText(body.role, 30) as AdminRole;
    const status = cleanAdminText(body.status, 30);
    if (!id || !ADMIN_ROLES.includes(role) || !STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid administrator role and status." }, 400);
    const db = getD1();
    const target = await db.prepare("SELECT id, firebase_uid, email, role, status FROM admin_users WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!target) return adminJson({ ok: false, error: "Operations account not found." }, 404);
    if (target.firebase_uid === admin.uid && (status !== "active" || role !== "owner")) return adminJson({ ok: false, error: "You cannot suspend or demote your own owner account." }, 409);
    if (target.role === "owner" && (role !== "owner" || status !== "active")) {
      const owners = await db.prepare("SELECT COUNT(*) count FROM admin_users WHERE role = 'owner' AND status = 'active'").first<{ count: number }>();
      if ((owners?.count || 0) <= 1) return adminJson({ ok: false, error: "At least one active owner account is required." }, 409);
    }
    const now = new Date().toISOString();
    await db.prepare("UPDATE admin_users SET role = ?, status = ?, updated_at = ? WHERE id = ?").bind(role, status, now, id).run();
    await writeAdminAudit(admin, "admin.update", "admin_user", id, `Updated ${target.email} to ${role}, ${status}.`, { before: { role: target.role, status: target.status } });
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}

