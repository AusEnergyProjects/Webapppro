import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { readTradeTeamPresence, updateTradeTeamPresence } from "@/lib/trade-team-presence-server";

export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ok:false,error:"Sign in to change your call availability."},401);
  if (error instanceof TradeAccessError || ["PRESENCE_ACCESS_REQUIRED","TEAM_ACCESS_REQUIRED","TEAM_ACCESS_RECORD_REQUIRED","ABN_REVIEW_REQUIRED","ACCOUNT_INACTIVE","EMAIL_VERIFICATION_REQUIRED","FIELD_SESSION_REQUIRED","FIELD_SESSION_EXPIRED","FIELD_SESSION_REVOKED"].includes(code)) return adminJson({ok:false,error:"You no longer have access to this team."},403);
  if (error instanceof RequestBodyTooLargeError) return adminJson({ok:false,error:"Choose Online, Busy or Offline."},413);
  if (error instanceof SyntaxError || code === "PRESENCE_INPUT_INVALID") return adminJson({ok:false,error:"Choose Online, Busy or Offline."},400);
  return adminJson({ok:false,error:"Your call availability could not be saved. Try again."},503);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try { return adminJson({ok:true,...await readTradeTeamPresence(await requireTeamCommunicationAccess(request))}); }
  catch(error) { return failure(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const actor = await requireTeamCommunicationAccess(request);
    const body: unknown = JSON.parse(await readBoundedRequestText(request,256));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("status" in body)) throw new Error("PRESENCE_INPUT_INVALID");
    return adminJson({ok:true,...await updateTradeTeamPresence(actor,body.status)});
  } catch(error) { return failure(error); }
}
