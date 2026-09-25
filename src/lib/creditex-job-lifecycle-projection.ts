import { creditexIntentCompletionSnapshotSql, creditexIntentOpenCorrectionSql, creditexIntentSubmissionSnapshotSql } from "./creditex-job-lifecycle-sql.ts";

// Each Jobs row is one intent/activity, not every certificate for the work order.
// Keep only the latest packet for each work-pack key and retain actual lodgement
// separately from membership of a downloaded batch.
export const SUBMISSION_PACKETS_SQL = `(SELECT json_group_array(json_object(
    'status', COALESCE((SELECT event.to_status FROM compliance_output_action_events event
      WHERE event.organisation_id = packet.organisation_id AND event.packet_id = packet.id
      ORDER BY event.sequence DESC LIMIT 1), 'prepared'),
    'approved', EXISTS (SELECT 1 FROM compliance_output_action_reviews review
      WHERE review.organisation_id = packet.organisation_id AND review.packet_id = packet.id
        AND review.packet_sha256 = packet.packet_sha256 AND review.reviewed_by_uid <> packet.prepared_by_uid
        AND review.decision = 'approved'),
    'lodged', EXISTS (SELECT 1 FROM compliance_output_action_events submitted
      WHERE submitted.organisation_id = packet.organisation_id AND submitted.packet_id = packet.id
        AND submitted.to_status = 'submitted'),
    'exported', EXISTS (SELECT 1 FROM creditex_registry_batch_items item
      JOIN creditex_registry_batches batch ON batch.organisation_id = item.organisation_id
        AND batch.id = item.batch_id
      WHERE item.organisation_id = packet.organisation_id AND item.packet_id = packet.id
        AND item.packet_sha256 = packet.packet_sha256),
    'dispatchPending', EXISTS (SELECT 1 FROM compliance_output_dispatch_intents dispatch
      WHERE dispatch.organisation_id = packet.organisation_id AND dispatch.packet_id = packet.id
        AND dispatch.status IN ('dispatching', 'uncertain')),
    'registryStatus', COALESCE((SELECT result.registry_status FROM creditex_registry_results result
      LEFT JOIN creditex_registry_result_reviews review
        ON review.organisation_id = result.organisation_id AND review.result_id = result.id
      WHERE result.organisation_id = packet.organisation_id AND result.packet_id = packet.id
        AND (review.decision = 'approved' OR result.source = 'rec_public_register')
      ORDER BY result.occurred_at DESC, result.created_at DESC, result.id DESC LIMIT 1), ''),
    'currentCase', packet.case_revision = linked_case.revision
  )) FROM compliance_output_action_packets packet
  WHERE packet.organisation_id = linked_case.organisation_id
    AND packet.compliance_case_id = linked_case.id
    AND packet.program_code = intent.program_code
    AND packet.output_code = json_extract(intent.intent_snapshot, '$.program.claimOutputCode')
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances current_pack
      WHERE current_pack.organisation_id = packet.organisation_id AND current_pack.compliance_case_id = packet.compliance_case_id
        AND current_pack.instance_key = packet.work_pack_instance_key AND current_pack.revision > packet.work_pack_revision)
    AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events correction
      WHERE correction.organisation_id = intent.compliance_organisation_id AND correction.intent_id = intent.id
        AND correction.work_order_id = intent.work_order_id AND correction.owner_uid = intent.installer_uid
        AND correction.action = 'correction_required' AND correction.created_at >= packet.prepared_at)
    AND NOT EXISTS (SELECT 1 FROM compliance_output_action_packets newer
      WHERE newer.organisation_id = packet.organisation_id
        AND newer.compliance_case_id = packet.compliance_case_id
        AND newer.work_pack_instance_key = packet.work_pack_instance_key
        AND newer.output_code = packet.output_code
        AND (newer.work_pack_revision > packet.work_pack_revision
          OR (newer.work_pack_revision = packet.work_pack_revision AND newer.case_revision > packet.case_revision)
          OR (newer.work_pack_revision = packet.work_pack_revision AND newer.case_revision = packet.case_revision
            AND (newer.prepared_at > packet.prepared_at OR (newer.prepared_at = packet.prepared_at AND newer.id > packet.id)))))
  )`;

export const FIELD_PROGRESS_SQL = `(SELECT json_object(
    'complete', field.status = 'submitted_for_creditex_review' AND field.pdf_object_key <> '' AND length(field.pdf_sha256) = 64,
    'progress', COALESCE(json_extract(field.payload, '$.hasUserEdits'), 0) = 1
      OR COALESCE(json_array_length(field.payload, '$.evidence'), 0) > 0
      OR COALESCE(json_array_length(field.payload, '$.signatures'), 0) > 0)
  FROM trade_activity_field_records field
  WHERE field.intent_id = intent.id AND field.owner_uid = intent.installer_uid
    AND field.work_order_id = intent.work_order_id AND field.organisation_id = intent.compliance_organisation_id
    AND field.activity_template_id = intent.activity_template_id
    AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records successor
      WHERE successor.supersedes_record_id = field.id AND successor.organisation_id = field.organisation_id) LIMIT 1)`;

