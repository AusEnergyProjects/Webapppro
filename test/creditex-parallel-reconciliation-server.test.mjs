import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_PARALLEL_RECONCILIATION_LIMITS,
  createCreditexCalculatorEngineReceipt,
  createCreditexParallelReconciliationRun,
  listCreditexParallelReconciliationRuns,
} from "../src/lib/creditex-parallel-reconciliation-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = [
  "../drizzle/0100_creditex_dataforce_staging.sql",
  "../drizzle/0102_creditex_official_source_custody.sql",
  "../drizzle/0105_creditex_parallel_reconciliation.sql",
  "../drizzle/0107_creditex_source_lookup_approval_bridge.sql",
  "../drizzle/0108_creditex_dataforce_parallel_bindings.sql",
].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const routeSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/parallel-reconciliation/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const serverSource = fs.readFileSync(
  new URL(
    "../src/lib/creditex-parallel-reconciliation-server.ts",
    import.meta.url,
  ),
  "utf8",
);

const DATAFORCE_ROW_JSON = JSON.stringify({
  "App Id": "APP-1",
  "Job Id": "JOB-1",
  "Certificates (VEECs)": "2",
});
const DATAFORCE_ROW_SHA256 = createHash("sha256")
  .update(DATAFORCE_ROW_JSON)
  .digest("hex");
const DATAFORCE_ROW_SQL = DATAFORCE_ROW_JSON.replaceAll("'", "''");
const ACTIVITY_SOURCE_SHA256 = "1".repeat(64);
const CALCULATOR_SOURCE_SHA256 = "d".repeat(64);
const CALCULATOR_SPECIFICATION = {
  schemaVersion: "creditex-calculator-specification/v2",
  key: "test_veec_quantity",
  version: 3,
  title: "Test VEEC quantity",
  inputs: [{
    key: "units",
    unit: "count",
    precision: 0,
    minimum: "0",
  }],
  steps: [{
    kind: "factor",
    key: "certificate_quantity",
    source: "units",
    inputUnit: "count",
    outputUnit: "VEEC",
    factor: "2",
  }],
  output: {
    source: "certificate_quantity",
    unit: "VEEC",
  },
};
const GOLDEN_INPUT = { units: { value: "1", unit: "count" } };
const GOLDEN_EXPECTED = { value: "2", unit: "VEEC" };
const CALCULATOR_SPECIFICATION_SQL = JSON.stringify(
  CALCULATOR_SPECIFICATION,
).replaceAll("'", "''");
const GOLDEN_INPUT_SQL = JSON.stringify(GOLDEN_INPUT).replaceAll("'", "''");
const GOLDEN_EXPECTED_SQL = JSON.stringify(
  GOLDEN_EXPECTED,
).replaceAll("'", "''");

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

const GOLDEN_VECTOR_SUITE_SHA256 = createHash("sha256")
  .update(canonicalJson([{
    id: "vector-1",
    vectorKey: "golden_one",
    inputSnapshot: GOLDEN_INPUT,
    expectedOutput: GOLDEN_EXPECTED,
    toleranceSnapshot: { absolute: "0" },
    sourceCitation: "Official specification clause 1",
  }]))
  .digest("hex");

function seedApprovedSource(database, targetType, targetId, sha256) {
  const artifactId = `source-artifact-${targetType}`;
  const bindingId = `source-binding-${targetType}`;
  const objectKey = `creditex/test/${targetType}.pdf`;
  database.prepare(`INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, client_request_id, source_url, source_host,
      source_title, source_version, original_file_name, content_type,
      size_bytes, sha256, object_key, retrieval_method,
      asserted_retrieved_at, source_etag, source_last_modified,
      custody_state, rule_activation_enabled, captured_by_uid, captured_at
    ) VALUES (
      ?, 'org-1', ?, ?, 'energy.gov.au', ?, '1', ?, 'application/pdf',
      1, ?, ?, 'manual_upload', '2026-08-01T00:00:00.000Z', '', '',
      'pending_review', 0, 'mapping-requester',
      '2026-08-01T00:00:00.000Z'
    )`).run(
    artifactId,
    `source-request-${targetType}`,
    `https://energy.gov.au/${targetType}.pdf`,
    `${targetType} official source`,
    `${targetType}.pdf`,
    sha256,
    objectKey,
  );
  database.prepare(`INSERT INTO compliance_official_source_bindings (
      id, organisation_id, artifact_id, target_type, target_id,
      citation_location, binding_state, rule_activation_enabled,
      created_by_uid, created_at
    ) VALUES (
      ?, 'org-1', ?, ?, ?, 'Clause 1', 'pending_review', 0,
      'mapping-requester', '2026-08-01T00:00:00.000Z'
    )`).run(bindingId, artifactId, targetType, targetId);
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, binding_target_type,
      binding_target_id, citation_location, decision,
      supersedes_decision_id, review_note, reviewed_by_uid, reviewed_at
    ) VALUES (
      ?, 'org-1', 'artifact', ?, ?, ?, ?, '', '', '', 'approved', '',
      'Exact retained source approved.', 'authorizer-1',
      '2026-08-01T00:00:00.000Z'
    )`).run(
    `source-review-artifact-${targetType}`,
    artifactId,
    artifactId,
    sha256,
    objectKey,
  );
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, binding_target_type,
      binding_target_id, citation_location, decision,
      supersedes_decision_id, review_note, reviewed_by_uid, reviewed_at
    ) VALUES (
      ?, 'org-1', 'binding', ?, ?, ?, ?, ?, ?, 'Clause 1', 'approved', '',
      'Exact target binding approved.', 'authorizer-2',
      '2026-08-01T00:00:00.000Z'
    )`).run(
    `source-review-binding-${targetType}`,
    bindingId,
    artifactId,
    sha256,
    objectKey,
    targetType,
    targetId,
  );
}

