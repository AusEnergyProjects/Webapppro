"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { MAX_STOCK_QUANTITY_MILLI, type StockDetailResponse, type StockHistoryEntry, type StockItem, type StockListResponse, type StockMutation, type StockLocation, type StockLocationResponse } from "@/lib/trade-stock";
import styles from "./TradeStockWorkspace.module.css";

type ProductAction = "enable" | "configure" | "receive" | "count" | "transfer";
type StockMember = { id: string; name: string };
const quantity = (value: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(value / 1000);
const inputQuantity = (value: number) => String(value / 1000);
const unitLabels: Record<string, string> = { each: "items", roll: "rolls", pack: "packs", bag: "bags", square_metre: "m²", metre: "m", kilometre: "km", hour: "hours", day: "days", visit: "visits", fixed: "items" };
const units = (item: StockItem) => unitLabels[item.unitLabel] || item.unitLabel;
const actionLabels: Record<ProductAction, string> = { enable: "Start tracking", configure: "Save stock settings", receive: "Receive stock", count: "Save stocktake", transfer: "Move stock" };
const historyLabels: Record<string, string> = { enable: "Opening stock", configure: "Warning updated", receive: "Received", count: "Stocktake", disable: "Tracking stopped", reserve: "Committed to job", release: "Commitment released", consume: "Used on job", use: "Used on job", return: "Returned from job", transfer: "Moved between locations" };

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
    <div><dt>Committed</dt><dd>{quantity(item.reservedMilli)}</dd></div>
    <div><dt>Available</dt><dd className={item.availableMilli < 0 ? styles.shortage : undefined}>{quantity(item.availableMilli)} <span>{units(item)}</span></dd></div>
  </dl>;
}

function StockLocationEditor({ user, location, members, onSaved, onCancel }: {
  user: User; location: StockLocation | null; members: StockMember[];
  onSaved: (locations: StockLocation[], saved: StockLocation) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(location?.name || "");
  const [kind, setKind] = useState(location?.responsibleMemberId ? "member" : "storage");
  const [responsibleMemberId, setResponsibleMemberId] = useState(location?.responsibleMemberId || "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const cleanName = kind === "member" ? members.find((member) => member.id === responsibleMemberId)?.name || (location?.responsibleMemberId === responsibleMemberId ? location.name : "") : name.trim();
    if (kind === "member" && !responsibleMemberId) { setError("Choose a team member."); return; }
    if (!cleanName) { setError("Enter a name for this location."); return; }
    pending.current ??= JSON.stringify({ action: location ? "rename_location" : "create_location", name: cleanName, responsibleMemberId: kind === "member" ? responsibleMemberId : "",
      operationId: crypto.randomUUID(), ...(location ? { locationId: location.id, expectedRevision: location.revision } : {}) });
    const requestController = new AbortController(); controller.current = requestController;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await stockRequest(user, "", { method: "POST", body: pending.current, signal: requestController.signal });
      const result = await response.json() as StockLocationResponse;
      if (!result.ok || !result.location?.id || !Array.isArray(result.locations)) throw new Error("The location update was not confirmed. Retry this same update.");
      if (!requestController.signal.aborted) onSaved(result.locations, result.location);
    } catch (failure) {
      if (!requestController.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "The location could not be saved.");
        const unconfirmed = !(failure instanceof StockRequestError && failure.status < 500);
        setUncertain(unconfirmed); if (!unconfirmed) pending.current = null;
      }
    } finally { inFlight.current = false; if (!requestController.signal.aborted) setBusy(false); }
  }
  return <form className={styles.locationEditor} onSubmit={(event) => void save(event)}>
    {!location && <label><span>Keep stock with</span><select value={kind} disabled={busy || uncertain} onChange={(event) => { setKind(event.target.value); pending.current = null; }}><option value="storage">Storage location</option><option value="member">Team member</option></select></label>}
    {kind === "member" ? <label><span>Team member</span><select value={responsibleMemberId} required disabled={busy || uncertain} onChange={(event) => { setResponsibleMemberId(event.target.value); pending.current = null; }}><option value="">Choose team member</option>{location?.responsibleMemberId && !members.some((member) => member.id === location.responsibleMemberId) && <option value={location.responsibleMemberId}>{location.name} (inactive)</option>}{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{!members.length && <small>Add your installers in Team first.</small>}</label> : <label><span>{location ? "Location name" : "New location name"}</span><input value={name} maxLength={60} placeholder="e.g. Workshop" autoFocus required disabled={busy || uncertain} onChange={(event) => { setName(event.target.value); pending.current = null; }} /></label>}
    <div className={styles.actions}><button type="submit" disabled={busy} className={styles.primary}>{busy ? "Saving…" : uncertain ? "Retry location update" : location ? "Save location" : "Add location"}</button><button type="button" disabled={busy || uncertain} onClick={onCancel}>Cancel</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </form>;
}

