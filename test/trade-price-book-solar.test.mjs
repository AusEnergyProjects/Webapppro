import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as priceBook from "../src/lib/trade-price-book.ts";
import { importPriceBook } from "../src/lib/trade-price-book-import-server.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const solarPanel = { watts: 440, widthM: 1.134, lengthM: 1.762, model: "P440", manufacturer: "Test Solar", datasheetUrl: "https://manufacturer.com/panel.pdf" };
const values = { name: "Test Solar P440", itemType: "material", unitLabel: "each", supplierCost: "90", sellPrice: "150", taxCode: "gst", expectedDurationMinutes: "0", solarPanel };
const cleanAdminText = (value, maximum) => String(value ?? "").trim().slice(0, maximum);

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migration = read("../drizzle/0064_trade_price_book.sql");
  sqlite.exec(migration.slice(0, migration.indexOf("ALTER TABLE")));
  sqlite.exec(read("../drizzle/0199_trade_price_book_solar_panel.sql"));
  sqlite.exec(read("../drizzle/0209_trade_price_book_categories.sql"));
  sqlite.exec(read("../drizzle/0211_trade_price_book_coverage.sql"));
  sqlite.exec("CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, capabilities TEXT); INSERT INTO trade_accounts VALUES ('owner-a','[]'),('owner-b','[]')");
  let databaseCalls = 0;
  let access = { ownerUid: "owner-a", actorUid: "staff-a", isOwner: false, canViewPriceBook: true, canManagePriceBook: true };
  const db = {
    prepare(sql) {
      databaseCalls++;
      const prepared = (args = []) => ({ sql, args, bind: (...values) => prepared(values),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => sqlite.prepare(sql).run(...args) });
      return prepared();
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try { for (const statement of statements) sqlite.prepare(statement.sql).all(...statement.args); sqlite.exec("COMMIT"); }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      return [];
    },
  };
  const dependencies = {
    "../../../../db": { getD1: () => db },
    "@/lib/admin-server": { cleanAdminText, sameOrigin: (request) => request.headers.get("Origin") !== "https://foreign.com", mfaErrorResponse: () => null,
      adminJson: (data, status = 200) => Response.json(data, { status }) },
    "@/lib/trade-price-book": priceBook,
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => { if (!access) throw new Error("AUTH_REQUIRED"); return access; } },
    "@/lib/trade-access-server": { verifiedTradeAccountPredicate: () => "1=1" },
  };
  const compiled = ts.transpileModule(read("../src/app/api/trade-price-book/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = {};
  Function("require", "exports", compiled)((id) => { assert.ok(dependencies[id], `Unexpected import ${id}`); return dependencies[id]; }, route);
  const request = (method, body, query = "") => new Request(`https://tlink.test/api/trade-price-book${query}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const create = async (body = {}) => {
    const response = await route.POST(request("POST", { action: "create", ...values, ...body }));
    assert.equal(response.status, 201); return (await response.json()).item;
  };
  return { sqlite, db, route, request, create, setAccess: (next) => { access = next; }, calls: () => databaseCalls };
}

test("price-book solar panel classification validates exact dimensions and retains the financial item type", () => {
  const result = priceBook.normalisePriceBookInput(values, cleanAdminText);
  assert.equal(result.itemType, "material"); assert.deepEqual(result.solarPanel, solarPanel);
  assert.equal(result.sellPriceCentsExGst, 15000);
  for (const change of [{ watts: 0 }, { widthM: "1.134" }, { lengthM: 9 }, { datasheetUrl: "javascript:alert(1)" }]) {
    assert.throws(() => priceBook.normalisePriceBookInput({ ...values, solarPanel: { ...solarPanel, ...change } }, cleanAdminText), /INVALID_PRICE_BOOK_SOLAR_PANEL/);
  }
  assert.throws(() => priceBook.normalisePriceBookInput({ ...values, itemType: "labour" }, cleanAdminText), /INVALID_PRICE_BOOK_SOLAR_PANEL_TYPE/);
  const ordinary = { ...values }; delete ordinary.solarPanel;
  assert.equal("solarPanel" in priceBook.normalisePriceBookInput(ordinary, cleanAdminText), false, "older clients need not know the new field");
  assert.equal(priceBook.parsePriceBookSolarPanel("null"), null);
});

test("solar equipment selection is owner scoped and uses explicit kind without exposing financial fields", async () => {
  const f = fixture();
  const inverter = await f.create({ name: "My saved equipment", supplierSku: "MODEL-1", solarPanel: null });
  await f.create({ name: "Pack item", unitLabel: "pack", solarPanel: null });
  await f.create({ name: "Service", itemType: "labour", solarPanel: null });
  const archived = await f.create({ name: "Archived equipment", solarPanel: null });
  f.sqlite.prepare("UPDATE trade_price_book_items SET record_status='archived' WHERE id=?").run(archived.id);
  f.setAccess({ ownerUid: "owner-b", actorUid: "owner-b", isOwner: true, canViewPriceBook: true });
  await f.create({ name: "Other business equipment", solarPanel: null });
  f.setAccess({ ownerUid: "owner-a", actorUid: "staff-a", canViewPriceBook: true });
  for (const kind of ["inverter", "battery", "hot_water"]) {
    const response = await f.route.GET(f.request("GET", null, `?mode=solar_equipment&kind=${kind}`));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).equipment, [{ id: inverter.id, kind, name: "My saved equipment", manufacturer: "", model: "MODEL-1", quantity: 1, priceBookItemId: inverter.id }]);
  }
  const calls = f.calls();
  assert.equal((await f.route.GET(f.request("GET", null, "?mode=solar_equipment&kind=panel"))).status, 400);
  assert.equal(f.calls(), calls);
  f.setAccess({ ownerUid: "owner-a", actorUid: "staff-a", canViewPriceBook: false });
  assert.equal((await f.route.GET(f.request("GET", null, "?mode=solar_equipment&kind=inverter"))).status, 403);
  assert.equal(f.calls(), calls);
  f.sqlite.close();
});

test("own insulation products retain roll, pack and bag charging units", async () => {
  const f = fixture();
  for (const unitLabel of ["roll", "pack", "bag"]) {
    const saved = await f.create({ name: `Insulation ${unitLabel}`, solarPanel: null, unitLabel });
    assert.equal(saved.unitLabel, unitLabel);
    assert.equal(f.sqlite.prepare("SELECT unit_label FROM trade_price_book_items WHERE id=?").get(saved.id).unit_label, unitLabel);
  }
  f.sqlite.close();
});

test("map projection includes only authenticated owner's active solar panels and excludes all prices", async () => {
  const f = fixture(); const item = await f.create();
  const archived = await f.create({ name: "Archived panel" });
  await f.route.PATCH(f.request("PATCH", { action: "archive", itemId: archived.id }));
  await f.create({ name: "General material", solarPanel: null });
  f.setAccess({ ownerUid: "owner-b", actorUid: "owner-b", isOwner: true });
  await f.create({ name: "Other business private model" });
  f.setAccess({ ownerUid: "owner-a", actorUid: "staff-a", isOwner: false, canViewPriceBook: true });
  const response = await f.route.GET(f.request("GET", null, "?mode=solar_panels&ownerUid=owner-b&status=all"));
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.solarPanels.length, 1);
  assert.deepEqual(data.solarPanels[0], { id: item.id, priceBookItemId: item.id, kind: "panel", name: values.name, manufacturer: "Test Solar", model: "P440", quantity: 1, ...solarPanel });
  assert.doesNotMatch(JSON.stringify(data), /sellPrice|supplierCost|markup|margin|Other business/);
  f.sqlite.close();
});

test("price updates from older clients preserve panel metadata and explicit General item removes it", async () => {
  const f = fixture(); const item = await f.create();
  const older = { ...values }; delete older.solarPanel;
  let response = await f.route.PATCH(f.request("PATCH", { ...older, action: "update", itemId: item.id, sellPrice: "180", ownerUid: "owner-b" }));
  assert.equal(response.status, 200);
  let saved = (await response.json()).item;
  assert.deepEqual(saved.solarPanel, solarPanel); assert.equal(saved.priceRevision, 2); assert.equal(saved.sellPriceCentsExGst, 18000);
  response = await f.route.PATCH(f.request("PATCH", { ...older, action: "update", itemId: item.id, sellPrice: "180", solarPanel: null }));
  assert.equal(response.status, 200); saved = (await response.json()).item;
  assert.equal(saved.solarPanel, null); assert.equal(saved.priceRevision, 2, "model-only changes do not invent price history");
  assert.equal(f.sqlite.prepare("SELECT solar_panel_json FROM trade_price_book_items WHERE id=?").get(item.id).solar_panel_json, "null");
  f.sqlite.close();
});

test("spreadsheet price updates preserve existing panel dimensions and model documents", async () => {
  const f = fixture(); const item = await f.create();
  const rows = [{ rowNumber: 2, values: { itemCode: item.itemCode, sellPrice: "200.00" } }];
  const preview = await importPriceBook(f.db, "owner-a", "staff-a", { action: "preview", rows });
  assert.equal(preview.preview.canImport, true);
  await importPriceBook(f.db, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  const saved = f.sqlite.prepare("SELECT solar_panel_json, sell_price_cents_ex_gst FROM trade_price_book_items WHERE id=?").get(item.id);
  assert.equal(saved.sell_price_cents_ex_gst, 20000); assert.deepEqual(JSON.parse(saved.solar_panel_json), solarPanel);
  f.sqlite.close();
});

test("map projection rejects unauthenticated and unpermitted callers before database access", async () => {
  const f = fixture();
  f.setAccess(null);
  assert.equal((await f.route.GET(f.request("GET", null, "?mode=solar_panels"))).status, 401);
  f.setAccess({ ownerUid: "owner-a", actorUid: "staff-a", isOwner: false, canViewPriceBook: false, canManagePriceBook: false });
  assert.equal((await f.route.GET(f.request("GET", null, "?mode=solar_panels"))).status, 403);
  const foreign = new Request("https://tlink.test/api/trade-price-book?mode=solar_panels", { headers: { Origin: "https://foreign.com" } });
  assert.equal((await f.route.GET(foreign)).status, 403);
  assert.equal(f.calls(), 0); f.sqlite.close();
});

test("map projection is not cut off by the price-book editor's 500-row display limit", async () => {
  const f = fixture(); const first = await f.create();
  const row = f.sqlite.prepare("SELECT * FROM trade_price_book_items WHERE id=?").get(first.id);
  const columns = Object.keys(row); const insert = f.sqlite.prepare(`INSERT INTO trade_price_book_items(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
  for (let index = 1; index <= 500; index++) {
    const next = { ...row, id: `panel-${index}`, item_code: `PB-${index}`, name: `Panel ${index}` };
    insert.run(...columns.map((column) => next[column]));
  }
  const response = await f.route.GET(f.request("GET", null, "?mode=solar_panels"));
  assert.equal((await response.json()).solarPanels.length, 501); f.sqlite.close();
});

test("invalid model specifications reject the whole save without creating a price record", async () => {
  const f = fixture();
  const response = await f.route.POST(f.request("POST", { action: "create", ...values, solarPanel: { watts: 440, widthM: 1.134 } }));
  assert.equal(response.status, 400);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 0);
  f.sqlite.close();
});
