import { WattzunInputError, WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES, WATTZUN_VOICE_STREAM_TYPE, WATTZUN_REALTIME_VOICE_STREAM_TYPE, isWattzunPortal, parseWattzunTurn,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurnInput } from "./wattzun-portal";
import { authenticateWattzun, listWattzunScopes, requireWattzunAccess, wattzunAccessFailure,
  WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import { prepareWattzunPortalReply, transcribeWattzunPortalAudio, speakWattzunPortalReply, streamWattzunPortalReply } from "./wattzun-portal-ai-server";
import { prepareWattzunRealtimeTurn, type WattzunRealtimeTimings } from "./wattzun-realtime-server";
import { parseWattzunGreeting } from "./wattzun-greeting";
import { parseWattzunUsageScope, type WattzunUsage } from "./wattzun-usage";
import { readWattzunUsage, recordWattzunUsage, WattzunUsageError, type WattzunUsageRecord } from "./wattzun-usage-server";
import { loadWattzunWorkContext, validateWattzunWorkContext, wattzunWorkContextInfo } from "./wattzun-work-context-server";
import { WattzunWorkContextError, type WattzunWorkContext, type WattzunWorkReference } from "./wattzun-work-context";
import { prepareWattzunWorkflow, prepareWattzunWorkflowForPortal, loadWattzunWorkflowReview, WattzunWorkflowError } from "./wattzun-workflow-server";
import { WattzunFormError } from "./wattzun-form-server";
import { WattzunExistingQuoteError } from "./wattzun-existing-quote-server";
import { isWattzunWorkflowProposal, isWattzunWorkflowResult, type WattzunWorkflowOperation, type WattzunWorkflowResult } from "./wattzun-workflow";
import { wattzunWorkflowReply, isWattzunWorkflowApproval } from "./wattzun-workflow-reply";

type Context = WattzunAccess & { input: WattzunTurnInput; signal?: AbortSignal; workContext?: WattzunWorkContext; workflowContext?: WattzunWorkflowResult };
export type WattzunRouteDependencies = {
  authenticate: (request: Request) => Promise<void>;
  scopes: (request: Request, portal: WattzunPortal) => Promise<WattzunScope[]>;
  access: (request: Request, portal: WattzunPortal, scopeId: string) => Promise<WattzunAccess>;
  context: (request: Request, access: WattzunAccess, reference: WattzunWorkReference) => Promise<WattzunWorkContext>;
  reply: (options: Context) => Promise<WattzunReply>;
  transcribe: (options: Context & { audio: Blob }) => Promise<string>;
  speak: (options: Context & { reply: WattzunReply }) => Promise<{ base64: string; mimeType: "audio/mpeg" }>;
  streamSpeak: (options: Context & { reply: WattzunReply }) => Promise<ReadableStream<Uint8Array>>;
  realtime: (options: Context & { audio: Blob; beforeSpeech: () => Promise<void>; transformReply?: (reply: WattzunReply, requestSummary: string) => Promise<WattzunReply> }) => Promise<{ reply: WattzunReply; audio: ReadableStream<Uint8Array>; transcript?: string; requestSummary?: string; timings?: WattzunRealtimeTimings }>;
  prepareWorkflow?: typeof prepareWattzunWorkflow;
  prepareProposedWorkflow?: typeof prepareWattzunWorkflow;
  workflowReview?: typeof loadWattzunWorkflowReview;
  recordUsage: (options: WattzunUsageRecord) => Promise<void>;
  usage: (access: WattzunAccess) => Promise<WattzunUsage>;
};
const defaults: WattzunRouteDependencies = {
  authenticate: authenticateWattzun, scopes: listWattzunScopes, access: requireWattzunAccess,
  context: loadWattzunWorkContext,
  reply: prepareWattzunPortalReply, transcribe: transcribeWattzunPortalAudio, speak: speakWattzunPortalReply, streamSpeak: streamWattzunPortalReply,
  realtime: prepareWattzunRealtimeTurn,
  prepareWorkflow: prepareWattzunWorkflow, prepareProposedWorkflow: prepareWattzunWorkflowForPortal, workflowReview: loadWattzunWorkflowReview,
  recordUsage: recordWattzunUsage, usage: readWattzunUsage,
};
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(body: object, status = 200) { return Response.json(body, { status, headers }); }
function turnTimer() {
  const started = performance.now();
  const durations = new Map<"auth" | "access" | "stt" | "llm" | "tts" | "realtime" | "usage" | keyof WattzunRealtimeTimings, number>();
  return {
    provider(stage: string, duration: unknown) {
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 55_000) return;
      switch (stage) {
        case "rt_guard": case "rt_connect": case "rt_config": case "rt_proposal":
        case "rt_validate": case "rt_approval": case "rt_first_argument": durations.set(stage, duration);
      }
    },
    async run<T>(stage: "auth" | "access" | "stt" | "llm" | "tts" | "realtime" | "usage", operation: () => Promise<T>): Promise<T> {
      const before = performance.now();
      try { return await operation(); }
      finally { durations.set(stage, (durations.get(stage) || 0) + Math.max(0, performance.now() - before)); }
    },
    response(response: Response) {
      // Timings expose only bounded stage names and durations, never records or provider credentials.
      response.headers.set("Server-Timing", [...durations].map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
        .concat(`total;dur=${Math.max(0, performance.now() - started).toFixed(1)}`).join(", "));
      return response;
    },
  };
}
function failure(error: unknown) {
  if (error instanceof WattzunWorkflowError || error instanceof WattzunExistingQuoteError || error instanceof WattzunFormError) return json({ ok: false, error: error.message }, error.status);
  if (error instanceof WattzunWorkContextError) return json({ ok: false, error: error.message }, error.status);
  if (error instanceof WattzunUsageError) return json({ ok: false, error: error.code === "conflict"
    ? "This request was already used for a different Wattzun exchange. Start a new turn."
    : "Wattzun usage could not be saved or loaded. Please try again." }, error.code === "conflict" ? 409 : 503);
  const access = wattzunAccessFailure(error);
  if (access) return json({ ok: false, error: access.message }, access.status);
  if (error instanceof WattzunInputError || error instanceof SyntaxError) return json({ ok: false,
    error: error instanceof WattzunInputError ? error.message : "The request could not be read. Try again." }, 400);
  const code = error instanceof Error ? error.message : "";
  if (code === "WORKFLOW_AI_LIMIT" || code === "WATTZUN_USAGE_LIMIT") return json({ ok: false, error: "Wattzun has reached its usage limit. Try again later." }, 429);
  if (code === "WATTZUN_SPEECH_UNCLEAR") return json({ ok: false, error: "I could not hear that clearly. Please say it again, or type your question." }, 422);
  return json({ ok: false, error: "Wattzun could not complete this turn. Your records have not changed. Try again, or continue by typing." }, 503);
}
function failureCategory(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  // Inspect only the error and its immediate cause. Never emit their contents.
  const messages = [error, cause].flatMap(value => value instanceof Error ? [value.message.slice(0, 4096)]
    : typeof value === "string" ? [value.slice(0, 4096)] : []);
  if (messages.some(message => /\btoo[_ -]many[_ -](?:api[_ -]requests|subrequests)\b|\b(?:subrequest|api request) limit\b|\bexceeded (?:the )?(?:maximum number of )?(?:subrequests|api requests)\b/i.test(message))) return "api_request_limit";
  if (messages.some(message => /\bcannot perform I\/O on behalf of a different request\b/i.test(message))) return "different_request_io";
  if (messages.some(message => /\b(?:CPU(?: time)?|compute) limit\b/i.test(message))) return "cpu_limit";
  if (messages.some(message => /\bD1(?: DB)?(?: is)? overloaded\b/i.test(message)
    || /\bD1(?:_ERROR|_EXEC_ERROR| DB)?\b/i.test(message) && /\btoo[_ -]many[_ -]requests\b/i.test(message))) return "database_overloaded";
  if (messages.some(message => /\bD1(?:'s)? (?:free tier )?daily row (?:read|write) limit\b|\bD1(?: database)? (?:query |row |daily )?quota\b|\bD1(?:'s)? maximum account storage limit\b/i.test(message))) return "database_quota";
  if (messages.some(message => /^(?:D1_(?:ERROR|EXEC_ERROR|TYPE_ERROR|COLUMN_NOTFOUND)|SQLITE_(?:ERROR|BUSY|LOCKED|IOERR|CORRUPT|FULL|CANTOPEN))\b/.test(message))) return "database_error";
  if ([error, cause].some(value => value instanceof Error && value.name === "AbortError")) return "aborted";
  const codes = new Set(["WORKFLOW_AI_UNAVAILABLE", "WORKFLOW_AI_INCOMPLETE", "WORKFLOW_AI_INPUT_LIMIT", "AUTH_REQUIRED",
    "EMAIL_VERIFICATION_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "BUSINESS_ACCESS_REQUIRED",
    "BUSINESS_SELECTION_REQUIRED", "INTEGRATION_ENCRYPTION_UNAVAILABLE", "INTEGRATION_CREDENTIALS_INVALID"]);
  return messages.find(message => codes.has(message)) || "internal";
}
function acceptedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
async function boundedBody(request: Request, maximum: number): Promise<ArrayBuffer | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) return null;
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); return null; }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes.buffer;
}
async function recheck(request: Request, previous: WattzunAccess, deps: WattzunRouteDependencies) {
  requireOpenConversation(request);
  const latest = await deps.access(request, previous.scope.portal, previous.scope.scopeId);
  requireOpenConversation(request);
  if (latest.actorUid !== previous.actorUid || latest.scope.scopeId !== previous.scope.scopeId
    || latest.scope.portal !== previous.scope.portal || latest.scope.label !== previous.scope.label) {
    throw new WattzunAccessError(403, "Your workspace changed. Refresh before continuing with Wattzun.");
  }
  return latest;
}
function requireOpenConversation(request: Request) {
  if (request.signal.aborted) throw new WattzunAccessError(409, "The conversation was closed. Start again to continue.");
}
async function selectedContext(request: Request, access: WattzunAccess, input: WattzunTurnInput, deps: WattzunRouteDependencies) {
  if (!input.workReference) return undefined;
  requireOpenConversation(request);
  const context = await deps.context(request, access, input.workReference);
  requireOpenConversation(request);
  validateWattzunWorkContext(context, access, input.workReference);
  return context;
}
async function recheckTurn(request: Request, access: WattzunAccess, input: WattzunTurnInput, context: WattzunWorkContext | undefined, deps: WattzunRouteDependencies) {
  const latest = await recheck(request, access, deps);
  if (context) {
    const refreshed = await selectedContext(request, latest, input, deps);
    if (!refreshed || refreshed.sourceSha256 !== context.sourceSha256) {
      throw new WattzunWorkContextError(409, "This work item changed while Wattzun was answering. Ask again to use its current details. Your call can continue.");
    }
  }
  return latest;
}
function withContext(reply: WattzunReply, context?: WattzunWorkContext): WattzunReply {
  return context ? { ...reply, workContext: wattzunWorkContextInfo(context) } : reply;
}
type WorkflowTurn = { result?: WattzunWorkflowResult; proposal?: WattzunWorkflowOperation };
function selectedWorkflowJob(proposal: WattzunWorkflowOperation, context?: WattzunWorkContext): WattzunWorkflowOperation {
  if (!("jobId" in proposal) || proposal.jobId || context?.reference.kind !== "trade_job") return proposal;
  // Another suburb, customer, date or job clue must be resolved on its own merits.
  const query = proposal.jobQuery.trim();
  if (query && !/^(?:(?:for|on) )?(?:this|that|the selected|the current|selected|current) (?:job|quote)(?: here)?[.!]?$/i.test(query)) return proposal;
  return { ...proposal, jobId: context.reference.recordId };
}
async function preparedWorkflow(request: Request, access: WattzunAccess, input: WattzunTurnInput, proposal: WattzunWorkflowOperation, deps: WattzunRouteDependencies,
  prepare = deps.prepareWorkflow) {
  requireOpenConversation(request);
  if (!prepare) throw new WattzunWorkflowError(503, "The workflow preparation service is unavailable. Try again.");
  const result = await prepare(request, access, proposal, input.requestId);
  requireOpenConversation(request);
  if (!isWattzunWorkflowResult(result)) throw new WattzunWorkflowError(503, "The prepared workflow could not be read. Prepare it again.");
  return result;
}
async function reviewedWorkflow(request: Request, access: WattzunAccess, reviewId: string, deps: WattzunRouteDependencies) {
  requireOpenConversation(request);
  if (!deps.workflowReview) throw new WattzunWorkflowError(503, "The workflow review service is unavailable. Try again.");
  const result = await deps.workflowReview(request, access, reviewId);
  requireOpenConversation(request);
  if (!isWattzunWorkflowResult(result) || (result.state !== "review" && result.state !== "complete")
    || result.state === "review" && result.reviewId !== reviewId) throw new WattzunWorkflowError(503, "The current workflow review could not be read. Prepare it again.");
  return result;
}
async function initialWorkflow(request: Request, access: WattzunAccess, input: WattzunTurnInput, context: WattzunWorkContext | undefined, deps: WattzunRouteDependencies): Promise<WorkflowTurn> {
  if (input.workflowReviewId) return { result: await reviewedWorkflow(request, access, input.workflowReviewId, deps) };
  if (!input.workflowProposal) return {};
  const proposal = selectedWorkflowJob(input.workflowProposal, context);
  return { proposal, result: await preparedWorkflow(request, access, input, proposal, deps) };
}
async function processWorkflowReply(request: Request, access: WattzunAccess, input: WattzunTurnInput, context: WattzunWorkContext | undefined,
  reply: WattzunReply, workflow: WorkflowTurn, deps: WattzunRouteDependencies, requestSummary?: string): Promise<WattzunReply> {
  if (input.workflowReviewId && workflow.result?.state === "complete") {
    return wattzunWorkflowReply({ ...reply, action: null, lookup: null }, workflow.result);
  }
  if (!isWattzunWorkflowProposal(reply.action)) return workflow.result ? { ...reply, workflow: workflow.result } : reply;
  // Preparation checks its exact current target. Keep the selected-source checks
  // at the existing speech, usage and response handoff boundaries.
  const currentAccess = await recheck(request, access, deps);
  if (reply.action.kind === "confirm_workflow") {
    if (workflow.result?.state !== "review" || reply.action.reviewId !== workflow.result.reviewId) throw new WattzunWorkflowError(409, "Approve only the current workflow review. Prepare it again if the details changed.");
    if (!isWattzunWorkflowApproval(input.message || requestSummary || "")) throw new WattzunWorkflowError(400, "Please explicitly confirm this current review before it can be saved or sent.");
    const current = await reviewedWorkflow(request, currentAccess, reply.action.reviewId, deps);
    if (current.state !== "review") throw new WattzunWorkflowError(409, "This review already has a result. Check it before submitting another action.");
    workflow.result = current;
    return { ...reply, kind: "answer", message: "I will submit this reviewed task now.", questions: [], workflow: current };
  }
  const proposal = selectedWorkflowJob(reply.action, context);
  workflow.proposal = proposal;
  // Only a new model proposal can defer its redundant source rebuild. Pending
  // input stays strict before the provider; final text/audio checks stay strict.
  workflow.result = await preparedWorkflow(request, currentAccess, input, proposal, deps, deps.prepareProposedWorkflow ?? deps.prepareWorkflow);
  return wattzunWorkflowReply({ ...reply, action: proposal }, workflow.result);
}
async function recheckWorkflow(request: Request, access: WattzunAccess, input: WattzunTurnInput, workflow: WorkflowTurn, deps: WattzunRouteDependencies) {
  if (!workflow.result) return;
  const fresh = workflow.result.state === "review"
    ? await reviewedWorkflow(request, access, workflow.result.reviewId, deps)
    : input.workflowReviewId ? await reviewedWorkflow(request, access, input.workflowReviewId, deps)
      : workflow.proposal ? await preparedWorkflow(request, access, input, workflow.proposal, deps) : undefined;
  if (!fresh || JSON.stringify(fresh) !== JSON.stringify(workflow.result)) throw new WattzunWorkflowError(409, "This workflow changed while Wattzun was answering. Check the current review or result before continuing.");
}
export async function getWattzunPortal(request: Request, deps = defaults): Promise<Response> {
  try {
    await deps.authenticate(request);
    const portal = new URL(request.url).searchParams.get("portal");
    if (!isWattzunPortal(portal)) throw new WattzunInputError("Choose Council, Creditex or TLink.");
    return json({ ok: true, scopes: await deps.scopes(request, portal) });
  } catch (error) { return failure(error); }
}
export async function getWattzunUsage(request: Request, deps = defaults): Promise<Response> {
  try {
    await deps.authenticate(request);
    const scope = parseWattzunUsageScope(new URL(request.url));
    const access = await deps.access(request, scope.portal, scope.scopeId);
    if (access.scope.portal !== scope.portal || access.scope.scopeId !== scope.scopeId) {
      throw new WattzunAccessError(403, "Choose a workspace you have current access to.");
    }
    requireOpenConversation(request);
    const usage = await deps.usage(access);
    await recheck(request, access, deps);
    return json({ ok: true, usage });
  } catch (error) { return failure(error); }
}
export async function postWattzunPortal(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Send your question as JSON." }, 415);
  }
  const timing = turnTimer();
  let phase: "auth" | "input" | "context" | "pending_workflow" | "reply" | "workflow" | "recheck" | "usage" | "final_scope_source" | "final_workflow" = "auth";
  try {
    await timing.run("auth", () => deps.authenticate(request));
    requireOpenConversation(request);
    phase = "input";
    const bytes = await boundedBody(request, 40_000);
    if (!bytes) return json({ ok: false, error: "The conversation is too large. Start a new conversation." }, 413);
    const input = parseWattzunTurn(JSON.parse(new TextDecoder().decode(bytes)));
    phase = "context";
    const access = await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    requireOpenConversation(request);
    const workContext = await timing.run("access", () => selectedContext(request, access, input, deps));
    phase = "pending_workflow";
    const workflow = await timing.run("access", () => initialWorkflow(request, access, input, workContext, deps));
    phase = "reply";
    const rawReply = await timing.run("llm", () => deps.reply({ ...access, input, workContext, workflowContext: workflow.result, signal: request.signal }));
    phase = "workflow";
    const reply = await timing.run("access", () => processWorkflowReply(request, access, input, workContext, rawReply, workflow, deps));
    phase = "recheck";
    const latest = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
    phase = "usage";
    await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "text" }));
    phase = "final_scope_source";
    const finalAccess = await timing.run("access", () => recheckTurn(request, latest, input, workContext, deps));
    phase = "final_workflow";
    await timing.run("access", () => recheckWorkflow(request, finalAccess, input, workflow, deps));
    return timing.response(json({ ok: true, reply: withContext(reply, workContext) }));
  } catch (error) {
    const response = failure(error);
    if (response.status >= 500) {
      console.warn("Wattzun text turn failed", { phase, category: failureCategory(error) });
    }
    return timing.response(response);
  }
}
export async function postWattzunVoice(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return json({ ok: false, error: "Send a recorded voice turn." }, 415);
  const timing = turnTimer();
  const realtime = request.headers.get("accept") === WATTZUN_REALTIME_VOICE_STREAM_TYPE;
  const maximumAudio = realtime ? WATTZUN_MAX_WAV_AUDIO_BYTES : WATTZUN_MAX_AUDIO_BYTES;
  let speechStream: ReadableStream<Uint8Array> | undefined;
  let handedOff = false;
  try {
    await timing.run("auth", () => deps.authenticate(request));
    requireOpenConversation(request);
    const bytes = await boundedBody(request, maximumAudio + 50_000);
    if (!bytes) return json({ ok: false, error: "That voice turn is too large. Keep it under 45 seconds." }, 413);
    const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    const raw = form.get("request");
    const audio = form.get("audio");
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 40_000 || !(audio instanceof Blob)
      || audio.size < 100 || audio.size > maximumAudio
      || !/^audio\/(webm|mp4|mpeg|wav|ogg)(;codecs=[a-zA-Z0-9., -]+)?$/.test(audio.type)) {
      throw new WattzunInputError(realtime ? "Use a supported native microphone recording under 45 seconds." : "Use a supported microphone recording smaller than 2 MB.");
    }
    if (realtime && audio.type !== "audio/wav") throw new WattzunInputError("Use a native microphone recording for this voice call.");
    const input = parseWattzunTurn(JSON.parse(raw), true);
    const access = await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    requireOpenConversation(request);
    const workContext = await timing.run("access", () => selectedContext(request, access, input, deps));
    const workflow = await timing.run("access", () => initialWorkflow(request, access, input, workContext, deps));
    if (realtime) {
      const prepared = await timing.run("realtime", () => deps.realtime({ ...access, input, workContext, workflowContext: workflow.result, audio, signal: request.signal,
        transformReply: async (reply, summary) => timing.run("access", () => processWorkflowReply(request, access, input, workContext, reply, workflow, deps, summary)),
        beforeSpeech: async () => {
          const current = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
          await timing.run("access", () => recheckWorkflow(request, current, input, workflow, deps));
        } }));
      speechStream = prepared.audio;
      for (const [stage, duration] of Object.entries(prepared.timings || {})) timing.provider(stage, duration);
      const latest = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
      await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
      const finalAccess = await timing.run("access", () => recheckTurn(request, latest, input, workContext, deps));
      await timing.run("access", () => recheckWorkflow(request, finalAccess, input, workflow, deps));
      const response = timing.response(new Response(voiceFrames(prepared.transcript || "", withContext(prepared.reply, workContext), speechStream, request.signal, prepared.requestSummary),
        { headers: { ...headers, "Content-Type": WATTZUN_REALTIME_VOICE_STREAM_TYPE } }));
      handedOff = true;
      return response;
    }
    const transcript = await timing.run("stt", () => deps.transcribe({ ...access, input, audio, signal: request.signal }));
    await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
    const spokenInput = { ...input, message: transcript };
    const rawReply = await timing.run("llm", () => deps.reply({ ...access, input: spokenInput, workContext, workflowContext: workflow.result, signal: request.signal }));
    const reply = await timing.run("access", () => processWorkflowReply(request, access, spokenInput, workContext, rawReply, workflow, deps));
    const speechAccess = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
    await timing.run("access", () => recheckWorkflow(request, speechAccess, input, workflow, deps));
    // Existing open calls retain JSON/MP3 until they reload. New clients negotiate PCM frames.
    if (request.headers.get("accept") === WATTZUN_VOICE_STREAM_TYPE) {
      speechStream = await timing.run("tts", () => deps.streamSpeak({ ...access, input: spokenInput, workContext, workflowContext: workflow.result, reply, signal: request.signal }));
      const latest = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
      await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
      const finalAccess = await timing.run("access", () => recheckTurn(request, latest, input, workContext, deps));
      await timing.run("access", () => recheckWorkflow(request, finalAccess, input, workflow, deps));
      const response = timing.response(new Response(voiceFrames(transcript, withContext(reply, workContext), speechStream, request.signal),
        { headers: { ...headers, "Content-Type": WATTZUN_VOICE_STREAM_TYPE } }));
      handedOff = true;
      return response;
    }
    const speech = await timing.run("tts", () => deps.speak({ ...access, input: spokenInput, workContext, workflowContext: workflow.result, reply, signal: request.signal }));
    const latest = await timing.run("access", () => recheckTurn(request, access, input, workContext, deps));
    await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
    const finalAccess = await timing.run("access", () => recheckTurn(request, latest, input, workContext, deps));
    await timing.run("access", () => recheckWorkflow(request, finalAccess, input, workflow, deps));
    return timing.response(json({ ok: true, transcript, reply: withContext(reply, workContext), audio: speech }));
  } catch (error) { return timing.response(failure(error)); }
  finally { if (speechStream && !handedOff) await speechStream.cancel().catch(() => {}); }
}

