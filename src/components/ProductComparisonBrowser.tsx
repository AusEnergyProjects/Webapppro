"use client";
/* Local product photos have fixed dimensions. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ProductComparisonItem } from "@/lib/product-guides";
import type { ProductRatingMethod } from "@/lib/product-ratings";
import "./product-comparison.css";

// Keep server-rendered controls inert until their event handlers attach.
const subscribeToClient = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;

function ProductPhoto({ product, eager = false }: { product: ProductComparisonItem; eager?: boolean }) {
  return <img src={product.image.src} alt={product.image.alt} width="560" height="400" loading={eager ? "eager" : "lazy"} decoding="async" />;
}
function VisualRatings({ product }: { product: ProductComparisonItem }) {
  return <div className="product-comparison-ratings" aria-label="Comparable product ratings">
    {product.ratings.map(rating => <section key={rating.id} className={`product-comparison-rating product-comparison-rating-${rating.id}`} data-rating={rating.id}>
      <div className="product-comparison-rating-label"><h3>{rating.label}</h3><span>{rating.score === null ? "Not scored" : `${rating.score.toFixed(1)} / 5`}</span></div>
      {rating.score === null ? <div className="product-comparison-rating-track product-comparison-rating-unavailable" aria-hidden="true" /> : <div className="product-comparison-rating-track" role="meter" aria-label={`${product.name}: ${rating.label}`} aria-valuemin={0} aria-valuemax={5} aria-valuenow={rating.score} aria-valuetext={`${rating.score.toFixed(1)} out of 5${rating.id === "cost" ? "; more means higher equipment cost" : ""}`}><span style={{ width: `${rating.score * 20}%` }} /></div>}
      {rating.score !== null && rating.measurement && <small className="product-comparison-rating-figure"><MeasurementValue value={rating.measurement.value} unit={rating.measurement.unit} /></small>}
    </section>)}
  </div>;
}
function MeasurementValue({ value, unit }: { value: number; unit: string }) {
  const number = value.toLocaleString("en-AU", { maximumFractionDigits: 2 });
  if (unit === "aud-per-w") return <>${number} per panel watt</>;
  if (unit === "aud-per-kw") return <>${number} per kW</>;
  if (unit === "aud-per-kwh") return <>${number} per usable kWh</>;
  if (unit === "aud-system") return <>${number}</>;
  if (unit === "included-product-years") return <>{number} {value === 1 ? "year" : "years"} for the shortest parts term</>;
  if (unit === "zoned-heating-stars") return <>{number} heating stars</>;
  if (unit === "cop-a20-w15-55") return <>{number} units of heat per unit of electricity</>;
  if (unit === "ev-ac-kw") return <>{number} kW rated charging power</>;
  return <>{number}%</>;
}
function ComparisonFacts({ product }: { product: ProductComparisonItem }) {
  if (!product.pros.length) throw new Error("Missing verified benefits for " + product.id);
  return <div className="product-comparison-facts">
    <section className="product-comparison-pros" data-product-fact="pros"><h3>Pros</h3><ul>{product.pros.map(text => <li key={text}>{text}</li>)}</ul></section>
    <section className="product-comparison-cons" data-product-fact="cons"><h3>Cons</h3>{product.cons.length ? <ul>{product.cons.map(text => <li key={text}>{text}</li>)}</ul> : <p className="product-comparison-unknown">No model-specific drawback verified.</p>}</section>
    {product.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {product.warning}</p>}
  </div>;
}
export function ProductComparisonBrowser({ products, methods }: { products: ProductComparisonItem[]; methods: ProductRatingMethod[] }) {
  const ready = useSyncExternalStore(subscribeToClient, clientReadySnapshot, serverReadySnapshot);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [information, setInformation] = useState<ProductComparisonItem | null>(null);
  const compareDialog = useRef<HTMLDialogElement>(null);
  const informationDialog = useRef<HTMLDialogElement>(null);
  const methodDialog = useRef<HTMLDialogElement>(null);
  const brands = [...new Set(products.map(p => p.brand))].sort((a, b) => a.localeCompare(b));
  const search = query.trim().toLocaleLowerCase("en-AU");
  const visible = products.filter(p => (!brand || p.brand === brand) && `${p.name} ${p.brand} ${p.technicalSpecs.map(spec => spec.value).join(" ")}`.toLocaleLowerCase("en-AU").includes(search));
  const selected = selection.map(id => products.find(p => p.id === id)).filter((p): p is ProductComparisonItem => Boolean(p));
  useEffect(() => { if (information && !informationDialog.current?.open) informationDialog.current?.showModal(); }, [information]);
  function toggleSelection(id: string) { setSelection(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 3 ? [...current, id] : current); }
  return <>
    <div className="product-comparison-toolbar" aria-busy={!ready}>
      <label>Search products<input type="search" value={query} placeholder="Brand or model" disabled={!ready} onChange={e => setQuery(e.target.value)} /></label>
      <label>Brand<select value={brand} disabled={!ready} onChange={e => setBrand(e.target.value)}><option value="">All brands</option>{brands.map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="product-comparison-toolbar-help"><p>Pick two or three to compare side by side.</p><button type="button" disabled={!ready} onClick={() => methodDialog.current?.showModal()}>How the bars work</button></div>
    </div>
    <p className="product-comparison-rating-key">Cost: more bars means higher equipment cost. For {methods.filter(method => method.id !== "cost").map(method => method.label.toLowerCase()).join(" and ")}, more bars means a higher published figure.</p>
    <div className="product-comparison-grid" aria-label="Product options">{visible.map((product, index) => {
      const picked = selection.includes(product.id);
      return <article key={product.id} id={product.id} className={`product-comparison-card${picked ? " product-comparison-selected" : ""}`}>
        <div className="product-comparison-photo"><ProductPhoto product={product} eager={index < 3} /><span>{product.brand}</span></div>
        <div className="product-comparison-card-body"><h2>{product.name}</h2><VisualRatings product={product} /><ComparisonFacts product={product} />
          <div className="product-comparison-card-actions"><button type="button" aria-label={`${picked ? "Remove" : "Select"} ${product.name} ${picked ? "from" : "for"} comparison`} aria-pressed={picked} disabled={!ready || (!picked && selection.length === 3)} onClick={() => toggleSelection(product.id)}>{picked ? "✓ Selected" : "+ Compare"}</button><button type="button" className="product-comparison-info-button" aria-label={`Technical specifications for ${product.name}`} disabled={!ready} onClick={() => setInformation(product)}>Specs ↗</button></div>
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
      <div className="product-comparison-comparison-scroll" tabIndex={0} role="region" aria-label="Side-by-side product comparison"><div className="product-comparison-comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(selected.length, 1)}, minmax(260px, 1fr))` }}>{selected.map(product => <article key={product.id}><div className="product-comparison-photo"><ProductPhoto product={product} eager /><span>{product.brand}</span></div><h2>{product.name}</h2><VisualRatings product={product} /><ComparisonFacts product={product} /></article>)}</div></div>
      <p className="product-comparison-note">Swipe across on a small screen.</p>
    </dialog>
    <dialog ref={informationDialog} className="product-comparison-dialog product-comparison-information" aria-labelledby="product-information-title" onClose={() => setInformation(null)}>
      <header className="product-comparison-dialog-header"><h2 id="product-information-title">{information?.name}</h2><button type="button" autoFocus onClick={() => informationDialog.current?.close()} aria-label="Close technical specifications">Close ×</button></header>
      {information && <div className="product-comparison-information-body">
        {information.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {information.warning}</p>}
        <p className="product-comparison-generation"><strong>{information.freshness.generation}</strong><br />{information.freshness.note} <a href={information.freshness.sourceUrl} target="_blank" rel="noopener noreferrer">Generation source ↗</a></p>
        <dl className="product-comparison-specs">{information.technicalSpecs.map(spec => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value} <a href={spec.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${spec.label}`}>↗</a></dd></div>)}</dl>
        <h3>Figures behind the bars</h3>
        {information.ratings.map(rating => <section key={rating.id} className="product-comparison-measurement"><h4>{rating.label}</h4>{rating.measurement ? <><p><strong><MeasurementValue value={rating.measurement.value} unit={rating.measurement.unit} /></strong> for {rating.measurement.variant}.</p><p>{rating.measurement.basis}</p><a href={rating.measurement.sourceUrl} target="_blank" rel="noopener noreferrer">Figure source ↗</a>{rating.reason && <p>{rating.reason}. This figure has no bar score.</p>}</> : <p>{rating.reason}. Ask your installer for the exact figure.</p>}</section>)}
        <h3>Product documents</h3><ul>{information.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><small>{source.revision}</small></li>)}</ul><a href={information.image.sourceUrl} target="_blank" rel="noopener noreferrer">Photo source ↗</a><p>Information checked <time dateTime={information.checkedAt}>{new Date(`${information.checkedAt}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>. Confirm current availability and support.</p>
      </div>}
    </dialog>
    <dialog ref={methodDialog} className="product-comparison-dialog product-comparison-information" aria-labelledby="product-rating-method-title">
      <header className="product-comparison-dialog-header"><h2 id="product-rating-method-title">How the bars work</h2><button type="button" autoFocus onClick={() => methodDialog.current?.close()} aria-label="Close rating explanation">Close ×</button></header>
      <div className="product-comparison-information-body"><p>Each bar puts a published figure on our fixed 0 to 5 visual scale. These are not official product ratings, customer review stars or an overall recommendation. Scores are rounded to one decimal and capped at 5. Search and selection do not change them.</p>{methods.map(method => <section key={method.id} className="product-comparison-measurement"><h3>{method.label}</h3><p>{method.explanation}</p></section>)}<p><strong>Not scored</strong> means we could not verify a comparable figure. It does not mean poor quality. Specs shows the exact model, source and conditions.</p><p>Costs are equipment figures, not installed quotes. Your home&apos;s size, installation and support still matter.</p><p>Creditex is <a href="https://esia.asn.au/members/creditex" target="_blank" rel="noopener noreferrer">listed by ESIA as part of the Emerald Group</a>. Emerald products use the same comparison criteria as other brands.</p></div>
    </dialog>
  </>;
}
