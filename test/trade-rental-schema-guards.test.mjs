import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS, ensureTradeRentalSchemaGuards } from "../src/lib/trade-rental-schema-guards.ts";
import { canonicalTlinkSchemaGuardSql } from "../src/lib/tlink-schema-guards.ts";

const migrationUrl = new URL("../drizzle/0160_trade_rental_inspections.sql", import.meta.url);
const now = "2026-08-24T04:00:00.000Z";

async function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE trade_team_member_credentials (id text PRIMARY KEY, file_id text NOT NULL DEFAULT '');
    CREATE TABLE trade_work_orders (id text PRIMARY KEY, firebase_uid text NOT NULL, revision integer, updated_at text, record_status text, partner_type text, source_type text, stage text);
    CREATE TABLE trade_crm_write_guards (firebase_uid text, operation_id text, step_number integer, verified integer, created_at text);
    CREATE TABLE trade_crm_job_details (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL, service_site_id text NOT NULL, customer_source text
    );
    CREATE TABLE trade_crm_job_media (
      id text PRIMARY KEY, work_order_id text NOT NULL, firebase_uid text NOT NULL
    );
  `);
  const migration = await readFile(migrationUrl, "utf8");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  database.exec(`
    ALTER TABLE trade_rental_inspections ADD COLUMN selected_modules_snapshot text;
    ALTER TABLE trade_rental_inspection_modules ADD COLUMN selected_required integer;
  `);
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) database.exec(definition.sql);
  return { database, migration };
}

function testD1(database) {
  return {
    prepare(sql) {
      return { sql, async all() { return { results: database.prepare(sql).all() }; } };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        for (const statement of statements) database.exec(statement.sql);
        database.exec("COMMIT");
        return statements.map(() => ({ success: true }));
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("rental guard verification does not inherit another request's stalled or cancelled I/O", async () => {
  const { database } = await fixture();
  const base = testD1(database);
  const parked = Promise.withResolvers();
  let reads = 0;
  const d1 = {
    ...base,
    prepare(sql) {
      const statement = base.prepare(sql);
      return {
        ...statement,
        async all() {
          reads += 1;
          if (reads === 1) await parked.promise;
          return statement.all();
        },
      };
    },
  };
  const interrupted = ensureTradeRentalSchemaGuards(d1).catch((error) => error);
  let timer;
  try {
    await Promise.race([
      ensureTradeRentalSchemaGuards(d1),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The new request inherited stalled rental I/O")), 1000); }),
    ]);
    const completedReads = reads;
    assert.ok(completedReads > 1, "The second request independently checked the schema");
    parked.reject(new Error("Original request disconnected"));
    assert.match((await interrupted).message, /Original request disconnected/);
    await ensureTradeRentalSchemaGuards(d1);
    assert.equal(reads, completedReads, "Completed readiness remains cached after the first request fails");
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'trigger'").get().total,
      TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length);
  } finally {
    clearTimeout(timer);
    parked.reject(new Error("Fixture cleanup"));
    await interrupted;
    database.close();
  }
});

test("rental guard verification caches only completed checks and retries a failed request", async () => {
  const { database } = await fixture();
  const base = testD1(database);
  let reads = 0;
  const d1 = {
    ...base,
    prepare(sql) {
      const statement = base.prepare(sql);
      return {
        ...statement,
        async all() {
          reads += 1;
          if (reads === 1) throw new Error("D1 unavailable");
          return statement.all();
        },
      };
    },
  };
  try {
    await assert.rejects(ensureTradeRentalSchemaGuards(d1), /D1 unavailable/);
    await ensureTradeRentalSchemaGuards(d1);
    const completedReads = reads;
    await ensureTradeRentalSchemaGuards(d1);
    assert.equal(reads, completedReads);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'trigger'").get().total,
      TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length);
  } finally { database.close(); }
});

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

function stageReport(database, id = "report-a", revision = 1, snapshot = { schemaVersion: "tlink-rental-report-v1" }) {
  database.prepare(`INSERT INTO trade_rental_reports
    (id, inspection_id, firebase_uid, report_number, revision, report_snapshot,
     source_snapshot_sha256, staged_at, created_at, updated_at)
    VALUES (?, 'inspection-a', 'owner-a', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, `RMS-1001-R${revision}`, revision, JSON.stringify(snapshot),
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

const correctedAt = "2026-08-24T05:00:00.000Z";

async function formattingFixture(t, changeSnapshot = () => {}, changeOriginal = () => {}) {
  const { database } = await fixture();
  t.after(() => database.close());
  seedAssessment(database);
  const original = {
    schemaVersion: "tlink-rental-report-v1",
    report: { id: "report-a", number: "RMS-1001-R1", revision: 1, issuedAt: now, generatedAt: now, branding: { name: "AEA" } },
    inspection: { assessmentDate: "2026-08-23" },
    issuer: { name: "Original Assessor", authenticatedAt: now },
    modules: [{ answers: { ceilingJoistGap: 400 } }],
    findings: [{ title: "Wall vents", count: 5 }],
    evidence: [{ id: "photo-a", originalSha256: "e".repeat(64), capture: { capturedAt: now },
      objectKey: "trade-issued-documents/rental-report/report-a/revision-1/evidence/photo-a.jpg" }],
  };
  changeOriginal(original);
  stageReport(database, "report-a", 1, original);
  issueReport(database);
  database.prepare("UPDATE trade_work_orders SET stage = 'completed' WHERE id = 'job-a'").run();
  const inspection = database.prepare("SELECT * FROM trade_rental_inspections WHERE id = 'inspection-a'").get();
  const corrected = structuredClone(original);
  corrected.report = { ...corrected.report, id: "f0edb746-138c-4c5a-b21b-6e51b12410bb", number: "RMS-1001-R2", revision: 2,
    issuedAt: correctedAt, generatedAt: correctedAt,
    formattingCorrection: { sourceReportId: "report-a", sourceReportNumber: "RMS-1001-R1", sourceReportRevision: 1, sourceIssuedAt: now } };
  corrected.evidence[0].objectKey = "trade-issued-documents/rental-report/f0edb746-138c-4c5a-b21b-6e51b12410bb/revision-2/evidence/photo-a.jpg";
  changeSnapshot(corrected);
  database.prepare(`INSERT INTO trade_rental_reports
    (id, inspection_id, firebase_uid, report_number, revision, report_snapshot, source_snapshot_sha256,
     issued_by_uid, issued_by_member_id, issuer_snapshot, staged_at, created_at, updated_at)
    VALUES ('f0edb746-138c-4c5a-b21b-6e51b12410bb', 'inspection-a', 'owner-a', 'RMS-1001-R2', 2, ?, ?, 'assessor-a', 'member-a', '{}', ?, ?, ?)`)
    .run(JSON.stringify(corrected), "d".repeat(64), correctedAt, correctedAt, correctedAt);
  const metadata = { sourceReportId: "report-a", sourceReportNumber: "RMS-1001-R1", sourceReportRevision: 1,
    sourceSnapshotSha256: "a".repeat(64), sourceIssuedAt: now, expectedInspectionRevision: inspection.revision,
    reportRevision: 2, snapshotSha256: "d".repeat(64) };
  return { database, inspection, metadata, original };
}

function reviewHold(database, eventType = "report_email_review_held", actorType = "owner", actorUid = "owner-a") {
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, created_at)
    VALUES (?, 'inspection-a', 'report-a', 'owner-a', ?, ?, ?, ?)`)
    .run(`review-${database.prepare("SELECT COUNT(*) AS total FROM trade_rental_inspection_events").get().total}`, actorType, actorUid, eventType, correctedAt);
}

function requestFormatting(database, metadata, actorType = "owner", actorUid = "owner-a") {
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
    VALUES ('format-request', 'inspection-a', 'f0edb746-138c-4c5a-b21b-6e51b12410bb', 'owner-a', ?, ?, 'report_formatting_revision_requested', 'format:request', ?, ?)`)
    .run(actorType, actorUid, JSON.stringify(metadata), correctedAt);
}

