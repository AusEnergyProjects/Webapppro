import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as portals from "../src/lib/tlink-portals.ts";
import * as businessClient from "../src/lib/trade-business-client.ts";

const workspaceBarExports = {};
const workspaceBarSource = readFileSync(new URL("../src/components/TLinkWorkspaceBar.tsx", import.meta.url), "utf8");
const workspaceBarDependencies = { react: { useRef: () => ({ current: null }), useEffect() {} }, "react/jsx-runtime": jsx,
  "@/lib/tlink-portals": portals, "./TLinkPortalSwitcher": { TLinkPortalSwitcher: "portal-switcher" }, "./TLinkWorkspaceBar.module.css": { default: {} } };
Function("require", "exports", ts.transpileModule(workspaceBarSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(id => workspaceBarDependencies[id], workspaceBarExports);
const workspaceBar = workspaceBarExports.TLinkWorkspaceBar;
const renderedChildren = node => node?.type === workspaceBar ? workspaceBar(node.props) : node?.props?.children;

const source = readFileSync(new URL("../src/components/TradeBusinessProvider.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const choice = (ownerUid, role = "member") => ({ ownerUid, role, businessName: `Business ${ownerUid}`, memberId: `${ownerUid}-member`, displayName: "Person" });
const nodes = (node, matches) => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, matches)) : [...(matches(node) ? [node] : []), ...nodes(renderedChildren(node), matches)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ").replace(/\s+/g, " ") : text(renderedChildren(node));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(initialChoices, { destination = "member", saved = "", disableNotifications = async () => {}, user = { uid: "person", emailVerified: true, getIdToken: async () => "identity-token" } } = {}) {
  let cursor = 0, businesses = initialChoices, authObserver;
  const state = [], effects = [], pending = [], requests = [], redirects = [], storage = new Map();
  const store = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  if (saved) businessClient.saveTradeBusinessSelection(user.uid, saved, store);
  const changed = (previous, next) => !previous || previous.length !== next.length || previous.some((value, index) => value !== next[index]);
  const react = {
    createContext: () => ({ Provider: () => null }), useContext: () => null,
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo(create, dependencies) { const index = cursor++; if (!state[index] || changed(state[index].dependencies, dependencies)) state[index] = { dependencies, value: create() }; return state[index].value; },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) { const previous = effects[index]; effects[index] = { dependencies }; pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = callback(); }); } },
  };
  const context = { ...businessClient,
    readTradeBusinessSelection: uid => businessClient.readTradeBusinessSelection(uid, store),
    saveTradeBusinessSelection: (uid, ownerUid) => businessClient.saveTradeBusinessSelection(uid, ownerUid, store),
  };
  const fetch = async (url, init) => { requests.push({ url, init }); return Response.json({ businesses, requiresSelection: businesses.length > 1 }); };
  const dependencies = { react, "react/jsx-runtime": jsx, "firebase/auth": { onIdTokenChanged(_auth, callback) { authObserver = callback; callback(user); return () => {}; } }, "@/lib/firebase-client": { firebaseAuth: {} }, "@/lib/trade-device-client": { disableTradeDeviceNotifications: disableNotifications }, "@/lib/trade-business-client": context, "./TradeBusinessProvider.module.css": { default: {} }, "./TradeWorkTimeTracking": { TradeWorkTimeProvider: ({ children }) => children }, "./TLinkWorkspaceBar": { TLinkWorkspaceBar: workspaceBar } };
  const exports = {};
  const window = { location: { origin: "https://tlink.test", replace: url => redirects.push(url) }, history: { replaceState() {} } };
  Function("require", "exports", "fetch", "window", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, exports, fetch, window);
  const child = jsx.jsx("article", { "data-tenant": true, children: "Tenant jobs and calls" });
  const render = () => { cursor = 0; const tree = exports.TradeBusinessGate({ destination, children: child }); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, redirects, store, setChoices: next => { businesses = next; }, authenticate: next => authObserver(next),
    async settle() { let tree; for (let count = 0; count < 5; count++) { tree = render(); await tick(); } return tree; } };
}

