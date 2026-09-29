"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { tradeTeamPresenceStatus, type TradeTeamPresence, type TradeTeamPresenceStatus } from "@/lib/trade-team-presence";

export default function TradeTeamPresence({ getAuthHeaders }: { getAuthHeaders: () => Promise<Record<string,string>> }) {
  const fetch = useTradeBusinessFetch(), authentication = useRef(getAuthHeaders);
  const [status,setStatus] = useState<TradeTeamPresenceStatus | null>(null), [saving,setSaving] = useState(false), [error,setError] = useState("");
  const generation = useRef(0), working = useRef(false);
  useEffect(() => { authentication.current = getAuthHeaders; },[getAuthHeaders]);

  const request = useCallback(async (next?: TradeTeamPresenceStatus): Promise<TradeTeamPresence> => {
    const controller = new AbortController();
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
    } finally { window.clearTimeout(timer); }
  },[fetch]);

  const refresh = useCallback(async () => {
    if (working.current) return;
    const epoch = ++generation.current;
    try {
      const result = await request();
      if (generation.current === epoch) { setStatus(result.status); setError(""); }
    } catch { if (generation.current === epoch) setError("Call status could not load. Try again."); }
  },[request]);

  useEffect(() => {
    const lifecycle = generation;
    const initial = window.requestAnimationFrame(() => void refresh());
    const check = () => { if (!document.hidden) void refresh(); };
    const interval = window.setInterval(check,30000);
    window.addEventListener("focus",check);
    return () => { lifecycle.current++; window.cancelAnimationFrame(initial); window.clearInterval(interval); window.removeEventListener("focus",check); };
  },[refresh]);

  const change = async (next: TradeTeamPresenceStatus) => {
    if (working.current || next === status) return;
    working.current = true; const epoch = ++generation.current; setSaving(true); setError("");
    try {
      const result = await request(next);
      if (generation.current === epoch) {
        setStatus(result.status);
        window.dispatchEvent(new CustomEvent("tlink:team-presence-changed",{detail:{status:result.status}}));
      }
    } catch { if (generation.current === epoch) setError("Call status was not changed. Try again."); }
    finally { working.current = false; if (generation.current === epoch) setSaving(false); }
  };

  return <div className="tlink-presence-presence">
    <label className="tlink-presence-control" title="Online: available for calls. Busy or Offline: no incoming calls. Messages still arrive.">
      <span className={`tlink-presence-dot ${status ? `tlink-presence-${status}` : ""}`} aria-hidden="true" />
      <span className="tlink-presence-label">My status</span>
      <select aria-label="My call status" value={status || ""} disabled={saving || status === null} onChange={event => void change(tradeTeamPresenceStatus(event.target.value))}>
        {status === null && <option value="">Loading...</option>}
        <option value="online">Online</option><option value="busy">Busy</option><option value="offline">Offline</option>
      </select>
    </label>
    <span className="tlink-presence-help" role="status">{saving ? "Saving..." : status === "online" ? "Available for calls" : status ? "Calls off. Messages on." : ""}</span>
    {error && <span className="tlink-presence-error" role="alert">{error} <button type="button" disabled={saving} onClick={() => void refresh()}>Retry</button></span>}
  </div>;
}
