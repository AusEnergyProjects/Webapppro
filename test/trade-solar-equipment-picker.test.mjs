import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as equipment from "../src/lib/trade-solar-equipment.ts";

const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/components/TradeSolarEquipmentPicker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const panel = { id: "my-panel", kind: "panel", name: "My 440 W panel", manufacturer: "", model: "P440", watts: 440, widthM: 1.134, lengthM: 1.762, quantity: 1, priceBookItemId: "my-panel" };

function harness({ kind = "inverter", selected, priceBookPanels, responseItems, failed = false } = {}) {
  let cursor = 0, tree;
  const states = [], requests = [], effects = [], choices = [];
  const hooks = {
    useId: () => "equipment-picker",
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = states[index]; if (!previous || dependencies.some((item, i) => item !== previous[i])) { states[index] = dependencies; effects.push(callback); } },
  };
  const exports = {};
  const fetch = async (url, options) => { requests.push({ url, options }); return Response.json(failed ? { ok: false, error: "Price book unavailable" } : { ok: true, equipment: responseItems ?? [{ id: "own-inverter", priceBookItemId: "own-inverter", kind, name: "Own inverter", model: "INV5", manufacturer: "", quantity: 1 }], solarPanels: responseItems ?? [panel] }, { status: failed ? 403 : 200 }); };
  Function("require", "exports", "fetch", "setTimeout", "clearTimeout", compiled)(id => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "@/lib/trade-solar-equipment") return equipment;
    return { default: new Proxy({}, { get: (_, key) => key }) };
  }, exports, fetch, () => 1, () => {});
  const props = { user: { getIdToken: async () => "user-token" }, kind, selected, priceBookPanels, onSelect: item => choices.push(item) };
  const render = () => { cursor = 0; tree = exports.TradeSolarEquipmentPicker(props); return tree; };
  const load = async () => { render(); for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); return render(); };
  return { render, load, requests, choices };
}

test("inverter, battery and hot-water pickers load own counted products and retain exact stock identity", async () => {
  for (const kind of ["inverter", "battery", "hot_water"]) {
    const h = harness({ kind }), tree = await h.load();
    assert.equal(h.requests[0].url, `/api/trade-price-book?mode=solar_equipment&kind=${kind}`);
    assert.equal(h.requests[0].options.headers.Authorization, "Bearer user-token");
    assert.equal(h.requests[0].options.cache, "no-store");
    const select = nodes(tree, node => node.type === "select" && node.props.id === "equipment-picker-pricebook")[0];
    assert.ok(select); assert.equal(select.props.disabled, false);
    select.props.onChange({ target: { value: "own-inverter" } });
    assert.equal(h.choices[0].priceBookItemId, "own-inverter"); assert.equal(h.choices[0].kind, kind);
    assert.equal(h.choices[0].quantity, 1);
  }
});

test("panel picker keeps the existing model endpoint and supplied panel shortcuts", async () => {
  const fetched = harness({ kind: "panel" }); await fetched.load();
  assert.equal(fetched.requests[0].url, "/api/trade-price-book?mode=solar_panels");
  const supplied = harness({ kind: "panel", priceBookPanels: [panel] }), tree = await supplied.load();
  assert.equal(supplied.requests.length, 0);
  nodes(tree, node => node.type === "select" && node.props.id === "equipment-picker-pricebook")[0].props.onChange({ target: { value: panel.id } });
  assert.deepEqual(supplied.choices[0], panel);
});

test("editing linked specifications preserves price-book identity without inventing a new product", async () => {
  const h = harness({ kind: "panel", selected: panel, priceBookPanels: [panel] }); let tree = await h.load();
  nodes(tree, node => node.type === "button" && node.props.children === "Edit selected model")[0].props.onClick(); tree = h.render();
  const width = nodes(tree, node => node.type === "label" && node.props.children?.[0] === "Width (m)")[0].props.children[1];
  width.props.onChange({ target: { value: "1.2" } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.choices[0].priceBookItemId, panel.priceBookItemId);
  assert.equal(h.choices[0].id, panel.id); assert.equal(h.choices[0].widthM, 1.2);
});

test("custom models do not inherit the previous selection's stock link", async () => {
  const h = harness({ selected: { id: "own-inverter", priceBookItemId: "own-inverter", kind: "inverter", name: "Own inverter", model: "INV5", manufacturer: "", quantity: 1 } });
  let tree = await h.load(); nodes(tree, node => node.type === "button" && node.props.children === "Enter a model")[0].props.onClick(); tree = h.render();
  const model = nodes(tree, node => node.type === "label" && node.props.children?.[0] === "Model")[0].props.children[1];
  model.props.onChange({ target: { value: "Custom inverter" } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.choices.length, 1); assert.equal(h.choices[0].priceBookItemId, undefined);
});

test("permission and fetch errors keep own stock options unavailable and explain the error", async () => {
  const h = harness({ failed: true }), tree = await h.load();
  assert.equal(nodes(tree, node => node.type === "select" && node.props.id === "equipment-picker-pricebook").length, 0);
  assert.ok(nodes(tree, node => node.props?.role === "status" && node.props.children === "Price book unavailable").length);
});
