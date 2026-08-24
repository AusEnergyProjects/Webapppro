import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS } from "../src/lib/trade-rental-schema-guards.ts";
import { canonicalTlinkSchemaGuardSql } from "../src/lib/tlink-schema-guards.ts";

const migrationUrl = new URL("../drizzle/0160_trade_rental_inspections.sql", import.meta.url);
const now = "2026-08-24T04:00:00.000Z";

async function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE trade_team_member_credentials (id text PRIMARY KEY, file_id text NOT NULL DEFAULT '');
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, firebase_uid text NOT NULL);
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL, service_site_id text NOT NULL
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL
    );
  `);
  const migration = await readFile(migrationUrl, "utf8");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) database.exec(definition.sql);
  return { database, migration };
}

function seedAssessment(database) {
  database.prepare("INSERT INTO trade_work_orders (id, firebase_uid) VALUES (?, ?)").run("job-a", "owner-a");
  database.prepare("INSERT INTO trade_work_orders (id, firebase_uid) VALUES (?, ?)").run("job-b", "owner-b");
  database.prepare("INSERT INTO trade_crm_job_details (id, work_order_id, firebase_uid, service_site_id) VALUES (?, ?, ?, ?)")
    .run("detail-a", "job-a", "owner-a", "site-a");
  database.prepare("INSERT INTO trade_crm_job_details (id, work_order_id, firebase_uid, service_site_id) VALUES (?, ?, ?, ?)")
    .run("detail-b", "job-b", "owner-b", "site-b");
  database.prepare(`INSERT INTO trade_rental_inspections
    (id, work_order_id, firebase_uid, service_site_id, inspection_number, template_key,
     template_version, rules_effective_from, module_selection_snapshot, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'vic-rental-minimum-standards', 1, '2026-06-30', ?, ?, ?, ?)`)
    .run("inspection-a", "job-a", "owner-a", "site-a", "RMS-1001",
      JSON.stringify(["minimum_standards"]), "owner-a", now, now);
  database.prepare(`INSERT INTO trade_rental_inspection_modules
    (id, inspection_id, firebase_uid, module_key, required, template_version, template_name,
     required_capability, template_snapshot, created_at, updated_at)
    VALUES (?, ?, ?, 'minimum_standards', 1, 1, 'Minimum standards', 'qualified_assessor', ?, ?, ?)`)
    .run("module-a", "inspection-a", "owner-a", JSON.stringify({ key: "minimum_standards" }), now, now);
  database.prepare(`INSERT INTO trade_rental_inspection_items
    (id, inspection_id, module_id, firebase_uid, item_key, section_key, check_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("item-a", "inspection-a", "module-a", "owner-a", "minimum:locks:entry", "locks", "entry", now, now);
  database.prepare(`INSERT INTO trade_rental_findings
    (id, inspection_id, module_id, item_id, firebase_uid, finding_key, category, title,
     finding_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'minimum_standard', 'Repair entry lock', 'non_compliant', ?, ?)`)
    .run("finding-a", "inspection-a", "module-a", "item-a", "owner-a", "finding:item-a", now, now);
  database.prepare("INSERT INTO trade_crm_job_media (id, work_order_id, firebase_uid) VALUES (?, ?, ?)")
    .run("media-a", "job-a", "owner-a");
  database.prepare("INSERT INTO trade_crm_job_media (id, work_order_id, firebase_uid) VALUES (?, ?, ?)")
    .run("media-b", "job-b", "owner-b");
  database.prepare(`INSERT INTO trade_rental_evidence_links
    (id, inspection_id, module_id, item_id, finding_id, job_media_id, firebase_uid,
     requirement_key, created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("evidence-a", "inspection-a", "module-a", "item-a", "finding-a", "media-a",
      "owner-a", "minimum:locks:entry", "assessor-a", now, now);
}

function stageReport(database, id = "report-a", revision = 1) {
  database.prepare(`INSERT INTO trade_rental_reports
    (id, inspection_id, firebase_uid, report_number, revision, report_snapshot,
     source_snapshot_sha256, staged_at, created_at, updated_at)
    VALUES (?, 'inspection-a', 'owner-a', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, `RMS-1001-R${revision}`, revision, JSON.stringify({ schemaVersion: "tlink-rental-report-v1" }),
      "a".repeat(64), now, now, now);
}

function issueReport(database, id = "report-a") {
  database.prepare("UPDATE trade_rental_inspections SET status = 'issuing', revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'")
    .run(now);
  database.prepare(`UPDATE trade_rental_reports SET status = 'issued', pdf_object_key = 'issued/report-a.pdf',
    pdf_sha256 = ?, pdf_size_bytes = 5000, issued_by_uid = 'assessor-a', issued_by_member_id = 'member-a',
    issuer_snapshot = '{}', issued_at = ?, updated_at = ? WHERE id = ?`)
    .run("b".repeat(64), now, now, id);
  database.prepare(`UPDATE trade_rental_inspections SET status = 'issued', issued_report_id = ?,
    issued_at = ?, revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'`)
    .run(id, now, now);
}

test("rental guards remain Sites-safe and install canonically", async () => {
  const { database, migration } = await fixture();
  assert.doesNotMatch(migration, /CREATE\s+TRIGGER/i);
  assert.ok(TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length >= 30);
  assert.equal(new Set(TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.map((definition) => definition.name)).size,
    TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length);
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) {
    database.exec(definition.sql);
    const installed = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?")
      .get(definition.name);
    assert.equal(canonicalTlinkSchemaGuardSql(installed.sql), canonicalTlinkSchemaGuardSql(definition.sql));
  }
});

