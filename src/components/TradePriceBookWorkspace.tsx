"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { dollarsToCents } from "@/lib/trade-quote";
import { calculatePriceBookRates, priceBookItemAllowsNegativeSellPrice, priceBookItemRequiresZeroSupplierCost, priceBookSupportsCoverage,
  PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_TYPE_LABELS, PRICE_BOOK_UNITS, type PriceBookItemType, type PriceBookSolarPanel } from "@/lib/trade-price-book";
import { DEFAULT_SOLAR_EQUIPMENT, SOLAR_STARTER_PANELS } from "@/lib/trade-solar-equipment";
import { TradeJobPacketWorkspace } from "./TradeJobPacketWorkspace";
import { TradePriceBookImport } from "./TradePriceBookImport";
import { TradeProductDocuments } from "./TradeProductDocuments";
import { TradeStockProductSettings, TradeStockWorkspace } from "./TradeStockWorkspace";
import { TradeProductStockSwitch, TradeProductTableScroll } from "./TradeProductTableControls";
import { TradePriceBookCategoryField } from "./TradePriceBookCategoryField";
import type { StockItem, StockListResponse } from "@/lib/trade-stock";
import styles from "./TradePriceBookWorkspace.module.css";

type PriceBookItem = {
  id: string; itemCode: string; name: string; description: string; itemType: PriceBookItemType; unitLabel: string;
  supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number;
  marginBasisPoints: number; expectedDurationMinutes: number; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string; recordStatus: string; priceRevision: number; createdAt: string; updatedAt: string;
  category?: string; solarPanel?: PriceBookSolarPanel | null; coverageM2PerUnit?: number | null;
};
type CatalogueOption = { id: string; supplierSku: string; name: string; supplierCostCentsExGst: number; supplierName: string };
type PriceHistory = { priceRevision: number; supplierCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string; markupBasisPoints: number; marginBasisPoints: number; changeType: string; changedAt: string };
type Result = { ok?: boolean; items?: PriceBookItem[]; item?: PriceBookItem; counts?: { total: number; active: number; archived: number };
  products?: Array<Pick<PriceBookItem, "id" | "itemCode" | "name">>;
  categoryOptions?: string[]; capabilityOptions?: string[]; catalogueOptions?: CatalogueOption[]; history?: PriceHistory[]; access?: { canView?: boolean; canManage?: boolean }; error?: string };
type Draft = { name: string; description: string; itemType: PriceBookItemType; unitLabel: string; supplierCost: string;
  sellPrice: string; taxCode: string; expectedDurationMinutes: string; requiredSkill: string; supplierName: string;
  supplierSku: string; supplierProductId: string; category: string; productKind: "general" | "solar_panel";
  panelWatts: string; panelWidthMm: string; panelLengthMm: string; panelDetails: PriceBookSolarPanel | null; coverageM2PerUnit: string };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const percentage = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;
