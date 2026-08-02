import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  starterManualEvidenceForm,
} from "../src/lib/creditex-manual-evidence-lab.ts";
import {
  CREDITEX_MANUAL_FIELD_ACCEPTANCE_CONTRACT,
  CreditexManualFieldAcceptanceError,
  listManualFieldAcceptanceRuns,
  reviewManualFieldAcceptanceRun,
  submitManualFieldAcceptanceRun,
} from "../src/lib/creditex-manual-field-acceptance-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
  canonicalCreditexSchemaGuardSql,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL("../drizzle/0112_creditex_manual_field_capture.sql", import.meta.url),
  "utf8",
);
const now = "2026-08-03T02:00:00.000Z";
const deviceId = "aea-field-physical-acceptance-01";
const manualFieldGuardDefinitions = CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
  (definition) =>
    definition.name.startsWith("compliance_manual_field_")
    || definition.name.startsWith("compliance_manual_evidence_test_capture_"),
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
    return {
      results: this.database.prepare(this.sql).all(...this.values),
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: result.lastInsertRowid,
      },
    };
  }
}

function testD1(database) {
  let batchTail = Promise.resolve();
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    batch(statements) {
      const operation = batchTail.then(async () => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const results = [];
          for (const statement of statements) {
            results.push(await statement.run());
          }
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      });
      batchTail = operation.catch(() => undefined);
      return operation;
    },
  };
}

const tester = {
  uid: "tester-uid",
  email: "tester@example.test",
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1_000),
  membershipId: "member-tester",
  organisationId: "org-1",
  organisationCode: "creditex",
  organisationLegalName: "Creditex",
  organisationTradingName: "Creditex",
  displayName: "Named Physical Tester",
  role: "admin",
  governanceIdentityVerified: true,
};

const reviewer = {
  ...tester,
  uid: "reviewer-uid",
  email: "reviewer@example.test",
  membershipId: "member-reviewer",
  displayName: "Independent Reviewer",
  role: "reviewer",
};

const requiredScenarios = [
  "physical_device_capture",
  "offline_queue_resume",
  "multipart_upload_resume",
  "r2_original_restore",
];

function scenarioResults() {
  return requiredScenarios.map((scenario) => ({
    scenario,
    outcome: "passed",
    note: `Named tester completed ${scenario}.`,
  }));
}

function responseValue(field) {
  if (field.fieldType === "checkbox") return "Yes";
  if (field.fieldType === "select") return field.options[0];
  if (field.fieldType === "number") return "1";
  if (field.fieldType === "date") return "2026-08-03";
  if (field.fieldType === "photo" || field.fieldType === "document") return "";
  return "Synthetic physical-device acceptance answer.";
}

function setupAcceptanceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      role text NOT NULL,
      governance_identity_verified integer NOT NULL
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
      metadata text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE compliance_manual_evidence_test_jobs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      form_schema text NOT NULL,
      response_snapshot text NOT NULL,
      record_mode text NOT NULL,
      status text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  database.exec(migration);
  for (const definition of manualFieldGuardDefinitions) {
    database.exec(definition.sql);
  }
  database.prepare(`INSERT INTO compliance_users (
      id, organisation_id, firebase_uid, status, role,
      governance_identity_verified
    ) VALUES
      ('member-tester', 'org-1', 'tester-uid', 'active', 'admin', 1),
      ('member-reviewer', 'org-1', 'reviewer-uid', 'active', 'reviewer', 1)`)
    .run();

  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (candidate) => candidate.programCode === "VEU",
  );
  assert.ok(activity);
  const form = starterManualEvidenceForm(activity);
  let captureSequence = 0;
  const captures = [];
  const responses = form.fields.map((field) => {
    const fieldCaptures = [];
    if (field.fieldType === "photo" || field.fieldType === "document") {
      for (
        let captureIndex = 0;
        captureIndex < Math.max(1, field.minimumCount);
        captureIndex += 1
      ) {
        captureSequence += 1;
        const captureId = `capture-${captureSequence}`;
        const contentType = field.fieldType === "photo"
          ? "image/jpeg"
          : "application/pdf";
        const originalSha256 = captureSequence.toString(16).padStart(64, "0");
        const capture = {
          captureId,
          fieldCode: field.fieldCode,
          fileName: `${field.fieldCode}-${captureSequence}.${
            field.fieldType === "photo" ? "jpg" : "pdf"
          }`,
          contentType,
          originalPresent: field.originalRequired,
          metadataPresent: field.metadataRequired,
          gpsPresent: field.gpsRequired,
          captureTimePresent: field.fieldType === "photo",
          originalSha256,
          deviceId,
          capturedAt: now,
          verificationState: "server_verified",
          physicalDeviceState: "reported_physical",
          objectKey: `synthetic-manual-evidence/org-1/manual-job-1/${captureId}`,
          sizeBytes: 1_024 + captureSequence,
        };
        captures.push(capture);
        fieldCaptures.push(capture);
      }
    }
    return {
      fieldCode: field.fieldCode,
      outcome: "provided",
      value: responseValue(field),
      captures: fieldCaptures.map((capture) => ({
        captureId: capture.captureId,
        fileName: capture.fileName,
        contentType: capture.contentType,
        originalPresent: capture.originalPresent,
        metadataPresent: capture.metadataPresent,
        gpsPresent: capture.gpsPresent,
        captureTimePresent: capture.captureTimePresent,
        originalSha256: capture.originalSha256,
        deviceId: capture.deviceId,
        capturedAt: capture.capturedAt,
        verificationState: capture.verificationState,
        physicalDeviceState: capture.physicalDeviceState,
      })),
      note: "Completed during the named synthetic acceptance run.",
    };
  });

  database.prepare(`INSERT INTO compliance_manual_evidence_test_jobs (
      id, organisation_id, form_schema, response_snapshot, record_mode,
      status, updated_at, field_tester_uid
    ) VALUES (?, 'org-1', ?, ?, 'synthetic_test', 'field_testing', ?,
      'tester-uid')`)
    .run(
      "manual-job-1",
      JSON.stringify(form),
      JSON.stringify(responses),
      now,
    );
  database.prepare(`INSERT INTO compliance_manual_field_devices (
      id, organisation_id, firebase_uid, device_id, platform, device_name,
      app_version, is_physical_device, status, registered_at, last_seen_at,
      revoked_at, updated_at
    ) VALUES (
      'physical-device-1', 'org-1', 'tester-uid', ?, 'android',
      'Named test handset', '1.0.0', 1, 'active', ?, ?, '', ?
    )`)
    .run(deviceId, now, now, now);

  for (const capture of captures) {
    database.prepare(`INSERT INTO compliance_manual_field_upload_sessions (
        id, organisation_id, job_id, field_code, field_tester_uid, device_id,
        client_upload_id, object_key, upload_id, file_name, content_type,
        size_bytes, part_size_bytes, evidence_envelope, declared_sha256,
        status, capture_id, last_error, record_mode, expires_at, created_at,
        completed_at, updated_at
      ) VALUES (
        ?, 'org-1', 'manual-job-1', ?, 'tester-uid', ?, ?, ?, ?, ?, ?, ?,
        5242880, '{}', ?, 'initiated', '', '', 'synthetic_test',
        '2026-08-04T02:00:00.000Z', ?, '', ?
      )`)
      .run(
        `upload-${capture.captureId}`,
        capture.fieldCode,
        deviceId,
        `client-${capture.captureId}`,
        capture.objectKey,
        `r2-${capture.captureId}`,
        capture.fileName,
        capture.contentType,
        capture.sizeBytes,
        capture.originalSha256,
        now,
        now,
      );
    database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'completing', updated_at = ?
      WHERE id = ?`)
      .run(now, `upload-${capture.captureId}`);
    database.prepare(`INSERT INTO compliance_manual_evidence_test_captures (
        id, organisation_id, job_id, field_code, field_tester_uid, device_id,
        upload_session_id, object_key, file_name, content_type, size_bytes,
        original_sha256, evidence_envelope, server_verification,
        metadata_state, gps_state, capture_time_state, physical_device_state,
        status, record_mode, created_at, updated_at
      ) VALUES (
        ?, 'org-1', 'manual-job-1', ?, 'tester-uid', ?, ?, ?, ?, ?, ?, ?,
        '{}', '{"verification":"server_verified"}', ?, ?, ?,
        'reported_physical', 'captured', 'synthetic_test', ?, ?
      )`)
      .run(
        capture.captureId,
        capture.fieldCode,
        deviceId,
        `upload-${capture.captureId}`,
        capture.objectKey,
        capture.fileName,
        capture.contentType,
        capture.sizeBytes,
        capture.originalSha256,
        capture.metadataPresent ? "verified" : "not_required",
        capture.gpsPresent ? "verified" : "not_required",
        capture.captureTimePresent ? "verified" : "not_required",
        now,
        now,
      );
    database.prepare(`INSERT INTO compliance_manual_field_integrity_receipts (
        id, organisation_id, capture_id, request_id, object_key,
        expected_sha256, observed_sha256, expected_size_bytes,
        observed_size_bytes, result, verification_scope, verified_by_uid,
        verified_at
      ) VALUES (
        ?, 'org-1', ?, ?, ?, ?, ?, ?, ?, 'matched',
        'r2_object_bytes_and_embedded_metadata', 'tester-uid', ?
      )`)
      .run(
        `receipt-${capture.captureId}`,
        capture.captureId,
        `upload:upload-${capture.captureId}`,
        capture.objectKey,
        capture.originalSha256,
        capture.originalSha256,
        capture.sizeBytes,
        capture.sizeBytes,
        now,
      );
    database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'completed', capture_id = ?, completed_at = ?,
        updated_at = ?
      WHERE id = ?`)
      .run(
        capture.captureId,
        now,
        now,
        `upload-${capture.captureId}`,
      );
  }

  return {
    database,
    d1: testD1(database),
    captures,
  };
}

