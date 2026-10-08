import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let refreshEffect;
let resendHandler;
let stateGate;
function inspect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("function scheduleApprovalCheck()")) refreshEffect = node.arguments[0];
  if (ts.isFunctionDeclaration(node) && node.name?.text === "resendVerificationEmail") resendHandler = node;
  if (ts.isConditionalExpression(node) && node.condition.getText(ast) === "!authReady || loading") stateGate = node;
  ts.forEachChild(node, inspect);
}
inspect(ast);
assert.ok(refreshEffect);
assert.ok(resendHandler);
assert.ok(stateGate);
const effectCode = compile(`const start = ${refreshEffect.getText(ast)};`);
const resendCode = compile(resendHandler.getText(ast));
const pendingProfile = {
  businessName: "Example trade", accountStatus: "active", partnerType: "installer",
  emailVerified: true, businessApprovalApproved: false,
  entitlements: { verified: false, features: { installer_leads: false } },
};
const approvedProfile = {
  ...pendingProfile, businessApprovalApproved: true,
  entitlements: { verified: true, features: { installer_leads: true } },
};
const response = profile => ({ ok: true, json: async () => ({ ok: true, profile }) });
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
async function settle() { for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setImmediate(resolve)); }
function events() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type) { for (const handler of listeners.get(type) || []) handler(); },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}
function harness({ profiles = [pendingProfile], visibility = "visible", token, reloadAccount, profileRefresh = 0 } = {}) {
  const requests = [], tokens = [], changes = [], reloads = [], timers = new Map();
  let nextTimer = 0;
  const window = {
    ...events(), location: { origin: "https://tlink.example" },
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const document = { ...events(), visibilityState: visibility };
  const user = { uid: "business-owner", email: "owner@example.test", getIdToken: async force => {
    tokens.push(force); return token ? token(force) : "fixture-token";
  } };
  const values = {
    user, profileRefresh, window, document, AbortController,
    protectedIdentityUid: { current: user.uid }, protectedIdentityRevision: { current: 1 },
    reload: async account => { reloads.push(account.uid); await reloadAccount?.(account); },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      const item = profiles[Math.min(requests.length - 1, profiles.length - 1)];
      if (typeof item === "function") return item();
      if (item instanceof Error) throw item;
      return response(item);
    },
    isMfaRequiredResponse: () => false,
  };
  const state = {};
  for (const name of ["Loading", "Error", "CheckingApprovalStatus", "MfaRequired", "ApprovalRefreshError", "Profile", "Opportunities"]) {
    values[`set${name}`] = value => { changes.push([name, value]); state[name] = value; };
  }
  const cleanup = Function(...Object.keys(values), `${effectCode}\nreturn start();`)(...Object.values(values));
  return { values, requests, tokens, reloads, timers, changes, state, window, document, cleanup,
    async tick() {
      assert.equal(timers.size, 1, "only one pending timer may exist");
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); timer.callback(); await settle();
    } };
}

test("pending business approval opens the ready dashboard automatically without profile writes or loading flashes", async () => {
  const h = harness({ profiles: [pendingProfile, approvedProfile] });
  try {
    await settle();
    assert.equal(h.state.Profile.entitlements.verified, false);
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].milliseconds, 10_000);
    await h.tick();
    assert.equal(h.state.Profile.entitlements.verified, true);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.changes.filter(([name]) => name === "Loading").map(([, value]) => value), [true, false, false]);
    for (const request of h.requests) {
      assert.equal(request.url, "/api/trade-profile");
      assert.equal(request.cache, "no-store");
      assert.equal(request.method, undefined);
      assert.ok(request.signal instanceof AbortSignal);
    }
    h.window.emit("focus"); await settle();
    assert.equal(h.requests.length, 2, "approved accounts must stop checking");
  } finally { h.cleanup(); }
});

