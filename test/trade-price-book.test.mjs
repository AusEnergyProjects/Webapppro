import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { calculatePriceBookRates, normalisePriceBookInput, priceBookItemAllowsNegativeSellPrice,
  priceBookItemRequiresZeroSupplierCost, priceBookQuoteLineType, PRICE_BOOK_TYPE_LABELS } from "../src/lib/trade-price-book.ts";
import { normaliseTradeQuoteLineGroup } from "../src/lib/trade-quote.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0064_trade_price_book.sql");
const route = read("../src/app/api/trade-price-book/route.ts");
const quoteRoute = read("../src/app/api/trade-quotes/route.ts");
const quoteServer = read("../src/lib/trade-price-book-server.ts");
const workspace = read("../src/components/TradePriceBookWorkspace.tsx");
const quoteUi = read("../src/components/TradeQuotePanel.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const clean = (value, length) => String(value ?? "").trim().slice(0, length);

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("price-book cost, markup and margin calculations use deterministic integer basis points", () => {
  assert.deepEqual(calculatePriceBookRates(8_000, 10_000), {
    grossProfitCents: 2_000,
    markupBasisPoints: 2_500,
    marginBasisPoints: 2_000,
  });
  assert.deepEqual(calculatePriceBookRates(3, 4), {
    grossProfitCents: 1,
    markupBasisPoints: 3_333,
    marginBasisPoints: 2_500,
  });
  assert.deepEqual(calculatePriceBookRates(0, -1_000), {
    grossProfitCents: -1_000,
    markupBasisPoints: 0,
    marginBasisPoints: 0,
  });
});

test("canonical price-book items enforce useful sell-price and GST boundaries", () => {
  const material = normalisePriceBookInput({ name: "Cable", itemType: "material", unitLabel: "metre",
    supplierCost: "8.00", sellPrice: "12.50", taxCode: "gst", expectedDurationMinutes: "5" }, clean);
  assert.equal(material.supplierCostCentsExGst, 800);
  assert.equal(material.sellPriceCentsExGst, 1250);
  assert.equal(material.marginBasisPoints, 3600);
  const discount = normalisePriceBookInput({ name: "Package discount", itemType: "discount", unitLabel: "fixed",
    supplierCost: "0", sellPrice: "-100.00", taxCode: "gst", expectedDurationMinutes: "0" }, clean);
  assert.equal(discount.sellPriceCentsExGst, -10_000);
  assert.throws(() => normalisePriceBookInput({ name: "Free labour", itemType: "labour", supplierCost: "0",
    sellPrice: "0", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_PRICE_BOOK_SELL_PRICE/);
  assert.throws(() => normalisePriceBookInput({ name: "Bad discount", itemType: "discount", supplierCost: "1",
    sellPrice: "-5", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_PRICE_BOOK_ADJUSTMENT/);
  assert.throws(() => normalisePriceBookInput({ name: "Negative material", itemType: "material", supplierCost: "0",
    sellPrice: "-5", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_DECIMAL|INVALID_MONEY/);
  assert.throws(() => normalisePriceBookInput({ name: "Negative labour", itemType: "labour", supplierCost: "0",
    sellPrice: "-5", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_DECIMAL|INVALID_MONEY/);
  assert.equal(priceBookQuoteLineType("equipment"), "product");
  assert.equal(priceBookQuoteLineType("call_out"), "labour");
  assert.equal(priceBookQuoteLineType("rebate"), "adjustment");
});

test("certificate credits are reusable negative price-book adjustments", () => {
  for (const name of ["STC", "VEEC", "ESC"]) {
    const certificate = normalisePriceBookInput({ name, itemType: "certificate", unitLabel: "each",
      supplierCost: "0.00", sellPrice: "-38.00", taxCode: "gst", expectedDurationMinutes: "0" }, clean);
    assert.equal(certificate.itemType, "certificate");
    assert.equal(certificate.supplierCostCentsExGst, 0);
    assert.equal(certificate.sellPriceCentsExGst, -3_800);
    assert.equal(priceBookQuoteLineType(certificate.itemType), "adjustment");
  }
  assert.equal(PRICE_BOOK_TYPE_LABELS.certificate, "Certificate");
  assert.equal(priceBookItemAllowsNegativeSellPrice("certificate"), true);
  assert.equal(priceBookItemRequiresZeroSupplierCost("certificate"), true);
  assert.throws(() => normalisePriceBookInput({ name: "STC", itemType: "certificate", unitLabel: "each",
    supplierCost: "1.00", sellPrice: "-38.00", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_PRICE_BOOK_ADJUSTMENT/);
  assert.throws(() => normalisePriceBookInput({ name: "STC", itemType: "certificate", unitLabel: "each",
    supplierCost: "0.00", sellPrice: "38.00", taxCode: "gst", expectedDurationMinutes: "0" }, clean), /INVALID_PRICE_BOOK_ADJUSTMENT/);

  const quote = normaliseTradeQuoteLineGroup([
    { lineType: "product", description: "Heat pump", quantity: "1", unitPrice: "3500.00", taxCode: "gst" },
    { lineType: "adjustment", description: "STC", quantity: "30", unitPrice: "-38.00", taxCode: "gst" },
  ], (value) => clean(value, 500));
  assert.deepEqual(quote.lines[1], {
    lineType: "adjustment", description: "STC", quantityMilli: 30_000, unitPriceCents: -3_800,
    taxCode: "gst", subtotalCents: -114_000, taxCents: -11_400, totalCents: -125_400,
  });
  assert.equal(quote.subtotalCents, 236_000);
  assert.equal(quote.taxCents, 23_600);
  assert.equal(quote.totalCents, 259_600);
});

test("the additive migration creates an owner-scoped price book and quote snapshots", () => {
  for (const table of ["trade_price_book_items", "trade_price_book_price_history"]) {
    assert.equal((schema.match(new RegExp(`sqliteTable\\("${table}"`, "g")) || []).length, 1);
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const column of ["price_book_item_id", "price_book_item_type", "unit_cost_cents_ex_gst", "markup_basis_points", "margin_basis_points"]) {
    assert.match(migration, new RegExp("ALTER TABLE `trade_crm_quote_items` ADD `" + column + "`"));
    assert.match(schema, new RegExp(column));
  }
  for (const index of ["trade_price_book_items_owner_code_idx", "trade_price_book_items_owner_status_name_idx", "trade_price_book_price_history_revision_idx"]) {
    assert.match(migration, new RegExp(index));
  }
});

test("the price-book migration applies after the versioned quote dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0011_even_reavers.sql",
    "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0047_customer_service_site_foundation.sql",
    "0050_versioned_trade_quotes.sql", "0064_trade_price_book.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  const columns = db.prepare("PRAGMA table_info(trade_crm_quote_items)").all().map((row) => row.name);
  assert.ok(columns.includes("price_book_item_id"));
  assert.ok(columns.includes("unit_cost_cents_ex_gst"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_price_book_items").get().count, 0);
});

test("price-book writes require the explicit commercial permission, remain owner scoped and append price history", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireInstallerTeamAccess\(request\)/);
  assert.match(route, /access\.canManagePriceBook/);
  assert.match(route, /access\.canViewPriceBook/);
  assert.doesNotMatch(route, /access\.role|canDispatch\(access\)/);
  assert.match(route, /firebase_uid = \?/);
  assert.match(route, /PRICE_BOOK_MANAGEMENT_REQUIRED/);
  assert.match(route, /priceChanged/);
  assert.match(route, /priceRevision = Number\(existing\.price_revision\) \+ \(priceChanged \? 1 : 0\)/);
  assert.match(route, /change_type, changed_by_uid, changed_at/);
  assert.match(route, /record_status = 'archived'/);
  assert.match(route, /capabilities FROM trade_accounts/);
  assert.match(route, /supplier_products p JOIN trade_accounts/);
  assert.equal((route.match(/verifiedTradeAccountPredicate\("a"\)/g) || []).length, 2);
});

test("active price-book items become authoritative direct-quote snapshots", () => {
  assert.match(quoteRoute, /resolvePriceBookQuoteLines\(ownerUid, packet\.lines\)/);
  assert.match(quoteRoute, /priceBookItemsForQuote\(access\.ownerUid\)/);
  assert.match(quoteRoute, /price\?\.unitCostCentsExGst/);
  assert.match(quoteRoute, /price\?\.marginBasisPoints/);
  assert.match(quoteServer, /record_status = 'active'/);
  assert.match(quoteServer, /PRICE_BOOK_ITEM_UNAVAILABLE/);
  assert.match(quoteServer, /description: reference\.description \|\| reference\.name/);
  assert.match(quoteServer, /unitPrice: \(reference\.sellPriceCentsExGst \/ 100\)\.toFixed\(2\)/);
  assert.match(quoteServer, /lineType: reference\.lineType/);
  assert.match(quoteUi, /description: item\.description \|\| item\.name/);
  assert.match(quoteUi, /aria-label=\{`Line \$\{index \+ 1\} price book item`\}/);
  assert.match(quoteUi, /value=\{line\.priceBookItemId \|\| ""\}/);
  assert.match(quoteUi, /onChange=\{\(event\) => selectPriceBookItem\(event\.target\.value\)\}/);
  assert.match(quoteUi, /compatibleItems\.map\(\(item\) => <option key=\{item\.id\} value=\{item\.id\}>/);
  assert.match(quoteUi, /const selectPriceBookItem = \(itemId: string\) =>/);
  const selection = quoteUi.match(/const selectPriceBookItem = \(itemId: string\) => \{[\s\S]*?\n    \};/);
  assert.ok(selection, "the quote editor exposes its saved-item selection handler");
  const selectionCode = ts.transpileModule(selection[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const item = { id: "saved-item", lineType: "product", description: "Saved description", name: "Saved name", sellPriceCentsExGst: 12500, taxCode: "gst" };
  const line = { priceBookItemId: "old-item", jobPacketId: "packet", jobPacketLineId: "packet-line", lineType: "labour", description: "Old description", quantity: "162.5", unitPrice: "1.00", taxCode: "none", sectionHeading: "Included work" };
  const choose = (id, mapKind = null) => {
    let replacement;
    const systemLine = () => ({ ...line, quantity: "1", unitPrice: "2400.00", sectionHeading: "Solar system (12 panels)" });
    const handler = new Function("onReplace", "solar", "systemLine", "line", "legacySolar", "compatibleItems", "mapKind", `${selectionCode}; return selectPriceBookItem;`)(value => { replacement = value; }, mapKind === "solar", systemLine, line, false, [item], mapKind);
    handler(id);
    return replacement;
  };
  for (const [mapKind, quantity] of [[null, "1"], ["area", "162.5"], ["solar", "1"]]) {
    const replaced = choose(item.id, mapKind);
    assert.deepEqual({ id: replaced.priceBookItemId, type: replaced.lineType, description: replaced.description, quantity: replaced.quantity, price: replaced.unitPrice, tax: replaced.taxCode, packet: replaced.jobPacketId, packetLine: replaced.jobPacketLineId },
      { id: item.id, type: "product", description: "Saved description", quantity, price: "125.00", tax: "gst", packet: "", packetLine: "" });
  }
  assert.equal(choose("unavailable-item"), undefined, "injected unavailable items cannot change the quote");
  assert.deepEqual(choose(""), { ...line, priceBookItemId: "", jobPacketId: "", jobPacketLineId: "" });
  assert.deepEqual(choose("", "solar"), { ...line, priceBookItemId: "", jobPacketId: "", jobPacketLineId: "", quantity: "1", unitPrice: "2400.00", sectionHeading: "Solar system (12 panels)" });
  assert.match(quoteUi, /Manage price book/);
  assert.doesNotMatch(quoteUi, /Add a saved item|No saved items yet/);
  assert.doesNotMatch(quoteUi, /priceBookItems\.length > 0 && <div className="trade-quote-price-book"/);
  assert.match(quoteUi, /const linked = Boolean\(line\.priceBookItemId\)/);
  assert.match(quoteUi, /disabled=\{linked \|\| discountLocked\}/);
  assert.match(quoteUi, /readOnly=\{linked\}/);
  assert.match(quoteUi, /readOnly=\{linked \|\| discountLocked\}/);
  assert.match(quoteUi, /Change the quantity\{mapKind \? " here" : " or customer section here"\}/);
  assert.equal((crm.match(/onOpenPriceBook=\{\(\) => openPriceBook\(\)\}/g) || []).length, 1);
  const navigation = crm.match(/function openPriceBook\([^\n]+\) \{[\s\S]*?\n  \}/);
  assert.ok(navigation);
  const navigationCode = ts.transpileModule(navigation[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const navigations = [];
  const openPriceBook = new Function("onOpenFinance", "setPriceBookView", "setView", `${navigationCode}; return openPriceBook;`);
  openPriceBook((...args) => navigations.push(args), () => assert.fail("must use the parent Finance route"), () => assert.fail("must use the parent Finance route"))();
  assert.deepEqual(navigations, [["pricebook", "items"]]);
  const localNavigations = [];
  openPriceBook(undefined, value => localNavigations.push(["priceBookView", value]), value => localNavigations.push(["view", value]))("packets");
  assert.deepEqual(localNavigations, [["priceBookView", "packets"], ["view", "pricebook"]]);
  assert.equal((crm.match(/<JobDetail key=/g) || []).length, 1);
  assert.match(crm, /navigationTarget\.kind === "crm-view"/);
});

test("the trade workspace prioritises quick setup and progressive disclosure", () => {
  for (const copy of ["Price book", "Start in under a minute", "Labour hour", "Material", "Call-out",
    "STC credit", "VEEC credit", "ESC credit", "Certificate", "negative amount per certificate",
    "Only the name and sell price are essential", "More details, optional", "Save and use in quotes"]) {
    assert.match(`${workspace}\n${crm}`, new RegExp(copy));
  }
  assert.match(workspace, /Quick start/);
  assert.match(workspace, /Uses the business profile, so this list stays in one place/);
  assert.match(workspace, /Choosing a catalogue item fills its current supplier, SKU and cost/);
  assert.doesNotMatch(`${workspace}\n${quoteUi}\n${route}`, /[\u2013\u2014]/);
});
