import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { TradeBusinessContextError } from "@/lib/trade-business-context-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { assertEngagementOwner, readMemberEngagement, saveMemberEngagement } from "@/lib/trade-member-engagement-server";
import { MemberEngagementError } from "@/lib/trade-member-engagement";

export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  if (error instanceof MemberEngagementError || error instanceof BoundedJsonRequestError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, error: error.publicMessage }, error.status);
  if (error instanceof Error && ["AUTH_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "ABN_REVIEW_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(error.message)) return adminJson({ ok: false, error: "Sign in with the business owner's account to continue." }, error.message === "AUTH_REQUIRED" ? 401 : 403);
  return adminJson({ ok: false, error: "Private pay and onboarding records are temporarily unavailable. No changes were confirmed." }, 503);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); assertEngagementOwner(access);
    return adminJson({ ok: true, ...await readMemberEngagement(access, new URL(request.url).searchParams.get("memberId") || "") });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); assertEngagementOwner(access);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MemberEngagementError(400, "Check the private record.");
    return adminJson({ ok: true, ...await saveMemberEngagement(access, Object.fromEntries(Object.entries(body))) });
  } catch (error) { return failure(error); }
}
