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
  isSurgeImplementationIdentityQuestion,
  isSurgeNamedReferenceQuestion,
  isSurgeServiceLocationFollowUp,
  isSurgeServiceOrCompetingQuoteRequest,
  queryAustralianPostcode,
  sanitizeSurgePublicText,
  sanitizeSurgeReferenceText,
  surgeServiceRequestAlsoAsksEnergyDecision,
  SURGE_ELECTRIC_SAUL_COMPARISON_ANSWER,
  SURGE_PUBLIC_IDENTITY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_FOLLOW_UP,
  surgeOutputViolatesPublicPolicy,
  type EnergyAssistantAnswer,
} from "./energy-assistant.ts";
import {
  classifySurgeConversationTurn,
  emptySurgeConversationState,
  parseSurgeConversationState,
  surgeConversationTopicFor,
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
} from "./energy-assistant-plan-priority.ts";
import {
  estimateSurgeModelReservationMicroUsd,
  generateSurgeModelAnswer,
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
  composeSurgeSimpleAnswer,
  surgeAnswerMatchesQuestionIntent,
} from "./surge-simple-answer.ts";
import {
  composeSurgeNonCurrentHazardAnswer,
  composeSurgeSafetyAnswer,
} from "./surge-safety-answer.ts";

export const ENERGY_ASSISTANT_RETENTION_DAYS = 30;
export const ENERGY_ASSISTANT_MAX_MESSAGE_CHARS = 1_200;
export const ENERGY_ASSISTANT_MAX_RECENT_TURNS = 8;
export const ENERGY_ASSISTANT_MAX_RECENT_TURN_CHARS = 1_200;
export const ENERGY_ASSISTANT_MAX_RECENT_CONTENT_CHARS = 6_000;
export const ENERGY_ASSISTANT_MAX_BODY_BYTES = 16_384;
export const ENERGY_ASSISTANT_MAX_RESPONSE_BYTES = 32_768;

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
  | { allowed: false }
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
};

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
    const content = cleanText(
      record.content,
      `Recent turn ${index + 1} content`,
      1,
      ENERGY_ASSISTANT_MAX_RECENT_TURN_CHARS,
    );
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
    || /\b(?:my|our) (?:home|house|place|property|apartment|unit|bill|usage|heater|air ?con|hot water|roof|windows?|insulation|solar|battery|quote)\b/i.test(value)
    || firstPersonHomeFact
    || /\b(?:i|we) (?:need|want)\s+(?:an?\s+)?(?:solar system|battery|heater|air ?con(?:ditioner)?|heat pump|hot water system|EV charger|quote|installer)\b/i.test(value)
    || /\b(?:i am|we are)\s+(?:an?\s+)?(?:owner|homeowner|renter|tenant|cold|freezing|hot|uncomfortable)\b/i.test(value)
    || /\b(?:worth|suitable|right|best|recommended|make sense|good idea|ok(?:ay)?)\b[^?]{0,35}\bfor\s+(?:me|us)\b/i.test(value)
    || (!generalHowExplainer && /\bwork(?:s)?\b[^?]{0,35}\bfor\s+(?:me|us)\b/i.test(value))
    || /\b(?:suit|fit)s?\s+(?:me|us)\b/i.test(value)
    || /\b(?:should|can|could|would|do)\s+(?:i|we)\s+(?:get|add|install|put\s+in|replace|upgrade|choose|buy|use|switch|size)\b/i.test(value)
    || /\bwhat\s+size\b[^?]{0,80}\bshould\s+(?:i|we)\b/i.test(value)
    || /\bwould\b[^?]{0,80}\bsuit\s+(?:me|us)\b/i.test(value)
    || /\bwhat\b[^?]{0,50}\b(?:suit|fit)s?\s+our\s+household\b/i.test(value)
    || isSurgePlanPriorityIntent(value);
}

