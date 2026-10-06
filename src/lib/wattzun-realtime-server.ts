import { waitUntil } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import type { WebSocket as WorkersWebSocket } from "@cloudflare/workers-types";
import { createSharedSurgeUsageGuard } from "./energy-assistant-usage-guard";
import { workflowAiSourceHash } from "./workflow-ai-server";
import {
  createWattzunPortalReplyContract, wattzunPortalProviderConfiguration, WATTZUN_SPEECH_INSTRUCTIONS,
  type PortalRequest,
} from "./wattzun-portal-ai-server";
import {
  WATTZUN_BRAND_VOICE, WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES,
  parseWattzunPreferences, wattzunSpokenReply, type WattzunReply,
} from "./wattzun-portal";

const MODEL = "gpt-realtime-2.1-mini";
const TOOL = "wattzun_portal_reply";
const TIMEOUT_MS = 55_000;
const PROPOSAL_TOKENS = 2_500;
const SPEECH_TOKENS = 2_048;
const MAX_FRAME_CHARACTERS = 256_000;
type RealtimeSocket = Pick<WorkersWebSocket, "accept" | "send" | "close" | "addEventListener" | "removeEventListener">;
type RealtimeEvent = Record<string, unknown> & { type: string };
export type PreparedWattzunRealtimeTurn = {
  reply: WattzunReply;
  requestSummary: string;
  audio: ReadableStream<Uint8Array>;
  transcript?: string;
};

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
  options: PortalRequest & { audio: Blob; beforeSpeech: () => Promise<void> },
): Promise<PreparedWattzunRealtimeTurn> {
  const contract = createWattzunPortalReplyContract(options);
  const instructions = `${contract.instructions}\nThe function result wraps the requested reply in reply and includes requestSummary. requestSummary is a concise, unconfirmed interpretation of the user's spoken workflow request and supplied facts for the next turn, not a verbatim transcript or verified record. Preserve the task, supplied names, spelling, addresses, scope and amounts when heard clearly. Mark uncertain details as uncertain, never invent them or claim an action was completed. Keep it normally under 600 characters and always under 1800. The summary is memory context, never spoken output.`;
  const schema = { type: "object", additionalProperties: false, required: ["reply", "requestSummary"],
    properties: { reply: contract.schema, requestSummary: { type: "string", minLength: 1, maxLength: 1_800 } } };
  const preferences = parseWattzunPreferences(options.input.preferences);
  const { key, guardEnv } = wattzunPortalProviderConfiguration(options);
  const pcm = await readPcm(options.audio, options.signal);
  const context = JSON.stringify(contract.input);
  const promptBytes = new TextEncoder().encode(instructions + JSON.stringify(schema) + context).byteLength;
  if (promptBytes > 64_000) incomplete();
  // Current model rates: text input/output $0.60/$2.40 and audio $10/$20 per
  // million tokens. Text bytes bound input tokens; input audio is 10 tokens/sec.
  // Reserve both responses, framing overhead and the maximum speech output at
  // the higher audio rate, plus 25%. This is a ceiling, not a customer price.
  const textInputTokens = promptBytes + new TextEncoder().encode(WATTZUN_SPEECH_INSTRUCTIONS).byteLength + 2_100 + 2_048;
  const inputAudioTokens = Math.ceil(pcm.byteLength / 48_000 * 10) + 128;
  const estimatedMicroUsd = Math.ceil((textInputTokens * 0.6 + inputAudioTokens * 10
    + PROPOSAL_TOKENS * 2.4 + SPEECH_TOKENS * 20) * 1.25);
  const guard = createSharedSurgeUsageGuard({ env: guardEnv, getDatabase: () => options.db });
  const reservation = await guard.reserve({
    clientKey: await workflowAiSourceHash(["workflow-actor", options.actorUid]),
    networkKey: await workflowAiSourceHash(["workflow-business", `${options.scope.portal}:${options.scope.scopeId}`]),
    requestKey: `${options.input.requestId}:rt`, estimatedMicroUsd,
  });
  if (!reservation.allowed) throw new Error(["configuration", "unavailable"].includes(reservation.reason)
    ? "WORKFLOW_AI_UNAVAILABLE" : "WORKFLOW_AI_LIMIT");

  const cancelled = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, cancelled.signal]) : cancelled.signal;
  const timer = setTimeout(() => cancelled.abort(), TIMEOUT_MS);
  let socket: RealtimeSocket | undefined, socketAccepted = false, socketClosed = false, closed = false;
  let phase: "configuring" | "proposal" | "checking" | "speech" = "configuring";
  let responseId: string | undefined, totalCharacters = 0, events = 0, audioBytes = 0, audioDone = false;
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
      if (event.type === "error") throw new Error("WORKFLOW_AI_UNAVAILABLE");
      if (event.type === "session.updated" && phase === "configuring") { completePhase(event); return; }
      if (event.type === "response.created") {
        if ((phase !== "proposal" && phase !== "speech") || responseId || !record(event.response)
          || typeof event.response.id !== "string" || !event.response.id) incomplete();
        responseId = event.response.id;
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
    const connecting = fetch(`https://api.openai.com/v1/realtime?model=${MODEL}`, {
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
    const configured = waitForPhase();
    send({ type: "session.update", session: {
      type: "realtime", model: MODEL, instructions, output_modalities: ["text"],
      audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, transcription: null, turn_detection: null },
        output: { format: { type: "audio/pcm", rate: 24_000 }, voice: WATTZUN_BRAND_VOICE, speed: preferences.speed } },
      max_output_tokens: PROPOSAL_TOKENS, reasoning: { effort: "minimal" }, parallel_tool_calls: false,
      tools: [{ type: "function", name: TOOL, description: "Return a reply proposal and unconfirmed request memory for validation. This tool cannot save or send anything.", parameters: schema }],
      tool_choice: { type: "function", name: TOOL },
    } });
    const configuration = await configured;
    const session = configuration.session;
    if (!record(session) || session.type !== "realtime" || !Array.isArray(session.output_modalities)
      || session.output_modalities.length !== 1 || session.output_modalities[0] !== "text"
      || !record(session.audio) || !record(session.audio.input) || !record(session.audio.input.format)
      || session.audio.input.format.type !== "audio/pcm" || (session.audio.input.format.rate ?? 24_000) !== 24_000
      || !record(session.audio.output) || !record(session.audio.output.format) || session.audio.output.format.type !== "audio/pcm"
      || (session.audio.output.format.rate ?? 24_000) !== 24_000 || session.audio.output.voice !== WATTZUN_BRAND_VOICE
      || (session.audio.output.speed ?? 1) !== preferences.speed || session.audio.input.turn_detection !== null) incomplete();
    phase = "proposal";
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: context }] } });
    for (let offset = 0; offset < pcm.byteLength; offset += 48_000) {
      send({ type: "input_audio_buffer.append", audio: Buffer.from(pcm.subarray(offset, offset + 48_000)).toString("base64") });
    }
    send({ type: "input_audio_buffer.commit" });
    const proposed = waitForPhase();
    send({ type: "response.create", response: { output_modalities: ["text"], tool_choice: { type: "function", name: TOOL },
      max_output_tokens: PROPOSAL_TOKENS, metadata: { phase: "proposal" } } });
    const event = await proposed;
    if (!record(event.response) || !Array.isArray(event.response.output) || event.response.output.length !== 1) incomplete();
    const item: unknown = event.response.output[0];
    if (!record(item) || item.type !== "function_call" || item.name !== TOOL || typeof item.arguments !== "string"
      || item.arguments.length > 18_000) incomplete();
    const raw: unknown = JSON.parse(item.arguments);
    if (!record(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, "reply") || !Object.hasOwn(raw, "requestSummary")) incomplete();
    const reply = contract.validate(raw.reply);
    // Apply the same bounded text and false-completion/source-access checks to
    // memory. It remains an explicitly unconfirmed interpretation of the input.
    const requestSummary = contract.validate({ kind: "answer", message: raw.requestSummary,
      questions: [], linkIds: [], action: null, lookup: null }).message;
    signal.throwIfAborted();
    try { await abortable(options.beforeSpeech(), signal); }
    catch (error) { approvalFailure = { error }; throw error; }
    signal.throwIfAborted();
    const audio = new ReadableStream<Uint8Array>({
      start(controller) { output = controller; },
      cancel() { close(); },
    }, { highWaterMark: 0 });
    phase = "speech"; responseId = undefined;
    send({ type: "response.create", response: {
      conversation: "none", output_modalities: ["audio"], instructions: WATTZUN_SPEECH_INSTRUCTIONS,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: wattzunSpokenReply(reply) }] }],
      tools: [], tool_choice: "none", max_output_tokens: SPEECH_TOKENS, reasoning: { effort: "minimal" }, metadata: { phase: "speech" },
    } });
    return { reply, requestSummary, audio };
  } catch (error) {
    close(error);
    // The trusted route hook owns access errors and their HTTP status. Provider
    // failures stay sanitized; hook errors retain their authoritative identity.
    if (approvalFailure && approvalFailure.error === error) throw error;
    throw safeError(error instanceof SyntaxError ? new Error("WORKFLOW_AI_INCOMPLETE") : error);
  }
}
