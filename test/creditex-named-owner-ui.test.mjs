import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/CreditexOperationsWorkspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CreditexOperationsWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AccessView");
assert.ok(declaration);
const compiled = ts.transpileModule(`export ${declaration.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const labelled = (tree, label) => nodes(tree, node => node.type === "label" && text(node).trim() === label)[0]?.props.children.find(child => child?.type === "input");
const flush = () => new Promise(resolve => setImmediate(resolve));
const confirmationLabel = "Confirm James Morris as administrator";

function harness({ flags = {}, respond = async () => ({ ok: true, result: { namedOwnerConfirmed: true } }) } = {}) {
  const state = [], calls = [], events = []; let cursor = 0;
  const session = Object.freeze({ email: "info@ausenergyassessments.com", displayName: "AEA Creditex administrator", role: "admin",
    canConfirmNamedOwner: true, namedOwnerConfirmed: false, ...flags });
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  };
  const authenticatedJson = async (path, init) => {
    calls.push({ path, method: init.method, body: JSON.parse(init.body) }); events.push("request");
    const result = await respond(); events.push("server success"); return result;
  };
  const exports = {};
  Function("require", "exports", "useState", "authenticatedJson", "styles", "readable", "dateTime", "EmptyState", "StatusPill", "window", compiled)(
    name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, useState, authenticatedJson, {}, value => value,
    value => value, "empty-state", "status-pill", { confirm: () => true },
  );
  const render = () => {
    cursor = 0;
    return exports.AccessView({ session, access: { loaded: true, members: [], invitations: [] }, loading: false, error: "",
      onRefresh: () => events.push("access refresh"), onSessionChanged: async () => { events.push("session refresh"); } });
  };
  return { render, calls, events, session };
}

test("owner confirmation is absent for noneligible and already-confirmed sessions", () => {
  for (const flags of [{ canConfirmNamedOwner: false }, { canConfirmNamedOwner: undefined },
    { canConfirmNamedOwner: false, namedOwnerConfirmed: true, displayName: "James Morris" }]) {
    const h = harness({ flags }); const tree = h.render();
    assert.equal(button(tree, confirmationLabel), undefined);
    assert.equal(h.calls.length, 0);
    if (flags.namedOwnerConfirmed) assert.match(text(tree), /James Morris · Creditex Administrator/);
  }
});

test("confirmation posts only the server-owned action and refreshes only after success", async () => {
  let resolveRequest;
  const h = harness({ respond: () => new Promise(resolve => { resolveRequest = resolve; }) });
  let tree = h.render();
  labelled(tree, "Full name").props.onChange({ target: { value: "Different Person" } });
  labelled(tree, "Individual email").props.onChange({ target: { value: "different@example.com" } });
  tree = h.render(); button(tree, confirmationLabel).props.onClick(); tree = h.render();
  assert.deepEqual(h.calls, [{ path: "/api/creditex/access", method: "POST", body: { action: "confirm_named_owner" } }]);
  assert.equal(button(tree, "Confirming James Morris...").props.disabled, true);
  assert.deepEqual(h.events, ["request"]);
  assert.doesNotMatch(text(tree), /James Morris is now the named/);
  assert.doesNotMatch(text(tree), /James Morris · Creditex Administrator/);
  resolveRequest({ ok: true, result: { displayName: "James Morris", role: "admin", namedOwnerConfirmed: true } });
  await flush(); tree = h.render();
  assert.deepEqual(h.events, ["request", "server success", "access refresh", "session refresh"]);
  assert.match(text(tree), /James Morris is now the named Creditex administrator/);
  assert.equal(h.session.namedOwnerConfirmed, false, "capability stays owned by the reloaded server session");
  assert.doesNotMatch(text(tree), /James Morris · Creditex Administrator/);
});

test("a rejected confirmation shows the server error without a success notice or session refresh", async () => {
  const h = harness({ respond: async () => { throw new Error("Owner access changed before confirmation completed."); } });
  button(h.render(), confirmationLabel).props.onClick(); await flush(); const tree = h.render();
  assert.deepEqual(h.events, ["request"]);
  assert.equal(nodes(tree, node => node.props?.role === "alert").map(text).join(" "), "Owner access changed before confirmation completed.");
  assert.doesNotMatch(text(tree), /James Morris is now the named|James Morris · Creditex Administrator/);
  assert.equal(h.session.namedOwnerConfirmed, false);
  assert.equal(button(tree, confirmationLabel).props.disabled, false);
});
