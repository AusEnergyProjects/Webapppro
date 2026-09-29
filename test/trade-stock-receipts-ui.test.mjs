import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/trade-stock-receipts.ts";

const code = ts.transpileModule(fs.readFileSync(new URL("../src/components/TradeStockReceiptUpload.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const receipt = { id: "receipt", fileName: "delivery.pdf", status: "review", extraction: { supplier: "Vendor", reference: "INV-1", kind: "invoice", lines: [], warnings: [] }, lines: [{ description: "Pump", unit: "each", itemId: "pump", quantityMilli: 3000 }], createdAt: "now", receivedAt: "", analysisError: "" };
const workspace = { ok: true, products: [{ id: "pump", name: "Pump", unit: "each", code: "PB-PUMP", revision: 1 }], locations: [{ id: "main", name: "Main", isDefault: true }], receipts: [receipt], receipt: null };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, respond) {
  const state = [], effects = [], queue = [], requests = []; let cursor = 0, updates = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
    useRef(initial) { const i = cursor++; return state[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!state[i] || deps.some((value, index) => value !== state[i].deps[index])) state[i] = { fn, deps }; return state[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((value, index) => value !== effects[i].deps[index])) { effects[i]?.cleanup?.(); effects[i] = { deps }; queue.push(() => { effects[i].cleanup = fn(); }); } },
  };
  const fetch = async (url, init) => { requests.push({ url, init }); return respond(url, init); };
  const exports = {}, user = { getIdToken: async () => "test" };
  Function("require", "exports", "fetch", code)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-stock-receipts" ? contract : { default: {} }, exports, fetch);
  function render() { cursor = 0; const tree = exports.TradeStockReceiptUpload({ user, onReceived: () => updates++ }); for (const fn of queue.splice(0)) fn(); return tree; }
  t.after(() => { for (const effect of effects) effect?.cleanup?.(); });
  return { render, requests, updates: () => updates, async settle() { let tree; for (let i = 0; i < 4; i++) { tree = render(); await tick(); } return tree; } };
}

test("unknown receiving result freezes edits and retries the identical confirmation", async t => {
  let attempts = 0;
  const received = { ...receipt, status: "received", receivedAt: "2026-09-28T12:00:00Z", confirmed: { supplier: "Vendor", reference: "INV-1", locationId: "main", lines: [{ itemId: "pump", name: "Pump", unit: "each", quantityMilli: 3000 }] } };
  const h = harness(t, async (url, init) => {
    if (init.method === "POST") { if (++attempts === 1) throw new Error("Response lost"); return Response.json({ ok: true, received: true }); }
    return Response.json(url.includes("receiptId") ? { ...workspace, receipt: received } : workspace);
  });
  let tree = h.render(); button(tree, "Receive from supplier PDF").props.onClick(); tree = await h.settle();
  button(tree, "delivery.pdf").props.onClick(); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); tree = h.render();
  button(tree, "Confirm received").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  assert.equal(button(tree, "Another document").props.disabled, true);
  assert.match(text(tree), /quantities are locked/);
  button(tree, "Retry same confirmation").props.onClick(); tree = await h.settle();
  const posts = h.requests.filter(request => request.init.method === "POST");
  assert.equal(posts.length, 2); assert.equal(posts[0].init.body, posts[1].init.body);
  assert.equal(JSON.parse(posts[0].init.body).lines[0].expectedRevision, 1);
  assert.equal(button(tree, "Confirm received"), undefined); assert.match(text(tree), /3\s+each/); assert.equal(h.updates(), 1);
});

test("fractional precision cannot be silently rounded during manual receiving", async t => {
  const h = harness(t, async () => Response.json(workspace));
  let tree = h.render(); button(tree, "Receive from supplier PDF").props.onClick(); tree = await h.settle();
  button(tree, "delivery.pdf").props.onClick(); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.onChange({ target: { value: "1.2349" } });
  nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); tree = h.render();
  assert.equal(button(tree, "Confirm received").props.disabled, true);
  assert.equal(h.requests.some(request => request.init.method === "POST"), false);
});