test("multiple memberships mount no tenant content until the user selects a business", async () => {
  const h = harness([choice("one"), choice("two")]);
  let tree = await h.settle();
  assert.match(text(tree), /Which business are you working with/);
  assert.equal(nodes(tree, node => node.props?.["data-tenant"]).length, 0);
  const portal = nodes(tree, node => node.type === "portal-switcher")[0];
  assert.equal(portal.props.current, "trade");
  assert.equal(portal.props.user.uid, "person");
  assert.deepEqual(h.requests.map(request => request.url), ["/api/trade-businesses"]);
  nodes(tree, node => node.type === "button" && text(node).includes("Business two"))[0].props.onClick();
  tree = h.render();
  assert.equal(tree.props.business.ownerUid, "two");
  assert.match(text(tree), /Working with Business two/);
  assert.equal(nodes(tree, node => node.props?.["data-tenant"]).length, 1);
  assert.equal(nodes(tree, node => node.type === "portal-switcher")[0].props.current, "trade");
});

test("switching removes the entire selected subtree and remounts with the next tenant key", async () => {
  const h = harness([choice("one"), choice("two")], { saved: "one" });
  let tree = await h.settle();
  assert.equal(tree.key, "person:one");
  nodes(tree, node => node.type === "button" && text(node) === "Switch business")[0].props.onClick();
  await tick();
  tree = h.render();
  assert.equal(nodes(tree, node => node.props?.["data-tenant"]).length, 0);
  assert.equal(businessClient.readTradeBusinessSelection("person", h.store), "");
  nodes(tree, node => node.type === "button" && text(node).includes("Business two"))[0].props.onClick();
  assert.equal(h.render().key, "person:two");
});

test("switch waits for old-business notification cleanup and preserves the workspace if cleanup fails", async () => {
  let finish;
  const h = harness([choice("one"), choice("two")], { saved: "one", disableNotifications: async (headers, request) => {
    await request("/api/trade-push", { method: "DELETE", headers: await headers(), body: JSON.stringify({ subscriptionId: "old-device" }) });
    await new Promise((_resolve, reject) => { finish = reject; });
  } });
  let tree = await h.settle();
  nodes(tree, node => node.type === "button" && text(node) === "Switch business")[0].props.onClick();
  await tick();
  tree = h.render();
  assert.equal(tree.key, "person:one");
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Switching...")[0].props.disabled, true);
  const deletion = h.requests.find(request => request.url === "/api/trade-push");
  assert.equal(new Headers(deletion.init.headers).get("X-TLink-Business"), "one");
  assert.equal(new Headers(deletion.init.headers).get("Authorization"), "Bearer identity-token");
  finish(new Error("offline"));
  await tick();
  tree = h.render();
  assert.equal(tree.key, "person:one");
  assert.equal(businessClient.readTradeBusinessSelection("person", h.store), "one");
  assert.match(text(tree), /try switching business again/);
});

test("single membership auto-opens and owner choice routes to the own-business dashboard", async () => {
  const single = harness([choice("one")]);
  assert.equal((await single.settle()).props.business.ownerUid, "one");
  const multiple = harness([choice("person", "owner"), choice("employer")]);
  const tree = await multiple.settle();
  nodes(tree, node => node.type === "button" && text(node).includes("Your business"))[0].props.onClick();
  assert.deepEqual(multiple.redirects, ["/direct-trade/dashboard"]);
  assert.equal(businessClient.readTradeBusinessSelection("person", multiple.store), "person");
});

test("the welcome message uses the owner's optional manager or the signed-in team member's first name", async () => {
  for (const [business, expected] of [
    [{ ...choice("person", "owner"), managerName: "  James Morris " }, "Welcome James"],
    [{ ...choice("employer"), displayName: "Katja Rosic", managerName: "Another manager" }, "Welcome Katja"],
    [{ ...choice("person", "owner"), displayName: "Australian Energy Assessments" }, "Welcome"],
  ]) {
    const tree = await harness([business], { destination: "messages" }).settle();
    assert.equal(text(nodes(tree, node => node.props?.["data-tlink-welcome"] !== undefined)[0]), expected);
  }
});

