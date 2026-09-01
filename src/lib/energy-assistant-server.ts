import {
  ENERGY_ASSISTANT_AUDIENCES,
  ENERGY_ASSISTANT_TOPICS,
  type EnergyAssistantAudience,
} from "../data/energy-assistant-knowledge.ts";
import {
  containsSurgeInternalPlatformName,
  containsSurgeNamedReference,
  composeEnergyAssistantAnswer,
  isEnergyDocumentQuoteConversationRequest,
  isSurgeElectricSaulQuestion,
  isSurgeExplicitlyOutsideScope,
  isSurgeImplementationIdentityQuestion,
  isSurgeNamedReferenceQuestion,
  isSurgeServiceConversationFollowUp,
  isSurgeServiceLocationFollowUp,
  isSurgeServiceOrCompetingQuoteRequest,
  queryAustralianPostcode,
  sanitizeSurgePublicText,
  sanitizeSurgeReferenceText,
  surgeServiceRequestAlsoAsksEnergyDecision,
  surgeRecurringFinanceConversationFacts,
  SURGE_ELECTRIC_SAUL_COMPARISON_ANSWER,
  SURGE_PUBLIC_IDENTITY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_FOLLOW_UP,
  surgeOutputViolatesPublicPolicy,
  surgeServiceConversationContext,
  type EnergyAssistantAnswer,
  type SurgeServiceConversationContext,
} from "./energy-assistant.ts";
import {
  classifySurgeConversationTurn,
  emptySurgeConversationState,
  filterSurgeRecentTurnsForFrame,
  mergeSurgeConversationFacts,
  parseSurgeConversationState,
  projectSurgeConversationStateToFrame,
  resolveSurgeConversationReference,
  selectSurgeConversationFrame,
  surgeConversationDecisionContext,
  surgeConversationCorrectionReframesDecision,
  surgeConversationFactsFromMessage,
  surgeMessageSuppliesSameSubjectConstraint,
  surgeMessageAnswersPendingQuestion,
  surgeConversationTopicFor,
  surgeConversationTopicsAreCompatible,
  SURGE_EXPLICIT_SEPARATE_PROPERTY_CONTEXT_PATTERN,
  updateSurgeConversationLedger,
  type SurgePlanContextCorrection,
  type SurgeConversationState,
  type SurgeConversationTurnIntent,
} from "./energy-assistant-conversation.ts";
import {
  evaluateSurgeConversationQuality,
  type SurgeConversationQualityEvent,
  type SurgeConversationQualityMetadata,
} from "./energy-assistant-quality.ts";
import {
  parseSurgePlanContext,
  surgePlanContextSummary,
} from "./energy-assistant-plan-context.ts";
import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import {
  composeSurgePlanPriorityAnswer,
  isSurgePlanPriorityIntent,
  surgeAnswerPreservesPlanPriority,
  applySurgePlanContextCorrections,
  applySurgePlanContextCorrectionsToConversationState,
  surgeSavedPlanCorrectionFactsForMessage,
  surgePlanContextCorrectionsAfterRecentHomeFactChanges,
} from "./energy-assistant-plan-priority.ts";
import {
  estimateSurgeModelReservationMicroUsd,
  generateSurgeModelAnswer,
  surgeModelResultPassedSemanticValidation,
  surgeMaterialQuestionParts,
  surgeOfficialUrlIsAllowed,
  type SurgeOfficialWebCitation,
  type SurgeOfficialWebSearchPlan,
  type SurgeModelRequest,
  type SurgeModelResult,
} from "./energy-assistant-model.ts";
import {
  deriveSurgeAnswerPresentation,
  normalizeSurgeAnswerPresentation,
  surgePresentationPassesEverydayLanguage,
  surgePresentationText,
  type SurgeAnswerPresentation,
  type SurgeAnswerType,
  type SurgeQuickReply,
} from "./surge-everyday-answer.ts";
import {
  surgeAnswerSharesQuestionIntent,
  surgeAnswerIsGenericBoilerplate,
  composeSurgeSimpleAnswer,
  surgeAnswerMatchesQuestionIntent,
} from "./surge-simple-answer.ts";
import {
  composeSurgeNonCurrentHazardAnswer,
  composeSurgeSafetyAnswer,
} from "./surge-safety-answer.ts";
import { sanitizeSurgeCustomerOfficialCitation } from "./surge-official-citation.ts";
import { ENERGY_ASSISTANT_MAX_BODY_BYTES } from "./energy-assistant-request-budget.ts";
import { normalizeEnergyAssistantBrandText } from "./energy-assistant-brand.ts";

export { ENERGY_ASSISTANT_MAX_BODY_BYTES } from "./energy-assistant-request-budget.ts";

export const ENERGY_ASSISTANT_RETENTION_DAYS = 30;
export const ENERGY_ASSISTANT_MAX_MESSAGE_CHARS = 1_200;
export const ENERGY_ASSISTANT_MAX_RECENT_TURNS = 12;
export const ENERGY_ASSISTANT_MAX_RECENT_TURN_CHARS = 1_200;
export const ENERGY_ASSISTANT_MAX_RECENT_CONTENT_CHARS = 9_000;
export const ENERGY_ASSISTANT_MAX_RESPONSE_BYTES = 65_536;

export type EnergyAssistantRecentTurn = {
  role: "user" | "assistant";
  content: string;
};

export type EnergyAssistantReply = {
  id: string;
  role: "assistant";
  content: string;
  directAnswer: string;
  createdAt: string;
  status: "answered" | "needs_context" | "source_review_required";
  confidence: "high" | "medium" | "low";
  answerType: SurgeAnswerType;
  verdict: string;
  reason: string;
  practicalSteps: string[];
  extraDetail: string;
  followUpQuestion: string;
  quickReplies: SurgeQuickReply[];
  citations: SurgeOfficialWebCitation[];
};

export type SurgeModelAdmissionRequest = {
  requestId: string;
  estimatedMicroUsd: number;
};

export type SurgeModelCallReservation =
  | {
      allowed: false;
      reason?: string;
      retryAfterSeconds?: number;
    }
  | { allowed: true; release: () => Promise<void> };

export type ServerDependencies = {
  now?: () => Date;
  randomUUID?: () => string;
  composeAnswer?: typeof composeEnergyAssistantAnswer;
  generateAnswer?: (request: SurgeModelRequest) => Promise<SurgeModelResult | null>;
  resolveGroundedAnswer?: (request: SurgeModelRequest) => Promise<EnergyAssistantAnswer | null>;
  reserveModelCall?: (
    request: SurgeModelAdmissionRequest,
  ) => Promise<SurgeModelCallReservation>;
  recordQuality?: (event: SurgeConversationQualityEvent) => Promise<void>;
  qualityMetadata?: Partial<SurgeConversationQualityMetadata>;
  monotonicNow?: () => number;
  modelAdmissionNow?: () => number;
  waitBeforeModelAdmissionRetry?: (delayMs: number) => Promise<void>;
  requireValidatedModelForOrdinaryAdvice?: boolean;
};

const SURGE_MODEL_ADMISSION_MAX_ATTEMPTS = 3;
const SURGE_MODEL_ADMISSION_RETRY_DEADLINE_MS = 5_000;
const SURGE_MODEL_ADMISSION_RETRY_DELAYS_MS = [40, 100] as const;

function surgeModelAdmissionMayRetry(reason: string | undefined) {
  return reason === "unavailable" || reason === "global_in_flight";
}

async function reserveSurgeModelCallBeforeDeadline(
  reserveModelCall: NonNullable<ServerDependencies["reserveModelCall"]>,
  request: SurgeModelAdmissionRequest,
  remainingMs: number,
) {
  const attempt = Promise.resolve()
    .then(() => reserveModelCall(request))
    .then(
      (reservation) => ({ kind: "settled" as const, reservation }),
      () => ({
        kind: "settled" as const,
        reservation: { allowed: false, reason: "unavailable" } as SurgeModelCallReservation,
      }),
    );
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ kind: "deadline" }>((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ kind: "deadline" }), Math.max(1, remainingMs));
  });
  const outcome = await Promise.race([attempt, deadline]);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (outcome.kind === "settled") {
    return { timedOut: false as const, reservation: outcome.reservation };
  }

  // The reservation boundary has no cancellation contract. Do not make a
  // second reservation after an indeterminate timeout. If the first call later
  // proves that it acquired a lease, release that lease without invoking the
  // provider so in-flight accounting cannot leak or double-count work.
  void attempt.then(async (lateOutcome) => {
    if (lateOutcome.reservation.allowed) {
      await lateOutcome.reservation.release().catch(() => undefined);
    }
  });
  return {
    timedOut: true as const,
    reservation: { allowed: false, reason: "unavailable" } as SurgeModelCallReservation,
  };
}

async function waitForSurgeModelAdmissionRetry(
  waitBeforeRetry: (delayMs: number) => Promise<void>,
  delayMs: number,
  deadlineAt: number,
  now: () => number,
) {
  const remainingMs = deadlineAt - now();
  if (remainingMs <= 0) return false;
  const boundedDelayMs = Math.min(delayMs, remainingMs);
  let wait: Promise<boolean>;
  try {
    wait = waitBeforeRetry(boundedDelayMs).then(() => true, () => false);
  } catch {
    return false;
  }
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(false), Math.max(1, remainingMs));
  });
  const completed = await Promise.race([wait, deadline]);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  return completed && now() < deadlineAt;
}

async function reserveSurgeModelCallWithBoundedRetry(
  reserveModelCall: NonNullable<ServerDependencies["reserveModelCall"]>,
  request: SurgeModelAdmissionRequest,
  dependencies: ServerDependencies,
) {
  const now = dependencies.modelAdmissionNow || (() => Date.now());
  const waitBeforeRetry = dependencies.waitBeforeModelAdmissionRetry
    || ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const startedAt = now();
  const deadlineAt = startedAt + SURGE_MODEL_ADMISSION_RETRY_DEADLINE_MS;
  let reservation: SurgeModelCallReservation = { allowed: false, reason: "unavailable" };
  for (let attempt = 0; attempt < SURGE_MODEL_ADMISSION_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deadlineAt - now();
    if (remainingMs <= 0) return reservation;
    const outcome = await reserveSurgeModelCallBeforeDeadline(
      reserveModelCall,
      request,
      remainingMs,
    );
    reservation = outcome.reservation;
    if (outcome.timedOut || reservation.allowed || !surgeModelAdmissionMayRetry(reservation.reason)) {
      return reservation;
    }
    const delayMs = SURGE_MODEL_ADMISSION_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) return reservation;
    if (!await waitForSurgeModelAdmissionRetry(waitBeforeRetry, delayMs, deadlineAt, now)) {
      return reservation;
    }
  }
  return reservation;
}

export class EnergyAssistantServerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EnergyAssistantServerError";
    this.status = status;
    this.code = code;
  }
}

function json(body: object, status = 200, additionalHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  });
}

function isOverloadError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /(?:overload|overloaded|capacity|resource limit|cpu time|worker exceeded|temporarily busy)/i
    .test(`${error.name} ${error.message}`);
}

function errorResponse(error: unknown) {
  if (error instanceof EnergyAssistantServerError) {
    const headers: Record<string, string> = {};
    if (error.status === 429 || error.status === 503) {
      headers["Retry-After"] = error.status === 429 ? "60" : "2";
    }
    return json({ ok: false, error: { code: error.code, message: error.message } }, error.status, headers);
  }
  if (isOverloadError(error)) {
    return json({
      ok: false,
      error: {
        code: "ASSISTANT_BUSY",
        message: "The energy guide is busy. Please retry shortly.",
      },
    }, 503, { "Retry-After": "2" });
  }
  return json({
    ok: false,
    error: {
      code: "ASSISTANT_UNAVAILABLE",
      message: "The energy guide is temporarily unavailable. Please try again.",
    },
  }, 500);
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new EnergyAssistantServerError(403, "ORIGIN_REJECTED", "Request origin was not accepted.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EnergyAssistantServerError(400, "INVALID_REQUEST", "Send a JSON object.");
  }
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== "string") {
    throw new EnergyAssistantServerError(400, "INVALID_REQUEST", `${field} is required.`);
  }
  const clean = value.trim();
  if (
    clean.length < minimum
    || clean.length > maximum
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(clean)
  ) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_REQUEST",
      `${field} must contain between ${minimum} and ${maximum} safe characters.`,
    );
  }
  return clean;
}

function audienceFrom(value: unknown, fallback: EnergyAssistantAudience = "household") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !(ENERGY_ASSISTANT_AUDIENCES as readonly string[]).includes(value)) {
    throw new EnergyAssistantServerError(400, "INVALID_AUDIENCE", "Choose a supported assistant audience.");
  }
  return value as EnergyAssistantAudience;
}

function publicAudienceFrom(value: unknown): EnergyAssistantAudience {
  if (value === undefined || value === null || value === "" || value === "public") return "household";
  if (value === "customer") return "household";
  if (value === "trade") return "trade";
  if (value === "household" || value === "renter" || value === "strata" || value === "assessor") {
    return audienceFrom(value);
  }
  throw new EnergyAssistantServerError(
    400,
    "INVALID_AUDIENCE",
    "Audience must be public, customer or trade.",
  );
}

function pageContextFrom(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 160 || !/^\/[A-Za-z0-9/_-]*$/.test(value)) {
    throw new EnergyAssistantServerError(400, "INVALID_PAGE_CONTEXT", "Page context must be a short internal path.");
  }
  return value;
}

function clientRequestIdFrom(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{16,80}$/.test(value)) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_CLIENT_REQUEST_ID",
      "Request ID must contain 16 to 80 letters, numbers, colons, underscores or hyphens.",
    );
  }
  return value;
}

function recentTurnsFrom(value: unknown): EnergyAssistantRecentTurn[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > ENERGY_ASSISTANT_MAX_RECENT_TURNS) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_RECENT_CONTEXT",
      `Recent context must contain at most ${ENERGY_ASSISTANT_MAX_RECENT_TURNS} turns.`,
    );
  }
  let contentCharacters = 0;
  const turns = value.map((item, index) => {
    const record = asRecord(item);
    if (record.role !== "user" && record.role !== "assistant") {
      throw new EnergyAssistantServerError(
        400,
        "INVALID_RECENT_CONTEXT",
        `Recent turn ${index + 1} has an invalid role.`,
      );
    }
    const role: EnergyAssistantRecentTurn["role"] = record.role;
    const rawContent = cleanText(
      record.content,
      `Recent turn ${index + 1} content`,
      1,
      ENERGY_ASSISTANT_MAX_RECENT_TURN_CHARS,
    );
    const content = role === "assistant"
      ? limitedText(
          normalizeEnergyAssistantBrandText(rawContent),
          ENERGY_ASSISTANT_MAX_RECENT_TURN_CHARS,
        )
      : rawContent;
    contentCharacters += content.length;
    return { role, content };
  });
  if (contentCharacters > ENERGY_ASSISTANT_MAX_RECENT_CONTENT_CHARS) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_RECENT_CONTEXT",
      `Recent context may contain at most ${ENERGY_ASSISTANT_MAX_RECENT_CONTENT_CHARS} characters.`,
    );
  }
  return turns;
}

