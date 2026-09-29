import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { teamAuthErrorCode, teamAuthErrorMessage } from "../src/components/trade-team-auth-errors.ts";

const portal = readFileSync(new URL("../src/components/TradeTeamPortal.tsx", import.meta.url), "utf8");

test("existing Firebase accounts offer their existing sign-in and a secure password reset", () => {
  const message = teamAuthErrorMessage({ code: "auth/email-already-in-use" });
  assert.match(message, /already has a login/);
  assert.match(message, /Continue with Google/);
  assert.match(message, /Reset password/);
  assert.match(portal, /teamAuthErrorCode\(error\) === "auth\/email-already-in-use"\) \{ setMode\("signin"\); clearPasswordFields\(\);/);
  assert.match(portal, /sendPasswordResetEmail\(firebaseAuth, recipient, emailActionSettings\(\)\)/);
});

test("password, connection and rate-limit failures explain the appropriate recovery", () => {
  assert.match(teamAuthErrorMessage({ code: "auth/weak-password" }), /at least 8 characters/);
  assert.match(teamAuthErrorMessage({ code: "auth/password-does-not-meet-requirements" }), /stronger password/);
  assert.match(teamAuthErrorMessage({ code: "auth/network-request-failed" }), /internet connection/);
  assert.match(teamAuthErrorMessage({ code: "auth/too-many-requests" }), /wait a few minutes/);
  assert.match(teamAuthErrorMessage({ code: "auth/invalid-credential" }), /Reset password/);
  assert.doesNotMatch(teamAuthErrorMessage({ code: "auth/network-request-failed" }), /password was not recognised/);
});

test("unexpected authentication errors never render provider internals or supplied secrets", () => {
  for (const error of [null, undefined, "secret", 12, { code: 42 }, { code: "unexpected", message: "private-token-value" }]) {
    assert.equal(typeof teamAuthErrorCode(error), "string");
    assert.match(teamAuthErrorMessage(error), /could not be completed/);
    assert.doesNotMatch(teamAuthErrorMessage(error), /secret|private-token-value/);
  }
});

test("invitation setup locks the invited address and clearly asks for a new password", () => {
  assert.match(portal, /\/api\/trade-team\/invitation\?invite=/);
  assert.match(portal, /setEmail\(result\.invitation\.email\)/);
  assert.match(portal, /setMode\("create"\)/);
  assert.match(portal, /readOnly=\{Boolean\(invitation\)\}/);
  assert.match(portal, /Set your new password/);
  assert.match(portal, /autoComplete=\{mode === "create" \? "new-password" : "current-password"\}/);
  assert.match(portal, /user\.email\?\.toLowerCase\(\) !== invitation\.email\.toLowerCase\(\)/);
  assert.match(portal, /Use invited email/);
});

test("verification happens before acceptance, is recoverable and preserves the invitation", () => {
  const acceptance = portal.slice(portal.indexOf('if (!user || !emailVerified || !invitationReady'), portal.indexOf('function emailActionSettings'));
  assert.match(acceptance, /if \(!user \|\| !emailVerified \|\| !invitationReady \|\| invitationError\) return/);
  assert.match(acceptance, /await user\.getIdToken\(true\)/);
  assert.match(acceptance, /action: "accept_invite"/);
  assert.match(portal, /await sendVerification\(credential\.user\)/);
  assert.match(portal, /await sendEmailVerification\(account, emailActionSettings\(\)\)/);
  assert.match(portal, /url\.searchParams\.set\("invite", inviteToken\)/);
  assert.match(portal, /Your login is saved, but the verification email could not be sent/);
  assert.match(portal, /Resend verification email/);
  assert.match(portal, /addEventListener\("focus", check\)/);
  assert.match(portal, /await reload\(user\)/);
  assert.doesNotMatch(portal, /if \(!user \|\| user\.emailVerified\) return/);
});