test("rental guards reject cross-tenant and cross-job parent relationships", async () => {
  const { database } = await fixture();
  seedAssessment(database);
  assert.throws(() => database.prepare(`INSERT INTO trade_rental_inspection_modules
    (id, inspection_id, firebase_uid, module_key, required, template_version, template_name,
     required_capability, template_snapshot, created_at, updated_at)
    VALUES ('bad-module', 'inspection-a', 'owner-b', 'minimum_standards', 1, 1,
      'Bad', 'qualified_assessor', '{"key":"minimum_standards"}', ?, ?)`)
    .run(now, now), /rental module parent mismatch/);
  assert.throws(() => database.prepare(`INSERT INTO trade_rental_evidence_links
    (id, inspection_id, module_id, item_id, finding_id, job_media_id, firebase_uid,
     requirement_key, created_by_uid, created_at, updated_at)
    VALUES ('bad-evidence', 'inspection-a', 'module-a', 'item-a', 'finding-a', 'media-b',
      'owner-a', 'minimum:locks:entry', 'assessor-a', ?, ?)`)
    .run(now, now), /rental evidence parent mismatch/);
  stageReport(database);
  assert.throws(() => database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, event_type, created_at)
    VALUES ('bad-event', 'inspection-a', 'report-a', 'owner-b', 'tampered', ?)`)
    .run(now), /rental event parent mismatch/);
});

test("issuing and issued assessments are immutable while report access metadata remains usable", async () => {
  const { database } = await fixture();
  seedAssessment(database);
  stageReport(database);
  database.prepare("UPDATE trade_rental_inspections SET status = 'issuing', revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'")
    .run(now);
  assert.throws(() => database.prepare("UPDATE trade_rental_inspection_modules SET answers = '{\"changed\":true}' WHERE id = 'module-a'").run(),
    /issued rental assessment is immutable/);
  database.prepare("UPDATE trade_rental_inspections SET status = 'in_progress', revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'")
    .run(now);
  issueReport(database);
  assert.throws(() => database.prepare("UPDATE trade_rental_reports SET report_snapshot = '{\"schemaVersion\":\"tlink-rental-report-v1\",\"tampered\":true}' WHERE id = 'report-a'").run(),
    /rental report identity is immutable|issued rental report is immutable/);
  assert.throws(() => database.prepare("UPDATE trade_rental_inspection_items SET public_notes = 'changed' WHERE id = 'item-a'").run(),
    /issued rental assessment is immutable/);

  database.prepare(`INSERT INTO trade_rental_report_links
    (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, expires_at,
     created_by_uid, created_at, updated_at)
    VALUES ('link-a', 'report-a', 'inspection-a', 'owner-a', ?, 'encrypted', ?, 'assessor-a', ?, ?)`)
    .run("c".repeat(64), "2026-10-23T04:00:00.000Z", now, now);
  database.prepare(`UPDATE trade_rental_report_links SET view_count = view_count + 1,
    last_viewed_at = ?, updated_at = ? WHERE id = 'link-a'`).run(now, now);
  assert.equal(database.prepare("SELECT view_count FROM trade_rental_report_links WHERE id = 'link-a'").get().view_count, 1);
  assert.throws(() => database.prepare("UPDATE trade_rental_report_links SET token_hash = ? WHERE id = 'link-a'")
    .run("d".repeat(64)), /rental report link identity is immutable/);
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, event_type, summary, created_at)
    VALUES ('event-a', 'inspection-a', 'report-a', 'link-a', 'owner-a', 'viewer', 'viewed', 'Viewed.', ?)`)
    .run(now);
  assert.throws(() => database.prepare("UPDATE trade_rental_inspection_events SET summary = 'changed' WHERE id = 'event-a'").run(), /append only/);
  assert.throws(() => database.prepare("DELETE FROM trade_rental_inspection_events WHERE id = 'event-a'").run(), /append only/);
  database.prepare(`UPDATE trade_rental_report_links SET status = 'revoked', revoked_at = ?,
    token_issue = token_issue + 1, updated_at = ? WHERE id = 'link-a'`).run(now, now);
  assert.throws(() => database.prepare("UPDATE trade_rental_report_links SET view_count = view_count + 1 WHERE id = 'link-a'").run(),
    /rental report link transition is invalid/);
});

