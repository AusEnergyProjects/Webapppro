import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jose from "jose";
import * as delivery from "../src/lib/service-reminder-delivery.ts";
import * as emailRenderer from "../src/lib/tlink-password-reset-email.ts";
import * as continuePath from "../src/lib/tlink-password-reset-continue.ts";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";

const source = fs.readFileSync(new URL("../src/lib/tlink-password-reset-server.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = { jose, "./service-reminder-delivery": delivery,
  "./tlink-password-reset-email": emailRenderer, "./tlink-password-reset-continue": continuePath };
const moduleRecord = { exports: {} };
new Function("require", "module", "exports", output)(specifier => {
  assert.ok(Object.hasOwn(modules, specifier), `Unexpected dependency ${specifier}`);
  return modules[specifier];
}, moduleRecord, moduleRecord.exports);
const { sendTLinkPasswordResetEmail, normalizeTLinkPasswordResetEmail, TLinkPasswordResetUnavailableError } = moduleRecord.exports;
const { privateKey, publicKey } = await jose.generateKeyPair("RS256", { extractable: true });
const account = { type: "service_account", project_id: "australian-energy-assessments",
  client_email: "password-reset@australian-energy-assessments.iam.gserviceaccount.com",
  private_key: await jose.exportPKCS8(privateKey) };
const runtime = { FIREBASE_AUTH_SERVICE_ACCOUNT_JSON: JSON.stringify(account), RESEND_API_KEY: "re_test_local_only",
  RESEND_FROM_EMAIL: "Australian Energy Assessments <service@reminders.ausenergyassessments.com>" };
const oobCode = "local-test-code_not-a-real-reset-token";
const oobLink = `https://australian-energy-assessments.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=${oobCode}&apiKey=public-config`;
const routeOutput = ts.transpileModule(fs.readFileSync(new URL("../src/app/api/auth/password-reset/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ tokenStatus = 200, tokenBody = { token_type: "Bearer", access_token: "local-test-oauth-token" },
  linkStatus = 200, linkBody = { oobLink }, resendStatus = 200, resendBody = { id: "local-email-id" }, throwAt } = {}) {
  const calls = [];
  const waits = [];
  const now = Date.now();
  return { calls, waits, now, options: {
    runtime: { ...runtime }, now: () => now, wait: async milliseconds => waits.push(milliseconds),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (throwAt === calls.length) throw new Error(`SENSITIVE ${oobCode} local-test-oauth-token`);
      if (url === "https://oauth2.googleapis.com/token") return Response.json(tokenBody, { status: tokenStatus });
      if (url === "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode") return Response.json(linkBody, { status: linkStatus });
      if (url === "https://api.resend.com/emails") return Response.json(resendBody, { status: resendStatus });
      throw new Error(`Unexpected URL ${url}`);
    },
  } };
}

async function unavailable(context) {
  await assert.rejects(sendTLinkPasswordResetEmail({ email: "member@example.com" }, context.options), error => {
    assert.ok(error instanceof TLinkPasswordResetUnavailableError);
    assert.equal(error.message, "Password reset is temporarily unavailable. Please try again later.");
    assert.doesNotMatch(error.stack, /SENSITIVE|local-test-oauth-token|local-test-code/);
    return true;
  });
}

async function requestReset(context, email) {
  const dependencies = {
    "../../../../../db": { getD1: () => { throw new Error("Unexpected database access"); } },
    "@/lib/lead-rate-limit.mjs": { createSharedLeadRateLimiter: () => ({ check: async () => ({ allowed: true }) }) },
    "@/lib/bounded-request-body.mjs": boundedBody,
    "@/lib/tlink-password-reset-server": { normalizeTLinkPasswordResetEmail,
      sendTLinkPasswordResetEmail: input => sendTLinkPasswordResetEmail(input, context.options) },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", routeOutput)(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  }, route, route.exports);
  return route.exports.POST(new Request("https://ausenergyassessments.com/api/auth/password-reset", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
    body: JSON.stringify({ email }),
  }));
}

test("reset email uses a signed Google assertion, an admin-only code request and the existing mailbox with TLink branding", async () => {
  const context = fixture();
  assert.equal(await sendTLinkPasswordResetEmail({ email: " Member@Example.com ", continuePath: "/direct-trade/team?invite=test_token" }, context.options), undefined);
  assert.equal(context.calls.length, 3);
  const tokenCall = context.calls[0];
  const parameters = new URLSearchParams(tokenCall.init.body);
  assert.equal(parameters.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const { payload, protectedHeader } = await jose.jwtVerify(parameters.get("assertion"), publicKey, {
    issuer: account.client_email, audience: "https://oauth2.googleapis.com/token", algorithms: ["RS256"],
  });
  assert.equal(protectedHeader.alg, "RS256");
  assert.equal(payload.scope, "https://www.googleapis.com/auth/identitytoolkit");
  assert.equal(payload.exp - payload.iat, 3600);
  assert.deepEqual(JSON.parse(context.calls[1].init.body), {
    requestType: "PASSWORD_RESET", email: "member@example.com", targetProjectId: account.project_id, returnOobLink: true,
  });
  assert.equal(context.calls[1].init.headers.Authorization, "Bearer local-test-oauth-token");
  const message = JSON.parse(context.calls[2].init.body);
  assert.equal(message.from, "TLink <service@reminders.ausenergyassessments.com>");
  assert.deepEqual(message.to, ["member@example.com"]);
  assert.equal(message.subject, "Reset your TLink password");
  assert.match(message.html, />Reset password<\/a>/);
  assert.match(message.text, /https:\/\/ausenergyassessments.com\/direct-trade\/reset-password\?oobCode=/);
  assert.match(message.text, /continuePath=%2Fdirect-trade%2Fteam%3Finvite%3Dtest_token/);
  assert.doesNotMatch(message.text, /firebaseapp|apiKey|local-test-oauth-token/);
  assert.match(context.calls[2].init.headers["Idempotency-Key"], /^tlink-password-reset:[0-9a-f-]{36}$/);
  for (const call of context.calls) {
    assert.equal(call.init.cache, "no-store");
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.equal(runtime.RESEND_FROM_EMAIL, "Australian Energy Assessments <service@reminders.ausenergyassessments.com>");
  assert.deepEqual(context.waits, [1500]);
});

test("unknown and disabled accounts return the same acknowledgement and duration without sending email", async () => {
  for (const message of ["EMAIL_NOT_FOUND", "USER_DISABLED"]) {
    const context = fixture({ linkStatus: 400, linkBody: { error: { message } } });
    assert.equal(await sendTLinkPasswordResetEmail({ email: "unknown@example.com" }, context.options), undefined);
    assert.equal(context.calls.length, 2);
    assert.deepEqual(context.waits, [1500]);
  }
});

test("each requested email has an independent idempotency key", async () => {
  const context = fixture();
  await sendTLinkPasswordResetEmail({ email: "member@example.com" }, context.options);
  await sendTLinkPasswordResetEmail({ email: "member@example.com" }, context.options);
  assert.notEqual(context.calls[2].init.headers["Idempotency-Key"], context.calls[5].init.headers["Idempotency-Key"]);
});

test("provider acceptance logs only its safe receipt ID and never adds it to the public acknowledgement", async t => {
  const logger = t.mock.method(console, "info", () => {});
  const providerMessageId = "e3f2a88e-fabc-4306-b54c-2c0c6e113c99";
  const context = fixture({ resendBody: { id: providerMessageId, email: "member@example.com", oobCode,
    access_token: "local-test-oauth-token", html: "SENSITIVE provider payload" } });
  const response = await requestReset(context, "member@example.com");
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(logger.mock.calls.map(call => call.arguments), [["TLINK_PASSWORD_RESET_EMAIL_ACCEPTED", { providerMessageId }]]);
});

test("malformed provider receipt IDs are excluded from acceptance events", async t => {
  const logger = t.mock.method(console, "info", () => {});
  for (const id of ["member@example.com", `https://example.com/reset?oobCode=${oobCode}`, "receipt\nSENSITIVE", "x".repeat(129)]) {
    const context = fixture({ resendBody: { id } });
    assert.equal(await sendTLinkPasswordResetEmail({ email: "member@example.com" }, context.options), undefined);
  }
  assert.deepEqual(logger.mock.calls.map(call => call.arguments), Array(4).fill(["TLINK_PASSWORD_RESET_EMAIL_ACCEPTED", {}]));
});

test("invalid or missing credentials and sender fail before code generation", async () => {
  for (const overrides of [
    { FIREBASE_AUTH_SERVICE_ACCOUNT_JSON: undefined },
    { FIREBASE_AUTH_SERVICE_ACCOUNT_JSON: "invalid-json" },
    { FIREBASE_AUTH_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, project_id: "other-project" }) },
    { FIREBASE_AUTH_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...account, private_key: "bad-key" }) },
    { RESEND_API_KEY: "" }, { RESEND_FROM_EMAIL: "" },
    { RESEND_FROM_EMAIL: "TLink <one@example.com>\r\nBcc: two@example.com" },
  ]) {
    const context = fixture();
    Object.assign(context.options.runtime, overrides);
    await unavailable(context);
    assert.equal(context.calls.length, 0);
  }
});

