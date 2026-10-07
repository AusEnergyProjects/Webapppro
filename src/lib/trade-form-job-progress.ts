import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { creditexMutationConflict, CreditexComplianceError, creditexWriteGuard } from "./creditex-onboarding-server";
import { assertCertificateJobEligibility, certificateJobEligibilityGuards } from "./trade-certificate-eligibility";
import { jobMemberSql } from "./trade-job-collaboration";
import { messageActorGuard } from "./trade-message-media-access";
import { jobSyncChangeStatements, nextJobRevision } from "./trade-team-sync-server";
import { submittedActivityFieldCaseSql, UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL } from "./trade-activity-forms-completion";
import { photoRequestProofOverview } from "./photo-request-review-server";
import { normalisePhotoRequirements } from "./trade-photo-requests";

export const UNSATISFIED_COMPLIANCE_REQUIREMENTS_SQL = `SELECT 1
  FROM compliance_cases compliance_case
  JOIN compliance_evidence_requirements requirement
    ON requirement.policy_version_id = compliance_case.evidence_policy_version_id
    AND requirement.organisation_id = compliance_case.organisation_id
  WHERE compliance_case.work_order_id = ?
    AND compliance_case.installer_uid = ?
    AND compliance_case.status NOT IN ('rejected', 'closed')
    AND NOT EXISTS (${submittedActivityFieldCaseSql("compliance_case")})
    AND requirement.minimum_count > 0
    AND (
      SELECT COUNT(DISTINCT evidence.original_sha256)
      FROM compliance_case_evidence evidence
      WHERE evidence.organisation_id = compliance_case.organisation_id
        AND evidence.case_id = compliance_case.id
        AND evidence.requirement_id = requirement.id
        AND evidence.status IN ('received', 'under_review', 'accepted')
        AND NOT EXISTS (
          SELECT 1
          FROM compliance_case_evidence replacement
          WHERE replacement.organisation_id = evidence.organisation_id
            AND replacement.case_id = evidence.case_id
            AND replacement.supersedes_evidence_id = evidence.id
        )
    ) < requirement.minimum_count`;

/** Direct case intake may have no activity intent; its current governed pack still requires a signed final record. */
export const UNFINISHED_JOB_WORK_PACKS_SQL = `SELECT 1 FROM compliance_activity_work_pack_instances current_pack
  JOIN compliance_cases compliance_case ON compliance_case.id = current_pack.compliance_case_id
    AND compliance_case.organisation_id = current_pack.organisation_id
    AND compliance_case.work_order_id = current_pack.work_order_id
  WHERE current_pack.work_order_id = ? AND compliance_case.installer_uid = ?
    AND compliance_case.status NOT IN ('rejected', 'closed')
    AND NOT EXISTS (${submittedActivityFieldCaseSql("compliance_case")})
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
      WHERE newer.organisation_id = current_pack.organisation_id AND newer.compliance_case_id = current_pack.compliance_case_id
        AND newer.revision > current_pack.revision)
    AND (current_pack.status <> 'completed' OR NOT EXISTS (
      SELECT 1 FROM compliance_activity_work_pack_final_records final WHERE final.case_instance_id = current_pack.id
        AND final.organisation_id = current_pack.organisation_id AND final.instance_key = current_pack.instance_key
        AND final.work_pack_version_id = current_pack.work_pack_version_id))`;

const PHOTO_MEDIA_SNAPSHOT_SQL = `COALESCE((
  SELECT json_group_array(json(photo_media.item))
  FROM (
    SELECT json_object(
      'id', media.id,
      'photoRequirementId', media.photo_requirement_id,
      'createdAt', media.created_at
    ) item
    FROM trade_crm_job_media media
    WHERE media.firebase_uid = finish_request.firebase_uid
      AND media.work_order_id = finish_request.work_order_id
      AND media.photo_request_id = finish_request.id
      AND media.source = 'customer_request'
    ORDER BY media.created_at, media.id
  ) photo_media
), '[]')`;

