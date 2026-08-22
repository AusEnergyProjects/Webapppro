import {
  SURGE_CONVERSATION_EVALUATION_DIMENSIONS,
  type SurgeConversationEvaluationDimension,
} from "../data/surge-conversation-evaluation-corpus.ts";

export const SURGE_CONVERSATION_RELEASE_THRESHOLDS = {
  correction: 0.95,
  topic_switch: 0.95,
  privacy: 1,
  follow_up: 0.98,
  source_status: 1,
} as const satisfies Record<SurgeConversationEvaluationDimension, number>;

export type SurgeConversationEvaluationResult = {
  caseId: string;
  dimension: SurgeConversationEvaluationDimension;
  passed: boolean;
};

export function evaluateSurgeConversationReleaseGate(
  results: readonly SurgeConversationEvaluationResult[],
) {
  const dimensions = Object.fromEntries(SURGE_CONVERSATION_EVALUATION_DIMENSIONS.map((dimension) => {
    const matching = results.filter((result) => result.dimension === dimension);
    const passRate = matching.length
      ? matching.filter((result) => result.passed).length / matching.length
      : 0;
    return [dimension, {
      evaluated: matching.length,
      passed: matching.filter((result) => result.passed).length,
      passRate,
      threshold: SURGE_CONVERSATION_RELEASE_THRESHOLDS[dimension],
      ready: matching.length > 0 && passRate >= SURGE_CONVERSATION_RELEASE_THRESHOLDS[dimension],
    }];
  })) as Record<SurgeConversationEvaluationDimension, {
    evaluated: number;
    passed: number;
    passRate: number;
    threshold: number;
    ready: boolean;
  }>;

  return {
    ready: SURGE_CONVERSATION_EVALUATION_DIMENSIONS.every((dimension) => dimensions[dimension].ready),
    dimensions,
    failedDimensions: SURGE_CONVERSATION_EVALUATION_DIMENSIONS.filter(
      (dimension) => !dimensions[dimension].ready,
    ),
  };
}
