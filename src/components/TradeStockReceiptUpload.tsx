"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { MAX_RECEIPT_BYTES, receiptQuantityMilli, type ReceiptProduct, type StockReceipt } from "@/lib/trade-stock-receipts";
import type { StockLocation } from "@/lib/trade-stock";
import styles from "./TradeStockReceiptUpload.module.css";

type Workspace = { ok: boolean; products: ReceiptProduct[]; locations: StockLocation[]; receipts: StockReceipt[]; receipt: StockReceipt | null; error?: string };
type Line = { id: string; description: string; documentUnit: string; itemId: string; quantity: string };
export function TradeStockReceiptUpload({ user, onReceived }: { user: User; onReceived: () => void }) {
  const fetch = useTradeBusinessFetch();
  const [open, setOpen] = useState(false), [workspace, setWorkspace] = useState<Workspace | null>(null), [receipt, setReceipt] = useState<StockReceipt | null>(null);
  const [lines, setLines] = useState<Line[]>([]), [supplier, setSupplier] = useState(""), [reference, setReference] = useState(""), [location, setLocation] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [confirmed, setConfirmed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const request = useCallback(async (suffix = "", init: RequestInit = {}) => {
    const response = await fetch(`/api/trade-stock/receipts${suffix}`, { ...init, headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...init.headers }, cache: "no-store" });
    const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || "Stock documents could not be loaded."); return result;
  }, [fetch, user]);
  function selectReceipt(value: StockReceipt | null) {
    setReceipt(value); setConfirmed(false); setError(""); setPendingConfirmation(null);
    setSupplier(value?.confirmed?.supplier || value?.extraction.supplier || ""); setReference(value?.confirmed?.reference || value?.extraction.reference || "");
    setLines(value?.lines.map(line => ({ id: crypto.randomUUID(), description: line.description, documentUnit: line.unit, itemId: line.itemId, quantity: String(line.quantityMilli / 1000) })) || []);
  }
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void request().then((value: Workspace) => { if (!stopped) { setWorkspace(value); setLocation(current => current || value.locations.find(item => item.isDefault)?.id || ""); } }).catch(failure => { if (!stopped) setError(failure.message); });
    return () => { stopped = true; };
  }, [open, request]);
  async function upload(file: File | undefined) {
    if (!file || busy || pendingConfirmation) return;
    setError(""); setMessage("");
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > MAX_RECEIPT_BYTES) { setError("Choose a PDF smaller than 8 MB, with 20 pages or fewer."); return; }
    setBusy("Reading document…");
    try { const result: Workspace = await request(`?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file }); setWorkspace(result); setLocation(current => current || result.locations.find(item => item.isDefault)?.id || ""); selectReceipt(result.receipt); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Document could not be read."); }
    finally { setBusy(""); if (input.current) input.current.value = ""; }
  }
  async function receive() {
    if (!receipt || !workspace || busy || (!confirmed && !pendingConfirmation)) return;
    setBusy("Receiving stock…"); setError("");
    try {
      const payload = pendingConfirmation || JSON.stringify({ receiptId: receipt.id, locationId: location, supplier, reference, confirmReceived: true,
        lines: lines.map(line => ({ itemId: line.itemId, quantityMilli: receiptQuantityMilli(line.quantity), expectedRevision: workspace.products.find(product => product.id === line.itemId)?.revision })) });
      setPendingConfirmation(payload);
      await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      const next: Workspace = await request(`?receiptId=${encodeURIComponent(receipt.id)}`); setWorkspace(next); selectReceipt(next.receipt); setMessage("Stock received. Counts and receipt history are saved."); onReceived();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The result is not confirmed. Refresh this receipt before trying again."); }
    finally { setBusy(""); }
  }
  async function refresh() {
    setBusy("Refreshing…"); setError("");
    try { const next: Workspace = await request(receipt ? `?receiptId=${encodeURIComponent(receipt.id)}` : ""); setWorkspace(next); if (next.receipt?.status === "received") { selectReceipt(next.receipt); onReceived(); } setConfirmed(false); setPendingConfirmation(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh."); } finally { setBusy(""); }
  }
  async function download() {
    if (!receipt) return;
    setBusy("Opening PDF…");
    try {
      const response = await fetch(`/api/trade-stock/receipts?receiptId=${encodeURIComponent(receipt.id)}&download=1`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error("The saved PDF could not be opened.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = receipt.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open PDF."); } finally { setBusy(""); }
  }
  return <section className={styles.root}>
    <button type="button" className={styles.launch} aria-expanded={open} onClick={() => setOpen(value => !value)}>Receive from supplier PDF</button>
    {open && <div className={styles.panel}>
      <header><div><h4>Receive a delivery</h4><p>Upload a supplier PDF, check the items, then confirm what arrived.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Close</button></header>
      {!receipt && <div className={styles.drop} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept="application/pdf,.pdf" aria-label="Supplier document PDF" disabled={Boolean(busy)} onChange={event => void upload(event.target.files?.[0])} />
        <strong>Drop a PDF here or choose a file</strong><p>Invoice, purchase order or delivery docket. Any supplier.</p><small>AI reads the PDF using OpenAI. Review the result before stock changes. Up to 8 MB and 20 pages.</small>
      </div>}
      {receipt && <><div className={styles.receiptHeading}><strong>{receipt.fileName}</strong><span>{receipt.status === "received" ? "Received" : "Review"}</span><button type="button" disabled={Boolean(busy)} onClick={() => void download()}>View PDF</button><button type="button" disabled={Boolean(busy) || Boolean(pendingConfirmation)} onClick={() => selectReceipt(null)}>Another document</button></div>
        {receipt.status === "received" ? <><p>Received {new Date(receipt.receivedAt).toLocaleString("en-AU")}. This document cannot add the stock a second time.</p><p>{receipt.confirmed?.supplier} {receipt.confirmed?.reference ? `| ${receipt.confirmed.reference}` : ""}</p><ul className={styles.history}>{receipt.confirmed?.lines.map(line => <li key={line.itemId}><span>{line.name}</span><strong>{line.quantityMilli / 1000} {line.unit}</strong></li>)}</ul></> : <>
          {receipt.analysisError && <p className={styles.warning}>{receipt.analysisError}</p>}
          {receipt.extraction.warnings.map((warning, index) => <p className={styles.warning} key={index}>{warning}</p>)}
          <p className={styles.hint}>Check the product units. A box on the document may contain several items. Remove rows that have not arrived.</p>
          <fieldset disabled={Boolean(busy) || Boolean(pendingConfirmation)}><div className={styles.fields}><label><span>Supplier</span><input maxLength={180} value={supplier} onChange={event => setSupplier(event.target.value)} /></label><label><span>Document reference</span><input maxLength={120} value={reference} onChange={event => setReference(event.target.value)} /></label><label><span>Received at</span><select value={location} onChange={event => setLocation(event.target.value)}>{workspace?.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <div className={styles.rows}>{lines.map(line => <div className={styles.row} key={line.id}><label><span>{line.description || "Product"}{line.documentUnit ? ` (${line.documentUnit} on PDF)` : ""}</span><select value={line.itemId} onChange={event => setLines(current => current.map(item => item.id === line.id ? { ...item, itemId: event.target.value } : item))}><option value="">Choose your product</option>{workspace?.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.code} · {product.unit}</option>)}</select></label><label><span>Received ({workspace?.products.find(product => product.id === line.itemId)?.unit || "units"})</span><input type="number" min=".001" max="1000000" step=".001" value={line.quantity} onChange={event => setLines(current => current.map(item => item.id === line.id ? { ...item, quantity: event.target.value } : item))} /></label><button type="button" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>Remove</button></div>)}</div>
          <button type="button" disabled={lines.length >= 50} onClick={() => setLines(current => [...current, { id: crypto.randomUUID(), description: "", documentUnit: "", itemId: "", quantity: "1" }])}>Add item</button>
          <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>These goods have arrived. Add these quantities to stock.</span></label></fieldset>
          <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || (!pendingConfirmation && (!confirmed || !location || !lines.length || lines.some(line => !line.itemId || !/^\d{1,7}(?:\.\d{1,3})?$/.test(line.quantity) || !(Number(line.quantity) > 0) || Number(line.quantity) > 1000000)))} onClick={() => void receive()}>{pendingConfirmation ? "Retry same confirmation" : "Confirm received"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh stock counts</button></div>
        </>}
      </>}
      {!receipt && Boolean(workspace?.receipts.length) && <details><summary>Recent supplier documents</summary><ul className={styles.history}>{workspace?.receipts.map(item => <li key={item.id}><button type="button" disabled={Boolean(busy)} onClick={() => selectReceipt(item)}>{item.fileName}</button><span>{item.status === "received" ? "Received" : "Review"}</span></li>)}</ul></details>}
      {pendingConfirmation && !busy && <p className={styles.warning}>Check this receipt with Refresh stock counts, or retry the same confirmation. Your quantities are locked until its result is confirmed.</p>}{busy && <p role="status">{busy}</p>}{error && <p className={styles.error} role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>}
  </section>;
}
