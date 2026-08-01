import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const HASH = "a".repeat(64);
const NOW = "2026-08-01T00:00:00.000Z";

function installGuards(database, names) {
  for (const name of names) {
    const definition = CREDITEX_SCHEMA_GUARD_DEFINITIONS.find(
      (candidate) => candidate.name === name,
    );
    assert.ok(definition, `Missing schema guard definition: ${name}`);
    database.exec(definition.sql);
  }
}

function governanceDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_users (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      role text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_programs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      program_code text NOT NULL,
      name text NOT NULL,
      scheme_kind text NOT NULL,
      jurisdiction text NOT NULL,
      administering_body text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      publish_state text NOT NULL,
      withdrawn_by_uid text NOT NULL DEFAULT '',
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_activity_versions (
      id text PRIMARY KEY NOT NULL,
      program_id text NOT NULL,
      activity_key text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      service_category text NOT NULL,
      registry_activity_code text NOT NULL,
      specification_part text NOT NULL,
      product_category text NOT NULL,
      scenario_code text NOT NULL,
      scenario text NOT NULL,
      jurisdiction text NOT NULL,
      effective_from text NOT NULL,
      effective_to text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      requirements_snapshot text NOT NULL,
      calculation_approval_state text NOT NULL,
      publish_state text NOT NULL,
      withdrawn_by_uid text NOT NULL DEFAULT '',
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL DEFAULT 'org-1',
      activity_version_id text NOT NULL DEFAULT 'activity-1',
      version integer NOT NULL DEFAULT 1,
      title text NOT NULL DEFAULT 'Evidence policy',
      official_source_url text NOT NULL DEFAULT 'https://regulator.example/policy',
      official_source_title text NOT NULL DEFAULT 'Evidence rules',
      official_source_version text NOT NULL DEFAULT '1',
      official_source_sha256 text NOT NULL DEFAULT '${HASH}',
      official_source_checked_at text NOT NULL DEFAULT '${NOW}',
      requirements_complete integer NOT NULL DEFAULT 1,
      publish_state text NOT NULL,
      withdrawn_by_uid text NOT NULL DEFAULT '',
      content_revision integer NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      title text NOT NULL,
      capture_timing text NOT NULL DEFAULT 'any'
    );
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      email text NOT NULL,
      display_name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL DEFAULT 0
        CHECK (governance_identity_verified IN (0, 1)),
      governance_identity_verified_by_uid text NOT NULL DEFAULT '',
      governance_identity_verified_at text NOT NULL DEFAULT '',
      governance_identity_verification_basis text NOT NULL DEFAULT '',
      CHECK (
        (governance_identity_verified = 0
          AND governance_identity_verified_by_uid = ''
          AND governance_identity_verified_at = ''
          AND governance_identity_verification_basis = '')
        OR
        (governance_identity_verified = 1
          AND trim(governance_identity_verified_by_uid) <> ''
          AND governance_identity_verified_by_uid <> firebase_uid
          AND trim(governance_identity_verified_at) <> ''
          AND trim(governance_identity_verification_basis) <> '')
      )
    );
    CREATE TABLE compliance_governance_requests (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      action text NOT NULL,
      sealed_snapshot text NOT NULL,
      sealed_snapshot_sha256 text NOT NULL,
      status text NOT NULL,
      request_reason text NOT NULL,
      requested_by_uid text NOT NULL,
      requested_at text NOT NULL,
      reviewed_by_uid text NOT NULL,
      reviewed_at text NOT NULL,
      review_note text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      CHECK (
        (status = 'pending' AND reviewed_by_uid = '' AND reviewed_at = ''
          AND review_note = '')
        OR
        (status IN ('approved', 'rejected')
          AND trim(reviewed_by_uid) <> ''
          AND reviewed_by_uid <> requested_by_uid
          AND trim(reviewed_at) <> ''
          AND trim(review_note) <> '')
        OR
        (status = 'superseded' AND reviewed_by_uid = ''
          AND trim(reviewed_at) <> '' AND trim(review_note) <> '')
      )
    );
  `);
  return database;
}

test("schema guard inventory remains quota-safe at forty statements per batch", () => {
  assert.equal(CREDITEX_SCHEMA_GUARD_DEFINITIONS.length, 172);
  assert.equal(
    new Set(CREDITEX_SCHEMA_GUARD_DEFINITIONS.map((item) => item.name)).size,
    172,
  );
  assert.equal(Math.ceil(CREDITEX_SCHEMA_GUARD_DEFINITIONS.length / 40), 5);
});

function insertGovernanceRequest(database, {
  id,
  targetType = "program",
  targetId = "program-1",
  status = "pending",
  reviewedByUid = "",
  reviewedAt = "",
  reviewNote = "",
  requestedByUid = "requester-1",
}) {
  return database.prepare(`INSERT INTO compliance_governance_requests
    (id, organisation_id, target_type, target_id, action, sealed_snapshot,
     sealed_snapshot_sha256, status, request_reason, requested_by_uid,
     requested_at, reviewed_by_uid, reviewed_at, review_note,
     created_at, updated_at)
    VALUES (?, 'org-1', ?, ?, 'publish', '{}', ?, ?,
      'Independent publication review', ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      targetType,
      targetId,
      HASH,
      status,
      requestedByUid,
      NOW,
      reviewedByUid,
      reviewedAt,
      reviewNote,
      NOW,
      NOW,
    );
}

