"use client";

import { useId, useState } from "react";
import type { CouncilBreakdown, CouncilReport } from "@/lib/council-reporting";
import { CouncilEmpty, CouncilIcon, CouncilMetric, CouncilPanel, CouncilPill, councilDate, councilDateTime, councilMonth, councilMoney, councilNumber } from "./CouncilPrimitives";
import styles from "./CouncilWorkspace.module.css";

type ActivityMeasure = "upgrades" | "value" | "emissions";
const activityMeasures: Array<{ key: ActivityMeasure; label: string }> = [{ key: "upgrades", label: "Upgrades" }, { key: "value", label: "Work value" }, { key: "emissions", label: "Emissions avoided" }];
const activityValue = (row: CouncilBreakdown, measure: ActivityMeasure) => measure === "value" ? row.completedValueCents : measure === "emissions" ? row.estimatedTonnesCo2e : row.completedJobs;
const activityLabel = (value: number | null, measure: ActivityMeasure) => value === null ? "Not available" : measure === "value" ? councilMoney(value, true) : measure === "emissions" ? `${councilNumber(value)} t` : `${councilNumber(value)} upgrades`;

export function CouncilSummary({ report }: { report: CouncilReport }) {
  const m = report.metrics;
  return <><CouncilSectorOutcomes report={report} /><div className={`${styles.metrics} ${report.enquiries ? styles.metricsSix : ""}`}>
    <CouncilMetric label="Completed upgrades" value={councilNumber(m.completedJobs)} detail="Completed work recorded in your area" icon="check" accent />
    {report.enquiries && <CouncilMetric label="Community enquiries" value={councilNumber(report.enquiries.total)} detail="All recorded enquiries in your postcodes" icon="users" />}
    <CouncilMetric label="Estimated lifetime emissions avoided" value={m.estimatedTonnesCo2e === null ? "Not available" : `${councilNumber(m.estimatedTonnesCo2e)} t`} detail={m.estimatedTonnesCo2e === null ? "Awaiting supported impact evidence" : "CO₂-e over upgrade lifetimes, not per year"} icon="leaf" />
    <CouncilMetric label="Work delivered locally" value={m.localSharePercent === null ? "Not available" : `${councilNumber(m.localSharePercent)}%`} detail="Delivered by businesses based in your area" icon="business" />
    <CouncilMetric label="Onboarded local trades" value={councilNumber(m.registeredLocalBusinesses)} detail="Approved businesses based in your area" icon="business" />
    <CouncilMetric label="Completed work value" value={councilMoney(m.completedValueCents, true)} detail="Recorded invoiced work, excluding GST" icon="activity" />
  </div></>;
}

