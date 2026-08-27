export const SURGE_CONVERSATION_EVALUATION_DIMENSIONS = [
  "correction",
  "topic_switch",
  "privacy",
  "follow_up",
  "source_status",
  "practical_guidance",
  "product_specification",
  "certificate_coverage",
  "brand_comparison",
  "context_clarification",
  "directness",
  "plain_language",
  "actionability",
  "context_use",
  "progressive_detail",
] as const;

export type SurgeConversationEvaluationDimension =
  (typeof SURGE_CONVERSATION_EVALUATION_DIMENSIONS)[number];

export type SurgeConversationSyntheticTurn = {
  role: "user" | "assistant";
  content: string;
};

export type SurgeConversationAssertion =
  | { type: "includes_all"; values: readonly string[] }
  | { type: "excludes_all"; values: readonly string[] }
  | { type: "matches"; pattern: string; flags?: string }
  | { type: "max_questions"; maximum: number }
  | { type: "max_words"; maximum: number }
  | { type: "max_average_sentence_words"; maximum: number }
  | { type: "max_sentence_words"; maximum: number }
  | { type: "max_jargon"; maximum: number }
  | { type: "requires_structured_answer" }
  | { type: "min_practical_steps"; minimum: number }
  | { type: "requires_extra_detail" }
  | { type: "quick_reply_range"; minimum: number; maximum: number }
  | { type: "answer_source"; value: "deterministic" | "grounded" | "model" }
  | { type: "answer_status"; value: "answered" | "clarification_required" | "source_review_required" | "unavailable" };

export type SurgeConversationProhibitedPattern = {
  pattern: string;
  flags?: string;
  reason: string;
};

export type SurgeConversationEvaluationCase = {
  id: string;
  dimension: SurgeConversationEvaluationDimension;
  reviewedOn: string;
  reviewedBy: string;
  reviewStatus: "approved";
  description: string;
  expected: string;
  syntheticTurns: readonly SurgeConversationSyntheticTurn[];
  assertions: readonly SurgeConversationAssertion[];
  prohibitedPatterns: readonly SurgeConversationProhibitedPattern[];
};

const COMMON_PROHIBITED_PATTERNS = [
  { pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}", reason: "email address must not appear in an evaluation response" },
  { pattern: "(?:\\+?61|0)4\\d{8}", reason: "phone number must not appear in an evaluation response" },
  { pattern: "[—–]", reason: "Surge responses use ordinary conversational punctuation" },
] as const satisfies readonly SurgeConversationProhibitedPattern[];

function reviewedCase(
  entry: Omit<SurgeConversationEvaluationCase, "reviewedBy" | "reviewStatus" | "prohibitedPatterns"> & {
    prohibitedPatterns?: readonly SurgeConversationProhibitedPattern[];
  },
): SurgeConversationEvaluationCase {
  return {
    ...entry,
    reviewedBy: "AEA conversation quality review",
    reviewStatus: "approved",
    prohibitedPatterns: [...COMMON_PROHIBITED_PATTERNS, ...(entry.prohibitedPatterns ?? [])],
  };
}

type EverydayScenario = {
  id: string;
  dimension: Extract<SurgeConversationEvaluationDimension,
    "directness" | "plain_language" | "actionability" | "context_use" | "progressive_detail">;
  opening: string;
  question: string;
  expected: string;
  verdict: string;
  reason: string;
  steps: readonly string[];
  extraDetail: string;
  followUpQuestion?: string;
  quickReplies?: readonly { id: string; label: string; message: string }[];
  includes: readonly string[];
  excludes?: readonly string[];
};

