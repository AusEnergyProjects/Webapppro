import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexOfficialProductPicker.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const select = (tree, label) => nodes(nodes(tree, node => node.type === "label" && text(node).trim().startsWith(label))[0], node => node.type === "select")[0];
const row = (snapshotId = "snapshot-a", heating = 10) => ({ id: "official:6:source-row", snapshotId, sourceSha256: snapshotId === "snapshot-a" ? "a".repeat(64) : "b".repeat(64),
  registryCode: "veu-approved-products", productKind: "veu_air_conditioner", brand: "Brand A", model: "Model A", manufacturer: "", series: "", registrationNumber: "source-row", certificateNumber: "",
  eligibleFrom: "2026-07-01", eligibleTo: "", approvalStatus: "approved", attributes: { ratedHeatingCapacityKw: heating } });
function response({ status = "stale", products = [row()], checkedAt = "2026-09-01T00:00:00Z" } = {}) {
  return { registry: { status, lastCheckedAt: checkedAt, snapshotId: products[0]?.snapshotId || "snapshot-b" }, products,
    matchCount: products.length, facets: { brands: ["Brand A", "Brand B"], models: ["Model A"], productTypes: [] } };
}

function harness(respond = async () => response()) {
  const state = [], effects = [], timers = new Map(), calls = [], selections = [];
  let now = 0, sequence = 0, cursor = 0, dirty = false, mounted = true, lateWrites = 0, tree;
  const pending = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { if (!mounted) lateWrites++; const next = typeof value === "function" ? value(state[i]) : value; if (next !== state[i]) { state[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((value, index) => value !== state[i].deps[index])) state[i] = { callback, deps }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!effects[i] || deps.some((value, index) => value !== effects[i].deps[index])) { effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const window = { setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, time: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const exports = {};
  Function("require", "exports", "window", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: {} } : { officialProductKindLabel: () => "Approved air conditioner" }, exports, window);
  const props = { kind: "veu_air_conditioner", installationDate: "2026-09-24", veuActivityCode: "6", selectedId: "", api: async (...args) => { calls.push(args); return respond(...args); }, onSelect: (id, product) => { selections.push({ id, product }); props.selectedId = id; dirty = true; } };
  const render = () => { cursor = 0; dirty = false; tree = exports.CreditexOfficialProductPicker(props); pending.splice(0).forEach(run => run()); return tree; };
  async function settle() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty && mounted) render(); } return tree; }
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, value]) => value.time <= until).sort((a, b) => a[1].time - b[1].time)[0];
      if (!entry) break;
      now = entry[1].time; timers.delete(entry[0]); entry[1].callback(); await settle();
    }
    now = until; return settle();
  }
  render();
  return { calls, selections, props, timers, advance, settle, render, get tree() { return tree; }, get lateWrites() { return lateWrites; },
    async choose(label, value) { select(tree, label).props.onChange({ target: { value } }); render(); return advance(0); },
    unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("stale accepted listings recheck after 30 seconds and stop once the registry is current", async () => {
  let status = "stale"; const h = harness(async () => response({ status }));
  await h.advance(0); assert.equal(h.calls.length, 1); assert.match(text(h.tree), /checked 1 Sept? 2026/);
  await h.advance(29_999); assert.equal(h.calls.length, 1);
  status = "current"; await h.advance(1); assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0); assert.doesNotMatch(text(h.tree), /last accepted official product snapshot/);
  await h.advance(90_000); assert.equal(h.calls.length, 2);
});

test("a refreshed snapshot preserves the source product selection and publishes its updated ratings", async () => {
  let result = response(); const h = harness(async () => result);
  await h.advance(0); await h.choose("Brand", "Brand A"); await h.choose("Model", "Model A");
  assert.equal(h.props.selectedId, row().id); const before = h.selections.length;
  await h.advance(30_000); assert.equal(h.selections.length, before, "an unchanged stale snapshot does not repeat selection callbacks");
  result = response({ status: "current", products: [row("snapshot-b", 12)] }); await h.advance(30_000);
  assert.equal(h.props.selectedId, row().id); assert.equal(h.selections.length, before + 1);
  assert.equal(h.selections.at(-1).product.snapshotId, "snapshot-b"); assert.equal(h.selections.at(-1).product.attributes.ratedHeatingCapacityKw, 12);
  assert.equal(select(h.tree, "Brand").props.value, "Brand A"); assert.equal(select(h.tree, "Model").props.value, "Model A"); assert.equal(h.timers.size, 0);
});

test("refresh clears an ineligible selected source row without choosing a different approval", async () => {
  let result = response(); const h = harness(async () => result);
  await h.advance(0); await h.choose("Brand", "Brand A"); await h.choose("Model", "Model A");
  result = response({ status: "current", products: [{ ...row("snapshot-b"), id: "different-source-row" }] }); await h.advance(30_000);
  assert.equal(h.props.selectedId, ""); assert.deepEqual(h.selections.at(-1), { id: "", product: null });
});

test("filter changes cancel stale timers and unmount ignores a pending response", async () => {
  let pending;
  let defer = false;
  const h = harness(async () => defer ? new Promise(resolve => { pending = resolve; }) : response());
  await h.advance(0); assert.equal(h.timers.size, 1);
  await h.advance(20_000); await h.choose("Brand", "Brand A"); const count = h.calls.length;
  await h.advance(10_000); assert.equal(h.calls.length, count, "the old filter timer was cancelled");
  defer = true; await h.advance(20_000); assert.equal(h.calls.length, count + 1);
  assert.equal(h.tree.props["aria-busy"], false, "a background recheck does not disable the picker");
  h.unmount(); pending(response()); await h.settle();
  assert.equal(h.timers.size, 0); assert.equal(h.lateWrites, 0);
});

test("a failed background recheck shows the real failure and does not schedule an error loop", async () => {
  let fail = false; const h = harness(async () => { if (fail) throw new Error("Registry request unavailable"); return response(); });
  await h.advance(0); fail = true; await h.advance(30_000);
  assert.match(text(h.tree), /Registry request unavailable/); assert.equal(h.timers.size, 0); assert.equal(h.tree.props["aria-busy"], false);
  await h.advance(90_000); assert.equal(h.calls.length, 2);
});