const PHOTO_REVIEW_SNAPSHOT_SQL = `COALESCE((
  SELECT json_group_array(json(photo_review.item))
  FROM (
    SELECT json_object(
      'id', review.id,
      'photoRequirementId', review.photo_requirement_id,
      'status', review.status,
      'reasonCode', review.reason_code,
      'guidance', review.guidance,
      'reviewRevision', review.review_revision,
      'reviewedUploadCount', review.reviewed_upload_count,
      'createdAt', review.created_at
    ) item
    FROM trade_crm_photo_requirement_reviews review
    WHERE review.firebase_uid = finish_request.firebase_uid
      AND review.work_order_id = finish_request.work_order_id
      AND review.photo_request_id = finish_request.id
      AND review.request_revision = finish_request.revision
    ORDER BY review.review_revision, review.id
  ) photo_review
), '[]')`;

const PHOTO_COMPLETION_SNAPSHOT_SQL = `COALESCE((
  SELECT json_object(
    'id', completion.id,
    'completionRevision', completion.completion_revision,
    'checklistVersion', completion.checklist_version,
    'evidenceKey', completion.evidence_key,
    'requiredCount', completion.required_count,
    'suppliedCount', completion.supplied_count,
    'completedAt', completion.completed_at
  )
  FROM trade_crm_photo_request_completions completion
  WHERE completion.firebase_uid = finish_request.firebase_uid
    AND completion.work_order_id = finish_request.work_order_id
    AND completion.photo_request_id = finish_request.id
    AND completion.request_revision = finish_request.revision
  ORDER BY completion.completion_revision DESC
  LIMIT 1
), '')`;

export type PhotoFinishGuard = {
  kind: "none";
} | {
  kind: "active";
  requestId: string;
  revision: number;
  status: string;
  requirements: string;
  mediaSnapshot: string;
  reviewSnapshot: string;
  completionSnapshot: string;
};

export async function photoFinishState(
  db: D1Database,
  ownerUid: string,
  workOrderId: string,
): Promise<{ ready: boolean; guard: PhotoFinishGuard }> {
  const request = await db.prepare(`SELECT
      finish_request.id,
      finish_request.revision,
      finish_request.requirements,
      finish_request.status,
      ${PHOTO_MEDIA_SNAPSHOT_SQL} media_snapshot,
      ${PHOTO_REVIEW_SNAPSHOT_SQL} review_snapshot,
      ${PHOTO_COMPLETION_SNAPSHOT_SQL} completion_snapshot
    FROM trade_crm_photo_requests finish_request
    WHERE finish_request.work_order_id = ?
      AND finish_request.firebase_uid = ?
    LIMIT 1`)
    .bind(workOrderId, ownerUid)
    .first<Record<string, unknown>>();
  if (!request || String(request.status) === "revoked") {
    return { ready: true, guard: { kind: "none" } };
  }
  const guard: PhotoFinishGuard = {
    kind: "active",
    requestId: String(request.id),
    revision: Number(request.revision),
    status: String(request.status),
    requirements: String(request.requirements || "[]"),
    mediaSnapshot: String(request.media_snapshot || "[]"),
    reviewSnapshot: String(request.review_snapshot || "[]"),
    completionSnapshot: String(request.completion_snapshot || ""),
  };
  try {
    const requirements = normalisePhotoRequirements(
      JSON.parse(guard.requirements),
    );
    const proof = await photoRequestProofOverview({
      ownerUid,
      workOrderId,
      requestId: guard.requestId,
      requestRevision: guard.revision,
      requirements,
    });
    return { ready: Boolean(proof.proofReady), guard };
  } catch {
    return { ready: false, guard };
  }
}

const COMPLETED_ELECTRICAL_ASSESSMENT_SQL = `assessment.status = 'complete'
  AND assessment.pdf_object_key <> '' AND length(assessment.pdf_sha256) = 64
  AND assessment.pdf_size_bytes > 4 AND assessment.completed_at <> ''`;

