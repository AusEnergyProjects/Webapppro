"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { isMapQuoteJob, MAP_QUOTE_UNITS, type MapQuoteIntent, type MapQuoteJob, type MapQuoteMeasurement } from "@/lib/trade-map-quote";
import { TradeQuotePanel } from "./TradeQuotePanel";
import { TradeMapNewQuote } from "./TradeMapNewQuote";
import styles from "./TradeMapQuoteDialog.module.css";

export type MapQuoteAccess = { canCreate: boolean; canCreateCustomer: boolean; canSend: boolean };
type QuoteIndex = { ok?: boolean; error?: string; items?: unknown[]; pagination?: { hasNext: boolean; nextCursor: string; pageCount: number } };

function QuotePicker({ user, onSelect }: { user: User; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [navigation, setNavigation] = useState({ search: "", page: 1, cursors: [""] });
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; jobs: MapQuoteJob[]; pagination?: QuoteIndex["pagination"]; error: string }>({ key: "", jobs: [], error: "" });
  const cursor = navigation.cursors[navigation.page - 1];
  const key = JSON.stringify([user.uid, navigation.search, navigation.page, cursor, refresh]);
  const loading = result.key !== key;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      controller.abort();
      if (active) setResult({ key, jobs: [], error: "Quotes took too long to load. Try again." });
    }, 25000);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const params = new URLSearchParams({ mode: "index", resource: "jobs", filter: "all", sort: "updated-desc", search: navigation.search, page: String(navigation.page), pageSize: "25" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const data: QuoteIndex = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not load quotes.");
        if (!Array.isArray(data.items) || !data.pagination || (data.pagination.hasNext && !data.pagination.nextCursor)) throw new Error("Could not load the quote list. Try again.");
        if (active && !controller.signal.aborted) setResult({ key, jobs: data.items.filter(isMapQuoteJob), pagination: data.pagination, error: "" });
      } catch (error) {
        if (active && !controller.signal.aborted) setResult({ key, jobs: [], error: error instanceof Error ? error.message : "Could not load quotes." });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [user, navigation.search, navigation.page, cursor, key]);
  function find(event: FormEvent) { event.preventDefault(); setNavigation({ search: search.trim(), page: 1, cursors: [""] }); }
  return <div className={styles.picker}>
    <form onSubmit={find} className={styles.search}>
      <label>Find a customer, quote or job<input autoFocus type="search" maxLength={100} placeholder="Customer name or job number" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button type="submit">Search</button>
    </form>
    <p>Choose the matching customer and address. Jobs without a quote can start one here.</p>
    {loading ? <p role="status">Loading your jobs and quotes…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : <>
      <div className={styles.jobs}>
        {result.jobs.map((job) => <button key={job.id} type="button" onClick={() => onSelect(job.id)}>
          <span><strong>{job.customerDisplayName || job.title}</strong><small>{job.workNumber} · {job.title}</small><small>{[job.jobRegister.streetAddress, job.jobRegister.suburb, job.jobRegister.state, job.jobRegister.postcode].filter(Boolean).join(", ")}</small></span>
          <span>{job.quoteStatus === "not_started" ? "Start quote" : "Add to quote"} →</span>
        </button>)}
        {!result.jobs.length && <p>No available jobs on this page. Search for a customer or start a new quote.</p>}
      </div>
      {result.pagination && <nav aria-label="Quote pages" className={styles.pages}>
        <button type="button" disabled={navigation.page === 1} onClick={() => setNavigation((value) => ({ ...value, page: value.page - 1 }))}>Previous</button>
        <span>Page {navigation.page} of {Math.max(1, result.pagination.pageCount)}</span>
        <button type="button" disabled={!result.pagination.hasNext} onClick={() => setNavigation((value) => ({ ...value, page: value.page + 1, cursors: [...value.cursors.slice(0, value.page), result.pagination?.nextCursor || ""] }))}>Next</button>
      </nav>}
    </>}
  </div>;
}

export function TradeMapQuoteDialog({ user, measurement, access, onClose }: { user: User; measurement: MapQuoteMeasurement; access: MapQuoteAccess; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [intent, setIntent] = useState<MapQuoteIntent | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardTo, setDiscardTo] = useState<"map" | "existing" | null>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { if (discardTo) keepEditing.current?.focus(); }, [discardTo]);
  function close() { if (busy) return; if (dirty) setDiscardTo("map"); else onClose(); }
  function select(workOrderId: string) { setDirty(false); setIntent({ id: crypto.randomUUID(), ownerUid: user.uid, workOrderId, measurement }); }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="map-quote-title" onCancel={(event) => {
    event.preventDefault();
    if (dialog.current?.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (discardTo) setDiscardTo(null); else close();
  }}>
    <header className={styles.header}>
      <div><h2 id="map-quote-title">{intent ? "Build your quote" : "Add to quote"}</h2><p><strong>{measurement.quantity.toLocaleString("en-AU")} {MAP_QUOTE_UNITS[measurement.kind]}</strong> from your map{measurement.roofImage ? " · Map image included" : ""} · Review the quantity and add your price.</p></div>
      <button type="button" disabled={busy} onClick={close}>Back to map</button>
    </header>
    {discardTo && <div className={styles.confirm} role="alert"><strong>Leave without saving these changes?</strong><p>Your map stays open. Any customer or job already created will remain in your workspace.</p><div><button ref={keepEditing} type="button" onClick={() => setDiscardTo(null)}>Keep editing</button><button type="button" onClick={() => {
      if (discardTo === "map") onClose(); else { setMode("existing"); setDirty(false); setDiscardTo(null); }
    }}>Discard unsaved changes</button></div></div>}
    <div className={styles.content} inert={Boolean(discardTo)}>
      {intent ? <TradeQuotePanel key={intent.id} user={user} workOrderId={intent.workOrderId} available canSend={access.canSend} mapQuoteIntent={intent} showLivePreview onDraftDirtyChange={setDirty} onBusyChange={setBusy} /> : <>
        <div className={styles.tabs} role="group" aria-label="Quote destination">
          <button type="button" aria-pressed={mode === "existing"} disabled={busy} onClick={() => { if (dirty && mode !== "existing") setDiscardTo("existing"); else setMode("existing"); }}>Existing job or quote</button>
          {access.canCreate && <button type="button" aria-pressed={mode === "new"} disabled={busy} onClick={() => setMode("new")}>New quote</button>}
        </div>
        {mode === "existing" ? <QuotePicker user={user} onSelect={select} /> : <TradeMapNewQuote user={user} canCreateCustomer={access.canCreateCustomer} measurementKind={measurement.kind} onCreated={select} onBusyChange={setBusy} onDirtyChange={setDirty} />}
      </>}
    </div>
  </dialog>;
}
