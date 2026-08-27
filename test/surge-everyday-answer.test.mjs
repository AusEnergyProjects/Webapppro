import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSurgeAnswerPresentation,
  surgePlainLanguageMetrics,
  surgePresentationPassesEverydayLanguage,
  surgeQuickRepliesForQuestion,
} from "../src/lib/surge-everyday-answer.ts";

function answer(overrides = {}) {
  return {
    directAnswer: "Start with a staged whole-home diagnosis. Use interval data plus a building fabric check. Then review each end use.",
    practicalSteps: ["Check the coldest room first."],
    nextAction: "",
    status: "needs_context",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: ["Which room is hardest to keep comfortable?"],
    toolActions: [],
    sourceBoundary: "",
    ...overrides,
  };
}

test("everyday presentation converts deterministic jargon and creates usable quick replies", () => {
  const presentation = deriveSurgeAnswerPresentation(answer(), "where should i start");
  const rendered = JSON.stringify(presentation);
  assert.equal(presentation.answerType, "starting_plan");
  assert.match(presentation.verdict, /step-by-step check/i);
  assert.doesNotMatch(rendered, /staged whole-home diagnosis|interval data|building fabric|end use/i);
  assert.equal(presentation.quickReplies.length, 4);
  assert.deepEqual(presentation.quickReplies.map((reply) => reply.label), ["Lounge", "Bedroom", "Both", "Another room"]);
  assert.equal(surgePresentationPassesEverydayLanguage(presentation), true);
});

test("plain-language metrics detect long technical answers before release", () => {
  const metrics = surgePlainLanguageMetrics("A building fabric load profile can describe conductive heat flow through the thermal envelope.");
  assert.equal(metrics.jargonCount, 4);
  assert.equal(metrics.wordCount > 10, true);
});

test("yes or no follow-ups produce one-click everyday replies", () => {
  assert.deepEqual(
    surgeQuickRepliesForQuestion("Do the windows feel cold when there is no wind?").map((reply) => reply.label),
    ["Yes", "No", "Not sure"],
  );
});
