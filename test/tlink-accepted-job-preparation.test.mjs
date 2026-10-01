import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(child => nodes(child, predicate)) : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const text = tree => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
function harness(data, response = () => Response.json(data)) {
  const values = [data], calls = [], events = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], value => { values[slot] = typeof value === "function" ? value(values[slot]) : value; }]; },
    useRef: value => ({ current: value }), useCallback: value => value, useEffect() {},
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/TradeJobReadinessPanel.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mocks = { react: hooks, "react/jsx-runtime": jsx, "./TradeBusinessProvider": { useTradeBusinessFetch: () => async (url, options) => { calls.push({ url, ...options }); return response(); } }, "./TradeStockJobPanel": { TradeStockJobPanel: "TradeStockJobPanel" }, "./TradeStockJobPanel.module.css": { default: {} }, "./TradeJobPreparation.module.css": { default: {} } };
  const loaded = { exports: {} };
  Function("require", "module", "exports", compiled)(name => { assert.ok(name in mocks, name); return mocks[name]; }, loaded, loaded.exports);
  const props = { user: { getIdToken: async () => "local-test" }, workOrderId: "existing-job", onChanged: async () => events.push("refresh"), onOpenTeam: () => events.push("schedule"), preparation: { hasBooking: true, onOpenFiles: () => events.push("files"), onOpenPlan: () => events.push("plan"), onOpenQuote: () => events.push("quote") } };
  return { calls, events, render() { index = 0; return loaded.exports.TradeJobReadinessPanel(props); } };
}
const prepared = () => ({ handoff: true, plan: { commercialReference: "Q-accepted", acceptedTotalCents: 999900, budgetCostCents: 123400 }, phases: [{ id: "phase", title: "Electrical safety", customerDescription: "Accepted safety check" }], requirements: [{ id: "task", phaseId: "phase", type: "task", description: "Test circuits", status: "confirmed" }, { id: "form", phaseId: "phase", type: "form", description: "Safety checklist", status: "required" }], readiness: { assignedTo: "Old lead", forms: false } });

test("preparation shows accepted work and truthful paperwork/visit actions without amounts or writes", () => {
  const h = harness(prepared()); const tree = h.render();
  assert.match(text(tree), /Electrical safety.*Test circuits.*Assigned visits.*Job paperwork.*Safety checklist/s);
  assert.doesNotMatch(text(tree), /Old lead|Ready for the team|9999|1234|Mark ready|Complete/);
  for (const label of ["Accepted quote", "View booking", "Open forms and files", "Open work plan"]) button(tree, label).props.onClick();
  assert.deepEqual(h.events, ["quote", "schedule", "files", "plan"]);
  assert.deepEqual(h.calls, []);
});

test("preparing older accepted work reuses the existing job and immutable server prepare action", async () => {
  const h = harness({ handoff: true, plan: null }, () => Response.json(prepared()));
  button(h.render(), "Prepare from accepted quote").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(h.calls[0].body), { action: "prepare", workOrderId: "existing-job" });
  assert.equal(h.calls[0].url, "/api/trade-job-readiness");
  assert.match(text(h.render()), /Test circuits/);
});

test("a failed preparation retains the action and shows the actual error", async () => {
  const h = harness({ handoff: true, plan: null }, () => Response.json({ error: "Accepted scope is unavailable" }, { status: 409 }));
  button(h.render(), "Prepare from accepted quote").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(text(h.render()), /Accepted scope is unavailable/);
  assert.ok(button(h.render(), "Prepare from accepted quote"));
  assert.doesNotMatch(text(h.render()), /Test circuits/);
});
