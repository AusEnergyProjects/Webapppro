import {
  ENERGY_ASSISTANT_AUDIENCES,
  type EnergyAssistantAudience,
} from "../data/energy-assistant-knowledge.ts";
import {
  composeEnergyAssistantAnswer,
  type EnergyAssistantAnswer,
  type EnergyAssistantCitation,
} from "./energy-assistant.ts";

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
  practicalSteps: string[];
  nextAction: string;
  createdAt: string;
  status: "answered" | "needs_context" | "source_review_required";
  citations: EnergyAssistantCitation[];
  assumptions: string[];
  confidence: "high" | "medium" | "low";
  suggestedQuestions: string[];
  toolActions: Array<{ id: string; label: string; href: string }>;
  sourceBoundary: string;
};

type ServerDependencies = {
  now?: () => Date;
  randomUUID?: () => string;
  composeAnswer?: typeof composeEnergyAssistantAnswer;
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
  const suggestionLimit = answer.directAnswer.includes("AEA Energy Guide only covers") ? 3 : 1;
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

function buildReply(
  answerInput: EnergyAssistantAnswer,
  now: Date,
  randomUUID: () => string,
): EnergyAssistantReply {
  const answer = boundedAnswer(answerInput);
  const reply: EnergyAssistantReply = {
    id: randomUUID().toLowerCase(),
    role: "assistant",
    content: [
      answer.directAnswer,
      answer.practicalSteps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      `Next action: ${answer.nextAction}`,
    ].filter(Boolean).join("\n\n"),
    directAnswer: answer.directAnswer,
    practicalSteps: answer.practicalSteps,
    nextAction: answer.nextAction,
    createdAt: now.toISOString(),
    status: answer.status,
    citations: answer.citations,
    assumptions: answer.assumptions,
    confidence: answer.confidence,
    suggestedQuestions: answer.suggestedQuestions,
    toolActions: answer.toolActions,
    sourceBoundary: answer.sourceBoundary,
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
  const priorUserMessages = recentTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content);
  const now = dateFrom(dependencies);
  const compose = dependencies.composeAnswer || composeEnergyAssistantAnswer;
  const answer = compose(message, { audience, pageContext, asOf: now, priorUserMessages });
  const reply = buildReply(
    answer,
    now,
    dependencies.randomUUID || (() => crypto.randomUUID()),
  );
  const response = {
    ok: true,
    ...(requestId ? { requestId } : {}),
    reply,
  };
  if (new TextEncoder().encode(JSON.stringify(response)).byteLength > ENERGY_ASSISTANT_MAX_RESPONSE_BYTES) {
    throw new EnergyAssistantServerError(
      503,
      "ASSISTANT_RESPONSE_LIMIT",
      "The energy guide could not produce a bounded response. Please narrow the question and retry.",
    );
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
