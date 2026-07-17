import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalisePreferredWindows, parsePreferredWindows } from "../src/lib/appointment-rescheduling.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0055_appointment_rescheduling.sql");
const customerRoute = read("../src/app/api/customer-appointment-rescheduling/route.ts");
const dispatchRoute = read("../src/app/api/trade-schedule/route.ts");
const customerUi = read("../src/components/CustomerAppointmentRescheduling.tsx");
const dispatchUi = read("../src/components/TradeScheduleWorkspace.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const css = read("../src/app/globals.css");

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
  const files = ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0019_melodic_unus.sql", "0025_dizzy_spot.sql", "0026_lovely_zodiak.sql",
    "0047_customer_service_site_foundation.sql", "0051_team_scheduling_capacity.sql", "0055_appointment_rescheduling.sql"];
  for (const file of files) for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const join = customerRoute.match(/const authorisedCustomerJoin = `([\s\S]*?)`;/)?.[1];
  assert.ok(join);
  const queries = [...customerRoute.matchAll(/prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1].replace("${authorisedCustomerJoin}", join)).filter((sql) => !sql.includes("${"));
  assert.ok(queries.length >= 7);
  for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `customer rescheduling SQL should compile: ${sql.slice(0, 90)}`);
});

test("only a verified active customer linked to the authoritative CRM email can create or view requests", () => {
  for (const boundary of ["requireFirebaseIdentity", "identity.emailVerified", "customer_accounts", "account_status = 'active'", "sameOrigin", "customer_firebase_uid = ?", "LOWER(c.email) = LOWER(?)", "trade_crm_customer_contacts", "d.customer_source = 'trade_owned'"]) assert.ok(customerRoute.includes(boundary), `missing customer boundary: ${boundary}`);
  assert.match(customerRoute, /a\.status = 'scheduled' AND a\.starts_at > \?/);
  assert.match(customerRoute, /expectedAppointmentRevision/);
  assert.match(customerRoute, /DUPLICATE_REQUEST/);
  assert.match(customerRoute, /active_key = \?/);
  assert.doesNotMatch(customerRoute, /private_notes|hazard_notes|assigneeLabel:/);
});

test("customer submission creates one review task and audit history without changing the appointment", () => {
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
  for (const boundary of ["canDispatch", "r.firebase_uid = ?", "expectedRequestRevision", "expectedAppointmentRevision", "REVISION_CONFLICT", "assertScheduleAvailable"]) assert.match(dispatchRoute, new RegExp(boundary));
  assert.match(dispatchRoute, /INSERT OR IGNORE INTO trade_crm_appointment_revisions/);
  assert.match(dispatchRoute, /change_source[\s\S]*?'reschedule_accepted'/);
  assert.match(dispatchRoute, /WHERE id = \? AND firebase_uid = \? AND revision = \?/);
  assert.match(dispatchRoute, /EXISTS \(SELECT 1 FROM trade_crm_appointment_reschedule_requests guard/);
  assert.ok((dispatchRoute.match(/CASE WHEN changes\(\) = 1 THEN \? ELSE NULL END/g) || []).length >= 3);
  assert.match(dispatchRoute, /jobSyncChangeStatements/);
});

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
