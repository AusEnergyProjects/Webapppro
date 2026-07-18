"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { TradeAccountingPanel } from "./TradeAccountingPanel";
import { TradePaymentPanel } from "./TradePaymentPanel";

type ScopeLine = { lineId: string; section: string; description: string; quantityMilli: number; totalCents: number };
type Handoff = {
  id: string; commercialReference: string; scope: ScopeLine[]; terms: string; subtotalCents: number; taxCents: number; totalCents: number;
  depositKind: "percentage" | "fixed"; depositBasisPoints: number; depositFixedCents: number; depositAmountCents: number;
  status: string; acceptedAt: string;
};
type TimelineEvent = { type: string; status: string; provider: string; summary: string; occurredAt: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);

export function TradeCommercialHandoffPanel({ user, workOrderId, isProtected, hasDirectCustomer, customerName, jobTitle, onOpenIntegrations, onChanged }: {
  user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean; customerName: string; jobTitle: string; onOpenIntegrations: () => void; onChanged: () => Promise<void>;
}) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [depositKind, setDepositKind] = useState<"percentage" | "fixed">("percentage");
  const [depositValue, setDepositValue] = useState("10");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    if (isProtected || !hasDirectCustomer) return;
    const token = await user.getIdToken(); const query = new URLSearchParams({ workOrderId });
    const response = await fetch(`/api/trade-commercial-handoff?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { handoff?: Handoff | null; timeline?: TimelineEvent[]; error?: string };
    if (!response.ok) throw new Error(result.error || "The accepted quote handoff could not be loaded.");
    setHandoff(result.handoff || null); setTimeline(result.timeline || []);
    if (result.handoff) {
      setDepositKind(result.handoff.depositKind);
      setDepositValue(result.handoff.depositKind === "percentage" ? String(result.handoff.depositBasisPoints / 100) : (result.handoff.depositFixedCents / 100).toFixed(2));
    }
  }, [hasDirectCustomer, isProtected, user, workOrderId]);

  useEffect(() => { const frame = window.requestAnimationFrame(() => { void load().catch((error) => setStatus(error instanceof Error ? error.message : "The handoff could not be loaded.")); }); return () => window.cancelAnimationFrame(frame); }, [load]);

  async function saveDeposit() {
    setBusy(true); setStatus("Saving the deposit amount...");
    try {
      const number = Number(depositValue); const value = depositKind === "percentage" ? Math.round(number * 100) : Math.round(number * 100);
      const token = await user.getIdToken(); const response = await fetch("/api/trade-commercial-handoff", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderId, depositKind, value }),
      });
      const result = await response.json().catch(() => ({})) as { handoff?: Handoff; timeline?: TimelineEvent[]; error?: string };
      if (!response.ok || !result.handoff) throw new Error(result.error || "The deposit amount could not be saved.");
      setHandoff(result.handoff); setTimeline(result.timeline || []); setStatus(`Deposit set to ${money(result.handoff.depositAmountCents)}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The deposit amount could not be saved."); }
    finally { setBusy(false); }
  }

  const refreshAll = useCallback(async () => { await Promise.all([load(), onChanged()]); }, [load, onChanged]);

  if (isProtected) return <div className="crm-payment-boundary"><strong>AEA protected commercial boundary</strong><p>Acceptance, deposits and accounting for this customer remain inside the protected AEA process.</p></div>;
  if (!hasDirectCustomer) return <section className="crm-commercial-handoff empty"><span>Accepted quote handoff</span><h4>Link your customer first</h4><p>A direct customer record is required before commercial details can leave TLink.</p></section>;
  if (!handoff) return <section className="crm-commercial-handoff empty"><span>Next step</span><h4>Issue the quote for acceptance</h4><p>Once the customer accepts, their exact scope and total will appear here automatically for deposit and accounting.</p>{status && <p role="status">{status}</p>}</section>;

  const depositLocked = timeline.some((event) => event.type === "deposit");
  return <section className="crm-commercial-handoff">
    <header><div><span>Accepted quote handoff</span><h4>{handoff.commercialReference}</h4><p>One accepted scope now drives the deposit and accounting draft. No retyping or provider calculations.</p></div><strong>{money(handoff.totalCents)}</strong></header>
    <div className="crm-commercial-summary"><article><span>Accepted</span><strong>{new Date(handoff.acceptedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</strong></article><article><span>Included scope</span><strong>{handoff.scope.length} line{handoff.scope.length === 1 ? "" : "s"}</strong></article><article><span>GST</span><strong>{money(handoff.taxCents)}</strong></article><article><span>Deposit</span><strong>{money(handoff.depositAmountCents)}</strong></article></div>
    <details className="crm-commercial-scope"><summary>Review accepted scope</summary><ol>{handoff.scope.map((line) => <li key={line.lineId}><div><strong>{line.description}</strong><span>{line.section}</span></div><b>{money(line.totalCents)}</b></li>)}</ol>{handoff.terms && <p><strong>Recorded terms:</strong> {handoff.terms}</p>}</details>
    <div className="crm-deposit-choice"><div><span>Deposit amount</span><h5>{money(handoff.depositAmountCents)}</h5><p>10% is the simple default. Change it before creating the payment request.</p></div><label><span>Method</span><select value={depositKind} disabled={depositLocked} onChange={(event) => setDepositKind(event.target.value as "percentage" | "fixed")}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label><label><span>{depositKind === "percentage" ? "Percent" : "Amount"}</span><input type="number" min={depositKind === "percentage" ? 1 : 1} max={depositKind === "percentage" ? 100 : handoff.totalCents / 100} step={depositKind === "percentage" ? 1 : 0.01} value={depositValue} disabled={depositLocked} onChange={(event) => setDepositValue(event.target.value)} /></label><button type="button" disabled={busy || depositLocked} onClick={() => void saveDeposit()}>{depositLocked ? "Locked after request" : busy ? "Saving..." : "Use this deposit"}</button></div>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
    <TradePaymentPanel user={user} workOrderId={workOrderId} isProtected={false} suggestedAmountCents={handoff.depositAmountCents} onOpenIntegrations={onOpenIntegrations} onChanged={refreshAll} />
    <TradeAccountingPanel user={user} workOrderId={workOrderId} isProtected={false} hasDirectCustomer invoiceAmountCents={handoff.totalCents}
      invoiceReference={handoff.commercialReference} invoiceLines={handoff.scope} invoiceSubtotalCents={handoff.subtotalCents}
      invoiceTaxCents={handoff.taxCents} customerName={customerName} jobTitle={jobTitle} invoiceTerms={handoff.terms}
      onOpenIntegrations={onOpenIntegrations} onChanged={refreshAll} />
    <details className="crm-commercial-timeline"><summary>Activity and provider history ({timeline.length})</summary><header><div><span>Commercial timeline</span><h4>Acceptance, deposit and accounting</h4></div><button type="button" onClick={() => void refreshAll()}>Refresh</button></header><ol>{timeline.map((event, index) => <li key={`${event.type}:${event.provider}:${event.occurredAt}:${index}`}><i aria-hidden="true" /><div><strong>{event.summary}</strong><span>{event.provider === "tlink" ? "TLink" : event.provider === "quickbooks" ? "QuickBooks" : event.provider.toUpperCase()} | {event.status.replaceAll("_", " ")}</span></div><time>{new Date(event.occurredAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ol></details>
  </section>;
}
