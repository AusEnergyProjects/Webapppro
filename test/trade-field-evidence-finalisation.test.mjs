import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as boundedJsonRequest from "../src/lib/bounded-json-request.ts";
import { verifyJpegExif } from "../src/lib/jpeg-exif-verifier.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const mediaRouteSource = read("../src/app/api/trade-team/media/route.ts");
const devicesRouteSource = read("../src/app/api/trade-team/devices/route.ts");
const governanceMigration = read(
  "../drizzle/0098_creditex_rule_governance.sql",
);
const databaseSchema = read("../db/schema.ts");

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
  let batchTail = Promise.resolve();
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    batch(statements) {
      const execute = () => {
        database.exec("BEGIN");
        try {
          const results = statements.map((statement) => statement.runSync());
          database.exec("COMMIT");
          return results;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      };
      const result = batchTail.then(execute, execute);
      batchTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

function loadTypescriptModule(source, mocks) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: "src/app/api/trade-team/media/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "@/lib/bounded-json-request") {
      return boundedJsonRequest;
    }
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function evidenceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );

    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      event_type text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    );

    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      category text NOT NULL,
      file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      object_key text NOT NULL,
      caption text NOT NULL,
      evidence_envelope text NOT NULL CHECK (json_valid(evidence_envelope)),
      original_sha256 text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );

    CREATE TABLE trade_mobile_upload_sessions (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      actor_uid text NOT NULL,
      member_id text NOT NULL,
      device_id text NOT NULL,
      client_upload_id text NOT NULL,
      metadata_hash text NOT NULL,
      work_order_id text NOT NULL,
      object_key text NOT NULL,
      upload_id text NOT NULL,
      file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      category text NOT NULL,
      caption text NOT NULL,
      evidence_envelope text NOT NULL CHECK (json_valid(evidence_envelope)),
      original_sha256 text NOT NULL,
      part_size_bytes integer NOT NULL,
      status text NOT NULL,
      media_id text NOT NULL,
      expires_at text NOT NULL,
      completed_at text NOT NULL,
      last_error text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (owner_uid, client_upload_id),
      UNIQUE (object_key)
    );

    CREATE TABLE trade_mobile_upload_parts (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      part_number integer NOT NULL,
      etag text NOT NULL,
      size_bytes integer NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (session_id, part_number)
    );

    CREATE TABLE trade_mobile_upload_finalisation_guards (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL CHECK (trim(owner_uid) <> ''),
      session_id text NOT NULL CHECK (trim(session_id) <> ''),
      step_number integer NOT NULL CHECK (step_number > 0),
      verified integer NOT NULL CHECK (verified = 1),
      created_at text NOT NULL,
      UNIQUE (session_id, step_number)
    );

    CREATE TRIGGER trade_mobile_upload_finalisation_guards_session_guard
    BEFORE INSERT ON trade_mobile_upload_finalisation_guards
    WHEN NOT EXISTS (
      SELECT 1 FROM trade_mobile_upload_sessions session
      WHERE session.id = NEW.session_id
        AND session.owner_uid = NEW.owner_uid
    )
    BEGIN
      SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_SESSION_INVALID');
    END;

    CREATE TRIGGER trade_mobile_upload_finalisation_guards_no_update
    BEFORE UPDATE ON trade_mobile_upload_finalisation_guards
    BEGIN
      SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_GUARD_IMMUTABLE');
    END;

    CREATE TRIGGER trade_mobile_upload_finalisation_guards_no_delete
    BEFORE DELETE ON trade_mobile_upload_finalisation_guards
    BEGIN
      SELECT RAISE(ABORT, 'TRADE_MOBILE_FINALISATION_GUARD_IMMUTABLE');
    END;

    CREATE TABLE trade_team_sync_changes (
      sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      operation text NOT NULL,
      revision integer NOT NULL,
      changed_at text NOT NULL
    );

    CREATE TABLE trade_mobile_push_outbox (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      event_key text NOT NULL UNIQUE,
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      payload text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );

    CREATE TABLE trade_mobile_devices (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      actor_uid text NOT NULL,
      member_id text NOT NULL,
      device_id text NOT NULL,
      platform text NOT NULL,
      device_name text NOT NULL,
      app_version text NOT NULL,
      push_provider text NOT NULL,
      push_token text NOT NULL,
      push_token_updated_at text NOT NULL,
      status text NOT NULL,
      registered_at text NOT NULL,
      last_seen_at text NOT NULL,
      revoked_at text NOT NULL,
      revoked_by_uid text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (owner_uid, device_id)
    );

    CREATE TABLE trade_team_members (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      display_name text NOT NULL,
      email text NOT NULL
    );

    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      publish_state text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL
    );

    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      publish_state text NOT NULL
    );

    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      requirement_code text NOT NULL,
      evidence_type text NOT NULL,
      capture_timing text NOT NULL,
      maximum_count integer NOT NULL,
      allowed_content_types text NOT NULL,
      original_required integer NOT NULL,
      metadata_required integer NOT NULL,
      gps_required integer NOT NULL,
      date_stamp_required integer NOT NULL,
      installer_signature_required integer NOT NULL,
      customer_signature_required integer NOT NULL,
      condition_snapshot text NOT NULL,
      field_schema text NOT NULL
    );

    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      activity_version_id text NOT NULL,
      activity_date text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      status text NOT NULL,
      evidence_status text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );

    CREATE TABLE compliance_case_evidence (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      requirement_id text NOT NULL,
      job_media_id text NOT NULL,
      supersedes_evidence_id text NOT NULL,
      source_type text NOT NULL,
      status text NOT NULL,
      object_key text NOT NULL,
      file_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      original_sha256 text NOT NULL,
      evidence_envelope text NOT NULL,
      received_by_type text NOT NULL,
      received_by_uid text NOT NULL,
      received_at text NOT NULL,
      reviewed_by_uid text NOT NULL,
      reviewed_at text NOT NULL,
      retention_until text NOT NULL,
      legal_hold integer NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (job_media_id)
    );
    CREATE UNIQUE INDEX compliance_case_evidence_active_original_idx
      ON compliance_case_evidence (
        organisation_id, case_id, requirement_id, original_sha256
      )
      WHERE original_sha256 <> ''
        AND status IN ('received', 'under_review', 'accepted');

    CREATE TABLE compliance_case_events (
      id text PRIMARY KEY NOT NULL,
      case_id text NOT NULL,
      organisation_id text NOT NULL,
      event_type text NOT NULL,
      actor_type text NOT NULL,
      actor_uid text NOT NULL,
      summary text NOT NULL,
      metadata text NOT NULL,
      created_at text NOT NULL
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
  `);
  return database;
}

function evidenceBucket() {
  const objects = new Map();
  const completionBytes = new Map();
  const abortedKeys = [];
  const deletedKeys = [];
  let multipartSequence = 0;
  let barrier = null;
  let getPause = null;
  const deleteFailures = new Map();

  return {
    objects,
    completionBytes,
    abortedKeys,
    deletedKeys,
    failNextDelete(key, count = 1) {
      deleteFailures.set(key, count);
    },
    armGetBarrier(key, expectedArrivals) {
      let release;
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      barrier = { key, expectedArrivals, arrivals: 0, wait, release };
    },
    pauseNextGet(key) {
      let markArrived;
      let release;
      const arrived = new Promise((resolve) => {
        markArrived = resolve;
      });
      const wait = new Promise((resolve) => {
        release = resolve;
      });
      getPause = { key, arrived: false, markArrived, wait, release };
      return { arrived, release };
    },
    async createMultipartUpload() {
      multipartSequence += 1;
      return {
        uploadId: `multipart-${multipartSequence}`,
        async uploadPart(partNumber) {
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete() {},
        async abort() {},
      };
    },
    resumeMultipartUpload(key) {
      return {
        uploadId: "resumed",
        async uploadPart(partNumber) {
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete() {
          const bytes = completionBytes.get(key);
          if (!bytes) throw new Error("NO_TEST_MULTIPART_BYTES");
          objects.set(key, bytes);
        },
        async abort() {
          abortedKeys.push(key);
        },
      };
    },
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async get(key) {
      if (getPause?.key === key && !getPause.arrived) {
        getPause.arrived = true;
        getPause.markArrived();
        await getPause.wait;
      }
      if (barrier?.key === key) {
        barrier.arrivals += 1;
        if (barrier.arrivals >= barrier.expectedArrivals) barrier.release();
        await barrier.wait;
      }
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        async arrayBuffer() {
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    },
    async delete(key) {
      const remainingFailures = deleteFailures.get(key) || 0;
      if (remainingFailures > 0) {
        deleteFailures.set(key, remainingFailures - 1);
        throw new Error("TRANSIENT_DELETE_FAILURE");
      }
      deletedKeys.push(key);
      objects.delete(key);
    },
  };
}

function routeHarness(database, storage, options = {}) {
  const d1 = testD1(database);
  const access = {
    ownerUid: "installer-owner",
    actorUid: "installer-actor",
    memberId: "member-1",
    role: "technician",
  };
  const route = loadTypescriptModule(mediaRouteSource, {
    "cloudflare:workers": { env: { EVIDENCE: storage } },
    "../../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      cleanAdminText: (value, maximum) => (
        typeof value === "string" ? value.trim().slice(0, maximum) : ""
      ),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      assignedJob: async (_access, workOrderId) => {
        const job = database.prepare(
          "SELECT revision FROM trade_work_orders WHERE id = ? AND firebase_uid = ?",
        ).get(workOrderId, access.ownerUid);
        if (!job) throw new Error("JOB_NOT_FOUND");
        return {
          revision: Number(job.revision),
          assignee_member_id: access.memberId,
          source_type: "internal",
        };
      },
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": {
      nextJobRevision: (value) => {
        const revision = Number(value);
        return Number.isSafeInteger(revision) && revision > 0 ? revision + 1 : 2;
      },
    },
    "@/lib/trade-mobile-server": {
      MOBILE_CLIENT_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/,
      mobileErrorResponse: () => null,
      requireRegisteredMobileDevice: async (request, _access, deviceId, platform = "", appVersion = "") => {
        if (options.registrationGate?.method === request.method) {
          options.registrationGate.markArrived();
          await options.registrationGate.wait;
        }
        return {
          id: "device-row-1",
          deviceId,
          platform: platform || "ios",
          appVersion: appVersion || "1.0.0",
          deviceName: "Field phone",
        };
      },
    },
    "@/lib/jpeg-exif-verifier": { verifyJpegExif },
  });
  return { route, access };
}

function deviceRouteHarness(database, storage, options = {}) {
  const d1 = testD1(database);
  const access = {
    ownerUid: "installer-owner",
    actorUid: "installer-actor",
    memberId: "member-1",
    role: "owner",
  };
  const route = loadTypescriptModule(devicesRouteSource, {
    "cloudflare:workers": { env: { EVIDENCE: storage } },
    "../../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson: (body, status = 200) => Response.json(body, { status }),
      cleanAdminText: (value, maximum) => (
        typeof value === "string" ? value.trim().slice(0, maximum) : ""
      ),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      canManageTeam: () => true,
      requireInstallerTeamAccess: async (request) => {
        if (options.accessGate?.method === request.method) {
          options.accessGate.markArrived();
          await options.accessGate.wait;
        }
        return access;
      },
    },
    "@/lib/trade-mobile-server": {
      appVersionAccepted: () => true,
      mobileAppPolicy: (platform) => ({
        contractVersion: 3,
        platform,
        minimumVersion: "1.0.0",
      }),
      MOBILE_CLIENT_ID_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/,
      MOBILE_PLATFORMS: new Set(["ios", "android"]),
      mobileErrorResponse: () => null,
    },
  });
  return { route, access };
}

function manualGate(method) {
  let markArrived;
  let release;
  const arrived = new Promise((resolve) => {
    markArrived = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  return { method, arrived, markArrived, wait, release };
}

function post(route, body) {
  return route.POST(new Request("https://app.example/api/trade-team/media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function remove(route, sessionId, deviceId = "device-001") {
  return route.DELETE(new Request(
    `https://app.example/api/trade-team/media?deviceId=${encodeURIComponent(deviceId)}&sessionId=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  ));
}