function submissionInput(clientRequestId = "acceptance-run-1") {
  return {
    clientRequestId,
    jobId: "manual-job-1",
    deviceId,
    platform: "android",
    appVersion: "1.0.0",
    testerNote:
      "Named tester completed the physical-device custody acceptance run.",
    scenarioResults: scenarioResults(),
  };
}

test("manual field migration is table-only and runtime guards install canonically", () => {
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.equal(manualFieldGuardDefinitions.length, 15);
  const { database } = setupAcceptanceDatabase();
  for (const definition of manualFieldGuardDefinitions) {
    const installed = database.prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
    ).get(definition.name);
    assert.ok(installed, `Missing installed guard ${definition.name}`);
    assert.equal(
      canonicalCreditexSchemaGuardSql(installed.sql),
      canonicalCreditexSchemaGuardSql(definition.sql),
    );
  }
});

test("manual field custody parents and immutable receipts reject invalid writes", () => {
  const { database, captures } = setupAcceptanceDatabase();
  const capture = captures[0];
  assert.throws(
    () => database.prepare(`INSERT INTO
        compliance_manual_evidence_test_captures
      SELECT 'orphan-capture', organisation_id, job_id, field_code,
        field_tester_uid, device_id, 'missing-upload-session', object_key,
        file_name, content_type, size_bytes, original_sha256,
        evidence_envelope, server_verification, metadata_state, gps_state,
        capture_time_state, physical_device_state, status, record_mode,
        created_at, updated_at
      FROM compliance_manual_evidence_test_captures WHERE id = ?`)
      .run(capture.captureId),
    /COMPLIANCE_MANUAL_FIELD_CAPTURE_PARENT_INVALID/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_evidence_test_captures
      SET object_key = 'changed' WHERE id = ?`).run(capture.captureId),
    /COMPLIANCE_MANUAL_FIELD_CAPTURE_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM compliance_manual_evidence_test_captures
      WHERE id = ?`).run(capture.captureId),
    /COMPLIANCE_MANUAL_FIELD_CAPTURE_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_field_integrity_receipts
      SET result = 'mismatch' WHERE capture_id = ?`).run(capture.captureId),
    /COMPLIANCE_MANUAL_FIELD_INTEGRITY_RECEIPT_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM compliance_manual_field_integrity_receipts
      WHERE capture_id = ?`).run(capture.captureId),
    /COMPLIANCE_MANUAL_FIELD_INTEGRITY_RECEIPT_DELETE_FORBIDDEN/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_field_upload_sessions
      SET status = 'initiated', updated_at = ?
      WHERE id = ?`).run(now, `upload-${capture.captureId}`),
    /COMPLIANCE_MANUAL_FIELD_UPLOAD_SESSION_TRANSITION_INVALID/,
  );
  assert.throws(
    () => database.prepare(`INSERT INTO
        compliance_manual_field_integrity_receipts (
          id, organisation_id, capture_id, request_id, object_key,
          expected_sha256, observed_sha256, expected_size_bytes,
          observed_size_bytes, result, verification_scope, verified_by_uid,
          verified_at
        ) VALUES (
          'orphan-receipt', 'org-1', ?, 'wrong-request', ?, ?, ?, ?, ?,
          'matched', 'r2_object_bytes_and_embedded_metadata', 'tester-uid', ?
        )`)
      .run(
        capture.captureId,
        capture.objectKey,
        capture.originalSha256,
        capture.originalSha256,
        capture.sizeBytes,
        capture.sizeBytes,
        now,
      ),
    /COMPLIANCE_MANUAL_FIELD_INTEGRITY_RECEIPT_PARENT_INVALID/,
  );
});

test("physical custody submission remains synthetic until independent review", async () => {
  const { database, d1, captures } = setupAcceptanceDatabase();
  const restored = new Map(
    captures.map((capture) => [
      capture.objectKey,
      {
        sha256: capture.originalSha256,
        sizeBytes: capture.sizeBytes,
      },
    ]),
  );
  const restoreCalls = [];
  const submitted = await submitManualFieldAcceptanceRun(
    d1,
    tester,
    submissionInput(),
    async (objectKey) => {
      restoreCalls.push(objectKey);
      return restored.get(objectKey) || null;
    },
    { now },
  );

  assert.equal(submitted.reused, false);
  assert.equal(submitted.run.status, "submitted");
  assert.equal(submitted.run.recordMode, "synthetic_test");
  assert.equal(submitted.run.physicalCustodyAccepted, false);
  assert.deepEqual(
    submitted.run.scenarioResults.slice(0, 4).map(({ scenario }) => scenario),
    requiredScenarios,
  );
  assert.deepEqual(
    submitted.run.scenarioResults.map(({ outcome }) => outcome),
    ["passed", "passed", "passed", "passed", "passed"],
  );
  assert.equal(
    submitted.run.scenarioResults.at(-1).scenario,
    "server_r2_restore",
  );
  assert.equal(restoreCalls.length, captures.length);
  assert.deepEqual(new Set(restoreCalls), new Set(captures.map(
    ({ objectKey }) => objectKey,
  )));

  const listed = await listManualFieldAcceptanceRuns(
    d1,
    tester,
    "manual-job-1",
  );
  assert.equal(listed.contract, CREDITEX_MANUAL_FIELD_ACCEPTANCE_CONTRACT);
  assert.deepEqual(listed.boundaries, {
    recordMode: "synthetic_test",
    regulatoryAcceptance: "not_assessed",
    deviceAttestation: "not_available",
    externalSubmissionEnabled: false,
  });
  assert.equal(listed.runs[0].physicalCustodyAccepted, false);
  const submitAudit = database.prepare(`SELECT metadata
      FROM compliance_audit_events
      WHERE event_type = 'manual_field.acceptance_submitted'`).get();
  assert.ok(submitAudit);
  assert.deepEqual(JSON.parse(submitAudit.metadata), {
    jobId: "manual-job-1",
    deviceId,
    captureCount: captures.length,
    recordMode: "synthetic_test",
    physicalCustodyAccepted: false,
    deviceAttestation: "not_available",
  });

  await assert.rejects(
    reviewManualFieldAcceptanceRun(d1, tester, {
      runId: submitted.run.id,
      decision: "passed",
      reviewerNote: "Tester attempted to review their own physical run.",
    }, { now: "2026-08-03T03:00:00.000Z" }),
    (error) =>
      error instanceof CreditexManualFieldAcceptanceError
      && error.code === "MANUAL_FIELD_ACCEPTANCE_INDEPENDENCE_REQUIRED",
  );

  const reviewed = await reviewManualFieldAcceptanceRun(d1, reviewer, {
    runId: submitted.run.id,
    decision: "passed",
    reviewerNote:
      "Independent reviewer checked all tester and server restore results.",
  }, { now: "2026-08-03T03:00:00.000Z" });
  assert.equal(reviewed.run.status, "passed");
  assert.equal(reviewed.run.reviewerUid, reviewer.uid);
  assert.equal(reviewed.run.physicalCustodyAccepted, true);

  assert.throws(
    () => database.prepare(`DELETE FROM
        compliance_manual_field_acceptance_runs WHERE id = ?`)
      .run(submitted.run.id),
    /COMPLIANCE_MANUAL_FIELD_ACCEPTANCE_DELETE_FORBIDDEN/,
  );
});

test("R2 restore mismatch blocks submission without persisting a run", async () => {
  const { database, d1, captures } = setupAcceptanceDatabase();
  await assert.rejects(
    submitManualFieldAcceptanceRun(
      d1,
      tester,
      submissionInput("acceptance-run-restore-failed"),
      async (objectKey) => {
        const capture = captures.find(
          (candidate) => candidate.objectKey === objectKey,
        );
        return capture
          ? {
              sha256: "f".repeat(64),
              sizeBytes: capture.sizeBytes,
            }
          : null;
      },
      { now },
    ),
    (error) =>
      error instanceof CreditexManualFieldAcceptanceError
      && error.code === "MANUAL_FIELD_ACCEPTANCE_RESTORE_FAILED",
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count FROM
      compliance_manual_field_acceptance_runs`).get().count,
    0,
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count FROM
      compliance_audit_events`).get().count,
    0,
  );
});

test("the four named tester scenarios are required exactly once", async () => {
  const { d1, captures } = setupAcceptanceDatabase();
  const incomplete = submissionInput("acceptance-run-incomplete-scenarios");
  incomplete.scenarioResults = [
    ...scenarioResults().slice(0, 3),
    scenarioResults()[0],
  ];
  await assert.rejects(
    submitManualFieldAcceptanceRun(
      d1,
      tester,
      incomplete,
      async (objectKey) => {
        const capture = captures.find(
          (candidate) => candidate.objectKey === objectKey,
        );
        return capture
          ? {
              sha256: capture.originalSha256,
              sizeBytes: capture.sizeBytes,
            }
          : null;
      },
      { now },
    ),
    (error) =>
      error instanceof CreditexManualFieldAcceptanceError
      && error.code === "MANUAL_FIELD_ACCEPTANCE_SCENARIOS_INCOMPLETE",
  );
});

test("acceptance request references bind every submitted input field", async () => {
  const { d1, captures } = setupAcceptanceDatabase();
  const restore = async (objectKey) => {
    const capture = captures.find(
      (candidate) => candidate.objectKey === objectKey,
    );
    return capture
      ? {
          sha256: capture.originalSha256,
          sizeBytes: capture.sizeBytes,
        }
      : null;
  };
  const input = submissionInput("acceptance-run-idempotency");
  const submitted = await submitManualFieldAcceptanceRun(
    d1,
    tester,
    input,
    restore,
    { now },
  );
  assert.equal(submitted.reused, false);

  const replay = await submitManualFieldAcceptanceRun(
    d1,
    tester,
    {
      ...structuredClone(input),
      scenarioResults: [...input.scenarioResults].reverse(),
    },
    restore,
    { now },
  );
  assert.equal(replay.reused, true);

  for (const changed of [
    {
      ...structuredClone(input),
      testerNote:
        "Named tester completed a materially different physical-device run.",
    },
    {
      ...structuredClone(input),
      platform: "ios",
    },
    {
      ...structuredClone(input),
      appVersion: "1.0.1",
    },
    {
      ...structuredClone(input),
      scenarioResults: input.scenarioResults.map((scenario, index) =>
        index === 0
          ? { ...scenario, note: "A different observed scenario result." }
          : scenario
      ),
    },
  ]) {
    await assert.rejects(
      submitManualFieldAcceptanceRun(
        d1,
        tester,
        changed,
        restore,
        { now },
      ),
      (error) =>
        error instanceof CreditexManualFieldAcceptanceError
        && error.code === "MANUAL_FIELD_ACCEPTANCE_REQUEST_ID_CONFLICT",
    );
  }
});

test("concurrent terminal review creates one decision and one audit event", async () => {
  const { database, d1, captures } = setupAcceptanceDatabase();
  const submitted = await submitManualFieldAcceptanceRun(
    d1,
    tester,
    submissionInput("acceptance-run-review-race"),
    async (objectKey) => {
      const capture = captures.find(
        (candidate) => candidate.objectKey === objectKey,
      );
      return capture
        ? {
            sha256: capture.originalSha256,
            sizeBytes: capture.sizeBytes,
          }
        : null;
    },
    { now },
  );
  const decision = {
    runId: submitted.run.id,
    decision: "passed",
    reviewerNote:
      "Independent reviewer checked all tester and server restore results.",
  };
  const reviewed = await Promise.all([
    reviewManualFieldAcceptanceRun(
      d1,
      reviewer,
      structuredClone(decision),
      { now: "2026-08-03T03:00:00.000Z" },
    ),
    reviewManualFieldAcceptanceRun(
      d1,
      reviewer,
      structuredClone(decision),
      { now: "2026-08-03T03:00:00.000Z" },
    ),
  ]);
  assert.deepEqual(
    reviewed.map(({ reused }) => reused).sort(),
    [false, true],
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_audit_events
      WHERE event_type = 'manual_field.acceptance_reviewed'
        AND target_id = ?`).get(submitted.run.id).count,
    1,
  );
});

