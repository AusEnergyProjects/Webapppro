"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import { platformQuoteOptions as rawPlatformQuoteOptions } from "@/lib/customer-projects.mjs";
import { Field } from "./ComparatorChrome";

type Option = [string, string];
const platformQuoteOptions = rawPlatformQuoteOptions as {
  quoteTypes: Option[];
  inclusions: Option[];
  startWindows: Option[];
};

type SavedQuote = {
  productListId: string;
  inclusions: string[];
  productSubtotalCentsExGst: number;
  labourCentsExGst: number;
  otherCentsExGst: number;
  totalCentsExGst: number;
  quoteType: string;
  startWindow: string;
  durationWeeks: number;
  workmanshipWarrantyYears: number;
  status: string;
  customerDecision: string;
};

type ProductList = {
  id: string;
  name: string;
  items: Array<{ quantity: number; unitPriceCentsExGst: number }>;
};

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);

export function InstallerPlatformQuote({ matchId, initialQuote, onStatus }: { matchId: string; initialQuote: SavedQuote | null; onStatus: (message: string) => void }) {
  const [lists, setLists] = useState<ProductList[]>([]);
  const [listsReady, setListsReady] = useState(false);
  const [expanded, setExpanded] = useState(!initialQuote);
  const [saved, setSaved] = useState<SavedQuote | null>(initialQuote);
  const [busy, setBusy] = useState(false);
  const [quoteType, setQuoteType] = useState(initialQuote?.quoteType || "indicative");
  const [productListId, setProductListId] = useState(initialQuote?.productListId || "");
  const [labourDollars, setLabourDollars] = useState(String((initialQuote?.labourCentsExGst || 0) / 100 || ""));
  const [otherDollars, setOtherDollars] = useState(String((initialQuote?.otherCentsExGst || 0) / 100 || ""));
  const [startWindow, setStartWindow] = useState(initialQuote?.startWindow || "to_confirm");
  const [durationWeeks, setDurationWeeks] = useState(String(initialQuote?.durationWeeks || ""));
  const [warrantyYears, setWarrantyYears] = useState(String(initialQuote?.workmanshipWarrantyYears || ""));
  const [inclusions, setInclusions] = useState<string[]>(initialQuote?.inclusions?.length ? initialQuote.inclusions : ["installation-commissioning", "warranty-handover"]);

  useEffect(() => {
    let cancelled = false;
    async function loadLists() {
      const user = firebaseAuth.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/product-selections", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && result.ok) setLists(result.lists || []);
      } finally { if (!cancelled) setListsReady(true); }
    }
    void loadLists();
    return () => { cancelled = true; };
  }, []);

  const selectedList = lists.find((list) => list.id === productListId);
  const productSubtotal = useMemo(() => selectedList?.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCentsExGst, 0) || saved?.productSubtotalCentsExGst || 0, [saved, selectedList]);
  const estimatedTotal = productSubtotal + Math.round((Number(labourDollars) || 0) * 100) + Math.round((Number(otherDollars) || 0) * 100);
  const toggle = (value: string) => setInclusions((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = firebaseAuth.currentUser;
    if (!user) { onStatus("Sign in again before submitting a quote option."); return; }
    setBusy(true); onStatus("Submitting a structured quote option...");
    try {
      const token = await user.getIdToken();
      const payload = {
        matchId,
        action: "submit_quote",
        quoteType,
        productListId,
        inclusions,
        labourCentsExGst: Math.round((Number(labourDollars) || 0) * 100),
        otherCentsExGst: Math.round((Number(otherDollars) || 0) * 100),
        startWindow,
        durationWeeks: Number(durationWeeks) || 0,
        workmanshipWarrantyYears: Number(warrantyYears) || 0,
      };
      const response = await fetch("/api/trade-opportunities", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The quote option could not be submitted.");
      setSaved({ productListId, inclusions, productSubtotalCentsExGst: result.quote.productSubtotalCentsExGst, labourCentsExGst: payload.labourCentsExGst, otherCentsExGst: payload.otherCentsExGst, totalCentsExGst: result.quote.totalCentsExGst, quoteType, startWindow, durationWeeks: payload.durationWeeks, workmanshipWarrantyYears: payload.workmanshipWarrantyYears, status: "submitted", customerDecision: "reviewing" });
      setExpanded(false); onStatus("Quote option submitted inside the platform. No customer contact details were released.");
    } catch (error) { onStatus(error instanceof Error ? error.message : "The quote option could not be submitted."); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-opportunities", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ matchId, action: "withdraw_quote" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The quote option could not be withdrawn.");
      setSaved(null); setExpanded(true); onStatus("Quote option withdrawn.");
    } catch (error) { onStatus(error instanceof Error ? error.message : "The quote option could not be withdrawn."); }
    finally { setBusy(false); }
  }

  return <section className="installer-platform-quote" aria-label="Structured platform quote">
    <header><div><span>Platform-only response</span><h4>{saved ? "Structured quote submitted" : "Prepare a structured quote option"}</h4><p>No free-text message or customer contact channel is available.</p></div>{saved && <strong>{money(Math.round(saved.totalCentsExGst * 1.1))} incl GST</strong>}</header>
    {saved && !expanded ? <div className="installer-quote-summary"><dl><div><dt>Products</dt><dd>{money(saved.productSubtotalCentsExGst)} ex GST</dd></div><div><dt>Labour</dt><dd>{money(saved.labourCentsExGst)} ex GST</dd></div><div><dt>Other services</dt><dd>{money(saved.otherCentsExGst)} ex GST</dd></div><div><dt>Customer status</dt><dd>{saved.customerDecision === "shortlisted" ? "Shortlisted" : "Under review"}</dd></div></dl><div><button type="button" onClick={() => setExpanded(true)}>Update option</button><button type="button" onClick={() => void withdraw()} disabled={busy}>Withdraw option</button></div></div> : <form onSubmit={submit}><div className="installer-quote-field-grid"><Field label="Quote pathway"><select value={quoteType} onChange={(event) => setQuoteType(event.target.value)}>{platformQuoteOptions.quoteTypes.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Saved product list" optional="optional"><select value={productListId} onChange={(event) => setProductListId(event.target.value)}><option value="">No product list</option>{lists.map((list) => <option value={list.id} key={list.id}>{list.name} | {list.items.length} product{list.items.length === 1 ? "" : "s"}</option>)}</select></Field><Field label="Labour, ex GST"><input type="number" min="0" max="500000" step="1" value={labourDollars} onChange={(event) => setLabourDollars(event.target.value)} /></Field><Field label="Other services, ex GST"><input type="number" min="0" max="500000" step="1" value={otherDollars} onChange={(event) => setOtherDollars(event.target.value)} /></Field><Field label="Likely start"><select value={startWindow} onChange={(event) => setStartWindow(event.target.value)}>{platformQuoteOptions.startWindows.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Duration in weeks"><input type="number" min="0" max="104" step="1" value={durationWeeks} onChange={(event) => setDurationWeeks(event.target.value)} /></Field><Field label="Workmanship warranty years"><input type="number" min="0" max="30" step="1" value={warrantyYears} onChange={(event) => setWarrantyYears(event.target.value)} /></Field></div><fieldset><legend>Included services</legend><div>{platformQuoteOptions.inclusions.map(([value, label]: [string, string]) => <label className={inclusions.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={inclusions.includes(value)} onChange={() => toggle(value)} />{label}</label>)}</div></fieldset><div className="installer-quote-estimate"><span>Structured option total</span><strong>{money(Math.round(estimatedTotal * 1.1))} incl GST</strong><small>{money(estimatedTotal)} ex GST. Product prices are copied from the selected saved list.</small></div>{!listsReady && <p>Loading saved product lists...</p>}<div className="installer-quote-actions">{saved && <button type="button" onClick={() => setExpanded(false)}>Cancel update</button>}<button className="primary" disabled={busy}>{busy ? "Submitting..." : saved ? "Update quote option" : "Submit quote option"}</button></div></form>}
  </section>;
}
