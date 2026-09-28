import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { teamNotificationTarget } from '@/lib/team-messages';
import { useApp } from '@/providers/app-provider';

export function NotificationNavigation() {
  const { access } = useApp();
  const navigation = useRootNavigationState();
  const handled = useRef('');
  useEffect(() => {
    if (access.status !== 'approved' || !navigation?.key) return;
    function respond(response: Notifications.NotificationResponse) {
      const notificationId = response.notification.request.identifier;
      if (handled.current === notificationId) return;
      const target = teamNotificationTarget(response.notification.request.content.data);
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
