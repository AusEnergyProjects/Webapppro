import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS,
  ensureCreditexJobLifecycleSchemaGuards,
} from "../src/lib/creditex-job-lifecycle-schema-guards.ts";

const migrations = [
  "0192_creditex_registry_batches.sql",
  "0193_creditex_job_lifecycle.sql",
  "0194_trade_activity_field_corrections.sql",
];
const hash = "a".repeat(64);
const now = "2026-09-25T06:00:00.000Z";
const migration = name => readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");

function replaySitesMigration(database, name) {
  // Reproduce Sites' statement boundary, not SQLite's more capable exec parser.
  database.exec("BEGIN");
  try {
    for (const statement of migration(name).split(";")) {
      if (statement.replace(/--[^\n]*/g, "").trim()) database.prepare(statement).run();
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
}

function d1(database) {
  let writes = 0;
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results: database.prepare(this.sql).all(...this.values) }; }
    async first() { return database.prepare(this.sql).get(...this.values) || null; }
    async run() {
      writes++;
      return { success: true, meta: { changes: Number(database.prepare(this.sql).run(...this.values).changes) } };
    }
  }
  return {
    get writes() { return writes; },
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  };
}

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, stage TEXT, record_status TEXT,
      revision INTEGER DEFAULT 1, updated_at TEXT, partner_type TEXT, source_type TEXT);
    CREATE TABLE trade_work_order_compliance_intents(id TEXT PRIMARY KEY, work_order_id TEXT, installer_uid TEXT,
      compliance_organisation_id TEXT, activity_template_id TEXT, status TEXT, revision INTEGER, intent_snapshot_sha256 TEXT);
    CREATE TABLE compliance_activity_work_pack_instances(id TEXT PRIMARY KEY, organisation_id TEXT, work_order_id TEXT,
      compliance_intent_id TEXT, instance_key TEXT, revision INTEGER, status TEXT, supersedes_instance_id TEXT, created_by_uid TEXT, created_at TEXT);
    CREATE TABLE compliance_activity_work_pack_final_records(id TEXT, case_instance_id TEXT, organisation_id TEXT, pdf_sha256 TEXT, object_key TEXT);
    CREATE TABLE compliance_cases(id TEXT, organisation_id TEXT, compliance_intent_id TEXT, work_order_id TEXT, installer_uid TEXT, status TEXT, evidence_status TEXT);
    CREATE TABLE compliance_output_action_packets(id TEXT, organisation_id TEXT, packet_sha256 TEXT, activity_template_id TEXT, compliance_case_id TEXT);
    CREATE TABLE compliance_output_action_reviews(organisation_id TEXT, packet_id TEXT, decision TEXT, packet_sha256 TEXT);
    CREATE TABLE compliance_output_action_events(organisation_id TEXT, packet_id TEXT, to_status TEXT);
    CREATE TABLE compliance_output_dispatch_intents(organisation_id TEXT, packet_id TEXT);
    CREATE TABLE creditex_registry_evidence(organisation_id TEXT, id TEXT, UNIQUE(organisation_id,id));
    CREATE TABLE creditex_registry_claim_accounts(organisation_id TEXT, packet_id TEXT, account_id TEXT, packet_sha256 TEXT, UNIQUE(organisation_id,packet_id));
    CREATE TABLE creditex_registry_accounts(organisation_id TEXT, id TEXT, scheme TEXT, version INTEGER, enabled INTEGER,
      authority_expires_on TEXT, activity_scope TEXT, UNIQUE(organisation_id,id));
    CREATE TABLE creditex_registry_exports(organisation_id TEXT, id TEXT, account_id TEXT, account_version INTEGER, packet_ids TEXT);
    CREATE TABLE creditex_registry_export_reviews(organisation_id TEXT, export_id TEXT, decision TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT, firebase_uid TEXT, pipeline_stage TEXT, customer_source TEXT);
    CREATE TABLE trade_crm_write_guards(firebase_uid TEXT, operation_id TEXT, step_number INTEGER, verified INTEGER, created_at TEXT);
    CREATE TABLE trade_job_forms(work_order_id TEXT, firebase_uid TEXT, status TEXT);
    CREATE TABLE trade_work_order_events(work_order_id TEXT, firebase_uid TEXT, event_type TEXT, summary TEXT);
    INSERT INTO trade_work_orders(id,firebase_uid,stage,record_status) VALUES('job','owner','completed','active');
    INSERT INTO trade_work_order_compliance_intents VALUES('intent','job','owner','org','activity','case_linked',1,'${hash}');`);
  database.exec(migration("0170_trade_activity_forms.sql"));
  const payload = { id: "original", intentId: "intent", workOrderId: "job", ownerUid: "owner", organisationId: "org",
    revision: 2, status: "submitted_for_creditex_review", form: { activityTemplateId: "activity" },
    answers: { model: "original answer" }, evidence: [{ objectKey: "retained/photo" }], signatures: [{ strokes: [1, 2] }] };
  database.prepare(`INSERT INTO trade_activity_field_records VALUES('original','intent','job','owner','org','activity',2,
    'submitted_for_creditex_review',?,'retained/signed.pdf',?,'technician',?,?,?)`).run(JSON.stringify(payload), hash, now, now, now);
  database.prepare("INSERT INTO trade_activity_field_report_links VALUES('share','original',?,'2099','','technician',?)").run("b".repeat(64), now);
  database.exec(`CREATE TABLE original_reference_probe(id TEXT);
    CREATE TRIGGER original_reference_probe_guard BEFORE INSERT ON original_reference_probe
      WHEN NOT EXISTS(SELECT 1 FROM trade_activity_field_records WHERE id=NEW.id)
      BEGIN SELECT RAISE(ABORT,'Missing original'); END;`);
  return { database, payload };
}

test("Sites can split 0192 through 0194 without splitting a trigger body", t => {
  const { database } = fixture(t);
  for (const name of migrations) {
    assert.doesNotMatch(migration(name), /\bCREATE\s+TRIGGER\b/i, name);
    replaySitesMigration(database, name);
  }
  assert.equal(database.prepare("SELECT count(*) n FROM creditex_job_lifecycle_events").get().n, 0);
  assert.equal(database.prepare("SELECT count(*) n FROM creditex_registry_batches").get().n, 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("split migration preserves signed records, version history, PDF custody and share-link foreign keys before installing guards", async t => {
  const { database } = fixture(t);
  const original = database.prepare("SELECT * FROM trade_activity_field_records").get();
  const versions = database.prepare("SELECT * FROM trade_activity_field_record_versions").all();
  const links = database.prepare("SELECT * FROM trade_activity_field_report_links").all();
  for (const name of migrations) replaySitesMigration(database, name);
  const { supersedes_record_id, correction_event_id, ...retained } = database.prepare("SELECT * FROM trade_activity_field_records").get();
  assert.equal(supersedes_record_id, null);
  assert.equal(correction_event_id, null);
  assert.deepEqual(retained, { ...original });
  assert.deepEqual(database.prepare("SELECT * FROM trade_activity_field_record_versions").all(), versions);
  assert.deepEqual(database.prepare("SELECT * FROM trade_activity_field_report_links").all(), links);
  assert.equal(database.prepare("PRAGMA foreign_key_list(trade_activity_field_report_links)").get().table, "trade_activity_field_records");
  database.exec("INSERT INTO original_reference_probe VALUES('original')");
  assert.throws(() => database.exec("INSERT INTO original_reference_probe VALUES('missing')"), /Missing original/);
  const connection = d1(database);
  await ensureCreditexJobLifecycleSchemaGuards(connection);
  const writes = connection.writes;
  await ensureCreditexJobLifecycleSchemaGuards(connection);
  assert.equal(connection.writes, writes, "Verified guards do not need reinstalling");
  const installed = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all().map(row => row.name));
  assert.equal(CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS.length, 16);
  for (const definition of CREDITEX_JOB_LIFECYCLE_SCHEMA_GUARD_DEFINITIONS) assert.ok(installed.has(definition.name), definition.name);
  assert.throws(() => database.exec("UPDATE trade_activity_field_records SET actor_uid='tamper' WHERE id='original'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM trade_activity_field_records WHERE id='original'"), /history must be retained/);
  assert.throws(() => database.exec("UPDATE trade_activity_field_record_versions SET actor_uid='tamper'"), /immutable/);
  assert.throws(() => database.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='job'"), /JOB_CANCEL_COMPLETED/);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("prepared runtime guards enforce exact correction source and unsigned draft after Sites migration", async t => {
  const { database, payload } = fixture(t);
  for (const name of migrations) replaySitesMigration(database, name);
  await ensureCreditexJobLifecycleSchemaGuards(d1(database));
  const source = JSON.stringify({ records: [{ kind: "field", id: "original", revision: 2, sha256: hash, objectKey: "retained/signed.pdf" }] });
  const insertEvent = (id, owner) => database.prepare(`INSERT INTO creditex_job_lifecycle_events
    (id,organisation_id,work_order_id,owner_uid,intent_id,action,source_snapshot,source_sha256,occurred_at,
      actor_kind,actor_uid,note,request_id,request_sha256,created_at)
    VALUES(?,'org','job',?,'intent','correction_required',?,?,?,'trade','reviewer','Fix model',?,?,?)`)
    .run(id, owner, source, hash, now, id, hash, now);
  assert.throws(() => insertEvent("foreign", "another-owner"), /JOB_LIFECYCLE_SCOPE_INVALID/);
  insertEvent("correction-event", "owner");
  assert.throws(() => database.exec("UPDATE creditex_job_lifecycle_events SET note='hidden'"), /HISTORY_IMMUTABLE/);
  assert.throws(() => database.exec("DELETE FROM creditex_job_lifecycle_events"), /HISTORY_RETAINED/);
  const correction = { ...payload, id: "correction", revision: 1, status: "draft", signatures: [],
    correction: { eventId: "correction-event", sourceRecordId: "original", sourceRevision: 2 } };
  const insertCorrection = value => database.prepare(`INSERT INTO trade_activity_field_records
    (id,intent_id,work_order_id,owner_uid,organisation_id,activity_template_id,revision,status,payload,actor_uid,
      created_at,updated_at,supersedes_record_id,correction_event_id)
    VALUES('correction','intent','job','owner','org','activity',1,'draft',?,'reviewer',?,?,'original','correction-event')`)
    .run(JSON.stringify(value), now, now);
  assert.throws(() => insertCorrection({ ...correction, signatures: payload.signatures }), /MUST_START_UNSIGNED/);
  assert.throws(() => insertCorrection({ ...correction, correction: { ...correction.correction, sourceRevision: 1 } }), /SOURCE_CHANGED/);
  insertCorrection(correction);
  assert.equal(database.prepare("SELECT count(*) n FROM trade_activity_field_records").get().n, 2);
  assert.equal(database.prepare("SELECT count(*) n FROM trade_activity_field_record_versions").get().n, 2);
  assert.equal(database.prepare("SELECT pdf_object_key FROM trade_activity_field_records WHERE id='original'").get().pdf_object_key, "retained/signed.pdf");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});
