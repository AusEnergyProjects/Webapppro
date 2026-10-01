import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { listTradeCrews, saveTradeCrew, TradeCrewError } from "@/lib/trade-crews-server";
import { TradeBusinessContextError } from "@/lib/trade-business-context-server";

function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof TradeCrewError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
  if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Check the crew details." }, 400);
  if (error instanceof Error && /^(AUTH_REQUIRED|EMAIL_VERIFICATION_REQUIRED|TEAM_ACCESS_RECORD_REQUIRED|ABN_REVIEW_REQUIRED)$/.test(error.message)) {
    return adminJson({ ok: false, error: "Crew access could not be verified." }, error.message === "AUTH_REQUIRED" ? 401 : 403);
  }
  return adminJson({ ok: false, error: "The crew request could not be completed." }, 500);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const access = await requireInstallerTeamAccess(request); return adminJson({ ok: true, ...await listTradeCrews(access) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TradeCrewError(400, "Check the crew details.");
    await saveTradeCrew(access, body as Record<string, unknown>);
    return adminJson({ ok: true, ...await listTradeCrews(access) });
  } catch (error) { return failure(error); }
}
