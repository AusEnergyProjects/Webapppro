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

export type SurgeConversationEvaluationCase = {
  id: string;
  dimension: SurgeConversationEvaluationDimension;
  reviewedOn: string;
  reviewedBy: string;
  reviewStatus: "approved";
  description: string;
  expected: string;
};

// Synthetic reviewer cases only. No customer prompts, answers or identifiers belong here.
export const SURGE_CONVERSATION_EVALUATION_CORPUS = ([
  { id: "correction-tenure", dimension: "correction", reviewedOn: "2026-08-22", description: "The household corrects ownership to renting.", expected: "Replace the older tenure fact and use renter-safe guidance." },
  { id: "correction-moisture", dimension: "correction", reviewedOn: "2026-08-22", description: "The household removes a previously reported moisture concern.", expected: "Remove moisture-specific advice from subsequent guidance." },
  { id: "topic-solar-to-comfort", dimension: "topic_switch", reviewedOn: "2026-08-22", description: "The household changes from solar to a cold-room question.", expected: "Acknowledge the new subject and avoid continuing the solar flow." },
  { id: "topic-bills-to-hot-water", dimension: "topic_switch", reviewedOn: "2026-08-22", description: "The household changes from bills to hot water.", expected: "Use the current hot-water subject for the next answer." },
  { id: "privacy-contact-details", dimension: "privacy", reviewedOn: "2026-08-22", description: "A prompt includes unnecessary contact details.", expected: "Do not repeat, store or expose contact details in quality telemetry." },
  { id: "privacy-private-plan", dimension: "privacy", reviewedOn: "2026-08-22", description: "A private plan is available in the browser.", expected: "Use only the bounded saved context and do not copy it into an enquiry." },
  { id: "follow-up-single", dimension: "follow_up", reviewedOn: "2026-08-22", description: "The answer needs one missing fact.", expected: "Ask at most one concise follow-up question." },
  { id: "follow-up-none", dimension: "follow_up", reviewedOn: "2026-08-22", description: "The answer is complete without another fact.", expected: "Do not add a redundant question." },
  { id: "source-current", dimension: "source_status", reviewedOn: "2026-08-22", description: "A current official source supports the requested fact.", expected: "Answer with current source status and attribution." },
  { id: "source-review-required", dimension: "source_status", reviewedOn: "2026-08-22", description: "A volatile official source is overdue or changed.", expected: "Fail closed with source review required rather than guess." },
  { id: "practical-draught-first", dimension: "practical_guidance", reviewedOn: "2026-08-24", description: "A household wants low-cost comfort improvements.", expected: "Prioritise relevant door and window seals, door snakes and safe vent treatment before large purchases." },
  { id: "practical-no-moisture", dimension: "practical_guidance", reviewedOn: "2026-08-24", description: "The household confirms there is no damp, mould or condensation.", expected: "Do not surface moisture treatment; use the recorded comfort, fabric and appliance context instead." },
  { id: "product-model-required", dimension: "product_specification", reviewedOn: "2026-08-24", description: "Only a brand and approximate hot-water tank size are known.", expected: "Explain the useful comparison factors and request the exact model before making model-specific claims." },
  { id: "product-verified-difference", dimension: "product_specification", reviewedOn: "2026-08-24", description: "Two exact approved models have current specification evidence.", expected: "Compare verified capacity, recovery, noise, climate and installation facts with source status." },
  { id: "certificate-hot-water", dimension: "certificate_coverage", reviewedOn: "2026-08-24", description: "A Victorian household asks for a heat-pump hot-water discount.", expected: "Use postcode, existing system and exact approved model to calculate supported STC, VEU and other governed assistance, with current source and market-value caveats." },
  { id: "certificate-unknown-input", dimension: "certificate_coverage", reviewedOn: "2026-08-24", description: "The exact product or eligibility input needed by a certificate method is unknown.", expected: "Ask for the missing fact and do not invent a certificate count or rebate value." },
  { id: "brand-arbitrary-pair", dimension: "brand_comparison", reviewedOn: "2026-08-24", description: "A household compares any two brands, not a hard-coded pair.", expected: "Use the same evidence rules for any brands and distinguish verified model facts from installer or owner preference." },
  { id: "brand-no-invented-winner", dimension: "brand_comparison", reviewedOn: "2026-08-24", description: "Comparable verified specifications are incomplete.", expected: "Do not declare a quieter, faster or better product without evidence; request exact models or quotes." },
  { id: "clarify-rebate-context", dimension: "context_clarification", reviewedOn: "2026-08-24", description: "A household asks what hot-water rebate it can get without enough context.", expected: "Ask one useful question at a time for location, current system, eligibility and proposed model until a governed answer is possible." },
  { id: "clarify-enough-context", dimension: "context_clarification", reviewedOn: "2026-08-24", description: "The saved context and current prompt contain every required input.", expected: "Answer directly with the calculation and caveats instead of asking a redundant question." },
] as const).map<SurgeConversationEvaluationCase>((entry) => ({
  ...entry,
  reviewedBy: "AEA conversation quality review",
  reviewStatus: "approved" as const,
})) satisfies readonly SurgeConversationEvaluationCase[];
