"use client";

import { useState } from "react";
import { COMMUNITY_METRICS, type CommunityMetricId, type CommunityPeriodKey, type CouncilCommunityReport } from "@/lib/council-community";
import { CouncilIcon, CouncilMetric, CouncilPanel, councilDate, councilMonth, councilNumber } from "./CouncilPrimitives";
import styles from "./CouncilCommunity.module.css";
import workspace from "./CouncilWorkspace.module.css";

export type CouncilCommunityState = { report: CouncilCommunityReport | null; loading: boolean; error: string };

export function CouncilCommunity({ state, period, onPeriodChange, onRefresh, compact = false }: {
  state: CouncilCommunityState; period: CommunityPeriodKey; onPeriodChange: (period: CommunityPeriodKey) => void; onRefresh: () => void; compact?: boolean;
}) {
  const [metric, setMetric] = useState<CommunityMetricId>("solarInstallations");
  const [selectedPostcode, setSelectedPostcode] = useState("");
  const { report, loading, error } = state;
  const selected = COMMUNITY_METRICS.find(item => item.id === metric)!;
  const rows = report?.postcodes ?? [];
  const maximum = Math.max(1, ...rows.map(row => row.values[metric] ?? 0));
  const trendMaximum = Math.max(1, ...(report?.trend.map(row => row.values[metric] ?? 0) ?? []));
  return <section className={styles.community} aria-label="Community energy installations">
    <header className={styles.heading}><div><span className={styles.eyebrow}>Official community data</span><h2>See the change across your area.</h2><p>Solar, storage and hot-water installations recorded across your council&apos;s postcodes.</p></div><div className={styles.controls}><label>Published installation period<select aria-label="Published installation period" value={period} onChange={event => { const value = event.target.value; if (value === "quarter" || value === "year" || value === "all") onPeriodChange(value); }}><option value="quarter">Latest 3 published months</option><option value="year">Latest 12 published months</option><option value="all">All published history</option></select></label><button className={workspace.iconButton} type="button" onClick={onRefresh} disabled={loading} aria-label="Check community data"><CouncilIcon name="refresh" size={18} /></button></div></header>
    {loading && <p className={workspace.notice} role="status">Loading official postcode data...</p>}
    {error && <p className={workspace.error} role="alert">{error} <button type="button" className={workspace.textButton} onClick={onRefresh}>Try again</button></p>}
    {report && <>
      <div className={styles.sourceLine}><span className={styles.sourceBadge}>Clean Energy Regulator</span><span>Data through {councilDate(report.sourceAsOf)}</span><span>{report.period.label}</span><span>{report.dataOrigin === "baseline" ? "Saved official snapshot" : "Official source checked"} {councilDate(report.checkedAt)}</span></div>
      {(report.refreshFailed || report.stale) && <p className={workspace.notice}>Showing the last verified publication. {report.refreshFailed ? "The source could not be refreshed on this check." : "A newer publication may be available."} The figures below retain their original source date.</p>}
      <div className={styles.metrics}>
        <CouncilMetric label="Solar systems installed" value={councilNumber(report.totals.solarInstallations)} detail={`${councilNumber(report.totals.solarCapacityKw === null ? null : report.totals.solarCapacityKw / 1000)} MW of solar capacity`} icon="sun" accent />
        <CouncilMetric label="Batteries installed" value={councilNumber(report.totals.batteryInstallations)} detail={`${councilNumber(report.totals.batteryCapacityKwh === null ? null : report.totals.batteryCapacityKwh / 1000)} MWh of usable storage`} icon="activity" />
        <CouncilMetric label="Heat pump water heaters" value={councilNumber(report.totals.heatPumpInstallations)} detail="Recorded eligible installations" icon="leaf" />
        <CouncilMetric label="Solar water heaters" value={councilNumber(report.totals.solarHotWaterInstallations)} detail="Recorded eligible installations" icon="community" />
      </div>
      <p className={styles.basis}>Community-wide installations, including work outside TLink. Installer details are not available from this source. These figures are not added to TLink outcomes or presented as council-attributed work.</p>
      {!compact && <>
        <div className={styles.tabs} aria-label="Installation measure">{COMMUNITY_METRICS.map(item => <button type="button" key={item.id} aria-pressed={metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}</div>
        <div className={styles.columns}>
          <CouncilPanel title="Where change is happening" subtitle={`${selected.label} by postcode`}>
            <div className={styles.bars}>{[...rows].sort((a,b) => (b.values[metric] ?? -1) - (a.values[metric] ?? -1)).map(row => <button type="button" className={styles.barRow} key={row.postcode} aria-pressed={selectedPostcode === row.postcode} onClick={() => setSelectedPostcode(row.postcode)}><span>{row.postcode}</span><span className={styles.barTrack}><span style={{width: `${(row.values[metric] ?? 0) / maximum * 100}%`}} /></span><strong>{councilNumber(row.values[metric])}</strong></button>)}</div>
            <p className={styles.basis}>{selectedPostcode && rows.some(row => row.postcode === selectedPostcode) ? `${selectedPostcode}: ${councilNumber(rows.find(row => row.postcode === selectedPostcode)!.values[metric])} ${selected.unit}. ` : "Select a postcode to inspect its result. "}Postcodes can cross council boundaries.</p>
          </CouncilPanel>
          <CouncilPanel title="Installation momentum" subtitle={`${selected.label} · latest ${report.trend.length} published months`}>
            <div className={styles.trend}>{report.trend.map(point => <div key={point.month}><strong>{councilNumber(point.values[metric])}</strong><span className={styles.trendTrack}><span style={{height: `${(point.values[metric] ?? 0) / trendMaximum * 100}%`}} /></span><small>{councilMonth(point.month)}</small></div>)}</div>
            <p className={styles.basis}>Recent months can increase as eligible installations are registered. This is a published monthly series, not a live installation count.</p>
          </CouncilPanel>
        </div>
        <CouncilPanel title="Source and coverage" subtitle="A reporting basis your team can inspect" action={<button type="button" className={workspace.secondaryButton} onClick={() => downloadCommunityReport(report)}><CouncilIcon name="download" size={16} />Export official data</button>}>
          <div className={styles.coverage}>{COMMUNITY_METRICS.map(item => <span key={item.id}><strong>{item.label}</strong>{report.coverage[item.id].availablePostcodes} / {report.coverage[item.id].requestedPostcodes} postcodes covered</span>)}</div>
          <details className={styles.details}><summary>Read definitions and source files</summary><ul>{report.notes.map(note => <li key={note}>{note}</li>)}</ul><p>Certificate quantities are not included in this installation dataset. Solar Victoria rebates are a separate program; its published local-government totals cannot establish postcode rebate counts.</p><a href="https://www.solar.vic.gov.au/solar-homes-program-reporting" target="_blank" rel="noreferrer">Solar Victoria program data <CouncilIcon name="external" size={14} /></a><ul>{report.provenance.map(source => <li key={source.metric}><a href={source.url} target="_blank" rel="noreferrer">{COMMUNITY_METRICS.find(item => item.id === source.metric)?.label} source file</a></li>)}</ul></details>
        </CouncilPanel>
      </>}
    </>}
  </section>;
}

export function downloadCommunityReport(report: CouncilCommunityReport) {
  const cell = (value: unknown) => `"${String(value ?? "Not available").replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
  const rows: unknown[][] = [
    ["TLink Council | Official community installations"], ["Council",report.scope.name], ["Source","Clean Energy Regulator"], ["Published through",report.sourceAsOf], ["Period",report.period.label], ["Source checked",report.checkedAt], ["Coverage","Community-wide; installer details unavailable; not council-attributed"],
    ["Postcode",...COMMUNITY_METRICS.map(item => `${item.label} (${item.unit})`)],
    ...report.postcodes.map(row => [row.postcode,...COMMUNITY_METRICS.map(item => row.values[item.id])]),
    ["Total",...COMMUNITY_METRICS.map(item => report.totals[item.id])], [],
    ["Month",...COMMUNITY_METRICS.map(item => `${item.label} (${item.unit})`)], ...report.trend.map(row => [row.month,...COMMUNITY_METRICS.map(item => row.values[item.id])]), [],
    ...report.notes.map(note => ["Method",note]), ...report.provenance.map(source => ["Source",source.metric,source.url,source.sha256]),
  ];
  const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href=url; link.download=`council-community-installations-${report.sourceAsOf}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
