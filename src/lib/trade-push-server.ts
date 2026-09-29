import { getD1 } from '../../db';
import { tradeTeamCallAvailabilitySql } from './trade-team-presence';
import { messageActorGuard, messageParticipantGuard } from './trade-message-media-access';
import { verifiedTradeAccountPredicate } from './trade-access-server';
import type { MessageActor } from './trade-messages-server';
import type { TeamCall } from './trade-team-calls';
import { pushBoolean, pushId, pushSubscriptionInput, type TradePushPayload, type TradePushSubscriptionStatus } from './trade-push';
import { sendTradePush, tradePushCredentials } from './trade-push-provider';
import { authorizeTradeNativePush, sendTradeNativePush, tradeNativePushCredentials, type TradeNativePushCredentials } from './trade-native-push-provider';

type SubscriptionRow = {
  id: string; owner_uid: string; member_id: string; actor_uid: string; field_session_id: string;
  endpoint_hash: string; endpoint: string; p256dh: string; auth: string;
  messages: number; calls: number; enabled: number; expires_at: string;
};
type Guard = { sql: string; values: (string | number)[] };
export type TradePushDeliveryResult = { attempted: number; accepted: number; failed: number; skipped: boolean };
const nowIso = () => new Date().toISOString();
const recent = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();
const status = (row: SubscriptionRow): TradePushSubscriptionStatus => ({ id: row.id, messages: Boolean(row.messages), calls: Boolean(row.calls), enabled: Boolean(row.enabled) });
const identity = (actor: MessageActor) => [actor.ownerUid, actor.memberId, actor.actorUid, actor.fieldSessionId || ''];

function businessGuard(actor: MessageActor): Guard {
  return { sql: `EXISTS (SELECT 1 FROM trade_accounts push_account WHERE push_account.firebase_uid=? AND push_account.partner_type='installer' AND ${verifiedTradeAccountPredicate('push_account')})`, values:[actor.ownerUid] };
}

function fieldDeviceGuard(actor: MessageActor): Guard {
  return actor.fieldSessionId ? { sql:`EXISTS (SELECT 1 FROM trade_field_sessions push_session JOIN trade_mobile_devices push_device
    ON push_device.owner_uid=push_session.owner_uid AND push_device.member_id=push_session.team_member_id AND push_device.device_id=push_session.device_id
    WHERE push_session.id=? AND push_session.owner_uid=? AND push_session.team_member_id=? AND push_device.actor_uid=? AND push_device.status='active')`,
    values:[actor.fieldSessionId,actor.ownerUid,actor.memberId,actor.actorUid] } : {sql:'1=1',values:[]};
}

async function assertActor(actor: MessageActor, db: D1Database) {
  const member = messageActorGuard(actor), business = businessGuard(actor), device = fieldDeviceGuard(actor);
  const guard = { sql:`${member.sql} AND ${business.sql} AND ${device.sql}`,values:[...member.values,...business.values,...device.values] };
  if (!await db.prepare(`SELECT 1 allowed WHERE ${guard.sql}`).bind(...guard.values).first()) throw new Error('PUSH_ACCESS_REQUIRED');
  return guard;
}

function recipientGuard(): Guard {
  return { sql: `s.enabled=1 AND s.expires_at>? AND EXISTS (SELECT 1 FROM trade_team_members recipient
    WHERE recipient.id=s.member_id AND recipient.owner_uid=s.owner_uid AND recipient.status='active'
      AND ((s.field_session_id='' AND recipient.member_uid=s.actor_uid) OR (s.field_session_id<>'' AND EXISTS
        (SELECT 1 FROM trade_field_sessions session JOIN trade_mobile_devices device ON device.owner_uid=session.owner_uid AND device.member_id=session.team_member_id AND device.device_id=session.device_id
          WHERE session.id=s.field_session_id AND session.owner_uid=s.owner_uid AND device.actor_uid=s.actor_uid AND device.status='active'
          AND session.team_member_id=s.member_id AND session.status='active' AND session.expires_at>?))))`, values: [nowIso(),nowIso()] };
}

