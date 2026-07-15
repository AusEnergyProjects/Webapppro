import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  adminError,
  adminJson,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";
import { createAdminNotification } from "@/lib/admin-notifications";

export const runtime = "edge";

const RECENT_AUTH_SECONDS = 15 * 60;

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);

  try {
    const identity = await requireFirebaseIdentity(request);
    if (!identity.emailVerified)
      return adminJson({ ok: false, error: "Verify this email before recovering owner access." }, 403);
    if (identity.signInProvider !== "password")
      return adminJson({
        ok: false,
        error: "Sign in with the recovered email and password before reconnecting owner access.",
      }, 403);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!identity.authTime || nowSeconds - identity.authTime > RECENT_AUTH_SECONDS)
      return adminJson({
        ok: false,
        error: "Sign out, sign in again with the recovered password, then retry within 15 minutes.",
      }, 403);

    const db = getD1();
    const record = await db.prepare(`SELECT id, firebase_uid, email, role, status
      FROM admin_users WHERE lower(trim(email)) = ? LIMIT 1`).bind(identity.email)
      .first<Record<string, unknown>>();
    if (!record || record.role !== "owner" || record.status !== "active")
      return adminJson({ ok: false, error: "This verified email is not an active operations owner." }, 403);
    if (record.firebase_uid === identity.uid)
      return adminJson({ ok: true, recovered: false, message: "Owner access is already connected." });

    const collision = await db.prepare("SELECT id FROM admin_users WHERE firebase_uid = ? LIMIT 1")
      .bind(identity.uid).first<Record<string, unknown>>();
    if (collision)
      return adminJson({ ok: false, error: "This secure identity is already assigned to another operations account." }, 409);

    const now = new Date().toISOString();
    const result = await db.prepare(`UPDATE admin_users
      SET firebase_uid = ?, last_login_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND lower(trim(email)) = ? AND role = 'owner' AND status = 'active'`)
      .bind(identity.uid, now, now, record.id, record.firebase_uid, identity.email).run();
    if (!result.meta.changes)
      return adminJson({ ok: false, error: "Owner recovery changed while it was being completed. Sign in again and retry." }, 409);

    await writeAdminAudit(
      identity,
      "admin.owner_recovery",
      "admin_user",
      String(record.id),
      `Reconnected the verified owner identity for ${identity.email}.`,
      { recentPasswordAuthentication: true, previousIdentityReplaced: true },
    );
    await createAdminNotification({
      eventKey: `admin-owner-recovery:${record.id}:${identity.uid}`,
      eventType: "security.owner_identity_recovered",
      category: "security",
      priority: "high",
      title: "Operations owner identity recovered",
      summary: "A verified owner used recent password authentication to reconnect the operations identity. Review backup owner coverage.",
      entityType: "admin_user",
      entityId: String(record.id),
      actorType: "admin",
      actorUid: identity.uid,
      requiresAction: false,
      occurredAt: now,
    });
    return adminJson({ ok: true, recovered: true });
  } catch (error) {
    return adminError(error);
  }
}
