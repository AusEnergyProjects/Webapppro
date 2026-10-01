"use client";

import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { TRADE_QUOTE_VIEWS, tradeQuoteIndexStatusLabel, type TradeQuoteIndex, type TradeQuoteView } from "@/lib/trade-crm-quote-index";
import styles from "./TradeQuoteWorkspace.module.css";

type QuoteResponse = Partial<TradeQuoteIndex> & {
  ok?: boolean;
  error?: string;
  access?: { permissions?: { canManageQuotes?: boolean; jobScope?: string } };
};
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export function TradeQuoteWorkspace({ user, onOpenJob, onNewQuote }: {
  user: User;
  onOpenJob: (workOrderId: string, tab?: "quote" | "summary") => void;
  onNewQuote: () => void;
}) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const [search, setSearch] = useState("");
  const [navigation, setNavigation] = useState<{ search: string; view: TradeQuoteView; page: number; cursors: string[] }>({ search: "", view: "preparing", page: 1, cursors: [""] });
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<QuoteResponse>({});
  const [settledKey, setSettledKey] = useState("");
  const [requestError, setError] = useState("");
  const cursor = navigation.cursors[navigation.page - 1];
  const requestKey = JSON.stringify([user.uid, business?.ownerUid, navigation.search, navigation.view, navigation.page, cursor, refresh]);
  const loading = settledKey !== requestKey;
  const error = loading ? "" : requestError;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (active) { setSettledKey(requestKey); setError("Quotes took too long to load. Try again."); }
    }, 25000);
    const params = new URLSearchParams({ mode: "index", resource: "quotes", view: navigation.view, search: navigation.search, page: String(navigation.page), pageSize: "25" });
    if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json().catch(() => ({})) as QuoteResponse;
        if (!response.ok || !result.ok) throw new Error(result.error || "Quotes could not be loaded.");
        if (!Array.isArray(result.items) || !result.counts || !result.pagination || (result.pagination.hasNext && !result.pagination.nextCursor)) throw new Error("The quote list could not be loaded. Try again.");
        if (active && !controller.signal.aborted) { setData(result); setError(""); }
      } catch (failure) {
        if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Quotes could not be loaded.");
      } finally {
        clearTimeout(timer);
        if (active && !controller.signal.aborted) setSettledKey(requestKey);
      }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [fetch, user, navigation.search, navigation.view, navigation.page, cursor, requestKey]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNavigation(current => ({ ...current, search: search.trim(), page: 1, cursors: [""] }));
  }

  const pagination = data.pagination;
  const items = data.items || [];
  const currentView = TRADE_QUOTE_VIEWS.find(view => view.key === navigation.view)!;
  const canCreate = !loading && !error && data.access?.permissions?.canManageQuotes && data.access.permissions.jobScope === "team";
  return <section className="dashboard-panel invoice-workspace" aria-label="Quotes">
    <header className="crm-page-heading">
      <div><span>Quotes</span><h3>From first draft to agreed work</h3><p>Prepare, send and track each quote in one place.</p></div>
      {canCreate && <button type="button" className="crm-new-button" onClick={onNewQuote}>New quote</button>}
    </header>
    <nav className={styles.views} aria-label="Quote views">
      {TRADE_QUOTE_VIEWS.map(view => <button key={view.key} type="button" aria-pressed={navigation.view === view.key}
        onClick={() => setNavigation(current => ({ ...current, view: view.key, page: 1, cursors: [""] }))}>
        {view.label}<span>{loading || error ? "" : data.counts?.[view.key] ?? 0}</span>
      </button>)}
    </nav>
    <p className={styles.description}>{currentView.description}</p>
    <form className="invoice-toolbar" onSubmit={applySearch}>
      <label><span>Find a quote</span><input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Quote number, job or customer" /></label>
      <div><button type="submit">Search</button>{navigation.search && <button type="button" onClick={() => { setSearch(""); setNavigation(current => ({ ...current, search: "", page: 1, cursors: [""] })); }}>Clear</button>}<button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    </form>
    {loading ? <div className="crm-empty" role="status"><strong>Loading quotes</strong><span>Opening {currentView.label.toLowerCase()}.</span></div> : error ? <div className="crm-empty" role="alert"><strong>{error}</strong><button type="button" className="crm-back-button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div> : <>
      <div className={styles.list} role="list" aria-label={currentView.label}>
        {items.length ? items.map(item => <article key={item.id} role="listitem">
          <div><span>{item.quoteNumber || item.workNumber}{item.versionNumber ? ` · Version ${item.versionNumber}` : ""}</span><strong>{item.title}</strong><small>{item.customerName || (item.status === "customer_changed" ? "Previous customer quote" : item.title === "Protected job" ? "Customer details protected" : "Customer not added")}{item.quoteNumber ? ` · ${item.workNumber}` : ""}</small></div>
          <div><strong className={styles.status}>{tradeQuoteIndexStatusLabel(item.status)}</strong>
            {item.latestIssued && <small>Version {item.latestIssued.versionNumber}: {tradeQuoteIndexStatusLabel(item.latestIssued.status)}{item.latestIssued.decidedAt ? ` · ${date(item.latestIssued.decidedAt)}` : ""}</small>}
            {item.latestIssued && <small>{item.delivery?.label || "No customer email recorded"}</small>}
          </div>
          <div><span>{item.status === "accepted" ? "Agreed total incl GST" : "Quote total incl GST"}</span><strong>{item.totalCents === null ? "Not priced" : money(item.totalCents)}</strong>
            {item.hasChoices && item.status !== "accepted" && <small>Default choices, before optional extras</small>}
          </div>
          <button type="button" onClick={() => onOpenJob(item.id, navigation.view === "accepted" ? "summary" : "quote")}>{navigation.view === "accepted" ? "Prepare job" : item.status === "not_started" ? "Prepare quote" : navigation.view === "history" ? "View record" : "Open quote"}</button>
        </article>) : <div className="crm-empty"><strong>{navigation.search ? "No quotes match this search" : `No quotes ${navigation.view === "preparing" ? "being prepared" : navigation.view === "awaiting" ? "awaiting a customer" : navigation.view === "accepted" ? "accepted yet" : "in history"}`}</strong><span>{navigation.search ? "Try a different quote number or customer name, or choose another view." : navigation.view === "preparing" ? "Use New quote when you are ready to prepare a price." : "Quotes move here when their status changes."}</span></div>}
      </div>
      {pagination && <nav className="workspace-list-controls" aria-label="Quote list pages">
        <div className="workspace-list-range"><strong>{pagination.total ? `${(navigation.page - 1) * pagination.pageSize + 1}-${Math.min(navigation.page * pagination.pageSize, pagination.total)}` : "0"}</strong><span>of {pagination.total} quotes</span></div>
        <div className="workspace-list-pages">
          <button type="button" disabled={navigation.page <= 1} onClick={() => setNavigation(current => ({ ...current, page: current.page - 1 }))}>Previous</button>
          <span>Page {navigation.page} of {Math.max(1, pagination.pageCount)}</span>
          <button type="button" disabled={!pagination.hasNext} onClick={() => setNavigation(current => ({ ...current, page: current.page + 1, cursors: [...current.cursors.slice(0, current.page), pagination.nextCursor] }))}>Next</button>
        </div>
      </nav>}
    </>}
  </section>;
}
