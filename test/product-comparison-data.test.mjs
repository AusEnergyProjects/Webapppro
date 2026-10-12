import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { calculateProductRating, productRatingMethods } from "../src/lib/product-ratings.ts";
import { hotWaterComparisonFacts, hotWaterComparisonMeasurements } from "../src/lib/product-hot-water.ts";
import { productComparisonCard, readProductComparisonDetails } from "../src/components/product-comparison-data.ts";
import { sortProductComparisons } from "../src/components/product-comparison-sort.ts";

function compile(relative, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  Function("require", "exports", source)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exports);
  return exports;
}
const { buildProductComparisonItem } = compile("../src/lib/product-comparison-item.ts", {
  "./product-ratings": { calculateProductRating, productRatingMethods },
  "./product-hot-water": { hotWaterComparisonFacts, hotWaterComparisonMeasurements },
});
const slugs = ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split", "ev-chargers"];
const catalogue = Object.fromEntries(slugs.map(slug => [slug, JSON.parse(readFileSync(new URL(`../src/lib/product-guides/${slug}.json`, import.meta.url), "utf8"))]));

test("lightweight catalogue retains every visible figure and searchable specification without shipping unopened Specs", () => {
  for (const slug of slugs) {
    const details = catalogue[slug].map(option => buildProductComparisonItem(option, slug));
    const cards = details.map(productComparisonCard);
    for (let index = 0; index < cards.length; index++) {
      const full = details[index], card = cards[index];
      assert.deepEqual(card.pros, full.pros);
      assert.deepEqual(card.cons, full.cons);
      assert.deepEqual(card.hotWaterFacts, full.hotWaterFacts);
      assert.equal(card.image.src, full.image.src);
      assert.deepEqual(card.ratings.map(figure => [figure.id, figure.label, figure.score, figure.reason, figure.measurement?.value, figure.measurement?.valueMaximum, figure.measurement?.unit]),
        full.ratings.map(figure => [figure.id, figure.label, figure.score, figure.reason, figure.measurement?.value, figure.measurement?.valueMaximum, figure.measurement?.unit]));
      for (const spec of full.technicalSpecs) assert.ok(card.searchText.includes(spec.value.toLocaleLowerCase("en-AU")), full.id + ": all original spec search remains available");
      for (const field of ["sources", "technicalSpecs", "freshness", "checkedAt"]) assert.equal(Object.hasOwn(card, field), false);
      assert.deepEqual(readProductComparisonDetails(JSON.parse(JSON.stringify({ product: full })), full.id), JSON.parse(JSON.stringify(full)), full.id + ": exact details still available through validated response");
    }
    assert.ok(Buffer.byteLength(JSON.stringify(cards)) < Buffer.byteLength(JSON.stringify(details)) * 0.5, slug + ": initial catalogue payload must be less than half its full-detail size");
    assert.equal(sortProductComparisons(cards, "", { criterion: "name", direction: "ascending" }).length, catalogue[slug].length);
  }
});

test("details decoder rejects mismatched products, unsafe document URLs, malformed bars and invalid photos", () => {
  const full = buildProductComparisonItem(catalogue["hot-water"][0], "hot-water");
  const invalid = change => {
    const candidate = structuredClone(full); change(candidate);
    assert.throws(() => readProductComparisonDetails({ product: candidate }, full.id), /could not be loaded/);
  };
  invalid(product => { product.id = "another-model"; });
  invalid(product => { product.technicalSpecs[0].sourceUrl = "javascript:alert(1)"; });
  invalid(product => { product.sources[0].url = "data:text/html,anything"; });
  invalid(product => { product.ratings[0].score = 6; });
  invalid(product => { product.ratings[0].measurement.value = "250"; });
  invalid(product => { product.image.src = "https://untrusted.example/photo.webp"; });
  assert.throws(() => readProductComparisonDetails({ product: null }, full.id), /could not be loaded/);
});

test("one authoritative builder preserves the existing common-rise heating calculation", () => {
  for (const option of catalogue["hot-water"]) {
    const full = buildProductComparisonItem(option, "hot-water");
    const figures = { ...option.measurements, ...hotWaterComparisonMeasurements(option.hotWaterPerformance, option.name, option.checkedAt) };
    assert.deepEqual(full.ratings, productRatingMethods("hot-water").map(method => calculateProductRating(method, figures[method.id], method.id === "noise" || method.id === "recovery" ? undefined : option.measurementGaps?.[method.id])));
  }
});
