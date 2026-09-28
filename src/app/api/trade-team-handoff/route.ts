import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { closeCommunicationSession, communicationCookieHeader, communicationSessionSummary, issueCommunicationHandoff, redeemCommunicationHandoff, requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
export const runtime = "edge";
function failure(error: unknown) {
  const mfa = mfaErrorResponse(error); if (mfa) return mfa;
  const code = error instanceof Error ? error.message : "";
  if (error instanceof RequestBodyTooLargeError) return adminJson({ok:false,error:"This request is too large."},413);
  const errors: Record<string,string> = { AUTH_REQUIRED:"Open Messages from the TLink app, or sign in with your team account.", HANDOFF_EXPIRED:"This link has expired or was already opened. Open Messages again from the TLink app.", HANDOFF_INVALID:"Open Messages again from the TLink app.", HANDOFF_ACCESS_REQUIRED:"This conversation is no longer available to you.", HANDOFF_RATE_LIMIT:"Wait a moment before opening Messages again." };
  return adminJson({ok:false,code,error:errors[code] || "Messages could not be opened. Check your team access and try again."},code === "HANDOFF_RATE_LIMIT" ? 429 : code === "HANDOFF_INVALID" ? 400 : code === "AUTH_REQUIRED" || code === "HANDOFF_EXPIRED" ? 401 : 403);
}
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try { return adminJson({ok:true,access:communicationSessionSummary(await requireTeamCommunicationAccess(request))}); } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try {
    const input: unknown = JSON.parse(await readBoundedRequestText(request,2000));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("HANDOFF_INVALID");
    const body = input as Record<string,unknown>;
    if (body.action === "issue") return adminJson({ok:true,...await issueCommunicationHandoff(request,body)});
    if (body.action === "redeem") {
      const result = await redeemCommunicationHandoff(request,body.code);
      const response = adminJson({ok:true,access:communicationSessionSummary(result.actor),threadId:result.threadId,callId:result.callId});
      response.headers.set("Set-Cookie",result.cookie); return response;
    }
    throw new Error("HANDOFF_INVALID");
  } catch(error) { return failure(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ok:false,error:"Request origin was not accepted."},403);
  try { await closeCommunicationSession(request); const response=adminJson({ok:true}); response.headers.set("Set-Cookie",communicationCookieHeader("",0)); return response; } catch(error) { return failure(error); }
}
