import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { filterProductComparisons, productComparisonFilterOptions } from "../src/components/product-comparison-filters.ts";

function rating(id, value, unit, score = value === null ? null : 3) {
  return { id, label: id, score, measurement: value === null ? null : { value, unit, basisId: "verified-basis", variant: "Exact model", basis: "Verified test", sourceUrl: "https://example.com/spec", checkedAt: "2026-10-12" }, reason: score === null ? "Not comparable" : null };
}
function product(id, capacity, warranty, extra = {}) {
  return { id, name: id, brand: "Maker", image: { src: "/photo.webp", alt: id, sourceUrl: "https://example.com/photo" }, pros: ["Verified benefit."], cons: [], sources: [], checkedAt: "2026-10-12", technicalSpecs: [{ label: "Connection", value: "Single phase", sourceUrl: "https://example.com/spec" }], freshness: { generation: "Current", released: null, sourceUrl: "https://example.com/model", note: "Current model" }, ratings: [rating("capacity", capacity, "tank-litres"), rating("warranty", warranty, "included-product-years")], ...extra };
}
const baseFilters = { query: "", brand: "", figureLimits: {} };
const ids = values => values.map(value => value.id);

test("Any includes unknown figures while minimum filters require the bar's verified measurement", () => {
  const products = [product("published", 250, 5), product("missing", null, 10), product("different-test", 999, 20, { ratings: [rating("capacity", 999, "tank-litres", null), rating("warranty", 20, "included-product-years")] })];
  assert.deepEqual(ids(filterProductComparisons(products, baseFilters)), ["published", "missing", "different-test"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: 200 } })), ["published"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { warranty: 10 } })), ["missing", "different-test"]);
});

test("inclusive actual-number cutoffs combine independently rather than producing an overall ranking", () => {
  const products = [product("below", 249.9, 5), product("boundary", 250, 4), product("both", 300, 10), product("zero", 0, 0, { ratings: [rating("capacity", 0, "tank-litres", 0), rating("warranty", 0, "included-product-years", 0)] })];
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: 250 } })), ["boundary", "both"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: 250, warranty: 5 } })), ["both"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: 0, warranty: 0 } })), ids(products), "a verified zero remains a real number");
  for (const minimum of [NaN, Infinity, -1]) assert.deepEqual(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: minimum } }), []);
});

test("search, brand and figure filters preserve order and never mutate products or their bar values", () => {
  const products = [product("first", 300, 5, { name: "Model A", brand: "Alpha" }), product("second", 300, 10, { name: "Model B", brand: "Beta" }), product("third", 200, 5, { name: "Model C", brand: "Alpha" })];
  const original = structuredClone(products);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, query: "  single PHASE  ", brand: "Alpha", figureLimits: { capacity: 250 } })), ["first"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, query: "MODEL" })), ["first", "second", "third"]);
  assert.deepEqual(products, original);
});

test("filter options use actual units and verified limits, excluding unknown or mixed measurements", () => {
  const products = [product("small", 200, 5), product("large", 300, 10), product("unknown", 900, 99, { ratings: [rating("capacity", 900, "tank-litres", null), rating("warranty", 99, "included-product-years", null)] })];
  assert.deepEqual(productComparisonFilterOptions(products, "capacity"), [180, 200, 250, 300].map(value => ({ value, label: `At least ${value} litres` })));
  assert.deepEqual(productComparisonFilterOptions(products, "warranty"), [2, 5, 10].map(value => ({ value, label: `At least ${value} years` })));
  assert.deepEqual(productComparisonFilterOptions([product("unknown", null, null)], "capacity"), []);
  assert.deepEqual(productComparisonFilterOptions([...products, product("wrong-unit", 300, 5, { ratings: [rating("capacity", 300, "nominal-litres")] })], "capacity"), []);
  for (const score of [NaN, -1, 6]) assert.deepEqual(productComparisonFilterOptions([product("invalid", 300, 5, { ratings: [rating("capacity", 300, "tank-litres", score)] })], "capacity"), []);
});

