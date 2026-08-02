import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  CreditexManualPolicyMergeError,
  validatePinnedManualEvidenceFormV2,
} from "../src/lib/creditex-manual-policy-merge.ts";
import {
  approveManualPolicyBinding,
  createManualPolicyBindingDraft,
  loadManualPolicyMergeStatus,
  lockManualPolicyComposition,
  previewManualPolicyComposition,
  withdrawManualPolicyBinding,
} from "../src/lib/creditex-manual-policy-merge-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
  canonicalCreditexSchemaGuardSql,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL("../drizzle/0114_creditex_manual_policy_merge.sql", import.meta.url),
  "utf8",
);
const route = fs.readFileSync(
  new URL(
    "../src/app/api/creditex/manual-policy-merge/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const manualPolicyGuardDefinitions = CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
  (definition) => definition.name.startsWith("compliance_manual_policy_"),
);
const manualPolicyGuardSql = manualPolicyGuardDefinitions
  .map((definition) => definition.sql)
  .join("\n");
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
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: result.lastInsertRowid,
      },
    };
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

function setupDatabase({ governed = true } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      email text NOT NULL,
      display_name text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      governance_identity_verified integer NOT NULL,
      governance_identity_verified_by_uid text NOT NULL,
      governance_identity_verified_at text NOT NULL,
      governance_identity_verification_basis text NOT NULL
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
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
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
      publish_state text NOT NULL,
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
    );
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      official_source_url text NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      official_source_checked_at text NOT NULL,
      requirements_complete integer NOT NULL,
      publish_state text NOT NULL,
      publication_request_id text NOT NULL,
      publication_snapshot_sha256 text NOT NULL,
      content_revision integer NOT NULL,
      published_by_uid text NOT NULL,
      published_at text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      requirement_code text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      evidence_type text NOT NULL,
      capture_timing text NOT NULL,
      minimum_count integer NOT NULL,
      maximum_count integer NOT NULL,
      original_required integer NOT NULL,
      metadata_required integer NOT NULL,
      gps_required integer NOT NULL,
      date_stamp_required integer NOT NULL,
      installer_signature_required integer NOT NULL,
      customer_signature_required integer NOT NULL,
      allowed_content_types text NOT NULL,
      condition_snapshot text NOT NULL,
      field_schema text NOT NULL,
      source_citation text NOT NULL,
      sort_order integer NOT NULL
    );
    CREATE TABLE compliance_official_source_artifacts (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      sha256 text NOT NULL,
      object_key text NOT NULL,
      custody_state text NOT NULL,
      rule_activation_enabled integer NOT NULL
    );
    CREATE TABLE compliance_official_source_bindings (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      artifact_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      citation_location text NOT NULL,
      binding_state text NOT NULL,
      rule_activation_enabled integer NOT NULL
    );
    CREATE TABLE compliance_official_source_review_decisions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      subject_type text NOT NULL,
      subject_id text NOT NULL,
      artifact_id text NOT NULL,
      artifact_sha256 text NOT NULL,
      artifact_object_key text NOT NULL,
      binding_target_type text NOT NULL,
      binding_target_id text NOT NULL,
      citation_location text NOT NULL,
      decision text NOT NULL,
      reviewed_at text NOT NULL
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
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      program_id text NOT NULL,
      activity_version_id text NOT NULL,
      activity_date text NOT NULL,
      activity_snapshot text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_pilot_runs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_pilot_jobs (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      activity_template_id text NOT NULL,
      activity_key text NOT NULL,
      registry_activity_code text NOT NULL,
      activity_date text NOT NULL,
      record_mode text NOT NULL,
      review_status text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  database.exec(migration);
  for (const definition of manualPolicyGuardDefinitions) {
    database.exec(definition.sql);
  }
  database.exec(`
    INSERT INTO compliance_users (
      id, organisation_id, firebase_uid, email, display_name, role, status,
      governance_identity_verified, governance_identity_verified_by_uid,
      governance_identity_verified_at,
      governance_identity_verification_basis
    ) VALUES
      (
        'member-requester', 'org-1', 'admin-requester',
        'requester@example.test', 'Requester Admin', 'admin', 'active', 1,
        'owner-uid', '2026-08-01T00:00:00.000Z', 'identity checked'
      ),
      (
        'member-approver', 'org-1', 'admin-approver',
        'approver@example.test', 'Approver Admin', 'admin', 'active', 1,
        'owner-uid', '2026-08-01T00:00:00.000Z', 'identity checked'
      ),
      (
        'member-reviewer', 'org-1', 'reviewer-uid',
        'reviewer@example.test', 'Review User', 'reviewer', 'active', 1,
        'owner-uid', '2026-08-01T00:00:00.000Z', 'identity checked'
      );
  `);
  if (governed) seedGovernedInventory(database);
  return database;
}

