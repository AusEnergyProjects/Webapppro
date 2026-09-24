import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as firebaseApp from "firebase/app";
import * as firebaseAuth from "firebase/auth";
import * as firebaseMfa from "../src/lib/firebase-mfa.ts";

const read = name => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
const compile = name => ts.transpileModule(read(`${name}.tsx`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const navigation = {};
Function("require", "exports", compile("AdminWorkspaceNavigation"))(name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, navigation);
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node).replace(/\s+/g, " ").trim() === label)[0];

test("desktop and mobile navigation preserve every role boundary", () => {
  for (const role of ["owner", "admin", "reviewer", "support"]) {
    const selected = [];
    const tree = navigation.AdminWorkspaceNavigation({ selected: "inbox", role, unread: 0, onSelect: tab => { selected.push(tab); return true; } });
    const links = nodes(tree, node => node.type === "button");
    for (const link of links) link.props.onClick();
    const options = nodes(tree, node => node.type === "option").map(node => node.props.value);
    assert.deepEqual(selected, options);
    assert.equal(selected.length, role === "owner" ? 20 : role === "support" ? 15 : 18);
    assert.equal(Boolean(button(tree, "Database")), role === "owner");
    assert.equal(Boolean(button(tree, "Access & audit")), role === "owner");
    assert.equal(Boolean(button(tree, "Training")), role !== "support");
    assert.equal(Boolean(button(tree, "Submissions")), role !== "support");
    assert.equal(Boolean(button(tree, "AI answer reviews")), role !== "support");
    assert.ok(button(tree, "Activity forms"));
  }
});

test("Submissions, Training and Activity forms are direct visible compliance sections with labelled selection and icons", () => {
  const tree = navigation.AdminWorkspaceNavigation({ selected: "compliance-questions", role: "owner", unread: 4, onSelect: () => true });
  const section = nodes(tree, node => node.type === "section" && node.props["aria-label"] === "Compliance")[0];
  assert.ok(button(section, "Submissions"));
  assert.ok(button(section, "Training"));
  assert.ok(button(section, "Activity forms"));
  for (const details of nodes(tree, node => node.type === "details")) assert.doesNotMatch(text(details), /Submissions|Training|Activity forms/);
  assert.equal(button(tree, "Training").props["aria-current"], "page");
  assert.equal(nodes(tree, node => node.props?.["aria-current"] === "page").length, 1);
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "4 unread alerts").length, 1);
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/<svg /g) || []).length, 20);
  assert.match(html, /aria-hidden="true" focusable="false"/);
});

test("selected secondary groups open and rejected mobile changes restore the controlled selection", () => {
  const attempts = [];
  const tree = navigation.AdminWorkspaceNavigation({ selected: "database", role: "owner", unread: 0, onSelect: tab => { attempts.push(tab); return false; } });
  assert.equal(nodes(tree, node => node.type === "details" && text(node).includes("Administration"))[0].props.open, true);
  const select = nodes(tree, node => node.type === "select")[0];
  const input = { value: "form-governance" };
  select.props.onChange({ target: input, currentTarget: input });
  assert.deepEqual(attempts, ["form-governance"]);
  assert.equal(input.value, "database");
  select.props.onChange({ target: { value: "not-a-workspace" }, currentTarget: input });
  assert.equal(attempts.length, 1);
});

test("deep links resolve only available sections, including the existing inbox anchor", () => {
  assert.equal(navigation.adminWorkspaceTabFromHash("#form-governance", "owner"), "form-governance");
  assert.equal(navigation.adminWorkspaceTabFromHash("#operations-inbox", "admin"), "inbox");
  assert.equal(navigation.adminWorkspaceTabFromHash("", "admin"), "inbox");
  assert.equal(navigation.adminWorkspaceTabFromHash("#database", "reviewer"), null);
  assert.equal(navigation.adminWorkspaceTabFromHash("#compliance-questions", "support"), null);
  assert.equal(navigation.adminWorkspaceTabFromHash("#compliance-submissions", "support"), null);
  for (const role of ["owner", "admin", "reviewer"]) assert.equal(navigation.adminWorkspaceTabFromHash("#compliance-submissions", role), "compliance-submissions");
  assert.equal(navigation.adminWorkspaceTabFromHash("#unknown", "owner"), null);
});

