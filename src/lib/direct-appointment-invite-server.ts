import { getD1 } from "../../db";
import { australianAppointmentTimeZone, textAttachment } from "@/lib/customer-appointment-calendar";
import { directAppointmentInviteDraft } from "@/lib/direct-appointment-invite";
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from "@/lib/service-reminder-delivery";

type InviteStatus = "accepted" | "failed" | "unavailable";

export type DirectAppointmentInviteResult = {
  requested: true;
  status: InviteStatus;
  message: string;
};

function customerName(row: Record<string, unknown>) {
  return String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "there");
}

async function idempotencyKey(appointmentId: string, revision: number) {
  const bytes = new TextEncoder().encode(`tlink-direct-appointment-invite|${appointmentId}|${revision}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sendDirectAppointmentCalendarInvite(input: {
  appointmentId: string;
  ownerUid: string;
  origin: string;
}): Promise<DirectAppointmentInviteResult> {
  const configuration = serviceReminderProviderConfiguration();
  if (!configuration.email.configured) {
    return { requested: true, status: "unavailable", message: "Email delivery is not configured." };
  }
  const row = await getD1().prepare(`SELECT a.id appointment_id, a.revision, a.starts_at, a.ends_at,
      w.work_number, detail.crm_customer_id, customer.customer_type, customer.first_name, customer.last_name,
      customer.business_name, customer.email customer_email, site.address_state,
      trade.business_name trade_business_name
    FROM trade_crm_appointments a
    JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    JOIN trade_crm_job_details detail ON detail.work_order_id = w.id AND detail.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers customer ON customer.id = detail.crm_customer_id
      AND customer.firebase_uid = w.firebase_uid AND customer.record_status = 'active'
    JOIN trade_crm_service_sites site ON site.id = detail.service_site_id
      AND site.firebase_uid = w.firebase_uid AND site.record_status = 'active'
    JOIN trade_accounts trade ON trade.firebase_uid = w.firebase_uid
    WHERE a.id = ? AND a.firebase_uid = ? AND a.status = 'scheduled'
      AND w.record_status = 'active' LIMIT 1`).bind(input.appointmentId, input.ownerUid).first<Record<string, unknown>>();
  if (!row) return { requested: true, status: "unavailable", message: "The saved appointment could not be loaded for email." };
  const recipient = String(row.customer_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { requested: true, status: "unavailable", message: "The selected customer does not have a valid email address." };
  }
  const draft = directAppointmentInviteDraft({
    workNumber: String(row.work_number || ""),
    businessName: String(row.trade_business_name || "Trade professional"),
    customerName: customerName(row),
    customerEmail: recipient,
    organizerEmail: configuration.email.from,
    startsAt: String(row.starts_at || ""),
    endsAt: String(row.ends_at || ""),
    timeZone: australianAppointmentTimeZone(row.address_state),
    sequence: Number(row.revision || 1) - 1,
  });
  if (!draft) return { requested: true, status: "unavailable", message: "The saved appointment time could not be added to a calendar." };
  try {
    await sendServiceReminderProviderMessage({
      channel: "email",
      recipient,
      subject: draft.subject,
      body: draft.body,
      html: draft.html,
      idempotencyKey: await idempotencyKey(input.appointmentId, Number(row.revision || 1)),
      messageType: "tlink_direct_appointment_invite",
      attachments: [textAttachment(
        draft.calendar.filename,
        draft.calendar.ics,
        `text/calendar; charset=utf-8; method=${draft.calendar.method}`,
      )],
      callbackUrl: new URL("/api/service-reminder-provider-events/twilio", input.origin).toString(),
    }, {
      fetchImpl: (resource, init) => fetch(resource, { ...init, signal: AbortSignal.timeout(8_000) }),
    });
    return { requested: true, status: "accepted", message: "The calendar invite was accepted for delivery." };
  } catch {
    return { requested: true, status: "failed", message: "The job was saved, but the calendar invite could not be sent." };
  }
}
