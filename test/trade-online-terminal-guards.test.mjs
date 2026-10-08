import * as crewHelpers from "../src/lib/trade-crews.ts";
import { installEmptyTradeCrews } from "./helpers/trade-crews-fixture.mjs";
import * as jobCollaboration from "../src/lib/trade-job-collaboration.ts";
import * as teamPresence from "../src/lib/trade-team-presence.ts";
import * as importLabels from "../src/lib/trade-import-labels.ts";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import { certificateTestDependency, installCreditexTrainingFixture } from "./helpers/creditex-training-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { ENERGY_SERVICE_IDS } from "../src/lib/energy-service-catalogue.mjs";
import * as lifecycleSql from "../src/lib/creditex-job-lifecycle-sql.ts";
import * as tradeFormLibrary from "../src/lib/trade-form-library.mjs";
import * as formActors from "../src/lib/trade-message-media-access.ts";
import * as rentalAssessment from "../src/lib/trade-rental-assessment.mjs";
import { lifecycleGuardDependency } from "./helpers/creditex-lifecycle-guards-fixture.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

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
    const prepared = this.database.prepare(this.sql);
    if (/^\s*SELECT\b/i.test(this.sql)) return { success: true, results: prepared.all(...this.values), meta: { changes: 0 } };
    const result = prepared.run(...this.values);
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