function withdrawSourceBinding(
  database,
  targetType,
  targetId,
  reviewedAt,
) {
  const source = database.prepare(`SELECT
      binding.id binding_id,
      binding.artifact_id,
      binding.citation_location,
      artifact.sha256 artifact_sha256,
      artifact.object_key artifact_object_key,
      review.id review_id
    FROM compliance_official_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.artifact_id
      AND artifact.organisation_id = binding.organisation_id
    JOIN compliance_official_source_review_decisions review
      ON review.organisation_id = binding.organisation_id
      AND review.subject_type = 'binding'
      AND review.subject_id = binding.id
      AND review.decision = 'approved'
    WHERE binding.organisation_id = 'org-1'
      AND binding.target_type = ?
      AND binding.target_id = ?
    ORDER BY review.reviewed_at DESC, review.id DESC
    LIMIT 1`).get(targetType, targetId);
  assert.ok(source);
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, binding_target_type,
      binding_target_id, citation_location, decision,
      supersedes_decision_id, review_note, reviewed_by_uid, reviewed_at
    ) VALUES (
      ?, 'org-1', 'binding', ?, ?, ?, ?, ?, ?, ?, 'withdrawn', ?,
      'Approval withdrawn during guarded insert regression.',
      'authorizer-1', ?
    )`).run(
    `source-withdrawal-${targetType}-${targetId}`,
    source.binding_id,
    source.artifact_id,
    source.artifact_sha256,
    source.artifact_object_key,
    targetType,
    targetId,
    source.citation_location,
    source.review_id,
    reviewedAt,
  );
}

class TestD1Statement {
  constructor(database, sql, values = [], beforeRun = undefined) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.beforeRun = beforeRun;
  }

  bind(...values) {
    return new TestD1Statement(
      this.database,
      this.sql,
      values,
      this.beforeRun,
    );
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    this.beforeRun?.(this.sql);
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database, {
  beforeRun = undefined,
  beforeBatch = undefined,
} = {}) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql, [], beforeRun);
    },
    async batch(statements) {
      beforeBatch?.();
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture({
  governed = true,
  approvedSources = true,
} = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      version integer NOT NULL,
      publish_state text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      official_source_sha256 text NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      official_source_sha256 text NOT NULL,
      specification text NOT NULL,
      approval_state text NOT NULL
    );
    CREATE TABLE compliance_calculator_test_vectors (
      id text PRIMARY KEY NOT NULL,
      calculator_version_id text NOT NULL,
      vector_key text NOT NULL,
      input_snapshot text NOT NULL,
      expected_output text NOT NULL,
      tolerance_snapshot text NOT NULL,
      source_citation text NOT NULL,
      last_result text NOT NULL,
      last_run_at text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_number text NOT NULL,
      revision integer NOT NULL,
      program_id text NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      activity_version_id text NOT NULL,
      activity_date text NOT NULL,
      site_jurisdiction text NOT NULL,
      activity_snapshot text NOT NULL,
      status text NOT NULL,
      evidence_status text NOT NULL,
      commercial_handoff_id text NOT NULL,
      accepted_quote_version_id text NOT NULL,
      accepted_scope_sha256 text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_calculation_runs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      case_revision integer NOT NULL,
      calculator_version_id text NOT NULL,
      input_snapshot text NOT NULL,
      output_snapshot text NOT NULL,
      status text NOT NULL,
      verified_by_uid text NOT NULL,
      verified_at text NOT NULL
    );
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      source_type text NOT NULL,
      source_reference text NOT NULL,
      work_number text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL
    );
    CREATE TABLE compliance_audit_events (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      actor_type text NOT NULL,
      actor_uid text NOT NULL,
      event_type text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      summary text NOT NULL,
      metadata text NOT NULL CHECK (json_valid(metadata)),
      created_at text NOT NULL
    );
    INSERT INTO compliance_organisations (id, status)
      VALUES ('org-1', 'active'), ('org-2', 'active');
    INSERT INTO compliance_users (
      organisation_id, firebase_uid, role, status,
      governance_identity_verified
    ) VALUES
      ('org-1', 'mapping-requester', 'case_manager', 'active', 1),
      ('org-1', 'authorizer-1', 'admin', 'active', 1),
      ('org-1', 'authorizer-2', 'admin', 'active', 1),
      ('org-1', 'runner-1', 'reviewer', 'active', 1),
      ('org-1', 'auditor-1', 'auditor', 'active', 1),
      ('org-1', 'unverified-1', 'admin', 'active', 0),
      ('org-2', 'runner-2', 'admin', 'active', 1);
  `);
  database.exec(migration);
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    ({ name }) => (
      name.startsWith("compliance_legacy_mapping_")
      || name.startsWith("compliance_calculator_engine_receipts_")
      || name.startsWith("compliance_parallel_")
    ),
  )) {
    database.exec(guard.sql);
  }
  if (governed) {
    database.exec(`
      INSERT INTO compliance_programs (id, organisation_id)
        VALUES ('program-1', 'org-1');
      INSERT INTO compliance_activity_versions (
        id, program_id, version, publish_state,
        publication_snapshot_sha256, official_source_sha256
      ) VALUES (
        'activity-1', 'program-1', 25, 'published', '${"c".repeat(64)}',
        '${ACTIVITY_SOURCE_SHA256}'
      );
      INSERT INTO compliance_calculator_versions (
        id, organisation_id, activity_version_id, version,
        official_source_sha256, specification, approval_state
      ) VALUES (
        'calculator-1', 'org-1', 'activity-1', 3,
        '${CALCULATOR_SOURCE_SHA256}', '${CALCULATOR_SPECIFICATION_SQL}',
        'approved'
      );
      INSERT INTO compliance_calculator_test_vectors (
        id, calculator_version_id, vector_key, input_snapshot,
        expected_output, tolerance_snapshot, source_citation,
        last_result, last_run_at
      ) VALUES (
        'vector-1', 'calculator-1', 'golden_one',
        '${GOLDEN_INPUT_SQL}', '${GOLDEN_EXPECTED_SQL}', '{"absolute":"0"}',
        'Official specification clause 1', 'passed',
        '2026-08-01T00:00:00.000Z'
      );
      INSERT INTO compliance_legacy_mapping_artifacts (
        id, organisation_id, legacy_system_key, mapping_version,
        artifact_format, object_key, artifact_sha256, authorization_state,
        authorization_basis, requested_by_uid, primary_authorizer_uid,
        secondary_authorizer_uid, authorized_at, withdrawn_by_uid,
        withdrawn_at, created_at
      ) VALUES (
        'mapping-1', 'org-1',
        'dataforce-jobs-v1:certificate-quantity-v1', 'mapping-v1',
        'json', 'creditex/mappings/mapping-1.json', '${"e".repeat(64)}',
        'approved', 'Independent mapping review passed.',
        'mapping-requester', 'authorizer-1', 'authorizer-2',
        '2026-08-01T00:00:00.000Z', '', '',
        '2026-08-01T00:00:00.000Z'
      );
      INSERT INTO compliance_legacy_import_batches (
        id, organisation_id, source_system, contract_version, file_name,
        content_sha256, file_size_bytes, row_count, status,
        regulated_job_creation_enabled, created_by_uid, created_at
      ) VALUES (
        'dataforce-batch-1', 'org-1', 'dataforce', 'dataforce-jobs-v1',
        'dataforce-jobs.csv', '${"a".repeat(64)}', 128, 1,
        'staged_unmapped', 0, 'mapping-requester',
        '2026-08-01T00:00:00.000Z'
      );
      INSERT INTO compliance_legacy_import_rows (
        id, batch_id, organisation_id, row_number, app_id, job_id,
        row_sha256, data_json, mapping_status, created_at
      ) VALUES (
        'dataforce-row-1', 'dataforce-batch-1', 'org-1', 2, 'APP-1',
        'JOB-1', '${DATAFORCE_ROW_SHA256}', '${DATAFORCE_ROW_SQL}',
        'staged_unmapped', '2026-08-01T00:00:00.000Z'
      );
      INSERT INTO compliance_cases (
        id, organisation_id, case_number, revision, program_id,
        work_order_id, installer_uid, activity_version_id, activity_date,
        site_jurisdiction, activity_snapshot, status, evidence_status,
        commercial_handoff_id, accepted_quote_version_id,
        accepted_scope_sha256, updated_at
      ) VALUES (
        'case-1', 'org-1', 'PRIVATE-CASE-001', 4, 'program-1',
        'private-work-order', 'private-installer', 'activity-1',
        '2026-08-01', 'VIC',
        '{"privateCustomer":"private.person@example.com"}',
        'in_review', 'complete', 'handoff-1', 'quote-version-1',
        '${"f".repeat(64)}', '2026-08-01T01:00:00.000Z'
      );
      INSERT INTO trade_work_orders (
        id, firebase_uid, source_type, source_reference, work_number
      ) VALUES (
        'private-work-order', 'private-installer', 'dataforce', 'JOB-1',
        'TLJ-000001'
      );
      INSERT INTO trade_crm_appointments (
        id, work_order_id, firebase_uid
      ) VALUES (
        'APP-1', 'private-work-order', 'private-installer'
      );
      INSERT INTO compliance_calculation_runs (
        id, organisation_id, case_id, case_revision,
        calculator_version_id, input_snapshot, output_snapshot, status,
        verified_by_uid, verified_at
      ) VALUES (
        'calculation-run-1', 'org-1', 'case-1', 4, 'calculator-1',
        '{"units":1}', '{"certificateQuantity":2}', 'verified',
        'authorizer-1', '2026-08-01T02:00:00.000Z'
      );
    `);
    if (approvedSources) {
      seedApprovedSource(
        database,
        "activity",
        "activity-1",
        ACTIVITY_SOURCE_SHA256,
      );
      seedApprovedSource(
        database,
        "calculator",
        "calculator-1",
        CALCULATOR_SOURCE_SHA256,
      );
    }
  }
  return {
    database,
    d1: testD1(database),
    runner: {
      uid: "runner-1",
      organisationId: "org-1",
      role: "reviewer",
      governanceIdentityVerified: true,
    },
  };
}

