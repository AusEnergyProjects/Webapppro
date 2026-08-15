import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_WORK_PACK_COVERAGE,
  CREDITEX_WORK_PACK_COVERAGE_CATALOGUE_STATES,
  CREDITEX_WORK_PACK_COVERAGE_SUMMARY,
} from "../src/lib/creditex-work-pack-coverage.ts";
import {
  CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-work-pack-schema-guards.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "drizzle",
  "0142_creditex_activity_work_packs.sql",
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const workPackMigrationGuards = CREDITEX_WORK_PACK_SCHEMA_GUARD_DEFINITIONS
  .filter((definition) => definition.name.startsWith("compliance_work_pack_"));
const workPackGuardSql = workPackMigrationGuards
  .map((definition) => definition.sql)
  .join("\n");
const HASH = "a".repeat(64);
const POLICY_HASH = "b".repeat(64);
const BINDING_HASH = "c".repeat(64);
const SCHEMA_SHA256 = `sha256:${"d".repeat(64)}`;
const NOW = "2026-08-14T10:00:00.000Z";

test("signature custody enforces a finite prepared-revision and receipt-time window", () => {
  assert.match(
    migrationSql,
    /unixepoch\(`signed_at`\) >= unixepoch\(`created_at`\) - 604800/,
  );
  assert.match(
    workPackGuardSql,
    /unixepoch\(NEW\.`signed_at`\) >=\s*unixepoch\(prepared_instance\.`created_at`\) - 300/,
  );
  assert.match(
    workPackGuardSql,
    /COMPLIANCE_WORK_PACK_SIGNATURE_TIME_OUT_OF_BOUNDS/,
  );
});

function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(
    (column) => column.name,
  );
}

function schemaSnapshot(version = 1, title = "Governed work pack") {
  return JSON.stringify({
    contract: "creditex-activity-work-pack/v1",
    activityTemplateId: "current-activity-template",
    version,
    title,
    effectiveFrom: "2026-08-01",
    effectiveTo: "",
    catalogueReviewedOn: "2026-08-14",
    stages: [{
      stageKey: "field-capture",
      order: 1,
      label: "Field capture",
      description: "Collect the governed requirement.",
    }],
    signerRoles: [],
    dependencies: [],
    sections: [{
      sectionKey: "evidence",
      order: 1,
      title: "Evidence",
      description: "Governed evidence requirements.",
      visibility: null,
      repeatability: null,
      prompts: [{
        promptKey: "requirement-answer",
        order: 1,
        type: "text",
        label: "Requirement answer",
        instructions: "",
        required: true,
        visibility: null,
        dependencyKeys: [],
        requirementKeys: ["REQ-1"],
        stageKey: "field-capture",
        options: [],
        signerRoleKey: "",
        attestation: null,
        minimumLength: 1,
        maximumLength: 500,
        minimumNumber: null,
        maximumNumber: null,
        numberStep: null,
        unit: "",
        minimumSelections: null,
        maximumSelections: null,
        fileRequirement: null,
        referenceDocument: null,
      }],
    }],
    documentOutputs: [{
      outputKey: "completed-activity-form",
      title: "Completed governed activity form",
      sourceBindingTargetKey: "completed-activity-form-template",
      rendererVersion: "1.0.0",
      required: true,
      placements: [{
        placementKey: "requirement-answer",
        kind: "text",
        sourcePath: "/response/answers/requirement-answer",
        signaturePromptKey: "",
        signerRoleKey: "",
        pageIndex: 0,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.1,
        fontFamily: "helvetica",
        fontSize: 10,
        minimumFontSize: 6,
        overflow: "wrap",
        maximumLines: 3,
        textFormat: "text",
      }],
    }],
  });
}

