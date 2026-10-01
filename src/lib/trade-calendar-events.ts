import { australiaLocalDateTime } from "./trade-schedule.ts";
import type { CalendarProvider } from "./trade-calendar-sync-server";

export type ExternalCalendarEvent = {
  id: string; provider: CalendarProvider; title: string; startsAt: string; endsAt: string;
  allDay: boolean; clockChange: boolean; timeDetail: string; busy: boolean; sourceUrl: string; joinUrl: string; memberId: string;
};
export type ExternalCalendarResult = {
  rangeStart: string; rangeEnd: string; timeZone: string; fetchedAt: string;
  events: ExternalCalendarEvent[];
  providers: Array<{ provider: CalendarProvider; complete: boolean; error: string }>;
};
export type CalendarWindow = { rangeStart: string; rangeEnd: string; startUtc: string; endUtc: string; state: string; timeZone: string };
const zones: Record<string, string> = { ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane", SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth" };
export function calendarRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function clean(value: unknown, maximum = 240) { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : ""; }
function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day; }
function midnight(day: string, state: string) {
  const target = Date.parse(`${day}T00:00:00Z`); let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) instant += target - Date.parse(`${australiaLocalDateTime(state, new Date(instant))}:00Z`);
  return new Date(instant).toISOString();
}
export function externalCalendarWindow(rangeStart: string, rangeEnd: string, state = "NSW"): CalendarWindow {
  const days = (Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000;
  if (!validDay(rangeStart) || !validDay(rangeEnd) || days < 1 || days > 31) throw new Error("INVALID_CALENDAR_RANGE");
  const selectedState = zones[state] ? state : "NSW";
  return { rangeStart, rangeEnd, state: selectedState, timeZone: zones[selectedState], startUtc: midnight(rangeStart, selectedState), endUtc: midnight(rangeEnd, selectedState) };
}
function safeLink(value: unknown, hosts: string[]) {
  try { const url = new URL(clean(value, 4000)); return url.protocol === "https:" && !url.username && !url.password && hosts.includes(url.hostname.toLowerCase()) ? url.toString() : ""; }
  catch { return ""; }
}
function absoluteDateTime(value: unknown, graph = false): Date | null {
  const block = calendarRecord(value); let text = clean(block.dateTime, 100);
  if (graph && block.timeZone === "UTC" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) text += "Z";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return null;
  const date = new Date(text); return Number.isFinite(date.getTime()) ? date : null;
}
export function normalizeExternalCalendarEvent(provider: CalendarProvider, value: unknown, window: CalendarWindow, memberId: string, mirrors: { externalIds: Set<string>; appointmentIds: Set<string> }): ExternalCalendarEvent | null {
  const event = calendarRecord(value); const id = clean(event.id, 2048);
  if (!id || mirrors.externalIds.has(id)) return null;
  const google = provider === "google_calendar";
  if (google) {
    const marker = calendarRecord(calendarRecord(event.extendedProperties).private).tlinkAppointmentId;
    if (typeof marker === "string" && mirrors.appointmentIds.has(marker)) return null;
    const self = (Array.isArray(event.attendees) ? event.attendees : []).map(calendarRecord).find(item => item.self === true);
    if (event.status === "cancelled" || event.status === "tentative" || (self ? self.responseStatus !== "accepted" : calendarRecord(event.organizer).self !== true && calendarRecord(event.creator).self !== true)) return null;
  } else {
    const transaction = clean(event.transactionId, 2048);
    if (transaction.startsWith("tlink-") && mirrors.appointmentIds.has(transaction.slice(6))) return null;
    const response = calendarRecord(event.responseStatus).response;
    if (event.isCancelled === true || (response !== "accepted" && response !== "organizer" && event.isOrganizer !== true)) return null;
  }
  const startBlock = calendarRecord(event.start); const endBlock = calendarRecord(event.end);
  const allDay = google ? typeof startBlock.date === "string" : event.isAllDay === true;
  let startsAt: string; let endsAt: string; let clockChange = false; let timeDetail = "";
  if (google && allDay) {
    const start = clean(startBlock.date, 10); const end = clean(endBlock.date, 10);
    if (!validDay(start) || !validDay(end) || end <= start) return null;
    startsAt = `${start}T00:00`; endsAt = `${end}T00:00`;
  } else {
    const start = absoluteDateTime(event.start, !google); const end = absoluteDateTime(event.end, !google);
    if (!start || !end || end <= start) return null;
    startsAt = australiaLocalDateTime(window.state, start); endsAt = australiaLocalDateTime(window.state, end);
    const wallMinutes = (Date.parse(`${endsAt}:00Z`) - Date.parse(`${startsAt}:00Z`)) / 60_000;
    const elapsedMinutes = (end.getTime() - start.getTime()) / 60_000;
    clockChange = Math.abs(wallMinutes - elapsedMinutes) >= 1;
    if (clockChange) {
      const format = new Intl.DateTimeFormat("en-AU", { timeZone: window.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset" });
      timeDetail = `${format.format(start)} to ${format.format(end)} | Clock change`;
    }
  }
  if (startsAt >= `${window.rangeEnd}T00:00` || endsAt <= `${window.rangeStart}T00:00`) return null;
  const meeting = calendarRecord(event.onlineMeeting);
  return { id: `${provider}:${id}`, provider, title: clean(google ? event.summary : event.subject) || "Calendar event", startsAt, endsAt, allDay, clockChange, timeDetail,
    busy: google ? event.transparency !== "transparent" : !["free", "workingElsewhere"].includes(clean(event.showAs)), memberId,
    sourceUrl: safeLink(google ? event.htmlLink : event.webLink, google ? ["calendar.google.com", "www.google.com"] : ["outlook.office.com", "outlook.office365.com", "outlook.live.com", "outlook.cloud.microsoft"]),
    joinUrl: safeLink(google ? event.hangoutLink : meeting.joinUrl, ["meet.google.com", "teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"]),
  };
}

/** Split multi-day events at display-day boundaries. End dates are exclusive. */
export function externalCalendarEventOnDay(event: ExternalCalendarEvent, day: string) {
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const start = `${day}T00:00`; const end = `${nextDay}T00:00`;
  if (event.startsAt >= end || event.endsAt <= start) return null;
  return { ...event, startsAt: event.startsAt < start ? start : event.startsAt, endsAt: event.endsAt > end ? end : event.endsAt };
}

export function externalCalendarLastDay(event: ExternalCalendarEvent) {
  const end = event.endsAt.slice(0, 10);
  return event.endsAt.slice(11) === "00:00" ? new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : end;
}
