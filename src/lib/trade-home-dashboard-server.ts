import { addReportDays, resolveReportPeriod } from "./trade-business-reports.ts";
import { loadBusinessReport, type ReportAccess } from "./trade-business-reports-server.ts";
import { jobMemberSql } from "./trade-job-collaboration.ts";
import { crewScheduleMemberIds } from "./trade-crews.ts";
import { tradeJobNeedsSchedulingSql } from "./trade-job-scheduling-attention.ts";
import { HOME_REVENUE_PERIODS, type HomeDashboard, type HomeJobReference } from "./trade-home-dashboard.ts";

type HomeAccess = ReportAccess & { canRunReports: boolean };
type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value || 0);
const activeStages = "('imported','completed','cancelled')";
const activeVisits = "('scheduled','en_route','arrived','in_progress')";
const base = `WITH jobs AS MATERIALIZED (
  SELECT w.id,w.firebase_uid,w.work_number,w.title job_title,w.stage,w.source_type,d.customer_source,
    d.crm_customer_id,d.pipeline_stage,d.quote_status
  FROM trade_work_orders w
  LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
    AND COALESCE(d.pipeline_stage,'') <> 'lost'
    AND (?=1 OR ${jobMemberSql("w")})
)`;
const visits = `, visits AS MATERIALIZED (
  SELECT a.*,j.work_number,j.job_title,j.source_type,j.customer_source,
    MAX(0,ROUND((julianday(a.ends_at)-julianday(a.starts_at))*1440)) booked_minutes
  FROM trade_crm_appointments a JOIN jobs j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid
  WHERE j.stage NOT IN ('imported','cancelled')
    AND a.status IN ('scheduled','en_route','arrived','in_progress','completed')
    AND date(a.starts_at) IS NOT NULL AND (?=1 OR a.assignee_member_id IN (SELECT value FROM json_each(?)))
)`;

function jobReference(row: Row): HomeJobReference {
  const protectedContext = row.source_type === "opportunity" || row.customer_source === "platform_private";
  return { id: String(row.work_order_id), workNumber: String(row.work_number || ""),
    title: protectedContext ? "Protected job" : String(row.job_title || ""), protected: protectedContext };
}

