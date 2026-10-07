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
import { prepareWattzunWorkflow, prepareWattzunWorkflowForPortal, loadWattzunWorkflowReview,
  prepareWattzunWorkflowForTurn, verifyWattzunWorkflowForTurn, loadWattzunWorkflowReviewForTurn,
  executeWattzunGuidedFormForTurn, recoverWattzunGuidedFormForTurn, WattzunWorkflowError, WattzunGuidedFormValidationError } from "./wattzun-workflow-server";
import { readWattzunTurnAuthority, requireWattzunTurnTeam, type WattzunTurnAuthority } from "./wattzun-turn-authority-server";
import { WattzunFormError, loadWattzunFormGuideForTurn, controlWattzunFormGuideForTurn, searchWattzunFormProductsForTurn } from "./wattzun-form-server";
import { readWattzunFormProductSearchAction } from "./wattzun-form-step";
import { readWattzunFormGuideControl, readWattzunFormGuideProgress, wattzunFormGuideNarration,
  type WattzunFormGuideInput, type WattzunFormGuideProgress } from "./wattzun-form-guide";
import { WattzunExistingQuoteError } from "./wattzun-existing-quote-server";
import { isWattzunWorkflowProposal, isWattzunWorkflowResult, type WattzunWorkflowOperation, type WattzunWorkflowResult } from "./wattzun-workflow";
import { wattzunWorkflowReply, isWattzunWorkflowApproval, isWattzunFormCompletionApproval, isWattzunFormStepApproval } from "./wattzun-workflow-reply";

