import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";
import { creditexPermissionSql } from "./creditex-permissions";
import { creditexIntentCompletionSnapshotSql, creditexIntentOpenCorrectionSql } from "./creditex-job-lifecycle-sql";
import { CREDITEX_CASE_CORRECTION_SQL, SUBMISSION_PACKETS_SQL } from "./creditex-job-lifecycle-projection";
import { CreditexNotificationError, notificationEventKeys, type CreditexNotification, type CreditexNotificationList } from "./creditex-notifications";

export type CreditexNotificationActor = { organisationId: string; memberId: string; uid: string };
type NotificationRow = { event_key: string; kind: CreditexNotification["type"]; title: string; detail: string; occurred_at: string; target_id: string; case_id: string; read_at: string };
const actorSql = `SELECT member.* FROM compliance_users member JOIN compliance_organisations organisation ON organisation.id=member.organisation_id
  WHERE member.organisation_id=? AND member.id=? AND member.firebase_uid=? AND member.status='active'
    AND member.role IN ('admin','case_manager','reviewer','auditor') AND organisation.status='active' AND organisation.organisation_code=?`;
const bindings = (actor: CreditexNotificationActor) => [actor.organisationId, actor.memberId, actor.uid, CREDITEX_PARTNER_ORGANISATION_CODE];
async function currentActor(db: D1Database, actor: CreditexNotificationActor) {
  if (!await db.prepare(actorSql).bind(...bindings(actor)).first()) throw new CreditexNotificationError("Your Creditex access changed. Sign in again to continue.", 403);
}