function governanceDatabase(organisationCode = "CREDITEX-AU") {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_users (
      firebase_uid text PRIMARY KEY,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY,
      organisation_code text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      email text NOT NULL,
      display_name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL,
      governance_identity_verified_by_uid text NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY,
      program_id text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      official_source_sha256 text NOT NULL,
      requirements_complete integer NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      requirement_code text NOT NULL
    );
    CREATE TABLE compliance_manual_policy_bindings (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      activity_template_id text NOT NULL,
      activity_version_id text NOT NULL,
      evidence_policy_version_id text NOT NULL,
      version integer NOT NULL,
      binding_snapshot_sha256 text NOT NULL,
      lifecycle_state text NOT NULL
    );
    CREATE TABLE compliance_official_source_artifacts (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL,
      content_type text NOT NULL
    );
    CREATE TABLE compliance_official_source_review_decisions (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      artifact_id text NOT NULL,
      artifact_sha256 text NOT NULL,
      artifact_object_key text NOT NULL,
      decision text NOT NULL,
      reviewed_at text NOT NULL,
      supersedes_decision_id text NOT NULL DEFAULT ''
    );
  `);
  database.exec(migrationSql);
  for (const definition of workPackMigrationGuards) {
    database.exec(definition.sql);
  }
  database.prepare(`
    INSERT INTO compliance_organisations (id, organisation_code, status)
    VALUES ('org', ?, 'active')
  `).run(organisationCode);
  for (const [uid, role] of [
    ["admin-author", "owner"],
    ["admin-editor", "admin"],
    ["admin-reviewer", "reviewer"],
    ["admin-support", "support"],
  ]) {
    database.prepare(`
      INSERT INTO admin_users (firebase_uid, role, status)
      VALUES (?, ?, 'active')
    `).run(uid, role);
  }
  database.exec(`
    INSERT INTO compliance_programs (id, organisation_id, publish_state)
    VALUES ('program', 'org', 'published');
    INSERT INTO compliance_activity_versions (
      id, program_id, effective_from, effective_to, publish_state
    ) VALUES ('activity-version', 'program', '2026-01-01', '', 'published');
    INSERT INTO compliance_evidence_policy_versions (
      id, organisation_id, activity_version_id, version,
      official_source_sha256, requirements_complete, publish_state
    ) VALUES (
      'evidence-policy', 'org', 'activity-version', 1,
      '${POLICY_HASH}', 1, 'published'
    );
    INSERT INTO compliance_evidence_requirements (
      id, organisation_id, policy_version_id, requirement_code
    ) VALUES ('requirement', 'org', 'evidence-policy', 'REQ-1');
    INSERT INTO compliance_manual_policy_bindings (
      id, organisation_id, activity_template_id, activity_version_id,
      evidence_policy_version_id, version, binding_snapshot_sha256,
      lifecycle_state
    ) VALUES (
      'manual-binding', 'org', 'current-activity-template',
      'activity-version', 'evidence-policy', 1, '${BINDING_HASH}', 'approved'
    );
    INSERT INTO compliance_official_source_artifacts (
      id, organisation_id, sha256, object_key, content_type
    ) VALUES (
      'source-artifact', 'org', '${HASH}', 'sources/current.pdf',
      'application/pdf'
    );
    INSERT INTO compliance_official_source_review_decisions (
      id, organisation_id, subject_type, subject_id, artifact_id,
      artifact_sha256, artifact_object_key, decision, reviewed_at
    ) VALUES (
      'source-artifact-review', 'org', 'artifact', 'source-artifact',
      'source-artifact', '${HASH}', 'sources/current.pdf', 'approved', '${NOW}'
    );
  `);
  return database;
}

function insertVersion(database, {
  id = "work-pack-version-1",
  version = 1,
  author = "admin-author",
  schemaSha256 = SCHEMA_SHA256,
  title = "Governed work pack",
} = {}) {
  return database.prepare(`
    INSERT INTO compliance_activity_work_pack_versions (
      id, organisation_id, activity_version_id, activity_template_id,
      manual_policy_binding_id, manual_policy_binding_version,
      manual_policy_binding_sha256, evidence_policy_version_id,
      evidence_policy_version, evidence_policy_source_sha256, version,
      contract, title, schema_snapshot, schema_sha256, effective_from,
      effective_to, publish_state, authored_by_uid, authored_at,
      updated_by_uid, updated_at, created_at
    ) VALUES (
      ?, 'org', 'activity-version', 'current-activity-template',
      'manual-binding', 1, '${BINDING_HASH}', 'evidence-policy', 1,
      '${POLICY_HASH}', ?, 'creditex-activity-work-pack/v1', ?, ?, ?,
      '2026-08-01', '', 'draft', ?, '${NOW}', ?, '${NOW}', '${NOW}'
    )
  `).run(
    id,
    version,
    title,
    schemaSnapshot(version, title),
    schemaSha256,
    author,
    author,
  );
}

function insertSourceCandidate(database, {
  id = "source-candidate-version-1",
  clientRequestId = "forms-sourced-draft:request-1",
  schemaSha256 = SCHEMA_SHA256,
  version = 1,
} = {}) {
  const candidate = JSON.stringify({
    schema: "creditex-current-work-pack-content/v1",
    templateId: "current-activity-template",
    draftCreationState: "source_bound_guided_capture",
    activationReady: false,
  });
  const sourceMap = JSON.stringify([{
    contract: "creditex-sourced-work-pack-draft-binding-map/v1",
    sourceId: "source-aaaaaaaaaaaaaaaaaaaa",
    sourceRole: "requirement",
    targetKey: "work_pack",
  }]);
  const blockers = JSON.stringify([{
    code: "independent_review_required",
    detail: "Independent review and approved policy composition remain required.",
  }]);
  return database.prepare(`
    INSERT INTO compliance_activity_work_pack_versions (
      id, organisation_id, activity_version_id, activity_template_id,
      manual_policy_binding_id, manual_policy_binding_version,
      manual_policy_binding_sha256, evidence_policy_version_id,
      evidence_policy_version, evidence_policy_source_sha256,
      origin_kind, client_request_id, source_candidate_contract,
      source_candidate_snapshot, source_candidate_sha256,
      source_binding_map_snapshot, source_binding_map_sha256,
      candidate_blockers_snapshot, version, contract, title,
      schema_snapshot, schema_sha256, effective_from, effective_to,
      publish_state, authored_by_uid, authored_at, updated_by_uid,
      updated_at, created_at
    ) VALUES (
      ?, 'org', 'activity-version', 'current-activity-template',
      '', 0, '', '', 0, '', 'source_candidate', ?,
      'creditex-current-work-pack-content/v1', ?,
      'sha256:${"e".repeat(64)}', ?, 'sha256:${"f".repeat(64)}', ?, ?,
      'creditex-activity-work-pack/v1', 'Governed work pack', ?, ?,
      '2026-08-01', '', 'draft', 'admin-author', '${NOW}',
      'admin-author', '${NOW}', '${NOW}'
    )
  `).run(
    id,
    clientRequestId,
    candidate,
    sourceMap,
    blockers,
    version,
    schemaSnapshot(version),
    schemaSha256,
  );
}

function insertSource(database, creator = "admin-author") {
  database.prepare(`
    INSERT INTO compliance_activity_work_pack_source_bindings (
      id, organisation_id, work_pack_version_id, schema_sha256,
      source_artifact_id, source_artifact_sha256, source_role, target_key,
      citation_location, binding_state, created_by_uid, created_at
    ) VALUES (
      'work-pack-source', 'org', 'work-pack-version-1', ?,
      'source-artifact', '${HASH}', 'requirement', 'work_pack',
      'Section 1', 'pending_review', ?, '${NOW}'
    )
  `).run(SCHEMA_SHA256, creator);
  database.prepare(`
    INSERT INTO compliance_activity_work_pack_source_bindings (
      id, organisation_id, work_pack_version_id, schema_sha256,
      source_artifact_id, source_artifact_sha256, source_role, target_key,
      citation_location, binding_state, created_by_uid, created_at
    ) VALUES (
      'work-pack-document-source', 'org', 'work-pack-version-1', ?,
      'source-artifact', '${HASH}', 'requirement',
      'completed-activity-form-template', 'Approved PDF template',
      'pending_review', ?, '${NOW}'
    )
  `).run(SCHEMA_SHA256, creator);
}

function reviewSource(database, reviewer) {
  return database.prepare(`
    UPDATE compliance_activity_work_pack_source_bindings
    SET binding_state = 'approved', reviewed_by_uid = ?,
      reviewed_at = '2026-08-14T10:10:00.000Z',
      review_note = 'Independently checked against the official source.'
    WHERE work_pack_version_id = 'work-pack-version-1'
  `).run(reviewer);
}

function publishVersion(database, reviewer) {
  return database.prepare(`
    UPDATE compliance_activity_work_pack_versions
    SET publish_state = 'published', reviewed_by_uid = ?,
      reviewed_at = '2026-08-14T10:15:00.000Z',
      review_note = 'Independently reviewed and approved for field use.'
    WHERE id = 'work-pack-version-1'
  `).run(reviewer);
}

test("coverage contains exactly one explicit fail-closed row per active catalogue activity", () => {
  const expected = GOVERNMENT_ACTIVITY_TEMPLATES.filter((activity) =>
    CREDITEX_WORK_PACK_COVERAGE_CATALOGUE_STATES.includes(
      activity.catalogueState,
    )
  );
  assert.equal(CREDITEX_WORK_PACK_COVERAGE.length, expected.length);
  assert.deepEqual(
    CREDITEX_WORK_PACK_COVERAGE.map((row) => row.activityTemplateId).sort(),
    expected.map((row) => row.templateId).sort(),
  );
  assert.equal(
    new Set(CREDITEX_WORK_PACK_COVERAGE.map((row) => row.activityTemplateId)).size,
    expected.length,
  );
  assert.ok(CREDITEX_WORK_PACK_COVERAGE.every((row) =>
    row.genericEngineSupported
    && row.governedReadinessState === "governed_version_required"
    && !row.governedVersionAvailable
    && !row.approvedSourceBindingsAvailable
    && !row.independentReviewAvailable
    && !row.fieldCollectionEnabled
    && !row.completionEnabled
    && !row.externalSubmissionEnabled
    && !row.certificateActionEnabled
  ));
  assert.equal(
    CREDITEX_WORK_PACK_COVERAGE_SUMMARY.activityCount,
    expected.length,
  );
  assert.match(
    CREDITEX_WORK_PACK_COVERAGE_SUMMARY.coverageSha256,
    /^sha256:[0-9a-f]{64}$/,
  );
});

test("generic engine implementation contains no special-case historic activity logic", () => {
  const implementation = [
    "src/lib/creditex-activity-work-pack.ts",
    "src/lib/creditex-work-pack-coverage.ts",
    "drizzle/0142_creditex_activity_work_packs.sql",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(implementation, /\b(?:activity|veu)[\s_-]*45\b/i);
  assert.doesNotMatch(
    migrationSql,
    /INSERT\s+INTO\s+[`"]?compliance_activity_work_pack_/i,
  );
});