async function readyFixture(options = {}) {
  const state = fixture(options);
  const result = await createCreditexCalculatorEngineReceipt(
    state.d1,
    state.runner,
    { calculatorVersionId: "calculator-1" },
    { now: "2026-08-01T00:30:00.000Z" },
  );
  return {
    ...state,
    engineReceipt: result.receipt,
  };
}

function input(overrides = {}) {
  return {
    clientRequestId: "parallel-request-0001",
    activityVersionId: "activity-1",
    calculatorVersionId: "calculator-1",
    mappingArtifactId: "mapping-1",
    rows: [{
      calculationRunId: "calculation-run-1",
      legacyImportRowId: "dataforce-row-1",
    }],
    ...overrides,
  };
}

test("governed dry run pins hashes, compares verified output and remains non-submitting", async () => {
  const { database, d1, runner, engineReceipt } = await readyFixture();
  const first = await createCreditexParallelReconciliationRun(
    d1,
    runner,
    input(),
    { now: "2026-08-02T01:02:03.000Z" },
  );
  assert.equal(first.run.reused, false);
  assert.equal(first.run.status, "dry_run_completed");
  assert.equal(
    first.run.comparisonScope,
    "verified_output_hash_vs_dataforce_staged_row_non_evidentiary",
  );
  assert.equal(first.run.calculatorEngineReceiptId, engineReceipt.id);
  assert.equal(
    first.run.calculatorEngineContractHash,
    engineReceipt.engineContractHash,
  );
  assert.equal(
    first.run.calculatorSuiteReceiptHash,
    engineReceipt.suiteReceiptHash,
  );
  assert.equal(first.run.referenceOrigin, "dataforce_staged_row");
  assert.equal(
    first.run.referenceScope,
    "dataforce_certificate_quantity_non_evidentiary",
  );
  assert.equal(first.run.evidenceUse, "non_evidentiary");
  assert.equal(first.run.goldenVectorStatus, "passed");
  assert.equal(first.run.goldenVectorCount, 1);
  assert.equal(first.run.matchedCount, 1);
  assert.equal(first.run.mismatchedCount, 0);
  assert.equal(first.run.externalSubmissionEnabled, false);
  assert.equal(first.run.certificateCreationEnabled, false);
  assert.doesNotMatch(
    JSON.stringify(first),
    /private\.person@example\.com|private-installer|private-work-order/,
  );

  const row = database.prepare(`
    SELECT * FROM compliance_parallel_reconciliation_rows
  `).get();
  assert.equal(row.result, "matched");
  assert.equal(row.output_sha256, row.reference_sha256);
  assert.match(row.case_snapshot_sha256, /^[0-9a-f]{64}$/);
  assert.match(row.input_sha256, /^[0-9a-f]{64}$/);
  assert.equal(row.external_submission_enabled, 0);
  assert.equal(row.certificate_creation_enabled, 0);
  assert.doesNotMatch(
    JSON.stringify(row),
    /private\.person@example\.com|private-installer|private-work-order/,
  );

  const binding = database.prepare(`
    SELECT * FROM compliance_parallel_reference_bindings
  `).get();
  const persistedRun = database.prepare(`
    SELECT * FROM compliance_parallel_reconciliation_runs
  `).get();
  assert.equal(
    persistedRun.comparison_scope,
    first.run.comparisonScope,
  );
  assert.equal(
    persistedRun.comparison_scope,
    "verified_output_hash_vs_dataforce_staged_row_non_evidentiary",
  );
  assert.equal(binding.legacy_import_row_id, "dataforce-row-1");
  assert.equal(binding.legacy_row_sha256, DATAFORCE_ROW_SHA256);
  assert.equal(
    binding.transformation_contract,
    "dataforce-jobs-v1:certificate-quantity-v1",
  );
  assert.deepEqual(JSON.parse(binding.reference_snapshot), {
    certificateQuantity: 2,
  });
  assert.equal(binding.reference_sha256, row.reference_sha256);
  assert.equal(binding.dataforce_app_id, "APP-1");
  assert.equal(binding.dataforce_job_id, "JOB-1");
  assert.equal(binding.tlink_case_id, "case-1");
  assert.equal(binding.tlink_work_order_id, "private-work-order");
  assert.equal(binding.tlink_work_number, "TLJ-000001");
  assert.equal(binding.identity_match_basis, "app_id_and_job_id");
  assert.equal(binding.evidence_use, "non_evidentiary");
  assert.equal(binding.external_submission_enabled, 0);
  assert.equal(binding.certificate_creation_enabled, 0);

  const audit = database.prepare(`
    SELECT * FROM compliance_audit_events
  `).get();
  assert.equal(
    audit.event_type,
    "parallel_reconciliation.dry_run_completed",
  );
  assert.match(audit.summary, /Non-evidentiary Dataforce-bound/);
  assert.doesNotMatch(
    audit.metadata,
    /private\.person@example\.com|private-installer|private-work-order/,
  );

  const second = await createCreditexParallelReconciliationRun(
    d1,
    runner,
    input(),
    { now: "2026-08-02T02:03:04.000Z" },
  );
  assert.equal(second.run.id, first.run.id);
  assert.equal(second.run.reused, true);
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_parallel_reconciliation_runs
    `).get().count,
    1,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_audit_events
    `).get().count,
    1,
  );

  const listed = await listCreditexParallelReconciliationRuns(d1, runner);
  assert.equal(listed.length, 1);
  assert.doesNotMatch(
    JSON.stringify(listed),
    /private\.person@example\.com|private-installer|private-work-order|case-1/,
  );

  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      runner,
      input({
        rows: [{
          calculationRunId: "calculation-run-1",
          legacyImportRowId: "dataforce-row-other",
        }],
      }),
    ),
    (error) => error.code === "PARALLEL_REQUEST_ID_CONFLICT",
  );
});

