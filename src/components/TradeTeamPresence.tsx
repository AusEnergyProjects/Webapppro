"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { tradeTeamPresenceStatus, type TradeTeamPresence, type TradeTeamPresenceStatus } from "@/lib/trade-team-presence";

type PresenceError =
  | { kind: "read"; message: string }
  | { kind: "save"; message: string; next: TradeTeamPresenceStatus };

export default function TradeTeamPresence({ getAuthHeaders }: { getAuthHeaders: () => Promise<Record<string,string>> }) {
  const fetch = useTradeBusinessFetch(), authentication = useRef(getAuthHeaders);
  const [status,setStatus] = useState<TradeTeamPresenceStatus | null>(null), [saving,setSaving] = useState(false);
  const [error,setError] = useState<PresenceError | null>(null), [detailsOpen,setDetailsOpen] = useState(false), [checking,setChecking] = useState(false);
  const generation = useRef(0), working = useRef(false), reading = useRef<number | null>(null);
  const controllers = useRef(new Set<AbortController>()), detailsTrigger = useRef<HTMLButtonElement>(null), detailsId = useId();
  useEffect(() => { authentication.current = getAuthHeaders; },[getAuthHeaders]);

  const request = useCallback(async (next?: TradeTeamPresenceStatus): Promise<TradeTeamPresence> => {
    const controller = new AbortController();
    controllers.current.add(controller);
    let timer: number | undefined;
    try {
      return await Promise.race([(async () => {
        const headers = await authentication.current();
        if (controller.signal.aborted) throw new Error("Your call status could not connect. Try again.");
        const response = await fetch("/api/trade-team-presence",{method:next ? "PATCH" : "GET",headers:{...headers,...(next ? {"Content-Type":"application/json"} : {})},...(next ? {body:JSON.stringify({status:next})} : {}),cache:"no-store",signal:controller.signal});
        const result: {ok?:boolean;status?:unknown;updatedAt?:string;error?:string} = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Your call status could not be saved. Try again.");
        return {status:tradeTeamPresenceStatus(result.status),updatedAt:result.updatedAt || ""};
      })(),new Promise<never>((_,reject) => { timer = window.setTimeout(() => { controller.abort(); reject(new Error("Your call status could not connect. Try again.")); },12000); })]);
    } finally { window.clearTimeout(timer); controllers.current.delete(controller); }
  },[fetch]);

  const refresh = useCallback(async () => {
    if (working.current || reading.current !== null) return;
    const epoch = ++generation.current;
    reading.current = epoch; setChecking(true);
    try {
      const result = await request();
      if (generation.current === epoch) {
        setStatus(result.status);
        setError(previous => previous?.kind === "save" && previous.next !== result.status ? previous : null);
        setDetailsOpen(false);
      }
    } catch {
      if (generation.current === epoch) setError(previous => previous?.kind === "save" ? previous : {kind:"read",message:"Call status could not load. Try again."});
    } finally {
      if (reading.current === epoch) { reading.current = null; setChecking(false); }
    }
  },[request]);

  useEffect(() => {
    const lifecycle = generation;
    const activeControllers = controllers.current;
    const initial = window.requestAnimationFrame(() => void refresh());
    const check = () => { if (!document.hidden) void refresh(); };
    const interval = window.setInterval(check,30000);
    window.addEventListener("focus",check);
    return () => { lifecycle.current++; reading.current = null; for (const controller of activeControllers) controller.abort(); window.cancelAnimationFrame(initial); window.clearInterval(interval); window.removeEventListener("focus",check); };
  },[refresh]);

  const change = async (next: TradeTeamPresenceStatus) => {
    if (working.current || next === status) return;
    working.current = true; const epoch = ++generation.current; setSaving(true); setError(null); setDetailsOpen(false);
    try {
      const result = await request(next);
      if (generation.current === epoch) {
        setStatus(result.status);
        window.dispatchEvent(new CustomEvent("tlink:team-presence-changed",{detail:{status:result.status}}));
      }
    } catch { if (generation.current === epoch) setError({kind:"save",message:"Call status was not changed. Try again.",next}); }
    finally { working.current = false; if (generation.current === epoch) setSaving(false); }
  };

  const closeDetails = () => { setDetailsOpen(false); detailsTrigger.current?.focus(); };
  return <div className="tlink-presence-presence" onKeyDown={event => { if (event.key === "Escape" && detailsOpen) { event.preventDefault(); closeDetails(); } }}>
    <label className="tlink-presence-control" title="Online: available for calls. Busy or Offline: no incoming calls. Messages still arrive.">
      <span className={`tlink-presence-dot ${status || "unknown"}`} aria-hidden="true" />
      <select aria-label="My call status" value={status || ""} disabled={saving || status === null} onChange={event => void change(tradeTeamPresenceStatus(event.target.value))}>
        {status === null && <option value="">{error ? "Unavailable" : "Loading..."}</option>}
        <option value="online">Online</option><option value="busy">Busy</option><option value="offline">Offline</option>
      </select>
    </label>
    <span className="tlink-presence-help" role="status">{saving ? "Saving..." : error ? error.message : status === "online" ? "Available for calls" : status ? "Calls off. Messages on." : ""}</span>
    {error && <button ref={detailsTrigger} type="button" className="tlink-presence-details-trigger" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)}>{error.kind === "save" ? "Not saved" : "Check status"}</button>}
    {error && detailsOpen && <div id={detailsId} className="tlink-presence-error" role="group" aria-label="Call status details">
      <p>{error.message}</p>
      {error.kind === "read" && status && <p>Last confirmed: {status === "online" ? "Online" : status === "busy" ? "Busy" : "Offline"}.</p>}
      <div className="tlink-presence-error-actions"><button type="button" disabled={saving || checking} onClick={() => void (error.kind === "save" ? change(error.next) : refresh())}>{saving ? "Saving..." : checking ? "Checking..." : "Retry"}</button><button type="button" onClick={closeDetails}>Close</button></div>
    </div>}
  </div>;
}
