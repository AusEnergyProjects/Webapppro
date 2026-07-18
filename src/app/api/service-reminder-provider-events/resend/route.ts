import { getD1 } from "../../../../../db";
import { verifyResendWebhook } from "@/lib/service-reminder-delivery";

export const runtime = "edge";

const mappedStatus: Record<string, string> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.bounced": "bounced",
  "email.failed": "failed", "email.suppressed": "opted_out", "email.complained": "opted_out",
};

export async function POST(request: Request) {
  const rawBody = await request.text(); const eventId = request.headers.get("svix-id") || "";
  const secret = String(process.env.RESEND_WEBHOOK_SECRET || "");
  if (!secret || !(await verifyResendWebhook(rawBody, request.headers, secret))) {
    return Response.json({ ok: false, error: "Invalid provider signature." }, { status: 401 });
  }
  let event: Record<string, unknown>;
  try { event = JSON.parse(rawBody) as Record<string, unknown>; } catch { return Response.json({ ok: false }, { status: 400 }); }
  const eventType = String(event.type || ""); const data = (event.data || {}) as Record<string, unknown>;
  const providerMessageId = String(data.email_id || data.id || ""); const status = mappedStatus[eventType];
  if (!providerMessageId || !status) return Response.json({ ok: true, ignored: true });
  const db = getD1();
  const serviceDelivery = await db.prepare(`SELECT id, customer_uid, asset_id, status FROM service_reminder_deliveries
    WHERE provider = 'resend' AND provider_message_id = ?`).bind(providerMessageId).first<Record<string, unknown>>();
  const appointmentDelivery = serviceDelivery ? null : await db.prepare(`SELECT id, recipient_uid customer_uid, audience, status
    FROM appointment_notification_deliveries WHERE provider = 'resend' AND provider_message_id = ?`)
    .bind(providerMessageId).first<Record<string, unknown>>();
  const photoDelivery = serviceDelivery || appointmentDelivery ? null : await db.prepare(`SELECT id, customer_uid, crm_customer_id, firebase_uid, status
    FROM trade_crm_photo_request_deliveries WHERE provider = 'resend' AND provider_message_id = ?`)
    .bind(providerMessageId).first<Record<string, unknown>>();
  const quoteDelivery = serviceDelivery || appointmentDelivery || photoDelivery ? null : await db.prepare(`SELECT id, quote_link_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, status
    FROM trade_crm_quote_deliveries WHERE provider = 'resend' AND provider_message_id = ?`).bind(providerMessageId).first<Record<string, unknown>>();
  const delivery = serviceDelivery || appointmentDelivery || photoDelivery || quoteDelivery;
  if (!delivery) return Response.json({ ok: true, ignored: true });
  const providerEventKey = `resend:${eventId}`;
  const replayTable = serviceDelivery ? "service_reminder_delivery_events" : appointmentDelivery ? "appointment_notification_delivery_events" : photoDelivery ? "trade_crm_photo_request_delivery_events" : "";
  if (quoteDelivery ? await db.prepare("SELECT id FROM trade_crm_quote_events WHERE evidence_key = ?").bind(providerEventKey).first() : await db.prepare(`SELECT id FROM ${replayTable} WHERE provider_event_key = ?`).bind(providerEventKey).first()) return Response.json({ ok: true, replay: true });
  const now = new Date().toISOString(); const terminal = ["bounced", "failed", "opted_out"].includes(status);
  const statements = serviceDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO service_reminder_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'Authenticated Resend delivery event received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, providerEventKey, eventType, status, String(event.created_at || now), now),
    db.prepare(`UPDATE service_reminder_deliveries SET status = ?, provider_status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      failed_at = CASE WHEN ? = 1 THEN ? ELSE failed_at END, last_error = CASE WHEN ? = 1 THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(status, eventType, status, now, terminal ? 1 : 0, now, terminal ? 1 : 0, eventType.slice(0, 120), now, delivery.id),
  ] : appointmentDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO appointment_notification_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'Authenticated Resend appointment delivery event received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, providerEventKey, eventType, status, String(event.created_at || now), now),
    db.prepare(`UPDATE appointment_notification_deliveries SET status = ?, provider_status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      failed_at = CASE WHEN ? = 1 THEN ? ELSE failed_at END, last_error = CASE WHEN ? = 1 THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(status, eventType, status, now, terminal ? 1 : 0, now, terminal ? 1 : 0, eventType.slice(0, 120), now, delivery.id),
  ] : photoDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO trade_crm_photo_request_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'Authenticated Resend photo request delivery event received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, providerEventKey, eventType, status, String(event.created_at || now), now),
    db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = ?, provider_status = ?,
      delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      failed_at = CASE WHEN ? = 1 THEN ? ELSE failed_at END,
      last_error = CASE WHEN ? = 1 THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(status, eventType, status, now, terminal ? 1 : 0, now, terminal ? 1 : 0, eventType.slice(0, 120), now, delivery.id),
  ] : [
    db.prepare(`UPDATE trade_crm_quote_deliveries SET status = ?, provider_status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
      last_error = CASE WHEN ? = 1 THEN ? ELSE '' END, updated_at = ? WHERE id = ?`)
      .bind(status, eventType, status, now, terminal ? 1 : 0, eventType.slice(0, 120), now, delivery.id),
    db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
      SELECT ?, delivery.quote_link_id, link.quote_id, delivery.quote_version_id, delivery.work_order_id, delivery.firebase_uid, ?, 'provider', ?, ?, ?
      FROM trade_crm_quote_deliveries delivery JOIN trade_crm_quote_links link ON link.id = delivery.quote_link_id WHERE delivery.id = ?`)
      .bind(crypto.randomUUID(), status === "delivered" ? "delivered" : `delivery_${status}`, status === "delivered" ? "Quote email delivered." : "Quote email provider status changed.", providerEventKey, now, delivery.id),
  ];
  if (["email.bounced", "email.suppressed", "email.complained"].includes(eventType)) {
    if ((serviceDelivery || appointmentDelivery?.audience === "customer" || photoDelivery) && delivery.customer_uid) statements.push(
      db.prepare(`INSERT INTO customer_service_reminder_opt_outs (id, customer_uid, channel, source, provider_reference, opted_out_at, created_at)
        VALUES (?, ?, 'email', ?, ?, ?, ?) ON CONFLICT(customer_uid, channel) DO UPDATE SET source = excluded.source,
        provider_reference = excluded.provider_reference, opted_out_at = excluded.opted_out_at`)
        .bind(crypto.randomUUID(), delivery.customer_uid, eventType, providerMessageId, now, now),
      db.prepare(`UPDATE service_reminder_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE customer_uid = ? AND channel = 'email' AND status IN ('queued', 'failed')`).bind(eventType, now, now, delivery.customer_uid),
      db.prepare(`UPDATE appointment_notification_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE recipient_uid = ? AND audience = 'customer' AND channel = 'email' AND status IN ('queued', 'failed', 'waiting_for_channel')`)
        .bind(eventType, now, now, delivery.customer_uid),
      db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE customer_uid = ? AND channel = 'email'
          AND status IN ('queued', 'failed', 'waiting_for_channel', 'waiting_for_limit')`)
        .bind(eventType, now, now, delivery.customer_uid),
    );
    if (photoDelivery) statements.push(db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'opted_out',
      provider_status = ?, failed_at = ?, updated_at = ? WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email'
        AND status IN ('queued', 'sent', 'failed', 'waiting_for_channel', 'waiting_for_limit')`)
      .bind(eventType, now, now, photoDelivery.firebase_uid, photoDelivery.crm_customer_id));
    if (quoteDelivery) statements.push(db.prepare(`UPDATE trade_crm_quote_deliveries SET status = 'opted_out', provider_status = ?, last_error = ?, updated_at = ?
      WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email' AND status IN ('queued', 'sending', 'sent', 'failed')`)
      .bind(eventType, eventType, now, quoteDelivery.firebase_uid, quoteDelivery.crm_customer_id));
    if (serviceDelivery) statements.push(db.prepare(`UPDATE customer_asset_lifecycle_preferences SET email_enabled = 0, updated_at = ?
      WHERE customer_uid = ? AND asset_id = ?`).bind(now, delivery.customer_uid, delivery.asset_id));
  }
  await db.batch(statements);
  return Response.json({ ok: true });
}