test("saved manager names refresh the welcome immediately without replacing a subsequently selected business", async () => {
  const h = harness([choice("person", "owner"), { ...choice("employer"), displayName: "Katja Rosic" }], { destination: "messages", saved: "person" });
  let tree = await h.settle();
  tree.props.onPersonalNameChange("James Morris");
  tree = h.render();
  assert.match(text(tree), /Welcome James/);
  tree.props.onPersonalNameChange("");
  tree = h.render();
  assert.equal(text(nodes(tree, node => node.props?.["data-tlink-welcome"] !== undefined)[0]), "Welcome");
  const delayedUpdate = tree.props.onPersonalNameChange;
  nodes(tree, node => node.type === "button" && text(node) === "Switch business")[0].props.onClick();
  await tick();
  tree = h.render();
  nodes(tree, node => node.type === "button" && text(node).includes("Business employer"))[0].props.onClick();
  delayedUpdate("Updated manager");
  tree = h.render();
  assert.equal(tree.props.business.ownerUid, "employer");
  assert.match(text(tree), /Welcome Katja/);
});

test("a message notification keeps owners and members in the scoped messages destination", async () => {
  for (const business of [choice("person", "owner"), choice("employer")]) {
    const h = harness([business], { destination: "messages" });
    assert.equal((await h.settle()).props.business.ownerUid, business.ownerUid);
    assert.deepEqual(h.redirects, []);
  }
});

test("a staff personal-name change updates only that member's greeting", async () => {
  const h = harness([{ ...choice("employer"), displayName: "Katja Rosic" }], { destination: "messages" });
  let tree = await h.settle();
  tree.props.onPersonalNameChange("Katja Smith");
  tree = h.render();
  assert.equal(tree.props.business.displayName, "Katja Smith");
  assert.equal(tree.props.business.managerName, undefined);
  assert.match(text(tree), /Welcome Katja/);
});

