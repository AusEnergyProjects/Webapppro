// Contracts: https://developers.clicksend.com/docs (checked 29 September 2026).
// This adapter never retries mutations. The caller owns durable intent and reconciliation.
export type ClickSendCredentials = { username: string; apiKey: string };
export type ClickSendSubaccount = { subaccountId: string; credentials: ClickSendCredentials };
export type ClickSendNumberQuote = { number: string; setupMicro: number; monthlyMicro: number; totalMicro: number; currency: "AUD" };
export type ClickSendRegistration = {
  business_name: string; business_address: string; suburb: string; postcode: string;
  state: string; contact_name: string; contact_number: string; country: "AU";
};
export type ClickSendSubmitInput = { from: string; to: string; body: string; localMessageId: string; subaccountId: string };
export type ClickSendSubmitResult = {
  sid: string; status: "queued" | "failed" | "unknown"; errorCode: string;
  segments: number; priceMicro: number; definitiveRejection: boolean;
};
export type ClickSendInbound = { messageId: string; originalMessageId: string | null; from: string; to: string; body: string; timestamp: number; customString: string | null };
export type ClickSendInboundRule = { id: string; number: string; ruleName: string; action: string; callbackUrl: string; enabled: boolean; matchType: number; searchTerm: string; webhookType: string };
export type ClickSendReceiptRule = { id: string; ruleName: string; action: string; callbackUrl: string; enabled: boolean; matchType: number };
type Json = Record<string, unknown>;
const origin = "https://rest.clicksend.com";
const maxPages = 20;
const auMobile = /^\+614\d{8}$/;
const messageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rejectionCodes = new Set(["MISSING_CREDENTIALS", "ACCOUNT_NOT_ACTIVATED", "INVALID_RECIPIENT", "THROTTLED", "INVALID_SENDER_ID", "INSUFFICIENT_CREDIT", "INVALID_CREDENTIALS", "COUNTRY_NOT_ENABLED", "EMPTY_MESSAGE", "TOO_MANY_RECIPIENTS", "MISSING_REQUIRED_FIELDS", "INVALID_SCHEDULE", "NOT_ENOUGH_PERMISSION_TO_LIST_ID", "REGISTRATION_NEEDED"]);

