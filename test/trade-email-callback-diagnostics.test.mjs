import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync(new URL(
  "../src/app/api/trade-email/callback/[provider]/route.ts", import.meta.url,
), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class TradeEmailConnectionError extends Error {
  constructor(stage, reason) { super("private-error-message"); this.stage = stage; this.reason = reason; }
}
const origin = "https://portal.example.test";
const secret = "private-error-message";
function fixture(failure) {
  const logs = [];
  let calls = 0;
  const exports = {};
  new Function("require", "exports", "console", compiled)((name) => {
    assert.equal(name, "@/lib/trade-email-server");
    return {
      TradeEmailConnectionError,
      isTradeEmailProvider: (value) => value === "google" || value === "microsoft",
      completeTradeEmailConnection: async () => { calls++; if (failure) throw failure; },
    };
  }, exports, { error: (...args) => logs.push(args) });
  const request = ({ provider = "google", query = `state=${secret}&code=${secret}`, cookie = `tlink_email_oauth=${secret}` } = {}) =>
    exports.GET(new Request(`${origin}/api/trade-email/callback/${provider}?${query}`, { headers: { Cookie: cookie } }),
      { params: Promise.resolve({ provider }) });
  return { logs, request, calls: () => calls };
}

test("OAuth diagnostics log only the fixed provider, stage and reason while browser response stays generic", async () => {
  for (const [stage, reason] of [
    ["state_validation", "connection_invalid"], ["owner_validation", "connection_invalid"],
    ["verifier_decryption", "credentials_invalid"], ["token_exchange", "provider_rejected"],
    ["identity_lookup", "identity_invalid"], ["connection_storage", "connection_failed"],
  ]) {
    const f = fixture(new TradeEmailConnectionError(stage, reason));
    const response = await f.request();
    assert.deepEqual(f.logs, [["Trade email OAuth callback failed", { provider: "google", stage, reason }]]);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), `${origin}/direct-trade/dashboard?workspace=account&email_connection=failed#business-settings-email`);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.match(response.headers.get("Set-Cookie"), /Max-Age=0; Secure/);
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
    assert.equal([...response.headers.values()].join(" ").includes(secret), false);
    assert.equal(await response.text(), "");
  }
});

test("Unknown errors and attacker-controlled callback values cannot enter diagnostics", async () => {
  for (const error of [new Error(secret), { stage: secret, reason: secret, message: secret }, secret]) {
    const f = fixture(error);
    await f.request();
    assert.deepEqual(f.logs, [["Trade email OAuth callback failed", { provider: "google", stage: "request", reason: "callback_failed" }]]);
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
  }
  for (const [options, reason] of [
    [{ provider: secret }, "provider_invalid"],
    [{ query: `error=${secret}&error_description=${secret}` }, "authorization_failed"],
    [{ cookie: "" }, "browser_binding_missing"],
    [{ query: `code=${secret}` }, "state_missing"],
    [{ query: `state=${secret}` }, "code_missing"],
  ]) {
    const f = fixture();
    const response = await f.request(options);
    assert.equal(new URL(response.headers.get("Location")).searchParams.get("email_connection"), "failed");
    assert.deepEqual(f.logs, [["Trade email OAuth callback failed", {
      provider: options.provider ? "unknown" : "google", stage: "request", reason,
    }]]);
    assert.equal(f.calls(), 0);
    assert.equal(JSON.stringify(f.logs).includes(secret), false);
  }
});

test("Successful and deliberately cancelled OAuth callbacks do not emit failure diagnostics", async () => {
  const success = fixture();
  assert.equal(new URL((await success.request()).headers.get("Location")).searchParams.get("email_connection"), "connected");
  assert.equal(success.calls(), 1);
  assert.deepEqual(success.logs, []);
  const cancelled = fixture();
  const response = await cancelled.request({ query: `error=access_denied&error_description=${secret}` });
  assert.equal(new URL(response.headers.get("Location")).searchParams.get("email_connection"), "cancelled");
  assert.equal(cancelled.calls(), 0);
  assert.deepEqual(cancelled.logs, []);
});
