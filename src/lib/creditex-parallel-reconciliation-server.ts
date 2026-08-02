import type { ComplianceIdentity } from "./compliance-access-server";
import {
  CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
  CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
  creditexCalculatorEngineContractHash,
  runCreditexCalculatorTestSuite,
} from "./creditex-calculator-engine.ts";
import {
  requireCurrentApprovedOfficialSourceBinding,
} from "./creditex-source-lookup-review-server.ts";

export const CREDITEX_PARALLEL_RECONCILIATION_LIMITS = Object.freeze({
  maximumRequestBytes: 1024 * 1024,
  maximumRows: 250,
  maximumReturnedRuns: 50,
  maximumRowsPerStatement: 80,
});

export const CREDITEX_DATAFORCE_PARALLEL_TRANSFORMATION_CONTRACT =
  "dataforce-jobs-v1:certificate-quantity-v1" as const;

type ParallelMember = Pick<
  ComplianceIdentity,
  "uid" | "organisationId" | "role" | "governanceIdentityVerified"
>;

export type CreateCreditexParallelReconciliationInput = {
  clientRequestId: unknown;
  activityVersionId: unknown;
  calculatorVersionId: unknown;
  mappingArtifactId: unknown;
  rows: unknown;
};

export type CreateCreditexCalculatorEngineReceiptInput = {
  calculatorVersionId: unknown;
};

type GovernedContextRecord = {
  activity_version_id: string;
  activity_version_number: number;
  activity_publication_snapshot_sha256: string;
  activity_official_source_sha256: string;
  calculator_version_id: string;
  calculator_version_number: number;
  calculator_official_source_sha256: string;
  calculator_specification: string;
  mapping_artifact_id: string;
  mapping_legacy_system_key: string;
  mapping_version: string;
  mapping_artifact_sha256: string;
};

type GoldenVectorRecord = {
  id: string;
  vector_key: string;
  input_snapshot: string;
  expected_output: string;
  tolerance_snapshot: string;
  source_citation: string;
};

type CalculationContextRecord = {
  calculation_run_id: string;
  calculation_input_snapshot: string;
  calculation_output_snapshot: string;
  case_id: string;
  case_number: string;
  case_revision: number;
  case_program_id: string;
  case_work_order_id: string;
  case_work_number: string;
  case_work_source_type: string;
  case_work_source_reference: string;
  case_appointment_ids: string;
  case_installer_uid: string;
  case_activity_version_id: string;
  case_activity_date: string;
  case_site_jurisdiction: string;
  case_activity_snapshot: string;
  case_status: string;
  case_evidence_status: string;
  case_commercial_handoff_id: string;
  case_accepted_quote_version_id: string;
  case_accepted_scope_sha256: string;
  case_updated_at: string;
};

type ParallelRunRecord = {
  id: string;
  client_request_id: string;
  request_sha256: string;
  activity_version_id: string;
  calculator_version_id: string;
  golden_vector_status: string;
  golden_vector_count: number;
  golden_vector_suite_sha256: string;
  calculator_engine_receipt_id: string;
  calculator_engine_contract_hash: string;
  calculator_suite_receipt_hash: string;
  mapping_artifact_id: string;
  mapping_version: string;
  mapping_artifact_sha256: string;
  comparison_scope: string;
  reference_origin: string;
  reference_scope: string;
  status: string;
  row_count: number;
  matched_count: number;
  mismatched_count: number;
  run_at: string;
};

type RequestedRow = {
  calculationRunId: string;
  legacyImportRowId: string;
};

type DataforceReferenceRecord = {
  legacy_import_row_id: string;
  legacy_batch_id: string;
  legacy_batch_content_sha256: string;
  legacy_row_number: number;
  legacy_row_sha256: string;
  dataforce_app_id: string;
  dataforce_job_id: string;
  legacy_data_json: string;
};

type CalculatorEngineReceiptRecord = {
  id: string;
  engine_contract_hash: string;
  engine_suite_hash: string;
  suite_receipt_hash: string;
};

type CalculatorReceiptContextRecord = {
  id: string;
  version: number;
  specification: string;
  official_source_sha256: string;
};

type PreparedRequestedRow = RequestedRow & {
  referenceJson: string;
  referenceSha256: string;
  legacyBatchId: string;
  legacyBatchContentSha256: string;
  legacyRowNumber: number;
  legacyRowSha256: string;
  dataforceAppId: string;
  dataforceJobId: string;
};

type PreparedParallelRow = {
  id: string;
  organisationId: string;
  runId: string;
  rowNumber: number;
  caseId: string;
  caseRevision: number;
  caseSnapshotSha256: string;
  calculationRunId: string;
  inputSha256: string;
  outputSha256: string;
  referenceSha256: string;
  referenceJson: string;
  legacyImportRowId: string;
  legacyBatchId: string;
  legacyBatchContentSha256: string;
  legacyRowNumber: number;
  legacyRowSha256: string;
  dataforceAppId: string;
  dataforceJobId: string;
  tlinkCaseId: string;
  tlinkWorkOrderId: string;
  tlinkWorkNumber: string;
  identityMatchBasis: "job_id" | "app_id_and_job_id";
  result: "matched" | "mismatched";
  createdAt: string;
};

