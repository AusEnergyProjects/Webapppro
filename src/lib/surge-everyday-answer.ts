import type { EnergyAssistantAnswer } from "./energy-assistant.ts";

export const SURGE_ANSWER_TYPES = [
  "decision",
  "starting_plan",
  "explanation",
  "comparison",
  "safety",
  "clarification",
  "general",
] as const;

export type SurgeAnswerType = (typeof SURGE_ANSWER_TYPES)[number];

export type SurgeQuickReply = {
  id: string;
  label: string;
  message: string;
};

export type SurgeAnswerPresentation = {
  answerType: SurgeAnswerType;
  verdict: string;
  reason: string;
  steps: string[];
  extraDetail: string;
  followUpQuestion: string;
  quickReplies: SurgeQuickReply[];
};

export type SurgePlainLanguageMetrics = {
  wordCount: number;
  averageSentenceWords: number;
  longestSentenceWords: number;
  jargonCount: number;
};

const JARGON_PATTERNS = [
  /\bbuilding fabric\b/gi,
  /\bconductive heat flow\b/gi,
  /\bdiagnostic stage\b/gi,
  /\bend uses?\b/gi,
  /\binterval data\b/gi,
  /\bload profile\b/gi,
  /\bmeasured surplus\b/gi,
  /\bsite-sized\b/gi,
  /\bstaged whole-home diagnosis\b/gi,
  /\btariff shifting\b/gi,
  /\bthermal envelope\b/gi,
] as const;

const PLAIN_LANGUAGE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bstaged whole-home diagnosis\b/gi, "step-by-step check of the whole home"],
  [/\bbuilding fabric(?: check)?\b/gi, "check of the walls, ceiling, floors, doors and windows"],
  [/\bconductive heat flow\b/gi, "heat moving through the roof, walls or windows"],
  [/\bdiagnostic stage\b/gi, "first checks"],
  [/\bend uses?\b/gi, "appliances or systems"],
  [/\binterval data\b/gi, "half-hourly electricity use"],
  [/\bload profile\b/gi, "pattern of energy use"],
  [/\bmeasured surplus\b/gi, "measured spare solar"],
  [/\bsite-sized\b/gi, "sized for the home"],
  [/\btariff shifting\b/gi, "using energy at cheaper times"],
  [/\bthermal envelope\b/gi, "parts of the home that separate inside from outside"],
];

function clean(value: string, maximum = 1_200) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s*[\u2013\u2014]\s*/gu, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum)
    .trim();
}

export function toSurgePlainLanguage(value: string, maximum = 1_200) {
  return PLAIN_LANGUAGE_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    clean(value, maximum),
  );
}

