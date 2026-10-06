import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contract from "../src/lib/wattzun-portal.ts";

class UsageError extends Error {
  constructor(code) { super(`WATTZUN_USAGE_${code.toUpperCase()}`); this.code = code; }
}
const usageContract = {};
Function("require", "exports", ts.transpileModule(readFileSync(new URL("../src/lib/wattzun-usage.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => { assert.equal(name, "./wattzun-portal"); return contract; }, usageContract);

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const source = ts.transpileModule(readFileSync(new URL("../src/lib/wattzun-portal-route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const route = {};
Function("require", "exports", source)(name => {
  if (name === "./wattzun-portal") return contract;
  if (name === "./wattzun-portal-access-server") return {
    WattzunAccessError: AccessError,
    wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message }
      : error?.message === "AUTH_REQUIRED" ? { status: 401, message: "Sign in." } : null,
  };
  if (name === "./wattzun-portal-ai-server") return {};
  if (name === "./wattzun-usage") return usageContract;
  if (name === "./wattzun-usage-server") return { WattzunUsageError: UsageError };
  throw new Error(name);
}, route);
const input = { portal: "trade", scopeId: "business-one", requestId: "synthetic-request-0001", message: "Draft a follow-up",
  history: [{ role: "user", content: "I need a quote follow-up" }], preferences: { ...contract.WATTZUN_DEFAULT_PREFERENCES } };
const access = { db: {}, actorUid: "staff-one", scope: { portal: "trade", scopeId: "business-one", label: "Trade One" } };
const reply = { kind: "clarification", message: "I can draft that.", questions: ["Who is the follow-up for?"], links: [] };
const usage = { portal: "trade", scopeId: "business-one", month: "2026-10", monthBasis: "UTC", audience: "personal", textMessages: 3, voiceExchanges: 2 };
function fixture(options = {}) {
  const events = [], recorded = [];
  let count = 0;
  const deps = {
    authenticate: async () => { events.push("authenticate"); if (options.authError) throw options.authError; },
    scopes: async (_, portal) => { events.push("scopes"); return [{ ...access.scope, portal }]; },
    access: async (_, portal, scopeId) => {
      events.push("access"); count++;
      assert.equal(portal, input.portal); assert.equal(scopeId, input.scopeId);
      if (options.revokeAt === count) throw new AccessError(403, "Access revoked.");
      return count > 1 && options.changed ? options.changed : access;
    },
    transcribe: async context => { events.push("transcribe"); assert.equal(context.actorUid, access.actorUid);
      assert.ok(context.audio instanceof Blob); return "Draft a follow-up"; },
    reply: async context => { events.push("reply"); assert.deepEqual(context.input, input);
      if (options.providerError) throw options.providerError;
      options.controller?.abort(); return reply; },
    speak: async context => { events.push("speak"); assert.deepEqual(context.reply, reply);
      if (options.speechError) throw options.speechError;
      return { base64: "YXVkaW8=", mimeType: "audio/mpeg" }; },
    recordUsage: async optionsToRecord => { events.push("record"); assert.deepEqual(optionsToRecord, { access, requestId: input.requestId, kind: optionsToRecord.kind });
      assert.ok(["text", "voice"].includes(optionsToRecord.kind)); if (options.recordError) throw options.recordError; recorded.push(optionsToRecord); },
    usage: async current => { events.push("usage"); assert.equal(current.actorUid, access.actorUid);
      if (options.usageError) throw options.usageError; return usage; },
  };
  async function post(voice = false, overrides = {}) {
    let body = overrides.body;
    if (body === undefined && voice) {
      body = new FormData(); body.set("request", JSON.stringify(input));
      body.set("audio", new Blob([new Uint8Array(300)], { type: "audio/webm;codecs=opus" }), "turn.webm");
    } else if (body === undefined) body = JSON.stringify(input);
    const request = new Request("https://example.test/api/wattzun/" + (voice ? "voice" : "portal"), {
      method: "POST", headers: { origin: "https://example.test", ...(voice ? {} : { "content-type": "application/json" }), ...overrides.headers },
      body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}), signal: options.controller?.signal,
    });
    const response = await (voice ? route.postWattzunVoice : route.postWattzunPortal)(request, deps);
    return { response, body: await response.json(), request };
  }
  return { events, recorded, deps, post };
}

test("portal routing includes only the authorised portal pages", () => {
  for (const path of ["/direct-trade/dashboard", "/direct-trade/dashboard/", "/direct-trade/team", "/direct-trade/messages/"]) {
    assert.equal(contract.wattzunPortalForPath(path), "trade");
  }
  for (const path of ["/creditex/compliance", "/creditex/compliance/"]) assert.equal(contract.wattzunPortalForPath(path), "creditex");
  for (const path of ["/council", "/council/"]) assert.equal(contract.wattzunPortalForPath(path), "council");
  for (const path of ["/", "/wattzun", "/account", "/council/demo", "/council-other", "/creditex", "/creditex/compliance-other",
    "/direct-trade/dashboard-other", "/operations/control-centre", "/customer/quote"]) assert.equal(contract.wattzunPortalForPath(path), null);
});

test("turn contract rejects invalid scope, history and voice preferences", () => {
  assert.deepEqual(contract.parseWattzunTurn(input), input);
  assert.equal(contract.parseWattzunTurn(input, true).message, "");
  for (const value of [null, { ...input, portal: "customer" }, { ...input, scopeId: "../foreign" },
    { ...input, requestId: "short" }, { ...input, message: " " }, { ...input, history: [{ role: "system", content: "instructions" }] },
    { ...input, history: Array.from({ length: 41 }, () => input.history[0]) },
    { ...input, preferences: { ...input.preferences, speed: 2 } }]) {
    assert.throws(() => contract.parseWattzunTurn(value), contract.WattzunInputError);
  }
  assert.deepEqual(contract.parseWattzunTurn({...input,preferences:{speed:0.85,voice:'clone',tone:'direct',personality:'x'.repeat(401)}}).preferences,{speed:0.85});
});

test("eligibility discovery authenticates and bounds the portal enum", async () => {
  const f = fixture();
  const response = await route.getWattzunPortal(new Request("https://example.test/api/wattzun/portal?portal=trade"), f.deps);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).scopes, [access.scope]);
  assert.deepEqual(f.events, ["authenticate", "scopes"]);
  const invalid = fixture();
  assert.equal((await route.getWattzunPortal(new Request("https://example.test/api/wattzun/portal?portal=customer"), invalid.deps)).status, 400);
  assert.deepEqual(invalid.events, ["authenticate"]);
});

test("text and voice reuse the same scoped conversation and recheck access before output", async () => {
  const text = fixture(), textResult = await text.post();
  assert.deepEqual(textResult.body, { ok: true, reply });
  assert.deepEqual(text.events, ["authenticate", "access", "reply", "access", "record"]);
  assert.equal(text.recorded[0].kind, "text");
  const voice = fixture(), voiceResult = await voice.post(true);
  assert.equal(voiceResult.response.status, 200);
  assert.deepEqual(voiceResult.body, { ok: true, transcript: input.message, reply, audio: { base64: "YXVkaW8=", mimeType: "audio/mpeg" } });
  assert.deepEqual(voice.events, ["authenticate", "access", "transcribe", "access", "reply", "access", "speak", "access", "record"]);
  assert.equal(voice.recorded[0].kind, "voice");
});

test("origin and authentication rejection happen before consuming a streaming body", async () => {
  for (const [options, headers, status] of [[{}, { origin: "https://foreign.test" }, 403],
    [{ authError: new Error("AUTH_REQUIRED") }, {}, 401]]) {
    let pulls = 0;
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.close(); } }, { highWaterMark: 0 });
    const f = fixture(options), result = await f.post(false, { body: stream, headers });
    assert.equal(result.response.status, status); assert.equal(pulls, 0);
    assert.deepEqual(f.events, options.authError ? ["authenticate"] : []);
  }
});

