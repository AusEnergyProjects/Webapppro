import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { qualifyReferralFromFirstPayment } from "@/lib/stripe-referral-server";
import { createAdminNotification, resolveSystemAdminNotifications } from "@/lib/admin-notifications";
import { reconcileTradePayment } from "@/lib/trade-payment-reconciliation";
import { stripeMembershipPlanByPaymentLink } from "@/lib/commercial-config";

export const runtime = "edge";

type StripeObject = Record<string, unknown>;
type BillingChange = {
  subscriptionId: string;
  firebaseUid: string;
  businessName: string;
  partnerType: string;
  billingStatus: string;
  cancelAtPeriodEnd: boolean;
};

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

function subscriptionBillingStatus(
  status: string,
  cancelAtPeriodEnd: boolean,
  referralExtension: boolean,
) {
  if (status === "trialing")
    return referralExtension
      ? cancelAtPeriodEnd
        ? "active_cancels_at_period_end"
        : "active"
      : "trial";
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
  const plan = stripeMembershipPlanByPaymentLink()[paymentLinkId];
  if (!firebaseUid || !plan) return undefined;
  const subscriptionId = stringId(session.subscription);
  if (!subscriptionId) throw new Error("SUBSCRIPTION_REFERENCE_MISSING");
  const db = getD1();
  const account = await db
    .prepare(
      "SELECT partner_type, business_name FROM trade_accounts WHERE firebase_uid = ?",
    )
    .bind(firebaseUid)
    .first<{ partner_type: string; business_name: string }>();
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
  if (
    billingStatus === "active" &&
    (eventType === "checkout.session.async_payment_succeeded" || paymentStatus === "paid")
  )
    await qualifyReferralFromFirstPayment(firebaseUid, subscriptionId);
  return {
    subscriptionId,
    firebaseUid,
    businessName: account.business_name,
    partnerType: plan.partnerType,
    billingStatus,
    cancelAtPeriodEnd: false,
  } satisfies BillingChange;
}

async function applyTradeCrmCheckout(session: StripeObject, event: StripeObject, eventType: string) {
  const connectedAccountId = stringId(event.account);
  const externalId = stringId(session.id);
  if (!connectedAccountId || !externalId || session.mode !== "payment") return undefined;
  const paymentStatus = String(session.payment_status || "");
  const status = eventType === "checkout.session.async_payment_failed"
    ? "failed"
    : eventType === "checkout.session.async_payment_succeeded" || paymentStatus === "paid" || paymentStatus === "no_payment_required"
      ? "paid"
      : "processing";
  const created = Number(event.created || 0);
  return reconcileTradePayment({
    provider: "stripe",
    eventId: stringId(event.id),
    eventType,
    connectedAccountId,
    externalId,
    providerPaymentId: stringId(session.payment_intent),
    workOrderReference: typeof session.client_reference_id === "string" ? session.client_reference_id : "",
    status,
    amountCents: Number(session.amount_total || 0),
    currency: String(session.currency || ""),
    occurredAt: Number.isInteger(created) && created > 0 ? new Date(created * 1000).toISOString() : "",
    failureCode: paymentStatus || "provider_failed",
  });
}

async function applySubscription(subscription: StripeObject, deleted: boolean) {
  const subscriptionId = stringId(subscription.id);
  if (!subscriptionId) return undefined;
  const db = getD1();
  const membership = await db
    .prepare(
      `SELECT m.firebase_uid, m.partner_type, a.business_name FROM stripe_memberships m
       LEFT JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid WHERE m.stripe_subscription_id = ?`,
    )
    .bind(subscriptionId)
    .first<{ firebase_uid: string; partner_type: string; business_name: string }>();
  if (!membership) return undefined;
  const status = deleted ? "canceled" : String(subscription.status || "");
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const metadata = subscription.metadata as StripeObject | undefined;
  const billingStatus = subscriptionBillingStatus(
    status,
    cancelAtPeriodEnd,
    metadata?.aea_referral_extension === "true",
  );
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
  return {
    subscriptionId,
    firebaseUid: membership.firebase_uid,
    businessName: membership.business_name || "A trade account",
    partnerType: membership.partner_type,
    billingStatus,
    cancelAtPeriodEnd,
  } satisfies BillingChange;
}

function invoiceSubscriptionId(invoice: StripeObject) {
  const direct = stringId(invoice.subscription);
  if (direct) return direct;
  const parent = invoice.parent as StripeObject | undefined;
  const details = parent?.subscription_details as StripeObject | undefined;
  return stringId(details?.subscription);
}

