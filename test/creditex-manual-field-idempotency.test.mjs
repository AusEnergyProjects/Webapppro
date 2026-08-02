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
  manualFieldJobRow,
  publicManualFieldJob,
  saveManualFieldForm,
} from "../src/lib/creditex-manual-field-server.ts";
import {
  CREDITEX_SCHEMA_GUARD_DEFINITIONS,
} from "../src/lib/creditex-schema-guards.ts";

const migration = fs.readFileSync(
  new URL("../drizzle/0112_creditex_manual_field_capture.sql", import.meta.url),
  "utf8",
);
const now = "2026-08-03T04:00:00.000Z";

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
  displayName: "Assigned Tester",
  role: "admin",
  governanceIdentityVerified: true,
};

function makeForm() {
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (candidate) => candidate.programCode === "VEU",
  );
  assert.ok(activity);
  const starter = starterManualEvidenceForm(activity);
  return {
    activity,
    schema: {
      ...starter,
      fields: [
        ...starter.fields,
        {
          fieldCode: "test_system_quantity",
          label: "Test system quantity",
          instructions: "Enter the synthetic installed quantity.",
          fieldType: "number",
          captureTiming: "after_install",
          origin: "creditex_operational_test",
          required: true,
          minimumCount: 1,
          maximumCount: 1,
          originalRequired: false,
          metadataRequired: false,
          gpsRequired: false,
          options: [],
          allowedContentTypes: [],
          source: null,
        },
        {
          fieldCode: "test_required_signature",
          label: "Required test signature",
          instructions:
            "Capture the required synthetic signature when an approved signature control exists.",
          fieldType: "signature",
          captureTiming: "after_install",
          origin: "creditex_operational_test",
          required: true,
          minimumCount: 1,
          maximumCount: 1,
          originalRequired: false,
          metadataRequired: false,
          gpsRequired: false,
          options: [],
          allowedContentTypes: [],
          source: null,
        },
      ],
    },
  };
}

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
  for (const definition of CREDITEX_SCHEMA_GUARD_DEFINITIONS) {
    if (
      definition.name.startsWith("compliance_manual_field_")
      || definition.name.startsWith("compliance_manual_evidence_test_capture_")
    ) {
      database.exec(definition.sql);
    }
  }
  database.prepare(`INSERT INTO compliance_users (
      id, organisation_id, firebase_uid, status, role,
      governance_identity_verified
    ) VALUES ('member-tester', 'org-1', 'tester-uid', 'active', 'admin', 1)`)
    .run();
  const { activity, schema } = makeForm();
  const responses = schema.fields.map((field) =>
    emptyManualEvidenceResponse(field.fieldCode)
  );
  database.prepare(`INSERT INTO compliance_manual_evidence_form_versions (
      id, organisation_id, status, title, version
    ) VALUES (
      'form-version-1', 'org-1', 'test_ready',
      'Locked synthetic evidence form', 1
    )`).run();
  database.prepare(`INSERT INTO compliance_manual_evidence_test_jobs (
      id, organisation_id, form_version_id, program_code,
      activity_template_id, activity_snapshot, form_schema,
      form_schema_sha256, job_number, installer_label, technician_label,
      customer_label, site_state, site_postcode, status, response_snapshot,
      response_sha256, required_count, completed_required_count, issue_count,
      review_note, record_mode, revision, updated_by_uid, created_at,
      updated_at, field_tester_uid
    ) VALUES (
      'manual-job-1', 'org-1', 'form-version-1', ?, ?, ?, ?, ?,
      'TEST-MANUAL-001', '[TEST] Installer', '[TEST] Technician',
      '[TEST] Customer', 'VIC', '3000', 'draft', ?, ?, 0, 0, 0, '',
      'synthetic_test', 1, 'tester-uid', ?, ?, 'tester-uid'
    )`)
    .run(
      activity.programCode,
      activity.templateId,
      JSON.stringify({ activity }),
      JSON.stringify(schema),
      "a".repeat(64),
      JSON.stringify(responses),
      "b".repeat(64),
      now,
      now,
    );
  return {
    database,
    d1: testD1(database),
    schema,
  };
}

function savedAnswers(schema, text = "Synthetic answer A") {
  return Object.fromEntries(
    schema.fields
      .filter((field) =>
        !["photo", "document", "signature"].includes(field.fieldType)
      )
      .map((field) => [
        field.fieldCode,
        field.fieldType === "checkbox"
          ? true
          : field.fieldType === "select"
            ? field.options[0]
            : field.fieldType === "number"
              ? "2"
              : field.fieldType === "date" ? "2026-08-03" : text,
      ]),
  );
}

function saveAction(schema, {
  clientActionId = "action-save-1",
  baseRevision = 1,
  text = "Synthetic answer A",
} = {}) {
  return {
    clientActionId,
    type: "save_job_form",
    workOrderId: "manual-job-1",
    formId: "manual-job-1:technical",
    baseRevision,
    answers: savedAnswers(schema, text),
    complete: false,
  };
}

