"use client";

/* Retailer logos come from arbitrary CDR-hosted URLs, so native img keeps this dynamic. */
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useMemo, useState } from "react";
import { Field } from "./ComparatorChrome";
import { GasUpgradeQuestionnaire } from "./GasUpgradeQuestionnaire";
import type { GasUsageProfile } from "@/lib/gas-tariff-engine";
import { annualiseGasUsage, type GasUsageInputMode } from "@/lib/gas-usage-input";

type GasRate = { label: string; centsPerMj: number };
type GasSeason = { label: string; days: number; usageMj: number; supply: number; usage: number; rates: GasRate[] };
type Plan = {
  id: string;
  brand: string;
  name: string;
  type: string;
  distributors: string[];
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
  eligibilityConfirmations: string[];
  limitations: string[];
  feeCount: number;
  incentiveCount: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  lastUpdated?: string | null;
  terms?: string;
  variation?: string;
  onExpiryDescription?: string;
  link: string | null;
};

type GasBundle = {
  plans: Plan[];
  fetchedAt?: string;
  source?: {
    candidatePlans?: number;
    detailPlansSucceeded?: number;
    detailPlansRejected?: number;
    detailPlansUnavailable?: number;
    retailersDiscovered?: number;
    listSourcesSucceeded?: number;
    listSourcesFailed?: number;
    plansMissingLastUpdated?: number;
    oldestPlanUpdatedAt?: string | null;
    newestPlanUpdatedAt?: string | null;
    partial?: boolean;
    retailerCoverage?: Array<{ retailer: string; listAvailable: boolean; candidatePlans: number; detailsPassed: number; detailsRejected: number; detailsUnavailable: number }>;
  };
};

