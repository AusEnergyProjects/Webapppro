export type FollowUpKind = "general" | "quote" | "invoice" | "appointment" | "appointment_after";
export type FollowUpTemplate = { id: string; name: string; kind: FollowUpKind; subject: string; body: string };
export type FollowUpTiming = { amount: number; unit: "hours" | "days" | "weeks"; direction: "before" | "after" };
export type FollowUpSettings = { invoiceEnabled: boolean; appointmentEnabled: boolean; invoiceTemplateId: string; appointmentTemplateId: string; invoiceTiming: FollowUpTiming; appointmentTiming: FollowUpTiming };
export function followUpTimingHours(timing: FollowUpTiming) {
  return timing.amount * (timing.unit === "weeks" ? 168 : timing.unit === "days" ? 24 : 1) * (timing.direction === "before" ? -1 : 1);
}

export const FOLLOW_UP_FIELDS: Record<string, string> = {
  customer_name: "Customer name", customer_first_name: "Customer first name", business_name: "Business name", job_number: "Job number", job_title: "Job title",
  site_address: "Site address", invoice_number: "Invoice number", invoice_due_date: "Invoice due date",
  invoice_amount: "Invoice amount", appointment_date: "Appointment date", appointment_time: "Appointment time",
};
/** The editor shows readable insert labels; only the saved contract uses field keys. */
export function followUpEditorText(text: string) {
  return text.replace(/\{([^{}]+)\}/g, (token, key: string) => Object.hasOwn(FOLLOW_UP_FIELDS,key) ? `[${FOLLOW_UP_FIELDS[key]}]` : token);
}
export function followUpStoredText(text: string) {
  const keys = new Map(Object.entries(FOLLOW_UP_FIELDS).map(([key,label]) => [label,key]));
  return text.replace(/\[([^\[\]]+)\]/g, (token, label: string) => keys.has(label) ? `{${keys.get(label)}}` : token);
}
export const DEFAULT_FOLLOW_UP_SETTINGS: FollowUpSettings = { invoiceEnabled: false, appointmentEnabled: false,
  invoiceTemplateId: "overdue-invoice", appointmentTemplateId: "appointment-reminder",
  invoiceTiming: {amount:1,unit:"days",direction:"after"}, appointmentTiming: {amount:1,unit:"days",direction:"before"} };
