import { getD1 } from "../../db";
import type { MessageActor } from "./trade-messages-server";
import { messageActorGuard, messageParticipantGuard } from "./trade-message-media-access";
import { teamCallCursor, teamCallId, teamCallMode, teamCallSignalInput, type TeamCall, type TeamCallSignal } from "./trade-team-calls";
type CallRow = {
    id: string;
    owner_uid: string;
    thread_id: string;
    mode: "audio" | "video";
    status: "active" | "ended";
    created_by_member_id: string;
    request_id: string;
    created_at: string;
    expires_at: string;
};
type Guard = {
    sql: string;
    values: (string | number)[];
};
const stamp = () => new Date().toISOString();
const before = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
async function assertGuard(db: D1Database, guard: Guard) {
    if (!await db.prepare(`SELECT 1 allowed WHERE ${guard.sql}`).bind(...guard.values).first())
        throw new Error("CALL_ACCESS_REQUIRED");
}
// Every entry point first authenticates its current actor, then bounds cleanup to that business.
async function cleanup(actor: MessageActor, db: D1Database) {
    await assertGuard(db, messageActorGuard(actor));
    const now = stamp(), stale = before(45), unanswered = before(90);
    await db.batch([
        db.prepare(`UPDATE trade_team_call_participants SET left_at=? WHERE owner_uid=? AND left_at='' AND (last_seen_at<? OR NOT EXISTS
      (SELECT 1 FROM trade_team_members member WHERE member.id=trade_team_call_participants.member_id AND member.owner_uid=? AND member.status='active'))`)
            .bind(now, actor.ownerUid, stale, actor.ownerUid),
        db.prepare(`UPDATE trade_team_calls SET status='ended',ended_at=? WHERE owner_uid=? AND status='active' AND
      (expires_at<=? OR (had_peer=0 AND created_at<?) OR NOT EXISTS (SELECT 1 FROM trade_team_call_participants participant WHERE participant.call_id=trade_team_calls.id AND participant.owner_uid=? AND participant.left_at=''))`)
            .bind(now, actor.ownerUid, now, unanswered, actor.ownerUid),
        db.prepare(`DELETE FROM trade_team_call_signals WHERE owner_uid=? AND (created_at<? OR EXISTS
      (SELECT 1 FROM trade_team_calls call WHERE call.id=trade_team_call_signals.call_id AND call.owner_uid=? AND call.status='ended') OR NOT EXISTS
      (SELECT 1 FROM trade_team_call_participants p WHERE p.call_id=trade_team_call_signals.call_id AND p.member_id=trade_team_call_signals.from_member_id AND p.owner_uid=? AND p.session_id=trade_team_call_signals.from_session_id AND p.left_at='') OR NOT EXISTS
      (SELECT 1 FROM trade_team_call_participants p WHERE p.call_id=trade_team_call_signals.call_id AND p.member_id=trade_team_call_signals.to_member_id AND p.owner_uid=? AND p.session_id=trade_team_call_signals.to_session_id AND p.left_at=''))`)
            .bind(actor.ownerUid, before(300), actor.ownerUid, actor.ownerUid, actor.ownerUid),
    ]);
}
async function callRow(actor: MessageActor, value: unknown, db: D1Database): Promise<CallRow> {
    const id = teamCallId(value), guard = messageActorGuard(actor);
    const row = await db.prepare(`SELECT call.* FROM trade_team_calls call WHERE call.id=? AND call.owner_uid=? AND ${guard.sql}
    AND EXISTS (SELECT 1 FROM trade_message_participants p WHERE p.thread_id=call.thread_id AND p.owner_uid=call.owner_uid AND p.member_id=?)`)
        .bind(id, actor.ownerUid, ...guard.values, actor.memberId).first<CallRow>();
    if (!row)
        throw new Error("CALL_ACCESS_REQUIRED");
    return row;
}
function joinedGuard(actor: MessageActor, call: CallRow, sessionId: string): Guard {
    const guard = messageParticipantGuard(actor, call.thread_id);
    return { sql: `${guard.sql} AND EXISTS (SELECT 1 FROM trade_team_calls active_call JOIN trade_team_call_participants joined ON joined.call_id=active_call.id AND joined.owner_uid=active_call.owner_uid
    WHERE active_call.id=? AND active_call.owner_uid=? AND active_call.status='active' AND active_call.expires_at>?
      AND joined.member_id=? AND joined.session_id=? AND joined.left_at='' AND joined.last_seen_at>=?)`,
        values: [...guard.values, call.id, actor.ownerUid, stamp(), actor.memberId, sessionId, before(45)] };
}
async function publicCall(actor: MessageActor, call: CallRow, db: D1Database): Promise<TeamCall> {
    const guard = messageParticipantGuard(actor, call.thread_id);
    await assertGuard(db, guard);
    const thread = await db.prepare(`SELECT t.kind,t.subject,(SELECT group_concat(m.display_name, ', ') FROM trade_message_participants p JOIN trade_team_members m ON m.id=p.member_id AND m.owner_uid=p.owner_uid
    WHERE p.thread_id=t.id AND p.owner_uid=t.owner_uid AND p.member_id<>?) names FROM trade_message_threads t WHERE t.id=? AND t.owner_uid=? AND ${guard.sql}`)
        .bind(actor.memberId, call.thread_id, actor.ownerUid, ...guard.values).first<{
        kind: string;
        subject: string;
        names: string;
    }>();
    const participants = call.status === "active" ? (await db.prepare(`SELECT p.member_id,p.session_id,p.joined_at,m.display_name FROM trade_team_call_participants p
    JOIN trade_team_members m ON m.id=p.member_id AND m.owner_uid=p.owner_uid AND m.status='active'
    WHERE p.call_id=? AND p.owner_uid=? AND p.left_at='' AND p.last_seen_at>=? AND ${guard.sql} ORDER BY p.joined_at,p.member_id`)
        .bind(call.id, actor.ownerUid, before(45), ...guard.values).all<{
        member_id: string;
        session_id: string;
        joined_at: string;
        display_name: string;
    }>()).results : [];
    return { id: call.id, threadId: call.thread_id, threadName: thread?.kind === "group" ? thread.subject : thread?.names || "Team call", mode: call.mode, status: call.status,
        createdByMemberId: call.created_by_member_id, createdAt: call.created_at, expiresAt: call.expires_at,
        participants: participants.map(p => ({ memberId: p.member_id, name: p.display_name, sessionId: p.session_id, joinedAt: p.joined_at })) };
}
export async function startTeamCall(actor: MessageActor, input: {
    threadId?: unknown;
    requestId?: unknown;
    sessionId?: unknown;
    mode?: unknown;
}, db: D1Database = getD1()) {
    const threadId = teamCallId(input.threadId), requestId = teamCallId(input.requestId), sessionId = teamCallId(input.sessionId), mode = teamCallMode(input.mode);
    const guard = messageParticipantGuard(actor, threadId);
    await assertGuard(db, guard);
    await cleanup(actor, db);
    const prior = await db.prepare("SELECT * FROM trade_team_calls WHERE owner_uid=? AND created_by_member_id=? AND request_id=?").bind(actor.ownerUid, actor.memberId, requestId).first<CallRow>();
    if (prior) {
        if (prior.thread_id !== threadId || prior.mode !== mode)
            throw new Error("CALL_REQUEST_CONFLICT");
        return publicCall(actor, prior, db);
    }
    const id = crypto.randomUUID(), now = stamp(), expiresAt = new Date(Date.now() + 3600000).toISOString();
    await db.batch([
        db.prepare(`INSERT OR IGNORE INTO trade_team_calls(id,owner_uid,thread_id,mode,created_by_member_id,request_id,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM trade_team_calls WHERE owner_uid=? AND created_by_member_id=? AND created_at>=?)<10`)
            .bind(id, actor.ownerUid, threadId, mode, actor.memberId, requestId, now, expiresAt, ...guard.values, actor.ownerUid, actor.memberId, before(3600)),
        db.prepare(`INSERT INTO trade_team_call_participants(call_id,owner_uid,member_id,session_id,joined_at,last_seen_at)
      SELECT id,owner_uid,?,?,?,? FROM trade_team_calls WHERE id=? AND owner_uid=? AND ${guard.sql}`)
            .bind(actor.memberId, sessionId, now, now, id, actor.ownerUid, ...guard.values),
    ]);
    const saved = await db.prepare("SELECT * FROM trade_team_calls WHERE owner_uid=? AND created_by_member_id=? AND request_id=?").bind(actor.ownerUid, actor.memberId, requestId).first<CallRow>();
    if (!saved) {
        await assertGuard(db, guard);
        const active = await db.prepare("SELECT id FROM trade_team_calls WHERE owner_uid=? AND thread_id=? AND status='active'").bind(actor.ownerUid, threadId).first();
        throw new Error(active ? "CALL_ALREADY_ACTIVE" : "CALL_RATE_LIMIT");
    }
    if (saved.thread_id !== threadId || saved.mode !== mode)
        throw new Error("CALL_REQUEST_CONFLICT");
    return publicCall(actor, saved, db);
}
export async function joinTeamCall(actor: MessageActor, value: unknown, sessionValue: unknown, db: D1Database = getD1()) {
    const sessionId = teamCallId(sessionValue);
    await cleanup(actor, db);
    const call = await callRow(actor, value, db);
    if (call.status !== "active")
        throw new Error("CALL_ENDED");
    const guard = messageParticipantGuard(actor, call.thread_id), now = stamp();
    const result = await db.batch([
        db.prepare(`INSERT INTO trade_team_call_participants(call_id,owner_uid,member_id,session_id,joined_at,last_seen_at)
      SELECT ?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM trade_team_calls WHERE id=? AND owner_uid=? AND status='active' AND expires_at>?)
      AND (SELECT COUNT(*) FROM trade_team_call_participants WHERE call_id=? AND owner_uid=? AND left_at='' AND member_id<>?)<6
      ON CONFLICT(call_id,member_id) DO UPDATE SET session_id=excluded.session_id,joined_at=CASE WHEN session_id=excluded.session_id AND left_at='' THEN joined_at ELSE excluded.joined_at END,last_seen_at=excluded.last_seen_at,left_at=''`)
            .bind(call.id, actor.ownerUid, actor.memberId, sessionId, now, now, ...guard.values, call.id, actor.ownerUid, now, call.id, actor.ownerUid, actor.memberId),
        db.prepare(`DELETE FROM trade_team_call_signals WHERE call_id=? AND owner_uid=? AND ((from_member_id=? AND from_session_id<>?) OR (to_member_id=? AND to_session_id<>?))`)
            .bind(call.id, actor.ownerUid, actor.memberId, sessionId, actor.memberId, sessionId),
        db.prepare(`UPDATE trade_team_calls SET had_peer=1 WHERE id=? AND owner_uid=? AND (SELECT COUNT(*) FROM trade_team_call_participants WHERE call_id=? AND owner_uid=? AND left_at='')>1`)
            .bind(call.id, actor.ownerUid, call.id, actor.ownerUid),
    ]);
    if (!result[0].meta.changes) {
        await assertGuard(db, guard);
        throw new Error("CALL_FULL");
    }
    return publicCall(actor, await callRow(actor, call.id, db), db);
}
export async function leaveTeamCall(actor: MessageActor, value: unknown, sessionValue: unknown, db: D1Database = getD1()) {
    const sessionId = teamCallId(sessionValue), call = await callRow(actor, value, db), guard = messageParticipantGuard(actor, call.thread_id);
    await db.batch([
        db.prepare(`UPDATE trade_team_call_participants SET left_at=? WHERE call_id=? AND owner_uid=? AND member_id=? AND session_id=? AND ${guard.sql}`)
            .bind(stamp(), call.id, actor.ownerUid, actor.memberId, sessionId, ...guard.values),
        db.prepare(`DELETE FROM trade_team_call_signals WHERE call_id=? AND owner_uid=? AND ((from_member_id=? AND from_session_id=?) OR (to_member_id=? AND to_session_id=?)) AND ${guard.sql}`)
            .bind(call.id, actor.ownerUid, actor.memberId, sessionId, actor.memberId, sessionId, ...guard.values),
    ]);
    await cleanup(actor, db);
    return publicCall(actor, await callRow(actor, call.id, db), db);
}
export async function teamCallStatus(actor: MessageActor, input: {
    callId?: unknown;
    threadId?: unknown;
    sessionId?: unknown;
    after?: unknown;
}, db: D1Database = getD1()) {
    await cleanup(actor, db);
    let call: CallRow;
    if (input.callId)
        call = await callRow(actor, input.callId, db);
    else {
        const threadId = teamCallId(input.threadId), guard = messageParticipantGuard(actor, threadId);
        await assertGuard(db, guard);
        const row = await db.prepare(`SELECT * FROM trade_team_calls WHERE thread_id=? AND owner_uid=? AND status='active' AND ${guard.sql}`).bind(threadId, actor.ownerUid, ...guard.values).first<CallRow>();
        if (!row)
            return { call: null, signals: [] };
        call = row;
    }
    const signals: TeamCallSignal[] = [];
    if (input.sessionId && call.status === 'active') {
        const sessionId = teamCallId(input.sessionId), cursor = teamCallCursor(input.after ?? 0), guard = joinedGuard(actor, call, sessionId);
        const heartbeat = await db.prepare(`UPDATE trade_team_call_participants SET last_seen_at=? WHERE call_id=? AND owner_uid=? AND member_id=? AND session_id=? AND ${guard.sql}`)
            .bind(stamp(), call.id, actor.ownerUid, actor.memberId, sessionId, ...guard.values).run();
        if (!heartbeat.meta.changes)
            throw new Error("CALL_SESSION_REPLACED");
        const rows = (await db.prepare(`SELECT s.* FROM trade_team_call_signals s WHERE s.call_id=? AND s.owner_uid=? AND s.to_member_id=? AND s.to_session_id=? AND s.sequence>? AND ${guard.sql} ORDER BY s.sequence LIMIT 100`)
            .bind(call.id, actor.ownerUid, actor.memberId, sessionId, cursor, ...guard.values).all<{
            id: string;
            sequence: number;
            from_member_id: string;
            from_session_id: string;
            to_session_id: string;
            request_id: string;
            type: TeamCallSignal['type'];
            payload: string;
        }>()).results;
        signals.push(...rows.map(s => ({ id: s.id, sequence: s.sequence, fromMemberId: s.from_member_id, fromSessionId: s.from_session_id, toSessionId: s.to_session_id, requestId: s.request_id, type: s.type, payload: JSON.parse(s.payload) })));
    }
    return { call: await publicCall(actor, call, db), signals };
}
export async function incomingTeamCalls(actor: MessageActor, db: D1Database = getD1()) {
    await cleanup(actor, db);
    const guard = messageActorGuard(actor);
    const rows = (await db.prepare(`SELECT c.* FROM trade_team_calls c JOIN trade_message_participants p ON p.thread_id=c.thread_id AND p.owner_uid=c.owner_uid AND p.member_id=?
    WHERE c.owner_uid=? AND c.status='active' AND ${guard.sql} ORDER BY c.created_at DESC LIMIT 20`).bind(actor.memberId, actor.ownerUid, ...guard.values).all<CallRow>()).results;
    return Promise.all(rows.map(row => publicCall(actor, row, db)));
}
export async function sendTeamCallSignal(actor: MessageActor, input: {
    callId?: unknown;
    sessionId?: unknown;
    toMemberId?: unknown;
    toSessionId?: unknown;
    requestId?: unknown;
    type?: unknown;
    payload?: unknown;
}, db: D1Database = getD1()) {
    const sessionId = teamCallId(input.sessionId), toMemberId = teamCallId(input.toMemberId), toSessionId = teamCallId(input.toSessionId), requestId = teamCallId(input.requestId);
    const signal = teamCallSignalInput(input.type, input.payload), payload = JSON.stringify(signal.payload);
    await cleanup(actor, db);
    const call = await callRow(actor, input.callId, db), guard = joinedGuard(actor, call, sessionId);
    await assertGuard(db, guard);
    if (toMemberId === actor.memberId)
        throw new Error("CALL_SIGNAL_INVALID");
    const targetSql = `EXISTS(SELECT 1 FROM trade_team_call_participants target JOIN trade_team_members member ON member.id=target.member_id AND member.owner_uid=target.owner_uid AND member.status='active'
    JOIN trade_message_participants allowed ON allowed.member_id=target.member_id AND allowed.owner_uid=target.owner_uid AND allowed.thread_id=?
    WHERE target.call_id=? AND target.owner_uid=? AND target.member_id=? AND target.session_id=? AND target.left_at='' AND target.last_seen_at>=?)`;
    const targetValues = [call.thread_id, call.id, actor.ownerUid, toMemberId, toSessionId, before(45)];
    const rateSql = `(SELECT COUNT(*) FROM trade_team_call_signals WHERE call_id=? AND owner_uid=? AND from_member_id=? AND created_at>=?)<120 AND
    (SELECT COUNT(*) FROM trade_team_call_signals WHERE call_id=? AND owner_uid=?)<1000`;
    const rateValues = [call.id, actor.ownerUid, actor.memberId, before(60), call.id, actor.ownerUid];
    await db.batch([
        db.prepare(`UPDATE trade_team_calls SET next_signal_sequence=next_signal_sequence+1 WHERE id=? AND owner_uid=? AND ${guard.sql} AND ${targetSql} AND ${rateSql}`)
            .bind(call.id, actor.ownerUid, ...guard.values, ...targetValues, ...rateValues),
        db.prepare(`INSERT OR IGNORE INTO trade_team_call_signals(id,owner_uid,call_id,sequence,from_member_id,from_session_id,to_member_id,to_session_id,request_id,type,payload,created_at)
      SELECT ?,owner_uid,id,next_signal_sequence,?,?,?,?,?,?,?,? FROM trade_team_calls WHERE id=? AND owner_uid=? AND ${guard.sql} AND ${targetSql} AND ${rateSql}`)
            .bind(crypto.randomUUID(), actor.memberId, sessionId, toMemberId, toSessionId, requestId, signal.type, payload, stamp(), call.id, actor.ownerUid, ...guard.values, ...targetValues, ...rateValues),
    ]);
    const row = await db.prepare(`SELECT to_member_id,to_session_id,type,payload FROM trade_team_call_signals WHERE call_id=? AND owner_uid=? AND from_member_id=? AND from_session_id=? AND request_id=? AND ${guard.sql}`)
        .bind(call.id, actor.ownerUid, actor.memberId, sessionId, requestId, ...guard.values).first<{
        to_member_id: string;
        to_session_id: string;
        type: string;
        payload: string;
    }>();
    if (!row) {
        await assertGuard(db, guard);
        await assertGuard(db, { sql: targetSql, values: targetValues });
        throw new Error("CALL_RATE_LIMIT");
    }
    if (row.to_member_id !== toMemberId || row.to_session_id !== toSessionId || row.type !== signal.type || row.payload !== payload)
        throw new Error("CALL_REQUEST_CONFLICT");
}
export async function reserveTeamCallIce(actor: MessageActor, value: unknown, sessionValue: unknown, db: D1Database = getD1()) {
    const sessionId = teamCallId(sessionValue);
    await cleanup(actor, db);
    const call = await callRow(actor, value, db), guard = joinedGuard(actor, call, sessionId);
    await assertGuard(db, guard);
    const result = await db.prepare(`UPDATE trade_team_call_participants SET ice_issued_at=?,ice_issued_count=ice_issued_count+1
    WHERE call_id=? AND owner_uid=? AND member_id=? AND session_id=? AND ice_issued_count<10 AND (ice_issued_at='' OR ice_issued_at<?)
      AND (SELECT COALESCE(SUM(p.ice_issued_count),0) FROM trade_team_call_participants p JOIN trade_team_calls c ON c.id=p.call_id AND c.owner_uid=p.owner_uid WHERE p.owner_uid=? AND p.member_id=? AND c.created_at>=?)<30 AND ${guard.sql}`)
        .bind(stamp(), call.id, actor.ownerUid, actor.memberId, sessionId, before(30), actor.ownerUid, actor.memberId, before(86400), ...guard.values).run();
    if (!result.meta.changes)
        throw new Error("CALL_RATE_LIMIT");
    return { expiresAt: call.expires_at, ttl: Math.max(1, Math.min(3600, Math.floor((Date.parse(call.expires_at) - Date.now()) / 1000))) };
}
export async function assertTeamCallJoined(actor: MessageActor, value: unknown, sessionValue: unknown, db: D1Database = getD1()) {
    const call = await callRow(actor, value, db);
    await assertGuard(db, joinedGuard(actor, call, teamCallId(sessionValue)));
}
