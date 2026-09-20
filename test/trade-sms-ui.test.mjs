import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const connection = { number: "+61400000000", accountLabel: "Test trade", accountType: "Full", dailyLimit: 100, usedSegments: 0, status: "connected" };
const conversation = (overrides = {}) => ({ ok: true, connection, customerPhone: "+61400000001", consent: "allowed", messages: [], ...overrides });
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

function harness(component, responder) {
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = [], effects = [], callbacks = [], pending = [], requests = [];
  let cursor = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++; if (changed(callbacks[index]?.deps, deps)) callbacks[index] = { callback, deps }; return callbacks[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (changed(effects[index]?.deps, deps)) { effects[index]?.cleanup?.(); effects[index] = { deps }; pending.push(() => { effects[index].cleanup = callback(); }); } },
  };
  const exports = {};
  const user = { getIdToken: async () => "fixture-token" };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  const fetch = async (url, init) => { const payload = init.body ? JSON.parse(init.body) : null; requests.push({ url, init, payload }); return responder(payload, requests); };
  class FormDataFixture { constructor(values) { this.values = values; } get(key) { return this.values[key]; } }
  Function("require", "exports", "fetch", "window", "document", "FormData", compiled)(require, exports, fetch, { addEventListener() {}, removeEventListener() {}, confirm: () => true }, { visibilityState: "visible" }, FormDataFixture);
  const render = () => { cursor = 0; const tree = exports[component]({ user, customerId: "customer-a", onOpenIntegrations() {} }); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); render(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

function draft(h, tree, body = "Appointment tomorrow at 9am.") {
  nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: body } });
  return h.render();
}
function submit(tree, currentTarget = {}) { nodes(tree, node => node.type === "form").at(-1).props.onSubmit({ preventDefault() {}, currentTarget }); }

test("uncertain SMS retries retain the original request ID and body, then show real delivery status", async () => {
  let attempts = 0;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(conversation());
    attempts++;
    if (attempts === 1) throw new Error("Network lost after dispatch");
    return reply({ ok: true, message: { id: "m1", requestId: payload.requestId, direction: "outbound", body: payload.body, status: "unknown", createdAt: "2026-09-21T01:00:00Z" } });
  });
  let tree = draft(h, await h.mount()); submit(tree); tree = await h.settle();
  assert.match(text(tree), /result is not confirmed/);
  assert.ok(button(tree, "Check this message"));
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.disabled, true);
  submit(tree); tree = await h.settle();
  const sends = h.requests.filter(item => item.payload?.action === "send");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].payload.requestId, sends[1].payload.requestId);
  assert.equal(sends[0].payload.body, sends[1].payload.body);
  assert.match(text(tree), /Delivery is not confirmed/);
  assert.doesNotMatch(text(tree), /SMS sent|Message sent successfully/);
  h.cleanup();
});

test("rapid double submit sends one request while the first is in flight", async () => {
  let release;
  const h = harness("TradeCustomerSmsPanel", async payload => payload ? new Promise(resolve => { release = resolve; }) : reply(conversation()));
  const tree = draft(h, await h.mount()); submit(tree); submit(tree); await flush();
  assert.equal(h.requests.filter(item => item.payload?.action === "send").length, 1);
  release(reply({ ok: false, error: "Daily SMS limit reached." }, 429));
  const result = await h.settle(); assert.match(text(result), /Daily SMS limit reached/);
  assert.equal(nodes(result, node => node.type === "textarea")[0].props.disabled, false);
  h.cleanup();
});

test("customer STOP blocks sending and cannot be replaced with trade-recorded permission", async () => {
  const h = harness("TradeCustomerSmsPanel", async () => reply(conversation({ consent: "opted_out" })));
  const tree = await h.mount();
  assert.match(text(tree), /opted out/);
  assert.equal(button(tree, "Record permission"), undefined);
  assert.equal(button(tree, "Send SMS"), undefined);
  assert.equal(nodes(tree, node => node.type === "textarea").length, 0);
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer fixture-token");
  assert.equal(h.requests[0].init.cache, "no-store"); h.cleanup();
});

test("unconfirmed routing prevents the SMS composer and offers connection recovery", async () => {
  const h = harness("TradeCustomerSmsPanel", async () => reply(conversation({ connection: { ...connection, status: "connecting" } })));
  const tree = await h.mount(); assert.match(text(tree), /routing is not confirmed/);
  assert.ok(button(tree, "Check SMS connection")); assert.equal(button(tree, "Send SMS"), undefined); h.cleanup();
});

test("history refresh reconciles an uncertain submission using its request ID", async () => {
  let accepted;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(conversation({ messages: accepted ? [accepted] : [] }));
    accepted = { id: "m1", requestId: payload.requestId, direction: "outbound", body: payload.body, status: "delivered", createdAt: "2026-09-21T01:00:00Z" };
    throw new Error("Lost acknowledgement");
  });
  let tree = draft(h, await h.mount()); submit(tree); tree = await h.settle();
  button(tree, "Refresh").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Message found in your history/); assert.match(text(tree), /Delivered/);
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.value, "");
  assert.equal(h.requests.filter(item => item.payload).length, 1); h.cleanup();
});

test("a single verified number is preselected with the daily cap and direct billing made visible", async () => {
  const h = harness("TradeSmsConnectionPanel", async payload => payload ? reply({ ok: true, accountLabel: "Test trade", accountType: "Trial", numbers: [{ sid: "PNfixture", number: "+61400000000", label: "Business" }] }) : reply({ ok: true, connection: null }));
  let tree = await h.mount(); submit(tree, { accountSid: "AC" + "a".repeat(32), authToken: "fixture-token" }); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select")[0].props.value, "PNfixture");
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.value, "100");
  assert.match(text(tree), /Twilio bills you directly/); assert.match(text(tree), /Only recipients verified in Twilio/);
  assert.equal(button(tree, "Connect SMS").props.disabled, false); h.cleanup();
});

test("a saved connection with failed status refresh provides recovery without a dead Connect button", async () => {
  let saved = false, refreshFailed = false;
  const h = harness("TradeSmsConnectionPanel", async payload => {
    if (payload?.action === "inspect") return reply({ ok: true, numbers: [{ sid: "PNfixture", number: "+61400000000", label: "Business" }] });
    if (payload?.action === "connect") { saved = true; return reply({ ok: true }); }
    if (saved && !refreshFailed) { refreshFailed = true; throw new Error("Offline"); }
    return reply({ ok: true, connection: saved ? connection : null });
  });
  let tree = await h.mount(); submit(tree, { accountSid: "AC" + "a".repeat(32), authToken: "fixture-token" }); tree = await h.settle();
  button(tree, "Connect SMS").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /connection was saved/); assert.equal(button(tree, "Connect SMS"), undefined);
  button(tree, "Refresh connection").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Connected/); assert.match(text(tree), /\+61400000000/);
  assert.equal(h.requests.filter(item => item.payload?.action === "connect").length, 1); h.cleanup();
});
