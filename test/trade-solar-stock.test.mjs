import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as solarStock from "../src/lib/trade-solar-stock.ts";
import * as quoteEquipment from "../src/lib/trade-quote-equipment.ts";
import * as mapQuote from "../src/lib/trade-map-quote.ts";
import * as stockContract from "../src/lib/trade-stock.ts";
import * as stockGuards from "../src/lib/trade-stock-schema-guards.ts";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = path => ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const snapshotServer = {};
Function("require", "exports", compile("src/lib/trade-solar-stock-server.ts"))(id => {
  if (id === "./trade-solar-stock.ts") return solarStock;
  if (id === "./trade-quote-equipment.ts") return quoteEquipment;
  throw new Error(id);
}, snapshotServer);
const plan = {};
Function("require", "exports", compile("src/lib/trade-job-plan-server.ts"))(id => {
  if (id === "./trade-solar-stock.ts") return solarStock;
  if (id === "./trade-stock-schema-guards.ts") return stockGuards;
  if (id === "./trade-map-quote.ts") return mapQuote;
  throw new Error(id);
}, plan);
const now = "2026-09-28T12:00:00.000Z";
const panel = { id: "selected-panel", kind: "panel", name: "440 W panels", manufacturer: "", model: "P440", quantity: 12, watts: 440, widthM: 1.134, lengthM: 1.762, priceBookItemId: "panel" };
const inverter = { id: "selected-inverter", kind: "inverter", name: "5 kW inverter", manufacturer: "", model: "INV5", quantity: 1, watts: 5000, priceBookItemId: "inverter" };

