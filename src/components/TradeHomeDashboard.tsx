"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { User } from "firebase/auth";
import type { BusinessReport } from "@/lib/trade-business-reports";
import { JOB_COST_STATUS_LABELS } from "@/lib/trade-business-reports";
import { HOME_REVENUE_PERIODS as periods, type HomeDashboard, type HomeRevenuePeriod } from "@/lib/trade-home-dashboard";
import { normaliseLocalDateTime } from "@/lib/trade-schedule";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import styles from "./TradeHomeDashboard.module.css";

type HomeResponse = { ok?: boolean; dashboard?: HomeDashboard; error?: string };
export type TradeHomeDashboardProps = {
  user: User;
  staffPermissions?: TradeTeamPermissions;
  onOpenJob: (id: string, tab?: "tasks" | "notes") => void;
  onOpenSchedule: (weekStart?: string) => void;
  onOpenJobs: (filter?: string) => void;
  onNewJob?: () => void;
  onOpenInvoices?: () => void;
  onOpenJobInvoice?: (id: string) => void;
  onOpenJobCosts?: (id: string) => void;
  onOpenReports?: () => void;
  refreshKey?: number;
};

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const exactMoney = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const dayLabel = (day: string, showYear = false) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: showYear ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const hours = (minutes: number) => `${(minutes / 60).toLocaleString("en-AU", { maximumFractionDigits: 1 })} h`;
const plural = (count: number, noun: string) => `${count.toLocaleString("en-AU")} ${noun}${count === 1 ? "" : "s"}`;
const serviceNames: Record<string, string> = { ...ENERGY_SERVICE_LABELS, "rental-inspection": "Rental inspection", "mounting-hardware": "Mounting and hardware", controls: "Energy controls", unknown: "Uncategorised", other: "Other work" };
const chartColours = ["#0a9b86", "#428ae8", "#9c7bea", "#e8ad4c", "#de788e", "#5aaec0"];

