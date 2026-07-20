import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { addCalendarDays, appointmentDurationMinutes, appointmentEndsAt, assertFutureAppointment, defaultWorkingWindow, durationLabel, insideWorkingWindow, moveAppointmentToDate, normaliseAppointmentDuration, normaliseScheduleRangeWeeks, normaliseWeekStart, rangesOverlap, scheduleAppointmentLanes } from "../src/lib/trade-schedule.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0051_team_scheduling_capacity.sql");
const route = read("../src/app/api/trade-schedule/route.ts");
const ui = read("../src/components/TradeScheduleWorkspace.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const teamPortal = read("../src/components/TradeTeamPortal.tsx");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const adminRoute = read("../src/app/api/admin/accounts/route.ts");
const adminUi = read("../src/components/AdminAccountWorkspace.tsx");
const apply = (db, sql) => { for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement); };

test("stored approved verification is authoritative in admin and signed-in account responses", () => {
  assert.match(profileRoute, /record\.verification_status === "approved"/);
  assert.match(adminRoute, /account\.verification_status === "approved"/);
  assert.match(adminUi, /authoritative access record/);
  assert.match(adminUi, /Saving approved verification unlocks core account features/);
});

test("week and capacity calculations are deterministic", () => {
  assert.equal(normaliseWeekStart("2026-07-13"), "2026-07-13");
  assert.equal(addCalendarDays("2026-07-13", 7), "2026-07-20");
  assert.throws(() => normaliseWeekStart("2026-07-14"), /INVALID_WEEK/);
  assert.equal(rangesOverlap("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-13T09:30", "2026-07-13T11:00"), true);
  assert.equal(rangesOverlap("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-13T10:00", "2026-07-13T11:00"), false);
  assert.equal(insideWorkingWindow("2026-07-13T09:00", "2026-07-13T17:00", defaultWorkingWindow(1)), true);
  assert.equal(insideWorkingWindow("2026-07-13T08:59", "2026-07-13T10:00", defaultWorkingWindow(1)), false);
  assert.equal(assertFutureAppointment("2026-07-19T09:01", "2026-07-19T09:00"), "2026-07-19T09:01");
  assert.throws(() => assertFutureAppointment("2026-07-19T09:00", "2026-07-19T09:00"), /PAST_APPOINTMENT/);
  assert.deepEqual(moveAppointmentToDate("2026-07-13T09:00", "2026-07-13T10:30", "2026-07-19", "2026-07-18T12:00"), { startsAt: "2026-07-19T09:00", endsAt: "2026-07-19T10:30" });
  assert.deepEqual(moveAppointmentToDate("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-19", "2026-07-19T09:07"), { startsAt: "2026-07-19T09:15", endsAt: "2026-07-19T10:15" });
  assert.equal(appointmentEndsAt("2026-07-19T09:00", 30), "2026-07-19T09:30");
  assert.equal(appointmentDurationMinutes("2026-07-19T09:00", "2026-07-19T17:00"), 480);
  assert.equal(durationLabel(75), "1h 15m");
  assert.equal(normaliseScheduleRangeWeeks(undefined), 1);
  assert.equal(normaliseScheduleRangeWeeks("8"), 8);
  assert.throws(() => normaliseScheduleRangeWeeks(0), /INVALID_SCHEDULE_RANGE/);
  assert.throws(() => normaliseScheduleRangeWeeks(9), /INVALID_SCHEDULE_RANGE/);
  assert.throws(() => normaliseAppointmentDuration(10), /INVALID_DURATION/);
  assert.throws(() => normaliseAppointmentDuration(495), /INVALID_DURATION/);
});

test("overlapping appointments receive separate visible lanes", () => {
  const layout = scheduleAppointmentLanes([
    { id: "a", startsAt: "2026-07-20T09:00", endsAt: "2026-07-20T10:30" },
    { id: "b", startsAt: "2026-07-20T09:15", endsAt: "2026-07-20T10:00" },
    { id: "c", startsAt: "2026-07-20T10:00", endsAt: "2026-07-20T11:00" },
    { id: "d", startsAt: "2026-07-20T11:00", endsAt: "" },
  ]);
  assert.deepEqual(layout.get("a"), { lane: 0, laneCount: 2 });
  assert.deepEqual(layout.get("b"), { lane: 1, laneCount: 2 });
  assert.deepEqual(layout.get("c"), { lane: 1, laneCount: 2 });
  assert.deepEqual(layout.get("d"), { lane: 0, laneCount: 1 });
});

test("the additive migration extends existing team and appointment sources", () => {
  for (const table of ["trade_team_working_hours", "trade_team_unavailability"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /ALTER TABLE `trade_crm_appointments` ADD `assignee_member_id`/);
  assert.match(migration, /ALTER TABLE `trade_crm_appointments` ADD `revision`/);
  assert.match(migration, /trade_crm_appointments_assignee_start_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE `trade_work_orders`|CREATE TABLE `trade_crm_appointments`/);
});

test("the scheduling migration applies cleanly to its appointment dependency", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_appointments (id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, status text NOT NULL, starts_at text NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_appointments", "trade_team_unavailability", "trade_team_working_hours"]);
  const columns = db.prepare("PRAGMA table_info(trade_crm_appointments)").all().map((row) => row.name);
  assert.ok(columns.includes("assignee_member_id")); assert.ok(columns.includes("revision"));
});

test("schedule SQL compiles against the production team and CRM migrations", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0025_dizzy_spot.sql", "0026_lovely_zodiak.sql", "0047_customer_service_site_foundation.sql", "0051_team_scheduling_capacity.sql", "0055_appointment_rescheduling.sql", "0057_customer_property_arrivals.sql", "0058_trade_contact_arrival_handoff.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  const queries = [...route.matchAll(/prepare\(\s*`([\s\S]*?)`,?\s*\)/g)].map((match) => match[1]).filter((sql) => !sql.includes("${"));
  assert.ok(queries.length > 10);
  for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `schedule SQL should compile: ${sql.slice(0, 80)}`);
});

