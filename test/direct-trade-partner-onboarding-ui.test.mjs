import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/DirectTradePartnerForm.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const savedProfile = {
  businessName: "Synthetic Electrical", abn: "73675233557", addressLine1: "1 Example Street",
  suburb: "Melbourne", addressState: "VIC", postcode: "3000", contactName: "Synthetic Owner",
  phone: "0412345678", partnerType: "installer", serviceStates: ["VIC"], capabilities: ["electrical"],
  businessWebsite: "https://example.test/", summary: "Existing saved summary",
};
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number"
  ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const field = (tree, label) => nodes(nodes(tree, node => node.type === "Field" && node.props.label === label)[0],
  node => node.type === "input" || node.type === "textarea")[0];

function harness({ signedIn = true, verified = false, profile = savedProfile, verificationErrors = [], displayNameError = false,
  saveResult = { ok: true, profile: { accessApproved: true, emailVerified: true } }, saveOk = true } = {}) {
  const state = [], effects = [], pending = [], requests = [], calls = [];
  const user = { uid: "synthetic-owner", email: "owner@example.test", displayName: "Synthetic Owner", emailVerified: verified,
    getIdToken: async () => "synthetic-token" };
  let cursor = 0, authCallback, savedCount = 0;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === "function" ? value() : value;
      return [state[i], next => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useEffect(callback, deps) { const i = cursor++; const old = effects[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        old?.cleanup?.(); effects[i] = { deps }; pending.push(() => { effects[i].cleanup = callback(); });
      } },
  };
  const imports = {
    react: hooks, "react/jsx-runtime": jsx,
    "firebase/auth": {
      onAuthStateChanged: (_auth, next) => { authCallback = next; next(signedIn ? user : null); return () => {}; },
      createUserWithEmailAndPassword: async (_auth, email) => { calls.push(["create", email]); authCallback(user); return { user }; },
      updateProfile: async (_user, update) => { calls.push(["display-name", update]); if (displayNameError) throw new Error("Unavailable"); },
      sendEmailVerification: async (_user, settings) => { calls.push(["verification", settings]); const error = verificationErrors.shift(); if (error) throw error; },
    },
    "@/lib/firebase-client": { firebaseAuth: {} }, "@/lib/tlink-password-reset-client": {},
    "./FirebaseMfa": { useFirebaseMfaChallenge: () => ({ resolver: null, captureMfaError: () => false }) },
    "./ComparatorChrome": { Field: "Field" },
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetchProfile },
    "@/lib/australian-postcodes.mjs": { AUSTRALIAN_STATE_CODES: ["VIC"] },
    "@/lib/energy-service-catalogue.mjs": { TRADE_SERVICE_OPTIONS: [["electrical", "Electrical"]] },
    "./AustralianAddressLookup": { AustralianAddressLookup: "Address" },
    "./DirectTradePartnerForm.module.css": { default: {} },
  };
  async function fetchProfile(url, init = {}) {
    requests.push({ url, ...init });
    return { ok: init.method ? saveOk : true, json: async () => init.method ? saveResult : { profile } };
  }
  const output = {};
  Function("require", "exports", "window", compiled)(id => { assert.ok(id in imports, id); return imports[id]; }, output,
    { location: { origin: "https://synthetic.example.test" } });
  const render = () => { cursor = 0; return output.DirectTradePartnerForm({ initialMode: "create", onSaved: () => savedCount++, onSignOut: async () => {} }); };
  async function settle() { let tree; for (let i = 0; i < 7; i++) { tree = render(); for (const effect of pending.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)); } return tree; }
  return { calls, requests, render, settle, get savedCount() { return savedCount; } };
}

async function createAccount(h) {
  let tree = await h.settle();
  field(tree, "Your name").props.onChange({ target: { value: "Synthetic Owner" } });
  field(tree, "Business email").props.onChange({ target: { value: "owner@example.test" } });
  field(tree, "Password").props.onChange({ target: { value: "Synthetic-password-123" } });
  tree = h.render();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  return h.settle();
}

