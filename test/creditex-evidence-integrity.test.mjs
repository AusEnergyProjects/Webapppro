import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  listCreditexEvidenceIntegrityReceipts,
  verifyCreditexEvidenceIntegrity,
} from "../src/lib/creditex-evidence-integrity-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL(
    "../drizzle/0103_creditex_evidence_integrity_receipts.sql",
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
  unavailable = false;

  set(key, bytes, contentType = "image/jpeg") {
    this.objects.set(key, {
      bytes: Uint8Array.from(bytes),
      contentType,
    });
  }

  async put(key, value, options = {}) {
    this.set(
      key,
      new Uint8Array(value),
      options.httpMetadata?.contentType || "",
    );
  }

  async get(key) {
    if (this.unavailable) throw new Error("synthetic R2 outage");
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      size: stored.bytes.byteLength,
      httpMetadata: { contentType: stored.contentType },
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

const originalBytes = Uint8Array.from([1, 2, 3, 4, 5]);
const originalSha256 = createHash("sha256")
  .update(originalBytes)
  .digest("hex");

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL
    );
    CREATE TABLE compliance_case_evidence (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      object_key text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      original_sha256 text NOT NULL,
      evidence_envelope text NOT NULL
    );
    CREATE TABLE compliance_case_assignments (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      compliance_user_id text NOT NULL,
      assignment_role text NOT NULL,
      status text NOT NULL
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
    ({ name }) => name.startsWith(
      "compliance_evidence_integrity_receipts_",
    ),
  )) {
    database.exec(guard.sql);
  }
  database.prepare(`
    INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, role, status)
      VALUES (?, 'org-1', ?, ?, 'active')
  `).run("member-admin", "admin-1", "admin");
  database.prepare(`
    INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, role, status)
      VALUES (?, 'org-1', ?, ?, 'active')
  `).run("member-reviewer", "reviewer-1", "reviewer");
  database.exec(`
    INSERT INTO compliance_cases (id, organisation_id)
      VALUES ('case-1', 'org-1');
  `);
  database.prepare(`
    INSERT INTO compliance_case_evidence (
      id, organisation_id, case_id, object_key, content_type,
      size_bytes, original_sha256, evidence_envelope
    ) VALUES (
      'evidence-1', 'org-1', 'case-1', 'private/evidence-1',
      'image/jpeg', ?, ?, '{"schemaVersion":"test"}'
    )
  `).run(originalBytes.byteLength, originalSha256);
  const bucket = new FakeR2();
  bucket.set("private/evidence-1", originalBytes);
  return {
    database,
    d1: testD1(database),
    bucket,
    admin: {
      uid: "admin-1",
      membershipId: "member-admin",
      organisationId: "org-1",
      role: "admin",
    },
    reviewer: {
      uid: "reviewer-1",
      membershipId: "member-reviewer",
      organisationId: "org-1",
      role: "reviewer",
    },
  };
}

