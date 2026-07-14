import { getD1 } from "../../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";
const MATCH_STATUSES = new Set(["offered", "viewed", "interested", "declined", "closed"]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid match." }, 400); }
    const opportunityId = cleanAdminText(body.opportunityId, 180);
    const firebaseUid = cleanAdminText(body.firebaseUid, 180);
    const adminNote = cleanAdminText(body.adminNote, 800);
    if (!opportunityId || !firebaseUid) return adminJson({ ok: false, error: "Choose an opportunity and business." }, 400);
    const db = getD1();
    const [opportunity, account] = await Promise.all([
      db.prepare("SELECT id, title, status FROM trade_opportunities WHERE id = ?").bind(opportunityId).first<Record<string, unknown>>(),
      db.prepare("SELECT firebase_uid, business_name, account_status FROM trade_accounts WHERE firebase_uid = ?").bind(firebaseUid).first<Record<string, unknown>>(),
    ]);
    if (!opportunity || !account) return adminJson({ ok: false, error: "The opportunity or business could not be found." }, 404);
    if (opportunity.status !== "open") return adminJson({ ok: false, error: "Only open opportunities can be assigned." }, 409);
    if (account.account_status !== "active") return adminJson({ ok: false, error: "Only active business accounts can receive opportunities." }, 409);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO trade_opportunity_matches
      (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_by_uid, matched_at, updated_at)
      VALUES (?, ?, ?, 'offered', ?, '', ?, ?, ?)
      ON CONFLICT(opportunity_id, firebase_uid) DO UPDATE SET admin_note = excluded.admin_note, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), opportunityId, firebaseUid, adminNote, admin.uid, now, now).run();
    await writeAdminAudit(admin, "opportunity.assign", "trade_opportunity", opportunityId, `Assigned opportunity to ${account.business_name}.`, { firebaseUid });
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid match update." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const status = cleanAdminText(body.status, 30);
    const adminNote = cleanAdminText(body.adminNote, 800);
    if (!id || !MATCH_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid assignment status." }, 400);
    const result = await getD1().prepare("UPDATE trade_opportunity_matches SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?")
      .bind(status, adminNote, new Date().toISOString(), id).run();
    if (!result.meta.changes) return adminJson({ ok: false, error: "Assignment not found." }, 404);
    await writeAdminAudit(admin, "opportunity.assignment_status", "trade_opportunity_match", id, `Changed assignment status to ${status}.`);
    return adminJson({ ok: true });
  } catch (error) { return adminError(error); }
}
