import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Miniflare } from "miniflare";
import ts from "typescript";
import * as lifecycle from "../src/lib/trade-job-lifecycle.ts";
import * as register from "../src/lib/trade-crm-job-register.ts";
import { creditexWholeJobLifecycleSql } from "../src/lib/creditex-job-lifecycle-projection.ts";
import { creditexIntentCompletionSnapshotSql } from "../src/lib/creditex-job-lifecycle-sql.ts";
import { TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL } from "../src/lib/trade-crm-job-index-sql.ts";
import { crmSort, crmTerm } from "../src/lib/trade-crm-register-sort-sql.ts";
import { keysetAfter } from "../src/lib/keyset-pagination.ts";

const root = new URL("../", import.meta.url);
const route = fs.readFileSync(new URL("src/app/api/trade-crm/route.ts", root), "utf8");
const constantBlock = ts.transpileModule(route.slice(route.indexOf("const JOB_REGISTER_QUOTE_TOTAL_SQL ="), route.indexOf("const SCHEDULE_SORT =")),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const dependencies = { ...lifecycle, ...register, creditexWholeJobLifecycleSql, crmSort, crmTerm };
const constants = new Function(...Object.keys(dependencies), `${constantBlock}
  return {JOB_REGISTER_QUOTE_TOTAL_SQL,JOB_REGISTER_QUOTE_SORT_SQL,JOB_EFFECTIVE_SCHEDULE_SQL,
    JOB_REGISTER_VEEC_COUNT_SQL,JOB_REGISTER_IMPORTED_VEEC_SQL,JOB_REGISTER_VEEC_SORT_SQL,
    JOB_REGISTER_AUDIT_OUTCOME_SQL,JOB_REGISTER_HAS_PROGRESS_SQL,JOB_REGISTER_LIFECYCLE_SQL,
    JOB_REGISTER_ACTIVITY_SQL,JOB_REGISTER_STATUS_RANK_SQL,JOB_SORTS};`)(...Object.values(dependencies));
const joins = route.match(/const joins = `(FROM trade_work_orders w[\s\S]*?)`;/)[1];
const rowQuery = route.match(/db\.prepare\(`(WITH job_lifecycle AS MATERIALIZED[\s\S]*?)`\)\s*\.bind\(([^)]+)\)\.all/);
const rowTemplate = rowQuery[1];
const statusCondition = route.match(/if \(operationalStatus\) \{[\s\S]*?conditions.push\(("[^"]+")\);/)[1];
const countWhere = route.match(/const where = (conditions.map\([\s\S]*?\).join\(" AND "\));/)[1];
const cursorBlock = route.slice(route.indexOf("const rowConditions = [...conditions]"), route.indexOf("const rowWhere = rowConditions.join"));

function jobsQuery({ status = "", sort = "updated-desc", cursor = null } = {}) {
  const recordStatus = status === "deleted" ? "archived" : "active";
  const conditions = ["w.firebase_uid = ?", "w.partner_type = 'installer'", `w.record_status = '${recordStatus}'`];
  const bindings = ["owner"];
  if (status) { conditions.push(JSON.parse(statusCondition)); bindings.push(status); }
  const where = new Function("conditions", "JOB_REGISTER_LIFECYCLE_SQL", `return ${countWhere};`)(conditions, constants.JOB_REGISTER_LIFECYCLE_SQL);
  const countBindings = [...bindings];
  const selectedSort = constants.JOB_SORTS[sort];
  const { rowConditions, rowBindings } = new Function("conditions", "bindings", "cursor", "selectedSort", "sort", "keysetAfter",
    `${cursorBlock}; return {rowConditions,rowBindings};`)(conditions, bindings, cursor, selectedSort, sort, keysetAfter);
  const values = { ...constants, ...register, recordStatus,
    rowJoins: `${joins} ${TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL}`,
    rowWhere: rowConditions.join(" AND "), selectedSort,
  };
  const queryBindings = new Function("identity", "rowBindings", "pageSize", `return [${rowQuery[2]}];`)({ uid: "owner" }, rowBindings, 25);
  return { sql: new Function(...Object.keys(values), `return \`${rowTemplate}\`;`)(...Object.values(values)), bindings: queryBindings,
    countSql: `SELECT COUNT(*) total ${values.rowJoins} WHERE ${where}`, countBindings };
}

function migratedSchema() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync(new URL("drizzle/", root)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const statement of fs.readFileSync(new URL(`drizzle/${name}`, root), "utf8").split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      try { sqlite.exec(statement); } catch (error) {
        const fullText = statement.match(/^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is);
        if (!error.message.includes("no such module: fts5") || !fullText) throw error;
        // Some Node SQLite builds omit FTS5. This query never uses FTS tables.
        sqlite.exec(`CREATE TABLE ${fullText[1]} (${fullText[2].split(",").map(value => value.trim())
          .filter(value => !value.startsWith("tokenize=")).map(value => `${value.split(/\s+/)[0]} text`).join(",")})`);
      }
    }
  }
  return sqlite;
}

test("the complete Trade Jobs query, status filter and status sort fit D1 with populated lifecycle records", async () => {
  const sqlite = migratedSchema();
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-05-01", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const tables = sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();
    for (let offset = 0; offset < tables.length; offset += 20) await db.batch(tables.slice(offset, offset + 20).map(table => db.prepare(table.sql)));
    const now = "2026-09-25T06:00:00.000Z", hash = "a".repeat(64);
    const insert = async (table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`)
      .bind(...Object.values(values)).run();
    const stages = ["backlog", "scheduled", "in_progress", "completed", "completed", "in_progress", "completed"];
    for (const [index, stage] of stages.entries()) {
      const workOrderId = `job-${index}`, ownerUid = index === 6 ? "other-owner" : "owner";
      await insert("trade_work_orders", { id: workOrderId, firebase_uid: ownerUid, partner_type: "installer",
        work_number: `TLJ-${index}`, title: "Fixture job", stage, created_at: now, updated_at: now });
      if (!index || index === 6) continue;
      const intentId = `intent-${index}`;
      await insert("trade_work_order_compliance_intents", { id: intentId, work_order_id: workOrderId, installer_uid: ownerUid,
        compliance_organisation_id: "org", program_template_id: "veu", activity_template_id: "activity", program_code: "VEU",
        service_category: "air-conditioning", site_jurisdiction: "VIC", catalogue_reviewed_on: "2026-09-25",
        intent_snapshot: JSON.stringify({ contract: "tlink-creditex-job-intent-v1", program: { templateId: "veu", programCode: "VEU", claimOutputCode: "VEEC" },
          activity: { templateId: "activity", serviceCategory: "air-conditioning", title: "Test activity" }, siteJurisdiction: "VIC", catalogueReviewedOn: "2026-09-25" }),
        intent_snapshot_sha256: hash, created_by_uid: ownerUid, created_at: now, updated_at: now });
      if (index < 4) continue;
      const recordId = `field-${index}`, payload = { id: recordId, intentId, workOrderId, ownerUid, organisationId: "org",
        revision: 1, status: "submitted_for_creditex_review", form: { activityTemplateId: "activity" }, evidence: [], signatures: [] };
      await insert("trade_activity_field_records", { id: recordId, intent_id: intentId, work_order_id: workOrderId, owner_uid: ownerUid,
        organisation_id: "org", activity_template_id: "activity", revision: 1, status: payload.status, payload: JSON.stringify(payload),
        pdf_object_key: `private/${recordId}.pdf`, pdf_sha256: hash, actor_uid: ownerUid, created_at: now, updated_at: now, submitted_at: now });
      const source = await db.prepare(`SELECT ${creditexIntentCompletionSnapshotSql("intent")} snapshot
        FROM trade_work_order_compliance_intents intent WHERE id=?`).bind(intentId).first();
      await insert("creditex_job_lifecycle_events", { id: `event-${index}`, organisation_id: "org", work_order_id: workOrderId,
        owner_uid: ownerUid, intent_id: intentId, action: index === 4 ? "reviewed" : "correction_required", source_snapshot: source.snapshot,
        source_sha256: hash, occurred_at: now, actor_kind: "trade", actor_uid: ownerUid, note: "Fixture review",
        request_id: `request-${index}`, request_sha256: hash, created_at: now });
    }
    const expected = ["unscheduled", "scheduled", "partial", "completed", "reviewed", "correction_required"];
    const list = async options => { const query = jobsQuery(options); return db.prepare(query.sql).bind(...query.bindings).all(); };
    // Run the actual composed production query, including its bindings and cursor predicates.
    const listed = await list();
    assert.deepEqual(listed.results.map(row => row.register_lifecycle_status), [...expected].reverse());
    const sorted = await list({ sort: "status-asc" });
    assert.deepEqual(sorted.results.map(row => row.register_lifecycle_status), expected);
    assert.deepEqual(sorted.results.map(row => row.register_status_rank), [1, 2, 3, 4, 5, 7]);
    const filtered = await list({ status: "reviewed", sort: "status-asc" });
    assert.deepEqual(filtered.results.map(row => row.id), ["job-4"]);
    const count = jobsQuery({ status: "reviewed" });
    assert.equal((await db.prepare(count.countSql).bind(...count.countBindings).first()).total, 1);
    const next = await list({ sort: "status-asc", cursor: [3, "job-2"] });
    assert.deepEqual(next.results.map(row => row.register_lifecycle_status), expected.slice(3));
    const previous = await list({ sort: "status-desc", cursor: [5, "job-4"] });
    assert.deepEqual(previous.results.map(row => row.register_lifecycle_status), expected.slice(0, 4).reverse());
    const filteredPage = await list({ status: "reviewed", sort: "status-asc", cursor: [4, "job-3"] });
    assert.deepEqual(filteredPage.results.map(row => row.id), ["job-4"]);
    const filteredPreviousPage = await list({ status: "reviewed", sort: "status-desc", cursor: [7, "job-5"] });
    assert.deepEqual(filteredPreviousPage.results.map(row => row.id), ["job-4"]);

    for (const [index, value] of ["2", "10", "0", "", "7", "777", "999"].entries()) {
      await insert("trade_dataforce_sources", { id: `import-${index}`, firebase_uid: index >= 5 ? "other-owner" : "owner",
        source_job_id: `source-${index}`, row_sha256: hash, raw_json: JSON.stringify({ "Certificates (VEECs)": value }),
        import_batch_id: "batch", import_row_id: `row-${index}`, work_order_id: `job-${index}`,
        customer_id: "customer", service_site_id: "site", customer_key: "customer-key", site_key: "site-key", created_at: now });
    }
    await db.prepare("UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job-4'").run();
    const veecAscending = (await list({ sort: "v-a" })).results;
    assert.deepEqual(veecAscending.map(row => row.id), ["job-2", "job-3", "job-4", "job-5", "job-0", "job-1"]);
    assert.deepEqual(veecAscending.map(row => row.imported_veec_count), [0, null, null, null, 2, 10]);
    assert.deepEqual(veecAscending.map(row => row.veec_display_count), [0, 0, 0, 0, 2, 10]);
    assert.ok(veecAscending.every(row => row.veec_certificate_count === 0), "historical quantities must not become current certificate issuance");
    assert.deepEqual((await list({ sort: "v-d" })).results.map(row => row.id), ["job-1", "job-0", "job-5", "job-4", "job-3", "job-2"]);
    assert.deepEqual((await list({ sort: "v-a", cursor: [2, "job-0"] })).results.map(row => row.id), ["job-1"]);
    assert.deepEqual((await list({ sort: "v-d", cursor: [2, "job-0"] })).results.map(row => row.id), ["job-5", "job-4", "job-3", "job-2"]);
    await db.prepare("UPDATE trade_work_orders SET stage='imported' WHERE id='job-4'").run();
    await db.prepare("UPDATE trade_crm_job_details SET pipeline_stage='imported' WHERE work_order_id='job-4'").run();
    assert.deepEqual((await list({status:'imported'})).results.map(row=>row.id), ['job-4']);
    assert.equal((await list({status:'reviewed'})).results.length, 0, 'historical review cannot override Imported');
    const importedCount=jobsQuery({status:'imported'});
    assert.equal((await db.prepare(importedCount.countSql).bind(...importedCount.countBindings).first()).total,1);
    await db.prepare("UPDATE trade_work_orders SET record_status='archived' WHERE id='job-4'").run();
    assert.equal((await list({status:'imported'})).results.length,0);
    assert.deepEqual((await list({status:'deleted'})).results.map(row=>[row.id,row.register_lifecycle_status]),[['job-4','deleted']]);
    const deletedCount=jobsQuery({status:'deleted'});
    assert.equal((await db.prepare(deletedCount.countSql).bind(...deletedCount.countBindings).first()).total,1);
  } finally { await mf.dispose(); sqlite.close(); }
});

test("historical VEEC SQL accepts only nonnegative safe whole-number source cells and redacts protected context", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, source_type TEXT);
      CREATE TABLE trade_crm_job_details (work_order_id TEXT, customer_source TEXT);
      CREATE TABLE trade_dataforce_sources (work_order_id TEXT, firebase_uid TEXT, raw_json TEXT);
      INSERT INTO trade_work_orders VALUES ('job','owner','import');
      INSERT INTO trade_crm_job_details VALUES ('job','import');
      INSERT INTO trade_dataforce_sources VALUES ('job','owner','{}');`);
    const query = db.prepare(`SELECT ${constants.JOB_REGISTER_IMPORTED_VEEC_SQL} imported,
      ${constants.JOB_REGISTER_VEEC_SORT_SQL} displayed
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id
      LEFT JOIN trade_dataforce_sources df ON df.work_order_id=w.id AND df.firebase_uid=w.firebase_uid`);
    const cases = [["0", 0], ["0002", 2], [" \t2\r\n", 2], ["9007199254740991", Number.MAX_SAFE_INTEGER],
      ["", null], [" ", null], ["2x", null], ["-1", null], ["2.0", null], ["2e2", null],
      ["9007199254740992", null], ["9".repeat(100), null], [2, null], [true, null], [null, null], [{ value: 2 }, null]];
    for (const [value, expected] of cases) {
      db.prepare("UPDATE trade_dataforce_sources SET raw_json=?").run(JSON.stringify({ "Certificates (VEECs)": value }));
      assert.deepEqual({ ...query.get() }, { imported: expected, displayed: expected ?? 0 }, String(value));
    }
    db.prepare("UPDATE trade_dataforce_sources SET raw_json=?").run(JSON.stringify({ "Certificates (VEECs)": "2" }));
    db.exec("UPDATE trade_crm_job_details SET customer_source='platform_private'");
    assert.deepEqual({ ...query.get() }, { imported: null, displayed: 0 });
    db.exec("UPDATE trade_crm_job_details SET customer_source='import'; UPDATE trade_dataforce_sources SET firebase_uid='other-owner'");
    assert.deepEqual({ ...query.get() }, { imported: null, displayed: 0 });
  } finally { db.close(); }
});