export class CreditexParallelReconciliationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexParallelReconciliationError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexParallelReconciliationError(code, status, message);
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
) {
  const cleaned = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : "";
  if (!cleaned || cleaned.length > maximum) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanClientRequestId(value: unknown) {
  const cleaned = cleanText(
    value,
    120,
    "PARALLEL_REQUEST_ID_INVALID",
    "Add a stable parallel reconciliation request reference.",
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(cleaned)) {
    fail(
      "PARALLEL_REQUEST_ID_INVALID",
      400,
      "Add a stable parallel reconciliation request reference.",
    );
  }
  return cleaned;
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 16) {
    fail(
      "PARALLEL_SNAPSHOT_INVALID",
      400,
      "A comparison snapshot is too deeply nested.",
    );
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        "PARALLEL_SNAPSHOT_INVALID",
        400,
        "Comparison snapshots must contain valid JSON values.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`
      ))
      .join(",")}}`;
  }
  return fail(
    "PARALLEL_SNAPSHOT_INVALID",
    400,
    "Comparison snapshots must contain valid JSON values.",
  );
}

function parseStoredJson(value: string, label: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(
      "PARALLEL_STORED_SNAPSHOT_INVALID",
      409,
      `The stored ${label} snapshot is invalid.`,
    );
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const exact = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exact).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requireParallelWriter(member: ParallelMember) {
  if (!["admin", "case_manager", "reviewer"].includes(member.role)) {
    fail(
      "PARALLEL_ROLE_REQUIRED",
      403,
      "Creditex administrator, case manager or reviewer access is required to record a parallel comparison.",
    );
  }
  if (!member.governanceIdentityVerified) {
    fail(
      "PARALLEL_GOVERNANCE_IDENTITY_REQUIRED",
      403,
      "A governance-verified Creditex identity is required for parallel reconciliation.",
    );
  }
}

function requireEngineReceiptWriter(member: ParallelMember) {
  if (!["admin", "reviewer"].includes(member.role)) {
    fail(
      "PARALLEL_ENGINE_RECEIPT_ROLE_REQUIRED",
      403,
      "Creditex administrator or reviewer access is required to execute a governed calculator suite.",
    );
  }
  if (!member.governanceIdentityVerified) {
    fail(
      "PARALLEL_GOVERNANCE_IDENTITY_REQUIRED",
      403,
      "A governance-verified Creditex identity is required for parallel reconciliation.",
    );
  }
}

function requireParallelReader(member: ParallelMember) {
  if (
    !["admin", "case_manager", "reviewer", "auditor"].includes(member.role)
  ) {
    fail(
      "PARALLEL_ROLE_REQUIRED",
      403,
      "Creditex compliance access is required to review parallel comparisons.",
    );
  }
}

function prepareRequestedRows(rows: unknown) {
  if (
    !Array.isArray(rows)
    || rows.length < 1
    || rows.length > CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRows
  ) {
    fail(
      Array.isArray(rows)
        ? "PARALLEL_ROW_LIMIT_EXCEEDED"
        : "PARALLEL_ROWS_INVALID",
      Array.isArray(rows) ? 413 : 400,
      "Compare between 1 and 250 verified calculation runs at a time.",
    );
  }
  const seenCalculations = new Set<string>();
  const seenReferences = new Set<string>();
  const prepared: RequestedRow[] = [];
  for (const [index, value] of rows.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(
        "PARALLEL_ROW_INVALID",
        400,
        `Comparison row ${index + 1} is invalid.`,
      );
    }
    const row = value as Record<string, unknown>;
    const calculationRunId = cleanText(
      row.calculationRunId,
      180,
      "PARALLEL_CALCULATION_RUN_INVALID",
      `Comparison row ${index + 1} needs a verified calculation run.`,
    );
    if (seenCalculations.has(calculationRunId)) {
      fail(
        "PARALLEL_CALCULATION_RUN_DUPLICATE",
        400,
        `Comparison row ${index + 1} repeats a calculation run.`,
      );
    }
    seenCalculations.add(calculationRunId);
    if (row.referenceSnapshot !== undefined) {
      fail(
        "PARALLEL_CALLER_REFERENCE_FORBIDDEN",
        400,
        `Comparison row ${index + 1} cannot supply its own reference snapshot.`,
      );
    }
    const legacyImportRowId = cleanText(
      row.legacyImportRowId,
      220,
      "PARALLEL_DATAFORCE_ROW_INVALID",
      `Comparison row ${index + 1} needs a staged Dataforce row.`,
    );
    if (seenReferences.has(legacyImportRowId)) {
      fail(
        "PARALLEL_DATAFORCE_ROW_DUPLICATE",
        400,
        `Comparison row ${index + 1} repeats a staged Dataforce row.`,
      );
    }
    seenReferences.add(legacyImportRowId);
    prepared.push({
      calculationRunId,
      legacyImportRowId,
    });
  }
  return prepared;
}

function dataforceCertificateQuantity(
  value: unknown,
  legacyImportRowId: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(
      "PARALLEL_DATAFORCE_ROW_INVALID",
      409,
      `Staged Dataforce row ${legacyImportRowId} is not a valid job record.`,
    );
  }
  const raw = (value as Record<string, unknown>)["Certificates (VEECs)"];
  const text = typeof raw === "number" ? String(raw) : String(raw || "").trim();
  if (!/^(0|[1-9]\d*)$/.test(text)) {
    fail(
      "PARALLEL_DATAFORCE_CERTIFICATE_QUANTITY_INVALID",
      409,
      `Staged Dataforce row ${legacyImportRowId} needs an exact non-negative VEEC quantity.`,
    );
  }
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity)) {
    fail(
      "PARALLEL_DATAFORCE_CERTIFICATE_QUANTITY_INVALID",
      409,
      `Staged Dataforce row ${legacyImportRowId} has an unsupported VEEC quantity.`,
    );
  }
  return quantity;
}

function normalizedIdentity(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function exactIdentity(value: unknown) {
  return String(value || "").trim();
}

async function dataforceReferences(
  database: D1Database,
  organisationId: string,
  requestedRows: readonly RequestedRow[],
) {
  const ids = requestedRows.map((row) => row.legacyImportRowId);
  const result = await database.prepare(`SELECT
      import_row.id legacy_import_row_id,
      import_row.batch_id legacy_batch_id,
      import_batch.content_sha256 legacy_batch_content_sha256,
      import_row.row_number legacy_row_number,
      import_row.row_sha256 legacy_row_sha256,
      import_row.app_id dataforce_app_id,
      import_row.job_id dataforce_job_id,
      import_row.data_json legacy_data_json
    FROM compliance_legacy_import_rows import_row
    JOIN compliance_legacy_import_batches import_batch
      ON import_batch.id = import_row.batch_id
      AND import_batch.organisation_id = import_row.organisation_id
      AND import_batch.source_system = 'dataforce'
      AND import_batch.contract_version = 'dataforce-jobs-v1'
      AND import_batch.status = 'staged_unmapped'
      AND import_batch.regulated_job_creation_enabled = 0
    WHERE import_row.id IN (SELECT value FROM json_each(?))
      AND import_row.organisation_id = ?
      AND import_row.mapping_status = 'staged_unmapped'`)
    .bind(JSON.stringify(ids), organisationId)
    .all<DataforceReferenceRecord>();
  if (result.results.length !== requestedRows.length) {
    fail(
      "PARALLEL_DATAFORCE_REFERENCE_UNAVAILABLE",
      409,
      "Every comparison row must bind to an immutable staged Dataforce row in this Creditex organisation.",
    );
  }
  const records = new Map(result.results.map((record) => (
    [record.legacy_import_row_id, record]
  )));
  const prepared: PreparedRequestedRow[] = [];
  for (const requested of requestedRows) {
    const record = records.get(requested.legacyImportRowId);
    if (!record) {
      fail(
        "PARALLEL_DATAFORCE_REFERENCE_UNAVAILABLE",
        409,
        "A staged Dataforce row became unavailable during reconciliation.",
      );
    }
    const exactRowSha256 = await sha256Hex(record.legacy_data_json);
    if (exactRowSha256 !== record.legacy_row_sha256) {
      fail(
        "PARALLEL_DATAFORCE_ROW_HASH_MISMATCH",
        409,
        `Staged Dataforce row ${requested.legacyImportRowId} failed its custody hash check.`,
      );
    }
    const rowSnapshot = parseStoredJson(
      record.legacy_data_json,
      "Dataforce import row",
    );
    const certificateQuantity = dataforceCertificateQuantity(
      rowSnapshot,
      requested.legacyImportRowId,
    );
    const rowIdentity = rowSnapshot as Record<string, unknown>;
    if (
      exactIdentity(rowIdentity["App Id"])
        !== exactIdentity(record.dataforce_app_id)
      || normalizedIdentity(rowIdentity["Job Id"])
        !== normalizedIdentity(record.dataforce_job_id)
    ) {
      fail(
        "PARALLEL_DATAFORCE_ROW_IDENTITY_INVALID",
        409,
        `Staged Dataforce row ${requested.legacyImportRowId} does not retain its exact imported App Id and Job Id identity.`,
      );
    }
    const referenceJson = canonicalJson({
      certificateQuantity,
    });
    prepared.push({
      ...requested,
      referenceJson,
      referenceSha256: await sha256Hex(referenceJson),
      legacyBatchId: record.legacy_batch_id,
      legacyBatchContentSha256: record.legacy_batch_content_sha256,
      legacyRowNumber: Number(record.legacy_row_number),
      legacyRowSha256: record.legacy_row_sha256,
      dataforceAppId: String(record.dataforce_app_id || "").trim(),
      dataforceJobId: String(record.dataforce_job_id || "").trim(),
    });
  }
  return prepared;
}

async function governedContext(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  calculatorVersionId: string,
  mappingArtifactId: string,
) {
  return database.prepare(`SELECT
      activity.id activity_version_id,
      activity.version activity_version_number,
      activity.publication_snapshot_sha256
        activity_publication_snapshot_sha256,
      activity.official_source_sha256 activity_official_source_sha256,
      calculator.id calculator_version_id,
      calculator.version calculator_version_number,
      calculator.official_source_sha256
        calculator_official_source_sha256,
      calculator.specification calculator_specification,
      mapping.id mapping_artifact_id,
      mapping.legacy_system_key mapping_legacy_system_key,
      mapping.mapping_version,
      mapping.artifact_sha256 mapping_artifact_sha256
    FROM compliance_activity_versions activity
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = ?
    JOIN compliance_calculator_versions calculator
      ON calculator.id = ?
      AND calculator.organisation_id = program.organisation_id
      AND calculator.activity_version_id = activity.id
      AND calculator.approval_state = 'approved'
    JOIN compliance_legacy_mapping_artifacts mapping
      ON mapping.id = ?
      AND mapping.organisation_id = program.organisation_id
      AND mapping.authorization_state = 'approved'
      AND mapping.legacy_system_key = ?
    WHERE activity.id = ?
      AND activity.publish_state = 'published'
      AND length(activity.publication_snapshot_sha256) = 64
      AND length(activity.official_source_sha256) = 64
      AND length(calculator.official_source_sha256) = 64
    LIMIT 1`)
    .bind(
      organisationId,
      calculatorVersionId,
      mappingArtifactId,
      CREDITEX_DATAFORCE_PARALLEL_TRANSFORMATION_CONTRACT,
      activityVersionId,
    )
    .first<GovernedContextRecord>();
}

async function persistedGoldenVectors(
  database: D1Database,
  calculatorVersionId: string,
) {
  const result = await database.prepare(`SELECT
      id,
      vector_key,
      input_snapshot,
      expected_output,
      tolerance_snapshot,
      source_citation
    FROM compliance_calculator_test_vectors
    WHERE calculator_version_id = ?
    ORDER BY vector_key, id`)
    .bind(calculatorVersionId)
    .all<GoldenVectorRecord>();
  if (result.results.length < 1) {
    fail(
      "PARALLEL_GOLDEN_VECTORS_REQUIRED",
      409,
      "The approved calculator requires at least one persisted golden vector.",
    );
  }
  const snapshot = result.results.map((vector) => ({
    id: vector.id,
    vectorKey: vector.vector_key,
    inputSnapshot: parseStoredJson(
      vector.input_snapshot,
      "golden-vector input",
    ),
    expectedOutput: parseStoredJson(
      vector.expected_output,
      "golden-vector output",
    ),
    toleranceSnapshot: parseStoredJson(
      vector.tolerance_snapshot,
      "golden-vector tolerance",
    ),
    sourceCitation: vector.source_citation,
  }));
  return {
    count: snapshot.length,
    suiteSha256: await sha256Hex(canonicalJson(snapshot)),
    vectors: result.results.map((vector) => ({
      key: vector.vector_key,
      inputs: parseStoredJson(
        vector.input_snapshot,
        "golden-vector input",
      ),
      expected: parseStoredJson(
        vector.expected_output,
        "golden-vector output",
      ),
    })),
  };
}

async function currentCalculatorEngineReceipt(
  database: D1Database,
  organisationId: string,
  governed: GovernedContextRecord,
  golden: { count: number; suiteSha256: string },
  engineContractHash: string,
) {
  const receipt = await database.prepare(`SELECT
      id,
      engine_contract_hash,
      engine_suite_hash,
      suite_receipt_hash
    FROM compliance_calculator_engine_receipts
    WHERE organisation_id = ?
      AND calculator_version_id = ?
      AND calculator_version_number = ?
      AND engine_contract_id = ?
      AND engine_contract_hash = ?
      AND golden_vector_suite_sha256 = ?
      AND suite_receipt_schema = ?
      AND vector_count = ?
      AND result = 'passed'
    ORDER BY executed_at DESC, id DESC
    LIMIT 1`)
    .bind(
      organisationId,
      governed.calculator_version_id,
      Number(governed.calculator_version_number),
      CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
      engineContractHash,
      golden.suiteSha256,
      CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
      golden.count,
    )
    .first<CalculatorEngineReceiptRecord>();
  if (!receipt) {
    fail(
      "PARALLEL_CALCULATOR_ENGINE_RECEIPT_REQUIRED",
      409,
      "The exact golden-vector suite requires a persisted passing deterministic-engine receipt.",
    );
  }
  return receipt;
}

function calculatorEngineContractHash(specification: unknown) {
  try {
    return creditexCalculatorEngineContractHash(specification);
  } catch {
    fail(
      "PARALLEL_CALCULATOR_SPECIFICATION_INVALID",
      409,
      "The approved calculator specification cannot be executed by the deterministic v2 engine.",
    );
  }
}

function publicEngineReceipt(
  receipt: CalculatorEngineReceiptRecord & {
    calculatorVersionId: string;
    goldenVectorSuiteSha256: string;
    vectorCount: number;
    executedAt: string;
  },
  reused: boolean,
) {
  return {
    id: receipt.id,
    calculatorVersionId: receipt.calculatorVersionId,
    engineContractId: CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
    engineContractHash: receipt.engine_contract_hash,
    goldenVectorSuiteSha256: receipt.goldenVectorSuiteSha256,
    suiteReceiptSchema: CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
    engineSuiteHash: receipt.engine_suite_hash,
    suiteReceiptHash: receipt.suite_receipt_hash,
    vectorCount: receipt.vectorCount,
    result: "passed" as const,
    executedAt: receipt.executedAt,
    reused,
  };
}

export async function createCreditexCalculatorEngineReceipt(
  database: D1Database,
  member: ParallelMember,
  input: CreateCreditexCalculatorEngineReceiptInput,
  options: { now?: string } = {},
) {
  requireEngineReceiptWriter(member);
  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
    || Object.keys(input).some((key) => key !== "calculatorVersionId")
  ) {
    fail(
      "PARALLEL_ENGINE_RECEIPT_INPUT_INVALID",
      400,
      "Choose one approved calculator; receipt fields are always produced by the server-side engine.",
    );
  }
  const calculatorVersionId = cleanText(
    input.calculatorVersionId,
    180,
    "PARALLEL_CALCULATOR_VERSION_INVALID",
    "Choose an approved calculator version.",
  );
  const context = await database.prepare(`SELECT
      id,
      version,
      specification,
      official_source_sha256
    FROM compliance_calculator_versions
    WHERE id = ?
      AND organisation_id = ?
      AND approval_state = 'approved'
    LIMIT 1`)
    .bind(calculatorVersionId, member.organisationId)
    .first<CalculatorReceiptContextRecord>();
  if (!context) {
    fail(
      "PARALLEL_CALCULATOR_VERSION_UNAVAILABLE",
      409,
      "The selected calculator is not an approved version in this Creditex organisation.",
    );
  }
  await requireCurrentApprovedOfficialSourceBinding(
    database,
    member.organisationId,
    "calculator",
    context.id,
    context.official_source_sha256,
  );
  const golden = await persistedGoldenVectors(database, calculatorVersionId);
  const specification = parseStoredJson(
    context.specification,
    "calculator specification",
  );
  const expectedEngineContractHash = calculatorEngineContractHash(
    specification,
  );
  let execution: ReturnType<typeof runCreditexCalculatorTestSuite>;
  try {
    execution = runCreditexCalculatorTestSuite(
      specification,
      golden.vectors,
    );
  } catch {
    fail(
      "PARALLEL_CALCULATOR_ENGINE_EXECUTION_FAILED",
      409,
      "The deterministic v2 engine could not execute the exact persisted calculator vectors.",
    );
  }
  if (
    !execution.passed
    || execution.engineContractHash !== expectedEngineContractHash
  ) {
    fail(
      "PARALLEL_CALCULATOR_ENGINE_SUITE_FAILED",
      409,
      "The exact persisted calculator vectors did not pass the deterministic v2 engine.",
    );
  }
  const existing = await database.prepare(`SELECT
      id,
      engine_contract_hash,
      engine_suite_hash,
      suite_receipt_hash,
      vector_count,
      executed_at
    FROM compliance_calculator_engine_receipts
    WHERE organisation_id = ?
      AND calculator_version_id = ?
      AND calculator_version_number = ?
      AND engine_contract_id = ?
      AND engine_contract_hash = ?
      AND golden_vector_suite_sha256 = ?
      AND suite_receipt_schema = ?
      AND engine_suite_hash = ?
      AND suite_receipt_hash = ?
      AND result = 'passed'
    LIMIT 1`)
    .bind(
      member.organisationId,
      calculatorVersionId,
      Number(context.version),
      CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
      execution.engineContractHash,
      golden.suiteSha256,
      CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
      execution.suiteHash,
      execution.receiptHash,
    )
    .first<CalculatorEngineReceiptRecord & {
      vector_count: number;
      executed_at: string;
    }>();
  if (existing) {
    return {
      receipt: publicEngineReceipt({
        ...existing,
        calculatorVersionId,
        goldenVectorSuiteSha256: golden.suiteSha256,
        vectorCount: Number(existing.vector_count),
        executedAt: existing.executed_at,
      }, true),
    };
  }
  const id = crypto.randomUUID();
  const executedAt = options.now || new Date().toISOString();
  await database.prepare(`INSERT INTO compliance_calculator_engine_receipts (
      id,
      organisation_id,
      calculator_version_id,
      calculator_version_number,
      engine_contract_id,
      engine_contract_hash,
      golden_vector_suite_sha256,
      engine_suite_hash,
      suite_receipt_schema,
      suite_receipt_hash,
      vector_count,
      result,
      executed_by_uid,
      executed_at,
      created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?, ?
    )`)
    .bind(
      id,
      member.organisationId,
      calculatorVersionId,
      Number(context.version),
      CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
      execution.engineContractHash,
      golden.suiteSha256,
      execution.suiteHash,
      CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
      execution.receiptHash,
      golden.count,
      member.uid,
      executedAt,
      executedAt,
    )
    .run();
  return {
    receipt: publicEngineReceipt({
      id,
      engine_contract_hash: execution.engineContractHash,
      engine_suite_hash: execution.suiteHash,
      suite_receipt_hash: execution.receiptHash,
      calculatorVersionId,
      goldenVectorSuiteSha256: golden.suiteSha256,
      vectorCount: golden.count,
      executedAt,
    }, false),
  };
}

async function calculationContexts(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  calculatorVersionId: string,
  calculationRunIds: readonly string[],
) {
  const result = await database.prepare(`SELECT
      calculation.id calculation_run_id,
      calculation.input_snapshot calculation_input_snapshot,
      calculation.output_snapshot calculation_output_snapshot,
      compliance_case.id case_id,
      compliance_case.case_number,
      compliance_case.revision case_revision,
      compliance_case.program_id case_program_id,
      compliance_case.work_order_id case_work_order_id,
      COALESCE(work_order.work_number, '') case_work_number,
      COALESCE(work_order.source_type, '') case_work_source_type,
      COALESCE(work_order.source_reference, '')
        case_work_source_reference,
      COALESCE((
        SELECT json_group_array(appointment.id)
        FROM trade_crm_appointments appointment
        WHERE appointment.work_order_id = compliance_case.work_order_id
          AND appointment.firebase_uid = compliance_case.installer_uid
      ), '[]') case_appointment_ids,
      compliance_case.installer_uid case_installer_uid,
      compliance_case.activity_version_id case_activity_version_id,
      compliance_case.activity_date case_activity_date,
      compliance_case.site_jurisdiction case_site_jurisdiction,
      compliance_case.activity_snapshot case_activity_snapshot,
      compliance_case.status case_status,
      compliance_case.evidence_status case_evidence_status,
      compliance_case.commercial_handoff_id case_commercial_handoff_id,
      compliance_case.accepted_quote_version_id
        case_accepted_quote_version_id,
      compliance_case.accepted_scope_sha256 case_accepted_scope_sha256,
      compliance_case.updated_at case_updated_at
    FROM compliance_calculation_runs calculation
    JOIN compliance_cases compliance_case
      ON compliance_case.id = calculation.case_id
      AND compliance_case.organisation_id = calculation.organisation_id
      AND compliance_case.revision = calculation.case_revision
    LEFT JOIN trade_work_orders work_order
      ON work_order.id = compliance_case.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
    WHERE calculation.id IN (SELECT value FROM json_each(?))
      AND calculation.organisation_id = ?
      AND calculation.calculator_version_id = ?
      AND calculation.status = 'verified'
      AND trim(calculation.verified_by_uid) <> ''
      AND datetime(calculation.verified_at) IS NOT NULL
      AND compliance_case.activity_version_id = ?`)
    .bind(
      JSON.stringify(calculationRunIds),
      organisationId,
      calculatorVersionId,
      activityVersionId,
    )
    .all<CalculationContextRecord>();
  if (result.results.length !== calculationRunIds.length) {
    fail(
      "PARALLEL_CALCULATION_CONTEXT_UNAVAILABLE",
      409,
      "Every row must reference a current, verified calculation for the selected published activity and approved calculator.",
    );
  }
  return new Map(
    result.results.map((record) => [record.calculation_run_id, record]),
  );
}

function authoritativeDataforceIdentity(
  requested: PreparedRequestedRow,
  context: CalculationContextRecord,
) {
  const dataforceJobId = normalizedIdentity(requested.dataforceJobId);
  const tlinkWorkSourceType = normalizedIdentity(
    context.case_work_source_type,
  );
  const tlinkWorkSourceReference = normalizedIdentity(
    context.case_work_source_reference,
  );
  const tlinkWorkNumber = normalizedIdentity(context.case_work_number);
  if (
    !dataforceJobId
    || !tlinkWorkNumber
    || !tlinkWorkSourceReference
  ) {
    fail(
      "PARALLEL_DATAFORCE_IDENTITY_UNAVAILABLE",
      409,
      "The staged Dataforce row and TLink work order must both retain an explicit Dataforce Job Id mapping.",
    );
  }
  if (
    tlinkWorkSourceType !== "DATAFORCE"
    || dataforceJobId !== tlinkWorkSourceReference
  ) {
    fail(
      "PARALLEL_DATAFORCE_IDENTITY_MISMATCH",
      409,
      `Staged Dataforce row ${requested.legacyImportRowId} does not belong to the verified calculation's TLink work order.`,
    );
  }
  const dataforceAppId = exactIdentity(requested.dataforceAppId);
  if (!dataforceAppId) {
    return "job_id" as const;
  }
  const appointmentIdsValue = parseStoredJson(
    context.case_appointment_ids,
    "TLink appointment identities",
  );
  const appointmentIds = Array.isArray(appointmentIdsValue)
    ? appointmentIdsValue.map(exactIdentity).filter(Boolean)
    : [];
  if (!appointmentIds.includes(dataforceAppId)) {
    fail(
      "PARALLEL_DATAFORCE_IDENTITY_MISMATCH",
      409,
      `Staged Dataforce row ${requested.legacyImportRowId} does not belong to an appointment on the verified calculation's TLink work order.`,
    );
  }
  return "app_id_and_job_id" as const;
}