test("every current category measure has plain unit labels without treating charging power or capacity as efficiency", () => {
  for (const [id, unit, value, label] of [
    ["efficiency", "panel-efficiency-percent", 25, "At least 25%"],
    ["efficiency", "peak-efficiency-percent", 99, "At least 99%"],
    ["capacity", "usable-kwh", 20, "At least 20 kWh"],
    ["capacity", "tank-litres", 300, "At least 300 litres"],
    ["efficiency", "zoned-heating-stars", 5, "At least 5 heating stars"],
    ["capacity", "cooling-kw", 15, "At least 15 kW"],
    ["chargingPower", "ev-ac-kw", 22, "At least 22 kW"],
    ["recovery", "recovery-litres-per-hour", 150, "At least 150 litres per hour"],
    ["noise", "published-noise-db", 35, "Up to 65 dB"],
  ]) {
    const options = productComparisonFilterOptions([product("exact", 300, 5, { ratings: [rating(id, value, unit)] })], id);
    assert.equal(options.at(-1).label, label);
  }
});

test("noise uses an inclusive maximum dB limit and retains a verified zero score at 65 dB", () => {
  const products = [
    product("quieter", 250, 5, { ratings: [rating("noise", 35, "published-noise-db", 5)] }),
    product("boundary", 250, 5, { ratings: [rating("noise", 65, "published-noise-db", 0)] }),
    product("above", 250, 5, { ratings: [rating("noise", 65.1, "published-noise-db", 0)] }),
    product("unknown", 250, 5, { ratings: [rating("noise", null, "published-noise-db")] }),
  ];
  assert.deepEqual(ids(filterProductComparisons(products, baseFilters)), ids(products));
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { noise: 65 } })), ["quieter", "boundary"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { noise: 40 } })), ["quieter"]);
  assert.equal(productComparisonFilterOptions(products, "noise")[0].label, "Up to 35 dB");
  assert.deepEqual(productComparisonFilterOptions([products[3]], "noise"), []);
});

test("all four hot-water filters combine using the conservative recovery endpoint and preserve original ranges", () => {
  const range = rating("recovery", 67.5, "recovery-litres-per-hour"); range.measurement.valueMaximum = 90;
  const products = [
    product("exact", 250, 5, { ratings: [rating("capacity", 250, "tank-litres"), rating("noise", 45, "published-noise-db"), rating("recovery", 75, "recovery-litres-per-hour"), rating("warranty", 5, "included-product-years")] }),
    product("range", 270, 5, { ratings: [rating("capacity", 270, "tank-litres"), rating("noise", 42, "published-noise-db"), range, rating("warranty", 5, "included-product-years")] }),
    product("no-published-rate", 300, 5, { ratings: [rating("capacity", 300, "tank-litres"), rating("noise", 40, "published-noise-db"), rating("recovery", null, "recovery-litres-per-hour"), rating("warranty", 5, "included-product-years")] }),
  ];
  const original = structuredClone(products);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { capacity: 250, noise: 45, recovery: 75, warranty: 5 } })), ["exact"]);
  assert.deepEqual(ids(filterProductComparisons(products, { ...baseFilters, figureLimits: { recovery: 50 } })), ["exact", "range"]);
  assert.deepEqual(products, original, "filtering never changes source bounds into averages");
});

function compile(relative, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  Function("require", "exports", source)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exports);
  return exports;
}
const methods = [{ id: "capacity", label: "Tank size", explanation: "Published tank volume" }, { id: "warranty", label: "Parts warranty", explanation: "Main-product parts cover" }];
const Browser = compile("../src/components/ProductComparisonBrowser.tsx", {
  react, "react/jsx-runtime": jsx, "./product-comparison.css": {},
  "./product-comparison-filters": { filterProductComparisons, productComparisonFilterOptions },
  "./ProductRebateChecker": {
    useProductRebateCheck: category => ({ category }),
    ProductRebateChecker: ({ check }) => jsx.jsx("section", { "data-rebate-category": check.category }),
    ProductRebateResult: ({ product }) => jsx.jsx("section", { "data-product-rebates": product.id }),
  },
}).ProductComparisonBrowser;

