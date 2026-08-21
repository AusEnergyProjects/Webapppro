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
  });

  assert.equal(event.turnIntent, "correction");
  assert.equal(event.correctionExpected, true);
  assert.equal(event.correctionPassed, true);
  assert.deepEqual(Object.keys(event).sort(), [
    "answerSource",
    "answerStatus",
    "audience",
    "correctionExpected",
    "correctionPassed",
    "day",
    "followUpPassed",
    "privacyPassed",
    "topicSwitchExpected",
    "topicSwitchPassed",
    "turnIntent",
  ]);
  assert.doesNotMatch(JSON.stringify(event), /Private Street|Actually I rent|message|content|request|client|identity|answerText/i);
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
  });

  assert.equal(passed.topicSwitchExpected, true);
  assert.equal(passed.topicSwitchPassed, true);
  assert.equal(failed.topicSwitchPassed, false);
});
