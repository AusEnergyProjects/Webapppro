import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import {
  canonicalCreditexSchemaGuardSql,
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
  ensureCreditexSchemaGuards,
} from "../src/lib/creditex-schema-guards.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const foundationMigration = read("../drizzle/0093_creditex_compliance_foundation.sql");
const operationsMigrationSources = [
  "../drizzle/0094_creditex_operations_control.sql",
  "../drizzle/0095_creditex_operations_workflows.sql",
  "../drizzle/0096_creditex_operations_integrity.sql",
  "../drizzle/0097_creditex_operations_lifecycle.sql",
].map(read);
const operationsMigration = operationsMigrationSources.join("\n--> statement-breakpoint\n");
const mediaRoute = read("../src/app/api/trade-team/media/route.ts");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");

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

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
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
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadTypescriptModule(path, mocks = {}) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function applyStatements(database, migration) {
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    database.exec(statement);
  }
}

test("Sites migration inputs keep one complete SQLite statement per physical line", () => {
  for (const migration of [foundationMigration, ...operationsMigrationSources]) {
    const statements = migration
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(statements.length > 0);
    assert.doesNotMatch(migration, /statement-breakpoint/);
    for (const statement of statements) {
      assert.match(statement, /;$/);
    }
  }
});

function databaseWithComplianceOperations({ installGuards = true } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_number text NOT NULL,
      work_type text DEFAULT 'job' NOT NULL,
      source_type text DEFAULT 'internal' NOT NULL,
      source_reference text DEFAULT '' NOT NULL,
      title text DEFAULT '' NOT NULL,
      service_category text NOT NULL,
      stage text DEFAULT 'backlog' NOT NULL,
      priority text DEFAULT 'standard' NOT NULL,
      assignee_label text DEFAULT '' NOT NULL,
      assignee_member_id text DEFAULT '' NOT NULL,
      scheduled_start text DEFAULT '' NOT NULL,
      created_at text DEFAULT '' NOT NULL,
      updated_at text DEFAULT '' NOT NULL
    );
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY NOT NULL,
      business_name text DEFAULT '' NOT NULL,
      contact_name text DEFAULT '' NOT NULL,
      email text DEFAULT '' NOT NULL,
      phone text DEFAULT '' NOT NULL,
      verified_abn text DEFAULT '' NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      site_label text DEFAULT '' NOT NULL,
      address_line_1 text DEFAULT '' NOT NULL,
      address_line_2 text DEFAULT '' NOT NULL,
      suburb text DEFAULT '' NOT NULL,
      address_state text DEFAULT '' NOT NULL,
      postcode text DEFAULT '' NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      service_site_id text DEFAULT '' NOT NULL,
      crm_customer_id text DEFAULT '' NOT NULL,
      customer_reference text DEFAULT '' NOT NULL,
      tags text DEFAULT '[]' NOT NULL,
      pipeline_stage text DEFAULT 'enquiry' NOT NULL,
      quote_status text DEFAULT 'not_started' NOT NULL,
      invoice_status text DEFAULT 'not_started' NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      customer_number text DEFAULT '' NOT NULL,
      customer_type text DEFAULT 'residential' NOT NULL,
      first_name text DEFAULT '' NOT NULL,
      last_name text DEFAULT '' NOT NULL,
      business_name text DEFAULT '' NOT NULL,
      email text DEFAULT '' NOT NULL,
      phone text DEFAULT '' NOT NULL,
      address_line_1 text DEFAULT '' NOT NULL,
      address_line_2 text DEFAULT '' NOT NULL,
      suburb text DEFAULT '' NOT NULL,
      address_state text DEFAULT '' NOT NULL,
      postcode text DEFAULT '' NOT NULL,
      tags text DEFAULT '[]' NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      appointment_type text DEFAULT 'site_visit' NOT NULL,
      status text DEFAULT 'scheduled' NOT NULL,
      starts_at text DEFAULT '' NOT NULL
    );
    CREATE TABLE trade_crm_job_notes (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      note_type text DEFAULT 'internal' NOT NULL,
      issue_status text DEFAULT 'not_applicable' NOT NULL
    );
    CREATE TABLE trade_mobile_upload_sessions (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL
    );
  `);
  applyStatements(database, foundationMigration);
  applyStatements(database, operationsMigration);
  if (installGuards) {
    for (const definition of CREDITEX_SCHEMA_GUARD_DEFINITIONS) {
      database.exec(definition.sql);
    }
  }
  return database;
}

test("runtime schema bootstrap installs every governed trigger before compliance access", async () => {
  const database = databaseWithComplianceOperations({ installGuards: false });
  const d1 = testD1(database);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type = 'trigger'").get().count,
    0,
  );
  await assert.rejects(
    ensureCreditexSchemaGuards(d1),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:92/,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type = 'trigger'").get().count,
    40,
  );
  await assert.rejects(
    ensureCreditexSchemaGuards(d1),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:52/,
  );
  await assert.rejects(
    ensureCreditexSchemaGuards(d1),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:12/,
  );
  await ensureCreditexSchemaGuards(d1);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type = 'trigger'").get().count,
    CREDITEX_SCHEMA_GUARD_DEFINITIONS.length,
  );
});

test("runtime schema bootstrap accepts legacy multiline guards across stateless worker invocations", async () => {
  const database = databaseWithComplianceOperations({ installGuards: false });
  const expected = CREDITEX_SCHEMA_GUARD_DEFINITIONS[0].sql;
  const legacy = expected
    .replace("CREATE TRIGGER IF NOT EXISTS", "CREATE   TRIGGER")
    .replace(" BEFORE INSERT ", "\nBEFORE INSERT\n")
    .replace(" WHEN ", "\nWHEN\n")
    .replace(" BEGIN ", "\nBEGIN\n")
    .replace(/;\s*$/, "");
  database.exec(legacy);
  await assert.rejects(
    ensureCreditexSchemaGuards(testD1(database)),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:91/,
  );
  await assert.rejects(
    ensureCreditexSchemaGuards(testD1(database)),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:51/,
  );
  await assert.rejects(
    ensureCreditexSchemaGuards(testD1(database)),
    /CREDITEX_SCHEMA_GUARDS_INSTALLING:11/,
  );
  await ensureCreditexSchemaGuards(testD1(database));
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM sqlite_schema WHERE type = 'trigger'",
    ).get().count,
    CREDITEX_SCHEMA_GUARD_DEFINITIONS.length,
  );
});

test("runtime schema bootstrap fails closed when a same-name guard has different SQL", async () => {
  const database = databaseWithComplianceOperations({ installGuards: false });
  database.exec(`CREATE TRIGGER compliance_programs_publish_requirements
    BEFORE INSERT ON compliance_programs
    BEGIN SELECT RAISE(ABORT, 'incorrect guard'); END;`);
  await assert.rejects(
    ensureCreditexSchemaGuards(testD1(database)),
    /CREDITEX_SCHEMA_GUARD_MISMATCH:compliance_programs_publish_requirements/,
  );
});

test("schema guard comparison preserves whitespace inside SQL string literals", async () => {
  const database = databaseWithComplianceOperations({ installGuards: false });
  const altered = CREDITEX_SCHEMA_GUARD_DEFINITIONS[0].sql
    .replace(
      "source and publisher evidence",
      "source  and publisher evidence",
    );
  database.exec(altered);
  await assert.rejects(
    ensureCreditexSchemaGuards(testD1(database)),
    /CREDITEX_SCHEMA_GUARD_MISMATCH:compliance_programs_publish_requirements/,
  );
});

test("schema guard comparison ignores storage-only multiline formatting", () => {
  const expected = CREDITEX_SCHEMA_GUARD_DEFINITIONS[0].sql;
  const stored = expected
    .replace("CREATE TRIGGER IF NOT EXISTS", "CREATE   TRIGGER")
    .replace(" BEFORE INSERT ", "\nBEFORE INSERT\n")
    .replace(" AND ( ", "\nAND (\n")
    .replaceAll(" OR ", "\n  OR ")
    .replace(/;\s*$/, "");
  assert.equal(
    canonicalCreditexSchemaGuardSql(stored),
    canonicalCreditexSchemaGuardSql(expected),
  );
});

const TEST_NOW = "2026-08-01T00:00:00.000Z";
const TEST_HASH = "a".repeat(64);

function seedOrganisation(database, {
  id,
  code,
  legalName,
  tradingName,
}) {
  database.prepare(`INSERT OR IGNORE INTO compliance_organisations
    (id, organisation_code, legal_name, trading_name, abn, status,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', 'active', 'test', ?, ?)`)
    .run(id, code, legalName, tradingName, TEST_NOW, TEST_NOW);
}

function seedGovernedActivity(database, {
  organisationId = "org_creditex_au",
  programId = "program",
  activityVersionId = "activity",
  policyVersionId = "policy",
  requirementId = "requirement",
  key = "test",
  calculationApprovalState = "not_applicable",
} = {}) {
  const programCode = `TEST-${key.toUpperCase()}`;
  const programName = `Test program ${key}`;
  const activityKey = `test-activity-${key}`;
  const activityTitle = `Test activity ${key}`;
  database.prepare(`INSERT INTO compliance_programs
    (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
     administering_body, official_source_url, official_source_title,
     official_source_version, official_source_sha256,
     official_source_checked_at, publish_state, published_by_uid, published_at,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'certificate', 'AU', 'Test regulator',
      'https://regulator.example', 'Test rule', '1', ?, ?, 'published',
      'approver', ?, 'author', ?, ?)`)
    .run(
      programId,
      organisationId,
      programCode,
      programName,
      TEST_HASH,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
    );
  database.prepare(`INSERT INTO compliance_activity_versions
    (id, program_id, activity_key, version, title, service_category,
     registry_activity_code, specification_part, product_category,
     scenario_code, scenario, jurisdiction, effective_from, effective_to,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_snapshot,
     publish_state, calculation_approval_state, published_by_uid, published_at,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, 'hot-water', 'T1', 'Part T', 'test-product',
      'S1', 'Test scenario', 'VIC', '2026-01-01', '',
      'https://regulator.example', 'Test rule', '1', ?, ?, '{}', 'published',
      ?, 'approver', ?, 'author', ?, ?)`)
    .run(
      activityVersionId,
      programId,
      activityKey,
      activityTitle,
      TEST_HASH,
      TEST_NOW,
      calculationApprovalState,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
    );
  database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, organisation_id, activity_version_id, version, title,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_complete,
     publish_state, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, 'https://regulator.example/rule', 'Rule', '1',
      ?, ?, 0, 'draft', 'admin-uid', ?, ?)`)
    .run(
      policyVersionId,
      organisationId,
      activityVersionId,
      `Evidence policy ${key}`,
      TEST_HASH,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
    );
  database.prepare(`INSERT INTO compliance_evidence_requirements
    (id, organisation_id, policy_version_id, requirement_code, title,
     evidence_type, capture_timing, minimum_count, maximum_count,
     original_required, metadata_required, gps_required, date_stamp_required,
     installer_signature_required, customer_signature_required,
     allowed_content_types, condition_snapshot, field_schema, source_citation,
     sort_order, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, 'PHOTO-BEFORE', 'Before photo', 'photo', 'pre_install',
      1, 1, 1, 1, 1, 1, 0, 0, '["image/jpeg"]', '{}', '{}',
      'Rule clause 1', 1, 'admin-uid', ?, ?)`)
    .run(requirementId, organisationId, policyVersionId, TEST_NOW, TEST_NOW);
  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET requirements_complete = 1, publish_state = 'published',
      published_by_uid = 'admin-uid', published_at = ?, updated_at = ?
    WHERE id = ?`).run(TEST_NOW, TEST_NOW, policyVersionId);
  return {
    organisationId,
    programId,
    activityVersionId,
    policyVersionId,
    requirementId,
    calculationApprovalState,
    programCode,
    programName,
    activityKey,
    activityTitle,
  };
}

