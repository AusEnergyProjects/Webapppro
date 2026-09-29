import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as boundedBody from "../src/lib/bounded-request-body.mjs";
import { createSharedLeadRateLimiter } from "../src/lib/lead-rate-limit.mjs";

const source = fs.readFileSync(new URL("../src/app/api/auth/password-reset/route.ts", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../src/lib/tlink-password-reset-server.ts", import.meta.url), "utf8");
const normalization = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(serverSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(() => ({}), normalization, normalization.exports);
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ ipResult, emailResult, sendError, limiterThrows = false, realUnavailableLimiter = false } = {}) {
  const checks = [], sends = [], options = [];
  const modules = {
    "../../../../../db": { getD1: () => { throw new Error("Database must be supplied by the host"); } },
    "@/lib/bounded-request-body.mjs": boundedBody,
    "@/lib/lead-rate-limit.mjs": { createSharedLeadRateLimiter: config => {
      const type = options.length === 0 ? "ip" : "email";
      options.push(config);
      if (realUnavailableLimiter) return createSharedLeadRateLimiter({ ...config, env: { NODE_ENV: "production" } });
      const memory = createSharedLeadRateLimiter({ env: { NODE_ENV: "development" }, limit: config.limit });
      return { check: async key => {
        checks.push({ type, key });
        if (limiterThrows) throw new Error("SENSITIVE database unavailable");
        return (type === "ip" ? ipResult : emailResult) || memory.check(key);
      } };
    } },
    "@/lib/tlink-password-reset-server": {
      ...normalization.exports,
      sendTLinkPasswordResetEmail: async input => { sends.push(input); if (sendError) throw new Error(sendError); },
    },
  };
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", output)(specifier => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected dependency ${specifier}`);
    return modules[specifier];
  }, moduleRecord, moduleRecord.exports);
  return { ...moduleRecord.exports, checks, sends, options };
}

function request(payload = { email: "member@example.com" }, headers = {}, body) {
  return new Request("https://ausenergyassessments.com/api/auth/password-reset", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10", ...headers },
    body: body ?? JSON.stringify(payload),
  });
}

test("accepted endpoint returns only a generic acknowledgement after IP and hashed-address limits", async () => {
  const context = fixture();
  const response = await context.POST(request({ email: " Member@Example.com ", continuePath: "/direct-trade/team?invite=token" }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(context.sends, [{ email: "member@example.com", continuePath: "/direct-trade/team?invite=token" }]);
  assert.equal(context.checks[0].key, "tlink-password-reset:ip:203.0.113.10");
  assert.match(context.checks[1].key, /^tlink-password-reset:email:[0-9a-f]{64}$/);
  assert.doesNotMatch(context.checks[1].key, /member|example/);
  assert.deepEqual(context.options.map(option => option.limit), [10, 3]);
  assert.ok(context.options.every(option => typeof option.getDatabase === "function"));
});

test("invalid or oversized JSON never generates or sends a code", async () => {
  for (const [body, headers] of [
    ["{", {}], ["null", {}], ["[]", {}], ["{}", {}], ['{"email":123}', {}],
    ['{"email":"not-an-email"}', {}], ["x".repeat(2049), {}],
    ['{"email":"member@example.com"}', { "content-length": "2049" }],
    ['{"email":"member@example.com"}', { "content-type": "application/json-attacker" }],
  ]) {
    const context = fixture();
    const response = await context.POST(request(undefined, headers, body));
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
    assert.equal(context.sends.length, 0);
  }
});

test("rate-limit or storage failures stop before code generation", async () => {
  for (const [settings, status] of [
    [{ ipResult: { allowed: false, retryAfterSeconds: 42 } }, 429],
    [{ emailResult: { allowed: false, retryAfterSeconds: 42 } }, 429],
    [{ ipResult: { allowed: false, unavailable: true } }, 503],
    [{ emailResult: { allowed: false, unavailable: true } }, 503],
    [{ realUnavailableLimiter: true }, 503], [{ limiterThrows: true }, 503],
  ]) {
    const context = fixture(settings);
    const response = await context.POST(request());
    assert.equal(response.status, status);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "42");
    assert.equal(context.sends.length, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /SENSITIVE/);
  }
});

test("one address cannot bypass limits by changing case or trusted client IP", async () => {
  const context = fixture();
  for (let index = 0; index < 4; index++) {
    const response = await context.POST(request({ email: index % 2 ? " MEMBER@EXAMPLE.COM " : "member@example.com" }, { "cf-connecting-ip": `203.0.113.${index}` }));
    assert.equal(response.status, index === 3 ? 429 : 202);
  }
  assert.equal(context.sends.length, 3);
});

test("one IP cannot bypass limits with different emails or spoofed forwarded headers", async () => {
  const context = fixture();
  for (let index = 0; index < 11; index++) {
    const response = await context.POST(request({ email: `member${index}@example.com` }, { "x-forwarded-for": `198.51.100.${index}`, "x-real-ip": `192.0.2.${index}` }));
    assert.equal(response.status, index === 10 ? 429 : 202);
  }
  assert.equal(context.sends.length, 10);
  assert.ok(context.checks.filter(check => check.type === "ip").every(check => check.key.endsWith("203.0.113.10")));
});

test("missing trusted client IP uses a shared bucket instead of forwarded headers", async () => {
  const context = fixture();
  const req = request(undefined, { "x-forwarded-for": "spoofed" });
  req.headers.delete("cf-connecting-ip");
  assert.equal((await context.POST(req)).status, 202);
  assert.equal(context.checks[0].key, "tlink-password-reset:ip:unknown");
});

test("prelookup backend failures are safe 503 responses with no account or code details", async () => {
  const context = fixture({ sendError: "SENSITIVE Google infrastructure member@example.com oobCode=SECRET access_token=SECRET" });
  const response = await context.POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Password reset is temporarily unavailable. Please try again later." });
});

test("cross-origin requests stop before rate limits or email generation", async () => {
  const context = fixture();
  const response = await context.POST(request(undefined, { origin: "https://attacker.example" }));
  assert.equal(response.status, 403);
  assert.equal(context.checks.length, 0);
  assert.equal(context.sends.length, 0);
});
