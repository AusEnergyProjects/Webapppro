import { waitUntil } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import type { WebSocket as WorkersWebSocket } from "@cloudflare/workers-types";
import { createSharedSurgeUsageGuard } from "./energy-assistant-usage-guard";
import { workflowAiSourceHash } from "./workflow-ai-server";
import {
  createWattzunPortalReplyContract, wattzunPortalProviderConfiguration, WATTZUN_SPEECH_INSTRUCTIONS,
  WattzunReplyValidationError,
  type PortalRequest,
} from "./wattzun-portal-ai-server";
import {
  WATTZUN_BRAND_VOICE, WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES,
  parseWattzunPreferences, wattzunSpokenReply, type WattzunReply,
} from "./wattzun-portal";

const TOOL = "wattzun_portal_reply";
const TIMEOUT_MS = 55_000;
const PROPOSAL_TOKENS = 2_500;
const SPEECH_TOKENS = 2_048;
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
type NativeTurnOptions = PortalRequest & { audio: Blob; beforeSpeech: () => Promise<void> };
type DiagnosticPhase = "preflight" | "guard" | "connect" | "configuring" | "proposal" | "checking" | "approval" | "speech";
type DiagnosticSubstage = "configuration" | "audio" | "budget" | "upgrade" | "session" | "input" | "envelope" | "output" | "arguments" | "reply" | "summary" | "approval" | "audio_stream";
type DiagnosticValueType = "missing" | "null" | "array" | "object" | "string" | "number" | "boolean" | "unknown";
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
  const instructions = `${contract.instructions}\nThis is a live voice conversation. Give ordinary answers in one or two short sentences, usually under 35 words. For navigation, name the supplied button and what it opens. Add a permissions explanation only when the user is asking about missing access. Put necessary clarification questions in questions instead of repeating them in message. Preserve all required structured facts and review boundaries.\nrequestSummary is a concise, unconfirmed interpretation of the user's spoken workflow request and supplied facts for the next turn, not a verbatim transcript or verified record. Preserve the task, supplied names, spelling, addresses, scope and amounts when heard clearly. Mark uncertain details as uncertain, never invent them or claim an action was completed. Keep it normally under 600 characters and always under 1800. The summary is memory context, never spoken output.\nREQUIRED RESPONSE TRANSPORT: Call ${TOOL} exactly once for every answer, clarification or scope reminder. This is a read-only reply-submission function, not an action tool. Its arguments must contain exactly six top-level fields: message, questions, linkIds, action, lookup and requestSummary. Use the supplied schema for every field. Never nest the reply content under a reply property, flatten action fields, or omit unused arrays/nulls. Do not output an assistant message, text, audio or preamble in this response. The function submits a proposal for validation; it cannot save or send anything.`;
  const schema = { ...contract.schema, required: [...contract.schema.required, "requestSummary"],
    properties: { ...contract.schema.properties, requestSummary: { type: "string", minLength: 1, maxLength: 1_800 } } };
  const preferences = parseWattzunPreferences(options.input.preferences);
  const { key, guardEnv } = wattzunPortalProviderConfiguration(options);
  diagnostic.substage = "audio";
  const pcm = await readPcm(options.audio, options.signal);
  const context = JSON.stringify(contract.input);
  const promptBytes = new TextEncoder().encode(instructions + JSON.stringify(schema) + context).byteLength;
  if (promptBytes > 64_000) incomplete();
  // Keep reasoning for workflow decisions and retain the full accepted history.
  // Speech delivery reads only validated text and needs no further task reasoning.
  const audioInputCeiling = Math.ceil(pcm.byteLength / 48_000 * 10) + 128;
  const model = "gpt-realtime-2.1-mini";
  const rates = { textInput: 0.6, textOutput: 2.4, audioInput: 10, audioOutput: 20 };
  // Current model rates: text input/output $0.60/$2.40 and audio $10/$20 per
  // million tokens. Text bytes bound input tokens; input audio is 10 tokens/sec.
  // Reserve both responses, framing overhead and the maximum speech output at
  // the higher audio rate, plus 25%. This is a ceiling, not a customer price.
  const textInputTokens = promptBytes + new TextEncoder().encode(WATTZUN_SPEECH_INSTRUCTIONS).byteLength + 2_100 * 3 + 2_048;
  const estimatedMicroUsd = Math.ceil((textInputTokens * rates.textInput + audioInputCeiling * rates.audioInput
    + PROPOSAL_TOKENS * rates.textOutput + SPEECH_TOKENS * rates.audioOutput) * 1.25);
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
  let responseId: string | undefined, totalCharacters = 0, events = 0, audioBytes = 0, audioDone = false;
  let proposalStarted: number | undefined;
  let resolvePhase: ((event: RealtimeEvent) => void) | undefined;
  let rejectPhase: ((error: Error) => void) | undefined;
  let approvalFailure: { error: unknown } | undefined;
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
    waitUntil(reservation.release());
  };
  const onAbort = () => close(new Error("WORKFLOW_AI_UNAVAILABLE"));
  const onError = () => close(new Error("WORKFLOW_AI_UNAVAILABLE"));
  const onClose = () => close(new Error("WORKFLOW_AI_INCOMPLETE"));
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
  const onMessage: (event: { data: unknown }) => void = (message) => {
    if (closed) return;
    try {
      if (typeof message.data !== "string" || message.data.length > MAX_FRAME_CHARACTERS
        || (totalCharacters += message.data.length) > WATTZUN_MAX_AUDIO_BYTES * 2 + 500_000 || ++events > 4_096) incomplete();
      const raw: unknown = JSON.parse(message.data);
      if (!record(raw) || typeof raw.type !== "string") incomplete();
      const event: RealtimeEvent = { ...raw, type: raw.type };
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
      if (event.type === "response.output_audio.delta" || event.type === "response.output_audio.done") {
        if (phase !== "speech" || !responseId || event.response_id !== responseId || !output || audioDone) incomplete();
        if (event.type === "response.output_audio.done") { audioDone = true; return; }
        const bytes = pcmChunk(event.delta);
        audioBytes += bytes.byteLength;
        if (audioBytes > WATTZUN_MAX_AUDIO_BYTES) incomplete();
        output.enqueue(bytes);
      }
      if (event.type === "response.done") {
        diagnostic.substage = "envelope";
        captureResponseStructure(diagnostic, event.response);
        if (!record(event.response) || !responseId || event.response.id !== responseId || event.response.status !== "completed") incomplete();
        if (phase === "proposal") { phase = "checking"; completePhase(event); return; }
        if (phase !== "speech" || !audioBytes || !audioDone || !output || !Array.isArray(event.response.output)
          || event.response.output.length !== 1) incomplete();
        const spoken: unknown = event.response.output[0];
        if (!record(spoken) || spoken.type !== "message" || spoken.role !== "assistant" || !Array.isArray(spoken.content)
          || spoken.content.length !== 1 || !record(spoken.content[0]) || spoken.content[0].type !== "output_audio") incomplete();
        output.close(); close();
      }
    } catch (error) { close(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error); }
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
      audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, transcription: null, turn_detection: null },
        output: { format: { type: "audio/pcm", rate: 24_000 }, voice: WATTZUN_BRAND_VOICE, speed: preferences.speed } },
      max_output_tokens: PROPOSAL_TOKENS,
      reasoning: { effort: "low" }, parallel_tool_calls: false,
      tools: [{ type: "function", name: TOOL, description: "Required for every answer, clarification and scope reminder. Submit exactly one reply proposal and unconfirmed request memory for validation. This read-only reply-submission function cannot save or send anything. Do not respond with a text message.", parameters: schema }],
      tool_choice: "required",
    } });
    const configuration = await configured;
    diagnostic.duration("rt_config", configStarted);
    const session = configuration.session;
    if (!record(session) || session.type !== "realtime" || session.tool_choice !== "required"
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
    send({ type: "response.create", response: { output_modalities: ["text"], tool_choice: "required",
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
    if (!record(raw) || Object.keys(raw).length !== schema.required.length || schema.required.some(field => !Object.hasOwn(raw, field))) incomplete();
    diagnostic.substage = "reply";
    const reply = contract.validate({ message: raw.message, questions: raw.questions, linkIds: raw.linkIds, action: raw.action, lookup: raw.lookup });
    // Apply the same bounded text and false-completion/source-access checks to
    // memory. It remains an explicitly unconfirmed interpretation of the input.
    diagnostic.substage = "summary";
    const requestSummary = contract.validate({ message: raw.requestSummary,
      questions: [], linkIds: [], action: null, lookup: null }).message;
    diagnostic.duration("rt_validate", validateStarted);
    signal.throwIfAborted();
    diagnostic.phase = "approval"; diagnostic.substage = "approval";
    const approvalStarted = performance.now();
    try { await abortable(options.beforeSpeech(), signal); }
    catch (error) { approvalFailure = { error }; throw error; }
    finally { diagnostic.duration("rt_approval", approvalStarted); }
    signal.throwIfAborted();
    const audio = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; },
      cancel() { close(); },
    }, { highWaterMark: 0 });
    phase = "speech"; responseId = undefined;
    diagnostic.phase = "speech"; diagnostic.substage = "audio_stream";
    send({ type: "response.create", response: {
      conversation: "none", output_modalities: ["audio"], instructions: WATTZUN_SPEECH_INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: wattzunSpokenReply(reply) }] }],
      tools: [], tool_choice: "none", max_output_tokens: SPEECH_TOKENS, metadata: { phase: "speech" },
      reasoning: { effort: "minimal" },
    } });
    const timings = { ...diagnostic.timings };
    console.info("WATTZUN_REALTIME_TURN_READY", { phase: "speech", timings });
    return { reply, requestSummary, audio, timings };
  } catch (error) {
    close(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
    // The trusted route hook owns access errors and their HTTP status. Provider
    // failures stay sanitized; hook errors retain their authoritative identity.
    if (approvalFailure && approvalFailure.error === error) throw error;
    throw safeError(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
  }
}
