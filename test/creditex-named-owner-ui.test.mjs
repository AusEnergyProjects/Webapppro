import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { CREDITEX_ACCESS_PRESETS, CREDITEX_PERMISSION_GROUPS, creditexAllowedPermissions, creditexRolePermissions, hasCreditexPermission, setCreditexPermission } from "../src/lib/creditex-permissions.ts";

const source = fs.readFileSync(new URL("../src/components/CreditexOperationsWorkspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CreditexOperationsWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AccessView");
assert.ok(declaration);
const trapDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "trapTeamDialogKey");
const helpers = ["personNameParts", "roleLabel"].map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join("\n");
const compiled = ts.transpileModule(`${helpers}\n${trapDeclaration.getText(ast)}\nexport ${declaration.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const labelled = (tree, label) => nodes(tree, node => node.type === "label" && text(node).trim() === label)[0]?.props.children.find(child => child?.type === "input");
const select = (tree, label) => nodes(tree, node => node.type === "label" && node.props.children[0] === label)[0]?.props.children.find(child => child?.type === "select");
const flush = () => new Promise(resolve => setImmediate(resolve));
const confirmationLabel = "Confirm James Morris as administrator";

function harness({ flags = {}, members = [], invitations = [], memberTotal = members.length, invitationTotal = invitations.length, respond = async () => ({ ok: true, result: { namedOwnerConfirmed: true } }) } = {}) {
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
  Function("require", "exports", "useState", "useRef", "useEffect", "authenticatedJson", "styles", "readable", "dateTime", "EmptyState", "StatusPill", "window", "document", "HTMLElement", "creditexAllowedPermissions", "PermissionFields", "hasCreditexPermission", "CREDITEX_ACCESS_PRESETS", "Image", compiled)(
    name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, useState, useRef, useEffect, authenticatedJson, {}, value => value,
    value => value, "empty-state", "status-pill", window, document, Element, creditexAllowedPermissions, "permission-fields", hasCreditexPermission, CREDITEX_ACCESS_PRESETS, "img",
  );
  const render = () => {
    cursor = 0;
    const tree = exports.AccessView({ session, access: { loaded: true, members, invitations, memberTotal, invitationTotal }, loading: false, error: "",
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
  labelled(tree, "First name").props.onChange({ target: { value: "Different Person" } });
  labelled(tree, "Email for invitation").props.onChange({ target: { value: "different@example.com" } });
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
  assert.deepEqual(nodes(tree, node => node.type === "permission-fields")[0].props.permissions, creditexAllowedPermissions("case_manager"));
  select(tree, "Quick access preset").props.onChange({ target: { value: "auditor" } });
  tree = h.render(); assert.deepEqual(nodes(tree, node => node.type === "permission-fields")[0].props.permissions, CREDITEX_ACCESS_PRESETS.find(preset => preset.id === "auditor").permissions);
  nodes(tree, node => node.type === "permission-fields")[0].props.onChange(["jobs", "messages"]);
  tree = h.render(); assert.equal(select(tree, "Quick access preset").props.value, "custom");
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
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
  assert.ok(labelled(dialog, "First name")); assert.ok(labelled(dialog, "Email for invitation"));
  assert.equal(nodes(dialog, node => node.type === "permission-fields").length, 1);
  assert.equal(h.document.activeElement, h.firstControl);
  assert.equal(h.document.body.style.overflow, "hidden");
  button(dialog, "Cancel").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.props?.role === "dialog").length, 0);
  assert.equal(h.document.activeElement, h.launcher);
  assert.equal(h.document.body.style.overflow, "auto");
  assert.equal(h.calls.length, 0);
});

test("member details save that person's name, phone, title and access while preserving sign-in email", async () => {
  const member = { id: "member-one", displayName: "Alex Smith", email: "alex@example.test", phone: "0400 123 456", jobTitle: "Auditor", role: "reviewer", status: "active", lastLoginAt: "", permissions: ["jobs", "calculator"] };
  const h = harness({ members: [member] }); let tree = h.render();
  assert.equal(nodes(tree, node => node.type === "permission-fields").length, 0);
  button(tree, "Open details").props.onClick(); tree = h.render();
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  assert.equal(labelled(dialog, "First name").props.value, "Alex"); assert.equal(labelled(dialog, "Last name").props.value, "Smith");
  assert.equal(labelled(dialog, "Sign-in email").props.value, "alex@example.test"); assert.equal(labelled(dialog, "Sign-in email").props.readOnly, true);
  labelled(dialog, "Sign-in email").props.onChange({ target: { value: "other@example.test" } });
  labelled(dialog, "Last name").props.onChange({ target: { value: "Jones" } });
  labelled(dialog, "Phone, optional").props.onChange({ target: { value: "0411 222 333abc" } });
  labelled(dialog, "Job title, optional").props.onChange({ target: { value: "Senior auditor" } });
  assert.deepEqual(nodes(dialog, node => node.type === "permission-fields")[0].props.permissions, member.permissions);
  nodes(dialog, node => node.type === "permission-fields")[0].props.onChange(["jobs", "messages"]);
  tree = h.render(); select(tree, "Access state").props.onChange({ target: { value: "suspended" } });
  tree = h.render(); await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls[0].body, { action: "update_member_access", memberId: "member-one", displayName: "Alex Jones", phone: "0411 222 333", jobTitle: "Senior auditor", role: "reviewer", status: "suspended", permissions: ["jobs", "messages"] });
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
  labelled(tree, "First name").props.onChange({ target: { value: "Keep this draft" } }); tree = h.render();
  const pending = nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = h.render();
  assert.equal(button(tree, "Saving...").props.disabled, true);
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  dialog.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1); assert.equal(nodes(h.render(), node => node.props?.role === "dialog").length, 1);
  rejectRequest(Error("Keep at least one active administrator.")); await pending; tree = h.render();
  assert.equal(labelled(tree, "First name").props.value, "Keep this draft");
  assert.equal(nodes(tree, node => node.props?.role === "alert").map(text).join(" "), "Keep at least one active administrator.");
  assert.ok(button(nodes(tree, node => node.props?.role === "dialog")[0], "Add team member"));
});

test("nonadministrators cannot open invitation or member access editors", () => {
  const h = harness({ flags: { role: "reviewer", canConfirmNamedOwner: false } }); const tree = h.render();
  assert.equal(button(tree, "Add team member"), undefined);
  assert.equal(nodes(tree, node => node.type === "form" || node.props?.role === "dialog").length, 0);
});

test("individual permissions stay editable for administrators and preserve role ceilings and dependencies", () => {
  const permissionDeclaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PermissionFields");
  const permissionCode = ts.transpileModule(`export ${permissionDeclaration.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  Function("require", "exports", "creditexAllowedPermissions", "CREDITEX_PERMISSION_GROUPS", "styles", "setCreditexPermission", permissionCode)(name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, creditexAllowedPermissions, CREDITEX_PERMISSION_GROUPS, {}, setCreditexPermission);
  let result;
  const render = (role, permissions) => exports.PermissionFields({ role, permissions, disabled: false, onChange: next => { result = next; } });
  const checkbox = (tree, label) => nodes(tree, node => node.type === "label" && text(node).includes(label))[0].props.children[0];
  checkbox(render("reviewer", []), "Complete job audits").props.onChange({ target: { checked: true } }); assert.deepEqual(result, ["jobs", "audit"]);
  checkbox(render("reviewer", result), "View jobs and files").props.onChange({ target: { checked: false } }); assert.deepEqual(result, []);
  assert.equal(checkbox(render("auditor", creditexRolePermissions("auditor")), "Create and edit form drafts").props.disabled, true);
  const administrator = render("admin", creditexRolePermissions("admin"));
  assert.ok(nodes(administrator, node => node.type === "fieldset").every(node => !node.props.disabled));
  checkbox(administrator, "Call customers").props.onChange({ target: { checked: false } });
  assert.ok(!result.includes("customer_calls")); assert.ok(result.includes("customers"));
  assert.equal(nodes(administrator, node => node.type === "label" && text(node).includes("Calculator")).length, 0);
});