function continuationFrom(value: unknown) {
  if (value === undefined || value === null) return null;
  const continuation = parseSurgeConversationState(value);
  if (
    !continuation
    || (continuation.activeTopic !== "general"
      && continuation.activeTopic !== "service_enquiry"
      && !(ENERGY_ASSISTANT_TOPICS as readonly string[]).includes(continuation.activeTopic))
  ) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_CONTINUATION",
      "Conversation context was not accepted. Start a new conversation and retry.",
    );
  }
  return continuation;
}

function planContextFrom(value: unknown) {
  if (value === undefined || value === null) return null;
  const context = parseSurgePlanContext(value);
  if (!context) {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_PLAN_CONTEXT",
      "Saved plan context was not accepted. Continue without it and retry.",
    );
  }
  return context;
}

function explicitlyUsesSavedHomeContext(value: string) {
  const generalHowExplainer = /\b(?:explain|describe|tell\s+me)\b[^?]{0,35}\bhow\b/i.test(value);
  const firstPersonHomeFact = /\b(?:i|we)\s+(?:(?:(?:currently|already)\s+)?have(?!\s+(?:heard|read|been\s+told|a\s+question)\b)[^.!?\n]{0,55}\b(?:home|house|property|apartment|unit|electricity|energy|gas|solar|panels?|battery|heat pump|heater|heating|air ?con(?:ditioner)?|hot water|roof|windows?|glazing|insulation|draughts?|drafts?|switchboard|cooktop|stove|EV|charger)\b|(?:(?:currently|already)\s+)?use(?!\s+(?:the\s+)?(?:word|words|term|phrase)\b)[^.!?\n]{0,55}\b(?:electricity|energy|gas|solar|battery|heat pump|heater|heating|air ?con(?:ditioner)?|hot water|cooktop|stove|EV|charger|kWh|MJ)\b|(?:currently\s+)?(?:own|rent)\b|(?:currently\s+)?live\s+(?:in|at)\b|(?:currently\s+)?(?:pay|spend)\b[^.!?\n]{0,55}(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:cents?|dollars?|kWh|MJ)\b|\b(?:electricity|energy|gas|bill|heating|cooling)\b)|already\s+(?:installed|added|replaced|upgraded|bought)\b[^.!?\n]{0,55}\b(?:solar|panels?|battery|heat pump|heater|heating|air ?con(?:ditioner)?|hot water|windows?|glazing|insulation|switchboard|cooktop|stove|EV|charger)\b)/i.test(value);
  return /\b(?:based on|using|use|given|from) (?:my|our) (?:answers|details|survey|home details|home context|energy plan)\b/i.test(value)
    || /\b(?:my|our)\s+(?:(?:saved|current|own)\s+)?(?:\d{4}\s+)?(?:home|house|place|property|apartment|unit|bill|usage|heater|air ?con|hot water|roof|windows?|(?:front\s+|back\s+|external\s+|entry\s+)?doors?|bedrooms?|rooms?|lounge|bathroom|kitchen|insulation|solar|battery|quote)\b/i.test(value)
    || firstPersonHomeFact
    || /\b(?:i|we) (?:need|want)\s+(?:an?\s+)?(?:solar system|battery|heater|air ?con(?:ditioner)?|heat pump|hot water system|EV charger|quote|installer)\b/i.test(value)
    || /\b(?:i am|i'm|we are|we're)\s+(?:looking at|planning|about|due|booked)\s+(?:to\s+)?(?:get|have|install|replace|upgrade)\b/i.test(value)
    || /\b(?:my|our)\s+(?:quote|installation|installer|replacement|upgrade)\b/i.test(value)
    || /\b(?:i am|we are)\s+(?:an?\s+)?(?:owner|homeowner|renter|tenant|cold|freezing|hot|uncomfortable)\b/i.test(value)
    || /\b(?:worth|suitable|right|best|recommended|make sense|good idea|ok(?:ay)?)\b[^?]{0,35}\bfor\s+(?:me|us)\b/i.test(value)
    || (!generalHowExplainer && /\bwork(?:s)?\b[^?]{0,35}\bfor\s+(?:me|us)\b/i.test(value))
    || /\b(?:suit|fit)s?\s+(?:me|us)\b/i.test(value)
    || /\b(?:should|can|could|would|do)\s+(?:i|we)\s+(?:get|add|install|put\s+in|replace|upgrade|choose|buy|use|switch|size)\b/i.test(value)
    || /\bwhat\s+size\b[^?]{0,80}\bshould\s+(?:i|we)\b/i.test(value)
    || /\bwould\b[^?]{0,80}\bsuit\s+(?:me|us)\b/i.test(value)
    || /\bwhat\b[^?]{0,50}\b(?:suit|fit)s?\s+our\s+household\b/i.test(value);
}

const EXPLICIT_NON_SAVED_PERSON_CONTEXT = /\b(?:mum|mom|mother|dad|father|parent|sister|brother|aunt|aunty|uncle|grandmother|grandma|nan|nanna|grandfather|granddad|grandpa|daughter|son|cousin|niece|nephew|friend|neighbou?r|client|customer|tenant|landlord)(?:['’]s)\b[^.!?\n]{0,120}\b(?:home|house|place|property|apartment|unit|site|quote|bill|electricity|energy|solar|panels?|battery|heat pump|hot water|heater|heating|air ?con(?:ditioner|ditioning)?|cooling|windows?|glazing|insulation|draughts?|drafts?|switchboard|cooktop|stove|EV|charger)\b/i;
const EXPLICIT_NON_SAVED_PERSON_DECISION = /\b(?:(?:my|our|a|the)\s+)?(?:mum|mom|mother|dad|father|parent|sister|brother|aunt|aunty|uncle|grandmother|grandma|nan|nanna|grandfather|granddad|grandpa|daughter|son|cousin|niece|nephew|friend|neighbou?r|client|customer|tenant|landlord)\s+(?:has|needs|owns|rents|lives|got|received|was quoted|is (?:considering|looking at))\b[^.!?\n]{0,120}\b(?:home|house|place|property|apartment|unit|site|quote|bill|electricity|energy|solar|panels?|battery|heat pump|hot water|heater|heating|air ?con(?:ditioner|ditioning)?|cooling|windows?|glazing|insulation|draughts?|drafts?|switchboard|cooktop|stove|EV|charger)\b/i;
const EXPLICIT_NON_SAVED_PERSON_BENEFICIARY = /\b(?:for|help(?:ing)?|advise|advising)\s+(?:(?:my|our|a|the)\s+)?(?:mum|mom|mother|dad|father|parent|sister|brother|aunt|aunty|uncle|grandmother|grandma|nan|nanna|grandfather|granddad|grandpa|daughter|son|cousin|niece|nephew|friend|neighbou?r|client|customer|tenant|landlord)\b/i;
function questionExcludesSavedHomeContext(value: string) {
  const explicitlyNamesAnotherSubject = EXPLICIT_NON_SAVED_PERSON_CONTEXT.test(value)
    || EXPLICIT_NON_SAVED_PERSON_DECISION.test(value)
    || EXPLICIT_NON_SAVED_PERSON_BENEFICIARY.test(value)
    || SURGE_EXPLICIT_SEPARATE_PROPERTY_CONTEXT_PATTERN.test(value);
  if (!explicitlyNamesAnotherSubject) return false;

  // A direct comparison can legitimately need both the saved home's facts and
  // the separately named subject. Otherwise the named subject is authoritative.
  return !(explicitlyUsesSavedHomeContext(value)
    && /\b(?:compare|comparison|both|between|versus|vs\.?|against)\b/i.test(value));
}

function savedHomeContextCanResolveDecision(value: string) {
  return /\b(?:rebate|discount|certificate|eligible|eligibility|qualify|quote)\b/i.test(value)
    && /\b(?:install|replace|upgrade|remove|decommission|buy|get|quote|system|heater|heating|air ?con|hot water|solar|battery|insulation|glazing)\w*\b/i.test(value)
    && !/\b(?:generally|in general|what does|what is|define|meaning of)\b/i.test(value);
}

function currentQuestionUsesSavedHomeContext(
  message: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
) {
  const question = message.trim();
  if (!question) return false;

  // A newly named person, property, site or job is authoritative and must not
  // inherit a different home's survey facts simply because the topics match.
  if (questionExcludesSavedHomeContext(question)) return false;

  if (explicitlyUsesSavedHomeContext(question)) {
    return true;
  }

  if (savedHomeContextCanResolveDecision(question)) return true;

  const recentPersonalQuestion = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-6)
    .some((turn) => explicitlyUsesSavedHomeContext(turn.content));
  const activeSavedHomeDecision = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-6)
    .some((turn) => savedHomeContextCanResolveDecision(turn.content))
    || savedHomeContextCanResolveDecision(continuation?.goal || "");

  if ((recentPersonalQuestion || activeSavedHomeDecision)
    && (intent === "answer_to_follow_up"
      || intent === "contextual_follow_up"
      || intent === "clarification"
      || intent === "correction")) {
    return true;
  }

  // Short follow-ups can inherit a home-specific subject from the conversation,
  // but a standalone general knowledge question must stay general.
  if (/\b(?:it|that|this|they|those|the same|instead)\b/i.test(question)) {
    return recentPersonalQuestion;
  }

  return false;
}

function recentTurnsForActiveDecision(
  message: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
) {
  const sameSubjectConstraint = surgeMessageSuppliesSameSubjectConstraint(message);
  if (continuation?.ledger) {
    const frame = selectSurgeConversationFrame(message, continuation, false);
    if (!frame.decision) {
      const resolvedReference = resolveSurgeConversationReference(
        message,
        recentTurns,
        continuation,
      ).status === "resolved_from_recent_context";
      const contextualFollowUp = intent === "answer_to_follow_up"
        || intent === "contextual_follow_up"
        || intent === "clarification"
        || intent === "correction";
      return /\b(?:too|as well)\s*[?.!]*$/i.test(message)
        || (resolvedReference && contextualFollowUp)
        ? recentTurns.slice(-2)
        : [];
    }
  }
  const currentTopic = surgeConversationTopicFor(message);
  const priorNamedUserTurn = [...recentTurns].reverse().find((turn) => (
    turn.role === "user" && Boolean(surgeConversationTopicFor(turn.content))
  ));
  const priorNamedTopic = continuation?.activeTopic && continuation.activeTopic !== "general"
    ? continuation.activeTopic
    : surgeConversationTopicFor(priorNamedUserTurn?.content || "");
  const carriesPriorComparison = /\b(?:too|as well)\s*[?.!]*$/i.test(message);
  const namesDifferentDecision = Boolean(currentTopic)
    && Boolean(priorNamedTopic)
    && currentTopic !== priorNamedTopic
    && !surgeConversationTopicsAreCompatible(currentTopic, priorNamedTopic);
  if (namesDifferentDecision
    && !carriesPriorComparison
    && !sameSubjectConstraint
    && intent !== "answer_to_follow_up"
    && intent !== "contextual_follow_up"
    && intent !== "clarification"
    && intent !== "correction") return [];
  const continuesSameNamedTopic = intent === "new_question"
    && Boolean(currentTopic)
    && currentTopic === continuation?.activeTopic;
  const startsNewDecision = intent === "topic_change"
    || intent === "correction_and_topic_change"
    || (intent === "correction" && surgeConversationCorrectionReframesDecision(message))
    || (intent === "new_question" && !continuesSameNamedTopic && !sameSubjectConstraint);
  if (startsNewDecision) {
    const latestSubjectCorrection = !continuation?.ledger
      ? [...recentTurns].reverse().find((turn) => turn.role === "user"
        && /\b(?:correction|actually|sorry|I meant|not\s+(?:postcode|an?\s+owner|renting|a renter))\b/i.test(turn.content)
        && surgeConversationFactsFromMessage(turn.content).some((fact) => (
          /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/.test(fact.key)
        )))
      : undefined;
    const explicitlyStartsAnotherSubject = /\b(?:another|different|other|second|new)\s+(?:home|house|property|site|job|shed|building)\b|\bcontainer\s+shed\b/i.test(message);
    if (latestSubjectCorrection && !explicitlyStartsAnotherSubject) {
      return [latestSubjectCorrection];
    }
    return [];
  }

  const goal = continuation?.goal.trim();
  if (!goal) return [...recentTurns];
  let goalTurnIndex = -1;
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index];
    if (turn.role === "user" && turn.content.trim() === goal) {
      goalTurnIndex = index;
      break;
    }
  }
  const selectedTurns = goalTurnIndex >= 0
    ? recentTurns.slice(goalTurnIndex)
    : [...recentTurns];
  return filterSurgeRecentTurnsForFrame(message, continuation, false, selectedTurns);
}

function currentReplyDecisionContext(
  message: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  decisionRecentTurns: readonly EnergyAssistantRecentTurn[],
  continuation: SurgeConversationState | null,
) {
  const currentTopic = surgeConversationTopicFor(message);
  const priorNamedUserTurn = [...recentTurns].reverse().find((turn) => (
    turn.role === "user" && Boolean(surgeConversationTopicFor(turn.content))
  ));
  const priorTopic = continuation?.activeTopic && continuation.activeTopic !== "general"
    ? continuation.activeTopic
    : surgeConversationTopicFor(priorNamedUserTurn?.content || "");
  if (currentTopic
    && priorTopic
    && currentTopic !== priorTopic
    && !surgeConversationTopicsAreCompatible(currentTopic, priorTopic)) {
    return message.trim();
  }
  return surgeConversationDecisionContext(message, continuation, decisionRecentTurns);
}

function pendingQuestionContextMessage(
  message: string,
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
  recentTurns: readonly EnergyAssistantRecentTurn[],
) {
  if (intent === "answer_to_follow_up" && continuation?.pendingQuestion) {
    return `${continuation.goal ? `Customer's decision: ${continuation.goal}\n` : ""}${continuation.pendingQuestion}\nCustomer answer: ${message}`;
  }
  if ((intent === "contextual_follow_up" || intent === "clarification" || intent === "correction")
    && (continuation?.goal || recentTurns.length)) {
    return surgeConversationDecisionContext(message, continuation, recentTurns);
  }
  return message;
}

function pendingRoomAnswer(
  message: string,
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
  base: EnergyAssistantAnswer,
) {
  if (intent !== "answer_to_follow_up"
    || !/\bwhich rooms?\b[^?]{0,80}\b(?:hardest|coldest|hottest|comfortable|comfort)\b/i.test(continuation?.pendingQuestion || "")) {
    return null;
  }
  const roomPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b(?:living room|lounge)\b/i, "lounge"],
    [/\bbedrooms?\b/i, "bedroom"],
    [/\bkitchen\b/i, "kitchen"],
    [/\bbathrooms?\b/i, "bathroom"],
    [/\bdining room\b/i, "dining room"],
    [/\bstud(?:y|ies)\b|\bhome office\b/i, "study"],
  ];
  const rooms = roomPatterns
    .filter(([pattern]) => pattern.test(message))
    .map(([, label]) => label);
  if (!rooms.length) return null;
  const roomText = rooms.length === 1
    ? `the ${rooms[0]}`
    : `the ${rooms.slice(0, -1).join(", ")} and ${rooms.at(-1)}`;
  return {
    ...base,
    directAnswer: `Start with ${roomText}, because ${rooms.length === 1 ? "it is" : "they are"} the hardest ${rooms.length === 1 ? "room" : "rooms"} to keep comfortable. Check obvious draughts around doors and windows, then note whether the glass, walls or ceiling feel cold while the heater is running. That shows whether the first fix is sealing gaps, improving window coverings or checking heating and insulation for those rooms.`,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    suggestedQuestions: [],
  } satisfies EnergyAssistantAnswer;
}

