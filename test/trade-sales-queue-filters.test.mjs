import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const crm = read("src/app/api/trade-crm/route.ts");
const filterBlock = crm.slice(crm.indexOf('if (filter === "lost")'), crm.indexOf('// Rows reuse their computed status alias.'));

test("active register and attention exclude lost, explicit archive finds it, and Bin keeps archived lost records reachable", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE trade_work_orders(id TEXT,stage TEXT,source_type TEXT,firebase_uid TEXT,record_status TEXT);
      CREATE TABLE trade_crm_job_details(work_order_id TEXT,pipeline_stage TEXT);
      CREATE TABLE trade_crm_job_notes(work_order_id TEXT,firebase_uid TEXT,note_type TEXT,issue_status TEXT);
      INSERT INTO trade_work_orders VALUES ('open','backlog','internal','owner','active'),('lost','cancelled','internal','owner','active'),('legacy','backlog','internal','owner','active'),('binned','cancelled','internal','owner','archived');
      INSERT INTO trade_crm_job_details VALUES ('open','enquiry'),('lost','lost'),('legacy','lost'),('binned','lost');
      INSERT INTO trade_crm_job_notes VALUES ('legacy','owner','issue','open');`);
    const select = (filter, deleted = false) => {
      const conditions = ["w.record_status=?"], bindings = [deleted ? "archived" : "active"];
      new Function("filter", "deleted", "stage", "operationalStatus", "conditions", "bindings", filterBlock)(filter, deleted, "", deleted ? "deleted" : "", conditions, bindings);
      return db.prepare(`SELECT w.id FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id WHERE ${conditions.join(" AND ")} ORDER BY w.id`).all(...bindings).map(row => row.id);
    };
    assert.deepEqual(select("all"), ["open"]);
    assert.deepEqual(select("attention"), []);
    assert.deepEqual(select("lost"), ["legacy", "lost"]);
    assert.deepEqual(select("all", true), ["binned"]);
  } finally { db.close(); }
});

test("Schedule only presents reschedule requests that still have a scheduled visit on an active non-lost job", t => {
  const { sqlite: db } = migratedDataforceSqlite(); t.after(() => db.close());
  const insert = (table, fields) => {
    const row = { ...fields };
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all()) if (col.notnull && col.dflt_value === null && row[col.name] === undefined) row[col.name] = /INT|REAL/.test(col.type) ? 0 : "";
    db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  };
  for (const [id, stage, pipeline, status] of [["open", "backlog", "quoting", "scheduled"], ["lost", "backlog", "lost", "scheduled"], ["cancelled", "cancelled", "enquiry", "scheduled"], ["ended-visit", "backlog", "quoting", "cancelled"]]) {
    insert("trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", work_number: id, stage });
    insert("trade_crm_job_details", { id, work_order_id: id, firebase_uid: "owner", pipeline_stage: pipeline });
    insert("trade_crm_appointments", { id, work_order_id: id, firebase_uid: "owner", status });
    insert("trade_crm_appointment_reschedule_requests", { id, appointment_id: id, work_order_id: id, firebase_uid: "owner", status: "pending" });
  }
  const source = read("src/app/api/trade-schedule/route.ts");
  const sql = source.match(/db\.prepare\(`(SELECT r\.id, r\.appointment_id[\s\S]*?)`\)/)[1];
  assert.deepEqual(db.prepare(sql).all("owner", 0, "[]").map(row => row.id), ["open"]);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_crm_appointment_reschedule_requests").get().count, 4, "all original requests remain in history");
});
