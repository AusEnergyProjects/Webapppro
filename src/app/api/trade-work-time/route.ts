import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { ReportInputError } from "@/lib/trade-business-reports";
import { parseWorkTimeBatch, WorkTimeInputError } from "@/lib/trade-work-time";
import { loadWorkTimeReport, saveWorkTimeSessions, WorkTimeAccessError, WorkTimeConflictError, WorkTimeCapacityError } from "@/lib/trade-work-time-server";

export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to view or record work activity." }, 401);
  if (error instanceof WorkTimeAccessError || error instanceof TradeAccessError || ["TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "ACCOUNT_INACTIVE", "EMAIL_VERIFICATION_REQUIRED", "FIELD_SESSION_REQUIRED", "FIELD_SESSION_EXPIRED", "FIELD_SESSION_REVOKED"].includes(code)) return adminJson({ ok: false, error: "You no longer have access to this work activity." }, 403);
  if (error instanceof WorkTimeConflictError) return adminJson({ ok: false, error: error.message }, 409);
  if (error instanceof WorkTimeCapacityError) return adminJson({ ok: false, error: error.message, people: error.members.map(member => ({ memberId: member.id, name: member.display_name })) }, 422);
  if (error instanceof WorkTimeInputError || error instanceof ReportInputError) return adminJson({ ok: false, error: error.message }, 400);
  if (error instanceof RequestBodyTooLargeError) return adminJson({ ok: false, error: "The activity batch is too large." }, 413);
  if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid activity data." }, 400);
  return adminJson({ ok: false, error: "Work activity is temporarily unavailable. Please try again." }, 503);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { return adminJson({ ok: true, report: await loadWorkTimeReport(await requireInstallerTeamAccess(request), new URL(request.url).searchParams) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const sessions = parseWorkTimeBatch(JSON.parse(await readBoundedRequestText(request, 48_000)));
    return adminJson({ ok: true, accepted: await saveWorkTimeSessions(access, sessions) });
  } catch (error) { return failure(error); }
}
