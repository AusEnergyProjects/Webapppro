import { getD1 } from "../../db";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/trade-integration-crypto";
import { providerSetting } from "@/lib/trade-integrations-server";

type Row = Record<string, unknown>;
export type CalendarProvider = "google_calendar" | "microsoft_calendar";
export const CALENDAR_PROVIDERS: CalendarProvider[] = ["google_calendar", "microsoft_calendar"];
const CALENDAR_PROVIDER_TIMEOUT_MS = 4_000;
const TLINK_WORK_URL = "https://ausenergyassessments.com/direct-trade/dashboard?workspace=work";
type CalendarSyncOptions = { force?: boolean };

const ianaTimeZones: Record<string, string> = {
  ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth",
};
const windowsTimeZones: Record<string, string> = {
  ACT: "AUS Eastern Standard Time", NSW: "AUS Eastern Standard Time", NT: "AUS Central Standard Time",
  QLD: "E. Australia Standard Time", SA: "Cen. Australia Standard Time", TAS: "Tasmania Standard Time",
  VIC: "AUS Eastern Standard Time", WA: "W. Australia Standard Time",
};
const windowsToIanaTimeZones: Record<string, string> = {
  "AUS Eastern Standard Time": "Australia/Sydney",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "Tasmania Standard Time": "Australia/Hobart",
  "W. Australia Standard Time": "Australia/Perth",
};

async function calendarProviderFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(CALENDAR_PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new Error("CALENDAR_PROVIDER_TIMEOUT");
    }
    throw error;
  }
}

async function activeCredentials(provider: CalendarProvider, connection: Row) {
  const credentials = await decryptIntegrationCredentials(String(connection.encrypted_credentials || ""));
  const expiresAt = Date.parse(String(connection.token_expires_at || ""));
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 2 * 60 * 1000) return credentials;
  if (!credentials.refresh_token) throw new Error("CALENDAR_RECONNECT_REQUIRED");
  const setting = providerSetting(provider);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token),
    client_id: setting.clientId, client_secret: setting.clientSecret });
  if (provider === "microsoft_calendar") body.set("scope", setting.scopes.join(" "));
  const response = await calendarProviderFetch(setting.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const refreshed = await response.json().catch(() => ({})) as Row;
  if (!response.ok || !refreshed.access_token) throw new Error("CALENDAR_RECONNECT_REQUIRED");
  const next = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || credentials.refresh_token,
    token_type: refreshed.token_type || credentials.token_type || "bearer" };
  const now = new Date().toISOString();
  const tokenExpiresAt = Number(refreshed.expires_in || 0) > 0 ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : "";
  await getD1().prepare(`UPDATE trade_crm_integrations SET encrypted_credentials = ?, token_expires_at = ?, last_error = '', updated_at = ?
    WHERE id = ? AND firebase_uid = ?`).bind(await encryptIntegrationCredentials(next), tokenExpiresAt, now, connection.id, connection.firebase_uid).run();
  return next;
}

function eventText(value: unknown, maximum = 500) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, maximum);
}

