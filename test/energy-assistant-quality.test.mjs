import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSurgeConversationQuality } from "../src/lib/energy-assistant-quality.ts";

function state(overrides = {}) {
  return {
    version: 1,
    activeTopic: "battery",
    goal: "Reduce household bills",
    facts: [{ key: "tenure", value: "owner" }],
    pendingQuestion: "Do you own or rent the home?",
    lastAnswerSummary: "Explained the battery decision.",
    ...overrides,
  };
}

function presentation() {
  return {
    answerType: "starting_plan",
    verdict: "Start with the coldest room.",
    reason: "That gives the clearest first check.",
    steps: ["Check the window seals."],
    extraDetail: "Compare the result on a still and windy day.",
    followUpQuestion: "Which room is hardest to heat?",
    quickReplies: [
      { id: "lounge", label: "Lounge", message: "The lounge" },
      { id: "bedroom", label: "Bedroom", message: "The bedroom" },
    ],
  };
}

test("quality evaluator records a correction outcome without retaining conversation content", () => {
  const sensitiveMessage = "Actually I rent rather than own the home at 8 Private Street.";
  const event = evaluateSurgeConversationQuality({
    day: "2026-08-22",
    audience: "renter",
    message: sensitiveMessage,
    before: state(),
    after: state({ facts: [{ key: "tenure", value: "renter" }] }),
    answerSource: "deterministic",
    answerStatus: "answered",
    publicPolicyPassed: true,
    followUpQuestion: "Which room is hardest to heat?",
    presentation: presentation(),
    latencyMs: 87.6,
    metadata: {
      corpusSha256: "corpus-abc",
      promptSha256: "prompt-def",
      sourceSha256: "source-ghi",
      appVersion: "app-42",
      gitSha: "git-123",
      deploymentId: "deploy-456",
      requestedModel: "gpt-requested",
      providerModel: "gpt-provider",
    },
  });

  assert.equal(event.turnIntent, "correction");
  assert.equal(event.correctionExpected, true);
  assert.equal(event.correctionPassed, true);
  assert.deepEqual(Object.keys(event).sort(), [
    "actionabilityExpected",
    "actionabilityPassed",
    "answerSource",
    "answerStatus",
    "audience",
    "correctionExpected",
    "correctionPassed",
    "day",
    "directnessPassed",
    "followUpPassed",
    "latencyMs",
    "metadata",
    "plainLanguagePassed",
    "privacyPassed",
    "topicSwitchExpected",
    "topicSwitchPassed",
    "turnIntent",
  ]);
  assert.equal(event.latencyMs, 88);
  assert.equal(event.metadata.deploymentId, "deploy-456");
  assert.doesNotMatch(JSON.stringify(event), /Private Street|Actually I rent|question_text|answer_text|answerText|recentTurns/i);
});

test("quality evaluator distinguishes a successful subject change from an unchanged continuation", () => {
  const passed = evaluateSurgeConversationQuality({
    day: "2026-08-22",
    audience: "household",
    message: "Different question: what about solar?",
    before: state(),
    after: state({ activeTopic: "solar" }),
    answerSource: "model",
    answerStatus: "answered",
    publicPolicyPassed: true,
    followUpQuestion: "What is your postcode?",
    presentation: presentation(),
  });
  const failed = evaluateSurgeConversationQuality({
    day: "2026-08-22",
    audience: "household",
    message: "Different question: what about solar?",
    before: state(),
    after: state(),
    answerSource: "model",
    answerStatus: "answered",
    publicPolicyPassed: true,
    followUpQuestion: "What is your postcode?",
    presentation: presentation(),
  });

  assert.equal(passed.topicSwitchExpected, true);
  assert.equal(passed.topicSwitchPassed, true);
  assert.equal(failed.topicSwitchPassed, false);
});
