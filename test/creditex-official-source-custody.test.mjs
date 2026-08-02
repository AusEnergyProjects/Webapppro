import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  captureCreditexOfficialSource,
  downloadCreditexOfficialSource,
  isAllowedOfficialGovernmentHost,
  listCreditexOfficialSourceTargets,
  listCreditexOfficialSources,
} from "../src/lib/creditex-official-source-custody-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL(
    "../drizzle/0102_creditex_official_source_custody.sql",
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
  puts = 0;

  async put(key, value, options = {}) {
    this.puts += 1;
    const bytes = new Uint8Array(value.slice(0));
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      size: stored.bytes.byteLength,
      httpMetadata: stored.httpMetadata,
      arrayBuffer: async () => stored.bytes.slice().buffer,
    };
  }

  async head(key) {
    return this.objects.get(key) || null;
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
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
      program_code text NOT NULL,
      name text NOT NULL,
      jurisdiction text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      activity_key text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      registry_activity_code text NOT NULL,
      specification_part text NOT NULL,
      scenario_code text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
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
      approval_state text NOT NULL
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
  database.exec(migration);
  database.exec(reviewMigration);
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    ({ name }) => name.startsWith("compliance_official_source_"),
  )) {
    database.exec(guard.sql);
  }
  database.exec(`
    INSERT INTO compliance_users
      (
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
      )
      VALUES
        (
          'org-1',
          'admin-1',
          'admin',
          'active',
          0,
          '',
          '',
          '',
          'Capture Administrator',
          'capture@example.test'
        ),
        (
          'org-1',
          'reviewer-1',
          'admin',
          'active',
          1,
          'governance-verifier-1',
          '2026-08-01T00:00:00.000Z',
          'Named governance identity verified for test.',
          'Independent Reviewer',
          'reviewer@example.test'
        );
    INSERT INTO compliance_programs
      (id, organisation_id, program_code, name, jurisdiction, publish_state)
      VALUES (
        'program-1',
        'org-1',
        'VEU',
        'Victorian Energy Upgrades',
        'VIC',
        'draft'
      );
  `);
  return {
    database,
    d1: testD1(database),
    bucket: new FakeR2(),
    member: {
      uid: "admin-1",
      organisationId: "org-1",
      role: "admin",
    },
  };
}

function captureInput(overrides = {}) {
  return {
    clientRequestId: "source-request-0001",
    sourceUrl:
      "https://www.energy.vic.gov.au/industry/official-specification.pdf#part-1",
    sourceTitle: "Official specification",
    sourceVersion: "25",
    originalFileName: "official-specification.pdf",
    contentType: "application/pdf",
    assertedRetrievedAt: new Date(Date.now() - 60_000).toISOString(),
    sourceEtag: '"official-v25"',
    sourceLastModified: "Wed, 01 Jul 2026 00:00:00 GMT",
    targetType: "program",
    targetId: "program-1",
    citationLocation: "Part 1, clause 2.3, page 14",
    bytes: new TextEncoder().encode("%PDF-1.7\nsynthetic official bytes"),
    ...overrides,
  };
}

test("official government host allowlist rejects lookalike and commercial domains", () => {
  assert.equal(isAllowedOfficialGovernmentHost("energy.vic.gov.au"), true);
  assert.equal(isAllowedOfficialGovernmentHost("registry.energy.gov.au"), true);
  assert.equal(isAllowedOfficialGovernmentHost("energy.gov.au.example.com"), false);
  assert.equal(isAllowedOfficialGovernmentHost("creditex.com.au"), false);
  assert.equal(isAllowedOfficialGovernmentHost("evilgov.au"), false);
});

