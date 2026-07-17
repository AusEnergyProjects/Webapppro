export type ServiceFollowUpReportChannel = "all" | "email" | "sms";

export type ServiceFollowUpReportFilters = {
  start: string;
  end: string;
  channel: ServiceFollowUpReportChannel;
  page: number;
  pageSize: number;
  startAt: string;
  endExclusive: string;
};

export type ServiceFollowUpTrendRow = {
  day: string;
  due: number;
  ready: number;
  sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  optedOut: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function canonicalIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function serviceFollowUpReportFilters(url: URL, now = new Date()): ServiceFollowUpReportFilters {
  const today = now.toISOString().slice(0, 10);
  const start = canonicalIsoDate(url.searchParams.get("start") || "") || addDays(today, -29);
  const end = canonicalIsoDate(url.searchParams.get("end") || "") || today;
  if (start > end) throw new Error("The reporting start date must be on or before the end date.");
  const days = Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1;
  if (days > 366) throw new Error("Choose a reporting range of 366 days or less.");
  const requestedChannel = url.searchParams.get("channel") || "all";
  const channel: ServiceFollowUpReportChannel = requestedChannel === "email" || requestedChannel === "sms" ? requestedChannel : "all";
  const requestedPage = Math.floor(Number(url.searchParams.get("page") || 1));
  const requestedPageSize = Math.floor(Number(url.searchParams.get("pageSize") || 25));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : 1;
  const pageSize = Number.isInteger(requestedPageSize) ? Math.min(50, Math.max(10, requestedPageSize)) : 25;
  return { start, end, channel, page, pageSize, startAt: `${start}T00:00:00.000Z`, endExclusive: `${addDays(end, 1)}T00:00:00.000Z` };
}

function blankTrend(day: string): ServiceFollowUpTrendRow {
  return { day, due: 0, ready: 0, sent: 0, delivered: 0, failed: 0, bounced: 0, optedOut: 0 };
}

export function mergeServiceFollowUpTrends(
  start: string,
  end: string,
  dueRows: Array<Record<string, unknown>>,
  deliveryRows: Array<Record<string, unknown>>,
  optOutRows: Array<Record<string, unknown>>,
) {
  const rows = new Map<string, ServiceFollowUpTrendRow>();
  for (let day = start; day <= end; day = addDays(day, 1)) rows.set(day, blankTrend(day));
  for (const row of dueRows) {
    const trend = rows.get(String(row.day));
    if (trend) { trend.due += Number(row.due || 0); trend.ready += Number(row.ready || 0); }
  }
  for (const row of deliveryRows) {
    const trend = rows.get(String(row.day));
    if (trend) {
      trend.sent += Number(row.sent || 0);
      trend.delivered += Number(row.delivered || 0);
      trend.failed += Number(row.failed || 0);
      trend.bounced += Number(row.bounced || 0);
    }
  }
  for (const row of optOutRows) {
    const trend = rows.get(String(row.day));
    if (trend) trend.optedOut += Number(row.opted_out || 0);
  }
  return [...rows.values()];
}
