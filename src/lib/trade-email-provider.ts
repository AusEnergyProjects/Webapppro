export type TradeEmailProvider = "google" | "microsoft";
export type EmailCredentials = { accessToken: string; refreshToken: string; expiresAt: string };
export type EmailIdentity = { id: string; email: string; name: string };
export type EmailProviderConfig = { clientId: string; clientSecret: string };
export type MailboxEmail = {
  senderEmail: string;
  senderName: string;
  recipient: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
  messageId: string;
};

export class TradeEmailProviderError extends Error {
  readonly outcome: "rejected" | "uncertain" | "reconnect";
  readonly code: string;

  constructor(code: string, outcome: "rejected" | "uncertain" | "reconnect") {
    super(code);
    this.name = "TradeEmailProviderError";
    this.code = code;
    this.outcome = outcome;
  }
}

const maxMessageBytes = 3 * 1024 * 1024;
const googleSendScope = "https://www.googleapis.com/auth/gmail.send";
const googleScope = `openid email ${googleSendScope}`;
const microsoftScope = "openid profile email offline_access User.Read Mail.Send";
const controls = /[\u0000-\u001f\u007f]/;
// Token-only parameters cover calendar charset/method without accepting quoted
// header fragments or line breaks from caller-provided attachment metadata.
const mimeType = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?: *; *[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/;

function invalid(code = "email_input_invalid"): never {
  throw new TradeEmailProviderError(code, "rejected");
}

function assertProvider(provider: TradeEmailProvider) {
  if (provider !== "google" && provider !== "microsoft") invalid();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, max = 16384): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !controls.test(value);
}

function validEmail(value: unknown): value is string {
  if (!safeString(value, 254)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)
    && domain.includes(".") && domain.split(".").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part));
}

function assertConfig(config: EmailProviderConfig) {
  if (!safeString(config.clientId) || !safeString(config.clientSecret)) invalid();
}

function assertRedirect(redirectUri: string) {
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { invalid(); }
  if (redirect.username || redirect.password || redirect.hash
    || (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname)))) invalid();
}

export function buildEmailAuthorizationUrl(config: EmailProviderConfig, provider: TradeEmailProvider, redirectUri: string, state: string, pkceChallenge: string): string {
  assertProvider(provider);
  assertConfig(config);
  assertRedirect(redirectUri);
  if (!safeString(state, 2048) || !/^[A-Za-z0-9_-]{43}$/.test(pkceChallenge)) invalid();
  const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", state,
    scope: provider === "google" ? googleScope : microsoftScope,
    code_challenge: pkceChallenge, code_challenge_method: "S256",
    prompt: provider === "google" ? "consent select_account" : "select_account",
    ...(provider === "google" ? { access_type: "offline" } : { response_mode: "query" }),
  }).toString();
  return url.href;
}

async function providerRequest(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new TradeEmailProviderError("email_provider_unavailable", "uncertain");
  }
  if (response.status === 401) throw new TradeEmailProviderError("email_provider_reconnect", "reconnect");
  if (response.status >= 500 || response.status === 408) throw new TradeEmailProviderError("email_provider_unavailable", "uncertain");
  if (!response.ok) throw new TradeEmailProviderError("email_provider_rejected", "rejected");
  return response;
}

async function readObject(response: Response, outcome: "rejected" | "uncertain" = "rejected"): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new TradeEmailProviderError("email_provider_response_invalid", outcome); }
  if (!isObject(value)) throw new TradeEmailProviderError("email_provider_response_invalid", outcome);
  return value;
}

function assertSendPermission(provider: TradeEmailProvider, scope: unknown) {
  if (scope === undefined) return; // OAuth permits omission when the granted scope is unchanged.
  if (typeof scope !== "string") invalid("email_provider_response_invalid");
  const scopes = scope.toLowerCase().split(/\s+/);
  const granted = provider === "google" ? scopes.includes(googleSendScope.toLowerCase()) : scopes.some((item) => item === "mail.send" || item === "https://graph.microsoft.com/mail.send");
  if (!granted) throw new TradeEmailProviderError("email_permission_required", "reconnect");
}