test("governance requests start pending and terminal decisions are immutable", () => {
  const database = governanceDatabase();
  database.exec(`
    INSERT INTO admin_users (id, firebase_uid, role, status)
      VALUES ('platform-owner', 'platform-owner-uid', 'owner', 'active');
    INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, email, display_name, role, status)
      VALUES
      ('requester', 'org-1', 'requester-1', 'alex.author@example.com',
        'Alex Author', 'admin', 'active'),
      ('reviewer', 'org-1', 'reviewer-1', 'riley.reviewer@example.com',
        'Riley Reviewer', 'admin', 'active'),
      ('reviewer-2', 'org-1', 'reviewer-2', 'sam.reviewer@example.com',
        'Sam Reviewer', 'admin', 'active'),
      ('shared-reviewer', 'org-1', 'shared-reviewer',
        'info+reviewer@example.com', 'Shared Reviewer', 'admin', 'active'),
      ('backoffice', 'org-1', 'backoffice', 'backoffice@example.com',
        'Backoffice Team', 'admin', 'active'),
      ('self-certifier', 'org-1', 'self-certifier',
        'self.certifier@example.com', 'Self Certifier', 'admin', 'active');
  `);
  installGuards(database, [
    "compliance_governance_requests_insert_state_guard",
    "compliance_governance_requests_original_no_update",
    "compliance_governance_requests_transition_guard",
    "compliance_governance_requests_terminal_no_update",
    "compliance_governance_requests_named_requester_guard",
    "compliance_governance_requests_named_reviewer_insert_guard",
    "compliance_governance_requests_named_reviewer_guard",
    "compliance_users_governance_identity_insert_guard",
    "compliance_users_governance_identity_no_rewrite",
  ]);

  database.prepare(`UPDATE admin_users SET status = 'suspended'
    WHERE id = 'platform-owner'`).run();
  assert.throws(
    () => database.prepare(`UPDATE compliance_users
      SET governance_identity_verified = 1,
        governance_identity_verified_by_uid = 'platform-owner-uid',
        governance_identity_verified_at = ?,
        governance_identity_verification_basis =
          'Attempted certification by a suspended owner.'
      WHERE id = 'requester'`).run(NOW),
    /COMPLIANCE_GOVERNANCE_IDENTITY_IMMUTABLE_OR_INVALID/,
  );
  database.prepare(`UPDATE admin_users SET status = 'active'
    WHERE id = 'platform-owner'`).run();
  for (const memberId of ["requester", "reviewer", "reviewer-2"]) {
    assert.equal(
      database.prepare(`UPDATE compliance_users
        SET governance_identity_verified = 1,
          governance_identity_verified_by_uid = 'platform-owner-uid',
          governance_identity_verified_at = ?,
          governance_identity_verification_basis =
            'Government-issued identity checked by an operations owner.'
        WHERE id = ?`).run(NOW, memberId).changes,
      1,
    );
  }
  for (const requestedByUid of ["shared-reviewer", "backoffice"]) {
    assert.throws(
      () => insertGovernanceRequest(database, {
        id: `unverified-${requestedByUid}`,
        requestedByUid,
      }),
      /COMPLIANCE_NAMED_ADMIN_REQUESTER_REQUIRED/,
    );
  }
  for (const [memberId, verifierUid] of [
    ["shared-reviewer", "backoffice"],
    ["backoffice", "shared-reviewer"],
  ]) {
    assert.throws(
      () => database.prepare(`UPDATE compliance_users
        SET governance_identity_verified = 1,
          governance_identity_verified_by_uid = ?,
          governance_identity_verified_at = ?,
          governance_identity_verification_basis = 'Cross certification'
        WHERE id = ?`).run(verifierUid, NOW, memberId),
      /COMPLIANCE_GOVERNANCE_IDENTITY_IMMUTABLE_OR_INVALID/,
    );
  }
  assert.throws(
    () => database.prepare(`UPDATE compliance_users
      SET governance_identity_verified = 1,
        governance_identity_verified_by_uid = 'self-certifier',
        governance_identity_verified_at = ?,
        governance_identity_verification_basis = 'Self attestation'
      WHERE id = 'self-certifier'`).run(NOW),
    /COMPLIANCE_GOVERNANCE_IDENTITY_IMMUTABLE_OR_INVALID/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_users
      SET governance_identity_verification_basis = 'Rewritten provenance'
      WHERE id = 'requester'`).run(),
    /COMPLIANCE_GOVERNANCE_IDENTITY_IMMUTABLE_OR_INVALID/,
  );

  assert.throws(
    () => insertGovernanceRequest(database, {
      id: "direct-approved",
      status: "approved",
      reviewedByUid: "reviewer-1",
      reviewedAt: NOW,
      reviewNote: "Approved before insert",
    }),
    /COMPLIANCE_GOVERNANCE_REQUEST_MUST_START_PENDING/,
  );
  assert.throws(
    () => insertGovernanceRequest(database, {
      id: "pending-with-review",
      reviewedByUid: "reviewer-1",
      reviewedAt: NOW,
      reviewNote: "Review fields must not exist yet",
    }),
    /COMPLIANCE_GOVERNANCE_REQUEST_MUST_START_PENDING/,
  );

  insertGovernanceRequest(database, { id: "pending-prepopulation" });
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET reviewed_by_uid = 'reviewer-1'
      WHERE id = 'pending-prepopulation'`).run(),
    /COMPLIANCE_GOVERNANCE_TRANSITION_INVALID/,
  );
  insertGovernanceRequest(database, { id: "self-review" });
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET status = 'approved', reviewed_by_uid = 'requester-1',
        reviewed_at = ?, review_note = 'Self review'
      WHERE id = 'self-review'`).run(NOW),
    /COMPLIANCE_GOVERNANCE_TRANSITION_INVALID/,
  );
  insertGovernanceRequest(database, { id: "missing-review-note" });
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET status = 'approved', reviewed_by_uid = 'reviewer-1',
        reviewed_at = ?, review_note = ''
      WHERE id = 'missing-review-note'`).run(NOW),
    /COMPLIANCE_GOVERNANCE_TRANSITION_INVALID/,
  );
  insertGovernanceRequest(database, { id: "shared-reviewer" });
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET status = 'approved', reviewed_by_uid = 'shared-reviewer',
        reviewed_at = ?, review_note = 'Shared mailbox review'
      WHERE id = 'shared-reviewer'`).run(NOW),
    /COMPLIANCE_NAMED_ADMIN_REVIEWER_REQUIRED/,
  );

  insertGovernanceRequest(database, { id: "approved-request" });
  assert.equal(database.prepare(`UPDATE compliance_governance_requests
    SET status = 'approved', reviewed_by_uid = 'reviewer-1',
      reviewed_at = ?, review_note = 'Independently approved', updated_at = ?
    WHERE id = 'approved-request'`).run(NOW, NOW).changes, 1);
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET id = 'renamed-approved-request'
      WHERE id = 'approved-request'`).run(),
    /COMPLIANCE_GOVERNANCE_REQUEST_IMMUTABLE/,
  );
  for (const statement of [
    `UPDATE compliance_governance_requests
      SET status = 'rejected' WHERE id = 'approved-request'`,
    `UPDATE compliance_governance_requests
      SET reviewed_by_uid = 'reviewer-2' WHERE id = 'approved-request'`,
    `UPDATE compliance_governance_requests
      SET reviewed_at = '2026-08-02T00:00:00.000Z'
      WHERE id = 'approved-request'`,
    `UPDATE compliance_governance_requests
      SET review_note = 'Rewritten decision' WHERE id = 'approved-request'`,
    `UPDATE compliance_governance_requests
      SET updated_at = '2026-08-02T00:00:00.000Z'
      WHERE id = 'approved-request'`,
  ]) {
    assert.throws(
      () => database.prepare(statement).run(),
      /COMPLIANCE_GOVERNANCE_DECISION_IMMUTABLE/,
    );
  }

  insertGovernanceRequest(database, { id: "rejected-request" });
  assert.equal(database.prepare(`UPDATE compliance_governance_requests
    SET status = 'rejected', reviewed_by_uid = 'reviewer-1',
      reviewed_at = ?, review_note = 'Independently rejected', updated_at = ?
    WHERE id = 'rejected-request'`).run(NOW, NOW).changes, 1);
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET review_note = 'Rewritten rejection'
      WHERE id = 'rejected-request'`).run(),
    /COMPLIANCE_GOVERNANCE_DECISION_IMMUTABLE/,
  );

  insertGovernanceRequest(database, { id: "superseded-request" });
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET status = 'superseded', reviewed_by_uid = 'reviewer-1',
        reviewed_at = ?, review_note = 'Invalid reviewed supersession'
      WHERE id = 'superseded-request'`).run(NOW),
    /COMPLIANCE_GOVERNANCE_TRANSITION_INVALID/,
  );
  assert.equal(database.prepare(`UPDATE compliance_governance_requests
    SET status = 'superseded', reviewed_at = ?,
      review_note = 'Content changed before review', updated_at = ?
    WHERE id = 'superseded-request'`).run(NOW, NOW).changes, 1);
  assert.throws(
    () => database.prepare(`UPDATE compliance_governance_requests
      SET review_note = 'Rewritten supersession'
      WHERE id = 'superseded-request'`).run(),
    /COMPLIANCE_GOVERNANCE_DECISION_IMMUTABLE/,
  );
});

