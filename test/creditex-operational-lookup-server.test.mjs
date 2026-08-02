import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_OPERATIONAL_LOOKUP_LIMITS,
  listCreditexOperationalLookupImports,
  stageCreditexOperationalLookupImport,
} from "../src/lib/creditex-operational-lookup-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
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
const routeSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/operational-lookups/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const serverSource = fs.readFileSync(
  new URL(
    "../src/lib/creditex-operational-lookup-server.ts",
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
      status text NOT NULL
    );
    CREATE TABLE compliance_official_source_artifacts (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      sha256 text NOT NULL,
      custody_state text NOT NULL,
      rule_activation_enabled integer NOT NULL
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
    INSERT INTO compliance_users
      (organisation_id, firebase_uid, role, status)
      VALUES
        ('org-1', 'admin-1', 'admin', 'active'),
        ('org-1', 'reviewer-1', 'reviewer', 'active'),
        ('org-2', 'admin-2', 'admin', 'active');
    INSERT INTO compliance_official_source_artifacts
      (id, organisation_id, sha256, custody_state, rule_activation_enabled)
      VALUES
        (
          'source-1',
          'org-1',
          '${"a".repeat(64)}',
          'pending_review',
          0
        );
  `);
  database.exec(migration);
  database.exec(reviewMigration);
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    ({ name }) => name.startsWith("compliance_operational_lookup_"),
  )) {
    database.exec(guard.sql);
  }
  return {
    database,
    d1: testD1(database),
    admin: {
      uid: "admin-1",
      organisationId: "org-1",
      role: "admin",
    },
  };
}

function input(overrides = {}) {
  return {
    clientRequestId: "lookup-request-0001",
    lookupKind: "product",
    sourceArtifactId: "source-1",
    sourceTimestamp: "2026-08-01T01:02:03.000Z",
    records: [{
      sourceRecordKey: "SOURCE-PRODUCT-001",
      effectiveFrom: "2026-07-21",
      effectiveTo: "",
      sourceStatus: "listed",
      sourceRecord: {
        sourceField: "source value",
        customerEmailThatMustNotEscape: "private.person@example.com",
      },
    }],
    ...overrides,
  };
}

test("official lookup snapshots remain staged, idempotent and PII-minimised", async () => {
  const { database, d1, admin } = fixture();
  const first = await stageCreditexOperationalLookupImport(
    d1,
    admin,
    input(),
    { now: "2026-08-02T01:02:03.000Z" },
  );
  assert.equal(first.importBatch.reused, false);
  assert.equal(first.importBatch.status, "staged_pending");
  assert.equal(first.importBatch.liveVerificationEnabled, false);
  assert.equal(first.importBatch.eligibilityActivationEnabled, false);
  assert.equal(first.importBatch.localAssertionEnabled, false);
  assert.equal(first.importBatch.recordCount, 1);
  assert.doesNotMatch(
    JSON.stringify(first),
    /private\.person@example\.com|source value/,
  );

  const stored = database.prepare(`
    SELECT * FROM compliance_operational_lookup_records
  `).get();
  assert.match(stored.record_json, /private\.person@example\.com/);
  assert.equal(stored.status, "staged_pending");
  assert.equal(stored.live_verification_enabled, 0);
  assert.equal(stored.eligibility_activation_enabled, 0);
  assert.equal(stored.local_assertion_enabled, 0);
  assert.match(stored.record_sha256, /^[0-9a-f]{64}$/);

  const audit = database.prepare(`
    SELECT * FROM compliance_audit_events
  `).get();
  assert.equal(audit.event_type, "operational_lookup.staged_pending");
  assert.doesNotMatch(
    audit.metadata,
    /private\.person@example\.com|source value|SOURCE-PRODUCT-001/,
  );

  const second = await stageCreditexOperationalLookupImport(
    d1,
    admin,
    input(),
    { now: "2026-08-02T02:03:04.000Z" },
  );
  assert.equal(second.importBatch.id, first.importBatch.id);
  assert.equal(second.importBatch.reused, true);
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_operational_lookup_imports
    `).get().count,
    1,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_audit_events
    `).get().count,
    1,
  );

  const listed = await listCreditexOperationalLookupImports(d1, admin);
  assert.equal(listed.length, 1);
  assert.doesNotMatch(
    JSON.stringify(listed),
    /private\.person@example\.com|source value|SOURCE-PRODUCT-001|record_json/,
  );

  await assert.rejects(
    stageCreditexOperationalLookupImport(
      d1,
      admin,
      input({
        records: [{
          ...input().records[0],
          sourceStatus: "different",
        }],
      }),
    ),
    (error) => error.code === "LOOKUP_REQUEST_ID_CONFLICT",
  );
});

test("role, tenant, row and byte bounds fail closed before writes", async () => {
  const { database, d1, admin } = fixture();
  await assert.rejects(
    stageCreditexOperationalLookupImport(
      d1,
      { ...admin, role: "reviewer" },
      input(),
    ),
    (error) => error.code === "LOOKUP_ROLE_REQUIRED" && error.status === 403,
  );
  await assert.rejects(
    stageCreditexOperationalLookupImport(
      d1,
      { uid: "admin-2", organisationId: "org-2", role: "admin" },
      input(),
    ),
    (error) => (
      error.code === "LOOKUP_SOURCE_ARTIFACT_NOT_FOUND"
      && error.status === 409
    ),
  );
  await assert.rejects(
    stageCreditexOperationalLookupImport(
      d1,
      admin,
      input({
        clientRequestId: "lookup-request-many",
        records: Array.from({
          length: CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRecords + 1,
        }, () => input().records[0]),
      }),
    ),
    (error) => (
      error.code === "LOOKUP_RECORD_LIMIT_EXCEEDED"
      && error.status === 413
    ),
  );
  await assert.rejects(
    stageCreditexOperationalLookupImport(
      d1,
      admin,
      input({
        clientRequestId: "lookup-request-large",
        records: [{
          ...input().records[0],
          sourceRecord: {
            value: "x".repeat(
              CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRecordBytes + 1,
            ),
          },
        }],
      }),
    ),
    (error) => (
      error.code === "LOOKUP_RECORD_TOO_LARGE"
      && error.status === 413
    ),
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_operational_lookup_imports
    `).get().count,
    0,
  );
});

