import {
  resolveSurgeConversationReference,
  surgeConversationTopicFor,
  SURGE_REFERENCE_CLARIFICATION_QUESTION_PATTERN,
  type SurgeConversationContextTurn,
  type SurgeConversationState,
} from "./energy-assistant-conversation.ts";
import type { EnergyAssistantAnswer } from "./energy-assistant.ts";

/** Ask for an unresolved subject before generating advice about an invented one. */
export function composeSurgeReferenceClarification(
  message: string,
  recentTurns: readonly SurgeConversationContextTurn[],
  continuation: SurgeConversationState | null,
): EnergyAssistantAnswer | null {
  if (resolveSurgeConversationReference(message, recentTurns, continuation).status !== "needs_clarification") {
    return null;
  }
  // Topic-only questions can still receive general guidance. Require an actual
  // unresolved reference, an unanchored next step or a retained ambiguity.
  const referenceText = message.replace(/\bworth\s+it\b/gi, "worth");
  const refersToMissingSubject = /\b(?:this|that|those|these|them|it|its|one|ones|earlier|previous|former|latter|back to)\b/i.test(referenceText);
  const asksUnanchoredNextStep = /^(?:so\s+)?what should (?:i|we) do (?:first|next|then)?\s*[?.!]*$/i.test(message.trim());
  const clarifyingPendingReference = Boolean(continuation?.pendingQuestion
    && SURGE_REFERENCE_CLARIFICATION_QUESTION_PATTERN.test(continuation.pendingQuestion));
  const asksQuestionOrRequestsWork = /^(?:is|are|am|can|could|should|would|will|do|does|did|what|which|why|how|where|when|who|check|compare|review|calculate|explain|help|sort|fix|show|tell|back to|return to)\b/i.test(message.trim());
  const providesCurrentSubject = Boolean(surgeConversationTopicFor(message))
    && /\$\s*\d|\d+(?:\.\d+)?\s*(?:kW|kWh|litres?|units?)\b/i.test(message);
  if (!clarifyingPendingReference && (!asksQuestionOrRequestsWork || providesCurrentSubject)) {
    return null;
  }
  if (!refersToMissingSubject && !asksUnanchoredNextStep && !clarifyingPendingReference && !continuation?.ledger) {
    return null;
  }

  let question = "What question or decision are you referring to?";
  let subject = "the subject of your request";
  if (continuation?.ledger && /\b(?:property|home|house|job|client|friend|door)\b/i.test(message)) {
    question = "Which property, job or earlier decision do you mean? Identify it using the label or details you gave earlier.";
    subject = "the correct property, job or decision";
  } else if (/\b(?:better|worse|cheaper|dearer|expensive|compare|comparing|options?|quotes?|former|latter)\b/i.test(message)) {
    question = "Which options or quotes are you comparing, and what decision do you need help with?";
    subject = "the options you want compared";
  } else {
    const namedSubject = message.match(/\b(?:this|that|the|those|these)\s+(battery|inverter|solar panels?|panels?|blinds?|curtains?|system|unit|model|plan|tariff|charger|heater|installer|product)\b/i)?.[1];
    if (namedSubject) {
      question = `Which ${namedSubject.toLowerCase()} do you mean, and what would you like me to check?`;
      subject = `the ${namedSubject.toLowerCase()} you mean`;
    }
  }

  if (continuation?.pendingQuestion
    && SURGE_REFERENCE_CLARIFICATION_QUESTION_PATTERN.test(continuation.pendingQuestion)) {
    question = continuation.pendingQuestion;
  }

  return {
    directAnswer: /\bquotes?\b/i.test(message)
      ? "I need the quote or its main details to assess it reliably."
      : `I need to identify ${subject} to answer reliably.`,
    practicalSteps: [],
    nextAction: "Answer the clarification question.",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "low",
    suggestedQuestions: [question],
    toolActions: [],
    sourceBoundary: "The request has no unambiguous subject in the supplied conversation.",
  };
}