export function CouncilSectorOutcomes({ report }: { report: CouncilReport }) {
  const [selectedKey,setSelectedKey]=useState("business");
  const sectors=report.sectors;
  if (!sectors) return null;
  const selected=sectors.rows.find(row=>row.key===selectedKey) ?? sectors.rows[0];
  const unclassified=sectors.rows.find(row=>row.key==='unclassified');
  return <CouncilPanel title="TLink business and residential outcomes" subtitle={report.mode==='demonstration' ? "Fictional TLink outcomes, clearly separated by customer sector" : "Completed upgrades recorded in TLink, clearly separated by customer sector"}>
    <div className={styles.evenColumns}>{sectors.rows.filter(row=>row.key!=='unclassified').map(row=><CouncilMetric key={row.key} label={`${row.label} completed upgrades`} value={councilNumber(row.metrics.completedJobs)} detail="Each completed job counted once" icon={row.key==='business' ? 'business' : 'users'} accent={row.key==='business'} />)}</div>
    <p className={styles.formHint}>Not classified: {councilNumber(unclassified?.metrics.completedJobs ?? null)} completed upgrades. Classification uses the recorded customer type; it does not infer who occupies a property.</p>
    <div className={styles.segmentedControl} aria-label="TLink customer sector">{sectors.rows.map(row=><button type="button" key={row.key} aria-pressed={row.key===selected.key} onClick={()=>setSelectedKey(row.key)}>{row.label}</button>)}</div>
    <div className={styles.metrics}>
      <CouncilMetric label={`${selected.label} work value`} value={councilMoney(selected.metrics.completedValueCents,true)} detail="Issued invoicing, excluding GST" icon="activity" />
      <CouncilMetric label={`${selected.label} lifetime CO₂-e reduction`} value={selected.metrics.estimatedTonnesCo2e===null ? "Not available" : `${councilNumber(selected.metrics.estimatedTonnesCo2e)} t`} detail="Supported VEU deemed lifetime abatement" icon="leaf" />
      <CouncilMetric label="Generation capacity" value={selected.metrics.generationCapacityKw===null ? "Not available" : `${councilNumber(selected.metrics.generationCapacityKw)} kW`} detail={`${councilNumber(selected.metrics.generationInstallations)} ${report.mode==='demonstration' ? 'sample' : 'evidence-backed'} generation installations`} icon="activity" />
      <CouncilMetric label="Usable battery storage" value={selected.metrics.storageCapacityKwh===null ? "Not available" : `${councilNumber(selected.metrics.storageCapacityKwh)} kWh`} detail={`${councilNumber(selected.metrics.storageInstallations)} ${report.mode==='demonstration' ? 'sample' : 'evidence-backed new-system'} battery installations`} icon="activity" />
    </div>
    <p className={styles.formHint}>Actual electricity generated: {selected.metrics.measuredGenerationKwh===null ? "not available. Metered generation is not connected." : `${councilNumber(selected.metrics.measuredGenerationKwh)} kWh.`} Capacity and completed upgrade counts are separate measures.</p>
    {selected.activities.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>{selected.label} TLink activities</caption><thead><tr><th scope="col">{selected.label} activity</th><th scope="col" className={styles.numberCell}>Completed</th><th scope="col" className={styles.numberCell}>Work value, ex GST</th><th scope="col" className={styles.numberCell}>Lifetime t CO₂-e</th></tr></thead><tbody>{selected.activities.map(row=><tr key={row.key}><th scope="row">{row.label}</th><td className={styles.numberCell}>{councilNumber(row.completedJobs)}</td><td className={styles.numberCell}>{councilMoney(row.completedValueCents)}</td><td className={styles.numberCell}>{councilNumber(row.estimatedTonnesCo2e)}</td></tr>)}</tbody></table></div> : <CouncilEmpty title={sectors.suppressed ? "Sector outcomes are privacy protected" : `No recorded ${selected.label.toLowerCase()} activity yet`}>{sectors.suppressed ? "Small sectors and related activity, postcode and time figures stay private." : "Completed upgrades will appear here as this customer sector participates in TLink."}</CouncilEmpty>}
    <p className={styles.formHint}>{sectors.coverageNote}</p>
  </CouncilPanel>;
}