function fmt$(value: number) { return "$" + Math.round(value).toLocaleString(); }
function fmtD2(value: number) { return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function GasComparator() {
  const [postcode, setPostcode] = useState("");
  const [supplyType, setSupplyType] = useState<"mains" | "lpg">("mains");
  const [usageMode, setUsageMode] = useState<GasUsageInputMode>("annual");
  const [usageMj, setUsageMj] = useState("58000");
  const [billStart, setBillStart] = useState("");
  const [billEnd, setBillEnd] = useState("");
  const [usageProfile, setUsageProfile] = useState<GasUsageProfile>("heating");
  const [includeConditional, setIncludeConditional] = useState(false);
  const [hasConcession, setHasConcession] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bundle, setBundle] = useState<GasBundle | null>(null);
  const [distributors, setDistributors] = useState<string[]>([]);
  const [distributor, setDistributor] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showStanding, setShowStanding] = useState(true);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(12);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const annualisedUsage = useMemo(() => annualiseGasUsage({
    usageMj: Number(usageMj), mode: usageMode, profile: usageProfile, billStart, billEnd,
  }), [billEnd, billStart, usageMj, usageMode, usageProfile]);
  const effectiveAnnualMj = annualisedUsage.ok ? Math.round(annualisedUsage.annualMj) : 0;

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setPlans([]); setBundle(null); setDistributors([]); setDistributor(""); setShown(12); setSelectedPlanIds([]);
    if (supplyType !== "mains") { setError("This comparison covers reticulated mains gas only. LPG cylinder and bulk supply prices require quotes from LPG suppliers."); return; }
    if (!/^\d{4}$/.test(postcode)) { setError("Enter a valid 4 digit postcode."); return; }
    if (!annualisedUsage.ok) { setError(annualisedUsage.error); return; }
    setLoading(true); setProgress(12); setStatus("Loading current gas offers...");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const query = new URLSearchParams({ postcode, annualMj: String(Math.round(annualisedUsage.annualMj)), usageProfile, includeConditional: String(includeConditional) });
      setProgress(35);
      const response = await fetch("/api/gas-plans?" + query, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load gas plans.");
      const nextPlans: Plan[] = data.plans || [];
      const nextDistributors = [...new Set(nextPlans.flatMap((plan) => plan.distributors || []).filter(Boolean))].sort();
      setProgress(100); setPlans(nextPlans); setBundle(data); setDistributors(nextDistributors);
      if (nextDistributors.length === 1) setDistributor(nextDistributors[0]);
      setStatus(!nextPlans.length ? "No priceable gas offers were found for this postcode. Check the postcode or try again shortly." : nextDistributors.length > 1 ? "Choose the gas distributor or network printed on your bill before viewing ranked offers." : "");
    } catch (caught) {
      setError(controller.signal.aborted ? "The gas comparison took too long. Please try again shortly." : caught instanceof Error ? caught.message : "Could not load gas plans."); setStatus("");
    } finally { window.clearTimeout(timeout); setLoading(false); }
  }

  const visiblePlans = useMemo(() => plans
    .filter((plan) => !distributor || plan.distributors.includes(distributor))
    .filter((plan) => showStanding || plan.type !== "STANDING")
    .filter((plan) => { const query = search.trim().toLowerCase(); return !query || plan.name.toLowerCase().includes(query) || plan.brand.toLowerCase().includes(query); })
    .sort((a, b) => a.annualCost - b.annualCost), [distributor, plans, search, showStanding]);
  const best = visiblePlans[0];
  const median = visiblePlans[Math.floor(visiblePlans.length / 2)];
  const displayedPlans = visiblePlans.slice(0, shown);
  const selectedPlans = plans.filter((plan) => (!distributor || plan.distributors.includes(distributor)) && selectedPlanIds.includes(plan.id)).sort((a, b) => a.annualCost - b.annualCost);
  const needsDistributor = distributors.length > 1 && !distributor;

  function toggleSelectedPlan(planId: string) {
    setSelectedPlanIds((current) => current.includes(planId) ? current.filter((id) => id !== planId) : current.length < 3 ? [...current, planId] : current);
  }

  return (
    <>
      <form id="gas-comparison-form" className="card" onSubmit={compare}>
        <h2><span className="stepnum">1</span> Your gas use</h2>
        <p className="sub">Use a full year of bills where possible. A recent bill can also be converted to an annual estimate using its exact dates and your appliance profile below.</p>
        <fieldset className="gas-choice-group"><legend>Gas supply type</legend><div className="gas-choice-grid">
          <label className={`native-assumption-card${supplyType === "mains" ? " selected" : ""}`}><input type="radio" name="gas-supply-type" checked={supplyType === "mains"} onChange={() => setSupplyType("mains")} /><span><b>Reticulated mains gas</b><small>A gas meter and network supply connected to the property.</small></span></label>
          <label className={`native-assumption-card${supplyType === "lpg" ? " selected" : ""}`}><input type="radio" name="gas-supply-type" checked={supplyType === "lpg"} onChange={() => setSupplyType("lpg")} /><span><b>LPG bottles or bulk tank</b><small>Delivered LPG is not covered by retail gas plan data.</small></span></label>
        </div></fieldset>
        {supplyType === "lpg" ? <div className="note"><b>LPG needs a supplier quote.</b> This tool cannot rank LPG cylinder or bulk tank prices against mains gas offers because the products, delivery fees and units differ.</div> : <>
        <fieldset className="gas-choice-group"><legend>Usage evidence</legend><div className="gas-choice-grid">
          <label className={`native-assumption-card${usageMode === "annual" ? " selected" : ""}`}><input type="radio" name="gas-usage-mode" checked={usageMode === "annual"} onChange={() => setUsageMode("annual")} /><span><b>Full year total</b><small>Most reliable. Add the MJ from bills covering about 12 months.</small></span></label>
          <label className={`native-assumption-card${usageMode === "bill" ? " selected" : ""}`}><input type="radio" name="gas-usage-mode" checked={usageMode === "bill"} onChange={() => setUsageMode("bill")} /><span><b>One recent bill</b><small>We annualise the MJ using the bill dates and seasonal profile.</small></span></label>
        </div></fieldset>
        <div className="grid c2 gas-primary-inputs">
          <Field label="Postcode"><input type="text" value={postcode} inputMode="numeric" maxLength={4} onChange={(event) => setPostcode(event.target.value)} placeholder="e.g. 3000" /></Field>
          <Field label={usageMode === "annual" ? "Gas use (MJ per year)" : "Gas use on this bill (MJ)"} hint={usageMode === "annual" ? "Add the total MJ from bills covering the last 12 months." : "Use the total MJ shown for this billing period."}><input type="number" min="1" value={usageMj} inputMode="numeric" onChange={(event) => setUsageMj(event.target.value)} /></Field>
        </div>
        {usageMode === "bill" && <div className="gas-bill-period"><Field label="Bill period starts" hint="Use the first date covered by the bill."><input type="date" value={billStart} onChange={(event) => setBillStart(event.target.value)} /></Field><Field label="Bill period ends" hint="Use the last date covered by the bill."><input type="date" value={billEnd} onChange={(event) => setBillEnd(event.target.value)} /></Field>{annualisedUsage.ok && <div className="gas-annual-equivalent"><span>Annualised usage</span><b>{Math.round(annualisedUsage.annualMj).toLocaleString()} MJ/year</b><small>Based on {annualisedUsage.billDays} bill days and the {usageProfile === "heating" ? "gas heating" : "steady year-round"} profile.</small></div>}</div>}
        <label className={`native-assumption-card gas-discount-card${includeConditional ? " selected" : ""}`}><input type="checkbox" checked={includeConditional} onChange={(event) => setIncludeConditional(event.target.checked)} /><span><b>Include conditional discounts</b><small>Leave this off unless you expect to meet every published condition, such as paying on time or using direct debit.</small></span></label>
        <label className={`native-assumption-card gas-discount-card${hasConcession ? " selected" : ""}`}><input type="checkbox" checked={hasConcession} onChange={(event) => setHasConcession(event.target.checked)} /><span><b>I receive an energy concession</b><small>Ranked plan costs remain before concessions because eligibility, calculation and transfer rules vary. Confirm your concession with the retailer before switching.</small></span></label>
        {loading && <div className="progresswrap"><div className="pbar"><div className="pfill" style={{ width: `${progress}%` }} /></div><div className="pmsg">{status}</div></div>}
        {!loading && status && <p className="note">{status}</p>}
        {distributors.length > 1 && <div className="native-location-evidence"><Field label="Gas distributor or network" hint="Choose the network name shown on your gas bill, usually near the meter number, supply address or faults contact."><select value={distributor} onChange={(event) => { setDistributor(event.target.value); setShown(12); setSelectedPlanIds([]); setStatus(""); }}><option value="">Choose the network from your bill</option>{distributors.map((name) => <option key={name}>{name}</option>)}</select></Field></div>}
        {error && <p className="error">{error}</p>}
        </>}
      </form>

      {supplyType === "mains" && <GasUpgradeQuestionnaire postcode={postcode} annualMj={annualisedUsage.ok ? String(effectiveAnnualMj) : ""} onUsageProfileChange={setUsageProfile} />}
      {supplyType === "mains" && <><div className="gas-compare-action"><button className="btn" form="gas-comparison-form" type="submit" disabled={loading}>{loading ? "Comparing gas plans..." : "Compare gas plans"}</button></div>{loading && <div className="progresswrap gas-action-progress" aria-hidden="true"><div className="pbar"><div className="pfill" style={{ width: `${progress}%` }} /></div><div className="pmsg">{status}</div></div>}</>}

      {plans.length > 0 && !needsDistributor && <section className="results" aria-live="polite">
        <div className="rsummary">
          <div className="stat"><div className="v">{visiblePlans.length}</div><div className="l">priceable gas offers for {distributor || postcode}</div></div>
          <div className="stat"><div className="v">{best ? fmt$(best.annualCost) : "n/a"}</div><div className="l">best estimated annual cost</div></div>
          <div className="stat"><div className="v">{median ? fmt$(median.annualCost) : "n/a"}</div><div className="l">median offer</div></div>
          {best && median && <div className="stat"><div className="v">{fmt$(median.annualCost - best.annualCost)}</div><div className="l">potential saving vs median</div></div>}
        </div>
        <details className="explain"><summary>What do these rates and terms mean?</summary><div className="body">
          <p><b>Supply charge (c/day):</b> a fixed amount you pay every day to stay connected, even when you use no gas.</p>
          <p><b>Usage rate (c/MJ):</b> the price for each megajoule of gas you use. Most gas plans charge a higher rate for the first block, then a lower rate for remaining usage.</p>
          <p><b>Seasonal rate:</b> some plans publish different rates for warmer and cooler months. We allocate annual MJ using the gas-use pattern selected above, then apply each daily, monthly or annual usage block inside its published period.</p>
          <p><b>Conditional discount:</b> a discount that depends on an action such as paying on time or using direct debit. Turn it off above if you do not expect to meet the condition.</p>
          <p>All displayed rates include GST. Published fees, incentives and conditions that cannot be costed are labelled on the offer instead of being silently treated as zero.</p>
        </div></details>
        <div className="filters"><label className="toggle"><input type="checkbox" checked={showStanding} onChange={(event) => setShowStanding(event.target.checked)} /> Standing offers</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by retailer or plan name" aria-label="Filter by retailer or plan name" /></div>
        {visiblePlans.some((plan) => plan.eligibilityConfirmations.length > 0) && <div className="note"><b>Confirm eligibility before switching.</b> {visiblePlans.filter((plan) => plan.eligibilityConfirmations.length > 0).length} displayed offers have retailer conditions this calculator cannot verify.</div>}
        {hasConcession && <div className="note"><b>Concession not deducted.</b> These offers are ranked before concessions so every plan uses the same comparable cost basis. Ask the retailer to confirm your concession can transfer and what evidence is required.</div>}
        {selectedPlans.length > 0 && <GasPlanComparison plans={selectedPlans} onRemove={toggleSelectedPlan} />}
        <div>{displayedPlans.map((plan, index) => <GasPlanCard key={`${plan.id}-${Math.round(plan.annualCost)}`} plan={plan} index={index} selected={selectedPlanIds.includes(plan.id)} compareFull={selectedPlanIds.length >= 3} onToggleCompare={toggleSelectedPlan} />)}{!visiblePlans.length && <div className="note">No offers match these filters. Turn on standing offers or clear the search field.</div>}</div>
        {visiblePlans.length > shown && <button className="btn ghost showmore" type="button" onClick={() => setShown((current) => current + 12)}>Show more plans</button>}
        <p className="offer-count">Showing {displayedPlans.length} of {visiblePlans.length} available offers</p>
        <div className="note"><b>How these estimates work.</b> Annual cost equals published daily supply charges plus usage charges, less only the conditional discounts selected above, based on {effectiveAnnualMj.toLocaleString()} MJ per year. {usageMode === "bill" ? "The entered bill was annualised from its exact dates before pricing. " : ""}The {usageProfile === "heating" ? "gas heating" : "steady year-round"} profile allocates usage across each seasonal tariff period. Concessions are not deducted. Results include only offers that passed strict calendar coverage and rate validation. Confirm rates, eligibility and conditions with the retailer before switching.</div>
        {bundle && <div className="note"><b>Gas tariff evidence.</b> Retrieved current CDR records {bundle.fetchedAt ? new Date(bundle.fetchedAt).toLocaleString() : "this session"}. {bundle.source?.detailPlansSucceeded || bundle.plans.length} of {bundle.source?.candidatePlans || bundle.plans.length} locally relevant plan details passed strict validation from {bundle.source?.listSourcesSucceeded ?? "the available"} of {bundle.source?.retailersDiscovered ?? "the discovered"} sources. {bundle.source?.oldestPlanUpdatedAt && bundle.source?.newestPlanUpdatedAt ? `Included retailer records were last updated between ${new Date(bundle.source.oldestPlanUpdatedAt).toLocaleDateString()} and ${new Date(bundle.source.newestPlanUpdatedAt).toLocaleDateString()}. ` : ""}{bundle.source?.plansMissingLastUpdated ? `${bundle.source.plansMissingLastUpdated} included records did not publish a usable update time. ` : ""}{bundle.source?.partial ? "Some sources or plan details were unavailable or rejected, so this is not a complete-market result." : "All discovered sources and local candidates completed successfully."}</div>}
        {bundle?.source?.retailerCoverage && <details className="note"><summary>Retailer source coverage</summary><ul>{bundle.source.retailerCoverage.filter((coverage) => !coverage.listAvailable || coverage.candidatePlans > 0).map((coverage) => <li key={coverage.retailer}><b>{coverage.retailer}:</b> {coverage.listAvailable ? `${coverage.detailsPassed} of ${coverage.candidatePlans} local plan details passed` : "plan list unavailable"}{coverage.detailsRejected ? `; ${coverage.detailsRejected} rejected by gas tariff validation` : ""}{coverage.detailsUnavailable ? `; ${coverage.detailsUnavailable} unavailable` : ""}</li>)}</ul></details>}
      </section>}
    </>
  );
}

