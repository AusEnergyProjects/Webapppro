export const SURGE_CONVERSATION_STATE_VERSION = 1 as const;
export const SURGE_MAX_FACTS = 16;

export type SurgeConversationFact = {
  key: string;
  value: string;
};

export type SurgeConversationState = {
  version: typeof SURGE_CONVERSATION_STATE_VERSION;
  activeTopic: string;
  goal: string;
  facts: SurgeConversationFact[];
  pendingQuestion: string;
  lastAnswerSummary: string;
};

export type SurgeConversationTurnIntent =
  | "new_question"
  | "contextual_follow_up"
  | "answer_to_follow_up"
  | "clarification"
  | "correction"
  | "topic_change"
  | "correction_and_topic_change";

const CLARIFICATION_PATTERN = /(?:^|\b)(?:huh|what do you mean|what does that mean|how so|why is that|i (?:do not|don't) understand|that (?:does not|doesn't) make sense|explain (?:that|it)|say that again|in (?:plain|simple) (?:english|words)|simpler)(?:\b|$)/i;
const CORRECTION_PATTERN = /(?:^|\b)(?:actually|correction|sorry,? (?:i|it|we)|i meant|that is wrong|that's wrong|not .{0,36}(?:but|,)|i (?:do not|don't) (?:own|rent|have|use)|i (?:rent|own) rather than)(?:\b|$)/i;
const TOPIC_CHANGE_PATTERN = /(?:(?:^|[.!?]\s*|,\s*)forget\b|\b(?:different question|new question|change (?:the )?(?:subject|topic)|switch (?:the )?(?:subject|topic)|moving on|instead,? (?:i|what|how|when|can)|anyway,? (?:i|what|how|when|can))\b)/i;
const CONTEXT_REFERENCE_PATTERN = /\b(?:it|its|this|that|these|those|they|them|one|ones|same|other|another|former|latter|above|previous|earlier|instead|more expensive|cheaper|dearer|bigger|smaller|better|worse|the pro|the select)\b/i;
const ELLIPTICAL_FOLLOW_UP_PATTERN = /^(?:and|but|so|also|okay|ok|right|yes|no|maybe|unsure|not sure|why|how|what about|how about|does that|is that|is it|would that|should i do that|show me (?:the )?(?:practical )?next step)\b/i;

export type SurgeConversationContextTurn = {
  role: "user" | "assistant";
  content: string;
};

export type SurgeReferenceResolution = {
  contextDependent: boolean;
  status: "self_contained" | "resolved_from_recent_context" | "needs_clarification";
  basis: "none" | "pending_question" | "recent_user_turns" | "conversation_state";
  anchorUserMessages: string[];
};

export function isSurgeContextDependentMessage(message: string) {
  const clean = message.trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  return !TOPIC_CHANGE_PATTERN.test(clean)
    && wordCount <= 24
    && (CONTEXT_REFERENCE_PATTERN.test(clean) || ELLIPTICAL_FOLLOW_UP_PATTERN.test(clean));
}

export function resolveSurgeConversationReference(
  message: string,
  priorTurns: readonly SurgeConversationContextTurn[],
  continuation: SurgeConversationState | null,
): SurgeReferenceResolution {
  if (!isSurgeContextDependentMessage(message)) {
    return { contextDependent: false, status: "self_contained", basis: "none", anchorUserMessages: [] };
  }
  const userMessages = priorTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  let topicStart = 0;
  for (let index = 0; index < userMessages.length; index += 1) {
    if (TOPIC_CHANGE_PATTERN.test(userMessages[index])) topicStart = index;
  }
  const anchorUserMessages = userMessages.slice(topicStart).slice(-3);
  if (continuation?.pendingQuestion) {
    return {
      contextDependent: true,
      status: "resolved_from_recent_context",
      basis: "pending_question",
      anchorUserMessages,
    };
  }
  if (anchorUserMessages.length) {
    return {
      contextDependent: true,
      status: "resolved_from_recent_context",
      basis: "recent_user_turns",
      anchorUserMessages,
    };
  }
  if (continuation && (
    continuation.goal
    || continuation.lastAnswerSummary
    || continuation.activeTopic !== "general"
  )) {
    return {
      contextDependent: true,
      status: "resolved_from_recent_context",
      basis: "conversation_state",
      anchorUserMessages: [],
    };
  }
  return {
    contextDependent: true,
    status: "needs_clarification",
    basis: "none",
    anchorUserMessages: [],
  };
}

export function classifySurgeConversationTurn(
  message: string,
  continuation: SurgeConversationState | null,
  priorTurns: readonly SurgeConversationContextTurn[] = [],
): SurgeConversationTurnIntent {
  const clean = message.trim();
  const clarification = CLARIFICATION_PATTERN.test(clean);
  const correction = CORRECTION_PATTERN.test(clean);
  const topicChange = TOPIC_CHANGE_PATTERN.test(clean);

  if (correction && topicChange) return "correction_and_topic_change";
  if (clarification) return "clarification";
  if (correction) return "correction";
  if (topicChange) return "topic_change";
  if (
    continuation?.pendingQuestion
    && clean.split(/\s+/).filter(Boolean).length <= 24
  ) return "answer_to_follow_up";
  if (resolveSurgeConversationReference(message, priorTurns, continuation).status === "resolved_from_recent_context") {
    return "contextual_follow_up";
  }
  return "new_question";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (
    clean.length > maximum
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(clean)
  ) return null;
  return clean;
}

export function parseSurgeConversationState(value: unknown): SurgeConversationState | null {
  const source = record(value);
  if (!source || source.version !== SURGE_CONVERSATION_STATE_VERSION) return null;

  const activeTopic = boundedString(source.activeTopic, 48);
  const goal = boundedString(source.goal, 240);
  const pendingQuestion = boundedString(source.pendingQuestion, 220);
  const lastAnswerSummary = boundedString(source.lastAnswerSummary, 320);
  if (
    activeTopic === null
    || !/^[a-z][a-z0-9_]*$/.test(activeTopic || "general")
    || goal === null
    || pendingQuestion === null
    || lastAnswerSummary === null
    || !Array.isArray(source.facts)
    || source.facts.length > SURGE_MAX_FACTS
  ) return null;

  const facts: SurgeConversationFact[] = [];
  const indexes = new Map<string, number>();
  for (const item of source.facts) {
    const fact = record(item);
    const key = boundedString(fact?.key, 48);
    const factValue = boundedString(fact?.value, 240);
    if (!key || factValue === null || !/^[a-z][a-z0-9_]*$/.test(key)) return null;
    const priorIndex = indexes.get(key);
    if (priorIndex === undefined) {
      indexes.set(key, facts.length);
      facts.push({ key, value: factValue });
    } else {
      facts[priorIndex] = { key, value: factValue };
    }
  }

  return {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: activeTopic || "general",
    goal,
    facts,
    pendingQuestion,
    lastAnswerSummary,
  };
}

export function emptySurgeConversationState(): SurgeConversationState {
  return {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: "general",
    goal: "",
    facts: [],
    pendingQuestion: "",
    lastAnswerSummary: "",
  };
}
