"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { JobStockRequirement, JobStockResponse, JobStockSummary, StockMutation } from "@/lib/trade-stock";
import styles from "./TradeStockJobPanel.module.css";

const quantity = (milli: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(milli / 1000);

export function TradeStockJobPanel({ user, workOrderId, refreshKey, disabled = false }: {
  user: User; workOrderId: string; refreshKey: number; disabled?: boolean;
}) {
  const [job, setJob] = useState<JobStockSummary | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<StockMutation | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-stock?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
    });
    const result: JobStockResponse = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Stock could not be checked.");
    return result.job;
  }, [user, workOrderId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((result) => {
      if (!controller.signal.aborted) { setJob(result); setError(""); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Stock could not be checked.");
    });
    return () => controller.abort();
  }, [load, refreshKey]);

  async function refresh() { setJob(await load()); setError(""); }

  async function save(input: StockMutation) {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    pending.current = input;
    setBusy(true); setRetry(false); setMessage(""); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-stock", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      const result: JobStockResponse = await response.json();
      if (!response.ok || !result.ok) {
        pending.current = null;
        let detail = result.error || "Stock could not be updated.";
        if (response.status === 409) {
          try { await refresh(); } catch { detail += " Refresh to check the current count."; }
        }
        setError(detail);
        return;
      }
      pending.current = null;
      setJob(result.job);
      setMessage(input.action === "release" ? "Stock released for other jobs." : "Stock allocated to this job.");
    } catch {
      setRetry(true);
      setError("The update could not be confirmed. Retry safely to check it without allocating twice.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  function allocate(item: JobStockRequirement, release = false) {
    void save({
      action: release ? "release" : "reserve", itemId: item.itemId, requirementId: item.requirementId,
      workOrderId, operationId: crypto.randomUUID(), expectedRevision: item.revision,
      quantityMilli: release ? 0 : Math.min(item.remainingMilli, item.reservedMilli + Math.max(0, item.availableMilli)),
    });
  }

  if (!job && !error) return null;
  if (job && job.requirements.length === 0 && !error) return null;
  return <section className={styles.panel} aria-label="Stock for this job">
    <div className={styles.heading}><div><h4>Stock for this job</h4><p>Accepted quotes allocate available stock. Use the work checklist below to record what was used.</p></div>
      <button type="button" disabled={busy || disabled} onClick={() => void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Stock could not be checked."))}>Refresh</button>
    </div>
    {job?.requirements.map((item) => {
      const remaining = item.remainingMilli;
      const canAllocate = item.reservedMilli < remaining && item.availableMilli > 0;
      return <div className={styles.item} key={item.requirementId}>
        <div className={styles.description}><strong>{item.description}</strong><span>{quantity(remaining)} {item.unitLabel} needed{item.usedMilli > 0 ? ` · ${quantity(item.usedMilli)} used` : ""}</span></div>
        <div className={styles.counts}><span><b>{quantity(item.reservedMilli)}</b> allocated</span><span><b>{quantity(Math.max(0, item.availableMilli))}</b> available</span>
          {item.shortageMilli > 0 ? <span className={styles.shortage}>Need to buy {quantity(item.shortageMilli)} {item.unitLabel}</span> : <span className={styles.ready}>{remaining === 0 ? "Use recorded" : "In stock"}</span>}
        </div>
        {job.canManage && <div className={styles.actions}>
          {canAllocate && <button type="button" disabled={busy || disabled || retry} onClick={() => allocate(item)}>Allocate{item.reservedMilli + item.availableMilli < remaining ? " available" : " to job"}</button>}
          {item.reservedMilli > 0 && <button type="button" disabled={busy || disabled || retry} onClick={() => allocate(item, true)}>Release</button>}
        </div>}
      </div>;
    })}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {retry && <button type="button" disabled={busy || disabled} onClick={() => { if (pending.current) void save(pending.current); }}>{busy ? "Checking..." : "Retry update"}</button>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>;
}
