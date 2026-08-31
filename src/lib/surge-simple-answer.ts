import {
  isThreePhaseSupplyUpgradeQuestion,
  type EnergyAssistantAnswer,
} from "./energy-assistant.ts";
import type { SurgePlanContext } from "./energy-assistant-plan-context.ts";
import {
  isSurgeContextDependentMessage,
  surgeConversationTopicFor,
  SURGE_HOME_COMFORT_INTENT_PATTERN,
} from "./energy-assistant-conversation.ts";
import {
  surgeHasRecentResolvedMoistureConcern,
  surgePlanContextAfterRecentHomeFactChanges,
} from "./energy-assistant-plan-priority.ts";

type RecentTurn = {
  role: "user" | "assistant";
  content: string;
};

type SimpleAnswer = {
  directAnswer: string;
  practicalSteps: string[];
  suggestedQuestion?: string;
  confidence?: EnergyAssistantAnswer["confidence"];
};

const NUMBER_WORD_PATTERN = "one|two|three|four|five|six|seven|eight|nine|ten";
const COLD_HOME_SYMPTOM = SURGE_HOME_COMFORT_INTENT_PATTERN;
const DOOR_DRAUGHT_REPORT = /\b(?:draught|draft|breeze|cold air|air leak)\b[^.!?\n]{0,36}\b(?:under|around|through)\b[^.!?\n]{0,18}\b(?:(?:my|our|the)\s+)?(?:(?:front|back|external)\s+)?door\b|\b(?:(?:my|our|the)\s+)?(?:(?:front|back|external)\s+)?door\b[^.!?\n]{0,24}\b(?:is|feels?)\s+(?:very\s+)?(?:draughty|drafty)\b/i;
const DOOR_DRAUGHT_DENIAL = /\b(?:no|not|never|no longer|don['’]?t|do not|isn['’]?t|is not|wasn['’]?t|was not|can['’]?t|cannot)\b[^.!?\n]{0,45}\b(?:draught|draft|breeze|cold air|air leak)\b[^.!?\n]{0,45}\bdoor\b|\bdoor\b[^.!?\n]{0,35}\b(?:isn['’]?t|is not|wasn['’]?t|was not|no longer)\b[^.!?\n]{0,18}\b(?:draughty|drafty)|\b(?:draught|draft|breeze|cold air|air leak)\b[^.!?\n]{0,45}\bdoor\b[^.!?\n]{0,24}\b(?:gone|stopped|fixed|sealed)\b/i;
const DOOR_DRAUGHT_NON_ASSERTION = /\?\s*$|^\s*(?:could|would|can|might|may|is|are|was|were|do|does|did)\b|\b(?:wonder(?:ing)?\s+(?:if|whether)|asked?\s+(?:if|whether)|asks?\s+(?:if|whether)|might|maybe|perhaps|possibly)\b/i;
const NUMBER_WORD_VALUES: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function extractQuantityBeforeNoun(text: string, nouns: string) {
  return text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?|${NUMBER_WORD_PATTERN})\\s+(?:${nouns})\\b`, "i"))?.[1];
}

function userReportedDoorDraught(message: string, recentTurns: readonly RecentTurn[]) {
  const userMessages = [
    ...recentTurns.filter((turn) => turn.role === "user").map((turn) => turn.content),
    message,
  ];
  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    if (DOOR_DRAUGHT_DENIAL.test(userMessages[index])) return false;
    if (DOOR_DRAUGHT_REPORT.test(userMessages[index])
      && !DOOR_DRAUGHT_NON_ASSERTION.test(userMessages[index])) return true;
  }
  return false;
}

function extractYears(text: string) {
  return extractQuantityBeforeNoun(text, "years?");
}

function extractHouseholdSize(text: string) {
  const afterHousehold = text.match(new RegExp(`\\b(?:family|household)\\s+(?:of\\s+)?(\\d+|${NUMBER_WORD_PATTERN})\\b`, "i"))?.[1];
  return afterHousehold || extractQuantityBeforeNoun(text, "people|persons?");
}

function numericQuantity(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORD_VALUES[value.toLowerCase()] || null;
}

function extractSolarSize(text: string) {
  return text.match(/\b(\d+(?:\.\d+)?)\s*kW\s+(?:of\s+)?solar\b/i)?.[1]
    || text.match(/\bsolar(?:\s+system)?(?:\s+(?:is|of|at|with))?\s+(\d+(?:\.\d+)?)\s*kW\b/i)?.[1];
}

function extractTemperatureSetting(text: string) {
  return text.match(/\b(?:set(?:ting)?(?:\s+(?:to|at|on))?|at)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*C|degrees?\s*(?:C(?:elsius)?)?)\b/i)?.[1];
}

function extractClockTimes(text: string) {
  return [...text.matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/gi)]
    .map((match) => match[1].replace(/\./g, "").replace(/\s+/g, " "));
}

type MoneyMention = {
  value: string;
  index: number;
  end: number;
};

function moneyMentions(text: string): MoneyMention[] {
  return [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)].map((match) => ({
    value: match[1],
    index: match.index,
    end: match.index + match[0].length,
  }));
}

function isRecurringAmount(text: string, mention: MoneyMention) {
  const before = text.slice(Math.max(0, mention.index - 80), mention.index);
  const after = text.slice(mention.end, mention.end + 50);
  return /^\s*(?:\/|a|per|each)\s*(?:year|month|quarter|week|day)\b/i.test(after)
    || /\b(?:annual|yearly|monthly|quarterly|weekly|daily)\s+(?:(?:electricity|energy|gas|power)\s+)?bill\s*(?:is|was|costs?|of)?\s*$/i.test(before)
    || /^\s*(?:annual|yearly|monthly|quarterly|weekly|daily)\s+(?:(?:electricity|energy|gas|power)\s+)?bill\b/i.test(after);
}

function extractBatteryPurchasePrice(text: string) {
  const mention = moneyMentions(text).find((candidate) => {
    if (isRecurringAmount(text, candidate)) return false;
    const before = text.slice(Math.max(0, candidate.index - 90), candidate.index);
    const after = text.slice(candidate.end, candidate.end + 100);
    const batteryFollows = /^\s*(?:installed\s+)?(?:for\s+)?(?:an?\s+)?\d+(?:\.\d+)?\s*kWh\s+(?:home\s+)?battery\b/i.test(after);
    const localContext = `${before} ${after}`;
    const namedBatteryPrice = /\bbatter(?:y|ies)\b[^.!?\n]{0,55}\b(?:quote(?:d)?|price|costs?|installed|for|at)\b|\b(?:quote(?:d)?|price|costs?|installed)\b[^.!?\n]{0,55}\bbatter(?:y|ies)\b/i.test(localContext);
    return batteryFollows || namedBatteryPrice;
  });
  return mention?.value;
}

function extractFinancedProjectPrice(text: string) {
  const mention = moneyMentions(text).find((candidate) => {
    if (isRecurringAmount(text, candidate)) return false;
    const before = text.slice(Math.max(0, candidate.index - 150), candidate.index);
    return /\b(?:quote(?:d)?|cash price|total(?: installed)? price|installed (?:price|cost)|system (?:price|cost)|package (?:price|cost)|costs?|offered)\b/i.test(before);
  });
  return mention?.value;
}

function extractGasServicePrice(text: string) {
  const mention = moneyMentions(text).find((candidate) => {
    if (isRecurringAmount(text, candidate)) return false;
    const localContext = text.slice(Math.max(0, candidate.index - 120), candidate.end + 120);
    const gasService = /\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b[^.!?\n]{0,80}\b(?:gas|meter|connection|service)\b|\b(?:gas|meter|connection|service)\b[^.!?\n]{0,80}\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b/i.test(localContext);
    const priceContext = /\b(?:quote(?:d)?|price|costs?|fee|charge)\b|\$\s*[\d,]+(?:\.\d{1,2})?\s+to\s+(?:abolish|disconnect|remove)/i.test(localContext);
    return gasService && priceContext;
  });
  return mention?.value;
}

const SURGE_QUESTION_INTENT_RULES: ReadonlyArray<{
  question: RegExp;
  answer: RegExp;
}> = [
  {
    question: /\b(?:draughts?|drafts?|air leaks?|weather seals?|door snakes?)\b/i,
    answer: /\b(?:draughts?|drafts?|air leaks?|moving air|gaps?|seals?|weather strips?|door snakes?)\b/i,
  },
  {
    question: /\b(?:honeycomb blinds?|cellular blinds?|thermal curtains?|pelmets?)\b/i,
    answer: /\b(?:honeycomb|cellular|blinds?|curtains?|pelmets?|window coverings?)\b/i,
  },
  {
    question: /\blow[- ]?e\b/i,
    answer: /\b(?:low[- ]?e|coating|glass|glazing|surface)\b/i,
  },
  {
    question: /\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b[^.!?\n]{0,80}\b(?:gas|meter|connection|service)\b|\b(?:gas|meter|connection|service)\b[^.!?\n]{0,80}\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b/i,
    answer: /\b(?:gas|meter|connection|service)\b/i,
  },
  {
    question: /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|hot[- ]?water system|water heater)\b/i,
    answer: /\b(?:heat[- ]?pump|hot[- ]?water|tank|water heater)\b/i,
  },
  {
    question: /\b(?:flat[- ]?rate|single[- ]?rate|retailer|electricity plan|energy plan|tariffs?|feed[- ]?in|free[- ]?(?:hours?|power))\b/i,
    answer: /\b(?:flat[- ]?rate|single[- ]?rate|retailer|electricity plan|energy plan|tariffs?|rates?|bill|free[- ]?(?:hours?|power)|supply charge|export)\b/i,
  },
  {
    question: /\b(?:price|cost|quote|payback)\b[^.!?\n]{0,80}\bbatter(?:y|ies)\b|\bbatter(?:y|ies)\b[^.!?\n]{0,80}\b(?:price|cost|quote|payback)\b/i,
    answer: /\b(?:batter(?:y|ies)|storage)\b/i,
  },
  {
    question: /\bbatter(?:y|ies)\b/i,
    answer: /\b(?:batter(?:y|ies)|storage|store electricity|stored electricity)\b/i,
  },
  {
    question: /\b(?:solar|photovoltaic|PV|inverter)\b/i,
    answer: /\b(?:solar|photovoltaic|PV|panels?|inverter|rooftop generation|oversized|undersized)\b|\b\d+(?:\.\d+)?\s*kW\s+(?:option|system|size)\b/i,
  },
  {
    question: /\b(?:solar panels?|panels?)\b[^.!?\n]{0,100}\b(?:outdated|obsolete|replace|fault|poor output)\b|\b(?:outdated|obsolete|replace)\b[^.!?\n]{0,100}\b(?:solar panels?|panels?)\b/i,
    answer: /\b(?:solar|panels?|inverter|roof|generation|export)\b/i,
  },
  {
    question: /\b(?:condensation|mould|mold|humidity)\b/i,
    answer: /\b(?:condensation|mould|mold|moisture|humidity|damp)\b/i,
  },
  {
    question: /\b(?:insulation|batts?)\b/i,
    answer: /\b(?:insulation|batts?|ceiling|roof)\b/i,
  },
  {
    question: /\b(?:ducted|split systems?|air conditioners?|reverse[- ]?cycle)\b/i,
    answer: /\b(?:ducted|split systems?|air conditioners?|reverse[- ]?cycle|heating|cooling|airflow|installer)\b/i,
  },
  {
    question: /\b(?:induction|cooktops?)\b/i,
    answer: /\b(?:induction|cooktops?|circuit|electrician|cooking)\b/i,
  },
  {
    question: /\b(?:three[- ]?phase|3[- ]?phase|single[- ]?phase|switchboard|electrical supply)\b/i,
    answer: /\b(?:three[- ]?phase|3[- ]?phase|single[- ]?phase|switchboard|electrical supply|mains?|electrician)\b/i,
  },
  {
    question: /\b(?:rebates?|discounts?|eligibility|STCs?|VEECs?|ESCs?|PRCs?|certificates?)\b/i,
    answer: /\b(?:rebates?|discounts?|eligib(?:le|ility)|STCs?|VEECs?|ESCs?|PRCs?|certificates?|scheme|program(?:me)?)\b/i,
  },
  {
    question: /\b(?:quote|quotes|quoted)\b/i,
    answer: /\b(?:quote(?:d|s)?|price|cost|scope|model|installation|warranty)\b/i,
  },
  {
    question: /\b(?:windows?|glazing|glass|aluminium frames?)\b/i,
    answer: /\b(?:windows?|glazing|glass|frames?|blinds?|curtains?|draughts?|condensation)\b/i,
  },
  {
    question: /\b(?:underfloor|suspended floor|floor insulation)\b/i,
    answer: /\b(?:underfloor|floor|insulation|subfloor)\b/i,
  },
  {
    question: /\b(?:exhaust fans?|ventilation|rangehoods?)\b/i,
    answer: /\b(?:exhaust|ventilat(?:e|ion)|rangehood|moisture|outside)\b/i,
  },
  {
    question: /\bgas\b/i,
    answer: /\b(?:gas|reverse[- ]?cycle|electric|heating|hot[- ]?water|cook(?:ing|top)|connection|meter)\b/i,
  },
  {
    question: /\b(?:EV chargers?|electric vehicle chargers?|charge (?:my |an? )?(?:EV|electric car))\b/i,
    answer: /\b(?:EV|electric vehicle|charger|charging|vehicle)\b/i,
  },
] as const;

/**
 * Rejects answers that drift into a different home-energy category. The rules
 * intentionally cover broad household decisions rather than individual test
 * phrases, and every recognised material topic in a multi-part question must
 * remain visible in the answer.
 */
export function surgeAnswerMatchesQuestionIntent(message: string, answerText: string) {
  const relevantRules = SURGE_QUESTION_INTENT_RULES.filter(({ question }) => question.test(message));
  return relevantRules.every(({ answer: expected }) => expected.test(answerText));
}

/**
 * A final server boundary for generated answers: at least one material decision
 * named by the customer must still be present. Detailed multi-part coverage is
 * enforced by the model validator; this only blocks a wholly different topic.
 */
export function surgeAnswerSharesQuestionIntent(message: string, answerText: string) {
  const relevantRules = SURGE_QUESTION_INTENT_RULES.filter(({ question }) => question.test(message));
  return relevantRules.length === 0
    || relevantRules.some(({ answer: expected }) => expected.test(answerText));
}

const EXPLICIT_PRIOR_TOPIC_REFERENCE_PATTERN = /\b(?:it|its|this|that|these|those|they|them|same|former|latter|previous|earlier|above)\b/i;
const TRAILING_ADDITIVE_REFERENCE_PATTERN = /\b(?:too|as well)\s*[?.!]*$/i;

function explicitlyReferencesPriorTopic(message: string) {
  const withoutWorthItIdiom = message.replace(/\bworth\s+it\b/gi, "worth");
  return EXPLICIT_PRIOR_TOPIC_REFERENCE_PATTERN.test(withoutWorthItIdiom)
    || TRAILING_ADDITIVE_REFERENCE_PATTERN.test(withoutWorthItIdiom);
}

function conversationText(message: string, recentTurns: readonly RecentTurn[]) {
  const currentTopic = surgeConversationTopicFor(message);
  const referencesPriorTopic = explicitlyReferencesPriorTopic(message);
  const priorUserText = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-5)
    .filter((turn) => {
      if (!currentTopic || referencesPriorTopic) return true;
      const priorTopic = surgeConversationTopicFor(turn.content);
      return !priorTopic || priorTopic === currentTopic;
    })
    .map((turn) => turn.content)
    .join("\n");
  const needsPriorTopic = isSurgeContextDependentMessage(message);
  return needsPriorTopic && priorUserText ? `${message}\n${priorUserText}` : message;
}

function planFact(context: SurgePlanContext | null, key: string) {
  return context?.facts.find((fact) => fact.key === key)?.value || "";
}

function answer(base: EnergyAssistantAnswer, value: SimpleAnswer): EnergyAssistantAnswer {
  return {
    ...base,
    directAnswer: value.directAnswer,
    practicalSteps: value.practicalSteps.slice(0, 3),
    nextAction: value.practicalSteps[0] || "",
    status: value.suggestedQuestion ? "needs_context" : "answered",
    citations: [],
    assumptions: ["This is general guidance based on the home and conversation details supplied so far."],
    confidence: value.confidence || "medium",
    suggestedQuestions: value.suggestedQuestion ? [value.suggestedQuestion] : [],
    toolActions: [],
    sourceBoundary: "Current prices, rebates, eligibility and exact product claims need current official or customer-supplied evidence.",
  };
}

function quoteAnswer(base: EnergyAssistantAnswer, text: string) {
  const quotedPrices = moneyMentions(text);
  const comparesQuotes = quotedPrices.length >= 2
    || /\b(?:cheaper|dearer|expensive one|compare(?:d|s|ing)?\s+(?:the\s+)?quotes?|quote\s*A|quote\s*B)\b/i.test(text);
  const excludesIncentives = /\b(?:not|isn't|is not|don't|do not)\b[^.!?\n]{0,45}\b(?:rebate|discount|certificate|incentive)s?\b/i.test(text)
    || /\b(?:quote|price|cost)\b[^.!?\n]{0,70}\bnot\s+(?:the\s+)?(?:rebate|discount|certificate|incentive)s?\b/i.test(text);
  const exactModel = text.match(
    /\bmodel\s+(?:is\s+)?((?:[A-Z][A-Z0-9-]*\s+){0,2}[A-Z0-9-]*\d[A-Z0-9-]*)\b/i,
  )?.[1]?.trim();
  const singlePrice = quotedPrices.length === 1
    ? Number(quotedPrices[0].value.replaceAll(",", ""))
    : null;
  const suppliedDetail = [
    singlePrice && Number.isFinite(singlePrice) ? `$${singlePrice.toLocaleString("en-AU")}` : "",
    exactModel ? `model ${exactModel}` : "",
  ].filter(Boolean).join(" and ");
  return answer(base, {
    directAnswer: comparesQuotes
      ? "I cannot call the cheaper quote better from price alone. It is good value only if it covers the same job, suitable equipment and warranty without important exclusions."
      : suppliedDetail
        ? `I have ${suppliedDetail}, but that is not enough to call the quote fair yet. The price is reasonable only if the equipment suits the job and the installed scope includes every required part, with no costly exclusions.`
        : "Yes, I can check whether the quote looks fair and complete. I need the quote or its main details before I can give you an honest verdict.",
    practicalSteps: [
      excludesIncentives
        ? "Check the final installed total, including GST and every required part of the job."
        : "Check the final amount after rebates or certificate discounts.",
      "Compare the exact model, size and everything included in installation.",
      "Check exclusions, electrical work, warranty and who handles problems after installation.",
    ],
    suggestedQuestion: suppliedDetail
      ? "What equipment is being installed, and what work and warranty does the quote include?"
      : "Can you attach the quote, or type its total price and exact model?",
  });
}

/**
 * Covers common, conversational household questions when the model is unavailable.
 * It deliberately leaves detailed programme, calculation and safety questions to the
 * governed energy-assistant engine.
 */
export function composeSurgeSimpleAnswer(
  message: string,
  base: EnergyAssistantAnswer,
  context: SurgePlanContext | null,
  recentTurns: readonly RecentTurn[] = [],
): EnergyAssistantAnswer | null {
  const priorUserText = recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-5)
    .map((turn) => turn.content)
    .join("\n");
  const priorAssistantText = recentTurns
    .filter((turn) => turn.role === "assistant")
    .slice(-3)
    .map((turn) => turn.content)
    .join("\n");

  if (/\bdishwashers?\b/i.test(message)) {
    return answer(base, {
      directAnswer: "For a dishwasher, first confirm it fits the cabinet and that the quote includes delivery, connection, testing and removal of the old unit if needed. Compare models of a similar size using both the Energy Rating and Water Rating labels, then check the annual energy use, water use, noise, cycle length, warranty and local service. A licensed plumber or electrician may be needed if the existing connections are unsuitable.",
      practicalSteps: [],
    });
  }

  if (/\b(?:what if )?(?:it is|it's) calm(?: tonight)?\b|\bcalm tonight\b/i.test(message)
    && /\b(?:window|draught|draft|air leak|opening gap|wind blows?)\b/i.test(`${priorUserText}\n${priorAssistantText}`)) {
    return answer(base, {
      directAnswer: "If it is calm, you may not feel the draught because there is no wind pressure pushing air through the gap. That does not rule out an air leak. Hold a strip of tissue or paper near the opening seals, look for loose or flattened weather seals, and retest on a windy day before choosing the repair.",
      practicalSteps: [],
    });
  }

  if (/\b(?:(?:yeah|yes|yep|they are|it is|it's)(?:,\s*|\s+))?(?:really|very|so)?\s*(?:cold|freezing)\b/i.test(message)
    && /\bwindows?\b[\s\S]{0,80}\b(?:cold|no wind)\b|\b(?:cold|freezing)\b[\s\S]{0,80}\b(?:still nights?|no wind)\b/i.test(`${priorAssistantText}\n${priorUserText}`)) {
    return answer(base, {
      directAnswer: "That points to heat loss through the cold window glass or frame, not just moving air. Start with a close-fitting honeycomb blind or thermal curtain with a pelmet. If the window still feels uncomfortably cold on still nights, properly fitted secondary glazing can improve the inside surface temperature without replacing the whole window.",
      practicalSteps: [],
    });
  }

  if (/\b(?:is )?that too long(?: then)?\b/i.test(message)
    && /\bbatter(?:y|ies)\b/i.test(priorUserText)
    && /\b(?:payback|saving|savings|\$\s*[\d,]+)\b/i.test(priorUserText)) {
    const quotedBatteryPrice = Number(extractBatteryPurchasePrice(priorUserText)?.replace(/,/g, "") || 0);
    const recurringSaving = moneyMentions(priorUserText).find((mention) => isRecurringAmount(priorUserText, mention))?.value;
    const namedSaving = priorUserText.match(/\b(?:expected|estimated|likely|yearly|annual)\s+savings?\s+(?:are|is|of)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    const expectedYearlySaving = Number((recurringSaving || namedSaving || "").replace(/,/g, "")) || 0;
    const simplePaybackYears = quotedBatteryPrice > 0 && expectedYearlySaving > 0
      ? Math.round((quotedBatteryPrice / expectedYearlySaving) * 10) / 10
      : 0;
    return answer(base, {
      directAnswer: simplePaybackYears
        ? `Yes. About ${simplePaybackYears} years is a long simple payback for a battery and is probably too long if it reaches or exceeds the warranty period. It also ignores battery losses and any fall in usable capacity, so the real result may be worse. Treat backup power as a separate benefit if you value it.`
        : "Yes, that sounds like a long battery payback. It is probably too long if the saving does not repay the installed cost comfortably inside the battery warranty, after allowing for losses and declining usable capacity.",
      practicalSteps: [],
    });
  }

  if (/\bwhat should (?:they|the installer|the electrician) prove\b|\bwhat (?:proof|evidence) should (?:they|the installer|the electrician) (?:give|show|provide)\b/i.test(message)
    && /\b(?:three[- ]?phase|3[- ]?phase)\b/i.test(priorUserText)
    && /\b(?:(?:EV|electric vehicle)\s+charger|charger|EVSE|wallbox)\b/i.test(priorUserText)) {
    const chargerPower = priorUserText.match(/\b(\d+(?:\.\d+)?)\s*kW\s+(?:EV|electric vehicle)?\s*charger\b/i)?.[1];
    return answer(base, {
      directAnswer: `They should provide a written maximum-demand or load calculation showing the existing supply, switchboard capacity, normal household loads and ${chargerPower ? `the ${chargerPower} kW charger` : "the proposed charger"}. They should also identify the exact network or equipment rule that requires three-phase supply and explain why load management or a lower charger limit will not work. A sales claim alone is not proof that the upgrade is necessary.`,
      practicalSteps: [],
    });
  }

  if (/\bhow do i check that\b/i.test(message)
    && /\b(?:heat[- ]?pump|hot[- ]?water|proposed unit)\b[\s\S]{0,100}\b(?:bedroom|noise|vibration)\b|\b(?:bedroom|noise|vibration)\b[\s\S]{0,100}\b(?:heat[- ]?pump|hot[- ]?water|proposed unit)\b/i.test(`${priorUserText}\n${priorAssistantText}`)) {
    return answer(base, {
      directAnswer: "Get the exact model number and its published sound data, then ask the installer to assess the proposed location beside the bedroom in writing. The check should cover sound at the bedroom window and property boundary, vibration-isolating mounts, nearby walls that may reflect noise, normal run times and any night mode. If they cannot show the location will be suitable, move the unit before installation.",
      practicalSteps: [],
    });
  }

  if (/\bcan i do that without drilling\b/i.test(message)
    && /\b(?:rent|renter|tenant|removable|honeycomb|window treatment)\b/i.test(`${priorUserText}\n${priorAssistantText}`)) {
    return answer(base, {
      directAnswer: "Yes. Use a no-drill honeycomb blind or another removable covering made for that window, such as a tension-fit system. Check the manufacturer's size and mounting instructions, make sure it clears handles and seals, and test any removable adhesive because it can still lift paint. Ask the owner before using any fixing that could mark or damage the property.",
      practicalSteps: [],
    });
  }

  if (/\bwhy does timing matter\b/i.test(message)
    && /\bsolar\b[\s\S]{0,120}\b(?:export|import)(?:s|ed|ing)?\b|\b(?:export|import)(?:s|ed|ing)?\b[\s\S]{0,120}\bsolar\b/i.test(`${priorUserText}\n${priorAssistantText}`)) {
    return answer(base, {
      directAnswer: "Timing matters because the yearly solar export and grid import totals can happen at different times. A battery only saves money when spare daytime solar can be stored and then used during the evening or overnight instead of being exported cheaply and bought back later at a higher rate. Half-hourly data shows how often those two periods line up.",
      practicalSteps: [],
    });
  }

  if (/\b(?:only|just|mainly)?\s*(?:happens?|noticeable)?\s*(?:when|while|on)?\s*(?:it(?:'s| is)\s*)?(?:windy|the wind(?: is blowing)?)\b/i.test(message)
    && /\b(?:draughts?|drafts?|air leaks?)\b/i.test(priorUserText)) {
    return answer(base, {
      directAnswer: "That strongly points to an air leak rather than just cold glass. On the next windy day, feel around the opening window, frame and bedroom door to find the moving air. Use a removable weather seal on an opening gap or a door snake under the door; use suitable sealant only on a fixed crack, and keep required vents open.",
      practicalSteps: [],
    });
  }

  if (/\bshould i call (?:the |my )?installer\b/i.test(message)
    && /\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b[\s\S]{0,120}\b(?:noisy|blows? hard|airflow)\b|\b(?:noisy|blows? hard|airflow)\b[\s\S]{0,120}\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(priorUserText)) {
    return answer(base, {
      directAnswer: "Yes. First confirm it is in heating mode, set it around 20 to 21°C, use a low or auto fan setting and open the normal outlets or zones. If it is still excessively noisy or blowing too hard, ask the installer to return and check the airflow, duct sizes, zone balance and temperature-sensor setup.",
      practicalSteps: [],
    });
  }

  const text = conversationText(message, recentTurns);
  const effectiveContext = surgePlanContextAfterRecentHomeFactChanges(context, message, recentTurns);
  const solar = planFact(effectiveContext, "solar");
  const heating = planFact(effectiveContext, "heating_cooling_systems");
  const comfort = planFact(effectiveContext, "comfort_concerns");
  const glazing = planFact(effectiveContext, "glazing");
  const exhaust = planFact(effectiveContext, "exhaust_fans");
  const cleanMessage = message.trim();
  const bareSolarPrompt = /^(?:(?:(?:what|how)\s+about|tell me about)\s+|(?:and|also)\s+)?(?:(?:my|our|the)\s+)?(?:rooftop\s+)?solar(?:\s+(?:power|panels?|system))?(?:\s+(?:instead|next|too|as well))?[?.!]*$/i.test(cleanMessage);
  const additiveBareSolarPrompt = /\bsolar(?:\s+(?:power|panels?|system))?\s+(?:too|as well)[?.!]*$/i.test(cleanMessage);
  const currentSolarCostQuestion = /\b(?:solar|PV|panels?)\b/i.test(cleanMessage)
    && /\b(?:expensive|costly|dear|high[- ]?priced|cost|price)\b/i.test(cleanMessage)
    && !/\b(?:quote|proposal)\b|\$/i.test(cleanMessage);
  const priorQuestionWasAboutCost = /\b(?:expensive|costly|dear|high[- ]?priced|cost|price)\b/i.test(priorUserText);

  if (currentSolarCostQuestion || (additiveBareSolarPrompt && priorQuestionWasAboutCost)) {
    return answer(base, {
      directAnswer: "Solar can look expensive because the installed price covers the panels, inverter, mounting, electrical protection, labour, access and warranties, not just the panels themselves. Roof or switchboard work and difficult access can add more. Compare itemised, like-for-like quotes together with their annual generation and bill-saving estimates. What system size, total installed price and inclusions are you comparing?",
      practicalSteps: [],
    });
  }

  if (/\b(?:solar|PV|panels?)\b/i.test(cleanMessage)
    && /\b(?:cheaper|better)\b/i.test(cleanMessage)
    && !/\b(?:that|this|these|those|it|they|them)\b/i.test(cleanMessage)) {
    return answer(base, {
      directAnswer: "Solar may be the cheaper or better-value option, but that needs a stated comparison. Compare the full installed price, conservative yearly bill saving, maintenance, warranty and how long you expect to stay at the property. What are you comparing solar with, and what system size and installed price are you considering?",
      practicalSteps: [],
    });
  }

  if (bareSolarPrompt) {
    return answer(base, {
      directAnswer: "Solar is usually worth considering when the roof is reasonably unshaded and you can use some of its power during the day. It lowers bills by replacing electricity you would otherwise buy from the grid; exported power earns a smaller feed-in credit. Check a full year of electricity use, roof shade and condition, the network export limit and two itemised generation estimates. Judge a battery separately.",
      practicalSteps: [],
    });
  }

  if (/^(?:(?:(?:what|how)\s+about|tell me about)\s+|(?:and|also)\s+)?(?:(?:my|our|the)\s+)?induction(?:\s+(?:cooking|cooktops?))?(?:\s+(?:instead|next|too|as well))?[?.!]*$/i.test(message.trim())) {
    return answer(base, {
      directAnswer: "Induction is an efficient electric cooking option with no open flame or indoor gas combustion. Your existing pans may work if a magnet sticks firmly to the base. The exact cooktop may need a dedicated circuit or an approved power limit, so have a licensed electrician check the model, wiring and switchboard before purchase.",
      practicalSteps: [],
    });
  }

  if (/^(?:(?:(?:what|how)\s+about|tell me about)\s+|(?:and|also)\s+)?(?:(?:my|our|the)\s+)?(?:heat[- ]?pump\s+hot[- ]?water|hot[- ]?water\s+heat[- ]?pump)(?:\s+(?:system|unit))?(?:\s+(?:instead|next|too|as well))?[?.!]*$/i.test(message.trim())) {
    return answer(base, {
      directAnswer: "Heat-pump hot water is usually an efficient replacement for gas or standard electric hot water. The tank and recovery rate must suit the household, and the outdoor-unit location must allow drainage without creating a noise problem near bedrooms or neighbours. Compare the full installed price, warranty, local service and cold-weather performance, then run it during sunny or cheaper electricity hours where practical.",
      practicalSteps: [],
    });
  }

  if (/^(?:(?:(?:what|how)\s+about|tell me about)\s+|(?:and|also)\s+)?(?:(?:my|our|the)\s+)?(?:windows?|glazing)(?:\s+(?:instead|next|too|as well))?[?.!]*$/i.test(message.trim())) {
    return answer(base, {
      directAnswer: "Windows can cause winter heat loss, summer heat gain, draughts and noise, but replacement is not always the first step. Work out whether the problem is moving air, cold glass or frame, direct sun or outside noise. Repair confirmed gaps and improve close-fitting coverings first; replace damaged or very leaky windows, or when the comfort and noise improvement justifies the cost.",
      practicalSteps: [],
    });
  }

  const mentionsAirConditioner = /\b(?:air conditioners?|air\s*con(?:ditioning)?|aircon|reverse[- ]?cycle|split systems?)\b/i.test(text);
  const asksAboutAirConditionerWater = mentionsAirConditioner
    && /\b(?:drip(?:ping|s|ped)?|leak(?:ing|s|ed)?|water\s+(?:coming|dripping|leaking|running|under))\b/i.test(text);
  const asksAboutHotWeatherCoolingEfficiency = mentionsAirConditioner
    && /\b(?:efficient|efficiency|cheap(?:er)?\s+to\s+run|running\s+cost|power[- ]?hungry|work(?:s|ing)?\s+well)\b/i.test(text)
    && /\b(?:cool(?:ing)?|hot\s+weather|very\s+hot|extreme\s+heat|heatwave|summer)\b/i.test(text);

  const winterGasCost = text.match(/\bgas(?: heating)?\s+costs?\s+(?:about|around|roughly|approximately)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s+(?:each|per|a)\s+winter\b/i)?.[1];
  if (winterGasCost
    && /\breverse[- ]?cycle\b/i.test(text)
    && /\b(?:cheap(?:er)?|cost less|save|running cost)\b/i.test(text)) {
    const formattedCost = Number(winterGasCost.replace(/,/g, "")).toLocaleString("en-AU");
    return answer(base, {
      directAnswer: `Yes, reverse-cycle is likely to be cheaper for heating only the rooms you use. Your gas heating currently costs about $${formattedCost} each winter, while a correctly sized reverse-cycle air conditioner usually provides the same comfort with much less purchased energy. The exact saving depends on your electricity tariff, room heat loss and how long it runs. If heating is your last gas use, removing the gas supply charge can improve the saving further.`,
      practicalSteps: [],
    });
  }

  if ((/\b(?:is|are|does)\s+(?:rooftop\s+)?solar(?:\s+(?:power|panels?|system))?\s+(?:worth(?:while|\s+it)?|make sense|pay off)\b/i.test(text)
      || /\b(?:is|would)\s+it\s+worth\s+(?:getting|installing|having)\s+solar\b/i.test(text))
    && !/\b(?:quote|proposal|battery|finance|loan)\b|\$/i.test(text)) {
    return answer(base, {
      directAnswer: "Usually, yes. Rooftop solar often pays for itself by replacing electricity you would otherwise buy from the grid. It works best with a reasonably unshaded roof, enough daytime use or appliances you can shift into daylight hours, and enough time at the property to recover the installed cost. Size it from a full year of electricity use, usable roof area and the network export limit, then compare written generation and bill-saving estimates. Judge a battery separately.",
      practicalSteps: [],
    });
  }

  if (/\b(?:will|can|does)\s+(?:rooftop\s+)?solar(?:\s+(?:power|panels?|system))?\b[^?\n]{0,60}\b(?:reduce|lower|cut|save|bring down)\b[^?\n]{0,35}\b(?:electricity|power|energy)?\s*bills?\b|\b(?:reduce|lower|cut|save|bring down)\b[^?\n]{0,45}\b(?:electricity|power|energy)?\s*bills?\b[^?\n]{0,45}\bsolar\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes. Solar reduces the electricity you need to buy while the panels are generating, so using more of that power during the day usually gives the best saving. You will still pay the daily supply charge and buy power when solar is not covering the home. Exports earn the applicable feed-in credit, which is usually worth less than avoiding an imported kWh. The actual bill reduction depends on system output, daytime use and the complete electricity tariff.",
      practicalSteps: [],
    });
  }

  if (/\b(?:is|would|will)\b[^?\n]{0,20}\b(?:my|the|this|our)?\s*roof\b[^?\n]{0,50}\b(?:suitable|good|okay|ok|work)\b[^?\n]{0,25}\b(?:for\s+)?solar\b|\b(?:can|could)\b[^?\n]{0,25}\bsolar\b[^?\n]{0,35}\b(?:go|fit|work|be installed)\b[^?\n]{0,20}\broof\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A roof can suit solar if it has enough usable area, limited shade, sound roofing and a layout that lets panels be safely fixed and serviced. North is not the only useful direction; east and west can also work, but orientation changes when the power is produced. An installer should check shade, roof age and condition, structure, panel layout, inverter location, cable route and the network export limit before confirming the design. Repair a roof that is near replacement before installing panels.",
      practicalSteps: [],
    });
  }

  if (/\bsolar(?:\s+panels?)?\b[^?\n]{0,50}\b(?:work|generate|produce|output|worth)\b[^?\n]{0,30}\bwinter\b|\bwinter\b[^?\n]{0,45}\bsolar(?:\s+panels?)?\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes. Solar panels still generate electricity in winter whenever there is daylight, and cool panels can operate efficiently. Total output is usually lower because days are shorter, the sun is lower and cloud or seasonal shade may reduce generation. A useful quote should show month-by-month output for the actual roof and shade, not only one annual total. Winter heating demand can still exceed what the system produces on many days.",
      practicalSteps: [],
    });
  }

  if (/\b(?:add|install|put on|expand)\b[^?\n]{0,45}\b(?:more|extra|additional)\b[^?\n]{0,20}\bsolar panels?\b[^?\n]{0,35}\b(?:later|afterwards|in future|down the track)\b|\b(?:add|expand)\b[^?\n]{0,45}\bsolar\b[^?\n]{0,35}\blater\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Often, yes, but plan for it now. Adding panels later depends on spare roof space, the existing inverter's input limits, compatible panel and string design, switchboard capacity, network approval and export limits. Mixing old and new panels on one inverter is not always suitable, so the addition may need a separate inverter or a larger planned inverter from the start. Ask the original installer to show the expansion path, warranty effect and network limit in writing.",
      practicalSteps: [],
    });
  }

  if (/\bhow many\s+(?:solar\s+)?panels?\b|\b(?:solar\s+)?panel count\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Panel count depends on the target system size and the rated wattage of the exact panel, so household size alone is not enough. Use: panel count = target system size in kW × 1,000 ÷ panel wattage in W. The final whole-number count must also fit the roof layout, inverter design and network approval. First choose the system size from a full year of electricity use, future loads, usable unshaded roof space and the export limit. What target system size and exact panel wattage are you considering?",
      practicalSteps: [],
    });
  }

  if (/\b(?:what size|how (?:big|large)|size should)\b[^?\n]{0,60}\b(?:home\s+)?batter(?:y|ies)\b|\bbatter(?:y|ies)\b[^?\n]{0,60}\b(?:what size|how (?:big|large)|size should)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Size a home battery to the electricity you use after sunset and the spare solar available to charge it, not to the solar-panel size or annual totals alone. Use half-hourly data, or several typical days, to find both figures. The usable battery capacity should roughly match the smaller of that overnight use and daytime surplus, with allowance for losses and any backup reserve. Also check output power, warranty and backup scope. Without those usage figures, an exact kWh size would be a guess.",
      practicalSteps: [],
    });
  }

  if (/\b(?:can|will|would)\b[^?\n]{0,25}\b(?:a|my|the|home)?\s*batter(?:y|ies)\b[^?\n]{0,45}\b(?:power|run|back up|supply)\b[^?\n]{0,35}\b(?:my|the|a)?\s*(?:whole|entire)\s+(?:home|house)\b|\b(?:whole|entire)\s+(?:home|house)\b[^?\n]{0,45}\bbatter(?:y|ies)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Sometimes, but not automatically. Battery capacity determines how long it can run the home, while its power rating determines which appliances can run together. Whole-home backup also needs compatible inverter controls, a backup gateway and an installation designed for it; many systems back up only selected circuits. Air conditioning, cooking, hot water or EV charging can exceed the backup limit. Ask the quote to list the backed-up circuits, continuous and surge power, usable kWh and expected runtime for your essential loads.",
      practicalSteps: [],
    });
  }

  const batteryRuntimeCapacity = message.match(/\b(\d+(?:\.\d+)?)\s*kWh\s+(?:home\s+)?batter(?:y|ies)\b/i)?.[1];
  if (/\bhow long\b[^?\n]{0,60}\b(?:home\s+)?batter(?:y|ies)\b[^?\n]{0,55}\b(?:run|power|supply)\b|\b(?:home\s+)?batter(?:y|ies)\b[^?\n]{0,55}\bhow long\b[^?\n]{0,40}\b(?:run|power|supply)\b/i.test(message)) {
    return answer(base, {
      directAnswer: `${batteryRuntimeCapacity ? `A ${batteryRuntimeCapacity} kWh battery does not have one fixed runtime.` : "A home battery does not have one fixed runtime."} Use: runtime in hours = usable battery energy available after the backup reserve and losses ÷ the average load of the backed-up circuits in kW. It may stop sooner if the appliances running together exceed the battery's continuous or surge power. What is the exact battery model, starting charge or backup reserve, and measured or estimated average load of the circuits you want it to run?`,
      practicalSteps: [],
    });
  }

  if (/\b(?:how long|lifespan|life expectancy|service life)\b[^?\n]{0,50}\bbatter(?:y|ies)\b|\bbatter(?:y|ies)\b[^?\n]{0,45}\b(?:last|lifespan|life expectancy|service life)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A home battery is commonly sold with about a 10-year warranty, but its useful life depends on temperature, charge cycles, depth of discharge and the way it is controlled. Use the written warranty as the evidence: check years, total energy throughput or cycle limit, retained-capacity promise, labour coverage and who provides service. The battery may keep working after the warranty, but with less usable capacity, so the financial payback should not rely on an optimistic life beyond the warranted terms.",
      practicalSteps: [],
    });
  }

  if (/\b(?:can|will|does)\b[^?\n]{0,25}\b(?:a|my|the|home)?\s*batter(?:y|ies)\b[^?\n]{0,45}\bcharge\b[^?\n]{0,20}\b(?:from|off)\b[^?\n]{0,15}\b(?:the\s+)?grid\b|\bcharge\b[^?\n]{0,30}\bbatter(?:y|ies)\b[^?\n]{0,30}\b(?:from|off)\b[^?\n]{0,15}\b(?:the\s+)?grid\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, if the battery, inverter and control settings allow grid charging. It can be useful during a cheap or free tariff window or to preserve backup reserve before an outage, but charging and discharging loses some energy. Check the rate paid to charge, the later import rate avoided, battery losses and any retailer, VPP or warranty restrictions. Grid charging is not automatically cheaper than using spare solar.",
      practicalSteps: [],
    });
  }

  if (/\b(?:can|could)\s+i\s+(?:add|install|connect|retrofit)\s+(?:a\s+)?batter(?:y|ies)\b[^?\n]{0,55}\b(?:existing|current|old)\s+solar\b|\badd(?:ing)?\s+(?:a\s+)?batter(?:y|ies)\b[^?\n]{0,55}\b(?:existing|current|old)\s+solar\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Usually, yes. A battery can often be added to existing solar with either a compatible hybrid inverter or a separate battery inverter. The installer must check the existing inverter, switchboard, meter, available space, network rules, backup wiring and whether changing the solar equipment affects warranties or an old feed-in tariff. Ask for a written design showing what stays, what changes, the usable battery capacity and exactly which circuits work in a blackout.",
      practicalSteps: [],
    });
  }

  if (/\b(?:external|outside)\s+(?:blinds?|shutters?|window coverings?)\b[^?\n]{0,65}\b(?:better|more effective|compare|versus|vs)\b[^?\n]{0,35}\b(?:internal|inside)\s+(?:blinds?|shutters?|window coverings?)\b|\b(?:internal|inside)\s+(?:blinds?|shutters?|window coverings?)\b[^?\n]{0,65}\b(?:better|more effective|compare|versus|vs)\b[^?\n]{0,35}\b(?:external|outside)\s+(?:blinds?|shutters?|window coverings?)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "For keeping summer heat out, external blinds or shutters are usually better because they stop sunlight before it heats the glass. Internal blinds are easier to install and can still improve comfort, especially close-fitting honeycomb blinds in winter, but the glass has already absorbed the sun by then. Choose external shade for strong summer sun where the building and wind exposure allow it; choose well-fitted internal coverings when outside installation is not practical.",
      practicalSteps: [],
    });
  }

  if (/\b(?:honeycomb(?:\s+blinds?)?|cellular\s+(?:blinds?|shades?)|curtains?|blinds?|shutters?|pelmets?|window coverings?)\b[^?\n]{0,55}\b(?:actually\s+)?(?:work|effective|help|worth(?:while|\s+it)?|keep\s+heat\s+(?:in|out)|reduce\s+heat\s+loss)\b|\b(?:work|effective|help|worth(?:while|\s+it)?|keep\s+heat\s+(?:in|out)|reduce\s+heat\s+loss)\b[^?\n]{0,55}\b(?:honeycomb(?:\s+blinds?)?|cellular\s+(?:blinds?|shades?)|curtains?|blinds?|shutters?|pelmets?|window coverings?)\b/i.test(text)
    && !/\b(?:tilt[- ]?and[- ]?turn|tilt[- ]?turn|no[- ]?drill|without drilling)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes. Well-fitted window coverings can noticeably improve comfort. Close-fitting honeycomb or cellular blinds, lined curtains and pelmets reduce winter heat loss, while external blinds or shutters are usually better at stopping strong summer sun before it reaches the glass. A close fit with small edge gaps matters. Coverings do not repair draughty seals, and damp windows still need to dry so condensation is not trapped.",
      practicalSteps: [],
    });
  }

  if (/\b(?:replace|upgrade|change)\b[^?\n]{0,70}\bsingle[- ]glaz(?:ed|ing)\s+windows?\b|\bsingle[- ]glaz(?:ed|ing)\s+windows?\b[^?\n]{0,70}\b(?:replace|upgrade|change)\b/i.test(text)
    && !/\b(?:quote|proposal|price|cost)\b|\$/i.test(text)) {
    return answer(base, {
      directAnswer: "Not automatically. Single-glazed windows lose more heat than good double glazing, but full replacement is expensive. First repair confirmed draughts and try close-fitting honeycomb blinds or thermal curtains with pelmets. Replacement makes more sense when the windows are damaged, very leaky, a major source of cold or noise, or already due for renewal. Compare quotes using the whole-window U-value, frame type, installation details and warranty, not just the words 'double glazed'.",
      practicalSteps: [],
    });
  }

  if (/\b(?:should\s+i|do i need to|is it worth(?:while)? to)\s+(?:replace|upgrade|change)\b[^?\n]{0,55}\baluminium\s+(?:frame[sd]?\s+)?windows?\b|\baluminium\s+(?:frame[sd]?\s+)?windows?\b[^?\n]{0,55}\b(?:replace|upgrade|change)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Not automatically. Older aluminium frames conduct heat and can feel very cold, but replacement is most worthwhile when the windows are damaged, badly leaking, difficult to use or a major comfort problem. First repair confirmed draughts and try close-fitting window coverings or suitable secondary glazing. If you replace them, compare the whole-window U-value and choose a thermally improved frame; new glass in another basic aluminium frame can leave much of the cold-frame problem behind.",
      practicalSteps: [],
    });
  }

  if (/\b(?:how can i|what can i do to|can i)\b[^?\n]{0,45}\b(?:make|keep|get)\b[^?\n]{0,25}\baluminium\s+(?:frame[sd]?\s+)?windows?\b[^?\n]{0,25}\b(?:warmer|less cold|more comfortable)\b|\baluminium\s+(?:frame[sd]?\s+)?windows?\b[^?\n]{0,45}\b(?:feel|make|keep)\b[^?\n]{0,20}\b(?:warmer|less cold)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "First check and repair any moving-air gaps around the opening parts and frame. For the cold glass and aluminium itself, use close-fitting honeycomb blinds or lined curtains with a pelmet; properly fitted secondary glazing can improve the inside surface further. A true thermal break cannot normally be added to an existing aluminium frame. Keep drainage holes clear and let condensation dry rather than trapping it behind the covering.",
      practicalSteps: [],
    });
  }

  if (/\b(?:should|can)\s+i\s+(?:use|fit|put|place)\s+(?:a\s+)?door snake\b|\bcan\s+i\s+seal\b[^?\n]{0,45}\bgaps?\b[^?\n]{0,35}\b(?:around|under|at)\b[^?\n]{0,20}\b(?:my|the)?\s*doors?\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, if air is actually moving through an unwanted gap. Check with your hand or a strip of tissue on a windy day. Use a door snake for an unintended gap under a closed door, weather seals on opening edges, and suitable sealant only on fixed cracks. Do not block a required vent, a combustion-air path or a gap deliberately left under a door for ventilation.",
      practicalSteps: [],
    });
  }

  if (/\b(?:three[- ]?phase|3[- ]?phase)\b/i.test(text)
    && /\b(?:induction|cooktop)\b/i.test(text)
    && /\b(?:need|require|required|necessary|must|upgrade)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, not automatically. Many induction cooktops can run on a suitable single-phase supply. The exact appliance may need a dedicated circuit, or it may allow a manufacturer-approved power limit. A licensed electrician should check the cooktop instructions, maximum household demand, existing supply, switchboard, cable and breaker. Upgrade to three-phase only if that calculation or a network requirement shows it is necessary, and ask for the reason in writing.",
      practicalSteps: [],
      confidence: "high",
    });
  }

  if (/\b(?:do|will|would)\s+i\s+need\b[^?\n]{0,35}\b(?:new|different|dedicated)\s+(?:wiring|circuit|cable)\b[^?\n]{0,55}\b(?:induction|cooktop)\b|\b(?:induction|cooktop)\b[^?\n]{0,55}\b(?:new|different|dedicated)\s+(?:wiring|circuit|cable)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Maybe. Many induction cooktops need a dedicated circuit, but whether new wiring is required depends on the exact cooktop's maximum input, any approved power-limit setting, and the cable, breaker, switchboard and supply already in the home. Give the model instructions to a licensed electrician before buying it. New wiring is needed only if the existing circuit cannot safely meet those requirements.",
      practicalSteps: [],
    });
  }

  if (/\b(?:do|will)\s+(?:i\s+need\s+)?(?:new|different|special)\s+(?:pots?|pans?|cookware)\b[^?\n]{0,45}\binduction\b|\b(?:do|will|would)\s+(?:my|these|the)\s+(?:pots?|pans?|cookware)\b[^?\n]{0,40}\b(?:work|suit(?:able)?|compatible)\b[^?\n]{0,30}\binduction\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Not necessarily. An induction cooktop works with magnetic cookware. If a fridge magnet sticks firmly to the flat base of a pot or pan, it will usually work; aluminium, copper and some stainless steel cookware will not unless they have a magnetic base. Test what you already own before buying a new set.",
      practicalSteps: [],
    });
  }

  if (/\b(?:is|are)\s+(?:an?\s+)?induction(?:\s+cooktops?)?\s+safe\b|\bare\s+induction\s+cooktops?\s+safe\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, induction cooktops are generally safe when installed and used correctly. They have no open flame, stop heating when suitable cookware is removed, and leave less waste heat in the kitchen, although the glass and pan can still become hot enough to burn. Use the child lock where needed, keep the surface clear and follow the appliance instructions and electrician's installation requirements.",
      practicalSteps: [],
    });
  }

  if (/\b(?:do|will)\s+induction(?:\s+cooktops?)?\b[^?\n]{0,35}\b(?:use|draw|consume)\b[^?\n]{0,20}\b(?:a lot of|much|more)\s+(?:power|electricity|energy)\b|\bis\s+induction\b[^?\n]{0,30}\bpower[- ]?hungry\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Not for the cooking delivered. An induction cooktop can draw high power when several zones run at full heat, but it transfers energy into the pan efficiently and usually cooks faster than a standard electric hotplate. It does not run at maximum power all the time. The exact cost depends on cooking time and your electricity rate; the electrical circuit still has to be sized for the appliance's maximum demand.",
      practicalSteps: [],
    });
  }

  if (/\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|heat[- ]?pump hot[- ]?water unit)\b/i.test(text)
    && /\b(?:near|beside|next to|close to|outside)\b[^?\n]{0,45}\b(?:(?:a|the|our|my)\s+)?bedroom(?: window)?\b|\b(?:(?:a|the|our|my)\s+)?bedroom(?: window)?\b[^?\n]{0,45}\b(?:near|beside|next to|close to|outside)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Possibly, but do not approve that location until the exact model's noise has been checked. Ask for its published sound data and have the installer assess the proposed position at the bedroom window and property boundary. The check should include vibration-isolating mounts, nearby walls that can reflect sound, normal run times and any night mode. If they cannot show in writing that the location will be suitable, move the unit before installation.",
      practicalSteps: [],
    });
  }

  if (/\b(?:what size|how (?:big|large))\b[^?\n]{0,60}\b(?:heat[- ]?pump\s+)?hot[- ]?water\s+(?:tank|unit|system)\b[^?\n]{0,55}\b(?:two|2)\s+(?:people|persons?|adults?)\b|\b(?:heat[- ]?pump\s+)?hot[- ]?water\s+(?:tank|unit|system)\b[^?\n]{0,60}\b(?:two|2)\s+(?:people|persons?|adults?)\b[^?\n]{0,45}\b(?:what size|how (?:big|large))\b/i.test(message)) {
    return answer(base, {
      directAnswer: "For two people, about 180 to 250 litres is a sensible starting range for heat-pump hot water. Choose toward the larger end for long or back-to-back showers, a bath, guests or a limited heating window; a smaller tank may suit short showers and a unit with fast recovery. Confirm the exact model's usable hot-water volume and cold-weather recovery before choosing it.",
      practicalSteps: [],
    });
  }

  if (/\b(?:are|is|how)\b[^?\n]{0,20}\b(?:heat[- ]?pump\s+hot[- ]?water|hot[- ]?water\s+heat[- ]?pump|heat[- ]?pump\s+water heater)s?\b[^?\n]{0,35}\b(?:noisy|loud|noise)\b|\bhow (?:noisy|loud)\b[^?\n]{0,35}\b(?:heat[- ]?pump\s+)?hot[- ]?water\b/i.test(message)) {
    return answer(base, {
      directAnswer: "They make some noise, usually a steady fan and compressor sound rather than silence. Whether it is annoying depends on the exact model, mounting and location, especially near bedroom windows or a neighbour. Check the published sound level, avoid echoing corners, use vibration-isolating mounts and have the installer confirm the proposed location and normal run times in writing.",
      practicalSteps: [],
    });
  }

  if (/\bcan\b[^?\n]{0,20}\b(?:heat[- ]?pump\s+hot[- ]?water|hot[- ]?water\s+heat[- ]?pump|heat[- ]?pump\s+water heater)\b[^?\n]{0,35}\b(?:run|heat|operate)\b[^?\n]{0,15}\bat night\b|\b(?:heat[- ]?pump\s+)?hot[- ]?water\b[^?\n]{0,35}\b(?:run|heat|operate)\b[^?\n]{0,15}\bat night\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, a heat-pump hot-water system can run at night if its controls and electricity supply allow it. Daytime operation is often better when it can use rooftop solar or warmer air, while a cheap overnight tariff may still make night operation sensible. Make sure the tank recovers before the busiest showers and that night-time noise will not disturb bedrooms or neighbours.",
      practicalSteps: [],
    });
  }

  if (/\b(?:is|are)\s+reverse[- ]?cycle(?:\s+air\s+conditioning|\s+air\s+conditioners?)?\b[^?\n]{0,35}\b(?:cheap|affordable|expensive)\b[^?\n]{0,15}\bto run\b|\b(?:cheap|affordable|expensive)\b[^?\n]{0,20}\bto run\b[^?\n]{0,35}\breverse[- ]?cycle\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Usually, yes. Reverse-cycle air conditioning is generally the cheapest common way to heat a room with electricity because it moves heat rather than making all of it directly. Running cost still rises with long hours, very high or low settings, poor insulation and dirty filters. Heat the rooms you are using, keep the filter clean and compare cost from the unit's electricity use and your tariff, not its maximum kW label.",
      practicalSteps: [],
    });
  }

  if (/\bwhat temperature\b[^?\n]{0,55}\b(?:set|run|use)\b[^?\n]{0,45}\b(?:air conditioners?|air\s*con(?:ditioning)?|reverse[- ]?cycle)\b|\b(?:set|run)\b[^?\n]{0,35}\b(?:air conditioners?|air\s*con(?:ditioning)?|reverse[- ]?cycle)\b[^?\n]{0,35}\bwhat temperature\b/i.test(message)) {
    return answer(base, {
      directAnswer: "As a practical starting point, set it around 20 to 21°C for heating and 24 to 26°C for cooling, then adjust for comfort. Extreme settings do not heat or cool the room faster; they usually make the system run longer. Keep doors and windows closed, use auto fan where suitable and clean the filter regularly.",
      practicalSteps: [],
    });
  }

  if (/\bshould\s+i\s+turn\b[^?\n]{0,30}\b(?:my|the)?\s*(?:air conditioners?|air\s*con(?:ditioning)?|reverse[- ]?cycle)\b[^?\n]{0,20}\boff\b[^?\n]{0,30}\bwhen\s+i\s+leave\b|\bwhen\s+i\s+leave\b[^?\n]{0,30}\b(?:air conditioners?|air\s*con(?:ditioning)?|reverse[- ]?cycle)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, turn it off when the home will be empty for hours. Leaving it running usually uses more energy than reheating or cooling the space later. For a short absence, extreme weather, pets or someone vulnerable, a moderate setback may be reasonable instead. A timer or app can restart it shortly before you return.",
      practicalSteps: [],
    });
  }

  if (/\bwhat\s+R[- ]?value\b[^?\n]{0,55}\b(?:ceiling|roof)\s+insulation\b|\b(?:ceiling|roof)\s+insulation\b[^?\n]{0,55}\bwhat\s+R[- ]?value\b/i.test(message)) {
    return answer(base, {
      directAnswer: "There is no single Australia-wide ceiling R-value. For many existing homes, a total ceiling level around R4 to R6 is a common target, with colder climates generally toward the higher end. Check the climate zone, current building requirements and what insulation is already present before buying more, because old and new layers can add together only when they are dry, complete and correctly installed. Keep required clearances around electrical equipment.",
      practicalSteps: [],
    });
  }

  if (/\bcan\s+i\s+(?:install|fit|put in)\b[^?\n]{0,30}\b(?:ceiling|roof|wall|underfloor)?\s*insulation\b[^?\n]{0,20}\b(?:myself|DIY)\b|\bDIY\b[^?\n]{0,25}\binsulation\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Sometimes, but only if the area is safe and the product is suitable for DIY installation. Roof spaces can contain live wiring, unsafe downlights, asbestos, extreme heat and difficult access; switching off the main power does not make every cable safe. Stop if any of those risks are possible and use a qualified installer. The insulation must stay dry, fit without gaps and keep the required clearances around electrical and heat-producing equipment.",
      practicalSteps: [],
    });
  }

  if (/\bwhat\s+is\s+(?:a\s+)?controlled load\b|\bwhat\s+does\s+controlled load\s+mean\b/i.test(message)) {
    return answer(base, {
      directAnswer: "A controlled load is a separately metered electricity circuit, usually for hot water, that the network switches on during set hours. It normally has its own cheaper usage rate and appears as a separate line on the bill. It is not the same as all household electricity used overnight, and the available hours are controlled by the network rather than by the appliance alone.",
      practicalSteps: [],
    });
  }

  if (/\bwhy\b[^?\n]{0,25}\b(?:my|our)?\s*(?:overnight|night[- ]?time)\s+(?:electricity|power|energy)?\s*(?:use|usage|consumption)\b[^?\n]{0,20}\b(?:high|so high|increased|up)\b|\b(?:overnight|night[- ]?time)\s+(?:electricity|power|energy)?\s*(?:use|usage|consumption)\b[^?\n]{0,25}\b(?:high|increased|up)\b/i.test(message)) {
    return answer(base, {
      directAnswer: "High overnight use is usually a large appliance running for hours, not phone chargers or small standby loads. Check heat-pump or electric hot water, heating or cooling, pool pumps, an EV charger, a clothes dryer and old fridges or freezers. Use half-hourly meter data to see when the jump starts, then match that time to appliance schedules or briefly test one likely load at a time.",
      practicalSteps: [],
    });
  }

  if (/\bhow\s+(?:do|can)\s+i\s+check\b[^?\n]{0,45}\bhow much\b[^?\n]{0,35}\b(?:electricity|power|energy)\b[^?\n]{0,35}\b(?:use|using|usage)\b[^?\n]{0,20}\bovernight\b|\bhow much\b[^?\n]{0,30}\b(?:electricity|power|energy)\b[^?\n]{0,30}\bi\s+use\b[^?\n]{0,20}\bovernight\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Use your retailer or distributor's half-hourly smart-meter data and add the intervals between the bedtime and morning times you care about. A normal quarterly bill cannot show that timing. Keep controlled-load hot water on its separate meter channel, and compare several ordinary nights so one EV charge, heater run or appliance cycle does not distort the result.",
      practicalSteps: [],
    });
  }

  if (/\bshould\s+i\s+(?:switch|change|move)\b[^?\n]{0,35}\b(?:electricity|energy|power)?\s*retailers?\b|\bis\s+it\s+worth\b[^?\n]{0,25}\b(?:switching|changing)\b[^?\n]{0,25}\bretailers?\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, if another plan gives a lower full-year bill for the way you actually use electricity. Compare the daily supply charge, all usage periods, demand charges, controlled-load rate, solar feed-in credit and discount conditions using a recent year of bills or interval data. Use the free government comparison service for your state and check the benefit period; do not switch for one cheap-looking rate alone.",
      practicalSteps: [],
    });
  }

  if (/\bwhat\s+is\s+(?:a\s+)?feed[- ]?in tariff\b|\bwhat\s+does\s+feed[- ]?in tariff\s+mean\b/i.test(message)) {
    return answer(base, {
      directAnswer: "A feed-in tariff is the amount your electricity retailer credits you for each kilowatt-hour of solar power you export to the grid. It is different from the higher rate you pay to import electricity, so using your solar in the home is often worth more than exporting it. Compare the whole plan because a high feed-in tariff can come with higher usage or supply charges.",
      practicalSteps: [],
    });
  }

  if (/\bcan\s+i\s+charge\b[^?\n]{0,25}\b(?:an?|my)\s+(?:EV|electric (?:car|vehicle))\b[^?\n]{0,35}\b(?:from|using|with)\b[^?\n]{0,25}\b(?:a\s+)?(?:normal|standard|regular)\s+(?:power point|outlet|socket)\b|\b(?:normal|standard|regular)\s+(?:power point|outlet|socket)\b[^?\n]{0,35}\bcharge\b[^?\n]{0,25}\b(?:EV|electric (?:car|vehicle))\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes, many EVs can charge from a normal power point using the car maker's approved portable charging cable, but it is slow. Use a sound, correctly protected outlet directly, never a power board or extension lead, and stop if the plug or outlet becomes hot or damaged. For regular charging, have an electrician check the circuit; a dedicated home charger is faster and usually the better long-term setup.",
      practicalSteps: [],
    });
  }

  if (/\bcan\s+i\s+charge\b[^?\n]{0,30}\b(?:my|an?)\s+(?:EV|electric (?:car|vehicle))\b[^?\n]{0,30}\b(?:from|with|using)\b[^?\n]{0,20}\bsolar\b|\bcharge\b[^?\n]{0,30}\b(?:EV|electric (?:car|vehicle))\b[^?\n]{0,30}\bsolar\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Yes. The simplest option is to charge while the sun is up; a solar-aware home charger can automatically follow spare solar so it does not pull as much from the grid. Charging speed will rise and fall with surplus generation, and the grid can make up any shortfall if allowed. Check the charger's solar-control feature, the car's AC limit and how often the car is home during daylight.",
      practicalSteps: [],
    });
  }

  if (/\bdo\s+i\s+need\b[^?\n]{0,25}\b(?:a\s+)?home\s+(?:EV|electric (?:car|vehicle))?\s*charger\b|\bdo\s+i\s+need\b[^?\n]{0,25}\b(?:wallbox|dedicated charger)\b[^?\n]{0,25}\b(?:EV|electric (?:car|vehicle))?\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Not always. A normal power point may replace a small daily drive if the car is parked for long enough, but it is slow. A dedicated home charger is worthwhile when you drive more, need reliable overnight charging, want to follow solar or cheap tariff hours, or want load management. Have an electrician check the switchboard, circuit and cable route before choosing the charger size.",
      practicalSteps: [],
    });
  }

  const evChargerPower = message.match(/\b(\d+(?:\.\d+)?)\s*kW\s+(?:home\s+)?(?:EV\s+)?charger\b/i)?.[1];
  if (evChargerPower && /\bhow (?:fast|quickly|long)\b[^?\n]{0,55}\bcharg(?:e|er|ing)\b|\bcharg(?:e|er|ing)\b[^?\n]{0,55}\bhow (?:fast|quickly|long)\b/i.test(message)) {
    return answer(base, {
      directAnswer: `A ${evChargerPower} kW charger can add up to about ${evChargerPower} kWh to the battery each hour before charging losses, but the car may accept less. Use: charging time in hours = energy needed in kWh ÷ the actual charging power in kW, then allow for losses. Actual power is capped by the charger's output, the vehicle's onboard AC charging limit and any supply or load-management limit. What are the vehicle's usable battery capacity, starting and target battery percentages, and onboard AC charging limit?`,
      practicalSteps: [],
    });
  }

  const alreadyHasThreePhaseForEv = /\b(?:have|has|already (?:have|has))\s+three[- ]?phase\b/i.test(text)
    && /\bEV charger\b/i.test(text);
  const disputedThreePhaseEvClaim = isThreePhaseSupplyUpgradeQuestion(text)
    && /\b(?:EV charger|electric vehicle charger|EVSE|wallbox)\b/i.test(text)
    && /\b(?:installer|electrician|salesperson|quote)\b/i.test(text)
    && /\b(?:automatic(?:ally)?|must|need(?:ed)?|require[sd]?)\b/i.test(text);
  if (disputedThreePhaseEvClaim && !alreadyHasThreePhaseForEv) {
    const chargerPower = text.match(/\b(\d+(?:\.\d+)?)\s*kW\b/i)?.[1];
    const chargerLabel = chargerPower ? `A ${chargerPower} kW EV charger` : "An EV charger";
    return answer(base, {
      directAnswer: `No, not automatically. ${chargerLabel} plus solar does not by itself prove the home needs a three-phase upgrade. A licensed electrician should check the existing supply and switchboard, calculate the combined household load and confirm the charger limit, solar inverter and any network requirement. Ask the installer to put that calculation and the exact reason for the upgrade in writing before you agree to it.`,
      practicalSteps: [],
      confidence: "high",
    });
  }
  if (isThreePhaseSupplyUpgradeQuestion(text) && !alreadyHasThreePhaseForEv) return null;

  if (asksAboutAirConditionerWater) {
    return answer(base, {
      directAnswer: "Water dripping from the indoor air-conditioner unit is not normal. It can come from a blocked or kinked condensate drain, a dirty filter causing ice, or an installation fault. Water from the drain outlet or beneath the outdoor unit can be normal condensate, especially in heating mode. Switch the system off if water is reaching electrics or the ceiling, and arrange a service if indoor dripping persists.",
      practicalSteps: [],
    });
  }

  const reverseCycleUseJump = text.match(/\bfrom\s+(\d[\d,]*(?:\.\d+)?)\s*kWh\s+to\s+(\d[\d,]*(?:\.\d+)?)\s*kWh\b/i);
  if (reverseCycleUseJump
    && /\b(?:reverse[- ]?cycle|air conditioner|air con|split system|heating)\b/i.test(text)
    && /\b(?:jump(?:ed)?|increas(?:e|ed)|rose|risen|went up|higher|check first)\b/i.test(text)) {
    const previousUse = Number(reverseCycleUseJump[1].replace(/,/g, ""));
    const currentUse = Number(reverseCycleUseJump[2].replace(/,/g, ""));
    if (previousUse > 0 && currentUse > previousUse) {
      const percentageIncrease = Math.round(((currentUse - previousUse) / previousUse) * 100);
      return answer(base, {
        directAnswer: `Your reverse-cycle heating use rose from ${previousUse.toLocaleString("en-AU")} kWh to ${currentUse.toLocaleString("en-AU")} kWh, up about ${percentageIncrease}%. First check that both periods cover the same number of days and use actual meter readings. Then check whether the heater ran longer, the temperature was set higher, more rooms were heated, the weather was colder or the filter was dirty. A tariff change can lift the dollar bill, but it cannot explain the kWh jump.`,
        practicalSteps: [],
      });
    }
  }

  if (/\b(?:plug[- ]?in|portable)\s+(?:electric\s+)?heater\b/i.test(text)
    && /\b(?:reverse[- ]?cycle\s+split|split system)\b/i.test(text)
    && /\b(?:cheap(?:er)?|cost|run|better|efficient)\b/i.test(text)) {
    const bedroom = text.match(new RegExp(`\\bbedroom\\s+(\\d+|${NUMBER_WORD_PATTERN})\\b`, "i"))?.[1];
    return answer(base, {
      directAnswer: `For ${bedroom ? `bedroom ${bedroom}` : "regular room heating"}, a reverse-cycle split is usually much cheaper to run. It moves heat into the room instead of making all its heat directly from electricity, so it normally uses far less power for the same comfort. A plug-in electric heater avoids installation cost and can make sense for very short, occasional use, but it is normally the expensive option for regular heating.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:reverse[- ]?cycle|air conditioner|air con|ducted|split system)\b/i.test(text)
    && /\b(?:warm|heat)\w*\b[^.!?\n]{0,60}\b(?:lounge|living room|one room)\b|\b(?:lounge|living room|one room)\b[^.!?\n]{0,60}\b(?:warm|heat)/i.test(text)
    && /\b(?:bedroom|another room|other room)\b[^.!?\n]{0,80}\b(?:stay|remain|feel|is|stays)\w*\s+(?:too\s+)?cold\b/i.test(text)) {
    return answer(base, {
      directAnswer: "The bedroom is probably receiving less warm air than the lounge or losing heat faster. Clean the filter, fully open and clear any bedroom outlet, and check the door gap, window draughts and insulation. A wall split may not move enough heat around corners or through a closed doorway; if it is ducted and the airflow is weak, ask the installer to balance the outlets and check the ductwork.",
      practicalSteps: [],
    });
  }

  if (/\bbedroom\b[^?\n]{0,80}\b(?:colder|cooler)\b[^?\n]{0,60}\b(?:lounge|living room)\b|\b(?:lounge|living room)\b[^?\n]{0,60}\b(?:warmer|hotter)\b[^?\n]{0,80}\bbedroom\b/i.test(text)) {
    return answer(base, {
      directAnswer: "The bedroom is probably getting less warm air than the lounge, losing heat faster, or both. Check whether the difference changes with the bedroom door open, make sure the heater filter and any bedroom outlet are clean and unobstructed, then feel for draughts around the window and door. Close-fitting window coverings and complete insulation help if the room itself loses heat quickly. If a ducted outlet has weak airflow, ask the installer to check the duct and balance the system.",
      practicalSteps: [],
    });
  }

  if (/\b(?:strata|owners corporation|body corporate)\b/i.test(text)
    && /\b(?:outdoor|external)\b[^.!?\n]{0,80}\b(?:heat[- ]?pump|air conditioner|air con|unit)\b|\b(?:heat[- ]?pump|air conditioner|air con|unit)\b[^.!?\n]{0,80}\b(?:outdoor|external)\b/i.test(text)
    && /\b(?:install|approval|approve|permission)\w*\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Usually, yes. Treat an outdoor heat-pump or air-conditioner unit as needing written strata or owners corporation approval unless they confirm otherwise, because the unit, wall penetrations, drainage, noise and external appearance may affect common property or by-laws. Give them the proposed location, a simple drawing, the model's noise details and the installer's pipe, drain and electrical route before booking the work.",
      practicalSteps: [],
    });
  }

  if (/\b(?:rent|renter|tenant)\b/i.test(text) && /\b(?:what can|can i|options|do|upgrade|save|comfort|cold|draught|draft|window)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "As a renter, start with changes you can take with you. Use removable fixes such as a door snake, peel-off weather seals that suit the surface, and close-fitting curtains or no-drill honeycomb blinds. Ask the owner or agent in writing before using sealant, screws, fixed blinds or anything that permanently changes the property. Report damaged window seals, frames or other building faults and ask for them to be repaired.",
      practicalSteps: [],
    });
  }

  if (/\b(?:draughts?|drafts?|air leaks?)\b/i.test(text) && !COLD_HOME_SYMPTOM.test(message)) {
    return answer(base, {
      directAnswer: "Start by sealing the gaps that are actually letting air into the room. Check around opening windows, the door and obvious fixed cracks on a windy day. Use removable weather seals or a door snake, and suitable sealant only on fixed gaps. Do not block exhausts or required vents. If the glass feels cold but no air is moving, close-fitting honeycomb blinds or thermal curtains will help more than extra sealing.",
      practicalSteps: [],
    });
  }

  if (/\b(?:import(?:ed|ing|s)?|buy|bought)\b[\s\S]{0,100}\b(?:export(?:ed|ing|s)?|send|sent)\b[\s\S]{0,160}\b(?:battery|storage)\b|\b(?:battery|storage)\b[\s\S]{0,160}\b(?:import(?:ed|ing|s)?|buy|bought)\b[\s\S]{0,100}\b(?:export(?:ed|ing|s)?|send|sent)\b/i.test(text)
    && /\b(?:worth|worthwhile|save enough|payback|pay back)\b/i.test(text)) {
    const importedKwh = text.match(/\bimport(?:ed|ing|s)?\s+([\d,]+(?:\.\d+)?)\s*kWh\b/i)?.[1];
    const exportedKwh = text.match(/\bexport(?:ed|ing|s)?\s+([\d,]+(?:\.\d+)?)\s*kWh\b/i)?.[1];
    const yearlyBill = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:a|per|each)?\s*year/i)?.[1];
    const billLabel = yearlyBill ? `$${Number(yearlyBill.replace(/,/g, "")).toLocaleString("en-AU")}` : "the annual grid bill";
    return answer(base, {
      directAnswer: importedKwh && exportedKwh
        ? yearlyBill
          ? `Probably not on bill savings alone unless the battery is unusually cheap. You imported ${importedKwh} kWh, exported ${exportedKwh} kWh of spare solar and paid only about ${billLabel} for the year, so ${billLabel} is close to the absolute yearly saving ceiling before fixed charges, battery losses and remaining imports. Timing matters too: compare half-hourly imports and solar exports, the installed battery price, payback and warranty. Value backup separately if you want it.`
          : `Those yearly totals alone do not prove a battery will pay off. You imported ${importedKwh} kWh and exported ${exportedKwh} kWh of spare solar, but timing matters: a battery can only replace electricity bought in the evening or after sunset with spare daytime solar available earlier. Compare half-hourly imports and exports, the import and feed-in rates, installed battery price, losses, payback and warranty.`
        : `Probably not on bill savings alone unless the battery is unusually cheap. With only about ${billLabel} a year currently paid for grid electricity, ${billLabel} is close to the absolute yearly saving ceiling before allowing for the supply charge, battery losses and electricity that would still be imported. Compare the installed battery price with a conservative yearly saving and require the payback to fit comfortably inside the warranted life; value backup separately if you want it.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:concrete )?slab(?: on ground)?\b/i.test(text)
    && /\b(?:underfloor|floor insulation)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, ordinary underfloor batts are not a practical retrofit beneath a concrete slab on ground because there is no accessible floor cavity. Focus on confirmed draughts, exposed slab edges, rugs for comfort and the room's heating and window losses. Any slab-edge or floor rebuild insulation needs project-specific design before work starts.",
      practicalSteps: [],
    });
  }

  if (/\b(?:suspended|raised)\s+floor\b|\b(?:accessible|access)\b[^.!?\n]{0,70}\b(?:underneath|underfloor|subfloor)\b|\b(?:underneath|underfloor|subfloor)\b[^.!?\n]{0,70}\b(?:accessible|access)\b/i.test(text)
    && /\b(?:cold|worth|help|insulat|accessible|underneath)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, underfloor insulation can help a cold room above an accessible suspended floor. It needs to fit continuously against the underside of the floor without gaps or compression and be securely supported so it does not sag. Before work starts, check for moisture, plumbing leaks, wiring, termite inspection paths and safe access; fix damp first and keep required clearances around services.",
      practicalSteps: [],
    });
  }

  if (/\bSTCs?\b/i.test(text)
    && /\bVEECs?\b/i.test(text)
    && /\b(?:worth|value|rate|fees?|today|current|quote)\b/i.test(text)) {
    const stcRate = text.match(/\bSTCs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    const veecRate = text.match(/\bVEECs?\b\s*(?:at|=|worth|valued at)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    const quotedRates = stcRate && veecRate
      ? `The quoted $${stcRate} per STC and $${veecRate} per VEEC`
      : "The quoted STC and VEEC rates";
    return answer(base, {
      directAnswer: `${quotedRates} cannot be confirmed as current from the quote alone because both certificate markets change. The quote should show each certificate quantity, gross rate, registration, compliance or brokerage fees and the net credit actually taken off the price. Compare those net figures with current official scheme rules and same-day market references before signing.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:rebates?|incentives?|grants?|discounts?)\b/i.test(text)
    && /\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\b(?:postcode\s*)?3\d{3}\b/i.test(text)) {
    const postcode = text.match(/\b(?:postcode\s*)?(3\d{3})\b/i)?.[1] || "the supplied postcode";
    return answer(base, {
      directAnswer: `For postcode ${postcode} in Victoria, federal certificates and Victorian programme support may reduce the price of an eligible heat-pump hot-water installation. Eligibility cannot be confirmed until the exact approved model, installation date, customer and property rules, installer requirements and any existing claims are checked against current official sources. Treat any rebate shown before a model is chosen as conditional, not guaranteed.`,
      practicalSteps: [],
      suggestedQuestion: "What exact model and installed price are you considering?",
    });
  }

  if (/\b(?:battery|storage)\b/i.test(text)
    && /\b(?:finance|financed|repay|repayment|paid? off|interest[- ]?free|over\s+\w+\s+years?)\b/i.test(text)
    && /\bsolar\b/i.test(text)) {
    const total = extractFinancedProjectPrice(text);
    const solarSize = text.match(/\b(\d+(?:\.\d+)?)\s*kW\b/i)?.[1];
    const batterySize = text.match(/\b(\d+(?:\.\d+)?)\s*kWh\s+battery\b/i)?.[1]
      || text.match(/\bbattery\b[^.!?\n]{0,30}\b(\d+(?:\.\d+)?)\s*kWh\b/i)?.[1];
    const financeYears = extractYears(text);
    const systemDescription = [
      solarSize ? `${solarSize} kW of solar` : "the quoted solar system",
      batterySize ? `a ${batterySize} kWh battery` : "the quoted battery",
    ].join(" paired with ");
    return answer(base, {
      directAnswer: `${total ? `$${Number(total.replace(/,/g, "")).toLocaleString("en-AU")} may be reasonable or poor; the finance and sizing decide it.` : "The system price is not supplied, so the finance cannot be judged from a yearly electricity bill."} For ${systemDescription}, confirm the roof layout, export limit, expected solar use and usable battery capacity. Compare the cash price with every repayment including interest and fees, then compare that total with conservative yearly bill savings and the battery warranty. ${financeYears ? `A ${financeYears}-year payment term` : "The payment term"} is not proof of the same payback period.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\$\s*[\d,]+/i.test(text)
    && /\$\s*\d+(?:\.\d{1,2})?\s*(?:a|per)\s*month\b/i.test(text)
    && /\b\w+\s+years?\b/i.test(text)) {
    const prices = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((match) => Number(match[1].replace(/,/g, "")));
    const monthly = Number(text.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:a|per)\s*month/i)?.[1] || 0);
    const yearWord = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i)?.[1]?.toLowerCase();
    const wordYears: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const years = yearWord ? (Number(yearWord) || wordYears[yearWord] || 0) : 0;
    const repayments = monthly && years ? monthly * 12 * years : 0;
    const quotedTotal = Math.max(...prices, 0);
    return answer(base, {
      directAnswer: `${monthly && years ? `$${monthly.toLocaleString("en-AU")} a month for ${years} years totals $${repayments.toLocaleString("en-AU")}` : "The repayment total must be calculated"}${quotedTotal ? `, which does not equal the quoted $${quotedTotal.toLocaleString("en-AU")}` : ""}, so the finance or rebate explanation is incomplete. Ask for the cash price, total financed amount, every fee and the certificate or rebate deduction in one written breakdown. Check the claimed gas saving against actual gas used for hot water, and include any gas supply charge only if removing hot water lets you disconnect gas completely.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\b(?:same|looks? like the same)\b[^.!?\n]{0,80}\b(?:unit|model|product)\b/i.test(text)
    && /\$\s*[\d,]+[\s\S]{0,80}\$\s*[\d,]+/i.test(text)) {
    return answer(base, {
      directAnswer: "A large price spread for the same heat-pump hot-water unit usually means the scopes are not actually the same. Compare an itemised final price after rebates or certificates, tank and model, removal of the old system, plumbing, valves, drainage, electrical circuit, switchboard work, access, permits, commissioning and disposal. Also compare workmanship warranty, manufacturer warranty, local parts and after-sales service. The cheapest quote is only cheaper if all of that is genuinely equivalent.",
      practicalSteps: [],
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(text)
    && /\b(?:blows? (?:very )?hard|airflow noise|noisy|noise)\b/i.test(text)) {
    const temperatureSetting = extractTemperatureSetting(text);
    return answer(base, {
      directAnswer: `${temperatureSetting ? `It is worth checking, and the ${temperatureSetting}°C setting is one clue.` : "It is worth checking."} Confirm the system is in heating mode, set it around 20 to 21°C, use low or auto fan and open the normal outlets or zones; closing too many outlets can make airflow noisy. If it still blows excessively hard or the outdoor unit runs constantly, call the installer and ask them to check the airflow, duct sizing, zone balance and sensor location.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle|air conditioner|air con)\b/i.test(text)
    && /\b(?:only raises?|barely raises?|won't heat|wont heat|not heating|struggl\w* to (?:reach|heat))\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, do not accept that as normal for a newly installed system without measured commissioning evidence. Ask the installer for the return-air and supply-air temperatures, airflow at the outlets, active-zone setup, refrigerant and defrost checks, and evidence that the unit and ducts match the design. Send a written performance complaint and request the commissioning report and corrective visit rather than buying another heater.",
      practicalSteps: [],
    });
  }

  if (asksAboutHotWeatherCoolingEfficiency) {
    return answer(base, {
      directAnswer: "Yes. Reverse-cycle air conditioning is generally an efficient way to cool a home in hot weather. Use a comfortable temperature, keep the filters clean, close doors and windows, and use blinds or external shade to block direct sun. It will work harder and be less efficient in extreme heat. If it cannot keep the room comfortable, the system may be dirty, undersized or need servicing.",
      practicalSteps: [],
    });
  }

  if (/\b(?:ducted|reverse[- ]?cycle)\b/i.test(text)
    && /\b(?:separate|individual|multiple)\s+split systems?\b|\bsplit systems?\b[\s\S]{0,60}\bducted\b/i.test(text)) {
    const roomCount = extractQuantityBeforeNoun(text, "rooms?");
    return answer(base, {
      directAnswer: `For a home that mainly uses ${roomCount ? `${roomCount} rooms` : "only a few rooms"}, separate split systems are usually the cheaper and more efficient choice because you heat or cool only those rooms and avoid duct losses. Electric ducted reverse cycle is neater and can condition the whole home, but it costs more, loses energy through ducts and can be inefficient when only a small zone is open. Choose ducted for genuine whole-home use; choose splits for room-by-room use and lower running cost.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:induction|cooktop)\b/i.test(text)
    && /\b\d+(?:\.\d+)?\s*(?:amps?|a)\b/i.test(text)
    && /\b(?:share|same|existing)\b[\s\S]{0,80}\b(?:oven|circuit)\b/i.test(text)) {
    const cooktopPower = text.match(/\b(\d+(?:\.\d+)?)\s*kW\b/i)?.[1];
    const circuitAmps = text.match(/\b(\d+(?:\.\d+)?)\s*(?:amps?|a)\b/i)?.[1];
    return answer(base, {
      directAnswer: `No. Do not assume ${cooktopPower ? `a ${cooktopPower} kW cooktop` : "the cooktop"} can share ${circuitAmps ? `the existing ${circuitAmps} A oven circuit` : "the oven circuit"}. It will usually need a dedicated circuit sized for the appliance, or a manufacturer-approved load-limited setting that a licensed electrician confirms is suitable. The electrician must check the cooktop instructions, oven load, cable, breaker, switchboard capacity and cable route before choosing the safe option.`,
      practicalSteps: [],
      confidence: "high",
    });
  }

  if (/\binduction\b/i.test(text)
    && /\b(?:gas|too much power|efficient)\b/i.test(text)
    && /\b(?:electrician|sparky|told|said|claim)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No, that claim is not right. Induction cooking is generally more efficient at transferring energy into the pan than gas and puts less waste heat and combustion pollution into the kitchen. A high-power cooktop may still need a suitable dedicated circuit or a load-limited setting, so the electrical capacity must be checked; that wiring question does not make gas the more efficient cooking technology.",
      practicalSteps: [],
    });
  }

  if (/\b(?:do not|don't|dont|no)\s+suggest\s+(?:a\s+)?dehumidifier\b/i.test(text)
    && /\b(?:condensation|window|glass|surface)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "To warm the room-side glass, start with a close-fitting honeycomb blind or thermal curtain with a pelmet while leaving enough drying space at the edges. Secondary glazing can lift the inside surface temperature more, and full double glazing with a thermally improved frame goes further. Check cold aluminium frames, spacers and installation edges because those thermal bridges can remain the first place condensation forms even after the glass improves.",
      practicalSteps: [],
    });
  }

  if (/\b(?:moisture|condensation|fog(?:ging)?|misting)\b[^.!?\n]{0,90}\bbetween (?:the )?(?:panes|sheets of glass)\b|\bbetween (?:the )?(?:panes|sheets of glass)\b[^.!?\n]{0,90}\b(?:moisture|condensation|fog(?:ging)?|misting)\b/i.test(text)
    && !/\b(?:never|not)\s+between (?:the )?(?:panes|sheets of glass)\b/i.test(text)
    && /\b(?:double[- ]?glaz\w*|window|sealed (?:glass|unit))\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No. Room ventilation cannot clear moisture trapped between the panes of a sealed double-glazed unit. It usually means the edge seal has failed and the sealed glass unit has lost its seal. Photograph it and contact the supplier or installer to check the warranty, or ask a glazier to inspect it. The usual repair is replacement of the sealed glass unit, not more room ventilation.",
      practicalSteps: [],
    });
  }

  if (/\bdouble[- ]?glaz\w*\b/i.test(text)
    && /\bcondensation\b/i.test(text)
    && /\b(?:room side|inside|indoors?)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Not necessarily. Condensation on the room-side surface means indoor humidity has met glass that is still below the dew point; it does not automatically mean the double-glazed unit is faulty. Condensation between the sealed panes is different and can indicate a seal failure. Record indoor temperature and humidity, check exhaust and heating, and photograph the location; if moisture is between the panes, raise it with the installer under warranty.",
      practicalSteps: [],
    });
  }

  const dailyUseRange = text.match(/\b(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*kWh(?:\s*(?:a|per)\s*day)?\b/i);
  const solarOptions = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*kW\b/gi)]
    .map((match) => match[1]);
  if (dailyUseRange && /\bsolar\b/i.test(text) && solarOptions.length >= 2) {
    const [smallerOption, largerOption] = [...solarOptions].sort((left, right) => Number(left) - Number(right));
    return answer(base, {
      directAnswer: `At only ${dailyUseRange[1]} to ${dailyUseRange[2]} kWh a day, ${smallerOption} kW is already large for today's use. The ${largerOption} kW option can still be sensible if its extra cost is modest and you expect an EV, heat-pump hot water, electric heating or other electrification, but check roof shade, inverter size and the network export limit first. Compare the extra system cost with realistic extra self-use and export income; bigger is not automatically the better payback.`,
      practicalSteps: [],
    });
  }

  const annualUse = text.match(/\b(?:use|usage|consumption)?\s*(?:about|around|roughly)?\s*(\d[\d,]*(?:\.\d+)?)\s*kWh\s+(?:a|per|each)\s+year\b/i)?.[1];
  const proposedSolar = text.match(/\b(?:recommend(?:s|ed)?|propos(?:e|es|ed)|quote(?:s|d)?)\b[^.!?\n]{0,70}\b(\d+(?:\.\d+)?)\s*kW\s+(?:of\s+)?solar\b/i)?.[1]
    || text.match(/\b(\d+(?:\.\d+)?)\s*kW\s+(?:of\s+)?solar\b/i)?.[1];
  if (annualUse && proposedSolar && /\b(?:oversiz(?:e|ed)|too (?:large|big)|large|size)\b/i.test(text)) {
    return answer(base, {
      directAnswer: `${proposedSolar} kW of solar is large beside about ${annualUse} kWh a year of current electricity use, so much of its output is likely to be exported. It may still make sense if the roof is suitable, the extra cost is modest and future loads such as an EV, heat-pump hot water or more electric heating are planned. Check the network export limit, shade and a written generation-and-self-use estimate before accepting the size.`,
      practicalSteps: [],
    });
  }

  const batteryPrice = extractBatteryPurchasePrice(text);
  const batteryCapacity = text.match(/\b(\d+(?:\.\d+)?)\s*kWh\s+(?:home\s+)?battery\b/i)?.[1]
    || text.match(/\bbattery\b[^.!?\n]{0,45}\b(\d+(?:\.\d+)?)\s*kWh\b/i)?.[1];
  const batteryYearlyBill = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:a|per|each)?\s*year/i)?.[1];
  if (!batteryPrice && batteryCapacity && batteryYearlyBill
    && /\bbatter(?:y|ies)\b/i.test(text)
    && /\b(?:worth|worthwhile|save enough|payback|good value)\b/i.test(text)) {
    const bill = Number(batteryYearlyBill.replace(/,/g, ""));
    return answer(base, {
      directAnswer: `Probably not on bill savings alone. With a ${batteryCapacity} kWh battery and only about $${bill.toLocaleString("en-AU")} a year currently paid for grid electricity, $${bill.toLocaleString("en-AU")} is close to the absolute yearly saving ceiling before fixed charges, battery losses and remaining imports. Compare the actual installed battery price with a conservative yearly saving and require the payback to fit inside the warranty. Value backup separately if you want it.`,
      practicalSteps: [],
    });
  }
  if (batteryPrice && batteryCapacity
    && /\bbatter(?:y|ies)\b/i.test(text)
    && /\b(?:fair|quote|worth|worthwhile|save enough|good value|price)\b/i.test(text)) {
    const price = Number(batteryPrice.replace(/,/g, ""));
    const capacity = Number(batteryCapacity);
    const pricePerQuotedKwh = Math.round(price / capacity);
    const opening = batteryYearlyBill
      ? `No, not on bill savings alone. A $${price.toLocaleString("en-AU")} ${batteryCapacity} kWh battery cannot save more than the roughly $${Number(batteryYearlyBill.replace(/,/g, "")).toLocaleString("en-AU")} a year you currently pay, and real savings will be lower.`
      : `$${price.toLocaleString("en-AU")} installed for a ${batteryCapacity} kWh battery is about $${pricePerQuotedKwh.toLocaleString("en-AU")} per quoted kWh, but that alone does not show whether the quote is fair.`;
    return answer(base, {
      directAnswer: `${opening} Check usable rather than headline capacity, the complete installation and backup scope, battery losses, warranty and a conservative yearly saving. The payback should fit comfortably inside the warranted life.`,
      practicalSteps: [],
    });
  }

  const freeHours = text.match(new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+(?:\\.\\d+)?)[ -]?hours?\\s+(?:of\\s+)?free(?:[- ](?:power|electricity))?\\b`, "i"))?.[1]
    || text.match(new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+(?:\\.\\d+)?)\\s+free[ -]?hours?\\b`, "i"))?.[1];
  const eveningRate = text.match(/\b(\d+(?:\.\d+)?)\s*(?:cents?|c)\s+(?:\/|per)\s*kWh\b/i)?.[1];
  if (freeHours
    && /\b(?:plan|tariff|rate)\b/i.test(text)
    && /\b(?:solar|battery)\b/i.test(text)
    && !/\$\s*\d|\b(?:plan|retailer)\s+credit\b|\bmaximum\b[^.!?\n]{0,35}\bgrid import\b/i.test(text)) {
    const freeHourCount = numericQuantity(freeHours) || freeHours;
    const freeHoursBatteryCapacity = text.match(/\b(\d+(?:\.\d+)?)\s*kWh\s+(?:home\s+)?battery\b/i)?.[1]
      || text.match(/\bbattery\b[^.!?\n]{0,45}\b(\d+(?:\.\d+)?)\s*kWh\b/i)?.[1];
    const freeHoursSolarSize = extractSolarSize(text);
    return answer(base, {
      directAnswer: eveningRate
        ? `The ${freeHourCount} free hours can help if you can shift hot water, EV charging or battery charging into that window, but ${eveningRate} cents per kWh in the evening is expensive. Judge the whole tariff: include the daily supply charge, rates outside the free window, solar export credit and how much evening use the battery can actually cover. It is a good plan only if your full-year bill is lower, not because the free period sounds attractive.`
        : `Yes, the ${freeHourCount}-hour free-power window may help, especially in winter when heating lifts your grid use. A ${freeHoursBatteryCapacity ? `${freeHoursBatteryCapacity} kWh battery` : "battery"} can charge during that window and cover some later heating use, while the ${freeHoursSolarSize ? `${freeHoursSolarSize} kW solar system` : "solar system"} still helps during daylight. Compare the whole tariff, including the daily supply charge, paid peak and off-window rates, solar export credit and any conditions. Switch only if the full-year bill is lower.`,
      practicalSteps: [],
    });
  }

  const legacyTariffRate = text.match(/\b(\d+(?:\.\d+)?)\s*(?:cents?|c)\b/i)?.[1];
  if (legacyTariffRate
    && /\bfeed[- ]?in tariff\b/i.test(text)
    && /\b(?:broken|faulty|replace)\b/i.test(text)) {
    const remainingYears = text.match(new RegExp(`\\b(?:still\\s+(?:have|has)|remaining|another|next)\\s+(\\d+|${NUMBER_WORD_PATTERN})\\s+years?\\b`, "i"))?.[1]
      || extractYears(text);
    return answer(base, {
      directAnswer: `Do not authorise replacement until the ${legacyTariffRate} cent legacy feed-in tariff is protected. A whole-system change, inverter change or capacity increase may end the old tariff even when an insurer is paying. Ask the retailer, distributor and insurer for written confirmation of exactly what can be repaired or replaced without losing ${remainingYears ? `the remaining ${remainingYears} years` : "the remaining legacy tariff term"}, and have an accredited solar electrician document whether the failed panel can be matched or safely isolated.`,
      practicalSteps: [],
    });
  }

  const comparedFeedInRate = text.match(/\b(\d+(?:\.\d+)?)\s*(?:cents?|c)\s+feed[- ]?in tariff\b/i)?.[1];
  if (/\b(?:best|highest)\b[\s\S]{0,80}\bfeed[- ]?in tariff\b|\bfeed[- ]?in tariff\b[\s\S]{0,100}\b(?:automatically|always)\b[\s\S]{0,20}\bbest\b/i.test(text)) {
    return answer(base, {
      directAnswer: `No. ${comparedFeedInRate ? `A ${comparedFeedInRate} cent feed-in tariff is ` : "The highest feed-in tariff is "}not automatically the best plan. Because you still import power at night, the night import rate, daily supply charge, time-of-use periods, export caps and any higher rates attached to the headline feed-in tariff can outweigh the extra solar credit. Compare the total yearly cost using your actual imports and exports; the best plan is the lowest annual bill, not the biggest advertised feed-in number.`,
      practicalSteps: [],
    });
  }

  if (/\bEV charger\b/i.test(text)
    && /\bthree[- ]?phase\b/i.test(text)
    && /\bsolar\b/i.test(text)) {
    const solarSize = extractSolarSize(text);
    const noHomeBattery = /\bno\s+(?:home\s+)?batter(?:y|ies)\b/i.test(text);
    return answer(base, {
      directAnswer: `Choose a smart, solar-aware EV charger rather than simply the fastest three-phase unit. ${noHomeBattery ? "Because you have no home battery, it can send spare solar straight into the car instead of exporting it." : "It should follow solar surplus when the car is home."} It should also support site load management so the house does not exceed its supply. Check the vehicle's onboard AC charging limit because a higher-powered charger cannot make the car accept more than that limit. Have an electrician confirm the switchboard, protection, cable route and whether single- or three-phase charging best matches ${solarSize ? `the ${solarSize} kW solar system` : "the solar system"}.`,
      practicalSteps: [],
    });
  }

  const hotWaterTankSize = text.match(/\b(\d+(?:\.\d+)?)\s*(?:litres?|liters?|L)\b/i)?.[1];
  const hotWaterHouseholdSize = extractHouseholdSize(text);
  const hotWaterServicePostcode = text.match(/\bpostcode\s*(\d{4})\b/i)?.[1];
  const heatPumpBedroomDistance = text.match(/\b(\d+(?:\.\d+)?)\s*metres?\b[^.!?\n]{0,100}\bbedroom(?: window)?\b/i)?.[1];
  if (/\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water heat[- ]?pump|heat[- ]?pump)\b/i.test(text)
    && /\b(?:bedroom|noise|sound|noisy)\b/i.test(text)
    && /\b(?:judge|check|assess|acceptable|suitable|too (?:loud|close|noisy))\b/i.test(text)) {
    return answer(base, {
      directAnswer: `${heatPumpBedroomDistance ? `${heatPumpBedroomDistance} metres from a bedroom window is not enough information to judge the noise.` : "Distance from the bedroom alone is not enough to judge the noise."} Ask for the exact model's published sound data, then have the installer assess the proposed location and confirm in writing how it will sound at the bedroom window and property boundary. Check vibration-isolating mounts, nearby walls that can reflect sound, normal run times and any night mode. If the evidence is not convincing, relocate the unit before installation.`,
      practicalSteps: [],
    });
  }

  if (hotWaterTankSize
    && hotWaterHouseholdSize
    && /\b(?:brand|reliable|installer|service)\b/i.test(text)) {
    return answer(base, {
      directAnswer: `A ${hotWaterTankSize} litre heat-pump hot-water unit may be enough for ${hotWaterHouseholdSize} people, but confirm usable hot-water volume and recovery against consecutive showers, baths and morning or evening peaks. Judge reliability from the full warranty, labour coverage, local parts, qualified service network, noise and cold-weather recovery, not the brand name alone. Use licensed installers who service ${hotWaterServicePostcode ? `postcode ${hotWaterServicePostcode}` : "your postcode"} and compare itemised quotes for plumbing, electrical work, removal, drainage and commissioning; Surge can help send one enquiry to relevant local trades.`,
      practicalSteps: [],
    });
  }

  if (hotWaterTankSize
    && hotWaterHouseholdSize
    && /\b(?:heat[- ]?pump|hot[- ]?water)\b/i.test(text)
    && /\b(?:enough|size|suit(?:able)?|adequate)\b/i.test(text)) {
    const people = numericQuantity(hotWaterHouseholdSize);
    const litresPerPerson = people ? Number(hotWaterTankSize) / people : 0;
    const verdict = litresPerPerson >= 75
      ? "is likely enough"
      : litresPerPerson >= 55
        ? "may be enough, but it is not generous"
        : "is borderline and may be too small";
    const suppliedNightShowering = /\b(?:mostly|usually|mainly)\s+shower(?:s|ing)?\s+(?:at|in the)\s+night\b|\bmost\s+showers?\s+(?:are|happen)\s+(?:at|in the)\s+night\b/i.test(text);
    const householdDescription = suppliedNightShowering
      ? `${hotWaterHouseholdSize} people who mostly shower at night`
      : `${hotWaterHouseholdSize} people`;
    return answer(base, {
      directAnswer: `A ${hotWaterTankSize} litre heat-pump hot-water tank ${verdict} for ${householdDescription}. Back-to-back long showers can empty the usable hot water before the heat pump recovers. Confirm the exact model's usable volume, cold-weather recovery and boost settings, and size it for the household's busiest shower period rather than the daily average.`,
      practicalSteps: [],
    });
  }

  if (/\bdehumidifier\b/i.test(text)
    && /\b(?:instead of|replace|without)\b[\s\S]{0,50}\b(?:bathroom )?(?:exhaust|extractor) fan\b|\b(?:bathroom )?(?:exhaust|extractor) fan\b[\s\S]{0,50}\b(?:instead of|replace|without)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "No. Keep using the bathroom exhaust fan while showering and for a short time afterwards because it removes moisture from the home to outside. A dehumidifier can supplement it in winter or help dry the room, but it recirculates indoor air and should not replace a working, correctly ducted exhaust fan or required ventilation.",
      practicalSteps: [],
    });
  }

  if (/\baluminium frames?\b/i.test(text)
    && /\b(?:not|without)\s+thermally broken\b|\bthermal(?:ly)? break\b/i.test(text)) {
    return answer(base, {
      directAnswer: "You generally cannot retrofit a true thermal break into an existing aluminium frame; it is built into the frame profile. Without replacing the windows, reduce the room-side impact with close-fitting honeycomb blinds or lined curtains and a pelmet, manage condensation at the cold frame edges, and consider properly detailed secondary glazing where the opening and drainage allow it. Do not cover weep holes or interfere with seals and hardware.",
      practicalSteps: [],
    });
  }

  const hotWaterTimes = extractClockTimes(text);
  if (/\bheat[- ]?pump\b/i.test(text)
    && /\bhot[- ]?water\b/i.test(text)
    && hotWaterTimes.length >= 2) {
    return answer(base, {
      directAnswer: `The efficiency difference between starting at ${hotWaterTimes[0]} and ${hotWaterTimes[1]} is usually small. Use the window that captures reliable solar and still leaves enough recovery time before the household needs hot water; the earlier time is safer if the tank may need a longer run, while the later time can suit a short top-up on a sunny day. Check the timer, boost behaviour and morning hot-water use before shifting it later.`,
      practicalSteps: [],
    });
  }

  if (/\bdaily (?:electricity )?supply charge\b/i.test(text)
    && /\bsolar\b/i.test(text)
    && /\bbatter(?:y|ies)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, solar can still be worthwhile because it reduces usage charges, but it does not remove the daily supply charge while the home remains grid-connected. Judge the battery separately: it only saves the difference between exporting spare solar and buying power later, and the higher supply charge is still paid either way. Recalculate solar and battery payback from the full current tariff and your actual daytime, evening and winter use.",
      practicalSteps: [],
    });
  }

  if (/\b(?:flat[- ]?rate|single[- ]?rate)\b/i.test(text) && /\b(?:plan|tariff|rate|electricity|energy|pros?|cons?|good|worth|better)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "A flat-rate electricity plan is simple and predictable, but it can cost more if you can move a lot of use into cheap or free hours. For a home with solar or a battery, the daily supply charge, evening import rate and solar export rate can matter more than the headline flat rate. Compare the yearly cost using your actual electricity use, not the retailer's example household.",
      practicalSteps: [],
      suggestedQuestion: "Do you have a recent bill or a full year of electricity use to compare?",
    });
  }

  if (/\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b[^.!?\n]{0,80}\b(?:gas|meter|connection|service)\b|\b(?:gas|meter|connection|service)\b[^.!?\n]{0,80}\b(?:abolish(?:ment)?|disconnect(?:ion)?|remove|lock|plug)\b/i.test(text)) {
    const gasServicePrice = extractGasServicePrice(text);
    const quotedPrice = gasServicePrice ? `$${gasServicePrice}` : "";
    return answer(base, {
      directAnswer: quotedPrice
        ? `${quotedPrice} is high enough that I would not accept it without an itemised explanation and another option. A commercial site can cost more than a house because the distributor may require extra work. If the goal is only to stop using gas, ask whether a meter lock or disconnection is allowed and cheaper. If gas will never be used again, compare that with permanent abolishment.`
        : "A meter lock or disconnection can be the cheaper choice when you only need gas use to stop. Full abolishment permanently removes the service and is more appropriate when gas will never be needed again, but it can involve more distributor work and cost. Ask for both options in writing before approving the job.",
      practicalSteps: [],
      suggestedQuestion: "Is the price from the gas distributor or from a contractor?",
    });
  }

  const solarAge = text.match(new RegExp(`\\b(\\d+|${NUMBER_WORD_PATTERN})[ -]?year[- ]?old\\b`, "i"))?.[1];
  if (new RegExp(`\\b(?:\\d+|${NUMBER_WORD_PATTERN})[ -]?year[- ]?old\\b[^.!?\\n]{0,100}\\b(?:solar|panels?)\\b|\\b(?:solar|panels?)\\b[^.!?\\n]{0,100}\\b(?:outdated|obsolete|too old|replace)\\b`, "i").test(text)) {
    return answer(base, {
      directAnswer: `${solarAge ? `${solarAge}-year-old solar panels` : "Solar panels"} are not automatically outdated. Do not replace working panels only because a salesperson says they are old. Ask for measured evidence of a fault or poor output, and get an independent quote for any battery that can work with the existing system. A full replacement makes sense only when the evidence and itemised savings justify it.`,
      practicalSteps: [],
    });
  }

  if (/\blow[- ]?e\b/i.test(text) && /\b(?:surface|coating|glass|glazing|window)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Surface 4 is the room-side face of the inner pane in a double-glazed unit. A suitable exposed low-E coating can be used there, but not every low-E product is designed for that position. Ask the supplier for the full glass build-up and written confirmation of cleaning limits, condensation performance and warranty. Do not approve it from the words 'surface 4' alone.",
      practicalSteps: [],
    });
  }

  if (/\b(?:honeycomb|cellular)\b/i.test(text)
    && /\b(?:tilt(?:ed)?[- ]?and[- ]?turn|tilt[- ]?turn)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Yes, honeycomb blinds can work on tilt-and-turn windows or doors, but the mounting system matters. Use a no-drill or manufacturer-approved system that moves with the opening section, and check the handle, hinge and seal clearance. Do not drill into the glazing bead or frame unless the window manufacturer confirms in writing that it will not damage the glass, drainage or warranty.",
      practicalSteps: [],
    });
  }

  if (/\b(?:solar|battery)\b/i.test(text) && /\b(?:mortgage|offset|home loan)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Use the mortgage rate as the guaranteed benchmark. Solar or a battery is the better financial choice only if conservative yearly bill savings, after allowing for maintenance and replacement, beat the interest saved over the time you expect to stay. Solar often stacks up before a battery because it costs less and usually lasts longer. Run the comparison from your bills and written quotes, not the seller's headline saving.",
      practicalSteps: [],
      suggestedQuestion: "What are the installed price, expected yearly saving and your mortgage rate?",
    });
  }

  if (/\bsolar\b/i.test(text)
    && /\bshad(?:e|ed|ing)\b/i.test(text)
    && /\b(?:quote|proposal|design|layout)\b/i.test(text)) {
    const shadePercent = text.match(/\b(?:about|around|roughly|approximately)?\s*(\d+(?:\.\d+)?)\s*%/i)?.[1];
    const shadeTime = extractClockTimes(text)[0];
    const roofLabel = /\bnorth(?:ern)?(?:[- ]facing)?\s+roof\b/i.test(text) ? "north roof" : "roof";
    const shadeDescription = [
      shadePercent ? `about ${shadePercent}% of the ${roofLabel}` : `part of the ${roofLabel}`,
      shadeTime ? `after ${shadeTime}` : "during the day",
    ].join(" shaded ");
    return answer(base, {
      directAnswer: `${shadeDescription[0].toUpperCase()}${shadeDescription.slice(1)} will reduce solar generation, but it does not automatically make the quote poor. Ask the installer to show the panel layout, which panels are affected and whether separate panel-level controls are needed. The quote should include a written, site-specific shade analysis and shade-adjusted monthly generation estimate, so you can compare the likely output and price with another layout.`,
      practicalSteps: [],
    });
  }

  const quoteAPrice = text.match(/\bquote\s*A\s*(?:is|=|at|for)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const quoteBPrice = text.match(/\bquote\s*B\s*(?:is|=|at|for)?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  if (quoteAPrice && quoteBPrice && /\bheat[- ]?pump\b/i.test(text)) {
    const quoteA = Number(quoteAPrice.replace(/,/g, ""));
    const quoteB = Number(quoteBPrice.replace(/,/g, ""));
    const difference = Math.abs(quoteB - quoteA);
    return answer(base, {
      directAnswer: `Neither quote is better from price alone. Quote A is $${quoteA.toLocaleString("en-AU")} and Quote B is $${quoteB.toLocaleString("en-AU")}, a $${difference.toLocaleString("en-AU")} difference. Compare them like for like: the exact heat-pump model and size, removal, plumbing, valves and drainage, electrical and switchboard work, commissioning, exclusions, workmanship warranty and after-sales support. The cheaper quote is better only if it covers the same job without important omissions.`,
      practicalSteps: [],
    });
  }

  if (/\b(?:quotes?|quoted|quotation|proposal|invoice|cheaper one|expensive one|dearer one)\b/i.test(text)) {
    return quoteAnswer(base, text);
  }

  if (/\b(?:power|electricity|energy) bill\b.*\b(?:high|higher|huge|expensive|jumped|increased|gone up|reduce|lower|save)\b|\b(?:reduce|lower|cut)\b.*\b(?:power|electricity|energy) bills?\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start by finding what is using the most electricity. Do not buy equipment until you know whether the main cost is heating and cooling, hot water, a pool, an EV, or the electricity plan itself.",
      practicalSteps: [
        "Compare electricity use in kWh with the same period last year, not just the dollar total.",
        "Check the daily supply charge and when higher usage rates apply.",
        "Test the biggest appliance or system first instead of chasing small standby loads.",
      ],
      suggestedQuestion: "Which is your biggest concern: a sudden bill jump, high winter use, high summer use, or high use all year?",
    });
  }

  if (/\b(?:battery|home storage)\b/i.test(text) && /\b(?:worth|should|buy|good value|make sense|pay back|payback)\b/i.test(text)) {
    const noSolar = /no (?:rooftop )?solar/i.test(solar);
    const quotedPrice = batteryPrice;
    const quotedCapacity = batteryCapacity;
    const price = quotedPrice ? Number(quotedPrice.replace(/,/g, "")) : 0;
    const capacity = quotedCapacity ? Number(quotedCapacity) : 0;
    const pricePerKwh = price > 0 && capacity > 0 ? Math.round(price / capacity) : 0;
    return answer(base, {
      directAnswer: noSolar
        ? "No, a home battery is unlikely to be your best first step while you have no rooftop solar. Reduce the home's main energy costs and assess solar first."
        : !pricePerKwh && quotedCapacity && batteryYearlyBill
          ? `Probably not on bill savings alone. With a ${quotedCapacity} kWh battery and only about $${Number(batteryYearlyBill.replace(/,/g, "")).toLocaleString("en-AU")} a year currently paid for grid electricity, that bill is close to the absolute yearly saving ceiling before fixed charges, battery losses and remaining imports. Compare the installed price with a conservative yearly saving and require the payback to fit inside the warranty.`
        : pricePerKwh
          ? `That works out to about $${pricePerKwh.toLocaleString("en-AU")} per quoted kWh. I would treat it as worth comparing, not an automatic yes. The deal is good only if the usable energy, full installation, warranty and realistic yearly bill saving give a payback shorter than the battery's warranted life.`
          : "Maybe, but a battery is usually worthwhile only when you regularly export spare solar and then buy a lot of electricity after sunset. A rebate can improve the numbers, but it does not make every battery good value.",
      practicalSteps: noSolar ? [
        "Find the home's biggest electricity costs first.",
        "Check whether suitable rooftop solar is possible.",
        "Revisit a battery after you know likely solar exports and evening use.",
      ] : [
        "Check how many kWh of solar you export on a typical day.",
        "Compare that with evening and overnight electricity use.",
        "Price backup power separately because it may add cost.",
      ],
      suggestedQuestion: noSolar
        ? "Do you want help checking whether solar suits the property?"
        : pricePerKwh
          ? "What exact battery model and installed items are included?"
          : "How much solar do you export on a typical day?",
    });
  }

  if (/\b(?:condensation|water on (?:the )?(?:glass|windows?)|wet windows?|mould|mold)\b/i.test(text)
    && !COLD_HOME_SYMPTOM.test(message)
    && !surgeHasRecentResolvedMoistureConcern(message, recentTurns)) {
    return answer(base, {
      directAnswer: "Start with moisture, not replacement windows. Condensation forms when damp indoor air hits cold glass, so reduce the moisture first and then make the window surface warmer.",
      practicalSteps: [
        "Run bathroom and kitchen exhaust fans while moisture is being made and briefly air the room.",
        "Wipe up water and investigate leaks or persistent mould.",
        "Use close-fitting honeycomb blinds or thermal curtains, but allow the window area to dry.",
      ],
      suggestedQuestion: "Is it mainly in the bedroom, bathroom, kitchen, or several rooms?",
    });
  }

  if (COLD_HOME_SYMPTOM.test(message)) {
    const reportedMoisture = /condensation|damp|mould|mold/i.test(comfort);
    const reportedDraught = userReportedDoorDraught(message, recentTurns);
    const singleGlazing = /single glazed/i.test(glazing);
    const hasBothExhausts = /kitchen/i.test(exhaust) && /bathroom/i.test(exhaust);
    const hasReverseCycle = /air-con|air conditioning|reverse-cycle/i.test(heating);
    if (reportedMoisture) {
      return answer(base, {
        directAnswer: `${reportedDraught ? "The door draught you reported is one heat-loss path" : "A cold home can have several heat-loss paths"}${singleGlazing ? "; your saved answers also show mostly single glazing" : ""}. Because your saved answers also report condensation, damp or mould, keep moisture control first: ${hasBothExhausts ? "run the kitchen and bathroom exhaust fans whenever moisture is produced and check they clear steam" : "use effective kitchen and bathroom exhaust whenever moisture is produced"}, then investigate leaks or persistent mould before sealing more gaps. After that, ${reportedDraught ? "use the door snake and " : "check doors and windows for moving air, seal only confirmed gaps, and use "}close-fitting window coverings${hasReverseCycle ? ", and heat occupied rooms with the existing reverse-cycle system" : ""}.`,
        practicalSteps: [],
      });
    }
    return answer(base, {
      directAnswer: "For better comfort, start with draughts and the coldest windows before buying a bigger heater. If warm air is escaping or the glass is very cold, a larger heater will still waste energy.",
      practicalSteps: [
        "Feel around opening windows and doors for moving air, then seal only confirmed gaps.",
        "Use close-fitting honeycomb blinds or thermal curtains with a pelmet where practical.",
        "Clean the heater filter and heat the occupied room with doors to unused areas closed.",
      ],
      suggestedQuestion: "Does the room feel draughty, have very cold windows, or both?",
    });
  }

  if (/\b(?:bedroom|lounge|room|house|home)\b.*\b(?:too hot|overheat\w*|boiling|hot in summer)\b|\b(?:too hot|overheat\w*|boiling|hot in summer)\b.*\b(?:bedroom|lounge|room|house|home)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Stop summer sun reaching the glass before buying more cooling. Outside shade usually works better than trying to block the heat after it has entered the room.",
      practicalSteps: [
        "Shade sun-exposed windows outside with an awning, blind or suitable planting where allowed.",
        "Close honeycomb blinds or lined curtains before the room heats up.",
        "Use fans first, then run efficient air conditioning with doors and windows closed.",
      ],
      suggestedQuestion: "Is the room hottest in the morning, afternoon, or all day?",
    });
  }

  if (/\b(?:replace|remove|swap|change|keep)\b.*\b(?:gas heater|ducted gas|gas heating)\b|\b(?:gas heater|ducted gas|gas heating)\b.*\b(?:worth|replace|remove|swap|change|keep)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Usually, plan to replace an ageing gas heater with efficient reverse-cycle air conditioning, especially if the gas unit is costly, unreliable or nearing replacement. You do not need to remove a safe working heater immediately if the numbers do not yet stack up.",
      practicalSteps: [
        "Compare current gas use with the likely electricity cost of heating the rooms you actually use.",
        "Get the new system sized for those rooms, not just the floor area.",
        "Include electrical work, gas disconnection, noise and the final installed price.",
      ],
      suggestedQuestion: heating ? "Is the gas heater old, unreliable, or simply expensive to run?" : "What type of gas heater do you have now?",
    });
  }

  if (/\b(?:what size|how big|size should)\b.*\bsolar\b|\bsolar\b.*\b(?:what size|how big|size should)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Size solar from your electricity use, usable roof space and the local export limit. A bigger system can be sensible, but only if the extra generation will be used or exported for enough value."
        + (/no (?:rooftop )?solar/i.test(solar) ? " Your saved details show no rooftop solar now, so this would be a new system." : ""),
      practicalSteps: [
        "Use a full year of electricity bills or half-hourly usage if available.",
        "Check shade, roof direction, roof condition and the network export limit.",
        "Compare annual generation and savings assumptions, not panel count alone.",
      ],
      suggestedQuestion: "Roughly how many kWh of electricity does the home use in a year?",
    });
  }

  if (/\b(?:double glaz\w*|replace (?:my |the )?windows?|new windows?|window upgrade)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Do not jump straight to replacing every window. First fix confirmed draughts and improve window coverings; replacement glazing makes the most sense when windows are leaky, damaged, very cold or already due for replacement.",
      practicalSteps: [
        "Seal moving gaps around opening sections without blocking drainage or required ventilation.",
        "Try close-fitting honeycomb blinds or thermal curtains with pelmets.",
        "For replacement quotes, compare whole-window U-value, frame type, installation and warranty.",
      ],
      suggestedQuestion: "Is the main problem draughts, cold glass, summer sun, or outside noise?",
    });
  }

  if (/\b(?:insulat\w*|ceiling batts?|roof batts?)\b/i.test(text) && /\b(?:should|where|start|worth|upgrade|replace|add|need)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Ceiling insulation is often the first insulation upgrade to check because heat rises in winter and the roof gets very hot in summer. Repairing safe, confirmed gaps can matter as much as adding more insulation everywhere.",
      practicalSteps: [
        "Confirm what insulation is already there, its condition and whether there are gaps.",
        "Fix roof leaks and moisture before adding insulation.",
        "Use a qualified person where electrical wiring, downlights or difficult roof access create risk.",
      ],
      suggestedQuestion: "Do you know whether the ceiling already has insulation?",
    });
  }

  if (/\b(?:heat[- ]pump hot[- ]water|hot[- ]water heat[- ]pump|replace (?:my |the )?(?:gas|electric) hot[- ]water|hot[- ]water system)\b/i.test(text)) {
    const warmClimate = /\b(?:darwin|tropical|hot[- ]?humid|warm climate|humid climate)\b/i.test(text);
    const householdSize = extractHouseholdSize(text);
    return answer(base, {
      directAnswer: warmClimate
        ? `Yes, a heat-pump hot-water system generally suits a warm, humid climate because it can draw heat from the outdoor air efficiently. ${householdSize ? `For a household of ${householdSize}, choose the tank and recovery rate for busy shower times, not the cheapest unit.` : "Choose the tank and recovery rate for the household's busiest shower time."} If you have solar, schedule most heating for daylight hours. Check noise, drainage, warranty and local service before choosing the exact model.`
        : "A well-sized heat-pump hot-water system is often a strong replacement for gas or standard electric hot water, especially if it can run during sunny or cheaper electricity hours. The wrong size or location can still make it noisy or expensive.",
      practicalSteps: [
        "Size the tank for the household and when people shower.",
        "Check outdoor-unit location, noise, drainage and electrical work.",
        "Compare the final installed price after any rebate or certificate discount.",
      ],
      suggestedQuestion: "How many people use hot water in the home?",
    });
  }

  if (/\b(?:ev charger|charge (?:my |an? )?(?:ev|electric car)|home charging)\b/i.test(text)) {
    return answer(base, {
      directAnswer: "Start with how far you drive and how long the car is parked at home. Many drivers can refill overnight from a modest charger, so the fastest charger is not automatically the best choice.",
      practicalSteps: [
        "Work out the usual daily kilometres and the car's battery use.",
        "Ask an electrician to check the switchboard, supply capacity and cable route.",
        "Use solar or cheaper overnight rates where the car and tariff allow it.",
      ],
      suggestedQuestion: "About how many kilometres do you drive on a normal day?",
    });
  }

  if (/\b(?:where|how) (?:do|should|can) i (?:start|begin)\b|\bwhat (?:should i do|comes) first\b/i.test(message)) {
    return answer(base, {
      directAnswer: "Start with the problem that is costing you the most or making the home hardest to live in. Fix obvious safety, leaks and moisture first, then tackle comfort and large energy users before buying solar or a battery.",
      practicalSteps: [
        "Choose the main problem: high bills, cold rooms, hot rooms or condensation.",
        "Check the simplest likely cause before replacing equipment.",
        "Use the result to choose the first upgrade and avoid wasting money.",
      ],
      suggestedQuestion: "What bothers you most right now: bills, cold rooms, hot rooms, or condensation?",
    });
  }

  return null;
}
