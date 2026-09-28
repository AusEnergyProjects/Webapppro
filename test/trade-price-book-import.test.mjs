import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { planPriceBookImport, validatePriceBookImportRows, PRICE_BOOK_IMPORT_MAX_BODY_BYTES } from "../src/lib/trade-price-book-import.ts";
import { importPriceBook, PriceBookImportError } from "../src/lib/trade-price-book-import-server.ts";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../src/lib/bounded-request-body.mjs";
import { normalisePriceBookInput, parsePriceBookSolarPanel, priceBookSolarEquipment } from "../src/lib/trade-price-book.ts";
import { detectPriceBookColumns, mapPriceBookRows, priceBookTemplateCsv, readPriceBookSpreadsheet } from "../src/lib/trade-price-book-spreadsheet.ts";

const clean = (value, maximum) => String(value ?? "").trim().slice(0, maximum);
const row = (rowNumber, values) => ({ rowNumber, values });
const input = (values = {}) => normalisePriceBookInput({ name: "Call out fee", itemType: "call_out", unitLabel: "visit",
  supplierCost: "50", sellPrice: "200", taxCode: "gst", expectedDurationMinutes: "30", ...values }, clean);
function existing(values = {}, overrides = {}) {
  const item = input(values);
  return { id: "item-a", item_code: "PB-A", name: item.name, description: item.description, item_type: item.itemType,
    category: item.category || "", solar_panel_json: JSON.stringify(item.solarPanel ?? null),
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
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0199_trade_price_book_solar_panel.sql", import.meta.url), "utf8"));
  sqlite.exec(fs.readFileSync(new URL("../drizzle/0209_trade_price_book_categories.sql", import.meta.url), "utf8"));
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

const panelDetails = { watts: 440, lengthM: 1.762, widthM: 1.134, manufacturer: "Example maker", model: "Example model",
  warrantyYears: 25, datasheetUrl: "https://manufacturer.com/panel.pdf" };
const panelValues = { name: "Example panel", itemType: "material", category: "Solar panels", unitLabel: "each", solarPanel: panelDetails };
const importedPanel = { name: "Imported panel", itemType: "material", productKind: "solar_panel", supplierSku: "PANEL-01", sellPrice: "180",
  category: "Solar panels", panelWatts: "440", panelLengthMm: "1762", panelWidthMm: "1134" };

test("downloaded sample imports correct product/service types and exact panel dimensions into map equipment", async () => {
  const { sqlite, api } = fixture();
  const [sheet] = await readPriceBookSpreadsheet(new File([priceBookTemplateCsv()], "TLink-price-book-template.csv"));
  const rows = mapPriceBookRows(sheet, 0, detectPriceBookColumns(sheet.data[0]));
  const { preview } = await previewAndImport(api, rows);
  assert.equal(preview.preview.canImport, true); assert.equal(preview.preview.counts.added, 4);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items ORDER BY supplier_sku").all();
  const panel = saved.find((item) => item.supplier_sku === "EXAMPLE-PANEL-440");
  assert.deepEqual(parsePriceBookSolarPanel(panel.solar_panel_json), { watts: 440, widthM: 1.134, lengthM: 1.762 });
  const equipment = priceBookSolarEquipment({ id: panel.id, name: panel.name, supplierSku: panel.supplier_sku,
    solarPanel: parsePriceBookSolarPanel(panel.solar_panel_json) });
  assert.equal(equipment.priceBookItemId, panel.id); assert.equal(equipment.watts, 440);
  assert.equal(equipment.lengthM, 1.762); assert.equal(equipment.widthM, 1.134);
  assert.equal(panel.category, "Solar panels");
  const insulation = saved.find((item) => item.supplier_sku === "EXAMPLE-INS-ROLL");
  assert.equal(insulation.item_type, "material"); assert.equal(insulation.unit_label, "roll"); assert.equal(insulation.category, "Insulation");
  const labour = saved.find((item) => item.supplier_sku === "EXAMPLE-LABOUR");
  assert.equal(labour.item_type, "labour"); assert.equal(labour.unit_label, "hour");
  const callout = saved.find((item) => item.supplier_sku === "EXAMPLE-CALLOUT");
  assert.equal(callout.item_type, "call_out"); assert.equal(callout.unit_label, "visit");
  assert.ok(saved.every((item) => /^PB-[A-F0-9]{8}$/.test(item.item_code)));
  const repeat = await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  assert.equal(repeat.preview.counts.unchanged, 4); assert.equal(api.batches, 1);
});

test("price-only updates retain panel specifications, documents and category with omitted or blank optional cells", async () => {
  const { sqlite, api, seed } = fixture(); seed(existing(panelValues));
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "220", category: "", productKind: "", panelLengthMm: "" })];
  const { preview } = await previewAndImport(api, rows);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items").get();
  assert.deepEqual(JSON.parse(saved.solar_panel_json), panelDetails); assert.equal(saved.category, "Solar panels");
  assert.deepEqual(preview.preview.items[0].solarPanel, parsePriceBookSolarPanel(panelDetails));
  assert.equal(preview.preview.items[0].itemType, "material"); assert.equal(preview.preview.items[0].unitLabel, "each");
  const kept = await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  assert.equal(kept.preview.counts.unchanged, 1); assert.equal(api.batches, 1);
});

