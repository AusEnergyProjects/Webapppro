import type { SurgeConversationEvaluationObservation } from "../lib/surge-conversation-quality-gate.ts";
import { SURGE_EVERYDAY_REVIEWED_RESULTS } from "./surge-conversation-evaluation-corpus.ts";

// Synthetic observations only. These are executable fixtures, not assertions that a case passed.
export const SURGE_CONVERSATION_REVIEWED_RESULTS = [
  { caseId: "correction-tenure", response: "I have corrected the context to rent. I will keep the guidance renter-safe.", answerSource: "model", answerStatus: "answered", latencyMs: 610 },
  { caseId: "correction-moisture", response: "I have recorded no damp. I will use the current comfort and fabric context.", answerSource: "model", answerStatus: "answered", latencyMs: 590 },
  { caseId: "topic-solar-to-comfort", response: "For the cold room, first compare draughts, insulation and heating delivery.", answerSource: "model", answerStatus: "answered", latencyMs: 620 },
  { caseId: "topic-bills-to-hot-water", response: "For heat-pump hot water, compare capacity, recovery, noise and installation scope.", answerSource: "model", answerStatus: "answered", latencyMs: 640 },
  { caseId: "privacy-contact-details", response: "Start by checking safe, continuous ceiling insulation coverage.", answerSource: "model", answerStatus: "answered", latencyMs: 570 },
  { caseId: "privacy-private-plan", response: "Your saved context remains private and is not shared unless you deliberately choose a follow-up path.", answerSource: "deterministic", answerStatus: "answered", latencyMs: 35 },
  { caseId: "follow-up-single", response: "Which postcode is the home in?", answerSource: "model", answerStatus: "clarification_required", latencyMs: 500 },
  { caseId: "follow-up-none", response: "Certificate market values can move between trades, so an installer deduction can also change after registration and compliance costs.", answerSource: "grounded", answerStatus: "answered", latencyMs: 310 },
  { caseId: "source-current", response: "The current official source supports this reviewed fact.", answerSource: "grounded", answerStatus: "answered", latencyMs: 280 },
  { caseId: "source-review-required", response: "Source review required before I can give that volatile value.", answerSource: "grounded", answerStatus: "source_review_required", latencyMs: 95 },
  { caseId: "practical-draught-first", response: "Start with a door seal, window seal and door snake, while keeping required ventilation working.", answerSource: "grounded", answerStatus: "answered", latencyMs: 340 },
  { caseId: "practical-no-moisture", response: "For the recorded draught, check seals and insulation before larger equipment changes.", answerSource: "grounded", answerStatus: "answered", latencyMs: 330 },
  { caseId: "product-model-required", response: "Tank size alone is not enough. Compare recovery, noise and installation conditions. What is the exact model on each quote?", answerSource: "grounded", answerStatus: "clarification_required", latencyMs: 420 },
  { caseId: "product-verified-difference", response: "The reviewed specifications let me compare capacity, recovery, noise, climate performance and installation requirements.", answerSource: "grounded", answerStatus: "answered", latencyMs: 405 },
  { caseId: "certificate-hot-water", response: "The deterministic calculation covers STC and VEU support. Certificate market value moves, and registration and compliance fees reduce the installer deduction.", answerSource: "deterministic", answerStatus: "answered", latencyMs: 48 },
  { caseId: "certificate-unknown-input", response: "What is the exact model? I cannot calculate the certificate count without it.", answerSource: "deterministic", answerStatus: "clarification_required", latencyMs: 42 },
  { caseId: "brand-arbitrary-pair", response: "I will separate verified model facts from installer scope, warranty support and owner preference.", answerSource: "grounded", answerStatus: "answered", latencyMs: 390 },
  { caseId: "brand-no-invented-winner", response: "I cannot verify that comparison without the exact model. What model appears on each quote?", answerSource: "grounded", answerStatus: "clarification_required", latencyMs: 370 },
  { caseId: "clarify-rebate-context", response: "What is the home's postcode?", answerSource: "deterministic", answerStatus: "clarification_required", latencyMs: 33 },
  { caseId: "clarify-enough-context", response: "The governed inputs are complete. I calculated the support, subject to final eligibility, certificate market value and fees.", answerSource: "deterministic", answerStatus: "answered", latencyMs: 51 },
  ...SURGE_EVERYDAY_REVIEWED_RESULTS,
] as const satisfies readonly SurgeConversationEvaluationObservation[];
