import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as contract from "../src/lib/trade-stock.ts";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = path => ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const serverCode = compile("src/lib/trade-stock-server.ts"), routeCode = compile("src/app/api/trade-stock/route.ts");
const planHelper = {}; Function("require", "exports", compile("src/lib/trade-job-plan-server.ts"))(() => ({}), planHelper);
const now = "2026-09-28T10:00:00.000Z";

function fixture() {
  const db = new DatabaseSync(":memory:");
  const schema = read("db/schema.ts");
  for (const table of ["trade_price_book_items", "trade_work_orders", "trade_crm_job_details", "trade_crm_job_plans", "trade_crm_job_plan_phases", "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_work_order_events", "trade_crm_commercial_handovers", "trade_crm_quote_items", "trade_crm_quote_execution_snapshots", "trade_crm_quote_acceptances"]) {
    const start = schema.indexOf(`sqliteTable("${table}", {`), block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    assert.ok(columns.length, table);
    db.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/cents|minutes|milli|position/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  db.exec("CREATE UNIQUE INDEX actual_requirement ON trade_crm_job_actuals(job_plan_requirement_id)");
  db.exec(read("drizzle/0207_trade_stock.sql"));
  db.exec("INSERT INTO trade_price_book_items(id,firebase_uid,item_code,name,item_type,unit_label,record_status) VALUES ('panel','owner','P1','Solar panel','material','each','active'),('foreign','other','P2','Other business','material','each','active'),('labour','owner','L1','Labour','labour','hour','active'),('untracked','owner','M1','Fittings','material','each','active'),('equipment','owner','E1','Heat pump','equipment','each','active')");
  const prepare = (sql, values = []) => ({ sql, values, bind: (...args) => prepare(sql, args), first: async () => db.prepare(sql).get(...values) || null,
    all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => db.prepare(sql).run(...values) });
  const d1 = { prepare, async batch(statements) { db.exec("BEGIN"); try { const result = statements.map(s => db.prepare(s.sql).run(...s.values)); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } } };
  const server = {}; Function("require", "exports", serverCode)(id => id.endsWith("/db") ? { getD1: () => d1 } : id === "./trade-stock" ? contract : {}, server);
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
  async function actual(requirementId, quantity, { finish = true } = {}) {
    const r = db.prepare("SELECT r.*,p.work_order_id FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id WHERE r.id=?").get(requirementId);
    const statements = [prepare("INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,created_at) VALUES(?,?,?,'job_cost_recorded',?)").bind(crypto.randomUUID(), r.work_order_id, r.firebase_uid, now),
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

test("concurrent receives and reservations cannot overwrite or overallocate stock", async () => {
  const f = fixture(); f.job("a"); f.job("b"); await f.mutate("enable", { quantityMilli: 10000 });
  const receiveA = await f.operation("receive", { quantityMilli: 1000 }), receiveB = await f.operation("receive", { quantityMilli: 2000 });
  const receives = await Promise.allSettled([f.server.mutateStock("owner", "owner", receiveA), f.server.mutateStock("owner", "owner", receiveB)]);
  assert.equal(receives.filter(r => r.status === "fulfilled").length, 1);
  const reserveA = await f.operation("reserve", { workOrderId: "a", requirementId: "r-a", quantityMilli: 10000 });
  const reserveB = await f.operation("reserve", { workOrderId: "b", requirementId: "r-b", quantityMilli: 10000 });
  const reservations = await Promise.allSettled([f.server.mutateStock("owner", "owner", reserveA), f.server.mutateStock("owner", "owner", reserveB)]);
  assert.equal(reservations.filter(r => r.status === "fulfilled").length, 1);
  await assert.rejects(f.mutate("reserve", { workOrderId: "b", requirementId: "r-b", quantityMilli: 10000 }), /STOCK_SHORTAGE/);
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 10000);
});

test("accepted plans allocate available stock atomically, partial shortage does not reject acceptance", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 12000 });
  f.job("accepted", { quantity: 8000 }); f.requirement("second", "accepted", { quantity: 8000, position: 1 });
  const item = await f.server.stockItem("owner", "panel");
  assert.equal(item.onHandMilli, 12000); assert.equal(item.reservedMilli, 12000); assert.equal(item.availableMilli, 0);
  const summary = await f.server.jobStock("owner", "accepted");
  assert.deepEqual(summary.requirements.map(r => [r.reservedMilli, r.shortageMilli]), [[8000, 0], [4000, 4000]]);
  f.job("no-stock", { quantity: 5000 }); assert.equal((await f.server.jobStock("owner", "no-stock")).requirements[0].shortageMilli, 5000);
  assert.equal(f.count("trade_stock_reservations"), 2);
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

test("competing use respects reservations and rollback preserves actuals, stock and events", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 10000 }); f.job("a"); f.job("b");
  const before = f.count("trade_work_order_events");
  await assert.rejects(f.actual("r-b", 5000), /STOCK_SHORTAGE/);
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
    assert.equal((await f.server.stockItem("owner", "panel")).availableMilli, -2000);
    assert.equal((await f.server.jobStock("owner", "a")).requirements.reduce((sum, r) => sum + r.shortageMilli, 0), 12000);
  }
});

test("disable requires reconciled stock; archived balances remain accessible and units stay protected", async () => {
  const f = fixture(); await f.mutate("enable", { quantityMilli: 5000 });
  assert.throws(() => f.db.exec("UPDATE trade_price_book_items SET unit_label='m2' WHERE id='panel'"), /STOCK_UNITS_LOCKED/);
  await assert.rejects(f.mutate("disable"), /STOCK_NOT_EMPTY/);
  f.db.exec("UPDATE trade_price_book_items SET record_status='archived' WHERE id='panel'");
  assert.ok((await f.server.listStock("owner")).some(i => i.itemId === "panel"));
  await f.mutate("count", { quantityMilli: 0 }); await f.mutate("disable");
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
  assert.equal((await f.server.stockItem("owner", "panel")).reservedMilli, 5000);
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
