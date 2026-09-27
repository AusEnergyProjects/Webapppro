import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/TradeMapNewQuote.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(responder, canCreateCustomer = true) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], created = [], dirty = [], busy = [], exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => state[index] = typeof value === "function" ? value(state[index]) : value]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!state[index] || deps.some((value, i) => value !== state[index].deps[i])) state[index] = { callback, deps }; return state[index].callback; },
    useEffect(callback, deps) { const index = cursor++, previous = effects[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { previous?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: {} } : {};
  const fetch = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return responder(url, init); };
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  const props = { user: { uid: "account-1", getIdToken: async () => "account-token" }, canCreateCustomer, measurementKind: "area", onCreated: id => created.push(id), onBusyChange: value => busy.push(value), onDirtyChange: value => dirty.push(value) };
  function render() { cursor = 0; const tree = exports.TradeMapNewQuote(props); for (const effect of pending.splice(0)) effect(); return tree; }
  function enter(label, value, checked) { const tree = render(); const field = nodes(nodes(tree, n => n.type === "label" && text(n).trim().startsWith(label))[0], n => ["input", "select", "textarea"].includes(n.type))[0]; assert.ok(field, label); field.props.onChange({ target: { value, checked } }); return render(); }
  return { render, enter, requests, created, busy, dirty, cleanup() { for (const effect of effects) effect?.cleanup?.(); }, async submit() { await render().props.onSubmit({ preventDefault() {} }); await flush(); return render(); } };
}

function newCustomer(h) {
  button(h.render(), "New customer").props.onClick(); h.render();
  h.enter("First name", "Casey"); h.enter("Email", "casey@example.test"); h.enter("Mobile number", "0412 345 678");
  h.enter("Enter address manually", "", true); h.enter("Street address", "1 Example Road");
  h.enter("Suburb", "Melbourne"); h.enter("State", "VIC"); h.enter("Postcode", "3000");
}

test("new map quote keeps an uncertain retry on exactly the same customer/job request", async t => {
  const h = harness(async () => { if (h.requests.length === 1) throw new Error("Network disconnected after submit"); return { ok: true, status: 201, json: async () => ({ ok: true, id: "quick-quote-1" }) }; });
  t.after(() => h.cleanup()); newCustomer(h);
  let tree = await h.submit();
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  assert.ok(button(tree, "Retry create quote"));
  tree = await h.submit();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0].body, h.requests[1].body);
  assert.match(h.requests[0].body.clientRequestId, /^[A-Za-z0-9_-]{16,120}$/);
  assert.equal(h.requests[0].body.serviceCategory, "insulation");
  assert.equal(h.requests[0].body.addressEntryMode, "manual_pending_review");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer account-token");
  assert.deepEqual(h.created, ["quick-quote-1"]);
  assert.equal(h.dirty.at(-1), false);
});

test("known validation failure unlocks correction and starts a fresh logical request", async t => {
  const h = harness(async () => h.requests.length === 1 ? { ok: false, status: 400, json: async () => ({ error: "Fix customer details" }) } : { ok: true, status: 201, json: async () => ({ ok: true, id: "quick-quote-2" }) });
  t.after(() => h.cleanup()); newCustomer(h);
  const tree = await h.submit();
  assert.match(text(tree), /Fix customer details/); assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, false);
  h.enter("First name", "Corrected"); await h.submit();
  assert.notEqual(h.requests[0].body.clientRequestId, h.requests[1].body.clientRequestId);
  assert.equal(h.requests[1].body.firstName, "Corrected"); assert.deepEqual(h.created, ["quick-quote-2"]);
});

test("customer creation stays unavailable without permission and empty browsing is not dirty", t => {
  const h = harness(async () => { throw new Error("Must not submit"); }, false);
  t.after(() => h.cleanup()); let tree = h.render();
  assert.equal(button(tree, "New customer"), undefined); assert.equal(h.dirty.at(-1), false);
  h.enter("Find a customer", ""); tree = h.render(); assert.equal(h.dirty.at(-1), false);
  assert.equal(button(tree, "Create quote").props.disabled, true); assert.equal(h.requests.length, 0);
});

test("unconfirmed address needs an explicit manual choice before creation", async t => {
  const h = harness(async () => { throw new Error("Must not submit"); }); t.after(() => h.cleanup());
  newCustomer(h); h.enter("Enter address manually", "", false);
  const tree = await h.submit(); assert.equal(h.requests.length, 0); assert.match(text(tree), /address suggestion|manually/i);
});
