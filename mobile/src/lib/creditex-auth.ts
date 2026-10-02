import { FirebaseError } from 'firebase/app';
import { getMultiFactorResolver, TotpMultiFactorGenerator, type MultiFactorError, type MultiFactorResolver } from 'firebase/auth';
import { emailSignIn, firebaseAuth } from '@/lib/auth';

function multiFactorError(error: unknown): error is MultiFactorError {
  return error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required';
}
export async function creditexEmailSignIn(email: string, password: string): Promise<MultiFactorResolver | null> {
  try { await emailSignIn(email, password); return null; }
  catch (error) { if (multiFactorError(error)) return getMultiFactorResolver(firebaseAuth, error); throw error; }
}
export async function verifyCreditexAuthenticator(resolver: MultiFactorResolver, factorUid: string, code: string) {
  if (!/^\d{6}$/.test(code) || !resolver.hints.some(hint => hint.uid === factorUid && hint.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw new Error('Choose your authenticator and enter its current six-digit code.');
  const credential = await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(factorUid, code));
  await credential.user.getIdToken(true);
}
export function creditexSignInError(error: unknown) {
  const code = error instanceof FirebaseError ? error.code : '';
  if (code === 'auth/invalid-verification-code') return 'That code was not accepted. Enter the current code from your authenticator.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Check your email and password, then try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait before trying again.';
  if (code === 'auth/code-expired' || code === 'auth/session-expired') return 'Verification expired. Cancel and sign in again.';
  return error instanceof Error && !code ? error.message : 'Sign-in could not be completed. Check your connection and try again.';
}