export function TradeStockProductSettings({ user, itemId, canManage, disabled = false, initialAction = null, onChanged, onLoaded, onClose }: {
  user: User; itemId: string; canManage: boolean; disabled?: boolean; initialAction?: ProductAction | null;
  onChanged?: (item: StockItem) => void; onLoaded?: (item: StockItem) => void; onClose?: () => void;
}) {
  const [item, setItem] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockHistoryEntry[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [members, setMembers] = useState<StockMember[]>([]);
  const [locationId, setLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [locationEditor, setLocationEditor] = useState<StockLocation | "new" | null>(null);
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
      if (!result.ok || result.item?.itemId !== itemId || !Array.isArray(result.item.locations) || !Array.isArray(result.history) || !Array.isArray(result.locations) || !Array.isArray(result.members)) throw new Error("Stock details could not be verified. Load them again.");
      if (controller.signal.aborted) return;
      setItem(result.item); setHistory(result.history); setLocations(result.locations); setMembers(result.members); setAccess(result.canManage === true); setNeedsRefresh(false);
      const defaultLocationId = result.locations.find((location) => location.isDefault)?.id || result.locations[0]?.id || "";
      setLocationId((current) => result.locations.some((location) => location.id === current) ? current : defaultLocationId);
      if (!loadedOnce.current) {
        if (initialAction === "count") setAmount(inputQuantity(result.item.locations.find((location) => location.locationId === defaultLocationId)?.onHandMilli || 0));
        setWarning(result.item.lowStockMilli ? inputQuantity(result.item.lowStockMilli) : ""); loadedOnce.current = true;
      }
      onLoadedRef.current?.(result.item);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) { setLoadError(failure instanceof Error ? failure.message : "Stock could not be loaded."); setAccess(false); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialAction, itemId, reload, user]);

  function begin(next: ProductAction) {
    if (!writable || busy || loading || uncertain || locationEditor !== null || !item) return;
    setAction(next); setAmount(next === "count" ? inputQuantity(item.locations.find((location) => location.locationId === locationId)?.onHandMilli || 0) : next === "enable" ? "0" : "");
    if (next === "transfer") setToLocationId(locations.find((location) => location.id !== locationId)?.id || "");
    setWarning(item.lowStockMilli ? inputQuantity(item.lowStockMilli) : ""); setNote(""); setError(""); setMessage(""); setNeedsRefresh(false); pendingMutation.current = null;
  }

  async function mutate(selectedAction: ProductAction | "disable") {
    if (!writable || !item || inFlight.current || loading || needsRefresh) return;
    setError(""); setMessage("");
    let mutation: StockMutation;
    try {
      const values = { action: selectedAction, itemId, expectedRevision: item.revision, note: note.trim(),
        ...(["enable", "receive", "count"].includes(selectedAction) ? { locationId } : {}),
        ...(selectedAction === "transfer" ? { fromLocationId: locationId, toLocationId } : {}),
        ...(["enable", "receive", "count", "transfer"].includes(selectedAction) ? { quantityMilli: toMilli(amount, selectedAction === "receive" ? "Quantity received" : "Quantity", ["receive", "transfer"].includes(selectedAction) ? 1 : 0) } : {}),
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
      if (!result.ok || result.item?.itemId !== itemId || !Array.isArray(result.item.locations) || !Array.isArray(result.history) || !Array.isArray(result.locations) || !Array.isArray(result.members)) throw new Error("The update was not confirmed. Try again to check this same update safely.");
      if (!mounted.current) return;
      setItem(result.item); setHistory(result.history); setLocations(result.locations); setMembers(result.members); setAccess(result.canManage === true); pendingMutation.current = null;
      setAction(null); setNote(""); setNeedsRefresh(false); setUncertain(false); onLoadedRef.current?.(result.item); onChangedRef.current?.(result.item);
      setMessage(selectedAction === "enable" ? "Stock tracking is on." : selectedAction === "disable" ? "Tracking is off. Saved counts and history are kept." : selectedAction === "receive" ? "Delivery added to stock." : selectedAction === "count" ? "Stocktake saved." : selectedAction === "transfer" ? "Stock moved. The business total has not changed." : "Stock warning saved.");
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
      {onClose ? <button type="button" onClick={onClose} disabled={busy || uncertain || locationEditor !== null}>Back to stock</button> : !loading && item && !item.tracked && item.recordStatus === "active" && writable && !action && <button type="button" disabled={locationEditor !== null} onClick={() => begin("enable")}>Track stock</button>}
    </header>
    {loading && <p role="status">Loading stock…</p>}
    {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={refresh} disabled={loading}>Load stock again</button></p>}
    {!loading && !loadError && item && <>
      {(item.tracked || item.revision > 0) && <><StockNumbers item={item} />{item.tracked && item.availableMilli <= item.lowStockMilli && <p className={styles.lowStock}>{item.availableMilli < 0 ? "Stock short" : "Low stock"} · {quantity(item.availableMilli)} {units(item)} available</p>}{!item.tracked && <p className={styles.hint}>Tracking is off. Saved location counts are retained; new quotes do not commit this product.</p>}</>}
      {item.recordStatus === "archived" && item.tracked && <p className={styles.hint}>Archived product. You can still manage its remaining stock.</p>}
      {disabled && <p className={styles.hint}>Save product changes before updating stock.</p>}
      {item.tracked && !action && writable && <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || uncertain || locationEditor !== null} onClick={() => begin("receive")}>Receive stock</button><button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => begin("count")}>Stocktake</button>{locations.length > 1 && <button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => begin("transfer")}>Move stock</button>}</div>}
      {!item.tracked && item.revision > 0 && !action && writable && <div className={styles.actions}><button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => begin("count")}>Stocktake</button></div>}
      {!action && <section className={styles.locations} aria-label="Storage locations"><div className={styles.locationHeading}><div><h5>Stock locations</h5><p>Keep stock in storage or with a team member. Committed and available totals cover all locations.</p></div>{writable && <button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => setLocationEditor("new")}>Add location</button>}</div>
        <ul>{locations.map((location) => <li key={location.id}><span><strong>{location.name}</strong>{location.isDefault && <small>Default</small>}</span><b>{quantity(item.locations.find((balance) => balance.locationId === location.id)?.onHandMilli || 0)} {units(item)}</b>{writable && !location.responsibleMemberId && <button type="button" className={styles.renameLocation} disabled={busy || uncertain || locationEditor !== null} aria-label={`Edit ${location.name}`} onClick={() => setLocationEditor(location)}>Edit</button>}</li>)}</ul>
      </section>}
      {locationEditor && !action && <StockLocationEditor key={locationEditor === "new" ? "new" : locationEditor.id} user={user} location={locationEditor === "new" ? null : locationEditor} members={members} onCancel={() => { setLocationEditor(null); refresh(); }} onSaved={(nextLocations, saved) => { setLocations(nextLocations); setLocationId(saved.id); setLocationEditor(null); refresh(); }} />}
      {action && <form className={styles.actionForm} onSubmit={submit}>
        <fieldset disabled={!writable || busy || loading || needsRefresh || uncertain}><legend>{action === "enable" ? "Start with what you have" : action === "receive" ? "Add a delivery" : action === "count" ? "Count what is here" : action === "transfer" ? "Move between locations" : "Low-stock warning"}</legend>
          <div className={styles.fields}>
            {action !== "configure" && <label><span>{action === "transfer" ? "Move from" : "Storage location"}</span><select value={locationId} required onChange={(event) => { setLocationId(event.target.value); if (action === "count") setAmount(inputQuantity(item.locations.find((location) => location.locationId === event.target.value)?.onHandMilli || 0)); if (action === "transfer" && event.target.value === toLocationId) setToLocationId(locations.find((location) => location.id !== event.target.value)?.id || ""); }}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
            {action === "transfer" && <label><span>Move to</span><select value={toLocationId} required onChange={(event) => setToLocationId(event.target.value)}>{locations.filter((location) => location.id !== locationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
            {action !== "configure" && !(action === "enable" && item.revision > 0) && <label><span>{action === "enable" ? "Opening quantity" : action === "receive" ? "Quantity received" : action === "transfer" ? "Quantity to move" : "Actual quantity on hand"} ({units(item)})</span><input type="number" inputMode="decimal" min={action === "receive" || action === "transfer" ? ".001" : "0"} max={MAX_STOCK_QUANTITY_MILLI / 1000} step=".001" value={amount} required autoFocus onChange={(event) => setAmount(event.target.value)} /></label>}
            {(action === "enable" || action === "configure") && <label><span>Warn when available reaches, optional</span><input type="number" inputMode="decimal" min="0" max={MAX_STOCK_QUANTITY_MILLI / 1000} step=".001" value={warning} placeholder="0" onChange={(event) => setWarning(event.target.value)} /><small>Leave blank to warn only when none is available.</small></label>}
          </div>
          {action === "enable" && item.revision > 0 && <p className={styles.hint}>Your saved counts at every location will be kept.</p>}
          {action === "count" && <p className={styles.hint}>This replaces the count at {locations.find((location) => location.id === locationId)?.name}. Other locations stay unchanged. Committed across the business: {quantity(item.reservedMilli)} {units(item)}.</p>}
          {action === "receive" && <p className={styles.hint}>Adds to the current {quantity(item.locations.find((location) => location.locationId === locationId)?.onHandMilli || 0)} {units(item)} at this location.</p>}
          {action === "transfer" && <p className={styles.hint}>{quantity(item.locations.find((location) => location.locationId === locationId)?.onHandMilli || 0)} {units(item)} on hand at the source. Moving stock keeps your business total unchanged.</p>}
          {(action === "receive" || action === "count") && <details className={styles.note}><summary>Add a note, optional</summary><label><span>Stock note</span><input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "receive" ? "e.g. Supplier delivery reference" : "e.g. Damaged item removed"} /></label></details>}
        </fieldset>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={!writable || busy || loading || needsRefresh}>{busy ? "Saving…" : uncertain ? "Retry this update" : actionLabels[action]}</button><button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => { setAction(null); setError(""); if (needsRefresh) refresh(); }}>Cancel</button></div>
      </form>}
      {(item.tracked || item.revision > 0) && !action && <details className={styles.details}><summary>Stock settings and recent activity</summary>
        {writable && item.tracked && <div className={styles.settingsActions}><div><p>Low-stock warning: {quantity(item.lowStockMilli)} {units(item)} available</p><button type="button" disabled={busy || uncertain || locationEditor !== null} onClick={() => begin("configure")}>Change warning</button></div><div><p>{item.reservedMilli ? "Release this product's job commitments before turning tracking off." : "Turn tracking off and keep your saved location counts and history."}</p><button type="button" disabled={busy || uncertain || locationEditor !== null || item.reservedMilli !== 0} onClick={() => void mutate("disable")}>Stop tracking</button></div></div>}
        {history.length ? <ul className={styles.history}>{history.map((entry) => <li key={entry.id}><div><strong>{historyLabels[entry.action] || "Stock updated"}</strong><span>{new Date(entry.createdAt).toLocaleString("en-AU")}{entry.note ? ` · ${entry.note}` : ""}</span></div><div><strong>{entry.action === "transfer" ? `${quantity(entry.quantityMilli)} moved` : `${entry.changeMilli > 0 ? "+" : ""}${quantity(entry.changeMilli)}`}</strong><span>{quantity(entry.onHandMilli)} on hand</span></div></li>)}</ul> : <p className={styles.hint}>No stock movements yet.</p>}
      </details>}
    </>}
    {error && <p className={styles.error} role="alert">{error}{uncertain && <><span>The result is not confirmed. Retry this same update before entering another quantity.</span>{!action && <button type="button" disabled={busy} onClick={() => void mutate("disable")}>Retry this update</button>}</>}{needsRefresh && <> <button type="button" onClick={refresh} disabled={busy || loading}>Refresh stock</button><span>Your entered quantity is kept. Check the updated count before saving.</span></>}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}

export function TradeStockWorkspace({ user, canManage, onOpenItems, onTrackedChanged, initialItemId }: {
  user: User; canManage: boolean; onOpenItems: () => void; onTrackedChanged?: () => void; initialItemId?: string;
}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [access, setAccess] = useState(false);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<{ itemId: string; action: ProductAction | null } | null>(() => initialItemId ? { itemId: initialItemId, action: null } : null);
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
    <header className={styles.header}><div><h3 id="trade-stock-title">Stock</h3><p>On hand minus committed gives available stock. A negative number shows what is still needed.</p></div><button type="button" onClick={onOpenItems}>Price-book items</button></header>
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
