import { customerAppointmentCalendar } from "./customer-appointment-calendar.ts";

type DirectAppointmentInviteInput = {
  workNumber: string;
  businessName: string;
  customerName: string;
  customerEmail: string;
  organizerEmail: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  sequence?: number;
};

function bounded(value: unknown, maximum: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function directAppointmentDisplayTime(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "the booked time";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const hour24 = Number(match[4]);
  const period = hour24 < 12 ? "am" : "pm";
  const hour = hour24 % 12 || 12;
  return `${dateLabel} at ${hour}:${match[5]} ${period}`;
}

export function directAppointmentInviteDraft(input: DirectAppointmentInviteInput) {
  const workNumber = bounded(input.workNumber, 40) || "TLink job";
  const businessName = bounded(input.businessName, 120) || "Your trade professional";
  const customerName = bounded(input.customerName, 120) || "there";
  const appointmentTime = directAppointmentDisplayTime(input.startsAt);
  const calendar = customerAppointmentCalendar({
    workNumber,
    businessName,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: input.timeZone,
    attendeeEmail: input.customerEmail,
    organizerEmail: input.organizerEmail,
    sequence: input.sequence,
    productName: "TLink",
  });
  if (!calendar) return null;
  const subject = `Your ${businessName} appointment | ${workNumber}`.slice(0, 160);
  const body = [
    `Hi ${customerName},`,
    "",
    `Your appointment with ${businessName} is booked for ${appointmentTime}.`,
    `TLink job reference: ${workNumber}`,
    "",
    `Add to Google Calendar: ${calendar.googleUrl}`,
    "",
    "A calendar file is attached so you can add the booking to your phone or calendar app.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#06131f;color:#f3faf8;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#06131f"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0b2030;border:1px solid #294657;border-radius:20px;overflow:hidden"><tr><td style="padding:28px 30px 12px;color:#54e3b2;font-size:22px;font-weight:800">TLink</td></tr><tr><td style="padding:8px 30px 30px"><p style="margin:0 0 10px;color:#9ab0b5;font-size:13px;font-weight:700;letter-spacing:1px">APPOINTMENT CONFIRMED</p><h1 style="margin:0 0 18px;color:#f3faf8;font-size:30px;line-height:1.2">Your booking is ready</h1><p style="margin:0 0 16px;color:#d9e7e4;font-size:17px;line-height:1.55">Hi ${escapeHtml(customerName)}, your appointment with <strong>${escapeHtml(businessName)}</strong> is booked.</p><div style="margin:22px 0;padding:20px;background:#10293a;border-radius:14px"><p style="margin:0 0 8px;color:#54e3b2;font-size:13px;font-weight:800">WHEN</p><p style="margin:0;color:#f3faf8;font-size:19px;font-weight:700">${escapeHtml(appointmentTime)}</p><p style="margin:14px 0 0;color:#9ab0b5;font-size:14px">TLink job reference ${escapeHtml(workNumber)}</p></div><p style="margin:24px 0"><a href="${escapeHtml(calendar.googleUrl)}" style="display:inline-block;background:#54e3b2;color:#06131f;text-decoration:none;font-size:16px;font-weight:800;padding:14px 20px;border-radius:12px">Add to Google Calendar</a></p><p style="margin:0;color:#9ab0b5;font-size:14px;line-height:1.5">The attached calendar file also works with Samsung Calendar, Apple Calendar, Outlook and other calendar apps.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, body, html, calendar };
}
