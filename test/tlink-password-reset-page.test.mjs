import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { normalizeTLinkPasswordResetContinue } from "../src/lib/tlink-password-reset-continue.ts";
import { TLinkPasswordResetError, tlinkPasswordResetErrorMessage } from "../src/lib/tlink-password-reset-client.ts";

const source = readFileSync(new URL("../src/components/TLinkPasswordReset.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const content = node => typeof node === "string" ? node : !node || typeof node !== "object" ? "" : Array.isArray(node) ? node.map(content).join(" ") : content(node.props?.children);

function harness(t, options = {}) {
  const states = [], effects = [], pending = [], calls = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(initial) { return hooks.useState({ current: initial })[0]; },
    useEffect(callback, deps) { const i = cursor++, previous = effects[i]; if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) { previous?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); }); } },
  };
  const firebaseAuth = {};
  const dependencies = {
    react: hooks,
    "react/jsx-runtime": jsx,
    "next/image": { __esModule: true, default: "img" },
    "firebase/auth": {
      verifyPasswordResetCode: async (...args) => { calls.push(["verify", ...args]); return options.verify ? options.verify(...args) : "member@example.test"; },
      confirmPasswordReset: async (...args) => { calls.push(["confirm", ...args]); return options.confirm?.(...args); },
    },
    "@/lib/firebase-client": { firebaseAuth },
    "@/lib/tlink-password-reset-continue": { normalizeTLinkPasswordResetContinue },
    "@/lib/tlink-password-reset-client": {
      requestTLinkPasswordReset: async (...args) => { calls.push(["request", ...args]); return options.request?.(...args); },
      tlinkPasswordResetErrorMessage,
    },
    "./TLinkPasswordReset.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  const window = { location: { pathname: "/direct-trade/reset-password", search: options.search ?? "?oobCode=test-reset-code&continuePath=%2Fdirect-trade%2Fteam%3Finvite%3Dtest-invite" }, history: { state: { existing: true }, replaceState: (...args) => calls.push(["replace-url", ...args]) } };
  const exports = {};
  Function("require", "exports", "window", code)(id => { assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id]; }, exports, window);
  const render = () => { cursor = 0; const tree = exports.TLinkPasswordReset(); pending.splice(0).forEach(callback => callback()); return tree; };
  const input = id => nodes(render(), node => node.type === "input" && node.props.id === id)[0];
  const change = (id, value) => input(id).props.onChange({ target: { value } });
  const submit = async () => { await nodes(render(), node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); return render(); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  t.after(() => effects.forEach(effect => effect?.cleanup?.()));
  render();
  return { render, input, change, submit, settle, calls, firebaseAuth };
}

test("reset page verifies the link without requiring an authenticated session", async t => {
  const h = harness(t);
  assert.match(content(h.render()), /Checking your secure reset link/);
  const tree = await h.settle();
  assert.deepEqual(h.calls[0], ["verify", h.firebaseAuth, "test-reset-code"]);
  assert.match(content(tree), /member@example.test/);
  assert.equal(h.input("tlink-new-password").props.autoComplete, "new-password");
  assert.equal(h.input("tlink-confirm-password").props.autoComplete, "new-password");
  assert.doesNotMatch(source, /TradeBusinessGate|onAuthStateChanged|signInWith/);
});

test("mismatched and short passwords never reach Firebase confirmation", async t => {
  const h = harness(t);
  await h.settle();
  let focused = false;
  h.input("tlink-confirm-password").props.ref.current = { focus: () => { focused = true; } };
  h.change("tlink-new-password", "PrivatePasswordOne");
  h.change("tlink-confirm-password", "PrivatePasswordTwo");
  let tree = await h.submit();
  assert.match(content(tree), /passwords do not match/);
  assert.equal(focused, true);
  assert.equal(h.input("tlink-confirm-password").props["aria-invalid"], true);
  assert.doesNotMatch(content(tree), /PrivatePasswordOne|PrivatePasswordTwo/);
  h.change("tlink-new-password", "short");
  h.change("tlink-confirm-password", "short");
  tree = await h.submit();
  assert.match(content(tree), /at least 8 characters/);
  assert.equal(h.calls.filter(([action]) => action === "confirm").length, 0);
});

test("password visibility buttons work independently with labelled controls", async t => {
  const h = harness(t);
  await h.settle();
  const toggle = id => nodes(h.render(), node => node.type === "button" && node.props["aria-controls"] === id)[0];
  toggle("tlink-new-password").props.onClick();
  assert.equal(h.input("tlink-new-password").props.type, "text");
  assert.equal(h.input("tlink-confirm-password").props.type, "password");
  assert.equal(toggle("tlink-new-password").props["aria-label"], "Hide new password");
  toggle("tlink-confirm-password").props.onClick();
  assert.equal(h.input("tlink-confirm-password").props.type, "text");
  assert.equal(toggle("tlink-confirm-password").props["aria-pressed"], true);
  const css = readFileSync(new URL("../src/components/TLinkPasswordReset.module.css", import.meta.url), "utf8");
  assert.match(css, /\.visibility\s*\{[^}]*width: 44px; height: 44px;/);
});

