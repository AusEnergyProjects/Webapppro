import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { teamAuthErrorCode, teamAuthErrorMessage } from "../src/components/trade-team-auth-errors.ts";

const portal = readFileSync(new URL("../src/components/TradeTeamPortal.tsx", import.meta.url), "utf8");

test("existing Firebase accounts offer their existing sign-in and a secure password reset", () => {
  const message = teamAuthErrorMessage({ code: "auth/email-already-in-use" });
  assert.match(message, /already has a login/);
  assert.match(message, /Continue with Google/);
  assert.match(message, /Reset password/);
  assert.match(portal, /teamAuthErrorCode\(error\) === "auth\/email-already-in-use"\) \{ setMode\("signin"\); setPassword\(""\);/);
  assert.match(portal, /sendPasswordResetEmail\(firebaseAuth, email\.trim\(\)\.toLowerCase\(\), emailActionSettings\(\)\)/);
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