/** One SQL completion contract for compatibility actions and automatic form progress. */
export function fieldCompletionGuard(ownerUid: string, workOrderId: string, photoFinish: { guard: PhotoFinishGuard }, action = "finish") {
  const finishGuard = `(
    ? <> 'finish'
    OR (
      NOT EXISTS (
        SELECT 1 FROM trade_work_order_tasks blocker
        WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
          AND blocker.status <> 'done'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trade_job_forms blocker
        WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
          AND blocker.status <> 'complete'
      )
      AND NOT EXISTS (
        SELECT 1 FROM trade_veu_electrical_assessments assessment
        WHERE assessment.work_order_id = ? AND assessment.owner_uid = ?
          AND NOT (${COMPLETED_ELECTRICAL_ASSESSMENT_SQL})
      )
      AND NOT EXISTS (
        SELECT 1 FROM trade_crm_job_notes blocker
        WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
          AND blocker.note_type = 'issue' AND blocker.issue_status = 'open'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM trade_crm_job_plan_requirements blocker
        JOIN trade_crm_job_plans blocker_plan
          ON blocker_plan.id = blocker.job_plan_id
          AND blocker_plan.firebase_uid = blocker.firebase_uid
        WHERE blocker_plan.work_order_id = ? AND blocker_plan.firebase_uid = ?
          AND blocker.status NOT IN (
            'installed', 'complete', 'completed', 'done', 'not_required', 'not_needed'
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM trade_offline_actions blocker
        WHERE blocker.owner_uid = ? AND blocker.entity_id = ?
          AND blocker.status IN ('processing', 'conflict')
      )
      AND NOT EXISTS (
        SELECT 1 FROM trade_rental_inspections blocker
        WHERE blocker.work_order_id = ? AND blocker.firebase_uid = ?
          AND blocker.status <> 'issued'
      )
      AND NOT EXISTS (${UNSATISFIED_COMPLIANCE_REQUIREMENTS_SQL})
      AND NOT EXISTS (${UNFINISHED_ACTIVITY_FIELD_INTENTS_SQL})
      AND NOT EXISTS (${UNFINISHED_JOB_WORK_PACKS_SQL})
      AND (
        (
          ? = 'none'
          AND NOT EXISTS (
            SELECT 1
            FROM trade_crm_photo_requests finish_request
            WHERE finish_request.work_order_id = ?
              AND finish_request.firebase_uid = ?
              AND finish_request.status <> 'revoked'
          )
        )
        OR (
          ? = 'active'
          AND EXISTS (
            SELECT 1
            FROM trade_crm_photo_requests finish_request
            WHERE finish_request.work_order_id = ?
              AND finish_request.firebase_uid = ?
              AND finish_request.id = ?
              AND finish_request.revision = ?
              AND finish_request.status = ?
              AND finish_request.status <> 'revoked'
              AND finish_request.requirements = ?
              AND ${PHOTO_MEDIA_SNAPSHOT_SQL} = ?
              AND ${PHOTO_REVIEW_SNAPSHOT_SQL} = ?
              AND ${PHOTO_COMPLETION_SNAPSHOT_SQL} = ?
          )
        )
      )
    )
  )`;
  const photoGuard = photoFinish.guard;
  const finishGuardValues = [
    action,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    ownerUid,
    workOrderId,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    workOrderId,
    ownerUid,
    photoGuard.kind,
    workOrderId,
    ownerUid,
    photoGuard.kind,
    workOrderId,
    ownerUid,
    photoGuard.kind === "active" ? photoGuard.requestId : "",
    photoGuard.kind === "active" ? photoGuard.revision : 0,
    photoGuard.kind === "active" ? photoGuard.status : "",
    photoGuard.kind === "active" ? photoGuard.requirements : "",
    photoGuard.kind === "active" ? photoGuard.mediaSnapshot : "",
    photoGuard.kind === "active" ? photoGuard.reviewSnapshot : "",
    photoGuard.kind === "active" ? photoGuard.completionSnapshot : "",
  ];
  return { sql: finishGuard, values: finishGuardValues };
}

type ProgressVisit = { id: string; revision: number; assignee_member_id: string; status: string };
type ProgressBlocker = { key: string; label: string; target: string };
export type FormJobProgress = { changed: boolean; stage: string; revision?: number; pending?: boolean; blockers: ProgressBlocker[] };
const activeStatuses = new Set(["scheduled", "en_route", "arrived", "in_progress"]);

/** Management/read scope is not evidence that the actor performed another worker's visit. */
export function automaticFormVisit(visits: readonly ProgressVisit[], actorMemberId: string, leadMemberId: string) {
  const active = visits.filter(visit => activeStatuses.has(visit.status));
  const owned = active.filter(visit => visit.assignee_member_id === actorMemberId
    || (!visit.assignee_member_id && leadMemberId === actorMemberId));
  return { visit: owned.length === 1 ? owned[0] : null, activeCount: active.length, ambiguous: owned.length > 1 };
}

const VISIT_SNAPSHOT_SQL = `COALESCE((SELECT json_group_array(json(visit_snapshot.item)) FROM (
  SELECT json_object('id', id, 'revision', revision, 'assignee_member_id', assignee_member_id, 'status', status) item
  FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ? ORDER BY id
) visit_snapshot), '[]')`;

