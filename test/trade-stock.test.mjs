import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as contract from "../src/lib/trade-stock.ts";
import * as stockGuards from "../src/lib/trade-stock-schema-guards.ts";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = path => ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const serverCode = compile("src/lib/trade-stock-server.ts"), routeCode = compile("src/app/api/trade-stock/route.ts");
const planHelper = {}; Function("require", "exports", compile("src/lib/trade-job-plan-server.ts"))(id => id === "./trade-stock-schema-guards.ts" ? stockGuards : {}, planHelper);
const now = "2026-09-28T10:00:00.000Z";

function replayStockMigration(db) {
  for (const sql of ["drizzle/0207_trade_stock.sql","drizzle/0208_trade_stock_locations.sql"].flatMap(path=>read(path).split(";"))) {
    if (sql.replace(/--[^\n]*/g, "").trim()) db.prepare(sql).run();
  }
}

function fixture({ installGuards = true } = {}) {
  const db = new DatabaseSync(":memory:");
  const schema = read("db/schema.ts");
  for (const table of ["trade_team_members", "trade_price_book_items", "trade_work_orders", "trade_crm_job_details", "trade_crm_job_plans", "trade_crm_job_plan_phases", "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_work_order_events", "trade_crm_commercial_handovers", "trade_crm_quote_items", "trade_crm_quote_execution_snapshots", "trade_crm_quote_acceptances"]) {
    const start = schema.indexOf(`sqliteTable("${table}", {`), block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    assert.ok(columns.length, table);
    db.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/cents|minutes|milli|position/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  db.exec("CREATE UNIQUE INDEX actual_requirement ON trade_crm_job_actuals(job_plan_requirement_id)");
  replayStockMigration(db);
  if (installGuards) for (const guard of stockGuards.TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) db.exec(guard.sql);
  db.exec("INSERT INTO trade_price_book_items(id,firebase_uid,item_code,name,item_type,unit_label,record_status) VALUES ('panel','owner','P1','Solar panel','material','each','active'),('foreign','other','P2','Other business','material','each','active'),('labour','owner','L1','Labour','labour','hour','active'),('untracked','owner','M1','Fittings','material','each','active'),('equipment','owner','E1','Heat pump','equipment','each','active')");
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args), first: async () => db.prepare(sql).get(...values) || null,
    all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => db.prepare(sql).run(...values) });
  const d1 = { prepare, async batch(statements) { db.exec("BEGIN"); try { const result = statements.map(s => db.prepare(s.sql).run(...s.values)); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
  const server = {}; Function("require", "exports", serverCode)(id => id.endsWith("/db") ? { getD1: () => d1 } : id === "./trade-stock" ? contract : id === "./trade-stock-schema-guards" ? stockGuards : {}, server);
  let access = { ownerUid: "owner", actorUid: "owner", isOwner: true, canViewPriceBook: true, canManagePriceBook: true }, authError = "";
  const route = {}, dependencies = {
    "@/lib/admin-server": { sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status }), cleanAdminText: (value, max) => String(value || "").slice(0, max),
      mfaErrorResponse: error => error.message === "MFA_REQUIRED" ? Response.json({ ok: false }, { status: 403 }) : null },
    "@/lib/trade-integrations-server": { requireInstallerOperations: async () => { if (authError) throw new Error(authError); return { uid: access.actorUid }; } },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { if (authError) throw new Error(authError); return access; } },
    "@/lib/trade-stock": contract, "@/lib/trade-stock-server": server,
  };
  Function("require", "exports", routeCode)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, route);
  const operation = async (action, extra = {}) => ({ action, itemId: "panel", operationId: crypto.randomUUID(), expectedRevision: (await server.stockItem("owner", extra.itemId || "panel")).revision,
    ...(["enable", "configure"].includes(action) ? { lowStockMilli: 1000 } : {}), ...extra });
  const mutate = async (action, extra = {}) => server.mutateStock("owner", "owner", await operation(action, extra));
  function job(id, { owner = "owner", product = "panel", quantity = 10000, stage = "ready", status = "required", position = 0 } = {}) {
    db.prepare("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,record_status,stage,updated_at) VALUES(?,?,'installer','active',?,?)").run(id, owner, stage, now);
    db.prepare("INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES(?,?,'trade_owned')").run(id, owner);
    db.prepare("INSERT INTO trade_crm_commercial_handovers(id,work_order_id,firebase_uid,accepted_at,created_at,status) VALUES(?,?,?,?,?,'accepted')").run(`h-${id}`, id, owner, now, now);
    db.prepare("INSERT INTO trade_crm_job_plans(id,work_order_id,firebase_uid,commercial_handoff_id,status) VALUES(?,?,?,?,'ready')").run(`p-${id}`, id, owner, `h-${id}`);
    requirement(`r-${id}`, id, { owner, product, quantity, status, position });
  }
  function requirement(id, jobId, { owner = "owner", product = "panel", quantity = 10000, status = "required", position = 0 } = {}) {
    db.prepare("INSERT INTO trade_crm_job_plan_requirements(id,job_plan_id,job_plan_phase_id,firebase_uid,requirement_type,status,source_id,quantity_milli,description,position,created_at) VALUES(?,?,?,?,'material',?,?,?,'Material',?,?)")
      .run(id, `p-${jobId}`, `phase-${jobId}`, owner, status, product, quantity, position, now);
  }
  async function actual(requirementId, quantity, { finish = true, stockLocations } = {}) {
    const r = db.prepare("SELECT r.*,p.work_order_id FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id WHERE r.id=?").get(requirementId);
    const statements = [...await server.stockActualStatements(r.firebase_uid,requirementId,quantity,stockLocations),prepare("INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,created_at) VALUES(?,?,?,'job_cost_recorded',?)").bind(crypto.randomUUID(), r.work_order_id, r.firebase_uid, now),
      prepare(`INSERT INTO trade_crm_job_actuals(id,job_plan_id,job_plan_phase_id,job_plan_requirement_id,work_order_id,firebase_uid,actual_type,quantity_milli,note,recorded_by_uid,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'material',?,'Used',?,?,?) ON CONFLICT(job_plan_requirement_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,updated_at=excluded.updated_at`)
        .bind(crypto.randomUUID(), r.job_plan_id, r.job_plan_phase_id, requirementId, r.work_order_id, r.firebase_uid, quantity, r.firebase_uid, now, now)];
    if (finish) statements.push(prepare("UPDATE trade_crm_job_plan_requirements SET status='completed' WHERE id=?").bind(requirementId));
    return d1.batch(statements);
  }
  const count = table => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  return { db, d1, server, route, operation, mutate, job, requirement, actual, count, setAccess: value => { access = { ...access, ...value }; }, setAuthError: value => { authError = value; } };
}
const post = (f, body, headers = {}) => f.route.POST(new Request("https://tlink.test/api/trade-stock", { method: "POST", headers, body: JSON.stringify(body) }));

