import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as settle } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const portal = readFileSync(new URL("../src/components/TradeTeamPortal.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("TradeTeamPortal.tsx", portal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let invitationEffect;
function findInvitationEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes("/api/trade-team/invitation?invite=")) {
    assert.equal(invitationEffect, undefined, "there must be one invitation loader");
    invitationEffect = node;
  }
  ts.forEachChild(node, findInvitationEffect);
}
findInvitationEffect(source);
assert.ok(invitationEffect, "the production invitation loading effect must exist");
const executable = ts.transpileModule(`(${invitationEffect.arguments[0].getText(source)})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const token = "a".repeat(43);
const invitation = {
  email: "member@example.invalid", displayName: "Team member", businessName: "Example business",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const validResponse = () => Response.json({ ok: true, invitation });
const invalidResponse = () => Response.json({ ok: false, code: "INVITATION_INVALID" }, { status: 410 });

// Run the production effect, while advancing browser frames/deadlines explicitly.
function harness({ user = null, authReady = false, search = `?invite=${token}`, fetchResponse = validResponse } = {}) {
  const state = {};
  const writes = [];
  const calls = [];
  const frames = new Map();
  const timers = new Map();
  let nextId = 1;
  let clearedPasswords = 0;
  const set = key => value => { state[key] = value; writes.push([key, value]); };
  const context = {
    user, authReady, invitationAttempt: 0, AbortController, URLSearchParams, Error, Promise,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchResponse(url, options, calls.length);
    },
    clearPasswordFields: () => { clearedPasswords++; },
    setInviteToken: set("token"), setInvitation: set("invitation"),
    setInvitationReady: set("ready"), setInvitationError: set("error"),
    setInvitationInvalid: set("invalid"), setEmail: set("email"),
    setName: set("name"), setMode: set("mode"),
    window: {
      location: { search },
      requestAnimationFrame: callback => { const id = nextId++; frames.set(id, callback); return id; },
      cancelAnimationFrame: id => frames.delete(id),
      setTimeout: (callback, delay) => { const id = nextId++; timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => timers.delete(id),
    },
  };
  let cleanup;
  const run = () => { cleanup = runInNewContext(executable, context); };
  run();
  return {
    state, writes, calls, timers,
    get clearedPasswords() { return clearedPasswords; },
    frame() {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
    },
    deadline() {
      assert.equal(timers.size, 1, "one deadline bounds the complete invitation request");
      const [id, timer] = [...timers][0];
      assert.ok(timer.delay > 0 && timer.delay <= 10_000, "the invitation wait must be bounded to ten seconds");
      timers.delete(id); timer.callback();
    },
    cleanup() { cleanup?.(); },
    retry() { cleanup?.(); context.invitationAttempt++; run(); },
  };
}

test("public invitation starts and resolves before Firebase restores the mobile session", async () => {
  const view = harness({ authReady: false });
  view.frame();
  assert.equal(view.calls.length, 1, "Firebase readiness must not gate the public request");
  assert.equal(view.calls[0].url, `/api/trade-team/invitation?invite=${token}`);
  assert.equal(view.calls[0].options.headers?.Authorization, undefined);
  await settle();
  assert.equal(view.state.ready, true);
  assert.deepEqual(view.state.invitation, invitation);
  assert.equal(view.state.email, invitation.email);
  assert.equal(view.state.mode, "create");
  assert.equal(view.clearedPasswords, 1);
  assert.equal(view.timers.size, 0);
});

test("a fresh public invitation never waits for or transmits a signed-in account token", async () => {
  let tokenRequests = 0;
  const view = harness({ user: { getIdToken() { tokenRequests++; return new Promise(() => {}); } } });
  view.frame(); await settle();
  assert.equal(view.state.ready, true);
  assert.deepEqual(view.state.invitation, invitation);
  assert.equal(tokenRequests, 0);
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].options.headers?.Authorization, undefined);
});

test("returning from password reset opens sign-in for the same invitation instead of creating another account", async () => {
  const view = harness({ search: `?invite=${token}&auth=signin` });
  view.frame(); await settle();
  assert.equal(view.state.ready, true);
  assert.equal(view.state.mode, "signin");
  assert.equal(view.state.token, token);
  assert.equal(view.state.email, invitation.email);
  assert.deepEqual(view.state.invitation, invitation);
  assert.equal(view.calls[0].url, `/api/trade-team/invitation?invite=${token}`);
});

test("a stalled request ends as a retryable connection problem, not an expired invitation", async () => {
  const view = harness({ fetchResponse: () => new Promise(() => {}) });
  view.frame(); view.deadline(); await settle();
  assert.equal(view.calls[0].options.signal.aborted, true);
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invalid, false);
  assert.equal(view.state.invitation, null);
  assert.match(view.state.error, /connection.*try again/i);
  assert.doesNotMatch(view.state.error, /expired|replaced|new invitation/i);
});

test("invalid old links promptly explain opening the newest Join team email without waiting for auth", async () => {
  const view = harness({ authReady: false, fetchResponse: invalidResponse });
  view.frame(); await settle();
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invalid, true);
  assert.equal(view.state.invitation, null);
  assert.match(view.state.error, /expired or been replaced/i);
  assert.match(view.state.error, /newest TLink invitation email.*Join team/i);
  assert.equal(view.calls.length, 1);
});

test("only a rejected public link retries with the existing account for bound invitation recovery", async () => {
  let tokenRequests = 0;
  const view = harness({
    user: { getIdToken: async () => { tokenRequests++; return "test-id-token"; } },
    fetchResponse: (_url, _options, attempt) => attempt === 1 ? invalidResponse() : validResponse(),
  });
  view.frame(); await settle();
  assert.equal(view.calls.length, 2);
  assert.equal(tokenRequests, 1);
  assert.equal(view.calls[0].options.headers?.Authorization, undefined);
  assert.equal(view.calls[1].options.headers.Authorization, "Bearer test-id-token");
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invalid, false);
  assert.deepEqual(view.state.invitation, invitation);
});

test("an authenticated rejected link remains unavailable and never exposes invitation data", async () => {
  const view = harness({ user: { getIdToken: async () => "wrong-account-token" }, fetchResponse: invalidResponse });
  view.frame(); await settle();
  assert.equal(view.calls.length, 2);
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invalid, true);
  assert.equal(view.state.invitation, null);
  assert.equal(view.state.email, undefined);
});

test("the deadline also bounds a stalled Firebase token refresh during bound-link recovery", async () => {
  const view = harness({ user: { getIdToken: () => new Promise(() => {}) }, fetchResponse: invalidResponse });
  view.frame(); await settle(); view.deadline(); await settle();
  assert.equal(view.calls.length, 1);
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invalid, false);
  assert.match(view.state.error, /connection.*try again/i);
});

for (const [name, fetchResponse] of [
  ["server failure", () => Response.json({ error: "internal details" }, { status: 503 })],
  ["malformed JSON", () => new Response("not-json", { status: 200 })],
  ["missing invitation", () => Response.json({ ok: true })],
  ["network failure", () => { throw new TypeError("Failed to fetch private-url"); }],
]) {
  test(`${name} offers connection recovery without falsely expiring the invitation or exposing details`, async () => {
    const view = harness({ fetchResponse });
    view.frame(); await settle();
    assert.equal(view.state.ready, true);
    assert.equal(view.state.invalid, false);
    assert.match(view.state.error, /connection.*try again/i);
    assert.doesNotMatch(view.state.error, /expired|internal details|private-url/i);
  });
}

test("cleanup aborts the request and prevents a late response from overwriting current invitation state", async () => {
  let resolveRequest;
  const view = harness({ fetchResponse: () => new Promise(resolve => { resolveRequest = resolve; }) });
  view.frame(); view.cleanup();
  assert.equal(view.calls[0].options.signal.aborted, true);
  assert.equal(view.timers.size, 0);
  const writesAtCleanup = view.writes.length;
  resolveRequest(validResponse()); await settle();
  assert.equal(view.writes.length, writesAtCleanup);
  assert.equal(view.state.invitation, undefined);
});

test("cleanup before the first browser frame prevents unnecessary requests", async () => {
  const view = harness(); view.cleanup(); view.frame(); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(view.writes.length, 0);
  assert.equal(view.timers.size, 0);
});

test("a response arriving after timeout cannot silently replace the retry state", async () => {
  let resolveRequest;
  const view = harness({ fetchResponse: () => new Promise(resolve => { resolveRequest = resolve; }) });
  view.frame(); view.deadline(); await settle();
  const writesAtTimeout = view.writes.length;
  resolveRequest(validResponse()); await settle();
  assert.equal(view.writes.length, writesAtTimeout);
  assert.equal(view.state.invitation, null);
  assert.equal(view.state.ready, true);
});

test("retry clears the connection failure and can open the same still-valid invitation", async () => {
  const view = harness({ fetchResponse: (_url, _options, attempt) => attempt === 1
    ? Response.json({}, { status: 503 }) : validResponse() });
  view.frame(); await settle();
  assert.match(view.state.error, /try again/i);
  view.retry(); view.frame(); await settle();
  assert.equal(view.calls.length, 2);
  assert.equal(view.calls[0].url, view.calls[1].url);
  assert.equal(view.state.error, "");
  assert.equal(view.state.ready, true);
  assert.deepEqual(view.state.invitation, invitation);
  assert.match(invitationEffect.arguments[1].getText(source), /\binvitationAttempt\b/,
    "the retry action must actually schedule this effect again");
});

test("normal portal entry without an invitation needs no public invitation request", async () => {
  const view = harness({ search: "" }); view.frame(); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(view.state.ready, true);
  assert.equal(view.state.invitation, null);
  assert.equal(view.timers.size, 0);
});