function loadTypescriptModule(path, mocks) {
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
    if (specifier === "@/lib/trade-form-job-progress") return { reconcileTradeFormJobProgress: async () => ({ changed: false, stage: "in_progress", blockers: [] }) };
    if (specifier === "@/lib/trade-crews") return crewHelpers;
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (/trade-job-collaboration(?:\.ts)?$/.test(specifier)) return jobCollaboration;
    if (certificateTestDependency(specifier)) return certificateTestDependency(specifier);
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

const syncHelpers = loadTypescriptModule(
  "../src/lib/trade-team-sync-server.ts",
  {},
);

function fixture(stage = "in_progress", revision = 5) {
  const database = new DatabaseSync(":memory:");
  installEmptyTradeCrews(database);
  database.exec(`
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      assignee_member_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'scheduled',
      revision integer NOT NULL DEFAULT 1, updated_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      partner_type text NOT NULL,
      source_type text NOT NULL,
      source_reference text NOT NULL,
      service_category text NOT NULL,
      record_status text NOT NULL,
      stage text NOT NULL,
      priority text NOT NULL,
      scheduled_start text NOT NULL,
      scheduled_end text NOT NULL,
      revision integer NOT NULL,
      assignee_member_id text NOT NULL,
      assignee_label text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      customer_source text NOT NULL DEFAULT 'internal',
      pipeline_stage text NOT NULL DEFAULT 'enquiry',
      crm_customer_id text NOT NULL DEFAULT '',
      quote_status text NOT NULL DEFAULT 'not_started'
    );
    CREATE TABLE trade_crm_quotes (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      work_order_id text NOT NULL,
      crm_customer_id text NOT NULL,
      current_version_number integer NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_quote_versions (
      id text PRIMARY KEY NOT NULL,
      quote_id text NOT NULL,
      firebase_uid text NOT NULL,
      version_number integer NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_quote_acceptances (
      quote_id text NOT NULL,
      quote_version_id text NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL,
      decision text NOT NULL
    );
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      member_uid text NOT NULL DEFAULT '',
      can_view_field_evidence integer NOT NULL DEFAULT 0,
      display_name text NOT NULL,
      capabilities text NOT NULL DEFAULT '[]',
      status text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      title text NOT NULL,
      due_at text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      completed_at text NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 1,
      sort_order integer NOT NULL DEFAULT 0,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_job_forms (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      template_key text NOT NULL,
      template_version integer NOT NULL,
      template_name text NOT NULL,
      jurisdiction text NOT NULL,
      template_snapshot text NOT NULL,
      answers text NOT NULL,
      status text NOT NULL,
      revision integer NOT NULL,
      completed_by_uid text NOT NULL,
      completed_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE (work_order_id, template_key, template_version)
    );
    CREATE TABLE trade_rental_inspections (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      assessor_uid text NOT NULL DEFAULT '',
      assessor_member_id text NOT NULL DEFAULT '',
      assessor_snapshot text NOT NULL DEFAULT '{}',
      revision integer NOT NULL DEFAULT 1,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_rental_inspection_modules (
      id text PRIMARY KEY NOT NULL,
      inspection_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL DEFAULT 'not_started',
      credential_snapshot text NOT NULL DEFAULT '{}',
      completed_by_uid text NOT NULL DEFAULT '',
      completed_at text NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 1,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      event_type text NOT NULL,
      summary text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_team_sync_changes (
      sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      operation text NOT NULL,
      revision integer NOT NULL,
      changed_at text NOT NULL
    );
    CREATE TABLE trade_mobile_push_outbox (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      audience_member_id text NOT NULL,
      event_key text NOT NULL UNIQUE,
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      payload text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      next_attempt_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  database.prepare(`INSERT INTO trade_work_orders
    (id, firebase_uid, partner_type, source_type, source_reference,
     service_category, record_status, stage, priority, scheduled_start, scheduled_end,
     revision, assignee_member_id, assignee_label, updated_at)
    VALUES ('job-1', 'owner-1', 'installer', 'internal', '',
      'other', 'active', ?, 'standard', '', '', ?, '', '', 'initial')`).run(stage, revision);
  database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, member_uid, display_name, capabilities, status)
    VALUES ('member-2', 'owner-1', 'member-2-uid', 'Technician Two', '["other"]', 'active')`).run();
  database.prepare(`INSERT INTO trade_work_order_tasks
    (id, work_order_id, firebase_uid, title, status, revision, created_at, updated_at)
    VALUES ('task-1', 'job-1', 'owner-1', 'Existing task', 'pending', 2, 'initial', 'initial')`).run();
  database.prepare(`INSERT INTO trade_job_forms
    (id, work_order_id, firebase_uid, template_key, template_version, template_name,
     jurisdiction, template_snapshot, answers, status, revision, completed_by_uid,
     completed_at, created_at, updated_at)
    VALUES ('form-1', 'job-1', 'owner-1', 'field-form', 1, 'Field form',
      'AU', '{"name":"Field form","fields":[]}', '{}', 'draft', 3, '', '', 'initial', 'initial')`).run();
  installCreditexTrainingFixture(database, { qualified: false });
  database.exec("INSERT INTO trade_accounts(firebase_uid,abn,business_name) VALUES ('owner-1','53004085616','Fixture Pty Ltd')");
  installCreditexTrainingFixture(database);
  return { database, db: testD1(database) };
}

const access = {
  ownerUid: "owner-1",
  actorUid: "actor-1",
  actorEmail: "actor@example.com",
  memberId: "member-1",
  displayName: "Actor",
  isOwner: true,
  businessName: "Installer",
  canManageJobs: true,
  canViewFieldEvidence: true,
  canManageFieldEvidence: true,
  jobScope: "team",
  scheduleScope: "team",
};

const adminServer = {
  mfaErrorResponse,
  adminJson: (value, status = 200) => Response.json(value, { status }),
  cleanAdminText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
  parseJsonList: (value) => {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  },
  sameOrigin: () => true,
};

function assignedJobFor(db) {
  return async (currentAccess, workOrderId) => {
    const row = await db.prepare(`SELECT id, source_type, source_reference,
        assignee_member_id, revision
      FROM trade_work_orders
      WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer'
        AND record_status = 'active'`)
      .bind(workOrderId, "owner-1").first();
    if (!row) throw new Error("JOB_NOT_FOUND");
    if (!currentAccess.isOwner && currentAccess.jobScope === "own"
      && row.assignee_member_id !== currentAccess.memberId) throw new Error("JOB_NOT_ASSIGNED");
    return row;
  };
}

function teamRoute(db) {
  return loadTypescriptModule("../src/app/api/trade-team/route.ts", {
    "@/lib/trade-team-presence": teamPresence,
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: "actor-1" }) },
    "@/lib/trade-team-invitation-server": {
      TradeTeamInvitationError: class extends Error {},
      acceptTradeTeamInvitation: async () => { throw new Error("Unexpected invitation acceptance in terminal job guard test"); },
      tradeTeamInviteTokenHash: async () => { throw new Error("Unexpected invitation creation in terminal job guard test"); },
    },
    "@/lib/trade-team-invitation-email": {
      sendTradeTeamInvitationEmail: async () => { throw new Error("Unexpected invitation email in terminal job guard test"); },
    },
    "@/lib/trade-team-server": {
      assignedJob: assignedJobFor(db),
      canAssignJob: () => true,
      canDispatch: () => true,
      canManageTeam: () => true,
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-mobile-device-revocation": { abortMemberDeviceUploads: async () => {} },
    "@/lib/trade-team-lifecycle-policy.mjs": {
      memberLifecycleDecision: () => ({ allowed: true, reason: "allowed" }),
    },
    "@/lib/trade-field-access-policy.mjs": {
      normalizeFieldAccessName: (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU").slice(0, 160),
    },
    "@/lib/trade-rental-schema-guards": {
      ensureTradeRentalSchemaGuards: async () => {},
    },
    "@/lib/trade-rental-assignment-server": {
      isRentalInspectionAssignmentConflict: () => false,
      rentalInspectionAssignmentStatements: () => [],
    },
  });
}

