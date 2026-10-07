import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contract from "../src/lib/wattzun-portal.ts";
import * as greeting from "../src/lib/wattzun-greeting.ts";
import * as workflowContract from "../src/lib/wattzun-workflow.ts";
import * as workflowReply from "../src/lib/wattzun-workflow-reply.ts";
import * as formGuideContract from "../src/lib/wattzun-form-guide.ts";
import * as formStepContract from "../src/lib/wattzun-form-step.ts";
import { syntheticWorkContext, workContextContract, workContextGateway } from "./helpers/wattzun-work-context-fixture.mjs";

const contextGateway = workContextGateway();

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
class WorkflowError extends Error { constructor(status, message) { super(message); this.status = status; } }
class ExistingQuoteError extends Error { constructor(status, message) { super(message); this.status = status; } }
const source = ts.transpileModule(readFileSync(new URL("../src/lib/wattzun-portal-route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const route = {};
const routeLogs = [];
Function("require", "exports", "console", source)(name => {
  if (name === "./wattzun-portal") return contract;
  if (name === "./wattzun-greeting") return greeting;
  if (name === "./wattzun-portal-access-server") return {
    WattzunAccessError: AccessError,
    wattzunAccessFailure: error => error instanceof AccessError ? { status: error.status, message: error.message }
      : error?.message === "AUTH_REQUIRED" ? { status: 401, message: "Sign in." } : null,
  };
  if (name === "./wattzun-realtime-server") return { WattzunRealtimeTurnError: class RealtimeTurnError extends Error {} };
  if (name === "./wattzun-portal-ai-server") return {};
  if (name === "./wattzun-turn-authority-server") return {};
  if (name === "./wattzun-form-guide") return formGuideContract;
  if (name === "./wattzun-form-step") return formStepContract;
  if (name === "./wattzun-usage") return usageContract;
  if (name === "./wattzun-usage-server") return { WattzunUsageError: UsageError };
  if (name === "./wattzun-work-context" || name === "./wattzun-work-context.ts") return workContextContract;
  if (name === "./wattzun-work-context-server") return contextGateway;
  if (name === "./wattzun-workflow") return workflowContract;
  if (name === "./wattzun-workflow-reply") return workflowReply;
  if (name === "./wattzun-workflow-server") return { WattzunWorkflowError: WorkflowError };
  if (name === "./wattzun-existing-quote-server") return { WattzunExistingQuoteError: ExistingQuoteError };
  if (name === "./wattzun-form-server") return { WattzunFormError: class FormError extends Error {} };
  throw new Error(name);
}, route, { warn: (...args) => routeLogs.push(args) });
const input = { portal: "trade", scopeId: "business-one", requestId: "synthetic-request-0001", message: "Draft a follow-up",
  history: [{ role: "user", content: "I need a quote follow-up" }], preferences: { ...contract.WATTZUN_DEFAULT_PREFERENCES } };
const access = { db: {}, actorUid: "staff-one", scope: { portal: "trade", scopeId: "business-one", label: "Trade One" } };
const reply = { kind: "clarification", message: "I can draft that.", questions: ["Who is the follow-up for?"], links: [] };
const usage = { portal: "trade", scopeId: "business-one", month: "2026-10", monthBasis: "UTC", audience: "personal", textMessages: 3, voiceExchanges: 2 };
const workflowProposal = { kind: "draft_job_quote", jobId: "", jobQuery: "", mode: "append", description: "Install confirmed work", lines: [{ lineType: "labour", description: "Installation", quantity: "2", unitPrice: "50", taxCode: "gst" }] };
const workflowReview = { state: "review", reviewId: "wattzun-review-current-123", expiresAt: "2026-10-07T12:15:00Z", kind: "draft_job_quote", heading: "Review the existing quote", summary: "Two installation units at $50 ex GST will be added to this job's draft.", confirmationLabel: "Save quote draft", lines: [{ label: "Job", value: "JOB-123" }], href: "/direct-trade/team?workspace=work&jobId=actual-job-123&jobTab=quote" };

test("text prepares a concrete scoped workflow review and binds blank or current-job references to the selected job", async () => {
  const workContext = syntheticWorkContext();
  for (const jobQuery of ["", "this job", "for this job", "the selected quote"]) {
    const action = { ...workflowProposal, jobQuery };
    const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext, reply: { ...reply, action }, workflowResult: workflowReview });
    const result = await f.post(); assert.equal(result.response.status, 200); assert.deepEqual(result.body.reply.workflow, workflowReview);
    assert.equal(f.workflowCalls[0].proposal.jobId, workContext.reference.recordId); assert.equal(f.workflowCalls[0].current.actorUid, access.actorUid);
    assert.equal(f.workflowCalls[0].requestId, input.requestId); assert.equal(result.body.reply.action.jobId, workContext.reference.recordId);
    assert.equal(f.events.filter(value => value === "prepareWorkflow").length, 1); assert.equal(f.recorded.length, 1);
    assert.equal(f.events.filter(value => value === "context").length, 3, "Initial, pre-usage and final source checks remain without another full snapshot before target preparation");
    assert.deepEqual(f.events.slice(f.events.indexOf("reply") + 1, f.events.indexOf("prepareWorkflow") + 1), ["access", "prepareWorkflow"]);
  }
});
test("workflow preparation still requires fresh scope after reasoning without reloading the selected snapshot", async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext,
    reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview, revokeAt: 2 });
  const result = await f.post(); assert.equal(result.response.status, 403);
  assert.equal(f.events.filter(value => value === "context").length, 1); assert.equal(f.workflowCalls.length, 0);
  assert.equal(f.providerContexts.length, 1); assert.equal(f.recorded.length, 0); assert.equal(result.body.reply, undefined);
});
test("another job's customer, suburb or time clues remain searchable instead of being replaced by the selected job", async () => {
  const workContext = syntheticWorkContext(); const action = { ...workflowProposal, jobQuery: "that job last week in Frankston" };
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext, reply: { ...reply, action }, workflowResult: workflowReview });
  const result = await f.post(); assert.equal(result.response.status, 200); assert.equal(f.workflowCalls[0].proposal.jobId, "");
  assert.equal(f.workflowCalls[0].proposal.jobQuery, action.jobQuery);
});
test("a pending proposal or current frozen review reaches the provider only after authorised server preparation", async () => {
  for (const pending of [{ workflowProposal }, { workflowReviewId: workflowReview.reviewId }]) {
    const f = fixture({ input: { ...input, ...pending }, workflowResult: workflowReview });
    const result = await f.post(); assert.equal(result.response.status, 200); assert.deepEqual(f.providerContexts[0].workflowContext, workflowReview);
    assert.ok(f.events.indexOf(pending.workflowProposal ? "prepareWorkflow" : "workflowReview") < f.events.indexOf("reply"));
    assert.deepEqual(result.body.reply.workflow, workflowReview);
  }
});
test("a current explicit approval returns the matching confirmation and review without executing inside the model route", async () => {
  const action = { kind: "confirm_workflow", reviewId: workflowReview.reviewId };
  const f = fixture({ input: { ...input, message: "Yes save it", workflowReviewId: workflowReview.reviewId }, workflowResult: workflowReview, reply: { ...reply, action } });
  const result = await f.post(); assert.equal(result.response.status, 200); assert.deepEqual(result.body.reply.action, action); assert.deepEqual(result.body.reply.workflow, workflowReview);
  assert.equal(result.body.reply.kind, "answer"); assert.equal(result.body.reply.message, "I will submit this reviewed task now."); assert.deepEqual(result.body.reply.questions, []);
  assert.equal(f.events.includes("prepareWorkflow"), false); assert.equal(f.recorded.length, 1);
});

