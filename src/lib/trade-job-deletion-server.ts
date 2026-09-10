import { env, waitUntil } from "cloudflare:workers";
import type { TeamAccess } from "./trade-team-server";
import { previousTradeScheduleMutationGuardStatement } from "./trade-compliance-intent-replan-server";
import { jobSyncChangeStatements, nextJobRevision } from "./trade-team-sync-server";
import { cancelAppointmentInConnectedCalendars } from "./trade-calendar-sync-server";
import { drainTradeCrmJobMediaCleanup, type TradeCrmJobMediaCleanupBucket } from "./trade-crm-job-media-cleanup";

type Job = { id: string; revision: number; stage: string; source_type: string; customer_source: string; assignee_member_id: string };

export class JobDeletionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Durable cleanup is retried by job actions without holding the field UI open. */
export function scheduleJobFileCleanup(db: D1Database) {
  const bucket = (env as unknown as { EVIDENCE?: TradeCrmJobMediaCleanupBucket }).EVIDENCE;
  if (bucket) waitUntil(drainTradeCrmJobMediaCleanup({ db, bucket, limit: 10 }).catch(() => {
    // The cleanup table retains failed or interrupted claims for the next attempt.
  }));
}

// These records have independent retention/immutability contracts. Deletion must
// never leave their canonical job missing or quietly become an archive operation.
const protectedRecords = [
  ["trade_work_order_compliance_intents", "installer_uid", "", "This job has government-program activity history that must be retained."],
  ["compliance_cases", "installer_uid", "", "This job is linked to a compliance case that must be retained."],
  ["trade_activity_field_records", "owner_uid", "", "This job has a saved activity assessment with protected audit history."],
  ["trade_activity_customer_document_deliveries", "firebase_uid", "", "This job has customer document delivery history that must be retained."],
  ["trade_handover_packs", "firebase_uid", "", "This job has installed-asset or handover records that must be retained."],
  ["trade_crm_quick_invoices", "firebase_uid", "", "This job has an invoice. Its financial records must be retained."],
  ["trade_crm_accepted_invoices", "firebase_uid", "", "This job has an accepted invoice. Its financial records must be retained."],
  ["trade_crm_accounting_documents", "firebase_uid", "", "This job has accounting documents that must be retained."],
  ["trade_installed_assets", "firebase_uid", "", "This job has installed assets and their service history that must be retained."],
  ["trade_rental_inspections", "firebase_uid", "AND (issued_report_id <> '' OR status IN ('submitted', 'issuing', 'issued', 'superseded', 'withdrawn'))", "This job has a submitted or issued rental assessment that must be retained."],
  ["trade_crm_job_media", "firebase_uid", "AND source = 'accepted_public_lead'", "This job includes protected customer lead evidence that must be retained."],
] as const;

const target = "WITH target AS (SELECT ? job_id, ? owner_uid)";
const additionalProtectedRecords = [
  ["SELECT 1 FROM compliance_pilot_jobs p, target WHERE p.work_order_id = target.job_id", "This job is part of a retained compliance pilot record."],
  ["SELECT 1 FROM compliance_parallel_reference_bindings p, target WHERE p.tlink_work_order_id = target.job_id", "This job is linked to a retained compliance reconciliation record."],
  ["SELECT 1 FROM customer_project_arrival_proposals p, target WHERE p.crm_work_order_id = target.job_id AND p.installer_uid = target.owner_uid", "This job is linked to a customer project appointment that must be retained."],
] as const;
// Keep the preflight and the atomic deletion guard on the same predicates.
// D1 allows fewer compound SELECT terms than desktop SQLite, so use scalar
// EXISTS checks instead of combining every protected table with UNION ALL.
const blockerReasonSql = `CASE ${[...protectedRecords.map(([table, ownerColumn, extra], index) =>
  `WHEN EXISTS (SELECT 1 FROM ${table} protected_record, target WHERE protected_record.work_order_id = target.job_id AND protected_record.${ownerColumn} = target.owner_uid ${extra}) THEN ${index}`,
), ...additionalProtectedRecords.map(([query], index) => `WHEN EXISTS (${query}) THEN ${protectedRecords.length + index}`)].join(" ")} ELSE NULL END`;