export function CouncilTrend({ report }: { report: CouncilReport }) {
  const [metric, setMetric] = useState<"value" | "jobs">("jobs");
  const [selectedMonth, setSelectedMonth] = useState("");
  const gradientId = useId();
  const values = report.trend.map(row => metric === "value" ? row.completedValueCents : row.completedJobs);
  const max = Math.max(1, ...values.filter(value => value !== null));
  const width = 620, height = 222, left = 59, right = 24, top = 18, bottom = 38;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const x = (index: number) => left + (values.length > 1 ? index / (values.length - 1) : .5) * chartWidth;
  const y = (value: number) => top + chartHeight * (1 - value / max);
  const segments: Array<Array<{ x: number; y: number }>> = [];
  values.forEach((value, index) => { if (value === null) { segments.push([]); return; } if (!segments.length) segments.push([]); segments[segments.length - 1].push({ x: x(index), y: y(value) }); });
  const hasValues = values.some(value => value !== null);
  const selected = report.trend.find(row => row.key === selectedMonth);
  const summaryValue = metric === "value" ? selected ? selected.completedValueCents : report.metrics.completedValueCents : selected ? selected.completedJobs : report.metrics.completedJobs;
  return <CouncilPanel title="Community progress" subtitle="Completed upgrades over time" action={<div className={styles.segmentedControl} aria-label="Chart measure">{[{ key: "jobs", label: "Upgrades" }, { key: "value", label: "Work value" }].map(option => <button type="button" key={option.key} aria-pressed={metric === option.key} onClick={() => setMetric(option.key === "jobs" ? "jobs" : "value")}>{option.label}</button>)}</div>}>
    {hasValues ? <>
      <div className={styles.chartSummary}><strong>{metric === "value" ? councilMoney(summaryValue, true) : councilNumber(summaryValue)}</strong><span>{selected ? councilMonth(selected.key) : report.period.label} · {metric === "value" ? "work value, ex GST" : "completed upgrades"}</span></div>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric === "value" ? "Completed work value" : "Completed upgrades"} by month. Select a month below or open the chart data for exact figures.`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--c-chart)" stopOpacity=".23" /><stop offset="100%" stopColor="var(--c-chart)" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map(fraction => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} stroke="var(--c-line)" strokeDasharray="3 5" /><text x={left - 11} y={y(max * fraction) + 3} textAnchor="end">{metric === "value" ? councilMoney(max * fraction, true) : councilNumber(Math.round(max * fraction))}</text></g>)}
        {segments.filter(segment => segment.length > 1).map((segment, index) => <g key={index}><path d={`M${segment[0].x},${top + chartHeight} ${segment.map(point => `L${point.x},${point.y}`).join(" ")} L${segment[segment.length - 1].x},${top + chartHeight} Z`} fill={`url(#${gradientId})`} /><polyline points={segment.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--c-chart)" strokeWidth="2.8" strokeLinejoin="round" /></g>)}
        {report.trend.map((row, index) => <g key={row.key}>{selected?.key === row.key && <line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} stroke="var(--c-chart)" strokeDasharray="3 4" opacity=".5" />}{values[index] !== null && <circle cx={x(index)} cy={y(values[index])} r={selected?.key === row.key ? 5.5 : 3.5} fill={selected?.key === row.key ? "var(--c-chart)" : "var(--c-surface)"} stroke="var(--c-chart)" strokeWidth="2"><title>{`${councilMonth(row.key)}: ${metric === "value" ? councilMoney(values[index]) : councilNumber(values[index])}`}</title></circle>}{(index === 0 || index === report.trend.length - 1 || report.trend.length <= 6 || index % 3 === 0) && <text x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === report.trend.length - 1 ? "end" : "middle"}>{councilMonth(row.key)}</text>}</g>)}
      </svg>
      <div className={styles.chartInspect}><label>Inspect a month<select value={selected?.key ?? ""} onChange={event => setSelectedMonth(event.target.value)}><option value="">Whole reporting period</option>{report.trend.map(row => <option key={row.key} value={row.key}>{councilMonth(row.key)}</option>)}</select></label><span>Latest {report.trend.length} months shown. Gaps mean unavailable figures.</span></div>
      <details className={styles.chartData}><summary>View the chart figures</summary><div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Monthly community upgrades and completed work value</caption><thead><tr><th scope="col">Period</th><th scope="col" className={styles.numberCell}>Upgrades</th><th scope="col" className={styles.numberCell}>Value, ex GST</th></tr></thead><tbody>{report.trend.map(row => <tr key={row.key}><th scope="row">{councilMonth(row.key)}</th><td className={styles.numberCell}>{councilNumber(row.completedJobs)}</td><td className={styles.numberCell}>{councilMoney(row.completedValueCents)}</td></tr>)}</tbody></table></div></details>
    </> : <CouncilEmpty title={report.dataQuality.suppressed ? "Activity is privacy protected" : "Your progress starts here"}>{report.dataQuality.suppressed ? "Small activity groups are withheld so individual customers cannot be identified." : "Completed, recorded upgrades will build this view as local participation grows."}</CouncilEmpty>}
  </CouncilPanel>;
}