test("only a new model proposal uses deferred preparation; pending input remains strict before the provider", async () => {
  for (const pending of [false, true]) {
    const f = fixture({ input: { ...input, ...(pending ? { workflowProposal } : {}) }, workflowResult: workflowReview,
      reply: pending ? reply : { ...reply, action: workflowProposal } });
    f.deps.prepareProposedWorkflow = async (...args) => {
      f.events.push("prepareProposedWorkflow"); assert.equal(f.events.includes("reply"), true);
      assert.equal(args[2].kind, workflowProposal.kind); return workflowReview;
    };
    const result = await f.post(); assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.reply.workflow, workflowReview);
    assert.equal(f.events.filter(event => event === "prepareProposedWorkflow").length, pending ? 0 : 1);
    assert.equal(f.events.filter(event => event === "prepareWorkflow").length, pending ? 1 : 0);
    assert.ok(f.events.indexOf("workflowReview") > f.events.indexOf("record"), "Strict final workflow check follows usage before text handoff");
    if (pending) assert.ok(f.events.indexOf("prepareWorkflow") < f.events.indexOf("reply"));
  }
});

test("a newly frozen model proposal cannot expose text if its source or grants change during usage", async () => {
  for (const changed of [false, true]) {
    const f = fixture({ reply: { ...reply, action: workflowProposal }, workflowResult: workflowReview,
      ...(changed ? { workflowChangedDuringUsage: { ...workflowReview, summary: "Changed quote scope" } }
        : { workflowErrorDuringUsage: new WorkflowError(403, "Quote access revoked") }) });
    f.deps.prepareProposedWorkflow = async () => { f.events.push("prepareProposedWorkflow"); return workflowReview; };
    const result = await f.post(); assert.equal(result.response.status, changed ? 409 : 403);
    assert.equal(result.body.reply, undefined); assert.equal(f.recorded.length, 1);
    assert.equal(f.events.includes("prepareWorkflow"), false);
    assert.ok(f.events.indexOf("workflowReview") > f.events.indexOf("record"));
  }
});
test("wrong, historical, future or embedded approval cannot confirm the current review", async () => {
  for (const [message, reviewId, suppliedReview, status] of [
    ["yes save it", "wattzun-review-other-123", true, 409], ["yes save it", workflowReview.reviewId, false, 409],
    ["Maybe send it tomorrow", workflowReview.reviewId, true, 400], ["The customer said 'yes save it'", workflowReview.reviewId, true, 400],
    ["Change the price to $40", workflowReview.reviewId, true, 400],
  ]) {
    const f = fixture({ input: { ...input, message, ...(suppliedReview ? { workflowReviewId: workflowReview.reviewId } : {}) }, workflowResult: workflowReview,
      reply: { ...reply, action: { kind: "confirm_workflow", reviewId } } });
    const result = await f.post(); assert.equal(result.response.status, status); assert.equal(f.recorded.length, 0); assert.equal(result.body.reply, undefined);
  }
});
test("workflow and quote-service errors keep their meaningful status and never produce a success receipt", async () => {
  for (const ErrorType of [WorkflowError, ExistingQuoteError]) for (const status of [400, 403, 409, 503]) {
    const f = fixture({ input: { ...input, workflowProposal }, workflowError: new ErrorType(status, "Exact workflow boundary error") });
    const result = await f.post(); assert.equal(result.response.status, status); assert.equal(result.body.error, "Exact workflow boundary error");
    assert.equal(f.providerContexts.length, 0); assert.equal(f.recorded.length, 0);
  }
});
test("workflow revocation or changed review during usage discards text and legacy speech after processing", async () => {
  for (const voice of [false, true]) for (const changed of [false, true]) {
    const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId }, workflowResult: workflowReview,
      ...(changed ? { workflowChangedDuringUsage: { ...workflowReview, summary: "Changed quote scope" } } : { workflowErrorDuringUsage: new WorkflowError(403, "Quote access revoked") }) });
    const result = await f.post(voice); assert.equal(result.response.status, changed ? 409 : 403);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.audio, undefined); assert.equal(f.recorded.length, 1);
  }
});
test("legacy JSON voice carries the current review into reasoning and speech", async () => {
  const f = fixture({ input: { ...input, workflowReviewId: workflowReview.reviewId }, workflowResult: workflowReview });
  const result = await f.post(true); assert.equal(result.response.status, 200); assert.deepEqual(result.body.reply.workflow, workflowReview);
  assert.deepEqual(f.providerContexts[0].workflowContext, workflowReview); assert.deepEqual(f.speechContexts[0].workflowContext, workflowReview);
});