test("0142 parses and freezes every governed work-pack row shape", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(migrationSql);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_versions"), [
    "id", "organisation_id", "activity_version_id", "activity_template_id",
    "manual_policy_binding_id", "manual_policy_binding_version",
    "manual_policy_binding_sha256", "evidence_policy_version_id",
    "evidence_policy_version", "evidence_policy_source_sha256",
    "origin_kind", "client_request_id", "source_candidate_contract",
    "source_candidate_snapshot", "source_candidate_sha256",
    "source_binding_map_snapshot", "source_binding_map_sha256",
    "candidate_blockers_snapshot", "version",
    "contract", "title", "schema_snapshot", "schema_sha256", "effective_from",
    "effective_to", "publish_state", "authored_by_uid", "authored_at",
    "updated_by_uid", "updated_at", "reviewed_by_uid", "reviewed_at",
    "review_note", "withdrawn_by_uid", "withdrawn_at", "withdrawal_note",
    "abandoned_by_uid", "abandoned_at", "abandonment_note", "created_at",
  ]);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_source_bindings"), [
    "id", "organisation_id", "work_pack_version_id", "schema_sha256",
    "source_artifact_id", "source_artifact_sha256", "source_role", "target_key",
    "citation_location", "binding_state", "created_by_uid", "created_at",
    "reviewed_by_uid", "reviewed_at", "review_note", "withdrawn_by_uid",
    "withdrawn_at", "withdrawal_note",
  ]);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_instances"), [
    "id", "instance_key", "organisation_id", "compliance_case_id",
    "work_order_id", "compliance_intent_id", "work_pack_version_id",
    "manual_policy_composition_lock_id", "manual_policy_composition_sha256",
    "activity_date", "revision", "supersedes_instance_id", "status",
    "response_snapshot", "response_sha256", "created_by_uid", "created_at",
  ]);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_signatures"), [
    "id", "organisation_id", "instance_key", "case_instance_id", "prompt_key",
    "signer_role", "signer_capacity", "signer_name", "signer_uid",
    "signer_identity_snapshot", "signer_identity_sha256", "signature_sha256",
    "signature_object_key", "signature_content_type", "signature_size_bytes",
    "signature_payload_contract", "signature_payload_snapshot",
    "signature_payload_sha256", "integrity_receipt_id", "attestation_snapshot",
    "attestation_sha256", "definition_sha256", "prefill_sha256",
    "response_sha256", "declarations_sha256", "action",
    "supersedes_signature_id", "app_id", "app_version", "app_build",
    "capture_session_id", "captured_device_id", "captured_by_uid",
    "device_attestation_snapshot", "device_attestation_sha256", "signed_at",
    "created_at",
  ]);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_artifacts"), [
    "id", "organisation_id", "instance_key", "case_instance_id", "prompt_key",
    "artifact_kind", "object_key", "original_file_name", "content_type",
    "size_bytes", "original_sha256", "metadata_snapshot", "metadata_sha256",
    "integrity_receipt_id", "verification_state", "supersedes_artifact_id",
    "captured_device_id", "captured_by_uid", "captured_at", "created_at",
  ]);
  assert.deepEqual(columns(database, "compliance_activity_work_pack_final_records"), [
    "id", "contract", "organisation_id", "instance_key", "case_instance_id",
    "work_pack_version_id", "instance_sha256", "definition_sha256",
    "prefill_sha256", "response_sha256", "declarations_sha256",
    "signature_manifest_snapshot", "signature_manifest_sha256",
    "renderer_contract", "renderer_version", "output_key",
    "output_definition_sha256", "template_source_artifact_id",
    "template_source_artifact_sha256", "object_key", "file_name",
    "content_type", "size_bytes", "pdf_sha256", "integrity_receipt_id",
    "created_by_uid", "created_at", "finalised_by_uid", "finalised_at",
  ]);
  assert.deepEqual(
    columns(database, "compliance_activity_work_pack_browser_upload_receipts"),
    [
      "id", "contract", "organisation_id", "instance_key",
      "case_instance_id", "owner_uid", "actor_uid", "member_id",
      "work_order_id", "client_upload_id", "prompt_key", "purpose",
      "artifact_kind", "device_id", "object_key", "file_name",
      "content_type", "size_bytes", "original_sha256", "metadata_snapshot",
      "metadata_sha256", "captured_at", "created_at",
    ],
  );
  assert.match(migrationSql, /creditex-activity-work-pack-instance\/v1/);
  assert.match(migrationSql, /\$\.response\.repeatableSections/);
  assert.match(migrationSql, /'application\/pdf'/);
  assert.match(
    migrationSql,
    /'customer_context', 'assigned_worker', 'authenticated_actor'/,
  );
  assert.match(
    workPackGuardSql,
    /assigned_member\.`member_uid` = NEW\.`signer_uid`/,
  );
  assert.match(
    workPackGuardSql,
    /signature\.`response_sha256` = NEW\.`response_sha256`/,
  );
});

