import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { planPriceBookImport, validatePriceBookImportRows, PRICE_BOOK_IMPORT_MAX_BODY_BYTES } from "../src/lib/trade-price-book-import.ts";
import { importPriceBook, PriceBookImportError } from "../src/lib/trade-price-book-import-server.ts";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../src/lib/bounded-request-body.mjs";
import { normalisePriceBookInput } from "../src/lib/trade-price-book.ts";

const clean = (value, maximum) => String(value ?? "").trim().slice(0, maximum);
const row = (rowNumber, values) => ({ rowNumber, values });
const input = (values = {}) => normalisePriceBookInput({ name: "Call out fee", itemType: "call_out", unitLabel: "visit",
  supplierCost: "50", sellPrice: "200", taxCode: "gst", expectedDurationMinutes: "30", ...values }, clean);
function existing(values = {}, overrides = {}) {
  const item = input(values);
  return { id: "item-a", item_code: "PB-A", name: item.name, description: item.description, item_type: item.itemType,
    unit_label: item.unitLabel, supplier_cost_cents_ex_gst: item.supplierCostCentsExGst,
    sell_price_cents_ex_gst: item.sellPriceCentsExGst, tax_code: item.taxCode, markup_basis_points: item.markupBasisPoints,
    margin_basis_points: item.marginBasisPoints, expected_duration_minutes: item.expectedDurationMinutes,
    required_skill: item.requiredSkill, supplier_name: item.supplierName, supplier_sku: item.supplierSku,
    supplier_product_id: item.supplierProductId, record_status: "active", price_revision: 1,
    updated_at: "2026-09-20T00:00:00.000Z", updated_by_uid: "owner-a", ...overrides };
}
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migration = fs.readFileSync(new URL("../drizzle/0064_trade_price_book.sql", import.meta.url), "utf8");
  sqlite.exec(migration.slice(0, migration.indexOf("ALTER TABLE")));
  sqlite.exec("CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, capabilities TEXT); INSERT INTO trade_accounts VALUES ('owner-a', '[\"electrical\"]'), ('owner-b', '[]'); CREATE TABLE trade_crm_quote_items (id TEXT, price_book_item_id TEXT, unit_price_cents INTEGER); INSERT INTO trade_crm_quote_items VALUES ('quote-1', 'item-a', 20000)");
  const api = { beforeBatch: null, afterCommit: null, failAt: -1, batches: 0,
    prepare(sql) {
      const prepared = (args = []) => ({ sql, args, bind: (...values) => prepared(values),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true }),
        run: async () => ({ meta: sqlite.prepare(sql).run(...args), success: true }) });
      return prepared();
    },
    async batch(statements) {
      api.batches++;
      if (api.beforeBatch) api.beforeBatch();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        for (const [index, statement] of statements.entries()) {
          if (index === api.failAt) throw new Error("Injected storage failure");
          sqlite.prepare(statement.sql).all(...statement.args);
        }
        sqlite.exec("COMMIT");
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      if (api.afterCommit) api.afterCommit();
      return [];
    } };
  const seed = (item = existing(), ownerUid = "owner-a") => {
    const value = { ...item, firebase_uid: ownerUid, created_by_uid: ownerUid, created_at: item.updated_at };
    sqlite.prepare(`INSERT INTO trade_price_book_items (${Object.keys(value).join(",")}) VALUES (${Object.keys(value).map(() => "?").join(",")})`).run(...Object.values(value));
    sqlite.prepare(`INSERT INTO trade_price_book_price_history (id, price_book_item_id, firebase_uid, price_revision,
      supplier_cost_cents_ex_gst, sell_price_cents_ex_gst, tax_code, markup_basis_points, margin_basis_points,
      change_type, changed_by_uid, changed_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'created', ?, ?)`)
      .run(`history-${item.id}`, item.id, ownerUid, item.supplier_cost_cents_ex_gst, item.sell_price_cents_ex_gst,
        item.tax_code, item.markup_basis_points, item.margin_basis_points, ownerUid, item.updated_at);
  };
  return { sqlite, api, seed };
}
async function previewAndImport(api, rows, extra = {}) {
  const preview = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows, ...extra });
  const result = await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, ...extra, previewToken: preview.preview.token });
  return { preview, result };
}

