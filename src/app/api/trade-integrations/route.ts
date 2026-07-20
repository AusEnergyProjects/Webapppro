import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { decryptIntegrationCredentials, encryptIntegrationCredentials, integrationStateHash, newIntegrationState } from "@/lib/trade-integration-crypto";
import {
  INTEGRATION_PROVIDERS,
  integrationCallbackUri,
  isIntegrationProvider,
  providerConfigured,
  providerSetting,
  requireInstallerOperations,
  type IntegrationProvider,
} from "@/lib/trade-integrations-server";
import { normaliseWeekStart } from "@/lib/trade-schedule";

export const runtime = "edge";

function integrationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Business integrations are available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using business integrations." }, 403);
  if (code === "INVALID_WEEK") return adminJson({ ok: false, error: "Choose a valid schedule week." }, 400);
  return adminJson({ ok: false, error: "The integration request could not be completed." }, 500);
}

function providerReadiness(provider: IntegrationProvider, connected?: Record<string, unknown>) {
  const setting = providerSetting(provider);
  return {
    provider,
    label: setting.label,
    purpose: setting.purpose,
    configured: providerConfigured(provider),
    status: connected?.status === "connected" ? "connected" : "not_connected",
    accountLabel: connected?.external_account_label || "",
    connectedAt: connected?.created_at || "",
    lastSyncAt: connected?.last_sync_at || "",
    lastError: connected?.last_error || "",
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const db = getD1();
    const [connections, links] = await Promise.all([
      db.prepare(`SELECT provider, status, external_account_label, created_at, last_sync_at, last_error
        FROM trade_crm_integrations WHERE firebase_uid = ? ORDER BY provider`).bind(identity.uid).all<Record<string, unknown>>(),
      db.prepare(`SELECT id, work_order_id, commercial_reference, purpose, provider, external_id, amount_cents, paid_amount_cents,
          checkout_url, status, paid_at, failure_code, last_event_at, created_at
        FROM trade_crm_payment_links WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT 100`)
        .bind(identity.uid).all<Record<string, unknown>>(),
    ]);
    const connectedByProvider = Object.fromEntries(connections.results.map((row) => [String(row.provider), row]));
    return adminJson({
      ok: true,
      providers: INTEGRATION_PROVIDERS.map((provider) => providerReadiness(provider, connectedByProvider[provider])),
      paymentLinks: links.results.map((row) => ({
        id: row.id, workOrderId: row.work_order_id, commercialReference: row.commercial_reference, purpose: row.purpose,
        provider: row.provider, externalId: row.external_id,
        amountCents: Number(row.amount_cents || 0), paidAmountCents: Number(row.paid_amount_cents || 0),
        checkoutUrl: row.checkout_url, status: row.status, paidAt: row.paid_at,
        failureCode: row.failure_code, lastEventAt: row.last_event_at, createdAt: row.created_at,
      })),
    });
  } catch (error) { return integrationError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid integration request." }, 400); }
    const providerValue = cleanAdminText(body.provider, 40).toLowerCase();
    if (!isIntegrationProvider(providerValue)) return adminJson({ ok: false, error: "Choose a supported provider." }, 400);
    const setting = providerSetting(providerValue);
    if (!providerConfigured(providerValue)) {
      return adminJson({ ok: false, error: `TLink is still preparing the secure ${setting.label} connection.` }, 503);
    }
    const now = new Date();
    const calendarProvider = providerValue === "google_calendar" || providerValue === "microsoft_calendar";
    const returnWeekStart = calendarProvider && body.weekStart ? normaliseWeekStart(body.weekStart) : "";
    const state = newIntegrationState(returnWeekStart);
    const redirectUri = integrationCallbackUri(request, providerValue);
    const db = getD1();
    await db.batch([
      db.prepare("DELETE FROM trade_crm_oauth_states WHERE expires_at < ? OR consumed_at <> ''").bind(now.toISOString()),
      db.prepare(`INSERT INTO trade_crm_oauth_states
        (id, firebase_uid, provider, state_hash, redirect_uri, expires_at, consumed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, '', ?)`)
        .bind(crypto.randomUUID(), identity.uid, providerValue, await integrationStateHash(state), redirectUri,
          new Date(now.getTime() + 10 * 60 * 1000).toISOString(), now.toISOString()),
    ]);
    const authorization = new URL(setting.authorizeUrl);
    authorization.searchParams.set("client_id", setting.clientId);
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", setting.scopes.join(" "));
    authorization.searchParams.set("state", state);
    if (providerValue === "myob") authorization.searchParams.set("prompt", "consent");
    if (providerValue === "square") authorization.searchParams.set("session", "false");
    if (providerValue === "google_calendar") { authorization.searchParams.set("access_type", "offline"); authorization.searchParams.set("prompt", "consent"); }
    return adminJson({ ok: true, authorizationUrl: authorization.toString() });
  } catch (error) { return integrationError(error); }
}