function patchDevice(route, id = "device-row-1") {
  return route.PATCH(new Request("https://app.example/api/trade-team/devices", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "revoke_device", id }),
  }));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const FILE_BYTES = {
  "image/jpeg": Uint8Array.from(Buffer.from(
    "/9j/4QC6RXhpZgAASUkqAAgAAAACAGmHBAABAAAAJgAAACWIBAABAAAATAAAAAAAAAABAAOQAgAUAAAAOAAAAAAAAAAyMDI2OjA4OjAxIDEyOjM0OjU2AAQAAQACAAIAAABTAAAAAgAFAAMAAACCAAAAAwACAAIAAABFAAAABAAFAAMAAACaAAAAAAAAACUAAAABAAAAMAAAAAEAAAAeAAAAAQAAAJAAAAABAAAAOQAAAAEAAAAAAAAAAQAAAP/AAAsIAAEAAQEBEQD/2gAIAQEAAD8AAP/Z",
    "base64",
  )),
  "image/png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]),
  "application/pdf": new TextEncoder().encode("%PDF-1.7\n"),
};
const JPEG_WITHOUT_EXIF_BYTES = Uint8Array.from(Buffer.from(
  "/9j/wAALCAABAAEBAREA/9oACAEBAAA/AAD/2Q==",
  "base64",
));

function jpegWithEmbeddedCaptureDate(value) {
  const bytes = Uint8Array.from(FILE_BYTES["image/jpeg"]);
  const current = Buffer.from("2026:08:01 12:34:56");
  const replacement = Buffer.from(value);
  assert.equal(replacement.byteLength, current.byteLength);
  const index = Buffer.from(bytes).indexOf(current);
  assert.notEqual(index, -1);
  bytes.set(replacement, index);
  return bytes;
}

