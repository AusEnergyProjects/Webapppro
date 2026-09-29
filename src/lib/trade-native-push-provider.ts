import { env } from 'cloudflare:workers';
import { importPKCS8, SignJWT } from 'jose';
import { pushId, type TradePushPayload } from './trade-push';

const PROJECT = 'australian-energy-assessments';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`;
export type TradeNativePushCredentials = { clientEmail: string; privateKey: string };
export type TradeNativePushAuthorization = { accessToken: string; expiresAt: number };
type DeliveryStatus = 'accepted' | 'expired' | 'stale' | 'failed';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
    const response = await fetcher(TOKEN_ENDPOINT, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    const value: unknown = await response.json();
    if (!response.ok || !record(value) || value.token_type !== 'Bearer' || typeof value.access_token !== 'string'
      || !value.access_token || value.access_token.length > 16384 || typeof value.expires_in !== 'number' || value.expires_in < 60 || value.expires_in > 3600) return null;
    return { accessToken: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
  } catch { return null; }
}

export async function sendTradeNativePush(token: string, payload: TradePushPayload, authorization: TradeNativePushAuthorization,
  fetcher: typeof fetch = fetch): Promise<DeliveryStatus> {
  const ttl = Math.min(payload.kind === 'team-call' ? 90 : 86400, Math.floor((Date.parse(payload.expiresAt) - Date.now()) / 1000));
  if (!Number.isFinite(ttl) || ttl < 1) return 'stale';
  try {
    if (!/^[A-Za-z0-9_:.-]{16,4096}$/.test(token) || authorization.expiresAt <= Date.now() || !authorization.accessToken) return 'failed';
    const threadId = pushId(payload.threadId), id = pushId(payload.id), call = payload.kind === 'team-call';
    if (!call && payload.kind !== 'team-message') return 'failed';
    const body = call ? payload.body === 'Incoming team video call' ? 'Incoming team video call' : 'Incoming team voice call' : 'New team message';
    const response = await fetcher(SEND_ENDPOINT, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${authorization.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: 'TLink', body },
        data: { type: call ? 'team_call' : 'team_message', threadId, eventId: id, expiresAt: payload.expiresAt, ...(call ? { callId: id } : {}) },
        android: { priority: 'HIGH', ttl: `${ttl}s`, notification: { channel_id: call ? 'team-calls' : 'team-messages',
          tag: `tlink-${payload.kind}-${id}`, default_sound: true, visibility: 'PRIVATE' } } } }) });
    const result: unknown = await response.json();
    if (response.ok) return record(result) && typeof result.name === 'string' && result.name.startsWith(`projects/${PROJECT}/messages/`) ? 'accepted' : 'failed';
    // Only an explicit FCM token rejection retires this exact registration.
    // Provider permissions, quotas and malformed requests must not disable it.
    if ([400,404].includes(response.status) && record(result) && record(result.error) && Array.isArray(result.error.details)
      && result.error.details.some(detail => record(detail) && detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
        && detail.errorCode === 'UNREGISTERED')) return 'expired';
    return 'failed';
  } catch { return 'failed'; }
}