export function CouncilActivities({ report, detailed = false, onExplore }: { report: CouncilReport; detailed?: boolean; onExplore?: () => void }) {
  const [measure, setMeasure] = useState<ActivityMeasure>("upgrades");
  const [selection, setSelection] = useState("");
  const selected = report.activities.find(row => row.key === selection);
  const rows = [...report.activities].sort((first, second) => (activityValue(second, measure) ?? -1) - (activityValue(first, measure) ?? -1));
  const visibleRows = detailed ? rows : rows.slice(0, 5);
  const max = Math.max(1, ...rows.map(row => activityValue(row, measure) ?? 0));
  return <CouncilPanel title={detailed ? "Explore community upgrades" : "What your community is upgrading"} subtitle="Choose a measure, then select an activity to see its contribution" action={detailed ? <CouncilPill>{report.activities.length} activities</CouncilPill> : undefined}>
    {rows.length ? <><div className={styles.segmentedControl} aria-label="Activity measure">{activityMeasures.map(option => <button type="button" key={option.key} aria-pressed={measure === option.key} onClick={() => setMeasure(option.key)}>{option.label}</button>)}</div><div className={styles.barList}>{visibleRows.map(row => { const value = activityValue(row, measure); return <button type="button" className={styles.activityRow} key={row.key} aria-pressed={selection === row.key} onClick={() => setSelection(selection === row.key ? "" : row.key)}><span className={styles.barHeading}><strong>{row.label}</strong><span>{activityLabel(value, measure)}</span></span><span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ width: `${(value ?? 0) / max * 100}%` }} /></span><span className={styles.barMeta}><span>{measure === "value" ? "Recorded value, excluding GST" : measure === "emissions" ? "Estimated over upgrade lifetimes" : councilMoney(row.completedValueCents) + " ex GST"}</span><span>{selection === row.key ? "Close detail" : "View detail"} <CouncilIcon name="arrow" size={12} /></span></span></button>; })}</div>{selected && <CouncilBreakdownDetail row={selected} onClose={() => setSelection("")} />}{measure === "emissions" && <p className={styles.formHint}>Supported Victorian Energy Upgrades estimates only. Not annual measured emissions. Other upgrades may have no supported estimate.</p>}{detailed && <details className={styles.chartData}><summary>Compare all activity figures and certificate evidence</summary><CouncilBreakdownTable rows={rows} heading="Activity" certificates /></details>}</> : <CouncilEmpty title="No reportable activities yet">Activity totals appear once eligible completed work meets the privacy threshold.</CouncilEmpty>}
    {onExplore && <div className={styles.panelFooter}><p>Each upgrade is counted once.</p><button className={styles.textButton} type="button" onClick={onExplore}>All activities <CouncilIcon name="arrow" size={14} /></button></div>}
  </CouncilPanel>;
}

function CouncilBreakdownDetail({ row, localBusinesses, onClose }: { row: CouncilBreakdown; localBusinesses?: number | null; onClose: () => void }) {
  const localShare = row.completedJobs !== null && row.completedJobs > 0 && row.localJobs !== null ? Math.round(row.localJobs / row.completedJobs * 100) : null;
  return <section className={styles.breakdownDetail} aria-label={`${row.label} detail`}><header><div><span>Selected area of activity</span><h3>{row.label}</h3></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label={`Close ${row.label} detail`}><CouncilIcon name="close" size={15} /></button></header><dl><div><dt>Completed upgrades</dt><dd>{councilNumber(row.completedJobs)}</dd></div><div><dt>Work value, excluding GST</dt><dd>{councilMoney(row.completedValueCents)}</dd></div><div><dt>Delivered by local businesses</dt><dd>{localShare === null ? "Not available" : `${localShare}%`}</dd></div><div><dt>Estimated lifetime emissions avoided</dt><dd>{row.estimatedTonnesCo2e === null ? "Not available" : `${councilNumber(row.estimatedTonnesCo2e)} t CO₂-e`}</dd></div>{localBusinesses !== undefined && <div><dt>Registered local trades</dt><dd>{councilNumber(localBusinesses)}</dd></div>}</dl><p>Only recorded, reportable figures are shown. Lifetime emissions estimates are not annual measured savings.</p></section>;
}