function validEnvelope(overrides = {}, bytes = FILE_BYTES["image/jpeg"]) {
  const envelope = {
    schemaVersion: 1,
    source: "in_app_camera",
    captureSessionId: "capture-session-001",
    identifiers: {
      jobId: "job-compliance",
      complianceCaseId: "case-1",
      complianceActivityVersionId: "activity-1",
      evidencePolicyVersionId: "policy-pinned",
      evidenceRequirementId: "requirement-pinned",
      evidenceRequirementCode: "SITE_BEFORE",
    },
    integrity: {
      algorithm: "SHA-256",
      digestHex: sha256(bytes),
      byteLength: bytes.byteLength,
      computedAtUtc: "2026-08-01T02:34:58.000Z",
    },
    capture: {
      observedAtUtc: "2026-08-01T02:34:56.000Z",
      utcOffsetMinutes: 600,
      timeZone: "Australia/Melbourne",
    },
    original: {
      preservedWithoutAppTransformation: true,
      editingApplied: false,
      exifState: "available",
      exif: { DateTimeOriginal: "2026:08:01 10:00:00" },
    },
    location: {
      state: "captured",
      latitude: -37.80833333333333,
      longitude: 144.95,
      accuracyMetres: 8.5,
      observedAtUtc: "2026-08-01T02:34:56.000Z",
      mocked: false,
    },
    provenance: {
      installationId: "device-001",
      appVersion: "1.0.0",
      platform: "ios",
      isPhysicalDevice: true,
    },
    acceptance: {
      status: "not_assessed",
    },
  };
  return {
    ...envelope,
    ...overrides,
    identifiers: {
      ...envelope.identifiers,
      ...(overrides.identifiers || {}),
    },
    integrity: {
      ...envelope.integrity,
      ...(overrides.integrity || {}),
    },
    capture: {
      ...envelope.capture,
      ...(overrides.capture || {}),
    },
    original: {
      ...envelope.original,
      ...(overrides.original || {}),
    },
    location: {
      ...envelope.location,
      ...(overrides.location || {}),
    },
    provenance: {
      ...envelope.provenance,
      ...(overrides.provenance || {}),
    },
    acceptance: {
      ...envelope.acceptance,
      ...(overrides.acceptance || {}),
    },
  };
}

function seedJobsAndCompliance(database) {
  const now = "2026-08-01T03:00:00.000Z";
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, revision, updated_at)
    VALUES ('job-compliance', 'installer-owner', 1, ?),
      ('job-legacy', 'installer-owner', 1, ?)`).run(now, now);
  database.prepare(`INSERT INTO compliance_activity_versions
    (id, publish_state, effective_from, effective_to)
    VALUES ('activity-1', 'published', '2026-01-01', '')`).run();
  database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, organisation_id, activity_version_id, publish_state)
    VALUES
      ('policy-pinned', 'org-creditex', 'activity-1', 'published'),
      ('policy-later', 'org-creditex', 'activity-1', 'published')`).run();
  database.prepare(`INSERT INTO compliance_evidence_requirements
     (id, organisation_id, policy_version_id, requirement_code,
      evidence_type, capture_timing, maximum_count,
     allowed_content_types, original_required, metadata_required,
     gps_required, date_stamp_required, installer_signature_required,
     customer_signature_required, condition_snapshot, field_schema)
    VALUES
      ('requirement-pinned', 'org-creditex', 'policy-pinned', 'SITE_BEFORE',
       'photo', 'any', 1, '["image/jpeg"]', 0, 1, 1, 1, 0, 0, '{}', '{}'),
      ('requirement-later', 'org-creditex', 'policy-later', 'SITE_BEFORE_V2',
       'photo', 'any', 1, '["image/jpeg"]', 0, 1, 1, 1, 0, 0, '{}', '{}')`).run();
  database.prepare(`INSERT INTO compliance_cases
    (id, organisation_id, work_order_id, installer_uid, activity_version_id,
     activity_date, evidence_policy_version_id, status, evidence_status,
     revision, updated_at)
    VALUES ('case-1', 'org-creditex', 'job-compliance', 'installer-owner',
      'activity-1', '2026-08-01', 'policy-pinned', 'accepted', 'verified',
      1, ?)`).run(now);
  database.prepare(`INSERT INTO trade_mobile_devices
    (id, owner_uid, actor_uid, member_id, device_id, platform, device_name,
     app_version, push_provider, push_token, push_token_updated_at, status,
     registered_at, last_seen_at, revoked_at, revoked_by_uid, updated_at)
    VALUES ('device-row-1', 'installer-owner', 'installer-actor', 'member-1',
      'device-001', 'ios', 'Field phone', '1.0.0', 'apns', 'push-token', ?,
      'active', ?, ?, '', '', ?)`).run(now, now, now, now);
  database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, display_name, email)
    VALUES ('member-1', 'installer-owner', 'Field installer',
      'field@example.test')`).run();
}

function seedUpload(database, storage, {
  id,
  workOrderId = "job-legacy",
  contentType = "image/jpeg",
  bytes = FILE_BYTES[contentType],
  evidenceEnvelope,
  deviceId = "device-001",
  status = "uploading",
}) {
  const now = "2026-08-01T04:00:00.000Z";
  const objectKey = `crm-job-media/installer-owner/${workOrderId}/${id}`;
  const envelope = evidenceEnvelope === undefined ? "{}" : JSON.stringify(evidenceEnvelope);
  storage.completionBytes.set(objectKey, bytes);
  database.prepare(`INSERT INTO trade_mobile_upload_sessions
    (id, owner_uid, actor_uid, member_id, device_id, client_upload_id,
     metadata_hash, work_order_id, object_key, upload_id, file_name,
     content_type, size_bytes, category, caption, evidence_envelope,
     original_sha256, part_size_bytes, status, media_id, expires_at,
     completed_at, last_error, created_at, updated_at)
    VALUES (?, 'installer-owner', 'installer-actor', 'member-1', ?,
      ?, 'metadata-hash', ?, ?, ?, ?, ?, ?, 'before', '', ?, ?, 5242880,
      ?, '', '2099-01-01T00:00:00.000Z', '', '', ?, ?)`)
    .run(
      id,
      deviceId,
      `client-${id}`,
      workOrderId,
      objectKey,
      `multipart-${id}`,
      `${id}.${contentType === "application/pdf" ? "pdf" : "bin"}`,
      contentType,
      bytes.byteLength,
      envelope,
      sha256(bytes),
      status,
      now,
      now,
    );
  database.prepare(`INSERT INTO trade_mobile_upload_parts
    (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
    VALUES (?, ?, 1, 'etag-1', ?, ?, ?)`)
    .run(`part-${id}`, id, bytes.byteLength, now, now);
  return objectKey;
}

test("field evidence source enforces guarded finalisation and pinned custody rules", () => {
  assert.match(
    mediaRouteSource,
    /UPDATE trade_mobile_upload_sessions[\s\S]*status IN \('initiated', 'uploading'\)[\s\S]*media_id = ''/,
  );
  assert.match(mediaRouteSource, /claim\.meta\.changes/);
  assert.match(mediaRouteSource, /trade_mobile_upload_finalisation_guards/);
  assert.match(mediaRouteSource, /FINALISATION_CLAIM_STEP/);
  assert.match(mediaRouteSource, /FINALISATION_VERIFIED_STEP/);
  assert.match(mediaRouteSource, /results\[index\]\?\.meta\.changes/);
  assert.doesNotMatch(
    mediaRouteSource,
    /INSERT OR IGNORE INTO (?:trade_crm_job_media|compliance_case_evidence)/,
  );
  assert.match(
    mediaRouteSource,
    /p\.id = c\.evidence_policy_version_id/,
  );
  assert.match(
    mediaRouteSource,
    /status IN \('ready_for_submission', 'accepted'\) THEN 'in_review'/,
  );
  assert.match(mediaRouteSource, /location\.latitude >= -90/);
  assert.match(mediaRouteSource, /location\.longitude <= 180/);
  assert.match(mediaRouteSource, /MAX_LOCATION_ACCURACY_METRES/);
  assert.match(mediaRouteSource, /EVIDENCE_GPS_MOCKED/);
  assert.match(mediaRouteSource, /EVIDENCE_FILE_SIGNATURE_MISMATCH/);
  assert.match(mediaRouteSource, /client_supplied_non_authoritative/);
  assert.match(mediaRouteSource, /EVIDENCE_PHYSICAL_DEVICE_REQUIRED/);
  assert.match(mediaRouteSource, /EVIDENCE_REQUIREMENT_UNSUPPORTED/);
  assert.match(mediaRouteSource, /EVIDENCE_CAPTURE_TIMING_UNSUPPORTED/);
  assert.match(mediaRouteSource, /r\.capture_timing = 'any'/);
  assert.match(mediaRouteSource, /EVIDENCE_MAXIMUM_REACHED/);
  assert.match(mediaRouteSource, /EVIDENCE_DUPLICATE_ORIGINAL/);
  assert.match(mediaRouteSource, /COMPLIANCE_EVIDENCE_MAXIMUM_REACHED/);
  assert.match(
    mediaRouteSource,
    /COUNT\(DISTINCT current_evidence\.original_sha256\)/,
  );
  assert.match(mediaRouteSource, /maximum_count_reached/);
  assert.match(mediaRouteSource, /duplicate_original/);
  assert.match(mediaRouteSource, /verifyJpegExif/);
  assert.match(mediaRouteSource, /server_parsed_assembled_bytes/);
  assert.match(mediaRouteSource, /EVIDENCE_EMBEDDED_METADATA_REQUIRED/);
  assert.match(mediaRouteSource, /EVIDENCE_EMBEDDED_GPS_REQUIRED/);
  assert.match(mediaRouteSource, /EVIDENCE_LOCATION_MISMATCH/);
  assert.match(mediaRouteSource, /current_evidence\.status IN \('received', 'under_review', 'accepted'\)/);
  assert.match(mediaRouteSource, /p\.publish_state IN \('published', 'withdrawn'\)/);
  assert.match(mediaRouteSource, /supersedesEvidenceId/);
  assert.match(mediaRouteSource, /SET status = 'superseded'/);
  assert.match(
    mediaRouteSource,
    /SET status = 'aborted'[\s\S]*status IN \('initiated', 'uploading', 'completing'\)[\s\S]*const aborted = Number\(claim\.meta\.changes/,
  );
  assert.match(
    devicesRouteSource,
    /SET status = 'aborted'[\s\S]*status IN \('initiated', 'uploading', 'completing'\)[\s\S]*claim\.meta\.changes/,
  );
  assert.match(mediaRouteSource, /exactText\(original\.exifState, 40\) !== "available"/);
  assert.match(mediaRouteSource, /bucket\(\)\.get\(session\.object_key\)/);
  assert.match(mediaRouteSource, /assembledSha256 !== session\.original_sha256/);
  assert.match(
    governanceMigration,
    /CREATE UNIQUE INDEX `compliance_case_evidence_active_original_idx`[\s\S]*WHERE `original_sha256` <> '' AND `status` IN \('received', 'under_review', 'accepted'\)/,
  );
  assert.match(
    databaseSchema,
    /uniqueIndex\("compliance_case_evidence_active_original_idx"\)/,
  );
  assert.match(mediaRouteSource, /async function sweepTerminalUploadCleanup/);
  assert.match(mediaRouteSource, /LIMIT \?`[\s\S]*MAX_CLEANUP_SWEEP/);
  assert.doesNotMatch(
    mediaRouteSource.slice(
      mediaRouteSource.indexOf("async function sweepTerminalUploadCleanup"),
      mediaRouteSource.indexOf("async function initiate"),
    ),
    /access\.ownerUid|actor_uid = \?|device_id = \?/,
  );
});

