import { loadFormJobProgress } from "./helpers/trade-form-job-progress-fixture.mjs";
import { installEmptyTradeCrews } from "./helpers/trade-crews-fixture.mjs";
import * as jobCollaboration from "../src/lib/trade-job-collaboration.ts";
import { installFieldCorrectionFixture } from "./helpers/activity-field-corrections-fixture.mjs";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import * as activityCompletion from "../src/lib/trade-activity-forms-completion.ts";
import * as fieldCompletionPolicy from "../src/lib/trade-field-completion-policy.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { certificateTestDependency, installCreditexTrainingFixture } from './helpers/creditex-training-fixture.mjs';

const source = fs.readFileSync(
  new URL("../src/app/api/trade-field-work/route.ts", import.meta.url),
  "utf8",
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
  let beforeBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    setBeforeBatch(callback) {
      beforeBatch = callback;
    },
    async batch(statements) {
      const callback = beforeBatch;
      beforeBatch = null;
      if (callback) callback();
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

function loadRoute(db, accessPatch = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: "src/app/api/trade-field-work/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const access = {
    ownerUid: "owner-1",
    actorUid: "actor-1",
    memberId: "member-1",
    displayName: "Field Technician",
    isOwner: true,
    canViewFieldEvidence: true,
    canManageFieldEvidence: true,
    jobScope: "team",
    ...accessPatch,
  };
  const mocks = {
    "cloudflare:workers": { env: {} },
    "@/lib/trade-job-collaboration": jobCollaboration,
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { mfaErrorResponse,
      adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      assignedJob: async (_access, workOrderId) => {
        const row = await db.prepare(`SELECT id, source_type, stage, revision, assignee_member_id
          FROM trade_work_orders
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
          .bind(workOrderId, access.ownerUid).first();
        if (!row) throw new Error("JOB_NOT_FOUND");
        return row;
      },
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": {
      jobSyncChangeStatements: () => [],
      nextJobRevision: (revision) => Number(revision) + 1,
    },
    "@/lib/photo-request-review-server": {
      photoRequestProofOverview: async () => ({ proofReady: true }),
    },
    "@/lib/trade-photo-requests": {
      normalisePhotoRequirements: (requirements) => requirements,
    },
    "@/lib/trade-crm-job-media-cleanup": {
      drainTradeCrmJobMediaCleanup: async () => ({ completed: 0, pending: 0 }),
    },
    "@/lib/trade-rental-image-dimensions.mjs": {
      rentalImageWithinReportLimit: () => true,
    },
    "@/lib/trade-rental-evidence.mjs": {
      rentalEvidencePhotoCapture: () => ({}),
    },
    "@/lib/bounded-json-request": {
      BoundedJsonRequestError: class BoundedJsonRequestError extends Error {},
      readBoundedJsonRequest: async (request) => request.json(),
    },
  };
  const require = (specifier) => {
    if (specifier === "@/lib/trade-form-job-progress") return loadFormJobProgress(db, require);
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "@/lib/trade-field-completion-policy") return fieldCompletionPolicy;
    if (specifier === "@/lib/trade-activity-forms-completion") return activityCompletion;
    const dependency = certificateTestDependency(specifier);
    if (dependency) return dependency;
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function fixture(accessPatch = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(fs.readFileSync(new URL("../drizzle/0170_trade_activity_forms.sql", import.meta.url), "utf8"));
  installFieldCorrectionFixture(database);
  database.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_number text NOT NULL,
      title text NOT NULL,
      stage text NOT NULL,
      site_area text NOT NULL,
      scheduled_start text NOT NULL,
      scheduled_end text NOT NULL,
      source_type text NOT NULL,
      record_status text NOT NULL,
      revision integer NOT NULL,
      assignee_member_id text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_rental_inspections (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'draft'
    );
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL,
      service_site_id text NOT NULL,
      customer_source text NOT NULL,
      description text NOT NULL,
      pipeline_stage text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      business_name text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      phone text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      site_label text NOT NULL,
      address_line_1 text NOT NULL,
      address_line_2 text NOT NULL,
      suburb text NOT NULL,
      address_state text NOT NULL,
      postcode text NOT NULL
    );
    CREATE TABLE trade_crm_customer_contacts (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      phone text NOT NULL
    );
    CREATE TABLE trade_crm_site_contacts (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      service_site_id text NOT NULL,
      customer_contact_id text NOT NULL,
      record_status text NOT NULL,
      is_primary integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      assignee_member_id text NOT NULL DEFAULT 'member-1',
      assignee_label text NOT NULL DEFAULT 'Field Technician',
      notes text NOT NULL DEFAULT '',
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      starts_at text NOT NULL,
      ends_at text NOT NULL,
      travel_started_at text NOT NULL,
      arrived_at text NOT NULL,
      work_started_at text NOT NULL,
      completed_at text NOT NULL,
      last_transition_by_uid text NOT NULL,
      revision integer NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_time_entries (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      staff_label text NOT NULL,
      work_date text NOT NULL,
      duration_minutes integer NOT NULL,
      notes text NOT NULL,
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
      caption text NOT NULL,
      source text NOT NULL,
      photo_request_id text NOT NULL,
      photo_requirement_id text NOT NULL,
      request_revision integer NOT NULL,
      checklist_version text NOT NULL,
      customer_acknowledged_at text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_signoffs (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      signer_role text NOT NULL,
      signer_name text NOT NULL,
      confirmation_text text NOT NULL,
      method text NOT NULL,
      signed_at text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requests (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      revision integer NOT NULL,
      requirements text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_photo_requirement_reviews (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_order_id text NOT NULL,
      photo_request_id text NOT NULL,
      photo_requirement_id text NOT NULL,
      status text NOT NULL,
      reason_code text NOT NULL,
      guidance text NOT NULL,
      request_revision integer NOT NULL,
      review_revision integer NOT NULL,
      reviewed_upload_count integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_photo_request_completions (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_order_id text NOT NULL,
      photo_request_id text NOT NULL,
      request_revision integer NOT NULL,
      completion_revision integer NOT NULL,
      checklist_version text NOT NULL,
      evidence_key text NOT NULL,
      required_count integer NOT NULL,
      supplied_count integer NOT NULL,
      completed_at text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_job_forms (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_job_notes (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      note_type text NOT NULL,
      issue_status text NOT NULL
    );
    CREATE TABLE trade_crm_job_plans (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_plan_phases (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_plan_requirements (
      id text PRIMARY KEY NOT NULL,
      job_plan_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_offline_actions (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      actor_uid text NOT NULL,
      member_id text NOT NULL,
      device_id text NOT NULL,
      client_action_id text NOT NULL,
      payload_hash text NOT NULL,
      action_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      base_revision integer NOT NULL,
      result_revision integer NOT NULL,
      status text NOT NULL,
      lease_until text NOT NULL,
      error_code text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (owner_uid, client_action_id)
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      event_type text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      compliance_intent_id text NOT NULL DEFAULT '',
      evidence_policy_version_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE compliance_evidence_requirements (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      policy_version_id text NOT NULL,
      minimum_count integer NOT NULL
    );
    CREATE TABLE compliance_case_evidence (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      case_id text NOT NULL,
      requirement_id text NOT NULL,
      original_sha256 text NOT NULL,
      supersedes_evidence_id text NOT NULL,
      status text NOT NULL
    );
  `);
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, work_number, title, stage, site_area, scheduled_start,
     scheduled_end, source_type, record_status, revision, assignee_member_id, updated_at)
    VALUES ('job-1', 'owner-1', 'TLJ-1', 'Heat pump installation', 'in_progress',
      'VIC', '', '', 'internal', 'active', 5, '', 'initial')`).run();
  database.prepare(`INSERT INTO trade_crm_job_details
    (id, work_order_id, firebase_uid, crm_customer_id, service_site_id,
     customer_source, description, pipeline_stage, updated_at)
    VALUES ('details-1', 'job-1', 'owner-1', '', '', 'internal',
      'Install governed products.', 'in_progress', 'initial')`).run();
  database.prepare(`INSERT INTO trade_crm_appointments
    (id, work_order_id, firebase_uid, status, starts_at, ends_at,
     travel_started_at, arrived_at, work_started_at, completed_at,
     last_transition_by_uid, revision, updated_at)
    VALUES ('appointment-1', 'job-1', 'owner-1', 'in_progress', '', '',
      '', '', 'started', '', '', 1, 'initial')`).run();
  database.exec(`
    INSERT INTO compliance_cases
      (id, organisation_id, work_order_id, installer_uid, evidence_policy_version_id, status)
    VALUES
      ('case-1', 'org-1', 'job-1', 'owner-1', 'policy-1', 'in_review'),
      ('case-2', 'org-1', 'job-1', 'owner-1', 'policy-2', 'in_review'),
      ('foreign-case', 'org-2', 'job-1', 'owner-2', 'foreign-policy', 'in_review');
    INSERT INTO compliance_evidence_requirements
      (id, organisation_id, policy_version_id, minimum_count)
    VALUES
      ('requirement-1', 'org-1', 'policy-1', 1),
      ('requirement-2', 'org-1', 'policy-2', 1),
      ('foreign-requirement', 'org-2', 'foreign-policy', 1);
    INSERT INTO compliance_case_evidence
      (id, organisation_id, case_id, requirement_id, original_sha256,
       supersedes_evidence_id, status)
    VALUES
      ('evidence-1', 'org-1', 'case-1', 'requirement-1',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       '', 'accepted');
  `);
  database.exec(`
CREATE TABLE trade_work_order_compliance_intents (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      intent_key text NOT NULL,
      installer_uid text NOT NULL,
      compliance_organisation_id text NOT NULL,
      program_template_id text NOT NULL,
      activity_template_id text NOT NULL,
      program_code text NOT NULL,
      registry_activity_code text NOT NULL,
      planned_start text NOT NULL,
      status text NOT NULL,
      intent_snapshot text NOT NULL,
      compliance_case_id text NOT NULL,
      created_at text NOT NULL
    );
CREATE TABLE compliance_activity_work_pack_instances (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      compliance_case_id text NOT NULL,
      work_order_id text NOT NULL,
      compliance_intent_id text NOT NULL,
      instance_key text NOT NULL,
      work_pack_version_id text NOT NULL,
      revision integer NOT NULL,
      status text NOT NULL
    );
CREATE TABLE compliance_activity_work_pack_final_records (
      id text PRIMARY KEY NOT NULL,
      organisation_id text NOT NULL,
      instance_key text NOT NULL,
      case_instance_id text NOT NULL,
      work_pack_version_id text NOT NULL
    );`);
  database.exec(fs.readFileSync(new URL("../drizzle/0256_trade_veu_electrical_assessments.sql", import.meta.url), "utf8"));
  installCreditexTrainingFixture(database);
  installEmptyTradeCrews(database);
  const db = testD1(database);
  return { database, db, route: loadRoute(db, accessPatch), progress: loadFormJobProgress(db, specifier => {
    if (specifier === "@/lib/trade-job-collaboration") return jobCollaboration;
    if (specifier === "@/lib/trade-activity-forms-completion") return activityCompletion;
    if (specifier === "@/lib/trade-team-sync-server") return { nextJobRevision: value => Number(value) + 1, jobSyncChangeStatements: () => [] };
    if (specifier === "@/lib/photo-request-review-server") return { photoRequestProofOverview: async () => ({proofReady: db.photoReady !== false}) };
    if (specifier === "@/lib/trade-photo-requests") return { normalisePhotoRequirements: value => value };
    const dependency = certificateTestDependency(specifier); if (dependency) return dependency;
    throw new Error(`Unexpected progress dependency: ${specifier}`);
  }) };
}

function finishRequest(clientActionId) {
  return new Request("https://example.test/api/trade-field-work", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "field_transition",
      transition: "finish",
      workOrderId: "job-1",
      clientActionId,
    }),
  });
}

const progressAccess = { ownerUid: "owner-1", actorUid: "actor-1", memberId: "member-1", isOwner: false,
  canManageFieldEvidence: true, jobScope: "own" };
function progressFixture() {
  const value = fixture();
  value.database.exec(`ALTER TABLE trade_team_members ADD COLUMN can_manage_field_evidence INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE trade_work_orders ADD COLUMN partner_type TEXT NOT NULL DEFAULT 'installer';
    UPDATE trade_work_orders SET assignee_member_id='member-1', stage='scheduled';
    UPDATE trade_crm_appointments SET status='scheduled', work_started_at='';
    INSERT INTO trade_team_members(id,owner_uid,member_uid,status) VALUES ('member-1','owner-1','actor-1','active'),('member-2','owner-1','actor-2','active');
    DELETE FROM compliance_evidence_requirements;
    INSERT INTO trade_job_forms VALUES ('form-1','job-1','owner-1','draft'),('form-2','job-1','owner-1','draft');`);
  return value;
}

function electricalAssessment(database, { id = "piesa", workOrderId = "job-1", ownerUid = "owner-1", status = "draft" } = {}) {
  const completedAt = status === "complete" ? "2026-10-08T02:00:00.000Z" : "";
  const payload = JSON.stringify({ id, workOrderId, ownerUid, revision: 1, status, completedAt });
  database.prepare(`INSERT INTO trade_veu_electrical_assessments
    (id,work_order_id,owner_uid,revision,status,payload,payload_sha256,pdf_object_key,pdf_sha256,pdf_size_bytes,actor_uid,created_at,updated_at,completed_at)
    VALUES (?,?,?,1,?,?,?,?,?,?,'actor-1','now','now',?)`)
    .run(id, workOrderId, ownerUid, status, payload, "a".repeat(64), completedAt ? "piesa/completed.pdf" : "", completedAt ? "b".repeat(64) : "", completedAt ? 100 : 0, completedAt);
}

test("saved form editing starts work without claiming travel or arrival, and timing alone cannot complete", async () => {
  const { database, db, progress } = progressFixture();
  try {
    const first = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db, startOnly: true, now: "2026-10-02T02:00:00.000Z" });
    assert.equal(first.stage, "in_progress"); assert.equal(first.changed, true);
    const visit = database.prepare("SELECT * FROM trade_crm_appointments").get();
    assert.equal(visit.status, "in_progress"); assert.equal(visit.travel_started_at, ""); assert.equal(visit.arrived_at, "");
    assert.equal(visit.work_started_at, "2026-10-02T02:00:00.000Z");
    database.exec("UPDATE trade_job_forms SET status='complete'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db, startOnly: true })).stage, "in_progress");
    assert.equal(database.prepare("SELECT completed_at FROM trade_crm_appointments").get().completed_at, "");
  } finally { database.close(); }
});

test("every form on a job must complete before authoritative reconciliation closes the job once", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("UPDATE trade_job_forms SET status='complete' WHERE id='form-1'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    database.exec("UPDATE trade_job_forms SET status='complete' WHERE id='form-2'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments").get().status, "completed");
    assert.equal(database.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "complete");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).changed, false);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events WHERE event_type='job_completed'").get().total, 1);
  } finally { database.close(); }
});

test("finishing general forms keeps a job open until its attached electrical assessment is complete", async () => {
  for (const unscheduled of [false, true]) {
    const { database, db, progress } = progressFixture();
    try {
      if (unscheduled) database.exec("DELETE FROM trade_crm_appointments");
      database.exec("UPDATE trade_job_forms SET status='complete'");
      electricalAssessment(database);
      const pending = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
      assert.equal(pending.stage, "in_progress"); assert.equal(pending.blockers[0].key, "requirements");
      assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "in_progress");
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events WHERE event_type='job_completed'").get().total, 0);
      database.exec(`UPDATE trade_veu_electrical_assessments SET status='complete', completed_at='now',
        payload=json_set(payload,'$.status','complete','$.completedAt','now'), pdf_object_key='piesa/completed.pdf',
        pdf_sha256='${"b".repeat(64)}',pdf_size_bytes=100`);
      const complete = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
      assert.equal(complete.stage, "completed");
      assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).changed, false);
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events WHERE event_type='job_completed'").get().total, 1);
    } finally { database.close(); }
  }
});

test("a PIESA-only unscheduled job uses its saved assessment for work presence and completion", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("DELETE FROM trade_crm_appointments; DELETE FROM trade_job_forms");
    electricalAssessment(database);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    database.exec(`UPDATE trade_veu_electrical_assessments SET status='complete', completed_at='now',
      payload=json_set(payload,'$.status','complete','$.completedAt','now'), pdf_object_key='piesa/completed.pdf',
      pdf_sha256='${"b".repeat(64)}',pdf_size_bytes=100`);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("electrical assessment blockers and completion eligibility stay scoped to the exact business and job", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete';
      INSERT INTO trade_work_orders (id,firebase_uid,work_number,title,stage,site_area,scheduled_start,scheduled_end,source_type,record_status,revision,assignee_member_id,updated_at,partner_type)
        SELECT 'job-2',firebase_uid,work_number,title,stage,site_area,scheduled_start,scheduled_end,source_type,record_status,revision,assignee_member_id,updated_at,partner_type
        FROM trade_work_orders WHERE id='job-1'`);
    electricalAssessment(database, { id: "foreign-owner", ownerUid: "owner-2" });
    electricalAssessment(database, { id: "foreign-job", workOrderId: "job-2" });
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
    database.exec("UPDATE trade_work_orders SET stage='in_progress'; UPDATE trade_crm_job_details SET pipeline_stage='in_progress'; DELETE FROM trade_job_forms; DELETE FROM trade_crm_appointments; DELETE FROM trade_veu_electrical_assessments");
    electricalAssessment(database, { id: "foreign-owner-complete", ownerUid: "owner-2", status: "complete" });
    electricalAssessment(database, { id: "foreign-job-complete", workOrderId: "job-2", status: "complete" });
    const empty = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(empty.stage, "in_progress"); assert.equal(empty.changed, false); assert.deepEqual(empty.blockers, []);
  } finally { database.close(); }
});

