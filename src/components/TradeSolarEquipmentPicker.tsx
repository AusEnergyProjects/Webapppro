"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import { normalizeSolarEquipmentItem, solarEquipmentDescription, SOLAR_STARTER_PANELS, SOLAR_EQUIPMENT_KINDS, SOLAR_EQUIPMENT_LABELS,
  type SolarDesignEquipment, type SolarEquipmentItem, type SolarEquipmentKind } from "@/lib/trade-solar-equipment";
import styles from "./TradeSolarEquipmentPicker.module.css";

type CatalogueProduct = { id: string; name: string; brand: string; modelNumber: string; warrantyYears?: number; datasheetUrl?: string };
type Draft = { id: string; name: string; manufacturer: string; model: string; watts: string; widthM: string; lengthM: string;
  capacityKwh: string; capacityLitres: string; warrantyYears: string; datasheetUrl: string; imageUrl: string; catalogueProductId?: string; priceBookItemId?: string };
function draftFor(item?: SolarEquipmentItem): Draft {
  return { id: item?.id || crypto.randomUUID(), name: item?.name || "", manufacturer: item?.manufacturer || "", model: item?.model || "",
    watts: item?.watts?.toString() || "", widthM: item?.widthM?.toString() || "", lengthM: item?.lengthM?.toString() || "",
    capacityKwh: item?.capacityKwh?.toString() || "", capacityLitres: item?.capacityLitres?.toString() || "",
    warrantyYears: item?.warrantyYears?.toString() || "", datasheetUrl: item?.datasheetUrl || "", imageUrl: item?.imageUrl || "",
    ...(item?.catalogueProductId ? { catalogueProductId: item.catalogueProductId } : {}),
    ...(item?.priceBookItemId ? { priceBookItemId: item.priceBookItemId } : {}) };
}
function catalogueProduct(value: unknown): value is CatalogueProduct {
  if (typeof value !== "object" || !value) return false;
  return "id" in value && typeof value.id === "string" && "name" in value && typeof value.name === "string"
    && "brand" in value && typeof value.brand === "string" && "modelNumber" in value && typeof value.modelNumber === "string";
}
const numberOrUndefined = (value: string) => value.trim() ? Number(value) : undefined;

export type TradeSolarEquipmentPickerProps = {
  user: User;
  kind: SolarEquipmentKind;
  onSelect: (item: SolarEquipmentItem) => void;
  priceBookPanels?: SolarEquipmentItem[];
  selected?: SolarEquipmentItem | null;
  onCancel?: () => void;
};

