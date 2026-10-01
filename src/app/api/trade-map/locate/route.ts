import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { getGnafDirectory } from "@/lib/gnaf-directory-server";
import { readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireInstallerTeamAccess(request);
    let body: unknown;
    try { body = await readBoundedJsonRequest(request, 8192); }
    catch { return adminJson({ ok: false, error: "Enter a street address, suburb, state and postcode." }, 400); }
    if (!body || typeof body !== "object" || !("address" in body) || typeof body.address !== "string" || body.address.length > 1000) {
      return adminJson({ ok: false, error: "Enter a street address, suburb, state and postcode." }, 400);
    }
    const directory = await getGnafDirectory();
    const [match] = await directory.resolve([body.address]);
    const result = match.status === "located" ? { status: match.status, position: match.position, approximate: match.approximate } : match;
    return adminJson({ ok: true, result });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    if (error instanceof TradeAccessError) return adminJson({ ok: false, error: error.message }, error.status);
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to search the map." }, 401);
    if (["PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "TRADE_ROLE_REQUIRED", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "Team access is required." }, 403);
    return adminJson({ ok: false, error: "The shared address directory is unavailable. Try again shortly." }, 503);
  }
}
