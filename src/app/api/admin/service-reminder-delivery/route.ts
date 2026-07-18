import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { serviceReminderProviderConfiguration } from "@/lib/service-reminder-delivery";
import { retryAppointmentNotificationDelivery } from "@/lib/appointment-notification-server";

export const runtime = "edge";

async function payload() {
  const db = getD1(); const providers = serviceReminderProviderConfiguration();
  const [settings, counts, failures, appointmentCounts, appointmentDeliveries] = await Promise.all([
    db.prepare(`SELECT channel, provider, enabled, sender_label, daily_limit, revision, updated_at
      FROM service_reminder_channel_settings ORDER BY channel`).all<Record<string, unknown>>(),
    db.prepare(`SELECT channel, status, COUNT(*) total FROM service_reminder_deliveries GROUP BY channel, status`).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, channel, provider, status, attempts, provider_status, last_error, updated_at
      FROM service_reminder_deliveries WHERE status IN ('failed', 'bounced', 'opted_out') ORDER BY updated_at DESC LIMIT 30`).all<Record<string, unknown>>(),
    db.prepare(`SELECT audience, channel, status, COUNT(*) total FROM appointment_notification_deliveries
      GROUP BY audience, channel, status ORDER BY audience, channel, status`).all<Record<string, unknown>>(),
    db.prepare(`SELECT delivery.id, event.event_type, delivery.audience, delivery.channel, delivery.provider,
      delivery.status, delivery.eligibility_reason, delivery.attempts, delivery.provider_status,
      delivery.last_error, delivery.updated_at
      FROM appointment_notification_deliveries delivery
      JOIN appointment_notification_events event ON event.id = delivery.event_id
      ORDER BY delivery.updated_at DESC LIMIT 50`).all<Record<string, unknown>>(),
  ]);
  return {
    settings: settings.results.map((row) => ({ channel: String(row.channel), provider: String(row.provider), enabled: Boolean(row.enabled),
      configured: row.channel === "email" ? providers.email.configured && providers.email.callbacks : providers.sms.configured && providers.sms.callbacks,
      senderLabel: String(row.sender_label), dailyLimit: Number(row.daily_limit), revision: Number(row.revision), updatedAt: String(row.updated_at) })),
    counts: counts.results.map((row) => ({ channel: String(row.channel), status: String(row.status), total: Number(row.total) })),
    failures: failures.results.map((row) => ({ id: String(row.id), channel: String(row.channel), provider: String(row.provider),
      status: String(row.status), attempts: Number(row.attempts), providerStatus: String(row.provider_status),
      lastError: String(row.last_error), updatedAt: String(row.updated_at) })),
    appointmentCounts: appointmentCounts.results.map((row) => ({ audience: String(row.audience), channel: String(row.channel),
      status: String(row.status), total: Number(row.total) })),
    appointmentDeliveries: appointmentDeliveries.results.map((row) => ({ id: String(row.id), eventType: String(row.event_type),
      audience: String(row.audience), channel: String(row.channel), provider: String(row.provider), status: String(row.status),
      eligibilityReason: String(row.eligibility_reason), attempts: Number(row.attempts), providerStatus: String(row.provider_status),
      lastError: String(row.last_error), updatedAt: String(row.updated_at) })),
    smsSenderApproved: String(process.env.TLINK_SMS_SENDER_APPROVED || "").toLowerCase() === "true",
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { await requireAdminIdentity(request, ["owner", "admin"]); return adminJson({ ok: true, ...(await payload()) }); }
  catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner"]); const body = await request.json() as Record<string, unknown>;
    const channel = cleanAdminText(body.channel, 10); const enabled = Boolean(body.enabled);
    if (channel !== "email" && channel !== "sms") return adminJson({ ok: false, error: "Choose email or SMS." }, 400);
    const dailyLimit = Math.floor(Number(body.dailyLimit)); if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) return adminJson({ ok: false, error: "Choose a daily limit from 1 to 1000." }, 400);
    const senderLabel = cleanAdminText(body.senderLabel, 80) || "Australian Energy Assessments";
    const providers = serviceReminderProviderConfiguration(); const configured = channel === "email"
      ? providers.email.configured && providers.email.callbacks : providers.sms.configured && providers.sms.callbacks;
    if (enabled && !configured) return adminJson({ ok: false, error: "Add and verify the provider credentials and callbacks before enabling this channel." }, 409);
    const db = getD1(); const current = await db.prepare("SELECT revision FROM service_reminder_channel_settings WHERE channel = ?").bind(channel).first<Record<string, unknown>>();
    if (!current || Number(current.revision) !== Number(body.expectedRevision)) return adminJson({ ok: false, error: "The channel settings changed. Refresh before saving again." }, 409);
    const now = new Date().toISOString(); const result = await db.prepare(`UPDATE service_reminder_channel_settings SET enabled = ?, sender_label = ?,
      daily_limit = ?, revision = revision + 1, updated_by_uid = ?, updated_at = ? WHERE channel = ? AND revision = ?`)
      .bind(enabled ? 1 : 0, senderLabel, dailyLimit, admin.uid, now, channel, current.revision).run();
    if (!result.meta.changes) return adminJson({ ok: false, error: "The channel settings changed. Refresh before saving again." }, 409);
    await writeAdminAudit(admin, "service_reminder.channel_update", "service_reminder_channel", channel,
      `${enabled ? "Enabled" : "Disabled"} ${channel} service reminder delivery with a daily limit of ${dailyLimit}.`, { channel, enabled, dailyLimit });
    return adminJson({ ok: true, ...(await payload()) });
  } catch (error) { return error instanceof SyntaxError ? adminJson({ ok: false, error: "Invalid channel settings." }, 400) : adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]); const body = await request.json() as Record<string, unknown>;
    if (cleanAdminText(body.action, 40) !== "retry_appointment_delivery") return adminJson({ ok: false, error: "Unsupported delivery action." }, 400);
    const deliveryId = cleanAdminText(body.deliveryId, 180); if (!deliveryId) return adminJson({ ok: false, error: "Choose an appointment delivery." }, 400);
    const result = await retryAppointmentNotificationDelivery(deliveryId, new URL(request.url).origin);
    if (!result.ok && result.error === "DELIVERY_NOT_RETRYABLE") return adminJson({ ok: false, error: "This appointment delivery cannot be retried." }, 409);
    if (!result.ok && result.error === "DELIVERY_NOT_FOUND") return adminJson({ ok: false, error: "Appointment delivery not found." }, 404);
    await writeAdminAudit(admin, "appointment_notification.delivery_retry", "appointment_notification_delivery", deliveryId,
      "Retried an appointment notification through current consent and channel controls.", { deliveryId, result: result.ok ? "sent" : String(result.error || "held") });
    return adminJson({ ok: true, ...(await payload()) });
  } catch (error) { return error instanceof SyntaxError ? adminJson({ ok: false, error: "Invalid appointment delivery request." }, 400) : adminError(error); }
}
