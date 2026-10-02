import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { emptyMemberEngagement } from "../src/lib/trade-member-engagement.ts";

const source = fs.readFileSync(new URL("../src/components/TradeMemberEngagementPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function AgreementTemplates() {}
const saved = { ok: true, memberId: "person-a", revision: 1, readOnly: false, updatedAt: "2026-10-02T00:00:00Z", details: { ...emptyMemberEngagement, engagementType: "employee", rateBasis: "hourly", rateAmount: "40.00", bankBsb: "123456", bankAccountNumber: "12345678", superUsi: "TEST-FUND", superMemberNumber: "TEST-MEMBER" } };

function harness(responder = (url, init) => url.includes("/engagement") ? init.method === "PUT" ? { ...saved, revision: 2, details: JSON.parse(init.body).details } : saved : { ok: true, files: [] }) {
  const state = [], effects = [], deps = [], requests = [], dirties = [], callbacks = [], callbackDeps = [];
  let cursor = 0, effectIndex = 0, callbackIndex = 0;
  const fetch = async (url, init = {}) => { requests.push({ url, ...init }); const value = await responder(url, init); return { ok: value.ok !== false, json: async () => value }; };
  const hooks = { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; }, useCallback(callback, next) { const index = callbackIndex++; if (!callbackDeps[index] || next.some((value, position) => value !== callbackDeps[index][position])) { callbacks[index] = callback; callbackDeps[index] = next; } return callbacks[index]; }, useEffect(callback, next) { const index = effectIndex++; if (!deps[index] || next.some((value, position) => value !== deps[index][position])) { effects.push(callback); deps[index] = next; } } };
  const exports = {};
  Function("require", "exports", "window", code)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => key }) } : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => fetch } : id === "@/lib/trade-member-engagement" ? { emptyMemberEngagement } : id === "./TradeMemberAgreementTemplates" ? { TradeMemberAgreementTemplates: AgreementTemplates } : (() => { throw new Error(id); })(), exports, { requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {}, confirm: () => true });
  const user = { uid: "owner", getIdToken: async () => "test-token" };
  const onDirtyChange = value => dirties.push(value);
  const render = () => { cursor = 0; effectIndex = 0; callbackIndex = 0; return exports.TradeMemberEngagementPanel({ user, memberId: "person-a", displayName: "Test Person", onDirtyChange }); };
  const settle = async () => { render(); const pending = effects.splice(0); pending.forEach(effect => effect()); await flush(); return render(); };
  return { render, settle, requests, dirties };
}

test("account identifiers are masked until the owner explicitly reveals them", async () => {
  const h = harness(); let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "password").length, 4);
  assert.equal(h.requests[1].url, "/api/trade-team/member-files?scope=employment&memberId=person-a");
  button(tree, "Show account identifiers").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "password").length, 0);
  assert.equal(button(tree, "Hide account identifiers").props["aria-pressed"], true);
});

test("saving uses the loaded revision and hides identifiers again after success", async () => {
  const h = harness(); let tree = await h.settle();
  button(tree, "Show account identifiers").props.onClick();
  nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.onChange({ target: { value: "45.00" } });
  tree = h.render();
  assert.equal(button(tree, "Save private details").props.disabled, false);
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = h.render();
  const write = h.requests.find(request => request.method === "PUT");
  assert.equal(JSON.parse(write.body).revision, 1);
  assert.equal(JSON.parse(write.body).memberId, "person-a");
  assert.equal(JSON.parse(write.body).details.rateAmount, "45.00");
  assert.match(text(tree), /Private pay and onboarding details saved/);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "password").length, 4);
});

test("failed saves retain edits without a success message", async () => {
  const h = harness((url, init) => init.method === "PUT" ? { ok: false, error: "This record changed. Reload it." } : url.includes("/engagement") ? saved : { ok: true, files: [] });
  let tree = await h.settle();
  nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.onChange({ target: { value: "55.00" } });
  tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = h.render(); assert.match(text(tree), /This record changed/); assert.doesNotMatch(text(tree), /details saved/);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.value, "55.00");
});

test("archived records disable financial changes and document upload", async () => {
  const h = harness(url => url.includes("/engagement") ? { ...saved, readOnly: true } : { ok: true, files: [] });
  const tree = await h.settle();
  assert.equal(button(tree, "Save private details"), undefined);
  assert.equal(button(tree, "Add private document"), undefined);
  assert.ok(nodes(tree, node => node.type === "fieldset").every(node => node.props.disabled));
});

test("mismatched member response never renders private values", async () => {
  const h = harness(url => url.includes("/engagement") ? { ...saved, memberId: "other-person" } : { ok: true, files: [] });
  const tree = await h.settle();
  assert.match(text(tree), /did not match this team member/);
  assert.equal(nodes(tree, node => node.type === "input").length, 0);
});

test("agreement templates use saved terms and propagate unsaved or busy state without disabling themselves", async () => {
  const h = harness(); let tree = await h.settle();
  let template = nodes(tree, node => node.type === AgreementTemplates)[0];
  template.props.onDirtyChange(true); tree = await h.settle();
  assert.equal(h.dirties.at(-1), true);
  template = nodes(tree, node => node.type === AgreementTemplates)[0];
  template.props.onBusyChange(true); tree = h.render();
  assert.equal(button(tree, "Add private document").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === AgreementTemplates)[0].props.disabled, false);
  template.props.onBusyChange(false); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.onChange({ target: { value: "65.00" } });
  tree = h.render(); template = nodes(tree, node => node.type === AgreementTemplates)[0];
  assert.equal(template.props.engagement.rateAmount, "40.00");
  assert.equal(template.props.disabled, true);
  template.props.onSavedFile({ id: "contract-draft", memberId: "person-a", title: "Employee agreement draft", fileName: "draft.pdf", sizeBytes: 1000, createdAt: saved.updatedAt });
  assert.match(text(h.render()), /Employee agreement draft/);
});