test("concurrent completion creates one custody chain and returns a verified duplicate", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  const bytes = FILE_BYTES["image/jpeg"];
  const envelope = validEnvelope({}, bytes);
  const objectKey = "crm-job-media/installer-owner/job-compliance/session-1";
  const now = "2026-08-01T03:00:00.000Z";
  storage.completionBytes.set(objectKey, bytes);
  storage.armGetBarrier(objectKey, 2);
  database.prepare(`INSERT INTO trade_mobile_upload_sessions
    (id, owner_uid, actor_uid, member_id, device_id, client_upload_id,
     metadata_hash, work_order_id, object_key, upload_id, file_name,
     content_type, size_bytes, category, caption, evidence_envelope,
     original_sha256, part_size_bytes, status, media_id, expires_at,
     completed_at, last_error, created_at, updated_at)
    VALUES ('session-1', 'installer-owner', 'installer-actor', 'member-1',
      'device-001', 'client-upload-001', 'metadata-hash', 'job-compliance',
      ?, 'multipart-1', 'before.jpg', 'image/jpeg', ?, 'before', '',
      ?, ?, 5242880, 'uploading', '', '2099-01-01T00:00:00.000Z',
      '', '', ?, ?)`)
    .run(objectKey, bytes.byteLength, JSON.stringify(envelope), sha256(bytes), now, now);
  database.prepare(`INSERT INTO trade_mobile_upload_parts
    (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
    VALUES ('part-1', 'session-1', 1, 'etag-1', ?, ?, ?)`).run(bytes.byteLength, now, now);

  const request = {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "session-1",
  };
  const responses = await Promise.all([
    post(route, request),
    post(route, request),
  ]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 201],
    JSON.stringify(payloads),
  );
  assert.equal(payloads.filter((payload) => payload.result.duplicate === true).length, 1);
  assert.equal(payloads.filter((payload) => payload.result.duplicate === false).length, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_case_evidence").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_case_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_audit_events").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_mobile_push_outbox").get().count, 1);
  assert.deepEqual(
    database.prepare(`SELECT step_number, verified, owner_uid
      FROM trade_mobile_upload_finalisation_guards ORDER BY step_number`)
      .all()
      .map((row) => ({ ...row })),
    [
      { step_number: 1, verified: 1, owner_uid: "installer-owner" },
      { step_number: 2, verified: 1, owner_uid: "installer-owner" },
    ],
  );
  assert.deepEqual(
    { ...database.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job-compliance'").get() },
    { revision: 2 },
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, evidence_status, revision
      FROM compliance_cases WHERE id = 'case-1'`).get() },
    { status: "in_review", evidence_status: "in_progress", revision: 2 },
  );
  const completed = database.prepare(`SELECT status, media_id, original_sha256
    FROM trade_mobile_upload_sessions WHERE id = 'session-1'`).get();
  assert.equal(completed.status, "completed");
  assert.notEqual(completed.media_id, "");
  assert.equal(completed.original_sha256, sha256(bytes));
  const storedEvidenceEnvelope = JSON.parse(database.prepare(`
    SELECT evidence_envelope
    FROM compliance_case_evidence
    WHERE case_id = 'case-1'
  `).get().evidence_envelope);
  assert.equal(
    storedEvidenceEnvelope.serverVerification.authority,
    "server_parsed_assembled_bytes",
  );
  assert.equal(
    storedEvidenceEnvelope.serverVerification.originalSha256,
    sha256(bytes),
  );
  assert.equal(
    storedEvidenceEnvelope.serverVerification.embeddedJpegExif.status,
    "valid",
  );

  const retry = await post(route, request);
  const retryPayload = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryPayload.duplicate, true);
  assert.equal(retryPayload.result.duplicate, true);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_case_evidence").get().count, 1);
  assert.equal(database.prepare("SELECT revision FROM trade_work_orders WHERE id = 'job-compliance'").get().revision, 2);
  assert.equal(database.prepare("SELECT revision FROM compliance_cases WHERE id = 'case-1'").get().revision, 2);
});

test("competing sessions cannot activate the same evidence original twice", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  database.prepare(`UPDATE compliance_evidence_requirements
    SET maximum_count = 2 WHERE id = 'requirement-pinned'`).run();
  const { route } = routeHarness(database, storage);
  const bytes = FILE_BYTES["image/jpeg"];
  for (const id of ["duplicate-race-a", "duplicate-race-b"]) {
    seedUpload(database, storage, {
      id,
      workOrderId: "job-compliance",
      bytes,
      evidenceEnvelope: validEnvelope({}, bytes),
    });
  }

  const responses = await Promise.all(
    ["duplicate-race-a", "duplicate-race-b"].map((sessionId) =>
      post(route, {
        action: "complete",
        deviceId: "device-001",
        platform: "ios",
        appVersion: "1.0.0",
        sessionId,
      })
    ),
  );
  const payloads = await Promise.all(
    responses.map((response) => response.json()),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
    JSON.stringify(payloads),
  );
  const duplicate = payloads.find(
    (payload) => payload.code === "EVIDENCE_DUPLICATE_ORIGINAL",
  );
  assert.ok(duplicate, JSON.stringify(payloads));
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM compliance_case_evidence
    WHERE status IN ('received', 'under_review', 'accepted')`).get().count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_crm_job_media`).get().count, 1);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_work_order_events`).get().count, 1);
  assert.equal(database.prepare(`SELECT revision
    FROM trade_work_orders WHERE id = 'job-compliance'`).get().revision, 2);
  assert.deepEqual(
    database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions ORDER BY id`)
      .all()
      .map((row) => `${row.status}:${row.last_error}`)
      .sort(),
    [
      "completed:",
      "rejected:duplicate_original",
    ],
  );
  assert.equal(storage.objects.size, 1);
});

test("initiation rejects invalid GPS and EXIF evidence while retaining legacy uploads", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  let sequence = 0;
  const initiate = async (evidenceEnvelope, workOrderId = "job-compliance") => {
    sequence += 1;
    const response = await post(route, {
      action: "initiate",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      clientUploadId: `client-${String(sequence).padStart(4, "0")}`,
      workOrderId,
      fileName: "before.jpg",
      contentType: "image/jpeg",
      sizeBytes: FILE_BYTES["image/jpeg"].byteLength,
      category: "before",
      caption: "",
      ...(evidenceEnvelope === undefined ? {} : { evidenceEnvelope }),
    });
    return { response, payload: await response.json() };
  };

  const invalidLocations = [
    { latitude: 91 },
    { latitude: -91 },
    { longitude: 181 },
    { longitude: -181 },
    { accuracyMetres: -0.1 },
    { accuracyMetres: 101 },
    { accuracyMetres: null },
    { observedAtUtc: "" },
  ];
  for (const location of invalidLocations) {
    const { response, payload } = await initiate(validEnvelope({ location }));
    assert.equal(response.status, 400);
    assert.equal(payload.code, "EVIDENCE_LOCATION_INVALID");
  }

  const mocked = await initiate(validEnvelope({ location: { mocked: true } }));
  assert.equal(mocked.response.status, 400);
  assert.equal(mocked.payload.code, "EVIDENCE_GPS_MOCKED");

  const exifNotReturned = await initiate(validEnvelope({
    original: { exifState: "not_returned", exif: {} },
  }));
  assert.equal(exifNotReturned.response.status, 400);
  assert.equal(exifNotReturned.payload.code, "EVIDENCE_METADATA_REQUIRED");

  const exifMissing = await initiate(validEnvelope({
    original: { exifState: "available", exif: null },
  }));
  assert.equal(exifMissing.response.status, 400);
  assert.equal(exifMissing.payload.code, "EVIDENCE_METADATA_REQUIRED");

  const wrongInstallation = await initiate(validEnvelope({
    provenance: { installationId: "device-other" },
  }));
  assert.equal(wrongInstallation.response.status, 409);
  assert.equal(wrongInstallation.payload.code, "EVIDENCE_PROVENANCE_INVALID");

  const simulator = await initiate(validEnvelope({
    provenance: { isPhysicalDevice: false },
  }));
  assert.equal(simulator.response.status, 400);
  assert.equal(simulator.payload.code, "EVIDENCE_PHYSICAL_DEVICE_REQUIRED");

  const invalidTimeZone = await initiate(validEnvelope({
    capture: { utcOffsetMinutes: "600" },
  }));
  assert.equal(invalidTimeZone.response.status, 400);
  assert.equal(
    invalidTimeZone.payload.code,
    "EVIDENCE_CAPTURE_TIME_ZONE_INVALID",
  );

  const oversizedEnvelope = validEnvelope();
  oversizedEnvelope.padding = "x".repeat(61 * 1024);
  const oversized = await initiate(oversizedEnvelope);
  assert.equal(oversized.response.status, 400);
  assert.equal(oversized.payload.code, "EVIDENCE_ENVELOPE_INVALID");

  const integrityBeforeCapture = await initiate(validEnvelope({
    integrity: { computedAtUtc: "2026-08-01T02:34:55.000Z" },
  }));
  assert.equal(integrityBeforeCapture.response.status, 400);
  assert.equal(integrityBeforeCapture.payload.code, "EVIDENCE_TIME_ORDER_INVALID");

  const staleLocation = await initiate(validEnvelope({
    location: { observedAtUtc: "2026-08-01T02:00:00.000Z" },
  }));
  assert.equal(staleLocation.response.status, 400);
  assert.equal(staleLocation.payload.code, "EVIDENCE_TIME_ORDER_INVALID");

  const laterPolicy = await initiate(validEnvelope({
    identifiers: {
      evidencePolicyVersionId: "policy-later",
      evidenceRequirementId: "requirement-later",
      evidenceRequirementCode: "SITE_BEFORE_V2",
    },
  }));
  assert.equal(laterPolicy.response.status, 409);
  assert.equal(laterPolicy.payload.code, "EVIDENCE_LINK_INVALID");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET capture_timing = 'pre_install' WHERE id = 'requirement-pinned'`).run();
  const unsupportedTiming = await initiate(validEnvelope());
  assert.equal(unsupportedTiming.response.status, 409);
  assert.equal(
    unsupportedTiming.payload.code,
    "EVIDENCE_CAPTURE_TIMING_UNSUPPORTED",
  );
  database.prepare(`UPDATE compliance_evidence_requirements
    SET capture_timing = 'any' WHERE id = 'requirement-pinned'`).run();

  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'withdrawn' WHERE id = 'policy-pinned'`).run();
  const pinnedPolicy = await initiate(validEnvelope());
  assert.equal(pinnedPolicy.response.status, 201);
  assert.equal(pinnedPolicy.payload.upload.status, "initiated");
  const storedEnvelope = JSON.parse(database.prepare(`
    SELECT evidence_envelope FROM trade_mobile_upload_sessions
    WHERE id = ?
  `).get(pinnedPolicy.payload.upload.id).evidence_envelope);
  assert.equal(
    storedEnvelope.original.exifAuthority,
    "client_supplied_non_authoritative",
  );

  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'draft' WHERE id = 'policy-pinned'`).run();
  const draftPolicy = await initiate(validEnvelope());
  assert.equal(draftPolicy.response.status, 409);
  assert.equal(draftPolicy.payload.code, "EVIDENCE_LINK_INVALID");

  const legacy = await initiate(undefined, "job-legacy");
  assert.equal(legacy.response.status, 201);
  assert.equal(legacy.payload.upload.status, "initiated");
  assert.equal(
    database.prepare(`SELECT evidence_envelope FROM trade_mobile_upload_sessions
      WHERE id = ?`).get(legacy.payload.upload.id).evidence_envelope,
    "{}",
  );
});

