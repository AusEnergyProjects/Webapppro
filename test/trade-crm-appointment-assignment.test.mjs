import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { canAssignWithinScope } from "../src/lib/trade-team-permission-policy.mjs";

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

function loadTypescriptModule(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : {};
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY NOT NULL,
      address_state text NOT NULL
    );
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      partner_type text NOT NULL,
      source_type text NOT NULL,
      work_number text NOT NULL,
      title text NOT NULL,
      service_category text NOT NULL,
      record_status text NOT NULL,
      revision integer NOT NULL,
      stage text NOT NULL,
      site_area text NOT NULL,
      priority text NOT NULL,
      scheduled_start text NOT NULL,
      scheduled_end text NOT NULL,
      assignee_member_id text NOT NULL,
      assignee_label text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL,
      service_site_id text NOT NULL,
      customer_source text NOT NULL,
      pipeline_stage text NOT NULL,
      building_type text NOT NULL,
      description text NOT NULL,
      customer_reference text NOT NULL,
      next_action text NOT NULL,
      tags text NOT NULL,
      estimated_value_cents integer NOT NULL,
      quoted_value_cents integer NOT NULL,
      invoiced_value_cents integer NOT NULL,
      paid_value_cents integer NOT NULL,
      quote_status text NOT NULL,
      invoice_status text NOT NULL,
      payment_due_at text NOT NULL
      , updated_at text NOT NULL DEFAULT ''
      , accepted_disclosure_snapshot text NOT NULL DEFAULT '{}'
      , accepted_disclosure_sha256 text NOT NULL DEFAULT ''
      , accepted_disclosure_at text NOT NULL DEFAULT ''
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      customer_number text NOT NULL,
      business_name text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      record_status text NOT NULL
    );
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY NOT NULL,
      owner_uid text NOT NULL,
      member_uid text NOT NULL,
      display_name text NOT NULL,
      capabilities text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      appointment_type text NOT NULL,
      title text NOT NULL,
      starts_at text NOT NULL,
      ends_at text NOT NULL,
      assignee_member_id text NOT NULL,
      assignee_label text NOT NULL,
      status text NOT NULL,
      notes text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_tasks (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      title text NOT NULL,
      due_at text NOT NULL,
      status text NOT NULL,
      completed_at text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_notes (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      note_type text NOT NULL,
      body text NOT NULL,
      issue_status text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL,
      customer_id text NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      is_primary integer NOT NULL,
      site_label text NOT NULL
    );
    CREATE TABLE trade_crm_customer_contacts (
      id text PRIMARY KEY NOT NULL,
      customer_id text NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      email text NOT NULL,
      phone text NOT NULL
    );
    CREATE TABLE trade_crm_site_contacts (
      id text PRIMARY KEY NOT NULL,
      service_site_id text NOT NULL,
      customer_contact_id text NOT NULL,
      firebase_uid text NOT NULL,
      record_status text NOT NULL
    );
    CREATE TABLE trade_handover_packs (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE compliance_cases (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      case_number text NOT NULL,
      activity_date text NOT NULL,
      activity_snapshot text NOT NULL,
      status text NOT NULL,
      evidence_status text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_compliance_intents (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      installer_uid text NOT NULL,
      status text NOT NULL,
      intent_key text NOT NULL,
      revision integer NOT NULL,
      created_at text NOT NULL
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
    INSERT INTO trade_accounts VALUES ('owner-1', 'VIC');
    INSERT INTO trade_crm_customers VALUES ('customer-1', 'owner-1', 'CUS-1', '', 'Alex', 'Customer', 'active');
    INSERT INTO trade_work_orders VALUES (
      'job-1', 'owner-1', 'installer', 'public_lead', 'JOB-1', 'Alex hot water', 'hot-water', 'active', 3, 'ready',
      '', 'standard', '', '', 'member-a', 'Assigned worker', '2026-01-01', '2026-01-01'
    );
    INSERT INTO trade_crm_job_details VALUES (
      'job-1', 'owner-1', 'customer-1', '', 'public_lead_released', 'quoting', 'not_sure',
      'Customer disclosed details', '', '', '[]', 0, 0, 0, 0, 'draft', 'not_started', '', '',
      '{"contract":"tlink-public-lead-accepted-disclosure-v1"}',
      '${"a".repeat(64)}', '2026-01-01T00:00:00.000Z'
    );
    INSERT INTO trade_team_members VALUES (
      'member-a', 'owner-1', 'actor-1', 'Assigned worker', '["hot-water"]', 'active'
    );
    INSERT INTO trade_team_members VALUES (
      'member-b', 'owner-1', 'actor-2', 'Other worker', '["hot-water"]', 'active'
    );
  `);
  return { database, d1: testD1(database) };
}

function access(overrides = {}) {
  return {
    ownerUid: "owner-1",
    actorUid: "actor-1",
    actorEmail: "worker@example.test",
    memberId: "member-a",
    displayName: "Assigned worker",
    businessName: "Installer business",
    isOwner: false,
    canCreateJobs: false,
    canManageJobs: false,
    canAssignJobs: false,
    jobScope: "own",
    canViewCustomers: false,
    canManageCustomers: false,
    canViewQuotes: false,
    canManageQuotes: false,
    canSendQuotes: false,
    canViewInvoices: false,
    canManageInvoices: false,
    canViewPriceBook: false,
    canManagePriceBook: false,
    canApplyDiscounts: false,
    scheduleScope: "team",
    canRescheduleJobs: true,
    canManageTeam: false,
    canEditTeamPermissions: false,
    canViewFieldEvidence: false,
    canManageFieldEvidence: false,
    canRunReports: false,
    canSearchCustomers: false,
    ...overrides,
  };
}

function crmRoute(d1, actorAccess) {
  class TradeAccessError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  class DomainError extends Error {}
  const adminJson = (body, status = 200) => Response.json(body, { status });
  const syncHelpers = loadTypescriptModule("../src/lib/trade-team-sync-server.ts", {});
  return loadTypescriptModule("../src/app/api/trade-crm/route.ts", {
    "../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson,
      cleanAdminText: (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "",
      sameOrigin: () => true,
    },
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-team-server": {
      assignedJob: async () => ({ id: "job-1" }),
      canAssignJob: (currentAccess, fromMemberId, toMemberId) => canAssignWithinScope(currentAccess, fromMemberId, toMemberId),
      canCreateJobs: (currentAccess) => currentAccess.isOwner || currentAccess.canCreateJobs,
      canManageJobs: (currentAccess) => currentAccess.isOwner || currentAccess.canManageJobs,
      requireInstallerTeamAccess: async () => actorAccess,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-schedule": {
      appointmentEndsAt: () => "2099-01-02T11:00:00.000Z",
      assertAppointmentSlot: () => {},
      assertFutureAppointment: () => {},
      australiaLocalDateTime: () => "2099-01-01T00:00",
    },
    "@/lib/creditex-compliance-server": { ComplianceDomainError: DomainError },
    "@/lib/trade-compliance-intent": {
      CREDITEX_PARTNER_ORGANISATION_CODE: "",
      resolveTradeComplianceIntents: () => [],
      stableTradeComplianceIntentJson: () => "{}",
      TradeComplianceIntentError: DomainError,
    },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: () => false,
      plannedComplianceIntentReplanStatements: async () => [],
      previousTradeScheduleMutationGuardStatement: () => { throw new Error("UNEXPECTED_INSTALLATION_PATH"); },
    },
    "@/lib/trade-address-verification": {
      TradeAddressVerificationError: DomainError,
    },
    "@/lib/creditex-dataforce-job-csv": {
      projectInstallerWorkOrderToDataforceRecord: () => ({}),
    },
    "@/lib/energy-service-catalogue.mjs": {
      ENERGY_SERVICE_IDS: ["hot-water"],
      ENERGY_SERVICE_LABELS: { "hot-water": "Hot water" },
    },
    "@/lib/trade-team-permission-policy.mjs": {
      canRescheduleWithinScope: () => true,
    },
  });
}

function appointmentRequest(assigneeMemberId) {
  return new Request("https://example.test/api/trade-crm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "create_appointment",
      workOrderId: "job-1",
      appointmentType: "site_visit",
      startsAt: "2099-01-02T10:00:00.000Z",
      durationMinutes: 60,
      assigneeMemberId,
    }),
  });
}

test("create_appointment POST denies a cross-assignee change without canAssignJobs", async () => {
  const { database, d1 } = fixture();
  const { POST } = crmRoute(d1, access());

  const response = await POST(appointmentRequest("member-b"));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /assigning jobs/i);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_appointments").get().count, 0);
});

test("create_appointment POST allows the current exact assignee without canAssignJobs", async () => {
  const { database, d1 } = fixture();
  const { POST } = crmRoute(d1, access());

  const response = await POST(appointmentRequest("member-a"));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const row = database.prepare("SELECT work_order_id, assignee_member_id, assignee_label FROM trade_crm_appointments").get();
  assert.equal(row.work_order_id, "job-1");
  assert.equal(row.assignee_member_id, "member-a");
  assert.equal(row.assignee_label, "Assigned worker");
});

test("job detail GET applies scheduleScope before loading appointment rows", async () => {
  const { database, d1 } = fixture();
  database.prepare("UPDATE trade_work_orders SET assignee_member_id = 'member-b', assignee_label = 'Other worker' WHERE id = 'job-1'").run();
  database.prepare(`INSERT INTO trade_crm_appointments VALUES
    ('appointment-other', 'job-1', 'owner-1', 'site_visit', 'Other worker visit',
      '2099-01-02T10:00:00.000Z', '2099-01-02T11:00:00.000Z', 'member-b', 'Other worker',
      'scheduled', 'Other worker private schedule note', '2026-01-01', '2026-01-01')`).run();
  const { GET } = crmRoute(d1, access({ jobScope: "team", scheduleScope: "own" }));

  const response = await GET(new Request("https://example.test/api/trade-crm?mode=detail&resource=job&id=job-1"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.job.assigneeMemberId, "member-b");
  assert.deepEqual(payload.job.appointments, []);
  assert.equal(payload.job.customerDisplayName, "Alex Customer");
  assert.equal(payload.job.description, "Customer disclosed details");
});

test("job detail GET returns authoritative appointment assignee IDs within team schedule scope", async () => {
  const { database, d1 } = fixture();
  database.prepare(`INSERT INTO trade_crm_appointments VALUES
    ('appointment-self', 'job-1', 'owner-1', 'site_visit', 'Assigned worker visit',
      '2099-01-02T10:00:00.000Z', '2099-01-02T11:00:00.000Z', 'member-a', 'Assigned worker',
      'scheduled', 'Bring access equipment', '2026-01-01', '2026-01-01')`).run();
  const { GET } = crmRoute(d1, access());

  const response = await GET(new Request("https://example.test/api/trade-crm?mode=detail&resource=job&id=job-1"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.job.appointments.length, 1);
  assert.equal(payload.job.appointments[0].assigneeMemberId, "member-a");
  assert.equal(payload.job.appointments[0].notes, "Bring access equipment");
});

function updateJobRequest(expectedRevision, description = "Updated customer instructions") {
  return new Request("https://example.test/api/trade-crm", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "update_job",
      workOrderId: "job-1",
      expectedRevision,
      description,
    }),
  });
}

function crmMutationState(database) {
  return {
    job: { ...database.prepare(`SELECT stage, revision, updated_at
      FROM trade_work_orders WHERE id = 'job-1'`).get() },
    description: database.prepare(`SELECT description FROM trade_crm_job_details
      WHERE work_order_id = 'job-1'`).get().description,
    events: database.prepare("SELECT COUNT(*) count FROM trade_work_order_events").get().count,
    syncChanges: database.prepare("SELECT COUNT(*) count FROM trade_team_sync_changes").get().count,
  };
}

test("CRM update_job uses the displayed revision and rejects a stale second staff save", async () => {
  const { database, d1 } = fixture();
  const { PATCH } = crmRoute(d1, access({ canManageJobs: true }));
  const first = await PATCH(updateJobRequest(3, "First staff edit"));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, revision: 4 });
  assert.equal(database.prepare("SELECT description FROM trade_crm_job_details").get().description,
    "First staff edit");

  const stale = await PATCH(updateJobRequest(3, "Stale overwrite"));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "REVISION_CONFLICT");
  assert.equal(database.prepare("SELECT description FROM trade_crm_job_details").get().description,
    "First staff edit");
});

test("CRM update_job rolls back details, events and sync when the job becomes terminal", async () => {
  const { database, d1 } = fixture();
  const { PATCH } = crmRoute(d1, access({ canManageJobs: true }));
  d1.setBeforeBatch(() => {
    database.prepare(`UPDATE trade_work_orders SET stage = 'completed', revision = 9,
      updated_at = 'concurrent' WHERE id = 'job-1'`).run();
  });
  const response = await PATCH(updateJobRequest(3, "Must roll back"));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "REVISION_CONFLICT");
  assert.deepEqual(crmMutationState(database), {
    job: { stage: "completed", revision: 9, updated_at: "concurrent" },
    description: "Customer disclosed details",
    events: 0,
    syncChanges: 0,
  });
});

for (const terminalStage of ["completed", "cancelled"]) {
  test(`CRM update_job cannot reopen an initially ${terminalStage} job`, async () => {
    const { database, d1 } = fixture();
    database.prepare("UPDATE trade_work_orders SET stage = ? WHERE id = 'job-1'")
      .run(terminalStage);
    const before = crmMutationState(database);
    const response = await crmRoute(d1, access({ canManageJobs: true })).PATCH(
      updateJobRequest(3, "Must not write"),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(crmMutationState(database), before);
  });
}