const stockQuantity = (milli: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(milli / 1000);
const words = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const blankDraft = (): Draft => ({ name: "", description: "", itemType: "material", unitLabel: "each", supplierCost: "0.00",
  sellPrice: "", taxCode: "gst", expectedDurationMinutes: "0", requiredSkill: "", supplierName: "", supplierSku: "", supplierProductId: "",
  category: "", productKind: "general", panelWatts: "", panelWidthMm: "", panelLengthMm: "", panelDetails: null, coverageM2PerUnit: "" });
const editDraft = (item: PriceBookItem): Draft => ({ name: item.name, description: item.description, itemType: item.itemType,
  unitLabel: item.unitLabel, supplierCost: (item.supplierCostCentsExGst / 100).toFixed(2), sellPrice: (item.sellPriceCentsExGst / 100).toFixed(2),
  taxCode: item.taxCode, expectedDurationMinutes: String(item.expectedDurationMinutes), requiredSkill: item.requiredSkill,
  supplierName: item.supplierName, supplierSku: item.supplierSku, supplierProductId: item.supplierProductId,
  category: item.category || "", coverageM2PerUnit: item.coverageM2PerUnit?.toString() || "", productKind: item.solarPanel ? "solar_panel" : "general", panelWatts: item.solarPanel?.watts.toString() || "",
  panelWidthMm: item.solarPanel ? String(Number((item.solarPanel.widthM * 1000).toFixed(3))) : "",
  panelLengthMm: item.solarPanel ? String(Number((item.solarPanel.lengthM * 1000).toFixed(3))) : "", panelDetails: item.solarPanel || null });

export function TradePriceBookWorkspace({ user, initialView = "items", permissions, navigationTarget }: { user: User; initialView?: "items" | "packets"; permissions?: TradeTeamPermissions; navigationTarget?: TLinkCommandTarget | null }) {
  const [libraryView, setLibraryView] = useState<"items" | "packets" | "stock">(initialView);
  const [stockInitialItemId, setStockInitialItemId] = useState<string | undefined>();
  const [trackedCount, setTrackedCount] = useState(0);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [stockCanManage, setStockCanManage] = useState(false);
  const [stockLoadError, setStockLoadError] = useState("");
  const [stockReload, setStockReload] = useState(0);
  const [editingStockTracked, setEditingStockTracked] = useState<boolean | null>(null);
  const [editingStockOnHand, setEditingStockOnHand] = useState<number | null>(null);
  const [stockSetup, setStockSetup] = useState(false);
  const [items, setItems] = useState<PriceBookItem[]>([]); const [counts, setCounts] = useState({ total: 0, active: 0, archived: 0 });
  const [capabilities, setCapabilities] = useState<string[]>([]); const [catalogue, setCatalogue] = useState<CatalogueOption[]>([]);
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("active"); const [loading, setLoading] = useState(true);
  const [itemTypeFilter, setItemTypeFilter] = useState(""); const [categoryFilter, setCategoryFilter] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
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
  const editingAllowsStock = editing && editing !== "new" && (editing.itemType === "material" || editing.itemType === "equipment");
  const stockLocksUnits = Boolean(editingAllowsStock && (editingStockTracked !== false || editingStockOnHand === null || editingStockOnHand > 0));
  const productHasUnsavedChanges = Boolean(editing && editing !== "new" && JSON.stringify(draft) !== JSON.stringify(editDraft(editing)));

  if (navigationTarget?.kind === "product" && navigationTarget.workspace === "products"
    && navigationTarget.nonce !== productNavigation?.nonce) {
    setProductNavigation(navigationTarget); setLibraryView("items"); setSearch(navigationTarget.query); setStatus("active"); setItemTypeFilter(""); setCategoryFilter("");
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
    setEditing(item); setEditingStockTracked(null); setEditingStockOnHand(null); setStockSetup(false); setDocumentsOpen(false); setDraft(editDraft(item)); setHistory([]); setMessage("");
    try {
      const result = await request(`?itemId=${encodeURIComponent(item.id)}`, { signal });
      if (!signal?.aborted) setHistory(result.history || []);
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Price history could not be loaded."); }
  }, [canView, request]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canView) { setItems([]); setCanManage(false); setMessage("Ask the business owner for price-book access."); return; }
    const result = await request(`?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&itemType=${encodeURIComponent(itemTypeFilter)}&category=${encodeURIComponent(categoryFilter)}`, { signal });
    if (signal?.aborted) return;
    setItems(result.items || []); setCounts(result.counts || { total: 0, active: 0, archived: 0 });
    setCapabilities(result.capabilityOptions || []); setCatalogue(result.catalogueOptions || []); setCategories(result.categoryOptions || []);
    if (result.access) setCanManage(result.access.canManage === true);
    if (productNavigation && openedNavigationNonce.current !== productNavigation.nonce && search === productNavigation.query) {
      openedNavigationNonce.current = productNavigation.nonce;
      if (productNavigation.id) {
        const item = result.items?.find((item) => item.id === productNavigation.id && item.recordStatus === "active");
        if (item) await edit(item, signal);
        else setMessage("This product is no longer in the active price book. Search your items or check Archived.");
      }
    }
  }, [canView, edit, productNavigation, request, search, status, itemTypeFilter, categoryFilter]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const loadStock = async () => {
      try {
        const token = await user.getIdToken(); if (controller.signal.aborted) return;
        const response = await fetch("/api/trade-stock", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const result = await response.json() as StockListResponse;
        if (!response.ok || !result.ok || !Array.isArray(result.items)) throw new Error("Stock is unavailable. Try again.");
        if (!controller.signal.aborted) { setStockItems(result.items); setStockLoaded(true); setStockCanManage(result.canManage === true); setTrackedCount(result.items.filter((item) => item.tracked).length); setStockLoadError(""); }
      } catch (error) { if (!controller.signal.aborted) { setStockLoaded(false); setStockCanManage(false); setStockLoadError(error instanceof Error ? error.message : "Stock is unavailable. Try again."); } }
    };
    void loadStock(); return () => controller.abort();
  }, [canView, stockReload, user]);

  function stockChanged(item: StockItem) {
    setStockItems((current) => [...current.filter((row) => row.itemId !== item.itemId), item]);
    setEditingStockTracked(item.tracked); setEditingStockOnHand(item.onHandMilli); setStockReload((value) => value + 1);
    if (item.tracked) setTrackedCount((value) => Math.max(1, value));
  }

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
    if (preset === "solar_panel") Object.assign(next, { productKind: "solar_panel", itemType: "material", unitLabel: "each", category: "Solar panels" });
    if (preset === "call_out") Object.assign(next, { itemType: "call_out", unitLabel: "visit", name: "Call-out" });
    if (preset === "stc") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "STC" });
    if (preset === "veec") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "VEEC" });
    if (preset === "esc") Object.assign(next, { itemType: "certificate", unitLabel: "each", name: "ESC" });
    setEditing("new"); setEditingStockTracked(null); setEditingStockOnHand(null); setStockSetup(false); setImporting(false); setDocumentsOpen(false); setDraft(next); setHistory([]); setMessage("");
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
    const addStock = submitter instanceof HTMLButtonElement && submitter.value === "stock";
    saving.current = true; setBusy("save"); setMessage("");
    try {
      const isNew = editing === "new"; const itemId = typeof editing === "object" && editing ? editing.id : "";
      const solarPanel = draft.productKind === "solar_panel" ? { ...draft.panelDetails, watts: Number(draft.panelWatts),
        widthM: Number(draft.panelWidthMm) / 1000, lengthM: Number(draft.panelLengthMm) / 1000 } : null;
      const coverageM2PerUnit = draft.productKind !== "solar_panel" && priceBookSupportsCoverage(draft.itemType, draft.unitLabel) ? draft.coverageM2PerUnit || null : null;
      const result = await request("", { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ action: isNew ? "create" : "update", itemId, ...draft, solarPanel, coverageM2PerUnit }) });
      if (!result.item) throw new Error("The save was not confirmed. Refresh the price book before trying again.");
      if (addDocuments || addStock) { setEditing(result.item); setDraft(editDraft(result.item)); setEditingStockTracked(null); setEditingStockOnHand(null); setStockSetup(addStock); }
      else setEditing(null);
      setStockReload((value) => value + 1);
      await load(); setMessage(addStock ? "Item saved. Enter your opening stock below when ready." : addDocuments ? "Item saved. Add its warranty or product PDFs below." : solarPanel ? "Saved. This panel is ready in your roof designer and price book." : isNew ? "Saved. This item is ready to add to quotes." : "Changes saved. Price changes are kept in history.");
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

  return <section className={styles.workspace} aria-labelledby={libraryView === "stock" ? "trade-stock-title" : libraryView === "items" ? "price-book-title" : "job-packets-title"}>
    <nav className={styles.librarySwitch} aria-label="Pricing library">
      <button type="button" className={libraryView === "items" ? styles.libraryActive : ""} onClick={() => setLibraryView("items")}>Price-book items</button>
      {canManage && <button type="button" className={libraryView === "packets" ? styles.libraryActive : ""} onClick={() => setLibraryView("packets")}>Common jobs</button>}
      {(trackedCount > 0 || libraryView === "stock") && <button type="button" className={libraryView === "stock" ? styles.libraryActive : ""} onClick={() => { setStockInitialItemId(undefined); setLibraryView("stock"); }}>Stock</button>}
    </nav>
    {libraryView === "stock" ? <TradeStockWorkspace key={`${user.uid}:${stockInitialItemId || "all"}`} user={user} canManage={canManage} initialItemId={stockInitialItemId} onOpenItems={() => { setLibraryView("items"); setEditing(null); setDocumentsOpen(false); setImporting(false); }} onTrackedChanged={() => setStockReload((value) => value + 1)} /> : libraryView === "packets" ? <TradeJobPacketWorkspace user={user} onOpenItems={() => setLibraryView("items")} /> : <>
    <header className={styles.hero}><div><span>Your products, costs and prices</span><h3 id="price-book-title">Price book</h3><p>{canManage ? "Save common work once, then add it to a quote in one choice with the right price and GST." : "View the business products and rates available for quoting."}</p></div>{canManage && <div className={styles.heroActions}><button type="button" onClick={() => { setDocumentsOpen(true); setImporting(false); setEditing(null); setMessage(""); }}>Upload product PDF</button><button type="button" onClick={() => { setImporting(true); setDocumentsOpen(false); setEditing(null); setMessage(""); }}>Upload Excel / CSV</button><button type="button" onClick={() => startNew()}>New item</button></div>}</header>
    <div className={styles.metrics}><article><span>Ready to quote</span><strong>{counts.active}</strong></article><article><span>Archived</span><strong>{counts.archived}</strong></article><article><span>Total history</span><strong>{counts.total}</strong></article></div>

    {documentsOpen && canManage ? <section className={styles.editor} aria-label="Attach product PDFs"><header><div><h4>Attach product PDFs</h4><p>Choose the product, then drop in its warranty or information PDF.</p></div><button type="button" className={styles.secondary} onClick={() => setDocumentsOpen(false)}>Back to price book</button></header><div className={styles.documentProductFields}>
      {documentProducts.length > 20 && <label><span>Find product</span><input type="search" aria-label="Find product for PDF" value={documentProductSearch} onChange={(event) => setDocumentProductSearch(event.target.value)} placeholder="Name or item code" /></label>}
      <label><span>Product</span><select aria-label="Product for PDF" value={documentProductId} disabled={documentProductsLoading || Boolean(documentProductsError)} onChange={(event) => setDocumentProductId(event.target.value)}><option value="">{documentProductsLoading ? "Loading products…" : "Choose a product"}</option>{documentProducts.filter((item) => item.id === documentProductId || `${item.name} ${item.itemCode}`.toLowerCase().includes(documentProductSearch.trim().toLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.itemCode}</option>)}</select></label>
      </div>{documentProductsError && <p role="alert">{documentProductsError} <button type="button" className={styles.secondary} onClick={() => setDocumentProductsReload((value) => value + 1)}>Try again</button></p>}{documentProductId && !documentProductsLoading && !documentProductsError && <TradeProductDocuments key={`${user.uid}:${documentProductId}`} user={user} itemId={documentProductId} canManage />}{!documentProductsLoading && !documentProductsError && !documentProducts.length && <button type="button" className={styles.secondary} onClick={() => startNew()}>Add a product first</button>}</section> : importing && canManage ? <TradePriceBookImport user={user} onClose={() => setImporting(false)} onImported={async () => { await load(); setStockReload((value) => value + 1); }} /> : editing ? <><form className={styles.editor} onSubmit={save}>
      <header><div><span>{editing === "new" ? "Add once, reuse everywhere" : editing.itemCode}</span><h4>{editing === "new" ? "New price-book item" : `${canManage && editing.recordStatus === "active" ? "Edit" : "View"} ${editing.name}`}</h4><p>Only the name and sell price are essential. Open more details when they help the team.</p></div><button type="button" className={styles.secondary} onClick={() => setEditing(null)}>Back to price book</button></header>
      {editing === "new" && <div className={styles.presets}><span>Quick start</span><button type="button" onClick={() => startNew("labour")}>Labour hour</button><button type="button" onClick={() => startNew("material")}>Material</button><button type="button" onClick={() => startNew("solar_panel")}>Solar panel</button><button type="button" onClick={() => startNew("call_out")}>Call-out</button><button type="button" onClick={() => startNew("stc")}>STC credit</button><button type="button" onClick={() => startNew("veec")}>VEEC credit</button><button type="button" onClick={() => startNew("esc")}>ESC credit</button></div>}
      {editing !== "new" && editing.recordStatus === "archived" && <p className={styles.archived}>Archived items are read only and stay available in price history.</p>}
      <fieldset className={styles.fields} disabled={!canManage || (editing !== "new" && editing.recordStatus === "archived")}>
      <div className={styles.coreFields}>
        <label><span>Item name</span><input required maxLength={140} value={draft.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Licensed electrician labour" /></label>
        <label><span>Type</span><select value={draft.itemType} disabled={stockLocksUnits} onChange={(event) => changeItemType(event.target.value as PriceBookItemType)}>{PRICE_BOOK_ITEM_TYPES.map((type) => <option key={type} value={type}>{PRICE_BOOK_TYPE_LABELS[type]}</option>)}</select></label>
        <TradePriceBookCategoryField value={draft.category} categories={categories} onChange={(value) => change("category", value)} />
        <label><span>Code / SKU</span><input maxLength={100} value={draft.supplierSku} readOnly={Boolean(draft.supplierProductId)} onChange={(event) => change("supplierSku", event.target.value)} placeholder="Your product or supplier code" /></label>
        <label><span>Sell price ex GST</span><input required inputMode="decimal" value={draft.sellPrice} onChange={(event) => change("sellPrice", event.target.value)} placeholder={priceBookItemAllowsNegativeSellPrice(draft.itemType) ? "-38.00" : "0.00"} />{draft.itemType === "certificate" && <small>Enter the certificate value as a negative amount per certificate, such as -38.00 per STC.</small>}</label>
        <label><span>GST</span><select value={draft.taxCode} onChange={(event) => change("taxCode", event.target.value)}><option value="gst">Add 10% GST</option><option value="none">No GST</option></select></label>
      </div>
      {(draft.itemType === "material" || draft.itemType === "equipment") && <label className={styles.panelToggle}><input type="checkbox" checked={draft.productKind === "solar_panel"} disabled={stockLocksUnits && draft.unitLabel !== "each"} onChange={(event) => setDraft((current) => ({ ...current, productKind: event.target.checked ? "solar_panel" : "general", ...(event.target.checked ? { unitLabel: "each" } : {}) }))} /><span>Solar panel for Map &amp; quote<small>Save the panel size below to draw it accurately on a roof.</small></span></label>}
      {draft.productKind === "solar_panel" && <section className={styles.solarPanel}><div><strong>Panel size for the roof designer</strong><p>Enter the datasheet values once. This model then appears in your map.</p></div><label className={styles.starter}><span>Fill from a starter model, optional</span><select value="" onChange={(event) => choosePanelStarter(event.target.value)}><option value="">Choose an exact model or enter below</option>{SOLAR_STARTER_PANELS.map((panel) => <option key={panel.id} value={panel.id}>{panel.manufacturer} {panel.model} · {panel.watts} W</option>)}</select></label><div className={styles.panelDimensions}>
        <label><span>Power (W)</span><input type="number" required min="1" max="2000" step="any" inputMode="decimal" value={draft.panelWatts} onChange={(event) => change("panelWatts", event.target.value)} /></label>
        <label><span>Width (mm)</span><input type="number" required min="200" max="4000" step="any" inputMode="decimal" value={draft.panelWidthMm} onChange={(event) => change("panelWidthMm", event.target.value)} /></label>
        <label><span>Length (mm)</span><input type="number" required min="200" max="4000" step="any" inputMode="decimal" value={draft.panelLengthMm} onChange={(event) => change("panelLengthMm", event.target.value)} /></label>
      </div><div className={styles.panelHelp}><button type="button" className={styles.secondary} onClick={() => setDraft((current) => ({ ...current, panelWatts: String(DEFAULT_SOLAR_EQUIPMENT.watts), panelWidthMm: String(Number(DEFAULT_SOLAR_EQUIPMENT.widthM) * 1000), panelLengthMm: String(Number(DEFAULT_SOLAR_EQUIPMENT.lengthM) * 1000), panelDetails: null }))}>Use default size</button><small>Editable starting size: 1,762 × 1,134 mm, 440 W. Check the actual product before quoting.</small></div>{draft.panelDetails?.datasheetUrl && <a href={draft.panelDetails.datasheetUrl} target="_blank" rel="noopener noreferrer">Manufacturer datasheet</a>}</section>}
      {preview && <div className={styles.preview}><div><span>Cost</span><strong>{money(preview.cost)}</strong></div><div><span>Sell</span><strong>{money(preview.sell)}</strong></div><div><span>Markup</span><strong>{percentage(preview.markupBasisPoints)}</strong></div><div><span>Margin</span><strong>{percentage(preview.marginBasisPoints)}</strong></div></div>}
      <details className={styles.advanced}><summary>More details, optional</summary><div>
        <label><span>Charge by</span><select value={draft.unitLabel} disabled={stockLocksUnits} onChange={(event) => change("unitLabel", event.target.value)}>{PRICE_BOOK_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{stockLocksUnits && <small>{editingStockTracked ? "Stock uses this type and unit. Stop tracking before changing them." : editingStockOnHand !== null && editingStockOnHand > 0 ? "Clear saved stock counts before changing the type or unit." : "Loading stock settings before changing the type or unit."}</small>}</label>
        {draft.productKind !== "solar_panel" && priceBookSupportsCoverage(draft.itemType, draft.unitLabel) && <label><span>Coverage per {draft.unitLabel === "each" ? "item" : draft.unitLabel} (m²), optional</span><input type="number" min="0.001" max="999999" step="0.001" inputMode="decimal" value={draft.coverageM2PerUnit} onChange={(event) => change("coverageM2PerUnit", event.target.value)} placeholder="e.g. 20" /><small>Map measurements suggest whole {draft.unitLabel === "each" ? "items" : `${draft.unitLabel}s`}. You can adjust waste and the final quantity in the quote.</small></label>}
        <label className={styles.wide}><span>Description</span><textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="What is included in this item" /></label>
        <label><span>Supplier cost ex GST</span><input inputMode="decimal" value={draft.supplierCost} readOnly={priceBookItemRequiresZeroSupplierCost(draft.itemType)} onChange={(event) => change("supplierCost", event.target.value)} />{priceBookItemRequiresZeroSupplierCost(draft.itemType) && <small>Certificate, rebate and discount items use zero supplier cost.</small>}</label>
        <label><span>Expected minutes</span><input type="number" min="0" max="10080" value={draft.expectedDurationMinutes} onChange={(event) => change("expectedDurationMinutes", event.target.value)} /></label>
        <label><span>Required capability</span><select value={draft.requiredSkill} onChange={(event) => change("requiredSkill", event.target.value)}><option value="">No capability required</option>{capabilities.map((capability) => <option key={capability} value={capability}>{words(capability)}</option>)}</select><small>Uses the business profile, so this list stays in one place.</small></label>
        {!priceBookItemRequiresZeroSupplierCost(draft.itemType) && <label className={styles.wide}><span>Approved catalogue item</span><select value={draft.supplierProductId} onChange={(event) => chooseCatalogue(event.target.value)}><option value="">Enter supplier details manually</option>{catalogue.map((option) => <option key={option.id} value={option.id}>{option.supplierName} | {option.supplierSku} | {option.name} | {money(option.supplierCostCentsExGst)}</option>)}</select><small>Choosing a catalogue item fills its current supplier, SKU and cost.</small></label>}
        {!priceBookItemRequiresZeroSupplierCost(draft.itemType) && !draft.supplierProductId && <label><span>Supplier</span><input maxLength={140} value={draft.supplierName} onChange={(event) => change("supplierName", event.target.value)} /></label>}
      </div></details>
      </fieldset>
      {editing !== "new" && <TradeProductDocuments key={`${user.uid}:${editing.id}`} user={user} itemId={editing.id} canManage={canManage && editing.recordStatus === "active"} disabled={Boolean(busy)} />}
      {editing === "new" && canManage && <div className={styles.documentStart}><div><strong>Warranty or product PDFs?</strong><span>Save this item, then upload them once for future quotes.</span></div><button type="submit" name="afterSave" value="documents" disabled={Boolean(busy)}>Save &amp; add PDFs</button></div>}
      {canManage && (editing === "new" || editing.recordStatus === "active") && <div className={styles.actions}><button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving..." : editing === "new" ? "Save and use in quotes" : "Save changes"}</button>{editing === "new" && (draft.itemType === "material" || draft.itemType === "equipment") && <button type="submit" className={styles.secondary} name="afterSave" value="stock" disabled={Boolean(busy)}>Save &amp; set up stock</button>}{editing !== "new" && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void archive(editing)}>{busy === `archive:${editing.id}` ? "Archiving..." : "Archive item"}</button>}</div>}
      {history.length > 0 && <details className={styles.history}><summary>Price history ({history.length})</summary>{history.map((entry) => <article key={entry.priceRevision}><div><strong>Revision {entry.priceRevision}</strong><span>{new Date(entry.changedAt).toLocaleString("en-AU")}</span></div><span>Cost {money(entry.supplierCostCentsExGst)} | Sell {money(entry.sellPriceCentsExGst)} | Margin {percentage(entry.marginBasisPoints)} | {entry.taxCode === "gst" ? "GST" : "No GST"}</span></article>)}</details>}
    </form>{editing !== "new" && editingAllowsStock && <TradeStockProductSettings key={`${user.uid}:${editing.id}`} user={user} itemId={editing.id} canManage={canManage} disabled={Boolean(busy) || productHasUnsavedChanges} initialAction={stockSetup ? "enable" : null} onLoaded={(item) => { setEditingStockTracked(item.tracked); setEditingStockOnHand(item.onHandMilli); }} onChanged={stockChanged} />}</> : <>
      <div className={styles.toolbar}><label><span>Find an item</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, category, code or supplier" /></label><div role="group" aria-label="Price-book status">{[["active", "Ready"], ["archived", "Archived"], ["all", "All"]].map(([value, label]) => <button type="button" key={value} className={status === value ? styles.active : ""} onClick={() => setStatus(value)}>{label}</button>)}</div></div>
      <div className={styles.filters}><label><span>Type</span><select aria-label="Filter by type" value={itemTypeFilter} onChange={(event) => setItemTypeFilter(event.target.value)}><option value="">All types</option>{PRICE_BOOK_ITEM_TYPES.map((type) => <option key={type} value={type}>{PRICE_BOOK_TYPE_LABELS[type]}</option>)}</select></label><label><span>Category</span><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{[...new Set([...categories, ...(categoryFilter ? [categoryFilter] : [])])].map((category) => <option key={category} value={category}>{category}</option>)}</select></label>{(itemTypeFilter || categoryFilter) && <button type="button" className={styles.secondary} onClick={() => { setItemTypeFilter(""); setCategoryFilter(""); }}>Clear filters</button>}</div>
      {canManage && !loading && !search && status === "active" && counts.active === 0 && <section className={styles.firstRun}><span>Start in under a minute</span><h4>Save the work you price most often</h4><p>Choose a quick start, enter the sell price, and it becomes available inside every direct-job quote.</p><div><button type="button" onClick={() => startNew("labour")}>Add labour hour</button><button type="button" onClick={() => startNew("material")}>Add material</button><button type="button" onClick={() => startNew("call_out")}>Add call-out</button><button type="button" onClick={() => startNew("stc")}>Add certificate credit</button></div></section>}
      {items.length > 0 && <TradeProductTableScroll><table className={styles.productTable} aria-label="Products and stock"><thead><tr><th scope="col">Product</th><th scope="col">Type</th><th scope="col">Category</th><th scope="col">Code / SKU</th><th scope="col">Track stock</th><th scope="col" className={styles.numeric}>Cost ex GST</th><th scope="col" className={styles.numeric}>Margin</th><th scope="col" className={styles.numeric}>Sale price ex GST</th><th scope="col" className={styles.numeric}>On hand</th><th scope="col" className={styles.numeric}>Committed</th><th scope="col" className={styles.numeric}>Available</th><th scope="col">Stock alert</th><th scope="col">Locations</th><th scope="col">Unit</th><th scope="col">Supplier</th><th scope="col">Panel size / power</th></tr></thead><tbody>{items.map((item) => {
        const physical = item.itemType === "material" || item.itemType === "equipment";
        const stock = stockItems.find((row) => row.itemId === item.id) || null;
        const stockKnown = stockLoaded && !stockLoadError && stock !== null;
        const stockText = !physical ? "-" : stockLoadError ? "Unavailable" : !stockLoaded ? "Loading…" : !stock ? "Unavailable" : null;
        const paused = stockKnown && !stock.tracked;
        const stockNumberClass = `${styles.numeric}${paused ? ` ${styles.stockPaused}` : ""}`;
        return <tr key={item.id}>
          <th scope="row"><button type="button" className={styles.productName} onClick={() => void edit(item)}><strong>{item.name}</strong></button></th>
          <td>{PRICE_BOOK_TYPE_LABELS[item.itemType]}</td><td className={styles.categoryCell}>{item.category || "-"}</td><td className={styles.productCode}><span>{item.supplierSku || item.itemCode}</span>{item.supplierSku && <small>TLink: {item.itemCode}</small>}</td>
          <td>{physical ? <TradeProductStockSwitch key={`${user.uid}:${item.id}`} user={user} itemId={item.id} name={item.name} stock={stock} loading={!stockLoaded && !stockLoadError} failed={Boolean(stockLoadError)} canManage={canManage && stockCanManage && item.recordStatus === "active"} onChanged={stockChanged} onRefresh={() => setStockReload((value) => value + 1)} /> : <span className={styles.stockReadOnly}>Not applicable</span>}</td>
          <td className={styles.numeric}>{money(item.supplierCostCentsExGst)}</td><td className={`${styles.numeric}${item.marginBasisPoints < 0 ? ` ${styles.negativeValue}` : ""}`}>{percentage(item.marginBasisPoints)}</td><td className={styles.numeric}><strong>{money(item.sellPriceCentsExGst)}</strong></td>
          <td className={stockNumberClass} title={paused ? "Tracking is off. This is the saved count." : undefined}>{stockText ?? (stock && stockQuantity(stock.onHandMilli))}</td>
          <td className={stockNumberClass}>{stockText ?? (stock && stockQuantity(stock.reservedMilli))}</td>
          <td className={`${stockNumberClass}${stockKnown && stock.availableMilli < 0 ? ` ${styles.negativeValue}` : ""}`}>{stockText ?? (stock && <strong>{stockQuantity(stock.availableMilli)}</strong>)}</td>
          <td className={stockKnown && stock.tracked && stock.availableMilli <= stock.lowStockMilli ? styles.negativeValue : undefined}>{stockText ?? (stock && (!stock.tracked ? "Off" : stock.availableMilli < 0 ? `Order ${stockQuantity(-stock.availableMilli)}` : stock.availableMilli === 0 ? "Out of stock" : stock.availableMilli <= stock.lowStockMilli ? "Low stock" : "In stock"))}</td>
          <td>{!physical ? "-" : stockKnown ? <button type="button" className={styles.stockLocations} aria-label={`Manage stock and locations for ${item.name}`} onClick={() => { setStockInitialItemId(item.id); setLibraryView("stock"); }}>{stock.locations.filter((location) => location.onHandMilli > 0 || stock.locations.length === 1).slice(0, 2).map((location) => <span key={location.locationId}><span>{location.name}</span><b>{stockQuantity(location.onHandMilli)}</b></span>)}{stock.locations.filter((location) => location.onHandMilli > 0).length > 2 && <small>+{stock.locations.filter((location) => location.onHandMilli > 0).length - 2} more</small>}<small>Stock details</small></button> : stockText}</td>
          <td>{PRICE_BOOK_UNITS.find(([value]) => value === item.unitLabel)?.[1] || item.unitLabel}</td><td><span className={styles.supplierName}>{item.supplierName || "-"}</span></td><td>{item.solarPanel ? <button type="button" className={styles.panelSpec} aria-label={`Edit panel dimensions for ${item.name}`} onClick={() => void edit(item)}><span>{Math.round(item.solarPanel.lengthM * 1000)} × {Math.round(item.solarPanel.widthM * 1000)} mm</span><small>{item.solarPanel.watts} W</small></button> : "-"}</td>
        </tr>;
      })}</tbody></table></TradeProductTableScroll>}
      {items.length > 0 && <p className={styles.stockHint}>Select a product to edit its type, category or size. Committed is stock needed for accepted jobs. Negative availability shows what to order. Tracking is optional.</p>}
      {items.length === 500 && <p className={styles.listLimit}>Showing the first 500 matches. Search by name or SKU to find another item.</p>}
      {!items.length && !loading && (search || itemTypeFilter || categoryFilter || counts.total > 0) && <div className={styles.empty}><strong>No matching items</strong><span>Change the search, type, category or status filter.</span></div>}
      {loading && <p className={styles.loading}>Loading the price book...</p>}
    </>}
    {stockLoadError && <p className={styles.stockHint} role="status">{stockLoadError} <button type="button" className={styles.secondary} onClick={() => setStockReload((value) => value + 1)}>Retry stock</button></p>}
    {message && <p className={styles.message} role="status">{message}</p>}
    </>}
  </section>;
}