async function prepareParallelRows(
  requested: readonly PreparedRequestedRow[],
  contexts: ReadonlyMap<string, CalculationContextRecord>,
  runId: string,
  organisationId: string,
  createdAt: string,
) {
  const result: PreparedParallelRow[] = [];
  for (const [index, requestedRow] of requested.entries()) {
    const context = contexts.get(requestedRow.calculationRunId);
    if (!context) {
      fail(
        "PARALLEL_CALCULATION_CONTEXT_UNAVAILABLE",
        409,
        "A verified calculation context became unavailable.",
      );
    }
    const identityMatchBasis = authoritativeDataforceIdentity(
      requestedRow,
      context,
    );
    const activitySnapshot = parseStoredJson(
      context.case_activity_snapshot,
      "case activity",
    );
    const inputJson = canonicalJson(parseStoredJson(
      context.calculation_input_snapshot,
      "calculation input",
    ));
    const outputJson = canonicalJson(parseStoredJson(
      context.calculation_output_snapshot,
      "calculation output",
    ));
    const caseSnapshotJson = canonicalJson({
      id: context.case_id,
      caseNumber: context.case_number,
      revision: Number(context.case_revision),
      programId: context.case_program_id,
      workOrderId: context.case_work_order_id,
      workNumber: context.case_work_number,
      workSourceType: context.case_work_source_type,
      workSourceReference: context.case_work_source_reference,
      installerUid: context.case_installer_uid,
      activityVersionId: context.case_activity_version_id,
      activityDate: context.case_activity_date,
      siteJurisdiction: context.case_site_jurisdiction,
      activitySnapshot,
      status: context.case_status,
      evidenceStatus: context.case_evidence_status,
      commercialHandoffId: context.case_commercial_handoff_id,
      acceptedQuoteVersionId: context.case_accepted_quote_version_id,
      acceptedScopeSha256: context.case_accepted_scope_sha256,
      updatedAt: context.case_updated_at,
    });
    const outputSha256 = await sha256Hex(outputJson);
    result.push({
      id: `${runId}:row:${index + 1}`,
      organisationId,
      runId,
      rowNumber: index + 1,
      caseId: context.case_id,
      caseRevision: Number(context.case_revision),
      caseSnapshotSha256: await sha256Hex(caseSnapshotJson),
      calculationRunId: context.calculation_run_id,
      inputSha256: await sha256Hex(inputJson),
      outputSha256,
      referenceSha256: requestedRow.referenceSha256,
      referenceJson: requestedRow.referenceJson,
      legacyImportRowId: requestedRow.legacyImportRowId,
      legacyBatchId: requestedRow.legacyBatchId,
      legacyBatchContentSha256: requestedRow.legacyBatchContentSha256,
      legacyRowNumber: requestedRow.legacyRowNumber,
      legacyRowSha256: requestedRow.legacyRowSha256,
      dataforceAppId: requestedRow.dataforceAppId,
      dataforceJobId: requestedRow.dataforceJobId,
      tlinkCaseId: context.case_id,
      tlinkWorkOrderId: context.case_work_order_id,
      tlinkWorkNumber: context.case_work_number,
      identityMatchBasis,
      result: outputSha256 === requestedRow.referenceSha256
        ? "matched"
        : "mismatched",
      createdAt,
    });
  }
  return result;
}