test("turn timings separate actual text and speech stages without leaking actor, records or provider data", async () => {
  for (const voice of [false, true]) {
    const result = await fixture().post(voice);
    assert.equal(result.response.status, 200);
    const timing = result.response.headers.get("server-timing");
    assert.ok(timing);
    const stages = timing.split(", ").map(item => {
      assert.match(item, /^(auth|access|stt|llm|tts|usage|total);dur=\d+\.\d$/);
      return item.split(";")[0];
    });
    assert.deepEqual(stages, voice ? ["auth", "access", "stt", "llm", "tts", "usage", "total"] : ["auth", "access", "llm", "usage", "total"]);
    assert.doesNotMatch(timing, /business-one|staff-one|synthetic|Draft|Bearer|audio/);
  }
  const failed = await fixture({ providerError: new Error("WORKFLOW_AI_UNAVAILABLE") }).post();
  assert.equal(failed.response.status, 503);
  assert.match(failed.response.headers.get("server-timing"), /llm;dur=/);
  assert.doesNotMatch(failed.response.headers.get("server-timing"), /usage;dur=/);
});
function fixture(options = {}) {
  const events = [], recorded = [], providerContexts = [], workflowCalls = [], speechContexts = [];
  let count = 0, contextCount = 0;
  const turnInput = options.input || input;
  const deps = {
    authenticate: async () => { events.push("authenticate"); if (options.authError) throw options.authError; },
    scopes: async (_, portal) => { events.push("scopes"); return [{ ...access.scope, portal }]; },
    access: async (_, portal, scopeId) => {
      events.push("access"); count++;
      assert.equal(portal, input.portal); assert.equal(scopeId, input.scopeId);
      if (options.revokeAt === count) throw new AccessError(403, "Access revoked.");
      if (options.revokeDuringUsage && recorded.length) throw new AccessError(403, "Access revoked during usage recording.");
      if (options.accessErrorDuringUsage && recorded.length) throw options.accessErrorDuringUsage;
      return count > 1 && options.changed ? options.changed : access;
    },
    context: async (_, current, reference) => {
      events.push("context"); contextCount++;
      assert.equal(current.actorUid, access.actorUid);
      assert.deepEqual(reference, turnInput.workReference);
      if (options.contextError && contextCount === (options.contextErrorAt || 1)) throw options.contextError;
      if (options.contextErrorDuringUsage && recorded.length) throw options.contextErrorDuringUsage;
      return contextCount === options.contextChangedAt || (options.contextChangedDuringUsage && recorded.length)
        ? { ...options.workContext, sourceSha256: "b".repeat(64) } : options.workContext;
    },
    transcribe: async context => { events.push("transcribe"); assert.equal(context.actorUid, access.actorUid);
      assert.ok(context.audio instanceof Blob); return options.transcript || "Draft a follow-up"; },
    reply: async context => { events.push("reply"); providerContexts.push(context); assert.deepEqual(context.input, turnInput);
      if (options.providerError) throw options.providerError;
      if (!options.abortDuringUsage) options.controller?.abort(); return options.reply || reply; },
    speak: async context => { events.push("speak"); speechContexts.push(context); if (!options.workflowResult) assert.deepEqual(context.reply, reply);
      if (options.speechError) throw options.speechError;
      return { base64: "YXVkaW8=", mimeType: "audio/mpeg" }; },
    recordUsage: async optionsToRecord => { events.push("record"); assert.deepEqual(optionsToRecord, { access, requestId: input.requestId, kind: optionsToRecord.kind });
      assert.ok(["text", "voice"].includes(optionsToRecord.kind)); if (options.recordError) throw options.recordError; recorded.push(optionsToRecord);
      if (options.abortDuringUsage) options.controller?.abort(); },
    usage: async current => { events.push("usage"); assert.equal(current.actorUid, access.actorUid);
      if (options.usageError) throw options.usageError; return usage; },
    prepareWorkflow: async (request, current, proposal, requestId) => {
      events.push("prepareWorkflow"); workflowCalls.push({ request, current, proposal, requestId });
      if (options.workflowError) throw options.workflowError;
      return options.workflowResult;
    },
    workflowReview: async (_request, current, reviewId) => {
      events.push("workflowReview"); workflowCalls.push({ current, reviewId });
      if (options.workflowError) throw options.workflowError;
      if (options.workflowErrorDuringUsage && recorded.length) throw options.workflowErrorDuringUsage;
      return options.workflowChangedDuringUsage && recorded.length ? options.workflowChangedDuringUsage : options.workflowResult;
    },
  };
  async function post(voice = false, overrides = {}) {
    let body = overrides.body;
    if (body === undefined && voice) {
      body = new FormData(); body.set("request", JSON.stringify(turnInput));
      body.set("audio", new Blob([new Uint8Array(300)], { type: "audio/webm;codecs=opus" }), "turn.webm");
    } else if (body === undefined) body = JSON.stringify(turnInput);
    const request = new Request("https://example.test/api/wattzun/" + (voice ? "voice" : "portal"), {
      method: "POST", headers: { origin: "https://example.test", ...(voice ? {} : { "content-type": "application/json" }), ...overrides.headers },
      body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}), signal: options.controller?.signal,
    });
    const response = await (voice ? route.postWattzunVoice : route.postWattzunPortal)(request, deps);
    return { response, body: await response.json(), request };
  }
  return { events, recorded, providerContexts, workflowCalls, speechContexts, deps, post };
}