export const WORK_PACK_PROGRESS_SQL = `(SELECT json_group_array(json_object('status', pack.status,
    'final', EXISTS (SELECT 1 FROM compliance_activity_work_pack_final_records final
      WHERE final.organisation_id = pack.organisation_id AND final.case_instance_id = pack.id
        AND final.instance_key = pack.instance_key AND final.work_pack_version_id = pack.work_pack_version_id)))
  FROM compliance_activity_work_pack_instances pack
  WHERE pack.organisation_id = linked_case.organisation_id AND pack.compliance_case_id = linked_case.id
    AND pack.work_order_id = intent.work_order_id
    AND (pack.compliance_intent_id = intent.id OR pack.compliance_intent_id = '')
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer
      WHERE newer.organisation_id = pack.organisation_id AND newer.instance_key = pack.instance_key
        AND newer.revision > pack.revision))`;

export const CREDITEX_AUDIT_SQL = `COALESCE((SELECT decision.outcome = 'approved'
      AND trim(decision.primary_reviewer_uid) <> '' AND trim(decision.secondary_reviewer_uid) <> ''
      AND decision.primary_reviewer_uid <> decision.secondary_reviewer_uid
    FROM compliance_case_decisions decision
    WHERE decision.organisation_id = linked_case.organisation_id AND decision.case_id = linked_case.id
      AND decision.case_revision = linked_case.revision AND decision.decision_type = 'ready_to_submit'
      AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events correction
        WHERE correction.organisation_id = intent.compliance_organisation_id AND correction.intent_id = intent.id
          AND correction.work_order_id = intent.work_order_id AND correction.owner_uid = intent.installer_uid
          AND correction.action = 'correction_required' AND correction.created_at >= decision.decided_at)
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), 0)`;

export const TRADE_REVIEW_SQL = `(SELECT CASE WHEN review.actor_kind = 'trade' AND review.action = 'reviewed'
    AND review.source_snapshot = ${creditexIntentCompletionSnapshotSql("intent")} THEN 'reviewed' ELSE '' END
  FROM creditex_job_lifecycle_events review
  WHERE review.organisation_id = intent.compliance_organisation_id AND review.work_order_id = intent.work_order_id
    AND review.owner_uid = intent.installer_uid AND review.intent_id = intent.id
    AND review.action IN ('reviewed', 'correction_required')
  ORDER BY review.created_at DESC, review.id DESC LIMIT 1)`;

export const CREDITEX_PAYOUT_SQL = `EXISTS (SELECT 1 FROM creditex_job_lifecycle_events payout
  WHERE payout.organisation_id = intent.compliance_organisation_id AND payout.work_order_id = intent.work_order_id
    AND payout.owner_uid = intent.installer_uid AND payout.intent_id = intent.id
    AND payout.actor_kind IN ('compliance', 'admin') AND payout.action = 'payout_recorded'
    AND payout.recipient_uid = intent.installer_uid AND payout.amount_minor > 0 AND trim(payout.reference) <> ''
    AND payout.source_snapshot = ${creditexIntentSubmissionSnapshotSql("intent")})`;

// A recorded correction owns its original case flags. Its current completion
// snapshot decides whether field corrections are still open; a later case
// correction remains independent and cannot be cleared by an older resubmission.
export const CREDITEX_CASE_CORRECTION_SQL = `((linked_case.status IN ('changes_requested','rejected')
    OR linked_case.evidence_status = 'changes_required')
  AND NOT EXISTS (SELECT 1 FROM creditex_job_lifecycle_events correction
    WHERE correction.organisation_id = intent.compliance_organisation_id AND correction.intent_id = intent.id
      AND correction.work_order_id = intent.work_order_id AND correction.owner_uid = intent.installer_uid
      AND correction.action = 'correction_required' AND correction.created_at >= COALESCE(linked_case.updated_at, '')))`;

