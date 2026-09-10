import { jobDeletionPermitSql, type JobDeletionGuard } from "./trade-job-deletion-schema-guards.ts";

// Automatic job preparation pins a case to a planned intent. A draft status on
// its own is insufficient: earlier submitted/reviewed/signed revisions survive.
const retainedCaseChildren = [
  ["compliance_case_assignments", "case_id"],
  ["compliance_case_tasks", "case_id"],
  ["compliance_case_findings", "case_id"],
  ["compliance_case_decisions", "case_id"],
  ["compliance_decision_requests", "case_id"],
  ["compliance_submission_batch_items", "case_id"],
  ["compliance_parallel_reconciliation_rows", "case_id"],
  ["compliance_parallel_reference_bindings", "tlink_case_id"],
  ["compliance_sres_activation_records", "case_id"],
  ["compliance_sres_activation_snapshots", "case_id"],
  ["compliance_output_action_packets", "compliance_case_id"],
] as const;
const retainedWorkPackChildren = [
  "compliance_activity_work_pack_signatures",
  "compliance_activity_work_pack_calculation_reviews",
  "compliance_activity_work_pack_final_records",
  "compliance_activity_work_pack_render_receipts",
] as const;

function unfinishedCaseSql(c: string) {
  const instances = `SELECT id FROM compliance_activity_work_pack_instances WHERE compliance_case_id = ${c}.id`;
  const evidence = `SELECT id FROM compliance_case_evidence WHERE case_id = ${c}.id`;
  const referencedDependency = (id: string) => `EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances source_instance,
    json_each(source_instance.response_snapshot, '$.response.dependencyResolutions') dependency,
    json_each(dependency.value, '$.referenceIds') reference
    WHERE source_instance.compliance_case_id = ${c}.id AND reference.value = ${id})`;
  return `${c}.status = 'draft' AND ${c}.evidence_status IN ('not_started', 'in_progress')
    AND ${c}.created_by_type = 'installer' AND ${c}.created_by_uid = ${c}.installer_uid
    AND EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent
      WHERE intent.id = ${c}.compliance_intent_id AND intent.compliance_case_id = ${c}.id
        AND intent.work_order_id = ${c}.work_order_id AND intent.installer_uid = ${c}.installer_uid
        AND intent.compliance_organisation_id = ${c}.organisation_id AND intent.status = 'case_linked')
    AND NOT EXISTS (SELECT 1 FROM compliance_case_events event WHERE event.case_id = ${c}.id
      AND (event.organisation_id <> ${c}.organisation_id OR event.event_type <> 'case_created'
        OR event.actor_type <> 'installer' OR event.actor_uid <> ${c}.installer_uid))
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances instance
      WHERE instance.compliance_case_id = ${c}.id AND (instance.status NOT IN ('not_started', 'in_progress')
        OR instance.work_order_id <> ${c}.work_order_id OR instance.organisation_id <> ${c}.organisation_id
        OR instance.compliance_intent_id <> ${c}.compliance_intent_id
        OR coalesce(json_type(instance.response_snapshot, '$.finalisation'), '') <> 'null'))
    AND NOT EXISTS (SELECT 1 FROM compliance_case_evidence evidence WHERE evidence.case_id = ${c}.id
      AND (evidence.organisation_id <> ${c}.organisation_id OR evidence.status NOT IN ('received', 'superseded', 'withdrawn')
        OR evidence.reviewed_at <> '' OR evidence.reviewed_by_uid <> '' OR evidence.legal_hold <> 0 OR evidence.retention_until <> ''
        OR EXISTS (SELECT 1 FROM compliance_evidence_requirements requirement WHERE requirement.id = evidence.requirement_id
          AND requirement.evidence_type IN ('signature', 'declaration', 'invoice', 'payment'))))
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_browser_upload_receipts upload
      WHERE upload.case_instance_id IN (${instances}) AND (upload.purpose <> 'artifact'
        OR upload.owner_uid <> ${c}.installer_uid OR upload.work_order_id <> ${c}.work_order_id
        OR upload.organisation_id <> ${c}.organisation_id))
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_artifacts artifact
      WHERE artifact.case_instance_id IN (${instances}) AND artifact.organisation_id <> ${c}.organisation_id)
    AND NOT EXISTS (SELECT 1 FROM compliance_manual_policy_composition_locks lock
      WHERE lock.reference_type = 'compliance_case' AND lock.reference_id = ${c}.id
        AND lock.organisation_id <> ${c}.organisation_id)
    AND NOT EXISTS (SELECT 1 FROM compliance_equipment_records equipment WHERE equipment.case_id = ${c}.id
      AND (equipment.organisation_id <> ${c}.organisation_id OR NOT (${referencedDependency("equipment.id")})))
    AND NOT EXISTS (SELECT 1 FROM compliance_calculation_runs calculation WHERE calculation.case_id = ${c}.id
      AND (calculation.organisation_id <> ${c}.organisation_id OR calculation.status NOT IN ('blocked', 'calculated')
        OR calculation.verified_at <> '' OR calculation.verified_by_uid <> '' OR NOT (${referencedDependency("calculation.id")})))
    ${retainedCaseChildren.map(([table, column]) => `AND NOT EXISTS (SELECT 1 FROM ${table} retained WHERE retained.${column} = ${c}.id)`).join("\n")}
    ${retainedWorkPackChildren.map((table) => `AND NOT EXISTS (SELECT 1 FROM ${table} retained WHERE retained.case_instance_id IN (${instances}))`).join("\n")}
    AND NOT EXISTS (SELECT 1 FROM compliance_field_custody_test_artifacts retained WHERE retained.evidence_id IN (${evidence}))
    AND NOT EXISTS (SELECT 1 FROM compliance_field_custody_acceptance_records retained WHERE retained.evidence_id IN (${evidence}))
    AND NOT EXISTS (SELECT 1 FROM compliance_governance_requests retained WHERE retained.target_id = ${c}.id)
    AND NOT EXISTS (SELECT 1 FROM compliance_audit_events audit WHERE audit.target_id = ${c}.id
      OR audit.target_id IN (${instances}) OR audit.target_id IN (${evidence})
      OR audit.target_id IN (SELECT id FROM compliance_equipment_records WHERE case_id = ${c}.id)
      OR audit.target_id IN (SELECT id FROM compliance_calculation_runs WHERE case_id = ${c}.id)
      OR audit.target_id IN (SELECT id FROM compliance_manual_policy_composition_locks WHERE reference_type = 'compliance_case' AND reference_id = ${c}.id)
      OR json_extract(audit.metadata, '$.caseId') = ${c}.id)`;
}