test("completed electrical assessments cannot advance cancelled jobs or another business's job", async () => {
  for (const foreignScope of [false, true]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("DELETE FROM trade_crm_appointments; DELETE FROM trade_job_forms");
      electricalAssessment(database, { status: "complete" });
      if (!foreignScope) database.exec("UPDATE trade_work_orders SET stage='cancelled'");
      const access = foreignScope ? { ...progressAccess, ownerUid: "owner-2" } : progressAccess;
      const result = await progress.reconcileTradeFormJobProgress(access, "job-1", { db });
      assert.equal(result.changed, false);
      assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, foreignScope ? "scheduled" : "cancelled");
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
    } finally { database.close(); }
  }
});

test("an electrical assessment attached during final reconciliation blocks the atomic job completion", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("UPDATE trade_job_forms SET status='complete'");
    db.setBeforeBatch(() => electricalAssessment(database));
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(result.changed, false); assert.equal(result.pending, true); assert.equal(result.blockers[0].key, "changed");
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments").get().status, "scheduled");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
  } finally { database.close(); }
});

for (const [name, create] of [
  ["task", "INSERT INTO trade_work_order_tasks VALUES ('task-1','job-1','owner-1','pending')"],
  ["open issue", "INSERT INTO trade_crm_job_notes VALUES ('issue-1','job-1','owner-1','issue','open')"],
  ["unissued rental", "INSERT INTO trade_rental_inspections VALUES ('rental-1','job-1','owner-1','draft')"],
  ["work-plan item", "INSERT INTO trade_crm_job_plans VALUES ('plan-1','job-1','owner-1','in_progress','',''); INSERT INTO trade_crm_job_plan_requirements VALUES ('item-1','plan-1','owner-1','required')"],
  ["governed evidence", "INSERT INTO compliance_evidence_requirements VALUES ('missing','org-1','policy-1',1)"],
]) test(`automatic completion retains the ${name} blocker`, async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("UPDATE trade_job_forms SET status='complete';" + create);
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(result.stage, "in_progress"); assert.ok(result.blockers.length);
    assert.equal(database.prepare("SELECT completed_at FROM trade_crm_appointments").get().completed_at, "");
  } finally { database.close(); }
});