test("stock is optional and only owned physical products are eligible", async () => {
  const f = fixture(), items = await f.server.listStock("owner");
  assert.deepEqual(items.map(i => i.itemId).sort(), ["equipment", "panel", "untracked"]);
  assert.ok(items.every(i => !i.tracked && i.revision === 0));
  await assert.rejects(f.server.stockItem("owner", "foreign"), /STOCK_ITEM_NOT_FOUND/);
  await assert.rejects(f.server.stockItem("owner", "labour"), /STOCK_ITEM_NOT_FOUND/);
  f.job("untracked-job", { product: "untracked" });
  assert.deepEqual((await f.server.jobStock("owner", "untracked-job")).requirements, []);
  await f.actual("r-untracked-job", 500000);
  assert.equal(f.count("trade_stock_movements"), 0);
});

test("receive replay is exact and stale stocktakes create no ledger or operation", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 });
  const receive = await f.operation("receive", { quantityMilli: 5000 });
  await f.server.mutateStock("owner", "manager", receive); await f.server.mutateStock("owner", "manager", receive);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 15000);
  assert.equal(f.count("trade_stock_movements"), 2);
  await assert.rejects(f.server.mutateStock("owner", "manager", { ...receive, quantityMilli: 6000 }), /STOCK_OPERATION_REUSED/);
  const before = f.count("trade_stock_operations");
  await assert.rejects(f.mutate("count", { quantityMilli: 0, expectedRevision: 1 }), /STOCK_STALE/);
  assert.equal(f.count("trade_stock_operations"), before); assert.equal(f.count("trade_stock_movements"), 2);
  assert.equal(f.db.prepare("SELECT actor_uid FROM trade_stock_movements ORDER BY rowid DESC LIMIT 1").get().actor_uid, "manager");
});

test("concurrent changes retain revisions while commitments may exceed physical stock", async () => {
  const f = fixture(); f.job("a"); f.job("b"); await f.mutate("enable", { quantityMilli: 10000 });
  const receiveA = await f.operation("receive", { quantityMilli: 1000 }), receiveB = await f.operation("receive", { quantityMilli: 2000 });
  const receives = await Promise.allSettled([f.server.mutateStock("owner", "owner", receiveA), f.server.mutateStock("owner", "owner", receiveB)]);
  assert.equal(receives.filter(r => r.status === "fulfilled").length, 1);
  const reserveA = await f.operation("reserve", { workOrderId: "a", requirementId: "r-a", quantityMilli: 10000 });
  const reserveB = await f.operation("reserve", { workOrderId: "b", requirementId: "r-b", quantityMilli: 10000 });
  const reservations = await Promise.allSettled([f.server.mutateStock("owner", "owner", reserveA), f.server.mutateStock("owner", "owner", reserveB)]);
  assert.equal(reservations.filter(r => r.status === "fulfilled").length, 1);
  await f.mutate("reserve", { workOrderId: "b", requirementId: "r-b", quantityMilli: 10000 });
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 20000);
});

test("accepted plans commit full quantities atomically even when stock is short", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 12000 });
  f.job("accepted", { quantity: 8000 }); f.requirement("second", "accepted", { quantity: 8000, position: 1 });
  const item = await f.server.stockItem("owner", "panel");
  assert.equal(item.onHandMilli, 12000); assert.equal(item.reservedMilli, 16000); assert.equal(item.availableMilli, -4000);
  const summary = await f.server.jobStock("owner", "accepted");
  assert.deepEqual(summary.requirements.map(r => [r.reservedMilli, r.shortageMilli]), [[8000, 4000], [8000, 0]]);
  f.job("no-stock", { quantity: 5000 }); assert.equal((await f.server.jobStock("owner", "no-stock")).requirements[0].shortageMilli, 5000);
  assert.equal(f.count("trade_stock_reservations"), 3);
});