function seedTradeJob(database, {
  workOrderId = "job",
  installerUid = "installer-uid",
  key = "test",
} = {}) {
  const serviceSiteId = `site-${key}`;
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, work_number, service_category, scheduled_start)
    VALUES (?, ?, ?, 'hot-water', '2026-08-01T09:00:00.000Z')`)
    .run(workOrderId, installerUid, `TLJ-${key.toUpperCase()}`);
  database.prepare(`INSERT INTO trade_crm_service_sites
    (id, firebase_uid, address_state) VALUES (?, ?, 'VIC')`)
    .run(serviceSiteId, installerUid);
  database.prepare(`INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, service_site_id)
    VALUES (?, ?, ?, ?)`)
    .run(`detail-${key}`, workOrderId, installerUid, serviceSiteId);
}

function activitySnapshot(governed, {
  activityDate = "2026-08-01",
  siteJurisdiction = "VIC",
} = {}) {
  return JSON.stringify({
    activityVersionId: governed.activityVersionId,
    programId: governed.programId,
    organisationId: governed.organisationId,
    activityDate,
    siteJurisdiction,
    organisationCode: governed.organisationId === "org_creditex_au"
      ? "CREDITEX-AU"
      : "OTHER-AU",
    organisationLegalName: governed.organisationId === "org_creditex_au"
      ? "Creditex Pty Ltd"
      : "Other Compliance Pty Ltd",
    organisationTradingName: governed.organisationId === "org_creditex_au"
      ? "Creditex"
      : "Other Compliance",
    programCode: governed.programCode,
    programName: governed.programName,
    schemeKind: "certificate",
    programJurisdiction: "AU",
    administeringBody: "Test regulator",
    activityKey: governed.activityKey,
    version: 1,
    title: governed.activityTitle,
    serviceCategory: "hot-water",
    registryActivityCode: "T1",
    specificationPart: "Part T",
    productCategory: "test-product",
    scenarioCode: "S1",
    scenario: "Test scenario",
    jurisdiction: "VIC",
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    officialSourceUrl: "https://regulator.example",
    officialSourceTitle: "Test rule",
    officialSourceVersion: "1",
    officialSourceSha256: TEST_HASH,
    officialSourceCheckedAt: TEST_NOW,
    calculationApprovalState: governed.calculationApprovalState,
    requirementsSnapshotJson: "{}",
    requirementsSnapshot: {},
    evidencePolicyVersionId: governed.policyVersionId,
    evidencePolicyVersion: 1,
    evidencePolicyOfficialSourceVersion: "1",
    evidencePolicyOfficialSourceSha256: TEST_HASH,
  });
}

function seedGovernedCase(database, governed, {
  caseId = "case",
  caseNumber = "CREDITEX-TEST-CASE",
  workOrderId = "job",
  installerUid = "installer-uid",
  revision = 1,
  snapshot = activitySnapshot(governed),
} = {}) {
  database.prepare(`INSERT INTO compliance_cases
    (id, case_number, organisation_id, program_id, work_order_id, installer_uid,
     activity_version_id, evidence_policy_version_id, activity_date,
     site_jurisdiction, activity_snapshot, status, evidence_status, revision,
     created_by_type, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-08-01', 'VIC', ?, 'draft',
      'not_started', ?, 'installer', ?, ?, ?)`)
    .run(
      caseId,
      caseNumber,
      governed.organisationId,
      governed.programId,
      workOrderId,
      installerUid,
      governed.activityVersionId,
      governed.policyVersionId,
      snapshot,
      revision,
      installerUid,
      TEST_NOW,
      TEST_NOW,
    );
}

function seedComplianceUser(database, {
  id,
  firebaseUid,
  role,
  organisationId = "org_creditex_au",
}) {
  database.prepare(`INSERT INTO compliance_users
    (id, organisation_id, firebase_uid, email, display_name, role, status,
     created_by_uid, last_login_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 'test', '', ?, ?)`)
    .run(
      id,
      organisationId,
      firebaseUid,
      `${firebaseUid}@example.com`,
      firebaseUid,
      role,
      TEST_NOW,
      TEST_NOW,
  );
}

function seedCaseAssignment(database, {
  id,
  caseId = "case",
  complianceUserId,
  assignmentRole,
  assignedByUid = "admin-uid",
  organisationId = "org_creditex_au",
} = {}) {
  database.prepare(`INSERT INTO compliance_case_assignments
    (id, organisation_id, case_id, compliance_user_id, assignment_role,
     status, assigned_by_uid, assigned_at)
    VALUES (?, ?, ?, ?, ?, 'assigned', ?, ?)`)
    .run(
      id,
      organisationId,
      caseId,
      complianceUserId,
      assignmentRole,
      assignedByUid,
      TEST_NOW,
    );
}

function seedEvidenceRecord(database, governed, {
  caseId = "case",
  evidenceId = "evidence",
  status = "received",
  supersedesEvidenceId = "",
  originalSha256 = TEST_HASH,
} = {}) {
  const reviewed = ["accepted", "rejected", "superseded", "withdrawn"]
    .includes(status);
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, supersedes_evidence_id,
     source_type, status, object_key, file_name, content_type, size_bytes,
     original_sha256, evidence_envelope, received_by_type, received_by_uid,
     received_at, reviewed_by_uid, reviewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'field_app', ?, ?, 'photo.jpg', 'image/jpeg',
      100, ?, '{}', 'installer', 'installer-uid', ?, ?, ?, ?, ?)`)
    .run(
      evidenceId,
      governed.organisationId,
      caseId,
      governed.requirementId,
      supersedesEvidenceId,
      status,
      `private/${evidenceId}`,
      originalSha256,
      TEST_NOW,
      reviewed ? "reviewer-uid" : "",
      reviewed ? TEST_NOW : "",
      TEST_NOW,
      TEST_NOW,
    );
}

function seedEvidenceViewReceipt(database, {
  id,
  actorUid,
  evidenceId,
  createdAt = new Date().toISOString(),
  organisationId = "org_creditex_au",
} = {}) {
  database.prepare(`INSERT INTO compliance_audit_events
    (id, organisation_id, actor_type, actor_uid, event_type, target_type,
     target_id, summary, metadata, created_at)
    VALUES (?, ?, 'compliance', ?, 'evidence.viewed',
      'compliance_case_evidence', ?, 'Evidence viewed.', '{}', ?)`)
    .run(id, organisationId, actorUid, evidenceId, createdAt);
}

