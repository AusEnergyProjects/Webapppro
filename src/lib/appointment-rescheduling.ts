import { normaliseLocalDateTime } from "./trade-schedule.ts";

export type PreferredWindow = { startsAt: string; endsAt: string };

const MAX_WINDOWS = 3;
const MAX_WINDOW_MINUTES = 12 * 60;
const MAX_ADVANCE_DAYS = 180;

export function australiaSydneyLocalDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function normalisePreferredWindows(value: unknown, now = australiaSydneyLocalDateTime()): PreferredWindow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WINDOWS) throw new Error("INVALID_WINDOWS");
  const maximum = new Date(`${now}:00Z`); maximum.setUTCDate(maximum.getUTCDate() + MAX_ADVANCE_DAYS);
  const maximumValue = maximum.toISOString().slice(0, 16);
  const windows = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("INVALID_WINDOWS");
    const record = item as Record<string, unknown>;
    const startsAt = normaliseLocalDateTime(record.startsAt);
    const endsAt = normaliseLocalDateTime(record.endsAt);
    if (startsAt <= now || endsAt <= startsAt || startsAt.slice(0, 10) !== endsAt.slice(0, 10) || startsAt > maximumValue) throw new Error("INVALID_WINDOWS");
    const duration = (Date.parse(`${endsAt}:00Z`) - Date.parse(`${startsAt}:00Z`)) / 60_000;
    if (duration > MAX_WINDOW_MINUTES) throw new Error("INVALID_WINDOWS");
    return { startsAt, endsAt };
  });
  windows.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  for (let index = 1; index < windows.length; index += 1) if (windows[index - 1].startsAt === windows[index].startsAt && windows[index - 1].endsAt === windows[index].endsAt) throw new Error("INVALID_WINDOWS");
  return windows;
}

export function parsePreferredWindows(value: unknown): PreferredWindow[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is PreferredWindow => Boolean(item && typeof item.startsAt === "string" && typeof item.endsAt === "string")) : [];
  } catch {
    return [];
  }
}
