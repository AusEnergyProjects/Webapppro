"use client";

import dynamic from "next/dynamic";
import type { User } from "firebase/auth";
import styles from "./TradeFinanceWorkspace.module.css";

const TradeQuoteWorkspace = dynamic(() => import("./TradeQuoteWorkspace").then((module) => module.TradeQuoteWorkspace));
const TradeInvoiceWorkspace = dynamic(() => import("./TradeInvoiceWorkspace").then((module) => module.TradeInvoiceWorkspace));
const TradePriceBookWorkspace = dynamic(() => import("./TradePriceBookWorkspace").then((module) => module.TradePriceBookWorkspace));
const TradeBusinessReports = dynamic(() => import("./TradeBusinessReports").then((module) => module.TradeBusinessReports));

export type FinanceView = "quotes" | "invoices" | "pricebook" | "reports";
const sections: Array<[FinanceView, string]> = [["quotes", "Quotes"], ["invoices", "Invoices"], ["pricebook", "Price book"], ["reports", "Reports & projections"]];

export function TradeFinanceWorkspace({ user, view, priceBookView, onViewChange, onOpenJob, onNewQuote, onOpenJobs, onOpenSchedule }: {
  user: User;
  view: FinanceView;
  priceBookView: "items" | "packets";
  onViewChange: (view: FinanceView) => void;
  onOpenJob: (id: string, tab: "quote" | "invoice" | "field") => void;
  onNewQuote: () => void;
  onOpenJobs: () => void;
  onOpenSchedule: () => void;
}) {
  return <section className={styles.workspace} aria-labelledby="finance-title">
    <header className={styles.heading}><div><h2 id="finance-title">Finance</h2><p>Pricing, quotes, invoices and business performance in one place.</p></div></header>
    <nav className={styles.navigation} aria-label="Finance sections">
      {sections.map(([key, label]) => <button key={key} type="button" aria-current={view === key ? "page" : undefined} onClick={() => onViewChange(key)}>{label}</button>)}
    </nav>
    {view === "quotes" && <TradeQuoteWorkspace user={user} onOpenJob={(id) => onOpenJob(id, "quote")} onNewQuote={onNewQuote} />}
    {view === "invoices" && <TradeInvoiceWorkspace user={user} onOpenJob={(id) => onOpenJob(id, "invoice")} />}
    {view === "pricebook" && <div className={styles.priceBook}><TradePriceBookWorkspace key={priceBookView} user={user} initialView={priceBookView} /></div>}
    {view === "reports" && <TradeBusinessReports user={user} onOpenJobs={onOpenJobs} onOpenSchedule={onOpenSchedule} onOpenInvoices={() => onViewChange("invoices")} onOpenJobCosts={(id) => onOpenJob(id, "field")} />}
  </section>;
}
