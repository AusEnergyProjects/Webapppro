"use client";

/* Retailer logos come from arbitrary CDR-hosted URLs, so native img keeps this dynamic. */
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useMemo, useState } from "react";
import { Field } from "./ComparatorChrome";
import { GasUpgradeQuestionnaire } from "./GasUpgradeQuestionnaire";

type GasRate = { label: string; centsPerMj: number };
type GasSeason = { label: string; days: number; supply: number; usage: number; rates: GasRate[] };
type Plan = {
  id: string;
  brand: string;
  name: string;
  type: string;
  annualCost: number;
  supply: number;
  usage: number;
  discounts: number;
  supplyChargeDaily: number;
  rates: GasRate[];
  logo?: string | null;
  seasonal?: boolean;
  seasons?: GasSeason[];
  conditionalDiscounts: string[];
  eligibility: Array<{ information?: string; description?: string }>;
  link: string | null;
};

function fmt$(value: number) { return "$" + Math.round(value).toLocaleString(); }
function fmtD2(value: number) { return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function GasComparator() {
  const [postcode, setPostcode] = useState("");
  const [annualMj, setAnnualMj] = useState("58000");
  const [includeConditional, setIncludeConditional] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showStanding, setShowStanding] = useState(true);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(12);

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setPlans([]); setShown(12);
    if (!/^\d{4}$/.test(postcode)) { setError("Enter a valid 4 digit postcode."); return; }
    if (!(Number(annualMj) > 0)) { setError("Enter your annual gas use in MJ."); return; }
    setLoading(true); setProgress(12); setStatus("Loading current gas offers...");
    try {
      const query = new URLSearchParams({ postcode, annualMj, includeConditional: String(includeConditional) });
      setProgress(35);
      const response = await fetch("/api/gas-plans?" + query);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load gas plans.");
      setProgress(100); setPlans(data.plans || []);
      setStatus(data.plans?.length ? "" : "No priceable gas offers were found for this postcode. Check the postcode or try again shortly.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load gas plans."); setStatus("");
    } finally { setLoading(false); }
  }

  const visiblePlans = useMemo(() => plans
    .filter((plan) => showStanding || plan.type !== "STANDING")
    .filter((plan) => { const query = search.trim().toLowerCase(); return !query || plan.name.toLowerCase().includes(query) || plan.brand.toLowerCase().includes(query); })
    .sort((a, b) => a.annualCost - b.annualCost), [plans, search, showStanding]);
  const best = visiblePlans[0];
  const median = visiblePlans[Math.floor(visiblePlans.length / 2)];
  const displayedPlans = visiblePlans.slice(0, shown);

  return (
    <>
      <form id="gas-comparison-form" className="card" onSubmit={compare}>
        <h2><span className="stepnum">1</span> Your gas use</h2>
        <p className="sub">Use the total MJ from your last four gas bills. Gas plans are priced with their daily supply charges and declining usage blocks.</p>
        <div className="grid c3">
          <Field label="Postcode"><input type="text" value={postcode} inputMode="numeric" maxLength={4} onChange={(event) => setPostcode(event.target.value)} placeholder="e.g. 3000" /></Field>
          <Field label="Gas use (MJ per year)" hint="Find the total MJ on your recent gas bills, then annualise it if the bill covers less than a year."><input type="number" min="1" value={annualMj} inputMode="numeric" onChange={(event) => setAnnualMj(event.target.value)} /></Field>
          <label className="toggle" style={{ alignSelf: "end", marginBottom: 10 }}><input type="checkbox" checked={includeConditional} onChange={(event) => setIncludeConditional(event.target.checked)} /> Assume conditional discounts are met</label>
        </div>
        {loading && <div className="progresswrap"><div className="pbar"><div className="pfill" style={{ width: `${progress}%` }} /></div><div className="pmsg">{status}</div></div>}
        {!loading && status && <p className="note">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>

      <GasUpgradeQuestionnaire annualMj={annualMj} />
      <div className="gas-compare-action"><button className="btn" form="gas-comparison-form" type="submit" disabled={loading}>{loading ? "Comparing gas plans..." : "Compare gas plans"}</button></div>

      {plans.length > 0 && <section className="results" aria-live="polite">
        <div className="rsummary">
          <div className="stat"><div className="v">{plans.length}</div><div className="l">available gas offers at {postcode}</div></div>
          <div className="stat"><div className="v">{best ? fmt$(best.annualCost) : "n/a"}</div><div className="l">best estimated annual cost</div></div>
          <div className="stat"><div className="v">{median ? fmt$(median.annualCost) : "n/a"}</div><div className="l">median offer</div></div>
          {best && median && <div className="stat"><div className="v">{fmt$(median.annualCost - best.annualCost)}</div><div className="l">potential saving vs median</div></div>}
        </div>
        <details className="explain"><summary>What do these rates and terms mean?</summary><div className="body">
          <p><b>Supply charge (c/day):</b> a fixed amount you pay every day to stay connected, even when you use no gas.</p>
          <p><b>Usage rate (c/MJ):</b> the price for each megajoule of gas you use. Most gas plans charge a higher rate for the first block, then a lower rate for remaining usage.</p>
          <p><b>Seasonal rate:</b> some plans publish different usage rates for warmer and cooler months. We spread your annual MJ across the published days in each period.</p>
          <p><b>Conditional discount:</b> a discount that depends on an action such as paying on time or using direct debit. Turn it off above if you do not expect to meet the condition.</p>
          <p>All rates shown include GST. Estimates do not include one off fees, late payment charges or retailer incentives that are not part of the published tariff.</p>
        </div></details>
        <div className="filters"><label className="toggle"><input type="checkbox" checked={showStanding} onChange={(event) => setShowStanding(event.target.checked)} /> Standing offers</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by retailer or plan name" aria-label="Filter by retailer or plan name" /></div>
        <div>{displayedPlans.map((plan, index) => <GasPlanCard key={`${plan.id}-${Math.round(plan.annualCost)}`} plan={plan} index={index} />)}{!visiblePlans.length && <div className="note">No offers match these filters. Turn on standing offers or clear the search field.</div>}</div>
        {visiblePlans.length > shown && <button className="btn ghost showmore" type="button" onClick={() => setShown((current) => current + 12)}>Show more plans</button>}
        <p className="offer-count">Showing {displayedPlans.length} of {visiblePlans.length} available offers</p>
        <div className="note"><b>How these estimates work.</b> Rates come live from each retailer&apos;s published Consumer Data Right tariff data checked against your postcode. The complete eligible set of current gas offers is shown below, including market and standing offers. Annual cost equals daily supply charges plus usage charges, less any selected conditional discounts, based on {Number(annualMj).toLocaleString()} MJ per year. Seasonal blocks are weighted by their published days. Confirm rates, eligibility and conditions with the retailer before switching.</div>
      </section>}
    </>
  );
}

