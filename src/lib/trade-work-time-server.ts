import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { jobMemberSql } from "./trade-job-collaboration";
import { messageActorGuard } from "./trade-message-media-access";
import { readTradeCrewScope, readTradeCrewMemberIds } from "./trade-crews-server";
import { resolveReportPeriod, addReportDays } from "./trade-business-reports";
import { reconcileTradeFormJobProgress } from "./trade-form-job-progress";
import { formPageWindows, WorkTimeInputError, workTimeSeconds, type WorkTimeInterval, type WorkTimeSessionInput, type WorkTimeFormKind, type WorkTimeReport } from "./trade-work-time";

export class WorkTimeAccessError extends Error {}
export class WorkTimeConflictError extends Error {}
export class WorkTimeCapacityError extends WorkTimeInputError {
  constructor(readonly members: Array<{ id: string; display_name: string }>) { super("Choose a person to view this larger activity history."); }
}
type FormMeta = { key: string; title: string; completedAt: string };
type SessionRow = {
  id: string; member_id: string; kind: "app" | "form"; form_kind: WorkTimeFormKind | "";
  form_id: string; form_key: string; form_title: string; work_order_id: string;
  page_key: string; page_title: string;
  observed_completed_at: string;
  started_at: string; ended_at: string; member_name: string; work_number: string; job_title: string; job_status: string;
};

export async function workTimeFormMeta(db: D1Database, ownerUid: string, input: Pick<WorkTimeSessionInput, "formKind" | "formId" | "workOrderId">): Promise<FormMeta | null> {
  let row: { form_key: string; title: string; completed_at: string } | null = null;
  if (input.formKind === "job_form") row = await db.prepare(`SELECT id form_key,template_name title,completed_at FROM trade_job_forms
    WHERE id=? AND firebase_uid=? AND work_order_id=?`).bind(input.formId, ownerUid, input.workOrderId).first();
  else if (input.formKind === "activity_record") row = await db.prepare(`SELECT id form_key,
    COALESCE(json_extract(payload,'$.form.title'),'Activity form') title,submitted_at completed_at
    FROM trade_activity_field_records WHERE id=? AND owner_uid=? AND work_order_id=?`).bind(input.formId, ownerUid, input.workOrderId).first();
  else if (input.formKind === "rental_inspection") row = await db.prepare(`SELECT id form_key,'Rental inspection ' || inspection_number title,
    CASE WHEN submitted_at<>'' THEN submitted_at ELSE issued_at END completed_at
    FROM trade_rental_inspections WHERE id=? AND firebase_uid=? AND work_order_id=?`).bind(input.formId, ownerUid, input.workOrderId).first();
  else if (input.formKind === "work_pack") row = await db.prepare(`SELECT instance.instance_key form_key,
    'Activity work pack' title,COALESCE((SELECT MAX(final.finalised_at) FROM compliance_activity_work_pack_final_records final
      WHERE final.organisation_id=instance.organisation_id AND final.instance_key=instance.instance_key),'') completed_at
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases c ON c.id=instance.compliance_case_id AND c.organisation_id=instance.organisation_id AND c.work_order_id=instance.work_order_id
    WHERE instance.id=? AND c.installer_uid=? AND instance.work_order_id=?`).bind(input.formId, ownerUid, input.workOrderId).first();
  return row ? { key: `${input.formKind}:${input.workOrderId}:${row.form_key}`, title: row.title || "Job form", completedAt: row.completed_at || "" } : null;
}

function jobGuard(access: TeamAccess, workOrderId: string) {
  return { sql: `EXISTS (SELECT 1 FROM trade_work_orders timing_job WHERE timing_job.id=? AND timing_job.firebase_uid=?
    AND timing_job.partner_type='installer' AND timing_job.record_status='active' AND (?=1 OR ${jobMemberSql("timing_job")}))`,
  values: [workOrderId, access.ownerUid, access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId] };
}

