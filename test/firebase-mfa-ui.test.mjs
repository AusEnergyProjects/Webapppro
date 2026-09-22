import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as policy from "../src/lib/firebase-mfa.ts";

const source = fs.readFileSync(new URL("../src/components/FirebaseMfa.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const form = (tree) => nodes(tree, (node) => node.type === "form")[0];
const input = (tree, predicate) => nodes(tree, (node) => node.type === "input" && predicate(node.props))[0];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
class FirebaseError extends Error { constructor(code) { super(code); this.code = code; } }

function harness({ verifiedEmail = true, alreadyEnrolled = false, failCode = false, challenge = false } = {}) {
  const state = []; let cursor = 0; let completed = 0;
  const calls = [];
  const user = { uid: "owner", email: "owner@example.invalid", emailVerified: verifiedEmail, providerData: [{ providerId: "password" }], reload: async () => {}, getIdToken: async (force) => { calls.push(["refresh", force]); }, getIdTokenResult: async () => ({ claims: { firebase: { sign_in_second_factor: alreadyEnrolled ? "totp" : undefined } } }) };
  const factor = { enrolledFactors: alreadyEnrolled ? [{ uid: "authenticator-one" }] : [], getSession: async () => { calls.push(["session"]); return "recent-session"; }, enroll: async (assertion, name) => { if (failCode) throw new FirebaseError("auth/invalid-verification-code"); calls.push(["enroll", assertion, name]); alreadyEnrolled = true; factor.enrolledFactors.push({ uid: "authenticator-one" }); } };
  const resolver = { hints: [{ factorId: "totp", uid: "authenticator-one" }], resolveSignIn: async (assertion) => { if (failCode) throw new FirebaseError("auth/invalid-verification-code"); calls.push(["resolve", assertion]); return { user }; } };
  const sdk = {
    multiFactor: () => factor,
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    reauthenticateWithCredential: async (_user, credential) => { calls.push(["reauthenticate", credential]); },
    reauthenticateWithPopup: async () => {},
    sendEmailVerification: async () => { calls.push(["verify-email"]); },
    getMultiFactorResolver: (_auth, error) => { assert.equal(error.code, "auth/multi-factor-auth-required"); return resolver; },
    TotpMultiFactorGenerator: {
      FACTOR_ID: "totp",
      generateSecret: async (session) => { assert.equal(session, "recent-session"); calls.push(["generate"]); return { secretKey: "SYNTHETIC-TEST-KEY" }; },
      assertionForEnrollment: (secret, code) => ({ secret: secret.secretKey, code }),
      assertionForSignIn: (uid, code) => ({ uid, code }),
    },
  };
  const hooks = {
    useState: (initial) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useCallback: (fn) => fn,
    useId: () => "mfa",
    useEffect: () => {},
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "firebase/auth") return sdk;
    if (name === "firebase/app") return { FirebaseError };
    if (name === "@/lib/firebase-client") return { firebaseAuth: { currentUser: user } };
    if (name === "@/lib/firebase-mfa") return policy;
    if (name.endsWith(".module.css")) return { default: {} };
    throw Error(name);
  }, exports);
  return { calls, user, exports, get completed() { return completed; }, render() { cursor = 0; return challenge ? exports.FirebaseMfaChallenge({ resolver, onCancel() {}, onComplete() { completed++; } }) : exports.FirebaseAccountSecurity({ user, onComplete() { completed++; } }); } };
}

test("enrollment verifies a fresh primary credential before generating a secret, then verifies the user's code", async () => {
  const h = harness(); let tree = h.render();
  input(tree, (props) => props.type === "password").props.onChange({ target: { value: "synthetic-password" } });
  tree = h.render(); form(tree).props.onSubmit({ preventDefault() {} }); await flush(); tree = h.render();
  assert.deepEqual(h.calls.map((call) => call[0]), ["reauthenticate", "session", "generate"]);
  assert.equal(input(tree, (props) => props.readOnly)?.props.value, "SYNTHETIC-TEST-KEY");
  input(tree, (props) => props.autoComplete === "one-time-code").props.onChange({ target: { value: "123456" } });
  tree = h.render(); await form(tree).props.onSubmit({ preventDefault() {} }); tree = h.render();
  assert.deepEqual(h.calls.at(-1), ["enroll", { secret: "SYNTHETIC-TEST-KEY", code: "123456" }, "TLink authenticator"]);
  assert.equal(input(tree, (props) => props.readOnly), undefined, "setup key is removed immediately after enrollment");
  assert.equal(h.completed, 1); assert.match(text(tree), /Authenticator verified/);
});

test("unverified email cannot generate a second factor", async () => {
  const h = harness({ verifiedEmail: false }); const tree = h.render();
  assert.equal(form(tree), undefined); assert.equal(button(tree, "Set up authenticator"), undefined);
  await button(tree, "Send verification email").props.onClick(); await flush();
  assert.deepEqual(h.calls, [["verify-email"]]);
});

test("a rejected enrollment code does not report success and keeps setup available", async () => {
  const h = harness({ failCode: true }); let tree = h.render();
  input(tree, (props) => props.type === "password").props.onChange({ target: { value: "synthetic-password" } });
  form(h.render()).props.onSubmit({ preventDefault() {} }); await flush();
  tree = h.render(); input(tree, (props) => props.autoComplete === "one-time-code").props.onChange({ target: { value: "000000" } });
  await form(h.render()).props.onSubmit({ preventDefault() {} }); tree = h.render();
  assert.equal(h.completed, 0); assert.match(text(tree), /code was not accepted/); assert.equal(input(tree, (props) => props.autoComplete === "one-time-code").props.value, "");
});

test("sign-in challenge resolves the enrolled Firebase factor and refreshes the signed token", async () => {
  const h = harness({ challenge: true }); let tree = h.render();
  input(tree, (props) => props.autoComplete === "one-time-code").props.onChange({ target: { value: "654321" } });
  await form(h.render()).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, [["resolve", { uid: "authenticator-one", code: "654321" }], ["refresh", true]]);
  assert.equal(h.completed, 1);
});

test("a rejected sign-in code never completes authentication", async () => {
  const h = harness({ challenge: true, failCode: true });
  await form(h.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(h.completed, 0); assert.deepEqual(h.calls, []); assert.match(text(h.render()), /code was not accepted/);
});