export const DEFAULT_FOLLOW_UP_TEMPLATES: FollowUpTemplate[] = [
  { id: "quote-follow-up", name: "Quote follow-up", kind: "quote", subject: "Your quote from {business_name}",
    body: "Hi {customer_name},\n\nJust checking whether you have any questions about our quote for {job_title}. Reply to this email and we will be happy to help.\n\nKind regards,\n{business_name}" },
  { id: "overdue-invoice", name: "Overdue invoice", kind: "invoice", subject: "Invoice {invoice_number} reminder",
    body: "Hi {customer_name},\n\nOur records show {invoice_amount} outstanding on invoice {invoice_number}, due on {invoice_due_date}. Please use the payment details on your invoice.\n\nIf you have already paid, please reply with your payment reference so we can update our records.\n\nThank you,\n{business_name}" },
  { id: "appointment-reminder", name: "Appointment reminder", kind: "appointment", subject: "Your appointment with {business_name}",
    body: "Hi {customer_name},\n\nA reminder that we are booked for {appointment_date} at {appointment_time}.\nAddress: {site_address}\nJob: {job_number}\n\nPlease reply if you need to discuss access or change the booking.\n\nSee you soon,\n{business_name}" },
  { id: "general-follow-up", name: "General follow-up", kind: "general", subject: "Following up on {job_title}",
    body: "Hi {customer_name},\n\nJust following up on your job, {job_number}. Please reply if you have any questions or anything you would like us to help with.\n\nKind regards,\n{business_name}" },
  { id: "appointment-follow-up", name: "After-visit follow-up", kind: "appointment_after", subject: "Following up after our visit",
    body: "Hi {customer_name},\n\nFollowing up on our visit on {appointment_date} for {job_title}. Please reply if you have any questions or anything else we can help with.\n\nKind regards,\n{business_name}" },
];
export function followUpTemplate(value: unknown): FollowUpTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FOLLOW_UP_TEMPLATE_INVALID");
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number, multiline = false) => {
    const raw = v[key];
    if (typeof raw !== "string" || !raw.trim() || raw.length > max
      || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(raw)) throw new Error("FOLLOW_UP_TEMPLATE_INVALID");
    return raw.trim();
  };
  const id = text("id", 100), name = text("name", 80), subject = text("subject", 200), body = text("body", 8000, true);
  if (!/^[\w-]+$/.test(id) || !["general", "quote", "invoice", "appointment", "appointment_after"].includes(String(v.kind))) throw new Error("FOLLOW_UP_TEMPLATE_INVALID");
  for (const match of `${subject}\n${body}`.matchAll(/\{([^{}]+)\}/g)) if (!Object.hasOwn(FOLLOW_UP_FIELDS, match[1])) throw new Error("FOLLOW_UP_FIELD_INVALID");
  return { id, name, kind: v.kind as FollowUpKind, subject, body };
}
export function followUpSettings(value: unknown): FollowUpSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FOLLOW_UP_SETTINGS_INVALID");
  const v = value as Record<string, unknown>;
  if (typeof v.invoiceEnabled !== "boolean" || typeof v.appointmentEnabled !== "boolean"
    || typeof v.invoiceTemplateId !== "string" || !/^[\w-]{1,100}$/.test(v.invoiceTemplateId)
    || typeof v.appointmentTemplateId !== "string" || !/^[\w-]{1,100}$/.test(v.appointmentTemplateId)) throw new Error("FOLLOW_UP_SETTINGS_INVALID");
  const timing = (value: unknown): FollowUpTiming => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FOLLOW_UP_SETTINGS_INVALID");
    const t = value as Record<string, unknown>;
    if (typeof t.amount !== "number" || !Number.isSafeInteger(t.amount) || t.amount < 1
      || (t.unit !== "hours" && t.unit !== "days" && t.unit !== "weeks")
      || (t.direction !== "before" && t.direction !== "after")) throw new Error("FOLLOW_UP_SETTINGS_INVALID");
    const result: FollowUpTiming = {amount:t.amount,unit:t.unit,direction:t.direction};
    if (Math.abs(followUpTimingHours(result)) > 1008) throw new Error("FOLLOW_UP_SETTINGS_INVALID");
    return result;
  };
  return { invoiceEnabled: v.invoiceEnabled, appointmentEnabled: v.appointmentEnabled,
    invoiceTemplateId: v.invoiceTemplateId, appointmentTemplateId: v.appointmentTemplateId,
    invoiceTiming: timing(v.invoiceTiming), appointmentTiming: timing(v.appointmentTiming) };
}
export function renderFollowUp(template: Pick<FollowUpTemplate, "subject" | "body">, fields: Record<string, string>) {
  const missing = new Set<string>();
  const fill = (text: string) => text.replace(/\{([^{}]+)\}/g, (token, key: string) => {
    if (!Object.hasOwn(fields, key) || !fields[key]) { missing.add(Object.hasOwn(FOLLOW_UP_FIELDS, key) ? FOLLOW_UP_FIELDS[key] : key); return token; }
    return fields[key];
  });
  const subject = fill(template.subject), body = fill(template.body);
  return { subject, body, missing: [...missing] };
}
export function followUpLocalTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
/** Appointments store local wall time. Resolve the site's zone, including DST, before comparing. */
export function followUpAppointmentEpoch(wallTime: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(wallTime)) return NaN;
  const normalized = wallTime.length === 16 ? `${wallTime}:00` : wallTime;
  const target = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(target)) return NaN;
  let epoch = target;
  for (let i = 0; i < 4; i++) epoch += target - Date.parse(`${followUpLocalTime(new Date(epoch), timeZone)}Z`);
  return followUpLocalTime(new Date(epoch), timeZone) === normalized ? epoch : NaN;
}