function workOrdersRoute(db, staffAccess = null) {
  class TradeAccessError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const scheduleServer = loadTypescriptModule("../src/lib/trade-schedule-server.ts", {
    "../../db": { getD1: () => db },
  });
  const cancellationServer = loadTypescriptModule("../src/lib/trade-job-cancellation-server.ts", {
    "./creditex-job-lifecycle-schema-guards": lifecycleGuardDependency(["trade_job_cancel_completion_history_guard"]),
    "./creditex-job-lifecycle-sql": lifecycleSql,
    "./trade-calendar-sync-server": { cancelAppointmentInConnectedCalendars: async () => { throw new Error("Unexpected external calendar call in terminal job guard test"); } },
  });
  return loadTypescriptModule("../src/app/api/trade-work-orders/route.ts", {
    "@/lib/trade-import-labels": importLabels,
    "@/lib/trade-job-cancellation-server": cancellationServer,
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/direct-trade-entitlements-server": {
      accountEntitlements: async () => ({
        features: { business_operations: true, team_access: true },
      }),
    },
    "@/lib/trade-access-server": {
      requireVerifiedTradeAccess: async () => staffAccess ? Promise.reject(new TradeAccessError("PROFILE_REQUIRED")) : ({
        identity: { uid: "owner-1" },
        partnerType: "installer",
        businessName: "Installer",
      }),
      TradeAccessError,
    },
    "@/lib/trade-job-number-server": {
      nextTlinkJobNumber: async () => "JOB-1",
      nextTradeWorkNumber: async () => "JOB-1",
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-schedule-server": scheduleServer,
    "@/lib/appointment-notification-server": {
      queueAppointmentNotifications: async () => {},
    },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: () => false,
      plannedComplianceIntentReplanStatements: async () => [],
    },
    "@/lib/energy-service-catalogue.mjs": { ENERGY_SERVICE_IDS },
    "@/lib/trade-team-server": {
      assignedJob: assignedJobFor(db),
      canManageJobs: (currentAccess) => currentAccess.isOwner || currentAccess.canManageJobs,
      requireInstallerTeamAccess: async () => staffAccess || access,
    },
  });
}