/** Client-observed activity is operational evidence, never a payroll or physical-location attestation. */
export async function saveWorkTimeSessions(access: TeamAccess, sessions: WorkTimeSessionInput[], db = getD1(), now = new Date().toISOString()) {
  const actor = messageActorGuard(access);
  if (!await db.prepare(`SELECT 1 allowed WHERE ${actor.sql}`).bind(...actor.values).first()) throw new WorkTimeAccessError();
  const accepted: string[] = [];
  for (const session of sessions) {
    if (session.kind === "form" && !access.isOwner && !access.canManageFieldEvidence) throw new WorkTimeAccessError();
    const job = session.workOrderId ? jobGuard(access, session.workOrderId) : { sql: "1=1", values: [] };
    if (!await db.prepare(`SELECT 1 allowed WHERE ${job.sql}`).bind(...job.values).first()) throw new WorkTimeAccessError();
    const form = session.kind === "form" ? await workTimeFormMeta(db, access.ownerUid, session) : null;
    if (session.kind === "form" && !form) throw new WorkTimeConflictError("The form has not synced yet. Its activity will sync after the form is available.");
    const identity = [access.ownerUid, access.memberId, access.actorUid, session.kind, session.source, session.formKind, session.formId, session.workOrderId, session.startedAt, session.pageKey];
    const match = `owner_uid=? AND member_id=? AND actor_uid=? AND kind=? AND source=? AND form_kind=? AND form_id=? AND work_order_id=? AND started_at=? AND page_key=?`;
    const existing = await db.prepare(`SELECT 1 valid FROM trade_work_time_sessions WHERE id=? AND ${match}`).bind(session.id, ...identity).first();
    if (!existing && await db.prepare("SELECT 1 existing FROM trade_work_time_sessions WHERE id=?").bind(session.id).first()) throw new WorkTimeConflictError("This activity reference belongs to a different session.");
    await db.prepare(`INSERT INTO trade_work_time_sessions
      (id,owner_uid,member_id,actor_uid,kind,source,form_kind,form_id,work_order_id,started_at,ended_at,form_key,form_title,received_at,updated_at,page_key,page_title,observed_completed_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.sql} AND ${job.sql}
      ON CONFLICT(id) DO UPDATE SET ended_at=MAX(ended_at,excluded.ended_at),observed_completed_at=MAX(observed_completed_at,excluded.observed_completed_at),updated_at=CASE WHEN excluded.ended_at>ended_at THEN excluded.updated_at ELSE updated_at END
      WHERE ${match} AND (observed_completed_at='' OR excluded.ended_at<=ended_at) AND ${actor.sql} AND ${job.sql}`)
      .bind(session.id, ...identity.slice(0, 8), session.startedAt, session.endedAt, form?.key || "", form?.title || "", now, now, session.pageKey, session.pageTitle, session.completedAt || "",
        ...actor.values, ...job.values, ...identity, ...actor.values, ...job.values).run();
    if (!await db.prepare(`SELECT 1 valid FROM trade_work_time_sessions WHERE id=? AND ${match} AND ended_at>=? AND ${actor.sql} AND ${job.sql}`)
      .bind(session.id, ...identity, session.endedAt, ...actor.values, ...job.values).first()) throw new WorkTimeAccessError();
    accepted.push(session.id);
  }
  const currentForms = new Set(sessions.filter(session => session.kind === "form").map(session => session.workOrderId));
  // A co-worker may complete the final form later. Revisit this person's saved
  // finish markers on subsequent authenticated activity without adding a button
  // or borrowing another person's authority. Rotate large backlogs fairly.
  const recoverySql = `FROM trade_work_time_sessions s JOIN trade_work_orders w ON w.id=s.work_order_id AND w.firebase_uid=s.owner_uid
    WHERE s.owner_uid=? AND s.member_id=? AND s.observed_completed_at<>'' AND w.record_status='active'
      AND w.partner_type='installer' AND w.stage NOT IN ('imported','completed','cancelled')
      AND (w.assignee_member_id=? OR (?=1 AND w.assignee_member_id='') OR EXISTS (
        SELECT 1 FROM trade_crm_appointments a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid
          AND a.assignee_member_id=? AND a.status IN ('scheduled','en_route','arrived','in_progress'))) AND ${actor.sql}`;
  const recoveryValues = [access.ownerUid, access.memberId, access.memberId, access.isOwner ? 1 : 0, access.memberId, ...actor.values];
  const count = Number((await db.prepare(`SELECT COUNT(DISTINCT s.work_order_id) count ${recoverySql}`).bind(...recoveryValues).first<{ count: number }>())?.count || 0);
  const page = count ? Math.floor(Date.parse(now) / 30_000) % Math.ceil(count / 20) : 0;
  const recovery = count ? (await db.prepare(`SELECT DISTINCT s.work_order_id ${recoverySql} ORDER BY s.work_order_id LIMIT 20 OFFSET ?`)
    .bind(...recoveryValues, page * 20).all<{ work_order_id: string }>()).results : [];
  const completedJobs = new Set([...sessions.filter(session => session.completedAt).map(session => session.workOrderId), ...recovery.map(row => row.work_order_id)]);
  for (const workOrderId of new Set([...currentForms, ...completedJobs])) {
    // A durable completion marker also retries a previously interrupted status
    // projection. All actual form/evidence authority is rechecked by the helper.
    const progress = await reconcileTradeFormJobProgress(access, workOrderId, { startOnly: !completedJobs.has(workOrderId), db, now });
    if (progress?.pending) throw new WorkTimeConflictError("Work activity is saved. Job status is waiting to sync.");
  }
  return accepted;
}

