import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as quote from "../src/lib/trade-map-quote.ts";
import * as solarEquipment from "../src/lib/trade-solar-equipment.ts";
import * as solar from "../src/lib/trade-map-solar.ts";

const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, component, captureImage, options = {}) {
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
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
  const layout = { panels: [panel], selectedId: 1, selectedIds: [1], selectionMode: "one" };
  let measurementChanged;
  let invalidate;
  const drawing = { setEditing() {}, setCapturing(value) { controls.push(value); }, finish() { events.push("finish"); measurementChanged?.({ ...measurement, finished: true }); }, dispose() {},
    beginCapture(signal, onInvalid) {
      controls.push(true); let restored = false;
      const restore = () => { if (!restored) { restored = true; controls.push(false); signal.removeEventListener("abort", restore); } };
      signal.addEventListener("abort", restore, { once: true }); invalidate = onInvalid;
      return { layout: structuredClone(layout), restore,
        async ensureVisible() { events.push("ensureVisible"); await options.ensureVisible?.(); },
        assertVisible() { events.push("assertVisible"); if (signal.aborted) throw new Error("Capture cancelled."); },
      };
    },
  };
  const measurement = { points: 4, areaM2: 162.5, lengthM: 52, previewLengthM: null, crossed: false, finished: true, ...options.measurement };
  const element = { scrollIntoView() {} };
  const map = { getDiv: () => element, setMapTypeId() {}, setTilt() {}, setHeading() {}, getCenter: () => ({ toJSON: () => ({ lat: -37.8, lng: 144.96 }) }), getZoom: () => 20 };
  const savedDesign = { id: "saved-design", revision: 3, workOrderId: "job-one", panels: [structuredClone(panel)] };
  const persistence = { status: "Saved", error: "", design: null, update(input) { savedInputs.push(input); }, accept() {},
    async ensureSaved() { events.push("ensureSaved"); return options.ensureSaved ? options.ensureSaved() : savedDesign; }, async saveCopy() { return savedDesign; } };
  const require = (id) => {
    if (id === "react/jsx-runtime") return jsx;
    if (id === "react") return react;
    if (id === "@/lib/trade-map-quote") return quote;
    if (id === "@/lib/trade-solar-equipment") return solarEquipment;
    if (id === "./useTradeSolarDesign") return { useTradeSolarDesign: () => persistence };
    if (id === "@/lib/trade-map-capture") return { captureTradeMapQuoteImage: captureImage, captureTradeMapPng: () => { throw new Error("Quote must not start a download"); } };
    if (id === "@/lib/trade-map-solar") return { ...solar, createTradeMapSolarLayout(_api, _map, _styles, changed) { changed(layout); return drawing; } };
    if (id === "@/lib/trade-map-measurement") return { EMPTY_MAP_MEASUREMENT: measurement, createTradeMapMeasurement(_api, _map, _mode, changed) { measurementChanged = changed; changed(measurement); return drawing; }, formatMapDistance: (value) => `${value} m` };
    return { default: {}, TradeMapSolarTools: () => null };
  };
  const exports = {};
  Function("require", "exports", "document", "fetch", code)(require, exports, { createElement: () => ({ setAttribute() {} }) }, async () => ({ ok: true, json: async () => ({ ok: true, solarPanels: [] }) }));
  const props = { user: { uid: "owner-one", getIdToken: async () => "test-token" }, api: {}, map, active: true, disabled: false, onCapturing: (value) => busy.push(value), onQuote: (value) => quoted.push(value), onActivate() {}, onClose() {}, onExplore() {}, onMeasuring() {} };
  const render = () => { cursor = 0; const tree = exports[component](props); for (const callback of pending.splice(0)) callback(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { render, quoted, controls, busy, element, events, savedInputs, panel, invalidate: () => invalidate() };
}

test("solar capture also hides an active measurement's vertex handles", (t) => {
  const h = harness(t, "TradeMapTools", async () => ({ dataUrl: "data:image/png;base64,UE5H" }));
  h.render(); button(h.render(), "Measure area").props.onClick(); h.render();
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
  h.render(); button(h.render(), "Measure area").props.onClick(); h.render();
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
    h.render(); button(h.render(), "Measure area").props.onClick(); h.render();
    assert.equal(button(h.render(), "Add to quote"), undefined);
    assert.deepEqual(h.quoted, []); assert.deepEqual(h.events, []);
  });
}

test("solar sharing starts in the click before fitting or saving; quote carries the verified saved revision", async (t) => {
  let finishSave, finishFit, grantSharing;
  const h = harness(t, "TradeMapSolarTools", async (_element, value, prepare, restore) => {
    h.events.push("sharing");
    assert.equal(value.designId, undefined, "the unsaved measurement does not claim a saved identity");
    await new Promise((resolve) => { grantSharing = resolve; });
    await prepare(); restore(); return { dataUrl: "data:image/png;base64,UE5H" };
  }, { ensureVisible: () => new Promise((resolve) => { finishFit = resolve; }), ensureSaved: () => new Promise((resolve) => { finishSave = resolve; }) });
  h.render(); button(h.render(), "Add to quote").props.onClick();
  assert.deepEqual(h.events, ["sharing"], "the sharing API is invoked synchronously from the click");
  assert.deepEqual(h.controls, [true], "editing is frozen before sharing");
  grantSharing(); await flush();
  assert.deepEqual(h.events, ["sharing", "ensureVisible"]);
  finishFit(); await flush();
  assert.deepEqual(h.events, ["sharing", "ensureVisible", "ensureSaved"]);
  assert.deepEqual(h.quoted, []);
  finishSave({ id: "saved-late", revision: 7, workOrderId: "job-linked", panels: [h.panel] }); await flush();
  assert.equal(h.quoted[0].designId, "saved-late");
  assert.equal(h.quoted[0].designRevision, 7);
  assert.equal(h.quoted[0].workOrderId, "job-linked");
  assert.equal(h.quoted[0].quantity, 1);
  assert.deepEqual(h.savedInputs.at(-1).panels, [h.panel]);
  assert.deepEqual(h.events, ["sharing", "ensureVisible", "ensureSaved", "assertVisible"]);
  assert.deepEqual(h.controls, [true, false]);
});

test("a saved revision with different panel geometry cannot be attached to a quote", async (t) => {
  const h = harness(t, "TradeMapSolarTools", async (_element, _value, prepare) => {
    await prepare(); return { dataUrl: "data:image/png;base64,UE5H" };
  }, { ensureSaved: () => ({ id: "wrong-design", revision: 1, panels: [{ ...h.panel, heading: 90 }] }) });
  h.render(); button(h.render(), "Add to quote").props.onClick(); await flush();
  assert.deepEqual(h.quoted, []);
  assert.match(text(h.render()), /saved roof layout does not match/);
  assert.deepEqual(h.controls, [true, false]);
});

test("camera invalidation aborts a pending solar capture and suppresses a late image", async (t) => {
  let finish;
  const h = harness(t, "TradeMapSolarTools", async (_element, _value, prepare) => {
    await prepare(); return new Promise((resolve) => { finish = () => resolve({ dataUrl: "data:image/png;base64,UE5H" }); });
  });
  h.render(); button(h.render(), "Add to quote").props.onClick(); await flush();
  h.invalidate(); finish(); await flush();
  assert.deepEqual(h.quoted, []);
  assert.match(text(h.render()), /map moved while capturing/);
  assert.deepEqual(h.controls, [true, false]);
  assert.equal(button(h.render(), "Add to quote").props.disabled, false);
});

for (const component of ["TradeMapSolarTools", "TradeMapTools"]) {
  const start = (h) => { h.render(); let tree = h.render(); if (component === "TradeMapTools") { button(tree, "Measure area").props.onClick(); h.render(); tree = h.render(); } return tree; };

  test(`${component} carries the roof image only after capture and control restoration`, async (t) => {
    let finish;
    const h = harness(t, component, async (element, value, prepare, restore) => {
      assert.equal(element, h.element);
      assert.equal(value.kind, component === "TradeMapSolarTools" ? "solar" : "area");
      await prepare(); await new Promise((resolve) => { finish = resolve; }); restore();
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
