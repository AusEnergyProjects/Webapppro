import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { TradeAccessError } from "@/lib/trade-access-server";
import { requireTeamCommunicationAccess } from "@/lib/trade-communications-access";
import { CALL_ANSWER_HEADER, requireTeamCallAnswerAccess } from "@/lib/trade-call-answer-access";
import { waitUntil } from "cloudflare:workers";
import { notifyTeamCall, notifyTeamCallEnded } from "@/lib/trade-push-server";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";
import { assertTeamCallJoined, incomingTeamCalls, joinTeamCall, leaveTeamCall, reserveTeamCallIce, sendTeamCallSignal, startTeamCall, teamCallStatus } from "@/lib/trade-team-calls-server";
import { teamCallIceServers, teamCallTurnCredentials } from "@/lib/trade-team-calls-provider";
export const runtime = "edge";
// Only fixed operation names, result codes and timings enter call diagnostics.
// Never log request bodies, identities, SDP, candidates or relay credentials.
function callTrace(method: "GET" | "POST", action: string) {
    const started = Date.now(), state = { action, stage: "access" };
    const report = (code: string) => console.warn("tlink_team_call", { method, ...state, code, elapsedMs: Date.now() - started });
    const timer = setTimeout(() => report("CALL_SLOW"), 8000);
    return { state, finish(error?: unknown) {
        clearTimeout(timer);
        const code = error instanceof Error && /^CALL_(?:INPUT_INVALID|SIGNAL_INVALID|REQUEST_CONFLICT|ALREADY_ACTIVE|RECIPIENT_UNAVAILABLE|PRESENCE_UNAVAILABLE|ENDED|FULL|SESSION_REPLACED|RATE_LIMIT|UNAVAILABLE|RELAY_UNAVAILABLE|ACCESS_REQUIRED)$/.test(error.message) ? error.message : error ? "CALL_REQUEST_FAILED" : "OK";
        if (error || Date.now() - started >= 4000) report(code);
    } };
}
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
    const errors: Record<string, string> = { CALL_INPUT_INVALID: "Refresh the conversation before calling.", CALL_SIGNAL_INVALID: "Call connection details were not accepted.", CALL_REQUEST_CONFLICT: "That call request has already been used. Refresh the conversation.", CALL_ALREADY_ACTIVE: "There is already a call in this conversation. Join the existing call.", CALL_RECIPIENT_UNAVAILABLE: "No one in this chat is available for a call. They may be busy or offline. Send a message instead.", CALL_PRESENCE_UNAVAILABLE: "Your status is Busy or Offline. Switch to Online before joining a call.", CALL_ENDED: "This call has ended.", CALL_FULL: "This call already has six people.", CALL_SESSION_REPLACED: "This call was opened in another tab or device.", CALL_RATE_LIMIT: "Too many call requests. Wait a moment and try again.", CALL_UNAVAILABLE: "Team calls are not configured yet.", CALL_RELAY_UNAVAILABLE: "The call connection service is unavailable. Try again shortly." };
    return adminJson({ ok: false, error: errors[code] || "The call could not be connected. Try again.", code: errors[code] ? code : 'CALL_UNAVAILABLE' }, code === 'CALL_RATE_LIMIT' ? 429 : code === 'CALL_UNAVAILABLE' || code === 'CALL_RELAY_UNAVAILABLE' ? 503 : error instanceof SyntaxError || code === 'CALL_INPUT_INVALID' || code === 'CALL_SIGNAL_INVALID' ? 400 : errors[code] ? 409 : 500);
}
export async function GET(request: Request) {
    if (!sameOrigin(request))
        return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
    const trace = callTrace("GET", new URL(request.url).searchParams.get('view') === 'incoming' ? "incoming" : "status");
    let failureError: unknown;
    try {
        const params = new URL(request.url).searchParams;
        const grant = request.headers.has(CALL_ANSWER_HEADER) ? await requireTeamCallAnswerAccess(request, {
            action: params.get('view') === 'incoming' ? 'incoming' : 'status',
            callId: params.get('callId') || undefined, threadId: params.get('threadId') || undefined,
        }) : null;
        const actor = grant?.actor || await requireTeamCommunicationAccess(request);
        const identity = { memberId: actor.memberId, ...(grant ? { ownerUid: actor.ownerUid } : {}) };
        trace.state.stage = trace.state.action;
        if (params.get('view') === 'incoming') {
            const scoped = grant ? await teamCallStatus(actor, { callId: grant.callId, threadId: grant.threadId }) : null;
            return adminJson({ ok: true, ...identity, calls: grant ? scoped?.call?.status === 'active' ? [scoped.call] : [] : await incomingTeamCalls(actor) });
        }
        return adminJson({ ok: true, ...identity, ...await teamCallStatus(actor, { callId: params.get('callId') || undefined, threadId: params.get('threadId') || undefined, sessionId: params.get('sessionId') || undefined, after: params.get('after') || '0' }) });
    }
    catch (error) {
        failureError = error;
        return failure(error);
    }
    finally { trace.finish(failureError); }
}
export async function POST(request: Request) {
    if (!sameOrigin(request))
        return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
    const trace = callTrace("POST", "unknown");
    let failureError: unknown;
    try {
        const ordinaryActor = request.headers.has(CALL_ANSWER_HEADER) ? null : await requireTeamCommunicationAccess(request);
        trace.state.stage = "input";
        const raw: unknown = JSON.parse(await readBoundedRequestText(request, 70000));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('CALL_INPUT_INVALID');
        const body = raw as Record<string, unknown>;
        const grant = ordinaryActor ? null : await requireTeamCallAnswerAccess(request, { action: typeof body.action === 'string' ? body.action : '', callId: body.callId, threadId: body.threadId });
        const actor = ordinaryActor || grant?.actor;
        if (!actor) throw new Error('CALL_ACCESS_REQUIRED');
        const identity = { memberId: actor.memberId, ...(grant ? { ownerUid: actor.ownerUid } : {}) };
        if (typeof body.action === "string" && ["start","join","leave","signal","ice"].includes(body.action)) trace.state.action = body.action;
        trace.state.stage = trace.state.action;
        if (body.action === 'start') {
            teamCallTurnCredentials(); // A missing relay must not create a ringing call.
            const call = await startTeamCall(actor, body);
            waitUntil(notifyTeamCall(actor, call));
            return adminJson({ ok: true, ...identity, call });
        }
        if (body.action === 'join')
            return adminJson({ ok: true, ...identity, call: await joinTeamCall(actor, body.callId, body.sessionId) });
        if (body.action === 'leave') {
            const call = await leaveTeamCall(actor, body.callId, body.sessionId);
            if (call.status === 'ended') waitUntil(notifyTeamCallEnded(actor, call));
            return adminJson({ ok: true, ...identity, call });
        }
        if (body.action === 'signal') {
            await sendTeamCallSignal(actor, body);
            return adminJson({ ok: true, ...identity });
        }
        if (body.action === 'ice') {
            trace.state.stage = "reserve-relay";
            const credentials = teamCallTurnCredentials(), reservation = await reserveTeamCallIce(actor, body.callId, body.sessionId);
            trace.state.stage = "relay-provider";
            const iceServers = await teamCallIceServers(credentials, reservation.ttl);
            trace.state.stage = "relay-recheck";
            if (grant) await requireTeamCallAnswerAccess(request, { action: 'ice', callId: body.callId, threadId: body.threadId });
            await assertTeamCallJoined(actor, body.callId, body.sessionId); // Auth/session can change while the provider responds.
            return adminJson({ ok: true, ...identity, iceServers, expiresAt: reservation.expiresAt });
        }
        throw new Error('CALL_INPUT_INVALID');
    }
    catch (error) {
        failureError = error;
        return failure(error);
    }
    finally { trace.finish(failureError); }
}