function fixture(equipment = { common: [panel, inverter], choices: [] }) {
  const db = new DatabaseSync(":memory:"), schema = read("db/schema.ts");
  for (const table of ["trade_team_members", "trade_price_book_items", "trade_work_orders", "trade_crm_job_details", "trade_crm_job_plans", "trade_crm_job_plan_phases", "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_work_order_events", "trade_crm_commercial_handovers", "trade_crm_quotes", "trade_crm_quote_versions", "trade_crm_quote_choices", "trade_crm_quote_items", "trade_crm_quote_execution_snapshots", "trade_crm_quote_acceptances"]) {
    const start = schema.indexOf(`sqliteTable("${table}", {`), block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    assert.ok(columns.length, table);
    db.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/cents|minutes|milli|position/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  if (!db.prepare("PRAGMA table_info(trade_crm_quote_execution_snapshots)").all().some(row => row.name === "solar_stock_json")) db.exec(read("drizzle/0210_trade_solar_stock_snapshot.sql"));
  db.exec("CREATE UNIQUE INDEX actual_requirement ON trade_crm_job_actuals(job_plan_requirement_id)");
  for (const path of ["drizzle/0207_trade_stock.sql", "drizzle/0208_trade_stock_locations.sql"]) {
    for (const sql of read(path).split(";")) if (sql.replace(/--[^\n]*/g, "").trim()) db.prepare(sql).run();
  }
  for (const guard of stockGuards.TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) db.exec(guard.sql);
  db.exec(`INSERT INTO trade_price_book_items(id,firebase_uid,name,item_type,unit_label,record_status,supplier_cost_cents_ex_gst) VALUES
    ('panel','owner','Panel','material','each','active',9000),('inverter','owner','Inverter','equipment','each','active',80000),
    ('foreign','other','Other business panel','material','each','active',123),('battery','owner','Battery','equipment','each','active',250000)`);
  db.exec("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,record_status,stage,updated_at) VALUES('job','owner','installer','active','planning','2026-09-28'); INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES('job','owner','trade_owned')");
  db.prepare("INSERT INTO trade_crm_quote_versions(id,firebase_uid,equipment_json,status,total_cents) VALUES('v1','owner',?,'draft',660000)").run(JSON.stringify(equipment));
  db.exec("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,quantity_milli,description,section_heading) VALUES('system','v1','owner',0,1000,'Installed solar system','Solar system')");
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args),
    first: async () => db.prepare(sql).get(...values) || null, all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => db.prepare(sql).run(...values) });
  const d1 = { prepare, async batch(statements) { db.exec("BEGIN"); try { const results = statements.map(s => /^\s*SELECT\b/i.test(s.sql)
    ? { success: true, results: db.prepare(s.sql).all(...s.values) } : db.prepare(s.sql).run(...s.values)); db.exec("COMMIT"); return results; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
  const stock = {};
  Function("require", "exports", compile("src/lib/trade-stock-server.ts"))(id => {
    if (id.endsWith("/db")) return { getD1: () => d1 };
    if (id === "./trade-stock") return stockContract;
    if (id === "./trade-stock-schema-guards") return stockGuards;
    throw new Error(id);
  }, stock);
  const enable = async (itemId, quantityMilli) => stock.mutateStock("owner", "owner", { action: "enable", itemId, quantityMilli, lowStockMilli: 0, expectedRevision: 0, operationId: crypto.randomUUID() });
  const freeze = async () => {
    const snapshot = await snapshotServer.buildQuoteSolarStockSnapshot(d1, "owner", "v1");
    db.prepare("INSERT INTO trade_crm_quote_execution_snapshots(id,quote_version_id,firebase_uid,solar_stock_json,packets_json) VALUES('snapshot','v1','owner',?,'[]')").run(JSON.stringify(snapshot));
    db.exec("UPDATE trade_crm_quote_versions SET status='issued' WHERE id='v1'");
    return snapshot;
  };
  const input = { ownerUid: "owner", workOrderId: "job", handoffId: "handoff", quoteVersionId: "v1", selectedChoiceIds: [], now, onlyIfTracked: true };
  const handoff = prepare("INSERT INTO trade_crm_commercial_handovers(id,quote_version_id,work_order_id,firebase_uid,status,accepted_at,created_at,commercial_reference,subtotal_cents,tax_cents,total_cents) VALUES('handoff','v1','job','owner','accepted',?,?,'Q-SOLAR',600000,60000,660000)").bind(now, now);
  const accept = async (choices = []) => d1.batch([handoff, ...await plan.buildJobPlanStatements(d1, { ...input, selectedChoiceIds: choices })]);
  return { db, d1, stock, enable, freeze, input, handoff, accept };
}

test("manual preparation accepts only the exact current customer, version and acceptance at write time", async () => {
  const scenarios = [
    ["current acceptance", "", 1],
    ["customer reassigned", "UPDATE trade_crm_job_details SET crm_customer_id='new-customer'", 0],
    ["quote superseded", "UPDATE trade_crm_quotes SET current_version_number=2", 0],
    ["acceptance withdrawn", "UPDATE trade_crm_quote_acceptances SET decision='declined'", 0],
    ["foreign acceptance", "UPDATE trade_crm_quote_acceptances SET firebase_uid='other-owner'", 0],
    ["wrong acceptance", "UPDATE trade_crm_commercial_handovers SET acceptance_id='different-acceptance'", 0],
  ];
  for (const [label, change, expected] of scenarios) {
    const f = fixture();
    try {
      await f.enable("panel", 20000); await f.enable("inverter", 2000); await f.freeze();
      await f.d1.batch([f.handoff]);
      f.db.exec(`UPDATE trade_crm_job_details SET crm_customer_id='customer';
        INSERT INTO trade_crm_quotes(id,firebase_uid,work_order_id,crm_customer_id,current_version_number,status)
          VALUES('quote','owner','job','customer',1,'accepted');
        UPDATE trade_crm_quote_versions SET quote_id='quote',version_number=1,status='accepted';
        INSERT INTO trade_crm_quote_acceptances(id,firebase_uid,quote_id,quote_version_id,work_order_id,crm_customer_id,decision)
          VALUES('acceptance','owner','quote','v1','job','customer','accepted');
        UPDATE trade_crm_commercial_handovers SET quote_id='quote',crm_customer_id='customer',acceptance_id='acceptance'`);
      const statements = await plan.buildJobPlanStatements(f.d1, { ...f.input, requireCurrentAcceptance: true });
      assert.ok(statements.length, label);
      // The identity changes after preparation but before the atomic write.
      if (change) f.db.exec(change);
      await f.d1.batch(statements);
      assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_job_plans").get().n, expected, label);
      assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, expected * 12000, label);
      if (!expected) {
        assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_job_plan_requirements").get().n, 0, label);
        assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_work_order_events WHERE event_type='job_plan_prepared'").get().n, 0, label);
      }
    } finally { f.db.close(); }
  }
});

test("whole-system quote freezes 12 panels and one inverter, commits only on acceptance and releases on cancellation", async () => {
  const f = fixture(); await f.enable("panel", 10000); await f.enable("inverter", 2000);
  const snapshot = await f.freeze();
  assert.deepEqual(snapshot.components.map(item => [item.priceBookItemId, item.quantityMilli, item.unitCostCents]), [["panel", 12000, 9000], ["inverter", 1000, 80000]]);
  assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, 0);
  const prepared = await plan.buildJobPlanStatements(f.d1, f.input); await f.d1.batch(prepared);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_job_plan_requirements").get().n, 0);
  await f.d1.batch([f.handoff, ...prepared]);
  const panels = await f.stock.stockItem("owner", "panel");
  assert.equal(panels.onHandMilli, 10000); assert.equal(panels.reservedMilli, 12000); assert.equal(panels.availableMilli, -2000);
  assert.equal((await f.stock.stockItem("owner", "inverter")).reservedMilli, 1000);
  assert.equal(f.db.prepare("SELECT budget_cost_cents FROM trade_crm_job_plans").get().budget_cost_cents, 188000);
  assert.equal(f.db.prepare("SELECT total_cents FROM trade_crm_quote_versions WHERE id='v1'").get().total_cents, 660000);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_quote_items").get().n, 1);
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='job'");
  assert.equal((await f.stock.stockItem("owner", "panel")).availableMilli, 10000);
  assert.equal((await f.stock.stockItem("owner", "inverter")).availableMilli, 2000);
});