test("only a verified named active admin can withdraw every governed rule type", () => {
  const database = governanceDatabase();
  database.exec(`
    INSERT INTO admin_users (id, firebase_uid, role, status)
      VALUES ('platform-owner', 'platform-owner-uid', 'owner', 'active');
    INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, email, display_name, role, status,
       governance_identity_verified, governance_identity_verified_by_uid,
       governance_identity_verified_at, governance_identity_verification_basis)
      VALUES
      ('shared-info', 'org-1', 'shared-info', 'info@ausenergyassessments.com',
        'Shared operations inbox', 'admin', 'active', 0, '', '', ''),
      ('unverified-admin', 'org-1', 'unverified-admin',
        'backoffice@example.com', 'Backoffice Admin', 'admin', 'active',
        0, '', '', ''),
      ('verified-admin', 'org-1', 'verified-admin',
        'casey.admin@example.com', 'Casey Admin', 'admin', 'active', 1,
        'platform-owner-uid', '${NOW}', 'Identity checked by platform owner');
    INSERT INTO compliance_programs
      (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
       administering_body, official_source_url, official_source_title,
       official_source_version, official_source_sha256,
       official_source_checked_at, publish_state, updated_at)
      VALUES ('program-1', 'org-1', 'PROGRAM', 'Program', 'certificate', 'AU',
        'Regulator', 'https://regulator.example/program', 'Program rules', '1',
        '${HASH}', '${NOW}', 'published', '${NOW}');
    INSERT INTO compliance_activity_versions
      (id, program_id, activity_key, version, title, service_category,
       registry_activity_code, specification_part, product_category,
       scenario_code, scenario, jurisdiction, effective_from, effective_to,
       official_source_url, official_source_title, official_source_version,
       official_source_sha256, official_source_checked_at,
       requirements_snapshot, calculation_approval_state, publish_state,
       updated_at)
      VALUES ('activity-1', 'program-1', 'activity', 1, 'Activity',
        'hot-water', 'A1', 'Part 1', 'heat-pump', 'S1', 'Scenario', 'AU',
        '2026-01-01', '', 'https://regulator.example/activity',
        'Activity rules', '1', '${HASH}', '${NOW}', '{}', 'not_assessed',
        'published', '${NOW}');
    INSERT INTO compliance_evidence_policy_versions
      (id, organisation_id, activity_version_id, publish_state,
       content_revision)
      VALUES ('policy-1', 'org-1', 'activity-1', 'published', 1);
  `);
  installGuards(database, [
    "compliance_programs_named_withdrawer_guard",
    "compliance_activity_versions_named_withdrawer_guard",
    "compliance_evidence_policies_named_withdrawer_guard",
  ]);

  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET publish_state = 'withdrawn', withdrawn_by_uid = 'shared-info'
      WHERE id = 'program-1'`).run(),
    /COMPLIANCE_NAMED_ADMIN_WITHDRAWER_REQUIRED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_activity_versions
      SET publish_state = 'withdrawn',
        withdrawn_by_uid = 'unverified-admin'
      WHERE id = 'activity-1'`).run(),
    /COMPLIANCE_NAMED_ADMIN_WITHDRAWER_REQUIRED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_evidence_policy_versions
      SET publish_state = 'withdrawn', withdrawn_by_uid = 'shared-info'
      WHERE id = 'policy-1'`).run(),
    /COMPLIANCE_NAMED_ADMIN_WITHDRAWER_REQUIRED/,
  );

  assert.equal(database.prepare(`UPDATE compliance_programs
    SET publish_state = 'withdrawn', withdrawn_by_uid = 'verified-admin'
    WHERE id = 'program-1'`).run().changes, 1);
  assert.equal(database.prepare(`UPDATE compliance_activity_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = 'verified-admin'
    WHERE id = 'activity-1'`).run().changes, 1);
  assert.equal(database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = 'verified-admin'
    WHERE id = 'policy-1'`).run().changes, 1);
});

