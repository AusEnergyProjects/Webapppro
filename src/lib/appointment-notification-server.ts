import { getD1 } from "../../db";
import {
  appointmentNotificationDraft,
  appointmentNotificationIdempotencyKey,
  appointmentNotificationSummary,
  type AppointmentNotificationAudience,
  type AppointmentNotificationEventType,
} from "@/lib/appointment-notifications";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
  serviceReminderRetryAt,
  type ReminderChannel,
} from "@/lib/service-reminder-delivery";

type QueueInput = {
  appointmentId: string;
  ownerUid: string;
  eventType: AppointmentNotificationEventType;
  appointmentRevision: number;
  origin: string;
  occurredAt?: string;
};

type Context = Record<string, unknown>;
type DeliveryRow = Record<string, unknown>;

function text(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function senderApproved() {
  return String(process.env.TLINK_SMS_SENDER_APPROVED || "").toLowerCase() === "true";
}

async function appointmentContext(appointmentId: string, ownerUid = "") {
  return getD1().prepare(`SELECT a.id appointment_id, a.work_order_id, a.firebase_uid installer_uid, a.revision appointment_revision,
      a.starts_at, a.ends_at, w.work_number, w.title, w.service_category,
      proposal.id proposal_id, proposal.project_id, proposal.customer_uid,
      customer.email customer_email, customer.account_updates, customer.account_status customer_account_status,
      trade.email installer_email, trade.business_name, trade.account_status installer_account_status,
      trade.email_opportunities, trade.consent_at installer_consent_at,
      EXISTS (SELECT 1 FROM customer_consent_receipts receipt WHERE receipt.firebase_uid = proposal.customer_uid
        AND receipt.purpose = 'customer_account' AND receipt.withdrawn_at = '') customer_account_consent,
      EXISTS (SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid = proposal.customer_uid
        AND optout.channel = 'email') customer_email_opted_out,
      EXISTS (SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid = proposal.customer_uid
        AND optout.channel = 'sms') customer_sms_opted_out,
      contact.mobile_e164 customer_mobile, contact.mobile_verified_at customer_mobile_verified_at
    FROM trade_crm_appointments a
    JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    JOIN customer_project_arrival_proposals proposal ON proposal.crm_appointment_id = a.id
      AND proposal.installer_uid = a.firebase_uid AND proposal.status = 'selected'
    JOIN customer_accounts customer ON customer.firebase_uid = proposal.customer_uid
    JOIN trade_accounts trade ON trade.firebase_uid = proposal.installer_uid
    LEFT JOIN customer_service_reminder_contacts contact ON contact.customer_uid = proposal.customer_uid
    WHERE a.id = ? AND (? = '' OR a.firebase_uid = ?) LIMIT 1`)
    .bind(appointmentId, ownerUid, ownerUid).first<Context>();
}

async function channelSetting(channel: ReminderChannel) {
  return getD1().prepare(`SELECT channel, provider, enabled, daily_limit FROM service_reminder_channel_settings WHERE channel = ?`)
    .bind(channel).first<Record<string, unknown>>();
}

async function dailyLimitAvailable(channel: ReminderChannel, dailyLimit: number) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const row = await getD1().prepare(`SELECT
      (SELECT COUNT(*) FROM service_reminder_deliveries WHERE channel = ? AND created_at >= ? AND status NOT IN ('skipped', 'opted_out')) +
      (SELECT COUNT(*) FROM appointment_notification_deliveries WHERE channel = ? AND created_at >= ? AND status NOT IN ('skipped', 'opted_out')) total`)
    .bind(channel, since.toISOString(), channel, since.toISOString()).first<Record<string, unknown>>();
  return Number(row?.total || 0) < dailyLimit;
}

function consentState(context: Context, audience: AppointmentNotificationAudience, channel: ReminderChannel) {
  if (audience === "installer") {
    if (channel !== "email") return { allowed: false, reason: "Installer SMS requires a separately verified operational contact." };
    const allowed = context.installer_account_status === "active" && Boolean(context.email_opportunities)
      && Boolean(context.installer_consent_at) && Boolean(context.installer_email);
    return { allowed, reason: allowed ? "" : "Installer operational email consent is not active." };
  }
  const accountAllowed = context.customer_account_status === "active" && Boolean(context.account_updates)
    && Boolean(context.customer_account_consent);
  if (!accountAllowed) return { allowed: false, reason: "Customer project-update consent is not active." };
  if (channel === "email") {
    const allowed = Boolean(context.customer_email) && !Boolean(context.customer_email_opted_out);
    return { allowed, reason: allowed ? "" : "Customer email is unavailable or opted out." };
  }
  const allowed = Boolean(context.customer_mobile) && Boolean(context.customer_mobile_verified_at) && !Boolean(context.customer_sms_opted_out);
  return { allowed, reason: allowed ? "" : "Customer SMS contact is unverified, unavailable or opted out." };
}

