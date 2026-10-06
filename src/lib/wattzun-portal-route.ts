import { WattzunInputError, WATTZUN_MAX_AUDIO_BYTES, isWattzunPortal, parseWattzunTurn,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurnInput } from "./wattzun-portal";
import { authenticateWattzun, listWattzunScopes, requireWattzunAccess, wattzunAccessFailure,
  WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import { prepareWattzunPortalReply, transcribeWattzunPortalAudio, speakWattzunPortalReply } from "./wattzun-portal-ai-server";

type Context = WattzunAccess & { input: WattzunTurnInput };
export type WattzunRouteDependencies = {
  authenticate: (request: Request) => Promise<void>;
  scopes: (request: Request, portal: WattzunPortal) => Promise<WattzunScope[]>;
  access: (request: Request, portal: WattzunPortal, scopeId: string) => Promise<WattzunAccess>;
  reply: (options: Context) => Promise<WattzunReply>;
  transcribe: (options: Context & { audio: Blob }) => Promise<string>;
  speak: (options: Context & { reply: WattzunReply }) => Promise<{ base64: string; mimeType: "audio/mpeg" }>;
};
const defaults: WattzunRouteDependencies = {
  authenticate: authenticateWattzun, scopes: listWattzunScopes, access: requireWattzunAccess,
  reply: prepareWattzunPortalReply, transcribe: transcribeWattzunPortalAudio, speak: speakWattzunPortalReply,
};
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function json(body: object, status = 200) { return Response.json(body, { status, headers }); }
function failure(error: unknown) {
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
export async function postWattzunPortal(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Send your question as JSON." }, 415);
  }
  try {
    await deps.authenticate(request);
    requireOpenConversation(request);
    const bytes = await boundedBody(request, 40_000);
    if (!bytes) return json({ ok: false, error: "The conversation is too large. Start a new conversation." }, 413);
    const input = parseWattzunTurn(JSON.parse(new TextDecoder().decode(bytes)));
    const access = await deps.access(request, input.portal, input.scopeId);
    requireOpenConversation(request);
    const reply = await deps.reply({ ...access, input });
    await recheck(request, access, deps);
    return json({ ok: true, reply });
  } catch (error) { return failure(error); }
}
export async function postWattzunVoice(request: Request, deps = defaults): Promise<Response> {
  if (!acceptedOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return json({ ok: false, error: "Send a recorded voice turn." }, 415);
  try {
    await deps.authenticate(request);
    requireOpenConversation(request);
    const bytes = await boundedBody(request, WATTZUN_MAX_AUDIO_BYTES + 50_000);
    if (!bytes) return json({ ok: false, error: "That voice turn is too large. Keep it under 45 seconds." }, 413);
    const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    const raw = form.get("request");
    const audio = form.get("audio");
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 40_000 || !(audio instanceof Blob)
      || audio.size < 100 || audio.size > WATTZUN_MAX_AUDIO_BYTES
      || !/^audio\/(webm|mp4|mpeg|wav|ogg)(;codecs=[a-zA-Z0-9., -]+)?$/.test(audio.type)) {
      throw new WattzunInputError("Use a supported microphone recording smaller than 2 MB.");
    }
    const input = parseWattzunTurn(JSON.parse(raw), true);
    const access = await deps.access(request, input.portal, input.scopeId);
    requireOpenConversation(request);
    const transcript = await deps.transcribe({ ...access, input, audio });
    await recheck(request, access, deps);
    const spokenInput = { ...input, message: transcript };
    const reply = await deps.reply({ ...access, input: spokenInput });
    await recheck(request, access, deps);
    const speech = await deps.speak({ ...access, input: spokenInput, reply });
    await recheck(request, access, deps);
    return json({ ok: true, transcript, reply, audio: speech });
  } catch (error) { return failure(error); }
}
