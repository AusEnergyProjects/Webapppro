import { getD1 } from '../../db';
import { verifiedTradeAccountPredicate } from './trade-access-server';
import { integrationStateHash, keyedProtectedAuditHash } from './trade-integration-crypto';
import type { MessageActor } from './trade-messages-server';
import { TEAM_CALL_RING_SECONDS } from './trade-team-calls';

const PURPOSE = 'tlink-native-call-answer-v1';
export const CALL_ANSWER_HEADER = 'x-tlink-call-answer';
const denied = () => new Error('CALL_ACCESS_REQUIRED');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
type Claims = { v: 1; c: string; t: string; d: string; o: string; m: string; a: string; f: string; p: string; i: number; e: number };
type Registration = {
  id: string; owner_uid: string; member_id: string; actor_uid: string; device_id: string;
  push_token: string; voip_push_token: string; push_provider: string; platform: string;
  display_name: string; field_session_id: string; created_at: string; expires_at: string; call_status: string;
};

// A grant can only be used by the one recipient and registration selected for
// this call. Normal CRM credentials and encrypted field storage stay locked.
async function registration(callId: string, threadId: string, deviceId: string, db: D1Database, fieldSessionId?: string) {
  const now = new Date().toISOString();
  return db.prepare(`SELECT d.id,d.owner_uid,d.member_id,d.actor_uid,d.device_id,d.push_token,d.voip_push_token,d.push_provider,d.platform,
      m.display_name,c.created_at,c.expires_at,c.status call_status,COALESCE((SELECT s.id FROM trade_field_sessions s
        WHERE s.owner_uid=d.owner_uid AND s.team_member_id=d.member_id AND s.device_id=d.device_id
          AND s.status='active' AND s.expires_at>? AND d.actor_uid='field-member:'||d.member_id
          ${fieldSessionId === undefined ? '' : 'AND s.id=?'} ORDER BY s.expires_at DESC,s.id LIMIT 1),'') field_session_id
    FROM trade_mobile_devices d JOIN trade_team_members m ON m.owner_uid=d.owner_uid AND m.id=d.member_id
    JOIN trade_accounts account ON account.firebase_uid=d.owner_uid
    JOIN trade_team_calls c ON c.owner_uid=d.owner_uid AND c.id=? AND c.thread_id=?
    WHERE d.id=? AND d.status='active' AND d.native_call_capable=1 AND m.status='active'
      AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate('account')}
      AND ((d.platform='android' AND d.push_provider='fcm' AND d.push_token<>'')
        OR (d.platform='ios' AND d.push_provider='apns' AND d.voip_push_token<>''))
      AND ((m.member_uid<>'' AND m.member_uid=d.actor_uid) OR (d.actor_uid='field-member:'||d.member_id AND EXISTS
        (SELECT 1 FROM trade_field_sessions s WHERE s.owner_uid=d.owner_uid AND s.team_member_id=d.member_id
          AND s.device_id=d.device_id AND s.status='active' AND s.expires_at>? ${fieldSessionId === undefined ? '' : 'AND s.id=?'})))
      AND NOT EXISTS (SELECT 1 FROM trade_mobile_devices newer WHERE newer.id<>d.id
        AND (newer.device_id=d.device_id OR (d.push_token<>'' AND newer.push_token=d.push_token)
          OR (d.voip_push_token<>'' AND newer.voip_push_token=d.voip_push_token)) AND newer.updated_at>=d.updated_at)
      AND EXISTS (SELECT 1 FROM trade_message_participants p WHERE p.owner_uid=d.owner_uid AND p.member_id=d.member_id AND p.thread_id=c.thread_id)
      AND c.created_by_member_id<>d.member_id AND c.expires_at>?`)
    .bind(now, ...(fieldSessionId === undefined ? [] : [fieldSessionId]), callId, threadId, deviceId,
      now, ...(fieldSessionId === undefined ? [] : [fieldSessionId]), now).first<Registration>();
}

function registrationHash(row: Registration) {
  return integrationStateHash(JSON.stringify([row.device_id,row.push_provider,row.platform,row.push_token,row.voip_push_token]));
}

export async function createTeamCallAnswerToken(input: { callId: string; threadId: string; deviceRegistrationId: string }, db: D1Database = getD1()) {
  const row = await registration(input.callId, input.threadId, input.deviceRegistrationId, db);
  if (!row || row.call_status !== 'active') throw denied();
  const now = Date.now();
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created) || created > now || created + TEAM_CALL_RING_SECONDS * 1000 <= now) throw denied();
  const claims: Claims = { v: 1, c: input.callId, t: input.threadId, d: row.id, o: row.owner_uid, m: row.member_id,
    a: row.actor_uid, f: row.field_session_id, p: await registrationHash(row), i: now, e: Math.min(now + 3600000, Date.parse(row.expires_at)) };
  if (!Number.isFinite(claims.e) || claims.e <= now) throw denied();
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const value = `v1.${encoded}`;
  const token = `${value}.${await keyedProtectedAuditHash(PURPOSE, value)}`;
  if (token.length > 3072) throw denied();
  return token;
}

async function decodeToken(token: string): Promise<Claims> {
  if (token.length > 3072 || !/^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) throw denied();
  const [version, encoded, signature] = token.split('.');
  const expected = await keyedProtectedAuditHash(PURPOSE, `${version}.${encoded}`);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  if (difference) throw denied();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0))));
  } catch { throw denied(); }
  if (!record(value) || value.v !== 1
    || !['c','t','d','o','m','a','p'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 180)
    || typeof value.f !== 'string' || value.f.length > 180
    || typeof value.i !== 'number' || !Number.isSafeInteger(value.i) || typeof value.e !== 'number' || !Number.isSafeInteger(value.e)
    || value.i > Date.now() || value.e <= Date.now() || value.e <= value.i || value.e - value.i > 3600000) throw denied();
  return { v: 1, c: String(value.c), t: String(value.t), d: String(value.d), o: String(value.o), m: String(value.m),
    a: String(value.a), f: value.f, p: String(value.p), i: value.i, e: value.e };
}

export async function requireTeamCallAnswerAccess(request: Request, input: { action: string; callId?: unknown; threadId?: unknown }, db: D1Database = getD1()) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/trade-team-calls' || !['GET','POST'].includes(request.method)
    || !(request.method === 'GET' ? ['status','incoming'] : ['join','leave','signal','ice']).includes(input.action)) throw denied();
  const claims = await decodeToken(request.headers.get(CALL_ANSWER_HEADER) || '');
  if (input.callId !== claims.c || (input.threadId !== undefined && input.threadId !== claims.t)
    || (request.headers.has('x-tlink-business') && request.headers.get('x-tlink-business') !== claims.o)) throw denied();
  const row = await registration(claims.c, claims.t, claims.d, db, claims.f);
  if (!row || row.owner_uid !== claims.o || row.member_id !== claims.m || row.actor_uid !== claims.a
    || row.field_session_id !== claims.f || await registrationHash(row) !== claims.p) throw denied();
  const actor: MessageActor = { ownerUid: row.owner_uid, memberId: row.member_id, actorUid: row.actor_uid,
    displayName: row.display_name, isOwner: row.actor_uid === row.owner_uid, ...(claims.f ? { fieldSessionId: claims.f } : {}) };
  return { actor, callId: claims.c, threadId: claims.t };
}
