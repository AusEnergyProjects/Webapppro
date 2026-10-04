import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as bounded from "../src/lib/bounded-json-request.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/app/api/trade-customer-hub/assist/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const access = { ownerUid: "business-one", actorUid: "office-one", memberId: "member-one", canViewQuotes: true, canManageQuotes: true };
const input = { workOrderId: "job-one", requestId: "synthetic-request-0001" };
const draft = { brief: [{ text: "Requested work", sourceIds: ["job"] }], draftScope: [{ text: "Confirm scope", sourceIds: ["job"] }], sourceHash: "a".repeat(64) };

function fixture({ origin = true, firstAuthError, current = access, finalAuthError } = {}) {
  const exports = {}, events = [], db = {}, requests = [];
  let authenticationCount = 0;
  const dependencies = {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { sameOrigin: () => origin, mfaErrorResponse: () => null },
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async request => {
      events.push("auth"); requests.push(request); authenticationCount++;
      const error = authenticationCount === 1 ? firstAuthError : finalAuthError;
      if (error) throw error;
      return authenticationCount === 1 ? access : current;
    } },
    "@/lib/customer-quote-hub-server": { hubJson: (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }) },
    "@/lib/trade-customer-hub-assist-server": { createTradeHubAssist: async (...args) => { events.push("generate"); assert.deepEqual(args, [db, access, input.workOrderId, input.requestId]); return draft; } },
    "@/lib/bounded-json-request": bounded,
  };
  Function("require", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exports);
  return { events, requests, async post(body = JSON.stringify(input)) {
    const request = new Request("https://example.test/api/trade-customer-hub/assist", {
      method: "POST", headers: { "Content-Type": "application/json" }, ...(body === null ? {} : { body }),
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    });
    const response = await exports.POST(request);
    return { status: response.status, body: await response.json(), headers: response.headers, request };
  } };
}

test("route accepts the exact byte limit and only passes authenticated scope to generation", async () => {
  const f = fixture();
  const value = { ...input, ownerUid: "foreign-business", actorUid: "foreign-user", extra: "" };
  value.extra = "x".repeat(8 * 1024 - Buffer.byteLength(JSON.stringify(value)));
  const body = JSON.stringify(value); assert.equal(Buffer.byteLength(body), 8 * 1024);
  const response = await f.post(body);
  assert.equal(response.status, 200); assert.deepEqual(response.body, { ok: true, ...draft });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.events, ["auth", "generate", "auth"]);
  assert.deepEqual(f.requests, [response.request, response.request]);
});

test("route rejects a body one byte over its bound before generation", async () => {
  const f = fixture(), value = { ...input, extra: "" };
  value.extra = "x".repeat(8 * 1024 + 1 - Buffer.byteLength(JSON.stringify(value)));
  const response = await f.post(JSON.stringify(value));
  assert.equal(response.status, 413); assert.equal(response.body.code, "REQUEST_TOO_LARGE");
  assert.equal(response.body.ok, false); assert.equal(response.body.brief, undefined);
  assert.deepEqual(f.events, ["auth"]);
});

test("route bounds UTF-8 bytes rather than JavaScript string length", async () => {
  const f = fixture(), body = JSON.stringify({ ...input, extra: "\u20ac".repeat(3000) });
  assert.ok(body.length < 8 * 1024); assert.ok(Buffer.byteLength(body) > 8 * 1024);
  const response = await f.post(body);
  assert.equal(response.status, 413); assert.deepEqual(f.events, ["auth"]);
});

test("oversized streaming body is cancelled without reading the remainder", async () => {
  const f = fixture(); let pulls = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(8 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = await f.post(body);
  assert.equal(response.status, 413); assert.equal(pulls, 1); assert.equal(cancelled, true);
  assert.deepEqual(f.events, ["auth"]);
});

test("malformed JSON, absent bodies and invalid UTF-8 return input errors without generation", async t => {
  for (const [label, body] of [["malformed JSON", "{"], ["absent body", null], ["invalid UTF-8", new Uint8Array([0xc3, 0x28])]]) {
    await t.test(label, async () => {
      const f = fixture(), response = await f.post(body);
      assert.equal(response.status, 400); assert.equal(response.body.code, "REQUEST_JSON_INVALID");
      assert.equal(response.body.ok, false); assert.equal(response.body.brief, undefined); assert.deepEqual(f.events, ["auth"]);
    });
  }
});

test("invalid request shapes never enter generation", async t => {
  for (const value of [null, [], "wrong", {}, { ...input, workOrderId: " " }, { ...input, workOrderId: "x".repeat(181) }, { ...input, requestId: "short" }]) {
    await t.test(JSON.stringify(value), async () => {
      const f = fixture(), response = await f.post(JSON.stringify(value));
      assert.equal(response.status, 400); assert.equal(response.body.ok, false); assert.deepEqual(f.events, ["auth"]);
    });
  }
});

test("origin and initial authentication are checked before the request body is consumed", async () => {
  for (const options of [{ origin: false }, { firstAuthError: new Error("AUTH_REQUIRED") }]) {
    const f = fixture(options); let pulls = 0;
    const body = new ReadableStream({ pull(controller) { pulls++; controller.close(); } }, { highWaterMark: 0 });
    const response = await f.post(body);
    assert.equal(response.status, 403); assert.equal(pulls, 0);
    assert.deepEqual(f.events, options.origin === false ? [] : ["auth"]);
  }
});

test("current authentication and quote permissions are required before returning the draft", async t => {
  for (const [label, options] of [
    ["business changed", { current: { ...access, ownerUid: "different-business" } }],
    ["actor changed", { current: { ...access, actorUid: "different-user" } }],
    ["view revoked", { current: { ...access, canViewQuotes: false } }],
    ["manage revoked", { current: { ...access, canManageQuotes: false } }],
    ["authentication ended", { finalAuthError: new Error("AUTH_REQUIRED") }],
  ]) await t.test(label, async () => {
    const f = fixture(options), response = await f.post();
    assert.equal(response.status, 403); assert.equal(response.body.ok, false);
    assert.equal(response.body.brief, undefined); assert.equal(response.body.draftScope, undefined);
    assert.deepEqual(f.events, ["auth", "generate", "auth"]);
  });
});