const COMPLETED_FORM_SQL = `(EXISTS (SELECT 1 FROM trade_job_forms
    WHERE work_order_id = ? AND firebase_uid = ? AND status = 'complete')
  OR EXISTS (SELECT 1 FROM trade_veu_electrical_assessments assessment
    WHERE assessment.work_order_id = ? AND assessment.owner_uid = ? AND ${COMPLETED_ELECTRICAL_ASSESSMENT_SQL})
  OR EXISTS (SELECT 1 FROM trade_activity_field_records WHERE work_order_id = ? AND owner_uid = ?
    AND status = 'submitted_for_creditex_review' AND pdf_object_key <> '' AND length(pdf_sha256) = 64
    AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records successor WHERE successor.supersedes_record_id = trade_activity_field_records.id))
  OR EXISTS (SELECT 1 FROM trade_rental_inspections WHERE work_order_id = ? AND firebase_uid = ? AND status = 'issued')
  OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances pack
    JOIN compliance_cases c ON c.id = pack.compliance_case_id AND c.organisation_id = pack.organisation_id
    JOIN compliance_activity_work_pack_final_records final ON final.case_instance_id = pack.id
      AND final.organisation_id = pack.organisation_id AND final.instance_key = pack.instance_key
      AND final.work_pack_version_id = pack.work_pack_version_id
    WHERE pack.work_order_id = ? AND c.work_order_id = pack.work_order_id AND c.installer_uid = ?
      AND c.status NOT IN ('rejected', 'closed') AND pack.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = pack.organisation_id AND newer.compliance_case_id = pack.compliance_case_id AND newer.revision > pack.revision)))`;

/** Call after an authoritative form/evidence write, or with startOnly after validated editing activity.
 * No travel or arrival event is inferred. Completion is a guarded projection of all saved job requirements.
 */
