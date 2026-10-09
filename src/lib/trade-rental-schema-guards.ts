import { JOB_DELETION_SCHEMA_GUARDS, upgradeJobDeletionGuards } from "./trade-job-deletion-schema-guards.ts";
// Sites splits migration SQL on semicolons, so rental trigger bodies are installed
// through D1 prepared statements after migration 0160 has created the tables.
import { canonicalTlinkSchemaGuardSql } from "./tlink-schema-guards.ts";

type RentalSchemaGuardDefinition = {
  readonly name: string;
  readonly sql: string;
};

function abortTrigger(input: {
  name: string;
  event: string;
  table: string;
  when?: string;
  message: string;
}): RentalSchemaGuardDefinition {
  const when = input.when ? ` WHEN ${input.when}` : "";
  return {
    name: input.name,
    sql: `CREATE TRIGGER IF NOT EXISTS \`${input.name}\` BEFORE ${input.event} ON \`${input.table}\` FOR EACH ROW${when} BEGIN SELECT RAISE(ABORT, '${input.message}'); END;`,
  };
}

const inspectionWorkOrderMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_work_orders work_order
  WHERE work_order.id = NEW.work_order_id AND work_order.firebase_uid = NEW.firebase_uid
) OR (NEW.service_site_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_crm_job_details detail
  WHERE detail.work_order_id = NEW.work_order_id AND detail.firebase_uid = NEW.firebase_uid
    AND detail.service_site_id = NEW.service_site_id
))`;

const moduleParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid
    AND EXISTS (SELECT 1 FROM json_each(COALESCE(inspection.selected_modules_snapshot, inspection.module_selection_snapshot)) selected WHERE selected.value = NEW.module_key)
)`;

const itemParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspection_modules module
  WHERE module.id = NEW.module_id AND module.inspection_id = NEW.inspection_id
    AND module.firebase_uid = NEW.firebase_uid
)`;

const findingParentMismatch = `${itemParentMismatch} OR (NEW.item_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_inspection_items item
  WHERE item.id = NEW.item_id AND item.module_id = NEW.module_id
    AND item.inspection_id = NEW.inspection_id AND item.firebase_uid = NEW.firebase_uid
))`;

const evidenceParentMismatch = `${findingParentMismatch} OR (NEW.finding_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_findings finding
  WHERE finding.id = NEW.finding_id AND finding.module_id = NEW.module_id
    AND finding.inspection_id = NEW.inspection_id AND finding.firebase_uid = NEW.firebase_uid
)) OR NOT EXISTS (
  SELECT 1 FROM trade_crm_job_media media
  JOIN trade_rental_inspections inspection ON inspection.id = NEW.inspection_id
  WHERE media.id = NEW.job_media_id AND media.work_order_id = inspection.work_order_id
    AND media.firebase_uid = NEW.firebase_uid AND inspection.firebase_uid = NEW.firebase_uid
)`;

const reportParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid
)`;

const reportLinkParentMismatch = `NEW.status <> 'active' OR NOT EXISTS (
  SELECT 1 FROM trade_rental_reports report
  JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
    AND inspection.firebase_uid = report.firebase_uid
  WHERE report.id = NEW.report_id AND report.inspection_id = NEW.inspection_id
    AND report.firebase_uid = NEW.firebase_uid AND report.status = 'issued'
    AND inspection.status = 'issued' AND inspection.issued_report_id = report.id
)`;

const eventParentMismatch = `${reportParentMismatch} OR (NEW.report_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_reports report
  WHERE report.id = NEW.report_id AND report.inspection_id = NEW.inspection_id
    AND report.firebase_uid = NEW.firebase_uid
)) OR (NEW.report_link_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_report_links link
  WHERE link.id = NEW.report_link_id AND link.inspection_id = NEW.inspection_id
    AND link.firebase_uid = NEW.firebase_uid
    AND (NEW.report_id = '' OR link.report_id = NEW.report_id)
))`;

const reportIdentityChanged = `NEW.id IS NOT OLD.id OR NEW.inspection_id IS NOT OLD.inspection_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.report_number IS NOT OLD.report_number
  OR NEW.revision IS NOT OLD.revision OR NEW.report_schema_version IS NOT OLD.report_schema_version
  OR NEW.report_snapshot IS NOT OLD.report_snapshot OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.staged_at IS NOT OLD.staged_at OR NEW.created_at IS NOT OLD.created_at`;