test("source-backed candidate drafts persist idempotently, edit with CAS and cannot publish", () => {
  const database = governanceDatabase();
  insertSourceCandidate(database);
  assert.deepEqual(
    { ...database.prepare(`SELECT origin_kind, client_request_id, publish_state
      FROM compliance_activity_work_pack_versions
      WHERE id = 'source-candidate-version-1'`).get() },
    {
      origin_kind: "source_candidate",
      client_request_id: "forms-sourced-draft:request-1",
      publish_state: "draft",
    },
  );
  assert.throws(
    () => insertSourceCandidate(database, {
      id: "source-candidate-version-duplicate",
      version: 2,
    }),
    /UNIQUE constraint failed/,
  );

  const nextSha = `sha256:${"1".repeat(64)}`;
  const edited = database.prepare(`
    UPDATE compliance_activity_work_pack_versions
    SET title = 'Edited governed work pack', schema_snapshot = ?,
      schema_sha256 = ?, updated_by_uid = 'admin-editor',
      updated_at = '2026-08-14T10:05:00.000Z'
    WHERE id = 'source-candidate-version-1' AND schema_sha256 = ?
  `).run(
    schemaSnapshot(1, "Edited governed work pack"),
    nextSha,
    SCHEMA_SHA256,
  );
  assert.equal(edited.changes, 1);
  const stale = database.prepare(`
    UPDATE compliance_activity_work_pack_versions
    SET title = 'Stale update', schema_snapshot = ?, schema_sha256 = ?,
      updated_by_uid = 'admin-editor',
      updated_at = '2026-08-14T10:06:00.000Z'
    WHERE id = 'source-candidate-version-1' AND schema_sha256 = ?
  `).run(
    schemaSnapshot(1, "Stale update"),
    `sha256:${"2".repeat(64)}`,
    SCHEMA_SHA256,
  );
  assert.equal(stale.changes, 0);
  assert.throws(
    () => database.prepare(`
      UPDATE compliance_activity_work_pack_versions
      SET publish_state = 'published', reviewed_by_uid = 'admin-reviewer',
        reviewed_at = '2026-08-14T10:10:00.000Z',
        review_note = 'Independent review must not activate a candidate row.'
      WHERE id = 'source-candidate-version-1'
    `).run(),
    /COMPLIANCE_WORK_PACK_SOURCE_CANDIDATE_REVIEW_REQUIRED/,
  );
});

