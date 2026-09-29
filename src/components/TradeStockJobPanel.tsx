"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { JobStockRequirement, JobStockResponse, JobStockSummary, StockMutation } from "@/lib/trade-stock";
import styles from "./TradeStockJobPanel.module.css";

const quantity = (milli: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(milli / 1000);

export function TradeStockJobPanel({ user, workOrderId, job, onChanged, disabled = false }: {
  user: User; workOrderId: string; job: JobStockSummary | null; onChanged: (job: JobStockSummary) => void; disabled?: boolean;
}) {
  const fetch = useTradeBusinessFetch();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<StockMutation | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function load(signal?: AbortSignal) {
    const token = await user.getIdToken();
    if (signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
    const response = await fetch(`/api/trade-stock?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
    });
    const result: JobStockResponse = await response.json();
    if (!response.ok || !result.ok || result.job?.workOrderId !== workOrderId) throw new Error(result.error || "Stock could not be checked.");
    return result.job;
  }

  async function refresh(signal?: AbortSignal) { const next = await load(signal); if (!signal?.aborted) { onChanged(next); setError(""); } }

  async function refreshCurrent() {
    if (inFlight.current || disabled || retry) return;
    inFlight.current = true;
    const request = new AbortController(); controller.current = request;
    setBusy(true);
    try { await refresh(request.signal); }
    catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Stock could not be checked."); }
    finally { inFlight.current = false; if (!request.signal.aborted) setBusy(false); }
  }

  async function save(input: StockMutation) {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    const request = new AbortController(); controller.current = request;
    pending.current = input;
    setBusy(true); setRetry(false); setMessage(""); setError("");
    try {
      const token = await user.getIdToken();
      if (request.signal.aborted) return;
      const response = await fetch("/api/trade-stock", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input), signal: request.signal,
      });
      const result: JobStockResponse = await response.json();
      if (request.signal.aborted) return;
      if (response.status >= 500) throw new Error("The update was not confirmed.");
      if (!response.ok || !result.ok || result.job?.workOrderId !== workOrderId) {
        pending.current = null;
        let detail = result.error || "Stock could not be updated.";
        if (response.status === 409) {
          try { await refresh(request.signal); } catch { detail += " Refresh to check the current count."; }
        }
        if (request.signal.aborted) return;
        setError(detail);
        return;
      }
      pending.current = null;
      onChanged(result.job);
      setMessage(input.action === "release" ? "Stock commitment released." : "Stock committed to this job.");
    } catch {
      if (request.signal.aborted) return;
      setRetry(true);
      setError("The update could not be confirmed. Retry safely to check it without committing twice.");
    } finally { inFlight.current = false; if (!request.signal.aborted) setBusy(false); }
  }

  function commit(item: JobStockRequirement, release = false) {
    void save({
      action: release ? "release" : "reserve", itemId: item.itemId, requirementId: item.requirementId,
      workOrderId, operationId: crypto.randomUUID(), expectedRevision: item.revision,
      quantityMilli: release ? 0 : item.remainingMilli,
    });
  }

  if (!job && !error) return null;
  if (job && job.requirements.length === 0 && !error) return null;
  return <section className={styles.panel} aria-label="Stock for this job">
    <div className={styles.heading}><div><h4>Stock for this job</h4><p>Accepted quotes commit the full quantity. Negative availability shows what needs buying. Record actual use below.</p></div>
      <button type="button" disabled={busy || disabled || retry} onClick={() => void refreshCurrent()}>Refresh</button>
    </div>
    {job?.requirements.map((item) => {
      const remaining = item.remainingMilli;
      const canCommit = item.reservedMilli < remaining;
      return <div className={styles.item} key={item.requirementId}>
        <div className={styles.description}><strong>{item.description}</strong><span>{quantity(remaining)} {item.unitLabel} needed{item.usedMilli > 0 ? ` · ${quantity(item.usedMilli)} used` : ""}</span></div>
        <div className={styles.counts}><span><b>{quantity(item.reservedMilli)}</b> committed</span><span className={item.availableMilli < 0 ? styles.shortage : undefined}><b>{quantity(item.availableMilli)}</b> available</span>
          {item.shortageMilli > 0 ? <span className={styles.shortage}>Need to buy {quantity(item.shortageMilli)} {item.unitLabel}</span> : <span className={styles.ready}>{remaining === 0 ? "Use recorded" : "In stock"}</span>}
        </div>
        {job.canManage && <div className={styles.actions}>
          {canCommit && <button type="button" disabled={busy || disabled || retry} onClick={() => commit(item)}>Commit to job</button>}
          {item.reservedMilli > 0 && <button type="button" disabled={busy || disabled || retry} onClick={() => commit(item, true)}>Release</button>}
        </div>}
      </div>;
    })}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {retry && <button type="button" disabled={busy || disabled} onClick={() => { if (pending.current) void save(pending.current); }}>{busy ? "Checking..." : "Retry update"}</button>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