test("SSR shows immediate cards and disabled real-unit filters with explicit reset controls", () => {
  const products = [product("first", 250, 5), product("second", 300, 10)];
  const html = renderToStaticMarkup(jsx.jsx(Browser, { category: "hot-water", products, methods }));
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.match(html, /aria-label="Filter by product figures"/);
  assert.match(html, /aria-label="Tank size"[^>]*disabled=""/);
  assert.match(html, /aria-label="Parts warranty"[^>]*disabled=""/);
  assert.match(html, /At least 250 litres/);
  assert.match(html, /At least 10 years/);
  assert.match(html, /Reset filters/);
  assert.doesNotMatch(html, /Overall|Best product|Cost level/);
});

test("rebate intake and per-card results use only the three explicit supported category slugs", () => {
  for (const category of ["hot-water", "air-conditioning", "multi-split", "solar", "inverters", "batteries", "ev-chargers"]) {
    const html = renderToStaticMarkup(jsx.jsx(Browser, { category, products: [product("first", 250, 5)], methods }));
    const supported = ["hot-water", "air-conditioning", "multi-split"].includes(category);
    assert.equal((html.match(/data-rebate-category=/g) || []).length, supported ? 1 : 0);
    assert.equal((html.match(/data-product-rebates=/g) || []).length, supported ? 1 : 0);
    if (supported) assert.ok(html.includes(`data-rebate-category="${category}"`));
  }
});

test("four-bar hot-water cards show exact dB and full recovery ranges without duplicate plain stats", () => {
  const range = rating("recovery", 67.5, "recovery-litres-per-hour"); range.label = "Reheating speed"; range.measurement.valueMaximum = 90;
  const exact = product("water-heater", 250, 5, { ratings: [rating("capacity", 250, "tank-litres"), rating("noise", 41, "published-noise-db"), range, rating("warranty", 5, "included-product-years")], hotWaterFacts: { noise: "41 dB", recoveryLabel: "Reheating speed", recovery: "About 67.5 to 90 litres per hour", conditions: "Published test conditions", recoverySourceUrl: "https://example.com/recovery" } });
  const waterMethods = [...methods, { id: "noise", label: "Noise", explanation: "Lower dB" }, { id: "recovery", label: "Reheating speed", explanation: "Published L/h" }];
  const html = renderToStaticMarkup(jsx.jsx(Browser, { category: "hot-water", products: [exact], methods: waterMethods }));
  assert.equal((html.match(/data-rating=/g) || []).length, 4);
  assert.match(html, />41 dB<\/small>/);
  assert.match(html, /67\.5 to 90 litres per hour<\/small>/);
  assert.match(html, /aria-label="Noise"[^>]*disabled=""/);
  assert.match(html, /aria-label="Reheating speed"[^>]*disabled=""/);
  assert.match(html, /Up to 45 dB/);
  assert.match(html, /At least 50 litres per hour/);
  assert.match(html, /For noise, more bars means lower published dB/);
  assert.match(html, /Recovery source/);
  assert.doesNotMatch(html, /<dt>Noise|<dt>Reheating speed|Reheat 100 litres|full.tank/i);
});

test("shared native product menu has identical desktop/mobile destinations without loading catalogue data", () => {
  const { ResponsiveSiteNav } = compile("../src/components/ResponsiveSiteNav.tsx", { "react/jsx-runtime": jsx, "next/link": { default: ({ children, ...props }) => jsx.jsx("a", { ...props, children }) } });
  const html = renderToStaticMarkup(jsx.jsx(ResponsiveSiteNav, { active: "products" }));
  const dropdown = html.split('class="site-nav-category site-nav-products active-category"')[1].split("</details>")[0];
  const mobile = html.split('class="site-nav-mobile-groups"')[1].split("</section>")[0];
  const links = markup => [...markup.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links(dropdown), links(mobile));
  assert.equal(links(dropdown).length, 8);
  assert.match(dropdown, /<summary[^>]*aria-current="true"/);
  assert.match(dropdown, /All products/);
  const source = readFileSync(new URL("../src/components/ResponsiveSiteNav.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import.*product-guides|useState|useEffect|role="menu"/);
});