test("a selected authorised source reaches the text provider while only context metadata returns to the browser", async () => {
  const workContext = syntheticWorkContext();
  const f = fixture({ input: { ...input, workReference: workContext.reference }, workContext });
  const result = await f.post();
  assert.equal(result.response.status, 200);
  assert.equal(f.providerContexts[0].workContext, workContext);
  assert.deepEqual(result.body.reply.workContext, contextGateway.wattzunWorkContextInfo(workContext));
  assert.equal(result.body.reply.workContext.facts, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /switchboard|operationalStage|trade_job_overview/);
  assert.deepEqual(f.events, ["authenticate", "access", "context", "reply", "access", "context", "record", "access", "context"]);
  assert.equal(f.recorded.length, 1);
});

test("changed or revoked text sources suppress the whole reply before recording usage", async () => {
  const workContext = syntheticWorkContext();
  for (const options of [
    { contextChangedAt: 2, status: 409 },
    { contextError: new workContextContract.WattzunWorkContextError(403, "Current job access is required."), contextErrorAt: 2, status: 403 },
  ]) {
    const f = fixture({ ...options, input: { ...input, workReference: workContext.reference }, workContext });
    const result = await f.post();
    assert.equal(result.response.status, options.status);
    assert.equal(result.body.reply, undefined);
    assert.equal(f.providerContexts.length, 1);
    assert.equal(f.recorded.length, 0);
  }
});

