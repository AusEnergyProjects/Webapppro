import type { CouncilReport } from "@/lib/council-reporting";
import { CER_COMMUNITY_URL, COMMUNITY_METRICS, type CouncilCommunityReport } from "@/lib/council-community";
import type { CouncilVeuActivity, CouncilVeuReport } from "@/lib/council-veu";
import { COUNCIL_DEMOGRAPHICS_SOURCE, COUNCIL_DEMOGRAPHIC_METRICS, councilDemographicValue, councilDemographicComparison, type CouncilDemographicsStatus } from "@/lib/council-demographics";
import { councilDate, councilMonth, councilMoney, councilNumber } from "./CouncilPrimitives";
import styles from "./CouncilPostcodeDetails.module.css";

export type CouncilPostcodeDetailsSources = {
  veu: { report: CouncilVeuReport | null; loading: boolean; error: string };
  community: { report: CouncilCommunityReport | null; loading: boolean; error: string };
};

function sameScope(source: CouncilVeuReport | CouncilCommunityReport | null | undefined, report: CouncilReport, postcode: string) {
  return source && source.scope.state === report.scope.state && source.scope.postcodes.includes(postcode)
    && (source.scope.councilId === report.scope.councilId || (report.mode === "demonstration" && source.scope.councilId === "public-demo"));
}

function ActivityRows({ rows }: { rows: CouncilVeuActivity[] }) {
  return <ul className={styles.activities}>{rows.map(row => <li key={row.activity}>
    <span>{row.activity}</span><strong>{councilNumber(row.activities)}<small>activities</small></strong>
    <small>{councilNumber(row.estimatedLifetimeTonnesCo2e)} lifetime t CO₂-e</small>
  </li>)}</ul>;
}

