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
] as const satisfies readonly SurgeConversationEvaluationCase[];
