import { getD1 } from "../../../../../../db";
import { cleanAdminText } from "@/lib/admin-server";
import { encryptIntegrationCredentials, integrationStateHash } from "@/lib/trade-integration-crypto";
import { calendarIntegrationStateWeekStart } from "@/lib/trade-integration-state";
import { isIntegrationProvider, providerSetting } from "@/lib/trade-integrations-server";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";

export const runtime = "edge";

type CallbackContext = { params: Promise<{ provider: string }> };

type OAuthCallbackStage = "request" | "state" | "authorization" | "token_exchange" | "account_lookup" | "callback";

class OAuthCallbackFailure extends Error {
  constructor(
    message: string,
    readonly stage: OAuthCallbackStage,
    readonly providerCode = "",
    readonly responseStatus = 0,
  ) {
    super(message);
    this.name = "OAuthCallbackFailure";
  }
}

function sanitiseProviderErrorCode(value: unknown) {
  const code = cleanAdminText(value, 80).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^[a-z][a-z0-9._]{0,63}$/.test(code) ? code : "";
}

function providerErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const result = payload as Record<string, unknown>;
  const nested = Array.isArray(result.errors) && result.errors[0] && typeof result.errors[0] === "object"
    ? result.errors[0] as Record<string, unknown>
    : {};
  return [result.error, result.error_code, result.code, nested.code, nested.category]
    .map(sanitiseProviderErrorCode)
    .find(Boolean) || "";
}

function callbackFailureDetails(provider: string, error: unknown) {
  if (!(error instanceof OAuthCallbackFailure)) {
    return { provider, stage: "callback", failure: "CALLBACK_FAILED" };
  }
  return {
    provider,
    stage: error.stage,
    failure: error.message,
    ...(error.providerCode ? { providerCode: error.providerCode } : {}),
    ...(error.responseStatus ? { responseStatus: error.responseStatus } : {}),
  };
}

function dashboardRedirect(request: Request, provider: string, status: "connected" | "cancelled" | "failed", weekStart = "") {
  const url = new URL("/direct-trade/dashboard", request.url);
  url.searchParams.set("integration", provider);
  url.searchParams.set("integration_status", status);
  if (provider === "google_calendar" || provider === "microsoft_calendar") {
    url.searchParams.set("workspace", "schedule");
    if (weekStart) url.searchParams.set("integration_week_start", weekStart);
  }
  url.hash = "business-hub";
  return Response.redirect(url.toString(), 303);
}

async function tokenExchange(provider: string, code: string, redirectUri: string) {
  if (!isIntegrationProvider(provider)) throw new Error("PROVIDER_INVALID");
  const setting = providerSetting(provider);
  const body = new URLSearchParams({ client_id: setting.clientId, client_secret: setting.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider === "myob") body.set("scope", setting.scopes.join(" "));
  if (provider === "xero" || provider === "quickbooks") {
    body.delete("client_id"); body.delete("client_secret");
    headers.Authorization = `Basic ${btoa(`${setting.clientId}:${setting.clientSecret}`)}`;
  }
  const response = await fetch(setting.tokenUrl, { method: "POST", headers, body });
  const decoded = await response.json().catch(() => ({})) as unknown;
  const payload = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
  if (!response.ok) {
    throw new OAuthCallbackFailure("TOKEN_EXCHANGE_REJECTED", "token_exchange", providerErrorCode(decoded), response.status);
  }
  if (!payload.access_token) throw new OAuthCallbackFailure("TOKEN_MISSING", "token_exchange", providerErrorCode(decoded), response.status);
  return payload;
}

function accessTokenAuthenticationEventId(accessToken: string) {
  const encodedPayload = accessToken.split(".")[1];
  if (!encodedPayload) return "";
  try {
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (value) => value.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    return cleanAdminText(payload.authentication_event_id, 180);
  } catch {
    return "";
  }
}

async function connectionIdentity(provider: string, token: Record<string, unknown>, requestUrl: URL) {
  if (!isIntegrationProvider(provider)) throw new Error("PROVIDER_INVALID");
  const accessToken = String(token.access_token || "");
  if (provider === "xero") {
    const response = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const decoded = await response.json().catch(() => []) as unknown;
    const connections = Array.isArray(decoded) ? decoded as Array<Record<string, unknown>> : [];
    const authenticationEventId = accessTokenAuthenticationEventId(accessToken);
    const connection = connections.find((item) => cleanAdminText(item.authEventId, 180) === authenticationEventId);
    const tenantId = cleanAdminText(connection?.tenantId, 180);
    const connectionId = cleanAdminText(connection?.id, 180);
    if (!response.ok || !authenticationEventId || !tenantId || !connectionId) {
      throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup", providerErrorCode(decoded), response.status);
    }
    return {
      id: tenantId,
      label: cleanAdminText(connection?.tenantName, 180) || "Xero organisation",
      externalMetadata: { tenantId, connectionId },
    };
  }
  if (provider === "myob") {
    const businessId = cleanAdminText(requestUrl.searchParams.get("businessId"), 1000);
    const user = token.user && typeof token.user === "object" ? token.user as Record<string, unknown> : {};
    if (!businessId) throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup");
    return { id: businessId, label: cleanAdminText(user.username, 180) || "MYOB business" };
  }
  if (provider === "quickbooks") {
    const realmId = cleanAdminText(requestUrl.searchParams.get("realmId"), 180);
    if (!realmId) throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup");
    return { id: realmId, label: `QuickBooks company ${realmId.slice(-6)}` };
  }
  if (provider === "google_calendar") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const decoded = await response.json().catch(() => ({})) as unknown;
    const result = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Record<string, unknown> : {};
    if (!response.ok || !result.sub) {
      throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup", providerErrorCode(decoded), response.status);
    }
    return { id: String(result.sub), label: cleanAdminText(result.email, 180) || "Google Calendar" };
  }
  if (provider === "microsoft_calendar") {
    const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    const decoded = await response.json().catch(() => ({})) as unknown;
    const result = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Record<string, unknown> : {};
    if (!response.ok || !result.id) {
      throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup", providerErrorCode(decoded), response.status);
    }
    return { id: String(result.id), label: cleanAdminText(result.mail || result.userPrincipalName || result.displayName, 180) || "Outlook Calendar" };
  }
  throw new OAuthCallbackFailure("ACCOUNT_LOOKUP_FAILED", "account_lookup");
}