test("panel and category metadata changes persist without bumping unchanged price history", async () => {
  const { sqlite, api, seed } = fixture(); seed(existing(panelValues));
  const rows = [row(2, { itemCode: "PB-A", category: "  Residential   solar ", productKind: "solar_panel", panelWatts: "455", panelLengthMm: "1800", panelWidthMm: "1134.5" })];
  const { preview } = await previewAndImport(api, rows);
  assert.equal(preview.preview.counts.updated, 1);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items").get();
  assert.equal(saved.category, "Residential solar"); assert.equal(saved.price_revision, 1);
  assert.deepEqual(JSON.parse(saved.solar_panel_json), { ...panelDetails, watts: 455, lengthM: 1.8, widthM: 1.1345 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_price_history").get().count, 1);
});

test("explicit general classification removes solar metadata and permits changing to a service type", async () => {
  const { sqlite, api, seed } = fixture(); seed(existing(panelValues));
  const invalid = planPriceBookImport([row(2, { itemCode: "PB-A", itemType: "labour" })], [existing(panelValues)], []);
  assert.match(invalid.issues[0].message, /Material or Equipment/);
  await previewAndImport(api, [row(2, { itemCode: "PB-A", itemType: "labour", productKind: "general", category: "Installation" })]);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items").get();
  assert.equal(saved.solar_panel_json, "null"); assert.equal(saved.item_type, "labour"); assert.equal(saved.category, "Installation");
});

test("solar import rejects partial, unclassified, incompatible and invalid dimensions with row-specific errors", () => {
  for (const [overrides, expected] of [
    [{ productKind: "" }, /Choose Solar panel/], [{ productKind: "general" }, /Choose Solar panel/],
    [{ productKind: "hot_water" }, /Product kind must/], [{ panelWidthMm: "" }, /Supply panel watts, length and width together/],
    [{ panelWatts: "", panelLengthMm: "", panelWidthMm: "" }, /new solar panel needs/],
    [{ itemType: "labour" }, /Material or Equipment/], [{ panelLengthMm: "1.762 m" }, /millimetres/],
    [{ panelLengthMm: "1.762" }, /200 to 4,000 mm/], [{ panelWidthMm: "4001" }, /200 to 4,000 mm/],
    [{ panelWatts: "0" }, /watts from 1 to 2,000/], [{ panelWatts: "2001" }, /watts from 1 to 2,000/],
    [{ panelWatts: "NaN" }, /positive numbers/], [{ panelLengthMm: "-1762" }, /positive numbers/],
    [{ category: "a".repeat(81) }, /no more than 80/], [{ category: "Bad\u0000category" }, /category of up to 80/],
  ]) {
    const plan = planPriceBookImport([row(7, { ...importedPanel, ...overrides })], [], []);
    assert.equal(plan.issues.length, 1, JSON.stringify(overrides)); assert.equal(plan.issues[0].rowNumber, 7);
    assert.match(plan.issues[0].message, expected, JSON.stringify(overrides));
  }
  const categoryOnly = planPriceBookImport([row(2, { name: "General product", category: "Solar panel", sellPrice: "100" })], [], []);
  assert.equal(categoryOnly.issues.length, 0); assert.equal(categoryOnly.changes[0].input.solarPanel, null);
});

test("saved panel can retain all dimensions but a partial dimension edit is rejected", () => {
  const item = existing(panelValues);
  const unchanged = planPriceBookImport([row(2, { itemCode: "PB-A", productKind: "solar_panel" })], [item], []);
  assert.equal(unchanged.issues.length, 0); assert.equal(unchanged.counts.unchanged, 1);
  const partial = planPriceBookImport([row(2, { itemCode: "PB-A", productKind: "solar_panel", panelWatts: "450" })], [item], []);
  assert.match(partial.issues[0].message, /Supply panel watts, length and width together/);
});

test("invalid solar specifications prevent the entire mixed upload from changing existing products", async () => {
  const { sqlite, api, seed } = fixture(); seed(existing(panelValues));
  const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { ...importedPanel, panelWidthMm: "" })];
  const { preview } = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
  assert.equal(preview.canImport, false); assert.equal(preview.issues[0].rowNumber, 3);
  await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.token }), (error) => error.status === 400);
  assert.equal(api.batches, 0);
  const saved = sqlite.prepare("SELECT * FROM trade_price_book_items").all();
  assert.equal(saved.length, 1); assert.equal(saved[0].sell_price_cents_ex_gst, 20000);
  assert.deepEqual(JSON.parse(saved[0].solar_panel_json), panelDetails);
});

