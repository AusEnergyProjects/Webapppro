import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/customer-job-journey.ts";

const source = fs.readFileSync(new URL("../src/components/CustomerJobWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const child = (tree, type) => nodes(tree, node => node.type === type)[0];
const changed = (before, after) => !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
const flush = () => new Promise(resolve => setImmediate(resolve));
const ok = journey => ({ ok: true, json: async () => ({ ok: true, journey }) });
const current = { stage: "preparing", appointment: null, photos: null };
const journey = { decision: "accepted", workNumber: "JOB-PRIVATE-1", title: "Private switchboard upgrade", businessName: "Example Electrical", expiresAt: "2026-11-01T00:00:00.000Z", current };
const withPhotos = { ...journey, current: { ...current, photos: { status: "needed", outstanding: 2 } } };

// Track element ancestry and position, which React uses with type/key to retain
// child state when an already-open panel is hidden rather than unmounted.
function locate(node, predicate, path = [], ancestors = []) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = locate(item, predicate, [...path, index], ancestors);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return { node, path, ancestors };
  return locate(node.props?.children, predicate, [...path, "children"], [...ancestors, node]);
}

function harness(api, token = "customer-token") {
  let cursor = 0;
  let dirty = false;
  const slots = [], effects = [], callbacks = [], queued = [], requests = [];
  const listeners = new Map();
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (changed(callbacks[index]?.dependencies, dependencies)) callbacks[index] = { callback, dependencies };
      return callbacks[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (changed(effects[index]?.dependencies, dependencies)) {
        effects[index]?.cleanup?.();
        effects[index] = { dependencies };
        queued.push(() => { effects[index].cleanup = effect(); });
      }
    },
  };
  const loaded = {};
  Function("require", "exports", "fetch", "window", `${compiled}\nexports.Workspace=Workspace;`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/customer-job-journey") return contract;
    if (name === "./QuoteLinkReview") return { QuoteLinkReview: "QuoteLinkReview" };
    if (name === "./JobInformationUpload") return { JobInformationUpload: "JobInformationUpload" };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw Error(name);
  }, loaded, async (path, init) => { requests.push({ path, init }); return api(path, init); }, {
    setTimeout, clearTimeout,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  });
  const render = () => {
    cursor = 0; dirty = false;
    const tree = loaded.Workspace({ token });
    for (const effect of queued.splice(0)) effect();
    return tree;
  };
  const settle = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tree = render();
      await flush();
      if (!dirty) return tree;
    }
    assert.fail("Customer job workspace did not settle after five renders");
  };
  return { render, settle, requests, loaded, listeners, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("customer tokens key the whole private workspace and are encoded in the uncached request", async t => {
  const token = "token/with ?private";
  const h = harness(async () => ok(journey), token); t.after(h.cleanup);
  const first = h.loaded.CustomerJobWorkspace({ token });
  const second = h.loaded.CustomerJobWorkspace({ token: "different-token" });
  assert.equal(first.key, token);
  assert.notEqual(first.key, second.key);
  assert.equal(first.type, second.type);
  assert.equal(first.props.token, token);
  await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, `/api/quote-review/${encodeURIComponent(token)}/job`);
  assert.equal(h.requests[0].init.cache, "no-store");
});

for (const scenario of [
  { name: "active quote", data: { ...journey, decision: "active", current: null }, label: "Review quote", panel: "QuoteLinkReview" },
  { name: "accepted quote without current updates", data: { ...journey, current: null }, label: "View your record", panel: "QuoteLinkReview" },
  { name: "accepted job needing photos", data: withPhotos, label: "Add requested photos", panel: "JobInformationUpload" },
]) {
  test(`${scenario.name} has one dominant next action that opens its correct panel`, async t => {
    const h = harness(async () => ok(scenario.data)); t.after(h.cleanup);
    let tree = await h.settle();
    const next = nodes(tree, node => node.props?.className === "next")[0];
    const actions = nodes(next, node => node.type === "button");
    assert.equal(actions.length, 1);
    assert.equal(text(actions[0]), scenario.label);
    actions[0].props.onClick(); tree = h.render();
    assert.equal(child(tree, scenario.panel).props.token, "customer-token");
    assert.equal(child(tree, scenario.panel).props.embedded, true);
    assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Job overview")[0].props.hidden, true);
  });
}

test("accepted jobs waiting on the business do not invent another customer action", async t => {
  const h = harness(async () => ok(journey)); t.after(h.cleanup);
  const tree = await h.settle();
  const next = nodes(tree, node => node.props?.className === "next")[0];
  assert.match(text(next), /Your quote is accepted/);
  assert.equal(nodes(next, node => node.type === "button").length, 0);
  assert.ok(button(tree, "Open record"));
});

