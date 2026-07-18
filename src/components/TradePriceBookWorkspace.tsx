"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { dollarsToCents } from "@/lib/trade-quote";
import { calculatePriceBookRates, PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_TYPE_LABELS, PRICE_BOOK_UNITS, type PriceBookItemType } from "@/lib/trade-price-book";
import { TradeJobPacketWorkspace } from "./TradeJobPacketWorkspace";
import styles from "./TradePriceBookWorkspace.module.css";

type PriceBookItem = {
  id: string; itemCode: string; name: string; description: string; itemType: PriceBookItemType; unitLabel: string;
  supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number;
  marginBasisPoints: number; expectedDurationMinutes: number; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string; recordStatus: string; priceRevision: number; createdAt: string; updatedAt: string;
};
type CatalogueOption = { id: string; supplierSku: string; name: string; supplierCostCentsExGst: number; supplierName: string };
type PriceHistory = { priceRevision: number; supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number; marginBasisPoints: number; changeType: string; changedAt: string };
type Result = { ok?: boolean; items?: PriceBookItem[]; item?: PriceBookItem; counts?: { total: number; active: number; archived: number };
  capabilityOptions?: string[]; catalogueOptions?: CatalogueOption[]; history?: PriceHistory[]; error?: string };
type Draft = { name: string; description: string; itemType: PriceBookItemType; unitLabel: string; supplierCost: string;
  sellPrice: string; taxCode: string; expectedDurationMinutes: string; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const percentage = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;
const words = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const blankDraft = (): Draft => ({ name: "", description: "", itemType: "material", unitLabel: "each", supplierCost: "0.00",
  sellPrice: "", taxCode: "gst", expectedDurationMinutes: "0", requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "" });
const editDraft = (item: PriceBookItem): Draft => ({ name: item.name, description: item.description, itemType: item.itemType,
  unitLabel: item.unitLabel, supplierCost: (item.supplierCostCentsExGst / 100).toFixed(2), sellPrice: (item.sellPriceCentsExGst / 100).toFixed(2),
  taxCode: item.taxCode, expectedDurationMinutes: String(item.expectedDurationMinutes), requiredSkill: item.requiredSkill,
  supplierName: item.supplierName, supplierSku: item.supplierSku, supplierProductId: item.supplierProductId });

export function TradePriceBookWorkspace({ user }: { user: User }) {
  const [libraryView, setLibraryView] = useState<"items" | "packets">("items");
  const [items, setItems] = useState<PriceBookItem[]>([]); const [counts, setCounts] = useState({ total: 0, active: 0, archived: 0 });
  const [capabilities, setCapabilities] = useState<string[]>([]); const [catalogue, setCatalogue] = useState<CatalogueOption[]>([]);
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("active"); const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PriceBookItem | "new" | null>(null); const [draft, setDraft] = useState<Draft>(blankDraft());
  const [history, setHistory] = useState<PriceHistory[]>([]); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");

  const request = useCallback(async (path = "", init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-price-book${path}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The price book could not be loaded.");
    return result;
  }, [user]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, { signal });
    if (signal?.aborted) return;
    setItems(result.items || []); setCounts(result.counts || { total: 0, active: 0, archived: 0 });
    setCapabilities(result.capabilityOptions || []); setCatalogue(result.catalogueOptions || []);
  }, [request, search, status]);

  useEffect(() => {
    const controller = new AbortController(); const timer = window.setTimeout(() => {
      setLoading(true); void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  const preview = useMemo(() => {
    try {
      const allowNegative = draft.itemType === "discount" || draft.itemType === "rebate";
      const cost = dollarsToCents(draft.supplierCost || "0"); const sell = dollarsToCents(draft.sellPrice, allowNegative);
      return { cost, sell, ...calculatePriceBookRates(cost, sell) };
    } catch { return null; }
  }, [draft.itemType, draft.sellPrice, draft.supplierCost]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }

  function startNew(preset?: "labour" | "material" | "call_out") {
    const next = blankDraft();
    if (preset === "labour") Object.assign(next, { itemType: "labour", unitLabel: "hour", name: "Labour" });
    if (preset === "material") Object.assign(next, { itemType: "material", unitLabel: "each" });
    if (preset === "call_out") Object.assign(next, { itemType: "call_out", unitLabel: "visit", name: "Call-out" });
    setEditing("new"); setDraft(next); setHistory([]); setMessage("");
  }

  async function edit(item: PriceBookItem) {
    setEditing(item); setDraft(editDraft(item)); setHistory([]); setMessage("");
    try { const result = await request(`?itemId=${encodeURIComponent(item.id)}`); setHistory(result.history || []); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Price history could not be loaded."); }
  }

  function chooseCatalogue(id: string) {
    const option = catalogue.find((item) => item.id === id);
    setDraft((current) => option ? { ...current, supplierProductId: option.id, supplierName: option.supplierName,
      supplierSku: option.supplierSku, supplierCost: (option.supplierCostCentsExGst / 100).toFixed(2), name: current.name || option.name } : {
      ...current, supplierProductId: "", supplierName: "", supplierSku: "",
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("save"); setMessage("");
    try {
      const isNew = editing === "new"; const itemId = typeof editing === "object" && editing ? editing.id : "";
      await request("", { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ action: isNew ? "create" : "update", itemId, ...draft }) });
      await load(); setEditing(null); setMessage(isNew ? "Saved. This item is ready to add to quotes." : "Changes saved. Price changes are kept in history.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The price-book item could not be saved."); }
    finally { setBusy(""); }
  }

  async function archive(item: PriceBookItem) {
    if (!window.confirm(`Archive ${item.name}? It will stop appearing in new quotes, while existing quote versions stay unchanged.`)) return;
    setBusy(`archive:${item.id}`); setMessage("");
    try { await request("", { method: "PATCH", body: JSON.stringify({ action: "archive", itemId: item.id }) }); await load(); setEditing(null); setMessage("Item archived. Existing quote versions remain unchanged."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The item could not be archived."); }
    finally { setBusy(""); }
  }

  return <section className={styles.workspace} aria-labelledby={libraryView === "items" ? "price-book-title" : "job-packets-title"}>
    <nav className={styles.librarySwitch} aria-label="Pricing library">
      <button type="button" className={libraryView === "items" ? styles.libraryActive : ""} onClick={() => setLibraryView("items")}>Price-book items</button>
      <button type="button" className={libraryView === "packets" ? styles.libraryActive : ""} onClick={() => setLibraryView("packets")}>Job packets</button>
    </nav>
    {libraryView === "packets" ? <TradeJobPacketWorkspace user={user} onOpenItems={() => setLibraryView("items")} /> : <>
    <header className={styles.hero}><div><span>Commercial source of truth</span><h3 id="price-book-title">Price book</h3><p>Save common work once, then add it to a quote in one choice with the right price and GST.</p></div><button type="button" onClick={() => startNew()}>New item</button></header>
    <div className={styles.metrics}><article><span>Ready to quote</span><strong>{counts.active}</strong></article><article><span>Archived</span><strong>{counts.archived}</strong></article><article><span>Total history</span><strong>{counts.total}</strong></article></div>

    {editing ? <form className={styles.editor} onSubmit={save}>
      <header><div><span>{editing === "new" ? "Add once, reuse everywhere" : editing.itemCode}</span><h4>{editing === "new" ? "New price-book item" : `Edit ${editing.name}`}</h4><p>Only the name, type and sell price are essential. Open more details when they help the team.</p></div><button type="button" className={styles.secondary} onClick={() => setEditing(null)}>Back to price book</button></header>
      {editing === "new" && <div className={styles.presets}><span>Quick start</span><button type="button" onClick={() => startNew("labour")}>Labour hour</button><button type="button" onClick={() => startNew("material")}>Material</button><button type="button" onClick={() => startNew("call_out")}>Call-out</button></div>}
      {editing !== "new" && editing.recordStatus === "archived" && <p className={styles.archived}>Archived items are read only and stay available in price history.</p>}
      <fieldset className={styles.fields} disabled={editing !== "new" && editing.recordStatus === "archived"}>
      <div className={styles.coreFields}>
        <label><span>Item name</span><input required maxLength={140} value={draft.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Licensed electrician labour" /></label>
        <label><span>Type</span><select value={draft.itemType} onChange={(event) => change("itemType", event.target.value as PriceBookItemType)}>{PRICE_BOOK_ITEM_TYPES.map((type) => <option key={type} value={type}>{PRICE_BOOK_TYPE_LABELS[type]}</option>)}</select></label>
        <label><span>Sell price ex GST</span><input required inputMode="decimal" value={draft.sellPrice} onChange={(event) => change("sellPrice", event.target.value)} placeholder={draft.itemType === "discount" || draft.itemType === "rebate" ? "-100.00" : "0.00"} /></label>
        <label><span>Charge by</span><select value={draft.unitLabel} onChange={(event) => change("unitLabel", event.target.value)}>{PRICE_BOOK_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>GST</span><select value={draft.taxCode} onChange={(event) => change("taxCode", event.target.value)}><option value="gst">Add 10% GST</option><option value="none">No GST</option></select></label>
      </div>
      {preview && <div className={styles.preview}><div><span>Cost</span><strong>{money(preview.cost)}</strong></div><div><span>Sell</span><strong>{money(preview.sell)}</strong></div><div><span>Markup</span><strong>{percentage(preview.markupBasisPoints)}</strong></div><div><span>Margin</span><strong>{percentage(preview.marginBasisPoints)}</strong></div></div>}
      <details className={styles.advanced}><summary>More details, optional</summary><div>
        <label className={styles.wide}><span>Description</span><textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="What is included in this item" /></label>
        <label><span>Supplier cost ex GST</span><input inputMode="decimal" value={draft.supplierCost} onChange={(event) => change("supplierCost", event.target.value)} /></label>
        <label><span>Expected minutes</span><input type="number" min="0" max="10080" value={draft.expectedDurationMinutes} onChange={(event) => change("expectedDurationMinutes", event.target.value)} /></label>
        <label><span>Required capability</span><select value={draft.requiredSkill} onChange={(event) => change("requiredSkill", event.target.value)}><option value="">No capability required</option>{capabilities.map((capability) => <option key={capability} value={capability}>{words(capability)}</option>)}</select><small>Uses the business profile, so this list stays in one place.</small></label>
        <label className={styles.wide}><span>Approved catalogue item</span><select value={draft.supplierProductId} onChange={(event) => chooseCatalogue(event.target.value)}><option value="">Enter supplier details manually</option>{catalogue.map((option) => <option key={option.id} value={option.id}>{option.supplierName} | {option.supplierSku} | {option.name} | {money(option.supplierCostCentsExGst)}</option>)}</select><small>Choosing a catalogue item fills its current supplier, SKU and cost.</small></label>
        {!draft.supplierProductId && <><label><span>Supplier</span><input maxLength={140} value={draft.supplierName} onChange={(event) => change("supplierName", event.target.value)} /></label><label><span>Supplier SKU</span><input maxLength={100} value={draft.supplierSku} onChange={(event) => change("supplierSku", event.target.value)} /></label></>}
      </div></details>
      </fieldset>
      {(editing === "new" || editing.recordStatus === "active") && <div className={styles.actions}><button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving..." : editing === "new" ? "Save and use in quotes" : "Save changes"}</button>{editing !== "new" && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void archive(editing)}>{busy === `archive:${editing.id}` ? "Archiving..." : "Archive item"}</button>}</div>}
      {history.length > 0 && <details className={styles.history}><summary>Price history ({history.length})</summary>{history.map((entry) => <article key={entry.priceRevision}><div><strong>Revision {entry.priceRevision}</strong><span>{new Date(entry.changedAt).toLocaleString("en-AU")}</span></div><span>Cost {money(entry.supplierCostCentsExGst)} | Sell {money(entry.sellPriceCentsExGst)} | Margin {percentage(entry.marginBasisPoints)} | {entry.taxCode === "gst" ? "GST" : "No GST"}</span></article>)}</details>}
    </form> : <>
      <div className={styles.toolbar}><label><span>Find an item</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code, supplier or SKU" /></label><div role="group" aria-label="Price-book status">{[["active", "Ready"], ["archived", "Archived"], ["all", "All"]].map(([value, label]) => <button type="button" key={value} className={status === value ? styles.active : ""} onClick={() => setStatus(value)}>{label}</button>)}</div></div>
      {!loading && !search && status === "active" && counts.active === 0 && <section className={styles.firstRun}><span>Start in under a minute</span><h4>Save the work you price most often</h4><p>Choose a quick start, enter the sell price, and it becomes available inside every direct-job quote.</p><div><button type="button" onClick={() => startNew("labour")}>Add labour hour</button><button type="button" onClick={() => startNew("material")}>Add material</button><button type="button" onClick={() => startNew("call_out")}>Add call-out</button></div></section>}
      <div className={styles.list}>{items.map((item) => <article key={item.id}><button type="button" onClick={() => void edit(item)}><div><span>{item.itemCode} | {PRICE_BOOK_TYPE_LABELS[item.itemType]}</span><strong>{item.name}</strong><small>{item.supplierName ? `${item.supplierName}${item.supplierSku ? ` | ${item.supplierSku}` : ""}` : item.description || "No extra details needed"}</small></div><div className={styles.price}><span>Sell ex GST</span><strong>{money(item.sellPriceCentsExGst)}</strong><small>{item.unitLabel} | {item.taxCode === "gst" ? "GST 10%" : "No GST"}</small></div><div className={styles.margin}><span>Margin</span><strong>{percentage(item.marginBasisPoints)}</strong><small>Cost {money(item.supplierCostCentsExGst)}</small></div><em>{item.recordStatus === "active" ? "Edit" : "View"}</em></button></article>)}</div>
      {!items.length && !loading && (search || counts.total > 0) && <div className={styles.empty}><strong>No matching items</strong><span>Change the search or status filter.</span></div>}
      {loading && <p className={styles.loading}>Loading the price book...</p>}
    </>}
    {message && <p className={styles.message} role="status">{message}</p>}
    </>}
  </section>;
}