test("failed issue recovery and expired-link renewal transitions remain allowed", async () => {
  const { database } = await fixture();
  seedAssessment(database);
  stageReport(database);
  database.prepare("UPDATE trade_rental_inspections SET status = 'issuing', revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'").run(now);
  database.prepare(`UPDATE trade_rental_reports SET pdf_object_key = ?, pdf_sha256 = ?,
    pdf_size_bytes = 100, updated_at = ? WHERE id = 'report-a'`)
    .run("trade-issued-documents/rental-report/report-a/revision-1/planned.pdf", "a".repeat(64), now);
  database.prepare("UPDATE trade_rental_reports SET status = 'failed', updated_at = ? WHERE id = 'report-a'").run(now);
  database.prepare("UPDATE trade_rental_inspections SET status = 'in_progress', revision = revision + 1, updated_at = ? WHERE id = 'inspection-a'").run(now);
  assert.equal(database.prepare("SELECT status FROM trade_rental_inspections WHERE id = 'inspection-a'").get().status, "in_progress");
  database.prepare(`UPDATE trade_rental_reports SET pdf_object_key = '', pdf_sha256 = '',
    pdf_size_bytes = 0, issuer_snapshot = ?, updated_at = ?
    WHERE id = 'report-a' AND status = 'failed'`)
    .run(JSON.stringify({ cleanupCompletedAt: now }), now);
  assert.equal(JSON.parse(database.prepare("SELECT issuer_snapshot FROM trade_rental_reports WHERE id = 'report-a'").get().issuer_snapshot).cleanupCompletedAt, now);

  stageReport(database, "report-b", 2);
  issueReport(database, "report-b");
  database.prepare(`INSERT INTO trade_rental_report_links
    (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, expires_at,
     created_by_uid, created_at, updated_at)
    VALUES ('link-expired', 'report-b', 'inspection-a', 'owner-a', ?, 'encrypted', ?, 'assessor-a', ?, ?)`)
    .run("e".repeat(64), "2026-08-24T04:01:00.000Z", "2026-06-25T04:00:00.000Z", "2026-06-25T04:00:00.000Z");
  database.prepare("UPDATE trade_rental_report_links SET status = 'expired', updated_at = ? WHERE id = 'link-expired'")
    .run("2026-08-24T04:02:00.000Z");
  database.prepare(`INSERT INTO trade_rental_report_links
    (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, expires_at,
     created_by_uid, created_at, updated_at)
    VALUES ('link-renewed', 'report-b', 'inspection-a', 'owner-a', ?, 'encrypted-2', ?, 'assessor-a', ?, ?)`)
    .run("f".repeat(64), "2026-10-23T04:02:00.000Z", "2026-08-24T04:02:00.000Z", "2026-08-24T04:02:00.000Z");
  assert.equal(database.prepare("SELECT status FROM trade_rental_report_links WHERE id = 'link-renewed'").get().status, "active");
});