export function CouncilLocalShare({ report }: { report: CouncilReport }) {
  const m = report.metrics;
  const total = m.completedJobs ?? 0;
  const local = m.localJobs ?? 0, outside = m.outsideJobs ?? 0;
  const circumference = 2 * Math.PI * 51;
  const categories = [{ label: "Local businesses", count: m.localJobs, color: "var(--c-chart)" }, { label: "Outside the area", count: m.outsideJobs, color: "var(--c-chart-secondary)" }, { label: "Location unrecorded", count: m.unknownLocalityJobs, color: "var(--c-line)" }];
  return <CouncilPanel title="Keeping opportunity local" subtitle="Completed upgrades by the delivering business's location">
    {m.localSharePercent !== null && total > 0 ? <div className={styles.shareLayout}><div className={styles.donut}><svg viewBox="0 0 130 130" role="img" aria-label={`${councilNumber(m.localSharePercent)} percent of completed work delivered by businesses within the council postcode area`}><circle cx="65" cy="65" r="51" fill="none" stroke="var(--c-line)" strokeWidth="12" /><circle cx="65" cy="65" r="51" fill="none" stroke="var(--c-chart-secondary)" strokeWidth="12" strokeDasharray={`${outside / total * circumference} ${circumference}`} strokeDashoffset={-local / total * circumference} /><circle cx="65" cy="65" r="51" fill="none" stroke="var(--c-chart)" strokeWidth="12" strokeDasharray={`${local / total * circumference} ${circumference}`} /></svg><div className={styles.donutLabel}><strong>{councilNumber(m.localSharePercent)}%</strong><small>delivered locally</small></div></div><div className={styles.shareList}>{categories.map(row => <div key={row.label} className={styles.shareRow}><i style={{ backgroundColor: row.color }} /><span>{row.label}</span><strong>{councilNumber(row.count)}</strong></div>)}</div></div> : <CouncilEmpty title="Local delivery will appear here" icon="business">The split is shown when recorded business locations and privacy thresholds allow it.</CouncilEmpty>}
    <div className={styles.insight}><CouncilIcon name="business" size={17} /><p><strong>{councilNumber(m.registeredLocalBusinesses)} registered local trades</strong> with approved business reviews. Locality uses the recorded business address, not its service area. Completed upgrades do not measure jobs created.</p></div>
  </CouncilPanel>;
}

