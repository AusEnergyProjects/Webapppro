import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { tradeMapConfiguration } from "@/lib/trade-map-configuration";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireInstallerTeamAccess(request);
    return adminJson({ ok: true, ...tradeMapConfiguration(process.env) });
  } catch (error) {
    const mfa = mfaErrorResponse(error);
    if (mfa) return mfa;
    if (error instanceof TradeAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to view your map." }, 401);
    if (["PROFILE_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY", "TRADE_ROLE_REQUIRED", "FULL_ACCESS_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) {
      return adminJson({ ok: false, error: "Your account does not currently have access to the trade workspace." }, 403);
    }
    return adminJson({ ok: false, error: "Map settings could not be loaded. Try again shortly." }, 503);
  }
}