export function retainedDraftComplianceBlockerSql(jobSql: string, ownerSql: string) {
  return `EXISTS (SELECT 1 FROM compliance_cases c WHERE c.work_order_id = ${jobSql}
    AND (c.installer_uid <> ${ownerSql} OR coalesce((${unfinishedCaseSql("c")}), 0) = 0))
    OR EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances orphan WHERE orphan.work_order_id = ${jobSql}
      AND NOT EXISTS (SELECT 1 FROM compliance_cases c WHERE c.id = orphan.compliance_case_id
        AND c.work_order_id = ${jobSql} AND c.installer_uid = ${ownerSql}))
    OR EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.work_order_id = ${jobSql}
      AND (intent.installer_uid <> ${ownerSql} OR (intent.status = 'case_linked'
        AND NOT EXISTS (SELECT 1 FROM compliance_cases c WHERE c.id = intent.compliance_case_id
          AND c.work_order_id = ${jobSql} AND c.installer_uid = ${ownerSql}))))`;
}

function allowedCaseSql(caseSql: string, organisationSql: string) {
  return `EXISTS (SELECT 1 FROM compliance_cases c WHERE c.id = ${caseSql} AND c.organisation_id = ${organisationSql}
    AND ${unfinishedCaseSql("c")} AND ${jobDeletionPermitSql("c.work_order_id", "c.installer_uid")})`;
}
function allowedInstanceSql(instanceSql: string, organisationSql: string) {
  return `EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances parent WHERE parent.id = ${instanceSql}
    AND parent.organisation_id = ${organisationSql} AND ${allowedCaseSql("parent.compliance_case_id", "parent.organisation_id")})`;
}
function guard(name: string, _table: string, allowed: string, legacySql: string): JobDeletionGuard {
  return { name, legacySql, sql: legacySql.replace(/\s+BEGIN\b/, ` WHEN coalesce((${allowed}), 0) = 0 BEGIN`) };
}

