"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { australiaLocalDateTime } from "@/lib/trade-schedule";
import { TradeAccountingPanel } from "./TradeAccountingPanel";
import { TradePaymentPanel } from "./TradePaymentPanel";

type Line = { lineId: string; description: string; quantity: number; unitPriceCentsExGst: number; subtotalCents: number; taxCents: number; totalCents: number; taxCode: "gst" | "none" };
type Credit = { creditNumber: string; description: string; subtotalCents: number; taxCents: number; totalCents: number; reason: string; status: string; createdAt: string };
type Revision = { revision: number; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; dueAt: string; reason: string; createdAt: string };
type InvoiceDocument = {
  business: { name: string; phone: string; email: string; abn: string };
  payment: { accountName: string; bsb: string; accountNumber: string; reference: string; terms: string };
  customer: { name: string; email: string; phone: string };
  site: { label: string; summary: string };
  work: { number: string; title: string };
};
type QuickInvoice = {
  id: string; invoiceNumber: string; lines: Line[]; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  dueAt: string; status: string; deliveryStatus: string; attempts: number; sentAt: string; revision: number;
  deliveryEmail: string;
  creditedCents: number; paidCents: number; netCents: number; outstandingCents: number; canCorrect: boolean;
  canDownloadPdf: boolean; document: InvoiceDocument | null;
  creditBlockedReason: string; credits: Credit[]; revisions: Revision[];
};
type EditLine = { id: string; description: string; amount: string; taxCode: "gst" | "none" };