const terminalReportChanged = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND (
  NEW.id IS NOT OLD.id OR NEW.inspection_id IS NOT OLD.inspection_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.report_number IS NOT OLD.report_number
  OR NEW.revision IS NOT OLD.revision OR NEW.report_schema_version IS NOT OLD.report_schema_version
  OR NEW.report_snapshot IS NOT OLD.report_snapshot OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.pdf_object_key IS NOT OLD.pdf_object_key OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256
  OR NEW.pdf_size_bytes IS NOT OLD.pdf_size_bytes OR NEW.issued_by_uid IS NOT OLD.issued_by_uid
  OR NEW.issued_by_member_id IS NOT OLD.issued_by_member_id OR NEW.issuer_snapshot IS NOT OLD.issuer_snapshot
  OR NEW.staged_at IS NOT OLD.staged_at OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.created_at IS NOT OLD.created_at
)`;

const legacyReportTransitionInvalid = `NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'staged' AND NEW.status = 'issued' AND EXISTS (
    SELECT 1 FROM trade_rental_inspections inspection
    WHERE inspection.id = OLD.inspection_id AND inspection.firebase_uid = OLD.firebase_uid
      AND inspection.status = 'issuing'
  ))
  OR (OLD.status = 'staged' AND NEW.status = 'failed'
    AND NEW.pdf_object_key = OLD.pdf_object_key AND NEW.pdf_sha256 = OLD.pdf_sha256
    AND NEW.pdf_size_bytes = OLD.pdf_size_bytes AND NEW.issued_by_uid = OLD.issued_by_uid
    AND NEW.issued_by_member_id = OLD.issued_by_member_id AND NEW.issuer_snapshot = OLD.issuer_snapshot
    AND NEW.issued_at = OLD.issued_at)
  OR (OLD.status = 'issued' AND NEW.status IN ('superseded', 'withdrawn')
    AND datetime(NEW.superseded_at) IS NOT NULL)
)`;

const legacyInspectionIssueInvalid = `NEW.status = 'issued' AND NOT (
  OLD.status = 'issuing' AND NEW.issued_report_id <> '' AND datetime(NEW.issued_at) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM trade_rental_reports report
    WHERE report.id = NEW.issued_report_id AND report.inspection_id = OLD.id
      AND report.firebase_uid = OLD.firebase_uid AND report.status = 'issued'
      AND report.issued_at = NEW.issued_at
  )
)`;

const legacyTerminalInspectionChanged = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND (
  NEW.id IS NOT OLD.id OR NEW.work_order_id IS NOT OLD.work_order_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.service_site_id IS NOT OLD.service_site_id
  OR NEW.inspection_number IS NOT OLD.inspection_number OR NEW.jurisdiction IS NOT OLD.jurisdiction
  OR NEW.template_key IS NOT OLD.template_key OR NEW.template_version IS NOT OLD.template_version
  OR NEW.rules_effective_from IS NOT OLD.rules_effective_from
  OR NEW.module_selection_snapshot IS NOT OLD.module_selection_snapshot
  OR NEW.selected_modules_snapshot IS NOT OLD.selected_modules_snapshot
  OR NEW.property_snapshot IS NOT OLD.property_snapshot OR NEW.assessor_uid IS NOT OLD.assessor_uid
  OR NEW.assessor_member_id IS NOT OLD.assessor_member_id OR NEW.assessor_snapshot IS NOT OLD.assessor_snapshot
  OR NEW.creation_request_id IS NOT OLD.creation_request_id OR NEW.issued_report_id IS NOT OLD.issued_report_id
  OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.created_by_uid IS NOT OLD.created_by_uid OR NEW.created_at IS NOT OLD.created_at
)`;

// A formatting revision is a new immutable PDF, not a new assessment. Its
// owner request must bind the current report and preserve all frozen facts.
// Requests and report snapshots are append-only/immutable, so the final CAS
// can use this validated binding without unlocking assessed answers.
function formattingDeliveryHeld(inspection: string) {
  return `EXISTS (SELECT 1 FROM trade_rental_inspection_events review
    WHERE review.inspection_id = ${inspection}.id AND review.firebase_uid = ${inspection}.firebase_uid
      AND review.event_type = 'report_email_review_held' AND review.actor_type = 'owner'
      AND review.actor_uid = ${inspection}.firebase_uid
      AND review.rowid = (SELECT latest.rowid FROM trade_rental_inspection_events latest
        WHERE latest.inspection_id = ${inspection}.id AND latest.firebase_uid = ${inspection}.firebase_uid
          AND latest.event_type IN ('report_email_review_held', 'report_email_review_released')
        ORDER BY latest.rowid DESC LIMIT 1))
    AND NOT EXISTS (SELECT 1 FROM trade_rental_inspection_events delivery
      WHERE delivery.inspection_id = ${inspection}.id AND delivery.firebase_uid = ${inspection}.firebase_uid
        AND (delivery.event_type = 'report_email_accepted'
          OR (delivery.event_type = 'report_email_failed' AND json_extract(delivery.metadata, '$.outcome') = 'indeterminate')
          OR (delivery.event_type = 'report_email_requested' AND NOT EXISTS (
            SELECT 1 FROM trade_rental_inspection_events failure WHERE failure.inspection_id = delivery.inspection_id
              AND failure.firebase_uid = delivery.firebase_uid AND failure.report_id = delivery.report_id
              AND failure.event_type = 'report_email_failed' AND failure.request_id = delivery.request_id || ':failed'))))`;
}

