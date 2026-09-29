import { useCallback, useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';

import { ApiError, apiRequest, type ApiRequestOptions } from '@/lib/api';
import { useApp } from '@/providers/app-provider';

/** An old screen's delayed dialog or picker must never submit under a newly selected business. */
export function useBusinessApi() {
  const { user } = useApp();
  const alive = useRef(true);
  const expectedBusinessKey = user?.localOwnerKey;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return useCallback(<T,>(path: string, init: RequestInit = {}, identity?: User | null, options: ApiRequestOptions = {}) => {
    if (!alive.current || !expectedBusinessKey) return Promise.reject(new ApiError(
      'Your business changed. Reopen this item before continuing.', 409, 'BUSINESS_CHANGED'));
    return apiRequest<T>(path, init, identity, { ...options, expectedBusinessKey });
  }, [expectedBusinessKey]);
}
