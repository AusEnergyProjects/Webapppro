import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  cleanAdminText,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";
import { rewardReferral } from "@/lib/stripe-referral-server";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const rows = await getD1().prepare(`
      SELECT r.id, r.referral_code, r.status, r.risk_reason, r.registered_at,
             r.first_paid_at, r.rewarded_at, r.updated_at,
             referrer.business_name referrer_business, referrer.email referrer_email,
             referred.business_name referred_business, referred.email referred_email,
             SUM(CASE WHEN c.status = 'applied' THEN 1 ELSE 0 END) applied_credits,
             SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) failed_credits
      FROM trade_referrals r
      JOIN trade_accounts referrer ON referrer.firebase_uid = r.referrer_uid
      JOIN trade_accounts referred ON referred.firebase_uid = r.referred_uid
      LEFT JOIN trade_membership_credits c ON c.referral_id = r.id
      GROUP BY r.id
      ORDER BY r.updated_at DESC LIMIT 250
    `).all<Record<string, unknown>>();
    return adminJson({ ok: true, referrals: rows.results.map((row) => ({
      id: row.id,
      code: row.referral_code,
      status: row.status,
      riskReason: row.risk_reason,
      referrerBusiness: row.referrer_business,
      referrerEmail: row.referrer_email,
      referredBusiness: row.referred_business,
      referredEmail: row.referred_email,
      registeredAt: row.registered_at,
      firstPaidAt: row.first_paid_at,
      rewardedAt: row.rewarded_at,
      appliedCredits: Number(row.applied_credits || 0),
      failedCredits: Number(row.failed_credits || 0),
      updatedAt: row.updated_at,
    })) });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid referral decision." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const action = cleanAdminText(body.action, 30);
    const note = cleanAdminText(body.note, 500);
    if (!id || !["approve", "reject", "retry"].includes(action))
      return adminJson({ ok: false, error: "Choose a valid referral decision." }, 400);
    const db = getD1();
    const current = await db.prepare(`
      SELECT status, first_paid_at, risk_reason FROM trade_referrals WHERE id = ?
    `).bind(id).first<{ status: string; first_paid_at: string; risk_reason: string }>();
    if (!current) return adminJson({ ok: false, error: "Referral not found." }, 404);
    const now = new Date().toISOString();
    if (action === "reject") {
      await db.prepare(`
        UPDATE trade_referrals SET status = 'rejected', risk_reason = ?, reviewed_by_uid = ?,
          reviewed_at = ?, updated_at = ? WHERE id = ?
      `).bind(note || "Rejected after eligibility review.", admin.uid, now, now, id).run();
    } else {
      const nextStatus = current.first_paid_at ? "qualified" : "registered";
      await db.prepare(`
        UPDATE trade_referrals SET status = ?, risk_reason = '', reviewed_by_uid = ?,
          reviewed_at = ?, updated_at = ? WHERE id = ?
      `).bind(nextStatus, admin.uid, now, now, id).run();
      if (current.first_paid_at) await rewardReferral(id);
    }
    await writeAdminAudit(
      admin,
      `referral.${action}`,
      "trade_referral",
      id,
      `${action === "approve" ? "Approved" : action === "retry" ? "Retried" : "Rejected"} a referral reward.`,
      { before: current, note },
    );
    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error);
  }
}
