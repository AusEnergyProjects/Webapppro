import * as Notifications from 'expo-notifications';
import { notificationsMuted } from '@/lib/device';
import { teamNotificationTarget } from '@/lib/team-messages';

export function notificationResponseTarget(data: Record<string, unknown> | undefined, actionIdentifier: string, now = Date.now()) {
  if (!data) return null;
  if (![Notifications.DEFAULT_ACTION_IDENTIFIER, 'open-conversation', 'open-call'].includes(actionIdentifier)) return null;
  const target = teamNotificationTarget(data);
  if (!target) return null;
  if (target.callId && (typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= now)) return { threadId: target.threadId };
  return target;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data || {};
    const expiredCall = data.type === 'team_call' && (typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now());
    const enabled = !await notificationsMuted().catch(() => true) && data.type !== 'team_call_ended' && !expiredCall;
    return {
      shouldShowBanner: enabled,
      shouldShowList: enabled,
      shouldPlaySound: enabled,
      shouldSetBadge: false,
    };
  },
});