test("hidden pages pause pending checks and one return check handles repeated focus and visibility events", async () => {
  const inFlight = deferred();
  const h = harness({ profiles: [pendingProfile, () => inFlight.promise] });
  try {
    await settle(); h.document.visibilityState = "hidden"; h.document.emit("visibilitychange");
    assert.equal(h.timers.size, 0);
    h.window.emit("focus"); await settle(); assert.equal(h.requests.length, 1);
    h.document.visibilityState = "visible"; h.document.emit("visibilitychange");
    h.window.emit("focus"); h.window.emit("focus"); await settle();
    assert.equal(h.requests.length, 2, "overlapping events may not start another request");
    assert.equal(h.timers.size, 0);
    inFlight.resolve(response(pendingProfile)); await settle();
    assert.equal(h.timers.size, 1);
  } finally { h.cleanup(); }
});

test("background failures preserve the saved pending profile and show a truthful connection error", async () => {
  const h = harness({ profiles: [pendingProfile, new Error("fixture network failure"), approvedProfile] });
  try {
    await settle(); await h.tick();
    assert.equal(h.state.Profile, pendingProfile);
    assert.equal(h.state.Error, "");
    assert.match(h.state.ApprovalRefreshError, /could not check/);
    assert.doesNotMatch(h.state.ApprovalRefreshError, /approved|fixture/);
    assert.equal(h.timers.size, 1);
    await h.tick();
    assert.equal(h.state.Profile, approvedProfile);
    assert.equal(h.state.ApprovalRefreshError, "");
    assert.equal(h.timers.size, 0);
  } finally { h.cleanup(); }
});

test("an unverified mailbox reloads Firebase and uses fresh claims while preserving the business approval gate", async () => {
  const mailboxPending = { ...approvedProfile, emailVerified: false, entitlements: { verified: false, features: { installer_leads: false } } };
  const h = harness({ profiles: [mailboxPending, pendingProfile, approvedProfile] });
  try {
    await settle(); await h.tick();
    assert.deepEqual(h.reloads, ["business-owner"]);
    assert.deepEqual(h.tokens, [false, true]);
    assert.equal(h.state.Profile.emailVerified, true);
    assert.equal(h.state.Profile.entitlements.verified, false, "email verification may not approve the business");
    await h.tick(); assert.equal(h.state.Profile.entitlements.verified, true);
    assert.deepEqual(h.tokens, [false, true, false]);
  } finally { h.cleanup(); }
});

test("manual status checks reload Firebase claims and an initial failure keeps the existing recovery state", async () => {
  const h = harness({ profileRefresh: 1, profiles: [new Error("Account connection failed")] });
  try {
    await settle();
    assert.deepEqual(h.reloads, ["business-owner"]);
    assert.deepEqual(h.tokens, [true]);
    assert.equal(h.state.Error, "Account connection failed");
    assert.equal(h.state.Loading, false);
    assert.equal(h.timers.size, 0);
  } finally { h.cleanup(); }
});

test("cleanup aborts the pending request, removes observers and ignores its eventual reply", async () => {
  const inFlight = deferred();
  const h = harness({ profiles: [pendingProfile, () => inFlight.promise] });
  await settle(); h.window.emit("focus"); await settle();
  const before = h.changes.length;
  h.cleanup();
  assert.equal(h.requests.at(-1).signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.window.count("focus"), 0);
  assert.equal(h.document.count("visibilitychange"), 0);
  inFlight.resolve(response(approvedProfile)); await settle();
  assert.equal(h.changes.length, before);
  assert.equal(h.state.Profile, pendingProfile);
});

test("changing the identity while token resolution is pending prevents an old request", async () => {
  const token = deferred(); const h = harness({ token: () => token.promise });
  try {
    h.values.protectedIdentityUid.current = "another-user";
    h.values.protectedIdentityRevision.current++;
    token.resolve("old-account-token"); await settle();
    assert.equal(h.requests.length, 0);
    assert.equal(h.state.Profile, undefined);
    assert.equal(h.timers.size, 0);
  } finally { h.cleanup(); }
});

test("a reply from the previous identity cannot expose its approval or profile to the next user", async () => {
  const inFlight = deferred(); const h = harness({ profiles: [() => inFlight.promise] });
  try {
    await settle(); assert.equal(h.requests.length, 1);
    const before = h.changes.length;
    h.values.protectedIdentityUid.current = "another-user";
    h.values.protectedIdentityRevision.current++;
    inFlight.resolve(response(approvedProfile)); await settle();
    assert.equal(h.state.Profile, undefined);
    assert.equal(h.changes.length, before);
    assert.equal(h.timers.size, 0);
  } finally { h.cleanup(); }
});

