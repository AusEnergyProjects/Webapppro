import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const ast = ts.createSourceFile("dashboard.tsx", dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let gate;
function find(node) { if (ts.isConditionalExpression(node) && node.condition.getText(ast) === "!authReady || loading") gate = node; ts.forEachChild(node, find); }
find(ast);
assert.ok(gate);
function stateBranches(node) { return ts.isConditionalExpression(node) ? ts.factory.updateConditionalExpression(node, node.condition, node.questionToken, node.whenTrue, node.colonToken, stateBranches(node.whenFalse)) : ts.factory.createStringLiteral("approved workspace"); }
const gateCode = compile(`const result = ${ts.createPrinter().printNode(ts.EmitHint.Expression, stateBranches(gate), ast)};`);
const profile = { businessName: "Example", accountStatus: "active", entitlements: { verified: true } };
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate)); return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]; }
function renderGate(overrides = {}) {
  const values = { require: () => jsx, exports: {}, authReady: true, loading: false, user: { uid: "owner" }, error: "", profile, profileComplete: true,
    profileSetupOpen: false, initialAuthMode: "signin", checkingApprovalStatus: false, approvalRefreshError: "",
    verificationSending: false, verificationMessage: "", resendVerificationEmail() {},
    businessProfileSaved() {}, closeBusinessSetup() {}, leaveAccount() {}, setProfileRefresh() {}, setProfileSetupOpen() {},
    DirectTradePartnerForm: "BusinessSetup", TradeAccessPanel: "TradeAccess", ...overrides };
  return Function(...Object.keys(values), `${gateCode}\nreturn result;`)(...Object.values(values));
}

test("dashboard account states preserve approval and closed-account gates", () => {
  assert.match(text(renderGate({ authReady: false })), /Preparing/);
  assert.equal(renderGate({ user: null }).type, "BusinessSetup");
  assert.equal(renderGate({ profile: null, profileComplete: false }).type, "BusinessSetup");
  assert.equal(renderGate({ profileComplete: false }).type, "BusinessSetup");
  assert.equal(renderGate({ profileSetupOpen: true }).type, "BusinessSetup");
  assert.match(text(renderGate({ profile: { ...profile, entitlements: { verified: false } } })), /locked until approval/);
  assert.match(text(renderGate({ profile: { ...profile, accountStatus: "closed" }, profileSetupOpen: true, profileComplete: false })), /account is closed/);
  assert.match(text(renderGate({ error: "Network unavailable" })), /Network unavailable/);
  assert.equal(renderGate(), "approved workspace");
  assert.match(dashboard, /!workspaceVisible && <TLinkHeader/);
  assert.match(dashboard, /!profileSetupOpen && profile\?\.accountStatus !== "closed" && profileComplete && profile\?\.entitlements\.verified/);
});

test("retired pages execute one-way redirects into the dashboard", () => {
  for (const [route, target] of [["partners", "/direct-trade/dashboard?setup=1"], ["access", "/direct-trade/dashboard"]]) {
    const output = {};
    Function("require", "exports", compile(read(`../src/app/direct-trade/${route}/page.tsx`)))(() => ({ redirect: value => { throw new Error(`redirect:${value}`); } }), output);
    assert.throws(() => output.default(), { message: `redirect:${target}` });
  }
  assert.doesNotMatch(dashboard, /href="\/direct-trade\/(?:partners|access)"/);
  assert.doesNotMatch(read("../src/components/TLinkChrome.tsx"), />Trade account<|>Free access</);
});