test("usage consumes only once, corrections return or issue the delta with costs", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 20000 }); f.job("a");
  await f.actual("r-a", 10000); await f.actual("r-a", 10000);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 10000);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_stock_movements WHERE action='use'").get().n, 1);
  await f.actual("r-a", 8000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 12000);
  await f.actual("r-a", 11000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 9000);
  assert.equal((await f.server.jobStock("owner", "a")).requirements[0].remainingMilli, 0);
  assert.equal(f.count("trade_stock_reservations"), 0);
});

test("competing physical usage cannot overdraw stock and failed usage rolls back all records", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a"); f.job("b");
  const before = f.count("trade_work_order_events");
  await assert.rejects(f.actual("r-b", 11000), /STOCK_SHORTAGE/);
  assert.equal(f.count("trade_work_order_events"), before); assert.equal(f.count("trade_crm_job_actuals"), 0);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 10000);
  const results = await Promise.allSettled([f.actual("r-a", 10000), f.actual("r-b", 10000)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 0);
});

test("tracking enrollment never returns historical untracked usage", async () => {
  const f = fixture(); f.job("a"); await f.actual("r-a", 10000); await f.mutate("enable", { quantityMilli: 5000 });
  await f.actual("r-a", 8000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 5000);
  await f.actual("r-a", 12000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 3000);
  await f.actual("r-a", 9000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 5000);
});

test("zero actual usage releases allocation with history and a revision", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a");
  const before = await f.server.stockItem("owner", "panel"); await f.actual("r-a", 0);
  const after = await f.server.stockItem("owner", "panel");
  assert.equal(after.onHandMilli, 10000); assert.equal(after.reservedMilli, 0); assert.ok(after.revision > before.revision);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_stock_movements WHERE action='release'").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_stock_movements WHERE action='use'").get().n, 0);
});

test("cancelling or replacing accepted scope permanently releases allocation without consuming stock", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a");
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='a'");
  assert.equal((await f.server.stockItem("owner", "panel")).availableMilli, 10000);
  assert.deepEqual((await f.server.jobStock("owner", "a")).requirements.map(r => [r.remainingMilli, r.shortageMilli]), [[0, 0]]);
  f.job("b"); f.db.exec("UPDATE trade_work_orders SET stage='ready' WHERE id='a'");
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 10000);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM trade_stock_reservations WHERE work_order_id='a'").get().n, 0);
  f.db.exec("INSERT INTO trade_crm_commercial_handovers(id,work_order_id,firebase_uid,accepted_at,created_at) VALUES('h-new','b','owner','2026-09-29', '2026-09-29')");
  assert.equal((await f.server.stockItem("owner", "panel")).availableMilli, 10000);
  await assert.rejects(f.actual("r-b", 1000), /STOCK_REQUIREMENT_UNAVAILABLE/);
});

test("not-needed and completed transitions cannot resurrect allocations", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a");
  f.db.exec("UPDATE trade_crm_job_plan_requirements SET status='not_needed' WHERE id='r-a'");
  f.job("b"); f.db.exec("UPDATE trade_crm_job_plan_requirements SET status='required' WHERE id='r-a'");
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 10000);
  f.db.exec("UPDATE trade_work_orders SET stage='completed' WHERE id='b'");
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 0);
  assert.deepEqual((await f.server.jobStock("owner", "b")).requirements.map(r => [r.remainingMilli, r.shortageMilli]), [[0, 0]]);
});

test("cancel after an actual pre-read is checked in the actual transaction", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a");
  f.db.prepare("SELECT * FROM trade_crm_job_plan_requirements WHERE id='r-a'").get();
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='a'");
  await assert.rejects(f.actual("r-a", 10000), /STOCK_REQUIREMENT_UNAVAILABLE/);
  assert.equal(f.count("trade_crm_job_actuals"), 0); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 10000);
});

test("cancelled job can explicitly return previously used stock but cannot issue any more", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a"); await f.actual("r-a", 8000);
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='a'");
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 2000);
  await f.actual("r-a", 5000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 5000);
  await f.actual("r-a", 5000); assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 5000);
  await assert.rejects(f.actual("r-a", 6000), /STOCK_REQUIREMENT_UNAVAILABLE/);
  assert.equal(f.db.prepare("SELECT quantity_milli FROM trade_crm_job_actuals WHERE job_plan_requirement_id='r-a'").get().quantity_milli, 5000);
});

test("honest stocktake can record below allocations and shortages do not depend on row order", async () => {
  for (const swap of [false, true]) {
    const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a"); f.requirement("second", "a", { quantity: 10000, position: 1 });
    if (swap) f.db.exec("UPDATE trade_crm_job_plan_requirements SET position=CASE WHEN id='second' THEN -1 ELSE 1 END");
    await f.mutate("count", { quantityMilli: 8000 });
    assert.equal((await f.server.stockItem("owner", "panel")).availableMilli, -12000);
    assert.equal((await f.server.jobStock("owner", "a")).requirements.reduce((sum, r) => sum + r.shortageMilli, 0), 12000);
  }
});

