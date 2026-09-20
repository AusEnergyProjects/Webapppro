import { twilioSmsStatus, type TradeSmsStatus } from "./trade-sms";

type Json = Record<string, unknown>;
export type SmsCredentials = { accountSid: string; authToken: string };
export type SmsNumber = { sid: string; number: string; label: string };
const sidPattern = /^AC[0-9a-fA-F]{32}$/;
const numberSidPattern = /^PN[0-9a-fA-F]{32}$/;

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
  return value as Json;
}

export function smsCredentials(accountSid: unknown, authToken: unknown): SmsCredentials {
  if (typeof accountSid !== "string" || typeof authToken !== "string" || !sidPattern.test(accountSid.trim()) || !/^[0-9a-fA-F]{32}$/.test(authToken.trim())) throw new Error("SMS_CREDENTIALS_INVALID");
  return { accountSid: accountSid.trim(), authToken: authToken.trim() };
}

async function providerRequest(credentials: SmsCredentials, url: string, fetchImpl: typeof fetch, body?: URLSearchParams) {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body });
  } catch { throw new Error("SMS_PROVIDER_UNAVAILABLE"); }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "SMS_CREDENTIALS_REJECTED" : "SMS_PROVIDER_UNAVAILABLE");
  try { return object(await response.json()); } catch { throw new Error("SMS_PROVIDER_RESPONSE_INVALID"); }
}

async function providerList(credentials: SmsCredentials, initialUrl: string, key: string, fetchImpl: typeof fetch) {
  const initial = new URL(initialUrl);
  let url = initialUrl;
  const rows: Json[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const parsed = new URL(url, initial);
    if (parsed.origin !== initial.origin || parsed.pathname !== initial.pathname || parsed.username || parsed.password || seen.has(parsed.href)) throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
    seen.add(parsed.href);
    const result = await providerRequest(credentials, parsed.href, fetchImpl);
    if (!Array.isArray(result[key])) throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
    rows.push(...result[key].map(object));
    const meta = result.meta ? object(result.meta) : {};
    const next = result.next_page_uri ?? meta.next_page_url;
    if (!next) return rows;
    if (typeof next !== "string") throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
    url = next;
  }
  throw new Error("SMS_ACCOUNT_TOO_LARGE");
}

function safeNumber(row: Json, credentials: SmsCredentials): SmsNumber | null {
  const capabilities = row.capabilities && typeof row.capabilities === "object" ? object(row.capabilities) : {};
  if (row.account_sid !== credentials.accountSid || typeof row.sid !== "string" || !numberSidPattern.test(row.sid) || capabilities.sms !== true || !/^\+[1-9]\d{7,14}$/.test(String(row.phone_number))) return null;
  return { sid: row.sid, number: String(row.phone_number), label: String(row.friendly_name || row.phone_number).slice(0, 120) };
}

export async function inspectSmsAccount(credentials: SmsCredentials, fetchImpl: typeof fetch = fetch) {
  const account = await providerRequest(credentials, `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`, fetchImpl);
  if (account.sid !== credentials.accountSid || account.status !== "active") throw new Error("SMS_ACCOUNT_INACTIVE");
  if (account.owner_account_sid !== credentials.accountSid) throw new Error("SMS_MAIN_ACCOUNT_REQUIRED");
  if (account.type !== "Full" && account.type !== "Trial") throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
  const rows = await providerList(credentials, `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json?PageSize=100`, "incoming_phone_numbers", fetchImpl);
  return { accountLabel: String(account.friendly_name || "Twilio account").slice(0, 120), accountType: account.type,
    numbers: rows.map((row) => safeNumber(row, credentials)).filter((row): row is SmsNumber => Boolean(row)) };
}

