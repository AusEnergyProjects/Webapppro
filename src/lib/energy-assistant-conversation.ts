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