export const draftComplianceDeletionGuardDefinitions: readonly JobDeletionGuard[] = [
  guard("compliance_cases_no_delete", "compliance_cases", `${unfinishedCaseSql("OLD")} AND ${jobDeletionPermitSql("OLD.work_order_id", "OLD.installer_uid")}`,
    "CREATE TRIGGER IF NOT EXISTS `compliance_cases_no_delete` BEFORE DELETE ON `compliance_cases` BEGIN SELECT RAISE(ABORT, 'Compliance cases cannot be deleted'); END;"),
  guard("compliance_case_events_no_delete", "compliance_case_events", allowedCaseSql("OLD.case_id", "OLD.organisation_id"),
    "CREATE TRIGGER IF NOT EXISTS `compliance_case_events_no_delete` BEFORE DELETE ON `compliance_case_events` BEGIN SELECT RAISE(ABORT, 'Compliance case events are append-only'); END;"),
  guard("compliance_case_evidence_no_delete", "compliance_case_evidence", allowedCaseSql("OLD.case_id", "OLD.organisation_id"),
    "CREATE TRIGGER IF NOT EXISTS `compliance_case_evidence_no_delete` BEFORE DELETE ON `compliance_case_evidence` BEGIN SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_NO_DELETE'); END;"),
  guard("compliance_equipment_records_no_delete", "compliance_equipment_records", allowedCaseSql("OLD.case_id", "OLD.organisation_id"),
    "CREATE TRIGGER IF NOT EXISTS `compliance_equipment_records_no_delete` BEFORE DELETE ON `compliance_equipment_records` BEGIN SELECT RAISE(ABORT, 'COMPLIANCE_EQUIPMENT_NO_DELETE'); END;"),
  guard("compliance_calculation_runs_no_delete", "compliance_calculation_runs", allowedCaseSql("OLD.case_id", "OLD.organisation_id"),
    "CREATE TRIGGER IF NOT EXISTS `compliance_calculation_runs_no_delete` BEFORE DELETE ON `compliance_calculation_runs` BEGIN SELECT RAISE(ABORT, 'COMPLIANCE_CALCULATION_RUN_IMMUTABLE'); END;"),
  guard("compliance_evidence_integrity_receipts_no_delete", "compliance_evidence_integrity_receipts",
    `EXISTS (SELECT 1 FROM compliance_case_evidence evidence WHERE evidence.id = OLD.evidence_id AND evidence.organisation_id = OLD.organisation_id
      AND ${allowedCaseSql("evidence.case_id", "evidence.organisation_id")})`,
    "CREATE TRIGGER IF NOT EXISTS `compliance_evidence_integrity_receipts_no_delete` BEFORE DELETE ON `compliance_evidence_integrity_receipts` BEGIN SELECT RAISE(ABORT, 'COMPLIANCE_EVIDENCE_INTEGRITY_DELETE_FORBIDDEN'); END;"),
  guard("compliance_manual_policy_composition_delete_guard", "compliance_manual_policy_composition_locks",
    `OLD.reference_type = 'compliance_case' AND ${allowedCaseSql("OLD.reference_id", "OLD.organisation_id")}`,
    "CREATE TRIGGER IF NOT EXISTS compliance_manual_policy_composition_delete_guard BEFORE DELETE ON compliance_manual_policy_composition_locks BEGIN SELECT RAISE( ABORT, 'COMPLIANCE_MANUAL_POLICY_COMPOSITION_DELETE_BLOCKED' ); END;"),
];