function issueFormatting(database, issuer = {}, reportId = "f0edb746-138c-4c5a-b21b-6e51b12410bb") {
  database.prepare(`UPDATE trade_rental_reports SET status = 'issued', pdf_object_key = 'issued/corrected.pdf',
    pdf_sha256 = ?, pdf_size_bytes = 5000, issued_by_uid = ?, issued_by_member_id = ?,
    issuer_snapshot = ?, issued_at = ?, updated_at = ? WHERE id = ?`)
    .run("b".repeat(64), issuer.uid || "assessor-a", issuer.memberId || "member-a", JSON.stringify(issuer.snapshot || {}), correctedAt, correctedAt, reportId);
}

function correctInspectionPointer(database, revision, extraSql = "") {
  database.prepare(`UPDATE trade_rental_inspections SET issued_report_id = 'f0edb746-138c-4c5a-b21b-6e51b12410bb',
    revision = ?, updated_at = ? ${extraSql} WHERE id = 'inspection-a'`).run(revision, correctedAt);
}

function formattingLink(database) {
  database.prepare(`INSERT INTO trade_rental_report_links
    (id, report_id, inspection_id, firebase_uid, token_hash, encrypted_token, expires_at, created_by_uid, created_at, updated_at)
    VALUES ('corrected-link', 'f0edb746-138c-4c5a-b21b-6e51b12410bb', 'inspection-a', 'owner-a', ?, 'encrypted', '2026-10-23T05:00:00.000Z', 'owner-a', ?, ?)`)
    .run("f".repeat(64), correctedAt, correctedAt);
}

