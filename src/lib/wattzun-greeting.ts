import { WattzunInputError, parseWattzunTurn, type WattzunTurnInput } from "./wattzun-portal.ts";

const GREETING_KEYS = ["portal", "scopeId", "requestId", "name", "preferences"];
const NAME_TOKEN = String.raw`\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*`;
const DISPLAY_NAME = new RegExp(`^${NAME_TOKEN}(?: +${NAME_TOKEN})*$`, "u");
const UNNAMED_GREETING = "Hi, I'm here. What can I help you with?";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Return only the bounded first name from an explicitly personal name source. */
export function wattzunPersonalGreetingName(name: unknown): string | undefined {
  if (typeof name !== "string" || !name || name.length > 120 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return undefined;
  const displayName = name.trim();
  if (!DISPLAY_NAME.test(displayName)) return undefined;
  const firstName = displayName.split(/ +/, 1)[0];
  return firstName.length <= 40 ? firstName : undefined;
}

function greetingMessage(name: string | undefined): string {
  const firstName = wattzunPersonalGreetingName(name);
  return firstName ? `Hi ${firstName}, I'm here. What can I help you with?` : UNNAMED_GREETING;
}

/** Only a bounded name token can enter this fixed greeting; caller text is never instructions. */
export function parseWattzunGreeting(raw: unknown): WattzunTurnInput {
  if (!record(raw) || Object.keys(raw).some(key => !GREETING_KEYS.includes(key))
    || (raw.name !== undefined && typeof raw.name !== "string")
    || (raw.preferences !== undefined && (!record(raw.preferences)
      || Object.keys(raw.preferences).some(key => key !== "speed")))) {
    throw new WattzunInputError("Send a supported Wattzun greeting.");
  }
  return parseWattzunTurn({ portal: raw.portal, scopeId: raw.scopeId, requestId: raw.requestId,
    message: greetingMessage(raw.name), history: [], preferences: raw.preferences });
}
