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
const customerRoute = read("../src/app/api/customer-appointment-rescheduling/route.ts");
const dispatchRoute = read("../src/app/api/trade-schedule/route.ts");
const scheduleServer = read("../src/lib/trade-schedule-server.ts");
const customerUi = read("../src/components/CustomerAppointmentRescheduling.tsx");
const dispatchUi = read("../src/components/TradeScheduleWorkspace.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
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
    "@/lib/appointment-notification-server": { queueAppointmentNotifications: async () => {} },
    "@/lib/trade-calendar-sync-server": { syncCreatedAppointmentToConnectedCalendars: async () => ({ connected: 0, synced: 0, failed: 0 }) },
    "@/lib/trade-compliance-intent-replan-server": {
      isTradeComplianceIntentScheduleConflict: () => false,
      plannedComplianceIntentReplanStatements: async () => [],
      previousTradeScheduleMutationGuardStatement: () => { throw new Error("UNEXPECTED_MUTATION_GUARD"); },
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

test("customer rescheduling SQL compiles against the complete production migration chain", () => {
  const db = new DatabaseSync(":memory:");
  const files = ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql",
    "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0006_silky_wild_pack.sql", "0007_gifted_silhouette.sql", "0009_groovy_zaran.sql",
    "0019_melodic_unus.sql", "0025_dizzy_spot.sql", "0026_lovely_zodiak.sql",
    "0047_customer_service_site_foundation.sql", "0051_team_scheduling_capacity.sql",
    "0055_appointment_rescheduling.sql", "0079_trade_abn_access_gate.sql"];
  for (const file of files) for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const join = customerRoute.match(/const authorisedCustomerJoin = `([\s\S]*?)`;/)?.[1];
  assert.ok(join);
  const queries = [...customerRoute.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]
    .replace("${authorisedCustomerJoin}", join)
    .replace(/\$\{verifiedTradeAccountPredicate\(\"[A-Za-z_][A-Za-z0-9_]*\"\)\}/g, "1 = 1"))
    .filter((sql) => !sql.includes("${"));
  assert.ok(queries.length >= 7);
  for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `customer rescheduling SQL should compile: ${sql.slice(0, 90)}`);
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

test("schedule availability still permits different workers to overlap", async () => {
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
  await assert.rejects(
    () => server.assertTradeScheduleAvailable({ ...window, memberId: "member-a" }),
    /APPOINTMENT_CONFLICT/,
  );
});

test("only a verified active customer linked to the authoritative CRM email can create or view requests", () => {
  for (const boundary of ["requireFirebaseIdentity", "identity.emailVerified", "customer_accounts", "account_status = 'active'", "sameOrigin", "customer_firebase_uid = ?", "LOWER(c.email) = LOWER(?)", "trade_crm_customer_contacts", "d.customer_source = 'trade_owned'"]) assert.ok(customerRoute.includes(boundary), `missing customer boundary: ${boundary}`);
  assert.match(customerRoute, /verifiedTradeAccountPredicate\("installer_access"\)/);
  assert.match(customerRoute, /installer_access\.partner_type = 'installer'/);
  assert.match(customerRoute, /a\.status = 'scheduled' AND a\.starts_at > \?/);
  assert.match(customerRoute, /expectedAppointmentRevision/);
  assert.match(customerRoute, /DUPLICATE_REQUEST/);
  assert.match(customerRoute, /active_key = \?/);
  assert.doesNotMatch(customerRoute, /private_notes|hazard_notes|assigneeLabel:/);
});

test("historical requests remain visible without exposing a revoked installer's current schedule", () => {
  assert.match(customerRoute, /LEFT JOIN trade_accounts current_installer/);
  assert.match(customerRoute, /verifiedTradeAccountPredicate\("current_installer"\)/);
  assert.match(customerRoute, /CASE WHEN current_installer\.firebase_uid IS NULL THEN '' ELSE a\.starts_at END current_starts_at/);
  assert.match(customerRoute, /CASE WHEN current_installer\.firebase_uid IS NULL THEN '' ELSE a\.ends_at END current_ends_at/);
  assert.match(customerRoute, /original_starts_at/);
  assert.match(customerRoute, /original_ends_at/);
});

test("customer submission creates one review task and audit history without changing the appointment", () => {
  assert.match(customerRoute, /FROM trade_accounts mutation_installer/);
  assert.match(customerRoute, /verifiedTradeAccountPredicate\("mutation_installer"\)/);
  assert.match(customerRoute, /Number\(mutationResults\[0\]\?\.meta\.changes \|\| 0\) !== 1/);
  assert.ok((customerRoute.match(/FROM trade_crm_appointment_reschedule_requests request_guard/g) || []).length >= 4);
  assert.match(customerRoute, /INSERT INTO trade_crm_appointment_reschedule_requests/);
  assert.match(customerRoute, /INSERT INTO trade_work_order_tasks/);
  assert.match(customerRoute, /INSERT INTO trade_crm_appointment_reschedule_events/);
  assert.match(customerRoute, /appointment_reschedule_requested/);
  assert.doesNotMatch(customerRoute, /UPDATE trade_crm_appointments/);
  assert.match(customerRoute, /The existing schedule remains unchanged/);
});

test("dispatch decisions are owner scoped, revision protected and recheck conflicts before acceptance", () => {
  assert.match(dispatchRoute, /action === "review_reschedule_request"/);
  for (const decision of ["accepted", "rejected", "alternative_proposed"]) assert.match(dispatchRoute, new RegExp(decision));
  for (const boundary of ["canRescheduleWithinScope", "canAssignJob", "r.firebase_uid = ?", "expectedRequestRevision", "expectedAppointmentRevision", "REVISION_CONFLICT", "assertTradeScheduleAvailable"]) assert.match(dispatchRoute, new RegExp(boundary));
  assert.equal((dispatchRoute.match(/await assertTradeScheduleAvailable/g) || []).length, 3);
  assert.match(scheduleServer, /status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\)/);
  assert.match(scheduleServer, /trade_team_unavailability/);
  assert.match(scheduleServer, /throw new Error\("APPOINTMENT_CONFLICT"\)/);
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
  assertEligibilityPrecheckAndAtomicGuard(scheduleAppointment, "appointment scheduling");
  assertEligibilityPrecheckAndAtomicGuard(scheduleJob, "job scheduling");
  assert.equal((dispatchRoute.match(/await assertTradeJobReadyForScheduling\(/g) || []).length, 3);
  assert.equal((dispatchRoute.match(/tradeJobScheduleEligibilityGuardStatement\(db/g) || []).length, 3);
  assert.match(dispatchRoute, /JOB_SCHEDULE_ACCEPTANCE_REQUIRED[\s\S]*?Wait for the customer to accept the current Australian Energy Assessments quote/);
  assert.match(dispatchRoute, /AND \$\{tradeJobScheduleEligibilitySql\("w", "d"\)\}[\s\S]*?AND w\.stage NOT IN/);
});

for (const [conflictCode, errorPattern] of [
  ["APPOINTMENT_CONFLICT", /overlapping appointment/i],
  ["UNAVAILABLE_CONFLICT", /unavailable/i],
]) {
  test(`schedule_job rejects ${conflictCode} before preparing or batching mutations`, async () => {
    const { route, mutationCounts } = conflictDispatchRoute(conflictCode);

    const response = await route.PATCH(scheduleJobRequest());
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, errorPattern);
    assert.deepEqual(mutationCounts(), { batchCalls: 0, preparedWrites: 0 });
  });
}

test("customer and dispatch interfaces expose deliberate review with delegated date ranges", () => {
  for (const copy of ["Request another suitable time", "Send for installer review", "The existing appointment has not changed", "Request history"]) assert.match(customerUi, new RegExp(copy));
  assert.match(customerUi, /data-date-range-group/);
  assert.match(customerUi, /data-date-range-role="start"/);
  assert.match(customerUi, /data-date-range-role="end"/);
  assert.match(dashboard, /href="\/account\/appointments"/);
  for (const copy of ["Review before changing the schedule", "Propose alternative", "Accept and reschedule", "review_reschedule_request"]) assert.match(dispatchUi, new RegExp(copy));
  assert.match(css, /\.customer-reschedule-form/);
  assert.match(css, /\.schedule-request-decision/);
  assert.match(css, /@media[\s\S]*?\.customer-reschedule-form[\s\S]*?grid-template-columns: 1fr/);
});

test("new appointment rescheduling sources avoid prohibited dash characters", () => {
  assert.doesNotMatch(`${customerRoute}\n${dispatchRoute}\n${customerUi}\n${dispatchUi}`, /[\u2013\u2014]/);
});
