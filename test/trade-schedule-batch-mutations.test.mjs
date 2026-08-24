import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { canAssignWithinScope, canRescheduleWithinScope } from "../src/lib/trade-team-permission-policy.mjs";

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
  const require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : {};
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE trade_accounts (firebase_uid text PRIMARY KEY NOT NULL, address_state text NOT NULL);
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, partner_type text NOT NULL,
      source_type text NOT NULL, work_number text NOT NULL, title text NOT NULL,
      service_category text NOT NULL, site_area text NOT NULL, priority text NOT NULL,
      stage text NOT NULL, record_status text NOT NULL, scheduled_start text NOT NULL,
      scheduled_end text NOT NULL, assignee_member_id text NOT NULL, assignee_label text NOT NULL,
      revision integer NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, crm_customer_id text NOT NULL,
      service_site_id text NOT NULL, customer_source text NOT NULL, quote_status text NOT NULL,
      quoted_value_cents integer NOT NULL
    );
    CREATE TABLE trade_crm_quotes (
      id text PRIMARY KEY NOT NULL, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      crm_customer_id text NOT NULL, current_version_number integer NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_crm_quote_versions (
      id text PRIMARY KEY NOT NULL, quote_id text NOT NULL, firebase_uid text NOT NULL,
      version_number integer NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_crm_quote_acceptances (
      quote_id text NOT NULL, quote_version_id text NOT NULL, work_order_id text NOT NULL,
      firebase_uid text NOT NULL, crm_customer_id text NOT NULL, decision text NOT NULL
    );
    CREATE TABLE trade_team_members (
      id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, member_uid text NOT NULL,
      email text NOT NULL, display_name text NOT NULL, capabilities text NOT NULL,
      schedule_colour text NOT NULL, status text NOT NULL
    );
    CREATE TABLE trade_team_working_hours (
      id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, team_member_id text NOT NULL,
      weekday integer NOT NULL, start_minute integer NOT NULL, end_minute integer NOT NULL,
      is_available integer NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_team_unavailability (
      id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, team_member_id text NOT NULL,
      starts_at text NOT NULL, ends_at text NOT NULL, reason text NOT NULL,
      created_by_uid text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      appointment_type text NOT NULL, title text NOT NULL, starts_at text NOT NULL,
      ends_at text NOT NULL, assignee_member_id text NOT NULL, assignee_label text NOT NULL,
      status text NOT NULL, notes text NOT NULL, revision integer NOT NULL,
      created_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_crm_appointment_revisions (
      id text PRIMARY KEY NOT NULL, appointment_id text NOT NULL, work_order_id text NOT NULL,
      firebase_uid text NOT NULL, revision integer NOT NULL, starts_at text NOT NULL,
      ends_at text NOT NULL, assignee_member_id text NOT NULL, assignee_label text NOT NULL,
      change_source text NOT NULL, source_reference text NOT NULL, changed_by_uid text NOT NULL,
      created_at text NOT NULL, UNIQUE (appointment_id, revision)
    );
    CREATE TABLE trade_crm_customers (
      id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, first_name text NOT NULL,
      last_name text NOT NULL, business_name text NOT NULL, email text NOT NULL,
      phone text NOT NULL, record_status text NOT NULL
    );
    CREATE TABLE trade_crm_service_sites (
      id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, site_label text NOT NULL,
      address_line_1 text NOT NULL, address_line_2 text NOT NULL, suburb text NOT NULL,
      address_state text NOT NULL, postcode text NOT NULL
    );
    CREATE TABLE trade_crm_appointment_reschedule_requests (
      id text PRIMARY KEY NOT NULL, appointment_id text NOT NULL, work_order_id text NOT NULL,
      firebase_uid text NOT NULL, status text NOT NULL, preferred_windows text NOT NULL,
      reason text NOT NULL, access_notes text NOT NULL, requested_appointment_revision integer NOT NULL,
      original_starts_at text NOT NULL, original_ends_at text NOT NULL,
      proposed_starts_at text NOT NULL, proposed_ends_at text NOT NULL,
      proposed_assignee_member_id text NOT NULL, proposed_assignee_label text NOT NULL,
      decision_note text NOT NULL, revision integer NOT NULL, requested_at text NOT NULL,
      decided_at text NOT NULL
    );
    CREATE TABLE trade_crm_write_guards (
      id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, operation_id text NOT NULL,
      step_number integer NOT NULL, verified integer NOT NULL, created_at text NOT NULL,
      CONSTRAINT trade_crm_write_guard_verified_check CHECK (verified = 1)
    );
    CREATE TABLE customer_project_arrival_proposals (
      id text PRIMARY KEY NOT NULL, crm_appointment_id text NOT NULL,
      preparation_acknowledged_at text NOT NULL, updated_at text NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id text PRIMARY KEY NOT NULL, work_order_id text NOT NULL, firebase_uid text NOT NULL,
      event_type text NOT NULL, summary text NOT NULL, created_at text NOT NULL
    );
    CREATE TABLE trade_team_sync_changes (
      sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL, owner_uid text NOT NULL,
      audience_member_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
      operation text NOT NULL, revision integer NOT NULL, changed_at text NOT NULL
    );
    CREATE TABLE trade_mobile_push_outbox (
      id text PRIMARY KEY NOT NULL, owner_uid text NOT NULL, audience_member_id text NOT NULL,
      event_key text NOT NULL UNIQUE, event_type text NOT NULL, entity_type text NOT NULL,
      entity_id text NOT NULL, payload text NOT NULL, status text NOT NULL, attempts integer NOT NULL,
      next_attempt_at text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
    );

    INSERT INTO trade_accounts VALUES ('owner-1', 'VIC');
    INSERT INTO trade_team_members VALUES
      ('member-a', 'owner-1', 'actor-a', 'a@example.test', 'Worker A', '["hot-water"]', '#111111', 'active'),
      ('member-b', 'owner-1', 'actor-b', 'b@example.test', 'Worker B', '["hot-water"]', '#222222', 'active');
    INSERT INTO trade_crm_customers VALUES
      ('customer-a', 'owner-1', 'Alex', 'Alpha', '', 'alex@example.test', '0400000001', 'active'),
      ('customer-b', 'owner-1', 'Blair', 'Beta', '', 'blair@example.test', '0400000002', 'active');
    INSERT INTO trade_crm_service_sites VALUES
      ('site-a', 'owner-1', 'Home', '1 Alpha Street', '', 'Melbourne', 'VIC', '3000'),
      ('site-b', 'owner-1', 'Home', '2 Beta Street', '', 'Melbourne', 'VIC', '3000');
    INSERT INTO trade_work_orders VALUES
      ('job-a', 'owner-1', 'installer', 'direct', 'JOB-A', 'Job A', 'hot-water', 'Melbourne', 'standard',
        'scheduled', 'active', '2099-01-05', '2099-01-05', 'member-a', 'Worker A', 3, '2026-01-01', '2026-01-01'),
      ('job-b', 'owner-1', 'installer', 'direct', 'JOB-B', 'Job B', 'hot-water', 'Melbourne', 'standard',
        'scheduled', 'active', '2099-01-05', '2099-01-05', 'member-a', 'Worker A', 3, '2026-01-01', '2026-01-01');
    INSERT INTO trade_crm_job_details VALUES
      ('job-a', 'owner-1', 'customer-a', 'site-a', 'trade_owned', 'accepted', 10000),
      ('job-b', 'owner-1', 'customer-b', 'site-b', 'trade_owned', 'accepted', 20000);
    INSERT INTO trade_crm_appointments VALUES
      ('appointment-a', 'job-a', 'owner-1', 'site_visit', 'Job A visit', '2099-01-05T10:00', '2099-01-05T11:00',
        'member-a', 'Worker A', 'scheduled', 'Bring ladder', 1, '2026-01-01', '2026-01-01'),
      ('appointment-b', 'job-b', 'owner-1', 'site_visit', 'Job B visit', '2099-01-05T11:00', '2099-01-05T12:00',
        'member-a', 'Worker A', 'scheduled', 'Call on arrival', 1, '2026-01-01', '2026-01-01');
  `);
  return { database, d1: testD1(database) };
}

function ownerAccess() {
  return {
    ownerUid: "owner-1", actorUid: "owner-1", actorEmail: "owner@example.test",
    memberId: "member-a", businessName: "Installer", isOwner: true,
    canAssignJobs: true, canViewCustomers: true, canViewQuotes: true,
    canRescheduleJobs: true, canManageTeam: true, jobScope: "team", scheduleScope: "team",
  };
}

function scheduleRoute(d1, notifications = [], synced = [], access = ownerAccess()) {
  const adminJson = (body, status = 200) => Response.json(body, { status });
  const scheduleHelpers = loadTypescriptModule("../src/lib/trade-schedule.ts");
  const syncHelpers = loadTypescriptModule("../src/lib/trade-team-sync-server.ts");
  const scheduleServerHelpers = loadTypescriptModule("../src/lib/trade-schedule-server.ts", {
    "../../db": { getD1: () => d1 },
  });
  return loadTypescriptModule("../src/app/api/trade-schedule/route.ts", {
    "../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": {
      adminJson,
      cleanAdminText: (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "",
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      canAssignJob: (access, fromMemberId, toMemberId) => canAssignWithinScope(access, fromMemberId, toMemberId),
      canViewSchedule: () => true,
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": syncHelpers,
    "@/lib/trade-schedule": scheduleHelpers,
    "@/lib/appointment-rescheduling": { parsePreferredWindows: () => [] },
    "@/lib/appointment-notification-server": {
      queueAppointmentNotifications: async (notification) => notifications.push(notification),
    },
    "@/lib/trade-calendar-sync-server": {
      syncCreatedAppointmentToConnectedCalendars: async (ownerUid, appointmentId, options) => {
        synced.push({ ownerUid, appointmentId, options });
        return { connected: 1, attempted: 1, created: 0, updated: 1, unchanged: 0, synced: 1, failed: 0 };
      },
    },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: (error) => String(error?.message || error).includes("trade_crm_write_guard_verified_check"),
      plannedComplianceIntentReplanStatements: async () => [],
      previousTradeScheduleMutationGuardStatement: (database, input) => database.prepare(`INSERT INTO trade_crm_write_guards
        (id, firebase_uid, operation_id, step_number, verified, created_at)
        VALUES (?, ?, ?, 1, CASE WHEN changes() = 1 THEN 1 ELSE 0 END, ?)`)
        .bind(crypto.randomUUID(), input.ownerUid, `schedule-mutation:${crypto.randomUUID()}`, input.changedAt),
    },
    "@/lib/trade-rental-assignment-server": {
      isRentalInspectionAssignmentConflict: () => false,
      rentalInspectionAssignmentStatements: () => [],
    },
    "@/lib/trade-team-permission-policy.mjs": { canRescheduleWithinScope },
    "@/lib/trade-schedule-server": scheduleServerHelpers,
  });
}

function batchRequest(changes) {
  return new Request("https://example.test/api/trade-schedule", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "save_schedule_changes",
      rangeStart: "2099-01-05",
      rangeWeeks: 1,
      changes,
    }),
  });
}

function scheduleMutationRequest(body) {
  return new Request("https://example.test/api/trade-schedule", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rangeStart: "2099-01-05",
      rangeWeeks: 1,
      ...body,
    }),
  });
}

const swappedChanges = [
  { appointmentId: "appointment-a", expectedRevision: 1, memberId: "member-a", startsAt: "2099-01-05T11:00", durationMinutes: 60 },
  { appointmentId: "appointment-b", expectedRevision: 1, memberId: "member-a", startsAt: "2099-01-05T10:00", durationMinutes: 60 },
];

test("save_schedule_changes atomically swaps two appointments and records every revision", async () => {
  const { database, d1 } = fixture();
  const notifications = [];
  const synced = [];
  const response = await scheduleRoute(d1, notifications, synced).PATCH(batchRequest(swappedChanges));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.calendarSync, { connected: 1, attempted: 2, created: 0, updated: 2, unchanged: 0, synced: 2, failed: 0 });
  assert.deepEqual(database.prepare("SELECT id, starts_at, revision FROM trade_crm_appointments ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "appointment-a", starts_at: "2099-01-05T11:00", revision: 2 },
    { id: "appointment-b", starts_at: "2099-01-05T10:00", revision: 2 },
  ]);
  assert.deepEqual(database.prepare("SELECT id, revision FROM trade_work_orders ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "job-a", revision: 4 },
    { id: "job-b", revision: 4 },
  ]);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_appointment_revisions").get().count, 4);
  assert.equal(notifications.length, 2);
  assert.deepEqual(synced.map((item) => item.appointmentId).sort(), ["appointment-a", "appointment-b"]);
  assert.ok(synced.every((item) => item.options?.force === true));
});

test("save_schedule_changes rolls back every requested move when one appointment changes concurrently", async () => {
  const { database, d1 } = fixture();
  d1.setBeforeBatch(() => {
    database.prepare("UPDATE trade_crm_appointments SET revision = 9, updated_at = 'concurrent' WHERE id = 'appointment-b'").run();
  });
  const response = await scheduleRoute(d1).PATCH(batchRequest(swappedChanges));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed|refresh/i);
  assert.deepEqual(database.prepare("SELECT id, starts_at, revision FROM trade_crm_appointments ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "appointment-a", starts_at: "2099-01-05T10:00", revision: 1 },
    { id: "appointment-b", starts_at: "2099-01-05T11:00", revision: 9 },
  ]);
  assert.deepEqual(database.prepare("SELECT id, revision FROM trade_work_orders ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "job-a", revision: 3 },
    { id: "job-b", revision: 3 },
  ]);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_appointment_revisions").get().count, 0);
});

test("save_schedule_changes rejects pairwise final overlap for one worker but permits cross-worker overlap", async () => {
  const first = fixture();
  const sameWorker = await scheduleRoute(first.d1).PATCH(batchRequest([
    { ...swappedChanges[0], startsAt: "2099-01-05T10:30" },
    { ...swappedChanges[1], startsAt: "2099-01-05T10:30" },
  ]));
  assert.equal(sameWorker.status, 409);
  assert.match((await sameWorker.json()).error, /overlapping appointment/i);

  const second = fixture();
  const differentWorkers = await scheduleRoute(second.d1).PATCH(batchRequest([
    { ...swappedChanges[0], startsAt: "2099-01-05T10:30", memberId: "member-a" },
    { ...swappedChanges[1], startsAt: "2099-01-05T10:30", memberId: "member-b" },
  ]));
  assert.equal(differentWorkers.status, 200);
  assert.equal(second.database.prepare("SELECT COUNT(DISTINCT starts_at) count FROM trade_crm_appointments").get().count, 1);
});

test("save_schedule_changes enforces a five-item request bound and unique appointment IDs", async () => {
  const tooMany = await scheduleRoute(fixture().d1).PATCH(batchRequest(Array.from({ length: 6 }, (_, index) => ({
    appointmentId: `appointment-${index}`,
    expectedRevision: 1,
    memberId: "member-a",
    startsAt: "2099-01-05T10:00",
    durationMinutes: 60,
  }))));
  assert.equal(tooMany.status, 400);

  const duplicate = await scheduleRoute(fixture().d1).PATCH(batchRequest([swappedChanges[0], swappedChanges[0]]));
  assert.equal(duplicate.status, 400);
});

test("legacy appointment and job scheduling reject terminal jobs before writing", async () => {
  const appointmentFixture = fixture();
  appointmentFixture.database.prepare("UPDATE trade_work_orders SET stage = 'completed' WHERE id = 'job-a'").run();
  const appointmentResponse = await scheduleRoute(appointmentFixture.d1).PATCH(scheduleMutationRequest({
    action: "schedule_appointment",
    appointmentId: "appointment-a",
    expectedRevision: 1,
    memberId: "member-a",
    startsAt: "2099-01-05T13:00",
    durationMinutes: 60,
  }));
  assert.equal(appointmentResponse.status, 409);
  assert.match((await appointmentResponse.json()).error, /completed or cancelled jobs/i);
  assert.equal(appointmentFixture.database.prepare("SELECT starts_at FROM trade_crm_appointments WHERE id = 'appointment-a'").get().starts_at, "2099-01-05T10:00");

  const jobFixture = fixture();
  jobFixture.database.prepare("UPDATE trade_work_orders SET stage = 'cancelled' WHERE id = 'job-a'").run();
  const jobResponse = await scheduleRoute(jobFixture.d1).PATCH(scheduleMutationRequest({
    action: "schedule_job",
    workOrderId: "job-a",
    expectedRevision: 3,
    memberId: "member-a",
    startsAt: "2099-01-05T13:00",
    durationMinutes: 60,
  }));
  assert.equal(jobResponse.status, 409);
  assert.match((await jobResponse.json()).error, /completed or cancelled jobs/i);
});

test("legacy schedule_appointment rolls back when its job becomes terminal after the pre-check", async () => {
  const { database, d1 } = fixture();
  d1.setBeforeBatch(() => {
    database.prepare("UPDATE trade_work_orders SET stage = 'completed', updated_at = 'concurrent' WHERE id = 'job-a'").run();
  });
  const response = await scheduleRoute(d1).PATCH(scheduleMutationRequest({
    action: "schedule_appointment",
    appointmentId: "appointment-a",
    expectedRevision: 1,
    memberId: "member-a",
    startsAt: "2099-01-05T13:00",
    durationMinutes: 60,
  }));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed|refresh/i);
  assert.deepEqual({ ...database.prepare("SELECT starts_at, revision FROM trade_crm_appointments WHERE id = 'appointment-a'").get() }, {
    starts_at: "2099-01-05T10:00",
    revision: 1,
  });
  assert.deepEqual({ ...database.prepare("SELECT stage, revision FROM trade_work_orders WHERE id = 'job-a'").get() }, {
    stage: "completed",
    revision: 3,
  });
});

test("schedule payload only projects operational and contact details to authorised viewers", async () => {
  const ownerFixture = fixture();
  const ownerResponse = await scheduleRoute(ownerFixture.d1).GET(
    new Request("https://example.test/api/trade-schedule?rangeStart=2099-01-05&rangeWeeks=1"),
  );
  const ownerAppointment = (await ownerResponse.json()).appointments.find((item) => item.id === "appointment-a");
  assert.equal(ownerAppointment.addressLine1, "1 Alpha Street");
  assert.equal(ownerAppointment.notes, "Bring ladder");
  assert.equal(ownerAppointment.customerEmail, "alex@example.test");
  assert.equal(ownerAppointment.customerPhone, "0400000001");

  const restrictedFixture = fixture();
  const restrictedAccess = {
    ...ownerAccess(),
    actorUid: "actor-b",
    memberId: "member-b",
    isOwner: false,
    canViewCustomers: false,
    canManageTeam: false,
    jobScope: "own",
    scheduleScope: "team",
  };
  const restrictedResponse = await scheduleRoute(restrictedFixture.d1, [], [], restrictedAccess).GET(
    new Request("https://example.test/api/trade-schedule?rangeStart=2099-01-05&rangeWeeks=1"),
  );
  const restrictedAppointment = (await restrictedResponse.json()).appointments.find((item) => item.id === "appointment-a");
  assert.equal(restrictedAppointment.addressLine1, "");
  assert.equal(restrictedAppointment.notes, "");
  assert.equal(restrictedAppointment.customerEmail, "");
  assert.equal(restrictedAppointment.customerPhone, "");

  const assignedFixture = fixture();
  const assignedAccess = {
    ...ownerAccess(),
    actorUid: "actor-a",
    memberId: "member-a",
    isOwner: false,
    canViewCustomers: false,
    canManageTeam: false,
    jobScope: "own",
    scheduleScope: "own",
  };
  const assignedResponse = await scheduleRoute(assignedFixture.d1, [], [], assignedAccess).GET(
    new Request("https://example.test/api/trade-schedule?rangeStart=2099-01-05&rangeWeeks=1"),
  );
  const assignedAppointment = (await assignedResponse.json()).appointments.find((item) => item.id === "appointment-a");
  assert.equal(assignedAppointment.addressLine1, "1 Alpha Street");
  assert.equal(assignedAppointment.notes, "Bring ladder");
  assert.equal(assignedAppointment.customerEmail, "");
  assert.equal(assignedAppointment.customerPhone, "");
});

test("schedule payload never projects protected AEA customer details", async () => {
  const { database, d1 } = fixture();
  database.prepare("UPDATE trade_work_orders SET source_type = 'opportunity' WHERE id = 'job-a'").run();
  database.prepare("UPDATE trade_crm_job_details SET customer_source = 'platform_private' WHERE work_order_id = 'job-a'").run();

  const response = await scheduleRoute(d1).GET(
    new Request("https://example.test/api/trade-schedule?rangeStart=2099-01-05&rangeWeeks=1"),
  );
  const appointment = (await response.json()).appointments.find((item) => item.id === "appointment-a");
  assert.equal(appointment.protectedJob, true);
  assert.equal(appointment.addressLine1, "");
  assert.equal(appointment.notes, "");
  assert.equal(appointment.customerEmail, "");
  assert.equal(appointment.customerPhone, "");
});
