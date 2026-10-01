import { env } from 'cloudflare:workers';
import { importPKCS8, SignJWT } from 'jose';
import { pushAnswerToken, pushCallerName, pushId, type TradePushPayload } from './trade-push';

const PROJECT = 'australian-energy-assessments';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`;
export type TradeNativePushCredentials = { clientEmail: string; privateKey: string };
export type TradeNativePushAuthorization = { accessToken: string; expiresAt: number };
type DeliveryStatus = 'accepted' | 'expired' | 'stale' | 'failed';
export const TRADE_APNS_TOPIC = 'au.com.australianenergyassessments.field';
export type TradeApnsCredentials = { keyId: string; teamId: string; privateKey: string; environment: 'production' | 'sandbox' };
export type TradeApnsAuthorization = { token: string; expiresAt: number; environment: 'production' | 'sandbox' };
// APNs rejects frequent provider-token rotation on a reused connection. Reuse
// the authorization for this one app; a key/environment change invalidates it.
let apnsAuthorization: { credentials: TradeApnsCredentials; expiresAt: number; pending: Promise<TradeApnsAuthorization | null> } | undefined;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function tradeApnsCredentials(source: object = env): TradeApnsCredentials | null {
  const setting = (name: string) => { const value: unknown = Reflect.get(source, name); return typeof value === 'string' ? value.trim() : ''; };
  const keyId = setting('TLINK_APNS_KEY_ID'), teamId = setting('TLINK_APNS_TEAM_ID');
  const privateKey = setting('TLINK_APNS_PRIVATE_KEY'), environment = setting('TLINK_APNS_ENVIRONMENT');
  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)
    || privateKey.length > 16384 || !privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
    || !privateKey.endsWith('-----END PRIVATE KEY-----') || !['production', 'sandbox'].includes(environment)) return null;
  return { keyId, teamId, privateKey, environment: environment === 'sandbox' ? 'sandbox' : 'production' };
}

export async function authorizeTradeApns(credentials: TradeApnsCredentials): Promise<TradeApnsAuthorization | null> {
  const cached = apnsAuthorization;
  if (cached && cached.expiresAt > Date.now() && Object.keys(credentials).every(key => Reflect.get(cached.credentials, key) === Reflect.get(credentials, key))) return cached.pending;
  const expiresAt = Date.now() + 50 * 60000;
  const pending = (async () => {
    try {
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
        .setIssuer(credentials.teamId).setIssuedAt().sign(await importPKCS8(credentials.privateKey, 'ES256'));
      return { token, expiresAt, environment: credentials.environment };
    } catch { return null; }
  })();
  apnsAuthorization = { credentials, expiresAt, pending };
  const authorization = await pending;
  if (!authorization && apnsAuthorization?.pending === pending) apnsAuthorization = undefined;
  return authorization;
}

export async function sendTradeApns(token: string, payload: TradePushPayload, authorization: TradeApnsAuthorization,
  fetcher: typeof fetch = fetch, options: { voip?: boolean; ended?: boolean } = {}): Promise<DeliveryStatus> {
  const ttl = Math.min(payload.kind === 'team-call' ? 90 : 86400, Math.floor((Date.parse(payload.expiresAt) - Date.now()) / 1000));
  if (!Number.isFinite(ttl) || ttl < 1) return 'stale';
  try {
    if (!/^(?:[a-fA-F0-9]{2}){16,2048}$/.test(token) || authorization.expiresAt <= Date.now() || !authorization.token) return 'failed';
    const threadId = pushId(payload.threadId), id = pushId(payload.id), call = payload.kind === 'team-call';
    if (!call && payload.kind !== 'team-message') return 'failed';
    const body = call ? payload.body === 'Incoming team video call' ? 'Incoming team video call' : 'Incoming team voice call' : 'New team message';
    const callerName = call && payload.callerName !== undefined ? pushCallerName(payload.callerName) : undefined;
    const ended = call && options.ended, voip = call && options.voip && !ended;
    const answerToken = voip ? pushAnswerToken(payload.answerToken) : undefined;
    const host = authorization.environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    // Workers supports manual redirects; never forward credentials or tokens.
    const response = await fetcher(`https://${host}/3/device/${token}`, { method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { authorization: `bearer ${authorization.token}`, 'content-type': 'application/json', 'apns-topic': `${TRADE_APNS_TOPIC}${voip ? '.voip' : ''}`,
        'apns-push-type': ended ? 'background' : voip ? 'voip' : 'alert', 'apns-priority': ended ? '5' : '10',
        'apns-expiration': voip || ended ? '0' : String(Math.floor(Date.now() / 1000) + ttl) },
      body: JSON.stringify({ aps: ended ? { 'content-available': 1 } : voip ? {} : { alert: { title: callerName || 'TLink', body }, sound: 'default', 'thread-id': threadId,
        category: call ? 'team-calls' : 'team-messages' },
        type: ended ? 'team_call_ended' : call ? 'team_call' : 'team_message', threadId, eventId: id, expiresAt: payload.expiresAt,
        ...(call ? { callId: id, ...(callerName ? { callerName } : {}), ...(answerToken ? { answerToken } : {}), mode: payload.body === 'Incoming team video call' ? 'video' : 'audio', hasVideo: payload.body === 'Incoming team video call' } : {}) }) });
    const responseId = response.headers.get('apns-id') || '';
    const apnsId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(responseId) ? responseId.toLowerCase() : '';
    // Apple's request ID supports delivery investigation without logging a
    // recipient, device token, call credential or notification payload.
    console.info('tlink_apns_response', { route: ended ? 'apns_background' : voip ? 'apns_voip' : 'apns_alert',
      environment: authorization.environment, status: response.status, ...(apnsId ? { apnsId } : {}) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return 'failed'; }
    if (response.status === 200) { await response.body?.cancel(); return 'accepted'; }
    const result: unknown = await response.json();
    // BadDeviceToken may mean the operator selected the wrong APNs environment.
    // Only Apple's explicit retirement response removes a saved registration.
    if (response.status === 410 && record(result) && result.reason === 'Unregistered') return 'expired';
    const reasons = ['BadDeviceToken', 'DeviceTokenNotForTopic', 'InvalidProviderToken', 'ExpiredProviderToken', 'TopicDisallowed', 'BadTopic', 'TooManyRequests', 'TooManyProviderTokenUpdates'];
    console.warn('tlink_push_delivery_failed', { provider: 'apns', status: response.status, reason: record(result) && typeof result.reason === 'string' && reasons.includes(result.reason) ? result.reason : 'provider_rejected' });
    return 'failed';
  } catch { return 'failed'; }
}

