import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { normalisePreferredWindows, parsePreferredWindows } from "../src/lib/appointment-rescheduling.ts";
import * as scheduleHelpers from "../src/lib/trade-schedule.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function loadTypescriptModule(path, mocks) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0055_appointment_rescheduling.sql");
const dispatchRoute = read("../src/app/api/trade-schedule/route.ts");
const scheduleServer = read("../src/lib/trade-schedule-server.ts");
const dispatchUi = read("../src/components/TradeScheduleWorkspace.tsx");
const css = read("../src/app/globals.css");

function sqliteD1(database) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => database.prepare(sql).get(...values),
            run: async () => database.prepare(sql).run(...values),
          };
        },
      };
    },
  };
}

function scheduleServerHarness(database) {
  const d1 = sqliteD1(database);
  return {
    d1,
    server: loadTypescriptModule("../src/lib/trade-schedule-server.ts", {
      "../../db": { getD1: () => d1 },
    }),
  };
}

function routeActionSection(startMarker, endMarker) {
  const start = dispatchRoute.indexOf(startMarker);
  const end = dispatchRoute.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing route marker: ${startMarker}`);
  assert.ok(end > start, `missing route marker after ${startMarker}: ${endMarker}`);
  return dispatchRoute.slice(start, end);
}

function assertEligibilityPrecheckAndAtomicGuard(section, label) {
  const precheck = section.indexOf("await assertTradeJobReadyForScheduling(");
  const batch = section.indexOf("await db.batch([");
  const guard = section.indexOf("tradeJobScheduleEligibilityGuardStatement(db");
  const batchEnd = section.indexOf("]);", batch);
  assert.ok(precheck >= 0, `${label} must precheck authoritative job eligibility`);
  assert.ok(batch > precheck, `${label} must precheck before preparing its mutation batch`);
  assert.ok(guard > batch && guard < batchEnd, `${label} must atomically recheck eligibility inside the mutation batch`);
}

function assertBatchEligibilityPrecheckAndAtomicGuard(section) {
  const preparationLoop = section.indexOf("for (const change of changes)");
  const precheck = section.indexOf("await assertTradeJobReadyForScheduling(");
  const statements = section.indexOf("const statements: D1PreparedStatement[] = []");
  const guard = section.indexOf("tradeJobScheduleEligibilityGuardStatement(db");
  const guardLoop = section.lastIndexOf("for (const item of prepared)", guard);
  const batch = section.indexOf("await db.batch(statements)");
  assert.ok(preparationLoop >= 0 && precheck > preparationLoop,
    "batch scheduling must precheck every prepared job's authoritative eligibility");
  assert.ok(statements > precheck && guardLoop > statements && guard > guardLoop,
    "batch scheduling must add an eligibility guard for every prepared job");
  assert.ok(batch > guard, "batch scheduling must include every eligibility guard in its atomic mutation batch");
}

function conflictDispatchRoute(conflictCode) {
  let batchCalls = 0;
  let preparedWrites = 0;
  class ScheduleStatement {
    constructor(sql, values = []) {
      this.sql = sql;
      this.values = values;
    }

    bind(...values) {
      return new ScheduleStatement(this.sql, values);
    }

    async first() {
      if (this.sql.includes("FROM trade_accounts")) return { address_state: "VIC" };
      if (this.sql.includes("FROM trade_team_members")) {
        return { id: "member-a", member_uid: "owner-1", display_name: "Assigned worker", capabilities: "[]" };
      }
      if (this.sql.includes("FROM trade_work_orders")) {
        return { id: "job-1", work_number: "JOB-1", title: "Hot water job", revision: 3,
          assignee_member_id: "member-a", service_category: "hot-water" };
      }
      throw new Error(`Unexpected first SQL: ${this.sql}`);
    }
  }
  const database = {
    prepare(sql) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) preparedWrites += 1;
      return new ScheduleStatement(sql);
    },
    async batch() {
      batchCalls += 1;
      return [];
    },
  };
  const access = {
    ownerUid: "owner-1", actorUid: "owner-1", memberId: "member-a", isOwner: true,
    canAssignJobs: true, canRescheduleJobs: true, canManageTeam: true, canViewQuotes: true,
    jobScope: "team", scheduleScope: "team",
  };
  const route = loadTypescriptModule("../src/app/api/trade-schedule/route.ts", {
    "../../../../db": { getD1: () => database },
    "@/lib/admin-server": {
      adminJson: (value, status = 200) => Response.json(value, { status }),
      cleanAdminText: (value, maximum) => String(value || "").trim().slice(0, maximum),
      sameOrigin: () => true,
    },
    "@/lib/trade-team-server": {
      canAssignJob: () => true,
      canViewSchedule: () => true,
      requireInstallerTeamAccess: async () => access,
    },
    "@/lib/trade-team-sync-server": { jobSyncChangeStatements: () => [], nextJobRevision: (value) => Number(value) + 1 },
    "@/lib/trade-schedule": scheduleHelpers,
    "@/lib/appointment-rescheduling": { parsePreferredWindows },
    "@/lib/direct-appointment-invite-server": { sendDirectAppointmentCalendarInvite: async () => ({ status: "accepted" }) },
    "@/lib/appointment-notification-server": { queueAppointmentNotifications: async () => {} },
    "@/lib/trade-calendar-sync-server": { syncCreatedAppointmentToConnectedCalendars: async () => ({ connected: 0, synced: 0, failed: 0 }) },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: () => false,
      plannedComplianceIntentReplanStatements: async () => [],
      previousTradeScheduleMutationGuardStatement: () => { throw new Error("UNEXPECTED_MUTATION_GUARD"); },
    },
    "@/lib/trade-rental-assignment-server": {
      isRentalInspectionAssignmentConflict: () => false,
      rentalInspectionAssignmentStatements: () => [],
    },
    "@/lib/trade-team-permission-policy.mjs": { canRescheduleWithinScope: () => true },
    "@/lib/trade-schedule-server": {
      assertTradeJobReadyForScheduling: async () => {},
      assertTradeScheduleAvailable: async () => { throw new Error(conflictCode); },
      isTradeJobScheduleEligibilityConflict: () => false,
      tradeJobScheduleEligibilitySql: () => "1 = 1",
    },
  });
  return {
    route,
    mutationCounts: () => ({ batchCalls, preparedWrites }),
  };
}

function scheduleJobRequest() {
  return new Request("https://example.test/api/trade-schedule", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "schedule_job",
      rangeStart: "2099-01-05",
      workOrderId: "job-1",
      expectedRevision: 3,
      memberId: "member-a",
      startsAt: "2099-01-05T10:00",
      durationMinutes: 60,
    }),
  });
}

test("preferred appointment windows are bounded, ordered and future dated", () => {
  const windows = normalisePreferredWindows([
    { startsAt: "2026-07-22T13:00", endsAt: "2026-07-22T15:00" },
    { startsAt: "2026-07-21T09:00", endsAt: "2026-07-21T11:00" },
  ], "2026-07-17T12:00");
  assert.deepEqual(windows.map((item) => item.startsAt), ["2026-07-21T09:00", "2026-07-22T13:00"]);
  assert.deepEqual(parsePreferredWindows(JSON.stringify(windows)), windows);
  assert.throws(() => normalisePreferredWindows([], "2026-07-17T12:00"), /INVALID_WINDOWS/);
  assert.throws(() => normalisePreferredWindows([{ startsAt: "2026-07-16T09:00", endsAt: "2026-07-16T10:00" }], "2026-07-17T12:00"), /INVALID_WINDOWS/);
  assert.throws(() => normalisePreferredWindows([{ startsAt: "2026-07-21T09:00", endsAt: "2026-07-22T10:00" }], "2026-07-17T12:00"), /INVALID_WINDOWS/);
});

test("the additive migration stores requests, immutable events and reconstructable appointment revisions", () => {
  for (const table of ["trade_crm_appointment_reschedule_requests", "trade_crm_appointment_reschedule_events", "trade_crm_appointment_revisions"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /trade_crm_appointment_reschedule_active_idx/);
  assert.match(migration, /trade_crm_appointment_revisions_item_revision_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE `trade_crm_appointments`|ALTER TABLE `trade_crm_appointments`/);
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(names, ["trade_crm_appointment_reschedule_events", "trade_crm_appointment_reschedule_requests", "trade_crm_appointment_revisions"]);
});

test("AEA lead scheduling requires an accepted current quote while direct jobs remain schedulable", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (
      id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, partner_type TEXT NOT NULL,
      record_status TEXT NOT NULL, source_type TEXT NOT NULL
    );
    CREATE TABLE trade_crm_job_details (
      work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, customer_source TEXT,
      quote_status TEXT, crm_customer_id TEXT
    );
    CREATE TABLE trade_crm_quotes (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL, current_version_number INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE trade_crm_quote_versions (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      version_number INTEGER NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE trade_crm_quote_acceptances (
      quote_id TEXT NOT NULL, quote_version_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
      firebase_uid TEXT NOT NULL, crm_customer_id TEXT NOT NULL, decision TEXT NOT NULL
    );
    CREATE TABLE trade_work_order_events (
      id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      event_type TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO trade_work_orders VALUES ('direct-job', 'owner-1', 'installer', 'active', 'manual');
    INSERT INTO trade_crm_job_details VALUES ('direct-job', 'owner-1', 'trade_owned', 'issued', 'customer-direct');
    INSERT INTO trade_work_orders VALUES ('aea-job', 'owner-1', 'installer', 'active', 'manual');
    INSERT INTO trade_crm_job_details VALUES ('aea-job', 'owner-1', 'public_lead_released', 'accepted', 'customer-aea');
    INSERT INTO trade_crm_quotes VALUES ('quote-aea', 'aea-job', 'owner-1', 'customer-aea', 2, 'accepted');
    INSERT INTO trade_crm_quote_versions VALUES ('version-old', 'quote-aea', 'owner-1', 1, 'accepted');
    INSERT INTO trade_crm_quote_acceptances VALUES ('quote-aea', 'version-old', 'aea-job', 'owner-1', 'customer-aea', 'accepted');
  `);
  const { d1, server } = scheduleServerHarness(db);

  await assert.doesNotReject(() => server.assertTradeJobReadyForScheduling("owner-1", "direct-job"));
  await assert.rejects(
    () => server.assertTradeJobReadyForScheduling("owner-1", "aea-job"),
    /JOB_SCHEDULE_ACCEPTANCE_REQUIRED/,
    "an accepted older version must not unlock an AEA lead",
  );

  let atomicError;
  try {
    await server.tradeJobScheduleEligibilityGuardStatement(d1, {
      ownerUid: "owner-1", workOrderId: "aea-job", changedAt: "2026-08-14T10:00:00.000Z",
    }).run();
  } catch (error) {
    atomicError = error;
  }
  assert.ok(atomicError, "the atomic mutation guard must fail while the current quote is not accepted");
  assert.equal(server.isTradeJobScheduleEligibilityConflict(atomicError), true);

  db.exec(`
    INSERT INTO trade_crm_quote_versions VALUES ('version-current', 'quote-aea', 'owner-1', 2, 'accepted');
    INSERT INTO trade_crm_quote_acceptances VALUES ('quote-aea', 'version-current', 'aea-job', 'owner-1', 'customer-aea', 'accepted');
  `);
  await assert.doesNotReject(() => server.assertTradeJobReadyForScheduling("owner-1", "aea-job"));
  const acceptedGuard = await server.tradeJobScheduleEligibilityGuardStatement(d1, {
    ownerUid: "owner-1", workOrderId: "aea-job", changedAt: "2026-08-14T10:01:00.000Z",
  }).run();
  assert.equal(Number(acceptedGuard.changes), 0, "an accepted current quote keeps the atomic guard non-mutating");
});

