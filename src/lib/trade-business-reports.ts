import { australiaLocalDateTime } from "./trade-schedule.ts";

export const REPORT_PERIODS = ["weekly", "monthly", "quarterly", "fytd", "custom"] as const;
export type ReportPreset = typeof REPORT_PERIODS[number];
export type ReportWindow = { start: string; end: string; startUtc: string; endUtc: string };
export type ReportPeriod = ReportWindow & { preset: ReportPreset; today: string; timeZone: string; previous: ReportWindow; previousAnchor: string; nextAnchor: string | null };
export type ReportMeasures = { newJobs: number; completedJobs: number; quoteIssues: number | null; wonQuotes: number | null; declinedQuotes: number | null; wonCents: number | null; invoicedCents: number | null; creditCents: number | null; invoiceCount: number | null; bookedMinutes: number; visits: number; completedVisits: number; missingDurations: number };
export type ReportBreakdown = { key: string; newJobs: number; completedJobs: number; invoicedCents: number | null };
export type BusinessReport = {
  generatedAt: string; period: ReportPeriod; service: string; state: string;
  permissions: { invoices: boolean; quotes: boolean };
  options: { services: string[]; states: string[] };
  current: ReportMeasures; previous: ReportMeasures;
  trend: Array<{ start: string; end: string; newJobs: number; completedJobs: number; invoicedCents: number | null }>;
  services: ReportBreakdown[]; regions: ReportBreakdown[];
  work: { openJobs: number; waitingJobs: number; unassignedJobs: number; awaitingSchedule: number; overdueTasks: number; openIssues: number; completedUninvoiced: number | null; stages: Array<{ key: string; count: number }> };
  receivables: null | { outstandingCents: number; paidCents: number; buckets: Array<{ key: string; count: number; cents: number }>; undatedInvoiceCount: number; undatedInvoiceCents: number };
  team: Array<{ key: string; label: string; visits: number; completedVisits: number; bookedMinutes: number; upcomingVisits: number; upcomingMinutes: number; missingDurations: number }>;
};
export class ReportInputError extends Error {}
const zones: Record<string, string> = { ACT: "Australia/Sydney", NSW: "Australia/Sydney", VIC: "Australia/Melbourne", TAS: "Australia/Hobart", QLD: "Australia/Brisbane", SA: "Australia/Adelaide", WA: "Australia/Perth", NT: "Australia/Darwin" };
export function reportDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new ReportInputError("Choose valid report dates.");
  return value;
}
export function addReportDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
function shiftMonth(day: string, months: number) {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months, 1); return date.toISOString().slice(0, 10);
}
// Midnight in the business's Australian time zone, including daylight saving and half-hour zones.
export function reportMidnight(day: string, state: string) {
  const target = Date.parse(`${day}T00:00:00Z`); let instant = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = Date.parse(`${australiaLocalDateTime(state, new Date(instant))}:00Z`);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
export function reportWindow(start: string, end: string, state: string): ReportWindow {
  return { start, end, startUtc: reportMidnight(start, state), endUtc: reportMidnight(addReportDays(end, 1), state) };
}
export function resolveReportPeriod(params: URLSearchParams, addressState = "NSW", now = new Date()): ReportPeriod {
  const input = params.get("period") || "monthly";
  if (!REPORT_PERIODS.some(value => value === input)) throw new ReportInputError("Choose a weekly, monthly, quarterly, financial year or custom report.");
  const preset = input as ReportPreset;
  const today = australiaLocalDateTime(addressState, now).slice(0, 10);
  const anchor = reportDay(params.get("anchor") || today);
  if (anchor > today || anchor < "2000-01-01") throw new ReportInputError("Choose a report date between 2000 and today.");
  let start = anchor; let fullEnd = anchor; let previousStart = anchor; let previousFullEnd = anchor;
  if (preset === "custom") {
    start = reportDay(params.get("from") || ""); fullEnd = reportDay(params.get("to") || "");
    if (start < "2000-01-01" || fullEnd < start || fullEnd > today || daysBetween(start, fullEnd) > 365) throw new ReportInputError("Choose a date range of up to 366 days ending no later than today.");
    previousFullEnd = addReportDays(start, -1); previousStart = addReportDays(start, -daysBetween(start, fullEnd) - 1);
  } else if (preset === "weekly") {
    start = addReportDays(anchor, -((new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7));
    fullEnd = addReportDays(start, 6); previousStart = addReportDays(start, -7); previousFullEnd = addReportDays(start, -1);
  } else {
    const [year, month] = anchor.split("-").map(Number);
    start = preset === "fytd" ? `${month < 7 ? year - 1 : year}-07-01`
      : `${year}-${String(preset === "quarterly" ? Math.floor((month - 1) / 3) * 3 + 1 : month).padStart(2, "0")}-01`;
    const months = preset === "fytd" ? 12 : preset === "quarterly" ? 3 : 1;
    fullEnd = addReportDays(shiftMonth(start, months), -1);
    previousStart = shiftMonth(start, -months); previousFullEnd = addReportDays(start, -1);
  }
  const end = fullEnd > today ? today : fullEnd;
  const elapsedEnd = addReportDays(previousStart, daysBetween(start, end));
  const previousEnd = fullEnd <= today ? previousFullEnd : elapsedEnd < previousFullEnd ? elapsedEnd : previousFullEnd;
  return { ...reportWindow(start, end, addressState), preset, today, timeZone: zones[addressState] || zones.NSW,
    previous: reportWindow(previousStart, previousEnd, addressState), previousAnchor: addReportDays(start, -1),
    nextAnchor: fullEnd < today ? addReportDays(fullEnd, 1) : null };
}
export function reportTrendWindows(period: ReportPeriod, state: string) {
  const length = daysBetween(period.start, period.end) + 1; const result: ReportWindow[] = [];
  for (let start = period.start; start <= period.end;) {
    const next = length <= 31 ? addReportDays(start, 1) : length <= 100 ? addReportDays(start, 7) : shiftMonth(start, 1);
    const end = addReportDays(next, -1) < period.end ? addReportDays(next, -1) : period.end;
    result.push(reportWindow(start, end, state)); start = next;
  }
  return result;
}
export function reportChange(current: number, previous: number) {
  if (!previous) return current ? "No prior value" : "No change";
  const value = (current - previous) / Math.abs(previous) * 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% vs previous`;
}
export function reportCsvRows(report: BusinessReport) {
  const rows: Array<Record<string, string | number>> = [];
  const put = (section: string, metric: string, value: string | number, comparison: string | number = "", basis = "Selected period") => rows.push({ section, metric, value, comparison, basis });
  put("Report", "Dates", `${report.period.start} to ${report.period.end}`, `${report.period.previous.start} to ${report.period.previous.end}`);
  put("Report", "Time zone", report.period.timeZone); put("Report", "Service", report.service || "All services"); put("Report", "Region", report.state || "All regions");
  const moneyKeys = new Set(["wonCents", "invoicedCents", "creditCents"]);
  const labels: Record<keyof ReportMeasures, string> = { newJobs: "Jobs created", completedJobs: "Jobs completed", quoteIssues: "Quotes first issued", wonQuotes: "Accepted quote decisions", declinedQuotes: "Declined quote decisions", wonCents: "Work won", invoicedCents: "Net TLink invoicing", creditCents: "Credits issued", invoiceCount: "TLink invoices issued", bookedMinutes: "Booked minutes", visits: "Visits", completedVisits: "Completed visits", missingDurations: "Visits missing duration" };
  for (const key of Object.keys(report.current) as Array<keyof ReportMeasures>) {
    const value = report.current[key]; const previous = report.previous[key]; if (value === null || previous === null) continue;
    put("Period", labels[key], moneyKeys.has(key) ? (value / 100).toFixed(2) : value, moneyKeys.has(key) ? (previous / 100).toFixed(2) : previous, moneyKeys.has(key) ? "AUD excluding GST" : "Selected period");
  }
  for (const [section, groups] of [["Services", report.services], ["Regions", report.regions]] as const) for (const group of groups) {
    put(section, `${group.key} / jobs created`, group.newJobs); put(section, `${group.key} / jobs completed`, group.completedJobs);
    if (group.invoicedCents !== null) put(section, `${group.key} / net TLink invoicing`, (group.invoicedCents / 100).toFixed(2), "", "AUD excluding GST");
  }
  for (const bucket of report.trend) { put("Trend", `${bucket.start} / jobs created`, bucket.newJobs); if (bucket.invoicedCents !== null) put("Trend", `${bucket.start} / net TLink invoicing`, (bucket.invoicedCents / 100).toFixed(2), "", "AUD excluding GST"); }
  for (const member of report.team) { put("Team", `${member.label} / booked hours`, (member.bookedMinutes / 60).toFixed(2)); put("Team", `${member.label} / next 28 days hours`, (member.upcomingMinutes / 60).toFixed(2), "", "Current schedule"); }
  if (report.receivables) {
    put("Receivables", "Outstanding", (report.receivables.outstandingCents / 100).toFixed(2), "", "Today, AUD including GST");
    put("Receivables", "Recorded payments", (report.receivables.paidCents / 100).toFixed(2), "", "Current cumulative balance, AUD including GST, not period receipts");
    for (const bucket of report.receivables.buckets) put("Ageing", bucket.key, (bucket.cents / 100).toFixed(2), "", "Today, AUD including GST");
  }
  const workLabels: Record<string, string> = { openJobs: "Open jobs", waitingJobs: "Waiting jobs", unassignedJobs: "Unassigned jobs", awaitingSchedule: "Jobs needing a future visit", overdueTasks: "Overdue tasks", openIssues: "Open issues", completedUninvoiced: "Completed, not invoiced" };
  for (const [key, value] of Object.entries(report.work)) if (typeof value === "number") put("Work health", workLabels[key] || key, value, "", "Current active jobs");
  return rows;
}