export const draftWorkPackDeletionGuardDefinitions: readonly JobDeletionGuard[] = [
  ["instance", "instances", allowedCaseSql("OLD.compliance_case_id", "OLD.organisation_id"), "INSTANCE"],
  ["artifact", "artifacts", allowedInstanceSql("OLD.case_instance_id", "OLD.organisation_id"), "ARTIFACT"],
  ["browser_upload", "browser_upload_receipts", allowedInstanceSql("OLD.case_instance_id", "OLD.organisation_id"), "BROWSER_UPLOAD"],
].map(([key, table, allowed, message]) => guard(`compliance_work_pack_${key}_delete_guard`, `compliance_activity_work_pack_${table}`, allowed,
  `CREATE TRIGGER IF NOT EXISTS \`compliance_work_pack_${key}_delete_guard\`\nBEFORE DELETE ON \`compliance_activity_work_pack_${table}\`\nBEGIN\n  SELECT RAISE(ABORT, 'COMPLIANCE_WORK_PACK_${message}_DELETE_BLOCKED');\nEND;`));

export function draftComplianceDeletionStatements(db: D1Database, jobId: string, ownerUid: string) {
  const cases = "SELECT id FROM compliance_cases WHERE work_order_id = ? AND installer_uid = ?";
  const instances = `SELECT id FROM compliance_activity_work_pack_instances WHERE compliance_case_id IN (${cases})`;
  const evidence = `SELECT id FROM compliance_case_evidence WHERE case_id IN (${cases})`;
  const statements: D1PreparedStatement[] = [];
  statements.push(db.prepare(`DELETE FROM trade_offline_actions WHERE owner_uid = ? AND entity_type = 'work_pack'
    AND entity_id IN (SELECT instance_key FROM compliance_activity_work_pack_instances WHERE compliance_case_id IN (${cases}))`).bind(ownerUid, jobId, ownerUid));
  // Commit file-removal intents with the relational cascade; the existing worker
  // retries object-store failures. Published definitions and shared sources stay.
  for (const [table, selector] of [
    ["compliance_case_evidence", `case_id IN (${cases})`],
    ["compliance_activity_work_pack_artifacts", `case_instance_id IN (${instances})`],
    ["compliance_activity_work_pack_browser_upload_receipts", `case_instance_id IN (${instances})`],
  ]) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO trade_crm_job_media_cleanup
      (object_key, firebase_uid, work_order_id, attempt_id, upload_id, status, next_attempt_at, created_at, updated_at)
      SELECT object_key, ?, ?, ?, '', 'staged', job.updated_at, job.updated_at, job.updated_at
      FROM ${table} source JOIN trade_work_orders job ON job.id = ? AND job.firebase_uid = ?
      WHERE ${selector} AND source.object_key <> ''`).bind(ownerUid, jobId, crypto.randomUUID(), jobId, ownerUid, jobId, ownerUid));
  }
  for (const [table, selector] of [
    ["compliance_activity_work_pack_browser_upload_receipts", `case_instance_id IN (${instances})`],
    ["compliance_activity_work_pack_artifacts", `case_instance_id IN (${instances})`],
    ["compliance_evidence_integrity_receipts", `evidence_id IN (${evidence})`],
    ["compliance_case_evidence", `case_id IN (${cases})`],
    ["compliance_calculation_runs", `case_id IN (${cases})`],
    ["compliance_equipment_records", `case_id IN (${cases})`],
    ["compliance_activity_work_pack_instances", `compliance_case_id IN (${cases})`],
    ["compliance_manual_policy_composition_locks", `reference_type = 'compliance_case' AND reference_id IN (${cases})`],
    ["compliance_case_events", `case_id IN (${cases})`],
    ["compliance_cases", "work_order_id = ? AND installer_uid = ?"],
  ]) statements.push(db.prepare(`DELETE FROM ${table} WHERE ${selector}`).bind(jobId, ownerUid));
  return statements;
}