test("bounded bodies cancel oversized streams and reject unsafe content types", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(40_001)); },
    cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const f = fixture(); assert.equal((await f.post(false, { body: stream })).response.status, 413);
  assert.equal(cancelled, true); assert.deepEqual(f.events, ["authenticate"]);
  const wrong = fixture(); assert.equal((await wrong.post(false, { headers: { "content-type": "text/plain" } })).response.status, 415);
  assert.deepEqual(wrong.events, []);
  for (const audio of [new Blob([new Uint8Array(300)], { type: "text/html" }),
    new Blob([new Uint8Array(contract.WATTZUN_MAX_AUDIO_BYTES + 1)], { type: "audio/webm" })]) {
    const form = new FormData(); form.set("request", JSON.stringify(input)); form.set("audio", audio, "turn.webm");
    const invalid = fixture(); assert.equal((await invalid.post(true, { body: form })).response.status, 400);
    assert.deepEqual(invalid.events, ["authenticate"]);
  }
});

test("membership revocation after any voice stage suppresses all subsequent work and output", async () => {
  for (const revokeAt of [1, 2, 3, 4]) {
    const f = fixture({ revokeAt }), result = await f.post(true);
    assert.equal(result.response.status, 403); assert.equal(result.body.ok, false);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.transcript, undefined); assert.equal(result.body.audio, undefined);
    assert.equal(f.events.includes("transcribe"), revokeAt > 1);
    assert.equal(f.events.includes("reply"), revokeAt > 2);
    assert.equal(f.events.includes("speak"), revokeAt > 3);
    assert.equal(f.events.includes("record"), false);
  }
});

