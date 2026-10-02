import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { CREDITEX_PERMISSION_GROUPS, creditexRolePermissions } from "../src/lib/creditex-permissions.ts";

const source = fs.readFileSync(new URL("../src/components/CreditexOperationsWorkspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CreditexOperationsWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AccessView");
assert.ok(declaration);
const trapDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "trapTeamDialogKey");
const compiled = ts.transpileModule(`${trapDeclaration.getText(ast)}\nexport ${declaration.getText(ast)}`, {
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

function harness({ flags = {}, members = [], invitations = [], respond = async () => ({ ok: true, result: { namedOwnerConfirmed: true } }) } = {}) {
  const state = [], effects = [], pendingEffects = [], calls = [], events = []; let cursor = 0;
  const session = Object.freeze({ email: "info@ausenergyassessments.com", displayName: "AEA Creditex administrator", role: "admin",
    canConfirmNamedOwner: true, namedOwnerConfirmed: false, ...flags });
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  };
  const useRef = initial => useState({ current: initial })[0];
  const useEffect = (run, deps) => {
    const index = cursor++;
    if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
      pendingEffects.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: run() }; });
    }
  };
  class Element { constructor(name) { this.name = name; } focus() { document.activeElement = this; } }
  const launcher = new Element("launcher"), firstControl = new Element("first"), lastControl = new Element("last");
  const document = { activeElement: launcher, body: { style: { overflow: "auto" } } };
  const dialogTarget = new Element("dialog");
  dialogTarget.querySelector = () => firstControl;
  dialogTarget.querySelectorAll = () => [firstControl, lastControl];
  const window = { confirm: () => true, requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} };
  const authenticatedJson = async (path, init) => {
    calls.push({ path, method: init.method, body: JSON.parse(init.body) }); events.push("request");
    const result = await respond(); events.push("server success"); return result;
  };
  const exports = {};
  Function("require", "exports", "useState", "useRef", "useEffect", "authenticatedJson", "styles", "readable", "dateTime", "EmptyState", "StatusPill", "window", "document", "HTMLElement", "creditexRolePermissions", "PermissionFields", compiled)(
    name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, useState, useRef, useEffect, authenticatedJson, {}, value => value,
    value => value, "empty-state", "status-pill", window, document, Element, creditexRolePermissions, "permission-fields",
  );
  const render = () => {
    cursor = 0;
    const tree = exports.AccessView({ session, access: { loaded: true, members, invitations }, loading: false, error: "",
      onRefresh: () => events.push("access refresh"), onSessionChanged: async () => { events.push("session refresh"); } });
    const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
    if (dialog) dialog.props.ref.current = dialogTarget;
    while (pendingEffects.length) pendingEffects.shift()();
    return tree;
  };
  return { render, calls, events, session, document, launcher, firstControl, lastControl, dialogTarget };
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
  button(tree, "Add team member").props.onClick(); tree = h.render();
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

test("invitation role presets and custom permissions are submitted together", async () => {
  const h = harness(); let tree = h.render();
  button(tree, "Add team member").props.onClick(); tree = h.render();
  assert.deepEqual(nodes(tree, node => node.type === "permission-fields")[0].props.permissions, creditexRolePermissions("reviewer"));
  nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "auditor" } });
  tree = h.render(); assert.deepEqual(nodes(tree, node => node.type === "permission-fields")[0].props.permissions, creditexRolePermissions("auditor"));
  nodes(tree, node => node.type === "permission-fields")[0].props.onChange(["jobs", "messages"]);
  tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0].body.action, "create_invitation");
  assert.equal(h.calls[0].body.role, "auditor"); assert.deepEqual(h.calls[0].body.permissions, ["jobs", "messages"]);
  assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 0);
  assert.equal(h.document.activeElement, h.launcher);
  assert.equal(h.document.body.style.overflow, "auto");
});

test("Team opens as a roster and Add team member opens one Person and access dialog", () => {
  const h = harness(); let tree = h.render();
  assert.equal(nodes(tree, node => node.type === "form").length, 0);
  assert.equal(nodes(tree, node => node.type === "permission-fields").length, 0);
  button(tree, "Add team member").props.onClick(); tree = h.render();
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  assert.equal(dialog.props["aria-modal"], "true");
  assert.match(text(dialog), /Person and access/);
  assert.ok(labelled(dialog, "Full name")); assert.ok(labelled(dialog, "Individual email"));
  assert.equal(nodes(dialog, node => node.type === "permission-fields").length, 1);
  assert.equal(h.document.activeElement, h.firstControl);
  assert.equal(h.document.body.style.overflow, "hidden");
  button(dialog, "Cancel").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.props?.role === "dialog").length, 0);
  assert.equal(h.document.activeElement, h.launcher);
  assert.equal(h.document.body.style.overflow, "auto");
  assert.equal(h.calls.length, 0);
});

