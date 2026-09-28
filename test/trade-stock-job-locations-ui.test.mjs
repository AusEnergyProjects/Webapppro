import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compiled = Object.fromEntries(["TradeStockJobPanel", "TradeJobReadinessPanel"].map(name => [name, ts.transpileModule(
  fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText]));
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const control = (tree, label) => nodes(tree, node => node.props?.["aria-label"] === label)[0];
const input = (tree, label) => nodes(tree, node => node.type === "label" && text(node).trim() === label).flatMap(node => nodes(node, child => child.type === "input"))[0];
const change = (field, value) => { assert.ok(field, "Expected an editable field"); field.props.onChange({ target: { value } }); };
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (body, status = 200) => Response.json(body, { status });
const main = { locationId: "main", name: "Main", isDefault: true, onHandMilli: 18000, usedMilli: 0, responsibleName: "" };
const van = { locationId: "van", name: "Work van", isDefault: false, onHandMilli: 6000, usedMilli: 0, responsibleName: "" };
const stockRequirement = patch => ({ requirementId: "r1", itemId: "item1", description: "Panels", unitLabel: "each", requiredMilli: 10000, usedMilli: 0, remainingMilli: 10000, reservedMilli: 10000, availableMilli: 14000, shortageMilli: 0, revision: 2, tracked: true, stockBaselineMilli: 0, stockLocations: [{ ...main }], ...patch });
const job = patch => ({ workOrderId: "job1", canManage: true, requirements: [stockRequirement()], ...patch });
function readiness({ stock = job(), requirement = {} } = {}) {
  return {
    handoff: true,
    plan: { status: "ready", commercialReference: "Q-1", acceptedTotalCents: 50000, budgetCostCents: 20000, budgetMarginCents: 30000, depositRequirement: "optional", expectedDurationMinutes: 0, suggestedCrewSize: 1, completedAt: "" },
    phases: [{ id: "phase", title: "Installation", customerDescription: "Roof panels", status: "pending", progressPercent: 0 }],
    requirements: [{ id: "r1", phaseId: "phase", type: "material", description: "Panels", status: "confirmed", quantityMilli: 10000, expectedDurationMinutes: 0, requiredCapability: "", totalCostCents: 20000, actualQuantityMilli: 0, actualDurationMinutes: 0, actualCostCents: 0, actualNote: "", actualRecorded: false, ...requirement }],
    stock,
    readiness: { scope: true, forms: true, people: true, materials: true, deposit: true, ready: true, assignedTo: "Installer" },
    execution: { actualCostCents: 0, forecastCostCents: 20000, forecastMarginCents: 30000, varianceCents: 0, varianceStatus: "on_budget" },
    completion: { scope: false, forms: true, materials: false, proof: true, proofRequired: false, ready: false, completed: false, invoiceReady: false, handoverReady: false },
  };
}

function harness(t, { component = "TradeJobReadinessPanel", data = readiness(), props: overrides = {}, respond } = {}) {
  let cursor = 0;
  const states = [], effects = [], pending = [], requests = [], changes = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return states[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (!states[i] || deps.some((value, j) => value !== states[i].deps[j])) states[i] = { deps, value: callback }; return states[i].value; },
    useEffect(callback, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const StockPanel = () => null;
  const dependencies = { react: hooks, "react/jsx-runtime": jsx, "./TradeStockJobPanel": { TradeStockJobPanel: StockPanel } };
  const exports = {};
  const fetch = async (url, init = {}) => { requests.push({ url, init }); return respond ? respond(url, init) : response(component === "TradeStockJobPanel" ? { ok: true, job: data.stock } : data); };
  Function("require", "exports", "fetch", "requestAnimationFrame", "cancelAnimationFrame", compiled[component])(
    id => dependencies[id] || { default: {} }, exports, fetch, callback => setImmediate(callback), frame => clearImmediate(frame),
  );
  const props = { user: { uid: "owner", getIdToken: async () => "token" }, workOrderId: "job1", job: data.stock, onOpenTeam() {}, onChanged: async value => { changes.push(value); if (value) props.job = value; }, ...overrides };
  const render = () => { cursor = 0; const tree = exports[component](props); for (const effect of pending.splice(0)) effect(); return tree; };
  const cleanup = () => { for (const effect of effects) effect?.cleanup?.(); };
  t.after(cleanup);
  return { props, requests, changes, StockPanel, render, cleanup, writes: () => requests.filter(row => row.init.method === "POST").map(row => JSON.parse(row.init.body)), async settle() { let tree; for (let i = 0; i < 5; i++) { tree = render(); await tick(); } return tree; } };
}

test("job commitments retain negative availability and commit the full requirement", async t => {
  const initial = job({ requirements: [stockRequirement({ reservedMilli: 0, availableMilli: -2000, shortageMilli: 12000 })] });
  const committed = job({ requirements: [stockRequirement({ availableMilli: -12000, shortageMilli: 12000, revision: 3 })] });
  const h = harness(t, { component: "TradeStockJobPanel", data: readiness({ stock: initial }), respond: () => response({ ok: true, job: committed }) });
  let tree = await h.settle();
  assert.match(text(tree), /-2\s+available/); assert.equal(h.requests.length, 0);
  button(tree, "Commit to job").props.onClick(); tree = await h.settle();
  assert.equal(h.writes()[0].quantityMilli, 10000); assert.equal(h.writes()[0].expectedRevision, 2);
  assert.equal(h.writes()[0].action, "reserve"); assert.equal(h.writes()[0].requirementId, "r1");
  assert.match(text(tree), /10\s+committed/); assert.match(text(tree), /-12\s+available/);
  assert.equal(button(tree, "Commit to job"), undefined); assert.ok(button(tree, "Release"));
});

test("uncertain release retries the same operation once and never submits duplicate clicks", async t => {
  let calls = 0;
  const h = harness(t, { component: "TradeStockJobPanel", respond: () => {
    if (!calls++) throw new Error("Connection lost");
    return response({ ok: true, job: job({ requirements: [stockRequirement({ reservedMilli: 0, revision: 3 })] }) });
  } });
  let tree = await h.settle(); button(tree, "Release").props.onClick(); button(tree, "Release").props.onClick(); tree = await h.settle();
  assert.equal(h.writes().length, 1); assert.equal(button(tree, "Refresh").props.disabled, true);
  button(tree, "Retry update").props.onClick(); tree = await h.settle();
  assert.deepEqual(h.writes()[0], h.writes()[1]); assert.equal(h.writes()[1].action, "release"); assert.equal(h.writes()[1].quantityMilli, 0);
  assert.match(text(tree), /Stock commitment released/);
});

test("job stock is read-only without manage access and ignores a response for another job", async t => {
  const read = harness(t, { component: "TradeStockJobPanel", data: readiness({ stock: job({ canManage: false }) }) });
  const tree = await read.settle(); assert.equal(button(tree, "Release"), undefined); assert.equal(button(tree, "Commit to job"), undefined);
  const h = harness(t, { component: "TradeStockJobPanel", respond: () => response({ ok: true, job: job({ workOrderId: "other-job" }) }) });
  button(await h.settle(), "Refresh").props.onClick(); assert.match(text(await h.settle()), /Stock could not be checked/); assert.equal(h.changes.length, 0);
});

test("readiness shares its stock snapshot and a single Main location keeps actual use one click", async t => {
  const h = harness(t); let tree = await h.settle();
  assert.equal(h.requests.length, 1); assert.match(h.requests[0].url, /^\/api\/trade-job-readiness\?/);
  const stockPanel = nodes(tree, node => node.type === h.StockPanel)[0];
  assert.equal(stockPanel.props.job.requirements[0].stockLocations[0].locationId, "main");
  stockPanel.props.onChanged(job({ requirements: [stockRequirement({ availableMilli: -3000 })] }));
  tree = h.render(); assert.equal(nodes(tree, node => node.type === h.StockPanel)[0].props.job.requirements[0].availableMilli, -3000);
  assert.match(text(tree), /Use from\s+Main/); assert.equal(control(tree, "Use stock from for Panels"), undefined);
  button(tree, "Used as planned").props.onClick(); button(tree, "Used as planned").props.onClick(); await h.settle();
  assert.deepEqual(h.writes(), [{ action: "actual", workOrderId: "job1", requirementId: "r1", usePlanned: true }]);
});

test("multiple locations preselect the named default rather than the first warehouse", async t => {
  const data = readiness({ stock: job({ requirements: [stockRequirement({ stockLocations: [{ ...van }, { ...main }] })] }) });
  const h = harness(t, { data }); const tree = await h.settle();
  const select = control(tree, "Use stock from for Panels"); assert.equal(select.props.value, "main");
  assert.match(text(select), /Work van\s+\(\s*6\s+each\s+on hand\)/); assert.match(text(select), /Main\s+\(\s*18\s+each\s+on hand\)/);
  button(tree, "Used as planned").props.onClick(); await h.settle();
  assert.deepEqual(h.writes()[0].stockLocations, [{ locationId: "main", quantityMilli: 10000 }]);
});

test("the selected van is used with actual quantity while preserving recorded cost, minutes and notes", async t => {
  const data = readiness({ stock: job({ requirements: [stockRequirement({ stockLocations: [{ ...van }, { ...main }] })] }) });
  const h = harness(t, { data }); let tree = await h.settle();
  change(control(tree, "Use stock from for Panels"), "van"); tree = h.render();
  change(input(tree, "Quantity"), "4.5"); tree = h.render(); change(input(tree, "Minutes"), "75"); tree = h.render();
  change(input(tree, "Actual cost, excluding GST"), "350.25"); tree = h.render(); change(input(tree, "Note, optional"), "Returned unused stock");
  button(h.render(), "Save actual").props.onClick(); await h.settle();
  assert.deepEqual(h.writes()[0], { action: "actual", workOrderId: "job1", requirementId: "r1", quantityMilli: 4500, durationMinutes: 75, totalCostCents: 35025, note: "Returned unused stock", stockLocations: [{ locationId: "van", quantityMilli: 4500 }] });
});

test("split usage requires exact totals and sends the complete desired quantities", async t => {
  const data = readiness({ stock: job({ requirements: [stockRequirement({ stockLocations: [{ ...van }, { ...main }] })] }) });
  const h = harness(t, { data }); let tree = await h.settle();
  change(control(tree, "Use stock from for Panels"), "split"); tree = h.render();
  change(control(tree, "Quantity from Work van for Panels"), "3"); tree = h.render();
  change(control(tree, "Quantity from Main for Panels"), "6"); tree = h.render();
  assert.match(text(tree), /9\s+of\s+10\s+each\s+entered/);
  button(tree, "Used as planned").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Location quantities must total 10 each/); assert.equal(h.writes().length, 0);
  change(control(tree, "Quantity from Main for Panels"), "7.0001"); button(h.render(), "Used as planned").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /up to 3 decimal places/); assert.equal(h.writes().length, 0);
  change(control(tree, "Quantity from Main for Panels"), "7"); button(h.render(), "Used as planned").props.onClick(); await h.settle();
  assert.deepEqual(h.writes()[0].stockLocations, [{ locationId: "van", quantityMilli: 3000 }, { locationId: "main", quantityMilli: 7000 }]);
});