test("exact official source bytes are hash-bound in R2 and remain pending review", async () => {
  const { database, d1, bucket, member } = fixture();
  const input = captureInput();
  const result = await captureCreditexOfficialSource(
    d1,
    bucket,
    member,
    input,
  );

  assert.equal(result.reused, false);
  assert.equal(result.artifact.custodyState, "pending_review");
  assert.equal(result.artifact.ruleActivationEnabled, false);
  assert.equal(result.binding.bindingState, "pending_review");
  assert.equal(result.binding.ruleActivationEnabled, false);
  assert.equal(
    result.artifact.sha256,
    createHash("sha256").update(input.bytes).digest("hex"),
  );
  assert.equal(result.artifact.sourceUrl.includes("#"), false);

  const artifact = database.prepare(`
    SELECT * FROM compliance_official_source_artifacts
  `).get();
  const binding = database.prepare(`
    SELECT * FROM compliance_official_source_bindings
  `).get();
  const stored = bucket.objects.get(artifact.object_key);
  assert.deepEqual(stored.bytes, input.bytes);
  assert.equal(artifact.sha256, result.artifact.sha256);
  assert.equal(artifact.size_bytes, input.bytes.byteLength);
  assert.equal(artifact.custody_state, "pending_review");
  assert.equal(artifact.rule_activation_enabled, 0);
  assert.equal(binding.citation_location, input.citationLocation);
  assert.equal(binding.rule_activation_enabled, 0);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_audit_events
      WHERE event_type = 'official_source.captured_for_review'`).get().count,
    1,
  );

  assert.throws(
    () => database.prepare(`UPDATE compliance_official_source_artifacts
      SET source_title = 'changed'`).run(),
    /COMPLIANCE_SOURCE_CUSTODY_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(
      `DELETE FROM compliance_official_source_bindings`,
    ).run(),
    /COMPLIANCE_SOURCE_BINDING_DELETE_FORBIDDEN/,
  );
});

test("source capture is idempotent and does not duplicate R2 or audit records", async () => {
  const { database, d1, bucket, member } = fixture();
  const input = captureInput();
  const first = await captureCreditexOfficialSource(
    d1,
    bucket,
    member,
    input,
  );
  const second = await captureCreditexOfficialSource(
    d1,
    bucket,
    member,
    input,
  );
  assert.equal(second.reused, true);
  assert.equal(second.artifact.id, first.artifact.id);
  assert.equal(bucket.puts, 1);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    1,
  );
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_audit_events",
    ).get().count,
    1,
  );

  await assert.rejects(
    captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput({
        bytes: new TextEncoder().encode("%PDF-1.7\ndifferent exact bytes"),
      }),
    ),
    (error) => error.code === "SOURCE_REQUEST_ID_CONFLICT",
  );
});

test("idempotent replay fails closed when retained bytes are missing or tampered", async () => {
  {
    const { database, d1, bucket, member } = fixture();
    const input = captureInput();
    await captureCreditexOfficialSource(d1, bucket, member, input);
    const artifact = database.prepare(`
      SELECT object_key FROM compliance_official_source_artifacts
    `).get();
    bucket.objects.delete(artifact.object_key);

    await assert.rejects(
      captureCreditexOfficialSource(d1, bucket, member, input),
      (error) => error.code === "SOURCE_OBJECT_NOT_FOUND",
    );
  }

  {
    const { database, d1, bucket, member } = fixture();
    const input = captureInput();
    await captureCreditexOfficialSource(d1, bucket, member, input);
    const artifact = database.prepare(`
      SELECT object_key FROM compliance_official_source_artifacts
    `).get();
    const stored = bucket.objects.get(artifact.object_key);
    stored.bytes = stored.bytes.slice();
    stored.bytes[stored.bytes.length - 1] ^= 1;

    await assert.rejects(
      captureCreditexOfficialSource(d1, bucket, member, input),
      (error) => error.code === "SOURCE_OBJECT_INTEGRITY_FAILED",
    );
  }
});

test("capture rejects non-government sources and non-draft targets before R2 write", async () => {
  const { database, d1, bucket, member } = fixture();
  await assert.rejects(
    captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput({
        sourceUrl: "https://creditex.com.au/source.pdf",
      }),
    ),
    (error) => error.code === "SOURCE_DOMAIN_NOT_ALLOWED",
  );
  assert.equal(bucket.puts, 0);

  database.prepare(`UPDATE compliance_programs
    SET publish_state = 'published' WHERE id = 'program-1'`).run();
  await assert.rejects(
    captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput({ clientRequestId: "source-request-0002" }),
    ),
    (error) => error.code === "SOURCE_DRAFT_TARGET_NOT_FOUND",
  );
  assert.equal(bucket.puts, 0);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    0,
  );
});

test("capture rejects evidence and calculator targets linked to another organisation's program", async () => {
  const { database, d1, bucket, member } = fixture();
  database.exec(`
    INSERT INTO compliance_programs (
      id,
      organisation_id,
      program_code,
      name,
      jurisdiction,
      publish_state
    ) VALUES (
      'program-cross-org',
      'org-2',
      'CROSS',
      'Cross organisation program',
      'NSW',
      'draft'
    );
    INSERT INTO compliance_activity_versions (
      id,
      program_id,
      activity_key,
      version,
      title,
      registry_activity_code,
      specification_part,
      scenario_code,
      publish_state
    ) VALUES (
      'activity-cross-org',
      'program-cross-org',
      'cross-org-activity',
      1,
      'Cross organisation activity',
      '1',
      'Part 1',
      '',
      'draft'
    );
    INSERT INTO compliance_evidence_policy_versions (
      id,
      organisation_id,
      activity_version_id,
      version,
      title,
      publish_state
    ) VALUES (
      'evidence-cross-org',
      'org-1',
      'activity-cross-org',
      1,
      'Inconsistent evidence target',
      'draft'
    );
    INSERT INTO compliance_calculator_versions (
      id,
      organisation_id,
      activity_version_id,
      calculator_key,
      version,
      title,
      output_type,
      approval_state
    ) VALUES (
      'calculator-cross-org',
      'org-1',
      'activity-cross-org',
      'cross-org-calculator',
      1,
      'Inconsistent calculator target',
      'VEEC',
      'draft'
    );
  `);

  for (const [targetType, targetId, clientRequestId] of [
    ["evidence_policy", "evidence-cross-org", "source-request-evidence-cross"],
    ["calculator", "calculator-cross-org", "source-request-calculator-cross"],
  ]) {
    await assert.rejects(
      captureCreditexOfficialSource(
        d1,
        bucket,
        member,
        captureInput({ targetType, targetId, clientRequestId }),
      ),
      (error) => error.code === "SOURCE_DRAFT_TARGET_NOT_FOUND",
    );
  }
  assert.equal(bucket.puts, 0);
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_official_source_artifacts",
    ).get().count,
    0,
  );
});

test("source listing has an explicit empty state and draft targets are owner scoped", async () => {
  const { database, d1, member } = fixture();
  database.exec(`
    INSERT INTO compliance_activity_versions (
      id,
      program_id,
      activity_key,
      version,
      title,
      registry_activity_code,
      specification_part,
      scenario_code,
      publish_state
    ) VALUES
      (
        'activity-1',
        'program-1',
        'water-heating',
        2,
        'Water heating',
        '1',
        'Part 1',
        '1A',
        'draft'
      ),
      (
        'activity-published',
        'program-1',
        'published-activity',
        1,
        'Published activity',
        '99',
        'Part 99',
        '',
        'published'
      );
    INSERT INTO compliance_evidence_policy_versions (
      id,
      organisation_id,
      activity_version_id,
      version,
      title,
      publish_state
    ) VALUES (
      'evidence-policy-1',
      'org-1',
      'activity-1',
      3,
      'Installation evidence',
      'draft'
    );
    INSERT INTO compliance_calculator_versions (
      id,
      organisation_id,
      activity_version_id,
      calculator_key,
      version,
      title,
      output_type,
      approval_state
    ) VALUES (
      'calculator-1',
      'org-1',
      'activity-1',
      'veu-water-heating',
      4,
      'VEEC calculator',
      'VEEC',
      'draft'
    );
    INSERT INTO compliance_programs (
      id,
      organisation_id,
      program_code,
      name,
      jurisdiction,
      publish_state
    ) VALUES
      (
        'program-other',
        'org-2',
        'OTHER',
        'Other organisation program',
        'NSW',
        'draft'
      ),
      (
        'program-published',
        'org-1',
        'OLD',
        'Published program',
        'VIC',
        'published'
      );
    INSERT INTO compliance_activity_versions (
      id,
      program_id,
      activity_key,
      version,
      title,
      registry_activity_code,
      specification_part,
      scenario_code,
      publish_state
    ) VALUES (
      'activity-other',
      'program-other',
      'other-activity',
      1,
      'Other organisation activity',
      '1',
      'Part 1',
      '',
      'draft'
    );
    INSERT INTO compliance_evidence_policy_versions (
      id,
      organisation_id,
      activity_version_id,
      version,
      title,
      publish_state
    ) VALUES (
      'evidence-policy-cross-org',
      'org-1',
      'activity-other',
      1,
      'Cross organisation evidence',
      'draft'
    );
  `);

  assert.deepEqual(
    (await listCreditexOfficialSources(d1, member)).items,
    [],
  );
  const targets = await listCreditexOfficialSourceTargets(d1, member);
  assert.deepEqual(
    targets.map(({ id }) => id).sort(),
    [
      "activity-1",
      "calculator-1",
      "evidence-policy-1",
      "program-1",
    ],
  );
  assert.equal(targets.every(({ state }) => state === "draft"), true);
  assert.match(
    targets.find(({ id }) => id === "program-1").label,
    /VIC \| VEU \| Victorian Energy Upgrades/,
  );
  assert.match(
    targets.find(({ id }) => id === "activity-1").label,
    /VEU \| Victorian Energy Upgrades \| 1 \| Water heating \| Scenario 1A \| v2/,
  );
  assert.equal(
    targets.some(({ label }) => label.includes("Other organisation")),
    false,
  );
});

test("source listing projects current artifact and binding decisions without custody keys", async () => {
  const { database, d1, bucket, member } = fixture();
  const captured = await captureCreditexOfficialSource(
    d1,
    bucket,
    member,
    captureInput(),
  );
  const artifact = database.prepare(`
    SELECT * FROM compliance_official_source_artifacts
  `).get();
  const binding = database.prepare(`
    SELECT * FROM compliance_official_source_bindings
  `).get();
  const [unreviewed] = (
    await listCreditexOfficialSources(d1, member)
  ).items;
  assert.equal(unreviewed.artifactReview, null);
  assert.equal(unreviewed.bindingReview, null);
  assert.deepEqual(
    await listCreditexOfficialSources(
      d1,
      {
        uid: "other-admin",
        organisationId: "org-2",
        role: "admin",
      },
    ),
    {
      items: [],
      total: 0,
      pageSize: 50,
      hasNext: false,
      nextCursor: null,
    },
  );
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id,
      organisation_id,
      subject_type,
      subject_id,
      artifact_id,
      artifact_sha256,
      artifact_object_key,
      binding_target_type,
      binding_target_id,
      citation_location,
      decision,
      supersedes_decision_id,
      review_note,
      reviewed_by_uid,
      reviewed_at
    ) VALUES (
      'artifact-review-1',
      'org-1',
      'artifact',
      ?,
      ?,
      ?,
      ?,
      '',
      '',
      '',
      'approved',
      '',
      'Exact retained source reviewed.',
      'reviewer-1',
      '2026-08-02T00:00:00.000Z'
    )`)
    .run(artifact.id, artifact.id, artifact.sha256, artifact.object_key);
  database.prepare(`INSERT INTO compliance_official_source_review_decisions (
      id,
      organisation_id,
      subject_type,
      subject_id,
      artifact_id,
      artifact_sha256,
      artifact_object_key,
      binding_target_type,
      binding_target_id,
      citation_location,
      decision,
      supersedes_decision_id,
      review_note,
      reviewed_by_uid,
      reviewed_at
    ) VALUES (
      'binding-review-1',
      'org-1',
      'binding',
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      'approved',
      '',
      'Draft target citation reviewed.',
      'reviewer-1',
      '2026-08-02T00:01:00.000Z'
    )`)
    .run(
      binding.id,
      artifact.id,
      artifact.sha256,
      artifact.object_key,
      binding.target_type,
      binding.target_id,
      binding.citation_location,
    );

  const [listed] = (
    await listCreditexOfficialSources(d1, member)
  ).items;
  assert.equal(listed.artifact.id, captured.artifact.id);
  assert.deepEqual(
    {
      decision: listed.artifactReview.decision,
      reviewedByUid: listed.artifactReview.reviewedByUid,
      reviewedAt: listed.artifactReview.reviewedAt,
    },
    {
      decision: "approved",
      reviewedByUid: "reviewer-1",
      reviewedAt: "2026-08-02T00:00:00.000Z",
    },
  );
  assert.equal(listed.bindingReview.decision, "approved");
  assert.equal(JSON.stringify(listed).includes(artifact.object_key), false);
});

