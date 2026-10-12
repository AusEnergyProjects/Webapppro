"use client";
/* Local product photos have fixed dimensions. */
/* eslint-disable @next/next/no-img-element */
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ProductComparisonItem } from "@/lib/product-guides";
import type { ProductRatingExplanation } from "@/lib/product-ratings";
import { readProductComparisonDetails, type ProductComparisonCard } from "./product-comparison-data";
import { ProductRebateChecker, ProductRebateResult, useProductRebateCheck } from "./ProductRebateChecker";
import { nextProductComparisonSort, productComparisonSortLabel, sortProductComparisons, type ProductComparisonSort } from "./product-comparison-sort";
import "./product-comparison.css";

// Keep server-rendered controls inert until their event handlers attach.
const subscribeToClient = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;
const measurementNumber = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });

const ProductPhoto = memo(function ProductPhoto({ product, eager = false }: { product: Pick<ProductComparisonCard, "image">; eager?: boolean }) {
  return <img src={product.image.src} alt={product.image.alt} width="560" height="400" loading={eager ? "eager" : "lazy"} decoding="async" />;
});
const VisualRatings = memo(function VisualRatings({ product }: { product: ProductComparisonCard }) {
  return <div className="product-comparison-ratings" aria-label="Comparable product ratings">
    {product.ratings.map(rating => <section key={rating.id} className={`product-comparison-rating product-comparison-rating-${rating.id}`} data-rating={rating.id}>
      <div className="product-comparison-rating-label"><h3>{rating.label}</h3><span>{rating.score === null ? "See note" : `${rating.score.toFixed(1)} / 5`}</span></div>
      {rating.score === null ? <div className="product-comparison-rating-track product-comparison-rating-unavailable" aria-hidden="true" /> : <div className="product-comparison-rating-track" role="meter" aria-label={`${product.name}: ${rating.label}`} aria-valuemin={0} aria-valuemax={5} aria-valuenow={rating.score} aria-valuetext={`${rating.score.toFixed(1)} out of 5`}><span style={{ width: `${rating.score * 20}%` }} /></div>}
      {rating.score !== null && rating.measurement && <small className="product-comparison-rating-figure"><MeasurementValue value={rating.measurement.value} valueMaximum={rating.measurement.valueMaximum} unit={rating.measurement.unit} /></small>}
      {rating.score === null && <small className="product-comparison-rating-figure">{rating.reason}</small>}
    </section>)}
  </div>;
});
function MeasurementValue({ value, valueMaximum, unit }: { value: number; valueMaximum?: number; unit: string }) {
  const number = measurementNumber.format(value);
  if (unit === "included-product-years") return <>{number} {value === 1 ? "year" : "years"} of main-product parts cover</>;
  if (unit === "usable-kwh") return <>{number} kWh usable storage</>;
  if (unit === "tank-litres") return <>{number} litres</>;
  if (unit === "cooling-kw") return <>{number} kW rated cooling</>;
  if (unit === "zoned-heating-stars") return <>{number} heating stars</>;
  if (unit === "cop-a20-w15-55") return <>{number} units of heat per unit of electricity</>;
  if (unit === "ev-ac-kw") return <>{number} kW rated charging power</>;
  if (unit === "published-noise-db") return <>{number} dB</>;
  if (unit === "recovery-litres-per-hour") return <>{number}{valueMaximum !== undefined && valueMaximum > value && <> to {measurementNumber.format(valueMaximum)}</>} litres per hour</>;
  return <>{number}%</>;
}
const ComparisonFacts = memo(function ComparisonFacts({ product }: { product: ProductComparisonCard }) {
  if (!product.pros.length) throw new Error("Missing verified benefits for " + product.id);
  return <div className="product-comparison-facts">
    <section className="product-comparison-pros" data-product-fact="pros"><h3>Pros</h3><ul>{product.pros.map(text => <li key={text}>{text}</li>)}</ul></section>
    <section className="product-comparison-cons" data-product-fact="cons"><h3>Cons</h3>{product.cons.length ? <ul>{product.cons.map(text => <li key={text}>{text}</li>)}</ul> : <p className="product-comparison-unknown">No model-specific drawback verified.</p>}</section>
    {product.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {product.warning}</p>}
  </div>;
});
const HotWaterFacts = memo(function HotWaterFacts({ product }: { product: ProductComparisonCard }) {
  if (!product.hotWaterFacts) return null;
  const facts = product.hotWaterFacts;
  return <div className="product-comparison-hot-water" data-hot-water-facts><p>{facts.conditions}{facts.recoverySourceUrl && <> <a href={facts.recoverySourceUrl} target="_blank" rel="noopener noreferrer">Recovery source ↗</a></>}</p></div>;
});
export function ProductComparisonBrowser({ category, products, methods }: { category: string; products: ProductComparisonCard[]; methods: ProductRatingExplanation[] }) {
  const ready = useSyncExternalStore(subscribeToClient, clientReadySnapshot, serverReadySnapshot);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProductComparisonSort>({ criterion: "name", direction: "ascending" });
  const [selection, setSelection] = useState<string[]>([]);
  const [information, setInformation] = useState<ProductComparisonItem | null>(null);
  const [requestedInformation, setRequestedInformation] = useState<ProductComparisonCard | null>(null);
  const [informationError, setInformationError] = useState("");
  const informationCache = useRef(new Map<string, ProductComparisonItem>());
  const informationController = useRef<AbortController | null>(null);
  const compareDialog = useRef<HTMLDialogElement>(null);
  const informationDialog = useRef<HTMLDialogElement>(null);
  const methodDialog = useRef<HTMLDialogElement>(null);
  const rebateCategory = category === "hot-water" || category === "air-conditioning" || category === "multi-split" ? category : undefined;
  const rebates = useProductRebateCheck(rebateCategory);
  const hasHotWater = useMemo(() => products.some(product => product.hotWaterFacts), [products]);
  const visible = useMemo(() => sortProductComparisons(products, query, sort), [products, query, sort]);
  const activeSortMethod = methods.find(method => method.id === sort.criterion) ?? null;
  const sortLabel = productComparisonSortLabel(activeSortMethod, sort.direction);
  const comparisonRows = 7 + methods.length + (hasHotWater ? 1 : 0) + (rebateCategory ? 1 : 0);
  const selected = useMemo(() => selection.map(id => products.find(p => p.id === id)).filter((p): p is ProductComparisonCard => Boolean(p)), [selection, products]);
  useEffect(() => () => informationController.current?.abort(), []);
  function closeInformation() {
    informationController.current?.abort();
    informationController.current = null;
    setRequestedInformation(null);
    setInformation(null);
    setInformationError("");
  }
  async function showInformation(product: ProductComparisonCard) {
    informationController.current?.abort();
    const cached = informationCache.current.get(product.id);
    setRequestedInformation(product);
    setInformation(cached ?? null);
    setInformationError("");
    if (!informationDialog.current?.open) informationDialog.current?.showModal();
    if (cached) { informationController.current = null; return; }
    const controller = new AbortController();
    informationController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/product-details?productId=${encodeURIComponent(product.id)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("The product specifications could not be loaded. Try again.");
      const raw: unknown = await response.json();
      const result = readProductComparisonDetails(raw, product.id);
      if (informationController.current !== controller || controller.signal.aborted) return;
      informationCache.current.set(product.id, result);
      setInformation(result);
    } catch (error) {
      if (informationController.current !== controller) return;
      setInformationError(controller.signal.aborted ? "Loading specifications took too long. Try again." : error instanceof Error ? error.message : "The product specifications could not be loaded. Try again.");
    } finally {
      window.clearTimeout(timeout);
      if (informationController.current === controller) informationController.current = null;
    }
  }
  function toggleSelection(id: string) { setSelection(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 3 ? [...current, id] : current); }
  return <>
    {rebateCategory && <ProductRebateChecker check={rebates} ready={ready} />}
    <div className="product-comparison-toolbar" aria-busy={!ready}>
      <label>Search products<input type="search" value={query} placeholder="Brand or model" disabled={!ready} onChange={e => setQuery(e.target.value)} /></label>
      <div className="product-comparison-toolbar-help"><p>Pick two or three to compare side by side.</p><button type="button" disabled={!ready} onClick={() => methodDialog.current?.showModal()}>How the bars work</button></div>
    </div>
    <div className="product-comparison-sort" role="group" aria-label="Sort products">
      <span>Sort by</span>
      <div className="product-comparison-sort-options">
        <button type="button" aria-pressed={sort.criterion === "name"} disabled={!ready} onClick={() => setSort(current => nextProductComparisonSort(current, "name"))}>{productComparisonSortLabel(null, sort.criterion === "name" ? sort.direction : "ascending")}</button>
        {methods.map(method => <button key={method.id} type="button" aria-pressed={sort.criterion === method.id} disabled={!ready} onClick={() => setSort(current => nextProductComparisonSort(current, method.id))}>{productComparisonSortLabel(method, sort.criterion === method.id ? sort.direction : method.id === "noise" ? "ascending" : "descending")}</button>)}
      </div>
    </div>
    <p className="product-comparison-count" role="status">{visible.length} {visible.length === 1 ? "model" : "models"}{visible.length !== products.length ? ` of ${products.length}` : ""}. Sorted by {sortLabel.toLowerCase()}. Click the same choice to reverse the order.</p>
    <p className="product-comparison-rating-key">For {methods.filter(method => method.id !== "noise").map(method => method.label.toLowerCase()).join(" and ")}, more bars means a higher published figure.{methods.some(method => method.id === "noise") && " For noise, more bars means lower published dB."}</p>
    <div className="product-comparison-grid" aria-label="Product options">{visible.map((product, index) => {
      const picked = selection.includes(product.id);
      return <article key={product.id} id={product.id} className={`product-comparison-card${picked ? " product-comparison-selected" : ""}`}>
        <div className="product-comparison-photo"><ProductPhoto product={product} eager={index < 3} /><span>{product.brand}</span></div>
        <div className="product-comparison-card-body"><h2>{product.name}</h2><VisualRatings product={product} /><HotWaterFacts product={product} />{rebateCategory && <ProductRebateResult product={product} check={rebates} ready={ready} />}<ComparisonFacts product={product} />
          <div className="product-comparison-card-actions"><button type="button" aria-label={`${picked ? "Remove" : "Select"} ${product.name} ${picked ? "from" : "for"} comparison`} aria-pressed={picked} disabled={!ready || (!picked && selection.length === 3)} onClick={() => toggleSelection(product.id)}>{picked ? "✓ Selected" : "+ Compare"}</button><button type="button" className="product-comparison-info-button" aria-label={`Technical specifications for ${product.name}`} disabled={!ready} onClick={() => showInformation(product)}>Specs ↗</button></div>
        </div>
      </article>;
    })}</div>
    {visible.length === 0 && <div className="product-comparison-empty"><h2>No matching products</h2><button type="button" onClick={() => setQuery("")}>Show all products</button></div>}
    <p className="product-comparison-note">Confirm the exact model, installation and warranty with your installer.</p>
    {selection.length > 0 && <aside className="product-comparison-tray" aria-label="Selected products">
      <div className="product-comparison-picks">{selected.map(product => <button key={product.id} type="button" onClick={() => toggleSelection(product.id)} aria-label={`Remove ${product.name} from comparison`}><ProductPhoto product={product} /><span>{product.name}</span><b aria-hidden="true">×</b></button>)}</div>
      <div className="product-comparison-tray-actions"><button type="button" className="product-comparison-clear" onClick={() => setSelection([])}>Clear</button><button type="button" disabled={selected.length < 2} onClick={() => compareDialog.current?.showModal()}>{selected.length < 2 ? "Choose one more" : "Compare side by side"}</button></div>
      <span role="status" className="product-comparison-sr-only">{selection.length === 3 ? "Three products selected. Remove one to select another." : `${selection.length} products selected.`}</span>
    </aside>}
    <dialog ref={compareDialog} className="product-comparison-dialog" aria-labelledby="product-comparison-title">
      <header className="product-comparison-dialog-header"><h2 id="product-comparison-title">Side by side</h2><button type="button" autoFocus onClick={() => compareDialog.current?.close()} aria-label="Close product comparison">Close ×</button></header>
      <div className="product-comparison-comparison-scroll" tabIndex={0} role="region" aria-label="Side-by-side product comparison"><div className="product-comparison-comparison-grid" style={{ gridTemplateColumns: `repeat(${Math.max(selected.length, 1)}, minmax(260px, 1fr))`, gridTemplateRows: `180px repeat(${comparisonRows - 1}, auto)` }}>{selected.map(product => <article key={product.id} style={{ gridRow: `span ${comparisonRows}` }}><div className="product-comparison-photo"><ProductPhoto product={product} eager /><span>{product.brand}</span></div><h2>{product.name}</h2><VisualRatings product={product} /><HotWaterFacts product={product} />{rebateCategory && <ProductRebateResult product={product} check={rebates} ready={ready} />}<ComparisonFacts product={product} /></article>)}</div></div>
      <p className="product-comparison-note">Swipe across on a small screen.</p>
    </dialog>
    <dialog ref={informationDialog} className="product-comparison-dialog product-comparison-information" aria-labelledby="product-information-title" onClose={closeInformation}>
      <header className="product-comparison-dialog-header"><h2 id="product-information-title">{requestedInformation?.name}</h2><button type="button" autoFocus onClick={() => informationDialog.current?.close()} aria-label="Close technical specifications">Close ×</button></header>
      {requestedInformation && !information && <div className="product-comparison-information-body">{informationError ? <><p role="alert">{informationError}</p><button type="button" onClick={() => showInformation(requestedInformation)}>Try specifications again</button></> : <p role="status">Loading product specifications...</p>}</div>}
      {information && <div className="product-comparison-information-body">
        {information.warning && <p className="product-comparison-warning"><strong>Safety check:</strong> {information.warning}</p>}
        <p className="product-comparison-generation"><strong>{information.freshness.generation}</strong><br />{information.freshness.note} <a href={information.freshness.sourceUrl} target="_blank" rel="noopener noreferrer">Generation source ↗</a></p>
        <dl className="product-comparison-specs">{information.technicalSpecs.map(spec => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value} <a href={spec.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${spec.label}`}>↗</a></dd></div>)}</dl>
        <h3>Figures behind the bars</h3>
        {information.ratings.map(rating => <section key={rating.id} className="product-comparison-measurement">
          <h4>{rating.label}</h4>
          {rating.measurement ? <>
            <p><strong><MeasurementValue value={rating.measurement.value} valueMaximum={rating.measurement.valueMaximum} unit={rating.measurement.unit} /></strong> for {rating.measurement.variant}.</p>
            <p>{rating.measurement.basis}</p>
            <a href={rating.measurement.sourceUrl} target="_blank" rel="noopener noreferrer">Figure source ↗</a>
            {rating.reason && <p>{rating.reason}. This figure has no bar score.</p>}
          </> : <>
            {rating.reason && <p>{rating.reason.replace(/\.$/, "")}. Ask your installer for the exact figure.</p>}
            {rating.unavailableEvidence && <a href={rating.unavailableEvidence.sourceUrl} target="_blank" rel="noopener noreferrer">Related source ↗</a>}
          </>}
        </section>)}
        <h3>Product documents</h3><ul>{information.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><small>{source.revision}</small></li>)}</ul><a href={information.image.sourceUrl} target="_blank" rel="noopener noreferrer">Photo source ↗</a><p>Information checked <time dateTime={information.checkedAt}>{new Date(`${information.checkedAt}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</time>. Confirm current availability and support.</p>
      </div>}
    </dialog>
    <dialog ref={methodDialog} className="product-comparison-dialog product-comparison-information" aria-labelledby="product-rating-method-title">
      <header className="product-comparison-dialog-header"><h2 id="product-rating-method-title">How the bars work</h2><button type="button" autoFocus onClick={() => methodDialog.current?.close()} aria-label="Close rating explanation">Close ×</button></header>
      <div className="product-comparison-information-body"><p>Each bar puts a published or calculated figure on our fixed 0 to 5 visual scale. These are not official product ratings, customer review stars or an overall recommendation. Scores are rounded to one decimal and stay between 0 and 5. Search and selection do not change them.</p>{methods.map(method => <section key={method.id} className="product-comparison-measurement"><h3>{method.label}</h3><p>{method.explanation}</p></section>)}<p><strong>See note</strong> means the available source does not give a comparable figure. The note explains what the brand publishes, and Specs includes the exact source and conditions.</p><p>Larger capacity is not automatically a better match. Choose equipment sized for your home and needs.</p><p>Creditex is <a href="https://esia.asn.au/members/creditex" target="_blank" rel="noopener noreferrer">listed by ESIA as part of the Emerald Group</a>. Emerald products use the same comparison criteria as other brands.</p></div>
    </dialog>
  </>;
}
