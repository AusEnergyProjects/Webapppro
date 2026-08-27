import {
  SURGE_CONVERSATION_EVALUATION_CORPUS,
  SURGE_CONVERSATION_EVALUATION_DIMENSIONS,
  type SurgeConversationAssertion,
  type SurgeConversationEvaluationCase,
  type SurgeConversationEvaluationDimension,
} from "../data/surge-conversation-evaluation-corpus.ts";
import { surgePlainLanguageMetrics } from "./surge-everyday-answer.ts";

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
  directness: 1,
  plain_language: 1,
  actionability: 1,
  context_use: 1,
  progressive_detail: 1,
} as const satisfies Record<SurgeConversationEvaluationDimension, number>;

export type SurgeConversationEvaluationObservation = {
  caseId: string;
  response: string;
  answerSource: "deterministic" | "grounded" | "model";
  answerStatus: "answered" | "clarification_required" | "source_review_required" | "unavailable";
  latencyMs: number;
  requestedModel?: string;
  providerModel?: string;
  verdict?: string;
  reason?: string;
  practicalSteps?: readonly string[];
  extraDetail?: string;
  followUpQuestion?: string;
  quickReplies?: readonly { id: string; label: string; message: string }[];
};

export type SurgeConversationEvaluationResult = SurgeConversationEvaluationObservation & {
  dimension: SurgeConversationEvaluationDimension;
  passed: boolean;
  failures: readonly string[];
  reviewedBy: string;
  reviewedOn: string;
  reviewStatus: "approved";
};

function countQuestions(response: string) {
  return (response.match(/\?/g) ?? []).length;
}

function evaluateAssertion(
  assertion: SurgeConversationAssertion,
  observation: SurgeConversationEvaluationObservation,
): string | null {
  const lowerResponse = observation.response.toLocaleLowerCase("en-AU");
  switch (assertion.type) {
    case "includes_all": {
      const missing = assertion.values.filter((value) => !lowerResponse.includes(value.toLocaleLowerCase("en-AU")));
      return missing.length ? `missing required text: ${missing.join(", ")}` : null;
    }
    case "excludes_all": {
      const present = assertion.values.filter((value) => lowerResponse.includes(value.toLocaleLowerCase("en-AU")));
      return present.length ? `included excluded text: ${present.join(", ")}` : null;
    }
    case "matches":
      return new RegExp(assertion.pattern, assertion.flags).test(observation.response)
        ? null
        : `response did not match /${assertion.pattern}/${assertion.flags ?? ""}`;
    case "max_questions": {
      const count = countQuestions(observation.response);
      return count <= assertion.maximum ? null : `asked ${count} questions, maximum is ${assertion.maximum}`;
    }
    case "max_words": {
      const count = surgePlainLanguageMetrics(observation.response).wordCount;
      return count <= assertion.maximum ? null : `used ${count} words, maximum is ${assertion.maximum}`;
    }
    case "max_average_sentence_words": {
      const count = surgePlainLanguageMetrics(observation.response).averageSentenceWords;
      return count <= assertion.maximum ? null : `average sentence length was ${count} words, maximum is ${assertion.maximum}`;
    }
    case "max_sentence_words": {
      const count = surgePlainLanguageMetrics(observation.response).longestSentenceWords;
      return count <= assertion.maximum ? null : `longest sentence was ${count} words, maximum is ${assertion.maximum}`;
    }
    case "max_jargon": {
      const count = surgePlainLanguageMetrics(observation.response).jargonCount;
      return count <= assertion.maximum ? null : `used ${count} blocked jargon phrase(s), maximum is ${assertion.maximum}`;
    }
    case "requires_structured_answer":
      return observation.verdict?.trim() && observation.reason?.trim()
        ? null
        : "structured verdict and reason were missing";
    case "min_practical_steps": {
      const count = observation.practicalSteps?.filter((step) => step.trim()).length || 0;
      return count >= assertion.minimum ? null : `included ${count} practical steps, minimum is ${assertion.minimum}`;
    }
    case "requires_extra_detail":
      return observation.extraDetail?.trim() ? null : "progressive extra detail was missing";
    case "quick_reply_range": {
      const count = observation.quickReplies?.length || 0;
      return count >= assertion.minimum && count <= assertion.maximum
        ? null
        : `included ${count} quick replies, expected ${assertion.minimum} to ${assertion.maximum}`;
    }
    case "answer_source":
      return observation.answerSource === assertion.value
        ? null
        : `answer source was ${observation.answerSource}, expected ${assertion.value}`;
    case "answer_status":
      return observation.answerStatus === assertion.value
        ? null
        : `answer status was ${observation.answerStatus}, expected ${assertion.value}`;
  }
}

