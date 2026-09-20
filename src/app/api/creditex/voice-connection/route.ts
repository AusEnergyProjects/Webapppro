import { getD1 } from "../../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { ComplianceAccessError, requireComplianceAccess } from "@/lib/compliance-access-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "@/lib/trade-compliance-intent";
import { connectVoiceAccount, disconnectVoiceAccount, inspectVoiceAccount, refreshVoiceNumbers, updateVoiceNumbers, voiceCredentials, voiceWorkspace } from "@/lib/creditex-voice-connection-server";

export const runtime = "edge";

const messages: Record<string, string> = {
  VOICE_CREDENTIALS_INVALID: "Enter your Telnyx API key and the account's Ed25519 public key.",
  VOICE_CREDENTIALS_REJECTED: "Telnyx did not accept that API key. Check its access and expiry in your Telnyx account.",
  VOICE_OWNERSHIP_REQUIRED: "Confirm that this is Creditex's own Telnyx account and Creditex accepts its carrier charges.",
  VOICE_NUMBER_INVALID: "Choose an active Australian local or mobile voice number owned by this Telnyx account.",
  VOICE_ASSIGNMENTS_INVALID: "Choose current Creditex staff and eligible numbers from this account.",
  VOICE_ACCOUNT_ALREADY_CONNECTED: "This organisation or Telnyx account already has a connection. Refresh its status.",
  VOICE_DISCONNECT_FIRST: "This account is already connected. Save number assignments or disconnect it first.",
  VOICE_CONNECTION_REQUIRED: "Connect Creditex's Telnyx account first.",
  VOICE_SETUP_PENDING: "Telnyx has not confirmed a setup resource. Check setup again to reconcile it. If it remains pending, ask support to inspect the dedicated TLink resources in Telnyx before attempting a new setup.",
  VOICE_DISCONNECT_BUSY: "Finish active calls and save outstanding recordings before disconnecting. Pending account setup must also be reconciled first.",
  VOICE_PROVIDER_UNAVAILABLE: "Telnyx could not complete this check. Refresh the saved connection before trying again.",
  VOICE_PROVIDER_RESPONSE_INVALID: "Telnyx returned an unexpected response. The connection has not been confirmed.",
  VOICE_ACCOUNT_TOO_LARGE: "The Telnyx account exceeds the supported number inventory. Ask support to review the account.",
  INTEGRATION_ENCRYPTION_UNAVAILABLE: "Secure connection storage is temporarily unavailable.",
  INTEGRATION_CREDENTIALS_INVALID: "The saved credentials could not be read. Ask support to recover the connection.",
};

function failure(error: unknown) {
  if (error instanceof ComplianceAccessError) return adminJson({ ok: false, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  return adminJson({ ok: false, error: messages[code] || "Creditex calling setup could not be completed. Refresh its status before trying again." }, messages[code] ? 409 : 500);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 50000) throw new Error("VOICE_ASSIGNMENTS_INVALID");
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("VOICE_ASSIGNMENTS_INVALID");
  return data as Record<string, unknown>;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1();
    const owner = await requireComplianceAccess(request, { allowedRoles: ["admin"], organisationId: new URL(request.url).searchParams.get("organisationId") || undefined, claimPendingInvitation: false }, database);
    if (owner.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) throw new ComplianceAccessError("CREDITEX_ACCESS_REQUIRED", 403, "Creditex administrator access is required.");
    return adminJson({ ok: true, ...await voiceWorkspace(database, owner.organisationId) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const database = getD1();
    const input = await body(request);
    const owner = await requireComplianceAccess(request, { allowedRoles: ["admin"], organisationId: typeof input.organisationId === "string" ? input.organisationId : undefined, claimPendingInvitation: false }, database);
    if (owner.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE) throw new ComplianceAccessError("CREDITEX_ACCESS_REQUIRED", 403, "Creditex administrator access is required.");
    if (input.action === "inspect") return adminJson({ ok: true, ...await inspectVoiceAccount(voiceCredentials(input.apiKey, input.publicKey)) });
    if (input.action === "connect") await connectVoiceAccount(database, owner, input);
    else if (input.action === "saveNumbers") await updateVoiceNumbers(database, owner.organisationId, input);
    else if (input.action === "refreshNumbers") return adminJson({ ok: true, ...await refreshVoiceNumbers(database, owner.organisationId) });
    else if (input.action === "disconnect") await disconnectVoiceAccount(database, owner.organisationId);
    else return adminJson({ ok: false, error: "Choose a calling setup action." }, 400);
    return adminJson({ ok: true, ...await voiceWorkspace(database, owner.organisationId) });
  } catch (error) { return failure(error); }
}
