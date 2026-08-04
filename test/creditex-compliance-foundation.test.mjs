import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import {
  CREDITEX_FOUNDATION_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0093_creditex_compliance_foundation.sql");
const schema = read("../db/schema.ts");

class MockCreditexSourceLookupReviewError extends Error {}

const approvedSourceReviewMock = {
  CreditexSourceLookupReviewError: MockCreditexSourceLookupReviewError,
  requireCurrentApprovedOfficialSourceBinding: async () => "test-binding",
};

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
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: result.lastInsertRowid },
    };
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
  const source = read(path);
  const output = ts.transpileModule(source, {
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
  const execute = new Function("require", "module", "exports", output);
  execute(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function applyFoundation(database) {
  database.exec(`CREATE TABLE trade_work_orders (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    work_number text NOT NULL,
    service_category text NOT NULL,
    scheduled_start text DEFAULT '' NOT NULL
  );
  CREATE TABLE trade_crm_service_sites (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    address_state text DEFAULT '' NOT NULL
  );
  CREATE TABLE trade_crm_job_details (
    id text PRIMARY KEY NOT NULL,
    work_order_id text NOT NULL,
    firebase_uid text NOT NULL,
    service_site_id text DEFAULT '' NOT NULL
  )`);
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    database.exec(statement);
  }
  for (const definition of CREDITEX_FOUNDATION_SCHEMA_GUARD_DEFINITIONS) {
    database.exec(definition.sql);
  }
}

function applyEvidencePolicyFixtureSchema(database) {
  database.exec(`
    ALTER TABLE compliance_programs
      ADD publication_request_id text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_programs
      ADD publication_snapshot_sha256 text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_activity_versions
      ADD publication_request_id text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_activity_versions
      ADD publication_snapshot_sha256 text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_cases
      ADD evidence_policy_version_id text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_cases
      ADD commercial_handoff_id text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_cases
      ADD accepted_quote_version_id text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_cases
      ADD accepted_scope_sha256 text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_cases
      ADD compliance_intent_id text DEFAULT '' NOT NULL;
    CREATE TABLE compliance_evidence_policy_versions (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      activity_version_id text NOT NULL,
      version integer NOT NULL,
      official_source_title text NOT NULL,
      official_source_version text NOT NULL,
      official_source_sha256 text NOT NULL,
      requirements_complete integer NOT NULL,
      publish_state text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL
    );
    CREATE TABLE compliance_governance_requests (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      action text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_work_order_compliance_intents (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      compliance_organisation_id text NOT NULL,
      status text NOT NULL,
      service_category text NOT NULL,
      program_code text NOT NULL,
      planned_start text NOT NULL,
      site_jurisdiction text NOT NULL,
      registry_activity_code text NOT NULL,
      intent_snapshot text NOT NULL
    );
  `);
}

function insertPublishedEvidencePolicy(
  database,
  activityVersionId,
  organisationId = "creditex-org",
) {
  const policyId = `policy-${activityVersionId}`;
  database.prepare(`INSERT INTO compliance_evidence_policy_versions (
      id, organisation_id, activity_version_id, version,
      official_source_title, official_source_version,
      official_source_sha256, requirements_complete, publish_state
    ) VALUES (?, ?, ?, 1, 'Creditex approved evidence policy',
      '2026-08-01', ?, 1, 'published')`)
    .run(policyId, organisationId, activityVersionId, "d".repeat(64));
  database.prepare(`INSERT INTO compliance_evidence_requirements (
      id, organisation_id, policy_version_id
    ) VALUES (?, ?, ?)`)
    .run(`requirement-${activityVersionId}`, organisationId, policyId);
  return policyId;
}

function insertOrganisation(database, {
  id = "creditex-org",
  code = "creditex",
  status = "active",
} = {}) {
  database.prepare(`INSERT INTO compliance_organisations
    (id, organisation_code, legal_name, trading_name, abn, status,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, 'Creditex Pty Ltd', 'Creditex', '', ?, 'platform-owner',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`)
    .run(id, code, status);
}

const sourceInput = {
  officialSourceUrl: "https://www.esc.vic.gov.au/veu",
  officialSourceTitle: "Victorian Energy Upgrades",
  officialSourceVersion: "2026-07-01",
  officialSourceSha256: "a".repeat(64),
  officialSourceCheckedAt: "2026-08-01T00:00:00.000Z",
};

test("0093 creates a separate constrained compliance domain without production seed data", () => {
  const database = new DatabaseSync(":memory:");
  applyFoundation(database);

  const tables = new Set(database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name));
  for (const table of [
    "compliance_organisations",
    "compliance_users",
    "compliance_programs",
    "compliance_activity_versions",
    "compliance_cases",
    "compliance_case_events",
  ]) {
    assert.ok(tables.has(table), `${table} should exist`);
    assert.equal(
      database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,
      0,
      `${table} should not contain production seed data`,
    );
  }
  const caseColumns = new Set(database
    .prepare("PRAGMA table_info(compliance_cases)")
    .all()
    .map((row) => row.name));
  assert.ok(caseColumns.has("activity_date"));
  assert.ok(caseColumns.has("evidence_status"));
  assert.match(schema, /serviceCategory: text\("service_category"\)/);
  assert.match(schema, /officialSourceSha256: text\("official_source_sha256"\)/);

  insertOrganisation(database);
  assert.throws(() => database.prepare(`INSERT INTO compliance_users
    (id, organisation_id, firebase_uid, email, role, status, created_by_uid,
     created_at, updated_at)
    VALUES ('bad-role', 'creditex-org', 'uid', 'uid@example.com', 'support',
      'active', 'owner', 'now', 'now')`).run());
});

test("published programs and activity versions are source-backed, immutable, and date filtered", async () => {
  let sourceApprovalCurrent = true;
  const sourceReviewMock = {
    CreditexSourceLookupReviewError: MockCreditexSourceLookupReviewError,
    requireCurrentApprovedOfficialSourceBinding: async () => {
      if (!sourceApprovalCurrent) {
        throw new MockCreditexSourceLookupReviewError(
          "Current approval was withdrawn.",
        );
      }
      return "test-binding";
    },
  };
  const database = new DatabaseSync(":memory:");
  applyFoundation(database);
  applyEvidencePolicyFixtureSchema(database);
  insertOrganisation(database);
  database.exec(`
    ALTER TABLE compliance_users
      ADD governance_identity_verified integer DEFAULT 0 NOT NULL;
    ALTER TABLE compliance_users
      ADD governance_identity_verified_by_uid text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_users
      ADD governance_identity_verified_at text DEFAULT '' NOT NULL;
    ALTER TABLE compliance_users
      ADD governance_identity_verification_basis text DEFAULT '' NOT NULL;
    INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, email, display_name, role, status,
       governance_identity_verified, governance_identity_verified_by_uid,
       governance_identity_verified_at, governance_identity_verification_basis,
       created_by_uid, created_at, updated_at)
      VALUES
      ('shared-admin', 'creditex-org', 'shared-admin',
        'info@ausenergyassessments.com', 'Shared operations inbox', 'admin',
        'active', 0, '', '', '', 'platform-owner',
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
      ('verified-admin', 'creditex-org', 'creditex-admin',
        'casey.admin@example.com', 'Casey Admin', 'admin', 'active', 1,
        'platform-owner', '2026-08-01T00:00:00.000Z',
        'Identity checked by platform owner', 'platform-owner',
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  `);
  const d1 = testD1(database);
  const domain = loadTypescriptModule(
    "../src/lib/creditex-compliance-server.ts",
    {
      "./creditex-schema-guards": {
        ensureCreditexSchemaGuards: async () => {},
      },
      "./creditex-source-lookup-review-server": sourceReviewMock,
    },
  );
  assert.throws(() => domain.prepareComplianceProgramCreateStatement(d1, {
    id: "invalid-jurisdiction",
    organisationId: "creditex-org",
    programCode: "INVALID",
    name: "Invalid jurisdiction",
    schemeKind: "certificate",
    jurisdiction: "NZ",
    administeringBody: "Example administrator",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...sourceInput,
  }), (error) => error.code === "INVALID_JURISDICTION");
  assert.throws(() => domain.prepareComplianceProgramCreateStatement(d1, {
    id: "oversized-source-hash",
    organisationId: "creditex-org",
    programCode: "OVERSIZED",
    name: "Oversized source hash",
    schemeKind: "certificate",
    jurisdiction: "VIC",
    administeringBody: "Example administrator",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...sourceInput,
    officialSourceSha256: "a".repeat(65),
  }), (error) => error.code === "COMPLIANCE_VALUE_TOO_LONG");

  const unhashedProgram = domain.prepareComplianceProgramCreateStatement(d1, {
    id: "unhashed-program",
    organisationId: "creditex-org",
    programCode: "UNHASHED",
    name: "Unhashed draft",
    schemeKind: "certificate",
    jurisdiction: "VIC",
    administeringBody: "Example administrator",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...sourceInput,
    officialSourceSha256: "",
  });
  await unhashedProgram.statement.run();
  assert.equal((await domain.prepareComplianceProgramPublishStatement(
    d1,
    "creditex-org",
    unhashedProgram.id,
    "creditex-admin",
    "2026-08-01T00:00:30.000Z",
  ).run()).meta.changes, 0);
  assert.equal(
    database.prepare("SELECT publish_state FROM compliance_programs WHERE id = ?").get(unhashedProgram.id).publish_state,
    "draft",
  );
  assert.throws(() => database.prepare(`UPDATE compliance_programs
    SET publish_state = 'published', published_by_uid = 'admin',
      published_at = '2026-08-01T00:00:30.000Z'
    WHERE id = ?`).run(unhashedProgram.id), /source|check constraint/i);
  assert.equal((await domain.prepareComplianceProgramDraftDeleteStatement(
    d1,
    "creditex-org",
    unhashedProgram.id,
  ).run()).meta.changes, 1);

  const program = domain.prepareComplianceProgramCreateStatement(d1, {
    id: "veu-program",
    organisationId: "creditex-org",
    programCode: "VEU",
    name: "Victorian Energy Upgrades",
    schemeKind: "certificate",
    jurisdiction: "VIC",
    administeringBody: "Essential Services Commission",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...sourceInput,
  });
  assert.equal((await program.statement.run()).meta.changes, 1);
  assert.equal((await domain.prepareComplianceProgramPublishStatement(
    d1,
    "creditex-org",
    program.id,
    "creditex-admin",
    "2026-08-01T00:01:00.000Z",
  ).run()).meta.changes, 1);

  const mismatchedActivity = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "mismatched-activity",
    organisationId: "creditex-org",
    programId: program.id,
    activityKey: "mismatched-activity",
    version: 1,
    title: "Mismatched jurisdiction",
    serviceCategory: "hot-water",
    productCategory: "heat-pump-water-heater",
    scenario: "This NSW activity cannot belong to a VIC program.",
    jurisdiction: "NSW",
    effectiveFrom: "2026-01-01",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:01:30.000Z",
    ...sourceInput,
  });
  assert.equal((await mismatchedActivity.statement.run()).meta.changes, 0);
  const rawMismatchSql = mismatchedActivity.statement.sql.replace(
    "AND (program.jurisdiction = 'AU' OR program.jurisdiction = ?)",
    "",
  );
  await assert.rejects(
    new TestD1Statement(
      database,
      rawMismatchSql,
      mismatchedActivity.statement.values.slice(0, -1),
    ).run(),
    /activity jurisdiction must match its program/i,
  );

  const nationalProgram = domain.prepareComplianceProgramCreateStatement(d1, {
    id: "national-program",
    organisationId: "creditex-org",
    programCode: "NATIONAL",
    name: "National draft program",
    schemeKind: "certificate",
    jurisdiction: "AU",
    administeringBody: "Example administrator",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:01:40.000Z",
    ...sourceInput,
  });
  await nationalProgram.statement.run();
  const nationalActivity = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "national-vic-activity",
    organisationId: "creditex-org",
    programId: nationalProgram.id,
    activityKey: "national-vic-activity",
    version: 1,
    title: "Victorian national-program activity",
    serviceCategory: "hot-water",
    productCategory: "heat-pump-water-heater",
    scenario: "A state activity under an Australian program.",
    jurisdiction: "VIC",
    effectiveFrom: "2026-01-01",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:01:50.000Z",
    ...sourceInput,
  });
  assert.equal((await nationalActivity.statement.run()).meta.changes, 1);
  assert.throws(() => database.prepare(
    "UPDATE compliance_programs SET jurisdiction = 'NSW' WHERE id = ?",
  ).run(nationalProgram.id), /program jurisdiction conflicts/i);
  assert.equal((await domain.prepareComplianceProgramDraftDeleteStatement(
    d1,
    "creditex-org",
    nationalProgram.id,
  ).run()).meta.changes, 0);
  assert.throws(() => database.prepare(
    "DELETE FROM compliance_programs WHERE id = ?",
  ).run(nationalProgram.id), /with activity versions cannot be deleted/i);
  assert.equal((await domain.prepareComplianceActivityDraftDeleteStatement(
    d1,
    "creditex-org",
    nationalActivity.id,
  ).run()).meta.changes, 1);
  assert.equal((await domain.prepareComplianceProgramDraftDeleteStatement(
    d1,
    "creditex-org",
    nationalProgram.id,
  ).run()).meta.changes, 1);

  const activity = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "veu-hot-water-v1",
    organisationId: "creditex-org",
    programId: program.id,
    activityKey: "veu-hot-water",
    version: 1,
    title: "Install an eligible heat pump water heater",
    serviceCategory: "hot-water",
    registryActivityCode: "1D",
    specificationPart: "Part 1",
    productCategory: "heat-pump-water-heater",
    scenarioCode: "replace-electric-resistance",
    scenario: "Replace an existing electric resistance water heater.",
    jurisdiction: "VIC",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    requirementsSnapshot: {
      forms: [{ key: "veu-hot-water-installation", version: 1 }],
      photos: [{ code: "installed-unit", required: true }],
    },
    calculationApprovalState: "not_assessed",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:02:00.000Z",
    ...sourceInput,
  });
  assert.equal((await activity.statement.run()).meta.changes, 1);
  assert.equal((await domain.prepareComplianceActivityPublishStatement(
    d1,
    "creditex-org",
    activity.id,
    "creditex-admin",
    "2026-08-01T00:03:00.000Z",
  ).run()).meta.changes, 1);
  insertPublishedEvidencePolicy(database, activity.id);

  const unhashedActivity = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "unhashed-activity",
    organisationId: "creditex-org",
    programId: program.id,
    activityKey: "unhashed-activity",
    version: 1,
    title: "Unhashed activity draft",
    serviceCategory: "hot-water",
    productCategory: "heat-pump-water-heater",
    scenario: "Draft without a source digest.",
    jurisdiction: "VIC",
    effectiveFrom: "2026-01-01",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:03:30.000Z",
    ...sourceInput,
    officialSourceSha256: "",
  });
  await unhashedActivity.statement.run();
  assert.equal((await domain.prepareComplianceActivityPublishStatement(
    d1,
    "creditex-org",
    unhashedActivity.id,
    "creditex-admin",
    "2026-08-01T00:03:45.000Z",
  ).run()).meta.changes, 0);
  assert.throws(() => database.prepare(`UPDATE compliance_activity_versions
    SET publish_state = 'published', published_by_uid = 'admin',
      published_at = '2026-08-01T00:03:45.000Z'
    WHERE id = ?`).run(unhashedActivity.id), /source|check constraint/i);
  assert.equal((await domain.prepareComplianceActivityDraftDeleteStatement(
    d1,
    "creditex-org",
    unhashedActivity.id,
  ).run()).meta.changes, 1);

  const selectable = await domain.listInstallerSelectableActivities(d1, {
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    onDate: "2026-06-15",
  });
  assert.equal(selectable.length, 1);
  assert.equal(selectable[0].organisationId, "creditex-org");
  assert.equal(selectable[0].organisationName, "Creditex");
  assert.equal(selectable[0].activityKey, "veu-hot-water");
  assert.equal(selectable[0].serviceCategory, "hot-water");
  assert.equal(selectable[0].requirementsSnapshot.photos[0].code, "installed-unit");
  sourceApprovalCurrent = false;
  assert.equal((await domain.listInstallerSelectableActivities(d1, {
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    onDate: "2026-06-15",
  })).length, 0);
  await assert.rejects(
    domain.resolveLiveComplianceActivity(d1, activity.id, "2026-06-15"),
    (error) => error.code === "CURRENT_SOURCE_APPROVAL_REQUIRED",
  );
  sourceApprovalCurrent = true;
  assert.equal((await domain.listInstallerSelectableActivities(d1, {
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    onDate: "2026-06-15",
    afterActivityId: selectable[0].id,
  })).length, 0);
  await assert.rejects(
    domain.listInstallerSelectableActivities(d1, { onDate: "2026-06-15junk" }),
    (error) => error.code === "COMPLIANCE_VALUE_TOO_LONG",
  );
  assert.equal((await domain.listInstallerSelectableActivities(d1, {
    onDate: "2027-01-01",
  })).length, 0);

  assert.throws(() => database
    .prepare("UPDATE compliance_programs SET name = 'Changed' WHERE id = ?")
    .run(program.id), /immutable/i);
  assert.equal((await domain.prepareComplianceProgramDraftDeleteStatement(
    d1,
    "creditex-org",
    program.id,
  ).run()).meta.changes, 0);
  assert.throws(() => database
    .prepare("DELETE FROM compliance_programs WHERE id = ?")
    .run(program.id), /cannot be deleted/i);
  assert.throws(() => database
    .prepare("UPDATE compliance_activity_versions SET title = 'Changed' WHERE id = ?")
    .run(activity.id), /immutable/i);
  assert.equal((await domain.prepareComplianceActivityDraftDeleteStatement(
    d1,
    "creditex-org",
    activity.id,
  ).run()).meta.changes, 0);
  assert.throws(() => database
    .prepare("DELETE FROM compliance_activity_versions WHERE id = ?")
    .run(activity.id), /cannot be deleted/i);

  const draft = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "veu-draft-v1",
    organisationId: "creditex-org",
    programId: program.id,
    activityKey: "veu-draft",
    version: 1,
    title: "Unpublished activity",
    serviceCategory: "hot-water",
    productCategory: "heat-pump-water-heater",
    scenario: "Draft scenario.",
    jurisdiction: "VIC",
    effectiveFrom: "2026-01-01",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:04:00.000Z",
    ...sourceInput,
  });
  await draft.statement.run();
  await assert.rejects(
    domain.resolveLiveComplianceActivity(d1, draft.id, "2026-06-15"),
    (error) => error.code === "ACTIVITY_NOT_PUBLISHED",
  );
  assert.throws(() => database.prepare(
    "UPDATE compliance_activity_versions SET effective_from = '2026-02-30' WHERE id = ?",
  ).run(draft.id), /check constraint/i);
  assert.equal((await domain.prepareComplianceActivityDraftDeleteStatement(
    d1,
    "creditex-org",
    draft.id,
  ).run()).meta.changes, 1);

  const future = domain.prepareComplianceActivityCreateStatement(d1, {
    id: "veu-future-v1",
    organisationId: "creditex-org",
    programId: program.id,
    activityKey: "veu-future",
    version: 1,
    title: "Future activity",
    serviceCategory: "hot-water",
    productCategory: "heat-pump-water-heater",
    scenario: "Future scenario.",
    jurisdiction: "VIC",
    effectiveFrom: "2027-01-01",
    actorUid: "creditex-admin",
    createdAt: "2026-08-01T00:05:00.000Z",
    ...sourceInput,
  });
  await future.statement.run();
  await domain.prepareComplianceActivityPublishStatement(
    d1,
    "creditex-org",
    future.id,
    "creditex-admin",
    "2026-08-01T00:06:00.000Z",
  ).run();
  await assert.rejects(
    domain.resolveLiveComplianceActivity(d1, future.id, "2026-06-15"),
    (error) => error.code === "ACTIVITY_NOT_STARTED",
  );
  await assert.rejects(
    domain.resolveLiveComplianceActivity(d1, activity.id, "2027-01-01"),
    (error) => error.code === "ACTIVITY_EXPIRED",
  );
  assert.throws(() => database.prepare(
    "UPDATE compliance_programs SET withdrawn_by_uid = 'creditex-admin' WHERE id = ?",
  ).run(program.id), /check constraint/i);
  assert.throws(() => database.prepare(
    "UPDATE compliance_activity_versions SET publish_state = 'withdrawn' WHERE id = ?",
  ).run(activity.id), /check constraint/i);
  await assert.rejects(
    domain.prepareComplianceActivityWithdrawStatement(
      d1,
      "creditex-org",
      activity.id,
      "shared-admin",
      "2026-08-01T00:07:00.000Z",
    ),
    (error) => error.code === "NAMED_ADMIN_WITHDRAWER_REQUIRED",
  );
  assert.equal((await (await domain.prepareComplianceActivityWithdrawStatement(
    d1,
    "creditex-org",
    activity.id,
    "creditex-admin",
    "2026-08-01T00:07:00.000Z",
  )).run()).meta.changes, 1);
  assert.equal((await (await domain.prepareComplianceProgramWithdrawStatement(
    d1,
    "creditex-org",
    program.id,
    "creditex-admin",
    "2026-08-01T00:08:00.000Z",
  )).run()).meta.changes, 1);
  assert.throws(() => database.prepare(
    "UPDATE compliance_programs SET withdrawn_at = '2026-08-01T00:09:00.000Z' WHERE id = ?",
  ).run(program.id), /immutable/i);
});

