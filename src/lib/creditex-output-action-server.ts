import {
  GOVERNMENT_PROGRAM_TEMPLATES,
  type ComplianceOutcomeClass,
} from "./australian-government-program-catalogue";
import {
  loadCreditexActivityWorkPackOutputReadiness,
  loadCreditexActivityWorkPackOutputReadinessBatch,
  loadCreditexWorkPackGovernanceIdentity,
  type CreditexWorkPackGovernanceActor,
} from "./creditex-activity-work-pack-server";
import {
  creditexCanonicalSha256,
} from "./creditex-interchange-preflight";
import type {
  CreditexWorkPackGovernanceCoverageRow,
} from "./creditex-work-pack-coverage";

export const CREDITEX_OUTPUT_ACTION_PACKET_CONTRACT =
  "creditex-output-action-packet/v1" as const;

export type CreditexOutputActionKind =
  | "certificate_submission"
  | "operational_output";
export type CreditexOutputActionStatus =
  | "prepared"
  | "submitted"
  | "provider_accepted"
  | "rejected"
  | "reconciliation_required";

export class CreditexOutputActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexOutputActionError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexOutputActionError(code, status, message);
}

function requiredText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum) {
    return fail(code, 400, `${label} is required.`);
  }
  return result;
}

function exactSha256(value: unknown, label: string) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
    return fail(
      "OUTPUT_ACTION_HASH_INVALID",
      409,
      `${label} does not retain its exact SHA-256 identity.`,
    );
  }
  return result;
}

