import { getD1 } from "../../../../../db";
import { normalizeAustralianMobile, verifyTwilioWebhook } from "@/lib/service-reminder-delivery";

export const runtime = "edge";

const statusMap: Record<string, string> = { accepted: "sent", queued: "sent", sending: "sent", sent: "sent", delivered: "delivered", failed: "failed", undelivered: "failed", canceled: "failed" };
const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 2, opted_out: 3, bounced: 3 };

async function eventKey(content: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const rawBody = await request.text(); const parameters = new URLSearchParams(rawBody);
  const signature = request.headers.get("x-twilio-signature") || ""; const authToken = String(process.env.TWILIO_AUTH_TOKEN || "");
  const canonicalUrl = String(process.env.SERVICE_REMINDER_TWILIO_CALLBACK_URL || request.url);
  if (!authToken || !(await verifyTwilioWebhook(canonicalUrl, parameters, signature, authToken))) {
    return Response.json({ ok: false, error: "Invalid provider signature." }, { status: 401 });
  }
  const db = getD1(); const now = new Date().toISOString(); const messageSid = parameters.get("MessageSid") || parameters.get("SmsSid") || "";
  const providerStatus = parameters.get("MessageStatus") || parameters.get("SmsStatus") || "";
  const optOutType = String(parameters.get("OptOutType") || "").toUpperCase(); const body = String(parameters.get("Body") || "").trim().toUpperCase();
  const isOptOut = optOutType === "STOP" || ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(body);
  if (isOptOut) {
    const mobile = normalizeAustralianMobile(parameters.get("From"));
    const contact = mobile ? await db.prepare("SELECT customer_uid FROM customer_service_reminder_contacts WHERE mobile_e164 = ?")
      .bind(mobile).first<Record<string, unknown>>() : null;
    if (contact?.customer_uid) {
      await db.batch([
        db.prepare(`INSERT INTO customer_service_reminder_opt_outs (id, customer_uid, channel, source, provider_reference, opted_out_at, created_at)
          VALUES (?, ?, 'sms', 'twilio_stop', ?, ?, ?) ON CONFLICT(customer_uid, channel) DO UPDATE SET source = 'twilio_stop',
          provider_reference = excluded.provider_reference, opted_out_at = excluded.opted_out_at`)
          .bind(crypto.randomUUID(), contact.customer_uid, messageSid, now, now),
        db.prepare("UPDATE customer_asset_lifecycle_preferences SET sms_enabled = 0, updated_at = ? WHERE customer_uid = ?").bind(now, contact.customer_uid),
        db.prepare(`UPDATE service_reminder_deliveries SET status = 'opted_out', provider_status = 'twilio_stop', failed_at = ?, updated_at = ?
          WHERE customer_uid = ? AND channel = 'sms' AND status IN ('queued', 'failed')`).bind(now, now, contact.customer_uid),
        db.prepare(`UPDATE appointment_notification_deliveries SET status = 'opted_out', provider_status = 'twilio_stop', failed_at = ?, updated_at = ?
          WHERE recipient_uid = ? AND audience = 'customer' AND channel = 'sms'
            AND status IN ('queued', 'failed', 'waiting_for_channel', 'waiting_for_sender', 'waiting_for_limit')`).bind(now, now, contact.customer_uid),
      ]);
    }
    return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", { headers: { "Content-Type": "text/xml" } });
  }
  const status = statusMap[providerStatus];
  if (!messageSid || !status) return new Response(null, { status: 204 });
  const serviceDelivery = await db.prepare(`SELECT id, status FROM service_reminder_deliveries WHERE provider = 'twilio' AND provider_message_id = ?`)
    .bind(messageSid).first<Record<string, unknown>>();
  const appointmentDelivery = serviceDelivery ? null : await db.prepare(`SELECT id, status FROM appointment_notification_deliveries
    WHERE provider = 'twilio' AND provider_message_id = ?`).bind(messageSid).first<Record<string, unknown>>();
  const delivery = serviceDelivery || appointmentDelivery;
  if (!delivery) return new Response(null, { status: 204 });
  const key = `twilio:${await eventKey(`${messageSid}|${providerStatus}|${parameters.get("ErrorCode") || ""}`)}`;
  const replayTable = serviceDelivery ? "service_reminder_delivery_events" : "appointment_notification_delivery_events";
  if (await db.prepare(`SELECT id FROM ${replayTable} WHERE provider_event_key = ?`).bind(key).first()) return new Response(null, { status: 204 });
  const nextStatus = (rank[status] || 0) >= (rank[String(delivery.status)] || 0) ? status : String(delivery.status);
  await db.batch(serviceDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO service_reminder_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, 'twilio_status', ?, 'Authenticated Twilio delivery status received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, key, providerStatus, now, now),
    db.prepare(`UPDATE service_reminder_deliveries SET status = ?, provider_status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END, last_error = CASE WHEN ? = 'failed' THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(nextStatus, providerStatus, nextStatus, now, nextStatus, now, nextStatus, String(parameters.get("ErrorCode") || "").slice(0, 120), now, delivery.id),
  ] : [
    db.prepare(`INSERT OR IGNORE INTO appointment_notification_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, 'twilio_status', ?, 'Authenticated Twilio appointment delivery status received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, key, providerStatus, now, now),
    db.prepare(`UPDATE appointment_notification_deliveries SET status = ?, provider_status = ?,
      delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
      last_error = CASE WHEN ? = 'failed' THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(nextStatus, providerStatus, nextStatus, now, nextStatus, now, nextStatus,
        String(parameters.get("ErrorCode") || "").slice(0, 120), now, delivery.id),
  ]);
  return new Response(null, { status: 204 });
}
