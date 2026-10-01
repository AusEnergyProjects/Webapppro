import { getD1 } from "../../db";
import { calendarAccessToken, type CalendarProvider } from "./trade-calendar-sync-server";
import { calendarRecord, externalCalendarWindow, normalizeExternalCalendarEvent, type CalendarWindow, type ExternalCalendarResult } from "./trade-calendar-events";

const MAX_PAGES = 4;
const PROVIDER_TIMEOUT_MS = 12_000;
type Connection = Record<string, unknown> & { provider: CalendarProvider };
function calendarProvider(value: unknown): value is CalendarProvider { return value === "google_calendar" || value === "microsoft_calendar"; }
export function calendarReadUrl(provider: CalendarProvider, window: CalendarWindow) {
  // Padding includes date-only events from calendars in a different timezone; projection clips the display range.
  const start = new Date(Date.parse(window.startUtc) - 86_400_000).toISOString();
  const end = new Date(Date.parse(window.endUtc) + 86_400_000).toISOString();
  if (provider === "google_calendar") {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.search = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", showDeleted: "false", maxResults: "250", timeZone: "UTC", fields: "nextPageToken,items(id,status,summary,start,end,organizer(self),creator(self),attendees(self,responseStatus),extendedProperties(private),transparency,htmlLink,hangoutLink)" }).toString();
    return url;
  }
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.search = new URLSearchParams({ startDateTime: start, endDateTime: end, "$top": "250", "$select": "id,subject,start,end,isAllDay,isCancelled,isOrganizer,responseStatus,showAs,webLink,onlineMeeting,transactionId" }).toString();
  return url;
}
function providerError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "CALENDAR_RECONNECT_REQUIRED") return "Reconnect this calendar to read its events.";
  if (code === "CALENDAR_ACCESS_REQUIRED") return "Calendar access was not granted. Reconnect and approve calendar access.";
  if (["CALENDAR_PROVIDER_TIMEOUT", "AbortError", "TimeoutError"].includes(code) || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "This calendar took too long to respond. Refresh to try again.";
  return "This calendar could not be read. Refresh to try again.";
}
export async function readExternalCalendarProvider(connection: Connection, window: CalendarWindow, memberId: string, mirrors: { externalIds: Set<string>; appointmentIds: Set<string> }) {
  const provider = connection.provider; const events = new Map<string, NonNullable<ReturnType<typeof normalizeExternalCalendarEvent>>>();
  try {
    const token = await calendarAccessToken(provider, connection);
    const initialUrl = calendarReadUrl(provider, window); let url = initialUrl.toString();
    const visited = new Set<string>(); const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (visited.has(url)) throw new Error("CALENDAR_INVALID_PAGINATION");
      visited.add(url);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(provider === "microsoft_calendar" ? { Prefer: 'outlook.timezone="UTC"' } : {}) }, signal, redirect: "error", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "CALENDAR_RECONNECT_REQUIRED" : response.status === 403 ? "CALENDAR_ACCESS_REQUIRED" : "CALENDAR_PROVIDER_FAILED");
      const body = calendarRecord(await response.json()); const records = provider === "google_calendar" ? body.items : body.value;
      if (!Array.isArray(records)) throw new Error("CALENDAR_INVALID_RESPONSE");
      for (const record of records) { const event = normalizeExternalCalendarEvent(provider, record, window, memberId, mirrors); if (event) events.set(event.id, event); }
      const next = provider === "google_calendar" ? body.nextPageToken : body["@odata.nextLink"];
      if (!next) return { events: [...events.values()], provider, complete: true, error: "" };
      if (typeof next !== "string" || next.length > 16_000) throw new Error("CALENDAR_INVALID_PAGINATION");
      if (provider === "google_calendar") { const nextUrl = new URL(initialUrl); nextUrl.searchParams.set("pageToken", next); url = nextUrl.toString(); }
      else {
        const nextUrl = new URL(next);
        if (nextUrl.origin !== initialUrl.origin || nextUrl.pathname !== initialUrl.pathname || nextUrl.username || nextUrl.password) throw new Error("CALENDAR_INVALID_PAGINATION");
        url = nextUrl.toString();
      }
    }
    return { events: [...events.values()], provider, complete: false, error: "This calendar has more events than can be shown at once. Only part of this week is shown." };
  } catch (error) { return { events: [], provider, complete: false, error: providerError(error) }; }
}
export async function loadOwnerCalendarEvents(ownerUid: string, memberId: string, rangeStart: string, rangeEnd: string): Promise<ExternalCalendarResult> {
  // Validate before database/provider work; state-specific UTC boundaries are resolved below.
  externalCalendarWindow(rangeStart, rangeEnd);
  const db = getD1();
  const [account, connections, mappings] = await Promise.all([
    db.prepare("SELECT address_state FROM trade_accounts WHERE firebase_uid = ?").bind(ownerUid).first<{ address_state: string }>(),
    db.prepare("SELECT * FROM trade_crm_integrations WHERE firebase_uid = ? AND status = 'connected' AND provider IN ('google_calendar','microsoft_calendar')").bind(ownerUid).all<Record<string, unknown>>(),
    db.prepare("SELECT provider, external_event_id, appointment_id FROM trade_crm_calendar_events WHERE firebase_uid = ?").bind(ownerUid).all<{ provider: string; external_event_id: string; appointment_id: string }>(),
  ]);
  const window = externalCalendarWindow(rangeStart, rangeEnd, account?.address_state);
  const results = await Promise.all(connections.results.flatMap(connection => {
    if (!calendarProvider(connection.provider)) return [];
    const provider = connection.provider; const rows = mappings.results.filter(row => row.provider === provider);
    return [readExternalCalendarProvider({ ...connection, provider }, window, memberId, { externalIds: new Set(rows.map(row => row.external_event_id)), appointmentIds: new Set(rows.map(row => row.appointment_id)) })];
  }));
  return { rangeStart, rangeEnd, timeZone: window.timeZone, fetchedAt: new Date().toISOString(), events: results.flatMap(result => result.events).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)), providers: results.map(({ provider, complete, error }) => ({ provider, complete, error })) };
}