test("issued equipment quantities and supplier costs survive later catalogue and design edits", async () => {
  const f = fixture(); await f.enable("panel", 20000); await f.enable("inverter", 2000); await f.freeze();
  f.db.exec("UPDATE trade_price_book_items SET supplier_cost_cents_ex_gst=999999,record_status='archived' WHERE firebase_uid='owner'");
  f.db.prepare("UPDATE trade_crm_quote_versions SET equipment_json=? WHERE id='v1'").run(JSON.stringify({ common: [{ ...panel, quantity: 99 }], choices: [] }));
  await f.accept();
  assert.deepEqual(f.db.prepare("SELECT source_id,quantity_milli,unit_cost_cents FROM trade_crm_job_plan_requirements WHERE requirement_type='material' ORDER BY position").all().map(row => [row.source_id, row.quantity_milli, row.unit_cost_cents]), [["panel", 12000, 9000], ["inverter", 1000, 80000]]);
});

test("only selected equipment options reserve stock and immutable choice IDs replace draft keys", async () => {
  const f = fixture({ common: [inverter], choices: [{ choiceKey: "twelve", items: [panel] }, { choiceKey: "twenty", items: [{ ...panel, quantity: 20 }] }] });
  f.db.exec("INSERT INTO trade_crm_quote_choices(id,quote_version_id,firebase_uid,choice_key) VALUES('choice-12','v1','owner','twelve'),('choice-20','v1','owner','twenty')");
  await f.enable("panel", 30000); await f.enable("inverter", 2000);
  const snapshot = await f.freeze();
  assert.deepEqual(snapshot.components.map(item => item.choiceId), ["", "choice-12", "choice-20"]);
  await f.accept(["choice-12"]);
  assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, 12000);
  assert.equal((await f.stock.stockItem("owner", "inverter")).reservedMilli, 1000);
});