function GasPlanCard({ plan, index, selected, compareFull, onToggleCompare }: { plan: Plan; index: number; selected: boolean; compareFull: boolean; onToggleCompare: (planId: string) => void }) {
  const badges = [<span className="badge" key="type">{plan.type === "STANDING" ? "Standing offer" : "Market offer"}</span>, ...(plan.seasonal ? [<span className="badge info" key="seasonal">Seasonal rates</span>] : []), ...plan.conditionalDiscounts.slice(0, 2).map((discount) => <span className="badge info" key={discount}>Conditional discount published: {discount}</span>), ...(plan.eligibilityConfirmations.length ? [<span className="badge warn" key="eligibility">Eligibility must be confirmed</span>] : []), ...(plan.feeCount ? [<span className="badge warn" key="fees">Published fees not included</span>] : []), ...(plan.incentiveCount || plan.limitations.some((item) => item !== "published fees not costed") ? [<span className="badge warn" key="limitations">Some benefits or charges not included</span>] : [])];
  const toggleOpen = (event: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => { if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.currentTarget.closest(".plan")?.classList.toggle("open"); };
  return <article className="plan">
    <div><div className="top"><span className={`rank${index === 0 ? " r1" : ""}`}>#{index + 1}</span>{plan.logo && <span className="logo-box"><img className="logo" src={plan.logo} alt={`${plan.brand} logo`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>}<div><h3>{plan.name}</h3><div className="retailer">{plan.brand}</div></div></div><RateLine plan={plan} /><div className="badges">{badges}</div><div className="bd-toggle" role="button" tabIndex={0} onClick={toggleOpen} onKeyDown={toggleOpen}>Show cost breakdown</div></div>
    <div className="price"><div className="annual">{fmt$(plan.annualCost)}<span style={{ fontSize: ".8rem", fontWeight: 400, color: "var(--color-aea-muted)" }}>/yr</span></div><div className="permo">about {fmt$(plan.annualCost / 12)} per month</div>{plan.link ? <a href={plan.link} target="_blank" rel="noreferrer">View retailer plan</a> : <span className="source-missing">Retailer link not published</span>}<button type="button" className={`gas-compare-toggle${selected ? " selected" : ""}`} disabled={!selected && compareFull} onClick={() => onToggleCompare(plan.id)}>{selected ? "Remove from comparison" : compareFull ? "Comparison full (3)" : "Add to comparison"}</button><div className="offerid">Offer ID: {plan.id.split("@")[0]}{plan.lastUpdated ? ` | Retailer record updated ${new Date(plan.lastUpdated).toLocaleDateString()}` : " | Update time not published"}</div></div>
    <div className="breakdown">Supply charges {fmtD2(plan.supply)} + usage {fmtD2(plan.usage)}{plan.discounts > 0 ? ` - discounts ${fmtD2(plan.discounts)}` : ""} = {fmtD2(plan.annualCost)} inc GST{plan.seasons?.length ? <><br />{plan.seasons.map((season) => `${season.label}: ${season.days} days, ${Math.round(season.usageMj).toLocaleString()} MJ, ${fmtD2(season.usage)} usage`).join(" | ")}</> : ""}{plan.eligibilityConfirmations.length ? <><br />Confirm with retailer: {plan.eligibilityConfirmations.join("; ").slice(0, 320)}</> : ""}{plan.limitations.length ? <><br />Not included: {plan.limitations.join("; ")}</> : ""}{plan.terms ? <><br />Published terms: {plan.terms.slice(0, 320)}</> : ""}</div>
  </article>;
}

function GasPlanComparison({ plans, onRemove }: { plans: Plan[]; onRemove: (planId: string) => void }) {
  const cheapest = Math.min(...plans.map((plan) => plan.annualCost));
  return <section className="gas-plan-comparison" aria-labelledby="gas-plan-comparison-title"><div className="gas-plan-comparison-heading"><div><h3 id="gas-plan-comparison-title">Compare selected offers</h3><p>{plans.length} of 3 selected. Costs use the same household and seasonal assumptions.</p></div></div><div className="gas-plan-comparison-grid">{plans.map((plan) => <article key={plan.id} className={plan.annualCost === cheapest ? "best" : ""}><div className="gas-plan-comparison-title"><span>{plan.annualCost === cheapest ? "Lowest selected" : plan.type === "STANDING" ? "Standing offer" : "Market offer"}</span><h4>{plan.name}</h4><p>{plan.brand}</p></div><dl><div><dt>Estimated annual cost</dt><dd>{fmt$(plan.annualCost)}</dd></div><div><dt>Estimated monthly cost</dt><dd>{fmt$(plan.annualCost / 12)}</dd></div><div><dt>Supply charge</dt><dd>{plan.supplyChargeDaily.toFixed(1)}c/day</dd></div><div><dt>Usage rates</dt><dd>{plan.rates.slice(0, 3).map((rate) => `${rate.centsPerMj.toFixed(2)}c/MJ ${rate.label}`).join("; ")}</dd></div><div><dt>Seasonal pricing</dt><dd>{plan.seasonal ? "Yes, seasonal rates applied" : "No seasonal periods published"}</dd></div><div><dt>Conditions to check</dt><dd>{plan.eligibilityConfirmations.length ? plan.eligibilityConfirmations.slice(0, 2).join("; ") : plan.feeCount || plan.incentiveCount ? "Published fees or benefits are not included in the estimate" : "No unresolved published conditions"}</dd></div></dl><div className="gas-plan-comparison-actions">{plan.link && <a href={plan.link} target="_blank" rel="noreferrer">View retailer plan</a>}<button type="button" onClick={() => onRemove(plan.id)}>Remove</button></div></article>)}</div></section>;
}

function RateLine({ plan }: { plan: Plan }) {
  return <div className="rateline"><span className="r"><b>{plan.supplyChargeDaily.toFixed(1)}c</b>/day <span>supply charge</span></span>{plan.rates.slice(0, 5).map((rate, index) => <span className="r" key={`${rate.label}-${index}`}><b>{rate.centsPerMj.toFixed(2)}c</b>/MJ <span>{rate.label}</span></span>)}<span className="r"><span>prices inc GST</span></span></div>;
}
