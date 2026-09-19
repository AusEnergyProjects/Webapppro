import { addReportDays, ReportInputError, reportTrendWindows, resolveReportPeriod, type BusinessReport, type ReportMeasures } from "./trade-business-reports.ts";

type ReportAccess = { isOwner: boolean; memberId: string; jobScope: string; scheduleScope: string; canViewInvoices: boolean; canViewQuotes: boolean };
type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value || 0);
const ISSUED = "('issued','part_credited','credited')";
const base = `WITH all_jobs AS (
  SELECT w.*, COALESCE(NULLIF(s.address_state,''),'unknown') region,
    COALESCE(d.pipeline_stage,'enquiry') pipeline_stage, COALESCE(d.invoice_status,'not_started') invoice_status,
    COALESCE(d.invoiced_value_cents,0) invoiced_value_cents, COALESCE(d.paid_value_cents,0) paid_value_cents,
    COALESCE(d.payment_due_at,'') payment_due_at
  FROM trade_work_orders w
  LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_service_sites s ON s.id=d.service_site_id AND s.firebase_uid=w.firebase_uid
  WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
    AND (?=1 OR w.assignee_member_id=?)
), jobs AS (SELECT * FROM all_jobs WHERE (?='' OR service_category=?) AND (?='' OR region=?))`;
const native = `, native_invoices AS MATERIALIZED (
  SELECT q.id, q.work_order_id, q.firebase_uid, q.sent_at issued_at, q.total_cents-q.tax_cents net_cents,
    q.total_cents, q.due_at, 'quick' source
  FROM trade_crm_quick_invoices q JOIN jobs j ON j.id=q.work_order_id AND j.firebase_uid=q.firebase_uid
  WHERE q.status IN ${ISSUED} AND q.sent_at<>'' AND q.currency='AUD'
  UNION ALL
  SELECT a.id, a.work_order_id, a.firebase_uid, a.created_at, a.total_cents-a.tax_cents, a.total_cents, a.due_at, 'accepted'
  FROM trade_crm_accepted_invoices a JOIN jobs j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid
  WHERE a.status='issued' AND a.currency='AUD' AND NOT EXISTS (
    SELECT 1 FROM trade_crm_quick_invoices q WHERE q.work_order_id=a.work_order_id AND q.firebase_uid=a.firebase_uid AND q.status IN ${ISSUED} AND q.sent_at<>'')
), credits AS (
  SELECT c.* FROM trade_crm_quick_invoice_credits c JOIN native_invoices n ON n.id=c.invoice_id AND n.firebase_uid=c.firebase_uid AND n.work_order_id=c.work_order_id
  WHERE n.source='quick' AND c.status='issued'
)`;
// D1 allows five terms per compound SELECT. Materialize each event family so
// SQLite cannot flatten the nested unions back into one oversized compound.
const events = `${native}, job_events AS MATERIALIZED (
  SELECT id job_id, 'newJobs' kind, created_at at, 1 value FROM jobs
  UNION ALL SELECT j.id, 'completedJobs', MIN(e.created_at), 1 FROM jobs j JOIN trade_work_order_events e ON e.work_order_id=j.id AND e.firebase_uid=j.firebase_uid WHERE e.event_type='job_completed' GROUP BY j.id
), invoice_events AS MATERIALIZED (
  SELECT work_order_id job_id, 'invoicedCents' kind, issued_at at, net_cents value FROM native_invoices
  UNION ALL SELECT work_order_id, 'invoiceCount', issued_at, 1 FROM native_invoices
  UNION ALL SELECT work_order_id, 'creditCents', created_at, total_cents-tax_cents FROM credits
), quote_events AS MATERIALIZED (
  SELECT q.work_order_id job_id, 'quoteIssues' kind, MIN(v.issued_at) at, 1 value FROM trade_crm_quotes q JOIN jobs j ON j.id=q.work_order_id AND j.firebase_uid=q.firebase_uid JOIN trade_crm_quote_versions v ON v.quote_id=q.id AND v.firebase_uid=q.firebase_uid WHERE v.issued_at<>'' GROUP BY q.id
  UNION ALL SELECT a.work_order_id, CASE WHEN a.decision='accepted' THEN 'wonQuotes' ELSE 'declinedQuotes' END, a.decided_at, 1 FROM trade_crm_quote_acceptances a JOIN jobs j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid WHERE a.decision IN ('accepted','declined')
  UNION ALL SELECT a.work_order_id, 'wonCents', a.decided_at, a.selected_subtotal_cents FROM trade_crm_quote_acceptances a JOIN jobs j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid WHERE a.decision='accepted' AND a.currency='AUD'
), events AS MATERIALIZED (
  SELECT * FROM job_events UNION ALL SELECT * FROM invoice_events UNION ALL SELECT * FROM quote_events
)`;
const rangeCte = `, ranges AS (SELECT json_extract(value,'$.id') id, json_extract(value,'$.startUtc') start_utc, json_extract(value,'$.endUtc') end_utc FROM json_each(?))`;
const finance = `${native}, balances AS (
  SELECT j.id, CASE WHEN n.source='quick' THEN MAX(0,n.total_cents-COALESCE((SELECT SUM(c.total_cents) FROM credits c WHERE c.invoice_id=n.id AND c.firebase_uid=j.firebase_uid),0))
      WHEN a.id IS NOT NULL THEN a.amount_cents WHEN n.id IS NOT NULL THEN n.total_cents ELSE j.invoiced_value_cents END total,
    CASE WHEN a.id IS NOT NULL THEN a.paid_amount_cents ELSE j.paid_value_cents END paid,
    CASE WHEN n.source='quick' THEN n.due_at WHEN a.id IS NOT NULL THEN a.due_at WHEN n.id IS NOT NULL THEN n.due_at ELSE j.payment_due_at END due_at,
    CASE WHEN n.id IS NULL THEN 1 ELSE 0 END undated
  FROM jobs j LEFT JOIN native_invoices n ON n.work_order_id=j.id AND n.firebase_uid=j.firebase_uid
  LEFT JOIN trade_crm_accounting_documents a ON a.work_order_id=j.id AND a.firebase_uid=j.firebase_uid AND a.document_type='invoice' AND a.currency='AUD' AND a.status IN ('issued','part_paid','paid','overdue')
  WHERE n.id IS NOT NULL OR a.id IS NOT NULL OR (j.invoice_status IN ('issued','part_paid','paid','overdue') AND NOT EXISTS (SELECT 1 FROM trade_crm_quick_invoices q WHERE q.work_order_id=j.id AND q.firebase_uid=j.firebase_uid))
), outstanding AS (SELECT *, MAX(0,total-MAX(0,paid)) balance FROM balances)`;

