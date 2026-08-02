import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
  CreditexManualEvidenceContractError,
  manualEvidenceProgress,
  starterManualEvidenceForm,
  validateManualEvidenceFormSchema,
  validateManualEvidenceResponses,
} from "../src/lib/creditex-manual-evidence-lab.ts";
import {
  CreditexManualEvidenceLabError,
  cloneManualEvidenceForm,
  createManualEvidenceTestJob,
  createStarterManualEvidenceForm,
  loadManualEvidenceLab,
  loadManualEvidenceTestJobEvents,
  markManualEvidenceFormTestReady,
  updateManualEvidenceForm,
  updateManualEvidenceTestJob,
} from "../src/lib/creditex-manual-evidence-lab-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0111_creditex_manual_evidence_lab.sql");
const route = read(
  "../src/app/api/creditex/manual-evidence-lab/route.ts",
);
const workspace = read(
  "../src/components/CreditexManualEvidenceLab.tsx",
);
const workspaceStyles = read(
  "../src/components/CreditexManualEvidenceLab.module.css",
);
const pilotWorkspace = read(
  "../src/components/CreditexVeuPilotWorkspace.tsx",
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
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
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
    },
  };
}

function setupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE compliance_organisations (
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_users (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      role text NOT NULL
    );
    CREATE TABLE compliance_pilot_runs (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_pilot_installers (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      installer_slot integer NOT NULL,
      company_code text NOT NULL,
      business_name text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_pilot_technicians (
      id text PRIMARY KEY NOT NULL,
      pilot_run_id text NOT NULL,
      installer_id text NOT NULL,
      technician_slot integer NOT NULL,
      technician_code text NOT NULL,
      display_name text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE compliance_submission_batches (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE compliance_certificate_lots (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE compliance_trades (
      id text PRIMARY KEY NOT NULL
    );
    CREATE TABLE compliance_settlements (
      id text PRIMARY KEY NOT NULL
    );
  `);
  database.exec(migration);
  for (const definition of CREDITEX_SCHEMA_GUARD_DEFINITIONS.filter(
    (item) => item.name.startsWith("compliance_manual_evidence_"),
  )) {
    database.exec(definition.sql);
  }
  database.prepare(
    "INSERT INTO compliance_organisations (id, status) VALUES ('org-1', 'active')",
  ).run();
  database.prepare(`INSERT INTO compliance_users
      (id, organisation_id, firebase_uid, status, role)
    VALUES
      ('member-admin', 'org-1', 'admin-uid', 'active', 'admin'),
      ('member-reviewer', 'org-1', 'reviewer-uid', 'active', 'reviewer'),
      ('member-case', 'org-1', 'case-uid', 'active', 'case_manager'),
      ('member-auditor', 'org-1', 'auditor-uid', 'active', 'auditor')`)
    .run();
  database.prepare(`INSERT INTO compliance_pilot_runs
      (id, organisation_id, status)
    VALUES ('pilot-1', 'org-1', 'active')`).run();
  database.prepare(`INSERT INTO compliance_pilot_installers
      (id, pilot_run_id, installer_slot, company_code, business_name, status)
    VALUES ('installer-1', 'pilot-1', 1, 'I01', '[TEST] Installer 01',
      'test_active')`).run();
  database.prepare(`INSERT INTO compliance_pilot_technicians
      (id, pilot_run_id, installer_id, technician_slot, technician_code,
        display_name, status)
    VALUES ('technician-1', 'pilot-1', 'installer-1', 1, 'I01-T01',
      '[TEST] Technician 01', 'test_active')`).run();
  return database;
}

const admin = {
  uid: "admin-uid",
  email: "admin@example.test",
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1000),
  membershipId: "member-admin",
  organisationId: "org-1",
  organisationCode: "creditex",
  organisationLegalName: "Creditex",
  organisationTradingName: "Creditex",
  displayName: "Admin",
  role: "admin",
  governanceIdentityVerified: true,
};
const reviewer = {
  ...admin,
  uid: "reviewer-uid",
  membershipId: "member-reviewer",
  role: "reviewer",
};
const auditor = {
  ...admin,
  uid: "auditor-uid",
  membershipId: "member-auditor",
  role: "auditor",
};

function completedResponses(form) {
  const schema = form.schema || form.formSchema;
  return schema.fields.map((field) => ({
    fieldCode: field.fieldCode,
    outcome: "provided",
    value:
      field.fieldType === "checkbox"
        ? "Yes"
        : field.fieldType === "select"
        ? field.options[0]
        : ["photo", "document"].includes(field.fieldType)
        ? ""
        : "Test answer",
    captures: ["photo", "document"].includes(field.fieldType)
      ? Array.from(
          { length: Math.max(1, field.minimumCount) },
          (_, captureIndex) => ({
            fileName: field.fieldType === "photo"
              ? `${field.fieldCode}-${captureIndex + 1}.jpg`
              : `${field.fieldCode}-${captureIndex + 1}.pdf`,
            contentType: field.fieldType === "photo"
              ? "image/jpeg"
              : "application/pdf",
            originalPresent: field.originalRequired,
            metadataPresent: field.metadataRequired,
            gpsPresent: field.gpsRequired,
            captureTimePresent: field.fieldType === "photo",
          }),
        )
      : [],
    note: "Synthetic manual test response.",
  }));
}

test("every catalogued activity produces a bounded editable starter form", () => {
  assert.equal(GOVERNMENT_PROGRAM_TEMPLATES.length, 32);
  assert.equal(GOVERNMENT_ACTIVITY_TEMPLATES.length, 212);
  for (const activity of GOVERNMENT_ACTIVITY_TEMPLATES) {
    const form = starterManualEvidenceForm(activity);
    assert.equal(form.contract, CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT);
    assert.ok(form.fields.length >= 5);
    assert.ok(form.fields.length <= 40);
    assert.equal(
      new Set(form.fields.map((field) => field.fieldCode)).size,
      form.fields.length,
    );
    assert.deepEqual(validateManualEvidenceFormSchema(form), form);
    for (const field of form.fields) {
      assert.equal(field.origin, "creditex_operational_test");
      assert.equal(field.source, null);
    }
  }
});

test("government requirement candidates require an exact source and hash", () => {
  const form = starterManualEvidenceForm(GOVERNMENT_ACTIVITY_TEMPLATES[0]);
  form.fields[0] = {
    ...form.fields[0],
    origin: "government_requirement_candidate",
    source: null,
  };
  assert.throws(
    () => validateManualEvidenceFormSchema(form),
    (error) =>
      error instanceof CreditexManualEvidenceContractError
      && error.code === "MANUAL_EVIDENCE_SOURCE_REQUIRED",
  );
  form.fields[0].source = {
    officialSourceUrl: "https://example.gov.au/rule.pdf",
    officialSourceTitle: "Official rule",
    officialSourceVersion: "1.0",
    officialSourceSha256: "a".repeat(64),
    clause: "Page 4",
  };
  assert.deepEqual(validateManualEvidenceFormSchema(form), form);
});

test("manual capture counts, file types and typed answers are enforced", () => {
  const form = starterManualEvidenceForm(
    GOVERNMENT_ACTIVITY_TEMPLATES.find(
      (activity) => activity.serviceCategory !== "assessment",
    ),
  );
  const photo = {
    ...form.fields[0],
    minimumCount: 3,
    maximumCount: 4,
  };
  const oneCapture = {
    fieldCode: photo.fieldCode,
    outcome: "provided",
    value: "",
    captures: [{
      fileName: "only-one.jpg",
      contentType: "image/jpeg",
      originalPresent: true,
      metadataPresent: true,
      gpsPresent: true,
      captureTimePresent: true,
    }],
    note: "",
  };
  assert.equal(
    manualEvidenceProgress([photo], [oneCapture]).readyForAudit,
    false,
  );
  const threeCaptures = {
    ...oneCapture,
    captures: Array.from({ length: 3 }, (_, index) => ({
      ...oneCapture.captures[0],
      fileName: `capture-${index + 1}.jpg`,
    })),
  };
  assert.equal(
    manualEvidenceProgress([photo], [threeCaptures]).readyForAudit,
    true,
  );
  assert.throws(
    () => validateManualEvidenceResponses([photo], [{
      ...threeCaptures,
      captures: Array.from({ length: 5 }, (_, index) => ({
        ...oneCapture.captures[0],
        fileName: `capture-${index + 1}.jpg`,
      })),
    }]),
    (error) =>
      error instanceof CreditexManualEvidenceContractError
      && error.code === "MANUAL_EVIDENCE_CAPTURE_MAXIMUM_EXCEEDED",
  );

  const declaration = form.fields.find(
    (field) => field.fieldCode === "installer_declaration",
  );
  assert.ok(declaration);
  const rejectedDeclaration = validateManualEvidenceResponses(
    [declaration],
    [{
      fieldCode: declaration.fieldCode,
      outcome: "provided",
      value: "No",
      captures: [],
      note: "",
    }],
  );
  assert.equal(
    manualEvidenceProgress([declaration], rejectedDeclaration).readyForAudit,
    false,
  );
  assert.throws(
    () => validateManualEvidenceResponses([{
      ...declaration,
      fieldCode: "numeric_test",
      fieldType: "number",
    }], [{
      fieldCode: "numeric_test",
      outcome: "provided",
      value: "not-a-number",
      captures: [],
      note: "",
    }]),
    (error) =>
      error instanceof CreditexManualEvidenceContractError
      && error.code === "MANUAL_EVIDENCE_RESPONSE_NUMBER_INVALID",
  );
  assert.throws(
    () => validateManualEvidenceResponses([{
      ...declaration,
      fieldCode: "date_test",
      fieldType: "date",
    }], [{
      fieldCode: "date_test",
      outcome: "provided",
      value: "2026-02-31",
      captures: [],
      note: "",
    }]),
    (error) =>
      error instanceof CreditexManualEvidenceContractError
      && error.code === "MANUAL_EVIDENCE_RESPONSE_DATE_INVALID",
  );
});

test("manual form versions and jobs are owner-scoped, pinned and immutable", async () => {
  const database = setupDatabase();
  const d1 = testD1(database);
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (item) => item.programCode === "VEU",
  );
  assert.ok(activity);

  const draft = await createStarterManualEvidenceForm(d1, admin, {
    activityTemplateId: activity.templateId,
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.recordMode, "synthetic_test");

  const withPrompt = {
    ...draft.schema,
    fields: [
      ...draft.schema.fields,
      {
        ...draft.schema.fields[0],
        fieldCode: "creditex_test_dropdown",
        label: "Creditex test dropdown",
        instructions: "Choose one controlled test value.",
        fieldType: "select",
        captureTiming: "any_time",
        origin: "creditex_operational_test",
        options: ["Option A", "Option B"],
        allowedContentTypes: [],
        minimumCount: 1,
        maximumCount: 1,
        originalRequired: false,
        metadataRequired: false,
        gpsRequired: false,
        source: null,
      },
    ],
  };
  const updated = await updateManualEvidenceForm(d1, admin, {
    formId: draft.id,
    revision: draft.revision,
    title: "VEU test capture form",
    schema: withPrompt,
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.schema.fields.at(-1).fieldType, "select");

  const locked = await markManualEvidenceFormTestReady(d1, admin, {
    formId: updated.id,
    revision: updated.revision,
  });
  assert.equal(locked.status, "test_ready");
  assert.ok(locked.lockedAt);

  await assert.rejects(
    updateManualEvidenceForm(d1, admin, {
      formId: locked.id,
      revision: locked.revision,
      title: "Changed after lock",
      schema: locked.schema,
    }),
    (error) =>
      error instanceof CreditexManualEvidenceLabError
      && error.code === "MANUAL_EVIDENCE_FORM_IMMUTABLE",
  );

  const clone = await cloneManualEvidenceForm(d1, admin, {
    formId: locked.id,
  });
  assert.equal(clone.status, "draft");
  assert.equal(clone.version, locked.version + 1);
  assert.equal(clone.schemaSha256, locked.schemaSha256);

  const job = await createManualEvidenceTestJob(d1, admin, {
    formId: locked.id,
    installerId: "installer-1",
    technicianId: "technician-1",
    customerLabel: "[TEST] Customer 001",
    siteState: "VIC",
    sitePostcode: "3000",
  });
  assert.equal(job.status, "draft");
  assert.equal(job.formVersionId, locked.id);
  assert.equal(job.formSchemaSha256, locked.schemaSha256);
  assert.equal(job.installerId, "installer-1");

  const responses = completedResponses(job);
  const progress = manualEvidenceProgress(job.formSchema.fields, responses);
  assert.equal(progress.readyForAudit, true);

  const fieldTesting = await updateManualEvidenceTestJob(d1, admin, {
    jobId: job.id,
    revision: job.revision,
    status: "field_testing",
    responses,
  });
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_evidence_test_jobs
        SET status = 'changes_required',
          review_note = 'Attempted case manager review.',
          updated_by_uid = 'case-uid', revision = revision + 1
        WHERE id = ?`).run(fieldTesting.id),
    /COMPLIANCE_MANUAL_EVIDENCE_REVIEW_ACTOR_INVALID/,
  );
  const submitted = await updateManualEvidenceTestJob(d1, admin, {
    jobId: fieldTesting.id,
    revision: fieldTesting.revision,
    status: "ready_for_audit",
    responses,
  });
  const tamperedResponses = structuredClone(responses);
  tamperedResponses[0].note = "Changed during the approval request.";
  await assert.rejects(
    updateManualEvidenceTestJob(d1, reviewer, {
      jobId: submitted.id,
      revision: submitted.revision,
      status: "passed",
      responses: tamperedResponses,
      reviewNote: "Reviewed a modified synthetic snapshot.",
    }),
    (error) =>
      error instanceof CreditexManualEvidenceLabError
      && error.code === "MANUAL_EVIDENCE_REVIEW_SNAPSHOT_LOCKED",
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_evidence_test_jobs
        SET status = 'passed', passed_by_uid = 'case-uid',
          passed_at = '2026-08-02T00:00:00.000Z',
          review_note = 'Attempted case manager pass.',
          updated_by_uid = 'case-uid', revision = revision + 1
        WHERE id = ?`).run(submitted.id),
    /COMPLIANCE_MANUAL_EVIDENCE_REVIEW_ACTOR_INVALID/,
  );
  assert.throws(
    () => database.prepare(`UPDATE compliance_manual_evidence_test_jobs
        SET response_snapshot = '[]', response_sha256 = ?,
          updated_by_uid = 'reviewer-uid', revision = revision + 1
        WHERE id = ?`).run("a".repeat(64), submitted.id),
    /COMPLIANCE_MANUAL_EVIDENCE_REVIEW_SNAPSHOT_LOCKED/,
  );
  const passed = await updateManualEvidenceTestJob(d1, reviewer, {
    jobId: submitted.id,
    revision: submitted.revision,
    status: "passed",
    responses,
    reviewNote: "Reviewed every required synthetic prompt.",
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.completedRequiredCount, passed.requiredCount);
  assert.equal(passed.issueCount, 0);
  assert.ok(passed.passedAt);
  const history = await loadManualEvidenceTestJobEvents(
    d1,
    reviewer,
    passed.id,
  );
  assert.equal(history.length, 4);
  const passEvent = history.find(
    (event) => event.metadata.status === "passed",
  );
  assert.ok(passEvent);
  assert.equal(passEvent.metadata.reviewNote,
    "Reviewed every required synthetic prompt.");
  assert.deepEqual(passEvent.metadata.responseSnapshot, responses);

  const currentLocked = database.prepare(`SELECT form_schema_sha256, status
      FROM compliance_manual_evidence_form_versions WHERE id = ?`)
    .get(locked.id);
  assert.equal(currentLocked.form_schema_sha256, locked.schemaSha256);
  assert.equal(currentLocked.status, "test_ready");
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) count FROM compliance_manual_evidence_test_events",
    ).get().count,
    4,
  );
  for (const table of [
    "compliance_cases",
    "compliance_submission_batches",
    "compliance_certificate_lots",
    "compliance_trades",
    "compliance_settlements",
  ]) {
    assert.equal(
      database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,
      0,
    );
  }
});

test("manual evidence writes reject read-only auditors and real customer labels", async () => {
  const database = setupDatabase();
  const d1 = testD1(database);
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (item) => item.programCode === "SRES",
  );
  await assert.rejects(
    createStarterManualEvidenceForm(d1, auditor, {
      activityTemplateId: activity.templateId,
    }),
    (error) =>
      error instanceof CreditexManualEvidenceLabError
      && error.code === "MANUAL_EVIDENCE_ROLE_REQUIRED",
  );
  const draft = await createStarterManualEvidenceForm(d1, admin, {
    activityTemplateId: activity.templateId,
  });
  const locked = await markManualEvidenceFormTestReady(d1, admin, {
    formId: draft.id,
    revision: draft.revision,
  });
  await assert.rejects(
    createManualEvidenceTestJob(d1, admin, {
      formId: locked.id,
      customerLabel: "Real Customer Name",
      siteState: "NSW",
      sitePostcode: "2000",
    }),
    (error) =>
      error instanceof CreditexManualEvidenceLabError
      && error.code === "MANUAL_EVIDENCE_TEST_CUSTOMER_INVALID",
  );
});

test("dashboard exposes all programmes while preserving synthetic boundaries", async () => {
  const database = setupDatabase();
  const lab = await loadManualEvidenceLab(testD1(database), admin);
  assert.equal(lab.programmes.length, GOVERNMENT_PROGRAM_TEMPLATES.length);
  assert.equal(lab.activities.length, GOVERNMENT_ACTIVITY_TEMPLATES.length);
  assert.equal(lab.externalActionsEnabled, false);
  assert.deepEqual(lab.boundaries, {
    regulatedCasesCreated: 0,
    evidenceObjectsCreated: 0,
    certificatesCreated: 0,
    regulatorSubmissionsCreated: 0,
    tradesCreated: 0,
    settlementsCreated: 0,
    governmentPolicyAuthority:
      "Separate governed evidence-policy workflow with independent approval",
  });
  assert.equal(lab.installers.length, 1);
  assert.equal(lab.technicians.length, 1);
});

test("manual lab loads activity-scoped records with complete pagination", async () => {
  const database = setupDatabase();
  const d1 = testD1(database);
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (item) => item.programCode === "VEU",
  );
  for (let index = 0; index < 51; index += 1) {
    await createStarterManualEvidenceForm(d1, admin, {
      activityTemplateId: activity.templateId,
    });
  }
  const catalogueOnly = await loadManualEvidenceLab(d1, admin);
  assert.equal(catalogueOnly.forms.length, 0);
  assert.equal(catalogueOnly.jobs.length, 0);

  const firstPage = await loadManualEvidenceLab(d1, admin, {
    programCode: activity.programCode,
    activityTemplateId: activity.templateId,
    formPage: 1,
    pageSize: 50,
  });
  const secondPage = await loadManualEvidenceLab(d1, admin, {
    programCode: activity.programCode,
    activityTemplateId: activity.templateId,
    formPage: 2,
    pageSize: 50,
  });
  assert.equal(firstPage.forms.length, 50);
  assert.equal(secondPage.forms.length, 1);
  assert.equal(firstPage.pagination.forms.total, 51);
  assert.equal(firstPage.pagination.forms.totalPages, 2);
  assert.equal(
    new Set([...firstPage.forms, ...secondPage.forms].map((form) => form.id))
      .size,
    51,
  );
});

test("manual lab route, UI and responsive preview keep protected boundaries visible", () => {
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /requireComplianceIdentity/);
  assert.match(route, /ensureCreditexSchemaGuards/);
  assert.match(route, /readBoundedJsonRequest/);
  assert.match(route, /sameOrigin/);
  assert.doesNotMatch(route, /request\.json\(/);

  assert.match(workspace, /Creditex operational prompts remain separate/);
  assert.match(workspace, /Government requirement candidate/);
  assert.match(workspace, /Clone next version/);
  assert.match(workspace, /Installer preview/);
  assert.match(workspace, /Submit for Creditex audit/);
  assert.match(workspace, /Pass synthetic workflow/);
  assert.match(workspace, /APPEND-ONLY HISTORY/);
  assert.match(workspace, /Add test capture/);
  assert.match(workspace, /saveAndLockDraft/);
  assert.match(workspace, /No file bytes, regulated case/);
  assert.match(workspace, /MANUAL_EVIDENCE_CAPTURE_TIMINGS/);
  assert.match(workspace, /MANUAL_EVIDENCE_FIELD_TYPES/);
  assert.match(workspaceStyles, /@media \(max-width: 430px\)/);
  assert.match(workspaceStyles, /\.phoneFrame/);
  assert.match(
    pilotWorkspace,
    /<CreditexManualEvidenceLab api=\{api\} role=\{role\} \/>/,
  );
});
