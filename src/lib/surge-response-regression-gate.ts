import type {
  SurgeResponseRegressionCase,
} from "../data/surge-response-regression-corpus.ts";

export const SURGE_RESPONSE_REGRESSION_NEAR_DUPLICATE_THRESHOLD = 0.86;

export const SURGE_RESPONSE_GENERIC_FALLBACK_PATTERNS = [
  "\\bstaged whole-home diagnosis\\b",
  "\\baffected room or major end use\\b",
  "\\b(?:question|request|query) is not specific enough\\b",
  "\\bI (?:found|have) (?:a )?related (?:current )?official source\\b",
  "\\bname the exact home-energy decision\\b",
  "\\btell me the home or trade decision\\b",
  "\\bwhat topic would you like (?:covered|recreated)\\b",
  "\\bgoverned (?:product )?evidence could not be verified\\b",
  "\\bFor the supplied Victoria owner context\\b",
  "^\\s*(?:it depends|that depends|I need more (?:details|information|context)|please provide more (?:details|information|context))[.!?]*\\s*$",
] as const;

export type SurgeResponseRegressionObservation = {
  caseId: string;
  httpStatus: number;
  visibleAnswer: string;
  content: string;
  directAnswer: string;
  followUpQuestion: string;
  quickReplies: readonly unknown[];
  modelReservations?: number;
  modelAttempted?: boolean;
  modelFailureCode?: string;
  modelFailureStage?: string;
  answerSource?: string;
  error?: string;
  latencyMs?: number;
};

export type SurgeResponseRegressionGateOptions = {
  /** Paid release evidence requires every model-allowed case to use an accepted model answer. */
  requireAllowedModel?: boolean;
};

export type SurgeResponseRegressionFailureCode =
  | "transport"
  | "empty_response"
  | "required_concept"
  | "numeric_integrity"
  | "context"
  | "multipart"
  | "forbidden_content"
  | "generic_fallback"
  | "length"
  | "paragraph_limit"
  | "follow_up_limit"
  | "quick_reply"
  | "model_policy"
  | "safety_lead"
  | "safety_follow_up"
  | "missing_observation"
  | "duplicate_observation"
  | "orphan_observation"
  | "duplicate_answer"
  | "near_duplicate_answer";

export type SurgeResponseRegressionFailure = {
  caseId: string;
  family: string;
  code: SurgeResponseRegressionFailureCode;
  detail: string;
};

export type SurgeResponseRegressionCaseResult = {
  caseId: string;
  family: string;
  passed: boolean;
  failures: readonly SurgeResponseRegressionFailure[];
};

export type SurgeResponseRegressionReport = {
  ready: boolean;
  caseCount: number;
  passedCases: number;
  failedCases: number;
  failureCount: number;
  results: readonly SurgeResponseRegressionCaseResult[];
  globalFailures: readonly SurgeResponseRegressionFailure[];
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : [];
}

/** Mirrors the customer-visible answer layout without including hidden API prose. */
export function surgeVisibleAnswerFromReply(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const reply = value as Record<string, unknown>;
  const verdict = stringValue(reply.verdict);
  const answerType = stringValue(reply.answerType ?? reply.answer_type);
  const directAnswer = stringValue(reply.directAnswer ?? reply.direct_answer);
  const content = stringValue(reply.content);
  if (!verdict) return directAnswer || content;
  const sections = [
    verdict,
    stringValue(reply.reason),
    ...stringValues(reply.practicalSteps ?? reply.practical_steps ?? reply.steps),
    stringValue(reply.extraDetail ?? reply.extra_detail),
  ].filter(Boolean);
  return answerType === "starting_plan" || answerType === "safety"
    ? sections.join("\n\n")
    : sections.join(" ");
}