test("pause retains physical counts; archived balances remain accessible and units stay protected", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 5000 });
  assert.throws(() => f.db.exec("UPDATE trade_price_book_items SET unit_label='m2' WHERE id='panel'"), /STOCK_UNITS_LOCKED/);
  await f.mutate("disable");
  assert.equal((await f.server.stockItem("owner","panel")).onHandMilli,5000);
  assert.throws(() => f.db.exec("UPDATE trade_price_book_items SET unit_label='m2' WHERE id='panel'"), /STOCK_UNITS_LOCKED/);
  f.db.exec("UPDATE trade_price_book_items SET record_status='archived' WHERE id='panel'");
  assert.ok((await f.server.listStock("owner")).some(i => i.itemId === "panel"));
  await f.mutate("count", { quantityMilli: 0 });
  assert.equal((await f.server.stockItem("owner", "panel")).tracked, false);
  f.db.exec("UPDATE trade_price_book_items SET unit_label='m2' WHERE id='panel'");
  assert.ok((await f.server.stockDetail("owner", "panel")).history.length >= 3);
});

test("stock API enforces origin, MFA, tenant ownership and team price-book permissions", async () => {
  const f = fixture(); const body = await f.operation("enable", { quantityMilli: 1000 });
  assert.equal((await post(f, body, { Origin: "https://foreign.test" })).status, 403);
  f.setAuthError("MFA_REQUIRED"); assert.equal((await post(f, body)).status, 403); f.setAuthError("");
  f.setAccess({ isOwner: false, actorUid: "staff", canManagePriceBook: false });
  assert.equal((await post(f, body)).status, 403);
  assert.equal((await f.route.GET(new Request("https://tlink.test/api/trade-stock"))).status, 200);
  f.setAccess({ canManagePriceBook: true }); assert.equal((await post(f, body)).status, 200);
  assert.equal((await f.route.GET(new Request("https://tlink.test/api/trade-stock?itemId=foreign"))).status, 404);
  f.job("owner-job"); assert.equal((await f.route.GET(new Request("https://tlink.test/api/trade-stock?workOrderId=owner-job"))).status, 404);
  f.setAccess({ canViewPriceBook: false }); assert.equal((await post(f, await f.operation("receive", { quantityMilli: 1000 }))).status, 403);
});

test("bounded inputs and overflow reject invalid units without changing stock", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: contract.MAX_STOCK_QUANTITY_MILLI });
  for (const quantityMilli of [-1, 1.5, "1", NaN, contract.MAX_STOCK_QUANTITY_MILLI + 1]) await assert.rejects(f.mutate("count", { quantityMilli }), /STOCK_INVALID_QUANTITY/);
  const before = f.count("trade_stock_operations"); await assert.rejects(f.mutate("receive", { quantityMilli: 1 }), /CHECK constraint failed/);
  assert.equal(f.count("trade_stock_operations"), before);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, contract.MAX_STOCK_QUANTITY_MILLI);
});

function quoteFixture(f) {
  f.db.exec("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,record_status,stage,updated_at) VALUES('quote-job','owner','installer','active','planning','2026-09-28'); INSERT INTO trade_crm_job_details(work_order_id,firebase_uid,customer_source) VALUES('quote-job','owner','trade_owned')");
  const line = f.db.prepare("INSERT INTO trade_crm_quote_items(id,quote_version_id,firebase_uid,position,price_book_item_id,price_book_item_type,quantity_milli,description,quote_choice_id,unit_cost_cents_ex_gst) VALUES(?,'v1','owner',?,?,?,?,?,?,10000)");
  line.run("included", 0, "equipment", "equipment", 1000, "Heat pump", "");
  line.run("selected", 1, "panel", "material", 8000, "Selected panels", "chosen");
  line.run("not-selected", 2, "panel", "material", 99000, "Alternative panels", "other-choice");
  const input = { ownerUid: "owner", workOrderId: "quote-job", handoffId: "quote-handoff", quoteVersionId: "v1", now, onlyIfTracked: true, selectedChoiceIds: ["chosen"] };
  const handoff = f.d1.prepare("INSERT INTO trade_crm_commercial_handovers(id,quote_version_id,work_order_id,firebase_uid,status,accepted_at,created_at,commercial_reference,subtotal_cents,tax_cents,total_cents) VALUES('quote-handoff','v1','quote-job','owner','accepted',?,?,'Q-TEST',10000,1000,11000)").bind(now, now);
  return { input, handoff };
}

test("real acceptance plan helper allocates only included and selected tracked components in its transaction", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 5000 }); await f.mutate("enable", { itemId: "equipment", quantityMilli: 2000 });
  const q = quoteFixture(f), statements = await planHelper.buildJobPlanStatements(f.d1, q.input);
  assert.ok(statements.length > 0);
  // Before accepted handoff exists the same guarded statements cannot create scope or consume anything.
  await f.d1.batch(statements);
  assert.equal(f.count("trade_crm_job_plans"), 0); assert.equal(f.count("trade_crm_job_plan_phases"), 0); assert.equal(f.count("trade_crm_job_plan_requirements"), 0);
  await f.d1.batch([q.handoff, ...statements]);
  assert.equal(f.count("trade_crm_job_plans"), 1); assert.equal(f.count("trade_crm_job_plan_requirements"), 2);
  assert.deepEqual(f.db.prepare("SELECT description,requirement_type FROM trade_crm_job_plan_requirements ORDER BY position").all().map(r => [r.description, r.requirement_type]), [["Heat pump", "material"], ["Selected panels", "material"]]);
  assert.equal((await f.server.stockItem("owner", "panel")).onHandMilli, 5000);
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 8000);
  assert.equal((await f.server.stockItem("owner", "equipment")).reservedMilli, 1000);
  assert.equal((await f.server.jobStock("owner", "quote-job")).requirements.reduce((sum, r) => sum + r.shortageMilli, 0), 3000);
  assert.deepEqual(await planHelper.buildJobPlanStatements(f.d1, q.input), []);
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='quote-job'");
  assert.equal((await f.server.stockItem("owner", "panel")).availableMilli, 5000);
  assert.equal((await f.server.stockItem("owner", "equipment")).availableMilli, 2000);
});