test("source listing uses owner-scoped deterministic cursor pagination with an authoritative total", async () => {
  const { d1, bucket, member } = fixture();
  const capturedIds = [];
  for (const suffix of ["0001", "0002", "0003"]) {
    const captured = await captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput({
        clientRequestId: `source-request-page-${suffix}`,
      }),
    );
    capturedIds.push(captured.artifact.id);
  }

  const first = await listCreditexOfficialSources(d1, member, {
    pageSize: 2,
  });
  assert.equal(first.total, 3);
  assert.equal(first.pageSize, 2);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasNext, true);
  assert.equal(typeof first.nextCursor, "string");

  const second = await listCreditexOfficialSources(d1, member, {
    pageSize: 2,
    cursor: first.nextCursor,
  });
  assert.equal(second.total, 3);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasNext, false);
  assert.equal(second.nextCursor, null);
  const listedIds = [...first.items, ...second.items]
    .map(({ artifact }) => artifact.id);
  assert.equal(new Set(listedIds).size, 3);
  assert.deepEqual(listedIds.slice().sort(), capturedIds.slice().sort());

  await assert.rejects(
    listCreditexOfficialSources(d1, member, { cursor: "not-a-cursor" }),
    (error) => error.code === "SOURCE_CURSOR_INVALID",
  );
  await assert.rejects(
    listCreditexOfficialSources(d1, member, { pageSize: 101 }),
    (error) => error.code === "SOURCE_PAGE_SIZE_INVALID",
  );
});

