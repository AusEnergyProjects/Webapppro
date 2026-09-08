export const TRADE_JOB_LIFECYCLE_STATUSES = [
  "unscheduled",
  "scheduled",
  "partial",
  "completed",
  "audited",
  "cancelled",
] as const;

export type TradeJobLifecycleStatus = typeof TRADE_JOB_LIFECYCLE_STATUSES[number];

export const TRADE_JOB_AUDIT_OUTCOMES = [
  "passed",
  "failed",
  "duplicate",
  "correction_required",
  "withdrawn",
] as const;

export type TradeJobAuditOutcome = typeof TRADE_JOB_AUDIT_OUTCOMES[number];

export const TRADE_JOB_LIFECYCLE_LABELS: Record<TradeJobLifecycleStatus, string> = {
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  partial: "Partial",
  completed: "Completed",
  audited: "Audited",
  cancelled: "Cancelled",
};

export const TRADE_JOB_AUDIT_OUTCOME_LABELS: Record<TradeJobAuditOutcome, string> = {
  passed: "Passed",
  failed: "Failed",
  duplicate: "Duplicate",
  correction_required: "Correction required",
  withdrawn: "Withdrawn",
};

export type TradeJobLifecycleInput = {
  workStage?: unknown;
  pipelineStage?: unknown;
  scheduleDate?: unknown;
  hasProgress?: unknown;
  auditOutcome?: unknown;
};

export type TradeJobLifecycle = {
  status: TradeJobLifecycleStatus;
  auditOutcome: TradeJobAuditOutcome | null;
};

const text = (value: unknown) => String(value || "").trim().toLowerCase();

const truthy = (value: unknown) => value === true || Number(value) === 1;

export function normaliseTradeJobAuditOutcome(value: unknown): TradeJobAuditOutcome | null {
  const outcome = text(value);
  if (["passed", "approved", "accepted"].includes(outcome)) return "passed";
  if (["failed", "rejected", "error"].includes(outcome)) return "failed";
  if (outcome === "duplicate") return "duplicate";
  if (["correction_required", "changes_required", "changes_requested"].includes(outcome)) {
    return "correction_required";
  }
  if (["withdrawn", "removed"].includes(outcome)) return "withdrawn";
  return null;
}

export function deriveTradeJobLifecycle(input: TradeJobLifecycleInput): TradeJobLifecycle {
  const workStage = text(input.workStage);
  const pipelineStage = text(input.pipelineStage);
  const auditOutcome = normaliseTradeJobAuditOutcome(input.auditOutcome);
  if (workStage === "cancelled" || pipelineStage === "lost") {
    return { status: "cancelled", auditOutcome: null };
  }
  const completed = workStage === "completed"
    || ["complete", "invoiced", "paid"].includes(pipelineStage);
  if (auditOutcome && completed) return { status: "audited", auditOutcome };
  if (completed) {
    return { status: "completed", auditOutcome: null };
  }
  if (["in_progress", "blocked"].includes(workStage)
    || pipelineStage === "in_progress"
    || truthy(input.hasProgress)) {
    return { status: "partial", auditOutcome: null };
  }
  if (workStage === "scheduled" || pipelineStage === "scheduled" || text(input.scheduleDate)) {
    return { status: "scheduled", auditOutcome: null };
  }
  return { status: "unscheduled", auditOutcome: null };
}

export function deriveTradeJobLifecycleStatus(input: TradeJobLifecycleInput): TradeJobLifecycleStatus {
  return deriveTradeJobLifecycle(input).status;
}

export function tradeJobLifecycleLabel(status: TradeJobLifecycleStatus) {
  return TRADE_JOB_LIFECYCLE_LABELS[status];
}

export function tradeJobAuditOutcomeLabel(outcome: TradeJobAuditOutcome | null | undefined) {
  return outcome ? TRADE_JOB_AUDIT_OUTCOME_LABELS[outcome] : "";
}

