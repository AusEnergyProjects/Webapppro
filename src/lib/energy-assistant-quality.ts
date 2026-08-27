import type { EnergyAssistantAudience } from "../data/energy-assistant-knowledge.ts";
import {
  classifySurgeConversationTurn,
  type SurgeConversationState,
  type SurgeConversationTurnIntent,
} from "./energy-assistant-conversation.ts";
import {
  surgePresentationPassesEverydayLanguage,
  type SurgeAnswerPresentation,
} from "./surge-everyday-answer.ts";

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
  directnessPassed: boolean;
  plainLanguagePassed: boolean;
  actionabilityExpected: boolean;
  actionabilityPassed: boolean;
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
  presentation: SurgeAnswerPresentation;
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
  const actionabilityExpected = /\b(?:what should|where should|how (?:do|can|should)|start|do next|actually do|good quote|worth it)\b/i.test(input.message);
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
    directnessPassed: Boolean(input.presentation.verdict.trim())
      && input.presentation.verdict.trim().split(/\s+/u).length <= 28,
    plainLanguagePassed: surgePresentationPassesEverydayLanguage(input.presentation),
    actionabilityExpected,
    actionabilityPassed: !actionabilityExpected || input.presentation.steps.length > 0,
    latencyMs: latencyMilliseconds(input.latencyMs),
    metadata: qualityMetadata(input.metadata),
  };
}
