"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { dollarsToCents } from "@/lib/trade-quote";
import { calculatePriceBookRates, priceBookItemAllowsNegativeSellPrice, priceBookItemRequiresZeroSupplierCost,
  PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_TYPE_LABELS, PRICE_BOOK_UNITS, type PriceBookItemType, type PriceBookSolarPanel } from "@/lib/trade-price-book";
import { SOLAR_STARTER_PANELS } from "@/lib/trade-solar-equipment";
import { TradeJobPacketWorkspace } from "./TradeJobPacketWorkspace";
import { TradePriceBookImport } from "./TradePriceBookImport";
import { TradeProductDocuments } from "./TradeProductDocuments";
import styles from "./TradePriceBookWorkspace.module.css";

type PriceBookItem = {
  id: string; itemCode: string; name: string; description: string; itemType: PriceBookItemType; unitLabel: string;
  supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number;
  marginBasisPoints: number; expectedDurationMinutes: number; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string; recordStatus: string; priceRevision: number; createdAt: string; updatedAt: string;
  solarPanel?: PriceBookSolarPanel | null;
};
type CatalogueOption = { id: string; supplierSku: string; name: string; supplierCostCentsExGst: number; supplierName: string };
type PriceHistory = { priceRevision: number; supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number; marginBasisPoints: number; changeType: string; changedAt: string };
type Result = { ok?: boolean; items?: PriceBookItem[]; item?: PriceBookItem; counts?: { total: number; active: number; archived: number };
  products?: Array<Pick<PriceBookItem, "id" | "itemCode" | "name">>;
  capabilityOptions?: string[]; catalogueOptions?: CatalogueOption[]; history?: PriceHistory[]; access?: { canView?: boolean; canManage?: boolean }; error?: string };
type Draft = { name: string; description: string; itemType: PriceBookItemType; unitLabel: string; supplierCost: string;
  sellPrice: string; taxCode: string; expectedDurationMinutes: string; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string; productKind: "general" | "solar_panel";
  panelWatts: string; panelWidthMm: string; panelLengthMm: string; panelDetails: PriceBookSolarPanel | null };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const percentage = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;
const words = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const blankDraft = (): Draft => ({ name: "", description: "", itemType: "material", unitLabel: "each", supplierCost: "0.00",
  sellPrice: "", taxCode: "gst", expectedDurationMinutes: "0", requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "",
  productKind: "general", panelWatts: "", panelWidthMm: "", panelLengthMm: "", panelDetails: null });
const editDraft = (item: PriceBookItem): Draft => ({ name: item.name, description: item.description, itemType: item.itemType,
  unitLabel: item.unitLabel, supplierCost: (item.supplierCostCentsExGst / 100).toFixed(2), sellPrice: (item.sellPriceCentsExGst / 100).toFixed(2),
  taxCode: item.taxCode, expectedDurationMinutes: String(item.expectedDurationMinutes), requiredSkill: item.requiredSkill,
  supplierName: item.supplierName, supplierSku: item.supplierSku, supplierProductId: item.supplierProductId,
  productKind: item.solarPanel ? "solar_panel" : "general", panelWatts: item.solarPanel?.watts.toString() || "",
  panelWidthMm: item.solarPanel ? String(Number((item.solarPanel.widthM * 1000).toFixed(3))) : "",
  panelLengthMm: item.solarPanel ? String(Number((item.solarPanel.lengthM * 1000).toFixed(3))) : "", panelDetails: item.solarPanel || null });

