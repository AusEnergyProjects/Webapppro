import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { NETWORK_MAX_BODY_BYTES, NetworkError, networkInvalid } from "@/lib/trade-network";
import { assertNetworkAccess, changeNetworkEnquiry, changeNetworkPost, createNetworkEnquiry, listNetwork, saveNetworkPost, setNetworkMembership } from "@/lib/trade-network-server";

export const runtime = "edge";
function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof TradeAccessError || error instanceof NetworkError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to use the trade network." }, 401);
  if (["PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "TRADE_ROLE_REQUIRED", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) return adminJson({ ok: false, code, error: "Approved business access is required to use the trade network." }, 403);
  return adminJson({ ok: false, error: "The trade network is temporarily unavailable. Try again shortly." }, 503);
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > NETWORK_MAX_BODY_BYTES || !request.body) return networkInvalid();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > NETWORK_MAX_BODY_BYTES) { await reader.cancel(); return networkInvalid(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return networkInvalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return networkInvalid();
  return parsed as Record<string, unknown>;
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    assertNetworkAccess(access);
    return adminJson({ ok: true, ...await listNetwork(access, Object.fromEntries(new URL(request.url).searchParams)) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    assertNetworkAccess(access);
    const body = await readBody(request);
    if (body.action === "membership") return adminJson({ ok: true, ...await setNetworkMembership(access, body.enabled) });
    if (body.action === "save_post") return adminJson({ ok: true, post: await saveNetworkPost(access, body.id, body.expectedRevision, body.post) });
    if (body.action === "close_post" || body.action === "renew_post") return adminJson({ ok: true, post: await changeNetworkPost(access, body.action, body.id, body.expectedRevision) });
    if (body.action === "enquire") return adminJson({ ok: true, enquiry: await createNetworkEnquiry(access, body) });
    if (body.action === "connect" || body.action === "close_enquiry") return adminJson({ ok: true, enquiry: await changeNetworkEnquiry(access, body.action, body) });
    return networkInvalid();
  } catch (error) { return errorResponse(error); }
}
