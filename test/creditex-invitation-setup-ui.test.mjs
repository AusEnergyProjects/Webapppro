import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as settle } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { teamAuthErrorCode, teamAuthErrorMessage } from "../src/components/trade-team-auth-errors.ts";

const component = readFileSync(new URL("../src/components/CreditexInvitationSetup.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/CreditexInvitationSetup.module.css", import.meta.url), "utf8");
const ast = ts.createSourceFile("CreditexInvitationSetup.tsx", component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const executable = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const invitationId = "00000000-0000-4000-8000-000000000001";
const invitation = { email: "member@example.invalid", displayName: "Test member", workspaceName: "Creditex", expiresAt: "2099-01-01T00:00:00Z" };
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === "object" ? [value, ...flatten(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
const accessibleText = value => Array.isArray(value) ? value.map(accessibleText).join("") : value && typeof value === "object" ? value.props?.["aria-hidden"] ? "" : accessibleText(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
const sameDependencies = (left, right) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));

// Exercise the compiled production component and its actual rendered handlers.
// The small hook runner supplies a browser lifecycle without a real account or email.
function harness(options = {}) {
  const calls = [], writes = [], slots = [], timers = new Map();
  const windowListeners = new Map(), documentListeners = new Map();
  let hookIndex = 0, nextTimer = 1, tree, unmounted = false, authListener, effectQueue = [];
  const auth = { currentUser: options.user || null };
  const account = options.account || { uid: "invited-user", email: invitation.email, displayName: "", emailVerified: false,
    getIdToken: async force => { calls.push(["token", force]); return "fixture-id-token"; } };
  const action = value => { auth.currentUser = value; authListener?.(value); };
  const properties = { invitationId, onComplete: async () => { calls.push(["complete"]); await options.onComplete?.(); } };
  const useState = initial => {
    const index = hookIndex++;
    if (!slots[index]) slots[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
    return [slots[index].value, next => { writes.push({ index, unmounted }); slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
  };
  const useRef = initial => {
    const index = hookIndex++;
    if (!slots[index]) slots[index] = { kind: "ref", value: { current: initial } };
    return slots[index].value;
  };
  const useCallback = (callback, dependencies) => {
    const index = hookIndex++;
    if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) slots[index] = { kind: "callback", dependencies, value: callback };
    return slots[index].value;
  };
  const useEffect = (effect, dependencies) => {
    const index = hookIndex++;
    if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
      const previousCleanup = slots[index]?.cleanup;
      slots[index] = { kind: "effect", dependencies };
      effectQueue.push(() => { previousCleanup?.(); slots[index].cleanup = effect(); });
    }
  };
  const context = {
    exports: {}, React: { createElement: jsx }, useState, useRef, useCallback, useEffect, useId: () => { hookIndex++; return "fixture-setup"; },
    firebaseAuth: auth, styles: new Proxy({}, { get: (_object, name) => name }), TLinkMark() {}, Link() {}, FirebaseMfaChallenge() {},
    useFirebaseMfaChallenge: () => ({ resolver: options.resolver || null, captureMfaError: error => { calls.push(["mfa", error.code]); return options.mfaHandled || false; }, clearMfaChallenge: () => calls.push(["clear-mfa"]) }),
    onAuthStateChanged: (_auth, listener) => { authListener = listener; listener(auth.currentUser); return () => { authListener = undefined; calls.push(["unsubscribe"]); }; },
    createUserWithEmailAndPassword: async (_auth, email, password) => {
      calls.push(["create", email, password]);
      if (options.createError) throw options.createError;
      await options.createWait; action(account); return { user: account };
    },
    signInWithEmailAndPassword: async (_auth, email, password) => {
      calls.push(["signin", email, password]); if (options.signInError) throw options.signInError;
      action(account); return { user: account };
    },
    GoogleAuthProvider: class { setCustomParameters(parameters) { calls.push(["google-parameters", parameters]); } },
    browserPopupRedirectResolver: "fixture-popup",
    signInWithPopup: async () => { calls.push(["google"]); action(account); return { user: account }; },
    updateProfile: async (user, values) => { calls.push(["profile", values]); user.displayName = values.displayName; },
    sendEmailVerification: async (user, settings) => {
      calls.push(["verification", user.email, settings]); if (options.verificationError) throw options.verificationError;
    },
    reload: async user => { calls.push(["reload"]); await options.reload?.(user, action); },
    signOut: async () => { calls.push(["signout"]); action(null); },
    requestTLinkPasswordReset: async (...arguments_) => { calls.push(["reset", ...arguments_]); if (options.resetError) throw options.resetError; },
    tlinkPasswordResetErrorMessage: () => "Password reset is temporarily unavailable.", teamAuthErrorCode, teamAuthErrorMessage,
    AbortController, URL, Date, Number, encodeURIComponent,
    fetch: async (url, request) => {
      calls.push(["fetch", url, request]);
      return options.response ? await options.response(url, request) : Response.json({ ok: true, invitation });
    },
    document: { visibilityState: "visible", addEventListener: (event, listener) => {
      if (!documentListeners.has(event)) documentListeners.set(event, new Set()); documentListeners.get(event).add(listener);
    }, removeEventListener: (event, listener) => documentListeners.get(event)?.delete(listener) },
    window: { location: { origin: "https://ausenergyassessments.com", reload: () => calls.push(["page-reload"]) },
      addEventListener: (event, listener) => { if (!windowListeners.has(event)) windowListeners.set(event, new Set()); windowListeners.get(event).add(listener); },
      removeEventListener: (event, listener) => windowListeners.get(event)?.delete(listener),
      setTimeout: (callback, delay) => { const key = nextTimer++; timers.set(key, { callback, delay }); return key; }, clearTimeout: key => timers.delete(key) },
  };
  runInNewContext(executable, context);
  function render() {
    hookIndex = 0; effectQueue = [];
    tree = context.exports.CreditexInvitationSetup(properties);
    for (const effect of effectQueue) effect();
    return tree;
  }
  function timersDue(delay) {
    for (const [key, timer] of [...timers]) if (timer.delay <= delay) { timers.delete(key); timer.callback(); }
  }
  function button(label) {
    const node = flatten(tree).find(item => item.type === "button" && accessibleText(item) === label);
    assert.ok(node, `expected button ${label}, rendered ${text(tree)}`); return node;
  }
  render();
  return { calls, writes, auth, account, context, timers, windowListeners, documentListeners, get tree() { return tree; }, render, action,
    async ready() { timersDue(0); await settle(); render(); await settle(); render(); },
    async press(label) { await button(label).props.onClick(); await settle(); render(); },
    enter(suffix, value) { const input = flatten(tree).find(item => item.type === "input" && item.props.id.endsWith(`-${suffix}`)); assert.ok(input); input.props.onChange({ target: { value } }); render(); },
    async submit() { const form = flatten(tree).find(item => item.type === "form"); assert.ok(form); await form.props.onSubmit({ preventDefault() {} }); await settle(); render(); },
    expire() { timersDue(10_000); render(); },
    async focus() { for (const listener of [...windowListeners.get("focus") || []]) listener(); await settle(); render(); },
    async visibility(value) { context.document.visibilityState = value; for (const listener of [...documentListeners.get("visibilitychange") || []]) listener(); await settle(); render(); },
    unmount() { unmounted = true; for (const slot of slots) if (slot?.kind === "effect") slot.cleanup?.(); },
    completeCount() { return calls.filter(([name]) => name === "complete").length; },
  };
}

test("pending public invitation opens a clearly labelled new account form with the invited email locked", async () => {
  const ui = harness(); await ui.ready();
  assert.match(text(ui.tree), /You've been invited/);
  assert.match(text(ui.tree), /Create account.*Sign in/);
  assert.match(text(ui.tree), /Click it once/);
  const email = flatten(ui.tree).find(node => node.type === "input" && node.props.type === "email");
  assert.equal(email.props.value, invitation.email); assert.equal(email.props.readOnly, true);
  assert.equal(flatten(ui.tree).filter(node => node.type === "input" && node.props.autoComplete === "new-password").length, 1);
  assert.equal(flatten(ui.tree).filter(node => node.type === "input").length, 2);
  assert.equal(flatten(ui.tree).some(node => node.type === "ol"), false);
  assert.equal(ui.calls.filter(([name]) => name === "fetch").length, 1);
  const [, url, options] = ui.calls.find(([name]) => name === "fetch");
  assert.equal(url, `/api/creditex/invitation?invite=${invitationId}`);
  assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store"); assert.equal(options.headers, undefined);
  assert.equal(ui.completeCount(), 0); ui.unmount();
});

test("a short password cannot create an account and no second password field is required", async () => {
  const ui = harness(); await ui.ready();
  ui.enter("password", "short"); await ui.submit();
  assert.match(text(ui.tree), /at least 8 characters/);
  assert.equal(ui.calls.some(([name]) => name === "create"), false);
  assert.equal(flatten(ui.tree).some(node => node.type === "input" && node.props.id.endsWith("-confirmation")), false);
  assert.doesNotMatch(text(ui.tree), /short/); ui.unmount();
});

test("Create account creates one login and requests verification without claiming the workspace", async () => {
  const ui = harness(); await ui.ready(); ui.enter("password", "FixturePassword1"); await ui.submit();
  assert.deepEqual(ui.calls.find(([name]) => name === "create"), ["create", invitation.email, "FixturePassword1"]);
  assert.equal(ui.calls.filter(([name]) => name === "verification").length, 1);
  assert.equal(ui.completeCount(), 0); assert.match(text(ui.tree), /Check your email/);
  const [, recipient, settings] = ui.calls.find(([name]) => name === "verification");
  assert.equal(recipient, invitation.email);
  const target = new URL(settings.url); assert.equal(target.pathname, "/creditex/compliance"); assert.equal(target.searchParams.get("invite"), invitationId);
  assert.ok(ui.calls.findIndex(([name]) => name === "create") < ui.calls.findIndex(([name]) => name === "verification"));
  assert.doesNotMatch(text(ui.tree), /FixturePassword1/); ui.unmount();
});

test("verification failure keeps the created account and provides explicit resend rather than fake delivery success", async () => {
  const ui = harness({ verificationError: { code: "auth/quota-exceeded" } }); await ui.ready();
  ui.enter("password", "FixturePassword1"); await ui.submit();
  assert.match(text(ui.tree), /account is saved, but the verification email could not be sent/);
  assert.match(text(ui.tree), /Resend verification email/); assert.equal(ui.completeCount(), 0);
  await ui.press("Resend verification email"); assert.equal(ui.calls.filter(([name]) => name === "verification").length, 2); ui.unmount();
});

test("verification check refreshes the account but never completes while email is unverified", async () => {
  const account = { uid: "existing", email: invitation.email, emailVerified: false, getIdToken: async () => assert.fail("no token before verification") };
  const ui = harness({ user: account }); await ui.ready(); await ui.press("I've verified my email");
  assert.match(text(ui.tree), /verification email and click its link once/); assert.equal(ui.completeCount(), 0);
  assert.equal(ui.calls.filter(([name]) => name === "reload").length, 2); ui.unmount();
});

test("an invited account with cached unverified state reloads and opens automatically after verification", async () => {
  const ui = harness({ reload: user => { user.emailVerified = true; } }); ui.action(ui.account); await ui.ready();
  assert.equal(ui.completeCount(), 1);
  assert.deepEqual(ui.calls.filter(([name]) => ["reload", "token", "complete"].includes(name)), [["reload"], ["token", true], ["complete"]]); ui.unmount();
});

test("an already verified invited account opens automatically once after public preflight", async () => {
  const account = { uid: "existing", email: invitation.email, emailVerified: true,
    getIdToken: async force => { ui.calls.push(["token", force]); return "fixture-token"; } };
  const ui = harness({ user: account }); await ui.ready();
  assert.equal(ui.completeCount(), 1);
  assert.deepEqual(ui.calls.filter(([name]) => ["reload", "token", "complete"].includes(name)), [["reload"], ["token", true], ["complete"]]);
  await ui.focus(); await ui.visibility("visible"); await ui.press("Continue to Creditex");
  assert.equal(ui.completeCount(), 1); assert.equal(ui.calls.filter(([name]) => name === "reload").length, 1); ui.unmount();
});

test("returning to the page after the verification link opens Creditex without another button click", async () => {
  let verified = false;
  const ui = harness({ user: { uid: "member", email: invitation.email, emailVerified: false, getIdToken: async () => "fixture-token" },
    reload: account => { account.emailVerified = verified; } }); await ui.ready();
  assert.equal(ui.completeCount(), 0); assert.equal(ui.calls.filter(([name]) => name === "reload").length, 1);
  verified = true; await ui.focus();
  assert.equal(ui.completeCount(), 1); assert.equal(ui.calls.some(([name]) => name === "verification"), false);
  ui.unmount(); assert.equal(ui.windowListeners.get("focus").size, 0); assert.equal(ui.documentListeners.get("visibilitychange").size, 0);
});

test("visibility return verifies the invited account while hidden documents and wrong identities are ignored", async () => {
  const user = { uid: "member", email: invitation.email, emailVerified: false, getIdToken: async () => "fixture-token" };
  let verified = false;
  const ui = harness({ user, reload: account => { account.emailVerified = verified; } }); await ui.ready();
  await ui.visibility("hidden"); await ui.focus();
  assert.equal(ui.calls.filter(([name]) => name === "reload").length, 1); assert.equal(ui.completeCount(), 0);
  verified = true;
  await ui.visibility("visible"); assert.equal(ui.completeCount(), 1); ui.unmount();
  const wrong = harness({ user: { uid: "other", email: "other@example.invalid", emailVerified: true } }); await wrong.ready();
  await wrong.focus(); await wrong.visibility("visible"); assert.equal(wrong.calls.some(([name]) => name === "reload"), false); assert.equal(wrong.completeCount(), 0); wrong.unmount();
});

test("focus and manual checks share one operation and one completion while token refresh is pending", async () => {
  let resolve;
  const wait = new Promise(done => { resolve = done; });
  const user = { uid: "member", email: invitation.email, emailVerified: false, getIdToken: async () => { await wait; return "fixture-token"; } };
  let verified = false;
  const ui = harness({ user, reload: account => { account.emailVerified = verified; } }); await ui.ready();
  verified = true;
  const manual = ui.press("I've verified my email"); await settle();
  await ui.focus(); await ui.visibility("visible");
  assert.equal(ui.calls.filter(([name]) => name === "reload").length, 2); assert.equal(ui.completeCount(), 0);
  resolve(); await manual; await settle(); ui.render();
  assert.equal(ui.completeCount(), 1); ui.unmount();
});

test("a failed workspace handoff is retryable without automatically looping or exposing provider details", async () => {
  let attempts = 0;
  const user = { uid: "member", email: invitation.email, emailVerified: true, getIdToken: async () => "fixture-token" };
  const ui = harness({ user, onComplete: () => { if (++attempts === 1) throw new Error("hidden-workspace-provider-details"); } }); await ui.ready();
  assert.equal(ui.completeCount(), 1); assert.doesNotMatch(text(ui.tree), /hidden-workspace-provider-details/);
  ui.render(); await settle(); assert.equal(ui.completeCount(), 1);
  await ui.press("Continue to Creditex"); assert.equal(ui.completeCount(), 2);
  await ui.focus(); await ui.visibility("visible"); assert.equal(ui.completeCount(), 2); ui.unmount();
});

test("unmount cancels automatic verification handoff after a delayed reload", async () => {
  let resolve;
  const wait = new Promise(done => { resolve = done; });
  const user = { uid: "member", email: invitation.email, emailVerified: false, getIdToken: async () => assert.fail("no token after leaving") };
  const ui = harness({ user, reload: async account => { await wait; account.emailVerified = true; } }); await ui.ready();
  await ui.focus(); ui.unmount(); resolve(); await settle();
  assert.equal(ui.completeCount(), 0); assert.equal(ui.writes.some(write => write.unmounted), false);
});

test("wrong signed-in account is explicit and switches only after the user presses Switch account", async () => {
  const user = { uid: "different", email: "other@example.invalid", emailVerified: true };
  const ui = harness({ user }); await ui.ready();
  assert.match(text(ui.tree), /Use your invited email/); assert.match(text(ui.tree), /other@example\.invalid/);
  assert.equal(flatten(ui.tree).some(node => node.type === "form"), false);
  assert.equal(ui.calls.some(([name]) => name === "signout"), false); assert.equal(ui.completeCount(), 0);
  await ui.press("Switch account");
  assert.equal(ui.calls.filter(([name]) => name === "signout").length, 1);
  assert.match(text(ui.tree), /Choose your password/); ui.unmount();
});

test("Google can complete only for the invited verified identity", async () => {
  for (const email of [invitation.email, "other@example.invalid"]) {
    const account = { uid: "google-user", email, emailVerified: true, getIdToken: async () => "fixture-token" };
    const ui = harness({ account }); await ui.ready(); await ui.press("Continue with Google");
    assert.equal(ui.completeCount(), email === invitation.email ? 1 : 0);
    if (email !== invitation.email) { assert.match(text(ui.tree), /Google signed in with a different email/); assert.match(text(ui.tree), /Switch account/); }
    const [, parameters] = ui.calls.find(([name]) => name === "google-parameters");
    assert.equal(parameters.prompt, "select_account"); assert.equal(parameters.login_hint, invitation.email); ui.unmount();
  }
});

test("existing login collision does not try the new password or send a reset automatically", async () => {
  const ui = harness({ createError: { code: "auth/email-already-in-use", message: "hidden-provider-details" } }); await ui.ready();
  ui.enter("password", "FixturePassword1"); await ui.submit();
  assert.match(text(ui.tree), /new password you entered was not saved/);
  assert.match(text(ui.tree), /Sign in with your existing password/);
  assert.equal(ui.calls.some(([name]) => ["signin", "reset", "verification"].includes(name)), false);
  assert.doesNotMatch(text(ui.tree), /hidden-provider-details|FixturePassword1/);
  await ui.press("Forgot password?");
  assert.deepEqual(ui.calls.find(([name]) => name === "reset"), ["reset", invitation.email, "/creditex/compliance"]);
  assert.match(text(ui.tree), /After setting your password, return to this invitation/); ui.unmount();
});

test("existing password login uses the invited email and requires the same verification gate", async () => {
  const ui = harness(); await ui.ready(); await ui.press("Sign in");
  ui.enter("password", "ExistingFixturePassword1"); await ui.submit();
  assert.deepEqual(ui.calls.find(([name]) => name === "signin"), ["signin", invitation.email, "ExistingFixturePassword1"]);
  assert.equal(ui.calls.some(([name]) => name === "create"), false); assert.equal(ui.completeCount(), 0);
  assert.match(text(ui.tree), /Check your email/); ui.unmount();
});

test("an identity change during token refresh cannot complete the workspace", async () => {
  const account = { uid: "member", email: invitation.email, emailVerified: true,
    getIdToken: async () => { ui.action({ uid: "other", email: "other@example.invalid", emailVerified: true }); return "fixture-token"; } };
  const ui = harness({ user: account }); await ui.ready();
  assert.equal(ui.completeCount(), 0); assert.match(text(ui.tree), /Use your invited email/); ui.unmount();
});

test("unmount cancels invitation loading and prevents a delayed response populating the screen", async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const ui = harness({ response: () => response });
  const ready = ui.ready(); await settle(); ui.unmount(); resolve(Response.json({ ok: true, invitation })); await ready;
  const request = ui.calls.find(([name]) => name === "fetch"); assert.equal(request[2].signal.aborted, true);
  assert.equal(ui.writes.some(write => write.unmounted), false);
  assert.equal(ui.completeCount(), 0); assert.equal(ui.calls.filter(([name]) => name === "unsubscribe").length, 1);
});

test("unmount during account creation prevents profile, verification and workspace completion side effects", async () => {
  let resolve;
  const createWait = new Promise(done => { resolve = done; });
  const ui = harness({ createWait }); await ui.ready(); ui.enter("password", "FixturePassword1");
  const submit = ui.submit(); await settle(); ui.unmount(); resolve(); await submit;
  assert.equal(ui.calls.some(([name]) => ["profile", "verification", "complete"].includes(name)), false);
  assert.equal(ui.writes.some(write => write.unmounted), false);
});

test("unavailable invitations never expose account creation and transient failures offer retry", async () => {
  for (const status of [404, 503]) {
    let request = 0;
    const ui = harness({ response: () => ++request === 1 ? Response.json({ ok: false }, { status }) : Response.json({ ok: true, invitation }) });
    await ui.ready(); assert.equal(flatten(ui.tree).some(node => node.type === "form"), false);
    if (status === 404) { assert.match(text(ui.tree), /Ask for a new invitation/); assert.match(text(ui.tree), /administrator/); }
    else { await ui.press("Try again"); await ui.ready(); assert.match(text(ui.tree), /Choose your password/); }
    assert.equal(ui.completeCount(), 0); ui.unmount();
  }
});

test("a stalled invitation request ends with retry instead of claiming the invitation expired", async () => {
  const ui = harness({ response: () => new Promise(() => {}) }); await ui.ready(); ui.expire();
  assert.match(text(ui.tree), /Check your connection and try again/); assert.doesNotMatch(text(ui.tree), /expired/);
  assert.equal(ui.calls.find(([name]) => name === "fetch")[2].signal.aborted, true);
  assert.equal(flatten(ui.tree).some(node => node.type === "form"), false); ui.unmount();
});

test("MFA challenge retains the existing component and verified identity handoff", async () => {
  const resolver = { hints: [{ uid: "factor", factorId: "totp" }] };
  const account = { uid: "member", email: invitation.email, emailVerified: true, getIdToken: async () => "fixture-token" };
  const ui = harness({ resolver, user: account }); await ui.ready();
  const challenge = flatten(ui.tree).find(node => node.type === ui.context.FirebaseMfaChallenge);
  assert.ok(challenge); assert.equal(challenge.props.resolver, resolver);
  await challenge.props.onComplete(); assert.equal(ui.completeCount(), 1);
  assert.ok(ui.calls.some(([name]) => name === "clear-mfa")); ui.unmount();
});

test("invitation setup pairs its light card and fields with readable text and mobile-sized controls", () => {
  assert.match(css, /\.card[^}]+background: #ffffff; color: #153c3e/s);
  assert.match(css, /\.form input[^}]+background: #fff; color: #153c3e/s);
  assert.match(css, /min-height: 48px/); assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 440px\)/); assert.match(css, /:focus-visible/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|console\.(log|error)|JSON\.stringify\([^)]*password/);
});