function formsRoute(db, actualLibrary = false) {
  const formLibrary = actualLibrary ? tradeFormLibrary : {
    normalizeTradeFormAnswers: (_template, answers) => answers || {},
    tradeFormCompletion: () => ({ ready: true, missing: [] }),
  };
  const formReader = loadTypescriptModule("../src/lib/trade-job-forms-server.ts", {
    "../../db": { getD1: () => db },
    "./trade-team-server": { assignedJob: assignedJobFor(db) },
    "./trade-form-library.mjs": formLibrary,
    "./trade-form-job-progress": { reconcileTradeFormJobProgress: async () => ({ changed: false, stage: "in_progress", blockers: [] }) },
    "./trade-team-sync-server": syncHelpers,
    "./asset-lifecycle.mjs": { addMonthsToIsoDate: () => "2027-01-01" },
  });
  return loadTypescriptModule("../src/app/api/trade-job-forms/route.ts", {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": adminServer,
    "@/lib/trade-team-server": {
      assignedJob: assignedJobFor(db),
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-form-library.mjs": formLibrary,
    "@/lib/trade-job-forms-server": formReader,
    "@/lib/trade-form-templates-server": {
      publishedTradeFormTemplate: async (key, version) => ({
        key,
        version,
        name: "New form",
        jurisdiction: "AU",
        fields: [],
      }),
      publishedTradeFormTemplatesFor: async () => [],
    },
    "@/lib/trade-job-form-attachment-server": loadTypescriptModule("../src/lib/trade-job-form-attachment-server.ts", {
      "./trade-form-templates-server": loadTypescriptModule("../src/lib/trade-form-templates-server.ts", {
        "../../db": { getD1: () => db }, "@/lib/trade-form-library.mjs": tradeFormLibrary,
      }),
      "./trade-message-media-access": formActors,
      "./trade-rental-assessment.mjs": rentalAssessment,
    }),
    "@/lib/asset-lifecycle.mjs": {
      addMonthsToIsoDate: () => "2027-01-01",
    },
  });
}

function preStartFormFixture() {
  const f = fixture(), template = tradeFormLibrary.tradeFormTemplate("pre-start-risk-readiness", 1, "other");
  assert.equal(template.fields.length, 6);
  f.database.prepare("UPDATE trade_job_forms SET template_key=?,template_name=?,template_snapshot=? WHERE id='form-1'")
    .run(template.key, template.name, JSON.stringify(template));
  return { ...f, template, route: formsRoute(f.db, true) };
}

test("actual pre-start PATCH saves all six spoken answers including the date, then completes separately and replays without another write", async () => {
  const { database, route } = preStartFormFixture();
  try {
    const answers = {}, supplied = { work_date: "2026-10-07", technician: "Alex Example", access_confirmed: true,
      isolation_confirmed: true, hazards: "Work area isolated and clear", changes: "No scope changes" };
    let revision = 3;
    for (const [key, value] of Object.entries(supplied)) {
      answers[key] = value;
      const response = await route.PATCH(patchRequest({ workOrderId: "job-1", formId: "form-1", baseRevision: revision, answers, complete: false }));
      const payload = await response.json(); assert.equal(response.status, 200, JSON.stringify(payload));
      const form = payload.forms.find(item => item.id === "form-1");
      revision++; assert.equal(form.revision, revision); assert.equal(form.status, "draft"); assert.equal(form.answers[key], value);
      assert.equal(JSON.parse(database.prepare("SELECT answers FROM trade_job_forms WHERE id='form-1'").get().answers)[key], value);
    }
    assert.equal(database.prepare("SELECT count(*) n FROM trade_work_order_events WHERE event_type='field_form_saved'").get().n, 6);
    const completeRequest = { workOrderId: "job-1", formId: "form-1", baseRevision: revision, answers, complete: true };
    const completed = await route.PATCH(patchRequest(completeRequest)); const payload = await completed.json();
    assert.equal(completed.status, 200, JSON.stringify(payload)); assert.equal(payload.forms[0].status, "complete"); assert.equal(payload.forms[0].revision, revision + 1);
    assert.deepEqual(payload.forms[0].answers, supplied); assert.equal(payload.forms[0].ready, true);
    const retained = database.prepare("SELECT * FROM trade_job_forms WHERE id='form-1'").get(), before = mutationState(database);
    assert.equal(retained.completed_by_uid, access.actorUid); assert.ok(retained.completed_at);
    const retry = await route.PATCH(patchRequest(completeRequest)); assert.equal(retry.status, 200); assert.equal((await retry.json()).duplicate, true);
    assert.deepEqual(mutationState(database), before);
    assert.equal(database.prepare("SELECT count(*) n FROM trade_work_order_events WHERE event_type='field_form_completed'").get().n, 1);
  } finally { database.close(); }
});

test("actual form privacy gate still blocks phones, emails and date-like text outside canonical date fields without writes", async () => {
  for (const [key, value] of [["technician", "0412345678"], ["hazards", "Phone +61 412 345 678"], ["changes", "Call (03) 9123 4567"],
    ["hazards", "Contact customer@example.test"], ["changes", "2026-10-07"], ["technician", "04-1234-5678"]]) {
    const { database, route } = preStartFormFixture();
    try {
      const before = mutationState(database), response = await route.PATCH(patchRequest({ workOrderId: "job-1", formId: "form-1", baseRevision: 3,
        answers: { work_date: "2026-10-07", [key]: value }, complete: false }));
      assert.equal(response.status, 400); assert.match((await response.json()).error, /Keep customer contact details/); assert.deepEqual(mutationState(database), before);
    } finally { database.close(); }
  }
});

test("date exemption follows canonical date normalization and cannot store an invalid date or contact data in a date field", async () => {
  for (const date of ["2026-02-30", "2026-10-07 0412345678", "0412345678", "customer@example.test", "07/10/2026"]) {
    const { database, route } = preStartFormFixture();
    try {
      const before = mutationState(database), response = await route.PATCH(patchRequest({ workOrderId: "job-1", formId: "form-1", baseRevision: 3,
        answers: { work_date: date, technician: "Alex", access_confirmed: true, isolation_confirmed: true, hazards: "Clear", changes: "None" }, complete: true }));
      assert.equal(response.status, 400); assert.match((await response.json()).error, /Complete the required fields/); assert.deepEqual(mutationState(database), before);
    } finally { database.close(); }
  }
  const { database, route } = preStartFormFixture();
  try {
    const response = await route.PATCH(patchRequest({ workOrderId: "job-1", formId: "form-1", baseRevision: 3, answers: { work_date: "2028-02-29" }, complete: false }));
    assert.equal(response.status, 200); assert.equal((await response.json()).forms[0].answers.work_date, "2028-02-29");
  } finally { database.close(); }
});

test("form payload reads exact scoped work and answer rows in one ordered two-statement batch", async () => {
  const { database, db } = preStartFormFixture();
  try {
    database.exec("INSERT INTO trade_job_forms SELECT 'foreign-form',work_order_id,'foreign-owner','foreign-template',template_version,template_name,jurisdiction,template_snapshot,'{\"private\":\"do not expose\"}',status,revision,completed_by_uid,completed_at,created_at,updated_at FROM trade_job_forms WHERE id='form-1'");
    const batches = [], original = db.batch;
    db.batch = async statements => { batches.push(statements); return original(statements); };
    const route = formsRoute(db, true), response = await route.GET(new Request("https://example.test/api/trade-job-forms?workOrderId=job-1"));
    const payload = await response.json(); assert.equal(response.status, 200); assert.deepEqual(payload.forms.map(item => item.id), ["form-1"]);
    assert.equal(batches.length, 1); assert.equal(batches[0].length, 2);
    assert.match(batches[0][0].sql, /SELECT w\.id, w\.service_category/); assert.match(batches[0][1].sql, /FROM trade_job_forms WHERE work_order_id = \? AND firebase_uid = \?/);
    assert.deepEqual(batches[0].map(item => item.values), [["job-1", "owner-1"], ["job-1", "owner-1"]]);
    assert.doesNotMatch(JSON.stringify(payload), /do not expose/);
  } finally { database.close(); }
});

test("cancelling during the canonical form read never starts a mutation or progress reconciliation", async () => {
  const { database, db } = preStartFormFixture();
  try {
    const controller = new AbortController(), originalPrepare = db.prepare;
    const before = mutationState(database);
    db.prepare = sql => {
      const statement = originalPrepare(sql);
      if (!sql.includes("SELECT form.id, form.template_key")) return statement;
      return { bind(...values) {
        const bound = statement.bind(...values);
        return { async first() { const row = await bound.first(); controller.abort(); return row; } };
      } };
    };
    const response = await formsRoute(db, true).PATCH(new Request(patchRequest({ workOrderId: "job-1", formId: "form-1", baseRevision: 3,
      answers: { work_date: "2026-10-08", technician: "Alex Example" }, complete: false }), { signal: controller.signal }));
    assert.equal(response.status, 500);
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(mutationState(database), before);
  } finally { database.close(); }
});

test("form payload batch failures and malformed results fail closed, while missing current work retains not-found precedence", async () => {
  for (const fault of ["throw", "missing", "failed-work", "failed-forms", "malformed-forms", "missing-work"]) {
    const { database, db } = preStartFormFixture();
    try {
      const original = db.batch;
      db.batch = async statements => {
        if (fault === "throw") throw new Error("D1 unavailable");
        if (fault === "missing") return [];
        const results = await original(statements);
        if (fault === "failed-work") results[0].success = false;
        if (fault === "failed-forms") results[1].success = false;
        if (fault === "malformed-forms") results[1].results = null;
        if (fault === "missing-work") { results[0].results = []; results[1] = undefined; }
        return results;
      };
      const response = await formsRoute(db, true).GET(new Request("https://example.test/api/trade-job-forms?workOrderId=job-1"));
      const payload = await response.json(); assert.equal(response.status, fault === "missing-work" ? 404 : 500); assert.equal(payload.ok, false); assert.equal(payload.forms, undefined);
      assert.equal(database.prepare("SELECT count(*) n FROM trade_work_order_events").get().n, 0);
    } finally { database.close(); }
  }
});

const patchRequest = (body) => new Request("https://example.test/api", {
  method: "PATCH",
  body: JSON.stringify(body),
});

const postRequest = (body) => new Request("https://example.test/api", {
  method: "POST",
  body: JSON.stringify(body),
});

function mutationState(database) {
  return {
    job: { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    task: { ...database.prepare(`SELECT status, revision, updated_at
      FROM trade_work_order_tasks WHERE id = 'task-1'`).get() },
    form: { ...database.prepare(`SELECT answers, status, revision, updated_at
      FROM trade_job_forms WHERE id = 'form-1'`).get() },
    tasks: database.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks").get().count,
    forms: database.prepare("SELECT COUNT(*) count FROM trade_job_forms").get().count,
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    syncChanges: database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
  };
}

function directJobState(database) {
  return {
    job: {
      ...database.prepare(`SELECT stage, priority, scheduled_start, scheduled_end,
          revision, assignee_member_id, assignee_label, updated_at
        FROM trade_work_orders WHERE id = 'job-1'`).get(),
    },
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    syncChanges: database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
  };
}

const onlineMutations = [
  {
    name: "team task update",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "update_task",
      taskId: "task-1",
      status: "done",
    })),
  },
  {
    name: "Business Hub task update",
    run: (db) => workOrdersRoute(db).PATCH(patchRequest({
      action: "update_task",
      taskId: "task-1",
      status: "done",
    })),
  },
  {
    name: "Business Hub task creation",
    run: (db) => workOrdersRoute(db).POST(postRequest({
      action: "add_task",
      workOrderId: "job-1",
      title: "New task",
    })),
  },
  {
    name: "field form update",
    run: (db) => formsRoute(db).PATCH(patchRequest({
      workOrderId: "job-1",
      formId: "form-1",
      baseRevision: 3,
      answers: { note: "updated" },
    })),
  },
  {
    name: "field form creation",
    run: (db) => formsRoute(db).POST(postRequest({
      workOrderId: "job-1",
      templateKey: "new-form",
      templateVersion: 1,
    })),
  },
];

