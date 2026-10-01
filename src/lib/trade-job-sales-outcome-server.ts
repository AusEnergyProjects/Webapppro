import { tradeJobHasProgressSql } from "./trade-job-lifecycle.ts";
import { creditexJobEverCompletedSql } from "./creditex-job-lifecycle-sql.ts";
import { jobMemberSql } from "./trade-job-collaboration.ts";
import { messageActorGuard } from "./trade-message-media-access.ts";
import { guardedOnlineJobMutationBatch, jobSyncChangeStatements, nextJobRevision } from "./trade-team-sync-server.ts";
import type { TeamAccess } from "./trade-team-server";

export type JobSalesOutcome = { canMarkLost: boolean; canReopen: boolean; reason?: string; lostReason?: string; lostAt?: string };
export class JobSalesOutcomeError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

// This expression is shared by the displayed capabilities and the transaction guard.
// Quote visits are sales activity; only a live visit or performed trade work blocks loss.
const BLOCKER_SQL = `CASE
  WHEN w.stage = 'imported' OR d.pipeline_stage = 'imported' THEN 'Start this imported job in TLink before changing its sales outcome.'
  WHEN w.stage IN ('in_progress','completed') OR d.pipeline_stage IN ('approved','in_progress','complete','invoiced','paid')
    OR d.quote_status = 'accepted'
    OR EXISTS (SELECT 1 FROM trade_crm_quotes q WHERE q.work_order_id=w.id AND q.firebase_uid=w.firebase_uid AND q.status='accepted')
    OR EXISTS (SELECT 1 FROM trade_crm_quote_acceptances a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid AND a.decision='accepted')
    OR EXISTS (SELECT 1 FROM trade_crm_commercial_handovers h WHERE h.work_order_id=w.id AND h.firebase_uid=w.firebase_uid)
    THEN 'Awarded or started work cannot be marked as lost.'
  WHEN COALESCE(d.invoice_status,'not_started') <> 'not_started' OR COALESCE(d.invoiced_value_cents,0)>0 OR COALESCE(d.paid_value_cents,0)>0
    OR EXISTS (SELECT 1 FROM trade_crm_quick_invoices i WHERE i.work_order_id=w.id AND i.firebase_uid=w.firebase_uid)
    OR EXISTS (SELECT 1 FROM trade_crm_accepted_invoices i WHERE i.work_order_id=w.id AND i.firebase_uid=w.firebase_uid)
    OR EXISTS (SELECT 1 FROM trade_crm_accounting_documents i WHERE i.work_order_id=w.id AND i.firebase_uid=w.firebase_uid AND i.document_type='invoice')
    THEN 'This job has invoice or payment records. Review its financial records instead.'
  WHEN EXISTS (SELECT 1 FROM trade_crm_appointments a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid
    AND a.status IN ('scheduled','en_route','arrived','in_progress'))
    THEN 'Cancel or review the active visit before marking this job as lost.'
  WHEN ${tradeJobHasProgressSql("w")} OR ${creditexJobEverCompletedSql("w")}
    OR EXISTS (SELECT 1 FROM trade_crm_time_entries t WHERE t.work_order_id=w.id AND t.firebase_uid=w.firebase_uid)
    OR EXISTS (SELECT 1 FROM trade_crm_signoffs s WHERE s.work_order_id=w.id AND s.firebase_uid=w.firebase_uid)
    OR EXISTS (SELECT 1 FROM trade_crm_job_media m WHERE m.work_order_id=w.id AND m.firebase_uid=w.firebase_uid AND m.category IN ('progress','after'))
    OR EXISTS (SELECT 1 FROM trade_crm_appointments a WHERE a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid
      AND a.status='completed' AND a.appointment_type NOT IN ('phone_call','quote_review','site_visit'))
    THEN 'This job has recorded work or completed forms. Keep its work history in the active job workflow.'
  WHEN EXISTS (SELECT 1 FROM trade_follow_up_messages m WHERE m.work_order_id=w.id AND m.owner_uid=w.firebase_uid AND m.status='sending')
    OR EXISTS (SELECT 1 FROM trade_crm_quote_deliveries m WHERE m.work_order_id=w.id AND m.firebase_uid=w.firebase_uid AND m.status='sending')
    OR EXISTS (SELECT 1 FROM trade_crm_quote_versions v JOIN trade_crm_quotes q ON q.id=v.quote_id AND q.firebase_uid=v.firebase_uid
      WHERE q.work_order_id=w.id AND q.firebase_uid=w.firebase_uid AND v.status='issuing')
    THEN 'A customer message is being sent. Wait for its result, then try again.'
  ELSE '' END`;