const SAVED_HOME_CORRECTION_LABELS: Record<SurgePlanContextCorrection, string> = {
  comfort_moisture_resolved: "the moisture or condensation concern",
  comfort_draught_resolved: "the draught concern",
  roof_condition_changed: "the roof condition",
  glazing_changed: "the windows or glazing",
  ceiling_insulation_changed: "the ceiling insulation",
  wall_insulation_changed: "the wall insulation",
  floor_insulation_changed: "the floor insulation",
  insulation_changed: "the insulation",
  switchboard_changed: "the switchboard",
  heating_cooling_changed: "the heating or cooling system",
  exhaust_changed: "the exhaust ventilation",
  solar_changed: "the solar system",
  battery_changed: "the home battery",
  hot_water_changed: "the hot-water system",
};

function savedHomeCorrectionAcknowledgement(
  message: string,
  corrections: readonly SurgePlanContextCorrection[],
  correctionFacts: readonly { value: string }[],
  base: EnergyAssistantAnswer,
) {
  if (!corrections.length || !correctionFacts.length || /\?/.test(message)) return null;
  const labels = corrections.map((correction) => SAVED_HOME_CORRECTION_LABELS[correction]);
  const labelText = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  const currentFact = [...new Set(correctionFacts.map((fact) => (
    fact.value.trim().replace(/[.!]+$/, "")
  )))].join("; ").slice(0, 220);
  return {
    ...base,
    directAnswer: `Got it. I will use “${currentFact}” as the current saved-home fact for ${labelText}, and I will stop relying on the superseded planner answer for that part of the home.`,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    citations: [],
    assumptions: [],
    confidence: "high",
    suggestedQuestions: ["What would you like to assess next using the updated home details?"],
    toolActions: [],
    sourceBoundary: "",
  } satisfies EnergyAssistantAnswer;
}

function dateFrom(dependencies: ServerDependencies) {
  const value = dependencies.now ? dependencies.now() : new Date();
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid server clock.");
  return value;
}

