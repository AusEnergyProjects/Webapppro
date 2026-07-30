import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read(
  "../drizzle/0085_customer_evidence_resumable_retake.sql",
);
const schema = read("../db/schema.ts");
const evidenceRoute = read(
  "../src/app/api/customer-project-evidence/route.ts",
);
const uploadRoute = read(
  "../src/app/api/customer-project-evidence/uploads/route.ts",
);
const customerProjectsRoute = read(
  "../src/app/api/customer-projects/route.ts",
);
const evidenceContract = read("../src/lib/customer-project-evidence.ts");
const evidenceBucket = read(
  "../src/lib/customer-project-evidence-bucket.ts",
);

function applyMigration(db) {
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
}

function createPreMigrationDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_project_evidence (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_uid text NOT NULL,
    client_upload_id text NOT NULL,
    category text NOT NULL,
    fact_keys text DEFAULT '[]' NOT NULL,
    sharing_scope text DEFAULT 'allocated-installers' NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    object_key text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX customer_project_evidence_client_idx
    ON customer_project_evidence
      (customer_uid, project_id, client_upload_id)`);
  db.exec(`CREATE INDEX customer_project_evidence_project_idx
    ON customer_project_evidence
      (customer_uid, project_id, status, created_at)`);
  db.exec(`INSERT INTO customer_projects (id, firebase_uid)
    VALUES ('project-1', 'owner-1'), ('project-2', 'owner-1')`);
  db.exec(`INSERT INTO customer_project_evidence
    (id, project_id, customer_uid, client_upload_id, category,
     file_name, content_type, size_bytes, object_key, created_at, updated_at)
    VALUES
      ('photo-old', 'project-1', 'owner-1', 'upload-photo-old',
       'property-photo', 'old.jpg', 'image/jpeg', 100, 'object/photo-old',
       '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z'),
      ('pdf-old', 'project-1', 'owner-1', 'upload-pdf-old',
       'supporting-document', 'old.pdf', 'application/pdf', 100,
       'object/pdf-old', '2026-07-30T00:00:00.000Z',
       '2026-07-30T00:00:00.000Z')`);
  return db;
}

test("migration preserves evidence while making new evidence private by default", () => {
  const db = createPreMigrationDatabase();
  applyMigration(db);

  const columns = Object.fromEntries(
    db.prepare("PRAGMA table_info(customer_project_evidence)")
      .all()
      .map((column) => [column.name, column]),
  );
  assert.equal(columns.capture_slot.dflt_value, "''");
  assert.equal(columns.sharing_scope.dflt_value, "'private-plan'");
  assert.equal(columns.privacy_status.dflt_value, "'not-recorded'");
  assert.equal(columns.revision.dflt_value, "1");

  const legacy = db.prepare(`SELECT id, sharing_scope, privacy_status, revision
    FROM customer_project_evidence ORDER BY id`).all()
    .map((row) => ({ ...row }));
  assert.deepEqual(legacy, [
    {
      id: "pdf-old",
      sharing_scope: "allocated-installers",
      privacy_status: "not-applicable",
      revision: 1,
    },
    {
      id: "photo-old",
      sharing_scope: "allocated-installers",
      privacy_status: "not-recorded",
      revision: 1,
    },
  ]);

  db.exec(`INSERT INTO customer_project_evidence
    (id, project_id, customer_uid, client_upload_id, category, capture_slot,
     file_name, content_type, size_bytes, object_key, created_at, updated_at)
    VALUES ('new-private', 'project-1', 'owner-1', 'upload-new-private',
      'property-photo', 'prompt:switchboard', 'switchboard.jpg', 'image/jpeg',
      100, 'object/new-private', '2026-07-30T00:00:00.000Z',
      '2026-07-30T00:00:00.000Z')`);
  assert.equal(
    db.prepare(`SELECT sharing_scope FROM customer_project_evidence
      WHERE id = 'new-private'`).get().sharing_scope,
    "private-plan",
  );
  assert.throws(
    () => db.exec(`INSERT INTO customer_project_evidence
      (id, project_id, customer_uid, client_upload_id, category, capture_slot,
       file_name, content_type, size_bytes, object_key, created_at, updated_at)
      VALUES ('duplicate-slot', 'project-1', 'owner-1', 'upload-duplicate-slot',
        'property-photo', 'prompt:switchboard', 'switchboard-2.jpg',
        'image/jpeg', 100, 'object/duplicate-slot',
        '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z')`),
    /UNIQUE constraint failed/,
  );
  db.exec(`UPDATE customer_project_evidence SET status = 'deleted'
    WHERE id = 'new-private'`);
  assert.doesNotThrow(() => db.exec(`INSERT INTO customer_project_evidence
    (id, project_id, customer_uid, client_upload_id, category, capture_slot,
     file_name, content_type, size_bytes, object_key, created_at, updated_at)
    VALUES ('replacement-slot', 'project-1', 'owner-1',
      'upload-replacement-slot', 'property-photo', 'prompt:switchboard',
      'switchboard-3.jpg', 'image/jpeg', 100, 'object/replacement-slot',
      '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z')`));
  db.close();
});

test("active resumable uploads block project deletion and inactive rows are cleaned", () => {
  const db = createPreMigrationDatabase();
  applyMigration(db);
  db.exec(`INSERT INTO customer_project_evidence_upload_sessions
    (id, project_id, customer_uid, client_upload_id, metadata_hash,
     capture_slot, staging_object_key, upload_id, content_type, size_bytes,
     category, part_size_bytes, evidence_id, expires_at, created_at, updated_at)
    VALUES ('session-1', 'project-2', 'owner-1', 'client-session-1',
      'hash-1', 'prompt:roof', 'staging/server-key', 'r2-upload-id',
      'image/jpeg', 100, 'property-photo', 5242880, 'evidence-1',
      '2026-07-31T00:00:00.000Z', '2026-07-30T00:00:00.000Z',
      '2026-07-30T00:00:00.000Z')`);
  db.exec(`INSERT INTO customer_project_evidence_upload_parts
    (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
    VALUES ('part-1', 'session-1', 1, 'private-r2-etag', 100,
      '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z')`);

  assert.throws(
    () => db.exec("DELETE FROM customer_projects WHERE id = 'project-2'"),
    /active_customer_evidence_upload/,
  );
  db.exec(`UPDATE customer_project_evidence_upload_sessions
    SET status = 'finalising' WHERE id = 'session-1'`);
  assert.throws(
    () => db.exec("DELETE FROM customer_projects WHERE id = 'project-2'"),
    /active_customer_evidence_upload/,
  );
  db.exec(`UPDATE customer_project_evidence_upload_sessions
    SET status = 'abandoning' WHERE id = 'session-1'`);
  assert.throws(
    () => db.exec("DELETE FROM customer_projects WHERE id = 'project-2'"),
    /active_customer_evidence_upload/,
  );
  db.exec(`UPDATE customer_project_evidence_upload_sessions
    SET status = 'abandoned' WHERE id = 'session-1'`);
  db.exec("DELETE FROM customer_projects WHERE id = 'project-2'");
  assert.equal(
    db.prepare(`SELECT COUNT(*) total
      FROM customer_project_evidence_upload_sessions`).get().total,
    0,
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) total
      FROM customer_project_evidence_upload_parts`).get().total,
    0,
  );
  db.close();
});

