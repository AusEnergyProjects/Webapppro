import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

test("top and bottom job scrollbars stay aligned through scrolling and column resizing", () => {
  const source = fs.readFileSync(new URL("../src/components/JobRegisterScroll.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const refs = [], effects = [], observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(node) { this.targets.push(node); }
    disconnect() { this.targets = []; }
  }
  const module = { exports: {} };
  const react = { useRef: () => { const ref = { current: null }; refs.push(ref); return ref; }, useEffect: callback => effects.push(callback) };
  new Function("require", "module", "exports", "ResizeObserver", output)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.endsWith(".css")) return { default: {} };
    throw Error(name);
  }, module, module.exports, Observer);
  module.exports.JobRegisterScroll({ children: "rows" });
  const top = new EventTarget(), table = new EventTarget(), header = {};
  Object.assign(top, { scrollLeft: 0, hidden: false });
  Object.assign(table, { scrollLeft: 0, scrollWidth: 3000, clientWidth: 1000, firstElementChild: header });
  refs[0].current = top; refs[1].current = { style: {} }; refs[2].current = table;
  const cleanup = effects[0]();
  assert.equal(refs[1].current.style.width, "3000px");
  assert.deepEqual(observers[0].targets, [table, header]);
  top.scrollLeft = 700; top.dispatchEvent(new Event("scroll")); assert.equal(table.scrollLeft, 700);
  table.scrollLeft = 1100; table.dispatchEvent(new Event("scroll")); assert.equal(top.scrollLeft, 1100);
  table.scrollWidth = 1500; observers[0].callback(); assert.equal(refs[1].current.style.width, "1500px");
  table.scrollWidth = 900; observers[0].callback(); assert.equal(top.hidden, true);
  cleanup(); top.scrollLeft = 12; top.dispatchEvent(new Event("scroll")); assert.equal(table.scrollLeft, 1100);
  assert.deepEqual(observers[0].targets, []);
});