test("completion rejects and cleans legacy envelopes without room for the server verification stamp", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  const envelope = validEnvelope();
  const targetBytes = 65_500;
  const unpaddedBytes = Buffer.byteLength(JSON.stringify({
    ...envelope,
    padding: "",
  }));
  envelope.padding = "x".repeat(targetBytes - unpaddedBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(envelope)), targetBytes);
  const objectKey = seedUpload(database, storage, {
    id: "legacy-oversized-envelope",
    workOrderId: "job-compliance",
    evidenceEnvelope: envelope,
  });

  const response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "legacy-oversized-envelope",
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.code, "EVIDENCE_ENVELOPE_INVALID");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'legacy-oversized-envelope'`).get() },
    {
      status: "rejected",
      last_error: "server_verification_envelope_invalid",
    },
  );
  assert.equal(storage.objects.has(objectKey), false);
});

test("completion rejects fabricated sidecar EXIF and embedded location mismatches", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);

  const noExifObjectKey = seedUpload(database, storage, {
    id: "client-exif-only",
    workOrderId: "job-compliance",
    bytes: JPEG_WITHOUT_EXIF_BYTES,
    evidenceEnvelope: validEnvelope({}, JPEG_WITHOUT_EXIF_BYTES),
  });
  let response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "client-exif-only",
  });
  let payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, "EVIDENCE_EMBEDDED_METADATA_REQUIRED");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions WHERE id = 'client-exif-only'`).get() },
    { status: "rejected", last_error: "embedded_metadata_missing" },
  );
  assert.equal(storage.objects.has(noExifObjectKey), false);

  const mismatchObjectKey = seedUpload(database, storage, {
    id: "embedded-location-mismatch",
    workOrderId: "job-compliance",
    evidenceEnvelope: validEnvelope({
      location: { latitude: -33.8688, longitude: 151.2093 },
    }),
  });
  response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "embedded-location-mismatch",
  });
  payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, "EVIDENCE_LOCATION_MISMATCH");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'embedded-location-mismatch'`).get() },
    { status: "rejected", last_error: "embedded_location_mismatch" },
  );
  assert.equal(storage.objects.has(mismatchObjectKey), false);

  const captureTimeMismatchObjectKey = seedUpload(database, storage, {
    id: "embedded-capture-time-mismatch",
    workOrderId: "job-compliance",
    evidenceEnvelope: validEnvelope({
      capture: { observedAtUtc: "2026-08-01T03:34:56.000Z" },
      integrity: { computedAtUtc: "2026-08-01T03:34:58.000Z" },
      location: { observedAtUtc: "2026-08-01T03:34:56.000Z" },
    }),
  });
  response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "embedded-capture-time-mismatch",
  });
  payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, "EVIDENCE_EMBEDDED_CAPTURE_TIME_MISMATCH");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'embedded-capture-time-mismatch'`).get() },
    { status: "rejected", last_error: "embedded_capture_time_mismatch" },
  );
  assert.equal(storage.objects.has(captureTimeMismatchObjectKey), false);
});