async function activeXeroRevocationCredentials(row: Record<string, unknown>, credentials: Record<string, unknown>) {
  const expiresAt = Date.parse(String(row.token_expires_at || ""));
  if (credentials.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 2 * 60 * 1000) return credentials;
  if (!credentials.refresh_token) throw new Error("XERO_DISCONNECT_FAILED");
  const setting = providerSetting("xero");
  const response = await fetch(setting.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${setting.clientId}:${setting.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token) }),
  });
  const refreshed = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !refreshed.access_token) throw new Error("XERO_DISCONNECT_FAILED");
  const next = {
    ...credentials,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || credentials.refresh_token,
    token_type: refreshed.token_type || credentials.token_type || "bearer",
  };
  const tokenExpiresAt = Number(refreshed.expires_in || 0) > 0
    ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
    : "";
  await getD1().prepare(`UPDATE trade_crm_integrations SET encrypted_credentials = ?, token_expires_at = ?,
      last_error = '', updated_at = ? WHERE id = ? AND firebase_uid = ?`)
    .bind(await encryptIntegrationCredentials(next),
      tokenExpiresAt, new Date().toISOString(), row.id, row.firebase_uid).run();
  return next;
}

async function bestEffortRevoke(provider: IntegrationProvider, row: Record<string, unknown>) {
  let credentials: Record<string, unknown>;
  try { credentials = await decryptIntegrationCredentials(String(row.encrypted_credentials || "")); }
  catch { return false; }
  const setting = providerSetting(provider);
  try {
    const externalMetadata = credentials.external_metadata && typeof credentials.external_metadata === "object"
      ? credentials.external_metadata as Record<string, unknown>
      : {};
    if (provider === "xero") {
      credentials = await activeXeroRevocationCredentials(row, credentials);
      let xeroConnectionId = cleanAdminText(externalMetadata.connectionId, 180);
      if (!xeroConnectionId) {
        const connectionsResponse = await fetch("https://api.xero.com/connections", {
          headers: { Authorization: `Bearer ${String(credentials.access_token)}`, Accept: "application/json" },
        });
        const connections = await connectionsResponse.json().catch(() => []) as Array<Record<string, unknown>>;
        if (!connectionsResponse.ok) throw new Error("XERO_DISCONNECT_FAILED");
        const matchingConnection = connections.find((connection) => cleanAdminText(connection.tenantId, 180) === cleanAdminText(row.external_account_id, 180));
        xeroConnectionId = cleanAdminText(matchingConnection?.id, 180);
      }
      if (!xeroConnectionId) throw new Error("XERO_DISCONNECT_FAILED");
      const response = await fetch(`https://api.xero.com/connections/${encodeURIComponent(xeroConnectionId)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${String(credentials.access_token)}` },
      });
      if (!response.ok && response.status !== 404) throw new Error("XERO_DISCONNECT_FAILED");
    } else if (provider === "stripe" && row.external_account_id) {
      const body = new URLSearchParams({ client_id: setting.clientId, stripe_user_id: String(row.external_account_id) });
      await fetch("https://connect.stripe.com/oauth/deauthorize", {
        method: "POST", headers: { Authorization: `Bearer ${setting.clientSecret}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
    } else if (provider === "square" && credentials.access_token) {
      await fetch(setting.tokenUrl.replace("/token", "/revoke"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Client ${setting.clientSecret}`, "Square-Version": "2026-05-20" },
        body: JSON.stringify({ client_id: setting.clientId, access_token: credentials.access_token }),
      });
    }
    return true;
  } catch { return false; }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid integration request." }, 400); }
    const providerValue = cleanAdminText(body.provider, 40).toLowerCase();
    if (!isIntegrationProvider(providerValue)) return adminJson({ ok: false, error: "Choose a supported provider." }, 400);
    const db = getD1();
    const row = await db.prepare(`SELECT * FROM trade_crm_integrations WHERE firebase_uid = ? AND provider = ?`)
      .bind(identity.uid, providerValue).first<Record<string, unknown>>();
    if (row && !(await bestEffortRevoke(providerValue, row)) && providerValue === "xero") {
      return adminJson({ ok: false, error: "Xero could not confirm the disconnect. The TLink connection was kept so you can try again safely." }, 502);
    }
    await db.prepare("DELETE FROM trade_crm_integrations WHERE firebase_uid = ? AND provider = ?")
      .bind(identity.uid, providerValue).run();
    return adminJson({ ok: true });
  } catch (error) { return integrationError(error); }
}