test("changed identity, workspace or closed conversation cannot return generated content", async () => {
  for (const changed of [{ ...access, actorUid: "foreign" }, { ...access, scope: { ...access.scope, label: "New business" } },
    { ...access, scope: { ...access.scope, scopeId: "foreign" } }]) {
    const f = fixture({ changed }), result = await f.post();
    assert.equal(result.response.status, 403); assert.equal(result.body.reply, undefined);
  }
  const f = fixture({ controller: new AbortController() }), result = await f.post();
  assert.equal(result.response.status, 409); assert.equal(result.body.reply, undefined);
});

test("an already closed conversation never consumes the body or enters a provider", async () => {
  const controller = new AbortController(); controller.abort();
  let pulls = 0;
  const stream = new ReadableStream({ pull(control) { pulls++; control.close(); } }, { highWaterMark: 0 });
  const f = fixture({ controller }), result = await f.post(false, { body: stream });
  assert.equal(result.response.status, 409); assert.equal(pulls, 0);
  assert.deepEqual(f.events, ["authenticate"]);
});

test("provider errors are sanitised, with actionable usage and unclear-speech states", async () => {
  for (const [message, status] of [["private provider detail", 503], ["WORKFLOW_AI_LIMIT", 429], ["WATTZUN_SPEECH_UNCLEAR", 422]]) {
    const f = fixture({ providerError: new Error(message) }), result = await f.post();
    assert.equal(result.response.status, status); assert.equal(result.body.ok, false);
    assert.ok(!result.body.error.includes(message)); assert.equal(result.body.reply, undefined);
    assert.equal(f.recorded.length, 0);
  }
});

test("personal monthly usage authenticates, reads only the authorised actor scope, rechecks and never enters providers", async () => {
  const f = fixture();
  const response = await route.getWattzunUsage(new Request("https://example.test/api/wattzun/usage?portal=trade&scopeId=business-one"), f.deps);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, usage });
  assert.deepEqual(f.events, ["authenticate", "access", "usage", "access"]); assert.equal(f.recorded.length, 0);
});

