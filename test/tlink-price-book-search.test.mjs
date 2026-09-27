import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

function harness(t, options = {}) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE trade_price_book_items (
    id TEXT, firebase_uid TEXT, item_code TEXT, name TEXT, item_type TEXT, unit_label TEXT,
    sell_price_cents_ex_gst INTEGER, supplier_name TEXT, supplier_sku TEXT, record_status TEXT);
    CREATE TABLE supplier_products (
      id TEXT, firebase_uid TEXT, model_number TEXT, brand TEXT, name TEXT, category TEXT,
      unit_price_cents_ex_gst INTEGER, stock_status TEXT, listing_status TEXT, review_status TEXT);`);
  const item = db.prepare("INSERT INTO trade_price_book_items VALUES (?, ?, ?, ?, 'material', 'each', 340000, 'Supplier', 'HP-300', ?)");
  item.run("own-product", "business-a", "PB-001", "Heat pump", "active");
  item.run("other-product", "business-b", "PB-001", "Heat pump private", "active");
  item.run("archived-product", "business-a", "PB-002", "Heat pump archived", "archived");
  const supplier = db.prepare("INSERT INTO supplier_products VALUES (?, ?, 'HP-300', 'Example', 'Heat pump wholesale', 'heat_pump', 100000, 'in_stock', 'draft', 'pending')");
  supplier.run("supplier-own", "supplier-a"); supplier.run("supplier-other", "supplier-b");
  const queries = [];
  const access = { ownerUid: "business-a", canViewPriceBook: true, ...options.access };
  class TradeAccessError extends Error {}
  const dependencies = {
    "../../../../db": { getD1: () => ({ prepare: sql => ({ bind: (...args) => ({
      all: async () => { queries.push({ sql, args }); return { results: db.prepare(sql).all(...args) }; },
    }) }) }) },
    "@/lib/admin-server": { sameOrigin: () => true, mfaErrorResponse: () => null,
      adminJson: (body, status = 200) => Response.json(body, { status }), cleanAdminText: (value, length) => String(value || "").trim().slice(0, length) },
    "@/lib/direct-trade-entitlements-server": { accountEntitlements: async () => ({ features: { business_operations: options.businessOperations !== false, installer_marketplace: false } }) },
    "@/lib/trade-access-server": { TradeAccessError, tradeAccountProjection: async () => options.member ? null : {},
      requireVerifiedTradeIdentity: async () => ({ partnerType: options.supplier ? "supplier" : "installer" }) },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => ({ uid: options.supplier ? "supplier-a" : options.member ? "member-a" : "business-a" }) },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access, canManageTeam: () => false },
  };
  const source = fs.readFileSync(new URL("../src/app/api/tlink-search/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; Function("require", "exports", code)(id => {
    assert.ok(dependencies[id], `Unexpected dependency ${id}`); return dependencies[id];
  }, exports);
  return { queries, async search(query = "heat") {
    const response = await exports.GET(new Request(`https://tlink.test/api/tlink-search?kind=product&q=${encodeURIComponent(query)}`));
    assert.equal(response.status, 200); return (await response.json()).records;
  } };
}

test("installer product search returns only active items from its own price book with no marketplace entitlement", async t => {
  const h = harness(t); const results = await h.search();
  assert.deepEqual(results.map(result => result.id), ["own-product"]);
  assert.equal(results[0].query, "PB-001"); assert.equal(results[0].detail, "PB-001");
  assert.match(results[0].meta, /\$3,400\.00 ex GST/);
  assert.equal(h.queries.length, 1); assert.equal(h.queries[0].args[0], "business-a");
  assert.doesNotMatch(h.queries[0].sql, /supplier_products/);
});

test("team member search uses the owner price book instead of the member uid", async t => {
  const h = harness(t, { member: true });
  assert.deepEqual((await h.search("PB-001")).map(result => result.id), ["own-product"]);
  assert.equal(h.queries[0].args[0], "business-a");
});

for (const options of [{ access: { canViewPriceBook: false } }, { businessOperations: false }]) {
  test(`installer product search does not query without ${options.access ? "price-book permission" : "business access"}`, async t => {
    const h = harness(t, options); assert.deepEqual(await h.search(), []); assert.deepEqual(h.queries, []);
  });
}

test("supplier product search retains its own draft and pending catalogue records", async t => {
  const h = harness(t, { supplier: true }); const results = await h.search();
  assert.deepEqual(results.map(result => result.id), ["supplier-own"]);
  assert.equal(results[0].query, "HP-300"); assert.match(results[0].meta, /Draft \| Pending \| In Stock/);
  assert.equal(h.queries[0].args[0], "supplier-a"); assert.doesNotMatch(h.queries[0].sql, /trade_price_book_items/);
});

test("product search preserves the minimum query and wildcard guards", async t => {
  const h = harness(t); assert.deepEqual(await h.search("%_\\"), []); assert.deepEqual(h.queries, []);
});
