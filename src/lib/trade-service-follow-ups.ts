const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FollowUpReadiness = "eligible" | "too_early" | "missing_consent" | "withdrawn";

export function daysUntilIsoDate(dueAt: string, now = new Date()) {
  if (!ISO_DATE.test(dueAt)) throw new Error("INVALID_DATE");
  const due = Date.parse(`${dueAt}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((due - today) / 86_400_000);
}

export function serviceFollowUpDueState(dueAt: string, now = new Date()) {
  const days = daysUntilIsoDate(dueAt, now);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "upcoming";
}

export function serviceFollowUpReadiness(input: {
  customerUid: string;
  accountActive: boolean;
  accountConsent: boolean;
  preferenceExists: boolean;
  remindersEnabled: boolean;
  reminderLeadDays: number;
  dueAt: string;
  now?: Date;
}): FollowUpReadiness {
  if (!input.customerUid || !input.accountConsent || !input.preferenceExists) return "missing_consent";
  if (!input.accountActive || !input.remindersEnabled) return "withdrawn";
  return daysUntilIsoDate(input.dueAt, input.now) <= input.reminderLeadDays ? "eligible" : "too_early";
}

export function serviceReminderDraft(input: {
  businessName: string;
  brand: string;
  modelNumber: string;
  serviceType: string;
  dueAt: string;
  siteLabel: string;
}) {
  const service = input.serviceType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const asset = [input.brand, input.modelNumber].filter(Boolean).join(" ").slice(0, 180) || "installed asset";
  const site = input.siteLabel.slice(0, 120) || "your service site";
  const business = input.businessName.slice(0, 140) || "your installer";
  return {
    subject: `${service} due for ${asset}`.slice(0, 180),
    body: `Your ${asset} at ${site} is due for ${service.toLowerCase()} on ${input.dueAt}. Contact ${business} to discuss a suitable service appointment.`.slice(0, 800),
  };
}