test("staff with job management can add and toggle checklist items on an own-scoped job", async () => {
  const { database, db } = fixture();
  database.prepare("UPDATE trade_work_orders SET assignee_member_id = 'member-1' WHERE id = 'job-1'").run();
  const staffAccess = { ...access, isOwner: false, canManageJobs: true, jobScope: "own" };
  const route = workOrdersRoute(db, staffAccess);
  const added = await route.POST(postRequest({ action: "add_task", workOrderId: "job-1", title: "Staff task" }));
  assert.equal(added.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks").get().count, 2);
  const updated = await route.PATCH(patchRequest({ action: "update_task", taskId: "task-1", status: "done" }));
  assert.equal(updated.status, 200);
  assert.equal(database.prepare("SELECT status FROM trade_work_order_tasks WHERE id = 'task-1'").get().status, "done");
});

test("own-scoped staff cannot mutate another team member's checklist", async () => {
  const { database, db } = fixture();
  database.prepare("UPDATE trade_work_orders SET assignee_member_id = 'member-2' WHERE id = 'job-1'").run();
  const staffAccess = { ...access, isOwner: false, canManageJobs: true, jobScope: "own" };
  const response = await workOrdersRoute(db, staffAccess).POST(postRequest({
    action: "add_task", workOrderId: "job-1", title: "Unauthorised task",
  }));
  assert.equal(response.status, 403);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks").get().count, 1);
});

test("team-scoped checklist management still requires the management permission", async () => {
  const { database, db } = fixture();
  database.prepare("UPDATE trade_work_orders SET assignee_member_id = 'member-2' WHERE id = 'job-1'").run();
  const permitted = { ...access, isOwner: false, canManageJobs: true, jobScope: "team" };
  assert.equal((await workOrdersRoute(db, permitted).POST(postRequest({
    action: "add_task", workOrderId: "job-1", title: "Team task",
  }))).status, 200);
  const denied = { ...permitted, canManageJobs: false };
  assert.equal((await workOrdersRoute(db, denied).PATCH(patchRequest({
    action: "update_task", taskId: "task-1", status: "done",
  }))).status, 403);
});

for (const stage of ["imported", "completed", "cancelled"]) {
  for (const mutation of onlineMutations) {
    test(`${mutation.name} rejects an initially ${stage} job without writes`, async () => {
      const { database, db } = fixture(stage);
      const before = mutationState(database);
      const response = await mutation.run(db);
      assert.equal(response.status, 409);
      assert.deepEqual(mutationState(database), before);
    });
  }
}

test("owner job bin preserves records and restores the same job with revision checks", async () => {
  const { database, db } = fixture("imported");
  try {
    database.exec("INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source,pipeline_stage) VALUES('job-1','owner-1','trade_owned','imported')");
    const route = workOrdersRoute(db);
    const change = (action, expectedRevision) => route.PATCH(new Request("https://example.test/api/trade-work-orders", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, workOrderId: "job-1", expectedRevision }),
    }));
    const stale = await change("archive_crm_job", 4);
    assert.equal(stale.status, 409);
    assert.equal(database.prepare("SELECT record_status FROM trade_work_orders").get().record_status, "active");
    const archived = await change("archive_crm_job", 5);
    assert.equal(archived.status, 200);
    assert.deepEqual(await archived.json(), { ok: true, recordStatus: "archived", revision: 6 });
    assert.equal(database.prepare("SELECT stage FROM trade_work_orders").get().stage, "imported");
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_job_forms").get().n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_work_order_tasks").get().n, 1);
    const restored = await change("restore_crm_job", 6);
    assert.equal(restored.status, 200);
    assert.deepEqual(await restored.json(), { ok: true, recordStatus: "active", revision: 7 });
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 2);
  } finally { database.close(); }
});

