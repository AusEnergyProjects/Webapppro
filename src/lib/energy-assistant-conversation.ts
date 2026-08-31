export const SURGE_CONVERSATION_STATE_VERSION = 1 as const;
export const SURGE_MAX_FACTS = 16;
// A retained decision may compare up to three separate subjects. Keep enough
// subject capsules for every bounded decision so a valid comparison is never
// discarded merely because the independent subject cap was smaller.
export const SURGE_MAX_LEDGER_SUBJECTS = 150;
export const SURGE_MAX_LEDGER_DECISIONS = 50;
export const SURGE_MAX_LEDGER_FACTS = 120;
export const SURGE_MAX_LEDGER_OPEN_ITEMS = 16;
export const SURGE_MAX_LEDGER_BYTES = 32_768;
const SURGE_MAX_USER_CONTEXT_CHARS = 640;

export const SURGE_PLAN_CONTEXT_CORRECTION_VALUES = [
  "comfort_moisture_resolved",
  "comfort_draught_resolved",
  "roof_condition_changed",
  "glazing_changed",
  "ceiling_insulation_changed",
  "wall_insulation_changed",
  "floor_insulation_changed",
  "insulation_changed",
  "switchboard_changed",
  "heating_cooling_changed",
  "exhaust_changed",
  "solar_changed",
  "battery_changed",
  "hot_water_changed",
] as const;

export type SurgePlanContextCorrection = typeof SURGE_PLAN_CONTEXT_CORRECTION_VALUES[number];

export type SurgeConversationFact = {
  key: string;
  value: string;
};

export type SurgeConversationLedgerFact = SurgeConversationFact & {
  source: "chat" | "plan" | "derived";
  updatedTurn: number;
};

export type SurgeConversationSubject = {
  id: string;
  kind: "saved_home" | "property" | "person" | "job" | "general";
  label: string;
  facts: SurgeConversationLedgerFact[];
  lastTouchedTurn: number;
};

export type SurgeConversationDecision = {
  id: string;
  subjectIds: string[];
  topic: string;
  goal: string;
  facts: SurgeConversationLedgerFact[];
  outcomeSummary: string;
  openItems: string[];
  pendingQuestion: string;
  status: "open" | "resolved";
  lastTouchedTurn: number;
};

export type SurgeConversationLedger = {
  turn: number;
  activeDecisionId: string;
  subjects: SurgeConversationSubject[];
  decisions: SurgeConversationDecision[];
};

export type SurgeConversationState = {
  version: typeof SURGE_CONVERSATION_STATE_VERSION;
  activeTopic: string;
  goal: string;
  facts: SurgeConversationFact[];
  pendingQuestion: string;
  lastAnswerSummary: string;
  /** Bounded saved-plan corrections that must outlive the rolling raw-turn window. */
  planContextCorrections?: SurgePlanContextCorrection[];
  /** Optional for backward compatibility with already stored version-one sessions. */
  ledger?: SurgeConversationLedger;
};

export type SurgeConversationTurnIntent =
  | "new_question"
  | "contextual_follow_up"
  | "answer_to_follow_up"
  | "clarification"
  | "correction"
  | "topic_change"
  | "correction_and_topic_change";

