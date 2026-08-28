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

export type SurgeTopicQuickReplySet = {
  followUpQuestion: string;
  quickReplies: SurgeQuickReply[];
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
    && (!presentation.followUpQuestion
      || presentation.quickReplies.length === 0
      || presentation.quickReplies.length >= 2);
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

export function surgeQuickReplySetForTopic(message: string): SurgeTopicQuickReplySet | null {
  const topic = clean(message, 1_200);
  if (/\b(?:three|3)[ -]?phase\b/i.test(topic)
    && /\b(?:single[ -]?phase|upgrad\w*|solar|battery|switchboard|mains?|supply|rewir\w*|electrician)\b/i.test(topic)) {
    const asksRewiring = /\b(?:rewir\w*|existing (?:lights?|power points?|circuits?|wiring))\b/i.test(topic);
    const asksValue = /\b(?:worth|necessary|need(?:ed)?|benefit|advantage)\b/i.test(topic);
    const asksQuote = /\b(?:quote|cost|price|expensive|how much|involved)\b/i.test(topic);
    const selectedBranches = [asksRewiring, asksValue, asksQuote].filter(Boolean).length;
    const quickReplies = [
      ...(!asksRewiring || selectedBranches !== 1 ? [{
        id: "three-phase-rewiring",
        label: "Does it need rewiring?",
        message: "Does upgrading to three-phase require rewiring the whole house?",
      }] : []),
      ...(!asksValue || selectedBranches !== 1 ? [{
        id: "three-phase-worth-it",
        label: "When is it worth it?",
        message: "When is a three-phase upgrade actually worth paying for?",
      }] : []),
      ...(!asksQuote || selectedBranches !== 1 ? [{
        id: "three-phase-quote",
        label: "What should the quote include?",
        message: "What should an electrician include in a three-phase upgrade quote?",
      }] : []),
    ];
    return {
      followUpQuestion: selectedBranches === 1
        ? "Would you like to check another part of the three-phase decision?"
        : "What would you like to check next about the three-phase upgrade?",
      quickReplies: uniqueQuickReplies(quickReplies),
    };
  }
  return null;
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
  if (/\b(?:sudden bill|winter use|summer use|all year)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "bill-jump", label: "Sudden jump", message: "The bill jumped suddenly" },
      { id: "winter", label: "High in winter", message: "Electricity use is highest in winter" },
      { id: "summer", label: "High in summer", message: "Electricity use is highest in summer" },
      { id: "all-year", label: "High all year", message: "Electricity use is high all year" },
    ]);
  }
  if (/\b(?:biggest concern|bothers you most|main problem)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "bills", label: "High bills", message: "High energy bills are the main problem" },
      { id: "cold", label: "Cold rooms", message: "Cold rooms are the main problem" },
      { id: "hot", label: "Hot rooms", message: "Hot rooms are the main problem" },
      { id: "condensation", label: "Condensation", message: "Condensation or damp is the main problem" },
    ]);
  }
  if (/\b(?:export|spare solar)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "export-plenty", label: "Quite a lot", message: "I export quite a lot of solar most days" },
      { id: "export-little", label: "A little", message: "I only export a little solar" },
      { id: "export-none", label: "None", message: "I do not export solar" },
      { id: "export-unknown", label: "Not sure", message: "I am not sure how much solar I export" },
    ]);
  }
  if (/\b(?:draughty|cold windows?|both)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "draughts", label: "Draughty", message: "The room feels draughty" },
      { id: "cold-windows", label: "Cold windows", message: "The windows feel very cold" },
      { id: "both", label: "Both", message: "It is draughty and the windows feel cold" },
      { id: "not-sure", label: "Not sure", message: "I am not sure which it is" },
    ]);
  }
  if (/\bwhat type of gas heater\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "ducted-gas", label: "Ducted gas", message: "I have ducted gas heating" },
      { id: "wall-heater", label: "Wall heater", message: "I have a gas wall heater" },
      { id: "portable-gas", label: "Portable heater", message: "I use a portable gas heater" },
      { id: "not-sure", label: "Not sure", message: "I am not sure what type it is" },
    ]);
  }
  if (/\b(?:bedroom|bathroom|kitchen|several rooms)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "bedroom", label: "Bedroom", message: "It is mainly in the bedroom" },
      { id: "bathroom", label: "Bathroom", message: "It is mainly in the bathroom" },
      { id: "kitchen", label: "Kitchen", message: "It is mainly in the kitchen" },
      { id: "several", label: "Several rooms", message: "It happens in several rooms" },
    ]);
  }
  if (/\brenting the whole home or one room\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "whole-home", label: "Whole home", message: "I rent the whole home" },
      { id: "one-room", label: "One room", message: "I rent one room" },
      { id: "shared", label: "Shared rental", message: "It is a shared rental" },
    ]);
  }
  if (/\bhottest in the morning, afternoon, or all day\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "morning", label: "Morning", message: "The room is hottest in the morning" },
      { id: "afternoon", label: "Afternoon", message: "The room is hottest in the afternoon" },
      { id: "all-day", label: "All day", message: "The room stays hot all day" },
      { id: "not-sure", label: "Not sure", message: "I am not sure when it heats up" },
    ]);
  }
  if (/^(?:do|does|did|is|are|was|were|have|has|can|could|would|will|should)\b/i.test(cleanQuestion)) {
    return uniqueQuickReplies([
      { id: "yes", label: "Yes", message: "Yes" },
      { id: "no", label: "No", message: "No" },
      { id: "not-sure", label: "Not sure", message: "I am not sure" },
    ]);
  }
  return [];
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

export function deriveSurgeAnswerPresentation(
  answer: EnergyAssistantAnswer,
  message: string,
): SurgeAnswerPresentation {
  const directAnswer = toSurgePlainLanguage(answer.directAnswer, 2_400);
  const steps = answer.practicalSteps
    .map((step) => toSurgePlainLanguage(step, 360))
    .filter(Boolean)
    .slice(0, 3);
  if (!steps.length && answer.nextAction) steps.push(toSurgePlainLanguage(answer.nextAction, 360));
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
  const topicReplySet = surgeQuickReplySetForTopic(message);
  const followUpQuestion = topicReplySet?.followUpQuestion
    || toSurgePlainLanguage(answer.suggestedQuestions[0] || "", 220);
  return {
    answerType: answerTypeFor(message, answer),
    verdict,
    reason,
    steps,
    extraDetail,
    followUpQuestion,
    quickReplies: topicReplySet?.quickReplies || surgeQuickRepliesForQuestion(followUpQuestion),
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