function limitedText(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function boundedAnswer(answer: EnergyAssistantAnswer) {
  const suggestionLimit = answer.directAnswer.includes("only covers") ? 3 : 1;
  return {
    ...answer,
    directAnswer: limitedText(answer.directAnswer, 2_400),
    practicalSteps: answer.practicalSteps.slice(0, 3).map((step) => limitedText(step, 700)),
    nextAction: limitedText(answer.nextAction, 800),
    citations: answer.citations.slice(0, 8),
    assumptions: answer.assumptions.slice(0, 4).map((item) => limitedText(item, 400)),
    suggestedQuestions: answer.suggestedQuestions.slice(0, suggestionLimit).map((item) => limitedText(item, 220)),
    toolActions: answer.toolActions.slice(0, 4),
    sourceBoundary: limitedText(answer.sourceBoundary, 900),
  };
}

function modelFollowUpIsRequired(
  message: string,
  decisionContext: string,
  followUpQuestion: string,
) {
  const candidate = followUpQuestion.trim();
  if (!candidate || !candidate.includes("?")) return false;
  if (/\byes\s*(?:\/|or)\s*no\b/i.test(message)) return false;
  if (OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message)) return false;
  if (/^(?:so\s+)?why\s+(?:not|isn['’]?t|is not|wasn['’]?t|was not|wouldn['’]?t|would not)\b/i.test(message.trim())) {
    return false;
  }
  const selfContainedDefinition = /^(?:what\s+(?:is|are)\b|what\s+does\b[^?]{0,80}\bmean\b|explain\b|can you explain\b)/i.test(message.trim())
    && !/\b(?:current|currently|today|now|latest|worth|value|price|rate|eligible|eligibility|available|open|closed|applies?\s+to\s+(?:me|my|our))\b/i.test(message);
  if (selfContainedDefinition) return false;
  const conversation = `${decisionContext}\n${message}`;
  const missingEligibilityDetail = /\b(?:rebates?|grants?|incentives?|subsid(?:y|ies)|programmes?|programs?|schemes?|eligibility|discount)\b/i.test(conversation)
    && /\b(?:model|product|system|equipment|heating|heater|postcode|owner|rent|property)\b/i.test(candidate);
  const asksForClarification = /\b(?:huh|what do you mean|can you explain|explain that|I don(?:'|’)t understand)\b/i.test(message);
  if (missingEligibilityDetail || asksForClarification) return true;

  // Keep only a missing fact that could change the verdict, calculation,
  // eligibility, compatibility, sizing or immediate next action. Questions
  // whose only purpose is to continue the chat are deliberately removed.
  const genericPrompt = /\b(?:anything else|what (?:else|topic) (?:would you like|should we)|where would you like to (?:start|go)|what would you like to (?:do|check|cover)|would you like to (?:check|discuss|explore|look at) another|do you want to (?:check|discuss|explore|look at) another|what should (?:we|i) check next|practical next step|which rooms are hardest)\b/i.test(candidate);
  if (genericPrompt) return false;

  // These questions ask for information that cannot change the answer already
  // established by the user's wording.
  if (/\b(?:plug-in|portable)\b[\s\S]{0,80}\b(?:reverse[- ]?cycle|split)\b|\b(?:reverse[- ]?cycle|split)\b[\s\S]{0,80}\b(?:plug-in|portable)\b/i.test(message)
    && /\b(?:floor area|room size|dimensions?)\b/i.test(candidate)) {
    return false;
  }
  if (/\b(?:moisture|condensation)\b[\s\S]{0,80}\b(?:trapped|between the panes)\b/i.test(message)
    && /\b(?:wipe|room side|either side)\b/i.test(candidate)) {
    return false;
  }
  if (/\baluminium frame\s+\d+\b/i.test(message)
    && /\b(?:photo|exact wording|what does .* mean)\b/i.test(candidate)) {
    return false;
  }
  if (/\baluminium frame\s+\d+\b/i.test(message)
    && /\bmain problem\b[^?]{0,80}\b(?:draught|draft|condensation|feeling cold|cold)\b/i.test(candidate)) {
    return false;
  }
  if (/\binstaller\b[^.!?\n]{0,70}\brecommends?\b[^.!?\n]{0,90}\bkW\b[^.!?\n]{0,110}\bkWh\s+(?:a|per)\s+year\b/i.test(message)
    && /(?:\b(?:major|new|future|planned)\b[^?]{0,65}\b(?:electric loads?|EV|electric vehicle|hot water|heating)\b|\bplan(?:ning)?\b[^?]{0,65}\b(?:EV|electric vehicle|battery|electric hot water|hot water|electric heating|heating)\b)/i.test(candidate)) {
    return false;
  }

  const materialInput = /\b(?:actual (?:electricity )?(?:use|usage)|after sunset|back[- ]to[- ]back|balloon payment|battery capacity|brand and model|cash price|daylight|deposit|door(?:way)?|ducted|electrical work|exact (?:brand|make|model)|existing tank(?: capacity| size)?|export|fees?|final payment|first (?:large|major) .*use|frame gaps?|future loads?|half[- ]hourly|heated|heating|hot[- ]water use|household size|how many people|people live|occupants?|indoor unit|installation (?:scope|work)|itemised amounts?|leaks?|main problem|model number|monthly payment|outlet|postcode|recover(?:y|s|ed|ing)?|repayments?|roof (?:orientation|direction|shade|shading)|shaded?|room use|shower|single glazed|solar exports?|subfloor|system type|tank (?:capacity|size)|tariff|total amount payable|upfront payment|vehicle|warranty|wall unit)\b/i.test(candidate);
  return materialInput;
}

function customerSafeText(value: string) {
  return normalizeEnergyAssistantBrandText(sanitizeSurgePublicText(value));
}

function customerSafeAnswer(answer: EnergyAssistantAnswer): EnergyAssistantAnswer {
  const exposesInternalPlatformName = (value: unknown) =>
    /\b(?:TLink|Creditex)\b/i.test(JSON.stringify(value));
  return {
    ...answer,
    directAnswer: customerSafeText(answer.directAnswer),
    practicalSteps: answer.practicalSteps.map(customerSafeText),
    nextAction: customerSafeText(answer.nextAction),
    citations: answer.citations.filter((citation) => !exposesInternalPlatformName(citation)),
    assumptions: answer.assumptions.map(customerSafeText),
    suggestedQuestions: answer.suggestedQuestions.map(customerSafeText),
    toolActions: answer.toolActions
      .filter((action) => !exposesInternalPlatformName(action)
        && !action.href.startsWith("/direct-trade")
        && !action.href.startsWith("/creditex"))
      .map((action) => ({ ...action, label: customerSafeText(action.label) })),
    sourceBoundary: customerSafeText(answer.sourceBoundary),
  };
}

function withoutUnconfirmedEmergencyCallAdvice(answer: EnergyAssistantAnswer): EnergyAssistantAnswer {
  const startsSentence = (match: string, offset: number, source: string) => /^[A-Z]/.test(match)
    || offset === 0
    || /(?:^|[.!?])\s*$/.test(source.slice(0, offset));
  const urgentHelp = (match: string, offset: number, source: string) => startsSentence(match, offset, source)
    ? "Get urgent professional help"
    : "get urgent professional help";
  const appropriateService = (match: string, offset: number, source: string) => startsSentence(match, offset, source)
    ? "Use the appropriate urgent professional service"
    : "use the appropriate urgent professional service";
  const rewrite = (value: string) => value
    .replace(/\bcall\s+(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d)\s+or\s+the\s+electricity\s+network\b/gi, (match) => /^[A-Z]/.test(match)
      ? "Contact the electricity network or a licensed electrician urgently"
      : "contact the electricity network or a licensed electrician urgently")
    .replace(/\b(?:call|ring|contact|phone|dial)\b[^.!?\n]{0,35}?(?:(?:triple[ -]?zero)\b(?:\s*\(\s*(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d)\s*\))?|(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d))/gi, urgentHelp)
    .replace(/\b(?:call|ring|contact|phone|dial)\b[^.!?\n]{0,35}?(?:emergency\s+(?:services|responders)\b|firefighters?\b)/gi, urgentHelp)
    .replace(/\b(?:the\s+)?emergency\s+(?:number|telephone\s+number)\s+(?:is|:)?\s*(?:(?:triple[ -]?zero)\b(?:\s*\(\s*(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d)\s*\))?|(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d))/gi, appropriateService)
    .replace(/(?:\btriple[ -]?zero\b(?:\s*\(\s*(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d)\s*\))?|(?<![\d,])0\s*[- ]?\s*0\s*[- ]?\s*0(?!\d))/gi, "the appropriate urgent professional service")
    .replace(/\b(?:call|ring|contact|phone|dial|use)\s+(?:the\s+)?(?:emergency\s+(?:services|responders)|firefighters?)\b/gi, urgentHelp);
  return {
    ...answer,
    directAnswer: rewrite(answer.directAnswer),
    practicalSteps: answer.practicalSteps.map(rewrite),
    nextAction: rewrite(answer.nextAction),
    assumptions: answer.assumptions.map(rewrite),
    suggestedQuestions: answer.suggestedQuestions.map(rewrite),
    sourceBoundary: rewrite(answer.sourceBoundary),
  };
}

function publicPolicyAnswer(message: string): EnergyAssistantAnswer | null {
  const common = {
    practicalSteps: [],
    nextAction: "",
    citations: [],
    assumptions: [],
    confidence: "high" as const,
    toolActions: [],
    sourceBoundary: "",
  };
  if (isSurgeImplementationIdentityQuestion(message)) {
    return {
      ...common,
      directAnswer: SURGE_PUBLIC_IDENTITY_ANSWER,
      status: "answered",
      suggestedQuestions: [],
    };
  }
  if (isSurgeElectricSaulQuestion(message)) {
    return {
      ...common,
      directAnswer: SURGE_ELECTRIC_SAUL_COMPARISON_ANSWER,
      status: "answered",
      suggestedQuestions: [],
    };
  }
  if (isSurgeNamedReferenceQuestion(message)) {
    return {
      ...common,
      directAnswer: SURGE_PUBLIC_REFERENCE_BOUNDARY_ANSWER,
      status: "needs_context",
      suggestedQuestions: [SURGE_PUBLIC_REFERENCE_BOUNDARY_FOLLOW_UP],
    };
  }
  return null;
}

function policyText(answer: EnergyAssistantAnswer) {
  return [
    answer.directAnswer,
    ...answer.practicalSteps,
    answer.nextAction,
    ...answer.assumptions,
    ...answer.suggestedQuestions,
    answer.sourceBoundary,
  ].join("\n");
}

function generatedResultIsPolicySafe(
  generated: SurgeModelResult,
  audience: EnergyAssistantAudience,
  message: string,
  decisionContext: string,
  planPriorityAnswer: EnergyAssistantAnswer | null,
) {
  const continuationText = JSON.stringify(generated.continuation);
  const customerVisibleGeneratedText = generated.presentation
    ? surgePresentationText(generated.presentation, true)
    : policyText(generated.answer);
  const visibleGeneratedText = `${customerVisibleGeneratedText}\n${policyText(generated.answer)}`;
  const generatedText = `${visibleGeneratedText}\n${continuationText}`;
  if (
    surgeOutputViolatesPublicPolicy(visibleGeneratedText)
    || containsSurgeNamedReference(generatedText)
  ) {
    return false;
  }
  // A result marked by the model module has already passed its semantic topic
  // and question-coverage validators. Injected or legacy results cannot claim
  // that private provenance and still require this server-side lexical check.
  if (!surgeModelResultPassedSemanticValidation(generated)
    && !surgeAnswerSharesQuestionIntent(message, generatedText)
    && !surgeAnswerSharesQuestionIntent(decisionContext, generatedText)) return false;
  if (planPriorityAnswer
    && !surgeAnswerPreservesPlanPriority(planPriorityAnswer, customerVisibleGeneratedText)) return false;
  return audience === "trade" || (
    !containsSurgeNamedReference(continuationText)
    && !containsSurgeInternalPlatformName(continuationText)
  );
}

function isGenericNonAnswer(
  answer: EnergyAssistantAnswer,
  presentation: SurgeAnswerPresentation | null = null,
) {
  const visibleText = `${answer.directAnswer}\n${presentation ? surgePresentationText(presentation, true) : ""}`;
  return surgeAnswerIsGenericBoilerplate(visibleText);
}

function groundedAnswerNeedsDirectDelivery(answer: EnergyAssistantAnswer) {
  if (answer.status === "source_review_required") return true;
  const text = answer.directAnswer;
  return /(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:STCs?|VEECs?|ESCs?|PRCs?|kW|kWh|litres?|stars?)\b)/i.test(text)
    || /\b(?:present|listed|registered|approved|eligible)\b[^.\n]{0,120}\b(?:official|register)\b/i.test(text)
    || /\b(?:official|register)\b[^.\n]{0,120}\b(?:present|listed|registered|approved|eligible)\b/i.test(text);
}

const RETAIL_PLAN_DECISION = /\b(?:electricity|energy|retailer)\s+plans?\b|\btariffs?\b|\bfeed[- ]?in\b|\bFIT\b|\bdaily\s+(?:supply\s+)?(?:charge|rate)\b|\b(?:free\s+hours?|hours?\s+free)\b|\b(?:import|export|usage)\s+rates?\b/i;

function groundedAnswerMatchesCurrentDecision(
  message: string,
  answer: EnergyAssistantAnswer,
) {
  const answerText = [answer.directAnswer, ...answer.practicalSteps].join("\n");
  if (isSurgeServiceOrCompetingQuoteRequest(message)) {
    return /\b(?:service|cover|installer|provider|contractor|matched trades?|competing|more|additional)\b[^.\n]{0,100}\bquotes?\b|\bquotes?\b[^.\n]{0,100}\b(?:service|cover|installer|provider|contractor|matched trades?|competing|more|additional)\b/i.test(answerText);
  }
  if (!surgeAnswerMatchesQuestionIntent(message, answerText)) return false;
  if (!RETAIL_PLAN_DECISION.test(message)) return true;
  return RETAIL_PLAN_DECISION.test(answerText)
    || /\b(?:annual bill|free window|outside-window|plan credit|electricity retailer)\b/i.test(answerText);
}

type OfficialJurisdiction = {
  name: string;
  domains: readonly string[];
};

const OFFICIAL_JURISDICTIONS = {
  national: {
    name: "Australia",
    domains: ["energy.gov.au", "cer.gov.au"],
  },
  act: {
    name: "Australian Capital Territory",
    domains: ["act.gov.au"],
  },
  nsw: {
    name: "New South Wales",
    domains: ["energy.nsw.gov.au", "nsw.gov.au", "ipart.nsw.gov.au"],
  },
  nt: {
    name: "Northern Territory",
    domains: ["nt.gov.au"],
  },
  qld: {
    name: "Queensland",
    domains: ["qld.gov.au", "qca.org.au"],
  },
  sa: {
    name: "South Australia",
    domains: ["sa.gov.au", "escosa.sa.gov.au"],
  },
  tas: {
    name: "Tasmania",
    domains: ["recfit.tas.gov.au", "tas.gov.au", "economicregulator.tas.gov.au"],
  },
  vic: {
    name: "Victoria",
    domains: ["solar.vic.gov.au", "energy.vic.gov.au", "esc.vic.gov.au", "service.vic.gov.au"],
  },
  wa: {
    name: "Western Australia",
    domains: ["wa.gov.au", "erawa.com.au"],
  },
} as const satisfies Record<string, OfficialJurisdiction>;

const OFFICIAL_RETAIL_DOMAINS = ["aer.gov.au", "energymadeeasy.gov.au"] as const;
const OFFICIAL_PRODUCT_DOMAINS = [
  "productsafety.gov.au",
  "cer.gov.au",
  "energyrating.gov.au",
] as const;
const OFFICIAL_STANDARD_DOMAINS = ["abcb.gov.au", "standards.org.au"] as const;

function uniqueDomains(...groups: readonly (readonly string[])[]) {
  return [...new Set(groups.flat())];
}

function officialJurisdictionForStateCode(value: string | null | undefined): OfficialJurisdiction | null {
  if (!value) return null;
  const stateCode = value.trim().toLowerCase() as keyof typeof OFFICIAL_JURISDICTIONS;
  return stateCode === "national" ? OFFICIAL_JURISDICTIONS.national : OFFICIAL_JURISDICTIONS[stateCode] || null;
}

function postcodeJurisdiction(value: string | null | undefined) {
  return officialJurisdictionForStateCode(residentialStateFromPostcode(value || ""));
}

function mutableQuestionJurisdiction(
  message: string,
  planContext: ReturnType<typeof parseSurgePlanContext>,
): OfficialJurisdiction | null {
  if (/\b(?:VEECs?|VEU|Victorian Energy Upgrades?|Victorian|Victoria|VIC)\b/i.test(message)) {
    return OFFICIAL_JURISDICTIONS.vic;
  }
  if (/\b(?:ESCs?|PRCs?|ESS|PDRS|New South Wales|NSW)\b/i.test(message)) {
    return OFFICIAL_JURISDICTIONS.nsw;
  }
  if (/\bAustralian Capital Territory\b/i.test(message) || /\bACT\b/.test(message)) {
    return OFFICIAL_JURISDICTIONS.act;
  }
  if (/\b(?:Northern Territory|NT)\b/i.test(message)) return OFFICIAL_JURISDICTIONS.nt;
  if (/\b(?:Queensland|QLD)\b/i.test(message)) return OFFICIAL_JURISDICTIONS.qld;
  if (/\b(?:South Australia|SA)\b/i.test(message)) return OFFICIAL_JURISDICTIONS.sa;
  if (/\b(?:Tasmania|TAS)\b/i.test(message)) return OFFICIAL_JURISDICTIONS.tas;
  if (/\b(?:Western Australia|WA)\b/i.test(message)) return OFFICIAL_JURISDICTIONS.wa;
  if (/\b(?:STCs?|Small-scale Technology Certificates?|Australia(?:n|wide)?|federal|national)\b/i.test(message)) {
    return OFFICIAL_JURISDICTIONS.national;
  }

  const questionPostcodeJurisdiction = postcodeJurisdiction(queryAustralianPostcode(message));
  if (questionPostcodeJurisdiction) return questionPostcodeJurisdiction;

  const savedState = planContext?.facts.find((fact) => fact.key === "state_or_territory")?.value;
  const savedStateJurisdiction = officialJurisdictionForStateCode(savedState);
  if (savedStateJurisdiction) return savedStateJurisdiction;
  const savedPostcode = planContext?.facts.find((fact) => fact.key === "postcode")?.value;
  return postcodeJurisdiction(savedPostcode);
}

function hasExactProductDetail(message: string) {
  return /\b[a-z][a-z0-9-]*\d[a-z0-9-]*\b/i.test(message)
    || /\b[a-z][a-z0-9-]{1,30}\s+\d+[a-z0-9-]*\b/i.test(message);
}

const OFFICIAL_SOURCE_DIRECTORY_REQUEST = /\b(?:official|government|scheme administrator)\b[^?]{0,55}\b(?:sources?|links?|pages?|websites?|registers?|calculators?|guidance)\b|\b(?:sources?|links?|pages?|websites?|registers?|calculators?|guidance)\b[^?]{0,55}\b(?:official|government|scheme administrator)\b/i;

function explainsBothStcsAndVeecs(value: string) {
  return /\bSTCs?\b/i.test(value) && /\bVEECs?\b/i.test(value);
}

function maintainedEvidenceAnswersMutableQuestion(
  kind: SurgeOfficialWebSearchPlan["kind"],
  message: string,
  answer: EnergyAssistantAnswer,
) {
  if (answer.status === "source_review_required" || !answer.citations.some((citation) => !citation.stale)) {
    return false;
  }
  const asksForSourceDirectory = OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message);
  const asksForMutableFact = /\b(?:current|currently|today|right now|as of now|latest|eligible|eligibility|available|availability|open|closed|worth|value|price|rate|rules?|changed|approved|registered|listed|recalled|safe|unsafe|in force|edition|version)\b/i.test(message);
  if (asksForSourceDirectory && !asksForMutableFact) {
    return true;
  }
  const value = answer.directAnswer;
  if (kind === "certificate") {
    if (/\b(?:worth|value|price|rate)\b/i.test(message)) {
      return /\$\s*\d|\b\d+(?:\.\d+)?\s*(?:dollars?|cents?)\b|\b(?:clearing house|market)\b[^.\n]{0,100}\b(?:price|value|rate)\b/i.test(value);
    }
    return /\b(?:version|activity guide|effective|commenced|current rule|current requirement)\b/i.test(value);
  }
  if (kind === "tariff") {
    return /\b\d+(?:\.\d+)?\s*(?:c|cents?|dollars?)\s*(?:\/|per)\s*kWh\b|\$\s*\d|\b(?:no (?:regulated )?minimum|retailer[- ]set|set by (?:the )?retailer)\b/i.test(value);
  }
  if (kind === "rebate_program") {
    return /\b(?:listed current|currently (?:available|open|closed)|is (?:available|open|closed)|may (?:provide|reduce|apply|qualify)|can get (?:a )?discount|not currently available)\b/i.test(value);
  }
  if (kind === "product_status") {
    return /\b(?:present|not present|listed|not listed|registered|not registered|approved|not approved|recalled|not recalled)\b/i.test(value);
  }
  return /\b(?:current|latest|in force|edition|version)\b/i.test(value)
    && /\b(?:AS(?:\s*\/\s*NZS)?|NCC)\s*\d{3,4}(?:[.:]\d+)?\b/i.test(value);
}

function officialWebSearchPlanFor(
  message: string,
  decisionContext: string,
  audience: EnergyAssistantAudience,
  planContext: ReturnType<typeof parseSurgePlanContext>,
  referenceAnswer: EnergyAssistantAnswer,
): SurgeOfficialWebSearchPlan | null {
  const serviceIntent = (isSurgeServiceOrCompetingQuoteRequest(message)
    || /\b(?:find|contact|connect|match|recommend)\b[^?]{0,100}\b(?:installers?|trades?|contractors?|providers?)\b/i.test(message)
    || /\b(?:installers?|trades?|contractors?|providers?)\b[^?]{0,100}\b(?:service|quote|contact|available)\b/i.test(message))
    && !surgeServiceRequestAlsoAsksEnergyDecision(message);
  if (audience === "trade" || serviceIntent) return null;

  const entityContext = decisionContext || message;
  const whenMaintainedEvidenceIsMissing = (plan: SurgeOfficialWebSearchPlan) => (
    maintainedEvidenceAnswersMutableQuestion(plan.kind, message, referenceAnswer) ? null : plan
  );

  const jurisdiction = mutableQuestionJurisdiction(entityContext, planContext);
  const currentIntent = /\b(?:current|currently|today|right now|as of now|latest|available|availability|eligible|eligibility|open|closed|worth|value|price|rate|rules?|changed|approved|registered|listed|recalled|recalls?|safe|unsafe|safety|in force|edition|version)\b/i.test(message)
    || /\bstill\s+(?:available|eligible|open|closed|approved|registered|listed|recalled|safe|unsafe|current|in force)\b/i.test(message);
  const officialSourceIntent = /\b(?:which|what|give|show|open|use|check|verify)\b[^?]{0,80}\b(?:official|government|scheme administrator)\b[^?]{0,45}\b(?:sources?|links?|pages?|websites?|registers?|calculators?|guidance)\b|\b(?:official|government|scheme administrator)\b[^?]{0,45}\b(?:sources?|links?|pages?|websites?|registers?|calculators?|guidance)\b/i.test(message);
  const exactStandard = /\b(?:AS(?:\s*\/\s*NZS)?|NCC)\s*\d{3,4}(?:[.:]\d+)?\b/i.test(entityContext);
  if (
    exactStandard
    && /\b(?:standard|code|edition|version|current|latest|applies?|in force)\b/i.test(message)
  ) {
    return whenMaintainedEvidenceIsMissing({
      kind: "standard",
      jurisdiction: jurisdiction?.name || "Australia",
      allowedDomains: [...OFFICIAL_STANDARD_DOMAINS],
    });
  }

  const productStatus = /\b(?:approved|registered|listed|recalled|recalls?|safe|unsafe|safety (?:alert|notice|status|issue)|fault (?:alert|notice|status)|product register|approved list)\b/i.test(message);
  if (productStatus && hasExactProductDetail(entityContext)) {
    return whenMaintainedEvidenceIsMissing({
      kind: "product_status",
      jurisdiction: jurisdiction?.name || "Australia",
      allowedDomains: [...OFFICIAL_PRODUCT_DOMAINS],
    });
  }

  const certificate = /\b(?:STCs?|VEECs?|ESCs?|PRCs?|Small-scale Technology Certificates?)\b/i.test(entityContext);
  if (certificate && (currentIntent || officialSourceIntent) && jurisdiction) {
    return whenMaintainedEvidenceIsMissing({
      kind: "certificate",
      jurisdiction: jurisdiction.name,
      allowedDomains: uniqueDomains(jurisdiction.domains, OFFICIAL_JURISDICTIONS.national.domains),
    });
  }

  const tariff = /\b(?:tariffs?|feed[- ]?in tariffs?|FIT|supply charge|usage rate|import rate|export rate|default market offer|reference price)\b/i.test(entityContext);
  if (tariff && jurisdiction && (currentIntent || /\b(?:what|which|how much)\b/i.test(message))) {
    return whenMaintainedEvidenceIsMissing({
      kind: "tariff",
      jurisdiction: jurisdiction.name,
      allowedDomains: uniqueDomains(OFFICIAL_RETAIL_DOMAINS, jurisdiction.domains),
    });
  }

  const rebateOrProgram = /\b(?:rebates?|grants?|incentives?|subsid(?:y|ies)|programmes?|programs?|schemes?|government support|financial support|Victorian support|support (?:may|might|could|can) apply)\b/i.test(entityContext);
  const energyCategory = /\b(?:solar|battery|batteries|hot[- ]?water|heat[- ]?pumps?|heating|air ?con(?:ditioning)?|cooling|insulation|draught|windows?|glazing|EV chargers?|electric vehicle chargers?|electrification|appliances?)\b/i.test(
    `${entityContext}\n${referenceAnswer.directAnswer}`,
  );
  const namedProgram = /\b(?:Solar Homes|Victorian Energy Upgrades?|VEU|ESS|PDRS|Home Energy Support|Sustainable Household Scheme)\b/i.test(entityContext);
  const asksAvailability = currentIntent
    || officialSourceIntent
    || /\b(?:what|which|any)\b[^?]{0,80}\b(?:rebates?|grants?|incentives?|programmes?|programs?|schemes?)\b/i.test(message)
    || /\b(?:does|do|can)\b[^?]{0,60}\b(?:rebates?|grants?|incentives?|programmes?|programs?|schemes?|support)\b[^?]{0,30}\b(?:apply|cover|help|available)\b/i.test(message);
  if (rebateOrProgram && jurisdiction && asksAvailability && (energyCategory || namedProgram)) {
    return whenMaintainedEvidenceIsMissing({
      kind: "rebate_program",
      jurisdiction: jurisdiction.name,
      allowedDomains: uniqueDomains(jurisdiction.domains, OFFICIAL_JURISDICTIONS.national.domains),
    });
  }
  return null;
}

function officialSearchUnavailableAnswer(
  message: string,
  plan: SurgeOfficialWebSearchPlan,
  referenceAnswer: EnergyAssistantAnswer,
): EnergyAssistantAnswer {
  const postcode = queryAustralianPostcode(message);
  const stcRate = message.match(/\bSTCs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const veecRate = message.match(/\bVEECs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const certificateRates = stcRate && veecRate
    ? `the quoted $${stcRate} per STC and $${veecRate} per VEEC`
    : "the quoted certificate rates";
  const directAnswer = plan.kind === "certificate"
    ? `I could not verify today's official certificate information, so I cannot confirm whether ${certificateRates} are current. STC and VEEC values can move. The gross market value before provider fees is not the same as the customer's net discount, so the quote should separately show each quantity, gross rate, registration, compliance or brokerage fees and the net credit taken off the price.`
    : plan.kind === "rebate_program"
      ? `I could not verify the current rebate and programme information${postcode ? ` for postcode ${postcode}` : " for the property"}, so do not treat a discount as confirmed yet. Eligibility depends on the exact approved model, installation date, customer and property rules, installer requirements and any previous claim.`
      : plan.kind === "tariff"
        ? "I could not verify the current official tariff information, so I cannot safely call the rate or plan good today. Compare the complete tariff, including usage periods, daily supply charge, export credit, fees and any conditions, against the current official or retailer schedule."
        : plan.kind === "product_status"
          ? "I could not verify the product's current official registration, approval or recall status, so do not rely on a sales claim yet. Check the exact brand and model against the relevant official register before buying or installing it."
          : "I could not verify the current official standard or code information, so I cannot confirm the applicable edition or requirement. Check the exact standard number, jurisdiction and effective date against the official publisher before relying on it.";
  const maintainedReferenceCitations = referenceAnswer.citations
    .filter((citation) => !citation.stale
      && surgeOfficialUrlIsAllowed(citation.url, plan.allowedDomains))
    .slice(0, 4);
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "source_review_required",
    citations: maintainedReferenceCitations,
    assumptions: [],
    confidence: "low",
    suggestedQuestions: plan.kind === "rebate_program"
      ? ["What exact model and installed price are you considering?"]
      : [],
    toolActions: [],
    sourceBoundary: `The current ${plan.kind.replaceAll("_", " ")} lookup did not produce validated official evidence. Any attached maintained official links are reference pages only and do not verify the unavailable live value or status.`,
  };
}

function mergePlanPriorityWithEvidenceAnswer(
  priority: EnergyAssistantAnswer,
  evidence: EnergyAssistantAnswer,
): EnergyAssistantAnswer {
  return {
    directAnswer: evidence.directAnswer.includes(priority.directAnswer)
      ? evidence.directAnswer
      : `${priority.directAnswer}\n\n${evidence.directAnswer}`,
    practicalSteps: [...new Set([
      ...priority.practicalSteps,
      ...evidence.practicalSteps,
    ])].slice(0, 3),
    nextAction: priority.nextAction || evidence.nextAction,
    status: evidence.status,
    citations: evidence.citations.slice(0, 8),
    assumptions: [...new Set([
      ...priority.assumptions,
      ...evidence.assumptions,
    ])].slice(0, 8),
    confidence: evidence.confidence,
    suggestedQuestions: [...new Set([
      ...evidence.suggestedQuestions,
      ...priority.suggestedQuestions,
    ])].slice(0, 4),
    toolActions: evidence.toolActions.slice(0, 4),
    sourceBoundary: evidence.sourceBoundary || priority.sourceBoundary,
  };
}

function isSavedHomeWholePlanRankingRequest(message: string) {
  return isSurgePlanPriorityIntent(message)
    || /\bwhat\s+should\s+come\s+first\b/i.test(message)
    || /\b(?:top|first)\s+(?:three|3)\s+(?:things?|actions?|steps?|priorities)\b[^.!?]{0,55}\b(?:in\s+order|rank(?:ed|ing)?|first)\b/i.test(message)
    || /\b(?:give|show|list|rank)\b[^.!?]{0,45}\b(?:top|first)\s+(?:three|3)\b[^.!?]{0,45}\b(?:things?|actions?|steps?|priorities)\b/i.test(message);
}

const EXPLICIT_DOLLAR_BUDGET_PATTERNS = [
  /\b(?:(?:my|our|the|a)\s+)?(?:first[- ]stage\s+)?budget\s*(?:(?:is|was|of|at|around|about|approximately|up to|no more than|max(?:imum)?(?: of)?|limit(?:ed)? to)\s*)?[:=]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:total\s+)?(?:first[- ]stage\s+)?budget\b/gi,
  /\b(?:have|got)\b[^.!?\n$]{0,12}\$\s*([\d,]+(?:\.\d{1,2})?)\s+(?:(?:available|set aside)\s+)?(?:to spend|for (?:this|the) (?:work|upgrades?|stage))\b/gi,
  /\b(?:I|we)\s+(?:only\s+)?(?:have|have got|got)\s+\$\s*([\d,]+(?:\.\d{1,2})?)(?:\s+(?:available|left))?(?=\s*(?:[.!?,;]|$))/gi,
  /\b(?:(?:can|could|want to|plan to|intend to|looking to)\s+spend|spend(?:ing)?\s+(?:up to|no more than|a maximum of)|spending limit(?: is| of)?)\b[^.!?\n$]{0,20}\$\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\$\s*([\d,]+(?:\.\d{1,2})?)\s+(?:(?:available|set aside)\s+)?to spend\b/gi,
] as const;

const EXPLICIT_DOLLAR_BUDGET_CORRECTION_PATTERNS = [
  /\bbudget\b[^.!?\n]{0,50}\$\s*[\d,]+(?:\.\d{1,2})?[^.!?\n]{0,55}\b(?:but\s+)?(?:now|currently)\s+(?:(?:it|the budget)\s+)?(?:is|stands at|equals)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\bbudget\b[^.!?\n]{0,35}\bchanged\s+from\s+\$\s*[\d,]+(?:\.\d{1,2})?\s+to\s+\$\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\bbudget\b[^.!?\n]{0,35}\b(?:is|equals|stands at)\s+(?:now\s+)?\$\s*([\d,]+(?:\.\d{1,2})?)[^.!?\n]{0,30}\b(?:not|rather than)\s+\$\s*[\d,]+(?:\.\d{1,2})?/gi,
] as const;

function explicitDollarBudget(message: string) {
  const matches: Array<{ amount: string; index: number }> = [];
  for (const pattern of EXPLICIT_DOLLAR_BUDGET_CORRECTION_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      if (match[1]) {
        matches.push({
          amount: match[1],
          index: (match.index ?? 0) + match[0].lastIndexOf(match[1]),
        });
      }
    }
  }
  for (const pattern of EXPLICIT_DOLLAR_BUDGET_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      if (match[1]) matches.push({ amount: match[1], index: match.index ?? 0 });
    }
  }
  const amount = matches.sort((left, right) => left.index - right.index).at(-1)?.amount;
  if (!amount) return "";
  const numeric = Number(amount.replaceAll(",", ""));
  return Number.isFinite(numeric) && numeric > 0
    ? `$${numeric.toLocaleString("en-AU")}`
    : "";
}