test("pending customer photo proof prevents automatic completion", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete'; INSERT INTO trade_crm_photo_requests VALUES ('photos','job-1','owner-1',1,'[]','active')`);
    db.photoReady = false;
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    db.photoReady = true;
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("processing or conflicted offline receipts prevent automatic completion", async () => {
  for (const status of ["processing", "conflict"]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("UPDATE trade_job_forms SET status='complete'");
      database.prepare(`INSERT INTO trade_offline_actions VALUES
        ('pending','owner-1','actor-1','member-1','device','pending-action','hash','save_job_form','job','job-1',1,2,?,'','','','')`).run(status);
      assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
      database.exec("UPDATE trade_offline_actions SET status='applied'");
      assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
    } finally { database.close(); }
  }
});

test("planned activity requirements and missing certificate training never silently advance work", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete';
      INSERT INTO trade_work_order_compliance_intents
        (id,work_order_id,intent_key,installer_uid,compliance_organisation_id,program_template_id,activity_template_id,
         program_code,registry_activity_code,planned_start,status,intent_snapshot,compliance_case_id,created_at)
        VALUES ('intent','job-1','intent','owner-1','org-1','sres','sres-ashp','SRES','','','planned','{}','','')`);
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(result.changed, false); assert.ok(result.blockers.length);
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments").get().status, "scheduled");
  } finally { database.close(); }
});

test("assignment and actor revocation during the atomic batch prevent automatic progress", async () => {
  for (const mutation of ["UPDATE trade_crm_appointments SET assignee_member_id='member-2',revision=revision+1", "UPDATE trade_team_members SET status='inactive' WHERE id='member-1'", "UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='member-1'"] ) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("UPDATE trade_job_forms SET status='complete'");
      db.setBeforeBatch(() => database.exec(mutation));
      const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
      assert.equal(result.changed, false); assert.equal(result.blockers[0].key, "changed");
      assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
    } finally { database.close(); }
  }
});

test("a concurrent new required form rolls back the completion projection", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("UPDATE trade_job_forms SET status='complete'");
    db.setBeforeBatch(() => database.exec("INSERT INTO trade_job_forms VALUES ('form-3','job-1','owner-1','draft')"));
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(result.changed, false);
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments").get().status, "scheduled");
  } finally { database.close(); }
});

test("shared jobs finish only the actor's unique visit and wait for other workers", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete'; INSERT INTO trade_crm_appointments
      SELECT 'member-2','Other worker',notes,'appointment-2',work_order_id,firebase_uid,status,starts_at,ends_at,
        travel_started_at,arrived_at,work_started_at,completed_at,last_transition_by_uid,revision,updated_at FROM trade_crm_appointments`);
    const first = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(first.stage, "in_progress");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-1'").get().status, "completed");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-2'").get().status, "scheduled");
    assert.equal((await progress.reconcileTradeFormJobProgress({ ...progressAccess, memberId: "member-2", actorUid: "actor-2" }, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("an actor retry after another worker completes the last form closes only the actor's pending visit", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`INSERT INTO trade_crm_appointments
      SELECT 'member-2','Other worker',notes,'appointment-2',work_order_id,firebase_uid,status,starts_at,ends_at,
        travel_started_at,arrived_at,work_started_at,completed_at,last_transition_by_uid,revision,updated_at FROM trade_crm_appointments;
      UPDATE trade_job_forms SET status='complete' WHERE id='form-1'`);
    const first = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(first.stage, "in_progress"); assert.ok(first.blockers.length);
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-1'").get().status, "in_progress");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-2'").get().status, "scheduled");

    database.exec("UPDATE trade_job_forms SET status='complete' WHERE id='form-2'");
    const second = await progress.reconcileTradeFormJobProgress({ ...progressAccess, memberId: "member-2", actorUid: "actor-2" }, "job-1", { db });
    assert.equal(second.stage, "in_progress");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-1'").get().status, "in_progress");
    const otherVisit = database.prepare("SELECT * FROM trade_crm_appointments WHERE id='appointment-2'").get();
    assert.equal(otherVisit.status, "completed"); assert.equal(otherVisit.last_transition_by_uid, "actor-2");

    // A persisted completion marker lets this actor's later authenticated heartbeat retry.
    const retried = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
    assert.equal(retried.stage, "completed");
    assert.equal(database.prepare("SELECT last_transition_by_uid FROM trade_crm_appointments WHERE id='appointment-1'").get().last_transition_by_uid, "actor-1");
    assert.deepEqual(database.prepare("SELECT * FROM trade_crm_appointments WHERE id='appointment-2'").get(), otherVisit);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events WHERE event_type='job_completed'").get().total, 1);
  } finally { database.close(); }
});