function seedAcceptedEvidence(database, governed, {
  caseId = "case",
  evidenceId = "evidence",
} = {}) {
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, source_type, status,
     object_key, file_name, content_type, size_bytes, original_sha256,
     evidence_envelope, received_by_type, received_by_uid, received_at,
     reviewed_by_uid, reviewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'field_app', 'accepted', ?, 'photo.jpg', 'image/jpeg',
      100, ?, '{}', 'installer', 'installer-uid', ?, 'reviewer-2', ?, ?, ?)`)
    .run(
      evidenceId,
      governed.organisationId,
      caseId,
      governed.requirementId,
      `private/${evidenceId}`,
      TEST_HASH,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
      TEST_NOW,
    );
}

function seedCalculator(database, governed, {
  calculatorId = "calculator",
  key = "test-calculator",
} = {}) {
  database.prepare(`INSERT INTO compliance_calculator_versions
    (id, organisation_id, activity_version_id, calculator_key, version, title,
     output_type, specification, rounding_policy, official_source_url,
     official_source_version, official_source_sha256, approval_state,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'Test calculator', 'STC', '{}', 'nearest integer',
      'https://regulator.example/calculator', '1', ?, 'draft',
      'reviewer-1', ?, ?)`)
    .run(
      calculatorId,
      governed.organisationId,
      governed.activityVersionId,
      key,
      TEST_HASH,
      TEST_NOW,
      TEST_NOW,
    );
}

function seedSubmissionBatch(database, governed, {
  batchId = "batch",
  batchNumber = "TEST-BATCH",
} = {}) {
  database.prepare(`INSERT INTO compliance_submission_batches
    (id, organisation_id, program_id, batch_number, format, status,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'json', 'draft', 'reviewer-1', ?, ?)`)
    .run(
      batchId,
      governed.organisationId,
      governed.programId,
      batchNumber,
      TEST_NOW,
      TEST_NOW,
    );
}

test("operations migrations provision only the Creditex organisation and bootstrap invitation", () => {
  const database = databaseWithComplianceOperations();
  const organisation = database.prepare(`SELECT organisation_code, legal_name, abn
    FROM compliance_organisations`).get();
  assert.equal(organisation.organisation_code, "CREDITEX-AU");
  assert.equal(organisation.legal_name, "Creditex Pty Ltd");
  assert.equal(organisation.abn, "76105513040");
  const invitation = database.prepare(`SELECT email, role, status, claimed_by_uid,
      expires_at
    FROM compliance_invitations`).get();
  assert.equal(invitation.email, "info@ausenergyassessments.com");
  assert.equal(invitation.role, "admin");
  assert.equal(invitation.status, "pending");
  assert.equal(invitation.claimed_by_uid, "");
  assert.equal(invitation.expires_at, "2026-08-31T00:00:00.000Z");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_users").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_programs").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_activity_versions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_calculator_versions").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_submission_batches").get().count, 0);
});

test("the verified bootstrap identity claims the invitation exactly once", async () => {
  const database = databaseWithComplianceOperations();
  const d1 = testD1(database);
  const access = loadTypescriptModule("../src/lib/compliance-access-server.ts", {
    "../../db": { getD1: () => d1 },
    "./firebase-server": {
      requireFirebaseIdentity: async (request) => request.identity,
    },
    "./creditex-schema-guards": {
      ensureCreditexSchemaGuards: async () => {},
    },
  });
  const identity = {
    uid: "firebase-info-owner",
    email: "info@ausenergyassessments.com",
    emailVerified: true,
    authTime: 0,
    signInProvider: "password",
  };
  const claimed = await access.requireComplianceIdentity(identity, {}, d1);
  assert.equal(claimed.organisationId, "org_creditex_au");
  assert.equal(claimed.role, "admin");
  assert.equal(database.prepare(
    "SELECT status FROM compliance_invitations WHERE id = 'invite_creditex_aea_info'",
  ).get().status, "claimed");
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM compliance_users WHERE firebase_uid = ?",
  ).get(identity.uid).count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM compliance_audit_events WHERE event_type = 'membership.invitation_claimed'",
  ).get().count, 1);
  await access.requireComplianceIdentity(identity, {}, d1);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM compliance_users").get().count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM compliance_audit_events WHERE event_type = 'membership.invitation_claimed'",
  ).get().count, 1);
  assert.throws(() => database.prepare(`UPDATE compliance_invitations
    SET claimed_by_uid = 'rewritten-owner'
    WHERE id = 'invite_creditex_aea_info'`).run(), /CLAIM_IMMUTABLE/);
  assert.throws(() => database.prepare(`UPDATE compliance_users
    SET status = 'suspended' WHERE firebase_uid = ?`).run(identity.uid),
  /COMPLIANCE_FINAL_ADMIN_REQUIRED/);
});

test("operations dashboard and access queries execute against the operations schema", async () => {
  const database = databaseWithComplianceOperations();
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const dashboard = await operations.loadCreditexOperationsDashboard(
    testD1(database),
    "org_creditex_au",
  );
  assert.equal(dashboard.counts.invitations, 1);
  assert.equal(dashboard.counts.audit_events, 0);
  assert.equal(dashboard.controls.registrySubmissionEnabled, false);
  assert.equal(dashboard.controls.calculatorExecutionEnabled, false);
  const access = await operations.loadCreditexAccess(
    testD1(database),
    "org_creditex_au",
  );
  assert.equal(access.members.length, 0);
  assert.equal(access.invitations.length, 1);
});

test("Creditex workspace applies authoritative Dataforce-equivalent filters without returning private list data", async () => {
  const database = databaseWithComplianceOperations();
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedGovernedCase(database, governed);
  seedComplianceUser(database, {
    id: "admin-member",
    firebaseUid: "admin-uid",
    role: "admin",
  });
  database.prepare(`UPDATE trade_work_orders
    SET work_type = 'job', source_type = 'internal', stage = 'scheduled',
      priority = 'high', assignee_label = 'Crew A',
      assignee_member_id = 'crew-a'
    WHERE id = 'job'`).run();
  database.prepare(`INSERT INTO trade_accounts
    (firebase_uid, business_name, contact_name, email, phone, verified_abn)
    VALUES ('installer-uid', 'Installer One Pty Ltd', 'Installer One',
      'installer@example.com', '0400000000', '76105513040')`).run();
  database.prepare(`INSERT INTO trade_crm_customers
    (id, firebase_uid, customer_number, customer_type, first_name, last_name,
      email, address_line_1, suburb, address_state, postcode, tags)
    VALUES ('customer', 'installer-uid', 'CUS-1', 'residential', 'Private',
      'Customer', 'private@example.com', '1 Private Street', 'Melbourne',
      'VIC', '3000', '["veu"]')`).run();
  database.prepare(`UPDATE trade_crm_job_details
    SET crm_customer_id = 'customer', customer_reference = 'CUSTOMER-REF',
      tags = '["priority"]', pipeline_stage = 'approved',
      quote_status = 'accepted', invoice_status = 'issued'
    WHERE work_order_id = 'job'`).run();
  database.prepare(`INSERT INTO trade_crm_appointments
    (id, work_order_id, firebase_uid, appointment_type, status, starts_at)
    VALUES ('appointment', 'job', 'installer-uid', 'installation',
      'scheduled', '2026-08-01T09:00:00.000Z')`).run();
  database.prepare(`INSERT INTO trade_crm_job_notes
    (id, work_order_id, firebase_uid, note_type, issue_status)
    VALUES ('issue', 'job', 'installer-uid', 'issue', 'open')`).run();
  const filters = operations.parseCreditexOperationsFilters(
    new URLSearchParams([
      ["workType", "job"],
      ["serviceCategory", "hot-water"],
      ["createdBy", "installer-uid"],
      ["createdByType", "installer"],
      ["fieldWorker", "Crew A"],
      ["customer", "Private Customer"],
      ["customerType", "residential"],
      ["address", "Melbourne"],
      ["installer", "Installer One"],
      ["jobSource", "internal"],
      ["workStage", "scheduled"],
      ["pipelineStage", "approved"],
      ["priority", "high"],
      ["issueStatus", "open"],
      ["appointmentStatus", "scheduled"],
      ["appointmentType", "installation"],
      ["quoteStatus", "accepted"],
      ["invoiceStatus", "issued"],
      ["productCategory", "test-product"],
      ["tag", "priority"],
      ["tag", "veu"],
      ["tagMatch", "all"],
    ]),
  );
  const scope = {
    organisationId: "org_creditex_au",
    membershipId: "admin-member",
    uid: "admin-uid",
    role: "admin",
  };
  const dashboard = await operations.loadCreditexOperationsDashboard(
    testD1(database),
    scope,
    filters,
  );
  assert.equal(dashboard.workspace.pagination.total, 1);
  assert.equal(dashboard.workspace.cases.length, 1);
  assert.equal(dashboard.workspace.cases[0].caseId, "case");
  assert.equal(dashboard.workspace.cases[0].privateDetailsAvailable, true);
  assert.equal("customerEmail" in dashboard.workspace.cases[0], false);
  assert.equal("customerName" in dashboard.workspace.cases[0], false);
  assert.equal(dashboard.workspace.facets.client.available, false);
  assert.equal(dashboard.workspace.facets.agent.available, false);
  assert.equal(dashboard.workspace.facets.appointmentOutcome.available, false);
  assert.equal(dashboard.workspace.facets.productType.available, false);
  const noMatch = await operations.loadCreditexOperationsDashboard(
    testD1(database),
    scope,
    { ...filters, issueStatuses: ["resolved"] },
  );
  assert.equal(noMatch.workspace.pagination.total, 0);
  assert.equal(noMatch.workspace.cases.length, 0);
});

test("audited local operations execute against the schema and financial guards reconcile", async () => {
  const database = databaseWithComplianceOperations();
  const d1 = testD1(database);
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const complianceDomain = loadTypescriptModule(
    "../src/lib/creditex-compliance-server.ts",
    {
      "./creditex-schema-guards": {
        ensureCreditexSchemaGuards: async () => {},
      },
    },
  );
  const now = TEST_NOW;
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedComplianceUser(database, {
    id: "admin-member",
    firebaseUid: "admin-uid",
    role: "admin",
  });
  seedComplianceUser(database, {
    id: "reviewer-member",
    firebaseUid: "reviewer-2",
    role: "reviewer",
  });
  const preparedCase = await complianceDomain.prepareLiveComplianceCaseStatements(
    d1,
    {
      activityVersionId: "activity",
      activityDate: "2026-08-01",
      serviceCategory: "hot-water",
      jurisdiction: "VIC",
      workOrderId: "job",
      installerUid: "installer-uid",
      actorUid: "installer-uid",
      caseId: "case",
      eventId: "case-created",
      createdAt: now,
    },
  );
  await d1.batch(preparedCase.statements);
  seedAcceptedEvidence(database, governed);
  seedCaseAssignment(database, {
    id: "secondary-assignment",
    complianceUserId: "reviewer-member",
    assignmentRole: "secondary_reviewer",
  });
  const identity = {
    uid: "admin-uid",
    role: "admin",
    organisationId: "org_creditex_au",
  };
  const participant = await operations.executeCreditexOperation(d1, identity, {
    action: "add_participant",
    participantType: "installer",
    legalName: "Test Installer Pty Ltd",
    effectiveFrom: "2026-01-01",
  });
  await operations.executeCreditexOperation(d1, identity, {
    action: "add_participant_ability",
    participantId: participant.id,
    programId: "program",
    activityVersionId: "activity",
    abilityCode: "TEST-INSTALL",
    abilityRole: "installer",
    effectiveFrom: "2026-01-01",
    evidenceSnapshot: { source: "test-only" },
  });
  const batch = await operations.executeCreditexOperation(d1, identity, {
    action: "create_draft_batch",
    programId: "program",
    batchNumber: "TEST-BATCH-1",
    format: "manual",
  });
  assert.ok(batch.id);
  await operations.executeCreditexOperation(d1, identity, {
    action: "record_decision",
    caseId: "case",
    decisionType: "evidence_complete",
    outcome: "approved",
    basisSnapshot: { evidenceId: "evidence" },
  });
  const eligibilityRequest = await operations.executeCreditexOperation(
    d1,
    identity,
    {
      action: "record_decision",
      caseId: "case",
      decisionType: "eligibility",
      outcome: "approved",
      basisSnapshot: { test: true },
    },
  );
  assert.equal(eligibilityRequest.status, "pending_secondary_review");
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "record_decision",
      caseId: "case",
      decisionType: "eligibility",
      outcome: "approved",
      decisionRequestId: eligibilityRequest.id,
    }),
    (error) => error.code === "CREDITEX_DUAL_CONTROL_REQUIRED",
  );
  const secondaryIdentity = {
    uid: "reviewer-2",
    role: "reviewer",
    organisationId: "org_creditex_au",
  };
  await operations.executeCreditexOperation(d1, secondaryIdentity, {
    action: "record_decision",
    caseId: "case",
    decisionType: "eligibility",
    outcome: "approved",
    decisionRequestId: eligibilityRequest.id,
  });
  const readyRequest = await operations.executeCreditexOperation(
    d1,
    identity,
    {
      action: "record_decision",
      caseId: "case",
      decisionType: "ready_to_submit",
      outcome: "approved",
      basisSnapshot: { eligibilityDecisionRequestId: eligibilityRequest.id },
    },
  );
  await operations.executeCreditexOperation(d1, secondaryIdentity, {
    action: "record_decision",
    caseId: "case",
    decisionType: "ready_to_submit",
    outcome: "approved",
    decisionRequestId: readyRequest.id,
  });
  const staged = await operations.executeCreditexOperation(d1, identity, {
    action: "stage_batch_item",
    batchId: batch.id,
    caseId: "case",
  });
  assert.ok(staged.id);
  const lot = await operations.executeCreditexOperation(d1, identity, {
    action: "record_certificate_lot",
    programId: "program",
    certificateType: "TEST",
    quantity: 10,
  });
  database.prepare(
    "UPDATE compliance_certificate_lots SET status = 'available' WHERE id = ?",
  ).run(lot.id);
  const trade = await operations.executeCreditexOperation(d1, identity, {
    action: "record_trade",
    certificateLotId: lot.id,
    counterpartyReference: "test-counterparty",
    quantity: 2,
    unitPriceCents: 500,
    tradeDate: "2026-08-01",
  });
  const settlement = await operations.executeCreditexOperation(d1, identity, {
    action: "record_settlement",
    tradeId: trade.id,
    grossCents: 1_000,
    feeCents: 100,
    dueDate: "2026-08-15",
  });
  assert.ok(settlement.id);
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "record_settlement",
      tradeId: trade.id,
      grossCents: 999,
      feeCents: 0,
      dueDate: "2026-08-15",
    }),
    (error) => error.code === "CREDITEX_SETTLEMENT_GROSS_MISMATCH",
  );
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "record_manual_response",
      batchId: batch.id,
      responseType: "accepted",
      message: "Must stay disabled.",
    }),
    (error) => error.code === "CREDITEX_EXTERNAL_ACTION_DISABLED",
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_audit_events").get().count,
    12,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_write_guards").get().count,
    18,
  );
  const decision = database.prepare(`SELECT primary_reviewer_uid,
      secondary_reviewer_uid, basis_snapshot FROM compliance_case_decisions
    WHERE decision_type = 'eligibility'`).get();
  assert.equal(decision.primary_reviewer_uid, "admin-uid");
  assert.equal(decision.secondary_reviewer_uid, "reviewer-2");
  const evidenceDecision = database.prepare(`SELECT basis_snapshot
    FROM compliance_case_decisions
    WHERE decision_type = 'evidence_complete'`).get();
  const evidenceBasis = JSON.parse(evidenceDecision.basis_snapshot);
  assert.equal(evidenceBasis.schemaVersion, "creditex-decision-basis-v1");
  assert.equal(evidenceBasis.case.id, "case");
  assert.equal(evidenceBasis.case.revision, 1);
  assert.equal(evidenceBasis.evidencePolicy.id, "policy");
  assert.equal(evidenceBasis.evidencePolicy.officialSourceSha256, TEST_HASH);
  assert.deepEqual(evidenceBasis.acceptedEvidence, [{
    id: "evidence",
    requirementId: "requirement",
    originalSha256: TEST_HASH,
  }]);
  assert.equal(evidenceBasis.calculation.verifiedRun, null);
  assert.equal(Object.hasOwn(evidenceBasis, "evidenceId"), false);
  const eligibilityRequestBasis = database.prepare(`SELECT basis_snapshot
    FROM compliance_decision_requests
    WHERE id = ?`).get(eligibilityRequest.id).basis_snapshot;
  assert.equal(decision.basis_snapshot, eligibilityRequestBasis);
  assert.equal(
    Object.hasOwn(JSON.parse(eligibilityRequestBasis), "test"),
    false,
    "caller-authored decision basis must be ignored",
  );
});

test("evidence outcomes require current access, reviewer assignment, and canonical replacement evidence", async () => {
  const database = databaseWithComplianceOperations();
  const d1 = testD1(database);
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const governed = seedGovernedActivity(database, {
    key: "receipt",
    programId: "program-receipt",
    activityVersionId: "activity-receipt",
    policyVersionId: "policy-receipt",
    requirementId: "requirement-receipt",
  });
  seedTradeJob(database, {
    workOrderId: "job-receipt",
    key: "receipt",
  });
  seedGovernedCase(database, governed, {
    caseId: "case-receipt",
    caseNumber: "CREDITEX-RECEIPT",
    workOrderId: "job-receipt",
  });
  seedComplianceUser(database, {
    id: "assigned-reviewer-member",
    firebaseUid: "assigned-reviewer",
    role: "reviewer",
  });
  seedComplianceUser(database, {
    id: "other-reviewer-member",
    firebaseUid: "other-reviewer",
    role: "reviewer",
  });
  seedEvidenceRecord(database, governed, {
    caseId: "case-receipt",
    evidenceId: "rejected-original",
    status: "rejected",
    originalSha256: "b".repeat(64),
  });
  seedEvidenceRecord(database, governed, {
    caseId: "case-receipt",
    evidenceId: "replacement",
    status: "received",
    supersedesEvidenceId: "rejected-original",
    originalSha256: "c".repeat(64),
  });
  const identity = {
    uid: "assigned-reviewer",
    role: "reviewer",
    organisationId: "org_creditex_au",
  };
  seedEvidenceViewReceipt(database, {
    id: "good-receipt",
    actorUid: identity.uid,
    evidenceId: "replacement",
  });
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "review_evidence",
      evidenceId: "replacement",
      status: "accepted",
      reviewNote: "Replacement meets the pinned requirement.",
      evidenceAccessReceiptId: "good-receipt",
    }),
    (error) => error.code === "CREDITEX_CASE_ASSIGNMENT_REQUIRED",
  );
  seedCaseAssignment(database, {
    id: "primary-review-assignment",
    caseId: "case-receipt",
    complianceUserId: "assigned-reviewer-member",
    assignmentRole: "primary_reviewer",
  });
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "review_evidence",
      evidenceId: "replacement",
      status: "accepted",
      reviewNote: "Missing access receipt.",
    }),
    (error) => error.code === "CREDITEX_EVIDENCE_ACCESS_REQUIRED",
  );
  seedEvidenceViewReceipt(database, {
    id: "stale-receipt",
    actorUid: identity.uid,
    evidenceId: "replacement",
    createdAt: new Date(Date.now() - 31 * 60 * 1_000).toISOString(),
  });
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "review_evidence",
      evidenceId: "replacement",
      status: "accepted",
      reviewNote: "Stale access receipt.",
      evidenceAccessReceiptId: "stale-receipt",
    }),
    (error) => error.code === "CREDITEX_EVIDENCE_ACCESS_REQUIRED",
  );
  seedEvidenceViewReceipt(database, {
    id: "wrong-user-receipt",
    actorUid: "other-reviewer",
    evidenceId: "replacement",
  });
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "review_evidence",
      evidenceId: "replacement",
      status: "accepted",
      reviewNote: "Another reviewer viewed it.",
      evidenceAccessReceiptId: "wrong-user-receipt",
    }),
    (error) => error.code === "CREDITEX_EVIDENCE_ACCESS_REQUIRED",
  );
  await operations.executeCreditexOperation(d1, identity, {
    action: "review_evidence",
    evidenceId: "replacement",
    status: "accepted",
    reviewNote: "Replacement meets the pinned requirement.",
    evidenceAccessReceiptId: "good-receipt",
  });
  const reviewedCase = database.prepare(`SELECT revision, evidence_status
    FROM compliance_cases WHERE id = 'case-receipt'`).get();
  assert.equal(reviewedCase.revision, 2);
  assert.equal(reviewedCase.evidence_status, "complete");
  const reviewAudit = database.prepare(`SELECT metadata
    FROM compliance_audit_events
    WHERE event_type = 'case.evidence_reviewed'
      AND target_id = 'replacement'`).get();
  assert.equal(
    JSON.parse(reviewAudit.metadata).evidenceAccessReceiptId,
    "good-receipt",
  );
  await operations.executeCreditexOperation(d1, identity, {
    action: "record_decision",
    caseId: "case-receipt",
    decisionType: "evidence_complete",
    outcome: "approved",
    reviewerNote: "The accepted replacement and current findings were reviewed.",
    basisSnapshot: {
      acceptedEvidence: [{
        id: "forged",
        originalSha256: "0".repeat(64),
      }],
    },
  });
  const basis = JSON.parse(database.prepare(`SELECT basis_snapshot
    FROM compliance_case_decisions
    WHERE case_id = 'case-receipt'
      AND decision_type = 'evidence_complete'`).get().basis_snapshot);
  assert.deepEqual(basis.acceptedEvidence, [{
    id: "replacement",
    requirementId: "requirement-receipt",
    originalSha256: "c".repeat(64),
  }]);
  assert.equal(basis.openFindingState.count, 0);
  assert.deepEqual(basis.reviewerAttestation, {
    note: "The accepted replacement and current findings were reviewed.",
    recordedByUid: "assigned-reviewer",
    authority: "context_only",
  });
  assert.equal(
    basis.acceptedEvidence.some((item) => item.id === "rejected-original"),
    false,
  );
});

test("withdrawn pinned policies remain auditable but block downstream approval", async () => {
  const database = databaseWithComplianceOperations();
  const d1 = testD1(database);
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const governed = seedGovernedActivity(database, {
    key: "withdrawn",
    programId: "program-withdrawn",
    activityVersionId: "activity-withdrawn",
    policyVersionId: "policy-withdrawn",
    requirementId: "requirement-withdrawn",
  });
  seedTradeJob(database, {
    workOrderId: "job-withdrawn",
    key: "withdrawn",
  });
  seedGovernedCase(database, governed, {
    caseId: "case-withdrawn",
    caseNumber: "CREDITEX-WITHDRAWN",
    workOrderId: "job-withdrawn",
  });
  seedComplianceUser(database, {
    id: "withdrawn-admin-member",
    firebaseUid: "withdrawn-admin",
    role: "admin",
  });
  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = ?,
      withdrawn_at = ?, updated_at = ?
    WHERE id = ?`)
    .run("withdrawn-admin", TEST_NOW, TEST_NOW, governed.policyVersionId);
  const identity = {
    uid: "withdrawn-admin",
    role: "admin",
    organisationId: "org_creditex_au",
  };
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "record_decision",
      caseId: "case-withdrawn",
      decisionType: "evidence_complete",
      outcome: "approved",
    }),
    (error) => (
      error.code === "CREDITEX_POLICY_WITHDRAWN"
      && error.status === 409
    ),
  );
  await operations.executeCreditexOperation(d1, identity, {
    action: "record_decision",
    caseId: "case-withdrawn",
    decisionType: "evidence_complete",
    outcome: "changes_required",
    basisSnapshot: { publishState: "published" },
  });
  const basis = JSON.parse(database.prepare(`SELECT basis_snapshot
    FROM compliance_case_decisions
    WHERE case_id = 'case-withdrawn'`).get().basis_snapshot);
  assert.equal(basis.evidencePolicy.publishState, "withdrawn");
  assert.equal(Object.hasOwn(basis, "publishState"), false);
  seedSubmissionBatch(database, governed, {
    batchId: "withdrawn-batch",
    batchNumber: "WITHDRAWN-BATCH",
  });
  database.prepare(`UPDATE compliance_cases
    SET status = 'ready_for_submission'
    WHERE id = 'case-withdrawn'`).run();
  await assert.rejects(
    operations.executeCreditexOperation(d1, identity, {
      action: "stage_batch_item",
      batchId: "withdrawn-batch",
      caseId: "case-withdrawn",
    }),
    (error) => error.code === "CREDITEX_POLICY_WITHDRAWN",
  );
});