function Icon({ kind }: { kind: "calendar" | "briefcase" | "wallet" | "chart" | "refresh" | "plus" | "check" }) {
  const paths: Record<typeof kind, ReactNode> = {
    calendar: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V4h8v3M3 12c5 4 13 4 18 0M10 14h4" /></>,
    wallet: <><path d="M19 8V5H6a3 3 0 0 0 0 6h15v9H6a3 3 0 0 1-3-3V8" /><path d="M21 11h-6v5h6M17 13.5h.01" /></>,
    chart: <><path d="M4 4v16h17M8 16v-5M13 16V7M18 16V4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function TradeHomeDashboard({ user, staffPermissions, onOpenJob, onOpenSchedule, onOpenJobs, onNewJob, onOpenInvoices, onOpenJobInvoice, onOpenJobCosts, onOpenReports, refreshKey = 0 }: TradeHomeDashboardProps) {
  const request = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const [period, setPeriod] = useState<HomeRevenuePeriod>("monthly");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; dashboard: HomeDashboard | null; error: string } | null>(null);
  const canSeeFinance = !staffPermissions || (staffPermissions.canRunReports && staffPermissions.canViewInvoices);
  const canCreate = Boolean(onNewJob) && (!staffPermissions || staffPermissions.canCreateJobs);
  const canPlanSchedule = !staffPermissions || staffPermissions.canRescheduleJobs;
  const canSeeReports = Boolean(onOpenReports) && (!staffPermissions || staffPermissions.canRunReports);
  const requestKey = [user.uid, business?.ownerUid || "", business?.memberId || "", JSON.stringify(staffPermissions || null), period, refresh, refreshKey].join("|");
  const loading = result?.key !== requestKey;
  const dashboard = loading ? null : result?.dashboard;
  const error = loading ? "" : result?.error;
  const financial = canSeeFinance && dashboard?.financial?.permissions.invoices ? dashboard.financial : null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (active) setResult({ key: requestKey, dashboard: null, error: "Home is taking longer than expected to load. Please try again." });
    }, 25000);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (!active || controller.signal.aborted) return;
        const response = await request(`/api/trade-crm?mode=home&period=${period}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const body: HomeResponse = await response.json();
        if (!response.ok || !body.ok || !body.dashboard) throw new Error(body.error || "Your dashboard could not be loaded. Please try again.");
        if (active && !controller.signal.aborted) setResult({ key: requestKey, dashboard: body.dashboard, error: "" });
      } catch (failure) {
        if (active && !controller.signal.aborted) setResult({ key: requestKey, dashboard: null, error: failure instanceof Error ? failure.message : "Your dashboard could not be loaded." });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [request, user, period, requestKey]);

  const overdue = financial?.receivables?.buckets.filter(bucket => bucket.key !== "Not overdue" && bucket.key !== "No due date").reduce((sum, bucket) => sum + bucket.cents, 0) ?? null;
  const payments = financial?.receivables?.items || [];
  const costAttention = financial?.profitability?.attentionItems || [];

  return <section className={styles.home} aria-label="Home dashboard" data-tlink-home>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}>Your business at a glance</span><h2>Home dashboard</h2><p>See what is happening. Know what comes next.</p></div>
      <div className={styles.headerActions}>
        <button className={styles.iconButton} type="button" aria-label="Refresh dashboard" disabled={loading} onClick={() => setRefresh(value => value + 1)}><Icon kind="refresh" /></button>
        {canCreate && <button className={styles.primaryButton} type="button" onClick={onNewJob}><Icon kind="plus" />New job</button>}
      </div>
    </header>

    {loading && <div className={styles.loading} role="status"><span className={styles.loadingDot} />Loading your dashboard<span className={styles.loadingHint}>Bringing your jobs and schedule together.</span></div>}
    {error && <div className={styles.error} role="alert"><strong>Home could not be loaded</strong><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}

    {dashboard && !error && <>
      <div className={styles.summary}>
        {financial && financial.current.invoicedCents !== null ? <SummaryCard label="Net invoiced" value={money(financial.current.invoicedCents)} detail={`${periods.find(item => item.value === period)?.label} · ex GST`} icon="chart" onClick={canSeeReports ? onOpenReports : undefined} />
          : <SummaryCard label="Open jobs" value={String(dashboard.metrics.openJobs)} detail="Your active work" icon="briefcase" onClick={() => onOpenJobs("all")} />}
        {financial?.receivables ? <SummaryCard label="Outstanding" value={money(financial.receivables.outstandingCents)} detail={`${money(overdue ?? 0)} overdue · incl GST`} icon="wallet" onClick={onOpenInvoices} attention={Boolean(overdue && overdue > 0)} />
          : <SummaryCard label="Needs scheduling" value={String(dashboard.metrics.awaitingSchedule)} detail="Accepted or approved work awaiting a visit" icon="calendar" onClick={() => onOpenJobs("awaiting_schedule")} />}
        <SummaryCard label="Jobs this week" value={String(dashboard.metrics.thisWeekJobs)} detail={`${plural(dashboard.metrics.thisWeekVisits, "visit")} scheduled`} icon="calendar" onClick={() => onOpenSchedule(dashboard.workload[0]?.weekStart)} />
        <SummaryCard label="Jobs next week" value={String(dashboard.metrics.nextWeekJobs)} detail={`${plural(dashboard.metrics.nextWeekVisits, "visit")} scheduled`} icon="briefcase" onClick={() => onOpenSchedule(dashboard.workload[1]?.weekStart)} />
      </div>

      <div className={financial ? styles.chartGrid : styles.singleChart}>
        {financial && <RevenueCard report={financial} period={period} onPeriodChange={setPeriod} onOpenReports={canSeeReports ? onOpenReports : undefined} />}
        <WorkloadCard dashboard={dashboard} onOpenSchedule={onOpenSchedule} />
      </div>

      <div className={styles.lowerGrid}>
        <section className={styles.card} aria-label="Upcoming schedule">
          <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Coming up</span><h3>Your schedule</h3><p className={styles.range}>Today: {plural(dashboard.metrics.todayJobs, "job")} · {plural(dashboard.metrics.todayVisits, "visit")}</p></div><button className={styles.textButton} type="button" onClick={() => onOpenSchedule()}>Open schedule</button></div>
          {dashboard.upcomingAppointments.length ? <ol className={styles.scheduleList}>{dashboard.upcomingAppointments.slice(0, 5).map(appointment => {
            // Schedule timestamps are business-local wall time, not UTC instants.
            // UTC here preserves their date and clock components in every browser zone.
            const wallTime = new Date(`${normaliseLocalDateTime(appointment.startsAt)}:00Z`);
            const dateParts = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(wallTime);
            const startTime = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(wallTime);
            return <li key={appointment.id}><button type="button" className={styles.scheduleItem} onClick={() => onOpenJob(appointment.job.id)}>
              <span className={styles.dateBadge} aria-hidden="true"><b>{dateParts.find(part => part.type === "day")?.value}</b><span>{dateParts.find(part => part.type === "month")?.value}</span></span>
              <span className={styles.scheduleCopy}><strong>{appointment.job.title || appointment.title}</strong><span><time dateTime={appointment.startsAt}>{new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(wallTime)} · {startTime}</time>{appointment.assigneeLabel ? ` · ${appointment.assigneeLabel}` : ""}</span><small>{appointment.job.workNumber}</small></span>
              
            </button></li>;
          })}</ol> : <div className={styles.empty}><Icon kind="calendar" /><strong>No upcoming visits</strong><p>Your next scheduled jobs will appear here.</p><button type="button" onClick={() => onOpenSchedule()}>{canPlanSchedule ? "Plan your week" : "View schedule"}</button></div>}
          <p className={styles.footnote}>Times shown in {dashboard.timeZone.replace("Australia/", "").replaceAll("_", " ")} time.</p>
        </section>

        <section className={styles.card} aria-label="Next actions">
          <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Keep work moving</span><h3>Needs attention</h3></div></div>
          <div className={styles.actionList}>
            {dashboard.metrics.awaitingSchedule > 0 && <ActionRow count={dashboard.metrics.awaitingSchedule} title="Needs scheduling" detail="View accepted or approved work to book" onClick={() => onOpenJobs("awaiting_schedule")} />}
            {dashboard.metrics.waitingJobs > 0 && <ActionRow count={dashboard.metrics.waitingJobs} title="Waiting jobs" detail="Check what is holding work up" onClick={() => onOpenJobs("blocked")} />}
          </div>
          {payments.length > 0 && <>
            <h4 className={styles.attentionHeading}>Payment follow-up</h4>
            <ul className={styles.financeActions}>{payments.slice(0, 3).map(item => <li key={item.jobId}><button type="button" onClick={() => (onOpenJobInvoice || onOpenJob)(item.jobId)}>
              <span><strong>{item.number || item.title || "Job invoice"}</strong><small>{item.overdueDays === null ? "Add a due date" : item.overdueDays > 0 ? `${item.overdueDays} days overdue` : `Due ${dayLabel(item.dueAt)}`}</small></span>
              <b>{money(item.balanceCents)}</b>
            </button></li>)}</ul>
            <p className={styles.footnote}>Current outstanding balances including GST. Oldest overdue first.</p>
          </>}
          {financial?.profitability && financial.profitability.jobs > 0 && <>
            <h4 className={styles.attentionHeading}>Completed job costs</h4>
            <p className={styles.footnote}>{financial.profitability.completeJobs} of {financial.profitability.jobs} completed jobs have full cost and invoice records for this period.</p>
            {costAttention.length > 0 && <ul className={styles.financeActions}>{costAttention.slice(0, 3).map(item => <li key={item.id}><button type="button" onClick={() => (item.status === "invoice_needed" ? onOpenJobInvoice || onOpenJob : onOpenJobCosts || onOpenJob)(item.id)}>
              <span><strong>{item.number || item.title || "Job"}</strong><small>{JOB_COST_STATUS_LABELS[item.status]}{item.missingCosts > 0 ? ` · ${item.missingCosts} cost items missing` : ""}</small></span><span aria-hidden="true">→</span>
            </button></li>)}</ul>}
          </>}
          {dashboard.metrics.overdueTasks > 0 && <p className={styles.attentionHeading}>{plural(dashboard.metrics.overdueTasks, "overdue task")}</p>}
          {(dashboard.overdueTasks.length > 0 || dashboard.openIssues.length > 0) && <ul className={styles.attentionList}>
            {dashboard.overdueTasks.slice(0, 3).map(task => <li key={`task-${task.id}`}><button type="button" onClick={() => onOpenJob(task.job.id, "tasks")}><span className={styles.attentionDot} /><span><strong>{task.title}</strong><small>{task.job.workNumber} · Overdue task</small></span></button></li>)}
            {dashboard.openIssues.slice(0, 2).map(issue => <li key={`issue-${issue.id}`}><button type="button" onClick={() => onOpenJob(issue.job.id, "notes")}><span className={styles.attentionDot} /><span><strong>{issue.body}</strong><small>{issue.job.workNumber} · Open issue</small></span></button></li>)}
          </ul>}
          {!dashboard.metrics.awaitingSchedule && !dashboard.metrics.waitingJobs && !dashboard.metrics.overdueTasks && !dashboard.metrics.openIssues && !payments.length && !costAttention.length && <div className={styles.empty}>
            {dashboard.metrics.openJobs === 0 ? <><Icon kind="briefcase" /><strong>No active jobs</strong>
              <p>{canCreate ? "Create a job to start planning your next piece of work." : staffPermissions?.crewLead ? "Your crew's next assigned jobs will appear here." : staffPermissions?.jobScope === "own" ? "Your dispatcher can assign your next job." : "No active jobs are available in this view."}</p>
              {canCreate ? <button type="button" onClick={onNewJob}>Create job</button> : <button type="button" onClick={() => onOpenSchedule()}>View schedule</button>}
            </> : <><Icon kind="check" /><strong>You are up to date</strong><p>No waiting jobs, overdue tasks or open issues to follow up.</p><button type="button" onClick={() => onOpenJobs("all")}>View jobs</button></>}
          </div>}
          {(dashboard.metrics.overdueTasks > 3 || dashboard.metrics.openIssues > 2) && <p className={styles.footnote}>Showing {Math.min(3, dashboard.overdueTasks.length)} of {plural(dashboard.metrics.overdueTasks, "overdue task")} and {Math.min(2, dashboard.openIssues.length)} of {plural(dashboard.metrics.openIssues, "open issue")}.</p>}
        </section>
      </div>
      <footer className={styles.updated}>Updated {new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: dashboard.timeZone }).format(new Date(dashboard.generatedAt))} · Showing the jobs available to you.</footer>
    </>}
  </section>;
}

function SummaryCard({ label, value, detail, icon, onClick, attention = false }: { label: string; value: string; detail: string; icon: "calendar" | "briefcase" | "wallet" | "chart"; onClick?: () => void; attention?: boolean }) {
  const content = <><span className={styles.summaryLabel}>{label}<span className={styles.summaryIcon}><Icon kind={icon} /></span></span><strong className={styles.summaryValue}>{value}</strong><span className={attention ? styles.summaryAttention : styles.summaryDetail}>{detail}</span></>;
  return onClick ? <button type="button" className={styles.summaryCard} onClick={onClick}>{content}</button> : <div className={styles.summaryCard}>{content}</div>;
}

function RevenueCard({ report, period, onPeriodChange, onOpenReports }: { report: BusinessReport; period: HomeRevenuePeriod; onPeriodChange: (period: HomeRevenuePeriod) => void; onOpenReports?: () => void }) {
  const groups = report.services.filter(group => group.invoicedCents !== null && group.invoicedCents !== 0).sort((a, b) => (b.invoicedCents ?? 0) - (a.invoicedCents ?? 0));
  const hasNegative = groups.some(group => (group.invoicedCents ?? 0) < 0);
  const total = groups.reduce((sum, group) => sum + (group.invoicedCents ?? 0), 0);
  const chartGroups = groups.length > 6 ? [...groups.slice(0, 5), { key: "remaining-services", newJobs: 0, completedJobs: 0, invoicedCents: groups.slice(5).reduce((sum, group) => sum + (group.invoicedCents ?? 0), 0) }] : groups;
  let offset = 0;
  const net = report.current.invoicedCents;
  const previous = report.previous?.invoicedCents;
  const change = net !== null && previous !== null && previous !== undefined ? net - previous : null;
  const costs = report.profitability;
  const completeCostRecords = Boolean(costs && costs.jobs > 0 && costs.completeJobs === costs.jobs);
  return <section className={styles.card} aria-label="Revenue overview">
    <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Business performance</span><h3>Revenue</h3></div><label className={styles.periodPicker}><span className={styles.srOnly}>Revenue period</span><select value={period} onChange={event => { const selected = periods.find(item => item.value === event.target.value); if (selected) onPeriodChange(selected.value); }}>{periods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
    <p className={styles.range}>{dayLabel(report.period.start, true)} to {dayLabel(report.period.end, true)} · Net invoicing by service</p>
    <div className={styles.revenueVisual}>
      <div className={styles.doughnut}>
        <svg viewBox="0 0 220 220" role="img" aria-label={net === null ? "Net invoicing unavailable" : `Net invoicing ${exactMoney(net)} excluding GST. ${hasNegative ? "Signed service amounts are listed alongside; proportions are not shown because some service totals are negative." : "Service amounts are listed alongside."}`}>
          <circle className={styles.ringTrack} cx="110" cy="110" r="88" fill="none" strokeWidth="23" />
          {!hasNegative && total > 0 && chartGroups.map((group, index) => {
            const share = (group.invoicedCents ?? 0) / total * 100;
            const start = offset; offset += share;
            return <circle key={group.key} cx="110" cy="110" r="88" fill="none" stroke={chartColours[index]} strokeWidth="23" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 110 110)" />;
          })}
        </svg>
        <div className={styles.doughnutCentre} aria-hidden="true"><span>Net invoiced</span><strong title={net === null ? undefined : exactMoney(net)}>{net === null ? "Unavailable" : money(net)}</strong><small>excluding GST</small></div>
      </div>
      <div className={styles.revenueLegend}>
        {chartGroups.length ? <ul>{chartGroups.map((group, index) => <li key={group.key}><span className={styles.legendDot} style={{ background: hasNegative ? "var(--trade-muted, #637a7b)" : chartColours[index] }} /><span>{group.key === "remaining-services" ? "Other services" : serviceNames[group.key] || group.key}</span><strong title={exactMoney(group.invoicedCents ?? 0)}>{money(group.invoicedCents ?? 0)}</strong></li>)}</ul> : <p>No issued invoices or credits in this period.</p>}
        {hasNegative && <p className={styles.chartNote}>Credits exceed invoicing in one or more services. Signed totals are shown without a proportional split.</p>}
        {change !== null && report.period.previous && <p className={styles.comparison}>{change === 0 ? "Unchanged from" : `${money(Math.abs(change))} ${change > 0 ? "more" : "less"} than`} the previous period ({dayLabel(report.period.previous.start, true)} to {dayLabel(report.period.previous.end, true)}).</p>}
      </div>
    </div>
    <div className={styles.financeDetails}>
      {report.recordedGst && <div><span>Net GST on invoices</span><strong>{money(report.recordedGst.netGstCents)}</strong><small>Selected period, after credits</small></div>}
      {costs && <div><span>Recorded job costs</span><strong>{money(costs.labourCents + costs.materialCents + costs.otherCents)}</strong><small>{plural(costs.jobs, "job")} completed in this period · ex GST</small></div>}
      {completeCostRecords && costs && costs.marginCents !== null && costs.marginPercent !== null && <div><span>Completed-job gross margin</span><strong>{costs.marginPercent.toFixed(1)}%</strong><small>{money(costs.marginCents)} · before business overheads</small></div>}
    </div>
    {costs && costs.jobs > 0 && !completeCostRecords && <p className={styles.footnote}>Costs or invoice records are incomplete for {plural(costs.jobs - costs.completeJobs, "completed job")}. Margin is not shown.</p>}
    {costs && <p className={styles.footnote}>Costs relate to completed jobs. They are a different group from invoices issued in this period.</p>}
    {onOpenReports && <button type="button" className={styles.textButton} onClick={onOpenReports}>View full report</button>}
  </section>;
}

function WorkloadCard({ dashboard, onOpenSchedule }: { dashboard: HomeDashboard; onOpenSchedule: (weekStart?: string) => void }) {
  const maximum = Math.max(2, Math.ceil(Math.max(0, ...dashboard.workload.map(week => week.jobs)) / 2) * 2);
  const totalVisits = dashboard.workload.reduce((sum, week) => sum + week.visits, 0);
  const totalMinutes = dashboard.workload.reduce((sum, week) => sum + week.bookedMinutes, 0);
  const missingDurations = dashboard.workload.reduce((sum, week) => sum + week.missingDurations, 0);
  return <section className={styles.card} aria-label="Four-week workload">
    <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Look ahead</span><h3>Four-week workload</h3></div><span className={styles.smallBadge}><span />Scheduled jobs</span></div>
    <p className={styles.range}>This week and the next three weeks</p>
    <div className={styles.workloadChart} aria-label="Scheduled jobs by week">
      <div className={styles.chartGridlines} aria-hidden="true"><span>{maximum}</span><span>{Math.round(maximum / 2)}</span><span>0</span></div>
      <div className={styles.weekColumns}>{dashboard.workload.map((week, index) => <button key={week.weekStart} className={styles.weekColumn} type="button" onClick={() => onOpenSchedule(week.weekStart)} aria-label={`Open week starting ${dayLabel(week.weekStart)}: ${plural(week.jobs, "job")}, ${plural(week.visits, "visit")}, ${hours(week.bookedMinutes)} booked${week.missingDurations ? `, ${plural(week.missingDurations, "visit")} without a duration` : ""}`}>
        <span className={styles.barArea}><span className={styles.bar} style={{ height: `${week.jobs / maximum * 100}%`, "--bar-opacity": index === 0 ? 1 : 0.55 + index * 0.1 } as CSSProperties} /><strong style={{ bottom: `${week.jobs / maximum * 100}%` }}>{week.jobs}</strong></span><span className={styles.weekLabel}>{index === 0 ? "This week" : index === 1 ? "Next week" : dayLabel(week.weekStart)}</span><small>{index < 2 ? dayLabel(week.weekStart) : "Week starting"}</small>
      </button>)}</div>
    </div>
    <div className={styles.workloadTotals}><div><strong>{totalVisits}</strong><span>scheduled visits</span></div><div><strong>{hours(totalMinutes)}</strong><span>booked time</span></div><button className={styles.textButton} type="button" onClick={() => onOpenSchedule()}>Plan schedule</button></div>
    <p className={styles.footnote}>{totalVisits === 0 ? "Add a visit to start planning your workload." : "Includes completed visits this week. A job can appear in more than one week."}{missingDurations > 0 ? ` ${plural(missingDurations, "visit")} without a duration are excluded from booked time.` : ""}</p>
  </section>;
}

function ActionRow({ count, title, detail, onClick }: { count: number; title: string; detail: string; onClick: () => void }) {
  return <button type="button" className={styles.actionRow} onClick={onClick}><span className={styles.actionCount}>{count}</span><span><strong>{title}</strong><small>{detail}</small></span></button>;
}
