import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as quote from "../src/lib/trade-map-quote.ts";

const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, component, captureImage) {
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let cursor = 0;
  const slots = [], effects = [], pending = [], quoted = [], busy = [], controls = [];
  const react = {
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial; return [slots[id], (value) => { slots[id] = typeof value === "function" ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useEffect(callback, deps) { const id = cursor++; if (!effects[id] || deps.some((value, index) => value !== effects[id].deps[index])) { pending.push(() => { effects[id]?.cleanup?.(); effects[id] = { deps, cleanup: callback() }; }); } },
  };
  const panel = { id: 1, widthM: 1.13, lengthM: 1.72, heading: 0, lengthTilt: 22.5, widthTilt: 0 };
  const drawing = { setEditing() {}, setCapturing(value) { controls.push(value); }, dispose() {} };
  const measurement = { points: 4, areaM2: 162.5, lengthM: 52, previewLengthM: null, crossed: false, finished: true };
  const element = { scrollIntoView() {} };
  const map = { getDiv: () => element, setMapTypeId() {}, setTilt() {}, setHeading() {} };
  const require = (id) => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react") return react;
    if (id === "@/lib/trade-map-quote") return quote;
    if (id === "@/lib/trade-map-capture") return { captureTradeMapQuoteImage: captureImage, captureTradeMapPng: () => { throw new Error("Quote must not start a download"); } };
    if (id === "@/lib/trade-map-solar") return { DEFAULT_SOLAR_PANEL_SIZE: panel, DEFAULT_SOLAR_PANEL_TILT: panel, createTradeMapSolarLayout(_api, _map, _styles, changed) { changed({ panels: [panel], selectedId: 1, selectedIds: [1], selectionMode: "one" }); return drawing; } };
    if (id === "@/lib/trade-map-measurement") return { EMPTY_MAP_MEASUREMENT: measurement, createTradeMapMeasurement(_api, _map, _mode, changed) { changed(measurement); return drawing; }, formatMapDistance: (value) => `${value} m` };
    return { default: {}, TradeMapSolarTools: () => null };
  };
  const exports = {};
  Function("require", "exports", "document", code)(require, exports, { createElement: () => ({ setAttribute() {} }) });
  const props = { api: {}, map, active: true, disabled: false, onCapturing: (value) => busy.push(value), onQuote: (value) => quoted.push(value), onActivate() {}, onClose() {}, onExplore() {}, onMeasuring() {} };
  const render = () => { cursor = 0; const tree = exports[component](props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { render, quoted, controls, busy, element };
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
    button(h.render(), "Cancel capture").props.onClick();
    finish(); await flush();
    assert.deepEqual(h.quoted, []);
    assert.match(text(h.render()), /Capture cancelled/);
  });
}