test("ready-to-submit decision basis pins the exact verified calculator run", async () => {
  const database = databaseWithComplianceOperations();
  const d1 = testD1(database);
  const operations = loadTypescriptModule(
    "../src/lib/creditex-operations-server.ts",
  );
  const governed = seedGovernedActivity(database, {
    key: "calculator-basis",
    programId: "program-calculator-basis",
    activityVersionId: "activity-calculator-basis",
    policyVersionId: "policy-calculator-basis",
    requirementId: "requirement-calculator-basis",
    calculationApprovalState: "approved",
  });
  seedTradeJob(database, {
    workOrderId: "job-calculator-basis",
    key: "calculator-basis",
  });
  seedGovernedCase(database, governed, {
    caseId: "case-calculator-basis",
    caseNumber: "CREDITEX-CALCULATOR-BASIS",
    workOrderId: "job-calculator-basis",
  });
  seedAcceptedEvidence(database, governed, {
    caseId: "case-calculator-basis",
    evidenceId: "calculator-basis-evidence",
  });
  seedComplianceUser(database, {
    id: "calculator-admin-member",
    firebaseUid: "calculator-admin",
    role: "admin",
  });
  seedComplianceUser(database, {
    id: "calculator-secondary-member",
    firebaseUid: "calculator-secondary",
    role: "reviewer",
  });
  seedCaseAssignment(database, {
    id: "calculator-secondary-assignment",
    caseId: "case-calculator-basis",
    complianceUserId: "calculator-secondary-member",
    assignmentRole: "secondary_reviewer",
    assignedByUid: "calculator-admin",
  });
  seedCalculator(database, governed, {
    calculatorId: "approved-calculator",
    key: "approved-calculator",
  });
  database.prepare(`UPDATE compliance_calculator_versions
    SET approval_state = 'testing', updated_at = ?
    WHERE id = 'approved-calculator'`).run(TEST_NOW);
  database.prepare(`UPDATE compliance_calculator_versions
    SET approval_state = 'approved', primary_approver_uid = 'approver-one',
      secondary_approver_uid = 'approver-two', approved_at = ?, updated_at = ?
    WHERE id = 'approved-calculator'`).run(TEST_NOW, TEST_NOW);
  database.prepare(`INSERT INTO compliance_calculation_runs
    (id, organisation_id, case_id, case_revision, calculator_version_id,
     input_snapshot, output_snapshot, status, blocked_reason, run_by_uid,
     run_at, verified_by_uid, verified_at, created_at)
    VALUES ('verified-run', 'org_creditex_au', 'case-calculator-basis', 1,
      'approved-calculator', '{"postcode":"3000"}', '{"quantity":7}',
      'verified', '', 'calculator-admin', ?, 'calculator-secondary', ?, ?)`)
    .run(TEST_NOW, TEST_NOW, TEST_NOW);
  const primary = {
    uid: "calculator-admin",
    role: "admin",
    organisationId: "org_creditex_au",
  };
  const secondary = {
    uid: "calculator-secondary",
    role: "reviewer",
    organisationId: "org_creditex_au",
  };
  await operations.executeCreditexOperation(d1, primary, {
    action: "record_decision",
    caseId: "case-calculator-basis",
    decisionType: "evidence_complete",
    outcome: "approved",
  });
  const eligibility = await operations.executeCreditexOperation(
    d1,
    primary,
    {
      action: "record_decision",
      caseId: "case-calculator-basis",
      decisionType: "eligibility",
      outcome: "approved",
    },
  );
  await operations.executeCreditexOperation(d1, secondary, {
    action: "record_decision",
    caseId: "case-calculator-basis",
    decisionType: "eligibility",
    outcome: "approved",
    decisionRequestId: eligibility.id,
  });
  const ready = await operations.executeCreditexOperation(d1, primary, {
    action: "record_decision",
    caseId: "case-calculator-basis",
    decisionType: "ready_to_submit",
    outcome: "approved",
    basisSnapshot: {
      calculation: { verifiedRun: { id: "forged-run" } },
    },
  });
  const basis = JSON.parse(database.prepare(`SELECT basis_snapshot
    FROM compliance_decision_requests WHERE id = ?`).get(ready.id).basis_snapshot);
  assert.deepEqual(basis.calculation.verifiedRun, {
    id: "verified-run",
    caseRevision: 1,
    calculatorVersionId: "approved-calculator",
    calculatorVersion: 1,
    calculatorOfficialSourceVersion: "1",
    calculatorOfficialSourceSha256: TEST_HASH,
    inputSnapshot: { postcode: "3000" },
    outputSnapshot: { quantity: 7 },
    status: "verified",
    runByUid: "calculator-admin",
    runAt: TEST_NOW,
    verifiedByUid: "calculator-secondary",
    verifiedAt: TEST_NOW,
  });
  assert.deepEqual(
    basis.priorApprovedDecisions.map((item) => item.decisionType),
    ["evidence_complete", "eligibility"],
  );
});

