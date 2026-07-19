"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { TradeAccountingPanel } from "./TradeAccountingPanel";
import { TradePaymentPanel } from "./TradePaymentPanel";

type Line = { lineId: string; description: string; quantity: number; unitPriceCentsExGst: number; subtotalCents: number; taxCents: number; totalCents: number; taxCode: "gst" | "none" };
type Credit = { creditNumber: string; description: string; subtotalCents: number; taxCents: number; totalCents: number; reason: string; status: string; createdAt: string };
type Revision = { revision: number; subtotalCents: number; taxCents: number; totalCents: number; dueAt: string; reason: string; createdAt: string };
type QuickInvoice = {
  id: string; invoiceNumber: string; lines: Line[]; subtotalCents: number; taxCents: number; totalCents: number;
  dueAt: string; status: string; deliveryStatus: string; attempts: number; sentAt: string; revision: number;
  deliveryEmail: string;
  creditedCents: number; paidCents: number; netCents: number; outstandingCents: number; canCorrect: boolean;
  creditBlockedReason: string; credits: Credit[]; revisions: Revision[];
};
type EditLine = { id: string; description: string; amount: string; taxCode: "gst" | "none" };

function money(cents: number) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }
function amount(cents: number) { return (cents / 100).toFixed(2); }
function toCents(value: string) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) : 0; }
function editLines(invoice: QuickInvoice): EditLine[] {
  return invoice.lines.map((line) => ({ id: line.lineId || crypto.randomUUID(), description: line.description,
    amount: amount(line.unitPriceCentsExGst || line.subtotalCents), taxCode: line.taxCode }));
}