function salesAuthority(access: TeamAccess) {
  const actor = messageActorGuard(access);
  return { sql: `${actor.sql} AND EXISTS (SELECT 1 FROM trade_team_members sales_actor
    WHERE sales_actor.id=? AND sales_actor.owner_uid=w.firebase_uid
      AND (sales_actor.member_uid=sales_actor.owner_uid OR sales_actor.can_manage_jobs=1)
      AND NOT EXISTS (SELECT 1 FROM trade_crew_members crew WHERE crew.owner_uid=sales_actor.owner_uid AND crew.member_id=sales_actor.id)
      AND (sales_actor.member_uid=sales_actor.owner_uid OR sales_actor.job_scope='team' OR ${jobMemberSql("w", "sales_actor.id")}))`,
  values: [...actor.values, access.memberId] };
}

const JOB_FROM = `FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid`;
const LOST_EVENT_SELECT = `CASE WHEN d.pipeline_stage='lost' THEN (SELECT e.summary FROM trade_work_order_events e
  WHERE e.work_order_id=w.id AND e.firebase_uid=w.firebase_uid AND e.event_type='job_marked_lost' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) ELSE '' END lost_summary,
  CASE WHEN d.pipeline_stage='lost' THEN (SELECT e.created_at FROM trade_work_order_events e
  WHERE e.work_order_id=w.id AND e.firebase_uid=w.firebase_uid AND e.event_type='job_marked_lost' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) ELSE '' END lost_at`;
type OutcomeRow = { id: string; stage: string; pipeline_stage: string; revision: number; assignee_member_id: string; blocker: string; allowed: number; lost_summary: string; lost_at: string };
function capabilities(row: OutcomeRow): JobSalesOutcome {
  const reasonIndex = String(row.lost_summary || "").indexOf(" Reason: ");
  const lost = row.pipeline_stage === "lost" && row.lost_at ? { lostAt: row.lost_at,
    ...(reasonIndex >= 0 ? { lostReason: row.lost_summary.slice(reasonIndex + " Reason: ".length) } : {}) } : {};
  const reason = !row.allowed ? "Your current team access does not allow sales outcome changes." : row.blocker;
  if (reason) return { canMarkLost: false, canReopen: false, reason, ...lost };
  return { canMarkLost: row.pipeline_stage !== "lost" && row.stage !== "cancelled", canReopen: row.pipeline_stage === "lost", ...lost };
}

/** Enrich only the requested page, avoiding extra joins in the large register query. */
export async function loadJobSalesOutcomes(db: D1Database, access: TeamAccess, workOrderIds: string[]) {
  const outcomes: Record<string, JobSalesOutcome> = {};
  if (!workOrderIds.length) return outcomes;
  const authority = salesAuthority(access);
  const result = await db.prepare(`SELECT w.id,w.stage,w.revision,w.assignee_member_id,d.pipeline_stage,
      CASE WHEN ${authority.sql} THEN 1 ELSE 0 END allowed, ${BLOCKER_SQL} blocker, ${LOST_EVENT_SELECT}
    ${JOB_FROM} WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
      AND w.id IN (SELECT value FROM json_each(?))`)
    .bind(...authority.values, access.ownerUid, JSON.stringify(workOrderIds)).all<OutcomeRow>();
  for (const row of result.results) outcomes[row.id] = capabilities(row);
  return outcomes;
}

