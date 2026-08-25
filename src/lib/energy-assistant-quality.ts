import type { EnergyAssistantAudience } from "../data/energy-assistant-knowledge.ts";
import {
  classifySurgeConversationTurn,
  type SurgeConversationState,
  type SurgeConversationTurnIntent,
} from "./energy-assistant-conversation.ts";

export type SurgeConversationAnswerSource = "deterministic" | "grounded" | "model";
export type SurgeConversationAnswerStatus = "answered" | "needs_context" | "source_review_required";

export type SurgeConversationQualityMetadata = {
  corpusSha256: string;
  promptSha256: string;
  sourceSha256: string;
  appVersion: string;
  gitSha: string;
  deploymentId: string;
  requestedModel: string;
  providerModel: string;
};

export type SurgeConversationQualityEvent = {
  day: string;
  audience: EnergyAssistantAudience;
  turnIntent: SurgeConversationTurnIntent;
  answerSource: SurgeConversationAnswerSource;
  answerStatus: SurgeConversationAnswerStatus;
  correctionExpected: boolean;
  correctionPassed: boolean;
  topicSwitchExpected: boolean;
  topicSwitchPassed: boolean;
  privacyPassed: boolean;
  followUpPassed: boolean;
  latencyMs: number;
  metadata: SurgeConversationQualityMetadata;
};

const QUALITY_METADATA_MAX_CHARS = 160;

function cleanQualityMetadata(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, QUALITY_METADATA_MAX_CHARS);
}

function qualityMetadata(
  source: Partial<SurgeConversationQualityMetadata> | null | undefined,
): SurgeConversationQualityMetadata {
  return {
    corpusSha256: cleanQualityMetadata(source?.corpusSha256),
    promptSha256: cleanQualityMetadata(source?.promptSha256),
    sourceSha256: cleanQualityMetadata(source?.sourceSha256),
    appVersion: cleanQualityMetadata(source?.appVersion),
    gitSha: cleanQualityMetadata(source?.gitSha),
    deploymentId: cleanQualityMetadata(source?.deploymentId),
    requestedModel: cleanQualityMetadata(source?.requestedModel),
    providerModel: cleanQualityMetadata(source?.providerModel),
  };
}

function latencyMilliseconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 3_600_000);
}

function correctionStateSignature(state: SurgeConversationState | null) {
  if (!state) return "";
  return JSON.stringify({
    activeTopic: state.activeTopic,
    goal: state.goal,
    facts: [...state.facts].sort((left, right) => left.key.localeCompare(right.key)),
  });
}

export function evaluateSurgeConversationQuality(input: {
  day: string;
  audience: EnergyAssistantAudience;
  message: string;
  before: SurgeConversationState | null;
  after: SurgeConversationState;
  answerSource: SurgeConversationAnswerSource;
  answerStatus: SurgeConversationAnswerStatus;
  publicPolicyPassed: boolean;
  followUpQuestion: string;
  latencyMs?: number;
  metadata?: Partial<SurgeConversationQualityMetadata>;
}): SurgeConversationQualityEvent {
  const turnIntent = classifySurgeConversationTurn(input.message, input.before);
  const correctionExpected = turnIntent === "correction" || turnIntent === "correction_and_topic_change";
  const topicSwitchExpected = turnIntent === "topic_change" || turnIntent === "correction_and_topic_change";
  const correctionPassed = !correctionExpected
    || correctionStateSignature(input.before) !== correctionStateSignature(input.after);
  const topicSwitchPassed = !topicSwitchExpected
    || Boolean(input.after.activeTopic && input.after.activeTopic !== (input.before?.activeTopic || "general"));
  const followUpQuestionMarks = input.followUpQuestion.match(/\?/g)?.length || 0;
  return {
    day: input.day,
    audience: input.audience,
    turnIntent,
    answerSource: input.answerSource,
    answerStatus: input.answerStatus,
    correctionExpected,
    correctionPassed,
    topicSwitchExpected,
    topicSwitchPassed,
    privacyPassed: input.publicPolicyPassed,
    followUpPassed: input.followUpQuestion.length <= 220 && followUpQuestionMarks <= 1,
    latencyMs: latencyMilliseconds(input.latencyMs),
    metadata: qualityMetadata(input.metadata),
  };
}
