import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as contract from "../src/lib/trade-customer-hub-assist.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/components/TradeCustomerHubAssist.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).replace(/\s+/g, " ").trim() === label)[0];
const flush = async () => { for (let n = 0; n < 3; n++) await new Promise(resolve => setImmediate(resolve)); };
const question = { id: "q-1", prompt: "Where will the system go?", answer: "Garage", kind: "text", services: ["solar"], revision: 1, closed: false, authorType: "trade", replies: [], files: [] };
const generated = () => Response.json({ ok: true, sourceHash: "a".repeat(64), brief: [{ text: "Customer requested garage installation.", sourceIds: ["q-1"] }], draftScope: [{ text: "Confirm garage installation scope.", sourceIds: ["job", "q-1"] }] });
function harness(responder = async () => generated(), getIdToken = async () => "token") {
  let cursor = 0;
  const state = [], effects = [], queue = [], requests = [], copied = [], opened = [];
  const auth = { currentUser: { uid: "actor-1", emailVerified: true, getIdToken } };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => state[i] = typeof next === "function" ? next(state[i]) : next]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect(callback, deps) { const i = cursor++, previous = effects[i]; if (!previous || deps.some((value, n) => value !== previous.deps[n])) { previous?.cleanup?.(); effects[i] = { deps }; queue.push(() => effects[i].cleanup = callback()); } },
  };
  const fetch = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return responder(url, init); };
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "@/lib/firebase-client": { firebaseAuth: auth }, "@/lib/trade-customer-hub-assist": contract,
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: "owner-1" }) }, "./TradeCustomerHubAssist.module.css": { default: {} } };
  const exports = {};
  Function("require", "exports", "navigator", compiled)(id => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, exports, { clipboard: { writeText: async value => copied.push(value) } });
  const props = { workOrderId: "work-1", questions: [question], onOpenQuestion: id => opened.push(id) };
  const render = () => { cursor = 0; const tree = exports.TradeCustomerHubAssist(props); for (const effect of queue.splice(0)) effect(); return tree; };
  return { render, requests, copied, opened, auth, props,
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
    async click(label) { const target = button(render(), label); assert.ok(target, label); assert.ok(!target.props.disabled); target.props.onClick(); await flush(); return render(); } };
}

test("optional brief uses the scoped endpoint, opens cited questions and copies only on explicit action", async t => {
  const h = harness(); t.after(h.cleanup);
  assert.equal(h.requests.length, 0); const tree = await h.click("Generate brief");
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, "/api/trade-customer-hub/assist");
  assert.deepEqual(Object.keys(h.requests[0].body).sort(), ["requestId", "workOrderId"]);
  assert.equal(h.requests[0].body.workOrderId, "work-1"); assert.equal(h.requests[0].init.headers.Authorization, "Bearer token");
  assert.match(text(tree), /Customer requested garage installation/); assert.deepEqual(h.copied, []);
  await h.click("Question 1"); assert.deepEqual(h.opened, ["q-1"]);
  await h.click("Copy draft scope"); assert.deepEqual(h.copied, ["Confirm garage installation scope."]);
  assert.equal(h.requests.length, 1, "No message or quote mutation is performed");
});

test("changed conversation immediately hides the old brief and copy action", async t => {
  const h = harness(); t.after(h.cleanup); await h.click("Generate brief");
  h.props.questions = [{ ...question, answer: "Outside", revision: 2 }];
  const tree = h.render(); assert.doesNotMatch(text(tree), /Customer requested garage installation/);
  assert.equal(button(tree, "Copy draft scope"), undefined); assert.ok(button(tree, "Generate brief"));
});

test("late response from a changed conversation is aborted and cannot appear in its replacement", async t => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; })); t.after(h.cleanup);
  await h.click("Generate brief"); assert.equal(h.requests.length, 1);
  h.props.questions = [{ ...question, answer: "Outside", revision: 2 }]; h.render();
  assert.equal(h.requests[0].init.signal.aborted, true); finish(generated()); await flush();
  assert.doesNotMatch(text(h.render()), /Customer requested garage installation/); assert.equal(button(h.render(), "Copy draft scope"), undefined);
});

test("account change before token acquisition prevents sending; unmount aborts a pending response", async t => {
  let authorize;
  const h = harness(async () => generated(), () => new Promise(resolve => { authorize = resolve; })); t.after(h.cleanup);
  await h.click("Generate brief"); h.auth.currentUser = { ...h.auth.currentUser, uid: "other-actor" }; authorize("late-token"); await flush();
  assert.equal(h.requests.length, 0); assert.equal(button(h.render(), "Copy draft scope"), undefined);
  let finish; const pending = harness(() => new Promise(resolve => { finish = resolve; })); await pending.click("Generate brief"); pending.cleanup();
  assert.equal(pending.requests[0].init.signal.aborted, true); finish(generated()); await flush(); assert.deepEqual(pending.copied, []);
});

test("stale-source failure and unsupported citation never show a partial draft and allow explicit retry", async t => {
  let index = 0;
  const h = harness(async () => ++index === 1 ? Response.json({ ok: false, error: "The conversation changed. Refresh Customer Q&A." }, { status: 409 })
    : Response.json({ ok: true, sourceHash: "a".repeat(64), brief: [{ text: "Foreign details", sourceIds: ["foreign"] }], draftScope: [] })); t.after(h.cleanup);
  let tree = await h.click("Generate brief"); assert.match(text(tree), /conversation changed/); assert.equal(button(tree, "Copy draft scope"), undefined);
  tree = await h.click("Generate brief"); assert.match(text(tree), /incomplete/); assert.doesNotMatch(text(tree), /Foreign details/); assert.notEqual(h.requests[0].body.requestId, h.requests[1].body.requestId);
});
