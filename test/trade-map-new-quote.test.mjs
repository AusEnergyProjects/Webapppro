import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as catalogue from "../src/lib/energy-service-catalogue.mjs";

const source = fs.readFileSync(new URL("../src/components/TradeMapNewQuote.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
const quickSource = fs.readFileSync(new URL("../src/components/TradeQuickQuoteForm.tsx", import.meta.url), "utf8");
const quickCompiled = ts.transpileModule(quickSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(responder, canCreateCustomer = true, options = {}) {
  let cursor = 0;
  const state = [], effects = [], pending = [], requests = [], created = [], dirty = [], busy = [], exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => state[index] = typeof value === "function" ? value(state[index]) : value]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!state[index] || deps.some((value, i) => value !== state[index].deps[i])) state[index] = { callback, deps }; return state[index].callback; },
    useEffect(callback, deps) { const index = cursor++, previous = effects[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { previous?.cleanup?.(); effects[index] = { deps }; pending.push(() => effects[index].cleanup = callback()); } },
  };
  const quickExports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => fetch } : id === "./TradeQuickQuoteForm" ? quickExports : id === "@/lib/energy-service-catalogue.mjs" ? catalogue : id.endsWith(".module.css") ? { default: {} } : {};
  const fetch = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return responder(url, init); };
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  Function("require", "exports", quickCompiled)(require, quickExports);
  const props = { user: { uid: "account-1", getIdToken: options.getIdToken || (async () => "account-token") }, canCreateCustomer, measurementKind: "area", onCreated: id => created.push(id), onBusyChange: value => busy.push(value), onDirtyChange: value => dirty.push(value), ...options.props };
  function render() { cursor = 0; const child = options.generic ? null : exports.TradeMapNewQuote(props); const tree = quickExports.TradeQuickQuoteForm(child ? child.props : props); for (const effect of pending.splice(0)) effect(); return tree; }
  function enter(label, value, checked) { const tree = render(); const field = nodes(nodes(tree, n => n.type === "label" && text(n).trim().startsWith(label))[0], n => ["input", "select", "textarea"].includes(n.type))[0]; assert.ok(field, label); field.props.onChange({ target: { value, checked } }); const fieldset = nodes(tree, n => n.type === "fieldset")[0]; if (nodes(fieldset, n => n === field).length) fieldset.props.onChange?.(); return render(); }
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

const savedCustomer = (site = "chosen-site") => ({ customerId: "saved-customer", customerNumber: "CUS-42", displayName: "Casey Saved", email: "saved@example.test", phone: "0412345678", serviceSiteId: site, siteLabel: site, addressLine1: "42 Saved Street", addressLine2: "Unit 2", suburb: "Melbourne", addressState: "VIC", postcode: "3000" });
const success = { ok: true, status: 201, json: async () => ({ ok: true, id: "saved-quote" }) };

test("ordinary quote requires work scope, reuses the supplied exact property and goes straight to pricing", async t => {
  const h = harness(async () => success, false, { generic: true, props: { initialCustomer: savedCustomer() } });
  t.after(() => h.cleanup());
  let tree = await h.submit();
  assert.equal(h.requests.length, 0); assert.match(text(tree), /Choose the work/);
  h.enter("Work type", "electrical"); tree = await h.submit();
  assert.equal(h.requests.length, 0); assert.match(text(tree), /short description/);
  h.enter("Work description", "Replace switchboard"); await h.submit();
  const { body } = h.requests[0];
  assert.equal(body.serviceCategory, "electrical"); assert.equal(body.description, "Replace switchboard");
  assert.equal(body.crmCustomerId, "saved-customer"); assert.equal(body.serviceSiteId, "chosen-site"); assert.equal(body.email, "saved@example.test");
  for (const field of ["scheduledStart", "scheduledEnd", "complianceActivitiesJson", "assigneeMemberId", "emailCalendarInvite"]) assert.equal(body[field], undefined);
  assert.deepEqual(h.created, ["saved-quote"]);
  assert.equal(nodes(tree, n => n.type === "option" && n.props.value === "other").length, 1);
});

test("duplicate response offers an explicit existing-property choice without creating another customer", async t => {
  const h = harness(async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === "find_quick_quote_customers") return { ok: true, status: 200, json: async () => ({ ok: true, matches: [savedCustomer("primary-site"), savedCustomer("chosen-site")] }) };
    return body.customerMode === "new" ? { ok: false, status: 409, json: async () => ({ error: "Matching customer exists", code: "CUSTOMER_DUPLICATE" }) } : success;
  });
  t.after(() => h.cleanup()); newCustomer(h);
  let tree = await h.submit();
  assert.ok(button(tree, "Find existing customer"));
  button(tree, "Find existing customer").props.onClick(); tree = h.render();
  assert.equal(button(tree, "Create quote").props.disabled, true, "Never silently select a property");
  await new Promise(resolve => setTimeout(resolve, 320)); tree = h.render();
  const choice = nodes(tree, n => n.type === "button" && text(n).includes("chosen-site"))[0];
  assert.ok(choice); choice.props.onClick(); await h.submit();
  assert.equal(h.requests.at(-1).body.serviceSiteId, "chosen-site");
  assert.equal(h.requests.at(-1).body.customerMode, "existing");
  assert.equal(h.requests.at(-1).body.duplicateOverride, undefined);
  assert.deepEqual(h.created, ["saved-quote"]);
});

test("separate-customer confirmation is explicit and uncertain replay retains the reviewed request", async t => {
  const h = harness(async () => h.requests.length === 1
    ? { ok: false, status: 409, json: async () => ({ error: "Matching customer exists", code: "CUSTOMER_DUPLICATE" }) }
    : h.requests.length === 2 ? Promise.reject(new Error("Response lost")) : success);
  t.after(() => h.cleanup()); newCustomer(h); await h.submit();
  h.enter("I have checked:", "", true); await h.submit();
  assert.equal(h.requests[0].body.duplicateOverride, undefined);
  assert.equal(h.requests[1].body.duplicateOverride, true);
  assert.notEqual(h.requests[0].body.clientRequestId, h.requests[1].body.clientRequestId);
  await h.submit(); assert.deepEqual(h.requests[1].body, h.requests[2].body);
});

test("changing customer details clears a previous separate-customer confirmation", async t => {
  const h = harness(async () => ({ ok: false, status: 409, json: async () => ({ error: "Matching customer exists", code: "CUSTOMER_DUPLICATE" }) }));
  t.after(() => h.cleanup()); newCustomer(h); await h.submit();
  h.enter("I have checked:", "", true); h.enter("Email", "changed@example.test");
  await h.submit(); assert.equal(h.requests[1].body.duplicateOverride, undefined);
});

test("unmount before authentication completes cannot send a quote or invoke the old navigation callback", async () => {
  let authorize;
  const h = harness(async () => success, false, { generic: true, props: { initialCustomer: savedCustomer(), initialServiceCategory: "solar", initialDescription: "Solar" }, getIdToken: () => new Promise(resolve => { authorize = resolve; }) });
  h.render(); const submission = h.submit(); h.cleanup(); authorize("late-token"); await submission;
  assert.equal(h.requests.length, 0); assert.deepEqual(h.created, []);
});