async function tokenRequest(provider: TradeEmailProvider, config: EmailProviderConfig, fields: Record<string, string>, fetchImpl: typeof fetch, previousRefreshToken?: string): Promise<EmailCredentials> {
  assertProvider(provider);
  assertConfig(config);
  let response: Response;
  try {
    response = await fetchImpl(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }),
    });
  } catch { throw new TradeEmailProviderError("email_provider_unavailable", "uncertain"); }
  if (response.status === 401) throw new TradeEmailProviderError("email_provider_reconnect", "reconnect");
  if (response.status >= 500 || response.status === 408) throw new TradeEmailProviderError("email_provider_unavailable", "uncertain");
  const payload = await readObject(response);
  if (!response.ok) {
    if (payload.error === "invalid_grant" || payload.error === "interaction_required" || payload.error === "consent_required") throw new TradeEmailProviderError("email_provider_reconnect", "reconnect");
    throw new TradeEmailProviderError("email_provider_rejected", "rejected");
  }
  assertSendPermission(provider, payload.scope);
  const refreshToken = payload.refresh_token === undefined ? previousRefreshToken : payload.refresh_token;
  if (!safeString(refreshToken)) throw new TradeEmailProviderError("email_refresh_token_required", "reconnect");
  if (!safeString(payload.access_token) || typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer"
    || typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0 || payload.expires_in > 365 * 86400) invalid("email_provider_response_invalid");
  return { accessToken: payload.access_token, refreshToken, expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString() };
}

export async function exchangeEmailCode(provider: TradeEmailProvider, config: EmailProviderConfig, input: { code: string; redirectUri: string; verifier: string }, fetchImpl: typeof fetch = fetch): Promise<EmailCredentials> {
  assertRedirect(input.redirectUri);
  if (!safeString(input.code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) invalid();
  return tokenRequest(provider, config, { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier }, fetchImpl);
}

export async function refreshEmailCredentials(provider: TradeEmailProvider, config: EmailProviderConfig, credentials: EmailCredentials, fetchImpl: typeof fetch = fetch): Promise<EmailCredentials> {
  if (!safeString(credentials.refreshToken)) throw new TradeEmailProviderError("email_refresh_token_required", "reconnect");
  return tokenRequest(provider, config, { grant_type: "refresh_token", refresh_token: credentials.refreshToken }, fetchImpl, credentials.refreshToken);
}

export async function getEmailIdentity(provider: TradeEmailProvider, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<EmailIdentity> {
  assertProvider(provider);
  if (!safeString(accessToken)) invalid();
  const response = await providerRequest(provider === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }, fetchImpl);
  const value = await readObject(response);
  const id = provider === "google" ? value.sub : value.id;
  const email = provider === "google" ? value.email : (value.mail || value.userPrincipalName);
  const name = provider === "google" ? value.name : value.displayName;
  if (!safeString(id, 512) || !validEmail(email) || email.toUpperCase().includes("#EXT#") || (provider === "google" && value.email_verified !== true)) invalid("email_identity_invalid");
  return { id, email, name: safeString(name, 200) ? name : email };
}

function validateMessage(input: MailboxEmail) {
  if (!validEmail(input.senderEmail) || !validEmail(input.recipient) || typeof input.senderName !== "string" || input.senderName.length > 200 || controls.test(input.senderName)
    || !safeString(input.subject, 998) || typeof input.text !== "string" || (input.html !== undefined && typeof input.html !== "string")
    || !safeString(input.messageId, 254) || !/^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?>$/.test(input.messageId)) invalid();
  if (new TextEncoder().encode(input.text).length + new TextEncoder().encode(input.html || "").length > maxMessageBytes) invalid("email_message_too_large");
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.length > 20)) invalid();
  let encodedSize = 0;
  for (const attachment of input.attachments || []) {
    if (!attachment || !safeString(attachment.filename, 200) || /[/\\]/.test(attachment.filename)
      || !safeString(attachment.contentType, 128) || !mimeType.test(attachment.contentType)
      || typeof attachment.content !== "string") invalid();
    encodedSize += attachment.content.length;
    if (encodedSize > maxMessageBytes) invalid("email_message_too_large");
    if (attachment.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) invalid();
    try { if (btoa(atob(attachment.content)) !== attachment.content) invalid(); } catch { invalid(); }
    try { encodeURIComponent(attachment.filename); } catch { invalid(); }
  }
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return btoa(chunks.join(""));
}

