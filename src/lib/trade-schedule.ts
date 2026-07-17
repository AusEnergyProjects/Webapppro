const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type WorkingWindow = { isAvailable: boolean; startMinute: number; endMinute: number };

export function normaliseWeekStart(value: unknown) {
  const date = String(value || "");
  if (!DATE_PATTERN.test(date)) throw new Error("INVALID_WEEK");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDay() !== 1 || parsed.toISOString().slice(0, 10) !== date) throw new Error("INVALID_WEEK");
  return date;
}

export function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function normaliseLocalDateTime(value: unknown) {
  const dateTime = String(value || "");
  if (!LOCAL_DATE_TIME_PATTERN.test(dateTime)) throw new Error("INVALID_TIME");
  const parsed = new Date(`${dateTime}:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 16) !== dateTime) throw new Error("INVALID_TIME");
  return dateTime;
}

export function localDayAndMinute(value: string) {
  const parsed = new Date(`${normaliseLocalDateTime(value)}:00Z`);
  return { date: value.slice(0, 10), weekday: parsed.getUTCDay(), minute: parsed.getUTCHours() * 60 + parsed.getUTCMinutes() };
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && startB < endA;
}

export function defaultWorkingWindow(weekday: number): WorkingWindow {
  return weekday >= 1 && weekday <= 5
    ? { isAvailable: true, startMinute: 9 * 60, endMinute: 17 * 60 }
    : { isAvailable: false, startMinute: 9 * 60, endMinute: 17 * 60 };
}

export function insideWorkingWindow(startsAt: string, endsAt: string, window: WorkingWindow) {
  const start = localDayAndMinute(startsAt);
  const end = localDayAndMinute(endsAt);
  return start.date === end.date && window.isAvailable && start.minute >= window.startMinute && end.minute <= window.endMinute && end.minute > start.minute;
}
