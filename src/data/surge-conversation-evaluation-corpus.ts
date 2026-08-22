export const SURGE_CONVERSATION_EVALUATION_DIMENSIONS = [
  "correction",
  "topic_switch",
  "privacy",
  "follow_up",
  "source_status",
] as const;

export type SurgeConversationEvaluationDimension =
  (typeof SURGE_CONVERSATION_EVALUATION_DIMENSIONS)[number];

export type SurgeConversationEvaluationCase = {
  id: string;
  dimension: SurgeConversationEvaluationDimension;
  reviewedOn: string;
  description: string;
  expected: string;
};

// Synthetic reviewer cases only. No customer prompts, answers or identifiers belong here.
export const SURGE_CONVERSATION_EVALUATION_CORPUS = [
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
] as const satisfies readonly SurgeConversationEvaluationCase[];