type Context = WattzunAccess & { input: WattzunTurnInput; signal?: AbortSignal; workContext?: WattzunWorkContext; workflowContext?: WattzunWorkflowResult; formGuideProgress?: WattzunFormGuideProgress };
export type WattzunRouteDependencies = {
  authenticate: (request: Request) => Promise<void>;
  scopes: (request: Request, portal: WattzunPortal) => Promise<WattzunScope[]>;
  access: (request: Request, portal: WattzunPortal, scopeId: string) => Promise<WattzunAccess>;
  turnAuthority: typeof readWattzunTurnAuthority;
  context: (request: Request, access: WattzunAccess, reference: WattzunWorkReference) => Promise<WattzunWorkContext>;
  reply: (options: Context) => Promise<WattzunReply>;
  transcribe: (options: Context & { audio: Blob }) => Promise<string>;
  speak: (options: Context & { reply: WattzunReply }) => Promise<{ base64: string; mimeType: "audio/mpeg" }>;
  streamSpeak: (options: Context & { reply: WattzunReply }) => Promise<ReadableStream<Uint8Array>>;
  realtime: (options: Context & { audio: Blob; beforeSpeech: () => Promise<void>; transformReply?: (reply: WattzunReply, requestSummary: string) => Promise<WattzunReply> }) => Promise<{ reply: WattzunReply; audio: ReadableStream<Uint8Array>; transcript?: string; requestSummary?: string; timings?: WattzunRealtimeTimings }>;
  prepareWorkflow?: typeof prepareWattzunWorkflow;
  prepareProposedWorkflow?: typeof prepareWattzunWorkflow;
  workflowReview?: typeof loadWattzunWorkflowReview;
  prepareTurnWorkflow: typeof prepareWattzunWorkflowForTurn;
  verifyTurnWorkflow: typeof verifyWattzunWorkflowForTurn;
  reviewTurnWorkflow: typeof loadWattzunWorkflowReviewForTurn;
  guide: typeof loadWattzunFormGuideForTurn;
  guideControl: typeof controlWattzunFormGuideForTurn;
  searchFormProducts: typeof searchWattzunFormProductsForTurn;
  executeGuidedForm: typeof executeWattzunGuidedFormForTurn;
  recoverGuidedForm: typeof recoverWattzunGuidedFormForTurn;
  recordUsage: (options: WattzunUsageRecord) => Promise<void>;
  usage: (access: WattzunAccess) => Promise<WattzunUsage>;
};
const defaults: WattzunRouteDependencies = {
  authenticate: authenticateWattzun, scopes: listWattzunScopes, access: requireWattzunAccess,
  turnAuthority: readWattzunTurnAuthority,
  context: loadWattzunWorkContext,
  reply: prepareWattzunPortalReply, transcribe: transcribeWattzunPortalAudio, speak: speakWattzunPortalReply, streamSpeak: streamWattzunPortalReply,
  realtime: prepareWattzunRealtimeTurn,
  prepareWorkflow: prepareWattzunWorkflow, prepareProposedWorkflow: prepareWattzunWorkflowForPortal, workflowReview: loadWattzunWorkflowReview,
  prepareTurnWorkflow: prepareWattzunWorkflowForTurn, verifyTurnWorkflow: verifyWattzunWorkflowForTurn, reviewTurnWorkflow: loadWattzunWorkflowReviewForTurn,
  guide: loadWattzunFormGuideForTurn, guideControl: controlWattzunFormGuideForTurn,
  searchFormProducts: searchWattzunFormProductsForTurn,
  executeGuidedForm: executeWattzunGuidedFormForTurn, recoverGuidedForm: recoverWattzunGuidedFormForTurn,
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
  return json({ ok: false, error: "Wattzun could not confirm this turn. Check the same task before starting another action." }, 503);
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
type GuideTurn = { context: WattzunWorkContext; guide: WattzunFormGuideProgress; input: WattzunFormGuideInput };
type WorkflowTurn = { result?: WattzunWorkflowResult; proposal?: WattzunWorkflowOperation; guide?: GuideTurn; guidedReviewId?: string };
function resumeGuideInput(input: WattzunFormGuideInput): WattzunFormGuideInput {
  return { sessionId: input.sessionId, stage: "resume", authorization: "ordinary_form_answers", skippedFieldKeys: input.skippedFieldKeys,
    ...(input.paused ? { paused: true } : {}), ...(input.productSearch ? { productSearch: input.productSearch } : {}) };
}
function afterSavedGuideInput(input: WattzunFormGuideInput, deferredFieldKeys: string[]): WattzunFormGuideInput {
  const skippedFieldKeys = [...new Set([...input.skippedFieldKeys, ...deferredFieldKeys])];
  if (skippedFieldKeys.length > 100) throw new WattzunFormError(409, "The answer is saved. Review the skipped questions before adding further deferrals.");
  return { ...resumeGuideInput(input), skippedFieldKeys };
}
async function loadTurnGuide(request: Request, authority: WattzunTurnAuthority, input: WattzunTurnInput,
  guideInput: WattzunFormGuideInput, deps: WattzunRouteDependencies): Promise<GuideTurn> {
  if (input.workReference?.kind !== "trade_form") throw new WattzunInputError("Open the current form before starting its questions.");
  requireOpenConversation(request);
  const loaded = await deps.guide(request, authority.access, input.workReference, guideInput, requireWattzunTurnTeam(authority));
  const guide = readWattzunFormGuideProgress(loaded.guide);
  if (!guide || guide.sessionId !== guideInput.sessionId || JSON.stringify(guide.requestedReference) !== JSON.stringify(input.workReference)
    || JSON.stringify(guide.reference) !== JSON.stringify(loaded.context.reference) || guide.sourceSha256 !== loaded.context.sourceSha256) throw new WattzunFormError(503, "The current form question could not be verified. Resume the form to continue.");
  validateWattzunWorkContext(loaded.context, authority.access, guide.reference);
  requireOpenConversation(request);
  return { context: loaded.context, guide, input: guideInput };
}
function guideReply(reply: WattzunReply, state: GuideTurn, requestId: string, result?: WattzunWorkflowResult): WattzunReply {
  return { ...reply, action: null, lookup: null, formGuide: state.guide,
    formGuideRecovery: { requestId, state: result?.state === "complete" ? "saved" : "not_saved" },
    ...(result ? { workflow: result } : {}), workContext: wattzunWorkContextInfo(state.context) };
}
function recoveredGuideNarration(guide: WattzunFormGuideProgress, result?: WattzunWorkflowResult): string {
  return `${result?.state === "complete" && result.receipt.kind === "form_step" ? `${result.receipt.message} ` : ""}${wattzunFormGuideNarration(guide)}`;
}
async function processGuidedReply(request: Request, authority: WattzunTurnAuthority, input: WattzunTurnInput,
  reply: WattzunReply, workflow: WorkflowTurn, currentRequest: string, deps: WattzunRouteDependencies): Promise<WattzunReply> {
  const state = workflow.guide;
  if (!state || !input.formGuide || input.workReference?.kind !== "trade_form") throw new WattzunFormError(409, "Resume the current form questions before continuing.");
  const search = readWattzunFormProductSearchAction(reply.action);
  if (search) {
    if (state.input.stage !== "continue" || state.input.paused || state.input.pendingRequestId || state.guide.next?.step?.kind !== "official_product") throw new WattzunFormError(409, "Resume the current official product question before searching.");
    const searchInput = { ...state.input, sourceSha256: state.guide.sourceSha256, questionKey: state.guide.next.fieldKey };
    const loaded = await deps.searchFormProducts(request, authority.access, input.workReference, searchInput, search, requireWattzunTurnTeam(authority));
    const searchedInput = { ...resumeGuideInput(state.input), productSearch: loaded.guide.productSearch };
    workflow.guide = await loadTurnGuide(request, authority, input, searchedInput, deps);
    return guideReply({ ...reply, kind: "clarification", message: wattzunFormGuideNarration(workflow.guide.guide), questions: [] }, workflow.guide, input.requestId);
  }
  const control = readWattzunFormGuideControl(reply.action);
  if (control && control.command !== "complete") {
    const controlInput = { ...state.input, stage: "continue" as const, sourceSha256: state.guide.sourceSha256, questionKey: state.guide.next?.fieldKey || "" };
    const loaded = await deps.guideControl(request, authority.access, input.workReference, controlInput, control, requireWattzunTurnTeam(authority));
    const guide = readWattzunFormGuideProgress(loaded.guide);
    if (!guide || guide.sessionId !== state.guide.sessionId || JSON.stringify(guide.requestedReference) !== JSON.stringify(input.workReference)
      || JSON.stringify(guide.reference) !== JSON.stringify(loaded.context.reference) || guide.sourceSha256 !== state.guide.sourceSha256) throw new WattzunFormError(409, "The form question changed. Resume it before continuing.");
    validateWattzunWorkContext(loaded.context, authority.access, guide.reference);
    workflow.guide = { ...state, ...loaded, guide, input: { ...resumeGuideInput(state.input), skippedFieldKeys: guide.skippedFieldKeys, paused: guide.state === "paused" } };
    return guideReply({ ...reply, kind: "answer", message: wattzunFormGuideNarration(guide), questions: [] }, workflow.guide, input.requestId);
  }
  const operation = isWattzunWorkflowProposal(reply.action) && (reply.action.kind === "fill_form" || reply.action.kind === "complete_form" || reply.action.kind === "form_step") ? reply.action : undefined;
  const proposal = control?.command === "complete" ? { kind: "complete_form" as const, jobQuery: "", jobId: state.guide.reference.jobId, formKind: state.guide.reference.formKind, formId: state.guide.recordId } : operation;
  if (!proposal) return guideReply(reply, state, input.requestId);
  if (state.input.stage !== "continue" || state.input.paused) throw new WattzunFormError(409, "Resume the current form question before saving an answer.");
  if (state.input.pendingRequestId) throw new WattzunFormError(409, "Check the previous answer's saved result before answering another question.");
  if (proposal.kind === "complete_form" && (state.guide.state !== "ready_to_complete" || !isWattzunFormCompletionApproval(currentRequest))) throw new WattzunFormError(400, "Please confirm completion separately once this form is ready.");
  const executionInput = { ...state.input, stage: "continue" as const, sourceSha256: state.guide.sourceSha256, questionKey: proposal.kind === "complete_form" ? "" : state.guide.next?.fieldKey || "" };
  let executed: Awaited<ReturnType<WattzunRouteDependencies["executeGuidedForm"]>>;
  try {
    if (proposal.kind === "form_step" && (state.guide.state !== "question" || !state.guide.next?.step || !isWattzunFormStepApproval(currentRequest, proposal.step, state.guide.next.step))) throw new WattzunGuidedFormValidationError(400, "Please confirm this exact current form step before I record it.");
    if (proposal.kind === "fill_form" && state.input.skippedFieldKeys.length >= 100 && proposal.answers.some(answer => answer.fieldKey === executionInput.questionKey && answer.value === false && !state.input.skippedFieldKeys.includes(answer.fieldKey))) throw new WattzunGuidedFormValidationError(400, "Review the skipped required answers before deferring any more questions.");
    executed = await deps.executeGuidedForm(request, authority, input.workReference, proposal, executionInput, input.requestId, currentRequest);
  } catch (error) {
    if (!(error instanceof WattzunGuidedFormValidationError)) throw error;
    workflow.guide = await loadTurnGuide(request, authority, input, resumeGuideInput(state.input), deps);
    return guideReply({ ...reply, kind: "clarification", message: error.message, questions: [wattzunFormGuideNarration(workflow.guide.guide)] }, workflow.guide, input.requestId);
  }
  if (!isWattzunWorkflowResult(executed.result) || executed.result.state !== "complete" || executed.result.receipt.kind !== proposal.kind) throw new WattzunFormError(503, "The answer's saved result is not confirmed. Resume this same request before continuing.");
  workflow.result = executed.result; workflow.guidedReviewId = executed.reviewId;
  workflow.guide = await loadTurnGuide(request, authority, input, afterSavedGuideInput(state.input, executed.deferredFieldKeys), deps);
  const acknowledgement = proposal.kind === "fill_form" ? "Saved. " : proposal.kind === "form_step" ? `${executed.result.receipt.message} ` : "";
  return guideReply({ ...reply, kind: "answer", message: `${acknowledgement}${wattzunFormGuideNarration(workflow.guide.guide)}`, questions: [] }, workflow.guide, input.requestId, executed.result);
}
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
  reply: WattzunReply, workflow: WorkflowTurn, deps: WattzunRouteDependencies, requestSummary?: string,
  turnAuthority?: WattzunTurnAuthority): Promise<WattzunReply> {
  if (workflow.guide) {
    if (!turnAuthority) throw new WattzunFormError(403, "Choose your current business before answering this form.");
    return processGuidedReply(request, turnAuthority, input, reply, workflow, input.message || requestSummary || "", deps);
  }
  if (input.workflowReviewId && workflow.result?.state === "complete") {
    return wattzunWorkflowReply({ ...reply, action: null, lookup: null }, workflow.result);
  }
  if (!isWattzunWorkflowProposal(reply.action)) return workflow.result ? { ...reply, workflow: workflow.result } : reply;
  // Preparation checks its exact current target. Keep the selected-source checks
  // at the existing speech, usage and response handoff boundaries.
  const currentAccess = turnAuthority?.access ?? await recheck(request, access, deps);
  if (reply.action.kind === "confirm_workflow") {
    if (workflow.result?.state !== "review" || reply.action.reviewId !== workflow.result.reviewId) throw new WattzunWorkflowError(409, "Approve only the current workflow review. Prepare it again if the details changed.");
    const approve = workflow.result.kind === "complete_form" ? isWattzunFormCompletionApproval : isWattzunWorkflowApproval;
    if (!approve(input.message || requestSummary || "")) throw new WattzunWorkflowError(400, "Please explicitly confirm this current review before it can be saved or sent.");
    const current = await reviewedWorkflow(request, currentAccess, reply.action.reviewId, deps);
    if (current.state !== "review") throw new WattzunWorkflowError(409, "This review already has a result. Check it before submitting another action.");
    workflow.result = current;
    return { ...reply, kind: "answer", message: "I will submit this reviewed task now.", questions: [], workflow: current };
  }
  const proposal = selectedWorkflowJob(reply.action, context);
  workflow.proposal = proposal;
  // Only a new model proposal can defer its redundant source rebuild. Pending
  // input stays strict before the provider; final text/audio checks stay strict.
  if (turnAuthority) {
    requireOpenConversation(request);
    workflow.result = await deps.prepareTurnWorkflow(request, turnAuthority, proposal, input.requestId);
    requireOpenConversation(request);
    if (!isWattzunWorkflowResult(workflow.result)) throw new WattzunWorkflowError(503, "The prepared workflow could not be read. Prepare it again.");
  } else workflow.result = await preparedWorkflow(request, currentAccess, input, proposal, deps, deps.prepareProposedWorkflow ?? deps.prepareWorkflow);
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
/** No candidate header or PCM can escape before this final post-usage gate. */
async function releaseNativeTurn(request: Request, initial: WattzunTurnAuthority, input: WattzunTurnInput,
  context: WattzunWorkContext | undefined, workflow: WorkflowTurn, deps: WattzunRouteDependencies) {
  requireOpenConversation(request);
  if (workflow.guide) {
    const fresh = await loadTurnGuide(request, initial, input, resumeGuideInput(workflow.guide.input), deps);
    if (fresh.context.sourceSha256 !== workflow.guide.context.sourceSha256) throw new WattzunFormError(409, "This form changed while Wattzun was answering. Resume its current question before continuing.");
  } else if (context) {
    const refreshed = await selectedContext(request, initial.access, input, deps);
    if (!refreshed || refreshed.sourceSha256 !== context.sourceSha256) {
      throw new WattzunWorkContextError(409, "This work item changed while Wattzun was answering. Ask again to use its current details. Your call can continue.");
    }
  }
  const refresh = () => deps.turnAuthority(request, input.portal, input.scopeId, initial);
  if (workflow.result?.state === "review" || workflow.guidedReviewId) {
    const reviewId = workflow.guidedReviewId || (workflow.result?.state === "review" ? workflow.result.reviewId : "");
    const checked = await deps.reviewTurnWorkflow(request, initial, reviewId, refresh);
    if (!isWattzunWorkflowResult(checked.result) || JSON.stringify(checked.result) !== JSON.stringify(workflow.result)) {
      throw new WattzunWorkflowError(409, "This workflow changed while Wattzun was answering. Check the current review or result before continuing.");
    }
  } else {
    if (workflow.result) {
      const checked = input.workflowReviewId
        ? (await deps.reviewTurnWorkflow(request, initial, input.workflowReviewId, refresh)).result
        : workflow.proposal ? await deps.verifyTurnWorkflow(request, initial, workflow.proposal, input.requestId, refresh) : undefined;
      if (!checked || !isWattzunWorkflowResult(checked) || JSON.stringify(checked) !== JSON.stringify(workflow.result)) {
        throw new WattzunWorkflowError(409, "This workflow changed while Wattzun was answering. Check the current review or result before continuing.");
      }
    } else {
      const finalAuthority = await refresh();
      if (workflow.guide) {
        const fresh = await loadTurnGuide(request, finalAuthority, input, resumeGuideInput(workflow.guide.input), deps);
        if (fresh.context.sourceSha256 !== workflow.guide.context.sourceSha256) throw new WattzunFormError(409, "This form changed while Wattzun was answering. Resume its current question before continuing.");
      }
    }
  }
  requireOpenConversation(request);
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
  let guideRequestId: string | undefined;
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
    if (input.formGuide) guideRequestId = input.formGuide.pendingRequestId || input.requestId;
    if (input.formGuideControl) throw new WattzunInputError("Use the form guide controls with the current form session.");
    if (input.formGuide && !realtime) throw new WattzunInputError("Reload Wattzun to continue the guided voice form.");
    const initialAuthority = realtime ? await timing.run("access", () => deps.turnAuthority(request, input.portal, input.scopeId)) : undefined;
    const access = initialAuthority?.access ?? await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    requireOpenConversation(request);
    const guideInput = input.formGuide;
    const guide = initialAuthority && guideInput ? await timing.run("access", () => loadTurnGuide(request, initialAuthority, input, guideInput.pendingRequestId ? resumeGuideInput(guideInput) : guideInput, deps)) : undefined;
    const workContext = guide?.context ?? await timing.run("access", () => selectedContext(request, access, input, deps));
    const workflow = guide ? { guide } : await timing.run("access", () => initialWorkflow(request, access, input, workContext, deps));
    if (realtime) {
      let prepared: Awaited<ReturnType<WattzunRouteDependencies["realtime"]>>;
      if (initialAuthority && guide && guideInput?.pendingRequestId) {
        const reference = input.workReference;
        if (reference?.kind !== "trade_form") throw new WattzunFormError(409, "Resume the original form to check this answer.");
        const recovery = await deps.recoverGuidedForm(request, initialAuthority, reference, guideInput, guideInput.pendingRequestId);
        if (recovery.state === "saved") { workflow.result = recovery.result; workflow.guidedReviewId = recovery.reviewId; }
        const currentGuide = recovery.state === "saved" ? await loadTurnGuide(request, initialAuthority, input, afterSavedGuideInput(guideInput, recovery.deferredFieldKeys), deps) : guide;
        workflow.guide = currentGuide;
        const reply = guideReply({ kind: "answer", message: recoveredGuideNarration(currentGuide.guide, workflow.result), questions: [], links: [], action: null, lookup: null }, currentGuide, guideInput.pendingRequestId, workflow.result);
        prepared = { reply, audio: await timing.run("tts", () => deps.streamSpeak({ ...access, input, workContext: currentGuide.context, formGuideProgress: currentGuide.guide, workflowContext: workflow.result, reply, signal: request.signal })) };
      } else prepared = await timing.run("realtime", () => deps.realtime({ ...access, input, workContext, workflowContext: workflow.result, formGuideProgress: guide?.guide, audio, signal: request.signal,
        transformReply: async (reply, summary) => timing.run("access", () => processWorkflowReply(request, access, input, workContext, reply, workflow, deps, summary, initialAuthority)),
        beforeSpeech: async () => { requireOpenConversation(request); } }));
      speechStream = prepared.audio;
      for (const [stage, duration] of Object.entries(prepared.timings || {})) timing.provider(stage, duration);
      if (!initialAuthority) throw new WattzunAccessError(403, "Choose your current workspace before calling Wattzun.");
      requireOpenConversation(request);
      // Provider speech remains privately buffered while usage and fresh source/
      // authority validation run. Denial cancels it in finally without disclosure.
      await timing.run("usage", () => deps.recordUsage({ access, requestId: input.requestId, kind: "voice" }));
      await timing.run("access", () => releaseNativeTurn(request, initialAuthority, input, workContext, workflow, deps));
      const response = timing.response(new Response(voiceFrames(prepared.transcript || "", withContext(prepared.reply, workflow.guide?.context || workContext), speechStream, request.signal, prepared.requestSummary),
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
  } catch (error) {
    const response = failure(error);
    return timing.response(guideRequestId ? json({ ...await response.json(), formGuideRecovery: { requestId: guideRequestId, state: "uncertain" } }, response.status) : response);
  }
  finally { if (speechStream && !handedOff) await speechStream.cancel().catch(() => {}); }
}
/** Source-grounded guide controls use fixed branded speech and never enter a model. */
export async function postWattzunFormGuide(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ ok: false, error: "Send the current form guide as JSON." }, 415);
  const timing = turnTimer(); let audio: ReadableStream<Uint8Array> | undefined, handedOff = false, guideRequestId: string | undefined;
  try {
    await timing.run("auth", () => deps.authenticate(request)); requireOpenConversation(request);
    const bytes = await boundedBody(request, 40_000);
    if (!bytes) return json({ ok: false, error: "This form guide request is too large." }, 413);
    const input = parseWattzunTurn(JSON.parse(new TextDecoder().decode(bytes)));
    if (!input.formGuide || input.portal !== "trade" || input.workReference?.kind !== "trade_form" || input.workflowProposal || input.workflowReviewId) throw new WattzunInputError("Open the current TLink form and start its guide.");
    const guideInput = input.formGuide;
    guideRequestId = guideInput.pendingRequestId || input.requestId;
    const initial = await timing.run("access", () => deps.turnAuthority(request, input.portal, input.scopeId));
    const pending = guideInput.pendingRequestId;
    const state = await timing.run("access", () => loadTurnGuide(request, initial, input, pending || input.formGuideControl?.command === "resume" ? resumeGuideInput(guideInput) : guideInput, deps));
    const workflow: WorkflowTurn = { guide: state };
    let reply: WattzunReply = { kind: "answer", message: `${input.formGuide.stage === "start" ? "I'll guide you through this form. " : ""}${wattzunFormGuideNarration(state.guide)}`, questions: [], links: [], action: null, lookup: null };
    if (pending) {
      if (input.formGuideControl && !["repeat", "resume"].includes(input.formGuideControl.command)) throw new WattzunFormError(409, "Check the pending answer before changing this form guide.");
      // Repeat/resume first reconcile the original request. Their stale field or
      // control intent never changes the guide or dispatches another answer.
      const recovery = await deps.recoverGuidedForm(request, initial, input.workReference, input.formGuide, pending);
      if (recovery.state === "saved") { workflow.result = recovery.result; workflow.guidedReviewId = recovery.reviewId; }
      const current = recovery.state === "saved" ? await loadTurnGuide(request, initial, input, afterSavedGuideInput(input.formGuide, recovery.deferredFieldKeys), deps) : state;
      workflow.guide = current;
      reply = guideReply({ ...reply, message: recoveredGuideNarration(current.guide, workflow.result) }, current, pending, workflow.result);
    } else if (input.formGuideControl) {
      reply = await processGuidedReply(request, initial, input, { ...reply, action: input.formGuideControl }, workflow, input.message, deps);
    } else reply = guideReply(reply, state, input.requestId);
    const current = workflow.guide || state;
    audio = await timing.run("tts", () => deps.streamSpeak({ ...initial.access, input, signal: request.signal, workContext: current.context, formGuideProgress: current.guide, workflowContext: workflow.result, reply }));
    requireOpenConversation(request);
    await timing.run("usage", () => deps.recordUsage({ access: initial.access, requestId: input.requestId, kind: "voice" }));
    await timing.run("access", () => releaseNativeTurn(request, initial, input, current.context, workflow, deps));
    const response = timing.response(new Response(voiceFrames("", reply, audio, request.signal), { headers: { ...headers, "Content-Type": WATTZUN_REALTIME_VOICE_STREAM_TYPE } }));
    handedOff = true; return response;
  } catch (error) {
    const response = failure(error);
    return timing.response(guideRequestId ? json({ ...await response.json(), formGuideRecovery: { requestId: guideRequestId, state: "uncertain" } }, response.status) : response);
  } finally { if (audio && !handedOff) { try { await audio.cancel(); } catch { /* Already stopped. */ } } }
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
