import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexVoiceSetupPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const numbers = [{ id: "number-1", number: "+61280000001", label: "Creditex" }];
const initial = { ok: true, connection: null, numbers: [], staff: [{ id: "member", displayName: "Staff", role: "auditor" }], assignments: [] };
const connected = status => ({ ...initial, connection: { id: "connection", status, accountLabel: "Creditex Telnyx", defaultNumberId: "number-1", defaultNumber: numbers[0].number, errorCode: "" }, numbers });

function harness(respond = () => initial) {
  const state = [], refs = [], effects = [], callbacks = [], pending = [], requests = [];
  let cursor = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(value) { const i = cursor++; return refs[i] ||= { current: value }; },
    useCallback(callback, deps) { const i = cursor++; if (changed(callbacks[i]?.deps, deps)) callbacks[i] = { callback, deps }; return callbacks[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const user = { uid: "admin", getIdToken: async () => "bearer" }, exported = {};
  const requestWithCreditexTokenRecovery = async ({ request, currentUid }) => { assert.equal(currentUid(), user.uid); return request("bearer"); };
  const require = name => name === "react" ? hooks : name === "react/jsx-runtime" ? jsx : name === "@/lib/creditex-auth-token" ? { requestWithCreditexTokenRecovery } : name.endsWith(".css") ? { default: new Proxy({}, { get: (_, key) => key }) } : {};
  const fetch = async (url, options) => { const body = options.body ? JSON.parse(options.body) : null; requests.push({ url, body, options }); const value = await respond(body, requests); return { ok: value.ok !== false, status: value.ok === false ? 409 : 200, json: async () => value }; };
  class FormData { constructor(form) { this.form = form; } get(name) { return this.form[name]; } }
  Function("require", "exports", "fetch", "window", "FormData", compiled)(require, exported, fetch, { confirm: () => true }, FormData);
  const render = () => { cursor = 0; const wrapper = exported.default({ user }); const tree = wrapper.type(wrapper.props); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("admin setup remains folded and explains Creditex billing and external number acquisition", async () => {
  const h = harness(); const tree = await h.mount();
  assert.equal(tree.type, "details"); assert.equal(tree.props.open, undefined);
  assert.match(text(tree), /Creditex pays Telnyx/); assert.match(text(tree), /does not buy numbers/);
  const fields = nodes(tree, node => node.type === "input");
  assert.equal(fields.find(node => node.props.name === "apiKey").props.type, "password");
  assert.ok(button(tree, "Refresh connection")); h.cleanup();
});

test("connecting requires account inspection, owned number and explicit billing attestation", async () => {
  const h = harness(body => body?.action === "inspect" ? { ok: true, numbers } : body?.action === "connect" ? connected("connected") : initial);
  let tree = await h.mount();
  const form = nodes(tree, node => node.type === "form")[0];
  await form.props.onSubmit({ preventDefault() {}, currentTarget: { apiKey: "secret-entered-once", publicKey: "public-key" } }); tree = await h.settle();
  assert.equal(button(tree, "Connect Creditex calling").props.disabled, true);
  nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  tree = h.render(); assert.equal(button(tree, "Connect Creditex calling").props.disabled, false);
  button(tree, "Connect Creditex calling").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Carrier charges go to Creditex/);
  assert.equal(h.requests.find(item => item.body?.action === "connect").body.ownsAccount, true);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.name === "apiKey").length, 0);
  assert.doesNotMatch(text(tree), /secret-entered-once/); h.cleanup();
});

test("pending setup is truthful and resumes saved credentials without asking for another secret", async () => {
  const h = harness(body => body?.action === "connect" ? connected("connected") : connected("connecting"));
  let tree = await h.mount(); assert.match(text(tree), /No calls can start until setup is confirmed/);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.name === "apiKey").length, 0);
  button(tree, "Check setup again").props.onClick(); tree = await h.settle();
  const resume = h.requests.find(item => item.body?.action === "connect");
  assert.equal(resume.body.apiKey, ""); assert.equal(resume.body.defaultNumberId, "number-1");
  assert.ok(button(tree, "Save number assignments")); h.cleanup();
});

test("a failed setup response refreshes pending state and never claims the account connected", async () => {
  let attempted = false;
  const h = harness(body => {
    if (body?.action === "inspect") return { ok: true, numbers };
    if (body?.action === "connect") { attempted = true; return { ok: false, error: "Telnyx setup is pending." }; }
    return attempted ? connected("connecting") : initial;
  });
  let tree = await h.mount();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {}, currentTarget: { apiKey: "secret", publicKey: "public" } }); tree = await h.settle();
  nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  button(h.render(), "Connect Creditex calling").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Setup pending/); assert.match(text(tree), /Telnyx setup is pending/);
  assert.equal(button(tree, "Save number assignments"), undefined); assert.ok(button(tree, "Check setup again")); h.cleanup();
});