function formattingIssuedEvent(database, metadata) {
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
    VALUES ('format-issued', 'inspection-a', 'f0edb746-138c-4c5a-b21b-6e51b12410bb', 'corrected-link', 'owner-a', 'owner', 'owner-a',
      'report_formatting_revision_issued', 'format:issued', ?, ?)`).run(JSON.stringify(metadata), correctedAt);
}

test("owner formatting revision preserves the original assessment, report, evidence and complete job", async (t) => {
  const { database, inspection, metadata } = await formattingFixture(t);
  const originalReport = database.prepare("SELECT * FROM trade_rental_reports WHERE id = 'report-a'").get();
  const originalAnswers = database.prepare("SELECT * FROM trade_rental_inspection_items WHERE id = 'item-a'").get();
  reviewHold(database);
  requestFormatting(database, metadata);
  database.exec("BEGIN");
  try {
    issueFormatting(database);
    correctInspectionPointer(database, inspection.revision + 1);
    formattingLink(database);
    formattingIssuedEvent(database, metadata);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const result = database.prepare("SELECT * FROM trade_rental_inspections WHERE id = 'inspection-a'").get();
  assert.equal(result.status, "issued");
  assert.equal(result.issued_report_id, "f0edb746-138c-4c5a-b21b-6e51b12410bb");
  assert.equal(result.issued_at, inspection.issued_at);
  assert.equal(result.revision, inspection.revision + 1);
  for (const key of Object.keys(inspection).filter((key) => !["issued_report_id", "revision", "updated_at"].includes(key))) {
    assert.equal(result[key], inspection[key], key);
  }
  assert.deepEqual(database.prepare("SELECT * FROM trade_rental_reports WHERE id = 'report-a'").get(), originalReport);
  assert.deepEqual(database.prepare("SELECT * FROM trade_rental_inspection_items WHERE id = 'item-a'").get(), originalAnswers);
  assert.equal(database.prepare("SELECT stage FROM trade_work_orders WHERE id = 'job-a'").get().stage, "completed");
  assert.equal(database.prepare("SELECT status FROM trade_rental_reports WHERE id = 'f0edb746-138c-4c5a-b21b-6e51b12410bb'").get().status, "issued");
  assert.throws(() => database.prepare("UPDATE trade_rental_inspection_items SET public_notes = 'changed' WHERE id = 'item-a'").run(), /issued rental assessment is immutable/);
  assert.throws(() => correctInspectionPointer(database, result.revision + 1, ", issued_report_id = 'report-a'"), /rental inspection.*invalid|issued rental inspection is immutable/);
});

test("a staged report cannot issue or replace the current pointer without a validated owner request", async (t) => {
  const { database, inspection } = await formattingFixture(t);
  reviewHold(database);
  assert.throws(() => issueFormatting(database), /rental report transition is invalid/);
  assert.throws(() => correctInspectionPointer(database, inspection.revision + 1), /rental inspection.*invalid|issued rental inspection is immutable/);
  assert.equal(database.prepare("SELECT issued_report_id FROM trade_rental_inspections WHERE id = 'inspection-a'").get().issued_report_id, "report-a");
});

test("formatting requests bind owner, source identity, current inspection revision and new report hash", async (t) => {
  for (const [key, value] of [
    ["sourceReportId", "other-report"], ["sourceReportNumber", "RMS-OTHER-R1"], ["sourceReportRevision", 8],
    ["sourceSnapshotSha256", "9".repeat(64)], ["sourceIssuedAt", correctedAt], ["expectedInspectionRevision", 99],
    ["reportRevision", 10], ["snapshotSha256", "8".repeat(64)],
  ]) {
    await t.test(key, async (st) => {
      const { database, metadata } = await formattingFixture(st);
      reviewHold(database);
      assert.throws(() => requestFormatting(database, { ...metadata, [key]: value }), /formatting request is invalid/);
    });
  }
  for (const [actorType, actorUid] of [["owner", "owner-b"], ["assessor", "owner-a"], ["system", "owner-a"]]) {
    await t.test(`${actorType}:${actorUid}`, async (st) => {
      const { database, metadata } = await formattingFixture(st);
      reviewHold(database);
      assert.throws(() => requestFormatting(database, metadata, actorType, actorUid), /formatting request is invalid/);
    });
  }
});

test("formatting requests cannot alter assessed facts, issuer, branding or evidence beyond copied object keys", async (t) => {
  const changes = {
    answer: (snapshot) => { snapshot.modules[0].answers.ceilingJoistGap = 500; },
    assessmentDate: (snapshot) => { snapshot.inspection.assessmentDate = "2026-08-24"; },
    issuer: (snapshot) => { snapshot.issuer.name = "Business Owner"; },
    branding: (snapshot) => { snapshot.report.branding.name = "Other business"; },
    sourceIssuedAt: (snapshot) => { snapshot.report.formattingCorrection.sourceIssuedAt = correctedAt; },
    reportIdentity: (snapshot) => { snapshot.report.revision = 3; },
    evidenceIdentity: (snapshot) => { snapshot.evidence[0].id = "other-photo"; },
    evidenceHash: (snapshot) => { snapshot.evidence[0].originalSha256 = "0".repeat(64); },
    evidenceCount: (snapshot) => { snapshot.evidence = []; },
    evidenceObject: (snapshot) => { snapshot.evidence[0].objectKey = "other-tenant/photo.jpg"; },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async (st) => {
      const { database, metadata } = await formattingFixture(st, change);
      reviewHold(database);
      assert.throws(() => requestFormatting(database, metadata), /formatting request is invalid/);
    });
  }
});

test("formatting revision requires an owner email hold and rejects delivery already in flight", async (t) => {
  for (const variant of ["no hold", "released", "non-owner hold", "accepted", "inflight", "indeterminate"]) {
    await t.test(variant, async (st) => {
      const { database, metadata } = await formattingFixture(st);
      if (variant === "non-owner hold") reviewHold(database, "report_email_review_held", "assessor", "assessor-a");
      else if (variant !== "no hold") reviewHold(database);
      if (variant === "released") reviewHold(database, "report_email_review_released");
      if (["accepted", "inflight", "indeterminate"].includes(variant)) {
        const event = variant === "accepted" ? "report_email_accepted" : variant === "inflight" ? "report_email_requested" : "report_email_failed";
        database.prepare(`INSERT INTO trade_rental_inspection_events
          (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
          VALUES ('delivery', 'inspection-a', 'report-a', 'owner-a', 'assessor', 'assessor-a', ?, 'send:request', ?, ?)`)
          .run(event, JSON.stringify(variant === "indeterminate" ? { outcome: "indeterminate" } : {}), correctedAt);
      }
      assert.throws(() => requestFormatting(database, metadata), /formatting request is invalid/);
    });
  }
});

test("a released hold or changed issuer cannot be bypassed at the final formatting commit", async (t) => {
  for (const variant of ["released", "issuer uid", "issuer member", "issuer snapshot", "inspection revision", "assessment mutation"]) {
    await t.test(variant, async (st) => {
      const { database, inspection, metadata } = await formattingFixture(st);
      reviewHold(database);
      requestFormatting(database, metadata);
      if (variant === "released") {
        reviewHold(database, "report_email_review_released");
        assert.throws(() => issueFormatting(database), /rental report transition is invalid/);
      } else if (variant.startsWith("issuer")) {
        const changes = variant === "issuer uid" ? { uid: "owner-a" }
          : variant === "issuer member" ? { memberId: "other-member" } : { snapshot: { name: "other issuer" } };
        assert.throws(() => issueFormatting(database, changes), /rental report transition is invalid/);
      } else {
        issueFormatting(database);
        assert.throws(() => correctInspectionPointer(database,
          inspection.revision + (variant === "inspection revision" ? 2 : 1),
          variant === "assessment mutation" ? ", assessor_uid = 'owner-a'" : ""), /rental inspection.*invalid|issued rental inspection is immutable/);
      }
      assert.equal(database.prepare("SELECT issued_report_id FROM trade_rental_inspections WHERE id = 'inspection-a'").get().issued_report_id, "report-a");
    });
  }
});

test("invalid final formatting audit rolls back the issued PDF pointer and link together", async (t) => {
  const { database, inspection, metadata } = await formattingFixture(t);
  reviewHold(database);
  requestFormatting(database, metadata);
  database.exec("BEGIN");
  try {
    issueFormatting(database);
    correctInspectionPointer(database, inspection.revision + 1);
    formattingLink(database);
    assert.throws(() => formattingIssuedEvent(database, { ...metadata, snapshotSha256: "0".repeat(64) }), /formatting issue event is invalid/);
  } finally { database.exec("ROLLBACK"); }
  assert.equal(database.prepare("SELECT issued_report_id FROM trade_rental_inspections WHERE id = 'inspection-a'").get().issued_report_id, "report-a");
  assert.equal(database.prepare("SELECT status FROM trade_rental_reports WHERE id = 'f0edb746-138c-4c5a-b21b-6e51b12410bb'").get().status, "staged");
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM trade_rental_report_links WHERE id = 'corrected-link'").get().total, 0);
});

test("two formatting requests from the same source cannot both replace the current report", async (t) => {
  const { database, inspection, metadata } = await formattingFixture(t);
  reviewHold(database);
  requestFormatting(database, metadata);
  const contenderId = "328e9c29-07f5-4aa1-be73-3b5b6d1a9185";
  const contender = JSON.parse(database.prepare("SELECT report_snapshot FROM trade_rental_reports WHERE id = 'f0edb746-138c-4c5a-b21b-6e51b12410bb'").get().report_snapshot);
  contender.report.id = contenderId;
  contender.report.number = "RMS-1001-R3";
  contender.report.revision = 3;
  contender.evidence[0].objectKey = `trade-issued-documents/rental-report/${contenderId}/revision-3/evidence/photo-a.jpg`;
  database.prepare(`INSERT INTO trade_rental_reports
    (id, inspection_id, firebase_uid, report_number, revision, report_snapshot, source_snapshot_sha256,
     staged_at, created_at, updated_at) VALUES (?, 'inspection-a', 'owner-a', 'RMS-1001-R3', 3, ?, ?, ?, ?, ?)`)
    .run(contenderId, JSON.stringify(contender), "c".repeat(64), correctedAt, correctedAt, correctedAt);
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
    VALUES ('contender-request', 'inspection-a', ?, 'owner-a', 'owner', 'owner-a',
      'report_formatting_revision_requested', 'format:contender', ?, ?)`)
    .run(contenderId, JSON.stringify({ ...metadata, reportRevision: 3, snapshotSha256: "c".repeat(64) }), correctedAt);
  issueFormatting(database);
  correctInspectionPointer(database, inspection.revision + 1);
  formattingLink(database);
  formattingIssuedEvent(database, metadata);
  assert.throws(() => issueFormatting(database, {}, contenderId), /rental report transition is invalid/);
  assert.equal(database.prepare("SELECT status FROM trade_rental_reports WHERE id = ?").get(contenderId).status, "staged");
  assert.equal(database.prepare("SELECT issued_report_id FROM trade_rental_inspections WHERE id = 'inspection-a'").get().issued_report_id, "f0edb746-138c-4c5a-b21b-6e51b12410bb");
});

