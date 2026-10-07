import { waitUntil } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { wattzunNativeSpokenReply } from "./wattzun-voice-narration";
import type { WebSocket as WorkersWebSocket } from "@cloudflare/workers-types";
import { createSharedSurgeUsageGuard } from "./energy-assistant-usage-guard";
import { workflowAiSourceHash } from "./workflow-ai-server";
import {
  createWattzunPortalReplyContract, wattzunPortalProviderConfiguration, WATTZUN_SPEECH_INSTRUCTIONS,
  WattzunReplyValidationError,
  type WattzunReplyValidationReason,
  type PortalRequest,
} from "./wattzun-portal-ai-server";
import {
  WATTZUN_BRAND_VOICE, WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES,
  parseWattzunPreferences, type WattzunReply,
} from "./wattzun-portal";

const TOOL = "wattzun_portal_reply";
const REPLY_TOOL_CHOICE = { type: "function", name: TOOL };
const TIMEOUT_MS = 55_000;
const PROPOSAL_TOKENS = 2_500;
const SPEECH_TOKENS = 2_048;
// https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
const CONTEXT_TOKENS = 128_000;
const CONTEXT_FRAMING_TOKENS = 512;
const MAX_FRAME_CHARACTERS = 256_000;
type RealtimeSocket = Pick<WorkersWebSocket, "accept" | "send" | "close" | "addEventListener" | "removeEventListener">;
type RealtimeEvent = Record<string, unknown> & { type: string };
export type WattzunRealtimeTimings = Partial<Record<
  "rt_guard" | "rt_connect" | "rt_config" | "rt_proposal" | "rt_validate" | "rt_approval" | "rt_first_argument", number
>>;
export type PreparedWattzunRealtimeTurn = {
  reply: WattzunReply;
  requestSummary: string;
  audio: ReadableStream<Uint8Array>;
  transcript?: string;
  timings?: WattzunRealtimeTimings;
};
/** Unconfirmed heard input only; the route must reauthorise before exposing it. */
export class WattzunRealtimeTurnError extends WattzunReplyValidationError {
  constructor(reason: WattzunReplyValidationReason, readonly requestSummary: string, readonly transcript?: string) {
    super(reason);
    this.name = "WattzunRealtimeTurnError";
  }
}
type NativeTurnOptions = PortalRequest & { audio: Blob; beforeSpeech: () => Promise<void>; transformReply?: (reply: WattzunReply, requestSummary: string) => Promise<WattzunReply> };
type DiagnosticPhase = "preflight" | "guard" | "connect" | "configuring" | "proposal" | "checking" | "approval" | "speech";
type DiagnosticSubstage = "configuration" | "audio" | "budget" | "upgrade" | "session" | "input" | "envelope" | "output" | "arguments" | "reply" | "summary" | "approval" | "audio_stream";
type DiagnosticValueType = "missing" | "null" | "array" | "object" | "string" | "number" | "boolean" | "unknown";
type AudioFailure = "frame" | "event" | "response" | "identity" | "order" | "encoding" | "limit" | "completion" | "closed" | "transport";
type DiagnosticStructure = {
  outputItemCount?: number;
  outputKinds?: string[];
  argumentLength?: number;
  outerFieldCount?: number;
  replyFieldCount?: number;
  replyType?: DiagnosticValueType;
  replyFieldTypes?: Partial<Record<"message" | "questions" | "linkIds" | "action" | "lookup", DiagnosticValueType>>;
  questionCount?: number;
  questionLengths?: (number | null)[];
  actionFieldCount?: number;
  actionFieldTypes?: Partial<Record<"kind" | "firstName" | "lastName" | "email" | "phone" | "addressQuery" | "serviceCategory" | "description" | "lines", DiagnosticValueType>>;
  lineCount?: number;
  lineFieldTypes?: Partial<Record<"lineType" | "description" | "quantity" | "unitPrice" | "taxCode", DiagnosticValueType>>[];
  requestSummaryType?: DiagnosticValueType;
  requestSummaryLength?: number;
  responseStatus?: string;
  responseReason?: string;
  messagePartCount?: number;
  messageContentKinds?: string[];
  outputTextLength?: number;
  outputTextJsonType?: DiagnosticValueType;
  audioEvent?: string;
  audioBytes?: number;
  audioPartCount?: number;
  audioFailure?: AudioFailure;
};
type TurnDiagnostic = {
  phase: DiagnosticPhase;
  substage: DiagnosticSubstage;
  providerError?: string;
  structure: DiagnosticStructure;
  timings: WattzunRealtimeTimings;
  duration: (key: keyof WattzunRealtimeTimings, started: number) => void;
  failure: (error: unknown) => void;
};

