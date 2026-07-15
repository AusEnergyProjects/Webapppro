import { getD1 } from "../../../../../../db";
import { cleanAdminText } from "@/lib/admin-server";
import { encryptIntegrationCredentials, integrationStateHash } from "@/lib/trade-integration-crypto";
import { isIntegrationProvider, providerSetting } from "@/lib/trade-integrations-server";

export const runtime = "edge";

type CallbackContext = { params: Promise<{ provider: string }> };

function dashboardRedirect(request: Request, provider: string, status: "connected" | "cancelled" | "failed") {
  const url = new URL("/direct-trade/dashboard", request.url);
  url.searchParams.set("integration", provider);
  url.searchParams.set("integration_status", status);
  url.hash = "business-hub";
  return Response.redirect(url.toString(), 303);
}

async function tokenExchange(provider: string, code: string, redirectUri: string) {
  if (!isIntegrationProvider(provider)) throw new Error("PROVIDER_INVALID");
  const setting = providerSetting(provider);
  let response: Response;
  if (provider === "square") {
    response = await fetch(setting.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Square-Version": "2026-05-20" },
      body: JSON.stringify({ client_id: setting.clientId, client_secret: setting.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
  } else if (provider === "stripe") {
    response = await fetch(setting.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_secret: setting.clientSecret, code, grant_type: "authorization_code" }),
    });
  } else {
    const body = new URLSearchParams({ client_id: setting.clientId, client_secret: setting.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (provider === "xero") {
      body.delete("client_id"); body.delete("client_secret");
      headers.Authorization = `Basic ${btoa(`${setting.clientId}:${setting.clientSecret}`)}`;
    }
    response = await fetch(setting.tokenUrl, { method: "POST", headers, body });
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !payload.access_token) throw new Error("TOKEN_EXCHANGE_FAILED");
  return payload;
}

async function connectionIdentity(provider: string, token: Record<string, unknown>, requestUrl: URL) {
  if (!isIntegrationProvider(provider)) throw new Error("PROVIDER_INVALID");
  const accessToken = String(token.access_token || "");
  if (provider === "xero") {
    const response = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const connections = await response.json().catch(() => []) as Array<Record<string, unknown>>;
    const first = connections[0];
    if (!response.ok || !first?.tenantId) throw new Error("ACCOUNT_LOOKUP_FAILED");
    return { id: String(first.tenantId), label: String(first.tenantName || "Xero organisation") };
  }
  if (provider === "myob") {
    const businessId = cleanAdminText(requestUrl.searchParams.get("businessId"), 1000);
    const user = token.user && typeof token.user === "object" ? token.user as Record<string, unknown> : {};
    if (!businessId) throw new Error("ACCOUNT_LOOKUP_FAILED");
    return { id: businessId, label: cleanAdminText(user.username, 180) || "MYOB business" };
  }
  if (provider === "stripe") {
    const accountId = cleanAdminText(token.stripe_user_id, 180);
    if (!accountId) throw new Error("ACCOUNT_LOOKUP_FAILED");
    return { id: accountId, label: `Stripe account ${accountId.slice(-6)}` };
  }
  const setting = providerSetting(provider);
  const response = await fetch(setting.tokenUrl.replace("/oauth2/token", "/v2/locations"), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Square-Version": "2026-05-20" },
  });
  const result = await response.json().catch(() => ({})) as { locations?: Array<Record<string, unknown>> };
  const location = result.locations?.find((item) => item.status === "ACTIVE") || result.locations?.[0];
  const merchantId = cleanAdminText(token.merchant_id, 180);
  if (!response.ok || !merchantId || !location?.id) throw new Error("ACCOUNT_LOOKUP_FAILED");
  return { id: merchantId, label: cleanAdminText(location.name, 180) || "Square business", locationId: String(location.id) };
}

export async function GET(request: Request, context: CallbackContext) {
  const provider = cleanAdminText((await context.params).provider, 20).toLowerCase();
  if (!isIntegrationProvider(provider)) return dashboardRedirect(request, "unknown", "failed");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return dashboardRedirect(request, provider, "cancelled");
  const state = cleanAdminText(url.searchParams.get("state"), 300);
  const code = cleanAdminText(url.searchParams.get("code"), 2000);
  if (!state || !code) return dashboardRedirect(request, provider, "failed");
  try {
    const db = getD1();
    const now = new Date().toISOString();
    const stateHash = await integrationStateHash(state);
    const stateRow = await db.prepare(`SELECT id, firebase_uid, provider, redirect_uri FROM trade_crm_oauth_states
      WHERE state_hash = ? AND provider = ? AND consumed_at = '' AND expires_at > ?`)
      .bind(stateHash, provider, now).first<Record<string, unknown>>();
    if (!stateRow) throw new Error("STATE_INVALID");
    const consumed = await db.prepare(`UPDATE trade_crm_oauth_states SET consumed_at = ?
      WHERE id = ? AND consumed_at = '' AND expires_at > ?`).bind(now, stateRow.id, now).run();
    if (Number(consumed.meta.changes || 0) !== 1) throw new Error("STATE_INVALID");
    const token = await tokenExchange(provider, code, String(stateRow.redirect_uri));
    const account = await connectionIdentity(provider, token, url);
    const credentials: Record<string, unknown> = provider === "stripe"
      ? { token_type: "stripe_account" }
      : {
          access_token: token.access_token,
          refresh_token: token.refresh_token || "",
          token_type: token.token_type || "bearer",
        };
    if ("locationId" in account) credentials.location_id = account.locationId;
    const setting = providerSetting(provider);
    const expiresAt = provider === "square"
      ? cleanAdminText(token.expires_at, 60)
      : Number(token.expires_in || 0) > 0 ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : "";
    await db.prepare(`INSERT INTO trade_crm_integrations
      (id, firebase_uid, provider, status, external_account_id, external_account_label, encrypted_credentials,
       scopes, token_expires_at, last_sync_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, 'connected', ?, ?, ?, ?, ?, '', '', ?, ?)
      ON CONFLICT(firebase_uid, provider) DO UPDATE SET status = 'connected',
        external_account_id = excluded.external_account_id, external_account_label = excluded.external_account_label,
        encrypted_credentials = excluded.encrypted_credentials, scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at, last_error = '', updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), stateRow.firebase_uid, provider, account.id, account.label,
        await encryptIntegrationCredentials(credentials), JSON.stringify(setting.scopes), expiresAt, now, now).run();
    return dashboardRedirect(request, provider, "connected");
  } catch {
    return dashboardRedirect(request, provider, "failed");
  }
}