const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
  ({ templateId }) => templateId === "sres-pv",
);
const program = GOVERNMENT_PROGRAM_TEMPLATES.find(
  ({ programCode }) => programCode === activity.programCode,
);
const hashes = {
  program: "a".repeat(64),
  activity: "b".repeat(64),
  policy: "c".repeat(64),
};

function seedSource(database, targetType, targetId, hash) {
  const artifactId = `artifact-${targetType}`;
  const bindingId = `binding-${targetType}`;
  const objectKey = `sources/${targetType}.pdf`;
  database.prepare(`INSERT INTO compliance_official_source_artifacts
      (id, organisation_id, sha256, object_key, custody_state,
        rule_activation_enabled)
    VALUES (?, 'org-1', ?, ?, 'pending_review', 0)`)
    .run(artifactId, hash, objectKey);
  database.prepare(`INSERT INTO compliance_official_source_bindings
      (id, organisation_id, artifact_id, target_type, target_id,
        citation_location, binding_state, rule_activation_enabled)
    VALUES (?, 'org-1', ?, ?, ?, 'page 1', 'pending_review', 0)`)
    .run(bindingId, artifactId, targetType, targetId);
  database.prepare(`INSERT INTO compliance_official_source_review_decisions
      (id, organisation_id, subject_type, subject_id, artifact_id,
        artifact_sha256, artifact_object_key, binding_target_type,
        binding_target_id, citation_location, decision, reviewed_at)
    VALUES
      (?, 'org-1', 'artifact', ?, ?, ?, ?, '', '', '', 'approved',
        '2026-08-01T01:00:00.000Z'),
      (?, 'org-1', 'binding', ?, ?, ?, ?, ?, ?, 'page 1', 'approved',
        '2026-08-01T02:00:00.000Z')`)
    .run(
      `review-artifact-${targetType}`,
      artifactId,
      artifactId,
      hash,
      objectKey,
      `review-binding-${targetType}`,
      bindingId,
      artifactId,
      hash,
      objectKey,
      targetType,
      targetId,
    );
}

