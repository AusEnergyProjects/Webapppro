import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  emptyManualEvidenceResponse,
  starterManualEvidenceForm,
} from "../src/lib/creditex-manual-evidence-lab.ts";
import {
  attachVerifiedManualFieldCapture,
  rejectUnattachedManualFieldUploadSession,
  revokeManualFieldDevice,
} from "../src/lib/creditex-manual-field-server.ts";

const migration = fs.readFileSync(
  new URL("../drizzle/0112_creditex_manual_field_capture.sql", import.meta.url),
  "utf8",
);
const mediaRouteSource = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/manual-field/media/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const now = "2026-08-03T05:00:00.000Z";
const sha256 = "a".repeat(64);

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

const currentTester = {
  uid: "current-tester",
  email: "current@example.test",
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1_000),
  membershipId: "member-current",
  organisationId: "org-1",
  organisationCode: "creditex",
  organisationLegalName: "Creditex",
  organisationTradingName: "Creditex",
  displayName: "Current Tester",
  role: "admin",
  governanceIdentityVerified: true,
};

function setupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      role text NOT NULL,
      governance_identity_verified integer NOT NULL
    );
    CREATE TABLE compliance_manual_evidence_form_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      status text NOT NULL,
      title text NOT NULL,
      version integer NOT NULL
    );
    CREATE TABLE compliance_manual_evidence_test_jobs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      form_version_id text NOT NULL,
      program_code text NOT NULL,
      activity_template_id text NOT NULL,
      activity_snapshot text NOT NULL,
      form_schema text NOT NULL,
      form_schema_sha256 text NOT NULL,
      job_number text NOT NULL,
      installer_label text NOT NULL,
      technician_label text NOT NULL,
      customer_label text NOT NULL,
      site_state text NOT NULL,
      site_postcode text NOT NULL,
      status text NOT NULL,
      response_snapshot text NOT NULL,
      response_sha256 text NOT NULL,
      required_count integer NOT NULL,
      completed_required_count integer NOT NULL,
      issue_count integer NOT NULL,
      review_note text NOT NULL,
      record_mode text NOT NULL,
      revision integer NOT NULL,
      updated_by_uid text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_manual_evidence_test_events (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      job_id text NOT NULL,
      event_type text NOT NULL,
      actor_uid text NOT NULL,
      summary text NOT NULL,
      metadata text NOT NULL,
      created_at text NOT NULL
    );
  `);
  database.exec(migration);
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (candidate) => candidate.programCode === "VEU",
  );
  assert.ok(activity);
  const starter = starterManualEvidenceForm(activity);
  const evidenceField = starter.fields.find(
    ({ fieldType }) => fieldType === "photo" || fieldType === "document",
  );
  assert.ok(evidenceField);
  const schema = {
    ...starter,
    fields: starter.fields.map((field) =>
      field.fieldCode === evidenceField.fieldCode
        ? { ...field, maximumCount: 1 }
        : field
    ),
  };
  const previousCapture = {
    captureId: "previous-capture",
    fileName: "previous.jpg",
    contentType: "image/jpeg",
    originalPresent: true,
    metadataPresent: true,
    gpsPresent: true,
    captureTimePresent: true,
    originalSha256: "b".repeat(64),
    deviceId: "previous-device-0001",
    capturedAt: now,
    verificationState: "server_verified",
    physicalDeviceState: "reported_physical",
  };
  const responses = schema.fields.map((field) => {
    const response = emptyManualEvidenceResponse(field.fieldCode);
    return field.fieldCode === evidenceField.fieldCode
      ? {
          ...response,
          outcome: "provided",
          captures: [previousCapture],
        }
      : response;
  });
  database.prepare(`INSERT INTO compliance_manual_evidence_form_versions (
      id, organisation_id, status, title, version
    ) VALUES ('form-1', 'org-1', 'test_ready', 'Safety form', 1)`)
    .run();
  database.prepare(`INSERT INTO compliance_manual_evidence_test_jobs (
      id, organisation_id, form_version_id, program_code,
      activity_template_id, activity_snapshot, form_schema,
      form_schema_sha256, job_number, installer_label, technician_label,
      customer_label, site_state, site_postcode, status, response_snapshot,
      response_sha256, required_count, completed_required_count, issue_count,
      review_note, record_mode, revision, updated_by_uid, created_at,
      updated_at, field_tester_uid
    ) VALUES (
      'job-1', 'org-1', 'form-1', ?, ?, ?, ?, ?,
      'TEST-SAFETY-1', '[TEST] Installer', '[TEST] Technician',
      '[TEST] Customer', 'VIC', '3000', 'field_testing', ?, ?, 1, 0, 0, '',
      'synthetic_test', 1, 'current-tester', ?, ?, 'current-tester'
    )`)
    .run(
      activity.programCode,
      activity.templateId,
      JSON.stringify({ activity }),
      JSON.stringify(schema),
      "c".repeat(64),
      JSON.stringify(responses),
      "d".repeat(64),
      now,
      now,
    );
  return {
    database,
    d1: testD1(database),
    evidenceField,
  };
}

function insertSession(database, {
  id,
  fieldCode,
  testerUid,
  deviceId,
  objectKey,
  status = "completing",
}) {
  database.prepare(`INSERT INTO compliance_manual_field_upload_sessions (
      id, organisation_id, job_id, field_code, field_tester_uid, device_id,
      client_upload_id, object_key, upload_id, file_name, content_type,
      size_bytes, part_size_bytes, evidence_envelope, declared_sha256,
      status, capture_id, last_error, record_mode, expires_at, created_at,
      completed_at, updated_at
    ) VALUES (
      ?, 'org-1', 'job-1', ?, ?, ?, ?, ?, ?, 'capture.jpg', 'image/jpeg',
      1234, 5242880, '{}', ?, ?, '', '', 'synthetic_test',
      '2026-08-04T05:00:00.000Z', ?, '', ?
    )`)
    .run(
      id,
      fieldCode,
      testerUid,
      deviceId,
      `client-${id}`,
      objectKey,
      `r2-${id}`,
      sha256,
      status,
      now,
      now,
    );
}

test("custody reference prevents upload rejection and R2 deletion", async () => {
  const { database, d1, evidenceField } = setupDatabase();
  const objectKey = "synthetic-manual-evidence/org-1/job-1/referenced";
  insertSession(database, {
    id: "referenced-session",
    fieldCode: evidenceField.fieldCode,
    testerUid: currentTester.uid,
    deviceId: "current-device-0001",
    objectKey,
  });
  database.prepare(`INSERT INTO compliance_manual_evidence_test_captures (
      id, organisation_id, job_id, field_code, field_tester_uid, device_id,
      upload_session_id, object_key, file_name, content_type, size_bytes,
      original_sha256, evidence_envelope, server_verification,
      metadata_state, gps_state, capture_time_state, physical_device_state,
      status, record_mode, created_at, updated_at
    ) VALUES (
      'referenced-capture', 'org-1', 'job-1', ?, 'current-tester',
      'current-device-0001', 'referenced-session', ?, 'capture.jpg',
      'image/jpeg', 1234, ?, '{}', '{}', 'verified', 'verified',
      'verified', 'reported_physical', 'captured', 'synthetic_test', ?, ?
    )`)
    .run(evidenceField.fieldCode, objectKey, sha256, now, now);
  database.prepare(`INSERT INTO compliance_manual_field_integrity_receipts (
      id, organisation_id, capture_id, request_id, object_key,
      expected_sha256, observed_sha256, expected_size_bytes,
      observed_size_bytes, result, verification_scope, verified_by_uid,
      verified_at
    ) VALUES (
      'referenced-receipt', 'org-1', 'referenced-capture',
      'upload:referenced-session', ?, ?, ?, 1234, 1234, 'matched',
      'r2_object_bytes_and_embedded_metadata', 'current-tester', ?
    )`)
    .run(objectKey, sha256, sha256, now);
  const deleted = [];
  const rejected = await rejectUnattachedManualFieldUploadSession(
    d1,
    {
      id: "referenced-session",
      organisationId: "org-1",
      objectKey,
      reason: "concurrent_attach",
    },
    async (key) => {
      deleted.push(key);
    },
  );
  assert.equal(rejected, false);
  assert.deepEqual(deleted, []);
  assert.equal(
    database.prepare(`SELECT status
      FROM compliance_manual_field_upload_sessions
      WHERE id = 'referenced-session'`).get().status,
    "completing",
  );
});

test("media JSON is bounded and cleanup delegates to the custody guard", () => {
  assert.match(mediaRouteSource, /readBoundedJsonRequest\(request\)/);
  assert.doesNotMatch(mediaRouteSource, /request\.json\(\)/);
  assert.match(
    mediaRouteSource,
    /rejectUnattachedManualFieldUploadSession/,
  );
  assert.match(
    mediaRouteSource,
    /const recovered = await attachedCaptureForSession/,
  );
});

test("unreferenced upload rejection is terminal before object deletion", async () => {
  const { database, d1, evidenceField } = setupDatabase();
  const objectKey = "synthetic-manual-evidence/org-1/job-1/unreferenced";
  insertSession(database, {
    id: "unreferenced-session",
    fieldCode: evidenceField.fieldCode,
    testerUid: currentTester.uid,
    deviceId: "current-device-0001",
    objectKey,
  });
  database.prepare(`INSERT INTO compliance_manual_field_upload_parts (
      id, session_id, part_number, etag, size_bytes, created_at, updated_at
    ) VALUES ('part-1', 'unreferenced-session', 1, 'etag', 1234, ?, ?)`)
    .run(now, now);
  const statesAtDelete = [];
  const rejected = await rejectUnattachedManualFieldUploadSession(
    d1,
    {
      id: "unreferenced-session",
      organisationId: "org-1",
      objectKey,
      reason: "invalid_hash",
    },
    async () => {
      statesAtDelete.push(database.prepare(`SELECT status
        FROM compliance_manual_field_upload_sessions
        WHERE id = 'unreferenced-session'`).get().status);
    },
  );
  assert.equal(rejected, true);
  assert.deepEqual(statesAtDelete, ["rejected"]);
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_manual_field_upload_parts
      WHERE session_id = 'unreferenced-session'`).get().count,
    0,
  );
});