function eventLabel(value: unknown) {
  return eventText(value, 160).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function calendarEventDetails(provider: CalendarProvider, appointment: Row) {
  const protectedJob = appointment.source_type === "opportunity" || appointment.customer_source === "platform_private";
  const customerContext = !protectedJob && ["trade_owned", "public_lead_released"].includes(String(appointment.customer_source || ""));
  const state = String(appointment.site_state || appointment.account_state || "NSW").toUpperCase();
  const workNumber = eventText(appointment.work_number, 80);
  const title = eventText(appointment.title, 240) || "Trade job";
  const customerName = customerContext ? eventText(appointment.customer_name, 240) || "Customer" : "";
  const customerPhone = customerContext ? eventText(appointment.customer_phone, 80) : "";
  const customerEmail = customerContext ? eventText(appointment.customer_email, 320) : "";
  const siteContactPhone = customerContext ? eventText(appointment.site_contact_phone, 80) : "";
  const siteContactEmail = customerContext ? eventText(appointment.site_contact_email, 320) : "";
  const appointmentType = eventLabel(appointment.appointment_type || "appointment") || "Appointment";
  const location = customerContext
    ? [appointment.address_line_1, appointment.address_line_2, appointment.suburb, appointment.site_state, appointment.postcode]
      .map((value) => eventText(value, 180)).filter(Boolean).join(", ")
    : "";
  const directionsUrl = location ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}` : "";
  const jobUrl = `${TLINK_WORK_URL}&jobId=${encodeURIComponent(eventText(appointment.work_order_id, 180))}`;
  const summary = protectedJob
    ? `TLink protected job ${workNumber}`
    : customerContext ? `${customerName} | ${appointmentType} | ${workNumber}`.slice(0, 300) : `${workNumber} | ${title}`;
  const description = protectedJob
    ? `TLink protected work. Reference ${workNumber}. ${eventText(appointment.service_category || "Trade service", 160)}. Customer identity and exact location are not shared. Open this job in TLink: ${jobUrl}`
    : [
      customerContext && `Customer: ${customerName}`,
      customerPhone && `Phone: ${customerPhone}`,
      customerEmail && `Email: ${customerEmail}`,
      customerContext && eventText(appointment.site_contact_name, 240) && `Site contact: ${eventText(appointment.site_contact_name, 240)}`,
      siteContactPhone && siteContactPhone !== customerPhone && `Site phone: ${siteContactPhone}`,
      siteContactEmail && siteContactEmail !== customerEmail && `Site email: ${siteContactEmail}`,
      `Appointment: ${appointmentType}`,
      `Job: ${workNumber} | ${title}`,
      `Service: ${eventLabel(appointment.service_category || "Trade service")}`,
      `Assigned worker: ${eventText(appointment.assignee_label || "Unassigned", 180)}`,
      location && `Address: ${location}`,
      directionsUrl && `Directions: ${directionsUrl}`,
      customerContext && eventText(appointment.access_instructions, 1_000) && `Access: ${eventText(appointment.access_instructions, 1_000)}`,
      customerContext && eventText(appointment.parking_instructions, 1_000) && `Parking: ${eventText(appointment.parking_instructions, 1_000)}`,
      customerContext && eventText(appointment.hazard_notes, 1_000) && `Safety notes: ${eventText(appointment.hazard_notes, 1_000)}`,
      customerContext && eventText(appointment.notes, 2_000) && `Visit notes: ${eventText(appointment.notes, 2_000)}`,
      `Open this job in TLink: ${jobUrl}`,
    ].filter(Boolean).join("\n");
  if (provider === "google_calendar") return {
    summary, description, location,
    start: { dateTime: `${String(appointment.starts_at)}:00`, timeZone: ianaTimeZones[state] || ianaTimeZones.NSW },
    end: { dateTime: `${String(appointment.ends_at)}:00`, timeZone: ianaTimeZones[state] || ianaTimeZones.NSW },
    extendedProperties: { private: { tlinkAppointmentId: String(appointment.id), tlinkRevision: String(appointment.revision || 1) } },
    visibility: "private",
  };
  return {
    subject: summary,
    body: { contentType: "text", content: description },
    start: { dateTime: String(appointment.starts_at), timeZone: windowsTimeZones[state] || windowsTimeZones.NSW },
    end: { dateTime: String(appointment.ends_at), timeZone: windowsTimeZones[state] || windowsTimeZones.NSW },
    location: { displayName: location },
    locations: location ? [{ displayName: location }] : [],
    showAs: "busy", sensitivity: "private", categories: ["TLink"], transactionId: `tlink-${String(appointment.id)}`,
  };
}

function providerDateTime(value: unknown, key: "start" | "end") {
  const block = value && typeof value === "object" ? (value as Row)[key] : undefined;
  return block && typeof block === "object" ? eventText((block as Row).dateTime, 80).slice(0, 16) : "";
}

function providerDateTimeMatches(result: Row, payload: Record<string, unknown>, key: "start" | "end") {
  const expected = providerDateTime(payload, key);
  const returned = providerDateTime(result, key);
  if (!expected || !returned) return false;
  const returnedBlock = result[key] && typeof result[key] === "object" ? result[key] as Row : {};
  const returnedRaw = eventText(returnedBlock.dateTime, 100);
  const returnedZone = eventText(returnedBlock.timeZone, 80);
  const returnedHasAbsoluteTime = /[zZ]|[+-]\d{2}:?\d{2}$/.test(returnedRaw)
    || returnedZone.toUpperCase() === "UTC";
  if (!returnedHasAbsoluteTime) return expected === returned;
  const instantText = returnedZone.toUpperCase() === "UTC" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(returnedRaw)
    ? `${returnedRaw.replace(/(\.\d{3})\d+$/, "$1")}Z`
    : returnedRaw;
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(instantText)) return false;
  const instant = new Date(instantText);
  if (!Number.isFinite(instant.getTime())) return false;
  const expectedBlock = payload[key] && typeof payload[key] === "object" ? payload[key] as Row : {};
  const requestedZone = eventText(expectedBlock.timeZone, 80);
  const timeZone = windowsToIanaTimeZones[requestedZone] || requestedZone;
  if (!timeZone) return false;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === expected;
  } catch {
    return false;
  }
}

async function googleCalendarEventId(payload: Record<string, unknown>) {
  const extended = payload.extendedProperties && typeof payload.extendedProperties === "object"
    ? payload.extendedProperties as Row : {};
  const privateProperties = extended.private && typeof extended.private === "object"
    ? extended.private as Row : {};
  const appointmentId = eventText(privateProperties.tlinkAppointmentId, 180);
  if (!appointmentId) return "";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tlink:${appointmentId}`)));
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0; let value = 0; let encoded = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
  return `tlink${encoded}`;
}