test("owners and dispatch roles receive server-enforced conflict and revision checks", () => {
  for (const boundary of ["requireInstallerTeamAccess", "sameOrigin", "canDispatch", "activeMember", "owner_uid = ?", "firebase_uid = ?"]) assert.match(route, new RegExp(boundary));
  for (const conflict of ["REVISION_CONFLICT", "APPOINTMENT_CONFLICT", "UNAVAILABLE_CONFLICT", "PAST_APPOINTMENT"]) assert.match(route, new RegExp(conflict));
  assert.doesNotMatch(route, /throw new Error\("WORKING_HOURS_CONFLICT"\)/);
  assert.match(route, /status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\) AND id <> \?/);
  assert.match(route, /ON CONFLICT\(owner_uid, team_member_id, weekday\) DO UPDATE/);
  assert.match(route, /schedule_updated/); assert.match(route, /schedule_created/); assert.match(route, /jobSyncChangeStatements/);
});

test("schedule payloads preserve customer privacy boundaries", () => {
  assert.match(route, /protectedJob =\s*row\.source_type === "opportunity" \|\|\s*row\.customer_source === "platform_private"/);
  assert.match(route, /LEFT JOIN trade_crm_customers c ON c\.id = d\.crm_customer_id AND c\.firebase_uid = w\.firebase_uid AND c\.record_status = 'active'/);
  assert.match(route, /protectedJob \? "AEA protected customer"/);
  assert.match(route, /protectedJob\s*\?\s*row\.site_area \|\| "Protected service region"/);
  assert.match(route, /customer_business_name/);
  assert.match(route, /customer_first_name, row\.customer_last_name/);
  assert.doesNotMatch(route, /c\.email|c\.phone|address_line_1/);
});

test("the installer dashboard exposes a rolling low-friction scheduling workflow", () => {
  for (const copy of ["Scroll across the schedule", "Eight weeks stay together", "View week containing", "Earlier", "Later", "Today", "Add to schedule", "Conflicts only", "Set working hours and time off", "minuteFromPointer", "moveAppointmentToDate", "outsideWorkingHours", "memberLabel", "ownerMemberId", "schedule_appointment", "schedule_job"]) assert.match(ui, new RegExp(copy));
  assert.match(ui, /draggable=\{!busy\}/);
  assert.match(ui, /const SCHEDULE_RANGE_WEEKS = 8/);
  assert.match(ui, /const SCHEDULE_RANGE_DAYS = SCHEDULE_RANGE_WEEKS \* 7/);
  assert.match(ui, /appointmentsByDate = useMemo/);
  assert.match(ui, /scheduleAppointmentLanes\(dayAppointments\)/);
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /schedule-dialog-status/);
  assert.match(ui, /ref=\{timetableScrollRef\} className="schedule-timetable-scroll" onScroll=\{handleScheduleScroll\}/);
  assert.match(ui, /autoScrollDuringDrag\(event\.clientX, event\.clientY\)/);
  assert.match(ui, /initialWeekStart\?: string/);
  assert.match(ui, /min=\{minimumStart\}/);
  assert.match(route, /member_uid === ownerUid/);
  assert.match(route, /normaliseScheduleRangeWeeks\(search\.get\("rangeWeeks"\), 1\)/);
  assert.match(route, /schedulePayload\(access\.ownerUid, rangeStart, rangeWeeks\)/);
  assert.match(route, /syncCreatedAppointmentToConnectedCalendars\(access\.ownerUid, syncAppointmentId\)/);
  assert.match(dashboard, /workspace === "schedule"/); assert.match(dashboard, /<TradeScheduleWorkspace/);
  assert.match(dashboard, /hasBusinessOperations && hasTeamAccess/);
  assert.match(teamPortal, /data\.access\.canDispatch && <TradeScheduleWorkspace/);
});

test("appointment cards prioritise field-use context and open an accessible editor", () => {
  assert.match(ui, /<strong>\{item\.customerDisplayName\}<\/strong><small>\{item\.assigneeLabel \|\| "Unassigned"\}<\/small><em>\{item\.suburbLabel\}<\/em><span>\{formatTime\(item\.startsAt\)\}/);
  assert.doesNotMatch(ui, /<strong>\{item\.workNumber\}<\/strong>/);
  assert.match(ui, /role="button" aria-label=\{`View appointment for \$\{cardLabel\}`\}/);
  assert.match(ui, /role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title"/);
  assert.match(ui, /document\.body\.style\.overflow = "hidden"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /selectedTriggerRef\.current\?\.focus\(\)/);
  assert.match(ui, /type="date" min=\{minimumStart\.slice\(0, 10\)\}/);
  assert.match(ui, /"Save appointment"/);
});

test("new scheduling and authority copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${ui}\n${adminUi}`, /[\u2013\u2014]/);
});
