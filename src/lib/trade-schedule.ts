const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const STATE_TIME_ZONES: Record<string, string> = {
  ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth",
};

export type WorkingWindow = { isAvailable: boolean; startMinute: number; endMinute: number };
export const APPOINTMENT_MIN_DURATION_MINUTES = 15;
export const APPOINTMENT_MAX_DURATION_MINUTES = 8 * 60;
export const APPOINTMENT_DURATION_STEP_MINUTES = 15;

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

export function australiaLocalDateTime(addressState = "NSW", value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATE_TIME_ZONES[addressState] || STATE_TIME_ZONES.NSW,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function browserLocalDateTime(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function assertFutureAppointment(startsAt: string, localNow: string) {
  const start = normaliseLocalDateTime(startsAt);
  const now = normaliseLocalDateTime(localNow);
  if (start <= now) throw new Error("PAST_APPOINTMENT");
  return start;
}

export function normaliseAppointmentDuration(value: unknown, fallback = 60) {
  const duration = value === "" || value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(duration)
    || duration < APPOINTMENT_MIN_DURATION_MINUTES
    || duration > APPOINTMENT_MAX_DURATION_MINUTES
    || duration % APPOINTMENT_DURATION_STEP_MINUTES !== 0) throw new Error("INVALID_DURATION");
  return duration;
}

export function appointmentEndsAt(startsAt: unknown, durationMinutes: unknown, fallback = 60) {
  const start = normaliseLocalDateTime(startsAt);
  const duration = normaliseAppointmentDuration(durationMinutes, fallback);
  return new Date(Date.parse(`${start}:00Z`) + duration * 60_000).toISOString().slice(0, 16);
}

export function appointmentDurationMinutes(startsAt: string, endsAt: string, fallback = 60) {
  try {
    const start = normaliseLocalDateTime(startsAt);
    const end = normaliseLocalDateTime(endsAt);
    const minutes = (Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60_000;
    if (minutes <= 0) return normaliseAppointmentDuration(fallback);
    const stepped = Math.round(minutes / APPOINTMENT_DURATION_STEP_MINUTES) * APPOINTMENT_DURATION_STEP_MINUTES;
    return Math.min(APPOINTMENT_MAX_DURATION_MINUTES, Math.max(APPOINTMENT_MIN_DURATION_MINUTES, stepped));
  } catch { return normaliseAppointmentDuration(fallback); }
}

export function durationLabel(minutes: number) {
  const duration = normaliseAppointmentDuration(minutes);
  const hours = Math.floor(duration / 60);
  const remainder = duration % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours}h ${remainder}m`;
}

export function moveAppointmentToDate(startsAt: string, endsAt: string, targetDate: string, localNow = browserLocalDateTime()) {
  const start = normaliseLocalDateTime(startsAt); const end = normaliseLocalDateTime(endsAt);
  if (!DATE_PATTERN.test(targetDate) || end <= start) throw new Error("INVALID_TIME");
  const duration = Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`);
  let nextStart = `${targetDate}T${start.slice(11)}`;
  if (nextStart <= localNow) {
    const rounded = new Date(`${normaliseLocalDateTime(localNow)}:00Z`);
    rounded.setUTCMinutes(Math.floor(rounded.getUTCMinutes() / 15) * 15 + 15, 0, 0);
    nextStart = rounded.toISOString().slice(0, 16);
    if (nextStart.slice(0, 10) !== targetDate) throw new Error("PAST_APPOINTMENT");
  }
  const nextEnd = new Date(Date.parse(`${nextStart}:00Z`) + duration).toISOString().slice(0, 16);
  return { startsAt: nextStart, endsAt: nextEnd };
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