/** A fixed connection greeting uses the brand voice without a conversation/model turn. */
export async function postWattzunGreeting(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Send the call greeting as JSON." }, 415);
  }
  const timing = turnTimer();
  let audio: ReadableStream<Uint8Array> | undefined;
  let handedOff = false;
  try {
    await timing.run("auth", () => deps.authenticate(request));
    requireOpenConversation(request);
    const bytes = await boundedBody(request, 2_000);
    if (!bytes) return json({ ok: false, error: "The call greeting is too large." }, 413);
    const input = parseWattzunGreeting(JSON.parse(new TextDecoder().decode(bytes)));
    const access = await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    requireOpenConversation(request);
    const reply: WattzunReply = { kind: "answer", message: input.message, questions: [], links: [] };
    audio = await timing.run("tts", () => deps.streamSpeak({ ...access, input, reply, signal: request.signal }));
    await timing.run("access", () => recheck(request, access, deps));
    requireOpenConversation(request);
    // The provider cost guard meters speech. Connection greetings are not answered user questions.
    const response = timing.response(new Response(voiceFrames("", reply, audio, request.signal),
      { headers: { ...headers, "Content-Type": WATTZUN_REALTIME_VOICE_STREAM_TYPE } }));
    handedOff = true;
    return response;
  } catch (error) { return timing.response(failure(error)); }
  finally { if (audio && !handedOff) await audio.cancel().catch(() => {}); }
}

