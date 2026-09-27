import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as contract from "../src/lib/trade-price-book-documents.ts";

const source = fs.readFileSync(new URL("../src/app/api/trade-price-book/documents/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const document = { id: "doc-1", priceBookItemId: "product-1", fileName: "Manual.pdf", label: "Manual", contentType: "application/pdf", sizeBytes: 8, pageCount: 1, sha256: "a".repeat(64), objectKey: "trade-price-book-documents/owner-a/product-1/doc-1.pdf", createdAt: "2026-09-27T12:00:00.000Z" };
function fixture({ allowed = true, error = "" } = {}) {
  const route = {}, calls = [], access = { ownerUid: "owner-a" };
  class TradeAccessError extends Error {}
  const assertAccess = () => { if (!allowed) throw new Error("PRODUCT_DOCUMENT_ACCESS_REQUIRED"); };
  const check = (name, args) => { assertAccess(); calls.push({ name, args }); if (error) throw new Error(error); };
  const dependencies = {
    "@/lib/admin-server": { sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin, mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } }) },
    "@/lib/trade-access-server": { TradeAccessError },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-price-book-documents": contract,
    "@/lib/trade-price-book-documents-server": {
      assertProductDocumentAccess: assertAccess,
      async listPriceBookDocuments(...args) { check("list", args); return [document]; },
      async readPriceBookDocument(...args) { check("read", args); return { document, bytes: new TextEncoder().encode("%PDF-1.7") }; },
      async uploadPriceBookDocument(...args) { check("upload", args); return document; },
      async removePriceBookDocument(...args) { check("remove", args); },
    },
  };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, route);
  return { route, calls, access };
}
const url = "https://tlink.test/api/trade-price-book/documents?itemId=product-1";

test("document API lists safe metadata and authenticated PDF reads are private downloads", async () => {
  const h = fixture(), list = await h.route.GET(new Request(url));
  assert.equal(list.status, 200);
  const result = await list.json(); assert.equal(result.documents[0].fileName, "Manual.pdf");
  assert.equal(result.documents[0].objectKey, undefined); assert.equal(result.documents[0].sha256, undefined);
  const download = await h.route.GET(new Request(`${url}&documentId=doc-1`));
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.equal(download.headers.get("cache-control"), "private, no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.match(download.headers.get("content-security-policy"), /sandbox/);
  assert.equal(await download.text(), "%PDF-1.7");
});

test("raw PDF uploads pass only authenticated ownership and association deletion never accepts keys", async () => {
  const h = fixture(), pdf = new TextEncoder().encode("%PDF-1.7");
  const uploaded = await h.route.POST(new Request(`${url}&filename=Manual.pdf&ownerUid=foreign`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf }));
  assert.equal(uploaded.status, 201);
  assert.deepEqual(h.calls[0].args, [h.access, "product-1", "Manual.pdf", null, pdf]);
  assert.equal((await uploaded.json()).document.objectKey, undefined);
  const removed = await h.route.DELETE(new Request(`${url}&documentId=doc-1&objectKey=foreign`, { method: "DELETE" }));
  assert.equal(removed.status, 200); assert.deepEqual(h.calls[1].args, [h.access, "product-1", "doc-1"]);
});

test("document requests reject cross-origin, missing permission, false MIME and oversized streams", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const h = fixture(), request = new Request(url, { method, headers: { Origin: "https://foreign.test" } });
    assert.equal((await h.route[method](request)).status, 403); assert.equal(h.calls.length, 0);
    const denied = fixture({ allowed: false });
    assert.equal((await denied.route[method](new Request(url, { method }))).status, 403);
  }
  const h = fixture();
  assert.equal((await h.route.POST(new Request(url, { method: "POST", body: "%PDF-1.7", headers: { "Content-Type": "text/plain" } }))).status, 400);
  const tooLarge = new Request(url, { method: "POST", duplex: "half", headers: { "Content-Type": "application/pdf" }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(contract.MAX_PRODUCT_DOCUMENT_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } }) });
  assert.equal((await h.route.POST(tooLarge)).status, 413); assert.equal(h.calls.length, 0);
});

test("form, file limit and access errors are actionable without exposing storage details", async () => {
  for (const [error, status] of [["PRODUCT_DOCUMENT_FORM_UNSUPPORTED", 400], ["PRODUCT_DOCUMENT_PRODUCT_LIMIT", 409], ["PRODUCT_DOCUMENT_NOT_FOUND", 404], ["R2 internal private key", 503]]) {
    const h = fixture({ error }), response = await h.route.GET(new Request(url));
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /R2 internal private key/);
  }
});