function valueType(value: unknown): DiagnosticValueType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "object" || type === "string" || type === "number" || type === "boolean" ? type : "unknown";
}
function allowedValue(value: unknown, allowed: readonly string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "unknown";
}
function providerErrorEnum(raw: unknown): string {
  return allowedValue(record(raw) ? raw.code ?? raw.type : undefined, [
    "invalid_request_error", "server_error", "rate_limit_exceeded", "insufficient_quota", "invalid_api_key",
    "authentication_error", "permission_denied", "session_expired", "invalid_value", "invalid_parameter",
    "missing_required_parameter", "unknown_parameter", "response_in_progress",
  ]);
}
function captureResponseStructure(diagnostic: TurnDiagnostic, raw: unknown) {
  if (!record(raw)) return;
  diagnostic.structure.responseStatus = allowedValue(raw.status, ["completed", "cancelled", "incomplete", "failed", "in_progress"]);
  if (record(raw.status_details)) {
    diagnostic.structure.responseReason = allowedValue(raw.status_details.reason, ["turn_detected", "client_cancelled", "max_output_tokens", "content_filter"]);
    if (raw.status_details.error) diagnostic.providerError = providerErrorEnum(raw.status_details.error);
  }
  if (Array.isArray(raw.output)) {
    diagnostic.structure.outputItemCount = Math.min(raw.output.length, 4_096);
    diagnostic.structure.outputKinds = raw.output.slice(0, 4).map(item => allowedValue(record(item) ? item.type : undefined,
      ["function_call", "message", "function_call_output"]));
    const message: unknown = raw.output.length === 1 ? raw.output[0] : undefined;
    if (record(message) && message.type === "message" && Array.isArray(message.content)) {
      diagnostic.structure.messagePartCount = Math.min(message.content.length, 4_096);
      diagnostic.structure.messageContentKinds = message.content.slice(0, 4).map(part => allowedValue(record(part) ? part.type : undefined,
        ["output_text", "output_audio"]));
      const part: unknown = message.content.length === 1 ? message.content[0] : undefined;
      if (record(part) && part.type === "output_text" && typeof part.text === "string") {
        diagnostic.structure.outputTextLength = Math.min(part.text.length, MAX_FRAME_CHARACTERS);
        if (part.text.length <= 18_000) {
          try {
            const value: unknown = JSON.parse(part.text);
            diagnostic.structure.outputTextJsonType = valueType(value);
            captureArgumentStructure(diagnostic, value);
          } catch { /* Structural diagnostics never accept text or expose parse errors. */ }
        }
      }
    }
  }
}
function captureArgumentStructure(diagnostic: TurnDiagnostic, raw: unknown) {
  if (!record(raw)) return;
  diagnostic.structure.outerFieldCount = Object.keys(raw).length;
  diagnostic.structure.replyType = valueType(raw);
  diagnostic.structure.requestSummaryType = valueType(raw.requestSummary);
  if (typeof raw.requestSummary === "string") diagnostic.structure.requestSummaryLength = raw.requestSummary.length;
  diagnostic.structure.replyFieldCount = Object.keys(raw).filter(field => field !== "requestSummary").length;
  diagnostic.structure.replyFieldTypes = {};
  for (const field of ["message", "questions", "linkIds", "action", "lookup"] as const) {
    diagnostic.structure.replyFieldTypes[field] = valueType(raw[field]);
  }
  if (Array.isArray(raw.questions)) {
    diagnostic.structure.questionCount = raw.questions.length;
    diagnostic.structure.questionLengths = raw.questions.slice(0, 4).map(value => typeof value === "string" ? value.length : null);
  }
  if (record(raw.action)) {
    diagnostic.structure.actionFieldCount = Object.keys(raw.action).length;
    diagnostic.structure.actionFieldTypes = {};
    for (const field of ["kind", "firstName", "lastName", "email", "phone", "addressQuery", "serviceCategory", "description", "lines"] as const) {
      diagnostic.structure.actionFieldTypes[field] = valueType(raw.action[field]);
    }
    if (Array.isArray(raw.action.lines)) {
      diagnostic.structure.lineCount = raw.action.lines.length;
      diagnostic.structure.lineFieldTypes = raw.action.lines.slice(0, 3).map(line => {
        const types: Partial<Record<"lineType" | "description" | "quantity" | "unitPrice" | "taxCode", DiagnosticValueType>> = {};
        for (const field of ["lineType", "description", "quantity", "unitPrice", "taxCode"] as const) {
          types[field] = valueType(record(line) ? line[field] : undefined);
        }
        return types;
      });
    }
  }
}