test("parallel references are server-derived from exact staged Dataforce rows", async () => {
  const { database, d1, runner } = await readyFixture();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      runner,
      input({
        rows: [{
          calculationRunId: "calculation-run-1",
          legacyImportRowId: "dataforce-row-1",
          referenceSnapshot: { certificateQuantity: 999 },
        }],
      }),
    ),
    (error) => error.code === "PARALLEL_CALLER_REFERENCE_FORBIDDEN",
  );
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      runner,
      input({
        clientRequestId: "parallel-request-missing",
        rows: [{
          calculationRunId: "calculation-run-1",
          legacyImportRowId: "dataforce-row-missing",
        }],
      }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_REFERENCE_UNAVAILABLE",
  );
  database.prepare(`UPDATE compliance_legacy_import_rows
    SET data_json = '{"Certificates (VEECs)":"7"}'
    WHERE id = 'dataforce-row-1'`).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      runner,
      input({ clientRequestId: "parallel-request-corrupt" }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_ROW_HASH_MISMATCH",
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_parallel_reconciliation_runs`).get().count,
    0,
  );
});

test("submitted row ids cannot cross-link a Dataforce job to another TLink case", async () => {
  const mismatch = await readyFixture();
  const otherJson = JSON.stringify({
    "App Id": "APP-OTHER",
    "Job Id": "JOB-OTHER",
    "Certificates (VEECs)": "2",
  });
  mismatch.database.prepare(`INSERT INTO compliance_legacy_import_rows (
      id, batch_id, organisation_id, row_number, app_id, job_id,
      row_sha256, data_json, mapping_status, created_at
    ) VALUES (
      'dataforce-row-other', 'dataforce-batch-1', 'org-1', 3,
      'APP-OTHER', 'JOB-OTHER', ?, ?, 'staged_unmapped',
      '2026-08-01T00:00:00.000Z'
    )`).run(
    createHash("sha256").update(otherJson).digest("hex"),
    otherJson,
  );
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      mismatch.d1,
      mismatch.runner,
      input({
        clientRequestId: "parallel-request-identity-mismatch",
        rows: [{
          calculationRunId: "calculation-run-1",
          legacyImportRowId: "dataforce-row-other",
        }],
      }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_IDENTITY_MISMATCH",
  );

  const missingWorkIdentity = await readyFixture();
  missingWorkIdentity.database.prepare(`
    DELETE FROM trade_work_orders WHERE id = 'private-work-order'
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      missingWorkIdentity.d1,
      missingWorkIdentity.runner,
      input({ clientRequestId: "parallel-request-identity-missing" }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_IDENTITY_UNAVAILABLE",
  );

  const implicitWorkNumberOnly = await readyFixture();
  implicitWorkNumberOnly.database.prepare(`
    UPDATE trade_work_orders
    SET source_type = 'internal', source_reference = '', work_number = 'JOB-1'
    WHERE id = 'private-work-order'
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      implicitWorkNumberOnly.d1,
      implicitWorkNumberOnly.runner,
      input({ clientRequestId: "parallel-request-implicit-job-number" }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_IDENTITY_UNAVAILABLE",
  );

  const mismatchedAppointment = await readyFixture();
  mismatchedAppointment.database.prepare(`
    DELETE FROM trade_crm_appointments WHERE id = 'APP-1'
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      mismatchedAppointment.d1,
      mismatchedAppointment.runner,
      input({ clientRequestId: "parallel-request-app-mismatch" }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_IDENTITY_MISMATCH",
  );

  const caseMismatchedAppointment = await readyFixture();
  caseMismatchedAppointment.database.prepare(`
    UPDATE trade_crm_appointments SET id = 'app-1' WHERE id = 'APP-1'
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      caseMismatchedAppointment.d1,
      caseMismatchedAppointment.runner,
      input({ clientRequestId: "parallel-request-app-case-mismatch" }),
    ),
    (error) => error.code === "PARALLEL_DATAFORCE_IDENTITY_MISMATCH",
  );
});

test("parallel runs require current source approvals and a persisted v2 engine receipt", async () => {
  const legacyPublished = fixture({ approvedSources: false });
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      legacyPublished.d1,
      legacyPublished.runner,
      input({ clientRequestId: "parallel-request-no-source-approval" }),
    ),
    (error) => error.code === "SOURCE_BINDING_APPROVAL_REQUIRED",
  );
  const noReceipt = fixture();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      noReceipt.d1,
      noReceipt.runner,
      input({ clientRequestId: "parallel-request-no-engine-receipt" }),
    ),
    (error) => (
      error.code === "PARALLEL_CALCULATOR_ENGINE_RECEIPT_REQUIRED"
    ),
  );
});

test("engine receipts are server-executed, exact-spec bound and reject forged fields", async () => {
  const state = fixture();
  await assert.rejects(
    createCreditexCalculatorEngineReceipt(
      state.d1,
      { ...state.runner, role: "case_manager" },
      { calculatorVersionId: "calculator-1" },
    ),
    (error) => error.code === "PARALLEL_ENGINE_RECEIPT_ROLE_REQUIRED",
  );
  await assert.rejects(
    createCreditexCalculatorEngineReceipt(
      state.d1,
      state.runner,
      {
        calculatorVersionId: "calculator-1",
        engineContractHash: `sha256:${"7".repeat(64)}`,
        suiteReceiptHash: `sha256:${"8".repeat(64)}`,
        result: "passed",
      },
    ),
    (error) => error.code === "PARALLEL_ENGINE_RECEIPT_INPUT_INVALID",
  );
  assert.equal(
    state.database.prepare(`SELECT COUNT(*) count
      FROM compliance_calculator_engine_receipts`).get().count,
    0,
  );

  const created = await createCreditexCalculatorEngineReceipt(
    state.d1,
    state.runner,
    { calculatorVersionId: "calculator-1" },
    { now: "2026-08-01T00:30:00.000Z" },
  );
  assert.equal(created.receipt.reused, false);
  assert.equal(created.receipt.result, "passed");
  assert.equal(
    created.receipt.goldenVectorSuiteSha256,
    GOLDEN_VECTOR_SUITE_SHA256,
  );
  assert.match(created.receipt.engineContractHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(created.receipt.engineSuiteHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(created.receipt.suiteReceiptHash, /^sha256:[0-9a-f]{64}$/);

  const persisted = state.database.prepare(`
    SELECT * FROM compliance_calculator_engine_receipts
  `).get();
  assert.equal(
    persisted.engine_contract_hash,
    created.receipt.engineContractHash,
  );
  assert.equal(persisted.engine_suite_hash, created.receipt.engineSuiteHash);
  assert.equal(
    persisted.suite_receipt_hash,
    created.receipt.suiteReceiptHash,
  );

  const repeated = await createCreditexCalculatorEngineReceipt(
    state.d1,
    state.runner,
    { calculatorVersionId: "calculator-1" },
  );
  assert.equal(repeated.receipt.id, created.receipt.id);
  assert.equal(repeated.receipt.reused, true);
  assert.equal(
    state.database.prepare(`SELECT COUNT(*) count
      FROM compliance_calculator_engine_receipts`).get().count,
    1,
  );

  state.database.prepare(`
    UPDATE compliance_calculator_versions
    SET specification = ?
    WHERE id = 'calculator-1'
  `).run(JSON.stringify({
    ...CALCULATOR_SPECIFICATION,
    steps: [{
      ...CALCULATOR_SPECIFICATION.steps[0],
      factor: "3",
    }],
  }));
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      state.d1,
      state.runner,
      input({ clientRequestId: "parallel-request-spec-changed" }),
    ),
    (error) => (
      error.code === "PARALLEL_CALCULATOR_ENGINE_RECEIPT_REQUIRED"
    ),
  );
});

test("insert-time guards close source-approval withdrawal races", async () => {
  const receiptRace = fixture();
  let receiptWithdrawalInjected = false;
  const receiptRaceD1 = testD1(receiptRace.database, {
    beforeRun(sql) {
      if (
        !receiptWithdrawalInjected
        && sql.includes("INSERT INTO compliance_calculator_engine_receipts")
      ) {
        receiptWithdrawalInjected = true;
        withdrawSourceBinding(
          receiptRace.database,
          "calculator",
          "calculator-1",
          "2026-08-01T00:15:00.000Z",
        );
      }
    },
  });
  await assert.rejects(
    createCreditexCalculatorEngineReceipt(
      receiptRaceD1,
      receiptRace.runner,
      { calculatorVersionId: "calculator-1" },
    ),
    /COMPLIANCE_CALCULATOR_ENGINE_RECEIPT_SOURCE_APPROVAL_INVALID/,
  );
  assert.equal(receiptWithdrawalInjected, true);
  assert.equal(
    receiptRace.database.prepare(`SELECT COUNT(*) count
      FROM compliance_calculator_engine_receipts`).get().count,
    0,
  );

  const runRace = await readyFixture();
  let runWithdrawalInjected = false;
  const runRaceD1 = testD1(runRace.database, {
    beforeBatch() {
      if (!runWithdrawalInjected) {
        runWithdrawalInjected = true;
        withdrawSourceBinding(
          runRace.database,
          "activity",
          "activity-1",
          "2026-08-01T00:45:00.000Z",
        );
      }
    },
  });
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      runRaceD1,
      runRace.runner,
      input({ clientRequestId: "parallel-request-source-withdrawal-race" }),
    ),
    /COMPLIANCE_PARALLEL_ACTIVITY_SOURCE_APPROVAL_INVALID/,
  );
  assert.equal(runWithdrawalInjected, true);
  assert.equal(
    runRace.database.prepare(`SELECT COUNT(*) count
      FROM compliance_parallel_reconciliation_runs`).get().count,
    0,
  );
});

test("governed inventory absence, role, identity, tenant and row bounds fail closed", async () => {
  const empty = fixture({ governed: false });
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      empty.d1,
      empty.runner,
      input(),
    ),
    (error) => (
      error.code === "PARALLEL_GOVERNED_INPUTS_UNAVAILABLE"
      && error.status === 409
    ),
  );
  assert.equal(
    empty.database.prepare(`
      SELECT COUNT(*) count FROM compliance_parallel_reconciliation_runs
    `).get().count,
    0,
  );

  const { database, d1, runner } = fixture();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      { ...runner, role: "auditor" },
      input(),
    ),
    (error) => error.code === "PARALLEL_ROLE_REQUIRED",
  );
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      {
        uid: "unverified-1",
        organisationId: "org-1",
        role: "admin",
        governanceIdentityVerified: false,
      },
      input(),
    ),
    (error) => error.code === "PARALLEL_GOVERNANCE_IDENTITY_REQUIRED",
  );
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      {
        uid: "runner-2",
        organisationId: "org-2",
        role: "admin",
        governanceIdentityVerified: true,
      },
      input(),
    ),
    (error) => error.code === "PARALLEL_GOVERNED_INPUTS_UNAVAILABLE",
  );
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      d1,
      runner,
      input({
        clientRequestId: "parallel-request-many",
        rows: Array.from({
          length:
            CREDITEX_PARALLEL_RECONCILIATION_LIMITS.maximumRows + 1,
        }, (_, index) => ({
          calculationRunId: `calculation-run-${index + 1}`,
          legacyImportRowId: `dataforce-row-${index + 1}`,
        })),
      }),
    ),
    (error) => (
      error.code === "PARALLEL_ROW_LIMIT_EXCEEDED"
      && error.status === 413
    ),
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_parallel_reconciliation_runs
    `).get().count,
    0,
  );
});

