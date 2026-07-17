"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type QuoteLine = { id: string; position: number; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; subtotalCents: number; taxCents: number; totalCents: number };
type CustomerQuote = {
  id: string; quoteNumber: string; versionNumber: number; status: string; workNumber: string; workTitle: string; customerNumber: string;
  customerName: string; siteLabel: string; siteSummary: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string;
  validUntil: string; consentStatement: string; issuedAt: string; decision: string; decidedAt: string; items: QuoteLine[];
};
type QuoteResult = { ok?: boolean; quotes?: CustomerQuote[]; error?: string };
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const quantity = (milli: number) => (milli / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });

export function CustomerTradeQuotes({ user }: { user: User }) {
  const [quotes, setQuotes] = useState<CustomerQuote[]>([]); const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch("/api/customer-trade-quotes", { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as QuoteResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "Your direct trade quotes could not be loaded.");
    return result;
  }, [user]);
  const load = useCallback(async () => { const result = await request(); setQuotes(result.quotes || []); }, [request]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load().catch((error) => setMessage(error.message))); return () => window.cancelAnimationFrame(frame); }, [load]);
  async function decide(quote: CustomerQuote, decision: "accepted" | "declined") {
    setBusy(`${decision}:${quote.id}`); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ quoteVersionId: quote.id, decision, consentConfirmed: decision === "accepted" && confirmed[quote.id] === true }) });
      setQuotes(result.quotes || []); setMessage(decision === "accepted" ? "Quote accepted. Your verified account evidence and the exact version are recorded." : "Quote declined. The installer can prepare a new version if required.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your decision could not be recorded."); }
    finally { setBusy(""); }
  }
  return <section className="customer-trade-quotes">
    <header><div><span>Direct customer agreements</span><h2>Quotes from trades you contacted</h2><p>Review immutable quote versions linked to your verified email, customer record and service site.</p></div><strong>{quotes.filter((quote) => quote.status === "issued" && (!quote.validUntil || quote.validUntil >= new Date().toISOString().slice(0, 10))).length} awaiting decision</strong></header>
    {quotes.length ? <div className="customer-trade-quote-list">{quotes.map((quote) => { const expired = Boolean(quote.validUntil && quote.validUntil < new Date().toISOString().slice(0, 10)); return <article key={quote.id} className={expired ? "expired" : quote.status}><header><div><span>{quote.quoteNumber} | Version {quote.versionNumber}</span><h3>{quote.workTitle}</h3><p>{quote.customerName} | {quote.siteLabel}{quote.siteSummary ? ` | ${quote.siteSummary}` : ""}</p></div><strong>{expired && quote.status === "issued" ? "expired" : quote.status.replaceAll("_", " ")}</strong></header><div className="customer-trade-quote-lines"><div className="head"><span>Description</span><span>Quantity</span><span>Unit price</span><span>Tax</span><span>Total</span></div>{quote.items.map((line) => <div key={line.id}><span><strong>{line.description}</strong><small>{line.lineType.replaceAll("_", " ")}</small></span><span>{quantity(line.quantityMilli)}</span><span>{money(line.unitPriceCents)}</span><span>{line.taxCode === "gst" ? money(line.taxCents) : "No GST"}</span><strong>{money(line.totalCents)}</strong></div>)}</div><dl><div><dt>Subtotal</dt><dd>{money(quote.subtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(quote.taxCents)}</dd></div><div><dt>Total</dt><dd>{money(quote.totalCents)}</dd></div></dl><section className="customer-quote-terms"><strong>Recorded terms</strong><p>{quote.terms || "No additional terms recorded."}</p><small>Issued {new Date(quote.issuedAt).toLocaleString("en-AU")}{quote.validUntil ? ` | Valid until ${new Date(`${quote.validUntil}T00:00:00`).toLocaleDateString("en-AU")}` : ""}</small></section>{quote.status === "issued" && !expired ? <section className="customer-quote-decision"><label><input type="checkbox" checked={confirmed[quote.id] === true} onChange={(event) => setConfirmed((current) => ({ ...current, [quote.id]: event.target.checked }))} /><span>{quote.consentStatement}</span></label><div><button type="button" disabled={Boolean(busy)} onClick={() => void decide(quote, "declined")}>Decline this version</button><button className="primary" type="button" disabled={Boolean(busy) || !confirmed[quote.id]} onClick={() => void decide(quote, "accepted")}>{busy === `accepted:${quote.id}` ? "Recording..." : "Accept this exact version"}</button></div></section> : <section className="customer-quote-recorded"><strong>{quote.decision ? `${quote.decision.replaceAll("_", " ")} on ${new Date(quote.decidedAt).toLocaleString("en-AU")}` : expired ? "This quote version has expired." : "This version has been superseded."}</strong><p>{quote.decision ? "Your verified account and the exact consent statement are retained with this decision." : expired ? "Ask the installer to issue a current version before accepting work." : "Review the newer issued version before making a decision."}</p></section>}</article>; })}</div> : <div className="customer-empty-state"><span>No direct quotes</span><h3>No trade quote is waiting for this verified email</h3><p>An installer must issue a version to an authorised customer contact before it appears here.</p></div>}
    {message && <p className="customer-dashboard-status" role="status">{message}</p>}
  </section>;
}
