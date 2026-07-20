import { normaliseWeekStart } from "./trade-schedule.ts";

const STATE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CALENDAR_STATE_PATTERN = /^v1\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{43})$/;

export function calendarIntegrationWeekStart(value: unknown) {
  try { return normaliseWeekStart(value); }
  catch { return ""; }
}

export function calendarIntegrationState(nonce: string, weekStart = "") {
  if (!STATE_NONCE_PATTERN.test(nonce)) throw new Error("INTEGRATION_STATE_INVALID");
  if (!weekStart) return nonce;
  return `v1.${normaliseWeekStart(weekStart)}.${nonce}`;
}

export function calendarIntegrationStateWeekStart(state: string) {
  const match = CALENDAR_STATE_PATTERN.exec(state);
  return match ? calendarIntegrationWeekStart(match[1]) : "";
}
