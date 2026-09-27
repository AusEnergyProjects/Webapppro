import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { inspectProductPdf, parseProductDocuments, productDocumentMetadata, assertProductDocumentOwner, MAX_PRODUCT_DOCUMENT_BYTES } from "../src/lib/trade-price-book-documents.ts";

async function pdf(pages = 2) {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i++) document.addPage().drawText(`Product page ${i + 1}`);
  return document;
}
const reference = changes => ({ id: "doc-1", priceBookItemId: "product-1", fileName: "Datasheet.pdf", label: "Datasheet", contentType: "application/pdf", sizeBytes: 1000, pageCount: 2, sha256: "a".repeat(64), objectKey: "trade-price-book-documents/owner-a/product-1/doc-1.pdf", createdAt: "2026-09-27T12:00:00.000Z", ...changes });

test("product upload inspector counts actual PDF pages and rejects invalid, oversized and encrypted PDFs", async () => {
  const valid = await (await pdf()).save();
  assert.deepEqual(await inspectProductPdf(valid), { pageCount: 2 });
  await assert.rejects(inspectProductPdf(new TextEncoder().encode("%PDF-not-a-document")), /PRODUCT_DOCUMENT_INVALID/);
  await assert.rejects(inspectProductPdf(new Uint8Array(MAX_PRODUCT_DOCUMENT_BYTES + 1)), /PRODUCT_DOCUMENT_INVALID/);
  await assert.rejects(inspectProductPdf(await (await pdf(41)).save()), /PRODUCT_DOCUMENT_LIMIT/);
  await assert.rejects(inspectProductPdf(await (await pdf(0)).save({ addDefaultPage: false })), /PRODUCT_DOCUMENT_LIMIT/);
  const encrypted = await pdf(1);
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: PDFName.of("Standard"), V: 1, R: 2, O: "owner", U: "user", P: -4 }));
  await assert.rejects(inspectProductPdf(await encrypted.save()), /PRODUCT_DOCUMENT_INVALID/);
});

test("interactive forms must be flattened so completed values are not silently dropped", async () => {
  const document = await pdf(1), field = document.getForm().createTextField("serial");
  field.setText("A1234"); field.addToPage(document.getPage(0));
  await assert.rejects(inspectProductPdf(await document.save()), /PRODUCT_DOCUMENT_FORM_UNSUPPORTED/);
  document.getForm().flatten();
  assert.deepEqual(await inspectProductPdf(await document.save()), { pageCount: 1 });
});

test("references enforce scope, quote envelope and safe public metadata", () => {
  const first = reference();
  assert.deepEqual(parseProductDocuments(JSON.stringify([first])), [first]);
  assertProductDocumentOwner(first, "owner-a");
  assert.throws(() => assertProductDocumentOwner(first, "owner-b"), /NOT_FOUND/);
  assert.throws(() => parseProductDocuments([reference({ objectKey: "https://example.com/source.pdf" })]), /INVALID/);
  assert.throws(() => parseProductDocuments([reference({ priceBookItemId: "foreign-product" })]), /INVALID/);
  assert.throws(() => parseProductDocuments([first, first]), /INVALID/);
  assert.throws(() => parseProductDocuments([reference({ sizeBytes: MAX_PRODUCT_DOCUMENT_BYTES }), reference({ id: "doc-2", objectKey: "trade-price-book-documents/owner-a/product-1/doc-2.pdf", sizeBytes: MAX_PRODUCT_DOCUMENT_BYTES })]), /LIMIT/);
  assert.throws(() => parseProductDocuments(Array.from({ length: 3 }, (_, i) => reference({ id: `doc-${i}`, objectKey: `trade-price-book-documents/owner-a/product-1/doc-${i}.pdf`, pageCount: 40 }))), /LIMIT/);
  const metadata = productDocumentMetadata(first);
  assert.equal(metadata.objectKey, undefined); assert.equal(metadata.sha256, undefined);
  assert.equal(metadata.pageCount, 2); assert.equal(metadata.fileName, "Datasheet.pdf");
});