export function CouncilPostcodes({ report }: { report: CouncilReport }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("upgrades");
  const [selection, setSelection] = useState("");
  const rows = report.postcodes.filter(row => `${row.key} ${row.label}`.toLowerCase().includes(query.trim().toLowerCase())).sort((first, second) => sort === "area" ? first.label.localeCompare(second.label, "en-AU") : sort === "value" ? (second.completedValueCents ?? -1) - (first.completedValueCents ?? -1) : (second.completedJobs ?? -1) - (first.completedJobs ?? -1));
  const selected = rows.find(row => row.key === selection);
  return <CouncilPanel title="Explore your neighbourhoods" subtitle="Find a postcode and select it to see local participation" action={<CouncilPill muted>{report.scope.postcodes.length} postcodes</CouncilPill>}>
    {report.postcodes.length ? <><div className={styles.analyticsToolbar}><label className={styles.analyticsSearch}><CouncilIcon name="search" size={16} /><span className={styles.srOnly}>Find a postcode</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Postcode or area" /></label><label><span className={styles.srOnly}>Sort postcodes</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="upgrades">Most upgrades</option><option value="value">Highest work value</option><option value="area">Area name</option></select></label></div>{rows.length ? <CouncilBreakdownTable rows={rows} heading="Postcode" selectedKey={selection} onSelect={row => setSelection(selection === row.key ? "" : row.key)} /> : <CouncilEmpty title="No matching postcode" icon="search">Try another postcode or area name from your reporting area.</CouncilEmpty>}{selected && <CouncilBreakdownDetail row={selected} localBusinesses={selected.registeredLocalBusinesses} onClose={() => setSelection("")} />}</> : <CouncilEmpty title="Postcode activity is not available yet" icon="map">Postcodes with sufficient recorded activity will appear here. Small groups stay private.</CouncilEmpty>}
  </CouncilPanel>;
}

export function CouncilBreakdownTable({ rows, heading, certificates = false, selectedKey, onSelect }: { rows: CouncilBreakdown[]; heading: string; certificates?: boolean; selectedKey?: string; onSelect?: (row: CouncilBreakdown) => void }) {
  return <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>{heading} breakdown of completed upgrades, work value, local delivery and estimated lifetime emissions avoided</caption><thead><tr><th scope="col">{heading}</th><th scope="col" className={styles.numberCell}>Upgrades</th><th scope="col" className={styles.numberCell}>Work value<small>excluding GST</small></th><th scope="col" className={styles.numberCell}>Local delivery</th>{certificates && <><th scope="col" className={styles.numberCell}>Accepted VEECs</th><th scope="col" className={styles.numberCell}>Accepted STCs</th></>}<th scope="col" className={styles.numberCell}>Emissions avoided<small>estimated lifetime t CO₂-e</small></th></tr></thead><tbody>{rows.map(row => {
    const share = row.completedJobs && row.localJobs !== null ? row.localJobs / row.completedJobs * 100 : null;
    return <tr key={row.key} data-selected={selectedKey === row.key || undefined}><th scope="row">{onSelect ? <button type="button" className={styles.tableSelect} aria-pressed={selectedKey === row.key} onClick={() => onSelect(row)}>{row.label}<CouncilIcon name="arrow" size={13} /></button> : <strong>{row.label}</strong>}</th><td className={styles.numberCell}>{councilNumber(row.completedJobs)}</td><td className={styles.numberCell}>{councilMoney(row.completedValueCents)}</td><td className={styles.numberCell}>{share === null ? "Not available" : `${Math.round(share)}%`}{share !== null && <span className={styles.cellBar} aria-hidden="true"><i style={{ width: `${share}%` }} /></span>}</td>{certificates && <><td className={styles.numberCell}>{councilNumber(row.veecQuantity)}</td><td className={styles.numberCell}>{councilNumber(row.stcQuantity)}</td></>}<td className={styles.numberCell}>{councilNumber(row.estimatedTonnesCo2e)}</td></tr>;
  })}</tbody></table></div>;
}

export function CouncilEnquiries({ report }: { report: CouncilReport }) {
  const enquiries = report.enquiries;
  const [selectedPostcode, setSelectedPostcode] = useState("");
  if (!enquiries) return null;
  const selected = enquiries.postcodes.find(row => row.postcode === selectedPostcode);
  const max = Math.max(1, ...enquiries.trend.map(row => row.count ?? 0));
  return <CouncilPanel title="Your community is taking the next step" subtitle="All recorded enquiries in your reporting postcodes" action={<CouncilPill muted>Community interest</CouncilPill>}>
    {enquiries.sectors && <div className={styles.metrics}>{enquiries.sectors.rows.map(row=><CouncilMetric key={row.key} label={`${row.label} enquiries`} value={councilNumber(row.count)} detail={enquiries.sectors!.suppressed ? "Small customer groups withheld" : "Customer-selected sector"} icon={row.key==='business' ? 'business' : 'users'} accent={row.key==='business'} />)}</div>}
    <div className={styles.enquiryHeadline}><strong>{councilNumber(selected ? selected.count : enquiries.total)}</strong><div><span>{selected ? `enquiries in ${selected.postcode}` : "community enquiries"}</span><small>{report.period.label}</small></div><label><span className={styles.srOnly}>Enquiry postcode</span><select value={selected?.postcode ?? ""} onChange={event => setSelectedPostcode(event.target.value)}><option value="">All postcodes</option>{enquiries.postcodes.map(row => <option key={row.postcode} value={row.postcode}>{row.postcode}</option>)}</select></label></div>
    {enquiries.trend.some(row => row.count !== null) ? <><div className={styles.enquiryTrend} aria-label="Monthly enquiries across all reporting postcodes">{enquiries.trend.map(row => <div key={row.month}><span>{councilNumber(row.count)}</span><div><i style={{ height: row.count === null ? 0 : `${row.count / max * 100}%` }} /></div><small>{councilMonth(row.month)}</small></div>)}</div><p className={styles.formHint}>Monthly trend shows the whole reporting area. Selecting a postcode changes the enquiry total above.</p></> : <CouncilEmpty title={enquiries.suppressed ? "Enquiries are privacy protected" : "Interest will appear here"} icon="users">{enquiries.suppressed ? "Small customer groups are withheld. Unavailable figures are never shown as zero." : "Recorded enquiries in your postcodes will appear as people take the next step."}</CouncilEmpty>}
    <div className={styles.insight}><CouncilIcon name="campaign" size={17} /><p><strong>{councilNumber(report.metrics.attributedEnquiries)} enquiries carry a council campaign reference.</strong> All-area enquiries also include other sources. Interest is not the same as completed work or a unique household.</p></div>
  </CouncilPanel>;
}

export function CouncilAttribution({ report, onExplore }: { report: CouncilReport; onExplore?: () => void }) {
  const m = report.metrics;
  return <CouncilPanel title="Your promotion. Visible outcomes." subtitle="Follow enquiries carrying your council campaign reference" action={onExplore ? <button className={styles.textButton} type="button" onClick={onExplore}>Campaigns <CouncilIcon name="arrow" size={14} /></button> : undefined}>
    <div className={styles.attributionFlow}><div><span>Council campaigns</span><strong>{report.campaigns.length}</strong><small>With recorded attribution</small></div><CouncilIcon name="arrow" size={18} /><div><span>Referred enquiries</span><strong>{councilNumber(m.attributedEnquiries)}</strong><small>Tagged to your promotion</small></div><CouncilIcon name="arrow" size={18} /><div><span>Completed upgrades</span><strong>{councilNumber(m.attributedCompletedJobs)}</strong><small>Linked to a council referral</small></div></div>
    {report.campaigns.length > 0 && <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Council campaign enquiry and upgrade outcomes</caption><thead><tr><th scope="col">Campaign</th><th scope="col" className={styles.numberCell}>Enquiries</th><th scope="col" className={styles.numberCell}>Completed</th><th scope="col" className={styles.numberCell}>Work value, ex GST</th></tr></thead><tbody>{report.campaigns.map(row => <tr key={row.id}><th scope="row"><strong>{row.name}</strong><small>{row.referenceCode}</small></th><td className={styles.numberCell}>{councilNumber(row.enquiries)}</td><td className={styles.numberCell}>{councilNumber(row.completedJobs)}</td><td className={styles.numberCell}>{councilMoney(row.completedValueCents)}</td></tr>)}</tbody></table></div>}
    <div className={styles.insight}><CouncilIcon name="shield" size={16} /><p>A campaign reference shows where an enquiry came from. It does not establish that an upgrade would not have happened without the campaign. Enquiries and completions use their respective reporting dates, so these figures are not a conversion rate.</p></div>
  </CouncilPanel>;
}

export function CouncilReports({ report, onExport, onAskWattzun }: { report: CouncilReport; onExport: () => void; onAskWattzun?: () => void }) {
  return <>
    <div className={styles.evenColumns}>
      <CouncilPanel title="Your community impact report" subtitle="Ready for a briefing, meeting or further analysis"><p className={`${styles.formHint} ${styles.printHidden}`}>Download the protected report figures as CSV, or print this report and choose Save as PDF. The report below includes your period, outcomes, postcode and activity breakdowns, and calculation basis.</p><div className={styles.reportPeriod}><span>{report.scope.name}</span><strong>{report.period.label}</strong><small>{report.period.key === "all" ? "All recorded history" : councilDate(report.period.start)} to {councilDate(report.period.end)}</small></div><div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={onExport}><CouncilIcon name="download" size={16} />Download report CSV</button><button type="button" className={styles.secondaryButton} onClick={() => window.print()}><CouncilIcon name="report" size={16} />Print / save PDF</button>{onAskWattzun && <button type="button" className={`${styles.secondaryButton} ${styles.printHidden}`} onClick={onAskWattzun}>Ask Wattzun about this report</button>}</div></CouncilPanel>
      <CouncilPanel title="What these figures cover" subtitle="A clear basis for sharing your results"><dl className={styles.definitionList}><div><dt>Recorded community activity</dt><dd>{report.dataQuality.coverageNote}</dd></div><div><dt>Customer privacy</dt><dd>Groups of fewer than {report.dataQuality.minimumCohort} customers are withheld, along with related figures where needed. Private customer details never appear in council reports.</dd></div><div><dt>Estimated emissions avoided</dt><dd>{report.dataQuality.missingCarbonMethod ? "An estimate is unavailable where supported, provider-accepted evidence is missing or withheld." : "These are estimated savings over the lifetime of supported Victorian Energy Upgrades activities. They are not annual measured emissions. Solar certificate quantities (STCs) are excluded; accepted certificate quantities do not prove registry issuance."}</dd></div></dl></CouncilPanel>
    </div>
    <CouncilSummary report={report} />
    <div className={styles.reportBreakdowns}><CouncilPanel title="Community upgrades" subtitle="Each completed upgrade appears under its primary activity"><CouncilBreakdownTable rows={report.activities} heading="Activity" /></CouncilPanel><CouncilPanel title="Postcode outcomes" subtitle="Reporting postcodes can cross municipal boundaries"><CouncilBreakdownTable rows={report.postcodes} heading="Postcode" /></CouncilPanel></div>
    <CouncilPanel title="How your report is calculated" subtitle={`Generated ${councilDateTime(report.generatedAt, report.period.timeZone)}`}><ol className={styles.methodology}>{report.methodology.map(item => <li key={item}>{item}</li>)}</ol></CouncilPanel>
  </>;
}