const coolingItemId = "cooling-item-a";
const coolingAccessPath = "$.modules[0].sections[0].items[0].response.accessStatus";

async function coolingAccessFixture(t, changeSnapshot = () => {}, changeOriginal = () => {}, includeFindingCopy = true) {
  const correction = { sourceReportId: "report-a", sourceReportNumber: "RMS-1001-R1", sourceReportRevision: 1,
    sourceIssuedAt: now, field: "accessStatus", fieldPath: coolingAccessPath, checkKey: "cooling_2027_readiness",
    itemId: coolingItemId, fromValue: "Not accessed", toValue: "Clear access", correctedByOwnerUid: "owner-a", correctedAt };
  const result = await formattingFixture(t, (snapshot) => {
    delete snapshot.report.formattingCorrection;
    snapshot.report.answerCorrection = correction;
    snapshot.modules[0].sections[0].items[0].response.accessStatus = "Clear access";
    if (includeFindingCopy) snapshot.findings[0].details.responseSnapshot.accessStatus = "Clear access";
    changeSnapshot(snapshot);
  }, (original) => {
    original.modules[0].sections = [{ key: "cooling", items: [
      { id: coolingItemId, checkKey: "cooling_2027_readiness", outcome: "does_not_meet",
        response: { applianceType: "No fixed cooling", accessStatus: "Not accessed", limitationStatus: "No limitation" } },
      { id: "other-item", checkKey: "heating_2027_readiness", outcome: "meets",
        response: { applianceType: "Split system", accessStatus: "Not accessed", limitationStatus: "Not accessible" } },
    ] }];
    original.findings = [
      { id: "cooling-finding", itemId: coolingItemId, status: "recommendation", title: "Cooling upgrade needed", details: {
        ...(includeFindingCopy ? { responseSnapshot: { applianceType: "No fixed cooling", accessStatus: "Not accessed", limitationStatus: "No limitation" } } : {}),
      } },
      { id: "other-finding", itemId: "other-item", status: "compliant", details: { responseSnapshot: { accessStatus: "Not accessed" } } },
    ];
    changeOriginal(original);
  });
  return { ...result, metadata: { ...result.metadata, ...correction } };
}

