import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { loadOwnerCalendarEvents } from "@/lib/trade-calendar-events-server";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    // Team schedule visibility never grants access to the owner's personal calendar.
    if (!access.isOwner || access.actorUid !== access.ownerUid) return adminJson({ ok: false, error: "Connected calendar events are private to the business owner." }, 403);
    const query = new URL(request.url).searchParams;
    const result = await loadOwnerCalendarEvents(access.ownerUid, access.memberId, query.get("rangeStart") || "", query.get("rangeEnd") || "");
    return adminJson({ ok: true, ...result });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_CALENDAR_RANGE") return adminJson({ ok: false, error: "Choose a calendar range of 1 to 31 days." }, 400);
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to view your calendar." }, 401);
    if (["BUSINESS_ACCESS_REQUIRED", "BUSINESS_SELECTION_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY"].includes(code)) return adminJson({ ok: false, error: "Your business access does not permit this calendar." }, 403);
    return adminJson({ ok: false, error: "Your connected calendar could not be loaded. Refresh to try again." }, 500);
  }
}
