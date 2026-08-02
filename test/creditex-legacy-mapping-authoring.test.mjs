import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createCreditexLegacyMappingDraft,
  listCreditexLegacyMappingAuthoring,
  requireCurrentApprovedCreditexLegacyMapping,
  reviewCreditexLegacyMappingArtifact,
} from "../src/lib/creditex-legacy-mapping-authoring-server.ts";

const baseMigration = fs.readFileSync(
  new URL(
    "../drizzle/0105_creditex_parallel_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);
const authoringMigration = fs.readFileSync(
  new URL(
    "../drizzle/0109_creditex_legacy_mapping_authoring.sql",
    import.meta.url,
  ),
  "utf8",
);
const route = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/legacy-mappings/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const serviceSource = fs.readFileSync(
  new URL(
    "../src/lib/creditex-legacy-mapping-authoring-server.ts",
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
        'org-1', 'author-1', 'admin', 'active', 1, 'owner-1',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Mapping Author', 'author@example.com'
      ),
      (
        'org-1', 'reviewer-1', 'reviewer', 'active', 1, 'owner-1',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Mapping Reviewer', 'reviewer@example.com'
      ),
      (
        'org-1', 'bootstrap-1', 'admin', 'active', 1, 'owner-1',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Shared mailbox', 'info@ausenergyassessments.com'
      ),
      (
        'org-1', 'unverified-1', 'admin', 'active', 0, '', '', '',
        'Unverified Admin', 'unverified@example.com'
      ),
      (
        'org-2', 'reviewer-2', 'reviewer', 'active', 1, 'owner-1',
        '2026-08-01T00:00:00.000Z', 'identity checked',
        'Other Organisation Reviewer', 'other@example.com'
      );
  `);
  database.exec(baseMigration);
  database.exec(authoringMigration);
  return {
    database,
    d1: testD1(database),
    author: {
      uid: "author-1",
      organisationId: "org-1",
      role: "admin",
      governanceIdentityVerified: true,
      email: "author@example.com",
      displayName: "Mapping Author",
    },
    reviewer: {
      uid: "reviewer-1",
      organisationId: "org-1",
      role: "reviewer",
      governanceIdentityVerified: true,
      email: "reviewer@example.com",
      displayName: "Mapping Reviewer",
    },
  };
}

function mapping(fields = [
  {
    sourceFieldKey: "job_id",
    targetField: "workOrder.workNumber",
    transform: "trim",
    required: true,
  },
  {
    sourceFieldKey: "app_id",
    targetField: "appointment.externalId",
    transform: "identity",
    required: false,
  },
]) {
  return {
    sourceContract: "dataforce-jobs-v1",
    targetContract: "tlink-legacy-job-binding-v1",
    fields,
  };
}

test("draft creation is canonical, server-hashed and exact-version unique", async () => {
  const { database, d1, author } = fixture();
  const first = await createCreditexLegacyMappingDraft(
    d1,
    author,
    {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "certificate-quantity-v1",
      mapping: mapping(),
    },
    { now: "2026-08-02T01:00:00.000Z" },
  );
  const reordered = await createCreditexLegacyMappingDraft(
    d1,
    author,
    {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "certificate-quantity-v2",
      mapping: {
        fields: [...mapping().fields].reverse().map((field) => ({
          required: field.required,
          transform: field.transform,
          targetField: field.targetField,
          sourceFieldKey: field.sourceFieldKey,
        })),
        targetContract: "tlink-legacy-job-binding-v1",
        sourceContract: "dataforce-jobs-v1",
      },
    },
    { now: "2026-08-02T01:01:00.000Z" },
  );
  assert.equal(
    first.artifact.artifactSha256,
    reordered.artifact.artifactSha256,
  );
  assert.deepEqual(
    first.artifact.canonicalMapping,
    reordered.artifact.canonicalMapping,
  );
  assert.deepEqual(
    first.artifact.canonicalMapping.fields.map((field) => ({
      sourceFieldKey: field.sourceFieldKey,
      sourceField: field.sourceField,
    })),
    [
      { sourceFieldKey: "app_id", sourceField: "App Id" },
      { sourceFieldKey: "job_id", sourceField: "Job Id" },
    ],
  );
  assert.match(first.artifact.artifactSha256, /^[0-9a-f]{64}$/);
  const stored = database.prepare(`SELECT
      artifact.authorization_state,
      payload.canonical_mapping_json,
      payload.artifact_sha256
    FROM compliance_legacy_mapping_artifacts artifact
    JOIN compliance_legacy_mapping_artifact_payloads payload
      ON payload.artifact_id = artifact.id
    WHERE artifact.id = ?`).get(first.artifact.id);
  assert.equal(stored.authorization_state, "draft");
  assert.equal(stored.artifact_sha256, first.artifact.artifactSha256);
  assert.deepEqual(
    Object.keys(JSON.parse(stored.canonical_mapping_json)).sort(),
    ["contractFormat", "fields", "sourceContract", "targetContract"],
  );
  await assert.rejects(
    createCreditexLegacyMappingDraft(d1, author, {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "certificate-quantity-v1",
      mapping: mapping(),
    }),
    (error) => error.code === "LEGACY_MAPPING_VERSION_EXISTS",
  );
  await assert.rejects(
    createCreditexLegacyMappingDraft(d1, author, {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "caller-hash-v1",
      artifactSha256: "0".repeat(64),
      mapping: mapping(),
    }),
    (error) => error.code === "LEGACY_MAPPING_CALLER_HASH_FORBIDDEN",
  );
  await assert.rejects(
    createCreditexLegacyMappingDraft(d1, author, {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "private-row-v1",
      mapping: {
        ...mapping(),
        rows: [{ Customer: "must never be retained" }],
      },
    }),
    (error) => error.code === "LEGACY_MAPPING_CONTRACT_INVALID",
  );
});

test("contracts contain only controlled identifiers and exact Dataforce headers", async () => {
  const { d1, author } = fixture();
  const invalidCases = [
    {
      version: "human-source-contract-v1",
      mapping: {
        ...mapping(),
        sourceContract: "Customer Name",
      },
      code: "LEGACY_MAPPING_SOURCE_CONTRACT_INVALID",
    },
    {
      version: "unknown-source-contract-v1",
      mapping: {
        ...mapping(),
        sourceContract: "dataforce-jobs-v2",
      },
      code: "LEGACY_MAPPING_SOURCE_CONTRACT_UNSUPPORTED",
    },
    {
      version: "unknown-target-contract-v1",
      mapping: {
        ...mapping(),
        targetContract: "customer-name",
      },
      code: "LEGACY_MAPPING_TARGET_CONTRACT_UNSUPPORTED",
    },
    {
      version: "row-value-source-v1",
      mapping: mapping([{
        sourceFieldKey: "synthetic_customer_value",
        targetField: "customer.displayName",
        transform: "trim",
        required: true,
      }]),
      code: "LEGACY_MAPPING_FIELD_INVALID",
    },
    {
      version: "unknown-target-field-v1",
      mapping: mapping([{
        sourceFieldKey: "customer",
        targetField: "customer.actualCustomerName",
        transform: "trim",
        required: true,
      }]),
      code: "LEGACY_MAPPING_FIELD_INVALID",
    },
    {
      version: "caller-source-header-v1",
      mapping: mapping([{
        sourceFieldKey: "job_id",
        sourceField: "Job Id",
        targetField: "workOrder.workNumber",
        transform: "trim",
        required: true,
      }]),
      code: "LEGACY_MAPPING_FIELD_INVALID",
    },
    {
      version: "example-row-value-v1",
      mapping: mapping([{
        sourceFieldKey: "customer",
        targetField: "customer.displayName",
        transform: "trim",
        required: true,
        exampleValue: "[TEST] Synthetic Customer",
      }]),
      code: "LEGACY_MAPPING_FIELD_INVALID",
    },
  ];
  for (const invalid of invalidCases) {
    await assert.rejects(
      createCreditexLegacyMappingDraft(d1, author, {
        legacySystemKey: "dataforce-jobs-v1",
        mappingVersion: invalid.version,
        mapping: invalid.mapping,
      }),
      (error) => error.code === invalid.code,
    );
  }
});

test("lazy guard installation fails closed over any preseeded authoring row", async () => {
  const { database, d1, author } = fixture();
  const artifactId = "preseeded-corrupt-mapping";
  const artifactSha256 = "0".repeat(64);
  const canonicalMappingJson = JSON.stringify({
    contractFormat: "creditex-legacy-field-mapping-v1",
    fields: [],
    sourceContract: "dataforce-jobs-v1",
    targetContract: "tlink-legacy-job-binding-v1",
  });
  database.prepare(`INSERT INTO compliance_legacy_mapping_artifacts (
      id, organisation_id, legacy_system_key, mapping_version,
      artifact_format, object_key, artifact_sha256, authorization_state,
      authorization_basis, requested_by_uid, primary_authorizer_uid,
      secondary_authorizer_uid, authorized_at, withdrawn_by_uid,
      withdrawn_at, created_at
    ) VALUES (
      ?, 'org-1', 'dataforce-jobs-v1', 'preseeded-v1', 'json', ?, ?,
      'draft', '', 'author-1', '', '', '', '', '',
      '2026-08-02T01:00:00.000Z'
    )`).run(
    artifactId,
    `d1:compliance_legacy_mapping_artifact_payloads:${artifactId}`,
    artifactSha256,
  );
  database.prepare(`INSERT INTO
      compliance_legacy_mapping_artifact_payloads (
        artifact_id, organisation_id, legacy_system_key, mapping_version,
        contract_format, canonical_mapping_json, artifact_sha256,
        created_by_uid, created_at
      ) VALUES (
        ?, 'org-1', 'dataforce-jobs-v1', 'preseeded-v1',
        'creditex-legacy-field-mapping-v1', ?, ?, 'author-1',
        '2026-08-02T01:00:00.000Z'
      )`).run(artifactId, canonicalMappingJson, artifactSha256);
  await assert.rejects(
    listCreditexLegacyMappingAuthoring(d1, author),
    (error) => (
      error.message === "CREDITEX_LEGACY_MAPPING_PRESEED_ROWS_BLOCKED"
    ),
  );
});

test("only named verified non-bootstrap administrators or reviewers can author", async () => {
  const { database, d1, author } = fixture();
  for (const actor of [
    {
      ...author,
      uid: "bootstrap-1",
      email: "info@ausenergyassessments.com",
      displayName: "Shared mailbox",
    },
    {
      ...author,
      uid: "unverified-1",
      email: "unverified@example.com",
      governanceIdentityVerified: false,
    },
    {
      ...author,
      role: "auditor",
    },
  ]) {
    await assert.rejects(
      createCreditexLegacyMappingDraft(d1, actor, {
        legacySystemKey: "dataforce-jobs-v1",
        mappingVersion: `blocked-${actor.uid || actor.role}`,
        mapping: mapping(),
      }),
      (error) => (
        error.code === "LEGACY_MAPPING_NAMED_VERIFIED_MEMBER_REQUIRED"
      ),
    );
  }
  await listCreditexLegacyMappingAuthoring(d1, author);
  assert.throws(
    () => database.prepare(`INSERT INTO
      compliance_legacy_mapping_artifacts (
        id, organisation_id, legacy_system_key, mapping_version,
        artifact_format, object_key, artifact_sha256, authorization_state,
        authorization_basis, requested_by_uid, primary_authorizer_uid,
        secondary_authorizer_uid, authorized_at, withdrawn_by_uid,
        withdrawn_at, created_at
      ) VALUES (
        'direct-bootstrap', 'org-1', 'dataforce-jobs-v1', 'direct-v1',
        'json',
        'd1:compliance_legacy_mapping_artifact_payloads:direct-bootstrap',
        '${"0".repeat(64)}', 'draft', '', 'bootstrap-1', '', '', '', '', '',
        '2026-08-02T01:00:00.000Z'
      )`).run(),
    /COMPLIANCE_LEGACY_MAPPING_NAMED_AUTHOR_REQUIRED/,
  );
});

test("independent decisions are append-only and withdrawal fails current approval closed", async () => {
  const { database, d1, author, reviewer } = fixture();
  const created = await createCreditexLegacyMappingDraft(
    d1,
    author,
    {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "review-v1",
      mapping: mapping(),
    },
    { now: "2026-08-02T02:00:00.000Z" },
  );
  await assert.rejects(
    reviewCreditexLegacyMappingArtifact(d1, author, {
      artifactId: created.artifact.id,
      decision: "approved",
      reviewNote: "Self review must fail.",
    }),
    (error) => error.code === "LEGACY_MAPPING_REVIEW_INDEPENDENCE_REQUIRED",
  );
  await assert.rejects(
    reviewCreditexLegacyMappingArtifact(
      d1,
      { ...reviewer, organisationId: "org-2", uid: "reviewer-2" },
      {
        artifactId: created.artifact.id,
        decision: "approved",
        reviewNote: "Cross-organisation review must fail.",
      },
    ),
    (error) => error.code === "LEGACY_MAPPING_ARTIFACT_NOT_FOUND",
  );
  const approved = await reviewCreditexLegacyMappingArtifact(
    d1,
    reviewer,
    {
      artifactId: created.artifact.id,
      decision: "approved",
      reviewNote: "Exact canonical field contract reviewed.",
    },
    { now: "2026-08-02T02:01:00.100Z" },
  );
  assert.equal(approved.decision.artifactSha256, created.artifact.artifactSha256);
  const current = await requireCurrentApprovedCreditexLegacyMapping(
    d1,
    reviewer,
    created.artifact.id,
  );
  assert.equal(current.artifact.id, created.artifact.id);
  await assert.rejects(
    reviewCreditexLegacyMappingArtifact(d1, reviewer, {
      artifactId: created.artifact.id,
      decision: "approved",
      reviewNote: "A second approval must fail.",
    }),
    (error) => error.code === "LEGACY_MAPPING_ALREADY_DECIDED",
  );
  await assert.rejects(
    reviewCreditexLegacyMappingArtifact(
      d1,
      reviewer,
      {
        artifactId: created.artifact.id,
        decision: "withdrawn",
        reviewNote: "An identical timestamp must not supersede approval.",
      },
      { now: "2026-08-02T02:01:00.100Z" },
    ),
    (error) => error.code === "LEGACY_MAPPING_REVIEW_TIME_INVALID",
  );
  const withdrawn = await reviewCreditexLegacyMappingArtifact(
    d1,
    reviewer,
    {
      artifactId: created.artifact.id,
      decision: "withdrawn",
      reviewNote: "Approval withdrawn after contract review.",
    },
    { now: "2026-08-02T02:01:00.200Z" },
  );
  assert.equal(
    withdrawn.decision.supersedesDecisionId,
    approved.decision.id,
  );
  await assert.rejects(
    requireCurrentApprovedCreditexLegacyMapping(
      d1,
      reviewer,
      created.artifact.id,
    ),
    (error) => error.code === "LEGACY_MAPPING_CURRENT_APPROVAL_REQUIRED",
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_legacy_mapping_review_decisions
      WHERE artifact_id = ?`).get(created.artifact.id).count,
    2,
  );
  assert.throws(
    () => database.prepare(`UPDATE
      compliance_legacy_mapping_artifact_payloads
      SET canonical_mapping_json = '{}'`).run(),
    /COMPLIANCE_LEGACY_MAPPING_PAYLOAD_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_legacy_mapping_review_decisions
      SET review_note = 'changed'`).run(),
    /COMPLIANCE_LEGACY_MAPPING_REVIEW_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM
      compliance_legacy_mapping_review_decisions`).run(),
    /COMPLIANCE_LEGACY_MAPPING_REVIEW_DELETE_FORBIDDEN/,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_audit_events
      WHERE event_type LIKE 'legacy_mapping.%'`).get().count,
    3,
  );
});

test("review and current approval revalidate canonical bytes and both stored hashes", async () => {
  {
    const { database, d1, author, reviewer } = fixture();
    const created = await createCreditexLegacyMappingDraft(
      d1,
      author,
      {
        legacySystemKey: "dataforce-jobs-v1",
        mappingVersion: "corrupt-payload-v1",
        mapping: mapping(),
      },
    );
    const changedMapping = structuredClone(
      created.artifact.canonicalMapping,
    );
    changedMapping.fields[0].required = !changedMapping.fields[0].required;
    database.exec(
      "DROP TRIGGER compliance_legacy_mapping_payload_immutable",
    );
    database.prepare(`UPDATE compliance_legacy_mapping_artifact_payloads
      SET canonical_mapping_json = ?
      WHERE artifact_id = ?`).run(
      JSON.stringify(changedMapping),
      created.artifact.id,
    );
    await assert.rejects(
      reviewCreditexLegacyMappingArtifact(d1, reviewer, {
        artifactId: created.artifact.id,
        decision: "approved",
        reviewNote: "Corrupt bytes must not be reviewable.",
      }),
      (error) => error.code === "LEGACY_MAPPING_STORED_HASH_MISMATCH",
    );
  }
  {
    const { database, d1, author, reviewer } = fixture();
    const created = await createCreditexLegacyMappingDraft(
      d1,
      author,
      {
        legacySystemKey: "dataforce-jobs-v1",
        mappingVersion: "corrupt-hash-v1",
        mapping: mapping(),
      },
    );
    await reviewCreditexLegacyMappingArtifact(
      d1,
      reviewer,
      {
        artifactId: created.artifact.id,
        decision: "approved",
        reviewNote: "Valid mapping approved before corruption simulation.",
      },
      { now: "2026-08-02T03:00:00.100Z" },
    );
    database.exec(
      "DROP TRIGGER compliance_legacy_mapping_payload_immutable",
    );
    database.prepare(`UPDATE compliance_legacy_mapping_artifact_payloads
      SET artifact_sha256 = ?
      WHERE artifact_id = ?`).run(
      "0".repeat(64),
      created.artifact.id,
    );
    await assert.rejects(
      requireCurrentApprovedCreditexLegacyMapping(
        d1,
        reviewer,
        created.artifact.id,
      ),
      (error) => error.code === "LEGACY_MAPPING_STORED_HASH_MISMATCH",
    );
  }
});

test("rejection is terminal and cannot be treated as a current approval", async () => {
  const { d1, author, reviewer } = fixture();
  const created = await createCreditexLegacyMappingDraft(
    d1,
    author,
    {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "rejected-v1",
      mapping: mapping(),
    },
  );
  await reviewCreditexLegacyMappingArtifact(d1, reviewer, {
    artifactId: created.artifact.id,
    decision: "rejected",
    reviewNote: "The declarative field contract is incomplete.",
  });
  await assert.rejects(
    requireCurrentApprovedCreditexLegacyMapping(
      d1,
      reviewer,
      created.artifact.id,
    ),
    (error) => error.code === "LEGACY_MAPPING_CURRENT_APPROVAL_REQUIRED",
  );
  await assert.rejects(
    reviewCreditexLegacyMappingArtifact(d1, reviewer, {
      artifactId: created.artifact.id,
      decision: "withdrawn",
      reviewNote: "A rejection cannot be withdrawn as an approval.",
    }),
    (error) => error.code === "LEGACY_MAPPING_WITHDRAWAL_INVALID",
  );
});

test("listing is owner-scoped with the exact latest decision per selected artifact", async () => {
  const { d1, author, reviewer } = fixture();
  const created = await createCreditexLegacyMappingDraft(
    d1,
    author,
    {
      legacySystemKey: "dataforce-jobs-v1",
      mappingVersion: "listing-v1",
      mapping: mapping(),
    },
  );
  const approved = await reviewCreditexLegacyMappingArtifact(
    d1,
    reviewer,
    {
      artifactId: created.artifact.id,
      decision: "approved",
      reviewNote: "Listing must expose this exact current decision.",
    },
    { now: "2026-08-02T04:00:00.100Z" },
  );
  let own = await listCreditexLegacyMappingAuthoring(d1, reviewer);
  assert.deepEqual(own.artifacts.map((item) => item.id), [
    created.artifact.id,
  ]);
  assert.equal(
    own.artifacts[0].currentDecision.id,
    approved.decision.id,
  );
  assert.equal(own.artifacts[0].currentDecision.decision, "approved");
  const withdrawn = await reviewCreditexLegacyMappingArtifact(
    d1,
    reviewer,
    {
      artifactId: created.artifact.id,
      decision: "withdrawn",
      reviewNote: "Listing must replace approval with this withdrawal.",
    },
    { now: "2026-08-02T04:00:00.200Z" },
  );
  own = await listCreditexLegacyMappingAuthoring(d1, reviewer);
  assert.equal(
    own.artifacts[0].currentDecision.id,
    withdrawn.decision.id,
  );
  assert.equal(own.artifacts[0].currentDecision.decision, "withdrawn");
  const other = await listCreditexLegacyMappingAuthoring(
    d1,
    {
      ...reviewer,
      organisationId: "org-2",
      uid: "reviewer-2",
      email: "other@example.com",
      displayName: "Other Organisation Reviewer",
    },
  );
  assert.deepEqual(other.artifacts, []);
  assert.deepEqual(
    Object.keys(created.artifact).sort(),
    [
      "artifactSha256",
      "canonicalMapping",
      "contractFormat",
      "createdAt",
      "createdByUid",
      "id",
      "legacySystemKey",
      "mappingVersion",
    ],
  );
});

test("API is same-origin, authenticated, no-store and has no external action surface", () => {
  assert.match(route, /if \(!sameOrigin\(request\)\)/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /requireComplianceAccess\(request/);
  assert.match(route, /allowedRoles: \["admin", "reviewer"\]/);
  assert.match(route, /action === "create_draft"/);
  assert.match(route, /action === "record_decision"/);
  assert.match(route, /request\.body\?\.getReader\(\)/);
  assert.match(route, /byteLength > MAXIMUM_REQUEST_BYTES/);
  assert.match(route, /await reader\.cancel\(\)/);
  assert.match(route, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(route, /JSON\.parse\(source\)/);
  assert.doesNotMatch(route, /request\.(?:text|json)\(\)/);
  assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(
    route,
    /parallel-reconciliation|createCreditexParallelReconciliationRun/,
  );
  assert.doesNotMatch(
    serviceSource,
    /createCreditexParallelReconciliationRun|createCreditexCalculatorEngineReceipt/,
  );
  assert.match(
    serviceSource,
    /LEFT JOIN compliance_legacy_mapping_review_decisions current_decision/,
  );
  assert.doesNotMatch(serviceSource, /LIMIT 400/);
  assert.doesNotMatch(authoringMigration, /external_submission|certificate_creation/);
  assert.doesNotMatch(authoringMigration, /CREATE\s+TRIGGER/i);
});
