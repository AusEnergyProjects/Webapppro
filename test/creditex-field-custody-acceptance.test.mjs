import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  appendCreditexFieldCustodyAcceptance,
  appendCreditexFieldCustodyDecision,
  appendCreditexFieldCustodyTestArtifact,
  listCreditexFieldCustodyAcceptances,
} from "../src/lib/creditex-field-custody-acceptance-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL(
    "../drizzle/0106_creditex_field_custody_acceptance.sql",
    import.meta.url,
  ),
  "utf8",
);
const routeSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/field-custody-acceptance/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const serverSource = fs.readFileSync(
  new URL(
    "../src/lib/creditex-field-custody-acceptance-server.ts",
    import.meta.url,
  ),
  "utf8",
);

const EVIDENCE_SHA256 = "a".repeat(64);
const BUILD_SHA256 = "b".repeat(64);
const DEVICE_SHA256 = "c".repeat(64);

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
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL DEFAULT 0,
      governance_identity_verified_by_uid text NOT NULL DEFAULT '',
      governance_identity_verified_at text NOT NULL DEFAULT '',
      governance_identity_verification_basis text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT ''
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL
    );
    CREATE TABLE compliance_case_evidence (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      requirement_id text NOT NULL,
      original_sha256 text NOT NULL
    );
    CREATE TABLE compliance_evidence_integrity_receipts (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      evidence_id text NOT NULL,
      expected_sha256 text NOT NULL,
      observed_sha256 text NOT NULL,
      result text NOT NULL
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
      (id, organisation_id, firebase_uid, role, status,
       governance_identity_verified, governance_identity_verified_by_uid,
       governance_identity_verified_at,
       governance_identity_verification_basis, display_name, email)
      VALUES
        ('member-admin', 'org-1', 'tester-1', 'admin', 'active',
          1, 'owner-1', '2026-07-01T00:00:00.000Z',
          'Independent identity verification', 'Test Operator',
          'tester@example.test'),
        ('member-approver', 'org-1', 'approver-1', 'admin', 'active',
          1, 'owner-1', '2026-07-01T00:00:00.000Z',
          'Independent identity verification', 'Test Approver',
          'approver@example.test'),
        ('member-auditor', 'org-1', 'auditor-1', 'auditor', 'active',
          0, '', '', '', 'Test Auditor', 'auditor@example.test'),
        ('member-other', 'org-2', 'other-1', 'admin', 'active',
          0, '', '', '', 'Other Admin', 'other@example.test');
    INSERT INTO compliance_evidence_requirements
      (id, organisation_id)
      VALUES ('requirement-1', 'org-1'), ('requirement-2', 'org-1');
    INSERT INTO compliance_case_evidence
      (id, organisation_id, requirement_id, original_sha256)
      VALUES
        ('evidence-1', 'org-1', 'requirement-1', '${EVIDENCE_SHA256}'),
        ('evidence-2', 'org-1', 'requirement-2', '${"d".repeat(64)}');
    INSERT INTO compliance_evidence_integrity_receipts
      (id, organisation_id, evidence_id, expected_sha256,
       observed_sha256, result)
      VALUES
        ('receipt-1', 'org-1', 'evidence-1',
          '${EVIDENCE_SHA256}', '${EVIDENCE_SHA256}', 'matched'),
        ('receipt-mismatch', 'org-1', 'evidence-1',
          '${EVIDENCE_SHA256}', '${"e".repeat(64)}', 'mismatch');
  `);
  database.exec(migration);
  for (const guard of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    ({ name }) => name.startsWith(
      "compliance_field_custody_",
    ),
  )) {
    database.exec(guard.sql);
  }
  return {
    database,
    d1: testD1(database),
    tester: {
      uid: "tester-1",
      organisationId: "org-1",
      role: "admin",
      governanceIdentityVerified: true,
    },
    approver: {
      uid: "approver-1",
      organisationId: "org-1",
      role: "admin",
      governanceIdentityVerified: true,
    },
  };
}

function input(overrides = {}) {
  return {
    clientRequestId: "field-acceptance-0001",
    platform: "ios",
    nativeBuildIdentifier: "aea-field-ios-2026.08.02-1",
    nativeBuildSha256: BUILD_SHA256,
    deviceModel: "iPhone 15",
    deviceOsVersion: "iOS 19.0",
    deviceIdentifierSha256: DEVICE_SHA256,
    requirementId: "requirement-1",
    evidenceId: "evidence-1",
    integrityReceiptId: "receipt-1",
    offlineScenario: "offline_capture_restore",
    testerUid: "tester-1",
    independentApproverUid: "approver-1",
    ...overrides,
  };
}

function testArtifactInput(overrides = {}) {
  return {
    ...input(),
    clientRequestId: "field-test-artifact-0001",
    restoreSha256: EVIDENCE_SHA256,
    testResult: "passed",
    testedAt: "2026-08-02T01:00:00.000Z",
    ...overrides,
  };
}

test("records default to not_run without fabricating a physical result", async () => {
  const { database, d1, tester } = fixture();
  const first = await appendCreditexFieldCustodyAcceptance(
    d1,
    tester,
    input(),
    { now: "2026-08-02T01:02:03.000Z" },
  );
  assert.equal(first.acceptance.status, "not_run");
  assert.equal(first.acceptance.restoreSha256, "");
  assert.equal(first.acceptance.testedAt, "");
  assert.equal(first.acceptance.approvedAt, "");
  assert.equal(first.acceptance.testArtifactId, "");
  assert.equal(first.acceptance.testArtifactSha256, "");
  assert.equal(first.acceptance.physicalCustodyAccepted, false);
  assert.equal(first.acceptance.reused, false);

  const stored = database.prepare(`
    SELECT * FROM compliance_field_custody_acceptance_records
  `).get();
  assert.equal(stored.status, "not_run");
  assert.equal(stored.device_class, "physical");
  assert.equal(stored.requirement_id, "requirement-1");
  assert.equal(stored.evidence_id, "evidence-1");
  assert.equal(stored.integrity_receipt_id, "receipt-1");
  assert.equal(stored.tester_uid, "tester-1");
  assert.equal(stored.independent_approver_uid, "approver-1");

  const second = await appendCreditexFieldCustodyAcceptance(
    d1,
    tester,
    input(),
    { now: "2026-08-02T02:03:04.000Z" },
  );
  assert.equal(second.acceptance.id, first.acceptance.id);
  assert.equal(second.acceptance.reused, true);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM compliance_field_custody_acceptance_records
  `).get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count FROM compliance_audit_events
  `).get().count, 1);

  const listed = await listCreditexFieldCustodyAcceptances(
    d1,
    tester,
    "evidence-1",
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].physicalCustodyAccepted, false);
});

test("passed acceptance requires an independent approver and exact bytes links", async () => {
  const { database, d1, tester, approver } = fixture();
  const artifact = await appendCreditexFieldCustodyTestArtifact(
    d1,
    tester,
    testArtifactInput(),
    { now: "2026-08-02T01:30:00.000Z" },
  );
  assert.equal(artifact.testArtifact.testerAuthored, true);
  assert.equal(artifact.testArtifact.createdByUid, "tester-1");
  const passed = await appendCreditexFieldCustodyAcceptance(
    d1,
    approver,
    input({
      clientRequestId: "field-acceptance-pass-0001",
      status: "passed",
      restoreSha256: EVIDENCE_SHA256,
      testedAt: "2026-08-02T01:00:00.000Z",
      approvedAt: "2026-08-02T02:00:00.000Z",
      testArtifactId: artifact.testArtifact.id,
    }),
    { now: "2026-08-02T02:00:01.000Z" },
  );
  assert.equal(passed.acceptance.status, "passed");
  assert.equal(passed.acceptance.physicalCustodyAccepted, true);
  assert.equal(passed.acceptance.createdByUid, "approver-1");
  assert.equal(passed.acceptance.testArtifactId, artifact.testArtifact.id);
  assert.equal(
    passed.acceptance.testArtifactSha256,
    artifact.testArtifact.artifactSha256,
  );

  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      input({
        clientRequestId: "field-acceptance-pass-0002",
        status: "passed",
        integrityReceiptId: "receipt-mismatch",
        restoreSha256: EVIDENCE_SHA256,
        testedAt: "2026-08-02T01:00:00.000Z",
        approvedAt: "2026-08-02T02:00:00.000Z",
        testArtifactId: artifact.testArtifact.id,
      }),
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_INTEGRITY_REQUIRED",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      input({
        clientRequestId: "field-acceptance-pass-0003",
        status: "passed",
        testerUid: "approver-1",
        restoreSha256: EVIDENCE_SHA256,
        testedAt: "2026-08-02T01:00:00.000Z",
        approvedAt: "2026-08-02T02:00:00.000Z",
        testArtifactId: artifact.testArtifact.id,
      }),
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      input({
        clientRequestId: "field-acceptance-pass-0004",
        status: "passed",
        requirementId: "requirement-2",
        restoreSha256: EVIDENCE_SHA256,
        testedAt: "2026-08-02T01:00:00.000Z",
        approvedAt: "2026-08-02T02:00:00.000Z",
        testArtifactId: artifact.testArtifact.id,
      }),
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_LINK_INVALID",
  );
  assert.equal(database.prepare(`
    SELECT COUNT(*) count
    FROM compliance_field_custody_acceptance_records
    WHERE status = 'passed'
  `).get().count, 1);
});

test("two-step governance decisions bind the exact tester artifact", async () => {
  const { database, d1, tester, approver } = fixture();
  const approvedArtifact = await appendCreditexFieldCustodyTestArtifact(
    d1,
    tester,
    testArtifactInput(),
    { now: "2026-08-02T01:30:00.000Z" },
  );
  const approved = await appendCreditexFieldCustodyDecision(
    d1,
    approver,
    {
      clientRequestId: "field-decision-approved-0001",
      testArtifactId: approvedArtifact.testArtifact.id,
      decision: "approved",
      decidedAt: "2026-08-02T02:00:00.000Z",
    },
    { now: "2026-08-02T02:00:01.000Z" },
  );
  assert.equal(approved.acceptance.status, "passed");
  assert.equal(
    approved.acceptance.testArtifactId,
    approvedArtifact.testArtifact.id,
  );
  assert.equal(approved.acceptance.createdByUid, "approver-1");
  assert.equal(approved.acceptance.physicalCustodyAccepted, true);

  const rejectedArtifact = await appendCreditexFieldCustodyTestArtifact(
    d1,
    tester,
    testArtifactInput({
      clientRequestId: "field-test-artifact-rejected-0001",
    }),
    { now: "2026-08-02T02:30:00.000Z" },
  );
  const rejected = await appendCreditexFieldCustodyDecision(
    d1,
    approver,
    {
      clientRequestId: "field-decision-rejected-0001",
      testArtifactId: rejectedArtifact.testArtifact.id,
      decision: "rejected",
      decidedAt: "2026-08-02T03:00:00.000Z",
    },
    { now: "2026-08-02T03:00:01.000Z" },
  );
  assert.equal(rejected.acceptance.status, "rejected");
  assert.equal(
    rejected.acceptance.testArtifactId,
    rejectedArtifact.testArtifact.id,
  );
  assert.equal(rejected.acceptance.createdByUid, "approver-1");
  assert.equal(rejected.acceptance.physicalCustodyAccepted, false);
  assert.equal(database.prepare(`
    SELECT COUNT(*) count
    FROM compliance_field_custody_acceptance_records
    WHERE status IN ('passed', 'rejected')
      AND test_artifact_id <> ''
  `).get().count, 2);

  await assert.rejects(
    appendCreditexFieldCustodyDecision(
      d1,
      tester,
      {
        clientRequestId: "field-decision-self-approval",
        testArtifactId: approvedArtifact.testArtifact.id,
        decision: "approved",
        decidedAt: "2026-08-02T03:00:00.000Z",
      },
      { now: "2026-08-02T03:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
  );
  await assert.rejects(
    appendCreditexFieldCustodyDecision(
      d1,
      {
        ...approver,
        governanceIdentityVerified: false,
      },
      {
        clientRequestId: "field-decision-unverified-admin",
        testArtifactId: approvedArtifact.testArtifact.id,
        decision: "rejected",
        decidedAt: "2026-08-02T03:00:00.000Z",
      },
      { now: "2026-08-02T03:00:01.000Z" },
    ),
    (error) =>
      error.code === "FIELD_ACCEPTANCE_GOVERNANCE_APPROVER_REQUIRED",
  );
});

test("an approver cannot manufacture tester authorship or future approval", async () => {
  const { d1, tester, approver } = fixture();
  await assert.rejects(
    appendCreditexFieldCustodyTestArtifact(
      d1,
      approver,
      testArtifactInput({
        clientRequestId: "field-test-artifact-forged",
        testerUid: "tester-1",
      }),
      { now: "2026-08-02T01:30:00.000Z" },
    ),
    (error) => error.code === "FIELD_TEST_ARTIFACT_AUTHOR_INVALID",
  );
  await assert.rejects(
    appendCreditexFieldCustodyTestArtifact(
      d1,
      tester,
      testArtifactInput({
        clientRequestId: "field-test-artifact-future",
        testedAt: "2026-08-02T01:31:00.000Z",
      }),
      { now: "2026-08-02T01:30:00.000Z" },
    ),
    (error) => error.code === "FIELD_TEST_ARTIFACT_FUTURE_INVALID",
  );

  const artifact = await appendCreditexFieldCustodyTestArtifact(
    d1,
    tester,
    testArtifactInput(),
    { now: "2026-08-02T01:30:00.000Z" },
  );
  const passedInput = input({
    clientRequestId: "field-acceptance-proof-required",
    status: "passed",
    restoreSha256: EVIDENCE_SHA256,
    testedAt: "2026-08-02T01:00:00.000Z",
    approvedAt: "2026-08-02T02:00:00.000Z",
  });
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      passedInput,
      { now: "2026-08-02T02:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      {
        ...passedInput,
        clientRequestId: "field-acceptance-wrong-tester",
        testerUid: "auditor-1",
        testArtifactId: artifact.testArtifact.id,
      },
      { now: "2026-08-02T02:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      {
        ...passedInput,
        clientRequestId: "field-acceptance-future-approval",
        testArtifactId: artifact.testArtifact.id,
        approvedAt: "2026-08-02T02:01:00.000Z",
      },
      { now: "2026-08-02T02:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_APPROVED_AT_FUTURE",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      {
        ...passedInput,
        clientRequestId: "field-acceptance-before-test",
        testArtifactId: artifact.testArtifact.id,
        approvedAt: "2026-08-02T00:59:00.000Z",
      },
      { now: "2026-08-02T02:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_DECISION_INVALID",
  );
  await assert.rejects(
    appendCreditexFieldCustodyAcceptance(
      d1,
      approver,
      {
        ...passedInput,
        clientRequestId: "field-acceptance-pre-attestation",
        testArtifactId: artifact.testArtifact.id,
        approvedAt: "2026-08-02T01:15:00.000Z",
      },
      { now: "2026-08-02T02:00:01.000Z" },
    ),
    (error) => error.code === "FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED",
  );
});

test("database guards keep field acceptance records append-only", async () => {
  const { database, d1, tester, approver } = fixture();
  await appendCreditexFieldCustodyAcceptance(d1, tester, input(), {
    now: "2026-08-02T01:02:03.000Z",
  });
  const artifact = await appendCreditexFieldCustodyTestArtifact(
    d1,
    tester,
    testArtifactInput(),
    { now: "2026-08-02T01:30:00.000Z" },
  );
  const passed = await appendCreditexFieldCustodyAcceptance(
    d1,
    approver,
    input({
      clientRequestId: "field-acceptance-pass-guard",
      status: "passed",
      restoreSha256: EVIDENCE_SHA256,
      testedAt: "2026-08-02T01:00:00.000Z",
      approvedAt: "2026-08-02T02:00:00.000Z",
      testArtifactId: artifact.testArtifact.id,
    }),
    { now: "2026-08-02T02:00:01.000Z" },
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_field_custody_acceptance_records
      SET status = 'blocked'
    `).run(),
    /COMPLIANCE_FIELD_ACCEPTANCE_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_field_custody_acceptance_records
    `).run(),
    /COMPLIANCE_FIELD_ACCEPTANCE_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_field_custody_test_artifacts
      SET test_result = 'failed'
    `).run(),
    /COMPLIANCE_FIELD_TEST_ARTIFACT_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`
      DELETE FROM compliance_field_custody_test_artifacts
    `).run(),
    /COMPLIANCE_FIELD_TEST_ARTIFACT_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO compliance_field_custody_acceptance_records (
        id, organisation_id, client_request_id, request_sha256, platform,
        native_build_identifier, native_build_sha256, device_class,
        device_model, device_os_version, device_identifier_sha256,
        requirement_id, evidence_id, integrity_receipt_id, offline_scenario,
        restore_sha256, status, test_artifact_id, test_artifact_sha256,
        tester_uid, independent_approver_uid, tested_at, approved_at,
        created_by_uid, created_at
      )
      SELECT
        'forged-pass', organisation_id, 'forged-pass-request', request_sha256,
        platform, native_build_identifier, native_build_sha256, device_class,
        device_model, device_os_version, device_identifier_sha256,
        requirement_id, evidence_id, integrity_receipt_id, offline_scenario,
        restore_sha256, status, test_artifact_id, test_artifact_sha256,
        'auditor-1', independent_approver_uid, tested_at, approved_at,
        created_by_uid, created_at
      FROM compliance_field_custody_acceptance_records
      WHERE id = ?
    `).run(passed.acceptance.id),
    /COMPLIANCE_FIELD_ACCEPTANCE_TEST_ARTIFACT_REQUIRED/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO compliance_field_custody_acceptance_records (
        id, organisation_id, client_request_id, request_sha256, platform,
        native_build_identifier, native_build_sha256, device_class,
        device_model, device_os_version, device_identifier_sha256,
        requirement_id, evidence_id, integrity_receipt_id, offline_scenario,
        restore_sha256, status, test_artifact_id, test_artifact_sha256,
        tester_uid, independent_approver_uid, tested_at, approved_at,
        created_by_uid, created_at
      )
      SELECT
        'forged-rejection', organisation_id, 'forged-rejection-request',
        request_sha256, platform, native_build_identifier,
        native_build_sha256, device_class, device_model, device_os_version,
        device_identifier_sha256, requirement_id, evidence_id,
        integrity_receipt_id, offline_scenario, restore_sha256, 'rejected',
        test_artifact_id, test_artifact_sha256, tester_uid, 'auditor-1',
        tested_at, approved_at, 'auditor-1', created_at
      FROM compliance_field_custody_acceptance_records
      WHERE id = ?
    `).run(passed.acceptance.id),
    /COMPLIANCE_FIELD_ACCEPTANCE_GOVERNANCE_APPROVER_REQUIRED/,
  );
});

test("field acceptance API is protected, no-store and append-only", () => {
  assert.match(routeSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /requireComplianceAccess\(request/);
  assert.match(
    routeSource,
    /allowedRoles: \["admin", "case_manager", "reviewer", "auditor"\]/,
  );
  assert.match(routeSource, /"append_test_artifact"/);
  assert.match(routeSource, /"append_decision"/);
  assert.match(routeSource, /testerUid: body\.testerUid \?\? member\.uid/);
  assert.doesNotMatch(routeSource, /"append_acceptance"/);
  assert.doesNotMatch(routeSource, /export async function (PUT|PATCH|DELETE)/);
  assert.doesNotMatch(`${routeSource}\n${serverSource}`, /\bfetch\s*\(/);
  assert.match(migration, /`status` text DEFAULT 'not_run' NOT NULL/);
  assert.match(migration, /'passed', 'rejected'/);
  assert.match(migration, /`device_class` = 'physical'/);
  assert.match(migration, /`tester_uid` <> `independent_approver_uid`/);
  assert.match(migration, /compliance_field_custody_test_artifacts/);
  assert.match(migration, /`created_by_uid` = `tester_uid`/);
});
