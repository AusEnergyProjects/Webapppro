import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { resetTradeDashboardStateOnUidChange } from "../src/components/trade-rebate-calculator-state.ts";

const source = fs.readFileSync(new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("DirectTradeDashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate) {
  let found;
  function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(parsed);
  assert.ok(found, "Expected production dashboard callback");
  return found;
}
function evaluate(expression, bindings) {
  const code = ts.transpileModule(`const callback = ${expression}; exports.callback = callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  Function("exports", ...Object.keys(bindings), code)(exports, ...Object.values(bindings));
  return exports.callback;
}
const functionNamed = name => findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed);
const workspaces = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "dashboardWorkspaces").initializer.getText(parsed);
const workspaceFromSearch = evaluate(functionNamed("dashboardWorkspaceFromSearch"), { dashboardWorkspaces: evaluate(workspaces, {}) });
const shouldClearDeepLink = evaluate(functionNamed("shouldClearOpportunityDeepLink"), {});
const authCallback = findNode(node => ts.isCallExpression(node) && node.expression.getText(parsed) === "onAuthStateChanged").arguments[1].getText(parsed);
const clearCallback = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "clearProtectedInstallerState").initializer.arguments[0].getText(parsed);
const syncCallback = findNode(node => ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect"
  && node.arguments[0]?.getText(parsed).includes("const routeWorkspace =")).arguments[0].getText(parsed);

function harness(search = "?workspace=training") {
  let url = new URL(`https://example.test/direct-trade/dashboard${search}`);
  const state = { workspace: workspaceFromSearch(search), activeWorkView: "today", commandTarget: null, selectedOpportunityMatchId: "" };
  const calls = [];
  const protectedIdentityUid = { current: null };
  const protectedIdentityRevision = { current: 0 };
  const window = { get location() { return url; }, history: { state: null,
    replaceState(_state, _title, next) { calls.push("replace"); url = new URL(next, url); },
    pushState(_state, _title, next) { calls.push("push"); url = new URL(next, url); },
  } };
  const bindings = { window, protectedIdentityUid, protectedIdentityRevision, resetTradeDashboardStateOnUidChange,
    dashboardWorkspaceFromSearch: workspaceFromSearch, shouldClearOpportunityDeepLink: shouldClearDeepLink,
    abortProtectedOpportunityRequests: () => calls.push("abort"), revokeAllEvidenceObjectUrls: () => calls.push("revoke"),
    publicLeadHandoffRequestMatchId: { current: "old-private-match" },
    scrubProtectedOpportunityNavigation: () => calls.push("scrub"),
    setUser: user => calls.push(`user:${user?.uid || "none"}`), setAuthReady: () => {}, setLoading: () => {},
  };
  for (const setter of clearCallback.matchAll(/\b(set\w+)\(/g)) bindings[setter[1]] = value => calls.push([setter[1], value]);
  Object.assign(bindings, {
    setWorkspace: value => { state.workspace = value; }, setActiveWorkView: value => { state.activeWorkView = value; },
    setCommandTarget: value => { state.commandTarget = value; }, setSelectedOpportunityMatchId: value => { state.selectedOpportunityMatchId = value; },
  });
  bindings.clearProtectedInstallerState = evaluate(clearCallback, bindings);
  const authenticate = evaluate(authCallback, bindings);
  const workspaceRouteInitialised = { current: false }, workspacePopstateSync = { current: false };
  const sync = () => evaluate(syncCallback, { ...bindings, ...state, workspaceRouteInitialised, workspacePopstateSync,
    dashboardCommandTargetFromSearch: () => null })();
  return { calls, state, protectedIdentityUid, authenticate, sync, get url() { return url; } };
}

test("training deep link survives initial authenticated hydration and dashboard URL sync", () => {
  const h = harness(); h.sync(); h.authenticate({ uid: "installer-a" }); h.sync();
  assert.equal(h.state.workspace, "training"); assert.equal(h.url.searchParams.get("workspace"), "training");
  assert.ok(h.calls.includes("abort")); assert.ok(h.calls.includes("revoke"));
  assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === "setProfile" && call[1] === null));
  assert.equal(h.protectedIdentityUid.current, "installer-a");
  assert.ok(!h.calls.includes("push"), "Initial sign-in must not add a work route to history");
});

test("training request survives signed-out hydration followed by sign-in", () => {
  const h = harness(); h.authenticate(null); h.sync(); h.authenticate({ uid: "installer-a" }); h.sync();
  assert.equal(h.state.workspace, "training"); assert.equal(h.url.searchParams.get("workspace"), "training");
});

test("account replacement and sign-out still clear the previous account workspace", () => {
  for (const nextUser of [{ uid: "installer-b" }, null]) {
    const h = harness(); h.authenticate({ uid: "installer-a" }); h.sync(); h.calls.length = 0;
    h.authenticate(nextUser); h.sync();
    assert.equal(h.state.workspace, "work"); assert.equal(h.url.searchParams.get("workspace"), "work");
    assert.ok(h.calls.includes("scrub")); assert.ok(h.calls.includes("abort"));
    assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === "setProfile" && call[1] === null));
  }
});

test("initial sign-in retains only a validated workspace and same-UID refresh leaves navigation alone", () => {
  const valid = harness("?workspace=team"); valid.authenticate({ uid: "installer-a" }); valid.sync();
  assert.equal(valid.url.searchParams.get("workspace"), "team");
  valid.state.workspace = "invoices"; valid.authenticate({ uid: "installer-a" }); valid.sync();
  assert.equal(valid.url.searchParams.get("workspace"), "invoices");
  const invalid = harness("?workspace=untrusted"); invalid.authenticate({ uid: "installer-a" }); invalid.sync();
  assert.equal(invalid.url.searchParams.get("workspace"), "work");
});
