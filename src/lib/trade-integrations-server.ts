import { env } from "cloudflare:workers";
import { requireVerifiedTradeAccess } from "@/lib/trade-access-server";

export const INTEGRATION_PROVIDERS = ["xero", "myob", "quickbooks", "google_calendar", "microsoft_calendar"] as const;
export type IntegrationProvider = typeof INTEGRATION_PROVIDERS[number];

type ProviderSetting = {
  provider: IntegrationProvider;
  label: string;
  purpose: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

type IntegrationEnvironment = {
  CRM_INTEGRATION_ENCRYPTION_KEY?: string;
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
  MYOB_CLIENT_ID?: string;
  MYOB_CLIENT_SECRET?: string;
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  GOOGLE_CALENDAR_CLIENT_ID?: string;
  GOOGLE_CALENDAR_CLIENT_SECRET?: string;
  MICROSOFT_CALENDAR_CLIENT_ID?: string;
  MICROSOFT_CALENDAR_CLIENT_SECRET?: string;
};

export function integrationEnvironment() {
  return env as unknown as IntegrationEnvironment;
}

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export function providerSetting(provider: IntegrationProvider): ProviderSetting {
  const values = integrationEnvironment();
  if (provider === "xero") return {
    provider, label: "Xero", purpose: "Accounting and invoice sync", clientId: values.XERO_CLIENT_ID || "",
    clientSecret: values.XERO_CLIENT_SECRET || "", authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["openid", "profile", "email", "offline_access", "accounting.invoices", "accounting.contacts"],
  };
  if (provider === "myob") return {
    provider, label: "MYOB", purpose: "Accounting and invoice sync", clientId: values.MYOB_CLIENT_ID || "",
    clientSecret: values.MYOB_CLIENT_SECRET || "", authorizeUrl: "https://secure.myob.com/oauth2/account/authorize",
    tokenUrl: "https://secure.myob.com/oauth2/v1/authorize",
    scopes: ["sme-company-settings", "sme-sales", "sme-contacts-customer", "sme-general-ledger"],
  };
  if (provider === "quickbooks") return {
    provider, label: "QuickBooks", purpose: "Accounting and invoice sync", clientId: values.QUICKBOOKS_CLIENT_ID || "",
    clientSecret: values.QUICKBOOKS_CLIENT_SECRET || "", authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", scopes: ["com.intuit.quickbooks.accounting"],
  };
  if (provider === "google_calendar") return {
    provider, label: "Google Calendar", purpose: "One-way TLink appointment sync",
    clientId: values.GOOGLE_CALENDAR_CLIENT_ID || "", clientSecret: values.GOOGLE_CALENDAR_CLIENT_SECRET || "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events"],
  };
  return {
    provider, label: "Outlook Calendar", purpose: "One-way TLink appointment sync",
    clientId: values.MICROSOFT_CALENDAR_CLIENT_ID || "", clientSecret: values.MICROSOFT_CALENDAR_CLIENT_SECRET || "",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite"],
  };
}

export function providerConfigured(provider: IntegrationProvider) {
  const values = integrationEnvironment();
  const setting = providerSetting(provider);
  const baseReady = Boolean(setting.clientId && setting.clientSecret && values.CRM_INTEGRATION_ENCRYPTION_KEY);
  if (!baseReady) return false;
  return true;
}

export async function requireInstallerOperations(request: Request) {
  const access = await requireVerifiedTradeAccess(request, {
    partnerTypes: ["installer"],
  });
  return {
    uid: access.identity.uid,
    businessName: access.businessName || "Trade business",
  };
}

export function integrationCallbackUri(request: Request, provider: IntegrationProvider) {
  return `${new URL(request.url).origin}/api/trade-integrations/callback/${provider}`;
}