test("real plan helper leaves buy-as-needed and unselected stock quotes untouched", async () => {
  const f = fixture(); const q = quoteFixture(f);
  assert.deepEqual(await planHelper.buildJobPlanStatements(f.d1, q.input), []);
  await f.mutate("enable", { quantityMilli: 5000 });
  const declinedChoices = { ...q.input, selectedChoiceIds: [] };
  assert.deepEqual(await planHelper.buildJobPlanStatements(f.d1, declinedChoices), []);
  assert.equal(f.count("trade_crm_job_plans"), 0); assert.equal(f.count("trade_stock_reservations"), 0);
});

test("competing prepared acceptance helpers cannot create duplicate scope or allocate twice", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 20000 }); const q = quoteFixture(f);
  const first = await planHelper.buildJobPlanStatements(f.d1, q.input), second = await planHelper.buildJobPlanStatements(f.d1, q.input);
  await f.d1.batch([q.handoff, ...first]); await f.d1.batch(second);
  assert.equal(f.count("trade_crm_job_plans"), 1); assert.equal(f.count("trade_crm_job_plan_requirements"), 2);
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 8000);
});

test("Sites semicolon migration replay is additive, retry-safe and preserves existing stock", async () => {
  assert.doesNotMatch(read("drizzle/0207_trade_stock.sql"), /\bCREATE\s+TRIGGER\b/i);
  const partial = new DatabaseSync(":memory:");
  for (const object of stockGuards.TRADE_STOCK_SCHEMA_OBJECTS.slice(0, 4)) partial.exec(object.sql);
  partial.exec("INSERT INTO trade_stock_items VALUES('existing','owner',1,12000,1000,3,'2026-09-28')");
  replayStockMigration(partial); replayStockMigration(partial);
  assert.equal(partial.prepare("SELECT on_hand_milli FROM trade_stock_items").get().on_hand_milli, 12000);
  assert.equal(partial.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table'").get().n, stockGuards.TRADE_STOCK_SCHEMA_OBJECTS.filter(object=>object.type==='table').length);
  partial.close();
  const f = fixture({ installGuards: false });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
  await stockGuards.ensureTradeStockSchemaGuards(f.d1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, stockGuards.TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS.length);
  await f.mutate("enable", { quantityMilli: 10000 }); f.job("accepted");
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 10000);
});

