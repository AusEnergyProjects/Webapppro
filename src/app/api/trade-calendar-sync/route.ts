import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/trade-integration-crypto";
import { providerConfigured, providerSetting, requireInstallerOperations } from "@/lib/trade-integrations-server";
import { addCalendarDays, normaliseWeekStart } from "@/lib/trade-schedule";

export const runtime = "edge";

type Row = Record<string, unknown>;
type CalendarProvider = "google_calendar" | "microsoft_calendar";
const CALENDAR_PROVIDERS: CalendarProvider[] = ["google_calendar", "microsoft_calendar"];
const ianaTimeZones: Record<string, string> = {
  ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth",
};
const windowsTimeZones: Record<string, string> = {
  ACT: "AUS Eastern Standard Time", NSW: "AUS Eastern Standard Time", NT: "AUS Central Standard Time",
  QLD: "E. Australia Standard Time", SA: "Cen. Australia Standard Time", TAS: "Tasmania Standard Time",
  VIC: "AUS Eastern Standard Time", WA: "W. Australia Standard Time",
};

function calendarError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "This installer account does not currently have calendar access." }, 403);
  if (code === "INVALID_WEEK") return adminJson({ ok: false, error: "Choose a valid schedule week." }, 400);
  return adminJson({ ok: false, error: "Calendar sync could not be completed." }, 500);
}