type WholePlanReverseCycleState = "working" | "not_working" | "unknown";

function reverseCycleStateFromMessage(
  message: string,
  priorState: WholePlanReverseCycleState,
): Exclude<WholePlanReverseCycleState, "unknown"> | null {
  const namesReverseCycle = /\b(?:reverse[- ]cycle|split(?: system)?|air ?con(?:ditioner|ditioning)?)\b/i.test(message);
  const refersToKnownUnit = priorState !== "unknown"
    && /\b(?:it|the unit|the system|that unit|that system)\b/i.test(message);
  if (!namesReverseCycle && !refersToKnownUnit) return null;
  if (
    /\bno longer\s+(?:heat|heats|heating|work|works|working|run|runs|running)\b/i.test(message)
    || /\b(?:does not|doesn['’]?t|won['’]?t|cannot|can['’]?t)\s+(?:still\s+)?(?:heat|work|run)\b/i.test(message)
    || /\b(?:is not|isn['’]?t|not)\s+(?:currently\s+)?(?:heating|working|running)\b/i.test(message)
    || /\b(?:stopped|has stopped)\s+(?:heating|working|running)\b/i.test(message)
    || /\b(?:heat|heats|heating|work|works|working|run|runs|running)\b[^.!?\n]{0,30}\b(?:poorly|badly|weakly|not properly|no longer|less well|worse)\b/i.test(message)
    || /\b(?:is|has become|seems?)\s+(?:broken|faulty|failed)\b/i.test(message)
  ) return "not_working";
  if (
    /\b(?:still\s+)?(?:heat|heats|heating|work|works|working|run|runs|running)\b[^.!?\n]{0,30}\b(?:well|fine|properly)\b/i.test(message)
    || /\bworking\s+(?:reverse[- ]cycle|split(?: system)?|air ?con(?:ditioner)?)\b/i.test(message)
  ) return "working";
  return null;
}

function effectiveWholePlanConversationFacts(
  message: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
) {
  const userMessages = [
    ...recentTurns.filter((turn) => turn.role === "user").map((turn) => turn.content),
    message,
  ];
  let budget = "";
  let reverseCycleState: WholePlanReverseCycleState = "unknown";
  for (const userMessage of userMessages) {
    const suppliedBudget = explicitDollarBudget(userMessage);
    if (suppliedBudget) budget = suppliedBudget;
    reverseCycleState = reverseCycleStateFromMessage(userMessage, reverseCycleState)
      || reverseCycleState;
  }
  return {
    budget,
    reverseCycleState,
    contextText: userMessages.join("\n"),
  };
}

function composeSavedHomeWholePlanPriorityAnswer(
  message: string,
  planContext: ReturnType<typeof parseSurgePlanContext>,
  recentTurns: readonly EnergyAssistantRecentTurn[],
) {
  let priority = composeSurgePlanPriorityAnswer(message, planContext, recentTurns);
  if (!priority && planContext && isSavedHomeWholePlanRankingRequest(message)) {
    const budget = explicitDollarBudget(message);
    const priorityMessage = budget
      ? `My budget is ${budget}. Based on my saved answers, where should I start?`
      : "Based on my saved answers, where should I start?";
    priority = composeSurgePlanPriorityAnswer(priorityMessage, planContext, recentTurns);
  }
  if (!priority || !planContext || !/start with moisture control/i.test(priority.directAnswer)) {
    return priority;
  }

  // recentTurns is already scoped to the selected conversation frame. Resolve
  // mutable facts in chronological order so a correction replaces, rather
  // than coexists with, the older value for that saved-home decision.
  const effectiveFacts = effectiveWholePlanConversationFacts(message, recentTurns);
  const contextText = effectiveFacts.contextText;
  const hasFrontDoorDraught = /\b(?:air|breeze|draught|draft)\b[^.!?\n]{0,55}\b(?:under|around|through)\b[^.!?\n]{0,35}\b(?:front|entry|external)?\s*door\b|\b(?:front|entry|external)\s+door\b[^.!?\n]{0,55}\b(?:draught|draft|air|breeze|gap)\b/i.test(contextText);
  const hasColdWindows = planContext.facts.some((fact) => (
    fact.key === "glazing" && /single glazed/i.test(fact.value)
  )) || /\bsingle[- ]glazed\s+windows?\b/i.test(contextText);
  if (!hasFrontDoorDraught || !hasColdWindows) return priority;

  const savedPlanBudget = planContext.facts.find((fact) => fact.key === "first_stage_budget")?.value;
  const budget = effectiveFacts.budget
    || savedPlanBudget?.toLowerCase()
    || "the available first-stage budget";
  const moistureStep = "Check and control the condensation first: run the bathroom exhaust whenever moisture is produced, confirm it clears steam, and investigate any persistent damp, leaks or mould before sealing more gaps.";
  const doorStep = "Stop the confirmed front-door draught with a removable door snake now, then fit a correctly sized door-bottom seal if the gap is real and the door still opens freely.";
  const windowStep = "Use the remaining budget on the coldest single-glazed windows: fit close-fitting honeycomb blinds or thermal curtains with pelmets before considering window replacement.";
  const splitDirection = effectiveFacts.reverseCycleState === "working"
    ? " Keep the working reverse-cycle split; replacing it is not a priority while it still heats properly."
    : effectiveFacts.reverseCycleState === "not_working"
      ? " The reverse-cycle split no longer heats properly, so have that change diagnosed instead of treating it as a confirmed working unit."
      : "";
  return {
    ...priority,
    directAnswer: `With ${budget} to spend, start with moisture control, then address the front-door draught and the coldest single-glazed windows.${splitDirection}`,
    practicalSteps: [moistureStep, doorStep, windowStep],
    nextAction: moistureStep,
  };
}

function validatedOfficialCitationsForReply(
  value: unknown,
  plan: SurgeOfficialWebSearchPlan,
): SurgeOfficialWebCitation[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 4) return null;
  const citations: SurgeOfficialWebCitation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string" || typeof record.title !== "string") return null;
    const publicCitation = sanitizeSurgeCustomerOfficialCitation({
      ...record,
      sourceTier: "primary_official",
    }, citations.length);
    if (!publicCitation
      || !surgeOfficialUrlIsAllowed(publicCitation.url, plan.allowedDomains)) return null;
    const canonicalUrl = publicCitation.url;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    citations.push({
      id: `official-web-${citations.length + 1}`,
      title: publicCitation.title,
      publisher: publicCitation.publisher,
      url: canonicalUrl,
    });
  }
  return citations.length ? citations : null;
}

function validatedMaintainedRecoveryCitationsForReply(
  value: unknown,
  plan: SurgeOfficialWebSearchPlan,
  reviewedCitations: readonly unknown[],
) {
  const citations = validatedOfficialCitationsForReply(value, plan);
  if (!citations) return null;
  const reviewedCitationKeys = new Set(reviewedCitations.flatMap((candidate, index) => {
    const citation = sanitizeSurgeCustomerOfficialCitation(candidate, index);
    return citation ? [`${citation.url}\n${citation.title}`] : [];
  }));
  return citations.every((citation) => (
    reviewedCitationKeys.has(`${citation.url}\n${citation.title}`)
  ))
    ? citations
    : null;
}

function customerFacingOfficialCitations(
  liveCitations: readonly SurgeOfficialWebCitation[],
  maintainedCitations: readonly unknown[],
) {
  const citations: SurgeOfficialWebCitation[] = [];
  const seen = new Set<string>();
  for (const candidate of [...liveCitations, ...maintainedCitations]) {
    const citation = sanitizeSurgeCustomerOfficialCitation(candidate, citations.length);
    if (!citation || seen.has(citation.url)) continue;
    seen.add(citation.url);
    citations.push(citation);
    if (citations.length >= 4) break;
  }
  return citations;
}

function safeContinuationText(value: string, audience: EnergyAssistantAudience) {
  const clean = normalizeEnergyAssistantBrandText(audience === "trade"
    ? sanitizeSurgeReferenceText(value)
    : sanitizeSurgePublicText(value));
  return surgeOutputViolatesPublicPolicy(clean) ? "" : clean;
}

function safeUserContinuationText(value: string, audience: EnergyAssistantAudience) {
  const clean = audience === "trade"
    ? sanitizeSurgeReferenceText(value)
    : sanitizeSurgePublicText(value);
  const attributed = clean.replace(
    /\bI(?:\s+am|'m)\s+((?:(?:fully|formally|officially|accredited|certified|licensed|registered)\s+){0,3}(?:(?:home[- ]?energy|energy)\s+)?assessor)\b/gi,
    "User role: $1",
  );
  return surgeOutputViolatesPublicPolicy(attributed) ? "" : attributed;
}

function publicSafeContinuation(
  state: SurgeConversationState,
  audience: EnergyAssistantAudience,
): SurgeConversationState {
  return {
    ...state,
    goal: safeUserContinuationText(state.goal, audience),
    facts: state.facts.map((fact) => ({
      ...fact,
      value: safeUserContinuationText(fact.value, audience),
    })),
    ...(state.ledger ? {
      ledger: {
        ...state.ledger,
        subjects: state.ledger.subjects.map((subject) => ({
          ...subject,
          label: safeContinuationText(subject.label, audience) || "Conversation subject",
          facts: subject.facts.map((fact) => ({
            ...fact,
            value: fact.source === "chat" || fact.source === "plan"
              ? safeUserContinuationText(fact.value, audience)
              : safeContinuationText(fact.value, audience),
          })).filter((fact) => fact.value),
        })),
        decisions: state.ledger.decisions.map((decision) => ({
          ...decision,
          goal: safeUserContinuationText(decision.goal, audience),
          facts: decision.facts.map((fact) => ({
            ...fact,
            value: fact.source === "chat" || fact.source === "plan"
              ? safeUserContinuationText(fact.value, audience)
              : safeContinuationText(fact.value, audience),
          })).filter((fact) => fact.value),
          outcomeSummary: safeContinuationText(decision.outcomeSummary, audience),
          openItems: decision.openItems.map((item) => safeContinuationText(item, audience)).filter(Boolean),
          pendingQuestion: safeContinuationText(decision.pendingQuestion, audience),
        })),
      },
    } : {}),
    pendingQuestion: safeContinuationText(state.pendingQuestion, audience),
    lastAnswerSummary: safeContinuationText(state.lastAnswerSummary, audience),
  };
}

function expandedConversationGoal(goal: string, message: string) {
  const segments = goal
    .split(/\s+\|\s+/u)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const normalizedMessage = message.replace(/\s+/g, " ").trim();
  if (normalizedMessage && !segments.some((part) => (
    part.localeCompare(normalizedMessage, undefined, { sensitivity: "accent" }) === 0
  ))) {
    segments.push(normalizedMessage);
  }
  return limitedText(segments.join(" | "), 240);
}

function continuationAfterDeliveredReply(
  state: SurgeConversationState,
  message: string,
  reply: EnergyAssistantReply,
  preserveModelSummary: boolean,
  intent: SurgeConversationTurnIntent,
): SurgeConversationState {
  const topic = surgeConversationTopicFor(message);
  const incompatibleNamedTopicChange = Boolean(topic)
    && state.activeTopic !== "general"
    && topic !== state.activeTopic
    && !surgeConversationTopicsAreCompatible(topic, state.activeTopic);
  const resetPriorTopicState = !preserveModelSummary
    && (intent === "topic_change"
      || intent === "correction_and_topic_change"
      || incompatibleNamedTopicChange
      || (intent === "new_question" && (!topic || topic !== state.activeTopic)));
  const baseState = resetPriorTopicState
    ? {
        ...emptySurgeConversationState(),
        facts: state.facts.filter((fact) => /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size|situation)$/.test(fact.key)),
        ...(state.ledger ? { ledger: state.ledger } : {}),
      }
    : state;
  const correctionReframesDecision = intent === "correction"
    && surgeConversationCorrectionReframesDecision(message);
  const continuingDecision = intent === "answer_to_follow_up"
    || intent === "contextual_follow_up"
    || intent === "clarification"
    || (intent === "correction" && !correctionReframesDecision);
  const preservesPriorDecision = continuingDecision && !incompatibleNamedTopicChange;
  const activeTopic = continuingDecision
    && baseState.activeTopic !== "general"
    && topic
    && surgeConversationTopicsAreCompatible(baseState.activeTopic, topic)
    ? baseState.activeTopic
    : topic || baseState.activeTopic || "general";
  const priorLedgerDecision = baseState.ledger?.decisions.find(
    (decision) => decision.id === baseState.ledger?.activeDecisionId,
  );
  const priorDecisionTopic = priorLedgerDecision?.topic || baseState.activeTopic;
  const compatibleTopicExpansion = Boolean(topic)
    && priorDecisionTopic !== "general"
    && topic !== priorDecisionTopic
    && surgeConversationTopicsAreCompatible(topic, priorDecisionTopic);
  const goal = compatibleTopicExpansion
    ? expandedConversationGoal(baseState.goal, message)
    : preserveModelSummary && baseState.goal
    ? baseState.goal
    : preservesPriorDecision && baseState.goal
    ? baseState.goal
    : limitedText(message, 240);
  return {
    ...baseState,
    activeTopic,
    goal,
    facts: mergeSurgeConversationFacts(
      baseState.facts,
      surgeConversationFactsFromMessage(message, activeTopic),
    ),
    pendingQuestion: reply.followUpQuestion,
    lastAnswerSummary: preserveModelSummary && state.lastAnswerSummary
      ? state.lastAnswerSummary
      : limitedText(reply.directAnswer, 300),
  };
}

function continuationForServiceEnquiry(
  state: SurgeConversationState,
  context: SurgeServiceConversationContext,
  reply: EnergyAssistantReply,
) {
  const scope = context.services.length
    ? context.services.join(", ")
    : "home-energy work";
  const location = context.postcode || context.locality || "location required";
  const serviceFacts = [
    { key: "service_scope", value: scope },
    { key: "service_subject", value: context.jobSubject },
    { key: "service_location", value: context.postcode ? `postcode ${context.postcode}` : context.locality || location },
    ...(context.postcode ? [{ key: "service_postcode", value: context.postcode }] : []),
    { key: "service_matching", value: "all relevant local trades; no preferred supplier" },
    { key: "service_sent", value: "false" },
  ];
  return {
    ...state,
    activeTopic: "service_enquiry",
    goal: limitedText(`Arrange ${scope} enquiries for ${context.jobSubject} at ${location}`, 240),
    facts: mergeSurgeConversationFacts(state.facts, serviceFacts),
    pendingQuestion: "",
    lastAnswerSummary: limitedText(reply.directAnswer, 300),
  };
}

function neutralIndependentFallback(): EnergyAssistantAnswer {
  return {
    directAnswer:
      "I can explain the practical pros and cons and neutrally compare exact options you provide, but I will not choose or endorse a product, brand, supplier or installer for you. The useful comparison is verified performance, suitability for the home, warranty, service support and the complete installed scope.",
    practicalSteps: [],
    nextAction: "",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "high",
    suggestedQuestions: ["Which exact customer-supplied options and home requirements should I compare?"],
    toolActions: [],
    sourceBoundary: "",
  };
}

function enforceCustomerPolicy(
  answer: EnergyAssistantAnswer,
  deterministicAnswer: EnergyAssistantAnswer,
  protectedAnswer: EnergyAssistantAnswer | null,
) {
  if (protectedAnswer) return protectedAnswer;
  const safeCandidate = customerSafeAnswer(answer);
  if (!surgeOutputViolatesPublicPolicy(policyText(safeCandidate))) return safeCandidate;
  const safeDeterministic = customerSafeAnswer(deterministicAnswer);
  if (!surgeOutputViolatesPublicPolicy(policyText(safeDeterministic))) return safeDeterministic;
  return neutralIndependentFallback();
}

function buildReply(
  answerInput: EnergyAssistantAnswer,
  message: string,
  presentationInput: SurgeAnswerPresentation | null,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  planContext: ReturnType<typeof parseSurgePlanContext>,
  continuation: SurgeConversationState | null,
  requiredPendingQuestion: string,
  officialCitations: SurgeOfficialWebCitation[],
  now: Date,
  randomUUID: () => string,
): EnergyAssistantReply {
  const answer = boundedAnswer(answerInput);
  const publicOfficialCitations = customerFacingOfficialCitations(
    officialCitations,
    answer.citations,
  );
  const candidateFollowUp = limitedText(
    requiredPendingQuestion || presentationInput?.followUpQuestion || answer.suggestedQuestions[0] || "",
    220,
  );
  const followUpDecisionContext = surgeConversationDecisionContext(
    message,
    continuation,
    recentTurns,
  );
  const proposedFollowUp = OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message)
    || (presentationInput
      && !modelFollowUpIsRequired(message, followUpDecisionContext, candidateFollowUp))
    ? ""
    : candidateFollowUp;
  const asksForCurrentVerdict = /\b(?:which|what)\b[^?]{0,50}\b(?:choose|pick|prefer)\b|\b(?:would|should)\s+(?:you|I|we)\s+(?:choose|pick|prefer)\b|\bworth\b[^?]{0,45}\b(?:extra|premium|money|price|cost)\b/i.test(message);
  const repeatsUnansweredPending = (!requiredPendingQuestion || asksForCurrentVerdict)
    && Boolean(continuation?.pendingQuestion)
    && questionsAreSimilar(proposedFollowUp, continuation?.pendingQuestion || "");
  const followUpQuestion = repeatsUnansweredPending || surgeFollowUpWasAlreadyAnswered(
    proposedFollowUp,
    message,
    recentTurns,
    planContext,
    continuation,
  )
    ? ""
    : proposedFollowUp;
  const rawPresentation = presentationInput
    ? normalizeSurgeAnswerPresentation({ ...presentationInput, followUpQuestion })
    : deriveSurgeAnswerPresentation(answer, message);
  const candidatePresentation = normalizeSurgeAnswerPresentation({
    ...rawPresentation,
    followUpQuestion,
    quickReplies: [],
  });
  const fallbackPresentation = deriveSurgeAnswerPresentation(answer, message);
  const presentation = surgePresentationPassesEverydayLanguage(candidatePresentation)
    ? candidatePresentation
    : normalizeSurgeAnswerPresentation({
      ...fallbackPresentation,
      followUpQuestion,
      quickReplies: [],
    });
  const rawReply: EnergyAssistantReply = {
    id: randomUUID().toLowerCase(),
    role: "assistant",
    content: surgePresentationText(presentation, true),
    directAnswer: answer.directAnswer,
    createdAt: now.toISOString(),
    status: presentationInput && answer.status === "needs_context" && !followUpQuestion
      ? "answered"
      : answer.status,
    confidence: answer.confidence,
    answerType: presentation.answerType,
    verdict: presentation.verdict,
    reason: presentation.reason,
    practicalSteps: presentation.steps,
    extraDetail: presentation.extraDetail,
    followUpQuestion: presentation.followUpQuestion,
    quickReplies: [],
    citations: publicOfficialCitations,
  };
  const reply: EnergyAssistantReply = {
    ...rawReply,
    content: normalizeEnergyAssistantBrandText(rawReply.content),
    directAnswer: normalizeEnergyAssistantBrandText(rawReply.directAnswer),
    verdict: normalizeEnergyAssistantBrandText(rawReply.verdict),
    reason: normalizeEnergyAssistantBrandText(rawReply.reason),
    practicalSteps: rawReply.practicalSteps.map(normalizeEnergyAssistantBrandText),
    extraDetail: normalizeEnergyAssistantBrandText(rawReply.extraDetail),
    followUpQuestion: normalizeEnergyAssistantBrandText(rawReply.followUpQuestion),
    quickReplies: rawReply.quickReplies.map((quickReply) => ({
      ...quickReply,
      label: normalizeEnergyAssistantBrandText(quickReply.label),
      message: normalizeEnergyAssistantBrandText(quickReply.message),
    })),
  };
  if (new TextEncoder().encode(JSON.stringify(reply)).byteLength > ENERGY_ASSISTANT_MAX_RESPONSE_BYTES) {
    throw new EnergyAssistantServerError(
      503,
      "ASSISTANT_RESPONSE_LIMIT",
      "The energy guide could not produce a bounded response. Please narrow the question and retry.",
    );
  }
  return reply;
}

function normalizedQuestionWords(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/u).filter((word) => word.length > 2));
}

