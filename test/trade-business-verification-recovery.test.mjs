import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/TradeBusinessProvider.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let businessEffect, logoutHandler;
function inspect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("async function loadBusinesses()")) businessEffect = node.arguments[0];
  if (ts.isFunctionDeclaration(node) && node.name?.text === "leaveAccount") logoutHandler = node;
  ts.forEachChild(node, inspect);
}
inspect(ast);
assert.ok(businessEffect); assert.ok(logoutHandler);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const effectCode = compile(`const start = ${businessEffect.getText(ast)};`);
const logoutCode = compile(logoutHandler.getText(ast));
const deferred = () => {
  let resolve; const promise = new Promise(finish => { resolve = finish; });
  return { promise, resolve };
};
const settle = async () => { for (let count = 0; count < 5; count++) await new Promise(resolve => setImmediate(resolve)); };
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) || []) listener(); },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
  };
}
const employer = { ownerUid: "business-owner", role: "member", memberId: "team-member", businessName: "Employer", displayName: "Tester" };
function harness({ emailVerified = true, token, reload, reply } = {}) {
  const calls = [], updates = [], chosen = [];
  const user = { uid: "person", emailVerified,
    getIdToken: async force => { calls.push(["token", force]); return token ? token() : "fixture-fresh-token"; } };
  const window = eventTarget();
  const document = { ...eventTarget(), visibilityState: "visible" };
  const values = {
    user, retry: 0, window, document, AbortController,
    previousUid: { current: user.uid }, identityRevision: { current: 1 },
    reload: async account => { calls.push(["reload", account.uid]); await reload?.(account); },
    fetch: async (url, init) => { calls.push(["fetch", url, init]); return reply ? reply() : Response.json({ businesses: [employer] }); },
    readTradeBusinessSelection: () => "", resolveTradeBusinessSelection: list => list[0] || null,
    choose: business => chosen.push(business),
  };
  for (const name of ["EmailVerified", "Error", "Businesses", "Loading"]) values[`set${name}`] = value => updates.push([name, value]);
  const cleanup = Function(...Object.keys(values), `${effectCode}\nreturn start();`)(...Object.values(values));
  return { values, user, window, document, calls, updates, chosen, cleanup };
}

test("one pending verification check handles repeated focus and visibility events without concurrent account reloads", async () => {
  const check = deferred(); let reloadCount = 0;
  const h = harness({ emailVerified: false, reload: async () => { if (++reloadCount === 2) await check.promise; } });
  try {
    await settle(); assert.equal(reloadCount, 1);
    h.window.emit("focus"); h.window.emit("focus"); h.document.emit("visibilitychange"); await settle();
    assert.equal(reloadCount, 2);
    assert.equal(h.calls.some(([name]) => name === "fetch"), false);
    check.resolve(); await settle();
    assert.equal(h.updates.at(-1)[0], "Loading");
  } finally { h.cleanup(); }
});

test("hidden pages do not recheck verification and cleanup removes return listeners", async () => {
  const h = harness({ emailVerified: false });
  await settle();
  h.document.visibilityState = "hidden"; h.document.emit("visibilitychange"); h.window.emit("focus"); await settle();
  assert.equal(h.calls.filter(([name]) => name === "reload").length, 1);
  h.document.visibilityState = "visible"; h.document.emit("visibilitychange"); await settle();
  assert.equal(h.calls.filter(([name]) => name === "reload").length, 2);
  h.cleanup();
  assert.equal(h.window.listenerCount("focus"), 0);
  assert.equal(h.document.listenerCount("visibilitychange"), 0);
  h.window.emit("focus"); await settle();
  assert.equal(h.calls.filter(([name]) => name === "reload").length, 2);
});

test("an old identity cannot start a business request after token resolution completes", async () => {
  const token = deferred(); const h = harness({ token: () => token.promise });
  try {
    await settle(); const before = h.updates.length;
    h.values.previousUid.current = "another-person"; h.values.identityRevision.current++;
    token.resolve("fixture-old-identity-token"); await settle();
    assert.equal(h.calls.some(([name]) => name === "fetch"), false);
    assert.equal(h.updates.length, before); assert.equal(h.chosen.length, 0);
  } finally { h.cleanup(); }
});

test("a stale server reply cannot select or expose another identity's business", async () => {
  const reply = deferred(); const h = harness({ reply: () => reply.promise });
  try {
    await settle(); const before = h.updates.length;
    h.values.previousUid.current = "another-person"; h.values.identityRevision.current++;
    reply.resolve(Response.json({ businesses: [employer] })); await settle();
    assert.equal(h.updates.length, before); assert.equal(h.chosen.length, 0);
  } finally { h.cleanup(); }
});

test("unmount aborts the current business request and ignores the eventual response", async () => {
  const reply = deferred(); const h = harness({ reply: () => reply.promise });
  await settle(); const request = h.calls.find(([name]) => name === "fetch")[2];
  const before = h.updates.length; h.cleanup();
  assert.equal(request.signal.aborted, true);
  reply.resolve(Response.json({ businesses: [employer] })); await settle();
  assert.equal(h.updates.length, before); assert.equal(h.chosen.length, 0);
});

test("signing out during token refresh prevents the old account opening a business", async () => {
  const token = deferred(); const h = harness({ token: () => token.promise });
  try {
    await settle(); let signOutCount = 0;
    const values = {
      user: h.user, signingOut: false, selected: null,
      identityRevision: h.values.identityRevision, previousUid: h.values.previousUid,
      setSigningOut() {}, setAccountMessage() {}, firebaseAuth: {},
      disableTradeDeviceNotifications() { assert.fail("No tenant is selected during loading"); },
      signOut: async () => { signOutCount++; h.values.previousUid.current = ""; h.values.identityRevision.current++; },
    };
    await Function(...Object.keys(values), `${logoutCode}\nreturn leaveAccount();`)(...Object.values(values));
    assert.equal(signOutCount, 1);
    token.resolve("fixture-token-from-signed-out-account"); await settle();
    assert.equal(h.calls.some(([name]) => name === "fetch"), false);
    assert.equal(h.chosen.length, 0);
  } finally { h.cleanup(); }
});
