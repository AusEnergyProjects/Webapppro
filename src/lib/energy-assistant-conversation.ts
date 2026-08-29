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
const CONTEXT_REFERENCE_PATTERN = /\b(?:it|its|this|that|these|those|they|them|one|ones|same|other|another|former|latter|above|previous|earlier|instead|more expensive|cheaper|dearer|bigger|smaller|better|worse|the pro|the select|the (?:battery|quote|system|unit|model|option|plan|tariff|charger|heater|windows?|room|installer|product|solar panels?|panels?|inverter|blinds?|curtains?))\b/i;
const EXPLICIT_TOPIC_REFERENCE_PATTERN = /\b(?:this|that|these|those|same|other|another|former|latter|previous|the)\s+(?:battery|quote|system|unit|model|option|plan|tariff|charger|heater|windows?|room|installer|product|solar panels?|panels?|inverter|blinds?|curtains?)\b/i;
const NAMED_TOPIC_ANAPHORA_PATTERN = /\b(?:it|its|this|that|these|those|they|them|same|former|latter|previous)\b/i;
const ELLIPTICAL_FOLLOW_UP_PATTERN = /^(?:and|but|so|also|okay|ok|right|yes|no|maybe|unsure|not sure|why|how|what about|how about|does that|is that|is it|would that|should i do that|show me (?:the )?(?:practical )?next step)\b|^(?:could|would|can)\b[^.!?\n]{0,90}\b(?:help|work|matter)(?:\s+(?:too|as well))?\s*\??$/i;
const QUESTION_OPENING_PATTERN = /^(?:is|are|am|can|could|should|would|will|do|does|did|what|which|why|how|where|when|who)\b|\?\s*$/i;
const CLEAR_NEW_REQUEST_PATTERN = /^(?:please\s+)?(?:tell|show|explain|help|give|compare|check|review|calculate|work out|find)\b|^(?:let['’]?s|lets)\s+(?:talk|switch)|^(?:i['’]?d|i would)\s+like\s+to\s+(?:ask|talk|know)\b/i;

