import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as priceBook from "../src/lib/trade-price-book.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const values = { name: "Insulation roll", itemType: "material", unitLabel: "roll", supplierCost: "8", sellPrice: "12.50", taxCode: "gst", expectedDurationMinutes: "0" };
const cleanAdminText = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const accessA = { ownerUid: "owner-a", actorUid: "staff-a", isOwner: false, canViewPriceBook: true, canManagePriceBook: true };

function priceBookDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const migration = read("../drizzle/0064_trade_price_book.sql");
  sqlite.exec(migration.slice(0, migration.indexOf("ALTER TABLE")));
  sqlite.exec(read("../drizzle/0199_trade_price_book_solar_panel.sql"));
  return sqlite;
}

function fixture() {
  const sqlite = priceBookDatabase();
  sqlite.exec(read("../drizzle/0209_trade_price_book_categories.sql"));
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, capabilities TEXT, business_name TEXT, partner_type TEXT);
    INSERT INTO trade_accounts VALUES ('owner-a','[]','Business A','installer'),('owner-b','[]','Business B','installer');
    CREATE TABLE supplier_products(id TEXT, firebase_uid TEXT, model_number TEXT, name TEXT, unit_price_cents_ex_gst INTEGER,
      listing_status TEXT, review_status TEXT, updated_at TEXT);`);
  let access = accessA;
  let databaseCalls = 0;
  let beforeBatch;
  const db = {
    prepare(sql) {
      databaseCalls++;
      const prepared = (args = []) => ({ sql, args, bind: (...next) => prepared(next),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => sqlite.prepare(sql).run(...args) });
      return prepared();
    },
    async batch(statements) {
      if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; callback(); }
      sqlite.exec("BEGIN IMMEDIATE");
      try { for (const statement of statements) sqlite.prepare(statement.sql).all(...statement.args); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      return [];
    },
  };
  const dependencies = {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { cleanAdminText, sameOrigin: (request) => request.headers.get("Origin") !== "https://foreign.com",
      mfaErrorResponse: () => null, adminJson: (data, status = 200) => Response.json(data, { status }) },
    "@/lib/trade-price-book": priceBook,
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { if (!access) throw new Error("AUTH_REQUIRED"); return access; } },
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: () => "1=1" },
  };
  const compiled = ts.transpileModule(read("../src/app/api/trade-price-book/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const route = {};
  Function("require", "exports", compiled)((id) => { assert.ok(dependencies[id], `Unexpected import ${id}`); return dependencies[id]; }, route);
  const request = (method, body, query = "") => new Request(`https://tlink.test/api/trade-price-book${query}`, {
    method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = async (body = {}) => {
    const response = await route.POST(request("POST", { action: "create", ...values, ...body }));
    assert.equal(response.status, 201); return (await response.json()).item;
  };
  const list = async (query = "") => {
    const response = await route.GET(request("GET", null, query));
    assert.equal(response.status, 200); return response.json();
  };
  return { sqlite, route, request, create, list, setAccess: (next) => { access = next; }, calls: () => databaseCalls,
    beforeNextBatch: (callback) => { beforeBatch = callback; } };
}

test("category normalization is optional, bounded and independent of the financial type", () => {
  assert.equal(Object.hasOwn(priceBook.normalisePriceBookInput(values, cleanAdminText), "category"), false);
  const result = priceBook.normalisePriceBookInput({ ...values, category: "  Roof   insulation  " }, cleanAdminText);
  assert.equal(result.category, "Roof insulation");
  assert.equal(result.itemType, "material");
  assert.equal(result.sellPriceCentsExGst, 1250);
  assert.equal(priceBook.normalisePriceBookCategory(" \t "), "");
  assert.equal(priceBook.normalisePriceBookCategory("a".repeat(80)), "a".repeat(80));
  for (const category of ["a".repeat(81), null, undefined, 1, {}, [], "Roof\u0000insulation", "Roof\u007finsulation"]) {
    assert.throws(() => priceBook.normalisePriceBookCategory(category), /INVALID_PRICE_BOOK_CATEGORY/);
  }
});