test("ambiguous actor visits and managers' other-worker visits are never inferred", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete'; INSERT INTO trade_crm_appointments
      SELECT assignee_member_id,assignee_label,notes,'appointment-2',work_order_id,firebase_uid,status,starts_at,ends_at,
        travel_started_at,arrived_at,work_started_at,completed_at,last_transition_by_uid,revision,updated_at FROM trade_crm_appointments`);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).blockers[0].key, "visit");
    database.exec("UPDATE trade_crm_appointments SET assignee_member_id='member-2'");
    await progress.reconcileTradeFormJobProgress({ ...progressAccess, isOwner: true, jobScope: "team" }, "job-1", { db });
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_crm_appointments WHERE status='scheduled'").get().total, 2);
  } finally { database.close(); }
});

test("unscheduled assigned jobs complete only after every form, without requiring a fabricated appointment", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_job_forms SET status='complete' WHERE id='form-1'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    database.exec("UPDATE trade_job_forms SET status='complete' WHERE id='form-2'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_crm_appointments").get().total, 0);
  } finally { database.close(); }
});

test("unscheduled automatic closure excludes another worker's assignment and empty jobs", async () => {
  for (const mutation of ["UPDATE trade_work_orders SET assignee_member_id='member-2'", "DELETE FROM trade_job_forms"]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_job_forms SET status='complete';" + mutation);
      const result = await progress.reconcileTradeFormJobProgress({ ...progressAccess, isOwner: true }, "job-1", { db });
      assert.notEqual(result.stage, "completed");
      assert.notEqual(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "completed");
    } finally { database.close(); }
  }
});

test("an owner can close an unassigned unscheduled job with completed forms", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_work_orders SET assignee_member_id=''; UPDATE trade_job_forms SET status='complete'");
    assert.equal((await progress.reconcileTradeFormJobProgress({ ...progressAccess, isOwner: true }, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("ordinary unscheduled answers reconcile with three reads and exclude foreign job and owner forms", async (t) => {
  for (const isOwner of [true, false]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec(`DELETE FROM trade_crm_appointments;
        UPDATE trade_work_orders SET stage='in_progress';
        INSERT INTO trade_job_forms VALUES ('foreign-owner','job-1','owner-2','complete'),('foreign-job','job-2','owner-1','complete');
        INSERT INTO trade_rental_inspections VALUES ('foreign-rental-owner','job-1','owner-2','issued'),('foreign-rental-job','job-2','owner-1','issued')`);
      if (isOwner) database.exec("UPDATE trade_work_orders SET assignee_member_id=''");
      const statements = [], prepare = db.prepare.bind(db);
      t.mock.method(db, "prepare", sql => { statements.push(sql); return prepare(sql); });
      const result = await progress.reconcileTradeFormJobProgress({ ...progressAccess, isOwner }, "job-1", { db });
      assert.equal(result.stage, "in_progress"); assert.equal(result.changed, false);
      assert.equal(result.blockers[0].key, "visit");
      // Fresh job/visit authority, one form-state snapshot, then photo evidence.
      assert.equal(statements.length, 3);
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);

      database.exec("DELETE FROM trade_job_forms WHERE firebase_uid='owner-1' AND work_order_id='job-1'");
      statements.length = 0;
      const empty = await progress.reconcileTradeFormJobProgress({ ...progressAccess, isOwner }, "job-1", { db });
      assert.equal(empty.changed, false); assert.deepEqual(empty.blockers, []);
      assert.equal(statements.length, 2, "foreign forms cannot turn an empty job into work to reconcile");
    } finally { database.close(); }
  }
});

test("unscheduled combined form-state reads retain fresh authority and terminal boundaries", async (t) => {
  for (const { mutation, patch, expectedReads } of [
    { mutation: "", patch: { canManageFieldEvidence: false }, expectedReads: 0 },
    { mutation: "UPDATE trade_team_members SET status='inactive' WHERE id='member-1'", expectedReads: 1 },
    ...["imported", "completed", "cancelled"].map(stage => ({ mutation: `UPDATE trade_work_orders SET stage='${stage}'`, expectedReads: 1 })),
    { mutation: "UPDATE trade_crm_job_details SET pipeline_stage='lost'", expectedReads: 1 },
  ]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_job_forms SET status='complete';" + mutation);
      const before = { ...database.prepare("SELECT stage,revision FROM trade_work_orders").get() };
      let reads = 0;
      const prepare = db.prepare.bind(db);
      t.mock.method(db, "prepare", sql => { reads++; return prepare(sql); });
      const result = await progress.reconcileTradeFormJobProgress({ ...progressAccess, ...patch }, "job-1", { db });
      assert.equal(result.changed, false); assert.equal(reads, expectedReads);
      assert.deepEqual({ ...database.prepare("SELECT stage,revision FROM trade_work_orders").get() }, before);
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
    } finally { database.close(); }
  }
});

test("unscheduled completion rechecks combined snapshot facts and authority in its atomic write", async () => {
  for (const mutation of [
    "UPDATE trade_team_members SET status='inactive' WHERE id='member-1'",
    "UPDATE trade_team_members SET can_manage_field_evidence=0 WHERE id='member-1'",
    "UPDATE trade_work_orders SET assignee_member_id='member-2'",
    "UPDATE trade_work_orders SET revision=revision+1",
    "UPDATE trade_job_forms SET status='draft' WHERE id='form-1'",
    "DELETE FROM trade_job_forms",
  ]) {
    const { database, db, progress } = progressFixture();
    try {
      database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_job_forms SET status='complete'");
      db.setBeforeBatch(() => database.exec(mutation));
      const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db });
      assert.equal(result.changed, false); assert.equal(result.pending, true);
      assert.equal(result.blockers[0].key, "changed");
      assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
      assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
    } finally { database.close(); }
  }
});

test("combined form-state query failure cannot acknowledge successful job reconciliation", async (t) => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("DELETE FROM trade_crm_appointments; UPDATE trade_job_forms SET status='complete'");
    const prepare = db.prepare.bind(db);
    t.mock.method(db, "prepare", sql => {
      if (sql.includes("issued_rental")) throw new Error("Form-state snapshot unavailable");
      return prepare(sql);
    });
    t.mock.method(console, "error", () => {});
    await assert.rejects(progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db }), /snapshot unavailable/);
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db, afterSave: true });
    assert.equal(result.changed, false); assert.equal(result.pending, true);
    assert.equal(result.blockers[0].key, "job_progress_pending");
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
    assert.equal(database.prepare("SELECT COUNT(*) total FROM trade_work_order_events").get().total, 0);
  } finally { database.close(); }
});

test("waived work-plan requirements use the persisted not_needed state", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete';
      INSERT INTO trade_crm_job_plans VALUES ('plan','job-1','owner-1','in_progress','','');
      INSERT INTO trade_crm_job_plan_requirements VALUES ('waived','plan','owner-1','not_needed')`);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("a direct case's current work pack blocks closure until its signed final record exists", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete';
      INSERT INTO compliance_activity_work_pack_instances VALUES ('pack','org-1','case-1','job-1','','pack-key','version',1,'in_progress')`);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    database.exec("UPDATE compliance_activity_work_pack_instances SET status='completed'");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "in_progress");
    database.exec("INSERT INTO compliance_activity_work_pack_final_records VALUES ('final','org-1','pack-key','pack','version')");
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
  } finally { database.close(); }
});

test("a submitted modern activity form remains a valid alternative to the same case's older work pack", () => {
  const { database, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete';
      INSERT INTO trade_work_order_compliance_intents
        (id,work_order_id,intent_key,installer_uid,compliance_organisation_id,program_template_id,activity_template_id,
         program_code,registry_activity_code,planned_start,status,intent_snapshot,compliance_case_id,created_at)
        VALUES ('intent','job-1','intent','owner-1','org-1','sres','sres-ashp','SRES','','','case_linked','{}','case-1','');
      UPDATE compliance_cases SET compliance_intent_id='intent' WHERE id='case-1';
      INSERT INTO compliance_activity_work_pack_instances VALUES ('pack','org-1','case-1','job-1','intent','pack-key','version',1,'in_progress')`);
    const payload = { id: "modern", intentId: "intent", workOrderId: "job-1", ownerUid: "owner-1", organisationId: "org-1",
      revision: 1, status: "submitted_for_creditex_review", form: { activityTemplateId: "sres-ashp" } };
    database.prepare(`INSERT INTO trade_activity_field_records
      (id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,pdf_object_key,pdf_sha256,actor_uid,created_at,updated_at,submitted_at)
      VALUES ('modern','intent','job-1','owner-1','org-1','sres-ashp',1,'submitted_for_creditex_review',?,'signed.pdf',?,'actor-1','now','now','now')`)
      .run(JSON.stringify(payload), "a".repeat(64));
    const guard = progress.fieldCompletionGuard("owner-1", "job-1", { guard: { kind: "none" } });
    assert.equal(database.prepare(`SELECT 1 ready WHERE ${guard.sql}`).get(...guard.values).ready, 1);
  } finally { database.close(); }
});

