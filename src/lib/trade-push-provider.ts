import { env } from 'cloudflare:workers';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { pushBase64Key, pushSubscriptionInput, type TradePushPayload, type TradePushSubscriptionInput } from './trade-push';

export type TradePushCredentials = { publicKey: string; privateKey: string; subject: string };

export function tradePushCredentials(source: object = env): TradePushCredentials | null {
  const setting = (name: string) => { const value: unknown = Reflect.get(source, name); return typeof value === 'string' ? value.trim() : ''; };
  try {
    return { publicKey: pushBase64Key(setting('TLINK_WEB_PUSH_PUBLIC_KEY'), 65), privateKey: pushBase64Key(setting('TLINK_WEB_PUSH_PRIVATE_KEY'), 32),
      subject: 'mailto:info@ausenergyassessments.com' };
  } catch { return null; }
}

export async function sendTradePush(subscription: TradePushSubscriptionInput, payload: TradePushPayload, credentials: TradePushCredentials,
  fetcher: typeof fetch = fetch): Promise<'accepted' | 'expired' | 'stale' | 'failed'> {
  const ttl = Math.min(payload.kind === 'team-call' ? 90 : 86400, Math.floor((Date.parse(payload.expiresAt) - Date.now()) / 1000));
  if (!Number.isFinite(ttl) || ttl < 1) return 'stale';
  try {
    const checked = pushSubscriptionInput(subscription);
    const request = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl, urgency: payload.kind === 'team-call' ? 'high' : 'normal' } }, checked, credentials);
    const response = await fetcher(checked.endpoint, { ...request, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    // Provider response bodies contain no application data and are not needed. Release the connection without retaining diagnostics or endpoint tokens.
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) return 'expired';
    return response.status === 201 || response.status === 202 ? 'accepted' : 'failed';
  } catch { return 'failed'; }
}
