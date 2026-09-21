import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexFieldFormMasters.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const catalogue = [
  { activityTemplateId: "veu-6", programCode: "VEU", activityCode: "6", title: "Heating and cooling" },
  { activityTemplateId: "sres-pv", programCode: "SRES", activityCode: "PV", title: "Solar panels" },
];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ canAuthor = true, respond = async () => ({ catalogue }) } = {}) {
  const state = [], effects = [], requests = [], signals = []; let cursor = 0, mounted = true, lateStateWrites = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { if (!mounted) lateStateWrites++; state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) state[i] = { deps, callback }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) { state[i]?.cleanup?.(); state[i] = { deps }; effects.push(() => { state[i].cleanup = callback(); }); } },
  };
  const api = async (path, init) => { requests.push(path); signals.push(init?.signal); return respond(path, init); };
  const exports = {};
  Function("require", "exports", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: {} } : (() => { throw Error(id); })(), exports);
  const render = () => { cursor = 0; const tree = exports.CreditexFieldFormMasters({ api, actorMode: "admin", canAuthor }); effects.splice(0).forEach(run => run()); return tree; };
  return { requests, signals, render, get lateStateWrites() { return lateStateWrites; }, unmount() { mounted = false; for (const slot of state) slot?.cleanup?.(); }, async mount() { render(); await flush(); return render(); } };
}

test("authorised users get a searchable activity selector without opening another library", async () => {
  const h = harness(); let tree = await h.mount();
  assert.deepEqual(h.requests, ["/api/trade-activity-forms?view=masters&actorMode=admin"]);
  assert.match(text(tree), /Heating and cooling/); assert.match(text(tree), /Solar panels/);
  nodes(tree, node => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value: "solar" } });
  tree = h.render();
  assert.match(text(tree), /Solar panels/); assert.doesNotMatch(text(tree), /Heating and cooling/);
  assert.equal(h.requests.length, 1, "search stays local to the loaded catalogue");
});

test("read-only identities do not request the protected master catalogue", async () => {
  const h = harness({ canAuthor: false }); const tree = await h.mount();
  assert.equal(h.requests.length, 0);
  assert.equal(nodes(tree, node => node.type === "select").length, 0);
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Refresh forms")[0].props.disabled, true);
});

test("failed automatic loading shows the error and allows an explicit refresh", async () => {
  let attempts = 0;
  const h = harness({ respond: async () => { if (++attempts === 1) throw Error("Forms temporarily unavailable"); return { catalogue }; } });
  let tree = await h.mount(); assert.match(text(tree), /Forms temporarily unavailable/);
  nodes(tree, node => node.type === "button" && text(node) === "Refresh forms")[0].props.onClick();
  tree = h.render();
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Loading forms...")[0].props.disabled, true);
  await flush(); tree = h.render();
  assert.match(text(tree), /Heating and cooling/); assert.doesNotMatch(text(tree), /Forms temporarily unavailable/);
  assert.equal(h.requests.length, 2);
});

test("initial loading is visible and an unmounted catalogue request cannot update state", async () => {
  let resolveRequest;
  const h = harness({ respond: () => new Promise(resolve => { resolveRequest = resolve; }) });
  const tree = h.render();
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Loading forms...")[0].props.disabled, true);
  assert.equal(h.signals[0].aborted, false);
  h.unmount();
  assert.equal(h.signals[0].aborted, true);
  resolveRequest({ catalogue });
  await flush();
  assert.equal(h.lateStateWrites, 0);
});
