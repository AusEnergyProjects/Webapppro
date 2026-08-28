import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSurgeAnswerPresentation,
  surgePlainLanguageMetrics,
  surgePresentationPassesEverydayLanguage,
  surgeQuickReplySetForTopic,
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

test("three-phase answers use small topic choices instead of generic next-step prompts", () => {
  const message = "Is it worth upgrading my single-phase house to three-phase for solar and a battery, and will it need rewiring?";
  const replySet = surgeQuickReplySetForTopic(message);
  assert.ok(replySet);
  assert.equal(replySet.followUpQuestion, "What would you like to check next about the three-phase upgrade?");
  assert.deepEqual(replySet.quickReplies.map((reply) => reply.label), [
    "Does it need rewiring?",
    "When is it worth it?",
    "What should the quote include?",
  ]);
  assert.doesNotMatch(JSON.stringify(replySet), /practical next step|show me how|compare options/i);

  const presentation = deriveSurgeAnswerPresentation(answer({
    suggestedQuestions: ["What equipment details are proposed?"],
  }), message);
  assert.equal(presentation.followUpQuestion, replySet.followUpQuestion);
  assert.deepEqual(presentation.quickReplies, replySet.quickReplies);

  const rewiringReplySet = surgeQuickReplySetForTopic("Does upgrading to three-phase require rewiring the whole house?");
  assert.ok(rewiringReplySet);
  assert.deepEqual(rewiringReplySet.quickReplies.map((reply) => reply.label), [
    "When is it worth it?",
    "What should the quote include?",
  ]);
  assert.doesNotMatch(JSON.stringify(rewiringReplySet), /Does it need rewiring/i);
});

test("unmapped questions do not invent generic quick replies", () => {
  assert.deepEqual(surgeQuickRepliesForQuestion("Which part would you like explained next?"), []);
});
