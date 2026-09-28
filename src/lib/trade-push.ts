export type TradePushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};
export type TradePushSubscriptionStatus = { id: string; messages: boolean; calls: boolean; enabled: boolean };
export type TradePushPayload = {
  v: 1;
  kind: 'team-message' | 'team-call';
  id: string;
  threadId: string;
  title: 'TLink';
  body: string;
  url: string;
  expiresAt: string;
};

export function pushRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PUSH_INPUT_INVALID');
  return value as Record<string, unknown>;
}

export function pushId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new Error('PUSH_INPUT_INVALID');
  return value;
}

export function pushBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('PUSH_INPUT_INVALID');
  return value;
}

export function pushBase64Key(value: unknown, size: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(size * 4 / 3)) throw new Error('PUSH_INPUT_INVALID');
  const bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  if (bytes.length !== size || btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') !== value || (size === 65 && bytes.charCodeAt(0) !== 4)) throw new Error('PUSH_INPUT_INVALID');
  return value;
}

export function pushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || value.length < 20 || /[\s\\]/.test(value)) throw new Error('PUSH_ENDPOINT_INVALID');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PUSH_ENDPOINT_INVALID'); }
  // Browser-operated services only. User-controlled hosts, credentials, redirects and arbitrary ports are never fetched.
  const allowed = (url.hostname === 'fcm.googleapis.com' && /^\/fcm\/send\/[^/]+$/.test(url.pathname))
    || (url.hostname === 'updates.push.services.mozilla.com' && /^\/wpush\/v[12]\/[^/]+$/.test(url.pathname))
    || (url.hostname === 'web.push.apple.com' && /^\/[A-Za-z0-9/_-]+$/.test(url.pathname));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search || !allowed) throw new Error('PUSH_ENDPOINT_INVALID');
  return url.href;
}

export function pushSubscriptionInput(value: unknown): TradePushSubscriptionInput {
  const input = pushRecord(value), keys = pushRecord(input.keys);
  const expirationTime = input.expirationTime ?? null;
  if (expirationTime !== null && (typeof expirationTime !== 'number' || !Number.isSafeInteger(expirationTime) || expirationTime <= Date.now())) throw new Error('PUSH_INPUT_INVALID');
  return { endpoint: pushEndpoint(input.endpoint), expirationTime,
    keys: { p256dh: pushBase64Key(keys.p256dh, 65), auth: pushBase64Key(keys.auth, 16) } };
}
