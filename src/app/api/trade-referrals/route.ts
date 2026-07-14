import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  ACTIVE_REFERRAL_BILLING_STATUSES,
  generateReferralCode,
  referralStatusLabel,
} from "@/lib/direct-trade-referrals";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identityOrResponse(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

function shareLink(request: Request, code: string) {
  const link = new URL("/direct-trade/partners", new URL(request.url).origin);
  link.searchParams.set("ref", code);
  return link.toString();
}

async function referralPayload(request: Request, firebaseUid: string) {
  const db = getD1();
  const account = await db.prepare(`
    SELECT business_name, billing_status FROM trade_accounts WHERE firebase_uid = ?
  `).bind(firebaseUid).first<{ business_name: string; billing_status: string }>();
  if (!account) return null;
  const code = await db.prepare(`
    SELECT code, status, created_at FROM trade_referral_codes WHERE firebase_uid = ?
  `).bind(firebaseUid).first<{ code: string; status: string; created_at: string }>();
  const referrals = await db.prepare(`
    SELECT r.id, r.status, r.registered_at, r.first_paid_at, r.rewarded_at,
           r.risk_reason, a.business_name referred_business
    FROM trade_referrals r
    LEFT JOIN trade_accounts a ON a.firebase_uid = r.referred_uid
    WHERE r.referrer_uid = ?
    ORDER BY r.created_at DESC LIMIT 100
  `).bind(firebaseUid).all<Record<string, unknown>>();
  const credits = await db.prepare(`
    SELECT c.id, c.beneficiary_role, c.status, c.extension_start, c.extension_end,
           c.failure_code, c.created_at, r.referral_code
    FROM trade_membership_credits c
    JOIN trade_referrals r ON r.id = c.referral_id
    WHERE c.firebase_uid = ?
    ORDER BY c.created_at DESC LIMIT 100
  `).bind(firebaseUid).all<Record<string, unknown>>();
  const received = await db.prepare(`
    SELECT status, registered_at, first_paid_at, rewarded_at
    FROM trade_referrals WHERE referred_uid = ? LIMIT 1
  `).bind(firebaseUid).first<Record<string, unknown>>();
  const shapedReferrals = referrals.results.map((row) => ({
    id: row.id,
    businessName: row.referred_business || "New business member",
    status: row.status,
    statusLabel: referralStatusLabel(String(row.status || "")),
    registeredAt: row.registered_at,
    firstPaidAt: row.first_paid_at,
    rewardedAt: row.rewarded_at,
    needsReview: row.status === "review_required",
  }));
  const shapedCredits = credits.results.map((row) => ({
    id: row.id,
    role: row.beneficiary_role,
    status: row.status,
    extensionStart: Number(row.extension_start || 0),
    extensionEnd: Number(row.extension_end || 0),
    createdAt: row.created_at,
  }));
  const rewardedReferrals = shapedReferrals.filter((item) => item.status === "rewarded").length;
  const earnedMonths = shapedCredits.filter((item) => item.status === "applied").length;
  return {
    eligible: ACTIVE_REFERRAL_BILLING_STATUSES.has(account.billing_status),
    billingStatus: account.billing_status,
    code: code?.status === "active" ? code.code : "",
    link: code?.status === "active" ? shareLink(request, code.code) : "",
    stats: {
      joined: shapedReferrals.length,
      awaitingPayment: shapedReferrals.filter((item) =>
        ["registered", "review_required"].includes(item.status),
      ).length,
      rewarded: rewardedReferrals,
      earnedMonths,
    },
    referrals: shapedReferrals,
    credits: shapedCredits,
    receivedReferral: received
      ? {
          status: received.status,
          statusLabel: referralStatusLabel(String(received.status || "")),
          registeredAt: received.registered_at,
          firstPaidAt: received.first_paid_at,
          rewardedAt: received.rewarded_at,
        }
      : null,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  const referrals = await referralPayload(request, identity.uid);
  if (!referrals)
    return json({ ok: false, error: "Complete the business profile first." }, 404);
  return json({ ok: true, referrals });
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  const db = getD1();
  const account = await db.prepare(`
    SELECT billing_status FROM trade_accounts WHERE firebase_uid = ?
  `).bind(identity.uid).first<{ billing_status: string }>();
  if (!account)
    return json({ ok: false, error: "Complete the business profile first." }, 404);
  if (!ACTIVE_REFERRAL_BILLING_STATUSES.has(account.billing_status))
    return json({
      ok: false,
      error: "An active paid membership is required before generating a referral link.",
    }, 403);

  const existing = await db.prepare(`
    SELECT code FROM trade_referral_codes WHERE firebase_uid = ? AND status = 'active'
  `).bind(identity.uid).first<{ code: string }>();
  if (!existing) {
    const now = new Date().toISOString();
    let created = false;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const code = generateReferralCode();
      try {
        const result = await db.prepare(`
          INSERT INTO trade_referral_codes (code, firebase_uid, status, created_at, updated_at)
          VALUES (?, ?, 'active', ?, ?)
          ON CONFLICT(firebase_uid) DO NOTHING
        `).bind(code, identity.uid, now, now).run();
        created = Boolean(result.meta.changes);
      } catch {
        // A code collision is exceptionally unlikely; retry with fresh randomness.
      }
    }
  }
  const referrals = await referralPayload(request, identity.uid);
  if (!referrals?.code)
    return json({ ok: false, error: "The referral link could not be generated. Try again." }, 500);
  return json({ ok: true, referrals });
}
