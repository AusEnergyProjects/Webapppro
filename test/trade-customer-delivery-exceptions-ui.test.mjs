import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeCustomerDeliveryExceptions.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = id => ({ id, workOrderId: id, workNumber: `JOB-${id}`, jobTitle: "Work", label: "Invoice email", status: "uncertain", message: "Check the outgoing mailbox before sending another copy.", tab: "invoice" });
const response = (items = [item("one")], extra = {}) => ({ ok: true, json: async () => ({ ok: true, items, total: items.length, page: 1, hasNext: false, ...extra }) });
function harness(responder) {
  let cursor = 0;
  let business = { ownerUid: "owner" };
  const state = [], effects = [], pending = [], requests = [], opened = [], exports = {};
  const user = { uid: "owner", getIdToken: async () => "token" };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], next => state[index] = typeof next === "function" ? next(state[index]) : next]; },
    useEffect(callback, deps) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const fetch = async (url, init) => { requests.push({ url, init }); return responder(url, init); };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => business } : { default: {} };
  Function("require", "exports", compiled)(require, exports);
  const render = (workOrderId = "") => { cursor = 0; const tree = exports.TradeCustomerDeliveryExceptions({ user, workOrderId, onOpenJob: (id, tab) => opened.push({ id, tab }) }); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, opened, setBusiness(ownerUid) { business = { ownerUid }; }, async mount(id = "") { render(id); await flush(); return render(id); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("delivery exceptions show actual action and open its source without sending anything", async t => {
  const h = harness(async () => response()); t.after(() => h.cleanup());
  const tree = await h.mount("one"), request = h.requests[0];
  assert.equal(new URL(request.url, "https://tlink.test").searchParams.get("workOrderId"), "one");
  assert.equal(request.init.headers.Authorization, "Bearer token"); assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.method, undefined); assert.match(text(tree), /Check the outgoing mailbox/);
  button(tree, "Review").props.onClick(); assert.deepEqual(h.opened, [{ id: "one", tab: "invoice" }]); assert.equal(h.requests.length, 1);
  assert.equal(button(tree, "Send"), undefined); assert.equal(button(tree, "Retry"), undefined);
});

test("failed refresh hides stale items and never reports that delivery is clear", async t => {
  let fail = false;
  const h = harness(async () => fail ? { ok: false, json: async () => ({ ok: false, error: "Could not check emails" }) } : response()); t.after(() => h.cleanup());
  let tree = await h.mount(); fail = true; button(tree, "Refresh").props.onClick(); h.render(); await flush(); tree = h.render();
  assert.match(text(tree), /Could not check emails/); assert.doesNotMatch(text(tree), /JOB-one|No failed/); assert.equal(nodes(tree, node => node.props?.role === "alert").length, 1);
  fail = false; button(tree, "Refresh").props.onClick(); h.render(); await flush(); tree = h.render(); assert.match(text(tree), /JOB-one/);
});

test("pagination is server-backed and a previous job response cannot overwrite the current job", async t => {
  let release;
  const h = harness(async url => {
    const params = new URL(url, "https://tlink.test").searchParams;
    if (params.get("workOrderId") === "old") return new Promise(resolve => release = resolve);
    return response([item(params.get("page") === "2" ? "last" : "current")], { total: 11, hasNext: params.get("page") !== "2" });
  }); t.after(() => h.cleanup());
  h.render("old"); await flush(); h.render("current"); await flush(); let tree = h.render("current");
  release(response([item("old")])); await flush(); tree = h.render("current"); assert.match(text(tree), /JOB-current/); assert.doesNotMatch(text(tree), /JOB-old/);
  button(tree, "Next").props.onClick(); h.render("current"); await flush(); tree = h.render("current");
  assert.equal(new URL(h.requests.at(-1).url, "https://tlink.test").searchParams.get("page"), "2"); assert.match(text(tree), /JOB-last/); assert.equal(button(tree, "Next").props.disabled, true);
});

test("switching business immediately removes the previous business delivery records", async t => {
  let release;
  const h = harness(async () => h.requests.length === 1 ? response([item("previous-business")]) : new Promise(resolve => release = resolve)); t.after(() => h.cleanup());
  let tree = await h.mount(); assert.match(text(tree), /JOB-previous-business/);
  h.setBusiness("other-business"); tree = h.render(); assert.doesNotMatch(text(tree), /JOB-previous-business/); assert.match(text(tree), /Checking delivery records/);
  await flush(); release(response([item("new-business")])); await flush(); tree = h.render(); assert.match(text(tree), /JOB-new-business/);
});
