import { smsSegments, tradeSmsBody } from "./trade-sms.ts";
import { followUpAppointmentEpoch } from "./trade-follow-ups.ts";
import { SMS_PART_PRICE_MICRO } from "./trade-sms-billing.ts";

export const SMS_AUTOMATION_KINDS = ["appointment_reminder", "appointment_follow_up", "review_request"] as const;
export type SmsAutomationKind = typeof SMS_AUTOMATION_KINDS[number];
export type SmsAutomationRule = { kind: SmsAutomationKind; enabled: boolean; delayHours: number; body: string; reviewUrl: string; revision?: number; enabledAt?: string };
export const SMS_AUTOMATION_LABELS: Record<SmsAutomationKind, string> = {
  appointment_reminder: "Appointment reminder", appointment_follow_up: "After-visit follow-up", review_request: "Feedback and reviews",
};
export const SMS_AUTOMATION_FIELDS: Record<string, string> = {
  customer_first_name: "Customer first name", appointment_date: "Appointment date", appointment_time: "Appointment time",
  job_number: "Job number", job_title: "Job title", review_url: "Review link",
};
export const DEFAULT_SMS_AUTOMATION_RULES: SmsAutomationRule[] = [
  { kind: "appointment_reminder", enabled: false, delayHours: 24, reviewUrl: "", body: "Hi {customer_first_name}, a reminder of your appointment on {appointment_date} at {appointment_time}. Please reply if you need to change your booking." },
  { kind: "appointment_follow_up", enabled: false, delayHours: 168, reviewUrl: "", body: "Hi {customer_first_name}, checking in after our visit for {job_title}. Is everything working as expected? Reply if you need any help." },
  { kind: "review_request", enabled: false, delayHours: 168, reviewUrl: "", body: "Hi {customer_first_name}, thank you for choosing us. We would love your honest feedback: {review_url}" },
];
export function isSmsAutomationKind(value: unknown): value is SmsAutomationKind {
  return typeof value === "string" && SMS_AUTOMATION_KINDS.some(kind => kind === value);
}
export function parseSmsAutomationRules(value: unknown): SmsAutomationRule[] {
  if (!Array.isArray(value) || value.length !== SMS_AUTOMATION_KINDS.length) throw new Error("SMS_AUTOMATION_INVALID");
  const seen = new Set<SmsAutomationKind>();
  return value.map((input: unknown) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("SMS_AUTOMATION_INVALID");
    const v = input as Record<string, unknown>;
    if (!isSmsAutomationKind(v.kind) || seen.has(v.kind) || typeof v.enabled !== "boolean"
      || typeof v.delayHours !== "number" || !Number.isSafeInteger(v.delayHours) || v.delayHours < 1 || v.delayHours > 1008
      || typeof v.body !== "string" || !v.body.trim() || v.body.length > 480 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v.body)
      || typeof v.reviewUrl !== "string" || v.reviewUrl.length > 1000) throw new Error("SMS_AUTOMATION_INVALID");
    for (const match of v.body.matchAll(/\{([^{}]+)\}/g)) {
      if (!Object.hasOwn(SMS_AUTOMATION_FIELDS, match[1]) || (match[1] === "review_url" && v.kind !== "review_request")) throw new Error("SMS_AUTOMATION_FIELD_INVALID");
    }
    const reviewUrl = v.reviewUrl.trim();
    if (reviewUrl) {
      let url: URL;
      try { url = new URL(reviewUrl); } catch { throw new Error("SMS_AUTOMATION_REVIEW_URL_INVALID"); }
      if (url.protocol !== "https:" || url.username || url.password || /[\s\u0000-\u001f\u007f]/.test(reviewUrl)) throw new Error("SMS_AUTOMATION_REVIEW_URL_INVALID");
    }
    if (v.kind === "review_request" && v.enabled && (!reviewUrl || !v.body.includes("{review_url}"))) throw new Error("SMS_AUTOMATION_REVIEW_URL_REQUIRED");
    seen.add(v.kind);
    return { kind: v.kind, enabled: v.enabled, delayHours: v.delayHours, body: v.body.trim(), reviewUrl: v.kind === "review_request" ? reviewUrl : "" };
  });
}
export function smsAutomationDueAt(kind: SmsAutomationKind, startsAt: string, timeZone: string, delayHours: number) {
  const epoch = followUpAppointmentEpoch(startsAt, timeZone);
  return epoch + delayHours * 3600000 * (kind === "appointment_reminder" ? -1 : 1);
}
export function renderSmsAutomation(rule: SmsAutomationRule, fields: Record<string, string>) {
  const missing = new Set<string>();
  const body = rule.body.replace(/\{([^{}]+)\}/g, (token, key: string) => {
    const value = key === "review_url" ? rule.reviewUrl : Object.hasOwn(fields, key) ? fields[key] : "";
    if (!Object.hasOwn(SMS_AUTOMATION_FIELDS, key) || !value) { missing.add(SMS_AUTOMATION_FIELDS[key] || key); return token; }
    return value;
  });
  if (body.length > 480) missing.add("A message of no more than 480 characters after details are filled in");
  return { body, missing: [...missing] };
}
export function smsAutomationPreview(rule: SmsAutomationRule, businessName = "Your business") {
  const rendered = renderSmsAutomation(rule, { customer_first_name: "Alex", appointment_date: "Wednesday, 30 September", appointment_time: "9:00 am AEST", job_number: "JOB-1042", job_title: "your installation" });
  const withoutControls = rendered.body.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (withoutControls !== rendered.body) rendered.missing.push("Remove unsupported control characters");
  const safeBody = withoutControls.replace(/\{([^{}]+)\}/g, (_token, key: string) => Object.hasOwn(SMS_AUTOMATION_FIELDS, key) ? `[${SMS_AUTOMATION_FIELDS[key]}]` : "[Unsupported detail]");
  const body = `${tradeSmsBody(safeBody.trim().slice(0, 480) || "Your message", businessName)}\nJob JOB-1042`;
  const segments = smsSegments(body);
  return { ...rendered, formattedBody: body, segments, costMicro: segments * SMS_PART_PRICE_MICRO };
}