function formattingRequestBinding(request: string, inspection: string, source: string, report: string) {
  return `${request}.actor_type = 'owner' AND ${request}.actor_uid = ${inspection}.firebase_uid
    AND ${request}.inspection_id = ${inspection}.id AND ${request}.firebase_uid = ${inspection}.firebase_uid
    AND ${request}.report_id = ${report}.id AND ${request}.report_link_id = '' AND ${request}.request_id <> ''
    AND json_extract(${request}.metadata, '$.sourceReportId') = ${source}.id
    AND json_extract(${request}.metadata, '$.sourceReportNumber') = ${source}.report_number
    AND json_extract(${request}.metadata, '$.sourceReportRevision') = ${source}.revision
    AND json_extract(${request}.metadata, '$.sourceSnapshotSha256') = ${source}.source_snapshot_sha256
    AND json_extract(${request}.metadata, '$.sourceIssuedAt') = ${source}.issued_at
    AND json_extract(${request}.metadata, '$.expectedInspectionRevision') = ${inspection}.revision
    AND json_extract(${request}.metadata, '$.reportRevision') = ${report}.revision
    AND json_extract(${request}.metadata, '$.snapshotSha256') = ${report}.source_snapshot_sha256`;
}

const formattingFactsPreserved = `json_remove(report.report_snapshot, '$.report', '$.evidence') = json_remove(source.report_snapshot, '$.report', '$.evidence')`;

// The separately authorised answer action corrects one access observation in
// the frozen report. It never changes the assessor's stored assessment rows.
const coolingAccessFactsPreserved = `json_extract(NEW.metadata, '$.field') = 'accessStatus'
    AND json_extract(NEW.metadata, '$.checkKey') = 'cooling_2027_readiness'
    AND json_extract(NEW.metadata, '$.fromValue') = 'Not accessed'
    AND json_extract(NEW.metadata, '$.toValue') = 'Clear access'
    AND json_extract(NEW.metadata, '$.correctedByOwnerUid') = inspection.firebase_uid
    AND json_extract(NEW.metadata, '$.correctedAt') = json_extract(report.report_snapshot, '$.report.generatedAt')
    AND datetime(json_extract(NEW.metadata, '$.correctedAt')) IS NOT NULL
    AND (SELECT COUNT(*) FROM json_each(source.report_snapshot, '$.modules') assessment_module
      JOIN json_each(assessment_module.value, '$.sections') section
      JOIN json_each(section.value, '$.items') item
      WHERE json_extract(item.value, '$.checkKey') = 'cooling_2027_readiness') = 1
    AND EXISTS (SELECT 1 FROM json_each(source.report_snapshot, '$.modules') assessment_module
      JOIN json_each(assessment_module.value, '$.sections') section
      JOIN json_each(section.value, '$.items') item
      WHERE json_extract(item.value, '$.checkKey') = 'cooling_2027_readiness'
        AND json_extract(item.value, '$.id') = json_extract(NEW.metadata, '$.itemId')
        AND json_extract(item.value, '$.response.applianceType') = 'No fixed cooling'
        AND json_extract(item.value, '$.response.accessStatus') = 'Not accessed'
        AND json_extract(NEW.metadata, '$.fieldPath') = '$.modules[' || assessment_module.key || '].sections[' || section.key || '].items[' || item.key || '].response.accessStatus')
    AND json_extract(report.report_snapshot, json_extract(NEW.metadata, '$.fieldPath')) = 'Clear access'
    AND json_remove(report.report_snapshot, '$.report', '$.evidence', '$.findings', json_extract(NEW.metadata, '$.fieldPath'))
      = json_remove(source.report_snapshot, '$.report', '$.evidence', '$.findings', json_extract(NEW.metadata, '$.fieldPath'))
    AND json_type(report.report_snapshot, '$.findings') = 'array' AND json_type(source.report_snapshot, '$.findings') = 'array'
    AND json_array_length(report.report_snapshot, '$.findings') = json_array_length(source.report_snapshot, '$.findings')
    AND NOT EXISTS (SELECT 1 FROM json_each(report.report_snapshot, '$.findings') finding
      WHERE NOT EXISTS (SELECT 1 FROM json_each(source.report_snapshot, '$.findings') original
        WHERE original.key = finding.key AND (
          (json_extract(original.value, '$.itemId') = json_extract(NEW.metadata, '$.itemId')
            AND json_extract(original.value, '$.details.responseSnapshot.accessStatus') = 'Not accessed'
            AND json_extract(finding.value, '$.details.responseSnapshot.accessStatus') = 'Clear access'
            AND json_remove(finding.value, '$.details.responseSnapshot.accessStatus') = json_remove(original.value, '$.details.responseSnapshot.accessStatus'))
          OR ((json_extract(original.value, '$.itemId') IS NOT json_extract(NEW.metadata, '$.itemId')
              OR json_type(original.value, '$.details.responseSnapshot.accessStatus') IS NULL)
            AND finding.value = original.value))))
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.field') = json_extract(NEW.metadata, '$.field')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.fieldPath') = json_extract(NEW.metadata, '$.fieldPath')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.checkKey') = json_extract(NEW.metadata, '$.checkKey')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.itemId') = json_extract(NEW.metadata, '$.itemId')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.fromValue') = json_extract(NEW.metadata, '$.fromValue')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.toValue') = json_extract(NEW.metadata, '$.toValue')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.correctedByOwnerUid') = json_extract(NEW.metadata, '$.correctedByOwnerUid')
    AND json_extract(report.report_snapshot, '$.report.answerCorrection.correctedAt') = json_extract(NEW.metadata, '$.correctedAt')`;