function currentQuestionUsesSavedHomeContext(
  message: string,
  recentTurns: readonly EnergyAssistantRecentTurn[],
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
) {
  const question = message.trim();
  if (!question) return false;

  // A newly named property, site or job is authoritative and must not inherit a
  // different home's survey facts simply because both questions share a topic.
  if (/\b(?:another|different|other|second|new)\s+(?:home|house|property|site|job|shed|building)\b|\bcontainer\s+shed\b/i.test(question)) {
    return false;
  }

  if (explicitlyUsesSavedHomeContext(question)) {
    return true;
  }

  const recentPersonalQuestion = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .some((turn) => explicitlyUsesSavedHomeContext(turn.content));

  if (recentPersonalQuestion
    && continuation
    && (intent === "answer_to_follow_up"
      || intent === "contextual_follow_up"
      || intent === "clarification")) {
    return true;
  }

  // Short follow-ups can inherit a home-specific subject from the conversation,
  // but a standalone general knowledge question must stay general.
  if (/\b(?:it|that|this|they|those|the same|instead)\b/i.test(question)) {
    return recentPersonalQuestion;
  }

  return false;
}

function pendingQuestionContextMessage(
  message: string,
  continuation: SurgeConversationState | null,
  intent: SurgeConversationTurnIntent,
) {
  if (intent !== "answer_to_follow_up" || !continuation?.pendingQuestion) return message;
  return `${continuation.pendingQuestion}\nCustomer answer: ${message}`;
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
  recentTurns: readonly EnergyAssistantRecentTurn[],
  followUpQuestion: string,
) {
  const candidate = followUpQuestion.trim();
  if (!candidate || !candidate.includes("?")) return false;
  const conversation = `${recentTurns.map((turn) => turn.content).join("\n")}\n${message}`;
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
  return sanitizeSurgePublicText(value);
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
) {
  const continuationText = JSON.stringify(generated.continuation);
  const generatedText = `${policyText(generated.answer)}\n${generated.presentation ? surgePresentationText(generated.presentation, true) : ""}\n${continuationText}`;
  if (
    surgeOutputViolatesPublicPolicy(generatedText)
    || containsSurgeNamedReference(generatedText)
  ) {
    return false;
  }
  if (!surgeAnswerSharesQuestionIntent(message, generatedText)) return false;
  return audience === "trade" || (
    !containsSurgeNamedReference(continuationText)
    && !containsSurgeInternalPlatformName(continuationText)
  );
}

const SURGE_GENERIC_NON_ANSWER_PATTERNS = [
  /\b(?:question|request|query) is not specific enough\b/i,
  /\bI (?:found|have) (?:a )?related (?:current )?official source\b/i,
  /\bname the exact home-energy decision\b/i,
  /\btell me the home or trade decision\b/i,
  /\bwhat topic would you like (?:covered|recreated)\b/i,
  /\bgoverned (?:product )?evidence could not be verified\b/i,
  /\btry again (?:later|after (?:current )?official (?:product )?evidence)\b/i,
  /\bmatched your [a-z -]+ question\b/i,
  /^\s*(?:it depends|that depends|I need more (?:details|information|context)|please provide more (?:details|information|context))[.!?]*\s*$/i,
] as const;

