import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as bounded from "../src/lib/bounded-json-request.ts";
import { ReminderProviderDeliveryError } from "../src/lib/service-reminder-delivery.ts";
import { FirebaseMfaRequiredError } from "../src/lib/firebase-mfa.ts";
import { mfaErrorResponse } from "./helpers/admin-response-fixture.mjs";

const cache = new Map();
function load(path, dependencies) {
  if (!cache.has(path)) cache.set(path, ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText);
  const record = { exports: {} };
  new Function("require", "module", "exports", cache.get(path))((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected email API dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}
class TradeAccessError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const adminJson = (body, status = 200) => Response.json(body, { status });
const api = load("../src/lib/trade-email-api.ts", {
  "./admin-server": { adminJson, mfaErrorResponse }, "./trade-access-server": { TradeAccessError }, "./bounded-json-request": bounded,
  "./service-reminder-delivery": { ReminderProviderDeliveryError },
});
const targetHelper = load("../src/lib/trade-email-recipient-server.ts", {
  "../../db": {}, "./aea-trade-owner-server": {}, "./trade-certificate-leads": {},
  "./public-trade-lead-access.mjs": {}, "./trade-opportunity-read-projection.mjs": {},
});
const origin = "https://portal.example.test";
const requestId = "request-1234567890";
const draft = { customerId: "customer", subject: "Quote question", body: "Can we arrange a time?", requestId };
function request(path, body, method = "POST") {
  return new Request(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture(options = {}) {
  const hooks = { ...options };
  const calls = { auth: [], begin: [], disconnect: [], test: [], resolve: [], send: [], delivered: [], complete: [] };
  const access = { ownerUid: "owner", actorUid: "staff", isOwner: true };
  const dependencies = {
    "@/lib/admin-server": { adminJson, sameOrigin: () => hooks.sameOrigin !== false },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async (...args) => { calls.auth.push(args); if (hooks.authError) throw hooks.authError; return { ...access, ...hooks.access }; } },
    "@/lib/trade-email-api": api,
    "@/lib/trade-email-server": {
      isTradeEmailProvider: (value) => value === "google" || value === "microsoft",
      tradeEmailSettings: async (ownerUid) => { assert.equal(ownerUid, "owner"); return { providers: [], connection: { email: "office@example.test", status: "connected" } }; },
      beginTradeEmailConnection: async (...args) => { calls.begin.push(args); return { browser: "b".repeat(43), authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test" }; },
      disconnectTradeEmail: async (...args) => { calls.disconnect.push(args); },
      testTradeEmail: async (...args) => { calls.test.push(args); return { providerMessageId: "test-accepted-id", providerStatus: "accepted" }; },
      sendTradeCustomerEmail: async (...args) => {
        calls.send.push(args);
        if (hooks.sendError) throw hooks.sendError;
        await args[3].beforeSend();
        calls.delivered.push(args);
        return { providerMessageId: "submission-id", providerStatus: "accepted" };
      },
      completeTradeEmailConnection: async (...args) => { calls.complete.push(args); if (hooks.completeError || !args[1] || !args[2] || !args[3]) throw new Error("sensitive-oauth-code-or-token"); },
    },
    "@/lib/trade-email-recipient-server": {
      tradeEmailTarget: targetHelper.tradeEmailTarget,
      resolveTradeEmailRecipient: async (...args) => { calls.resolve.push(args); return hooks.resolve ? hooks.resolve(...args) : "saved@example.test"; },
    },
  };
  return {
    hooks, calls,
    settings: load("../src/app/api/trade-email/route.ts", dependencies),
    customer: load("../src/app/api/trade-customer-email/route.ts", dependencies),
    callback: load("../src/app/api/trade-email/callback/[provider]/route.ts", dependencies),
  };
}

test("Settings is readable by authorised team, but connection, test and disconnect require owner", async () => {
  const f = fixture({ access: { isOwner: false } });
  const settings = await f.settings.GET(request("/api/trade-email", undefined, "GET"));
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).canManage, false);
  for (const body of [{ action: "connect", provider: "google" }, { action: "test", requestId }]) {
    const response = await f.settings.POST(request("/api/trade-email", body));
    assert.equal(response.status, 403);
  }
  assert.equal((await f.settings.DELETE(request("/api/trade-email", undefined, "DELETE"))).status, 403);
  assert.equal(f.calls.begin.length + f.calls.test.length + f.calls.disconnect.length, 0);
});

test("All email API entry points reject cross-origin requests before authentication or mutation", async () => {
  const f = fixture({ sameOrigin: false });
  const attempts = [
    f.settings.GET(request("/api/trade-email", undefined, "GET")),
    f.settings.POST(request("/api/trade-email", { action: "connect", provider: "google" })),
    f.settings.DELETE(request("/api/trade-email", undefined, "DELETE")),
    f.customer.POST(request("/api/trade-customer-email", draft)),
  ];
  for (const response of await Promise.all(attempts)) assert.equal(response.status, 403);
  assert.equal(f.calls.auth.length, 0);
  assert.equal(f.calls.send.length + f.calls.begin.length + f.calls.disconnect.length, 0);
});

test("Owner connect binds business and browser cookie without exposing tokens; test reports accepted", async () => {
  const f = fixture();
  const response = await f.settings.POST(request("/api/trade-email", { action: "connect", provider: "google", ownerUid: "attacker" }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.begin[0], ["owner", "google", origin]);
  assert.match(response.headers.get("Set-Cookie"), /^tlink_email_oauth=b{43}; HttpOnly; SameSite=Lax; Path=\/api\/trade-email\/callback; Max-Age=600; Secure$/);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["authorizationUrl", "ok"]);
  const checked = await f.settings.POST(request("/api/trade-email", { action: "test", requestId }));
  assert.deepEqual(await checked.json(), { ok: true, status: "accepted", submissionId: "test-accepted-id" });
  assert.deepEqual(f.calls.test[0], ["owner", "staff", requestId]);
  assert.equal((await f.settings.DELETE(request("/api/trade-email", undefined, "DELETE"))).status, 200);
  assert.deepEqual(f.calls.disconnect[0], ["owner"]);
});

test("Customer compose ignores arbitrary recipient/sender and rechecks saved target immediately before sending", async () => {
  const f = fixture();
  const response = await f.customer.POST(request("/api/trade-customer-email", { ...draft, recipient: "attacker@example.test", senderEmail: "spoof@example.test", ownerUid: "attacker" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "accepted", submissionId: "submission-id" });
  assert.equal(f.calls.resolve.length, 2);
  assert.equal(f.calls.delivered.length, 1);
  const [ownerUid, actorUid, message, options] = f.calls.delivered[0];
  assert.equal(ownerUid, "owner"); assert.equal(actorUid, "staff");
  assert.equal(message.recipient, "saved@example.test");
  assert.equal(message.idempotencyKey, `customer-email:${requestId}`);
  assert.equal(Object.hasOwn(message, "senderEmail"), false);
  assert.equal(options.requireConnection, true);
});

test("Changed or withdrawn contact permission during credential refresh cancels before provider send", async () => {
  for (const revoked of [false, true]) {
    let lookups = 0;
    const f = fixture({ resolve: async () => {
      if (++lookups === 1) return "saved@example.test";
      if (revoked) throw new Error("EMAIL_RECIPIENT_UNAVAILABLE");
      return "changed@example.test";
    } });
    const response = await f.customer.POST(request("/api/trade-customer-email", draft));
    assert.equal(response.status, 404);
    assert.equal(f.calls.delivered.length, 0);
  }
});

test("Compose rejects mixed targets, header injection, invalid IDs, empty text and oversized input", async () => {
  const f = fixture();
  for (const patch of [{ enquiryId: "match" }, { requestId: "short" }, { subject: "Hi\r\nBcc: attacker@example.test" }, { body: "" }, { subject: "s".repeat(201) }, { body: "b".repeat(8001) }, { body: "nul\u0000" }, { customerId: null }]) {
    assert.equal((await f.customer.POST(request("/api/trade-customer-email", { ...draft, ...patch }))).status, 400);
  }
  assert.equal((await f.customer.POST(request("/api/trade-customer-email", { ...draft, body: "b".repeat(20000) }))).status, 413);
  assert.equal((await f.customer.POST(request("/api/trade-customer-email", []))).status, 400);
  assert.equal(f.calls.send.length, 0);
});

test("Uncertain send, definite rejection and access errors expose clear safe responses", async () => {
  for (const [error, status, expectedState] of [[new ReminderProviderDeliveryError("indeterminate", "sensitive-provider-payload"), 409, "uncertain"], [new ReminderProviderDeliveryError("definite_failure", "sensitive-provider-payload"), 502, "failed"]]) {
    const f = fixture({ sendError: error });
    const response = await f.customer.POST(request("/api/trade-customer-email", draft));
    const value = await response.json();
    assert.equal(response.status, status);
    assert.equal(value.status, expectedState);
    assert.equal(JSON.stringify(value).includes("sensitive"), false);
  }
  const f = fixture({ authError: new TradeAccessError("Verified business access required", 403) });
  assert.equal((await f.customer.POST(request("/api/trade-customer-email", draft))).status, 403);
  assert.equal(f.calls.resolve.length + f.calls.send.length, 0);
  const unknown = api.tradeEmailApiError(new Error("sensitive-refresh-token"));
  assert.equal((await unknown.text()).includes("sensitive"), false);
});

test("Email endpoints preserve MFA setup guidance and classify credential preflight failures as unsent", async () => {
  const f = fixture({ authError: new FirebaseMfaRequiredError() });
  const response = await f.customer.POST(request("/api/trade-customer-email", draft));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "MFA_REQUIRED");
  assert.equal(f.calls.send.length, 0);
  for (const [code, status] of [["EMAIL_PREFLIGHT_FAILED", 503], ["EMAIL_RECONNECT_REQUIRED", 409], ["EMAIL_CONNECTION_CHANGED", 409]]) {
    const result = api.tradeEmailApiError(new Error(code));
    assert.equal(result.status, status);
    assert.equal((await result.json()).status, "failed");
  }
});

test("OAuth callback consumes browser binding and redirects to Business settings without leaking code", async () => {
  const f = fixture();
  const url = `${origin}/api/trade-email/callback/google?state=csrf-state&code=private-code`;
  const response = await f.callback.GET(new Request(url, { headers: { Cookie: "unrelated=x; tlink_email_oauth=browser-secret" } }), { params: Promise.resolve({ provider: "google" }) });
  assert.equal(response.status, 303);
  assert.deepEqual(f.calls.complete[0], ["google", "csrf-state", "browser-secret", "private-code", `${origin}/api/trade-email/callback/google`]);
  assert.equal(response.headers.get("Location"), `${origin}/direct-trade/dashboard?workspace=account&email_connection=connected#business-settings-email`);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0; Secure/);
  assert.equal([...response.headers.values()].join(" ").includes("private-code"), false);
});

test("OAuth cancellation, missing binding, unsupported provider and provider failure return safe status", async () => {
  for (const [provider, query, cookie, fail, expected] of [
    ["google", "error=access_denied", "browser", false, "cancelled"],
    ["google", "state=state&code=code", "", false, "failed"],
    ["google", "state=state&code=code", "browser", true, "failed"],
    ["untrusted", "state=state&code=code", "browser", false, "failed"],
  ]) {
    const f = fixture({ completeError: fail });
    const response = await f.callback.GET(new Request(`${origin}/api/trade-email/callback/${provider}?${query}`, { headers: { Cookie: cookie ? `tlink_email_oauth=${cookie}` : "" } }), { params: Promise.resolve({ provider }) });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("Location")).searchParams.get("email_connection"), expected);
    assert.equal(response.headers.get("Location").includes("sensitive"), false);
    if (expected === "cancelled" || provider === "untrusted") assert.equal(f.calls.complete.length, 0);
  }
});
