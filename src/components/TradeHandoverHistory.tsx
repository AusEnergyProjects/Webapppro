"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./TradeHandoverHistory.module.css";

type HistoryAsset = { id: string; brand: string; modelNumber: string; serialNumber: string; quantity: number; installedAt: string; warrantyProvider: string; warrantyReference: string; warrantyStart: string; warrantyEnd: string };
type HistoryDocument = { id: string; category: string; fileName: string; sizeBytes: number; createdAt: string };
type HistoryPack = { status: string; reviewNote: string; publishedAt: string; submittedAt: string; assets: HistoryAsset[]; complianceItems: Array<{ id: string; label: string; status: string }>; documents: HistoryDocument[] };
type HistoryResponse = { ok?: boolean; pack?: HistoryPack | null; error?: string };
const statuses: Record<string, string> = { draft: "Saved draft", submitted: "Submitted for review", changes_requested: "Changes requested", published: "Published record", rejected: "Review closed" };
const date = (value: string) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC" }) : "Not recorded";

/** Existing records only. New work is recorded through job Files. */
export function TradeHandoverHistory({ user, workOrderId }: { user: User; workOrderId: string }) {
  const request = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; pack: HistoryPack | null; error: string } | null>(null);
  const [downloadState, setDownloadState] = useState<{ key: string; id: string; error: string } | null>(null);
  const downloadRequest = useRef<AbortController | null>(null);
  const key = `${user.uid}|${business?.ownerUid || ""}|${workOrderId}|${attempt}`;
  const loading = open && result?.key !== key;
  const pack = open && result?.key === key ? result.pack : null;
  const error = open && result?.key === key ? result.error : "";
  const busy = open && downloadState?.key === key ? downloadState.id : "";
  const downloadError = open && downloadState?.key === key ? downloadState.error : "";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); setResult({ key, pack: null, error: "These records are taking too long to load. Please try again." }); }, 25000);
    void (async () => {
      try {
        const token = await user.getIdToken(); if (controller.signal.aborted) return;
        const response = await request(`/api/trade-handover?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const body: HistoryResponse = await response.json(); if (controller.signal.aborted) return;
        if (!response.ok || body.ok !== true) throw new Error(body.error || "The saved completion records could not be loaded.");
        setResult({ key, pack: body.pack || null, error: "" });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key, pack: null, error: failure instanceof Error ? failure.message : "The saved completion records could not be loaded." });
      } finally { clearTimeout(timer); }
    })();
    return () => {
      clearTimeout(timer); controller.abort();
      downloadRequest.current?.abort(); downloadRequest.current = null;
    };
  }, [key, open, request, user, workOrderId]);

  async function download(document: HistoryDocument) {
    if (!open || !pack || downloadRequest.current) return;
    const controller = new AbortController(); downloadRequest.current = controller;
    const timer = setTimeout(() => {
      if (downloadRequest.current !== controller) return;
      controller.abort(); downloadRequest.current = null;
      setDownloadState({ key, id: "", error: "This document is taking too long to download. Please try again." });
    }, 25000);
    setDownloadState({ key, id: document.id, error: "" });
    try {
      const token = await user.getIdToken(); if (controller.signal.aborted) return;
      const response = await request(`/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error("This saved document could not be downloaded. Refresh the records and try again.");
      const blob = await response.blob(); if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a"); link.href = url; link.download = document.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadState({ key, id: "", error: "" });
    } catch (failure) {
      if (!controller.signal.aborted) setDownloadState({ key, id: "", error: failure instanceof Error ? failure.message : "This saved document could not be downloaded." });
    } finally {
      clearTimeout(timer);
      if (downloadRequest.current === controller) downloadRequest.current = null;
    }
  }

  return <details className={styles.history} open={open} onToggle={event => {
    const next = event.currentTarget.open;
    if (next !== open) { setOpen(next); if (next) setAttempt(value => value + 1); }
  }}>
    <summary>Earlier completion records</summary>
    {open && <div className={styles.body}>
      <p>Saved assets, checklists and documents from earlier handovers.</p>
      {loading && <p role="status">Loading saved records...</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {!loading && !error && !pack && <p>No earlier completion record was found for this job.</p>}
      {pack && <>
        <header><strong>{statuses[pack.status] || "Saved record"}</strong><button type="button" disabled={Boolean(busy)} onClick={() => setAttempt(value => value + 1)}>Refresh records</button></header>
        {pack.reviewNote && <p><strong>Review note:</strong> {pack.reviewNote}</p>}
        {pack.assets.length > 0 && <section><h4>Installed assets</h4>{pack.assets.map(asset => <article key={asset.id} className={styles.asset}>
          <strong>{asset.brand} {asset.modelNumber}</strong><span>{asset.serialNumber ? `Serial ${asset.serialNumber} · ` : ""}Quantity {asset.quantity}</span>
          <dl><div><dt>Installed</dt><dd>{date(asset.installedAt)}</dd></div><div><dt>Warranty</dt><dd>{asset.warrantyProvider || "Not recorded"}{asset.warrantyReference ? ` · ${asset.warrantyReference}` : ""}</dd></div>
            {(asset.warrantyStart || asset.warrantyEnd) && <div><dt>Warranty dates</dt><dd>{date(asset.warrantyStart)} to {date(asset.warrantyEnd)}</dd></div>}</dl>
        </article>)}</section>}
        {pack.complianceItems.length > 0 && <section><h4>Saved checklist</h4><ul className={styles.list}>{pack.complianceItems.map(item => <li key={item.id}><span>{item.label}</span><strong>{item.status === "complete" ? "Complete" : item.status === "not_applicable" ? "Not applicable" : "Pending"}</strong></li>)}</ul></section>}
        <section><h4>Saved documents</h4>{pack.documents.length ? <ul className={styles.list}>{pack.documents.map(document => <li key={document.id}><span><strong>{document.fileName}</strong><small>{date(document.createdAt)} · {(document.sizeBytes / 1024).toLocaleString("en-AU", { maximumFractionDigits: 0 })} KB</small></span><button type="button" disabled={Boolean(busy)} onClick={() => void download(document)}>{busy === document.id ? "Downloading..." : "Download"}</button></li>)}</ul> : <p>No documents were attached to this record.</p>}</section>
      </>}
      {downloadError && <p role="alert">{downloadError}</p>}
    </div>}
  </details>;
}
