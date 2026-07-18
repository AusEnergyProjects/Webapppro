"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type QuoteLine = { id: string; position: number; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; subtotalCents: number; taxCents: number; totalCents: number; sectionHeading: string };
type CustomerChoice = { id: string; kind: "package" | "addon" | "choose_one"; groupKey: string; name: string; summary: string; recommended: boolean; subtotalCents: number; taxCents: number; totalCents: number; items: QuoteLine[] };
type CustomerQuote = { id: string; quoteNumber: string; versionNumber: number; status: string; workNumber: string; workTitle: string; customerNumber: string; customerName: string; siteLabel: string; siteSummary: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string; validUntil: string; consentStatement: string; issuedAt: string; decision: string; decidedAt: string; selectedChoiceIds: string[]; selectedSubtotalCents: number; selectedTaxCents: number; selectedTotalCents: number; selectionSummary: string; items: QuoteLine[]; choices: CustomerChoice[] };
type QuoteResult = { ok?: boolean; quotes?: CustomerQuote[]; error?: string };
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const quantity = (milli: number) => (milli / 1000).toLocaleString("en-AU", { maximumFractionDigits: 3 });

function initialSelection(quote: CustomerQuote) {
  if (quote.selectedChoiceIds.length) return quote.selectedChoiceIds;
  const selected: string[] = []; const groups = new Map<string, CustomerChoice[]>();
  for (const choice of quote.choices) {
    if (choice.kind === "addon") continue;
    const key = `${choice.kind}:${choice.groupKey}`; groups.set(key, [...(groups.get(key) || []), choice]);
  }
  for (const group of groups.values()) selected.push((group.find((choice) => choice.recommended) || group[0]).id);
  return selected;
}

function ScopeLines({ lines }: { lines: QuoteLine[] }) {
  const sections = [...new Set(lines.map((line) => line.sectionHeading || "Included work"))];
  return <div className="customer-quote-sections">{sections.map((section) => <section key={section}><h4>{section}</h4>{lines.filter((line) => (line.sectionHeading || "Included work") === section).map((line) => <div key={line.id}><span><strong>{line.description}</strong><small>{quantity(line.quantityMilli)} x {money(line.unitPriceCents)}{line.taxCode === "gst" ? " + GST" : ""}</small></span><strong>{money(line.totalCents)}</strong></div>)}</section>)}</div>;
}

function QuoteReview({ quote, busy, confirmed, selection, onConfirm, onSelection, onDecision }: { quote: CustomerQuote; busy: string; confirmed: boolean; selection: string[]; onConfirm: (value: boolean) => void; onSelection: (ids: string[]) => void; onDecision: (decision: "accepted" | "declined") => void }) {
  const expired = Boolean(quote.validUntil && quote.validUntil < new Date().toISOString().slice(0, 10));
  const selectedChoices = quote.choices.filter((choice) => selection.includes(choice.id));
  const totals = quote.decision ? { subtotal: quote.selectedSubtotalCents || quote.subtotalCents, tax: quote.selectedTaxCents || quote.taxCents, total: quote.selectedTotalCents || quote.totalCents }
    : { subtotal: quote.subtotalCents + selectedChoices.reduce((sum, item) => sum + item.subtotalCents, 0), tax: quote.taxCents + selectedChoices.reduce((sum, item) => sum + item.taxCents, 0), total: quote.totalCents + selectedChoices.reduce((sum, item) => sum + item.totalCents, 0) };
  const groups = [...new Set(quote.choices.filter((choice) => choice.kind !== "addon").map((choice) => `${choice.kind}:${choice.groupKey}`))];
  function choose(choice: CustomerChoice, checked: boolean) {
    if (choice.kind === "addon") return onSelection(checked ? [...selection, choice.id] : selection.filter((id) => id !== choice.id));
    const groupIds = quote.choices.filter((item) => item.kind === choice.kind && item.groupKey === choice.groupKey).map((item) => item.id);
    onSelection([...selection.filter((id) => !groupIds.includes(id)), choice.id]);
  }
  return <article className={expired ? "expired" : quote.status}>
    <header><div><span>{quote.quoteNumber} | Version {quote.versionNumber}</span><h3>{quote.workTitle}</h3><p>{quote.customerName} | {quote.siteLabel}{quote.siteSummary ? ` | ${quote.siteSummary}` : ""}</p></div><strong>{expired && quote.status === "issued" ? "expired" : quote.status.replaceAll("_", " ")}</strong></header>
    {quote.items.length > 0 && <section className="customer-quote-included"><div><span>Included with every choice</span><strong>{money(quote.totalCents)}</strong></div><ScopeLines lines={quote.items} /></section>}
    {groups.map((groupKey) => { const group = quote.choices.filter((choice) => `${choice.kind}:${choice.groupKey}` === groupKey); const title = group[0]?.kind === "package" ? "Choose your package" : "Choose one approach"; return <fieldset className="customer-quote-choice-group" key={groupKey} disabled={quote.status !== "issued" || expired}><legend>{title}</legend><div>{group.map((choice) => <label key={choice.id} className={`${selection.includes(choice.id) ? "selected" : ""} ${choice.recommended ? "recommended" : ""}`}><input type="radio" name={`${quote.id}:${groupKey}`} checked={selection.includes(choice.id)} onChange={() => choose(choice, true)} /><span><span>{choice.recommended ? "Recommended" : choice.kind === "package" ? "Package" : "Option"}</span><strong>{choice.name}</strong><small>{choice.summary}</small><b>{money(choice.totalCents)} incl GST</b></span><ScopeLines lines={choice.items} /></label>)}</div></fieldset>; })}
    {quote.choices.some((choice) => choice.kind === "addon") && <fieldset className="customer-quote-choice-group addons" disabled={quote.status !== "issued" || expired}><legend>Optional extras</legend><p>Add only what is useful now.</p><div>{quote.choices.filter((choice) => choice.kind === "addon").map((choice) => <label key={choice.id} className={selection.includes(choice.id) ? "selected" : ""}><input type="checkbox" checked={selection.includes(choice.id)} onChange={(event) => choose(choice, event.target.checked)} /><span><strong>{choice.name}</strong><small>{choice.summary}</small><b>+ {money(choice.totalCents)} incl GST</b></span><ScopeLines lines={choice.items} /></label>)}</div></fieldset>}
    <aside className="customer-quote-live-total" aria-live="polite"><span>Your selected quote</span><dl><div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>GST</dt><dd>{money(totals.tax)}</dd></div><div><dt>Total</dt><dd>{money(totals.total)}</dd></div></dl><small>Calculated by TLink from this exact quote version and your current choices.</small></aside>
    <section className="customer-quote-terms"><strong>Scope and terms</strong><p>{quote.terms || "No additional terms recorded."}</p><small>Issued {new Date(quote.issuedAt).toLocaleString("en-AU")}{quote.validUntil ? ` | Valid until ${new Date(`${quote.validUntil}T00:00:00`).toLocaleDateString("en-AU")}` : ""}</small></section>
    {quote.status === "issued" && !expired ? <section className="customer-quote-decision"><label><input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} /><span>I accept quote {quote.quoteNumber} version {quote.versionNumber} with the choices shown above for {money(totals.total)}, subject to the recorded terms.</span></label><div><button type="button" disabled={Boolean(busy)} onClick={() => onDecision("declined")}>Decline this version</button><button className="primary" type="button" disabled={Boolean(busy) || !confirmed} onClick={() => onDecision("accepted")}>{busy === `accepted:${quote.id}` ? "Recording..." : "Accept selected quote"}</button></div></section>
      : <section className="customer-quote-recorded"><strong>{quote.decision ? `${quote.decision.replaceAll("_", " ")} on ${new Date(quote.decidedAt).toLocaleString("en-AU")}` : expired ? "This quote version has expired." : "This version has been superseded."}</strong><p>{quote.decision ? `${quote.selectionSummary || "The exact quote"} and ${money(quote.selectedTotalCents || quote.totalCents)} are retained with your verified decision.` : expired ? "Ask the installer to issue a current version before accepting work." : "Review the newer issued version before making a decision."}</p></section>}
  </article>;
}

