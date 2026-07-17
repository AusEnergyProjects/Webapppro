type Runtime = Record<string, string | undefined>;

export type ReminderChannel = "email" | "sms";

export type ProviderConfiguration = {
  email: { configured: boolean; provider: "resend"; from: string; callbacks: boolean };
  sms: { configured: boolean; provider: "twilio"; messagingService: boolean; verifyService: boolean; callbacks: boolean };
};

export type ReminderProviderMessage = {
  channel: ReminderChannel;
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  callbackUrl: string;
};

const textEncoder = new TextEncoder();

function runtimeValues(runtime: Runtime = process.env) {
  return runtime;
}

function present(value: unknown, minimum = 1) {
  return String(value || "").trim().length >= minimum;
}

export function serviceReminderProviderConfiguration(runtime: Runtime = process.env): ProviderConfiguration {
  const values = runtimeValues(runtime);
  return {
    email: {
      configured: present(values.RESEND_API_KEY, 12) && present(values.RESEND_FROM_EMAIL, 5),
      provider: "resend",
      from: present(values.RESEND_FROM_EMAIL, 5) ? String(values.RESEND_FROM_EMAIL).trim() : "",
      callbacks: present(values.RESEND_WEBHOOK_SECRET, 20),
    },
    sms: {
      configured: present(values.TWILIO_ACCOUNT_SID, 34) && present(values.TWILIO_AUTH_TOKEN, 20)
        && present(values.TWILIO_MESSAGING_SERVICE_SID, 34),
      provider: "twilio",
      messagingService: present(values.TWILIO_MESSAGING_SERVICE_SID, 34),
      verifyService: present(values.TWILIO_VERIFY_SERVICE_SID, 34),
      callbacks: present(values.TWILIO_AUTH_TOKEN, 20),
    },
  };
}

export function normalizeAustralianMobile(value: unknown) {
  const compact = String(value || "").replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(compact)) return `+61${compact.slice(1)}`;
  if (/^\+614\d{8}$/.test(compact)) return compact;
  return "";
}

export function serviceReminderSmsBody(body: unknown) {
  const core = String(body || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const suffix = " Reply STOP to unsubscribe.";
  return `${core.slice(0, 420 - suffix.length).trim()}${suffix}`;
}

export function serviceReminderRetryAt(attempts: number, now = Date.now()) {
  const minutes = [5, 30, 120][Math.min(Math.max(Number(attempts) - 1, 0), 2)];
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export async function serviceReminderIdempotencyKey(followUpId: string, channel: ReminderChannel, revision: number) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(`${followUpId}|${channel}|${revision}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sendServiceReminderProviderMessage(
  input: ReminderProviderMessage,
  { runtime = process.env, fetchImpl = fetch }: { runtime?: Runtime; fetchImpl?: typeof fetch } = {},
) {
  const values = runtimeValues(runtime);
  if (input.channel === "email") {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${values.RESEND_API_KEY || ""}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: values.RESEND_FROM_EMAIL,
        to: [input.recipient],
        subject: input.subject,
        text: input.body,
        reply_to: values.RESEND_REPLY_TO || undefined,
        tags: [{ name: "message_type", value: "service_reminder" }],
      }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !result.id) throw new Error(`Resend rejected the message with HTTP ${response.status}.`);
    return { provider: "resend", providerMessageId: String(result.id), providerStatus: "sent" };
  }

  const accountSid = String(values.TWILIO_ACCOUNT_SID || "");
  const parameters = new URLSearchParams({
    To: input.recipient,
    MessagingServiceSid: String(values.TWILIO_MESSAGING_SERVICE_SID || ""),
    Body: serviceReminderSmsBody(input.body),
    StatusCallback: input.callbackUrl,
  });
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${values.TWILIO_AUTH_TOKEN || ""}`)}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: parameters.toString(),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !result.sid) throw new Error(`Twilio rejected the message with HTTP ${response.status}.`);
  return { provider: "twilio", providerMessageId: String(result.sid), providerStatus: String(result.status || "queued") };
}

export async function startTwilioMobileVerification(mobileE164: string, runtime: Runtime = process.env, fetchImpl: typeof fetch = fetch) {
  const values = runtimeValues(runtime); const accountSid = String(values.TWILIO_ACCOUNT_SID || "");
  const serviceSid = String(values.TWILIO_VERIFY_SERVICE_SID || "");
  const response = await fetchImpl(`https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/Verifications`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${values.TWILIO_AUTH_TOKEN || ""}`)}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ To: mobileE164, Channel: "sms" }).toString(), cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !result.sid) throw new Error("Twilio could not start mobile verification.");
  return { sid: String(result.sid), status: String(result.status || "pending") };
}

export async function confirmTwilioMobileVerification(mobileE164: string, code: string, runtime: Runtime = process.env, fetchImpl: typeof fetch = fetch) {
  const values = runtimeValues(runtime); const accountSid = String(values.TWILIO_ACCOUNT_SID || "");
  const serviceSid = String(values.TWILIO_VERIFY_SERVICE_SID || "");
  const response = await fetchImpl(`https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/VerificationCheck`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${values.TWILIO_AUTH_TOKEN || ""}`)}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ To: mobileE164, Code: code }).toString(), cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.status !== "approved") throw new Error("The mobile verification code was not accepted.");
  return { status: "approved" as const };
}

function base64Bytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(algorithm: "SHA-1" | "SHA-256", secret: Uint8Array, content: string) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(Array.from(secret)).buffer, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(content)));
}

export async function verifyResendWebhook(rawBody: string, headers: Headers, secret: string, now = Date.now()) {
  const id = headers.get("svix-id") || ""; const timestamp = headers.get("svix-timestamp") || "";
  const supplied = headers.get("svix-signature") || "";
  if (!id || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let expected: Uint8Array;
  try { expected = await hmac("SHA-256", base64Bytes(encodedSecret), `${id}.${timestamp}.${rawBody}`); }
  catch { return false; }
  return supplied.split(" ").some((entry) => {
    const encoded = entry.startsWith("v1,") ? entry.slice(3) : "";
    try { return encoded ? constantTimeEqual(base64Bytes(encoded), expected) : false; } catch { return false; }
  });
}

export async function verifyTwilioWebhook(url: string, parameters: URLSearchParams, signature: string, authToken: string) {
  const entries = Array.from(parameters.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const content = entries.reduce((value, [key, item]) => `${value}${key}${item}`, url);
  const expected = await hmac("SHA-1", textEncoder.encode(authToken), content);
  let supplied: Uint8Array;
  try { supplied = base64Bytes(signature); } catch { return false; }
  return constantTimeEqual(supplied, expected);
}
