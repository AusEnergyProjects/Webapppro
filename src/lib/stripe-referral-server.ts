import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import {
  ACTIVE_REFERRAL_BILLING_STATUSES,
  addCalendarMonthUnix,
} from "@/lib/direct-trade-referrals";

type StripeObject = Record<string, unknown>;
type ReferralRow = {
  id: string;
  referrer_uid: string;
  referred_uid: string;
  referred_subscription_id: string;
  status: string;
};
type MembershipRow = {
  firebase_uid: string;
  stripe_subscription_id: string;
  status: string;
};
type CreditRow = {
  id: string;
  referral_id: string;
  firebase_uid: string;
  stripe_subscription_id: string;
  status: string;
  extension_start: number;
  extension_end: number;
};

export function stripeSubscriptionPeriodEnd(subscription: StripeObject) {
  const direct = Number(subscription.current_period_end || 0);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const items = subscription.items as StripeObject | undefined;
  const itemEnds = Array.isArray(items?.data)
    ? (items.data as StripeObject[]).map((item) => Number(item.current_period_end || 0))
    : [];
  return Math.max(0, ...itemEnds.filter((value) => Number.isInteger(value)));
}

function referralSecret() {
  return String(
    (env as unknown as { STRIPE_REFERRAL_SECRET_KEY?: string })
      .STRIPE_REFERRAL_SECRET_KEY || "",
  );
}

async function stripeRequest(
  path: string,
  init: { method?: "GET" | "POST"; body?: URLSearchParams; idempotencyKey?: string } = {},
) {
  const secret = referralSecret();
  if (!secret) throw new Error("REFERRAL_STRIPE_UNAVAILABLE");
  const headers = new Headers({ Authorization: `Bearer ${secret}` });
  if (init.body) headers.set("Content-Type", "application/x-www-form-urlencoded");
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body,
  });
  const payload = await response.json().catch(() => ({})) as StripeObject;
  if (!response.ok) {
    const error = payload.error as StripeObject | undefined;
    const code = String(error?.code || error?.type || "STRIPE_REFERRAL_UPDATE_FAILED");
    throw new Error(code.slice(0, 120));
  }
  return { payload, requestId: response.headers.get("request-id") || "" };
}

async function planCreditExtension(credit: CreditRow) {
  if (credit.extension_end > 0) return credit;
  const subscriptionResult = await stripeRequest(
    `/v1/subscriptions/${encodeURIComponent(credit.stripe_subscription_id)}`,
  );
  const subscription = subscriptionResult.payload;
  const subscriptionStatus = String(subscription.status || "");
  if (!['active', 'trialing'].includes(subscriptionStatus))
    throw new Error("REFERRAL_SUBSCRIPTION_NOT_ACTIVE");
  const periodEnd = stripeSubscriptionPeriodEnd(subscription);
  const trialEnd = Number(subscription.trial_end || 0);
  const db = getD1();
  const previous = await db.prepare(`
    SELECT MAX(extension_end) extension_end
    FROM trade_membership_credits
    WHERE firebase_uid = ? AND id <> ? AND status IN ('pending', 'applied', 'failed')
  `).bind(credit.firebase_uid, credit.id).first<{ extension_end: number }>();
  const extensionStart = Math.max(
    periodEnd,
    Number.isInteger(trialEnd) ? trialEnd : 0,
    Number(previous?.extension_end || 0),
    Math.floor(Date.now() / 1000),
  );
  if (!extensionStart) throw new Error("REFERRAL_SUBSCRIPTION_PERIOD_MISSING");
  const extensionEnd = addCalendarMonthUnix(extensionStart);
  await db.prepare(`
    UPDATE trade_membership_credits
    SET extension_start = ?, extension_end = ?, updated_at = ?
    WHERE id = ? AND extension_end = 0
  `).bind(extensionStart, extensionEnd, new Date().toISOString(), credit.id).run();
  return await db.prepare(`
    SELECT id, referral_id, firebase_uid, stripe_subscription_id, status,
           extension_start, extension_end
    FROM trade_membership_credits WHERE id = ?
  `).bind(credit.id).first<CreditRow>() as CreditRow;
}