export function evaluateSurgeConversationCase(
  evaluationCase: SurgeConversationEvaluationCase,
  observation: SurgeConversationEvaluationObservation,
): SurgeConversationEvaluationResult {
  const failures = [
    ...evaluationCase.assertions.map((assertion) => evaluateAssertion(assertion, observation)).filter((value): value is string => Boolean(value)),
    ...evaluationCase.prohibitedPatterns.flatMap((prohibited) => (
      new RegExp(prohibited.pattern, prohibited.flags).test(observation.response)
        ? [`prohibited pattern matched (${prohibited.reason})`]
        : []
    )),
    ...(!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0
      ? ["latency must be a non-negative finite number"]
      : []),
  ];

  return {
    ...observation,
    dimension: evaluationCase.dimension,
    passed: failures.length === 0,
    failures,
    reviewedBy: evaluationCase.reviewedBy,
    reviewedOn: evaluationCase.reviewedOn,
    reviewStatus: evaluationCase.reviewStatus,
  };
}

export function evaluateSurgeConversationCorpus(
  observations: readonly SurgeConversationEvaluationObservation[],
) {
  const observationsById = new Map(observations.map((observation) => [observation.caseId, observation]));
  return SURGE_CONVERSATION_EVALUATION_CORPUS.flatMap((evaluationCase) => {
    const observation = observationsById.get(evaluationCase.id);
    return observation ? [evaluateSurgeConversationCase(evaluationCase, observation)] : [];
  });
}

export function evaluateSurgeConversationReleaseGate(
  observations: readonly SurgeConversationEvaluationObservation[],
) {
  const corpusById = new Map(SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => [entry.id, entry]));
  const resultIds = new Set<string>();
  const coverageErrors: string[] = [];
  for (const observation of observations) {
    if (resultIds.has(observation.caseId)) coverageErrors.push(`${observation.caseId}: duplicate observation`);
    resultIds.add(observation.caseId);
    if (!corpusById.has(observation.caseId)) coverageErrors.push(`${observation.caseId}: orphan observation`);
  }
  for (const corpusCase of SURGE_CONVERSATION_EVALUATION_CORPUS) {
    if (!resultIds.has(corpusCase.id)) coverageErrors.push(`${corpusCase.id}: observation missing`);
    if (!corpusCase.reviewedBy.trim() || corpusCase.reviewStatus !== "approved") {
      coverageErrors.push(`${corpusCase.id}: review approval missing`);
    }
  }

  const results = evaluateSurgeConversationCorpus(observations);
  const dimensions = Object.fromEntries(SURGE_CONVERSATION_EVALUATION_DIMENSIONS.map((dimension) => {
    const matching = results.filter((result) => result.dimension === dimension);
    const passed = matching.filter((result) => result.passed).length;
    const passRate = matching.length ? passed / matching.length : 0;
    return [dimension, {
      evaluated: matching.length,
      passed,
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
    failedDimensions: SURGE_CONVERSATION_EVALUATION_DIMENSIONS.filter((dimension) => !dimensions[dimension].ready),
    results,
  };
}