test("optional equipment that the customer did not select creates no automatic plan", async () => {
  const f = fixture({ common: [], choices: [{ choiceKey: "upgrade", items: [panel] }] });
  f.db.exec("INSERT INTO trade_crm_quote_choices(id,quote_version_id,firebase_uid,choice_key) VALUES('upgrade-id','v1','owner','upgrade')");
  await f.enable("panel", 20000); await f.freeze();
  assert.deepEqual(await plan.buildJobPlanStatements(f.d1, f.input), []);
});

test("concurrent prepared acceptance and replay cannot duplicate component reservations", async () => {
  const f = fixture(); await f.enable("panel", 20000); await f.enable("inverter", 2000); await f.freeze();
  const first = await plan.buildJobPlanStatements(f.d1, f.input), second = await plan.buildJobPlanStatements(f.d1, f.input);
  await f.d1.batch([f.handoff, ...first]); await f.d1.batch(second);
  assert.deepEqual(await plan.buildJobPlanStatements(f.d1, f.input), []);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_crm_job_plans").get().n, 1);
  assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, 12000);
  assert.equal((await f.stock.stockItem("owner", "inverter")).reservedMilli, 1000);
});

test("explicit accepted material lines cover equipment once, including partial coverage", async () => {
  for (const explicitQuantity of [5000, 12000, 15000]) {
    const f = fixture(); await f.enable("panel", 30000); await f.enable("inverter", 2000); await f.freeze();
    f.db.prepare("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,price_book_item_id,price_book_item_type,quantity_milli,description,unit_cost_cents_ex_gst) VALUES('explicit','v1','owner',1,'panel','material',?,'Panels',9000)").run(explicitQuantity);
    f.db.exec("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,price_book_item_id,price_book_item_type,quantity_milli,description,quote_choice_id) VALUES('unselected','v1','owner',2,'inverter','equipment',100000,'Declined extra inverter','declined')");
    await f.accept();
    assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, Math.max(12000, explicitQuantity));
    assert.equal((await f.stock.stockItem("owner", "inverter")).reservedMilli, 1000);
    f.db.close();
  }
});

test("generic equipment and tracking-off items are explicit warnings, never invented stock", async () => {
  const f = fixture({ common: [{ ...panel, priceBookItemId: undefined }, inverter], choices: [] });
  const snapshot = await f.freeze();
  assert.deepEqual(snapshot.warnings.map(item => [item.name, item.reason]), [["440 W panels", "unlinked"], ["5 kW inverter", "tracking_off"]]);
  assert.deepEqual(snapshot.components.map(item => item.priceBookItemId), ["inverter"]);
  assert.deepEqual(await plan.buildJobPlanStatements(f.d1, f.input), []);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_stock_items").get().n, 0);
});

test("common quantities and an optional extra remain separate while each scope deduplicates its own lines", async () => {
  const f = fixture({ common: [panel], choices: [{ choiceKey: "more", items: [{ ...panel, quantity: 4 }] }] });
  f.db.exec("INSERT INTO trade_crm_quote_choices(id,quote_version_id,firebase_uid,choice_key) VALUES('extra-panels','v1','owner','more')");
  f.db.exec("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,price_book_item_id,price_book_item_type,quantity_milli,description,unit_cost_cents_ex_gst) VALUES('explicit-base','v1','owner',1,'panel','material',12000,'Base panels',9000)");
  await f.enable("panel", 30000); await f.freeze(); await f.accept(["extra-panels"]);
  assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, 16000);
  assert.equal(f.db.prepare("SELECT budget_cost_cents FROM trade_crm_job_plans").get().budget_cost_cents, 144000);
});