function auditOutcomeSql(casePredicate: (caseAlias: string) => string) {
  return `(SELECT audit_event.outcome
    FROM (
      SELECT CASE response.response_type
          WHEN 'accepted' THEN 'passed'
          WHEN 'rejected' THEN 'failed'
          WHEN 'error' THEN 'failed'
          WHEN 'duplicate' THEN 'duplicate'
          ELSE '' END outcome,
        response.occurred_at occurred_at, 4 source_rank, response.id event_id
      FROM compliance_submission_responses response
      JOIN compliance_submission_batch_items response_item
        ON response_item.id = response.batch_item_id
        AND response_item.organisation_id = response.organisation_id
      JOIN compliance_cases response_case
        ON response_case.id = response_item.case_id
        AND response_case.organisation_id = response_item.organisation_id
      WHERE ${casePredicate("response_case")}
        AND response.response_type IN ('accepted', 'rejected', 'error', 'duplicate')

      UNION ALL

      SELECT CASE decision.outcome
          WHEN 'approved' THEN 'passed'
          WHEN 'rejected' THEN 'failed'
          WHEN 'changes_required' THEN 'correction_required'
          WHEN 'withdrawn' THEN 'withdrawn'
          ELSE '' END outcome,
        decision.decided_at occurred_at, 3 source_rank, decision.id event_id
      FROM compliance_case_decisions decision
      JOIN compliance_cases decision_case
        ON decision_case.id = decision.case_id
        AND decision_case.organisation_id = decision.organisation_id
      WHERE ${casePredicate("decision_case")}
        AND decision.decision_type IN ('submission_outcome', 'case_closure')

      UNION ALL

      SELECT CASE batch_item.status
          WHEN 'accepted' THEN 'passed'
          WHEN 'rejected' THEN 'failed'
          WHEN 'correction_required' THEN 'correction_required'
          WHEN 'removed' THEN 'withdrawn'
          ELSE '' END outcome,
        batch_item.updated_at occurred_at, 2 source_rank, batch_item.id event_id
      FROM compliance_submission_batch_items batch_item
      JOIN compliance_cases batch_case
        ON batch_case.id = batch_item.case_id
        AND batch_case.organisation_id = batch_item.organisation_id
      WHERE ${casePredicate("batch_case")}
        AND batch_item.status IN ('accepted', 'rejected', 'correction_required', 'removed')

      UNION ALL

      SELECT CASE compliance_case.status
          WHEN 'accepted' THEN 'passed'
          WHEN 'rejected' THEN 'failed'
          WHEN 'changes_requested' THEN 'correction_required'
          ELSE '' END outcome,
        compliance_case.updated_at occurred_at, 1 source_rank, compliance_case.id event_id
      FROM compliance_cases compliance_case
      WHERE ${casePredicate("compliance_case")}
        AND compliance_case.status IN ('accepted', 'rejected', 'changes_requested')
    ) audit_event
    WHERE audit_event.outcome <> ''
    ORDER BY datetime(audit_event.occurred_at) DESC,
      audit_event.occurred_at DESC,
      audit_event.source_rank DESC,
      audit_event.event_id DESC
    LIMIT 1)`;
}

/**
 * Derives the newest explicit administrator/program outcome for one activity.
 * The supplied alias must expose the compliance-intent identity columns.
 */
export function tradeActivityAuditOutcomeSql(intentAlias = "i") {
  return auditOutcomeSql((caseAlias) => `${caseAlias}.work_order_id = ${intentAlias}.work_order_id
        AND ${caseAlias}.installer_uid = ${intentAlias}.installer_uid
        AND (${caseAlias}.compliance_intent_id = ${intentAlias}.id
          OR (${intentAlias}.compliance_case_id <> '' AND ${caseAlias}.id = ${intentAlias}.compliance_case_id))`);
}

/**
 * Derives the newest explicit administrator/program outcome for one work order.
 * Every active activity must have its own outcome before the parent job is
 * reported as audited. Jobs created before activity intents retain the legacy
 * work-order outcome projection.
 */
export function tradeJobAuditOutcomeSql(workAlias = "w") {
  const activeIntentWhere = (intentAlias: string) => `${intentAlias}.work_order_id = ${workAlias}.id
      AND ${intentAlias}.installer_uid = ${workAlias}.firebase_uid
      AND ${intentAlias}.status IN ('planned', 'case_linked')`;
  const legacyOutcomeSql = auditOutcomeSql((caseAlias) => `${caseAlias}.work_order_id = ${workAlias}.id
        AND ${caseAlias}.installer_uid = ${workAlias}.firebase_uid`);
  const activeIntentOutcomeSql = auditOutcomeSql((caseAlias) => `${caseAlias}.work_order_id = ${workAlias}.id
        AND ${caseAlias}.installer_uid = ${workAlias}.firebase_uid
        AND EXISTS (
          SELECT 1 FROM trade_work_order_compliance_intents outcome_intent
          WHERE ${activeIntentWhere("outcome_intent")}
            AND (${caseAlias}.compliance_intent_id = outcome_intent.id
              OR (outcome_intent.compliance_case_id <> ''
                AND ${caseAlias}.id = outcome_intent.compliance_case_id)))`);
  const pendingIntentOutcomeSql = tradeActivityAuditOutcomeSql("pending_audit_intent");
  return `(CASE
    WHEN EXISTS (
      SELECT 1 FROM trade_work_order_compliance_intents active_audit_intent
      WHERE ${activeIntentWhere("active_audit_intent")}
    ) THEN CASE WHEN NOT EXISTS (
      SELECT 1 FROM trade_work_order_compliance_intents pending_audit_intent
      WHERE ${activeIntentWhere("pending_audit_intent")}
        AND COALESCE(${pendingIntentOutcomeSql}, '') = ''
    ) THEN ${activeIntentOutcomeSql} ELSE NULL END
    ELSE ${legacyOutcomeSql}
  END)`;
}

