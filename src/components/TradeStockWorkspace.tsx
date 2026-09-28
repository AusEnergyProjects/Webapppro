"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { MAX_STOCK_QUANTITY_MILLI, type StockDetailResponse, type StockHistoryEntry, type StockItem, type StockListResponse, type StockMutation } from "@/lib/trade-stock";
import styles from "./TradeStockWorkspace.module.css";

type ProductAction = "enable" | "configure" | "receive" | "count";
const quantity = (value: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(value / 1000);
const inputQuantity = (value: number) => String(value / 1000);
const unitLabels: Record<string, string> = { each: "items", roll: "rolls", pack: "packs", bag: "bags", square_metre: "m²", metre: "m", kilometre: "km", hour: "hours", day: "days", visit: "visits", fixed: "items" };
const units = (item: StockItem) => unitLabels[item.unitLabel] || item.unitLabel;
const actionLabels: Record<ProductAction, string> = { enable: "Start tracking", configure: "Save stock settings", receive: "Receive stock", count: "Save stocktake" };
const historyLabels: Record<string, string> = { enable: "Opening stock", configure: "Warning updated", receive: "Received", count: "Stocktake", disable: "Tracking stopped", reserve: "Allocated to job", release: "Allocation released", consume: "Used on job", use: "Used on job", return: "Returned from job" };

function toMilli(value: string, label: string, minimum = 0) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) throw new Error(`Enter ${label.toLowerCase()} as a number with up to 3 decimal places.`);
  const result = Math.round(Number(value) * 1000);
  if (!Number.isSafeInteger(result) || result < minimum || result > MAX_STOCK_QUANTITY_MILLI) throw new Error(`${label} must be ${minimum ? "more than zero" : "zero or more"}, up to ${quantity(MAX_STOCK_QUANTITY_MILLI)}.`);
  return result;
}

class StockRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function stockRequest(user: User, path: string, init: RequestInit = {}) {
  const token = await user.getIdToken();
  if (init.signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/trade-stock${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new StockRequestError(result.error || "Stock could not be updated. Try again.", response.status);
  }
  return response;
}

function StockNumbers({ item }: { item: StockItem }) {
  return <dl className={styles.numbers}>
    <div><dt>On hand</dt><dd>{quantity(item.onHandMilli)}</dd></div>
    <div><dt>Allocated</dt><dd>{quantity(item.reservedMilli)}</dd></div>
    <div><dt>Available</dt><dd>{quantity(item.availableMilli)} <span>{units(item)}</span></dd></div>
  </dl>;
}

export function TradeStockProductSettings({ user, itemId, canManage, disabled = false, initialAction = null, onChanged, onLoaded, onClose }: {
  user: User; itemId: string; canManage: boolean; disabled?: boolean; initialAction?: ProductAction | null;
  onChanged?: (item: StockItem) => void; onLoaded?: (item: StockItem) => void; onClose?: () => void;
}) {
  const [item, setItem] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockHistoryEntry[]>([]);
  const [access, setAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<ProductAction | null>(initialAction);
  const [amount, setAmount] = useState(initialAction === "enable" ? "0" : "");
  const [warning, setWarning] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const loadedOnce = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const pendingMutation = useRef<{ fingerprint: string; mutation: StockMutation } | null>(null);
  const onLoadedRef = useRef(onLoaded);
  const onChangedRef = useRef(onChanged);
  const writable = canManage && access && !disabled;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; actionController.current?.abort(); }; }, []);
  useEffect(() => { onLoadedRef.current = onLoaded; onChangedRef.current = onChanged; }, [onLoaded, onChanged]);
  useEffect(() => {
    const controller = new AbortController();
    void stockRequest(user, `?itemId=${encodeURIComponent(itemId)}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json() as StockDetailResponse;
      if (!result.ok || result.item?.itemId !== itemId || !Array.isArray(result.history)) throw new Error("Stock details could not be verified. Load them again.");
      if (controller.signal.aborted) return;
      setItem(result.item); setHistory(result.history); setAccess(result.canManage === true); setNeedsRefresh(false);
      if (!loadedOnce.current) {
        if (initialAction === "count") setAmount(inputQuantity(result.item.onHandMilli));
        setWarning(result.item.lowStockMilli ? inputQuantity(result.item.lowStockMilli) : ""); loadedOnce.current = true;
      }
      onLoadedRef.current?.(result.item);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) { setLoadError(failure instanceof Error ? failure.message : "Stock could not be loaded."); setAccess(false); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialAction, itemId, reload, user]);

  function begin(next: ProductAction) {
    if (!writable || busy || loading || uncertain || !item) return;
    setAction(next); setAmount(next === "count" ? inputQuantity(item.onHandMilli) : next === "enable" ? "0" : "");
    setWarning(item.lowStockMilli ? inputQuantity(item.lowStockMilli) : ""); setNote(""); setError(""); setMessage(""); setNeedsRefresh(false); pendingMutation.current = null;
  }

  async function mutate(selectedAction: ProductAction | "disable") {
    if (!writable || !item || inFlight.current || loading || needsRefresh) return;
    setError(""); setMessage("");
    let mutation: StockMutation;
    try {
      const values = { action: selectedAction, itemId, expectedRevision: item.revision, note: note.trim(),
        ...(["enable", "receive", "count"].includes(selectedAction) ? { quantityMilli: toMilli(amount, selectedAction === "receive" ? "Quantity received" : "Quantity", selectedAction === "receive" ? 1 : 0) } : {}),
        ...(["enable", "configure"].includes(selectedAction) ? { lowStockMilli: toMilli(warning.trim() || "0", "Low-stock warning") } : {}) };
      const fingerprint = JSON.stringify(values);
      if (!pendingMutation.current || pendingMutation.current.fingerprint !== fingerprint) pendingMutation.current = { fingerprint, mutation: { ...values, operationId: crypto.randomUUID() } };
      mutation = pendingMutation.current.mutation;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the stock quantities."); return; }
    inFlight.current = true; setBusy(true);
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await stockRequest(user, "", { method: "POST", body: JSON.stringify(mutation), signal: controller.signal });
      const result = await response.json() as StockDetailResponse;
      if (!result.ok || result.item?.itemId !== itemId || !Array.isArray(result.history)) throw new Error("The update was not confirmed. Try again to check this same update safely.");
      if (!mounted.current) return;
      setItem(result.item); setHistory(result.history); setAccess(result.canManage === true); pendingMutation.current = null;
      setAction(null); setNote(""); setNeedsRefresh(false); setUncertain(false); onLoadedRef.current?.(result.item); onChangedRef.current?.(result.item);
      setMessage(selectedAction === "enable" ? "Stock tracking is on." : selectedAction === "disable" ? "Tracking is off. This product is now bought when needed." : selectedAction === "receive" ? "Delivery added to stock." : selectedAction === "count" ? "Stocktake saved." : "Stock warning saved.");
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : "Stock could not be updated. Try again.");
        if (failure instanceof StockRequestError && failure.status < 500) { setUncertain(false); if (failure.status === 409) setNeedsRefresh(true); }
        else setUncertain(true);
      }
    } finally { actionController.current = null; inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function refresh() { pendingMutation.current = null; setError(""); setLoadError(""); setLoading(true); setReload((value) => value + 1); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (action) void mutate(action); }
  return <section className={styles.settings} aria-label={item ? `Stock for ${item.name}` : "Product stock"}>
    <header className={styles.header}><div><h4>{onClose && item ? item.name : "Stock"}</h4><p>{item?.tracked ? "Your stock, ready for the next job." : "Buy when needed. Tracking is optional for products you keep on hand."}</p></div>
      {onClose ? <button type="button" onClick={onClose} disabled={busy || uncertain}>Back to stock</button> : !loading && item && !item.tracked && item.recordStatus === "active" && writable && !action && <button type="button" onClick={() => begin("enable")}>Track stock</button>}
    </header>
    {loading && <p role="status">Loading stock…</p>}
    {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={refresh} disabled={loading}>Load stock again</button></p>}
    {!loading && !loadError && item && <>
      {item.tracked && <><StockNumbers item={item} />{item.availableMilli <= item.lowStockMilli && <p className={styles.lowStock}>Low stock · {quantity(item.availableMilli)} {units(item)} available</p>}</>}
      {item.recordStatus === "archived" && item.tracked && <p className={styles.hint}>Archived product. You can still manage its remaining stock.</p>}
      {disabled && <p className={styles.hint}>Save product changes before updating stock.</p>}
      {item.tracked && !action && writable && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || uncertain} onClick={() => begin("receive")}>Receive stock</button><button type="button" disabled={busy || uncertain} onClick={() => begin("count")}>Stocktake</button></div>}
      {action && <form className={styles.actionForm} onSubmit={submit}>
        <fieldset disabled={!writable || busy || loading || needsRefresh || uncertain}><legend>{action === "enable" ? "Start with what you have" : action === "receive" ? "Add a delivery" : action === "count" ? "Count what is here" : "Low-stock warning"}</legend>
          <div className={styles.fields}>
            {action !== "configure" && <label><span>{action === "enable" ? "Opening quantity" : action === "receive" ? "Quantity received" : "Actual quantity on hand"} ({units(item)})</span><input type="number" inputMode="decimal" min={action === "receive" ? ".001" : "0"} max={MAX_STOCK_QUANTITY_MILLI / 1000} step=".001" value={amount} required autoFocus onChange={(event) => setAmount(event.target.value)} /></label>}
            {(action === "enable" || action === "configure") && <label><span>Warn when available reaches, optional</span><input type="number" inputMode="decimal" min="0" max={MAX_STOCK_QUANTITY_MILLI / 1000} step=".001" value={warning} placeholder="0" onChange={(event) => setWarning(event.target.value)} /><small>Leave blank to warn only when none is available.</small></label>}
          </div>
          {action === "count" && <p className={styles.hint}>This replaces the on-hand count, including stock allocated to jobs. Allocated: {quantity(item.reservedMilli)} {units(item)}.</p>}
          {action === "receive" && <p className={styles.hint}>Adds to the current {quantity(item.onHandMilli)} {units(item)} on hand.</p>}
          {(action === "receive" || action === "count") && <details className={styles.note}><summary>Add a note, optional</summary><label><span>Stock note</span><input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "receive" ? "e.g. Supplier delivery reference" : "e.g. Damaged item removed"} /></label></details>}
        </fieldset>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={!writable || busy || loading || needsRefresh}>{busy ? "Saving…" : uncertain ? "Retry this update" : actionLabels[action]}</button><button type="button" disabled={busy || uncertain} onClick={() => { setAction(null); setError(""); if (needsRefresh) refresh(); }}>Cancel</button></div>
      </form>}
      {item.tracked && !action && <details className={styles.details}><summary>Stock settings and recent activity</summary>
        {writable && <div className={styles.settingsActions}><div><p>Low-stock warning: {quantity(item.lowStockMilli)} {units(item)} available</p><button type="button" disabled={busy || uncertain} onClick={() => begin("configure")}>Change warning</button></div><div><p>{item.onHandMilli || item.reservedMilli ? "Use or count remaining stock and release job allocations before stopping tracking." : "Stop tracking this product and buy it when needed. History is kept."}</p><button type="button" disabled={busy || uncertain || item.onHandMilli !== 0 || item.reservedMilli !== 0} onClick={() => void mutate("disable")}>Stop tracking</button></div></div>}
        {history.length ? <ul className={styles.history}>{history.map((entry) => <li key={entry.id}><div><strong>{historyLabels[entry.action] || "Stock updated"}</strong><span>{new Date(entry.createdAt).toLocaleString("en-AU")}{entry.note ? ` · ${entry.note}` : ""}</span></div><div><strong>{entry.changeMilli > 0 ? "+" : ""}{quantity(entry.changeMilli)}</strong><span>{quantity(entry.onHandMilli)} on hand</span></div></li>)}</ul> : <p className={styles.hint}>No stock movements yet.</p>}
      </details>}
    </>}
    {error && <p className={styles.error} role="alert">{error}{uncertain && <><span>The result is not confirmed. Retry this same update before entering another quantity.</span>{!action && <button type="button" disabled={busy} onClick={() => void mutate("disable")}>Retry this update</button>}</>}{needsRefresh && <> <button type="button" onClick={refresh} disabled={busy || loading}>Refresh stock</button><span>Your entered quantity is kept. Check the updated count before saving.</span></>}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}

export function TradeStockWorkspace({ user, canManage, onOpenItems, onTrackedChanged }: {
  user: User; canManage: boolean; onOpenItems: () => void; onTrackedChanged?: () => void;
}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [access, setAccess] = useState(false);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<{ itemId: string; action: ProductAction | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void stockRequest(user, "", { signal: controller.signal }).then(async (response) => {
      const result = await response.json() as StockListResponse;
      if (!result.ok || !Array.isArray(result.items)) throw new Error("Stock could not be loaded. Try again.");
      if (!controller.signal.aborted) { setItems(result.items.filter((item) => item.tracked)); setAccess(result.canManage === true); }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Stock could not be loaded."); setAccess(false); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, reload]);
  function refreshList() { setLoading(true); setError(""); setReload((value) => value + 1); }
  function changed(item: StockItem) { setItems((current) => current.map((row) => row.itemId === item.itemId ? item : row).filter((row) => row.tracked)); onTrackedChanged?.(); }
  const lowCount = items.filter((item) => item.availableMilli <= item.lowStockMilli).length;
  const visible = items.filter((item) => (!lowOnly || item.availableMilli <= item.lowStockMilli) && `${item.name} ${item.itemCode}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className={styles.workspace} aria-labelledby="trade-stock-title">
    <header className={styles.header}><div><h3 id="trade-stock-title">Stock</h3><p>See what is on hand, allocated to jobs and available to use.</p></div><button type="button" onClick={onOpenItems}>Price-book items</button></header>
    {selected ? <TradeStockProductSettings key={selected.itemId} user={user} itemId={selected.itemId} canManage={canManage && access} initialAction={selected.action} onChanged={changed} onClose={() => { setSelected(null); refreshList(); }} /> : <>
      {loading && <p className={styles.empty} role="status">Loading stock…</p>}
      {error && <p className={styles.error} role="alert">{error} <button type="button" disabled={loading} onClick={refreshList}>Try again</button></p>}
      {!loading && !error && items.length > 0 && <>
        <div className={styles.toolbar}><label><span>Find stock</span><input type="search" placeholder="Product name or code" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className={styles.filter} role="group" aria-label="Stock filter"><button type="button" aria-pressed={!lowOnly} onClick={() => setLowOnly(false)}>All stock <span>{items.length}</span></button><button type="button" aria-pressed={lowOnly} onClick={() => setLowOnly(true)}>Low stock <span>{lowCount}</span></button></div></div>
        <div className={styles.list}>{visible.map((item) => <article className={styles.card} key={item.itemId}>
          <div className={styles.productHeading}><div><small>{item.itemCode}</small><h4>{item.name}</h4></div>{item.availableMilli <= item.lowStockMilli && <span className={styles.badge}>Low stock</span>}</div>
          <StockNumbers item={item} />
          <div className={styles.actions}>{canManage && access && <><button type="button" className={styles.primary} onClick={() => setSelected({ itemId: item.itemId, action: "receive" })}>Receive stock</button><button type="button" onClick={() => setSelected({ itemId: item.itemId, action: "count" })}>Stocktake</button></>}<button type="button" onClick={() => setSelected({ itemId: item.itemId, action: null })}>Details</button></div>
        </article>)}</div>
        {!visible.length && <p className={styles.empty}>{lowOnly && !search ? "Everything has stock available." : "No matching stock. Try another name or filter."}</p>}
        <p className={styles.hint}>To track another product, open it in Price-book items and choose Track stock.</p>
      </>}
      {!loading && !error && !items.length && <div className={styles.empty}><h4>Track only what you keep</h4><p>Open a saved material or equipment item and choose Track stock. Products you buy when needed keep working as usual.</p><button type="button" onClick={onOpenItems}>Open price-book items</button></div>}
    </>}
  </section>;
}
