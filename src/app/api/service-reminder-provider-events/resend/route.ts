import { getD1 } from "../../../../../db";
import { verifyResendWebhook } from "@/lib/service-reminder-delivery";
import { QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL } from "@/lib/trade-quick-invoice-server";

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
  const quickInvoiceDelivery = serviceDelivery || appointmentDelivery || photoDelivery || quoteDelivery ? null
    : await db.prepare(`SELECT id, work_order_id, firebase_uid, delivery_status status
      FROM trade_crm_quick_invoices
      WHERE delivery_provider = 'resend' AND provider_message_id = ?`)
      .bind(providerMessageId).first<Record<string, unknown>>();
  const opportunityDelivery = serviceDelivery || appointmentDelivery || photoDelivery || quoteDelivery || quickInvoiceDelivery ? null : await db.prepare(`SELECT id, status, recipient_email_hash
    FROM trade_opportunity_notification_deliveries WHERE provider = 'resend' AND provider_message_id = ?`)
    .bind(providerMessageId).first<Record<string, unknown>>();
  const activityDelivery = serviceDelivery || appointmentDelivery || photoDelivery || quoteDelivery || quickInvoiceDelivery || opportunityDelivery ? null
    : await db.prepare(`SELECT id, audience, recipient_uid, status, recipient_email_hash
      FROM customer_project_activity_deliveries
      WHERE provider = 'resend' AND provider_message_id = ?`)
      .bind(providerMessageId).first<Record<string, unknown>>();
  const delivery = serviceDelivery || appointmentDelivery || photoDelivery || quoteDelivery
    || quickInvoiceDelivery || opportunityDelivery || activityDelivery;
  if (!delivery) {
    return Response.json(
      {
        ok: false,
        retryable: true,
        error: "Delivery binding is not ready.",
      },
      {
        status: 503,
        headers: { "Retry-After": "5" },
      },
    );
  }
  const providerEventKey = `resend:${eventId}`;
  const replayTable = serviceDelivery ? "service_reminder_delivery_events" : appointmentDelivery ? "appointment_notification_delivery_events"
    : photoDelivery ? "trade_crm_photo_request_delivery_events"
      : opportunityDelivery ? "trade_opportunity_notification_delivery_events"
        : activityDelivery ? "customer_project_activity_delivery_events" : "";
  const quickInvoiceEventId = `quick-invoice-provider:${providerEventKey}`;
  const replay = quickInvoiceDelivery
    ? await db.prepare("SELECT id FROM trade_work_order_events WHERE id = ?").bind(quickInvoiceEventId).first()
    : quoteDelivery
      ? await db.prepare("SELECT id FROM trade_crm_quote_events WHERE evidence_key = ?").bind(providerEventKey).first()
      : await db.prepare(`SELECT id FROM ${replayTable} WHERE provider_event_key = ?`).bind(providerEventKey).first();
  if (replay) return Response.json({ ok: true, replay: true });
  const now = new Date().toISOString(); const terminal = ["bounced", "failed", "opted_out"].includes(status);
  const opportunityStatus = eventType === "email.complained" ? "complained"
    : eventType === "email.failed" ? "provider_failed" : status;
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
  ] : quickInvoiceDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, work_order_id, firebase_uid, ?, ?, ?
      FROM trade_crm_quick_invoices
      WHERE id = ? AND firebase_uid = ? AND delivery_provider = 'resend' AND provider_message_id = ?`)
      .bind(
        quickInvoiceEventId,
        `quick_invoice_${status}`,
        `Authenticated Resend invoice delivery event received: ${eventType}.`,
        now,
        quickInvoiceDelivery.id,
        quickInvoiceDelivery.firebase_uid,
        providerMessageId,
      ),
    db.prepare(QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL)
      .bind(
        status,
        status,
        status,
        status,
        status,
        status,
        eventType.slice(0, 120),
        status,
        eventType.slice(0, 120),
        status,
        now,
        quickInvoiceDelivery.id,
        quickInvoiceDelivery.firebase_uid,
        providerMessageId,
      ),
  ] : activityDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO customer_project_activity_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'Authenticated Resend project activity delivery event received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, providerEventKey, eventType, opportunityStatus, String(event.created_at || now), now),
    db.prepare(`UPDATE customer_project_activity_deliveries
      SET status = CASE
          WHEN status IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN status
          WHEN ? IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN ?
          WHEN status = 'delivered' THEN status
          WHEN status = 'provider_failed' THEN status
          WHEN ? = 'delivered' THEN ?
          WHEN ? = 'provider_failed' THEN ?
          ELSE ?
        END,
        provider_status = CASE
          WHEN status IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          WHEN status = 'delivered' AND ? NOT IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          WHEN status = 'provider_failed' AND ? NOT IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          ELSE ?
        END,
        delivered_at = CASE
          WHEN ? = 'delivered' AND status NOT IN ('delivered', 'provider_failed', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ? ELSE delivered_at END,
        failed_at = CASE
          WHEN ? = 1 AND status NOT IN ('delivered', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ? ELSE failed_at END,
        last_error = CASE
          WHEN ? = 1 AND status NOT IN ('delivered', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ?
          WHEN ? = 'delivered' AND status NOT IN ('delivered', 'provider_failed', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ''
          ELSE last_error
        END,
        updated_at = ? WHERE id = ?`)
      .bind(
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        eventType,
        opportunityStatus,
        now,
        terminal ? 1 : 0,
        now,
        terminal ? 1 : 0,
        eventType.slice(0, 120),
        opportunityStatus,
        now,
        delivery.id,
      ),
  ] : opportunityDelivery ? [
    db.prepare(`INSERT OR IGNORE INTO trade_opportunity_notification_delivery_events
      (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'Authenticated Resend opportunity delivery event received.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, providerEventKey, eventType, opportunityStatus, String(event.created_at || now), now),
    db.prepare(`UPDATE trade_opportunity_notification_deliveries
      SET status = CASE
          WHEN status IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN status
          WHEN ? IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN ?
          WHEN status = 'delivered' THEN status
          WHEN status = 'provider_failed' THEN status
          WHEN ? = 'delivered' THEN ?
          WHEN ? = 'provider_failed' THEN ?
          ELSE ?
        END,
        provider_status = CASE
          WHEN status IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          WHEN status = 'delivered' AND ? NOT IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          WHEN status = 'provider_failed' AND ? NOT IN ('bounced', 'complained', 'opted_out', 'suppressed') THEN provider_status
          ELSE ?
        END,
        delivered_at = CASE
          WHEN ? = 'delivered' AND status NOT IN ('delivered', 'provider_failed', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ? ELSE delivered_at END,
        failed_at = CASE
          WHEN ? = 1 AND status NOT IN ('delivered', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ? ELSE failed_at END,
        last_error = CASE
          WHEN ? = 1 AND status NOT IN ('delivered', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ?
          WHEN ? = 'delivered' AND status NOT IN ('delivered', 'provider_failed', 'bounced', 'complained', 'opted_out', 'suppressed')
          THEN ''
          ELSE last_error
        END,
        updated_at = ? WHERE id = ?`)
      .bind(
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        opportunityStatus,
        eventType,
        opportunityStatus,
        now,
        terminal ? 1 : 0,
        now,
        terminal ? 1 : 0,
        eventType.slice(0, 120),
        opportunityStatus,
        now,
        delivery.id,
      ),
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
    const activityCustomerUid = activityDelivery?.audience === "customer"
      ? String(activityDelivery.recipient_uid || "")
      : "";
    const optedOutCustomerUid = String(delivery.customer_uid || activityCustomerUid);
    if ((serviceDelivery || appointmentDelivery?.audience === "customer" || photoDelivery || activityCustomerUid)
      && optedOutCustomerUid) statements.push(
      db.prepare(`INSERT INTO customer_service_reminder_opt_outs (id, customer_uid, channel, source, provider_reference, opted_out_at, created_at)
        VALUES (?, ?, 'email', ?, ?, ?, ?) ON CONFLICT(customer_uid, channel) DO UPDATE SET source = excluded.source,
        provider_reference = excluded.provider_reference, opted_out_at = excluded.opted_out_at`)
        .bind(crypto.randomUUID(), optedOutCustomerUid, eventType, providerMessageId, now, now),
      db.prepare(`UPDATE service_reminder_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE customer_uid = ? AND channel = 'email' AND status IN ('queued', 'failed')`).bind(eventType, now, now, optedOutCustomerUid),
      db.prepare(`UPDATE appointment_notification_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE recipient_uid = ? AND audience = 'customer' AND channel = 'email' AND status IN ('queued', 'failed', 'waiting_for_channel')`)
        .bind(eventType, now, now, optedOutCustomerUid),
      db.prepare(`UPDATE trade_crm_photo_request_deliveries SET status = 'opted_out', provider_status = ?, failed_at = ?, updated_at = ?
        WHERE customer_uid = ? AND channel = 'email'
          AND status IN ('queued', 'failed', 'waiting_for_channel', 'waiting_for_limit')`)
        .bind(eventType, now, now, optedOutCustomerUid),
      db.prepare(`UPDATE customer_project_activity_deliveries
        SET status = 'opted_out', provider_status = ?, failed_at = ?, next_attempt_at = '',
          eligibility_reason = 'The customer opted out through the email provider.', updated_at = ?
        WHERE recipient_uid = ? AND audience = 'customer' AND channel = 'email'
          AND status IN ('pending', 'failed', 'provider_failed', 'waiting_for_channel')`)
        .bind(eventType, now, now, optedOutCustomerUid),
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
  if (opportunityDelivery && ["email.bounced", "email.complained", "email.suppressed"].includes(eventType)
    && String(opportunityDelivery.recipient_email_hash || "")) {
    statements.push(
      db.prepare(`INSERT INTO trade_opportunity_email_suppressions
        (email_hash, reason, provider, provider_status, provider_message_id, suppressed_at, created_at, updated_at)
        VALUES (?, ?, 'resend', ?, ?, ?, ?, ?)
        ON CONFLICT(email_hash) DO UPDATE SET reason = excluded.reason, provider_status = excluded.provider_status,
          provider_message_id = excluded.provider_message_id, suppressed_at = excluded.suppressed_at,
          updated_at = excluded.updated_at`)
        .bind(opportunityDelivery.recipient_email_hash, eventType, eventType, providerMessageId, now, now, now),
      db.prepare(`UPDATE trade_opportunity_notification_deliveries
        SET status = 'suppressed', eligibility_reason = 'Provider suppression applies to the current business email.',
          provider_status = ?, next_attempt_at = '', updated_at = ?
        WHERE recipient_email_hash = ? AND id != ?
          AND status IN ('pending', 'failed', 'provider_failed', 'waiting_for_channel')`)
        .bind(eventType, now, opportunityDelivery.recipient_email_hash, opportunityDelivery.id),
    );
  }
  if (activityDelivery?.audience === "installer"
    && ["email.bounced", "email.complained", "email.suppressed"].includes(eventType)
    && String(activityDelivery.recipient_email_hash || "")) {
    statements.push(
      db.prepare(`INSERT INTO trade_opportunity_email_suppressions
        (email_hash, reason, provider, provider_status, provider_message_id, suppressed_at, created_at, updated_at)
        VALUES (?, ?, 'resend', ?, ?, ?, ?, ?)
        ON CONFLICT(email_hash) DO UPDATE SET reason = excluded.reason, provider_status = excluded.provider_status,
          provider_message_id = excluded.provider_message_id, suppressed_at = excluded.suppressed_at,
          updated_at = excluded.updated_at`)
        .bind(activityDelivery.recipient_email_hash, eventType, eventType, providerMessageId, now, now, now),
      db.prepare(`UPDATE customer_project_activity_deliveries
        SET status = 'suppressed', eligibility_reason = 'Provider suppression applies to the current business email.',
          provider_status = ?, next_attempt_at = '', updated_at = ?
        WHERE recipient_email_hash = ? AND id != ?
          AND status IN ('pending', 'failed', 'provider_failed', 'waiting_for_channel')`)
        .bind(eventType, now, activityDelivery.recipient_email_hash, activityDelivery.id),
    );
  }
  await db.batch(statements);
  return Response.json({ ok: true });
}