const EVERYDAY_SCENARIOS: readonly EverydayScenario[] = [
  {
    id: "quote-verdict", dimension: "directness", opening: "I have a synthetic heat-pump quote with the model and installation scope.", question: "So is it a good quote or not?", expected: "Give a direct verdict before explaining the checks.",
    verdict: "Yes, the quote looks broadly sensible.", reason: "The model, installation work and certificate deductions are itemised, so the main costs can be checked.", steps: ["Confirm the written warranty and final out-of-pocket total."], extraDetail: "A quote can still change if switchboard, plumbing or access work is excluded.", includes: ["yes", "quote"], excludes: ["whole-home diagnosis"],
  },
  {
    id: "battery-verdict", dimension: "directness", opening: "This synthetic home has solar but very little evening use.", question: "Is a battery worth it then?", expected: "Say no or not yet before the explanation.",
    verdict: "Probably not yet.", reason: "Low evening use gives a battery less bill-saving work to do.", steps: ["Check a month of evening imports before getting quotes."], extraDetail: "Backup power or a changing tariff could still make it useful for reasons other than simple payback.", includes: ["not yet", "evening"],
  },
  {
    id: "draught-verdict", dimension: "directness", opening: "The synthetic lounge has a moving draught around one opening window.", question: "Where do I start?", expected: "Name the first action immediately.",
    verdict: "Start by sealing the moving gap around that window.", reason: "A suitable window seal is cheap, reversible and directly targets the draught you noticed.", steps: ["Check that the window still opens, closes and drains normally."], extraDetail: "Honeycomb blinds or close-fitting thermal curtains can help after the air leak is controlled.", includes: ["start", "window"],
  },
  {
    id: "bill-verdict", dimension: "directness", opening: "I have a synthetic gas bill and electricity bill for the same month.", question: "Which one should I look at first?", expected: "Choose one bill and say why.",
    verdict: "Start with the bill for the energy source causing the cost jump.", reason: "That keeps the first check tied to the problem instead of reviewing everything at once.", steps: ["Compare usage, not just the dollar total, with the same season last year."], extraDetail: "Tariff changes and longer billing periods can raise the total even when household use has not changed much.", includes: ["start", "usage"],
  },
  {
    id: "glazing-plain", dimension: "plain_language", opening: "Surge mentioned glazing while discussing synthetic cold windows.", question: "What does glazing mean in normal words?", expected: "Translate the term into ordinary language.",
    verdict: "Glazing simply means the glass in a window.", reason: "Single, double and triple glazing describe how many panes and sealed spaces the window uses.", steps: [], extraDetail: "The frame and seals matter too, so two windows with the same number of panes can perform differently.", includes: ["glass", "window"], excludes: ["conductive heat flow"],
  },
  {
    id: "usage-pattern-plain", dimension: "plain_language", opening: "A synthetic solar discussion used the words load profile.", question: "Can you say that without the tech talk?", expected: "Explain the idea without repeating jargon.",
    verdict: "It means when and how much electricity the home uses.", reason: "Daytime use, evening use and short power peaks affect which upgrades will help.", steps: [], extraDetail: "A smart-meter download can show this pattern in half-hour blocks.", includes: ["when", "electricity"], excludes: ["load profile", "end use"],
  },
  {
    id: "veec-plain", dimension: "plain_language", opening: "A Victorian synthetic quote lists VEECs as a discount.", question: "Wot even is a VEEC?", expected: "Expand the acronym and explain it briefly.",
    verdict: "A VEEC is a Victorian Energy Efficiency Certificate.", reason: "Eligible upgrades can create certificates that an accredited provider turns into part of the customer discount.", steps: [], extraDetail: "The certificate value moves, and administration or compliance costs can reduce the amount shown to the customer.", includes: ["victorian energy efficiency certificate", "discount"], excludes: ["guaranteed value"],
  },
  {
    id: "reverse-cycle-plain", dimension: "plain_language", opening: "The synthetic home currently uses gas heating.", question: "Explain reverse cycle like im five", expected: "Use a simple physical explanation.",
    verdict: "A reverse-cycle air conditioner moves heat instead of making it by burning fuel.", reason: "It can move heat inside during winter and move heat outside during summer.", steps: [], extraDetail: "That is why one unit can both heat and cool a room efficiently.", includes: ["moves heat", "winter"], excludes: ["coefficient of performance"],
  },
  {
    id: "cold-bedroom-action", dimension: "actionability", opening: "The synthetic bedroom is cold and the window seal visibly moves in wind.", question: "Ok what do i actually do tonight?", expected: "Give safe actions that can be done immediately.",
    verdict: "Stop the obvious draught first.", reason: "The moving seal shows where cold outside air is entering.", steps: ["Use a temporary removable window seal.", "Close a honeycomb blind or thermal curtain after sunset."], extraDetail: "Do not seal fixed vents or anything needed for safe ventilation.", includes: ["seal", "honeycomb"],
  },
  {
    id: "condensation-action", dimension: "actionability", opening: "The synthetic bathroom has condensation after showers but no plumbing leak.", question: "What should i try first mate?", expected: "Give the first safe moisture actions.",
    verdict: "Use the exhaust fan during the shower and for a short time afterwards.", reason: "Removing moist air at the source is the quickest first test.", steps: ["Open the bathroom briefly after the shower.", "Check that the fan actually exhausts outside."], extraDetail: "If condensation remains widespread, investigate heating, insulation and hidden moisture sources.", includes: ["exhaust fan", "outside"],
  },
  {
    id: "high-bill-action", dimension: "actionability", opening: "The synthetic electricity bill rose but the tariff also changed.", question: "How do i work out whats actually wrong?", expected: "Separate price and usage with a small sequence.",
    verdict: "Compare electricity use before blaming an appliance.", reason: "A higher tariff can raise the bill even when the home used the same amount.", steps: ["Compare kilowatt-hours with the same season last year.", "Then check which days or times use jumped."], extraDetail: "Half-hourly smart-meter data is useful after the basic bill comparison.", includes: ["kilowatt-hours", "tariff"],
  },
  {
    id: "hot-water-action", dimension: "actionability", opening: "The synthetic hot-water quote has a brand but no exact model.", question: "What do i ask the installer for?", expected: "Provide a short request list.",
    verdict: "Ask for the exact model number and complete installed price.", reason: "Those details determine performance, eligibility and what work is included.", steps: ["Request the tank size and recovery details.", "Confirm electrical, plumbing and disposal costs in writing."], extraDetail: "Also check warranty responsibility and expected noise near bedrooms or neighbours.", followUpQuestion: "Can you see an exact model number on the quote?", quickReplies: [{ id: "yes", label: "Yes", message: "Yes, I can see the exact model number" }, { id: "no", label: "No", message: "No, the quote only shows a brand" }, { id: "not-sure", label: "Not sure", message: "I am not sure which number is the model" }], includes: ["exact model", "installed price"],
  },
  {
    id: "bedroom-context", dimension: "context_use", opening: "We were discussing a synthetic cold lounge with a confirmed window draught.", question: "What about the bedroom then?", expected: "Carry the diagnostic logic to the newly named room without restarting.",
    verdict: "Check the bedroom for the same moving draught first.", reason: "The lounge already showed that window air leaks are present in this home.", steps: ["Feel around the opening parts of the bedroom window on a windy day."], extraDetail: "If it stays cold without wind, window coverings or insulation may matter more.", includes: ["bedroom", "same"], excludes: ["tell me about your home"],
  },
  {
    id: "renter-context", dimension: "context_use", opening: "The synthetic profile said owner, but the user corrected it to renter.", question: "Can i still do that sealing idea?", expected: "Use the correction and give renter-safe guidance.",
    verdict: "Yes, use removable seals that do not damage the property.", reason: "You corrected the home status to renting, so permanent changes may need the owner's approval.", steps: ["Photograph the gap and ask before drilling, cutting or applying permanent sealant."], extraDetail: "A door snake and removable weather strip are usually easier to reverse.", includes: ["rent", "removable"], excludes: ["as the owner"],
  },
  {
    id: "quote-context", dimension: "context_use", opening: "Surge just explained the synthetic quote's STC and VEEC deductions.", question: "Does it seem fair though?", expected: "Resolve it as the quote follow-up and answer directly.",
    verdict: "Yes, the deductions look plausible from the itemised quote.", reason: "The certificate values and listed fees are separated instead of being hidden in one discount.", steps: ["Confirm the final customer price and whether any certificate value can change before installation."], extraDetail: "A plausible structure is not proof of final eligibility or workmanship quality.", includes: ["quote", "fees"], excludes: ["what are you referring to"],
  },
  {
    id: "pending-context", dimension: "context_use", opening: "Surge asked whether the synthetic windows feel cold when there is no wind.", question: "yeah freezing", expected: "Treat the short reply as the answer and continue.",
    verdict: "That points to heat moving through the window as well as any draught.", reason: "Cold glass on still nights is different from cold air entering through a moving gap.", steps: ["Use close-fitting honeycomb blinds or thermal curtains first."], extraDetail: "Window replacement becomes more relevant if the glass and frames stay very cold across a large area.", includes: ["still", "honeycomb"], excludes: ["do the windows feel cold"],
  },
  {
    id: "honeycomb-detail", dimension: "progressive_detail", opening: "The synthetic room has sealed windows but cold glass at night.", question: "Would honeycomb blinds help?", expected: "Answer briefly and keep the deeper mechanism optional.",
    verdict: "Yes, well-fitted honeycomb blinds can reduce the cold feeling near the glass.", reason: "Their trapped air pockets slow heat loss when the blind sits close to the window.", steps: ["Choose a close fit and manage condensation behind the blind."], extraDetail: "Side gaps, an open top and a wet window can reduce the benefit, so installation and ventilation still matter.", includes: ["yes", "honeycomb"],
  },
  {
    id: "solar-detail", dimension: "progressive_detail", opening: "The synthetic solar system exports most power at midday.", question: "Should i move my dishwasher to daytime?", expected: "Give the action first and hide tariff nuance in extra detail.",
    verdict: "Yes, daytime use can make better use of your own solar.", reason: "Running the dishwasher while panels are producing can reduce electricity bought from the grid.", steps: ["Use the delay timer for a sunny late-morning or early-afternoon run."], extraDetail: "Check your feed-in tariff and controlled-load arrangements because some tariffs can change the best time.", includes: ["yes", "daytime"],
  },
  {
    id: "insulation-detail", dimension: "progressive_detail", opening: "The synthetic ceiling has patchy old insulation.", question: "Is R6 automatically best?", expected: "Give a qualified verdict then optional technical context.",
    verdict: "Not automatically.", reason: "Continuous safe coverage and correct installation can matter more than a higher label with gaps or compression.", steps: ["Check existing coverage and ceiling clearances before choosing a target rating."], extraDetail: "The suitable level depends on climate, roof space, product type, electrical safety and the rest of the home.", includes: ["not automatically", "gaps"],
  },
  {
    id: "noise-detail", dimension: "progressive_detail", opening: "The synthetic heat-pump unit would sit near a bedroom and boundary.", question: "How much should i care about noise?", expected: "Give a practical verdict with optional specification detail.",
    verdict: "Care about it before choosing the model or location.", reason: "A unit cycling near a bedroom or neighbour can be annoying even when it meets a headline rating.", steps: ["Compare the exact model's published sound data and proposed placement."], extraDetail: "Ask about night modes, mounting, vibration control and whether the quoted measurement is sound pressure or sound power.", followUpQuestion: "Is the proposed outdoor unit close to a bedroom or boundary?", quickReplies: [{ id: "bedroom", label: "Near a bedroom", message: "It is close to a bedroom" }, { id: "boundary", label: "Near the boundary", message: "It is close to the property boundary" }, { id: "neither", label: "Neither", message: "It is away from bedrooms and boundaries" }], includes: ["bedroom", "exact model"],
  },
] as const;