function requestCoolingAccess(database, metadata) {
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
    VALUES ('answer-request', 'inspection-a', 'f0edb746-138c-4c5a-b21b-6e51b12410bb', 'owner-a', 'owner', 'owner-a',
      'report_answer_revision_requested', 'answer:request', ?, ?)`).run(JSON.stringify(metadata), correctedAt);
}

function coolingAccessIssuedEvent(database, metadata) {
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid, event_type, request_id, metadata, created_at)
    VALUES ('answer-issued', 'inspection-a', 'f0edb746-138c-4c5a-b21b-6e51b12410bb', 'corrected-link', 'owner-a', 'owner', 'owner-a',
      'report_answer_revision_issued', 'answer:issued', ?, ?)`).run(JSON.stringify(metadata), correctedAt);
}

test("owner answer revision changes only no-cooling access and its existing finding copy", async (t) => {
  for (const includeFindingCopy of [true, false]) {
    await t.test(includeFindingCopy ? "finding copy present" : "finding copy absent", async (st) => {
      const { database, inspection, metadata, original } = await coolingAccessFixture(st, () => {}, () => {}, includeFindingCopy);
      const sourceReport = database.prepare("SELECT * FROM trade_rental_reports WHERE id = 'report-a'").get();
      reviewHold(database);
      requestCoolingAccess(database, metadata);
      database.exec("BEGIN");
      try {
        issueFormatting(database);
        correctInspectionPointer(database, inspection.revision + 1);
        formattingLink(database);
        coolingAccessIssuedEvent(database, metadata);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
      const corrected = JSON.parse(database.prepare("SELECT report_snapshot FROM trade_rental_reports WHERE id = 'f0edb746-138c-4c5a-b21b-6e51b12410bb'").get().report_snapshot);
      assert.equal(corrected.modules[0].sections[0].items[0].response.accessStatus, "Clear access");
      assert.equal(corrected.modules[0].sections[0].items[0].response.limitationStatus, "No limitation");
      assert.equal(corrected.modules[0].sections[0].items[0].outcome, "does_not_meet");
      assert.equal(corrected.modules[0].sections[0].items[0].response.applianceType, "No fixed cooling");
      assert.deepEqual(corrected.modules[0].sections[0].items[1], original.modules[0].sections[0].items[1]);
      assert.deepEqual(corrected.findings[1], original.findings[1]);
      assert.equal(corrected.issuer.authenticatedAt, now);
      assert.deepEqual(database.prepare("SELECT * FROM trade_rental_reports WHERE id = 'report-a'").get(), sourceReport);
      assert.equal(database.prepare("SELECT issued_at FROM trade_rental_inspections WHERE id = 'inspection-a'").get().issued_at, now);
      assert.equal(database.prepare("SELECT stage FROM trade_work_orders WHERE id = 'job-a'").get().stage, "completed");
      assert.throws(() => database.prepare("UPDATE trade_rental_inspection_items SET response_json = '{\"accessStatus\":\"Clear access\"}' WHERE id = 'item-a'").run(), /issued rental assessment is immutable/);
    });
  }
});

test("the formatting-only action still rejects the authorised answer change without the answer journal", async (t) => {
  const { database, metadata } = await coolingAccessFixture(t, (snapshot) => {
    snapshot.report.formattingCorrection = { sourceReportId: "report-a", sourceReportNumber: "RMS-1001-R1", sourceReportRevision: 1, sourceIssuedAt: now };
    delete snapshot.report.answerCorrection;
  });
  reviewHold(database);
  assert.throws(() => requestFormatting(database, metadata), /formatting request is invalid/);
  assert.throws(() => issueFormatting(database), /rental report transition is invalid/);
});

test("cooling answer metadata binds exactly the access field, actual item path and owner correction", async (t) => {
  for (const [key, value] of [
    ["field", "limitationStatus"], ["fieldPath", "$.modules[0].sections[0].items[0].response.limitationStatus"],
    ["fieldPath", "$.modules[0].sections[0].items[1].response.accessStatus"], ["itemId", "other-item"],
    ["checkKey", "heating_2027_readiness"], ["fromValue", "Not accessible"], ["toValue", "No limitation"],
    ["correctedByOwnerUid", "owner-b"], ["correctedAt", now], ["sourceSnapshotSha256", "0".repeat(64)],
  ]) {
    await t.test(`${key}:${value}`, async (st) => {
      const { database, metadata } = await coolingAccessFixture(st);
      reviewHold(database);
      assert.throws(() => requestCoolingAccess(database, { ...metadata, [key]: value }), /answer request is invalid/);
    });
  }
});

test("cooling answer revision rejects any other observation, limitation, finding, issuer or audit mutation", async (t) => {
  const changes = {
    limitation: (snapshot) => { snapshot.modules[0].sections[0].items[0].response.limitationStatus = "Not accessible"; },
    outcome: (snapshot) => { snapshot.modules[0].sections[0].items[0].outcome = "meets"; },
    appliance: (snapshot) => { snapshot.modules[0].sections[0].items[0].response.applianceType = "Split system"; },
    otherCheck: (snapshot) => { snapshot.modules[0].sections[0].items[1].response.accessStatus = "Clear access"; },
    missingCopy: (snapshot) => { snapshot.findings[0].details.responseSnapshot.accessStatus = "Not accessed"; },
    copyLimitation: (snapshot) => { snapshot.findings[0].details.responseSnapshot.limitationStatus = "Not accessible"; },
    findingStatus: (snapshot) => { snapshot.findings[0].status = "compliant"; },
    unrelatedFinding: (snapshot) => { snapshot.findings[1].details.responseSnapshot.accessStatus = "Clear access"; },
    issuer: (snapshot) => { snapshot.issuer.name = "Owner"; },
    correctionOwner: (snapshot) => { snapshot.report.answerCorrection.correctedByOwnerUid = "owner-b"; },
    correctionTime: (snapshot) => { snapshot.report.answerCorrection.correctedAt = now; },
    originalDate: (snapshot) => { snapshot.inspection.assessmentDate = "2026-08-24"; },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async (st) => {
      const { database, metadata } = await coolingAccessFixture(st, change);
      reviewHold(database);
      assert.throws(() => requestCoolingAccess(database, metadata), /answer request is invalid/);
    });
  }
});