async function applyTradeFormJobProgress(access: TeamAccess, workOrderId: string,
  options: { startOnly?: boolean; db?: D1Database; now?: string } = {}): Promise<FormJobProgress> {
  const db = options.db || getD1();
  const now = options.now || new Date().toISOString();
  const blocked = (stage: string, key: string, label: string, target = "forms"): FormJobProgress => ({ changed: false, stage, blockers: [{ key, label, target }] });
  if (!access.isOwner && !access.canManageFieldEvidence) return blocked("", "access", "Current field evidence access is required.");
  const identity = messageActorGuard(access);
  const actor = { sql: `${identity.sql} AND (? = 1 OR EXISTS (SELECT 1 FROM trade_team_members progress_actor
    WHERE progress_actor.id = ? AND progress_actor.owner_uid = ? AND progress_actor.can_manage_field_evidence = 1))`,
    values: [...identity.values, access.isOwner ? 1 : 0, access.memberId, access.ownerUid] };
  if (!access.isOwner && access.jobScope === "team") {
    actor.sql += ` AND EXISTS (SELECT 1 FROM trade_team_members progress_scope WHERE progress_scope.id = ?
      AND progress_scope.owner_uid = ? AND progress_scope.job_scope = 'team'
      AND NOT EXISTS (SELECT 1 FROM trade_crew_members current_crew WHERE current_crew.owner_uid = progress_scope.owner_uid
        AND current_crew.member_id = progress_scope.id))`;
    actor.values.push(access.memberId, access.ownerUid);
  }
  const job = await db.prepare(`SELECT current_job.id, current_job.stage, current_job.revision, current_job.assignee_member_id,
      (SELECT pipeline_stage FROM trade_crm_job_details d WHERE d.work_order_id=current_job.id AND d.firebase_uid=current_job.firebase_uid) pipeline_stage,
      ${VISIT_SNAPSHOT_SQL} visit_snapshot
    FROM trade_work_orders current_job WHERE current_job.id = ? AND current_job.firebase_uid = ?
      AND current_job.record_status = 'active' AND current_job.partner_type = 'installer'
      AND (? = 1 OR ${jobMemberSql("current_job")}) AND ${actor.sql}`)
    .bind(workOrderId, access.ownerUid, workOrderId, access.ownerUid,
      access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId, ...actor.values)
    .first<{ id: string; stage: string; pipeline_stage: string; revision: number; assignee_member_id: string; visit_snapshot: string }>();
  if (!job) return blocked("", "access", "The job or worker assignment changed.");
  if (["imported", "completed", "cancelled"].includes(job.stage) || job.pipeline_stage === "lost") return { changed: false, stage: job.stage, blockers: [] };
  const visits: ProgressVisit[] = JSON.parse(job.visit_snapshot);
  const selection = automaticFormVisit(visits, access.memberId, job.assignee_member_id);
  const completedFormValues = [workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid];
  const unscheduledActor = job.assignee_member_id === access.memberId || (access.isOwner && !job.assignee_member_id);
  // These existence checks share the same freshly authorised job and one database snapshot.
  // Completion still rechecks every requirement in the atomic mutation guard below.
  const form = await db.prepare(`SELECT
      CASE WHEN ? = 1 THEN EXISTS (SELECT 1 FROM trade_rental_inspections
        WHERE work_order_id = ? AND firebase_uid = ? AND status = 'issued') ELSE 0 END issued_rental,
      CASE WHEN ? = 1 THEN ${COMPLETED_FORM_SQL} ELSE 0 END completed_form
    WHERE
      EXISTS (SELECT 1 FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ?)
      OR EXISTS (SELECT 1 FROM trade_veu_electrical_assessments WHERE work_order_id = ? AND owner_uid = ?)
      OR EXISTS (SELECT 1 FROM trade_activity_field_records WHERE work_order_id = ? AND owner_uid = ?)
      OR EXISTS (SELECT 1 FROM trade_rental_inspections WHERE work_order_id = ? AND firebase_uid = ?)
      OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances pack JOIN compliance_cases c
        ON c.id = pack.compliance_case_id AND c.organisation_id = pack.organisation_id
        WHERE pack.work_order_id = ? AND c.work_order_id = pack.work_order_id AND c.installer_uid = ?)`)
    .bind(selection.activeCount === 0 ? 1 : 0, workOrderId, access.ownerUid,
      selection.activeCount === 0 && unscheduledActor ? 1 : 0, ...completedFormValues,
      workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid, workOrderId, access.ownerUid)
    .first<{ issued_rental: number; completed_form: number }>();
  if (!form) return { changed: false, stage: job.stage, blockers: [] };
  const issuedRental = selection.activeCount === 0 && form.issued_rental === 1;
  const unscheduledCompletion = selection.activeCount === 0 && unscheduledActor && form.completed_form === 1;
  const safeCompletionVisit = selection.visit && selection.activeCount === 1;
  const hasCompletionVisit = Boolean(selection.visit || issuedRental || unscheduledCompletion);
  const photo = options.startOnly ? { ready: false, guard: { kind: "none" } as PhotoFinishGuard }
    : await photoFinishState(db, access.ownerUid, workOrderId);
  const completion = fieldCompletionGuard(access.ownerUid, workOrderId, photo);
  const ready = !options.startOnly && hasCompletionVisit && photo.ready
    && Boolean(await db.prepare(`SELECT 1 ready WHERE ${completion.sql}`).bind(...completion.values).first());
  const completesJob = ready && Boolean(safeCompletionVisit || issuedRental || unscheduledCompletion);
  const stage = completesJob ? "completed" : "in_progress";
  const visitStatus = ready ? "completed" : "in_progress";
  const visit = selection.visit;
  const blockers: ProgressBlocker[] = completesJob || options.startOnly ? [] : !hasCompletionVisit || (ready && !completesJob)
    ? [{ key: "visit", label: selection.ambiguous ? "More than one visit is assigned to this worker. Review the visit assignments."
      : selection.activeCount > 0 ? "Other workers' visits remain open. Each worker's visit must be resolved before closing this job."
      : "The assigned worker must complete the required forms before this job can close automatically.", target: "forms" }]
    : [{ key: "requirements", label: "Complete every required form, task and evidence item and resolve outstanding issues and sync changes.", target: "forms" }];
  if (job.stage === stage && (!visit || visit.status === visitStatus)) return { changed: false, stage, blockers };
  try {
    const trainingScope = { ownerUid: access.ownerUid, actorMemberId: access.memberId,
      assignedMemberId: visit?.assignee_member_id || job.assignee_member_id, workOrderId };
    await assertCertificateJobEligibility(db, trainingScope);
    const training = await certificateJobEligibilityGuards(db, trainingScope);
    const revision = nextJobRevision(job.revision);
    const guardSql = `EXISTS (SELECT 1 FROM trade_work_orders current_job WHERE current_job.id = ? AND current_job.firebase_uid = ?
      AND current_job.partner_type = 'installer' AND current_job.record_status = 'active'
      AND current_job.stage = ? AND current_job.revision = ? AND current_job.assignee_member_id = ?
      AND current_job.stage NOT IN ('imported', 'completed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM trade_crm_job_details d WHERE d.work_order_id=current_job.id AND d.firebase_uid=current_job.firebase_uid AND d.pipeline_stage='lost')
      AND (? = 1 OR ${jobMemberSql("current_job")})) AND ${actor.sql}
      AND ${VISIT_SNAPSHOT_SQL} = ?
      ${ready ? `AND ${completion.sql}` : ""}
      ${completesJob && !safeCompletionVisit ? unscheduledCompletion ? `AND ${COMPLETED_FORM_SQL}`
        : `AND EXISTS (SELECT 1 FROM trade_rental_inspections WHERE work_order_id = ? AND firebase_uid = ? AND status = 'issued')` : ""}`;
    const values = [workOrderId, access.ownerUid, job.stage, Number(job.revision), job.assignee_member_id,
      access.isOwner || access.jobScope === "team" ? 1 : 0, access.memberId, ...actor.values,
      workOrderId, access.ownerUid, job.visit_snapshot, ...(ready ? completion.values : []),
      ...(completesJob && !safeCompletionVisit ? unscheduledCompletion ? completedFormValues : [workOrderId, access.ownerUid] : [])];
    await db.batch([
      creditexWriteGuard(db, access.ownerUid, guardSql, values),
      ...training,
      ...(visit ? [db.prepare(`UPDATE trade_crm_appointments SET status = ?,
        work_started_at = CASE WHEN work_started_at = '' THEN ? ELSE work_started_at END,
        completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
        last_transition_by_uid = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND work_order_id = ? AND revision = ? AND assignee_member_id = ? AND status = ?`)
        .bind(visitStatus, now, visitStatus, now, access.actorUid, now, visit.id, access.ownerUid, workOrderId,
          Number(visit.revision), visit.assignee_member_id, visit.status)] : []),
      db.prepare(`UPDATE trade_work_orders SET stage = ?, revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(stage, revision, now, workOrderId, access.ownerUid),
      db.prepare(`UPDATE trade_crm_job_details SET pipeline_stage = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(completesJob ? "complete" : "in_progress", now, workOrderId, access.ownerUid),
      ...(completesJob ? [db.prepare(`UPDATE trade_crm_job_plans SET status = 'completed', completed_at = ?, updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(now, now, workOrderId, access.ownerUid),
      db.prepare(`UPDATE trade_crm_job_plan_phases SET status = 'completed', completed_at = ?, updated_at = ? WHERE firebase_uid = ?
        AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)`)
        .bind(now, now, access.ownerUid, workOrderId, access.ownerUid)] : []),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, completesJob ? "job_completed" : ready ? "form_visit_completed" : "form_work_started",
          completesJob ? "All required forms, work and evidence are complete. The job advanced automatically."
            : ready ? "Required forms and evidence are complete. This worker's visit advanced automatically; other visits remain open."
            : "Saved form activity started this job. Travel and arrival have not been inferred.", now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return { changed: true, stage, revision, blockers };
  } catch (error) {
    if (error instanceof CreditexComplianceError) return blocked(job.stage, "training", error.message, "training");
    if (creditexMutationConflict(error)) return { ...blocked(job.stage, "changed", "Job requirements or assignment changed while progress was checked."), pending: true };
    throw error;
  }
}

/** A completed form write must stay acknowledged if its derived job projection is temporarily unavailable.
 * Durable completion markers retry the strict default; only post-commit callers may opt into this pending result.
 */
export async function reconcileTradeFormJobProgress(access: TeamAccess, workOrderId: string,
  options: { startOnly?: boolean; db?: D1Database; now?: string; afterSave?: boolean } = {}): Promise<FormJobProgress> {
  try {
    return await applyTradeFormJobProgress(access, workOrderId, options);
  } catch (error) {
    if (!options.afterSave) throw error;
    console.error("Automatic job progress pending after a saved form", error instanceof Error ? error.message : "Unknown projection failure");
    return { changed: false, stage: "", pending: true,
      blockers: [{ key: "job_progress_pending", label: "The form is saved. Job status is waiting to sync.", target: "sync" }] };
  }
}