const CLARIFICATION_PATTERN = /(?:^|\b)(?:huh|what do you mean|what does that mean|how so|why is that|i (?:do not|don't|dont) understand|that (?:does not|doesn't|doesnt) make sense|explain (?:that|it)|say that again|in (?:plain|simple) (?:english|words)|simpler|that['’]?s\s+(?:a\s+)?(?:useless|unhelpful|irrelevant|confusing|rubbish|garbage)(?:\s+(?:answer|reply|response))?|(?:that|this|your)?\s*(?:answer|reply|response)?\s*(?:is|was)?\s*(?:useless|unhelpful|irrelevant|confusing|rubbish|garbage)|(?:you\s+)?(?:did not|didn't|didnt) answer(?: my question)?|not what i asked|answer the question)(?:\b|$)/i;
const CORRECTION_PATTERN = /(?:^\s*|[.!?]\s+)(?:actually|correction|sorry,? (?:i|it|we)|i meant)(?:\b|$)|\b(?:that is wrong|that's wrong|not .{0,36}(?:but|,)|i (?:do not|don't) (?:own|rent|have|use)|i (?:rent|own) rather than)(?:\b|$)/i;
const TOPIC_CHANGE_PATTERN = /(?:(?:^|[.!?]\s*|,\s*)forget\b|\b(?:(?:different|new) (?:question|quote)|change (?:the )?(?:subject|topic)|switch (?:the )?(?:subject|topic)|moving on|instead,? (?:i|what|how|when|can)|anyway,? (?:i|what|how|when|can))\b)/i;
const CONTEXT_REFERENCE_PATTERN = /\b(?:it|its|this|that|these|those|they|them|one|ones|same|other|another|former|latter|above|previous|earlier|instead|more expensive|cheap(?:er|est)|lowest[- ]?cost|tonight|first thing|dearer|bigger|smaller|better|worse|the pro|the select|the (?:battery|quote|system|unit|model|option|plan|tariff|charger|heater|fans?|windows?|room|installer|product|solar panels?|panels?|inverter|blinds?|curtains?|(?:(?:useful|direct|relevant) )?(?:official )?(?:link|page|source|website|guidance|support|programme|program)))\b/i;
const EXPLICIT_TOPIC_REFERENCE_PATTERN = /\b(?:this|that|these|those|same|other|another|former|latter|previous|the)\s+(?:battery|quote|system|unit|model|option|plan|tariff|charger|heater|fans?|windows?|room|installer|product|solar panels?|panels?|inverter|blinds?|curtains?|(?:(?:useful|direct|relevant) )?(?:official )?(?:link|page|source|website|guidance|support|programme|program))\b/i;
const NAMED_TOPIC_ANAPHORA_PATTERN = /\b(?:it|its|this|that|these|those|they|them|same|former|latter|previous)\b/i;
const TRAILING_ADDITIVE_REFERENCE_PATTERN = /\b(?:too|as well)\s*[?.!]*$/i;
const ELLIPTICAL_FOLLOW_UP_PATTERN = /^(?:and|but|so|also|continue|go on|keep going|why|how|what about|how about|does that|is that|is it|would that|should i do that|show me (?:the )?(?:practical )?next step)\b|^(?:okay|ok|right|yes|no|maybe|unsure|not sure)\s*[.!?]*$|^(?:okay|ok|right|yes|no|maybe|unsure|not sure)[,.]?\s+(?:and|but|so|what about|how about|does that|is that|is it|would that|should i do that)\b|^(?:could|would|can)\b[^.!?\n]{0,90}\b(?:help|work|matter)(?:\s+(?:too|as well))?\s*\??$/i;
const GENERIC_NEXT_STEP_PATTERN = /^(?:so\s+)?what should (?:i|we) do (?:first|next|then)?\s*[?.!]*$/i;
const DECISION_FACET_REFERENCE_PATTERN = /\b(?:price|cost|quote|warranty|installation|installer|model|size|capacity|rebate|discount|eligibility|payback|running costs?)\b/i;
const LABELLED_OPTION_REFERENCE_PATTERN = /\b(?:option|quote|model|system)\s+[A-Z0-9][A-Z0-9-]*\b|\b[A-Z]\b(?=[^.!?\n]{0,60}\b(?:worth|price|cost|money|warranty|better|cheaper|dearer|choose|choice)\b)/;
const PRIOR_DECISION_REVISIT_PATTERN = /\b(?:back to|return(?:ing)? to|going back to|do you still think)\b|\b(?:earlier|previous)\s+(?:quote|option|decision|plan|comparison|recommendation|answer)\b|\b(?:that|same)\s+(?:quote|option|decision|plan|comparison|recommendation)\b/i;
const RECALL_PATTERN = /\b(?:remind me|what (?:did|have) (?:i|we) (?:say|tell you|mention|discuss|cover)|what (?:have|did) we (?:discuss|cover|talk about)|what do you remember|what\b[^.!?\n]{0,80}\b(?:(?:did|have)\s+you\s+(?:recommend|suggest|advise|say|tell me)|you\s+(?:recommended|suggested|advised|said|told me))\b|as i (?:said|mentioned|told you)(?: earlier)?|summary of everything so far|everything (?:we have|we['’]ve) covered so far)\b/i;
const OPEN_ENDED_SUBJECT_PATTERN = /^(?:(?:and|also)\s+)?(?:what|how)\s+about\b/i;
const QUESTION_OPENING_PATTERN = /^(?:is|are|am|can|could|should|would|will|do|does|did|what|which|why|how|where|when|who)\b|\?\s*$/i;
const CLEAR_NEW_REQUEST_PATTERN = /^(?:please\s+)?(?:tell|show|explain|help|give|compare|check|review|calculate|work out|find)\b|^(?:let['’]?s|lets)\s+(?:talk|switch)|^(?:i['’]?d|i would)\s+like\s+to\s+(?:ask|talk|know)\b/i;

function explicitlySuppliesPostcode(message: string) {
  const clean = message.trim();
  return /^\d{4}[.!]*$/.test(clean)
    || /^(?:it(?:'s| is)|that(?:'s| is))\s+\d{4}[.!]*$/i.test(clean)
    || /\b(?:post\s*code)(?:\s+is)?\s*[:#=-]?\s*\d{4}\b/i.test(clean)
    || /\b\d{4}\s+(?:post\s*code)\b/i.test(clean)
    || /\b(?:i(?:'m| am)|we(?:'re| are)|live|located|property|home|house|site)\s+(?:is\s+)?(?:in|at)\s+\d{4}\b/i.test(clean);
}

export function surgeMessageAnswersPendingQuestion(message: string, pendingQuestion: string) {
  if (/\bwhich rooms?\b|\broom\b[^?]{0,45}\b(?:hardest|coldest|hottest|comfortable|comfort)\b/i.test(pendingQuestion)) {
    return /\b(?:bedrooms?|lounge|living room|kitchen|bathrooms?|dining room|study|home office|all rooms?|whole house|everywhere|none)\b/i.test(message);
  }
  if (/\bhow many people\b|\bhousehold size\b/i.test(pendingQuestion)) {
    return /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:people|persons?|adults?|children|occupants?)\b/i.test(message);
  }
  if (/\bwhen\b[^?]{0,45}\b(?:use|electricity|power)\b|\btime of day\b/i.test(pendingQuestion)) {
    return /\b(?:mornings?|afternoons?|evenings?|nights?|overnight|daytime|after sunset|weekdays?|weekends?)\b/i.test(message);
  }
  if (/\bwindows?\b[^?]{0,45}\b(?:cold|draught|draft|wind)\b/i.test(pendingQuestion)) {
    return /\b(?:yes|yeah|yep|no|nope|freezing|cold|warm|draughty|drafty|still nights?|when there is no wind)\b/i.test(message);
  }
  if (/\b(?:do you|already)\b[^?]{0,40}\bsolar\b/i.test(pendingQuestion)) {
    return /\b(?:yes|yeah|yep|no|nope|have solar|do not have solar|don['’]?t have solar)\b/i.test(message);
  }
  if (/\bpostcode\b/i.test(pendingQuestion)) return explicitlySuppliesPostcode(message);
  if (/\b(?:own|owner|rent|renter|tenant)\b/i.test(pendingQuestion)) {
    return /\b(?:own|owner|homeowner|rent|renter|tenant)\b/i.test(message);
  }
  if (/\bwhat heating\b|\bhow (?:do|are) you heat\b/i.test(pendingQuestion)) {
    return /\b(?:gas|ducted|reverse[- ]?cycle|air ?con(?:ditioner)?|split system|wood heater|electric heater)\b/i.test(message);
  }
  if (/\b(?:hot water|water heater)\b/i.test(pendingQuestion)) {
    return /\b(?:gas|electric|heat[- ]?pump|solar)\b[^.\n]{0,35}\b(?:hot water|water heater|system)\b|\b(?:gas|electric|heat[- ]?pump|solar)\s+system\b/i.test(message);
  }
  if (/\b(?:brand|model|capacity|equipment details?)\b/i.test(pendingQuestion)) {
    return suppliesConcreteDecisionDetails(message);
  }
  if (/\b(?:state|territory)\b/i.test(pendingQuestion)) {
    return /\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA|Australian Capital Territory|New South Wales|Northern Territory|Queensland|South Australia|Tasmania|Victoria|Western Australia)\b/i.test(message);
  }
  return false;
}

function suppliesConcreteDecisionDetails(message: string) {
  return /\b(?:quote(?:d)?|model|brand|outdoor|indoor|heads?|capacity|next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?))\b|\b[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*\b/i.test(message);
}

function suppliesTopicNeutralDecisionDetails(message: string) {
  return /\b(?:model|brand|outdoor|indoor|heads?|capacity)\b/i.test(message)
    || /\b\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?)\b/i.test(message)
    || /\b[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*\b/i.test(message);
}

function pendingQuestionRequestsDecisionDetails(pendingQuestion: string) {
  return /\b(?:exact|details?|existing|proposed|replacement|install(?:ation)?|brands?|models?|systems?|equipment|products?|quotes?|capacity|sizes?|when|dates?)\b/i.test(pendingQuestion);
}

export function surgeConversationTopicsAreCompatible(left: string, right: string) {
  if (!left || !right || left === "general" || right === "general") return false;
  if (left === right) return true;
  const pair = [left, right].sort().join(":");
  const technologyTopics = [
    "heat_pump_hot_water",
    "battery_vpp",
    "glazing_shading",
    "draughts_ventilation",
    "comfort_fabric",
    "insulation",
    "rcac",
    "induction",
    "ev_charging",
    "solar",
  ];
  const compatiblePairs = new Set([
    ...technologyTopics.map((topic) => ["rebates_certificates", topic].sort().join(":")),
    ...["heat_pump_hot_water", "battery_vpp", "rcac", "induction", "ev_charging", "solar"]
      .map((topic) => ["bills_tariffs", topic].sort().join(":")),
    ...["glazing_shading", "draughts_ventilation", "insulation", "rcac"]
      .map((topic) => ["comfort_fabric", topic].sort().join(":")),
  ]);
  return compatiblePairs.has(pair);
}

const SURGE_HOME_COMFORT_SPACE = String.raw`(?:(?:(?:my|our|the|this|that)\s+)?(?:home|house|bedroom|lounge)|(?:my|our|the|this|that)\s+(?:living\s+)?room)`;

export const SURGE_HOME_COMFORT_INTENT_PATTERN = new RegExp([
  String.raw`\b(?:(?:keep|get|make)\s+${SURGE_HOME_COMFORT_SPACE}\s+warm|heat\s+${SURGE_HOME_COMFORT_SPACE}(?=\s*(?:[?.!,;]|$|\b(?:in|during|through|when|because|without|with|efficiently|cheaply|properly|enough)\b)))`,
  String.raw`\b${SURGE_HOME_COMFORT_SPACE}\s+(?:(?:always|often|sometimes|usually)\s+)?(?:(?:is|gets?|stays?|feels?)\s+(?:(?:very|too|really|quite)\s+)?(?:cold|freez\w*)|freez\w*|(?:won(?:['’]?t)|doesn(?:['’]?t)|does\s+not|can(?:not|['’]?t))\s+(?:(?:get|stay|feel|keep)\s+warm|warm\s+up))\b`,
  String.raw`\b(?:is|does)\s+${SURGE_HOME_COMFORT_SPACE}\s+(?:feel\s+|get\s+|stay\s+)?(?:(?:very|too|really|quite)\s+)?(?:cold|freez\w*)\b`,
].join("|"), "i");

export const SURGE_EXPLICIT_SEPARATE_PROPERTY_CONTEXT_PATTERN = /\b(?:another|different|other|second|new|investment|rental|holiday|vacation|weekend|secondary|old|previous|former|prior)\s+(?:home(?!\s+(?:battery|storage)\b)|house|place|property|apartment|unit|residence|site|job|shed|building)\b|\b(?:my|our|the)\s+(?:beach\s+house|weekender|airbnb)\b|\b(?:at|in|for|on)\s+(?:my|our|the|a|an)\s+(?:rental|investment)(?:\s+property)?\b|\bcontainer\s+shed\b/i;

const SURGE_CONVERSATION_TOPIC_RULES: ReadonlyArray<readonly [string, RegExp]> = [
    // The decision being made is more useful than the product noun. For
    // example, "rebate for replacing ducted gas" must stay a rebate decision
    // while the customer supplies air-conditioner details on later turns.
    ["products_ratings", /\b(?:quotes?|proposals?|offers?)\b[^.!?\n]{0,65}\b(?:fair|reasonable|good|value|compare|comparison|better|worth|review)\b|\b(?:fair|reasonable|good|value|compare|comparison|better|worth|review)\b[^.!?\n]{0,65}\b(?:quotes?|proposals?|offers?)\b/i],
    ["rebates_certificates", /\b(?:rebate|STCs?|VEECs?|ESCs?|PRCs?|certificate discount)\b/i],
    ["bills_tariffs", /\b(?:electricity bill|power bill|tariff|energy plan|retailer|feed[- ]?in)\b/i],
    ["heat_pump_hot_water", /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water|water heater)\b/i],
    ["battery_vpp", /\b(?:home )?batter(?:y|ies)|\bVPP\b|energy storage/i],
    ["glazing_shading", /\b(?:windows?|glazing|glass|blinds?|curtains?|shading)\b/i],
    ["draughts_ventilation", /\b(?:draughts?|drafts?|air leaks?|breeze|wind coming (?:in|through)|gap(?:s)? (?:around|under) (?:the )?(?:door|window)|ventilation|(?:exhaust|extractor|extraction|bathroom) fan)\b/i],
    ["comfort_fabric", new RegExp(`\\b(?:condensation|mould|mold|humidity|comfort)\\b|${SURGE_HOME_COMFORT_INTENT_PATTERN.source}`, "i")],
    ["insulation", /\b(?:insulation|batts?)\b/i],
    ["rcac", /\b(?:air ?con(?:ditioner)?|reverse[- ]?cycle|split systems?|(?:new|old|existing|current|working|replacement) split|multi[- ]?(?:head|split)(?: system)?|ducted heating|gas heater)\b/i],
    ["induction", /\b(?:induction|cooktop|electric cooking)\b/i],
    ["ev_charging", /\b(?:EV|electric vehicle|car charger|home charging)\b/i],
    ["renters_strata", /\b(?:renter|tenant|strata|owners corporation)\b/i],
    ["solar", /\b(?:solar|PV|panels?|inverter|clipping|zero[- ]?export|self[- ]?consumption)\b/i],
];

function surgeConversationTopicsFor(message: string) {
  return [...new Set(SURGE_CONVERSATION_TOPIC_RULES
    .filter(([, pattern]) => pattern.test(message))
    .map(([topic]) => topic))];
}

export function surgeConversationTopicFor(message: string) {
  return surgeConversationTopicsFor(message)[0] || "";
}

function messageAsksCrossTopicDecision(message: string) {
  const technologyTopics = surgeConversationTopicsFor(message)
    .filter((topic) => !["products_ratings", "rebates_certificates", "bills_tariffs"].includes(topic));
  return technologyTopics.length > 1
    && /\b(?:or|versus|vs\.?|compare|comparison|choice|choose|option|budget|priority|prioritise|prioritize|first)\b/i.test(message);
}

export function surgeConversationCorrectionReframesDecision(message: string) {
  if (explicitTenureCorrection(message)) return false;
  return /\b(?:instead|rather than|want to know|trying to find out|my question is|not (?:the |about )?(?:rebate|discount|quote|price|cost|comparison|eligibility|payback|sizing|size|brand|model))\b/i.test(message);
}

function surgeConversationTechnologyTopicFor(message: string) {
  const topicRules: ReadonlyArray<readonly [string, RegExp]> = [
    ["heat_pump_hot_water", /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water|water heater)\b/i],
    ["battery_vpp", /\b(?:home )?batter(?:y|ies)|\bVPP\b|energy storage/i],
    ["glazing_shading", /\b(?:windows?|glazing|glass|blinds?|curtains?|shading)\b/i],
    ["draughts_ventilation", /\b(?:draughts?|drafts?|air leaks?|breeze|wind coming (?:in|through)|gap(?:s)? (?:around|under) (?:the )?(?:door|window)|ventilation|(?:exhaust|extractor|extraction|bathroom) fan)\b/i],
    ["comfort_fabric", new RegExp(`\\b(?:condensation|mould|mold|humidity|comfort)\\b|${SURGE_HOME_COMFORT_INTENT_PATTERN.source}`, "i")],
    ["insulation", /\b(?:insulation|batts?)\b/i],
    ["rcac", /\b(?:air ?con(?:ditioner)?|reverse[- ]?cycle|split systems?|(?:new|old|existing|current|working|replacement) split|multi[- ]?(?:head|split)(?: system)?|ducted heating|ducted gas|gas heater)\b/i],
    ["induction", /\b(?:induction|cooktop|electric cooking)\b/i],
    ["ev_charging", /\b(?:EV|electric vehicle|car charger|home charging)\b/i],
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
  const explicitPriorReference = EXPLICIT_TOPIC_REFERENCE_PATTERN.test(clean)
    || NAMED_TOPIC_ANAPHORA_PATTERN.test(anaphoraText)
    || CONTEXT_REFERENCE_PATTERN.test(anaphoraText)
    || DECISION_FACET_REFERENCE_PATTERN.test(clean)
    || LABELLED_OPTION_REFERENCE_PATTERN.test(clean)
    || PRIOR_DECISION_REVISIT_PATTERN.test(clean)
    || RECALL_PATTERN.test(clean);
  const additiveReference = TRAILING_ADDITIVE_REFERENCE_PATTERN.test(anaphoraText)
    && (Boolean(namedTopic) || explicitPriorReference);
  const unresolvedOpenEndedSubject = OPEN_ENDED_SUBJECT_PATTERN.test(clean)
    && !namedTopic
    && !explicitPriorReference;
  const namedTopicUsesPriorContext = !/\binstead\b/i.test(clean)
    && (EXPLICIT_TOPIC_REFERENCE_PATTERN.test(clean)
      || NAMED_TOPIC_ANAPHORA_PATTERN.test(anaphoraText)
      || PRIOR_DECISION_REVISIT_PATTERN.test(clean)
      || RECALL_PATTERN.test(clean)
      || additiveReference);
  const ellipticalFollowUp = !/\binstead\b/i.test(clean)
    && !unresolvedOpenEndedSubject
    && (ELLIPTICAL_FOLLOW_UP_PATTERN.test(clean) || GENERIC_NEXT_STEP_PATTERN.test(clean));
  return !TOPIC_CHANGE_PATTERN.test(clean)
    && (!namedTopic || namedTopicUsesPriorContext || ellipticalFollowUp)
    && wordCount <= (RECALL_PATTERN.test(clean) ? 32 : 24)
    && (CONTEXT_REFERENCE_PATTERN.test(clean)
      || LABELLED_OPTION_REFERENCE_PATTERN.test(clean)
      || ellipticalFollowUp
      || PRIOR_DECISION_REVISIT_PATTERN.test(clean)
      || RECALL_PATTERN.test(clean)
      || additiveReference);
}

export function resolveSurgeConversationReference(
  message: string,
  priorTurns: readonly SurgeConversationContextTurn[],
  continuation: SurgeConversationState | null,
): SurgeReferenceResolution {
  if (hasAmbiguousRepeatedSubjectReference(message, continuation)) {
    return { contextDependent: true, status: "needs_clarification", basis: "none", anchorUserMessages: [] };
  }
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
  const forgetsOnlyAReferencedDecisionFacet = /^\s*forget\b[^.!?]{0,80}\b(?:exact|specific|current|stated|quoted|the)?\s*(?:price|cost|amount|figure|rate|fee|model|brand|warranty|date|detail)s?\b/i.test(clean)
    && /\b(?:that|this|same)\s+(?:quote|proposal|offer|option|system|unit|model)\b/i.test(clean);
  const topicChange = TOPIC_CHANGE_PATTERN.test(clean) && !forgetsOnlyAReferencedDecisionFacet;

  if (correction && topicChange) return "correction_and_topic_change";
  if (topicChange) return "topic_change";
  if (clarification) return "clarification";
  if (correction) return "correction";
  const currentTopic = surgeConversationTopicFor(clean);
  const pendingTopic = surgeConversationTopicFor(continuation?.pendingQuestion || "");
  const activeTopic = continuation?.activeTopic || "general";
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
    && clean.split(/\s+/).filter(Boolean).length <= 60
  ) {
    const answersPendingQuestion = surgeMessageAnswersPendingQuestion(clean, continuation.pendingQuestion);
    const pendingExpectsPostcode = /\bpostcode\b/i.test(continuation.pendingQuestion);
    const decisionTechnologyTopic = surgeConversationTechnologyTopicFor(
      `${continuation.goal}\n${continuation.pendingQuestion}\n${continuation.lastAnswerSummary}`,
    );
    const suppliesRequestedDetails = pendingQuestionRequestsDecisionDetails(continuation.pendingQuestion)
      && suppliesConcreteDecisionDetails(clean)
      && (currentTopic
        ? surgeConversationTopicsAreCompatible(currentTopic, pendingTopic || activeTopic)
          && (!decisionTechnologyTopic || currentTopic === decisionTechnologyTopic)
        : suppliesTopicNeutralDecisionDetails(clean));
    const genericShortAnswer = !pendingExpectsPostcode
      && (/^(?:yes|yeah|yep|no|nope|maybe|not sure|unsure)\b/i.test(clean)
        || (clean.split(/\s+/).filter(Boolean).length <= 8 && CONTEXT_REFERENCE_PATTERN.test(clean)));
    const tentativeShortAnswer = /\?\s*$/u.test(clean)
      && clean.split(/\s+/).filter(Boolean).length <= 6
      && !/^(?:is|are|am|can|could|should|would|will|do|does|did|what|which|why|how|where|when|who)\b/i.test(clean)
      && (!pendingExpectsPostcode || answersPendingQuestion)
      && !startsNewRequest;
    if (tentativeShortAnswer) {
      if (currentTopic && currentTopic !== pendingTopic && !answersPendingQuestion && !suppliesRequestedDetails) return "topic_change";
      return "answer_to_follow_up";
    }
    if (currentTopic && currentTopic !== pendingTopic && !answersPendingQuestion && !suppliesRequestedDetails) return "topic_change";
    if (!asksQuestion && !startsNewRequest && (answersPendingQuestion || suppliesRequestedDetails || genericShortAnswer)) {
      return "answer_to_follow_up";
    }
  }
  const progressiveDetailWithoutState = !continuation
    && priorTurns.some((turn) => turn.role === "user")
    && !asksQuestion
    && !startsNewRequest
    && !TRAILING_ADDITIVE_REFERENCE_PATTERN.test(clean)
    && (suppliesConcreteDecisionDetails(clean)
      || explicitlySuppliesPostcode(clean)
      || /^(?:assume|we have|we use|i have|i use|using)\b/i.test(clean)
      || /\b(?:percent|per cent|cents?|unknown|undecided)\b/i.test(clean));
  if (progressiveDetailWithoutState) return "contextual_follow_up";
  const decisionTechnologyTopic = surgeConversationTechnologyTopicFor(
    `${continuation?.goal || ""}\n${continuation?.pendingQuestion || ""}\n${continuation?.lastAnswerSummary || ""}`,
  );
  if (
    currentTopic
    && activeTopic !== "general"
    && currentTopic !== activeTopic
    && surgeConversationTopicsAreCompatible(currentTopic, activeTopic)
    && suppliesConcreteDecisionDetails(clean)
    && (!decisionTechnologyTopic || currentTopic === decisionTechnologyTopic)
    && !startsNewRequest
  ) {
    return "contextual_follow_up";
  }
  if (resolveSurgeConversationReference(message, priorTurns, continuation).status === "resolved_from_recent_context") {
    return "contextual_follow_up";
  }
  return "new_question";
}

export function surgeConversationDecisionContext(
  message: string,
  continuation: SurgeConversationState | null,
  priorTurns: readonly SurgeConversationContextTurn[] = [],
) {
  const intent = classifySurgeConversationTurn(message, continuation, priorTurns);
  if (intent === "new_question"
    || intent === "topic_change"
    || intent === "correction_and_topic_change"
    || (intent === "correction" && surgeConversationCorrectionReframesDecision(message))) {
    return message.trim();
  }
  const userMessages = priorTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  let topicStart = 0;
  for (let index = 0; index < userMessages.length; index += 1) {
    if (TOPIC_CHANGE_PATTERN.test(userMessages[index])) topicStart = index;
  }
  const parts = [
    continuation?.goal || "",
    ...userMessages.slice(topicStart).slice(-4),
    intent === "answer_to_follow_up" ? continuation?.pendingQuestion || "" : "",
    message.trim(),
  ].filter(Boolean);
  return [...new Set(parts)].join("\n");
}

export function surgeConversationFactsFromMessage(
  message: string,
  contextTopic = "",
): SurgeConversationFact[] {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const facts: SurgeConversationFact[] = [];
  const add = (key: string, value: string) => {
    const bounded = value.trim().slice(0, 240);
    if (bounded) facts.push({ key, value: bounded });
  };
  const correction = explicitCorrectionPair(clean);
  const postcode = correction && /^\d{4}$/.test(correction.replacement)
    ? correction.replacement
    : clean.match(/^\d{4}$/)?.[0]
    || clean.match(/\b(?:post\s*code)(?:\s+is)?\s*[:#-]?\s*(\d{4})\b/i)?.[1]
    || clean.match(/\b(\d{4})\s+(?:post\s*code)\b/i)?.[1]
    || clean.match(/\b(?:i(?:'m| am)|we(?:'re| are)|live|located|property|home|house|place|apartment|unit|site)\s+(?:is\s+)?(?:in|at)\s+(\d{4})\b/i)?.[1]
    || clean.match(/\b(?:my|our)\s+(?:own|saved)\s+(\d{4})\s+(?:home|house|place|property|apartment|unit)\b/i)?.[1];
  if (postcode) add("postcode", postcode);
  if (/\b(?:i|we)\s+(?:now\s+)?(?:rent|are renters?|are tenants?)\b|\b(?:renter|tenant)\b/i.test(clean)) {
    add("tenure", "renter");
  } else if (/\b(?:i|we)\s+(?:now\s+)?own(?:\s+the\s+home)?\b|\bhomeowner\b/i.test(clean)) {
    add("tenure", "owner");
  }
  const existingHeating = clean.match(
    /\b(?:existing|current|currently(?:\s+have|\s+use)?|have|use|replac(?:e|ing|ed)|from)\s+(?:my|our|the|an?|old)?\s*(ducted gas heating|gas ducted heating|gas heater|reverse[- ]?cycle|split system|wood heater|(?:plug[- ]?in )?electric heater)\b/i,
  )?.[1];
  if (existingHeating) add("existing_heating", existingHeating);
  const directedProposedHeating = clean.match(
    /\b(?:with|to|proposed|new|install(?:ing|ed)?|looking\s+at)\s+(?:next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[, ]+)?(?:an?|the)?\s*(ducted reverse[- ]?cycle|multi[- ]?(?:head|split)(?: system)?|reverse[- ]?cycle|split system|(?:plug[- ]?in )?electric heater)\b/i,
  )?.[1];
  const proposedHeatingCandidates = [...clean.matchAll(
    /\b(?:ducted reverse[- ]?cycle|multi[- ]?(?:head|split)(?: system)?|reverse[- ]?cycle|split system|(?:plug[- ]?in )?electric heater)\b/gi,
  )].map((match) => match[0]);
  const proposedHeating = directedProposedHeating
    || (/\b(?:install(?:ing|ed|ation)?|looking\s+at|proposed)\b/i.test(clean)
      ? proposedHeatingCandidates.at(-1)
      : undefined);
  if (proposedHeating) add("proposed_heating", proposedHeating);
  const installationTiming = clean.match(/\b(?:next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|in\s+\d+\s+(?:days?|weeks?|months?))\b/i)?.[0];
  if (installationTiming) add("installation_timing", installationTiming);
  const thermostatSetting = clean.match(
    /\b(?:set(?:ting)?(?:\s+(?:it|the (?:heater|air ?con|thermostat|temperature)))?\s*(?:to|at|on)|thermostat(?:\s+(?:is|at|to))?|temperature setting(?:\s+(?:is|at|to))?)\s*(-?\d+(?:\.\d+)?)\b/i,
  );
  const thermostatValue = Number(thermostatSetting?.[1]);
  const thermostatContext = contextTopic === "rcac"
    || /\b(?:reverse[- ]?cycle|split(?: system)?|air ?con(?:ditioner)?|heater|heating|cooling|thermostat)\b/i.test(clean);
  if (thermostatSetting
    && thermostatContext
    && !/\btimer\b/i.test(clean)
    && Number.isFinite(thermostatValue)
    && thermostatValue >= 10
    && thermostatValue <= 35) {
    add("thermostat_setpoint_celsius", `${thermostatValue}°C`);
  }
  const quantities = [...clean.matchAll(/\b\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?)\b/gi)]
    .map((match) => match[0])
    .filter((quantity) => quantity.replace(/\s+/g, " ").toLowerCase()
      !== correction?.superseded.replace(/\s+/g, " ").toLowerCase());
  if (/\b(?:heads?|multi[- ]?(?:head|split))\b/i.test(clean)) {
    quantities.push(...[...clean.matchAll(/\b\d+\.\d+(?=s?\b)/g)].map((match) => match[0]));
  }
  if (quantities.length) add("supplied_quantities", [...new Set(quantities)].join(", "));
  if (/\b(?:install(?:ing|ed|ation)?|quote(?:d)?|model|brand|system|unit|outdoor|indoor|heads?|capacity|multi[- ]?(?:head|split)|\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?))\b|\b[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*\b/i.test(clean)) {
    add("proposed_or_quoted_details", clean);
  }
  return facts.slice(0, 6);
}

type ExplicitBudgetSemantics = {
  amounts: number[];
  qualifier: "exact" | "under" | "up_to" | "at_least" | "range";
};

function budgetQualifier(value: string, amountCount: number): ExplicitBudgetSemantics["qualifier"] {
  if (amountCount > 1) return "range";
  if (/\b(?:under|below|less than)\b/i.test(value)) return "under";
  if (/\b(?:up to|maximum|max|cap)\b/i.test(value)) return "up_to";
  if (/\b(?:at least|over|more than)\b|\bplus\s*$/i.test(value)) return "at_least";
  return "exact";
}

function explicitBudgetSemantics(message: string) {
  const semantics: ExplicitBudgetSemantics[] = [];
  const moneyMatches = [...message.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)];
  for (const [matchIndex, match] of moneyMatches.entries()) {
    const index = match.index || 0;
    const before = message.slice(Math.max(0, index - 110), index);
    const after = message.slice(index + match[0].length, index + match[0].length + 70);
    const explicitlyAllocated = /(?:\b(?:my|our)\s+budget(?:\s+(?:is|of|to|at))?|\bbudget(?:\s+(?:is|of|to|at))?|\b(?:can|could|want to|able to)\s+(?:spend|afford|put)|\bset aside|\b(?:limit|cap|maximum|max)(?:\s+is)?|\bbest use of (?:my|our)|\b(?:i|we)\s+(?:still\s+)?have|\bunder|\bbelow|\bless than|\bup to|\bat least|\bover|\bmore than)\s*(?:[:=]\s*)?(?:(?:now|currently|about|around|roughly|approximately|exactly|under|below|less than|up to|between|from|over|more than|at least)\s*)?$/i.test(before)
      || /^\s*(?:budget|to spend|to work with|available)\b/i.test(after);
    if (!explicitlyAllocated) continue;
    const firstAmount = Number(match[1].replaceAll(",", ""));
    if (!Number.isFinite(firstAmount)) continue;
    const amounts = [firstAmount];
    const next = moneyMatches[matchIndex + 1];
    const betweenAmounts = next?.index === undefined
      ? ""
      : message.slice(index + match[0].length, next.index);
    if (next && /^\s*(?:to|through|and|[-\u2013\u2014])\s*$/i.test(betweenAmounts)) {
      const nextAmount = Number(next[1].replaceAll(",", ""));
      if (Number.isFinite(nextAmount)) amounts.push(nextAmount);
    }
    const localContext = `${before.slice(-70)} ${match[0]}${amounts.length > 1 ? `${betweenAmounts}${next?.[0] || ""}` : ""}`;
    semantics.push({ amounts, qualifier: budgetQualifier(localContext, amounts.length) });
  }
  return semantics;
}

function budgetFactMatchesExplicitMessage(factValue: string, message: string) {
  const amounts = [...factValue.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1].replaceAll(",", "")))
    .filter(Number.isFinite);
  if (!amounts.length) return false;
  const qualifier = budgetQualifier(factValue, amounts.length);
  return explicitBudgetSemantics(message).some((candidate) => (
    candidate.qualifier === qualifier
    && candidate.amounts.length === amounts.length
    && candidate.amounts.every((amount, index) => Math.abs(amount - amounts[index]) <= 0.01)
  ));
}

export function mergeSurgeConversationFacts(
  prior: readonly SurgeConversationFact[],
  current: readonly SurgeConversationFact[],
) {
  const merged = [...prior];
  const indexes = new Map(merged.map((fact, index) => [fact.key, index]));
  for (const fact of current) {
    const index = indexes.get(fact.key);
    if (index === undefined) {
      if (merged.length >= SURGE_MAX_FACTS) continue;
      indexes.set(fact.key, merged.length);
      merged.push(fact);
    } else {
      merged[index] = fact;
    }
  }
  return merged;
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

function boundedLedgerInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000
    ? Number(value)
    : null;
}

function parseLedgerFact(value: unknown): SurgeConversationLedgerFact | null {
  const source = record(value);
  const key = boundedString(source?.key, 48);
  const maximum = key === "user_context" ? SURGE_MAX_USER_CONTEXT_CHARS : 240;
  const factValue = boundedString(source?.value, maximum);
  const updatedTurn = boundedLedgerInteger(source?.updatedTurn);
  if (
    !key
    || factValue === null
    || updatedTurn === null
    || !/^[a-z][a-z0-9_]*$/.test(key)
    || (source?.source !== "chat" && source?.source !== "plan" && source?.source !== "derived")
  ) return null;
  return { key, value: factValue, source: source.source, updatedTurn };
}