test("the public contract supports stable prompt thumbnails without leaking storage internals", () => {
  assert.match(evidenceContract, /captureSlot: record\.capture_slot/);
  assert.match(evidenceContract, /privacyStatus: record\.privacy_status/);
  assert.match(evidenceContract, /revision: Number\(record\.revision/);
  assert.match(evidenceContract, /previewUrl/);
  assert.match(evidenceContract, /thumbnailUrl: previewUrl/);
  assert.match(evidenceContract, /: "private-plan"/);

  const uploadPayload = evidenceContract.slice(
    evidenceContract.indexOf("export function publicCustomerEvidenceUpload"),
  );
  assert.doesNotMatch(uploadPayload, /etag:/i);
  assert.doesNotMatch(uploadPayload, /uploadId:/);
  assert.doesNotMatch(uploadPayload, /stagingObjectKey/);
  assert.match(uploadPayload, /parts: parts\.map/);
  assert.match(uploadPayload, /uploadedBytes/);

  assert.match(
    evidenceRoute,
    /WHERE id = \? AND customer_uid = \? AND status = 'active'/,
  );
  assert.match(evidenceRoute, /Content-Disposition": `inline/);
  assert.match(evidenceRoute, /Cache-Control": "private, no-store"/);
  assert.match(evidenceRoute, /Content-Security-Policy": "default-src 'none'; sandbox"/);
  assert.match(customerProjectsRoute, /captureSlot: item\.capture_slot/);
  assert.match(customerProjectsRoute, /privacyStatus: item\.privacy_status/);
  assert.match(customerProjectsRoute, /revision: Number\(item\.revision/);
  assert.match(customerProjectsRoute, /thumbnailUrl/);
});

test("resumable photo storage is owner scoped, bounded and metadata stripped", () => {
  assert.match(uploadRoute, /requireFirebaseIdentity/);
  assert.match(uploadRoute, /customer_uid = \?/);
  assert.match(uploadRoute, /account_status = 'active'/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_MAX_PROJECT_FILES/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_MAX_FILE_BYTES/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_PART_SIZE_BYTES/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_SESSION_HOURS/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_SESSION_RETENTION_DAYS/);
  assert.match(uploadRoute, /createMultipartUpload/);
  assert.match(uploadRoute, /resumeMultipartUpload/);
  assert.match(uploadRoute, /metadataHash/);
  assert.match(uploadRoute, /IDEMPOTENCY_MISMATCH/);
  assert.match(uploadRoute, /CAPTURE_SLOT_OCCUPIED/);
  assert.match(uploadRoute, /EVIDENCE_REVISION_CONFLICT/);
  assert.match(uploadRoute, /expectedEvidenceRevision/);
  assert.match(uploadRoute, /status = 'abandoned'/);
  assert.match(uploadRoute, /status = 'expired'/);
  assert.match(uploadRoute, /status = 'finalising'/);
  assert.match(uploadRoute, /finishFinalisingSession/);
  assert.match(uploadRoute, /private_object_cleanup_failed/);
  assert.match(uploadRoute, /sanitiseQuotingPhoto/);
  assert.ok(
    uploadRoute.indexOf("sanitiseQuotingPhoto")
      < uploadRoute.indexOf("await bucket.put(finalObjectKey"),
  );
  assert.match(
    uploadRoute,
    /customer-projects\/\$\{user\.uid\}\/\$\{session\.project_id\}\/\$\{crypto\.randomUUID\(\)\}/,
  );
  assert.doesNotMatch(uploadRoute, /raw\.fileName|raw\.objectKey/);
  assert.match(uploadRoute, /confirmInstallerPhotoSharing/);
  assert.match(uploadRoute, /CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION/);
  assert.match(evidenceBucket, /createMultipartUpload/);
  assert.match(evidenceBucket, /resumeMultipartUpload/);
});

test("initiate retries validate the retained session before returning committed evidence", () => {
  const initiateStart = uploadRoute.indexOf("async function initiate(");
  const initiateEnd = uploadRoute.indexOf(
    "async function uploadPart(",
    initiateStart,
  );
  const initiate = uploadRoute.slice(initiateStart, initiateEnd);
  const existingSession = initiate.indexOf(
    "FROM customer_project_evidence_upload_sessions",
  );
  const committedEvidence = initiate.indexOf(
    "const committedByClient =",
  );
  assert.ok(existingSession > 0);
  assert.ok(committedEvidence > existingSession);
  assert.match(
    initiate,
    /existing\.metadata_hash !== metadataHash/,
  );
  assert.match(
    initiate,
    /existing\.status === "completed"[\s\S]*findEvidence/,
  );
  assert.match(
    initiate,
    /upload: committedUploadPayload\(committedByClient\)[\s\S]*evidence: publicCustomerEvidence\(committedByClient\)/,
  );
  assert.match(
    uploadRoute,
    /function committedUploadPayload[\s\S]*status: "completed"/,
  );
});

test("metadata updates, retakes and removals use revision compare and swap", () => {
  assert.match(evidenceRoute, /const expectedRevision = Number\(raw\.expectedRevision\)/);
  assert.match(
    evidenceRoute,
    /status = 'active'\s+AND revision = \? AND object_key = \?/,
  );
  assert.match(evidenceRoute, /SET status = 'deleting', revision = \?/);
  assert.match(evidenceRoute, /code: "EVIDENCE_DELETE_RETRY"/);
  assert.match(evidenceRoute, /code: "EVIDENCE_REVISION_CONFLICT"/);
  assert.match(uploadRoute, /SET client_upload_id = \?, file_name = \?/);
  assert.match(uploadRoute, /'replaced'/);
  assert.match(
    uploadRoute,
    /AND status = 'active' AND revision = \? AND object_key = \?/,
  );
  assert.match(schema, /customer_project_evidence_capture_slot_idx/);
  assert.match(schema, /customerProjectEvidenceUploadSessions/);
  assert.match(schema, /customerProjectEvidenceUploadParts/);
});

test("new customer evidence copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(
    migration + evidenceRoute + uploadRoute + evidenceContract,
    /\u2013|\u2014/,
  );
});