function turnDiagnostic(signal?: AbortSignal): TurnDiagnostic {
  let logged = false;
  const diagnostic: TurnDiagnostic = {
    phase: "preflight", substage: "configuration", structure: {}, timings: {},
    duration(key, started) {
      const duration = performance.now() - started;
      if (Number.isFinite(duration)) diagnostic.timings[key] = Math.min(TIMEOUT_MS, Math.max(0, duration));
    },
    failure(error) {
      if (logged || signal?.aborted) return;
      logged = true;
      console.error("WATTZUN_REALTIME_TURN_FAILED", {
        phase: diagnostic.phase, substage: diagnostic.substage, error: safeError(error).message,
        ...(error instanceof WattzunReplyValidationError ? { validationReason: error.reason } : {}),
        ...(diagnostic.providerError ? { providerError: diagnostic.providerError } : {}),
        ...diagnostic.structure, timings: { ...diagnostic.timings },
      });
    },
  };
  return diagnostic;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function audioIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 4_096;
}
function isSocket(value: unknown): value is RealtimeSocket {
  return record(value) && ["accept", "send", "close", "addEventListener", "removeEventListener"]
    .every(method => typeof Reflect.get(value, method) === "function");
}
function safeError(error: unknown) {
  return error instanceof Error && /^WORKFLOW_AI_(?:INCOMPLETE|UNAVAILABLE|LIMIT)$/.test(error.message)
    ? error : new Error("WORKFLOW_AI_UNAVAILABLE");
}
function incomplete(): never { throw new Error("WORKFLOW_AI_INCOMPLETE"); }

/** The native capture contract is an exact PCM16, mono, 24 kHz WAV header. */
async function readPcm(audio: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!/^audio\/(?:x-)?wav$/.test(audio.type) || audio.size < 44 + 4_800 || audio.size > WATTZUN_MAX_WAV_AUDIO_BYTES) incomplete();
  const buffer = await audio.arrayBuffer();
  signal?.throwIfAborted();
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const text = (start: number, length: number) => new TextDecoder().decode(bytes.subarray(start, start + length));
  if (text(0, 4) !== "RIFF" || view.getUint32(4, true) !== bytes.length - 8 || text(8, 4) !== "WAVE"
    || text(12, 4) !== "fmt " || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1
    || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 24_000 || view.getUint32(28, true) !== 48_000
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || text(36, 4) !== "data"
    || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2) incomplete();
  return bytes.subarray(44);
}