test("the existing issued-rental exception can close a job while retaining ended appointments", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec(`UPDATE trade_job_forms SET status='complete'; UPDATE trade_crm_appointments SET status='cancelled';
      INSERT INTO trade_rental_inspections VALUES ('issued','job-1','owner-1','issued')`);
    assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db })).stage, "completed");
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments").get().status, "cancelled");
  } finally { database.close(); }
});

test("a failed post-save projection is explicitly pending while strict durable retries still fail", async (t) => {
  const { database, progress } = progressFixture();
  try {
    t.mock.method(console, "error", () => {});
    const offline = { prepare() { throw new Error("Database temporarily unavailable"); } };
    const result = await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db: offline, afterSave: true });
    assert.equal(result.pending, true); assert.equal(result.changed, false); assert.equal(result.stage, "");
    assert.equal(result.blockers[0].key, "job_progress_pending");
    await assert.rejects(progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db: offline }), /temporarily unavailable/);
  } finally { database.close(); }
});

function jobState(database) {
  return {
    job: {
      ...database.prepare(`SELECT stage, revision, updated_at
        FROM trade_work_orders WHERE id = 'job-1'`).get(),
    },
    appointment: {
      ...database.prepare(`SELECT status, completed_at, revision, updated_at
        FROM trade_crm_appointments WHERE id = 'appointment-1'`).get(),
    },
    receipts: database.prepare("SELECT COUNT(*) count FROM trade_offline_actions").get().count,
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
};

test("form reconciliation never restarts historical lost jobs even when their old work stage is active", async () => {
  const { database, db, progress } = progressFixture();
  try {
    database.exec("UPDATE trade_crm_job_details SET pipeline_stage='lost'; UPDATE trade_job_forms SET status='complete'");
    for (const startOnly of [true, false]) {
      assert.equal((await progress.reconcileTradeFormJobProgress(progressAccess, "job-1", { db, startOnly })).changed, false);
    }
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "scheduled");
    assert.equal(database.prepare("SELECT pipeline_stage FROM trade_crm_job_details").get().pipeline_stage, "lost");
  } finally { database.close(); }
});
}