test("opened quote and photo panels retain their React positions while navigating", async t => {
  const h = harness(async () => ok(withPhotos)); t.after(h.cleanup);
  let tree = await h.settle();
  assert.equal(child(tree, "QuoteLinkReview"), undefined);
  assert.equal(child(tree, "JobInformationUpload"), undefined);
  button(tree, "Quote & invoice").props.onClick(); tree = h.render();
  const quote = locate(tree, node => node.type === "QuoteLinkReview");
  button(tree, "Photos").props.onClick(); tree = h.render();
  const photos = locate(tree, node => node.type === "JobInformationUpload");
  assert.equal(photos.ancestors.at(-1).props.hidden, false);
  assert.equal(child(tree, "JobInformationUpload").props.endpoint, "/api/quote-review/customer-token/job/photos");
  for (const tab of ["Overview", "Quote & invoice", "Photos", "Overview"]) {
    button(tree, tab).props.onClick(); tree = h.render();
    for (const original of [quote, photos]) {
      const found = locate(tree, node => node.type === original.node.type);
      assert.ok(found, `${original.node.type} must remain mounted on ${tab}`);
      assert.deepEqual(found.path, original.path);
      assert.equal(found.node.key, original.node.key);
      assert.equal(found.ancestors.at(-1).props.hidden, tab !== (original === quote ? "Quote & invoice" : "Photos"));
    }
  }
  assert.equal(h.requests.length, 1, "navigation must not reload the journey");
});

test("failed refresh clears private details and previously opened child panels, then permits retry", async t => {
  let denied = false;
  const h = harness(async () => denied ? { ok: false, json: async () => ({ ok: false, error: "This link is no longer available." }) } : ok(withPhotos)); t.after(h.cleanup);
  let tree = await h.settle();
  button(tree, "Quote & invoice").props.onClick(); tree = h.render();
  button(tree, "Photos").props.onClick(); tree = h.render();
  denied = true; button(tree, "Refresh").props.onClick(); tree = await h.settle();
  for (const privateValue of [journey.title, journey.businessName, journey.workNumber]) assert.equal(text(tree).includes(privateValue), false);
  assert.equal(child(tree, "QuoteLinkReview"), undefined);
  assert.equal(child(tree, "JobInformationUpload"), undefined);
  assert.match(text(tree), /This link is no longer available/);
  assert.ok(button(tree, "Try again"));
  denied = false; button(tree, "Try again").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Private switchboard upgrade/);
});

test("refresh removing the open photo request returns to a visible overview", async t => {
  let data = withPhotos;
  const h = harness(async () => ok(data)); t.after(h.cleanup);
  let tree = await h.settle();
  button(tree, "Photos").props.onClick(); tree = h.render();
  assert.ok(child(tree, "JobInformationUpload"));
  data = journey; button(tree, "Refresh").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Photos"), undefined);
  assert.equal(child(tree, "JobInformationUpload"), undefined);
  assert.equal(button(tree, "Overview").props["aria-current"], "page");
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Job overview")[0].props.hidden, false);
});

test("refresh, focus and saved actions update both mounted child refresh versions", async t => {
  const h = harness(async () => ok(withPhotos)); t.after(h.cleanup);
  let tree = await h.settle();
  button(tree, "Quote & invoice").props.onClick(); tree = h.render();
  button(tree, "Photos").props.onClick(); tree = h.render();
  const versions = () => ["QuoteLinkReview", "JobInformationUpload"].map(type => child(tree, type).props.refreshVersion);
  assert.deepEqual(versions(), [0, 0]);
  for (const [index, trigger] of [
    () => button(tree, "Refresh").props.onClick(),
    () => h.listeners.get("focus")(),
    () => child(tree, "QuoteLinkReview").props.onDecisionRecorded(),
    () => child(tree, "JobInformationUpload").props.onCompleted(),
  ].entries()) {
    trigger(); tree = await h.settle();
    assert.deepEqual(versions(), [index + 1, index + 1]);
  }
  assert.equal(h.requests.length, 5);
  h.cleanup();
  assert.equal(h.listeners.has("focus"), false);
});

test("unmount aborts the request and ignores a late private response", async t => {
  let release;
  const h = harness(async () => new Promise(resolve => { release = resolve; })); t.after(h.cleanup);
  h.render();
  assert.equal(h.requests[0].init.signal.aborted, false);
  h.cleanup();
  assert.equal(h.requests[0].init.signal.aborted, true);
  release(ok(journey)); await flush();
  assert.doesNotMatch(text(h.render()), /Private switchboard upgrade/);
});