test("category migration preserves existing products and enforces the stored length limit", () => {
  const sqlite = priceBookDatabase();
  sqlite.exec(`INSERT INTO trade_price_book_items(id,firebase_uid,item_code,name,item_type,sell_price_cents_ex_gst,
    created_by_uid,updated_by_uid,created_at,updated_at) VALUES('old','owner-a','PB-OLD','Old product','material',1250,'owner-a','owner-a','now','now')`);
  sqlite.exec(read("../drizzle/0209_trade_price_book_categories.sql"));
  assert.deepEqual({ ...sqlite.prepare("SELECT name,sell_price_cents_ex_gst,category FROM trade_price_book_items WHERE id='old'").get() },
    { name: "Old product", sell_price_cents_ex_gst: 1250, category: "" });
  sqlite.prepare("UPDATE trade_price_book_items SET category=? WHERE id='old'").run("a".repeat(80));
  assert.throws(() => sqlite.prepare("UPDATE trade_price_book_items SET category=? WHERE id='old'").run("a".repeat(81)), /CHECK constraint failed/);
  sqlite.close();
});

test("category saves persist, omitted updates preserve the latest value and explicit empty clears it", async () => {
  const f = fixture(); const item = await f.create({ category: "  Insulation  " });
  assert.equal(item.category, "Insulation");
  assert.equal(f.sqlite.prepare("SELECT category FROM trade_price_book_items WHERE id=?").get(item.id).category, "Insulation");
  f.beforeNextBatch(() => f.sqlite.prepare("UPDATE trade_price_book_items SET category='Roof insulation' WHERE id=?").run(item.id));
  let response = await f.route.PATCH(f.request("PATCH", { ...values, action: "update", itemId: item.id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.category, "Roof insulation", "an older caller cannot restore a stale category read before the update");
  response = await f.route.PATCH(f.request("PATCH", { ...values, action: "update", itemId: item.id, category: "Ceiling insulation" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.category, "Ceiling insulation");
  response = await f.route.PATCH(f.request("PATCH", { ...values, action: "update", itemId: item.id, category: "  " }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.category, "");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history WHERE price_book_item_id=?").get(item.id).count, 1,
    "category changes do not invent a price revision");
  assert.equal((await f.create()).category, "", "old create callers remain valid");
  f.sqlite.close();
});

test("category options cover all owner items independently of search, type and archive filters", async () => {
  const f = fixture();
  const solar = await f.create({ name: "Panel", category: "Solar panels" });
  await f.create({ name: "Second panel", category: "solar panels" });
  await f.create({ name: "Insulation tool", category: "Insulation", itemType: "equipment" });
  const archived = await f.create({ category: "Archived range" });
  let response = await f.route.PATCH(f.request("PATCH", { action: "archive", itemId: archived.id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.category, "Archived range");
  await f.create({ name: "Uncategorised" });
  f.setAccess({ ownerUid: "owner-b", actorUid: "owner-b", isOwner: true });
  const privateItem = await f.create({ name: "Private item", category: "Private category" });
  f.setAccess(accessA);
  const data = await f.list("?itemType=material&category=SOLAR%20PANELS&search=Panel&ownerUid=owner-b");
  assert.equal(data.items.length, 2);
  assert.ok(data.items.some((item) => item.id === solar.id));
  assert.deepEqual(data.categoryOptions, ["Archived range", "Insulation", "Solar panels"]);
  assert.doesNotMatch(JSON.stringify(data), /Private item|Private category/);
  const empty = await f.list("?status=archived&itemType=equipment&search=nonexistent");
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.categoryOptions, data.categoryOptions);
  response = await f.route.PATCH(f.request("PATCH", { ...values, action: "update", itemId: privateItem.id, category: "Stolen", ownerUid: "owner-b" }));
  assert.equal(response.status, 404);
  response = await f.route.PATCH(f.request("PATCH", { action: "archive", itemId: privateItem.id }));
  assert.equal(response.status, 404);
  assert.deepEqual({ ...f.sqlite.prepare("SELECT category,record_status FROM trade_price_book_items WHERE id=?").get(privateItem.id) },
    { category: "Private category", record_status: "active" });
  f.sqlite.close();
});

test("server type and category filters search the full library before the 500-item display limit", async () => {
  const f = fixture(); const first = await f.create({ name: "A filler", category: "General" });
  const row = f.sqlite.prepare("SELECT * FROM trade_price_book_items WHERE id=?").get(first.id);
  const columns = Object.keys(row);
  const insert = f.sqlite.prepare(`INSERT INTO trade_price_book_items(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
  for (let index = 0; index < 500; index++) {
    const next = { ...row, id: `filler-${index}`, item_code: `PB-FILLER-${index}`, name: `A filler ${index}` };
    insert.run(...columns.map((column) => next[column]));
  }
  const target = await f.create({ name: "Z tool", itemType: "equipment", category: "Roof tools" });
  const unfiltered = await f.list();
  assert.equal(unfiltered.items.length, 500);
  assert.equal(unfiltered.items.some((item) => item.id === target.id), false);
  assert.deepEqual(unfiltered.categoryOptions, ["General", "Roof tools"]);
  for (const query of ["?itemType=equipment", "?category=roof%20tools", "?itemType=equipment&category=Roof%20tools", "?search=Roof%20tools"]) {
    const filtered = await f.list(query);
    assert.deepEqual(filtered.items.map((item) => item.id), [target.id], query);
  }
  f.sqlite.close();
});

test("category text search treats wildcard and escape characters literally", async () => {
  const f = fixture();
  const exact = await f.create({ name: "Special product", category: "100%_\\ roof" });
  await f.create({ name: "Ordinary product", category: "100 percentage X roof" });
  for (const search of ["%", "_", "\\", "100%_\\"]) {
    const data = await f.list(`?search=${encodeURIComponent(search)}`);
    assert.deepEqual(data.items.map((item) => item.id), [exact.id]);
  }
  assert.deepEqual((await f.list(`?category=${encodeURIComponent("100%_\\ roof")}`)).items.map((item) => item.id), [exact.id]);
  f.sqlite.close();
});

test("invalid categories and filters reject without writes, and access checks precede database reads", async () => {
  const f = fixture(); const item = await f.create({ category: "Insulation" });
  for (const category of ["a".repeat(81), null, {}, "Bad\u0000category"]) {
    assert.equal((await f.route.POST(f.request("POST", { action: "create", ...values, category }))).status, 400);
    assert.equal((await f.route.PATCH(f.request("PATCH", { action: "update", ...values, itemId: item.id, category }))).status, 400);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT category FROM trade_price_book_items WHERE id=?").get(item.id).category, "Insulation");
  for (const query of ["?itemType=unknown", `?category=${"a".repeat(81)}`, "?category=bad%00category"]) {
    assert.equal((await f.route.GET(f.request("GET", null, query))).status, 400);
  }
  const calls = f.calls();
  f.setAccess(null);
  assert.equal((await f.route.GET(f.request("GET"))).status, 401);
  f.setAccess({ ...accessA, canViewPriceBook: false, canManagePriceBook: false });
  assert.equal((await f.route.GET(f.request("GET"))).status, 403);
  assert.equal((await f.route.POST(f.request("POST", { action: "create", ...values, category: "Hidden" }))).status, 403);
  assert.equal((await f.route.PATCH(f.request("PATCH", { action: "update", ...values, itemId: item.id, category: "Hidden" }))).status, 403);
  f.setAccess(accessA);
  for (const method of ["GET", "POST", "PATCH"]) {
    const request = new Request("https://tlink.test/api/trade-price-book", { method, headers: { Origin: "https://foreign.com" } });
    assert.equal((await f.route[method](request)).status, 403);
  }
  assert.equal(f.calls(), calls);
  f.sqlite.close();
});