test("evidence policy publication fails closed for unenforced capture timing", () => {
  const database = governanceDatabase();
  database.exec(`
    INSERT INTO compliance_evidence_policy_versions
      (id, organisation_id, activity_version_id, publish_state,
       content_revision)
      VALUES ('policy-1', 'org-1', 'activity-1', 'draft', 1);
    INSERT INTO compliance_evidence_requirements
      (id, organisation_id, policy_version_id, title, capture_timing)
      VALUES ('requirement-1', 'org-1', 'policy-1',
        'Installation photo', 'pre_install');
  `);
  installGuards(database, [
    "compliance_evidence_policies_capture_timing_update_guard",
  ]);

  for (const timing of [
    "pre_install",
    "during_install",
    "post_install",
    "periodic",
  ]) {
    database.prepare(`UPDATE compliance_evidence_requirements
      SET capture_timing = ? WHERE id = 'requirement-1'`).run(timing);
    assert.throws(
      () => database.prepare(`UPDATE compliance_evidence_policy_versions
        SET publish_state = 'published' WHERE id = 'policy-1'`).run(),
      /COMPLIANCE_CAPTURE_TIMING_UNSUPPORTED/,
      timing,
    );
  }

  database.prepare(`UPDATE compliance_evidence_requirements
    SET capture_timing = 'any' WHERE id = 'requirement-1'`).run();
  assert.equal(database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'published' WHERE id = 'policy-1'`).run().changes, 1);
});

test("active evidence originals are distinct at the database boundary", () => {
  const evidenceDatabase = () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE compliance_evidence_requirements (
        id text PRIMARY KEY NOT NULL,
        organisation_id text NOT NULL,
        maximum_count integer NOT NULL
      );
      CREATE TABLE compliance_case_evidence (
        id text PRIMARY KEY NOT NULL,
        organisation_id text NOT NULL,
        case_id text NOT NULL,
        requirement_id text NOT NULL,
        original_sha256 text NOT NULL,
        status text NOT NULL
      );
      INSERT INTO compliance_evidence_requirements
        (id, organisation_id, maximum_count)
        VALUES ('requirement-1', 'org-1', 2);
    `);
    return database;
  };
  const insertEvidence = (
    database,
    id,
    originalSha256,
    status = "received",
  ) => database.prepare(`INSERT INTO compliance_case_evidence
      (id, organisation_id, case_id, requirement_id, original_sha256, status)
      VALUES (?, 'org-1', 'case-1', 'requirement-1', ?, ?)`)
    .run(id, originalSha256, status);

  const guarded = evidenceDatabase();
  installGuards(guarded, [
    "compliance_case_evidence_duplicate_original_guard",
    "compliance_case_evidence_duplicate_original_update_guard",
  ]);
  insertEvidence(guarded, "active-1", HASH);
  assert.throws(
    () => insertEvidence(guarded, "active-duplicate", HASH),
    /COMPLIANCE_EVIDENCE_DUPLICATE_ORIGINAL/,
  );
  guarded.prepare(`UPDATE compliance_case_evidence
    SET status = 'rejected' WHERE id = 'active-1'`).run();
  assert.equal(
    insertEvidence(guarded, "corrected-after-rejection", HASH).changes,
    1,
  );
  guarded.prepare(`UPDATE compliance_case_evidence
    SET status = 'superseded'
    WHERE id = 'corrected-after-rejection'`).run();
  assert.equal(
    insertEvidence(guarded, "corrected-after-supersession", HASH).changes,
    1,
  );
  assert.throws(
    () => guarded.prepare(`UPDATE compliance_case_evidence
      SET status = 'received' WHERE id = 'active-1'`).run(),
    /COMPLIANCE_EVIDENCE_DUPLICATE_ORIGINAL/,
  );

  const distinctMaximum = evidenceDatabase();
  installGuards(distinctMaximum, [
    "compliance_case_evidence_maximum_count_guard",
    "compliance_case_evidence_maximum_count_update_guard",
  ]);
  insertEvidence(distinctMaximum, "legacy-duplicate-1", HASH);
  insertEvidence(distinctMaximum, "legacy-duplicate-2", HASH);
  assert.equal(
    insertEvidence(distinctMaximum, "second-distinct-original", "b".repeat(64))
      .changes,
    1,
  );
  assert.throws(
    () => insertEvidence(
      distinctMaximum,
      "third-distinct-original",
      "c".repeat(64),
    ),
    /COMPLIANCE_EVIDENCE_MAXIMUM_REACHED/,
  );
});

