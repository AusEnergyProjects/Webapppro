import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as quote from "../src/lib/trade-map-quote.ts";
import * as solarEquipment from "../src/lib/trade-solar-equipment.ts";

const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, component, captureImage, options = {}) {
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let cursor = 0;
  const slots = [], effects = [], pending = [], quoted = [], busy = [], controls = [], events = [], savedInputs = [];
  const react = {
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial; return [slots[id], (value) => { slots[id] = typeof value === "function" ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useMemo(factory, deps) { const id = cursor++; if (!slots[id] || deps.some((value, index) => value !== slots[id].deps[index])) slots[id] = { deps, value: factory() }; return slots[id].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const id = cursor++; if (!effects[id] || deps.some((value, index) => value !== effects[id].deps[index])) { pending.push(() => { effects[id]?.cleanup?.(); effects[id] = { deps, cleanup: callback() }; }); } },
  };
  const panel = { id: 1, center: { lat: -37.8, lng: 144.96 }, widthM: 1.13, lengthM: 1.72, heading: 0, lengthTilt: 22.5, widthTilt: 0 };
  let measurementChanged;
  const drawing = { setEditing() {}, setCapturing(value) { controls.push(value); }, finish() { events.push("finish"); measurementChanged?.({ ...measurement, finished: true }); }, dispose() {} };
  const measurement = { points: 4, areaM2: 162.5, lengthM: 52, previewLengthM: null, crossed: false, finished: true, ...options.measurement };
  const element = { scrollIntoView() {} };
  const map = { getDiv: () => element, setMapTypeId() {}, setTilt() {}, setHeading() {}, getCenter: () => ({ toJSON: () => ({ lat: -37.8, lng: 144.96 }) }), getZoom: () => 20 };
  const savedDesign = { id: "saved-design", revision: 3, workOrderId: "job-one" };
  const persistence = { status: "Saved", error: "", design: null, update(input) { savedInputs.push(input); }, accept() {},
    async ensureSaved() { events.push("ensureSaved"); return options.ensureSaved ? options.ensureSaved() : savedDesign; }, async saveCopy() { return savedDesign; } };
  const require = (id) => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react") return react;
    if (id === "@/lib/trade-map-quote") return quote;
    if (id === "@/lib/trade-solar-equipment") return solarEquipment;
    if (id === "./useTradeSolarDesign") return { useTradeSolarDesign: () => persistence };
    if (id === "@/lib/trade-map-capture") return { captureTradeMapQuoteImage: captureImage, captureTradeMapPng: () => { throw new Error("Quote must not start a download"); } };
    if (id === "@/lib/trade-map-solar") return { DEFAULT_SOLAR_PANEL_SIZE: panel, DEFAULT_SOLAR_PANEL_TILT: panel, createTradeMapSolarLayout(_api, _map, _styles, changed) { changed({ panels: [panel], selectedId: 1, selectedIds: [1], selectionMode: "one" }); return drawing; } };
    if (id === "@/lib/trade-map-measurement") return { EMPTY_MAP_MEASUREMENT: measurement, createTradeMapMeasurement(_api, _map, _mode, changed) { measurementChanged = changed; changed(measurement); return drawing; }, formatMapDistance: (value) => `${value} m` };
    return { default: {}, TradeMapSolarTools: () => null };
  };
  const exports = {};
  Function("require", "exports", "document", "fetch", code)(require, exports, { createElement: () => ({ setAttribute() {} }) }, async () => ({ ok: true, json: async () => ({ ok: true, solarPanels: [] }) }));
  const props = { user: { uid: "owner-one", getIdToken: async () => "test-token" }, api: {}, map, active: true, disabled: false, onCapturing: (value) => busy.push(value), onQuote: (value) => quoted.push(value), onActivate() {}, onClose() {}, onExplore() {}, onMeasuring() {} };
  const render = () => { cursor = 0; const tree = exports[component](props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { render, quoted, controls, busy, element, events, savedInputs };
}

test("solar capture also hides an active measurement's vertex handles", (t) => {
  const h = harness(t, "TradeMapTools", async () => ({ dataUrl: "data:image/png;base64,UE5H" }));
  h.render(); button(h.render(), "Measure").props.onClick(); h.render();
  const solar = nodes(h.render(), (node) => typeof node.props?.onCapturing === "function")[0];
  solar.props.onCapturing(true);
  assert.deepEqual(h.controls, [true]);
  assert.equal(button(h.render(), "Cancel capture"), undefined, "the measurement must not show a cancel control for another tool's capture");
  solar.props.onCapturing(false);
  assert.deepEqual(h.controls, [true, false]);
});

test("an unfinished valid insulation area goes straight to quote and finishes its marked image automatically", async (t) => {
  const image = { dataUrl: "data:image/png;base64,TUFSS0VEX1JPT0Y=" };
  const h = harness(t, "TradeMapTools", async (element, value, prepare, restore) => {
    assert.equal(element, h.element);
    assert.deepEqual(value, { kind: "area", quantity: 162.5 });
    assert.deepEqual(h.events, ["finish"], "finish runs before the marked image is captured");
    prepare(); restore();
    return image;
  }, { measurement: { finished: false } });
  h.render(); button(h.render(), "Measure").props.onClick(); h.render();
  const tree = h.render();
  assert.ok(button(tree, "Finish"), "the drawn area is still unfinished");
  assert.ok(button(tree, "Add to quote"), "a valid area must not require an extra Finish click");
  button(tree, "Add to quote").props.onClick(); await flush();
  assert.deepEqual(h.quoted, [{ kind: "area", quantity: 162.5, roofImage: image }]);
  assert.deepEqual(h.controls, [true, false]);
});

for (const measurement of [{ points: 2, finished: false }, { crossed: true, finished: false }, { areaM2: 0, finished: false }]) {
  test(`invalid area ${JSON.stringify(measurement)} cannot enter the quote or capture pipeline`, (t) => {
    const h = harness(t, "TradeMapTools", () => { throw new Error("Invalid area must not capture"); }, { measurement });
    h.render(); button(h.render(), "Measure").props.onClick(); h.render();
    assert.equal(button(h.render(), "Add to quote"), undefined);
    assert.deepEqual(h.quoted, []); assert.deepEqual(h.events, []);
  });
}

test("solar quote waits for its saved revision before capture and carries the exact design identity", async (t) => {
  let finishSave;
  const h = harness(t, "TradeMapSolarTools", async (_element, value, prepare, restore) => {
    assert.equal(value.designId, "saved-late"); assert.equal(value.designRevision, 7); assert.equal(value.workOrderId, "job-linked");
    prepare(); restore(); return { dataUrl: "data:image/png;base64,UE5H" };
  }, { ensureSaved: () => new Promise((resolve) => { finishSave = resolve; }) });
  h.render(); button(h.render(), "Add to quote").props.onClick(); await flush();
  assert.deepEqual(h.events, ["ensureSaved"]);
  assert.deepEqual(h.controls, [], "capture controls cannot change while design saving is pending");
  assert.deepEqual(h.quoted, []);
  finishSave({ id: "saved-late", revision: 7, workOrderId: "job-linked" }); await flush();
  assert.equal(h.quoted[0].designId, "saved-late");
  assert.equal(h.quoted[0].quantity, 1);
  assert.deepEqual(h.controls, [true, false]);
});

for (const component of ["TradeMapSolarTools", "TradeMapTools"]) {
  const start = (h) => { h.render(); let tree = h.render(); if (component === "TradeMapTools") { button(tree, "Measure").props.onClick(); h.render(); tree = h.render(); } return tree; };

  test(`${component} carries the roof image only after capture and control restoration`, async (t) => {
    let finish;
    const h = harness(t, component, async (element, value, prepare, restore) => {
      assert.equal(element, h.element);
      assert.equal(value.kind, component === "TradeMapSolarTools" ? "solar" : "area");
      prepare(); await new Promise((resolve) => { finish = resolve; }); restore();
      return { dataUrl: "data:image/png;base64,UE5H" };
    });
    button(start(h), "Add to quote").props.onClick();
    assert.deepEqual(h.quoted, [], "no quantity-only quote may open while sharing is pending");
    await flush();
    assert.deepEqual(h.controls, [true]);
    finish(); await flush();
    assert.equal(h.quoted.length, 1);
    assert.equal(h.quoted[0].roofImage.dataUrl, "data:image/png;base64,UE5H");
    assert.deepEqual(h.controls, [true, false]);
  });

  test(`${component} preserves the design and does not open a quote when capture fails`, async (t) => {
    const h = harness(t, component, async () => { throw new Error("Choose this TLink tab."); });
    button(start(h), "Add to quote").props.onClick(); await flush();
    const tree = h.render();
    assert.deepEqual(h.quoted, []);
    assert.match(text(tree), /Choose this TLink tab/);
    assert.equal(button(tree, "Add to quote").props.disabled, false);
  });

  test(`${component} ignores a late image after the user cancels capture`, async (t) => {
    let finish;
    const h = harness(t, component, () => new Promise((resolve) => { finish = () => resolve({ dataUrl: "data:image/png;base64,UE5H" }); }));
    button(start(h), "Add to quote").props.onClick();
    await flush();
    button(h.render(), "Cancel capture").props.onClick();
    finish(); await flush();
    assert.deepEqual(h.quoted, []);
    assert.match(text(h.render()), /Capture cancelled/);
  });
}