test("runtime guards fail closed on missing or incompatible existing schema and trigger bodies", async () => {
  const missing = fixture({ installGuards: false }); missing.db.exec("DROP INDEX trade_stock_items_owner_idx");
  await assert.rejects(stockGuards.ensureTradeStockSchemaGuards(missing.d1), /TRADE_STOCK_MIGRATIONS_REQUIRED:trade_stock_items_owner_idx/);
  assert.equal(missing.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
  const incompatible = fixture({ installGuards: false }); incompatible.db.exec("DROP TABLE trade_stock_operations; CREATE TABLE trade_stock_operations(id TEXT PRIMARY KEY)");
  await assert.rejects(stockGuards.ensureTradeStockSchemaGuards(incompatible.d1), /TRADE_STOCK_SCHEMA_MISMATCH:trade_stock_operations/);
  const weakened = fixture({ installGuards: false });
  weakened.db.exec("CREATE TRIGGER trade_stock_operation_revision_guard BEFORE INSERT ON trade_stock_operations BEGIN SELECT 1; END;");
  await assert.rejects(weakened.mutate("enable", { quantityMilli: 10000 }), /TRADE_STOCK_GUARD_MISMATCH:trade_stock_operation_revision_guard/);
  assert.equal(weakened.count("trade_stock_items"), 0); assert.equal(weakened.count("trade_stock_operations"), 0);
  assert.equal(weakened.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, 1);
});

test("incomplete guard installation cannot enable stock and failed verification is not cached", async () => {
  const f = fixture({ installGuards: false }); let incomplete = true;
  const db = { ...f.d1, async batch(statements) { return f.d1.batch(incomplete ? statements.filter(statement=>!statement.sql.includes("CREATE TRIGGER IF NOT EXISTS trade_stock_actual_update_scope")) : statements); } };
  await assert.rejects(stockGuards.ensureTradeStockSchemaGuards(db), /TRADE_STOCK_GUARD_UNAVAILABLE:trade_stock_actual_update_scope/);
  incomplete = false; await stockGuards.ensureTradeStockSchemaGuards(db);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, stockGuards.TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS.length);
  const other = fixture({ installGuards: false }); let failed = true, batches = 0;
  const retry = { ...other.d1, async batch(statements) { batches++; if (failed) throw new Error("D1 unavailable"); return other.d1.batch(statements); } };
  await assert.rejects(stockGuards.ensureTradeStockSchemaGuards(retry), /D1 unavailable/);
  assert.equal(other.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
  failed = false; await stockGuards.ensureTradeStockSchemaGuards(retry); await stockGuards.ensureTradeStockSchemaGuards(retry);
  assert.equal(batches, 2);
});

test("guard installation boundaries precede activation and accepted plan statements", () => {
  const server = read("src/lib/trade-stock-server.ts"), plan = read("src/lib/trade-job-plan-server.ts"), tlink = read("src/lib/tlink-schema-guards.ts");
  assert.ok(server.indexOf("await ensureTradeStockSchemaGuards(db)") < server.indexOf("INSERT INTO trade_stock_operations"));
  assert.ok(plan.indexOf("await ensureTradeStockSchemaGuards(db)") < plan.indexOf("INSERT INTO trade_crm_job_plans"));
  assert.match(tlink, /await ensureTradeStockSchemaGuards\(database\);\s*readinessByDatabase.add/);
});

test("Main and team-member locations retain separate counts, scoped responsibility and atomic transfers", async () => {
  const f=fixture();f.db.exec("INSERT INTO trade_team_members(id,owner_uid,display_name,status) VALUES('john','owner','John','active'),('foreign-member','other','Foreign','active'),('inactive','owner','Inactive','inactive')");
  await f.mutate('enable',{quantityMilli:6000});
  const create={action:'create_location',operationId:crypto.randomUUID(),name:'John',responsibleMemberId:'john'};
  const john=await f.server.mutateStockLocation('owner','manager',create);
  assert.equal((await f.server.mutateStockLocation('owner','manager',create)).id,john.id);
  await assert.rejects(f.server.mutateStockLocation('owner','manager',{...create,name:'Changed'}),/STOCK_OPERATION_REUSED/);
  await assert.rejects(f.server.mutateStockLocation('owner','manager',{...create,operationId:crypto.randomUUID()}),/UNIQUE constraint/);
  for(const responsibleMemberId of ['foreign-member','inactive'])await assert.rejects(f.server.mutateStockLocation('owner','manager',{...create,operationId:crypto.randomUUID(),responsibleMemberId}),/STOCK_INVALID_MEMBER/);
  f.db.exec("UPDATE trade_team_members SET display_name='John Smith' WHERE id='john'");
  assert.equal((await f.server.stockLocations('owner')).find(l=>l.id===john.id).name,'John Smith');
  const transfer=await f.operation('transfer',{fromLocationId:'stock-main-owner',toLocationId:john.id,quantityMilli:3000});
  await f.server.mutateStock('owner','manager',transfer);await f.server.mutateStock('owner','manager',transfer);
  let product=await f.server.stockItem('owner','panel');assert.equal(product.onHandMilli,6000);assert.deepEqual(product.locations.map(l=>l.onHandMilli),[3000,3000]);
  assert.equal(f.count('trade_stock_transfers'),1);assert.equal((await f.server.stockDetail('owner','panel')).history.filter(m=>m.action==='transfer').length,1);
  await assert.rejects(f.mutate('transfer',{fromLocationId:john.id,toLocationId:'stock-main-owner',quantityMilli:4000}),/STOCK_SHORTAGE/);
  await assert.rejects(f.mutate('receive',{quantityMilli:1000}),/STOCK_LOCATION_REQUIRED/);
  await f.mutate('receive',{locationId:john.id,quantityMilli:1000});
  await f.mutate('count',{locationId:'stock-main-owner',quantityMilli:2000});
  product=await f.server.stockItem('owner','panel');assert.equal(product.onHandMilli,6000);assert.deepEqual(product.locations.map(l=>l.onHandMilli),[2000,4000]);
  await assert.rejects(f.server.mutateStockLocation('other','other',{action:'rename_location',operationId:crypto.randomUUID(),locationId:john.id,expectedRevision:1,name:'Stolen'}),/STOCK_LOCATION_NOT_FOUND/);
  assert.deepEqual(await f.server.stockMembers('other'),[{id:'foreign-member',name:'Foreign'}]);
  const first=await f.server.mutateStockLocation('owner','manager',{action:'rename_location',operationId:crypto.randomUUID(),locationId:john.id,expectedRevision:1,name:'John'});
  assert.equal(first.revision,2);
  await assert.rejects(f.server.mutateStockLocation('owner','manager',{action:'rename_location',operationId:crypto.randomUUID(),locationId:john.id,expectedRevision:1,name:'John'}),/STOCK_STALE/);
});

test("split stock usage and corrections debit and return explicit locations without arbitrary warehouse selection",async()=>{
  const f=fixture();await f.mutate('enable',{quantityMilli:6000});
  const second=await f.server.mutateStockLocation('owner','owner',{action:'create_location',operationId:crypto.randomUUID(),name:'Warehouse'});
  await f.mutate('transfer',{fromLocationId:'stock-main-owner',toLocationId:second.id,quantityMilli:3000});f.job('split',{quantity:4000});
  await assert.rejects(f.actual('r-split',4000),/STOCK_LOCATION_REQUIRED/);
  await assert.rejects(f.actual('r-split',4000,{stockLocations:[{locationId:'stock-main-owner',quantityMilli:4000}]}),/STOCK_SHORTAGE/);
  const split=[{locationId:'stock-main-owner',quantityMilli:2000},{locationId:second.id,quantityMilli:2000}];
  await f.actual('r-split',4000,{stockLocations:split});await f.actual('r-split',4000,{stockLocations:split});
  assert.deepEqual((await f.server.stockItem('owner','panel')).locations.map(l=>l.onHandMilli),[1000,1000]);
  await f.actual('r-split',3000,{stockLocations:[{locationId:'stock-main-owner',quantityMilli:1000},{locationId:second.id,quantityMilli:2000}]});
  assert.deepEqual((await f.server.stockItem('owner','panel')).locations.map(l=>l.onHandMilli),[2000,1000]);
  // Same-quantity location corrections must move physical stock, not silently keep the old warehouse mapping.
  await f.actual('r-split',3000,{stockLocations:[{locationId:second.id,quantityMilli:3000}]});
  assert.deepEqual((await f.server.stockItem('owner','panel')).locations.map(l=>l.onHandMilli),[3000,0]);
  const summary=(await f.server.jobStock('owner','split')).requirements[0];assert.equal(summary.stockBaselineMilli,0);assert.deepEqual(summary.stockLocations.map(l=>l.usedMilli),[0,3000]);
  const before=f.count('trade_stock_movements');await f.actual('r-split',3000);assert.equal(f.count('trade_stock_movements'),before);
  await assert.rejects(f.actual('r-split',3000,{stockLocations:[{locationId:'foreign-location',quantityMilli:3000}]}),/STOCK_INVALID_LOCATION/);
});

test("pause keeps location counts and issued history, rejects active commitments and resumes without resetting",async()=>{
  const f=fixture();await f.mutate('enable',{quantityMilli:6000});f.job('a',{quantity:4000});
  await assert.rejects(f.mutate('disable'),/STOCK_NOT_EMPTY/);
  await f.actual('r-a',4000);await f.mutate('disable');
  assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,2000);
  await assert.rejects(f.actual('r-a',3000),/STOCK_TRACKING_PAUSED/);
  await f.mutate('enable',{quantityMilli:0});assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,2000);
  await f.actual('r-a',3000);assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,3000);
  await f.mutate('disable');await f.mutate('count',{quantityMilli:2500});await f.mutate('enable',{quantityMilli:999000});
  assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,2500);
  assert.throws(()=>f.db.exec("UPDATE trade_price_book_items SET item_type='labour' WHERE id='panel'"),/STOCK_UNITS_LOCKED/);
});

