import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

function handler() {
  let reads = 0;
  const option = { id: "example-current-model", name: "Example current model" };
  const dependencies = {
    "@/lib/product-comparison-item": { buildProductComparisonItem: (product, category) => ({ ...product, category }) },
    "@/lib/product-guides": { PRODUCT_GUIDE_CATEGORIES: [{ slug: "hot-water", options: [option] }] },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/product-details/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  Function("require", "exports", source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    if (name === "@/lib/product-guides") reads++;
    return dependencies[name];
  }, exports);
  return { GET: exports.GET, reads: () => reads };
}

test("invalid or duplicate product identifiers fail before loading the catalogue", async () => {
  const api = handler();
  for (const query of ["", "productId=../../secret", "productId=example-current-model&productId=other", "productId=" + "a".repeat(161)]) {
    const response = await api.GET(new Request("https://ausenergyassessments.com/api/product-details?" + query));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(api.reads(), 0);
});

test("exact product details use the shared builder and unknown products are not cached", async () => {
  const api = handler();
  const response = await api.GET(new Request("https://ausenergyassessments.com/api/product-details?productId=example-current-model"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await response.json(), { product: { id: "example-current-model", name: "Example current model", category: "hot-water" } });
  const missing = await api.GET(new Request("https://ausenergyassessments.com/api/product-details?productId=missing"));
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
});