test("governed initiation fails closed for unsupported requirement contracts and finite maxima", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  let sequence = 0;
  const initiate = async () => {
    sequence += 1;
    const response = await post(route, {
      action: "initiate",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      clientUploadId: `compatibility-${String(sequence).padStart(4, "0")}`,
      workOrderId: "job-compliance",
      fileName: "before.jpg",
      contentType: "image/jpeg",
      sizeBytes: FILE_BYTES["image/jpeg"].byteLength,
      category: "before",
      caption: "",
      evidenceEnvelope: validEnvelope(),
    });
    return { response, payload: await response.json() };
  };

  database.prepare(`UPDATE compliance_evidence_requirements
    SET original_required = 1
    WHERE id = 'requirement-pinned'`).run();
  let result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_REQUIREMENT_UNSUPPORTED");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET original_required = 0, installer_signature_required = 1
    WHERE id = 'requirement-pinned'`).run();
  result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_REQUIREMENT_UNSUPPORTED");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET installer_signature_required = 0, condition_snapshot = '{"when":"site"}'
    WHERE id = 'requirement-pinned'`).run();
  result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_REQUIREMENT_UNSUPPORTED");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET condition_snapshot = '{}', field_schema = '{"fields":[]}'
    WHERE id = 'requirement-pinned'`).run();
  result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_REQUIREMENT_UNSUPPORTED");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET field_schema = '{}', evidence_type = 'signature'
    WHERE id = 'requirement-pinned'`).run();
  result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_REQUIREMENT_UNSUPPORTED");

  database.prepare(`UPDATE compliance_evidence_requirements
    SET evidence_type = 'photo'
    WHERE id = 'requirement-pinned'`).run();
  const maximumRaceObjectKey = seedUpload(database, storage, {
    id: "maximum-race",
    workOrderId: "job-compliance",
    evidenceEnvelope: validEnvelope(),
  });
  const now = "2026-08-01T00:00:00.000Z";
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, job_media_id,
     supersedes_evidence_id, source_type, status, object_key, file_name,
     content_type, size_bytes, original_sha256, evidence_envelope,
     received_by_type, received_by_uid, received_at, reviewed_by_uid,
     reviewed_at, retention_until, legal_hold, created_at, updated_at)
    VALUES ('evidence-at-maximum', 'org-creditex', 'case-1',
      'requirement-pinned', 'existing-job-media', '', 'field_app', 'received',
      'existing-object', 'existing.jpg', 'image/jpeg', 4, ?, '{}',
      'installer', 'installer-actor', ?, '', '', '', 0, ?, ?)`)
    .run("b".repeat(64), now, now, now);
  result = await initiate();
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "EVIDENCE_MAXIMUM_REACHED");

  const completion = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "maximum-race",
  });
  const completionPayload = await completion.json();
  assert.equal(completion.status, 409);
  assert.equal(completionPayload.code, "EVIDENCE_MAXIMUM_REACHED");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions WHERE id = 'maximum-race'`).get() },
    { status: "rejected", last_error: "maximum_count_reached" },
  );
  assert.equal(storage.objects.has(maximumRaceObjectKey), false);
});