test("job bin rejects another owner and protected customer work", async () => {
  for (const [owner, source] of [["other-owner", "trade_owned"], ["owner-1", "platform_private"]]) {
    const { database, db } = fixture();
    try {
      database.prepare("INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES('job-1',?,?)").run(owner, source);
      const response = await workOrdersRoute(db).PATCH(new Request("https://example.test/api/trade-work-orders", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive_crm_job", workOrderId: "job-1", expectedRevision: 5 }),
      }));
      assert.equal(response.status, 409);
      assert.equal(database.prepare("SELECT record_status FROM trade_work_orders").get().record_status, "active");
      assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 0);
    } finally { database.close(); }
  }
});

test("job bin rolls back events and sync when a concurrent edit wins", async () => {
  const { database, db } = fixture();
  try {
    database.exec("INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES('job-1','owner-1','trade_owned')");
    db.setBeforeBatch(() => database.exec("UPDATE trade_work_orders SET revision=6"));
    const response = await workOrdersRoute(db).PATCH(new Request("https://example.test/api/trade-work-orders", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive_crm_job", workOrderId: "job-1", expectedRevision: 5 }),
    }));
    assert.equal(response.status, 409);
    assert.equal(database.prepare("SELECT record_status FROM trade_work_orders").get().record_status, "active");
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_work_order_events").get().n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM trade_team_sync_changes").get().n, 0);
  } finally { database.close(); }
});

