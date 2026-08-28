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
  /\bcommissioning scope\b/gi,
  /\bcommissioning\b/gi,
  /\blocal design temperatures\b/gi,
  /\bretained (?:heating|cooling) capacity\b/gi,
  /\bthermal performance\b/gi,
  /\bdelivered heat\b/gi,
  /\bportable resistance heaters?\b/gi,
  /\bresistance heating\b/gi,
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
  [/\bcommissioning scope\b/gi, "final setup and safety checks"],
  [/\bcommissioning\b/gi, "final setup and checks"],
  [/\blocal design temperatures\b/gi, "the hottest and coldest local weather"],
  [/\bretained heating and cooling capacity\b/gi, "heating and cooling output in extreme weather"],
  [/\bretained heating capacity\b/gi, "heating output in very cold weather"],
  [/\bretained cooling capacity\b/gi, "cooling output in very hot weather"],
  [/\bthermal performance\b/gi, "how well the home holds a comfortable temperature"],
  [/\bdelivered heat\b/gi, "heat supplied to the room"],
  [/\bportable resistance heaters?\b/gi, "plug-in electric heaters"],
  [/\bresistance heating\b/gi, "plug-in electric heating"],
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
    && presentation.quickReplies.length === 0;
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

function comparable(value: string) {
  return value.toLowerCase().replace(/^\s*\d+[.)]\s*/u, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function repeatsStep(value: string, steps: readonly string[]) {
  const candidate = comparable(value);
  if (!candidate) return true;
  return steps.some((step) => {
    const cleanStep = comparable(step);
    return cleanStep && (candidate.includes(cleanStep) || cleanStep.includes(candidate));
  });
}

function wantsOrderedSteps(message: string) {
  return /\b(?:where (?:do|should|can) i start|what (?:should i do|do i do|comes|happens) first|how (?:do|can|should) i|steps?|checklist|walk me through|give me a plan|what to check)\b/i.test(message);
}

export function deriveSurgeAnswerPresentation(
  answer: EnergyAssistantAnswer,
  message: string,
): SurgeAnswerPresentation {
  const directAnswer = toSurgePlainLanguage(answer.directAnswer, 2_400);
  const comparableDirectAnswer = comparable(directAnswer);
  const steps = answer.practicalSteps
    .map((step) => toSurgePlainLanguage(step, 360))
    .filter(Boolean)
    .filter((step) => {
      const comparableStep = comparable(step);
      return comparableStep.length < 24
        || (!comparableDirectAnswer.includes(comparableStep)
          && !comparableStep.includes(comparableDirectAnswer));
    })
    .slice(0, 3);
  if (!steps.length && answer.nextAction && wantsOrderedSteps(message)) {
    steps.push(toSurgePlainLanguage(answer.nextAction, 360));
  }
  const directParagraphs = directAnswer.split(/\n{2,}|\n(?=\s*\d+[.)]\s+)/u).map((part) => part.trim()).filter(Boolean);
  const lead = directParagraphs[0] || directAnswer;
  const leadSentences = sentences(lead);
  const verdict = clean(leadSentences[0] || directAnswer, 360);
  const reason = clean(leadSentences.slice(1, 3).join(" "), 700);
  const remainingLead = leadSentences.slice(3).join(" ");
  const truncatedVerdictRemainder = leadSentences.length === 1 && lead.length > verdict.length
    ? lead.slice(verdict.length).trim()
    : "";
  const extraParts = [truncatedVerdictRemainder, remainingLead, ...directParagraphs.slice(1)]
    .flatMap((part) => part.split(/\n+/u))
    .map((part) => part.replace(/^\s*\d+[.)]\s*/u, "").trim())
    .filter((part) => part && !repeatsStep(part, steps));
  const extraDetail = clean(extraParts.join(" "), 1_200);
  const followUpQuestion = toSurgePlainLanguage(answer.suggestedQuestions[0] || "", 220);
  return {
    answerType: answerTypeFor(message, answer),
    verdict,
    reason,
    steps,
    extraDetail,
    followUpQuestion,
    quickReplies: [],
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
    quickReplies: [],
  };
}