test("roster uses TLink contact columns and filters names, phones, titles, status and role", () => {
  const members = [
    { id: "alex", displayName: "Alex Smith", email: "alex@example.test", phone: "0400 123 456", jobTitle: "Lead auditor", role: "reviewer", status: "active", permissions: ["jobs"] },
    { id: "sam", displayName: "Sam Taylor", email: "sam@example.test", phone: "0422 888 999", jobTitle: "Coordinator", role: "case_manager", status: "suspended", permissions: ["jobs"] },
  ];
  const h = harness({ members }); let tree = h.render();
  assert.deepEqual(nodes(tree, node => node.type === "th").map(text), ["First name", "Last name", "Phone", "Email", "Status", "Role", "Actions"]);
  const rows = tree => nodes(nodes(tree, node => node.type === "tbody")[0], node => node.type === "tr");
  assert.equal(rows(tree).length, 2);
  labelled(tree, "Search").props.onChange({ target: { value: " LEAD AUDITOR " } }); tree = h.render();
  assert.equal(rows(tree).length, 1); assert.match(text(rows(tree)[0]), /Alex/);
  labelled(tree, "Search").props.onChange({ target: { value: "0422" } }); tree = h.render();
  assert.match(text(rows(tree)[0]), /Sam/);
  labelled(tree, "Search").props.onChange({ target: { value: "" } });
  select(tree, "Status").props.onChange({ target: { value: "active" } }); tree = h.render();
  assert.equal(rows(tree).length, 1); assert.match(text(rows(tree)[0]), /Alex/);
  select(tree, "Role").props.onChange({ target: { value: "case_manager" } }); tree = h.render();
  assert.equal(rows(tree).length, 0); assert.match(text(tree), /No team members match/);
});

