import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as automation from "../src/lib/trade-sms-automation.ts";
import * as billing from "../src/lib/trade-sms-billing.ts";

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const settings = () => ({ ok: true, canManage: true, urlsEnabled: true, rules: structuredClone(automation.DEFAULT_SMS_AUTOMATION_RULES), summary: { sent: 3, blocked: 1, unknown: 0 } });
function harness(responder, props = {}) {
  const source = fs.readFileSync(new URL("../src/components/TradeSmsAutomationPanel.tsx", import.meta.url), "utf8");
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
  const exports = {}, user = { getIdToken: async () => "fixture-token" };
  const fetch = async (url, init) => { const payload = init.body ? JSON.parse(init.body) : null; requests.push({ url, init, payload }); return { ok: true, json: async () => responder(payload, requests) }; };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.includes("TradeBusinessProvider") ? { useTradeBusinessFetch: () => fetch } : id.includes("trade-sms-automation") ? automation : id.includes("trade-sms-billing") ? billing : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  Function("require", "exports", "requestAnimationFrame", compiled)(require, exports, callback => callback());
  const render = () => { cursor = 0; const tree = exports.TradeSmsAutomationPanel({ user, ...props }); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
test("automation UI presents independent disabled switches, readable field labels and segmented price previews", async t => {
  const h = harness(() => settings()); t.after(h.cleanup); const tree = await h.mount();
  const switches = nodes(tree, node => node.type === "input" && node.props.role === "switch");
  assert.equal(switches.length, 3); assert.ok(switches.every(node => !node.props.checked));
  assert.match(text(tree), /separate marketing permission/); assert.match(text(tree), /9¢ \+ GST per SMS part/);
  assert.match(text(tree), /\$\s*0\.198/); assert.match(text(tree), /\+\s*Customer first name/);
  assert.ok(nodes(tree, node => node.type === "textarea").every(node => !node.props.value.includes("{customer_first_name}")));
});
test("saving preserves other rules and sends canonical fields with selected business request auth", async t => {
  let saved;
  const h = harness(payload => { if (!payload) return settings(); saved = payload; return { ...settings(), rules: payload.rules }; }); t.after(h.cleanup);
  let tree = await h.mount(); nodes(tree, node => node.type === "input" && node.props.role === "switch")[0].props.onChange({ target: { checked: true } });
  tree = h.render(); nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Hi [Customer first name], see you at [Appointment time]." } });
  tree = h.render(); nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = await h.settle(); assert.equal(saved.rules[0].enabled, true); assert.equal(saved.rules[1].enabled, false);
  assert.equal(saved.rules[0].body, "Hi {customer_first_name}, see you at {appointment_time}.");
  assert.equal(h.requests.at(-1).init.headers.Authorization, "Bearer fixture-token"); assert.match(text(tree), /settings saved/);
});
test("24 hours remains an explicit hour selection and double submit sends one settings mutation", async t => {
  let release; const wait = new Promise(resolve => { release = resolve; }); let writes = 0;
  const h = harness(async payload => { if (!payload) return settings(); writes++; await wait; return { ...settings(), rules: payload.rules }; }); t.after(h.cleanup);
  let tree = await h.mount(); const delay = nodes(tree, node => node.type === "input" && node.props.type === "number")[0];
  delay.props.onChange({ target: { value: "24" } }); tree = h.render();
  nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "hours" } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "select")[0].props.value, "hours");
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.value, 24);
  const form = nodes(tree, node => node.type === "form")[0]; form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
  await flush(); assert.equal(writes, 1); release(); await h.settle();
});
test("server rejection keeps the unsaved draft and never claims settings saved", async t => {
  const h = harness(payload => payload ? { ok: false, error: "Connect your SMS number first." } : settings()); t.after(h.cleanup);
  let tree = await h.mount(); nodes(tree, node => node.type === "input" && node.props.role === "switch")[0].props.onChange({ target: { checked: true } });
  tree = h.render(); nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.match(text(tree), /Connect your SMS number first/); assert.doesNotMatch(text(tree), /settings saved/);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.role === "switch")[0].props.checked, true);
  assert.equal(button(tree, "Save automatic texts").props.disabled, false);
});

test("pending link approval blocks review activation while keeping drafts and link-free reminders usable", async t => {
  let saved;
  const h = harness(payload => {
    if (payload) saved = payload;
    return { ...settings(), urlsEnabled: false, ...(payload ? { rules: payload.rules } : {}) };
  }); t.after(h.cleanup);
  let tree = await h.mount();
  assert.match(text(tree), /SMS links are awaiting provider approval/);
  const switches = nodes(tree, node => node.type === "input" && node.props.role === "switch");
  assert.equal(switches[0].props.disabled, false); assert.equal(switches[1].props.disabled, false); assert.equal(switches[2].props.disabled, true);
  const reviewLink = nodes(tree, node => node.type === "input" && node.props.type === "url")[0];
  assert.equal(reviewLink.props.disabled, false); reviewLink.props.onChange({ target: { value: "https://example.test/review" } });
  tree = h.render(); const reviewDraft = nodes(tree, node => node.type === "textarea")[2];
  assert.equal(reviewDraft.props.disabled, false); reviewDraft.props.onChange({ target: { value: "Please share feedback: [Review link]" } });
  switches[0].props.onChange({ target: { checked: true } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.equal(saved.rules[0].enabled, true); assert.equal(saved.rules[2].enabled, false);
  assert.equal(saved.rules[2].reviewUrl, "https://example.test/review"); assert.match(saved.rules[2].body, /Please share feedback/);
  assert.match(text(tree), /settings saved/); assert.match(text(tree), /cannot enable them yet/);
});

test("pending link approval still permits turning off an existing review rule", async t => {
  let saved;
  const h = harness(payload => {
    const data = settings(); data.urlsEnabled = false; data.rules[2].enabled = true; data.rules[2].reviewUrl = "https://example.test/review";
    if (payload) { saved = payload; data.rules = payload.rules; }
    return data;
  }); t.after(h.cleanup);
  let tree = await h.mount(); const reviewSwitch = nodes(tree, node => node.type === "input" && node.props.role === "switch")[2];
  assert.equal(reviewSwitch.props.disabled, false); reviewSwitch.props.onChange({ target: { checked: false } }); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "input" && node.props.role === "switch")[2].props.disabled, true);
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(saved.rules[2].enabled, false);
});

test("a blocked link-bearing service draft stays editable without claiming it was saved", async t => {
  const h = harness(payload => payload ? { ok: false, error: "SMS links need provider approval before enabling this rule." } : { ...settings(), urlsEnabled: false }); t.after(h.cleanup);
  let tree = await h.mount(); nodes(tree, node => node.type === "input" && node.props.role === "switch")[0].props.onChange({ target: { checked: true } });
  tree = h.render(); nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Appointment details: https://example.test/booking" } });
  tree = h.render(); nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.match(text(tree), /SMS links need provider approval/); assert.doesNotMatch(text(tree), /settings saved/);
  const draft = nodes(tree, node => node.type === "textarea")[0];
  assert.equal(draft.props.value, "Appointment details: https://example.test/booking"); assert.equal(draft.props.disabled, false);
});
