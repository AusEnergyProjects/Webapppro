import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as portals from "../src/lib/tlink-portals.ts";

const source = readFileSync(new URL("../src/components/TLinkWorkspaceBar.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, matches) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, matches)) : [...(matches(node) ? [node] : []), ...nodes(node.props?.children, matches)];

function harness() {
  const properties = new Map(), observers = [], effects = [];
  const element = { offsetHeight: 56, parentElement: { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } } };
  const dependencies = { react: { useRef: () => ({ current: element }), useEffect: callback => effects.push(callback) }, "react/jsx-runtime": jsx,
    "@/lib/tlink-portals": portals, "./TLinkPortalSwitcher": { TLinkPortalSwitcher: "portal-switcher" },
    "./TLinkWorkspaceBar.module.css": { default: { bar: "bar", context: "context", tools: "tools", actions: "actions", selector: "selector" } } };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const exports = {};
  Function("require", "exports", "ResizeObserver", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
  }, exports, ResizeObserver);
  return { properties, observers, element, effects, render: props => exports.TLinkWorkspaceBar(props) };
}

test("all four workspaces use the same context-first, selector-last row and preserve navigation guards", () => {
  const h = harness(), user = { uid: "reviewer" }, guard = () => false;
  for (const { id } of portals.TLINK_PORTALS) {
    const action = jsx.jsx("button", { children: "Manage workspace" });
    const tree = h.render({ current: id, user, organisation: "Example organisation", displayName: "James", actions: action, onBeforeSwitch: guard, businessContext: id === "trade" });
    assert.equal(tree.props["data-workspace-portal"], id);
    assert.equal(tree.props["data-tlink-business-switcher"], id === "trade" ? true : undefined);
    assert.equal(tree.props.children[0].props.className, "context");
    const tools = tree.props.children[1];
    assert.equal(tools.props.children[0].props.children, action);
    const selector = nodes(tools.props.children.at(-1), node => node.type === "portal-switcher");
    assert.equal(selector.length, 1);
    assert.equal(selector[0].props.current, id);
    assert.equal(selector[0].props.user, user);
    assert.equal(selector[0].props.onBeforeSwitch, guard);
  }
});

test("the bar measures its wrapped height and clears the sticky offset on unmount", () => {
  const h = harness();
  h.render({ current: "council", user: null });
  const cleanup = h.effects[0]();
  assert.equal(h.properties.get("--tlink-workspace-bar-height"), "56px");
  assert.equal(h.observers[0].target, h.element);
  h.element.offsetHeight = 112;
  h.observers[0].callback();
  assert.equal(h.properties.get("--tlink-workspace-bar-height"), "112px");
  cleanup();
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.properties.has("--tlink-workspace-bar-height"), false);
});