function publicRun(record: ParallelRunRecord, reused?: boolean) {
  return {
    id: String(record.id),
    clientRequestId: String(record.client_request_id),
    activityVersionId: String(record.activity_version_id),
    calculatorVersionId: String(record.calculator_version_id),
    goldenVectorStatus: "passed" as const,
    goldenVectorCount: Number(record.golden_vector_count),
    goldenVectorSuiteSha256: String(record.golden_vector_suite_sha256),
    calculatorEngineReceiptId: String(record.calculator_engine_receipt_id),
    calculatorEngineContractHash: String(
      record.calculator_engine_contract_hash,
    ),
    calculatorSuiteReceiptHash: String(
      record.calculator_suite_receipt_hash,
    ),
    mappingArtifactId: String(record.mapping_artifact_id),
    mappingVersion: String(record.mapping_version),
    mappingArtifactSha256: String(record.mapping_artifact_sha256),
    comparisonScope: String(record.comparison_scope) as
      | "verified_output_hash_vs_dataforce_staged_row_non_evidentiary"
      | "verified_output_hash_vs_manual_reference_non_evidentiary",
    referenceOrigin: String(record.reference_origin) as
      | "dataforce_staged_row"
      | "caller_supplied",
    referenceScope: String(record.reference_scope),
    evidenceUse: "non_evidentiary" as const,
    status: "dry_run_completed" as const,
    rowCount: Number(record.row_count),
    matchedCount: Number(record.matched_count),
    mismatchedCount: Number(record.mismatched_count),
    externalSubmissionEnabled: false,
    certificateCreationEnabled: false,
    runAt: String(record.run_at),
    ...(reused === undefined ? {} : { reused }),
  };
}