/** SQL equivalent of deriveCreditexJobLifecycle for registers that filter and sort in D1. */
export function creditexIntentLifecycleStatusSql(workAlias: string, scheduleSql: string) {
  if (!/^[a-z][a-z_]*$/.test(workAlias)) throw new Error("INVALID_LIFECYCLE_SQL_ALIAS");
  const packetWhere = (predicate: string) => `EXISTS (SELECT 1 FROM json_each(source.packets) packet WHERE ${predicate})`;
  const packet = (key: string) => `json_extract(packet.value, '$.${key}')`;
  return `(SELECT CASE
    WHEN ${workAlias}.record_status = 'archived' THEN 'deleted'
    WHEN ${packetWhere(`${packet('lodged')} = 1 AND (${packet('status')} = 'rejected' OR ${packet('registryStatus')} = 'rejected')`)} THEN 'failed'
    WHEN source.correction OR ${CREDITEX_CASE_CORRECTION_SQL}
      OR ${packetWhere(`${packet('status')} = 'rejected' AND ${packet('lodged')} <> 1`)} THEN 'correction_required'
    WHEN json_array_length(source.packets) > 0 AND NOT ${packetWhere(`${packet('lodged')} <> 1`)}
      THEN CASE WHEN source.paid THEN 'paid' ELSE 'submitted' END
    WHEN source.audited OR (json_array_length(source.packets) > 0
      AND NOT ${packetWhere(`${packet('approved')} <> 1 OR ${packet('currentCase')} <> 1`)}) THEN 'audited'
    WHEN ${workAlias}.stage = 'cancelled' THEN 'cancelled'
    WHEN ${workAlias}.stage = 'no_show' THEN 'no_show'
    WHEN source.reviewed = 'reviewed' THEN 'reviewed'
    WHEN json_extract(source.field,'$.complete') = 1 OR (json_array_length(source.packs) > 0
      AND NOT EXISTS (SELECT 1 FROM json_each(source.packs) pack WHERE json_extract(pack.value,'$.status') <> 'completed' OR json_extract(pack.value,'$.final') <> 1))
      OR ${workAlias}.stage = 'completed' THEN 'complete'
    WHEN json_extract(source.field,'$.progress') = 1 OR ${workAlias}.stage IN ('in_progress','blocked')
      OR EXISTS (SELECT 1 FROM json_each(source.packs) pack WHERE json_extract(pack.value,'$.status') IN ('in_progress','ready_to_sign')) THEN 'partial'
    WHEN ${workAlias}.stage = 'scheduled' OR trim(${scheduleSql}) <> '' THEN 'assigned'
    ELSE 'unscheduled' END
    FROM (SELECT ${SUBMISSION_PACKETS_SQL} packets, ${FIELD_PROGRESS_SQL} field, ${WORK_PACK_PROGRESS_SQL} packs,
      ${CREDITEX_AUDIT_SQL} audited, ${TRADE_REVIEW_SQL} reviewed, ${CREDITEX_PAYOUT_SQL} paid,
      ${creditexIntentOpenCorrectionSql('intent')} correction) source)`;
}

/** Every current activity must reach a milestone before the whole job claims it. */
export function creditexWholeJobLifecycleSql(workAlias: string, scheduleSql: string) {
  if (!/^[a-z][a-z_]*$/.test(workAlias)) throw new Error("INVALID_LIFECYCLE_SQL_ALIAS");
  return `(SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN SUM(status = 'deleted') > 0 THEN 'deleted'
    WHEN SUM(status = 'failed') > 0 THEN 'failed'
    WHEN SUM(status = 'correction_required') > 0 THEN 'correction_required'
    WHEN SUM(status = 'paid') = COUNT(*) THEN 'paid'
    WHEN SUM(status IN ('paid','submitted')) = COUNT(*) THEN 'submitted'
    WHEN SUM(status IN ('paid','submitted','audited')) = COUNT(*) THEN 'audited'
    WHEN SUM(status IN ('paid','submitted','audited','reviewed')) = COUNT(*) THEN 'reviewed'
    WHEN SUM(status IN ('paid','submitted','audited','reviewed','complete')) = COUNT(*) THEN 'completed'
    WHEN SUM(status = 'cancelled') = COUNT(*) THEN 'cancelled'
    WHEN SUM(status = 'no_show') = COUNT(*) THEN 'no_show'
    WHEN SUM(status IN ('paid','submitted','audited','reviewed','complete','partial')) > 0 THEN 'partial'
    WHEN SUM(status = 'assigned') > 0 THEN 'scheduled'
    ELSE 'unscheduled' END
    FROM (SELECT ${creditexIntentLifecycleStatusSql(workAlias, scheduleSql)} status
      FROM trade_work_order_compliance_intents intent
      LEFT JOIN compliance_cases linked_case ON linked_case.id = intent.compliance_case_id
        AND linked_case.organisation_id = intent.compliance_organisation_id
        AND linked_case.installer_uid = intent.installer_uid AND linked_case.work_order_id = intent.work_order_id
        AND linked_case.compliance_intent_id = intent.id
      WHERE intent.work_order_id = ${workAlias}.id AND intent.installer_uid = ${workAlias}.firebase_uid
        AND intent.status IN ('planned','case_linked')) activities)`;
}
