import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as calendar from "../src/lib/date-picker.ts";

const source = fs.readFileSync(new URL("../src/components/SiteDatePicker.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];

function harness(t) {
  const states = [], effects = [], pending = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial) { return hooks.useState({ current: initial })[0]; },
    useMemo(callback, deps) { const i = cursor++; if (!states[i] || deps.some((dep, index) => dep !== states[i].deps[index])) states[i] = { value: callback(), deps }; return states[i].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((dep, index) => dep !== old.deps[index])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  class Element extends EventTarget {
    constructor() { super(); this.attributes = {}; this.isConnected = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
  }
  class Input extends Element {
    constructor(dialog = null, value = "") { super(); this.dialog = dialog; this.type = "date"; this.value = value; this.dataset = {}; this.min = ""; this.max = ""; this.focusCount = 0; }
    get value() { return this.storedValue; }
    set value(value) { this.storedValue = value; }
    closest(selector) { assert.equal(selector, "dialog[open]"); return this.dialog; }
    getBoundingClientRect() { return { left: 100, top: 140, bottom: 184 }; }
    focus() { this.focusCount++; }
  }
  const listeners = new Map();
  const inputs = [];
  const document = {
    body: new Element(),
    querySelectorAll: () => inputs,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  const window = { innerWidth: 1024, innerHeight: 768, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} };
  const exports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "react-dom" ? { createPortal: (tree, container) => ({ tree, container }) } : calendar;
  Function("require", "exports", "document", "window", "HTMLInputElement", "HTMLSelectElement", "Node", "requestAnimationFrame", "cancelAnimationFrame", code)(require, exports, document, window, Input, Element, Element, window.requestAnimationFrame, window.cancelAnimationFrame);
  const render = () => { cursor = 0; const result = exports.SiteDatePicker(); pending.splice(0).forEach(callback => callback()); return result; };
  const open = input => { const event = { target: input, button: 0, pointerType: "mouse", preventDefault() {} }; listeners.get("pointerdown")(event); return render(); };
  t.after(() => effects.forEach(effect => effect?.cleanup?.()));
  render();
  return { render, open, Input, Element, document, inputs };
}

test("a date field inside a native modal uses its dialog subtree and applies its selected date", t => {
  const h = harness(t), dialog = new h.Element(), input = new h.Input(dialog, "2026-09-27");
  const changes = [];
  input.addEventListener("change", () => changes.push(input.value));
  let portal = h.open(input);
  assert.equal(portal.container, dialog, "body is inert while the native modal is open");
  nodes(portal.tree, node => node.props?.["data-calendar-date"] === "2026-09-30")[0].props.onClick();
  portal = h.render();
  nodes(portal.tree, node => node.props?.className === "site-date-apply")[0].props.onClick();
  assert.equal(h.render(), null);
  assert.equal(input.value, "2026-09-30");
  assert.deepEqual(changes, ["2026-09-30"]);
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("ordinary fields retain the body portal and modal date ranges update both inputs", t => {
  const h = harness(t), ordinary = new h.Input(null, "2026-09-27");
  assert.equal(h.open(ordinary).container, h.document.body);
  const dialog = new h.Element(), start = new h.Input(dialog), end = new h.Input(dialog);
  start.dataset = { dateRangeGroup: "job-dates", dateRangeRole: "start" };
  end.dataset = { dateRangeGroup: "job-dates", dateRangeRole: "end" };
  h.inputs.push(start, end);
  start.value = "2026-09-27";
  let portal = h.open(end);
  nodes(portal.tree, node => node.props?.["data-calendar-date"] === "2026-09-30")[0].props.onClick();
  portal = h.render();
  nodes(portal.tree, node => node.props?.className === "site-date-apply")[0].props.onClick();
  assert.equal(start.value, "2026-09-27");
  assert.equal(end.value, "2026-09-30");
  assert.equal(h.render(), null);
});

test("Escape closes only the calendar, and closing its host removes an open calendar", async t => {
  const h = harness(t), dialog = new h.Element(), input = new h.Input(dialog, "2026-09-27");
  let prevented = false, stopped = false;
  const portal = h.open(input);
  portal.tree.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(h.render(), null);
  assert.equal(prevented, true, "native dialog cancel must not run for calendar Escape");
  assert.equal(stopped, true, "outer modal keyboard handlers must not also dismiss");
  await Promise.resolve();
  assert.equal(input.focusCount, 2, "focus returns to the input after closing its calendar");
  h.open(input);
  dialog.dispatchEvent(new Event("close"));
  assert.equal(h.render(), null);
  assert.equal(input.getAttribute("aria-expanded"), "false");
});
