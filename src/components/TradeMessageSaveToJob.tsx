"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { messageLinks } from "@/lib/trade-message-job-files";
import type { MessageAttachment, MessageMediaAuth } from "@/lib/trade-message-media";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./TradeMessageSaveToJob.module.css";

type JobChoice = { id: string; jobNumber: string };
type Result = { ok?: boolean; error?: string; jobs?: JobChoice[]; saved?: number; total?: number; jobNumber?: string };

export default function TradeMessageSaveToJob({ threadId, message, getAuthHeaders }: {
  threadId: string;
  message: { id: string; body: string; attachments: MessageAttachment[] };
  getAuthHeaders: MessageMediaAuth;
}) {
  const fetch = useTradeBusinessFetch();
  const labelId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true), activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; activeRequest.current?.abort(); };
  }, []);
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<JobChoice[]>([]), [selected, setSelected] = useState<JobChoice | null>(null);
  const [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [status, setStatus] = useState("");
  const count = messageLinks(message.body).length + message.attachments.length;
  if (!count) return null;

  async function request(query: string, body?: object) {
    const controller = new AbortController();
    activeRequest.current = controller;
    const { signal } = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      return await Promise.race([
        (async () => {
          const auth = await getAuthHeaders();
          signal.throwIfAborted();
          const response = await fetch(`/api/trade-message-job-files${query}`, {
            method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
            headers: { ...auth, ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const result: Result = await response.json();
          signal.throwIfAborted();
          if (!response.ok || !result.ok) throw new Error(result.error || "The job files could not be saved.");
          return result;
        })(),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("The request timed out. Try again; saved files will not be duplicated.")), { once: true })),
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy || activeRequest.current) return;
    setBusy(true); setStatus(""); setSelected(null); setJobs([]);
    try {
      const params = new URLSearchParams({ threadId, messageId: message.id, search: query.trim() });
      const result = await request(`?${params}`);
      if (!alive.current) return;
      setJobs(result.jobs || []); setSearched(true);
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "Jobs could not be searched."); }
    finally { if (alive.current) setBusy(false); }
  }

  async function save() {
    if (!selected || busy || activeRequest.current) return;
    setBusy(true); setStatus("");
    try {
      const result = await request("", { threadId, messageId: message.id, workOrderId: selected.id });
      if (!alive.current) return;
      setStatus(result.saved ? `Saved to ${result.jobNumber}. Open the job's Files section to view it.` : `Already saved to ${result.jobNumber}.`);
      setOpen(false);
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "The job files could not be saved."); }
    finally { if (alive.current) setBusy(false); }
  }

  return <div className={styles.root}>
    <button type="button" className={styles.trigger} disabled={busy} aria-expanded={open} onClick={() => {
      setOpen(value => !value); setStatus(""); setTimeout(() => searchRef.current?.focus(), 0);
    }}>Save to job</button>
    {open && <section className={styles.panel} aria-labelledby={labelId}>
      <strong id={labelId}>Save {count} chat {count === 1 ? "item" : "items"} to a job</strong>
      <p>Saved files can be seen by teammates who can access that job.</p>
      <form className={styles.search} onSubmit={search}>
        <label><span>Job number</span><input ref={searchRef} value={query} maxLength={80} placeholder="e.g. TLJ-00001234"
          onChange={event => { setQuery(event.target.value); setSelected(null); setSearched(false); setJobs([]); }} disabled={busy} /></label>
        <button type="submit" disabled={busy || !query.trim()}>{busy && !selected ? "Searching..." : "Search"}</button>
      </form>
      <div className={styles.jobs}>{jobs.map(job => <button type="button" key={job.id} disabled={busy}
        aria-pressed={selected?.id === job.id} onClick={() => setSelected(job)}>{job.jobNumber}</button>)}</div>
      {searched && !jobs.length && <p>No matching jobs you can save files to.</p>}
      <div className={styles.actions}><button type="button" disabled={busy || !selected} onClick={() => void save()}>{busy && selected ? "Saving..." : "Save to selected job"}</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </section>}
    {status && <p className={styles.status} role="status">{status}</p>}
  </div>;
}