test("DELETE and completion races clean only an upload claimed for abort", async () => {
  {
    const database = evidenceDatabase();
    const storage = evidenceBucket();
    seedJobsAndCompliance(database);
    const { route } = routeHarness(database, storage);
    const objectKey = seedUpload(database, storage, { id: "abort-wins" });
    const pause = storage.pauseNextGet(objectKey);
    const completing = post(route, {
      action: "complete",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      sessionId: "abort-wins",
    });
    await pause.arrived;
    const aborted = await remove(route, "abort-wins");
    const abortPayload = await aborted.json();
    assert.equal(aborted.status, 200);
    assert.equal(abortPayload.aborted, true);
    pause.release();
    const completion = await completing;
    assert.notEqual(completion.status, 201);
    assert.deepEqual(
      { ...database.prepare(`SELECT status, media_id
        FROM trade_mobile_upload_sessions WHERE id = 'abort-wins'`).get() },
      { status: "aborted", media_id: "" },
    );
    assert.equal(database.prepare(`SELECT COUNT(*) count
      FROM trade_mobile_upload_parts WHERE session_id = 'abort-wins'`).get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_job_media").get().count, 0);
    assert.equal(storage.objects.has(objectKey), false);
    assert.equal(storage.deletedKeys.includes(objectKey), true);
  }

  {
    const database = evidenceDatabase();
    const storage = evidenceBucket();
    seedJobsAndCompliance(database);
    const deleteGate = manualGate("DELETE");
    const { route } = routeHarness(database, storage, {
      registrationGate: deleteGate,
    });
    const objectKey = seedUpload(database, storage, { id: "completion-wins" });
    const deleting = remove(route, "completion-wins");
    await deleteGate.arrived;
    const completion = await post(route, {
      action: "complete",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      sessionId: "completion-wins",
    });
    assert.equal(completion.status, 201, JSON.stringify(await completion.clone().json()));
    deleteGate.release();
    const deletion = await deleting;
    const deletionPayload = await deletion.json();
    assert.equal(deletion.status, 200);
    assert.equal(deletionPayload.aborted, false);
    assert.deepEqual(
      { ...database.prepare(`SELECT status FROM trade_mobile_upload_sessions
        WHERE id = 'completion-wins'`).get() },
      { status: "completed" },
    );
    assert.equal(storage.objects.has(objectKey), true);
    assert.equal(storage.deletedKeys.includes(objectKey), false);
  }
});

test("device revoke and completion races cannot remove completed evidence bytes", async () => {
  {
    const database = evidenceDatabase();
    const storage = evidenceBucket();
    seedJobsAndCompliance(database);
    const { route: mediaRoute } = routeHarness(database, storage);
    const { route: devicesRoute } = deviceRouteHarness(database, storage);
    const objectKey = seedUpload(database, storage, { id: "revoke-wins" });
    const pause = storage.pauseNextGet(objectKey);
    const completing = post(mediaRoute, {
      action: "complete",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      sessionId: "revoke-wins",
    });
    await pause.arrived;
    const revoked = await patchDevice(devicesRoute);
    assert.equal(revoked.status, 200, JSON.stringify(await revoked.clone().json()));
    pause.release();
    const completion = await completing;
    assert.notEqual(completion.status, 201);
    assert.deepEqual(
      { ...database.prepare(`SELECT status, media_id
        FROM trade_mobile_upload_sessions WHERE id = 'revoke-wins'`).get() },
      { status: "aborted", media_id: "" },
    );
    assert.equal(storage.objects.has(objectKey), false);
  }

  {
    const database = evidenceDatabase();
    const storage = evidenceBucket();
    seedJobsAndCompliance(database);
    const revokeGate = manualGate("PATCH");
    const { route: mediaRoute } = routeHarness(database, storage);
    const { route: devicesRoute } = deviceRouteHarness(database, storage, {
      accessGate: revokeGate,
    });
    const objectKey = seedUpload(database, storage, { id: "revoke-after-complete" });
    const revoking = patchDevice(devicesRoute);
    await revokeGate.arrived;
    const completion = await post(mediaRoute, {
      action: "complete",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      sessionId: "revoke-after-complete",
    });
    assert.equal(completion.status, 201, JSON.stringify(await completion.clone().json()));
    revokeGate.release();
    const revoked = await revoking;
    assert.equal(revoked.status, 200, JSON.stringify(await revoked.clone().json()));
    assert.deepEqual(
      { ...database.prepare(`SELECT status FROM trade_mobile_upload_sessions
        WHERE id = 'revoke-after-complete'`).get() },
      { status: "completed" },
    );
    assert.equal(storage.objects.has(objectKey), true);
    assert.equal(storage.deletedKeys.includes(objectKey), false);
    assert.equal(
      database.prepare(`SELECT status FROM trade_mobile_devices
        WHERE id = 'device-row-1'`).get().status,
      "revoked",
    );
  }
});

test("completion verifies JPEG, PNG, WebP and PDF signatures from assembled bytes", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  let index = 0;
  for (const [contentType, bytes] of Object.entries(FILE_BYTES)) {
    index += 1;
    const id = `signature-${index}`;
    seedUpload(database, storage, { id, contentType, bytes });
    const response = await post(route, {
      action: "complete",
      deviceId: "device-001",
      platform: "ios",
      appVersion: "1.0.0",
      sessionId: id,
    });
    assert.equal(response.status, 201, `${contentType}: ${JSON.stringify(await response.clone().json())}`);
  }

  const mismatchKey = seedUpload(database, storage, {
    id: "signature-mismatch",
    contentType: "image/jpeg",
    bytes: FILE_BYTES["image/png"],
  });
  const mismatch = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "signature-mismatch",
  });
  const payload = await mismatch.json();
  assert.equal(mismatch.status, 409);
  assert.equal(payload.code, "EVIDENCE_FILE_SIGNATURE_MISMATCH");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions WHERE id = 'signature-mismatch'`).get() },
    {
      status: "rejected",
      last_error: "content_type_signature_mismatch",
    },
  );
  assert.equal(storage.objects.has(mismatchKey), false);
});

test("correction evidence atomically supersedes the latest rejected requirement item", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  const now = "2026-08-01T00:00:00.000Z";
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, job_media_id,
     supersedes_evidence_id, source_type, status, object_key, file_name,
     content_type, size_bytes, original_sha256, evidence_envelope,
     received_by_type, received_by_uid, received_at, reviewed_by_uid,
     reviewed_at, retention_until, legal_hold, created_at, updated_at)
    VALUES ('evidence-rejected', 'org-creditex', 'case-1',
      'requirement-pinned', 'old-job-media', '', 'field_app', 'rejected',
      'old-object', 'old.jpg', 'image/jpeg', 4, ?, '{}', 'installer',
      'installer-actor', ?, 'reviewer-1', ?, '', 0, ?, ?)`)
    .run(
      sha256(FILE_BYTES["image/jpeg"]),
      now,
      now,
      now,
      now,
    );
  seedUpload(database, storage, {
    id: "correction-1",
    workOrderId: "job-compliance",
    evidenceEnvelope: validEnvelope(),
  });
  const response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "correction-1",
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(
    database.prepare(`SELECT status FROM compliance_case_evidence
      WHERE id = 'evidence-rejected'`).get().status,
    "superseded",
  );
  const replacement = database.prepare(`SELECT status, supersedes_evidence_id
    FROM compliance_case_evidence WHERE id <> 'evidence-rejected'`).get();
  assert.deepEqual(
    { ...replacement },
    { status: "received", supersedes_evidence_id: "evidence-rejected" },
  );
  const audit = database.prepare(`SELECT metadata FROM compliance_audit_events
    WHERE event_type = 'evidence_received'`).get();
  assert.equal(
    JSON.parse(audit.metadata).supersedesEvidenceId,
    "evidence-rejected",
  );
  assert.deepEqual(
    { ...database.prepare(`SELECT status, evidence_status, revision
      FROM compliance_cases WHERE id = 'case-1'`).get() },
    { status: "in_review", evidence_status: "in_progress", revision: 2 },
  );
});

