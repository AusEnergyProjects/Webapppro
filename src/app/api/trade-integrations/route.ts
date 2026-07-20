import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { decryptIntegrationCredentials, integrationStateHash, newIntegrationState } from "@/lib/trade-integration-crypto";
import {
  INTEGRATION_PROVIDERS,
  integrationCallbackUri,
  isIntegrationProvider,
  providerConfigured,
  providerSetting,
  requireInstallerOperations,
  type IntegrationProvider,
} from "@/lib/trade-integrations-server";

export const runtime = "edge";

function integrationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Business integrations are available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using business integrations." }, 403);
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
    const state = newIntegrationState();
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

async function bestEffortRevoke(provider: IntegrationProvider, row: Record<string, unknown>) {
  let credentials: Record<string, unknown>;
  try { credentials = await decryptIntegrationCredentials(String(row.encrypted_credentials || "")); }
  catch { return; }
  const setting = providerSetting(provider);
  try {
    if (provider === "xero" && row.external_account_id && credentials.access_token) {
      await fetch(`https://api.xero.com/connections/${encodeURIComponent(String(row.external_account_id))}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${String(credentials.access_token)}` },
      });
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
  } catch { /* Local disconnect must still succeed if a provider is unavailable. */ }
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
    if (row) await bestEffortRevoke(providerValue, row);
    await db.prepare("DELETE FROM trade_crm_integrations WHERE firebase_uid = ? AND provider = ?")
      .bind(identity.uid, providerValue).run();
    return adminJson({ ok: true });
  } catch (error) { return integrationError(error); }
}
