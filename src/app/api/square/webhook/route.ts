import { env } from "cloudflare:workers";
import { createAdminNotification } from "@/lib/admin-notifications";
import { reconcileTradePayment } from "@/lib/trade-payment-reconciliation";

export const runtime = "edge";

type SquareObject = Record<string, unknown>;

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function verifySquareSignature(rawBody: string, signature: string, signatureKey: string, notificationUrl: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${notificationUrl}${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return safeEqual(signature, expected);
}

export async function POST(request: Request) {
  const values = env as unknown as {
    SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
    SQUARE_WEBHOOK_NOTIFICATION_URL?: string;
  };
  if (!values.SQUARE_WEBHOOK_SIGNATURE_KEY) return json({ ok: false, error: "Square reconciliation is unavailable." }, 503);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 1024 * 1024) return json({ ok: false, error: "Webhook event was too large." }, 413);
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return json({ ok: false, error: "Webhook event was too large." }, 413);
  const notificationUrl = values.SQUARE_WEBHOOK_NOTIFICATION_URL || request.url;
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!signature || !(await verifySquareSignature(rawBody, signature, values.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl))) {
    return json({ ok: false, error: "Webhook signature was not accepted." }, 403);
  }
  let event: SquareObject;
  try { event = JSON.parse(rawBody) as SquareObject; }
  catch { return json({ ok: false, error: "Invalid webhook event." }, 400); }
  const eventId = String(event.event_id || "");
  const eventType = String(event.type || "");
  const merchantId = String(event.merchant_id || "");
  if (!eventId || !eventType || !merchantId) return json({ ok: false, error: "Invalid webhook event." }, 400);
  if (eventType !== "payment.created" && eventType !== "payment.updated") return json({ ok: true, ignored: true });
  const data = event.data as SquareObject | undefined;
  const object = data?.object as SquareObject | undefined;
  const payment = object?.payment as SquareObject | undefined;
  if (!payment) return json({ ok: false, error: "Webhook data was incomplete." }, 400);
  const providerStatus = String(payment.status || "").toUpperCase();
  const status = providerStatus === "COMPLETED"
    ? "paid"
    : providerStatus === "FAILED" || providerStatus === "CANCELED"
      ? "failed"
      : "processing";
  const amountMoney = payment.amount_money as SquareObject | undefined;
  try {
    const result = await reconcileTradePayment({
      provider: "square",
      eventId,
      eventType,
      connectedAccountId: merchantId,
      providerOrderId: String(payment.order_id || ""),
      providerPaymentId: String(payment.id || ""),
      status,
      amountCents: Number(amountMoney?.amount || 0),
      currency: String(amountMoney?.currency || ""),
      occurredAt: String(payment.updated_at || payment.created_at || event.created_at || ""),
      failureCode: providerStatus || "provider_failed",
    });
    return json({ ok: true, matched: result.matched, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    await createAdminNotification({
      eventKey: `square-webhook-failure:${eventId}`,
      eventType: "billing.webhook_processing_failed",
      category: "billing",
      priority: "urgent",
      title: "Verified Square payment could not be applied",
      summary: "A verified Square payment event could not be applied to the installer payment ledger. Review the billing audit before changing a job balance.",
      entityType: "square_event",
      entityId: eventId,
      actorType: "system",
      requiresAction: true,
      metadata: { eventType, failureCode: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN" },
    }).catch(() => null);
    return json({ ok: false, error: "Payment reconciliation failed." }, 500);
  }
}
