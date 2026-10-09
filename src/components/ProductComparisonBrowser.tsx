"use client";
/* Local product photos have fixed dimensions. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ProductComparisonCriterion, ProductComparisonItem } from "@/lib/product-guides";
import "./product-comparison.css";

// Keep server-rendered controls inert until their event handlers attach.
const subscribeToClient = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;

function ProductPhoto({ product, eager = false }: { product: ProductComparisonItem; eager?: boolean }) {
  return <img src={product.image.src} alt={product.image.alt} width="560" height="400" loading={eager ? "eager" : "lazy"} decoding="async" />;
}
function ComparisonFacts({ product, criteria }: { product: ProductComparisonItem; criteria: ProductComparisonCriterion[] }) {
  return <div className="product-comparison-facts">
    {criteria.map(criterion => {
      const point = product.comparisons.find(item => item.criterion === criterion.id);
      if (!point) throw new Error('Missing ' + criterion.id + ' comparison for ' + product.id);
      return <section key={criterion.id} className="product-comparison-criterion" data-criterion={criterion.id}>
        <h3>{criterion.label}</h3>
        {point.pro ? <p className="product-comparison-pro"><strong>Pro</strong><span>{point.pro}</span></p> : <p className="product-comparison-unknown"><strong>Check</strong><span>No confirmed benefit.</span></p>}
        <p className="product-comparison-con"><strong>Con</strong><span>{point.con}</span></p>
      </section>;
    })}
    {product.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {product.warning}</p>}
  </div>;
}
export function ProductComparisonBrowser({ products, criteria }: { products: ProductComparisonItem[]; criteria: ProductComparisonCriterion[] }) {
  const ready = useSyncExternalStore(subscribeToClient, clientReadySnapshot, serverReadySnapshot);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [information, setInformation] = useState<ProductComparisonItem | null>(null);
  const compareDialog = useRef<HTMLDialogElement>(null);
  const informationDialog = useRef<HTMLDialogElement>(null);
  const brands = [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b));
  const search = query.trim().toLocaleLowerCase("en-AU");
  const visible = products.filter(p => (!brand || p.brand === brand) && `${p.name} ${p.brand}`.toLocaleLowerCase("en-AU").includes(search));
  const selected = selection.map(id => products.find(p => p.id === id)).filter((p): p is ProductComparisonItem => Boolean(p));
  useEffect(() => { if (information && !informationDialog.current?.open) informationDialog.current?.showModal(); }, [information]);
  function toggleSelection(id: string) { setSelection(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 3 ? [...current, id] : current); }
  return <>
    <div className="product-comparison-toolbar" aria-busy={!ready}>
      <label>Search products<input type="search" value={query} placeholder="Brand or model" disabled={!ready} onChange={e => setQuery(e.target.value)} /></label>
      <label>Brand<select value={brand} disabled={!ready} onChange={e => setBrand(e.target.value)}><option value="">All brands</option>{brands.map(value => <option key={value}>{value}</option>)}</select></label>
      <p>Pick two or three to compare side by side.</p>
    </div>
    <div className="product-comparison-grid" aria-label="Product options">{visible.map((product, index) => {
      const picked = selection.includes(product.id);
      return <article key={product.id} id={product.id} className={`product-comparison-card${picked ? " product-comparison-selected" : ""}`}>
        <div className="product-comparison-photo"><ProductPhoto product={product} eager={index < 3} /><span>{product.brand}</span></div>
        <div className="product-comparison-card-body"><h2>{product.name}</h2><ComparisonFacts product={product} criteria={criteria} />
          <div className="product-comparison-card-actions"><button type="button" aria-label={`${picked ? "Remove" : "Select"} ${product.name} ${picked ? "from" : "for"} comparison`} aria-pressed={picked} disabled={!ready || (!picked && selection.length === 3)} onClick={() => toggleSelection(product.id)}>{picked ? "✓ Selected" : "+ Compare"}</button><button type="button" className="product-comparison-info-button" aria-label={`Product information for ${product.name}`} disabled={!ready} onClick={() => setInformation(product)}>Product info ↗</button></div>
        </div>
      </article>;
    })}</div>
    {visible.length === 0 && <div className="product-comparison-empty"><h2>No matching products</h2><button type="button" onClick={() => { setQuery(""); setBrand(""); }}>Show all products</button></div>}
    <p className="product-comparison-note">Products are listed alphabetically. Confirm the exact model, installation and warranty with your installer.</p>
    {selection.length > 0 && <aside className="product-comparison-tray" aria-label="Selected products">
      <div className="product-comparison-picks">{selected.map(product => <button key={product.id} type="button" onClick={() => toggleSelection(product.id)} aria-label={`Remove ${product.name} from comparison`}><ProductPhoto product={product} /><span>{product.name}</span><b aria-hidden="true">×</b></button>)}</div>
      <div className="product-comparison-tray-actions"><button type="button" className="product-comparison-clear" onClick={() => setSelection([])}>Clear</button><button type="button" disabled={selected.length < 2} onClick={() => compareDialog.current?.showModal()}>{selected.length < 2 ? "Choose one more" : "Compare side by side"}</button></div>
      <span role="status" className="product-comparison-sr-only">{selection.length === 3 ? "Three products selected. Remove one to select another." : `${selection.length} products selected.`}</span>
    </aside>}
    <dialog ref={compareDialog} className="product-comparison-dialog" aria-labelledby="product-comparison-title">
      <header className="product-comparison-dialog-header"><h2 id="product-comparison-title">Side by side</h2><button type="button" autoFocus onClick={() => compareDialog.current?.close()} aria-label="Close product comparison">Close ×</button></header>
      <div className="product-comparison-comparison-scroll" tabIndex={0} role="region" aria-label="Side-by-side product comparison"><div className="product-comparison-comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(selected.length, 1)}, minmax(260px, 1fr))` }}>{selected.map(product => <article key={product.id}><div className="product-comparison-photo"><ProductPhoto product={product} eager /><span>{product.brand}</span></div><h2>{product.name}</h2><ComparisonFacts product={product} criteria={criteria} /></article>)}</div></div>
      <p className="product-comparison-note">Swipe across on a small screen.</p>
    </dialog>
    <dialog ref={informationDialog} className="product-comparison-dialog product-comparison-information" aria-labelledby="product-information-title" onClose={() => setInformation(null)}>
      <header className="product-comparison-dialog-header"><h2 id="product-information-title">{information?.name}</h2><button type="button" autoFocus onClick={() => informationDialog.current?.close()} aria-label="Close product information">Close ×</button></header>
      {information && <div className="product-comparison-information-body">{information.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {information.warning}</p>}<p>Check the manufacturer&apos;s product details and written warranty for the exact model in your quote.</p><ul>{information.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><small>{source.revision}</small></li>)}</ul><a href={information.image.sourceUrl} target="_blank" rel="noopener noreferrer">Photo source ↗</a><p>Information checked <time dateTime={information.checkedAt}>{new Date(`${information.checkedAt}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>. Confirm current availability and support.</p></div>}
    </dialog>
  </>;
}