test("no account profile and inactive accounts never start approval polling", async () => {
  for (const profile of [null, { ...pendingProfile, accountStatus: "closed" }, { ...pendingProfile, accountStatus: "suspended" }, approvedProfile]) {
    const h = harness({ profiles: [profile] });
    try {
      await settle(); h.window.emit("focus"); await settle();
      assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
    } finally { h.cleanup(); }
  }
});

async function resend({ failure = false, identityChanges = false } = {}) {
  const calls = [], messages = [], busy = [];
  const values = {
    user: { uid: "owner", email: "owner@example.test" }, verificationSending: false,
    protectedIdentityUid: { current: "owner" }, protectedIdentityRevision: { current: 1 },
    window: { location: { origin: "https://tlink.example" } }, URL,
    setVerificationSending: value => busy.push(value), setVerificationMessage: value => messages.push(value),
    sendEmailVerification: async (user, settings) => {
      calls.push({ uid: user.uid, settings });
      if (identityChanges) { values.protectedIdentityUid.current = "other"; values.protectedIdentityRevision.current++; }
      if (failure) throw new Error("private provider internals");
    },
  };
  await Function(...Object.keys(values), `${resendCode}\nreturn resendVerificationEmail();`)(...Object.values(values));
  return { calls, messages, busy };
}

test("verification resend reports success only after acceptance and never leaks provider failures", async () => {
  const success = await resend();
  assert.deepEqual(success.calls, [{ uid: "owner", settings: { url: "https://tlink.example/direct-trade/dashboard" } }]);
  assert.match(success.messages.at(-1), /Verification email sent to owner@example.test/);
  assert.deepEqual(success.busy, [true, false]);
  const failure = await resend({ failure: true });
  assert.match(failure.messages.at(-1), /could not be sent/);
  assert.doesNotMatch(failure.messages.at(-1), /Verification email sent|private provider/);
  const stale = await resend({ identityChanges: true });
  assert.deepEqual(stale.messages, [""]);
});

function gateBranches(node) {
  return ts.isConditionalExpression(node)
    ? ts.factory.updateConditionalExpression(node, node.condition, node.questionToken, node.whenTrue, node.colonToken, gateBranches(node.whenFalse))
    : ts.factory.createStringLiteral("approved workspace");
}
const gateCode = compile(`const result = ${ts.createPrinter().printNode(ts.EmitHint.Expression, gateBranches(stateGate), ast)};`);
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number"
  ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function renderGate(profile) {
  const values = {
    require: () => jsx, exports: {}, profile, user: { uid: "owner", email: "owner@example.test" },
    authReady: true, loading: false, error: "", profileComplete: true, profileSetupOpen: false,
    initialAuthMode: "signin", checkingApprovalStatus: false, approvalRefreshError: "", verificationSending: false, verificationMessage: "",
    businessProfileSaved() {}, closeBusinessSetup() {}, leaveAccount() {}, setProfileRefresh() {}, setProfileSetupOpen() {}, resendVerificationEmail() {},
    DirectTradePartnerForm: "BusinessSetup", TradeAccessPanel: "TradeAccess",
  };
  return Function(...Object.keys(values), `${gateCode}\nreturn result;`)(...Object.values(values));
}
test("business approval and mailbox verification have distinct truthful states and neither unlocks alone", () => {
  const approvedMailboxPending = text(renderGate({ ...approvedProfile, emailVerified: false, entitlements: { verified: false } }));
  assert.match(approvedMailboxPending, /business is approved\. Confirm your email/);
  assert.match(approvedMailboxPending, /inbox and junk or spam/);
  assert.match(approvedMailboxPending, /I've verified my email/);
  assert.doesNotMatch(text(renderGate({ ...approvedProfile, emailVerified: false, entitlements: { verified: false } })), /locked until approval/);
  assert.match(text(renderGate({ ...pendingProfile, emailVerified: false })), /Confirm your email while we review your business/);
  assert.match(text(renderGate(pendingProfile)), /locked until approval/);
  assert.equal(renderGate(approvedProfile), "approved workspace");
});