class CalendarProviderTimeMismatchError extends Error {
  readonly externalEventId: string;
  readonly externalUrl: string;

  constructor(externalEventId: string, externalUrl: string) {
    super("CALENDAR_PROVIDER_TIME_MISMATCH");
    this.externalEventId = externalEventId;
    this.externalUrl = externalUrl;
  }
}

async function providerRequest(provider: CalendarProvider, accessToken: string, externalEventId: string, payload: Record<string, unknown>) {
  const updating = Boolean(externalEventId);
  const url = provider === "google_calendar"
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events${updating ? `/${encodeURIComponent(externalEventId)}` : ""}`
    : `https://graph.microsoft.com/v1.0/me/events${updating ? `/${encodeURIComponent(externalEventId)}` : ""}`;
  const googleEventId = provider === "google_calendar" ? await googleCalendarEventId(payload) : "";
  const requestPayload: Record<string, unknown> = { ...payload, ...(!updating && googleEventId ? { id: googleEventId } : {}) };
  if (updating && provider === "microsoft_calendar") delete requestPayload.transactionId;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" };
  if (provider === "microsoft_calendar") {
    const start = payload.start && typeof payload.start === "object" ? payload.start as Row : {};
    const timeZone = eventText(start.timeZone, 80).replace(/["\r\n]/g, "");
    if (timeZone) headers.Prefer = `outlook.timezone="${timeZone}"`;
  }
  let mode: "created" | "updated" = updating ? "updated" : "created";
  let response = await calendarProviderFetch(url, { method: updating ? "PATCH" : "POST", headers, body: JSON.stringify(requestPayload) });
  if (updating && response.status === 404) {
    const createUrl = provider === "google_calendar" ? "https://www.googleapis.com/calendar/v3/calendars/primary/events" : "https://graph.microsoft.com/v1.0/me/events";
    const recreatePayload = provider === "google_calendar" && googleEventId ? { ...payload, id: googleEventId } : payload;
    response = await calendarProviderFetch(createUrl, { method: "POST", headers, body: JSON.stringify(recreatePayload) });
    mode = "created";
  }
  if (provider === "google_calendar" && googleEventId && mode === "created" && response.status === 409) {
    response = await calendarProviderFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      { method: "PATCH", headers, body: JSON.stringify(payload) },
    );
    mode = "updated";
  }
  const result = await response.json().catch(() => ({})) as Row;
  if (!response.ok || !result.id) throw new Error(response.status === 401 ? "CALENDAR_RECONNECT_REQUIRED" : "CALENDAR_PROVIDER_FAILED");
  if (!providerDateTimeMatches(result, payload, "start")
    || !providerDateTimeMatches(result, payload, "end")) {
    throw new CalendarProviderTimeMismatchError(
      String(result.id),
      String(result.htmlLink || result.webLink || ""),
    );
  }
  return { id: String(result.id), url: String(result.htmlLink || result.webLink || ""), mode };
}

async function syncProvider(ownerUid: string, provider: CalendarProvider, connection: Row, appointments: Row[], options: CalendarSyncOptions = {}) {
  const db = getD1(); const credentials = await activeCredentials(provider, connection);
  let attempted = 0; let created = 0; let updated = 0; let unchanged = 0; let synced = 0; let failed = 0; let providerError = "";
  for (const appointment of appointments) {
    const now = new Date().toISOString();
    const mapping = await db.prepare(`SELECT * FROM trade_crm_calendar_events WHERE firebase_uid = ? AND appointment_id = ? AND provider = ?`)
      .bind(ownerUid, appointment.id, provider).first<Row>();
    if (!options.force && mapping?.status === "synced" && Number(mapping.appointment_revision) === Number(appointment.revision || 1)) {
      synced += 1; unchanged += 1; continue;
    }
    try {
      attempted += 1;
      const remote = await providerRequest(provider, String(credentials.access_token || ""), String(mapping?.external_event_id || ""), calendarEventDetails(provider, appointment));
      await db.prepare(`INSERT INTO trade_crm_calendar_events
        (id, firebase_uid, appointment_id, provider, external_event_id, external_url, appointment_revision, status, last_error, last_synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', '', ?, ?, ?)
        ON CONFLICT(firebase_uid, appointment_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id,
          external_url = excluded.external_url, appointment_revision = excluded.appointment_revision, status = 'synced',
          last_error = '', last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), ownerUid, appointment.id, provider, remote.id, remote.url, Number(appointment.revision || 1), now, now, now).run();
      synced += 1;
      if (remote.mode === "created") created += 1;
      else updated += 1;
    } catch (error) {
      providerError = error instanceof Error ? error.message : "CALENDAR_PROVIDER_FAILED"; failed += 1;
      const mismatch = error instanceof CalendarProviderTimeMismatchError ? error : null;
      const externalEventId = mismatch?.externalEventId || String(mapping?.external_event_id || "");
      const externalUrl = mismatch?.externalUrl || String(mapping?.external_url || "");
      await db.prepare(`INSERT INTO trade_crm_calendar_events
        (id, firebase_uid, appointment_id, provider, external_event_id, external_url, appointment_revision, status, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'error', ?, ?, ?)
        ON CONFLICT(firebase_uid, appointment_id, provider) DO UPDATE SET
          external_event_id = CASE WHEN excluded.external_event_id <> '' THEN excluded.external_event_id ELSE trade_crm_calendar_events.external_event_id END,
          external_url = CASE WHEN excluded.external_url <> '' THEN excluded.external_url ELSE trade_crm_calendar_events.external_url END,
          appointment_revision = excluded.appointment_revision, status = 'error', last_error = excluded.last_error,
          updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), ownerUid, appointment.id, provider, externalEventId, externalUrl,
          Number(appointment.revision || 1), providerError, now, now).run();
    }
  }
  const now = new Date().toISOString();
  await db.prepare(`UPDATE trade_crm_integrations SET last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
    .bind(now, providerError, now, connection.id, ownerUid).run();
  return { attempted, created, updated, unchanged, synced, failed };
}

export async function syncCalendarConnections(ownerUid: string, connections: Row[], appointments: Row[], options: CalendarSyncOptions = {}) {
  const db = getD1(); let attempted = 0; let created = 0; let updated = 0; let unchanged = 0; let synced = 0; let failed = 0;
  for (const connection of connections) {
    const provider = String(connection.provider) as CalendarProvider;
    if (!CALENDAR_PROVIDERS.includes(provider)) continue;
    try {
      const result = await syncProvider(ownerUid, provider, connection, appointments, options);
      attempted += result.attempted; created += result.created; updated += result.updated;
      unchanged += result.unchanged; synced += result.synced; failed += result.failed;
    } catch (error) {
      failed += appointments.length || 1;
      const message = error instanceof Error ? error.message : "CALENDAR_PROVIDER_FAILED";
      await db.prepare("UPDATE trade_crm_integrations SET last_error = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(message, new Date().toISOString(), connection.id, ownerUid).run();
    }
  }
  return { attempted, created, updated, unchanged, synced, failed };
}

export async function syncCreatedAppointmentToConnectedCalendars(ownerUid: string, appointmentId: string, options: CalendarSyncOptions = {}) {
  const db = getD1();
  const [connections, appointment] = await Promise.all([
    db.prepare(`SELECT * FROM trade_crm_integrations
      WHERE firebase_uid = ? AND provider IN ('google_calendar', 'microsoft_calendar') AND status = 'connected'`)
      .bind(ownerUid).all<Row>(),
    db.prepare(`SELECT a.id, a.appointment_type, a.notes, a.starts_at, a.ends_at, a.assignee_label, a.revision,
        w.id AS work_order_id, w.work_number, w.title, w.service_category, w.site_area, w.source_type, d.customer_source,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
        TRIM(COALESCE(cc.first_name, '') || ' ' || COALESCE(cc.last_name, '')) site_contact_name,
        c.email customer_email, c.phone customer_phone, cc.email site_contact_email, cc.phone site_contact_phone,
        COALESCE(NULLIF(s.address_line_1, ''), c.address_line_1) address_line_1,
        COALESCE(NULLIF(s.address_line_2, ''), c.address_line_2) address_line_2,
        COALESCE(NULLIF(s.suburb, ''), c.suburb) suburb,
        COALESCE(NULLIF(s.address_state, ''), c.address_state) site_state,
        COALESCE(NULLIF(s.postcode, ''), c.postcode) postcode,
        s.access_instructions, s.parking_instructions, s.hazard_notes, t.address_state account_state
      FROM trade_crm_appointments a
      JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      JOIN trade_accounts t ON t.firebase_uid = a.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
        AND s.customer_id = c.id AND s.record_status = 'active'
      LEFT JOIN trade_crm_site_contacts sc ON sc.id = (
        SELECT candidate.id FROM trade_crm_site_contacts candidate
        WHERE candidate.firebase_uid = w.firebase_uid AND candidate.service_site_id = s.id AND candidate.record_status = 'active'
        ORDER BY candidate.is_primary DESC, candidate.created_at, candidate.id LIMIT 1
      )
      LEFT JOIN trade_crm_customer_contacts cc ON cc.id = sc.customer_contact_id
        AND cc.firebase_uid = w.firebase_uid AND cc.customer_id = c.id AND cc.record_status = 'active'
      WHERE a.firebase_uid = ? AND a.id = ? AND a.status = 'scheduled'`)
      .bind(ownerUid, appointmentId).first<Row>(),
  ]);
  if (!connections.results.length) return { connected: 0, attempted: 0, created: 0, updated: 0, unchanged: 0, synced: 0, failed: 0 };
  if (!appointment) throw new Error("CALENDAR_APPOINTMENT_NOT_FOUND");
  const result = await syncCalendarConnections(ownerUid, connections.results, [appointment], options);
  return { connected: connections.results.length, ...result };
}