function parseConversationLedger(value: unknown): SurgeConversationLedger | null {
  const source = record(value);
  if (!source) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(source)).byteLength > SURGE_MAX_LEDGER_BYTES) return null;
  } catch {
    return null;
  }
  const turn = boundedLedgerInteger(source.turn);
  const activeDecisionId = boundedString(source.activeDecisionId, 64);
  if (
    turn === null
    || activeDecisionId === null
    || !Array.isArray(source.subjects)
    || source.subjects.length > SURGE_MAX_LEDGER_SUBJECTS
    || !Array.isArray(source.decisions)
    || source.decisions.length > SURGE_MAX_LEDGER_DECISIONS
  ) return null;

  const subjects: SurgeConversationSubject[] = [];
  const subjectIds = new Set<string>();
  let aggregateFacts = 0;
  for (const item of source.subjects) {
    const subject = record(item);
    const id = boundedString(subject?.id, 64);
    const label = boundedString(subject?.label, 120);
    const lastTouchedTurn = boundedLedgerInteger(subject?.lastTouchedTurn);
    if (
      !id
      || !label
      || lastTouchedTurn === null
      || lastTouchedTurn > turn
      || !/^[a-z][a-z0-9_]*$/.test(id)
      || subjectIds.has(id)
      || !["saved_home", "property", "person", "job", "general"].includes(String(subject?.kind))
      || !Array.isArray(subject?.facts)
    ) return null;
    const facts = subject.facts.map(parseLedgerFact);
    if (facts.some((fact) => fact === null || fact.updatedTurn > turn)) return null;
    aggregateFacts += facts.length;
    subjectIds.add(id);
    subjects.push({
      id,
      kind: subject.kind as SurgeConversationSubject["kind"],
      label,
      facts: facts as SurgeConversationLedgerFact[],
      lastTouchedTurn,
    });
  }

  const decisions: SurgeConversationDecision[] = [];
  const decisionIds = new Set<string>();
  let aggregateOpenItems = 0;
  for (const item of source.decisions) {
    const decision = record(item);
    const id = boundedString(decision?.id, 64);
    const topic = boundedString(decision?.topic, 48);
    const goal = boundedString(decision?.goal, 300);
    const outcomeSummary = boundedString(decision?.outcomeSummary, 640);
    const pendingQuestion = boundedString(decision?.pendingQuestion, 220);
    const lastTouchedTurn = boundedLedgerInteger(decision?.lastTouchedTurn);
    if (
      !id
      || !topic
      || goal === null
      || outcomeSummary === null
      || pendingQuestion === null
      || lastTouchedTurn === null
      || lastTouchedTurn > turn
      || !/^[a-z][a-z0-9_]*$/.test(id)
      || !/^[a-z][a-z0-9_]*$/.test(topic)
      || decisionIds.has(id)
      || !Array.isArray(decision?.subjectIds)
      || decision.subjectIds.length < 1
      || decision.subjectIds.length > 3
      || !decision.subjectIds.every((subjectId) => typeof subjectId === "string" && subjectIds.has(subjectId))
      || !Array.isArray(decision?.facts)
      || !Array.isArray(decision?.openItems)
      || (decision?.status !== "open" && decision?.status !== "resolved")
    ) return null;
    const facts = decision.facts.map(parseLedgerFact);
    const openItems = decision.openItems.map((openItem) => boundedString(openItem, 220));
    if (facts.some((fact) => fact === null || fact.updatedTurn > turn) || openItems.some((openItem) => openItem === null)) return null;
    const parsedOpenItems = [...new Map(
      (openItems as string[])
        .filter(Boolean)
        .map((openItem) => [openItem.toLowerCase(), openItem]),
    ).values()];
    if (
      (decision.status === "open") !== (parsedOpenItems.length > 0)
      || (pendingQuestion && !parsedOpenItems.some((openItem) => (
        openItem.toLowerCase() === pendingQuestion.toLowerCase()
      )))
    ) return null;
    aggregateFacts += facts.length;
    aggregateOpenItems += parsedOpenItems.length;
    decisionIds.add(id);
    decisions.push({
      id,
      subjectIds: [...new Set(decision.subjectIds as string[])],
      topic,
      goal,
      facts: facts as SurgeConversationLedgerFact[],
      outcomeSummary,
      openItems: parsedOpenItems,
      pendingQuestion,
      status: decision.status,
      lastTouchedTurn,
    });
  }
  if (
    aggregateFacts > SURGE_MAX_LEDGER_FACTS
    || aggregateOpenItems > SURGE_MAX_LEDGER_OPEN_ITEMS
    || (decisions.length > 0 && !activeDecisionId)
    || (decisions.length === 0 && Boolean(activeDecisionId))
    || (activeDecisionId && !decisionIds.has(activeDecisionId))
  ) return null;
  return { turn, activeDecisionId, subjects, decisions };
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

  const correctionValues = new Set<string>(SURGE_PLAN_CONTEXT_CORRECTION_VALUES);
  const planContextCorrections = source.planContextCorrections === undefined
    ? undefined
    : Array.isArray(source.planContextCorrections)
      && source.planContextCorrections.length <= SURGE_PLAN_CONTEXT_CORRECTION_VALUES.length
      && source.planContextCorrections.every((value) => (
        typeof value === "string" && correctionValues.has(value)
      ))
      && new Set(source.planContextCorrections).size === source.planContextCorrections.length
        ? source.planContextCorrections as SurgePlanContextCorrection[]
        : null;
  if (planContextCorrections === null) return null;

  const ledger = source.ledger === undefined ? undefined : parseConversationLedger(source.ledger);
  if (source.ledger !== undefined && !ledger) return null;

  return {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: activeTopic || "general",
    goal,
    facts,
    pendingQuestion,
    lastAnswerSummary,
    ...(planContextCorrections?.length ? { planContextCorrections } : {}),
    ...(ledger ? { ledger } : {}),
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

export type SurgeConversationFrame = {
  subject: SurgeConversationSubject | null;
  subjects: SurgeConversationSubject[];
  decision: SurgeConversationDecision | null;
  relatedDecisions: SurgeConversationDecision[];
  inactiveIndex: Array<{ subjectLabel: string; topic: string; decisionId: string }>;
};

export type SurgeConversationLedgerUpdate = {
  message: string;
  answerSummary: string;
  followUpQuestion: string;
  intent: SurgeConversationTurnIntent;
  planFacts: readonly SurgeConversationFact[];
  modelState: SurgeConversationState;
  derivedFacts?: readonly SurgeConversationFact[];
  savedHomeCorrectionFacts?: readonly SurgeConversationFact[];
  forceSavedHomeSubject?: boolean;
  recordTurn?: boolean;
};

function normalizedLedgerWords(value: string) {
  return new Set(value.toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !/^(?:about|back|from|have|home|that|this|what|with|your)$/.test(word)));
}

const SURGE_GOAL_EXPANSION_STOP_WORDS = new Set([
  "answer", "change", "could", "does", "help", "just", "normal", "only", "overall",
  "please", "question", "really", "same", "says", "should", "still", "tell", "think",
  "what", "words", "would",
]);

function materiallyExpandsDecisionGoal(message: string, decision: SurgeConversationDecision) {
  if (!/[?]|\b(?:also|and what|what if|how about|does that|would that|could that)\b/i.test(message)) return false;
  const priorWords = normalizedLedgerWords(decision.goal);
  const novelWords = [...normalizedLedgerWords(message)]
    .filter((word) => !priorWords.has(word) && !SURGE_GOAL_EXPANSION_STOP_WORDS.has(word));
  return novelWords.length >= 2;
}

function boundedCombinedGoal(priorGoal: string, nextGoal: string) {
  const segments: string[] = [];
  const normalizedSegments = new Set<string>();
  for (const segment of [priorGoal, nextGoal]
    .flatMap((value) => value.split(/\s*\|\s*/u))
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter(Boolean)) {
    const normalized = segment
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("en-AU");
    if (normalizedSegments.has(normalized)) continue;
    normalizedSegments.add(normalized);
    segments.push(segment);
  }
  const expanded = segments.join(" | ");
  if (expanded.length <= 300) return expanded;
  if (segments.length <= 1) return expanded.slice(0, 300).trim();
  const retainedPrior = segments.slice(0, -1).join(" | ");
  const latest = segments.at(-1) || "";
  return `${retainedPrior.slice(0, 140).trim()} | ${latest.slice(-150).trim()}`;
}

function nextLedgerSubjectIdentity(
  state: SurgeConversationState,
  prefix: string,
  kind: SurgeConversationSubject["kind"],
  label: string,
) {
  const ids = new Set((state.ledger?.subjects || []).map((subject) => subject.id));
  let suffix = 1;
  while (ids.has(`${prefix}_${suffix}`)) suffix += 1;
  return { id: `${prefix}_${suffix}`, kind, label: `${label} ${suffix}` };
}

function namedSubjectIsNegated(message: string, aliases: string) {
  const possessiveName = `(?:${aliases})(?:['’]s)?`;
  const directNegation = new RegExp(
    `\\b(?:not(?:\\s+for)?|rather\\s+than|instead\\s+of)\\s+(?:(?:my|our)\\s+)?${possessiveName}(?:\\s+(?:home|house|place|property|apartment|unit))?\\b`,
    "i",
  );
  const negativeCopula = new RegExp(
    `\\b(?:it|this|that)\\s+(?:isn['’]?t|is not|wasn['’]?t|was not)\\s+(?:for\\s+)?(?:(?:my|our)\\s+)?${possessiveName}(?:\\s+(?:home|house|place|property|apartment|unit))?\\b`,
    "i",
  );
  const namedPropertyNegation = new RegExp(
    `\\b(?:(?:my|our)\\s+)?${possessiveName}(?:\\s+(?:home|house|place|property|apartment|unit))?\\s+(?:isn['’]?t|is not|wasn['’]?t|was not)\\s+(?:the\\s+(?:one|home|house|place|property|apartment|unit)|it\\b|mine\\b|ours\\b)`,
    "i",
  );
  return directNegation.test(message)
    || negativeCopula.test(message)
    || namedPropertyNegation.test(message);
}