function seedGovernedInventory(database) {
  database.prepare(`INSERT INTO compliance_programs (
      id, organisation_id, program_code, name, scheme_kind, jurisdiction,
      administering_body, official_source_url, official_source_title,
      official_source_version, official_source_sha256,
      official_source_checked_at, publish_state, publication_request_id,
      publication_snapshot_sha256, published_by_uid, published_at
    ) VALUES (
      'program-1', 'org-1', ?, ?, ?, ?, ?, 'https://cer.gov.au/program.pdf',
      'SRES program instrument', '2026.1', ?,
      '2026-08-01T00:00:00.000Z', 'published', 'publish-program-1', ?,
      'publisher-program', '2026-08-01T03:00:00.000Z'
    )`).run(
    program.programCode,
    program.name,
    program.outcomeClass,
    program.jurisdiction,
    program.administeringBody,
    hashes.program,
    "d".repeat(64),
  );
  database.prepare(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, specification_part, product_category,
      scenario_code, scenario, jurisdiction, effective_from, effective_to,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at, publish_state,
      publication_request_id, publication_snapshot_sha256, published_by_uid,
      published_at
    ) VALUES (
      'activity-1', 'program-1', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?,
      '2026-01-01', '2026-12-31', 'https://cer.gov.au/activity.pdf',
      'SRES activity instrument', '2026.1', ?,
      '2026-08-01T00:00:00.000Z', 'published', 'publish-activity-1', ?,
      'publisher-activity', '2026-08-01T03:10:00.000Z'
    )`).run(
    activity.activityKey,
    activity.title,
    activity.serviceCategory,
    activity.registryActivityCode,
    activity.specificationPart,
    activity.productCategory,
    activity.scenarioCode,
    activity.scenario,
    program.jurisdiction,
    hashes.activity,
    "e".repeat(64),
  );
  database.prepare(`INSERT INTO compliance_evidence_policy_versions (
      id, organisation_id, activity_version_id, version, title,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at,
      requirements_complete, publish_state, publication_request_id,
      publication_snapshot_sha256, content_revision, published_by_uid,
      published_at
    ) VALUES (
      'policy-1', 'org-1', 'activity-1', 1, 'SRES PV evidence policy',
      'https://cer.gov.au/policy.pdf', 'SRES evidence requirements', '2026.1',
      ?, '2026-08-01T00:00:00.000Z', 1, 'published', 'publish-policy-1', ?,
      1, 'publisher-policy', '2026-08-01T03:20:00.000Z'
    )`).run(hashes.policy, "f".repeat(64));
  database.exec(`
    INSERT INTO compliance_evidence_requirements (
      id, organisation_id, policy_version_id, requirement_code, title,
      description, evidence_type, capture_timing, minimum_count,
      maximum_count, original_required, metadata_required, gps_required,
      date_stamp_required, installer_signature_required,
      customer_signature_required, allowed_content_types,
      condition_snapshot, field_schema, source_citation, sort_order
    ) VALUES
      (
        'requirement-existing-plate', 'org-1', 'policy-1',
        'existing_model_plate', 'Existing appliance model plate',
        'Capture the original model plate before removal.', 'photo',
        'pre_install', 1, 2, 1, 1, 1, 1, 0, 0,
        '["image/jpeg"]', '{}', '{"focus":"model_and_serial"}',
        'SRES evidence guide page 10', 10
      ),
      (
        'requirement-installed', 'org-1', 'policy-1',
        'installed_system', 'Installed system',
        'Capture the completed installation.', 'photo',
        'post_install', 1, 3, 1, 1, 1, 1, 1, 0,
        '["image/jpeg"]', '{}', '{}',
        'SRES evidence guide page 11', 20
      );
  `);
  seedSource(database, "program", "program-1", hashes.program);
  seedSource(database, "activity", "activity-1", hashes.activity);
  seedSource(database, "evidence_policy", "policy-1", hashes.policy);
  database.exec(`
    INSERT INTO compliance_cases (
      id, organisation_id, program_id, activity_version_id, activity_date,
      activity_snapshot, revision, updated_at
    ) VALUES (
      'case-1', 'org-1', 'program-1', 'activity-1', '2026-06-30',
      '{"activity":"sres-pv"}', 3, '2026-08-01T04:00:00.000Z'
    );
    INSERT INTO compliance_pilot_runs (
      id, organisation_id, status
    ) VALUES ('pilot-1', 'org-1', 'active');
    INSERT INTO compliance_pilot_jobs (
      id, pilot_run_id, activity_template_id, activity_key,
      registry_activity_code, activity_date, record_mode, review_status,
      updated_at
    ) VALUES (
      'pilot-job-1', 'pilot-1', '${activity.templateId}',
      '${activity.activityKey}', '${activity.registryActivityCode}',
      '2026-07-01', 'synthetic_test', 'test_ready',
      '2026-08-01T04:00:00.000Z'
    );
  `);
}

const requester = {
  uid: "admin-requester",
  organisationId: "org-1",
  role: "admin",
  governanceIdentityVerified: true,
};
const approver = {
  ...requester,
  uid: "admin-approver",
};
const reviewer = {
  ...requester,
  uid: "reviewer-uid",
  role: "reviewer",
};

function idFactory(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

async function createDraft(database, suffix = "draft") {
  return createManualPolicyBindingDraft(
    testD1(database),
    requester,
    {
      activityTemplateId: activity.templateId,
      activityVersionId: "activity-1",
      evidencePolicyVersionId: "policy-1",
    },
    {
      now: "2026-08-02T00:00:00.000Z",
      idFactory: idFactory(suffix),
    },
  );
}

function operationalField(origin = "creditex_operational_test") {
  return {
    fieldCode: "creditex_site_access_note",
    label: "Site access note",
    instructions: "Record access details that help Creditex review this test.",
    fieldType: "text",
    captureTiming: "any_time",
    origin,
    required: false,
    minimumCount: 0,
    maximumCount: 1,
    originalRequired: false,
    metadataRequired: false,
    gpsRequired: false,
    options: [],
    allowedContentTypes: [],
    source: origin === "creditex_operational_test"
      ? null
      : {
        officialSourceUrl: "https://example.gov.au/rule",
        officialSourceTitle: "Candidate only",
        officialSourceVersion: "1",
        officialSourceSha256: "9".repeat(64),
        clause: "1",
      },
  };
}

function caseReference(referenceId = "case-1") {
  return {
    referenceType: "compliance_case",
    referenceId,
  };
}

function seedCase(database, id, activityDate) {
  database.prepare(`INSERT INTO compliance_cases (
      id, organisation_id, program_id, activity_version_id, activity_date,
      activity_snapshot, revision, updated_at
    ) VALUES (?, 'org-1', 'program-1', 'activity-1', ?,
      '{"activity":"sres-pv"}', 1, '2026-08-01T04:00:00.000Z')`)
    .run(id, activityDate);
}

function seedOverlappingActivity(database) {
  database.exec(`INSERT INTO compliance_activity_versions (
      id, program_id, activity_key, version, title, service_category,
      registry_activity_code, specification_part, product_category,
      scenario_code, scenario, jurisdiction, effective_from, effective_to,
      official_source_url, official_source_title, official_source_version,
      official_source_sha256, official_source_checked_at, publish_state,
      publication_request_id, publication_snapshot_sha256, published_by_uid,
      published_at
    )
    SELECT 'activity-overlap', program_id, activity_key, 2, title,
      service_category, registry_activity_code, specification_part,
      product_category, scenario_code, scenario, jurisdiction,
      '2026-06-01', '2026-09-01', official_source_url,
      official_source_title, official_source_version, official_source_sha256,
      official_source_checked_at, publish_state, 'publish-overlap',
      publication_snapshot_sha256, published_by_uid, published_at
    FROM compliance_activity_versions
    WHERE id = 'activity-1'`);
}

test("zero governed inventory returns an explicit blocked result", async () => {
  const database = setupDatabase({ governed: false });
  const status = await loadManualPolicyMergeStatus(
    testD1(database),
    requester,
  );
  assert.deepEqual(status.inventory, {
    publishedPrograms: 0,
    publishedActivities: 0,
    publishedCompleteEvidencePolicies: 0,
    linkedApprovedBindings: 0,
    linkedReadyBindings: 0,
  });
  assert.equal(status.readiness.status, "blocked");
  assert.equal(status.readiness.code, "GOVERNED_POLICY_INVENTORY_EMPTY");
  assert.deepEqual(status.bindings, []);
});

test("binding is sealed, independently approved and composed without changing government order", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database);
  assert.equal(draft.lifecycleState, "draft");
  assert.equal(draft.bindingSnapshot.requirements.length, 2);
  assert.deepEqual(
    draft.bindingSnapshot.requirements.map(({ id }) => id),
    ["requirement-existing-plate", "requirement-installed"],
  );

  await assert.rejects(
    approveManualPolicyBinding(
      testD1(database),
      requester,
      {
        bindingId: draft.id,
        expectedSnapshotSha256: draft.bindingSnapshotSha256,
        approvalNote: "Requester self approval must be rejected.",
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "MANUAL_POLICY_INDEPENDENT_APPROVER_REQUIRED",
  );

  const approved = await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Checked the exact source chain and requirement order.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("approve"),
    },
  );
  assert.equal(approved.lifecycleState, "approved");
  assert.equal(approved.approvedByUid, approver.uid);

  const preview = await previewManualPolicyComposition(
    testD1(database),
    reviewer,
    {
      bindingId: approved.id,
      ...caseReference(),
      instructionOverlays: [{
        requirementId: "requirement-existing-plate",
        instructions:
          "Photograph the whole plate first, then a close-up of model and serial.",
      }],
      operationalFields: [operationalField()],
    },
  );
  assert.equal(preview.lockAllowed, false);
  assert.equal(
    preview.lockBlockedCode,
    "MANUAL_POLICY_GOVERNANCE_ADMIN_REQUIRED",
  );
  assert.equal(preview.diff.length > 0, true);
  assert.equal(preview.composition.governmentRequirements.length, 2);
  assert.deepEqual(
    preview.composition.governmentRequirements,
    approved.bindingSnapshot.requirements,
  );
  assert.match(preview.compositionSha256, /^[0-9a-f]{64}$/);
  assert.match(preview.diffSha256, /^[0-9a-f]{64}$/);
});

test("authoritative activity dates include both published boundaries and reject expired or future jobs", async () => {
  const database = setupDatabase();
  seedCase(database, "case-effective-start", "2026-01-01");
  seedCase(database, "case-effective-end", "2026-12-31");
  seedCase(database, "case-expired", "2025-12-31");
  seedCase(database, "case-future", "2027-01-01");
  const draft = await createDraft(database, "dates");
  await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Approved exact governed source and policy binding.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("dates-approve"),
    },
  );
  const start = await previewManualPolicyComposition(
    testD1(database),
    reviewer,
    { bindingId: draft.id, ...caseReference("case-effective-start") },
  );
  const end = await previewManualPolicyComposition(
    testD1(database),
    reviewer,
    { bindingId: draft.id, ...caseReference("case-effective-end") },
  );
  assert.equal(start.activityReference.activityDate, "2026-01-01");
  assert.equal(end.activityReference.activityDate, "2026-12-31");
  for (const referenceId of ["case-expired", "case-future"]) {
    await assert.rejects(
      previewManualPolicyComposition(
        testD1(database),
        reviewer,
        { bindingId: draft.id, ...caseReference(referenceId) },
      ),
      (error) =>
        error instanceof CreditexManualPolicyMergeError
        && error.code ===
          "MANUAL_POLICY_ACTIVITY_DATE_OUTSIDE_EFFECTIVE_RANGE",
    );
  }
  await assert.rejects(
    previewManualPolicyComposition(
      testD1(database),
      reviewer,
      {
        bindingId: draft.id,
        activityDate: "2026-06-30",
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "MANUAL_POLICY_ACTIVITY_REFERENCE_REQUIRED",
  );
  seedOverlappingActivity(database);
  await assert.rejects(
    previewManualPolicyComposition(
      testD1(database),
      reviewer,
      { bindingId: draft.id, ...caseReference() },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "MANUAL_POLICY_ACTIVITY_DATE_VERSION_AMBIGUOUS",
  );
});

test("preview uses persisted prior state and lock replacement requires exact revision and hashes", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database, "lock");
  await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Approved exact governed source and policy binding.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("lock-approve"),
    },
  );
  const firstInput = {
    bindingId: draft.id,
    ...caseReference(),
    instructionOverlays: [{
      requirementId: "requirement-existing-plate",
      instructions: "Capture the full plate and a readable close-up.",
    }],
  };
  const firstPreview = await previewManualPolicyComposition(
    testD1(database),
    requester,
    firstInput,
  );
  assert.equal(firstPreview.lockAllowed, true);
  assert.equal(firstPreview.expectedRevision, 0);
  assert.equal(firstPreview.previousLock, null);
  const firstLock = await lockManualPolicyComposition(
    testD1(database),
    requester,
    {
      ...firstInput,
      expectedRevision: firstPreview.expectedRevision,
      expectedPreviousCompositionSha256:
        firstPreview.expectedPreviousCompositionSha256,
      expectedCompositionSha256: firstPreview.compositionSha256,
      expectedDiffSha256: firstPreview.diffSha256,
    },
    {
      now: "2026-08-02T02:00:00.000Z",
      idFactory: idFactory("lock-first"),
    },
  );
  assert.equal(firstLock.revision, 1);
  const secondInput = {
    ...firstInput,
    instructionOverlays: [{
      requirementId: "requirement-existing-plate",
      instructions:
        "Capture the full plate, then verify the model and serial are readable.",
    }],
  };
  const secondPreview = await previewManualPolicyComposition(
    testD1(database),
    requester,
    secondInput,
  );
  assert.equal(secondPreview.expectedRevision, 1);
  assert.equal(secondPreview.previousLock.id, firstLock.id);
  assert.equal(
    secondPreview.expectedPreviousCompositionSha256,
    firstLock.compositionSha256,
  );
  assert.deepEqual(
    secondPreview.diff.map(({ path }) => path),
    ["/instructionOverlays/0/instructions"],
  );
  await assert.rejects(
    lockManualPolicyComposition(
      testD1(database),
      requester,
      {
        ...secondInput,
        expectedRevision: 0,
        expectedPreviousCompositionSha256: "",
        expectedCompositionSha256: secondPreview.compositionSha256,
        expectedDiffSha256: secondPreview.diffSha256,
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "MANUAL_POLICY_COMPOSITION_REVISION_CONFLICT",
  );
  const secondLock = await lockManualPolicyComposition(
    testD1(database),
    requester,
    {
      ...secondInput,
      expectedRevision: secondPreview.expectedRevision,
      expectedPreviousCompositionSha256:
        secondPreview.expectedPreviousCompositionSha256,
      expectedCompositionSha256: secondPreview.compositionSha256,
      expectedDiffSha256: secondPreview.diffSha256,
    },
    {
      now: "2026-08-02T03:00:00.000Z",
      idFactory: idFactory("lock-second"),
    },
  );
  assert.equal(secondLock.revision, 2);
  assert.equal(
    database.prepare(`SELECT superseded_by_id
      FROM compliance_manual_policy_composition_locks
      WHERE id = ?`).get(firstLock.id).superseded_by_id,
    secondLock.id,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_policy_composition_locks
      SET composition_sha256 = ?
      WHERE id = ?`).run("0".repeat(64), firstLock.id),
    /COMPLIANCE_MANUAL_POLICY_COMPOSITION_IMMUTABLE/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM
      compliance_manual_policy_composition_locks WHERE id = ?`)
      .run(secondLock.id),
    /COMPLIANCE_MANUAL_POLICY_COMPOSITION_DELETE_BLOCKED/,
  );
  await assert.rejects(
    previewManualPolicyComposition(
      testD1(database),
      requester,
      {
        ...secondInput,
        previousComposition: firstPreview.composition,
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code ===
        "MANUAL_POLICY_CALLER_PREVIOUS_COMPOSITION_REJECTED",
  );
});

test("readiness requires an exact approved binding whose retained-source approvals are still current", async () => {
  const database = setupDatabase();
  const before = await loadManualPolicyMergeStatus(
    testD1(database),
    requester,
  );
  assert.equal(before.readiness.code, "GOVERNED_POLICY_BINDING_NOT_READY");
  const draft = await createDraft(database, "readiness");
  await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Approved exact governed source and policy binding.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("readiness-approve"),
    },
  );
  const ready = await loadManualPolicyMergeStatus(
    testD1(database),
    requester,
  );
  assert.equal(ready.inventory.linkedApprovedBindings, 1);
  assert.equal(ready.inventory.linkedReadyBindings, 1);
  assert.equal(ready.readiness.status, "ready");
  database.prepare(`INSERT INTO compliance_official_source_review_decisions
      (id, organisation_id, subject_type, subject_id, artifact_id,
        artifact_sha256, artifact_object_key, binding_target_type,
        binding_target_id, citation_location, decision, reviewed_at)
    VALUES (
      'review-policy-withdrawn', 'org-1', 'binding',
      'binding-evidence_policy', 'artifact-evidence_policy', ?,
      'sources/evidence_policy.pdf', 'evidence_policy', 'policy-1',
      'page 1', 'withdrawn', '2026-08-03T00:00:00.000Z'
    )`).run(hashes.policy);
  const blocked = await loadManualPolicyMergeStatus(
    testD1(database),
    requester,
  );
  assert.equal(blocked.inventory.linkedApprovedBindings, 1);
  assert.equal(blocked.inventory.linkedReadyBindings, 0);
  assert.equal(blocked.readiness.code, "GOVERNED_POLICY_BINDING_NOT_READY");
});

test("candidate fields and changed or reordered government requirements are blocked", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database, "candidate");
  await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Approved exact governed source and policy binding.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("candidate-approve"),
    },
  );
  await assert.rejects(
    previewManualPolicyComposition(
      testD1(database),
      reviewer,
      {
        bindingId: draft.id,
        ...caseReference(),
        operationalFields: [
          operationalField("government_requirement_candidate"),
        ],
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "GOVERNMENT_CANDIDATE_NON_AUTHORITATIVE",
  );
  const preview = await previewManualPolicyComposition(
    testD1(database),
    reviewer,
    { bindingId: draft.id, ...caseReference() },
  );
  const changed = JSON.parse(JSON.stringify(preview.composition));
  changed.governmentRequirements[0].minimumCount = 0;
  await assert.rejects(
    validatePinnedManualEvidenceFormV2(changed),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "GOVERNMENT_REQUIREMENTS_CHANGED",
  );
  const reordered = JSON.parse(JSON.stringify(preview.composition));
  reordered.governmentRequirements.reverse();
  await assert.rejects(
    validatePinnedManualEvidenceFormV2(reordered),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "GOVERNMENT_REQUIREMENTS_CHANGED",
  );
});

test("withdrawal blocks new composition while the pinned approved form remains readable", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database, "withdraw");
  const approved = await approveManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: draft.id,
      expectedSnapshotSha256: draft.bindingSnapshotSha256,
      approvalNote: "Approved exact governed source and policy binding.",
    },
    {
      now: "2026-08-02T01:00:00.000Z",
      idFactory: idFactory("withdraw-approve"),
    },
  );
  const preview = await previewManualPolicyComposition(
    testD1(database),
    reviewer,
    { bindingId: approved.id, ...caseReference() },
  );
  const withdrawn = await withdrawManualPolicyBinding(
    testD1(database),
    approver,
    {
      bindingId: approved.id,
      expectedSnapshotSha256: approved.bindingSnapshotSha256,
      withdrawalNote: "Superseded by a newly published evidence policy.",
    },
    {
      now: "2026-08-02T02:00:00.000Z",
      idFactory: idFactory("withdraw-final"),
    },
  );
  assert.equal(withdrawn.lifecycleState, "withdrawn");
  await assert.rejects(
    previewManualPolicyComposition(
      testD1(database),
      reviewer,
      { bindingId: approved.id, ...caseReference() },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "MANUAL_POLICY_BINDING_WITHDRAWN",
  );
  const pinned = await validatePinnedManualEvidenceFormV2(
    preview.composition,
  );
  assert.equal(pinned.bindingId, approved.id);
  assert.deepEqual(
    pinned.governmentRequirements,
    approved.bindingSnapshot.requirements,
  );
});

test("migration blocks snapshot mutation, deletion and invalid lifecycle writes", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database, "db-guard");
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_policy_bindings
      SET binding_snapshot_sha256 = ?
      WHERE id = ?`).run("0".repeat(64), draft.id),
    /COMPLIANCE_MANUAL_POLICY_(SNAPSHOT_IMMUTABLE|TRANSITION_INVALID)/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_policy_bindings
      SET lifecycle_state = 'withdrawn',
        withdrawn_by_uid = 'admin-approver',
        withdrawn_at = '2026-08-02T02:00:00.000Z',
        withdrawal_note = 'Invalid direct withdrawal.'
      WHERE id = ?`).run(draft.id),
    /CHECK constraint failed|COMPLIANCE_MANUAL_POLICY_TRANSITION_INVALID/,
  );
  assert.throws(
    () => database.prepare(
      "DELETE FROM compliance_manual_policy_bindings WHERE id = ?",
    ).run(draft.id),
    /COMPLIANCE_MANUAL_POLICY_DELETE_BLOCKED/,
  );
});

test("approval is blocked when exact retained-source approval is withdrawn", async () => {
  const database = setupDatabase();
  const draft = await createDraft(database, "stale-source");
  database.prepare(`INSERT INTO compliance_official_source_review_decisions
      (id, organisation_id, subject_type, subject_id, artifact_id,
        artifact_sha256, artifact_object_key, binding_target_type,
        binding_target_id, citation_location, decision, reviewed_at)
    VALUES (
      'review-program-withdrawn', 'org-1', 'binding', 'binding-program',
      'artifact-program', ?, 'sources/program.pdf', 'program', 'program-1',
      'page 1', 'withdrawn', '2026-08-02T00:30:00.000Z'
    )`).run(hashes.program);
  await assert.rejects(
    approveManualPolicyBinding(
      testD1(database),
      approver,
      {
        bindingId: draft.id,
        expectedSnapshotSha256: draft.bindingSnapshotSha256,
        approvalNote: "This must fail because source approval was withdrawn.",
      },
    ),
    (error) =>
      error instanceof CreditexManualPolicyMergeError
      && error.code === "SOURCE_BINDING_APPROVAL_REQUIRED",
  );
});

test("API and migration expose the protected governed workflow", () => {
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /create_binding_draft/);
  assert.match(route, /approve_binding/);
  assert.match(route, /withdraw_binding/);
  assert.match(route, /preview_composition/);
  assert.match(route, /lock_composition/);
  assert.doesNotMatch(route, /ensureCreditexSchemaGuards/);
  assert.match(
    migration,
    /compliance_manual_policy_current_template_idx/,
  );
  assert.match(
    manualPolicyGuardSql,
    /COMPLIANCE_MANUAL_POLICY_INDEPENDENT_APPROVER_REQUIRED/,
  );
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.match(
    migration,
    /compliance_manual_policy_composition_current_idx/,
  );
});

test("manual policy runtime guards install with canonical SQL", () => {
  assert.equal(manualPolicyGuardDefinitions.length, 12);
  const database = setupDatabase();
  for (const definition of manualPolicyGuardDefinitions) {
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