async function existingRun(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
) {
  return database.prepare(`SELECT
      id,
      client_request_id,
      request_sha256,
      activity_version_id,
      calculator_version_id,
      golden_vector_status,
      golden_vector_count,
      golden_vector_suite_sha256,
      calculator_engine_receipt_id,
      calculator_engine_contract_hash,
      calculator_suite_receipt_hash,
      mapping_artifact_id,
      mapping_version,
      mapping_artifact_sha256,
      comparison_scope,
      reference_origin,
      reference_scope,
      status,
      row_count,
      matched_count,
      mismatched_count,
      run_at
    FROM compliance_parallel_reconciliation_runs
    WHERE organisation_id = ?
      AND client_request_id = ?
    LIMIT 1`)
    .bind(organisationId, clientRequestId)
    .first<ParallelRunRecord>();
}

function parallelRowInsert(
  database: D1Database,
  rows: readonly PreparedParallelRow[],
) {
  return database.prepare(`INSERT INTO compliance_parallel_reconciliation_rows (
      id,
      organisation_id,
      run_id,
      row_number,
      case_id,
      case_revision,
      case_snapshot_sha256,
      calculation_run_id,
      input_sha256,
      output_sha256,
      reference_sha256,
      result,
      external_submission_enabled,
      certificate_creation_enabled,
      created_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.organisationId'),
      json_extract(value, '$.runId'),
      json_extract(value, '$.rowNumber'),
      json_extract(value, '$.caseId'),
      json_extract(value, '$.caseRevision'),
      json_extract(value, '$.caseSnapshotSha256'),
      json_extract(value, '$.calculationRunId'),
      json_extract(value, '$.inputSha256'),
      json_extract(value, '$.outputSha256'),
      json_extract(value, '$.referenceSha256'),
      json_extract(value, '$.result'),
      0,
      0,
      json_extract(value, '$.createdAt')
    FROM json_each(?)`)
    .bind(JSON.stringify(rows));
}