test("created account stays usable when verification delivery fails and resend does not create another account", async () => {
  const h = harness({ signedIn: false, profile: null, verificationErrors: [{ code: "auth/too-many-requests" }] });
  let tree = await createAccount(h);
  assert.match(text(tree), /account is created, but the verification email could not be sent/);
  assert.match(text(tree), /Too many attempts/);
  assert.doesNotMatch(text(tree), /We sent a verification link/);
  assert.equal(field(tree, "Contact name").props.value, "Synthetic Owner");
  field(tree, "Business name").props.onChange({ target: { value: "Keep my entered business" } });
  tree = h.render();
  await button(tree, "Resend verification email").props.onClick();
  tree = await h.settle();
  assert.match(text(tree), /We sent a verification link to owner@example.test/);
  assert.equal(field(tree, "Business name").props.value, "Keep my entered business");
  assert.equal(h.calls.filter(call => call[0] === "create").length, 1);
  assert.equal(h.calls.filter(call => call[0] === "verification").length, 2);
  assert.equal(h.calls.at(-1)[1].url, "https://synthetic.example.test/direct-trade/dashboard");
  assert.equal(h.savedCount, 0);
});

test("verification success remains visible after sign-in without claiming verified email or approved trade access", async () => {
  const h = harness({ signedIn: false, profile: null });
  const tree = await createAccount(h);
  assert.match(text(tree), /We sent a verification link/);
  assert.match(text(tree), /Check your inbox and junk\/spam folder/);
  assert.match(text(tree), /must verify your email before opening your workspace/);
  assert.match(text(tree), /Email confirmation and business approval are separate steps/);
  assert.ok(button(tree, "Resend verification email"));
  assert.equal(h.requests.filter(request => request.method).length, 0);
  assert.equal(h.savedCount, 0);
});

test("display-name failure does not misreport an already created account or lose its contact name", async () => {
  const h = harness({ signedIn: false, profile: null, displayNameError: true });
  const tree = await createAccount(h);
  assert.match(text(tree), /login display name could not be saved/);
  assert.match(text(tree), /We sent a verification link/);
  assert.equal(field(tree, "Contact name").props.value, "Synthetic Owner");
  assert.equal(h.calls.filter(call => call[0] === "create").length, 1);
});

test("signed-in unverified owners can resend without losing their existing business profile", async () => {
  const h = harness({ verificationErrors: [{ code: "auth/network-request-failed" }] });
  let tree = await h.settle();
  await button(tree, "Resend verification email").props.onClick();
  tree = await h.settle();
  assert.match(text(tree), /verification email could not be sent/);
  assert.equal(field(tree, "Business name").props.value, savedProfile.businessName);
  assert.equal(h.calls.filter(call => call[0] === "create").length, 0);
});

test("approved profile save uses the server access decision and retains optional settings", async () => {
  const h = harness({ verified: true });
  let tree = await h.settle();
  assert.equal(button(tree, "Resend verification email"), undefined);
  const optional = nodes(tree, node => node.type === "details")[0];
  assert.equal(optional.props.open, undefined);
  assert.match(text(optional), /Optional business details/);
  assert.match(text(optional), /later by updating this business profile/);
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = h.render();
  assert.match(text(tree), /saved and your approved workspace is ready/);
  assert.doesNotMatch(text(tree), /submitted for review/);
  assert.equal(h.savedCount, 1);
  const body = JSON.parse(h.requests.at(-1).body);
  assert.equal(body.businessWebsite, savedProfile.businessWebsite);
  assert.equal(body.summary, savedProfile.summary);
  assert.deepEqual(body.serviceStates, savedProfile.serviceStates);
  assert.deepEqual(body.capabilities, savedProfile.capabilities);
  assert.equal(body.consent, true);
});

test("unverified or pending saves give their actual next step, and rejected saves stay editable", async () => {
  for (const [profile, expected] of [
    [{ accessApproved: false, emailVerified: false, verificationStatus: "approved" }, /Confirm your email/],
    [{ accessApproved: false, emailVerified: true, verificationStatus: "submitted" }, /submitted for review/],
  ]) {
    const h = harness({ saveResult: { ok: true, profile } }); let tree = await h.settle();
    await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
    tree = h.render(); assert.match(text(tree), expected); assert.equal(h.savedCount, 1);
    if (profile.emailVerified === false) {
      assert.match(text(tree), /Confirm your email before opening your workspace/);
      assert.match(text(tree), /Check your inbox and junk\/spam folder/);
    }
  }
  const h = harness({ saveOk: false, saveResult: { ok: false, error: "Business review is required" } });
  let tree = await h.settle();
  await nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  tree = h.render(); assert.match(text(tree), /Business review is required/);
  assert.equal(field(tree, "Business name").props.value, savedProfile.businessName);
  assert.equal(h.savedCount, 0);
});

test("new-business entry points explain the separate team invitation route", async () => {
  const h = harness({ signedIn: false }); const tree = await h.settle();
  const link = nodes(tree, node => node.type === "a" && text(node) === "Open your team invitation")[0];
  assert.equal(link.props.href, "/direct-trade/team");
  assert.match(text(tree), /instead of creating a business/);
});