function portalHarness({ hash = "", role = "owner" } = {}) {
  const slots = [], callbacks = [], effects = [], queued = [], listeners = new Map(), confirmations = [], focusCalls = [];
  let cursor = 0, stateIndex = 0, permitDiscard = false, historyIndex = 0;
  const history = [hash];
  const historyStates = [{ existingRouterState: "preserved" }];
  // The real MFA hook owns state 0 (no pending challenge); the portal's
  // mfaRequired state follows. Seed only this navigation fixture's session.
  const seeded = { 2: { uid: "owner" }, 3: true, 4: { role, email: "owner@example.invalid", displayName: "Owner" }, 7: false };
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const hooks = {
    useState(initial) { const i = cursor++, index = stateIndex++; if (!(i in slots)) slots[i] = index in seeded ? seeded[index] : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(callback, deps) { const i = cursor++; if (changed(callbacks[i]?.deps, deps)) callbacks[i] = { callback, deps }; return callbacks[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps }; queued.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const window = {
    location: { hash },
    history: {
      get state() { return historyStates[historyIndex]; },
      pushState(state, _title, url) { history.splice(++historyIndex); historyStates.splice(historyIndex); history.push(url); historyStates.push(state); window.location.hash = url; },
      replaceState(state, _title, url) { historyStates[historyIndex] = state; if (url !== undefined) { history[historyIndex] = url; window.location.hash = url; } },
      go(distance) { const index = historyIndex + distance; if (index < 0 || index >= history.length) return; historyIndex = index; window.location.hash = history[index]; dispatch("popstate"); dispatch("hashchange"); },
    },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    confirm(message) { confirmations.push(message); return permitDiscard; },
    requestAnimationFrame(callback) { callback(); },
  };
  const stubbed = new Map();
  const mfa = {};
  const require = name => name === "react" ? hooks : name === "react/jsx-runtime" ? jsx
    : name === "./AdminWorkspaceNavigation" ? navigation
      : name === "./FirebaseMfa" ? mfa
      : name === "firebase/app" ? firebaseApp
      : name === "@/lib/firebase-mfa" ? firebaseMfa
      : name === "firebase/auth" ? { ...firebaseAuth, onAuthStateChanged: () => () => {} }
        : name === "@/lib/firebase-client" ? { firebaseAuth: {} }
          : name === "next/dynamic" ? { default: () => () => null }
            : name.endsWith(".css") ? {} : new Proxy({}, { get: (_, key) => { const id = `${name}/${String(key)}`; if (!stubbed.has(id)) stubbed.set(id, () => null); return stubbed.get(id); } });
  Function("require", "exports", compile("FirebaseMfa"))(require, mfa);
  const exported = {};
  Function("require", "exports", "window", "document", compile("AdminOperationsPortal"))(require, exported, window, { getElementById: id => ({ focus(options) { focusCalls.push({ id, options }); }, scrollIntoView() {} }) });
  const render = () => { cursor = 0; stateIndex = 0; const tree = exported.AdminOperationsPortal(); for (const effect of queued.splice(0)) effect(); return tree; };
  const settle = () => { render(); return render(); };
  const nav = tree => nodes(tree, node => node.type === navigation.AdminWorkspaceNavigation)[0].props;
  const dispatch = name => { for (const listener of [...(listeners.get(name) || [])]) listener(); };
  return { render, settle, nav, window, history, confirmations, focusCalls, get historyIndex() { return historyIndex; },
    permitDiscard(value) { permitDiscard = value; },
    back() { window.history.go(-1); },
    forward() { window.history.go(1); },
    hashChange(value) { history.splice(++historyIndex); historyStates.splice(historyIndex); history.push(value); historyStates.push(null); window.location.hash = value; dispatch("hashchange"); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("portal opens linked forms and preserves back/forward navigation between selected workspaces", () => {
  const h = portalHarness({ hash: "#form-governance" }); let tree = h.settle();
  assert.equal(h.nav(tree).selected, "form-governance");
  h.nav(tree).onSelect("jobs"); tree = h.settle();
  assert.equal(h.window.location.hash, "#jobs");
  h.back(); tree = h.settle(); assert.equal(h.nav(tree).selected, "form-governance");
  h.forward(); tree = h.settle(); assert.equal(h.nav(tree).selected, "jobs");
  h.hashChange("#compliance-questions"); tree = h.settle(); assert.equal(h.nav(tree).selected, "compliance-questions");
  h.cleanup();
});

test("unsaved training edits block desktop, alert and browser-history navigation", () => {
  const h = portalHarness(); let tree = h.settle();
  h.nav(tree).onSelect("compliance-questions"); tree = h.settle();
  nodes(tree, node => typeof node.props?.onDirtyChange === "function")[0].props.onDirtyChange(true);
  assert.equal(h.nav(tree).onSelect("form-governance"), false);
  const alert = nodes(tree, node => node.type === "a" && node.props.href === "#operations-inbox")[0];
  alert.props.onClick({ preventDefault() {} }); tree = h.settle();
  assert.equal(h.nav(tree).selected, "compliance-questions");
  const originalHistory = [...h.history];
  h.back(); tree = h.settle(); assert.equal(h.nav(tree).selected, "compliance-questions");
  assert.equal(h.window.location.hash, "#compliance-questions");
  assert.deepEqual(h.history, originalHistory);
  assert.equal(h.historyIndex, 1);
  h.permitDiscard(true); assert.equal(h.nav(tree).onSelect("form-governance"), true); tree = h.settle();
  assert.equal(h.nav(tree).selected, "form-governance");
  assert.equal(h.confirmations.length, 4);
  h.cleanup();
});

test("skip link moves focus without changing section history or its Back destination", () => {
  const h = portalHarness({ hash: "#form-governance" }); let tree = h.settle();
  const skip = nodes(tree, node => node.type === "a" && node.props.className === "admin-skip-link")[0];
  let prevented = false;
  skip.props.onClick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.window.location.hash, "#form-governance");
  assert.deepEqual(h.history, ["#form-governance"]);
  assert.deepEqual(h.focusCalls, [{ id: "admin-workspace-content", options: { preventScroll: true } }]);
  assert.equal(h.window.history.state.existingRouterState, "preserved");
  h.nav(tree).onSelect("jobs"); tree = h.settle(); h.back(); tree = h.settle();
  assert.equal(h.nav(tree).selected, "form-governance");
  h.cleanup();
});

test("cancelling Forward restores its history position and keeps both destinations usable", () => {
  const h = portalHarness({ hash: "#form-governance" }); let tree = h.settle();
  h.nav(tree).onSelect("compliance-questions"); tree = h.settle(); h.nav(tree).onSelect("jobs"); tree = h.settle();
  h.back(); tree = h.settle();
  nodes(tree, node => typeof node.props?.onDirtyChange === "function")[0].props.onDirtyChange(true);
  const originalHistory = [...h.history];
  h.forward(); tree = h.settle();
  assert.equal(h.nav(tree).selected, "compliance-questions");
  assert.equal(h.historyIndex, 1);
  assert.deepEqual(h.history, originalHistory);
  h.permitDiscard(true); h.forward(); tree = h.settle();
  assert.equal(h.nav(tree).selected, "jobs"); assert.equal(h.historyIndex, 2);
  h.back(); tree = h.settle(); assert.equal(h.nav(tree).selected, "compliance-questions");
  h.back(); tree = h.settle(); assert.equal(h.nav(tree).selected, "form-governance");
  h.cleanup();
});

test("submission controls have one dedicated workspace and shell provides an accessible content target", () => {
  const h = portalHarness({ hash: "#form-governance" }); let tree = h.settle();
  assert.equal(nodes(tree, node => node.props?.endpoint === "/api/admin/compliance-registry").length, 0);
  assert.equal(nodes(tree, node => node.props?.endpoint === "/api/admin/compliance-output-actions").length, 0);
  h.nav(tree).onSelect("compliance-submissions"); tree = h.settle();
  assert.equal(h.window.location.hash, "#compliance-submissions");
  assert.equal(nodes(tree, node => node.props?.endpoint === "/api/admin/compliance-registry").length, 1);
  assert.equal(nodes(tree, node => node.props?.endpoint === "/api/admin/compliance-output-actions").length, 1);
  assert.ok(nodes(tree, node => node.type === "a" && node.props.href === "#admin-workspace-content")[0]);
  assert.equal(nodes(tree, node => node.props?.id === "admin-workspace-content")[0].props.tabIndex, -1);
  h.cleanup();
});
