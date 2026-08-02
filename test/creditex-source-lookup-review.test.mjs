import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  materialiseApprovedCreditexOperationalLookup,
  requireCurrentApprovedOfficialSourceBinding,
  reviewCreditexOfficialSource,
  reviewCreditexOperationalLookupImport,
} from "../src/lib/creditex-source-lookup-review-server.ts";
import {
  stageCreditexOperationalLookupImport,
} from "../src/lib/creditex-operational-lookup-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const sourceMigration = fs.readFileSync(
  new URL(
    "../drizzle/0102_creditex_official_source_custody.sql",
    import.meta.url,
  ),
  "utf8",
);
const lookupMigration = fs.readFileSync(
  new URL(
    "../drizzle/0104_creditex_operational_lookup_snapshots.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewMigration = fs.readFileSync(
  new URL(
    "../drizzle/0107_creditex_source_lookup_approval_bridge.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourceReviewRoute = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/official-sources/reviews/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const lookupReviewRoute = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/operational-lookups/reviews/route.ts",
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

class FakeR2 {
  objects = new Map();

  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }
}

const exactBytes = new TextEncoder().encode("official-v25-exact-bytes");
const exactSha256 = createHash("sha256").update(exactBytes).digest("hex");
const objectKey = "creditex/official/source-v25.pdf";

function fixture() {
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
      governance_identity_verified integer NOT NULL,
      governance_identity_verified_by_uid text NOT NULL,
      governance_identity_verified_at text NOT NULL,
      governance_identity_verification_basis text NOT NULL,
      display_name text NOT NULL,
      email text NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      publish_state text NOT NULL,
      official_source_sha256 text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      publish_state text NOT NULL,
      official_source_sha256 text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      publish_state text NOT NULL,
      official_source_sha256 text NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      approval_state text NOT NULL,
      official_source_sha256 text NOT NULL
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
  `);
  database.exec(sourceMigration);
  database.exec(lookupMigration);
  database.exec(reviewMigration);
  database.exec(`
    INSERT INTO compliance_organisations (id, status)
      VALUES ('org-1', 'active');
    INSERT INTO compliance_users (
      organisation_id,
      firebase_uid,
      role,
      status,
      governance_identity_verified,
      governance_identity_verified_by_uid,
      governance_identity_verified_at,
      governance_identity_verification_basis,
      display_name,
      email
    ) VALUES
      (
        'org-1', 'admin-1', 'admin', 'active', 1, 'owner-uid',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Importer Admin', 'importer@example.com'
      ),
      (
        'org-1', 'admin-2', 'admin', 'active', 1, 'owner-uid',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Reviewer Admin', 'reviewer@example.com'
      ),
      (
        'org-1', 'admin-unverified', 'admin', 'active', 0, '', '', '',
        'Unverified Admin', 'unverified@example.com'
      );
    INSERT INTO compliance_programs (
      id, organisation_id, publish_state, official_source_sha256
    ) VALUES ('program-1', 'org-1', 'draft', '${exactSha256}');
    INSERT INTO compliance_official_source_artifacts (
      id,
      organisation_id,
      client_request_id,
      source_url,
      source_host,
      source_title,
      source_version,
      original_file_name,
      content_type,
      size_bytes,
      sha256,
      object_key,
      retrieval_method,
      asserted_retrieved_at,
      source_etag,
      source_last_modified,
      custody_state,
      rule_activation_enabled,
      captured_by_uid,
      captured_at
    ) VALUES (
      'artifact-1',
      'org-1',
      'source-request-0001',
      'https://www.energy.vic.gov.au/source-v25.pdf',
      'www.energy.vic.gov.au',
      'Official VEU specification',
      '25',
      'source-v25.pdf',
      'application/pdf',
      ${exactBytes.byteLength},
      '${exactSha256}',
      '${objectKey}',
      'manual_upload',
      '2026-08-01T00:00:00.000Z',
      '',
      '',
      'pending_review',
      0,
      'admin-1',
      '2026-08-01T00:00:00.000Z'
    );
    INSERT INTO compliance_official_source_bindings (
      id,
      organisation_id,
      artifact_id,
      target_type,
      target_id,
      citation_location,
      binding_state,
      rule_activation_enabled,
      created_by_uid,
      created_at
    ) VALUES (
      'binding-1',
      'org-1',
      'artifact-1',
      'program',
      'program-1',
      'Part 1, page 14',
      'pending_review',
      0,
      'admin-1',
      '2026-08-01T00:00:00.000Z'
    );
  `);
  const relevantGuards = CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter((item) => (
    (
      item.name.includes("_source_approval_")
      && !item.name.startsWith(
        "compliance_calculator_engine_receipts_",
      )
      && !item.name.startsWith(
        "compliance_parallel_reconciliation_runs_",
      )
    )
    || item.name.startsWith(
      "compliance_official_source_review_decisions_",
    )
    || item.name.startsWith(
      "compliance_operational_lookup_review_decisions_",
    )
    || (
      item.name.startsWith("compliance_operational_lookup_")
      && !item.name.startsWith(
        "compliance_operational_lookup_review_decisions_",
      )
    )
  ));
  for (const guard of relevantGuards) database.exec(guard.sql);
  const bucket = new FakeR2();
  bucket.objects.set(objectKey, exactBytes);
  return {
    database,
    d1: testD1(database),
    bucket,
    importer: {
      uid: "admin-1",
      organisationId: "org-1",
      role: "admin",
      governanceIdentityVerified: true,
    },
    reviewer: {
      uid: "admin-2",
      organisationId: "org-1",
      role: "admin",
      governanceIdentityVerified: true,
    },
  };
}

async function approveSource(d1, bucket, reviewer) {
  const artifact = await reviewCreditexOfficialSource(
    d1,
    bucket,
    reviewer,
    {
      subjectType: "artifact",
      subjectId: "artifact-1",
      decision: "approved",
      reviewNote: "Exact retained bytes and source provenance reviewed.",
    },
    { now: "2026-08-02T01:00:00.000Z" },
  );
  const binding = await reviewCreditexOfficialSource(
    d1,
    bucket,
    reviewer,
    {
      subjectType: "binding",
      subjectId: "binding-1",
      decision: "approved",
      reviewNote: "Citation and governed program target reviewed.",
    },
    { now: "2026-08-02T01:01:00.000Z" },
  );
  return { artifact, binding };
}

test("source approval is independent, hash-bound, append-only and publication-gated", async () => {
  const { database, d1, bucket, importer, reviewer } = fixture();
  await assert.rejects(
    reviewCreditexOfficialSource(d1, bucket, importer, {
      subjectType: "artifact",
      subjectId: "artifact-1",
      decision: "approved",
      reviewNote: "Self review must not be accepted.",
    }),
    (error) => error.code === "GOVERNANCE_REVIEW_INDEPENDENCE_REQUIRED",
  );
  await assert.rejects(
    reviewCreditexOfficialSource(
      d1,
      bucket,
      { ...reviewer, governanceIdentityVerified: false },
      {
        subjectType: "artifact",
        subjectId: "artifact-1",
        decision: "approved",
        reviewNote: "Unverified review must not be accepted.",
      },
    ),
    (error) => error.code === "GOVERNANCE_REVIEWER_REQUIRED",
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET publish_state = 'published'
      WHERE id = 'program-1'`).run(),
    /COMPLIANCE_APPROVED_SOURCE_BINDING_REQUIRED/,
  );

  const artifact = await reviewCreditexOfficialSource(
    d1,
    bucket,
    reviewer,
    {
      subjectType: "artifact",
      subjectId: "artifact-1",
      decision: "approved",
      reviewNote: "Exact retained bytes and source provenance reviewed.",
    },
    { now: "2026-08-02T01:00:00.000Z" },
  );
  assert.equal(artifact.decision.artifactSha256, exactSha256);
  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET publish_state = 'published'
      WHERE id = 'program-1'`).run(),
    /COMPLIANCE_APPROVED_SOURCE_BINDING_REQUIRED/,
  );

  const binding = await reviewCreditexOfficialSource(
    d1,
    bucket,
    reviewer,
    {
      subjectType: "binding",
      subjectId: "binding-1",
      decision: "approved",
      reviewNote: "Citation and governed program target reviewed.",
    },
    { now: "2026-08-02T01:01:00.000Z" },
  );
  assert.equal(binding.decision.artifactSha256, exactSha256);
  assert.equal(
    database.prepare(`UPDATE compliance_programs
      SET publish_state = 'published'
      WHERE id = 'program-1'`).run().changes,
    1,
  );
  assert.equal(
    await requireCurrentApprovedOfficialSourceBinding(
      d1,
      "org-1",
      "program",
      "program-1",
      exactSha256,
    ),
    "binding-1",
  );
  await assert.rejects(
    reviewCreditexOfficialSource(
      d1,
      bucket,
      reviewer,
      {
        subjectType: "binding",
        subjectId: "binding-1",
        decision: "withdrawn",
        reviewNote: "A same-time withdrawal would make ordering ambiguous.",
      },
      { now: "2026-08-02T01:01:00.000Z" },
    ),
    (error) => error.code === "GOVERNANCE_REVIEW_TIME_INVALID",
  );
  await reviewCreditexOfficialSource(
    d1,
    bucket,
    reviewer,
    {
      subjectType: "binding",
      subjectId: "binding-1",
      decision: "withdrawn",
      reviewNote: "Binding approval withdrawn after publication.",
    },
    { now: "2026-08-02T01:02:00.000Z" },
  );
  await assert.rejects(
    requireCurrentApprovedOfficialSourceBinding(
      d1,
      "org-1",
      "program",
      "program-1",
      exactSha256,
    ),
    (error) => error.code === "SOURCE_BINDING_APPROVAL_REQUIRED",
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_official_source_review_decisions
      SET review_note = 'changed'
    `).run(),
    /COMPLIANCE_SOURCE_REVIEW_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_official_source_review_decisions
    `).run(),
    /COMPLIANCE_SOURCE_REVIEW_DELETE_FORBIDDEN/,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_audit_events
      WHERE event_type LIKE 'official_source.%'`).get().count,
    3,
  );
});