export function tradeNativePushCredentials(source: object = env): TradeNativePushCredentials | null {
  // A dedicated key takes precedence. The existing protected Google connection
  // can be reused only after its messaging permission is explicitly authorised.
  // Key presence never establishes that Google has granted that permission.
  const dedicated: unknown = Reflect.get(source, 'TLINK_FCM_SERVICE_ACCOUNT_JSON');
  const raw: unknown = dedicated || Reflect.get(source, 'FIREBASE_AUTH_SERVICE_ACCOUNT_JSON');
  if (typeof raw !== 'string' || raw.length > 16384) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.type !== 'service_account' || value.project_id !== PROJECT
      || typeof value.client_email !== 'string' || !/^[a-z0-9-]+@australian-energy-assessments\.iam\.gserviceaccount\.com$/.test(value.client_email)
      || typeof value.private_key !== 'string' || !value.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) return null;
    return { clientEmail: value.client_email, privateKey: value.private_key };
  } catch { return null; }
}

export async function authorizeTradeNativePush(credentials: TradeNativePushCredentials, fetcher: typeof fetch = fetch): Promise<TradeNativePushAuthorization | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(credentials.clientEmail).setAudience(TOKEN_ENDPOINT)
      .setIssuedAt(now).setExpirationTime(now + 300).sign(await importPKCS8(credentials.privateKey, 'RS256'));
    const response = await fetcher(TOKEN_ENDPOINT, { method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return null; }
    const value: unknown = await response.json();
    if (!response.ok || !record(value) || value.token_type !== 'Bearer' || typeof value.access_token !== 'string'
      || !value.access_token || value.access_token.length > 16384 || typeof value.expires_in !== 'number' || value.expires_in < 60 || value.expires_in > 3600) {
      console.warn('tlink_push_authorization_failed', { provider: 'fcm', status: response.status });
      return null;
    }
    return { accessToken: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
  } catch { return null; }
}

export async function sendTradeNativePush(token: string, payload: TradePushPayload, authorization: TradeNativePushAuthorization,
  fetcher: typeof fetch = fetch, options: { nativeCall?: boolean; ended?: boolean } = {}): Promise<DeliveryStatus> {
  const ttl = Math.min(payload.kind === 'team-call' ? 90 : 86400, Math.floor((Date.parse(payload.expiresAt) - Date.now()) / 1000));
  if (!Number.isFinite(ttl) || ttl < 1) return 'stale';
  try {
    if (!/^[A-Za-z0-9_:.-]{16,4096}$/.test(token) || authorization.expiresAt <= Date.now() || !authorization.accessToken) return 'failed';
    const threadId = pushId(payload.threadId), id = pushId(payload.id), call = payload.kind === 'team-call';
    if (!call && payload.kind !== 'team-message') return 'failed';
    const body = call ? payload.body === 'Incoming team video call' ? 'Incoming team video call' : 'Incoming team voice call' : 'New team message';
    const callerName = call && payload.callerName !== undefined ? pushCallerName(payload.callerName) : undefined;
    const answerToken = call && options.nativeCall && !options.ended ? pushAnswerToken(payload.answerToken) : undefined;
    const response = await fetcher(SEND_ENDPOINT, { method: 'POST', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, ...(!call || (!options.nativeCall && !options.ended) ? { notification: { title: callerName || 'TLink', body } } : {}),
        data: { type: call && options.ended ? 'team_call_ended' : call ? 'team_call' : 'team_message', threadId, eventId: id, expiresAt: payload.expiresAt,
          ...(call ? { callId: id, ...(callerName ? { callerName } : {}), ...(answerToken ? { answerToken } : {}), ...(options.nativeCall || options.ended ? { mode: payload.body === 'Incoming team video call' ? 'video' : 'audio', hasVideo: String(payload.body === 'Incoming team video call') } : {}) } : {}) },
        android: { priority: 'HIGH', ttl: `${ttl}s`, ...(!call || (!options.nativeCall && !options.ended) ? { notification: { channel_id: call ? 'team-calls' : 'team-messages',
          tag: `tlink-${payload.kind}-${id}`, default_sound: true, visibility: 'PRIVATE' } } : {}) } } }) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return 'failed'; }
    const result: unknown = await response.json();
    if (response.ok) return record(result) && typeof result.name === 'string' && result.name.startsWith(`projects/${PROJECT}/messages/`) ? 'accepted' : 'failed';
    // Only an explicit FCM token rejection retires this exact registration.
    // Provider permissions, quotas and malformed requests must not disable it.
    if ([400,404].includes(response.status) && record(result) && record(result.error) && Array.isArray(result.error.details)
      && result.error.details.some(detail => record(detail) && detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
        && detail.errorCode === 'UNREGISTERED')) return 'expired';
    console.warn('tlink_push_delivery_failed', { provider: 'fcm', status: response.status });
    return 'failed';
  } catch { return 'failed'; }
}
