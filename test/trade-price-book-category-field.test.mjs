import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/components/TradePriceBookCategoryField.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const role = (tree, name) => nodes(tree, node => node.props?.role === name);
function harness() {
  let cursor = 0, tree;
  const state = [];
  const hooks = {
    useId: () => "category-test",
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
  };
  const exports = {};
  Function("require", "exports", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : { default: new Proxy({}, { get: (_, key) => key }) }, exports);
  const props = { value: "", categories: ["Insulation", "SOLAR PANELS", "Roof fittings"], onChange(value) { props.value = value; } };
  const render = () => {
    cursor = 0; tree = exports.TradePriceBookCategoryField(props);
    role(tree, "combobox")[0].props.ref.current = { focus() { role(tree, "combobox")[0].props.onFocus(); } };
    return tree;
  };
  const key = (name, composing = false) => {
    let prevented = false;
    role(tree, "combobox")[0].props.onKeyDown({ key: name, nativeEvent: { isComposing: composing }, preventDefault() { prevented = true; }, stopPropagation() {} });
    tree = render(); return prevented;
  };
  return { props, render, key };
}

test("category suggestions use a linked listbox, dedupe and keyboard selection without submitting", () => {
  const h = harness(); let tree = h.render();
  assert.equal(role(tree, "combobox")[0].props.list, undefined);
  role(tree, "combobox")[0].props.onFocus(); tree = h.render();
  const input = role(tree, "combobox")[0];
  assert.equal(input.props["aria-expanded"], true);
  assert.equal(input.props["aria-controls"], role(tree, "listbox")[0].props.id);
  assert.deepEqual(role(tree, "option").map(node => node.props.children), ["Insulation", "Solar panels", "Roof fittings", "Heat pumps"]);
  assert.equal(h.key("ArrowDown"), true); tree = h.render();
  assert.equal(role(tree, "combobox")[0].props["aria-activedescendant"], role(tree, "option")[0].props.id);
  assert.equal(h.key("Enter"), true); tree = h.render();
  assert.equal(h.props.value, "Insulation"); assert.equal(role(tree, "listbox").length, 0);
  assert.equal(role(tree, "combobox")[0].props["aria-activedescendant"], undefined);
});

test("custom text survives filtering, Tab, Escape and outside dismissal", () => {
  const h = harness(); let tree = h.render();
  role(tree, "combobox")[0].props.onChange({ target: { value: "Roof insulation" } }); tree = h.render();
  assert.equal(role(tree, "option").length, 0);
  assert.match(role(tree, "status")[0].props.children, /Roof insulation/);
  assert.equal(h.key("Tab"), false); assert.equal(h.props.value, "Roof insulation");
  tree = h.render(); role(tree, "combobox")[0].props.onFocus(); tree = h.render();
  assert.equal(h.key("Escape"), true); assert.equal(h.props.value, "Roof insulation");
  tree = h.render(); role(tree, "combobox")[0].props.onFocus(); tree = h.render();
  tree.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null }); tree = h.render();
  assert.equal(role(tree, "listbox").length, 0); assert.equal(h.props.value, "Roof insulation");
});

test("pointer selection closes even after focus returns, toggle opens all options, and composing Enter is untouched", () => {
  const h = harness(); let tree = h.render();
  const toggle = () => nodes(tree, node => node.props?.className === "categoryToggle")[0];
  assert.equal(toggle().props.type, "button"); toggle().props.onClick(); tree = h.render();
  role(tree, "option")[2].props.onClick(); tree = h.render();
  assert.equal(h.props.value, "Roof fittings"); assert.equal(role(tree, "listbox").length, 0);
  toggle().props.onClick(); tree = h.render(); assert.equal(role(tree, "option").length, 4);
  assert.equal(h.key("Enter", true), false); tree = h.render(); assert.equal(role(tree, "listbox").length, 1);
  assert.equal(h.key("Enter"), true); tree = h.render(); assert.equal(role(tree, "listbox").length, 0);
  assert.equal(h.props.value, "Roof fittings");
});