async function providerRows(ownerUid: string) {
  const result = await getD1().prepare(`SELECT provider, status, external_account_label, last_sync_at, last_error
    FROM trade_crm_integrations WHERE firebase_uid = ? AND provider IN ('google_calendar', 'microsoft_calendar')`)
    .bind(ownerUid).all<Row>();
  const byProvider = Object.fromEntries(result.results.map((row) => [String(row.provider), row]));
  return CALENDAR_PROVIDERS.map((provider) => {
    const setting = providerSetting(provider); const row = byProvider[provider];
    return { provider, label: setting.label, configured: providerConfigured(provider),
      status: row?.status === "connected" ? "connected" : "not_connected", accountLabel: row?.external_account_label || "",
      lastSyncAt: row?.last_sync_at || "", lastError: row?.last_error || "" };
  });
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
  const response = await fetch(setting.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
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

function eventDetails(provider: CalendarProvider, appointment: Row) {
  const protectedJob = appointment.source_type === "opportunity" || appointment.customer_source === "platform_private";
  const state = String(appointment.site_state || appointment.account_state || "NSW").toUpperCase();
  const summary = protectedJob ? `TLink protected job ${String(appointment.work_number)}` : `${String(appointment.work_number)} | ${String(appointment.title)}`;
  const description = protectedJob
    ? `TLink protected work. Reference ${String(appointment.work_number)}. ${String(appointment.service_category || "Trade service")}. Customer identity and exact location are not shared.`
    : `TLink job ${String(appointment.work_number)}. Assigned to ${String(appointment.assignee_label || "Unassigned")}. Open TLink to view the current job record.`;
  const location = protectedJob ? "" : [appointment.address_line_1, appointment.address_line_2, appointment.suburb, appointment.site_state, appointment.postcode].filter(Boolean).join(", ");
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
    location: location ? { displayName: location } : undefined,
    showAs: "busy", sensitivity: "private", categories: ["TLink"], transactionId: `tlink-${String(appointment.id)}`,
  };
}

async function providerRequest(provider: CalendarProvider, accessToken: string, externalEventId: string, payload: Record<string, unknown>) {
  const updating = Boolean(externalEventId);
  const url = provider === "google_calendar"
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events${updating ? `/${encodeURIComponent(externalEventId)}` : ""}`
    : `https://graph.microsoft.com/v1.0/me/events${updating ? `/${encodeURIComponent(externalEventId)}` : ""}`;
  const requestPayload = { ...payload };
  if (updating && provider === "microsoft_calendar") delete requestPayload.transactionId;
  let response = await fetch(url, { method: updating ? "PATCH" : "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(requestPayload) });
  if (updating && response.status === 404) {
    const createUrl = provider === "google_calendar" ? "https://www.googleapis.com/calendar/v3/calendars/primary/events" : "https://graph.microsoft.com/v1.0/me/events";
    response = await fetch(createUrl, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
  }
  const result = await response.json().catch(() => ({})) as Row;
  if (!response.ok || !result.id) throw new Error(response.status === 401 ? "CALENDAR_RECONNECT_REQUIRED" : "CALENDAR_PROVIDER_FAILED");
  return { id: String(result.id), url: String(result.htmlLink || result.webLink || "") };
}

async function syncProvider(ownerUid: string, provider: CalendarProvider, connection: Row, appointments: Row[]) {
  const db = getD1(); const credentials = await activeCredentials(provider, connection); let synced = 0; let failed = 0; let providerError = "";
  for (const appointment of appointments) {
    const now = new Date().toISOString();
    const mapping = await db.prepare(`SELECT * FROM trade_crm_calendar_events WHERE firebase_uid = ? AND appointment_id = ? AND provider = ?`)
      .bind(ownerUid, appointment.id, provider).first<Row>();
    if (mapping?.status === "synced" && Number(mapping.appointment_revision) === Number(appointment.revision || 1)) { synced += 1; continue; }
    try {
      const remote = await providerRequest(provider, String(credentials.access_token || ""), String(mapping?.external_event_id || ""), eventDetails(provider, appointment));
      await db.prepare(`INSERT INTO trade_crm_calendar_events
        (id, firebase_uid, appointment_id, provider, external_event_id, external_url, appointment_revision, status, last_error, last_synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', '', ?, ?, ?)
        ON CONFLICT(firebase_uid, appointment_id, provider) DO UPDATE SET external_event_id = excluded.external_event_id,
          external_url = excluded.external_url, appointment_revision = excluded.appointment_revision, status = 'synced',
          last_error = '', last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), ownerUid, appointment.id, provider, remote.id, remote.url, Number(appointment.revision || 1), now, now, now).run();
      synced += 1;
    } catch (error) {
      providerError = error instanceof Error ? error.message : "CALENDAR_PROVIDER_FAILED"; failed += 1;
      await db.prepare(`INSERT INTO trade_crm_calendar_events
        (id, firebase_uid, appointment_id, provider, appointment_revision, status, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?)
        ON CONFLICT(firebase_uid, appointment_id, provider) DO UPDATE SET appointment_revision = excluded.appointment_revision,
          status = 'error', last_error = excluded.last_error, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), ownerUid, appointment.id, provider, Number(appointment.revision || 1), providerError, now, now).run();
    }
  }
  const now = new Date().toISOString();
  await db.prepare(`UPDATE trade_crm_integrations SET last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
    .bind(now, providerError, now, connection.id, ownerUid).run();
  return { synced, failed };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    return adminJson({ ok: true, providers: await providerRows(identity.uid) });
  } catch (error) { return calendarError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const body = await request.json().catch(() => ({})) as Row;
    const weekStart = normaliseWeekStart(body.weekStart); const weekEnd = addCalendarDays(weekStart, 7); const db = getD1();
    const [connections, appointmentResult] = await Promise.all([
      db.prepare(`SELECT * FROM trade_crm_integrations WHERE firebase_uid = ? AND provider IN ('google_calendar', 'microsoft_calendar') AND status = 'connected'`).bind(identity.uid).all<Row>(),
      db.prepare(`SELECT a.id, a.starts_at, a.ends_at, a.assignee_label, a.revision, w.work_number, w.title,
          w.service_category, w.site_area, w.source_type, d.customer_source, s.address_line_1, s.address_line_2,
          s.suburb, s.address_state site_state, s.postcode, t.address_state account_state
        FROM trade_crm_appointments a
        JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
        JOIN trade_accounts t ON t.firebase_uid = a.firebase_uid
        LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
        LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
        WHERE a.firebase_uid = ? AND a.status = 'scheduled' AND a.starts_at < ? AND a.ends_at >= ?
        ORDER BY a.starts_at LIMIT 250`).bind(identity.uid, `${weekEnd}T00:00`, `${weekStart}T00:00`).all<Row>(),
    ]);
    if (!connections.results.length) return adminJson({ ok: false, error: "Connect Google Calendar or Outlook before syncing." }, 409);
    let synced = 0; let failed = 0;
    for (const connection of connections.results) {
      const provider = String(connection.provider) as CalendarProvider;
      if (!CALENDAR_PROVIDERS.includes(provider)) continue;
      try { const result = await syncProvider(identity.uid, provider, connection, appointmentResult.results); synced += result.synced; failed += result.failed; }
      catch (error) {
        failed += appointmentResult.results.length || 1;
        const message = error instanceof Error ? error.message : "CALENDAR_PROVIDER_FAILED";
        await db.prepare("UPDATE trade_crm_integrations SET last_error = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(message, new Date().toISOString(), connection.id, identity.uid).run();
      }
    }
    return adminJson({ ok: true, synced, failed, providers: await providerRows(identity.uid) });
  } catch (error) { return calendarError(error); }
}