export async function assertSmsNumberRouting(credentials: SmsCredentials, numberSid: string, callbackUrl: string, fetchImpl: typeof fetch = fetch) {
  if (!numberSidPattern.test(numberSid)) throw new Error("SMS_NUMBER_INVALID");
  const row = await providerRequest(credentials, `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${numberSid}.json`, fetchImpl);
  const number = safeNumber(row, credentials);
  if (!number) throw new Error("SMS_NUMBER_INVALID");
  if (row.sms_application_sid || (row.sms_url && row.sms_url !== callbackUrl) || (row.sms_fallback_url && row.sms_fallback_url !== callbackUrl)) throw new Error("SMS_ROUTING_CONFLICT");
  const services = await providerList(credentials, "https://messaging.twilio.com/v1/Services?PageSize=100", "services", fetchImpl);
  if (services.length > 100) throw new Error("SMS_ACCOUNT_TOO_LARGE");
  for (const service of services) {
    if (service.account_sid !== credentials.accountSid || !/^MG[0-9a-fA-F]{32}$/.test(String(service.sid))) throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
    const numbers = await providerList(credentials, `https://messaging.twilio.com/v1/Services/${service.sid}/PhoneNumbers?PageSize=100`, "phone_numbers", fetchImpl);
    if (numbers.some((item) => item.sid === numberSid) && service.use_inbound_webhook_on_number !== true) throw new Error("SMS_ROUTING_CONFLICT");
  }
  return number;
}

export async function wireSmsNumber(credentials: SmsCredentials, numberSid: string, callbackUrl: string, fetchImpl: typeof fetch = fetch) {
  const result = await providerRequest(credentials, `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${numberSid}.json`, fetchImpl,
    new URLSearchParams({ SmsUrl: callbackUrl, SmsMethod: "POST" }));
  if (result.account_sid !== credentials.accountSid || result.sid !== numberSid || result.sms_url !== callbackUrl || result.sms_method !== "POST") throw new Error("SMS_ROUTING_UNCONFIRMED");
}

export async function unwireSmsNumber(credentials: SmsCredentials, numberSid: string, callbackUrl: string, fetchImpl: typeof fetch = fetch) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${numberSid}.json`;
  const result = await providerRequest(credentials, url, fetchImpl);
  if (result.account_sid !== credentials.accountSid || result.sid !== numberSid) throw new Error("SMS_PROVIDER_RESPONSE_INVALID");
  const fields = new URLSearchParams();
  if (result.sms_url === callbackUrl) fields.set("SmsUrl", "");
  if (result.sms_fallback_url === callbackUrl) fields.set("SmsFallbackUrl", "");
  if (!fields.size) return;
  const updated = await providerRequest(credentials, url, fetchImpl, fields);
  if (updated.account_sid !== credentials.accountSid || updated.sid !== numberSid
    || (fields.has("SmsUrl") && updated.sms_url !== "") || (fields.has("SmsFallbackUrl") && updated.sms_fallback_url !== "")) throw new Error("SMS_ROUTING_UNCONFIRMED");
}

export async function submitSms(credentials: SmsCredentials, input: { from: string; to: string; body: string; callbackUrl: string }, fetchImpl: typeof fetch = fetch): Promise<{ sid: string; status: TradeSmsStatus; errorCode: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12000), headers: { Authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: input.from, To: input.to, Body: input.body, StatusCallback: input.callbackUrl }),
    });
  } catch { return { sid: "", status: "unknown", errorCode: "provider_response_unknown" }; }
  let result: Json;
  try { result = object(await response.json()); } catch { return { sid: "", status: "unknown", errorCode: "provider_response_unknown" }; }
  if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return { sid: "", status: "failed", errorCode: /^\d{4,6}$/.test(String(result.code)) ? String(result.code) : `http_${response.status}` };
  if (!response.ok || !/^SM[0-9a-fA-F]{32}$/.test(String(result.sid)) || result.account_sid !== credentials.accountSid || result.to !== input.to || result.from !== input.from) return { sid: "", status: "unknown", errorCode: "provider_response_unknown" };
  return { sid: String(result.sid), status: twilioSmsStatus(result.status) || "unknown", errorCode: "" };
}