test("governed capture time accepts bounded offline work and rejects a forged future JPEG", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);

  const offlineCapture = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const offlineObservedAt = offlineCapture.toISOString();
  const offlineComputedAt = new Date(
    offlineCapture.getTime() + 2_000,
  ).toISOString();
  database.prepare(`UPDATE compliance_cases SET activity_date = ?
    WHERE id = 'case-1'`).run(offlineObservedAt.slice(0, 10));
  const offlineResponse = await post(route, {
    action: "initiate",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    clientUploadId: "offline-capture-001",
    workOrderId: "job-compliance",
    fileName: "offline-before.jpg",
    contentType: "image/jpeg",
    sizeBytes: FILE_BYTES["image/jpeg"].byteLength,
    category: "before",
    caption: "",
    evidenceEnvelope: validEnvelope({
      capture: {
        observedAtUtc: offlineObservedAt,
        utcOffsetMinutes: 0,
        timeZone: "UTC",
      },
      integrity: { computedAtUtc: offlineComputedAt },
      location: { observedAtUtc: offlineObservedAt },
    }),
  });
  assert.equal(
    offlineResponse.status,
    201,
    JSON.stringify(await offlineResponse.clone().json()),
  );

  database.prepare(`UPDATE compliance_cases SET activity_date = '2026-08-01'
    WHERE id = 'case-1'`).run();
  const futureBytes = jpegWithEmbeddedCaptureDate("2099:08:01 12:34:56");
  const futureObjectKey = seedUpload(database, storage, {
    id: "future-jpeg",
    workOrderId: "job-compliance",
    bytes: futureBytes,
    evidenceEnvelope: validEnvelope({
      capture: { observedAtUtc: "2099-08-01T02:34:56.000Z" },
      integrity: { computedAtUtc: "2099-08-01T02:34:58.000Z" },
      location: { observedAtUtc: "2099-08-01T02:34:56.000Z" },
      original: {
        exif: { DateTimeOriginal: "2099:08:01 12:34:56" },
      },
    }, futureBytes),
  });
  const futureResponse = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "future-jpeg",
  });
  const futurePayload = await futureResponse.json();
  assert.equal(futureResponse.status, 409);
  assert.equal(futurePayload.code, "EVIDENCE_CAPTURE_TIME_OUT_OF_RANGE");
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions WHERE id = 'future-jpeg'`).get() },
    { status: "rejected", last_error: "capture_time_out_of_range" },
  );
  assert.equal(storage.objects.has(futureObjectKey), false);
});

test("document evidence may be selected after the activity date without embedded EXIF", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  database.prepare(`UPDATE compliance_cases SET activity_date = '2026-07-20'
    WHERE id = 'case-1'`).run();
  database.prepare(`UPDATE compliance_evidence_requirements
    SET evidence_type = 'document',
      allowed_content_types = '["application/pdf"]',
      metadata_required = 0,
      gps_required = 0,
      date_stamp_required = 1
    WHERE id = 'requirement-pinned'`).run();
  const pdfBytes = FILE_BYTES["application/pdf"];
  seedUpload(database, storage, {
    id: "document-after-activity",
    workOrderId: "job-compliance",
    contentType: "application/pdf",
    bytes: pdfBytes,
    evidenceEnvelope: validEnvelope({
      source: "document_picker",
      original: {
        exifState: "not_applicable",
        exif: null,
      },
      location: {
        state: "not_requested",
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        observedAtUtc: "",
        mocked: false,
      },
    }, pdfBytes),
  });
  const response = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "document-after-activity",
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.deepEqual(
    { ...database.prepare(`SELECT content_type, status
      FROM compliance_case_evidence`).get() },
    { content_type: "application/pdf", status: "received" },
  );
});

test("expired completing cleanup persists across transient deletion and never removes completed evidence", async () => {
  const database = evidenceDatabase();
  const storage = evidenceBucket();
  seedJobsAndCompliance(database);
  const { route } = routeHarness(database, storage);
  const expiringKey = seedUpload(database, storage, {
    id: "expiring-completing",
    workOrderId: "job-legacy",
    evidenceEnvelope: {},
    status: "completing",
  });
  storage.objects.set(expiringKey, FILE_BYTES["image/jpeg"]);
  storage.failNextDelete(expiringKey);
  database.prepare(`UPDATE trade_mobile_upload_sessions
    SET expires_at = '2026-07-31T00:00:00.000Z'
    WHERE id = 'expiring-completing'`).run();
  const lookup = () => route.GET(new Request(
    "https://app.example/api/trade-team/media?deviceId=device-001&sessionId=expiring-completing",
  ));

  let response = await lookup();
  assert.equal(response.status, 200);
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'expiring-completing'`).get() },
    { status: "expired", last_error: "cleanup_pending:expired" },
  );
  assert.equal(storage.objects.has(expiringKey), true);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_mobile_upload_parts
    WHERE session_id = 'expiring-completing'`).get().count, 1);

  response = await lookup();
  assert.equal(response.status, 200);
  assert.deepEqual(
    { ...database.prepare(`SELECT status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'expiring-completing'`).get() },
    { status: "expired", last_error: "expired" },
  );
  assert.equal(storage.objects.has(expiringKey), false);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_mobile_upload_parts
    WHERE session_id = 'expiring-completing'`).get().count, 0);

  const abandonedKey = seedUpload(database, storage, {
    id: "abandoned-other-device",
    workOrderId: "job-legacy",
    evidenceEnvelope: {},
  });
  storage.objects.set(abandonedKey, FILE_BYTES["image/jpeg"]);
  database.prepare(`UPDATE trade_mobile_upload_sessions
    SET owner_uid = 'other-owner', actor_uid = 'other-actor',
      member_id = 'other-member', device_id = 'revoked-device',
      status = 'rejected', last_error = 'cleanup_pending:duplicate_original'
    WHERE id = 'abandoned-other-device'`).run();
  response = await lookup();
  assert.equal(response.status, 200);
  assert.deepEqual(
    { ...database.prepare(`SELECT owner_uid, device_id, status, last_error
      FROM trade_mobile_upload_sessions
      WHERE id = 'abandoned-other-device'`).get() },
    {
      owner_uid: "other-owner",
      device_id: "revoked-device",
      status: "rejected",
      last_error: "duplicate_original",
    },
  );
  assert.equal(storage.objects.has(abandonedKey), false);
  assert.equal(database.prepare(`SELECT COUNT(*) count
    FROM trade_mobile_upload_parts
    WHERE session_id = 'abandoned-other-device'`).get().count, 0);

  const completedKey = seedUpload(database, storage, {
    id: "completed-protected",
    workOrderId: "job-legacy",
    evidenceEnvelope: {},
  });
  const completedResponse = await post(route, {
    action: "complete",
    deviceId: "device-001",
    platform: "ios",
    appVersion: "1.0.0",
    sessionId: "completed-protected",
  });
  assert.equal(completedResponse.status, 201);
  database.prepare(`UPDATE trade_mobile_upload_sessions
    SET last_error = 'cleanup_pending:expired'
    WHERE id = 'completed-protected'`).run();
  const completedLookup = await route.GET(new Request(
    "https://app.example/api/trade-team/media?deviceId=device-001&sessionId=completed-protected",
  ));
  assert.equal(completedLookup.status, 200);
  assert.equal(storage.objects.has(completedKey), true);
  assert.equal(storage.deletedKeys.includes(completedKey), false);
});