test("completing MFA retries invitation acceptance rather than loading an unbound member", () => {
  assert.match(portal, /accepted\.code === "MFA_REQUIRED"/);
  assert.match(portal, /onComplete=\{async \(\) => \{ setMfaRequired\(false\); setAuthRevision\(current => current \+ 1\); \}\}/);
  assert.match(portal, /\[authRevision, emailVerified, invitation/);
});

async function submitPasswordForm({ mode = "create", password = "ExamplePassword1", confirmPassword = "ExamplePassword1" } = {}) {
  const calls = [];
  const messages = [];
  const handler = portal.slice(portal.indexOf("  async function emailAuth("), portal.indexOf("  async function reset()"))
    .replace("event: FormEvent<HTMLFormElement>", "event");
  await runInNewContext(`(async () => { ${handler}\nawait emailAuth({ preventDefault() {} }); })()`, {
    mode, password, confirmPassword, email: "member@example.test", name: "Team member", firebaseAuth: {},
    setPasswordMismatch: value => calls.push(["mismatch", value]),
    setStatus: value => messages.push(value),
    setBusy: value => calls.push(["busy", value]),
    confirmPasswordRef: { current: { focus: () => calls.push(["focus-confirmation"]) } },
    createUserWithEmailAndPassword: async () => { calls.push(["create-account"]); return { user: {} }; },
    signInWithEmailAndPassword: async () => { calls.push(["sign-in"]); },
    updateProfile: async () => { calls.push(["profile"]); },
    sendVerification: async () => { calls.push(["verify-email"]); },
    clearPasswordFields: () => calls.push(["clear-passwords"]),
    captureMfaError: () => false, teamAuthErrorCode, teamAuthErrorMessage,
    setMode: value => calls.push(["mode", value]),
  });
  return { calls, messages };
}

test("mismatched confirmation stops account creation and focuses confirmation without exposing passwords", async () => {
  const { calls, messages } = await submitPasswordForm({ password: "PrivateNewPassword1", confirmPassword: "PrivateDifferentPassword2" });
  assert.deepEqual(calls, [["mismatch", true], ["focus-confirmation"]]);
  assert.match(messages.join(" "), /passwords do not match/);
  assert.doesNotMatch(messages.join(" "), /PrivateNewPassword1|PrivateDifferentPassword2/);
});

test("matching passwords create one account, verify email and clear both password controls", async () => {
  const { calls } = await submitPasswordForm();
  assert.equal(calls.filter(([action]) => action === "create-account").length, 1);
  assert.equal(calls.filter(([action]) => action === "verify-email").length, 1);
  assert.equal(calls.filter(([action]) => action === "clear-passwords").length, 1);
  assert.ok(calls.findIndex(([action]) => action === "create-account") < calls.findIndex(([action]) => action === "verify-email"));
});

test("existing sign-in requires no confirmation", async () => {
  const { calls } = await submitPasswordForm({ mode: "signin", confirmPassword: "" });
  assert.equal(calls.filter(([action]) => action === "sign-in").length, 1);
  assert.equal(calls.filter(([action]) => action === "create-account").length, 0);
  assert.equal(calls.filter(([action]) => action === "clear-passwords").length, 1);
});

test("password visibility controls are labelled, independent and reset with password values", () => {
  assert.match(portal, /mode === "create" && <label htmlFor="team-auth-confirm-password"/);
  assert.match(portal, /id="team-auth-confirm-password"[^>]+autoComplete="new-password"[^>]+required value=\{confirmPassword\}/);
  assert.match(portal, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(portal, /type=\{showConfirmPassword \? "text" : "password"\}/);
  assert.match(portal, /aria-label=\{showPassword \? "Hide password" : "Show password"\} aria-pressed=\{showPassword\} aria-controls="team-auth-password"/);
  assert.match(portal, /aria-label=\{showConfirmPassword \? "Hide confirmed password" : "Show confirmed password"\} aria-pressed=\{showConfirmPassword\} aria-controls="team-auth-confirm-password"/);
  assert.match(portal, /setShowPassword\(current => !current\)/);
  assert.match(portal, /setShowConfirmPassword\(current => !current\)/);
  assert.match(portal, /setPassword\(""\); setConfirmPassword\(""\); setShowPassword\(false\); setShowConfirmPassword\(false\); setPasswordMismatch\(false\)/);
  assert.match(portal, /setMode\(mode === "create" \? "signin" : "create"\); setStatus\(""\); clearPasswordFields\(\)/);
  assert.match(portal, /await signOut\(firebaseAuth\);\s*setData\(\{\}\); setStatus\(""\); clearPasswordFields\(\)/);
});

function requestPasswordReset(email, provider = async () => {}) {
  const calls = [];
  const messages = [];
  const actionSettings = { url: "https://ausenergyassessments.com/direct-trade/team?invite=test-invitation" };
  const handler = portal.slice(portal.indexOf("  async function reset()"), portal.indexOf("  async function update("));
  const completion = runInNewContext(`(async () => { ${handler}\nawait reset(); })()`, {
    email, firebaseAuth: "test-auth", emailActionSettings: () => actionSettings,
    setStatus: value => messages.push(value), setBusy: value => calls.push(["busy", value]),
    sendPasswordResetEmail: async (...args) => { calls.push(["request", ...args]); return await provider(); },
    teamAuthErrorMessage,
  });
  return { calls, messages, completion, actionSettings };
}

test("password reset normalizes the exact recipient and preserves the invitation return settings", async () => {
  const { calls, messages, completion, actionSettings } = requestPasswordReset("  Member@Example.test  ");
  await completion;
  assert.deepEqual(calls.find(([action]) => action === "request"), ["request", "test-auth", "member@example.test", actionSettings]);
  assert.match(messages.at(-1), /request accepted for member@example\.test/);
  assert.match(messages.at(-1), /If this email has a login/);
  assert.match(messages.at(-1), /Inbox and Spam/);
  assert.match(messages.at(-1), /noreply@australian-energy-assessments\.firebaseapp\.com/);
  assert.match(messages.at(-1), /Continue with Google/);
  assert.doesNotMatch(messages.at(-1), /email (?:was )?sent|delivered|inbox confirmed/i);
});

test("password reset replaces stale status immediately and waits for the provider before showing acceptance", async () => {
  let acceptRequest;
  const pendingProvider = new Promise(resolve => { acceptRequest = resolve; });
  const { messages, completion } = requestPasswordReset("member@example.test", () => pendingProvider);
  assert.deepEqual(messages, ["Requesting a password reset for member@example.test..."]);
  acceptRequest();
  await completion;
  assert.match(messages.at(-1), /request accepted/);
});

test("rejected reset requests never show success and give quota or return-link recovery", async () => {
  for (const code of ["auth/quota-exceeded", "auth/unauthorized-continue-uri", "auth/invalid-continue-uri", "auth/missing-continue-uri", "auth/network-request-failed"]) {
    const { calls, messages, completion } = requestPasswordReset("member@example.test", async () => { throw { code }; });
    await completion;
    assert.match(messages.at(-1), /could not confirm/);
    assert.doesNotMatch(messages.join(" "), /request accepted|email sent/);
    assert.deepEqual(calls.at(-1), ["busy", ""]);
    if (code.includes("continue-uri")) assert.match(messages.at(-1), /return link is not configured correctly/);
    if (code === "auth/quota-exceeded") assert.match(messages.at(-1), /email sending limit/);
  }
});

test("blank and malformed email addresses cannot trigger a reset request", async () => {
  for (const email of ["", "  ", "not-an-email", "two@@example.test", "member@", "member name@example.test"]) {
    const { calls, messages, completion } = requestPasswordReset(email);
    await completion;
    assert.equal(calls.length, 0);
    assert.match(messages.at(-1), /Enter (?:your email first|a valid email address)/);
  }
});

test("reset is available in either auth mode and does not submit required password inputs", () => {
  assert.match(portal, /<button className="customer-reset-link" type="button" disabled=\{Boolean\(busy\)\} onClick=\{\(\) => void reset\(\)\}/);
  assert.doesNotMatch(portal, /mode === "signin" && <button[^>]*onClick=\{\(\) => void reset/);
});
