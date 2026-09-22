"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";

type QuoteJob = {
  id: string;
  workNumber: string;
  title: string;
  customerDisplayName?: string;
  quoteStatus: string;
  jobRegister: { quoteTotalExGstCents: number | null };
};
type QuoteIndex = {
  ok?: boolean;
  error?: string;
  items?: QuoteJob[];
  pagination?: { page: number; pageSize: number; total: number; pageCount: number; hasNext: boolean; nextCursor: string };
};
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const statuses: Record<string, string> = {
  not_started: "Not quoted", draft: "Draft", issued: "Issued", sent: "Sent", accepted: "Accepted", declined: "Declined", restricted: "Restricted",
};

export function TradeQuoteWorkspace({ user, onOpenJob, onNewQuote }: {
  user: User;
  onOpenJob: (workOrderId: string) => void;
  onNewQuote: () => void;
}) {
  const [search, setSearch] = useState("");
  const [navigation, setNavigation] = useState({ search: "", page: 1, cursors: [""] });
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<QuoteIndex>({});
  const [settledKey, setSettledKey] = useState("");
  const [requestError, setError] = useState("");
  const cursor = navigation.cursors[navigation.page - 1];
  const requestKey = JSON.stringify([user.uid, navigation.search, navigation.page, cursor, refresh]);
  const loading = settledKey !== requestKey;
  const error = loading ? "" : requestError;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (active) { setSettledKey(requestKey); setError("Quotes took too long to load. Try again."); }
    }, 25000);
    const params = new URLSearchParams({ mode: "index", resource: "jobs", filter: "all", sort: "updated-desc", search: navigation.search, page: String(navigation.page), pageSize: "25" });
    if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json().catch(() => ({})) as QuoteIndex;
        if (!response.ok || !result.ok) throw new Error(result.error || "Quotes could not be loaded.");
        if (!Array.isArray(result.items) || !result.pagination || (result.pagination.hasNext && !result.pagination.nextCursor)) throw new Error("The quote list could not be loaded. Try again.");
        if (active && !controller.signal.aborted) { setData(result); setError(""); }
      } catch (failure) {
        if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Quotes could not be loaded.");
      } finally {
        clearTimeout(timer);
        if (active && !controller.signal.aborted) setSettledKey(requestKey);
      }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [user, navigation.search, navigation.page, cursor, requestKey]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNavigation({ search: search.trim(), page: 1, cursors: [""] });
  }

  const pagination = data.pagination;
  const items = data.items || [];
  return <section className="dashboard-panel invoice-workspace" aria-label="Quotes">
    <header className="crm-page-heading">
      <div><span>Quotes</span><h3>Quotes and jobs to quote</h3><p>Review a quote or open a job to prepare one. Jobs without a quote are included.</p></div>
      <button type="button" className="crm-new-button" onClick={onNewQuote}>New quote</button>
    </header>
    <form className="invoice-toolbar" onSubmit={applySearch}>
      <label><span>Find a quote or job</span><input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Job number, job title or customer" /></label>
      <div><button type="submit">Search</button>{navigation.search && <button type="button" onClick={() => { setSearch(""); setNavigation({ search: "", page: 1, cursors: [""] }); }}>Clear</button>}<button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    </form>
    {loading ? <div className="crm-empty" role="status"><strong>Loading quotes</strong><span>Opening current job and quote records.</span></div> : error ? <div className="crm-empty" role="alert"><strong>{error}</strong><button type="button" className="crm-back-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div> : <>
      <div className="invoice-list" role="list" aria-label="Quotes and jobs">
        {items.length ? items.map(item => <article key={item.id} role="listitem">
          <div><span>{item.workNumber}</span><strong>{item.title}</strong><small>{item.customerDisplayName || "Customer not added"}</small></div>
          <div><span>Quote status</span><strong>{statuses[item.quoteStatus] || item.quoteStatus.replaceAll("_", " ")}</strong></div>
          <div><span>Quote total ex GST</span><strong>{item.quoteStatus === "restricted" ? "Restricted" : item.jobRegister.quoteTotalExGstCents === null ? "Not quoted" : money(item.jobRegister.quoteTotalExGstCents)}</strong></div>
          <button type="button" disabled={item.quoteStatus === "restricted"} onClick={() => onOpenJob(item.id)}>{item.quoteStatus === "not_started" ? "Open job" : "Open quote"}</button>
        </article>) : <div className="crm-empty"><strong>{navigation.search ? "No jobs match this search" : "No jobs to quote yet"}</strong><span>{navigation.search ? "Try a different job number or customer name." : "Start a new quote to add its customer and job."}</span></div>}
      </div>
      {pagination && <nav className="workspace-list-controls" aria-label="Quote list pages">
        <div className="workspace-list-range"><strong>{pagination.total ? `${(navigation.page - 1) * pagination.pageSize + 1}-${Math.min(navigation.page * pagination.pageSize, pagination.total)}` : "0"}</strong><span>of {pagination.total} jobs</span></div>
        <div className="workspace-list-pages">
          <button type="button" disabled={navigation.page <= 1} onClick={() => setNavigation(current => ({ ...current, page: current.page - 1 }))}>Previous</button>
          <span>Page {navigation.page} of {Math.max(1, pagination.pageCount)}</span>
          <button type="button" disabled={!pagination.hasNext} onClick={() => setNavigation(current => ({ ...current, page: current.page + 1, cursors: [...current.cursors.slice(0, current.page), pagination.nextCursor] }))}>Next</button>
        </div>
      </nav>}
    </>}
  </section>;
}