test("latest upload updates the same call-out fee from $200 to $220 and retains omitted details", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { name: "  CALL   OUT FEE ", sellPrice: "220" })];
  const { preview, result } = await previewAndImport(api, rows);
  assert.deepEqual(preview.preview.counts, { added: 0, updated: 1, unchanged: 0, superseded: 0 });
  assert.equal(preview.preview.items[0].before.sellPriceCentsExGst, 20000);
  assert.equal(preview.preview.items[0].after.sellPriceCentsExGst, 22000);
  assert.equal(result.imported, true);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items").get();
  assert.equal(saved.id, "item-a"); assert.equal(saved.sell_price_cents_ex_gst, 22000);
  assert.equal(saved.supplier_cost_cents_ex_gst, 5000); assert.equal(saved.item_type, "call_out");
  assert.equal(saved.unit_label, "visit"); assert.equal(saved.expected_duration_minutes, 30);
  assert.equal(saved.price_revision, 2); assert.equal(saved.updated_by_uid, "staff-a");
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 2);
  assert.equal(sqlite.prepare("SELECT unit_price_cents FROM trade_crm_quote_items").get().unit_price_cents, 20000);
});

test("new and existing items save atomically with correct history, and an identical retry is a no-op", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { itemCode: "PB-A", supplierCost: "60" }), row(3, { name: "Cable", supplierSku: "C-1", supplierName: "Acme", sellPrice: "12.50", supplierCost: "8.00" })];
  const { preview } = await previewAndImport(api, rows);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 3);
  const repeat = await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  assert.equal(repeat.imported, true); assert.equal(repeat.preview.counts.unchanged, 2);
  assert.equal(api.batches, 1); assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 3);
});

test("metadata-only updates do not manufacture a new price revision", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  await previewAndImport(api, [row(2, { itemCode: "PB-A", description: "Includes travel" })]);
  assert.equal(sqlite.prepare("SELECT price_revision, description FROM trade_price_book_items").get().price_revision, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 1);
});

test("business ownership isolates matches, preview tokens, writes and history", async () => {
  const { sqlite, api, seed } = fixture(); seed(existing(), "owner-b");
  const foreignCode = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows: [row(2, { itemCode: "PB-A", sellPrice: "220" })] });
  assert.equal(foreignCode.preview.canImport, false); assert.match(foreignCode.preview.issues[0].message, /not found in this business/);
  const rows = [row(2, { name: "Call out fee", sellPrice: "220" })];
  const foreignPreview = await importPriceBook(api, "owner-b", "owner-b", { action: "preview", rows });
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: foreignPreview.preview.token }), (error) => error.status === 409);
  await previewAndImport(api, rows);
  assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items WHERE firebase_uid = 'owner-b'").get().sell_price_cents_ex_gst, 20000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history WHERE firebase_uid = 'owner-b'").get().count, 1);
});

test("duplicate incoming items use the last row and disclose superseded rows", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const { preview } = await previewAndImport(api, [row(2, { itemCode: "PB-A", sellPrice: "210" }), row(3, { name: "Call out fee", sellPrice: "220" }),
    row(4, { name: "New item", supplierSku: "NEW", sellPrice: "10" }), row(5, { name: "New item", supplierSku: "NEW", sellPrice: "12" })]);
  assert.equal(preview.preview.counts.superseded, 2); assert.equal(preview.preview.items.length, 2);
  assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items WHERE id = 'item-a'").get().sell_price_cents_ex_gst, 22000);
  assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items WHERE supplier_sku = 'NEW'").get().sell_price_cents_ex_gst, 1200);
});

