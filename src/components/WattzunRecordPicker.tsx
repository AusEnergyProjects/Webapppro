"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { WattzunScope } from "@/lib/wattzun-portal";
import { createTradeBusinessFetch } from "@/lib/trade-business-client";
import { readWattzunJobMatches, wattzunJobHref, type WattzunJobMatch, type WattzunRecordLookup } from "@/lib/wattzun-records";
import styles from "./WattzunRecordPicker.module.css";

/** Record metadata stays in the authorised UI; it is not sent to the model. */
export function WattzunRecordPicker({ user, scope, lookup, onNavigate }: {
  user: User; scope: WattzunScope; lookup: WattzunRecordLookup; onNavigate: (href: string) => void;
}) {
  return scope.portal === "trade" ? <RecordSearch key={`${user.uid}:${scope.scopeId}`} user={user} scope={scope} lookup={lookup} onNavigate={onNavigate} /> : null;
}

function RecordSearch({ user, scope, lookup, onNavigate }: {
  user: User; scope: WattzunScope; lookup: WattzunRecordLookup; onNavigate: (href: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(lookup.query);
  const [matches, setMatches] = useState<WattzunJobMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [user.uid, scope.scopeId]);

  async function search() {
    const term = query.trim();
    if (scope.portal !== "trade" || term.length < 2 || term.length > 100 || busy) return;
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setBusy(true); setError(""); setMatches([]); setSearched(false);
    try {
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      const parameters = new URLSearchParams({ mode: "index", resource: "jobs", filter: "all", search: term, pageSize: "20", total: "0" });
      const request = createTradeBusinessFetch(scope.scopeId, window.location.origin);
      const response = await request(`/api/trade-crm?${parameters}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true || !response.ok) {
        throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "The jobs could not be searched.");
      }
      if (!("items" in payload)) throw new Error("The job search could not be read. Try again.");
      setMatches(readWattzunJobMatches(payload.items)); setSearched(true);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The jobs could not be searched.");
    } finally {
      if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }

  if (scope.portal !== "trade") return null;
  return <section className={styles.picker} aria-label={lookup.kind === "file" ? "Find a job file" : "Find a job"}>
    <h3>{lookup.kind === "file" ? "Choose the job for this file" : "Choose the exact job"}</h3>
    {lookup.kind === "file" && <p>Open the job&apos;s Files tab, then choose the document. Your call can continue while you work.</p>}
    <form onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor={id}>Job number or customer name</label>
      <div className={styles.search}><input id={id} value={query} maxLength={100} onChange={event => { pending.current?.abort(); pending.current = null; setBusy(false); setQuery(event.target.value); setMatches([]); setSearched(false); setError(""); }} /><button disabled={busy || query.trim().length < 2} type="submit">{busy ? "Searching..." : "Find job"}</button></div>
    </form>
    {error && <p role="alert">{error}</p>}
    {searched && matches.length === 0 && <p role="status">No matching accessible jobs. Check the job number or customer spelling.</p>}
    <ul>{matches.map(job => <li key={job.id}><button type="button" onClick={() => onNavigate(wattzunJobHref(job.id, lookup.kind))}><strong>{job.workNumber}</strong><span>{job.title}</span><span>Open {lookup.kind === "file" ? "Files" : "job"} ↗</span></button></li>)}</ul>
    {matches.length === 20 && <p>Showing up to 20 matches. Add more of the job number or name to narrow the search.</p>}
  </section>;
}
