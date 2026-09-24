import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createServer } from "vite";

let server;
const modules = new Map();
const source = fs.readFileSync(new URL("../src/components/CreditexGovernedProgramCalculator.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
before(async () => {
  server = await createServer({ appType: "custom", configFile: false, logLevel: "silent", resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true } });
  for (const name of ["creditex-nsw-program-catalogue", "creditex-veu-calculator-catalogue", "creditex-veu-postcode-resolver", "creditex-official-product-registry"]) {
    modules.set(`@/lib/${name}`, await server.ssrLoadModule(`/src/lib/${name}.ts`));
  }
});
after(async () => server?.close());

const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function control(tree, label, type = "input") {
  const container = nodes(tree, node => node.type === "label" && text(node.props.children).trim().startsWith(label))[0];
  assert.ok(container, `${label} is shown`);
  const target = nodes(container, node => node.type === type)[0];
  assert.ok(target, `${label} has a ${type}`); return target;
}
const checkbox = tree => control(tree, "Use default heating and cooling");
const change = (h, tree, label, value) => { control(tree, label).props.onChange({ target: { value } }); return h.render(); };
const product = (id, heating = "10.5", cooling = "9") => ({
  id, registryCode: "veu-approved-products", snapshotId: "test-current-snapshot", approvalStatus: "approved", sourceSha256: "a".repeat(64),
  productKind: "veu_air_conditioner", brand: "Test brand", manufacturer: "", model: id, series: "", certificateNumber: "", registrationNumber: id,
  eligibleFrom: "2026-07-01", eligibleTo: "", attributes: {
    veuProductCategoryNumber: "6B(i)", veuProductConfiguration: "Multi Split", veuProductConfigurationClass: "multi", refrigerantType: "R-32",
    ratedHeatingCapacityKw: heating, ratedCoolingCapacityKw: cooling,
    gemsHspfColdResidential: 4, gemsTcspfColdResidential: 5, gemsHspfMixedResidential: 4, gemsTcspfMixedResidential: 5,
    gemsHspfColdCommercial: 4, gemsTcspfColdCommercial: 5, gemsHspfMixedCommercial: 4, gemsTcspfMixedCommercial: 5,
  },
});

function harness() {
  const state = [], requests = [], invalidations = []; let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useMemo(factory) { return factory(); }, useCallback(callback) { return callback; },
    useReducer(reducer, initial, initialize) { const i = cursor++; if (!(i in state)) state[i] = initialize ? initialize(initial) : initial; return [state[i], action => { state[i] = reducer(state[i], action); }]; },
  };
  const exports = {};
  Function("require", "exports", compiled)(id => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "@/lib/date-picker") return { todayIso: () => "2026-09-24" };
    if (id === "./CreditexOfficialProductPicker") return { CreditexOfficialProductPicker: "product-picker", creditexProductOptionLabel: value => value.model };
    if (id.endsWith(".module.css")) return { default: {} };
    if (modules.has(id)) return modules.get(id);
    throw Error(`Unexpected dependency ${id}`);
  }, exports);
  const api = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { estimate: null }; };
  const render = () => {
    cursor = 0;
    const component = exports.CreditexGovernedProgramCalculator({ api, programCode: "VEU", onEstimateInvalidated: () => invalidations.push(true) });
    return component.type(component.props);
  };
  const choose = (tree, selected) => { nodes(tree, node => node.type === "product-picker" && node.props.kind === "veu_air_conditioner")[0].props.onSelect(selected?.id || "", selected); return render(); };
  const submit = async tree => { await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); return render(); };
  let initial = render(); control(initial, "Activity", "select").props.onChange({ target: { value: "6" } }); initial = render();
  return { render, choose, submit, requests, invalidations, exports, initial };
}

test("Part 6 defaults use the selected model ratings in kW without inventing an indoor-unit record", async () => {
  const h = harness(); let tree = h.choose(h.initial, product("MODEL-A"));
  assert.equal(checkbox(tree).props.checked, true);
  assert.match(text(tree), /10\.5\s+kW heating and\s+9\s+kW cooling/);
  assert.match(text(tree), /quote assumes this full capacity is connected/);
  assert.equal(nodes(tree, node => node.type === "legend" && text(node) === "Indoor unit 1").length, 0);
  await h.submit(tree);
  const body = h.requests.at(-1).body;
  assert.equal(body.estimatePurpose, "quote"); assert.equal(body.selectedProductIds.veu_air_conditioner, "MODEL-A");
  assert.equal(body.inputs.rated_heating_capacity_kw, "10.5"); assert.equal(body.inputs.rated_cooling_capacity_kw, "9");
  assert.ok(!("indoor_units" in body.inputs));
  assert.ok(!("outdoor_heating_capacity_kw" in body.inputs), "outdoor ratings remain server-derived from the selected official product");
});

