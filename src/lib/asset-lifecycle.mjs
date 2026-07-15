export const ASSET_SERVICE_TYPES = [
  ["annual_service", "Annual service"],
  ["filter_check", "Filter and airflow check"],
  ["safety_inspection", "Safety inspection"],
  ["performance_review", "Performance review"],
  ["warranty_check", "Warranty check"],
  ["firmware_monitoring", "Firmware and monitoring review"],
];

export const ASSET_SAFETY_SEVERITIES = [
  ["advisory", "Advisory"],
  ["important", "Important"],
  ["urgent", "Urgent"],
];

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-AU");

export function addMonthsToIsoDate(value, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + Number(months || 0), 1));
  const finalDay = Math.min(day, new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate());
  target.setUTCDate(finalDay);
  return target.toISOString().slice(0, 10);
}

export function lifecycleStatus(nextDueAt, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nextDueAt || ""))) return "unscheduled";
  const due = new Date(`${nextDueAt}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.ceil((due - today) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "upcoming";
}

export function safetyNoticeMatchesAsset(notice, asset) {
  const scopes = [
    [notice.assetCategory, asset.assetCategory],
    [notice.brand, asset.brand],
    [notice.modelNumber, asset.modelNumber],
  ];
  return scopes.every(([expected, actual]) => !normalize(expected) || normalize(expected) === normalize(actual));
}

export function googleCalendarUrl({ title, date, details = "" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return "";
  const compact = date.replaceAll("-", "");
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const compactEnd = end.toISOString().slice(0, 10).replaceAll("-", "");
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: String(title || "Asset service reminder").slice(0, 120),
    dates: `${compact}/${compactEnd}`,
    details: String(details || "").slice(0, 500),
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