test("OAuth and identity-provider failures return safe retryable errors", async () => {
  for (const failure of [
    { tokenStatus: 403, tokenBody: { error: "SENSITIVE" } },
    { tokenBody: {} }, { tokenBody: { access_token: "x", token_type: "unexpected" } },
    { linkStatus: 403, linkBody: { error: { message: "PERMISSION_DENIED SENSITIVE" } } },
    { linkStatus: 429, linkBody: { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } } },
    { linkStatus: 500, linkBody: { error: { message: "EMAIL_NOT_FOUND" } } },
    { throwAt: 1 }, { throwAt: 2 }, { linkBody: {} },
  ]) {
    const context = fixture(failure);
    await unavailable(context);
    assert.ok(context.calls.length <= 2);
  }
});

test("provider cannot replace the reset destination or supply an ambiguous token", async () => {
  for (const link of [
    "javascript:alert(1)", oobLink.replace("https:", "http:"),
    oobLink.replace("australian-energy-assessments.firebaseapp.com", "attacker.example"),
    oobLink.replace("/__/auth/action", "/other"), oobLink.replace("resetPassword", "verifyEmail"),
    oobLink.replace("https://", "https://user:password@"), `${oobLink}#fragment`,
    `${oobLink}&oobCode=another`, `${oobLink}&mode=resetPassword`,
    oobLink.replace(oobCode, "%0Ainjected"), oobLink.replace(oobCode, ""),
  ]) {
    const context = fixture({ linkBody: { oobLink: link } });
    await unavailable(context);
    assert.equal(context.calls.length, 2);
  }
});

