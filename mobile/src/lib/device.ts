import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';

const DEVICE_ID_KEY = 'aea-field-device-id-v1';
const PUSH_TOKEN_KEY = 'aea-field-native-push-token-v1';
const NOTIFICATIONS_MUTED_KEY = 'aea-field-notifications-muted-v1';

export async function getDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = `aea-${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return id;
}

export function getDeviceName() {
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Application.applicationName || 'Field device';
}

export async function notificationsMuted() {
  return (await SecureStore.getItemAsync(NOTIFICATIONS_MUTED_KEY)) === 'true';
}

export async function setNotificationsMuted(muted: boolean) {
  await SecureStore.setItemAsync(NOTIFICATIONS_MUTED_KEY, String(muted), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (muted) await forgetPushToken();
}

export async function notificationDeviceState() {
  const [muted, permission] = await Promise.all([notificationsMuted(), Notifications.getPermissionsAsync()]);
  return { muted, granted: permission.granted, canAskAgain: permission.canAskAgain, physicalDevice: Device.isDevice };
}

export async function configureNotificationChannels() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('field-sync', {
      name: 'Field work updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200],
      lightColor: '#07966f',
    });
    await Notifications.setNotificationChannelAsync('team-messages', {
      name: 'Team messages',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('team-calls', {
      name: 'Team calls',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

export async function getNativePushToken(requestPermission = false) {
  const provider = MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm';
  if (!Device.isDevice || await notificationsMuted()) {
    await forgetPushToken();
    return { token: '', provider };
  }
  let permissionGranted = false;
  try {
    await configureNotificationChannels();
    const current = await Notifications.getPermissionsAsync();
    const permission = !current.granted && current.canAskAgain && requestPermission
      ? await Notifications.requestPermissionsAsync() : current;
    if (!permission.granted) {
      await forgetPushToken();
      return { token: '', provider };
    }
    permissionGranted = true;
    const token = await Notifications.getDevicePushTokenAsync();
    const value = String(token.data);
    // The preference may change while the operating system registers the device.
    if (await notificationsMuted()) return { token: '', provider };
    await rememberPushToken(value);
    return { token: value, provider };
  } catch {
    const token = permissionGranted && !await notificationsMuted()
      ? await SecureStore.getItemAsync(PUSH_TOKEN_KEY) || '' : '';
    return { token, provider };
  }
}

export function rememberPushToken(token: string) {
  return SecureStore.setItemAsync(PUSH_TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export function forgetPushToken() {
  return SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
}

export async function deviceRegistration() {
  const push = await getNativePushToken();
  return {
    deviceId: await getDeviceId(),
    platform: MOBILE_PLATFORM,
    appVersion: APP_VERSION,
    deviceName: getDeviceName(),
    isPhysicalDevice: Device.isDevice,
    pushToken: push.token,
    pushProvider: push.provider,
  };
}