export async function GET(request: Request, context: CallbackContext) {
  const provider = cleanAdminText((await context.params).provider, 40).toLowerCase();
  if (!isIntegrationProvider(provider)) {
    console.error("Trade integration OAuth callback failed", callbackFailureDetails("unknown", new OAuthCallbackFailure("PROVIDER_INVALID", "request")));
    return dashboardRedirect(request, "unknown", "failed");
  }
  const url = new URL(request.url);
  const state = cleanAdminText(url.searchParams.get("state"), 300);
  const code = cleanAdminText(url.searchParams.get("code"), 2000);
  if (!state) {
    console.error("Trade integration OAuth callback failed", callbackFailureDetails(provider, new OAuthCallbackFailure("STATE_MISSING", "state")));
    return dashboardRedirect(request, provider, "failed");
  }
  let returnWeekStart = "";
  try {
    const db = getD1();
    const now = new Date().toISOString();
    const stateHash = await integrationStateHash(state);
    const stateRow = await db.prepare(`SELECT id, firebase_uid, provider, redirect_uri FROM trade_crm_oauth_states
      WHERE state_hash = ? AND provider = ? AND consumed_at = '' AND expires_at > ?`)
      .bind(stateHash, provider, now).first<Record<string, unknown>>();
    if (!stateRow) throw new OAuthCallbackFailure("STATE_INVALID", "state");
    if (provider === "google_calendar" || provider === "microsoft_calendar") {
      returnWeekStart = calendarIntegrationStateWeekStart(state);
    }
    const consumed = await db.prepare(`UPDATE trade_crm_oauth_states SET consumed_at = ?
      WHERE id = ? AND consumed_at = '' AND expires_at > ?`).bind(now, stateRow.id, now).run();
    if (Number(consumed.meta.changes || 0) !== 1) throw new OAuthCallbackFailure("STATE_INVALID", "state");
    const authorizationError = url.searchParams.get("error");
    if (authorizationError) {
      const providerCode = sanitiseProviderErrorCode(authorizationError) || "provider_error";
      if (["access_denied", "user_cancelled", "user_denied"].includes(providerCode)) {
        return dashboardRedirect(request, provider, "cancelled", returnWeekStart);
      }
      throw new OAuthCallbackFailure("AUTHORIZATION_REJECTED", "authorization", providerCode);
    }
    if (!code) throw new OAuthCallbackFailure("CODE_MISSING", "authorization");
    const approvedAccount = await db.prepare(`SELECT account.firebase_uid
      FROM trade_accounts account
      WHERE account.firebase_uid = ? AND ${verifiedTradeAccountPredicate("account")}
      LIMIT 1`).bind(stateRow.firebase_uid).first();
    if (!approvedAccount) throw new OAuthCallbackFailure("TRADE_ACCESS_REVOKED", "authorization");
    const token = await tokenExchange(provider, code, String(stateRow.redirect_uri));
    const account = await connectionIdentity(provider, token, url);
    const credentials: Record<string, unknown> = {
      access_token: token.access_token,
      refresh_token: token.refresh_token || "",
      token_type: token.token_type || "bearer",
    };
    if ("externalMetadata" in account) credentials.external_metadata = account.externalMetadata;
    const setting = providerSetting(provider);
    const expiresAt = Number(token.expires_in || 0) > 0
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : "";
    const attached = await db.prepare(`INSERT INTO trade_crm_integrations
      (id, firebase_uid, provider, status, external_account_id, external_account_label, encrypted_credentials,
       scopes, token_expires_at, last_sync_at, last_error, created_at, updated_at)
      SELECT ?, approved_account.firebase_uid, ?, 'connected', ?, ?, ?, ?, ?, '', '', ?, ?
      FROM trade_accounts approved_account
      WHERE approved_account.firebase_uid = ? AND ${verifiedTradeAccountPredicate("approved_account")}
      ON CONFLICT(firebase_uid, provider) DO UPDATE SET status = 'connected',
        external_account_id = excluded.external_account_id, external_account_label = excluded.external_account_label,
        encrypted_credentials = excluded.encrypted_credentials, scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at, last_error = '', updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), provider, account.id, account.label,
        await encryptIntegrationCredentials(credentials), JSON.stringify(setting.scopes), expiresAt, now, now,
        stateRow.firebase_uid).run();
    if (Number(attached.meta.changes || 0) !== 1) {
      throw new OAuthCallbackFailure("TRADE_ACCESS_REVOKED", "authorization");
    }
    return dashboardRedirect(request, provider, "connected", returnWeekStart);
  } catch (error) {
    console.error("Trade integration OAuth callback failed", callbackFailureDetails(provider, error));
    return dashboardRedirect(request, provider, "failed", returnWeekStart);
  }
}
