"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import type { MessageMediaAuth } from "@/lib/trade-message-media";

type UnreadThread = { id: string; name: string; unread: number; sequence: number; latestAt: string };
type AlertState = { unreadCount: number; threads: UnreadThread[]; unavailable: boolean; refresh: () => void; open: (id: string) => void; setActiveThread: (id: string) => void };
const Context = createContext<AlertState>({ unreadCount: 0, threads: [], unavailable: false, refresh: () => {}, open: () => {}, setActiveThread: () => {} });
export const useTradeMessageAlerts = () => useContext(Context);
type Props = { children: ReactNode; user?: User | null; getAuthHeaders?: MessageMediaAuth; enabled?: boolean; onOpen: (threadId: string) => void };

export function TradeMessageAlerts(props: Props) {
  const business = useTradeBusiness();
  return <MessageAlerts key={`${business?.ownerUid || "native"}:${props.user?.uid || "session"}:${props.enabled !== false}`} {...props} />;
}

function MessageAlerts({ children, user, getAuthHeaders, enabled = true, onOpen }: Props) {
  const request = useTradeBusinessFetch();
  const latest = useRef({ request, user, getAuthHeaders, onOpen });
  useEffect(() => { latest.current = { request, user, getAuthHeaders, onOpen }; }, [request, user, getAuthHeaders, onOpen]);
  const [snapshot, setSnapshot] = useState<{ unreadCount: number; threads: UnreadThread[] }>({ unreadCount: 0, threads: [] });
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState<UnreadThread | null>(null);
  const activeThread = useRef("");
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const setActiveThread = useCallback((id: string) => { activeThread.current = id; }, []);
  const open = useCallback((id: string) => { setNotice(null); latest.current.onOpen(id); }, []);

  useEffect(() => {
    if (!enabled || (!user && !getAuthHeaders)) return;
    let disposed = false, pending = false;
    let seen: Map<string, number> | null = null;
    const delivered = new Map<string, number>();
    let controller: AbortController | null = null;
    const poll = async () => {
      if (disposed || pending || document.visibilityState !== "visible") return;
      pending = true;
      const currentController = new AbortController(); controller = currentController;
      const signal = currentController.signal;
      const timeout = window.setTimeout(() => currentController.abort(), 12000);
      const aborted = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Message alerts timed out.")), { once: true }));
      try {
        // The deadline includes a stalled token refresh, not just the network request.
        const { result, auth, scopedRequest } = await Promise.race([
          (async () => {
            const current = latest.current;
            const auth = current.getAuthHeaders ? await current.getAuthHeaders() : { Authorization: `Bearer ${await current.user!.getIdToken()}` };
            signal.throwIfAborted();
            const response = await current.request("/api/trade-messages?view=unread", { headers: auth, cache: "no-store", signal });
            if (!response.ok) throw new Error("Message alerts could not be refreshed.");
            const result = await response.json() as { ok: boolean; unreadCount: number; threads: UnreadThread[] };
            return { result, auth, scopedRequest: current.request };
          })(),
          aborted,
        ]);
        if (disposed || signal.aborted || !result.ok) return;
        const fresh = result.threads.find(thread => thread.id !== activeThread.current && (seen ? thread.sequence > (seen.get(thread.id) || 0) : true));
        if (fresh) {
          setNotice(fresh);
          if (seen) window.dispatchEvent(new Event("tlink:message-received"));
        } else setNotice(current => current && result.threads.some(thread => thread.id === current.id) && current.id !== activeThread.current ? current : null);
        // Keep high-water marks after a thread is read, so eventual replicas cannot replay its chime.
        seen ||= new Map();
        result.threads.forEach(thread => seen!.set(thread.id, Math.max(seen!.get(thread.id) || 0, thread.sequence)));
        setSnapshot({ unreadCount: result.unreadCount, threads: result.threads });
        setUnavailable(false);
        // Receiving an authenticated unread snapshot confirms delivery, not
        // reading. Bound both the batch and concurrency; failed acknowledgements
        // remain unconfirmed and retry on the next poll in this identity scope.
        const acknowledgements = result.threads.filter(thread => Number.isSafeInteger(thread.sequence)
          && thread.sequence > (delivered.get(thread.id) || 0)).slice(0,20);
        let next = 0;
        const acknowledge = async () => {
          while (!disposed && !signal.aborted && next < acknowledgements.length) {
            const thread = acknowledgements[next++];
            try {
              const response = await scopedRequest("/api/trade-messages", { method:"POST", headers:{...auth,"Content-Type":"application/json"},
                body:JSON.stringify({action:"delivered",threadId:thread.id,throughSequence:thread.sequence}), cache:"no-store", signal });
              if (response.ok && (await response.json() as {ok?:boolean}).ok && !disposed && !signal.aborted)
                delivered.set(thread.id,Math.max(delivered.get(thread.id) || 0,thread.sequence));
            } catch { /* Keep this delivery unconfirmed for the next poll. */ }
          }
        };
        try { await Promise.race([Promise.all([acknowledge(),acknowledge()]),aborted]); }
        catch { /* A receipt timeout must not discard the successfully fetched unread state. */ }
      } catch { if (!disposed) setUnavailable(true); }
      finally { window.clearTimeout(timeout); pending = false; }
    };
    refreshRef.current = () => { void poll(); };
    const first = window.setTimeout(() => void poll(), 0);
    const interval = window.setInterval(() => void poll(), 5000);
    const wake = () => { void poll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      disposed = true; controller?.abort(); refreshRef.current = () => {};
      window.clearTimeout(first); window.clearInterval(interval);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake); window.removeEventListener("online", wake);
    };
  }, [enabled, user, getAuthHeaders]);

  return <Context.Provider value={{ ...snapshot, unavailable, refresh, open, setActiveThread }}>
    {children}
    {notice && <aside className="tlink-message-alert-toast" aria-label="New team message" role="status">
      <div><strong>{notice.name}</strong><span>{notice.unread === 1 ? "New team message" : `${notice.unread} unread messages`}</span></div>
      <button type="button" onClick={() => open(notice.id)}>Open chat</button>
      <button type="button" className="tlink-message-alert-dismiss" aria-label="Dismiss message alert" onClick={() => setNotice(null)}>×</button>
    </aside>}
  </Context.Provider>;
}

export function TradeMessageUnreadBadge() {
  const { unreadCount, unavailable } = useTradeMessageAlerts();
  if (!unreadCount && !unavailable) return null;
  return <b className="tlink-message-alert-badge" title={unavailable ? "Message count could not refresh. Open Messages to check." : `${unreadCount} unread team messages`} aria-label={unavailable ? "Message count needs refreshing" : `${unreadCount} unread team messages`}>{unreadCount > 99 ? "99+" : unreadCount || "!"}</b>;
}
