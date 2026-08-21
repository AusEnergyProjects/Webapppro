import type { EnergyAssistantAudience } from "../data/energy-assistant-knowledge.ts";
import {
  classifySurgeConversationTurn,
  type SurgeConversationState,
  type SurgeConversationTurnIntent,
} from "./energy-assistant-conversation.ts";

export type SurgeConversationAnswerSource = "deterministic" | "model";
export type SurgeConversationAnswerStatus = "answered" | "needs_context" | "source_review_required";

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
};

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
  };
}
