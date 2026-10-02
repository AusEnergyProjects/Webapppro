import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexHomeDashboard.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).startsWith(label))[0];
const count = (tree, label) => text(nodes(button(tree, label), node => node.type === "strong")[0]);
const labels = ["Awaiting audit", "Corrections required", "Audits completed", "Ready for submission"];
const flush = () => new Promise(resolve => setImmediate(resolve));
const dashboard = overrides => ({ awaitingAudit: 170, correctionsRequired: 12, auditCompleted: 205, readyForSubmission: 184, inProgress: 33, total: 420, countsUnit: "activities", ...overrides });
const member = uid => ({ uid, getIdToken: async () => `token-${uid}` });

function harness() {
  const slots = [], effects = [], queued = [], requests = [], navigated = [];
  let cursor = 0, stateChanges = 0;
  const props = { user: member("member-1"), canManageTeam: true, onNavigate: destination => navigated.push(destination) };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { stateChanges++; slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect(callback, deps) { const index = cursor++; if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) { effects[index]?.cleanup?.(); effects[index] = { deps }; queued.push(() => { effects[index].cleanup = callback(); }); } },
  };
  const exports = {};
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  const fetch = (path, init) => new Promise(resolve => requests.push({ path, init, respond(value, status = 200) { resolve({ ok: status < 400, status, json: async () => value }); } }));
  Function("require", "exports", "fetch", compiled)(require, exports, fetch);
  const render = () => { cursor = 0; const tree = exports.CreditexHomeDashboard(props); for (const effect of queued.splice(0)) effect(); return tree; };
  return { props, render, requests, navigated, get stateChanges() { return stateChanges; }, async settle() { await flush(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

test("Home loads authorised aggregate counts rather than queue-page or revenue totals", async () => {
  const h = harness();
  const loading = h.render();
  for (const label of labels) assert.equal(count(loading, label), "...");
  assert.match(text(loading), /Loading current compliance workload/);
  await flush();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.path, "/api/creditex/job-audit?view=dashboard");
  assert.equal(request.init.headers.Authorization, "Bearer token-member-1");
  assert.equal(request.init.cache, "no-store");
  assert.ok(request.init.signal instanceof AbortSignal);
  request.respond({ ok: true, dashboard: dashboard() });
  const tree = await h.settle();
  assert.deepEqual(labels.map(label => count(tree, label)), ["170", "12", "205", "184"]);
  assert.match(text(tree), /420 current job activities.*33 still in progress/);
  assert.match(text(tree), /Counts are per activity/);
  assert.doesNotMatch(text(tree), /revenue|invoiced|\$|first 50|current page/i);
  const meters = nodes(tree, node => node.props?.role === "meter");
  assert.equal(meters.length, 4);
  assert.equal(meters[0].props["aria-valuemax"], 420);
  assert.equal(meters[0].props["aria-valuenow"], 170);
  h.cleanup();
});

test("Home distinguishes real zero, loading, failed and malformed workloads with a working retry", async () => {
  const h = harness(); h.render(); await flush();
  h.requests[0].respond({ ok: true, dashboard: dashboard({ awaitingAudit: 0, correctionsRequired: 0, auditCompleted: 0, readyForSubmission: 0, inProgress: 0, total: 0 }) });
  let tree = await h.settle();
  assert.deepEqual(labels.map(label => count(tree, label)), ["0", "0", "0", "0"]);
  assert.match(text(tree), /0 current job activities/);
  assert.equal(nodes(tree, node => node.props?.role === "alert").length, 0);
  button(tree, "Refresh").props.onClick();
  tree = h.render();
  assert.deepEqual(labels.map(label => count(tree, label)), ["...", "...", "...", "..."]);
  await flush(); h.requests[1].respond({ ok: false, error: "Workspace access changed." }, 403);
  tree = await h.settle();
  assert.match(text(tree), /Workspace access changed/);
  assert.deepEqual(labels.map(label => count(tree, label)), labels.map(() => "Unavailable"));
  assert.equal(nodes(tree, node => node.props?.role === "meter").length, 0);
  button(tree, "Retry").props.onClick(); h.render(); await flush();
  h.requests[2].respond({ ok: true, dashboard: dashboard() });
  tree = await h.settle();
  assert.equal(count(tree, labels[0]), "170");
  assert.equal(nodes(tree, node => node.props?.role === "alert").length, 0);
  h.cleanup();

  for (const malformed of [undefined, { total: 2, countsUnit: "activities" }, dashboard({ awaitingAudit: -1 }), dashboard({ correctionsRequired: "4" }), dashboard({ total: 1.5 }), dashboard({ countsUnit: "jobs" })]) {
    const malformedHarness = harness(); malformedHarness.render(); await flush();
    malformedHarness.requests[0].respond({ ok: true, dashboard: malformed });
    const failed = await malformedHarness.settle();
    assert.deepEqual(labels.map(label => count(failed, label)), labels.map(() => "Unavailable"));
    assert.match(text(failed), /workload could not be loaded/);
    assert.doesNotMatch(text(failed), /NaN|undefined current/);
    malformedHarness.cleanup();
  }
});

test("Home removes previous-member counts immediately and ignores aborted response arrivals", async () => {
  const h = harness(); h.render(); await flush();
  h.requests[0].respond({ ok: true, dashboard: dashboard() });
  await h.settle();
  h.props.user = member("member-2");
  let tree = h.render();
  assert.equal(count(tree, labels[0]), "...");
  assert.doesNotMatch(text(tree), /420 current/);
  assert.equal(h.requests[0].init.signal.aborted, true);
  await flush();
  assert.equal(h.requests[1].init.headers.Authorization, "Bearer token-member-2");
  h.props.user = member("member-3"); h.render(); await flush();
  assert.equal(h.requests[1].init.signal.aborted, true);
  h.requests[1].respond({ ok: true, dashboard: dashboard({ total: 987 }) });
  tree = await h.settle();
  assert.equal(count(tree, labels[0]), "...");
  assert.doesNotMatch(text(tree), /987 current/);
  h.requests[2].respond({ ok: true, dashboard: dashboard({ total: 600 }) });
  tree = await h.settle();
  assert.match(text(tree), /600 current job activities/);
  button(tree, "Refresh").props.onClick(); h.render(); await flush();
  h.cleanup();
  const changesBeforeLateArrival = h.stateChanges;
  h.requests[3].respond({ ok: false, error: "Late failure" }, 500);
  await flush();
  assert.equal(h.stateChanges, changesBeforeLateArrival);
});

test("Home cards navigate to working destinations while team management follows permission", async () => {
  const h = harness(); let tree = h.render();
  for (const [label, destination] of [["Open jobs", "cases"], ["Awaiting audit", "cases"], ["Corrections required", "operations"], ["Audits completed", "cases"], ["Ready for submission", "submissions"], ["✓ Audit a job", "cases"], ["☷ My tasks & team", "tasks"], ["↗ Activity submissions", "submissions"], ["Customers & team", "connect"], ["Forms & activity requirements", "forms"], ["Manage team access", "team"], ["Profile & workspace colours", "settings"]]) {
    const action = button(tree, label);
    assert.ok(action, label);
    action.props.onClick();
    assert.equal(h.navigated.at(-1), destination);
  }
  h.props.canManageTeam = false;
  tree = h.render();
  assert.equal(button(tree, "Manage team access"), undefined);
  assert.ok(button(tree, "Customers & team"));
  assert.ok(button(tree, "Profile & workspace colours"));
  h.cleanup();
});
