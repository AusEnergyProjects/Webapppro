import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { productComparisonCard, readProductComparisonDetails } from "../src/components/product-comparison-data.ts";
import { nextProductComparisonSort, productComparisonSortLabel, sortProductComparisons } from "../src/components/product-comparison-sort.ts";

const full = {
  id: "exact-panel", name: "Exact panel", brand: "Maker", image: { src: "/products/solar/exact-panel.webp", alt: "Exact panel", sourceUrl: "https://example.com/photo" },
  pros: ["Verified benefit"], cons: [], checkedAt: "2026-10-12", sources: [{ title: "Current specification", url: "https://example.com/spec", kind: "manufacturer", revision: "2026" }],
  technicalSpecs: [{ label: "Power", value: "450 W", sourceUrl: "https://example.com/spec" }],
  freshness: { generation: "Current", released: null, sourceUrl: "https://example.com/product", note: "Current generation" }, ratings: [],
};
const second = { ...full, id: "second-panel", name: "Second panel" };
const cards = [full, second].map(productComparisonCard);

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function find(element, predicate) {
  if (!element || typeof element !== "object") return null;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
function harness() {
  let cursor = 0;
  const hooks = [], cleanup = [], requests = [];
  let sortCalls = 0;
  const hookReact = {
    ...react,
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, value => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useMemo(fn, dependencies) {
      const index = cursor++;
      if (!hooks[index] || dependencies.some((value, position) => !Object.is(value, hooks[index].dependencies[position]))) hooks[index] = { value: fn(), dependencies };
      return hooks[index].value;
    },
    useEffect(fn) { const index = cursor++; if (!hooks[index]) { hooks[index] = { installed: true }; const result = fn(); if (result) cleanup.push(result); } },
    useSyncExternalStore() { return true; },
  };
  const dependencies = {
    react: hookReact, "react/jsx-runtime": jsx, "./product-comparison.css": {},
    "./product-comparison-data": { readProductComparisonDetails },
    "./product-comparison-sort": { nextProductComparisonSort, productComparisonSortLabel, sortProductComparisons(...args) { sortCalls++; return sortProductComparisons(...args); } },
    "./ProductRebateChecker": { useProductRebateCheck: () => ({}), ProductRebateChecker: () => null, ProductRebateResult: () => null },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/ProductComparisonBrowser.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const fetch = (url, options) => { const request = { url, signal: options.signal, ...deferred() }; requests.push(request); return request.promise; };
  Function("require", "exports", "fetch", "window", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exports, fetch, { setTimeout, clearTimeout });
  const dialog = { open: false, showModal() { this.open = true; } };
  function render() {
    cursor = 0;
    const element = exports.ProductComparisonBrowser({ category: "solar", products: cards, methods: [] });
    find(element, element => element.type === "dialog" && element.props["aria-labelledby"] === "product-information-title").props.ref.current = dialog;
    return element;
  }
  const clickSpecs = name => find(render(), element => element.type === "button" && element.props["aria-label"] === `Technical specifications for ${name}`).props.onClick();
  const close = () => { dialog.open = false; find(render(), element => element.type === "dialog" && element.props["aria-labelledby"] === "product-information-title").props.onClose(); };
  return { render, clickSpecs, close, requests, cleanup, dialog, sortCalls: () => sortCalls };
}
const response = product => ({ ok: true, json: async () => ({ product }) });

test("Specs opens immediately, loads only on demand and reuses a successfully checked exact-model response", async () => {
  const app = harness();
  app.render(); assert.equal(app.requests.length, 0);
  const opening = app.clickSpecs(full.name);
  assert.equal(app.dialog.open, true);
  assert.ok(find(app.render(), element => element.props?.role === "status" && element.props.children === "Loading product specifications..."));
  assert.equal(app.requests[0].url, "/api/product-details?productId=exact-panel");
  app.requests[0].resolve(response(full)); await opening;
  assert.equal(find(app.render(), element => element.type === "h2" && element.props.id === "product-information-title").props.children, full.name);
  assert.ok(find(app.render(), element => element.type === "a" && element.props.href === full.image.sourceUrl));
  app.close(); await app.clickSpecs(full.name);
  assert.equal(app.requests.length, 1, "reopening loaded specifications must not repeat the network request");
  assert.equal(app.sortCalls(), 1, "opening, completing and closing a details request must not sort the catalogue again");
  app.close();
});

test("switching models or closing the dialog aborts old work and never displays an older response", async () => {
  const app = harness();
  const first = app.clickSpecs(full.name), next = app.clickSpecs(second.name);
  assert.equal(app.requests[0].signal.aborted, true);
  app.requests[1].resolve(response(second)); await next;
  app.requests[0].resolve(response(full)); await first;
  assert.equal(find(app.render(), element => element.type === "h2" && element.props.id === "product-information-title").props.children, second.name);
  app.close();
  const closing = app.clickSpecs(full.name); app.close();
  assert.equal(app.requests[2].signal.aborted, true);
  app.requests[2].resolve(response(full)); await closing;
  assert.equal(find(app.render(), element => element.type === "h2" && element.props.id === "product-information-title").props.children, undefined);
});

test("a failed or mismatched specification response gives a retry and is never cached", async () => {
  const app = harness();
  const opening = app.clickSpecs(full.name);
  app.requests[0].resolve(response(second)); await opening;
  assert.ok(find(app.render(), element => element.props?.role === "alert"));
  const retry = find(app.render(), element => element.type === "button" && element.props.children === "Try specifications again").props.onClick();
  app.requests[1].resolve(response(full)); await retry;
  assert.equal(find(app.render(), element => element.props?.role === "alert"), null);
  assert.ok(find(app.render(), element => element.type === "a" && element.props.href === full.image.sourceUrl));
  app.close();
});
