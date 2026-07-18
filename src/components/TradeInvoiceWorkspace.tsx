"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type InvoiceItem = {
  id: string; workNumber: string; title: string; customerName: string; protectedJob: boolean;
  stage: string; status: string; invoiceStatus: string; commercialReference: string;
  totalCents: number; paidCents: number; outstandingCents: number; provider: string;
  externalNumber: string; externalUrl: string; lastError: string; acceptedAt: string; updatedAt: string;
};
type InvoiceResult = {
  ok?: boolean; error?: string; invoices?: InvoiceItem[];
  metrics?: { ready: number; attention: number; paid: number; outstandingCents: number };
};

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const statusLabels: Record<string, string> = {
  ready: "Ready to prepare", draft: "Draft", issued: "Awaiting payment", part_paid: "Part paid",
  paid: "Paid", overdue: "Overdue", attention: "Needs attention", not_ready: "Job still underway",
  exporting: "Preparing export", void: "Void",
};

export function TradeInvoiceWorkspace({ user, onOpenJob }: { user: User; onOpenJob: (workOrderId: string) => void }) {
  const [data, setData] = useState<InvoiceResult>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<"action" | "all" | "paid">("action");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-invoices", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as InvoiceResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "Invoices could not be loaded.");
    setData(result);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Invoices could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  const query = search.trim().toLowerCase();
  const invoices = useMemo(() => (data.invoices || []).filter((item) => {
    if (query && !`${item.workNumber} ${item.title} ${item.customerName} ${item.externalNumber}`.toLowerCase().includes(query)) return false;
    if (filter === "paid") return item.status === "paid";
    if (filter === "action") return !["paid", "not_ready"].includes(item.status);
    return true;
  }), [data.invoices, filter, query]);
  const metrics = data.metrics || { ready: 0, attention: 0, paid: 0, outstandingCents: 0 };

  if (loading) return <section className="dashboard-panel invoice-workspace"><div className="crm-empty"><strong>Opening invoices</strong><span>Loading current job and accounting records.</span></div></section>;
  return <section className="dashboard-panel invoice-workspace">
    <header className="invoice-heading"><div><span>Invoices</span><h2>Get paid without retyping the job</h2><p>Open a job to preview the exact accepted scope, then create or check its accounting draft.</p></div></header>
    <section className="invoice-metrics" aria-label="Invoice summary">
      <article><span>Ready</span><strong>{metrics.ready}</strong><small>Accepted work to prepare</small></article>
      <article className={metrics.attention ? "attention" : ""}><span>Needs attention</span><strong>{metrics.attention}</strong><small>Provider or overdue issue</small></article>
      <article><span>Paid</span><strong>{metrics.paid}</strong><small>Recorded as paid</small></article>
      <article className={metrics.outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(metrics.outstandingCents)}</strong><small>Across accepted jobs</small></article>
    </section>
    <div className="invoice-toolbar">
      <label><span>Find an invoice or job</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job number, customer or invoice" /></label>
      <div role="group" aria-label="Filter invoices">{([['action', 'Action needed'], ['all', 'All'], ['paid', 'Paid']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
    </div>
    <div className="invoice-list" role="list" aria-label="Invoice jobs">
      {invoices.length ? invoices.map((item) => <article key={item.id} role="listitem" tabIndex={0}
        onDoubleClick={() => onOpenJob(item.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpenJob(item.id); }}>
        <div><span>{item.workNumber}</span><strong>{item.title}</strong><small>{item.customerName}</small></div>
        <div><span>Invoice</span><strong>{item.externalNumber || item.commercialReference || "Not created"}</strong><small>{item.provider ? `${item.provider.toUpperCase()} | ${statusLabels[item.status] || item.status}` : statusLabels[item.status] || item.status}</small></div>
        <div><span>Total</span><strong>{item.totalCents ? money(item.totalCents) : "Not ready"}</strong><small>{item.outstandingCents ? `${money(item.outstandingCents)} outstanding` : item.paidCents ? "Paid in full" : "No balance yet"}</small></div>
        <button type="button" onClick={() => onOpenJob(item.id)}>{item.totalCents ? "Open invoice" : "Open job"}</button>
      </article>) : <div className="crm-empty"><strong>No invoices in this view</strong><span>Try All, or finish an accepted job to prepare its invoice.</span></div>}
    </div>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