function words(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function sentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function surgePlainLanguageMetrics(value: string): SurgePlainLanguageMetrics {
  const cleanValue = clean(value, 12_000);
  const sentenceWordCounts = sentences(cleanValue).map((sentence) => words(sentence).length);
  const wordCount = words(cleanValue).length;
  const jargonCount = JARGON_PATTERNS.reduce(
    (total, pattern) => total + (cleanValue.match(pattern)?.length || 0),
    0,
  );
  return {
    wordCount,
    averageSentenceWords: sentenceWordCounts.length
      ? Number((sentenceWordCounts.reduce((total, count) => total + count, 0) / sentenceWordCounts.length).toFixed(1))
      : 0,
    longestSentenceWords: Math.max(0, ...sentenceWordCounts),
    jargonCount,
  };
}

export function surgePresentationText(
  presentation: SurgeAnswerPresentation,
  includeFollowUp = false,
) {
  return [
    presentation.verdict,
    presentation.reason,
    ...presentation.steps,
    presentation.extraDetail,
    includeFollowUp ? presentation.followUpQuestion : "",
  ].filter(Boolean).join("\n\n");
}

export function surgePresentationPassesEverydayLanguage(
  presentation: SurgeAnswerPresentation,
) {
  const visibleText = [
    presentation.verdict,
    presentation.reason,
    ...presentation.steps,
  ].filter(Boolean).join(" ");
  const completeText = surgePresentationText(presentation, true);
  const visibleMetrics = surgePlainLanguageMetrics(visibleText);
  const completeMetrics = surgePlainLanguageMetrics(completeText);
  return Boolean(presentation.verdict)
    && words(presentation.verdict).length <= 28
    && visibleMetrics.wordCount <= 120
    && completeMetrics.wordCount <= 180
    && completeMetrics.averageSentenceWords <= 24
    && completeMetrics.longestSentenceWords <= 36
    && completeMetrics.jargonCount === 0
    && presentation.steps.length <= 3
    && presentation.quickReplies.length <= 4
    && (!presentation.followUpQuestion || presentation.quickReplies.length >= 2);
}

function answerTypeFor(message: string, answer: EnergyAssistantAnswer): SurgeAnswerType {
  if (answer.status === "source_review_required" || /\b(?:smoke|spark|arcing|burning|gas smell|asbestos|live wire|battery fire)\b/i.test(message)) {
    return "safety";
  }
  if (/\b(?:where|how) (?:do|should|can) i start\b|\bwhat first\b/i.test(message)) return "starting_plan";
  if (/\b(?:yes or no|is it|is this|worth it|good quote|make sense|should i|can i)\b/i.test(message)) return "decision";
  if (/\b(?:difference|compare|versus|\bvs\b|better than)\b/i.test(message)) return "comparison";
  if (/\b(?:what do you mean|simpler|explain that|why did|you asked|already told)\b/i.test(message)) return "clarification";
  if (/\b(?:why|how|what is|what are|explain)\b/i.test(message)) return "explanation";
  return "general";
}

function uniqueQuickReplies(replies: SurgeQuickReply[]) {
  const labels = new Set<string>();
  const messages = new Set<string>();
  return replies.filter((reply) => {
    const label = clean(reply.label, 42);
    const message = clean(reply.message, 160);
    const labelKey = label.toLowerCase();
    const messageKey = message.toLowerCase();
    if (!label || !message || labels.has(labelKey) || messages.has(messageKey)) return false;
    labels.add(labelKey);
    messages.add(messageKey);
    return true;
  }).slice(0, 4);
}

export function surgeQuickRepliesForQuestion(question: string): SurgeQuickReply[] {
  const cleanQuestion = clean(question, 220);
  if (!cleanQuestion) return [];
  if (/\bwhich (?:room|area)|what (?:room|area)|rooms? (?:is|are|feel|gets?)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "lounge", label: "Lounge", message: "Mostly the lounge" },
      { id: "bedroom", label: "Bedroom", message: "Mostly the bedroom" },
      { id: "both", label: "Both", message: "The lounge and bedroom are both affected" },
      { id: "another-room", label: "Another room", message: "It is another room" },
    ]);
  }
  if (/\b(?:quote|model number|exact model|invoice)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "have-details", label: "I have the details", message: "I have the quote or exact model details" },
      { id: "partial-details", label: "Only some details", message: "I only have part of the quote or model details" },
      { id: "not-sure", label: "Not sure", message: "I am not sure where to find that" },
    ]);
  }
  if (/^(?:do|does|did|is|are|was|were|have|has|can|could|would|will|should)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "yes", label: "Yes", message: "Yes" },
      { id: "no", label: "No", message: "No" },
      { id: "not-sure", label: "Not sure", message: "I am not sure" },
    ]);
  }
  return uniqueQuickReplies([
    { id: "tell-me-how", label: "Show me how", message: "Show me the practical next step" },
    { id: "compare-options", label: "Compare options", message: "Compare the sensible options for me" },
    { id: "not-sure", label: "Not sure", message: "I am not sure, help me narrow it down" },
  ]);
}

function removeLeadingText(value: string, leading: string) {
  const cleanValue = value.trim();
  const cleanLeading = leading.trim();
  if (!cleanLeading || !cleanValue.toLowerCase().startsWith(cleanLeading.toLowerCase())) return cleanValue;
  return cleanValue.slice(cleanLeading.length).trim();
}

export function deriveSurgeAnswerPresentation(
  answer: EnergyAssistantAnswer,
  message: string,
): SurgeAnswerPresentation {
  const directAnswer = toSurgePlainLanguage(answer.directAnswer, 2_400);
  const answerSentences = sentences(directAnswer);
  const verdict = clean(answerSentences[0] || directAnswer, 360);
  const remainder = removeLeadingText(directAnswer, verdict);
  const reasonSentences = sentences(remainder);
  const reason = clean(reasonSentences.slice(0, 2).join(" "), 700);
  const extraDetail = clean(removeLeadingText(remainder, reason), 1_200);
  const steps = answer.practicalSteps
    .map((step) => toSurgePlainLanguage(step, 360))
    .filter(Boolean)
    .slice(0, 3);
  if (!steps.length && answer.nextAction) steps.push(toSurgePlainLanguage(answer.nextAction, 360));
  const followUpQuestion = toSurgePlainLanguage(answer.suggestedQuestions[0] || "", 220);
  return {
    answerType: answerTypeFor(message, answer),
    verdict,
    reason,
    steps,
    extraDetail,
    followUpQuestion,
    quickReplies: surgeQuickRepliesForQuestion(followUpQuestion),
  };
}

export function normalizeSurgeAnswerPresentation(
  presentation: SurgeAnswerPresentation,
): SurgeAnswerPresentation {
  const followUpQuestion = toSurgePlainLanguage(presentation.followUpQuestion, 220);
  return {
    answerType: SURGE_ANSWER_TYPES.includes(presentation.answerType)
      ? presentation.answerType
      : "general",
    verdict: toSurgePlainLanguage(presentation.verdict, 360),
    reason: toSurgePlainLanguage(presentation.reason, 700),
    steps: presentation.steps.map((step) => toSurgePlainLanguage(step, 360)).filter(Boolean).slice(0, 3),
    extraDetail: toSurgePlainLanguage(presentation.extraDetail, 1_200),
    followUpQuestion,
    quickReplies: followUpQuestion
      ? uniqueQuickReplies(presentation.quickReplies.map((reply) => ({
        id: clean(reply.id, 60),
        label: toSurgePlainLanguage(reply.label, 42),
        message: toSurgePlainLanguage(reply.message, 160),
      })))
      : [],
  };
}
