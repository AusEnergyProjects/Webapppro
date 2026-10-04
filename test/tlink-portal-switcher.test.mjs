import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as portalContracts from "../src/lib/tlink-portals.ts";

const source = readFileSync(new URL("../src/components/TLinkPortalSwitcher.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = uid => ({ uid, getIdToken: async () => `token-${uid}` });
const payload = (available = ["trade"], overrides = {}) => ({ ok: true, portals: portalContracts.TLINK_PORTALS.map(portal => ({
  id: portal.id, available: available.includes(portal.id), status: available.includes(portal.id) ? "ready" : "no_access", ...overrides[portal.id],
})) });
const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(child => nodes(child, predicate)) : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree === "string" || typeof tree === "number"
  ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const select = tree => nodes(tree, node => node.type === "select")[0];
const option = (tree, id) => nodes(tree, node => node.type === "option" && node.props.value === id)[0];
const change = (tree, value) => select(tree).props.onChange({ target: { value } });

function harness(t, initial = {}) {
  const states = [], effects = [], requests = [], navigation = [];
  let cursor = 0, pending = [], props = { user: null, ...initial }, writes = 0;
  const hooks = {
    useId: () => "portal-switcher-test",
    useState(initialValue) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [states[index], next => { writes++; states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects[index] = { deps };
        pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = callback(); });
      }
    },
  };
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/tlink-portals": portalContracts,
    "./TLinkPortalSwitcher.module.css": { default: { switcher: "switcher", error: "error" } } };
  const exports = {};
  Function("require", "exports", "fetch", "window", compiled)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports, (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
  { location: { assign: href => navigation.push(href) } });
  const cleanup = () => effects.forEach(effect => effect?.cleanup?.());
  t.after(cleanup);
  return { requests, navigation, cleanup, writes: () => writes,
    render(update = {}) {
      props = { ...props, ...update }; cursor = 0;
      const tree = exports.TLinkPortalSwitcher(props);
      const next = pending; pending = []; next.forEach(effect => effect());
      return tree;
    },
    async respond(index, body, status = 200) { requests[index].resolve(Response.json(body, { status })); await flush(); },
  };
}

test("signed-out dashboard selection defaults to trades and exposes four fixed destinations", async t => {
  const h = harness(t), tree = h.render();
  assert.equal(select(tree).props.value, "trade");
  assert.equal(select(tree).props["aria-label"], "TLink dashboard");
  assert.equal(nodes(tree, node => node.type === "option").length, 4);
  for (const portal of portalContracts.TLINK_PORTALS) {
    assert.equal(option(tree, portal.id).props.disabled, false);
    assert.equal(text(option(tree, portal.id)), portal.label);
    change(tree, portal.id);
  }
  assert.deepEqual(h.navigation, ["/operations/control-centre", "/creditex/compliance", "/council"]);
  change(h.render({ current: "council" }), "trade");
  assert.equal(h.navigation.at(-1), "/direct-trade/dashboard");
  await flush();
  assert.equal(h.requests.length, 0);
});

test("signed-in users can select only currently available dashboards", async t => {
  const h = harness(t, { user: user("owner") });
  let tree = h.render();
  for (const id of ["admin", "creditex", "council"]) {
    assert.equal(option(tree, id).props.disabled, true);
    change(tree, id);
  }
  assert.deepEqual(h.navigation, []);
  await flush();
  assert.equal(h.requests[0].url, "/api/tlink/portals");
  assert.equal(h.requests[0].init.cache, "no-store");
  assert.deepEqual(h.requests[0].init.headers, { Authorization: "Bearer token-owner" });
  await h.respond(0, payload(["trade", "council"], { council: { status: "invitation" } }));
  tree = h.render();
  assert.equal(option(tree, "council").props.disabled, false);
  assert.match(text(option(tree, "council")), /Accept invitation/);
  assert.equal(option(tree, "admin").props.disabled, true);
  change(tree, "admin");
  change(tree, "council");
  assert.deepEqual(h.navigation, ["/council"]);
});

test("a different UID cannot reuse the previous user's dashboard permissions", async t => {
  const h = harness(t, { user: user("first") });
  h.render(); await flush(); await h.respond(0, payload(["trade", "admin"]));
  assert.equal(option(h.render(), "admin").props.disabled, false);
  let tree = h.render({ user: user("second") });
  assert.equal(option(tree, "admin").props.disabled, true);
  change(tree, "admin");
  assert.deepEqual(h.navigation, []);
  assert.equal(h.requests[0].init.signal.aborted, true);
  await flush(); await h.respond(1, payload(["trade", "council"]));
  tree = h.render();
  assert.equal(option(tree, "admin").props.disabled, true);
  assert.equal(option(tree, "council").props.disabled, false);
});