export function TradePriceBookWorkspace({ user, initialView = "items", permissions, navigationTarget }: { user: User; initialView?: "items" | "packets"; permissions?: TradeTeamPermissions; navigationTarget?: TLinkCommandTarget | null }) {
  const [libraryView, setLibraryView] = useState<"items" | "packets">(initialView);
  const [items, setItems] = useState<PriceBookItem[]>([]); const [counts, setCounts] = useState({ total: 0, active: 0, archived: 0 });
  const [capabilities, setCapabilities] = useState<string[]>([]); const [catalogue, setCatalogue] = useState<CatalogueOption[]>([]);
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("active"); const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PriceBookItem | "new" | null>(null); const [draft, setDraft] = useState<Draft>(blankDraft());
  const [history, setHistory] = useState<PriceHistory[]>([]); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [confirmedCanManage, setCanManage] = useState(() => permissions?.canManagePriceBook === true);
  const [importing, setImporting] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [documentProducts, setDocumentProducts] = useState<Array<Pick<PriceBookItem, "id" | "itemCode" | "name">>>([]);
  const [documentProductsLoading, setDocumentProductsLoading] = useState(false);
  const [documentProductsError, setDocumentProductsError] = useState("");
  const [documentProductSearch, setDocumentProductSearch] = useState("");
  const [documentProductsReload, setDocumentProductsReload] = useState(0);
  const saving = useRef(false);
  const [documentProductId, setDocumentProductId] = useState("");
  const [productNavigation, setProductNavigation] = useState<TLinkCommandTarget | null>(null);
  const openedNavigationNonce = useRef<number | null>(null);
  const canView = permissions?.canViewPriceBook !== false;
  const canManage = confirmedCanManage && canView && permissions?.canManagePriceBook !== false;

  if (navigationTarget?.kind === "product" && navigationTarget.workspace === "products"
    && navigationTarget.nonce !== productNavigation?.nonce) {
    setProductNavigation(navigationTarget); setLibraryView("items"); setSearch(navigationTarget.query); setStatus("active");
    setEditing(null); setImporting(false); setDocumentsOpen(false); setMessage("");
  }

  const request = useCallback(async (path = "", init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-price-book${path}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The price book could not be loaded.");
    return result;
  }, [user]);

  const edit = useCallback(async (item: PriceBookItem, signal?: AbortSignal) => {
    if (!canView || signal?.aborted) return;
    setEditing(item); setDocumentsOpen(false); setDraft(editDraft(item)); setHistory([]); setMessage("");
    try {
      const result = await request(`?itemId=${encodeURIComponent(item.id)}`, { signal });
      if (!signal?.aborted) setHistory(result.history || []);
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Price history could not be loaded."); }
  }, [canView, request]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canView) { setItems([]); setCanManage(false); setMessage("Ask the business owner for price-book access."); return; }
    const result = await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`, { signal });
    if (signal?.aborted) return;
    setItems(result.items || []); setCounts(result.counts || { total: 0, active: 0, archived: 0 });
    setCapabilities(result.capabilityOptions || []); setCatalogue(result.catalogueOptions || []);
    if (result.access) setCanManage(result.access.canManage === true);
    if (productNavigation && openedNavigationNonce.current !== productNavigation.nonce && search === productNavigation.query) {
      openedNavigationNonce.current = productNavigation.nonce;
      if (productNavigation.id) {
        const item = result.items?.find((item) => item.id === productNavigation.id && item.recordStatus === "active");
        if (item) await edit(item, signal);
        else setMessage("This product is no longer in the active price book. Search your items or check Archived.");
      }
    }
  }, [canView, edit, productNavigation, request, search, status]);

  useEffect(() => {
    if (!documentsOpen || !canManage) return;
    const controller = new AbortController();
    const loadProducts = async () => {
      setDocumentProductsLoading(true); setDocumentProductsError("");
      try {
        const result = await request("?mode=document_products", { signal: controller.signal });
        if (!result.ok || !Array.isArray(result.products)) throw new Error("Products could not be loaded. Try again.");
        if (!controller.signal.aborted) {
          const products = result.products;
          setDocumentProducts(products);
          setDocumentProductId((current) => products.some((item) => item.id === current) ? current : "");
        }
      } catch (error) { if (!controller.signal.aborted) setDocumentProductsError(error instanceof Error ? error.message : "Products could not be loaded."); }
      finally { if (!controller.signal.aborted) setDocumentProductsLoading(false); }
    };
    void loadProducts();
    return () => controller.abort();
  }, [documentsOpen, canManage, request, documentProductsReload]);

  useEffect(() => {
    const controller = new AbortController(); const timer = window.setTimeout(() => {
      setLoading(true); void load(controller.signal).catch((error) => { if (!controller.signal.aborted) { setItems([]); setCanManage(false); setMessage(error.message); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  const preview = useMemo(() => {
    try {
      const allowNegative = priceBookItemAllowsNegativeSellPrice(draft.itemType);
      const cost = dollarsToCents(draft.supplierCost || "0"); const sell = dollarsToCents(draft.sellPrice, allowNegative);
      return { cost, sell, ...calculatePriceBookRates(cost, sell) };
    } catch { return null; }
  }, [draft.itemType, draft.sellPrice, draft.supplierCost]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }

  function changeItemType(itemType: PriceBookItemType) {
    setDraft((current) => priceBookItemRequiresZeroSupplierCost(itemType) ? {
      ...current, itemType, supplierCost: "0.00", supplierName: "", supplierSku: "", supplierProductId: "", productKind: "general",
    } : { ...current, itemType, productKind: itemType === "material" || itemType === "equipment" ? current.productKind : "general" });
  }

  function choosePanelStarter(id: string) {
    const panel = SOLAR_STARTER_PANELS.find((item) => item.id === id);
    if (!panel || panel.watts === undefined || panel.widthM === undefined || panel.lengthM === undefined) return;
    const details: PriceBookSolarPanel = { watts: panel.watts, widthM: panel.widthM, lengthM: panel.lengthM,
      manufacturer: panel.manufacturer, model: panel.model, datasheetUrl: panel.datasheetUrl };
    setDraft((current) => ({ ...current, name: `${panel.manufacturer} ${panel.model}`, supplierSku: panel.model, supplierProductId: "", supplierName: "",
      panelWatts: String(details.watts), panelWidthMm: String(details.widthM * 1000), panelLengthMm: String(details.lengthM * 1000), panelDetails: details }));
  }

  function startNew(preset?: "labour" | "material" | "solar_panel" | "call_out" | "stc" | "veec" | "esc") {
    if (!canManage) return;
    const next = blankDraft();
    if (preset === "labour") Object.assign(next, { itemType: "labour", unitLabel: "hour", name: "Labour" });
    if (preset === "material") Object.assign(next, { itemType: "material", unitLabel: "each" });
    if (preset === "solar_panel") Object.assign(next, { productKind: "solar_panel", itemType: "material", unitLabel: "each" });
    if (preset === "call_out") Object.assign(next, { itemType: "call_out", unitLabel: "visit", name: "Call-out" });
    if (preset === "stc") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "STC" });
    if (preset === "veec") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "VEEC" });
    if (preset === "esc") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "ESC" });
    setEditing("new"); setImporting(false); setDocumentsOpen(false); setDraft(next); setHistory([]); setMessage("");
  }

  function chooseCatalogue(id: string) {
    const option = catalogue.find((item) => item.id === id);
    setDraft((current) => option ? { ...current, supplierProductId: option.id, supplierName: option.supplierName,
      supplierSku: option.supplierSku, supplierCost: (option.supplierCostCentsExGst / 100).toFixed(2), name: current.name || option.name,
      ...(current.productKind === "solar_panel" && current.supplierProductId !== option.id ? { panelDetails: null, panelWatts: "", panelWidthMm: "", panelLengthMm: "" } : {}) } : {
      ...current, supplierProductId: "", supplierName: "", supplierSku: "",
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage || saving.current) return;
    const submitter = "submitter" in event.nativeEvent ? event.nativeEvent.submitter : null;
    const addDocuments = submitter instanceof HTMLButtonElement && submitter.value === "documents";
    saving.current = true; setBusy("save"); setMessage("");
    try {
      const isNew = editing === "new"; const itemId = typeof editing === "object" && editing ? editing.id : "";
      const solarPanel = draft.productKind === "solar_panel" ? { ...draft.panelDetails, watts: Number(draft.panelWatts),
        widthM: Number(draft.panelWidthMm) / 1000, lengthM: Number(draft.panelLengthMm) / 1000 } : null;
      const result = await request("", { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ action: isNew ? "create" : "update", itemId, ...draft, solarPanel }) });
      if (!result.item) throw new Error("The save was not confirmed. Refresh the price book before trying again.");
      if (addDocuments) { setEditing(result.item); setDraft(editDraft(result.item)); }
      else setEditing(null);
      await load(); setMessage(addDocuments ? "Item saved. Add its warranty or product PDFs below." : solarPanel ? "Saved. This panel is ready in your roof designer and price book." : isNew ? "Saved. This item is ready to add to quotes." : "Changes saved. Price changes are kept in history.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The price-book item could not be saved."); }
    finally { saving.current = false; setBusy(""); }
  }

  async function archive(item: PriceBookItem) {
    if (!canManage) return;
    if (!window.confirm(`Archive ${item.name}? It will stop appearing in new quotes, while existing quote versions stay unchanged.`)) return;
    setBusy(`archive:${item.id}`); setMessage("");
    try { await request("", { method: "PATCH", body: JSON.stringify({ action: "archive", itemId: item.id }) }); await load(); setEditing(null); setMessage("Item archived. Existing quote versions remain unchanged."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The item could not be archived."); }
    finally { setBusy(""); }
  }

  if (!canView) return <section className={styles.workspace} aria-label="Price book"><p role="status">Ask the business owner for price-book access.</p></section>;

  return <section className={styles.workspace} aria-labelledby={libraryView === "items" ? "price-book-title" : "job-packets-title"}>
    <nav className={styles.librarySwitch} aria-label="Pricing library">
      <button type="button" className={libraryView === "items" ? styles.libraryActive : ""} onClick={() => setLibraryView("items")}>Price-book items</button>
      {canManage && <button type="button" className={libraryView === "packets" ? styles.libraryActive : ""} onClick={() => setLibraryView("packets")}>Common jobs</button>}
    </nav>
    {libraryView === "packets" ? <TradeJobPacketWorkspace user={user} onOpenItems={() => setLibraryView("items")} /> : <>
    <header className={styles.hero}><div><span>Your products, costs and prices</span><h3 id="price-book-title">Price book</h3><p>{canManage ? "Save common work once, then add it to a quote in one choice with the right price and GST." : "View the business products and rates available for quoting."}</p></div>{canManage && <div className={styles.heroActions}><button type="button" onClick={() => { setDocumentsOpen(true); setImporting(false); setEditing(null); setMessage(""); }}>Upload product PDF</button><button type="button" onClick={() => { setImporting(true); setDocumentsOpen(false); setEditing(null); setMessage(""); }}>Upload Excel / CSV</button><button type="button" onClick={() => startNew()}>New item</button></div>}</header>
    <div className={styles.metrics}><article><span>Ready to quote</span><strong>{counts.active}</strong></article><article><span>Archived</span><strong>{counts.archived}</strong></article><article><span>Total history</span><strong>{counts.total}</strong></article></div>

    {documentsOpen && canManage ? <section className={styles.editor} aria-label="Attach product PDFs"><header><div><h4>Attach product PDFs</h4><p>Choose the product, then drop in its warranty or information PDF.</p></div><button type="button" className={styles.secondary} onClick={() => setDocumentsOpen(false)}>Back to price book</button></header><div className={styles.documentProductFields}>
      {documentProducts.length > 20 && <label><span>Find product</span><input type="search" aria-label="Find product for PDF" value={documentProductSearch} onChange={(event) => setDocumentProductSearch(event.target.value)} placeholder="Name or item code" /></label>}
      <label><span>Product</span><select aria-label="Product for PDF" value={documentProductId} disabled={documentProductsLoading || Boolean(documentProductsError)} onChange={(event) => setDocumentProductId(event.target.value)}><option value="">{documentProductsLoading ? "Loading products…" : "Choose a product"}</option>{documentProducts.filter((item) => item.id === documentProductId || `${item.name} ${item.itemCode}`.toLowerCase().includes(documentProductSearch.trim().toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.itemCode}</option>)}</select></label>
      </div>{documentProductsError && <p role="alert">{documentProductsError} <button type="button" className={styles.secondary} onClick={() => setDocumentProductsReload((value) => value + 1)}>Try again</button></p>}{documentProductId && !documentProductsLoading && !documentProductsError && <TradeProductDocuments key={`${user.uid}:${documentProductId}`} user={user} itemId={documentProductId} canManage />}{!documentProductsLoading && !documentProductsError && !documentProducts.length && <button type="button" className={styles.secondary} onClick={() => startNew()}>Add a product first</button>}</section> : importing && canManage ? <TradePriceBookImport user={user} onClose={() => setImporting(false)} onImported={async () => { await load(); }} /> : editing ? <form className={styles.editor} onSubmit={save}>
      <header><div><span>{editing === "new" ? "Add once, reuse everywhere" : editing.itemCode}</span><h4>{editing === "new" ? "New price-book item" : `${canManage && editing.recordStatus === "active" ? "Edit" : "View"} ${editing.name}`}</h4><p>Only the name and sell price are essential. Open more details when they help the team.</p></div><button type="button" className={styles.secondary} onClick={() => setEditing(null)}>Back to price book</button></header>
      {editing === "new" && <div className={styles.presets}><span>Quick start</span><button type="button" onClick={() => startNew("labour")}>Labour hour</button><button type="button" onClick={() => startNew("material")}>Material</button><button type="button" onClick={() => startNew("solar_panel")}>Solar panel</button><button type="button" onClick={() => startNew("call_out")}>Call-out</button><button type="button" onClick={() => startNew("stc")}>STC credit</button><button type="button" onClick={() => startNew("veec")}>VEEC credit</button><button type="button" onClick={() => startNew("esc")}>ESC credit</button></div>}
      {editing !== "new" && editing.recordStatus === "archived" && <p className={styles.archived}>Archived items are read only and stay available in price history.</p>}
      <fieldset className={styles.fields} disabled={!canManage || (editing !== "new" && editing.recordStatus === "archived")}>
      <div className={styles.coreFields}>
        <label><span>Item name</span><input required maxLength={140} value={draft.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Licensed electrician labour" /></label>
        <label><span>Product kind</span><select value={draft.productKind} onChange={(event) => { const productKind = event.target.value === "solar_panel" ? "solar_panel" : "general"; setDraft((current) => ({ ...current, productKind, ...(productKind === "solar_panel" ? { itemType: current.itemType === "equipment" ? "equipment" : "material", unitLabel: "each" } : {}) })); }}><option value="general">General item</option><option value="solar_panel">Solar panel</option></select></label>
        <label><span>Sell price ex GST</span><input required inputMode="decimal" value={draft.sellPrice} onChange={(event) => change("sellPrice", event.target.value)} placeholder={priceBookItemAllowsNegativeSellPrice(draft.itemType) ? "-38.00" : "0.00"} />{draft.itemType === "certificate" && <small>Enter the certificate value as a negative amount per certificate, such as -38.00 per STC.</small>}</label>
        <label><span>GST</span><select value={draft.taxCode} onChange={(event) => change("taxCode", event.target.value)}><option value="gst">Add 10% GST</option><option value="none">No GST</option></select></label>
      </div>
      {draft.productKind === "solar_panel" && <section className={styles.solarPanel}><div><strong>Panel size for the roof designer</strong><p>Enter the datasheet values once. This model then appears in your map.</p></div><label className={styles.starter}><span>Fill from a starter model, optional</span><select value="" onChange={(event) => choosePanelStarter(event.target.value)}><option value="">Choose an exact model or enter below</option>{SOLAR_STARTER_PANELS.map((panel) => <option key={panel.id} value={panel.id}>{panel.manufacturer} {panel.model} · {panel.watts} W</option>)}</select></label><div className={styles.panelDimensions}>
        <label><span>Power (W)</span><input type="number" required min="1" max="2000" step="any" inputMode="decimal" value={draft.panelWatts} onChange={(event) => change("panelWatts", event.target.value)} /></label>
        <label><span>Width (mm)</span><input type="number" required min="200" max="4000" step="any" inputMode="decimal" value={draft.panelWidthMm} onChange={(event) => change("panelWidthMm", event.target.value)} /></label>
        <label><span>Length (mm)</span><input type="number" required min="200" max="4000" step="any" inputMode="decimal" value={draft.panelLengthMm} onChange={(event) => change("panelLengthMm", event.target.value)} /></label>
      </div>{draft.panelDetails?.datasheetUrl && <a href={draft.panelDetails.datasheetUrl} target="_blank" rel="noopener noreferrer">Manufacturer datasheet</a>}</section>}
      {preview && <div className={styles.preview}><div><span>Cost</span><strong>{money(preview.cost)}</strong></div><div><span>Sell</span><strong>{money(preview.sell)}</strong></div><div><span>Markup</span><strong>{percentage(preview.markupBasisPoints)}</strong></div><div><span>Margin</span><strong>{percentage(preview.marginBasisPoints)}</strong></div></div>}
      <details className={styles.advanced}><summary>More details, optional</summary><div>
        <label><span>Type</span><select value={draft.itemType} onChange={(event) => changeItemType(event.target.value as PriceBookItemType)}>{PRICE_BOOK_ITEM_TYPES.map((type) => <option key={type} value={type}>{PRICE_BOOK_TYPE_LABELS[type]}</option>)}</select></label>
        <label><span>Charge by</span><select value={draft.unitLabel} onChange={(event) => change("unitLabel", event.target.value)}>{PRICE_BOOK_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className={styles.wide}><span>Description</span><textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="What is included in this item" /></label>
        <label><span>Supplier cost ex GST</span><input inputMode="decimal" value={draft.supplierCost} readOnly={priceBookItemRequiresZeroSupplierCost(draft.itemType)} onChange={(event) => change("supplierCost", event.target.value)} />{priceBookItemRequiresZeroSupplierCost(draft.itemType) && <small>Certificate, rebate and discount items use zero supplier cost.</small>}</label>
        <label><span>Expected minutes</span><input type="number" min="0" max="10080" value={draft.expectedDurationMinutes} onChange={(event) => change("expectedDurationMinutes", event.target.value)} /></label>
        <label><span>Required capability</span><select value={draft.requiredSkill} onChange={(event) => change("requiredSkill", event.target.value)}><option value="">No capability required</option>{capabilities.map((capability) => <option key={capability} value={capability}>{words(capability)}</option>)}</select><small>Uses the business profile, so this list stays in one place.</small></label>
        {!priceBookItemRequiresZeroSupplierCost(draft.itemType) && <label className={styles.wide}><span>Approved catalogue item</span><select value={draft.supplierProductId} onChange={(event) => chooseCatalogue(event.target.value)}><option value="">Enter supplier details manually</option>{catalogue.map((option) => <option key={option.id} value={option.id}>{option.supplierName} | {option.supplierSku} | {option.name} | {money(option.supplierCostCentsExGst)}</option>)}</select><small>Choosing a catalogue item fills its current supplier, SKU and cost.</small></label>}
        {!priceBookItemRequiresZeroSupplierCost(draft.itemType) && !draft.supplierProductId && <><label><span>Supplier</span><input maxLength={140} value={draft.supplierName} onChange={(event) => change("supplierName", event.target.value)} /></label><label><span>Supplier SKU</span><input maxLength={100} value={draft.supplierSku} onChange={(event) => change("supplierSku", event.target.value)} /></label></>}
      </div></details>
      </fieldset>
      {editing !== "new" && <TradeProductDocuments key={`${user.uid}:${editing.id}`} user={user} itemId={editing.id} canManage={canManage && editing.recordStatus === "active"} disabled={Boolean(busy)} />}
      {editing === "new" && canManage && <div className={styles.documentStart}><div><strong>Warranty or product PDFs?</strong><span>Save this item, then upload them once for future quotes.</span></div><button type="submit" name="afterSave" value="documents" disabled={Boolean(busy)}>Save &amp; add PDFs</button></div>}
      {canManage && (editing === "new" || editing.recordStatus === "active") && <div className={styles.actions}><button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving..." : editing === "new" ? "Save and use in quotes" : "Save changes"}</button>{editing !== "new" && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void archive(editing)}>{busy === `archive:${editing.id}` ? "Archiving..." : "Archive item"}</button>}</div>}
      {history.length > 0 && <details className={styles.history}><summary>Price history ({history.length})</summary>{history.map((entry) => <article key={entry.priceRevision}><div><strong>Revision {entry.priceRevision}</strong><span>{new Date(entry.changedAt).toLocaleString("en-AU")}</span></div><span>Cost {money(entry.supplierCostCentsExGst)} | Sell {money(entry.sellPriceCentsExGst)} | Margin {percentage(entry.marginBasisPoints)} | {entry.taxCode === "gst" ? "GST" : "No GST"}</span></article>)}</details>}
    </form> : <>
      <div className={styles.toolbar}><label><span>Find an item</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code, supplier or SKU" /></label><div role="group" aria-label="Price-book status">{[["active", "Ready"], ["archived", "Archived"], ["all", "All"]].map(([value, label]) => <button type="button" key={value} className={status === value ? styles.active : ""} onClick={() => setStatus(value)}>{label}</button>)}</div></div>
      {canManage && !loading && !search && status === "active" && counts.active === 0 && <section className={styles.firstRun}><span>Start in under a minute</span><h4>Save the work you price most often</h4><p>Choose a quick start, enter the sell price, and it becomes available inside every direct-job quote.</p><div><button type="button" onClick={() => startNew("labour")}>Add labour hour</button><button type="button" onClick={() => startNew("material")}>Add material</button><button type="button" onClick={() => startNew("call_out")}>Add call-out</button><button type="button" onClick={() => startNew("stc")}>Add certificate credit</button></div></section>}
      <div className={styles.list}>{items.map((item) => <article key={item.id}><button type="button" onClick={() => void edit(item)}><div><span>{item.itemCode} | {PRICE_BOOK_TYPE_LABELS[item.itemType]}</span><strong>{item.name}</strong><small>{item.supplierName ? `${item.supplierName}${item.supplierSku ? ` | ${item.supplierSku}` : ""}` : item.description || "No extra details needed"}</small></div><div className={styles.price}><span>Sell ex GST</span><strong>{money(item.sellPriceCentsExGst)}</strong><small>{item.unitLabel} | {item.taxCode === "gst" ? "GST 10%" : "No GST"}</small></div><div className={styles.margin}><span>Margin</span><strong>{percentage(item.marginBasisPoints)}</strong><small>Cost {money(item.supplierCostCentsExGst)}</small></div><em>{item.recordStatus === "active" ? "Edit" : "View"}</em></button></article>)}</div>
      {items.length === 500 && <p className={styles.listLimit}>Showing the first 500 matches. Search by name or SKU to find another item.</p>}
      {!items.length && !loading && (search || counts.total > 0) && <div className={styles.empty}><strong>No matching items</strong><span>Change the search or status filter.</span></div>}
      {loading && <p className={styles.loading}>Loading the price book...</p>}
    </>}
    {message && <p className={styles.message} role="status">{message}</p>}
    </>}
  </section>;
}
