import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySurgeConversationTurn,
  emptySurgeConversationState,
  isSurgeContextDependentMessage,
  parseSurgeConversationState,
  resolveSurgeConversationReference,
  SURGE_CONVERSATION_STATE_VERSION,
  SURGE_MAX_FACTS,
} from "../src/lib/energy-assistant-conversation.ts";

function state(overrides = {}) {
  return {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: "solar",
    goal: "Compare the household options",
    facts: [],
    pendingQuestion: "What is the postcode?",
    lastAnswerSummary: "Explained why location changes the answer.",
    ...overrides,
  };
}

test("conversation parser accepts bounded state and the latest duplicate fact wins", () => {
  const parsed = parseSurgeConversationState(state({
    facts: [
      { key: "postcode", value: "3000" },
      { key: "tenure", value: "owner" },
      { key: "postcode", value: "3006" },
    ],
  }));

  assert.deepEqual(parsed, {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: "solar",
    goal: "Compare the household options",
    facts: [
      { key: "postcode", value: "3006" },
      { key: "tenure", value: "owner" },
    ],
    pendingQuestion: "What is the postcode?",
    lastAnswerSummary: "Explained why location changes the answer.",
  });
});

test("conversation parser trims values and normalises an empty active topic to general", () => {
  const parsed = parseSurgeConversationState(state({
    activeTopic: "   ",
    goal: "  Lower bills  ",
    facts: [{ key: "postcode", value: "  3006  " }],
    pendingQuestion: "  Are you the owner?  ",
    lastAnswerSummary: "  Asked for tenure.  ",
  }));

  assert.equal(parsed.activeTopic, "general");
  assert.equal(parsed.goal, "Lower bills");
  assert.deepEqual(parsed.facts, [{ key: "postcode", value: "3006" }]);
  assert.equal(parsed.pendingQuestion, "Are you the owner?");
  assert.equal(parsed.lastAnswerSummary, "Asked for tenure.");
});

test("conversation parser rejects invalid versions, keys, control characters and oversized strings", () => {
  const cases = [
    state({ version: 2 }),
    state({ activeTopic: "Solar panels" }),
    state({ activeTopic: `a${"b".repeat(48)}` }),
    state({ goal: "g".repeat(241) }),
    state({ pendingQuestion: "q".repeat(221) }),
    state({ lastAnswerSummary: "s".repeat(321) }),
    state({ facts: [{ key: "Postcode", value: "3006" }] }),
    state({ facts: [{ key: "postcode", value: "v".repeat(241) }] }),
    state({ facts: [{ key: "postcode", value: "3006\u0000" }] }),
  ];

  for (const value of cases) assert.equal(parseSurgeConversationState(value), null);
});

test("conversation parser enforces the sixteen-fact bound", () => {
  const maximum = Array.from({ length: SURGE_MAX_FACTS }, (_, index) => ({
    key: `fact_${index}`,
    value: `value ${index}`,
  }));
  assert.equal(parseSurgeConversationState(state({ facts: maximum })).facts.length, SURGE_MAX_FACTS);
  assert.equal(
    parseSurgeConversationState(state({
      facts: [...maximum, { key: "one_too_many", value: "value" }],
    })),
    null,
  );
});

test("empty conversation state is a fresh bounded general conversation", () => {
  assert.deepEqual(emptySurgeConversationState(), {
    version: SURGE_CONVERSATION_STATE_VERSION,
    activeTopic: "general",
    goal: "",
    facts: [],
    pendingQuestion: "",
    lastAnswerSummary: "",
  });
});

test("conversation turn classifier recognises natural corrections and explicit subject changes", () => {
  const current = state({ activeTopic: "battery", pendingQuestion: "Do you own the home?" });
  for (const message of [
    "Actually I rent; I do not own it.",
    "Sorry, I meant there are four people here.",
    "I rent rather than own the home.",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "correction", message);
  }
  for (const message of [
    "Different question: what about solar?",
    "Change the subject to insulation.",
    "Moving on, can you explain rebates?",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "topic_change", message);
  }
  assert.equal(
    classifySurgeConversationTurn("Actually, change the subject to solar instead.", current),
    "correction_and_topic_change",
  );
});

test("context-dependent wording resolves against the newest compatible user turns", () => {
  const turns = [
    { role: "user", content: "I am comparing the Emerald Select and Pro hot-water systems." },
    { role: "assistant", content: "The Pro has an inverter compressor." },
    { role: "user", content: "The Pro costs a few hundred dollars more." },
  ];
  const message = "does the more expensive one make sense instead?";
  const resolution = resolveSurgeConversationReference(message, turns, null);

  assert.equal(isSurgeContextDependentMessage(message), true);
  assert.equal(resolution.status, "resolved_from_recent_context");
  assert.equal(resolution.basis, "recent_user_turns");
  assert.deepEqual(resolution.anchorUserMessages, [
    "I am comparing the Emerald Select and Pro hot-water systems.",
    "The Pro costs a few hundred dollars more.",
  ]);
  assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up");
});

test("the practical-next-step quick reply remains tied to the current topic", () => {
  const turns = [{ role: "user", content: "Should I upgrade this home from single phase to three phase?" }];
  const message = "Show me the practical next step";
  const resolution = resolveSurgeConversationReference(message, turns, null);

  assert.equal(isSurgeContextDependentMessage(message), true);
  assert.equal(resolution.status, "resolved_from_recent_context");
  assert.deepEqual(resolution.anchorUserMessages, [turns[0].content]);
  assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up");
});

test("explicit topic changes do not inherit an unrelated reference frame", () => {
  const turns = [{ role: "user", content: "I was comparing two hot-water systems." }];
  const message = "Different question: what about ceiling insulation?";
  const resolution = resolveSurgeConversationReference(message, turns, null);

  assert.equal(resolution.status, "self_contained");
  assert.deepEqual(resolution.anchorUserMessages, []);
  assert.equal(classifySurgeConversationTurn(message, null, turns), "topic_change");
});

test("a context-dependent question without any usable context asks for clarification", () => {
  const resolution = resolveSurgeConversationReference("is that one better?", [], null);

  assert.equal(resolution.contextDependent, true);
  assert.equal(resolution.status, "needs_clarification");
  assert.equal(resolution.basis, "none");
  assert.deepEqual(resolution.anchorUserMessages, []);
  assert.equal(classifySurgeConversationTurn("is that one better?", null, []), "new_question");
});