function isGenericNonAnswer(
  answer: EnergyAssistantAnswer,
  presentation: SurgeAnswerPresentation | null = null,
) {
  const visibleText = `${answer.directAnswer}\n${presentation ? surgePresentationText(presentation, true) : ""}`;
  return SURGE_GENERIC_NON_ANSWER_PATTERNS.some((pattern) => pattern.test(visibleText));
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
  if (/\b(?:VEECs?|VEU|Victorian Energy Upgrades?|Victoria|VIC)\b/i.test(message)) {
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

function maintainedEvidenceAnswersMutableQuestion(
  kind: SurgeOfficialWebSearchPlan["kind"],
  message: string,
  answer: EnergyAssistantAnswer,
) {
  if (answer.status === "source_review_required" || !answer.citations.some((citation) => !citation.stale)) {
    return false;
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
    return /\b(?:listed current|currently (?:available|open|closed)|is (?:available|open|closed)|may (?:provide|reduce)|not currently available)\b/i.test(value);
  }
  if (kind === "product_status") {
    return /\b(?:present|not present|listed|not listed|registered|not registered|approved|not approved|recalled|not recalled)\b/i.test(value);
  }
  return /\b(?:current|latest|in force|edition|version)\b/i.test(value)
    && /\b(?:AS(?:\s*\/\s*NZS)?|NCC)\s*\d{3,4}(?:[.:]\d+)?\b/i.test(value);
}

function officialWebSearchPlanFor(
  message: string,
  audience: EnergyAssistantAudience,
  planContext: ReturnType<typeof parseSurgePlanContext>,
  referenceAnswer: EnergyAssistantAnswer,
): SurgeOfficialWebSearchPlan | null {
  const serviceIntent = (isSurgeServiceOrCompetingQuoteRequest(message)
    || /\b(?:find|contact|connect|match|recommend)\b[^?]{0,100}\b(?:installers?|trades?|contractors?|providers?)\b/i.test(message)
    || /\b(?:installers?|trades?|contractors?|providers?)\b[^?]{0,100}\b(?:service|quote|contact|available)\b/i.test(message))
    && !surgeServiceRequestAlsoAsksEnergyDecision(message);
  if (audience === "trade" || serviceIntent) return null;

  const whenMaintainedEvidenceIsMissing = (plan: SurgeOfficialWebSearchPlan) => (
    maintainedEvidenceAnswersMutableQuestion(plan.kind, message, referenceAnswer) ? null : plan
  );

  const jurisdiction = mutableQuestionJurisdiction(message, planContext);
  const currentIntent = /\b(?:current|currently|today|now|latest|still|available|availability|eligible|eligibility|open|closed|worth|value|price|rate|rules?|changed|approved|registered|listed|recalled|recalls?|safe|unsafe|safety|in force|edition|version)\b/i.test(message);
  const exactStandard = /\b(?:AS(?:\s*\/\s*NZS)?|NCC)\s*\d{3,4}(?:[.:]\d+)?\b/i.test(message);
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
  if (productStatus && hasExactProductDetail(message)) {
    return whenMaintainedEvidenceIsMissing({
      kind: "product_status",
      jurisdiction: jurisdiction?.name || "Australia",
      allowedDomains: [...OFFICIAL_PRODUCT_DOMAINS],
    });
  }

  const certificate = /\b(?:STCs?|VEECs?|ESCs?|PRCs?|Small-scale Technology Certificates?)\b/i.test(message);
  if (certificate && currentIntent && jurisdiction) {
    return whenMaintainedEvidenceIsMissing({
      kind: "certificate",
      jurisdiction: jurisdiction.name,
      allowedDomains: uniqueDomains(jurisdiction.domains, OFFICIAL_JURISDICTIONS.national.domains),
    });
  }

  const tariff = /\b(?:tariffs?|feed[- ]?in tariffs?|FIT|supply charge|usage rate|import rate|export rate|default market offer|reference price)\b/i.test(message);
  if (tariff && jurisdiction && (currentIntent || /\b(?:what|which|how much)\b/i.test(message))) {
    return whenMaintainedEvidenceIsMissing({
      kind: "tariff",
      jurisdiction: jurisdiction.name,
      allowedDomains: uniqueDomains(OFFICIAL_RETAIL_DOMAINS, jurisdiction.domains),
    });
  }

  const rebateOrProgram = /\b(?:rebates?|grants?|incentives?|subsid(?:y|ies)|programmes?|programs?|schemes?)\b/i.test(message);
  const energyCategory = /\b(?:solar|battery|batteries|hot[- ]?water|heat[- ]?pumps?|heating|air ?con(?:ditioning)?|cooling|insulation|draught|windows?|glazing|EV chargers?|electric vehicle chargers?|electrification|appliances?)\b/i.test(message);
  const namedProgram = /\b(?:Solar Homes|Victorian Energy Upgrades?|VEU|ESS|PDRS|Home Energy Support|Sustainable Household Scheme)\b/i.test(message);
  const asksAvailability = currentIntent
    || /\b(?:what|which|any|does|do|can)\b[^?]{0,80}\b(?:rebates?|grants?|incentives?|programmes?|programs?|schemes?)\b/i.test(message);
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
): EnergyAssistantAnswer {
  const postcode = queryAustralianPostcode(message);
  const stcRate = message.match(/\bSTCs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const veecRate = message.match(/\bVEECs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const certificateRates = stcRate && veecRate
    ? `the quoted $${stcRate} per STC and $${veecRate} per VEEC`
    : "the quoted certificate rates";
  const directAnswer = plan.kind === "certificate"
    ? `I could not verify today's official certificate information, so I cannot confirm whether ${certificateRates} are current. STC and VEEC values can move, and the quote should separately show each quantity, gross rate, registration, compliance or brokerage fees and the net credit taken off the price.`
    : plan.kind === "rebate_program"
      ? `I could not verify the current rebate and programme information${postcode ? ` for postcode ${postcode}` : " for the property"}, so do not treat a discount as confirmed yet. Eligibility depends on the exact approved model, installation date, customer and property rules, installer requirements and any previous claim.`
      : plan.kind === "tariff"
        ? "I could not verify the current official tariff information, so I cannot safely call the rate or plan good today. Compare the complete tariff, including usage periods, daily supply charge, export credit, fees and any conditions, against the current official or retailer schedule."
        : plan.kind === "product_status"
          ? "I could not verify the product's current official registration, approval or recall status, so do not rely on a sales claim yet. Check the exact brand and model against the relevant official register before buying or installing it."
          : "I could not verify the current official standard or code information, so I cannot confirm the applicable edition or requirement. Check the exact standard number, jurisdiction and effective date against the official publisher before relying on it.";
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "source_review_required",
    citations: [],
    assumptions: [],
    confidence: "low",
    suggestedQuestions: plan.kind === "rebate_program"
      ? ["What exact model and installed price are you considering?"]
      : [],
    toolActions: [],
    sourceBoundary: `The current ${plan.kind.replaceAll("_", " ")} lookup did not produce validated official evidence.`,
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
    if (!surgeOfficialUrlIsAllowed(record.url, plan.allowedDomains)) return null;
    const url = new URL(record.url);
    const title = record.title.trim().slice(0, 260);
    if (!title) return null;
    url.hash = "";
    const canonicalUrl = url.href;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    citations.push({
      id: `official-web-${citations.length + 1}`,
      title,
      publisher: url.hostname.toLowerCase(),
      url: canonicalUrl,
    });
  }
  return citations.length ? citations : null;
}

function safeContinuationText(value: string, audience: EnergyAssistantAudience) {
  const clean = audience === "trade"
    ? sanitizeSurgeReferenceText(value)
    : sanitizeSurgePublicText(value);
  return surgeOutputViolatesPublicPolicy(clean) ? "" : clean;
}

function publicSafeContinuation(
  state: SurgeConversationState,
  audience: EnergyAssistantAudience,
): SurgeConversationState {
  return {
    ...state,
    goal: safeContinuationText(state.goal, audience),
    facts: state.facts.map((fact) => ({
      ...fact,
      value: safeContinuationText(fact.value, audience),
    })),
    pendingQuestion: safeContinuationText(state.pendingQuestion, audience),
    lastAnswerSummary: safeContinuationText(state.lastAnswerSummary, audience),
  };
}

function continuationAfterDeliveredReply(
  state: SurgeConversationState,
  message: string,
  reply: EnergyAssistantReply,
  preserveModelSummary: boolean,
  intent: SurgeConversationTurnIntent,
): SurgeConversationState {
  const topic = surgeConversationTopicFor(message);
  const resetPriorTopicState = !preserveModelSummary
    && (intent === "topic_change" || intent === "correction_and_topic_change");
  const baseState = resetPriorTopicState ? emptySurgeConversationState() : state;
  return {
    ...baseState,
    activeTopic: topic || baseState.activeTopic || "general",
    pendingQuestion: reply.followUpQuestion,
    lastAnswerSummary: preserveModelSummary && state.lastAnswerSummary
      ? state.lastAnswerSummary
      : limitedText(reply.directAnswer, 300),
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
  officialCitations: SurgeOfficialWebCitation[],
  now: Date,
  randomUUID: () => string,
): EnergyAssistantReply {
  const answer = boundedAnswer(answerInput);
  const candidateFollowUp = limitedText(
    presentationInput?.followUpQuestion || answer.suggestedQuestions[0] || "",
    220,
  );
  const proposedFollowUp = presentationInput
    && !modelFollowUpIsRequired(message, recentTurns, candidateFollowUp)
    ? ""
    : candidateFollowUp;
  const followUpQuestion = surgeFollowUpWasAlreadyAnswered(
    proposedFollowUp,
    message,
    recentTurns,
    planContext,
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
  const reply: EnergyAssistantReply = {
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
    citations: officialCitations,
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
) {
  if (!question) return false;
  const lastAssistant = [...recentTurns].reverse().find((turn) => turn.role === "assistant")?.content || "";
  const latestUser = [...recentTurns].reverse().find((turn) => turn.role === "user")?.content || "";
  const planText = (planContext?.facts || []).map((fact) => `${fact.key}: ${fact.value}`).join("\n");
  const knownText = `${planText}\n${recentTurns.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n")}\n${currentMessage}`;
  const knownPlanKeys = new Set((planContext?.facts || []).map((fact) => fact.key));

  if (lastAssistant && questionsAreSimilar(question, lastAssistant) && latestUser) return true;
  if (/\bpostcode\b/i.test(question) && /\b\d{4}\b/.test(knownText)) return true;
  if (/\b(?:own|rent|tenant|owner)\b/i.test(question) && /\b(?:rent|renter|tenant|owner|own the home)\b/i.test(knownText)) return true;
  if (/\bwhich (?:room|area)|what (?:room|area)\b/i.test(question)
    && /\b(?:bedroom|lounge|living room|bathroom|kitchen|whole home|whole house)\b/i.test(`${latestUser}\n${currentMessage}`)) return true;
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
  const modelRecentTurns = recentTurns;
  const continuation = continuationFrom(requestBody.continuation);
  const conversationIntent = classifySurgeConversationTurn(message, continuation, recentTurns);
  const submittedPlanContext = audience === "trade" ? null : planContextFrom(requestBody.planContext);
  const planContext = submittedPlanContext
    && currentQuestionUsesSavedHomeContext(message, recentTurns, continuation, conversationIntent)
    ? submittedPlanContext
    : null;
  const priorUserMessages = recentTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  if (planContext) priorUserMessages.unshift(surgePlanContextSummary(planContext));
  const now = dateFrom(dependencies);
  const compose = dependencies.composeAnswer || composeEnergyAssistantAnswer;
  const deterministicMessage = compose === composeEnergyAssistantAnswer
    ? pendingQuestionContextMessage(message, continuation, conversationIntent)
    : message;
  const composedAnswer = compose(deterministicMessage, { audience, pageContext, asOf: now, priorUserMessages });
  const pendingAnswer = compose === composeEnergyAssistantAnswer
    ? pendingRoomAnswer(message, continuation, conversationIntent, composedAnswer)
    : null;
  const safetyAnswer = composeSurgeSafetyAnswer(message, priorUserMessages);
  const nonCurrentHazardAnswer = safetyAnswer
    ? null
    : composeSurgeNonCurrentHazardAnswer(message, priorUserMessages);
  const requiresDeterministicSafety = Boolean(safetyAnswer);
  const requiresDeterministicDocumentAnswer = isEnergyDocumentQuoteConversationRequest(message, priorUserMessages);
  const requiresDeterministicHeatingDefault = needsDeterministicHeatingDefault(message, composedAnswer);
  const serviceLocationFollowUp = isSurgeServiceLocationFollowUp(message, priorUserMessages);
  const requiresDeterministicServiceAnswer = serviceLocationFollowUp
    || (isSurgeServiceOrCompetingQuoteRequest(message)
      && !surgeServiceRequestAlsoAsksEnergyDecision(message));
  const protectedAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicServiceAnswer
    ? null
    : publicPolicyAnswer(message);
  const planPriorityAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicHeatingDefault || requiresDeterministicServiceAnswer || protectedAnswer
    ? null
    : composeSurgePlanPriorityAnswer(message, planContext, recentTurns);
  const simpleAnswer = compose !== composeEnergyAssistantAnswer
    || requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    || requiresDeterministicHeatingDefault || requiresDeterministicServiceAnswer
    || protectedAnswer || planPriorityAnswer || pendingAnswer
    ? null
    : composeSurgeSimpleAnswer(deterministicMessage, composedAnswer, planContext, recentTurns);
  const deterministicAnswer = safetyAnswer
    || protectedAnswer
    || planPriorityAnswer
    || nonCurrentHazardAnswer
    || pendingAnswer
    || simpleAnswer
    || composedAnswer;
  let answer = deterministicAnswer;
  let presentation: SurgeAnswerPresentation | null = null;
  let answerSource: "deterministic" | "grounded" | "model" = "deterministic";
  let nextContinuation: SurgeConversationState = continuation || emptySurgeConversationState();
  let officialCitations: SurgeOfficialWebCitation[] = [];
  if (!requiresDeterministicSafety && !requiresDeterministicDocumentAnswer
    && !requiresDeterministicHeatingDefault && !requiresDeterministicServiceAnswer && !protectedAnswer) {
    const modelRequest: SurgeModelRequest = {
      message,
      audience,
      pageContext,
      asOf: now,
      recentTurns: modelRecentTurns,
      continuation,
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
    const referenceAnswer = groundedAnswer || deterministicAnswer;
    const officialWebSearch = officialWebSearchPlanFor(
      message,
      audience,
      planContext,
      referenceAnswer,
    );
    const deliverGroundedDirectly = groundedAnswer
      ? groundedAnswerNeedsDirectDelivery(groundedAnswer) && !officialWebSearch
      : false;
    if (deliverGroundedDirectly && groundedAnswer) {
      answer = groundedAnswer;
      answerSource = "grounded";
    }
    if (!deliverGroundedDirectly && dependencies.reserveModelCall) {
      const groundedModelRequest: SurgeModelRequest = {
        ...modelRequest,
        deterministicAnswer: referenceAnswer,
        officialWebSearch,
      };
      const estimatedMicroUsd = estimateSurgeModelReservationMicroUsd(groundedModelRequest);
      if (estimatedMicroUsd !== null) {
        let reservation: SurgeModelCallReservation = { allowed: false };
        try {
          reservation = await dependencies.reserveModelCall({
            requestId: requestId || (dependencies.randomUUID || (() => crypto.randomUUID()))(),
            estimatedMicroUsd,
          });
        } catch {
          reservation = { allowed: false };
        }
        if (reservation.allowed) {
          try {
            const generate = dependencies.generateAnswer || generateSurgeModelAnswer;
            const generated = await generate(groundedModelRequest).catch(() => null);
            const generatedOfficialCitations = officialWebSearch && generated
              ? validatedOfficialCitationsForReply(generated.officialCitations, officialWebSearch)
              : null;
            if (generated
              && (!officialWebSearch || generatedOfficialCitations)
              && generatedResultIsPolicySafe(generated, audience, message)
              && !isGenericNonAnswer(generated.answer, generated.presentation || null)) {
              answer = generated.answer;
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
      answer = officialSearchUnavailableAnswer(message, officialWebSearch);
      presentation = null;
      officialCitations = [];
    } else if (answerSource === "deterministic" && groundedAnswer) {
      answer = groundedAnswer;
      answerSource = "grounded";
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
  const reply = buildReply(
    safeAnswer,
    message,
    answerSource === "model" && safeAnswer.directAnswer === answer.directAnswer ? presentation : null,
    recentTurns,
    planContext,
    answerSource === "model" && safeAnswer.directAnswer === answer.directAnswer
      ? officialCitations
      : [],
    now,
    dependencies.randomUUID || (() => crypto.randomUUID()),
  );
  const safeContinuation = publicSafeContinuation(
    continuationAfterDeliveredReply(
      nextContinuation,
      message,
      reply,
      answerSource === "model",
      conversationIntent,
    ),
    audience,
  );
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