function visibleText(observation: SurgeResponseRegressionObservation) {
  return observation.visibleAnswer.trim();
}

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .replace(/[^a-z0-9$%.]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function matches(value: string, pattern: string) {
  try {
    return new RegExp(pattern, "iu").test(value);
  } catch {
    return false;
  }
}

function words(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function paragraphCount(value: string) {
  return value
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .length;
}

function fiveGrams(value: string) {
  const tokens = normalise(value).split(" ").filter(Boolean);
  const grams = new Set<string>();
  for (let index = 0; index <= tokens.length - 5; index += 1) {
    grams.add(tokens.slice(index, index + 5).join(" "));
  }
  return grams;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) {
    if (larger.has(value)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function failure(
  testCase: SurgeResponseRegressionCase,
  code: SurgeResponseRegressionFailureCode,
  detail: string,
): SurgeResponseRegressionFailure {
  return { caseId: testCase.id, family: testCase.family, code, detail };
}

function conceptFailureCode(testCase: SurgeResponseRegressionCase) {
  if (testCase.tags.includes("context")) return "context" as const;
  if (testCase.tags.includes("multi_part")) return "multipart" as const;
  return "required_concept" as const;
}

export function evaluateSurgeResponseRegressionCase(
  testCase: SurgeResponseRegressionCase,
  observation: SurgeResponseRegressionObservation,
  options: SurgeResponseRegressionGateOptions = {},
): SurgeResponseRegressionCaseResult {
  const failures: SurgeResponseRegressionFailure[] = [];
  const text = visibleText(observation);
  const searchableText = text;

  if (observation.httpStatus !== 200 || observation.error) {
    failures.push(failure(
      testCase,
      "transport",
      observation.error || `HTTP ${observation.httpStatus}`,
    ));
  }
  if (!text) {
    failures.push(failure(testCase, "empty_response", "The visible response was empty."));
  }

  for (const clause of testCase.clauses) {
    if (!clause.anyOf.some((pattern) => matches(searchableText, pattern))) {
      failures.push(failure(
        testCase,
        conceptFailureCode(testCase),
        `Missing concept clause ${clause.id}.`,
      ));
    }
  }
  for (const assertion of testCase.requiredNumbers) {
    if (!assertion.anyOf.some((pattern) => matches(searchableText, pattern))) {
      failures.push(failure(
        testCase,
        "numeric_integrity",
        `Did not preserve required quantity ${assertion.id}.`,
      ));
    }
  }
  for (const pattern of testCase.forbiddenPatterns) {
    if (matches(searchableText, pattern)) {
      failures.push(failure(
        testCase,
        "forbidden_content",
        `Matched forbidden pattern ${pattern}.`,
      ));
    }
  }
  for (const pattern of SURGE_RESPONSE_GENERIC_FALLBACK_PATTERNS) {
    if (matches(searchableText, pattern)) {
      failures.push(failure(
        testCase,
        "generic_fallback",
        `Matched generic non-answer pattern ${pattern}.`,
      ));
    }
  }

  const responseWords = words(text).length;
  if (responseWords > testCase.maxWords) {
    failures.push(failure(
      testCase,
      "length",
      `Response had ${responseWords} words; limit is ${testCase.maxWords}.`,
    ));
  }
  const responseParagraphs = paragraphCount(text);
  if (responseParagraphs > testCase.maxParagraphs) {
    failures.push(failure(
      testCase,
      "paragraph_limit",
      `Response had ${responseParagraphs} paragraphs; limit is ${testCase.maxParagraphs}.`,
    ));
  }
  const followUpCount = observation.followUpQuestion.trim() ? 1 : 0;
  if (followUpCount > testCase.maxQuestions) {
    failures.push(failure(
      testCase,
      "follow_up_limit",
      `Response supplied ${followUpCount} follow-up question; limit is ${testCase.maxQuestions}.`,
    ));
  }
  if (observation.quickReplies.length > 0) {
    failures.push(failure(
      testCase,
      "quick_reply",
      `Response supplied ${observation.quickReplies.length} quick replies; none are allowed.`,
    ));
  }
  if (testCase.modelPolicy === "forbidden"
    && ((observation.modelReservations || 0) > 0 || observation.answerSource === "model")) {
    failures.push(failure(
      testCase,
      "model_policy",
      "A deterministic-only case attempted or used the model path.",
    ));
  }
  if (testCase.modelPolicy === "allowed" && options.requireAllowedModel) {
    const reservations = observation.modelReservations || 0;
    const failureCode = observation.modelFailureCode?.trim() || "";
    const acceptedModelAnswer = reservations >= 1
      && observation.modelAttempted === true
      && !failureCode
      && observation.answerSource === "model";
    if (!acceptedModelAnswer) {
      failures.push(failure(
        testCase,
        "model_policy",
        "The paid model path did not deliver an accepted model answer for this model-allowed case.",
      ));
    }
  }
  if (testCase.modelPolicy === "official_lookup" && options.requireAllowedModel) {
    const reservations = observation.modelReservations || 0;
    const failureCode = observation.modelFailureCode?.trim() || "";
    const acceptedModelAnswer = reservations >= 1
      && observation.modelAttempted === true
      && !failureCode
      && observation.answerSource === "model";
    const responsibleFailClosedAnswer = reservations >= 1
      && observation.modelAttempted === true
      && Boolean(failureCode)
      && observation.answerSource === "deterministic"
      && /\bcould not verify\b/i.test(text);
    if (!acceptedModelAnswer && !responsibleFailClosedAnswer) {
      failures.push(failure(
        testCase,
        "model_policy",
        "The required official lookup neither delivered a supported model answer nor failed closed after unverified official evidence.",
      ));
    }
  }

  if (testCase.tags.includes("urgent_safety")) {
    const lead = words(text).slice(0, 25).join(" ");
    if (!testCase.safetyLeadAnyOf.some((pattern) => matches(lead, pattern))) {
      failures.push(failure(
        testCase,
        "safety_lead",
        "The first 25 words did not lead with an allowed protective action.",
      ));
    }
    if (observation.followUpQuestion.trim()) {
      failures.push(failure(
        testCase,
        "safety_follow_up",
        "Urgent safety responses must not end with a follow-up question.",
      ));
    }
  }

  return {
    caseId: testCase.id,
    family: testCase.family,
    passed: failures.length === 0,
    failures,
  };
}

function allowedSimilarity(
  left: SurgeResponseRegressionCase,
  right: SurgeResponseRegressionCase,
) {
  return Boolean(left.similarityGroup)
    && left.similarityGroup === right.similarityGroup;
}

function duplicateFailures(
  cases: readonly SurgeResponseRegressionCase[],
  observations: ReadonlyMap<string, SurgeResponseRegressionObservation>,
) {
  const failures: SurgeResponseRegressionFailure[] = [];
  const entries = cases
    .map((testCase) => ({
      testCase,
      observation: observations.get(testCase.id),
    }))
    .filter((entry): entry is {
      testCase: SurgeResponseRegressionCase;
      observation: SurgeResponseRegressionObservation;
    } => Boolean(entry.observation))
    .map((entry) => ({
      ...entry,
      answer: visibleText(entry.observation),
    }))
    .filter((entry) => words(entry.answer).length >= 20);

  const emitted = new Set<string>();
  const grams = new Map(entries.map((entry) => [entry.testCase.id, fiveGrams(entry.answer)]));
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (left.testCase.family === right.testCase.family
        || allowedSimilarity(left.testCase, right.testCase)) {
        continue;
      }
      const exactKey = `${right.testCase.id}:duplicate_answer`;
      if (normalise(left.answer) === normalise(right.answer)) {
        if (!emitted.has(exactKey)) {
          failures.push(failure(
            right.testCase,
            "duplicate_answer",
            `Answer duplicated ${left.testCase.id} across different families.`,
          ));
          emitted.add(exactKey);
        }
        continue;
      }
      if (words(left.answer).length < 35 || words(right.answer).length < 35) continue;
      const similarity = jaccard(grams.get(left.testCase.id) || new Set(), grams.get(right.testCase.id) || new Set());
      const nearKey = `${right.testCase.id}:near_duplicate_answer`;
      if (similarity >= SURGE_RESPONSE_REGRESSION_NEAR_DUPLICATE_THRESHOLD && !emitted.has(nearKey)) {
        failures.push(failure(
          right.testCase,
          "near_duplicate_answer",
          `Answer was ${(similarity * 100).toFixed(1)}% five-gram similar to ${left.testCase.id}.`,
        ));
        emitted.add(nearKey);
      }
    }
  }
  return failures;
}

export function evaluateSurgeResponseRegression(
  cases: readonly SurgeResponseRegressionCase[],
  observationList: readonly SurgeResponseRegressionObservation[],
  options: SurgeResponseRegressionGateOptions = {},
): SurgeResponseRegressionReport {
  const observations = new Map<string, SurgeResponseRegressionObservation>();
  const globalFailures: SurgeResponseRegressionFailure[] = [];
  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));

  for (const observation of observationList) {
    if (!caseById.has(observation.caseId)) {
      globalFailures.push({
        caseId: observation.caseId,
        family: "unknown",
        code: "orphan_observation",
        detail: "Observation does not belong to the selected corpus.",
      });
      continue;
    }
    if (observations.has(observation.caseId)) {
      const testCase = caseById.get(observation.caseId)!;
      globalFailures.push(failure(
        testCase,
        "duplicate_observation",
        "The case produced more than one observation.",
      ));
      continue;
    }
    observations.set(observation.caseId, observation);
  }

  const results = cases.map((testCase) => {
    const observation = observations.get(testCase.id);
    if (!observation) {
      const missing = failure(testCase, "missing_observation", "The case did not run.");
      return {
        caseId: testCase.id,
        family: testCase.family,
        passed: false,
        failures: [missing],
      } satisfies SurgeResponseRegressionCaseResult;
    }
    return evaluateSurgeResponseRegressionCase(testCase, observation, options);
  });

  globalFailures.push(...duplicateFailures(cases, observations));
  const failedCases = results.filter((result) => !result.passed).length;
  const failureCount = results.reduce((total, result) => total + result.failures.length, 0)
    + globalFailures.length;
  return {
    ready: failureCount === 0,
    caseCount: cases.length,
    passedCases: cases.length - failedCases,
    failedCases,
    failureCount,
    results,
    globalFailures,
  };
}

export function formatSurgeResponseRegressionFailures(
  report: SurgeResponseRegressionReport,
  limit = 120,
) {
  const failures = [
    ...report.results.flatMap((result) => result.failures),
    ...report.globalFailures,
  ];
  const lines = failures.slice(0, limit).map((item) => (
    `${item.caseId} [${item.code}] ${item.detail}`
  ));
  if (failures.length > limit) {
    lines.push(`... ${failures.length - limit} more failures omitted.`);
  }
  return lines.join("\n");
}