test("imported history cannot start or finish field work or create execution records", async () => {
  const { database, route } = fixture();
  try {
    database.exec("UPDATE trade_work_orders SET stage='imported'");
    const before = jobState(database);
    const overview = await route.GET(new Request("https://example.test/api/trade-field-work?workOrderId=job-1"));
    const payload = await overview.json();
    assert.equal(payload.fieldJob.primaryAction, null);
    assert.equal(payload.fieldJob.completion.ready, false);
    assert.match(payload.fieldJob.actionUnavailableReason, /Start this imported job/);
    for (const body of [
      { action: "field_transition", transition: "finish", clientActionId: "imported-finish-1" },
      { action: "field_transition", transition: "start_work", clientActionId: "imported-start-1" },
      { action: "add_time", workDate: "2026-09-30", durationMinutes: 60 },
      { action: "add_signoff", signerRole: "technician", signerName: "Technician", confirmed: true },
    ]) {
      const response = await route.POST(new Request("https://example.test/api/trade-field-work", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workOrderId: "job-1", ...body }),
      }));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "IMPORTED_JOB_INACTIVE");
      assert.deepEqual(jobState(database), before);
    }
  } finally { database.close(); }
});

test("field signoff binds the exact assignment and job revision checked for training", async () => {
  for (const change of ["assignee_member_id = 'untrained-worker'", "revision = revision + 1", "record_status = 'archived'"]) {
    const { database, db, route } = fixture();
    try {
      db.setBeforeBatch(() => database.exec(`UPDATE trade_work_orders SET ${change} WHERE id = 'job-1'`));
      const response = await route.POST(new Request("https://example.test/api/trade-field-work", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add_signoff", workOrderId: "job-1", signerRole: "technician",
          signerName: "Field Technician", confirmed: true }),
      }));
      assert.equal(response.status, 409);
      assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_signoffs").get().count, 0);
      assert.equal(database.prepare("SELECT updated_at FROM trade_work_orders WHERE id = 'job-1'").get().updated_at, "initial");
    } finally { database.close(); }
  }
});