async function readiness(context: Context, audience: AppointmentNotificationAudience, channel: ReminderChannel) {
  const consent = consentState(context, audience, channel);
  if (!consent.allowed) return { status: "skipped", reason: consent.reason, provider: channel === "email" ? "resend" : "twilio" };
  const setting = await channelSetting(channel);
  const providers = serviceReminderProviderConfiguration();
  const configured = channel === "email" ? providers.email.configured && providers.email.callbacks
    : providers.sms.configured && providers.sms.callbacks;
  const provider = text(setting?.provider, 30) || (channel === "email" ? "resend" : "twilio");
  if (channel === "sms" && !senderApproved()) return { status: "waiting_for_sender", reason: "TLink Australian SMS sender approval is not confirmed.", provider };
  if (!setting || !Boolean(setting.enabled) || !configured) return { status: "waiting_for_channel", reason: "The delivery channel or authenticated callbacks are not active.", provider };
  if (!(await dailyLimitAvailable(channel, Number(setting.daily_limit || 1)))) return { status: "waiting_for_limit", reason: "The channel daily safety limit has been reached.", provider };
  return { status: "queued", reason: "", provider };
}

function recipient(context: Context, audience: AppointmentNotificationAudience, channel: ReminderChannel) {
  if (audience === "installer") return text(context.installer_email, 320);
  return channel === "email" ? text(context.customer_email, 320) : text(context.customer_mobile, 32);
}