for (const mutation of onlineMutations) {
  test(`${mutation.name} rolls back child, parent, event and sync writes on a job race`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_orders
        SET stage = 'completed', revision = 9, updated_at = 'concurrent'
        WHERE id = 'job-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "REVISION_CONFLICT");
    assert.deepEqual(mutationState(database), {
      job: { stage: "completed", revision: 9, updated_at: "concurrent" },
      task: { status: "pending", revision: 2, updated_at: "initial" },
      form: { answers: "{}", status: "draft", revision: 3, updated_at: "initial" },
      tasks: 1,
      forms: 1,
      events: 0,
      syncChanges: 0,
    });
  });
}

for (const mutation of onlineMutations.slice(0, 2)) {
  test(`${mutation.name} preserves a concurrent task revision without partial parent writes`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_order_tasks
        SET status = 'done', revision = 7, updated_at = 'concurrent'
        WHERE id = 'task-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    assert.deepEqual(mutationState(database), {
      job: { stage: "in_progress", revision: 5, updated_at: "initial" },
      task: { status: "done", revision: 7, updated_at: "concurrent" },
      form: { answers: "{}", status: "draft", revision: 3, updated_at: "initial" },
      tasks: 1,
      forms: 1,
      events: 0,
      syncChanges: 0,
    });
  });
}

test("field form update preserves a concurrent form revision without partial parent writes", async () => {
  const { database, db } = fixture();
  db.setBeforeBatch(() => {
    database.prepare(`UPDATE trade_job_forms
      SET answers = '{"note":"concurrent"}', revision = 8, updated_at = 'concurrent'
      WHERE id = 'form-1'`).run();
  });
  const response = await onlineMutations[3].run(db);
  assert.equal(response.status, 409);
  assert.deepEqual(mutationState(database), {
    job: { stage: "in_progress", revision: 5, updated_at: "initial" },
    task: { status: "pending", revision: 2, updated_at: "initial" },
    form: {
      answers: '{"note":"concurrent"}',
      status: "draft",
      revision: 8,
      updated_at: "concurrent",
    },
    tasks: 1,
    forms: 1,
    events: 0,
    syncChanges: 0,
  });
});

test("field form creation preserves a concurrent equivalent form without advancing the parent", async () => {
  const { database, db } = fixture();
  db.setBeforeBatch(() => {
    database.prepare(`INSERT INTO trade_job_forms
      (id, work_order_id, firebase_uid, template_key, template_version, template_name,
       jurisdiction, template_snapshot, answers, status, revision, completed_by_uid,
       completed_at, created_at, updated_at)
      VALUES ('concurrent-form', 'job-1', 'owner-1', 'new-form', 1, 'New form',
        'AU', '{"name":"New form","fields":[]}', '{}', 'draft', 1, '', '',
        'concurrent', 'concurrent')`).run();
  });
  const response = await onlineMutations[4].run(db);
  assert.equal(response.status, 409);
  const state = mutationState(database);
  assert.deepEqual(state.job, {
    stage: "in_progress",
    revision: 5,
    updated_at: "initial",
  });
  assert.equal(state.forms, 2);
  assert.equal(state.events, 0);
  assert.equal(state.syncChanges, 0);
  assert.deepEqual(
    {
      ...database.prepare(`SELECT revision, updated_at FROM trade_job_forms
        WHERE id = 'concurrent-form'`).get(),
    },
    { revision: 1, updated_at: "concurrent" },
  );
});

const directJobMutations = [
  {
    name: "team assignment",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "assign_job",
      workOrderId: "job-1",
      memberId: "member-2",
    })),
  },
  {
    name: "team stage update",
    run: (db) => teamRoute(db).PATCH(patchRequest({
      action: "update_job",
      workOrderId: "job-1",
      stage: "ready",
    })),
  },
  {
    name: "Business Hub job update",
    run: (db) => workOrdersRoute(db).PATCH(patchRequest({
      action: "update_work_order",
      workOrderId: "job-1",
      stage: "ready",
      priority: "high",
      scheduledStart: "2026-08-10",
      scheduledEnd: "2026-08-11",
      assigneeLabel: "Technician Two",
    })),
  },
];

test("rental Team reassignment rejects an active appointment before assignment writes", () => {
  const source = read("../src/app/api/trade-team/route.ts");
  const guardStart = source.indexOf("if (rentalInspection) {");
  const assignmentBatchStart = source.indexOf("await guardedOnlineJobMutationBatch", guardStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(assignmentBatchStart, -1);

  const guard = source.slice(guardStart, assignmentBatchStart);
  assert.match(guard, /job\.assignee_member_id[\s\S]*!== memberId/);
  assert.match(guard, /FROM trade_crm_appointments[\s\S]*status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\)/);
  assert.match(guard, /if \(activeAppointment\) throw new Error\("RENTAL_ACTIVE_APPOINTMENT"\)/);
  assert.match(source, /if \(code === "RENTAL_ACTIVE_APPOINTMENT"\)[^\n]*, 409\)/);
});