test("supplier and SKU match exactly without overwriting a different supplier's similarly named product", () => {
  const a = existing({ name: "Cable", supplierName: "Acme", supplierSku: "C1" });
  const b = existing({ name: "Cable", supplierName: "Other", supplierSku: "C1" }, { id: "item-b", item_code: "PB-B" });
  assert.equal(planPriceBookImport([row(2, { supplierSku: "C1", sellPrice: "220" })], [a, b], []).issues.length, 1);
  const explicit = planPriceBookImport([row(2, { supplierName: "Other", supplierSku: "C1", sellPrice: "220" })], [a, b], []);
  assert.equal(explicit.changes[0].existing.id, "item-b");
  const explicitCode = planPriceBookImport([row(2, { itemCode: "PB-A", supplierSku: "C1", sellPrice: "220" })], [a, b], []);
  assert.equal(explicitCode.issues.length, 0); assert.equal(explicitCode.changes[0].existing.id, "item-a");
  const conflictingSupplier = planPriceBookImport([row(2, { itemCode: "PB-A", supplierName: "Other", supplierSku: "C1", sellPrice: "220" })], [a, b], []);
  assert.equal(conflictingSupplier.issues.length, 1);
  const legacy = existing({ name: "Cable", supplierName: "Acme" });
  const different = planPriceBookImport([row(2, { name: "Cable", supplierName: "Other", supplierSku: "C2", sellPrice: "220" })], [legacy], []);
  assert.equal(different.changes[0].status, "added");
  const upgrade = planPriceBookImport([row(2, { name: "Cable", supplierName: "Acme", supplierSku: "C2", sellPrice: "220" })], [legacy], []);
  assert.equal(upgrade.changes[0].existing.id, legacy.id);
});

test("ambiguous, archived and conflicting identifiers require correction before any writes", async () => {
  const a = existing();
  const b = existing({}, { id: "item-b", item_code: "PB-B" });
  assert.match(planPriceBookImport([row(2, { name: "Call out fee", sellPrice: "220" })], [a, b], []).issues[0].message, /More than one/);
  assert.match(planPriceBookImport([row(2, { itemCode: "PB-A", sellPrice: "220" })], [{ ...a, record_status: "archived" }], []).issues[0].message, /archived/);
  const withSkus = [{ ...a, supplier_sku: "A" }, { ...b, supplier_sku: "B" }];
  assert.match(planPriceBookImport([row(2, { itemCode: "PB-A", supplierSku: "B", sellPrice: "220" })], withSkus, []).issues[0].message, /different items/);
  const mixed = planPriceBookImport([row(2, { name: "New", sellPrice: "20" }), row(3, { name: "New", supplierSku: "N", sellPrice: "22" })], [], []);
  assert.equal(mixed.issues.length, 2);
  const ambiguousSuppliers = planPriceBookImport([row(2, { name: "Pump", supplierName: "A", sellPrice: "200" }), row(3, { name: "Pump", supplierName: "B", sellPrice: "220" })], [], []);
  assert.equal(ambiguousSuppliers.issues.length, 2); assert.equal(ambiguousSuppliers.counts.superseded, 0);
  const distinct = planPriceBookImport([row(2, { name: "New", supplierSku: "N1", sellPrice: "20" }), row(3, { name: "New", supplierSku: "N2", sellPrice: "22" })], [], []);
  assert.equal(distinct.issues.length, 0); assert.equal(distinct.counts.added, 2);
});

test("partial supplier and SKU identities cannot create duplicate items", () => {
  const mixedSuppliers = planPriceBookImport([row(2, { name: "Pump", supplierSku: "P1", sellPrice: "200" }),
    row(3, { name: "Pump", supplierName: "Acme", supplierSku: "P1", sellPrice: "220" })], [], []);
  assert.equal(mixedSuppliers.issues.length, 2); assert.equal(mixedSuppliers.counts.superseded, 0);
  assert.match(mixedSuppliers.issues[0].message, /with and without a supplier name/);
  const separateNamedSuppliers = planPriceBookImport([row(2, { name: "Pump", supplierName: "Other", supplierSku: "P1", sellPrice: "200" }),
    row(3, { name: "Pump", supplierName: "Acme", supplierSku: "P1", sellPrice: "220" })], [], []);
  assert.equal(separateNamedSuppliers.issues.length, 0); assert.equal(separateNamedSuppliers.counts.added, 2);
  const savedWithoutSupplier = existing({ name: "Pump", supplierSku: "P1" });
  const ambiguousUpdate = planPriceBookImport([row(2, { name: "Pump", supplierName: "Acme", supplierSku: "P1", sellPrice: "220" })], [savedWithoutSupplier], []);
  assert.equal(ambiguousUpdate.issues.length, 1); assert.match(ambiguousUpdate.issues[0].message, /TLink item code/);
  const identifiedUpdate = planPriceBookImport([row(2, { itemCode: "PB-A", supplierName: "Acme", supplierSku: "P1", sellPrice: "220" })], [savedWithoutSupplier], []);
  assert.equal(identifiedUpdate.issues.length, 0); assert.equal(identifiedUpdate.counts.updated, 1);
});