/** Scope is derived on every read so moving or removing crew members revokes reporting access immediately. */
export async function loadWorkTimeReport(access: TeamAccess, params: URLSearchParams, db = getD1(), now = new Date()): Promise<WorkTimeReport> {
  const actor = messageActorGuard(access);
  const crew = await readTradeCrewScope(access, db);
  const all = access.isOwner || (!crew && access.canManageTeam);
  const allowed = all ? [] : crew?.isLead ? await readTradeCrewMemberIds(access, db) : [access.memberId];
  const memberId = params.get("memberId") || "", workOrderId = params.get("workOrderId") || "";
  if (memberId && !all && !allowed.includes(memberId)) throw new WorkTimeAccessError();
  if (workOrderId) {
    const job = jobGuard(access, workOrderId);
    if (!await db.prepare(`SELECT 1 allowed WHERE ${job.sql}`).bind(...job.values).first()) throw new WorkTimeAccessError();
  }
  const account = await db.prepare("SELECT address_state FROM trade_accounts WHERE firebase_uid=?").bind(access.ownerUid).first<{ address_state: string }>();
  const period = resolveReportPeriod(new URLSearchParams({ period: "weekly", ...(params.get("week") ? { anchor: params.get("week")! } : {}) }), account?.address_state || "NSW", now);
  const memberScope = memberId ? [memberId] : allowed;
  const members = (await db.prepare(`SELECT id,display_name FROM trade_team_members WHERE owner_uid=?
    AND (?=1 OR id IN (SELECT value FROM json_each(?))) AND ${actor.sql} ORDER BY display_name,id`)
    .bind(access.ownerUid, all && !memberId ? 1 : 0, JSON.stringify(memberScope), ...actor.values).all<{ id: string; display_name: string }>()).results;
  if (!members.length && !await db.prepare(`SELECT 1 allowed WHERE ${actor.sql}`).bind(...actor.values).first()) throw new WorkTimeAccessError();
  const rows = (await db.prepare(`SELECT s.*,m.display_name member_name,COALESCE(w.work_number,'') work_number,
    CASE WHEN w.source_type='opportunity' OR d.customer_source='platform_private' THEN 'Protected job' ELSE COALESCE(w.title,'Job') END job_title,
    COALESCE(w.stage,'') job_status
    FROM trade_work_time_sessions s JOIN trade_team_members m ON m.id=s.member_id AND m.owner_uid=s.owner_uid
    LEFT JOIN trade_work_orders w ON w.id=s.work_order_id AND w.firebase_uid=s.owner_uid AND w.record_status='active'
    LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE s.owner_uid=? AND s.member_id IN (SELECT value FROM json_each(?)) AND s.ended_at>=? AND s.started_at<?
      AND (?='' OR s.work_order_id=?) AND (s.work_order_id='' OR (w.id IS NOT NULL AND (?=1 OR ${jobMemberSql("w")})))
      AND ${actor.sql} ORDER BY s.started_at,s.id LIMIT 30001`)
    .bind(access.ownerUid, JSON.stringify(members.map(member => member.id)), period.startUtc, period.endUtc, workOrderId, workOrderId,
      access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId, ...actor.values).all<SessionRow>()).results;
  if (rows.length > 30000) throw new WorkTimeCapacityError(members);
  const intervals = (values: SessionRow[]) => values.map(value => ({ startedAt: value.started_at, endedAt: value.ended_at }));
  const seconds = (values: SessionRow[]) => workTimeSeconds(intervals(values), period.startUtc, period.endUtc);
  const summaries = members.map(member => {
    const own = rows.filter(row => row.member_id === member.id);
    return { memberId: member.id, name: member.display_name, appSeconds: seconds(own),
      formSeconds: seconds(own.filter(row => row.kind === "form")), jobSeconds: seconds(own.filter(row => row.work_order_id !== "")),
      workSeconds: 0, jobs: new Set(own.filter(row => row.work_order_id).map(row => row.work_order_id)).size };
  });
  const jobs: WorkTimeReport["jobs"] = [];
  const forms: WorkTimeReport["forms"] = [];
  const groupedJobs = new Map<string, SessionRow[]>();
  for (const row of rows) {
    if (row.work_order_id) { const key = `${row.member_id}:${row.work_order_id}`; groupedJobs.set(key, [...(groupedJobs.get(key) || []), row]); }
  }
  for (const group of groupedJobs.values()) {
    const first = group[0], last = group.reduce((latest, row) => row.ended_at > latest.ended_at ? row : latest);
    jobs.push({ memberId: first.member_id, memberName: first.member_name, workOrderId: first.work_order_id, workNumber: first.work_number,
      title: first.job_title, status: first.job_status, firstStartedAt: first.started_at, lastActiveAt: last.ended_at, activeSeconds: seconds(group), elapsedSeconds: 0 });
  }
  const history = (await db.prepare(`SELECT s.*,m.display_name member_name,w.work_number,
    CASE WHEN w.source_type='opportunity' OR d.customer_source='platform_private' THEN 'Protected job' ELSE COALESCE(w.title,'Job') END job_title,
    w.stage job_status FROM trade_work_time_sessions s
    JOIN trade_team_members m ON m.id=s.member_id AND m.owner_uid=s.owner_uid
    JOIN trade_work_orders w ON w.id=s.work_order_id AND w.firebase_uid=s.owner_uid AND w.record_status='active'
    LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    LEFT JOIN trade_job_forms jf ON s.form_kind='job_form' AND jf.id=s.form_id AND jf.firebase_uid=s.owner_uid AND jf.work_order_id=s.work_order_id
    LEFT JOIN trade_activity_field_records af ON s.form_kind='activity_record' AND af.id=s.form_id AND af.owner_uid=s.owner_uid AND af.work_order_id=s.work_order_id
    LEFT JOIN trade_rental_inspections ri ON s.form_kind='rental_inspection' AND ri.id=s.form_id AND ri.firebase_uid=s.owner_uid AND ri.work_order_id=s.work_order_id
    LEFT JOIN compliance_activity_work_pack_instances wi ON s.form_kind='work_pack' AND wi.id=s.form_id AND wi.work_order_id=s.work_order_id
    WHERE s.owner_uid=? AND s.kind='form' AND EXISTS (SELECT 1 FROM trade_work_time_sessions origin
      WHERE origin.owner_uid=s.owner_uid AND origin.form_key=s.form_key AND origin.started_at<?) AND (?='' OR s.work_order_id=?)
      AND COALESCE(NULLIF(jf.completed_at,''),NULLIF(af.submitted_at,''),NULLIF(ri.submitted_at,''),NULLIF(ri.issued_at,''),
        (SELECT MAX(wf.finalised_at) FROM compliance_activity_work_pack_final_records wf WHERE wf.organisation_id=wi.organisation_id AND wf.instance_key=wi.instance_key),?)>=?
      AND s.member_id IN (SELECT value FROM json_each(?)) AND (?=1 OR ${jobMemberSql("w")}) AND ${actor.sql}
    ORDER BY s.started_at,s.id LIMIT 30001`)
    .bind(access.ownerUid, period.endUtc, workOrderId, workOrderId, now.toISOString(), period.startUtc, JSON.stringify(members.map(member => member.id)),
      access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId, ...actor.values).all<SessionRow>()).results;
  if (history.length > 30000) throw new WorkTimeCapacityError(members);
  const lifetimeSeconds = (values: SessionRow[]) => workTimeSeconds(intervals(values), "1970-01-01T00:00:00.000Z", "9999-12-31T00:00:00.000Z");
  const workWindows = new Map<string, WorkTimeInterval[]>();
  const memberWindows = new Map<string, WorkTimeInterval[]>();
  for (const key of new Set(history.map(row => row.form_key))) {
    const group = history.filter(row => row.form_key === key);
    if (!group.length) continue;
    const first = group[0], last = group.reduce((latest, row) => row.ended_at > latest.ended_at ? row : latest);
    const kind = first.form_kind;
    if (!kind) continue;
    const meta = await workTimeFormMeta(db, access.ownerUid, { formKind: kind, formId: last.form_id, workOrderId: first.work_order_id });
    if (!meta) continue;
    // Completion belongs to the form. Another authorised contributor may have
    // finished it offline; filtering the people view must not reintroduce sync delay.
    const boundary = await db.prepare(`SELECT MAX(started_at) latest_start,MAX(observed_completed_at) completed_at
      FROM trade_work_time_sessions WHERE owner_uid=? AND form_key=?`)
      .bind(access.ownerUid, key).first<{ latest_start: string; completed_at: string }>();
    const latestStart = boundary?.latest_start || "";
    const observedCompletion = boundary?.completed_at || "";
    const workFinishedAt = meta.completedAt ? observedCompletion >= latestStart ? observedCompletion : meta.completedAt : "";
    const memberIds = [...new Set(group.map(row => row.member_id))];
    const pageWindows = memberIds.flatMap(id => {
      const own = group.filter(row => row.member_id === id);
      const windows = formPageWindows(own.map(row => ({ pageKey: row.page_key, startedAt: row.started_at, endedAt: row.ended_at })), workFinishedAt, now.toISOString());
      const jobKey = `${id}:${first.work_order_id}`;
      workWindows.set(jobKey, [...(workWindows.get(jobKey) || []), ...windows]);
      memberWindows.set(id, [...(memberWindows.get(id) || []), ...windows]);
      if (!jobs.some(job => job.memberId === id && job.workOrderId === first.work_order_id)) jobs.push({ memberId: id, memberName: own[0].member_name,
        workOrderId: first.work_order_id, workNumber: first.work_number, title: first.job_title, status: first.job_status,
        firstStartedAt: own[0].started_at, lastActiveAt: own[own.length - 1].ended_at, activeSeconds: 0, elapsedSeconds: 0 });
      return windows;
    });
    const pages = [...new Set(group.map(row => row.page_key))].map(key => {
      const entries = group.filter(row => row.page_key === key);
      return { key, title: entries[entries.length - 1].page_title, firstStartedAt: entries[0].started_at,
        lastActiveAt: entries.reduce((latest, row) => row.ended_at > latest ? row.ended_at : latest, ""),
        activeSeconds: memberIds.reduce((total, id) => total + lifetimeSeconds(entries.filter(row => row.member_id === id)), 0),
        elapsedSeconds: workTimeSeconds(pageWindows.filter(window => window.pageKey === key), "1970-01-01T00:00:00.000Z", now.toISOString()),
        weekSeconds: memberIds.reduce((total, id) => total + seconds(entries.filter(row => row.member_id === id)), 0) };
    });
    forms.push({ key: first.form_key, formId: last.form_id, formKind: kind, title: meta?.title || first.form_title, pages,
      workOrderId: first.work_order_id, workNumber: first.work_number, members: [...new Set(group.map(row => row.member_name))],
      activeSeconds: memberIds.reduce((total, id) => total + lifetimeSeconds(group.filter(row => row.member_id === id)), 0),
      weekSeconds: memberIds.reduce((total, id) => total + seconds(group.filter(row => row.member_id === id)), 0),
      elapsedSeconds: workTimeSeconds(pageWindows, "1970-01-01T00:00:00.000Z", now.toISOString()),
      weekElapsedSeconds: workTimeSeconds(pageWindows, period.startUtc, period.endUtc),
      firstStartedAt: first.started_at, lastActiveAt: last.ended_at, completedAt: meta.completedAt, workFinishedAt });
  }
  for (const job of jobs) job.elapsedSeconds = workTimeSeconds(workWindows.get(`${job.memberId}:${job.workOrderId}`) || [], period.startUtc, period.endUtc);
  for (const person of summaries) {
    person.workSeconds = workTimeSeconds(memberWindows.get(person.memberId) || [], period.startUtc, period.endUtc);
    person.jobs = jobs.filter(job => job.memberId === person.memberId).length;
  }
  return { generatedAt: now.toISOString(), weekStart: period.start, weekEnd: addReportDays(period.start, 6), timeZone: period.timeZone,
    scope: all ? "business" : crew?.isLead ? "crew" : "self", members: summaries,
    forms: forms.sort((a,b) => b.lastActiveAt.localeCompare(a.lastActiveAt)), jobs: jobs.sort((a,b) => b.lastActiveAt.localeCompare(a.lastActiveAt)) };
}
