import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { acknowledgeTeamDeliveries, messagesUnread } from '@/lib/messages-client';
import { notificationResponseTarget } from '@/lib/notifications';
import { resolveFieldAccessModes } from '@/lib/sync';
import { teamNotificationTarget } from '@/lib/team-messages';
import { useApp } from '@/providers/app-provider';

export function NotificationNavigation() {
  const { access, user, sync } = useApp();
  const navigation = useRootNavigationState();
  const handled = useRef('');
  const identity = user?.localOwnerKey;
  useEffect(() => {
    if (access.status !== 'approved' || !identity || !sync.online) return;
    const controller = new AbortController();
    const delivered = new Map<string, number>();
    let inFlight = false;
    const refresh = async () => {
      if (controller.signal.aborted || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      const request = new AbortController();
      let finish = () => {};
      const cancelled = new Promise<void>(resolve => { finish = resolve; });
      const cancel = () => { request.abort(); finish(); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 20000);
      try {
        await Promise.race([cancelled, (async () => {
          const modes = await resolveFieldAccessModes();
          if (request.signal.aborted || !modes.includes('trade_team') || AppState.currentState !== 'active') return;
          const unread = await messagesUnread(request.signal);
          if (request.signal.aborted || AppState.currentState !== 'active') return;
          await acknowledgeTeamDeliveries(unread.threads, delivered, request.signal);
        })()]);
      } catch { /* No receipt is claimed until the acknowledgement succeeds; retry on refresh. */ }
      finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); request.abort(); inFlight = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    const app = AppState.addEventListener('change', () => { void refresh(); });
    const notification = Notifications.addNotificationReceivedListener(event => {
      const data = event.request.content.data;
      if (data?.type === 'team_message' && teamNotificationTarget(data)) void refresh();
    });
    return () => { controller.abort(); clearInterval(timer); app.remove(); notification.remove(); };
  }, [access.status, identity, sync.online]);
  useEffect(() => {
    if (access.status !== 'approved' || !navigation?.key) return;
    function respond(response: Notifications.NotificationResponse) {
      const notificationId = response.notification.request.identifier;
      if (handled.current === notificationId) return;
      const target = notificationResponseTarget(response.notification.request.content.data, response.actionIdentifier);
      if (!target) return;
      handled.current = notificationId;
      router.push({ pathname: '/messages', params: { ...target, notificationId } });
      Notifications.clearLastNotificationResponse();
    }
    const previous = Notifications.getLastNotificationResponse();
    if (previous) respond(previous);
    const subscription = Notifications.addNotificationResponseReceivedListener(respond);
    return () => subscription.remove();
  }, [access.status, navigation?.key]);
  return null;
}