export function TradeQuickInvoicePanel({ user, workOrderId, customerName, jobTitle, onOpenIntegrations, onChanged }: { user: User; workOrderId: string; customerName: string; jobTitle: string; onOpenIntegrations?: () => void; onChanged: () => Promise<void> }) {
  const [invoice, setInvoice] = useState<QuickInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [draftLines, setDraftLines] = useState<EditLine[]>([]);
  const [draftDueAt, setDraftDueAt] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditTaxCode, setCreditTaxCode] = useState<"gst" | "none">("gst");
  const [creditReason, setCreditReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const acceptInvoice = useCallback((next: QuickInvoice | null) => {
    setInvoice(next);
    if (next) { setDraftLines(editLines(next)); setDraftDueAt(next.dueAt); }
  }, []);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-quick-invoices?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as { invoice?: QuickInvoice | null; error?: string };
    if (!response.ok) throw new Error(result.error || "Quick invoice could not be loaded.");
    acceptInvoice(result.invoice || null);
  }, [acceptInvoice, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Quick invoice could not be loaded."); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [previewOpen]);

  async function request(action: string, values: Record<string, unknown>, success: string) {
    if (!invoice) return false;
    setBusy(action); setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-quick-invoices", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, invoiceId: invoice.id, ...values }) });
      const result = await response.json() as { invoice?: QuickInvoice; error?: string };
      if (!response.ok) throw new Error(result.error || "The invoice could not be updated.");
      if (result.invoice) acceptInvoice(result.invoice);
      setStatus(success); await onChanged(); return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The invoice could not be updated."); return false; }
    finally { setBusy(""); }
  }

  function updateLine(id: string, values: Partial<EditLine>) {
    setDraftLines((current) => current.map((line) => line.id === id ? { ...line, ...values } : line));
  }

  async function correctDraft() {
    if (!invoice) return;
    const lines = draftLines.map((line) => ({ priceBookItemId: "", description: line.description.trim(), unitPriceCentsExGst: toCents(line.amount), taxCode: line.taxCode }));
    await request("correct_draft", { expectedRevision: invoice.revision, lines, dueAt: draftDueAt, reason: draftReason }, "Draft invoice corrected. The earlier snapshot remains in history.");
  }

  async function issueCredit() {
    await request("issue_credit", { description: creditDescription, subtotalCents: toCents(creditAmount), taxCode: creditTaxCode, reason: creditReason }, "Credit issued and the outstanding balance recalculated.");
    setCreditDescription(""); setCreditAmount(""); setCreditReason("");
  }

  async function sendInvoice() {
    const sent = await request("retry_delivery", { consentConfirmed: true }, "Invoice sent.");
    if (sent) setPreviewOpen(false);
  }

  if (loading) return null;
  if (!invoice) return status ? <p className="crm-status" role="status">{status}</p> : null;
  const canIssueCredit = ["issued", "part_credited"].includes(invoice.status) && invoice.outstandingCents > 0 && !invoice.creditBlockedReason;
  return <><section className="crm-quick-invoice-panel">
    <header><div><span>TLink quick invoice</span><h4>{invoice.invoiceNumber}</h4><p>{invoice.deliveryStatus === "sent" ? `Sent ${new Date(invoice.sentAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : "Saved in this job and waiting to be sent."}</p></div><strong>{invoice.status === "paid" ? "Paid" : invoice.status === "credited" ? "Credited" : invoice.deliveryStatus === "sent" ? "Sent" : "Needs attention"}</strong></header>
    <div className="crm-quick-invoice-lines">{invoice.lines.map((line) => <div key={line.lineId}><span>{line.description}<small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><strong>{money(line.subtotalCents)}</strong></div>)}</div>
    <dl><div><dt>Original invoice</dt><dd>{money(invoice.totalCents)}</dd></div>{invoice.creditedCents > 0 && <div><dt>Credits</dt><dd>-{money(invoice.creditedCents)}</dd></div>}<div><dt>Paid</dt><dd>{money(invoice.paidCents)}</dd></div><div className="total"><dt>Outstanding</dt><dd>{money(invoice.outstandingCents)}</dd></div><div><dt>Due</dt><dd>{invoice.dueAt}</dd></div></dl>
    {invoice.credits.length > 0 && <div className="crm-invoice-credit-list"><strong>Credits</strong>{invoice.credits.map((credit) => <article key={credit.creditNumber}><span><b>{credit.creditNumber}</b><small>{credit.description} | {credit.reason}</small></span><strong>-{money(credit.totalCents)}</strong></article>)}</div>}
    {invoice.deliveryStatus !== "sent" && <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => setPreviewOpen(true)}>Preview and send invoice</button>}
    {invoice.canCorrect && <details className="crm-invoice-correction"><summary>Correct this draft before sending</summary><p>Saving creates a new revision. Earlier invoice snapshots remain unchanged in history.</p><div className="crm-invoice-correction-lines">{draftLines.map((line) => <div key={line.id}><input aria-label="Invoice line description" maxLength={180} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /><input aria-label="Invoice line amount before GST" type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => updateLine(line.id, { amount: event.target.value })} /><select aria-label="Invoice line GST" value={line.taxCode} onChange={(event) => updateLine(line.id, { taxCode: event.target.value as "gst" | "none" })}><option value="gst">Add GST</option><option value="none">GST-free</option></select><button type="button" disabled={draftLines.length === 1} onClick={() => setDraftLines((current) => current.filter((item) => item.id !== line.id))}>Remove</button></div>)}</div><button type="button" onClick={() => setDraftLines((current) => [...current, { id: crypto.randomUUID(), description: "", amount: "", taxCode: "gst" }])}>Add line</button><div className="crm-invoice-correction-meta"><label><span>Due date</span><input type="date" value={draftDueAt} onChange={(event) => setDraftDueAt(event.target.value)} /></label><label><span>Reason, optional</span><input maxLength={240} value={draftReason} onChange={(event) => setDraftReason(event.target.value)} placeholder="What changed?" /></label></div><button type="button" className="btn" disabled={Boolean(busy) || !draftLines.every((line) => line.description.trim() && toCents(line.amount) > 0) || !draftDueAt} onClick={() => void correctDraft()}>{busy === "correct_draft" ? "Saving correction..." : "Save corrected draft"}</button></details>}
    {["issued", "part_credited"].includes(invoice.status) && invoice.outstandingCents > 0 && <details className="crm-invoice-credit"><summary>Issue a credit</summary><p>The issued invoice stays unchanged. The credit reduces only its outstanding balance.</p>{invoice.creditBlockedReason ? <div className="crm-wizard-message">{invoice.creditBlockedReason} Resolve that activity before issuing a TLink credit.</div> : <><div className="crm-invoice-credit-fields"><label><span>Description</span><input maxLength={180} value={creditDescription} onChange={(event) => setCreditDescription(event.target.value)} placeholder="Credit for changed scope" /></label><label><span>Amount before GST</span><input type="number" min="0.01" step="0.01" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} /></label><label><span>GST</span><select value={creditTaxCode} onChange={(event) => setCreditTaxCode(event.target.value as "gst" | "none")}><option value="gst">Add GST</option><option value="none">GST-free</option></select></label><label><span>Reason</span><input maxLength={500} value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Why is this credit being issued?" /></label></div><button type="button" className="btn" disabled={Boolean(busy) || !canIssueCredit || !creditDescription.trim() || !creditReason.trim() || toCents(creditAmount) < 1} onClick={() => void issueCredit()}>{busy === "issue_credit" ? "Issuing credit..." : "Issue credit"}</button></>}</details>}
    {invoice.revisions.length > 1 && <details className="crm-invoice-history"><summary>Invoice history | {invoice.revisions.length} revisions</summary>{invoice.revisions.map((revision) => <article key={revision.revision}><span><strong>Revision {revision.revision}</strong><small>{new Date(revision.createdAt).toLocaleString("en-AU")} | Due {revision.dueAt}</small></span><b>{money(revision.totalCents)}</b></article>)}</details>}
    {status && <p className="crm-status" role="status">{status}</p>}
    {previewOpen && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreviewOpen(false); }}>
      <section className="crm-invoice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title">
        <header><div><span>Check before sending</span><strong id="invoice-preview-title">{invoice.invoiceNumber}</strong><small>{customerName} | {jobTitle}</small></div><button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close invoice preview">Close</button></header>
        <div className="crm-invoice-preview-lines">{invoice.lines.map((line) => <div key={line.lineId}><span><strong>{line.description}</strong><small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><b>{money(line.subtotalCents)}</b></div>)}</div>
        <dl><div><dt>Subtotal</dt><dd>{money(invoice.subtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(invoice.taxCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoice.totalCents)}</dd></div><div><dt>Due</dt><dd>{invoice.dueAt}</dd></div></dl>
        <p>The invoice will be emailed to <strong>{invoice.deliveryEmail || "the customer email saved on this job"}</strong>.</p>
        <footer><button type="button" onClick={() => setPreviewOpen(false)}>Go back and edit</button><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void sendInvoice()}>{busy === "retry_delivery" ? "Sending..." : "Confirm and send"}</button></footer>
      </section>
    </div>}
  </section>{invoice.status !== "draft" && invoice.outstandingCents > 0 && <details className="crm-quick-invoice-handoff"><summary>Accounting and payment, optional</summary><p>Reuse the remaining TLink balance without entering the customer or total again.</p>
    {invoice.creditedCents === 0 ? <TradeAccountingPanel user={user} workOrderId={workOrderId} isProtected={false} hasDirectCustomer invoiceAmountCents={invoice.totalCents}
      invoiceReference={invoice.invoiceNumber} invoiceLines={invoice.lines.map((line) => ({ lineId: line.lineId, section: line.taxCode === "gst" ? "GST taxable" : "GST-free", description: line.description, quantityMilli: Math.max(1, line.quantity || 1) * 1000, totalCents: line.totalCents }))}
      invoiceSubtotalCents={invoice.subtotalCents} invoiceTaxCents={invoice.taxCents} customerName={customerName} jobTitle={jobTitle} invoiceTerms="" invoiceSource="quick_invoice" onOpenIntegrations={onOpenIntegrations} onChanged={onChanged} />
      : <p className="crm-wizard-message">This invoice has a TLink credit. Accounting-provider credit export is kept separate so the provider cannot silently recalculate the balance.</p>}
    <TradePaymentPanel user={user} workOrderId={workOrderId} isProtected={false} suggestedAmountCents={invoice.outstandingCents} purpose="invoice" onOpenIntegrations={onOpenIntegrations} onChanged={onChanged} />
  </details>}</>;
}
