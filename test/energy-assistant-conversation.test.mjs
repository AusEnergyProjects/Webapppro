import assert from "node:assert/strict";
import test from "node:test";
import {
  emptySurgeConversationState,
  parseSurgeConversationState,
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