/** Approved users get only their existing job and schedule scopes, independently of report access. */
export async function loadHomeDashboard(db: Pick<D1Database, "prepare" | "batch">, uid: string, access: HomeAccess,
  params: URLSearchParams, state = "NSW", now = new Date()): Promise<HomeDashboard> {
  const selectedPeriod = HOME_REVENUE_PERIODS.find(option => option.value === params.get("period"));
  const reportParams = new URLSearchParams(params);
  if (selectedPeriod?.previous) {
    reportParams.set("period", selectedPeriod.preset);
    reportParams.delete("anchor");
    // Anchor in the previous calendar period so reports return all of it, not a to-date comparison.
    const current = resolveReportPeriod(reportParams, state, now);
    reportParams.set("anchor", addReportDays(current.start, -1));
  }
  // Validate the selected reporting window even when financial data is unavailable.
  const period = resolveReportPeriod(reportParams, state, now);
  const today = period.today;
  const monday = addReportDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 4 }, (_, index) => ({
    weekStart: addReportDays(monday, index * 7), weekEnd: addReportDays(monday, index * 7 + 6),
  }));
  const args = [uid, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId];
  const scheduleMemberIds = crewScheduleMemberIds(access);
  const visitArgs = [...args, scheduleMemberIds === null ? 1 : 0, JSON.stringify(scheduleMemberIds || [])];
  const results = await db.batch<Row>([
    db.prepare(`${base} SELECT
      COUNT(CASE WHEN stage NOT IN ${activeStages} THEN 1 END) open_jobs,
      COUNT(CASE WHEN stage='blocked' THEN 1 END) waiting_jobs,
      COUNT(CASE WHEN ${tradeJobNeedsSchedulingSql("j", "j")} THEN 1 END) awaiting_schedule,
      (SELECT COUNT(*) FROM trade_work_order_tasks t JOIN jobs k ON k.id=t.work_order_id AND k.firebase_uid=t.firebase_uid
        WHERE k.stage NOT IN ${activeStages} AND t.status='pending' AND date(t.due_at) IS NOT NULL AND substr(t.due_at,1,10)<?) overdue_tasks,
      (SELECT COUNT(*) FROM trade_crm_job_notes n JOIN jobs k ON k.id=n.work_order_id AND k.firebase_uid=n.firebase_uid
        WHERE k.stage NOT IN ('imported','cancelled') AND n.note_type='issue' AND n.issue_status='open') open_issues
      FROM jobs j`).bind(...args, today, today),
    db.prepare(`${base}${visits}, ranges AS (
      SELECT json_extract(value,'$.weekStart') start,json_extract(value,'$.weekEnd') end FROM json_each(?)
    ) SELECT r.start,COUNT(DISTINCT a.work_order_id) jobs,COUNT(a.id) visits,
      COALESCE(SUM(a.booked_minutes),0) booked_minutes,
      COUNT(CASE WHEN a.id IS NOT NULL AND (a.booked_minutes IS NULL OR a.booked_minutes<=0) THEN 1 END) missing_durations
      FROM ranges r LEFT JOIN visits a ON substr(a.starts_at,1,10)>=r.start AND substr(a.starts_at,1,10)<=r.end
      GROUP BY r.start ORDER BY r.start`).bind(...visitArgs, JSON.stringify(weeks)),
    db.prepare(`${base}${visits} SELECT COUNT(DISTINCT work_order_id) jobs,COUNT(*) visits
      FROM visits WHERE substr(starts_at,1,10)=?`).bind(...visitArgs, today),
    db.prepare(`${base} SELECT stage,COUNT(*) count FROM jobs WHERE stage NOT IN ${activeStages} GROUP BY stage`).bind(...args),
    db.prepare(`${base}${visits} SELECT id,work_order_id,work_number,job_title,source_type,customer_source,
      appointment_type,title,starts_at,ends_at,assignee_label,status
      FROM visits WHERE status IN ${activeVisits} AND substr(starts_at,1,10)>=?
      ORDER BY starts_at,id LIMIT 6`).bind(...visitArgs, today),
    db.prepare(`${base} SELECT t.id,t.work_order_id,t.title,t.due_at,t.status,j.work_number,j.job_title,j.source_type,j.customer_source
      FROM trade_work_order_tasks t JOIN jobs j ON j.id=t.work_order_id AND j.firebase_uid=t.firebase_uid
      WHERE j.stage NOT IN ${activeStages} AND t.status='pending' AND date(t.due_at) IS NOT NULL AND substr(t.due_at,1,10)<?
      ORDER BY t.due_at,t.id LIMIT 5`).bind(...args, today),
    db.prepare(`${base} SELECT n.id,n.work_order_id,n.body,n.created_at,j.work_number,j.job_title,j.source_type,j.customer_source
      FROM trade_crm_job_notes n JOIN jobs j ON j.id=n.work_order_id AND j.firebase_uid=n.firebase_uid
      WHERE j.stage NOT IN ('imported','cancelled') AND n.note_type='issue' AND n.issue_status='open'
      ORDER BY n.updated_at DESC,n.id LIMIT 5`).bind(...args),
  ]);
  const workload = weeks.map(week => {
    const row = results[1].results.find(value => value.start === week.weekStart);
    return { ...week, jobs: number(row?.jobs), visits: number(row?.visits),
      bookedMinutes: number(row?.booked_minutes), missingDurations: number(row?.missing_durations) };
  });
  const metrics = results[0].results[0] || {};
  const todayCounts = results[2].results[0] || {};
  return {
    generatedAt: now.toISOString(), today, timeZone: period.timeZone,
    metrics: { openJobs: number(metrics.open_jobs), waitingJobs: number(metrics.waiting_jobs),
      awaitingSchedule: number(metrics.awaiting_schedule), todayJobs: number(todayCounts.jobs), todayVisits: number(todayCounts.visits),
      thisWeekJobs: workload[0].jobs, thisWeekVisits: workload[0].visits, nextWeekJobs: workload[1].jobs,
      nextWeekVisits: workload[1].visits, overdueTasks: number(metrics.overdue_tasks), openIssues: number(metrics.open_issues) },
    workload, workStages: Object.fromEntries(results[3].results.map(row => [String(row.stage), number(row.count)])),
    upcomingAppointments: results[4].results.map(row => {
      const job = jobReference(row);
      return { id: String(row.id), appointmentType: String(row.appointment_type || ""),
        title: job.protected ? "Scheduled work" : String(row.title || ""), startsAt: String(row.starts_at), endsAt: String(row.ends_at || ""),
        assigneeLabel: String(row.assignee_label || ""), status: String(row.status), job };
    }),
    overdueTasks: results[5].results.map(row => {
      const job = jobReference(row);
      return { id: String(row.id), title: job.protected ? "Assigned task" : String(row.title || ""),
        dueAt: String(row.due_at), status: String(row.status), job };
    }),
    openIssues: results[6].results.map(row => {
      const job = jobReference(row);
      return { id: String(row.id), body: job.protected ? "Protected job issue" : String(row.body || ""), createdAt: String(row.created_at), job };
    }),
    financial: access.isOwner || (access.canRunReports && access.canViewInvoices)
      ? await loadBusinessReport(db, uid, access, reportParams, state, now) : null,
  };
}
