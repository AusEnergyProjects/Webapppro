export const ENQUIRY_COMPLETION_OPTIONS = Object.freeze([
  ["flexible", "Flexible / still planning"],
  ["one-month", "Within 1 month"],
  ["three-months", "Within 3 months"],
  ["six-months", "Within 6 months"],
  ["date", "By a specific date"],
]);

export function enquiryCalendarDate(value = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/**
 * @param {{ quoteWindowValue?: unknown; quoteWindowUnit?: unknown; requestedCompletion?: unknown; requestedCompletionDate?: unknown }} raw
 * @returns {{ok:false,error:string}|{ok:true,value:{quoteWindowValue:number,quoteWindowUnit:string,requestedCompletion:string,requestedCompletionDate:string}}}
 */
export function normalizeEnquiryTiming(raw = {}, now = Date.now()) {
  const value = raw.quoteWindowValue === undefined ? 30 : raw.quoteWindowValue;
  const unit = raw.quoteWindowUnit === undefined ? "days" : raw.quoteWindowUnit;
  const completion = raw.requestedCompletion === undefined ? "flexible" : raw.requestedCompletion;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || (unit !== "days" && unit !== "months")
    || value > (unit === "days" ? 365 : 12)) {
    return { ok: false, error: "Choose between 1 and 365 days, or 1 and 12 months, to accept quotes and contact." };
  }
  if (typeof completion !== "string" || !ENQUIRY_COMPLETION_OPTIONS.some(([id]) => id === completion)) {
    return { ok: false, error: "Choose when you hope to have the work completed." };
  }
  const date = completion === "date" ? String(raw.requestedCompletionDate || "") : "";
  if (completion === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    || date < enquiryCalendarDate(now))) {
    return { ok: false, error: "Choose a valid future completion date, or choose a flexible timeframe." };
  }
  return { ok: true, value: { quoteWindowValue: value, quoteWindowUnit: unit, requestedCompletion: completion, requestedCompletionDate: date } };
}

function addCalendarMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function australianLocalEpoch(date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = key => Number(parts.find(entry => entry.type === key)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"), date.getUTCMilliseconds());
}

function addAustralianCalendarMonths(date, months) {
  const target = addCalendarMonths(new Date(australianLocalEpoch(date)), months).getTime();
  let candidate = addCalendarMonths(date, months);
  // Preserve the Australian calendar day and clock time across daylight saving.
  // Two offset corrections handle ordinary transitions. A skipped clock time
  // resolves to the later valid instant on the same calendar day.
  const candidates = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    candidates.push(candidate.getTime());
    const correction = target - australianLocalEpoch(candidate);
    if (!correction) return candidate;
    candidate = new Date(candidate.getTime() + correction);
    if (candidates.includes(candidate.getTime())) return new Date(Math.max(...candidates));
  }
  return candidate;
}

export function enquiryDeadlines(timing, submittedAt) {
  const date = new Date(submittedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("ENQUIRY_SUBMISSION_DATE_INVALID");
  const expiry = timing.quoteWindowUnit === "months"
    ? addAustralianCalendarMonths(date, timing.quoteWindowValue)
    : new Date(date.getTime() + timing.quoteWindowValue * 86400000);
  const months = { "one-month": 1, "three-months": 3, "six-months": 6 }[timing.requestedCompletion];
  const localDate = enquiryCalendarDate(date.getTime());
  return { expiresAt: expiry.toISOString(), requestedWorkBy: timing.requestedCompletion === "date"
    ? timing.requestedCompletionDate : months ? addCalendarMonths(new Date(`${localDate}T12:00:00Z`), months).toISOString().slice(0, 10) : "" };
}

export function enquiryCompletionLabel(date, choice = "flexible") {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
    ? `By ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
    : ENQUIRY_COMPLETION_OPTIONS.find(([id]) => id === choice)?.[1] || "Flexible / still planning";
}