test("matching passwords confirm once then clear secrets and retain the safe invitation link", async t => {
  let resolveConfirmation;
  const h = harness(t, { confirm: () => new Promise(resolve => { resolveConfirmation = resolve; }) });
  await h.settle();
  h.change("tlink-new-password", "PrivatePassword1!");
  h.change("tlink-confirm-password", "PrivatePassword1!");
  const saving = h.submit();
  assert.equal(h.input("tlink-new-password").props.disabled, true);
  await h.submit();
  assert.equal(h.calls.filter(([action]) => action === "confirm").length, 1);
  assert.deepEqual(h.calls.find(([action]) => action === "confirm"), ["confirm", h.firebaseAuth, "test-reset-code", "PrivatePassword1!"]);
  resolveConfirmation();
  const tree = await saving;
  assert.match(content(tree), /password has been updated/);
  assert.equal(nodes(tree, node => node.type === "input").length, 0);
  assert.equal(nodes(tree, node => node.type === "a" && node.props.href.startsWith("/"))[0].props.href, "/direct-trade/team?invite=test-invite");
  assert.deepEqual(h.calls.find(([action]) => action === "replace-url"), ["replace-url", { existing: true }, "", "/direct-trade/reset-password"]);
  assert.doesNotMatch(content(tree), /PrivatePassword1|test-reset-code/);
});

test("expired and missing links offer a fresh branded request with no false success", async t => {
  const h = harness(t, { verify: async () => { throw { code: "auth/expired-action-code", message: "PrivateToken" }; }, request: async () => { throw new TLinkPasswordResetError("unavailable"); } });
  let tree = await h.settle();
  assert.match(content(tree), /expired or has already been used/);
  assert.equal(h.input("tlink-new-password"), undefined);
  h.change("tlink-reset-email", "member@example.test");
  tree = await h.submit();
  assert.match(content(tree), /temporarily unavailable/);
  assert.doesNotMatch(content(tree), /Request accepted|PrivateToken/);
  assert.deepEqual(h.calls.find(([action]) => action === "request"), ["request", "member@example.test", "/direct-trade/team?invite=test-invite"]);

  const missing = harness(t, { search: "?continuePath=https%3A%2F%2Fevil.test" });
  await missing.settle();
  assert.equal(missing.calls.length, 0);
  missing.change("tlink-reset-email", "member@example.test");
  tree = await missing.submit();
  assert.match(content(tree), /Request accepted.*If this email has a login/);
  assert.deepEqual(missing.calls[0], ["request", "member@example.test", "/direct-trade/team"]);
});

test("verification network failures offer retry without calling a valid link expired", async t => {
  let attempts = 0;
  const h = harness(t, { verify: async () => { if (++attempts === 1) throw { code: "auth/network-request-failed" }; return "member@example.test"; } });
  let tree = await h.settle();
  assert.match(content(tree), /internet connection/);
  assert.doesNotMatch(content(tree), /expired/);
  nodes(tree, node => node.type === "button" && content(node).includes("Try again"))[0].props.onClick();
  h.render();
  tree = await h.settle();
  assert.match(content(tree), /Choose a new password/);
  assert.equal(attempts, 2);
});

test("confirmation errors remain safe and a link that expires during entry can be replaced", async t => {
  for (const [code, expected] of [["auth/weak-password", /stronger password/], ["auth/network-request-failed", /internet connection/], ["auth/unknown", /could not be updated/], ["auth/invalid-action-code", /expired or has already been used/]]) {
    const h = harness(t, { confirm: async () => { throw { code, message: "PrivateProviderToken" }; } });
    await h.settle();
    h.change("tlink-new-password", "PrivatePassword1!");
    h.change("tlink-confirm-password", "PrivatePassword1!");
    const tree = await h.submit();
    assert.match(content(tree), expected);
    assert.doesNotMatch(content(tree), /PrivateProviderToken|PrivatePassword1|password has been updated/);
    if (code === "auth/invalid-action-code") assert.ok(h.input("tlink-reset-email"));
    else assert.equal(h.input("tlink-new-password").props.disabled, false);
  }
});

test("reset route is unindexed, referrer-protected and directly renders the public reset form", () => {
  const route = readFileSync(new URL("../src/app/direct-trade/reset-password/page.tsx", import.meta.url), "utf8");
  assert.match(route, /index: false, follow: false, noarchive: true, nosnippet: true/);
  assert.match(route, /referrer: "no-referrer"/);
  assert.match(route, /return <TLinkPasswordReset \/>/);
});
