import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/TradeRecordMap.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("TradeRecordMap.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refreshEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect"
    && node.arguments[0]?.getText(tree).includes('"visibilitychange"')) refreshEffect = node;
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(refreshEffect, "The map must observe saved results without owning address processing");
const callback = ts.transpileModule(`const effect = ${refreshEffect.arguments[0].getText(tree)}; effect;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function fixture(overrides = {}) {
  const timers = new Map();
  const listeners = new Map();
  let nextTimer = 0;
  let refreshes = 0;
  const document = {
    visibilityState: "visible",
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const context = {
    config: { gnaf: { ready: true } }, data: { pending: 2000 }, loading: false, designOpen: false,
    dataError: null, requestKey: "owner-a:customers:1", document,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setRefresh: update => { refreshes = update(refreshes); },
    ...overrides,
  };
  const cleanup = vm.runInNewContext(callback, context)();
  return {
    timers, listeners, cleanup, get refreshes() { return refreshes; },
    visibility: value => { document.visibilityState = value; listeners.get("visibilitychange")?.(); },
    tick: () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); },
  };
}

test("pending locations refresh only saved map results after a bounded delay", () => {
  const f = fixture();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 8000);
  assert.equal(f.refreshes, 0);
  f.tick();
  assert.equal(f.refreshes, 1);
  assert.equal(f.timers.size, 0, "A completed GET must schedule the next refresh, never an overlapping interval");
  f.cleanup();
  assert.equal(f.listeners.size, 0);
});

test("completed, unavailable, loading, failed and design views do not poll", () => {
  for (const overrides of [
    { data: null }, { data: { pending: 0 } }, { config: null }, { config: { gnaf: { ready: false } } },
    { loading: true }, { designOpen: true }, { dataError: { request: "owner-a:customers:1" } },
  ]) {
    const f = fixture(overrides);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.refreshes, 0);
  }
  const nextView = fixture({ dataError: { request: "owner-a:jobs:previous" } });
  assert.equal(nextView.timers.size, 1, "A failed previous query must not block the new view");
  nextView.cleanup();
});

test("hidden tabs suspend refreshes and clean up on navigation or business changes", () => {
  const f = fixture();
  f.visibility("hidden");
  assert.equal(f.timers.size, 0);
  f.visibility("visible");
  assert.equal(f.timers.size, 1);
  assert.equal(f.refreshes, 0, "Returning to the tab does not start an immediate request storm");
  f.cleanup();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
  f.visibility("visible");
  assert.equal(f.timers.size, 0);
  assert.match(refreshEffect.arguments[1].getText(tree), /requestKey/);
});

test("the customer map has no manual preparation controls or provider implementation copy", () => {
  assert.doesNotMatch(source, /locate_map_records|Start locating addresses|Pause lookups|Retry address lookup|Keep this map open|per-address Google|directory is being prepared|when you start processing/);
  assert.match(source, /Updating locations…/);
  assert.match(source, /Address data licence/);
  assert.match(source, /response\.status === 401 \|\| response\.status === 403[\s\S]*?setDataset\(null\); setSelection\(null\)/);
});

test("customer maps preserve cooperative scrolling on desktop and touch devices", () => {
  let options;
  function findMap(node) {
    if (ts.isNewExpression(node) && node.expression.getText(tree) === "api.Map") options = node.arguments[0];
    ts.forEachChild(node, findMap);
  }
  findMap(tree);
  assert.ok(options, "Exercise the options passed to the actual map constructor");
  for (const finePointer of [true, false]) {
    const configured = vm.runInNewContext(`(${options.getText(tree)})`, {
      config: { apiKey: "test-key" }, canvas: {}, style: () => "test-style",
      window: { matchMedia: () => ({ matches: finePointer }) },
    });
    assert.equal(configured.cooperativeGestures, true, "Page scrolling must not zoom either pointer mode");
    assert.equal(configured.fullscreenControl, true);
    assert.equal(configured.scaleControl, true);
    assert.equal(configured.dragRotate, false);
  }
  const roofMap = readFileSync(new URL("../src/components/TradeRoofDesignMap.tsx", import.meta.url), "utf8");
  assert.match(roofMap, /gestureHandling: "cooperative"/, "Both map providers must require modified scrolling");
});
