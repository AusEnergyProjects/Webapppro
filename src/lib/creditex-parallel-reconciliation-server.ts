import type { ComplianceIdentity } from "./compliance-access-server";

export const CREDITEX_PARALLEL_RECONCILIATION_LIMITS = Object.freeze({
  maximumRequestBytes: 1024 * 1024,
  maximumRows: 250,
  maximumReferenceBytes: 64 * 1024,
  maximumReturnedRuns: 50,
  maximumRowsPerStatement: 80,
});

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

type GovernedContextRecord = {
  activity_version_id: string;
  activity_version_number: number;
  activity_publication_snapshot_sha256: string;
  calculator_version_id: string;
  calculator_version_number: number;
  calculator_official_source_sha256: string;
  mapping_artifact_id: string;
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
  last_result: string;
  last_run_at: string;
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
  mapping_artifact_id: string;
  mapping_version: string;
  mapping_artifact_sha256: string;
  comparison_scope: string;
  status: string;
  row_count: number;
  matched_count: number;
  mismatched_count: number;
  run_at: string;
};

type RequestedRow = {
  calculationRunId: string;
  referenceJson: string;
  referenceSha256: string;
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

async function prepareRequestedRows(rows: unknown) {
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
  const seen = new Set<string>();
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
    if (seen.has(calculationRunId)) {
      fail(
        "PARALLEL_CALCULATION_RUN_DUPLICATE",
        400,
        `Comparison row ${index + 1} repeats a calculation run.`,
      );
    }
    seen.add(calculationRunId);
    if (row.referenceSnapshot === undefined) {
      fail(
        "PARALLEL_REFERENCE_SNAPSHOT_REQUIRED",
        400,
        `Comparison row ${index + 1} needs the legacy reference snapshot.`,
      );
    }
    const referenceJson = canonicalJson(row.referenceSnapshot);
    if (
      byteLength(referenceJson)
      > CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumReferenceBytes
    ) {
      fail(
        "PARALLEL_REFERENCE_TOO_LARGE",
        413,
        `Comparison row ${index + 1} exceeds the 64 KiB reference limit.`,
      );
    }
    prepared.push({
      calculationRunId,
      referenceJson,
      referenceSha256: await sha256Hex(referenceJson),
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
      calculator.id calculator_version_id,
      calculator.version calculator_version_number,
      calculator.official_source_sha256
        calculator_official_source_sha256,
      mapping.id mapping_artifact_id,
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
    WHERE activity.id = ?
      AND activity.publish_state = 'published'
      AND length(activity.publication_snapshot_sha256) = 64
      AND length(calculator.official_source_sha256) = 64
    LIMIT 1`)
    .bind(
      organisationId,
      calculatorVersionId,
      mappingArtifactId,
      activityVersionId,
    )
    .first<GovernedContextRecord>();
}

async function passedGoldenVectors(
  database: D1Database,
  calculatorVersionId: string,
) {
  const result = await database.prepare(`SELECT
      id,
      vector_key,
      input_snapshot,
      expected_output,
      tolerance_snapshot,
      source_citation,
      last_result,
      last_run_at
    FROM compliance_calculator_test_vectors
    WHERE calculator_version_id = ?
    ORDER BY vector_key, id`)
    .bind(calculatorVersionId)
    .all<GoldenVectorRecord>();
  if (
    result.results.length < 1
    || result.results.some((vector) => (
      vector.last_result !== "passed" || !vector.last_run_at
    ))
  ) {
    fail(
      "PARALLEL_GOLDEN_VECTORS_NOT_PASSED",
      409,
      "Every approved calculator golden vector must be passed before a parallel comparison can run.",
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
    lastResult: vector.last_result,
    lastRunAt: vector.last_run_at,
  }));
  return {
    count: snapshot.length,
    suiteSha256: await sha256Hex(canonicalJson(snapshot)),
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

async function prepareParallelRows(
  requested: readonly RequestedRow[],
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
    mappingArtifactId: String(record.mapping_artifact_id),
    mappingVersion: String(record.mapping_version),
    mappingArtifactSha256: String(record.mapping_artifact_sha256),
    comparisonScope:
      "verified_output_hash_vs_manual_reference_non_evidentiary" as const,
    referenceOrigin: "caller_supplied" as const,
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
      mapping_artifact_id,
      mapping_version,
      mapping_artifact_sha256,
      comparison_scope,
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
      mapping_artifact_id,
      mapping_version,
      mapping_artifact_sha256,
      comparison_scope,
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
  const requestedRows = await prepareRequestedRows(input.rows);
  const requestSha256 = await sha256Hex(canonicalJson({
    activityVersionId,
    calculatorVersionId,
    mappingArtifactId,
    rows: requestedRows.map((row) => ({
      calculationRunId: row.calculationRunId,
      referenceSha256: row.referenceSha256,
    })),
  }));
  const requestBytes = byteLength(canonicalJson({
    clientRequestId,
    activityVersionId,
    calculatorVersionId,
    mappingArtifactId,
    rows: requestedRows.map((row) => ({
      calculationRunId: row.calculationRunId,
      referenceJson: row.referenceJson,
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
  const golden = await passedGoldenVectors(database, calculatorVersionId);
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
    requestedRows,
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
    mapping_artifact_id: governed.mapping_artifact_id,
    mapping_version: governed.mapping_version,
    mapping_artifact_sha256: governed.mapping_artifact_sha256,
    comparison_scope:
      "verified_output_hash_vs_manual_reference_non_evidentiary",
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
        mapping_artifact_id,
        mapping_version,
        mapping_artifact_sha256,
        comparison_scope,
        status,
        row_count,
        matched_count,
        mismatched_count,
        external_submission_enabled,
        certificate_creation_enabled,
        run_by_uid,
        run_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?, ?, ?, ?,
        'verified_output_hash_vs_manual_reference_non_evidentiary',
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
  ]);
  return { run: publicRun(runRecord, false) };
}