test("quoted whole-system supplier cost stays authoritative without double-counting component budgets", async () => {
  const f = fixture(); await f.enable("panel", 20000); await f.enable("inverter", 2000);
  f.db.exec("UPDATE trade_crm_quote_items SET section_heading='Solar system (12 panels)',unit_cost_cents_ex_gst=210000 WHERE id='system'");
  const snapshot = await f.freeze(); await f.accept();
  assert.deepEqual(snapshot.components.map(item => item.unitCostCents), [9000, 80000], "underlying issued supplier cost snapshot remains exact");
  assert.equal(f.db.prepare("SELECT budget_cost_cents FROM trade_crm_job_plans").get().budget_cost_cents, 210000);
  assert.equal(f.db.prepare("SELECT SUM(total_cost_cents) total FROM trade_crm_job_plan_requirements").get().total, 210000);
  assert.deepEqual(f.db.prepare("SELECT source_id,quantity_milli,unit_cost_cents FROM trade_crm_job_plan_requirements WHERE requirement_type='material'").all().map(row => [row.source_id, row.quantity_milli, row.unit_cost_cents]), [["panel", 12000, 0], ["inverter", 1000, 0]]);
  assert.equal((await f.stock.stockItem("owner", "panel")).reservedMilli, 12000);
  assert.equal((await f.stock.stockItem("owner", "inverter")).reservedMilli, 1000);
  assert.match(f.db.prepare("SELECT customer_description FROM trade_crm_job_plan_phases WHERE title='System equipment'").get().customer_description, /cost included/);
});

test("unselected whole-system cost cannot suppress the selected equipment budget", async () => {
  const f = fixture(); await f.enable("panel", 20000); await f.enable("inverter", 2000);
  f.db.exec("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,quantity_milli,section_heading,unit_cost_cents_ex_gst,quote_choice_id) VALUES('declined-system','v1','owner',1,1000,'Solar system (20 panels)',500000,'declined')");
  await f.freeze(); await f.accept();
  assert.equal(f.db.prepare("SELECT budget_cost_cents FROM trade_crm_job_plans").get().budget_cost_cents, 188000);
});

test("another business, unknown, archived and non-counted products cannot be linked to solar stock", async () => {
  for (const productId of ["foreign", "unknown", "panel"]) {
    const f = fixture({ common: [{ ...panel, priceBookItemId: productId }], choices: [] });
    if (productId === "panel") f.db.exec("UPDATE trade_price_book_items SET record_status='archived' WHERE id='panel'");
    await assert.rejects(snapshotServer.buildQuoteSolarStockSnapshot(f.d1, "owner", "v1"), /QUOTE_SOLAR_STOCK_ITEM_UNAVAILABLE/);
    f.db.close();
  }
  for (const update of ["item_type='labour'", "unit_label='pack'"]) {
    const f = fixture(); f.db.exec(`UPDATE trade_price_book_items SET ${update} WHERE id='panel'`);
    await assert.rejects(snapshotServer.buildQuoteSolarStockSnapshot(f.d1, "owner", "v1"), /QUOTE_SOLAR_STOCK_ITEM_UNAVAILABLE/);
    f.db.close();
  }
});

test("missing choice mappings, wrong quote ownership and corrupt snapshots fail closed", async () => {
  const f = fixture({ common: [], choices: [{ choiceKey: "missing", items: [panel] }] });
  await assert.rejects(snapshotServer.buildQuoteSolarStockSnapshot(f.d1, "owner", "v1"), /QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID/);
  await assert.rejects(snapshotServer.buildQuoteSolarStockSnapshot(f.d1, "other", "v1"), /QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID/);
  for (const value of ["{", "{}", { version: 1, warnings: [], components: [{ priceBookItemId: "panel", choiceId: "", name: "Panel", quantityMilli: -1000, unitCostCents: 1 }] }]) {
    assert.throws(() => solarStock.readQuoteSolarStockSnapshot(value), /QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID/);
  }
});

test("legacy issued quotes do not infer new equipment or costs from today's catalogue", async () => {
  const f = fixture(); await f.enable("panel", 20000);
  f.db.exec("INSERT INTO trade_crm_quote_execution_snapshots(id,quote_version_id,firebase_uid,solar_stock_json) VALUES('legacy','v1','owner','')");
  assert.deepEqual(await plan.buildJobPlanStatements(f.d1, f.input), []);
});