test("engine-executed vectors and verified calculations are required for a run", async () => {
  const failedVector = fixture();
  failedVector.database.prepare(`
    UPDATE compliance_calculator_test_vectors
    SET expected_output = '{"value":"999","unit":"VEEC"}'
  `).run();
  await assert.rejects(
    createCreditexCalculatorEngineReceipt(
      failedVector.d1,
      failedVector.runner,
      { calculatorVersionId: "calculator-1" },
    ),
    (error) => error.code === "PARALLEL_CALCULATOR_ENGINE_SUITE_FAILED",
  );
  assert.equal(
    failedVector.database.prepare(`SELECT COUNT(*) count
      FROM compliance_calculator_engine_receipts`).get().count,
    0,
  );

  const mutableLastResult = await readyFixture();
  mutableLastResult.database.prepare(`
    UPDATE compliance_calculator_test_vectors
    SET last_result = 'failed', last_run_at = ''
  `).run();
  const run = await createCreditexParallelReconciliationRun(
    mutableLastResult.d1,
    mutableLastResult.runner,
    input({ clientRequestId: "parallel-request-last-result-ignored" }),
  );
  assert.equal(run.run.status, "dry_run_completed");

  const unverified = await readyFixture();
  unverified.database.prepare(`
    UPDATE compliance_calculation_runs
    SET status = 'calculated', verified_by_uid = '', verified_at = ''
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      unverified.d1,
      unverified.runner,
      input(),
    ),
    (error) => error.code === "PARALLEL_CALCULATION_CONTEXT_UNAVAILABLE",
  );
});

test("mapping, runs and row results are immutable and cannot be deleted", async () => {
  const { database, d1, runner } = await readyFixture();
  await createCreditexParallelReconciliationRun(d1, runner, input(), {
    now: "2026-08-02T01:02:03.000Z",
  });
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_legacy_mapping_artifacts
      SET mapping_version = 'changed'
    `).run(),
    /COMPLIANCE_MAPPING_ARTIFACT_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_parallel_reconciliation_runs
    `).run(),
    /COMPLIANCE_PARALLEL_RUN_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_parallel_reconciliation_rows
      SET result = 'matched'
    `).run(),
    /COMPLIANCE_PARALLEL_ROW_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_parallel_reference_bindings
      SET reference_snapshot = '{"certificateQuantity":3}'
    `).run(),
    /COMPLIANCE_PARALLEL_REFERENCE_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_parallel_reference_bindings
    `).run(),
    /COMPLIANCE_PARALLEL_REFERENCE_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_calculator_engine_receipts
      SET engine_contract_hash = 'sha256:${"7".repeat(64)}'
    `).run(),
    /COMPLIANCE_CALCULATOR_ENGINE_RECEIPT_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_calculator_engine_receipts
    `).run(),
    /COMPLIANCE_CALCULATOR_ENGINE_RECEIPT_DELETE_FORBIDDEN/,
  );
});

test("parallel API is authenticated, same-origin, no-store and connector-free", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /requireComplianceAccess\(request/);
  assert.match(
    routeSource,
    /allowedRoles: \["admin", "case_manager", "reviewer"\]/,
  );
  assert.match(routeSource, /"create_engine_receipt"/);
  assert.match(routeSource, /createCreditexCalculatorEngineReceipt/);
  assert.match(routeSource, /PARALLEL_ENGINE_RECEIPT_INPUT_INVALID/);
  assert.match(routeSource, /"create_dry_run"/);
  assert.doesNotMatch(routeSource, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(`${routeSource}\n${serverSource}`, /\bfetch\s*\(/);
  assert.match(
    migration,
    /`external_submission_enabled` = 0/,
  );
  assert.match(
    migration,
    /`certificate_creation_enabled` = 0/,
  );
  assert.match(
    migration,
    /`golden_vector_status` = 'passed'/,
  );
});