test("sealed snapshots block reviewed content changes and immutable identity bypasses", () => {
  const database = governanceDatabase();
  installGuards(database, [
    "compliance_programs_pending_content_guard",
    "compliance_activity_versions_pending_content_guard",
    "compliance_evidence_policy_pending_content_guard",
    "compliance_evidence_requirement_pending_insert_guard",
    "compliance_evidence_requirement_pending_update_guard",
    "compliance_evidence_requirement_pending_delete_guard",
    "compliance_evidence_requirement_published_no_update",
    "compliance_evidence_requirement_published_no_delete",
    "compliance_evidence_requirement_non_draft_no_insert",
  ]);
  database.prepare(`INSERT INTO compliance_programs
    (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
     administering_body, official_source_url, official_source_title,
     official_source_version, official_source_sha256,
     official_source_checked_at, publish_state, updated_at)
    VALUES ('program-1', 'org-1', 'PROGRAM', 'Program', 'certificate', 'AU',
      'Regulator', 'https://regulator.example/program', 'Program rules', '1',
      ?, ?, 'draft', ?)`).run(HASH, NOW, NOW);
  database.prepare(`INSERT INTO compliance_activity_versions
    (id, program_id, activity_key, version, title, service_category,
     registry_activity_code, specification_part, product_category,
     scenario_code, scenario, jurisdiction, effective_from, effective_to,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_snapshot,
     calculation_approval_state, publish_state, updated_at)
    VALUES ('activity-1', 'program-1', 'activity', 1, 'Activity', 'hot-water',
      'A1', 'Part 1', 'heat-pump', 'S1', 'Scenario', 'AU', '2026-01-01', '',
      'https://regulator.example/activity', 'Activity rules', '1', ?, ?, '{}',
      'not_assessed', 'draft', ?)`).run(HASH, NOW, NOW);
  database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, organisation_id, activity_version_id, version, title,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_complete,
     publish_state, content_revision)
    VALUES ('policy-1', 'org-1', 'activity-1', 1, 'Evidence policy',
      'https://regulator.example/policy', 'Evidence rules', '1', ?, ?, 1,
      'draft', 1)`).run(HASH, NOW);
  database.prepare(`INSERT INTO compliance_evidence_requirements
    (id, organisation_id, policy_version_id, title)
    VALUES ('requirement-1', 'org-1', 'policy-1', 'Installation photo')`).run();
  insertGovernanceRequest(database, {
    id: "program-request",
    targetType: "program",
    targetId: "program-1",
  });
  insertGovernanceRequest(database, {
    id: "activity-request",
    targetType: "activity",
    targetId: "activity-1",
  });
  insertGovernanceRequest(database, {
    id: "policy-request",
    targetType: "evidence_policy",
    targetId: "policy-1",
  });

  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET name = 'Changed program' WHERE id = 'program-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET id = 'renamed-program' WHERE id = 'program-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_activity_versions
      SET requirements_snapshot = '{"changed":true}'
      WHERE id = 'activity-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_activity_versions
      SET id = 'renamed-activity' WHERE id = 'activity-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.equal(database.prepare(`UPDATE compliance_programs
    SET updated_at = '2026-08-02T00:00:00.000Z'
    WHERE id = 'program-1'`).run().changes, 1);
  assert.equal(database.prepare(`UPDATE compliance_activity_versions
    SET updated_at = '2026-08-02T00:00:00.000Z'
    WHERE id = 'activity-1'`).run().changes, 1);

  for (const requestId of [
    "program-request",
    "activity-request",
    "policy-request",
  ]) {
    assert.equal(database.prepare(`UPDATE compliance_governance_requests
      SET status = 'approved', reviewed_by_uid = 'reviewer-1',
        reviewed_at = ?, review_note = 'Independently approved',
        updated_at = ?
      WHERE id = ?`).run(NOW, NOW, requestId).changes, 1);
  }
  assert.throws(
    () => database.prepare(`UPDATE compliance_programs
      SET name = 'Tampered after approval', publish_state = 'published'
      WHERE id = 'program-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_activity_versions
      SET title = 'Tampered after approval', publish_state = 'published'
      WHERE id = 'activity-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_evidence_policy_versions
      SET title = 'Tampered after approval', publish_state = 'published'
      WHERE id = 'policy-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`INSERT INTO compliance_evidence_requirements
      (id, organisation_id, policy_version_id, title)
      VALUES ('late-requirement', 'org-1', 'policy-1', 'Late evidence')`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_evidence_requirements
      SET title = 'Changed after approval'
      WHERE id = 'requirement-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM compliance_evidence_requirements
      WHERE id = 'requirement-1'`).run(),
    /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
  );

  assert.equal(database.prepare(`UPDATE compliance_programs
    SET publish_state = 'published' WHERE id = 'program-1'`).run().changes, 1);
  assert.equal(database.prepare(`UPDATE compliance_activity_versions
    SET publish_state = 'published' WHERE id = 'activity-1'`).run().changes, 1);
  assert.equal(database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'published' WHERE id = 'policy-1'`).run().changes, 1);
  for (const statement of [
    `UPDATE compliance_programs
      SET id = 'renamed-program' WHERE id = 'program-1'`,
    `UPDATE compliance_activity_versions
      SET id = 'renamed-activity' WHERE id = 'activity-1'`,
    `UPDATE compliance_evidence_policy_versions
      SET id = 'renamed-policy' WHERE id = 'policy-1'`,
  ]) {
    assert.throws(
      () => database.prepare(statement).run(),
      /COMPLIANCE_PENDING_REVIEW_MUST_BE_SUPERSEDED/,
    );
  }
  assert.throws(
    () => database.prepare(`UPDATE compliance_evidence_requirements
      SET title = 'Changed after publication'
      WHERE id = 'requirement-1'`).run(),
    /COMPLIANCE_(?:PENDING_REVIEW_MUST_BE_SUPERSEDED|EVIDENCE_REQUIREMENT_IMMUTABLE)/,
  );
});

test("evidence policy content revisions freeze after draft publication", () => {
  const database = governanceDatabase();
  installGuards(database, [
    "compliance_evidence_policy_content_revision_no_update",
  ]);
  database.exec(`
    INSERT INTO compliance_evidence_policy_versions
      (id, publish_state, content_revision)
      VALUES ('draft-policy', 'draft', 1);
    INSERT INTO compliance_evidence_policy_versions
      (id, publish_state, content_revision)
      VALUES ('published-policy', 'published', 4);
    INSERT INTO compliance_evidence_policy_versions
      (id, publish_state, content_revision)
      VALUES ('withdrawn-policy', 'withdrawn', 7);
  `);

  assert.equal(database.prepare(`UPDATE compliance_evidence_policy_versions
    SET content_revision = 2 WHERE id = 'draft-policy'`).run().changes, 1);
  assert.throws(
    () => database.prepare(`UPDATE compliance_evidence_policy_versions
      SET publish_state = 'published', content_revision = 3
      WHERE id = 'draft-policy'`).run(),
    /COMPLIANCE_EVIDENCE_POLICY_IMMUTABLE/,
  );
  for (const id of ["published-policy", "withdrawn-policy"]) {
    assert.throws(
      () => database.prepare(`UPDATE compliance_evidence_policy_versions
        SET content_revision = content_revision + 1 WHERE id = ?`).run(id),
      /COMPLIANCE_EVIDENCE_POLICY_IMMUTABLE/,
    );
  }
});