async function applyReferralCredit(creditId: string) {
  const db = getD1();
  let credit = await db.prepare(`
    SELECT id, referral_id, firebase_uid, stripe_subscription_id, status,
           extension_start, extension_end
    FROM trade_membership_credits WHERE id = ?
  `).bind(creditId).first<CreditRow>();
  if (!credit) throw new Error("REFERRAL_CREDIT_MISSING");
  if (credit.status === "applied") return true;
  try {
    credit = await planCreditExtension(credit);
    const params = new URLSearchParams();
    params.set("trial_end", String(credit.extension_end));
    params.set("proration_behavior", "none");
    params.set("metadata[aea_referral_extension]", "true");
    params.set("metadata[aea_last_referral_id]", credit.referral_id);
    const update = await stripeRequest(
      `/v1/subscriptions/${encodeURIComponent(credit.stripe_subscription_id)}`,
      {
        method: "POST",
        body: params,
        idempotencyKey: `aea-referral-${credit.id}`,
      },
    );
    const cancelAtPeriodEnd = Boolean(update.payload.cancel_at_period_end);
    const billingStatus = cancelAtPeriodEnd
      ? "active_cancels_at_period_end"
      : "active";
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`
        UPDATE trade_membership_credits
        SET status = 'applied', stripe_request_id = ?, failure_code = '', updated_at = ?
        WHERE id = ?
      `).bind(update.requestId, now, credit.id),
      db.prepare(`
        UPDATE stripe_memberships
        SET status = ?, current_period_end = ?, updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(billingStatus, credit.extension_end, now, credit.stripe_subscription_id),
      db.prepare(`
        UPDATE trade_accounts SET billing_status = ?, updated_at = ? WHERE firebase_uid = ?
      `).bind(billingStatus, now, credit.firebase_uid),
    ]);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "REFERRAL_CREDIT_FAILED";
    await db.prepare(`
      UPDATE trade_membership_credits
      SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ?
    `).bind(code, new Date().toISOString(), credit.id).run();
    throw error;
  }
}

function membershipIsActive(status: string) {
  return ACTIVE_REFERRAL_BILLING_STATUSES.has(status);
}

export async function rewardReferral(referralId: string) {
  const db = getD1();
  const referral = await db.prepare(`
    SELECT id, referrer_uid, referred_uid, referred_subscription_id, status
    FROM trade_referrals WHERE id = ?
  `).bind(referralId).first<ReferralRow>();
  if (!referral || ["rejected", "rewarded", "review_required", "registered"].includes(referral.status))
    return referral?.status === "rewarded";

  const referrerMembership = await db.prepare(`
    SELECT firebase_uid, stripe_subscription_id, status
    FROM stripe_memberships
    WHERE firebase_uid = ? AND status IN ('active', 'active_cancels_at_period_end')
    ORDER BY updated_at DESC LIMIT 1
  `).bind(referral.referrer_uid).first<MembershipRow>();
  const referredMembership = await db.prepare(`
    SELECT firebase_uid, stripe_subscription_id, status
    FROM stripe_memberships
    WHERE firebase_uid = ? AND stripe_subscription_id = ?
    LIMIT 1
  `).bind(referral.referred_uid, referral.referred_subscription_id).first<MembershipRow>();

  if (!referrerMembership || !membershipIsActive(referrerMembership.status)) {
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE trade_referrals
      SET status = 'rejected', risk_reason = 'Referrer membership was not active when the first payment cleared.', updated_at = ?
      WHERE id = ?
    `).bind(now, referral.id).run();
    return false;
  }
  if (!referredMembership || !membershipIsActive(referredMembership.status))
    throw new Error("REFERRED_MEMBERSHIP_NOT_ACTIVE");

  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`
      INSERT INTO trade_membership_credits
      (id, referral_id, firebase_uid, beneficiary_role, stripe_subscription_id, status,
       extension_start, extension_end, stripe_request_id, failure_code, created_at, updated_at)
      VALUES (?, ?, ?, 'referrer', ?, 'pending', 0, 0, '', '', ?, ?)
      ON CONFLICT(referral_id, firebase_uid) DO NOTHING
    `).bind(crypto.randomUUID(), referral.id, referral.referrer_uid, referrerMembership.stripe_subscription_id, now, now),
    db.prepare(`
      INSERT INTO trade_membership_credits
      (id, referral_id, firebase_uid, beneficiary_role, stripe_subscription_id, status,
       extension_start, extension_end, stripe_request_id, failure_code, created_at, updated_at)
      VALUES (?, ?, ?, 'referred', ?, 'pending', 0, 0, '', '', ?, ?)
      ON CONFLICT(referral_id, firebase_uid) DO NOTHING
    `).bind(crypto.randomUUID(), referral.id, referral.referred_uid, referredMembership.stripe_subscription_id, now, now),
    db.prepare("UPDATE trade_referrals SET status = 'rewarding', updated_at = ? WHERE id = ?")
      .bind(now, referral.id),
  ]);

  const credits = await db.prepare(`
    SELECT id FROM trade_membership_credits WHERE referral_id = ? ORDER BY beneficiary_role
  `).bind(referral.id).all<{ id: string }>();
  try {
    for (const credit of credits.results) await applyReferralCredit(credit.id);
  } catch (error) {
    await db.prepare("UPDATE trade_referrals SET status = 'reward_failed', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), referral.id).run();
    throw error;
  }
  const applied = await db.prepare(`
    SELECT COUNT(*) count FROM trade_membership_credits
    WHERE referral_id = ? AND status = 'applied'
  `).bind(referral.id).first<{ count: number }>();
  if (Number(applied?.count || 0) === 2) {
    const rewardedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE trade_referrals SET status = 'rewarded', rewarded_at = ?, updated_at = ? WHERE id = ?
    `).bind(rewardedAt, rewardedAt, referral.id).run();
    return true;
  }
  return false;
}

export async function qualifyReferralFromFirstPayment(
  referredUid: string,
  subscriptionId: string,
) {
  const db = getD1();
  const referral = await db.prepare(`
    SELECT id, referrer_uid, referred_uid, referred_subscription_id, status
    FROM trade_referrals WHERE referred_uid = ?
  `).bind(referredUid).first<ReferralRow>();
  if (!referral || ["rejected", "rewarded"].includes(referral.status)) return;

  const priorMemberships = await db.prepare(`
    SELECT COUNT(*) count FROM stripe_memberships
    WHERE firebase_uid = ? AND stripe_subscription_id <> ?
      AND status IN ('trial', 'active', 'active_cancels_at_period_end', 'paused', 'cancelled')
  `).bind(referredUid, subscriptionId).first<{ count: number }>();
  const now = new Date().toISOString();
  if (Number(priorMemberships?.count || 0) > 0) {
    await db.prepare(`
      UPDATE trade_referrals
      SET status = 'rejected', risk_reason = 'The referred account already had a paid membership.', updated_at = ?
      WHERE id = ?
    `).bind(now, referral.id).run();
    return;
  }
  const nextStatus = referral.status === "review_required" ? "review_required" : "qualified";
  await db.prepare(`
    UPDATE trade_referrals
    SET referred_subscription_id = ?, first_paid_at = CASE WHEN first_paid_at = '' THEN ? ELSE first_paid_at END,
        status = ?, updated_at = ?
    WHERE id = ?
  `).bind(subscriptionId, now, nextStatus, now, referral.id).run();
  if (nextStatus === "qualified") await rewardReferral(referral.id);
}