test("cooling answer correction requires one no-fixed-cooling source with its original Not accessed value", async (t) => {
  const changes = {
    alreadyClear: (original) => { original.modules[0].sections[0].items[0].response.accessStatus = "Clear access"; },
    fixedCooling: (original) => { original.modules[0].sections[0].items[0].response.applianceType = "Split system"; },
    duplicateCooling: (original) => { original.modules[0].sections[0].items.push(structuredClone(original.modules[0].sections[0].items[0])); },
    missingCooling: (original) => { original.modules[0].sections[0].items[0].checkKey = "different_check"; },
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async (st) => {
      const { database, metadata } = await coolingAccessFixture(st, () => {}, change);
      reviewHold(database);
      assert.throws(() => requestCoolingAccess(database, metadata), /answer request is invalid/);
    });
  }
});

test("an owner must keep the email held through the final cooling answer revision", async (t) => {
  const { database, metadata } = await coolingAccessFixture(t);
  assert.throws(() => requestCoolingAccess(database, metadata), /answer request is invalid/);
  reviewHold(database);
  requestCoolingAccess(database, metadata);
  reviewHold(database, "report_email_review_released");
  assert.throws(() => issueFormatting(database), /rental report transition is invalid/);
});

async function releasedGuardFixture(database) {
  const source = await readFile(new URL("../src/lib/trade-rental-schema-guards.ts", import.meta.url), "utf8");
  const released = [
    ["trade_rental_inspections_issue_transition_guard", "legacyInspectionIssueInvalid", "trade_rental_inspections", "rental inspection issue transition is invalid", "99490d2ab75e75f972c4e8549a79dac790413cfa06e38a654ad5d49efe19a7be"],
    ["trade_rental_inspections_terminal_immutable", "legacyTerminalInspectionChanged", "trade_rental_inspections", "issued rental inspection is immutable", "b6ef1ac24efdabc82b5939f5f3cdeac1106f9f6cf90e791e7acaf39e3b342e62"],
    ["trade_rental_reports_transition_guard", "legacyReportTransitionInvalid", "trade_rental_reports", "rental report transition is invalid", "e8063fef900ea8aa5af5aae25103a0dfa1465d61232abf7fc79f085315b72f13"],
  ];
  const previous = new Map();
  for (const [name, constant, table, message, fingerprint] of released) {
    const when = source.match(new RegExp(`const ${constant} = \x60([^\x60]+)\x60;`))?.[1];
    assert.ok(when, `Retained released SQL for ${name}`);
    const sql = `CREATE TRIGGER IF NOT EXISTS \`${name}\` BEFORE UPDATE ON \`${table}\` FOR EACH ROW WHEN ${when} BEGIN SELECT RAISE(ABORT, '${message}'); END;`;
    // Fingerprints come from released b57007db. No Git executable or history is
    // needed at test runtime, and accidental legacy changes cannot self-pass.
    assert.equal(createHash("sha256").update(canonicalTlinkSchemaGuardSql(sql)).digest("hex"), fingerprint);
    database.exec(`DROP TRIGGER \`${name}\``);
    database.exec(sql);
    previous.set(name, sql);
  }
  database.exec(`DROP TRIGGER trade_rental_formatting_request_guard_insert;
    DROP TRIGGER trade_rental_formatting_issued_guard_insert;
    DROP TRIGGER trade_rental_answer_request_guard_insert;
    DROP TRIGGER trade_rental_answer_issued_guard_insert;`);
  return previous;
}