/** Aggregate at the database, never a capped customer/job list. No contact details are selected. */
export async function loadBusinessReport(db: Pick<D1Database, "prepare" | "batch">, uid: string, access: ReportAccess, params: URLSearchParams, state = "NSW", now = new Date()): Promise<BusinessReport> {
  const period = resolveReportPeriod(params, state, now);
  const service = params.get("service") || ""; const region = params.get("state") || "";
  if (!/^[a-zA-Z0-9_-]{0,80}$/.test(service) || !["", "unknown", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].includes(region)) throw new ReportInputError("Choose a valid service and region.");
  const args = [uid, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId, service, service, region, region];
  const timeline = reportTrendWindows(period, state);
  const windows = [{ id: "current", ...period }, { id: "previous", ...period.previous }, ...timeline.map((window, index) => ({ id: `trend${index}`, ...window }))];
  const upcomingEnd = addReportDays(period.today, 28);
  const scheduleRanges = JSON.stringify([{ id: "current", start: period.start, end: addReportDays(period.end, 1) }, { id: "previous", start: period.previous.start, end: addReportDays(period.previous.end, 1) }, { id: "upcoming", start: period.today, end: upcomingEnd }]);
  const results = await db.batch<Row>([
    db.prepare(`${base}${events}${rangeCte}
      SELECT r.id, e.kind, COALESCE(SUM(e.value),0) value FROM ranges r JOIN events e ON julianday(e.at)>=julianday(r.start_utc) AND julianday(e.at)<julianday(r.end_utc) GROUP BY r.id,e.kind`).bind(...args, JSON.stringify(windows)),
    db.prepare(`${base}${events}
      SELECT j.service_category service, j.region, e.kind, SUM(e.value) value FROM events e JOIN jobs j ON j.id=e.job_id WHERE julianday(e.at)>=julianday(?) AND julianday(e.at)<julianday(?) AND e.kind IN ('newJobs','completedJobs','invoicedCents','creditCents') GROUP BY j.service_category,j.region,e.kind`).bind(...args, period.startUtc, period.endUtc),
    db.prepare(`${base}${finance}, aged AS (SELECT *, CASE WHEN due_at='' OR date(due_at) IS NULL THEN 'No due date' WHEN date(due_at)>=? THEN 'Not overdue' WHEN julianday(?)-julianday(date(due_at))<=30 THEN '1 to 30 days' WHEN julianday(?)-julianday(date(due_at))<=60 THEN '31 to 60 days' WHEN julianday(?)-julianday(date(due_at))<=90 THEN '61 to 90 days' ELSE 'Over 90 days' END bucket FROM outstanding)
      SELECT bucket, COUNT(CASE WHEN balance>0 THEN 1 END) count, SUM(balance) cents, SUM(MAX(0,paid)) paid, SUM(undated) undated_count, SUM(CASE WHEN undated=1 THEN total ELSE 0 END) undated_cents FROM aged GROUP BY bucket`).bind(...args, period.today, period.today, period.today, period.today),
    db.prepare(`${base}, windows AS (SELECT json_extract(value,'$.id') id, json_extract(value,'$.start') start, json_extract(value,'$.end') end FROM json_each(?)), visits AS (
      SELECT a.*, MAX(0,ROUND((julianday(a.ends_at)-julianday(a.starts_at))*1440)) minutes FROM trade_crm_appointments a JOIN jobs j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid
      WHERE j.stage<>'cancelled' AND a.status IN ('scheduled','en_route','arrived','in_progress','completed') AND (?=1 OR a.assignee_member_id=?)
    ) SELECT r.id period, a.assignee_member_id member, MAX(COALESCE(NULLIF(m.display_name,''),NULLIF(a.assignee_label,''),'Unassigned')) label,
      COUNT(*) visits, SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END) completed,
      SUM(COALESCE(a.minutes,0)) minutes, SUM(CASE WHEN a.minutes IS NULL OR a.minutes<=0 THEN 1 ELSE 0 END) missing
      FROM windows r JOIN visits a ON substr(a.starts_at,1,10)>=r.start AND substr(a.starts_at,1,10)<r.end AND (r.id<>'upcoming' OR a.status<>'completed')
      LEFT JOIN trade_team_members m ON m.id=a.assignee_member_id AND m.owner_uid=a.firebase_uid GROUP BY r.id,a.assignee_member_id`).bind(...args, scheduleRanges, access.isOwner || access.scheduleScope === "team" ? 1 : 0, access.memberId),
    db.prepare(`${base}${native} SELECT
      SUM(CASE WHEN stage NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) open_jobs,
      SUM(CASE WHEN stage='blocked' THEN 1 ELSE 0 END) waiting,
      SUM(CASE WHEN stage NOT IN ('completed','cancelled') AND assignee_member_id='' THEN 1 ELSE 0 END) unassigned,
      SUM(CASE WHEN stage NOT IN ('completed','cancelled') AND NOT EXISTS (SELECT 1 FROM trade_crm_appointments a WHERE a.work_order_id=j.id AND a.firebase_uid=j.firebase_uid AND a.status IN ('scheduled','en_route','arrived','in_progress') AND substr(a.starts_at,1,10)>=?) THEN 1 ELSE 0 END) awaiting,
      SUM(CASE WHEN stage='completed' AND invoice_status IN ('not_started','draft') AND NOT EXISTS (SELECT 1 FROM native_invoices n WHERE n.work_order_id=j.id) AND NOT EXISTS (SELECT 1 FROM trade_crm_accounting_documents a WHERE a.work_order_id=j.id AND a.firebase_uid=j.firebase_uid AND a.document_type='invoice' AND a.status IN ('issued','part_paid','paid','overdue')) THEN 1 ELSE 0 END) uninvoiced,
      (SELECT COUNT(*) FROM trade_work_order_tasks t JOIN jobs k ON k.id=t.work_order_id AND k.firebase_uid=t.firebase_uid WHERE k.stage NOT IN ('completed','cancelled') AND t.status='pending' AND t.due_at<>'' AND substr(t.due_at,1,10)<?) overdue_tasks,
      (SELECT COUNT(*) FROM trade_crm_job_notes n JOIN jobs k ON k.id=n.work_order_id AND k.firebase_uid=n.firebase_uid WHERE k.stage<>'cancelled' AND n.note_type='issue' AND n.issue_status='open') issues
      FROM jobs j`).bind(...args, period.today, period.today),
    db.prepare(`${base} SELECT stage,COUNT(*) count FROM jobs GROUP BY stage`).bind(...args),
    db.prepare(`${base} SELECT DISTINCT service_category service,region FROM all_jobs ORDER BY service,region`).bind(...args),
  ]);
  const values = (id: string): ReportMeasures => {
    const totals = Object.fromEntries(results[0].results.filter(row => row.id === id).map(row => [String(row.kind), number(row.value)]));
    const visits = results[3].results.filter(row => row.period === id);
    const sum = (key: string) => visits.reduce((total, row) => total + number(row[key]), 0);
    return { newJobs: totals.newJobs || 0, completedJobs: totals.completedJobs || 0,
      quoteIssues: access.canViewQuotes ? totals.quoteIssues || 0 : null, wonQuotes: access.canViewQuotes ? totals.wonQuotes || 0 : null, declinedQuotes: access.canViewQuotes ? totals.declinedQuotes || 0 : null, wonCents: access.canViewQuotes ? totals.wonCents || 0 : null,
      invoicedCents: access.canViewInvoices ? (totals.invoicedCents || 0) - (totals.creditCents || 0) : null, creditCents: access.canViewInvoices ? totals.creditCents || 0 : null, invoiceCount: access.canViewInvoices ? totals.invoiceCount || 0 : null,
      bookedMinutes: sum("minutes"), visits: sum("visits"), completedVisits: sum("completed"), missingDurations: sum("missing") };
  };
  const breakdown = (key: "service" | "region") => {
    const groups = new Map<string, { key: string; newJobs: number; completedJobs: number; invoicedCents: number | null }>();
    for (const row of results[1].results) {
      const id = String(row[key] || "unknown"); const group = groups.get(id) || { key: id, newJobs: 0, completedJobs: 0, invoicedCents: access.canViewInvoices ? 0 : null };
      if (row.kind === "newJobs") group.newJobs += number(row.value);
      if (row.kind === "completedJobs") group.completedJobs += number(row.value);
      if (group.invoicedCents !== null && (row.kind === "invoicedCents" || row.kind === "creditCents")) group.invoicedCents += number(row.value) * (row.kind === "creditCents" ? -1 : 1);
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => b.newJobs - a.newJobs || a.key.localeCompare(b.key));
  };
  const members = new Map<string, BusinessReport["team"][number]>();
  for (const row of results[3].results.filter(row => row.period !== "previous")) {
    const key = String(row.member || ""); const member = members.get(key) || { key, label: String(row.label), visits: 0, completedVisits: 0, bookedMinutes: 0, upcomingVisits: 0, upcomingMinutes: 0, missingDurations: 0 };
    if (row.period === "current") { member.visits = number(row.visits); member.completedVisits = number(row.completed); member.bookedMinutes = number(row.minutes); member.missingDurations = number(row.missing); }
    else { member.upcomingVisits = number(row.visits); member.upcomingMinutes = number(row.minutes); }
    members.set(key, member);
  }
  const work = results[4].results[0] || {}; const balances = results[2].results;
  const sumBalance = (key: string) => balances.reduce((total, row) => total + number(row[key]), 0);
  return { generatedAt: now.toISOString(), period, service, state: region, permissions: { invoices: access.canViewInvoices, quotes: access.canViewQuotes },
    options: { services: [...new Set(results[6].results.map(row => String(row.service)))], states: [...new Set(results[6].results.map(row => String(row.region)))].sort() },
    current: values("current"), previous: values("previous"), trend: timeline.map((window, index) => ({ start: window.start, end: window.end, newJobs: values(`trend${index}`).newJobs, completedJobs: values(`trend${index}`).completedJobs, invoicedCents: values(`trend${index}`).invoicedCents })),
    services: breakdown("service"), regions: breakdown("region"), team: [...members.values()].sort((a, b) => b.bookedMinutes - a.bookedMinutes || a.label.localeCompare(b.label)),
    work: { openJobs: number(work.open_jobs), waitingJobs: number(work.waiting), unassignedJobs: number(work.unassigned), awaitingSchedule: number(work.awaiting), overdueTasks: number(work.overdue_tasks), openIssues: number(work.issues), completedUninvoiced: access.canViewInvoices ? number(work.uninvoiced) : null, stages: results[5].results.map(row => ({ key: String(row.stage), count: number(row.count) })) },
    receivables: access.canViewInvoices ? { outstandingCents: sumBalance("cents"), paidCents: sumBalance("paid"), undatedInvoiceCount: sumBalance("undated_count"), undatedInvoiceCents: sumBalance("undated_cents"), buckets: ["Not overdue","1 to 30 days","31 to 60 days","61 to 90 days","Over 90 days","No due date"].map(key => { const row = balances.find(row => row.bucket === key); return { key, count: number(row?.count), cents: number(row?.cents) }; }) } : null };
}