/**
 * Actual field progress only. Automatically-created blank forms and scheduled
 * rental records do not move a job to partial.
 */
export function tradeJobHasProgressSql(workAlias = "w") {
  return `(EXISTS (
      SELECT 1 FROM trade_job_forms progress_form
      WHERE progress_form.work_order_id = ${workAlias}.id
        AND progress_form.firebase_uid = ${workAlias}.firebase_uid
        AND (progress_form.status = 'complete'
          OR (json_valid(progress_form.answers)
            AND trim(progress_form.answers) NOT IN ('', '{}', '[]', 'null')))
    OR EXISTS (
      SELECT 1 FROM trade_activity_field_records progress_record
      WHERE progress_record.work_order_id = ${workAlias}.id
        AND progress_record.owner_uid = ${workAlias}.firebase_uid
        AND (progress_record.status = 'submitted_for_creditex_review'
          OR COALESCE(json_extract(progress_record.payload, '$.hasUserEdits'), 0) = 1
          OR COALESCE(json_array_length(progress_record.payload, '$.evidence'), 0) > 0
          OR COALESCE(json_array_length(progress_record.payload, '$.signatures'), 0) > 0))
    OR EXISTS (
      SELECT 1 FROM compliance_activity_work_pack_instances progress_pack
      WHERE progress_pack.work_order_id = ${workAlias}.id
        AND progress_pack.status IN ('in_progress', 'ready_to_sign', 'completed')
        AND NOT EXISTS (
          SELECT 1 FROM compliance_activity_work_pack_instances newer_progress_pack
          WHERE newer_progress_pack.organisation_id = progress_pack.organisation_id
            AND newer_progress_pack.instance_key = progress_pack.instance_key
            AND newer_progress_pack.revision > progress_pack.revision))
    OR EXISTS (
      SELECT 1 FROM trade_rental_inspections progress_inspection
      WHERE progress_inspection.work_order_id = ${workAlias}.id
        AND progress_inspection.firebase_uid = ${workAlias}.firebase_uid
        AND progress_inspection.status IN ('in_progress', 'submitted', 'issuing', 'issued'))
    OR EXISTS (
      SELECT 1 FROM trade_rental_inspection_modules progress_module
      JOIN trade_rental_inspections module_inspection
        ON module_inspection.id = progress_module.inspection_id
        AND module_inspection.firebase_uid = progress_module.firebase_uid
      WHERE module_inspection.work_order_id = ${workAlias}.id
        AND module_inspection.firebase_uid = ${workAlias}.firebase_uid
        AND progress_module.status IN ('draft', 'complete'))
  ))`;
}

export function tradeJobLifecycleStatusSql(input: {
  workAlias?: string;
  detailAlias?: string;
  scheduleSql: string;
  auditOutcomeSql?: string;
  hasProgressSql?: string;
}) {
  const workAlias = input.workAlias || "w";
  const detailAlias = input.detailAlias || "d";
  const auditOutcomeSql = input.auditOutcomeSql || tradeJobAuditOutcomeSql(workAlias);
  const hasProgressSql = input.hasProgressSql || tradeJobHasProgressSql(workAlias);
  return `CASE
    WHEN ${workAlias}.stage = 'cancelled' OR ${detailAlias}.pipeline_stage = 'lost' THEN 'cancelled'
    WHEN COALESCE(${auditOutcomeSql}, '') <> ''
      AND (${workAlias}.stage = 'completed' OR ${detailAlias}.pipeline_stage IN ('complete', 'invoiced', 'paid')) THEN 'audited'
    WHEN ${workAlias}.stage = 'completed' OR ${detailAlias}.pipeline_stage IN ('complete', 'invoiced', 'paid') THEN 'completed'
    WHEN ${workAlias}.stage IN ('in_progress', 'blocked')
      OR ${detailAlias}.pipeline_stage = 'in_progress'
      OR ${hasProgressSql} THEN 'partial'
    WHEN ${workAlias}.stage = 'scheduled'
      OR ${detailAlias}.pipeline_stage = 'scheduled'
      OR trim(${input.scheduleSql}) <> '' THEN 'scheduled'
    ELSE 'unscheduled'
  END`;
}

export function tradeJobLifecycleRankSql(statusSql: string) {
  return `CASE ${statusSql}
    WHEN 'unscheduled' THEN 1
    WHEN 'scheduled' THEN 2
    WHEN 'partial' THEN 3
    WHEN 'completed' THEN 4
    WHEN 'audited' THEN 5
    WHEN 'cancelled' THEN 6
    ELSE 0 END`;
}