test("runtime upgrade replaces only the three exact released guards and installs formatting event guards", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const previous = await releasedGuardFixture(database);
  const immutableBefore = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'trade_rental_reports_terminal_immutable'").get().sql;
  await ensureTradeRentalSchemaGuards(testD1(database));
  for (const name of previous.keys()) {
    const expected = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.find((definition) => definition.name === name);
    assert.equal(canonicalTlinkSchemaGuardSql(database.prepare("SELECT sql FROM sqlite_schema WHERE name = ?").get(name).sql), canonicalTlinkSchemaGuardSql(expected.sql));
  }
  assert.equal(database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'trade_rental_reports_terminal_immutable'").get().sql, immutableBefore);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'trigger'").get().total, TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length);
});

test("runtime upgrade rejects unknown installed SQL before replacing any rental guard", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const previous = await releasedGuardFixture(database);
  const name = "trade_rental_reports_transition_guard";
  const unexpected = previous.get(name).replace("FOR EACH ROW WHEN", "FOR EACH ROW WHEN 1 = 0 AND");
  database.exec(`DROP TRIGGER \`${name}\``);
  database.exec(unexpected);
  await assert.rejects(ensureTradeRentalSchemaGuards(testD1(database)), /TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:trade_rental_reports_transition_guard/);
  for (const [guardName, sql] of previous) {
    assert.equal(canonicalTlinkSchemaGuardSql(database.prepare("SELECT sql FROM sqlite_schema WHERE name = ?").get(guardName).sql),
      canonicalTlinkSchemaGuardSql(guardName === name ? unexpected : sql));
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name = 'trade_rental_formatting_request_guard_insert'").get().total, 0);
});

