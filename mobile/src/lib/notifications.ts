import * as Notifications from 'expo-notifications';
import { notificationsMuted } from '@/lib/device';

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const enabled = !await notificationsMuted();
    return {
      shouldShowBanner: enabled,
      shouldShowList: enabled,
      shouldPlaySound: enabled,
      shouldSetBadge: false,
    };
  },
});
