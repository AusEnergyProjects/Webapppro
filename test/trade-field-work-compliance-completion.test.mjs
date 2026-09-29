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
  installCreditexTrainingFixture(database);
  const db = testD1(database);
  return { database, db, route: loadRoute(db, accessPatch) };
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
}

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
