"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { isAccountingProvider, type AccountingProvider } from "@/lib/trade-accounting";

type Provider = { provider: AccountingProvider; label: string; connected: boolean; needsReconnect: boolean };
type Account = { id: string; code: string; name: string; taxCode: string };
type InvoiceLine = { lineId: string; section: string; description: string; quantityMilli: number; totalCents: number };
type Document = {
  id: string; workOrderId: string; provider: AccountingProvider; externalNumber: string; externalUrl: string;
  exported: boolean; amountCents: number; paidAmountCents: number; status: string;
  syncState: "not_synced" | "syncing" | "synced" | "attention_required"; providerStatus: string;
  dueAt: string; lastSyncedAt: string; lastError: string; createdAt: string;
};
type AccountingResult = { providers?: Provider[]; documents?: Document[]; accounts?: Account[]; document?: Document; selectedProvider?: AccountingProvider; accountReference?: string; error?: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const statusLabels: Record<string, string> = {
  exporting: "Preparing export", draft: "Draft in accounting", issued: "Awaiting payment",
  part_paid: "Part paid", paid: "Paid", overdue: "Overdue", void: "Void", error: "Needs attention",
};
const syncLabels: Record<Document["syncState"], string> = {
  not_synced: "Not synced",
  syncing: "Syncing",
  synced: "Synced",
  attention_required: "Sync needs attention",
};

export function TradeAccountingPanel({
  user, workOrderId, isProtected, hasDirectCustomer, invoiceAmountCents, invoiceReference, invoiceLines,
  invoiceSubtotalCents, invoiceTaxCents, customerName, jobTitle, invoiceTerms, onOpenIntegrations, onChanged,
  invoiceSource = "accepted_quote",
}: {
  user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean;
  invoiceAmountCents: number; invoiceReference: string; invoiceLines: InvoiceLine[]; invoiceSubtotalCents: number;
  invoiceTaxCents: number; customerName: string; jobTitle: string; invoiceTerms: string;
  invoiceSource?: "accepted_quote" | "quick_invoice";
  onOpenIntegrations?: () => void; onChanged: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AccountingProvider>("xero");
  const [accountReference, setAccountReference] = useState("");
  const [busy, setBusy] = useState("loading");
  const [status, setStatus] = useState("");
  const loadGeneration = useRef(0);

  const load = useCallback(async (provider?: AccountingProvider) => {
    const generation = ++loadGeneration.current;
    setBusy("loading"); setAccounts([]); setAccountReference(""); setStatus("");
    if (!provider) { setProviders([]); setDocuments([]); }
    try {
      const token = await user.getIdToken();
      const query = new URLSearchParams({ workOrderId, invoiceSource });
      if (provider) query.set("provider", provider);
      const response = await fetch(`/api/trade-accounting?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error(result.error || "Accounting information could not be loaded.");
      setProviders(result.providers || []); setDocuments(result.documents || []);
      setSelectedProvider(result.selectedProvider || provider || "xero");
      setAccounts(result.accounts || []); setAccountReference(result.accountReference || "");
    } catch (error) {
      if (generation === loadGeneration.current) setStatus(error instanceof Error ? error.message : "Accounting information could not be loaded.");
    } finally { if (generation === loadGeneration.current) setBusy(""); }
  }, [invoiceSource, user, workOrderId]);

  useEffect(() => {
    if (isProtected || !hasDirectCustomer) return;
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => { window.cancelAnimationFrame(frame); loadGeneration.current += 1; };
  }, [hasDirectCustomer, isProtected, load]);

  async function exportInvoice(provider: AccountingProvider) {
    const label = provider === "xero" ? "Xero" : provider === "myob" ? "MYOB" : "QuickBooks";
    setBusy(provider); setStatus(`Syncing your issued invoice to ${label}...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-accounting", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "export", provider, workOrderId, invoiceSource, accountReference }),
      });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (!response.ok || !result.document) throw new Error(result.error || "The invoice could not be exported.");
      setDocuments([result.document]); setStatus(`Invoice ${result.document.externalNumber || "created"} is synced to ${label}.`);
      await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The invoice could not be exported."); }
    finally { setBusy(""); }
  }

  async function refreshInvoice() {
    setBusy("refresh"); setStatus("Checking the accounting invoice...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-accounting", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "refresh", workOrderId, invoiceSource }),
      });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (!response.ok || !result.document) throw new Error(result.error || "The invoice status could not be refreshed.");
      setDocuments([result.document]); setStatus("Invoice total and payment status refreshed from the accounting provider.");
      await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : "The invoice status could not be refreshed."); }
    finally { setBusy(""); }
  }

  if (isProtected) return <div className="crm-payment-boundary"><strong>Australian Energy Assessments protected accounting boundary</strong><p>Customer identity and address details cannot be exported to an installer accounting account. Australian Energy Assessments will mediate this customer&apos;s paperwork.</p></div>;
  if (!hasDirectCustomer) return <div className="crm-accounting-panel"><header><div><span>Accounting invoice</span><h4>Prepare an accounting invoice</h4><p>Link one of your own direct customers to this job before exporting customer details.</p></div></header></div>;

  const document = documents[0];
  const xero = providers.find((provider) => provider.provider === "xero");
  const myob = providers.find((provider) => provider.provider === "myob");
  const quickbooks = providers.find((provider) => provider.provider === "quickbooks");
  const retryProvider = document && !document.exported ? document.provider : null;
  const provider = selectedProvider === "xero" ? xero : selectedProvider === "myob" ? myob : quickbooks;
  const providerLabel = selectedProvider === "xero" ? "Xero" : selectedProvider === "myob" ? "MYOB" : "QuickBooks";
  return <section className="crm-accounting-panel">
    <header><div><span>Invoice</span><h4>Sync this invoice</h4><p>Your issued invoice and its exact total go straight to your accounting system. No retyping or second approval.</p></div></header>
    <div className="crm-invoice-workspace">
      <article className="crm-invoice-preview" aria-label="Invoice preview">
        <header><div><span>Invoice preview</span><strong>{invoiceReference}</strong></div><em>Export preview</em></header>
        <div className="crm-invoice-parties"><div><span>Invoice to</span><strong>{customerName || "Direct customer"}</strong></div><div><span>For</span><strong>{jobTitle || "Accepted work"}</strong></div></div>
        <div className="crm-invoice-lines"><div className="head"><span>Description</span><span>Qty</span><span>Incl GST</span></div>{invoiceLines.map((line) => <div key={line.lineId}><span><strong>{line.description}</strong><small>{line.section}</small></span><span>{(line.quantityMilli / 1000).toLocaleString("en-AU")}</span><b>{money(line.totalCents)}</b></div>)}</div>
        <dl><div><dt>Subtotal</dt><dd>{money(invoiceSubtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(invoiceTaxCents)}</dd></div><div className="total"><dt>Total</dt><dd>{money(invoiceAmountCents)}</dd></div></dl>
        {invoiceTerms && <details><summary>Invoice terms</summary><p>{invoiceTerms}</p></details>}
      </article>
      <aside className="crm-invoice-actions">
        {document?.exported ? <article className={`crm-accounting-document accounting-${document.status}`}>
          <div><span>{document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"} invoice | {syncLabels[document.syncState] || "Sync state unknown"}</span><strong>{document.externalNumber || "Invoice created"}</strong><small>{statusLabels[document.status] || document.status} | {money(document.paidAmountCents)} paid of {money(document.amountCents)}{document.lastSyncedAt ? ` | Checked ${new Date(document.lastSyncedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{document.lastError && <em>{document.lastError === "PROVIDER_REQUEST_FAILED" ? "The last provider check failed. Reconnect the provider if this continues." : "The last sync needs attention."}</em>}</div>
          <div><button type="button" disabled={Boolean(busy)} onClick={() => void refreshInvoice()}>{busy === "refresh" ? "Checking..." : "Refresh status"}</button>{document.externalUrl && <a href={document.externalUrl} target="_blank" rel="noreferrer">Open in {document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"}</a>}</div>
        </article> : <div className="crm-accounting-create">
          <div><span>Ready to sync</span><strong>{money(invoiceAmountCents || 0)}</strong><small>Creates an issued invoice in {providerLabel} and records the amount owing. TLink does not send a second invoice email.</small></div>
          <label><span>Accounting system</span><select value={selectedProvider} disabled={Boolean(retryProvider) || Boolean(busy)} onChange={(event) => { const next = event.target.value; if (isAccountingProvider(next)) { setSelectedProvider(next); void load(next); } }}><option value="xero">Xero</option><option value="myob">MYOB</option><option value="quickbooks">QuickBooks</option></select></label>
          {provider?.connected && !provider.needsReconnect && <label><span>{selectedProvider === "quickbooks" ? "Product or service" : "Income account"}</span><select value={accountReference} disabled={Boolean(busy)} onChange={(event) => setAccountReference(event.target.value)}><option value="">{busy === "loading" ? "Loading choices..." : "Choose once for future invoices"}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code ? account.code + " | " : ""}{account.name}</option>)}</select><small>TLink remembers this choice for this connected business.</small></label>}
          {provider?.connected && !provider.needsReconnect && !busy && accounts.length === 0 && <p>Add an active {selectedProvider === "quickbooks" ? "sales product or service" : "income account"} in {providerLabel}, then <button type="button" onClick={() => void load(selectedProvider)}>Reload choices</button>.</p>}
          <button type="button" disabled={Boolean(busy) || (Boolean(provider?.connected) && !provider?.needsReconnect && (!accountReference || invoiceAmountCents <= 0))} onClick={() => provider?.connected && !provider.needsReconnect ? void exportInvoice(selectedProvider) : onOpenIntegrations?.()}>{busy === "loading" ? "Loading accounting..." : busy === selectedProvider ? "Syncing..." : provider?.needsReconnect ? "Reconnect " + providerLabel : !provider?.connected ? "Connect " + providerLabel : retryProvider ? "Retry sync to " + providerLabel : "Sync to " + providerLabel}</button>
          <small>Check any automatic sending rules in your accounting system.</small>
        </div>}
      </aside>
    </div>
    {status && <p className="crm-inline-status" role="status">{status}{!busy && !providers.length && <button type="button" onClick={() => void load()}>Retry loading</button>}</p>}
  </section>;
}
