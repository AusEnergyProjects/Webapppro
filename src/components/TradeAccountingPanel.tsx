"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type AccountingProvider = "xero" | "myob" | "quickbooks";
type Provider = { provider: AccountingProvider; label: string; connected: boolean; needsReconnect: boolean };
type Account = { id: string; code: string; name: string; taxCode: string };
type InvoiceLine = { lineId: string; section: string; description: string; quantityMilli: number; totalCents: number };
type Document = {
  id: string; workOrderId: string; provider: AccountingProvider; externalNumber: string; externalUrl: string;
  exported: boolean; amountCents: number; paidAmountCents: number; status: string; providerStatus: string;
  dueAt: string; lastSyncedAt: string; lastError: string; createdAt: string;
};
type AccountingResult = { providers?: Provider[]; documents?: Document[]; accounts?: Account[]; document?: Document; error?: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const statusLabels: Record<string, string> = {
  exporting: "Preparing export", draft: "Draft in accounting", issued: "Awaiting payment",
  part_paid: "Part paid", paid: "Paid", overdue: "Overdue", void: "Void", error: "Needs attention",
};

export function TradeAccountingPanel({
  user, workOrderId, isProtected, hasDirectCustomer, invoiceAmountCents, invoiceReference, invoiceLines,
  invoiceSubtotalCents, invoiceTaxCents, customerName, jobTitle, invoiceTerms, onOpenIntegrations, onChanged,
}: {
  user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean;
  invoiceAmountCents: number; invoiceReference: string; invoiceLines: InvoiceLine[]; invoiceSubtotalCents: number;
  invoiceTaxCents: number; customerName: string; jobTitle: string; invoiceTerms: string;
  onOpenIntegrations?: () => void; onChanged: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [preparedProvider, setPreparedProvider] = useState<"myob" | "quickbooks" | "">("");
  const [selectedProvider, setSelectedProvider] = useState<AccountingProvider>("xero");
  const [accountReference, setAccountReference] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async (provider?: "myob" | "quickbooks") => {
    const token = await user.getIdToken();
    const query = new URLSearchParams({ workOrderId });
    if (provider) query.set("provider", provider);
    const response = await fetch(`/api/trade-accounting?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as AccountingResult;
    if (!response.ok) throw new Error(result.error || "Accounting information could not be loaded.");
    setProviders(result.providers || []); setDocuments(result.documents || []);
    if (result.documents?.[0]) setSelectedProvider(result.documents[0].provider);
    if (provider) {
      const nextAccounts = result.accounts || [];
      setPreparedProvider(provider);
      setAccounts(nextAccounts); setAccountReference((current) => nextAccounts.some((item) => item.id === current) ? current : nextAccounts[0]?.id || "");
    }
  }, [user, workOrderId]);

  useEffect(() => {
    if (isProtected || !hasDirectCustomer) return;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => setStatus(error instanceof Error ? error.message : "Accounting information could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasDirectCustomer, isProtected, load]);

  async function prepareProvider(provider: "myob" | "quickbooks") {
    const label = provider === "myob" ? "MYOB" : "QuickBooks";
    setBusy(`prepare-${provider}`); setStatus(`Loading your ${label} choices...`);
    try {
      await load(provider); setStatus(`Choose where this sale belongs, then create the draft in ${label}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : `${label} choices could not be loaded.`); }
    finally { setBusy(""); }
  }

  async function exportInvoice(provider: AccountingProvider) {
    const label = provider === "xero" ? "Xero" : provider === "myob" ? "MYOB" : "QuickBooks";
    setBusy(provider); setStatus(`Creating a draft in ${label}. Nothing will be emailed automatically.`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-accounting", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "export", provider, workOrderId, accountReference: provider === "xero" ? "" : accountReference }),
      });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (!response.ok || !result.document) throw new Error(result.error || "The draft invoice could not be exported.");
      setDocuments([result.document]); setStatus(`Draft invoice ${result.document.externalNumber || "created"} is ready in ${label}. Review it there before sending.`);
      await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The draft invoice could not be exported."); }
    finally { setBusy(""); }
  }

  async function refreshInvoice() {
    setBusy("refresh"); setStatus("Checking the accounting invoice...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-accounting", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "refresh", workOrderId }),
      });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (!response.ok || !result.document) throw new Error(result.error || "The invoice status could not be refreshed.");
      setDocuments([result.document]); setStatus("Invoice total and payment status refreshed from the accounting provider.");
      await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The invoice status could not be refreshed."); }
    finally { setBusy(""); }
  }

  if (isProtected) return <div className="crm-payment-boundary"><strong>AEA protected accounting boundary</strong><p>Customer identity and address details cannot be exported to an installer accounting account. AEA will mediate this customer&apos;s paperwork.</p></div>;
  if (!hasDirectCustomer) return <div className="crm-accounting-panel"><header><div><span>Accounting invoice</span><h4>Prepare a draft</h4><p>Link one of your own direct customers to this job before exporting customer details.</p></div></header></div>;

  const document = documents[0];
  const xero = providers.find((provider) => provider.provider === "xero");
  const myob = providers.find((provider) => provider.provider === "myob");
  const quickbooks = providers.find((provider) => provider.provider === "quickbooks");
  const retryProvider = document && !document.exported ? document.provider : null;
  const provider = selectedProvider === "xero" ? xero : selectedProvider === "myob" ? myob : quickbooks;
  const providerLabel = selectedProvider === "xero" ? "Xero" : selectedProvider === "myob" ? "MYOB" : "QuickBooks";
  return <section className="crm-accounting-panel">
    <header><div><span>Invoice</span><h4>Preview, then create the draft</h4><p>Check the customer view first. TLink reuses the accepted scope and exact total, so there is nothing to retype.</p></div></header>
    <div className="crm-invoice-workspace">
      <article className="crm-invoice-preview" aria-label="Invoice preview">
        <header><div><span>Invoice preview</span><strong>{invoiceReference}</strong></div><em>Draft, not sent</em></header>
        <div className="crm-invoice-parties"><div><span>Invoice to</span><strong>{customerName || "Direct customer"}</strong></div><div><span>For</span><strong>{jobTitle || "Accepted work"}</strong></div></div>
        <div className="crm-invoice-lines"><div className="head"><span>Description</span><span>Qty</span><span>Incl GST</span></div>{invoiceLines.map((line) => <div key={line.lineId}><span><strong>{line.description}</strong><small>{line.section}</small></span><span>{(line.quantityMilli / 1000).toLocaleString("en-AU")}</span><b>{money(line.totalCents)}</b></div>)}</div>
        <dl><div><dt>Subtotal</dt><dd>{money(invoiceSubtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(invoiceTaxCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoiceAmountCents)}</dd></div></dl>
        {invoiceTerms && <details><summary>Invoice terms</summary><p>{invoiceTerms}</p></details>}
      </article>
      <aside className="crm-invoice-actions">
        {document?.exported ? <article className={`crm-accounting-document accounting-${document.status}`}>
          <div><span>{document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"} invoice</span><strong>{document.externalNumber || "Invoice created"}</strong><small>{statusLabels[document.status] || document.status} | {money(document.paidAmountCents)} paid of {money(document.amountCents)}{document.lastSyncedAt ? ` | Checked ${new Date(document.lastSyncedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{document.lastError && <em>{document.lastError === "PROVIDER_REQUEST_FAILED" ? "The last provider check failed. Reconnect the provider if this continues." : "The last sync needs attention."}</em>}</div>
          <div><button type="button" disabled={Boolean(busy)} onClick={() => void refreshInvoice()}>{busy === "refresh" ? "Checking..." : "Refresh status"}</button>{document.externalUrl && <a href={document.externalUrl} target="_blank" rel="noreferrer">Open in {document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"}</a>}</div>
        </article> : <div className="crm-accounting-create">
          <div><span>Ready to create</span><strong>{money(invoiceAmountCents || 0)}</strong><small>Creates one draft only. Nothing is approved or emailed automatically.</small></div>
          <label><span>Accounting system</span><select value={selectedProvider} disabled={Boolean(retryProvider)} onChange={(event) => { setSelectedProvider(event.target.value as AccountingProvider); setPreparedProvider(""); setAccounts([]); setAccountReference(""); }}><option value="xero">Xero</option><option value="myob">MYOB</option><option value="quickbooks">QuickBooks</option></select></label>
          {selectedProvider === "xero" && <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => provider?.connected ? void exportInvoice("xero") : onOpenIntegrations?.()}>{busy === "xero" ? "Creating draft..." : !provider?.connected ? "Connect Xero" : retryProvider ? "Retry Xero draft" : "Create Xero draft"}</button>}
          {selectedProvider === "myob" && <div className="crm-myob-export">{provider?.needsReconnect ? <button type="button" onClick={onOpenIntegrations}>Reconnect MYOB</button> : preparedProvider === "myob" && accounts.length ? <><label><span>Income account</span><select value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} | {account.name}{account.taxCode ? ` | ${account.taxCode}` : ""}</option>)}</select></label><button type="button" disabled={!accountReference || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("myob")}>{busy === "myob" ? "Creating draft..." : retryProvider ? "Retry MYOB draft" : "Create MYOB draft"}</button></> : <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => provider?.connected ? void prepareProvider("myob") : onOpenIntegrations?.()}>{busy === "prepare-myob" ? "Loading accounts..." : provider?.connected ? "Choose income account" : "Connect MYOB"}</button>}</div>}
          {selectedProvider === "quickbooks" && <div className="crm-myob-export">{preparedProvider === "quickbooks" && accounts.length ? <><label><span>Product or service</span><select value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code ? `${account.code} | ` : ""}{account.name}</option>)}</select></label><button type="button" disabled={!accountReference || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("quickbooks")}>{busy === "quickbooks" ? "Creating draft..." : retryProvider ? "Retry QuickBooks draft" : "Create QuickBooks draft"}</button></> : <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => provider?.connected ? void prepareProvider("quickbooks") : onOpenIntegrations?.()}>{busy === "prepare-quickbooks" ? "Loading choices..." : provider?.connected ? "Choose product or service" : "Connect QuickBooks"}</button>}</div>}
          <small>Selected system: {providerLabel}. Review the draft there before sending it.</small>
        </div>}
      </aside>
    </div>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