export function CouncilPostcodeDetails({ postcode, report, sources, demographics }: {
  postcode: string; report: CouncilReport; sources?: CouncilPostcodeDetailsSources; demographics?: CouncilDemographicsStatus;
}) {
  if (!report.scope.postcodes.includes(postcode)) return null;
  const veu = sameScope(sources?.veu.report, report, postcode) ? sources?.veu.report : null;
  const community = sameScope(sources?.community.report, report, postcode) ? sources?.community.report : null;
  const upgrades = veu?.postcodes.find(row => row.postcode === postcode);
  const installations = community?.postcodes.find(row => row.postcode === postcode);
  const work = report.postcodes.find(row => row.key === postcode);
  const cell = report.map.cells.find(row => row.postcode === postcode);
  const enquiry = report.enquiries?.postcodes.find(row => row.postcode === postcode);
  const activities = upgrades?.activityBreakdown === null || upgrades?.activityBreakdown === undefined ? null
    : [...upgrades.activityBreakdown].sort((a, b) => (b.activities ?? 0) - (a.activities ?? 0) || a.activity.localeCompare(b.activity));
  const protectedWork = report.dataQuality.suppressed || report.dataQuality.suppressedBreakdowns.includes("postcodes");
  const protectedImpact = protectedWork || report.dataQuality.suppressedBreakdowns.includes("certificate evidence");
  const workValue = (value: number | null | undefined, protectedValue = protectedWork) => value === null || value === undefined
    ? protectedValue ? "Protected" : "Not available" : councilNumber(value);
  const demographic = demographics?.data?.rows.find(row => row.code === postcode);
  const benchmark = demographics?.data?.states.find(row => row.code === report.scope.state);
  return <div className={styles.details} aria-label={`Postcode ${postcode} data breakdown`}>
    <section className={styles.source} aria-labelledby={`postcode-${postcode}-demographics`}>
      <h3 id={`postcode-${postcode}-demographics`}>Community demographics</h3>
      <p className={styles.period}>Census 2021 · 10 August 2021 · Whole ABS Postal Area {postcode}</p>
      {demographic ? <>
        <dl className={styles.metrics}>
          <div><dt>Population</dt><dd>{councilDemographicValue(demographic.population)}</dd></div>
          <div><dt>Occupied private dwellings</dt><dd>{councilDemographicValue(demographic.occupiedPrivateDwellings)}</dd></div>
        </dl>
        <table className={styles.demographicTable}><caption>Postcode and {report.scope.state} comparison · Census 2021</caption><thead><tr><th scope="col">Measure</th><th scope="col">{postcode}</th><th scope="col">{report.scope.state}</th></tr></thead><tbody>{COUNCIL_DEMOGRAPHIC_METRICS.filter(metric=>metric.key!=="population").map(metric=>{
          const stateValue=benchmark?.[metric.key]??null;
          const comparison=councilDemographicComparison(demographic[metric.key],stateValue,metric.format);
          return <tr key={metric.key}><th scope="row">{metric.label}{comparison&&<small>{comparison}</small>}</th><td>{councilDemographicValue(demographic[metric.key],metric.format)}</td><td>{councilDemographicValue(stateValue,metric.format)}</td></tr>;
        })}</tbody></table>
        <p className={styles.note}>Average household size: {councilDemographicValue(demographic.averageHouseholdSize)}{demographic.averageHouseholdSize!==null?" people":""}. Housing percentages use occupied private dwellings, excluding visitor-only and other non-classifiable households. Owner occupation includes outright ownership and mortgages.</p>
        <details className={styles.impact}><summary>Use this in upgrade planning</summary><ul className={styles.planning}>
          <li>Compare rental share when planning information for tenants, landlords and property managers.</li>
          <li>Consider household income and age when planning accessible events and explaining upfront costs.</li>
          <li>Compare houses and apartments when preparing information about shared roofs and owners corporation approvals.</li>
        </ul><p className={styles.note}>Compare with the upgrade data below as area-level context. These figures do not show individual eligibility, intent or the cause of uptake. Different reporting dates and repeat activities prevent treating upgrades per dwelling as household adoption.</p></details>
      </> : <p className={styles.note} role={demographics?.loading?"status":undefined}>{demographics?.loading?"Loading Census demographics...":demographics?.error?"Census demographics are temporarily unavailable.":"No ABS 2021 demographic profile is available for this postcode. Missing data is not zero."}</p>}
      <p className={styles.sourceDate}><a href={`https://www.abs.gov.au/census/find-census-data/quickstats/2021/POA${postcode}`} target="_blank" rel="noreferrer">ABS 2021 Census profile for {postcode}</a><a href={COUNCIL_DEMOGRAPHICS_SOURCE.url} target="_blank" rel="noreferrer">Census DataPacks and source tables</a></p>
      <p className={styles.note}>Historical Census figures, not current population estimates. Postal Areas approximate postcodes and may cross council or state boundaries. They do not describe only the council portion. ABS makes small random adjustments for privacy, so totals can differ.</p>
      <p className={styles.note}>{COUNCIL_DEMOGRAPHICS_SOURCE.attribution} <a href={COUNCIL_DEMOGRAPHICS_SOURCE.licence} target="_blank" rel="noreferrer">CC BY 4.0</a>.</p>
    </section>
    <section className={styles.source} aria-labelledby={`postcode-${postcode}-veu`}>
      <h3 id={`postcode-${postcode}-veu`}>Victorian Energy Upgrades</h3>
      {veu && upgrades ? <>
        <p className={styles.period}>{veu.period.label}{veu.period.startDate && veu.period.endDate ? ` · ${councilDate(veu.period.startDate)} to ${councilDate(veu.period.endDate)}` : ""}</p>
        <dl className={styles.metrics}>
          <div><dt>Approved activities</dt><dd>{councilNumber(upgrades.activities)}</dd></div>
          <div><dt>Estimated lifetime emissions avoided</dt><dd>{councilNumber(upgrades.estimatedLifetimeTonnesCo2e)}{upgrades.estimatedLifetimeTonnesCo2e !== null && <small>tonnes CO₂-e</small>}</dd></div>
        </dl>
        {activities && activities.length > 0 ? <div className={styles.breakdown}>
          <h4>Upgrade types in {postcode}</h4><ActivityRows rows={activities.slice(0, 5)} />
          {activities.length > 5 && <details key={postcode}><summary>Show {activities.length - 5} more upgrade types</summary><ActivityRows rows={activities.slice(5)} /></details>}
        </div> : <p className={styles.note}>{activities ? "No approved activities recorded in this period." : "An activity breakdown is not available for this postcode."}</p>}
        <p className={styles.note}>Lifetime estimates under the scheme, not measured annual savings. Activities are not a count of unique homes.</p>
        <p className={styles.sourceDate}><a href={veu.source.url} target="_blank" rel="noreferrer">Official VEU public register</a><span>Source refreshed {councilDate(veu.source.refreshedAt)}</span></p>
        {(veu.source.stale || veu.source.refreshFailed) && <p className={styles.notice}>Showing the last verified snapshot. {veu.source.refreshFailed ? "The latest source check was unsuccessful." : "A newer publication may be available."}</p>}
      </> : <p className={styles.note} role={sources?.veu.loading ? "status" : undefined}>{sources?.veu.loading ? "Loading VEU postcode data..." : "VEU data is not available for this postcode."}</p>}
    </section>
    <section className={styles.source} aria-labelledby={`postcode-${postcode}-cer`}>
      <h3 id={`postcode-${postcode}-cer`}>Energy installations</h3>
      {community && installations ? <>
        <p className={styles.period}>{community.period.label} · {councilMonth(community.period.startMonth)} to {councilMonth(community.period.endMonth)}</p>
        <dl className={styles.installations}>{COMMUNITY_METRICS.map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd>{councilNumber(installations.values[metric.id])}{installations.values[metric.id] !== null && metric.unit !== "systems" ? ` ${metric.unit}` : ""}</dd></div>)}</dl>
        <p className={styles.sourceDate}><a href={CER_COMMUNITY_URL} target="_blank" rel="noreferrer">Clean Energy Regulator</a><span>Data through {councilDate(community.sourceAsOf)}</span></p>
        {(community.stale || community.refreshFailed) && <p className={styles.notice}>Showing the last verified publication. {community.refreshFailed ? "The latest source check was unsuccessful." : "A newer publication may be available."}</p>}
      </> : <p className={styles.note} role={sources?.community.loading ? "status" : undefined}>{sources?.community.loading ? "Loading published installation data..." : "Published installation data is not available for this postcode."}</p>}
    </section>
    <section className={styles.source} aria-labelledby={`postcode-${postcode}-tlink`}>
      <h3 id={`postcode-${postcode}-tlink`}>Recorded in TLink{report.mode === "demonstration" ? " · Demo" : ""}</h3>
      <p className={styles.period}>{report.period.label}{report.period.key !== "all" ? ` · ${councilDate(report.period.start, report.period.timeZone)} to ${councilDate(report.period.end, report.period.timeZone)}` : ""} · Report generated {councilDate(report.generatedAt, report.period.timeZone)}</p>
      <dl className={styles.installations}>
        <div><dt>Completed jobs</dt><dd>{workValue(work ? work.completedJobs : cell?.completedJobs)}</dd></div>
        <div><dt>Registered local businesses</dt><dd>{workValue(work ? work.registeredLocalBusinesses : cell?.registeredLocalBusinesses, false)}</dd></div>
        <div><dt>Work value, excluding GST</dt><dd>{work?.completedValueCents === null || work?.completedValueCents === undefined ? workValue(work?.completedValueCents) : councilMoney(work.completedValueCents)}</dd></div>
        <div><dt>Jobs delivered by local businesses</dt><dd>{workValue(work?.localJobs)}</dd></div>
        <div><dt>Community enquiries</dt><dd>{workValue(enquiry?.count, report.enquiries?.suppressed ?? false)}</dd></div>
      </dl>
      <p className={styles.note}>Community enquiries include all recorded sources in this postcode. They are not all council-attributed and do not count completed work or unique households.</p>
      <details className={styles.impact}><summary>Recorded certificate evidence</summary><dl className={styles.installations}>
        <div><dt>Accepted VEEC quantity</dt><dd>{workValue(work?.veecQuantity, protectedImpact)}</dd></div>
        <div><dt>Accepted STC quantity</dt><dd>{workValue(work?.stcQuantity, protectedImpact)}</dd></div>
        <div><dt>Estimated lifetime tonnes CO₂-e</dt><dd>{workValue(work?.estimatedTonnesCo2e, protectedImpact)}</dd></div>
      </dl><p className={styles.note}>Provider acceptance is not proof of certificate issuance. STCs are not tonnes of carbon.</p></details>
      <p className={styles.note}>Small customer cohorts are protected. Missing figures are not treated as zero.</p>
    </section>
    <p className={styles.basis}>Sources can cover the same upgrades and different dates. Do not add these totals together. Public activity includes work outside TLink and does not establish council attribution.</p>
  </div>;
}