function questionsAreSimilar(left: string, right: string) {
  const leftWords = normalizedQuestionWords(left);
  const rightWords = normalizedQuestionWords(right);
  if (!leftWords.size || !rightWords.size) return false;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.min(leftWords.size, rightWords.size) >= 0.72;
}

function surgeFollowUpWasAlreadyAnswered(
  question: string,
  currentMessage: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  planContext: ReturnType<typeof parseSurgePlanContext>,
  continuation: SurgeConversationState | null,
) {
  if (!question) return false;
  const lastAssistant = [...recentTurns].reverse().find((turn) => turn.role === "assistant")?.content || "";
  const latestUser = [...recentTurns].reverse().find((turn) => turn.role === "user")?.content || "";
  const planText = (planContext?.facts || []).map((fact) => `${fact.key}: ${fact.value}`).join("\n");
  const frame = selectSurgeConversationFrame(currentMessage, continuation, Boolean(planContext));
  const ledgerText = [
    ...frame.subjects.flatMap((subject) => subject.facts.map((fact) => `${fact.key}: ${fact.value}`)),
    ...frame.relatedDecisions.flatMap((decision) => [
      decision.goal,
      ...decision.facts.map((fact) => `${fact.key}: ${fact.value}`),
      decision.outcomeSummary,
    ]),
  ].join("\n");
  const knownLedgerKeys = new Set([
    ...frame.subjects.flatMap((subject) => subject.facts.map((fact) => fact.key)),
    ...frame.relatedDecisions.flatMap((decision) => decision.facts.map((fact) => fact.key)),
  ]);
  const knownText = `${planText}\n${ledgerText}\n${recentTurns.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n")}\n${currentMessage}`;
  const knownPlanKeys = new Set((planContext?.facts || []).map((fact) => fact.key));

  if (lastAssistant
    && questionsAreSimilar(question, lastAssistant)
    && /^(?:yes|yeah|yep|correct|no|nah|nope|not really|not sure|unsure|maybe)\b/i.test(currentMessage.trim())) {
    return true;
  }
  if (/\bpostcode\b/i.test(question)
    && (knownPlanKeys.has("postcode")
      || knownLedgerKeys.has("postcode")
      || recentTurns.some((turn) => turn.role === "user"
        && surgeMessageAnswersPendingQuestion(turn.content, question))
      || surgeMessageAnswersPendingQuestion(currentMessage, question))) return true;
  if (/\b(?:own|rent|tenant|owner)\b/i.test(question) && /\b(?:rent|renter|tenant|owner|own the home)\b/i.test(knownText)) return true;
  if (/\bwhich (?:room|area)|what (?:room|area)\b/i.test(question)
    && /\b(?:bedroom|lounge|living room|bathroom|kitchen|whole home|whole house)\b/i.test(`${latestUser}\n${currentMessage}`)) return true;
  if (/\b(?:does|can|is)\b[^?]{0,70}\b(?:split|reverse[- ]?cycle|air ?con(?:ditioner)?|unit|system)\b[^?]{0,70}\b(?:heat|warm|work|adequate)/i.test(question)
    && /\b(?:split|reverse[- ]?cycle|air ?con(?:ditioner)?|unit|system)\b[^.\n]{0,80}\b(?:still\s+heats?|heats?\s+(?:fine|properly|well|adequately)|keeps?[^.\n]{0,30}\bwarm)\b/i.test(knownText)) return true;
  const knownFactQuestions = [
    {
      keys: ["household_size"],
      question: /\b(?:how many people|household size|how many (?:live|occupants))\b/i,
      answer: /\b(?:one|two|three|four|five|six|seven|eight|\d+)\s+(?:people|persons?|occupants?)\b/i,
    },
    {
      keys: ["solar"],
      question: /\b(?:do|does|have|has)\b[^?]{0,35}\b(?:solar|panels?|rooftop)\b/i,
      answer: /\b(?:have|has|with|without|no|not have|already have)\b[^.\n]{0,30}\b(?:solar|panels?|rooftop)\b/i,
    },
    {
      keys: ["battery"],
      question: /\b(?:do|does|have|has)\b[^?]{0,35}\bbatter(?:y|ies)\b/i,
      answer: /\b(?:have|has|with|without|no|not have|already have)\b[^.\n]{0,30}\bbatter(?:y|ies)\b/i,
    },
    {
      keys: ["glazing"],
      question: /\b(?:single|double|triple|what|which|type)\b[^?]{0,35}\b(?:glass|glazing|windows?)\b|\b(?:glass|glazing|windows?)\b[^?]{0,35}\b(?:single|double|triple|what|which|type)\b/i,
      answer: /\b(?:single|double|triple)[- ]?glaz(?:ed|ing)\b/i,
    },
    {
      keys: ["ceiling_insulation"],
      question: /\b(?:do|does|have|has|what)\b[^?]{0,40}\b(?:ceiling|roof) insulation\b/i,
      answer: /\b(?:no|none|some|unknown|not sure|R\s*\d|batts?|insulation)\b[^.\n]{0,35}\b(?:ceiling|roof|insulation)\b/i,
    },
    {
      keys: ["heating_cooling_systems"],
      question: /\b(?:current|existing|what|which)\b[^?]{0,40}\b(?:heater|heating|air ?con|cooling system)\b/i,
      answer: /\b(?:ducted gas|gas heating|gas heater|split system|reverse[- ]?cycle(?: air ?con(?:ditioner)?)?|wood heater|electric heater|electric heating)\b/i,
    },
    {
      keys: ["hot_water"],
      question: /\b(?:current|existing|what|which)\b[^?]{0,40}\b(?:hot water|water heater)\b/i,
      answer: /\b(?:gas|electric|heat[- ]?pump|solar)\b[^.\n]{0,35}\b(?:hot water|water heater)\b/i,
    },
    {
      keys: ["switchboard"],
      question: /\b(?:switchboard|fuse box|single[- ]?phase|three[- ]?phase)\b/i,
      answer: /\b(?:have|has|with|using|currently on|connected to|supply is|switchboard is|fuse box is)\b[^.\n]{0,35}\b(?:modern breakers?|ceramic fuses?|single[- ]?phase|three[- ]?phase|switchboard|fuse box)\b|\b(?:single[- ]?phase|three[- ]?phase)\s+(?:supply|power|connection)\b/i,
    },
    {
      keys: ["first_stage_budget"],
      question: /\b(?:budget|spend|afford)\b/i,
      answer: /\b(?:budget|under|up to|around|about|\$\s*\d)\b/i,
    },
  ] as const;
  if (knownFactQuestions.some(({ keys, question: asks, answer: known }) => (
    asks.test(question)
    && (keys.some((key) => knownPlanKeys.has(key)) || known.test(knownText))
  ))) return true;
  return false;
}