function encodedHeader(value: string): string {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (new TextEncoder().encode(chunk + character).length > 42) { chunks.push(chunk); chunk = ""; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part) => `=?UTF-8?B?${utf8Base64(part)}?=`).join("\r\n ");
}

function foldedBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function filenameParameters(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9 ._-]/g, "_").slice(0, 100);
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const units = encoded.match(/%[A-Fa-f0-9]{2}|./g) || [];
  const segments: string[] = [];
  let segment = "";
  for (const unit of units) {
    if ((segment + unit).length > 45) { segments.push(segment); segment = ""; }
    segment += unit;
  }
  if (segment) segments.push(segment);
  return `filename="${fallback}";\r\n ` + segments.map((part, index) => `filename*${index}*=${index === 0 ? "UTF-8''" : ""}${part}`).join(";\r\n ");
}

function mimeMessage(input: MailboxEmail): string {
  // Boundaries contain '_' which cannot occur in base64 part content.
  const boundary = `tlink_${crypto.randomUUID().replace(/-/g, "")}`;
  const alternative = `${boundary}_alternative`;
  const textPart = (type: string, content: string) => `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${foldedBase64(utf8Base64(content))}\r\n`;
  let body = input.html === undefined ? textPart("text/plain", input.text)
    : `Content-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n--${alternative}\r\n${textPart("text/plain", input.text)}--${alternative}\r\n${textPart("text/html", input.html)}--${alternative}--\r\n`;
  if (input.attachments?.length) {
    body = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${body}`;
    for (const attachment of input.attachments) body += `--${boundary}\r\nContent-Type: ${attachment.contentType}\r\nContent-Disposition: attachment; ${filenameParameters(attachment.filename)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${foldedBase64(attachment.content)}\r\n`;
    body += `--${boundary}--\r\n`;
  }
  return `From: ${input.senderName ? `${encodedHeader(input.senderName)} ` : ""}<${input.senderEmail}>\r\nTo: <${input.recipient}>\r\nSubject: ${encodedHeader(input.subject)}\r\nMessage-ID: ${input.messageId}\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\n${body}`;
}

export async function sendMailboxEmail(provider: TradeEmailProvider, accessToken: string, input: MailboxEmail, fetchImpl: typeof fetch = fetch): Promise<{ providerMessageId: string; providerStatus: "accepted" }> {
  assertProvider(provider);
  if (!safeString(accessToken)) invalid();
  validateMessage(input);
  const body = provider === "google"
    ? JSON.stringify({ raw: utf8Base64(mimeMessage(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") })
    : JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: input.html === undefined ? "Text" : "HTML", content: input.html === undefined ? input.text : input.html },
        from: { emailAddress: { address: input.senderEmail, name: input.senderName || input.senderEmail } },
        toRecipients: [{ emailAddress: { address: input.recipient } }],
        internetMessageHeaders: [{ name: "X-TLink-Message-ID", value: input.messageId }],
        attachments: (input.attachments || []).map((attachment) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: attachment.filename, contentType: attachment.contentType, contentBytes: attachment.content })),
      },
      saveToSentItems: true,
    });
  if (new TextEncoder().encode(body).length > maxMessageBytes) invalid("email_message_too_large");
  const response = await providerRequest(provider === "google" ? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" : "https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body,
  }, fetchImpl);
  if (provider === "microsoft") {
    // Graph returns no message resource: 202 confirms acceptance, never delivery.
    if (response.status !== 202) throw new TradeEmailProviderError("email_provider_response_invalid", "uncertain");
    return { providerMessageId: "", providerStatus: "accepted" };
  }
  const value = await readObject(response, "uncertain");
  if (!safeString(value.id, 512)) throw new TradeEmailProviderError("email_provider_response_invalid", "uncertain");
  return { providerMessageId: value.id, providerStatus: "accepted" };
}
