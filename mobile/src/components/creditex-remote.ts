import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { CreditexApi } from '@/lib/creditex-api';

export function useCreditexRemote<T>(api: CreditexApi, path: string, enabled = true) {
  const [loaded, setLoaded] = useState<{ key: string; data: T | null; error: string } | null>(null), [revision, setRevision] = useState(0);
  const key = `${path}:${revision}`;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const load = async () => {
      if (!enabled || pending || controller.signal.aborted || AppState.currentState !== 'active') return;
      pending = true;
      try { const next = await api<T>(path, undefined, controller.signal); if (!controller.signal.aborted) setLoaded({ key, data: next, error: '' }); }
      catch (cause) { if (!controller.signal.aborted) setLoaded({ key, data: null, error: cause instanceof Error ? cause.message : 'This information could not be loaded.' }); }
      finally { pending = false; }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { controller.abort(); clearInterval(timer); foreground.remove(); };
  }, [api, path, enabled, key]);
  const current = enabled && loaded?.key === key ? loaded : null;
  return { data: current?.data || null, error: current?.error || '', loading: enabled && !current, refresh };
}