test("evidence policies require complete requirements and become immutable when published", () => {
  const database = databaseWithComplianceOperations();
  const now = TEST_NOW;
  const hash = TEST_HASH;
  seedGovernedActivity(database, {
    key: "policy",
    policyVersionId: "base-policy",
    requirementId: "base-requirement",
  });
  database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, organisation_id, activity_version_id, version, title,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_complete,
     publish_state, created_by_uid, created_at, updated_at)
    VALUES ('policy', 'org_creditex_au', 'activity', 2, 'Evidence policy',
      'https://regulator.example/rule', 'Rule', '1', ?, ?, 0, 'draft',
      'admin-1', ?, ?)`).run(hash, now, now, now);
  assert.throws(() => database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'published', published_by_uid = 'admin-1', published_at = ?
    WHERE id = 'policy'`).run(now), /POLICY_INCOMPLETE/);
  database.prepare(`INSERT INTO compliance_evidence_requirements
    (id, organisation_id, policy_version_id, requirement_code, title,
     evidence_type, capture_timing, minimum_count, maximum_count,
     original_required, metadata_required, gps_required, date_stamp_required,
     installer_signature_required, customer_signature_required,
     allowed_content_types, condition_snapshot, field_schema, source_citation,
     sort_order, created_by_uid, created_at, updated_at)
    VALUES ('requirement', 'org_creditex_au', 'policy', 'PHOTO-BEFORE',
      'Before photo', 'photo', 'pre_install', 1, 1, 1, 1, 1, 1, 0, 0,
      '[\"image/jpeg\"]', '{}', '{}', 'Rule clause 1', 1, 'admin-1', ?, ?)`)
    .run(now, now);
  database.prepare("UPDATE compliance_evidence_policy_versions SET requirements_complete = 1 WHERE id = 'policy'").run();
  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'published', published_by_uid = 'admin-1', published_at = ?
    WHERE id = 'policy'`).run(now);
  assert.throws(() => database.prepare(
    "UPDATE compliance_evidence_requirements SET title = 'Changed' WHERE id = 'requirement'",
  ).run(), /IMMUTABLE/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_evidence_policy_versions SET title = 'Changed' WHERE id = 'policy'",
  ).run(), /IMMUTABLE/);
  assert.throws(() => database.prepare(`UPDATE compliance_evidence_policy_versions
    SET published_by_uid = 'other-admin', published_at = '2026-08-02T00:00:00.000Z',
      created_by_uid = 'other-creator', created_at = '2026-07-01T00:00:00.000Z'
    WHERE id = 'policy'`).run(), /IMMUTABLE/);
  const insertLateRequirement = (id, code) => database.prepare(`INSERT INTO compliance_evidence_requirements
    (id, organisation_id, policy_version_id, requirement_code, title,
     evidence_type, capture_timing, minimum_count, maximum_count,
     original_required, metadata_required, gps_required, date_stamp_required,
     installer_signature_required, customer_signature_required,
     allowed_content_types, condition_snapshot, field_schema, source_citation,
     sort_order, created_by_uid, created_at, updated_at)
    VALUES (?, 'org_creditex_au', 'policy', ?, 'Late requirement',
      'photo', 'post_install', 1, 1, 1, 1, 0, 0, 0, 0,
      '[\"image/jpeg\"]', '{}', '{}', 'Rule clause 2', 2, 'admin-1', ?, ?)`)
    .run(id, code, now, now);
  assert.throws(
    () => insertLateRequirement("late-published", "PHOTO-LATE-PUBLISHED"),
    /EVIDENCE_REQUIREMENT_IMMUTABLE/,
  );
  database.prepare(`UPDATE compliance_evidence_policy_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = 'admin-1',
      withdrawn_at = ?, updated_at = ?
    WHERE id = 'policy'`).run(now, now);
  assert.throws(() => database.prepare(`UPDATE compliance_evidence_policy_versions
    SET withdrawn_by_uid = 'other-admin',
      withdrawn_at = '2026-08-02T00:00:00.000Z',
      updated_at = '2026-08-02T00:00:00.000Z'
    WHERE id = 'policy'`).run(), /IMMUTABLE/);
  assert.throws(
    () => insertLateRequirement("late-withdrawn", "PHOTO-LATE-WITHDRAWN"),
    /EVIDENCE_REQUIREMENT_IMMUTABLE/,
  );
  assert.throws(() => database.prepare(`INSERT INTO compliance_evidence_policy_versions
    (id, organisation_id, activity_version_id, version, title,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_complete,
     publish_state, created_by_uid, created_at, updated_at)
    VALUES ('bad-hash', 'org_creditex_au', 'activity', 3, 'Bad',
      'https://regulator.example/rule', 'Rule', '2', ?, ?, 0, 'draft',
      'admin-1', ?, ?)`).run(`${"b".repeat(63)}z`, now, now, now), /check constraint/i);
});

test("original evidence, audit events, decisions, calculation runs, and submission artifacts preserve auditability", () => {
  const database = databaseWithComplianceOperations();
  const now = TEST_NOW;
  const originalHash = "c".repeat(64);
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedGovernedCase(database, governed);
  seedComplianceUser(database, {
    id: "reviewer-1-member",
    firebaseUid: "reviewer-1",
    role: "reviewer",
  });
  seedComplianceUser(database, {
    id: "reviewer-2-member",
    firebaseUid: "reviewer-2",
    role: "reviewer",
  });
  database.prepare(`INSERT INTO compliance_calculator_versions
    (id, organisation_id, activity_version_id, calculator_key, version, title,
     output_type, specification, rounding_policy, official_source_url,
     official_source_version, official_source_sha256, approval_state,
     created_by_uid, created_at, updated_at)
    VALUES ('calculator', 'org_creditex_au', 'activity', 'test', 1,
      'Test calculator', 'STC', '{}', 'nearest integer',
      'https://regulator.example/calculator', '1', ?, 'draft',
      'reviewer-1', ?, ?)`).run(TEST_HASH, now, now);
  database.prepare(`INSERT INTO compliance_submission_batches
    (id, organisation_id, program_id, batch_number, format, status,
     created_by_uid, created_at, updated_at)
    VALUES ('batch', 'org_creditex_au', 'program', 'AUDIT-BATCH', 'json',
      'draft', 'reviewer-1', ?, ?)`).run(now, now);
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, source_type, status,
     object_key, file_name, content_type, size_bytes, original_sha256,
     evidence_envelope, received_by_type, received_by_uid, received_at,
     created_at, updated_at)
    VALUES ('evidence', 'org_creditex_au', 'case', 'requirement', 'field_app',
      'received', 'private/object', 'photo.jpg', 'image/jpeg', 100, ?, '{}',
      'installer', 'installer-1', ?, ?, ?)`).run(originalHash, now, now, now);
  assert.throws(() => database.prepare(
    "UPDATE compliance_case_evidence SET object_key = 'changed' WHERE id = 'evidence'",
  ).run(), /ORIGINAL_IMMUTABLE/);
  assert.throws(() => database.prepare(
    "DELETE FROM compliance_case_evidence WHERE id = 'evidence'",
  ).run(), /NO_DELETE/);

  database.prepare(`INSERT INTO compliance_audit_events
    (id, organisation_id, actor_type, actor_uid, event_type, target_type,
     target_id, summary, metadata, created_at)
    VALUES ('audit', 'org_creditex_au', 'compliance', 'reviewer-1', 'review',
      'case', 'case', 'Reviewed evidence.', '{}', ?)`).run(now);
  assert.throws(() => database.prepare(
    "UPDATE compliance_audit_events SET summary = 'Changed' WHERE id = 'audit'",
  ).run(), /IMMUTABLE/);
  assert.throws(() => database.prepare(
    "DELETE FROM compliance_audit_events WHERE id = 'audit'",
  ).run(), /IMMUTABLE/);

  assert.throws(() => database.prepare(`INSERT INTO compliance_case_decisions
    (id, organisation_id, case_id, case_revision, decision_type, outcome, basis_snapshot,
     primary_reviewer_uid, secondary_reviewer_uid, decided_at, created_at)
    VALUES ('decision-bad', 'org_creditex_au', 'case', 1, 'eligibility', 'approved',
      '{}', 'reviewer-1', 'reviewer-1', ?, ?)`).run(now, now), /check constraint/i);
  database.prepare(`INSERT INTO compliance_case_decisions
    (id, organisation_id, case_id, case_revision, decision_type, outcome, basis_snapshot,
     primary_reviewer_uid, secondary_reviewer_uid, decided_at, created_at)
    VALUES ('decision', 'org_creditex_au', 'case', 1, 'eligibility', 'approved',
      '{}', 'reviewer-1', 'reviewer-2', ?, ?)`).run(now, now);
  assert.throws(() => database.prepare(
    "UPDATE compliance_case_decisions SET outcome = 'withdrawn' WHERE id = 'decision'",
  ).run(), /IMMUTABLE/);

  database.prepare(`INSERT INTO compliance_calculation_runs
    (id, organisation_id, case_id, case_revision, calculator_version_id, input_snapshot,
     output_snapshot, status, blocked_reason, run_by_uid, run_at, created_at)
    VALUES ('run', 'org_creditex_au', 'case', 1, 'calculator', '{}', '{}',
      'blocked', 'Calculator is not approved.', 'reviewer-1', ?, ?)`).run(now, now);
  assert.throws(() => database.prepare(
    "UPDATE compliance_calculation_runs SET status = 'calculated' WHERE id = 'run'",
  ).run(), /IMMUTABLE/);

  database.prepare(`INSERT INTO compliance_submission_artifacts
    (id, organisation_id, batch_id, artifact_type, object_key, file_name,
     content_type, size_bytes, sha256, created_by_uid, created_at)
    VALUES ('artifact', 'org_creditex_au', 'batch', 'export_json',
      'private/batch', 'batch.json', 'application/json', 100, ?,
      'reviewer-1', ?)`).run("d".repeat(64), now);
  assert.throws(() => database.prepare(
    "DELETE FROM compliance_submission_artifacts WHERE id = 'artifact'",
  ).run(), /IMMUTABLE/);
});

