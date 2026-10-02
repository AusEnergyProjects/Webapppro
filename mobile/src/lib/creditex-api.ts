import type { User } from 'firebase/auth';
import { firebaseAuth } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/config';

export type CreditexAppAccess = {
  workspace: 'creditex'; signInMethod: 'named_account';
  member: { id: string; uid: string; name: string; email: string; organisationId: string; organisationName: string; role: string };
  permissions: string[];
  capabilities: { jobs: boolean; messages: boolean; sendMessages: boolean; tasks: boolean; createTasks: boolean; assignTasks: boolean; editTasks: boolean; completeTasks: boolean; customers: boolean; calculator: boolean; map: boolean };
};
export class CreditexApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
const ALLOWED_PATHS = new Set(['/api/creditex/app-access', '/api/creditex/job-audit', '/api/creditex/job-intents', '/api/creditex/notifications', '/api/portal-team-workspace', '/api/creditex/customers']);

/** Online named-account requests. Never use installer PINs, a trade header or offline caches. */
export function createCreditexApi(user: User, lifetime: AbortSignal) {
  return async function request<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, API_BASE_URL);
    if (url.origin !== new URL(API_BASE_URL).origin || !ALLOWED_PATHS.has(url.pathname)) throw new Error('This operation is not part of your Creditex workspace.');
    if (url.pathname === '/api/portal-team-workspace') url.searchParams.set('workspace', 'creditex');
    const current = () => { if (lifetime.aborted || signal?.aborted || firebaseAuth.currentUser?.uid !== user.uid) throw new CreditexApiError('Your account changed. Sign in again.', 401, 'AUTH_REQUIRED'); };
    current();
    const token = await user.getIdToken(); current();
    const controller = new AbortController(); const abort = () => controller.abort();
    lifetime.addEventListener('abort', abort, { once: true }); signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20000);
    try {
      const response = await fetch(url.toString(), { method: body ? 'POST' : 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      current();
      const value = await response.json(); current();
      if (!response.ok || value?.ok !== true) throw new CreditexApiError(typeof value?.error === 'string' ? value.error : 'Creditex could not complete this request.', response.status, typeof value?.code === 'string' ? value.code : '');
      return value;
    } catch (error) {
      current();
      if (controller.signal.aborted) throw new Error('The request took too long. Check your connection and try again.');
      throw error;
    } finally { clearTimeout(timer); lifetime.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); }
  };
}
export type CreditexApi = ReturnType<typeof createCreditexApi>;
