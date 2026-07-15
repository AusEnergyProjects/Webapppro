import { Platform } from 'react-native';

export const APP_VERSION = '1.0.0';
export const SYNC_CONTRACT_VERSION = 2;
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://aea-energy-comparison.info294029.chatgpt.site').replace(/\/$/, '');

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBL9P793q5z7o6Baqg-o2yuIteYU6IHrug',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'australian-energy-assessments.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'australian-energy-assessments',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'australian-energy-assessments.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '169611555810',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:169611555810:web:4bc06afa3c86cd64a37fbb',
};

export const GOOGLE_CLIENT_ID = Platform.select({
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
}) || '';

export const MOBILE_PLATFORM = Platform.OS === 'ios' ? 'ios' : 'android';
export const ADDRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_PART_BYTES = 5 * 1024 * 1024;
