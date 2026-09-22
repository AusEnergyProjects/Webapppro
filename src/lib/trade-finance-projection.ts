import { addReportDays, reportDay, type BusinessReport } from "./trade-business-reports.ts";

const horizons = [30, 60, 90] as const;
type ProjectionSource = Pick<BusinessReport, "period" | "permissions" | "current">;
export type RevenueProjection = {
  available: true;
  sourceStart: string;
  sourceEnd: string;
  elapsedDays: number;
  netInvoicedCents: number;
  dailyInvoicedCents: number;
  startsOn: string;
  estimates: Array<{ days: typeof horizons[number]; endsOn: string; cents: number }>;
} | {
  available: false;
  reason: "no_access" | "invalid_period" | "incomplete_data" | "no_activity";
  message: string;
};

export function revenueProjection(report: ProjectionSource): RevenueProjection {
  if (!report.permissions.invoices) return { available: false, reason: "no_access", message: "Invoice access is required to view revenue projections." };
  const { start, end, today } = report.period;
  try { reportDay(start); reportDay(end); reportDay(today); }
  catch { return { available: false, reason: "invalid_period", message: "Choose a valid reporting period to see a projection." }; }
  // Reports clamp their source totals to today. Reject a future source window rather
  // than divide potentially future revenue by only the elapsed days.
  if (start > end || end > today) return { available: false, reason: "invalid_period", message: "Choose a reporting period ending today or earlier to see a projection." };
  const { invoicedCents, creditCents, invoiceCount } = report.current;
  if (invoicedCents === null || creditCents === null || invoiceCount === null ||
      !Number.isSafeInteger(invoicedCents) || !Number.isSafeInteger(creditCents) || !Number.isSafeInteger(invoiceCount) || creditCents < 0 || invoiceCount < 0) {
    return { available: false, reason: "incomplete_data", message: "A projection needs complete invoice and credit totals for this period." };
  }
  if (invoiceCount === 0 && creditCents === 0) return { available: false, reason: "no_activity", message: "No invoicing activity in this period. Choose a period with issued invoices or credits to see a projection." };
  const elapsedDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  // invoicedCents is already issued invoice value less credits, excluding GST.
  const dailyInvoicedCents = invoicedCents / elapsedDays;
  const startsOn = addReportDays(today, 1);
  const estimates = horizons.map(days => ({ days, endsOn: addReportDays(today, days), cents: Math.round(dailyInvoicedCents * days) }));
  if (estimates.some(estimate => !Number.isSafeInteger(estimate.cents))) return { available: false, reason: "incomplete_data", message: "The recorded totals are too large to calculate a reliable projection." };
  return { available: true, sourceStart: start, sourceEnd: end, elapsedDays, netInvoicedCents: invoicedCents, dailyInvoicedCents, startsOn, estimates };
}

export function revenueProjectionCsvRows(report: ProjectionSource) {
  const projection = revenueProjection(report);
  const rows: Array<Record<string, string | number>> = [];
  if (!projection.available) return projection.reason === "no_access" ? rows : [{ section: "Revenue projection", metric: "Availability", value: projection.message, comparison: "", basis: "Selected period" }];
  const basis = "AUD excluding GST; selected period's daily net invoicing pace continues; excludes unpaid balances; not cash receipts, profit or guaranteed revenue";
  const put = (metric: string, value: string | number, rowBasis = basis) => rows.push({ section: "Revenue projection", metric, value, comparison: "", basis: rowBasis });
  put("Source dates", `${projection.sourceStart} to ${projection.sourceEnd}`, "Selected period");
  put("Elapsed calendar days", projection.elapsedDays, "Both source dates included");
  put("Source net invoicing", (projection.netInvoicedCents / 100).toFixed(2));
  put("Daily net invoicing pace", (projection.dailyInvoicedCents / 100).toFixed(2));
  for (const estimate of projection.estimates) put(`Next ${estimate.days} days (${projection.startsOn} to ${estimate.endsOn})`, (estimate.cents / 100).toFixed(2));
  return rows;
}
