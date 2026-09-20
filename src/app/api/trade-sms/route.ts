import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { connectSms, disconnectSms, recordSmsConsent, sendTradeSms, smsWorkspace } from "@/lib/trade-sms-server";
import { inspectSmsAccount, smsCredentials } from "@/lib/trade-sms-provider";

export const runtime = "edge";

function smsError(error: unknown) {
  if (error instanceof TradeAccessError) return adminJson({ ok: false, error: "SMS is available to the verified business owner only." }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED", "ABN_REVIEW_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "SMS is available to the verified business owner only." }, 403);
  const messages: Record<string, string> = {
    SMS_CREDENTIALS_INVALID: "Enter the Twilio Account SID and account Auth Token.",
    SMS_CREDENTIALS_REJECTED: "Twilio did not accept those account credentials.",
    SMS_ACCOUNT_INACTIVE: "Choose an active Twilio account.",
    SMS_MAIN_ACCOUNT_REQUIRED: "Connect your business's main Twilio account. Subaccounts share another account's bill and are not supported here.",
    SMS_NUMBER_INVALID: "Choose an SMS-capable number already owned by this Twilio account.",
    SMS_ROUTING_CONFLICT: "This number already routes messages to another application or Messaging Service. Choose a dedicated number or update its routing in Twilio first.",
    SMS_ROUTING_UNCONFIRMED: "Twilio has not confirmed the number's incoming-message routing. Check the connection again before sending.",
    SMS_NUMBER_ALREADY_CONNECTED: "This number is already linked to another TLink business.",
    SMS_DISCONNECT_FIRST: "Disconnect the current SMS number before choosing another.",
    SMS_CONNECTION_ORIGIN_CHANGED: "Open TLink using the original connection's website address to reconnect this number.",
    SMS_CONNECTION_REQUIRED: "Connect your business's Twilio number in Integrations first.",
    SMS_CUSTOMER_REQUIRED: "Choose an active customer owned by your business.",
    SMS_MOBILE_REQUIRED: "Save an Australian mobile number on this customer first.",
    SMS_PHONE_CONFLICT: "This mobile number already belongs to a different SMS conversation in your customer records.",
    SMS_CONSENT_NOTE_REQUIRED: "Record how this customer agreed to service text messages (8 to 500 characters).",
    SMS_CONSENT_REQUIRED: "Record this customer's permission for service text messages first.",
    SMS_OPTED_OUT: "This customer opted out. They must text START to your connected number before further service texts can be sent.",
    SMS_BODY_INVALID: "Enter a message of 1 to 480 characters without control characters.",
    SMS_REQUEST_ID_REQUIRED: "Refresh the conversation before sending.",
    SMS_REQUEST_CONFLICT: "This send request was already used for different content. Refresh the conversation.",
    SMS_LIMIT_INVALID: "Choose a daily segment limit from 1 to 1000.",
    SMS_LIMIT_OR_PERMISSION_CHANGED: "The daily segment limit was reached, or the customer's permission or phone changed. Refresh the conversation.",
    SMS_ACCOUNT_TOO_LARGE: "This account has too many numbers or Messaging Services for automatic setup. Use a dedicated business account.",
    SMS_PROVIDER_UNAVAILABLE: "Twilio could not complete the connection check. Try again without changing existing message requests.",
    SMS_PROVIDER_RESPONSE_INVALID: "Twilio returned an unexpected response. No connection has been confirmed.",
    INTEGRATION_ENCRYPTION_UNAVAILABLE: "Secure connection storage is temporarily unavailable.",
    INTEGRATION_CREDENTIALS_INVALID: "Reconnect your Twilio account to restore secure access.",
  };
  return adminJson({ ok: false, error: messages[code] || "The SMS request could not be completed. Refresh the conversation before trying another send." }, messages[code] ? 409 : 500);
}

async function requestBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 6000) throw new Error("SMS_BODY_INVALID");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SMS_BODY_INVALID");
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const owner = await requireInstallerOperations(request);
    return adminJson({ ok: true, ...await smsWorkspace(owner.uid, new URL(request.url).searchParams.get("customerId") || "") });
  } catch (error) { return smsError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const owner = await requireInstallerOperations(request);
    const body = await requestBody(request);
    if (body.action === "inspect") return adminJson({ ok: true, ...await inspectSmsAccount(smsCredentials(body.accountSid, body.authToken)) });
    if (body.action === "connect") {
      await connectSms(owner.uid, smsCredentials(body.accountSid, body.authToken), String(body.numberSid || ""), body.dailyLimit, new URL(request.url).origin);
      return adminJson({ ok: true });
    }
    if (body.action === "consent") {
      await recordSmsConsent(owner.uid, String(body.customerId || ""), body.consentNote);
      return adminJson({ ok: true });
    }
    if (body.action === "send") return adminJson({ ok: true, message: await sendTradeSms(owner, String(body.customerId || ""), body.body, body.requestId) });
    return adminJson({ ok: false, error: "Choose an SMS action." }, 400);
  } catch (error) { return smsError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const owner = await requireInstallerOperations(request);
    const body = await requestBody(request);
    if (body.action !== "disconnect") return adminJson({ ok: false, error: "Choose an SMS action." }, 400);
    await disconnectSms(owner.uid);
    return adminJson({ ok: true });
  } catch (error) { return smsError(error); }
}
