import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { isPayableQuoteDecisionInvoice } from "../src/lib/trade-quote-receipt.ts";

const compiled = ts.transpileModule(fs.readFileSync(new URL("../src/components/QuoteLinkReview.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const receipt = { acceptanceId: "acceptance", decision: "accepted", signerName: "Customer", decidedAt: "2026-09-28T10:00:00Z", consentStatement: "Accepted", commercialReference: "Q-TLJ-1234",
  invoice: null, payment: { availability: "not_configured", method: "none", accountName: "", bsb: "", accountNumber: "", reference: "", terms: "", amountDueCents: 0, currency: "AUD", dueAt: "" } };
const question = { id: "question-1", question: "Can you use the side gate?", answer: "Yes, we can use the side gate.", status: "answered", askedAt: "", answeredAt: "" };

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (typeof node.type === "function") return nodes(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function harness(initial = { ok: true, receipt, conversation: { questions: [question] } }) {
  let cursor = 0, response = initial;
  const states = [], effects = [], requests = [];
  const hooks = {
    useState(initialValue) { const index = cursor++; if (!(index in states)) states[index] = initialValue; return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
    useRef(initialValue) { const index = cursor++; return states[index] ??= { current: initialValue }; },
    useCallback(callback, deps) { const index = cursor++; const previous = states[index]; if (!previous || deps.some((item, i) => item !== previous.deps[i])) states[index] = { deps, callback }; return states[index].callback; },
    useMemo(callback) { return callback(); },
    useEffect(callback, deps) { const index = cursor++; const previous = states[index]; if (!previous || deps.some((item, i) => item !== previous[i])) { states[index] = deps; effects.push(callback); } },
  };
  const window = { requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {} };
  const fetch = async (url, options) => { requests.push({ url, options }); return Response.json(response); };
  const exports = {};
  Function("require", "exports", "window", "fetch", compiled)(id => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "@/lib/trade-quote-receipt") return { isPayableQuoteDecisionInvoice };
    return {};
  }, exports, window, fetch);
  const render = () => { cursor = 0; return exports.QuoteLinkReview({ token: "private-token" }); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  const load = async () => { render(); effects.splice(0).forEach(effect => effect()); return settle(); };
  return { render, load, settle, requests, respond: value => { response = value; } };
}

test("accepted receipt includes a question thread and reply refresh without reopening signing or choices", async () => {
  const h = harness(), tree = await h.load();
  assert.ok(nodes(tree, node => node.type === "h1" && node.props.children === "Quote accepted").length);
  assert.ok(nodes(tree, node => node.type === "p" && node.props.children === question.answer).length);
  assert.ok(nodes(tree, node => node.type === "textarea").length);
  assert.equal(nodes(tree, node => node.type === "input").length, 0);
  const buttons = nodes(tree, node => node.type === "button");
  assert.deepEqual(buttons.map(node => node.props.children), ["Send question", "Check for replies"]);
  assert.equal(buttons[0].props.disabled, true);
  h.respond({ ok: true, receipt, conversation: { questions: [{ ...question, answer: "Updated reply" }] } });
  buttons[1].props.onClick(); const refreshed = await h.settle();
  assert.ok(nodes(refreshed, node => node.type === "p" && node.props.children === "Updated reply").length);
  assert.equal(h.requests[1].options.cache, "no-store");
});

test("accepted question send uses the existing action and preserves the receipt", async () => {
  const h = harness(); let tree = await h.load();
  nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Could you call before arriving?" } }); tree = h.render();
  h.respond({ ok: true, receipt, conversation: { questions: [question, { ...question, id: "question-2", question: "Could you call before arriving?", answer: "" }] } });
  nodes(tree, node => node.type === "button" && node.props.children === "Send question")[0].props.onClick(); tree = await h.settle();
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { action: "ask_question", question: "Could you call before arriving?" });
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.value, "");
  assert.ok(nodes(tree, node => node.type === "h1" && node.props.children === "Quote accepted").length);
  assert.ok(nodes(tree, node => node.props?.role === "status" && node.props.children === "Your question has been sent to the business.").length);
});

test("declined receipts and accepted receipts without live communication access have no question composer", async () => {
  for (const data of [{ ok: true, receipt, conversation: null }, { ok: true, receipt: { ...receipt, decision: "declined" }, conversation: null }]) {
    const h = harness(data), tree = await h.load();
    assert.equal(nodes(tree, node => node.type === "textarea").length, 0);
    assert.equal(nodes(tree, node => node.type === "button").length, 0);
  }
});
