import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { nextProductComparisonSort, productComparisonSortLabel, sortProductComparisons } from "../src/components/product-comparison-sort.ts";

function rating(id, value, unit, score = value === null ? null : 3) {
  return { id, label: id, score, measurement: value === null ? null : { value, unit, basisId: "verified-basis", variant: "Exact model", basis: "Verified test", sourceUrl: "https://example.com/spec", checkedAt: "2026-10-12" }, reason: score === null ? "Not comparable" : null };
}
function product(id, capacity, warranty, extra = {}) {
  return { id, name: id, brand: "Maker", image: { src: "/photo.webp", alt: id, sourceUrl: "https://example.com/photo" }, pros: ["Verified benefit."], cons: [], sources: [], checkedAt: "2026-10-12", technicalSpecs: [{ label: "Connection", value: "Single phase", sourceUrl: "https://example.com/spec" }], freshness: { generation: "Current", released: null, sourceUrl: "https://example.com/model", note: "Current model" }, ratings: [rating("capacity", capacity, "tank-litres"), rating("warranty", warranty, "included-product-years")], ...extra };
}
const ids = values => values.map(value => value.id);

test("each sort starts with the useful direction and clicking it again reverses", () => {
  assert.deepEqual(nextProductComparisonSort({criterion: "name", direction: "ascending"}, "noise"), {criterion: "noise", direction: "ascending"});
  assert.deepEqual(nextProductComparisonSort({criterion: "noise", direction: "ascending"}, "noise"), {criterion: "noise", direction: "descending"});
  assert.deepEqual(nextProductComparisonSort({criterion: "noise", direction: "descending"}, "recovery"), {criterion: "recovery", direction: "descending"});
  assert.equal(productComparisonSortLabel({id: "recovery", label: "Reheating speed"}, "ascending"), "Reheating: slowest");
});

test("sorts by the actual measurement rather than rounded bar scores and retains missing values last", () => {
  const products = [product("A", 270, 5), product("B", 200, 10), product("C", null, null), product("D", 250, 7), product("E", 300, 0, {ratings: [rating("capacity", 300, "tank-litres", null)]})];
  const original = structuredClone(products);
  assert.deepEqual(ids(sortProductComparisons(products, "", {criterion: "capacity", direction: "descending"})), ["A", "D", "B", "C", "E"]);
  assert.deepEqual(ids(sortProductComparisons(products, "", {criterion: "capacity", direction: "ascending"})), ["B", "D", "A", "C", "E"]);
  assert.deepEqual(products, original);
});

test("noise puts lower dB first and recovery sorts by the conservative endpoint without replacing source ranges", () => {
  const range = rating("recovery", 67.5, "recovery-litres-per-hour"); range.measurement.valueMaximum = 90;
  const products = [product("first", 250, 5, {ratings:[rating("noise", 45, "published-noise-db"), range]}), product("second", 250, 5, {ratings:[rating("noise", 35, "published-noise-db"),rating("recovery", 75, "recovery-litres-per-hour")]}), product("unknown", 250, 5, {ratings: []})];
  assert.deepEqual(ids(sortProductComparisons(products, "", {criterion:"noise", direction:"ascending"})), ["second","first","unknown"]);
  assert.deepEqual(ids(sortProductComparisons(products, "", {criterion:"noise", direction:"descending"})), ["first","second","unknown"]);
  assert.deepEqual(ids(sortProductComparisons(products, "", {criterion:"recovery", direction:"descending"})), ["second","first","unknown"]);
  assert.equal(range.measurement.valueMaximum, 90);
});

test("search keeps all matching models, and name ordering is numeric, case insensitive and stable", () => {
  const products = [product("model10", 250, 5, {name:"Model 10", brand:"ALPHA"}), product("model2", 250, 5, {name:"model 2", brand:"Alpha"}), product("other", 300, 10, {brand:"Beta"})];
  assert.deepEqual(ids(sortProductComparisons(products, " alpha ", {criterion:"name", direction:"ascending"})), ["model2","model10"]);
  assert.deepEqual(ids(sortProductComparisons(products, "single PHASE", {criterion:"capacity", direction:"descending"})), ["other","model10","model2"]);
  assert.deepEqual(ids(sortProductComparisons(products, "missing", {criterion:"name", direction:"ascending"})), []);
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
  "./product-comparison-sort": { nextProductComparisonSort, productComparisonSortLabel, sortProductComparisons },
  "./ProductRebateChecker": {
    useProductRebateCheck: category => ({ category }),
    ProductRebateChecker: ({ check }) => jsx.jsx("section", { "data-rebate-category": check.category }),
    ProductRebateResult: ({ product }) => jsx.jsx("section", { "data-product-rebates": product.id }),
  },
}).ProductComparisonBrowser;

test("SSR shows immediate cards and disabled one-click sorting without dropdown filters", () => {
  const products = [product("first", 250, 5), product("second", 300, 10)];
  const html = renderToStaticMarkup(jsx.jsx(Browser, { category: "hot-water", products, methods }));
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.match(html, /aria-label="Sort products"/);
  assert.match(html, /aria-pressed="true" disabled="">A to Z/);
  assert.match(html, /aria-pressed="false" disabled="">Tank size: largest/);
  assert.match(html, /Warranty: longest/);
  assert.match(html, /Click the same choice to reverse/);
  assert.doesNotMatch(html, /<select|Reset filters|Filter by product|Overall|Best product|Cost level/);
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
  assert.match(html, /disabled="">Noise: quietest/);
  assert.match(html, /disabled="">Reheating: fastest/);
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