test("late responses from an aborted identity cannot overwrite the new identity's access", async t => {
  const h = harness(t, { user: user("old") });
  h.render(); await flush(); h.render({ user: user("new") }); await flush();
  assert.equal(h.requests[0].init.signal.aborted, true);
  await h.respond(1, payload(["trade", "council"]));
  const writes = h.writes();
  await h.respond(0, payload(["trade", "admin"]));
  assert.equal(h.writes(), writes, "aborted requests must not publish state");
  const tree = h.render();
  assert.equal(option(tree, "council").props.disabled, false);
  assert.equal(option(tree, "admin").props.disabled, true);
});

test("an aborted request failure does not appear in a signed-out switcher", async t => {
  const h = harness(t, { user: user("old") });
  h.render(); await flush(); h.render({ user: null });
  const writes = h.writes();
  h.requests[0].reject(new Error("Aborted")); await flush();
  assert.equal(h.writes(), writes);
  const tree = h.render();
  assert.equal(nodes(tree, node => node.props?.role === "status").length, 0);
  assert.equal(option(tree, "council").props.disabled, false);
});

test("API failure is visible, blocks protected navigation and can be retried", async t => {
  const h = harness(t, { user: user("owner") });
  h.render(); await flush(); await h.respond(0, { error: "Unavailable" }, 503);
  let tree = h.render();
  assert.match(text(tree), /Access could not be checked/);
  assert.equal(select(tree).props["aria-describedby"], "portal-switcher-test-error");
  change(tree, "admin");
  assert.deepEqual(h.navigation, []);
  nodes(tree, node => node.type === "button" && text(node) === "Retry")[0].props.onClick();
  h.render(); await flush(); await h.respond(1, payload(["trade", "admin"]));
  tree = h.render();
  assert.doesNotMatch(text(tree), /Access could not be checked/);
  change(tree, "admin");
  assert.deepEqual(h.navigation, ["/operations/control-centre"]);
});

test("invalid access responses fail closed instead of granting partial permissions", async t => {
  const invalidResponses = [
    { ok: false, portals: payload(["trade", "admin"]).portals },
    { ok: true, portals: payload(["trade", "admin"]).portals.slice(0, 3) },
    { ok: true, portals: [...payload(["trade", "admin"]).portals, { id: "admin", status: "ready", available: true }] },
    payload(["trade", "admin"], { admin: { status: "administrator" } }),
    payload(["trade", "admin"], { admin: { available: "true" } }),
  ];
  for (const invalid of invalidResponses) {
    const h = harness(t, { user: user("owner") });
    h.render(); await flush(); await h.respond(0, invalid);
    const tree = h.render();
    assert.match(text(tree), /Access could not be checked/);
    assert.equal(option(tree, "admin").props.disabled, true);
    change(tree, "admin");
    assert.deepEqual(h.navigation, []);
  }
});

test("navigation uses canonical local URLs even when responses contain other destinations", async t => {
  const h = harness(t, { user: user("owner") });
  h.render(); await flush();
  await h.respond(0, payload(["trade", "council"], { council: { href: "https://external.example/", label: "External" } }));
  const tree = h.render();
  for (const value of ["https://external.example/", "//external.example/", "javascript:alert(1)", "unknown", "trade"]) change(tree, value);
  assert.deepEqual(h.navigation, []);
  change(tree, "council");
  assert.deepEqual(h.navigation, ["/council"]);
  assert.equal(text(option(tree, "council")), "Council");
});

test("the unsaved-change guard can cancel switching and runs only for an allowed destination", async t => {
  let allow = false, guardCalls = 0;
  const h = harness(t, { user: user("owner"), onBeforeSwitch: () => { guardCalls++; return allow; } });
  h.render(); await flush(); await h.respond(0, payload(["trade", "council"]));
  const tree = h.render();
  change(tree, "admin"); change(tree, "unknown"); change(tree, "trade");
  assert.equal(guardCalls, 0);
  change(tree, "council");
  assert.equal(guardCalls, 1);
  assert.deepEqual(h.navigation, []);
  allow = true;
  change(tree, "council");
  assert.equal(guardCalls, 2);
  assert.deepEqual(h.navigation, ["/council"]);
});

test("unmount aborts pending lookup and ignores its later successful response", async t => {
  const h = harness(t, { user: user("owner") });
  h.render(); await flush(); h.cleanup();
  assert.equal(h.requests[0].init.signal.aborted, true);
  const writes = h.writes();
  await h.respond(0, payload(["trade", "admin"]));
  assert.equal(h.writes(), writes);
});