test("corrections preserve an existing split and exclude actual use recorded before stock tracking", async t => {
  const data = readiness({
    stock: job({ requirements: [stockRequirement({ stockBaselineMilli: 2000, usedMilli: 10000, remainingMilli: 0, reservedMilli: 0, stockLocations: [{ ...van, usedMilli: 3000 }, { ...main, usedMilli: 5000 }] })] }),
    requirement: { actualRecorded: true, actualQuantityMilli: 10000, actualCostCents: 20000 },
  });
  const h = harness(t, { data }); let tree = await h.settle();
  assert.equal(control(tree, "Use stock from for Panels").props.value, "split");
  assert.equal(control(tree, "Quantity from Work van for Panels").props.value, "3");
  assert.match(text(tree), /8\s+of\s+8\s+each\s+entered/);
  change(input(tree, "Quantity"), "9"); tree = h.render(); change(control(tree, "Quantity from Work van for Panels"), "2");
  button(h.render(), "Save actual").props.onClick(); await h.settle();
  assert.equal(h.writes()[0].quantityMilli, 9000);
  assert.deepEqual(h.writes()[0].stockLocations, [{ locationId: "van", quantityMilli: 2000 }, { locationId: "main", quantityMilli: 5000 }]);
});

test("an existing single usage location is kept and a full return sends no desired location stock", async t => {
  const data = readiness({ stock: job({ requirements: [stockRequirement({ stockLocations: [{ ...van, usedMilli: 4000 }, { ...main }] })] }), requirement: { actualRecorded: true, actualQuantityMilli: 4000, actualCostCents: 8000 } });
  const h = harness(t, { data }); let tree = await h.settle();
  assert.equal(control(tree, "Use stock from for Panels").props.value, "van");
  change(input(tree, "Quantity"), "0"); button(h.render(), "Save actual").props.onClick(); await h.settle();
  assert.deepEqual(h.writes()[0].stockLocations, []); assert.equal(h.writes()[0].quantityMilli, 0);
});

test("untracked work has no location controls or location payload", async t => {
  const h = harness(t, { data: readiness({ stock: job({ requirements: [] }), requirement: { type: "labour" } }) });
  const tree = await h.settle(); assert.doesNotMatch(text(tree), /Use from/);
  button(tree, "Done as planned").props.onClick(); await h.settle();
  assert.deepEqual(h.writes()[0], { action: "actual", workOrderId: "job1", requirementId: "r1", usePlanned: true });
});

test("leaving the job while authentication is pending prevents a late stock or actual write", async t => {
  for (const component of ["TradeStockJobPanel", "TradeJobReadinessPanel"]) {
    const h = harness(t, { component }); const tree = await h.settle(); let authenticate;
    h.props.user.getIdToken = () => new Promise(resolve => { authenticate = resolve; });
    button(tree, component === "TradeStockJobPanel" ? "Release" : "Used as planned").props.onClick(); await tick();
    h.cleanup(); authenticate("token"); await tick(); assert.equal(h.writes().length, 0);
  }
});