type RentalRevisionKind = "formatting" | "answer";

function revisionRequestedInvalid(kind: RentalRevisionKind) {
  const correction = kind === "formatting" ? "formattingCorrection" : "answerCorrection";
  const presentationPaths = "'$.id', '$.number', '$.revision', '$.issuedAt', '$.generatedAt', " + `'$.${correction}'`;
  return `NEW.event_type = 'report_${kind}_revision_requested' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  JOIN trade_rental_reports source ON source.id = inspection.issued_report_id
    AND source.inspection_id = inspection.id AND source.firebase_uid = inspection.firebase_uid AND source.status = 'issued'
  JOIN trade_rental_reports report ON report.id = NEW.report_id
    AND report.inspection_id = inspection.id AND report.firebase_uid = inspection.firebase_uid AND report.status = 'staged'
  WHERE inspection.id = NEW.inspection_id AND inspection.status = 'issued' AND source.id <> report.id
    AND report.revision > source.revision
    AND ${formattingRequestBinding("NEW", "inspection", "source", "report")}
    AND ${formattingDeliveryHeld("inspection")}
    AND json_extract(report.report_snapshot, '$.report.id') = report.id
    AND json_extract(report.report_snapshot, '$.report.number') = report.report_number
    AND json_extract(report.report_snapshot, '$.report.revision') = report.revision
    AND datetime(json_extract(report.report_snapshot, '$.report.issuedAt')) IS NOT NULL
    AND json_extract(report.report_snapshot, '$.report.${correction}.sourceReportId') = source.id
    AND json_extract(report.report_snapshot, '$.report.${correction}.sourceReportNumber') = source.report_number
    AND json_extract(report.report_snapshot, '$.report.${correction}.sourceReportRevision') = source.revision
    AND json_extract(report.report_snapshot, '$.report.${correction}.sourceIssuedAt') = source.issued_at
    AND ${kind === "formatting" ? formattingFactsPreserved : `(${coolingAccessFactsPreserved})`}
    AND json_remove(json_extract(report.report_snapshot, '$.report'), ${presentationPaths})
      = json_remove(json_extract(source.report_snapshot, '$.report'), ${presentationPaths})
    AND json_type(report.report_snapshot, '$.evidence') = 'array' AND json_type(source.report_snapshot, '$.evidence') = 'array'
    AND json_array_length(report.report_snapshot, '$.evidence') = json_array_length(source.report_snapshot, '$.evidence')
    AND NOT EXISTS (SELECT 1 FROM json_each(report.report_snapshot, '$.evidence') evidence
      WHERE substr(json_extract(evidence.value, '$.objectKey'), 1,
          length('trade-issued-documents/rental-report/' || report.id || '/revision-' || report.revision || '/evidence/'))
        <> 'trade-issued-documents/rental-report/' || report.id || '/revision-' || report.revision || '/evidence/'
        OR json_extract(evidence.value, '$.objectKey') IS NULL
        OR NOT EXISTS (SELECT 1 FROM json_each(source.report_snapshot, '$.evidence') original
          WHERE original.key = evidence.key AND json_remove(evidence.value, '$.objectKey') = json_remove(original.value, '$.objectKey')))
)`;
}

const formattingRequestedInvalid = revisionRequestedInvalid("formatting");
const answerRequestedInvalid = revisionRequestedInvalid("answer");

const formattingReportIssueAllowed = `EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  JOIN trade_rental_reports source ON source.id = inspection.issued_report_id
    AND source.inspection_id = inspection.id AND source.firebase_uid = inspection.firebase_uid AND source.status = 'issued'
  JOIN trade_rental_inspection_events request ON request.event_type IN ('report_formatting_revision_requested', 'report_answer_revision_requested')
    AND ${formattingRequestBinding("request", "inspection", "source", "NEW")}
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid
    AND inspection.status = 'issued' AND source.id <> NEW.id
    AND ${formattingDeliveryHeld("inspection")}
    AND NEW.issued_by_uid = source.issued_by_uid AND NEW.issued_by_member_id = source.issued_by_member_id
    AND NEW.issuer_snapshot = source.issuer_snapshot
    AND NEW.issued_at = json_extract(NEW.report_snapshot, '$.report.issuedAt')
)`;