test("CREDITEX-AU owner and admin can author, edit, abandon and replace a draft", () => {
  const database = governanceDatabase();
  insertVersion(database);
  const editedSnapshot = schemaSnapshot(1, "Edited governed work pack");
  database.prepare(`
    UPDATE compliance_activity_work_pack_versions
    SET title = 'Edited governed work pack', schema_snapshot = ?,
      schema_sha256 = ?, updated_by_uid = 'admin-editor',
      updated_at = '2026-08-14T10:05:00.000Z'
    WHERE id = 'work-pack-version-1'
  `).run(editedSnapshot, `sha256:${"e".repeat(64)}`);
  database.exec(`
    UPDATE compliance_activity_work_pack_versions
    SET publish_state = 'abandoned', abandoned_by_uid = 'admin-editor',
      abandoned_at = '2026-08-14T10:06:00.000Z',
      abandonment_note = 'Superseded before review by a corrected draft.'
    WHERE id = 'work-pack-version-1'
  `);
  insertVersion(database, {
    id: "work-pack-version-2",
    version: 2,
    schemaSha256: `sha256:${"f".repeat(64)}`,
  });
  assert.deepEqual(
    database.prepare(`
      SELECT version, publish_state FROM compliance_activity_work_pack_versions
      ORDER BY version
    `).all().map((row) => ({ ...row })),
    [
      { version: 1, publish_state: "abandoned" },
      { version: 2, publish_state: "draft" },
    ],
  );
});