export function CustomerTradeQuotes({ user }: { user: User }) {
  const [quotes, setQuotes] = useState<CustomerQuote[]>([]); const [confirmed, setConfirmed] = useState<Record<string, boolean>>({}); const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`); if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch("/api/customer-trade-quotes", { ...init, headers, cache: "no-store" }); const result = await response.json().catch(() => ({})) as QuoteResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "Your direct trade quotes could not be loaded."); return result;
  }, [user]);
  const applyQuotes = useCallback((next: CustomerQuote[]) => { setQuotes(next); setSelections((current) => { const updated = { ...current }; for (const quote of next) if (!updated[quote.id]) updated[quote.id] = initialSelection(quote); return updated; }); }, []);
  const load = useCallback(async () => { const result = await request(); applyQuotes(result.quotes || []); }, [applyQuotes, request]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load().catch((error) => setMessage(error.message))); return () => window.cancelAnimationFrame(frame); }, [load]);
  async function decide(quote: CustomerQuote, decision: "accepted" | "declined") {
    setBusy(`${decision}:${quote.id}`); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ quoteVersionId: quote.id, decision, selectedChoiceIds: selections[quote.id] || [], consentConfirmed: decision === "accepted" && confirmed[quote.id] === true }) });
      applyQuotes(result.quotes || []); setMessage(decision === "accepted" ? "Quote accepted. Your exact choices, total and verified account evidence are recorded." : "Quote declined. The installer can prepare a new version if required.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your decision could not be recorded."); } finally { setBusy(""); }
  }
  const awaiting = useMemo(() => quotes.filter((quote) => quote.status === "issued" && (!quote.validUntil || quote.validUntil >= new Date().toISOString().slice(0, 10))).length, [quotes]);
  return <section className="customer-trade-quotes"><header><div><span>Direct customer agreements</span><h2>Clear choices, one confirmed total</h2><p>Compare what changes, choose what suits you and accept the exact immutable quote from your verified account.</p></div><strong>{awaiting} awaiting decision</strong></header>
    {quotes.length ? <div className="customer-trade-quote-list">{quotes.map((quote) => <QuoteReview key={quote.id} quote={quote} busy={busy} confirmed={confirmed[quote.id] === true} selection={selections[quote.id] || initialSelection(quote)} onConfirm={(value) => setConfirmed((current) => ({ ...current, [quote.id]: value }))} onSelection={(ids) => { setSelections((current) => ({ ...current, [quote.id]: ids })); setConfirmed((current) => ({ ...current, [quote.id]: false })); }} onDecision={(decision) => void decide(quote, decision)} />)}</div>
      : <div className="customer-empty-state"><span>No direct quotes</span><h3>No trade quote is waiting for this verified email</h3><p>An installer must issue a version to an authorised customer contact before it appears here.</p></div>}
    {message && <p className="customer-dashboard-status" role="status">{message}</p>}
  </section>;
}