test("catalogue-linked supplier identity and cost remain authoritative", () => {
  const linked = existing({ supplierName: "Acme", supplierSku: "A", supplierProductId: "catalogue-a" });
  for (const values of [{ supplierCost: "51" }, { supplierSku: "B" }, { supplierName: "Other" }]) {
    assert.match(planPriceBookImport([row(2, { itemCode: "PB-A", ...values })], [linked], []).issues[0].message, /approved supplier catalogue/);
  }
  const sellOnly = planPriceBookImport([row(2, { itemCode: "PB-A", sellPrice: "220", supplierCost: "" })], [linked], []);
  assert.equal(sellOnly.issues.length, 0); assert.equal(sellOnly.changes[0].input.supplierProductId, "catalogue-a");
  assert.equal(sellOnly.changes[0].input.supplierCostCentsExGst, 5000);
});

test("money, row limits, item types and business skill validation reject unsafe inputs", () => {
  for (const values of [{ name: "Bad", sellPrice: "0" }, { name: "Bad", sellPrice: "1.001" }, { name: "Bad", sellPrice: "NaN" },
    { name: "Bad", sellPrice: "-5" }, { name: "Bad", sellPrice: "5", supplierCost: "-1" },
    { name: "Bad", sellPrice: "5", requiredSkill: "unknown" }, { name: "Bad", sellPrice: "5", unitLabel: "wrong" },
    { name: "x".repeat(141), sellPrice: "5" }, { name: "Bad", sellPrice: "5", taxCode: "wrong" },
    { name: "Bad", sellPrice: "5", itemType: "wrong" }, { name: "Bad", sellPrice: "5", expectedDurationMinutes: "10081" }]) {
    assert.equal(planPriceBookImport([row(2, values)], [], ["electrical"]).issues.length, 1, JSON.stringify(values));
  }
  assert.equal(planPriceBookImport([row(2, { name: "Credit", itemType: "certificate", sellPrice: "-38" })], [], []).issues.length, 0);
  assert.throws(() => validatePriceBookImportRows([]), /1 to 2,000/);
  assert.throws(() => validatePriceBookImportRows(Array.from({ length: 2001 }, (_, index) => row(index + 1, {}))), /1 to 2,000/);
  assert.throws(() => validatePriceBookImportRows([row(2, {}), row(2, {})]), /could not be read/);
  assert.throws(() => validatePriceBookImportRows([row(2, { supplierProductId: "forged" })]), /unsupported/);
});

test("GST-inclusive import converts only supplied prices using the effective row tax setting", () => {
  const plan = planPriceBookImport([row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "GST free", taxCode: "none", sellPrice: "220", supplierCost: "110" }),
    row(4, { name: "Round", sellPrice: "100" }), row(5, { name: "Credit", itemType: "rebate", sellPrice: "-110" })], [existing()], [], true);
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.changes[0].input.sellPriceCentsExGst, 20000); assert.equal(plan.changes[0].input.supplierCostCentsExGst, 5000);
  assert.equal(plan.changes[1].input.sellPriceCentsExGst, 22000); assert.equal(plan.changes[1].input.supplierCostCentsExGst, 11000);
  assert.equal(plan.changes[2].input.sellPriceCentsExGst, 9091); assert.equal(plan.changes[3].input.sellPriceCentsExGst, -10000);
});

test("stale previews and changed GST interpretation cannot overwrite newer data", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "242" })];
  const response = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token, pricesIncludeGst: true }), (error) => error.status === 409);
  sqlite.exec("UPDATE trade_price_book_items SET description = 'Changed after preview'");
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token }), (error) => error.status === 409);
  assert.equal(api.batches, 0); assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items").get().sell_price_cents_ex_gst, 20000);
});

