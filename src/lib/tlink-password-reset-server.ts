import { importPKCS8, SignJWT } from "jose";
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from "./service-reminder-delivery";
import { normalizeTLinkPasswordResetContinue } from "./tlink-password-reset-continue";
import { tlinkPasswordResetEmail } from "./tlink-password-reset-email";

const FIREBASE_PROJECT = "australian-energy-assessments";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const RESET_ENDPOINT = "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";
const UNAVAILABLE_MESSAGE = "Password reset is temporarily unavailable. Please try again later.";
const MINIMUM_RESPONSE_MS = 1500;

type Runtime = Record<string, string | undefined>;
type ServiceAccount = { client_email: string; private_key: string };
type ResetOptions = {
  runtime?: Runtime;
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

export class TLinkPasswordResetUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "TLinkPasswordResetUnavailableError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTLinkPasswordResetEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && !/[\u0000-\u001f\u007f]/.test(email)
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

function serviceAccount(runtime: Runtime): ServiceAccount {
  const source = runtime.FIREBASE_AUTH_SERVICE_ACCOUNT_JSON;
  if (!source || source.length > 16_384) throw new TLinkPasswordResetUnavailableError();
  const parsed: unknown = JSON.parse(source);
  if (!record(parsed) || parsed.type !== "service_account" || parsed.project_id !== FIREBASE_PROJECT
    || typeof parsed.client_email !== "string" || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(parsed.client_email)
    || typeof parsed.private_key !== "string" || !parsed.private_key.startsWith("-----BEGIN PRIVATE KEY-----")) {
    throw new TLinkPasswordResetUnavailableError();
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function emailRuntime(runtime: Runtime): Runtime {
  const from = runtime.RESEND_FROM_EMAIL?.trim() || "";
  const match = /^(?:[^<>\r\n]*<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+))$/.exec(from);
  if (!match || !serviceReminderProviderConfiguration(runtime).email.configured) {
    throw new TLinkPasswordResetUnavailableError();
  }
  return { ...runtime, RESEND_FROM_EMAIL: `TLink <${match[1] || match[2]}>` };
}

async function responseRecord(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!record(value)) throw new TLinkPasswordResetUnavailableError();
  return value;
}

function resetUrl(value: unknown, continuePath: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new TLinkPasswordResetUnavailableError();
  const source = new URL(value);
  const code = source.searchParams.get("oobCode");
  if (source.origin !== `https://${FIREBASE_PROJECT}.firebaseapp.com` || source.pathname !== "/__/auth/action"
    || source.username || source.password || source.hash || source.searchParams.get("mode") !== "resetPassword"
    || source.searchParams.getAll("mode").length !== 1 || source.searchParams.getAll("oobCode").length !== 1
    || !code || !/^[A-Za-z0-9_-]{16,2048}$/.test(code)) {
    throw new TLinkPasswordResetUnavailableError();
  }
  const destination = new URL("https://ausenergyassessments.com/direct-trade/reset-password");
  destination.searchParams.set("oobCode", code);
  destination.searchParams.set("continuePath", normalizeTLinkPasswordResetContinue(continuePath));
  return destination.toString();
}

/** Google owns token generation and verification. Only the branded message is sent here. */
export async function sendTLinkPasswordResetEmail(
  input: { email: string; continuePath?: unknown },
  { runtime = process.env, fetchImpl = fetch, now = Date.now,
    wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)) }: ResetOptions = {},
): Promise<void> {
  const startedAt = now();
  try {
    const email = normalizeTLinkPasswordResetEmail(input.email);
    if (!email) throw new TLinkPasswordResetUnavailableError();
    const account = serviceAccount(runtime);
    const providerRuntime = emailRuntime(runtime);
    const issuedAt = Math.floor(now() / 1000);
    const key = await importPKCS8(account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/identitytoolkit" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email).setAudience(TOKEN_ENDPOINT)
      .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600).sign(key);
    const tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const token = await responseRecord(tokenResponse);
    if (!tokenResponse.ok || token.token_type !== "Bearer" || typeof token.access_token !== "string"
      || !token.access_token || token.access_token.length > 16_384) throw new TLinkPasswordResetUnavailableError();
    const linkResponse = await fetchImpl(RESET_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email, targetProjectId: FIREBASE_PROJECT, returnOobLink: true }),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const link = await responseRecord(linkResponse);
    if (!linkResponse.ok) {
      if (linkResponse.status === 400 && record(link.error)
        && (link.error.message === "EMAIL_NOT_FOUND" || link.error.message === "USER_DISABLED")) return;
      throw new TLinkPasswordResetUnavailableError();
    }
    const message = tlinkPasswordResetEmail({ email, resetUrl: resetUrl(link.oobLink, input.continuePath) });
    try {
      const receipt = await sendServiceReminderProviderMessage({
        channel: "email", recipient: email, ...message,
        idempotencyKey: `tlink-password-reset:${crypto.randomUUID()}`,
        callbackUrl: "", messageType: "tlink_password_reset",
      }, {
        runtime: providerRuntime,
        fetchImpl: (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) }),
      });
      const providerMessageId = /^[A-Za-z0-9_-]{1,128}$/.test(receipt.providerMessageId) ? receipt.providerMessageId : undefined;
      console.info("TLINK_PASSWORD_RESET_EMAIL_ACCEPTED", providerMessageId ? { providerMessageId } : {});
    } catch {
      // Public acknowledgement must not reveal which account reached delivery during an outage.
      console.error("TLINK_PASSWORD_RESET_DELIVERY_UNCONFIRMED");
    }
  } catch {
    // Provider details can contain credentials or one-time links. Never return or log them.
    throw new TLinkPasswordResetUnavailableError();
  } finally {
    // Pad fast responses for both known and unknown accounts to reduce a timing oracle.
    const remaining = MINIMUM_RESPONSE_MS - (now() - startedAt);
    if (remaining > 0) await wait(remaining);
  }
}
