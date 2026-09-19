import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as priceBook from "../src/lib/trade-price-book.ts";

test("an imported catalogue larger than 500 items remains available for quoting within its business", async () => {
  const db = new DatabaseSync(":memory:");
  const migration = fs.readFileSync(new URL("../drizzle/0064_trade_price_book.sql", import.meta.url), "utf8");
  db.exec(migration.split("--> statement-breakpoint")[0]);
  const insert = db.prepare(`INSERT INTO trade_price_book_items
    (id, firebase_uid, item_code, name, item_type, sell_price_cents_ex_gst, record_status,
     created_by_uid, updated_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'material', 22000, ?, 'owner-a', 'owner-a', '2026-09-20', '2026-09-20')`);
  for (let i = 0; i < 750; i++) insert.run(`item-${i}`, "owner-a", `PB-${i}`, `Product ${String(i).padStart(4, "0")}`, "active");
  insert.run("foreign", "owner-b", "PB-foreign", "Another business product", "active");
  insert.run("archived", "owner-a", "PB-archived", "Archived product", "archived");
  const source = fs.readFileSync(new URL("../src/lib/trade-price-book-server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const d1 = { prepare(sql) { return { bind(...args) { return { async all() { return { results: db.prepare(sql).all(...args) }; } }; } }; } };
  Function("require", "exports", compiled)((name) => name === "../../db" ? { getD1: () => d1 } : priceBook, exports);
  const items = await exports.priceBookItemsForQuote("owner-a");
  assert.equal(items.length, 750);
  assert.equal(items.at(-1).id, "item-749");
  assert.equal(items.at(-1).sellPriceCentsExGst, 22000);
  assert.equal(items.some((item) => ["foreign", "archived"].includes(item.id)), false);
  const resolved = await exports.resolvePriceBookQuoteLines("owner-a", [{ priceBookItemId: "item-749", quantity: "1" }]);
  assert.equal(resolved.lines[0].unitPrice, "220.00");
  await assert.rejects(exports.resolvePriceBookQuoteLines("owner-a", [{ priceBookItemId: "foreign" }]), /PRICE_BOOK_ITEM_UNAVAILABLE/);
  db.close();
});
