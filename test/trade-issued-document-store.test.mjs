import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const store = read("../src/lib/trade-issued-document-store.ts");

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