function GasPlanCard({ plan, index }: { plan: Plan; index: number }) {
  const badges = [<span className="badge" key="type">{plan.type === "STANDING" ? "Standing offer" : "Market offer"}</span>, ...(plan.seasonal ? [<span className="badge info" key="seasonal">Seasonal rates</span>] : []), ...plan.conditionalDiscounts.slice(0, 2).map((discount) => <span className="badge info" key={discount}>Conditional: {discount}</span>), ...(plan.eligibility.length ? [<span className="badge warn" key="eligibility">Eligibility conditions</span>] : [])];
  const toggleOpen = (event: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => { if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.currentTarget.closest(".plan")?.classList.toggle("open"); };
  return <article className="plan">
    <div><div className="top"><span className={`rank${index === 0 ? " r1" : ""}`}>#{index + 1}</span>{plan.logo && <span className="logo-box"><img className="logo" src={plan.logo} alt={`${plan.brand} logo`} onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>}<div><h3>{plan.name}</h3><div className="retailer">{plan.brand}</div></div></div><RateLine plan={plan} /><div className="badges">{badges}</div><div className="bd-toggle" role="button" tabIndex={0} onClick={toggleOpen} onKeyDown={toggleOpen}>Show cost breakdown</div></div>
    <div className="price"><div className="annual">{fmt$(plan.annualCost)}<span style={{ fontSize: ".8rem", fontWeight: 400, color: "var(--color-aea-muted)" }}>/yr</span></div><div className="permo">about {fmt$(plan.annualCost / 12)} per month</div>{plan.link ? <a href={plan.link} target="_blank" rel="noreferrer">Go to retailer</a> : <span className="source-missing">Retailer link not published</span>}<div className="offerid">Offer ID: {plan.id.split("@")[0]}</div></div>
    <div className="breakdown">Supply charges {fmtD2(plan.supply)} + usage {fmtD2(plan.usage)}{plan.discounts > 0 ? ` - discounts ${fmtD2(plan.discounts)}` : ""} = {fmtD2(plan.annualCost)} inc GST{plan.seasons?.length ? <><br />{plan.seasons.map((season) => `${season.label}: ${season.days} days, ${fmtD2(season.usage)} usage`).join(" | ")}</> : ""}{plan.eligibility.length ? <><br />Eligibility: {plan.eligibility.map((item) => item.information || item.description).filter(Boolean).join("; ").slice(0, 240)}</> : ""}</div>
  </article>;
}

function RateLine({ plan }: { plan: Plan }) {
  return <div className="rateline"><span className="r"><b>{plan.supplyChargeDaily.toFixed(1)}c</b>/day <span>supply charge</span></span>{plan.rates.slice(0, 5).map((rate) => <span className="r" key={rate.label}><b>{rate.centsPerMj.toFixed(2)}c</b>/MJ <span>{rate.label}</span></span>)}<span className="r"><span>prices inc GST</span></span></div>;
}