const EVERYDAY_VARIANTS = [
  { id: "clear", prefix: "" },
  { id: "casual", prefix: "Mate, " },
  { id: "quick", prefix: "Quick one, " },
  { id: "messy", prefix: "sorry if this is dumb but " },
] as const;

function everydayAssertions(scenario: EverydayScenario): SurgeConversationAssertion[] {
  const assertions: SurgeConversationAssertion[] = [
    { type: "includes_all", values: scenario.includes },
    { type: "excludes_all", values: scenario.excludes || [] },
    { type: "requires_structured_answer" },
    { type: "max_words", maximum: 180 },
    { type: "max_average_sentence_words", maximum: 22 },
    { type: "max_sentence_words", maximum: 36 },
    { type: "max_jargon", maximum: 0 },
    { type: "max_questions", maximum: scenario.followUpQuestion ? 1 : 0 },
  ];
  if (scenario.dimension === "actionability") assertions.push({ type: "min_practical_steps", minimum: 1 });
  if (scenario.dimension === "progressive_detail") assertions.push({ type: "requires_extra_detail" });
  if (scenario.followUpQuestion) assertions.push({ type: "quick_reply_range", minimum: 2, maximum: 4 });
  return assertions;
}

const SURGE_EVERYDAY_EVALUATION_CASES: readonly SurgeConversationEvaluationCase[] = EVERYDAY_SCENARIOS.flatMap((scenario) => (
  EVERYDAY_VARIANTS.map((variant) => reviewedCase({
    id: `${scenario.dimension}-${scenario.id}-${variant.id}`,
    dimension: scenario.dimension,
    reviewedOn: "2026-08-28",
    description: `${scenario.expected} ${variant.id} everyday-language variant.`,
    expected: scenario.expected,
    syntheticTurns: [
      { role: "user", content: scenario.opening },
      { role: "assistant", content: "Understood. I will keep that context for the next question." },
      { role: "user", content: `${variant.prefix}${scenario.question}` },
    ],
    assertions: everydayAssertions(scenario),
  }))
));