test("per-location stale actuals and physical transfers cannot lose concurrent counts",async()=>{
  const f=fixture();await f.mutate('enable',{quantityMilli:3000});f.job('a',{quantity:4000});
  const product=await f.server.stockItem('owner','panel');assert.deepEqual([product.onHandMilli,product.reservedMilli,product.availableMilli],[3000,4000,-1000]);
  const prepared=await f.server.stockActualStatements('owner','r-a',1000,undefined);await f.mutate('receive',{quantityMilli:1000});
  await assert.rejects(f.d1.batch(prepared),/STOCK_STALE/);assert.equal(f.count('trade_stock_usage_selections'),0);
  await f.actual('r-a',4000);assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,0);
});

test("location rollout atomically resyncs old-worker changes and rejects aggregate-only writes after upgrade",async()=>{
  const f=fixture({installGuards:false});
  for(const guard of JSON.parse(read('test/fixtures/trade-stock-guards-v1.json')))f.db.exec(guard.sql);
  f.db.exec("INSERT INTO trade_stock_items VALUES('panel','owner',1,14000,1000,1,'2026-09-28')");f.job('old');f.job('new',{quantity:1000});
  f.db.exec("INSERT INTO trade_crm_job_actuals(id,job_plan_requirement_id,work_order_id,firebase_uid,actual_type,quantity_milli,note,recorded_by_uid,updated_at) VALUES('old-actual','r-old','old','owner','material',2000,'Used','owner','2026-09-28')");
  replayStockMigration(f.db);assert.equal(f.db.prepare("SELECT on_hand_milli FROM trade_stock_location_balances").get().on_hand_milli,12000);
  f.db.exec("UPDATE trade_crm_job_actuals SET quantity_milli=3000 WHERE id='old-actual'");
  assert.equal(f.db.prepare("SELECT on_hand_milli FROM trade_stock_items").get().on_hand_milli,11000);
  await stockGuards.ensureTradeStockSchemaGuards(f.d1);
  assert.equal(f.db.prepare("SELECT on_hand_milli FROM trade_stock_location_balances").get().on_hand_milli,11000);
  assert.equal(f.db.prepare("SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id='r-old'").get().quantity_milli,3000);
  await f.actual('r-new',1000);assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,10000);
  assert.throws(()=>f.db.exec("UPDATE trade_stock_items SET on_hand_milli=12000 WHERE item_id='panel'"),/STOCK_REFRESH_REQUIRED/);
  assert.throws(()=>f.db.exec("INSERT INTO trade_stock_items VALUES('equipment','owner',1,5000,0,1,'2026-09-28')"),/STOCK_REFRESH_REQUIRED/);
  assert.throws(()=>f.db.exec("DELETE FROM trade_stock_actual_issues WHERE requirement_id='r-old'"),/STOCK_REFRESH_REQUIRED/);
  const warehouse=await f.server.mutateStockLocation('owner','owner',{action:'create_location',operationId:crypto.randomUUID(),name:'Warehouse'});
  await f.mutate('transfer',{fromLocationId:'stock-main-owner',toLocationId:warehouse.id,quantityMilli:5000});
  replayStockMigration(f.db);await stockGuards.ensureTradeStockSchemaGuards({...f.d1});
  assert.deepEqual((await f.server.stockItem('owner','panel')).locations.map(l=>l.onHandMilli),[5000,5000]);
});

