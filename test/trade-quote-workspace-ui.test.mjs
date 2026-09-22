import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeQuoteWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const job = (id, quoteStatus = "draft", cents = 12345) => ({ id, workNumber: `JOB-${id}`, title: `Job ${id}`, customerDisplayName: "Customer name", quoteStatus, jobRegister: { quoteTotalExGstCents: cents } });
const response = (items = [job("one")], pagination = {}) => ({ ok: true, json: async () => ({ ok: true, items, pagination: { page: 1, pageSize: 25, total: items.length, pageCount: 1, hasNext: false, nextCursor: "", ...pagination } }) });

function harness(responder) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], opened = [];
  const exports = {};
  let created = 0;
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
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : {};
  const fetch = async (url, init) => { requests.push({ url, init }); return responder(url, init); };
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  const render = () => {
    cursor = 0;
    const tree = exports.TradeQuoteWorkspace({ user, onOpenJob: id => opened.push(id), onNewQuote: () => created++ });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  return { render, requests, opened, get created() { return created; }, async mount() { render(); await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("quotes use the authorised server index and preserve unquoted records and exact quote amounts", async t => {
  const h = harness(async () => response([job("draft"), job("none", "not_started", null), job("free", "accepted", 0)]));
  t.after(() => h.cleanup());
  const tree = await h.mount(), params = new URL(h.requests[0].url, "https://tlink.test").searchParams;
  assert.equal(params.get("mode"), "index"); assert.equal(params.get("resource"), "jobs"); assert.equal(params.get("filter"), "all");
  assert.equal(params.get("sort"), "updated-desc"); assert.equal(params.get("pageSize"), "25");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[0].init.cache, "no-store");
  assert.equal(nodes(tree, node => node.props?.role === "listitem").length, 3);
  assert.match(text(tree), /Not quoted/); assert.match(text(tree), /\$123\.45/); assert.match(text(tree), /\$0\.00/);
  assert.match(text(tree), /Quote total ex GST/);
  button(tree, "Open quote").props.onClick(); button(tree, "Open job").props.onClick(); button(tree, "New quote").props.onClick();
  assert.deepEqual(h.opened, ["draft", "none"]); assert.equal(h.created, 1);
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
