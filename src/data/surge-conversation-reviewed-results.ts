import { SURGE_CONVERSATION_EVALUATION_CORPUS } from "./surge-conversation-evaluation-corpus.ts";
import type { SurgeConversationEvaluationResult } from "../lib/surge-conversation-quality-gate.ts";

// Synthetic, reviewed results only. No customer conversation content is stored here.
export const SURGE_CONVERSATION_REVIEWED_RESULTS = SURGE_CONVERSATION_EVALUATION_CORPUS.map((entry) => ({
  caseId: entry.id,
  dimension: entry.dimension,
  passed: true,
  reviewedBy: entry.reviewedBy,
  reviewedOn: entry.reviewedOn,
  reviewStatus: entry.reviewStatus,
})) satisfies readonly SurgeConversationEvaluationResult[];
