import { WattzunInputError, WATTZUN_MAX_AUDIO_BYTES, WATTZUN_MAX_WAV_AUDIO_BYTES, WATTZUN_VOICE_STREAM_TYPE, WATTZUN_REALTIME_VOICE_STREAM_TYPE, isWattzunPortal, parseWattzunTurn,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurnInput } from "./wattzun-portal";
import { authenticateWattzun, listWattzunScopes, requireWattzunAccess, wattzunAccessFailure,
  WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import { prepareWattzunPortalReply, transcribeWattzunPortalAudio, speakWattzunPortalReply, streamWattzunPortalReply } from "./wattzun-portal-ai-server";
import { prepareWattzunRealtimeTurn } from "./wattzun-realtime-server";
import { parseWattzunUsageScope, type WattzunUsage } from "./wattzun-usage";
import { readWattzunUsage, recordWattzunUsage, WattzunUsageError, type WattzunUsageRecord } from "./wattzun-usage-server";

type Context = WattzunAccess & { input: WattzunTurnInput; signal?: AbortSignal };
export type WattzunRouteDependencies = {
  authenticate: (request: Request) => Promise<void>;
  scopes: (request: Request, portal: WattzunPortal) => Promise<WattzunScope[]>;
  access: (request: Request, portal: WattzunPortal, scopeId: string) => Promise<WattzunAccess>;
  reply: (options: Context) => Promise<WattzunReply>;
  transcribe: (options: Context & { audio: Blob }) => Promise<string>;
  speak: (options: Context & { reply: WattzunReply }) => Promise<{ base64: string; mimeType: "audio/mpeg" }>;
  streamSpeak: (options: Context & { reply: WattzunReply }) => Promise<ReadableStream<Uint8Array>>;
  realtime: (options: Context & { audio: Blob; beforeSpeech: () => Promise<void> }) => Promise<{ reply: WattzunReply; audio: ReadableStream<Uint8Array>; transcript?: string; requestSummary?: string }>;
  recordUsage: (options: WattzunUsageRecord) => Promise<void>;
  usage: (access: WattzunAccess) => Promise<WattzunUsage>;
};
const defaults: WattzunRouteDependencies = {
  authenticate: authenticateWattzun, scopes: listWattzunScopes, access: requireWattzunAccess,
  reply: prepareWattzunPortalReply, transcribe: transcribeWattzunPortalAudio, speak: speakWattzunPortalReply, streamSpeak: streamWattzunPortalReply,
  realtime: prepareWattzunRealtimeTurn,
  recordUsage: recordWattzunUsage, usage: readWattzunUsage,
};
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(body: object, status = 200) { return Response.json(body, { status, headers }); }
function turnTimer() {
  const started = performance.now();
  const durations = new Map<"auth" | "access" | "stt" | "llm" | "tts" | "realtime" | "usage", number>();
  return {
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
  try {
    await timing.run("auth", () => deps.authenticate(request));
    requireOpenConversation(request);
    const bytes = await boundedBody(request, 40_000);
    if (!bytes) return json({ ok: false, error: "The conversation is too large. Start a new conversation." }, 413);
    const input = parseWattzunTurn(JSON.parse(new TextDecoder().decode(bytes)));
    const access = await timing.run("access", () => deps.access(request, input.portal, input.scopeId));
    requireOpenConversation(request);
    const reply = await timing.run("llm", () => deps.reply({ ...access, input, signal: request.signal }));
    const latest = await timing.run("access", () => recheck(request, access, deps));
    await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "text" }));
    return timing.response(json({ ok: true, reply }));
  } catch (error) { return timing.response(failure(error)); }
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
    if (realtime) {
      const prepared = await timing.run("realtime", () => deps.realtime({ ...access, input, audio, signal: request.signal,
        beforeSpeech: async () => { await timing.run("access", () => recheck(request, access, deps)); } }));
      speechStream = prepared.audio;
      const latest = await timing.run("access", () => recheck(request, access, deps));
      await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
      requireOpenConversation(request);
      const response = timing.response(new Response(voiceFrames(prepared.transcript || "", prepared.reply, speechStream, request.signal, prepared.requestSummary),
        { headers: { ...headers, "Content-Type": WATTZUN_REALTIME_VOICE_STREAM_TYPE } }));
      handedOff = true;
      return response;
    }
    const transcript = await timing.run("stt", () => deps.transcribe({ ...access, input, audio, signal: request.signal }));
    await timing.run("access", () => recheck(request, access, deps));
    const spokenInput = { ...input, message: transcript };
    const reply = await timing.run("llm", () => deps.reply({ ...access, input: spokenInput, signal: request.signal }));
    await timing.run("access", () => recheck(request, access, deps));
    // Existing open calls retain JSON/MP3 until they reload. New clients negotiate PCM frames.
    if (request.headers.get("accept") === WATTZUN_VOICE_STREAM_TYPE) {
      speechStream = await timing.run("tts", () => deps.streamSpeak({ ...access, input: spokenInput, reply, signal: request.signal }));
      const latest = await timing.run("access", () => recheck(request, access, deps));
      await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
      requireOpenConversation(request);
      const response = timing.response(new Response(voiceFrames(transcript, reply, speechStream, request.signal),
        { headers: { ...headers, "Content-Type": WATTZUN_VOICE_STREAM_TYPE } }));
      handedOff = true;
      return response;
    }
    const speech = await timing.run("tts", () => deps.speak({ ...access, input: spokenInput, reply, signal: request.signal }));
    const latest = await timing.run("access", () => recheck(request, access, deps));
    await timing.run("usage", () => deps.recordUsage({ access: latest, requestId: input.requestId, kind: "voice" }));
    return timing.response(json({ ok: true, transcript, reply, audio: speech }));
  } catch (error) { return timing.response(failure(error)); }
  finally { if (speechStream && !handedOff) await speechStream.cancel().catch(() => {}); }
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