test("capped roster counts disclose the loaded list instead of implying a complete search", () => {
  const h = harness({ members: [{ id: "alex", displayName: "Alex Smith", email: "alex@example.test", role: "reviewer", status: "active", permissions: [] }], memberTotal: 270 });
  assert.match(text(h.render()), /Showing\s+1\s+of\s+270\s+team members\s*\. Filters search this loaded list/);
});

test("contact managers can edit details without receiving invitation or access controls", async () => {
  const h = harness({ flags: { role: "reviewer", permissions: ["team_details"], canConfirmNamedOwner: false }, members: [{ id: "alex", displayName: "Alex Smith", email: "alex@example.test", phone: "", jobTitle: "", role: "auditor", status: "active", permissions: ["jobs"] }] });
  let tree = h.render();
  assert.equal(button(tree, "Add team member"), undefined); assert.equal(button(tree, "Invitations"), undefined);
  button(tree, "Open details").props.onClick(); tree = h.render();
  const dialog = nodes(tree, node => node.props?.role === "dialog")[0];
  assert.equal(nodes(dialog, node => node.type === "permission-fields" || node.type === "select").length, 0);
  labelled(dialog, "Job title, optional").props.onChange({ target: { value: "Auditor" } }); tree = h.render();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls[0].body, { action: "update_member_details", memberId: "alex", displayName: "Alex Smith", phone: "", jobTitle: "Auditor" });
});

test("new member contact fields and custom access submit canonical details", async () => {
  const h = harness(); let tree = h.render(); button(tree, "Add team member").props.onClick(); tree = h.render();
  for (const [label, value] of [["First name", "  Laura  "], ["Last name", "Jones"], ["Email for invitation", "laura@example.test"], ["Phone, optional", "0400 111 222"], ["Job title, optional", "Compliance lead"]]) labelled(tree, label).props.onChange({ target: { value } });
  select(tree, "Quick access preset").props.onChange({ target: { value: "custom" } }); tree = h.render();
  const fields = nodes(tree, node => node.type === "permission-fields")[0];
  assert.equal(fields.props.role, "admin"); assert.deepEqual(fields.props.permissions, []);
  fields.props.onChange(["customers"]); tree = h.render();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls[0].body, { action: "create_invitation", displayName: "Laura Jones", email: "laura@example.test", phone: "0400 111 222", jobTitle: "Compliance lead", role: "admin", permissions: ["customers"] });
});

test("invitations stay in their roster view and revoke only the selected pending invitation", async () => {
  const invitations = [
    { id: "pending-one", displayName: "New Person", email: "new@example.test", role: "auditor", status: "pending", permissions: ["jobs"], expiresAt: "2026-10-20" },
    { id: "claimed-one", displayName: "Joined Person", email: "joined@example.test", role: "reviewer", status: "claimed", permissions: ["jobs"], expiresAt: "2026-10-19" },
  ];
  const h = harness({ invitations }); let tree = h.render();
  assert.equal(button(tree, "Revoke invitation"), undefined);
  button(tree, "Invitations").props.onClick(); tree = h.render();
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Revoke invitation").length, 1);
  select(tree, "Status").props.onChange({ target: { value: "pending" } }); tree = h.render();
  assert.doesNotMatch(text(tree), /Joined Person/);
  button(tree, "Revoke invitation").props.onClick(); await flush();
  assert.deepEqual(h.calls[0].body, { action: "revoke_invitation", invitationId: "pending-one" });
});

test("app setup uses the real Creditex named-account sign-in and never exposes trade PIN actions", () => {
  const h = harness(); let tree = h.render(); button(tree, "Add team member").props.onClick(); tree = h.render();
  const panel = nodes(tree, node => node.props?.["aria-label"] === "TLink app access")[0];
  assert.match(text(panel), /Creditex team sign-in/); assert.match(text(panel), /invited email, password and authenticator code/);
  assert.equal(nodes(panel, node => node.type === "a")[0].props.href, "/direct-trade/field-app");
  assert.doesNotMatch(text(panel), /PIN|username|Generate/);
});