test("fake R2 round trip appends a byte integrity receipt without mutating evidence", async () => {
  const { database, d1, bucket, admin } = fixture();
  const evidenceBefore = database.prepare(`
    SELECT * FROM compliance_case_evidence WHERE id = 'evidence-1'
  `).get();
  const result = await verifyCreditexEvidenceIntegrity(
    d1,
    bucket,
    admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-0001",
    },
  );

  assert.equal(result.reused, false);
  assert.equal(result.receipt.result, "matched");
  assert.equal(result.receipt.integrityMatched, true);
  assert.equal(result.receipt.expectedSha256, originalSha256);
  assert.equal(result.receipt.observedSha256, originalSha256);
  assert.equal(result.receipt.verificationScope, "r2_object_bytes_only");
  assert.equal(
    result.receipt.physicalDeviceValidationState,
    "not_assessed",
  );
  assert.deepEqual(
    database.prepare(`
      SELECT * FROM compliance_case_evidence WHERE id = 'evidence-1'
    `).get(),
    evidenceBefore,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count
      FROM compliance_evidence_integrity_receipts
    `).get().count,
    1,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count FROM compliance_audit_events
      WHERE event_type = 'evidence.integrity_checked'
    `).get().count,
    1,
  );

  const reused = await verifyCreditexEvidenceIntegrity(
    d1,
    bucket,
    admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-0001",
    },
  );
  assert.equal(reused.reused, true);
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) count
      FROM compliance_evidence_integrity_receipts
    `).get().count,
    1,
  );

  assert.throws(
    () => database.prepare(`
      UPDATE compliance_evidence_integrity_receipts
      SET result = 'mismatch'
    `).run(),
    /COMPLIANCE_EVIDENCE_INTEGRITY_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_evidence_integrity_receipts
    `).run(),
    /COMPLIANCE_EVIDENCE_INTEGRITY_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO compliance_evidence_integrity_receipts (
        id, organisation_id, evidence_id, request_id, object_key,
        expected_sha256, observed_sha256, expected_size_bytes,
        observed_size_bytes, expected_content_type, observed_content_type,
        result, verification_scope, physical_device_validation_state,
        verified_by_uid, verified_at
      ) VALUES (
        'forged-receipt', 'org-1', 'evidence-1', 'forged-request',
        'private/evidence-1', ?, ?, 5, 5, 'image/jpeg', 'image/jpeg',
        'matched', 'r2_object_bytes_only', 'not_assessed',
        'admin-1', '2026-08-02T00:00:00.000Z'
      )
    `).run(originalSha256, "0".repeat(64)),
    /CHECK constraint failed/,
  );
});

test("same-size R2 tampering is rejected and retained as an immutable mismatch", async () => {
  const { database, d1, bucket, admin } = fixture();
  bucket.set("private/evidence-1", [1, 2, 3, 4, 6]);
  const result = await verifyCreditexEvidenceIntegrity(
    d1,
    bucket,
    admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-0002",
    },
  );

  assert.equal(result.receipt.result, "mismatch");
  assert.equal(result.receipt.integrityMatched, false);
  assert.equal(result.receipt.observedSizeBytes, originalBytes.byteLength);
  assert.notEqual(result.receipt.observedSha256, originalSha256);
  const auditMetadata = JSON.parse(
    database.prepare(`
      SELECT metadata FROM compliance_audit_events
      WHERE event_type = 'evidence.integrity_checked'
    `).get().metadata,
  );
  assert.equal(auditMetadata.hashMatched, false);
  assert.equal(auditMetadata.sizeMatched, true);
  assert.equal(
    auditMetadata.physicalDeviceValidationState,
    "not_assessed",
  );
});

test("conflicting R2 content-type metadata fails closed even when bytes match", async () => {
  const { d1, bucket, admin } = fixture();
  bucket.set(
    "private/evidence-1",
    originalBytes,
    "application/octet-stream",
  );
  const result = await verifyCreditexEvidenceIntegrity(
    d1,
    bucket,
    admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-content-type",
    },
  );
  assert.equal(result.receipt.observedSha256, originalSha256);
  assert.equal(result.receipt.result, "mismatch");
  assert.equal(result.receipt.integrityMatched, false);
});

test("missing and unavailable objects produce fail-closed receipts", async () => {
  const missing = fixture();
  missing.bucket.objects.delete("private/evidence-1");
  const missingResult = await verifyCreditexEvidenceIntegrity(
    missing.d1,
    missing.bucket,
    missing.admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-0003",
    },
  );
  assert.equal(missingResult.receipt.result, "object_missing");
  assert.equal(missingResult.receipt.integrityMatched, false);

  const unavailable = fixture();
  unavailable.bucket.unavailable = true;
  const unavailableResult = await verifyCreditexEvidenceIntegrity(
    unavailable.d1,
    unavailable.bucket,
    unavailable.admin,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-0004",
    },
  );
  assert.equal(
    unavailableResult.receipt.result,
    "storage_unavailable",
  );
  assert.equal(unavailableResult.receipt.integrityMatched, false);
});

test("unassigned reviewers cannot verify or list protected evidence custody", async () => {
  const { d1, bucket, reviewer } = fixture();
  await assert.rejects(
    verifyCreditexEvidenceIntegrity(
      d1,
      bucket,
      reviewer,
      {
        evidenceId: "evidence-1",
        requestId: "integrity-request-0005",
      },
    ),
    (error) => error.code === "EVIDENCE_INTEGRITY_NOT_FOUND",
  );
  await assert.rejects(
    listCreditexEvidenceIntegrityReceipts(
      d1,
      reviewer,
      "evidence-1",
    ),
    (error) => error.code === "EVIDENCE_INTEGRITY_NOT_FOUND",
  );
});

test("an assigned reviewer can append but cannot alter an integrity receipt", async () => {
  const { database, d1, bucket, reviewer } = fixture();
  database.exec(`
    INSERT INTO compliance_case_assignments (
      id, organisation_id, case_id, compliance_user_id,
      assignment_role, status
    ) VALUES (
      'assignment-1', 'org-1', 'case-1', 'member-reviewer',
      'primary_reviewer', 'assigned'
    );
  `);
  const result = await verifyCreditexEvidenceIntegrity(
    d1,
    bucket,
    reviewer,
    {
      evidenceId: "evidence-1",
      requestId: "integrity-request-reviewer",
    },
  );
  assert.equal(result.receipt.result, "matched");
  assert.equal(result.receipt.verifiedByUid, "reviewer-1");
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_evidence_integrity_receipts
      SET verified_by_uid = 'admin-1'
    `).run(),
    /COMPLIANCE_EVIDENCE_INTEGRITY_IMMUTABLE/,
  );
});