test("member details open saved permission switches and Save changes posts only that member's access", async () => {
  const member = { id: "member-one", displayName: "Alex", email: "alex@example.test", role: "reviewer", status: "active", lastLoginAt: "", permissions: ["jobs", "calculator"] };
  const h = harness({ members: [member] }); let tree = h.render();
  assert.equal(nodes(tree, node => node.type === "select").length, 0);
  button(tree, "Open details").props.onClick(); tree = h.render();
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  assert.match(text(dialog), /Alex/); assert.match(text(dialog), /alex@example.test/);
  assert.deepEqual(nodes(dialog, node => node.type === "permission-fields")[0].props.permissions, member.permissions);
  nodes(dialog, node => node.type === "permission-fields")[0].props.onChange(["jobs", "messages"]);
  tree = h.render(); nodes(tree, node => node.type === "select")[1].props.onChange({ target: { value: "suspended" } });
  tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls[0].body, { action: "update_member_access", memberId: "member-one", role: "reviewer", status: "suspended", permissions: ["jobs", "messages"] });
  assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 0);
  assert.deepEqual(member.permissions, ["jobs", "calculator"], "editing never mutates the roster snapshot");
});

test("Escape, backdrop and keyboard focus behave like the TLink member dialog", () => {
  const h = harness(); let tree = h.render();
  button(tree, "Add team member").props.onClick(); tree = h.render();
  let dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  let prevented = 0;
  h.document.activeElement = h.lastControl;
  dialog.props.onKeyDown({ key: "Tab", shiftKey: false, currentTarget: h.dialogTarget, preventDefault() { prevented++; } });
  assert.equal(h.document.activeElement, h.firstControl);
  dialog.props.onKeyDown({ key: "Tab", shiftKey: true, currentTarget: h.dialogTarget, preventDefault() { prevented++; } });
  assert.equal(h.document.activeElement, h.lastControl); assert.equal(prevented, 2);
  let stopped = false;
  dialog.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } }); tree = h.render();
  assert.equal(stopped, true); assert.equal(nodes(tree, node => node.props?.role === "dialog").length, 0);
  assert.equal(h.document.activeElement, h.launcher);
  button(tree, "Add team member").props.onClick(); tree = h.render();
  const backdrop = nodes(tree, node => node.props?.onMouseDown)[0];
  backdrop.props.onMouseDown({ target: {}, currentTarget: backdrop });
  assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 1, "inside click stays open");
  backdrop.props.onMouseDown({ target: backdrop, currentTarget: backdrop });
  assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 0);
});

test("save blocks closing and duplicate submission, while rejection keeps the draft in the dialog", async () => {
  let rejectRequest;
  const h = harness({ respond: () => new Promise((_resolve, reject) => { rejectRequest = reject; }) });
  let tree = h.render(); button(tree, "Add team member").props.onClick(); tree = h.render();
  labelled(tree, "Full name").props.onChange({ target: { value: "Keep this draft" } }); tree = h.render();
  const pending = nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = h.render();
  assert.equal(button(tree, "Saving...").props.disabled, true);
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  dialog.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1); assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 1);
  rejectRequest(Error("Keep at least one active administrator.")); await pending; tree = h.render();
  assert.equal(labelled(tree, "Full name").props.value, "Keep this draft");
  assert.equal(nodes(tree, node => node.props?.role === "alert").map(text).join(" "), "Keep at least one active administrator.");
  assert.ok(button(nodes(tree, node => node.props?.role === "dialog")[0], "Add team member"));
});

test("nonadministrators cannot open invitation or member access editors", () => {
  const h = harness({ flags: { role: "reviewer", canConfirmNamedOwner: false } }); const tree = h.render();
  assert.equal(button(tree, "Add team member"), undefined);
  assert.equal(nodes(tree, node => node.type === "form" || node.props?.role === "dialog").length, 0);
});

test("permission checkboxes explain authority, keep audit and jobs coherent, and lock administrator access", () => {
  const permissionDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PermissionFields");
  const permissionCode = ts.transpileModule(`export ${permissionDeclaration.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  Function("require", "exports", "creditexRolePermissions", "CREDITEX_PERMISSION_GROUPS", "styles", permissionCode)(name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, creditexRolePermissions, CREDITEX_PERMISSION_GROUPS, {});
  let result;
  const render = (role, permissions) => exports.PermissionFields({ role, permissions, disabled: false, onChange: next => { result = next; } });
  const checkbox = (tree, label) => nodes(tree, node => node.type === "label" && text(node).includes(label))[0].props.children[0];
  checkbox(render("reviewer", []), "Audit jobs").props.onChange({ target: { checked: true } }); assert.deepEqual(result, ["jobs", "audit"]);
  checkbox(render("reviewer", result), "Jobs and corrections").props.onChange({ target: { checked: false } }); assert.deepEqual(result, []);
  assert.equal(checkbox(render("auditor", creditexRolePermissions("auditor")), "Edit activity forms").props.disabled, true);
  assert.ok(nodes(render("admin", creditexRolePermissions("admin")), node => node.type === "fieldset").every(node => node.props.disabled));
});