test("schedule availability permits overlapping appointments for every worker", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_crm_appointments (
      id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL, assignee_member_id TEXT NOT NULL,
      status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT
    );
    CREATE TABLE trade_team_unavailability (
      id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL, team_member_id TEXT NOT NULL,
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL
    );
    INSERT INTO trade_crm_appointments VALUES (
      'appointment-a', 'owner-1', 'member-a', 'scheduled', '2099-01-05T10:00', '2099-01-05T11:00'
    );
  `);
  const { server } = scheduleServerHarness(db);
  const window = { ownerUid: "owner-1", startsAt: "2099-01-05T10:15", endsAt: "2099-01-05T10:45" };

  await assert.doesNotReject(() => server.assertTradeScheduleAvailable({ ...window, memberId: "member-b" }));
  await assert.doesNotReject(() => server.assertTradeScheduleAvailable({ ...window, memberId: "member-a" }));
});

test("dispatch decisions are owner scoped, revision protected and recheck conflicts before acceptance", () => {
  assert.match(dispatchRoute, /action === "review_reschedule_request"/);
  for (const decision of ["accepted", "rejected", "alternative_proposed"]) assert.match(dispatchRoute, new RegExp(decision));
  for (const boundary of ["canRescheduleWithinScope", "canAssignJob", "r.firebase_uid = ?", "expectedRequestRevision", "expectedAppointmentRevision", "REVISION_CONFLICT", "assertTradeScheduleAvailable"]) assert.match(dispatchRoute, new RegExp(boundary));
  assert.equal((dispatchRoute.match(/await assertTradeScheduleAvailable/g) || []).length, 4);
  assert.match(scheduleServer, /trade_team_unavailability/);
  assert.doesNotMatch(scheduleServer, /trade_crm_appointments|APPOINTMENT_CONFLICT/);
  assert.match(scheduleServer, /throw new Error\("UNAVAILABLE_CONFLICT"\)/);
  assert.doesNotMatch(dispatchRoute, /access\.role|canDispatch\(access\)/);
  assert.match(dispatchRoute, /INSERT OR IGNORE INTO trade_crm_appointment_revisions/);
  assert.match(dispatchRoute, /change_source[\s\S]*?'reschedule_accepted'/);
  assert.match(dispatchRoute, /WHERE id = \? AND firebase_uid = \? AND revision = \?/);
  assert.match(dispatchRoute, /EXISTS \(SELECT 1 FROM trade_crm_appointment_reschedule_requests guard/);
  assert.ok((dispatchRoute.match(/CASE WHEN changes\(\) = 1 THEN \? ELSE NULL END/g) || []).length >= 3);
  assert.match(dispatchRoute, /jobSyncChangeStatements/);
});

test("every schedule mutation path prechecks and atomically guards authoritative AEA quote acceptance", () => {
  const acceptedReschedule = routeActionSection(
    "const appointmentRevision = Number(current.appointment_revision) + 1",
    '} else if (action === "save_schedule_changes")',
  );
  const batchSchedule = routeActionSection(
    'action === "save_schedule_changes"',
    '} else if (action === "schedule_appointment")',
  );
  const scheduleAppointment = routeActionSection(
    'action === "schedule_appointment"',
    '} else if (action === "schedule_job")',
  );
  const scheduleJob = routeActionSection(
    'action === "schedule_job"',
    "} else return adminJson",
  );

  assertEligibilityPrecheckAndAtomicGuard(acceptedReschedule, "accepted customer reschedule");
  assertBatchEligibilityPrecheckAndAtomicGuard(batchSchedule);
  assertEligibilityPrecheckAndAtomicGuard(scheduleAppointment, "appointment scheduling");
  assertEligibilityPrecheckAndAtomicGuard(scheduleJob, "job scheduling");
  assert.equal((dispatchRoute.match(/await assertTradeJobReadyForScheduling\(/g) || []).length, 4);
  assert.equal((dispatchRoute.match(/tradeJobScheduleEligibilityGuardStatement\(db/g) || []).length, 4);
  assert.match(dispatchRoute, /JOB_SCHEDULE_ACCEPTANCE_REQUIRED[\s\S]*?Wait for the customer to accept the current Australian Energy Assessments quote/);
  assert.match(dispatchRoute, /AND \$\{tradeJobScheduleEligibilitySql\("w", "d"\)\}[\s\S]*?AND w\.stage NOT IN/);
});

for (const [conflictCode, errorPattern] of [["UNAVAILABLE_CONFLICT", /unavailable/i]]) {
  test(`schedule_job rejects ${conflictCode} before preparing or batching mutations`, async () => {
    const { route, mutationCounts } = conflictDispatchRoute(conflictCode);

    const response = await route.PATCH(scheduleJobRequest());
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, errorPattern);
    assert.deepEqual(mutationCounts(), { batchCalls: 0, preparedWrites: 0 });
  });
}

test("customer and dispatch interfaces expose deliberate review with delegated date ranges", () => {
  for (const copy of ["Review before changing the schedule", "Propose alternative", "Accept and reschedule", "review_reschedule_request"]) assert.match(dispatchUi, new RegExp(copy));
  assert.match(css, /\.schedule-request-decision/);
});
