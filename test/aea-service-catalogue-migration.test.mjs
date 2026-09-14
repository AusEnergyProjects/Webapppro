import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ENERGY_SERVICE_IDS } from "../src/lib/energy-service-catalogue.mjs";

const readMigration = (name) => fs.readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
const migration = readMigration("0175_expand_aea_service_enquiries.sql");
const now = "2026-09-14T00:00:00.000Z";
const firstLeadId = "22222222-2222-4222-8222-222222222222";
const secondLeadId = "33333333-3333-4333-8333-333333333333";

test("AEA catalogue migration preserves every lead, event, column, index and constraint while accepting 25 services", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0152_energy_assistant.sql", "0166_expand_energy_assistant_service_categories.sql", "0174_expand_trade_service_enquiries.sql"]) {
    db.exec(readMigration(name));
  }

  const seed = db.prepare(`INSERT INTO energy_assistant_leads (
    id, request_id, submission_key_sha256, name, email, postcode, suburb,
    residential_state, service_categories_json, quote_brief_version,
    quote_brief_json, interest_confirmed, source_journey,
    service_consent_version, service_consent_purpose,
    service_consent_granted_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
  for (const [index, id] of [firstLeadId, secondLeadId].entries()) {
    seed.run(id, `aea-migration-request-${index}`, "a".repeat(64), `Migration Test ${index}`,
      `migration-${index}@example.com`, "3000", "Melbourne", "VIC",
      JSON.stringify(index ? ENERGY_SERVICE_IDS.slice(0, 16) : ["assessment"]),
      "energy-assistant-quote-brief/v1", "{}", "energy-assistant-explicit-follow-up",
      "aea-energy-assistant-service-contact/v1", "respond_to_requested_energy_assistance",
      now, now, now);
    db.prepare(`INSERT INTO energy_assistant_lead_events
      (id, lead_id, actor_type, action, note, metadata_json, created_at)
      VALUES (?, ?, 'system', 'created', ?, ?, ?)`)
      .run(`aea-migration-event-${index}`, id, `Preserve event ${index}`,
        JSON.stringify({ preserved: index }), now);
  }

  const rows = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all();
  const tableSql = (name) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name).sql;
  const indexRows = () => db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name IN ('energy_assistant_leads', 'energy_assistant_lead_events')
    AND sql IS NOT NULL ORDER BY name`).all();
  const before = {
    leads: rows("energy_assistant_leads"), events: rows("energy_assistant_lead_events"),
    leadColumns: columns("energy_assistant_leads"), eventColumns: columns("energy_assistant_lead_events"),
    indexes: indexRows(), leadSql: tableSql("energy_assistant_leads"),
    eventSql: tableSql("energy_assistant_lead_events"),
    foreignKeys: db.prepare("PRAGMA foreign_key_list(energy_assistant_lead_events)").all(),
  };

  db.exec(migration);

  assert.deepEqual(rows("energy_assistant_leads"), before.leads);
  assert.deepEqual(rows("energy_assistant_lead_events"), before.events);
  assert.deepEqual(columns("energy_assistant_leads"), before.leadColumns);
  assert.deepEqual(columns("energy_assistant_lead_events"), before.eventColumns);
  assert.deepEqual(indexRows(), before.indexes);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_list(energy_assistant_lead_events)").all(), before.foreignKeys);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(tableSql("energy_assistant_leads").replace("BETWEEN 1 AND 25", "BETWEEN 1 AND 16"), before.leadSql);
  assert.equal(tableSql("energy_assistant_lead_events"), before.eventSql);

  assert.equal(ENERGY_SERVICE_IDS.length, 25, "A future catalogue expansion needs an explicit storage-bound migration");
  const categories = JSON.stringify(ENERGY_SERVICE_IDS);
  assert.ok(categories.length <= 1000);
  const update = db.prepare("UPDATE energy_assistant_leads SET service_categories_json = ? WHERE id = ?");
  update.run(categories, firstLeadId);
  assert.equal(db.prepare("SELECT service_categories_json FROM energy_assistant_leads WHERE id = ?").get(firstLeadId).service_categories_json, categories);
  for (const invalid of [JSON.stringify([...ENERGY_SERVICE_IDS, "extra-service"]), "[]", "{}", "not-json", JSON.stringify(["x".repeat(1001)])]) {
    assert.throws(() => update.run(invalid, firstLeadId), /constraint|malformed JSON/i);
    assert.equal(db.prepare("SELECT service_categories_json FROM energy_assistant_leads WHERE id = ?").get(firstLeadId).service_categories_json, categories);
  }
  assert.throws(() => db.prepare("UPDATE energy_assistant_leads SET request_id = ? WHERE id = ?").run("aea-migration-request-0", secondLeadId), /unique/i);
  assert.throws(() => db.prepare("INSERT INTO energy_assistant_lead_events (id, lead_id, actor_type, action, created_at) VALUES ('orphan', 'missing', 'system', 'created', ?)").run(now), /foreign key/i);

  db.prepare("DELETE FROM energy_assistant_leads WHERE id = ?").run(firstLeadId);
  assert.deepEqual(rows("energy_assistant_lead_events").map((row) => row.lead_id), [secondLeadId]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
