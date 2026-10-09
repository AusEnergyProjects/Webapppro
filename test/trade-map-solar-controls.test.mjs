import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as equipment from "../src/lib/trade-solar-equipment.ts";
import * as solar from "../src/lib/trade-map-solar.ts";

const source = fs.readFileSync(new URL("../src/components/TradeMapSolarTools.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const element = (type, props) => ({ type, props });
const nodes = (tree, match) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, match)) : [...(match(tree) ? [tree] : []), ...nodes(tree.props?.children, match)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const panel = id => ({ id, center: { lat: -37, lng: 145 }, widthM: 1.13, lengthM: 1.72, lengthTilt: 22.5, widthTilt: 0, heading: 0, equipment: equipment.DEFAULT_SOLAR_EQUIPMENT });
const layout = (mode = "one", selectedIds = [1], panels = [panel(1), panel(2), panel(3)]) => ({ panels, selectedIds, selectedId: mode === "one" ? selectedIds[0] ?? null : null, selectionMode: mode });

function harness(t, props = {}, design = { id: "saved-roof" }) {
  let cursor = 0, onLayout, removals = 0;
  const slots = [], effects = [], pending = [], saves = [];
  const changed = (before, after) => !before || !after || before.length !== after.length || before.some((value, index) => value !== after[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(callback, dependencies) { const index = cursor++; if (!slots[index] || changed(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: callback() }; return slots[index].value; },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) {
      const previous = effects[index]; effects[index] = { dependencies }; pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = callback(); }); } },
  };
  const controller = { setEditing() {}, dispose() {}, removeSelected() { removals++; }, add() {}, restore() {} };
  const persistence = { design, status: "", error: "", update: value => saves.push(value), accept() {}, ensureSaved: async () => design, saveCopy: async () => design };
  const dependencies = { react, "react/jsx-runtime": { jsx: element, jsxs: element }, "./TradeBusinessProvider": { useTradeBusinessFetch: () => null },
    "@/lib/trade-map-solar": { ...solar, createTradeMapSolarLayout: (_api, _map, _styles, callback) => { onLayout = callback; return controller; } },
    "@/lib/trade-solar-equipment": equipment, "@/lib/trade-map-capture": {}, "@/lib/trade-solar-crew-sheet": {}, "./TradeSolarEquipmentPicker": {},
    "./useTradeSolarDesign": { useTradeSolarDesign: () => persistence }, "./TradeMapSolarTools.module.css": { default: {} } };
  const output = { exports: {} };
  new Function("require", "module", "exports", "requestAnimationFrame", code)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, output, output.exports, () => {});
  const baseProps = { user: {}, api: {}, map: { getCenter: () => ({ toJSON: () => ({ lat: -37, lng: 145 }) }), getZoom: () => 20 },
    active: true, disabled: false, onActivate() {}, onClose() {}, onCapturing() {}, ...props };
  const render = (next = {}) => { Object.assign(baseProps, next); cursor = 0; const tree = output.exports.TradeMapSolarTools(baseProps); while (pending.length) pending.shift()(); return tree; };
  t.after(() => effects.forEach(effect => effect?.cleanup?.()));
  render();
  return { render, setLayout: value => onLayout(value), saves, get removals() { return removals; } };
}

test("single-panel deletion is visible beside selection controls, outside collapsed settings", t => {
  const h = harness(t); h.setLayout(layout()); const tree = h.render();
  const controls = nodes(tree, node => node.props?.role === "group" && node.props["aria-label"] === "Move and rotate")[0];
  const remove = button(controls, "Delete panel"); assert.ok(remove); assert.equal(remove.props.disabled, false);
  assert.equal(nodes(tree, node => node.type === "details").some(details => button(details, "Delete panel")), false);
  assert.equal(button(tree, "Remove panel"), undefined, "the replaced hidden action is removed");
  remove.props.onClick(); assert.equal(h.removals, 1);
});

for (const mode of ["all", "choose", "selection"]) test(`${mode} mode exposes deletion with the exact selection count`, t => {
  const h = harness(t); h.setLayout(layout(mode, [1, 3])); const tree = h.render();
  const remove = button(tree, "Delete 2 panels"); assert.ok(remove); assert.equal(remove.props.disabled, false);
  remove.props.onClick(); assert.equal(h.removals, 1);
});

test("deletion is disabled without a selection or while map editing is busy", t => {
  const h = harness(t);
  for (const mode of ["one", "all", "choose", "selection"]) {
    h.setLayout(layout(mode, [])); assert.equal(button(h.render(), "Delete panel").props.disabled, true);
  }
  h.setLayout(layout()); assert.equal(button(h.render({ disabled: true }), "Delete panel").props.disabled, true);
  assert.equal(button(h.render({ active: false, disabled: false }), "Delete panel"), undefined);
});

test("deleting the last panel updates the saved design with empty geometry", t => {
  const h = harness(t); h.setLayout(layout("one", [1], [panel(1)])); h.render();
  button(h.render(), "Delete panel").props.onClick(); h.setLayout(layout("one", [], [])); h.render();
  assert.deepEqual(h.saves.at(-1).panels, []); assert.equal(button(h.render(), "Delete panel").props.disabled, true);
});

for (const clearName of [false, true]) test(`a new design cleared before its first autosave saves empty geometry${clearName ? " even without a name" : ""}`, t => {
  const h = harness(t, {}, null); assert.equal(h.saves.length, 0, "untouched empty maps create no record");
  button(h.render(), "Add solar panel").props.onClick(); h.setLayout(layout("one", [1], [panel(1)])); h.render();
  assert.equal(h.saves.at(-1).panels.length, 1);
  if (clearName) {
    const nameLabel = nodes(h.render(), node => node.type === "label" && text(node).startsWith("Design name"))[0];
    nodes(nameLabel, node => node.type === "input")[0].props.onChange({ target: { value: "" } }); h.render();
  }
  button(h.render(), "Delete panel").props.onClick(); h.setLayout(layout("one", [], [])); h.render();
  assert.deepEqual(h.saves.at(-1).panels, []);
});
