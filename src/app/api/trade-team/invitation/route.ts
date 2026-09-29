import { adminJson } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { inspectTradeTeamInvitation, TradeTeamInvitationError } from "@/lib/trade-team-invitation-server";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const identity = request.headers.has("authorization") ? await requireFirebaseIdentity(request) : undefined;
    const invitation = await inspectTradeTeamInvitation(new URL(request.url).searchParams.get("invite") || "", identity);
    return adminJson({ ok: true, invitation });
  } catch (error) {
    if (error instanceof TradeTeamInvitationError) {
      return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
    }
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return adminJson({ ok: false, error: "Sign in again to reopen this invitation." }, 401);
    }
    return adminJson({ ok: false, error: "The invitation could not be loaded. Please try again." }, 503);
  }
}
