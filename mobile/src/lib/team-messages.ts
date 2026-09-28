import { Linking } from 'react-native';

import { apiRequest } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';

export type TeamNotificationTarget = { threadId: string; callId?: string };

function reference(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : '';
}

export function teamNotificationTarget(data: unknown): TeamNotificationTarget | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.type !== 'team_message' && value.type !== 'team_call') return null;
  const threadId = reference(value.threadId);
  if (!threadId) return null;
  const callId = value.type === 'team_call' ? reference(value.callId) : '';
  return { threadId, ...(callId ? { callId } : {}) };
}

export function trustedTeamHandoffUrl(value: unknown, baseUrl = API_BASE_URL) {
  if (typeof value !== 'string') throw new Error('Team messages did not return a valid link. Try again.');
  const url = new URL(value);
  const base = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password
    || url.pathname !== '/direct-trade/messages' || url.search
    || !/^#handoff=[A-Za-z0-9_-]{20,512}$/.test(url.hash)) {
    throw new Error('Team messages did not return a secure TLink link. Try again.');
  }
  return url.href;
}

export async function openTeamMessages(target?: TeamNotificationTarget) {
  const result = await apiRequest<{ ok: boolean; url: string; expiresAt: string }>('/api/trade-team-handoff', {
    method: 'POST',
    body: JSON.stringify({ action: 'issue', ...target }),
  });
  if (!result.ok) throw new Error('Team messages could not be opened. Try again.');
  await Linking.openURL(trustedTeamHandoffUrl(result.url));
}