async function dispatchDelivery(deliveryId: string, origin: string, retry = false) {
  const db = getD1();
  const delivery = await db.prepare(`SELECT delivery.*, event.installer_uid, event.customer_uid
    FROM appointment_notification_deliveries delivery
    JOIN appointment_notification_events event ON event.id = delivery.event_id
    WHERE delivery.id = ?`).bind(deliveryId).first<DeliveryRow>();
  if (!delivery) return { ok: false, error: "DELIVERY_NOT_FOUND" };
  const allowedStatuses = retry ? ["failed", "waiting_for_channel", "waiting_for_sender", "waiting_for_limit"] : ["queued"];
  if (!allowedStatuses.includes(String(delivery.status)) || Number(delivery.attempts) >= 3) return { ok: false, error: "DELIVERY_NOT_RETRYABLE" };
  const context = await appointmentContext(String(delivery.appointment_id), String(delivery.installer_uid));
  if (!context) return { ok: false, error: "APPOINTMENT_NOT_FOUND" };
  const channel = String(delivery.channel) as ReminderChannel; const audience = String(delivery.audience) as AppointmentNotificationAudience;
  const ready = await readiness(context, audience, channel); const now = new Date().toISOString();
  if (ready.status !== "queued") {
    await db.prepare(`UPDATE appointment_notification_deliveries SET status = ?, eligibility_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(ready.status, ready.reason, now, deliveryId).run();
    return { ok: false, error: ready.status };
  }
  const destination = recipient(context, audience, channel);
  if (!destination) return { ok: false, error: "RECIPIENT_UNAVAILABLE" };
  const attempts = Number(delivery.attempts || 0) + 1;
  const claim = await db.prepare(`UPDATE appointment_notification_deliveries SET status = 'sending', attempts = ?,
    eligibility_reason = '', updated_at = ? WHERE id = ? AND status = ? AND attempts = ?`)
    .bind(attempts, now, deliveryId, delivery.status, delivery.attempts).run();
  if (!claim.meta.changes) return { ok: false, error: "DELIVERY_ALREADY_CLAIMED" };
  try {
    const result = await sendServiceReminderProviderMessage({
      channel, recipient: destination, subject: String(delivery.subject), body: String(delivery.body),
      idempotencyKey: String(delivery.idempotency_key), messageType: "appointment_notification",
      callbackUrl: new URL("/api/service-reminder-provider-events/twilio", origin).toString(),
    });
    await db.batch([
      db.prepare(`UPDATE appointment_notification_deliveries SET status = 'sent', attempts = ?, provider = ?, provider_message_id = ?,
        provider_status = ?, eligibility_reason = '', last_error = '', sent_at = ?, updated_at = ? WHERE id = ?`)
        .bind(attempts, result.provider, result.providerMessageId, result.providerStatus, now, now, deliveryId),
      db.prepare(`INSERT INTO appointment_notification_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?, 'Provider accepted appointment notification.', ?, ?)`)
        .bind(crypto.randomUUID(), deliveryId, `accepted:${deliveryId}:${attempts}`, result.providerStatus, now, now),
    ]);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? text(error.message, 180) : "Provider delivery failed.";
    await db.prepare(`UPDATE appointment_notification_deliveries SET status = 'failed', attempts = ?, last_error = ?, failed_at = ?,
      eligibility_reason = '', updated_at = ? WHERE id = ?`).bind(attempts, reason, now, now, deliveryId).run();
    return { ok: false, error: reason, retryAt: serviceReminderRetryAt(attempts) };
  }
}

export async function queueAppointmentNotifications(input: QueueInput) {
  try {
    const db = getD1(); const context = await appointmentContext(input.appointmentId, input.ownerUid);
    if (!context) return { ok: true, matched: false, deliveries: 0 };
    const revision = Number(input.appointmentRevision || context.appointment_revision || 1);
    const eventKey = `appointment:${input.appointmentId}:${input.eventType}:${revision}`;
    const eventId = crypto.randomUUID(); const now = input.occurredAt || new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO appointment_notification_events
      (id, event_key, appointment_id, work_order_id, proposal_id, project_id, installer_uid, customer_uid,
       event_type, appointment_revision, starts_at, ends_at, summary, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(eventId, eventKey, input.appointmentId, context.work_order_id, context.proposal_id, context.project_id,
        context.installer_uid, context.customer_uid, input.eventType, revision, context.starts_at, context.ends_at,
        appointmentNotificationSummary(input.eventType, String(context.starts_at)), now, now).run();
    const event = await db.prepare("SELECT id FROM appointment_notification_events WHERE event_key = ?").bind(eventKey).first<Record<string, unknown>>();
    if (!event) throw new Error("APPOINTMENT_EVENT_NOT_RECORDED");
    const channels: Array<{ audience: AppointmentNotificationAudience; channel: ReminderChannel }> = [
      { audience: "customer", channel: "email" }, { audience: "customer", channel: "sms" }, { audience: "installer", channel: "email" },
    ];
    const deliveryIds: string[] = [];
    for (const item of channels) {
      const state = await readiness(context, item.audience, item.channel);
      const draft = appointmentNotificationDraft({ eventType: input.eventType, audience: item.audience,
        businessName: String(context.business_name), workNumber: String(context.work_number),
        startsAt: String(context.starts_at), endsAt: String(context.ends_at) });
      const idempotencyKey = await appointmentNotificationIdempotencyKey(eventKey, item.audience, item.channel);
      const deliveryId = crypto.randomUUID();
      await db.prepare(`INSERT OR IGNORE INTO appointment_notification_deliveries
        (id, event_id, appointment_id, audience, recipient_uid, channel, provider, content_revision, subject, body,
         idempotency_key, status, eligibility_reason, attempts, provider_message_id, queued_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
        .bind(deliveryId, event.id, input.appointmentId, item.audience,
          item.audience === "customer" ? context.customer_uid : context.installer_uid, item.channel, state.provider,
          revision, draft.subject, draft.body, idempotencyKey, state.status, state.reason, deliveryId, now, now, now).run();
      const stored = await db.prepare("SELECT id, status, attempts FROM appointment_notification_deliveries WHERE idempotency_key = ?")
        .bind(idempotencyKey).first<Record<string, unknown>>();
      if (stored && stored.status === "queued" && Number(stored.attempts) === 0) deliveryIds.push(String(stored.id));
    }
    await Promise.all(deliveryIds.map((id) => dispatchDelivery(id, input.origin)));
    return { ok: true, matched: true, deliveries: channels.length };
  } catch (error) {
    console.error("Appointment notification recording failed", error instanceof Error ? error.message : "unknown error");
    return { ok: false, matched: false, deliveries: 0 };
  }
}

export async function retryAppointmentNotificationDelivery(deliveryId: string, origin: string) {
  return dispatchDelivery(deliveryId, origin, true);
}