test("two governed cases block completion until every required requirement has submitted evidence", async () => {
  const { database, route } = fixture();
  const preflight = await route.GET(
    new Request("https://example.test/api/trade-field-work?workOrderId=job-1"),
  );
  assert.equal(preflight.status, 200);
  const preflightPayload = await preflight.json();
  assert.deepEqual(
    preflightPayload.fieldJob.blockers.filter((blocker) => blocker.key === "compliance"),
    [{
      key: "compliance",
      label: "1 governed evidence requirement is awaiting submitted evidence",
      target: "evidence",
    }],
  );

  const blocked = await route.POST(finishRequest("finish-incomplete-case"));
  assert.equal(blocked.status, 409);
  assert.deepEqual(jobState(database), {
    job: { stage: "in_progress", revision: 5, updated_at: "initial" },
    appointment: {
      status: "in_progress",
      completed_at: "",
      revision: 1,
      updated_at: "initial",
    },
    receipts: 0,
    events: 0,
  });

  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, original_sha256,
     supersedes_evidence_id, status)
    VALUES ('evidence-2', 'org-1', 'case-2', 'requirement-2',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       '', 'under_review')`).run();

  const completed = await route.POST(finishRequest("finish-complete-cases"));
  assert.equal(completed.status, 200);
  const completedState = jobState(database);
  assert.deepEqual({
    job: {
      stage: completedState.job.stage,
      revision: completedState.job.revision,
    },
    appointment: {
      status: completedState.appointment.status,
      revision: completedState.appointment.revision,
    },
    receipts: completedState.receipts,
    events: completedState.events,
  }, {
    job: { stage: "completed", revision: 6 },
    appointment: { status: "completed", revision: 2 },
    receipts: 1,
    events: 2,
  });
  assert.match(completedState.job.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(completedState.appointment.completed_at, completedState.job.updated_at);
  assert.equal(completedState.appointment.updated_at, completedState.job.updated_at);
});

test("submitted evidence removed after preflight cannot race through the atomic finish guard", async () => {
  const { database, db, route } = fixture();
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, original_sha256,
     supersedes_evidence_id, status)
    VALUES ('evidence-2', 'org-1', 'case-2', 'requirement-2',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '', 'accepted')`).run();
  db.setBeforeBatch(() => {
    database.prepare(`UPDATE compliance_case_evidence
      SET status = 'withdrawn' WHERE id = 'evidence-2'`).run();
  });

  const response = await route.POST(finishRequest("finish-evidence-race"));
  assert.equal(response.status, 409);
  assert.deepEqual(jobState(database), {
    job: { stage: "in_progress", revision: 5, updated_at: "initial" },
    appointment: {
      status: "in_progress",
      completed_at: "",
      revision: 1,
      updated_at: "initial",
    },
    receipts: 0,
    events: 0,
  });
});

