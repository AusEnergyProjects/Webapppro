import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mergeServiceFollowUpTrends, serviceFollowUpReportFilters } from "../src/lib/service-follow-up-reporting.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0054_service_follow_up_reporting.sql");
const route = read("../src/app/api/admin/service-follow-up-reporting/route.ts");
const ui = read("../src/components/AdminServiceFollowUpReporting.tsx");
const portal = read("../src/components/AdminOperationsPortal.tsx");
const css = read("../src/app/globals.css");

test("report filters default to 30 days and enforce bounded canonical ranges", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");
  const defaults = serviceFollowUpReportFilters(new URL("https://example.com/report"), now);
  assert.deepEqual({ start: defaults.start, end: defaults.end, channel: defaults.channel, page: defaults.page, pageSize: defaults.pageSize },
    { start: "2026-06-18", end: "2026-07-17", channel: "all", page: 1, pageSize: 25 });
  const selected = serviceFollowUpReportFilters(new URL("https://example.com/report?start=2026-07-01&end=2026-07-17&channel=sms&page=2&pageSize=200"), now);
  assert.equal(selected.channel, "sms"); assert.equal(selected.page, 2); assert.equal(selected.pageSize, 50);
  assert.throws(() => serviceFollowUpReportFilters(new URL("https://example.com/report?start=2026-07-18&end=2026-07-17"), now), /start date/);
  assert.throws(() => serviceFollowUpReportFilters(new URL("https://example.com/report?start=2025-01-01&end=2026-07-17"), now), /366 days/);
});

test("daily trend merging retains empty dates and exact aggregate totals", () => {
  const rows = mergeServiceFollowUpTrends("2026-07-15", "2026-07-17",
    [{ day: "2026-07-15", due: 3, ready: 2 }],
    [{ day: "2026-07-16", sent: 2, delivered: 1, failed: 1, bounced: 0 }],
    [{ day: "2026-07-17", opted_out: 1 }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { day: "2026-07-15", due: 3, ready: 2, sent: 0, delivered: 0, failed: 0, bounced: 0, optedOut: 0 });
  assert.equal(rows[1].sent, 2); assert.equal(rows[2].optedOut, 1);
});

test("reporting indexes are additive and selected for bounded date scans", () => {
  for (const name of ["trade_service_follow_ups_report_due_idx", "service_reminder_deliveries_report_time_idx", "customer_service_reminder_opt_outs_report_time_idx"]) {
    assert.match(schema, new RegExp(name)); assert.match(migration, new RegExp(name));
  }
  const db = new DatabaseSync(":memory:");
  const migrations = ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0018_military_starhawk.sql", "0019_melodic_unus.sql",
    "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0049_customer_asset_timeline.sql",
    "0052_service_follow_up_preparation.sql", "0053_service_reminder_delivery.sql", "0054_service_follow_up_reporting.sql"];
  for (const file of migrations) for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const plans = [
    db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trade_service_follow_ups WHERE due_at >= ? AND due_at <= ?").all("2026-01-01", "2026-12-31"),
    db.prepare("EXPLAIN QUERY PLAN SELECT id FROM service_reminder_deliveries WHERE created_at >= ? AND created_at < ?").all("2026-01-01", "2027-01-01"),
    db.prepare("EXPLAIN QUERY PLAN SELECT id FROM customer_service_reminder_opt_outs WHERE opted_out_at >= ? AND opted_out_at < ?").all("2026-01-01", "2027-01-01"),
  ].flat().map((row) => String(row.detail));
  assert.match(plans.join("\n"), /trade_service_follow_ups_report_due_idx/);
  assert.match(plans.join("\n"), /service_reminder_deliveries_report_time_idx/);
  assert.match(plans.join("\n"), /customer_service_reminder_opt_outs_report_time_idx/);
});

test("every reporting query compiles against the migrated schema", () => {
  const db = new DatabaseSync(":memory:");
  const migrations = ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0016_fair_ultragirl.sql", "0017_brief_timeslip.sql", "0018_military_starhawk.sql", "0019_melodic_unus.sql",
    "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0049_customer_asset_timeline.sql",
    "0052_service_follow_up_preparation.sql", "0053_service_reminder_delivery.sql", "0054_service_follow_up_reporting.sql"];
  for (const file of migrations) for (const statement of read(`../drizzle/${file}`).split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const statements = [...route.matchAll(/\.prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]);
  assert.equal(statements.length, 8);
  for (const statement of statements) assert.doesNotThrow(() => db.prepare(statement));
});

test("aggregate reporting is admin protected, privacy safe and bounded", () => {
  assert.match(route, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(route, /maximumDays: 366/); assert.match(route, /LIMIT 367/); assert.match(route, /LIMIT 50/);
  assert.match(route, /LIMIT \? OFFSET \?/); assert.match(route, /totalPages/);
  assert.doesNotMatch(route, /customer_uid|mobile_e164|account\.email|address_line|street_address|reminder_body|reminder_subject/);
  assert.match(route, /customerIdentifiersIncluded: false/);
});

test("visible reporting uses delegated date ranges, channel filters and aggregate CSV export", () => {
  assert.match(ui, /data-date-range-group="service-follow-up-reporting"/);
  assert.match(ui, /data-date-range-role="start"/); assert.match(ui, /data-date-range-role="end"/);
  assert.match(ui, /Delivery channel/); assert.match(ui, /Export visible aggregate rows CSV/); assert.match(ui, /downloadWorkspaceCsv/);
  assert.match(ui, /Previous staff page/); assert.match(ui, /Next staff page/);
  assert.match(ui, /Delivery outcomes are not attributed to individual staff/);
  assert.doesNotMatch(ui, /customerName|customerEmail|customerPhone|mobileE164|streetAddress|addressLine/);
  assert.match(portal, /<AdminServiceFollowUpReporting api=\{api\}/);
});

test("reporting layouts collapse without horizontal page overflow", () => {
  assert.match(css, /\.admin-follow-up-trend \{[^}]*overflow-x: auto/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.admin-follow-up-report-filters[\s\S]*grid-template-columns: 1fr/);
});

test("new reporting copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${ui}`, /[\u2013\u2014]/);
});
