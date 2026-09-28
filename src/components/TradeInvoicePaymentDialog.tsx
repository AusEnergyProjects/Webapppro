"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import styles from "./InstallerCrmJobRegister.module.css";

export type InvoicePaymentJob = {
  id: string; workNumber: string; revision: number; invoiceStatus: string;
  invoicedValueCents: number; paidValueCents: number;
};

export function TradeInvoicePaymentDialog({ user, job, onClose, onSaved }: {
  user: User; job: InvoicePaymentJob; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState((job.paidValueCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trade-crm", {
        method: "PATCH", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_invoice_payment", workOrderId: job.id, expectedRevision: job.revision,
          paidValueCents: Math.round(Number(amount) * 100), expectedInvoicedValueCents: job.invoicedValueCents,
          expectedPaidValueCents: job.paidValueCents, expectedInvoiceStatus: job.invoiceStatus }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Payment could not be recorded.");
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Payment could not be recorded."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.paymentDialog} aria-labelledby="invoice-payment-title" onCancel={onClose}>
    <form onSubmit={save}>
      <header><div><small>{job.workNumber}</small><h3 id="invoice-payment-title">Invoice payment</h3></div><button type="button" onClick={onClose} aria-label="Close invoice payment">Close</button></header>
      <p>Record money already received. This updates the invoice and stops paid-invoice reminders.</p>
      <div className={styles.paymentChoices}>
        <button type="button" onClick={() => setAmount((job.invoicedValueCents / 100).toFixed(2))}>Paid in full</button>
        <button type="button" onClick={() => setAmount("0.00")}>Unpaid</button>
      </div>
      <label>Total received ($)<input type="number" required min="0" max={job.invoicedValueCents / 100} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <small>Invoice total: {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(job.invoicedValueCents / 100)}. Enter a smaller amount for part payment.</small>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving..." : "Save payment"}</button></footer>
    </form>
  </dialog>;
}