test("rollout expands old partial and zero-stock commitments while preserving explicit releases and adjustments",async()=>{
  const f=fixture({installGuards:false});for(const guard of JSON.parse(read('test/fixtures/trade-stock-guards-v1.json')))f.db.exec(guard.sql);
  f.db.exec("INSERT INTO trade_stock_items VALUES('panel','owner',1,3000,1000,1,'2026-09-28')");
  f.job('partial',{quantity:4000});f.job('empty',{quantity:2000});f.job('released',{quantity:2000});f.job('adjusted',{quantity:2000});f.job('cancelled',{quantity:2000});
  f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='cancelled'");
  const revision=f.db.prepare("SELECT revision FROM trade_stock_items WHERE item_id='panel'").get().revision;
  for(const [workOrderId,action] of [['released','release'],['adjusted','reserve']])f.db.prepare("INSERT INTO trade_stock_operations(id,firebase_uid,operation_id,item_id,action,payload_json,expected_revision,actor_uid,created_at) VALUES(?,'owner',?,'panel',?,?,?,'owner','2026-09-28')").run(workOrderId,crypto.randomUUID(),action,JSON.stringify({requirementId:`r-${workOrderId}`}),revision);
  replayStockMigration(f.db);await stockGuards.ensureTradeStockSchemaGuards(f.d1);
  assert.deepEqual(f.db.prepare("SELECT requirement_id,quantity_milli FROM trade_stock_reservations ORDER BY requirement_id").all().map(r=>[r.requirement_id,r.quantity_milli]),[['r-empty',2000],['r-partial',4000]]);
  assert.equal((await f.server.stockItem('owner','panel')).availableMilli,-3000);
});

test("location APIs keep manager permissions, duplicate operation namespaces and tenant boundaries",async()=>{
  const f=fixture();const create={action:'create_location',operationId:crypto.randomUUID(),name:'Store'};
  f.setAccess({isOwner:false,actorUid:'staff',canManagePriceBook:false});assert.equal((await post(f,create)).status,403);
  f.setAccess({canManagePriceBook:true});const response=await post(f,create);assert.equal(response.status,200);const location=(await response.json()).location;
  await f.mutate('enable',{quantityMilli:5000});
  await assert.rejects(f.mutate('receive',{quantityMilli:1000,locationId:location.id,operationId:create.operationId}),/STOCK_OPERATION_REUSED/);
  const receipt=await f.operation('receive',{quantityMilli:1000,locationId:location.id});await f.server.mutateStock('owner','staff',receipt);
  await assert.rejects(f.mutate('transfer',{operationId:receipt.operationId,fromLocationId:'stock-main-owner',toLocationId:location.id,quantityMilli:1000}),/STOCK_OPERATION_REUSED/);
  const foreign=await f.server.mutateStockLocation('other','other',{action:'create_location',operationId:crypto.randomUUID(),name:'Private'});
  await assert.rejects(f.mutate('count',{locationId:foreign.id,quantityMilli:0}),/STOCK_LOCATION_NOT_FOUND/);
  await assert.rejects(f.mutate('transfer',{fromLocationId:'stock-main-owner',toLocationId:foreign.id,quantityMilli:1000}),/STOCK_LOCATION_NOT_FOUND/);
  assert.equal((await f.server.stockItem('owner','panel')).onHandMilli,6000);
});

test("cancelled-job returns cannot issue physical stock from a different location",async()=>{
  const f=fixture();await f.mutate('enable',{quantityMilli:6000});const store=await f.server.mutateStockLocation('owner','owner',{action:'create_location',operationId:crypto.randomUUID(),name:'Store'});
  await f.mutate('transfer',{fromLocationId:'stock-main-owner',toLocationId:store.id,quantityMilli:3000});f.job('a',{quantity:3000});
  await f.actual('r-a',3000,{stockLocations:[{locationId:'stock-main-owner',quantityMilli:3000}]});f.db.exec("UPDATE trade_work_orders SET stage='cancelled' WHERE id='a'");
  await assert.rejects(f.actual('r-a',2000,{stockLocations:[{locationId:store.id,quantityMilli:2000}]}),/STOCK_REQUIREMENT_UNAVAILABLE/);
  await f.actual('r-a',2000,{stockLocations:[{locationId:'stock-main-owner',quantityMilli:2000}]});
  assert.deepEqual((await f.server.stockItem('owner','panel')).locations.map(l=>l.onHandMilli),[1000,3000]);
});

test("a failed recognized guard upgrade rolls back guards, rollout marker and stock reconciliation",async()=>{
  const f=fixture({installGuards:false});for(const guard of JSON.parse(read('test/fixtures/trade-stock-guards-v1.json')))f.db.exec(guard.sql);
  f.db.exec("INSERT INTO trade_stock_items VALUES('panel','owner',1,3000,1000,1,'2026-09-28')");replayStockMigration(f.db);
  const before=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='trade_stock_operation_revision_guard'").get().sql;
  const broken={...f.d1,batch:statements=>f.d1.batch([...statements,f.d1.prepare('INSERT INTO definitely_missing_table VALUES(1)')])};
  await assert.rejects(stockGuards.ensureTradeStockSchemaGuards(broken),/no such table/);
  assert.equal(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='trade_stock_operation_revision_guard'").get().sql,before);
  assert.equal(f.count('trade_stock_location_rollout'),0);
  await stockGuards.ensureTradeStockSchemaGuards({...f.d1});assert.equal(f.count('trade_stock_location_rollout'),1);
});