const formattingInspectionPointerAllowed = `OLD.status = 'issued' AND NEW.status = 'issued'
  AND NEW.issued_at = OLD.issued_at AND NEW.revision = OLD.revision + 1
  AND NEW.issued_report_id <> OLD.issued_report_id AND EXISTS (
    SELECT 1 FROM trade_rental_reports source
    JOIN trade_rental_reports report ON report.id = NEW.issued_report_id
      AND report.inspection_id = OLD.id AND report.firebase_uid = OLD.firebase_uid AND report.status = 'issued'
    JOIN trade_rental_inspection_events request ON request.event_type IN ('report_formatting_revision_requested', 'report_answer_revision_requested')
      AND ${formattingRequestBinding("request", "OLD", "source", "report")}
    WHERE source.id = OLD.issued_report_id AND source.inspection_id = OLD.id
      AND source.firebase_uid = OLD.firebase_uid AND source.status = 'issued'
      AND ${formattingDeliveryHeld("OLD")}
      AND report.issued_by_uid = source.issued_by_uid AND report.issued_by_member_id = source.issued_by_member_id
      AND report.issuer_snapshot = source.issuer_snapshot
  )`;

function revisionIssuedInvalid(kind: RentalRevisionKind) {
  return `NEW.event_type = 'report_${kind}_revision_issued' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  JOIN trade_rental_reports report ON report.id = inspection.issued_report_id
    AND report.inspection_id = inspection.id AND report.firebase_uid = inspection.firebase_uid AND report.status = 'issued'
  JOIN trade_rental_inspection_events request ON request.inspection_id = inspection.id
    AND request.firebase_uid = inspection.firebase_uid AND request.report_id = report.id
    AND request.event_type = 'report_${kind}_revision_requested' AND request.actor_type = 'owner'
    AND request.actor_uid = inspection.firebase_uid AND request.metadata = NEW.metadata
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid AND inspection.status = 'issued'
    AND NEW.report_id = report.id AND NEW.report_link_id <> '' AND NEW.actor_type = 'owner'
    AND NEW.actor_uid = inspection.firebase_uid AND NEW.request_id <> ''
    AND inspection.revision = json_extract(request.metadata, '$.expectedInspectionRevision') + 1
    AND report.revision = json_extract(request.metadata, '$.reportRevision')
    AND report.source_snapshot_sha256 = json_extract(request.metadata, '$.snapshotSha256')
    AND ${formattingDeliveryHeld("inspection")}
)`;
}

const formattingIssuedInvalid = revisionIssuedInvalid("formatting");
const answerIssuedInvalid = revisionIssuedInvalid("answer");

const reportTransitionInvalid = legacyReportTransitionInvalid.replace(
  "OR (OLD.status = 'staged' AND NEW.status = 'failed'",
  `OR (OLD.status = 'staged' AND NEW.status = 'issued' AND ${formattingReportIssueAllowed})\n  OR (OLD.status = 'staged' AND NEW.status = 'failed'`,
);
const inspectionIssueInvalid = `(${legacyInspectionIssueInvalid}) AND NOT (${formattingInspectionPointerAllowed})`;
const terminalInspectionChanged = legacyTerminalInspectionChanged.replace(
  "OR NEW.creation_request_id IS NOT OLD.creation_request_id OR NEW.issued_report_id IS NOT OLD.issued_report_id",
  `OR NEW.creation_request_id IS NOT OLD.creation_request_id\n  OR (NEW.issued_report_id IS NOT OLD.issued_report_id AND NOT (${formattingInspectionPointerAllowed}))`,
);