test("tenant parent guards and immutable snapshots cannot be bypassed", async () => {
  const { database, d1, admin } = fixture();
  await stageCreditexOperationalLookupImport(d1, admin, input(), {
    now: "2026-08-02T01:02:03.000Z",
  });
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_operational_lookup_imports
      SET status = 'staged_pending'
    `).run(),
    /COMPLIANCE_LOOKUP_IMPORT_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_operational_lookup_records
    `).run(),
    /COMPLIANCE_LOOKUP_RECORD_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO compliance_operational_lookup_records (
        id, organisation_id, import_id, row_number, source_record_key,
        source_effective_from, source_effective_to, source_status,
        record_json, record_sha256, status, live_verification_enabled,
        eligibility_activation_enabled, local_assertion_enabled, created_at
      ) VALUES (
        'cross-tenant-row', 'org-2',
        (SELECT id FROM compliance_operational_lookup_imports LIMIT 1),
        2, 'cross', '2026-01-01', '', 'listed', '{}',
        '${"b".repeat(64)}', 'staged_pending', 0, 0, 0,
        '2026-08-02T01:02:03.000Z'
      )
    `).run(),
    /COMPLIANCE_LOOKUP_RECORD_PARENT_INVALID/,
  );
});

test("lookup API is authenticated, same-origin, no-store and connector-free", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /requireComplianceAccess\(request/);
  assert.match(
    routeSource,
    /allowedRoles: \["admin", "case_manager"\]/,
  );
  assert.match(routeSource, /"stage_import"/);
  assert.match(
    routeSource,
    /materialiseApprovedCreditexOperationalLookup/,
  );
  assert.match(routeSource, /searchParams\.has\("importId"\)/);
  assert.match(routeSource, /searchParams\.has\("asOf"\)/);
  assert.match(routeSource, /return json\(\{ ok: true, snapshot \}\)/);
  assert.doesNotMatch(routeSource, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(`${routeSource}\n${serverSource}`, /\bfetch\s*\(/);
  assert.match(
    migration,
    /`live_verification_enabled` = 0/,
  );
  assert.match(
    migration,
    /`eligibility_activation_enabled` = 0/,
  );
  assert.match(migration, /`local_assertion_enabled` = 0/);
});