function money(cents: number) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }
function amount(cents: number) { return (cents / 100).toFixed(2); }
function toCents(value: string) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) : 0; }
function australiaSydneyCalendarDate(value = new Date()) {
  return australiaLocalDateTime("NSW", value).slice(0, 10);
}
function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
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
  const [draftDiscount, setDraftDiscount] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditTaxCode, setCreditTaxCode] = useState<"gst" | "none">("gst");
  const [creditReason, setCreditReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDiscount, setNewDiscount] = useState("");
  const [newTaxCode, setNewTaxCode] = useState<"gst" | "none">("gst");
  const [newDueAt, setNewDueAt] = useState(() =>
    addCalendarDays(australiaSydneyCalendarDate(), 7));
  const previewDialogRef = useRef<HTMLElement>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const australiaSydneyToday = australiaSydneyCalendarDate();

  const acceptInvoice = useCallback((next: QuickInvoice | null) => {
    setInvoice(next);
    if (next) {
      setDraftLines(editLines(next));
      setDraftDueAt(next.dueAt);
      setDraftDiscount(amount(next.discountCents || 0));
    }
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
    const restoreFocusTo = previewTriggerRef.current
      || (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      previewCloseButtonRef.current?.focus());
    const containDialogFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = previewDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((item) => item.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) || first;
      if (
        event.shiftKey
          ? document.activeElement === first
          : document.activeElement === last
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containDialogFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", containDialogFocus);
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus();
    };
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
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The invoice could not be updated.";
      await load().catch(() => undefined);
      setStatus(message);
      return false;
    }
    finally { setBusy(""); }
  }

  async function createDraft() {
    const unitPriceCentsExGst = toCents(newAmount);
    const discountCents = toCents(newDiscount);
    if (
      !newDescription.trim() ||
      unitPriceCentsExGst < 1 ||
      discountCents < 0 ||
      discountCents >= unitPriceCentsExGst ||
      !newDueAt
    ) {
      setStatus("Add an invoice description, amount, valid discount and due date.");
      return;
    }
    setBusy("create_draft");
    setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-quick-invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "create_draft",
          workOrderId,
          dueAt: newDueAt,
          discountCents,
          lines: [{
            priceBookItemId: "",
            description: newDescription.trim(),
            unitPriceCentsExGst,
            taxCode: newTaxCode,
          }],
        }),
      });
      const result = await response.json() as {
        invoice?: QuickInvoice;
        error?: string;
      };
      if (!response.ok || !result.invoice) {
        throw new Error(result.error || "The invoice draft could not be created.");
      }
      acceptInvoice(result.invoice);
      setStatus("Invoice draft created. Check it before sending.");
      await onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The invoice draft could not be created.");
    } finally {
      setBusy("");
    }
  }

  function updateLine(id: string, values: Partial<EditLine>) {
    setDraftLines((current) => current.map((line) => line.id === id ? { ...line, ...values } : line));
  }

  async function correctDraft() {
    if (!invoice) return;
    const lines = draftLines.map((line) => ({ priceBookItemId: "", description: line.description.trim(), unitPriceCentsExGst: toCents(line.amount), taxCode: line.taxCode }));
    await request("correct_draft", { expectedRevision: invoice.revision, lines, discountCents: toCents(draftDiscount), dueAt: draftDueAt, reason: draftReason }, "Draft invoice corrected. The earlier snapshot remains in history.");
  }

  async function issueCredit() {
    await request("issue_credit", { description: creditDescription, subtotalCents: toCents(creditAmount), taxCode: creditTaxCode, reason: creditReason }, "Credit issued and the outstanding balance recalculated.");
    setCreditDescription(""); setCreditAmount(""); setCreditReason("");
  }

  async function sendInvoice() {
    if (!invoice?.deliveryEmail.trim()) {
      setStatus("Add a valid email to the customer record before sending this invoice.");
      setPreviewOpen(false);
      return;
    }
    const submitted = await request(
      "retry_delivery",
      { consentConfirmed: true },
      "Invoice submitted to the email provider.",
    );
    if (submitted) setPreviewOpen(false);
  }

  async function downloadPdf() {
    if (!invoice) return;
    setBusy("download_pdf");
    setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/trade-quick-invoices/${encodeURIComponent(invoice.id)}/pdf`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as {
          error?: string;
        };
        throw new Error(result.error || "The invoice PDF could not be downloaded.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${invoice.invoiceNumber}-r${invoice.revision}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
      setStatus("Invoice PDF downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The invoice PDF could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  if (loading) return null;
  if (!invoice) return <section className="crm-quick-invoice-panel">
    <header><div><span>TLink quick invoice</span><h4>Create the invoice from this job</h4><p>Start with one line. You can add or correct lines before sending.</p></div><strong>Not started</strong></header>
    <div className="crm-invoice-correction-lines">
      <div>
        <input aria-label="New invoice description" maxLength={180} placeholder="Installation or service" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
        <input aria-label="New invoice amount before GST" type="number" min="0.01" max="100000" step="0.01" placeholder="0.00" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} />
        <select aria-label="New invoice GST" value={newTaxCode} onChange={(event) => setNewTaxCode(event.target.value as "gst" | "none")}><option value="gst">Add GST</option><option value="none">GST-free</option></select>
      </div>
    </div>
    <div className="crm-invoice-correction-meta">
      <label><span>Discount (ex GST)</span><input aria-label="New invoice discount before GST" type="number" min="0" step="0.01" placeholder="0.00" value={newDiscount} onChange={(event) => setNewDiscount(event.target.value)} /></label>
      <label><span>Payment due</span><input type="date" min={australiaSydneyToday} value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} /></label>
    </div>
    <button type="button" className="btn" disabled={Boolean(busy) || !newDescription.trim() || toCents(newAmount) < 1 || toCents(newDiscount) < 0 || toCents(newDiscount) >= toCents(newAmount) || !newDueAt} onClick={() => void createDraft()}>{busy === "create_draft" ? "Creating invoice..." : "Create invoice draft"}</button>
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
  const canIssueCredit = ["issued", "part_credited"].includes(invoice.status) && invoice.outstandingCents > 0 && !invoice.creditBlockedReason;
  const canSendInvoice = Boolean(invoice.deliveryEmail.trim());
  const acceptedDelivery = [
    "provider_accepted",
    "sent",
    "delivered",
  ].includes(invoice.deliveryStatus);
  const reconciliationRequired =
    invoice.deliveryStatus === "reconciliation_required" ||
    (acceptedDelivery &&
      (invoice.status === "draft" || !invoice.canDownloadPdf));
  const providerAccepted =
    invoice.status !== "draft" &&
    acceptedDelivery &&
    invoice.canDownloadPdf;
  const draftSubtotalCents = draftLines.reduce(
    (sum, line) => sum + Math.max(0, toCents(line.amount)),
    0,
  );
  const draftDiscountCents = toCents(draftDiscount);
  return <><section className="crm-quick-invoice-panel">
    <header><div><span>TLink quick invoice</span><h4>{invoice.invoiceNumber}</h4><p>{reconciliationRequired ? "The email provider accepted a delivery, but TLink could not verify the matching issued record. Do not resend it." : providerAccepted ? `Submitted to the email provider ${new Date(invoice.sentAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : "Saved in this job and waiting to be submitted."}</p></div><strong>{reconciliationRequired ? "Reconciliation required" : invoice.status === "paid" ? "Paid" : invoice.status === "credited" ? "Credited" : providerAccepted ? "Issued" : "Needs attention"}</strong></header>
    <div className="crm-quick-invoice-lines">{invoice.lines.map((line) => <div key={line.lineId}><span>{line.description}<small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><strong>{money(line.subtotalCents)}</strong></div>)}</div>
    <dl>
      <div><dt>Subtotal</dt><dd>{money(invoice.subtotalCents)}</dd></div>
      {invoice.discountCents > 0 && <div><dt>Discount (ex GST)</dt><dd>-{money(invoice.discountCents)}</dd></div>}
      <div><dt>GST</dt><dd>{money(invoice.taxCents)}</dd></div>
      <div><dt>Invoice total</dt><dd>{money(invoice.totalCents)}</dd></div>
      {invoice.creditedCents > 0 && <div><dt>Credits</dt><dd>-{money(invoice.creditedCents)}</dd></div>}
      <div><dt>Paid</dt><dd>{money(invoice.paidCents)}</dd></div>
      <div className="total"><dt>Outstanding</dt><dd>{money(invoice.outstandingCents)}</dd></div>
      <div><dt>Due</dt><dd>{invoice.dueAt}</dd></div>
    </dl>
    {invoice.document && <div className="crm-invoice-credit-list">
      <strong>Invoice details</strong>
      <article><span><b>{invoice.document.business.name}</b><small>{[invoice.document.business.phone, invoice.document.business.email, invoice.document.business.abn ? `ABN ${invoice.document.business.abn}` : ""].filter(Boolean).join(" | ")}</small></span></article>
      <article><span><b>{invoice.document.customer.name}</b><small>{[invoice.document.customer.phone, invoice.document.customer.email, invoice.document.site.summary].filter(Boolean).join(" | ")}</small></span></article>
      <article><span><b>{invoice.document.work.title}</b><small>{invoice.document.work.number}</small></span></article>
      {(invoice.document.payment.accountName || invoice.document.payment.bsb || invoice.document.payment.accountNumber) && <article><span><b>Payment details</b><small>{[invoice.document.payment.accountName, invoice.document.payment.bsb ? `BSB ${invoice.document.payment.bsb}` : "", invoice.document.payment.accountNumber ? `Account ${invoice.document.payment.accountNumber}` : "", invoice.document.payment.reference ? `Reference ${invoice.document.payment.reference}` : ""].filter(Boolean).join(" | ")}</small></span></article>}
    </div>}
    {invoice.credits.length > 0 && <div className="crm-invoice-credit-list"><strong>Credits</strong>{invoice.credits.map((credit) => <article key={credit.creditNumber}><span><b>{credit.creditNumber}</b><small>{credit.description} | {credit.reason}</small></span><strong>-{money(credit.totalCents)}</strong></article>)}</div>}
    {invoice.canDownloadPdf && <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void downloadPdf()}>{busy === "download_pdf" ? "Preparing PDF..." : "Download invoice PDF"}</button>}
    {reconciliationRequired && <p className="crm-wizard-message" role="alert">This invoice requires support reconciliation before any correction or resend. The customer may already have received it.</p>}
    {!providerAccepted && !reconciliationRequired && <><button ref={previewTriggerRef} type="button" className="btn" disabled={Boolean(busy) || !canSendInvoice} onClick={() => setPreviewOpen(true)}>Preview and send invoice</button>{!canSendInvoice && <p className="crm-wizard-message" role="status">Sending is unavailable until a valid email is added to the customer record. The invoice draft remains saved in this job.</p>}</>}
    {invoice.canCorrect && <details className="crm-invoice-correction"><summary>Correct this draft before sending</summary><p>Saving creates a new revision. Earlier invoice snapshots remain unchanged in history.</p><div className="crm-invoice-correction-lines">{draftLines.map((line) => <div key={line.id}><input aria-label="Invoice line description" maxLength={180} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /><input aria-label="Invoice line amount before GST" type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => updateLine(line.id, { amount: event.target.value })} /><select aria-label="Invoice line GST" value={line.taxCode} onChange={(event) => updateLine(line.id, { taxCode: event.target.value as "gst" | "none" })}><option value="gst">Add GST</option><option value="none">GST-free</option></select><button type="button" disabled={draftLines.length === 1} onClick={() => setDraftLines((current) => current.filter((item) => item.id !== line.id))}>Remove</button></div>)}</div><button type="button" onClick={() => setDraftLines((current) => [...current, { id: crypto.randomUUID(), description: "", amount: "", taxCode: "gst" }])}>Add line</button><div className="crm-invoice-correction-meta"><label><span>Discount (ex GST)</span><input aria-label="Corrected invoice discount before GST" type="number" min="0" step="0.01" value={draftDiscount} onChange={(event) => setDraftDiscount(event.target.value)} /></label><label><span>Due date</span><input type="date" min={australiaSydneyToday} value={draftDueAt} onChange={(event) => setDraftDueAt(event.target.value)} /></label><label><span>Reason, optional</span><input maxLength={240} value={draftReason} onChange={(event) => setDraftReason(event.target.value)} placeholder="What changed?" /></label></div><button type="button" className="btn" disabled={Boolean(busy) || !draftLines.every((line) => line.description.trim() && toCents(line.amount) > 0) || draftDiscountCents < 0 || draftDiscountCents >= draftSubtotalCents || !draftDueAt} onClick={() => void correctDraft()}>{busy === "correct_draft" ? "Saving correction..." : "Save corrected draft"}</button></details>}
    {["issued", "part_credited"].includes(invoice.status) && invoice.outstandingCents > 0 && <details className="crm-invoice-credit"><summary>Issue a credit</summary><p>The issued invoice stays unchanged. The credit reduces only its outstanding balance.</p>{invoice.creditBlockedReason ? <div className="crm-wizard-message">{invoice.creditBlockedReason} Resolve that activity before issuing a TLink credit.</div> : <><div className="crm-invoice-credit-fields"><label><span>Description</span><input maxLength={180} value={creditDescription} onChange={(event) => setCreditDescription(event.target.value)} placeholder="Credit for changed scope" /></label><label><span>Amount before GST</span><input type="number" min="0.01" step="0.01" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} /></label><label><span>GST</span><select value={creditTaxCode} onChange={(event) => setCreditTaxCode(event.target.value as "gst" | "none")}><option value="gst">Add GST</option><option value="none">GST-free</option></select></label><label><span>Reason</span><input maxLength={500} value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Why is this credit being issued?" /></label></div><button type="button" className="btn" disabled={Boolean(busy) || !canIssueCredit || !creditDescription.trim() || !creditReason.trim() || toCents(creditAmount) < 1} onClick={() => void issueCredit()}>{busy === "issue_credit" ? "Issuing credit..." : "Issue credit"}</button></>}</details>}
    {invoice.revisions.length > 1 && <details className="crm-invoice-history"><summary>Invoice history | {invoice.revisions.length} revisions</summary>{invoice.revisions.map((revision) => <article key={revision.revision}><span><strong>Revision {revision.revision}</strong><small>{new Date(revision.createdAt).toLocaleString("en-AU")} | Due {revision.dueAt}</small></span><b>{money(revision.totalCents)}</b></article>)}</details>}
    {status && <p className="crm-status" role="status">{status}</p>}
    {previewOpen && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreviewOpen(false); }}>
      <section ref={previewDialogRef} className="crm-invoice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title" aria-describedby="invoice-preview-delivery" tabIndex={-1}>
        <header><div><span>Check before sending</span><strong id="invoice-preview-title">{invoice.document?.business.name || invoice.invoiceNumber}</strong><small>{invoice.invoiceNumber} | {customerName} | {jobTitle}</small></div><button ref={previewCloseButtonRef} type="button" onClick={() => setPreviewOpen(false)} aria-label="Close invoice preview">Close</button></header>
        {invoice.document && <div className="crm-invoice-credit-list">
          <strong>Customer and job</strong>
          <article><span><b>{invoice.document.customer.name}</b><small>{[invoice.document.customer.phone, invoice.document.customer.email, invoice.document.site.summary].filter(Boolean).join(" | ")}</small></span></article>
          <article><span><b>{invoice.document.work.title}</b><small>{invoice.document.work.number}</small></span></article>
        </div>}
        <div className="crm-invoice-preview-lines">{invoice.lines.map((line) => <div key={line.lineId}><span><strong>{line.description}</strong><small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><b>{money(line.subtotalCents)}</b></div>)}</div>
        <dl><div><dt>Subtotal</dt><dd>{money(invoice.subtotalCents)}</dd></div>{invoice.discountCents > 0 && <div><dt>Discount (ex GST)</dt><dd>-{money(invoice.discountCents)}</dd></div>}<div><dt>GST</dt><dd>{money(invoice.taxCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoice.totalCents)}</dd></div><div><dt>Due</dt><dd>{invoice.dueAt}</dd></div></dl>
        {invoice.document && (invoice.document.payment.accountName || invoice.document.payment.bsb || invoice.document.payment.accountNumber || invoice.document.payment.terms) && <div className="crm-invoice-credit-list">
          <strong>Payment</strong>
          {(invoice.document.payment.accountName || invoice.document.payment.bsb || invoice.document.payment.accountNumber) && <article><span><b>{invoice.document.payment.accountName}</b><small>{[invoice.document.payment.bsb ? `BSB ${invoice.document.payment.bsb}` : "", invoice.document.payment.accountNumber ? `Account ${invoice.document.payment.accountNumber}` : "", invoice.document.payment.reference ? `Reference ${invoice.document.payment.reference}` : ""].filter(Boolean).join(" | ")}</small></span></article>}
          {invoice.document.payment.terms && <article><span><b>Terms</b><small>{invoice.document.payment.terms}</small></span></article>}
        </div>}
        <p id="invoice-preview-delivery">The invoice will be emailed to <strong>{invoice.deliveryEmail}</strong>. Confirming records the customer&apos;s request to receive it.</p>
        <footer><button type="button" onClick={() => setPreviewOpen(false)}>Go back and edit</button><button type="button" className="btn" disabled={Boolean(busy) || !canSendInvoice} onClick={() => void sendInvoice()}>{busy === "retry_delivery" ? "Sending..." : "Confirm and send"}</button></footer>
      </section>
    </div>}
  </section>{invoice.status !== "draft" && invoice.outstandingCents > 0 && <details className="crm-quick-invoice-handoff"><summary>Accounting and payment, optional</summary><p>Reuse the remaining TLink balance without entering the customer or total again.</p>
    {invoice.creditedCents === 0 ? <TradeAccountingPanel user={user} workOrderId={workOrderId} isProtected={false} hasDirectCustomer invoiceAmountCents={invoice.totalCents}
      invoiceReference={invoice.invoiceNumber} invoiceLines={invoice.lines.map((line) => ({ lineId: line.lineId, section: line.taxCode === "gst" ? "GST taxable" : "GST-free", description: line.description, quantityMilli: Math.max(1, line.quantity || 1) * 1000, totalCents: line.totalCents }))}
      invoiceSubtotalCents={invoice.subtotalCents - invoice.discountCents} invoiceTaxCents={invoice.taxCents} customerName={customerName} jobTitle={jobTitle} invoiceTerms={invoice.document?.payment.terms || ""} invoiceSource="quick_invoice" onOpenIntegrations={onOpenIntegrations} onChanged={onChanged} />
      : <p className="crm-wizard-message">This invoice has a TLink credit. Accounting-provider credit export is kept separate so the provider cannot silently recalculate the balance.</p>}
    <TradePaymentPanel user={user} workOrderId={workOrderId} isProtected={false} suggestedAmountCents={invoice.outstandingCents} purpose="invoice" onOpenIntegrations={onOpenIntegrations} onChanged={onChanged} />
  </details>}</>;
}
