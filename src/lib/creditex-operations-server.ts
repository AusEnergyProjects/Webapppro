import type {
  ComplianceIdentity,
  ComplianceRole,
} from "./compliance-access-server";

type Input = Record<string, unknown>;
type Row = Record<string, unknown>;

export const CREDITEX_OPERATION_ACTIONS = [
  "assign_case",
  "release_case_assignment",
  "create_task",
  "complete_task",
  "create_finding",
  "resolve_finding",
  "review_evidence",
  "record_decision",
  "add_participant",
  "add_participant_ability",
  "add_equipment",
  "create_draft_batch",
  "stage_batch_item",
  "remove_batch_item",
  "record_certificate_lot",
  "record_trade",
  "record_settlement",
] as const;

export type CreditexOperationAction =
  typeof CREDITEX_OPERATION_ACTIONS[number];

export const CREDITEX_DISABLED_EXTERNAL_ACTIONS = [
  "run_calculator",
  "calculate_certificates",
  "submit_batch",
  "submit_to_registry",
  "sync_registry",
  "record_manual_response",
  "execute_trade",
  "settle_trade",
] as const;

export const CREDITEX_OPERATION_ROLES: Record<
  CreditexOperationAction,
  readonly ComplianceRole[]
> = {
  assign_case: ["admin", "case_manager"],
  release_case_assignment: ["admin", "case_manager"],
  create_task: ["admin", "case_manager", "reviewer"],
  complete_task: ["admin", "case_manager", "reviewer"],
  create_finding: ["admin", "reviewer"],
  resolve_finding: ["admin", "reviewer"],
  review_evidence: ["admin", "reviewer"],
  record_decision: ["admin", "reviewer"],
  add_participant: ["admin", "case_manager"],
  add_participant_ability: ["admin", "case_manager"],
  add_equipment: ["admin", "case_manager", "reviewer"],
  create_draft_batch: ["admin", "case_manager"],
  stage_batch_item: ["admin", "case_manager"],
  remove_batch_item: ["admin", "case_manager"],
  record_certificate_lot: ["admin"],
  record_trade: ["admin"],
  record_settlement: ["admin"],
};

export class CreditexOperationsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function valueText(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  required = true,
) {
  const result = valueText(value).trim();
  if (required && !result) {
    throw new CreditexOperationsError(
      "CREDITEX_VALUE_REQUIRED",
      400,
      `${label} is required.`,
    );
  }
  if (result.length > maximum) {
    throw new CreditexOperationsError(
      "CREDITEX_VALUE_TOO_LONG",
      400,
      `${label} is longer than the permitted limit.`,
    );
  }
  return result;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  label: string,
  options: T,
): T[number] {
  const result = text(value, label, 80);
  if (!options.includes(result)) {
    throw new CreditexOperationsError(
      "CREDITEX_VALUE_INVALID",
      400,
      `${label} is not supported.`,
    );
  }
  return result as T[number];
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result)
    || result < minimum
    || result > maximum
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_NUMBER_INVALID",
      400,
      `${label} must be a whole number within the permitted range.`,
    );
  }
  return result;
}

function dateOnly(value: unknown, label: string, required = true) {
  const result = text(value, label, 10, required);
  if (!result && !required) return "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result)
    || Number.isNaN(Date.parse(`${result}T00:00:00.000Z`))
    || new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10)
      !== result
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_DATE_INVALID",
      400,
      `${label} must be a valid date.`,
    );
  }
  return result;
}

function instant(value: unknown, label: string, required = true) {
  const result = text(value, label, 50, required);
  if (!result && !required) return "";
  const parsed = Date.parse(result);
  if (Number.isNaN(parsed)) {
    throw new CreditexOperationsError(
      "CREDITEX_DATE_INVALID",
      400,
      `${label} must be a valid date and time.`,
    );
  }
  return new Date(parsed).toISOString();
}

