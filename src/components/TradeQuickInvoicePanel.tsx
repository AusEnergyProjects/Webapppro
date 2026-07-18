"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

type Line = { lineId: string; description: string; subtotalCents: number; taxCode: "gst" | "none" };
type QuickInvoice = { id: string; invoiceNumber: string; lines: Line[]; subtotalCents: number; taxCents: number; totalCents: number; dueAt: string; status: string; deliveryStatus: string; attempts: number; sentAt: string };

function money(cents: number) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }

export function TradeQuickInvoicePanel({ user, workOrderId, onChanged }: { user: User; workOrderId: string; onChanged: () => Promise<void> }) {
  const [invoice, setInvoice] = useState<QuickInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-quick-invoices?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as { invoice?: QuickInvoice | null; error?: string };
    if (!response.ok) throw new Error(result.error || "Quick invoice could not be loaded.");
    setInvoice(result.invoice || null);
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Quick invoice could not be loaded."); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [load]);

  async function retry() {
    if (!invoice) return;
    setBusy(true); setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-quick-invoices", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "retry_delivery", invoiceId: invoice.id, consentConfirmed: true }) });
      const result = await response.json() as { invoice?: QuickInvoice; error?: string };
      if (!response.ok) throw new Error(result.error || "The invoice email could not be sent.");
      if (result.invoice) setInvoice(result.invoice);
      setStatus("Invoice sent."); await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The invoice email could not be sent."); }
    finally { setBusy(false); }
  }

  if (loading) return null;
  if (!invoice) return status ? <p className="crm-status" role="status">{status}</p> : null;
  return <section className="crm-quick-invoice-panel">
    <header><div><span>TLink quick invoice</span><h4>{invoice.invoiceNumber}</h4><p>{invoice.deliveryStatus === "sent" ? `Sent ${new Date(invoice.sentAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : "Saved in this job and waiting to be sent."}</p></div><strong>{invoice.deliveryStatus === "sent" ? "Sent" : "Needs attention"}</strong></header>
    <div className="crm-quick-invoice-lines">{invoice.lines.map((line) => <div key={line.lineId}><span>{line.description}<small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><strong>{money(line.subtotalCents)}</strong></div>)}</div>
    <dl><div><dt>Subtotal</dt><dd>{money(invoice.subtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(invoice.taxCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoice.totalCents)}</dd></div><div><dt>Due</dt><dd>{invoice.dueAt}</dd></div></dl>
    {invoice.deliveryStatus !== "sent" && <button type="button" className="btn" disabled={busy} onClick={() => void retry()}>{busy ? "Sending..." : "Retry invoice email"}</button>}
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}