const terminalInspectionTransitionInvalid = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'issued' AND NEW.status IN ('superseded', 'withdrawn')
    AND datetime(NEW.superseded_at) IS NOT NULL)
)`;

const reportLinkIdentityChanged = `NEW.id IS NOT OLD.id OR NEW.report_id IS NOT OLD.report_id
  OR NEW.inspection_id IS NOT OLD.inspection_id OR NEW.firebase_uid IS NOT OLD.firebase_uid
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.encrypted_token IS NOT OLD.encrypted_token
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by_uid IS NOT OLD.created_by_uid
  OR NEW.created_at IS NOT OLD.created_at`;

const reportLinkTransitionInvalid = `NOT (
  (OLD.status = 'active' AND NEW.status = 'active' AND NEW.token_issue = OLD.token_issue
    AND NEW.view_count >= OLD.view_count AND NEW.download_count >= OLD.download_count)
  OR (OLD.status = 'active' AND NEW.status = 'revoked'
    AND NEW.token_issue = OLD.token_issue + 1 AND datetime(NEW.revoked_at) IS NOT NULL)
  OR (OLD.status = 'active' AND NEW.status = 'expired'
    AND NEW.token_issue = OLD.token_issue AND datetime(OLD.expires_at) <= datetime(NEW.updated_at))
  OR (OLD.status = 'active' AND NEW.status = 'superseded' AND NEW.token_issue >= OLD.token_issue)
)`;

const lockedAssessment = (alias: "NEW" | "OLD") => `EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = ${alias}.inspection_id AND inspection.status IN ('issuing', 'issued', 'superseded', 'withdrawn')
)`;

const definitions: RentalSchemaGuardDefinition[] = [
  abortTrigger({ name: "trade_rental_inspections_work_order_guard_insert", event: "INSERT", table: "trade_rental_inspections", when: inspectionWorkOrderMismatch, message: "rental inspection work order mismatch" }),
  abortTrigger({ name: "trade_rental_inspections_work_order_guard_update", event: "UPDATE OF work_order_id, firebase_uid, service_site_id", table: "trade_rental_inspections", when: inspectionWorkOrderMismatch, message: "rental inspection work order mismatch" }),
  abortTrigger({ name: "trade_rental_inspections_issue_transition_guard", event: "UPDATE", table: "trade_rental_inspections", when: inspectionIssueInvalid, message: "rental inspection issue transition is invalid" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_immutable", event: "UPDATE", table: "trade_rental_inspections", when: terminalInspectionChanged, message: "issued rental inspection is immutable" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_transition_guard", event: "UPDATE", table: "trade_rental_inspections", when: terminalInspectionTransitionInvalid, message: "rental inspection transition is invalid" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_delete_guard", event: "DELETE", table: "trade_rental_inspections", when: "OLD.status IN ('issued', 'superseded', 'withdrawn')", message: "issued rental inspection is retained" }),
  abortTrigger({ name: "trade_rental_modules_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_modules", when: moduleParentMismatch, message: "rental module parent mismatch" }),
  abortTrigger({ name: "trade_rental_modules_parent_guard_update", event: "UPDATE OF inspection_id, firebase_uid, module_key", table: "trade_rental_inspection_modules", when: moduleParentMismatch, message: "rental module parent mismatch" }),
  abortTrigger({ name: "trade_rental_items_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_items", when: itemParentMismatch, message: "rental item parent mismatch" }),
  abortTrigger({ name: "trade_rental_items_parent_guard_update", event: "UPDATE OF inspection_id, module_id, firebase_uid", table: "trade_rental_inspection_items", when: itemParentMismatch, message: "rental item parent mismatch" }),
  abortTrigger({ name: "trade_rental_findings_parent_guard_insert", event: "INSERT", table: "trade_rental_findings", when: findingParentMismatch, message: "rental finding parent mismatch" }),
  abortTrigger({ name: "trade_rental_findings_parent_guard_update", event: "UPDATE OF inspection_id, module_id, item_id, firebase_uid", table: "trade_rental_findings", when: findingParentMismatch, message: "rental finding parent mismatch" }),
  abortTrigger({ name: "trade_rental_evidence_parent_guard_insert", event: "INSERT", table: "trade_rental_evidence_links", when: evidenceParentMismatch, message: "rental evidence parent mismatch" }),
  abortTrigger({ name: "trade_rental_evidence_parent_guard_update", event: "UPDATE OF inspection_id, module_id, item_id, finding_id, job_media_id, firebase_uid", table: "trade_rental_evidence_links", when: evidenceParentMismatch, message: "rental evidence parent mismatch" }),
  abortTrigger({ name: "trade_rental_reports_parent_guard_insert", event: "INSERT", table: "trade_rental_reports", when: reportParentMismatch, message: "rental report parent mismatch" }),
  abortTrigger({ name: "trade_rental_reports_parent_guard_update", event: "UPDATE OF inspection_id, firebase_uid", table: "trade_rental_reports", when: reportParentMismatch, message: "rental report parent mismatch" }),
  abortTrigger({ name: "trade_rental_report_links_parent_guard_insert", event: "INSERT", table: "trade_rental_report_links", when: reportLinkParentMismatch, message: "rental report link parent mismatch" }),
  abortTrigger({ name: "trade_rental_report_links_parent_guard_update", event: "UPDATE OF report_id, inspection_id, firebase_uid", table: "trade_rental_report_links", when: reportLinkParentMismatch, message: "rental report link parent mismatch" }),
  abortTrigger({ name: "trade_rental_events_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: eventParentMismatch, message: "rental event parent mismatch" }),
  abortTrigger({ name: "trade_rental_formatting_request_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: formattingRequestedInvalid, message: "rental report formatting request is invalid" }),
  abortTrigger({ name: "trade_rental_formatting_issued_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: formattingIssuedInvalid, message: "rental report formatting issue event is invalid" }),
  abortTrigger({ name: "trade_rental_answer_request_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: answerRequestedInvalid, message: "rental report answer request is invalid" }),
  abortTrigger({ name: "trade_rental_answer_issued_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: answerIssuedInvalid, message: "rental report answer issue event is invalid" }),
  abortTrigger({ name: "trade_rental_events_append_only_update", event: "UPDATE", table: "trade_rental_inspection_events", message: "rental inspection events are append only" }),
  abortTrigger({ name: "trade_rental_events_append_only_delete", event: "DELETE", table: "trade_rental_inspection_events", message: "rental inspection events are append only" }),
  abortTrigger({ name: "trade_rental_reports_identity_immutable", event: "UPDATE", table: "trade_rental_reports", when: reportIdentityChanged, message: "rental report identity is immutable" }),
  abortTrigger({ name: "trade_rental_reports_terminal_immutable", event: "UPDATE", table: "trade_rental_reports", when: terminalReportChanged, message: "issued rental report is immutable" }),
  abortTrigger({ name: "trade_rental_reports_transition_guard", event: "UPDATE", table: "trade_rental_reports", when: reportTransitionInvalid, message: "rental report transition is invalid" }),
  abortTrigger({ name: "trade_rental_reports_issued_delete_guard", event: "DELETE", table: "trade_rental_reports", when: "OLD.status IN ('issued', 'superseded', 'withdrawn')", message: "issued rental report is retained" }),
  abortTrigger({ name: "trade_rental_report_links_identity_guard", event: "UPDATE", table: "trade_rental_report_links", when: reportLinkIdentityChanged, message: "rental report link identity is immutable" }),
  abortTrigger({ name: "trade_rental_report_links_transition_guard", event: "UPDATE", table: "trade_rental_report_links", when: reportLinkTransitionInvalid, message: "rental report link transition is invalid" }),
  abortTrigger({ name: "trade_rental_report_links_delete_guard", event: "DELETE", table: "trade_rental_report_links", message: "rental report link history is retained" }),
];

for (const table of [
  "trade_rental_inspection_modules",
  "trade_rental_inspection_items",
  "trade_rental_findings",
  "trade_rental_evidence_links",
]) {
  const prefix = table.replace(/^trade_rental_/, "trade_rental_").replace(/_inspection_/, "_");
  definitions.push(
    abortTrigger({ name: `${prefix}_issued_lock_insert`, event: "INSERT", table, when: lockedAssessment("NEW"), message: "issued rental assessment is immutable" }),
    abortTrigger({ name: `${prefix}_issued_lock_update`, event: "UPDATE", table, when: lockedAssessment("OLD"), message: "issued rental assessment is immutable" }),
    abortTrigger({ name: `${prefix}_issued_lock_delete`, event: "DELETE", table, when: lockedAssessment("OLD"), message: "issued rental assessment is immutable" }),
  );
}

export const TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS: readonly RentalSchemaGuardDefinition[] = definitions.map((definition) => JOB_DELETION_SCHEMA_GUARDS.find((replacement) => replacement.name === definition.name) || definition);

// Retain the exact released contracts for this one additive runtime upgrade.
// Unexpected installed SQL must still fail rather than silently being replaced.
const previousFormattingGuards = new Map([
  abortTrigger({ name: "trade_rental_inspections_issue_transition_guard", event: "UPDATE", table: "trade_rental_inspections", when: legacyInspectionIssueInvalid, message: "rental inspection issue transition is invalid" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_immutable", event: "UPDATE", table: "trade_rental_inspections", when: legacyTerminalInspectionChanged, message: "issued rental inspection is immutable" }),
  abortTrigger({ name: "trade_rental_reports_transition_guard", event: "UPDATE", table: "trade_rental_reports", when: legacyReportTransitionInvalid, message: "rental report transition is invalid" }),
].map((definition) => [definition.name, definition.sql]));

// Sites 839 installed this exact answer guard before discovering D1's depth
// limit of 100. Only its released fingerprint may be replaced by the grouped
// equivalent; unfamiliar guard SQL remains a hard error.
const previousRentalGuardHashes = new Map([
  ["trade_rental_answer_request_guard_insert", "437e583ab4cb92ea2ae49024868a0824e7400a3c16e24cd5d1978eb560fc4faa"],
]);

async function rentalGuardHash(sql: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTlinkSchemaGuardSql(sql)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const REQUIRED_COLUMNS = {
  trade_work_orders: ["id", "firebase_uid"],
  trade_crm_job_details: ["work_order_id", "firebase_uid", "service_site_id"],
  trade_crm_job_media: ["id", "work_order_id", "firebase_uid"],
  trade_rental_inspections: [
    "id", "work_order_id", "firebase_uid", "service_site_id", "inspection_number", "jurisdiction",
    "status", "template_key", "template_version", "rules_effective_from", "module_selection_snapshot",
    "selected_modules_snapshot",
    "property_snapshot", "assessor_uid", "assessor_member_id", "assessor_snapshot", "creation_request_id",
    "issued_report_id", "submitted_at", "issued_at", "superseded_at", "created_by_uid", "created_at", "revision",
  ],
  trade_rental_inspection_modules: ["id", "inspection_id", "firebase_uid", "module_key", "selected_required"],
  trade_rental_inspection_items: ["id", "inspection_id", "module_id", "firebase_uid"],
  trade_rental_findings: ["id", "inspection_id", "module_id", "item_id", "firebase_uid"],
  trade_rental_evidence_links: ["id", "inspection_id", "module_id", "item_id", "finding_id", "job_media_id", "firebase_uid"],
  trade_rental_reports: [
    "id", "inspection_id", "firebase_uid", "report_number", "revision", "status",
    "report_schema_version", "report_snapshot", "source_snapshot_sha256", "pdf_object_key",
    "pdf_sha256", "pdf_size_bytes", "issued_by_uid", "issued_by_member_id",
    "issuer_snapshot", "staged_at", "issued_at", "superseded_at", "created_at",
  ],
  trade_rental_report_links: [
    "id", "report_id", "inspection_id", "firebase_uid", "token_hash", "encrypted_token",
    "token_issue", "status", "expires_at", "revoked_at", "created_by_uid", "last_viewed_at",
    "last_downloaded_at", "view_count", "download_count", "created_at", "updated_at",
  ],
  trade_rental_inspection_events: ["id", "inspection_id", "report_id", "report_link_id", "firebase_uid", "event_type", "actor_type", "actor_uid", "request_id", "metadata"],
} as const;

// Cache completed verification only. D1 I/O belongs to the request that starts
// it; another invocation must not inherit a stalled or cancelled request.
const readinessByDatabase = new WeakSet<object>();

async function requireRentalSchemaMigration(database: D1Database) {
  const missing: string[] = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = await database.prepare(`PRAGMA table_xinfo(\`${table}\`)`).all<{ name: string }>();
    const installed = new Set(columns.results.map((row) => String(row.name)));
    if (!installed.size) {
      missing.push(`table:${table}`);
      continue;
    }
    for (const column of required) if (!installed.has(column)) missing.push(`column:${table}.${column}`);
  }
  if (missing.length) throw new Error(`TRADE_RENTAL_SCHEMA_MIGRATION_REQUIRED:${missing.join(",")}`);
}