async function billingChangeForInvoice(invoice: StripeObject, billingStatus: string) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return undefined;
  const membership = await getD1().prepare(`SELECT m.firebase_uid, m.partner_type, a.business_name
    FROM stripe_memberships m LEFT JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
    WHERE m.stripe_subscription_id = ?`).bind(subscriptionId)
    .first<{ firebase_uid: string; partner_type: string; business_name: string }>();
  if (!membership) return undefined;
  return {
    subscriptionId,
    firebaseUid: membership.firebase_uid,
    businessName: membership.business_name || "A trade account",
    partnerType: membership.partner_type,
    billingStatus,
    cancelAtPeriodEnd: false,
  } satisfies BillingChange;
}

async function recordBillingChange(change: BillingChange, eventId: string, eventType: string) {
  const attention = ["past_due", "cancelled", "paused", "active_cancels_at_period_end"].includes(change.billingStatus);
  if (attention) {
    await createAdminNotification({
      eventKey: `billing-attention:${eventId}`,
      eventType: "billing.membership_attention_required",
      category: "billing",
      priority: "high",
      title: "Membership billing needs attention",
      summary: `${change.businessName.slice(0, 160)} has a ${change.partnerType} membership marked ${change.billingStatus.replaceAll("_", " ")}. Review billing before commercial access is affected.`,
      entityType: "stripe_subscription",
      entityId: change.subscriptionId,
      actorType: "system",
      requiresAction: true,
      metadata: { billingStatus: change.billingStatus, sourceEvent: eventType },
    });
    return;
  }
  if (change.billingStatus === "active") {
    await resolveSystemAdminNotifications({
      eventTypes: ["billing.membership_attention_required"],
      entityType: "stripe_subscription",
      entityId: change.subscriptionId,
      note: "Stripe reported the membership as active and the billing incident recovered.",
    });
    if (eventType.startsWith("checkout.session")) {
      await createAdminNotification({
        eventKey: `billing-activated:${eventId}`,
        eventType: "billing.membership_activated",
        category: "billing",
        priority: "normal",
        title: "Paid membership activated",
        summary: `${change.businessName.slice(0, 160)} activated a paid ${change.partnerType} membership.`,
        entityType: "stripe_subscription",
        entityId: change.subscriptionId,
        actorType: "system",
        requiresAction: false,
      });
    }
  }
}

export async function POST(request: Request) {
  const webhookEnvironment = env as unknown as {
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_CONNECT_WEBHOOK_SECRET?: string;
  };
  const secrets = [webhookEnvironment.STRIPE_WEBHOOK_SECRET, webhookEnvironment.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((value): value is string => Boolean(value));
  if (!secrets.length)
    return json({ ok: false, error: "Stripe billing is unavailable." }, 503);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 1024 * 1024)
    return json({ ok: false, error: "Webhook event was too large." }, 413);
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024)
    return json({ ok: false, error: "Webhook event was too large." }, 413);
  const signature = request.headers.get("stripe-signature") || "";
  const signatureChecks = await Promise.all(secrets.map((secret) => verifyStripeSignature(rawBody, signature, secret)));
  if (!signatureChecks.some(Boolean))
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
    let billingChange: BillingChange | undefined;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
      ].includes(eventType)
    ) {
      await applyTradeCrmCheckout(stripeObject, event, eventType);
      billingChange = await applyCheckout(stripeObject, eventType);
    }
    else if (eventType === "customer.subscription.updated")
      billingChange = await applySubscription(stripeObject, false);
    else if (eventType === "customer.subscription.deleted")
      billingChange = await applySubscription(stripeObject, true);
    else if (["invoice.payment_failed", "invoice.payment_action_required"].includes(eventType))
      billingChange = await billingChangeForInvoice(stripeObject, "past_due");
    else if (eventType === "invoice.payment_succeeded")
      billingChange = await billingChangeForInvoice(stripeObject, "active");
    await db
      .prepare(
        "INSERT INTO stripe_webhook_events (id, event_type, created_at) VALUES (?, ?, ?)",
      )
      .bind(eventId, eventType, new Date().toISOString())
      .run();
    if (billingChange) await recordBillingChange(billingChange, eventId, eventType).catch(() => null);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    await createAdminNotification({
      eventKey: `billing-webhook-failure:${eventId}`,
      eventType: "billing.webhook_processing_failed",
      category: "billing",
      priority: "urgent",
      title: "Verified billing event could not be applied",
      summary: "A verified Stripe event could not be matched or applied to the membership ledger. Review the billing audit before changing account access.",
      entityType: "stripe_event",
      entityId: eventId,
      actorType: "system",
      requiresAction: true,
      metadata: { eventType, failureCode: code || "UNKNOWN" },
    }).catch(() => null);
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