/** Narrate only the current application receipt after a separately confirmed action. */
export async function postWattzunWorkflowSpeech(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the current workflow receipt request as JSON." }, 415);
  const timing = turnTimer(); let audio: ReadableStream<Uint8Array> | undefined; let handedOff = false;
  try {
    await timing.run("auth", () => deps.authenticate(request)); requireOpenConversation(request);
    const bytes = await boundedBody(request, 2_000);
    if (!bytes) return json({ ok: false, error: "The workflow receipt request is too large." }, 413);
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const keys = ["portal", "scopeId", "requestId", "workflowReviewId", "preferences"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) throw new WattzunInputError("Send only the current TLink workflow receipt reference.");
    const portal = Reflect.get(raw, "portal"); const preferences: unknown = Reflect.get(raw, "preferences");
    if (portal !== "trade" || !preferences || typeof preferences !== "object" || Array.isArray(preferences) || Object.keys(preferences).some(key => key !== "speed")) throw new WattzunInputError("Choose your TLink business and a supported speaking speed.");
    const input = parseWattzunTurn({ portal, scopeId: Reflect.get(raw, "scopeId"), requestId: Reflect.get(raw, "requestId"),
      workflowReviewId: Reflect.get(raw, "workflowReviewId"), preferences, history: [], message: "Read the current verified workflow receipt." });
    if (!input.workflowReviewId) throw new WattzunInputError("Choose the current completed workflow review.");
    const reviewId = input.workflowReviewId;
    const access = await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    if (access.scope.portal !== input.portal || access.scope.scopeId !== input.scopeId) throw new WattzunAccessError(403, "Choose the TLink business that owns this workflow receipt.");
    requireOpenConversation(request);
    const result = await timing.run("access", () => reviewedWorkflow(request, access, reviewId, deps));
    if (result.state !== "complete") throw new WattzunWorkflowError(409, "This workflow has no completed result to read yet. Review its current status first.");
    const reply = wattzunWorkflowReply({ kind: "answer", message: "", questions: [], links: [], action: null }, result);
    audio = await timing.run("tts", () => deps.streamSpeak({ ...access, input, reply, workflowContext: result, signal: request.signal }));
    const latest = await timing.run("access", () => recheck(request, access, deps));
    const refreshed = await timing.run("access", () => reviewedWorkflow(request, latest, reviewId, deps));
    if (JSON.stringify(refreshed) !== JSON.stringify(result)) throw new WattzunWorkflowError(409, "The workflow receipt changed. Read its current result again.");
    requireOpenConversation(request);
    // Speech has the normal provider cost guard; a receipt is not another answered question.
    const response = timing.response(new Response(voiceFrames("", reply, audio, request.signal), {
      headers: { ...headers, "Content-Type": WATTZUN_REALTIME_VOICE_STREAM_TYPE },
    }));
    handedOff = true; return response;
  } catch (error) { return timing.response(failure(error)); }
  finally { if (audio && !handedOff) await audio.cancel().catch(() => {}); }
}

function voiceFrames(transcript: string, reply: WattzunReply, audio: ReadableStream<Uint8Array>, signal: AbortSignal, requestSummary?: string) {
  const reader = audio.getReader(), encoder = new TextEncoder();
  let header = true, offset = 0;
  let buffered: Uint8Array = new Uint8Array(0);
  const encode = (value: object) => encoder.encode(JSON.stringify(value) + "\n");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        if (header) { header = false; controller.enqueue(encode({ type: "reply", transcript, reply, ...(requestSummary ? { requestSummary } : {}) })); return; }
        while (offset >= buffered.byteLength) {
          const next = await reader.read(); signal.throwIfAborted();
          if (next.done) { controller.enqueue(encode({ type: "done" })); controller.close(); reader.releaseLock(); return; }
          buffered = next.value; offset = 0;
        }
        const chunk = buffered.subarray(offset, offset + 32_000); offset += chunk.byteLength;
        controller.enqueue(encode({ type: "audio", data: btoa(String.fromCharCode(...chunk)) }));
      } catch { await reader.cancel().catch(() => {}); controller.error(new Error("Wattzun audio stopped before the reply finished.")); }
    },
    async cancel() { await reader.cancel().catch(() => {}); },
  }, { highWaterMark: 0 });
}