function pendingQuestionIsRequiredDecisionInput(question: string) {
  return /\bpostcode\b|\b(?:state|territory)\b|\b(?:own|owner|rent|renter|tenant)\b|\b(?:how many people|household size)\b|\bwhat\b[^?]{0,55}\b(?:heating system|heater|hot water|water heater)\b[^?]{0,35}\breplac(?:e|ing)\b|\b(?:exact )?(?:brand|model|capacity|equipment details?)\b/i.test(question);
}

function requiredPendingQuestionForTurn(
  message: string,
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
) {
  const pendingQuestion = continuation?.pendingQuestion || "";
  if (!pendingQuestion) return "";
  const asksForOfficialDirectory = OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message);
  const asksHowToCollectEquipmentDetails = /\b(?:what|which|how)\b[^?]{0,90}\b(?:equipment|product|model|installation|quote)\b[^?]{0,70}\b(?:details?|information)\b|\b(?:what|which)\s+(?:exact\s+)?(?:equipment|product|model|installation|quote)\s+details?\b/i.test(message);
  if (asksForOfficialDirectory || asksHowToCollectEquipmentDetails) return "";
  if (intent === "clarification") return pendingQuestion;
  if ((intent === "contextual_follow_up" || intent === "answer_to_follow_up")
    && pendingQuestionIsRequiredDecisionInput(pendingQuestion)
    && !surgeMessageAnswersPendingQuestion(message, pendingQuestion)) {
    return pendingQuestion;
  }
  return "";
}

function needsDeterministicHeatingDefault(message: string, answer: EnergyAssistantAnswer) {
  return answer.status === "answered"
    && /\b(?:most\s+efficient|efficient|best|cheapest|running\s+cost|cost\s+less)\b/i.test(message)
    && (/\b(?:portable|plug[- ]?in)\s+(?:electric\s+)?heaters?\b/i.test(message)
      || (/\breverse[- ]cycle\b/i.test(message) && /\bgas\b/i.test(message)))
    && /\bnormal first choice for heating a room\b/i.test(answer.directAnswer);
}

async function readBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > ENERGY_ASSISTANT_MAX_BODY_BYTES) {
    throw new EnergyAssistantServerError(413, "REQUEST_TOO_LARGE", "The assistant request is too large.");
  }
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > ENERGY_ASSISTANT_MAX_BODY_BYTES) {
    throw new EnergyAssistantServerError(413, "REQUEST_TOO_LARGE", "The assistant request is too large.");
  }
  try {
    return asRecord(JSON.parse(source));
  } catch (error) {
    if (error instanceof EnergyAssistantServerError) throw error;
    throw new EnergyAssistantServerError(400, "INVALID_JSON", "Send valid JSON.");
  }
}