test("new assignee can replace prior-tester evidence at a max-one prompt", async () => {
  const { database, d1, evidenceField } = setupDatabase();
  const previousObjectKey =
    "synthetic-manual-evidence/org-1/job-1/previous";
  insertSession(database, {
    id: "previous-session",
    fieldCode: evidenceField.fieldCode,
    testerUid: "previous-tester",
    deviceId: "previous-device-0001",
    objectKey: previousObjectKey,
    status: "completed",
  });
  database.prepare(`INSERT INTO compliance_manual_evidence_test_captures (
      id, organisation_id, job_id, field_code, field_tester_uid, device_id,
      upload_session_id, object_key, file_name, content_type, size_bytes,
      original_sha256, evidence_envelope, server_verification,
      metadata_state, gps_state, capture_time_state, physical_device_state,
      status, record_mode, created_at, updated_at
    ) VALUES (
      'previous-capture', 'org-1', 'job-1', ?, 'previous-tester',
      'previous-device-0001', 'previous-session', ?, 'previous.jpg',
      'image/jpeg', 1234, ?, '{}', '{}', 'verified', 'verified',
      'verified', 'reported_physical', 'captured', 'synthetic_test', ?, ?
    )`)
    .run(
      evidenceField.fieldCode,
      previousObjectKey,
      "b".repeat(64),
      now,
      now,
    );
  const objectKey = "synthetic-manual-evidence/org-1/job-1/current";
  insertSession(database, {
    id: "current-session",
    fieldCode: evidenceField.fieldCode,
    testerUid: currentTester.uid,
    deviceId: "current-device-0001",
    objectKey,
  });
  const attached = await attachVerifiedManualFieldCapture(
    d1,
    currentTester,
    {
      captureId: "current-capture",
      sessionId: "current-session",
      jobId: "job-1",
      fieldCode: evidenceField.fieldCode,
      deviceId: "current-device-0001",
      objectKey,
      fileName: "capture.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1234,
      originalSha256: sha256,
      evidenceEnvelope: {},
      serverVerification: {},
      metadataState: "verified",
      gpsState: "verified",
      captureTimeState: "verified",
      physicalDeviceState: "reported_physical",
    },
  );
  assert.equal(attached.captureId, "current-capture");
  const response = JSON.parse(database.prepare(`SELECT response_snapshot
    FROM compliance_manual_evidence_test_jobs
    WHERE id = 'job-1'`).get().response_snapshot);
  const evidenceResponse = response.find(
    ({ fieldCode }) => fieldCode === evidenceField.fieldCode,
  );
  assert.deepEqual(
    evidenceResponse.captures.map(({ captureId }) => captureId),
    ["current-capture"],
  );
  assert.equal(
    database.prepare(`SELECT COUNT(*) count
      FROM compliance_manual_evidence_test_captures
      WHERE job_id = 'job-1'`).get().count,
    2,
    "the prior capture remains immutable audit history outside the current response",
  );
});

