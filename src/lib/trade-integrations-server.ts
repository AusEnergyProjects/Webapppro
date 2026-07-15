import { env } from "cloudflare:workers";
import { getD1 } from "../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";

export const INTEGRATION_PROVIDERS = ["xero", "myob", "stripe", "square"] as const;
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
  STRIPE_CONNECT_CLIENT_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_REFERRAL_SECRET_KEY?: string;
  SQUARE_APPLICATION_ID?: string;
  SQUARE_APPLICATION_SECRET?: string;
  SQUARE_ENVIRONMENT?: string;
  GOOGLE_MAPS_API_KEY?: string;
};

export function integrationEnvironment() {
  return env as unknown as IntegrationEnvironment;
}

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export function providerSetting(provider: IntegrationProvider): ProviderSetting {
  const values = integrationEnvironment();
  const squareSandbox = values.SQUARE_ENVIRONMENT === "sandbox";
  if (provider === "xero") return {
    provider, label: "Xero", purpose: "Accounting and invoice sync", clientId: values.XERO_CLIENT_ID || "",
    clientSecret: values.XERO_CLIENT_SECRET || "", authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"],
  };
  if (provider === "myob") return {
    provider, label: "MYOB", purpose: "Accounting and invoice sync", clientId: values.MYOB_CLIENT_ID || "",
    clientSecret: values.MYOB_CLIENT_SECRET || "", authorizeUrl: "https://secure.myob.com/oauth2/account/authorize",
    tokenUrl: "https://secure.myob.com/oauth2/v1/authorize", scopes: ["sme-company-settings", "sme-sales"],
  };
  if (provider === "stripe") return {
    provider, label: "Stripe", purpose: "Secure customer payment requests", clientId: values.STRIPE_CONNECT_CLIENT_ID || "",
    clientSecret: values.STRIPE_SECRET_KEY || values.STRIPE_REFERRAL_SECRET_KEY || "", authorizeUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token", scopes: ["read_write"],
  };
  return {
    provider, label: "Square", purpose: "Secure customer payment requests", clientId: values.SQUARE_APPLICATION_ID || "",
    clientSecret: values.SQUARE_APPLICATION_SECRET || "",
    authorizeUrl: squareSandbox ? "https://connect.squareupsandbox.com/oauth2/authorize" : "https://connect.squareup.com/oauth2/authorize",
    tokenUrl: squareSandbox ? "https://connect.squareupsandbox.com/oauth2/token" : "https://connect.squareup.com/oauth2/token",
    scopes: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE", "PAYMENTS_WRITE"],
  };
}

export async function requireInstallerOperations(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status, business_name
    FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  if (account.partner_type !== "installer") throw new Error("INSTALLER_ONLY");
  const entitlements = await accountEntitlements(identity.uid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return { uid: identity.uid, businessName: String(account.business_name || "Trade business") };
}

export function integrationCallbackUri(request: Request, provider: IntegrationProvider) {
  return `${new URL(request.url).origin}/api/trade-integrations/callback/${provider}`;
}
