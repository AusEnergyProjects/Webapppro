import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  appendCreditexCalculatorVector,
  createCreditexCalculatorDraft,
  CreditexCalculatorAuthoringError,
  listCreditexCalculatorDrafts,
} from "../src/lib/creditex-calculator-authoring-server.ts";
import {
  CREDITEX_CALCULATOR_SPEC_SCHEMA,
} from "../src/lib/creditex-calculator-engine.ts";
import {
  CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS,
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
  ensureCreditexSchemaGuards,
} from "../src/lib/creditex-schema-guards.ts";

const sourceCustodyMigration = fs.readFileSync(
  new URL(
    "../drizzle/0102_creditex_official_source_custody.sql",
    import.meta.url,
  ),
  "utf8",
);
const authoringMigration = fs.readFileSync(
  new URL(
    "../drizzle/0110_creditex_calculator_authoring.sql",
    import.meta.url,
  ),
  "utf8",
);
const sourceReviewMigration = fs.readFileSync(
  new URL(
    "../drizzle/0107_creditex_source_lookup_approval_bridge.sql",
    import.meta.url,
  ),
  "utf8",
);
const routeSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/calculators/route.ts",
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

function schemaGuardD1(database) {
  const base = testD1(database);
  return {
    ...base,
    prepare(sql) {
      if (
        sql.includes(
          "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
        )
      ) {
        return {
          async all() {
            const installed = database.prepare(
              "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
            ).all();
            const calculatorNames = new Set(
              CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS
                .map((definition) => definition.name),
            );
            return {
              results: [
                ...CREDITEX_SCHEMA_GUARD_DEFINITIONS
                  .filter((definition) => !calculatorNames.has(definition.name))
                  .map((definition) => ({
                    name: definition.name,
                    sql: definition.sql,
                  })),
                ...installed,
              ],
            };
          },
        };
      }
      if (
        sql.includes("SELECT name FROM sqlite_schema")
        && sql.includes("WHERE type = 'table'")
      ) {
        return {
          async all() {
            return {
              results: [...sql.matchAll(/'([^']+)'/g)]
                .map((match) => ({ name: match[1] })),
            };
          },
        };
      }
      if (sql === "PRAGMA table_xinfo(`compliance_cases`)") {
        return {
          async all() {
            return {
              results: [
                { name: "compliance_intent_id" },
                { name: "commercial_handoff_id" },
                { name: "accepted_quote_version_id" },
                { name: "accepted_scope_sha256" },
              ],
            };
          },
        };
      }
      if (
        sql
        === "PRAGMA table_xinfo(`trade_work_order_compliance_intents`)"
      ) {
        return {
          async all() {
            return {
              results: [{ name: "intent_key" }],
            };
          },
        };
      }
      return base.prepare(sql);
    },
  };
}

const sourceBytes = new TextEncoder().encode(
  "Official government calculator clause retained exactly.",
);
const sourceSha256 = createHash("sha256")
  .update(sourceBytes)
  .digest("hex");