test("manual-device sign-out is owner-scoped and idempotent", async () => {
  const { database, d1 } = setupDatabase();
  database.prepare(`INSERT INTO compliance_manual_field_devices (
      id, organisation_id, firebase_uid, device_id, platform, device_name,
      app_version, is_physical_device, status, registered_at, last_seen_at,
      revoked_at, updated_at
    ) VALUES (
      'device-row-1', 'org-1', 'current-tester', 'current-device-0001',
      'android', 'Current handset', '1.0.0', 1, 'active', ?, ?, '', ?
    )`)
    .run(now, now, now);
  const revoked = await revokeManualFieldDevice(
    d1,
    currentTester,
    { deviceId: "current-device-0001" },
  );
  assert.deepEqual(revoked, {
    revoked: true,
    reused: false,
    mode: "creditex_manual",
  });
  const replay = await revokeManualFieldDevice(
    d1,
    currentTester,
    { deviceId: "current-device-0001" },
  );
  assert.deepEqual(replay, {
    revoked: true,
    reused: true,
    mode: "creditex_manual",
  });
  const otherTester = {
    ...currentTester,
    uid: "other-tester",
    membershipId: "member-other",
  };
  const otherResult = await revokeManualFieldDevice(
    d1,
    otherTester,
    { deviceId: "current-device-0001" },
  );
  assert.deepEqual(otherResult, {
    revoked: false,
    reused: true,
    mode: "creditex_manual",
  });
});
