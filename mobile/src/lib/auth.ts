import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { API_BASE_URL, firebaseConfig } from '@/lib/config';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function nativeAuth() {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(app);
  }
}

export const firebaseAuth = nativeAuth();

export function emailSignIn(email: string, password: string) {
  return signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
}

export function googleSignIn(idToken: string) {
  return signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
}

export async function resetPassword(email: string, workspace: 'trade' | 'creditex' = 'trade') {
  const recipient = email.trim().toLowerCase();
  if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error('Enter a valid email address before resetting your password.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/auth/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recipient, continuePath: workspace === 'creditex' ? '/creditex/compliance' : '/direct-trade/team' }),
        signal: controller.signal,
      });
    } catch {
      throw new Error('We could not request a password reset. Check your connection and try again.');
    }
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error('Enter a valid email address before resetting your password.');
      }
      if (response.status === 429) {
        throw new Error('Please wait before requesting another password reset.');
      }
      throw new Error('The password reset service is temporarily unavailable. Please try again.');
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error('The password reset service did not respond correctly. Please try again.');
    }
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
      throw new Error('We could not request a password reset. Please try again.');
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function firebaseSignOut() {
  return signOut(firebaseAuth);
}