async function installRentalSchemaGuards(database: D1Database) {
  await requireRentalSchemaMigration(database);
  await upgradeJobDeletionGuards(database, JOB_DELETION_SCHEMA_GUARDS.filter((definition) => definition.name === "trade_rental_events_append_only_delete"), canonicalTlinkSchemaGuardSql);
  const rows = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const installed = new Map(rows.results.map((row) => [String(row.name), String(row.sql || "")]));
  const upgrades: D1PreparedStatement[] = [];
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) {
    const current = installed.get(definition.name);
    if (current && canonicalTlinkSchemaGuardSql(current) !== canonicalTlinkSchemaGuardSql(definition.sql)) {
      const previous = previousFormattingGuards.get(definition.name);
      const previousHash = previousRentalGuardHashes.get(definition.name);
      const knownPrevious = previous && canonicalTlinkSchemaGuardSql(current) === canonicalTlinkSchemaGuardSql(previous)
        || previousHash && await rentalGuardHash(current) === previousHash;
      if (!knownPrevious) {
        throw new Error(`TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:${definition.name}`);
      }
      upgrades.push(database.prepare(`DROP TRIGGER \`${definition.name}\``), database.prepare(definition.sql));
    }
  }
  const missing = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.filter((definition) => !installed.has(definition.name));
  upgrades.push(...missing.map((definition) => database.prepare(definition.sql)));
  if (upgrades.length) await database.batch(upgrades);
  const verified = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const verifiedMap = new Map(verified.results.map((row) => [String(row.name), String(row.sql || "")]));
  const unavailable = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.filter((definition) =>
    canonicalTlinkSchemaGuardSql(verifiedMap.get(definition.name) || "") !== canonicalTlinkSchemaGuardSql(definition.sql));
  if (unavailable.length) {
    throw new Error(`TRADE_RENTAL_SCHEMA_GUARDS_UNAVAILABLE:${unavailable.map((definition) => definition.name).join(",")}`);
  }
}

export async function ensureTradeRentalSchemaGuards(database: D1Database) {
  const key = database as object;
  if (readinessByDatabase.has(key)) return;
  await installRentalSchemaGuards(database);
  readinessByDatabase.add(key);
}
