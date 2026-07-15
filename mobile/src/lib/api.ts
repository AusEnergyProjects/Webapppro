import type { User } from 'firebase/auth';

import { API_BASE_URL, APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
import { firebaseAuth } from '@/lib/auth';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly minimumVersion = '',
  ) {
    super(message);
  }
}

async function bearer(user?: User | null) {
  const active = user || firebaseAuth.currentUser;
  if (!active) throw new ApiError('Sign in to continue.', 401, 'AUTH_REQUIRED');
  return active.getIdToken(true);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, user?: User | null) {
  const deviceId = await getDeviceId();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await bearer(user)}`);
  headers.set('x-aea-device-id', deviceId);
  headers.set('x-aea-platform', MOBILE_PLATFORM);
  headers.set('x-aea-app-version', APP_VERSION);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' })) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      String(body.error || 'The request could not be completed.'),
      response.status,
      String(body.code || ''),
      String(body.minimumVersion || ''),
    );
  }
  return body as T;
}
