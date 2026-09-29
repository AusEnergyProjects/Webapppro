import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeTLinkPasswordResetContinue } from "../src/lib/tlink-password-reset-continue.ts";
import { requestTLinkPasswordReset, tlinkPasswordResetErrorMessage } from "../src/lib/tlink-password-reset-client.ts";

test("reset destinations preserve only approved pages and a bounded team invitation", () => {
  for (const path of ["/direct-trade/team", "/direct-trade/partners", "/direct-trade/dashboard", "/creditex/compliance", "/operations/control-centre"]) {
    assert.equal(normalizeTLinkPasswordResetContinue(path), path);
    assert.equal(normalizeTLinkPasswordResetContinue(`https://ausenergyassessments.com${path}?unexpected=secret#fragment`), path);
  }
  assert.equal(normalizeTLinkPasswordResetContinue("https://ausenergyassessments.com/direct-trade/team?invite=valid_Abc-123&email=secret#ignored"), "/direct-trade/team?invite=valid_Abc-123");
  assert.equal(normalizeTLinkPasswordResetContinue("/creditex/compliance?invite=not-a-team-invitation"), "/creditex/compliance");
  for (const value of [undefined, null, {}, "", "javascript:alert(1)", "https://evil.test/direct-trade/partners", "http://ausenergyassessments.com/direct-trade/partners", "https://ausenergyassessments.com.evil.test/direct-trade/partners", "//evil.test/direct-trade/partners", "/\\evil.test/direct-trade/partners", "/unknown", "/direct-trade/reset-password", "/direct-trade/team\n?invite=abc", "/direct-trade/team?invite=%3Cscript%3E", `/direct-trade/team?invite=${"a".repeat(257)}`]) {
    assert.equal(normalizeTLinkPasswordResetContinue(value), "/direct-trade/team");
  }
});

test("reset request posts the normalized email and safe invitation without credentials", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => { calls.push(args); return Response.json({ ok: true }); });
  await requestTLinkPasswordReset("  Member@Example.test  ", "https://ausenergyassessments.com/direct-trade/team?invite=abc_123&other=drop");
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, "/api/auth/password-reset");
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.deepEqual(JSON.parse(options.body), { email: "member@example.test", continuePath: "/direct-trade/team?invite=abc_123" });
});

test("success needs both an HTTP success and the explicit application acknowledgement", async t => {
  let response = Response.json({ ok: true }, { status: 503 });
  t.mock.method(globalThis, "fetch", async () => response);
  for (const candidate of [response, Response.json({ ok: false }), Response.json({ ok: "true" }), Response.json({}), new Response("not-json", { status: 200 })]) {
    response = candidate;
    await assert.rejects(requestTLinkPasswordReset("member@example.test"));
  }
  response = Response.json({ ok: true });
  await requestTLinkPasswordReset("member@example.test");
});

test("reset errors map status codes without displaying response or network secrets", async t => {
  let response;
  t.mock.method(globalThis, "fetch", async () => {
    if (response === null) throw new Error("PrivateNetworkSecret");
    return response;
  });
  for (const [status, expected] of [[400, /valid email/], [429, /wait a few minutes/], [503, /temporarily unavailable/], [500, /could not be completed/]]) {
    response = Response.json({ error: "PrivateProviderSecret", ok: true }, { status });
    await assert.rejects(requestTLinkPasswordReset("member@example.test"), error => {
      const message = tlinkPasswordResetErrorMessage(error);
      assert.match(message, expected);
      assert.doesNotMatch(message, /PrivateProviderSecret/);
      return true;
    });
  }
  response = null;
  await assert.rejects(requestTLinkPasswordReset("member@example.test"), error => {
    assert.match(tlinkPasswordResetErrorMessage(error), /internet connection/);
    assert.doesNotMatch(tlinkPasswordResetErrorMessage(error), /PrivateNetworkSecret/);
    return true;
  });
  assert.doesNotMatch(tlinkPasswordResetErrorMessage(new Error("PrivateUnexpectedSecret")), /PrivateUnexpectedSecret/);
});

test("malformed recipients never reach the email API", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  for (const email of ["", "invalid", "two@@example.test", "person name@example.test", `${"a".repeat(255)}@example.test`]) {
    await assert.rejects(requestTLinkPasswordReset(email), /valid email/);
  }
  assert.equal(request.mock.callCount(), 0);
});

test("all TLink web entry points use the branded request with their own safe return destination", () => {
  for (const [name, destination] of [["TradeTeamPortal", "emailActionSettings().url"], ["DirectTradePartnerForm", '"/direct-trade/partners"'], ["AdminOperationsPortal", '"/operations/control-centre"'], ["CreditexCompliancePortal", '"/creditex/compliance"']]) {
    const source = readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
    assert.match(source, /requestTLinkPasswordReset/);
    assert.match(source, /tlinkPasswordResetErrorMessage\(error\)/);
    assert.ok(source.includes(destination));
    assert.doesNotMatch(source, /sendPasswordResetEmail/);
  }
});