// Each source is re-authorised in SQL. A receipt never grants visibility to a job,
// contact, task or conversation, including after a role or assignment is revoked.
function notificationSources() {
  return `WITH actor AS MATERIALIZED (${actorSql}), jobs AS MATERIALIZED (
    SELECT intent.id,intent.compliance_case_id case_id,work.work_number,work.title,work.stage,
      COALESCE(json_extract(intent.intent_snapshot,'$.activity.title'),'') activity_title,
      work.updated_at work_updated_at,linked_case.updated_at case_updated_at,linked_case.revision case_revision,
      COALESCE((SELECT event.id FROM trade_work_order_events event WHERE event.work_order_id=work.id AND event.firebase_uid=work.firebase_uid
        AND (event.event_type IN ('completed','job_completed') OR (event.event_type='stage_changed' AND lower(event.summary) LIKE '%completed%'))
        ORDER BY event.created_at DESC,event.id DESC LIMIT 1),'stage') completion_event_id,
      ${creditexIntentCompletionSnapshotSql()} completion,
      COALESCE((${creditexIntentOpenCorrectionSql()} OR ${CREDITEX_CASE_CORRECTION_SQL}),0) correction,
      ${SUBMISSION_PACKETS_SQL} packets,
      COALESCE((SELECT MAX(f.submitted_at) FROM trade_activity_field_records f WHERE f.intent_id=intent.id AND f.organisation_id=intent.compliance_organisation_id
        AND f.owner_uid=intent.installer_uid AND f.work_order_id=work.id AND f.status='submitted_for_creditex_review'
        AND NOT EXISTS(SELECT 1 FROM trade_activity_field_records next WHERE next.supersedes_record_id=f.id)), '') field_completed_at,
      COALESCE((SELECT MAX(final.finalised_at) FROM compliance_activity_work_pack_final_records final JOIN compliance_activity_work_pack_instances pack
        ON pack.id=final.case_instance_id AND pack.organisation_id=final.organisation_id
        WHERE pack.organisation_id=intent.compliance_organisation_id AND pack.compliance_intent_id=intent.id AND pack.work_order_id=work.id
        AND NOT EXISTS(SELECT 1 FROM compliance_activity_work_pack_instances next WHERE next.organisation_id=pack.organisation_id AND next.instance_key=pack.instance_key AND next.revision>pack.revision)), '') pack_completed_at,
      COALESCE((SELECT MAX(event.created_at) FROM creditex_job_lifecycle_events event WHERE event.organisation_id=intent.compliance_organisation_id
        AND event.intent_id=intent.id AND event.work_order_id=work.id AND event.owner_uid=work.firebase_uid AND event.action='correction_required'), '') correction_at,
      COALESCE((SELECT MAX(event.created_at) FROM compliance_output_action_events event JOIN compliance_output_action_packets packet ON packet.id=event.packet_id AND packet.organisation_id=event.organisation_id
        WHERE packet.compliance_case_id=linked_case.id AND packet.organisation_id=linked_case.organisation_id AND event.to_status='rejected'), '') rejection_at
    FROM actor CROSS JOIN trade_work_order_compliance_intents intent
    JOIN trade_work_orders work ON work.id=intent.work_order_id AND work.firebase_uid=intent.installer_uid
      AND work.partner_type='installer' AND work.source_type='internal' AND work.record_status='active' AND work.stage NOT IN ('cancelled','imported')
    LEFT JOIN compliance_cases linked_case ON linked_case.id=intent.compliance_case_id AND linked_case.organisation_id=intent.compliance_organisation_id
      AND linked_case.installer_uid=work.firebase_uid AND linked_case.work_order_id=work.id AND linked_case.compliance_intent_id=intent.id
    WHERE intent.compliance_organisation_id=actor.organisation_id AND intent.status IN ('planned','case_linked')
      AND (${creditexPermissionSql("jobs", "actor")} OR ${creditexPermissionSql("customers", "actor")})
      AND (COALESCE(intent.compliance_case_id,'')='' OR (linked_case.id IS NOT NULL AND (actor.role='admin' OR EXISTS(
        SELECT 1 FROM compliance_case_assignments assignment WHERE assignment.organisation_id=actor.organisation_id AND assignment.case_id=linked_case.id
          AND assignment.compliance_user_id=actor.id AND assignment.status='assigned'))))
  ), job_states AS MATERIALIZED (
    SELECT jobs.*, MAX(field_completed_at,pack_completed_at) completed_at,
      (correction OR EXISTS(SELECT 1 FROM json_each(packets) packet WHERE json_extract(packet.value,'$.status')='rejected' AND json_extract(packet.value,'$.lodged')<>1)) requires_correction,
      MAX(correction_at,COALESCE(case_updated_at,''),rejection_at) correction_updated_at,
      (json_array_length(completion,'$.records')>0 AND NOT EXISTS(SELECT 1 FROM json_each(completion,'$.records') record
        WHERE json_extract(record.value,'$.status') NOT IN ('submitted_for_creditex_review','completed')
          OR (json_extract(record.value,'$.kind')='field' AND (length(json_extract(record.value,'$.sha256'))<>64 OR json_extract(record.value,'$.objectKey')=''))
          OR (json_extract(record.value,'$.kind')='pack' AND json_array_length(record.value,'$.finals')=0))) records_complete
    FROM jobs
  ), events AS (
    SELECT 'completed:'||job.id||':'||CASE WHEN job.completed_at<>'' THEN job.completed_at ELSE job.completion_event_id END event_key,
      'completed' kind,CASE WHEN job.stage='completed' THEN 'Job completed' ELSE 'Work submitted for audit' END title,
      job.work_number||' · '||job.title||CASE WHEN job.activity_title<>'' THEN ' · '||job.activity_title ELSE '' END detail,
      CASE WHEN job.completed_at<>'' THEN job.completed_at ELSE job.work_updated_at END occurred_at,job.id target_id,COALESCE(job.case_id,'') case_id
    FROM job_states job CROSS JOIN actor WHERE ${creditexPermissionSql("jobs", "actor")} AND NOT job.requires_correction
      AND (job.records_complete OR job.stage='completed')
    UNION ALL
    SELECT 'correction:'||job.id||':'||job.correction_updated_at,'correction','Correction required',job.work_number||' · '||job.title,
      job.correction_updated_at,job.id,COALESCE(job.case_id,'') FROM job_states job CROSS JOIN actor
      WHERE ${creditexPermissionSql("jobs", "actor")} AND job.requires_correction
    UNION ALL
    SELECT 'task:'||task.id||':'||task.revision,'task','Task assigned to you',task.title,task.updated_at,task.id,''
      FROM portal_team_tasks task JOIN actor ON task.scope_id=actor.organisation_id AND task.assignee_id=actor.id
      WHERE task.workspace='creditex' AND task.status='open' AND ${creditexPermissionSql("tasks", "actor")}
    UNION ALL
    SELECT 'message:'||message.id,'message','New team message',COALESCE(NULLIF(peer.display_name,''),'Team member')||': '||substr(message.body,1,160),message.created_at,peer.id,''
      FROM portal_team_messages message JOIN actor ON message.scope_id=actor.organisation_id AND message.recipient_id=actor.id
      JOIN compliance_users peer ON peer.id=message.sender_id AND peer.organisation_id=actor.organisation_id AND peer.firebase_uid=message.sender_uid AND peer.status='active'
      WHERE message.workspace='creditex' AND ${creditexPermissionSql("messages", "actor")}
    UNION ALL
    SELECT 'call:'||call.id||':'||call.status,'call',CASE WHEN call.status='failed' THEN 'Call could not connect' WHEN call.status='busy' THEN 'Customer line busy' ELSE 'Call not answered' END,
      job.work_number||' · '||job.title,call.updated_at,job.id,COALESCE(job.case_id,'')
      FROM creditex_audit_calls call JOIN actor ON call.organisation_id=actor.organisation_id AND call.started_by_member_id=actor.id AND call.started_by_uid=actor.firebase_uid
      JOIN jobs job ON call.job_intent_id=job.id OR (call.job_intent_id='' AND call.case_id<>'' AND call.case_id=job.case_id)
      WHERE call.status IN ('no_answer','busy','failed') AND ${creditexPermissionSql("customers", "actor")}
  ), visible AS (
    SELECT events.*,COALESCE(receipt.read_at,'') read_at,COALESCE(receipt.dismissed_at,'') dismissed_at FROM events CROSS JOIN actor
      LEFT JOIN creditex_notification_receipts receipt ON receipt.organisation_id=actor.organisation_id AND receipt.member_id=actor.id AND receipt.event_key=events.event_key
  )`;
}
function project(row: NotificationRow): CreditexNotification {
  return { id: row.event_key, type: row.kind, title: row.title, detail: row.detail, createdAt: row.occurred_at, read: Boolean(row.read_at),
    target: row.kind === "message" ? { kind: "message", peerId: row.target_id } : row.kind === "task" ? { kind: "task", taskId: row.target_id }
      : row.kind === "call" ? { kind: "call", intentId: row.target_id, caseId: row.case_id } : { kind: "job", intentId: row.target_id } };
}
export async function listCreditexNotifications(db: D1Database, actor: CreditexNotificationActor, params: URLSearchParams): Promise<CreditexNotificationList> {
  await currentActor(db, actor);
  const filter = params.get("filter") || "unread"; const requestedPage = Number(params.get("page") || 1);
  if (!["unread", "all"].includes(filter) || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000) throw new CreditexNotificationError("Choose a valid notification view.");
  const scoped = `${notificationSources()} SELECT * FROM visible WHERE dismissed_at=''`;
  const result = await db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(read_at=''),0) unread FROM (${scoped})`).bind(...bindings(actor)).first<{ total: number; unread: number }>();
  const total = Number(filter === "unread" ? result?.unread : result?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25)); const page = Math.min(requestedPage, totalPages);
  const rows = await db.prepare(`${scoped} AND (?='all' OR read_at='') ORDER BY occurred_at DESC,event_key DESC LIMIT 25 OFFSET ?`)
    .bind(...bindings(actor), filter, (page - 1) * 25).all<NotificationRow>();
  return { items: rows.results.map(project), unreadCount: Number(result?.unread || 0), total, page, totalPages };
}
export async function updateCreditexNotifications(db: D1Database, actor: CreditexNotificationActor, action: unknown, ids: unknown) {
  await currentActor(db, actor); const selected = notificationEventKeys(ids);
  if (action !== "read" && action !== "dismiss") throw new CreditexNotificationError("Choose read or dismiss.");
  const now = new Date().toISOString();
  const result = await db.prepare(`${notificationSources()} INSERT INTO creditex_notification_receipts(organisation_id,member_id,event_key,read_at,dismissed_at)
    SELECT actor.organisation_id,actor.id,event.event_key,?,? FROM events event CROSS JOIN actor
      WHERE event.event_key IN (SELECT value FROM json_each(?))
    ON CONFLICT(organisation_id,member_id,event_key) DO UPDATE SET read_at=COALESCE(NULLIF(creditex_notification_receipts.read_at,''),excluded.read_at),
      dismissed_at=COALESCE(NULLIF(creditex_notification_receipts.dismissed_at,''),excluded.dismissed_at)`)
    .bind(...bindings(actor), now, action === "dismiss" ? now : "", JSON.stringify(selected)).run();
  if (!result.meta.changes) throw new CreditexNotificationError("These notifications are no longer available to you. Refresh the inbox.", 404);
}
export async function markCreditexConversationRead(db: D1Database, actor: CreditexNotificationActor, messageIds: readonly string[]): Promise<void> {
  const ids = notificationEventKeys(messageIds); await currentActor(db, actor);
  await db.prepare(`WITH actor AS (${actorSql}) INSERT INTO creditex_notification_receipts(organisation_id,member_id,event_key,read_at,dismissed_at)
    SELECT actor.organisation_id,actor.id,'message:'||message.id,?,'' FROM portal_team_messages message JOIN actor
      ON message.scope_id=actor.organisation_id AND message.recipient_id=actor.id
    JOIN compliance_users peer ON peer.id=message.sender_id AND peer.organisation_id=actor.organisation_id AND peer.firebase_uid=message.sender_uid AND peer.status='active'
    WHERE message.workspace='creditex' AND ${creditexPermissionSql("messages", "actor")} AND message.id IN (SELECT value FROM json_each(?))
    ON CONFLICT(organisation_id,member_id,event_key) DO UPDATE SET read_at=COALESCE(NULLIF(creditex_notification_receipts.read_at,''),excluded.read_at)`)
    .bind(...bindings(actor), new Date().toISOString(), JSON.stringify(ids)).run();
}
