import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminError, adminJson, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { expireStaleOpportunities } from "@/lib/opportunity-server";

export const runtime = "edge";

function timingSafeMatch(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    const db = getD1();
    await expireStaleOpportunities();
    const [accounts, opportunities, matches, verification, products, audit] = await Promise.all([
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN account_status = 'active' THEN 1 ELSE 0 END) active,
        SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END) suspended,
        SUM(CASE WHEN partner_type = 'installer' THEN 1 ELSE 0 END) installers,
        SUM(CASE WHEN partner_type = 'supplier' THEN 1 ELSE 0 END) suppliers
        FROM trade_accounts`).first<Record<string, number>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) open,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) draft
        FROM trade_opportunities`).first<Record<string, number>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status = 'offered' THEN 1 ELSE 0 END) offered,
        SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) interested,
        SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) connected
        FROM trade_opportunity_matches`).first<Record<string, number>>(),
      db.prepare(`SELECT
        SUM(CASE WHEN verification_status IN ('submitted', 'under_review') THEN 1 ELSE 0 END) awaiting,
        SUM(CASE WHEN verification_status = 'approved' THEN 1 ELSE 0 END) approved
        FROM trade_accounts`).first<Record<string, number>>(),
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN listing_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) live
        FROM supplier_products`).first<Record<string, number>>(),
      db.prepare(`SELECT l.id, l.action, l.entity_type, l.entity_id, l.summary, l.created_at,
        COALESCE(a.display_name, a.email, 'Former administrator') administrator
        FROM admin_audit_log l LEFT JOIN admin_users a ON a.firebase_uid = l.admin_uid
        ORDER BY l.created_at DESC LIMIT 25`).all<Record<string, unknown>>(),
    ]);
    return adminJson({
      ok: true,
      admin: { email: admin.email, displayName: admin.displayName, role: admin.role },
      metrics: { accounts, opportunities, matches, verification, products },
      audit: audit.results,
    });
  } catch (error) {
    try {
      await requireFirebaseIdentity(request);
      const count = await getD1().prepare("SELECT COUNT(*) count FROM admin_users").first<{ count: number }>();
      if (!count?.count) return adminJson({ ok: false, canBootstrap: true, error: "Use the one-time owner setup code to create the first operations account." }, 403);
    } catch { /* use standard response */ }
    return adminError(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let identity;
  try {
    identity = await requireFirebaseIdentity(request);
  } catch (error) {
    return adminError(error);
  }
  if (!identity.emailVerified) return adminJson({ ok: false, error: "Verify the account email before creating the owner account." }, 403);

  let code = "";
  try {
    const body = await request.json() as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return adminJson({ ok: false, error: "Enter the one-time owner setup code." }, 400);
  }

  const configured = String((env as unknown as Record<string, unknown>).AEA_ADMIN_BOOTSTRAP_TOKEN || "");
  if (!configured) return adminJson({ ok: false, error: "Owner setup has not been enabled for this deployment." }, 503);
  if (!timingSafeMatch(code, configured)) return adminJson({ ok: false, error: "The one-time owner setup code is not valid." }, 403);

  const db = getD1();
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO admin_users (id, firebase_uid, email, display_name, role, status, invited_by_uid, last_login_at, created_at, updated_at)
    SELECT ?, ?, ?, '', 'owner', 'active', '', ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM admin_users)
  `).bind(crypto.randomUUID(), identity.uid, identity.email, now, now, now).run();
  if (!result.meta.changes) return adminJson({ ok: false, error: "The owner account has already been created. Ask an owner for an invitation." }, 409);

  await writeAdminAudit(identity, "admin.bootstrap", "admin_user", identity.uid, `Created the first owner account for ${identity.email}.`);
  return adminJson({ ok: true, admin: { email: identity.email, displayName: "", role: "owner" } });
}