test("photo proof changed after preflight cannot race through the atomic finish guard", async () => {
  const { database, db, route } = fixture();
  database.prepare(`INSERT INTO compliance_case_evidence
    (id, organisation_id, case_id, requirement_id, original_sha256,
     supersedes_evidence_id, status)
    VALUES ('evidence-2', 'org-1', 'case-2', 'requirement-2',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '', 'accepted')`).run();
  database.prepare(`INSERT INTO trade_crm_photo_requests
    (id, work_order_id, firebase_uid, revision, requirements, status)
    VALUES ('photo-request-1', 'job-1', 'owner-1', 1, '[]', 'completed')`).run();
  db.setBeforeBatch(() => {
    database.prepare(`UPDATE trade_crm_photo_requests
      SET revision = 2 WHERE id = 'photo-request-1'`).run();
  });

  const response = await route.POST(finishRequest("finish-photo-proof-race"));
  assert.equal(response.status, 409);
  assert.deepEqual(jobState(database), {
    job: { stage: "in_progress", revision: 5, updated_at: "initial" },
    appointment: {
      status: "in_progress",
      completed_at: "",
      revision: 1,
      updated_at: "initial",
    },
    receipts: 0,
    events: 0,
  });
});

function addSecondVisit(database, status = 'in_progress') {
  database.prepare(`INSERT INTO trade_crm_appointments
    (id,work_order_id,firebase_uid,status,starts_at,ends_at,travel_started_at,arrived_at,work_started_at,completed_at,last_transition_by_uid,revision,updated_at,assignee_member_id,assignee_label,notes)
    SELECT 'appointment-2',work_order_id,firebase_uid,?,starts_at,ends_at,'','','','','',1,'initial','member-2','Electrician','Electrical connection and testing'
    FROM trade_crm_appointments WHERE id='appointment-1'`).run(status);
}
function visitFinish(id, revision = 1, clientActionId = 'finish-' + id) {
  return new Request('https://example.test/api/trade-field-work', { method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'field_transition',transition:'finish',workOrderId:'job-1',appointmentId:id,baseAppointmentRevision:revision,clientActionId}) });
}
function clearEvidenceBlocker(database) {
  database.exec(`INSERT INTO compliance_case_evidence (id,organisation_id,case_id,requirement_id,original_sha256,supersedes_evidence_id,status)
    VALUES ('evidence-2','org-1','case-2','requirement-2','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','','accepted')`);
}

test('workers finish independently; final visit must clear shared job requirements', async () => {
  const {database, db, route}=fixture({isOwner:false,jobScope:'own'});
  try {
    addSecondVisit(database);
    const first=await route.POST(visitFinish('appointment-1')); assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
    const firstPayload=await first.json(); assert.equal(firstPayload.fieldJob.remainingActiveVisits,1);
    assert.equal(firstPayload.fieldJob.status,'completed'); assert.equal(jobState(database).job.stage,'in_progress');
    assert.equal(jobState(database).appointment.status,'completed');
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-2'").get().status,'in_progress');
    const electrician=loadRoute(db,{isOwner:false,jobScope:'own',memberId:'member-2',actorUid:'actor-2'});
    const blocked=await electrician.POST(visitFinish('appointment-2')); assert.equal(blocked.status,409);
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-2'").get().status,'in_progress');
    clearEvidenceBlocker(database);
    const last=await electrician.POST(visitFinish('appointment-2')); assert.equal(last.status,200,JSON.stringify(await last.clone().json()));
    assert.equal(jobState(database).job.stage,'completed');
    assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events WHERE event_type='job_completed'").get().count,1);
    const duplicate=await electrician.POST(visitFinish('appointment-2')); assert.equal(duplicate.status,200); assert.equal((await duplicate.json()).duplicate,true);
  } finally {database.close();}
});

test('multi-visit jobs require explicit visit selection and enforce the selected worker and revision', async () => {
  const {database,route}=fixture({isOwner:false,jobScope:'own'});
  try {
    addSecondVisit(database);
    const ambiguous=await route.POST(finishRequest('ambiguous')); assert.equal(ambiguous.status,409); assert.equal((await ambiguous.json()).code,'VISIT_SELECTION_REQUIRED');
    assert.equal((await route.POST(visitFinish('appointment-2'))).status,403);
    assert.equal((await route.POST(visitFinish('appointment-1',0))).status,409);
    assert.equal(jobState(database).receipts,0);
  } finally {database.close();}
});

test('a new visit or reassignment during finish rolls back the entire transition', async () => {
  for(const mutation of ['new_visit','reassignment']) {
    const {database,db,route}=fixture({isOwner:false,jobScope:'own'});
    try {
      clearEvidenceBlocker(database);
      db.setBeforeBatch(()=>mutation==='new_visit'?addSecondVisit(database):database.exec("UPDATE trade_crm_appointments SET assignee_member_id='member-2',revision=revision+1 WHERE id='appointment-1'"));
      const response=await route.POST(visitFinish('appointment-1')); assert.equal(response.status,409);
      assert.equal(jobState(database).job.stage,'in_progress'); assert.equal(jobState(database).receipts,0); assert.equal(jobState(database).events,0);
    } finally {database.close();}
  }
});

test('visit completion receipts cannot be replayed by another actor or for another visit',async()=>{
  const {database,db,route}=fixture();
  try {
    addSecondVisit(database);
    assert.equal((await route.POST(visitFinish('appointment-1',1,'shared-key'))).status,200);
    assert.equal((await route.POST(visitFinish('appointment-2',1,'shared-key'))).status,409);
    const other=loadRoute(db,{actorUid:'actor-2',memberId:'member-2'});
    assert.equal((await other.POST(visitFinish('appointment-1',1,'shared-key'))).status,409);
    assert.equal(jobState(database).receipts,1);
  } finally {database.close();}
});


test('finishing an early visit makes the shared job in progress without inventing another workers events',async()=>{
  const {database,route}=fixture();
  try {
    database.exec("UPDATE trade_work_orders SET stage='scheduled'; UPDATE trade_crm_appointments SET status='scheduled'");
    addSecondVisit(database,'scheduled');
    const response=await route.POST(visitFinish('appointment-1')); assert.equal(response.status,200);
    assert.equal(jobState(database).job.stage,'in_progress');
    assert.equal(database.prepare("SELECT status FROM trade_crm_appointments WHERE id='appointment-2'").get().status,'scheduled');
    assert.equal(database.prepare("SELECT work_started_at FROM trade_crm_appointments WHERE id='appointment-2'").get().work_started_at,'');
  } finally {database.close();}
});