async function ask(request: Request, dependencies: ServerDependencies) {
  const monotonicNow = dependencies.monotonicNow || (() => performance.now());
  const startedAt = monotonicNow();
  const requestBody = await readBody(request);
  if (requestBody.action !== "ask") {
    throw new EnergyAssistantServerError(
      400,
      "INVALID_ACTION",
      "The stateless assistant endpoint accepts only the ask action.",
    );
  }
  const message = cleanText(requestBody.message, "Message", 1, ENERGY_ASSISTANT_MAX_MESSAGE_CHARS);
  const requestId = clientRequestIdFrom(requestBody.requestId ?? requestBody.clientRequestId);
  const pageContext = pageContextFrom(requestBody.pageContext);
  const audience = publicAudienceFrom(requestBody.audience);
  const recentTurns = recentTurnsFrom(requestBody.recentTurns);
  const incomingContinuation = continuationFrom(requestBody.continuation);
  const submittedPlanContext = audience === "trade" ? null : planContextFrom(requestBody.planContext);
  const priorPlanContextCorrections = incomingContinuation?.planContextCorrections || [];
  const incomingCorrectionFrame = selectSurgeConversationFrame(
    message,
    incomingContinuation,
    Boolean(submittedPlanContext),
  );
  const incomingActiveDecision = incomingContinuation?.ledger?.decisions.find((decision) => (
    decision.id === incomingContinuation.ledger?.activeDecisionId
  ));
  const correctionFrameUsesOnlySavedHome = incomingCorrectionFrame.subjects.length > 0
    && incomingCorrectionFrame.subjects.every((subject) => subject.id === "saved_home");
  const correctionFrameUsesOnlyGeneralAdvice = incomingCorrectionFrame.subjects.length > 0
    && incomingCorrectionFrame.subjects.every((subject) => subject.kind === "general");
  const correctionHasNoPropertyAnchor = incomingCorrectionFrame.subjects.length === 0
    && !incomingActiveDecision;
  const directSavedPlanCorrections = submittedPlanContext
    && !questionExcludesSavedHomeContext(message)
    ? surgePlanContextCorrectionsAfterRecentHomeFactChanges(
        priorPlanContextCorrections,
        message,
        [],
      )
    : priorPlanContextCorrections;
  const directSavedPlanCorrectionChanged = directSavedPlanCorrections.length !== priorPlanContextCorrections.length
    || directSavedPlanCorrections.some((correction, index) => (
      correction !== priorPlanContextCorrections[index]
    ));
  const detectedCurrentSavedPlanCorrections = submittedPlanContext
    && !questionExcludesSavedHomeContext(message)
    ? surgePlanContextCorrectionsAfterRecentHomeFactChanges([], message, [])
    : [];
  const detectedCurrentSavedPlanCorrectionFacts = surgeSavedPlanCorrectionFactsForMessage(
    message,
    detectedCurrentSavedPlanCorrections,
  );
  const correctionFrameAllowsImplicitSavedHome = correctionFrameUsesOnlySavedHome
    || correctionFrameUsesOnlyGeneralAdvice
    || correctionHasNoPropertyAnchor;
  const directSavedPlanUpdate = Boolean(submittedPlanContext)
    && !questionExcludesSavedHomeContext(message)
    && (explicitlyUsesSavedHomeContext(message) || correctionFrameAllowsImplicitSavedHome)
    && (directSavedPlanCorrectionChanged || detectedCurrentSavedPlanCorrectionFacts.length > 0);
  const correctionExplicitlyTargetsSavedHome = explicitlyUsesSavedHomeContext(message)
    || directSavedPlanUpdate;
  const mayUpdateSavedPlanCorrections = correctionExplicitlyTargetsSavedHome
    || correctionFrameUsesOnlySavedHome
    || correctionHasNoPropertyAnchor;
  const affirmedSavedPlanCorrections = submittedPlanContext && mayUpdateSavedPlanCorrections
    ? surgePlanContextCorrectionsAfterRecentHomeFactChanges([], message, [])
    : [];
  const currentSavedPlanCorrectionFacts = mayUpdateSavedPlanCorrections
    ? surgeSavedPlanCorrectionFactsForMessage(message, affirmedSavedPlanCorrections)
    : [];
  const correctionRecentTurns = !incomingContinuation || correctionFrameUsesOnlySavedHome
    ? recentTurns
    : [];
  const planContextCorrections = submittedPlanContext && mayUpdateSavedPlanCorrections
      ? surgePlanContextCorrectionsAfterRecentHomeFactChanges(
        priorPlanContextCorrections,
        message,
        correctionRecentTurns,
      )
    : priorPlanContextCorrections;
  const savedPlanCorrectionSourceMessages = [
    ...correctionRecentTurns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content),
    message,
  ];
  const observedSavedPlanCorrectionFacts = planContextCorrections.flatMap((correction) => {
    for (let index = savedPlanCorrectionSourceMessages.length - 1; index >= 0; index -= 1) {
      const facts = surgeSavedPlanCorrectionFactsForMessage(
        savedPlanCorrectionSourceMessages[index],
        [correction],
      );
      if (facts.length) return facts;
    }
    return [];
  });
  const continuation = incomingContinuation
    ? applySurgePlanContextCorrectionsToConversationState(
        incomingContinuation,
        planContextCorrections,
      )
    : null;
  const framedContinuation = projectSurgeConversationStateToFrame(
    message,
    continuation,
    Boolean(submittedPlanContext),
  );
  const conversationIntent = classifySurgeConversationTurn(message, framedContinuation, recentTurns);
  const decisionRecentTurns = recentTurnsForActiveDecision(
    message,
    recentTurns,
    framedContinuation,
    conversationIntent,
  );
  const decisionContext = currentReplyDecisionContext(
    message,
    recentTurns,
    decisionRecentTurns,
    framedContinuation,
  );
  const modelRecentTurns = decisionRecentTurns;
  const fullRecentUserMessages = recentTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  const documentQuoteConversation = isEnergyDocumentQuoteConversationRequest(
    message,
    fullRecentUserMessages,
  );
  const serviceLocationFollowUp = isSurgeServiceLocationFollowUp(
    message,
    fullRecentUserMessages,
  );
  const initialServiceRequest = isSurgeServiceOrCompetingQuoteRequest(message)
    && !surgeServiceRequestAlsoAsksEnergyDecision(message);
  const serviceConversationFollowUp = isSurgeServiceConversationFollowUp(
    message,
    fullRecentUserMessages,
  );
  const serviceContext = surgeServiceConversationContext(message, fullRecentUserMessages);
  const needsFullDeterministicHistory = documentQuoteConversation
    || initialServiceRequest
    || serviceConversationFollowUp;
  const compose = dependencies.composeAnswer || composeEnergyAssistantAnswer;
  const selectedFrame = selectSurgeConversationFrame(
    message,
    continuation,
    Boolean(submittedPlanContext),
  );
  const selectedLedgerSubjectUsesSavedHome = selectedFrame.subjects.some((subject) => subject.id === "saved_home");
  const selectedPlanContext = submittedPlanContext
    && !questionExcludesSavedHomeContext(message)
    && (selectedLedgerSubjectUsesSavedHome
      || affirmedSavedPlanCorrections.length > 0
      || directSavedPlanUpdate
      || explicitlyUsesSavedHomeContext(message)
      || (isSurgePlanPriorityIntent(message)
        && (!selectedFrame.subject || selectedFrame.subject.kind === "general"))
      || (!selectedFrame.subject && currentQuestionUsesSavedHomeContext(
        message,
        recentTurns,
        framedContinuation,
        conversationIntent,
      )))
    ? submittedPlanContext
    : null;
  const planContext = applySurgePlanContextCorrections(
    selectedPlanContext,
    planContextCorrections,
  );
  const deterministicContextTurns = needsFullDeterministicHistory
    || compose !== composeEnergyAssistantAnswer
    ? recentTurns
    : decisionRecentTurns;
  const priorUserMessages = deterministicContextTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  const priorAssistantMessages = deterministicContextTurns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.content);
  if (planContext) priorUserMessages.unshift(surgePlanContextSummary(planContext));
  const governedFinanceFacts = surgeRecurringFinanceConversationFacts(message, fullRecentUserMessages);
  const requiresGovernedFinanceCalculation = governedFinanceFacts.length > 0;
  const now = dateFrom(dependencies);
  const deterministicMessage = compose === composeEnergyAssistantAnswer
    ? needsFullDeterministicHistory
      ? message
      : pendingQuestionContextMessage(message, framedContinuation, conversationIntent, decisionRecentTurns)
    : message;
  const composedAnswer = compose(deterministicMessage, {
    audience,
    pageContext,
    asOf: now,
    priorUserMessages,
    priorAssistantMessages,
  });
  const pendingAnswer = compose === composeEnergyAssistantAnswer
    ? pendingRoomAnswer(message, framedContinuation, conversationIntent, composedAnswer)
    : null;
  const safetyAnswer = composeSurgeSafetyAnswer(message, priorUserMessages);
  const nonCurrentHazardAnswer = safetyAnswer
    ? null
    : composeSurgeNonCurrentHazardAnswer(message, priorUserMessages);
  const requiresDeterministicSafety = Boolean(safetyAnswer);
  const requiresDeterministicDocumentAnswer = documentQuoteConversation;
  const requiresDeterministicScopeBoundary = isSurgeExplicitlyOutsideScope(message);
  const requiresDeterministicHeatingDefault = needsDeterministicHeatingDefault(message, composedAnswer);
  const requiresDeterministicServiceAnswer = initialServiceRequest
    || serviceLocationFollowUp
    || serviceConversationFollowUp;
  const protectedAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicServiceAnswer
    ? null
    : publicPolicyAnswer(message);
  const planPriorityAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicScopeBoundary || requiresDeterministicHeatingDefault
    || requiresDeterministicServiceAnswer || protectedAnswer
    ? null
    : composeSavedHomeWholePlanPriorityAnswer(message, planContext, decisionRecentTurns);
  const planPriorityParts = planPriorityAnswer ? surgeMaterialQuestionParts(message) : [];
  const correctionAcknowledgement = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicScopeBoundary || requiresDeterministicHeatingDefault
    || requiresDeterministicServiceAnswer || protectedAnswer || planPriorityAnswer || pendingAnswer
    ? null
    : savedHomeCorrectionAcknowledgement(
        message,
        affirmedSavedPlanCorrections,
        currentSavedPlanCorrectionFacts,
        composedAnswer,
      );
  const simpleAnswer = compose !== composeEnergyAssistantAnswer
    || requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicScopeBoundary || requiresDeterministicHeatingDefault
    || requiresDeterministicServiceAnswer
    || protectedAnswer || planPriorityAnswer || pendingAnswer || correctionAcknowledgement
    || (OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message)
      && composedAnswer.citations.some((citation) => !citation.stale))
    ? null
    : composeSurgeSimpleAnswer(message, composedAnswer, planContext, decisionRecentTurns);
  let deterministicAnswer = safetyAnswer
    || protectedAnswer
    || planPriorityAnswer
    || nonCurrentHazardAnswer
    || pendingAnswer
    || correctionAcknowledgement
    || simpleAnswer
    || composedAnswer;
  const inheritedDecision = conversationIntent === "answer_to_follow_up"
    || conversationIntent === "contextual_follow_up"
    || conversationIntent === "clarification"
    || conversationIntent === "correction";
  if (inheritedDecision && !requiresDeterministicSafety && !protectedAnswer) {
    const selectedText = policyText(deterministicAnswer);
    const composedText = policyText(composedAnswer);
    const selectedFailedDecision = isGenericNonAnswer(deterministicAnswer)
      || !surgeAnswerMatchesQuestionIntent(decisionContext, selectedText);
    const composedFitsDecision = !isGenericNonAnswer(composedAnswer)
      && surgeAnswerMatchesQuestionIntent(decisionContext, composedText);
    if (selectedFailedDecision && composedFitsDecision) deterministicAnswer = composedAnswer;
  }
  let answer = deterministicAnswer;
  let presentation: SurgeAnswerPresentation | null = null;
  let answerSource: "deterministic" | "grounded" | "model" = "deterministic";
  let nextContinuation: SurgeConversationState = framedContinuation || emptySurgeConversationState();
  let officialCitations: SurgeOfficialWebCitation[] = [];
  if (!requiresDeterministicSafety
    && (!requiresDeterministicDocumentAnswer
      || (dependencies.requireValidatedModelForOrdinaryAdvice && !requiresGovernedFinanceCalculation))
    && !requiresDeterministicScopeBoundary
    && !requiresDeterministicServiceAnswer && !protectedAnswer) {
    const modelRequest: SurgeModelRequest = {
      message,
      audience,
      pageContext,
      asOf: now,
      recentTurns: modelRecentTurns,
      continuation: framedContinuation,
      planContext,
      deterministicAnswer,
    };
    const groundedCandidate = dependencies.resolveGroundedAnswer
      ? await dependencies.resolveGroundedAnswer(modelRequest).catch(() => null)
      : null;
    const groundedAnswer = groundedCandidate
      && !isGenericNonAnswer(groundedCandidate)
      && groundedAnswerMatchesCurrentDecision(message, groundedCandidate)
      ? groundedCandidate
      : null;
    const referenceAnswer = groundedAnswer && planPriorityAnswer
      ? mergePlanPriorityWithEvidenceAnswer(planPriorityAnswer, groundedAnswer)
      : groundedAnswer || deterministicAnswer;
    const officialWebSearch = officialWebSearchPlanFor(
      message,
      decisionContext,
      audience,
      planContext,
      referenceAnswer,
    );
    const modelReferenceAnswer = officialWebSearch
      ? {
          ...referenceAnswer,
          citations: [...referenceAnswer.citations, ...composedAnswer.citations]
            .filter((citation) => (
              citation.sourceTier === "primary_official"
              && !citation.stale
              && surgeOfficialUrlIsAllowed(citation.url, officialWebSearch.allowedDomains)
            ))
            .filter((citation, index, all) => (
              all.findIndex((candidate) => candidate.url === citation.url) === index
            ))
            .slice(0, 8),
        }
      : referenceAnswer;
    const deliverGroundedDirectly = !dependencies.requireValidatedModelForOrdinaryAdvice && groundedAnswer
      ? groundedAnswerNeedsDirectDelivery(groundedAnswer) && !officialWebSearch
      : false;
    if (deliverGroundedDirectly && groundedAnswer) {
      answer = groundedAnswer;
      answerSource = "grounded";
    }
    if (!deliverGroundedDirectly && dependencies.reserveModelCall) {
      const groundedModelRequest: SurgeModelRequest = {
        ...modelRequest,
        deterministicAnswer: modelReferenceAnswer,
        officialWebSearch,
      };
      const estimatedMicroUsd = estimateSurgeModelReservationMicroUsd(groundedModelRequest);
      if (estimatedMicroUsd !== null) {
        const reservation = await reserveSurgeModelCallWithBoundedRetry(
          dependencies.reserveModelCall,
          {
            requestId: requestId || (dependencies.randomUUID || (() => crypto.randomUUID()))(),
            estimatedMicroUsd,
          },
          dependencies,
        );
        if (reservation.allowed) {
          try {
            const generate = dependencies.generateAnswer || generateSurgeModelAnswer;
            const generated = await generate(groundedModelRequest).catch(() => null);
            const generatedLiveOfficialCitations = officialWebSearch && generated
              ? validatedOfficialCitationsForReply(generated.officialCitations, officialWebSearch)
              : null;
            const generatedMaintainedRecoveryCitations = officialWebSearch
              && generated?.officialEvidenceMode === "maintained_recovery"
              ? validatedMaintainedRecoveryCitationsForReply(
                  generated.answer.citations,
                  officialWebSearch,
                  modelReferenceAnswer.citations,
                )
              : null;
            const generatedOfficialCitations = generated?.officialEvidenceMode === "maintained_recovery"
              ? generatedMaintainedRecoveryCitations || []
              : generatedLiveOfficialCitations;
            if (generated
              && (!officialWebSearch || generatedOfficialCitations)
              && generatedResultIsPolicySafe(
                 generated,
                 audience,
                 message,
                 decisionContext,
                 planPriorityAnswer,
              )
              && !isGenericNonAnswer(generated.answer, generated.presentation || null)) {
              const attachDualCertificateReferences = !officialWebSearch
                && explainsBothStcsAndVeecs(message)
                && explainsBothStcsAndVeecs(policyText(generated.answer));
              const maintainedDirectoryCitations = !officialWebSearch
                && (OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message) || attachDualCertificateReferences)
                ? [...referenceAnswer.citations, ...composedAnswer.citations]
                    .filter((citation, index, all) => (
                      citation.sourceTier === "primary_official"
                      && !citation.stale
                      && all.findIndex((candidate) => candidate.url === citation.url) === index
                    ))
                : [];
              answer = maintainedDirectoryCitations.length
                ? {
                    ...generated.answer,
                    citations: [
                      ...generated.answer.citations,
                      ...maintainedDirectoryCitations,
                    ].filter((citation, index, all) => (
                      all.findIndex((candidate) => candidate.url === citation.url) === index
                    )).slice(0, 8),
                  }
                : generated.officialEvidenceMode === "maintained_recovery"
                  ? {
                      ...generated.answer,
                      citations: generatedMaintainedRecoveryCitations
                        ? generated.answer.citations.filter((citation) => (
                            generatedMaintainedRecoveryCitations.some((allowed) => (
                              allowed.url === citation.url
                            ))
                          ))
                        : [],
                    }
                  : generated.answer;
              presentation = generated.presentation || null;
              nextContinuation = generated.continuation;
              officialCitations = generatedOfficialCitations || [];
              answerSource = "model";
            }
          } finally {
            await reservation.release().catch(() => undefined);
          }
        }
      }
    }
    if (officialWebSearch && answerSource !== "model") {
      answer = officialSearchUnavailableAnswer(message, officialWebSearch, referenceAnswer);
      presentation = null;
      officialCitations = [];
    } else if (answerSource === "deterministic" && groundedAnswer) {
      answer = groundedAnswer;
      answerSource = "grounded";
    }
    if (OFFICIAL_SOURCE_DIRECTORY_REQUEST.test(message) && answerSource !== "model") {
      const maintainedDirectoryCitations = [
        ...composedAnswer.citations,
        ...(groundedAnswer?.citations || []),
      ].filter((citation, index, all) => (
        citation.sourceTier === "primary_official"
        && !citation.stale
        && all.findIndex((candidate) => candidate.url === citation.url) === index
      )).slice(0, 8);
      answer = maintainedDirectoryCitations.length
        ? {
            ...answer,
            citations: [...answer.citations, ...maintainedDirectoryCitations]
              .filter((citation, index, all) => (
                all.findIndex((candidate) => candidate.url === citation.url) === index
              ))
              .slice(0, 8),
          }
        : {
            ...answer,
            sourceBoundary: `${answer.sourceBoundary} No relevant maintained official link was available for this general priority request.`,
          };
    }
    if (planPriorityAnswer && planPriorityParts.length > 1 && answerSource !== "model") {
      const evidenceAnswer = answer !== planPriorityAnswer
        ? answer
        : !isGenericNonAnswer(composedAnswer)
          && surgeAnswerMatchesQuestionIntent(decisionContext, policyText(composedAnswer))
          ? composedAnswer
          : null;
      if (evidenceAnswer) answer = mergePlanPriorityWithEvidenceAnswer(planPriorityAnswer, evidenceAnswer);
    }
    if (dependencies.requireValidatedModelForOrdinaryAdvice && answerSource !== "model") {
      throw new EnergyAssistantServerError(
        503,
        "SURGE_AI_TEMPORARILY_UNAVAILABLE",
        "I could not complete a reliable answer just now. Your question is ready to retry in a moment.",
      );
    }
  }
  const publicAnswer = requiresDeterministicSafety
    ? answer
    : withoutUnconfirmedEmergencyCallAdvice(answer);
  const publicDeterministicAnswer = requiresDeterministicSafety
    ? deterministicAnswer
    : withoutUnconfirmedEmergencyCallAdvice(deterministicAnswer);
  const safeAnswer = audience === "trade"
    ? answer
    : enforceCustomerPolicy(publicAnswer, publicDeterministicAnswer, protectedAnswer);
  const requiredPendingQuestion = requiresDeterministicSafety
    || requiresDeterministicDocumentAnswer
    || requiresDeterministicScopeBoundary
    || requiresDeterministicServiceAnswer
    || protectedAnswer
    || planPriorityAnswer
    ? ""
    : requiredPendingQuestionForTurn(
        message,
        framedContinuation,
        conversationIntent,
      );
  const reply = buildReply(
    safeAnswer,
    message,
    answerSource === "model" && safeAnswer.directAnswer === answer.directAnswer ? presentation : null,
    recentTurns,
    planContext,
    framedContinuation,
    requiredPendingQuestion,
    answerSource === "model" && safeAnswer.directAnswer === answer.directAnswer
      ? officialCitations
      : [],
    now,
    dependencies.randomUUID || (() => crypto.randomUUID()),
  );
  const modelStateWithLedger = continuation?.ledger && !nextContinuation.ledger
    ? { ...nextContinuation, ledger: continuation.ledger }
    : nextContinuation;
  const baseDeliveredState = requiresDeterministicScopeBoundary
    ? continuation || emptySurgeConversationState()
    : continuationAfterDeliveredReply(
        modelStateWithLedger,
        message,
        reply,
        answerSource === "model",
        conversationIntent,
      );
  const deliveredState = serviceContext && requiresDeterministicServiceAnswer
    ? continuationForServiceEnquiry(baseDeliveredState, serviceContext, reply)
    : baseDeliveredState;
  const ledgerIntent = serviceConversationFollowUp
    ? serviceContext?.correctionRequested
      ? "correction"
      : "contextual_follow_up"
    : initialServiceRequest
      ? "topic_change"
    : conversationIntent;
  const derivedFacts = answerSource === "deterministic"
    ? governedFinanceFacts
    : [];
  const ledgerStateBeforePlanCorrections = requiresDeterministicScopeBoundary
    ? deliveredState
    : updateSurgeConversationLedger(deliveredState, {
        message,
        answerSummary: reply.content,
        followUpQuestion: reply.followUpQuestion,
        intent: ledgerIntent,
        planFacts: planContext?.facts || [],
        modelState: deliveredState,
        derivedFacts,
        savedHomeCorrectionFacts: observedSavedPlanCorrectionFacts,
        forceSavedHomeSubject: directSavedPlanUpdate,
      });
  const {
    planContextCorrections: previousPlanContextCorrections,
    ...ledgerStateWithoutPlanCorrections
  } = ledgerStateBeforePlanCorrections;
  void previousPlanContextCorrections;
  const ledgerStateWithPlanCorrections: SurgeConversationState = planContextCorrections.length
    ? {
        ...ledgerStateWithoutPlanCorrections,
        planContextCorrections: [...planContextCorrections],
      }
    : ledgerStateWithoutPlanCorrections;
  const ledgerState = applySurgePlanContextCorrectionsToConversationState(
    ledgerStateWithPlanCorrections,
    planContextCorrections,
  );
  const safeContinuation = publicSafeContinuation(ledgerState, audience);
  const publicPolicyPassed = audience === "trade" || (
    !surgeOutputViolatesPublicPolicy(`${reply.content}\n${JSON.stringify(safeContinuation)}`)
    && !containsSurgeNamedReference(JSON.stringify(safeContinuation))
    && !containsSurgeInternalPlatformName(JSON.stringify(safeContinuation))
  );
  const quality = evaluateSurgeConversationQuality({
    day: now.toISOString().slice(0, 10),
    audience,
    message,
    before: continuation,
    after: safeContinuation,
    answerSource,
    answerStatus: reply.status,
    publicPolicyPassed,
    followUpQuestion: reply.followUpQuestion,
    presentation: {
      answerType: reply.answerType,
      verdict: reply.verdict,
      reason: reply.reason,
      steps: reply.practicalSteps,
      extraDetail: reply.extraDetail,
      followUpQuestion: reply.followUpQuestion,
      quickReplies: reply.quickReplies,
    },
    latencyMs: monotonicNow() - startedAt,
    metadata: dependencies.qualityMetadata,
  });
  const exposeQualityCategories = request.headers.get("x-surge-quality-rehearsal") === "aggregate-v1";
  const response = {
    ok: true,
    ...(requestId ? { requestId } : {}),
    reply,
    continuation: safeContinuation,
    ...(exposeQualityCategories ? {
      quality: {
        answerSource: quality.answerSource,
        answerStatus: quality.answerStatus,
      },
    } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(response)).byteLength > ENERGY_ASSISTANT_MAX_RESPONSE_BYTES) {
    throw new EnergyAssistantServerError(
      503,
      "ASSISTANT_RESPONSE_LIMIT",
      "The energy guide could not produce a bounded response. Please narrow the question and retry.",
    );
  }
  if (dependencies.recordQuality) {
    await dependencies.recordQuality(quality).catch(() => undefined);
  }
  return response;
}

export async function handleEnergyAssistantRequest(
  request: Request,
  dependencies: ServerDependencies = {},
) {
  try {
    requireSameOrigin(request);
    if (request.method !== "POST") {
      return json({
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST to ask the energy guide a question.",
        },
      }, 405, { Allow: "POST" });
    }
    return json(await ask(request, dependencies));
  } catch (error) {
    return errorResponse(error);
  }
}
