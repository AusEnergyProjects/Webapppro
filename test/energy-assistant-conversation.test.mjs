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

test("a topic noun with an explicit reference still uses the recent decision context", () => {
  const turns = [
    { role: "user", content: "The battery quote is $12,000 for 10 kWh and claims $700 yearly savings." },
    { role: "assistant", content: "That implies a long simple payback." },
  ];
  const message = "Is that battery worth it?";
  const resolution = resolveSurgeConversationReference(message, turns, null);

  assert.equal(isSurgeContextDependentMessage(message), true);
  assert.equal(resolution.status, "resolved_from_recent_context");
  assert.equal(resolution.basis, "recent_user_turns");
  assert.deepEqual(resolution.anchorUserMessages, [turns[0].content]);
  assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up");
  assert.equal(isSurgeContextDependentMessage("what about the battery instead?"), false);
});

test("natural named-topic pronouns keep the immediately relevant conversation", () => {
  const cases = [
    ["Are those solar panels worth it?", "I was quoted for twelve solar panels."],
    ["Is that inverter any good?", "The quote includes an ABC-5000 inverter."],
    ["Are those blinds worth it?", "The installer suggested honeycomb blinds."],
    ["Does the battery do that too?", "The solar system can charge the car during the day."],
  ];

  for (const [message, prior] of cases) {
    const turns = [{ role: "user", content: prior }];
    const resolution = resolveSurgeConversationReference(message, turns, null);
    assert.equal(isSurgeContextDependentMessage(message), true, message);
    assert.equal(resolution.status, "resolved_from_recent_context", message);
    assert.deepEqual(resolution.anchorUserMessages, [prior], message);
    assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up", message);
  }
});

test("natural named-topic ellipses retain the immediately relevant conversation", () => {
  const prior = "Based on my survey, help me decide which home upgrades should come first.";
  const turns = [{ role: "user", content: prior }];
  for (const message of [
    "What about solar?",
    "And a battery?",
    "Could insulation help too?",
    "Would honeycomb blinds help?",
  ]) {
    const resolution = resolveSurgeConversationReference(message, turns, null);
    assert.equal(isSurgeContextDependentMessage(message), true, message);
    assert.equal(resolution.status, "resolved_from_recent_context", message);
    assert.deepEqual(resolution.anchorUserMessages, [prior], message);
    assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up", message);
  }
  assert.equal(isSurgeContextDependentMessage("What about solar instead?"), false);
});

test("definite named references keep compatible recent context", () => {
  const cases = [
    ["Are the solar panels worth it?", "The quote includes twelve solar panels."],
    ["Is the inverter any good?", "The solar quote includes an ABC-5000 inverter."],
    ["Does the system make sense?", "I was quoted for a 6.6 kW solar system."],
  ];
  for (const [message, prior] of cases) {
    const turns = [{ role: "user", content: prior }];
    const resolution = resolveSurgeConversationReference(message, turns, null);
    assert.equal(resolution.contextDependent, true, message);
    assert.equal(resolution.status, "resolved_from_recent_context", message);
    assert.deepEqual(resolution.anchorUserMessages, [prior], message);
    assert.equal(classifySurgeConversationTurn(message, null, turns), "contextual_follow_up", message);
  }
});

test("a clear named request changes topic even when no question is pending", () => {
  const current = state({
    activeTopic: "rcac",
    pendingQuestion: "",
  });
  assert.equal(classifySurgeConversationTurn("Tell me about solar instead", current), "topic_change");
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

test("an explicit topic question overrides a stale pending question", () => {
  const current = state({
    activeTopic: "glazing_shading",
    pendingQuestion: "Do the windows feel cold when there is no wind?",
  });
  for (const message of [
    "Is solar worth it?",
    "what about the battery instead?",
    "and insulation?",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "topic_change", message);
  }
});

test("short natural statements still answer the pending question", () => {
  for (const [pendingQuestion, message] of [
    ["Which room feels coldest?", "lounge and bedroom"],
    ["How many people live there?", "two people"],
    ["When do you use most electricity?", "mostly evenings"],
    ["Do the windows feel cold?", "yeah freezing"],
    ["Do you already have solar?", "we have solar"],
  ]) {
    const current = state({ pendingQuestion });
    assert.equal(classifySurgeConversationTurn(message, current), "answer_to_follow_up", message);
  }
});

test("tentative short replies still answer the pending question", () => {
  for (const [pendingQuestion, message] of [
    ["How many people live there?", "Two people?"],
    ["Which room feels coldest?", "The bedroom?"],
    ["When do you use most electricity?", "Mostly evenings?"],
  ]) {
    const current = state({ pendingQuestion });
    assert.equal(classifySurgeConversationTurn(message, current), "answer_to_follow_up", message);
  }
});

test("short explicit facts answer a pending question even when they contain another energy topic", () => {
  const cases = [
    ["What heating do you use?", "Gas ducted heating"],
    ["Do you have solar?", "No, but I have a battery"],
    ["Which room is coldest?", "The bedroom windows are freezing"],
  ];

  for (const [pendingQuestion, message] of cases) {
    assert.equal(classifySurgeConversationTurn(message, {
      ...emptySurgeConversationState(),
      pendingQuestion,
    }), "answer_to_follow_up", `${pendingQuestion} / ${message}`);
  }
});

test("a clear new question or request can still override a pending question", () => {
  const continuation = {
    ...emptySurgeConversationState(),
    pendingQuestion: "Which room is coldest?",
  };
  assert.equal(classifySurgeConversationTurn("Is solar worth it?", continuation), "topic_change");
  assert.equal(classifySurgeConversationTurn("Tell me about solar instead", continuation), "topic_change");
});

test("bare named-topic requests override an unrelated pending room question", () => {
  const continuation = {
    ...emptySurgeConversationState(),
    activeTopic: "comfort_fabric",
    pendingQuestion: "Which room is hardest to keep comfortable?",
  };
  for (const message of [
    "solar panels cost",
    "battery prices",
    "insulation options",
    "solar",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, continuation), "topic_change", message);
  }
  assert.equal(classifySurgeConversationTurn("bedroom", continuation), "answer_to_follow_up");
  assert.equal(classifySurgeConversationTurn("The bedroom windows are freezing", continuation), "answer_to_follow_up");
});