function deletionGuard(db: D1Database, access: TeamAccess, job: Job, now: string) {
  return db.prepare(`${target} UPDATE trade_work_orders SET revision = revision + 1, updated_at = ?
    WHERE id = (SELECT job_id FROM target) AND firebase_uid = (SELECT owner_uid FROM target)
      AND revision = ? AND record_status = 'active' AND partner_type = 'installer'
      AND source_type <> 'opportunity' AND stage = ? AND assignee_member_id = ?
      AND EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id = trade_work_orders.id
        AND d.firebase_uid = trade_work_orders.firebase_uid AND d.customer_source = 'trade_owned')
      AND (${blockerReasonSql}) IS NULL`)
    .bind(job.id, access.ownerUid, now, job.revision, job.stage, job.assignee_member_id);
}

export async function deleteTradeJob(db: D1Database, access: TeamAccess, job: Job) {
  if ((!access.isOwner && !access.canManageJobs) || job.source_type === 'opportunity' || job.customer_source !== 'trade_owned') {
    throw new JobDeletionError('JOB_DELETE_NOT_ALLOWED', 'Only authorised Team members can delete your business-owned jobs.');
  }
  const blocked = await db.prepare(`${target} SELECT ${blockerReasonSql} AS reason`)
    .bind(job.id, access.ownerUid).first<{ reason: number | null }>();
  if (blocked?.reason != null) throw new JobDeletionError('JOB_DELETE_PROTECTED', blocked.reason < protectedRecords.length
    ? protectedRecords[blocked.reason][3] : additionalProtectedRecords[blocked.reason - protectedRecords.length][1]);

  const appointments = await db.prepare(`SELECT id, status FROM trade_crm_appointments
    WHERE work_order_id = ? AND firebase_uid = ?`).bind(job.id, access.ownerUid).all<{ id: string; status: string }>();
  // Provider cancellation needs its appointment mapping. Keep it until cancellation
  // succeeds so a provider outage can be retried without losing the event identity.
  if (appointments.results.length) {
    const now = new Date().toISOString();
    await db.batch([
      deletionGuard(db, access, job, now), previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
      db.prepare(`UPDATE trade_crm_appointments SET status = 'cancelled', revision = revision + 1, updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'cancelled'`).bind(now, job.id, access.ownerUid),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: job.id, revision: nextJobRevision(job.revision), changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    job = { ...job, revision: nextJobRevision(job.revision) };
    for (const appointment of appointments.results) {
      const result = await cancelAppointmentInConnectedCalendars(access.ownerUid, appointment.id);
      if (result.failed) throw new JobDeletionError('JOB_DELETE_CALENDAR_PENDING', 'The calendar could not be cleared. Your job is still available. Refresh the job actions and try Delete again.');
    }
    const pendingCalendar = await db.prepare(`SELECT 1 FROM trade_crm_calendar_events e
      JOIN trade_crm_appointments a ON a.id = e.appointment_id AND a.firebase_uid = e.firebase_uid
      WHERE a.work_order_id = ? AND a.firebase_uid = ? AND e.external_event_id <> '' AND e.status <> 'cancelled' LIMIT 1`)
      .bind(job.id, access.ownerUid).first();
    if (pendingCalendar) throw new JobDeletionError('JOB_DELETE_CALENDAR_PENDING', 'Reconnect the calendar linked to this job before deleting it, so its appointment can also be removed.');
  }

  const now = new Date().toISOString();
  const owner = access.ownerUid;
  const id = job.id;
  const inspectionIds = `SELECT id FROM trade_rental_inspections WHERE work_order_id = ? AND firebase_uid = ?`;
  const quoteIds = `SELECT id FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`;
  const quoteVersionIds = `SELECT id FROM trade_crm_quote_versions WHERE quote_id IN (${quoteIds}) AND firebase_uid = ?`;
  const appointmentIds = `SELECT id FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ?`;
  const statements = [deletionGuard(db, access, job, now), previousTradeScheduleMutationGuardStatement(db, { ownerUid: owner, changedAt: now })];
  // The object cleanup intent commits in the same transaction as the deletion.
  // Failed object-store operations remain in the existing retry queue.
  statements.push(db.prepare(`INSERT OR IGNORE INTO trade_crm_job_media_cleanup
    (object_key, firebase_uid, work_order_id, attempt_id, upload_id, status, next_attempt_at, created_at, updated_at)
    SELECT object_key, ?, ?, ?, '', 'staged', ?, ?, ? FROM trade_crm_job_media WHERE work_order_id = ? AND firebase_uid = ?
    UNION SELECT pdf_object_key, ?, ?, ?, '', 'staged', ?, ?, ? FROM trade_rental_reports
      WHERE inspection_id IN (${inspectionIds}) AND firebase_uid = ? AND pdf_object_key <> ''`)
    .bind(owner, id, crypto.randomUUID(), now, now, now, id, owner,
      owner, id, crypto.randomUUID(), now, now, now, id, owner, owner));
  statements.push(db.prepare(`INSERT INTO trade_crm_job_media_cleanup
    (object_key, firebase_uid, work_order_id, attempt_id, upload_id, status, next_attempt_at, created_at, updated_at)
    SELECT object_key, owner_uid, work_order_id, ?, CASE WHEN status = 'completed' THEN '' ELSE upload_id END,
      'staged', ?, ?, ? FROM trade_mobile_upload_sessions WHERE work_order_id = ? AND owner_uid = ?
    ON CONFLICT(object_key) DO UPDATE SET upload_id = excluded.upload_id`)
    .bind(crypto.randomUUID(), now, now, now, id, owner));
  statements.push(db.prepare(`INSERT OR IGNORE INTO trade_crm_job_media_cleanup
    (object_key, firebase_uid, work_order_id, attempt_id, status, next_attempt_at, created_at, updated_at)
    SELECT issued_pdf_object_key, ?, ?, ?, 'staged', ?, ?, ? FROM trade_crm_quote_versions
    WHERE quote_id IN (${quoteIds}) AND firebase_uid = ? AND issued_pdf_object_key <> ''`)
    .bind(owner, id, crypto.randomUUID(), now, now, now, id, owner, owner));
  statements.push(db.prepare(`DELETE FROM trade_offline_actions WHERE owner_uid = ? AND
    (entity_id = ? OR entity_id IN (SELECT id FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ?)
      OR entity_id IN (SELECT id FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ?))`).bind(owner, id, id, owner, id, owner));
  statements.push(db.prepare(`DELETE FROM trade_mobile_push_outbox WHERE owner_uid = ? AND entity_type = 'job' AND entity_id = ?`).bind(owner, id));
  for (const table of ['trade_rental_report_links', 'trade_rental_inspection_events', 'trade_rental_evidence_links',
    'trade_rental_findings', 'trade_rental_inspection_items', 'trade_rental_inspection_modules', 'trade_rental_reports']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE inspection_id IN (${inspectionIds}) AND firebase_uid = ?`).bind(id, owner, owner));
  }
  // Acceptance alone does not retain a cancelled job. Remove its execution plan
  // and agreed scope before deleting the acceptance and quote versions.
  statements.push(db.prepare(`DELETE FROM trade_crm_job_actuals WHERE work_order_id = ? AND firebase_uid = ?`).bind(id, owner));
  for (const table of ['trade_crm_job_plan_requirements', 'trade_crm_job_plan_phases']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?) AND firebase_uid = ?`).bind(id, owner, owner));
  }
  for (const table of ['trade_crm_job_plans', 'trade_crm_commercial_handovers', 'trade_crm_quote_acceptances',
    'trade_crm_quote_events', 'trade_crm_quote_questions', 'trade_crm_quote_deliveries', 'trade_crm_quote_links']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE work_order_id = ? AND firebase_uid = ?`).bind(id, owner));
  }
  for (const table of ['trade_crm_quote_items', 'trade_crm_quote_choices', 'trade_crm_quote_execution_snapshots']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE quote_version_id IN (${quoteVersionIds}) AND firebase_uid = ?`).bind(id, owner, owner, owner));
  }
  statements.push(db.prepare(`DELETE FROM trade_crm_quote_versions WHERE quote_id IN (${quoteIds}) AND firebase_uid = ?`).bind(id, owner, owner));
  statements.push(db.prepare(`DELETE FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(id, owner));
  statements.push(db.prepare(`DELETE FROM trade_crm_calendar_events WHERE appointment_id IN (${appointmentIds}) AND firebase_uid = ?`).bind(id, owner, owner));
  statements.push(db.prepare(`DELETE FROM appointment_notification_deliveries WHERE appointment_id IN (${appointmentIds})`).bind(id, owner));
  statements.push(db.prepare(`DELETE FROM appointment_notification_events WHERE work_order_id = ? AND installer_uid = ?`).bind(id, owner));
  statements.push(db.prepare(`DELETE FROM trade_mobile_upload_parts WHERE session_id IN (SELECT id FROM trade_mobile_upload_sessions WHERE work_order_id = ? AND owner_uid = ?)`).bind(id, owner));
  statements.push(db.prepare(`DELETE FROM trade_mobile_upload_sessions WHERE work_order_id = ? AND owner_uid = ?`).bind(id, owner));
  for (const table of ['trade_crm_appointment_reschedule_events', 'trade_crm_appointment_reschedule_requests',
    'trade_crm_appointment_revisions', 'trade_crm_photo_request_events', 'trade_crm_photo_request_deliveries',
    'trade_crm_photo_request_completions', 'trade_crm_photo_requirement_reviews', 'trade_crm_photo_requests',
    'trade_crm_job_media_events', 'trade_rental_inspections', 'trade_crm_job_media', 'trade_job_forms', 'trade_work_order_tasks',
    'trade_crm_job_notes', 'trade_crm_signoffs', 'trade_crm_time_entries', 'trade_crm_appointments',
    'trade_service_follow_ups',
    'trade_crm_job_details', 'trade_work_order_events']) {
    statements.push(db.prepare(`DELETE FROM ${table} WHERE work_order_id = ? AND firebase_uid = ?`).bind(id, owner));
  }
  statements.push(db.prepare(`DELETE FROM trade_service_job_generations WHERE (source_work_order_id = ? OR generated_work_order_id = ?) AND firebase_uid = ?`).bind(id, id, owner));
  statements.push(db.prepare(`UPDATE trade_asset_service_plans SET last_generated_work_order_id = '' WHERE last_generated_work_order_id = ? AND firebase_uid = ?`).bind(id, owner));
  statements.push(db.prepare(`DELETE FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(id, owner, nextJobRevision(job.revision)));
  statements.push(previousTradeScheduleMutationGuardStatement(db, { ownerUid: owner, changedAt: now }));
  statements.push(...jobSyncChangeStatements(db, { ownerUid: owner, workOrderId: id, revision: nextJobRevision(job.revision), changedAt: now, audienceMemberId: job.assignee_member_id, operation: 'delete' }));
  await db.batch(statements);

  const remaining = await db.prepare(`SELECT count(*) count FROM trade_crm_job_media_cleanup WHERE work_order_id = ? AND firebase_uid = ?`).bind(id, owner).first<{ count: number }>();
  scheduleJobFileCleanup(db);
  return { ok: true as const, deletedJobId: id, jobPatch: {}, storageCleanup: { pending: Number(remaining?.count || 0) } };
}
