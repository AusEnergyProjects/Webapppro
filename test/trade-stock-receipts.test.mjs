import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import * as contract from "../src/lib/trade-stock-receipts.ts";
import * as guards from "../src/lib/trade-stock-schema-guards.ts";
import * as documents from "../src/lib/trade-price-book-documents.ts";
import { confirmStockReceipt } from "../src/lib/trade-stock-receipt-confirm.ts";
import { analyseStockReceipt } from "../src/lib/trade-stock-receipt-ai.ts";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const extracted = { supplier: "Vendor", reference: "PO-1", kind: "purchase_order", lines: [{ description: "Heat pump", sku: "HP1", quantity: 3, unit: "each" }], warnings: [] };
const input = (extra = {}) => ({ receiptId: "receipt-1", supplier: "Vendor", reference: "INV-1", locationId: "main", confirmReceived: true, lines: [{ itemId: "pump", quantityMilli: 3000, expectedRevision: 1 }], ...extra });
const product = { id: "pump", name: "Heat pump", code: "PB-PUMP", sku: "HP1", supplier: "Vendor", unit: "each", revision: 1 };
function fixture() {
  const sqlite = new DatabaseSync(":memory:"), schema = read("db/schema.ts");
  for (const table of ["trade_team_members", "trade_price_book_items", "trade_work_orders", "trade_crm_job_details", "trade_crm_job_plans", "trade_crm_job_plan_phases", "trade_crm_job_plan_requirements", "trade_crm_job_actuals", "trade_work_order_events", "trade_crm_commercial_handovers", "trade_crm_quote_items", "trade_crm_quote_execution_snapshots", "trade_crm_quote_acceptances"]) {
    const start = schema.indexOf(`sqliteTable("${table}", {`), block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z_]+)"/g)].map(match => match[1]);
    sqlite.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/cents|minutes|milli|position/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  for (const file of ["0207_trade_stock.sql", "0208_trade_stock_locations.sql", "0213_trade_stock_receipts.sql"]) sqlite.exec(read(`drizzle/${file}`));
  for (const guard of guards.TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) sqlite.exec(guard.sql);
  sqlite.exec(`INSERT INTO trade_price_book_items(id,firebase_uid,item_code,name,item_type,unit_label,record_status,supplier_sku,supplier_name) VALUES ('pump','owner','PB-PUMP','Heat pump','material','each','active','HP1','Vendor'),('roll','owner','PB-ROLL','Insulation','material','roll','active','R1','Vendor'),('foreign','other','PB-OTHER','Private item','material','each','active','OTHER','Other');
    INSERT INTO trade_stock_items(item_id,firebase_uid,tracked,on_hand_milli,revision,updated_at) VALUES ('pump','owner',1,0,1,'now'),('roll','owner',1,0,1,'now'),('foreign','other',1,0,1,'now');
    INSERT INTO trade_stock_locations(id,firebase_uid,name,is_default,created_at,updated_at) VALUES ('main','owner','Main',1,'now','now'),('other-location','other','Other',1,'now','now');`);
  const prepare = (sql, values = []) => ({ sql, values, bind: (...next) => prepare(sql, next), first: async () => sqlite.prepare(sql).get(...values) || null, all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => sqlite.prepare(sql).run(...values) });
  const db = { prepare, beforeBatch: null, afterBatch: null, failAt: -1, async batch(statements) {
    db.beforeBatch?.(); sqlite.exec("BEGIN"); let committed = false;
    try { const result = statements.map((statement, index) => { if (index === db.failAt) throw new Error("STORAGE_FAILED"); return sqlite.prepare(statement.sql).all(...statement.values); }); sqlite.exec("COMMIT"); committed = true; db.afterBatch?.(); return result; }
    catch (error) { if (!committed) sqlite.exec("ROLLBACK"); throw error; }
  } };
  const seed = (id = "receipt-1", owner = "owner", sha = id) => sqlite.prepare("INSERT INTO trade_stock_receipts(id,firebase_uid,sha256,file_name,object_key,created_at,created_by_uid,extraction_json) VALUES(?,?,?,'delivery.pdf',?,'now','staff',?)").run(id, owner, sha, `files/${id}`, JSON.stringify(extracted));
  const files = new Map(), bucket = { fail: false, async put(key, value) { if (bucket.fail) throw new Error("R2 failed"); files.set(key, value); }, async get(key) { const value = files.get(key); return value ? { arrayBuffer: async () => value } : null; } };
  let aiCalls = 0, aiError = false;
  const exports = {};
  const deps = { "cloudflare:workers": { env: { EVIDENCE: bucket } }, "../../db": { getD1: () => db }, "./trade-price-book-documents": documents,
    "./trade-stock-receipt-ai": { analyseStockReceipt: async () => { aiCalls++; if (aiError) throw new Error("AI unavailable"); return extracted; } },
    "./trade-stock-receipts": contract, "./trade-stock-receipt-confirm": { confirmStockReceipt }, "./trade-stock-schema-guards": guards,
    "./trade-stock-server": { stockLocations: async () => [{ id: "main", name: "Main", isDefault: true }] } };
  Function("require", "exports", ts.transpileModule(read("src/lib/trade-stock-receipts-server.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => { assert.ok(deps[id], id); return deps[id]; }, exports);
  const count = table => sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
  return { sqlite, db, seed, server: exports, bucket, files, aiCalls: () => aiCalls, failAI: () => { aiError = true; }, count };
}

test("receipt matching preselects only exact product identifiers with compatible units", () => {
  assert.equal(contract.matchReceiptLines(extracted, [product])[0].itemId, "pump");
  assert.equal(contract.matchReceiptLines({ ...extracted, lines: [{ ...extracted.lines[0], unit: "pcs" }] }, [product])[0].itemId, "pump");
  for (const unit of ["box", "", "pack"]) assert.equal(contract.matchReceiptLines({ ...extracted, lines: [{ ...extracted.lines[0], unit }] }, [product])[0].itemId, "");
  assert.equal(contract.matchReceiptLines(extracted, [product, { ...product, id: "duplicate" }])[0].itemId, "");
  assert.equal(contract.matchReceiptLines({ ...extracted, lines: [{ ...extracted.lines[0], sku: "HP2" }] }, [product])[0].itemId, "");
  assert.throws(() => contract.receiptQuantityMilli("1.2349"), /RECEIPT_INVALID/);
  assert.equal(contract.receiptQuantityMilli("1.125"), 1125);
  assert.throws(() => contract.parseReceiptConfirmation(input({ lines: [input().lines[0], input().lines[0]] })), /DUPLICATE/);
});

test("confirmed receipt receives once and records actual choices rather than AI guesses", async () => {
  const f = fixture(); f.seed();
  const payload = input({ supplier: "Correct vendor", reference: "Correct ref", lines: [{ itemId: "roll", quantityMilli: 12500, expectedRevision: 1 }] });
  await confirmStockReceipt(f.db, "owner", "staff", payload);
  await confirmStockReceipt(f.db, "owner", "staff", payload);
  assert.equal(f.sqlite.prepare("SELECT on_hand_milli FROM trade_stock_items WHERE item_id='roll'").get().on_hand_milli, 12500);
  assert.equal(f.count("trade_stock_movements"), 1); assert.equal(f.count("trade_stock_operations"), 1);
  const row = f.sqlite.prepare("SELECT * FROM trade_stock_receipts").get();
  f.sqlite.exec("UPDATE trade_price_book_items SET name='New name' WHERE id='roll'");
  const receipt = f.server.publicStockReceipt(row, []);
  assert.deepEqual(receipt.confirmed, { supplier: "Correct vendor", reference: "Correct ref", locationId: "main", lines: [{ itemId: "roll", name: "Insulation", unit: "roll", quantityMilli: 12500 }] });
  assert.equal(receipt.lines[0].quantity, 12.5); assert.equal(receipt.extraction.lines[0].quantity, 3);
  await assert.rejects(confirmStockReceipt(f.db, "owner", "staff", { ...payload, reference: "Changed" }), /ALREADY_RECEIVED/);
  f.sqlite.close();
});

test("lost receipt response retries the same transaction without adding stock twice", async () => {
  const f = fixture(); f.seed(); f.db.afterBatch = () => { throw new Error("Lost response"); };
  await assert.rejects(confirmStockReceipt(f.db, "owner", "staff", input()), /Lost response/);
  f.db.afterBatch = null; await confirmStockReceipt(f.db, "owner", "staff", input());
  assert.equal(f.count("trade_stock_movements"), 1); f.sqlite.close();
});

test("concurrent confirmations can only receive one reviewed quantity", async () => {
  const f = fixture(); f.seed();
  const results = await Promise.allSettled([confirmStockReceipt(f.db, "owner", "staff", input()), confirmStockReceipt(f.db, "owner", "staff", input({ lines: [{ itemId: "pump", quantityMilli: 7000, expectedRevision: 1 }] }))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.count("trade_stock_movements"), 1);
  assert.ok([3000, 7000].includes(f.sqlite.prepare("SELECT on_hand_milli FROM trade_stock_items WHERE item_id='pump'").get().on_hand_milli));
  f.sqlite.close();
});

for (const failure of ["stale", "untracked", "product", "location", "storage", "overflow"]) test(`receipt ${failure} failure rolls back all lines and receipt status`, async () => {
  const f = fixture(); f.seed();
  const payload = input({ lines: [{ itemId: "pump", quantityMilli: 3000, expectedRevision: 1 }, { itemId: "roll", quantityMilli: 2000, expectedRevision: 1 }] });
  if (failure === "stale") f.sqlite.exec("UPDATE trade_stock_items SET revision=2 WHERE item_id='roll'");
  if (failure === "untracked") f.sqlite.exec("UPDATE trade_stock_items SET tracked=0 WHERE item_id='roll'");
  if (failure === "product") payload.lines[1].itemId = "foreign";
  if (failure === "location") payload.locationId = "other-location";
  if (failure === "storage") f.db.failAt = 8;
  if (failure === "overflow") { payload.lines[1].quantityMilli = 1_000_000_000; f.sqlite.exec("INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at) VALUES('roll','main','owner',1,'now')"); }
  await assert.rejects(confirmStockReceipt(f.db, "owner", "staff", payload));
  assert.equal(f.sqlite.prepare("SELECT status FROM trade_stock_receipts").get().status, "review");
  assert.equal(f.count("trade_stock_movements"), 0); assert.equal(f.count("trade_stock_operations"), 0);
  assert.equal(f.sqlite.prepare("SELECT on_hand_milli FROM trade_stock_items WHERE item_id='pump'").get().on_hand_milli, 0); f.sqlite.close();
});

test("foreign receipt cannot be read or received and duplicate supplier reference cannot receive twice", async () => {
  const f = fixture(); f.seed(); f.seed("receipt-2");
  await assert.rejects(confirmStockReceipt(f.db, "other", "staff", input()), /NOT_FOUND/);
  await assert.rejects(f.server.stockReceiptWorkspace("other", "receipt-1"), /NOT_FOUND/);
  await assert.rejects(f.server.readStockReceipt("other", "receipt-1"), /NOT_FOUND/);
  await confirmStockReceipt(f.db, "owner", "staff", input());
  await assert.rejects(confirmStockReceipt(f.db, "owner", "staff", input({ receiptId: "receipt-2", supplier: "vendor", reference: "inv-1", lines: [{ itemId: "pump", quantityMilli: 3000, expectedRevision: 2 }] })), /UNIQUE/);
  assert.equal(f.count("trade_stock_movements"), 1); f.sqlite.close();
});

test("PDF upload deduplicates per owner, keeps original bytes and has no stock side effect", async () => {
  const f = fixture(), pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  const first = await f.server.uploadStockReceipt("owner", "staff", "delivery.pdf", bytes);
  const repeat = await f.server.uploadStockReceipt("owner", "staff", "renamed.pdf", bytes);
  assert.equal(first.receipt.id, repeat.receipt.id); assert.equal(f.aiCalls(), 1);
  assert.equal(f.count("trade_stock_receipts"), 1); assert.equal(f.count("trade_stock_movements"), 0);
  assert.deepEqual(new Uint8Array((await f.server.readStockReceipt("owner", first.receipt.id)).bytes), bytes);
  const other = await f.server.uploadStockReceipt("other", "staff", "delivery.pdf", bytes);
  assert.notEqual(first.receipt.id, other.receipt.id); f.sqlite.close();
});

test("AI reading failure allows manual review while storage failure releases the upload claim", async () => {
  const f = fixture(), pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
  f.bucket.fail = true; await assert.rejects(f.server.uploadStockReceipt("owner", "staff", "delivery.pdf", bytes), /R2 failed/);
  assert.equal(f.count("trade_stock_receipts"), 0);
  f.bucket.fail = false; f.failAI(); const next = await f.server.uploadStockReceipt("owner", "staff", "delivery.pdf", bytes);
  assert.match(next.receipt.analysisError, /Select the products/); assert.equal(next.receipt.status, "review");
  assert.equal(next.receipt.lines.length, 0); assert.equal(f.count("trade_stock_movements"), 0); f.sqlite.close();
});

test("AI request is schema constrained, untrusted input only and requires completed output", async () => {
  let request;
  const completed = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(extracted) }] }] };
  const fetcher = async (url, options) => { request = { url, options }; return Response.json(completed); };
  assert.deepEqual(await analyseStockReceipt(new TextEncoder().encode("%PDF-1.4"), "invoice.pdf", { apiKey: "fake-test-key", fetcher }), extracted);
  const body = JSON.parse(request.options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /untrusted data/); assert.equal(body.tools, undefined); assert.equal(body.input[0].content[0].type, "input_file");
  for (const output of [ { ...completed, status: "incomplete" }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
    { status: "completed", output: [] }, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"supplier":' }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...extracted, lines: [{ ...extracted.lines[0], quantity: -1 }] }) }] }] } ]) {
    await assert.rejects(analyseStockReceipt(new Uint8Array([1]), "invoice.pdf", { apiKey: "fake", fetcher: async () => Response.json(output) }));
  }
  await assert.rejects(analyseStockReceipt(new Uint8Array([1]), "invoice.pdf", { apiKey: "", fetcher }), /UNAVAILABLE/);
});