function parallelReferenceBindingInsert(
  database: D1Database,
  rows: readonly PreparedParallelRow[],
  governed: GovernedContextRecord,
  createdByUid: string,
) {
  return database.prepare(`INSERT INTO compliance_parallel_reference_bindings (
      id,
      organisation_id,
      run_id,
      parallel_row_id,
      mapping_artifact_id,
      mapping_version,
      mapping_artifact_sha256,
      transformation_contract,
      legacy_batch_id,
      legacy_batch_content_sha256,
      legacy_import_row_id,
      legacy_row_number,
      legacy_row_sha256,
      dataforce_app_id,
      dataforce_job_id,
      tlink_case_id,
      tlink_work_order_id,
      tlink_work_number,
      identity_match_basis,
      reference_snapshot,
      reference_sha256,
      evidence_use,
      external_submission_enabled,
      certificate_creation_enabled,
      created_by_uid,
      created_at
    )
    SELECT
      json_extract(value, '$.id') || ':reference',
      json_extract(value, '$.organisationId'),
      json_extract(value, '$.runId'),
      json_extract(value, '$.id'),
      ?,
      ?,
      ?,
      ?,
      json_extract(value, '$.legacyBatchId'),
      json_extract(value, '$.legacyBatchContentSha256'),
      json_extract(value, '$.legacyImportRowId'),
      json_extract(value, '$.legacyRowNumber'),
      json_extract(value, '$.legacyRowSha256'),
      json_extract(value, '$.dataforceAppId'),
      json_extract(value, '$.dataforceJobId'),
      json_extract(value, '$.tlinkCaseId'),
      json_extract(value, '$.tlinkWorkOrderId'),
      json_extract(value, '$.tlinkWorkNumber'),
      json_extract(value, '$.identityMatchBasis'),
      json_extract(value, '$.referenceJson'),
      json_extract(value, '$.referenceSha256'),
      'non_evidentiary',
      0,
      0,
      ?,
      json_extract(value, '$.createdAt')
    FROM json_each(?)`)
    .bind(
      governed.mapping_artifact_id,
      governed.mapping_version,
      governed.mapping_artifact_sha256,
      CREDITEX_DATAFORCE_PARALLEL_TRANSFORMATION_CONTRACT,
      createdByUid,
      JSON.stringify(rows),
    );
}

