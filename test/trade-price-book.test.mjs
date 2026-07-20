import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calculatePriceBookRates, normalisePriceBookInput, priceBookQuoteLineType } from "../src/lib/trade-price-book.ts";

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
  assert.equal(priceBookQuoteLineType("equipment"), "product");
  assert.equal(priceBookQuoteLineType("call_out"), "labour");
  assert.equal(priceBookQuoteLineType("rebate"), "adjustment");
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

test("price-book writes are office-role protected, owner scoped and append price history", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireInstallerTeamAccess\(request, false\)/);
  assert.match(route, /canDispatch\(access\)/);
  assert.match(route, /firebase_uid = \?/);
  assert.match(route, /PRICE_BOOK_MANAGEMENT_REQUIRED/);
  assert.match(route, /priceChanged/);
  assert.match(route, /priceRevision = Number\(existing\.price_revision\) \+ \(priceChanged \? 1 : 0\)/);
  assert.match(route, /change_type, changed_by_uid, changed_at/);
  assert.match(route, /record_status = 'archived'/);
  assert.match(route, /capabilities FROM trade_accounts/);
  assert.match(route, /supplier_products p JOIN trade_accounts/);
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
  assert.match(quoteUi, /description: item\.description \|\| item\.name/);
  assert.match(quoteUi, /Add a saved item/);
  assert.match(quoteUi, /No saved items yet/);
  assert.match(quoteUi, /Open Price book/);
  assert.doesNotMatch(quoteUi, /priceBookItems\.length > 0 && <div className="trade-quote-price-book"/);
  assert.match(quoteUi, /const linked = Boolean\(line\.priceBookItemId\)/);
  assert.match(quoteUi, /disabled=\{linked\}/);
  assert.match(quoteUi, /readOnly=\{linked\}/);
  assert.match(quoteUi, /Change the quantity or customer section here/);
  assert.equal((crm.match(/onOpenPriceBook=\{\(\) => \{ setPriceBookView\("items"\); setView\("pricebook"\); \}\}/g) || []).length, 1);
  assert.equal((crm.match(/<JobDetail key=/g) || []).length, 1);
  assert.match(crm, /navigationTarget\.kind === "crm-view"/);
});

test("the trade workspace prioritises quick setup and progressive disclosure", () => {
  for (const copy of ["Price book", "Start in under a minute", "Labour hour", "Material", "Call-out",
    "Only the name, type and sell price are essential", "More details, optional", "Save and use in quotes"]) {
    assert.match(`${workspace}\n${crm}`, new RegExp(copy));
  }
  assert.match(workspace, /Quick start/);
  assert.match(workspace, /Uses the business profile, so this list stays in one place/);
  assert.match(workspace, /Choosing a catalogue item fills its current supplier, SKU and cost/);
  assert.doesNotMatch(`${workspace}\n${quoteUi}\n${route}`, /[\u2013\u2014]/);
});
