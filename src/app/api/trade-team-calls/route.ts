import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
import { waitUntil } from "cloudflare:workers";
import { notifyTeamCall } from "@/lib/trade-push-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { assertTeamCallJoined, incomingTeamCalls, joinTeamCall, leaveTeamCall, reserveTeamCallIce, sendTeamCallSignal, startTeamCall, teamCallStatus } from "@/lib/trade-team-calls-server";
import { teamCallIceServers, teamCallTurnCredentials } from "@/lib/trade-team-calls-provider";
export const runtime = "edge";
function failure(error: unknown) {
    const mfa = mfaErrorResponse(error);
    if (mfa)
        return mfa;
    if (error instanceof TradeAccessError)
        return adminJson({ ok: false, error: "You do not have access to team calls." }, error.status);
    const code = error instanceof Error ? error.message : '';
    if (code === 'AUTH_REQUIRED')
        return adminJson({ ok: false, error: "Sign in to use team calls.", code }, 401);
    if (['CALL_ACCESS_REQUIRED', 'TEAM_ACCESS_REQUIRED', 'TEAM_ACCESS_RECORD_REQUIRED', 'ABN_REVIEW_REQUIRED', 'ACCOUNT_INACTIVE', 'EMAIL_VERIFICATION_REQUIRED', 'INSTALLER_ONLY', 'PROFILE_REQUIRED', 'FULL_ACCESS_REQUIRED'].includes(code))
        return adminJson({ ok: false, error: "You do not have access to this call.", code }, 403);
    if (error instanceof RequestBodyTooLargeError)
        return adminJson({ ok: false, error: "Call details were too large.", code: 'CALL_INPUT_INVALID' }, 413);
    const errors: Record<string, string> = { CALL_INPUT_INVALID: "Refresh the conversation before calling.", CALL_SIGNAL_INVALID: "Call connection details were not accepted.", CALL_REQUEST_CONFLICT: "That call request has already been used. Refresh the conversation.", CALL_ALREADY_ACTIVE: "There is already a call in this conversation. Join the existing call.", CALL_ENDED: "This call has ended.", CALL_FULL: "This call already has six people.", CALL_SESSION_REPLACED: "This call was opened in another tab or device.", CALL_RATE_LIMIT: "Too many call requests. Wait a moment and try again.", CALL_UNAVAILABLE: "Team calls are not configured yet.", CALL_RELAY_UNAVAILABLE: "The call connection service is unavailable. Try again shortly." };
    return adminJson({ ok: false, error: errors[code] || "The call could not be connected. Try again.", code: errors[code] ? code : 'CALL_UNAVAILABLE' }, code === 'CALL_RATE_LIMIT' ? 429 : code === 'CALL_UNAVAILABLE' || code === 'CALL_RELAY_UNAVAILABLE' ? 503 : error instanceof SyntaxError || code === 'CALL_INPUT_INVALID' || code === 'CALL_SIGNAL_INVALID' ? 400 : errors[code] ? 409 : 500);
}
export async function GET(request: Request) {
    if (!sameOrigin(request))
        return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
    try {
        const actor = await requireTeamCommunicationAccess(request), params = new URL(request.url).searchParams;
        if (params.get('view') === 'incoming')
            return adminJson({ ok: true, memberId: actor.memberId, calls: await incomingTeamCalls(actor) });
        return adminJson({ ok: true, memberId: actor.memberId, ...await teamCallStatus(actor, { callId: params.get('callId') || undefined, threadId: params.get('threadId') || undefined, sessionId: params.get('sessionId') || undefined, after: params.get('after') || '0' }) });
    }
    catch (error) {
        return failure(error);
    }
}
export async function POST(request: Request) {
    if (!sameOrigin(request))
        return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
    try {
        const actor = await requireTeamCommunicationAccess(request);
        const raw: unknown = JSON.parse(await readBoundedRequestText(request, 70000));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('CALL_INPUT_INVALID');
        const body = raw as Record<string, unknown>;
        if (body.action === 'start') {
            teamCallTurnCredentials(); // A missing relay must not create a ringing call.
            const call = await startTeamCall(actor, body);
            waitUntil(notifyTeamCall(actor, call));
            return adminJson({ ok: true, memberId: actor.memberId, call });
        }
        if (body.action === 'join')
            return adminJson({ ok: true, memberId: actor.memberId, call: await joinTeamCall(actor, body.callId, body.sessionId) });
        if (body.action === 'leave')
            return adminJson({ ok: true, memberId: actor.memberId, call: await leaveTeamCall(actor, body.callId, body.sessionId) });
        if (body.action === 'signal') {
            await sendTeamCallSignal(actor, body);
            return adminJson({ ok: true });
        }
        if (body.action === 'ice') {
            const credentials = teamCallTurnCredentials(), reservation = await reserveTeamCallIce(actor, body.callId, body.sessionId);
            const iceServers = await teamCallIceServers(credentials, reservation.ttl);
            await assertTeamCallJoined(actor, body.callId, body.sessionId); // Auth/session can change while the provider responds.
            return adminJson({ ok: true, iceServers, expiresAt: reservation.expiresAt });
        }
        throw new Error('CALL_INPUT_INVALID');
    }
    catch (error) {
        return failure(error);
    }
}