test("changing the selected product immediately updates checked defaults and the request", async () => {
  const h = harness(); let tree = h.choose(h.initial, product("MODEL-A"));
  tree = h.choose(tree, product("MODEL-B", "15", "12.5"));
  assert.equal(checkbox(tree).props.checked, true); assert.match(text(tree), /15\s+kW heating and\s+12\.5\s+kW cooling/);
  await h.submit(tree);
  const body = h.requests.at(-1).body;
  assert.equal(body.selectedProductIds.veu_air_conditioner, "MODEL-B");
  assert.equal(body.inputs.rated_heating_capacity_kw, "15"); assert.equal(body.inputs.rated_cooling_capacity_kw, "12.5");
});

test("unticking permits lower indoor capacities and preserves manual entries across defaults and model changes", async () => {
  const h = harness(); let tree = h.choose(h.initial, product("MODEL-A"));
  checkbox(tree).props.onChange({ target: { checked: false } }); tree = h.render();
  assert.equal(control(tree, "Heating capacity each (kW)").props.value, "10.5");
  tree = change(h, tree, "Heating capacity each (kW)", "6"); tree = change(h, tree, "Cooling capacity each (kW)", "5");
  tree = change(h, tree, "Indoor model (optional)", "ACTUAL-INDOOR");
  await h.submit(tree);
  assert.deepEqual(h.requests.at(-1).body.inputs.indoor_units, [{ label: "", model: "ACTUAL-INDOOR", quantity: "1", heatingCapacityKw: "6", coolingCapacityKw: "5" }]);
  assert.ok(!("rated_heating_capacity_kw" in h.requests.at(-1).body.inputs));
  tree = h.render(); checkbox(tree).props.onChange({ target: { checked: true } }); tree = h.render();
  tree = h.choose(tree, product("MODEL-B", "15", "12.5")); await h.submit(tree);
  assert.equal(h.requests.at(-1).body.inputs.rated_heating_capacity_kw, "15");
  tree = h.render(); checkbox(tree).props.onChange({ target: { checked: false } }); tree = h.render();
  assert.equal(control(tree, "Heating capacity each (kW)").props.value, "6");
  assert.equal(control(tree, "Cooling capacity each (kW)").props.value, "5");
  assert.equal(control(tree, "Indoor model (optional)").props.value, "ACTUAL-INDOOR");
  tree = h.choose(tree, product("MODEL-C", "8", "7"));
  assert.equal(checkbox(tree).props.checked, false); assert.equal(control(tree, "Heating capacity each (kW)").props.value, "6");
  assert.ok(h.invalidations.length >= 8, "capacity and product changes invalidate the old result");
});

test("missing ratings fall back to blank manual fields and never submit arbitrary capacity defaults", async () => {
  const h = harness(); let tree = h.choose(h.initial, product("UNRATED", null, "9"));
  assert.equal(checkbox(tree).props.checked, false); assert.equal(checkbox(tree).props.disabled, true);
  assert.match(text(tree), /ratings are unavailable/);
  assert.equal(control(tree, "Heating capacity each (kW)").props.value, ""); assert.equal(control(tree, "Cooling capacity each (kW)").props.value, "");
  assert.equal(nodes(tree, node => node.type === "button" && node.props.type === "submit")[0].props.disabled, true);
  tree = await h.submit(tree); assert.equal(h.requests.length, 0); assert.match(text(tree), /Enter the quantity, heating and cooling capacity/);
  tree = h.choose(tree, product("RATED", "11", "10")); assert.equal(checkbox(tree).props.checked, true);
  await h.submit(tree); assert.equal(h.requests.at(-1).body.inputs.rated_heating_capacity_kw, "11");
});

test("product default capacities reject invalid or unrelated source values", () => {
  const { exports } = harness();
  assert.deepEqual(exports.creditexPart6ProductCapacityDefaults(product("VALID", 10.5, " 9.25 ")), { heatingCapacityKw: "10.5", coolingCapacityKw: "9.25" });
  for (const value of [null, undefined, "", "NaN", "Infinity", Infinity, -1, 0, true, "10 kW", "0x10"]) {
    const invalid = product("INVALID"); invalid.attributes.ratedHeatingCapacityKw = value;
    assert.equal(exports.creditexPart6ProductCapacityDefaults(invalid), null, String(value));
  }
  assert.equal(exports.creditexPart6ProductCapacityDefaults(null), null);
  assert.equal(exports.creditexPart6ProductCapacityDefaults({ ...product("OTHER"), productKind: "air_conditioner" }), null);
});