export async function tradePushSettings(actor: MessageActor, subscriptionId?: unknown, db: D1Database = getD1()) {
  const guard = await assertActor(actor, db), credentials = tradePushCredentials();
  const row = subscriptionId ? await db.prepare(`SELECT * FROM trade_push_subscriptions WHERE id=? AND owner_uid=? AND member_id=?
    AND actor_uid=? AND field_session_id=? AND expires_at>? AND ${guard.sql}`).bind(pushId(subscriptionId), ...identity(actor), nowIso(), ...guard.values).first<SubscriptionRow>() : null;
  return { configured: Boolean(credentials), publicKey: credentials?.publicKey || '', subscription: row ? status(row) : null };
}

export async function subscribeTradePush(actor: MessageActor, input: { subscription?: unknown; messages?: unknown; calls?: unknown }, db: D1Database = getD1()) {
  const guard = await assertActor(actor, db);
  if (!tradePushCredentials()) throw new Error('PUSH_UNAVAILABLE');
  const subscription = pushSubscriptionInput(input.subscription), messages = pushBoolean(input.messages), calls = pushBoolean(input.calls);
  const rawPublicKey = Uint8Array.from(atob(subscription.keys.p256dh.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  try { await crypto.subtle.importKey('raw', rawPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { throw new Error('PUSH_INPUT_INVALID'); }
  const endpointHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  const now = nowIso(), expiresAt = new Date(Math.min(Date.now() + 30 * 86400000, subscription.expirationTime || Infinity)).toISOString();
  // Expired and disabled registrations do not consume a member's five-device allowance.
  await db.prepare(`DELETE FROM trade_push_subscriptions WHERE owner_uid=? AND member_id=? AND (enabled=0 OR expires_at<=?
    OR (field_session_id<>'' AND NOT EXISTS (SELECT 1 FROM trade_field_sessions session JOIN trade_mobile_devices device ON device.owner_uid=session.owner_uid AND device.member_id=session.team_member_id AND device.device_id=session.device_id
      WHERE session.id=trade_push_subscriptions.field_session_id AND device.actor_uid=trade_push_subscriptions.actor_uid AND device.status='active'
      AND session.owner_uid=trade_push_subscriptions.owner_uid AND session.team_member_id=trade_push_subscriptions.member_id AND session.status='active' AND session.expires_at>?))) AND ${guard.sql}`)
    .bind(actor.ownerUid, actor.memberId, now, now, ...guard.values).run();
  const result = await db.prepare(`INSERT INTO trade_push_subscriptions(id,owner_uid,member_id,actor_uid,field_session_id,endpoint_hash,endpoint,p256dh,auth,messages,calls,expires_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND ((SELECT COUNT(*) FROM trade_push_subscriptions WHERE owner_uid=? AND member_id=?)<5
      OR EXISTS (SELECT 1 FROM trade_push_subscriptions WHERE endpoint_hash=? AND owner_uid=? AND member_id=? AND actor_uid=? AND field_session_id=?))
    ON CONFLICT(endpoint_hash) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,messages=excluded.messages,calls=excluded.calls,enabled=1,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE owner_uid=excluded.owner_uid AND member_id=excluded.member_id AND actor_uid=excluded.actor_uid AND field_session_id=excluded.field_session_id`)
    .bind(crypto.randomUUID(), ...identity(actor), endpointHash, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Number(messages), Number(calls), expiresAt, now, now,
      ...guard.values, actor.ownerUid, actor.memberId, endpointHash, ...identity(actor)).run();
  if (!result.meta.changes) {
    await assertActor(actor,db);
    throw new Error('PUSH_DEVICE_CONFLICT');
  }
  const saved = await db.prepare(`SELECT * FROM trade_push_subscriptions WHERE endpoint_hash=? AND owner_uid=? AND member_id=? AND actor_uid=? AND field_session_id=? AND ${guard.sql}`)
    .bind(endpointHash,...identity(actor),...guard.values).first<SubscriptionRow>();
  if (!saved) throw new Error('PUSH_ACCESS_REQUIRED');
  return status(saved);
}

export async function updateTradePush(actor: MessageActor, input: { subscriptionId?: unknown; messages?: unknown; calls?: unknown }, db: D1Database = getD1()) {
  const guard = await assertActor(actor, db), id = pushId(input.subscriptionId), messages = pushBoolean(input.messages), calls = pushBoolean(input.calls);
  const result = await db.prepare(`UPDATE trade_push_subscriptions SET messages=?,calls=?,updated_at=? WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=? AND field_session_id=? AND enabled=1 AND expires_at>? AND ${guard.sql}`)
    .bind(Number(messages),Number(calls),nowIso(),id,...identity(actor),nowIso(),...guard.values).run();
  if (!result.meta.changes) throw new Error('PUSH_ACCESS_REQUIRED');
  return { id, messages, calls, enabled: true };
}

export async function unsubscribeTradePush(actor: MessageActor, subscriptionId: unknown, db: D1Database = getD1()) {
  const guard = await assertActor(actor, db);
  await db.prepare(`DELETE FROM trade_push_subscriptions WHERE id=? AND owner_uid=? AND member_id=? AND actor_uid=? AND field_session_id=? AND ${guard.sql}`)
    .bind(pushId(subscriptionId),...identity(actor),...guard.values).run();
}

function sourceGuard(actor: MessageActor, kind: TradePushPayload['kind'], threadId: string, eventId: string): Guard {
  const member = messageParticipantGuard(actor,threadId), business = businessGuard(actor), device = fieldDeviceGuard(actor), now = nowIso();
  const guard = { sql:`${member.sql} AND ${business.sql} AND ${device.sql}`,values:[...member.values,...business.values,...device.values] };
  return kind === 'team-message' ? { sql: `${guard.sql} AND EXISTS (SELECT 1 FROM trade_internal_messages event WHERE event.id=? AND event.owner_uid=?
    AND event.thread_id=? AND event.actor_member_id=? AND event.created_at>=? AND event.created_at<=?)`,
    values: [...guard.values,eventId,actor.ownerUid,threadId,actor.memberId,recent(15*60000),now] }
    : { sql: `${guard.sql} AND EXISTS (SELECT 1 FROM trade_team_calls event WHERE event.id=? AND event.owner_uid=? AND event.thread_id=?
      AND event.created_by_member_id=? AND event.status='active' AND event.expires_at>? AND event.created_at>=? AND event.created_at<=?
      AND EXISTS (SELECT 1 FROM trade_team_call_participants caller WHERE caller.call_id=event.id AND caller.owner_uid=event.owner_uid
        AND caller.member_id=event.created_by_member_id AND caller.left_at='' AND caller.last_seen_at>=?))`,
      values: [...guard.values,eventId,actor.ownerUid,threadId,actor.memberId,now,recent(90000),now,recent(45000)] };
}

function deliveryGuard(actor: MessageActor, kind: TradePushPayload['kind'], threadId: string, eventId: string): Guard {
  const source = sourceGuard(actor,kind,threadId,eventId), recipient = recipientGuard();
  return { sql: `${source.sql} AND ${recipient.sql} AND s.owner_uid=? AND s.member_id<>? AND s.${kind === 'team-call' ? 'calls' : 'messages'}=1
    AND EXISTS (SELECT 1 FROM trade_message_participants p WHERE p.owner_uid=s.owner_uid AND p.thread_id=? AND p.member_id=s.member_id
      ${kind === 'team-message' ? `AND p.last_read_sequence<(SELECT sequence FROM trade_internal_messages WHERE id=? AND owner_uid=s.owner_uid)` : ''})
    ${kind === 'team-call' ? `AND ${tradeTeamCallAvailabilitySql('s.member_id','s.owner_uid')} AND NOT EXISTS (SELECT 1 FROM trade_team_call_participants joined WHERE joined.owner_uid=s.owner_uid AND joined.call_id=? AND joined.member_id=s.member_id)` : ''}`,
    values: [...source.values,...recipient.values,actor.ownerUid,actor.memberId,threadId,eventId] };
}

type NativeDeviceRow = { id: string; owner_uid: string; member_id: string; push_token: string };
function nativeDeliveryGuard(actor: MessageActor, payload: TradePushPayload): Guard {
  const source = sourceGuard(actor,payload.kind,payload.threadId,payload.id);
  return { sql: `${source.sql} AND d.owner_uid=? AND d.member_id<>? AND d.status='active' AND d.platform='android' AND d.push_provider='fcm' AND d.push_token<>''
    AND EXISTS (SELECT 1 FROM trade_team_members member WHERE member.id=d.member_id AND member.owner_uid=d.owner_uid AND member.status='active'
      AND ((member.member_uid<>'' AND member.member_uid=d.actor_uid) OR (d.actor_uid='field-member:'||d.member_id AND EXISTS
        (SELECT 1 FROM trade_field_sessions session WHERE session.owner_uid=d.owner_uid AND session.team_member_id=d.member_id
          AND session.device_id=d.device_id AND session.status='active' AND session.expires_at>?))))
    AND NOT EXISTS (SELECT 1 FROM trade_mobile_devices newer WHERE newer.id<>d.id
      AND (newer.device_id=d.device_id OR newer.push_token=d.push_token) AND newer.updated_at>=d.updated_at)
    AND EXISTS (SELECT 1 FROM trade_message_participants participant WHERE participant.owner_uid=d.owner_uid AND participant.thread_id=? AND participant.member_id=d.member_id
      ${payload.kind === 'team-message' ? `AND participant.last_read_sequence<(SELECT sequence FROM trade_internal_messages WHERE id=? AND owner_uid=d.owner_uid)` : ''})
    ${payload.kind === 'team-call' ? `AND ${tradeTeamCallAvailabilitySql('d.member_id','d.owner_uid')} AND NOT EXISTS
      (SELECT 1 FROM trade_team_call_participants joined WHERE joined.owner_uid=d.owner_uid AND joined.call_id=? AND joined.member_id=d.member_id)` : ''}`,
    values: [...source.values,actor.ownerUid,actor.memberId,nowIso(),payload.threadId,payload.id] };
}

async function dispatchNative(actor: MessageActor, payload: TradePushPayload, credentials: TradeNativePushCredentials, db: D1Database): Promise<TradePushDeliveryResult> {
  const result: TradePushDeliveryResult = { attempted:0,accepted:0,failed:0,skipped:false };
  const guard = nativeDeliveryGuard(actor,payload);
  const devices = (await db.prepare(`SELECT d.id,d.owner_uid,d.member_id,d.push_token FROM trade_mobile_devices d WHERE ${guard.sql} ORDER BY d.member_id,d.id LIMIT 125`)
    .bind(...guard.values).all<NativeDeviceRow>()).results;
  if (!devices.length) return result;
  const authorization = await authorizeTradeNativePush(credentials);
  if (!authorization) return { ...result,failed:1,skipped:true };
  const deliveries = await Promise.allSettled(devices.map(async device => {
    // A token may rotate while the same phone remains registered. The durable
    // registration claim keeps a replay from ringing that phone twice.
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`fcm-device:${device.id}`)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const fresh = nativeDeliveryGuard(actor,payload), now = nowIso();
    const claimed = await db.prepare(`INSERT OR IGNORE INTO trade_push_deliveries(event_kind,event_id,endpoint_hash,owner_uid,member_id,created_at,updated_at)
      SELECT ?,?,?,d.owner_uid,d.member_id,?,? FROM trade_mobile_devices d WHERE d.id=? AND d.push_token=? AND ${fresh.sql}`)
      .bind(payload.kind,payload.id,hash,now,now,device.id,device.push_token,...fresh.values).run();
    if (!claimed.meta.changes) return;
    result.attempted++;
    const latest = nativeDeliveryGuard(actor,payload);
    const current = await db.prepare(`SELECT d.id,d.owner_uid,d.member_id,d.push_token FROM trade_mobile_devices d WHERE d.id=? AND d.push_token=? AND ${latest.sql}`)
      .bind(device.id,device.push_token,...latest.values).first<NativeDeviceRow>();
    const outcome = current ? await sendTradeNativePush(current.push_token,payload,authorization) : 'stale';
    const deliveryStatus = outcome === 'stale' ? 'expired' : outcome;
    if (deliveryStatus === 'accepted') result.accepted++; else result.failed++;
    await db.prepare('UPDATE trade_push_deliveries SET status=?,updated_at=? WHERE event_kind=? AND event_id=? AND endpoint_hash=? AND owner_uid=?')
      .bind(deliveryStatus,nowIso(),payload.kind,payload.id,hash,actor.ownerUid).run();
    // Token cleanup is not a registration or business switch. Do not make an
    // older business registration current by advancing its updated_at here.
    if (current && outcome === 'expired') await db.prepare("UPDATE trade_mobile_devices SET push_token='',push_token_updated_at=? WHERE id=? AND owner_uid=? AND push_provider='fcm' AND push_token=?")
      .bind(nowIso(),current.id,actor.ownerUid,current.push_token).run();
  }));
  result.failed += deliveries.filter(delivery => delivery.status === 'rejected').length;
  return result;
}

async function dispatch(actor: MessageActor, kind: TradePushPayload['kind'], threadId: string, eventId: string, db: D1Database): Promise<TradePushDeliveryResult> {
  const result: TradePushDeliveryResult = { attempted: 0, accepted: 0, failed: 0, skipped: false };
  const credentials = tradePushCredentials(), nativeCredentials = tradeNativePushCredentials();
  if (!credentials && !nativeCredentials) return { ...result, skipped: true };
  const source = sourceGuard(actor,kind,threadId,eventId);
  const event = kind === 'team-call' ? await db.prepare(`SELECT created_at,expires_at,mode FROM trade_team_calls WHERE id=? AND owner_uid=? AND ${source.sql}`)
    .bind(eventId,actor.ownerUid,...source.values).first<{ created_at:string; expires_at:string; mode:string }>()
    : await db.prepare(`SELECT created_at FROM trade_internal_messages WHERE id=? AND owner_uid=? AND ${source.sql}`)
      .bind(eventId,actor.ownerUid,...source.values).first<{ created_at:string; expires_at?:string; mode?:string }>();
  if (!event) return { ...result, skipped: true };
  const expiresAt = new Date(kind === 'team-call' ? Math.min(Date.parse(event.created_at) + 90000, Date.parse(event.expires_at || '')) : Date.parse(event.created_at) + 86400000).toISOString();
  const payload: TradePushPayload = { v:1, kind, id:eventId, threadId, title:'TLink', body: kind === 'team-message' ? 'New team message' : event.mode === 'video' ? 'Incoming team video call' : 'Incoming team voice call',
    url: `/direct-trade/messages?threadId=${encodeURIComponent(threadId)}${kind === 'team-call' ? `&callId=${encodeURIComponent(eventId)}` : ''}`, expiresAt };
  const guard = deliveryGuard(actor,kind,threadId,eventId);
  // Groups are bounded to 25 members, each with at most five registered browsers.
  const subscriptions = credentials ? (await db.prepare(`SELECT s.* FROM trade_push_subscriptions s WHERE ${guard.sql} ORDER BY s.member_id,s.id LIMIT 125`)
    .bind(...guard.values).all<SubscriptionRow>()).results : [];
  const nativeDelivery = nativeCredentials ? dispatchNative(actor,payload,nativeCredentials,db) : Promise.resolve(null);
  const webDelivery = Promise.allSettled(subscriptions.map(async subscription => {
    const freshGuard = deliveryGuard(actor,kind,threadId,eventId), now = nowIso();
    // Claim before the network request: a replay or ambiguous timeout must never ring the same device twice.
    const claimed = await db.prepare(`INSERT OR IGNORE INTO trade_push_deliveries(event_kind,event_id,endpoint_hash,owner_uid,member_id,created_at,updated_at)
      SELECT ?,?,s.endpoint_hash,s.owner_uid,s.member_id,?,? FROM trade_push_subscriptions s WHERE s.id=? AND ${freshGuard.sql}`)
      .bind(kind,eventId,now,now,subscription.id,...freshGuard.values).run();
    if (!claimed.meta.changes) return;
    result.attempted++;
    // Re-read the subscription immediately before sending, including membership, read state and mute preferences.
    const currentGuard = deliveryGuard(actor,kind,threadId,eventId);
    const current = await db.prepare(`SELECT s.* FROM trade_push_subscriptions s WHERE s.id=? AND ${currentGuard.sql}`)
      .bind(subscription.id,...currentGuard.values).first<SubscriptionRow>();
    const providerStatus = current && credentials ? await sendTradePush({ endpoint:current.endpoint, expirationTime:Date.parse(current.expires_at), keys:{p256dh:current.p256dh,auth:current.auth} },payload,credentials) : 'stale';
    const deliveryStatus = providerStatus === 'stale' ? 'expired' : providerStatus;
    if (deliveryStatus === 'accepted') result.accepted++; else result.failed++;
    await db.prepare(`UPDATE trade_push_deliveries SET status=?,updated_at=? WHERE event_kind=? AND event_id=? AND endpoint_hash=? AND owner_uid=?`)
      .bind(deliveryStatus,nowIso(),kind,eventId,subscription.endpoint_hash,actor.ownerUid).run();
    if (current && providerStatus === 'expired') await db.prepare('UPDATE trade_push_subscriptions SET enabled=0,updated_at=? WHERE id=? AND owner_uid=? AND endpoint_hash=?')
      .bind(nowIso(),current.id,actor.ownerUid,current.endpoint_hash).run();
  }));
  const [webOutcome,nativeOutcome] = await Promise.allSettled([webDelivery,nativeDelivery]);
  if (webOutcome.status === 'rejected') result.failed++;
  else result.failed += webOutcome.value.filter(delivery => delivery.status === 'rejected').length;
  if (nativeOutcome.status === 'rejected') result.failed++;
  else if (nativeOutcome.value) {
    const native = nativeOutcome.value;
    result.attempted += native.attempted; result.accepted += native.accepted; result.failed += native.failed;
    result.skipped = native.skipped && !credentials;
  }
  // Old source events cannot be dispatched, so deleting older claims cannot permit a replay.
  await db.prepare('DELETE FROM trade_push_deliveries WHERE owner_uid=? AND created_at<?').bind(actor.ownerUid,recent(14*86400000)).run();
  return result;
}

// Notification failure never changes the success of the saved message or call. The caller schedules these with waitUntil.
export async function notifyTeamMessage(actor: MessageActor, threadId: string, messageId: string, db: D1Database = getD1()): Promise<TradePushDeliveryResult> {
  try { return await dispatch(actor,'team-message',pushId(threadId),pushId(messageId),db); }
  catch { return { attempted:0,accepted:0,failed:1,skipped:true }; }
}

export async function notifyTeamCall(actor: MessageActor, call: Pick<TeamCall,'id'|'threadId'>, db: D1Database = getD1()): Promise<TradePushDeliveryResult> {
  try { return await dispatch(actor,'team-call',pushId(call.threadId),pushId(call.id),db); }
  catch { return { attempted:0,accepted:0,failed:1,skipped:true }; }
}