function directlyAnswersPendingQuestion(message: string, pendingQuestion: string) {
  if (/\bwhich rooms?\b|\broom\b[^?]{0,45}\b(?:hardest|coldest|hottest|comfortable|comfort)\b/i.test(pendingQuestion)) {
    return /\b(?:bedrooms?|lounge|living room|kitchen|bathrooms?|dining room|study|home office|all rooms?|whole house|everywhere|none)\b/i.test(message);
  }
  if (/\bhow many people\b|\bhousehold size\b/i.test(pendingQuestion)) {
    return /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:people|persons?|adults?|children|occupants?)\b/i.test(message);
  }
  if (/\bwhen\b[^?]{0,45}\b(?:use|electricity|power)\b|\btime of day\b/i.test(pendingQuestion)) {
    return /\b(?:morning|afternoon|evening|night|overnight|daytime|after sunset|weekdays?|weekends?)\b/i.test(message);
  }
  if (/\bwindows?\b[^?]{0,45}\b(?:cold|draught|draft|wind)\b/i.test(pendingQuestion)) {
    return /\b(?:yes|yeah|yep|no|nope|freezing|cold|warm|draughty|drafty|still nights?|when there is no wind)\b/i.test(message);
  }
  if (/\b(?:do you|already)\b[^?]{0,40}\bsolar\b/i.test(pendingQuestion)) {
    return /\b(?:yes|yeah|yep|no|nope|have solar|do not have solar|don['’]?t have solar)\b/i.test(message);
  }
  if (/\bpostcode\b/i.test(pendingQuestion)) return /\b\d{4}\b/.test(message);
  if (/\b(?:own|owner|rent|renter|tenant)\b/i.test(pendingQuestion)) {
    return /\b(?:own|owner|homeowner|rent|renter|tenant)\b/i.test(message);
  }
  if (/\bwhat heating\b|\bhow (?:do|are) you heat\b/i.test(pendingQuestion)) {
    return /\b(?:gas|ducted|reverse[- ]?cycle|air ?con(?:ditioner)?|split system|wood heater|electric heater)\b/i.test(message);
  }
  return false;
}

export function surgeConversationTopicFor(message: string) {
  const topicRules: ReadonlyArray<readonly [string, RegExp]> = [
    ["heat_pump_hot_water", /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water|water heater)\b/i],
    ["battery_vpp", /\b(?:home )?batter(?:y|ies)|\bVPP\b|energy storage/i],
    ["glazing_shading", /\b(?:windows?|glazing|glass|blinds?|curtains?|shading)\b/i],
    ["draughts_ventilation", /\b(?:draughts?|drafts?|air leaks?|ventilation|exhaust fan)\b/i],
    ["comfort_fabric", /\b(?:condensation|mould|mold|humidity|comfort)\b/i],
    ["insulation", /\b(?:insulation|batts?)\b/i],
    ["rcac", /\b(?:air ?con(?:ditioner)?|reverse[- ]?cycle|split system|ducted heating|gas heater)\b/i],
    ["induction", /\b(?:induction|cooktop|electric cooking)\b/i],
    ["ev_charging", /\b(?:EV|electric vehicle|car charger|home charging)\b/i],
    ["bills_tariffs", /\b(?:electricity bill|power bill|tariff|energy plan|retailer|feed[- ]?in)\b/i],
    ["rebates_certificates", /\b(?:rebate|STCs?|VEECs?|ESCs?|PRCs?|certificate discount)\b/i],
    ["renters_strata", /\b(?:renter|tenant|strata|owners corporation)\b/i],
    ["solar", /\b(?:solar|PV|panels?|inverter)\b/i],
  ];
  return topicRules.find(([, pattern]) => pattern.test(message))?.[0] || "";
}

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
  const namedTopic = surgeConversationTopicFor(clean);
  const anaphoraText = clean.replace(/\bworth\s+it\b/gi, "worth");
  const namedTopicUsesPriorContext = !/\binstead\b/i.test(clean)
    && (EXPLICIT_TOPIC_REFERENCE_PATTERN.test(clean)
      || NAMED_TOPIC_ANAPHORA_PATTERN.test(anaphoraText));
  const ellipticalFollowUp = !/\binstead\b/i.test(clean)
    && ELLIPTICAL_FOLLOW_UP_PATTERN.test(clean);
  return !TOPIC_CHANGE_PATTERN.test(clean)
    && (!namedTopic || namedTopicUsesPriorContext || ellipticalFollowUp)
    && wordCount <= 24
    && (CONTEXT_REFERENCE_PATTERN.test(clean) || ellipticalFollowUp);
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
  const currentTopic = surgeConversationTopicFor(clean);
  const pendingTopic = surgeConversationTopicFor(continuation?.pendingQuestion || "");
  const asksQuestion = QUESTION_OPENING_PATTERN.test(clean);
  const startsNewRequest = CLEAR_NEW_REQUEST_PATTERN.test(clean);
  if (currentTopic
    && continuation?.activeTopic
    && continuation.activeTopic !== "general"
    && currentTopic !== continuation.activeTopic
    && startsNewRequest) {
    return "topic_change";
  }
  if (
    continuation?.pendingQuestion
    && clean.split(/\s+/).filter(Boolean).length <= 24
  ) {
    const answersPendingQuestion = directlyAnswersPendingQuestion(clean, continuation.pendingQuestion);
    const tentativeShortAnswer = /\?\s*$/u.test(clean)
      && clean.split(/\s+/).filter(Boolean).length <= 6
      && !/^(?:is|are|am|can|could|should|would|will|do|does|did|what|which|why|how|where|when|who)\b/i.test(clean)
      && !startsNewRequest;
    if (tentativeShortAnswer) {
      if (currentTopic && currentTopic !== pendingTopic && !answersPendingQuestion) return "topic_change";
      return "answer_to_follow_up";
    }
    if (currentTopic && currentTopic !== pendingTopic && !answersPendingQuestion) return "topic_change";
    if (!asksQuestion && !startsNewRequest) return "answer_to_follow_up";
  }
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