test("independent admin review publishes while self-review and support fail closed", () => {
  const database = governanceDatabase();
  insertVersion(database);
  insertSource(database);
  assert.throws(
    () => reviewSource(database, "admin-author"),
    /COMPLIANCE_WORK_PACK_SOURCE_INDEPENDENT_REVIEW_REQUIRED/,
  );
  assert.throws(
    () => reviewSource(database, "admin-support"),
    /COMPLIANCE_WORK_PACK_SOURCE_INDEPENDENT_REVIEW_REQUIRED/,
  );
  reviewSource(database, "admin-reviewer");
  assert.throws(
    () => publishVersion(database, "admin-author"),
    /COMPLIANCE_WORK_PACK_INDEPENDENT_REVIEWER_REQUIRED/,
  );
  assert.throws(
    () => publishVersion(database, "admin-support"),
    /COMPLIANCE_WORK_PACK_INDEPENDENT_REVIEWER_REQUIRED/,
  );
  publishVersion(database, "admin-reviewer");
  assert.deepEqual({ ...database.prepare(`
    SELECT publish_state, reviewed_by_uid
    FROM compliance_activity_work_pack_versions
    WHERE id = 'work-pack-version-1'
  `).get() }, {
    publish_state: "published",
    reviewed_by_uid: "admin-reviewer",
  });
});

test("support and global admins outside CREDITEX-AU cannot author work packs", () => {
  const supportDatabase = governanceDatabase();
  assert.throws(
    () => insertVersion(supportDatabase, { author: "admin-support" }),
    /COMPLIANCE_WORK_PACK_NAMED_AUTHOR_REQUIRED/,
  );
  const otherOrganisationDatabase = governanceDatabase("NOT-CREDITEX");
  assert.throws(
    () => insertVersion(otherOrganisationDatabase),
    /COMPLIANCE_WORK_PACK_NAMED_AUTHOR_REQUIRED/,
  );
});
