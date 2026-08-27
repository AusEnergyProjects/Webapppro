import {
  ENERGY_ASSISTANT_AUDIENCES,
  ENERGY_ASSISTANT_KNOWLEDGE,
  ENERGY_ASSISTANT_TOPICS,
  type EnergyAssistantAudience,
} from "../data/energy-assistant-knowledge.ts";
import {
  containsSurgeInternalPlatformName,
  containsSurgeNamedReference,
  composeEnergyAssistantAnswer,
  isEnergyDocumentQuoteReviewRequest,
  isSurgeElectricSaulQuestion,
  isSurgeImplementationIdentityQuestion,
  isSurgeNamedReferenceQuestion,
  sanitizeSurgePublicText,
  sanitizeSurgeReferenceText,
  SURGE_ELECTRIC_SAUL_COMPARISON_ANSWER,
  SURGE_PUBLIC_IDENTITY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_ANSWER,
  SURGE_PUBLIC_REFERENCE_BOUNDARY_FOLLOW_UP,
  surgeOutputViolatesPublicPolicy,
  type EnergyAssistantAnswer,
} from "./energy-assistant.ts";
import {
  emptySurgeConversationState,
  parseSurgeConversationState,
  type SurgeConversationState,
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
import { composeSurgePlanPriorityAnswer } from "./energy-assistant-plan-priority.ts";
import {
  estimateSurgeModelReservationMicroUsd,
  generateSurgeModelAnswer,
  type SurgeModelRequest,
  type SurgeModelResult,
} from "./energy-assistant-model.ts";

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
  followUpQuestion: string;
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
) {
  const continuationText = JSON.stringify(generated.continuation);
  const generatedText = `${policyText(generated.answer)}\n${continuationText}`;
  if (
    surgeOutputViolatesPublicPolicy(generatedText)
    || containsSurgeNamedReference(generatedText)
  ) {
    return false;
  }
  return audience === "trade" || (
    !containsSurgeNamedReference(continuationText)
    && !containsSurgeInternalPlatformName(continuationText)
  );
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
  now: Date,
  randomUUID: () => string,
): EnergyAssistantReply {
  const answer = boundedAnswer(answerInput);
  const followUpQuestion = limitedText(answer.suggestedQuestions[0] || "", 220);
  const reply: EnergyAssistantReply = {
    id: randomUUID().toLowerCase(),
    role: "assistant",
    content: [
      answer.directAnswer,
      followUpQuestion,
    ].filter(Boolean).join("\n\n"),
    directAnswer: answer.directAnswer,
    createdAt: now.toISOString(),
    status: answer.status,
    confidence: answer.confidence,
    followUpQuestion,
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

const SAFETY_SOURCE_TOPICS = new Map<string, string>(
  ENERGY_ASSISTANT_KNOWLEDGE.map((source) => [source.id, source.topic]),
);

function needsDeterministicSafetyAnswer(message: string, answer: EnergyAssistantAnswer) {
  if (answer.status === "source_review_required") return true;
  if (answer.citations.some((citation) => SAFETY_SOURCE_TOPICS.get(citation.id) === "safety_consumer_rights")) {
    return true;
  }
  return /\b(?:asbestos|vermiculite|smoke|spark|arcing|burning|hissing|swollen|battery fire|gas smell|carbon monoxide|dizzy|woozy|light-headed|live wire|electrical cable|refrigerant|wet roof|main switch|switchboard)\b/i.test(message);
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
  const planContext = audience === "trade" ? null : planContextFrom(requestBody.planContext);
  const priorUserMessages = recentTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  if (planContext) priorUserMessages.unshift(surgePlanContextSummary(planContext));
  const now = dateFrom(dependencies);
  const compose = dependencies.composeAnswer || composeEnergyAssistantAnswer;
  const composedAnswer = compose(message, { audience, pageContext, asOf: now, priorUserMessages });
  const requiresDeterministicSafety = needsDeterministicSafetyAnswer(message, composedAnswer);
  const requiresDeterministicDocumentAnswer = isEnergyDocumentQuoteReviewRequest(message, priorUserMessages);
  const protectedAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer
    ? null
    : publicPolicyAnswer(message);
  const planPriorityAnswer = requiresDeterministicSafety || requiresDeterministicDocumentAnswer || protectedAnswer
    ? null
    : composeSurgePlanPriorityAnswer(message, planContext, recentTurns);
  const deterministicAnswer = protectedAnswer || planPriorityAnswer || composedAnswer;
  let answer = deterministicAnswer;
  let answerSource: "deterministic" | "grounded" | "model" = "deterministic";
  let nextContinuation: SurgeConversationState = continuation || emptySurgeConversationState();
  if (!requiresDeterministicSafety && !requiresDeterministicDocumentAnswer && !protectedAnswer && !planPriorityAnswer) {
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
    const groundedAnswer = dependencies.resolveGroundedAnswer
      ? await dependencies.resolveGroundedAnswer(modelRequest).catch(() => null)
      : null;
    if (groundedAnswer) {
      answer = groundedAnswer;
      answerSource = "grounded";
    }
    const estimatedMicroUsd = estimateSurgeModelReservationMicroUsd(modelRequest);
    if (!groundedAnswer && estimatedMicroUsd !== null && dependencies.reserveModelCall) {
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
          const generated = await generate(modelRequest).catch(() => null);
          if (generated && generatedResultIsPolicySafe(generated, audience)) {
            answer = generated.answer;
            nextContinuation = generated.continuation;
            answerSource = "model";
          }
        } finally {
          await reservation.release().catch(() => undefined);
        }
      }
    }
  }
  const reply = buildReply(
    audience === "trade"
      ? answer
      : enforceCustomerPolicy(answer, deterministicAnswer, protectedAnswer),
    now,
    dependencies.randomUUID || (() => crypto.randomUUID()),
  );
  const safeContinuation = publicSafeContinuation(nextContinuation, audience);
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
