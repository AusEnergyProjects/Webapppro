import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as quoteIndex from "../src/lib/trade-crm-quote-index.ts";

const source = fs.readFileSync(new URL("../src/components/TradeQuoteWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const job = (id, status = "draft", cents = 12345) => ({ id, workNumber: `JOB-${id}`, title: `Job ${id}`, customerName: "Customer name", status, versionNumber: status === "not_started" ? null : 1, quoteNumber: "", totalCents: cents, hasChoices: false, latestIssued: null, delivery: null });
const response = (items = [job("one")], pagination = {}) => ({ ok: true, json: async () => ({ ok: true, items, access: { permissions: { canManageQuotes: true, jobScope: "team" } }, counts: { preparing: items.length, awaiting: 0, accepted: 0, history: 0 }, pagination: { page: 1, pageSize: 25, total: items.length, pageCount: 1, hasNext: false, nextCursor: "", ...pagination } }) });

function harness(responder) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], opened = [];
  const exports = {};
  let created = 0;
  let business = { ownerUid: "owner-1" };
  const user = { uid: "owner-1", getIdToken: async () => "token" };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], next => state[index] = typeof next === "function" ? next(state[index]) : next];
    },
    useEffect(callback, deps) {
      const index = cursor++, old = effects[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        old?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback());
      }
    },
  };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-crm-quote-index" ? quoteIndex : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => business } : { default: {} };
  const fetch = async (url, init) => { requests.push({ url, init }); return responder(url, init); };
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  const render = () => {
    cursor = 0;
    const tree = exports.TradeQuoteWorkspace({ user, onOpenJob: (id, tab) => opened.push({ id, tab }), onNewQuote: () => created++ });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  return { render, requests, opened, setBusiness(ownerUid) { business = { ownerUid }; }, get created() { return created; }, async mount() { render(); await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("quotes use the dedicated server index and preserve explicit preparation records and exact quote amounts", async t => {
  const h = harness(async () => response([job("draft"), job("none", "not_started", null), job("free", "accepted", 0)]));
  t.after(() => h.cleanup());
  const tree = await h.mount(), params = new URL(h.requests[0].url, "https://tlink.test").searchParams;
  assert.equal(params.get("mode"), "index"); assert.equal(params.get("resource"), "quotes"); assert.equal(params.get("view"), "preparing");
  assert.equal(params.has("filter"), false); assert.equal(params.get("pageSize"), "25");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[0].init.cache, "no-store");
  assert.equal(nodes(tree, node => node.props?.role === "listitem").length, 3);
  assert.match(text(tree), /Not priced/); assert.match(text(tree), /\$123\.45/); assert.match(text(tree), /\$0\.00/);
  assert.match(text(tree), /Quote total incl GST/);
  button(tree, "Open quote").props.onClick(); button(tree, "Prepare quote").props.onClick(); button(tree, "New quote").props.onClick();
  assert.deepEqual(h.opened, [{ id: "draft", tab: "quote" }, { id: "none", tab: "quote" }]); assert.equal(h.created, 1);
});

test("pagination uses server cursors and search resets to the first page", async t => {
  const h = harness(async url => {
    const params = new URL(url, "https://tlink.test").searchParams;
    return params.get("page") === "2" ? response([job("last")], { page: 2, total: 26, pageCount: 2 }) : response([job("first", "not_started", null)], { total: 26, pageCount: 2, hasNext: true, nextCursor: "server-cursor" });
  });
  t.after(() => h.cleanup());
  let tree = await h.mount();
  assert.equal(button(tree, "Previous").props.disabled, true); assert.equal(button(tree, "Next").props.disabled, false);
  button(tree, "Next").props.onClick(); h.render(); await flush(); tree = h.render();
  let params = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(params.get("page"), "2"); assert.equal(params.get("cursor"), "server-cursor");
  assert.match(text(tree), /JOB-last/); assert.equal(button(tree, "Next").props.disabled, true);
  button(tree, "Previous").props.onClick(); h.render(); await flush(); tree = h.render();
  assert.equal(new URL(h.requests.at(-1).url, "https://tlink.test").searchParams.has("cursor"), false);
  button(tree, "Next").props.onClick(); h.render(); await flush(); tree = h.render();
  nodes(tree, node => node.type === "input")[0].props.onChange({ target: { value: "  James  " } }); tree = h.render();
  const beforeSubmit = h.requests.length;
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render(); await flush(); tree = h.render();
  assert.equal(h.requests.length, beforeSubmit + 1);
  params = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(params.get("search"), "James"); assert.equal(params.get("page"), "1"); assert.equal(params.has("cursor"), false);
  assert.ok(button(tree, "Clear")); assert.match(text(tree), /JOB-first/);
});

test("errors hide stale rows, expose retry and recover without reporting an empty list", async t => {
  let fail = false;
  const h = harness(async () => fail ? { ok: false, json: async () => ({ error: "Quotes unavailable" }) } : response());
  t.after(() => h.cleanup());
  let tree = await h.mount(); fail = true;
  button(tree, "Refresh").props.onClick(); h.render(); await flush(); tree = h.render();
  assert.match(text(tree), /Quotes unavailable/); assert.doesNotMatch(text(tree), /JOB-one|No jobs to quote/);
  assert.equal(nodes(tree, node => node.props?.role === "alert").length, 1);
  fail = false; button(tree, "Try again").props.onClick(); h.render(); await flush(); tree = h.render();
  assert.match(text(tree), /JOB-one/); assert.equal(button(tree, "Try again"), undefined);
});

test("late search responses cannot replace the latest results", async t => {
  let release;
  const h = harness(async () => h.requests.length === 1 ? new Promise(resolve => release = resolve) : response([job("latest")]));
  t.after(() => h.cleanup());
  let tree = h.render(); await flush();
  nodes(tree, node => node.type === "input")[0].props.onChange({ target: { value: "Latest" } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render(); await flush(); tree = h.render();
  assert.equal(h.requests[0].init.signal.aborted, true); assert.match(text(tree), /JOB-latest/);
  release(response([job("old")])); await flush(); tree = h.render();
  assert.match(text(tree), /JOB-latest/); assert.doesNotMatch(text(tree), /JOB-old/);
});

test("a missing continuation cursor is an error instead of silently hiding later jobs", async t => {
  const h = harness(async () => response([job("first")], { total: 30, pageCount: 2, hasNext: true, nextCursor: "" }));
  t.after(() => h.cleanup());
  const tree = await h.mount();
  assert.match(text(tree), /quote list could not be loaded/); assert.ok(button(tree, "Try again"));
  assert.equal(button(tree, "Next"), undefined);
});

test("view changes reset pagination and accepted quotes open existing job preparation", async t => {
  const h = harness(async url => {
    const view = new URL(url, "https://tlink.test").searchParams.get("view");
    return response([job(view, view === "accepted" ? "accepted" : "draft")], { total: 26, pageCount: 2, hasNext: true, nextCursor: "first-page" });
  });
  t.after(() => h.cleanup());
  let tree = await h.mount(); button(tree, "Next").props.onClick(); h.render(); await flush(); tree = h.render();
  nodes(tree, node => node.type === "button" && text(node).startsWith("Accepted"))[0].props.onClick(); h.render(); await flush(); tree = h.render();
  const params = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(params.get("view"), "accepted"); assert.equal(params.get("page"), "1"); assert.equal(params.has("cursor"), false);
  button(tree, "Prepare job").props.onClick(); assert.deepEqual(h.opened, [{ id: "accepted", tab: "summary" }]);
});

test("issued delivery is distinct from customer decision while preparing a replacement", async t => {
  const item = { ...job("draft"), versionNumber: 2, latestIssued: { versionNumber: 1, status: "issued", issuedAt: "2026-10-02T03:00:00.000Z", decidedAt: "" }, delivery: { status: "provider_accepted", label: "Email accepted for delivery" } };
  const h = harness(async () => response([item])); t.after(() => h.cleanup());
  const tree = await h.mount();
  assert.match(text(tree), /Version 2/); assert.match(text(tree), /Version\s+1\s+:.*Awaiting customer/);
  assert.match(text(tree), /Email accepted for delivery/); assert.doesNotMatch(text(tree), /Overdue|Schedule this job/);
});

test("switching business hides prior customer and quote data before the replacement fetch settles", async t => {
  let release;
  const h = harness(async () => h.requests.length === 1 ? response([job("previous-business")]) : new Promise(resolve => release = resolve)); t.after(() => h.cleanup());
  let tree = await h.mount(); assert.match(text(tree), /JOB-previous-business/);
  h.setBusiness("other-business"); tree = h.render(); assert.doesNotMatch(text(tree), /JOB-previous-business|Customer name|\$123/); assert.match(text(tree), /Loading quotes/);
  await flush(); release(response([job("new-business")])); await flush(); tree = h.render(); assert.match(text(tree), /JOB-new-business/);
});
