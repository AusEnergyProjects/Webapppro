import { getD1 } from "../../db";
import { requireFirebaseIdentity, type FirebaseIdentity } from "@/lib/firebase-server";

export const ADMIN_ROLES = ["owner", "admin", "reviewer", "support"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export type AdminIdentity = FirebaseIdentity & {
  adminId: string;
  displayName: string;
  role: AdminRole;
};

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function adminJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function adminError(error: unknown) {
  const code = error instanceof Error ? error.message : "ADMIN_REQUIRED";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "EMAIL_VERIFICATION_REQUIRED") return adminJson({ ok: false, error: "Verify the account email before using operations access." }, 403);
  if (code === "ADMIN_SUSPENDED") return adminJson({ ok: false, error: "This operations account is suspended." }, 403);
  if (code === "ROLE_REQUIRED") return adminJson({ ok: false, error: "Your operations role does not permit this action." }, 403);
  if (code === "ADMIN_REQUIRED") return adminJson({ ok: false, error: "This account does not have operations access." }, 403);
  console.error("Operations API failure", error);
  return adminJson({ ok: false, error: "Operations data could not be loaded. Try again or check the service health." }, 500);
}

export async function requireAdminIdentity(request: Request, allowedRoles: readonly AdminRole[] = ADMIN_ROLES): Promise<AdminIdentity> {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");

  const db = getD1();
  let record = await db.prepare(`
    SELECT id, firebase_uid, email, display_name, role, status, last_login_at
    FROM admin_users
    WHERE firebase_uid = ? OR email = ?
    LIMIT 1
  `).bind(identity.uid, identity.email).first<Record<string, unknown>>();

  if (!record) throw new Error("ADMIN_REQUIRED");
  if (record.status !== "active") throw new Error("ADMIN_SUSPENDED");

  const role = String(record.role) as AdminRole;
  if (!ADMIN_ROLES.includes(role) || !allowedRoles.includes(role)) throw new Error("ROLE_REQUIRED");

  if (record.firebase_uid !== identity.uid) {
    const pendingUid = String(record.firebase_uid || "");
    if (!pendingUid.startsWith("pending:")) throw new Error("ADMIN_REQUIRED");
    await db.prepare(`
      UPDATE admin_users
      SET firebase_uid = ?, last_login_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?
    `).bind(identity.uid, new Date().toISOString(), new Date().toISOString(), record.id, pendingUid).run();
    record = { ...record, firebase_uid: identity.uid };
  } else if (!record.last_login_at || Date.now() - new Date(String(record.last_login_at)).getTime() > 15 * 60 * 1000) {
    const now = new Date().toISOString();
    await db.prepare("UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, record.id).run();
  }

  return {
    ...identity,
    adminId: String(record.id),
    displayName: String(record.display_name || ""),
    role,
  };
}

export function adminAuditStatement(
  db: D1Database,
  admin: Pick<AdminIdentity, "uid">,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  return db.prepare(`
    INSERT INTO admin_audit_log (id, admin_uid, action, entity_type, entity_id, summary, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    admin.uid,
    action.slice(0, 80),
    entityType.slice(0, 60),
    entityId.slice(0, 180),
    summary.slice(0, 500),
    JSON.stringify(metadata).slice(0, 4000),
    new Date().toISOString(),
  );
}

export async function writeAdminAudit(
  admin: Pick<AdminIdentity, "uid">,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  await adminAuditStatement(getD1(), admin, action, entityType, entityId, summary, metadata).run();
}

export function cleanAdminText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function parseJsonList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
