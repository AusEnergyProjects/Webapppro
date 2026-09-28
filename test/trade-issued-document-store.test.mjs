import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const store = read("../src/lib/trade-issued-document-store.ts");

function issuedStore() {
  const objects = new Map();
  const bucket = {
    put: async (key, bytes) => objects.set(key, bytes),
    get: async (key) => objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null,
    delete: async (key) => objects.delete(key),
  };
  const compiled = ts.transpileModule(store, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  Function('require', 'exports', compiled)((id) => {
    assert.equal(id, 'cloudflare:workers');
    return { env: { EVIDENCE: bucket } };
  }, exports);
  return exports;
}

test("issued PDF reads bind the stored reference to one exact document identity", () => {
  assert.match(
    store,
    /readImmutableIssuedPdf\(\s*reference: ImmutableIssuedPdfReference,\s*identity: ImmutableIssuedPdfIdentity,/,
  );
  assert.match(
    store,
    /objectKey !== immutableIssuedPdfObjectKey\(identity, expectedSha256\)/,
  );
  assert.match(
    store,
    /trade-issued-documents\/\$\{kind\}\/\$\{documentId\}\/revision-\$\{identity\.revision\}\/\$\{sha256\}\.pdf/,
  );
});

test('quote storage round-trips the 24 MB output boundary and rejects larger writes and references', async () => {
  const api = issuedStore();
  const backing = new Uint8Array(24_000_001);
  backing.set(new TextEncoder().encode('%PDF-'));
  const identity = { kind: 'quote', documentId: 'large-quote', revision: 1 };
  const bytes = backing.subarray(0, 24_000_000);
  const reference = await api.storeImmutableIssuedPdf({ ...identity, bytes });
  assert.equal(reference.sizeBytes, 24_000_000);
  const restored = await api.readImmutableIssuedPdf(reference, identity);
  assert.deepEqual(restored, bytes);
  await assert.rejects(api.storeImmutableIssuedPdf({ ...identity, bytes: backing }), /ISSUED_PDF_INVALID/);
  await assert.rejects(api.readImmutableIssuedPdf({ ...reference, sizeBytes: 24_000_001 }, identity), /ISSUED_PDF_REFERENCE_INVALID/);
});

test('quote output changes retain the invoice and rental report storage boundaries', async () => {
  const api = issuedStore();
  const bytes = new Uint8Array(50 * 1024 * 1024 + 1);
  bytes.set(new TextEncoder().encode('%PDF-'));
  const identity = { documentId: 'existing-limits', revision: 1 };
  const invoice = await api.prepareImmutableIssuedPdfReference({ ...identity, kind: 'invoice', bytes: bytes.subarray(0, 12 * 1024 * 1024) });
  assert.equal(invoice.sizeBytes, 12 * 1024 * 1024);
  await assert.rejects(api.prepareImmutableIssuedPdfReference({ ...identity, kind: 'invoice', bytes: bytes.subarray(0, 12 * 1024 * 1024 + 1) }), /ISSUED_PDF_INVALID/);
  const rental = await api.prepareImmutableIssuedPdfReference({ ...identity, kind: 'rental-report', bytes: bytes.subarray(0, 50 * 1024 * 1024) });
  assert.equal(rental.sizeBytes, 50 * 1024 * 1024);
  await assert.rejects(api.prepareImmutableIssuedPdfReference({ ...identity, kind: 'rental-report', bytes }), /ISSUED_PDF_INVALID/);
});