test("runtime guard upgrade rolls back failed DDL as a unit and retries without cached readiness", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const previous = await releasedGuardFixture(database);
  const base = testD1(database);
  let fail = true;
  const d1 = { ...base, async batch(statements) {
    if (fail && statements.some((statement) => statement.sql.startsWith("DROP TRIGGER"))) {
      fail = false;
      return base.batch([...statements, base.prepare("CREATE TRIGGER intentionally invalid SQL")]);
    }
    return base.batch(statements);
  } };
  await assert.rejects(ensureTradeRentalSchemaGuards(d1), /syntax error/);
  for (const [name, sql] of previous) {
    assert.equal(canonicalTlinkSchemaGuardSql(database.prepare("SELECT sql FROM sqlite_schema WHERE name = ?").get(name).sql), canonicalTlinkSchemaGuardSql(sql));
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name = 'trade_rental_formatting_request_guard_insert'").get().total, 0);
  await ensureTradeRentalSchemaGuards(d1);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'trigger'").get().total, TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.length);
});

function sites839AnswerGuardSql() {
  const current = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.find((definition) => definition.name === "trade_rental_answer_request_guard_insert");
  const previous = current.sql
    .replace("AND (json_extract(NEW.metadata, '$.field')", "AND json_extract(NEW.metadata, '$.field')")
    .replace("= json_extract(NEW.metadata, '$.correctedAt'))\n    AND json_remove", "= json_extract(NEW.metadata, '$.correctedAt')\n    AND json_remove");
  assert.equal(createHash("sha256").update(canonicalTlinkSchemaGuardSql(previous)).digest("hex"),
    "437e583ab4cb92ea2ae49024868a0824e7400a3c16e24cd5d1978eb560fc4faa");
  return previous;
}

test("runtime upgrade recognises only the exact already-installed Sites 839 answer guard", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const previous = sites839AnswerGuardSql();
  database.exec("DROP TRIGGER trade_rental_answer_request_guard_insert");
  database.exec(previous);
  await ensureTradeRentalSchemaGuards(testD1(database));
  const expected = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.find((definition) => definition.name === "trade_rental_answer_request_guard_insert");
  assert.equal(canonicalTlinkSchemaGuardSql(database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'trade_rental_answer_request_guard_insert'").get().sql),
    canonicalTlinkSchemaGuardSql(expected.sql));
  database.exec("DROP TRIGGER trade_rental_answer_request_guard_insert");
  const unexpected = previous.replace("FOR EACH ROW WHEN", "FOR EACH ROW WHEN 1 = 0 AND");
  database.exec(unexpected);
  await assert.rejects(ensureTradeRentalSchemaGuards(testD1(database)), /TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:trade_rental_answer_request_guard_insert/);
  assert.equal(canonicalTlinkSchemaGuardSql(database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'trade_rental_answer_request_guard_insert'").get().sql), canonicalTlinkSchemaGuardSql(unexpected));
});

test("rental correction statements compile with D1's expression depth limit of 100", async (t) => {
  const { database } = await fixture();
  t.after(() => database.close());
  const schema = database.prepare("SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").all();
  const probes = [
    "INSERT INTO trade_rental_reports (id,inspection_id,firebase_uid,report_number,revision,report_snapshot,source_snapshot_sha256,staged_at,created_at,updated_at) SELECT 'x',id,firebase_uid,'RMS-X-R3',3,'{}','',updated_at,updated_at,updated_at FROM trade_rental_inspections WHERE 0",
    "INSERT INTO trade_rental_inspection_events (id,inspection_id,firebase_uid,event_type,created_at) SELECT 'x',id,firebase_uid,'report_answer_revision_requested',updated_at FROM trade_rental_inspections WHERE 0",
    "UPDATE trade_rental_reports SET status = 'issued' WHERE 0",
    "UPDATE trade_rental_inspections SET issued_report_id = 'x', revision = revision + 1 WHERE 0",
  ];
  const python = process.env.TLINK_SQLITE_DEPTH_PYTHON || (process.platform === "win32"
    ? join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe") : "python3");
  const script = String.raw`
import json, sqlite3, sys
fixture = json.load(sys.stdin)
def database(previous):
    db = sqlite3.connect(':memory:')
    db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
    for entry in fixture['schema']:
        sql = fixture['previous'] if previous and entry['name'] == 'trade_rental_answer_request_guard_insert' else entry['sql']
        db.execute(sql)
    return db
old = database(True)
try:
    old.execute(fixture['probes'][1])
except sqlite3.OperationalError as error:
    assert 'Expression tree is too large' in str(error), str(error)
else:
    raise AssertionError('The released ungrouped guard did not reproduce the depth failure')
fixed = database(False)
for statement in fixture['probes']:
    fixed.execute(statement)
print(json.dumps({'limit':fixed.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH),'compiled':len(fixture['probes'])}))
`;
  const run = spawnSync(python, ["-c", script], { input: JSON.stringify({ schema, probes, previous: sites839AnswerGuardSql() }),
    encoding: "utf8", timeout: 10000 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { limit: 100, compiled: 4 });
});
