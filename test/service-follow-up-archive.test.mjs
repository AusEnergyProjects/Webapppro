import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0052_service_follow_up_preparation.sql");

test("follow-up records and audit events are additive and uniqueness protected", () => {
  assert.match(schema, /sqliteTable\("trade_service_follow_ups"/);
  assert.match(schema, /sqliteTable\("trade_service_follow_up_events"/);
  assert.match(migration, /CREATE TABLE `trade_service_follow_ups`/);
  assert.match(migration, /trade_service_follow_ups_plan_due_idx/);
  assert.match(migration, /trade_service_follow_up_events_record_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE `trade_installed_assets`|CREATE TABLE `trade_asset_service_plans`|CREATE TABLE `customer_asset_lifecycle_preferences`/);
});

test("the follow-up migration applies cleanly and rejects duplicate plan dates", () => {
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const insert = db.prepare(`INSERT INTO trade_service_follow_ups
    (id, service_plan_id, asset_id, crm_customer_id, service_site_id, work_order_id, firebase_uid, due_at, status,
     assignee_member_id, suppression_reason, internal_notes, reminder_subject, reminder_body, revision, created_at, updated_at)
    VALUES (?, ?, 'asset', 'customer', 'site', 'job', 'owner', '2026-08-01', 'preparing', '', '', '', '', '', 0, 'now', 'now')`);
  insert.run("one", "plan");
  assert.throws(() => insert.run("two", "plan"), /UNIQUE/);
});

test("reporting indexes are additive and selected for bounded date scans", () => {
  const migration = read("../drizzle/0054_service_follow_up_reporting.sql");
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