test("rental Business Hub schedule and crew mutations require the Schedule workflow", () => {
  const source = read("../src/app/api/trade-work-orders/route.ts");
  const guardStart = source.indexOf(`if (String(current.service_category || "") === "rental-inspection"`);
  const updateStart = source.indexOf("const requestedStage", guardStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(updateStart, -1);

  const guard = source.slice(guardStart, updateStart);
  assert.match(guard, /body\.assigneeLabel !== undefined/);
  assert.match(guard, /body\.scheduledStart !== undefined/);
  assert.match(guard, /body\.scheduledEnd !== undefined/);
  assert.match(guard, /throw new Error\("RENTAL_SCHEDULE_WORKFLOW_REQUIRED"\)/);
  assert.match(source, /if \(code === "RENTAL_SCHEDULE_WORKFLOW_REQUIRED"\)[^\n]*, 409\)/);
});

test("Business Hub schedule update rejects a job that fails the scheduling eligibility precheck", async () => {
  const { database, db } = fixture();
  database.prepare("UPDATE trade_work_orders SET source_type = 'opportunity' WHERE id = 'job-1'").run();

  const response = await workOrdersRoute(db).PATCH(patchRequest({
    action: "update_work_order",
    workOrderId: "job-1",
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-11",
  }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /accept the current Australian Energy Assessments quote/i);
  assert.deepEqual({ ...database.prepare(`SELECT scheduled_start, scheduled_end, revision
    FROM trade_work_orders WHERE id = 'job-1'`).get() }, {
    scheduled_start: "",
    scheduled_end: "",
    revision: 5,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
});

test("Business Hub schedule update rolls back when eligibility changes after its precheck", async () => {
  const { database, db } = fixture();
  db.setBeforeBatch(() => {
    database.prepare("UPDATE trade_work_orders SET source_type = 'opportunity' WHERE id = 'job-1'").run();
  });

  const response = await workOrdersRoute(db).PATCH(patchRequest({
    action: "update_work_order",
    workOrderId: "job-1",
    scheduledStart: "2026-08-10",
    scheduledEnd: "2026-08-11",
  }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /accept the current Australian Energy Assessments quote/i);
  assert.deepEqual({ ...database.prepare(`SELECT source_type, scheduled_start, scheduled_end, revision
    FROM trade_work_orders WHERE id = 'job-1'`).get() }, {
    source_type: "opportunity",
    scheduled_start: "",
    scheduled_end: "",
    revision: 5,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count, 0);
});

for (const stage of ["imported", "completed", "cancelled"]) {
  for (const mutation of directJobMutations) {
    test(`${mutation.name} cannot edit or reopen an initially ${stage} job`, async () => {
      const { database, db } = fixture(stage);
      const before = directJobState(database);
      const response = await mutation.run(db);
      assert.equal(response.status, 409);
      assert.deepEqual(directJobState(database), before);
    });
  }
}

for (const mutation of directJobMutations) {
  test(`${mutation.name} rolls back events and sync writes when the job becomes terminal`, async () => {
    const { database, db } = fixture();
    db.setBeforeBatch(() => {
      database.prepare(`UPDATE trade_work_orders
        SET stage = 'completed', revision = 9, updated_at = 'concurrent'
        WHERE id = 'job-1'`).run();
    });
    const response = await mutation.run(db);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "REVISION_CONFLICT");
    assert.deepEqual(directJobState(database), {
      job: {
        stage: "completed",
        priority: "standard",
        scheduled_start: "",
        scheduled_end: "",
        revision: 9,
        assignee_member_id: "",
        assignee_label: "",
        updated_at: "concurrent",
      },
      events: 0,
      syncChanges: 0,
    });
  });
}


for (const [name, loader, action] of [['Team', teamRoute, 'update_job'], ['Business Hub', workOrdersRoute, 'update_work_order']]) {
  for(const concurrent of [false,true]) test(name+' completion refuses an open visit'+(concurrent?' created during commit':''),async()=>{
    const {database,db}=fixture();
    try {
      const addVisit=()=>database.exec("INSERT INTO trade_crm_appointments(id,work_order_id,firebase_uid,assignee_member_id,status) VALUES('other-visit','job-1','owner-1','member-2','in_progress')");
      if(concurrent) db.setBeforeBatch(addVisit); else addVisit();
      const before=mutationState(database);
      const response=await loader(db).PATCH(patchRequest({action,workOrderId:'job-1',stage:'completed'}));
      assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
      assert.deepEqual(mutationState(database),before);
    } finally {database.close();}
  });
}