export class ClickSendProviderError extends Error {
  readonly definitiveRejection: boolean;
  constructor(code: string, definitiveRejection = false) {
    super(code);
    this.name = "ClickSendProviderError";
    this.definitiveRejection = definitiveRejection;
  }
}
function invalid(code = "SMS_PROVIDER_RESPONSE_INVALID"): never { throw new ClickSendProviderError(code); }
function isObject(value: unknown): value is Json { return value !== null && typeof value === "object" && !Array.isArray(value); }
function object(value: unknown): Json { if (!isObject(value)) return invalid(); return value; }
function text(value: unknown, max = 255): string { if (typeof value !== "string" || value.length > max) return invalid(); return value; }
function positiveId(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d{0,14}$/.test(String(value))) return invalid();
  return String(value);
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) return invalid();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) return invalid();
  return n;
}
function aud(value: unknown): "AUD" {
  if (object(value).currency_name_short !== "AUD") return invalid("SMS_CURRENCY_UNSUPPORTED");
  return "AUD";
}
export function clickSendMoneyMicro(value: unknown, signed = false): number {
  if (typeof value !== "string" && typeof value !== "number") return invalid();
  const match = /^(-?)(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match || (match[1] && !signed)) return invalid();
  const amount = Number(match[2]) * 1_000_000 + Number((match[3] || "").padEnd(6, "0"));
  if (!Number.isSafeInteger(amount)) return invalid();
  return match[1] ? -amount : amount;
}
export function clickSendCredentials(username: unknown, apiKey: unknown): ClickSendCredentials {
  if (typeof username !== "string" || typeof apiKey !== "string" || !/^[!-9;-~]{1,254}$/.test(username) || !/^[!-~]{16,256}$/.test(apiKey)) {
    throw new ClickSendProviderError("SMS_CREDENTIALS_INVALID", true);
  }
  return { username, apiKey };
}
function number(value: string): string {
  if (!auMobile.test(value)) throw new ClickSendProviderError("SMS_AU_MOBILE_REQUIRED", true);
  return value;
}
function messageId(value: unknown): string {
  if (typeof value !== "string" || !messageIdPattern.test(value)) return invalid("SMS_MESSAGE_ID_INVALID");
  return value;
}
function callback(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid("SMS_CALLBACK_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !url.hostname.includes(".") || url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return invalid("SMS_CALLBACK_INVALID");
  return url.href;
}
async function request(credentials: ClickSendCredentials, path: string, fetchImpl: typeof fetch, body?: Json): Promise<Json> {
  const safe = clickSendCredentials(credentials.username, credentials.apiKey);
  // Paths are constructed locally; pagination links are never passed to fetch.
  if (!path.startsWith("/v3/") || path.includes("\\") || path.includes("#")) return invalid("SMS_PROVIDER_URL_INVALID");
  let response: Response;
  try {
    response = await fetchImpl(origin + path, {
      method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Basic ${btoa(`${safe.username}:${safe.apiKey}`)}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); }
  // Workers supports manual/follow only. Never forward credentials to a redirect target.
  if (response.status >= 300 && response.status < 400) throw new ClickSendProviderError("SMS_PROVIDER_REJECTED", true);
  let envelope: Json;
  try { envelope = object(await response.json()); } catch { throw new ClickSendProviderError("SMS_PROVIDER_OUTCOME_UNKNOWN"); }
  if (!response.ok) {
    const rejected = [400, 401, 403, 404, 405, 422, 429].includes(response.status);
    throw new ClickSendProviderError(rejected ? (response.status === 401 || response.status === 403 ? "SMS_CREDENTIALS_REJECTED" : "SMS_PROVIDER_REJECTED") : "SMS_PROVIDER_OUTCOME_UNKNOWN", rejected);
  }
  if (envelope.response_code !== "SUCCESS" || ![200, 201].includes(Number(envelope.http_code))) {
    const rejected = typeof envelope.response_code === "string" && rejectionCodes.has(envelope.response_code);
    throw new ClickSendProviderError(rejected ? `SMS_${envelope.response_code}` : "SMS_PROVIDER_OUTCOME_UNKNOWN", rejected);
  }
  return envelope;
}
async function list(credentials: ClickSendCredentials, path: string, fetchImpl: typeof fetch, requireAud = false): Promise<Json[]> {
  const rows: Json[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = object((await request(credentials, `${path}?page=${page}&limit=100`, fetchImpl)).data);
    // The live API omits data and currency entirely for an empty owned-number list.
    if (page === 1 && integer(result.current_page) === 1 && integer(result.last_page) === 0 && integer(result.total) === 0
      && (result.data === undefined || (Array.isArray(result.data) && result.data.length === 0)) && result.next_page_url === null) return [];
    if (requireAud) aud(result._currency);
    if (!Array.isArray(result.data) || result.data.length > 100 || integer(result.current_page) !== page) return invalid();
    const last = integer(result.last_page);
    if (last > maxPages) return invalid("SMS_PROVIDER_PAGE_LIMIT");
    if (last < page) return invalid();
    rows.push(...result.data.map(object));
    if (page === last) {
      if (result.next_page_url !== null && result.next_page_url !== undefined) return invalid();
      return rows;
    }
    if (typeof result.next_page_url !== "string") return invalid();
    let next: URL;
    try { next = new URL(result.next_page_url, origin); } catch { return invalid(); }
    // ClickSend inventory returns /?page=N; reconstruct the known endpoint ourselves.
    const relativePageOnly = result.next_page_url.startsWith("/?") && next.pathname === "/";
    if (next.origin !== origin || (next.pathname !== path && !relativePageOnly) || next.username || next.password || next.hash || next.searchParams.get("page") !== String(page + 1)) return invalid("SMS_PROVIDER_PAGINATION_INVALID");
    for (const key of next.searchParams.keys()) if (key !== "page" && key !== "limit") return invalid("SMS_PROVIDER_PAGINATION_INVALID");
    if (next.searchParams.has("limit") && next.searchParams.get("limit") !== "100") return invalid("SMS_PROVIDER_PAGINATION_INVALID");
  }
  return invalid("SMS_PROVIDER_PAGE_LIMIT");
}
export async function getClickSendAccount(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch) {
  const row = object((await request(credentials, "/v3/account", fetchImpl)).data);
  if (integer(row.active, 1) !== 1 || integer(row.banned, 1) !== 0) return invalid("SMS_ACCOUNT_INACTIVE");
  const subaccount = row._subaccount == null ? null : object(row._subaccount);
  const username = subaccount ? text(subaccount.api_username) : text(row.username);
  if (username !== credentials.username) return invalid("SMS_ACCOUNT_MISMATCH");
  return { accountId: positiveId(row.user_id), subaccountId: subaccount ? positiveId(subaccount.subaccount_id) : null,
    username, accountName: text(row.account_name), balanceMicro: clickSendMoneyMicro(row.balance, true), currency: aud(row._currency) };
}
function quote(row: Json, purchased = false): ClickSendNumberQuote {
  if (row.country !== "AU") return invalid("SMS_NUMBER_MISMATCH");
  return { number: number(text(row.dedicated_number)), setupMicro: clickSendMoneyMicro(row[purchased ? "_price_setup" : "price_setup"]),
    monthlyMicro: clickSendMoneyMicro(row[purchased ? "_price_monthly" : "price_monthly"]), totalMicro: clickSendMoneyMicro(row.price_total), currency: "AUD" };
}
export async function searchAustralianClickSendNumbers(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch): Promise<ClickSendNumberQuote[]> {
  const rows = await list(credentials, "/v3/numbers/search/AU", fetchImpl, true);
  return rows.filter((row) => row.country === "AU" && typeof row.dedicated_number === "string" && auMobile.test(row.dedicated_number)).map((row) => quote(row));
}
function restrictedSubaccount(row: Json, username: string): ClickSendSubaccount {
  if (row.api_username !== username || ["access_users", "access_billing", "access_reporting", "access_contacts", "access_settings"].some((key) => integer(row[key], 1) !== 0)) return invalid("SMS_SUBACCOUNT_UNCONFIRMED");
  return { subaccountId: positiveId(row.subaccount_id), credentials: clickSendCredentials(row.api_username, row.api_key) };
}
export async function findClickSendSubaccount(credentials: ClickSendCredentials, username: string, fetchImpl: typeof fetch = fetch): Promise<ClickSendSubaccount | null> {
  clickSendCredentials(username, "validation-only-key");
  const matches = (await list(credentials, "/v3/subaccounts", fetchImpl)).filter((row) => row.api_username === username);
  if (matches.length > 1) return invalid("SMS_SUBACCOUNT_AMBIGUOUS");
  return matches.length ? restrictedSubaccount(matches[0], username) : null;
}
export async function getClickSendSubaccount(credentials: ClickSendCredentials, input: { subaccountId: string; username: string }, fetchImpl: typeof fetch = fetch): Promise<ClickSendSubaccount> {
  clickSendCredentials(input.username, "validation-only-key");
  const row = object((await request(credentials, `/v3/subaccounts/${positiveId(input.subaccountId)}`, fetchImpl)).data);
  const result = restrictedSubaccount(row, input.username);
  if (result.subaccountId !== input.subaccountId) return invalid("SMS_SUBACCOUNT_UNCONFIRMED");
  return result;
}
export async function createClickSendSubaccount(credentials: ClickSendCredentials, input: { username: string; password: string; email: string; phone: string; firstName: string; lastName: string }, fetchImpl: typeof fetch = fetch): Promise<ClickSendSubaccount> {
  clickSendCredentials(input.username, "validation-only-key");
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])[^\s]{12,128}$/.test(input.password) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254 || !input.firstName.trim() || !input.lastName.trim() || input.firstName.length > 100 || input.lastName.length > 100) return invalid("SMS_ONBOARDING_INVALID");
  const row = object((await request(credentials, "/v3/subaccounts", fetchImpl, {
    api_username: input.username, password: input.password, email: input.email, phone_number: number(input.phone), first_name: input.firstName, last_name: input.lastName,
    access_users: 0, access_billing: 0, access_reporting: 0, access_contacts: 0, access_settings: 0,
  })).data);
  if (row.email !== input.email || row.phone_number !== input.phone) return invalid("SMS_SUBACCOUNT_UNCONFIRMED");
  return restrictedSubaccount(row, input.username);
}
export async function listPurchasedClickSendNumbers(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch) {
  const rows = await list(credentials, "/v3/numbers", fetchImpl, true);
  return rows.filter((row) => row.country === "AU" && row.type === "sms" && typeof row.dedicated_number === "string" && auMobile.test(row.dedicated_number)).map((row) => {
    const status = object(row.status);
    const value = integer(status.value, 5);
    const labels = ["REGISTRATION_NOT_REQUIRED", "REGISTRATION_NOT_INITIATED", "REGISTRATION_INITIATED", "CUST_ACTION_REQUIRED", "REGISTRATION_SUBMITTED", "REGISTERED"];
    if (status.label !== labels[value]) return invalid();
    return { number: number(text(row.dedicated_number)), ready: value === 0 || value === 5, registrationStatus: value, label: labels[value] };
  });
}
export async function buyAustralianClickSendNumber(credentials: ClickSendCredentials, input: { number: string; registration: ClickSendRegistration }, fetchImpl: typeof fetch = fetch): Promise<ClickSendNumberQuote> {
  const registration = input.registration;
  const lengths = { business_name: [2, 100], business_address: [5, 150], suburb: [2, 50], postcode: [4, 4], state: [2, 50], contact_name: [2, 100] };
  for (const [key, [min, max]] of Object.entries(lengths)) {
    const value = object(registration)[key];
    if (typeof value !== "string" || value.trim().length < min || value.length > max || /[\u0000-\u001f]/.test(value)) return invalid("SMS_REGISTRATION_INVALID");
  }
  if (registration.country !== "AU" || !/^\d{4}$/.test(registration.postcode) || /\b(?:p\.?\s*o\.?\s*box|post\s+office\s+box)\b/i.test(registration.business_address) || !/^\+61[23478]\d{8}$/.test(registration.contact_number)) return invalid("SMS_REGISTRATION_INVALID");
  const chosen = number(input.number);
  const row = object((await request(credentials, `/v3/numbers/buy/${encodeURIComponent(chosen)}`, fetchImpl, { dedicated_number: chosen, type: "sms", registration_data: registration })).data);
  aud(row._currency);
  if (row.dedicated_number !== chosen) return invalid("SMS_NUMBER_MISMATCH");
  return quote(row, true);
}
function inboundRule(row: Json): ClickSendInboundRule {
  return { id: positiveId(row.inbound_rule_id), number: text(row.dedicated_number), ruleName: text(row.rule_name), action: text(row.action), callbackUrl: text(row.action_address, 2048), enabled: integer(row.enabled, 1) === 1, matchType: integer(row.message_search_type, 3), searchTerm: row.message_search_term == null ? "" : text(row.message_search_term), webhookType: row.webhook_type == null ? "post" : text(row.webhook_type) };
}
function receiptRule(row: Json): ClickSendReceiptRule {
  return { id: positiveId(row.receipt_rule_id), ruleName: text(row.rule_name), action: text(row.action), callbackUrl: text(row.action_address, 2048), enabled: integer(row.enabled, 1) === 1, matchType: integer(row.match_type) };
}
export async function listClickSendInboundRules(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch): Promise<ClickSendInboundRule[]> {
  return (await list(credentials, "/v3/automations/sms/inbound", fetchImpl)).map(inboundRule);
}
export async function listClickSendReceiptRules(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch): Promise<ClickSendReceiptRule[]> {
  return (await list(credentials, "/v3/automations/sms/receipts", fetchImpl)).map(receiptRule);
}
export async function createClickSendInboundRule(credentials: ClickSendCredentials, input: { number: string; callbackUrl: string; ruleName: string }, fetchImpl: typeof fetch = fetch): Promise<ClickSendInboundRule> {
  const url = callback(input.callbackUrl);
  const row = inboundRule(object((await request(credentials, "/v3/automations/sms/inbound", fetchImpl, { dedicated_number: number(input.number), rule_name: text(input.ruleName), message_search_type: 0, message_search_term: "", action: "URL", action_address: url, enabled: 1, webhook_type: "json" })).data));
  if (row.number !== input.number || row.callbackUrl !== url || row.action !== "URL" || row.matchType !== 0 || !row.enabled || row.webhookType !== "json" || row.ruleName !== input.ruleName) return invalid("SMS_ROUTING_UNCONFIRMED");
  return row;
}
export async function createClickSendReceiptRule(credentials: ClickSendCredentials, input: { callbackUrl: string; ruleName: string }, fetchImpl: typeof fetch = fetch): Promise<ClickSendReceiptRule> {
  const url = callback(input.callbackUrl);
  const row = receiptRule(object((await request(credentials, "/v3/automations/sms/receipts", fetchImpl, { rule_name: text(input.ruleName), match_type: 0, action: "URL", action_address: url, enabled: 1 })).data));
  if (row.callbackUrl !== url || row.action !== "URL" || row.matchType !== 0 || !row.enabled || row.ruleName !== input.ruleName) return invalid("SMS_ROUTING_UNCONFIRMED");
  return row;
}
function sendBody(input: ClickSendSubmitInput): Json {
  number(input.from); number(input.to); positiveId(input.subaccountId);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.localMessageId) || !input.body.trim() || input.body.length > 5000 || /\u0000/.test(input.body)) return invalid("SMS_MESSAGE_INVALID");
  return { shorten_urls: false, messages: [{ from: input.from, to: input.to, body: input.body, source: "TLink", custom_string: input.localMessageId, country: "AU" }] };
}
function acceptedMessage(data: Json, input: ClickSendSubmitInput, requireSubaccount = true): Json {
  if (!Array.isArray(data.messages) || data.messages.length !== 1) return invalid();
  const row = object(data.messages[0]);
  if (row.from !== input.from || row.to !== input.to || row.custom_string !== input.localMessageId || ((requireSubaccount || row.subaccount_id !== undefined) && positiveId(row.subaccount_id) !== input.subaccountId) || row.country !== "AU" || row.is_shared_system_number !== false) return invalid("SMS_MESSAGE_IDENTITY_MISMATCH");
  return row;
}
export async function quoteClickSendSms(credentials: ClickSendCredentials, input: ClickSendSubmitInput, fetchImpl: typeof fetch = fetch) {
  const data = object((await request(credentials, "/v3/sms/price", fetchImpl, sendBody(input))).data);
  aud(data._currency);
  // The price schema does not include subaccount_id; the send schema does.
  const row = acceptedMessage(data, input, false);
  if (row.status !== "SUCCESS") return invalid("SMS_PROVIDER_REJECTED");
  const segments = integer(row.message_parts, 100);
  if (!segments) return invalid();
  return { segments, priceMicro: clickSendMoneyMicro(row.message_price), currency: "AUD" as const };
}
export async function submitClickSendSms(credentials: ClickSendCredentials, input: ClickSendSubmitInput, fetchImpl: typeof fetch = fetch): Promise<ClickSendSubmitResult> {
  const payload = sendBody(input);
  const unknown: ClickSendSubmitResult = { sid: "", status: "unknown", errorCode: "SMS_PROVIDER_OUTCOME_UNKNOWN", segments: 0, priceMicro: 0, definitiveRejection: false };
  try {
    const data = object((await request(credentials, "/v3/sms/send", fetchImpl, payload)).data);
    aud(data._currency);
    if (!Array.isArray(data.messages) || data.messages.length !== 1) return unknown;
    const row = object(data.messages[0]);
    // Rejections may omit sender metadata; any echoed identity must still match.
    if ((row.from !== undefined && row.from !== input.from) || row.to !== input.to || (row.custom_string !== undefined && row.custom_string !== input.localMessageId) || (row.subaccount_id !== undefined && positiveId(row.subaccount_id) !== input.subaccountId)) return unknown;
    if (typeof row.status === "string" && rejectionCodes.has(row.status)) return { ...unknown, status: "failed", errorCode: `SMS_${row.status}`, definitiveRejection: true };
    acceptedMessage(data, input);
    if (row.status !== "SUCCESS" || integer(data.queued_count) !== 1 || integer(data.total_count) !== 1) return unknown;
    const segments = integer(row.message_parts, 100);
    if (!segments) return unknown;
    return { sid: messageId(row.message_id), status: "queued", errorCode: "", segments, priceMicro: clickSendMoneyMicro(row.message_price), definitiveRejection: false };
  } catch (error) {
    if (error instanceof ClickSendProviderError && error.definitiveRejection) return { ...unknown, status: "failed", errorCode: error.message, definitiveRejection: true };
    return unknown;
  }
}
export async function getClickSendReceipt(credentials: ClickSendCredentials, input: { messageId: string; subaccountId: string }, fetchImpl: typeof fetch = fetch) {
  const row = object((await request(credentials, `/v3/sms/receipts/${messageId(input.messageId)}`, fetchImpl)).data);
  if (messageId(row.message_id).toLowerCase() !== input.messageId.toLowerCase() || positiveId(row.subaccount_id) !== positiveId(input.subaccountId) || row.message_type !== "sms") return invalid("SMS_MESSAGE_IDENTITY_MISMATCH");
  return { messageId: messageId(row.message_id), subaccountId: positiveId(row.subaccount_id), statusCode: integer(row.status_code, 999), errorCode: row.error_code == null ? null : integer(row.error_code, 999999), customString: row.custom_string == null ? null : text(row.custom_string), timestamp: integer(row.timestamp) };
}
function inbound(row: Json): ClickSendInbound {
  const body = text(row.body, 5000);
  return { messageId: messageId(row.message_id), originalMessageId: row.original_message_id == null || row.original_message_id === "" ? null : messageId(row.original_message_id), from: number(text(row.from)), to: number(text(row.to)), body, timestamp: integer(row.timestamp ?? row.timestamp_send), customString: row.custom_string == null ? null : text(row.custom_string) };
}
export async function listClickSendInboundMessages(credentials: ClickSendCredentials, fetchImpl: typeof fetch = fetch): Promise<ClickSendInbound[]> {
  return (await list(credentials, "/v3/sms/inbound", fetchImpl)).map(inbound);
}
export async function getClickSendInboundMessage(credentials: ClickSendCredentials, input: { messageId: string; originalMessageId: string; to: string }, fetchImpl: typeof fetch = fetch): Promise<ClickSendInbound> {
  messageId(input.messageId); number(input.to);
  const row = inbound(object((await request(credentials, `/v3/sms/inbound/${messageId(input.originalMessageId)}`, fetchImpl)).data));
  if (row.messageId.toLowerCase() !== input.messageId.toLowerCase() || row.originalMessageId?.toLowerCase() !== input.originalMessageId.toLowerCase() || row.to !== input.to) return invalid("SMS_MESSAGE_IDENTITY_MISMATCH");
  return row;
}
