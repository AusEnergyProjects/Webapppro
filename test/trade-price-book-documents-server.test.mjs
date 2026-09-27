import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import * as contract from "../src/lib/trade-price-book-documents.ts";

const source = fs.readFileSync(new URL("../src/lib/trade-price-book-documents-server.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = (ownerUid = "owner-a", changes = {}) => ({ ownerUid, actorUid: ownerUid, isOwner: true, canViewPriceBook: true, canManagePriceBook: true, ...changes });
async function bytes(label = "Datasheet") { const pdf = await PDFDocument.create(); pdf.addPage().drawText(label); return pdf.save(); }
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec("CREATE TABLE trade_price_book_items(id TEXT PRIMARY KEY, firebase_uid TEXT, record_status TEXT); CREATE TABLE trade_crm_quote_versions(id TEXT PRIMARY KEY);");
  sql.exec(fs.readFileSync(new URL("../drizzle/0200_trade_price_book_documents.sql", import.meta.url), "utf8"));
  sql.exec("INSERT INTO trade_price_book_items VALUES ('product-a','owner-a','active'),('product-b','owner-b','active')");
  const stored = new Map(), deleted = [], reads = [], bindings = [];
  let beforeWrite, failAfterInsert = false;
  const bucket = { async put(key, data) { stored.set(key, new Uint8Array(data)); }, async get(key) { reads.push(key); const value = stored.get(key); return value ? { size: value.length, async arrayBuffer() { return new Uint8Array(value).buffer; } } : null; }, async delete(key) { deleted.push(key); stored.delete(key); } };
  const db = { prepare(statement) { return { bind(...values) { assert.ok(values.length <= 100, "D1 bound parameter limit"); bindings.push({ statement, count: values.length }); return {
    async first() { return sql.prepare(statement).get(...values) ?? null; }, async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(); } const result = sql.prepare(statement).run(...values); if (failAfterInsert && statement.startsWith("INSERT")) { failAfterInsert = false; throw new Error("Ambiguous network result"); } return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const server = {}, dependencies = { "cloudflare:workers": { env: { EVIDENCE: bucket } }, "../../db": { getD1: () => db }, "./trade-price-book-documents": contract };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, server);
  return { server, sql, stored, deleted, reads, bindings, beforeWrite(hook) { beforeWrite = hook; }, failAfterInsert() { failAfterInsert = true; } };
}

test("owned product upload, list and quote resolution use immutable actual PDF bytes", async t => {
  const h = fixture(t), pdf = await bytes();
  const document = await h.server.uploadPriceBookDocument(owner(), "product-a", "Datasheet.pdf", "Manufacturer datasheet", pdf);
  assert.equal(document.pageCount, 1); assert.equal(document.sizeBytes, pdf.length);
  assert.deepEqual(await h.server.listPriceBookDocuments(owner(), "product-a"), [document]);
  assert.deepEqual(await h.server.resolvePriceBookDocuments("owner-a", ["product-a", "product-a"]), [document]);
  assert.deepEqual((await h.server.readPriceBookDocument(owner(), "product-a", document.id)).bytes, pdf);
  assert.deepEqual(await h.server.uploadPriceBookDocument(owner(), "product-a", "Duplicate.pdf", "Duplicate", pdf), document);
  assert.equal(h.stored.size, 1);
});

test("foreign owner, foreign product and field permissions cannot expose or mutate documents", async t => {
  const h = fixture(t), pdf = await bytes(), access = owner();
  const document = await h.server.uploadPriceBookDocument(access, "product-a", "Datasheet.pdf", "Datasheet", pdf);
  for (const call of [() => h.server.listPriceBookDocuments(owner("owner-b"), "product-a"), () => h.server.readPriceBookDocument(owner("owner-b"), "product-b", document.id), () => h.server.uploadPriceBookDocument(access, "product-b", "Datasheet.pdf", "Datasheet", pdf), () => h.server.removePriceBookDocument(owner("owner-b"), "product-a", document.id)]) await assert.rejects(call(), /NOT_FOUND/);
  assert.deepEqual(await h.server.resolvePriceBookDocuments("owner-b", ["product-a"]), []);
  const field = owner("owner-a", { isOwner: false, canViewPriceBook: false, canManagePriceBook: false });
  await assert.rejects(h.server.listPriceBookDocuments(field, "product-a"), /ACCESS_REQUIRED/);
  await assert.rejects(h.server.uploadPriceBookDocument({ ...field, canViewPriceBook: true }, "product-a", "Doc.pdf", "Doc", pdf), /ACCESS_REQUIRED/);
  assert.equal(h.reads.length, 0); assert.equal(h.deleted.length, 0);
});

test("quote document resolution batches over 100 products within D1 limits and preserves owner scope", async t => {
  const h = fixture(t), ids = Array.from({ length: 150 }, (_, i) => `product-${String(i).padStart(3, "0")}`);
  for (const id of ids) h.sql.prepare("INSERT INTO trade_price_book_items VALUES (?, 'owner-a', 'active')").run(id);
  const first = await h.server.uploadPriceBookDocument(owner(), ids[0], "First.pdf", "First", await bytes("First"));
  const last = await h.server.uploadPriceBookDocument(owner(), ids.at(-1), "Last.pdf", "Last", await bytes("Last"));
  await h.server.uploadPriceBookDocument(owner("owner-b"), "product-b", "Foreign.pdf", "Foreign", await bytes("Foreign"));
  h.bindings.length = 0;
  assert.deepEqual(await h.server.resolvePriceBookDocuments("owner-a", ["product-b", ...ids.toReversed()]), [first, last]);
  assert.deepEqual(h.bindings.map(value => value.count), [91, 62]);
  assert.ok(h.bindings.every(value => value.statement.includes("document.owner_uid = ?")));
  await assert.rejects(h.server.resolvePriceBookDocuments("owner-a", Array.from({ length: 201 }, (_, i) => `id-${i}`)), /LIMIT/);
});

test("one brochure linked to several products counts once toward the quote envelope", async t => {
  const h = fixture(t), pdf = new Uint8Array(5 * 1024 * 1024).fill(32); pdf.set(await bytes("Shared brochure"));
  h.sql.exec("INSERT INTO trade_price_book_items VALUES ('product-c','owner-a','active'),('product-d','owner-a','active')");
  const first = await h.server.uploadPriceBookDocument(owner(), "product-a", "Brochure.pdf", "Brochure", pdf);
  for (const id of ["product-c", "product-d"]) await h.server.uploadPriceBookDocument(owner(), id, "Brochure.pdf", "Brochure", pdf);
  assert.deepEqual(await h.server.resolvePriceBookDocuments("owner-a", ["product-a", "product-c", "product-d"]), [first]);
});

test("removing a product association preserves issued snapshot bytes and immutable hashes", async t => {
  const h = fixture(t), pdf = await bytes();
  const document = await h.server.uploadPriceBookDocument(owner(), "product-a", "Manual.pdf", "Manual", pdf);
  const snapshot = JSON.parse(JSON.stringify(document));
  await h.server.removePriceBookDocument(owner(), "product-a", document.id);
  assert.deepEqual(await h.server.listPriceBookDocuments(owner(), "product-a"), []);
  assert.deepEqual(await h.server.resolvePriceBookDocuments("owner-a", ["product-a"]), []);
  await assert.rejects(h.server.readPriceBookDocument(owner(), "product-a", document.id), /NOT_FOUND/);
  assert.deepEqual((await h.server.loadPriceBookDocument(snapshot)).bytes, pdf);
  assert.equal(h.deleted.length, 0);
  const replacement = await h.server.uploadPriceBookDocument(owner(), "product-a", "Manual.pdf", "Manual", await bytes("New manual"));
  assert.notEqual(replacement.objectKey, snapshot.objectKey); assert.notEqual(replacement.sha256, snapshot.sha256);
  assert.deepEqual((await h.server.loadPriceBookDocument(snapshot)).bytes, pdf);
  h.stored.get(snapshot.objectKey)[20] ^= 1;
  await assert.rejects(h.server.loadPriceBookDocument(snapshot), /UNAVAILABLE/);
});

test("five-file cap is atomic and archived products cannot gain new associations", async t => {
  const h = fixture(t);
  for (let i = 0; i < 5; i++) await h.server.uploadPriceBookDocument(owner(), "product-a", `Doc${i}.pdf`, `Doc ${i}`, await bytes(`Doc ${i}`));
  await assert.rejects(h.server.uploadPriceBookDocument(owner(), "product-a", "Sixth.pdf", "Sixth", await bytes("Sixth")), /PRODUCT_LIMIT/);
  assert.equal(h.stored.size, 5); assert.equal(h.deleted.length, 1);
  const first = (await h.server.listPriceBookDocuments(owner(), "product-a"))[0];
  await h.server.removePriceBookDocument(owner(), "product-a", first.id);
  h.beforeWrite(() => h.sql.exec("UPDATE trade_price_book_items SET record_status='archived' WHERE id='product-a'"));
  await assert.rejects(h.server.uploadPriceBookDocument(owner(), "product-a", "Archive.pdf", "Archive", await bytes("Archive")), /NOT_FOUND/);
  assert.equal(h.stored.size, 5, "historical bytes remain; failed staging is cleaned up");
});

test("uncertain database commit never deletes bytes that a quote may already reference", async t => {
  const h = fixture(t), pdf = await bytes(); h.failAfterInsert();
  await assert.rejects(h.server.uploadPriceBookDocument(owner(), "product-a", "Manual.pdf", "Manual", pdf), /Ambiguous/);
  const documents = await h.server.resolvePriceBookDocuments("owner-a", ["product-a"]);
  assert.equal(documents.length, 1); assert.equal(h.deleted.length, 0);
  assert.deepEqual((await h.server.loadPriceBookDocument(documents[0])).bytes, pdf);
});