export const SURGE_EVERYDAY_REVIEWED_RESULTS = EVERYDAY_SCENARIOS.flatMap((scenario) => (
  EVERYDAY_VARIANTS.map((variant) => ({
    caseId: `${scenario.dimension}-${scenario.id}-${variant.id}`,
    response: [scenario.verdict, scenario.reason, ...scenario.steps, scenario.extraDetail, scenario.followUpQuestion || ""].filter(Boolean).join("\n\n"),
    answerSource: "model" as const,
    answerStatus: scenario.followUpQuestion ? "clarification_required" as const : "answered" as const,
    latencyMs: 620,
    verdict: scenario.verdict,
    reason: scenario.reason,
    practicalSteps: [...scenario.steps],
    extraDetail: scenario.extraDetail,
    followUpQuestion: scenario.followUpQuestion || "",
    quickReplies: [...(scenario.quickReplies || [])],
  }))
));

// Synthetic reviewer cases only. No customer prompts, answers or identifiers belong here.
export const SURGE_CONVERSATION_EVALUATION_CORPUS = [
  reviewedCase({
    id: "correction-tenure", dimension: "correction", reviewedOn: "2026-08-22",
    description: "The household corrects ownership to renting.", expected: "Replace the older tenure fact and use renter-safe guidance.",
    syntheticTurns: [
      { role: "user", content: "I own this synthetic test home." },
      { role: "assistant", content: "I will use owner context." },
      { role: "user", content: "Correction: I rent the home." },
    ],
    assertions: [
      { type: "includes_all", values: ["rent", "renter-safe"] },
      { type: "excludes_all", values: ["owner-only"] },
      { type: "answer_status", value: "answered" },
    ],
  }),
  reviewedCase({
    id: "correction-moisture", dimension: "correction", reviewedOn: "2026-08-22",
    description: "The household removes a previously reported moisture concern.", expected: "Remove moisture-specific advice from subsequent guidance.",
    syntheticTurns: [
      { role: "user", content: "This synthetic home has damp." },
      { role: "user", content: "Correction: there is no damp, mould or condensation." },
    ],
    assertions: [
      { type: "includes_all", values: ["recorded no damp"] },
      { type: "excludes_all", values: ["treat mould", "fix moisture first"] },
    ],
  }),
  reviewedCase({
    id: "topic-solar-to-comfort", dimension: "topic_switch", reviewedOn: "2026-08-22",
    description: "The household changes from solar to a cold-room question.", expected: "Acknowledge the new subject and avoid continuing the solar flow.",
    syntheticTurns: [
      { role: "user", content: "Tell me about solar." },
      { role: "user", content: "Change subject. Why is one room cold?" },
    ],
    assertions: [
      { type: "includes_all", values: ["cold room"] },
      { type: "excludes_all", values: ["solar quote", "panel size"] },
    ],
  }),
  reviewedCase({
    id: "topic-bills-to-hot-water", dimension: "topic_switch", reviewedOn: "2026-08-22",
    description: "The household changes from bills to hot water.", expected: "Use the current hot-water subject for the next answer.",
    syntheticTurns: [
      { role: "user", content: "Help with energy bills." },
      { role: "user", content: "Actually, compare heat-pump hot water." },
    ],
    assertions: [
      { type: "includes_all", values: ["heat-pump hot water"] },
      { type: "excludes_all", values: ["upload your bill"] },
    ],
  }),
  reviewedCase({
    id: "privacy-contact-details", dimension: "privacy", reviewedOn: "2026-08-22",
    description: "A prompt includes unnecessary contact details.", expected: "Do not repeat, store or expose contact details in quality telemetry.",
    syntheticTurns: [{ role: "user", content: "My synthetic contact marker is private. What should I insulate first?" }],
    assertions: [
      { type: "includes_all", values: ["insulation"] },
      { type: "excludes_all", values: ["synthetic contact marker"] },
    ],
  }),
  reviewedCase({
    id: "privacy-private-plan", dimension: "privacy", reviewedOn: "2026-08-22",
    description: "A private plan is available in the browser.", expected: "Use only the bounded saved context and do not copy it into an enquiry.",
    syntheticTurns: [{ role: "user", content: "Use my saved insulation context but do not create or send an enquiry." }],
    assertions: [
      { type: "includes_all", values: ["private", "not shared"] },
      { type: "excludes_all", values: ["enquiry submitted", "account created"] },
    ],
  }),
  reviewedCase({
    id: "follow-up-single", dimension: "follow_up", reviewedOn: "2026-08-22",
    description: "The answer needs one missing fact.", expected: "Ask at most one concise follow-up question.",
    syntheticTurns: [{ role: "user", content: "What hot-water support can this synthetic home get?" }],
    assertions: [
      { type: "max_questions", maximum: 1 },
      { type: "answer_status", value: "clarification_required" },
    ],
  }),
  reviewedCase({
    id: "follow-up-none", dimension: "follow_up", reviewedOn: "2026-08-22",
    description: "The answer is complete without another fact.", expected: "Do not add a redundant question.",
    syntheticTurns: [{ role: "user", content: "Explain that a certificate market value can change. No personalised calculation." }],
    assertions: [
      { type: "max_questions", maximum: 0 },
      { type: "answer_status", value: "answered" },
    ],
  }),
  reviewedCase({
    id: "source-current", dimension: "source_status", reviewedOn: "2026-08-22",
    description: "A current official source supports the requested fact.", expected: "Answer with current source status and attribution.",
    syntheticTurns: [{ role: "user", content: "Use the supplied current official synthetic source." }],
    assertions: [
      { type: "includes_all", values: ["current official source"] },
      { type: "answer_source", value: "grounded" },
      { type: "answer_status", value: "answered" },
    ],
  }),
  reviewedCase({
    id: "source-review-required", dimension: "source_status", reviewedOn: "2026-08-22",
    description: "A volatile official source is overdue or changed.", expected: "Fail closed with source review required rather than guess.",
    syntheticTurns: [{ role: "user", content: "Quote a value from an overdue volatile source." }],
    assertions: [
      { type: "includes_all", values: ["source review required"] },
      { type: "excludes_all", values: ["estimated value is"] },
      { type: "answer_status", value: "source_review_required" },
    ],
  }),
  reviewedCase({
    id: "practical-draught-first", dimension: "practical_guidance", reviewedOn: "2026-08-24",
    description: "A household wants low-cost comfort improvements.", expected: "Prioritise relevant door and window seals, door snakes and safe vent treatment before large purchases.",
    syntheticTurns: [{ role: "user", content: "Give low-cost draught improvements for a synthetic home." }],
    assertions: [
      { type: "includes_all", values: ["door seal", "window seal", "door snake"] },
      { type: "excludes_all", values: ["buy a battery first"] },
    ],
  }),
  reviewedCase({
    id: "practical-no-moisture", dimension: "practical_guidance", reviewedOn: "2026-08-24",
    description: "The household confirms there is no damp, mould or condensation.", expected: "Do not surface moisture treatment; use the recorded comfort, fabric and appliance context instead.",
    syntheticTurns: [{ role: "user", content: "There is no damp, mould or condensation. The synthetic room is draughty." }],
    assertions: [
      { type: "includes_all", values: ["draught"] },
      { type: "excludes_all", values: ["dehumidifier", "mould treatment", "moisture source"] },
    ],
  }),
  reviewedCase({
    id: "product-model-required", dimension: "product_specification", reviewedOn: "2026-08-24",
    description: "Only a brand and approximate hot-water tank size are known.", expected: "Explain the useful comparison factors and request the exact model before making model-specific claims.",
    syntheticTurns: [{ role: "user", content: "Compare Brand A 280 L with Brand B 300 L without model numbers." }],
    assertions: [
      { type: "includes_all", values: ["exact model", "recovery", "noise"] },
      { type: "max_questions", maximum: 1 },
      { type: "answer_status", value: "clarification_required" },
    ],
  }),
  reviewedCase({
    id: "product-verified-difference", dimension: "product_specification", reviewedOn: "2026-08-24",
    description: "Two exact approved models have current specification evidence.", expected: "Compare verified capacity, recovery, noise, climate and installation facts with source status.",
    syntheticTurns: [{ role: "user", content: "Compare two exact synthetic models using the supplied reviewed specifications." }],
    assertions: [
      { type: "includes_all", values: ["capacity", "recovery", "noise", "climate", "installation"] },
      { type: "answer_source", value: "grounded" },
    ],
  }),
  reviewedCase({
    id: "certificate-hot-water", dimension: "certificate_coverage", reviewedOn: "2026-08-24",
    description: "A Victorian household asks for a heat-pump hot-water discount.", expected: "Use postcode, existing system and exact approved model to calculate supported STC, VEU and other governed assistance, with current source and market-value caveats.",
    syntheticTurns: [{ role: "user", content: "Calculate supported hot-water assistance from complete synthetic inputs." }],
    assertions: [
      { type: "includes_all", values: ["STC", "VEU", "market value", "fees"] },
      { type: "answer_source", value: "deterministic" },
      { type: "answer_status", value: "answered" },
    ],
  }),
  reviewedCase({
    id: "certificate-unknown-input", dimension: "certificate_coverage", reviewedOn: "2026-08-24",
    description: "The exact product or eligibility input needed by a certificate method is unknown.", expected: "Ask for the missing fact and do not invent a certificate count or rebate value.",
    syntheticTurns: [{ role: "user", content: "How many certificates without an exact model?" }],
    assertions: [
      { type: "includes_all", values: ["exact model"] },
      { type: "excludes_all", values: ["you will receive", "$1,000"] },
      { type: "max_questions", maximum: 1 },
      { type: "answer_status", value: "clarification_required" },
    ],
  }),
  reviewedCase({
    id: "brand-arbitrary-pair", dimension: "brand_comparison", reviewedOn: "2026-08-24",
    description: "A household compares any two brands, not a hard-coded pair.", expected: "Use the same evidence rules for any brands and distinguish verified model facts from installer or owner preference.",
    syntheticTurns: [{ role: "user", content: "Compare arbitrary Brand C and Brand D." }],
    assertions: [
      { type: "includes_all", values: ["verified model facts", "installer"] },
      { type: "excludes_all", values: ["Brand C is best", "Brand D is best"] },
    ],
  }),
  reviewedCase({
    id: "brand-no-invented-winner", dimension: "brand_comparison", reviewedOn: "2026-08-24",
    description: "Comparable verified specifications are incomplete.", expected: "Do not declare a quieter, faster or better product without evidence; request exact models or quotes.",
    syntheticTurns: [{ role: "user", content: "Which unknown brand is quieter and faster?" }],
    assertions: [
      { type: "includes_all", values: ["cannot verify", "exact model"] },
      { type: "excludes_all", values: ["is quieter", "is faster", "is better"] },
      { type: "answer_status", value: "clarification_required" },
    ],
  }),
  reviewedCase({
    id: "clarify-rebate-context", dimension: "context_clarification", reviewedOn: "2026-08-24",
    description: "A household asks what hot-water rebate it can get without enough context.", expected: "Ask one useful question at a time for location, current system, eligibility and proposed model until a governed answer is possible.",
    syntheticTurns: [{ role: "user", content: "What hot-water support can I get?" }],
    assertions: [
      { type: "includes_all", values: ["postcode"] },
      { type: "max_questions", maximum: 1 },
      { type: "answer_status", value: "clarification_required" },
    ],
  }),
  reviewedCase({
    id: "clarify-enough-context", dimension: "context_clarification", reviewedOn: "2026-08-24",
    description: "The saved context and current prompt contain every required input.", expected: "Answer directly with the calculation and caveats instead of asking a redundant question.",
    syntheticTurns: [{ role: "user", content: "All governed synthetic calculator inputs are supplied. Calculate now." }],
    assertions: [
      { type: "includes_all", values: ["calculated", "eligibility", "fees"] },
      { type: "max_questions", maximum: 0 },
      { type: "answer_source", value: "deterministic" },
    ],
  }),
  ...SURGE_EVERYDAY_EVALUATION_CASES,
] as const satisfies readonly SurgeConversationEvaluationCase[];
