import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contract from "../src/lib/wattzun-portal.ts";

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
  throw new Error(name);
}, route);
const input = { portal: "trade", scopeId: "business-one", requestId: "synthetic-request-0001", message: "Draft a follow-up",
  history: [{ role: "user", content: "I need a quote follow-up" }], preferences: { ...contract.WATTZUN_DEFAULT_PREFERENCES } };
const access = { db: {}, actorUid: "staff-one", scope: { portal: "trade", scopeId: "business-one", label: "Trade One" } };
const reply = { kind: "clarification", message: "I can draft that.", questions: ["Who is the follow-up for?"], links: [] };
function fixture(options = {}) {
  const events = [];
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
      return { base64: "YXVkaW8=", mimeType: "audio/mpeg" }; },
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
  return { events, deps, post };
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
  assert.deepEqual(text.events, ["authenticate", "access", "reply", "access"]);
  const voice = fixture(), voiceResult = await voice.post(true);
  assert.equal(voiceResult.response.status, 200);
  assert.deepEqual(voiceResult.body, { ok: true, transcript: input.message, reply, audio: { base64: "YXVkaW8=", mimeType: "audio/mpeg" } });
  assert.deepEqual(voice.events, ["authenticate", "access", "transcribe", "access", "reply", "access", "speak", "access"]);
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
  }
});
