"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type QuoteLine = { id?: string; lineType: string; description: string; quantity: string; unitPrice: string; taxCode: string; totalCents?: number };
type SavedLine = { id: string; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; totalCents: number };
type QuoteVersion = { id: string; versionNumber: number; status: string; customerEmail: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string; validUntil: string; consentStatement: string; issuedAt: string; items: SavedLine[]; acceptance: null | { decision: string; actorEmail: string; decidedAt: string; consentStatement: string } };
type Quote = { id: string; quoteNumber: string; currentVersionNumber: number; status: string; versions: QuoteVersion[] };
type QuoteResult = { ok?: boolean; authorisedEmails?: string[]; quote?: Quote | null; error?: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const blankLine = (): QuoteLine => ({ lineType: "product", description: "", quantity: "1", unitPrice: "0.00", taxCode: "gst" });
const editLine = (line: SavedLine): QuoteLine => ({ ...line, quantity: (line.quantityMilli / 1000).toString(), unitPrice: (line.unitPriceCents / 100).toFixed(2) });

export function TradeQuotePanel({ user, workOrderId, available, onChanged }: { user: User; workOrderId: string; available: boolean; onChanged?: () => void | Promise<void> }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [emails, setEmails] = useState<string[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([blankLine()]); const [customerEmail, setCustomerEmail] = useState("");
  const [terms, setTerms] = useState(""); const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");

  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-quotes${init.method ? "" : `?workOrderId=${encodeURIComponent(workOrderId)}`}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as QuoteResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The quote could not be loaded.");
    return result;
  }, [user, workOrderId]);

  const applyResult = useCallback((result: QuoteResult) => {
    setQuote(result.quote || null); if (result.authorisedEmails) setEmails(result.authorisedEmails);
    const current = result.quote?.versions.find((version) => version.versionNumber === result.quote?.currentVersionNumber);
    if (current) { setLines(current.items.map(editLine)); setCustomerEmail(current.customerEmail); setTerms(current.terms); setValidUntil(current.validUntil); }
  }, []);

  useEffect(() => {
    if (!available) return;
    const frame = window.requestAnimationFrame(() => void request().then(applyResult).catch((error) => setMessage(error.message)));
    return () => window.cancelAnimationFrame(frame);
  }, [applyResult, available, request]);

  function updateLine(index: number, field: keyof QuoteLine, value: string) { setLines((current) => current.map((line, position) => position === index ? { ...line, [field]: value } : line)); }

  async function act(action: "save_draft" | "issue_quote") {
    setBusy(action); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ action, workOrderId, lines, customerEmail, terms, validUntil }) });
      applyResult({ ...result, authorisedEmails: emails }); await onChanged?.(); setMessage(action === "issue_quote" ? "Quote issued for verified customer review." : "Quote draft saved with server-calculated totals.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote could not be updated."); }
    finally { setBusy(""); }
  }

  if (!available) return <section className="trade-quote-panel unavailable"><strong>Direct quote unavailable</strong><p>Link an authoritative direct customer and service site before creating a customer-acceptance quote. Protected marketplace jobs remain in the platform quote workflow.</p></section>;
  const current = quote?.versions.find((version) => version.versionNumber === quote.currentVersionNumber);
  const draftMode = !current || current.status === "draft";
  return <section className="trade-quote-panel">
    <header><div><span>Versioned customer quote</span><h4>{quote?.quoteNumber || "New quote"}{current ? ` | Version ${current.versionNumber}` : ""}</h4><p>Issued versions are immutable. Saving changes after issue creates the next draft version.</p></div>{current && <strong className={`quote-status ${current.status}`}>{current.status.replaceAll("_", " ")}</strong>}</header>
    <div className="trade-quote-lines"><div className="trade-quote-line headings" aria-hidden="true"><span>Type</span><span>Description</span><span>Quantity</span><span>Unit price</span><span>Tax</span><span></span></div>{lines.map((line, index) => <div className="trade-quote-line" key={`${index}:${line.id || "new"}`}><select aria-label={`Line ${index + 1} type`} value={line.lineType} onChange={(event) => updateLine(index, "lineType", event.target.value)}><option value="product">Product</option><option value="labour">Labour</option><option value="adjustment">Adjustment</option></select><input aria-label={`Line ${index + 1} description`} value={line.description} maxLength={500} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Description" /><input aria-label={`Line ${index + 1} quantity`} value={line.quantity} inputMode="decimal" onChange={(event) => updateLine(index, "quantity", event.target.value)} /><input aria-label={`Line ${index + 1} unit price`} value={line.unitPrice} inputMode="decimal" onChange={(event) => updateLine(index, "unitPrice", event.target.value)} /><select aria-label={`Line ${index + 1} tax`} value={line.taxCode} onChange={(event) => updateLine(index, "taxCode", event.target.value)}><option value="gst">GST 10%</option><option value="none">No GST</option></select><button type="button" disabled={lines.length === 1} onClick={() => setLines((currentLines) => currentLines.filter((_, position) => position !== index))}>Remove</button></div>)}</div>
    <button className="quote-add-line" type="button" onClick={() => setLines((currentLines) => [...currentLines, blankLine()])}>Add line item</button>
    <div className="trade-quote-settings"><label><span>Customer acceptance email</span><select value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)}><option value="">Choose authorised contact</option>{emails.map((email) => <option key={email}>{email}</option>)}</select><small>The customer must sign in to AEA with this verified email.</small></label><label><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label><label className="wide"><span>Recorded terms</span><textarea rows={4} maxLength={4000} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Scope assumptions, exclusions and completion terms" /></label></div>
    {current && <div className="trade-quote-totals"><div><span>Subtotal</span><strong>{money(current.subtotalCents)}</strong></div><div><span>GST</span><strong>{money(current.taxCents)}</strong></div><div><span>Total</span><strong>{money(current.totalCents)}</strong></div></div>}
    <div className="trade-quote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void act("save_draft")}>{busy === "save_draft" ? "Saving..." : draftMode ? "Save draft" : "Create next draft"}</button>{draftMode && current && <button className="primary" type="button" disabled={Boolean(busy) || !customerEmail} onClick={() => void act("issue_quote")}>{busy === "issue_quote" ? "Issuing..." : "Issue for customer review"}</button>}</div>
    {quote && quote.versions.length > 0 && <details className="trade-quote-history"><summary>Quote history ({quote.versions.length})</summary>{quote.versions.map((version) => <article key={version.id}><div><strong>Version {version.versionNumber} | {version.status.replaceAll("_", " ")}</strong><span>{money(version.totalCents)}{version.issuedAt ? ` | Issued ${new Date(version.issuedAt).toLocaleDateString("en-AU")}` : " | Draft"}</span></div>{version.acceptance && <small>{version.acceptance.decision.replaceAll("_", " ")} by verified account {version.acceptance.actorEmail} on {new Date(version.acceptance.decidedAt).toLocaleString("en-AU")}</small>}</article>)}</details>}
    {message && <p className="trade-import-status" role="status">{message}</p>}
  </section>;
}
