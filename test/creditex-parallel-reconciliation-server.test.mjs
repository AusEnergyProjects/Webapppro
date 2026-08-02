import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_PARALLEL_RECONCILIATION_LIMITS,
  createCreditexParallelReconciliationRun,
  listCreditexParallelReconciliationRuns,
} from "../src/lib/creditex-parallel-reconciliation-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL(
    "../drizzle/0105_creditex_parallel_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);
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

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
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

function fixture({ governed = true } = {}) {
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
      publication_snapshot_sha256 text NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      official_source_sha256 text NOT NULL,
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
      || name.startsWith("compliance_parallel_reconciliation_")
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
        publication_snapshot_sha256
      ) VALUES (
        'activity-1', 'program-1', 25, 'published', '${"c".repeat(64)}'
      );
      INSERT INTO compliance_calculator_versions (
        id, organisation_id, activity_version_id, version,
        official_source_sha256, approval_state
      ) VALUES (
        'calculator-1', 'org-1', 'activity-1', 3,
        '${"d".repeat(64)}', 'approved'
      );
      INSERT INTO compliance_calculator_test_vectors (
        id, calculator_version_id, vector_key, input_snapshot,
        expected_output, tolerance_snapshot, source_citation,
        last_result, last_run_at
      ) VALUES (
        'vector-1', 'calculator-1', 'golden-1',
        '{"units":1}', '{"certificateQuantity":2}', '{"absolute":0}',
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
        'mapping-1', 'org-1', 'legacy-system', 'mapping-v1',
        'json', 'creditex/mappings/mapping-1.json', '${"e".repeat(64)}',
        'approved', 'Independent mapping review passed.',
        'mapping-requester', 'authorizer-1', 'authorizer-2',
        '2026-08-01T00:00:00.000Z', '', '',
        '2026-08-01T00:00:00.000Z'
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

function input(overrides = {}) {
  return {
    clientRequestId: "parallel-request-0001",
    activityVersionId: "activity-1",
    calculatorVersionId: "calculator-1",
    mappingArtifactId: "mapping-1",
    rows: [{
      calculationRunId: "calculation-run-1",
      referenceSnapshot: { certificateQuantity: 2 },
    }],
    ...overrides,
  };
}

test("governed dry run pins hashes, compares verified output and remains non-submitting", async () => {
  const { database, d1, runner } = fixture();
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
    "verified_output_hash_vs_manual_reference_non_evidentiary",
  );
  assert.equal(first.run.referenceOrigin, "caller_supplied");
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

  const audit = database.prepare(`
    SELECT * FROM compliance_audit_events
  `).get();
  assert.equal(
    audit.event_type,
    "parallel_reconciliation.dry_run_completed",
  );
  assert.match(audit.summary, /Non-evidentiary manual-reference/);
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
          referenceSnapshot: { certificateQuantity: 3 },
        }],
      }),
    ),
    (error) => error.code === "PARALLEL_REQUEST_ID_CONFLICT",
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
          referenceSnapshot: {},
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

test("failed golden vectors and unverified calculations cannot produce a run", async () => {
  const failedVector = fixture();
  failedVector.database.prepare(`
    UPDATE compliance_calculator_test_vectors
    SET last_result = 'failed'
  `).run();
  await assert.rejects(
    createCreditexParallelReconciliationRun(
      failedVector.d1,
      failedVector.runner,
      input(),
    ),
    (error) => error.code === "PARALLEL_GOLDEN_VECTORS_NOT_PASSED",
  );

  const unverified = fixture();
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
  const { database, d1, runner } = fixture();
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
});

test("parallel API is authenticated, same-origin, no-store and connector-free", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /requireComplianceAccess\(request/);
  assert.match(
    routeSource,
    /allowedRoles: \["admin", "case_manager", "reviewer"\]/,
  );
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
