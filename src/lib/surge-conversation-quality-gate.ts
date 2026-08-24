import {
  SURGE_CONVERSATION_EVALUATION_CORPUS,
  SURGE_CONVERSATION_EVALUATION_DIMENSIONS,
  type SurgeConversationEvaluationDimension,
} from "../data/surge-conversation-evaluation-corpus.ts";

export const SURGE_CONVERSATION_RELEASE_THRESHOLDS = {
  correction: 0.95,
  topic_switch: 0.95,
  privacy: 1,
  follow_up: 0.98,
  source_status: 1,
  practical_guidance: 1,
  product_specification: 1,
  certificate_coverage: 1,
  brand_comparison: 1,
  context_clarification: 1,
} as const satisfies Record<SurgeConversationEvaluationDimension, number>;

export type SurgeConversationEvaluationResult = {
  caseId: string;
  dimension: SurgeConversationEvaluationDimension;
  passed: boolean;
  reviewedBy: string;
  reviewedOn: string;
  reviewStatus: "approved" | "rejected";
};

export function evaluateSurgeConversationReleaseGate(
  results: readonly SurgeConversationEvaluationResult[],
) {
  const corpusById = new Map(SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => [entry.id, entry]));
  const resultIds = new Set<string>();
  const coverageErrors: string[] = [];
  for (const result of results) {
    const corpusCase = corpusById.get(result.caseId);
    if (resultIds.has(result.caseId)) coverageErrors.push(`${result.caseId}: duplicate result`);
    resultIds.add(result.caseId);
    if (!corpusCase) coverageErrors.push(`${result.caseId}: orphan result`);
    else if (corpusCase.dimension !== result.dimension) coverageErrors.push(`${result.caseId}: dimension mismatch`);
    if (!result.reviewedBy.trim() || result.reviewStatus !== "approved") coverageErrors.push(`${result.caseId}: review approval missing`);
  }
  for (const corpusCase of SURGE_CONVERSATION_EVALUATION_CORPUS) {
    if (!resultIds.has(corpusCase.id)) coverageErrors.push(`${corpusCase.id}: result missing`);
  }
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
    ready: coverageErrors.length === 0 && SURGE_CONVERSATION_EVALUATION_DIMENSIONS.every((dimension) => dimensions[dimension].ready),
    dimensions,
    totalCases: SURGE_CONVERSATION_EVALUATION_CORPUS.length,
    totalResults: results.length,
    coverageErrors,
    failedDimensions: SURGE_CONVERSATION_EVALUATION_DIMENSIONS.filter(
      (dimension) => !dimensions[dimension].ready,
    ),
  };
}