export async function listCreditexParallelReconciliationRuns(
  database: D1Database,
  member: ParallelMember,
) {
  requireParallelReader(member);
  const result = await database.prepare(`SELECT
      id,
      client_request_id,
      request_sha256,
      activity_version_id,
      calculator_version_id,
      golden_vector_status,
      golden_vector_count,
      golden_vector_suite_sha256,
      calculator_engine_receipt_id,
      calculator_engine_contract_hash,
      calculator_suite_receipt_hash,
      mapping_artifact_id,
      mapping_version,
      mapping_artifact_sha256,
      comparison_scope,
      reference_origin,
      reference_scope,
      status,
      row_count,
      matched_count,
      mismatched_count,
      run_at
    FROM compliance_parallel_reconciliation_runs
    WHERE organisation_id = ?
    ORDER BY run_at DESC, id DESC
    LIMIT ?`)
    .bind(
      member.organisationId,
      CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumReturnedRuns,
    )
    .all<ParallelRunRecord>();
  return result.results.map((record) => publicRun(record));
}

export async function createCreditexParallelReconciliationRun(
  database: D1Database,
  member: ParallelMember,
  input: CreateCreditexParallelReconciliationInput,
  options: { now?: string } = {},
) {
  requireParallelWriter(member);
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const activityVersionId = cleanText(
    input.activityVersionId,
    180,
    "PARALLEL_ACTIVITY_VERSION_INVALID",
    "Choose a published compliance activity version.",
  );
  const calculatorVersionId = cleanText(
    input.calculatorVersionId,
    180,
    "PARALLEL_CALCULATOR_VERSION_INVALID",
    "Choose an approved calculator version.",
  );
  const mappingArtifactId = cleanText(
    input.mappingArtifactId,
    180,
    "PARALLEL_MAPPING_ARTIFACT_INVALID",
    "Choose an independently authorized legacy mapping artifact.",
  );
  const requestedRows = prepareRequestedRows(input.rows);
  const requestSha256 = await sha256Hex(canonicalJson({
    activityVersionId,
    calculatorVersionId,
    mappingArtifactId,
    rows: requestedRows.map((row) => ({
      calculationRunId: row.calculationRunId,
      legacyImportRowId: row.legacyImportRowId,
    })),
  }));
  const requestBytes = byteLength(canonicalJson({
    clientRequestId,
    activityVersionId,
    calculatorVersionId,
    mappingArtifactId,
    rows: requestedRows.map((row) => ({
      calculationRunId: row.calculationRunId,
      legacyImportRowId: row.legacyImportRowId,
    })),
  }));
  if (
    requestBytes
    > CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRequestBytes
  ) {
    fail(
      "PARALLEL_REQUEST_TOO_LARGE",
      413,
      "The parallel reconciliation request exceeds the 1 MiB limit.",
    );
  }
  const existing = await existingRun(
    database,
    member.organisationId,
    clientRequestId,
  );
  if (existing) {
    if (existing.request_sha256 !== requestSha256) {
      fail(
        "PARALLEL_REQUEST_ID_CONFLICT",
        409,
        "This parallel reconciliation request reference was already used for different rows.",
      );
    }
    return { run: publicRun(existing, true) };
  }

  const governed = await governedContext(
    database,
    member.organisationId,
    activityVersionId,
    calculatorVersionId,
    mappingArtifactId,
  );
  if (!governed) {
    fail(
      "PARALLEL_GOVERNED_INPUTS_UNAVAILABLE",
      409,
      "A published activity, approved calculator and independently authorized mapping artifact are all required.",
    );
  }
  await requireCurrentApprovedOfficialSourceBinding(
    database,
    member.organisationId,
    "activity",
    governed.activity_version_id,
    governed.activity_official_source_sha256,
  );
  await requireCurrentApprovedOfficialSourceBinding(
    database,
    member.organisationId,
    "calculator",
    governed.calculator_version_id,
    governed.calculator_official_source_sha256,
  );
  const golden = await persistedGoldenVectors(database, calculatorVersionId);
  const currentEngineContractHash = calculatorEngineContractHash(
    parseStoredJson(
      governed.calculator_specification,
      "calculator specification",
    ),
  );
  const engineReceipt = await currentCalculatorEngineReceipt(
    database,
    member.organisationId,
    governed,
    golden,
    currentEngineContractHash,
  );
  const preparedReferences = await dataforceReferences(
    database,
    member.organisationId,
    requestedRows,
  );
  const contexts = await calculationContexts(
    database,
    member.organisationId,
    activityVersionId,
    calculatorVersionId,
    requestedRows.map((row) => row.calculationRunId),
  );
  const runId = crypto.randomUUID();
  const runAt = options.now || new Date().toISOString();
  const rows = await prepareParallelRows(
    preparedReferences,
    contexts,
    runId,
    member.organisationId,
    runAt,
  );
  const matchedCount = rows.filter((row) => row.result === "matched").length;
  const mismatchedCount = rows.length - matchedCount;
  const runRecord: ParallelRunRecord = {
    id: runId,
    client_request_id: clientRequestId,
    request_sha256: requestSha256,
    activity_version_id: governed.activity_version_id,
    calculator_version_id: governed.calculator_version_id,
    golden_vector_status: "passed",
    golden_vector_count: golden.count,
    golden_vector_suite_sha256: golden.suiteSha256,
    calculator_engine_receipt_id: engineReceipt.id,
    calculator_engine_contract_hash: engineReceipt.engine_contract_hash,
    calculator_suite_receipt_hash: engineReceipt.suite_receipt_hash,
    mapping_artifact_id: governed.mapping_artifact_id,
    mapping_version: governed.mapping_version,
    mapping_artifact_sha256: governed.mapping_artifact_sha256,
    comparison_scope:
      "verified_output_hash_vs_dataforce_staged_row_non_evidentiary",
    reference_origin: "dataforce_staged_row",
    reference_scope: "dataforce_certificate_quantity_non_evidentiary",
    status: "dry_run_completed",
    row_count: rows.length,
    matched_count: matchedCount,
    mismatched_count: mismatchedCount,
    run_at: runAt,
  };
  const chunks: PreparedParallelRow[][] = [];
  for (
    let index = 0;
    index < rows.length;
    index += CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRowsPerStatement
  ) {
    chunks.push(rows.slice(
      index,
      index
        + CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRowsPerStatement,
    ));
  }
  await database.batch([
    database.prepare(`INSERT INTO compliance_parallel_reconciliation_runs (
        id,
        organisation_id,
        client_request_id,
        request_sha256,
        activity_version_id,
        activity_version_number,
        activity_publication_snapshot_sha256,
        calculator_version_id,
        calculator_version_number,
        calculator_official_source_sha256,
        golden_vector_status,
        golden_vector_count,
        golden_vector_suite_sha256,
        calculator_engine_receipt_id,
        calculator_engine_contract_hash,
        calculator_suite_receipt_hash,
        mapping_artifact_id,
        mapping_version,
        mapping_artifact_sha256,
        comparison_scope,
        reference_origin,
        reference_scope,
        status,
        row_count,
        matched_count,
        mismatched_count,
        external_submission_enabled,
        certificate_creation_enabled,
        run_by_uid,
        run_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?, ?, ?, ?, ?, ?, ?,
        'verified_output_hash_vs_dataforce_staged_row_non_evidentiary',
        'dataforce_staged_row',
        'dataforce_certificate_quantity_non_evidentiary',
        'dry_run_completed', ?, ?, ?, 0, 0, ?, ?
      )`)
      .bind(
        runId,
        member.organisationId,
        clientRequestId,
        requestSha256,
        governed.activity_version_id,
        Number(governed.activity_version_number),
        governed.activity_publication_snapshot_sha256,
        governed.calculator_version_id,
        Number(governed.calculator_version_number),
        governed.calculator_official_source_sha256,
        golden.count,
        golden.suiteSha256,
        engineReceipt.id,
        engineReceipt.engine_contract_hash,
        engineReceipt.suite_receipt_hash,
        governed.mapping_artifact_id,
        governed.mapping_version,
        governed.mapping_artifact_sha256,
        rows.length,
        matchedCount,
        mismatchedCount,
        member.uid,
        runAt,
      ),
    ...chunks.map((chunk) => parallelRowInsert(database, chunk)),
    ...chunks.map((chunk) => parallelReferenceBindingInsert(
      database,
      chunk,
      governed,
      member.uid,
    )),
  ]);
  return { run: publicRun(runRecord, false) };
}