test("review audit failure rolls the terminal decision back", async () => {
  const { database, d1, captures } = setupAcceptanceDatabase();
  const submitted = await submitManualFieldAcceptanceRun(
    d1,
    tester,
    submissionInput("acceptance-run-review-rollback"),
    async (objectKey) => {
      const capture = captures.find(
        (candidate) => candidate.objectKey === objectKey,
      );
      return capture
        ? {
            sha256: capture.originalSha256,
            sizeBytes: capture.sizeBytes,
          }
        : null;
    },
    { now },
  );
  database.exec(`CREATE TRIGGER reject_acceptance_review_audit
    BEFORE INSERT ON compliance_audit_events
    WHEN NEW.event_type = 'manual_field.acceptance_reviewed'
    BEGIN
      SELECT RAISE(ABORT, 'forced review audit failure');
    END`);
  await assert.rejects(
    reviewManualFieldAcceptanceRun(d1, reviewer, {
      runId: submitted.run.id,
      decision: "passed",
      reviewerNote:
        "Independent reviewer checked all tester and server restore results.",
    }, { now: "2026-08-03T03:00:00.000Z" }),
    /forced review audit failure/,
  );
  const authoritative = database.prepare(`SELECT status, reviewer_uid,
      reviewer_note, reviewed_at
    FROM compliance_manual_field_acceptance_runs
    WHERE id = ?`).get(submitted.run.id);
  assert.deepEqual({ ...authoritative }, {
    status: "submitted",
    reviewer_uid: "",
    reviewer_note: "",
    reviewed_at: "",
  });
});