test("a concurrent update with identical timestamp aborts the complete batch", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "New", sellPrice: "30" })];
  const response = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
  api.beforeBatch = () => sqlite.exec("UPDATE trade_price_book_items SET description = 'Concurrent change'");
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token }), (error) => error instanceof PriceBookImportError && error.status === 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 1);
  assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items").get().sell_price_cents_ex_gst, 20000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 1);
});

test("a concurrent new item or archive aborts the upload without partial changes", async () => {
  for (const mutate of ["create", "archive"]) {
    const { sqlite, api, seed } = fixture(); seed();
    const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "New", sellPrice: "30" })];
    const response = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
    api.beforeBatch = () => mutate === "archive" ? sqlite.exec("UPDATE trade_price_book_items SET record_status = 'archived'")
      : seed(existing({ name: "Concurrent" }, { id: "concurrent", item_code: "PB-C" }));
    await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token }), (error) => error.status === 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items WHERE name = 'New'").get().count, 0);
    assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items WHERE id = 'item-a'").get().sell_price_cents_ex_gst, 20000);
  }
});

test("storage failure after updates rolls back prices, new items and history", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "New", sellPrice: "30" })];
  const response = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
  api.failAt = 4;
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token }), /Injected storage failure/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 1);
  assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items").get().sell_price_cents_ex_gst, 20000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 1);
});

test("a lost save response is reconciled without duplicate items or price history", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  api.afterCommit = () => { throw new Error("Connection lost after commit"); };
  const { result } = await previewAndImport(api, [row(2, { itemCode: "PB-A", sellPrice: "220" })]);
  assert.equal(result.imported, true); assert.equal(result.preview.counts.unchanged, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 2);
});

test("invalid rows block the whole file instead of silently saving a subset", async () => {
  const { sqlite, api, seed } = fixture(); seed();
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "Invalid", sellPrice: "bad" })];
  const response = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
  assert.equal(response.preview.canImport, false);
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: response.preview.token }), (error) => error.status === 400);
  assert.equal(api.batches, 0); assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items").get().sell_price_cents_ex_gst, 20000);
});

test("the maximum 2,000-row import uses bounded JSON batches and remains idempotent", async () => {
  const { sqlite, api } = fixture();
  const rows = Array.from({ length: 2000 }, (_, index) => row(index + 2, { name: `Item ${index}`, supplierSku: `SKU-${index}`, sellPrice: "10" }));
  const { preview } = await previewAndImport(api, rows);
  assert.equal(preview.preview.counts.added, 2000); assert.equal(api.batches, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 2000);
  const repeat = await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  assert.equal(repeat.preview.counts.unchanged, 2000); assert.equal(api.batches, 1);
});

test("matching 2,000 updates against a full price book uses indexed exact matches", () => {
  const items = Array.from({ length: 5000 }, (_, index) => existing({ name: `Item ${index}`, supplierSku: `SKU-${index}` }, { id: `id-${index}`, item_code: `PB-${index}` }));
  const rows = Array.from({ length: 2000 }, (_, index) => row(index + 2, { supplierSku: `SKU-${index}`, sellPrice: "220" }));
  const started = performance.now(); const plan = planPriceBookImport(rows, items, []);
  assert.equal(plan.counts.updated, 2000); assert.equal(plan.issues.length, 0);
  assert.ok(performance.now() - started < 5000, "Exact matching should not scan and renormalise every saved item for every uploaded row");
});