test("cases pin a source-matched evidence policy snapshot exactly once", () => {
  const database = databaseWithComplianceOperations();
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  const tamperedSnapshot = JSON.parse(activitySnapshot(governed));
  tamperedSnapshot.evidencePolicyVersion = 99;
  assert.throws(() => seedGovernedCase(database, governed, {
    caseId: "tampered-case",
    caseNumber: "CREDITEX-TAMPERED",
    snapshot: JSON.stringify(tamperedSnapshot),
  }), /COMPLIANCE_CASE_EVIDENCE_POLICY_INVALID/);
  seedGovernedCase(database, governed);
  const pinned = database.prepare(`SELECT evidence_policy_version_id
    FROM compliance_cases WHERE id = 'case'`).get();
  assert.equal(pinned.evidence_policy_version_id, governed.policyVersionId);
  assert.throws(() => database.prepare(`UPDATE compliance_cases
    SET evidence_policy_version_id = '' WHERE id = 'case'`).run(),
  /COMPLIANCE_CASE_EVIDENCE_POLICY_IMMUTABLE/);
});

test("decision requests, decisions, calculations, and staging are bound to the current case revision", () => {
  const database = databaseWithComplianceOperations();
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedGovernedCase(database, governed);
  seedComplianceUser(database, {
    id: "primary-member",
    firebaseUid: "reviewer-1",
    role: "reviewer",
  });
  seedComplianceUser(database, {
    id: "secondary-member",
    firebaseUid: "reviewer-2",
    role: "reviewer",
  });
  seedCalculator(database, governed);
  seedSubmissionBatch(database, governed);

  assert.throws(() => database.prepare(`INSERT INTO compliance_decision_requests
    (id, organisation_id, case_id, case_revision, decision_type, outcome,
     basis_snapshot, status, primary_reviewer_uid, created_at, updated_at)
    VALUES ('stale-request', 'org_creditex_au', 'case', 2, 'eligibility',
      'approved', '{}', 'pending', 'reviewer-1', ?, ?)`)
    .run(TEST_NOW, TEST_NOW), /COMPLIANCE_DECISION_REQUEST_LINK_INVALID/);
  database.prepare(`INSERT INTO compliance_decision_requests
    (id, organisation_id, case_id, case_revision, decision_type, outcome,
     basis_snapshot, status, primary_reviewer_uid, created_at, updated_at)
    VALUES ('request', 'org_creditex_au', 'case', 1, 'eligibility',
      'approved', '{}', 'pending', 'reviewer-1', ?, ?)`)
    .run(TEST_NOW, TEST_NOW);
  assert.throws(() => database.prepare(`UPDATE compliance_decision_requests
    SET case_revision = 2 WHERE id = 'request'`).run(), /ORIGINAL_IMMUTABLE/);

  assert.throws(() => database.prepare(`INSERT INTO compliance_case_decisions
    (id, organisation_id, case_id, case_revision, decision_type, outcome,
     basis_snapshot, primary_reviewer_uid, secondary_reviewer_uid,
     decided_at, created_at)
    VALUES ('stale-decision', 'org_creditex_au', 'case', 2,
      'ready_to_submit', 'approved', '{}', 'reviewer-1', 'reviewer-2', ?, ?)`)
    .run(TEST_NOW, TEST_NOW), /COMPLIANCE_DECISION_LINK_INVALID/);
  database.prepare(`INSERT INTO compliance_case_decisions
    (id, organisation_id, case_id, case_revision, decision_type, outcome,
     basis_snapshot, primary_reviewer_uid, secondary_reviewer_uid,
     decided_at, created_at)
    VALUES ('ready-decision', 'org_creditex_au', 'case', 1,
      'ready_to_submit', 'approved', '{}', 'reviewer-1', 'reviewer-2', ?, ?)`)
    .run(TEST_NOW, TEST_NOW);

  assert.throws(() => database.prepare(`INSERT INTO compliance_calculation_runs
    (id, organisation_id, case_id, case_revision, calculator_version_id,
     input_snapshot, output_snapshot, status, blocked_reason, run_by_uid,
     run_at, created_at)
    VALUES ('stale-run', 'org_creditex_au', 'case', 2, 'calculator',
      '{}', '{}', 'blocked', 'test', 'reviewer-1', ?, ?)`)
    .run(TEST_NOW, TEST_NOW), /COMPLIANCE_CALCULATION_RUN_LINK_INVALID/);
  database.prepare(`INSERT INTO compliance_calculation_runs
    (id, organisation_id, case_id, case_revision, calculator_version_id,
     input_snapshot, output_snapshot, status, blocked_reason, run_by_uid,
     run_at, created_at)
    VALUES ('run', 'org_creditex_au', 'case', 1, 'calculator',
      '{}', '{}', 'blocked', 'test', 'reviewer-1', ?, ?)`)
    .run(TEST_NOW, TEST_NOW);

  database.prepare(`INSERT INTO compliance_case_decisions
    (id, organisation_id, case_id, case_revision, decision_type, outcome,
     basis_snapshot, primary_reviewer_uid, decided_at, created_at)
    VALUES ('withdrawn-decision', 'org_creditex_au', 'case', 1,
      'ready_to_submit', 'withdrawn', '{}', 'reviewer-1',
      '2026-08-01T00:00:01.000Z', '2026-08-01T00:00:01.000Z')`).run();
  assert.throws(() => database.prepare(`INSERT INTO compliance_submission_batch_items
    (id, organisation_id, batch_id, case_id, case_revision, status,
     created_by_uid, created_at, updated_at)
    VALUES ('withdrawn-item', 'org_creditex_au', 'batch', 'case', 1, 'staged',
      'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW),
  /COMPLIANCE_SUBMISSION_ITEM_LINK_INVALID/);

  database.prepare("UPDATE compliance_cases SET revision = 2 WHERE id = 'case'").run();
  assert.throws(() => database.prepare(`UPDATE compliance_decision_requests
    SET status = 'approved', secondary_reviewer_uid = 'reviewer-2',
      reviewed_at = ?, updated_at = ? WHERE id = 'request'`)
    .run(TEST_NOW, TEST_NOW), /COMPLIANCE_DECISION_REQUEST_REVIEWER_INVALID/);
  assert.throws(() => database.prepare(`INSERT INTO compliance_submission_batch_items
    (id, organisation_id, batch_id, case_id, case_revision, status,
     created_by_uid, created_at, updated_at)
    VALUES ('stale-item', 'org_creditex_au', 'batch', 'case', 1, 'staged',
      'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW),
  /COMPLIANCE_SUBMISSION_ITEM_LINK_INVALID/);
  assert.throws(() => database.prepare(`INSERT INTO compliance_submission_batch_items
    (id, organisation_id, batch_id, case_id, case_revision, status,
     created_by_uid, created_at, updated_at)
    VALUES ('unapproved-item', 'org_creditex_au', 'batch', 'case', 2, 'staged',
      'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW),
  /COMPLIANCE_SUBMISSION_ITEM_LINK_INVALID/);
});

test("mobile finalisation guards prove each session step exactly once and preserve referenced media", () => {
  const database = databaseWithComplianceOperations();
  database.prepare(`INSERT INTO trade_mobile_upload_sessions (id, owner_uid)
    VALUES ('session', 'installer-uid')`).run();
  database.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
    (id, owner_uid, session_id, step_number, verified, created_at)
    VALUES ('guard', 'installer-uid', 'session', 1, 1, ?)`).run(TEST_NOW);
  assert.throws(() => database.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
    (id, owner_uid, session_id, step_number, verified, created_at)
    VALUES ('unverified', 'installer-uid', 'session', 2, 0, ?)`)
    .run(TEST_NOW), /check constraint/i);
  assert.throws(() => database.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
    (id, owner_uid, session_id, step_number, verified, created_at)
    VALUES ('wrong-owner', 'other-installer', 'session', 2, 1, ?)`)
    .run(TEST_NOW), /TRADE_MOBILE_FINALISATION_SESSION_INVALID/);
  assert.throws(() => database.prepare(`INSERT INTO trade_mobile_upload_finalisation_guards
    (id, owner_uid, session_id, step_number, verified, created_at)
    VALUES ('duplicate-step', 'installer-uid', 'session', 1, 1, ?)`)
    .run(TEST_NOW), /unique constraint/i);
  assert.throws(() => database.prepare(`UPDATE trade_mobile_upload_finalisation_guards
    SET verified = 1 WHERE id = 'guard'`).run(), /IMMUTABLE/);
  assert.throws(() => database.prepare(`DELETE FROM trade_mobile_upload_finalisation_guards
    WHERE id = 'guard'`).run(), /IMMUTABLE/);

  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedGovernedCase(database, governed);
  database.prepare(`INSERT INTO trade_crm_job_media
    (id, work_order_id, firebase_uid)
    VALUES ('media', 'job', 'installer-uid')`).run();
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, job_media_id, source_type,
     status, object_key, file_name, content_type, size_bytes, original_sha256,
     evidence_envelope, received_by_type, received_by_uid, received_at,
     created_at, updated_at)
    VALUES ('media-evidence', 'org_creditex_au', 'case', 'requirement', 'media',
      'field_app', 'received', 'private/media', 'photo.jpg', 'image/jpeg', 100,
      ?, '{}', 'installer', 'installer-uid', ?, ?, ?)`)
    .run(TEST_HASH, TEST_NOW, TEST_NOW, TEST_NOW);
  assert.throws(() => database.prepare(
    "DELETE FROM trade_crm_job_media WHERE id = 'media'",
  ).run(), /COMPLIANCE_EVIDENCE_MEDIA_NO_DELETE/);
});

test("certificate lots, trades, and settlements cannot be rewritten or reactivated", () => {
  const database = databaseWithComplianceOperations();
  const governed = seedGovernedActivity(database);
  database.prepare(`INSERT INTO compliance_certificate_lots
    (id, organisation_id, program_id, certificate_type, quantity, status,
     created_by_uid, created_at, updated_at)
    VALUES ('lot', 'org_creditex_au', ?, 'TEST', 10, 'pending',
      'reviewer-1', ?, ?)`).run(governed.programId, TEST_NOW, TEST_NOW);
  database.prepare("UPDATE compliance_certificate_lots SET status = 'available' WHERE id = 'lot'").run();
  assert.throws(() => database.prepare(
    "UPDATE compliance_certificate_lots SET quantity = 1 WHERE id = 'lot'",
  ).run(), /ORIGINAL_IMMUTABLE/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_certificate_lots SET organisation_id = 'other-org' WHERE id = 'lot'",
  ).run(), /ORIGINAL_IMMUTABLE/);

  database.prepare(`INSERT INTO compliance_trades
    (id, organisation_id, certificate_lot_id, counterparty_reference, quantity,
     unit_price_cents, trade_date, status, created_by_uid, created_at, updated_at)
    VALUES ('trade-1', 'org_creditex_au', 'lot', 'buyer-1', 8, 100,
      '2026-08-01', 'pending', 'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW);
  database.prepare("UPDATE compliance_trades SET status = 'cancelled' WHERE id = 'trade-1'").run();
  database.prepare(`INSERT INTO compliance_trades
    (id, organisation_id, certificate_lot_id, counterparty_reference, quantity,
     unit_price_cents, trade_date, status, created_by_uid, created_at, updated_at)
    VALUES ('trade-2', 'org_creditex_au', 'lot', 'buyer-2', 5, 100,
      '2026-08-01', 'pending', 'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW);
  database.prepare(`UPDATE compliance_trades
    SET external_reference = 'registry-trade-2' WHERE id = 'trade-2'`).run();
  assert.throws(() => database.prepare(`UPDATE compliance_trades
    SET external_reference = 'rewritten-trade' WHERE id = 'trade-2'`).run(),
  /COMPLIANCE_TRADE_REFERENCE_IMMUTABLE/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_trades SET status = 'pending' WHERE id = 'trade-1'",
  ).run(), /COMPLIANCE_TRADE_TRANSITION_INVALID/);
  assert.equal(database.prepare(`SELECT SUM(quantity) quantity
    FROM compliance_trades WHERE certificate_lot_id = 'lot'
      AND status IN ('pending', 'confirmed', 'settled')`).get().quantity, 5);

  database.prepare("UPDATE compliance_trades SET status = 'confirmed' WHERE id = 'trade-2'").run();
  database.prepare(`INSERT INTO compliance_settlements
    (id, organisation_id, trade_id, gross_cents, fee_cents, net_cents, due_date,
     status, created_by_uid, created_at, updated_at)
    VALUES ('settlement', 'org_creditex_au', 'trade-2', 500, 50, 450,
      '2026-08-15', 'pending', 'reviewer-1', ?, ?)`).run(TEST_NOW, TEST_NOW);
  database.prepare(`UPDATE compliance_settlements
    SET external_reference = 'registry-settlement' WHERE id = 'settlement'`).run();
  assert.throws(() => database.prepare(`UPDATE compliance_settlements
    SET external_reference = 'rewritten-settlement' WHERE id = 'settlement'`).run(),
  /COMPLIANCE_SETTLEMENT_REFERENCE_IMMUTABLE/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_trades SET status = 'cancelled' WHERE id = 'trade-2'",
  ).run(), /COMPLIANCE_TRADE_SETTLEMENT_STATE_INVALID/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_settlements SET gross_cents = 1, net_cents = 0 WHERE id = 'settlement'",
  ).run(), /ORIGINAL_IMMUTABLE/);
  database.prepare(`UPDATE compliance_settlements
    SET status = 'settled', settled_at = ? WHERE id = 'settlement'`).run(TEST_NOW);
  database.prepare("UPDATE compliance_trades SET status = 'settled' WHERE id = 'trade-2'").run();
  assert.throws(() => database.prepare(
    "UPDATE compliance_settlements SET status = 'cancelled', settled_at = '' WHERE id = 'settlement'",
  ).run(), /COMPLIANCE_SETTLEMENT_TRANSITION_INVALID/);
  assert.throws(() => database.prepare(
    "UPDATE compliance_certificate_lots SET status = 'retired' WHERE id = 'lot'",
  ).run(), /COMPLIANCE_CERTIFICATE_LOT_HAS_ACTIVE_TRADES/);
});

test("compliance member identity is immutable while reviewed access and last-login changes remain supported", () => {
  const database = databaseWithComplianceOperations();
  seedComplianceUser(database, {
    id: "member",
    firebaseUid: "member-uid",
    role: "reviewer",
  });
  database.prepare(`UPDATE compliance_users
    SET role = 'auditor', status = 'suspended', last_login_at = ?,
      updated_at = ? WHERE id = 'member'`).run(TEST_NOW, TEST_NOW);
  const changed = database.prepare(`SELECT role, status, last_login_at
    FROM compliance_users WHERE id = 'member'`).get();
  assert.deepEqual({ ...changed }, {
    role: "auditor",
    status: "suspended",
    last_login_at: TEST_NOW,
  });
  assert.throws(() => database.prepare(
    "UPDATE compliance_users SET email = 'changed@example.com' WHERE id = 'member'",
  ).run(), /IDENTITY_IMMUTABLE/);
  database.prepare("UPDATE compliance_users SET status = 'revoked' WHERE id = 'member'").run();
  assert.throws(() => database.prepare(
    "UPDATE compliance_users SET status = 'active' WHERE id = 'member'",
  ).run(), /STATUS_TRANSITION_INVALID/);
  assert.throws(() => database.prepare(
    "DELETE FROM compliance_users WHERE id = 'member'",
  ).run(), /NO_DELETE/);
});

test("operations child records reject missing or cross-organisation parents at insert time", () => {
  const database = databaseWithComplianceOperations();
  const governed = seedGovernedActivity(database);
  seedTradeJob(database);
  seedGovernedCase(database, governed);
  seedComplianceUser(database, {
    id: "main-reviewer",
    firebaseUid: "main-reviewer",
    role: "reviewer",
  });

  seedOrganisation(database, {
    id: "org_other",
    code: "OTHER-AU",
    legalName: "Other Compliance Pty Ltd",
    tradingName: "Other Compliance",
  });
  const other = seedGovernedActivity(database, {
    organisationId: "org_other",
    programId: "program-other",
    activityVersionId: "activity-other",
    policyVersionId: "policy-other",
    requirementId: "requirement-other",
    key: "other",
  });
  seedTradeJob(database, {
    workOrderId: "job-other",
    installerUid: "installer-other",
    key: "other",
  });
  seedGovernedCase(database, other, {
    caseId: "case-other",
    caseNumber: "OTHER-CASE",
    workOrderId: "job-other",
    installerUid: "installer-other",
  });
  seedComplianceUser(database, {
    id: "other-reviewer",
    firebaseUid: "other-reviewer",
    role: "reviewer",
    organisationId: "org_other",
  });
  database.prepare(`INSERT INTO compliance_participants
    (id, organisation_id, participant_type, legal_name, status, created_by_uid,
     created_at, updated_at)
    VALUES ('participant-other', 'org_other', 'installer', 'Other Installer',
      'active', 'other-reviewer', ?, ?)`).run(TEST_NOW, TEST_NOW);
  seedCalculator(database, other, {
    calculatorId: "calculator-other",
    key: "other-calculator",
  });
  seedSubmissionBatch(database, other, {
    batchId: "batch-other",
    batchNumber: "OTHER-BATCH",
  });
  database.prepare(`INSERT INTO compliance_certificate_lots
    (id, organisation_id, program_id, certificate_type, quantity, status,
     created_by_uid, created_at, updated_at)
    VALUES ('lot-other', 'org_other', 'program-other', 'TEST', 5, 'pending',
      'other-reviewer', ?, ?)`).run(TEST_NOW, TEST_NOW);
  database.prepare(`UPDATE compliance_certificate_lots
    SET status = 'available' WHERE id = 'lot-other'`).run();
  database.prepare(`INSERT INTO compliance_trades
    (id, organisation_id, certificate_lot_id, counterparty_reference, quantity,
     unit_price_cents, trade_date, status, created_by_uid, created_at, updated_at)
    VALUES ('trade-other', 'org_other', 'lot-other', 'buyer', 1, 100,
      '2026-08-01', 'pending', 'other-reviewer', ?, ?)`).run(TEST_NOW, TEST_NOW);

  const invalidWrites = [
    {
      pattern: /COMPLIANCE_INVITATION_ORGANISATION_INVALID/,
      sql: `INSERT INTO compliance_invitations
        (id, organisation_id, email, role, status, invited_by_uid, expires_at,
         created_at, updated_at)
        VALUES ('bad-invite', 'missing-org', 'person@example.com', 'reviewer',
          'pending', 'main-reviewer', '2026-08-31T00:00:00.000Z', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_AUDIT_ORGANISATION_INVALID/,
      sql: `INSERT INTO compliance_audit_events
        (id, organisation_id, actor_type, actor_uid, event_type, target_type,
         target_id, summary, created_at)
        VALUES ('bad-audit', 'missing-org', 'compliance', 'main-reviewer',
          'test', 'case', 'case', 'test', ?)`,
      values: [TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_WRITE_GUARD_ORGANISATION_INVALID/,
      sql: `INSERT INTO compliance_write_guards
        (id, organisation_id, operation_id, step_number, verified, created_at)
        VALUES ('bad-write-guard', 'missing-org', 'bad-operation', 1, 1, ?)`,
      values: [TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_USER_ORGANISATION_INVALID/,
      sql: `INSERT INTO compliance_users
        (id, organisation_id, firebase_uid, email, role, status, created_by_uid,
         created_at, updated_at)
        VALUES ('bad-user', 'missing-org', 'bad-user', 'bad-user@example.com',
          'reviewer', 'active', 'test', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_EVIDENCE_POLICY_ACTIVITY_INVALID/,
      sql: `INSERT INTO compliance_evidence_policy_versions
        (id, organisation_id, activity_version_id, version, title,
         official_source_url, official_source_title, official_source_version,
         official_source_sha256, official_source_checked_at,
         requirements_complete, publish_state, created_by_uid, created_at,
         updated_at)
        VALUES ('bad-policy', 'org_creditex_au', 'activity-other', 2, 'Bad',
          'https://regulator.example', 'Rule', '2', ?, ?, 0, 'draft',
          'main-reviewer', ?, ?)`,
      values: [TEST_HASH, TEST_NOW, TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_EVIDENCE_REQUIREMENT_POLICY_INVALID/,
      sql: `INSERT INTO compliance_evidence_requirements
        (id, organisation_id, policy_version_id, requirement_code, title,
         evidence_type, capture_timing, source_citation, created_by_uid,
         created_at, updated_at)
        VALUES ('bad-requirement', 'org_creditex_au', 'policy-other', 'BAD',
          'Bad', 'photo', 'any', 'Rule', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_PARTICIPANT_ORGANISATION_INVALID/,
      sql: `INSERT INTO compliance_participants
        (id, organisation_id, participant_type, legal_name, created_by_uid,
         created_at, updated_at)
        VALUES ('bad-participant', 'missing-org', 'installer', 'Bad',
          'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_PARTICIPANT_ABILITY_LINK_INVALID/,
      sql: `INSERT INTO compliance_participant_abilities
        (id, organisation_id, participant_id, ability_code, ability_role,
         effective_from, created_by_uid, created_at, updated_at)
        VALUES ('bad-ability', 'org_creditex_au', 'participant-other',
          'INSTALL', 'installer', '2026-01-01', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_ASSIGNMENT_LINK_INVALID/,
      sql: `INSERT INTO compliance_case_assignments
        (id, organisation_id, case_id, compliance_user_id, assignment_role,
         status, assigned_by_uid, assigned_at)
        VALUES ('bad-assignment', 'org_creditex_au', 'case-other',
          'main-reviewer', 'primary_reviewer', 'assigned', 'main-reviewer', ?)`,
      values: [TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_TASK_LINK_INVALID/,
      sql: `INSERT INTO compliance_case_tasks
        (id, organisation_id, case_id, task_type, title, status, created_by_uid,
         created_at, updated_at)
        VALUES ('bad-task', 'org_creditex_au', 'case-other', 'review', 'Bad',
          'open', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_EVIDENCE_LINK_INVALID/,
      sql: `INSERT INTO compliance_case_evidence
        (id, organisation_id, case_id, requirement_id, source_type, status,
         object_key, file_name, content_type, size_bytes, original_sha256,
         evidence_envelope, received_by_type, received_by_uid, received_at,
         created_at, updated_at)
        VALUES ('bad-evidence', 'org_creditex_au', 'case-other',
          'requirement-other', 'field_app', 'received', 'private/bad',
          'bad.jpg', 'image/jpeg', 1, ?, '{}', 'installer', 'installer-other',
          ?, ?, ?)`,
      values: [TEST_HASH, TEST_NOW, TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_FINDING_LINK_INVALID/,
      sql: `INSERT INTO compliance_case_findings
        (id, organisation_id, case_id, finding_code, severity, description,
         status, raised_by_uid, raised_at, created_at, updated_at)
        VALUES ('bad-finding', 'org_creditex_au', 'case-other', 'BAD', 'major',
          'Bad', 'open', 'main-reviewer', ?, ?, ?)`,
      values: [TEST_NOW, TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_DECISION_LINK_INVALID/,
      sql: `INSERT INTO compliance_case_decisions
        (id, organisation_id, case_id, case_revision, decision_type, outcome,
         basis_snapshot, primary_reviewer_uid, decided_at, created_at)
        VALUES ('bad-decision', 'org_creditex_au', 'case-other', 1,
          'evidence_complete', 'rejected', '{}', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_DECISION_REQUEST_LINK_INVALID/,
      sql: `INSERT INTO compliance_decision_requests
        (id, organisation_id, case_id, case_revision, decision_type, outcome,
         basis_snapshot, status, primary_reviewer_uid, created_at, updated_at)
        VALUES ('bad-request', 'org_creditex_au', 'case-other', 1,
          'eligibility', 'approved', '{}', 'pending', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_EQUIPMENT_CASE_INVALID/,
      sql: `INSERT INTO compliance_equipment_records
        (id, organisation_id, case_id, record_type, quantity, status,
         recorded_by_uid, recorded_at, created_at, updated_at)
        VALUES ('bad-equipment', 'org_creditex_au', 'case-other', 'installed',
          1, 'installed', 'main-reviewer', ?, ?, ?)`,
      values: [TEST_NOW, TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_CALCULATOR_ACTIVITY_INVALID/,
      sql: `INSERT INTO compliance_calculator_versions
        (id, organisation_id, activity_version_id, calculator_key, version,
         title, output_type, specification, rounding_policy,
         official_source_url, official_source_version, official_source_sha256,
         approval_state, created_by_uid, created_at, updated_at)
        VALUES ('bad-calculator', 'org_creditex_au', 'activity-other', 'bad', 2,
          'Bad', 'STC', '{}', 'none', 'https://regulator.example', '2', ?,
          'draft', 'main-reviewer', ?, ?)`,
      values: [TEST_HASH, TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_CALCULATOR_VECTOR_PARENT_INVALID/,
      sql: `INSERT INTO compliance_calculator_test_vectors
        (id, calculator_version_id, vector_key, input_snapshot, expected_output,
         source_citation, created_by_uid, created_at, updated_at)
        VALUES ('bad-vector', 'missing-calculator', 'bad', '{}', '{}', 'Rule',
          'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_CALCULATION_RUN_LINK_INVALID/,
      sql: `INSERT INTO compliance_calculation_runs
        (id, organisation_id, case_id, case_revision, calculator_version_id,
         input_snapshot, output_snapshot, status, run_by_uid, run_at, created_at)
        VALUES ('bad-run', 'org_creditex_au', 'case', 1, 'calculator-other',
          '{}', '{}', 'blocked', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_SUBMISSION_BATCH_PROGRAM_INVALID/,
      sql: `INSERT INTO compliance_submission_batches
        (id, organisation_id, program_id, batch_number, format, status,
         created_by_uid, created_at, updated_at)
        VALUES ('bad-batch', 'org_creditex_au', 'program-other', 'BAD', 'json',
          'draft', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_SUBMISSION_ITEM_LINK_INVALID/,
      sql: `INSERT INTO compliance_submission_batch_items
        (id, organisation_id, batch_id, case_id, case_revision, status,
         created_by_uid, created_at, updated_at)
        VALUES ('bad-item', 'org_creditex_au', 'batch-other', 'case', 1,
          'staged', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_SUBMISSION_ARTIFACT_BATCH_INVALID/,
      sql: `INSERT INTO compliance_submission_artifacts
        (id, organisation_id, batch_id, artifact_type, object_key, file_name,
         content_type, size_bytes, sha256, created_by_uid, created_at)
        VALUES ('bad-artifact', 'org_creditex_au', 'batch-other', 'export_json',
          'private/bad', 'bad.json', 'application/json', 1, ?, 'main-reviewer',
          ?)`,
      values: [TEST_HASH, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_SUBMISSION_RESPONSE_LINK_INVALID/,
      sql: `INSERT INTO compliance_submission_responses
        (id, organisation_id, batch_id, response_type, message,
         recorded_by_uid, created_at, occurred_at)
        VALUES ('bad-response', 'org_creditex_au', 'batch-other', 'error',
          'Bad', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_CERTIFICATE_LOT_LINK_INVALID/,
      sql: `INSERT INTO compliance_certificate_lots
        (id, organisation_id, program_id, certificate_type, quantity, status,
         created_by_uid, created_at, updated_at)
        VALUES ('bad-lot', 'org_creditex_au', 'program-other', 'TEST', 1,
          'pending', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_TRADE_QUANTITY_INVALID/,
      sql: `INSERT INTO compliance_trades
        (id, organisation_id, certificate_lot_id, counterparty_reference,
         quantity, unit_price_cents, trade_date, status, created_by_uid,
         created_at, updated_at)
        VALUES ('bad-trade', 'org_creditex_au', 'lot-other', 'buyer', 1, 100,
          '2026-08-01', 'pending', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
    {
      pattern: /COMPLIANCE_SETTLEMENT_TRADE_INVALID/,
      sql: `INSERT INTO compliance_settlements
        (id, organisation_id, trade_id, gross_cents, fee_cents, net_cents,
         due_date, status, created_by_uid, created_at, updated_at)
        VALUES ('bad-settlement', 'org_creditex_au', 'trade-other', 100, 0,
          100, '2026-08-15', 'pending', 'main-reviewer', ?, ?)`,
      values: [TEST_NOW, TEST_NOW],
    },
  ];
  for (const { sql, values, pattern } of invalidWrites) {
    assert.throws(() => database.prepare(sql).run(...values), pattern);
  }
});

test("field upload and sync source close the evidence custody contract", () => {
  assert.match(mediaRoute, /validateEvidenceContract/);
  assert.match(mediaRoute, /bucket\(\)\.get\(session\.object_key\)/);
  assert.match(mediaRoute, /EVIDENCE_HASH_MISMATCH/);
  assert.match(mediaRoute, /original_sha256_mismatch/);
  assert.match(mediaRoute, /INSERT INTO compliance_case_evidence/);
  assert.doesNotMatch(mediaRoute, /INSERT OR IGNORE INTO compliance_case_evidence/);
  assert.match(mediaRoute, /trade_mobile_upload_finalisation_guards/);
  assert.match(mediaRoute, /FINALISATION_VERIFIED_STEP/);
  assert.match(mediaRoute, /'installer', \?, \?, '', '', '', 0/);
  assert.match(mediaRoute, /access\.actorUid/);
  assert.doesNotMatch(mediaRoute, /received_by_uid[^]*envelope\.(?:actor|user)/);
  assert.match(syncRoute, /compliance_evidence_policy_versions/);
  assert.match(syncRoute, /evidencePolicyVersionId/);
  assert.match(syncRoute, /originalRequired/);
  assert.match(syncRoute, /gpsRequired/);
});