test("oversized sources and forged cross-portal references never reach the provider or usage writes", async () => {
  const workContext = syntheticWorkContext({ facts: { oversized: "界".repeat(9000) } });
  const oversized = fixture({ input: { ...input, workReference: workContext.reference }, workContext });
  assert.equal((await oversized.post()).response.status, 413);
  assert.equal(oversized.providerContexts.length, 0); assert.equal(oversized.recorded.length, 0);
  const foreign = fixture({ input: { ...input, workReference: { kind: "creditex_audit", recordId: "foreign-case" } } });
  assert.equal((await foreign.post()).response.status, 400);
  assert.equal(foreign.events.includes("access"), false);
  assert.equal(foreign.events.includes("context"), false);
  assert.equal(foreign.providerContexts.length, 0); assert.equal(foreign.recorded.length, 0);
});

test("closing a text or legacy JSON voice turn during usage recording suppresses the generated content", async () => {
  for (const voice of [false, true]) {
    const f = fixture({ controller: new AbortController(), abortDuringUsage: true });
    const result = await f.post(voice);
    assert.equal(result.response.status, 409);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.audio, undefined); assert.equal(result.body.transcript, undefined);
    assert.equal(f.recorded.length, 1);
    assert.equal(f.events.includes("speak"), voice);
  }
});

test("source changes or record access revoked during usage recording suppress text and legacy JSON voice output", async () => {
  const workContext = syntheticWorkContext();
  for (const voice of [false, true]) {
    for (const options of [
      { contextChangedDuringUsage: true, status: 409 },
      { contextErrorDuringUsage: new workContextContract.WattzunWorkContextError(403, "Current job access is required."), status: 403 },
      { revokeDuringUsage: true, status: 403 },
    ]) {
      const f = fixture({ ...options, input: { ...input, workReference: workContext.reference }, workContext });
      const result = await f.post(voice);
      assert.equal(result.response.status, options.status);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.reply, undefined); assert.equal(result.body.audio, undefined); assert.equal(result.body.transcript, undefined);
      assert.equal(f.recorded.length, 1);
      assert.equal(f.events.includes("speak"), voice);
      assert.ok(f.events.lastIndexOf("access") > f.events.indexOf("record"));
    }
  }
});