function relationshipHomeIdentity(message: string, state: SurgeConversationState) {
  const relationships: ReadonlyArray<readonly [string, string, string]> = [
    ["sister", "sisters_home", "Sister's home"],
    ["brother", "brothers_home", "Brother's home"],
    ["daughter", "daughters_home", "Daughter's home"],
    ["son", "sons_home", "Son's home"],
    ["aunt", "aunts_home", "Aunt's home"],
    ["uncle", "uncles_home", "Uncle's home"],
    ["grandmother|grandma|nan|nanna", "grandmothers_home", "Grandmother's home"],
    ["grandfather|grandpa|grandad|pop", "grandfathers_home", "Grandfather's home"],
    ["friend", "friends_home", "Friend's home"],
    ["neighbou?r", "neighbours_home", "Neighbour's home"],
    ["landlord", "landlords_home", "Landlord's home"],
    ["tenant", "tenants_home", "Tenant's home"],
  ];
  for (const [aliases, id, label] of relationships) {
    const housingParty = id === "landlords_home" || id === "tenants_home";
    const named = new RegExp(housingParty
      ? `\\b(?:(?:my|our|the)\\s+(?:${aliases})(?:['’]s)?|(?:for|about|at)\\s+(?:(?:my|our|the)\\s+)?(?:${aliases})(?:['’]s)?)(?:\\s+(?:home|house|place|property|apartment|unit))?\\b`
      : `\\b(?:(?:my|our)\\s+)?(?:${aliases})(?:['’]s)?(?:\\s+(?:home|house|place|property|apartment|unit))?\\b`, "i").test(message);
    if (!named || namedSubjectIsNegated(message, aliases)) continue;
    if (/\banother\b/i.test(message)) {
      return nextLedgerSubjectIdentity(state, id, "property", label.replace(/'s home$/, " home"));
    }
    return { id, kind: "property" as const, label };
  }
  return null;
}

type RepeatedSubjectReferenceRule = {
  prefix: string;
  pattern: RegExp;
};

const REPEATED_SUBJECT_REFERENCE_RULES: readonly RepeatedSubjectReferenceRule[] = [
  { prefix: "friends_home", pattern: /\b(?:my\s+)?friend(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "neighbours_home", pattern: /\b(?:my\s+)?neighbou?r(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "landlords_home", pattern: /\b(?:(?:my|our|the)\s+landlord(?:['’]s)?|landlord['’]s)(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "tenants_home", pattern: /\b(?:(?:my|our|the)\s+tenant(?:['’]s)?|tenant['’]s)(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "sisters_home", pattern: /\b(?:my\s+)?sister(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "brothers_home", pattern: /\b(?:my\s+)?brother(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "daughters_home", pattern: /\b(?:my\s+)?daughter(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "sons_home", pattern: /\b(?:my\s+)?son(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "aunts_home", pattern: /\b(?:my\s+)?aunt(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "uncles_home", pattern: /\b(?:my\s+)?uncle(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "grandmothers_home", pattern: /\b(?:my\s+)?(?:grandmother|grandma|nan|nanna)(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "grandfathers_home", pattern: /\b(?:my\s+)?(?:grandfather|grandpa|grandad|pop)(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit))?\b/i },
  { prefix: "client_job", pattern: /\b(?:client|customer)(?:['’]s)?(?:\s+(?:home|house|place|property|site|job))?\b/i },
  { prefix: "investment_property", pattern: /\binvestment\s+(?:home|house|place|property|apartment|unit)\b/i },
  { prefix: "rental_property", pattern: /\brental\s+(?:home|house|place|property|apartment|unit)\b/i },
  { prefix: "holiday_home", pattern: /\bholiday\s+(?:home|house|place|property|apartment|unit)\b/i },
];

function subjectMatchesPrefix(subject: SurgeConversationSubject, prefix: string) {
  return subject.id === prefix || subject.id.startsWith(`${prefix}_`);
}

function repeatedSubjectReferenceRule(message: string) {
  return REPEATED_SUBJECT_REFERENCE_RULES.find((rule) => rule.pattern.test(message)) || null;
}

function repeatedSubjectReferenceSelector(message: string) {
  return message.match(/\b(another|same|first|second|third|older|earlier|previous|latest|newer|other)\b/i)?.[1]?.toLowerCase() || "";
}

function activeLedgerSubject(state: SurgeConversationState) {
  const activeDecision = state.ledger?.decisions.find((decision) => decision.id === state.ledger?.activeDecisionId);
  return activeDecision
    ? state.ledger?.subjects.find((subject) => activeDecision.subjectIds.includes(subject.id)) || null
    : null;
}

function repeatedSubjectCandidates(message: string, state: SurgeConversationState) {
  const rule = repeatedSubjectReferenceRule(message);
  if (!rule) return { rule: null, subjects: [] as SurgeConversationSubject[] };
  return {
    rule,
    subjects: (state.ledger?.subjects || [])
      .filter((subject) => subjectMatchesPrefix(subject, rule.prefix))
      .sort((left, right) => {
        const leftOrdinal = left.id === rule.prefix ? 0 : Number(left.id.match(/_(\d+)$/)?.[1] || Number.MAX_SAFE_INTEGER);
        const rightOrdinal = right.id === rule.prefix ? 0 : Number(right.id.match(/_(\d+)$/)?.[1] || Number.MAX_SAFE_INTEGER);
        return leftOrdinal - rightOrdinal;
      }),
  };
}

function subjectMatchingExplicitPostcode(message: string, subjects: readonly SurgeConversationSubject[]) {
  const postcodes = [...message.matchAll(/\b(?:postcode\s*)?(\d{4})\b/gi)].map((match) => match[1]);
  const matches = subjects.filter((subject) => subject.facts.some((fact) => (
    fact.key === "postcode" && postcodes.includes(fact.value)
  )));
  return matches.length === 1 ? matches[0] : null;
}

function resolvedRepeatedSubjectReference(message: string, state: SurgeConversationState) {
  const { subjects } = repeatedSubjectCandidates(message, state);
  if (!subjects.length) return null;
  const postcodeMatch = subjectMatchingExplicitPostcode(message, subjects);
  if (postcodeMatch) return postcodeMatch;
  const selector = repeatedSubjectReferenceSelector(message);
  if (selector === "another") return null;
  if (!selector) return subjects.length === 1 ? subjects[0] : null;
  const active = activeLedgerSubject(state);
  if (selector === "same") {
    return active && subjects.some((subject) => subject.id === active.id)
      ? active
      : subjects.length === 1 ? subjects[0] : null;
  }
  if (selector === "other") {
    return subjects.length === 2 && active && subjects.some((subject) => subject.id === active.id)
      ? subjects.find((subject) => subject.id !== active.id) || null
      : null;
  }
  if (selector === "first" || selector === "older" || selector === "earlier") return subjects[0] || null;
  if (selector === "second") return subjects[1] || null;
  if (selector === "third") return subjects[2] || null;
  if (selector === "latest" || selector === "newer") return subjects.at(-1) || null;
  if (selector === "previous") {
    const activeIndex = active ? subjects.findIndex((subject) => subject.id === active.id) : -1;
    return activeIndex > 0 ? subjects[activeIndex - 1] : subjects.length === 2 ? subjects[0] : null;
  }
  return null;
}

function hasAmbiguousRepeatedSubjectReference(message: string, state: SurgeConversationState | null) {
  if (!state?.ledger) return false;
  const { rule, subjects } = repeatedSubjectCandidates(message, state);
  if (rule && subjects.length >= 2 && !/\banother\b/i.test(message)) {
    return !resolvedRepeatedSubjectReference(message, state);
  }
  if (!surgeConversationAsksForWholeDecision(message)
    && lexicalPriorDecisionAnchor(message, state.ledger.decisions).ambiguous) return true;
  const otherProperties = state.ledger.subjects.filter((subject) => /^other_property(?:_\d+)?$/.test(subject.id));
  return otherProperties.length >= 2
    && /\b(?:other\s+property|(?:first|second|third|older|earlier|previous|latest|newer)\s+(?:other\s+)?property)\b/i.test(message)
    && !resolvedNumberedOtherPropertyReference(message, state);
}

function resolvedNumberedOtherPropertyReference(message: string, state: SurgeConversationState) {
  const candidates = (state.ledger?.subjects || [])
    .filter((subject) => /^other_property(?:_\d+)?$/.test(subject.id))
    .sort((left, right) => Number(left.id.match(/_(\d+)$/)?.[1] || 0) - Number(right.id.match(/_(\d+)$/)?.[1] || 0));
  if (!candidates.length || /\banother\b/i.test(message)) return null;
  const reference = message.match(/\b(?:(first|second|third|older|earlier|previous|latest|newer)\s+)?(?:other\s+)?property(?:\s+(\d+))?\b/i);
  if (!reference) return null;
  const selector = reference[1]?.toLowerCase() || "";
  const number = Number(reference[2] || 0);
  if (!selector && !number && !/\bother\s+property\b/i.test(reference[0])) return null;
  if (number > 0) {
    return candidates.find((subject) => subject.id === `other_property_${number}`) || candidates[number - 1] || null;
  }
  if (selector === "first" || selector === "older" || selector === "earlier") return candidates[0] || null;
  if (selector === "second") return candidates[1] || null;
  if (selector === "third") return candidates[2] || null;
  if (selector === "latest" || selector === "newer") return candidates.at(-1) || null;
  if (selector === "previous") {
    const active = activeLedgerSubject(state);
    const activeIndex = active ? candidates.findIndex((candidate) => candidate.id === active.id) : -1;
    return activeIndex > 0 ? candidates[activeIndex - 1] : candidates.length === 2 ? candidates[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function explicitlyNamedSubjectIdentities(message: string, state: SurgeConversationState) {
  if (/\b(?:mum|mom|mother)\s+(?:and|&)\s+(?:dad|father)(?:['’]s)?\s+(?:shared\s+)?(?:home|house|place|property|apartment|unit)\b|\bmy parents?(?:['’]s)?\s+(?:home|house|place|property|apartment|unit)\b/i.test(message)) {
    return [{ id: "parents_home", kind: "property" as const, label: "Parents' home" }];
  }
  const savedHomeTarget = /\b(?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b|\bmy saved (?:answers|details|home|plan)\b/i.test(message)
    && !/\bnot(?:\s+(?:about|for))?\s+(?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b/i.test(message)
    ? [{ id: "saved_home", kind: "saved_home" as const, label: "Saved home" }]
    : [];
  const definitions: ReadonlyArray<readonly [string, string, string]> = [
    ["mum|mom|mother", "mums_home", "Mum's home"],
    ["dad|father", "dads_home", "Dad's home"],
    ["sister", "sisters_home", "Sister's home"],
    ["brother", "brothers_home", "Brother's home"],
    ["daughter", "daughters_home", "Daughter's home"],
    ["son", "sons_home", "Son's home"],
    ["aunt", "aunts_home", "Aunt's home"],
    ["uncle", "uncles_home", "Uncle's home"],
    ["grandmother|grandma|nan|nanna", "grandmothers_home", "Grandmother's home"],
    ["grandfather|grandpa|grandad|pop", "grandfathers_home", "Grandfather's home"],
    ["friend", "friends_home", "Friend's home"],
    ["neighbou?r", "neighbours_home", "Neighbour's home"],
    ["landlord", "landlords_home", "Landlord's home"],
    ["tenant", "tenants_home", "Tenant's home"],
  ];
  const targetNouns = "home|house|place|property|apartment|unit|postcode|windows?|heater|heating|solar|roof|insulation|bills?|quote|proposal|battery|hot[- ]?water|air ?con(?:ditioner)?|system";
  const propertyTargets = definitions.filter(([aliases]) => (
    new RegExp(
      `\\b(?:my\\s+(?:${aliases})|(?:${aliases})['’]s)(?:\\s+[a-z-]+){0,2}\\s+(?:${targetNouns})\\b`,
      "i",
    ).test(message)
    && !namedSubjectIsNegated(message, aliases)
  ));
  const affirmedTargets = definitions.filter(([aliases]) => (
    new RegExp(
      `\\b(?:(?:it|this|that)\\s+(?:is|was)\\s+(?:my\\s+)?(?:${aliases})(?:['’]s)?|(?:my\\s+)?(?:${aliases})(?:['’]s)?\\s+(?:is|was))\\b`,
      "i",
    ).test(message)
    && !namedSubjectIsNegated(message, aliases)
  ));
  const decisionOwnerTargets = definitions.filter(([aliases]) => (
    new RegExp(
      `\\b(?:my\\s+)?(?:${aliases})(?:['’]s)?\\s+(?:has|have|needs?|owns?|rents?|lives?|got|received|was\\s+quoted|is\\s+(?:considering|looking\\s+at)|wants?)\\b[^.!?]{0,100}\\b(?:${targetNouns})\\b`,
      "i",
    ).test(message)
    && !namedSubjectIsNegated(message, aliases)
  ));
  const targets = propertyTargets.length
    ? propertyTargets
    : affirmedTargets.length
      ? affirmedTargets
      : decisionOwnerTargets.length
        ? decisionOwnerTargets
        : definitions.filter(([aliases]) => (
          new RegExp(
            `\\b(?:(?:for|about|at)\\s+(?:(?:my|our|the)\\s+)?|(?:help|assist)\\s+(?:(?:my|our|the)\\s+))(?:${aliases})(?:['’]s)?\\b`,
            "i",
          ).test(message)
          && !namedSubjectIsNegated(message, aliases)
        ));
  const namedTargets = targets.map(([, id, label]) => {
    if (/\banother\b/i.test(message)) {
      return nextLedgerSubjectIdentity(state, id, "property", label.replace(/'s home$/, " home"));
    }
    return { id, kind: "property" as const, label };
  });
  return [...savedHomeTarget, ...namedTargets];
}

function subjectScopedFactsFromMessage(
  message: string,
  identities: ReadonlyArray<{ id: string }>,
  turn: number,
) {
  const aliasById: Record<string, string> = {
    saved_home: "(?:my|our) (?:own |saved )?(?:\\d{4}\\s+)?(?:home|house|place|apartment|unit)",
    mums_home: "(?:mum|mom|mother)(?:['’]s)?",
    dads_home: "(?:dad|father)(?:['’]s)?",
    parents_home: "(?:my )?parents?(?:['’]s)?",
    sisters_home: "(?:my )?sister(?:['’]s)?",
    brothers_home: "(?:my )?brother(?:['’]s)?",
    daughters_home: "(?:my )?daughter(?:['’]s)?",
    sons_home: "(?:my )?son(?:['’]s)?",
    aunts_home: "(?:my )?aunt(?:['’]s)?",
    uncles_home: "(?:my )?uncle(?:['’]s)?",
    grandmothers_home: "(?:my )?(?:grandmother|grandma|nan|nanna)(?:['’]s)?",
    grandfathers_home: "(?:my )?(?:grandfather|grandpa|grandad|pop)(?:['’]s)?",
    friends_home: "(?:my )?friend(?:['’]s)?",
    neighbours_home: "(?:my )?neighbou?r(?:['’]s)?",
    landlords_home: "(?:(?:my|our) )?landlord(?:['’]s)?",
    tenants_home: "(?:(?:my|our) )?tenant(?:['’]s)?",
  };
  const occurrences = identities
    .map((identity) => {
      const aliases = aliasById[identity.id];
      const match = aliases ? new RegExp(`\\b${aliases}\\b`, "i").exec(message) : null;
      return match ? { id: identity.id, index: match.index } : null;
    })
    .filter((entry): entry is { id: string; index: number } => Boolean(entry))
    .sort((left, right) => left.index - right.index);
  const scopedMessages = new Map(occurrences.map((entry, index) => [
    entry.id,
    message.slice(entry.index, occurrences[index + 1]?.index ?? message.length).trim(),
  ]));
  const subjectFactPattern = /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/;
  return new Map<string, SurgeConversationLedgerFact[]>(identities.map((identity) => {
    const aliases = aliasById[identity.id];
    if (!aliases) return [identity.id, [] as SurgeConversationLedgerFact[]] as const;
    const facts = surgeConversationFactsFromMessage(scopedMessages.get(identity.id) || "")
      .filter((fact) => subjectFactPattern.test(fact.key))
      .map((fact) => ({ ...fact, source: "chat" as const, updatedTurn: turn }));
    return [identity.id, facts] as const;
  }));
}

function contextualQuoteDecision(
  message: string,
  state: SurgeConversationState,
) {
  if (!/\b(?:that|same|the|previous|earlier|latest)\s+(?:quote|proposal|offer)\b/i.test(message)) return null;
  const ledger = state.ledger;
  if (!ledger) return null;
  const nonGeneralSubjectIds = new Set(
    ledger.subjects
      .filter((subject) => subject.kind !== "general")
      .map((subject) => subject.id),
  );
  const candidates = ledger.decisions
    .filter((decision) => decision.subjectIds.length === 1
      && nonGeneralSubjectIds.has(decision.subjectIds[0])
      && /\b(?:quote|proposal|offer)\b/i.test(decisionText(decision)))
    .sort((left, right) => right.lastTouchedTurn - left.lastTouchedTurn
      || decisionCreationTurn(right) - decisionCreationTurn(left));
  if (!candidates[0] || candidates[0].lastTouchedTurn === candidates[1]?.lastTouchedTurn) return null;
  return candidates[0];
}

function ledgerSubjectIdentity(
  message: string,
  state: SurgeConversationState,
  hasPlanContext: boolean,
) {
  const clean = message.trim();
  const strongSavedHomeReturn = /\bback to (?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b|\bmy saved (?:answers|details|home|plan)\b|\bbased on (?:my|our|the) saved (?:answers|details|survey|home profile|plan)\b/i.test(clean);
  const savedHomeIsNegated = /\bnot (?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b|\bnot (?:my|our) saved (?:answers|details|home|plan)\b/i.test(clean);
  if (strongSavedHomeReturn && !savedHomeIsNegated) {
    return { id: "saved_home", kind: "saved_home" as const, label: "Saved home" };
  }
  const explicitlyNamesAnotherSubject = explicitlyNamedSubjectIdentities(clean, state).length > 0
    || /\b(?:another|different|first|second|other|investment|rental|holiday) (?:home|house|property|place|apartment|unit)\b/i.test(clean)
    || /\b(?:client|customer)(?:['’]s)?(?:\s+(?:home|house|property|place|site|job|rental|apartment|unit))?\b/i.test(clean);
  if (PRIOR_DECISION_REVISIT_PATTERN.test(clean) && !explicitlyNamesAnotherSubject) {
    const returnTopic = surgeConversationTechnologyTopicFor(clean) || surgeConversationTopicFor(clean);
    const matchingDecisions = returnTopic
      ? (state.ledger?.decisions || []).filter((decision) => decision.topic === returnTopic)
      : [];
    if (matchingDecisions.length === 1 && matchingDecisions[0].subjectIds.length === 1) {
      const returnedSubject = state.ledger?.subjects.find(
        (candidate) => candidate.id === matchingDecisions[0].subjectIds[0],
      );
      if (returnedSubject) {
        return { id: returnedSubject.id, kind: returnedSubject.kind, label: returnedSubject.label };
      }
    }
    const lexicalDecision = lexicalPriorDecisionAnchor(
      clean,
      state.ledger?.decisions || [],
    ).decision;
    const lexicalSubject = lexicalDecision?.subjectIds.length === 1
      ? state.ledger?.subjects.find((candidate) => candidate.id === lexicalDecision.subjectIds[0])
      : null;
    if (lexicalSubject) {
      return { id: lexicalSubject.id, kind: lexicalSubject.kind, label: lexicalSubject.label };
    }
    const quoteDecision = contextualQuoteDecision(clean, state);
    const quoteSubject = quoteDecision?.subjectIds.length === 1
      ? state.ledger?.subjects.find((candidate) => candidate.id === quoteDecision.subjectIds[0])
      : null;
    if (quoteSubject) {
      return { id: quoteSubject.id, kind: quoteSubject.kind, label: quoteSubject.label };
    }
  }
  const repeatedSubject = resolvedRepeatedSubjectReference(clean, state);
  if (repeatedSubject) {
    return { id: repeatedSubject.id, kind: repeatedSubject.kind, label: repeatedSubject.label };
  }
  const numberedOtherProperty = resolvedNumberedOtherPropertyReference(clean, state);
  if (numberedOtherProperty) {
    return { id: numberedOtherProperty.id, kind: numberedOtherProperty.kind, label: numberedOtherProperty.label };
  }
  const lifecycleProperty = clean.match(
    /\b(new|old|previous|former|prior|vacation|weekend|secondary)\s+(home|house|place|property|apartment|unit|residence)\b/i,
  );
  if (lifecycleProperty) {
    const descriptor = lifecycleProperty[1].toLowerCase();
    const normalizedDescriptor = /^(?:old|previous|former|prior)$/.test(descriptor)
      ? "previous"
      : descriptor;
    const id = `${normalizedDescriptor}_home`;
    const label = `${normalizedDescriptor[0].toUpperCase()}${normalizedDescriptor.slice(1)} home`;
    return { id, kind: "property" as const, label };
  }
  const specialProperty = clean.match(
    /\b(?:my|our|the)\s+(beach\s+house|weekender|airbnb)\b/i,
  )?.[1]?.toLowerCase();
  if (specialProperty) {
    const id = specialProperty === "beach house" ? "beach_house" : `${specialProperty}_property`;
    const label = specialProperty === "airbnb"
      ? "Airbnb property"
      : specialProperty === "weekender"
        ? "Weekender"
        : "Beach house";
    return { id, kind: "property" as const, label };
  }
  const activeClientJob = activeLedgerSubject(state);
  if (
    activeClientJob?.id.startsWith("client_job_")
    && /\b(?:assessor|client|customer|tenant|landlord|property manager)\b/i.test(clean)
    && !/\b(?:another|different|new)\s+(?:client|customer|job|property|rental|home|house|apartment|unit)\b/i.test(clean)
  ) {
    return { id: activeClientJob.id, kind: activeClientJob.kind, label: activeClientJob.label };
  }
  const namedSubjects = explicitlyNamedSubjectIdentities(clean, state);
  if (namedSubjects.length === 1) return namedSubjects[0];
  if (!namedSubjects.length) {
    const relationshipHome = relationshipHomeIdentity(clean, state);
    if (relationshipHome) return relationshipHome;
  }
  const namedOtherProperty = clean.match(/\b(investment|rental|holiday) (?:home|house|property|place|apartment|unit)\b/i)?.[1]?.toLowerCase();
  if (namedOtherProperty) {
    const id = namedOtherProperty === "holiday" ? "holiday_home" : `${namedOtherProperty}_property`;
    const label = namedOtherProperty === "holiday" ? "Holiday home" : `${namedOtherProperty[0].toUpperCase()}${namedOtherProperty.slice(1)} property`;
    if (/\banother\b/i.test(clean) && state.ledger?.subjects.some((subject) => subjectMatchesPrefix(subject, id))) {
      return nextLedgerSubjectIdentity(state, id, "property", label);
    }
    return { id, kind: "property" as const, label };
  }
  if (/\b(?:(?:another|different|second) (?:home|house|property|place|apartment|unit)|(?:another|different|second) property)\b/i.test(clean)) {
    if (/\bsecond\b/i.test(clean)) return { id: "other_property_2", kind: "property" as const, label: "Other property 2" };
    return nextLedgerSubjectIdentity(state, "other_property", "property", "Other property");
  }
  if (/\bother (?:home|house|property|place|apartment|unit)\b/i.test(clean)) {
    const activeDecision = state.ledger?.decisions.find((decision) => decision.id === state.ledger?.activeDecisionId);
    const activeOtherProperty = activeDecision
      ? state.ledger?.subjects.find((subject) => subject.kind === "property"
        && subject.id !== "mums_home"
        && subject.id !== "dads_home"
        && subject.id !== "parents_home"
        && activeDecision.subjectIds.includes(subject.id))
      : null;
    if (activeOtherProperty) return { id: activeOtherProperty.id, kind: activeOtherProperty.kind, label: activeOtherProperty.label };
    const otherProperties = state.ledger?.subjects.filter((subject) => subject.kind === "property"
      && !["mums_home", "dads_home", "parents_home"].includes(subject.id)) || [];
    if (otherProperties.length === 1) return { id: otherProperties[0].id, kind: otherProperties[0].kind, label: otherProperties[0].label };
    return nextLedgerSubjectIdentity(state, "other_property", "property", "Other property");
  }
  if (/\b(?:(?:client|customer)(?:['’]s)?\s+(?:home|house|property|place|site|job|rental|apartment|unit)|(?:for|about)\s+(?:(?:my|our|a|the)\s+)?(?:client|customer))\b/i.test(clean)) {
    const existing = state.ledger?.subjects.filter((subject) => subject.id.startsWith("client_job_")) || [];
    const activeSubject = activeLedgerSubject(state);
    if (/\bsame\b/i.test(clean) && activeSubject?.id.startsWith("client_job_")) {
      return { id: activeSubject.id, kind: activeSubject.kind, label: activeSubject.label };
    }
    if (!/\banother|different|new\b/i.test(clean) && existing.length === 1) {
      return { id: existing[0].id, kind: existing[0].kind, label: existing[0].label };
    }
    return nextLedgerSubjectIdentity(state, "client_job", "job", "Client job");
  }
  if (/\bgeneral question\b|\bnot about (?:my|our|the saved) (?:home|house|place|apartment|unit)\b/i.test(clean)) {
    return { id: "general_advice", kind: "general" as const, label: "General advice" };
  }
  const explicitlyPersonalQuestion = /\b(?:my|our|mum|mom|mother|dad|father|sister|brother|friend|neighbou?r|client|customer)\b|\b(?:this|that|the) (?:home|house|place|property|apartment|unit)\b/i.test(clean);
  const genericExplainer = /^(?:what\s+(?:is|are)\s+(?!(?:this|that|it)\b)|how\s+(?:does|do)\s+(?!(?:this|that|it|they)\b)|explain\s+(?:an?\s+|the\s+)?)[^?]{1,120}\??$/i.test(clean);
  if (genericExplainer && !explicitlyPersonalQuestion && !isSurgeContextDependentMessage(clean)) {
    return { id: "general_advice", kind: "general" as const, label: "General advice" };
  }
  if (/\bback to (?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b|\bmy saved (?:answers|details|home|plan)\b|\bbased on (?:my|our|the) (?:saved )?(?:answers|details|survey|home profile|plan)\b|\b(?:my|our) (?:own |saved )?(?:\d{4}\s+)?(?:home|house|place|apartment|unit)\b/i.test(clean)) {
    return { id: "saved_home", kind: "saved_home" as const, label: "Saved home" };
  }

  if (/\b(?:her|his|their) (?:home|house|place|property|apartment|unit)\b/i.test(clean)) {
    const activeSubject = activeLedgerSubject(state);
    if (activeSubject && activeSubject.kind !== "general") {
      return { id: activeSubject.id, kind: activeSubject.kind, label: activeSubject.label };
    }
    const recentNonGeneral = [...(state.ledger?.subjects || [])]
      .filter((candidate) => candidate.kind !== "general" && candidate.id !== "saved_home")
      .sort((left, right) => right.lastTouchedTurn - left.lastTouchedTurn)[0];
    if (recentNonGeneral) {
      return { id: recentNonGeneral.id, kind: recentNonGeneral.kind, label: recentNonGeneral.label };
    }
  }

  const cleanWords = normalizedLedgerWords(clean);
  const explicitlyNamedExistingSubject = state.ledger?.subjects.find((subject) => {
    if (subject.id === "saved_home" || subject.id === "general_advice") return false;
    const labelWords = normalizedLedgerWords(subject.label);
    return labelWords.size > 0 && [...labelWords].every((word) => cleanWords.has(word));
  });
  if (explicitlyNamedExistingSubject) {
    return {
      id: explicitlyNamedExistingSubject.id,
      kind: explicitlyNamedExistingSubject.kind,
      label: explicitlyNamedExistingSubject.label,
    };
  }

  const active = state.ledger?.decisions.find((decision) => decision.id === state.ledger?.activeDecisionId);
  const activeSubject = active
    ? state.ledger?.subjects.find((subject) => active.subjectIds.includes(subject.id))
    : null;
  if (activeSubject) return { id: activeSubject.id, kind: activeSubject.kind, label: activeSubject.label };
  return hasPlanContext
    ? { id: "saved_home", kind: "saved_home" as const, label: "Saved home" }
    : { id: "conversation", kind: "general" as const, label: "Current conversation" };
}

function decisionText(decision: SurgeConversationDecision) {
  return [
    decision.goal,
    decision.outcomeSummary,
    ...decision.facts.map((fact) => fact.value),
    ...decision.openItems,
  ].join(" ");
}

function decisionSharedWordCount(message: string, decision: SurgeConversationDecision) {
  const messageWords = normalizedLedgerWords(message);
  const decisionWords = normalizedLedgerWords(decisionText(decision));
  return [...messageWords].filter((word) => decisionWords.has(word)).length;
}

const GENERIC_RETURN_ANCHOR_WORDS = new Set([
  "advice",
  "answer",
  "apartment",
  "decision",
  "earlier",
  "house",
  "issue",
  "option",
  "plan",
  "place",
  "previous",
  "problem",
  "property",
  "quote",
  "recommendation",
  "same",
  "saved",
  "solar",
  "subject",
  "system",
  "thing",
  "topic",
  "unit",
]);

function explicitDecisionReturnAnchor(message: string) {
  const tail = message.match(/\b(?:back to|return(?:ing)? to|going back to)\s+([^\n]+)/i)?.[1]?.trim() || "";
  if (!tail) return "";
  const boundary = tail.search(/[,;:.?!\n]|\b(?:what|which|who|where|when|why|how|do|does|did|is|are|was|were|can|could|should|would|will)\b/i);
  return (boundary >= 0 ? tail.slice(0, boundary) : tail).trim();
}

function lexicalPriorDecisionAnchor(
  message: string,
  decisions: readonly SurgeConversationDecision[],
) {
  const anchor = explicitDecisionReturnAnchor(message);
  const anchorWords = [...normalizedLedgerWords(anchor)]
    .filter((word) => !GENERIC_RETURN_ANCHOR_WORDS.has(word));
  if (!anchorWords.length) return { decision: null, ambiguous: false };
  const explicitTopic = surgeConversationTechnologyTopicFor(anchor) || surgeConversationTopicFor(anchor);
  const candidates = explicitTopic
    ? decisions.filter((decision) => (
        decision.topic === explicitTopic
        || surgeConversationTopicsAreCompatible(decision.topic, explicitTopic)
        || surgeConversationTopicsFor(decisionText(decision)).some((topic) => (
          topic === explicitTopic || surgeConversationTopicsAreCompatible(topic, explicitTopic)
        ))
      ))
    : decisions;
  if (anchorWords.length === 1) {
    const matches = candidates.filter((decision) => (
      normalizedLedgerWords(decisionText(decision)).has(anchorWords[0])
    ));
    return matches.length === 1
      ? { decision: matches[0], ambiguous: false }
      : { decision: null, ambiguous: matches.length > 1 };
  }
  const ranked = candidates
    .map((decision) => ({
      decision,
      sharedWords: anchorWords.filter((word) => normalizedLedgerWords(decisionText(decision)).has(word)).length,
    }))
    .filter(({ sharedWords }) => sharedWords >= 2)
    .sort((left, right) => right.sharedWords - left.sharedWords
      || right.decision.lastTouchedTurn - left.decision.lastTouchedTurn);
  const [best, runnerUp] = ranked;
  if (!best) return { decision: null, ambiguous: false };
  if (runnerUp?.sharedWords === best.sharedWords) {
    const tied = ranked
      .filter((candidate) => candidate.sharedWords === best.sharedWords)
      .map((candidate) => candidate.decision)
      .sort(compareDecisionCreationOrder);
    if (/\b(?:first|older|earlier|original)\b/i.test(anchor)) {
      return { decision: tied[0] || null, ambiguous: false };
    }
    if (/\bsecond\b/i.test(anchor)) {
      return { decision: tied[1] || null, ambiguous: tied.length < 2 };
    }
    if (/\bthird\b/i.test(anchor)) {
      return { decision: tied[2] || null, ambiguous: tied.length < 3 };
    }
    if (/\b(?:latest|newer)\b/i.test(anchor)) {
      return { decision: tied.at(-1) || null, ambiguous: false };
    }
    return { decision: null, ambiguous: true };
  }
  return { decision: best.decision, ambiguous: false };
}

function decisionScore(message: string, topic: string, decision: SurgeConversationDecision) {
  let score = 0;
  if (topic && decision.topic === topic) score += 8;
  else if (topic && surgeConversationTopicsAreCompatible(topic, decision.topic)) score += 3;
  score += decisionSharedWordCount(message, decision);
  if (/\b(?:earlier|previous|same|again|return to|that quote|that option)\b/i.test(message)) score += 2;
  return score;
}

function normalizedDecisionReference(value: string) {
  return value.toLowerCase().replace(/[\s,]/g, "");
}

function concreteDecisionAnchors(message: string) {
  return [...message.matchAll(
    /\$\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?)\b/gi,
  )].map((match) => match[0]);
}

function uniquelyConcreteDecision(
  message: string,
  decisions: readonly SurgeConversationDecision[],
) {
  for (const anchor of concreteDecisionAnchors(message)) {
    const normalizedAnchor = normalizedDecisionReference(anchor);
    const matches = decisions.filter((decision) => (
      concreteDecisionAnchors(decisionText(decision))
        .some((candidate) => normalizedDecisionReference(candidate) === normalizedAnchor)
    ));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

const GENERIC_DECISION_IDENTITY_WORDS = new Set([
  ...GENERIC_RETURN_ANCHOR_WORDS,
  "affect",
  "apply",
  "assume",
  "better",
  "check",
  "compare",
  "cost",
  "could",
  "discount",
  "does",
  "feed",
  "installed",
  "price",
  "rebate",
  "should",
  "stcs",
  "tariff",
  "warranty",
  "would",
  "worth",
]);

function firstDecisionIdentitySegment(value: string) {
  return value.split(/\s+\|\s+|\n---\n/, 1)[0]?.trim() || "";
}

function decisionCreationIdentityText(decision: SurgeConversationDecision) {
  return [
    firstDecisionIdentitySegment(decision.goal),
    firstDecisionIdentitySegment(decision.outcomeSummary),
    ...decision.facts.map((fact) => firstDecisionIdentitySegment(fact.value)),
  ].join(" ");
}

function uniquelyNamedDecision(
  message: string,
  decisions: readonly SurgeConversationDecision[],
) {
  const identityWords = [...normalizedLedgerWords(message)]
    .filter((word) => !GENERIC_DECISION_IDENTITY_WORDS.has(word));
  if (!identityWords.length) return null;
  const ranked = decisions
    .map((decision) => ({
      decision,
      sharedWords: identityWords.filter((word) => (
        normalizedLedgerWords(decisionCreationIdentityText(decision)).has(word)
      )).length,
    }))
    .filter(({ sharedWords }) => sharedWords > 0)
    .sort((left, right) => right.sharedWords - left.sharedWords
      || right.decision.lastTouchedTurn - left.decision.lastTouchedTurn);
  const [best, runnerUp] = ranked;
  return best && best.sharedWords > (runnerUp?.sharedWords || 0)
    ? best.decision
    : null;
}

function decisionCreationTurn(decision: SurgeConversationDecision) {
  const encodedTurn = decision.id.match(/^decision_(\d+)(?:_|$)/)?.[1];
  const parsedTurn = encodedTurn ? Number(encodedTurn) : Number.NaN;
  return Number.isSafeInteger(parsedTurn) ? parsedTurn : decision.lastTouchedTurn;
}

function compareDecisionCreationOrder(
  left: SurgeConversationDecision,
  right: SurgeConversationDecision,
) {
  return decisionCreationTurn(left) - decisionCreationTurn(right)
    || left.id.localeCompare(right.id);
}

function uniquelyAnchoredPriorDecision(
  message: string,
  decisions: readonly SurgeConversationDecision[],
) {
  const refersToDecision = /\b(?:back to|return to|earlier|previous|same|again|that|still|first|second|third|older|newer|latest|original)\b/i.test(message);
  const correction = explicitCorrectionPair(message);
  if (!refersToDecision && !correction) return null;
  const anchorValues = correction
    ? [correction.superseded]
    : concreteDecisionAnchors(message);
  for (const anchor of anchorValues) {
    const normalizedAnchor = normalizedDecisionReference(anchor);
    const concreteAnchor = concreteDecisionAnchors(anchor).length > 0;
    const matches = decisions.filter((decision) => concreteAnchor
      ? concreteDecisionAnchors(decisionText(decision))
        .some((candidate) => normalizedDecisionReference(candidate) === normalizedAnchor)
      : normalizedDecisionReference(decisionText(decision)).includes(normalizedAnchor));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function explicitlySelectedPriorDecision(
  message: string,
  decisions: readonly SurgeConversationDecision[],
  activeDecisionId: string,
) {
  if (decisions.length < 2) return null;
  const refersToDecision = /\b(?:back to|return to|earlier|previous|same|again|that|first|second|third|older|newer|latest|original)\b/i.test(message);
  const correction = explicitCorrectionPair(message);
  if (!refersToDecision && !correction) return null;
  const anchored = uniquelyAnchoredPriorDecision(message, decisions);
  if (anchored) return anchored;
  const decisionNoun = /\b(?:quote|option|proposal|system|unit|decision)\b/i.test(message);
  if (!decisionNoun) return null;
  if (/\b(?:first|older|earlier|original)\b/i.test(message)) return decisions[0] || null;
  if (/\bsecond\b/i.test(message)) return decisions[1] || null;
  if (/\bthird\b/i.test(message)) return decisions[2] || null;
  if (/\b(?:latest|newer)\b/i.test(message)) return decisions.at(-1) || null;
  if (/\bprevious\b/i.test(message)) {
    const activeIndex = decisions.findIndex((decision) => decision.id === activeDecisionId);
    return activeIndex > 0 ? decisions[activeIndex - 1] : decisions[0] || null;
  }
  return null;
}

function suppliesActiveComparisonAddendum(message: string) {
  return /\b(?:same|equal|identical|both)\b[^.!?]{0,90}\b(?:warrant(?:y|ies)|price|cost|installed|scope|inclusions?|exclusions?|brand|model|size|capacity)\b/i.test(message)
    || /\b(?:priority|prioritise|prioritize|prefer|preference|matters? most|most important)\b/i.test(message);
}

export function surgeMessageSuppliesSameSubjectConstraint(message: string) {
  if (message.includes("?")) return false;
  if (SURGE_EXPLICIT_SEPARATE_PROPERTY_CONTEXT_PATTERN.test(message)) return false;
  const firstPersonHomeContext = /\b(?:I|we|my|our)\b/i.test(message);
  const existingStateOrConstraint = /\b(?:still|already|existing|current|working|no longer|keep|installed|replaced|upgraded|fixed|repaired|added)\b/i.test(message)
    || /\b(?:do not|don['’]?t|does not|doesn['’]?t)\b[^.!?]{0,45}\b(?:want|need|plan|intend|replace|remove|change|upgrade)\b/i.test(message);
  const homeAsset = /\b(?:doors?|windows?|glazing|insulation|solar|panels?|batter(?:y|ies)|hot[- ]?water|heaters?|heating|reverse[- ]?cycle|splits?|air ?con(?:dition(?:er|ing))?|switchboard|exhaust|fans?|draught|draft)\b/i.test(message);
  return firstPersonHomeContext && existingStateOrConstraint && homeAsset;
}

function explicitlyIntroducesSeparateQuote(
  message: string,
  intent: SurgeConversationTurnIntent,
) {
  if (intent === "correction" || intent === "correction_and_topic_change") return false;
  if (/\b(?:back to|return(?:ing)? to|previous|earlier|correction|actually)\b/i.test(message)) return false;
  return /\b(?:different|new|another)\b[^.!?]{0,35}\b(?:quote|proposal|offer)\b/i.test(message)
    || /\bmy\s+(?:first|second|third)\b[^.!?]{0,35}\b(?:quote|proposal|offer)\b[^.!?]{0,25}\b(?:is|costs?|totals?|includes?|uses?|has)\b/i.test(message);
}

function selectedLedgerDecision(
  message: string,
  state: SurgeConversationState,
  subjectId: string,
  intent: SurgeConversationTurnIntent,
) {
  const ledger = state.ledger;
  if (!ledger) return null;
  const active = ledger.decisions.find((decision) => decision.id === ledger.activeDecisionId) || null;
  if (explicitlyIntroducesSeparateQuote(message, intent)) return null;
  const continuing = intent === "answer_to_follow_up"
    || intent === "contextual_follow_up"
    || intent === "clarification"
    || (intent === "correction" && !surgeConversationCorrectionReframesDecision(message));
  const topic = surgeConversationTopicFor(message);
  const subjectDecisions = ledger.decisions
    .filter((decision) => decision.subjectIds.includes(subjectId));
  const anchoredAcrossTopics = uniquelyAnchoredPriorDecision(message, subjectDecisions);
  if (anchoredAcrossTopics) return anchoredAcrossTopics;
  const lexicallyAnchoredAcrossTopics = lexicalPriorDecisionAnchor(message, subjectDecisions).decision;
  if (lexicallyAnchoredAcrossTopics) return lexicallyAnchoredAcrossTopics;
  const activeCrossTopicDecisionOwnsTopic = Boolean(active)
    && active?.topic === "general"
    && messageAsksCrossTopicDecision(active.goal)
    && surgeConversationTopicsFor(active.goal).includes(topic);
  const activeTopicCanOwnTechnologyDetails = active
    ? ["rebates_certificates", "bills_tariffs", "products_ratings"].includes(active.topic)
      || activeCrossTopicDecisionOwnsTopic
    : false;
  const activeDecisionCanOwnFacet = Boolean(active)
    && ["rebates_certificates", "bills_tariffs", "products_ratings"].includes(topic)
    && (topic === "products_ratings"
      || surgeConversationTopicsAreCompatible(topic, active?.topic || ""));
  const explicitlyAnchoredFacetDecision = continuing && activeDecisionCanOwnFacet
    ? uniquelyConcreteDecision(message, subjectDecisions)
      || uniquelyNamedDecision(message, subjectDecisions)
    : null;
  if (explicitlyAnchoredFacetDecision) return explicitlyAnchoredFacetDecision;
  const rankedSubjectDecisions = subjectDecisions
    .map((decision) => ({
      decision,
      score: decisionScore(message, topic, decision),
      sharedWords: decisionSharedWordCount(message, decision),
    }))
    .sort((left, right) => right.score - left.score
      || right.decision.lastTouchedTurn - left.decision.lastTouchedTurn);
  const chronologicalTopicDecisions = ledger.decisions.filter((decision) => (
    decision.subjectIds.includes(subjectId)
    && (!topic || decision.topic === topic || surgeConversationTopicsAreCompatible(topic, decision.topic))
  )).sort(compareDecisionCreationOrder);
  const explicitlySelected = explicitlySelectedPriorDecision(
    message,
    chronologicalTopicDecisions,
    ledger.activeDecisionId,
  );
  if (explicitlySelected) return explicitlySelected;
  if (RECALL_PATTERN.test(message)) {
    const [best, runnerUp] = rankedSubjectDecisions;
    const uniquelyBest = best?.sharedWords >= 2
      && (!runnerUp
        || best.score > runnerUp.score
        || best.sharedWords > runnerUp.sharedWords);
    if (uniquelyBest) return best.decision;
  }
  if (continuing
    && active?.subjectIds.includes(subjectId)
    && suppliesActiveComparisonAddendum(message)) {
    return active;
  }
  if (continuing
    && active?.subjectIds.includes(subjectId)
    && activeDecisionCanOwnFacet) {
    return active;
  }
  if (continuing
    && active?.subjectIds.includes(subjectId)
    && (!topic
      || topic === active.topic
      || activeCrossTopicDecisionOwnsTopic
      || (activeTopicCanOwnTechnologyDetails && surgeConversationTopicsAreCompatible(topic, active.topic)))) {
    const activeScore = decisionScore(message, topic, active);
    const activeSharedWords = decisionSharedWordCount(message, active);
    const strongerPriorDecision = rankedSubjectDecisions.find(({ decision, score, sharedWords }) => (
      decision.id !== active.id
      && decision.topic === active.topic
      && (score >= Math.max(3, activeScore + 2)
        || (sharedWords >= 2 && sharedWords > activeSharedWords))
    ));
    if (strongerPriorDecision) return strongerPriorDecision.decision;
    return active;
  }
  if (
    continuing
    && topic
    && active?.subjectIds.includes(subjectId)
    && topic !== active.topic
    && !surgeConversationTopicsAreCompatible(topic, active.topic)
    && !["products_ratings", "rebates_certificates", "bills_tariffs"].includes(topic)
  ) {
    const matchingTopicDecision = rankedSubjectDecisions.find(({ decision }) => decision.topic === topic)?.decision;
    if (matchingTopicDecision) return matchingTopicDecision;
    const relatesNewTopicToActiveDecision = /^(?:does|do|did|is|are|was|were|would|could|can|should)\s+(?:this|that|it)\b/i.test(message.trim());
    return relatesNewTopicToActiveDecision ? active : null;
  }
  const subjectOnlyReturn = /\bback to (?:my|our) (?:home|house|place|apartment|unit)\b/i.test(message);
  if (subjectOnlyReturn && topic) {
    return ledger.decisions
      .filter((decision) => decision.subjectIds.includes(subjectId) && decision.topic === topic)
      .sort((left, right) => right.lastTouchedTurn - left.lastTouchedTurn)[0] || null;
  }
  const explicitlyRevisitsPriorDecision = !subjectOnlyReturn
    && PRIOR_DECISION_REVISIT_PATTERN.test(message);
  if (!continuing && !explicitlyRevisitsPriorDecision) return null;
  return rankedSubjectDecisions[0]?.score >= 2 ? rankedSubjectDecisions[0].decision : null;
}

function surgeConversationAsksForWholeConversation(message: string) {
  const hasExplicitSubjectScope = /\bback to (?:my|our) (?:home|house|place|property|apartment|unit)\b/i.test(message)
    || /\b(?:about|for|at)\s+(?:(?:my|our|the)\s+)?(?:mum|mom|mother|dad|father|sister|brother|daughter|son|aunt|uncle|grandmother|grandma|nan|nanna|grandfather|grandpa|grandad|pop|friend|neighbou?r|landlord|tenant|client|customer)(?:['’]s)?(?:\s+(?:home|house|place|property|apartment|unit|site|job))?\b/i.test(message);
  if (hasExplicitSubjectScope) return false;
  return /\b(?:summari[sz]e|recap|review)\b[^.!?]{0,40}\b(?:our|the)?\s*(?:whole|entire|full)\s+(?:chat|conversation|discussion)\b/i.test(message)
    || /\b(?:everything|all)\b[^.!?]{0,40}\b(?:we|we['’]ve|we have)\s+(?:discussed|covered|talked about)\b/i.test(message)
    || /\b(?:summary|summari[sz]e|recap|review)\b[^.!?]{0,25}\b(?:of\s+)?(?:everything|all)\b[^.!?]{0,35}\bso far\b/i.test(message)
    || /\bwhat\s+(?:have|did)\s+we\s+(?:discuss(?:ed)?|cover(?:ed)?|talk(?:ed)? about)\b[^.!?]{0,25}\bso far\b/i.test(message);
}

function surgeConversationAsksForWholeSubject(message: string) {
  return /\b(?:whole (?:home|plan)|overall (?:plan|priority|priorities|starting point|recommendation)|top (?:three|3) (?:actions?|steps?|priorities|things|upgrades)|give me (?:an )?overall|put (?:everything|them all|all (?:the )?(?:issues|upgrades|options|things)) in order)\b/i.test(message)
    || /\b(?:everything|all (?:the )?(?:decisions|topics|upgrades|things|issues|details|answers))\b[^.!?]{0,90}\b(?:discussed|talked about|covered|mentioned|told you|earlier|priority|prioritise|prioritize|start|order)\b/i.test(message)
    || /\b(?:considering|based on|looking at)\b[^.!?]{0,35}\b(?:everything|all)\b[^.!?]{0,90}\b(?:home|house|issues|discussed|earlier)\b/i.test(message)
    || /\b(?:where|what)\b[^.!?]{0,30}\bstart\b[^.!?]{0,70}\b(?:everything|all|overall|home|house|issues|discussed)\b/i.test(message)
    || /\b(?:summari[sz]e|recap)\b[^.!?]{0,30}\b(?:everything|all)\b[^.!?]{0,30}\b(?:about|for)\b/i.test(message);
}

function surgeConversationAsksForWholeDecision(message: string) {
  return /\boverall\b[\s\S]{0,100}\b(?:quote|proposal|offer|deal|option|value|worth|good|reasonable|fair)\b/i.test(message)
    || /\b(?:quote|proposal|offer|deal|option)\b[\s\S]{0,100}\boverall\b/i.test(message);
}

function belongsToDecisionSynthesis(
  candidate: SurgeConversationDecision,
  anchor: SurgeConversationDecision,
) {
  if (candidate.id === anchor.id) return true;
  if (!candidate.subjectIds.some((subjectId) => anchor.subjectIds.includes(subjectId))) return false;
  if (!["products_ratings", "rebates_certificates", "bills_tariffs"].includes(candidate.topic)
    || !/\b(?:quote|finance|repayments?|price|fees?|admin|rebate|certificates?|STCs?|VEECs?|discount|switchboard|installed)\b/i.test(decisionText(candidate))) {
    return false;
  }
  const facetTopics = new Set(["products_ratings", "rebates_certificates", "bills_tariffs", "renters_strata"]);
  const technologyTopics = (decision: SurgeConversationDecision) => new Set([
    ...(facetTopics.has(decision.topic) || decision.topic === "general" ? [] : [decision.topic]),
    ...surgeConversationTopicsFor(decisionText(decision)).filter((topic) => !facetTopics.has(topic)),
  ]);
  const candidateTopics = technologyTopics(candidate);
  const anchorTopics = technologyTopics(anchor);
  return candidateTopics.size === 0
    || anchorTopics.size === 0
    || [...candidateTopics].some((topic) => anchorTopics.has(topic));
}

function sameSubjectQuoteComparison(
  message: string,
  state: SurgeConversationState,
  subjectId: string,
) {
  if (!(/\bcompare\b[^.!?]{0,60}\b(?:both|two|first\s+and\s+second)\s+(?:quotes?|proposals?|offers?)\b/i.test(message)
    || /\bwhich\b[^.!?]{0,40}\b(?:both|two)\s+(?:quotes?|proposals?|offers?)\b[^.!?]{0,30}\b(?:better|best|choose|pick)\b/i.test(message))) {
    return [];
  }
  const active = state.ledger?.decisions.find((decision) => decision.id === state.ledger?.activeDecisionId);
  const anchorTopic = active?.subjectIds.includes(subjectId) ? active.topic : "";
  const candidates = (state.ledger?.decisions || [])
    .filter((decision) => decision.subjectIds.includes(subjectId)
      && /\b(?:quote|proposal|offer)\b/i.test(decisionText(decision))
      && (!anchorTopic || decision.topic === anchorTopic))
    .sort(compareDecisionCreationOrder);
  if (/\bfirst\s+and\s+second\b/i.test(message)) return candidates.slice(0, 2);
  return candidates.length === 2 ? candidates : [];
}

export function selectSurgeConversationFrame(
  message: string,
  state: SurgeConversationState | null,
  hasPlanContext: boolean,
): SurgeConversationFrame {
  if (!state?.ledger) return {
    subject: null,
    subjects: [],
    decision: null,
    relatedDecisions: [],
    inactiveIndex: [],
  };
  if (hasAmbiguousRepeatedSubjectReference(message, state)) {
    return {
      subject: null,
      subjects: [],
      decision: null,
      relatedDecisions: [],
      inactiveIndex: state.ledger.decisions.map((candidate) => ({
        subjectLabel: state.ledger?.subjects.find((item) => candidate.subjectIds.includes(item.id))?.label || "Other context",
        topic: candidate.topic,
        decisionId: candidate.id,
      })),
    };
  }
  const identity = ledgerSubjectIdentity(message, state, hasPlanContext);
  const explicitlyNamedSubjects = explicitlyNamedSubjectIdentities(message, state)
    .map((candidate) => state.ledger?.subjects.find((subject) => subject.id === candidate.id))
    .filter((candidate): candidate is SurgeConversationSubject => Boolean(candidate));
  const crossSubjectDecision = explicitlyNamedSubjects.length > 1
    && /\b(?:and|both|each|compare|comparison|between|versus|vs\.?|which|priority|prioritise|prioritize|first)\b/i.test(message);
  let subjects = crossSubjectDecision
    ? explicitlyNamedSubjects
    : [state.ledger.subjects.find((candidate) => candidate.id === identity.id)]
      .filter((candidate): candidate is SurgeConversationSubject => Boolean(candidate));
  let subject = subjects.length === 1 ? subjects[0] : null;
  const intent = classifySurgeConversationTurn(message, state, []);
  let decision = crossSubjectDecision
    ? null
    : selectedLedgerDecision(message, state, identity.id, intent);
  if (!decision
    && identity.kind !== "general"
    && surgeMessageSuppliesSameSubjectConstraint(message)) {
    const activeDecision = state.ledger.decisions.find((candidate) => (
      candidate.id === state.ledger?.activeDecisionId
      && candidate.subjectIds.includes(identity.id)
    ));
    decision = activeDecision || null;
  }
  const asksForWholeConversation = surgeConversationAsksForWholeConversation(message);
  const asksForWholeSubject = surgeConversationAsksForWholeSubject(message);
  const asksForWholeDecision = surgeConversationAsksForWholeDecision(message);
  if (asksForWholeConversation) {
    subjects = [...state.ledger.subjects];
    subject = subjects.length === 1 ? subjects[0] : null;
    decision ||= state.ledger.decisions.find((candidate) => candidate.id === state.ledger?.activeDecisionId)
      || state.ledger.decisions[0]
      || null;
  }
  const continuesDecision = intent === "contextual_follow_up" || intent === "answer_to_follow_up" || intent === "clarification";
  const continuesWholeSubjectDecision = Boolean(decision?.facts.some((fact) => fact.key === "whole_subject_context"))
    && continuesDecision;
  const continuesMultiSubjectDecision = Boolean(decision && decision.subjectIds.length > 1) && continuesDecision;
  if ((continuesWholeSubjectDecision || continuesMultiSubjectDecision) && decision) {
    const decisionSubjectIds = new Set(decision.subjectIds);
    subjects = state.ledger.subjects.filter((candidate) => decisionSubjectIds.has(candidate.id));
    subject = subjects.length === 1 ? subjects[0] : null;
  }
  const comparedQuotes = !crossSubjectDecision && !asksForWholeConversation && subjects.length === 1
    ? sameSubjectQuoteComparison(message, state, subjects[0].id)
    : [];
  if (comparedQuotes.length === 2) {
    const comparisonIds = new Set(comparedQuotes.map((candidate) => candidate.id));
    const selectedDecision = comparedQuotes.find((candidate) => candidate.id === state.ledger?.activeDecisionId)
      || comparedQuotes.at(-1)
      || null;
    return {
      subject,
      subjects,
      decision: selectedDecision,
      relatedDecisions: comparedQuotes,
      inactiveIndex: state.ledger.decisions
        .filter((candidate) => !comparisonIds.has(candidate.id))
        .map((candidate) => ({
          subjectLabel: state.ledger?.subjects.find((item) => candidate.subjectIds.includes(item.id))?.label || "Other context",
          topic: candidate.topic,
          decisionId: candidate.id,
        })),
    };
  }
  const selectedSubjectIds = new Set(subjects.map((candidate) => candidate.id));
  const crossTopicDecision = messageAsksCrossTopicDecision(message);
  const mentionedTopics = new Set(surgeConversationTopicsFor(message));
  const selectedDecisionOwnsCrossTopic = Boolean(decision)
    && decision?.topic === "general"
    && messageAsksCrossTopicDecision(decision.goal);
  const selectedDecisionTopics = new Set(
    selectedDecisionOwnsCrossTopic ? surgeConversationTopicsFor(decision?.goal || "") : [],
  );
  const relatedDecisions = state.ledger.decisions
    .filter((candidate) => asksForWholeConversation
      || candidate.subjectIds.some((subjectId) => selectedSubjectIds.has(subjectId))
      || (asksForWholeDecision && Boolean(decision) && belongsToDecisionSynthesis(candidate, decision as SurgeConversationDecision)))
    .filter((candidate) => asksForWholeConversation
      || crossSubjectDecision
      || asksForWholeSubject
      || (asksForWholeDecision && Boolean(decision) && belongsToDecisionSynthesis(candidate, decision as SurgeConversationDecision))
      || continuesWholeSubjectDecision
      || candidate.id === decision?.id
      || (selectedDecisionOwnsCrossTopic && selectedDecisionTopics.has(candidate.topic))
      || (crossTopicDecision && mentionedTopics.has(candidate.topic)))
    .sort((left, right) => right.lastTouchedTurn - left.lastTouchedTurn)
    .slice(0, asksForWholeConversation || asksForWholeSubject || asksForWholeDecision || crossSubjectDecision
      || continuesWholeSubjectDecision || selectedDecisionOwnsCrossTopic
      ? SURGE_MAX_LEDGER_DECISIONS
      : 3);
  const activeIds = new Set(relatedDecisions.map((candidate) => candidate.id));
  const inactiveIndex = state.ledger.decisions
    .filter((candidate) => !activeIds.has(candidate.id))
    .map((candidate) => ({
      subjectLabel: state.ledger?.subjects.find((item) => candidate.subjectIds.includes(item.id))?.label || "Other context",
      topic: candidate.topic,
      decisionId: candidate.id,
    }));
  return { subject, subjects, decision, relatedDecisions, inactiveIndex };
}

export function filterSurgeRecentTurnsForFrame<
  T extends { role: "user" | "assistant"; content: string },
>(
  message: string,
  state: SurgeConversationState | null,
  hasPlanContext: boolean,
  recentTurns: readonly T[],
): T[] {
  if (!state?.ledger || !recentTurns.length) return [...recentTurns];
  const targetFrame = selectSurgeConversationFrame(message, state, hasPlanContext);
  if (targetFrame.subjects.length !== 1 || !targetFrame.decision) return [...recentTurns];
  const targetSubjectId = targetFrame.subjects[0].id;
  const targetDecisionId = targetFrame.decision.id;
  const targetDecisions = targetFrame.relatedDecisions.some((decision) => decision.id === targetDecisionId)
    ? targetFrame.relatedDecisions
    : [targetFrame.decision, ...targetFrame.relatedDecisions];
  const targetDecisionIds = new Set(targetDecisions.map((decision) => decision.id));
  const targetTopics = new Set(targetDecisions.flatMap((decision) => [
    decision.topic,
    ...surgeConversationTopicsFor(decisionText(decision)),
  ]).filter((topic) => topic && topic !== "general"));
  const topicMatchForTarget = (topics: readonly string[]) => {
    const exact = topics.some((topic) => targetTopics.has(topic));
    return {
      exact,
      compatible: exact || topics.some((topic) => (
        [...targetTopics].some((targetTopic) => surgeConversationTopicsAreCompatible(topic, targetTopic))
      )),
    };
  };
  const unresolvedExactTopicIsAmbiguous = (topics: readonly string[]) => topics.some((topic) => (
    targetTopics.has(topic)
    && (state.ledger?.decisions || []).some((decision) => (
      !targetDecisionIds.has(decision.id)
      && decision.subjectIds.includes(targetSubjectId)
      && new Set([decision.topic, ...surgeConversationTopicsFor(decisionText(decision))]).has(topic)
    ))
  ));
  let segmentMatchesTarget = true;
  let hasSeenDecisionBoundary = false;
  const filtered: T[] = [];
  const nonTargetSubjectMentioned = (content: string) => {
    const aliasesByPrefix: ReadonlyArray<readonly [string, string]> = [
      ["mums_home", "mum|mom|mother"],
      ["dads_home", "dad|father"],
      ["parents_home", "parents?"],
      ["sisters_home", "sister"],
      ["brothers_home", "brother"],
      ["daughters_home", "daughter"],
      ["sons_home", "son"],
      ["aunts_home", "aunt"],
      ["uncles_home", "uncle"],
      ["grandmothers_home", "grandmother|grandma|nan|nanna"],
      ["grandfathers_home", "grandfather|grandpa|grandad|pop"],
      ["friends_home", "friend"],
      ["neighbours_home", "neighbou?r"],
      ["landlords_home", "landlord"],
      ["tenants_home", "tenant"],
    ];
    return state.ledger?.subjects.some((subject) => {
      if (subject.id === targetSubjectId || subject.kind === "general") return false;
      const aliases = aliasesByPrefix.find(([prefix]) => subjectMatchesPrefix(subject, prefix))?.[1];
      if (aliases) {
        return new RegExp(`\\b(?:${aliases})(?:['’]s)?\\b`, "i").test(content)
          && !namedSubjectIsNegated(content, aliases);
      }
      const labelWords = [...normalizedLedgerWords(subject.label)];
      return labelWords.length > 0
        && labelWords.every((word) => normalizedLedgerWords(content).has(word));
    }) || false;
  };

  for (const turn of recentTurns) {
    if (turn.role === "user") {
      const explicitSubjectIds = explicitlyNamedSubjectIdentities(turn.content, state)
        .map((identity) => identity.id);
      const turnTopics = surgeConversationTopicsFor(turn.content);
      const explicitlyNamesOnlyTargetSubject = explicitSubjectIds.length === 1
        && explicitSubjectIds[0] === targetSubjectId;
      let rejectsTargetSubject = nonTargetSubjectMentioned(turn.content)
        || (explicitSubjectIds.length > 0 && !explicitlyNamesOnlyTargetSubject);
      if (!rejectsTargetSubject
        && SURGE_EXPLICIT_SEPARATE_PROPERTY_CONTEXT_PATTERN.test(turn.content)) {
        const separateFrame = selectSurgeConversationFrame(turn.content, state, hasPlanContext);
        rejectsTargetSubject = !separateFrame.subjects.some((subject) => subject.id === targetSubjectId);
        if (!rejectsTargetSubject && !turnTopics.length) segmentMatchesTarget = true;
      } else if (explicitlyNamesOnlyTargetSubject && !turnTopics.length) {
        segmentMatchesTarget = true;
      }
      if (rejectsTargetSubject) {
        segmentMatchesTarget = false;
        hasSeenDecisionBoundary = true;
      } else if (PRIOR_DECISION_REVISIT_PATTERN.test(turn.content)) {
        const revisitFrame = selectSurgeConversationFrame(turn.content, state, hasPlanContext);
        if (revisitFrame.decision) {
          segmentMatchesTarget = targetDecisionIds.has(revisitFrame.decision.id);
          hasSeenDecisionBoundary = true;
        }
      } else {
        if (turnTopics.length) {
          const topicMatch = topicMatchForTarget(turnTopics);
          if (!topicMatch.compatible) {
            segmentMatchesTarget = false;
            hasSeenDecisionBoundary = true;
          } else {
            const anchoredDecision = uniquelyConcreteDecision(turn.content, state.ledger?.decisions || [])
              || uniquelyNamedDecision(turn.content, state.ledger?.decisions || []);
            if (anchoredDecision) {
              segmentMatchesTarget = targetDecisionIds.has(anchoredDecision.id);
              hasSeenDecisionBoundary = true;
            } else if (explicitlyIntroducesSeparateQuote(
              turn.content,
              classifySurgeConversationTurn(turn.content, state, []),
            )) {
              segmentMatchesTarget = false;
              hasSeenDecisionBoundary = true;
            } else if (!hasSeenDecisionBoundary) {
              const historicalFrame = selectSurgeConversationFrame(turn.content, state, hasPlanContext);
              if (historicalFrame.decision) {
                segmentMatchesTarget = targetDecisionIds.has(historicalFrame.decision.id);
                hasSeenDecisionBoundary = true;
              } else if (!topicMatch.exact || unresolvedExactTopicIsAmbiguous(turnTopics)) {
                segmentMatchesTarget = false;
              }
            }
          }
        }
      }
    }
    if (segmentMatchesTarget) filtered.push(turn);
  }
  return filtered;
}

export function projectSurgeConversationStateToFrame(
  message: string,
  state: SurgeConversationState | null,
  hasPlanContext: boolean,
): SurgeConversationState | null {
  if (!state?.ledger) return state;
  const frame = selectSurgeConversationFrame(message, state, hasPlanContext);
  const subjectFacts = (frame.subject?.facts || [])
    .filter((fact) => fact.key !== "user_context")
    .map(({ key, value }) => ({ key, value: value.slice(0, 240) }));
  const decisionFacts = (frame.decision?.facts || [])
    .filter((fact) => fact.key !== "user_context")
    .map(({ key, value }) => ({ key, value: value.slice(0, 240) }));
  const facts = mergeSurgeConversationFacts(subjectFacts, decisionFacts).slice(-SURGE_MAX_FACTS);
  return {
    ...state,
    activeTopic: frame.decision?.topic || "general",
    goal: (frame.decision?.goal || "").slice(0, 240),
    facts,
    pendingQuestion: (frame.decision?.pendingQuestion || "").slice(0, 220),
    lastAnswerSummary: latestLedgerOutcomeSummary(frame.decision?.outcomeSummary || ""),
  };
}

function explicitCorrectionPair(message: string) {
  if (!/\b(?:actually|correction|sorry|read it wrong|not\b|rather than|from\b[^.!?]{0,40}\bto)\b/i.test(message)) return null;
  const postcodeCandidates = [...message.matchAll(
    /\b(?:post\s*code)(?:\s+is)?\s*[:#-]?\s*(\d{4})\b|\b(\d{4})\s+(?:post\s*code)\b/gi,
  )].map((match) => match[1] || match[2]).filter(Boolean);
  if (postcodeCandidates.length >= 2) {
    return {
      replacement: postcodeCandidates.at(-1) || "",
      superseded: postcodeCandidates[0],
    };
  }
  const correctionValueSource = String.raw`\$\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:kW|kWh|L|litres?|heads?|units?)\b|\b\d{4}\b`;
  const normalizeCorrectionValue = (value: string) => value.replace(/^\$\s+/, "$").trim();
  const valueImmediatelyBeforeNot = new RegExp(
    `((?:${correctionValueSource}))\\s*,?\\s*\\bnot\\s+((?:${correctionValueSource}))`,
    "i",
  ).exec(message);
  if (valueImmediatelyBeforeNot) {
    return {
      replacement: normalizeCorrectionValue(valueImmediatelyBeforeNot[1]),
      superseded: normalizeCorrectionValue(valueImmediatelyBeforeNot[2]),
    };
  }
  const candidates = [...message.matchAll(new RegExp(correctionValueSource, "gi"))]
    .map((match) => normalizeCorrectionValue(match[0]));
  if (candidates.length < 2) return null;
  const escaped = candidates.map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const notThenReplacement = new RegExp(`\\bnot\\s+${escaped[0]}[^.!?]{0,45}?(?:\\b(?:but|actually|instead)\\b|(?:it(?:'s| is)|should be))?[^.!?]{0,20}${escaped[1]}`, "i");
  const fromTo = new RegExp(`\\bfrom\\s+${escaped[0]}[^.!?]{0,30}\\bto\\s+${escaped[1]}`, "i");
  const oldWasActuallyNew = new RegExp(`${escaped[0]}[^.!?]{0,45}\\b(?:is|was|should be)\\s+(?:actually\\s+)?${escaped[1]}`, "i");
  const actuallyNewNotOld = new RegExp(`\\bactually\\b[^.!?]{0,30}${escaped[0]}[^.!?]{0,30}\\bnot\\s+${escaped[1]}`, "i");
  if (notThenReplacement.test(message) || fromTo.test(message) || oldWasActuallyNew.test(message)) {
    return { replacement: candidates[1], superseded: candidates[0] };
  }
  if (actuallyNewNotOld.test(message)) return { replacement: candidates[0], superseded: candidates[1] };
  return { replacement: candidates[0], superseded: candidates.at(-1) || "" };
}

function sharedQuotedPriceCorrection(message: string) {
  if (!/\b(?:actually|correction|sorry|copied|read it wrong|incorrect(?:ly)?)\b/i.test(message)) return "";
  const match = message.match(
    /\b(?:(?:they|the quotes?|the options?)\s+(?:are|cost)\s+both|both\s+(?:quotes?|options?)\s+(?:are|cost))\s*(\$\s*[\d,]+(?:\.\d+)?)/i,
  );
  return match?.[1]?.replace(/^\$\s+/, "$").trim() || "";
}

function explicitTenureCorrection(message: string): "owner" | "renter" | null {
  if (!/\b(?:actually|correction|sorry|not\b|rather than)\b/i.test(message)) return null;
  if (/\b(?:i|we)\s+(?:now\s+)?(?:rent|are renters?|are tenants?)\b|\brent(?:er)?\s+rather than\s+(?:own|owner)|\bnot (?:an? )?(?:owner|homeowner)\b/i.test(message)) {
    return "renter";
  }
  if (/\b(?:i|we)\s+(?:now\s+)?own(?:\s+the\s+home)?\b|\bown(?:er)?\s+rather than\s+rent|\bnot (?:a )?(?:renter|tenant)\b/i.test(message)) {
    return "owner";
  }
  return null;
}

function replaceTenureCorrection(value: string, message: string) {
  const tenure = explicitTenureCorrection(message);
  if (!tenure) return value;
  if (tenure === "renter") {
    return value
      .replace(/\b(?:i|we) own(?: the home)?\b/gi, (match) => match.toLowerCase().startsWith("we") ? "we rent the home" : "I rent the home")
      .replace(/\b(?:homeowner|owner)\b/gi, "renter");
  }
  return value
    .replace(/\b(?:i|we) rent(?: the home)?\b/gi, (match) => match.toLowerCase().startsWith("we") ? "we own the home" : "I own the home")
    .replace(/\b(?:renter|tenant)\b/gi, "owner");
}

function replaceExplicitCorrection(value: string, message: string) {
  const correction = explicitCorrectionPair(message);
  const quantityCorrected = correction && correction.replacement !== correction.superseded
    ? value.replaceAll(correction.superseded, correction.replacement)
    : value;
  const withoutCorrectionEcho = correction
    ? quantityCorrected.replace(
        new RegExp(
          `${correction.replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*\\bnot\\s+${correction.replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          "gi",
        ),
        () => correction.replacement,
      )
    : quantityCorrected;
  return replaceTenureCorrection(withoutCorrectionEcho, message);
}

function mergeLedgerFacts(
  prior: readonly SurgeConversationLedgerFact[],
  current: readonly SurgeConversationLedgerFact[],
) {
  const merged = [...prior];
  for (const fact of current) {
    const index = merged.findIndex((candidate) => candidate.key === fact.key);
    if (index >= 0) merged.splice(index, 1);
    merged.push(fact);
  }
  return merged;
}

function compactMemoryText(value: string, maximum: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maximum) return clean;
  if (maximum <= 1) return clean.slice(0, maximum);
  const candidate = clean.slice(0, maximum - 1).trimEnd();
  const wordBoundary = candidate.lastIndexOf(" ");
  const bounded = wordBoundary >= Math.floor(maximum * 0.6)
    ? candidate.slice(0, wordBoundary)
    : candidate;
  return bounded + "…";
}

function retainFirstAndNewestEntries(
  values: readonly string[],
  separator: string,
  maximum: number,
) {
  const entries = values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value, index, source) => (
      source.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index
    ));
  if (!entries.length) return "";
  const complete = entries.join(separator);
  if (complete.length <= maximum) return complete;
  if (entries.length === 1) return compactMemoryText(entries[0], maximum);

  const firstBudget = Math.max(96, Math.floor(maximum * 0.32));
  const first = compactMemoryText(entries[0], firstBudget);
  const newest: string[] = [];
  let used = first.length;
  for (let index = entries.length - 1; index >= 1; index -= 1) {
    const available = maximum - used - separator.length;
    if (available < 48) break;
    const entry = compactMemoryText(entries[index], available);
    newest.unshift(entry);
    used += separator.length + entry.length;
    if (entry.length < entries[index].length) break;
  }
  return [first, ...newest].join(separator).slice(0, maximum);
}

function userContextFact(
  prior: readonly SurgeConversationLedgerFact[],
  message: string,
  turn: number,
) {
  const previous = prior.find((fact) => fact.key === "user_context")?.value || "";
  const tenureCorrection = explicitTenureCorrection(message);
  const correctedParts = replaceExplicitCorrection(previous, message)
    .split(" | ")
    .filter((part) => !tenureCorrection || !/\b(?:owner|homeowner|renter|tenant|\bown\b|\brent\b)\b/i.test(part))
    .filter(Boolean);
  const correction = explicitCorrectionPair(message);
  const correctionParts = [
    correction ? `the current value is ${correction.replacement}` : "",
    tenureCorrection ? `tenure is ${tenureCorrection}` : "",
  ].filter(Boolean);
  const cleanMessage = correctionParts.length
    ? `Correction: ${correctionParts.join(" and ")}.`
    : message.replace(/\s+/g, " ").trim();
  if (!cleanMessage) return null;
  const combined = correctedParts.some((part) => part.toLowerCase() === cleanMessage.toLowerCase())
    ? correctedParts
    : [...correctedParts, cleanMessage];
  const bounded = retainFirstAndNewestEntries(combined, " | ", SURGE_MAX_USER_CONTEXT_CHARS);
  return { key: "user_context", value: bounded, source: "chat" as const, updatedTurn: turn };
}

function appendLedgerOutcomeSummary(prior: string, current: string) {
  const separator = "\n---\n";
  const latest = compactMemoryText(current, 360);
  const entries = prior
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (latest && entries.at(-1)?.toLowerCase() !== latest.toLowerCase()) entries.push(latest);
  const retained = entries.length <= 3
    ? entries
    : [entries[0], ...entries.slice(-2)];
  return retainFirstAndNewestEntries(retained, separator, 640);
}

function latestLedgerOutcomeSummary(value: string, maximum = 320) {
  return (value
    .split("\n---\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1) || "")
    .slice(0, maximum);
}

function compactLedger(ledger: SurgeConversationLedger) {
  const compactText = (value: string, maximum: number) => value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maximum);
  const compactDecisionMemory = (value: string, maximum: number) => {
    const clean = value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= maximum) return clean;
    const firstLength = Math.max(24, Math.floor(maximum * 0.55));
    const lastLength = Math.max(16, maximum - firstLength - 3);
    return `${clean.slice(0, firstLength).trim()} | ${clean.slice(-lastLength).trim()}`;
  };
  const turn = Number.isSafeInteger(ledger.turn)
    ? Math.max(0, Math.min(100_000, ledger.turn))
    : 0;
  const compactFact = (fact: SurgeConversationLedgerFact): SurgeConversationLedgerFact => ({
    key: compactText(fact.key, 48),
    value: compactText(fact.value, fact.key === "user_context" ? SURGE_MAX_USER_CONTEXT_CHARS : 240),
    source: fact.source === "plan" ? "plan" : fact.source === "derived" ? "derived" : "chat",
    updatedTurn: Number.isSafeInteger(fact.updatedTurn)
      ? Math.max(0, Math.min(turn, fact.updatedTurn))
      : turn,
  });
  const durableSavedPlanFactKeys = new Set(
    SURGE_PLAN_CONTEXT_CORRECTION_VALUES.map((correction) => `saved_plan_update_${correction}`),
  );
  const isDurableSavedPlanFact = (
    subject: Pick<SurgeConversationSubject, "id">,
    fact: SurgeConversationLedgerFact,
  ) => subject.id === "saved_home" && durableSavedPlanFactKeys.has(fact.key);
  const durableSavedPlanFacts = (subject: SurgeConversationSubject) => subject.facts
    .filter((fact) => isDurableSavedPlanFact(subject, fact))
    .sort((left, right) => right.updatedTurn - left.updatedTurn);
  const normalizedLedger: SurgeConversationLedger = {
    turn,
    activeDecisionId: compactText(ledger.activeDecisionId, 64),
    subjects: (Array.isArray(ledger.subjects) ? ledger.subjects : [])
      .map((subject) => ({
        ...subject,
        id: compactText(subject.id, 64),
        label: compactText(subject.label, 120),
        facts: (Array.isArray(subject.facts) ? subject.facts : []).map(compactFact),
        lastTouchedTurn: Number.isSafeInteger(subject.lastTouchedTurn)
          ? Math.max(0, Math.min(turn, subject.lastTouchedTurn))
          : turn,
      })),
    decisions: (Array.isArray(ledger.decisions) ? ledger.decisions : [])
      .map((decision) => ({
        ...decision,
        id: compactText(decision.id, 64),
        subjectIds: (Array.isArray(decision.subjectIds) ? decision.subjectIds : [])
          .slice(0, 3)
          .map((subjectId) => compactText(subjectId, 64)),
        topic: compactText(decision.topic, 48),
        goal: compactText(decision.goal, 300),
        facts: (Array.isArray(decision.facts) ? decision.facts : []).map(compactFact),
        outcomeSummary: compactText(decision.outcomeSummary, 640),
        openItems: (Array.isArray(decision.openItems) ? decision.openItems : [])
          .map((openItem) => compactText(openItem, 220))
          .filter(Boolean),
        pendingQuestion: compactText(decision.pendingQuestion, 220),
        lastTouchedTurn: Number.isSafeInteger(decision.lastTouchedTurn)
          ? Math.max(0, Math.min(turn, decision.lastTouchedTurn))
          : turn,
      })),
  };
  const rankedDecisions = [...normalizedLedger.decisions].sort((left, right) => {
    if (left.id === normalizedLedger.activeDecisionId) return -1;
    if (right.id === normalizedLedger.activeDecisionId) return 1;
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    return right.lastTouchedTurn - left.lastTouchedTurn;
  });
  let decisions = rankedDecisions.slice(0, SURGE_MAX_LEDGER_DECISIONS);
  let subjectIds = new Set(decisions.flatMap((decision) => decision.subjectIds));
  let subjects = normalizedLedger.subjects
    .filter((subject) => subjectIds.has(subject.id) || durableSavedPlanFacts(subject).length > 0)
    .sort((left, right) => (
      Number(durableSavedPlanFacts(right).length > 0)
      - Number(durableSavedPlanFacts(left).length > 0)
      || right.lastTouchedTurn - left.lastTouchedTurn
    ))
    .slice(0, SURGE_MAX_LEDGER_SUBJECTS);
  subjectIds = new Set(subjects.map((subject) => subject.id));
  decisions = decisions.filter((decision) => decision.subjectIds.every((subjectId) => subjectIds.has(subjectId)));
  const subjectFactKey = /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/;
  decisions = decisions.map((decision) => {
    const outcomeEntries = decision.outcomeSummary
      .split("\n---\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const retainedOutcomes = outcomeEntries.length <= (decision.id === normalizedLedger.activeDecisionId ? 3 : 2)
      ? outcomeEntries
      : decision.id === normalizedLedger.activeDecisionId
        ? [outcomeEntries[0], ...outcomeEntries.slice(-2)]
        : [outcomeEntries[0], outcomeEntries.at(-1) || ""];
    const compactOutcome = retainFirstAndNewestEntries(
      retainedOutcomes,
      "\n---\n",
      decision.id === normalizedLedger.activeDecisionId ? 640 : 320,
    );
    const contextFact = [...decision.facts]
      .filter((fact) => fact.key === "user_context")
      .sort((left, right) => right.updatedTurn - left.updatedTurn)[0];
    const facts = [
      ...(contextFact ? [{
        ...contextFact,
        value: compactDecisionMemory(contextFact.value, SURGE_MAX_USER_CONTEXT_CHARS),
      }] : []),
      ...[...decision.facts]
      .filter((fact) => fact.key !== "user_context" && !subjectFactKey.test(fact.key))
      .sort((left, right) => right.updatedTurn - left.updatedTurn)
      .slice(0, decision.id === normalizedLedger.activeDecisionId ? 6 : 4)
      .map((fact) => ({ ...fact, value: fact.value.slice(0, 240) })),
    ];
    const openItems = decision.openItems.map((item) => item.slice(0, 220));
    const pendingQuestion = decision.pendingQuestion
      ? decision.pendingQuestion.slice(0, 220)
      : "";
    if (pendingQuestion && !openItems.includes(pendingQuestion)) {
      openItems[openItems.length > 1 ? openItems.length - 1 : openItems.length] = pendingQuestion;
    }
    return {
      ...decision,
      goal: decision.goal.slice(0, 300),
      facts,
      outcomeSummary: compactOutcome,
      openItems,
      pendingQuestion,
      status: openItems.length ? "open" as const : "resolved" as const,
    };
  });
  const retainedContextFacts = decisions.filter((decision) => (
    decision.facts.some((fact) => fact.key === "user_context")
  )).length;
  const retainedDurableSavedPlanFacts = subjects.reduce(
    (count, subject) => count + durableSavedPlanFacts(subject).length,
    0,
  );
  let remainingFacts = Math.max(
    0,
    SURGE_MAX_LEDGER_FACTS - retainedContextFacts - retainedDurableSavedPlanFacts,
  );
  subjects = subjects.map((subject) => {
    const durableFacts = durableSavedPlanFacts(subject);
    const ordinaryFacts = [...subject.facts]
      .filter((fact) => !isDurableSavedPlanFact(subject, fact))
      .sort((left, right) => right.updatedTurn - left.updatedTurn)
      .slice(0, remainingFacts);
    remainingFacts -= ordinaryFacts.length;
    return { ...subject, facts: [...durableFacts, ...ordinaryFacts] };
  });
  decisions = decisions.map((decision) => {
    const contextFacts = decision.facts.filter((fact) => fact.key === "user_context").slice(0, 1);
    const otherFacts = decision.facts
      .filter((fact) => fact.key !== "user_context")
      .sort((left, right) => right.updatedTurn - left.updatedTurn)
      .slice(0, Math.max(0, remainingFacts));
    remainingFacts -= otherFacts.length;
    return { ...decision, facts: [...contextFacts, ...otherFacts] };
  });
  let remainingOpenItems = SURGE_MAX_LEDGER_OPEN_ITEMS;
  decisions = decisions.map((decision) => {
    const availableSlots = Math.max(0, remainingOpenItems);
    const openItems = decision.openItems.slice(0, availableSlots);
    if (
      decision.pendingQuestion
      && availableSlots > 0
      && !openItems.includes(decision.pendingQuestion)
    ) {
      openItems[openItems.length - 1] = decision.pendingQuestion;
    }
    remainingOpenItems -= openItems.length;
    const pendingQuestion = decision.pendingQuestion && openItems.includes(decision.pendingQuestion)
      ? decision.pendingQuestion
      : "";
    return {
      ...decision,
      openItems,
      pendingQuestion,
      status: openItems.length ? "open" as const : "resolved" as const,
    };
  });
  let compacted: SurgeConversationLedger = {
    ...normalizedLedger,
    activeDecisionId: decisions.some((decision) => decision.id === normalizedLedger.activeDecisionId)
      ? normalizedLedger.activeDecisionId
      : decisions[0]?.id || "",
    subjects,
    decisions,
  };
  while (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    const decisionWithRawContext = [...compacted.decisions]
      .filter((decision) => decision.facts.some((fact) => (
        fact.key === "user_context" && fact.value.length > 96
      )))
      .sort((left, right) => (
        Number(left.id === compacted.activeDecisionId) - Number(right.id === compacted.activeDecisionId)
        || left.lastTouchedTurn - right.lastTouchedTurn
      ))[0];
    if (decisionWithRawContext) {
      compacted = {
        ...compacted,
        decisions: compacted.decisions.map((decision) => decision.id === decisionWithRawContext.id
          ? {
              ...decision,
              facts: decision.facts.map((fact) => fact.key === "user_context"
                ? { ...fact, value: compactDecisionMemory(fact.value, 96) }
                : fact),
            }
          : decision),
      };
      continue;
    }
    const oldestDecisionWithLongOutcome = [...compacted.decisions]
      .filter((decision) => decision.id !== compacted.activeDecisionId && decision.outcomeSummary.length > 120)
      .sort((left, right) => left.lastTouchedTurn - right.lastTouchedTurn)[0];
    if (oldestDecisionWithLongOutcome) {
      compacted = {
        ...compacted,
        decisions: compacted.decisions.map((decision) => decision.id === oldestDecisionWithLongOutcome.id
          ? { ...decision, outcomeSummary: decision.outcomeSummary.slice(0, 120) }
          : decision),
      };
      continue;
    }
    const oldestDecisionWithFacts = [...compacted.decisions]
      .filter((decision) => decision.facts.some((fact) => fact.key !== "user_context"))
      .sort((left, right) => (
        Number(left.id === compacted.activeDecisionId) - Number(right.id === compacted.activeDecisionId)
        || left.lastTouchedTurn - right.lastTouchedTurn
      ))[0];
    if (oldestDecisionWithFacts) {
      const removableFact = [...oldestDecisionWithFacts.facts]
        .filter((fact) => fact.key !== "user_context")
        .sort((left, right) => left.updatedTurn - right.updatedTurn)[0];
      compacted = {
        ...compacted,
        decisions: compacted.decisions.map((decision) => decision.id === oldestDecisionWithFacts.id
          ? { ...decision, facts: decision.facts.filter((fact) => fact !== removableFact) }
          : decision),
      };
      continue;
    }
    const oldestSubjectWithFacts = [...compacted.subjects]
      .filter((subject) => subject.facts.some((fact) => !isDurableSavedPlanFact(subject, fact)))
      .sort((left, right) => left.lastTouchedTurn - right.lastTouchedTurn)[0];
    if (oldestSubjectWithFacts) {
      const removableFact = [...oldestSubjectWithFacts.facts]
        .filter((fact) => !isDurableSavedPlanFact(oldestSubjectWithFacts, fact))
        .sort((left, right) => left.updatedTurn - right.updatedTurn)[0];
      compacted = {
        ...compacted,
        subjects: compacted.subjects.map((subject) => subject.id === oldestSubjectWithFacts.id
          ? { ...subject, facts: subject.facts.filter((fact) => fact !== removableFact) }
          : subject),
      };
      continue;
    }
    break;
  }
  if (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    compacted = {
      ...compacted,
      subjects: compacted.subjects.map((subject) => ({
        ...subject,
        label: subject.label.slice(0, 80),
        facts: durableSavedPlanFacts(subject),
      })),
      decisions: compacted.decisions.map((decision) => ({
        ...decision,
        goal: decision.goal.slice(0, 96),
        facts: decision.facts
          .filter((fact) => fact.key === "user_context")
          .slice(0, 1)
          .map((fact) => ({ ...fact, value: compactDecisionMemory(fact.value, 72) })),
        outcomeSummary: decision.outcomeSummary.slice(0, 96),
        openItems: decision.pendingQuestion
          ? [decision.pendingQuestion.slice(0, 96)]
          : decision.openItems.slice(0, 1).map((item) => item.slice(0, 96)),
        pendingQuestion: decision.pendingQuestion.slice(0, 96),
        status: decision.openItems.length
          ? "open" as const
          : "resolved" as const,
      })),
    };
  }
  const pruneDecisionAt = (index: number) => {
    const decisions = compacted.decisions.filter((_, decisionIndex) => decisionIndex !== index);
    const referencedSubjectIds = new Set(decisions.flatMap((decision) => decision.subjectIds));
    compacted = {
      ...compacted,
      decisions,
      subjects: compacted.subjects.filter((subject) => (
        referencedSubjectIds.has(subject.id) || durableSavedPlanFacts(subject).length > 0
      )),
    };
  };
  while (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    let removableIndex = -1;
    for (let index = compacted.decisions.length - 1; index >= 0; index -= 1) {
      const candidate = compacted.decisions[index];
      if (candidate.id !== compacted.activeDecisionId && candidate.status === "resolved") {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex < 0) break;
    pruneDecisionAt(removableIndex);
  }
  if (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    compacted = {
      ...compacted,
      subjects: compacted.subjects.map((subject) => ({
        ...subject,
        label: "Context",
        facts: durableSavedPlanFacts(subject),
      })),
      decisions: compacted.decisions.map((decision) => ({
        ...decision,
        goal: decision.goal.slice(0, 48),
        facts: decision.facts
          .filter((fact) => fact.key === "user_context")
          .slice(0, 1)
          .map((fact) => ({ ...fact, value: compactDecisionMemory(fact.value, 48) })),
        outcomeSummary: decision.outcomeSummary.slice(0, 48),
        openItems: decision.pendingQuestion
          ? [decision.pendingQuestion.slice(0, 48)]
          : decision.openItems.slice(0, 1).map((item) => item.slice(0, 48)),
        pendingQuestion: decision.pendingQuestion.slice(0, 48),
        status: decision.openItems.length ? "open" as const : "resolved" as const,
      })),
    };
  }
  while (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    let removableIndex = -1;
    for (let index = compacted.decisions.length - 1; index >= 0; index -= 1) {
      if (compacted.decisions[index].id !== compacted.activeDecisionId) {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex < 0) break;
    pruneDecisionAt(removableIndex);
  }
  if (new TextEncoder().encode(JSON.stringify(compacted)).byteLength > SURGE_MAX_LEDGER_BYTES) {
    throw new Error("SURGE_CONVERSATION_LEDGER_TOO_LARGE");
  }
  return compacted;
}

export function updateSurgeConversationLedger(
  state: SurgeConversationState,
  update: SurgeConversationLedgerUpdate,
): SurgeConversationState {
  if (update.recordTurn === false) return state;
  if (hasAmbiguousRepeatedSubjectReference(update.message, state)) return state;
  const ledger: SurgeConversationLedger = state.ledger || {
    turn: 0,
    activeDecisionId: "",
    subjects: [],
    decisions: [],
  };
  const turn = ledger.turn + 1;
  let ledgerDecisions = [...ledger.decisions];
  const explicitlyNamedSubjects = explicitlyNamedSubjectIdentities(update.message, state);
  const crossSubjectIdentities = explicitlyNamedSubjects.length > 1
    ? explicitlyNamedSubjects
    : [];
  const forcedSavedHomeIdentity = update.forceSavedHomeSubject || update.savedHomeCorrectionFacts?.length
    ? { id: "saved_home", kind: "saved_home" as const, label: "Saved home" }
    : null;
  const identity = crossSubjectIdentities[0]
    || forcedSavedHomeIdentity
    || ledgerSubjectIdentity(update.message, state, update.planFacts.length > 0);
  let subjects = [...ledger.subjects];
  for (const namedIdentity of crossSubjectIdentities) {
    if (!subjects.some((candidate) => candidate.id === namedIdentity.id)) {
      subjects.push({ ...namedIdentity, facts: [], lastTouchedTurn: turn });
    }
  }
  let subject = subjects.find((candidate) => candidate.id === identity.id);
  const planFacts = identity.kind === "saved_home"
    ? update.planFacts
      .filter((fact) => /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/.test(fact.key))
      .map((fact) => ({ ...fact, source: "plan" as const, updatedTurn: turn }))
    : [];
  const exactAllPlanFacts = new Set(update.planFacts.map((fact) => `${fact.key}\u0000${fact.value}`));
  const savedHomeCorrectionFacts = identity.kind === "saved_home"
    ? (update.savedHomeCorrectionFacts || []).map((fact) => ({
        ...fact,
        value: fact.value.slice(0, 220),
        source: "chat" as const,
        updatedTurn: turn,
      }))
    : [];
  const exactPlanFacts = new Set(planFacts.map((fact) => `${fact.key}\u0000${fact.value}`));
  const priorActiveDecision = ledger.decisions.find((decision) => decision.id === ledger.activeDecisionId);
  const continuesSameSubject = priorActiveDecision?.subjectIds.includes(identity.id) || false;
  const bootstrapsLegacyConversation = ledger.subjects.length === 0 && ledger.decisions.length === 0;
  const subjectStateFacts = crossSubjectIdentities.length
    ? []
    : identity.kind === "saved_home" || continuesSameSubject || bootstrapsLegacyConversation
      ? update.modelState.facts
      : surgeConversationFactsFromMessage(update.message);
  const subjectChatFacts = subjectStateFacts
    .filter((fact) => /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/.test(fact.key))
    .map((fact) => ({
      ...fact,
      source: exactPlanFacts.has(`${fact.key}\u0000${fact.value}`) ? "plan" as const : "chat" as const,
      updatedTurn: turn,
    }));
  const explicitPostcode = crossSubjectIdentities.length
    ? undefined
    : surgeConversationFactsFromMessage(update.message)
    .find((fact) => fact.key === "postcode");
  if (explicitPostcode) {
    const postcodeIndex = subjectChatFacts.findIndex((fact) => fact.key === "postcode");
    const postcodeFact = { ...explicitPostcode, source: "chat" as const, updatedTurn: turn };
    if (postcodeIndex >= 0) subjectChatFacts[postcodeIndex] = postcodeFact;
    else subjectChatFacts.push(postcodeFact);
  }
  const explicitTenure = crossSubjectIdentities.length
    ? null
    : explicitTenureCorrection(update.message);
  if (explicitTenure) {
    const tenureIndex = subjectChatFacts.findIndex((fact) => fact.key === "tenure");
    const tenureFact = { key: "tenure", value: explicitTenure, source: "chat" as const, updatedTurn: turn };
    if (tenureIndex >= 0) subjectChatFacts[tenureIndex] = tenureFact;
    else subjectChatFacts.push(tenureFact);
  }
  if (!subject) {
    subject = {
      ...identity,
      facts: mergeLedgerFacts(planFacts, [...subjectChatFacts, ...savedHomeCorrectionFacts]),
      lastTouchedTurn: turn,
    };
    subjects.push(subject);
  } else {
    subject = {
      ...subject,
      facts: mergeLedgerFacts(subject.facts, [
        ...planFacts,
        ...subjectChatFacts,
        ...savedHomeCorrectionFacts,
      ]),
      lastTouchedTurn: turn,
    };
    subjects = subjects.map((candidate) => candidate.id === subject?.id ? subject : candidate);
  }
  if (crossSubjectIdentities.length) {
    const touchedSubjectIds = new Set(crossSubjectIdentities.map((candidate) => candidate.id));
    const scopedFacts = subjectScopedFactsFromMessage(update.message, crossSubjectIdentities, turn);
    subjects = subjects.map((candidate) => touchedSubjectIds.has(candidate.id)
      ? {
          ...candidate,
          facts: mergeLedgerFacts(candidate.facts, scopedFacts.get(candidate.id) || []),
          lastTouchedTurn: turn,
        }
      : candidate);
  }

  const correctionPair = crossSubjectIdentities.length
    ? null
    : explicitCorrectionPair(update.message);
  const sharedQuotePrice = crossSubjectIdentities.length
    ? ""
    : sharedQuotedPriceCorrection(update.message);
  const explicitlyCorrectsSingleSubject = crossSubjectIdentities.length === 0
    && (update.intent === "correction"
      || update.intent === "correction_and_topic_change"
      || Boolean(correctionPair)
      || Boolean(sharedQuotePrice)
      || Boolean(explicitTenure));
  const selectedCorrectionDecision = explicitlyCorrectsSingleSubject
    ? selectedLedgerDecision(update.message, state, identity.id, update.intent)
    : null;
  const activeCorrectionDecision = explicitlyCorrectsSingleSubject
    ? ledger.decisions.find((candidate) => (
      candidate.id === ledger.activeDecisionId && candidate.subjectIds.includes(identity.id)
    )) || null
    : null;
  const correctionTargetId = selectedCorrectionDecision?.id || activeCorrectionDecision?.id || "";
  const subjectWideCorrectionKey = /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/;
  const replacementSubjectIds = crossSubjectIdentities.length
    ? crossSubjectIdentities.map((candidate) => candidate.id)
    : explicitlyCorrectsSingleSubject
      ? [identity.id]
      : [];
  const replacements: Array<{
    subjectId: string;
    key: string;
    priorValue: string;
    nextValue: string;
  }> = replacementSubjectIds.flatMap((subjectId) => {
    const priorSubject = ledger.subjects.find((candidate) => candidate.id === subjectId);
    const nextSubject = subjects.find((candidate) => candidate.id === subjectId);
    return (nextSubject?.facts || []).flatMap((nextFact) => {
      const priorValue = priorSubject?.facts.find((fact) => fact.key === nextFact.key)?.value;
      return priorValue && priorValue !== nextFact.value
        ? [{ subjectId, key: nextFact.key, priorValue, nextValue: nextFact.value }]
        : [];
    });
  });
  if (explicitlyCorrectsSingleSubject && correctionPair
    && correctionPair.replacement !== correctionPair.superseded) {
    replacements.push({
      subjectId: identity.id,
      key: "explicit_value",
      priorValue: correctionPair.superseded,
      nextValue: correctionPair.replacement,
    });
  }
  if (sharedQuotePrice && correctionTargetId) {
    const correctionDecision = ledgerDecisions.find((candidate) => candidate.id === correctionTargetId);
    for (const fact of correctionDecision?.facts || []) {
      if (!/^quote_[a-z0-9]+$/i.test(fact.key)) continue;
      const priorPrice = fact.value
        .match(/\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/)?.[0]
        ?.replace(/^\$\s+/, "$");
      if (priorPrice && priorPrice !== sharedQuotePrice) {
        replacements.push({
          subjectId: identity.id,
          key: fact.key,
          priorValue: priorPrice,
          nextValue: sharedQuotePrice,
        });
      }
    }
  }
  if (explicitlyCorrectsSingleSubject) {
    const correctionFacts = mergeSurgeConversationFacts(
      update.modelState.facts,
      surgeConversationFactsFromMessage(update.message, update.modelState.activeTopic),
    ).filter((fact) => !/^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size|proposed_or_quoted_details|user_context)$/.test(fact.key));
    for (const nextFact of correctionFacts) {
      const priorValues = [...new Set(ledgerDecisions
        .filter((candidate) => candidate.subjectIds.includes(identity.id))
        .flatMap((candidate) => candidate.facts
          .filter((fact) => fact.key === nextFact.key)
          .map((fact) => fact.value)))]
        .filter((value) => value !== nextFact.value);
      if (priorValues.length === 1) {
        replacements.push({
          subjectId: identity.id,
          key: nextFact.key,
          priorValue: priorValues[0],
          nextValue: nextFact.value,
        });
      }
    }
  }
  const uniqueReplacements = [...new Map(replacements.map((replacement) => [
    `${replacement.subjectId}\u0000${replacement.key}\u0000${replacement.priorValue}\u0000${replacement.nextValue}`,
    replacement,
  ])).values()];
  const replaceCorrectionValues = (
    value: string,
    applicable: typeof uniqueReplacements,
  ) => {
    const corrected = applicable
      .filter((replacement) => !/^(?:tenure|ownership)$/.test(replacement.key))
      .reduce(
        (current, replacement) => current.replaceAll(replacement.priorValue, replacement.nextValue),
        value,
      );
    return applicable.some((replacement) => /^(?:tenure|ownership)$/.test(replacement.key))
      ? replaceTenureCorrection(corrected, update.message)
      : corrected;
  };
  if (uniqueReplacements.length) {
    ledgerDecisions = ledgerDecisions.map((candidate) => {
      const applicable = uniqueReplacements.filter((replacement) => (
        candidate.subjectIds.includes(replacement.subjectId)
        && (subjectWideCorrectionKey.test(replacement.key) || candidate.id === correctionTargetId)
        && !candidate.subjectIds.some((subjectId) => subjectId !== replacement.subjectId
          && subjects.find((subjectItem) => subjectItem.id === subjectId)?.facts
            .some((fact) => fact.value === replacement.priorValue))
      ));
      if (!applicable.length) return candidate;
      const replaceValues = (value: string) => replaceCorrectionValues(value, applicable);
      return {
        ...candidate,
        goal: replaceValues(candidate.goal),
        facts: candidate.facts.map((fact) => ({
          ...fact,
          value: replaceValues(fact.value),
          updatedTurn: turn,
        })),
        outcomeSummary: replaceValues(candidate.outcomeSummary),
        openItems: candidate.openItems.map(replaceValues),
        pendingQuestion: replaceValues(candidate.pendingQuestion),
        lastTouchedTurn: turn,
      };
    });
  }

  const existingState = { ...state, ledger: { ...ledger, subjects, decisions: ledgerDecisions } };
  const serviceEnquiryDecision = update.modelState.activeTopic === "service_enquiry";
  const crossTopicDecision = !serviceEnquiryDecision && messageAsksCrossTopicDecision(update.message);
  const createsCombinedDecision = crossTopicDecision || crossSubjectIdentities.length > 1;
  const correctionStartsNewDecision = update.intent === "correction_and_topic_change"
    || (update.intent === "correction"
      && (surgeConversationCorrectionReframesDecision(update.message)
        || /\b(?:isn['’]?t|is not|not the (?:whole|main|actual)|the (?:real|actual) (?:issue|problem))\b/i.test(update.message)));
  const selectedPriorDecision = createsCombinedDecision
    ? null
    : correctionTargetId && !correctionStartsNewDecision
      ? ledgerDecisions.find((candidate) => candidate.id === correctionTargetId) || null
      : selectedLedgerDecision(update.message, existingState, subject.id, update.intent);
  const priorDecision = serviceEnquiryDecision && selectedPriorDecision?.topic !== "service_enquiry"
    ? ledgerDecisions
      .filter((candidate) => candidate.topic === "service_enquiry" && candidate.subjectIds.includes(subject.id))
      .sort((left, right) => right.lastTouchedTurn - left.lastTouchedTurn)[0] || null
    : selectedPriorDecision;
  const topic = serviceEnquiryDecision
    ? "service_enquiry"
    : createsCombinedDecision
    ? "general"
    : update.modelState.activeTopic !== "general"
      ? update.modelState.activeTopic
      : surgeConversationTopicFor(update.message) || priorDecision?.topic || "general";
  const decisionId = priorDecision?.id
    || `decision_${turn}_${topic}`.replace(/[^a-z0-9_]+/gi, "_").toLowerCase().slice(0, 64);
  const correctionReframes = correctionStartsNewDecision;
  const compatibleTopicExpansion = Boolean(priorDecision)
    && topic !== priorDecision?.topic
    && surgeConversationTopicsAreCompatible(topic, priorDecision?.topic || "");
  const revisitsInactiveDecisionWithSpecificTopic = Boolean(priorDecision)
    && priorDecision?.id !== ledger.activeDecisionId
    && Boolean(surgeConversationTopicFor(update.message));
  const expandsCurrentDecisionGoal = Boolean(priorDecision)
    && topic === priorDecision?.topic
    && (update.intent === "contextual_follow_up" || update.intent === "clarification")
    && materiallyExpandsDecisionGoal(update.message, priorDecision as SurgeConversationDecision);
  const preservesGoal = Boolean(priorDecision)
    && update.intent !== "topic_change"
    && update.intent !== "correction_and_topic_change"
    && !correctionReframes
    && !compatibleTopicExpansion
    && !revisitsInactiveDecisionWithSpecificTopic
    && !expandsCurrentDecisionGoal;
  const priorGoal = priorDecision?.goal || "";
  const nextGoal = (update.modelState.goal || update.message).slice(0, 300);
  const goal = serviceEnquiryDecision
    ? nextGoal
    : preservesGoal
      ? replaceExplicitCorrection(priorGoal, update.message)
      : expandsCurrentDecisionGoal && priorGoal
        ? boundedCombinedGoal(priorGoal, update.message)
        : compatibleTopicExpansion && priorGoal
          ? boundedCombinedGoal(priorGoal, nextGoal)
        : nextGoal;
  const subjectFactKey = /^(?:postcode|state_or_territory|tenure|ownership|property_type|household_size)$/;
  const currentDecisionReplacements = correctionTargetId && priorDecision?.id === correctionTargetId
    ? uniqueReplacements.filter((replacement) => (
        replacement.subjectId === identity.id
        || subjectWideCorrectionKey.test(replacement.key)
      ))
    : [];
  const explicitMessageFacts = surgeConversationFactsFromMessage(update.message, topic);
  const exactExplicitMessageFacts = new Set(explicitMessageFacts.map((fact) => `${fact.key}\u0000${fact.value}`));
  const selectedSubjectIds = crossSubjectIdentities.length
    ? crossSubjectIdentities.map((candidate) => candidate.id)
    : [identity.id];
  const selectedSubjectIdSet = new Set(selectedSubjectIds);
  const selectedSubjectDecisionFacts = ledgerDecisions
    .filter((candidate) => (
      candidate.subjectIds.length === selectedSubjectIdSet.size
      && candidate.subjectIds.every((subjectId) => selectedSubjectIdSet.has(subjectId))
    ))
    .flatMap((candidate) => candidate.facts);
  const selectedSubjectFacts = selectedSubjectIds.length === 1
    ? subjects.find((candidate) => candidate.id === identity.id)?.facts || []
    : [];
  const retainedFacts = [
    ...selectedSubjectDecisionFacts,
    ...selectedSubjectFacts,
  ];
  const modelStateFacts = update.modelState.facts.map((fact) => {
    const explicitlySupplied = exactExplicitMessageFacts.has(`${fact.key}\u0000${fact.value}`)
      || (/^(?:first_stage_)?budget$/i.test(fact.key)
        && budgetFactMatchesExplicitMessage(fact.value, update.message));
    if (explicitlySupplied) return { ...fact, source: "chat" as const, updatedTurn: turn };
    const retained = retainedFacts
      .filter((candidate) => candidate.key === fact.key && candidate.value === fact.value)
      .sort((left, right) => right.updatedTurn - left.updatedTurn)[0];
    if (retained) return { ...fact, source: retained.source, updatedTurn: retained.updatedTurn };
    if (exactAllPlanFacts.has(`${fact.key}\u0000${fact.value}`)) {
      return { ...fact, source: "plan" as const, updatedTurn: turn };
    }
    return { ...fact, source: "derived" as const, updatedTurn: turn };
  });
  const currentFacts = [
    ...modelStateFacts,
    ...explicitMessageFacts
      .map((fact) => ({ ...fact, source: "chat" as const, updatedTurn: turn })),
    ...(update.derivedFacts || [])
      .map((fact) => ({ ...fact, source: "derived" as const, updatedTurn: turn })),
  ]
    .filter((fact) => !subjectFactKey.test(fact.key))
    .map((fact) => ({
      ...fact,
      value: replaceCorrectionValues(
        replaceExplicitCorrection(fact.value, update.message),
        currentDecisionReplacements,
      ),
    }));
  const contextFact = crossSubjectIdentities.length
    ? null
    : userContextFact(priorDecision?.facts || [], update.message, turn);
  const multiSubjectContextFact = crossSubjectIdentities.length
    ? {
        key: "multi_subject_context",
        value: crossSubjectIdentities.map((identityItem) => {
          const subjectItem = subjects.find((candidate) => candidate.id === identityItem.id);
          const facts = (subjectItem?.facts || []).map((fact) => `${fact.key}: ${fact.value}`).join(", ");
          return facts ? `${identityItem.label}: ${facts}` : identityItem.label;
        }).join("; ").slice(0, 240),
        source: "chat" as const,
        updatedTurn: turn,
      }
    : null;
  const wholeSubjectContextFact = surgeConversationAsksForWholeSubject(update.message)
    ? {
        key: "whole_subject_context",
        value: "This decision was based on every retained decision for the selected subject or subjects.",
        source: "chat" as const,
        updatedTurn: turn,
      }
    : null;
  const remainingOpenItems = update.intent === "answer_to_follow_up"
    ? (priorDecision?.openItems || []).filter((item) => item !== priorDecision?.pendingQuestion)
    : [...(priorDecision?.openItems || [])];
  if (update.followUpQuestion && !remainingOpenItems.some((item) => item.toLowerCase() === update.followUpQuestion.toLowerCase())) {
    remainingOpenItems.push(update.followUpQuestion.slice(0, 220));
  }
  const openItems = remainingOpenItems.slice(-4);
  const decision: SurgeConversationDecision = {
    id: decisionId,
    subjectIds: crossSubjectIdentities.length
      ? crossSubjectIdentities.map((candidate) => candidate.id)
      : priorDecision?.subjectIds || [subject.id],
    topic: priorDecision?.topic || topic,
    goal,
    facts: mergeLedgerFacts(
      priorDecision?.facts || [],
      [
        ...currentFacts,
        ...(contextFact ? [contextFact] : []),
        ...(multiSubjectContextFact ? [multiSubjectContextFact] : []),
        ...(wholeSubjectContextFact ? [wholeSubjectContextFact] : []),
      ],
    ),
    outcomeSummary: appendLedgerOutcomeSummary(
      update.intent === "correction" || update.intent === "correction_and_topic_change"
        ? ""
        : priorDecision?.outcomeSummary || "",
      update.answerSummary,
    ),
    openItems,
    pendingQuestion: update.followUpQuestion.slice(0, 220),
    status: openItems.length ? "open" : "resolved",
    lastTouchedTurn: turn,
  };
  const decisions = priorDecision
    ? ledgerDecisions.map((candidate) => candidate.id === priorDecision.id ? decision : candidate)
    : [...ledgerDecisions, decision];
  const nextLedger = compactLedger({
    turn,
    activeDecisionId: decision.id,
    subjects,
    decisions,
  });
  return {
    ...state,
    activeTopic: decision.topic,
    goal: decision.goal.slice(0, 240),
    facts: mergeSurgeConversationFacts(
      (crossSubjectIdentities.length ? [] : subject.facts)
        .map(({ key, value }) => ({ key, value: value.slice(0, 240) })),
      decision.facts
        .filter((fact) => fact.key !== "user_context")
        .map(({ key, value }) => ({ key, value: value.slice(0, 240) })),
    ).slice(-SURGE_MAX_FACTS),
    pendingQuestion: decision.pendingQuestion,
    lastAnswerSummary: latestLedgerOutcomeSummary(decision.outcomeSummary),
    ledger: nextLedger,
  };
}
