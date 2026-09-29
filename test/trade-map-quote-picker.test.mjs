import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as mapQuote from "../src/lib/trade-map-quote.ts";

const source = fs.readFileSync(new URL("../src/components/TradeMapQuoteDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { QuotePicker };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const job = (id, overrides = {}) => ({ id, workNumber: `JOB-${id}`, title: `Roof ${id}`, customerDisplayName: "Customer", customerSource: "trade_owned", sourceType: "direct", crmCustomerId: "customer-1", serviceSiteId: "site-1", quoteStatus: "not_started", jobRegister: { streetAddress: "1 Example Road", suburb: "Melbourne", state: "VIC", postcode: "3000" }, ...overrides });
const response = (items, pagination = {}) => ({ ok: true, json: async () => ({ ok: true, items, pagination: { pageCount: 1, hasNext: false, nextCursor: "", ...pagination } }) });
function harness(responder) {
  let cursor = 0;
  const states = [], effects = [], pending = [], requests = [], selected = [], exports = {};
  const user = { uid: "account-1", getIdToken: async () => "account-token" };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => states[index] = typeof value === "function" ? value(states[index]) : value]; },
    useEffect(callback, deps) { const index = cursor++, previous = effects[index]; if (!previous || deps.some((value, i) => previous.deps[i] !== value)) { previous?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-map-quote" ? mapQuote : id.endsWith(".module.css") ? { default: {} } : {};
  const fetch = async (url, init) => { requests.push({ url, init }); return responder(url, init); };
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  function render() { cursor = 0; const tree = exports.QuotePicker({ user, onSelect: id => selected.push(id) }); for (const effect of pending.splice(0)) effect(); return tree; }
  return { requests, selected, render, async mount() { render(); await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("map quote picker searches the authenticated index and never offers restricted jobs", async t => {
  const h = harness(async () => response([job("direct"), job("private", { customerSource: "platform_private", sourceType: "opportunity" }), job("restricted", { quoteStatus: "restricted" })]));
  t.after(() => h.cleanup()); const tree = await h.mount();
  const params = new URL(h.requests[0].url, "https://tlink.test").searchParams;
  assert.equal(params.get("resource"), "jobs"); assert.equal(params.get("pageSize"), "25");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer account-token");
  assert.match(text(tree), /JOB-direct/); assert.doesNotMatch(text(tree), /JOB-private|JOB-restricted/);
  nodes(tree, node => node.type === "button" && text(node).includes("JOB-direct"))[0].props.onClick();
  assert.deepEqual(h.selected, ["direct"]);
});

test("late search cannot restore old customers or hide an index failure", async t => {
  let release;
  const h = harness(async () => h.requests.length === 1 ? new Promise(resolve => release = resolve) : { ok: false, json: async () => ({ error: "Could not load quotes" }) });
  t.after(() => h.cleanup()); let tree = h.render(); await flush();
  nodes(tree, node => node.type === "input")[0].props.onChange({ target: { value: "Another customer" } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render(); await flush();
  release(response([job("stale")])); await flush(); tree = h.render();
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.match(text(tree), /Could not load quotes/); assert.doesNotMatch(text(tree), /JOB-stale/);
  assert.ok(button(tree, "Try again"));
});

test("next page uses the server cursor and malformed continuation fails visibly", async t => {
  const h = harness(async () => h.requests.length === 1 ? response([job("first")], { pageCount: 2, hasNext: true, nextCursor: "cursor-2" }) : response([job("bad")], { pageCount: 3, hasNext: true, nextCursor: "" }));
  t.after(() => h.cleanup()); let tree = await h.mount();
  button(tree, "Next").props.onClick(); h.render(); await flush(); tree = h.render();
  const params = new URL(h.requests.at(-1).url, "https://tlink.test").searchParams;
  assert.equal(params.get("page"), "2"); assert.equal(params.get("cursor"), "cursor-2");
  assert.match(text(tree), /Could not load the quote list/); assert.doesNotMatch(text(tree), /JOB-first|JOB-bad/);
});
