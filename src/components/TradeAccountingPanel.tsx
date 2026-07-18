"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type AccountingProvider = "xero" | "myob" | "quickbooks";
type Provider = { provider: AccountingProvider; label: string; connected: boolean; needsReconnect: boolean };
type Account = { id: string; code: string; name: string; taxCode: string };
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
  user, workOrderId, isProtected, hasDirectCustomer, invoiceAmountCents, onOpenIntegrations, onChanged,
}: {
  user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean;
  invoiceAmountCents: number; onOpenIntegrations?: () => void; onChanged: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [preparedProvider, setPreparedProvider] = useState<"myob" | "quickbooks" | "">("");
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
  return <section className="crm-accounting-panel">
    <header><div><span>Accounting handoff</span><h4>Prepare the accepted quote</h4><p>Create one draft in Xero, MYOB or QuickBooks. Review it there before approval or sending.</p></div></header>
    {document?.exported ? <article className={`crm-accounting-document accounting-${document.status}`}>
      <div><span>{document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"} invoice</span><strong>{document.externalNumber || "Invoice created"}</strong><small>{statusLabels[document.status] || document.status} | {money(document.paidAmountCents)} paid of {money(document.amountCents)}{document.lastSyncedAt ? ` | Checked ${new Date(document.lastSyncedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{document.lastError && <em>{document.lastError === "PROVIDER_REQUEST_FAILED" ? "The last provider check failed. Reconnect the provider if this continues." : "The last sync needs attention."}</em>}</div>
      <div><button type="button" disabled={Boolean(busy)} onClick={() => void refreshInvoice()}>{busy === "refresh" ? "Checking..." : "Refresh status"}</button>{document.externalUrl && <a href={document.externalUrl} target="_blank" rel="noreferrer">Open in {document.provider === "xero" ? "Xero" : document.provider === "myob" ? "MYOB" : "QuickBooks"}</a>}</div>
    </article> : <div className="crm-accounting-create">
      <div><strong>{money(invoiceAmountCents || 0)}</strong><span>Accepted quote total</span><small>The immutable accepted scope and total are reused. Only one accounting draft can be linked to this handoff.</small></div>
      {(!retryProvider || retryProvider === "xero") && <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => xero?.connected ? void exportInvoice("xero") : onOpenIntegrations?.()}>{busy === "xero" ? "Exporting..." : !xero?.connected ? "Connect Xero" : retryProvider ? "Retry Xero export" : "Export draft to Xero"}</button>}
      {(!retryProvider || retryProvider === "myob") && <div className="crm-myob-export">{myob?.needsReconnect ? <button type="button" onClick={onOpenIntegrations}>Reconnect MYOB</button> : preparedProvider === "myob" && accounts.length ? <><label><span>MYOB income account</span><select value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} | {account.name}{account.taxCode ? ` | ${account.taxCode}` : ""}</option>)}</select></label><button type="button" disabled={!accountReference || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("myob")}>{busy === "myob" ? "Exporting..." : retryProvider ? "Retry MYOB export" : "Create MYOB draft"}</button></> : <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => myob?.connected ? void prepareProvider("myob") : onOpenIntegrations?.()}>{busy === "prepare-myob" ? "Loading accounts..." : myob?.connected ? "Choose MYOB account" : "Connect MYOB"}</button>}</div>}
      {(!retryProvider || retryProvider === "quickbooks") && <div className="crm-myob-export">{preparedProvider === "quickbooks" && accounts.length ? <><label><span>QuickBooks product or service</span><select value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code ? `${account.code} | ` : ""}{account.name}</option>)}</select></label><button type="button" disabled={!accountReference || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("quickbooks")}>{busy === "quickbooks" ? "Creating..." : retryProvider ? "Retry QuickBooks invoice" : "Create QuickBooks invoice"}</button></> : <button type="button" disabled={invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => quickbooks?.connected ? void prepareProvider("quickbooks") : onOpenIntegrations?.()}>{busy === "prepare-quickbooks" ? "Loading choices..." : quickbooks?.connected ? "Choose QuickBooks item" : "Connect QuickBooks"}</button>}</div>}
    </div>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
