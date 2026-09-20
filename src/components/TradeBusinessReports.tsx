"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { reportChange, reportCsvRows, type BusinessReport, type ReportBreakdown, type ReportPreset } from "@/lib/trade-business-reports";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { downloadWorkspaceCsv } from "./WorkspaceTableTools";
import styles from "./TradeBusinessReports.module.css";

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const exactMoney = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const date = (day: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const shortDate = (day: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const hours = (minutes: number) => `${(minutes / 60).toLocaleString("en-AU", { maximumFractionDigits: 1 })} h`;
const services: Record<string, string> = { ...ENERGY_SERVICE_LABELS, "rental-inspection": "Rental inspection", "mounting-hardware": "Mounting and hardware", controls: "Energy controls", unknown: "Not recorded", other: "Other work" };
const stages: Record<string, string> = { backlog: "Planning", ready: "Ready to schedule", scheduled: "Scheduled", in_progress: "On site", blocked: "Waiting", completed: "Completed", cancelled: "Cancelled" };
const presets: Array<[ReportPreset, string]> = [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["fytd", "Financial year to date"], ["all", "All time"], ["custom", "Custom dates"]];
type ReportResponse = { ok?: boolean; report?: BusinessReport; error?: string };

export function TradeBusinessReports({ user, onOpenJobs, onOpenSchedule, onOpenInvoices, onOpenJobCosts }: {
  user: User; onOpenJobs: () => void; onOpenSchedule?: () => void; onOpenInvoices?: () => void; onOpenJobCosts?: (id: string) => void;
}) {
  const [preset, setPreset] = useState<ReportPreset>("monthly"); const [anchor, setAnchor] = useState("");
  const [service, setService] = useState(""); const [state, setState] = useState("");
  const [custom, setCustom] = useState(false); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [range, setRange] = useState({ from: "", to: "" }); const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<BusinessReport | null>(null); const [settledKey, setSettledKey] = useState(""); const [requestError, setError] = useState("");
  const [profitPage, setProfitPage] = useState(1);
  const [chart, setChart] = useState<"jobs" | "invoices">("jobs");
  const requestKey = [user.uid, preset, anchor, service, state, range.from, range.to, profitPage, refresh].join("|");
  const loading = settledKey !== requestKey; const error = loading ? "" : requestError;
  useEffect(() => {
    let active = true; const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); if (active) { setSettledKey(requestKey); setError("Reports took too long to load. Try refreshing this report."); } }, 25000);
    const params = new URLSearchParams({ period: preset, service, state, profitPage: String(profitPage) });
    if (anchor) params.set("anchor", anchor);
    if (preset === "custom") { params.set("from", range.from); params.set("to", range.to); }
    void (async () => {
      try {
        const token = await user.getIdToken(); if (controller.signal.aborted) return;
        const response = await fetch(`/api/trade-crm?mode=reports&${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => ({})) as ReportResponse;
        if (!response.ok || !body.ok || !body.report) throw new Error(body.error || "This report could not be loaded. Try again.");
        if (active && !controller.signal.aborted) { setReport(body.report); setError(""); }
      } catch (failure) { if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "This report could not be loaded."); }
      finally { clearTimeout(timer); if (active && !controller.signal.aborted) setSettledKey(requestKey); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [user, preset, anchor, service, state, range.from, range.to, profitPage, requestKey]);
  function selectPeriod(next: ReportPreset) {
    setProfitPage(1);
    if (next === "custom") { setCustom(true); setFrom(report?.period.start || ""); setTo(report?.period.end || ""); return; }
    setCustom(false); setPreset(next); setAnchor("");
  }
  function applyCustom(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setRange({ from, to }); setPreset("custom"); setAnchor(""); setProfitPage(1); }
  function exportReport() {
    if (!report || loading || error) return;
    downloadWorkspaceCsv(`TLink-business-report-${report.period.start}-${report.period.end}.csv`, [
      { key: "section", label: "Section" }, { key: "metric", label: "Metric" }, { key: "value", label: "Value" }, { key: "comparison", label: "Previous period" }, { key: "basis", label: "Basis" },
    ], reportCsvRows(report));
  }
  const current = report?.current; const previous = report?.previous;
  const decisions = (current?.wonQuotes || 0) + (current?.declinedQuotes || 0);
  const previousDecisions = (previous?.wonQuotes || 0) + (previous?.declinedQuotes || 0);
  const winRate = decisions ? (current?.wonQuotes || 0) / decisions * 100 : null;
  const previousWinRate = previousDecisions ? (previous?.wonQuotes || 0) / previousDecisions * 100 : null;
  const chartIsMoney = chart === "invoices" && Boolean(report?.permissions.invoices);
  const trend = report?.trend || [];
  const values = trend.map(bucket => chartIsMoney ? bucket.invoicedCents || 0 : bucket.newJobs);
  const max = Math.max(1, ...values.map(Math.abs));
  const trendDate = report && report.period.start.slice(0, 4) !== report.period.end.slice(0, 4) ? date : shortDate;
  return <section className={styles.reports} aria-label="Business reports">
    <header className={styles.heading}><div><span className={styles.eyebrow}>Business performance</span><h3>Reports</h3><p>See what is growing, what needs attention and what is coming next.</p></div><div className={styles.actions}><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button><button type="button" onClick={exportReport} disabled={!report || loading || Boolean(error)}>Export report</button></div></header>
    <div className={styles.controls}>
      <nav className={styles.presets} aria-label="Report period">{presets.map(([key, label]) => <button type="button" key={key} aria-pressed={key === "custom" ? custom : !custom && preset === key} onClick={() => selectPeriod(key)}>{label}</button>)}</nav>
      {custom && <form className={styles.custom} onSubmit={applyCustom}><label>From<input type="date" required value={from} max={to || report?.period.today} data-date-range-group="business-reports" data-date-range-role="start" onChange={event => setFrom(event.target.value)} /></label><label>To<input type="date" required value={to} min={from} max={report?.period.today} data-date-range-group="business-reports" data-date-range-role="end" onChange={event => setTo(event.target.value)} /></label><button type="submit">Apply dates</button><small>Choose any date range from your business history.</small></form>}
      <div className={styles.filters}><label>Service<select value={service} onChange={event => { setService(event.target.value); setProfitPage(1); }}><option value="">All services</option>{report?.options.services.map(key => <option key={key} value={key}>{services[key] || key}</option>)}</select></label><label>Job region<select value={state} onChange={event => { setState(event.target.value); setProfitPage(1); }}><option value="">All regions</option>{report?.options.states.map(key => <option key={key} value={key}>{key === "unknown" ? "Region not recorded" : key}</option>)}</select></label>{(service || state) && <button type="button" onClick={() => { setService(""); setState(""); setProfitPage(1); }}>Clear filters</button>}</div>
    </div>
    {loading && <p className={styles.notice} role="status">Loading the selected business report...</p>}
    {error && <div className={styles.error} role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {!loading && !error && report && current && <>
      <div className={styles.period}><div><strong>{preset === "all" ? "All recorded history · " : ""}{date(report.period.start)} to {date(report.period.end)}</strong><small>{report.period.previous ? `Compared with ${date(report.period.previous.start)} to ${date(report.period.previous.end)} · ` : ""}{report.period.timeZone.replace("Australia/", "")} time</small></div>{preset !== "custom" && preset !== "all" && <div className={styles.actions}><button type="button" aria-label="Previous reporting period" disabled={!report.period.previousAnchor} onClick={() => { setAnchor(report.period.previousAnchor || ""); setProfitPage(1); }}>Previous</button><button type="button" onClick={() => { setAnchor(""); setProfitPage(1); }} disabled={!anchor}>Current</button><button type="button" aria-label="Next reporting period" disabled={!report.period.nextAnchor} onClick={() => { setAnchor(report.period.nextAnchor || ""); setProfitPage(1); }}>Next</button></div>}</div>
      <div className={styles.metrics}>
        {current.invoicedCents !== null && <Metric label="Net TLink invoicing" value={money(current.invoicedCents)} detail="Issued invoices less credits, ex GST" comparison={previous ? reportChange(current.invoicedCents, previous.invoicedCents || 0) : null} />}
        <Metric label="New jobs" value={String(current.newJobs)} detail="Jobs created in this period" comparison={previous ? reportChange(current.newJobs, previous.newJobs) : null} />
        <Metric label="Jobs completed" value={String(current.completedJobs)} detail="Recorded job completions" comparison={previous ? reportChange(current.completedJobs, previous.completedJobs) : null} />
        {current.wonCents !== null && <Metric label="Work won" value={money(current.wonCents)} detail={`${current.wonQuotes} accepted quote decisions, ex GST`} comparison={previous ? reportChange(current.wonCents, previous.wonCents || 0) : null} />}
        {current.wonQuotes !== null && <Metric label="Quote decision win rate" value={winRate === null ? "No decisions" : `${winRate.toFixed(0)}%`} detail={`${current.wonQuotes} accepted · ${current.declinedQuotes} declined`} comparison={!previous ? null : previousWinRate === null ? "No previous decisions" : `Previous: ${previousWinRate.toFixed(0)}%`} />}
        <Metric label="Booked hours" value={hours(current.bookedMinutes)} detail={`${current.visits} visits · ${current.completedVisits} completed`} comparison={previous ? reportChange(current.bookedMinutes, previous.bookedMinutes) : null} />
      </div>
      <div className={styles.twoColumns}>
        <section className={styles.card} aria-label="Performance trend"><header><div><h4>Performance over time</h4><p>{chartIsMoney ? "Net TLink invoicing, excluding GST" : "Jobs created"}</p></div><div className={styles.actions}><button type="button" aria-pressed={!chartIsMoney} onClick={() => setChart("jobs")}>Jobs</button>{report.permissions.invoices && <button type="button" aria-pressed={chartIsMoney} onClick={() => setChart("invoices")}>Invoicing</button>}</div></header>
          <div className={styles.chart} role="img" aria-label={`${chartIsMoney ? "Net invoicing" : "New jobs"} trend. Exact values are in the table below.`}>{trend.map((bucket, index) => <div className={styles.chartColumn} key={bucket.start}><div className={styles.barTrack}><div className={values[index] < 0 ? styles.negativeBar : styles.bar} style={{ height: `${Math.abs(values[index]) / max * 100}%` }} title={`${date(bucket.start)} to ${date(bucket.end)}: ${chartIsMoney ? exactMoney(values[index]) : values[index]}`} /></div><span>{index === 0 || index === trend.length - 1 || trend.length < 14 || index % 5 === 0 ? trendDate(bucket.start) : ""}</span></div>)}</div>
          {!values.some(value => value !== 0) && <p className={styles.hint}>No {chartIsMoney ? "issued TLink invoices or credits" : "new jobs"} in this period.</p>}
          <details><summary>View exact figures</summary><div className={styles.tableScroll}><table><thead><tr><th>Period</th><th>New jobs</th><th>Completed</th>{report.permissions.invoices && <th>Net invoicing ex GST</th>}</tr></thead><tbody>{trend.map(bucket => <tr key={bucket.start}><th>{trendDate(bucket.start)}{bucket.start !== bucket.end ? ` to ${trendDate(bucket.end)}` : ""}</th><td>{bucket.newJobs}</td><td>{bucket.completedJobs}</td>{bucket.invoicedCents !== null && <td>{exactMoney(bucket.invoicedCents)}</td>}</tr>)}</tbody></table></div></details>
        </section>
        <section className={styles.card} aria-label="Current work health"><header><div><h4>What needs attention</h4><p>Current work, as at {date(report.period.today)}</p></div><button type="button" onClick={onOpenJobs}>View jobs</button></header><dl className={styles.list}>{[["Open jobs", report.work.openJobs], ["Waiting on something", report.work.waitingJobs], ["Need a team member", report.work.unassignedJobs], ["Need a future visit", report.work.awaitingSchedule], ["Overdue tasks", report.work.overdueTasks], ["Open issues", report.work.openIssues], ["Completed, not invoiced", report.work.completedUninvoiced]].filter(([, value]) => value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
      </div>
      {report.receivables && <section className={styles.card} aria-label="Money to collect"><header><div><h4>Money to collect</h4><p>Current balances across the selected services and regions, including GST</p></div>{onOpenInvoices && <button type="button" onClick={onOpenInvoices}>Open invoices</button>}</header><div className={styles.receivables}><div><span>Outstanding today</span><strong>{money(report.receivables.outstandingCents)}</strong><small>Recorded paid balance: {exactMoney(report.receivables.paidCents)}</small></div><div className={styles.ageing}>{report.receivables.buckets.map(bucket => <div key={bucket.key}><span>{bucket.key}</span><strong>{money(bucket.cents)}</strong><small>{bucket.count} invoice{bucket.count === 1 ? "" : "s"}</small></div>)}</div></div><p className={styles.hint}>This is today&apos;s position, not a historical cash balance. Recorded payments come from linked accounting or manually entered job balances; keep those records up to date.</p></section>}
      {report.profitability && <section className={styles.card} aria-label="Completed job profitability"><header><div><h4>Completed job profitability</h4><p>Current recorded position for jobs completed in this period. All figures exclude GST.</p></div></header>
        <div className={styles.metrics}>
          <Metric label="Net invoiced value" value={money(report.profitability.revenueCents)} detail={`${report.profitability.jobs} completed jobs, less issued credits`} comparison={null} />
          <Metric label="Recorded direct costs" value={money(report.profitability.labourCents + report.profitability.materialCents + report.profitability.otherCents)} detail={`Labour ${money(report.profitability.labourCents)} · Materials ${money(report.profitability.materialCents)} · Other ${money(report.profitability.otherCents)}`} comparison={null} />
          <Metric label="Gross job margin" value={report.profitability.marginCents === null ? "Costs needed" : money(report.profitability.marginCents)} detail={`${report.profitability.completeJobs} of ${report.profitability.jobs} jobs with complete records${report.profitability.marginPercent === null ? "" : ` · ${report.profitability.marginPercent.toFixed(1)}% margin`}`} comparison={null} />
        </div><p className={styles.hint}>Margin includes only jobs with an issued TLink invoice and recorded costs for every planned cost item. Missing costs are not treated as zero. This is gross job margin before business overheads, payroll on-costs and income tax. Recorded labour: {hours(report.profitability.labourMinutes)}.</p>
        {report.profitability.items.length > 0 ? <div className={styles.tableScroll}><table><thead><tr><th>Job</th><th>Net invoiced</th><th>Recorded costs</th><th>Gross margin</th><th>Cost records</th></tr></thead><tbody>{report.profitability.items.map(job => <tr key={job.id}><th><strong>{job.number || "Job"}</strong><small>{job.title}</small></th><td>{exactMoney(job.revenueCents)}</td><td>{exactMoney(job.labourCents + job.materialCents + job.otherCents)}<small>{hours(job.labourMinutes)} labour</small></td><td>{job.marginCents === null ? "Incomplete" : exactMoney(job.marginCents)}{job.marginPercent !== null && <small>{job.marginPercent.toFixed(1)}%</small>}</td><td>{({complete:"Complete",invoice_needed:"Invoice needed",plan_needed:"Work plan needed",scope_review:"Revised scope needs cost review",costs_needed:"Actual costs needed"} as Record<string,string>)[job.status]}{job.missingCosts > 0 && <small>{job.missingCosts} costs to record</small>}{onOpenJobCosts && <button type="button" onClick={() => onOpenJobCosts(job.id)}>Open job costs</button>}</td></tr>)}</tbody></table></div> : <p className={styles.hint}>No completed jobs on this page.</p>}
        {report.profitability.jobs > report.profitability.pageSize && <nav className={styles.actions} aria-label="Job profitability pages"><button type="button" disabled={profitPage <= 1} onClick={() => setProfitPage(value => value - 1)}>Previous jobs</button><span>Page {profitPage} of {Math.ceil(report.profitability.jobs / report.profitability.pageSize)} · all {report.profitability.jobs} jobs included in totals</span><button type="button" disabled={profitPage * report.profitability.pageSize >= report.profitability.jobs} onClick={() => setProfitPage(value => value + 1)}>Next jobs</button></nav>}
      </section>}
      <div className={styles.twoColumns}><Breakdown title="Performance by service" items={report.services} label={key => services[key] || key} invoices={report.permissions.invoices} /><Breakdown title="Performance by region" items={report.regions} label={key => key === "unknown" ? "Region not recorded" : key} invoices={report.permissions.invoices} /></div>
      <section className={styles.card} aria-label="Team workload"><header><div><h4>Team workload</h4><p>Booked visits in the selected period, with the next 28 days alongside</p></div>{onOpenSchedule && <button type="button" onClick={onOpenSchedule}>Open schedule</button>}</header>{report.team.length ? <div className={styles.tableScroll}><table><thead><tr><th>Team member</th><th>Visits</th><th>Completed visits</th><th>Booked hours</th><th>Next 28 days</th></tr></thead><tbody>{report.team.map(member => <tr key={member.key}><th>{member.label}</th><td>{member.visits}</td><td>{member.completedVisits}</td><td>{hours(member.bookedMinutes)}{member.missingDurations > 0 && <small>{member.missingDurations} missing durations</small>}</td><td>{hours(member.upcomingMinutes)}<small>{member.upcomingVisits} visits</small></td></tr>)}</tbody></table></div> : <p className={styles.hint}>No visits in this period or the next 28 days.</p>}<p className={styles.hint}>Booked hours are scheduled time, not timesheets or capacity utilisation. Cancelled and no-show visits are excluded.</p></section>
      <div className={styles.twoColumns}><section className={styles.card}><header><div><h4>Current job pipeline</h4><p>Where your active records stand today</p></div></header><div className={styles.stageList}>{report.work.stages.map(stage => <div key={stage.key}><span>{stages[stage.key] || stage.key}</span><meter min="0" max={Math.max(1,...report.work.stages.map(item => item.count))} value={stage.count} /><strong>{stage.count}</strong></div>)}</div></section><section className={styles.card}><header><div><h4>Sales activity</h4><p>Selected reporting period</p></div></header>{report.permissions.quotes ? <dl className={styles.list}><div><dt>Quotes first issued</dt><dd>{current.quoteIssues}</dd></div><div><dt>Accepted decisions</dt><dd>{current.wonQuotes}</dd></div><div><dt>Declined decisions</dt><dd>{current.declinedQuotes}</dd></div>{current.invoiceCount !== null && <div><dt>TLink invoices issued</dt><dd>{current.invoiceCount}</dd></div>}{current.creditCents !== null && <div><dt>Credits issued, ex GST</dt><dd>{money(current.creditCents)}</dd></div>}</dl> : <p className={styles.hint}>Quote figures need quote-viewing access.</p>}</section></div>
      <details className={styles.definitions}><summary>How these figures are calculated</summary><ul>
        <li>Periods use your business time zone. Weeks start Monday; quarters start January, April, July and October; the Australian financial year starts 1 July. Current periods compare the same number of elapsed days, capped to the previous period.</li>
        <li>All time includes your full recorded history. Custom ranges have no year limit. Longer charts use wider date intervals, with every matching record still included in totals and exports.</li>
        <li>Period invoicing uses issued TLink invoices and credits on their issue dates, excluding GST. Drafts, void invoices, quote revisions and accounting exports are not counted as additional sales. Manual balances and accounting-only invoices lack a reliable issue date here and are excluded from period invoicing.{report.receivables && report.receivables.undatedInvoiceCount > 0 && ` There are ${report.receivables.undatedInvoiceCount} such current invoices, totalling ${exactMoney(report.receivables.undatedInvoiceCents)} including GST.`}</li>
        <li>Work won uses the customer&apos;s accepted quote options. Win rate is accepted decisions divided by accepted plus declined decisions during the period. Quotes first issued are counted once; each version&apos;s customer decision is a separate decision.</li>
        <li>Job completions use the first recorded completion event for each job. Older jobs without a completion event cannot be dated. Active records are included; binned records are excluded. Historical sales on cancelled jobs remain included.</li>
        <li>Service breakdowns use each job&apos;s primary service, and regions use its service-site state. Missing regions are shown explicitly. Team hours require a recorded start and end time and can overlap between visits.</li>
        <li>Recorded payment balances are cumulative, not dated cash receipts. This report does not estimate profit, expenses or bank cash flow from incomplete cost or payment records.</li>
      </ul><p>Updated {new Date(report.generatedAt).toLocaleString("en-AU", { timeZone: report.period.timeZone })}.</p></details>
    </>}
  </section>;
}

function Metric({ label, value, detail, comparison }: { label: string; value: string; detail: string; comparison: string | null }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{detail}</small>{comparison && <p>{comparison}</p>}</article>;
}
function Breakdown({ title, items, label, invoices }: { title: string; items: ReportBreakdown[]; label: (key: string) => string; invoices: boolean }) {
  return <section className={styles.card}><header><div><h4>{title}</h4><p>Selected reporting period</p></div></header>{items.length ? <div className={styles.tableScroll}><table><thead><tr><th>{title.endsWith("service") ? "Service" : "Region"}</th><th>New jobs</th><th>Completed</th>{invoices && <th>Net invoicing ex GST</th>}</tr></thead><tbody>{items.map(item => <tr key={item.key}><th>{label(item.key)}</th><td>{item.newJobs}</td><td>{item.completedJobs}</td>{item.invoicedCents !== null && <td>{exactMoney(item.invoicedCents)}</td>}</tr>)}</tbody></table></div> : <p className={styles.hint}>No activity in this period.</p>}</section>;
}
