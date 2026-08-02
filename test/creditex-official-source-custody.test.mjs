import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  captureCreditexOfficialSource,
  isAllowedOfficialGovernmentHost,
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
      status text NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_calculator_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
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
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    ({ name }) => name.startsWith("compliance_official_source_"),
  )) {
    database.exec(guard.sql);
  }
  database.exec(`
    INSERT INTO compliance_users
      (organisation_id, firebase_uid, role, status)
      VALUES ('org-1', 'admin-1', 'admin', 'active');
    INSERT INTO compliance_programs
      (id, organisation_id, publish_state)
      VALUES ('program-1', 'org-1', 'draft');
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
