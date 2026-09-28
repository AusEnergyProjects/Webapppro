import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as quote from "../src/lib/trade-quote.ts";

const source = fs.readFileSync(new URL("../src/components/TradeQuoteStockNotice.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = (patch = {}) => ({ itemId: "panel", itemCode: "PB-1", name: "Solar panel", itemType: "material", unitLabel: "each", recordStatus: "active", tracked: true, onHandMilli: 12000, reservedMilli: 3000, availableMilli: 9000, lowStockMilli: 0, revision: 1, ...patch });
const line = (quantity = "12", priceBookItemId = "panel") => ({ priceBookItemId, quantity, lineType: "product", description: "Solar panel", unitPrice: "100", taxCode: "gst", sectionHeading: "Included work" });
const choice = (key, count) => ({ clientKey: key, name: key, kind: "choose_one", groupKey: "panels", summary: "", recommended: false, lines: [line(count)] });

function harness(t, options = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const fetch = async (url, init) => { requests.push({ url, init }); return options.respond ? options.respond(url, init) : Response.json({ ok: true, items: [item()], canManage: true }); };
  Function("require", "exports", "fetch", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-quote" ? quote : { default: {} }, exports, fetch);
  const props = { user: { uid: "owner", getIdToken: async () => "token" }, lines: [line()], choices: [], ...options.props };
  const render = () => { cursor = 0; const tree = exports.TradeQuoteStockNotice(props); for (const effect of pending.splice(0)) effect(); return tree; };
  t.after(() => { for (const effect of effects) effect?.cleanup?.(); });
  return { props, requests, warnings: exports.quoteStockWarnings, render, async settle() { let tree; for (let i = 0; i < 4; i++) { tree = render(); await tick(); } return tree; } };
}

test("shortage is a read-only reminder that updates with quantity without another request", async t => {
  const h = harness(t); let tree = await h.settle();
  assert.equal(tree.props.role, "status"); assert.equal(tree.props["aria-live"], "polite"); assert.match(text(tree), /Stock to order/); assert.match(text(tree), /3\s+items\s+short/); assert.match(text(tree), /You can still send this quote/);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].init.headers.Authorization, "Bearer token"); assert.equal(h.requests[0].init.method, undefined);
  assert.deepEqual(nodes(tree, node => node.type === "button").map(node => text(node)), ["Refresh stock"]);
  h.props.lines = [line("9")]; assert.equal(h.render(), null); h.props.lines = [line("14")]; tree = h.render(); assert.match(text(tree), /5\s+items\s+short/); assert.equal(h.requests.length, 1);
});

test("included duplicate product lines are summed while alternatives are checked separately", async t => {
  const h = harness(t);
  const base = h.warnings([line("5"), line("7")], [], [item()]); assert.equal(base.length, 1); assert.equal(base[0].shortageMilli, 3000);
  const alternatives = h.warnings([line("2")], [choice("Option A", "8"), choice("Option B", "9")], [item()]);
  assert.deepEqual(alternatives.map(row => [row.scope, row.shortageMilli]), [["With Option A", 1000], ["With Option B", 2000]]);
  assert.equal(h.warnings([], [choice("Option A", "8"), choice("Option B", "9")], [item()]).length, 0);
});

test("untracked products, custom systems and invalid draft quantities produce no stock warning", async t => {
  const h = harness(t, { respond: () => Response.json({ ok: true, items: [item({ tracked: false })], canManage: true }) });
  assert.equal(await h.settle(), null);
  for (const quantity of ["", "-2", "bad", "1.0001"]) assert.deepEqual(h.warnings([line(quantity)], [], [item()]), []);
  assert.deepEqual(h.warnings([line("100", "")], [], [item()]), []);
  const custom = harness(t, { props: { lines: [line("1", "")] } }); assert.equal(await custom.settle(), null); assert.equal(custom.requests.length, 0);
});

test("network or permission failures never claim zero stock and do not require confirmation", async t => {
  for (const status of [403, 503]) {
    const h = harness(t, { respond: () => Response.json({ ok: false, error: "Unavailable" }, { status }) });
    const tree = await h.settle(); assert.match(text(tree), /Stock could not be checked/); assert.match(text(tree), /You can still save and send/); assert.doesNotMatch(text(tree), /Stock to order|items short/);
    assert.deepEqual(nodes(tree, node => node.type === "button").map(node => text(node)), ["Check stock again"]); assert.equal(nodes(tree, node => node.type === "input").length, 0);
  }
});

test("refresh after a delivery removes the warning when availability covers the quote", async t => {
  let available = 9000;
  const h = harness(t, { respond: () => Response.json({ ok: true, items: [item({ availableMilli: available })], canManage: true }) }); let tree = await h.settle();
  available = 12000; nodes(tree, node => node.type === "button")[0].props.onClick(); tree = await h.settle(); assert.equal(tree, null); assert.equal(h.requests.length, 2);
});

test("a late request for previous products cannot replace the current stock check", async t => {
  let first;
  const h = harness(t, { respond: () => h.requests.length === 1 ? new Promise(resolve => { first = resolve; }) : Response.json({ ok: true, items: [item({ itemId: "other", name: "Heat pump", availableMilli: 0 })], canManage: false }) });
  await h.settle(); h.props.lines = [line("2", "other")]; let tree = await h.settle(); assert.match(text(tree), /Heat pump/);
  first(Response.json({ ok: true, items: [item()], canManage: true })); tree = await h.settle(); assert.match(text(tree), /Heat pump/); assert.doesNotMatch(text(tree), /Solar panel/);
});