test("messages gates normal Firebase entry while preserving an existing or fresh native handoff", () => {
  const communication = readFileSync(new URL("../src/components/TradeCommunicationPage.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("TradeCommunicationPage.tsx", communication, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wrapper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TradeCommunicationPage");
  const code = ts.transpileModule(wrapper.getText(ast).replace("export default ", ""), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [hash, saved, expected] of [["", "", "business-gate"], ["#handoff=one-use-code", "", "communication-content"], ["", "member-id", "communication-content"]]) {
    let nativeSession = null;
    const render = Function("require", "useState", "useEffect", "window", "sessionStorage", "TradeBusinessGate", "TradeCommunicationContent", `const exports = {};\n${code}\nreturn TradeCommunicationPage();`);
    const args = [() => jsx, () => [nativeSession, value => { nativeSession = value; }], effect => effect(), { location: { hash }, requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {} }, { getItem: () => saved }, "business-gate", "communication-content"];
    render(...args);
    const tree = render(...args);
    assert.equal(tree.type, expected);
    if (expected === "business-gate") assert.equal(tree.props.destination, "messages");
  }
});

test("revoked context removes stale content and refreshes only the available choices", async () => {
  const h = harness([choice("one"), choice("two")], { saved: "one" });
  let tree = await h.settle();
  h.setChoices([choice("two")]);
  tree.props.onAccessLost();
  assert.equal(nodes(h.render(), node => node.props?.["data-tenant"]).length, 0);
  tree = await h.settle();
  assert.equal(tree.props.business.ownerUid, "two");
  assert.equal(h.requests.length, 2);
});

test("foreign saved selection is ignored and sign-out clears only that user's selection", async () => {
  const h = harness([choice("one"), choice("two")], { saved: "foreign" });
  assert.match(text(await h.settle()), /Which business/);
  businessClient.saveTradeBusinessSelection("other-person", "other-business", h.store);
  h.authenticate(null);
  h.render();
  assert.equal(businessClient.readTradeBusinessSelection("person", h.store), "");
  assert.equal(businessClient.readTradeBusinessSelection("other-person", h.store), "other-business");
});

test("invitation acceptance selects the invited business before any ambiguous team data load", async () => {
  const portal = readFileSync(new URL("../src/components/TradeTeamPortal.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("TradeTeamPortal.tsx", portal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('action: "accept_invite"')) callback = node.arguments[0];
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(callback, "real invitation effect must exist");
  const effect = ts.transpileModule(`const run = ${callback.getText(ast)}; run();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [], state = [];
  let frame;
  const bindings = {
    user: { uid: "person", email: "member@example.test", getIdToken: async fresh => { assert.equal(fresh, true); return "fresh-token"; } },
    emailVerified: true, invitationReady: true, invitationError: "", invitation: { email: "member@example.test" }, inviteToken: "invite-token",
    window: { requestAnimationFrame: fn => { frame = fn; return 1; }, cancelAnimationFrame() {}, history: { replaceState: (_state, _title, url) => calls.push(["navigate", url]) } },
    fetch: async (url, init) => { calls.push(["accept", url, JSON.parse(init.body)]); assert.equal(init.headers.Authorization, "Bearer fresh-token"); return Response.json({ ok: true, accepted: true, ownerUid: "employer", businessName: "Employer" }); },
    saveTradeBusinessSelection: (uid, ownerUid) => calls.push(["select", uid, ownerUid]),
    onInvitationAccepted: () => calls.push(["open-chooser"]), loadWork: async () => { assert.fail("team data cannot load until selected tenant context is mounted"); },
    setLoading: value => state.push(value), setMfaRequired: () => assert.fail("MFA is not required in this case"), setStatus: message => { assert.equal(message, ""); }, setData: () => assert.fail("old tenant data must not be set"), setSelectedJobId: () => assert.fail("no old job selected"),
  };
  Function(...Object.keys(bindings), effect)(...Object.values(bindings));
  frame(); await tick();
  assert.deepEqual(calls, [["accept", "/api/trade-team", { action: "accept_invite", token: "invite-token" }], ["select", "person", "employer"], ["navigate", "/direct-trade/team"], ["open-chooser"]]);
  const h = harness([choice("person", "owner"), choice("employer")], { saved: "employer" });
  assert.equal((await h.settle()).props.business.ownerUid, "employer");
});

test("an unmounted business provider cannot replace the active chooser from a delayed denied request", async () => {
  const cleanups = [], lost = [];
  let respond;
  const request = new Promise(resolve => { respond = resolve; });
  const react = { createContext: () => ({ Provider: () => null }), useRef: value => ({ current: value }), useCallback: callback => callback, useMemo: create => create(), useEffect: effect => cleanups.push(effect()) };
  const dependencies = { react, "react/jsx-runtime": jsx, "firebase/auth": {}, "@/lib/firebase-client": {}, "@/lib/trade-device-client": {}, "@/lib/trade-business-client": businessClient, "./TradeBusinessProvider.module.css": { default: {} }, "./TradeWorkTimeTracking": { TradeWorkTimeProvider: ({ children }) => children }, "./TLinkWorkspaceBar": { TLinkWorkspaceBar: workspaceBar } };
  const exports = {};
  Function("require", "exports", "fetch", "window", compiled)(id => dependencies[id], exports, () => request, { location: { origin: "https://tlink.test" } });
  const tree = exports.TradeBusinessProvider({ business: choice("old-business"), onAccessLost: () => lost.push(true), children: null });
  const pending = tree.props.value.request("/api/trade-team", { headers: { Authorization: "Bearer token" } });
  for (const cleanup of cleanups) cleanup?.();
  respond(Response.json({ code: "BUSINESS_ACCESS_REQUIRED" }, { status: 403 }));
  assert.equal((await pending).status, 403);
  assert.deepEqual(lost, []);
});
