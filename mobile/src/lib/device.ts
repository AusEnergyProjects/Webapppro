import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';

const DEVICE_ID_KEY = 'aea-field-device-id-v1';
const PUSH_TOKEN_KEY = 'aea-field-native-push-token-v1';

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

export async function getNativePushToken() {
  const existing = await SecureStore.getItemAsync(PUSH_TOKEN_KEY) || '';
  if (!Device.isDevice) return { token: '', provider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm' };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('field-sync', {
        name: 'Field work updates',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 200],
        lightColor: '#07966f',
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { token: existing, provider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm' };
    const token = await Notifications.getDevicePushTokenAsync();
    const value = String(token.data);
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return { token: value, provider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm' };
  } catch {
    return { token: existing, provider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm' };
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
    pushToken: push.token,
    pushProvider: push.provider,
  };
}