test("workspace access revoked during usage recording suppresses existing text and JSON voice turns without a selected source", async () => {
  for (const voice of [false, true]) {
    const f = fixture({ revokeDuringUsage: true });
    const result = await f.post(voice);
    assert.equal(result.response.status, 403);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.audio, undefined); assert.equal(result.body.transcript, undefined);
    assert.equal(f.recorded.length, 1);
    assert.equal(f.events.includes("context"), false);
  }
});

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
    { ...input, history: Array.from({ length: contract.WATTZUN_MAX_HISTORY_TURNS + 1 }, () => input.history[0]) },
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
  assert.deepEqual(text.events, ["authenticate", "access", "reply", "access", "record", "access"]);
  assert.equal(text.recorded[0].kind, "text");
  const voice = fixture(), voiceResult = await voice.post(true);
  assert.equal(voiceResult.response.status, 200);
  assert.deepEqual(voiceResult.body, { ok: true, transcript: input.message, reply, audio: { base64: "YXVkaW8=", mimeType: "audio/mpeg" } });
  assert.deepEqual(voice.events, ["authenticate", "access", "transcribe", "access", "reply", "access", "speak", "access", "record", "access"]);
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
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(contract.WATTZUN_MAX_REQUEST_BYTES + 1)); },
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

test("text and JSON voice transports retain accepted Unicode history larger than the former 40k body ceiling", async () => {
  const history=Array.from({length:6},(_,index)=>({role:index%2?'assistant':'user',content:'漢'.repeat(3900)}));
  const turnInput={...input,history};
  assert.ok(new TextEncoder().encode(JSON.stringify(turnInput)).byteLength>40000);
  for(const voice of [false,true]){
    const f=fixture({input:turnInput});
    const result=await f.post(voice);
    assert.equal(result.response.status,200);
    assert.deepEqual(f.providerContexts[0].input.history,history);
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

test("text failure diagnostics identify the phase without logging requests, records or arbitrary errors", async () => {
  for (const [options, expected] of [
    [{ providerError: new Error("WORKFLOW_AI_UNAVAILABLE") }, { phase: "reply", category: "WORKFLOW_AI_UNAVAILABLE" }],
    [{ providerError: new Error("private provider key and customer details") }, { phase: "reply", category: "internal" }],
    [{ reply: { ...reply, action: workflowProposal }, workflowError: new Error("private storage and customer details") }, { phase: "workflow", category: "internal" }],
  ]) {
    const before = routeLogs.length;
    const result = await fixture(options).post();
    assert.equal(result.response.status, 503);
    assert.deepEqual(routeLogs.slice(before), [["Wattzun text turn failed", expected]]);
    assert.doesNotMatch(JSON.stringify(routeLogs.slice(before)), /private|business-one|staff-one|Draft a follow-up/);
  }
});

test("final text diagnostics distinguish scope, selected-source and workflow failures without handing off a reply", async () => {
  const workContext = syntheticWorkContext();
  for (const [lateFailure, phase] of [
    [{ accessErrorDuringUsage: new Error("secret-final-scope-key") }, "final_scope_source"],
    [{ contextErrorDuringUsage: new Error("secret-final-source-SQL") }, "final_scope_source"],
    [{ workflowErrorDuringUsage: new Error("secret-final-workflow-recipient") }, "final_workflow"],
  ]) {
    const before = routeLogs.length;
    const f = fixture({ input: { ...input, workReference: workContext.reference, workflowReviewId: workflowReview.reviewId },
      workContext, workflowResult: workflowReview, ...lateFailure });
    const result = await f.post();
    assert.equal(result.response.status, 503); assert.equal(f.recorded.length, 1);
    assert.equal(result.body.reply, undefined); assert.equal(result.body.audio, undefined);
    assert.deepEqual(routeLogs.slice(before), [["Wattzun text turn failed", { phase, category: "internal" }]]);
    assert.doesNotMatch(JSON.stringify([routeLogs.slice(before), result.body]), /secret-final|business-one|staff-one|Draft a follow-up/);
    if (phase === "final_scope_source") assert.equal(f.events.filter(event => event === "workflowReview").length, 1);
    else assert.equal(f.events.filter(event => event === "workflowReview").length, 2);
  }
});

test("text failure diagnostics use fixed categories for hosting, D1, immediate causes and known codes only", async () => {
  const secret = "secret-key-token-customer-SQL-prompt";
  const abort = new Error(secret); abort.name = "AbortError";
  const unknownName = new Error(secret); unknownName.name = "private-name-D1_ERROR";
  for (const [error, category] of [
    [new Error(`D1_ERROR: Too many API requests by single worker invocation: ${secret}`), "api_request_limit"],
    [new Error(`Too many subrequests: ${secret}`), "api_request_limit"],
    [new Error(`API request limit exceeded: ${secret}`), "api_request_limit"],
    [new Error(`Cannot perform I/O on behalf of a different request. ${secret}`), "different_request_io"],
    [new Error(`Worker exceeded CPU time limit: ${secret}`), "cpu_limit"],
    [new Error(`D1_ERROR: D1 DB exceeded its CPU time limit and was reset. ${secret}`), "cpu_limit"],
    [new Error(`Compute limit exceeded: ${secret}`), "cpu_limit"],
    [new Error(`D1_ERROR: D1 DB is overloaded. Requests queued for too long. ${secret}`), "database_overloaded"],
    [new Error(`D1_ERROR: D1 DB is overloaded. Too many requests queued. ${secret}`), "database_overloaded"],
    [new Error(`D1_ERROR: too_many_requests: ${secret}`), "database_overloaded"],
    [new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row read limit. ${secret}`), "database_quota"],
    [new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row write limit. ${secret}`), "database_quota"],
    [new Error(`D1_ERROR: D1 query quota exceeded. ${secret}`), "database_quota"],
    [new Error(`D1_ERROR: select private_customer from secret_table; ${secret}`), "database_error"],
    [new Error(`D1_EXEC_ERROR: statement failed: ${secret}`), "database_error"],
    [new Error(`D1_TYPE_ERROR: ${secret}`), "database_error"],
    [new Error(`SQLITE_BUSY: ${secret}`), "database_error"],
    [new Error(secret, { cause: new Error(`D1_ERROR: ${secret}`) }), "database_error"],
    [new Error(`D1_ERROR: ${secret}`, { cause: "Too many API requests by single worker invocation" }), "api_request_limit"],
    [new Error(secret, { cause: abort }), "aborted"],
    [abort, "aborted"],
    [new Error("TEAM_ACCESS_RECORD_REQUIRED"), "TEAM_ACCESS_RECORD_REQUIRED"],
    [new Error("EMAIL_VERIFICATION_REQUIRED"), "EMAIL_VERIFICATION_REQUIRED"],
    [new Error("ABN_REVIEW_REQUIRED"), "ABN_REVIEW_REQUIRED"],
    [new Error("INTEGRATION_ENCRYPTION_UNAVAILABLE"), "INTEGRATION_ENCRYPTION_UNAVAILABLE"],
    [new Error("INTEGRATION_CREDENTIALS_INVALID"), "INTEGRATION_CREDENTIALS_INVALID"],
    [new Error(secret, { cause: "INTEGRATION_CREDENTIALS_INVALID" }), "INTEGRATION_CREDENTIALS_INVALID"],
    [new Error(`INTEGRATION_CREDENTIALS_INVALID ${secret}`), "internal"],
    [new Error(secret, { cause: new Error(secret, { cause: new Error("D1_ERROR: nested") }) }), "internal"],
    [new Error(secret, { cause: { message: "D1_ERROR: untrusted object", secret } }), "internal"],
    [unknownName, "internal"],
  ]) {
    const before = routeLogs.length;
    const result = await fixture({ providerError: error }).post();
    assert.equal(result.response.status, 503);
    assert.deepEqual(routeLogs.slice(before), [["Wattzun text turn failed", { phase: "reply", category }]]);
    assert.doesNotMatch(JSON.stringify([routeLogs.slice(before), result.body]), /secret-key|private_customer|secret_table|private-name|untrusted object|nested|business-one|staff-one|Draft a follow-up/);
    assert.equal(result.body.reply, undefined);
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
