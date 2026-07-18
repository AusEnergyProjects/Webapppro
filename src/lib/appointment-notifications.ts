import type { ReminderChannel } from "@/lib/service-reminder-delivery";

export type AppointmentNotificationEventType = "appointment_created" | "staff_assigned" | "appointment_changed" | "preparation_confirmed";
export type AppointmentNotificationAudience = "customer" | "installer";

type DraftInput = {
  eventType: AppointmentNotificationEventType;
  audience: AppointmentNotificationAudience;
  businessName: string;
  workNumber: string;
  startsAt: string;
  endsAt: string;
};

const eventLabels: Record<AppointmentNotificationEventType, string> = {
  appointment_created: "Appointment created",
  staff_assigned: "Appointment reviewed",
  appointment_changed: "Appointment changed",
  preparation_confirmed: "Site preparation confirmed",
};

function bounded(value: unknown, maximum: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function appointmentWindow(startsAt: string, endsAt: string) {
  return `${bounded(startsAt, 30)} to ${bounded(endsAt, 30)}`;
}

export function appointmentNotificationDraft(input: DraftInput) {
  const business = bounded(input.businessName, 120) || "your installer";
  const work = bounded(input.workNumber, 40) || "your project";
  const window = appointmentWindow(input.startsAt, input.endsAt);
  const customerBody: Record<AppointmentNotificationEventType, string> = {
    appointment_created: `Your appointment with ${business} is scheduled for ${window}. Sign in to TLink to review the current appointment and preparation checklist.`,
    staff_assigned: `Your appointment with ${business} has been reviewed for ${window}. Internal staff and capacity details remain private. Sign in to TLink for the current appointment.`,
    appointment_changed: `Your appointment with ${business} has changed to ${window}. Any earlier preparation confirmation has been cleared so you can review the current time.`,
    preparation_confirmed: `Your site preparation confirmation for the ${window} appointment with ${business} has been recorded.`,
  };
  const installerBody: Record<AppointmentNotificationEventType, string> = {
    appointment_created: `${work} now has a customer-selected appointment for ${window}. Assign staff and complete conflict review in TLink before attendance.`,
    staff_assigned: `${work} has completed staff assignment and schedule review for ${window}. Customer contact and private dispatch details remain in their authorised workspaces.`,
    appointment_changed: `${work} has an authorised appointment change to ${window}. The customer preparation acknowledgement has been reset for the revised time.`,
    preparation_confirmed: `The customer confirmed the bounded site-preparation checklist for ${work} and the ${window} appointment.`,
  };
  return {
    subject: `${eventLabels[input.eventType]} | ${input.audience === "customer" ? business : work}`.slice(0, 160),
    body: (input.audience === "customer" ? customerBody[input.eventType] : installerBody[input.eventType]).slice(0, 1200),
  };
}

export function appointmentNotificationSummary(eventType: AppointmentNotificationEventType, startsAt: string) {
  return `${eventLabels[eventType]} for ${bounded(startsAt, 30)}.`;
}

export async function appointmentNotificationIdempotencyKey(eventKey: string, audience: AppointmentNotificationAudience, channel: ReminderChannel) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${eventKey}|${audience}|${channel}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
