import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeCustomerHubPanel.tsx", import.meta.url), "utf8");
const crmSource = fs.readFileSync(new URL("../src/components/InstallerCrmWorkspace.tsx", import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const compiled = compile(source);
const qaCompiled = compile(`import {useRef,useEffect,useState} from 'react';
const registerStyles = {}; const TradeCustomerHubPanel = 'TradeCustomerHubPanel';
${crmSource.slice(crmSource.indexOf("function CustomerQa("))}
export {CustomerQa,CustomerQaJob};`);
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const toggle = tree => nodes(tree, node => node.props?.role === "switch")[0];
const textareas = tree => nodes(tree, node => node.type === "textarea");
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const question = { id: "question-one", prompt: "Where is the switchboard?", kind: "text", services: ["solar"], authorType: "customer",
  answer: "In the garage", replies: [{ id: "reply-one", body: "Thanks, that helps", authorType: "trade", createdAt: "2026-10-03" }],
  revision: 1, closed: false, files: [{ id: "file/one", name: "private-plan.pdf", type: "application/pdf" }] };
const view = { ok: true, available: true, accepting: true, interested: true, interestRevision: 4, canManageInterest: true,
  canAsk: true, workOrderId: "job-one", customerId: "customer-one", questions: [question] };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(t, api, options = {}) {
  let cursor = 0, dirty = false, props = options.props || { workOrderId: "job-one" }, ownerUid = "owner-one";
  const slots = [], effects = [], callbacks = [], queued = [], requests = [], listeners = new Map(), downloads = [];
  const changed = (before, after) => !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, dependencies) { const index = cursor++;
      if (changed(callbacks[index]?.dependencies, dependencies)) callbacks[index] = { callback, dependencies };
      return callbacks[index].callback; },
    useEffect(effect, dependencies) { const index = cursor++;
      if (changed(effects[index]?.dependencies, dependencies)) { effects[index]?.cleanup?.(); effects[index] = { dependencies };
        queued.push(() => { effects[index].cleanup = effect(); }); } },
  };
  const request = async (path, init = {}) => { requests.push({ path, init }); return api(path, init); };
  const loaded = {};
  Function("require", "exports", "window", "URL", "document", `${options.qa ? qaCompiled : compiled + "\nexports.Panel=Panel;"}`)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./TradeBusinessProvider") return { useTradeBusinessFetch: () => request, useTradeBusiness: () => ({ ownerUid }) };
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected trade hub UI dependency: ${name}`);
  }, loaded, {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    setTimeout: callback => { callback(); return 1; },
  }, { createObjectURL: () => "blob:download", revokeObjectURL() {} }, { createElement: () => ({ click() { downloads.push(this.download); } }) });
  const render = () => { cursor = 0; dirty = false; const tree = loaded[options.component || "Panel"](props);
    options.beforeEffects?.(tree); for (const effect of queued.splice(0)) effect(); return tree; };
  const settle = async () => { for (let attempt = 0; attempt < 8; attempt++) {
    const tree = render(); await flush(); if (!dirty) return tree;
  } assert.fail("Trade customer hub did not settle after eight renders"); };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { loaded, render, settle, cleanup, requests, listeners, downloads, setOwner: owner => { ownerUid = owner; }, setProps: next => { props = next; } };
}

test("tenant and job identities key separate workspaces with an encoded uncached read", async t => {
  const h = harness(t, async () => response(view), { props: { workOrderId: "job/one ?" } });
  const first = h.loaded.TradeCustomerHubPanel({ workOrderId: "job-one" });
  assert.equal(first.key, "owner-one:job-one");
  assert.notEqual(first.key, h.loaded.TradeCustomerHubPanel({ workOrderId: "job-two" }).key);
  h.setOwner("owner-two"); assert.notEqual(first.key, h.loaded.TradeCustomerHubPanel({ workOrderId: "job-one" }).key);
  assert.equal(h.loaded.TradeCustomerHubInterest({ matchId: "match-one" }).key, "owner-two:match:match-one");
  await h.settle(); assert.equal(h.requests[0].path, "/api/trade-customer-hub?workOrderId=job%2Fone%20%3F");
  assert.equal(h.requests[0].init.cache, "no-store");
});

test("visible segmented composer and starters prefill only, then one explicit Ask sends the scoped request", async t => {
  const pending = deferred();
  const h = harness(t, async (_path, init) => init.method === "POST" ? pending.promise : response(view));
  let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select").length, 0);
  assert.equal(nodes(tree, node => node.type === "details")[0].props.open, undefined, "Previous answers are initially collapsed");
  assert.equal(button(tree, "Ask customer").props.disabled, true);
  button(tree, "Switchboard photo").props.onClick(); tree = h.render();
  assert.equal(textareas(tree)[0].props.value, "Please share a clear photo of the switchboard.");
  assert.equal(button(tree, "Photo").props["aria-pressed"], true);
  assert.equal(h.requests.length, 1, "A starter must never auto-send");
  button(tree, "Ask customer").props.onClick(); button(tree, "Ask customer").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Adding…").props.disabled, true);
  const posts = h.requests.filter(item => item.init.method === "POST"); assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].init.body), { workOrderId: "job-one", prompt: "Please share a clear photo of the switchboard.", kind: "photo" });
  pending.resolve(response(view)); tree = await h.settle(); assert.equal(textareas(tree)[0].props.value, "");
});

test("an existing duplicate opens its response and prevents a second request", async t => {
  const h = harness(t, async () => response(view)); let tree = await h.settle();
  textareas(tree)[0].props.onChange({ target: { value: "  WHERE IS THE SWITCHBOARD?  " } }); tree = h.render();
  assert.equal(button(tree, "Ask customer").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "details")[0].props.open, true);
  assert.match(text(tree), /This request is already shared/); assert.match(text(tree), /In the garage/);
  button(tree, "Ask customer").props.onClick(); await flush(); assert.equal(h.requests.length, 1);
});

test("question and reply drafts survive refresh and a server duplicate conflict reuses the shared record", async t => {
  let current = view;
  const h = harness(t, async (_path, init) => {
    if (init.method === "POST") { current = { ...view, questions: [...view.questions, { ...question, id: "duplicate", prompt: "Share roof access details" }] };
      return response({ ok: false, error: "This question has already been shared." }, 409); }
    return response(current);
  });
  let tree = await h.settle();
  textareas(tree)[0].props.onChange({ target: { value: "Share roof access details" } });
  textareas(tree)[1].props.onChange({ target: { value: "Private draft reply" } }); tree = h.render();
  h.listeners.get("focus")(); tree = await h.settle();
  assert.equal(textareas(tree)[0].props.value, "Share roof access details"); assert.equal(textareas(tree)[1].props.value, "Private draft reply");
  button(tree, "Ask customer").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /This question has already been shared/); assert.equal(textareas(tree)[0].props.value, "Share roof access details");
  assert.equal(textareas(tree)[1].props.value, "Private draft reply"); assert.equal(button(tree, "Ask customer").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "details" && node.key === "duplicate")[0].props.open, true);
});

test("explicit interest PATCH uses its revision and a stale GET cannot turn updates back on", async t => {
  const background = deferred(), patch = deferred(); let reads = 0;
  const off = { ...view, interested: false, interestRevision: 5 };
  const h = harness(t, async (_path, init) => init.method === "PATCH" ? patch.promise
    : ++reads === 1 ? response(view) : reads === 2 ? background.promise : response(off));
  let tree = await h.settle(); h.listeners.get("focus")(); await flush();
  toggle(tree).props.onClick(); tree = h.render(); assert.equal(toggle(tree).props.disabled, true);
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "PATCH").init.body), { workOrderId: "job-one", interested: false, revision: 4 });
  h.listeners.get("focus")(); assert.equal(reads, 2);
  patch.resolve(response(off)); tree = await h.settle(); assert.equal(toggle(tree).props["aria-checked"], false);
  background.resolve(response(view)); tree = await h.settle(); assert.equal(toggle(tree).props["aria-checked"], false);
  assert.match(text(tree), /Existing quotes and records are unchanged/);
  assert.equal(textareas(tree)[0].props.disabled, true); assert.equal(button(tree, "Share reply"), undefined);
});

test("Interested adds the customer and opens exact Q&A in one click; off and re-on preserve the same record", async t => {
  const opened = [];
  let current = { ...view, interested: false, interestRevision: 0, workOrderId: "", questions: [] };
  const h = harness(t, async (_path, init) => { if (init.method === "PATCH") current = { ...view, interested: JSON.parse(init.body).interested, interestRevision: current.interestRevision + 1 }; return response(current); },
    { props: { matchId: "match/one", interestOnly: true, onOpenQa: target => opened.push(target) } });
  let tree = await h.settle(); assert.equal(h.requests[0].path, "/api/trade-customer-hub?matchId=match%2Fone");
  assert.equal(textareas(tree).length, 0); assert.equal(button(tree, "Ask customer"), undefined);
  button(tree, "Interested").props.onClick(); button(tree, "Interested").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Interested").props["aria-pressed"], true);
  assert.deepEqual(opened, [{ customerId: "customer-one", workOrderId: "job-one" }]);
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "PATCH").init.body), { matchId: "match/one", interested: true, revision: 0 });
  assert.equal(h.requests.some(item => item.init.method === "POST"), false);
  assert.equal(h.requests.filter(item => item.init.method === "PATCH").length, 1);
  button(tree, "Not interested").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Not interested").props["aria-pressed"], true); assert.equal(opened.length, 1);
  button(tree, "Interested").props.onClick(); tree = await h.settle();
  assert.equal(opened.length, 2); assert.deepEqual(opened[1], opened[0]);
  button(tree, "Interested").props.onClick(); assert.equal(opened.length, 3);
  assert.equal(h.requests.filter(item => item.init.method === "PATCH").length, 3, "Opening an already interested customer does not create another write");
});

test("lead interest failure and missing customer identity never navigate or report success", async t => {
  for (const result of [response({ ok: false, error: "Interest could not be saved." }, 409), response({ ...view, customerId: "" })]) {
    const opened = [];
    const h = harness(t, async (_path, init) => init.method === "PATCH" ? result : response({ ...view, interested: false }),
      { props: { matchId: "match-one", interestOnly: true, onOpenQa: target => opened.push(target) } });
    let tree = await h.settle(); button(tree, "Interested").props.onClick(); tree = await h.settle();
    assert.equal(opened.length, 0); assert.match(text(tree), /could not be/); assert.doesNotMatch(text(tree), /You're interested/);
  }
});

test("closed or permission-limited views retain existing answers and prevent asking and replying", async t => {
  for (const current of [{ ...view, accepting: false }, { ...view, canAsk: false, canManageInterest: false }]) {
    const h = harness(t, async () => response(current)); const tree = await h.settle();
    assert.match(text(tree), /In the garage/); assert.equal(button(tree, "Ask customer"), undefined);
    assert.equal(button(tree, "Share reply"), undefined); assert.equal(textareas(tree).length, 0);
    assert.equal(toggle(tree).props.disabled, !current.canManageInterest);
    if (!current.canManageInterest) { toggle(tree).props.onClick(); await flush(); assert.equal(h.requests.length, 1); }
  }
});

test("business replies are scoped and show roles without exposing competing business identities", async t => {
  const current = { ...view, questions: [{ ...question, business: "Competitor Secret", replies: [{ ...question.replies[0], business: "Other Competitor Secret" }] }] };
  const h = harness(t, async () => response(current)); let tree = await h.settle();
  assert.match(text(tree), /Asked by customer/); assert.match(text(tree), /Thanks, that helps/); assert.doesNotMatch(text(tree), /Competitor Secret/);
  textareas(tree)[0].props.onChange({ target: { value: "Keep this unrelated request draft" } });
  textareas(tree)[1].props.onChange({ target: { value: "  We can arrange access.  " } }); tree = h.render();
  button(tree, "Share reply").props.onClick(); tree = await h.settle();
  assert.deepEqual(JSON.parse(h.requests.find(item => item.init.method === "POST").init.body), { workOrderId: "job-one", action: "reply", questionId: "question-one", body: "We can arrange access." });
  assert.equal(textareas(tree)[0].props.value, "Keep this unrelated request draft"); assert.equal(textareas(tree)[1].props.value, "");
});

test("revoked refresh clears private content and an unmounted download never saves a file", async t => {
  let revoked = false;
  const h = harness(t, async () => revoked ? response({ ok: false, error: "This conversation is unavailable." }, 404) : response(view));
  let tree = await h.settle(); revoked = true; h.listeners.get("focus")(); tree = await h.settle();
  assert.doesNotMatch(text(tree), /In the garage|switchboard|private-plan/); assert.equal(toggle(tree), undefined);
  assert.match(text(tree), /unavailable/);
  const pending = deferred(); const d = harness(t, async path => path.includes("fileId=") ? pending.promise : response(view));
  tree = await d.settle(); button(tree, "private-plan.pdf").props.onClick(); d.cleanup();
  assert.equal(d.listeners.has("focus"), false);
  pending.resolve({ ok: true, status: 200, blob: async () => new Blob(["private"]) }); await flush();
  assert.deepEqual(d.downloads, []); assert.match(d.requests.at(-1).path, /fileId=file%2Fone/);
});

const job = { id: "job-one", crmCustomerId: "customer-one", sourceType: "public_lead", customerSource: "public_lead_released", recordStatus: "active", workNumber: "JOB-1", title: "Home upgrade" };
const target = { kind: "customer", id: "customer-one", customerSection: "qa", workOrderId: "job-one", nonce: 12 };

test("customer Q&A includes only this customer's released, active TLink jobs and focuses the exact notification once", async t => {
  const focused = [], applied = [], entries = new Map(); const section = { open: false };
  const entry = id => { if (!entries.has(id)) entries.set(id, { open: false, scrollIntoView: () => focused.push(`scroll:${id}`), querySelector: () => ({ focus: () => focused.push(`focus:${id}`) }) }); return entries.get(id); };
  const jobs = [job, { ...job, id: "other-customer", crmCustomerId: "customer-two" }, { ...job, id: "trade-owned", customerSource: "trade_owned" },
    { ...job, id: "protected", customerSource: "platform_private" }, { ...job, id: "other-source", sourceType: "manual" }, { ...job, id: "archived", recordStatus: "archived" }];
  const h = harness(t, async () => response(view), { qa: true, component: "CustomerQa", props: { customerId: "customer-one", jobs, target, onNavigationApplied: nonce => applied.push(nonce) },
    beforeEffects(tree) { if (!tree) return; tree.props.ref.current = section;
      for (const node of nodes(tree, node => typeof node.type === "function" && node.type.name === "CustomerQaJob")) node.props.register(entry(node.props.job.id)); } });
  let tree = await h.settle(); const children = nodes(tree, node => typeof node.type === "function" && node.type.name === "CustomerQaJob");
  assert.deepEqual(children.map(node => node.props.job.id), ["job-one"]);
  assert.equal(section.open, true); assert.equal(entries.get("job-one").open, true);
  assert.deepEqual(focused, ["scroll:job-one", "focus:job-one"]); assert.deepEqual(applied, [12]);
  tree = await h.settle(); assert.equal(focused.length, 2);
  h.setProps({ customerId: "customer-one", jobs, target: { ...target, workOrderId: "other-customer", nonce: 13 }, onNavigationApplied: nonce => applied.push(nonce) });
  tree = await h.settle(); assert.match(text(tree), /no longer available in this customer record/); assert.equal(focused.length, 2); assert.deepEqual(applied, [12]);
});

test("a customer record mounts its job conversation on first expansion and preserves it when collapsed", async t => {
  const h = harness(t, async () => response(view), { qa: true, component: "CustomerQaJob", props: { job, register() {} } });
  let tree = await h.settle(); assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel").length, 0);
  tree.props.onToggle({ currentTarget: { open: true } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel")[0].props.workOrderId, "job-one");
  tree.props.onToggle({ currentTarget: { open: false } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "TradeCustomerHubPanel")[0].props.workOrderId, "job-one");
});