test("panel/category changes invalidate preview and concurrent atomic assertions even with unchanged timestamps", async () => {
  for (const atomic of [false, true]) for (const field of ["category", "solar_panel_json"]) {
    const { sqlite, api, seed } = fixture(); seed(existing(panelValues));
    const rows = [row(2, { itemCode: "PB-A", sellPrice: "220" }), row(3, { name: "New product", sellPrice: "50" })];
    const { preview } = await importPriceBook(api, "owner-a", "staff-a", { action: "preview", rows });
    const mutate = () => sqlite.prepare(`UPDATE trade_price_book_items SET ${field}=? WHERE id='item-a'`).run(field === "category" ? "Changed group" : JSON.stringify({ ...panelDetails, watts: 450 }));
    if (atomic) api.beforeBatch = mutate; else mutate();
    await assert.rejects(importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.token }), (error) => error.status === 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 1);
    assert.equal(sqlite.prepare("SELECT sell_price_cents_ex_gst FROM trade_price_book_items").get().sell_price_cents_ex_gst, 20000);
  }
});

test("new panel/category import is replay-safe after a lost commit response and isolated to its business", async () => {
  const { sqlite, api, seed } = fixture();
  seed(existing({ ...panelValues, supplierSku: "PANEL-01" }), "owner-b");
  const rows = [row(2, importedPanel)];
  api.afterCommit = () => { throw new Error("Lost response"); };
  const { preview, result } = await previewAndImport(api, rows);
  assert.equal(result.imported, true); assert.equal(result.preview.counts.unchanged, 1);
  const own = sqlite.prepare("SELECT * FROM trade_price_book_items WHERE firebase_uid='owner-a'").get();
  assert.equal(own.category, "Solar panels"); assert.equal(own.created_by_uid, "staff-a"); assert.equal(JSON.parse(own.solar_panel_json).watts, 440);
  assert.deepEqual(JSON.parse(sqlite.prepare("SELECT solar_panel_json FROM trade_price_book_items WHERE firebase_uid='owner-b'").get().solar_panel_json), panelDetails);
  await importPriceBook(api, "owner-a", "staff-a", { action: "import", rows, previewToken: preview.preview.token });
  assert.equal(api.batches, 1); assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 2);
});

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
    if (id === "@/lib/admin-server") return { mfaErrorResponse, adminJson: (body, status = 200) => Response.json(body, { status }),
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