function bucket(bytes = sourceBytes) {
  return {
    async get(key) {
      if (key !== "official/calculator-source.pdf" || bytes === null) {
        return null;
      }
      return {
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    },
    async put() {},
    async head() {
      return null;
    },
    async delete() {},
  };
}

async function fixture({ installSchemaGuards = true } = {}) {
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
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      official_source_sha256 text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      calculator_key text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      output_type text NOT NULL,
      specification text NOT NULL CHECK (json_valid(specification)),
      rounding_policy text NOT NULL CHECK (json_valid(rounding_policy)),
      official_source_url text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      approval_state text NOT NULL,
      primary_approver_uid text NOT NULL,
      secondary_approver_uid text NOT NULL,
      approved_at text NOT NULL,
      withdrawn_at text NOT NULL,
      created_by_uid text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (activity_version_id, calculator_key, version)
    );
    CREATE TABLE compliance_calculator_test_vectors (
      id text PRIMARY KEY NOT NULL,
      calculator_version_id text NOT NULL,
      vector_key text NOT NULL,
      input_snapshot text NOT NULL CHECK (json_valid(input_snapshot)),
      expected_output text NOT NULL CHECK (json_valid(expected_output)),
      tolerance_snapshot text NOT NULL CHECK (json_valid(tolerance_snapshot)),
      source_citation text NOT NULL,
      last_result text NOT NULL,
      last_run_at text NOT NULL,
      created_by_uid text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (calculator_version_id, vector_key)
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
      governance_identity_verified, governance_identity_verified_by_uid,
      governance_identity_verified_at,
      governance_identity_verification_basis, display_name, email
    ) VALUES
      ('org-1', 'author-1', 'admin', 'active', 1, 'identity-owner',
        '2026-07-31T00:00:00.000Z', 'Government identity checked',
        'Named Author', 'author@example.com'),
      ('org-1', 'reviewer-1', 'reviewer', 'active', 1, 'identity-owner',
        '2026-07-31T00:00:00.000Z', 'Government identity checked',
        'Named Reviewer', 'reviewer@example.com'),
      ('org-1', 'bootstrap-1', 'admin', 'active', 1, 'identity-owner',
        '2026-07-31T00:00:00.000Z', 'Government identity checked',
        'Shared mailbox', 'info@ausenergyassessments.com'),
      ('org-1', 'unverified-1', 'admin', 'active', 0, '', '', '',
        'Unverified Author', 'unverified@example.com'),
      ('org-1', 'weak-1', 'admin', 'active', 1, 'weak-1',
        '2026-07-31T00:00:00.000Z', 'Self assertion',
        'Weak Author', 'weak@example.com'),
      ('org-2', 'other-1', 'admin', 'active', 1, 'identity-owner',
        '2026-07-31T00:00:00.000Z', 'Government identity checked',
        'Other Author', 'other@example.com');
    INSERT INTO compliance_programs (id, organisation_id, publish_state)
      VALUES
        ('program-1', 'org-1', 'published'),
        ('program-2', 'org-2', 'published');
    INSERT INTO compliance_activity_versions (
      id, program_id, official_source_sha256, publish_state
    ) VALUES
      ('activity-1', 'program-1', '${sourceSha256}', 'published'),
      ('activity-2', 'program-2', '${sourceSha256}', 'published');
  `);
  database.exec(sourceCustodyMigration);
  database.exec(sourceReviewMigration);
  database.exec(`
    INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, client_request_id, source_url, source_host,
      source_title, source_version, original_file_name, content_type,
      size_bytes, sha256, object_key, retrieval_method,
      asserted_retrieved_at, source_etag, source_last_modified,
      custody_state, rule_activation_enabled, captured_by_uid, captured_at
    ) VALUES (
      'artifact-1', 'org-1', 'source-request-1',
      'https://www.energy.vic.gov.au/formula.pdf', 'www.energy.vic.gov.au',
      'Official calculator source', '2026-08-01', 'formula.pdf',
      'application/pdf', ${sourceBytes.byteLength}, '${sourceSha256}',
      'official/calculator-source.pdf', 'manual_upload',
      '2026-08-01T00:00:00.000Z', '', '', 'pending_review', 0,
      'author-1', '2026-08-01T00:00:00.000Z'
    );
    INSERT INTO compliance_official_source_bindings (
      id, organisation_id, artifact_id, target_type, target_id,
      citation_location, binding_state, rule_activation_enabled,
      created_by_uid, created_at
    ) VALUES (
      'activity-binding-1', 'org-1', 'artifact-1', 'activity', 'activity-1',
      'Clause 9, table 2', 'pending_review', 0,
      'author-1', '2026-08-01T00:00:00.000Z'
    );
    INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, binding_target_type,
      binding_target_id, citation_location, decision,
      supersedes_decision_id, review_note, reviewed_by_uid, reviewed_at
    ) VALUES
      (
        'artifact-review-1', 'org-1', 'artifact', 'artifact-1',
        'artifact-1', '${sourceSha256}', 'official/calculator-source.pdf',
        '', '', '', 'approved', '', 'Exact source reviewed.',
        'reviewer-1', '2026-08-01T00:10:00.000Z'
      ),
      (
        'binding-review-1', 'org-1', 'binding', 'activity-binding-1',
        'artifact-1', '${sourceSha256}', 'official/calculator-source.pdf',
        'activity', 'activity-1', 'Clause 9, table 2', 'approved', '',
        'Exact activity binding reviewed.', 'reviewer-1',
        '2026-08-01T00:20:00.000Z'
      );
  `);
  database.exec(authoringMigration);
  const d1 = schemaGuardD1(database);
  if (installSchemaGuards) {
    await ensureCreditexSchemaGuards(d1);
  }
  return {
    database,
    d1,
    author: identity("author-1", "admin", true, "author@example.com"),
    reviewer: identity(
      "reviewer-1",
      "reviewer",
      true,
      "reviewer@example.com",
    ),
  };
}

function identity(uid, role, verified, email, organisationId = "org-1") {
  return {
    uid,
    organisationId,
    role,
    governanceIdentityVerified: verified,
    email,
    displayName: uid === "bootstrap-1" ? "Shared mailbox" : "Named User",
  };
}

function specification(overrides = {}) {
  return {
    schemaVersion: CREDITEX_CALCULATOR_SPEC_SCHEMA,
    key: "government_activity_formula",
    version: 1,
    title: "Government activity formula draft",
    inputs: [{
      key: "eligible_units",
      unit: "count",
      precision: 0,
      minimum: "0",
      maximum: "100",
    }],
    steps: [
      {
        kind: "factor",
        key: "raw_veecs",
        source: "eligible_units",
        inputUnit: "count",
        outputUnit: "VEEC",
        factor: "2",
      },
      {
        kind: "cap",
        key: "capped_veecs",
        source: "raw_veecs",
        unit: "VEEC",
        maximum: "10",
      },
      {
        kind: "rounding",
        key: "reported_veecs",
        source: "capped_veecs",
        unit: "VEEC",
        mode: "floor",
        decimalPlaces: 0,
      },
    ],
    output: { source: "reported_veecs", unit: "VEEC" },
    ...overrides,
  };
}

function draftInput(overrides = {}) {
  return {
    clientRequestId: "calculator-request-0001",
    activityVersionId: "activity-1",
    sourceArtifactId: "artifact-1",
    activitySourceBindingId: "activity-binding-1",
    sourceCitation: "Clause 9, table 2",
    specification: specification(),
    ...overrides,
  };
}

function ids(...values) {
  let index = 0;
  return () => values[index++] || `unused-${index}`;
}

async function createDraft(fixtureValue, overrides = {}) {
  return createCreditexCalculatorDraft(
    fixtureValue.d1,
    bucket(),
    fixtureValue.author,
    draftInput(overrides),
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: ids("version-1", "binding-1", "receipt-1"),
    },
  );
}

function assertAuthoringError(code) {
  return (error) => {
    assert.ok(error instanceof CreditexCalculatorAuthoringError);
    assert.equal(error.code, code);
    return true;
  };
}

test("calculator authoring guards install lazily and reject preseed bypasses", async () => {
  assert.doesNotMatch(authoringMigration, /CREATE\s+TRIGGER/i);
  assert.equal(
    CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS.length,
    14,
  );
  for (const definition of
    CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS) {
    assert.match(definition.sql, /^CREATE TRIGGER IF NOT EXISTS /);
  }

  const preseeded = await fixture({ installSchemaGuards: false });
  preseeded.database.prepare(`
    INSERT INTO compliance_calculator_authoring_receipts (
      id, organisation_id, client_request_id, request_sha256,
      calculator_version_id, activity_version_id, source_artifact_id,
      activity_source_binding_id, calculator_source_binding_id,
      source_artifact_sha256, specification_sha256, engine_contract_hash,
      authoring_contract_sha256, created_by_uid, created_at
    ) VALUES (
      'preseeded-receipt', 'org-1', 'preseeded-request', ?,
      'preseeded-calculator', 'activity-1', 'artifact-1',
      'activity-binding-1', 'calculator-binding-1',
      ?, ?, ?, ?, 'author-1', '2026-08-02T00:00:00.000Z'
    )
  `).run(
    "a".repeat(64),
    sourceSha256,
    "b".repeat(64),
    `sha256:${"c".repeat(64)}`,
    "d".repeat(64),
  );
  await assert.rejects(
    () => ensureCreditexSchemaGuards(preseeded.d1),
    /CREDITEX_CALCULATOR_AUTHORING_PRESEED_ROWS_BLOCKED/,
  );
  assert.equal(
    preseeded.database.prepare(`SELECT COUNT(*) count
      FROM sqlite_schema
      WHERE type = 'trigger'
        AND name LIKE 'compliance_calculator_%'`).get().count,
    0,
  );
});

test("a named governance member authors an immutable source-bound draft only", async () => {
  const current = await fixture();
  assert.equal(
    current.database.prepare(`SELECT COUNT(*) count
      FROM sqlite_schema
      WHERE type = 'trigger'
        AND name IN (${
          CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS
            .map(() => "?")
            .join(", ")
        })`).get(
      ...CREDITEX_CALCULATOR_AUTHORING_SCHEMA_GUARD_DEFINITIONS
        .map((definition) => definition.name),
    ).count,
    14,
  );
  const created = await createDraft(current);
  assert.equal(created.draft.approvalState, "draft");
  assert.equal(created.draft.authoringState, "pending_review");
  assert.equal(created.draft.outputType, "VEEC");
  assert.equal(created.draft.officialSourceSha256, sourceSha256);
  assert.equal(created.draft.estimateEnabled, false);
  assert.equal(created.draft.calculationExecutionEnabled, false);
  assert.equal(created.draft.certificateCreationEnabled, false);
  assert.equal(created.draft.computedReceipt, undefined);
  assert.deepEqual(created.draft.calculationPolicy.roundingSteps, [{
    key: "reported_veecs",
    source: "capped_veecs",
    unit: "VEEC",
    mode: "floor",
    decimalPlaces: 0,
  }]);
  assert.deepEqual(created.draft.calculationPolicy.capSteps, [{
    key: "capped_veecs",
    source: "raw_veecs",
    unit: "VEEC",
    minimum: "",
    maximum: "10",
  }]);

  const binding = current.database.prepare(`
    SELECT target_type, target_id, binding_state, rule_activation_enabled
    FROM compliance_official_source_bindings
    WHERE id = 'calculator-binding:binding-1'
  `).get();
  assert.deepEqual({ ...binding }, {
    target_type: "calculator",
    target_id: "calculator:version-1",
    binding_state: "pending_review",
    rule_activation_enabled: 0,
  });
  const draftAudit = current.database.prepare(`
    SELECT event_type, target_type, target_id, actor_uid, metadata
    FROM compliance_audit_events
    WHERE target_id = ?
  `).get(created.draft.id);
  assert.deepEqual(
    {
      eventType: draftAudit.event_type,
      targetType: draftAudit.target_type,
      targetId: draftAudit.target_id,
      actorUid: draftAudit.actor_uid,
      authoringState: JSON.parse(draftAudit.metadata).authoringState,
    },
    {
      eventType: "calculator.draft_authored",
      targetType: "calculator_version",
      targetId: created.draft.id,
      actorUid: "author-1",
      authoringState: "pending_review",
    },
  );
  assert.throws(
    () => current.database.prepare(`
      UPDATE compliance_calculator_versions
      SET title = 'changed'
      WHERE id = 'calculator:version-1'
    `).run(),
    /COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE/,
  );
  for (const mutation of [
    `
      UPDATE compliance_calculator_versions
      SET approval_state = 'testing',
        primary_approver_uid = 'reviewer-1',
        updated_at = '2026-08-02T01:30:00.000Z'
      WHERE id = 'calculator:version-1'
    `,
    `
      UPDATE compliance_calculator_versions
      SET primary_approver_uid = 'author-1',
        approved_at = '2026-08-02T01:30:00.000Z',
        updated_at = '2026-08-02T01:30:00.000Z'
      WHERE id = 'calculator:version-1'
    `,
    `
      UPDATE compliance_calculator_versions
      SET secondary_approver_uid = 'fabricated-reviewer',
        withdrawn_at = '2026-08-02T01:30:00.000Z',
        updated_at = '2026-08-02T01:30:00.000Z'
      WHERE id = 'calculator:version-1'
    `,
  ]) {
    assert.throws(
      () => current.database.prepare(mutation).run(),
      /COMPLIANCE_CALCULATOR_AUTHORING_DRAFT_ONLY/,
    );
  }
  assert.throws(
    () => current.database.prepare(`
      DELETE FROM compliance_calculator_authoring_receipts
      WHERE calculator_version_id = 'calculator:version-1'
    `).run(),
    /COMPLIANCE_CALCULATOR_AUTHORING_IMMUTABLE/,
  );
});

test("authoring is idempotent and owner-scoped", async () => {
  const current = await fixture();
  const first = await createDraft(current);
  const reused = await createCreditexCalculatorDraft(
    current.d1,
    bucket(),
    current.author,
    draftInput(),
  );
  assert.equal(reused.draft.id, first.draft.id);
  assert.equal(reused.draft.reused, true);
  assert.equal(
    current.database.prepare(`
      SELECT count(*) count
      FROM compliance_calculator_authoring_receipts
    `).get().count,
    1,
  );
  assert.equal(
    (await listCreditexCalculatorDrafts(current.d1, current.author)).length,
    1,
  );
  const other = identity(
    "other-1",
    "admin",
    true,
    "other@example.com",
    "org-2",
  );
  assert.deepEqual(
    await listCreditexCalculatorDrafts(current.d1, other),
    [],
  );
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(),
      current.author,
      draftInput({ specification: specification({ title: "Changed" }) }),
    ),
    assertAuthoringError("CALCULATOR_REQUEST_CONFLICT"),
  );
});

test("shared, unverified and non-governance identities fail closed", async () => {
  const current = await fixture();
  for (const member of [
    identity(
      "bootstrap-1",
      "admin",
      true,
      "info@ausenergyassessments.com",
    ),
    identity(
      "unverified-1",
      "admin",
      false,
      "unverified@example.com",
    ),
    identity("auditor-1", "auditor", true, "auditor@example.com"),
  ]) {
    await assert.rejects(
      () => createCreditexCalculatorDraft(
        current.d1,
        bucket(),
        member,
        draftInput(),
      ),
      assertAuthoringError("CALCULATOR_NAMED_GOVERNANCE_REQUIRED"),
    );
  }
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(),
      identity("weak-1", "admin", true, "weak@example.com"),
      draftInput(),
      {
        now: "2026-08-02T01:00:00.000Z",
        idFactory: ids("weak-version", "weak-binding", "weak-receipt"),
      },
    ),
    /COMPLIANCE_CALCULATOR_NAMED_GOVERNANCE_REQUIRED/,
  );
});

test("source custody and typed specification boundaries reject unsafe drafts", async () => {
  const current = await fixture();
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(null),
      current.author,
      draftInput(),
    ),
    assertAuthoringError("CALCULATOR_SOURCE_BYTES_MISSING"),
  );
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(new TextEncoder().encode("changed bytes")),
      current.author,
      draftInput(),
    ),
    assertAuthoringError("CALCULATOR_SOURCE_BYTES_CHANGED"),
  );
  const numeric = specification();
  numeric.steps[0].factor = 2;
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(),
      current.author,
      draftInput({ specification: numeric }),
    ),
    assertAuthoringError("CALCULATOR_SPECIFICATION_INVALID"),
  );
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      current.d1,
      bucket(),
      current.author,
      {
        ...draftInput(),
        approvalState: "approved",
        computedReceipt: { output: "10" },
      },
    ),
    assertAuthoringError("CALCULATOR_DRAFT_FIELDS_INVALID"),
  );
});

test("draft creation requires the exact currently approved activity source binding", async () => {
  const current = await fixture();
  current.database.prepare(`
    DELETE FROM compliance_official_source_review_decisions
    WHERE id = 'binding-review-1'
  `).run();
  current.database.exec(`
    INSERT INTO compliance_official_source_bindings (
      id, organisation_id, artifact_id, target_type, target_id,
      citation_location, binding_state, rule_activation_enabled,
      created_by_uid, created_at
    ) VALUES (
      'activity-binding-other', 'org-1', 'artifact-1', 'activity',
      'activity-1', 'Different clause', 'pending_review', 0,
      'author-1', '2026-08-01T00:30:00.000Z'
    );
    INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, binding_target_type,
      binding_target_id, citation_location, decision,
      supersedes_decision_id, review_note, reviewed_by_uid, reviewed_at
    ) VALUES (
      'binding-review-other', 'org-1', 'binding',
      'activity-binding-other', 'artifact-1', '${sourceSha256}',
      'official/calculator-source.pdf', 'activity', 'activity-1',
      'Different clause', 'approved', '', 'Other binding reviewed.',
      'reviewer-1', '2026-08-01T00:40:00.000Z'
    );
  `);
  await assert.rejects(
    () => createDraft(current),
    assertAuthoringError("CALCULATOR_SOURCE_APPROVAL_REQUIRED"),
  );
  assert.equal(
    current.database.prepare(`
      SELECT count(*) count FROM compliance_calculator_versions
    `).get().count,
    0,
  );
});

test("unexpected source approval storage failures remain server errors", async () => {
  const current = await fixture();
  const brokenD1 = {
    ...current.d1,
    prepare(sql) {
      if (
        sql.includes("compliance_official_source_review_decisions")
        && sql.includes("SELECT binding.id")
      ) {
        throw new Error("review database unavailable");
      }
      return current.d1.prepare(sql);
    },
  };
  await assert.rejects(
    () => createCreditexCalculatorDraft(
      brokenD1,
      bucket(),
      current.author,
      draftInput(),
    ),
    (error) => {
      assert.equal(
        error instanceof CreditexCalculatorAuthoringError,
        false,
      );
      assert.match(error.message, /review database unavailable/);
      return true;
    },
  );
});

test("authoritative vectors are append-only hashes and never execution receipts", async () => {
  const current = await fixture();
  const created = await createDraft(current);
  const vectorInput = {
    clientRequestId: "vector-request-0001",
    calculatorVersionId: created.draft.id,
    vectorKey: "five_units",
    inputs: {
      eligible_units: { value: "5", unit: "count" },
    },
    expected: { value: "10", unit: "VEEC" },
    sourceCitation: "Clause 9, table 2, worked example A",
  };
  const vector = await appendCreditexCalculatorVector(
    current.d1,
    bucket(),
    current.reviewer,
    vectorInput,
    {
      now: "2026-08-02T02:00:00.000Z",
      idFactory: ids("vector-1", "vector-receipt-1"),
    },
  );
  assert.equal(vector.vector.result, "not_run");
  assert.equal(vector.vector.computedReceipt, null);
  assert.match(vector.vector.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(vector.vector.expectedOutputSha256, /^[a-f0-9]{64}$/);
  assert.match(vector.vector.vectorContractSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(vector.vector.expected, { unit: "VEEC", value: "10" });
  const reused = await appendCreditexCalculatorVector(
    current.d1,
    bucket(),
    current.reviewer,
    vectorInput,
  );
  assert.equal(reused.vector.id, vector.vector.id);
  assert.equal(reused.vector.reused, true);
  const canonicalReuse = await appendCreditexCalculatorVector(
    current.d1,
    bucket(),
    current.reviewer,
    {
      ...vectorInput,
      inputs: {
        eligible_units: { value: "05", unit: "count" },
      },
    },
  );
  assert.equal(canonicalReuse.vector.id, vector.vector.id);
  assert.equal(canonicalReuse.vector.reused, true);
  const vectorAudit = current.database.prepare(`
    SELECT event_type, target_type, target_id, actor_uid, metadata
    FROM compliance_audit_events
    WHERE target_id = ?
  `).get(vector.vector.id);
  assert.deepEqual(
    {
      eventType: vectorAudit.event_type,
      targetType: vectorAudit.target_type,
      targetId: vectorAudit.target_id,
      actorUid: vectorAudit.actor_uid,
      authoringState: JSON.parse(vectorAudit.metadata).authoringState,
    },
    {
      eventType: "calculator.vector_authored",
      targetType: "calculator_test_vector",
      targetId: vector.vector.id,
      actorUid: "reviewer-1",
      authoringState: "pending_review",
    },
  );
  assert.throws(
    () => current.database.prepare(`
      UPDATE compliance_calculator_test_vectors
      SET expected_output = '{"value":"9","unit":"VEEC"}'
      WHERE id = ?
    `).run(vector.vector.id),
    /COMPLIANCE_CALCULATOR_VECTOR_IMMUTABLE/,
  );
  assert.throws(
    () => current.database.prepare(`
      UPDATE compliance_calculator_test_vectors
      SET last_result = 'passed',
        last_run_at = '2026-08-02T03:00:00.000Z',
        updated_at = '2026-08-02T03:00:00.000Z'
      WHERE id = ?
    `).run(vector.vector.id),
    /COMPLIANCE_CALCULATOR_VECTOR_NOT_RUN_ONLY/,
  );
});

test("stored calculator and vector corruption fails closed on every read", async () => {
  const corruptedDraft = await fixture();
  const createdDraft = await createDraft(corruptedDraft);
  corruptedDraft.database.exec(`
    DROP TRIGGER compliance_calculator_authoring_receipt_immutable_update;
    UPDATE compliance_calculator_authoring_receipts
    SET specification_sha256 =
      '0000000000000000000000000000000000000000000000000000000000000000'
    WHERE calculator_version_id = '${createdDraft.draft.id}';
  `);
  await assert.rejects(
    () => listCreditexCalculatorDrafts(
      corruptedDraft.d1,
      corruptedDraft.author,
      createdDraft.draft.id,
    ),
    assertAuthoringError("CALCULATOR_STORED_INTEGRITY_FAILED"),
  );

  const corruptedVector = await fixture();
  const createdVectorDraft = await createDraft(corruptedVector);
  const createdVector = await appendCreditexCalculatorVector(
    corruptedVector.d1,
    bucket(),
    corruptedVector.reviewer,
    {
      clientRequestId: "vector-corruption-request",
      calculatorVersionId: createdVectorDraft.draft.id,
      vectorKey: "corruption_case",
      inputs: {
        eligible_units: { value: "5", unit: "count" },
      },
      expected: { value: "10", unit: "VEEC" },
      sourceCitation: "Clause 9, table 2, integrity case",
    },
  );
  corruptedVector.database.exec(`
    DROP TRIGGER compliance_calculator_authored_vector_immutable_update;
    UPDATE compliance_calculator_test_vectors
    SET input_snapshot =
      '{"eligible_units":{"unit":"count","value":"6"}}'
    WHERE id = '${createdVector.vector.id}';
  `);
  await assert.rejects(
    () => listCreditexCalculatorDrafts(
      corruptedVector.d1,
      corruptedVector.author,
      createdVectorDraft.draft.id,
    ),
    assertAuthoringError("CALCULATOR_STORED_INTEGRITY_FAILED"),
  );
});

test("vectors reject caller status, receipts, numeric decimals and wrong units", async () => {
  const current = await fixture();
  const created = await createDraft(current);
  const base = {
    clientRequestId: "vector-request-0002",
    calculatorVersionId: created.draft.id,
    vectorKey: "one_unit",
    inputs: {
      eligible_units: { value: "1", unit: "count" },
    },
    expected: { value: "2", unit: "VEEC" },
    sourceCitation: "Clause 9, table 2",
  };
  await assert.rejects(
    () => appendCreditexCalculatorVector(
      current.d1,
      bucket(),
      current.reviewer,
      { ...base, lastResult: "passed", computedReceipt: { output: "2" } },
    ),
    assertAuthoringError("CALCULATOR_VECTOR_FIELDS_INVALID"),
  );
  await assert.rejects(
    () => appendCreditexCalculatorVector(
      current.d1,
      bucket(),
      current.reviewer,
      {
        ...base,
        clientRequestId: "vector-request-0003",
        inputs: { eligible_units: { value: 1, unit: "count" } },
      },
    ),
    assertAuthoringError("CALCULATOR_VECTOR_CONTRACT_INVALID"),
  );
  await assert.rejects(
    () => appendCreditexCalculatorVector(
      current.d1,
      bucket(),
      current.reviewer,
      {
        ...base,
        clientRequestId: "vector-request-0004",
        expected: { value: "2", unit: "STC" },
      },
    ),
    assertAuthoringError("CALCULATOR_VECTOR_CONTRACT_INVALID"),
  );
});

test("protected route exposes draft and vector authoring only", () => {
  assert.match(routeSource, /sameOrigin\(request\)/);
  assert.match(routeSource, /allowedRoles: \["admin", "reviewer"\]/);
  assert.match(routeSource, /Cache-Control": "private, no-store"/);
  assert.match(routeSource, /X-Content-Type-Options": "nosniff"/);
  assert.match(routeSource, /action === "create_draft"/);
  assert.match(routeSource, /action === "append_vector"/);
  assert.match(routeSource, /request\.body\.getReader\(\)/);
  assert.match(routeSource, /byteLength > maximumBytes/);
  assert.match(routeSource, /reader\.cancel\(\)/);
  assert.doesNotMatch(routeSource, /request\.text\(\)/);
  assert.doesNotMatch(routeSource, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(routeSource, /evaluateCreditexCalculator/);
  assert.doesNotMatch(routeSource, /approvalState\s*=/);
  assert.match(
    authoringMigration,
    /lower\(substr\(`engine_contract_hash`, 8\)\)[\s\S]*NOT GLOB '\*\[\^0-9a-f\]\*'/,
  );
});
