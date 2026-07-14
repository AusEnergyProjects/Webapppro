import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";

export const runtime = "edge";

const PLAN_BY_PAYMENT_LINK: Record<
  string,
  { planKey: string; partnerType: "installer" | "supplier" }
> = {
  plink_1Tt2EPAZFM6O8tnYCbCwBETb: {
    planKey: "installer_monthly",
    partnerType: "installer",
  },
  plink_1Tt2IzAZFM6O8tnYwF0SQ7Q8: {
    planKey: "installer_annual",
    partnerType: "installer",
  },
  plink_1Tt2RrAZFM6O8tnYn3YsYgRh: {
    planKey: "supplier_monthly",
    partnerType: "supplier",
  },
  plink_1Tt2UdAZFM6O8tnYmruCRBr6: {
    planKey: "supplier_annual",
    partnerType: "supplier",
  },
};

type StripeObject = Record<string, unknown>;

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function stringId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as StripeObject).id === "string")
    return String((value as StripeObject).id);
  return "";
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function verifyStripeSignature(
  body: string,
  signatureHeader: string,
  secret: string,
) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = Number(
    parts.find((part) => part.startsWith("t="))?.slice(2) || 0,
  );
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (
    !Number.isInteger(timestamp) ||
    !signatures.length ||
    Math.abs(Date.now() / 1000 - timestamp) > 300
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function subscriptionBillingStatus(status: string, cancelAtPeriodEnd: boolean) {
  if (status === "trialing") return "trial";
  if (status === "active")
    return cancelAtPeriodEnd ? "active_cancels_at_period_end" : "active";
  if (["past_due", "unpaid"].includes(status)) return "past_due";
  if (["canceled", "incomplete_expired"].includes(status)) return "cancelled";
  if (status === "paused") return "paused";
  return "processing";
}

function subscriptionPeriodEnd(subscription: StripeObject) {
  const direct = Number(subscription.current_period_end || 0);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const items = subscription.items as StripeObject | undefined;
  const firstItem = Array.isArray(items?.data)
    ? (items!.data as StripeObject[])[0]
    : undefined;
  const itemEnd = Number(firstItem?.current_period_end || 0);
  return Number.isInteger(itemEnd) && itemEnd > 0 ? itemEnd : 0;
}

async function applyCheckout(
  session: StripeObject,
  eventType: string,
) {
  const firebaseUid =
    typeof session.client_reference_id === "string"
      ? session.client_reference_id.slice(0, 180)
      : "";
  const paymentLinkId = stringId(session.payment_link);
  const plan = PLAN_BY_PAYMENT_LINK[paymentLinkId];
  if (!firebaseUid || !plan) return;
  const subscriptionId = stringId(session.subscription);
  if (!subscriptionId) throw new Error("SUBSCRIPTION_REFERENCE_MISSING");
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT partner_type FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(firebaseUid)
    .first<{ partner_type: string }>();
  if (!account) throw new Error("TRADE_PROFILE_MISSING");
  if (account.partner_type !== plan.partnerType)
    throw new Error("MEMBERSHIP_ROLE_MISMATCH");
  const paymentStatus = String(session.payment_status || "");
  const billingStatus =
    eventType === "checkout.session.async_payment_failed"
      ? "past_due"
      : eventType === "checkout.session.async_payment_succeeded" ||
          paymentStatus === "paid" ||
          paymentStatus === "no_payment_required"
        ? "active"
        : "processing";
  const customerId = stringId(session.customer);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO stripe_memberships
        (id, firebase_uid, partner_type, plan_key, payment_link_id, stripe_customer_id,
         stripe_subscription_id, status, cancel_at_period_end, current_period_end, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
          firebase_uid = excluded.firebase_uid, partner_type = excluded.partner_type,
          plan_key = excluded.plan_key, payment_link_id = excluded.payment_link_id,
          stripe_customer_id = excluded.stripe_customer_id, status = excluded.status,
          updated_at = excluded.updated_at`,
      )
      .bind(
        subscriptionId,
        firebaseUid,
        plan.partnerType,
        plan.planKey,
        paymentLinkId,
        customerId,
        subscriptionId,
        billingStatus,
        now,
        now,
      ),
    db
      .prepare(
        "UPDATE trade_accounts SET plan_key = ?, billing_status = ?, updated_at = ? WHERE firebase_uid = ?",
      )
      .bind(plan.planKey, billingStatus, now, firebaseUid),
  ]);
}

async function applySubscription(subscription: StripeObject, deleted: boolean) {
  const subscriptionId = stringId(subscription.id);
  if (!subscriptionId) return;
  const db = getD1();
  const membership = await db
    .prepare(
      "SELECT firebase_uid FROM stripe_memberships WHERE stripe_subscription_id = ?",
    )
    .bind(subscriptionId)
    .first<{ firebase_uid: string }>();
  if (!membership) return;
  const status = deleted ? "canceled" : String(subscription.status || "");
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const billingStatus = subscriptionBillingStatus(status, cancelAtPeriodEnd);
  const periodEnd = subscriptionPeriodEnd(subscription);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE stripe_memberships SET status = ?, cancel_at_period_end = ?,
         current_period_end = ?, stripe_customer_id = ?, updated_at = ?
         WHERE stripe_subscription_id = ?`,
      )
      .bind(
        billingStatus,
        cancelAtPeriodEnd ? 1 : 0,
        periodEnd,
        stringId(subscription.customer),
        now,
        subscriptionId,
      ),
    db
      .prepare(
        "UPDATE trade_accounts SET billing_status = ?, updated_at = ? WHERE firebase_uid = ?",
      )
      .bind(billingStatus, now, membership.firebase_uid),
  ]);
}

