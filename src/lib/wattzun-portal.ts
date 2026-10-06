import type { WattzunActionProposal } from "./wattzun-actions";
import type { WattzunRecordLookup } from "./wattzun-records";

export const WATTZUN_PORTALS = ["trade", "creditex", "council"] as const;
export type WattzunPortal = typeof WATTZUN_PORTALS[number];
export const WATTZUN_BRAND_VOICE = "cedar";
export const WATTZUN_BRAND_PERSONALITY = "Warm and conversational, with a little humour";
export type WattzunPreferences = { speed: 0.85 | 1 | 1.15 };
export const WATTZUN_DEFAULT_PREFERENCES: WattzunPreferences = { speed: 1 };
export type WattzunScope = { portal: WattzunPortal; scopeId: string; label: string };
export type WattzunTurn = { role: "user" | "assistant"; content: string };
export type WattzunTurnInput = {
  portal: WattzunPortal; scopeId: string; requestId: string; message: string;
  history: WattzunTurn[]; preferences: WattzunPreferences;
};
export type WattzunReply = {
  kind: "answer" | "clarification"; message: string; questions: string[];
  links: Array<{ label: string; href: string }>;
  action?: WattzunActionProposal | null;
  lookup?: WattzunRecordLookup | null;
};
export type WattzunVoiceAudio = { base64: string; mimeType: "audio/mpeg" }
  | { mimeType: "audio/pcm"; stream: ReadableStream<Uint8Array> };
export type WattzunVoiceResult = {
  ok: true; transcript: string; requestSummary?: string; reply: WattzunReply; audio: WattzunVoiceAudio;
};
export const WATTZUN_VOICE_STREAM_TYPE = "application/x-wattzun-voice+ndjson";
export const WATTZUN_REALTIME_VOICE_STREAM_TYPE = "application/x-wattzun-realtime-voice+ndjson";
export const WATTZUN_MAX_AUDIO_BYTES = 2_000_000;
export const WATTZUN_MAX_TURN_SECONDS = 45;
export const WATTZUN_MAX_WAV_AUDIO_BYTES = WATTZUN_MAX_TURN_SECONDS * 24_000 * 2 + 44;
export const WATTZUN_MAX_HISTORY_TURNS = 40;
export const WATTZUN_MAX_HISTORY_CHARACTERS = 24_000;

export class WattzunInputError extends Error {}
export { wattzunPortalForPath } from "./wattzun-portal-path.ts";
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function isWattzunPortal(value: unknown): value is WattzunPortal {
  return value === "trade" || value === "creditex" || value === "council";
}
export function parseWattzunPreferences(value: unknown): WattzunPreferences {
  if (value === undefined) return { ...WATTZUN_DEFAULT_PREFERENCES };
  if (!record(value) || !(value.speed === 0.85 || value.speed === 1 || value.speed === 1.15)) throw new WattzunInputError("Choose a supported speaking speed.");
  // Older or forged style fields cannot become instructions or change the brand voice.
  return { speed: value.speed };
}
export function parseWattzunTurn(value: unknown, audio = false): WattzunTurnInput {
  if (!record(value) || !isWattzunPortal(value.portal) || typeof value.scopeId !== "string"
    || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.scopeId)
    || typeof value.requestId !== "string" || !/^[A-Za-z0-9:_-]{16,72}$/.test(value.requestId)) {
    throw new WattzunInputError("Choose your workspace and try again.");
  }
  const message = audio ? "" : value.message;
  if (typeof message !== "string" || (!audio && !message.trim()) || message.length > 4_000) {
    throw new WattzunInputError("Enter a question under 4,000 characters.");
  }
  const history: WattzunTurn[] = [];
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > WATTZUN_MAX_HISTORY_TURNS) throw new WattzunInputError("Start a new conversation to continue.");
    for (const turn of value.history) {
      if (!record(turn) || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string" || !turn.content.trim() || turn.content.length > 4_000) {
        throw new WattzunInputError("The conversation could not be read. Start a new conversation.");
      }
      history.push({ role: turn.role, content: turn.content });
    }
  }
  if (JSON.stringify(history).length > WATTZUN_MAX_HISTORY_CHARACTERS) throw new WattzunInputError("Start a new conversation to continue.");
  return { portal: value.portal, scopeId: value.scopeId, requestId: value.requestId,
    message: message.trim(), history, preferences: parseWattzunPreferences(value.preferences) };
}
export function wattzunSpokenReply(reply: WattzunReply): string {
  return [reply.message, ...reply.questions].join("\n");
}