function counts(database) {
  return {
    revision: database.prepare(`SELECT revision
      FROM compliance_manual_evidence_test_jobs
      WHERE id = 'manual-job-1'`).get().revision,
    receipts: database.prepare(`SELECT COUNT(*) count
      FROM compliance_manual_field_action_receipts`).get().count,
    events: database.prepare(`SELECT COUNT(*) count
      FROM compliance_manual_evidence_test_events
      WHERE event_type = 'manual_field.form_saved'`).get().count,
  };
}

test("exact replay is duplicate while payload reuse and stale actions conflict", async () => {
  const { database, d1, schema } = setupDatabase();
  const action = saveAction(schema);
  const applied = await saveManualFieldForm(d1, tester, action);
  assert.equal(applied.status, "applied");
  assert.equal(applied.appliedRevision, 2);
  assert.match(applied.responseSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(counts(database), {
    revision: 2,
    receipts: 1,
    events: 1,
  });

  const duplicate = await saveManualFieldForm(d1, tester, {
    ...action,
    answers: Object.fromEntries(
      Object.entries(action.answers).reverse(),
    ),
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.code, "MANUAL_FIELD_ACTION_REPLAYED");
  assert.equal(duplicate.appliedRevision, 2);
  assert.equal(duplicate.responseSha256, applied.responseSha256);
  assert.deepEqual(counts(database), {
    revision: 2,
    receipts: 1,
    events: 1,
  });

  const reusedWithDifferentPayload = await saveManualFieldForm(
    d1,
    tester,
    {
      ...saveAction(schema, {
        clientActionId: action.clientActionId,
      }),
      answers: {
        ...action.answers,
        test_system_quantity: "3",
      },
    },
  );
  assert.equal(reusedWithDifferentPayload.status, "conflict");
  assert.equal(
    reusedWithDifferentPayload.code,
    "MANUAL_FIELD_ACTION_ID_CONFLICT",
  );

  const genuinelyDifferentStaleAction = await saveManualFieldForm(
    d1,
    tester,
    saveAction(schema, {
      clientActionId: "action-save-stale",
      text: "Synthetic answer B",
    }),
  );
  assert.equal(genuinelyDifferentStaleAction.status, "conflict");
  assert.equal(
    genuinelyDifferentStaleAction.code,
    "MANUAL_FIELD_REVISION_CONFLICT",
  );
  assert.deepEqual(counts(database), {
    revision: 2,
    receipts: 1,
    events: 1,
  });
});

test("concurrent duplicate saves create one receipt, mutation and event", async () => {
  const { database, d1, schema } = setupDatabase();
  const action = saveAction(schema, {
    clientActionId: "action-save-race",
  });
  const results = await Promise.all([
    saveManualFieldForm(d1, tester, structuredClone(action)),
    saveManualFieldForm(d1, tester, structuredClone(action)),
  ]);
  assert.deepEqual(
    results.map(({ status }) => status).sort(),
    ["applied", "duplicate"],
  );
  assert.deepEqual(counts(database), {
    revision: 2,
    receipts: 1,
    events: 1,
  });
  const event = database.prepare(`SELECT metadata
    FROM compliance_manual_evidence_test_events
    WHERE event_type = 'manual_field.form_saved'`).get();
  assert.equal(
    JSON.parse(event.metadata).clientActionId,
    action.clientActionId,
  );
});

test("number remains explicit and required signature is visibly fail-closed", async () => {
  const { database, d1, schema } = setupDatabase();
  await saveManualFieldForm(
    d1,
    tester,
    saveAction(schema, {
      clientActionId: "action-save-projection",
    }),
  );
  const row = await manualFieldJobRow(
    d1,
    tester,
    "manual-job-1",
  );
  const job = publicManualFieldJob(row);
  const number = job.forms[0].template.fields.find(
    (field) => field.key === "test_system_quantity",
  );
  assert.ok(number);
  assert.equal(number.type, "number");

  assert.equal(
    job.forms[0].template.fields.some(
      (field) => field.key === "test_required_signature",
    ),
    false,
    "signature must not be fabricated as a generic text answer",
  );
  const signature = job.compliance.requirements.find(
    (requirement) => requirement.code === "test_required_signature",
  );
  assert.ok(signature);
  assert.equal(signature.evidenceType, "signature");
  assert.equal(signature.status, "blocked");
  assert.equal(signature.compatibility.captureSupported, false);
  assert.equal(signature.compatibility.requiresSignatureCapture, true);
  assert.match(
    signature.compatibility.blockers[0],
    /not available in AEA Field/,
  );
  const progress = database.prepare(`SELECT
      required_count, completed_required_count
    FROM compliance_manual_evidence_test_jobs
    WHERE id = 'manual-job-1'`).get();
  assert.ok(progress.completed_required_count < progress.required_count);
});