const saved = { businessName: "Example", abn: "73675233557", addressLine1: "1 Example Street", suburb: "Sydney", addressState: "NSW", postcode: "2000", contactName: "Owner", phone: "0412345678", partnerType: "installer", serviceStates: ["NSW"], capabilities: ["electrical"] };
const formCode = compile(read("../src/components/DirectTradePartnerForm.tsx"));
function formHarness({ loadOk = true, saveOk = true, savedProfile = saved } = {}) {
  const state = [], effectState = [], pending = [], requests = [];
  let cursor = 0, savedCount = 0, signOutCount = 0;
  const user = { uid: "owner", email: "owner@example.test", getIdToken: async () => "test-token" };
  const fetch = async (url, init = {}) => { requests.push({ url, ...init }); return { ok: init.method ? saveOk : loadOk, json: async () => init.method ? { ok: saveOk, error: "Business review is required" } : { profile: savedProfile, error: "Could not load saved profile" } }; };
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === "function" ? value() : value; return [state[i], next => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++; const old = effectState[i]; if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) { old?.cleanup?.(); effectState[i] = { deps }; pending.push(() => { effectState[i].cleanup = callback(); }); } },
  };
  const imports = {
    react: hooks, "react/jsx-runtime": jsx, "firebase/auth": { onAuthStateChanged: (_auth, next) => { next(user); return () => {}; } },
    "@/lib/firebase-client": { firebaseAuth: {} }, "@/lib/tlink-password-reset-client": {},
    "./FirebaseMfa": { useFirebaseMfaChallenge: () => ({ resolver: null }) }, "./ComparatorChrome": { Field: "Field" },
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch }, "@/lib/australian-postcodes.mjs": { AUSTRALIAN_STATE_CODES: ["NSW"] },
    "@/lib/energy-service-catalogue.mjs": { TRADE_SERVICE_OPTIONS: [["electrical", "Electrical"]] }, "./AustralianAddressLookup": { AustralianAddressLookup: "Address" },
    "./DirectTradePartnerForm.module.css": { default: {} },
  };
  const output = {};
  Function("require", "exports", formCode)(id => { assert.ok(id in imports, id); return imports[id]; }, output);
  const render = () => { cursor = 0; return output.DirectTradePartnerForm({ onSaved: () => savedCount++, onSignOut: async () => { signOutCount++; } }); };
  return { requests, render, get savedCount() { return savedCount; }, get signOutCount() { return signOutCount; }, async settle() { let tree; for (let i = 0; i < 6; i++) { tree = render(); for (const effect of pending.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); } return tree; } };
}

test("saved business details load before editing and profile errors cannot submit blank replacement data", async () => {
  const h = formHarness({ loadOk: false }); const tree = await h.settle();
  assert.match(text(tree), /Could not load saved profile/);
  assert.equal(nodes(tree, node => node.type === "form").length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.savedCount, 0);
});

test("profile save returns to dashboard only after server success and sign-out uses the dashboard callback", async () => {
  for (const partnerType of ["installer", "supplier"]) {
    for (const saveOk of [true, false]) {
      const h = formHarness({ saveOk, savedProfile: { ...saved, partnerType } }); let tree = await h.settle();
      assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "radio").length, 0);
      assert.doesNotMatch(text(tree), /Business type|Product supplier or wholesaler/);
      const contactField = nodes(tree, node => node.type === "Field" && node.props.label === "Business contact number")[0];
      const contactInput = nodes(contactField, node => node.type === "input")[0];
      assert.equal(contactInput.props.value, saved.phone);
      contactInput.props.onChange({ target: { value: "0498765432" } }); tree = h.render();
      await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = h.render();
      assert.equal(h.savedCount, saveOk ? 1 : 0);
      assert.equal(h.requests.at(-1).headers.Authorization, "Bearer test-token");
      assert.equal(JSON.parse(h.requests.at(-1).body).abn, saved.abn);
      assert.equal(JSON.parse(h.requests.at(-1).body).partnerType, partnerType);
      assert.equal(JSON.parse(h.requests.at(-1).body).phone, "0498765432");
      if (!saveOk) assert.match(text(tree), /Business review is required/);
      await nodes(tree, node => node.type === "button" && text(node) === "Sign out")[0].props.onClick();
      assert.equal(h.signOutCount, 1);
    }
  }
});