function jsonObject(
  value: unknown,
  label: string,
  maximumBytes = 20_000,
) {
  let parsed: unknown = value ?? {};
  try {
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    throw new CreditexOperationsError(
      "CREDITEX_JSON_INVALID",
      400,
      `${label} must be a valid JSON object.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CreditexOperationsError(
      "CREDITEX_JSON_INVALID",
      400,
      `${label} must be a valid JSON object.`,
    );
  }
  const encoded = JSON.stringify(parsed);
  if (encoded.length > maximumBytes) {
    throw new CreditexOperationsError(
      "CREDITEX_JSON_TOO_LARGE",
      400,
      `${label} is larger than the permitted limit.`,
    );
  }
  return encoded;
}

function safeObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(valueText(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeJsonValue(value: unknown) {
  try {
    return JSON.parse(valueText(value));
  } catch {
    return null;
  }
}

function safeActivity(value: unknown) {
  const activity = safeObject(value);
  return {
    programName: valueText(activity.programName),
    activityKey: valueText(activity.activityKey),
    registryActivityCode: valueText(activity.registryActivityCode),
    title: valueText(activity.title),
    version: Number(activity.version || 0),
    specificationPart: valueText(activity.specificationPart),
    productCategory: valueText(activity.productCategory),
    scenarioCode: valueText(activity.scenarioCode),
    scenario: valueText(activity.scenario),
    officialSourceVersion: valueText(activity.officialSourceVersion),
  };
}

function assertActionRole(
  identity: ComplianceIdentity,
  action: CreditexOperationAction,
) {
  if (!CREDITEX_OPERATION_ROLES[action].includes(identity.role)) {
    throw new CreditexOperationsError(
      "CREDITEX_ROLE_REQUIRED",
      403,
      "Your compliance role does not permit that operation.",
    );
  }
}

async function first(
  database: D1Database,
  sql: string,
  bindings: unknown[],
) {
  return database.prepare(sql).bind(...bindings).first<Row>();
}

async function rows(
  database: D1Database,
  sql: string,
  bindings: unknown[],
) {
  return (await database.prepare(sql).bind(...bindings).all<Row>()).results;
}

async function requireRecord(
  database: D1Database,
  sql: string,
  bindings: unknown[],
  message: string,
) {
  const record = await first(database, sql, bindings);
  if (!record) {
    throw new CreditexOperationsError(
      "CREDITEX_RECORD_NOT_FOUND",
      404,
      message,
    );
  }
  return record;
}

function auditStatement(
  database: D1Database,
  identity: ComplianceIdentity,
  eventType: string,
  targetType: string,
  targetId: string,
  summary: string,
  metadata: Record<string, unknown>,
  createdAt: string,
) {
  return database.prepare(`INSERT INTO compliance_audit_events (
      id, organisation_id, actor_type, actor_uid, event_type,
      target_type, target_id, summary, metadata, created_at
    ) VALUES (?, ?, 'compliance', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      identity.organisationId,
      identity.uid,
      eventType,
      targetType,
      targetId,
      summary,
      JSON.stringify(metadata),
      createdAt,
    );
}

async function writeWithAudit(
  database: D1Database,
  identity: ComplianceIdentity,
  writes: D1PreparedStatement[],
  audit: {
    eventType: string;
    targetType: string;
    targetId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
  createdAt: string,
) {
  const operationId = crypto.randomUUID();
  const guardedWrites = writes.flatMap((statement, index) => [
    statement,
    database.prepare(`INSERT INTO compliance_write_guards (
        id, organisation_id, operation_id, step_number, verified, created_at
      ) VALUES (?, ?, ?, ?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
      .bind(
        crypto.randomUUID(),
        identity.organisationId,
        operationId,
        index + 1,
        createdAt,
      ),
  ]);
  await database.batch([
    ...guardedWrites,
    auditStatement(
      database,
      identity,
      audit.eventType,
      audit.targetType,
      audit.targetId,
      audit.summary,
      audit.metadata || {},
      createdAt,
    ),
  ]);
}

function projectRows(items: Row[]) {
  return items.map((item) => Object.fromEntries(
    Object.entries(item).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      value,
    ]),
  ));
}

export async function loadCreditexOperationsDashboard(
  database: D1Database,
  organisationId: string,
) {
  const [
    countRows,
    taskRows,
    evidenceRows,
    findingRows,
    batchRows,
    participantRows,
    equipmentRows,
    inventoryRows,
    tradeRows,
    settlementRows,
    calculationRows,
    policyRows,
    auditRows,
  ] = await Promise.all([
    rows(database, `WITH context(organisation_id) AS (VALUES (?))
      SELECT 'invitations' domain, COUNT(*) total
        FROM compliance_invitations, context
        WHERE compliance_invitations.organisation_id = context.organisation_id
      UNION ALL SELECT 'audit_events', COUNT(*)
        FROM compliance_audit_events, context
        WHERE compliance_audit_events.organisation_id = context.organisation_id
      UNION ALL SELECT 'evidence_policies', COUNT(*)
        FROM compliance_evidence_policy_versions, context
        WHERE compliance_evidence_policy_versions.organisation_id = context.organisation_id
      UNION ALL SELECT 'evidence_requirements', COUNT(*)
        FROM compliance_evidence_requirements requirement
        JOIN compliance_evidence_policy_versions policy
          ON policy.id = requirement.policy_version_id
        JOIN context ON policy.organisation_id = context.organisation_id
      UNION ALL SELECT 'participants', COUNT(*)
        FROM compliance_participants, context
        WHERE compliance_participants.organisation_id = context.organisation_id
      UNION ALL SELECT 'participant_abilities', COUNT(*)
        FROM compliance_participant_abilities, context
        WHERE compliance_participant_abilities.organisation_id = context.organisation_id
      UNION ALL SELECT 'assignments', COUNT(*)
        FROM compliance_case_assignments, context
        WHERE compliance_case_assignments.organisation_id = context.organisation_id
      UNION ALL SELECT 'tasks', COUNT(*)
        FROM compliance_case_tasks, context
        WHERE compliance_case_tasks.organisation_id = context.organisation_id
      UNION ALL SELECT 'evidence', COUNT(*)
        FROM compliance_case_evidence, context
        WHERE compliance_case_evidence.organisation_id = context.organisation_id
      UNION ALL SELECT 'findings', COUNT(*)
        FROM compliance_case_findings, context
        WHERE compliance_case_findings.organisation_id = context.organisation_id
      UNION ALL SELECT 'decisions', COUNT(*)
        FROM compliance_case_decisions, context
        WHERE compliance_case_decisions.organisation_id = context.organisation_id
      UNION ALL SELECT 'decision_requests', COUNT(*)
        FROM compliance_decision_requests, context
        WHERE compliance_decision_requests.organisation_id = context.organisation_id
      UNION ALL SELECT 'equipment', COUNT(*)
        FROM compliance_equipment_records, context
        WHERE compliance_equipment_records.organisation_id = context.organisation_id
      UNION ALL SELECT 'calculator_versions', COUNT(*)
        FROM compliance_calculator_versions, context
        WHERE compliance_calculator_versions.organisation_id = context.organisation_id
      UNION ALL SELECT 'calculator_vectors', COUNT(*)
        FROM compliance_calculator_test_vectors vector
        JOIN compliance_calculator_versions calculator
          ON calculator.id = vector.calculator_version_id
        JOIN context ON calculator.organisation_id = context.organisation_id
      UNION ALL SELECT 'calculation_runs', COUNT(*)
        FROM compliance_calculation_runs, context
        WHERE compliance_calculation_runs.organisation_id = context.organisation_id
      UNION ALL SELECT 'submission_batches', COUNT(*)
        FROM compliance_submission_batches, context
        WHERE compliance_submission_batches.organisation_id = context.organisation_id
      UNION ALL SELECT 'submission_items', COUNT(*)
        FROM compliance_submission_batch_items, context
        WHERE compliance_submission_batch_items.organisation_id = context.organisation_id
      UNION ALL SELECT 'submission_artifacts', COUNT(*)
        FROM compliance_submission_artifacts, context
        WHERE compliance_submission_artifacts.organisation_id = context.organisation_id
      UNION ALL SELECT 'submission_responses', COUNT(*)
        FROM compliance_submission_responses, context
        WHERE compliance_submission_responses.organisation_id = context.organisation_id
      UNION ALL SELECT 'certificate_lots', COUNT(*)
        FROM compliance_certificate_lots, context
        WHERE compliance_certificate_lots.organisation_id = context.organisation_id
      UNION ALL SELECT 'trades', COUNT(*)
        FROM compliance_trades, context
        WHERE compliance_trades.organisation_id = context.organisation_id
      UNION ALL SELECT 'settlements', COUNT(*)
        FROM compliance_settlements, context
        WHERE compliance_settlements.organisation_id = context.organisation_id`, [
      organisationId,
    ]),
    rows(database, `SELECT task.id, compliance_case.id case_id,
        compliance_case.case_number, task.task_type,
        task.title, task.priority, task.status, task.due_at, task.updated_at
      FROM compliance_case_tasks task
      JOIN compliance_cases compliance_case
        ON compliance_case.id = task.case_id
        AND compliance_case.organisation_id = task.organisation_id
      WHERE task.organisation_id = ?
        AND task.status IN ('open', 'in_progress', 'blocked')
      ORDER BY
        CASE task.priority
          WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
          WHEN 'normal' THEN 2 ELSE 3
        END,
        CASE WHEN task.due_at = '' THEN 1 ELSE 0 END,
        task.due_at, task.created_at
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT evidence.id, compliance_case.id case_id,
        compliance_case.case_number,
        requirement.requirement_code, requirement.title,
        requirement.evidence_type, requirement.capture_timing,
        requirement.original_required, requirement.metadata_required,
        requirement.gps_required, evidence.source_type, evidence.status,
        evidence.content_type, evidence.size_bytes,
        evidence.received_at, evidence.reviewed_at
      FROM compliance_case_evidence evidence
      JOIN compliance_cases compliance_case
        ON compliance_case.id = evidence.case_id
        AND compliance_case.organisation_id = evidence.organisation_id
      JOIN compliance_evidence_requirements requirement
        ON requirement.id = evidence.requirement_id
        AND requirement.organisation_id = evidence.organisation_id
      WHERE evidence.organisation_id = ?
        AND evidence.status IN ('received', 'under_review', 'rejected')
      ORDER BY evidence.received_at, evidence.id
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT finding.id, compliance_case.id case_id,
        compliance_case.case_number,
        finding.finding_code, finding.severity, finding.description,
        finding.status, finding.raised_at
      FROM compliance_case_findings finding
      JOIN compliance_cases compliance_case
        ON compliance_case.id = finding.case_id
        AND compliance_case.organisation_id = finding.organisation_id
      WHERE finding.organisation_id = ? AND finding.status = 'open'
      ORDER BY
        CASE finding.severity
          WHEN 'critical' THEN 0 WHEN 'major' THEN 1
          WHEN 'minor' THEN 2 ELSE 3
        END,
        finding.raised_at
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT batch.id, program.program_code, batch.batch_number,
        batch.format, batch.status, batch.case_count,
        batch.certificate_quantity, batch.created_at, batch.updated_at
      FROM compliance_submission_batches batch
      JOIN compliance_programs program
        ON program.id = batch.program_id
        AND program.organisation_id = batch.organisation_id
      WHERE batch.organisation_id = ?
      ORDER BY batch.created_at DESC, batch.id DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT participant.id, participant.participant_type,
        participant.external_reference, participant.legal_name,
        participant.trading_name, participant.status, participant.effective_to
      FROM compliance_participants participant
      WHERE participant.organisation_id = ?
      ORDER BY participant.status, participant.trading_name,
        participant.legal_name, participant.id
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT equipment.id, compliance_case.id case_id,
        compliance_case.case_number, equipment.record_type,
        equipment.manufacturer, equipment.model, equipment.serial_number,
        equipment.product_registry, equipment.product_reference,
        equipment.quantity, equipment.status, equipment.recorded_at
      FROM compliance_equipment_records equipment
      JOIN compliance_cases compliance_case
        ON compliance_case.id = equipment.case_id
        AND compliance_case.organisation_id = equipment.organisation_id
      WHERE equipment.organisation_id = ?
      ORDER BY equipment.recorded_at DESC, equipment.id DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT lot.id, program.program_code, lot.certificate_type,
        lot.registry_lot_reference, lot.quantity, lot.status,
        lot.vintage_from, lot.vintage_to, lot.updated_at
      FROM compliance_certificate_lots lot
      JOIN compliance_programs program
        ON program.id = lot.program_id
        AND program.organisation_id = lot.organisation_id
      WHERE lot.organisation_id = ?
      ORDER BY lot.created_at DESC, lot.id DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT trade.id, trade.certificate_lot_id,
        trade.counterparty_reference, trade.quantity,
        trade.unit_price_cents, trade.trade_date, trade.status,
        trade.external_reference
      FROM compliance_trades trade
      WHERE trade.organisation_id = ?
      ORDER BY trade.trade_date DESC, trade.id DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT settlement.id, settlement.trade_id,
        settlement.gross_cents, settlement.fee_cents, settlement.net_cents,
        settlement.due_date, settlement.status, settlement.external_reference
      FROM compliance_settlements settlement
      WHERE settlement.organisation_id = ?
      ORDER BY settlement.due_date, settlement.id
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT run.id, compliance_case.id case_id,
        compliance_case.case_number,
        calculator.calculator_key, calculator.version,
        run.status, run.blocked_reason, run.run_at, run.verified_at
      FROM compliance_calculation_runs run
      JOIN compliance_cases compliance_case
        ON compliance_case.id = run.case_id
        AND compliance_case.organisation_id = run.organisation_id
      JOIN compliance_calculator_versions calculator
        ON calculator.id = run.calculator_version_id
        AND calculator.organisation_id = run.organisation_id
      WHERE run.organisation_id = ?
      ORDER BY run.run_at DESC, run.id DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT policy.id, activity.activity_key,
        policy.version, policy.publish_state, policy.requirements_complete,
        policy.official_source_title, policy.official_source_version,
        policy.official_source_checked_at
      FROM compliance_evidence_policy_versions policy
      JOIN compliance_activity_versions activity
        ON activity.id = policy.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
        AND program.organisation_id = policy.organisation_id
      WHERE policy.organisation_id = ?
      ORDER BY activity.activity_key, policy.version DESC
      LIMIT 50`, [organisationId]),
    rows(database, `SELECT event.id, event.event_type, event.target_type,
        event.target_id, event.summary, event.actor_type,
        COALESCE(member.display_name, '') actor_name, event.created_at
      FROM compliance_audit_events event
      LEFT JOIN compliance_users member
        ON member.firebase_uid = event.actor_uid
        AND member.organisation_id = event.organisation_id
      WHERE event.organisation_id = ?
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 100`, [organisationId]),
  ]);

  const counts = Object.fromEntries(
    countRows.map((item) => [
      valueText(item.domain),
      Number(item.total || 0),
    ]),
  );
  const queueLengths: Record<string, number> = {
    tasks: taskRows.length,
    evidence: evidenceRows.length,
    findings: findingRows.length,
    submission_batches: batchRows.length,
    participants: participantRows.length,
    equipment: equipmentRows.length,
    certificate_lots: inventoryRows.length,
    trades: tradeRows.length,
    settlements: settlementRows.length,
    calculation_runs: calculationRows.length,
    evidence_policies: policyRows.length,
    audit_events: auditRows.length,
  };
  return {
    counts,
    queues: {
      tasks: projectRows(taskRows),
      evidence: projectRows(evidenceRows),
      findings: projectRows(findingRows),
      batches: projectRows(batchRows),
      participants: projectRows(participantRows),
      equipment: projectRows(equipmentRows),
      certificateLots: projectRows(inventoryRows),
      trades: projectRows(tradeRows),
      settlements: projectRows(settlementRows),
      calculationRuns: projectRows(calculationRows),
      evidencePolicies: projectRows(policyRows),
      auditEvents: projectRows(auditRows),
    },
    limits: {
      defaultQueueLimit: 50,
      auditQueueLimit: 100,
      truncatedDomains: Object.entries(queueLengths)
        .filter(([domain, loaded]) => Number(counts[domain] || 0) > loaded)
        .map(([domain]) => domain),
    },
    controls: {
      registrySubmissionEnabled: false,
      calculatorExecutionEnabled: false,
      certificateTradingExecutionEnabled: false,
    },
  };
}

export async function loadCreditexCaseWorkspace(
  database: D1Database,
  organisationId: string,
  caseIdInput: unknown,
) {
  const caseId = text(caseIdInput, "Case", 180);
  const complianceCase = await requireRecord(
    database,
    `SELECT id, case_number, program_id, work_order_id, installer_uid,
        activity_version_id, evidence_policy_version_id,
        activity_date, site_jurisdiction,
        activity_snapshot, status, evidence_status, revision,
        created_at, updated_at
      FROM compliance_cases
      WHERE id = ? AND organisation_id = ?`,
    [caseId, organisationId],
    "The compliance case was not found in this organisation.",
  );
  const [
    assignmentRows,
    taskRows,
    evidenceRows,
    findingRows,
    decisionRows,
    decisionRequestRows,
    equipmentRows,
    calculationRows,
    batchItemRows,
    responseRows,
    artifactRows,
    eventRows,
  ] = await Promise.all([
    rows(database, `SELECT assignment.id, assignment.assignment_role,
        assignment.status, assignment.assigned_at, assignment.released_at,
        assignment.completed_at, member.display_name, member.role
      FROM compliance_case_assignments assignment
      JOIN compliance_users member
        ON member.id = assignment.compliance_user_id
        AND member.organisation_id = assignment.organisation_id
      WHERE assignment.case_id = ? AND assignment.organisation_id = ?
      ORDER BY assignment.assigned_at DESC, assignment.id`, [
      caseId, organisationId,
    ]),
    rows(database, `SELECT id, task_type, title, detail, priority, status,
        assignee_user_id, due_at, completed_at, created_at, updated_at
      FROM compliance_case_tasks
      WHERE case_id = ? AND organisation_id = ?
      ORDER BY created_at DESC, id`, [caseId, organisationId]),
    rows(database, `SELECT evidence.id, evidence.requirement_id,
        requirement.requirement_code, requirement.title,
        requirement.evidence_type, requirement.capture_timing,
        requirement.minimum_count, requirement.maximum_count,
        requirement.original_required, requirement.metadata_required,
        requirement.gps_required, requirement.date_stamp_required,
        evidence.supersedes_evidence_id, evidence.source_type, evidence.status,
        evidence.content_type, evidence.size_bytes,
        CASE WHEN length(evidence.original_sha256) = 64
          THEN 1 ELSE 0 END integrity_present,
        evidence.received_by_type, evidence.received_at,
        evidence.reviewed_at, evidence.retention_until, evidence.legal_hold
      FROM compliance_case_evidence evidence
      JOIN compliance_evidence_requirements requirement
        ON requirement.id = evidence.requirement_id
        AND requirement.organisation_id = evidence.organisation_id
      WHERE evidence.case_id = ? AND evidence.organisation_id = ?
      ORDER BY evidence.received_at DESC, evidence.id`, [caseId, organisationId]),
    rows(database, `SELECT id, evidence_id, requirement_id, finding_code,
        severity, description, status, raised_at, resolved_at, resolution_note
      FROM compliance_case_findings
      WHERE case_id = ? AND organisation_id = ?
      ORDER BY raised_at DESC, id`, [caseId, organisationId]),
    rows(database, `SELECT decision.id, decision.decision_type,
        decision.outcome, decision.case_revision,
        COALESCE(primary_member.display_name, '') primary_reviewer,
        COALESCE(secondary_member.display_name, '') secondary_reviewer,
        decision.decided_at,
        CASE WHEN length(decision.basis_snapshot) > 2
          THEN 1 ELSE 0 END basis_recorded
      FROM compliance_case_decisions decision
      LEFT JOIN compliance_users primary_member
        ON primary_member.firebase_uid = decision.primary_reviewer_uid
        AND primary_member.organisation_id = decision.organisation_id
      LEFT JOIN compliance_users secondary_member
        ON secondary_member.firebase_uid = decision.secondary_reviewer_uid
        AND secondary_member.organisation_id = decision.organisation_id
      WHERE decision.case_id = ? AND decision.organisation_id = ?
      ORDER BY decision.decided_at DESC, decision.id`, [
      caseId, organisationId,
    ]),
    rows(database, `SELECT request.id, request.decision_type,
        request.outcome, request.status, request.case_revision,
        COALESCE(primary_member.display_name, '') primary_reviewer,
        COALESCE(secondary_member.display_name, '') secondary_reviewer,
        request.created_at, request.reviewed_at,
        CASE WHEN length(request.basis_snapshot) > 2
          THEN 1 ELSE 0 END basis_recorded
      FROM compliance_decision_requests request
      LEFT JOIN compliance_users primary_member
        ON primary_member.firebase_uid = request.primary_reviewer_uid
        AND primary_member.organisation_id = request.organisation_id
      LEFT JOIN compliance_users secondary_member
        ON secondary_member.firebase_uid = request.secondary_reviewer_uid
        AND secondary_member.organisation_id = request.organisation_id
      WHERE request.case_id = ? AND request.organisation_id = ?
      ORDER BY request.created_at DESC, request.id`, [
      caseId, organisationId,
    ]),
    rows(database, `SELECT id, record_type, manufacturer, model, serial_number,
        product_registry, product_reference, quantity, status, recorded_at
      FROM compliance_equipment_records
      WHERE case_id = ? AND organisation_id = ?
      ORDER BY recorded_at DESC, id`, [caseId, organisationId]),
    rows(database, `SELECT run.id, calculator.calculator_key,
        calculator.version, calculator.output_type, run.case_revision, run.status,
        run.blocked_reason, run.run_at, run.verified_at
      FROM compliance_calculation_runs run
      JOIN compliance_calculator_versions calculator
        ON calculator.id = run.calculator_version_id
        AND calculator.organisation_id = run.organisation_id
      WHERE run.case_id = ? AND run.organisation_id = ?
      ORDER BY run.run_at DESC, run.id`, [caseId, organisationId]),
    rows(database, `SELECT item.id, item.batch_id, batch.batch_number,
        item.case_revision, item.status, item.external_reference,
        item.created_at, item.updated_at
      FROM compliance_submission_batch_items item
      JOIN compliance_submission_batches batch
        ON batch.id = item.batch_id
        AND batch.organisation_id = item.organisation_id
      WHERE item.case_id = ? AND item.organisation_id = ?
      ORDER BY item.created_at DESC, item.id`, [caseId, organisationId]),
    rows(database, `SELECT response.id, response.batch_id,
        response.batch_item_id, response.response_type,
        response.response_code, response.message,
        response.occurred_at, response.created_at
      FROM compliance_submission_responses response
      JOIN compliance_submission_batch_items item
        ON item.id = response.batch_item_id
        AND item.batch_id = response.batch_id
        AND item.organisation_id = response.organisation_id
      WHERE item.case_id = ? AND response.organisation_id = ?
      ORDER BY response.occurred_at DESC, response.id`, [
      caseId, organisationId,
    ]),
    rows(database, `SELECT artifact.id, artifact.batch_id,
        artifact.artifact_type, artifact.file_name, artifact.content_type,
        artifact.size_bytes,
        CASE WHEN length(artifact.sha256) = 64 THEN 1 ELSE 0 END integrity_present,
        artifact.created_at
      FROM compliance_submission_artifacts artifact
      JOIN compliance_submission_batch_items item
        ON item.batch_id = artifact.batch_id
        AND item.organisation_id = artifact.organisation_id
      WHERE item.case_id = ? AND artifact.organisation_id = ?
      GROUP BY artifact.id
      ORDER BY artifact.created_at DESC, artifact.id`, [
      caseId, organisationId,
    ]),
    rows(database, `SELECT event.id, event.event_type, event.actor_type,
        COALESCE(member.display_name, '') actor_name,
        event.summary, event.created_at
      FROM compliance_case_events event
      LEFT JOIN compliance_users member
        ON member.firebase_uid = event.actor_uid
        AND member.organisation_id = event.organisation_id
      WHERE event.case_id = ? AND event.organisation_id = ?
      ORDER BY event.created_at DESC, event.id
      LIMIT 200`, [caseId, organisationId]),
  ]);
  return {
    case: {
      id: valueText(complianceCase.id),
      caseNumber: valueText(complianceCase.case_number),
      programId: valueText(complianceCase.program_id),
      workOrderId: valueText(complianceCase.work_order_id),
      activityVersionId: valueText(complianceCase.activity_version_id),
      evidencePolicyVersionId: valueText(
        complianceCase.evidence_policy_version_id,
      ),
      activityDate: valueText(complianceCase.activity_date),
      jurisdiction: valueText(complianceCase.site_jurisdiction),
      status: valueText(complianceCase.status),
      evidenceStatus: valueText(complianceCase.evidence_status),
      revision: Number(complianceCase.revision || 0),
      createdAt: valueText(complianceCase.created_at),
      updatedAt: valueText(complianceCase.updated_at),
      activity: safeActivity(complianceCase.activity_snapshot),
    },
    assignments: projectRows(assignmentRows),
    tasks: projectRows(taskRows),
    evidence: projectRows(evidenceRows),
    findings: projectRows(findingRows),
    decisions: projectRows(decisionRows),
    decisionRequests: projectRows(decisionRequestRows),
    equipment: projectRows(equipmentRows),
    calculationRuns: projectRows(calculationRows),
    batchItems: projectRows(batchItemRows),
    submissionResponses: projectRows(responseRows),
    submissionArtifacts: projectRows(artifactRows),
    caseEvents: projectRows(eventRows),
  };
}

async function requireOwnedCase(
  database: D1Database,
  identity: ComplianceIdentity,
  caseIdInput: unknown,
) {
  const caseId = text(caseIdInput, "Case", 180);
  const record = await requireRecord(
    database,
    `SELECT id, revision, program_id, activity_version_id,
        evidence_policy_version_id, status, evidence_status
      FROM compliance_cases
      WHERE id = ? AND organisation_id = ?`,
    [caseId, identity.organisationId],
    "The compliance case was not found in this organisation.",
  );
  return {
    id: caseId,
    revision: Number(record.revision || 0),
    programId: valueText(record.program_id),
    activityVersionId: valueText(record.activity_version_id),
    evidencePolicyVersionId: valueText(record.evidence_policy_version_id),
    status: valueText(record.status),
    evidenceStatus: valueText(record.evidence_status),
  };
}

type OwnedCase = Awaited<ReturnType<typeof requireOwnedCase>>;

type ReviewerAssignmentRole =
  | "evidence_review"
  | "primary_reviewer"
  | "secondary_reviewer";

async function requireActiveReviewerAssignment(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  assignmentRole: ReviewerAssignmentRole,
) {
  if (identity.role === "admin") return;
  const roleCondition = assignmentRole === "evidence_review"
    ? "assignment.assignment_role IN ('primary_reviewer', 'secondary_reviewer')"
    : "assignment.assignment_role = ?";
  const bindings = assignmentRole === "evidence_review"
    ? [
        identity.uid,
        complianceCase.id,
        identity.organisationId,
      ]
    : [
        identity.uid,
        complianceCase.id,
        identity.organisationId,
        assignmentRole,
      ];
  const assignment = await first(
    database,
    `SELECT assignment.id
      FROM compliance_case_assignments assignment
      JOIN compliance_users member
        ON member.id = assignment.compliance_user_id
        AND member.organisation_id = assignment.organisation_id
        AND member.firebase_uid = ?
        AND member.status = 'active'
        AND member.role = 'reviewer'
      WHERE assignment.case_id = ?
        AND assignment.organisation_id = ?
        AND assignment.status = 'assigned'
        AND ${roleCondition}
      ORDER BY assignment.assigned_at DESC, assignment.id DESC
      LIMIT 1`,
    bindings,
  );
  if (!assignment) {
    throw new CreditexOperationsError(
      "CREDITEX_CASE_ASSIGNMENT_REQUIRED",
      403,
      "A current reviewer assignment for this case is required before recording that outcome.",
    );
  }
}

async function requireRecentEvidenceAccessReceipt(
  database: D1Database,
  identity: ComplianceIdentity,
  evidenceId: string,
  receiptId: string,
  reviewedAt: string,
) {
  const reviewedAtMs = Date.parse(reviewedAt);
  const receiptNotBefore = new Date(
    reviewedAtMs - 30 * 60 * 1_000,
  ).toISOString();
  const receipt = await first(
    database,
    `SELECT id
      FROM compliance_audit_events
      WHERE id = ?
        AND organisation_id = ?
        AND actor_type = 'compliance'
        AND actor_uid = ?
        AND event_type = 'evidence.viewed'
        AND target_type = 'compliance_case_evidence'
        AND target_id = ?
        AND created_at >= ?
        AND created_at <= ?`,
    [
      receiptId,
      identity.organisationId,
      identity.uid,
      evidenceId,
      receiptNotBefore,
      reviewedAt,
    ],
  );
  if (!receipt) {
    throw new CreditexOperationsError(
      "CREDITEX_EVIDENCE_ACCESS_REQUIRED",
      409,
      "Open this evidence immediately before accepting or rejecting it. The audited access receipt is valid for 30 minutes.",
    );
  }
}

function bumpCaseRevisionStatement(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  updatedAt: string,
) {
  return database.prepare(`UPDATE compliance_cases
    SET status = CASE
        WHEN status = 'draft' THEN 'draft'
        ELSE 'in_review'
      END,
      revision = revision + 1, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND revision = ?
      AND status IN (
        'draft', 'in_review', 'changes_requested', 'ready_for_submission'
      )`)
    .bind(
      updatedAt,
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    );
}

function recomputeEvidenceStatusStatement(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  updatedAt: string,
) {
  return database.prepare(`UPDATE compliance_cases
    SET status = CASE
        WHEN status = 'draft' THEN 'draft'
        ELSE 'in_review'
      END,
      evidence_status = CASE
        WHEN EXISTS (
          SELECT 1 FROM compliance_case_evidence evidence
          WHERE evidence.case_id = compliance_cases.id
            AND evidence.organisation_id = compliance_cases.organisation_id
            AND evidence.status = 'rejected'
            AND NOT EXISTS (
              SELECT 1
              FROM compliance_case_evidence replacement
              WHERE replacement.case_id = evidence.case_id
                AND replacement.organisation_id = evidence.organisation_id
                AND replacement.supersedes_evidence_id = evidence.id
            )
        ) THEN 'changes_required'
        WHEN evidence_policy_version_id <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM compliance_evidence_requirements requirement
            WHERE requirement.policy_version_id = evidence_policy_version_id
              AND requirement.organisation_id = compliance_cases.organisation_id
              AND (
                SELECT COUNT(*)
                FROM compliance_case_evidence evidence
                WHERE evidence.case_id = compliance_cases.id
                  AND evidence.organisation_id = compliance_cases.organisation_id
                  AND evidence.requirement_id = requirement.id
                  AND evidence.status = 'accepted'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM compliance_case_evidence replacement
                    WHERE replacement.case_id = evidence.case_id
                      AND replacement.organisation_id
                        = evidence.organisation_id
                      AND replacement.supersedes_evidence_id = evidence.id
                  )
              ) < requirement.minimum_count
          )
          AND EXISTS (
            SELECT 1 FROM compliance_evidence_requirements requirement
            WHERE requirement.policy_version_id = evidence_policy_version_id
              AND requirement.organisation_id = compliance_cases.organisation_id
          )
          THEN 'complete'
        WHEN EXISTS (
          SELECT 1 FROM compliance_case_evidence evidence
          WHERE evidence.case_id = compliance_cases.id
            AND evidence.organisation_id = compliance_cases.organisation_id
        ) THEN 'in_progress'
        ELSE 'not_started'
      END,
      revision = revision + 1,
      updated_at = ?
    WHERE id = ? AND organisation_id = ? AND revision = ?
      AND status IN (
        'draft', 'in_review', 'changes_requested', 'ready_for_submission'
      )`)
    .bind(
      updatedAt,
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    );
}

async function requireEvidenceReady(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
) {
  const readiness = await first(
    database,
    `SELECT compliance_case.id,
        activity.calculation_approval_state,
        policy.requirements_complete,
        policy.publish_state,
        COUNT(requirement.id) requirement_count,
        SUM(CASE WHEN (
          SELECT COUNT(*)
          FROM compliance_case_evidence evidence
          WHERE evidence.case_id = compliance_case.id
            AND evidence.organisation_id = compliance_case.organisation_id
            AND evidence.requirement_id = requirement.id
            AND evidence.status = 'accepted'
            AND NOT EXISTS (
              SELECT 1
              FROM compliance_case_evidence replacement
              WHERE replacement.case_id = evidence.case_id
                AND replacement.organisation_id = evidence.organisation_id
                AND replacement.supersedes_evidence_id = evidence.id
            )
        ) >= requirement.minimum_count THEN 1 ELSE 0 END) ready_count,
        EXISTS (
          SELECT 1 FROM compliance_case_findings finding
          WHERE finding.case_id = compliance_case.id
            AND finding.organisation_id = compliance_case.organisation_id
            AND finding.status = 'open'
        ) open_findings
      FROM compliance_cases compliance_case
      JOIN compliance_activity_versions activity
        ON activity.id = compliance_case.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
        AND program.id = compliance_case.program_id
        AND program.organisation_id = compliance_case.organisation_id
      LEFT JOIN compliance_evidence_policy_versions policy
        ON policy.id = compliance_case.evidence_policy_version_id
        AND policy.organisation_id = compliance_case.organisation_id
        AND policy.activity_version_id = compliance_case.activity_version_id
      LEFT JOIN compliance_evidence_requirements requirement
        ON requirement.policy_version_id = policy.id
        AND requirement.organisation_id = compliance_case.organisation_id
      WHERE compliance_case.id = ? AND compliance_case.organisation_id = ?
        AND compliance_case.revision = ?
        AND compliance_case.status NOT IN ('rejected', 'closed')
      GROUP BY compliance_case.id, activity.calculation_approval_state,
        policy.requirements_complete, policy.publish_state`,
    [
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    ],
  );
  if (
    !readiness
    || !["published", "withdrawn"].includes(
      valueText(readiness.publish_state),
    )
    || Number(readiness.requirements_complete || 0) !== 1
    || Number(readiness.requirement_count || 0) < 1
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_EVIDENCE_NOT_READY",
      409,
      "Every requirement in the case-pinned immutable evidence policy must have accepted current evidence before approval.",
    );
  }
  if (valueText(readiness.publish_state) === "withdrawn") {
    throw new CreditexOperationsError(
      "CREDITEX_POLICY_WITHDRAWN",
      409,
      "This case remains auditable against its pinned policy, but approval is blocked because that policy was withdrawn.",
    );
  }
  if (
    Number(readiness.ready_count || 0)
      !== Number(readiness.requirement_count || 0)
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_EVIDENCE_NOT_READY",
      409,
      "Every requirement in the case-pinned immutable evidence policy must have accepted current evidence before approval.",
    );
  }
  if (Number(readiness.open_findings || 0) !== 0) {
    throw new CreditexOperationsError(
      "CREDITEX_FINDINGS_OPEN",
      409,
      "Resolve every open compliance finding before approval.",
    );
  }
  return {
    calculationApprovalState: valueText(
      readiness.calculation_approval_state,
    ),
  };
}

async function requireLatestApprovedDecision(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  decisionType: "evidence_complete" | "eligibility" | "ready_to_submit",
) {
  const decision = await first(
    database,
    `SELECT decision.id, decision.outcome
      FROM compliance_case_decisions decision
      WHERE decision.id = (
        SELECT latest.id
        FROM compliance_case_decisions latest
        WHERE latest.case_id = ? AND latest.organisation_id = ?
          AND latest.decision_type = ? AND latest.case_revision = ?
        ORDER BY latest.decided_at DESC, latest.id DESC
        LIMIT 1
      )
        AND decision.outcome = 'approved'`,
    [
      complianceCase.id,
      identity.organisationId,
      decisionType,
      complianceCase.revision,
    ],
  );
  if (!decision) {
    throw new CreditexOperationsError(
      "CREDITEX_PRIOR_DECISION_REQUIRED",
      409,
      `The latest ${decisionType.replaceAll("_", " ")} decision for this exact case revision must be approved first.`,
    );
  }
}

async function requireVerifiedCalculation(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  calculationApprovalState: string,
) {
  if (calculationApprovalState === "not_applicable") return null;
  if (calculationApprovalState !== "approved") {
    throw new CreditexOperationsError(
      "CREDITEX_CALCULATION_NOT_APPROVED",
      409,
      "The activity calculation contract is not approved for this case.",
    );
  }
  const calculation = await findVerifiedCalculation(
    database,
    identity,
    complianceCase,
  );
  if (!calculation) {
    throw new CreditexOperationsError(
      "CREDITEX_CALCULATION_NOT_VERIFIED",
      409,
      "A verified run of an approved calculator is required for this exact case revision.",
    );
  }
  return calculation;
}

async function findVerifiedCalculation(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
) {
  return first(
    database,
    `SELECT run.id, run.case_revision, run.calculator_version_id,
        run.input_snapshot, run.output_snapshot, run.status,
        run.run_by_uid, run.run_at, run.verified_by_uid, run.verified_at,
        calculator.version calculator_version,
        calculator.official_source_version calculator_source_version,
        calculator.official_source_sha256 calculator_source_sha256
      FROM compliance_calculation_runs run
      JOIN compliance_calculator_versions calculator
        ON calculator.id = run.calculator_version_id
        AND calculator.organisation_id = run.organisation_id
        AND calculator.activity_version_id = ?
        AND calculator.approval_state = 'approved'
      WHERE run.case_id = ? AND run.organisation_id = ?
        AND run.case_revision = ? AND run.status = 'verified'
      ORDER BY run.run_at DESC, run.id DESC
      LIMIT 1`,
    [
      complianceCase.activityVersionId,
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    ],
  );
}

async function buildDecisionBasisSnapshot(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  decisionType: "evidence_complete" | "eligibility" | "ready_to_submit",
  generatedAt: string,
  reviewerNote: string,
) {
  const policy = await first(
    database,
    `SELECT policy.id, policy.version, policy.publish_state,
        policy.official_source_title, policy.official_source_version,
        policy.official_source_sha256,
        activity.calculation_approval_state
      FROM compliance_cases compliance_case
      JOIN compliance_evidence_policy_versions policy
        ON policy.id = compliance_case.evidence_policy_version_id
        AND policy.organisation_id = compliance_case.organisation_id
        AND policy.activity_version_id = compliance_case.activity_version_id
        AND policy.requirements_complete = 1
        AND policy.publish_state IN ('published', 'withdrawn')
      JOIN compliance_activity_versions activity
        ON activity.id = compliance_case.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
        AND program.id = compliance_case.program_id
        AND program.organisation_id = compliance_case.organisation_id
      WHERE compliance_case.id = ?
        AND compliance_case.organisation_id = ?
        AND compliance_case.revision = ?`,
    [
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    ],
  );
  if (!policy) {
    throw new CreditexOperationsError(
      "CREDITEX_EVIDENCE_POLICY_INVALID",
      409,
      "The case must remain pinned to a complete published or withdrawn evidence policy.",
    );
  }
  const [acceptedEvidence, openFindings, priorApprovedDecisions] =
    await Promise.all([
      rows(
        database,
        `SELECT evidence.id, evidence.requirement_id,
            evidence.original_sha256
          FROM compliance_case_evidence evidence
          WHERE evidence.case_id = ?
            AND evidence.organisation_id = ?
            AND evidence.status = 'accepted'
            AND NOT EXISTS (
              SELECT 1
              FROM compliance_case_evidence replacement
              WHERE replacement.case_id = evidence.case_id
                AND replacement.organisation_id = evidence.organisation_id
                AND replacement.supersedes_evidence_id = evidence.id
            )
          ORDER BY evidence.requirement_id, evidence.id`,
        [complianceCase.id, identity.organisationId],
      ),
      rows(
        database,
        `SELECT finding.id, finding.evidence_id, finding.requirement_id,
            finding.finding_code, finding.severity, finding.status
          FROM compliance_case_findings finding
          WHERE finding.case_id = ?
            AND finding.organisation_id = ?
            AND finding.status = 'open'
          ORDER BY finding.severity DESC, finding.raised_at, finding.id`,
        [complianceCase.id, identity.organisationId],
      ),
      rows(
        database,
        `SELECT decision.id, decision.decision_type, decision.decided_at
          FROM compliance_case_decisions decision
          WHERE decision.case_id = ?
            AND decision.organisation_id = ?
            AND decision.case_revision = ?
            AND decision.outcome = 'approved'
          ORDER BY decision.decided_at, decision.id`,
        [
          complianceCase.id,
          identity.organisationId,
          complianceCase.revision,
        ],
      ),
    ]);
  const calculationApprovalState = valueText(
    policy.calculation_approval_state,
  );
  const calculation = decisionType === "ready_to_submit"
    && calculationApprovalState !== "not_applicable"
    ? await findVerifiedCalculation(database, identity, complianceCase)
    : null;
  return JSON.stringify({
    schemaVersion: "creditex-decision-basis-v1",
    generatedAt,
    decisionType,
    case: {
      id: complianceCase.id,
      revision: complianceCase.revision,
      programId: complianceCase.programId,
      activityVersionId: complianceCase.activityVersionId,
    },
    reviewerAttestation: {
      note: reviewerNote,
      recordedByUid: identity.uid,
      authority: "context_only",
    },
    evidencePolicy: {
      id: valueText(policy.id),
      version: Number(policy.version || 0),
      publishState: valueText(policy.publish_state),
      officialSourceTitle: valueText(policy.official_source_title),
      officialSourceVersion: valueText(policy.official_source_version),
      officialSourceSha256: valueText(policy.official_source_sha256),
    },
    acceptedEvidence: acceptedEvidence.map((evidence) => ({
      id: valueText(evidence.id),
      requirementId: valueText(evidence.requirement_id),
      originalSha256: valueText(evidence.original_sha256),
    })),
    openFindingState: {
      count: openFindings.length,
      findings: openFindings.map((finding) => ({
        id: valueText(finding.id),
        evidenceId: valueText(finding.evidence_id),
        requirementId: valueText(finding.requirement_id),
        findingCode: valueText(finding.finding_code),
        severity: valueText(finding.severity),
        status: valueText(finding.status),
      })),
    },
    priorApprovedDecisions: priorApprovedDecisions.map((decision) => ({
      id: valueText(decision.id),
      decisionType: valueText(decision.decision_type),
      decidedAt: valueText(decision.decided_at),
    })),
    calculation: {
      approvalState: calculationApprovalState,
      verifiedRun: calculation
        ? {
            id: valueText(calculation.id),
            caseRevision: Number(calculation.case_revision || 0),
            calculatorVersionId: valueText(
              calculation.calculator_version_id,
            ),
            calculatorVersion: Number(calculation.calculator_version || 0),
            calculatorOfficialSourceVersion: valueText(
              calculation.calculator_source_version,
            ),
            calculatorOfficialSourceSha256: valueText(
              calculation.calculator_source_sha256,
            ),
            inputSnapshot: safeJsonValue(calculation.input_snapshot),
            outputSnapshot: safeJsonValue(calculation.output_snapshot),
            status: valueText(calculation.status),
            runByUid: valueText(calculation.run_by_uid),
            runAt: valueText(calculation.run_at),
            verifiedByUid: valueText(calculation.verified_by_uid),
            verifiedAt: valueText(calculation.verified_at),
          }
        : null,
    },
  });
}

async function assertDecisionPrerequisites(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  decisionType: string,
  outcome: string,
) {
  if (outcome !== "approved") return;
  if (!["evidence_complete", "eligibility", "ready_to_submit"].includes(
    decisionType,
  )) return;
  const readiness = await requireEvidenceReady(
    database,
    identity,
    complianceCase,
  );
  if (decisionType === "eligibility") {
    await requireLatestApprovedDecision(
      database,
      identity,
      complianceCase,
      "evidence_complete",
    );
  }
  if (decisionType === "ready_to_submit") {
    await requireLatestApprovedDecision(
      database,
      identity,
      complianceCase,
      "eligibility",
    );
    await requireVerifiedCalculation(
      database,
      identity,
      complianceCase,
      readiness.calculationApprovalState,
    );
  }
}

function decisionCaseStateStatement(
  database: D1Database,
  identity: ComplianceIdentity,
  complianceCase: OwnedCase,
  decisionType: string,
  outcome: string,
  updatedAt: string,
) {
  const status = outcome === "approved"
    ? decisionType === "ready_to_submit"
      ? "ready_for_submission"
      : "in_review"
    : outcome === "rejected"
      ? "rejected"
      : outcome === "changes_required"
        ? "changes_requested"
        : "draft";
  const evidenceStatus = decisionType === "evidence_complete"
    && outcome === "approved"
    ? "verified"
    : null;
  return database.prepare(`UPDATE compliance_cases
    SET status = ?,
      evidence_status = COALESCE(?, evidence_status),
      updated_at = ?
    WHERE id = ? AND organisation_id = ? AND revision = ?
      AND status IN (
        'draft', 'in_review', 'changes_requested', 'ready_for_submission'
      )`)
    .bind(
      status,
      evidenceStatus,
      updatedAt,
      complianceCase.id,
      identity.organisationId,
      complianceCase.revision,
    );
}

export async function executeCreditexOperation(
  database: D1Database,
  identity: ComplianceIdentity,
  body: Input,
) {
  const actionText = text(body.action, "Action", 80);
  if (
    CREDITEX_DISABLED_EXTERNAL_ACTIONS.includes(
      actionText as typeof CREDITEX_DISABLED_EXTERNAL_ACTIONS[number],
    )
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_EXTERNAL_ACTION_DISABLED",
      409,
      "External submissions, registry mutations, calculator execution, and trade execution are disabled until their governed integrations are approved.",
    );
  }
  if (!CREDITEX_OPERATION_ACTIONS.includes(
    actionText as CreditexOperationAction,
  )) {
    throw new CreditexOperationsError(
      "CREDITEX_ACTION_INVALID",
      400,
      "Choose a supported Creditex operations action.",
    );
  }
  const action = actionText as CreditexOperationAction;
  assertActionRole(identity, action);
  const now = new Date().toISOString();

  if (action === "assign_case") {
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    const userId = text(body.complianceUserId, "Compliance user", 180);
    const assignmentRole = choice(body.assignmentRole, "Assignment role", [
      "case_manager",
      "primary_reviewer",
      "secondary_reviewer",
      "auditor",
    ] as const);
    const member = await requireRecord(
      database,
      `SELECT id, role FROM compliance_users
        WHERE id = ? AND organisation_id = ? AND status = 'active'`,
      [userId, identity.organisationId],
      "The named compliance member is not active in this organisation.",
    );
    const compatibleRoles: Record<typeof assignmentRole, string[]> = {
      case_manager: ["admin", "case_manager"],
      primary_reviewer: ["admin", "reviewer"],
      secondary_reviewer: ["admin", "reviewer"],
      auditor: ["admin", "auditor"],
    };
    if (!compatibleRoles[assignmentRole].includes(valueText(member.role))) {
      throw new CreditexOperationsError(
        "CREDITEX_ASSIGNMENT_ROLE_MISMATCH",
        409,
        "The named member does not hold the role required for this assignment.",
      );
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_case_assignments (
          id, organisation_id, case_id, compliance_user_id, assignment_role,
          status, assigned_by_uid, assigned_at, released_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?, '', '')`)
        .bind(
          id,
          identity.organisationId,
          complianceCase.id,
          userId,
          assignmentRole,
          identity.uid,
          now,
        ),
    ], {
      eventType: "case.assignment_created",
      targetType: "compliance_case_assignment",
      targetId: id,
      summary: "A named compliance member was assigned to a case.",
      metadata: { caseId: complianceCase.id, assignmentRole },
    }, now);
    return { id };
  }

  if (action === "release_case_assignment") {
    const assignmentId = text(body.assignmentId, "Assignment", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_case_assignments
        WHERE id = ? AND organisation_id = ? AND status = 'assigned'`,
      [assignmentId, identity.organisationId],
      "The active assignment was not found in this organisation.",
    );
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_case_assignments
        SET status = 'released', released_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'assigned'`)
        .bind(now, assignmentId, identity.organisationId),
    ], {
      eventType: "case.assignment_released",
      targetType: "compliance_case_assignment",
      targetId: assignmentId,
      summary: "A compliance case assignment was released.",
    }, now);
    return { id: assignmentId };
  }

  if (action === "create_task") {
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    const taskType = choice(body.taskType, "Task type", [
      "evidence", "review", "correction", "submission",
      "reconciliation", "participant", "general",
    ] as const);
    const priority = choice(body.priority || "normal", "Priority", [
      "low", "normal", "high", "urgent",
    ] as const);
    const assigneeUserId = text(
      body.assigneeUserId,
      "Assignee",
      180,
      false,
    );
    if (assigneeUserId) {
      await requireRecord(
        database,
        `SELECT id FROM compliance_users
          WHERE id = ? AND organisation_id = ? AND status = 'active'`,
        [assigneeUserId, identity.organisationId],
        "The named task assignee is not active in this organisation.",
      );
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_case_tasks (
          id, organisation_id, case_id, task_type, title, detail, priority,
          status, assignee_user_id, due_at, created_by_uid,
          completed_by_uid, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, '', '', ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          complianceCase.id,
          taskType,
          text(body.title, "Task title", 180),
          text(body.detail, "Task detail", 2_000, false),
          priority,
          assigneeUserId,
          instant(body.dueAt, "Due date", false),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "case.task_created",
      targetType: "compliance_case_task",
      targetId: id,
      summary: "A compliance case task was created.",
      metadata: { caseId: complianceCase.id, taskType, priority },
    }, now);
    return { id };
  }

  if (action === "complete_task") {
    const taskId = text(body.taskId, "Task", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_case_tasks
        WHERE id = ? AND organisation_id = ?
          AND status IN ('open', 'in_progress', 'blocked')`,
      [taskId, identity.organisationId],
      "The active task was not found in this organisation.",
    );
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_case_tasks
        SET status = 'completed', completed_by_uid = ?, completed_at = ?,
          updated_at = ?
        WHERE id = ? AND organisation_id = ?
          AND status IN ('open', 'in_progress', 'blocked')`)
        .bind(identity.uid, now, now, taskId, identity.organisationId),
    ], {
      eventType: "case.task_completed",
      targetType: "compliance_case_task",
      targetId: taskId,
      summary: "A compliance case task was completed.",
    }, now);
    return { id: taskId };
  }

  if (action === "create_finding") {
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    const evidenceId = text(body.evidenceId, "Evidence", 180, false);
    if (evidenceId) {
      await requireRecord(
        database,
        `SELECT id FROM compliance_case_evidence
          WHERE id = ? AND case_id = ? AND organisation_id = ?`,
        [evidenceId, complianceCase.id, identity.organisationId],
        "The evidence record was not found on this case.",
      );
    }
    const severity = choice(body.severity, "Finding severity", [
      "information", "minor", "major", "critical",
    ] as const);
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_case_findings (
          id, organisation_id, case_id, evidence_id, requirement_id,
          finding_code, severity, description, status, raised_by_uid,
          raised_at, resolved_by_uid, resolved_at, resolution_note,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, '', '', '', ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          complianceCase.id,
          evidenceId,
          text(body.requirementId, "Requirement", 180, false),
          text(body.findingCode, "Finding code", 120),
          severity,
          text(body.description, "Finding description", 4_000),
          identity.uid,
          now,
          now,
          now,
        ),
      bumpCaseRevisionStatement(
        database,
        identity,
        complianceCase,
        now,
      ),
    ], {
      eventType: "case.finding_created",
      targetType: "compliance_case_finding",
      targetId: id,
      summary: "A compliance finding was recorded.",
      metadata: { caseId: complianceCase.id, severity },
    }, now);
    return { id };
  }

  if (action === "resolve_finding") {
    const findingId = text(body.findingId, "Finding", 180);
    const finding = await requireRecord(
      database,
      `SELECT finding.id, compliance_case.id case_id,
          compliance_case.revision, compliance_case.program_id,
          compliance_case.activity_version_id,
          compliance_case.evidence_policy_version_id,
          compliance_case.status, compliance_case.evidence_status
        FROM compliance_case_findings finding
        JOIN compliance_cases compliance_case
          ON compliance_case.id = finding.case_id
          AND compliance_case.organisation_id = finding.organisation_id
        WHERE finding.id = ? AND finding.organisation_id = ?
          AND finding.status = 'open'`,
      [findingId, identity.organisationId],
      "The open finding was not found in this organisation.",
    );
    const complianceCase: OwnedCase = {
      id: valueText(finding.case_id),
      revision: Number(finding.revision || 0),
      programId: valueText(finding.program_id),
      activityVersionId: valueText(finding.activity_version_id),
      evidencePolicyVersionId: valueText(
        finding.evidence_policy_version_id,
      ),
      status: valueText(finding.status),
      evidenceStatus: valueText(finding.evidence_status),
    };
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_case_findings
        SET status = 'resolved', resolved_by_uid = ?, resolved_at = ?,
          resolution_note = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'open'`)
        .bind(
          identity.uid,
          now,
          text(body.resolutionNote, "Resolution note", 4_000),
          now,
          findingId,
          identity.organisationId,
        ),
      bumpCaseRevisionStatement(
        database,
        identity,
        complianceCase,
        now,
      ),
    ], {
      eventType: "case.finding_resolved",
      targetType: "compliance_case_finding",
      targetId: findingId,
      summary: "A compliance finding was resolved with a recorded note.",
    }, now);
    return { id: findingId };
  }

  if (action === "review_evidence") {
    const evidenceId = text(body.evidenceId, "Evidence", 180);
    const status = choice(body.status, "Evidence review status", [
      "under_review", "accepted", "rejected",
    ] as const);
    const evidenceAccessReceiptId = text(
      body.evidenceAccessReceiptId,
      "Evidence access receipt",
      180,
      false,
    );
    if (
      status !== "under_review"
      && !evidenceAccessReceiptId
    ) {
      throw new CreditexOperationsError(
        "CREDITEX_EVIDENCE_ACCESS_REQUIRED",
        409,
        "Open this evidence immediately before accepting or rejecting it.",
      );
    }
    const reviewNote = text(
      body.reviewNote,
      "Review note",
      4_000,
      status !== "under_review",
    );
    const evidence = await requireRecord(
      database,
      `SELECT evidence.id, compliance_case.id case_id,
          compliance_case.revision, compliance_case.program_id,
          compliance_case.activity_version_id,
          compliance_case.evidence_policy_version_id,
          compliance_case.status case_status,
          compliance_case.evidence_status
        FROM compliance_case_evidence evidence
        JOIN compliance_cases compliance_case
          ON compliance_case.id = evidence.case_id
          AND compliance_case.organisation_id = evidence.organisation_id
        WHERE evidence.id = ? AND evidence.organisation_id = ?
          AND evidence.status IN ('received', 'under_review')`,
      [evidenceId, identity.organisationId],
      "The reviewable evidence record was not found in this organisation.",
    );
    const complianceCase: OwnedCase = {
      id: valueText(evidence.case_id),
      revision: Number(evidence.revision || 0),
      programId: valueText(evidence.program_id),
      activityVersionId: valueText(evidence.activity_version_id),
      evidencePolicyVersionId: valueText(
        evidence.evidence_policy_version_id,
      ),
      status: valueText(evidence.case_status),
      evidenceStatus: valueText(evidence.evidence_status),
    };
    if (status !== "under_review") {
      await requireActiveReviewerAssignment(
        database,
        identity,
        complianceCase,
        "evidence_review",
      );
      await requireRecentEvidenceAccessReceipt(
        database,
        identity,
        evidenceId,
        evidenceAccessReceiptId,
        now,
      );
    }
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_case_evidence
        SET status = ?, reviewed_by_uid = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ?
          AND status IN ('received', 'under_review')`)
        .bind(
          status,
          identity.uid,
          now,
          now,
          evidenceId,
          identity.organisationId,
        ),
      recomputeEvidenceStatusStatement(
        database,
        identity,
        complianceCase,
        now,
      ),
    ], {
      eventType: "case.evidence_reviewed",
      targetType: "compliance_case_evidence",
      targetId: evidenceId,
      summary: "An evidence review outcome was recorded.",
      metadata: {
        status,
        reviewNote,
        evidenceAccessReceiptId,
      },
    }, now);
    return { id: evidenceId, status };
  }

  if (action === "record_decision") {
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    if (![
      "draft",
      "in_review",
      "changes_requested",
      "ready_for_submission",
    ].includes(complianceCase.status)) {
      throw new CreditexOperationsError(
        "CREDITEX_CASE_IMMUTABLE",
        409,
        "This case state does not permit another local compliance decision.",
      );
    }
    const decisionType = choice(body.decisionType, "Decision type", [
      "evidence_complete", "eligibility", "ready_to_submit",
    ] as const);
    const outcome = choice(body.outcome, "Decision outcome", [
      "approved", "rejected", "changes_required", "withdrawn",
    ] as const);
    const requiresDualControl = outcome === "approved"
      && (decisionType === "eligibility" || decisionType === "ready_to_submit");
    const decisionRequestId = text(
      body.decisionRequestId,
      "Decision request",
      180,
      false,
    );
    if (decisionRequestId && !requiresDualControl) {
      throw new CreditexOperationsError(
        "CREDITEX_DECISION_REQUEST_INVALID",
        400,
        "Secondary approval applies only to approved eligibility or ready-to-submit decisions.",
      );
    }
    await requireActiveReviewerAssignment(
      database,
      identity,
      complianceCase,
      decisionRequestId ? "secondary_reviewer" : "primary_reviewer",
    );
    await assertDecisionPrerequisites(
      database,
      identity,
      complianceCase,
      decisionType,
      outcome,
    );
    const basisSnapshot = decisionRequestId
      ? ""
      : await buildDecisionBasisSnapshot(
          database,
          identity,
          complianceCase,
          decisionType,
          now,
          text(body.reviewerNote, "Reviewer basis", 4000, false),
        );
    if (requiresDualControl) {
      const requestId = decisionRequestId;
      if (!requestId) {
        const id = crypto.randomUUID();
        await writeWithAudit(database, identity, [
          database.prepare(`INSERT INTO compliance_decision_requests (
              id, organisation_id, case_id, case_revision,
              decision_type, outcome,
              basis_snapshot, status, primary_reviewer_uid,
              secondary_reviewer_uid, reviewed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'approved', ?, 'pending', ?, '', '', ?, ?)`)
            .bind(
              id,
              identity.organisationId,
              complianceCase.id,
              complianceCase.revision,
              decisionType,
              basisSnapshot,
              identity.uid,
              now,
              now,
            ),
        ], {
          eventType: "case.decision_secondary_review_requested",
          targetType: "compliance_decision_request",
          targetId: id,
          summary: "A dual-control compliance decision was sent for independent secondary review.",
          metadata: { caseId: complianceCase.id, decisionType, outcome },
        }, now);
        return {
          id,
          status: "pending_secondary_review",
          decisionCreated: false,
        };
      }
      const request = await requireRecord(
        database,
        `SELECT request.id, request.case_id, request.case_revision,
            request.decision_type, request.outcome, request.basis_snapshot,
            request.primary_reviewer_uid
          FROM compliance_decision_requests request
          JOIN compliance_users primary_member
            ON primary_member.firebase_uid = request.primary_reviewer_uid
            AND primary_member.organisation_id = request.organisation_id
            AND primary_member.status = 'active'
            AND primary_member.role IN ('admin', 'reviewer')
          WHERE request.id = ? AND request.organisation_id = ?
            AND request.case_id = ? AND request.status = 'pending'`,
        [requestId, identity.organisationId, complianceCase.id],
        "The pending request or its active primary reviewer was not found on this case.",
      );
      if (valueText(request.primary_reviewer_uid) === identity.uid) {
        throw new CreditexOperationsError(
          "CREDITEX_DUAL_CONTROL_REQUIRED",
          409,
          "A different named reviewer must complete the secondary approval.",
        );
      }
      if (
        valueText(request.decision_type) !== decisionType
        || valueText(request.outcome) !== outcome
        || Number(request.case_revision || 0) !== complianceCase.revision
      ) {
        throw new CreditexOperationsError(
          "CREDITEX_DECISION_REQUEST_MISMATCH",
          409,
          "The secondary review must use the unchanged decision type and outcome.",
        );
      }
      const decisionId = crypto.randomUUID();
      await writeWithAudit(database, identity, [
        database.prepare(`INSERT INTO compliance_case_decisions (
            id, organisation_id, case_id, case_revision,
            decision_type, outcome,
            basis_snapshot, primary_reviewer_uid, secondary_reviewer_uid,
            decided_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            decisionId,
            identity.organisationId,
            complianceCase.id,
            complianceCase.revision,
            decisionType,
            outcome,
            valueText(request.basis_snapshot),
            valueText(request.primary_reviewer_uid),
            identity.uid,
            now,
            now,
          ),
        database.prepare(`UPDATE compliance_decision_requests
          SET status = 'approved', secondary_reviewer_uid = ?,
            reviewed_at = ?, updated_at = ?
          WHERE id = ? AND organisation_id = ? AND status = 'pending'`)
          .bind(identity.uid, now, now, requestId, identity.organisationId),
        decisionCaseStateStatement(
          database,
          identity,
          complianceCase,
          decisionType,
          outcome,
          now,
        ),
      ], {
        eventType: "case.decision_recorded",
        targetType: "compliance_case_decision",
        targetId: decisionId,
        summary: "An independently approved dual-control compliance decision was recorded.",
        metadata: {
          caseId: complianceCase.id,
          decisionRequestId: requestId,
          decisionType,
          outcome,
          dualControl: true,
        },
      }, now);
      return { id: decisionId, decisionRequestId: requestId };
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_case_decisions (
          id, organisation_id, case_id, case_revision,
          decision_type, outcome,
          basis_snapshot, primary_reviewer_uid, secondary_reviewer_uid,
          decided_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          complianceCase.id,
          complianceCase.revision,
          decisionType,
          outcome,
          basisSnapshot,
          identity.uid,
          "",
          now,
          now,
        ),
      decisionCaseStateStatement(
        database,
        identity,
        complianceCase,
        decisionType,
        outcome,
        now,
      ),
    ], {
      eventType: "case.decision_recorded",
      targetType: "compliance_case_decision",
      targetId: id,
      summary: "An immutable compliance decision was recorded.",
      metadata: {
        caseId: complianceCase.id,
        decisionType,
        outcome,
        dualControl: false,
      },
    }, now);
    return { id };
  }

  if (action === "add_participant") {
    const participantType = choice(body.participantType, "Participant type", [
      "installer", "retailer", "aggregator", "auditor", "supplier", "agent",
    ] as const);
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_participants (
          id, organisation_id, participant_type, external_reference,
          legal_name, trading_name, abn, contact_email, status,
          effective_from, effective_to, created_by_uid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          participantType,
          text(body.externalReference, "External reference", 180, false),
          text(body.legalName, "Legal name", 240),
          text(body.tradingName, "Trading name", 240, false),
          text(body.abn, "ABN", 20, false),
          text(body.contactEmail, "Contact email", 320, false).toLowerCase(),
          dateOnly(body.effectiveFrom, "Effective from", false),
          dateOnly(body.effectiveTo, "Effective to", false),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "participant.created",
      targetType: "compliance_participant",
      targetId: id,
      summary: "A pending compliance participant record was created.",
      metadata: { participantType },
    }, now);
    return { id };
  }

  if (action === "add_participant_ability") {
    const participantId = text(body.participantId, "Participant", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_participants
        WHERE id = ? AND organisation_id = ?`,
      [participantId, identity.organisationId],
      "The participant was not found in this organisation.",
    );
    const programId = text(body.programId, "Program", 180, false);
    const activityVersionId = text(
      body.activityVersionId,
      "Activity version",
      180,
      false,
    );
    if (programId) {
      await requireRecord(
        database,
        `SELECT id FROM compliance_programs
          WHERE id = ? AND organisation_id = ?`,
        [programId, identity.organisationId],
        "The program was not found in this organisation.",
      );
    }
    if (activityVersionId) {
      const activity = await requireRecord(
        database,
        `SELECT activity.id, activity.program_id
          FROM compliance_activity_versions activity
          JOIN compliance_programs program
            ON program.id = activity.program_id
          WHERE activity.id = ? AND program.organisation_id = ?`,
        [activityVersionId, identity.organisationId],
        "The activity version was not found in this organisation.",
      );
      if (
        programId
        && valueText(activity.program_id) !== programId
      ) {
        throw new CreditexOperationsError(
          "CREDITEX_ABILITY_PROGRAM_MISMATCH",
          409,
          "The participant ability activity must belong to the selected program.",
        );
      }
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_participant_abilities (
          id, organisation_id, participant_id, program_id, activity_version_id,
          ability_code, ability_role, status, effective_from, effective_to,
          evidence_snapshot, approved_by_uid, approved_at, created_by_uid,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, '', '', ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          participantId,
          programId,
          activityVersionId,
          text(body.abilityCode, "Ability code", 160),
          text(body.abilityRole, "Ability role", 160),
          dateOnly(body.effectiveFrom, "Effective from"),
          dateOnly(body.effectiveTo, "Effective to", false),
          jsonObject(body.evidenceSnapshot, "Ability evidence"),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "participant.ability_created",
      targetType: "compliance_participant_ability",
      targetId: id,
      summary: "A pending participant ability was recorded.",
      metadata: { participantId },
    }, now);
    return { id };
  }

  if (action === "add_equipment") {
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    const recordType = choice(body.recordType, "Equipment record type", [
      "installed", "decommissioned", "stock",
    ] as const);
    const status = choice(body.status, "Equipment status", [
      "expected", "received", "installed", "decommissioned",
      "removed", "returned", "scrapped",
    ] as const);
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_equipment_records (
          id, organisation_id, case_id, record_type, manufacturer, model,
          serial_number, product_registry, product_reference, quantity, status,
          evidence_snapshot, recorded_by_uid, recorded_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          complianceCase.id,
          recordType,
          text(body.manufacturer, "Manufacturer", 180, false),
          text(body.model, "Model", 180, false),
          text(body.serialNumber, "Serial number", 180, false),
          text(body.productRegistry, "Product registry", 180, false),
          text(body.productReference, "Product reference", 180, false),
          integer(body.quantity ?? 1, "Quantity", 1, 100_000),
          status,
          jsonObject(body.evidenceSnapshot, "Equipment evidence"),
          identity.uid,
          now,
          now,
          now,
        ),
      bumpCaseRevisionStatement(
        database,
        identity,
        complianceCase,
        now,
      ),
    ], {
      eventType: "case.equipment_recorded",
      targetType: "compliance_equipment_record",
      targetId: id,
      summary: "A case equipment record was created.",
      metadata: { caseId: complianceCase.id, recordType, status },
    }, now);
    return { id };
  }

  if (action === "create_draft_batch") {
    const programId = text(body.programId, "Program", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_programs
        WHERE id = ? AND organisation_id = ?`,
      [programId, identity.organisationId],
      "The program was not found in this organisation.",
    );
    const format = choice(body.format, "Batch format", [
      "json", "csv", "manual", "api",
    ] as const);
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_submission_batches (
          id, organisation_id, program_id, batch_number, external_reference,
          format, status, payload_sha256, case_count, certificate_quantity,
          created_by_uid, exported_at, submitted_at, reconciled_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', '', 0, 0, ?, '', '', '', ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          programId,
          text(body.batchNumber, "Batch number", 180),
          text(body.externalReference, "External reference", 180, false),
          format,
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "submission.batch_created",
      targetType: "compliance_submission_batch",
      targetId: id,
      summary: "A local draft submission batch was created.",
      metadata: { programId, format },
    }, now);
    return { id };
  }

  if (action === "stage_batch_item") {
    const batchId = text(body.batchId, "Batch", 180);
    const batch = await requireRecord(
      database,
      `SELECT id, program_id FROM compliance_submission_batches
        WHERE id = ? AND organisation_id = ? AND status = 'draft'`,
      [batchId, identity.organisationId],
      "The editable draft batch was not found in this organisation.",
    );
    const complianceCase = await requireOwnedCase(database, identity, body.caseId);
    if (valueText(batch.program_id) !== complianceCase.programId) {
      throw new CreditexOperationsError(
        "CREDITEX_BATCH_PROGRAM_MISMATCH",
        409,
        "The case and submission batch must belong to the same governed program.",
      );
    }
    if (complianceCase.status !== "ready_for_submission") {
      throw new CreditexOperationsError(
        "CREDITEX_CASE_NOT_READY",
        409,
        "The case is not in the ready-for-submission state.",
      );
    }
    const readiness = await requireEvidenceReady(
      database,
      identity,
      complianceCase,
    );
    await requireLatestApprovedDecision(
      database,
      identity,
      complianceCase,
      "ready_to_submit",
    );
    await requireVerifiedCalculation(
      database,
      identity,
      complianceCase,
      readiness.calculationApprovalState,
    );
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_submission_batch_items (
          id, organisation_id, batch_id, case_id, case_revision, status,
          external_reference, result_snapshot, created_by_uid, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'staged', '', '{}', ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          batchId,
          complianceCase.id,
          complianceCase.revision,
          identity.uid,
          now,
          now,
        ),
      database.prepare(`UPDATE compliance_submission_batches
        SET case_count = (
          SELECT COUNT(*) FROM compliance_submission_batch_items
          WHERE batch_id = ? AND organisation_id = ? AND status <> 'removed'
        ), updated_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'draft'`)
        .bind(
          batchId,
          identity.organisationId,
          now,
          batchId,
          identity.organisationId,
        ),
    ], {
      eventType: "submission.item_staged",
      targetType: "compliance_submission_batch_item",
      targetId: id,
      summary: "A case revision was staged in a local draft batch.",
      metadata: {
        batchId,
        caseId: complianceCase.id,
        caseRevision: complianceCase.revision,
      },
    }, now);
    return { id };
  }

  if (action === "remove_batch_item") {
    const itemId = text(body.batchItemId, "Batch item", 180);
    const item = await requireRecord(
      database,
      `SELECT item.id, item.batch_id
        FROM compliance_submission_batch_items item
        JOIN compliance_submission_batches batch
          ON batch.id = item.batch_id
          AND batch.organisation_id = item.organisation_id
        WHERE item.id = ? AND item.organisation_id = ?
          AND item.status = 'staged' AND batch.status = 'draft'`,
      [itemId, identity.organisationId],
      "The staged item was not found in an editable draft batch.",
    );
    const batchId = valueText(item.batch_id);
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_submission_batch_items
        SET status = 'removed', updated_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'staged'`)
        .bind(now, itemId, identity.organisationId),
      database.prepare(`UPDATE compliance_submission_batches
        SET case_count = (
          SELECT COUNT(*) FROM compliance_submission_batch_items
          WHERE batch_id = ? AND organisation_id = ? AND status <> 'removed'
        ), updated_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'draft'`)
        .bind(
          batchId,
          identity.organisationId,
          now,
          batchId,
          identity.organisationId,
        ),
    ], {
      eventType: "submission.item_removed",
      targetType: "compliance_submission_batch_item",
      targetId: itemId,
      summary: "A case was removed from a local draft batch.",
      metadata: { batchId },
    }, now);
    return { id: itemId };
  }

  if (action === "record_certificate_lot") {
    const programId = text(body.programId, "Program", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_programs
        WHERE id = ? AND organisation_id = ?`,
      [programId, identity.organisationId],
      "The program was not found in this organisation.",
    );
    const batchId = text(body.batchId, "Batch", 180, false);
    if (batchId) {
      await requireRecord(
        database,
        `SELECT id FROM compliance_submission_batches
          WHERE id = ? AND program_id = ? AND organisation_id = ?`,
        [batchId, programId, identity.organisationId],
        "The batch was not found for this program.",
      );
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_certificate_lots (
          id, organisation_id, program_id, batch_id, certificate_type,
          registry_lot_reference, quantity, status, vintage_from, vintage_to,
          created_by_uid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          programId,
          batchId,
          text(body.certificateType, "Certificate type", 120),
          text(body.registryLotReference, "Registry lot reference", 180, false),
          integer(body.quantity, "Certificate quantity", 0, 100_000_000),
          dateOnly(body.vintageFrom, "Vintage from", false),
          dateOnly(body.vintageTo, "Vintage to", false),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "certificate.lot_recorded",
      targetType: "compliance_certificate_lot",
      targetId: id,
      summary: "A local pending certificate lot was recorded.",
      metadata: { programId, hasBatch: Boolean(batchId) },
    }, now);
    return { id };
  }

  if (action === "record_trade") {
    const lotId = text(body.certificateLotId, "Certificate lot", 180);
    const quantity = integer(body.quantity, "Trade quantity", 1, 100_000_000);
    const lot = await requireRecord(
      database,
      `SELECT lot.id, lot.quantity,
          COALESCE(SUM(
            CASE WHEN trade.status IN ('pending', 'confirmed', 'settled')
              THEN trade.quantity ELSE 0 END
          ), 0) committed_quantity
        FROM compliance_certificate_lots lot
        LEFT JOIN compliance_trades trade
          ON trade.certificate_lot_id = lot.id
          AND trade.organisation_id = lot.organisation_id
        WHERE lot.id = ? AND lot.organisation_id = ?
          AND lot.status IN ('available', 'reserved')
        GROUP BY lot.id, lot.quantity`,
      [lotId, identity.organisationId],
      "An available or reserved certificate lot was not found in this organisation.",
    );
    if (
      quantity
      > Number(lot.quantity || 0) - Number(lot.committed_quantity || 0)
    ) {
      throw new CreditexOperationsError(
        "CREDITEX_LOT_QUANTITY_EXCEEDED",
        409,
        "The trade quantity exceeds the uncommitted certificate quantity.",
      );
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_trades (
          id, organisation_id, certificate_lot_id, counterparty_reference,
          quantity, unit_price_cents, trade_date, status, external_reference,
          created_by_uid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          lotId,
          text(body.counterpartyReference, "Counterparty reference", 240),
          quantity,
          integer(body.unitPriceCents, "Unit price", 0, 10_000_000_000),
          dateOnly(body.tradeDate, "Trade date"),
          text(body.externalReference, "External reference", 180, false),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "trade.recorded",
      targetType: "compliance_trade",
      targetId: id,
      summary: "A local pending certificate trade was recorded.",
      metadata: { certificateLotId: lotId, quantity },
    }, now);
    return { id };
  }

  if (action === "record_settlement") {
    const tradeId = text(body.tradeId, "Trade", 180);
    const trade = await requireRecord(
      database,
      `SELECT trade.id, trade.quantity, trade.unit_price_cents
        FROM compliance_trades trade
        WHERE trade.id = ? AND trade.organisation_id = ?
          AND trade.status IN ('pending', 'confirmed')`,
      [tradeId, identity.organisationId],
      "An unsettled local trade was not found in this organisation.",
    );
    const grossCents = integer(
      body.grossCents,
      "Gross settlement amount",
      0,
      10_000_000_000_000,
    );
    const expectedGrossCents = Number(trade.quantity)
      * Number(trade.unit_price_cents);
    if (
      !Number.isSafeInteger(expectedGrossCents)
      || grossCents !== expectedGrossCents
    ) {
      throw new CreditexOperationsError(
        "CREDITEX_SETTLEMENT_GROSS_MISMATCH",
        409,
        "Gross settlement must equal the recorded trade quantity multiplied by its unit price.",
      );
    }
    const feeCents = integer(
      body.feeCents ?? 0,
      "Settlement fee",
      0,
      grossCents,
    );
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_settlements (
          id, organisation_id, trade_id, gross_cents, fee_cents, net_cents,
          due_date, settled_at, status, external_reference,
          created_by_uid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'pending', ?, ?, ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          tradeId,
          grossCents,
          feeCents,
          grossCents - feeCents,
          dateOnly(body.dueDate, "Settlement due date"),
          text(body.externalReference, "External reference", 180, false),
          identity.uid,
          now,
          now,
        ),
    ], {
      eventType: "settlement.recorded",
      targetType: "compliance_settlement",
      targetId: id,
      summary: "A local pending settlement was recorded.",
      metadata: { tradeId },
    }, now);
    return { id };
  }

  throw new CreditexOperationsError(
    "CREDITEX_ACTION_INVALID",
    400,
    "Choose a supported Creditex operations action.",
  );
}

const SHARED_EMAIL_LOCAL_PARTS = new Set([
  "admin",
  "administrator",
  "accounts",
  "compliance",
  "contact",
  "enquiries",
  "hello",
  "info",
  "office",
  "operations",
  "support",
  "team",
]);

function namedInvitation(
  emailInput: unknown,
  displayNameInput: unknown,
) {
  const email = text(emailInput, "Email", 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new CreditexOperationsError(
      "CREDITEX_EMAIL_INVALID",
      400,
      "Enter a valid named-user email address.",
    );
  }
  const displayName = text(displayNameInput, "Full name", 180);
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  if (
    nameParts.length < 2
    || SHARED_EMAIL_LOCAL_PARTS.has(email.split("@")[0])
    || /\b(admin|administrator|shared|support|team|office)\b/i.test(displayName)
  ) {
    throw new CreditexOperationsError(
      "CREDITEX_NAMED_USER_REQUIRED",
      400,
      "Invitations must identify one person by full name and individual email address.",
    );
  }
  return { email, displayName };
}

export async function loadCreditexAccess(
  database: D1Database,
  organisationId: string,
) {
  const [memberRows, invitationRows] = await Promise.all([
    rows(database, `SELECT id, email, display_name, role, status,
        last_login_at, created_at, updated_at
      FROM compliance_users
      WHERE organisation_id = ?
      ORDER BY status, display_name, email, id
      LIMIT 250`, [organisationId]),
    rows(database, `SELECT id, email, display_name, role, status,
        expires_at, claimed_at, created_at, updated_at
      FROM compliance_invitations
      WHERE organisation_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 250`, [organisationId]),
  ]);
  return {
    members: projectRows(memberRows),
    invitations: projectRows(invitationRows),
  };
}

export async function executeCreditexAccessAction(
  database: D1Database,
  identity: ComplianceIdentity,
  body: Input,
) {
  if (identity.role !== "admin") {
    throw new CreditexOperationsError(
      "CREDITEX_ROLE_REQUIRED",
      403,
      "Only a Creditex administrator can manage portal access.",
    );
  }
  const action = text(body.action, "Action", 80);
  const now = new Date().toISOString();
  if (action === "create_invitation") {
    const { email, displayName } = namedInvitation(
      body.email,
      body.displayName,
    );
    const role = choice(body.role, "Role", [
      "admin", "case_manager", "reviewer", "auditor",
    ] as const);
    const expiresAt = instant(
      body.expiresAt
        || new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      "Invitation expiry",
    );
    const expiryTime = Date.parse(expiresAt);
    if (
      expiryTime <= Date.now()
      || expiryTime > Date.now() + 30 * 24 * 60 * 60 * 1_000
    ) {
      throw new CreditexOperationsError(
        "CREDITEX_INVITATION_EXPIRY_INVALID",
        400,
        "Invitation expiry must be within the next 30 days.",
      );
    }
    const id = crypto.randomUUID();
    await writeWithAudit(database, identity, [
      database.prepare(`INSERT INTO compliance_invitations (
          id, organisation_id, email, display_name, role, status,
          invited_by_uid, expires_at, claimed_by_uid, claimed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, '', '', ?, ?)`)
        .bind(
          id,
          identity.organisationId,
          email,
          displayName,
          role,
          identity.uid,
          expiresAt,
          now,
          now,
        ),
    ], {
      eventType: "membership.invitation_created",
      targetType: "compliance_invitation",
      targetId: id,
      summary: "A named compliance portal invitation was created.",
      metadata: { role },
    }, now);
    return { id, delivery: "not_sent" as const };
  }
  if (action === "revoke_invitation") {
    const invitationId = text(body.invitationId, "Invitation", 180);
    await requireRecord(
      database,
      `SELECT id FROM compliance_invitations
        WHERE id = ? AND organisation_id = ? AND status = 'pending'`,
      [invitationId, identity.organisationId],
      "The pending invitation was not found in this organisation.",
    );
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_invitations
        SET status = 'revoked', updated_at = ?
        WHERE id = ? AND organisation_id = ? AND status = 'pending'`)
        .bind(now, invitationId, identity.organisationId),
    ], {
      eventType: "membership.invitation_revoked",
      targetType: "compliance_invitation",
      targetId: invitationId,
      summary: "A pending compliance portal invitation was revoked.",
    }, now);
    return { id: invitationId };
  }
  if (action === "update_member_access") {
    const memberId = text(body.memberId, "Member", 180);
    const role = choice(body.role, "Role", [
      "admin", "case_manager", "reviewer", "auditor",
    ] as const);
    const status = choice(body.status, "Status", [
      "active", "suspended",
    ] as const);
    const member = await requireRecord(
      database,
      `SELECT id, role, status, email
        FROM compliance_users
        WHERE id = ? AND organisation_id = ?`,
      [memberId, identity.organisationId],
      "The compliance member was not found in this organisation.",
    );
    const removesActiveAdmin = valueText(member.role) === "admin"
      && valueText(member.status) === "active"
      && (role !== "admin" || status !== "active");
    if (removesActiveAdmin) {
      const otherAdmin = await first(
        database,
        `SELECT id FROM compliance_users
          WHERE organisation_id = ? AND id <> ?
            AND role = 'admin' AND status = 'active'
          LIMIT 1`,
        [identity.organisationId, memberId],
      );
      if (!otherAdmin) {
        throw new CreditexOperationsError(
          "CREDITEX_FINAL_ADMIN_REQUIRED",
          409,
          "Add another active named administrator before changing the final administrator.",
        );
      }
    }
    await writeWithAudit(database, identity, [
      database.prepare(`UPDATE compliance_users
        SET role = ?, status = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ?`)
        .bind(
          role,
          status,
          now,
          memberId,
          identity.organisationId,
        ),
    ], {
      eventType: "membership.access_updated",
      targetType: "compliance_user",
      targetId: memberId,
      summary: "A named compliance member role or access state was updated.",
      metadata: {
        role,
        status,
        bootstrapMailbox: valueText(member.email)
          === "info@ausenergyassessments.com",
      },
    }, now);
    return { id: memberId, role, status };
  }
  throw new CreditexOperationsError(
    "CREDITEX_ACCESS_ACTION_INVALID",
    400,
    "Choose create invitation, revoke invitation or update member access.",
  );
}
