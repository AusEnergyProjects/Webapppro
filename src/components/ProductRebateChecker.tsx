"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductComparisonItem } from "@/lib/product-guides";
import {
  currentRebateSystemOptions,
  parseProductRebateCheckRequest,
  readProductRebateCheckResult,
  readProductRebateLocalities,
  type ProductRebateCheckResult,
  type ProductRebateCategory,
} from "@/lib/product-rebate-check";

type HomeDetails = { postcode: string; suburb: string; state: string; installationDate: string; currentSystem: string };
type CheckEntry = { profileKey: string } & ({ status: "loading" } | { status: "error"; message: string } | { status: "done"; result: ProductRebateCheckResult });
type Locality = { suburb: string; state: string };
type LocalityLookup = { postcode: string; localities: Locality[]; loading: boolean; error: string };

function todayInAustralia() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function responseError(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}

export function useProductRebateCheck(category: ProductRebateCategory = "hot-water") {
  const [profile, setProfile] = useState<HomeDetails>(() => ({ postcode: "", suburb: "", state: "", installationDate: todayInAustralia(), currentSystem: "" }));
  const [lookup, setLookup] = useState<LocalityLookup>({ postcode: "", localities: [], loading: false, error: "" });
  const [lookupVersion, setLookupVersion] = useState(0);
  const [entries, setEntries] = useState<Record<string, CheckEntry>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const profileKey = JSON.stringify({ category, ...profile });
  const localities = lookup.postcode === profile.postcode ? lookup.localities : [];
  const readyToCheck = /^\d{4}$/.test(profile.postcode) && Boolean(profile.suburb && profile.state && profile.installationDate)
    && currentRebateSystemOptions(category).some(option => option.value === profile.currentSystem);

  useEffect(() => {
    if (!/^\d{4}$/.test(profile.postcode)) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const postcode = profile.postcode;
    const debounce = window.setTimeout(async () => {
      setLookup({ postcode, localities: [], loading: true, error: "" });
      try {
        const response = await fetch(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`, { cache: "no-store", signal: controller.signal });
        const raw: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(raw, "We could not find that postcode. Check all four digits."));
        const result = readProductRebateLocalities(raw);
        if (controller.signal.aborted) return;
        setLookup({ postcode, localities: result.localities, loading: false, error: "" });
        if (result.localities.length === 1) setProfile(current => current.postcode === postcode ? { ...current, ...result.localities[0] } : current);
      } catch (error) {
        if (!cancelled) setLookup({ postcode, localities: [], loading: false, error: controller.signal.aborted ? "The suburb lookup took too long. Try again." : error instanceof Error ? error.message : "The suburb lookup could not be completed. Try again." });
      } finally {
        window.clearTimeout(timeout);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(debounce); window.clearTimeout(timeout); controller.abort(); };
  }, [profile.postcode, lookupVersion]);

  useEffect(() => {
    const active = controllers.current;
    return () => { for (const controller of active.values()) controller.abort(); };
  }, []);

  function updateProfile(change: Partial<HomeDetails>) {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setProfile(current => ({ ...current, ...change, ...(change.postcode !== undefined ? { suburb: "", state: "" } : {}) }));
  }

  async function checkProduct(product: ProductComparisonItem) {
    const controller = new AbortController();
    controllers.current.get(product.id)?.abort();
    controllers.current.set(product.id, controller);
    setEntries(current => ({ ...current, [product.id]: { profileKey, status: "loading" } }));
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const request = parseProductRebateCheckRequest({ productId: product.id, ...profile });
      const response = await fetch("/api/product-rebates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store", signal: controller.signal });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(raw, "The rebate check could not be completed. Try again."));
      const result = readProductRebateCheckResult(raw);
      if (result.productId !== product.id || result.category !== category || result.location.postcode !== request.postcode || result.location.suburb !== request.suburb || result.location.state !== request.state || result.installationDate !== request.installationDate || result.currentSystem !== request.currentSystem) throw new Error("The rebate response does not match your home details. Try again.");
      if (controller.signal.aborted) return;
      setEntries(current => current[product.id]?.profileKey === profileKey ? { ...current, [product.id]: { profileKey, status: "done", result } } : current);
    } catch (error) {
      if (controllers.current.get(product.id) !== controller) return;
      setEntries(current => current[product.id]?.profileKey === profileKey ? { ...current, [product.id]: { profileKey, status: "error", message: controller.signal.aborted ? "The rebate check took too long. Try again." : error instanceof Error ? error.message : "The rebate check could not be completed. Try again." } } : current);
    } finally {
      window.clearTimeout(timeout);
      if (controllers.current.get(product.id) === controller) controllers.current.delete(product.id);
    }
  }

  function entryFor(productId: string) { return entries[productId]?.profileKey === profileKey ? entries[productId] : undefined; }
  return { category, profile, updateProfile, localities, lookup, retryLocalities: () => setLookupVersion(value => value + 1), readyToCheck, checkProduct, entryFor };
}

type ProductRebateCheck = ReturnType<typeof useProductRebateCheck>;

export function ProductRebateChecker({ check, ready }: { check: ProductRebateCheck; ready: boolean }) {
  const { profile, updateProfile, localities, lookup } = check;
  const hotWater = check.category === "hot-water";
  const loading = lookup.postcode === profile.postcode && lookup.loading;
  const error = lookup.postcode === profile.postcode ? lookup.error : "";
  const postcodeError = profile.postcode && !/^\d{4}$/.test(profile.postcode) ? "Enter all four digits, for example 3000." : error;
  return <section id="rebate-your-home" className="product-rebate-home" aria-labelledby="product-rebate-home-title">
    <header><span>REBATES FOR YOUR HOME</span><h2 id="product-rebate-home-title">What are you replacing?</h2><p>Enter your home details once, then check rebates on any {hotWater ? "heat pump" : "air conditioner"} below.</p></header>
    <div className="product-rebate-inputs">
      <label htmlFor="product-rebate-postcode">Postcode<input id="product-rebate-postcode" type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" autoComplete="postal-code" placeholder="e.g. 3000" value={profile.postcode} disabled={!ready} aria-invalid={Boolean(postcodeError)} aria-describedby="product-rebate-postcode-help" onChange={event => updateProfile({ postcode: event.target.value.trim() })} /><small id="product-rebate-postcode-help" role={postcodeError ? "alert" : undefined}>{postcodeError || "Your location can change the rebates available."}</small></label>
      <label htmlFor="product-rebate-suburb">Suburb and state<select id="product-rebate-suburb" value={profile.suburb ? `${profile.suburb}|${profile.state}` : ""} disabled={!ready || loading || !localities.length} onChange={event => { const locality = localities.find(item => `${item.suburb}|${item.state}` === event.target.value); updateProfile({ suburb: locality?.suburb ?? "", state: locality?.state ?? "" }); }}><option value="">{loading ? "Finding suburbs..." : !localities.length ? "Enter your postcode first" : "Choose your suburb"}</option>{localities.map(item => <option key={`${item.suburb}|${item.state}`} value={`${item.suburb}|${item.state}`}>{item.suburb}, {item.state}</option>)}</select><small>Choose the home&apos;s suburb, including for border towns.</small></label>
      <label htmlFor="product-rebate-system">{hotWater ? "Current hot-water system" : "Current heating system"}<select id="product-rebate-system" value={profile.currentSystem} disabled={!ready} onChange={event => updateProfile({ currentSystem: event.target.value })}><option value="">{hotWater ? "What heats your hot water now?" : "What heats these rooms now?"}</option>{currentRebateSystemOptions(check.category).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{hotWater ? "An electric storage tank uses an electric heating element, not a heat pump." : "Fixed electric heaters must be wired into the home. Portable or plug-in heaters are different."}</small></label>
      <label htmlFor="product-rebate-date">Planned installation date<input id="product-rebate-date" type="date" value={profile.installationDate} disabled={!ready} onChange={event => updateProfile({ installationDate: event.target.value })} /><small>Use an approximate date while planning. The year can change certificate counts.</small></label>
    </div>
    {error && <button type="button" className="product-rebate-lookup-retry" disabled={!ready || loading} onClick={check.retryLocalities}>Try suburb lookup again</button>}
    <p className="product-rebate-home-note">{hotWater ? "Examples are for one water heater at a home and do not include an earlier Victorian upgrade-program claim." : "Examples are for one air-conditioning system at a home. Central electric heating must serve at least 100 square metres; electric underfloor heating must be the main heating. When removing an air conditioner as well as a heater, it must heat the same area and be outside a bedroom."} Your installer must check the home&apos;s claim history, eligibility and discount offered. Neighbouring postcodes can have the same result.</p>
    {check.readyToCheck && <p className="product-rebate-ready" role="status">Ready for {profile.suburb}, {profile.state} {profile.postcode}. Tap &quot;Check rebates&quot; on a product.</p>}
  </section>;
}

export function ProductRebateResult({ product, check, ready }: { product: ProductComparisonItem; check: ProductRebateCheck; ready: boolean }) {
  const entry = check.entryFor(product.id);
  return <section className="product-rebate-result" data-product-rebates={product.id} aria-label={`Rebates for ${product.name}`}>
    <h3>Rebates for your home</h3>
    {!check.readyToCheck ? <a href="#rebate-your-home" className="product-rebate-add-home">Add your home details above ↗</a> : <button type="button" disabled={!ready || entry?.status === "loading"} onClick={() => check.checkProduct(product)} aria-label={`Check rebates for ${product.name}`}>{entry?.status === "loading" ? "Checking official product lists..." : entry?.status === "done" ? "Refresh rebate check" : "Check rebates"}</button>}
    {entry?.status === "loading" && <p role="status">Checking this exact model for your home.</p>}
    {entry?.status === "error" && <p role="alert">{entry.message}</p>}
    {entry?.status === "done" && <div className="product-rebate-programs" aria-live="polite">{entry.result.results.map(result => <section key={result.program} data-rebate-program={result.program} data-rebate-status={result.status}>
      <h4>{result.label}</h4>
      <strong>{result.quantity !== null ? `${result.quantity} ${result.unit}${result.quantity === 1 ? "" : "s"}` : result.maximumAmountAud !== null ? `Potential up to $${result.maximumAmountAud.toLocaleString("en-AU")}` : result.status === "not-applicable" ? "Does not apply" : "Not confirmed"}</strong>
      <p>{result.summary}</p>
      {result.certificateValue && <div className="product-rebate-value">
        {result.certificateValue.grossValueCents !== null && <p><b>{result.certificateValue.status === "stale" ? "Older gross market reference" : "Gross certificate value"}: {money(result.certificateValue.grossValueCents)}</b><br />{result.quantity} certificates at {money(result.certificateValue.unitPriceCents)} each, reported {displayDate(result.certificateValue.tradedOn)}.</p>}
        {result.certificateValue.estimatedValueCents !== null && <p><b>Estimated after fees: {money(result.certificateValue.estimatedValueCents)}</b><br />Subtracts {money(result.certificateValue.registrationFeeCents)} registration fees and {money(result.certificateValue.allowanceCents)} for the assumed 10% compliance and provider allowance.</p>}
        <p>{result.certificateValue.note}</p>
        <a href={result.certificateValue.sourceUrl} target="_blank" rel="noopener noreferrer">Reported certificate prices ↗</a>
        {result.certificateValue.feeSourceUrl && <a href={result.certificateValue.feeSourceUrl} target="_blank" rel="noopener noreferrer">Registration fee source ↗</a>}
        {result.certificateValue.checkedAt && <small>Price source checked {displayDate(result.certificateValue.checkedAt)}. {result.certificateValue.estimateAsOf && `Fee example dated ${displayDate(result.certificateValue.estimateAsOf)}.`}</small>}
      </div>}
      {result.conditions.length > 0 && <ul>{result.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>}
      {result.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}
      {result.sourceCheckedAt && Number.isFinite(Date.parse(result.sourceCheckedAt)) && <small>Product list checked {new Date(result.sourceCheckedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" })}.</small>}
    </section>)}<small>Checked for {entry.result.location.suburb}, {entry.result.location.state} {entry.result.location.postcode}, installing {new Date(`${entry.result.installationDate}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })}.</small></div>}
  </section>;
}

function money(cents: number | null): string { return cents === null ? "not confirmed" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }
function displayDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "date not confirmed";
}