export async function POST(request: Request) {
  const secret = (
    env as unknown as { STRIPE_WEBHOOK_SECRET?: string }
  ).STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return json({ ok: false, error: "Stripe billing is unavailable." }, 503);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 1024 * 1024)
    return json({ ok: false, error: "Webhook event was too large." }, 413);
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024)
    return json({ ok: false, error: "Webhook event was too large." }, 413);
  const signature = request.headers.get("stripe-signature") || "";
  if (!(await verifyStripeSignature(rawBody, signature, secret)))
    return json({ ok: false, error: "Webhook signature was not accepted." }, 400);
  let event: StripeObject;
  try {
    event = JSON.parse(rawBody) as StripeObject;
  } catch {
    return json({ ok: false, error: "Invalid webhook event." }, 400);
  }
  const eventId = stringId(event.id);
  const eventType = String(event.type || "");
  if (!eventId || !eventType)
    return json({ ok: false, error: "Invalid webhook event." }, 400);
  const db = getD1();
  const processed = await db
    .prepare("SELECT id FROM stripe_webhook_events WHERE id = ?")
    .bind(eventId)
    .first<{ id: string }>();
  if (processed) return json({ ok: true, duplicate: true });
  const data = event.data as StripeObject | undefined;
  const stripeObject = data?.object as StripeObject | undefined;
  if (!stripeObject)
    return json({ ok: false, error: "Webhook data was incomplete." }, 400);
  try {
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
      ].includes(eventType)
    )
      await applyCheckout(stripeObject, eventType);
    else if (eventType === "customer.subscription.updated")
      await applySubscription(stripeObject, false);
    else if (eventType === "customer.subscription.deleted")
      await applySubscription(stripeObject, true);
    await db
      .prepare(
        "INSERT INTO stripe_webhook_events (id, event_type, created_at) VALUES (?, ?, ?)",
      )
      .bind(eventId, eventType, new Date().toISOString())
      .run();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      [
        "TRADE_PROFILE_MISSING",
        "MEMBERSHIP_ROLE_MISMATCH",
        "SUBSCRIPTION_REFERENCE_MISSING",
      ].includes(code)
    )
      return json({ ok: false, error: "Membership account matching failed." }, 409);
    return json({ ok: false, error: "Membership update failed." }, 500);
  }
  return json({ ok: true });
}
