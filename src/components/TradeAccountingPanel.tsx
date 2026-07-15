"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type AccountingProvider = "xero" | "myob";
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
  user, workOrderId, isProtected, hasDirectCustomer, invoiceAmountCents, onChanged,
}: {
  user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean;
  invoiceAmountCents: number; onChanged: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountReference, setAccountReference] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async (provider?: "myob") => {
    const token = await user.getIdToken();
    const query = new URLSearchParams({ workOrderId });
    if (provider) query.set("provider", provider);
    const response = await fetch(`/api/trade-accounting?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as AccountingResult;
    if (!response.ok) throw new Error(result.error || "Accounting information could not be loaded.");
    setProviders(result.providers || []); setDocuments(result.documents || []);
    if (provider) {
      const nextAccounts = result.accounts || [];
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

  async function prepareMyob() {
    setBusy("prepare-myob"); setStatus("Loading your MYOB income accounts...");
    try {
      await load("myob"); setStatus("Choose where this sale belongs, then export the draft invoice.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "MYOB accounts could not be loaded."); }
    finally { setBusy(""); }
  }

  async function exportInvoice(provider: AccountingProvider) {
    setBusy(provider); setStatus(`Creating a draft in ${provider === "xero" ? "Xero" : "MYOB"}. Nothing will be emailed automatically.`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-accounting", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "export", provider, workOrderId, accountReference: provider === "myob" ? accountReference : "" }),
      });
      const result = await response.json().catch(() => ({})) as AccountingResult;
      if (!response.ok || !result.document) throw new Error(result.error || "The draft invoice could not be exported.");
      setDocuments([result.document]); setStatus(`Draft invoice ${result.document.externalNumber || "created"} is ready in ${provider === "xero" ? "Xero" : "MYOB"}. Review it there before sending.`);
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

  if (isProtected) return <div className="crm-payment-boundary"><strong>AEA protected accounting boundary</strong><p>Customer identity and address details cannot be exported to an installer&apos;s Xero or MYOB account. AEA will mediate this customer&apos;s paperwork.</p></div>;
  if (!hasDirectCustomer) return <div className="crm-accounting-panel"><header><div><span>Accounting invoice</span><h4>Xero or MYOB draft</h4><p>Link one of your own direct customers to this job before exporting customer details.</p></div></header></div>;

  const document = documents[0];
  const xero = providers.find((provider) => provider.provider === "xero");
  const myob = providers.find((provider) => provider.provider === "myob");
  const retryProvider = document && !document.exported ? document.provider : null;
  return <section className="crm-accounting-panel">
    <header><div><span>Accounting invoice</span><h4>Xero or MYOB draft</h4><p>Export one draft, review it in your accounting account, then refresh its payment status here. The customer is never emailed automatically.</p></div></header>
    {document?.exported ? <article className={`crm-accounting-document accounting-${document.status}`}>
      <div><span>{document.provider === "xero" ? "Xero" : "MYOB"} invoice</span><strong>{document.externalNumber || "Invoice created"}</strong><small>{statusLabels[document.status] || document.status} | {money(document.paidAmountCents)} paid of {money(document.amountCents)}{document.lastSyncedAt ? ` | Checked ${new Date(document.lastSyncedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small>{document.lastError && <em>{document.lastError === "PROVIDER_REQUEST_FAILED" ? "The last provider check failed. Reconnect the provider if this continues." : "The last sync needs attention."}</em>}</div>
      <div><button type="button" disabled={Boolean(busy)} onClick={() => void refreshInvoice()}>{busy === "refresh" ? "Checking..." : "Refresh status"}</button>{document.externalUrl && <a href={document.externalUrl} target="_blank" rel="noreferrer">Open in {document.provider === "xero" ? "Xero" : "MYOB"}</a>}</div>
    </article> : <div className="crm-accounting-create">
      <div><strong>{money(invoiceAmountCents || 0)}</strong><span>Saved invoice amount</span><small>Save an amount above $0 first. Only one accounting invoice can be linked to this job.</small></div>
      {(!retryProvider || retryProvider === "xero") && <button type="button" disabled={!xero?.connected || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("xero")}>{busy === "xero" ? "Exporting..." : !xero?.connected ? "Connect Xero first" : retryProvider ? "Retry Xero export" : "Export draft to Xero"}</button>}
      {(!retryProvider || retryProvider === "myob") && <div className="crm-myob-export">{myob?.needsReconnect ? <button type="button" disabled>Reconnect MYOB first</button> : accounts.length ? <><label><span>MYOB income account</span><select value={accountReference} onChange={(event) => setAccountReference(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} | {account.name}{account.taxCode ? ` | ${account.taxCode}` : ""}</option>)}</select></label><button type="button" disabled={!accountReference || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void exportInvoice("myob")}>{busy === "myob" ? "Exporting..." : retryProvider ? "Retry MYOB export" : "Export draft to MYOB"}</button></> : <button type="button" disabled={!myob?.connected || invoiceAmountCents <= 0 || Boolean(busy)} onClick={() => void prepareMyob()}>{busy === "prepare-myob" ? "Loading accounts..." : myob?.connected ? "Prepare MYOB export" : "Connect MYOB first"}</button>}</div>}
    </div>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