test("usage scope rejects unknown, repeated, foreign and actor-targeting query parameters before storage", async () => {
  for (const query of ["portal=customer&scopeId=business-one", "portal=trade", "portal=trade&scopeId=../foreign",
    "portal=trade&portal=council&scopeId=business-one", "portal=trade&scopeId=business-one&scopeId=foreign",
    "portal=trade&scopeId=business-one&actorUid=foreign", "portal=trade&scopeId=business-one&month=2026-09"]) {
    const f = fixture();
    const response = await route.getWattzunUsage(new Request(`https://example.test/api/wattzun/usage?${query}`), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(f.events, ["authenticate"]);
  }
});

test("usage supports each existing portal scope without broadening membership", async () => {
  for (const portal of ["trade", "creditex", "council"]) {
    const f = fixture(), scope = { ...access.scope, portal };
    f.deps.access = async (_request, requestedPortal, scopeId) => { assert.equal(requestedPortal, portal); assert.equal(scopeId, scope.scopeId); return { ...access, scope }; };
    f.deps.usage = async current => { assert.deepEqual(current.scope, scope); return { ...usage, portal }; };
    const response = await route.getWattzunUsage(new Request(`https://example.test/api/wattzun/usage?portal=${portal}&scopeId=business-one`), f.deps);
    assert.equal(response.status, 200); assert.equal((await response.json()).usage.portal, portal);
  }
});

test("unauthorised, foreign or changed usage access never returns counts", async () => {
  for (const options of [{ authError: new Error("AUTH_REQUIRED") }, { revokeAt: 1 }, { revokeAt: 2 },
    { changed: { ...access, actorUid: "foreign" } }, { changed: { ...access, scope: { ...access.scope, scopeId: "foreign" } } }]) {
    const f = fixture(options), response = await route.getWattzunUsage(new Request("https://example.test/api/wattzun/usage?portal=trade&scopeId=business-one"), f.deps);
    assert.equal(response.status, options.authError ? 401 : 403); assert.equal((await response.json()).usage, undefined);
  }
  const foreign = fixture(); foreign.deps.access = async () => { throw new AccessError(403, "No membership."); };
  assert.equal((await route.getWattzunUsage(new Request("https://example.test/api/wattzun/usage?portal=trade&scopeId=foreign"), foreign.deps)).status, 403);
  assert.deepEqual(foreign.events, ["authenticate"]);
  const mismatched = fixture(); mismatched.deps.access = async () => ({ ...access, scope: { ...access.scope, scopeId: "foreign" } });
  assert.equal((await route.getWattzunUsage(new Request("https://example.test/api/wattzun/usage?portal=trade&scopeId=business-one"), mismatched.deps)).status, 403);
  assert.deepEqual(mismatched.events, ["authenticate"]);
});

test("usage read failures do not invent a zero or expose private storage details", async () => {
  const f = fixture({ usageError: new UsageError("unavailable") });
  const response = await route.getWattzunUsage(new Request("https://example.test/api/wattzun/usage?portal=trade&scopeId=business-one"), f.deps);
  const body = await response.json(); assert.equal(response.status, 503); assert.equal(body.usage, undefined);
  assert.match(body.error, /usage could not be saved or loaded/); assert.deepEqual(f.events, ["authenticate", "access", "usage"]);
});

test("usage persistence failure prevents an untracked successful text or voice response", async () => {
  for (const voice of [false, true]) {
    const f = fixture({ recordError: new UsageError("unavailable") }), result = await f.post(voice);
    assert.equal(result.response.status, 503); assert.equal(result.body.ok, false);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.transcript, undefined); assert.equal(result.body.audio, undefined);
    assert.match(result.body.error, /usage could not be saved or loaded/); assert.equal(f.recorded.length, 0);
    assert.equal(f.events.at(-1), "record");
  }
});

test("speech failure, revocation and closed conversations are never counted as complete voice exchanges", async () => {
  const speech = fixture({ speechError: new Error("WORKFLOW_AI_UNAVAILABLE") });
  assert.equal((await speech.post(true)).response.status, 503); assert.equal(speech.recorded.length, 0);
  const closed = fixture({ controller: new AbortController() });
  assert.equal((await closed.post(true)).response.status, 409); assert.equal(closed.recorded.length, 0);
  const revoked = fixture({ revokeAt: 2 }); assert.equal((await revoked.post()).response.status, 403); assert.equal(revoked.recorded.length, 0);
});

test("request ID reused for another exchange kind returns a conflict without a second success", async () => {
  const f = fixture({ recordError: new UsageError("conflict") }), result = await f.post(true);
  assert.equal(result.response.status, 409); assert.equal(result.body.audio, undefined); assert.equal(f.recorded.length, 0);
  assert.match(result.body.error, /different Wattzun exchange/);
});