export function TradeSolarEquipmentPicker({ user, kind, onSelect, priceBookPanels, selected, onCancel }: TradeSolarEquipmentPickerProps) {
  const fetch = useTradeBusinessFetch();
  const id = useId();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownEquipment, setOwnEquipment] = useState<SolarEquipmentItem[]>([]);
  const [ownLoading, setOwnLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const [page, setPage] = useState({ number: 1, cursor: "" });
  const label = SOLAR_EQUIPMENT_LABELS[kind];

  useEffect(() => {
    if (kind === "panel" && priceBookPanels !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      setOwnLoading(true);
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const url = kind === "panel" ? "/api/trade-price-book?mode=solar_panels" : `/api/trade-price-book?mode=solar_equipment&kind=${kind}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        const items = kind === "panel" ? data.solarPanels : data.equipment;
        if (!response.ok || !data.ok || !Array.isArray(items)) throw new Error(data.error || "Your saved equipment could not be loaded.");
        if (!controller.signal.aborted) setOwnEquipment(items.map(normalizeSolarEquipmentItem));
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Your saved equipment could not be loaded.");
      } finally { if (!controller.signal.aborted) setOwnLoading(false); }
    })();
    return () => controller.abort();
  }, [fetch, user, kind, priceBookPanels]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setCatalogueError("");
      try {
        const params = new URLSearchParams({ search, category: kind === "hot_water" ? "hot-water" : kind === "battery" ? "battery" : "solar", facets: "0", total: "0", pageSize: "25", page: String(page.number) });
        if (page.cursor) params.set("cursor", page.cursor);
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/product-marketplace?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "The catalogue could not be loaded.");
        if (!Array.isArray(data.products)) throw new Error("The catalogue returned invalid products.");
        const rows = data.products.filter(catalogueProduct);
        setProducts((current) => page.number === 1 ? rows : [...current, ...rows]);
        setNextCursor(typeof data.pagination?.nextCursor === "string" ? data.pagination.nextCursor : "");
      } catch (reason) {
        if (!controller.signal.aborted) setCatalogueError(reason instanceof Error ? reason.message : "The catalogue could not be loaded.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fetch, user, search, kind, page]);

  function chooseProduct(product: CatalogueProduct) {
    const draft = draftFor();
    setEditing({ ...draft, name: product.name, manufacturer: product.brand, model: product.modelNumber,
      warrantyYears: typeof product.warrantyYears === "number" && product.warrantyYears > 0 ? String(product.warrantyYears) : "",
      datasheetUrl: typeof product.datasheetUrl === "string" ? product.datasheetUrl : "", catalogueProductId: product.id });
    setError("");
  }
  const field = (key: keyof Draft, value: string) => setEditing((current) => current ? { ...current, [key]: value } : null);
  function selectEquipment(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving) return;
    setError(""); setSaving(true);
    try {
      const item = normalizeSolarEquipmentItem({ ...editing, kind, quantity: 1, name: editing.name || `${editing.manufacturer} ${editing.model}`.trim(),
        watts: numberOrUndefined(editing.watts), widthM: numberOrUndefined(editing.widthM), lengthM: numberOrUndefined(editing.lengthM),
        capacityKwh: numberOrUndefined(editing.capacityKwh), capacityLitres: numberOrUndefined(editing.capacityLitres), warrantyYears: numberOrUndefined(editing.warrantyYears) });
      onSelect(item);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Equipment could not be selected."); }
    finally { setSaving(false); }
  }
  const ownItems = kind === "panel" && priceBookPanels !== undefined ? priceBookPanels : ownEquipment;

  return <section className={styles.picker} aria-label={`Choose ${label.toLowerCase()}`}>
    <header><strong>{editing ? `${label} details` : `Choose ${label.toLowerCase()}`}</strong>{onCancel && <button type="button" onClick={onCancel} disabled={saving}>Close</button>}</header>
    {editing ? <form onSubmit={selectEquipment}>
      {editing.catalogueProductId && <p className={styles.help}>Catalogue details added. Check the datasheet for the remaining specifications.</p>}
      {editing.priceBookItemId && <p className={styles.help}>Linked to your price-book item. Tracked stock is committed when the quote is accepted.</p>}
      <div className={styles.fields}>
        <label>Brand<input value={editing.manufacturer} maxLength={140} onChange={(event) => field("manufacturer", event.target.value)} autoComplete="off" /></label>
        <label>Model<input value={editing.model} required maxLength={180} onChange={(event) => field("model", event.target.value)} autoComplete="off" /></label>
        {kind === "panel" && <>
          <label>Power (W)<input type="number" inputMode="decimal" min="1" max="2000" step="any" required value={editing.watts} onChange={(event) => field("watts", event.target.value)} /></label>
          <label>Width (m)<input type="number" inputMode="decimal" min="0.2" max="4" step="any" required value={editing.widthM} onChange={(event) => field("widthM", event.target.value)} /></label>
          <label>Length (m)<input type="number" inputMode="decimal" min="0.2" max="4" step="any" required value={editing.lengthM} onChange={(event) => field("lengthM", event.target.value)} /></label>
        </>}
        {kind === "inverter" && <label>Rated power (W)<input type="number" inputMode="decimal" min="1" max="1000000" step="any" value={editing.watts} onChange={(event) => field("watts", event.target.value)} /></label>}
        {kind === "battery" && <label>Capacity (kWh)<input type="number" inputMode="decimal" min="0.01" max="10000" step="any" value={editing.capacityKwh} onChange={(event) => field("capacityKwh", event.target.value)} /></label>}
        {kind === "hot_water" && <label>Tank size (L)<input type="number" inputMode="decimal" min="1" max="100000" step="any" value={editing.capacityLitres} onChange={(event) => field("capacityLitres", event.target.value)} /></label>}
      </div>
      <details className={styles.details}><summary>Warranty, photo and datasheet</summary><div className={styles.fields}>
        <label>Product name<input value={editing.name} maxLength={180} placeholder="Uses brand and model if blank" onChange={(event) => field("name", event.target.value)} /></label>
        <label>Product warranty (years)<input type="number" inputMode="decimal" min="0" max="100" step="any" value={editing.warrantyYears} onChange={(event) => field("warrantyYears", event.target.value)} /></label>
        <label className={styles.wide}>Manufacturer datasheet link<input type="url" value={editing.datasheetUrl} placeholder="https://" maxLength={2048} onChange={(event) => field("datasheetUrl", event.target.value)} /></label>
        <label className={styles.wide}>Product photo link<input type="url" value={editing.imageUrl} placeholder="https://" maxLength={2048} onChange={(event) => field("imageUrl", event.target.value)} /></label>
      </div></details>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer><button type="button" onClick={() => { setEditing(null); setError(""); }} disabled={saving}>Back</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Saving…" : `Use ${label.toLowerCase()}`}</button></footer>
    </form> : <>
      {(ownLoading || ownItems.length > 0) && <label htmlFor={`${id}-pricebook`} className={styles.favourite}>{kind === "panel" ? "Your price-book panels" : "Your price-book items"}<select id={`${id}-pricebook`} value="" disabled={ownLoading} onChange={(event) => { const item = ownItems.find((candidate) => candidate.id === event.target.value); if (item) onSelect({ ...item, quantity: 1 }); }}>
        <option value="">{ownLoading ? "Loading your items…" : `Choose your ${label.toLowerCase()}`}</option>{ownItems.map((item) => <option key={item.id} value={item.id}>{item.name}{item.watts ? ` · ${item.watts} W` : ""}</option>)}
      </select><small>Choose the product you will supply. Tracked stock is committed after acceptance.</small></label>}
      {error && <p role="status" className={styles.help}>{error}</p>}
      {kind === "panel" && <div className={styles.starters}><strong>Starter models</strong><div>{SOLAR_STARTER_PANELS.map((item) => <button key={item.id} type="button" onClick={() => onSelect({ ...item })}><strong>{item.manufacturer} · {item.watts} W</strong><small>{item.model}</small></button>)}</div><p className={styles.help}>Choose the exact model you will supply. Dimensions come from the linked manufacturer datasheet.</p></div>}
      <label htmlFor={`${id}-search`} className={styles.search}>Approved catalogue<input id={`${id}-search`} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage({ number: 1, cursor: "" }); }} placeholder="Search brand or model" autoComplete="off" /></label>
      {catalogueError ? <p role="status" className={styles.help}>{catalogueError} You can enter your own model below.</p> : <div className={styles.results} aria-busy={loading}>
        {products.map((product) => <button key={product.id} type="button" onClick={() => chooseProduct(product)}><span><strong>{product.brand} {product.modelNumber}</strong><small>{product.name}</small></span><span aria-hidden="true">+</span></button>)}
        {loading && <p role="status">Loading products…</p>}{!loading && !products.length && <p>No matching catalogue products. Enter your model below.</p>}
        {nextCursor && !loading && <button type="button" onClick={() => setPage((current) => ({ number: current.number + 1, cursor: nextCursor }))}>More products</button>}
      </div>}
      <footer>{selected && <button type="button" onClick={() => { setEditing(draftFor(selected)); setError(""); }}>Edit selected model</button>}<button type="button" onClick={() => { setEditing(draftFor()); setError(""); }}>Enter a model</button></footer>
    </>}
  </section>;
}

export function TradeSolarEquipmentList({ user, value, onChange, busy = false, priceBookPanels }: {
  user: User; value: SolarDesignEquipment; onChange: (value: SolarDesignEquipment) => void; busy?: boolean;
  priceBookPanels?: SolarEquipmentItem[];
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<SolarEquipmentKind>("panel");
  return <div className={styles.list}>
    {value.map((item) => <div className={styles.item} key={item.id}>
      <div><strong>{item.name}</strong><small>{solarEquipmentDescription(item) || item.model}</small></div>
      <label>Qty<input aria-label={`Quantity of ${item.name}`} type="number" min="1" max="1000" step="1" value={item.quantity} disabled={busy} onChange={(event) => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000) onChange(value.map((entry) => entry.id === item.id ? { ...entry, quantity } : entry)); }} /></label>
      <button type="button" disabled={busy} onClick={() => onChange(value.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.name}`}>Remove</button>
    </div>)}
    {adding ? <><div className={styles.kinds} aria-label="Equipment type">{SOLAR_EQUIPMENT_KINDS.map((option) => <button type="button" key={option} aria-pressed={kind === option} onClick={() => setKind(option)}>{SOLAR_EQUIPMENT_LABELS[option]}</button>)}</div>
      <TradeSolarEquipmentPicker key={kind} user={user} kind={kind} priceBookPanels={priceBookPanels} onCancel={() => setAdding(false)} onSelect={(item) => { onChange([...value.filter((entry) => entry.id !== item.id), item]); setAdding(false); }} />
    </> : <button type="button" disabled={busy || value.length >= 20} onClick={() => setAdding(true)}>Add equipment</button>}
  </div>;
}