test("retained source download verifies exact bytes and writes a private audit receipt", async () => {
  const { database, d1, bucket, member } = fixture();
  const input = captureInput();
  const captured = await captureCreditexOfficialSource(
    d1,
    bucket,
    member,
    input,
  );
  const result = await downloadCreditexOfficialSource(
    d1,
    bucket,
    { ...member, role: "reviewer" },
    captured.artifact.id,
  );

  assert.deepEqual(new Uint8Array(result.bytes), input.bytes);
  assert.equal(result.fileName, input.originalFileName);
  assert.equal(result.contentType, input.contentType);
  assert.equal(result.sha256, captured.artifact.sha256);
  const receipt = database.prepare(`SELECT *
    FROM compliance_audit_events
    WHERE id = ?`).get(result.receiptId);
  assert.equal(
    receipt.event_type,
    "official_source.retained_bytes_accessed",
  );
  assert.equal(receipt.target_id, captured.artifact.id);
  assert.equal(receipt.metadata.includes("object_key"), false);
  assert.equal(receipt.metadata.includes("official-sources/"), false);
  assert.equal(JSON.parse(receipt.metadata).accessRole, "reviewer");
});

test("retained source download fails closed for missing, tampered and cross-organisation artifacts", async () => {
  {
    const { database, d1, bucket, member } = fixture();
    const captured = await captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput(),
    );
    const artifact = database.prepare(`
      SELECT * FROM compliance_official_source_artifacts
    `).get();
    bucket.objects.delete(artifact.object_key);
    await assert.rejects(
      downloadCreditexOfficialSource(d1, bucket, member, captured.artifact.id),
      (error) => error.code === "SOURCE_OBJECT_NOT_FOUND",
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) count
        FROM compliance_audit_events
        WHERE event_type = 'official_source.retained_bytes_accessed'`)
        .get().count,
      0,
    );
  }

  {
    const { database, d1, bucket, member } = fixture();
    const captured = await captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput(),
    );
    const artifact = database.prepare(`
      SELECT * FROM compliance_official_source_artifacts
    `).get();
    const stored = bucket.objects.get(artifact.object_key);
    stored.bytes = stored.bytes.slice();
    stored.bytes[stored.bytes.length - 1] ^= 1;
    await assert.rejects(
      downloadCreditexOfficialSource(d1, bucket, member, captured.artifact.id),
      (error) => error.code === "SOURCE_OBJECT_INTEGRITY_FAILED",
    );
    assert.equal(
      database.prepare(`SELECT COUNT(*) count
        FROM compliance_audit_events
        WHERE event_type = 'official_source.retained_bytes_accessed'`)
        .get().count,
      0,
    );
  }

  {
    const { d1, bucket, member } = fixture();
    const captured = await captureCreditexOfficialSource(
      d1,
      bucket,
      member,
      captureInput(),
    );
    await assert.rejects(
      downloadCreditexOfficialSource(
        d1,
        bucket,
        { uid: "other-admin", organisationId: "org-2", role: "admin" },
        captured.artifact.id,
      ),
      (error) => error.code === "SOURCE_ARTIFACT_NOT_FOUND",
    );
  }
});

test("official source APIs expose governed list and verified download contracts", () => {
  const collectionRoute = fs.readFileSync(
    new URL(
      "../src/app/api/creditex/official-sources/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const downloadRoute = fs.readFileSync(
    new URL(
      "../src/app/api/creditex/official-sources/[id]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(collectionRoute, /sources:\s*sourcePage\.items/);
  assert.match(collectionRoute, /sourcePagination:/);
  assert.match(collectionRoute, /search\.get\("cursor"\)/);
  assert.match(collectionRoute, /search\.get\("pageSize"\)/);
  assert.match(
    downloadRoute,
    /allowedRoles:\s*\["admin", "case_manager", "reviewer", "auditor"\]/,
  );
  assert.match(downloadRoute, /sameOrigin\(request\)/);
  assert.match(downloadRoute, /downloadCreditexOfficialSource/);
  assert.match(downloadRoute, /Content-Disposition/);
  assert.match(downloadRoute, /private, no-store/);
  assert.match(downloadRoute, /X-Content-Type-Options/);
  assert.doesNotMatch(downloadRoute, /object_key|objectKey/);
});