function bareSha256(value: unknown, label: string) {
  const result = String(value || "").trim().toLowerCase()
    .replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(result)) {
    return fail(
      "OUTPUT_ACTION_HASH_INVALID",
      409,
      `${label} does not retain its exact SHA-256 identity.`,
    );
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type OutputActionOptions = Readonly<{
  now?: () => string;
  id?: (scope: string) => string;
  resolveCoverage?: (
    database: D1Database,
    actor: CreditexWorkPackGovernanceActor,
    scope: Readonly<{
      activityTemplateId: string;
      caseInstanceId: string;
    }>,
  ) => Promise<readonly CreditexWorkPackGovernanceCoverageRow[]>;
}>;

function outputNow(options?: OutputActionOptions) {
  const value = options?.now?.() || new Date().toISOString();
  if (Number.isNaN(Date.parse(value))) {
    return fail(
      "OUTPUT_ACTION_TIME_INVALID",
      500,
      "The governed output-action clock is invalid.",
    );
  }
  return value;
}

const OUTPUT_ACTION_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type CreditexOutputActionActorCapabilities = Readonly<{
  canPrepare: boolean;
  canReview: boolean;
  canSubmit: boolean;
  canRecordOutcome: boolean;
}>;

async function outputActorCapabilities(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
): Promise<CreditexOutputActionActorCapabilities> {
  const identity = await loadCreditexWorkPackGovernanceIdentity(database, actor);
  const canTransition = actor.actorKind === "admin"
    ? ["owner", "admin", "reviewer"].includes(identity.role)
    : ["admin", "case_manager", "reviewer"].includes(identity.role)
      && identity.access.canAuthor;
  return Object.freeze({
    canPrepare: identity.access.canAuthor,
    canReview: identity.access.canReview,
    canSubmit: canTransition,
    canRecordOutcome: canTransition,
  });
}

function requireOutputCapability(
  capabilities: CreditexOutputActionActorCapabilities,
  capability: keyof CreditexOutputActionActorCapabilities,
) {
  if (!capabilities[capability]) {
    return fail(
      "OUTPUT_ACTION_PERMISSION_DENIED",
      403,
      "This account is not authorised for that governed output action.",
    );
  }
}

function trustedServerActionAt(
  value: string,
  prerequisites: readonly string[],
  label: string,
) {
  const valueMs = Date.parse(value);
  const invalid = Number.isNaN(valueMs) || prerequisites.some((prerequisite) => {
    const prerequisiteMs = Date.parse(prerequisite);
    return Number.isNaN(prerequisiteMs) || valueMs < prerequisiteMs;
  });
  if (invalid) {
    return fail(
      "OUTPUT_ACTION_TIME_BEFORE_EVIDENCE",
      409,
      `${label} cannot predate its immutable prerequisite evidence.`,
    );
  }
  return new Date(valueMs).toISOString();
}

function retainedAt(trustedNow: string, occurredAt: string) {
  return new Date(Math.max(Date.parse(trustedNow), Date.parse(occurredAt)))
    .toISOString();
}

function trustedManualOccurredAt(
  value: unknown,
  earliest: string,
  trustedNow: string,
  code: string,
  label: string,
) {
  const occurredAt = String(value || "").trim();
  const occurredMs = Date.parse(occurredAt);
  const earliestMs = Date.parse(earliest);
  const nowMs = Date.parse(trustedNow);
  if (
    Number.isNaN(occurredMs) || Number.isNaN(earliestMs) || Number.isNaN(nowMs)
    || occurredMs < earliestMs
    || occurredMs > nowMs + OUTPUT_ACTION_CLOCK_SKEW_MS
  ) {
    return fail(
      code,
      400,
      `${label} must be after its prerequisite record and no more than five minutes ahead of the server clock.`,
    );
  }
  return new Date(occurredMs).toISOString();
}

function outputId(scope: string, options?: OutputActionOptions) {
  return options?.id?.(scope) || `${scope}:${crypto.randomUUID()}`;
}

async function defaultCoverage(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  scope: Readonly<{
    activityTemplateId: string;
    caseInstanceId: string;
  }>,
) {
  return Object.freeze([
    await loadCreditexActivityWorkPackOutputReadiness(database, actor, scope),
  ]);
}

async function exactCoverageRow(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  activityTemplateId: string,
  caseInstanceId: string,
  options?: OutputActionOptions,
) {
  const rows = await (options?.resolveCoverage || defaultCoverage)(
    database,
    actor,
    { activityTemplateId, caseInstanceId },
  );
  const matches = rows.filter((row) =>
    row.activityTemplateId === activityTemplateId
  );
  if (matches.length !== 1) {
    return fail(
      "OUTPUT_ACTION_ACTIVITY_READINESS_AMBIGUOUS",
      409,
      "The exact governed activity readiness row is unavailable.",
    );
  }
  return matches[0];
}

type OutputActionCoreRecord = {
  instance_id: string;
  instance_key: string;
  instance_revision: number;
  instance_status: string;
  instance_response_sha256: string;
  work_pack_version_id: string;
  compliance_case_id: string;
  activity_version_id: string;
  case_revision: number;
  activity_template_id: string;
  work_pack_schema_sha256: string;
  final_record_id: string;
  final_record_instance_sha256: string;
  final_record_response_sha256: string;
  final_record_pdf_sha256: string;
  final_record_finalised_at: string;
  calculation_run_id: string;
  calculation_input_snapshot: string;
  calculation_output_snapshot: string;
  calculation_run_by_uid: string;
  calculation_status: string;
  calculator_version_id: string;
  calculator_key: string;
  calculator_version: number;
  calculator_source_sha256: string;
  calculation_review_decision: string;
  calculation_input_sha256: string;
  calculation_output_sha256: string;
  calculation_engine_receipt_id: string;
  calculation_receipt_sha256: string;
  calculation_reviewer_uid: string;
  calculation_reviewed_at: string;
};

type OutputActionWorkPackCoreRecord = Pick<OutputActionCoreRecord,
  | "instance_id"
  | "instance_key"
  | "instance_revision"
  | "instance_status"
  | "instance_response_sha256"
  | "work_pack_version_id"
  | "compliance_case_id"
  | "activity_version_id"
  | "case_revision"
  | "activity_template_id"
  | "work_pack_schema_sha256"
  | "final_record_id"
  | "final_record_instance_sha256"
  | "final_record_response_sha256"
  | "final_record_pdf_sha256"
  | "final_record_finalised_at"
>;

async function exactCompletedWorkPackCore(
  database: D1Database,
  organisationId: string,
  caseInstanceId: string,
) {
  const row = await database.prepare(`SELECT
      instance.id instance_id, instance.instance_key,
      instance.revision instance_revision, instance.status instance_status,
      instance.response_sha256 instance_response_sha256,
      instance.work_pack_version_id, instance.compliance_case_id,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      pack.activity_template_id,
      pack.schema_sha256 work_pack_schema_sha256,
      final_record.id final_record_id,
      final_record.instance_sha256 final_record_instance_sha256,
      final_record.response_sha256 final_record_response_sha256,
      final_record.pdf_sha256 final_record_pdf_sha256,
      final_record.finalised_at final_record_finalised_at
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
      AND pack.organisation_id = instance.organisation_id
      AND pack.activity_version_id = compliance_case.activity_version_id
      AND pack.publish_state = 'published'
    JOIN compliance_activity_work_pack_final_records final_record
      ON final_record.organisation_id = instance.organisation_id
      AND final_record.case_instance_id = instance.id
      AND final_record.work_pack_version_id = pack.id
    WHERE instance.id = ? AND instance.organisation_id = ?
      AND instance.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    LIMIT 1`)
    .bind(caseInstanceId, organisationId)
    .first<OutputActionWorkPackCoreRecord>();
  if (!row) {
    return fail(
      "OUTPUT_ACTION_COMPLETED_WORK_PACK_REQUIRED",
      409,
      "A current completed immutable work pack is required.",
    );
  }
  return row;
}

async function exactCompletedCore(
  database: D1Database,
  organisationId: string,
  caseInstanceId: string,
  calculationRunId: string,
) {
  const row = await database.prepare(`SELECT
      instance.id instance_id, instance.instance_key,
      instance.revision instance_revision, instance.status instance_status,
      instance.response_sha256 instance_response_sha256,
      instance.work_pack_version_id, instance.compliance_case_id,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      pack.activity_template_id,
      pack.schema_sha256 work_pack_schema_sha256,
      final_record.id final_record_id,
      final_record.instance_sha256 final_record_instance_sha256,
      final_record.response_sha256 final_record_response_sha256,
      final_record.pdf_sha256 final_record_pdf_sha256,
      calculation.id calculation_run_id,
      calculation.input_snapshot calculation_input_snapshot,
      calculation.output_snapshot calculation_output_snapshot,
      calculation.run_by_uid calculation_run_by_uid,
      calculation.status calculation_status,
      calculation.calculator_version_id,
      calculator.calculator_key,
      calculator.version calculator_version,
      calculator.official_source_sha256 calculator_source_sha256,
      calculation_review.decision calculation_review_decision,
      calculation_review.input_sha256 calculation_input_sha256,
      calculation_review.output_sha256 calculation_output_sha256,
      calculation_review.engine_receipt_id calculation_engine_receipt_id,
      engine_receipt.suite_receipt_hash calculation_receipt_sha256,
      calculation_review.reviewer_uid calculation_reviewer_uid,
      calculation_review.reviewed_at calculation_reviewed_at
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
      AND pack.organisation_id = instance.organisation_id
      AND pack.activity_version_id = compliance_case.activity_version_id
      AND pack.publish_state = 'published'
    JOIN compliance_activity_work_pack_final_records final_record
      ON final_record.organisation_id = instance.organisation_id
      AND final_record.case_instance_id = instance.id
      AND final_record.work_pack_version_id = pack.id
    JOIN compliance_calculation_runs calculation
      ON calculation.id = ?
      AND calculation.organisation_id = instance.organisation_id
      AND calculation.case_id = compliance_case.id
      AND calculation.case_revision = compliance_case.revision
      AND calculation.status IN ('calculated', 'verified')
    JOIN compliance_activity_work_pack_calculation_reviews calculation_review
      ON calculation_review.organisation_id = calculation.organisation_id
      AND calculation_review.calculation_run_id = calculation.id
      AND calculation_review.decision = 'approved'
      AND calculation_review.reviewer_uid <> calculation.run_by_uid
    JOIN compliance_calculator_versions calculator
      ON calculator.id = calculation.calculator_version_id
      AND calculator.organisation_id = calculation.organisation_id
      AND calculator.activity_version_id = compliance_case.activity_version_id
      AND calculator.approval_state = 'approved'
    JOIN compliance_calculator_engine_receipts engine_receipt
      ON engine_receipt.id = calculation_review.engine_receipt_id
      AND engine_receipt.organisation_id = calculation.organisation_id
      AND engine_receipt.calculator_version_id = calculator.id
      AND engine_receipt.calculator_version_number = calculator.version
      AND engine_receipt.result = 'passed'
    WHERE instance.id = ? AND instance.organisation_id = ?
      AND instance.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    LIMIT 1`)
    .bind(calculationRunId, caseInstanceId, organisationId)
    .first<OutputActionCoreRecord>();
  if (!row) {
    return fail(
      "OUTPUT_ACTION_COMPLETED_CORE_REQUIRED",
      409,
      "A current completed immutable work pack and approved exact calculation are required.",
    );
  }
  return row;
}

function certificateEvidence(
  row: CreditexWorkPackGovernanceCoverageRow,
  caseInstanceId: string,
) {
  if (row.outputClass !== "tradable_certificate") {
    return fail(
      "OUTPUT_ACTION_NOT_A_CERTIFICATE_ACTIVITY",
      409,
      "This governed activity produces a non-certificate output. Use its operational output action.",
    );
  }
  if (!row.certificateActionEnabled || row.certificateBlockers.length > 0) {
    return fail(
      "OUTPUT_ACTION_CERTIFICATE_NOT_READY",
      409,
      "The exact governed activity has not passed certificate-action readiness.",
    );
  }
  const evidence = row.activationEvidence;
  const required = [
    evidence.activityVersion,
    evidence.workPackVersion,
    evidence.manualPolicy,
    evidence.evidencePolicy,
    evidence.productRegistrySnapshot,
    evidence.scenarioRules,
    evidence.authoritativeCalculator,
    evidence.fieldCollection,
    evidence.completion,
  ];
  if (required.some((value) => !value) || !evidence.sourceBindings.length) {
    return fail(
      "OUTPUT_ACTION_ACTIVATION_EVIDENCE_REQUIRED",
      409,
      "The enabled activity row is missing its exact activation evidence.",
    );
  }
  if (row.programCode === "SRES" && !evidence.programActivationEvidence) {
    return fail(
      "OUTPUT_ACTION_PROGRAM_ACTIVATION_EVIDENCE_REQUIRED",
      409,
      "The exact independently reviewed SRES activation snapshot is required.",
    );
  }
  if (
    evidence.fieldCollection?.instanceId !== caseInstanceId
    || evidence.completion?.caseInstanceId !== caseInstanceId
  ) {
    return fail(
      "OUTPUT_ACTION_INSTANCE_EVIDENCE_MISMATCH",
      409,
      "The enabled readiness evidence does not belong to this exact completed work pack.",
    );
  }
  return evidence as typeof evidence & {
    activityVersion: NonNullable<typeof evidence.activityVersion>;
    workPackVersion: NonNullable<typeof evidence.workPackVersion>;
    manualPolicy: NonNullable<typeof evidence.manualPolicy>;
    evidencePolicy: NonNullable<typeof evidence.evidencePolicy>;
    productRegistrySnapshot: NonNullable<typeof evidence.productRegistrySnapshot>;
    scenarioRules: NonNullable<typeof evidence.scenarioRules>;
    authoritativeCalculator: NonNullable<typeof evidence.authoritativeCalculator>;
    fieldCollection: NonNullable<typeof evidence.fieldCollection>;
    completion: NonNullable<typeof evidence.completion>;
    programActivationEvidence:
      typeof evidence.programActivationEvidence;
  };
}

function canonicalCertificateQuantity(value: unknown) {
  const result = String(value || "").trim();
  if (!/^[1-9][0-9]*$/.test(result)) {
    return fail(
      "OUTPUT_ACTION_CERTIFICATE_QUANTITY_INVALID",
      409,
      "The approved exact calculator must return a positive whole certificate quantity.",
    );
  }
  return result;
}

function assertCoreMatchesEvidence(
  core: OutputActionCoreRecord,
  row: CreditexWorkPackGovernanceCoverageRow,
  evidence: ReturnType<typeof certificateEvidence>,
) {
  const calculator = evidence.authoritativeCalculator;
  const field = evidence.fieldCollection;
  const completion = evidence.completion;
  const exact =
    core.activity_template_id === row.activityTemplateId
    && core.activity_version_id === evidence.activityVersion.id
    && core.instance_id === field.instanceId
    && core.instance_key === field.instanceKey
    && Number(core.instance_revision) === Number(field.revision)
    && core.work_pack_version_id === evidence.workPackVersion.id
    && core.work_pack_schema_sha256 === evidence.workPackVersion.schemaSha256
    && core.instance_response_sha256 === completion.instanceSha256
    && core.final_record_id === completion.finalRecordId
    && core.final_record_instance_sha256 === completion.instanceSha256
    && core.final_record_response_sha256 === field.responseSha256
    && core.final_record_response_sha256 === completion.responseSha256
    && bareSha256(core.final_record_pdf_sha256, "Final work-pack PDF")
      === bareSha256(completion.pdfSha256, "Final work-pack PDF")
    && core.calculation_run_id === calculator.runId
    && core.calculator_version_id === calculator.specificationId
    && core.calculator_key === calculator.engineCalculatorKey
    && Number(core.calculator_version) === calculator.engineCalculatorVersion
    && core.calculator_source_sha256 === calculator.sourceSha256
    && core.calculation_input_sha256 === calculator.inputSha256
    && core.calculation_output_sha256 === calculator.outputSha256
    && core.calculation_receipt_sha256 === calculator.receiptSha256
    && core.calculation_reviewer_uid === calculator.verifiedByUid
    && core.calculation_reviewed_at === calculator.verifiedAt
    && core.calculation_review_decision === "approved"
    && core.calculation_reviewer_uid !== core.calculation_run_by_uid
    && creditexCanonicalSha256(JSON.parse(core.calculation_input_snapshot))
      === calculator.inputSha256
    && creditexCanonicalSha256(JSON.parse(core.calculation_output_snapshot))
      === calculator.outputSha256;
  if (!exact) {
    return fail(
      "OUTPUT_ACTION_EVIDENCE_CHANGED",
      409,
      "The completed work pack or exact calculation no longer matches the enabled readiness evidence.",
    );
  }
}

function operationalDefinition(
  row: CreditexWorkPackGovernanceCoverageRow,
  caseInstanceId: string,
): Readonly<{
  definition: NonNullable<CreditexWorkPackGovernanceCoverageRow["operationalOutputDefinition"]>;
  activation: CreditexWorkPackGovernanceCoverageRow["activationEvidence"] & Readonly<{
    activityVersion: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["activityVersion"]>;
    workPackVersion: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["workPackVersion"]>;
    productRegistrySnapshot: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["productRegistrySnapshot"]>;
    scenarioRules: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["scenarioRules"]>;
    fieldCollection: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["fieldCollection"]>;
    completion: NonNullable<CreditexWorkPackGovernanceCoverageRow["activationEvidence"]["completion"]>;
  }>;
}> {
  if (row.outputClass === "tradable_certificate") {
    return fail(
      "OUTPUT_ACTION_NOT_AN_OPERATIONAL_ACTIVITY",
      409,
      "This governed activity produces a tradable certificate. Use its certificate submission action.",
    );
  }
  if (!row.outputActionReady || row.outputActionBlockers.length > 0) {
    return fail(
      "OUTPUT_ACTION_OPERATIONAL_NOT_READY",
      409,
      "The exact governed activity has not passed its class-specific output-action readiness.",
    );
  }
  const definition = row.operationalOutputDefinition;
  const activation = row.activationEvidence;
  if (
    !definition
    || definition.outputClass !== row.outputClass
    || definition.authoredByUid === definition.reviewedByUid
    || Number.isNaN(Date.parse(definition.reviewedAt))
    || !activation.activityVersion
    || !activation.workPackVersion
    || !activation.fieldCollection
    || !activation.completion
    || !activation.productRegistrySnapshot
    || !activation.scenarioRules
    || activation.fieldCollection.instanceId !== caseInstanceId
    || activation.completion.caseInstanceId !== caseInstanceId
    || !activation.sourceBindings.length
    || !activation.sourceBindings.some((binding) =>
      binding.id === definition.sourceBindingId
        && binding.artifactId === definition.sourceArtifactId
        && binding.artifactSha256 === definition.sourceSha256
        && binding.createdByUid === definition.authoredByUid
        && binding.reviewedByUid === definition.reviewedByUid
        && binding.reviewedAt === definition.reviewedAt
    )
  ) {
    return fail(
      "OUTPUT_ACTION_OPERATIONAL_DEFINITION_REQUIRED",
      409,
      "The enabled activity row is missing its exact approved class-specific output definition.",
    );
  }
  return Object.freeze({
    definition,
    activation: Object.freeze({
      ...activation,
      activityVersion: activation.activityVersion,
      workPackVersion: activation.workPackVersion,
      productRegistrySnapshot: activation.productRegistrySnapshot,
      scenarioRules: activation.scenarioRules,
      fieldCollection: activation.fieldCollection,
      completion: activation.completion,
    }),
  });
}

function assertOperationalCoreMatchesDefinition(
  core: OutputActionWorkPackCoreRecord,
  row: CreditexWorkPackGovernanceCoverageRow,
  resolved: ReturnType<typeof operationalDefinition>,
) {
  const { activation } = resolved;
  const exact =
    core.activity_template_id === row.activityTemplateId
    && core.activity_version_id === activation.activityVersion.id
    && core.instance_id === activation.fieldCollection.instanceId
    && core.instance_key === activation.fieldCollection.instanceKey
    && Number(core.instance_revision) === Number(activation.fieldCollection.revision)
    && core.work_pack_version_id === activation.workPackVersion.id
    && core.work_pack_schema_sha256 === activation.workPackVersion.schemaSha256
    && core.instance_response_sha256 === activation.completion.instanceSha256
    && core.final_record_id === activation.completion.finalRecordId
    && core.final_record_instance_sha256 === activation.completion.instanceSha256
    && core.final_record_response_sha256 === activation.fieldCollection.responseSha256
    && core.final_record_response_sha256 === activation.completion.responseSha256
    && bareSha256(core.final_record_pdf_sha256, "Final work-pack PDF")
      === bareSha256(activation.completion.pdfSha256, "Final work-pack PDF");
  if (!exact) {
    return fail(
      "OUTPUT_ACTION_EVIDENCE_CHANGED",
      409,
      "The completed work pack no longer matches the enabled output definition.",
    );
  }
}

type OutputActionPacketRecord = {
  id: string;
  idempotency_key: string;
  action_kind: CreditexOutputActionKind;
  output_class: ComplianceOutcomeClass;
  output_code: string;
  program_code: string;
  activity_template_id: string;
  compliance_case_id: string;
  work_pack_instance_id: string;
  work_pack_final_record_id: string;
  quantity_text: string;
  unit: string;
  packet_sha256: string;
  prepared_by_uid: string;
  prepared_actor_kind: "compliance" | "admin";
  prepared_at: string;
  packet_snapshot: string;
  review_decision: string;
  review_uid: string;
  review_actor_kind: string;
  review_note: string;
  reviewed_at: string;
  status: CreditexOutputActionStatus;
  status_at: string;
  provider_reference: string;
  submitted_actor_uid: string;
  job_reference: string;
  job_label: string;
  customer_label: string;
  activity_title: string;
};

function projectPacket(
  row: OutputActionPacketRecord,
  capabilities?: CreditexOutputActionActorCapabilities,
  actorUid = "",
) {
  const actionCapabilities = Object.freeze({
    canPrepare: false,
    canReview: Boolean(
      capabilities?.canReview
      && row.status === "prepared"
      && !row.review_decision
      && row.prepared_by_uid !== actorUid
    ),
    canSubmit: Boolean(
      capabilities?.canSubmit
      && row.status === "prepared"
      && row.review_decision === "approved"
    ),
    canRecordOutcome: Boolean(
      capabilities?.canRecordOutcome
      && ["submitted", "reconciliation_required"].includes(row.status)
      && row.submitted_actor_uid !== actorUid
    ),
  });
  return Object.freeze({
    id: row.id,
    idempotencyKey: row.idempotency_key,
    actionKind: row.action_kind,
    outputClass: row.output_class,
    outputCode: row.output_code,
    programCode: row.program_code,
    activityTemplateId: row.activity_template_id,
    complianceCaseId: row.compliance_case_id,
    workPackInstanceId: row.work_pack_instance_id,
    workPackFinalRecordId: row.work_pack_final_record_id,
    quantity: row.quantity_text,
    unit: row.unit,
    packetSha256: row.packet_sha256,
    packet: JSON.parse(row.packet_snapshot) as Record<string, unknown>,
    preparedByUid: row.prepared_by_uid,
    preparedActorKind: row.prepared_actor_kind,
    preparedAt: row.prepared_at,
    review: row.review_decision
      ? Object.freeze({
          decision: row.review_decision as "approved" | "rejected",
          reviewedByUid: row.review_uid,
          reviewedActorKind: row.review_actor_kind,
          note: row.review_note,
          reviewedAt: row.reviewed_at,
        })
      : null,
    status: row.status,
    statusAt: row.status_at,
    providerReference: row.provider_reference,
    jobReference: row.job_reference,
    jobLabel: row.job_label,
    customerLabel: row.customer_label,
    activityTitle: row.activity_title,
    capabilities: actionCapabilities,
  });
}

const PACKET_PROJECTION_SQL = `SELECT packet.*,
    COALESCE(review.decision, '') review_decision,
    COALESCE(review.reviewed_by_uid, '') review_uid,
    COALESCE(review.reviewed_actor_kind, '') review_actor_kind,
    COALESCE(review.review_note, '') review_note,
    COALESCE(review.reviewed_at, '') reviewed_at,
    COALESCE((SELECT event.to_status
      FROM compliance_output_action_events event
      WHERE event.organisation_id = packet.organisation_id
        AND event.packet_id = packet.id
      ORDER BY event.sequence DESC LIMIT 1), 'prepared') status,
    COALESCE((SELECT event.occurred_at
      FROM compliance_output_action_events event
      WHERE event.organisation_id = packet.organisation_id
        AND event.packet_id = packet.id
      ORDER BY event.sequence DESC LIMIT 1), packet.prepared_at) status_at,
    COALESCE((SELECT receipt.provider_reference
      FROM compliance_output_action_adapter_receipts receipt
      WHERE receipt.organisation_id = packet.organisation_id
        AND receipt.packet_id = packet.id
        AND receipt.provider_reference <> ''
      ORDER BY receipt.response_received_at DESC, receipt.id DESC LIMIT 1), '')
      provider_reference
    , COALESCE((SELECT submitted.actor_uid
        FROM compliance_output_action_events submitted
        WHERE submitted.organisation_id = packet.organisation_id
          AND submitted.packet_id = packet.id
          AND submitted.to_status = 'submitted'
        ORDER BY submitted.sequence DESC LIMIT 1), '') submitted_actor_uid,
    COALESCE(NULLIF(trim(work_order.work_number), ''), compliance_case.case_number,
      'Governed job') job_reference,
    COALESCE(NULLIF(trim(work_order.title), ''), 'Governed compliance job') job_label,
    CASE
      WHEN job_detail.customer_source = 'trade_owned' THEN COALESCE(
        NULLIF(trim(customer.business_name), ''),
        NULLIF(trim(customer.first_name || ' ' || customer.last_name), ''),
        'Protected trade customer'
      )
      ELSE 'Protected customer'
    END customer_label,
    COALESCE(NULLIF(trim(activity.title), ''), 'Governed activity') activity_title
  FROM compliance_output_action_packets packet
  LEFT JOIN compliance_activity_work_pack_instances instance
    ON instance.organisation_id = packet.organisation_id
    AND instance.id = packet.work_pack_instance_id
  LEFT JOIN compliance_cases compliance_case
    ON compliance_case.organisation_id = packet.organisation_id
    AND compliance_case.id = packet.compliance_case_id
  LEFT JOIN compliance_activity_versions activity
    ON activity.id = packet.activity_version_id
  LEFT JOIN trade_work_orders work_order
    ON work_order.id = instance.work_order_id
    AND work_order.firebase_uid = compliance_case.installer_uid
  LEFT JOIN trade_crm_job_details job_detail
    ON job_detail.work_order_id = work_order.id
    AND job_detail.firebase_uid = work_order.firebase_uid
  LEFT JOIN trade_crm_customers customer
    ON customer.id = job_detail.crm_customer_id
    AND customer.firebase_uid = job_detail.firebase_uid
    AND customer.record_status = 'active'`;

export async function loadCreditexOutputAction(
  database: D1Database,
  organisationId: string,
  packetId: string,
) {
  const row = await database.prepare(`${PACKET_PROJECTION_SQL}
    LEFT JOIN compliance_output_action_reviews review
      ON review.organisation_id = packet.organisation_id
      AND review.packet_id = packet.id
    WHERE packet.organisation_id = ? AND packet.id = ? LIMIT 1`)
    .bind(organisationId, packetId)
    .first<OutputActionPacketRecord>();
  if (!row) {
    return fail(
      "OUTPUT_ACTION_NOT_FOUND",
      404,
      "The governed output action was not found.",
    );
  }
  return projectPacket(row);
}

export async function listCreditexOutputActions(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  const capabilities = await outputActorCapabilities(database, actor);
  const rows = await database.prepare(`${PACKET_PROJECTION_SQL}
    LEFT JOIN compliance_output_action_reviews review
      ON review.organisation_id = packet.organisation_id
      AND review.packet_id = packet.id
    WHERE packet.organisation_id = ?
    ORDER BY packet.prepared_at DESC, packet.id DESC LIMIT 1000`)
    .bind(actor.organisationId)
    .all<OutputActionPacketRecord>();
  return Object.freeze(rows.results.map((row) =>
    projectPacket(row, capabilities, actor.actorUid)
  ));
}

type OutputActionReceiptRecord = {
  id: string;
  packet_id: string;
  provider_name: string;
  request_sha256: string;
  response_snapshot: string;
  response_sha256: string;
  provider_reference: string;
  provider_status: string;
  http_status: number;
  response_received_at: string;
  created_at: string;
};

function projectReceiptSummary(row: OutputActionReceiptRecord) {
  return Object.freeze({
    id: row.id,
    packetId: row.packet_id,
    providerName: row.provider_name,
    providerReference: row.provider_reference,
    providerStatus: row.provider_status,
    httpStatus: Number(row.http_status),
    requestSha256: row.request_sha256,
    responseSha256: row.response_sha256,
    responseReceivedAt: row.response_received_at,
    retainedAt: row.created_at,
  });
}

export async function listCreditexOutputActionReceipts(
  database: D1Database,
  organisationId: string,
) {
  const rows = await database.prepare(`SELECT id, packet_id, provider_name,
      request_sha256, response_sha256, provider_reference,
      provider_status, http_status, response_received_at, created_at
    FROM compliance_output_action_adapter_receipts
    WHERE organisation_id = ?
    ORDER BY response_received_at DESC, id DESC LIMIT 2000`)
    .bind(organisationId)
    .all<OutputActionReceiptRecord>();
  return Object.freeze(rows.results.map(projectReceiptSummary));
}

export async function loadCreditexOutputActionReceipt(
  database: D1Database,
  organisationId: string,
  receiptId: string,
) {
  const id = requiredText(
    receiptId,
    240,
    "OUTPUT_ACTION_RECEIPT_REQUIRED",
    "Provider receipt",
  );
  const row = await database.prepare(`SELECT id, packet_id, provider_name,
      request_sha256, response_snapshot, response_sha256, provider_reference,
      provider_status, http_status, response_received_at, created_at
    FROM compliance_output_action_adapter_receipts
    WHERE organisation_id = ? AND id = ? LIMIT 1`)
    .bind(organisationId, id)
    .first<OutputActionReceiptRecord>();
  if (!row) {
    return fail(
      "OUTPUT_ACTION_RECEIPT_NOT_FOUND",
      404,
      "The retained provider response was not found.",
    );
  }
  const response = JSON.parse(row.response_snapshot) as Record<string, unknown>;
  if (creditexCanonicalSha256(response) !== row.response_sha256) {
    return fail(
      "OUTPUT_ACTION_RECEIPT_CHANGED",
      409,
      "The retained provider response no longer matches its immutable SHA-256 identity.",
    );
  }
  return Object.freeze({
    contract: "creditex-output-action-provider-receipt-download/v1",
    ...projectReceiptSummary(row),
    response,
  });
}

type OutputActionCandidateRecord = {
  case_instance_id: string;
  activity_template_id: string;
  compliance_case_id: string;
  case_number: string;
  work_number: string;
  job_title: string;
  customer_label: string;
  final_record_id: string;
  existing_action_id: string;
  existing_action_kind: string;
  existing_status: string;
};

/**
 * Projects only completed/current immutable work packs that the authenticated
 * Creditex/admin organisation is authorised to act on. Operators never need
 * to copy internal activity or instance identifiers into the UI.
 */
export async function listCreditexOutputActionCandidates(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  const capabilities = await outputActorCapabilities(database, actor);
  const candidateRows = await database.prepare(`SELECT
      instance.id case_instance_id,
      pack.activity_template_id,
      compliance_case.id compliance_case_id,
      compliance_case.case_number,
      COALESCE(NULLIF(trim(work_order.work_number), ''),
        compliance_case.case_number) work_number,
      COALESCE(NULLIF(trim(work_order.title), ''),
        'Governed compliance job') job_title,
      CASE
        WHEN job_detail.customer_source = 'trade_owned' THEN COALESCE(
          NULLIF(trim(customer.business_name), ''),
          NULLIF(trim(customer.first_name || ' ' || customer.last_name), ''),
          'Protected trade customer'
        )
        ELSE 'Protected customer'
      END customer_label,
      final_record.id final_record_id,
      COALESCE(packet.id, '') existing_action_id,
      COALESCE(packet.action_kind, '') existing_action_kind,
      COALESCE((SELECT event.to_status
        FROM compliance_output_action_events event
        WHERE event.organisation_id = packet.organisation_id
          AND event.packet_id = packet.id
        ORDER BY event.sequence DESC LIMIT 1), '') existing_status
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
      AND pack.organisation_id = instance.organisation_id
      AND pack.activity_version_id = compliance_case.activity_version_id
      AND pack.publish_state = 'published'
    JOIN compliance_activity_work_pack_final_records final_record
      ON final_record.organisation_id = instance.organisation_id
      AND final_record.case_instance_id = instance.id
      AND final_record.work_pack_version_id = instance.work_pack_version_id
      AND final_record.instance_sha256 = instance.response_sha256
    LEFT JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id
      AND job_detail.firebase_uid = work_order.firebase_uid
    LEFT JOIN trade_crm_customers customer
      ON customer.id = job_detail.crm_customer_id
      AND customer.firebase_uid = job_detail.firebase_uid
      AND customer.record_status = 'active'
    LEFT JOIN compliance_output_action_packets packet
      ON packet.organisation_id = instance.organisation_id
      AND packet.work_pack_final_record_id = final_record.id
    WHERE instance.organisation_id = ?
      AND instance.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    ORDER BY final_record.finalised_at DESC, instance.id DESC
    LIMIT 200`)
    .bind(actor.organisationId)
    .all<OutputActionCandidateRecord>();
  const readinessRows = await loadCreditexActivityWorkPackOutputReadinessBatch(
    database,
    actor,
    candidateRows.results.map((candidate) => Object.freeze({
      activityTemplateId: candidate.activity_template_id,
      caseInstanceId: candidate.case_instance_id,
    })),
  );
  return Object.freeze(candidateRows.results.map((candidate, index) => {
    const resolved = readinessRows[index];
    const readiness = resolved?.readiness || null;
    const program = readiness
      ? GOVERNMENT_PROGRAM_TEMPLATES.find((item) =>
          item.programCode === readiness.programCode
            && item.outcomeClass === readiness.outputClass
        )
      : undefined;
    const actionKind: CreditexOutputActionKind = readiness?.outputClass
      === "tradable_certificate"
      ? "certificate_submission"
      : "operational_output";
    const readinessBlockers = readiness
      ? readiness.outputClass === "tradable_certificate"
        ? readiness.certificateBlockers
        : readiness.outputActionBlockers
      : [resolved?.errorCode || "output_readiness_unavailable"];
    const existingActionMatches = !candidate.existing_action_id
      || candidate.existing_action_kind === actionKind;
    const blockers = Array.from(new Set([
      ...readinessBlockers,
      ...(!program ? ["governed_program_output_definition_required"] : []),
      ...(!capabilities.canPrepare ? ["actor_not_authorised_to_prepare"] : []),
      ...(!existingActionMatches
        ? ["conflicting_output_action_already_prepared"]
        : candidate.existing_action_id
          ? ["output_action_already_prepared"]
          : []),
    ])).sort();
    const serverReady = Boolean(
      readiness
      && program
      && (readiness.outputClass === "tradable_certificate"
        ? readiness.certificateActionEnabled
        : readiness.outputActionReady)
      && blockers.length === 0,
    );
    const calculator = readiness?.activationEvidence.authoritativeCalculator;
    return Object.freeze({
      activityTemplateId: candidate.activity_template_id,
      caseInstanceId: candidate.case_instance_id,
      complianceCaseId: candidate.compliance_case_id,
      finalRecordId: candidate.final_record_id,
      jobReference: candidate.work_number,
      jobLabel: candidate.job_title,
      customerLabel: candidate.customer_label,
      programCode: readiness?.programCode || "",
      activityCode: readiness?.activityCode || "",
      activityTitle: readiness?.title || "Governed activity",
      outputClass: readiness?.outputClass || "",
      outputCode: program?.claimOutputCode || "",
      actionKind,
      ready: serverReady,
      blockers: Object.freeze(blockers),
      blockerMessage: resolved?.errorMessage || "",
      expectedQuantity: readiness?.outputClass === "tradable_certificate"
        ? calculator?.certificateQuantity || ""
        : "",
      expectedUnit: readiness?.outputClass === "tradable_certificate"
        ? calculator?.certificateUnit || ""
        : "",
      existingActionId: candidate.existing_action_id,
      existingStatus: candidate.existing_status,
      capabilities,
    });
  }));
}

export async function prepareCreditexCertificateAction(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    idempotencyKey: unknown;
    activityTemplateId: unknown;
    caseInstanceId: unknown;
  }>,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canPrepare",
  );
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    240,
    "OUTPUT_ACTION_IDEMPOTENCY_KEY_REQUIRED",
    "Output-action idempotency key",
  );
  if (idempotencyKey.length < 8) {
    return fail(
      "OUTPUT_ACTION_IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Output-action idempotency key is required.",
    );
  }
  const activityTemplateId = requiredText(
    input.activityTemplateId,
    240,
    "OUTPUT_ACTION_ACTIVITY_REQUIRED",
    "Governed activity",
  );
  const caseInstanceId = requiredText(
    input.caseInstanceId,
    240,
    "OUTPUT_ACTION_INSTANCE_REQUIRED",
    "Completed work-pack instance",
  );
  const existing = await database.prepare(`${PACKET_PROJECTION_SQL}
      LEFT JOIN compliance_output_action_reviews review
        ON review.organisation_id = packet.organisation_id
        AND review.packet_id = packet.id
      WHERE packet.organisation_id = ?
        AND packet.action_kind = 'certificate_submission'
        AND packet.idempotency_key = ? LIMIT 1`)
    .bind(actor.organisationId, idempotencyKey)
    .first<OutputActionPacketRecord>();
  if (existing) {
    if (
      existing.activity_template_id !== activityTemplateId
      || existing.work_pack_instance_id !== caseInstanceId
    ) {
      return fail(
        "OUTPUT_ACTION_IDEMPOTENCY_CONFLICT",
        409,
        "This idempotency key already belongs to a different immutable output action.",
      );
    }
    return Object.freeze({ status: "duplicate" as const, action: projectPacket(existing) });
  }

  const coverage = await exactCoverageRow(
    database,
    actor,
    activityTemplateId,
    caseInstanceId,
    options,
  );
  const evidence = certificateEvidence(coverage, caseInstanceId);
  const calculator = evidence.authoritativeCalculator;
  const core = await exactCompletedCore(
    database,
    actor.organisationId,
    caseInstanceId,
    calculator.runId,
  );
  assertCoreMatchesEvidence(core, coverage, evidence);
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
    candidate.programCode === coverage.programCode
  );
  if (
    !program
    || program.outcomeClass !== "tradable_certificate"
    || program.claimOutputCode !== calculator.certificateUnit
  ) {
    return fail(
      "OUTPUT_ACTION_CERTIFICATE_UNIT_INVALID",
      409,
      "The exact calculator unit does not match the governed program certificate output.",
    );
  }
  const quantity = canonicalCertificateQuantity(calculator.certificateQuantity);
  const sourceManifest = Object.freeze({
    contract: "creditex-output-action-source-manifest/v1",
    sources: Object.freeze([...evidence.sourceBindings]
      .map((binding) => Object.freeze({
        bindingId: binding.id,
        role: binding.role,
        targetKey: binding.targetKey,
        artifactId: binding.artifactId,
        artifactSha256: bareSha256(
          binding.artifactSha256,
          "Output-action source artifact",
        ),
        createdByUid: binding.createdByUid,
        reviewedByUid: binding.reviewedByUid,
        reviewedAt: binding.reviewedAt,
      }))
      .sort((left, right) => left.bindingId.localeCompare(right.bindingId))),
  });
  const productEvidence = Object.freeze({
    contract: "creditex-output-action-product-evidence/v1",
    ...evidence.productRegistrySnapshot,
  });
  const scenarioEvidence = Object.freeze({
    contract: "creditex-output-action-scenario-evidence/v1",
    ...evidence.scenarioRules,
  });
  const programActivationEvidence = evidence.programActivationEvidence;
  const programActivationEvidenceSha256 = programActivationEvidence
    ? creditexCanonicalSha256(programActivationEvidence)
    : "";
  const packet = Object.freeze({
    contract: CREDITEX_OUTPUT_ACTION_PACKET_CONTRACT,
    actionKind: "certificate_submission" as const,
    outputClass: "tradable_certificate" as const,
    outputCode: program.claimOutputCode,
    programCode: coverage.programCode,
    activityTemplateId: coverage.activityTemplateId,
    activityVersionId: evidence.activityVersion.id,
    complianceCaseId: core.compliance_case_id,
    caseRevision: Number(core.case_revision),
    workPack: Object.freeze({
      instanceId: core.instance_id,
      instanceKey: core.instance_key,
      revision: Number(core.instance_revision),
      versionId: core.work_pack_version_id,
      definitionSha256: exactSha256(
        core.work_pack_schema_sha256,
        "Work-pack definition",
      ),
      instanceSha256: exactSha256(
        core.final_record_instance_sha256,
        "Work-pack instance",
      ),
      responseSha256: exactSha256(
        core.final_record_response_sha256,
        "Work-pack response",
      ),
      finalRecordId: core.final_record_id,
      finalPdfSha256: bareSha256(
        core.final_record_pdf_sha256,
        "Final work-pack PDF",
      ),
    }),
    calculation: Object.freeze({
      runId: calculator.runId,
      dependencyKey: calculator.dependencyKey,
      catalogueFormulaKey: calculator.catalogueFormulaKey,
      engineCalculatorKey: calculator.engineCalculatorKey,
      engineCalculatorVersion: calculator.engineCalculatorVersion,
      inputSha256: exactSha256(calculator.inputSha256, "Calculation input"),
      outputSha256: exactSha256(calculator.outputSha256, "Calculation output"),
      receiptSha256: exactSha256(
        calculator.receiptSha256,
        "Calculation receipt",
      ),
      calculatorVersionId: calculator.specificationId,
      calculatorSourceBindingId: calculator.sourceBindingId,
      calculatorSourceArtifactId: calculator.sourceArtifactId,
      calculatorSourceSha256: bareSha256(
        calculator.sourceSha256,
        "Calculator source",
      ),
      quantity,
      unit: calculator.certificateUnit,
      runByUid: calculator.runByUid,
      verifiedByUid: calculator.verifiedByUid,
      verifiedAt: calculator.verifiedAt,
    }),
    productEvidence,
    scenarioEvidence,
    sourceManifest,
    programActivationEvidence,
    programActivationEvidenceSha256,
  });
  const packetSha256 = creditexCanonicalSha256(packet);
  const productSha256 = creditexCanonicalSha256(productEvidence);
  const scenarioSha256 = creditexCanonicalSha256(scenarioEvidence);
  const sourceManifestSha256 = creditexCanonicalSha256(sourceManifest);
  const priorForFinal = await database.prepare(`${PACKET_PROJECTION_SQL}
      LEFT JOIN compliance_output_action_reviews review
        ON review.organisation_id = packet.organisation_id
        AND review.packet_id = packet.id
      WHERE packet.organisation_id = ?
        AND packet.work_pack_final_record_id = ? LIMIT 1`)
    .bind(actor.organisationId, core.final_record_id)
    .first<OutputActionPacketRecord>();
  if (priorForFinal) {
    if (
      priorForFinal.action_kind !== "certificate_submission"
      || priorForFinal.activity_template_id !== activityTemplateId
      || priorForFinal.work_pack_instance_id !== caseInstanceId
    ) {
      return fail(
        "OUTPUT_ACTION_FINAL_RECORD_CONFLICT",
        409,
        "This immutable final record already belongs to a different certificate output action.",
      );
    }
    return Object.freeze({
      status: "duplicate" as const,
      action: projectPacket(priorForFinal),
    });
  }
  const now = trustedServerActionAt(outputNow(options), [
    evidence.completion.finalisedAt,
    evidence.workPackVersion.reviewedAt,
    calculator.verifiedAt,
    ...evidence.sourceBindings.map((binding) => binding.reviewedAt),
    ...(programActivationEvidence?.records.map((record) => record.reviewedAt)
      || []),
  ], "Certificate packet preparation");
  const packetId = outputId("output-action-packet", options);
  const eventId = outputId("output-action-event", options);
  await database.batch([
    database.prepare(`INSERT INTO compliance_output_action_packets (
        id, idempotency_key, contract, organisation_id, action_kind,
        output_class, output_code, program_code, activity_template_id,
        activity_version_id, compliance_case_id, case_revision,
        work_pack_instance_id, work_pack_instance_key, work_pack_revision,
        work_pack_version_id, work_pack_definition_sha256,
        work_pack_instance_sha256, work_pack_response_sha256,
        work_pack_final_record_id,
        work_pack_final_pdf_sha256, calculation_run_id,
        calculation_input_sha256, calculation_output_sha256,
        calculation_receipt_sha256, calculator_version_id,
        catalogue_formula_key, engine_calculator_key,
        engine_calculator_version, calculator_source_binding_id,
        calculator_source_artifact_id, calculator_source_sha256,
        product_evidence_snapshot,
        product_evidence_sha256, scenario_evidence_snapshot,
        scenario_evidence_sha256, source_manifest_snapshot,
        source_manifest_sha256, quantity_text, unit, packet_snapshot,
        packet_sha256, prepared_by_uid, prepared_actor_kind, prepared_at, created_at
      ) VALUES (?, ?, ?, ?, 'certificate_submission',
        'tradable_certificate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        packetId,
        idempotencyKey,
        CREDITEX_OUTPUT_ACTION_PACKET_CONTRACT,
        actor.organisationId,
        program.claimOutputCode,
        coverage.programCode,
        coverage.activityTemplateId,
        evidence.activityVersion.id,
        core.compliance_case_id,
        Number(core.case_revision),
        core.instance_id,
        core.instance_key,
        Number(core.instance_revision),
        core.work_pack_version_id,
        packet.workPack.definitionSha256,
        packet.workPack.instanceSha256,
        packet.workPack.responseSha256,
        core.final_record_id,
        packet.workPack.finalPdfSha256,
        calculator.runId,
        packet.calculation.inputSha256,
        packet.calculation.outputSha256,
        packet.calculation.receiptSha256,
        calculator.specificationId,
        calculator.catalogueFormulaKey,
        calculator.engineCalculatorKey,
        calculator.engineCalculatorVersion,
        calculator.sourceBindingId,
        calculator.sourceArtifactId,
        packet.calculation.calculatorSourceSha256,
        JSON.stringify(productEvidence),
        productSha256,
        JSON.stringify(scenarioEvidence),
        scenarioSha256,
        JSON.stringify(sourceManifest),
        sourceManifestSha256,
        quantity,
        calculator.certificateUnit,
        JSON.stringify(packet),
        packetSha256,
        actor.actorUid,
        actor.actorKind,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, 1, '', 'prepared', ?, ?, '',
        'Immutable governed output action packet prepared.', '{}', ?, ?)`)
      .bind(
        eventId,
        actor.organisationId,
        packetId,
        actor.actorKind,
        actor.actorUid,
        now,
        now,
      ),
  ]);
  return Object.freeze({
    status: "prepared" as const,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}

export async function prepareCreditexOperationalOutputAction(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    idempotencyKey: unknown;
    activityTemplateId: unknown;
    caseInstanceId: unknown;
  }>,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canPrepare",
  );
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    240,
    "OUTPUT_ACTION_IDEMPOTENCY_KEY_REQUIRED",
    "Output-action idempotency key",
  );
  if (idempotencyKey.length < 8) {
    return fail(
      "OUTPUT_ACTION_IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Output-action idempotency key is required.",
    );
  }
  const activityTemplateId = requiredText(
    input.activityTemplateId,
    240,
    "OUTPUT_ACTION_ACTIVITY_REQUIRED",
    "Governed activity",
  );
  const caseInstanceId = requiredText(
    input.caseInstanceId,
    240,
    "OUTPUT_ACTION_INSTANCE_REQUIRED",
    "Completed work-pack instance",
  );
  const existing = await database.prepare(`${PACKET_PROJECTION_SQL}
      LEFT JOIN compliance_output_action_reviews review
        ON review.organisation_id = packet.organisation_id
        AND review.packet_id = packet.id
      WHERE packet.organisation_id = ?
        AND packet.action_kind = 'operational_output'
        AND packet.idempotency_key = ? LIMIT 1`)
    .bind(actor.organisationId, idempotencyKey)
    .first<OutputActionPacketRecord>();
  if (existing) {
    if (
      existing.activity_template_id !== activityTemplateId
      || existing.work_pack_instance_id !== caseInstanceId
    ) {
      return fail(
        "OUTPUT_ACTION_IDEMPOTENCY_CONFLICT",
        409,
        "This idempotency key already belongs to a different immutable output action.",
      );
    }
    return Object.freeze({ status: "duplicate" as const, action: projectPacket(existing) });
  }

  const coverage = await exactCoverageRow(
    database,
    actor,
    activityTemplateId,
    caseInstanceId,
    options,
  );
  const resolved = operationalDefinition(coverage, caseInstanceId);
  const core = await exactCompletedWorkPackCore(
    database,
    actor.organisationId,
    caseInstanceId,
  );
  assertOperationalCoreMatchesDefinition(core, coverage, resolved);
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
    candidate.programCode === coverage.programCode
  );
  if (
    !program
    || program.outcomeClass === "tradable_certificate"
    || program.outcomeClass !== coverage.outputClass
    || program.claimOutputCode !== resolved.definition.outputCode
  ) {
    return fail(
      "OUTPUT_ACTION_OPERATIONAL_CLASS_INVALID",
      409,
      "The retained output class or code does not match the governed program.",
    );
  }
  const sourceSha256 = bareSha256(
    resolved.definition.sourceSha256,
    "Operational output source",
  );
  const source = await database.prepare(`SELECT artifact.id
      FROM compliance_official_source_artifacts artifact
      JOIN compliance_official_source_review_decisions decision
        ON decision.id = (
          SELECT latest.id
          FROM compliance_official_source_review_decisions latest
          WHERE latest.organisation_id = artifact.organisation_id
            AND latest.subject_type = 'artifact'
            AND latest.subject_id = artifact.id
          ORDER BY latest.reviewed_at DESC, latest.id DESC LIMIT 1
        )
        AND decision.artifact_id = artifact.id
        AND decision.artifact_sha256 = artifact.sha256
        AND decision.artifact_object_key = artifact.object_key
        AND decision.decision = 'approved'
      WHERE artifact.organisation_id = ? AND artifact.id = ?
        AND artifact.sha256 = ?
      LIMIT 1`)
    .bind(
      actor.organisationId,
      resolved.definition.sourceArtifactId,
      sourceSha256,
    )
    .first<{ id: string }>();
  if (!source) {
    return fail(
      "OUTPUT_ACTION_OPERATIONAL_SOURCE_INVALID",
      409,
      "The class-specific output evidence is not bound to a current independently approved source artifact.",
    );
  }
  const sourceManifest = Object.freeze({
    contract: "creditex-output-action-source-manifest/v1",
    sources: Object.freeze(resolved.activation.sourceBindings
      .map((binding) => Object.freeze({
        bindingId: binding.id,
        role: binding.role,
        targetKey: binding.targetKey,
        artifactId: binding.artifactId,
        artifactSha256: bareSha256(
          binding.artifactSha256,
          "Output-action source artifact",
        ),
        createdByUid: binding.createdByUid,
        reviewedByUid: binding.reviewedByUid,
        reviewedAt: binding.reviewedAt,
      }))
      .sort((left, right) => left.bindingId.localeCompare(right.bindingId))),
  });
  const productEvidence = Object.freeze({
    contract: "creditex-output-action-product-evidence/v1",
    ...resolved.activation.productRegistrySnapshot,
  });
  const scenarioEvidence = Object.freeze({
    contract: "creditex-output-action-scenario-evidence/v1",
    ...resolved.activation.scenarioRules,
  });
  const packet = Object.freeze({
    contract: CREDITEX_OUTPUT_ACTION_PACKET_CONTRACT,
    actionKind: "operational_output" as const,
    outputClass: coverage.outputClass,
    outputCode: program.claimOutputCode,
    programCode: coverage.programCode,
    activityTemplateId: coverage.activityTemplateId,
    activityVersionId: resolved.activation.activityVersion.id,
    complianceCaseId: core.compliance_case_id,
    caseRevision: Number(core.case_revision),
    workPack: Object.freeze({
      instanceId: core.instance_id,
      instanceKey: core.instance_key,
      revision: Number(core.instance_revision),
      versionId: core.work_pack_version_id,
      definitionSha256: exactSha256(
        core.work_pack_schema_sha256,
        "Work-pack definition",
      ),
      instanceSha256: exactSha256(
        core.final_record_instance_sha256,
        "Work-pack instance",
      ),
      responseSha256: exactSha256(
        core.final_record_response_sha256,
        "Work-pack response",
      ),
      finalRecordId: core.final_record_id,
      finalPdfSha256: bareSha256(
        core.final_record_pdf_sha256,
        "Final work-pack PDF",
      ),
    }),
    operationalOutputDefinition: Object.freeze({
      contract: "creditex-operational-output-definition/v1",
      ...resolved.definition,
      sourceSha256,
    }),
    productEvidence,
    scenarioEvidence,
    sourceManifest,
  });
  const packetSha256 = creditexCanonicalSha256(packet);
  const now = trustedServerActionAt(outputNow(options), [
    resolved.activation.completion.finalisedAt,
    resolved.activation.workPackVersion.reviewedAt,
    resolved.definition.reviewedAt,
    ...resolved.activation.sourceBindings.map((binding) => binding.reviewedAt),
  ], "Operational packet preparation");
  const packetId = outputId("output-action-packet", options);
  const priorForFinal = await database.prepare(`${PACKET_PROJECTION_SQL}
      LEFT JOIN compliance_output_action_reviews review
        ON review.organisation_id = packet.organisation_id
        AND review.packet_id = packet.id
      WHERE packet.organisation_id = ?
        AND packet.work_pack_final_record_id = ? LIMIT 1`)
    .bind(actor.organisationId, core.final_record_id)
    .first<OutputActionPacketRecord>();
  if (priorForFinal) {
    if (
      priorForFinal.action_kind !== "operational_output"
      || priorForFinal.activity_template_id !== activityTemplateId
      || priorForFinal.work_pack_instance_id !== caseInstanceId
    ) {
      return fail(
        "OUTPUT_ACTION_FINAL_RECORD_CONFLICT",
        409,
        "This immutable final record already belongs to a different operational output action.",
      );
    }
    return Object.freeze({
      status: "duplicate" as const,
      action: projectPacket(priorForFinal),
    });
  }
  await database.batch([
    database.prepare(`INSERT INTO compliance_output_action_packets (
        id, idempotency_key, contract, organisation_id, action_kind,
        output_class, output_code, program_code, activity_template_id,
        activity_version_id, compliance_case_id, case_revision,
        work_pack_instance_id, work_pack_instance_key, work_pack_revision,
        work_pack_version_id, work_pack_definition_sha256,
        work_pack_instance_sha256, work_pack_response_sha256,
        work_pack_final_record_id,
        work_pack_final_pdf_sha256, calculation_run_id,
        calculation_input_sha256, calculation_output_sha256,
        calculation_receipt_sha256, calculator_version_id,
        catalogue_formula_key, engine_calculator_key,
        engine_calculator_version, calculator_source_binding_id,
        calculator_source_artifact_id, calculator_source_sha256,
        product_evidence_snapshot,
        product_evidence_sha256, scenario_evidence_snapshot,
        scenario_evidence_sha256, source_manifest_snapshot,
        source_manifest_sha256, quantity_text, unit, packet_snapshot,
        packet_sha256, prepared_by_uid, prepared_actor_kind, prepared_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        packetId,
        idempotencyKey,
        CREDITEX_OUTPUT_ACTION_PACKET_CONTRACT,
        actor.organisationId,
        "operational_output",
        coverage.outputClass,
        program.claimOutputCode,
        coverage.programCode,
        coverage.activityTemplateId,
        resolved.activation.activityVersion.id,
        core.compliance_case_id,
        Number(core.case_revision),
        core.instance_id,
        core.instance_key,
        Number(core.instance_revision),
        core.work_pack_version_id,
        packet.workPack.definitionSha256,
        packet.workPack.instanceSha256,
        packet.workPack.responseSha256,
        core.final_record_id,
        packet.workPack.finalPdfSha256,
        "", "", "", "", "", "", "", 0, "", "", "",
        JSON.stringify(productEvidence),
        creditexCanonicalSha256(productEvidence),
        JSON.stringify(scenarioEvidence),
        creditexCanonicalSha256(scenarioEvidence),
        JSON.stringify(sourceManifest),
        creditexCanonicalSha256(sourceManifest),
        "",
        "",
        JSON.stringify(packet),
        packetSha256,
        actor.actorUid,
        actor.actorKind,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, 1, '', 'prepared', ?, ?, '',
        'Immutable governed operational output packet prepared.', '{}', ?, ?)`)
      .bind(
        outputId("output-action-event", options),
        actor.organisationId,
        packetId,
        actor.actorKind,
        actor.actorUid,
        now,
        now,
      ),
  ]);
  return Object.freeze({
    status: "prepared" as const,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}

export async function reviewCreditexOutputAction(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    packetId: unknown;
    expectedPacketSha256: unknown;
    decision: unknown;
    comment: unknown;
  }>,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canReview",
  );
  const packetId = requiredText(
    input.packetId,
    240,
    "OUTPUT_ACTION_REQUIRED",
    "Output action",
  );
  const packet = await loadCreditexOutputAction(database, actor.organisationId, packetId);
  const expected = exactSha256(input.expectedPacketSha256, "Output-action packet");
  if (packet.packetSha256 !== expected) {
    return fail(
      "OUTPUT_ACTION_PACKET_CHANGED",
      409,
      "The immutable output-action packet identity does not match.",
    );
  }
  if (packet.review) {
    return fail(
      "OUTPUT_ACTION_ALREADY_REVIEWED",
      409,
      "This immutable output action already has an independent review.",
    );
  }
  if (packet.preparedByUid === actor.actorUid) {
    return fail(
      "OUTPUT_ACTION_SELF_REVIEW_BLOCKED",
      409,
      "The person who prepared an output action cannot independently review it.",
    );
  }
  const decision = String(input.decision || "").trim();
  if (decision !== "approved" && decision !== "rejected") {
    return fail(
      "OUTPUT_ACTION_REVIEW_DECISION_INVALID",
      400,
      "Choose approved or rejected for this exact output action.",
    );
  }
  const comment = requiredText(
    input.comment,
    2000,
    "OUTPUT_ACTION_REVIEW_NOTE_REQUIRED",
    "Independent review note",
  );
  if (comment.length < 10) {
    return fail(
      "OUTPUT_ACTION_REVIEW_NOTE_REQUIRED",
      400,
      "Independent review note must contain at least 10 characters.",
    );
  }
  const now = trustedServerActionAt(
    outputNow(options),
    [packet.preparedAt],
    "Independent packet review",
  );
  const reviewId = outputId("output-action-review", options);
  const statements = [
    database.prepare(`INSERT INTO compliance_output_action_reviews (
        id, organisation_id, packet_id, decision, packet_sha256,
        reviewed_by_uid, reviewed_actor_kind, review_note, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        reviewId,
        actor.organisationId,
        packetId,
        decision,
        packet.packetSha256,
        actor.actorUid,
        actor.actorKind,
        comment,
        now,
        now,
      ),
  ];
  if (decision === "rejected") {
    statements.push(database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, 2, 'prepared', 'rejected', ?, ?, '',
        'Independent reviewer rejected the governed output action.', '{}', ?, ?)`)
      .bind(
        outputId("output-action-event", options),
        actor.organisationId,
        packetId,
        actor.actorKind,
        actor.actorUid,
        now,
        now,
      ));
  }
  await database.batch(statements);
  return Object.freeze({
    savedReviewId: reviewId,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}

export type CreditexOutputActionAdapterResult = Readonly<{
  providerName: string;
  providerStatus:
    | "submitted"
    | "provider_accepted"
    | "rejected"
    | "reconciliation_required";
  providerReference: string;
  httpStatus: number;
  requestSnapshot: Readonly<Record<string, unknown>>;
  responseSnapshot: Readonly<Record<string, unknown>>;
  responseReceivedAt: string;
}>;

export type CreditexOutputActionAdapter = Readonly<{
  id: string;
  submit: (
    action: Awaited<ReturnType<typeof loadCreditexOutputAction>>,
  ) => Promise<CreditexOutputActionAdapterResult>;
}>;

export async function submitCreditexOutputAction(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    packetId: unknown;
    expectedPacketSha256: unknown;
  }>,
  adapter: CreditexOutputActionAdapter,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canSubmit",
  );
  const packetId = requiredText(
    input.packetId,
    240,
    "OUTPUT_ACTION_REQUIRED",
    "Output action",
  );
  const packet = await loadCreditexOutputAction(database, actor.organisationId, packetId);
  if (packet.packetSha256 !== exactSha256(
    input.expectedPacketSha256,
    "Output-action packet",
  )) {
    return fail(
      "OUTPUT_ACTION_PACKET_CHANGED",
      409,
      "The immutable output-action packet identity does not match.",
    );
  }
  if (packet.status !== "prepared" || packet.review?.decision !== "approved") {
    return fail(
      "OUTPUT_ACTION_APPROVAL_REQUIRED",
      409,
      "Independent approval of the exact prepared packet is required before submission.",
    );
  }
  const adapterId = requiredText(
    adapter.id,
    180,
    "OUTPUT_ACTION_ADAPTER_INVALID",
    "Output-action adapter",
  );
  const result = await adapter.submit(packet);
  if (
    !["submitted", "provider_accepted", "rejected", "reconciliation_required"]
      .includes(result.providerStatus)
    || !Number.isInteger(result.httpStatus)
    || result.httpStatus < 100
    || result.httpStatus > 599
    || Number.isNaN(Date.parse(result.responseReceivedAt))
    || !Object.keys(record(result.requestSnapshot)).length
    || !Object.keys(record(result.responseSnapshot)).length
    || (result.providerStatus === "provider_accepted"
      && !String(result.providerReference || "").trim())
  ) {
    return fail(
      "OUTPUT_ACTION_ADAPTER_RESPONSE_INVALID",
      502,
      "The external program adapter did not retain a valid provider response.",
    );
  }
  const now = outputNow(options);
  const providerName = requiredText(
    result.providerName,
    180,
    "OUTPUT_ACTION_ADAPTER_RESPONSE_INVALID",
    "External program provider",
  );
  const responseReceivedAt = trustedManualOccurredAt(
    result.responseReceivedAt,
    packet.review?.reviewedAt || packet.preparedAt,
    now,
    "OUTPUT_ACTION_ADAPTER_RESPONSE_INVALID",
    "Adapter provider response time",
  );
  const createdAt = retainedAt(now, responseReceivedAt);
  const requestSha256 = creditexCanonicalSha256(result.requestSnapshot);
  const responseSha256 = creditexCanonicalSha256(result.responseSnapshot);
  const submittedReceiptId = outputId("output-action-adapter-receipt", options);
  const finalReceiptId = result.providerStatus === "submitted"
    ? submittedReceiptId
    : outputId("output-action-adapter-receipt", options);
  const statements = [
    database.prepare(`INSERT INTO compliance_output_action_adapter_receipts (
        id, organisation_id, packet_id, adapter_id, provider_name,
        request_snapshot, request_sha256, response_snapshot, response_sha256,
        provider_reference, provider_status, http_status,
        response_received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`)
      .bind(
        submittedReceiptId,
        actor.organisationId,
        packetId,
        adapterId,
        providerName,
        JSON.stringify(result.requestSnapshot),
        requestSha256,
        JSON.stringify(result.responseSnapshot),
        responseSha256,
        result.providerReference || "",
        result.httpStatus,
        responseReceivedAt,
        createdAt,
      ),
    database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, 2, 'prepared', 'submitted', 'adapter', ?, ?,
        'Authorised adapter submitted the governed output action.', '{}', ?, ?)`)
      .bind(
        outputId("output-action-event", options),
        actor.organisationId,
        packetId,
        adapterId,
        submittedReceiptId,
        responseReceivedAt,
        createdAt,
      ),
  ];
  if (result.providerStatus !== "submitted") {
    statements.push(
      database.prepare(`INSERT INTO compliance_output_action_adapter_receipts (
          id, organisation_id, packet_id, adapter_id, provider_name,
          request_snapshot, request_sha256, response_snapshot, response_sha256,
          provider_reference, provider_status, http_status,
          response_received_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          finalReceiptId,
          actor.organisationId,
          packetId,
          adapterId,
          providerName,
          JSON.stringify(result.requestSnapshot),
          requestSha256,
          JSON.stringify(result.responseSnapshot),
          responseSha256,
          result.providerReference || "",
          result.providerStatus,
          result.httpStatus,
          responseReceivedAt,
          createdAt,
        ),
      database.prepare(`INSERT INTO compliance_output_action_events (
          id, organisation_id, packet_id, sequence, from_status, to_status,
          actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
          occurred_at, created_at
        ) VALUES (?, ?, ?, 3, 'submitted', ?, 'adapter', ?, ?,
          'External program provider response retained for this output action.',
          ?, ?, ?)`)
        .bind(
          outputId("output-action-event", options),
          actor.organisationId,
          packetId,
          result.providerStatus,
          adapterId,
          finalReceiptId,
          JSON.stringify({
            providerName,
            providerReference: result.providerReference,
            httpStatus: result.httpStatus,
            responseSha256,
          }),
          responseReceivedAt,
          createdAt,
        ),
    );
  }
  await database.batch(statements);
  return Object.freeze({
    adapterReceiptId: finalReceiptId,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}

function manualProviderSnapshot(input: Readonly<{
  contract: string;
  packetSha256: string;
  providerName: string;
  providerReference: string;
  occurredAt: string;
  recordedByUid: string;
  method?: string;
  outcome?: string;
  responseCode?: string;
  responseText?: string;
}>) {
  return Object.freeze({ ...input });
}

export async function recordManualCreditexOutputSubmission(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    packetId: unknown;
    expectedPacketSha256: unknown;
    providerName: unknown;
    providerReference: unknown;
    submittedAt: unknown;
    submissionMethod: unknown;
  }>,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canSubmit",
  );
  const packetId = requiredText(
    input.packetId,
    240,
    "OUTPUT_ACTION_REQUIRED",
    "Output action",
  );
  const packet = await loadCreditexOutputAction(database, actor.organisationId, packetId);
  if (packet.packetSha256 !== exactSha256(
    input.expectedPacketSha256,
    "Output-action packet",
  )) {
    return fail(
      "OUTPUT_ACTION_PACKET_CHANGED",
      409,
      "The immutable output-action packet identity does not match.",
    );
  }
  if (packet.status !== "prepared" || packet.review?.decision !== "approved") {
    return fail(
      "OUTPUT_ACTION_APPROVAL_REQUIRED",
      409,
      "Independent approval of the exact prepared packet is required before recording submission.",
    );
  }
  const providerName = requiredText(
    input.providerName,
    180,
    "OUTPUT_ACTION_PROVIDER_REQUIRED",
    "External program provider",
  );
  const providerReference = requiredText(
    input.providerReference,
    240,
    "OUTPUT_ACTION_PROVIDER_REFERENCE_REQUIRED",
    "External submission reference",
  );
  const submissionMethod = requiredText(
    input.submissionMethod,
    120,
    "OUTPUT_ACTION_SUBMISSION_METHOD_REQUIRED",
    "Submission method",
  );
  const now = outputNow(options);
  const submittedAt = trustedManualOccurredAt(
    input.submittedAt,
    packet.review?.reviewedAt || packet.preparedAt,
    now,
    "OUTPUT_ACTION_SUBMITTED_AT_INVALID",
    "External submission time",
  );
  const createdAt = retainedAt(now, submittedAt);
  const requestSnapshot = packet.packet;
  const responseSnapshot = manualProviderSnapshot({
    contract: "creditex-output-action-manual-submission/v1",
    packetSha256: packet.packetSha256,
    providerName,
    providerReference,
    occurredAt: submittedAt,
    recordedByUid: actor.actorUid,
    method: submissionMethod,
  });
  const receiptId = outputId("output-action-manual-receipt", options);
  await database.batch([
    database.prepare(`INSERT INTO compliance_output_action_adapter_receipts (
        id, organisation_id, packet_id, adapter_id, provider_name,
        request_snapshot, request_sha256, response_snapshot, response_sha256,
        provider_reference, provider_status, http_status,
        response_received_at, created_at
      ) VALUES (?, ?, ?, 'manual-provider-record/v1', ?, ?, ?, ?, ?, ?,
        'submitted', 200, ?, ?)`)
      .bind(
        receiptId,
        actor.organisationId,
        packetId,
        providerName,
        JSON.stringify(requestSnapshot),
        creditexCanonicalSha256(requestSnapshot),
        JSON.stringify(responseSnapshot),
        creditexCanonicalSha256(responseSnapshot),
        providerReference,
        submittedAt,
        createdAt,
      ),
    database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, 2, 'prepared', 'submitted', ?, ?, ?,
        'Creditex recorded the actual external provider submission.', ?, ?, ?)`)
      .bind(
        outputId("output-action-event", options),
        actor.organisationId,
        packetId,
        actor.actorKind,
        actor.actorUid,
        receiptId,
        JSON.stringify({ providerName, providerReference, submissionMethod }),
        submittedAt,
        createdAt,
      ),
  ]);
  return Object.freeze({
    manualSubmissionReceiptId: receiptId,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}

export async function recordManualCreditexOutputProviderOutcome(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    packetId: unknown;
    expectedPacketSha256: unknown;
    providerStatus: unknown;
    providerName: unknown;
    providerReference: unknown;
    responseCode: unknown;
    responseText: unknown;
    occurredAt: unknown;
  }>,
  options?: OutputActionOptions,
) {
  requireOutputCapability(
    await outputActorCapabilities(database, actor),
    "canRecordOutcome",
  );
  const packetId = requiredText(
    input.packetId,
    240,
    "OUTPUT_ACTION_REQUIRED",
    "Output action",
  );
  const packet = await loadCreditexOutputAction(database, actor.organisationId, packetId);
  if (packet.packetSha256 !== exactSha256(
    input.expectedPacketSha256,
    "Output-action packet",
  )) {
    return fail(
      "OUTPUT_ACTION_PACKET_CHANGED",
      409,
      "The immutable output-action packet identity does not match.",
    );
  }
  if (packet.status !== "submitted"
    && packet.status !== "reconciliation_required") {
    return fail(
      "OUTPUT_ACTION_SUBMISSION_REQUIRED",
      409,
      "Record the actual external submission before its provider outcome.",
    );
  }
  const providerStatus = String(input.providerStatus || "").trim();
  if (![
    "provider_accepted",
    "rejected",
    "reconciliation_required",
  ].includes(providerStatus)) {
    return fail(
      "OUTPUT_ACTION_PROVIDER_STATUS_INVALID",
      400,
      "Choose provider accepted, rejected or reconciliation required.",
    );
  }
  const providerName = requiredText(
    input.providerName,
    180,
    "OUTPUT_ACTION_PROVIDER_REQUIRED",
    "External program provider",
  );
  const providerReference = requiredText(
    input.providerReference,
    240,
    "OUTPUT_ACTION_PROVIDER_REFERENCE_REQUIRED",
    "External submission reference",
  );
  if (packet.providerReference && providerReference !== packet.providerReference) {
    return fail(
      "OUTPUT_ACTION_PROVIDER_REFERENCE_CHANGED",
      409,
      "The provider outcome reference must match the recorded submission reference.",
    );
  }
  const responseText = requiredText(
    input.responseText,
    10000,
    "OUTPUT_ACTION_PROVIDER_RESPONSE_REQUIRED",
    "Retained provider response",
  );
  const responseCode = String(input.responseCode || "").trim().slice(0, 180);
  const priorSubmission = await database.prepare(`SELECT submitted.actor_uid,
      submitted.occurred_at, receipt.provider_name, receipt.provider_reference
    FROM compliance_output_action_events submitted
    JOIN compliance_output_action_adapter_receipts receipt
      ON receipt.organisation_id = submitted.organisation_id
      AND receipt.packet_id = submitted.packet_id
      AND receipt.id = submitted.adapter_receipt_id
      AND receipt.provider_status = 'submitted'
    WHERE submitted.organisation_id = ? AND submitted.packet_id = ?
      AND submitted.to_status = 'submitted'
    ORDER BY submitted.sequence DESC LIMIT 1`)
    .bind(actor.organisationId, packetId)
    .first<{
      actor_uid: string;
      occurred_at: string;
      provider_name: string;
      provider_reference: string;
    }>();
  if (!priorSubmission) {
    return fail(
      "OUTPUT_ACTION_SUBMISSION_REQUIRED",
      409,
      "Record the actual external submission before its provider outcome.",
    );
  }
  if (priorSubmission?.actor_uid === actor.actorUid) {
    return fail(
      "OUTPUT_ACTION_PROVIDER_OUTCOME_REVIEW_SEPARATION_REQUIRED",
      409,
      "A different authorised Creditex user must record the provider outcome.",
    );
  }
  if (
    priorSubmission.provider_name !== providerName
    || priorSubmission.provider_reference !== providerReference
  ) {
    return fail(
      "OUTPUT_ACTION_PROVIDER_IDENTITY_CHANGED",
      409,
      "The provider outcome must match the retained submission provider and reference.",
    );
  }
  const now = outputNow(options);
  const occurredAt = trustedManualOccurredAt(
    input.occurredAt,
    priorSubmission.occurred_at,
    now,
    "OUTPUT_ACTION_PROVIDER_OCCURRED_AT_INVALID",
    "Provider response time",
  );
  const createdAt = retainedAt(now, occurredAt);
  const responseSnapshot = manualProviderSnapshot({
    contract: "creditex-output-action-manual-provider-response/v1",
    packetSha256: packet.packetSha256,
    providerName,
    providerReference,
    occurredAt,
    recordedByUid: actor.actorUid,
    outcome: providerStatus,
    responseCode,
    responseText,
  });
  const receiptId = outputId("output-action-manual-receipt", options);
  const sequence = packet.status === "submitted" ? 3 : await database
    .prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 next_sequence
      FROM compliance_output_action_events
      WHERE organisation_id = ? AND packet_id = ?`)
    .bind(actor.organisationId, packetId)
    .first<{ next_sequence: number }>()
    .then((row) => Number(row?.next_sequence || 0));
  await database.batch([
    database.prepare(`INSERT INTO compliance_output_action_adapter_receipts (
        id, organisation_id, packet_id, adapter_id, provider_name,
        request_snapshot, request_sha256, response_snapshot, response_sha256,
        provider_reference, provider_status, http_status,
        response_received_at, created_at
      ) VALUES (?, ?, ?, 'manual-provider-record/v1', ?, ?, ?, ?, ?, ?, ?,
        200, ?, ?)`)
      .bind(
        receiptId,
        actor.organisationId,
        packetId,
        providerName,
        JSON.stringify(packet.packet),
        creditexCanonicalSha256(packet.packet),
        JSON.stringify(responseSnapshot),
        creditexCanonicalSha256(responseSnapshot),
        providerReference,
        providerStatus,
        occurredAt,
        createdAt,
      ),
    database.prepare(`INSERT INTO compliance_output_action_events (
        id, organisation_id, packet_id, sequence, from_status, to_status,
        actor_kind, actor_uid, adapter_receipt_id, summary, metadata,
        occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
        'Creditex retained the actual external provider response.', ?, ?, ?)`)
      .bind(
        outputId("output-action-event", options),
        actor.organisationId,
        packetId,
        sequence,
        packet.status,
        providerStatus,
        actor.actorKind,
        actor.actorUid,
        receiptId,
        JSON.stringify({
          providerName,
          providerReference,
          responseCode,
          responseSha256: creditexCanonicalSha256(responseSnapshot),
        }),
        occurredAt,
        createdAt,
      ),
  ]);
  return Object.freeze({
    manualProviderReceiptId: receiptId,
    action: await loadCreditexOutputAction(database, actor.organisationId, packetId),
  });
}