test("untrusted continuation cannot become an external email link", async () => {
  const context = fixture();
  await sendTLinkPasswordResetEmail({ email: "member@example.com", continuePath: "https://attacker.example/steal" }, context.options);
  const message = JSON.parse(context.calls[2].init.body);
  assert.doesNotMatch(message.text, /attacker/);
  assert.match(message.text, /continuePath=%2Fdirect-trade%2Fteam/);
});

test("Resend failures acknowledge the request and emit only a constant operational event", async t => {
  const logger = t.mock.method(console, "error", () => {});
  for (const failure of [{ resendStatus: 401 }, { resendStatus: 500 }, { resendBody: {} }, { throwAt: 3 }]) {
    const context = fixture(failure);
    assert.equal(await sendTLinkPasswordResetEmail({ email: "member@example.com" }, context.options), undefined);
    assert.equal(context.calls.length, 3);
  }
  assert.deepEqual(logger.mock.calls.map(call => call.arguments), Array(4).fill(["TLINK_PASSWORD_RESET_DELIVERY_UNCONFIRMED"]));
});

test("known, unknown and disabled accounts have identical public acknowledgements during a Resend outage", async t => {
  const logger = t.mock.method(console, "error", () => {});
  const publicResponses = [];
  for (const settings of [
    { resendStatus: 500, resendBody: { error: `SENSITIVE ${oobCode}` } },
    { linkStatus: 400, linkBody: { error: { message: "EMAIL_NOT_FOUND" } }, resendStatus: 500 },
    { linkStatus: 400, linkBody: { error: { message: "USER_DISABLED" } }, resendStatus: 500 },
  ]) {
    const context = fixture(settings);
    const response = await requestReset(context, "member@example.com");
    publicResponses.push({ status: response.status, body: await response.json() });
    assert.deepEqual(context.waits, [1500]);
  }
  assert.deepEqual(publicResponses, Array(3).fill({ status: 202, body: { ok: true } }));
  assert.deepEqual(logger.mock.calls.map(call => call.arguments), [["TLINK_PASSWORD_RESET_DELIVERY_UNCONFIRMED"]]);
});

test("email normalization rejects invalid input and preserves legitimate plus addressing", () => {
  assert.equal(normalizeTLinkPasswordResetEmail(" Name+Work@Example.COM "), "name+work@example.com");
  for (const value of [undefined, null, 1, {}, "", "name", "a@example", "a @example.com", "<a>@example.com", "a\u0000@example.com", "a@\u0000example.com", `${"a".repeat(250)}@example.com`]) {
    assert.equal(normalizeTLinkPasswordResetEmail(value), null);
  }
});
