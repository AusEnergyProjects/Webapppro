import type { WattzunActionProposal } from "./wattzun-actions";
import type { WattzunRecordLookup } from "./wattzun-records";
import type { WattzunNavigationAction } from "./wattzun-navigation";
import { isWattzunWorkflowProposal, type WattzunWorkflowProposal, type WattzunWorkflowOperation, type WattzunWorkflowResult } from "./wattzun-workflow.ts";
import { readWattzunWorkReference, type WattzunWorkReference, type WattzunWorkContextInfo } from "./wattzun-work-context.ts";
import { readWattzunFormGuideInput, readWattzunFormGuideControl, type WattzunFormGuideInput, type WattzunFormGuideControl, type WattzunFormGuideProgress } from "./wattzun-form-guide.ts";
import type { WattzunFormProductSearchAction } from "./wattzun-form-step.ts";

export const WATTZUN_PORTALS = ["trade", "creditex", "council"] as const;
export type WattzunPortal = typeof WATTZUN_PORTALS[number];
export const WATTZUN_BRAND_VOICE = "cedar";
export const WATTZUN_BRAND_PERSONALITY = "Warm and conversational, with a little humour";
export type WattzunPreferences = { speed: 0.85 | 1 | 1.15 };
export const WATTZUN_DEFAULT_PREFERENCES: WattzunPreferences = { speed: 1 };
export type WattzunScope = { portal: WattzunPortal; scopeId: string; label: string; personalName?: string };
export type WattzunTurn = { role: "user" | "assistant"; content: string };
export type WattzunTurnInput = {
  portal: WattzunPortal; scopeId: string; requestId: string; message: string;
  history: WattzunTurn[]; preferences: WattzunPreferences;
  workReference?: WattzunWorkReference;
  workflowReviewId?: string;
  workflowProposal?: WattzunWorkflowOperation;
  formGuide?: WattzunFormGuideInput;
  formGuideControl?: WattzunFormGuideControl;
};
export type WattzunReply = {
  kind: "answer" | "clarification"; message: string; questions: string[];
  links: Array<{ label: string; href: string }>;
  action?: WattzunActionProposal | WattzunWorkflowProposal | WattzunNavigationAction | WattzunFormGuideControl | WattzunFormProductSearchAction | null;
  lookup?: WattzunRecordLookup | null;
  workContext?: WattzunWorkContextInfo;
  workflow?: WattzunWorkflowResult;
  formGuide?: WattzunFormGuideProgress;
  formGuideRecovery?: { requestId: string; state: "saved" | "not_saved" | "uncertain" };
};
export type WattzunVoiceAudio = { base64: string; mimeType: "audio/mpeg" }
  | { mimeType: "audio/pcm"; stream: ReadableStream<Uint8Array> };
export type WattzunVoiceResult = {
  ok: true; transcript: string; inputTranscript?: Promise<string>; requestSummary?: string; reply: WattzunReply; audio: WattzunVoiceAudio;
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
  const workReference = value.workReference === undefined ? undefined : readWattzunWorkReference(value.workReference, value.portal);
  if (workReference === null) throw new WattzunInputError("Choose a work item in your current portal before asking Wattzun about it.");
  const workflowReviewId = value.workflowReviewId;
  const workflowProposal = value.workflowProposal;
  if (workflowReviewId !== undefined && (value.portal !== "trade" || typeof workflowReviewId !== "string" || !/^[A-Za-z0-9:_-]{16,180}$/.test(workflowReviewId))) throw new WattzunInputError("Review the workflow in your current TLink business first.");
  if (workflowProposal !== undefined && (value.portal !== "trade" || !isWattzunWorkflowProposal(workflowProposal) || workflowProposal.kind === "confirm_workflow")) throw new WattzunInputError("Prepare a supported workflow in your TLink business.");
  if (workflowReviewId !== undefined && workflowProposal !== undefined) throw new WattzunInputError("Continue one reviewed workflow at a time.");
  const formGuide = value.formGuide === undefined ? undefined : readWattzunFormGuideInput(value.formGuide);
  const formGuideControl = value.formGuideControl === undefined ? undefined : readWattzunFormGuideControl(value.formGuideControl);
  if (formGuide === null || formGuide && (value.portal !== "trade" || workReference?.kind !== "trade_form" || workflowReviewId !== undefined || workflowProposal !== undefined)) throw new WattzunInputError("Start guided completion from the form you want to fill.");
  if (formGuideControl === null || formGuideControl && !formGuide) throw new WattzunInputError("Choose a question in your guided form first.");
  return { portal: value.portal, scopeId: value.scopeId, requestId: value.requestId,
    message: message.trim(), history, preferences: parseWattzunPreferences(value.preferences), ...(workReference ? { workReference } : {}),
    ...(typeof workflowReviewId === "string" ? { workflowReviewId } : {}),
    ...(isWattzunWorkflowProposal(workflowProposal) ? { workflowProposal } : {}),
    ...(formGuide ? { formGuide } : {}), ...(formGuideControl ? { formGuideControl } : {}) };
}
export function wattzunSpokenReply(reply: WattzunReply): string {
  return [reply.message, ...reply.questions].join("\n");
}