test("import route authenticates management access and bounds the streamed request before processing", async () => {
  const route = fs.readFileSync(new URL("../src/app/api/trade-price-book/import/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/); assert.match(route, /requireInstallerTeamAccess\(request\)/);
  assert.match(route, /!access\.isOwner && !access\.canManagePriceBook/);
  assert.match(route, /importPriceBook\(getD1\(\), access\.ownerUid, access\.actorUid/);
  assert.match(route, /readBoundedRequestText\(request, PRICE_BOOK_IMPORT_MAX_BODY_BYTES\)/);
  const oversized = new Request("https://example.com", { method: "POST", body: "x".repeat(PRICE_BOOK_IMPORT_MAX_BODY_BYTES + 1) });
  await assert.rejects(readBoundedRequestText(oversized, PRICE_BOOK_IMPORT_MAX_BODY_BYTES), RequestBodyTooLargeError);
});

const routeCompiled = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/trade-price-book/import/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function routeHarness(options = {}) {
  const state = fixture(); const calls = { database: 0, access: 0 }; const exports = {};
  const require = (id) => {
    if (id.endsWith("/db")) return { getD1() { calls.database++; return state.api; } };
    if (id === "@/lib/admin-server") return { adminJson: (body, status = 200) => Response.json(body, { status }),
      sameOrigin: (request) => request.headers.get("Origin") === "https://tlink.example" };
    if (id === "@/lib/trade-team-server") return { async requireInstallerTeamAccess() {
      calls.access++;
      if (options.authError) throw new Error(options.authError);
      return options.access || { ownerUid: "owner-a", actorUid: "manager-a", isOwner: false, canManagePriceBook: true };
    } };
    if (id === "@/lib/bounded-request-body.mjs") return { readBoundedRequestText, RequestBodyTooLargeError };
    if (id === "@/lib/trade-price-book-import") return { PRICE_BOOK_IMPORT_MAX_BODY_BYTES };
    if (id === "@/lib/trade-price-book-import-server") return { importPriceBook, PriceBookImportError };
    throw new Error(`Unexpected route dependency ${id}`);
  };
  Function("require", "exports", routeCompiled)(require, exports);
  const request = (body, origin = "https://tlink.example") => new Request("https://tlink.example/api/trade-price-book/import", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { ...state, calls, post: (body, origin) => exports.POST(request(body, origin)) };
}

test("real import handler rejects foreign origins, unauthenticated and view-only requests before database access", async () => {
  const body = { action: "preview", rows: [row(2, { name: "Cable", sellPrice: "10" })] };
  const foreign = routeHarness();
  assert.equal((await foreign.post(body, "https://attacker.example")).status, 403);
  assert.deepEqual(foreign.calls, { database: 0, access: 0 });
  const unauthenticated = routeHarness({ authError: "AUTH_REQUIRED" });
  assert.equal((await unauthenticated.post(body)).status, 401); assert.equal(unauthenticated.calls.database, 0);
  const viewOnly = routeHarness({ access: { ownerUid: "owner-a", actorUid: "viewer-a", isOwner: false, canViewPriceBook: true, canManagePriceBook: false } });
  assert.equal((await viewOnly.post(body)).status, 403); assert.equal(viewOnly.calls.database, 0);
  const inactive = routeHarness({ authError: "ACCOUNT_INACTIVE" });
  assert.equal((await inactive.post(body)).status, 403); assert.equal(inactive.calls.database, 0);
});

test("real import handler uses the authenticated manager's owner scope instead of body ownership fields", async () => {
  const h = routeHarness({ access: { ownerUid: "owner-b", actorUid: "manager-b", isOwner: false, canManagePriceBook: true } });
  h.seed(existing(), "owner-a");
  const rows = [row(2, { name: "Call out fee", sellPrice: "220" })];
  const previewResponse = await h.post({ action: "preview", rows, ownerUid: "owner-a", firebase_uid: "owner-a", actorUid: "owner-a" });
  assert.equal(previewResponse.status, 200); const preview = (await previewResponse.json()).preview;
  assert.equal(preview.counts.added, 1);
  const imported = await h.post({ action: "import", rows, ownerUid: "owner-a", actorUid: "owner-a", previewToken: preview.token });
  assert.equal(imported.status, 200); assert.equal((await imported.json()).imported, true);
  assert.equal(h.sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items WHERE firebase_uid = 'owner-a'").get().sell_price_cents_ex_gst, 20000);
  const saved = h.sqlite.prepare("SELECT * FROM trade_price_book_items WHERE firebase_uid = 'owner-b'").get();
  assert.equal(saved.sell_price_cents_ex_gst, 22000); assert.equal(saved.created_by_uid, "manager-b");
});

test("real import handler rejects oversized streamed and invalid JSON requests before database access", async () => {
  const h = routeHarness();
  assert.equal((await h.post("x".repeat(PRICE_BOOK_IMPORT_MAX_BODY_BYTES + 1))).status, 413);
  assert.equal((await h.post("not-json")).status, 400);
  assert.equal((await h.post([])).status, 400);
  assert.equal(h.calls.database, 0);
});
