import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/lib/council-journey-metrics.ts";

const css = { default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(path, dependencies, globals = {}) {
  const record = { exports: {} };
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", ...Object.keys(globals), code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`); return dependencies[id];
  }, record, record.exports, ...Object.values(globals));
  return record.exports;
}
const primitives = load("../src/components/council/CouncilPrimitives.tsx", { "react/jsx-runtime": jsx, "./CouncilWorkspace.module.css": css });
const checkedAt = "2026-10-08T04:00:00.000Z";
const areaId = scope => JSON.stringify([scope.councilId, scope.state, [...scope.postcodes].sort()]);
const fixtureScopes = [
  { councilId: "c1", state: "VIC", postcodes: ["3182"] }, { councilId: "c1", state: "VIC", postcodes: ["3205"] },
  { councilId: "c2", state: "VIC", postcodes: ["3182"] }, { councilId: "c2", state: "VIC", postcodes: ["3205"] },
];
const scopeKeys = new Map(await Promise.all(fixtureScopes.map(async scope => [areaId(scope), await contract.councilJourneyScopeKey(scope)])));
const scopeKey = scope => { const key = scopeKeys.get(areaId(scope)); assert.ok(key, "Unknown fixture reporting area"); return key; };
const c1Key = scopeKey(fixtureScopes[0]);
const metrics = (submittedEnquiries = 7, enquiriesQuoted = 2, quotesSent = 3) => ({ submittedEnquiries, enquiriesQuoted, quotesSent, checkedAt });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const plain = html => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function renderer(options = {}) {
  const hooks = [], pendingEffects = [], timers = new Map(), listeners = new Set(), calls = [];
  let cursor = 0, timerId = 0, tree;
  const auth = { currentUser: { uid: "actor-a" } };
  const document = { visibilityState: options.hidden ? "hidden" : "visible",
    addEventListener: (name, callback) => { assert.equal(name, "visibilitychange"); listeners.add(callback); },
    removeEventListener: (name, callback) => { assert.equal(name, "visibilitychange"); listeners.delete(callback); },
  };
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
    },
    useRef(initial) { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
    useEffect(effect, dependencies) {
      const index = cursor++; const slot = hooks[index] ??= { dependencies: undefined, cleanup: undefined };
      if (!slot.dependencies || dependencies.some((value, position) => !Object.is(value, slot.dependencies[position]))) pendingEffects.push({ slot, effect, dependencies });
    },
  };
  const defaultApi = async (path, init) => { calls.push({ path, init }); return { metrics: metrics(), scopeKey: scopeKey(props.profile) }; };
  const api = options.api ? (...args) => { calls.push({ path: args[0], init: args[1] }); return options.api(...args); } : defaultApi;
  let props = { profile: { councilId: "c1", state: "VIC", postcodes: ["3182"], publicJourney: { enabled: true, sharePath: "/council/c1" } },
    user: { uid: "actor-a" }, demonstration: false, api };
  const { CouncilJourneyMetrics } = load("../src/components/council/CouncilJourneyMetrics.tsx", {
    react, "react/jsx-runtime": jsx, "@/lib/firebase-client": { firebaseAuth: auth },
    "@/lib/council-journey-metrics": { ...contract, councilJourneyScopeKey: async scope => scopeKey(scope) }, "./CouncilPrimitives": primitives, "./CouncilJourneyMetrics.module.css": css,
  }, { document, setTimeout: (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout: id => timers.delete(id) });
  function commit() { for (const { slot, effect, dependencies } of pendingEffects.splice(0)) { slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = effect(); } }
  function render(change = {}, shouldCommit = true) {
    props = { ...props, ...change }; cursor = 0; pendingEffects.length = 0;
    tree = CouncilJourneyMetrics(props); const html = renderToStaticMarkup(tree);
    if (shouldCommit) commit(); return html;
  }
  function elements(node = tree, result = []) {
    if (React.isValidElement(node)) {
      result.push(node); React.Children.forEach(node.props.children, child => elements(child, result));
      if (node.props.action) elements(node.props.action, result);
    }
    return result;
  }
  return { calls, timers, listeners, auth, props: () => props, render, commit,
    find: predicate => { const node = elements().find(predicate); assert.ok(node, "Expected control not found"); return node; },
    visibility: visible => { document.visibilityState = visible ? "visible" : "hidden"; for (const listener of listeners) listener(); },
    tick: () => { const scheduled = [...timers]; for (const [id, item] of scheduled) { timers.delete(id); item.callback(); } },
    unmount: () => { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

test("demonstration counters stay explicitly inactive at zero without private fetches or timers", async () => {
  const ui = renderer();
  const html = plain(ui.render({ demonstration: true })); await flush();
  assert.match(html, /Enquiries submitted 0 Enquiries with a quote 0 Quotes sent 0/);
  assert.match(html, /Demonstration only.*inactive.*no actual enquiries/);
  assert.equal(ui.calls.length, 0); assert.equal(ui.timers.size, 0); assert.equal(ui.listeners.size, 0);
  assert.equal(ui.find(node => node.type === "button").props.disabled, true);
});

test("visible authorised counters refresh every 20 seconds, with manual refresh and provider acceptance wording", async () => {
  const ui = renderer(); ui.render(); await flush();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].path, "/api/council/journey-metrics?councilId=c1");
  assert.equal(ui.calls[0].init.signal.aborted, false);
  const html = plain(ui.render());
  assert.match(html, /Enquiries submitted 7 Enquiries with a quote 2 Quotes sent 3/);
  assert.match(html, /accepted by the email provider/); assert.match(html, /does not confirm arrival in the customer's inbox/);
  assert.match(html, /Re-sending the same version does not add another quote/);
  assert.equal([...ui.timers.values()][0].milliseconds, 20_000);
  ui.tick(); await flush(); assert.equal(ui.calls.length, 2);
  ui.render(); ui.find(node => node.type === "button").props.onClick(); await flush(); assert.equal(ui.calls.length, 3);
  ui.unmount(); assert.equal(ui.timers.size, 0); assert.equal(ui.listeners.size, 0);
});

test("hidden tabs neither initially load nor poll; returning to visibility refreshes once", async () => {
  const ui = renderer({ hidden: true }); ui.render(); await flush();
  assert.equal(ui.calls.length, 0); assert.equal(ui.timers.size, 0);
  ui.visibility(true); await flush(); assert.equal(ui.calls.length, 1); assert.equal(ui.timers.size, 1);
  ui.visibility(false); assert.equal(ui.timers.size, 0);
  ui.tick(); await flush(); assert.equal(ui.calls.length, 1);
  ui.visibility(true); await flush(); assert.equal(ui.calls.length, 2);
  ui.unmount(); assert.equal(ui.listeners.size, 0);
});

test("in-flight refreshes do not overlap and unmount aborts the request without accepting late results", async () => {
  const pending = deferred(); const ui = renderer({ api: () => pending.promise });
  ui.render(); await flush(); ui.visibility(true); ui.visibility(true); assert.equal(ui.calls.length, 1);
  ui.unmount(); assert.equal(ui.calls[0].init.signal.aborted, true); assert.equal(ui.listeners.size, 0);
  pending.resolve({ metrics: metrics(99, 4, 5), scopeKey: c1Key }); await flush();
  assert.equal(ui.timers.size, 0);
  assert.doesNotMatch(plain(ui.render({}, false)), /Enquiries submitted 99/);
});

test("council and approved scope changes hide old counters before effects run and discard old responses", async () => {
  const requests = [deferred(), deferred(), deferred()]; let index = 0;
  const ui = renderer({ api: () => requests[index++].promise }); ui.render();
  requests[0].resolve({ metrics: metrics(41, 2, 3), scopeKey: c1Key }); await flush();
  assert.match(plain(ui.render()), /Enquiries submitted 41/);
  const secondProfile = { ...ui.props().profile, councilId: "c2", publicJourney: { enabled: true, sharePath: "/council/c2" } };
  assert.doesNotMatch(plain(ui.render({ profile: secondProfile }, false)), /Enquiries submitted 41/);
  ui.commit(); await flush(); assert.equal(ui.calls[0].init.signal.aborted, true);
  const thirdProfile = { ...secondProfile, postcodes: ["3205"] };
  ui.render({ profile: thirdProfile }); assert.equal(ui.calls[1].init.signal.aborted, true);
  requests[1].resolve({ metrics: metrics(88, 5, 6), scopeKey: scopeKey(fixtureScopes[2]) }); await flush();
  assert.doesNotMatch(plain(ui.render()), /Enquiries submitted 88/);
  requests[2].resolve({ metrics: metrics(9, 3, 4), scopeKey: scopeKey(fixtureScopes[3]) }); await flush();
  assert.match(plain(ui.render()), /Enquiries submitted 9/); ui.unmount();
});

test("switching actor identities fences private results even before the parent auth listener updates props", async () => {
  const pending = deferred(); const ui = renderer({ api: () => pending.promise }); ui.render(); await flush();
  ui.auth.currentUser = { uid: "actor-b" };
  pending.resolve({ metrics: metrics(77, 5, 6), scopeKey: c1Key }); await flush();
  const html = plain(ui.render()); assert.doesNotMatch(html, /Enquiries submitted 77/);
  assert.match(html, /Sign in to your council account/); assert.equal(ui.timers.size, 0);
  ui.unmount();
});

test("already loaded counters disappear immediately when the current Firebase actor changes", async () => {
  const ui = renderer(); ui.render(); await flush();
  assert.match(plain(ui.render()), /Enquiries submitted 7/);
  ui.auth.currentUser = { uid: "actor-b" };
  const html = plain(ui.render({}, false));
  assert.doesNotMatch(html, /Enquiries submitted 7/); assert.match(html, /Sign in to your council account/);
  assert.equal(ui.find(node => node.type === "button").props.disabled, true);
  ui.commit(); assert.equal(ui.calls.length, 1); assert.equal(ui.timers.size, 0); ui.unmount();
});

test("failed refreshes and invalid metrics remove stale totals instead of presenting them as current", async () => {
  const requests = [deferred(), deferred(), deferred()]; let index = 0;
  const ui = renderer({ api: () => requests[index++].promise }); ui.render();
  requests[0].resolve({ metrics: metrics(61, 2, 3), scopeKey: c1Key }); await flush(); assert.match(plain(ui.render()), /Enquiries submitted 61/);
  ui.find(node => node.type === "button").props.onClick(); requests[1].reject(new Error("Your council access was revoked.")); await flush();
  const failed = plain(ui.render()); assert.doesNotMatch(failed, /Enquiries submitted 61/); assert.match(failed, /Your council access was revoked/);
  ui.find(node => node.type === "button").props.onClick(); requests[2].resolve({ metrics: { ...metrics(), submittedEnquiries: null }, scopeKey: c1Key }); await flush();
  assert.match(plain(ui.render()), /counters could not be verified/); ui.unmount();
});

test("a remotely changed reporting area between polls hides new totals until the saved workspace is refreshed", async () => {
  const requests = [deferred(), deferred()]; let index = 0;
  const ui = renderer({ api: () => requests[index++].promise }); ui.render();
  requests[0].resolve({ metrics: metrics(71, 2, 3), scopeKey: c1Key }); await flush();
  assert.match(plain(ui.render()), /Enquiries submitted 71/);
  ui.tick(); requests[1].resolve({ metrics: metrics(89, 3, 4), scopeKey: scopeKey(fixtureScopes[1]) }); await flush();
  const html = plain(ui.render());
  assert.doesNotMatch(html, /Enquiries submitted (71|89)/);
  assert.match(html, /reporting area changed.*Refresh the workspace/); ui.unmount();
});

test("signed-out or mismatched actors never make private counter requests", async () => {
  const ui = renderer(); ui.auth.currentUser = null; ui.render(); await flush();
  assert.equal(ui.calls.length, 0); assert.equal(ui.timers.size, 0); assert.match(plain(ui.render()), /Sign in to your council account/);
  ui.render({ user: null }); assert.equal(ui.listeners.size, 0); assert.equal(ui.calls.length, 0);
});