test("case creation derives the organisation, snapshots the exact rule date, and appends an immutable event", async () => {
  const database = new DatabaseSync(":memory:");
  applyFoundation(database);
  applyEvidencePolicyFixtureSchema(database);
  insertOrganisation(database);
  const d1 = testD1(database);
  const domain = loadTypescriptModule(
    "../src/lib/creditex-compliance-server.ts",
    {
      "./creditex-schema-guards": {
        ensureCreditexSchemaGuards: async () => {},
      },
      "./creditex-source-lookup-review-server": approvedSourceReviewMock,
    },
  );

  database.prepare(`INSERT INTO compliance_programs
    (id, organisation_id, program_code, name, scheme_kind, jurisdiction,
     administering_body, official_source_url, official_source_title,
     official_source_version, official_source_sha256,
     official_source_checked_at, publish_state, published_by_uid, published_at,
     created_by_uid, created_at, updated_at)
    VALUES ('program', 'creditex-org', 'VEU', 'Victorian Energy Upgrades',
      'certificate', 'VIC', 'Essential Services Commission',
      'https://www.esc.vic.gov.au/veu', 'Victorian Energy Upgrades', '2026',
      ?, '2026-08-01T00:00:00.000Z', 'published', 'admin',
      '2026-08-01T00:00:00.000Z', 'admin', '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z')`).run("b".repeat(64));
  const requirementsJson = JSON.stringify({
    forms: [{ key: "install", version: 3 }],
    photos: [{ code: "serial-plate", required: true }],
  });
  database.prepare(`INSERT INTO compliance_activity_versions
    (id, program_id, activity_key, version, title, service_category,
     registry_activity_code, specification_part, product_category,
     scenario_code, scenario, jurisdiction, effective_from, effective_to,
     official_source_url, official_source_title, official_source_version,
     official_source_sha256, official_source_checked_at, requirements_snapshot,
     publish_state, calculation_approval_state, published_by_uid, published_at,
     created_by_uid, created_at, updated_at)
    VALUES ('activity', 'program', 'veu-hot-water', 3, 'Hot water activity',
      'hot-water', '1D', 'Part 1', 'heat-pump-water-heater',
      'replace-electric', 'Replace electric resistance.', 'VIC',
      '2026-01-01', '2026-12-31', 'https://www.esc.vic.gov.au/veu',
      'Victorian Energy Upgrades', '2026', ?, '2026-08-01T00:00:00.000Z',
      ?, 'published', 'not_assessed', 'admin',
      '2026-08-01T00:00:00.000Z', 'admin',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`)
    .run("c".repeat(64), requirementsJson);
  const evidencePolicyId = insertPublishedEvidencePolicy(database, "activity");
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, work_number, service_category, scheduled_start)
    VALUES ('job-1', 'installer-1', 'TLJ-000001', 'hot-water',
      '2026-06-15T09:00:00')`).run();
  database.prepare(`INSERT INTO trade_crm_service_sites
    (id, firebase_uid, address_state)
    VALUES ('site-1', 'installer-1', 'VIC'),
      ('site-2', 'installer-1', 'VIC')`).run();
  database.prepare(`INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, service_site_id)
    VALUES ('detail-1', 'job-1', 'installer-1', 'site-1')`).run();

  await assert.rejects(
    domain.prepareLiveComplianceCaseStatements(d1, {
      activityVersionId: "activity",
      activityDate: "2026-06-15",
      serviceCategory: "heating-cooling",
      jurisdiction: "VIC",
      workOrderId: "job-1",
      installerUid: "installer-1",
      actorUid: "installer-1",
    }),
    (error) => error.code === "ACTIVITY_CATEGORY_MISMATCH",
  );
  await assert.rejects(
    domain.prepareLiveComplianceCaseStatements(d1, {
      activityVersionId: "activity",
      activityDate: "2026-06-15",
      serviceCategory: "hot-water",
      jurisdiction: "NSW",
      workOrderId: "job-1",
      installerUid: "installer-1",
      actorUid: "installer-1",
    }),
    (error) => error.code === "ACTIVITY_JURISDICTION_MISMATCH",
  );

  for (const expectedOrganisation of [
    { id: "another-organisation", code: "creditex" },
    { id: "creditex-org", code: "ANOTHER-ORGANISATION" },
  ]) {
    const rejectedStatements = [];
    await assert.rejects(
      domain.appendLiveComplianceCaseStatements(d1, rejectedStatements, {
        activityVersionId: "activity",
        activityDate: "2026-06-15",
        serviceCategory: "hot-water",
        jurisdiction: "VIC",
        workOrderId: "job-1",
        installerUid: "installer-1",
        actorUid: "installer-1",
        expectedOrganisation,
      }),
      (error) =>
        error.code === "COMPLIANCE_ORGANISATION_MISMATCH"
        && error.status === 409,
    );
    assert.equal(
      rejectedStatements.length,
      0,
      "an organisation mismatch must fail before any case statement is staged",
    );
  }

  const prepared = await domain.prepareLiveComplianceCaseStatements(d1, {
    activityVersionId: "activity",
    activityDate: "2026-06-15",
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    workOrderId: "job-1",
    installerUid: "installer-1",
    actorType: "platform",
    actorUid: "installer-1",
    caseId: "case-1",
    eventId: "event-1",
    createdAt: "2026-06-01T00:00:00.000Z",
  });
  await d1.batch(prepared.statements);

  const stored = database.prepare(`SELECT organisation_id, program_id,
      work_order_id, installer_uid, activity_version_id,
      evidence_policy_version_id, activity_date,
      site_jurisdiction, activity_snapshot, status, evidence_status
    FROM compliance_cases WHERE id = 'case-1'`).get();
  assert.equal(stored.organisation_id, "creditex-org");
  assert.equal(stored.evidence_policy_version_id, evidencePolicyId);
  assert.equal(stored.activity_date, "2026-06-15");
  assert.equal(stored.site_jurisdiction, "VIC");
  assert.equal(stored.status, "draft");
  assert.equal(stored.evidence_status, "not_started");
  assert.match(prepared.caseNumber, /^TLC-\d{8}-[0-9A-F]{16,}$/);
  const snapshot = JSON.parse(stored.activity_snapshot);
  assert.equal(snapshot.programCode, "VEU");
  assert.equal(snapshot.activityDate, "2026-06-15");
  assert.equal(snapshot.officialSourceSha256, "c".repeat(64));
  assert.equal(snapshot.evidencePolicyVersionId, evidencePolicyId);
  assert.equal(snapshot.requirementsSnapshotJson, requirementsJson);
  assert.deepEqual(snapshot.requirementsSnapshot, JSON.parse(requirementsJson));
  assert.equal(
    database.prepare("SELECT event_type FROM compliance_case_events WHERE id = 'event-1'").get().event_type,
    "case_created",
  );
  assert.doesNotThrow(() => database.prepare(
    "UPDATE trade_work_orders SET scheduled_start = '2026-06-15T10:00:00' WHERE id = 'job-1'",
  ).run());
  assert.throws(() => database.prepare(
    "UPDATE trade_work_orders SET scheduled_start = '2026-06-16T09:00:00' WHERE id = 'job-1'",
  ).run(), /Compliance-linked job activity date cannot change without case supersession/);
  assert.doesNotThrow(() => database.prepare(
    "UPDATE trade_crm_job_details SET service_site_id = 'site-1' WHERE id = 'detail-1'",
  ).run());
  assert.throws(() => database.prepare(
    "UPDATE trade_crm_job_details SET service_site_id = 'site-2' WHERE id = 'detail-1'",
  ).run(), /Compliance-linked job service site cannot change without case supersession/);
  assert.doesNotThrow(() => database.prepare(
    "UPDATE trade_crm_service_sites SET address_state = 'VIC' WHERE id = 'site-1'",
  ).run());
  assert.throws(() => database.prepare(
    "UPDATE trade_crm_service_sites SET address_state = 'NSW' WHERE id = 'site-1'",
  ).run(), /Compliance-linked service site jurisdiction cannot change without case supersession/);

  const second = await domain.prepareLiveComplianceCaseStatements(d1, {
    activityVersionId: "activity",
    activityDate: "2026-06-15",
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    workOrderId: "job-1",
    installerUid: "installer-1",
    actorType: "platform",
    actorUid: "installer-1",
    caseId: "case-2",
    eventId: "event-2",
    createdAt: "2026-06-01T00:01:00.000Z",
  });
  await d1.batch(second.statements);
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_cases WHERE work_order_id = 'job-1'").get().count,
    2,
    "multiple governed cases may belong to one TLink job",
  );

  const wrongOwner = await domain.prepareLiveComplianceCaseStatements(d1, {
    activityVersionId: "activity",
    activityDate: "2026-06-15",
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    workOrderId: "job-1",
    installerUid: "other-installer",
    actorType: "platform",
    actorUid: "other-installer",
    caseId: "case-wrong-owner",
    eventId: "event-wrong-owner",
    createdAt: "2026-06-01T00:02:00.000Z",
  });
  await assert.rejects(
    d1.batch(wrongOwner.statements),
    /installer and planned activity do not match/i,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_cases WHERE id = 'case-wrong-owner'").get().count,
    0,
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) count FROM compliance_case_events WHERE id = 'event-wrong-owner'").get().count,
    0,
  );

  const tampered = await domain.prepareLiveComplianceCaseStatements(d1, {
    activityVersionId: "activity",
    activityDate: "2026-06-15",
    serviceCategory: "hot-water",
    jurisdiction: "VIC",
    workOrderId: "job-1",
    installerUid: "installer-1",
    actorType: "platform",
    actorUid: "installer-1",
    caseId: "case-tampered",
    eventId: "event-tampered",
    createdAt: "2026-06-01T00:03:00.000Z",
  });
  const caseStatement = tampered.statements[0];
  const tamperedValues = [...caseStatement.values];
  const activitySnapshotIndex = tamperedValues.findIndex((value) => {
    try {
      return JSON.parse(String(value)).programCode === "VEU";
    } catch {
      return false;
    }
  });
  assert.notEqual(activitySnapshotIndex, -1);
  const tamperedSnapshot = JSON.parse(
    tamperedValues[activitySnapshotIndex],
  );
  tamperedSnapshot.title = "Tampered rule";
  tamperedValues[activitySnapshotIndex] = JSON.stringify(tamperedSnapshot);
  tampered.statements[0] = new TestD1Statement(
    database,
    caseStatement.sql,
    tamperedValues,
  );
  await assert.rejects(d1.batch(tampered.statements), /snapshot does not match/i);

  database.prepare(`UPDATE compliance_cases
    SET evidence_status = 'in_progress', revision = revision + 1,
      updated_at = '2026-06-02T00:00:00.000Z'
    WHERE id = 'case-1'`).run();
  assert.equal(
    database.prepare("SELECT evidence_status FROM compliance_cases WHERE id = 'case-1'").get().evidence_status,
    "in_progress",
  );
  assert.throws(() => database
    .prepare("UPDATE compliance_cases SET activity_date = '2026-06-20' WHERE id = 'case-1'")
    .run(), /immutable/i);
  assert.throws(() => database
    .prepare("UPDATE compliance_case_events SET summary = 'Changed' WHERE id = 'event-1'")
    .run(), /append-only/i);
  assert.throws(() => database
    .prepare("DELETE FROM compliance_case_events WHERE id = 'event-1'")
    .run(), /append-only/i);
});

test("compliance access requires a verified exact identity, active organisation, active membership, and bounded role", async () => {
  const database = new DatabaseSync(":memory:");
  applyFoundation(database);
  database.exec(`ALTER TABLE compliance_users
    ADD governance_identity_verified integer DEFAULT 0 NOT NULL
      CHECK (governance_identity_verified IN (0, 1))`);
  insertOrganisation(database);
  database.prepare(`INSERT INTO compliance_users
    (id, organisation_id, firebase_uid, email, display_name, role, status,
     created_by_uid, created_at, updated_at)
    VALUES ('member-1', 'creditex-org', 'creditex-user',
      'reviewer@creditex.example', 'Creditex Reviewer', 'reviewer', 'active',
      'owner', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`).run();
  const d1 = testD1(database);
  const access = loadTypescriptModule(
    "../src/lib/compliance-access-server.ts",
    {
      "../../db": { getD1: () => d1 },
      "./firebase-server": {
        requireFirebaseIdentity: async (request) => request.identity,
      },
      "./creditex-schema-guards": {
        ensureCreditexSchemaGuards: async () => {},
      },
    },
  );
  const identity = {
    uid: "creditex-user",
    email: "reviewer@creditex.example",
    emailVerified: true,
    authTime: 0,
    signInProvider: "password",
  };

  const reviewer = await access.requireComplianceIdentity(
    identity,
    { allowedRoles: ["reviewer", "admin"] },
    d1,
  );
  assert.equal(reviewer.organisationId, "creditex-org");
  assert.equal(reviewer.role, "reviewer");
  assert.equal(reviewer.governanceIdentityVerified, false);
  assert.ok(
    database.prepare("SELECT last_login_at FROM compliance_users WHERE id = 'member-1'").get().last_login_at,
  );
  await assert.rejects(
    access.requireComplianceIdentity(
      identity,
      { allowedRoles: ["admin"] },
      d1,
    ),
    (error) => error.code === "COMPLIANCE_ROLE_REQUIRED",
  );
  await assert.rejects(
    access.requireComplianceIdentity(
      { ...identity, emailVerified: false },
      {},
      d1,
    ),
    (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
  );
  await assert.rejects(
    access.requireComplianceIdentity(
      { ...identity, email: "other@example.com" },
      {},
      d1,
    ),
    (error) => error.code === "COMPLIANCE_IDENTITY_MISMATCH",
  );

  database.prepare("UPDATE compliance_users SET status = 'suspended' WHERE id = 'member-1'").run();
  await assert.rejects(
    access.requireComplianceIdentity(identity, {}, d1),
    (error) => error.code === "COMPLIANCE_MEMBERSHIP_INACTIVE",
  );
  database.prepare("UPDATE compliance_users SET status = 'active' WHERE id = 'member-1'").run();
  database.prepare("UPDATE compliance_organisations SET status = 'suspended' WHERE id = 'creditex-org'").run();
  await assert.rejects(
    access.requireComplianceIdentity(identity, {}, d1),
    (error) => error.code === "COMPLIANCE_ORGANISATION_INACTIVE",
  );
});