test("approval refuses missing or changed retained source bytes", async () => {
  const { d1, bucket, reviewer } = fixture();
  bucket.objects.set(
    objectKey,
    new TextEncoder().encode("changed-retained-bytes"),
  );
  await assert.rejects(
    reviewCreditexOfficialSource(d1, bucket, reviewer, {
      subjectType: "artifact",
      subjectId: "artifact-1",
      decision: "approved",
      reviewNote: "This object no longer matches.",
    }),
    (error) => error.code === "SOURCE_RETAINED_OBJECT_MISMATCH",
  );
  bucket.objects.delete(objectKey);
  await assert.rejects(
    reviewCreditexOfficialSource(d1, bucket, reviewer, {
      subjectType: "artifact",
      subjectId: "artifact-1",
      decision: "approved",
      reviewNote: "This object is absent.",
    }),
    (error) => error.code === "SOURCE_RETAINED_OBJECT_MISSING",
  );
});

test("lookup approval validates every staged row before recording approval", async () => {
  const { database, d1, bucket, reviewer } = fixture();
  await approveSource(d1, bucket, reviewer);
  const invalidHash = "0".repeat(64);
  database.exec(`
    INSERT INTO compliance_operational_lookup_imports (
      id, organisation_id, client_request_id, lookup_kind,
      source_artifact_id, source_artifact_sha256,
      source_artifact_custody_state, source_timestamp, request_sha256,
      records_sha256, record_count, status, live_verification_enabled,
      eligibility_activation_enabled, local_assertion_enabled,
      created_by_uid, created_at
    ) VALUES (
      'lookup-invalid', 'org-1', 'lookup-invalid-request', 'product',
      'artifact-1', '${exactSha256}', 'pending_review',
      '2026-08-02T01:30:00.000Z', '${invalidHash}', '${invalidHash}', 1,
      'staged_pending', 0, 0, 0, 'admin-1',
      '2026-08-02T01:30:00.000Z'
    );
    INSERT INTO compliance_operational_lookup_records (
      id, organisation_id, import_id, row_number, source_record_key,
      source_effective_from, source_effective_to, source_status,
      record_json, record_sha256, status, live_verification_enabled,
      eligibility_activation_enabled, local_assertion_enabled, created_at
    ) VALUES (
      'lookup-invalid-row', 'org-1', 'lookup-invalid', 1, 'PRODUCT-INVALID',
      '2026-07-21', '', 'listed', '{"listed":true}', '${invalidHash}',
      'staged_pending', 0, 0, 0, '2026-08-02T01:30:00.000Z'
    );
  `);
  await assert.rejects(
    reviewCreditexOperationalLookupImport(
      d1,
      bucket,
      reviewer,
      {
        importId: "lookup-invalid",
        decision: "approved",
        reviewNote: "This corrupt immutable snapshot must be refused.",
      },
      { now: "2026-08-02T01:31:00.000Z" },
    ),
    (error) => error.code === "LOOKUP_REVIEW_RECORDS_INVALID",
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_operational_lookup_review_decisions
      WHERE import_id = 'lookup-invalid'`).get().count,
    0,
  );
});

test("lookup approval and withdrawal never mutate staged bytes and materialise fail-closed", async () => {
  const { database, d1, bucket, importer, reviewer } = fixture();
  await approveSource(d1, bucket, reviewer);
  const staged = await stageCreditexOperationalLookupImport(
    d1,
    importer,
    {
      clientRequestId: "lookup-request-0001",
      lookupKind: "product",
      sourceArtifactId: "artifact-1",
      sourceTimestamp: "2026-08-01T01:02:03.000Z",
      records: [{
        sourceRecordKey: "PRODUCT-001",
        effectiveFrom: "2026-07-21",
        effectiveTo: "",
        sourceStatus: "listed",
        sourceRecord: { model: "HPHW-001", listed: true },
      }],
    },
    { now: "2026-08-02T02:00:00.000Z" },
  );
  await assert.rejects(
    materialiseApprovedCreditexOperationalLookup(
      d1,
      bucket,
      reviewer,
      staged.importBatch.id,
    ),
    (error) => error.code === "LOOKUP_MATERIALISATION_BLOCKED",
  );
  await assert.rejects(
    reviewCreditexOperationalLookupImport(d1, bucket, importer, {
      importId: staged.importBatch.id,
      decision: "approved",
      reviewNote: "Self review must not be accepted.",
    }),
    (error) => error.code === "GOVERNANCE_REVIEW_INDEPENDENCE_REQUIRED",
  );

  const approved = await reviewCreditexOperationalLookupImport(
    d1,
    bucket,
    reviewer,
    {
      importId: staged.importBatch.id,
      decision: "approved",
      reviewNote: "Official source snapshot and retained bytes reviewed.",
    },
    { now: "2026-08-02T02:01:00.000Z" },
  );
  assert.equal(approved.decision.recordsSha256, staged.importBatch.recordsSha256);
  const materialised = await materialiseApprovedCreditexOperationalLookup(
    d1,
    bucket,
    reviewer,
    staged.importBatch.id,
  );
  assert.deepEqual(materialised.records, [{
    sourceRecordKey: "PRODUCT-001",
    effectiveFrom: "2026-07-21",
    effectiveTo: "",
    sourceStatus: "listed",
    sourceRecord: { listed: true, model: "HPHW-001" },
  }]);

  const before = database.prepare(`SELECT record_json, record_sha256
    FROM compliance_operational_lookup_records
    WHERE import_id = ?`).get(staged.importBatch.id);
  const withdrawn = await reviewCreditexOperationalLookupImport(
    d1,
    bucket,
    reviewer,
    {
      importId: staged.importBatch.id,
      decision: "withdrawn",
      reviewNote: "Approval withdrawn after governance review.",
    },
    { now: "2026-08-02T02:02:00.000Z" },
  );
  assert.equal(
    withdrawn.decision.supersedesDecisionId,
    approved.decision.id,
  );
  assert.deepEqual(
    database.prepare(`SELECT record_json, record_sha256
      FROM compliance_operational_lookup_records
      WHERE import_id = ?`).get(staged.importBatch.id),
    before,
  );
  await assert.rejects(
    materialiseApprovedCreditexOperationalLookup(
      d1,
      bucket,
      reviewer,
      staged.importBatch.id,
    ),
    (error) => error.code === "LOOKUP_MATERIALISATION_BLOCKED",
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_operational_lookup_review_decisions
      SET review_note = 'changed'
    `).run(),
    /COMPLIANCE_LOOKUP_REVIEW_IMMUTABLE/,
  );
});

test("review routes remain authenticated, same-origin and no-store", () => {
  for (const route of [sourceReviewRoute, lookupReviewRoute]) {
    assert.match(route, /if \(!sameOrigin\(request\)\)/);
    assert.match(route, /"Cache-Control": "private, no-store"/);
    assert.match(route, /requireComplianceAccess\(request/);
    assert.match(route, /allowedRoles: \["admin"\]/);
    assert.match(route, /"record_decision"/);
    assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
  }
  assert.doesNotMatch(reviewMigration, /CREATE\s+TRIGGER/i);
});