function pcmChunk(raw: unknown): Uint8Array {
  if (typeof raw !== "string" || !raw || raw.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) incomplete();
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length % 2 || bytes.toString("base64") !== raw) incomplete();
  return bytes;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("WORKFLOW_AI_UNAVAILABLE");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("WORKFLOW_AI_UNAVAILABLE"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Resolves after validation/access approval and the speech request without awaiting audio. */
export async function prepareWattzunRealtimeTurn(
  options: NativeTurnOptions,
): Promise<PreparedWattzunRealtimeTurn> {
  const diagnostic = turnDiagnostic(options.signal);
  try { return await prepareNativeTurn(options, diagnostic); }
  catch (error) { diagnostic.failure(error); throw error; }
}

async function prepareNativeTurn(options: NativeTurnOptions, diagnostic: TurnDiagnostic): Promise<PreparedWattzunRealtimeTurn> {
  const contract = createWattzunPortalReplyContract(options);
  const instructions = [contract.instructions,
    "This is a live voice conversation: one or two short sentences, combined message and all questions normally under 45 words. For clarification, briefly acknowledge and ask the next missing detail directly: use one concise next necessary question in questions without duplicating it in message. Do not narrate the whole workflow, repeat boilerplate or list later intake details before that question. Add questions only if essential. Name supplied navigation buttons. Explain permissions only for missing-access questions. The word target must not omit a material fact or required review detail.",
    "Ask for ONE logical detail at a time. Phone number and email are two different questions; never bundle them. A complete street address is one detail. Before asking, read the earlier user answers and corrections in history. Carry those literal values forward and ask only the next unanswered detail. Acknowledge in a few words; do not describe missing later fields or the review process during intake.",
    "Use natural workplace language. When recalling an answer the user supplied, state the actual detail directly, without internal terms such as 'interpreted input' or 'customer profile setup'. Keep genuine uncertainty explicit. Explain unsaved or unsent status when reviewing an action or answering a status question; do not repeat that disclaimer after every ordinary intake answer. Put the next question only in questions, not again in message.",
    "requestSummary is private conversation memory, not a saved record; never speak it. Copy the current user's actual words and literal values, including name spelling, full street address, contact details, scope, quantities and prices. Never replace an answer with 'the user provided an address/name/details' or describe missing workflow requirements here: that would lose their answer. Mark words you could not hear clearly. Always under 1800 characters. For explicit approval retain the actual present approval or selection phrase, e.g. 'yes send it', 'I confirm this declaration', 'use the second one', 'complete this form now'. Never substitute 'user confirms', turn an ordinary answer into completion consent, or treat questions, quotations or future intent as approval.",
    `Call ${TOOL} exactly once for every answer, clarification or scope reminder. Submit exactly six top-level fields: message, questions, linkIds, action, lookup and requestSummary, using their schema including unused arrays/nulls. Never nest the reply content under a reply property or flatten action fields. Do not output an assistant message, text, audio or preamble. The application validates your proposed action and executes it under the current user's authorisation. Claim a saved or sent result only from its verified receipt.`,
    ...(contract.input.formGuideProgress ? [
      "This call is already inside an explicitly authorised guided form session. When the speaker clearly supplies the current ordinary answer, return its fill_form action now, with message 'Thanks.' and questions []. Do not offer a draft, ask whether to save, ask for extra optional detail, or wait for the same answer again. The application performs the save and speaks the next question from the saved form. Earlier assistant wording asking to confirm an ordinary answer was unnecessary and must not create another approval requirement. Ask one short clarification only when the answer itself is missing, ambiguous or cannot match the current field. An unrelated remark is not an answer. Actual signatures, governed steps and final completion still require their existing specific controls or confirmation.",
    ] : [
      'Clarification argument shape example: {"message":"I can prepare that.","questions":["What detail should the draft include?"],"linkIds":[],"action":null,"lookup":null,"requestSummary":"User requests a draft; a necessary detail is missing."}. This illustrates all six fields, not wording to copy.',
    ]),
  ].join("\n");
  const schema = { ...contract.schema, required: [...contract.schema.required, "requestSummary"],
    properties: { ...contract.schema.properties, requestSummary: { type: "string", minLength: 1, maxLength: 1_800,
      description: "The current speaker's actual words and literal answers. Preserve all supplied values, never just say that a value was provided. This is unconfirmed input, not assistant reasoning or a task checklist." } } };
  const preferences = parseWattzunPreferences(options.input.preferences);
  const { key, guardEnv } = wattzunPortalProviderConfiguration(options);
  diagnostic.substage = "audio";
  const pcm = await readPcm(options.audio, options.signal);
  const context = JSON.stringify(contract.input);
  const promptBytes = new TextEncoder().encode(instructions + JSON.stringify(schema) + context).byteLength;
  const audioInputCeiling = Math.ceil(pcm.byteLength / 48_000 * 10) + 128;
  // UTF-8 bytes conservatively bound text tokens. Leave the full proposal,
  // bounded input audio and protocol framing in the model's context window.
  // Reject excess before spending; never silently discard accepted facts.
  if (promptBytes + audioInputCeiling + PROPOSAL_TOKENS + CONTEXT_FRAMING_TOKENS > CONTEXT_TOKENS) incomplete();
  // Keep reasoning for workflow decisions and retain the full accepted history.
  // Speech delivery reads only validated text and needs no further task reasoning.
  const model = "gpt-realtime-2.1-mini";
  const rates = { textInput: 0.6, textOutput: 2.4, audioInput: 10, audioOutput: 20 };
  // Current model rates: text input/output $0.60/$2.40 and audio $10/$20 per
  // million tokens. Text bytes bound input tokens; input audio is 10 tokens/sec.
  // Reserve both responses, framing overhead and the maximum speech output at
  // the higher audio rate, plus 25%. This is a ceiling, not a customer price.
  const textInputTokens = promptBytes + new TextEncoder().encode(WATTZUN_SPEECH_INSTRUCTIONS).byteLength + 2_100 * 3 + 2_048;
  // Parallel input transcription is memory only. Reserve its full bounded input
  // and output too; it never adds a sequential wait before the native response.
  // gpt-4o-mini-transcribe: 16k context and 2k maximum output, at
  // $1.25/M audio input and $5/M output. Reserve the entire model ceiling.
  const transcriptionCeilingMicroUsd = 16_000 * 1.25 + 2_000 * 5;
  const estimatedMicroUsd = Math.ceil((textInputTokens * rates.textInput + audioInputCeiling * rates.audioInput
    + PROPOSAL_TOKENS * rates.textOutput + SPEECH_TOKENS * rates.audioOutput + transcriptionCeilingMicroUsd) * 1.25);
  const guard = createSharedSurgeUsageGuard({ env: guardEnv, getDatabase: () => options.db });
  diagnostic.phase = "guard"; diagnostic.substage = "budget";
  const guardStarted = performance.now();
  const reservation = await guard.reserve({
    clientKey: await workflowAiSourceHash(["workflow-actor", options.actorUid]),
    networkKey: await workflowAiSourceHash(["workflow-business", `${options.scope.portal}:${options.scope.scopeId}`]),
    requestKey: `${options.input.requestId}:rt`, estimatedMicroUsd,
  });
  diagnostic.duration("rt_guard", guardStarted);
  if (!reservation.allowed) throw new Error(["configuration", "unavailable"].includes(reservation.reason)
    ? "WORKFLOW_AI_UNAVAILABLE" : "WORKFLOW_AI_LIMIT");

  const cancelled = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, cancelled.signal]) : cancelled.signal;
  const timer = setTimeout(() => cancelled.abort(), TIMEOUT_MS);
  let socket: RealtimeSocket | undefined, socketAccepted = false, socketClosed = false, closed = false;
  let phase: "configuring" | "proposal" | "checking" | "speech" = "configuring";
  let responseId: string | undefined, totalCharacters = 0, events = 0, audioBytes = 0;
  const audioItems = new Map<number, { id: string; done: boolean }>();
  const audioParts = new Map<string, { itemId: string; done: boolean; chunks: Uint8Array[] }>();
  let playingOutputIndex = 0, playingContentIndex = 0;
  let proposalStarted: number | undefined;
  let resolvePhase: ((event: RealtimeEvent) => void) | undefined;
  let rejectPhase: ((error: Error) => void) | undefined;
  let approvalFailure: { error: unknown } | undefined;
  let inputItemId = "", heardTranscript = "", approvedSpeech = "";
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  const closeSocket = () => {
    if (!socket || socketClosed) return;
    socketClosed = true;
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    try {
      if (!socketAccepted) { socket.accept(); socketAccepted = true; }
      socket.close(1000, "Turn finished");
    } catch { /* Transport already closed. */ }
  };
  const close = (error?: unknown) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    closeSocket();
    if (error !== undefined) {
      const safe = safeError(error);
      diagnostic.failure(safe);
      rejectPhase?.(safe);
      output?.error(safe);
      cancelled.abort();
    }
    audioItems.clear(); audioParts.clear();
    waitUntil(reservation.release());
  };
  const onAbort = () => close(new Error("WORKFLOW_AI_UNAVAILABLE"));
  const onError = () => {
    if (phase === "speech") { diagnostic.structure.audioEvent = "socket.error"; diagnostic.structure.audioFailure = "transport"; }
    close(new Error("WORKFLOW_AI_UNAVAILABLE"));
  };
  const onClose = () => {
    if (phase === "speech") { diagnostic.structure.audioEvent = "socket.close"; diagnostic.structure.audioFailure = "closed"; }
    close(new Error("WORKFLOW_AI_INCOMPLETE"));
  };
  const waitForPhase = () => {
    const pending = new Promise<RealtimeEvent>((resolve, reject) => { resolvePhase = resolve; rejectPhase = reject; });
    // A synchronous send failure can reject this before its await is reached.
    void pending.catch(() => undefined);
    return pending;
  };
  const completePhase = (event: RealtimeEvent) => {
    const resolve = resolvePhase;
    resolvePhase = undefined; rejectPhase = undefined;
    resolve?.(event);
  };
  const send = (event: Record<string, unknown>) => {
    signal.throwIfAborted();
    if (!socket || closed) throw new Error("WORKFLOW_AI_UNAVAILABLE");
    socket.send(JSON.stringify(event));
  };
  function rejectAudio(reason: AudioFailure): never {
    diagnostic.structure.audioFailure = reason;
    incomplete();
  }
  function completedAudioItem(outputIndex: number, spoken: unknown): number {
    const item = audioItems.get(outputIndex);
    if (!item || !record(spoken) || spoken.type !== "message" || spoken.role !== "assistant"
      || spoken.id !== item.id || !Array.isArray(spoken.content) || !spoken.content.length) rejectAudio("completion");
    for (const [contentIndex, content] of spoken.content.entries()) {
      const part = audioParts.get(`${outputIndex}:${contentIndex}`);
      if (!record(content) || (content.type !== "audio" && content.type !== "output_audio")
        || !part || !part.done || part.itemId !== item.id) rejectAudio("completion");
    }
    return spoken.content.length;
  }
  function drainAudio() {
    if (!output) return;
    // Deltas for separate parts can arrive concurrently. Preserve their spoken
    // order while the current part continues streaming without waiting for EOF.
    while (true) {
      const item = audioItems.get(playingOutputIndex);
      const part = audioParts.get(`${playingOutputIndex}:${playingContentIndex}`);
      if (!item || !part) return;
      for (const chunk of part.chunks) output.enqueue(chunk);
      part.chunks.length = 0;
      if (!part.done) return;
      if (audioParts.has(`${playingOutputIndex}:${playingContentIndex + 1}`)) playingContentIndex++;
      else if (item.done) { playingOutputIndex++; playingContentIndex = 0; }
      else return;
    }
  }
  const onMessage: (event: { data: unknown }) => void = (message) => {
    if (closed) return;
    try {
      if (typeof message.data !== "string" || message.data.length > MAX_FRAME_CHARACTERS
        || (totalCharacters += message.data.length) > WATTZUN_MAX_AUDIO_BYTES * 2 + 500_000 || ++events > 4_096) {
        if (phase === "speech") rejectAudio("frame");
        incomplete();
      }
      const raw: unknown = JSON.parse(message.data);
      if (!record(raw) || typeof raw.type !== "string") incomplete();
      const event: RealtimeEvent = { ...raw, type: raw.type };
      if (event.type === "input_audio_buffer.committed" && typeof event.item_id === "string" && !inputItemId) {
        inputItemId = event.item_id;
      }
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        // Only the audio committed for this turn can contribute user memory.
        // A failed, late or malformed ASR result must not interrupt valid speech.
        if (inputItemId && event.item_id === inputItemId && event.content_index === 0
          && typeof event.transcript === "string" && event.transcript.trim() && event.transcript.length <= 4_000
          && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(event.transcript)) heardTranscript = event.transcript.trim();
        return;
      }
      if (phase === "speech") diagnostic.structure.audioEvent = allowedValue(event.type, [
        "response.created", "response.output_item.added", "response.content_part.added", "response.output_audio.delta",
        "response.output_audio.done", "response.output_audio_transcript.delta", "response.output_audio_transcript.done",
        "response.content_part.done", "response.output_item.done", "response.done", "error", "rate_limits.updated",
      ]);
      if (event.type === "error") {
        diagnostic.providerError = providerErrorEnum(event.error);
        throw new Error("WORKFLOW_AI_UNAVAILABLE");
      }
      if (event.type === "session.updated" && phase === "configuring") { completePhase(event); return; }
      if (event.type === "response.created") {
        if ((phase !== "proposal" && phase !== "speech") || responseId || !record(event.response)
          || typeof event.response.id !== "string" || !event.response.id) incomplete();
        responseId = event.response.id;
      }
      if (event.type === "response.function_call_arguments.delta" && phase === "proposal"
        && responseId && event.response_id === responseId && proposalStarted !== undefined && diagnostic.timings.rt_first_argument === undefined) {
        diagnostic.duration("rt_first_argument", proposalStarted);
      }
      if (event.type === "response.output_item.added" && phase === "speech") {
        if (!responseId || event.response_id !== responseId || !audioIndex(event.output_index)
          || audioItems.has(event.output_index) || !record(event.item) || event.item.type !== "message"
          || event.item.role !== "assistant" || typeof event.item.id !== "string" || !event.item.id
          || !Array.isArray(event.item.content)) rejectAudio("identity");
        audioItems.set(event.output_index, { id: event.item.id, done: false });
      }
      if (event.type === "response.content_part.added" && phase === "speech") {
        if (!responseId || event.response_id !== responseId || !audioIndex(event.output_index) || !audioIndex(event.content_index)
          || typeof event.item_id !== "string" || audioItems.get(event.output_index)?.id !== event.item_id
          || !record(event.part) || (event.part.type !== "audio" && event.part.type !== "output_audio")) rejectAudio("identity");
        if (audioItems.get(event.output_index)?.done) rejectAudio("order");
        const partKey = `${event.output_index}:${event.content_index}`;
        if (audioParts.has(partKey)) rejectAudio("order");
        audioParts.set(partKey, { itemId: event.item_id, done: false, chunks: [] });
        diagnostic.structure.audioPartCount = audioParts.size;
      }
      if (event.type === "response.output_item.done" && phase === "speech") {
        if (!responseId || event.response_id !== responseId || !audioIndex(event.output_index)) rejectAudio("identity");
        const item = audioItems.get(event.output_index);
        if (!item || item.done) rejectAudio("order");
        completedAudioItem(event.output_index, event.item);
        item.done = true;
        drainAudio();
      }
      if (event.type === "response.output_audio.delta" || event.type === "response.output_audio.done") {
        if (phase !== "speech" || !responseId || event.response_id !== responseId || !output) incomplete();
        if (!audioIndex(event.output_index) || !audioIndex(event.content_index) || typeof event.item_id !== "string") rejectAudio("identity");
        const part = audioParts.get(`${event.output_index}:${event.content_index}`);
        if (!part || part.itemId !== event.item_id) rejectAudio("identity");
        if (part.done) rejectAudio("order");
        if (event.type === "response.output_audio.done") { part.done = true; drainAudio(); return; }
        let bytes: Uint8Array;
        try { bytes = pcmChunk(event.delta); } catch { rejectAudio("encoding"); }
        audioBytes += bytes.byteLength;
        diagnostic.structure.audioBytes = audioBytes;
        if (audioBytes > WATTZUN_MAX_AUDIO_BYTES) rejectAudio("limit");
        part.chunks.push(bytes);
        drainAudio();
      }
      if (event.type === "response.done") {
        diagnostic.substage = "envelope";
        captureResponseStructure(diagnostic, event.response);
        if (!record(event.response) || !responseId || event.response.id !== responseId || event.response.status !== "completed") {
          if (phase === "speech") rejectAudio("response");
          incomplete();
        }
        if (phase === "proposal") { phase = "checking"; completePhase(event); return; }
        if (phase !== "speech" || !audioBytes || !output || !Array.isArray(event.response.output)
          || !event.response.output.length || event.response.output.length !== audioItems.size) rejectAudio("completion");
        let completedParts = 0;
        for (const [outputIndex, spoken] of event.response.output.entries()) {
          completedParts += completedAudioItem(outputIndex, spoken);
          const item = audioItems.get(outputIndex);
          if (item) item.done = true;
        }
        if (completedParts !== audioParts.size) rejectAudio("completion");
        const spokenParts = event.response.output.flatMap((item: Record<string, unknown>) =>
          Array.isArray(item.content) ? item.content.map((part: Record<string, unknown>) =>
            typeof part.transcript === "string" ? part.transcript : "") : []);
        const spokenText = spokenParts.join(" ");
        const speechWords = (text: string) => text.toLocaleLowerCase("en-AU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        // Content-free evidence of narration drift. Never log customer speech or
        // withhold a completed reply over punctuation or transcript variation.
        console.info("WATTZUN_REALTIME_SPEECH_COMPLETE", {
          approvedCharacters: approvedSpeech.length, spokenCharacters: spokenText.length,
          matchesApprovedWords: speechWords(approvedSpeech) === speechWords(spokenText), audioBytes,
        });
        drainAudio();
        output.close(); close();
      }
    } catch (error) {
      if (phase === "speech" && !diagnostic.structure.audioFailure) diagnostic.structure.audioFailure = "event";
      close(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    diagnostic.phase = "connect"; diagnostic.substage = "upgrade";
    const connectStarted = performance.now();
    const connecting = fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${key}` }, signal,
    }).then(response => {
      // Own the candidate before the promise handoff. Cancellation in the next
      // microtask or an Upgrade arriving after cancellation must close it too.
      const candidate: unknown = Reflect.get(response, "webSocket");
      if (isSocket(candidate)) socket = candidate;
      if (closed || signal.aborted) {
        closeSocket();
        if (!socket) void response.body?.cancel().catch(() => undefined);
      }
      return response;
    });
    const response = await abortable(connecting, signal);
    signal.throwIfAborted();
    const candidate: unknown = Reflect.get(response, "webSocket");
    if (response.status !== 101 || !isSocket(candidate)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("WORKFLOW_AI_UNAVAILABLE");
    }
    socket = candidate;
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    socket.accept(); socketAccepted = true;
    diagnostic.duration("rt_connect", connectStarted);
    diagnostic.phase = "configuring"; diagnostic.substage = "session";
    const configured = waitForPhase();
    const configStarted = performance.now();
    send({ type: "session.update", session: {
      type: "realtime", model, instructions, output_modalities: ["text"], truncation: "disabled",
      audio: { input: { format: { type: "audio/pcm", rate: 24_000 },
        transcription: { model: "gpt-4o-mini-transcribe", language: "en" }, turn_detection: null },
        output: { format: { type: "audio/pcm", rate: 24_000 }, voice: WATTZUN_BRAND_VOICE, speed: preferences.speed } },
      max_output_tokens: PROPOSAL_TOKENS,
      reasoning: { effort: "low" }, parallel_tool_calls: false,
      tools: [{ type: "function", name: TOOL, description: "Submit one complete six-field reply proposal: message, questions, linkIds, action, lookup, requestSummary. Include unused arrays/nulls. Required for every answer, clarification and scope reminder. The application validates and executes proposed actions under the current user's authorisation, including ordinary answers in an authorised guided form. Claim a saved or sent result only from its verified receipt. Do not respond with a text message.", parameters: schema }],
      tool_choice: REPLY_TOOL_CHOICE,
    } });
    const configuration = await configured;
    diagnostic.duration("rt_config", configStarted);
    const session = configuration.session;
    if (!record(session) || session.type !== "realtime" || !record(session.tool_choice)
      || Object.keys(session.tool_choice).length !== 2 || session.tool_choice.type !== "function" || session.tool_choice.name !== TOOL
      || !Array.isArray(session.tools) || session.tools.length !== 1 || !record(session.tools[0])
      || session.tools[0].type !== "function" || session.tools[0].name !== TOOL
      || !Array.isArray(session.output_modalities)
      || session.output_modalities.length !== 1 || session.output_modalities[0] !== "text"
      || !record(session.audio) || !record(session.audio.input) || !record(session.audio.input.format)
      || session.audio.input.format.type !== "audio/pcm" || (session.audio.input.format.rate ?? 24_000) !== 24_000
      || !record(session.audio.output) || !record(session.audio.output.format) || session.audio.output.format.type !== "audio/pcm"
      || (session.audio.output.format.rate ?? 24_000) !== 24_000 || session.audio.output.voice !== WATTZUN_BRAND_VOICE
      || (session.audio.output.speed ?? 1) !== preferences.speed || session.audio.input.turn_detection !== null) incomplete();
    phase = "proposal";
    diagnostic.phase = "proposal"; diagnostic.substage = "input";
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: context }] } });
    for (let offset = 0; offset < pcm.byteLength; offset += 48_000) {
      send({ type: "input_audio_buffer.append", audio: Buffer.from(pcm.subarray(offset, offset + 48_000)).toString("base64") });
    }
    send({ type: "input_audio_buffer.commit" });
    const proposed = waitForPhase();
    diagnostic.substage = "output";
    proposalStarted = performance.now();
    send({ type: "response.create", response: { output_modalities: ["text"], tool_choice: REPLY_TOOL_CHOICE,
      reasoning: { effort: "low" }, max_output_tokens: PROPOSAL_TOKENS, metadata: { phase: "proposal" } } });
    const event = await proposed;
    diagnostic.duration("rt_proposal", proposalStarted);
    diagnostic.phase = "checking"; diagnostic.substage = "output";
    const validateStarted = performance.now();
    if (!record(event.response) || !Array.isArray(event.response.output)) incomplete();
    // Function calling may include a text preamble. It is untrusted and never
    // becomes speech, UI content or memory. Only one validated reply call counts.
    let item: unknown;
    for (const candidate of event.response.output) {
      if (!record(candidate)) incomplete();
      if (candidate.type === "function_call") {
        if (item !== undefined) incomplete();
        item = candidate;
      } else if (candidate.type !== "message" || candidate.role !== "assistant" || !Array.isArray(candidate.content)
        || !candidate.content.every(part => record(part) && part.type === "output_text" && typeof part.text === "string")) incomplete();
    }
    if (record(item) && typeof item.arguments === "string") diagnostic.structure.argumentLength = item.arguments.length;
    if (!record(item) || item.type !== "function_call" || item.name !== TOOL || typeof item.arguments !== "string"
      || item.arguments.length > 18_000) incomplete();
    diagnostic.substage = "arguments";
    const raw: unknown = JSON.parse(item.arguments);
    captureArgumentStructure(diagnostic, raw);
    diagnostic.substage = "envelope";
    if (!record(raw)) incomplete();
    // One exact read-only clarification shape is safe without a memory field.
    // Never infer heard input from its prose or rescue a partial action object.
    const clarificationOnly = Object.keys(raw).length === 3
      && ["message", "questions", "linkIds"].every(field => Object.hasOwn(raw, field))
      && Array.isArray(raw.questions) && raw.questions.length > 0;
    // Read-only native content is projected onto the complete known contract.
    // Extra provider metadata cannot cause silence or grant action authority.
    // Proposals that can read records or mutate work retain exact envelopes.
    const completeReadOnly = raw.action === null && raw.lookup === null && schema.required.every(field => Object.hasOwn(raw, field));
    if (!clarificationOnly && !completeReadOnly && (Object.keys(raw).length !== schema.required.length || schema.required.some(field => !Object.hasOwn(raw, field)))) incomplete();
    // Apply the same bounded text and false-completion/source-access checks to
    // memory. It remains an explicitly unconfirmed interpretation of the input.
    diagnostic.substage = "summary";
    const requestSummary = clarificationOnly ? "" : contract.validate({ message: raw.requestSummary,
      questions: [], linkIds: [], action: null, lookup: null }).message;
    // The parallel transcript is the current utterance when already available.
    // A model's paraphrase ("user approved completion") must not replace the
    // literal consent or correction that both validation and execution inspect.
    const currentRequest = heardTranscript || requestSummary;
    diagnostic.substage = "reply";
    let reply: WattzunReply;
    try {
      reply = contract.validateVoice({ message: raw.message, questions: raw.questions, linkIds: raw.linkIds,
        action: clarificationOnly ? null : raw.action, lookup: clarificationOnly ? null : raw.lookup }, currentRequest);
    } catch (error) {
      if (error instanceof WattzunReplyValidationError && requestSummary && !signal.aborted) throw new WattzunRealtimeTurnError(error.reason, requestSummary);
      throw error;
    }
    diagnostic.duration("rt_validate", validateStarted);
    signal.throwIfAborted();
    diagnostic.phase = "approval"; diagnostic.substage = "approval";
    const approvalStarted = performance.now();
    try {
      if (options.transformReply) reply = await abortable(options.transformReply(reply, currentRequest), signal);
      await abortable(options.beforeSpeech(), signal);
    }
    catch (error) { approvalFailure = { error }; throw error; }
    finally { diagnostic.duration("rt_approval", approvalStarted); }
    signal.throwIfAborted();
    const audio = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; },
      cancel() { close(); },
    }, { highWaterMark: 0 });
    phase = "speech"; responseId = undefined;
    diagnostic.phase = "speech"; diagnostic.substage = "audio_stream";
    approvedSpeech = wattzunNativeSpokenReply(reply);
    send({ type: "response.create", response: {
      conversation: "none", output_modalities: ["audio"], instructions: WATTZUN_SPEECH_INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: approvedSpeech }] }],
      tools: [], tool_choice: "none", max_output_tokens: SPEECH_TOKENS, metadata: { phase: "speech" },
      reasoning: { effort: "minimal" },
    } });
    const timings = { ...diagnostic.timings };
    console.info("WATTZUN_REALTIME_TURN_READY", { phase: "speech", timings });
    return { reply, requestSummary, audio, timings, get transcript() { return heardTranscript; } };
  } catch (error) {
    const retainInput = heardTranscript && diagnostic.phase === "checking" && !signal.aborted;
    close(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
    // The trusted route hook owns access errors and their HTTP status. Provider
    // failures stay sanitized; hook errors retain their authoritative identity.
    if (approvalFailure && approvalFailure.error === error) throw error;
    if (retainInput) {
      throw new WattzunRealtimeTurnError(error instanceof WattzunReplyValidationError ? error.reason : "shape",
        error instanceof WattzunRealtimeTurnError ? error.requestSummary : "", heardTranscript);
    }
    throw safeError(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
  }
}
