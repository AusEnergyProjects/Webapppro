import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { providerConfigured, providerSetting, requireInstallerOperations } from "@/lib/trade-integrations-server";
import { CALENDAR_PROVIDERS, syncCalendarConnections } from "@/lib/trade-calendar-sync-server";
import { addCalendarDays, normaliseWeekStart } from "@/lib/trade-schedule";

export const runtime = "edge";

type Row = Record<string, unknown>;

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
    const { synced, failed } = await syncCalendarConnections(identity.uid, connections.results, appointmentResult.results);
    return adminJson({ ok: true, synced, failed, providers: await providerRows(identity.uid) });
  } catch (error) { return calendarError(error); }
}
