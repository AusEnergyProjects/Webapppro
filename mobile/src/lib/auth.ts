import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { firebaseConfig } from '@/lib/config';

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

export function resetPassword(email: string) {
  return sendPasswordResetEmail(firebaseAuth, email.trim());
}

export function firebaseSignOut() {
  return signOut(firebaseAuth);
}