export async function changeJobSalesOutcome(db: D1Database, access: TeamAccess,
  input: { action: "mark_job_lost" | "reopen_lost_job"; workOrderId: string; expectedRevision: unknown; reason?: string },
  now = new Date().toISOString()) {
  if (access.crewId || (!access.isOwner && !access.canManageJobs)) throw new JobSalesOutcomeError("Your current team access does not allow sales outcome changes.", 403);
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new Error("REVISION_CONFLICT");
  const authority = salesAuthority(access);
  const row = await db.prepare(`SELECT w.id,w.stage,w.revision,w.assignee_member_id,d.pipeline_stage,
      CASE WHEN ${authority.sql} THEN 1 ELSE 0 END allowed, ${BLOCKER_SQL} blocker, ${LOST_EVENT_SELECT}
    ${JOB_FROM} WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'`)
    .bind(...authority.values, input.workOrderId, access.ownerUid).first<OutcomeRow>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  if (!row.allowed) throw new JobSalesOutcomeError("Your current team access does not allow sales outcome changes.", 403);
  if (Number(row.revision) !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const reopen = input.action === "reopen_lost_job";
  const permitted = capabilities(row);
  if (!(reopen ? permitted.canReopen : permitted.canMarkLost)) throw new JobSalesOutcomeError(permitted.reason || (reopen ? "This job is not in the Lost archive." : "This job is already closed."));
  const revision = nextJobRevision(row.revision);
  const stage = reopen ? "backlog" : "cancelled";
  const reason = String(input.reason || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  await guardedOnlineJobMutationBatch(db, [
    db.prepare(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at)
      SELECT ?,?,?,'online_mutation_guard',NULL,? WHERE NOT EXISTS (SELECT 1 ${JOB_FROM}
        WHERE w.id=? AND w.firebase_uid=? AND w.record_status='active' AND w.partner_type='installer'
          AND w.revision=? AND w.stage=? AND d.pipeline_stage=? AND ${authority.sql} AND (${BLOCKER_SQL})='')`)
      .bind(crypto.randomUUID(), row.id, access.ownerUid, now, row.id, access.ownerUid, row.revision, row.stage, row.pipeline_stage, ...authority.values),
    db.prepare(`UPDATE trade_work_orders SET stage=?,scheduled_start='',scheduled_end='',revision=?,updated_at=? WHERE id=? AND firebase_uid=?`)
      .bind(stage, revision, now, row.id, access.ownerUid),
    db.prepare(`UPDATE trade_crm_job_details SET pipeline_stage=?,updated_at=? WHERE work_order_id=? AND firebase_uid=?`)
      .bind(reopen ? "enquiry" : "lost", now, row.id, access.ownerUid),
    ...(!reopen ? [
      db.prepare(`UPDATE trade_crm_quote_links SET status='revoked',revoked_at=?,updated_at=?
        WHERE work_order_id=? AND firebase_uid=? AND status='active'`).bind(now, now, row.id, access.ownerUid),
      db.prepare(`UPDATE trade_follow_up_messages SET status='cancelled',error='Stopped because the job was marked as lost.',
        next_attempt_at='',lease_token='',lease_expires_at='',updated_at=? WHERE work_order_id=? AND owner_uid=? AND status IN ('queued','failed')`)
        .bind(now, row.id, access.ownerUid),
    ] : []),
    db.prepare(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at) VALUES (?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), row.id, access.ownerUid, reopen ? "job_reopened" : "job_marked_lost",
        `${reopen ? "Opportunity reopened" : "Marked as lost"} by ${access.actorUid || access.memberId}.${reason ? ` Reason: ${reason}` : ""}`, now),
    ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: row.id, revision, changedAt: now, audienceMemberId: row.assignee_member_id }),
  ], { kind: "stage", ownerUid: access.ownerUid, workOrderId: row.id, jobStage: stage, jobRevision: revision, updatedAt: now });
  return { revision };
}
