import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySurgeConversationTurn,
  emptySurgeConversationState,
  filterSurgeRecentTurnsForFrame,
  isSurgeContextDependentMessage,
  mergeSurgeConversationFacts,
  parseSurgeConversationState,
  projectSurgeConversationStateToFrame,
  resolveSurgeConversationReference,
  selectSurgeConversationFrame,
  surgeConversationCorrectionReframesDecision,
  surgeConversationDecisionContext,
  surgeConversationFactsFromMessage,
  surgeConversationTopicFor,
  surgeConversationTopicsAreCompatible,
  SURGE_CONVERSATION_STATE_VERSION,
  SURGE_HOME_COMFORT_INTENT_PATTERN,
  SURGE_MAX_FACTS,
  SURGE_MAX_LEDGER_BYTES,
  SURGE_MAX_LEDGER_DECISIONS,
  SURGE_MAX_LEDGER_OPEN_ITEMS,
  SURGE_PLAN_CONTEXT_CORRECTION_VALUES,
  updateSurgeConversationLedger,
} from "../src/lib/energy-assistant-conversation.ts";
import { surgeRecurringFinanceConversationFacts } from "../src/lib/energy-assistant.ts";

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

function recordLedgerTurn(current, {
  message,
  activeTopic,
  goal,
  answerSummary = "Answered the customer's question.",
  followUpQuestion = "",
  intent = "new_question",
  planFacts = [],
  facts = [],
  derivedFacts = [],
  savedHomeCorrectionFacts = [],
}) {
  return updateSurgeConversationLedger(current, {
    message,
    answerSummary,
    followUpQuestion,
    intent,
    planFacts,
    modelState: {
      ...emptySurgeConversationState(),
      activeTopic,
      goal,
      facts,
    },
    derivedFacts,
    savedHomeCorrectionFacts,
  });
}

function validLedger() {
  return {
    turn: 1,
    activeDecisionId: "decision_1_solar",
    subjects: [{
      id: "saved_home",
      kind: "saved_home",
      label: "Saved home",
      facts: [{ key: "postcode", value: "3000", source: "plan", updatedTurn: 1 }],
      lastTouchedTurn: 1,
    }],
    decisions: [{
      id: "decision_1_solar",
      subjectIds: ["saved_home"],
      topic: "solar",
      goal: "Decide whether solar suits the saved home",
      facts: [],
      outcomeSummary: "Solar may suit the home.",
      openItems: [],
      pendingQuestion: "",
      status: "resolved",
      lastTouchedTurn: 1,
    }],
  };
}

function savedHomeAndMumLedger() {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Using my saved home details, is solar worth it?",
    activeTopic: "solar",
    goal: "Decide whether solar suits my saved home",
    answerSummary: "Solar is likely to suit the saved home.",
    planFacts: [
      { key: "postcode", value: "3000" },
      { key: "property_type", value: "apartment" },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "Mum's unit is in postcode 3350. Is reverse-cycle heating suitable?",
    activeTopic: "rcac",
    goal: "Review reverse-cycle heating for Mum's unit",
    answerSummary: "Reverse-cycle heating is likely to be the practical option for Mum's unit.",
  });
  return current;
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

test("conversation parser accepts only bounded plan-context correction tombstones", () => {
  const corrections = ["comfort_moisture_resolved", "glazing_changed"];
  const parsed = parseSurgeConversationState(state({ planContextCorrections: corrections }));
  assert.deepEqual(parsed.planContextCorrections, corrections);

  for (const planContextCorrections of [
    ["comfort_moisture_resolved", "comfort_moisture_resolved"],
    ["unknown_correction"],
    [...SURGE_PLAN_CONTEXT_CORRECTION_VALUES, "unknown_correction"],
  ]) {
    assert.equal(
      parseSurgeConversationState(state({ planContextCorrections })),
      null,
    );
  }
  assert.equal(parseSurgeConversationState(state()).planContextCorrections, undefined);
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

test("conversation parser migrates only assistant-authored legacy summaries to Wattzun AI", () => {
  const ledger = validLedger();
  ledger.decisions[0] = {
    ...ledger.decisions[0],
    outcomeSummary: "Surge said solar may suit the home.",
    openItems: ["What should Surge check next?"],
    pendingQuestion: "What should Surge check next?",
    status: "open",
  };
  const parsed = parseSurgeConversationState(state({
    goal: "Ask Surge about the saved home's options",
    pendingQuestion: "What should Surge check next?",
    lastAnswerSummary: "Surge said the postcode changes the answer.",
    ledger,
  }));

  assert.equal(parsed.goal, "Ask Surge about the saved home's options");
  assert.equal(parsed.pendingQuestion, "What should Wattzun AI check next?");
  assert.equal(parsed.lastAnswerSummary, "Wattzun AI said the postcode changes the answer.");
  assert.equal(parsed.ledger.decisions[0].outcomeSummary, "Wattzun AI said solar may suit the home.");
  assert.deepEqual(parsed.ledger.decisions[0].openItems, ["What should Wattzun AI check next?"]);
  assert.equal(parsed.ledger.decisions[0].pendingQuestion, "What should Wattzun AI check next?");
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

test("an official-link request remains attached to the active support decision", () => {
  const firstMessage = "What current Victorian support may apply if I replace ducted gas heating with reverse-cycle air conditioning?";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: firstMessage,
    activeTopic: "rcac",
    goal: firstMessage,
    answerSummary: "Victorian Energy Upgrades support may apply, subject to current official eligibility.",
  });
  const message = "Give me the useful official link, not a search page, and tell me what I should check there.";
  const priorTurns = [
    { role: "user", content: firstMessage },
    { role: "assistant", content: "Victorian Energy Upgrades support may apply." },
  ];
  const intent = classifySurgeConversationTurn(message, current, priorTurns);
  const initialDecisionId = current.ledger.activeDecisionId;

  assert.equal(isSurgeContextDependentMessage(message), true);
  assert.equal(intent, "contextual_follow_up");
  current = recordLedgerTurn(current, {
    message,
    activeTopic: "general",
    goal: message,
    answerSummary: "Use the official Victorian Energy Upgrades guidance.",
    intent,
  });
  assert.equal(current.ledger.activeDecisionId, initialDecisionId);
  assert.equal(current.ledger.decisions[0].topic, "rcac");
  assert.match(
    current.ledger.decisions[0].facts.find((fact) => fact.key === "user_context")?.value || "",
    /Victorian support.*official link/is,
  );
});

test("combining a model-expanded active goal is segment-idempotent", () => {
  const firstMessage = "I feel a draught under my front door";
  const currentMessage = "great idea, also i find it hard to keep the house warm sometimes";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: firstMessage,
    activeTopic: "draughts_ventilation",
    goal: firstMessage,
    answerSummary: "Recommended a removable door snake.",
  });
  const decisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: currentMessage,
    activeTopic: "comfort_fabric",
    goal: `${firstMessage} | ${currentMessage}`,
    answerSummary: "Connected the door draught to the wider cold-home problem.",
    intent: "contextual_follow_up",
  });

  const decision = current.ledger.decisions.find((candidate) => candidate.id === decisionId);
  assert.ok(decision);
  assert.equal(decision.goal, `${firstMessage} | ${currentMessage}`);
  assert.equal(decision.goal.split(firstMessage).length - 1, 1);
  assert.equal(decision.goal.split(currentMessage).length - 1, 1);
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

test("a rebate remains the active decision while the customer supplies system details", () => {
  assert.equal(
    surgeConversationTopicFor("How much rebate can I get for replacing ducted gas heating?"),
    "rebates_certificates",
  );
  assert.equal(surgeConversationTopicsAreCompatible("rebates_certificates", "rcac"), true);
  const current = state({
    activeTopic: "rebates_certificates",
    goal: "Work out the rebate for replacing ducted gas heating",
    pendingQuestion: "Are you considering ducted reverse-cycle or separate split systems?",
  });
  const details = "I am installing next Friday, an Emerald 18 kW multi-head system with three heads";
  assert.equal(classifySurgeConversationTurn(details, current), "answer_to_follow_up");
  assert.equal(
    surgeConversationDecisionContext(details, current, []),
    [current.goal, current.pendingQuestion, details].join("\n"),
  );

  const terseDetails = "Emerald 18 kW with three heads, next Friday";
  assert.equal(classifySurgeConversationTurn(terseDetails, current), "answer_to_follow_up");
  assert.equal(
    surgeConversationDecisionContext(terseDetails, current, []),
    [current.goal, current.pendingQuestion, terseDetails].join("\n"),
  );
});

test("bathroom and extractor fan wording routes to ventilation", () => {
  for (const message of [
    "The bathroom fan only runs with the light and the mirror stays fogged.",
    "The extractor fan is noisy and barely moves air.",
    "Should I replace the extraction fan?",
  ]) {
    assert.equal(surgeConversationTopicFor(message), "draughts_ventilation", message);
  }
});

test("whole-home warmth symptoms route to the broader comfort decision", () => {
  for (const message of [
    "great idea, also i find it hard to keep the house warm sometimes",
    "The home won't stay warm",
    "This room always feels cold",
    "How do I keep my house warm?",
    "My house is cold",
    "We can't keep our house warm",
    "Why is my bedroom freezing?",
  ]) {
    assert.equal(surgeConversationTopicFor(message), "comfort_fabric", message);
    assert.equal(SURGE_HOME_COMFORT_INTENT_PATTERN.test(message), true, message);
  }
  const batteryMessage = "My home battery sometimes gets cold outside. Is that normal?";
  assert.equal(SURGE_HOME_COMFORT_INTENT_PATTERN.test(batteryMessage), false);
  assert.equal(surgeConversationTopicFor(batteryMessage), "battery_vpp");
});

test("a next-check question keeps the corrected bathroom-fan decision and pending airflow check", () => {
  const recentTurns = [];
  const firstMessage = "My bathroom mirror stays fogged for about 20 minutes after a shower even though the fan is on. Is that normal?";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: firstMessage,
    activeTopic: "general",
    goal: firstMessage,
    answerSummary: "Twenty minutes suggests the fan may be weak, restricted or short of replacement air.",
  });
  const bathroomDecisionId = current.ledger.activeDecisionId;
  recentTurns.push(
    { role: "user", content: firstMessage },
    { role: "assistant", content: "Twenty minutes suggests the fan may be weak, restricted or short of replacement air." },
  );

  const correctionMessage = "Correction: it is closer to 45 minutes, and I can barely feel air moving at the grille.";
  const correctionIntent = classifySurgeConversationTurn(correctionMessage, current, recentTurns);
  assert.equal(correctionIntent, "correction");
  const airflowQuestion = "Does airflow improve when the bathroom door is slightly open?";
  current = recordLedgerTurn(current, {
    message: correctionMessage,
    activeTopic: "general",
    goal: firstMessage,
    answerSummary: "Forty-five minutes and barely felt airflow make a restricted grille, duct or missing replacement air more likely. Test with the bathroom door slightly open.",
    followUpQuestion: airflowQuestion,
    intent: correctionIntent,
  });
  recentTurns.push(
    { role: "user", content: correctionMessage },
    { role: "assistant", content: `Test the fan with the bathroom door slightly open. ${airflowQuestion}` },
  );

  const nextCheckMessage = "What is the next useful check before I replace the fan?";
  assert.equal(isSurgeContextDependentMessage(nextCheckMessage), true);
  const nextCheckIntent = classifySurgeConversationTurn(nextCheckMessage, current, recentTurns);
  assert.equal(
    nextCheckIntent,
    "contextual_follow_up",
  );
  const frame = selectSurgeConversationFrame(nextCheckMessage, current, false);
  assert.equal(frame.decision?.id, bathroomDecisionId);
  assert.equal(frame.subject?.id, "conversation");
  assert.equal(frame.decision?.pendingQuestion, airflowQuestion);
  const retainedContext = JSON.stringify(frame.relatedDecisions);
  assert.match(retainedContext, /45 minutes/i);
  assert.match(retainedContext, /barely feel air/i);
  assert.match(retainedContext, /door (?:is )?slightly open/i);
  current = recordLedgerTurn(current, {
    message: nextCheckMessage,
    activeTopic: "general",
    goal: nextCheckMessage,
    answerSummary: "First compare the airflow with the bathroom door closed and slightly open before replacing the fan.",
    intent: nextCheckIntent,
  });
  assert.equal(current.ledger.activeDecisionId, bathroomDecisionId);
  assert.equal(current.ledger.subjects.some((subject) => subject.id === "general_advice"), false);
  assert.ok(
    current.ledger.decisions
      .find((decision) => decision.id === bathroomDecisionId)
      ?.openItems.includes(airflowQuestion),
  );
});

test("decision compatibility does not turn unrelated technologies into follow-up answers", () => {
  for (const [left, right] of [
    ["rcac", "solar"],
    ["battery_vpp", "insulation"],
    ["glazing_shading", "ev_charging"],
    ["general", "solar"],
    ["", "rcac"],
  ]) {
    assert.equal(surgeConversationTopicsAreCompatible(left, right), false, `${left} / ${right}`);
  }

  const current = state({
    activeTopic: "rebates_certificates",
    goal: "Work out the rebate for replacing ducted gas heating",
    pendingQuestion: "What exact proposed system and installation date apply?",
  });
  for (const message of [
    "I am installing a 6.6 kW solar system next Friday",
    "My existing hot water system is leaking",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "topic_change", message);
  }
  for (const message of [
    "My existing dishwasher is broken",
    "I am currently replacing the fence",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "new_question", message);
  }
});

test("an additive suffix does not make a concrete unrecognised subject inherit the old decision", () => {
  const current = state({
    activeTopic: "rcac",
    goal: "Compare ducted gas with reverse-cycle air conditioning",
  });
  const recentTurns = [
    { role: "user", content: current.goal },
    { role: "assistant", content: "Reverse-cycle is normally the more efficient heating option." },
  ];

  for (const message of ["I am installing a fence too", "What about a dishwasher too?"]) {
    assert.equal(isSurgeContextDependentMessage(message), false, message);
    assert.equal(classifySurgeConversationTurn(message, current, recentTurns), "new_question", message);
    assert.equal(surgeConversationDecisionContext(message, current, recentTurns), message, message);
  }

  assert.equal(isSurgeContextDependentMessage("solar too?"), true);
  assert.equal(isSurgeContextDependentMessage("Would that help too?"), true);
});

test("a correction can reframe the decision without discarding household facts", () => {
  const message = "Actually I want to know if the quote is fair, not the rebate";
  assert.equal(surgeConversationCorrectionReframesDecision(message), true);
  assert.equal(surgeConversationTopicFor(message), "products_ratings");
  assert.equal(
    surgeConversationDecisionContext(message, state({
      activeTopic: "rebates_certificates",
      goal: "Work out the rebate for replacing ducted gas heating",
    })),
    message,
  );
  assert.equal(surgeConversationCorrectionReframesDecision("Actually I rent, not own"), false);
});

test("plain-language complaints repair the existing decision instead of starting again", () => {
  const current = state({
    activeTopic: "rebates_certificates",
    goal: "Work out the rebate for replacing ducted gas heating",
    pendingQuestion: "What exact model numbers are on the quote?",
  });
  for (const message of ["i dont understand", "thats useless answer", "you didnt answer my question"]) {
    assert.equal(classifySurgeConversationTurn(message, current), "clarification", message);
    const decision = surgeConversationDecisionContext(message, current, []);
    assert.match(decision, /rebate for replacing ducted gas heating/i, message);
    assert.doesNotMatch(decision, /exact model numbers/, message);
  }
});

test("an explicit new-question marker outranks complaint language", () => {
  const current = state({
    activeTopic: "rebates_certificates",
    goal: "Work out the rebate for replacing ducted gas heating",
    pendingQuestion: "What exact model numbers are on the quote?",
  });
  const message = "That's useless. New question: is solar worth it?";
  assert.equal(classifySurgeConversationTurn(message, current), "topic_change");
  assert.equal(surgeConversationDecisionContext(message, current, []), message);
});

test("a pending postcode question accepts postcode wording but not unrelated four-digit values", () => {
  const current = state({
    activeTopic: "rebates_certificates",
    goal: "Work out the rebate for replacing ducted gas heating",
    pendingQuestion: "What is the property's postcode?",
  });

  for (const message of ["3000", "It's 3000", "postcode 3000", "I live in 3000"]) {
    assert.equal(classifySurgeConversationTurn(message, current), "answer_to_follow_up", message);
  }
  for (const message of [
    "The model is ABC 1234",
    "It uses 4500 watts",
    "The quote is $6500 installed",
    "It has 3000 watts of capacity",
  ]) {
    assert.equal(classifySurgeConversationTurn(message, current), "contextual_follow_up", message);
  }
});

test("deterministic conversation facts preserve supplied equipment details across model failures", () => {
  const facts = surgeConversationFactsFromMessage(
    "I am installing next Friday, an Emerald 18 kW multi-head system with 3 heads",
  );
  assert.deepEqual(facts, [
    { key: "proposed_heating", value: "multi-head system" },
    { key: "installation_timing", value: "next Friday" },
    { key: "supplied_quantities", value: "18 kW, 3 heads" },
    {
      key: "proposed_or_quoted_details",
      value: "I am installing next Friday, an Emerald 18 kW multi-head system with 3 heads",
    },
  ]);
  assert.deepEqual(
    mergeSurgeConversationFacts(
      [{ key: "existing_heating", value: "ducted gas heating" }],
      facts,
    ),
    [{ key: "existing_heating", value: "ducted gas heating" }, ...facts],
  );
});

test("deterministic facts keep postcode, existing equipment and proposed equipment in distinct slots", () => {
  for (const message of [
    "The quote is $6500 installed",
    "The model is ABC 1234",
    "It uses 4500 watts",
  ]) {
    const facts = surgeConversationFactsFromMessage(message);
    assert.equal(facts.some((fact) => fact.key === "postcode"), false, message);
    assert.equal(
      mergeSurgeConversationFacts([{ key: "postcode", value: "3000" }], facts)
        .find((fact) => fact.key === "postcode")?.value,
      "3000",
      message,
    );
  }

  assert.deepEqual(surgeConversationFactsFromMessage("postcode 3006"), [
    { key: "postcode", value: "3006" },
  ]);
  const replacement = surgeConversationFactsFromMessage(
    "We are replacing ducted gas heating with reverse-cycle",
  );
  assert.deepEqual(replacement.filter((fact) => /heating$/.test(fact.key)), [
    { key: "existing_heating", value: "ducted gas heating" },
    { key: "proposed_heating", value: "reverse-cycle" },
  ]);
  const proposedOnly = surgeConversationFactsFromMessage(
    "We are replacing our old unit with a split system",
  );
  assert.equal(proposedOnly.some((fact) => fact.key === "existing_heating"), false);
  assert.equal(
    proposedOnly.find((fact) => fact.key === "proposed_heating")?.value,
    "split system",
  );

  const headDetails = surgeConversationFactsFromMessage(
    "Emerald 18 kW multi-head with 3 heads: one 8.5 and two 4.5s",
  );
  assert.match(
    headDetails.find((fact) => fact.key === "supplied_quantities")?.value || "",
    /18 kW.*3 heads.*8\.5.*4\.5/i,
  );
});

test("contextual HVAC facts remember a unitless thermostat setting without treating unrelated numbers as temperatures", () => {
  assert.deepEqual(
    surgeConversationFactsFromMessage("Filter is clean and I set it to 24.", "rcac"),
    [{ key: "thermostat_setpoint_celsius", value: "24°C" }],
  );
  assert.equal(
    surgeConversationFactsFromMessage("I set the battery reserve to 24.", "battery_vpp")
      .some((fact) => fact.key === "thermostat_setpoint_celsius"),
    false,
  );
  assert.equal(
    surgeConversationFactsFromMessage("I set the reverse-cycle timer to 24 minutes.", "rcac")
      .some((fact) => fact.key === "thermostat_setpoint_celsius"),
    false,
  );
});

test("conversation parser preserves legacy version-one state without inventing a ledger", () => {
  const legacy = state({
    facts: [{ key: "postcode", value: "3000" }],
  });
  const parsed = parseSurgeConversationState(legacy);

  assert.deepEqual(parsed, legacy);
  assert.equal(Object.hasOwn(parsed, "ledger"), false);
});

test("conversation parser rejects malformed ledger references and oversized ledgers", () => {
  const missingSubject = structuredClone(validLedger());
  missingSubject.decisions[0].subjectIds = ["missing_home"];

  const missingActiveDecision = structuredClone(validLedger());
  missingActiveDecision.activeDecisionId = "missing_decision";

  const oversized = validLedger();
  oversized.turn = 120;
  oversized.subjects[0].lastTouchedTurn = 120;
  oversized.subjects[0].facts = Array.from({ length: 120 }, (_, index) => ({
    key: `fact_${index}`,
    value: "x".repeat(220),
    source: "chat",
    updatedTurn: index + 1,
  }));
  assert.ok(
    new TextEncoder().encode(JSON.stringify(oversized)).byteLength > SURGE_MAX_LEDGER_BYTES,
    "fixture must exceed the serialized ledger byte limit",
  );

  for (const ledger of [missingSubject, missingActiveDecision, oversized]) {
    assert.equal(parseSurgeConversationState(state({ ledger })), null);
  }
});

test("structured ledger keeps saved-home and Mum property facts and decisions separate", () => {
  const current = savedHomeAndMumLedger();
  const savedHome = current.ledger.subjects.find((subject) => subject.id === "saved_home");
  const mumsHome = current.ledger.subjects.find((subject) => subject.id === "mums_home");
  const savedDecision = current.ledger.decisions.find((decision) => decision.subjectIds.includes("saved_home"));
  const mumsDecision = current.ledger.decisions.find((decision) => decision.subjectIds.includes("mums_home"));

  assert.equal(savedHome.facts.find((fact) => fact.key === "postcode")?.value, "3000");
  assert.equal(mumsHome.facts.find((fact) => fact.key === "postcode")?.value, "3350");
  assert.equal(savedDecision.topic, "solar");
  assert.equal(mumsDecision.topic, "rcac");
  assert.notEqual(savedDecision.id, mumsDecision.id);
  assert.equal(savedDecision.subjectIds.includes("mums_home"), false);
  assert.equal(mumsDecision.subjectIds.includes("saved_home"), false);
});

test("planner facts copied through model state retain plan provenance in later decisions", () => {
  const plannerBudget = { key: "first_stage_budget", value: "Under $2,000" };
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "I have $1,500. Should I choose blinds, a solar deposit or a new split?",
    activeTopic: "general",
    goal: "Choose the best use of my $1,500",
    answerSummary: "Use the $1,500 for window coverings while the split still works.",
    planFacts: [plannerBudget],
    facts: [{ key: "budget", value: "$1,500" }],
  });
  current = recordLedgerTurn(current, {
    message: "Different question: honeycomb blinds are $1,400 and thermal curtains are $900 installed.",
    activeTopic: "glazing_shading",
    goal: "Compare the $1,400 and $900 window-covering quotes",
    answerSummary: "The $900 curtains offer better value if they include pelmets.",
    intent: "topic_change",
    planFacts: [plannerBudget],
    facts: [plannerBudget],
  });
  const firstCopiedTurn = current.ledger.decisions
    .find((decision) => decision.topic === "glazing_shading")
    ?.facts.find((fact) => fact.key === "first_stage_budget")?.updatedTurn;
  current = recordLedgerTurn(current, {
    message: "Same five-year warranty. I mostly care about winter cold, not looks.",
    activeTopic: "glazing_shading",
    goal: "Choose between the two window-covering quotes for winter cold",
    answerSummary: "Keep the lower-cost close-fitting curtains ahead of the dearer blinds.",
    intent: "contextual_follow_up",
    planFacts: [plannerBudget],
    facts: [plannerBudget],
  });

  const explicitBudget = current.ledger.decisions
    .flatMap((decision) => decision.facts)
    .find((fact) => fact.key === "budget" && fact.value === "$1,500");
  const copiedPlannerBudget = current.ledger.decisions
    .find((decision) => decision.topic === "glazing_shading")
    ?.facts.find((fact) => fact.key === "first_stage_budget");

  assert.equal(explicitBudget?.source, "chat");
  assert.equal(copiedPlannerBudget?.value, "Under $2,000");
  assert.equal(copiedPlannerBudget?.source, "plan");
  assert.equal(firstCopiedTurn, 2);
  assert.equal(copiedPlannerBudget?.updatedTurn, firstCopiedTurn);

  current = recordLedgerTurn(current, {
    message: "Change my budget to under $2,000.",
    activeTopic: "general",
    goal: "Change my budget to under $2,000",
    answerSummary: "The current budget is now under $2,000.",
    intent: "topic_change",
    planFacts: [plannerBudget],
    facts: [plannerBudget],
  });
  const explicitReplacement = current.ledger.decisions
    .find((decision) => decision.id === current.ledger.activeDecisionId)
    ?.facts.find((fact) => fact.key === "first_stage_budget");
  assert.equal(explicitReplacement?.source, "chat");
  assert.equal(explicitReplacement?.updatedTurn, 4);
});

test("an exact chat budget cannot promote a wider planner range to chat provenance", () => {
  const plannerBudget = { key: "first_stage_budget", value: "$2,000 to $10,000" };
  const current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My budget is $2,000.",
    activeTopic: "general",
    goal: "Use my $2,000 budget",
    planFacts: [plannerBudget],
    facts: [
      plannerBudget,
      { key: "budget", value: "$2,000" },
    ],
  });
  const decision = current.ledger.decisions.find((candidate) => (
    candidate.id === current.ledger.activeDecisionId
  ));

  assert.deepEqual(decision?.facts.find((fact) => fact.key === "first_stage_budget"), {
    ...plannerBudget,
    source: "plan",
    updatedTurn: 1,
  });
  assert.deepEqual(decision?.facts.find((fact) => fact.key === "budget"), {
    key: "budget",
    value: "$2,000",
    source: "chat",
    updatedTurn: 1,
  });

  const explicitRange = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My budget is between $2,000 and $10,000.",
    activeTopic: "general",
    goal: "Plan within my stated budget range",
    planFacts: [plannerBudget],
    facts: [plannerBudget],
  });
  assert.equal(
    explicitRange.ledger.decisions[0].facts
      .find((fact) => fact.key === "first_stage_budget")?.source,
    "chat",
  );
});

test("retained provenance stays inside the selected subject while same-home facts remain durable", () => {
  const savedPlanFacts = [{ key: "postcode", value: "3000" }];
  let sameHome = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home, I have $1,500 to spend on comfort.",
    activeTopic: "comfort_fabric",
    goal: "Use the saved home's $1,500 comfort budget",
    planFacts: savedPlanFacts,
    facts: [{ key: "budget", value: "$1,500" }],
  });
  sameHome = recordLedgerTurn(sameHome, {
    message: "Different question for my saved home: should I fix the cold windows first?",
    activeTopic: "glazing_shading",
    goal: "Choose the saved home's first window action",
    intent: "topic_change",
    planFacts: savedPlanFacts,
    facts: [{ key: "budget", value: "$1,500" }],
  });
  const retainedSameHomeBudget = sameHome.ledger.decisions
    .find((decision) => decision.id === sameHome.ledger.activeDecisionId)
    ?.facts.find((fact) => fact.key === "budget");
  assert.deepEqual(retainedSameHomeBudget, {
    key: "budget",
    value: "$1,500",
    source: "chat",
    updatedTurn: 1,
  });

  let separateHomes = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Using my saved home details, should I improve the cold windows?",
    activeTopic: "glazing_shading",
    goal: "Improve the saved home's cold windows",
    planFacts: savedPlanFacts,
  });
  separateHomes = recordLedgerTurn(separateHomes, {
    message: "Mum's home budget is $1,500 for a new split system.",
    activeTopic: "rcac",
    goal: "Assess Mum's $1,500 heating budget",
    intent: "topic_change",
    facts: [{ key: "budget", value: "$1,500" }],
  });
  separateHomes = recordLedgerTurn(separateHomes, {
    message: "Back to my saved home: should the cold windows still come first?",
    activeTopic: "glazing_shading",
    goal: "Choose the saved home's first window action",
    intent: "topic_change",
    planFacts: savedPlanFacts,
    facts: [{ key: "budget", value: "$1,500" }],
  });
  const savedHomeDecision = separateHomes.ledger.decisions
    .find((decision) => decision.id === separateHomes.ledger.activeDecisionId);
  const unsupportedSavedHomeBudget = savedHomeDecision?.facts
    .find((fact) => fact.key === "budget");

  assert.deepEqual(savedHomeDecision?.subjectIds, ["saved_home"]);
  assert.deepEqual(unsupportedSavedHomeBudget, {
    key: "budget",
    value: "$1,500",
    source: "derived",
    updatedTurn: 3,
  });
});

test("a postcode embedded in the saved-home phrase survives a separate Mum-home detour", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved 3072 apartment, remember that the front door is draughty and the windows are single glazed.",
    activeTopic: "glazing_shading",
    goal: "Reduce draughts and cold-window discomfort at my 3072 apartment",
    answerSummary: "Noted the draughty front door and single-glazed windows for the saved apartment.",
    facts: [
      { key: "postcode", value: "3072" },
      { key: "front_door", value: "draughty" },
      { key: "windows", value: "single_glazed" },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "Now a separate home: Mum's unit is in 3073 and her bedroom window drips.",
    activeTopic: "comfort_fabric",
    goal: "Check condensation at Mum's separate 3073 unit",
    answerSummary: "Check whether Mum's moisture is room-side condensation or a leak.",
  });

  const savedHome = current.ledger.subjects.find((subject) => subject.id === "saved_home");
  const mumsHome = current.ledger.subjects.find((subject) => subject.id === "mums_home");
  const frame = selectSurgeConversationFrame(
    "Back to my 3072 apartment: what was the first low-cost action for my problem?",
    current,
    true,
  );

  assert.equal(savedHome?.facts.find((fact) => fact.key === "postcode")?.value, "3072");
  assert.equal(mumsHome?.facts.find((fact) => fact.key === "postcode")?.value, "3073");
  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.facts.find((fact) => fact.key === "front_door")?.value, "draughty");
  assert.doesNotMatch(JSON.stringify({ subject: frame.subject, decision: frame.decision }), /3073|Mum/i);
});

test("postcode corrections update only the explicitly named property", () => {
  const corrected = recordLedgerTurn(savedHomeAndMumLedger(), {
    message: "Actually Mum's postcode is 3351, not 3350.",
    activeTopic: "rcac",
    goal: "Review reverse-cycle heating for Mum's unit",
    answerSummary: "Updated Mum's location before continuing the heating advice.",
    intent: "correction",
  });
  const savedHome = corrected.ledger.subjects.find((subject) => subject.id === "saved_home");
  const mumsHome = corrected.ledger.subjects.find((subject) => subject.id === "mums_home");
  const activeDecision = corrected.ledger.decisions.find(
    (decision) => decision.id === corrected.ledger.activeDecisionId,
  );

  assert.equal(savedHome.facts.find((fact) => fact.key === "postcode")?.value, "3000");
  assert.equal(mumsHome.facts.find((fact) => fact.key === "postcode")?.value, "3351");
  assert.deepEqual(activeDecision.subjectIds, ["mums_home"]);
  assert.equal(activeDecision.facts.some((fact) => fact.key === "postcode"), false);
});

test("frame selection revisits the named property and topic instead of the latest active context", () => {
  let current = savedHomeAndMumLedger();
  current = recordLedgerTurn(current, {
    message: "Would honeycomb blinds help my windows?",
    activeTopic: "glazing_shading",
    goal: "Improve the saved home's windows without replacing them",
    answerSummary: "Close-fitting honeycomb blinds can reduce window heat loss.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  assert.equal(
    current.ledger.decisions.find((decision) => decision.id === current.ledger.activeDecisionId)?.topic,
    "glazing_shading",
  );

  const frame = selectSurgeConversationFrame(
    "Back to Mum's unit: what about her reverse-cycle heating quote?",
    current,
    true,
  );

  assert.equal(frame.subject?.id, "mums_home");
  assert.equal(frame.decision?.topic, "rcac");
  assert.deepEqual(frame.decision?.subjectIds, ["mums_home"]);
  assert.equal(frame.relatedDecisions.some((decision) => decision.id === frame.decision?.id), true);
  assert.equal(frame.inactiveIndex.some((item) => item.subjectLabel === "Saved home"), true);
});

test("an explicit return to my home wins over a negated reference to Mum's home", () => {
  const current = savedHomeAndMumLedger();

  const savedFrame = selectSurgeConversationFrame(
    "Back to my home, not Mum's: use everything I told you earlier.",
    current,
    true,
  );
  const mumsFrame = selectSurgeConversationFrame(
    "This job is for Mum's place, not my apartment.",
    current,
    true,
  );

  assert.equal(savedFrame.subject?.id, "saved_home");
  assert.equal(mumsFrame.subject?.id, "mums_home");
});

test("a fifty-question conversation retains every semantic decision for whole-home recall", () => {
  const remembered = [
    {
      topic: "draughts_ventilation",
      goal: "Stop the breeze under the front door",
      answer: "Use a door snake tonight, then fit the correct door seal.",
    },
    {
      topic: "glazing_shading",
      goal: "Reduce cold from the single-glazed windows",
      answer: "Close-fitting honeycomb blinds or thermal curtains will reduce window heat loss.",
    },
    {
      topic: "rcac",
      goal: "Keep using the working reverse-cycle split efficiently",
      answer: "Keep the working split, clean its filter and use a sensible thermostat setting.",
    },
    ...Array.from({ length: 47 }, (_, index) => ({
      topic: ["solar", "battery_vpp", "heat_pump_hot_water", "bills_tariffs", "products_ratings"][index % 5],
      goal: `Remember separate home-energy decision ${index + 4}`,
      answer: `Resolved home-energy decision ${index + 4} with its own practical conclusion.`,
    })),
  ];
  let current = emptySurgeConversationState();

  for (const [index, memory] of remembered.entries()) {
    current = recordLedgerTurn(current, {
      message: `Different question for my saved home: ${memory.goal}.`,
      activeTopic: memory.topic,
      goal: memory.goal,
      answerSummary: memory.answer,
      intent: "topic_change",
      planFacts: index === 0 ? [{ key: "postcode", value: "3072" }] : [],
      facts: [{ key: `decision_detail_${index + 1}`, value: `Remembered detail ${index + 1}` }],
    });
  }

  assert.equal(current.ledger.decisions.length, 50);
  assert.ok(parseSurgeConversationState(current));
  assert.ok(
    new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES,
  );
  const frame = selectSurgeConversationFrame(
    "Back to my home: based on everything I told you earlier, put all the upgrades in order.",
    current,
    true,
  );
  const frameText = JSON.stringify(frame.relatedDecisions);
  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.relatedDecisions.length, 50);
  assert.match(frameText, /front door/i);
  assert.match(frameText, /single-glazed windows/i);
  assert.match(frameText, /working reverse-cycle split/i);
});

test("ledger byte compaction retains the first and last of fifty long decisions", () => {
  let current = emptySurgeConversationState();

  for (let index = 1; index <= 50; index += 1) {
    const marker = `long-memory-${String(index).padStart(2, "0")}`;
    current = recordLedgerTurn(current, {
      message: `Different question for my saved home: ${marker}. ${"Detailed customer context ".repeat(14)}`,
      activeTopic: ["solar", "battery_vpp", "rcac", "glazing_shading"][index % 4],
      goal: `${marker}: ${"retain this distinct decision goal ".repeat(10)}`,
      answerSummary: `${marker}: ${"retain this delivered practical conclusion ".repeat(10)}`,
      intent: "topic_change",
      planFacts: index === 1 ? [{ key: "postcode", value: "3072" }] : [],
      facts: [{ key: `detail_${index}`, value: `${marker} ${"bounded supporting detail ".repeat(12)}` }],
    });
  }

  const encodedBytes = new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength;
  assert.equal(current.ledger.decisions.length, 50);
  assert.equal(current.ledger.decisions.some((decision) => decision.id === "decision_1_battery_vpp"), true);
  assert.equal(current.ledger.activeDecisionId, "decision_50_rcac");
  assert.equal(current.ledger.decisions.some((decision) => decision.id === "decision_50_rcac"), true);
  assert.ok(encodedBytes <= SURGE_MAX_LEDGER_BYTES, `${encodedBytes} exceeds the ledger byte cap`);
  assert.ok(parseSurgeConversationState(current));
});

test("fifty separate client properties retain distinct subjects and decisions", () => {
  let current = emptySurgeConversationState();

  for (let index = 1; index <= 50; index += 1) {
    current = recordLedgerTurn(current, {
      message: `Another client's property needs decision ${index} reviewed.`,
      activeTopic: ["solar", "rcac", "glazing_shading", "heat_pump_hot_water"][index % 4],
      goal: `Review client property decision ${index}`,
      answerSummary: `Recorded the separate conclusion for client property ${index}.`,
      intent: "topic_change",
    });
  }

  const clientSubjects = current.ledger.subjects.filter((subject) => subject.id.startsWith("client_job_"));
  assert.equal(clientSubjects.length, 50);
  assert.equal(new Set(clientSubjects.map((subject) => subject.id)).size, 50);
  assert.equal(current.ledger.decisions.length, 50);
  assert.equal(new Set(current.ledger.decisions.flatMap((decision) => decision.subjectIds)).size, 50);
  assert.equal(current.ledger.decisions[0].subjectIds[0], clientSubjects[0].id);
  assert.equal(current.ledger.decisions.at(-1)?.subjectIds[0], clientSubjects.at(-1)?.id);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES,
  );
  assert.ok(parseSurgeConversationState(current));
});

test("reciprocal Mum and Dad negations select only the affirmed property", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum's house is in postcode 3000 and needs solar advice.",
    activeTopic: "solar",
    goal: "Review solar for Mum's house",
  });
  current = recordLedgerTurn(current, {
    message: "Dad's house is in postcode 4000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for Dad's house",
    intent: "topic_change",
  });

  const cases = [
    ["It isn't Dad's house, it is Mum's.", "mums_home"],
    ["Dad's house isn't the one; Mum's is.", "mums_home"],
    ["This is Dad's place, not Mum's.", "dads_home"],
  ];
  for (const [message, expectedSubjectId] of cases) {
    const frame = selectSurgeConversationFrame(message, current, false);
    assert.equal(frame.subject?.id, expectedSubjectId, message);
    assert.deepEqual(frame.subjects.map((subject) => subject.id), [expectedSubjectId], message);
  }
});

test("a sister's postcode never overwrites the saved home and her place continues that subject", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Using my saved home details, where should I start?",
    activeTopic: "comfort_fabric",
    goal: "Prioritise my saved home",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  current = recordLedgerTurn(current, {
    message: "Sister's home is in postcode 4000. Would solar suit her place?",
    activeTopic: "solar",
    goal: "Review solar for my sister's home",
    intent: "topic_change",
  });

  const savedHome = current.ledger.subjects.find((subject) => subject.id === "saved_home");
  const sistersHome = current.ledger.subjects.find((subject) => subject.id === "sisters_home");
  assert.equal(savedHome?.facts.find((fact) => fact.key === "postcode")?.value, "3072");
  assert.equal(sistersHome?.facts.find((fact) => fact.key === "postcode")?.value, "4000");

  const frame = selectSurgeConversationFrame("Would a battery make sense at her place too?", current, true);
  assert.equal(frame.subject?.id, "sisters_home");
  assert.doesNotMatch(JSON.stringify(frame.subject), /3072/);
});

test("friend and neighbour properties retain separate postcode context", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Friend's house is in postcode 3000 and needs solar advice.",
    activeTopic: "solar",
    goal: "Review solar for my friend's house",
  });
  current = recordLedgerTurn(current, {
    message: "Neighbour's unit is in postcode 4000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for my neighbour's unit",
    intent: "topic_change",
  });

  const friendsHome = current.ledger.subjects.find((subject) => subject.id === "friends_home");
  const neighboursHome = current.ledger.subjects.find((subject) => subject.id === "neighbours_home");
  assert.equal(friendsHome?.facts.find((fact) => fact.key === "postcode")?.value, "3000");
  assert.equal(neighboursHome?.facts.find((fact) => fact.key === "postcode")?.value, "4000");
  assert.notEqual(friendsHome?.id, neighboursHome?.id);
});

test("Mum's unit being uninsulated remains a fact about Mum rather than a negated subject", () => {
  let current = savedHomeAndMumLedger();
  current = recordLedgerTurn(current, {
    message: "Back to my saved home: keep reviewing its solar options.",
    activeTopic: "solar",
    goal: "Keep reviewing solar for my saved home",
    intent: "topic_change",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  assert.equal(
    current.ledger.decisions.find((decision) => decision.id === current.ledger.activeDecisionId)?.subjectIds[0],
    "saved_home",
  );

  const message = "Mum's unit isn't insulated. What should she do first?";
  const frame = selectSurgeConversationFrame(message, current, true);
  assert.equal(frame.subject?.id, "mums_home");
  assert.deepEqual(frame.subjects.map((subject) => subject.id), ["mums_home"]);

  const updated = recordLedgerTurn(current, {
    message,
    activeTopic: "insulation",
    goal: "Improve insulation at Mum's unit",
    answerSummary: "Start by checking which parts of Mum's unit have no insulation.",
    intent: "new_question",
  });
  const active = updated.ledger.decisions.find((decision) => decision.id === updated.ledger.activeDecisionId);
  assert.deepEqual(active?.subjectIds, ["mums_home"]);
  assert.equal(active?.topic, "insulation");
  assert.match(active?.goal || "", /Mum's unit/i);
});

test("another neighbour creates a distinct property identity", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Neighbour's unit is in postcode 3000 and needs solar advice.",
    activeTopic: "solar",
    goal: "Review solar for my neighbour's unit",
  });
  current = recordLedgerTurn(current, {
    message: "Another neighbour's unit is in postcode 4000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for another neighbour's unit",
    intent: "topic_change",
  });

  const neighbours = current.ledger.subjects.filter((subject) => subject.id.startsWith("neighbours_home"));
  assert.deepEqual(neighbours.map((subject) => subject.id).sort(), ["neighbours_home", "neighbours_home_1"]);
  assert.deepEqual(
    new Set(neighbours.map((subject) => subject.facts.find((fact) => fact.key === "postcode")?.value)),
    new Set(["3000", "4000"]),
  );
  assert.equal(
    current.ledger.decisions.filter((decision) => decision.subjectIds.some((id) => id.startsWith("neighbours_home"))).length,
    2,
  );
});

test("an ambiguous revisit of two similar people or jobs selects neither and preserves both", () => {
  const scenarios = [
    {
      prefix: "friends_home",
      firstMessage: "Friend's house is in postcode 3000 and has a solar quote.",
      secondMessage: "Another friend's house is in postcode 4000 and has a heating quote.",
      ambiguousMessage: "Back to my friend's house: does that quote still make sense?",
      clarification: "Which friend's house do you mean: the postcode 3000 home or the postcode 4000 home?",
    },
    {
      prefix: "client_job_",
      firstMessage: "A client's property is in postcode 3000 and has a solar quote.",
      secondMessage: "Another client's property is in postcode 4000 and has a heating quote.",
      ambiguousMessage: "Back to the client property: does that quote still make sense?",
      clarification: "Which client property do you mean: the postcode 3000 job or the postcode 4000 job?",
    },
  ];

  for (const scenario of scenarios) {
    let current = recordLedgerTurn(emptySurgeConversationState(), {
      message: scenario.firstMessage,
      activeTopic: "solar",
      goal: "Review the first separate quote",
    });
    current = recordLedgerTurn(current, {
      message: scenario.secondMessage,
      activeTopic: "rcac",
      goal: "Review the second separate quote",
      intent: "topic_change",
    });
    current = recordLedgerTurn(current, {
      message: "Back to my saved home: where should I start?",
      activeTopic: "comfort_fabric",
      goal: "Prioritise my saved home",
      intent: "topic_change",
      planFacts: [{ key: "postcode", value: "3072" }],
    });

    const matchesPrefix = (id) => id.startsWith(scenario.prefix);
    const beforeSubjects = structuredClone(current.ledger.subjects.filter((subject) => matchesPrefix(subject.id)));
    const beforeDecisions = structuredClone(current.ledger.decisions.filter(
      (decision) => decision.subjectIds.some(matchesPrefix),
    ));
    assert.equal(beforeSubjects.length, 2, scenario.prefix);
    assert.equal(beforeDecisions.length, 2, scenario.prefix);

    const frame = selectSurgeConversationFrame(scenario.ambiguousMessage, current, true);
    assert.equal(frame.subject, null, scenario.prefix);
    assert.deepEqual(frame.subjects, [], scenario.prefix);
    assert.equal(frame.decision, null, scenario.prefix);
    assert.deepEqual(frame.relatedDecisions, [], scenario.prefix);
    assert.equal(
      resolveSurgeConversationReference(scenario.ambiguousMessage, [], current).status,
      "needs_clarification",
      scenario.prefix,
    );
    assert.equal(
      frame.inactiveIndex.filter((item) => beforeDecisions.some((decision) => decision.id === item.decisionId)).length,
      2,
      scenario.prefix,
    );

    const clarified = recordLedgerTurn(current, {
      message: scenario.ambiguousMessage,
      activeTopic: "general",
      goal: "Clarify which saved conversation subject the customer means",
      answerSummary: scenario.clarification,
      followUpQuestion: scenario.clarification,
      intent: "new_question",
    });
    assert.deepEqual(
      clarified.ledger.subjects.filter((subject) => matchesPrefix(subject.id)),
      beforeSubjects,
      scenario.prefix,
    );
    assert.deepEqual(
      clarified.ledger.decisions.filter((decision) => beforeDecisions.some((before) => before.id === decision.id)),
      beforeDecisions,
      scenario.prefix,
    );
  }
});

test("whole-conversation paraphrases select every decision for the saved home", () => {
  let current = emptySurgeConversationState();
  for (const [index, item] of [
    ["solar", "Check whether rooftop solar is worthwhile"],
    ["rcac", "Keep the existing reverse-cycle split running efficiently"],
    ["glazing_shading", "Improve the cold windows with honeycomb blinds"],
    ["heat_pump_hot_water", "Plan the hot-water replacement"],
  ].entries()) {
    current = recordLedgerTurn(current, {
      message: `Different question for my saved home: ${item[1]}.`,
      activeTopic: item[0],
      goal: item[1],
      intent: "topic_change",
      planFacts: index === 0 ? [{ key: "postcode", value: "3072" }] : [],
    });
  }

  for (const message of [
    "Considering everything we discussed about my home, what should I do first?",
    "Looking at all the issues with my house, put them in order.",
    "Where should I start considering all the things we covered for my home?",
    "Back to my home only: give me the top three actions in order using what I told you.",
  ]) {
    const frame = selectSurgeConversationFrame(message, current, true);
    assert.equal(frame.subject?.id, "saved_home", message);
    assert.equal(frame.relatedDecisions.length, 4, message);
    assert.deepEqual(
      new Set(frame.relatedDecisions.map((decision) => decision.topic)),
      new Set(["solar", "rcac", "glazing_shading", "heat_pump_hot_water"]),
      message,
    );
  }
});

test("a this-mean cross-topic question keeps the active unresolved safety decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The switchboard is crackling and I can smell burning. What should I do?",
    activeTopic: "general",
    goal: "Make the crackling switchboard safe",
    answerSummary: "Keep away and call urgent licensed electrical help.",
  });
  current = recordLedgerTurn(current, {
    message: "Should I reset the main breaker to see if it stops?",
    activeTopic: "general",
    goal: "Make the crackling switchboard safe",
    answerSummary: "Do not reset it; keep away until qualified help makes it safe.",
    intent: "contextual_follow_up",
  });

  const frame = selectSurgeConversationFrame(
    "Does this mean the solar quote I was considering is a bad idea?",
    current,
    true,
  );

  assert.equal(frame.decision?.id, current.ledger.activeDecisionId);
  assert.match(frame.decision?.goal || "", /switchboard/i);
  assert.equal(frame.relatedDecisions.some((decision) => decision.id === frame.decision?.id), true);
});

test("fifty decisions survive when several turns compare multiple subjects", () => {
  let current = emptySurgeConversationState();

  for (let index = 1; index <= 50; index += 1) {
    const multiSubject = index % 10 === 0;
    current = recordLedgerTurn(current, {
      message: multiSubject
        ? `Mum's postcode is 3000, Dad's postcode is 4000. Compare solar for both at checkpoint ${index}.`
        : `Different question for my saved home: remember bounded decision ${index}.`,
      activeTopic: multiSubject
        ? "solar"
        : ["solar", "battery_vpp", "rcac", "glazing_shading"][index % 4],
      goal: multiSubject
        ? `Compare Mum and Dad at checkpoint ${index}`
        : `Remember bounded saved-home decision ${index}`,
      answerSummary: `Delivered the distinct conclusion for checkpoint ${index}.`,
      intent: "topic_change",
      planFacts: index === 1 ? [{ key: "postcode", value: "3072" }] : [],
    });
  }

  const multiSubjectDecisions = current.ledger.decisions.filter((decision) => decision.subjectIds.length > 1);
  assert.equal(current.ledger.decisions.length, 50);
  assert.equal(new Set(current.ledger.decisions.map((decision) => decision.id)).size, 50);
  assert.equal(multiSubjectDecisions.length, 5);
  for (const decision of multiSubjectDecisions) {
    assert.equal(decision.topic, "general");
    assert.deepEqual(new Set(decision.subjectIds), new Set(["mums_home", "dads_home"]));
  }
  const earliestCombinedDecision = multiSubjectDecisions.find((decision) => decision.lastTouchedTurn === 10);
  assert.equal(earliestCombinedDecision?.goal, "Compare Mum and Dad at checkpoint 10");
  assert.match(earliestCombinedDecision?.outcomeSummary || "", /distinct conclusion for checkpoint 10/i);
  const serialized = JSON.stringify(current.ledger);
  assert.match(serialized, /saved-home decision 1/i);
  assert.match(serialized, /checkpoint 10/i);
  assert.match(serialized, /checkpoint 50/i);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= SURGE_MAX_LEDGER_BYTES);
  assert.ok(parseSurgeConversationState(current));
});

test("a short follow-up preserves a compacted three-subject decision and every subject capsule", () => {
  let current = emptySurgeConversationState();
  for (let index = 1; index <= 49; index += 1) {
    current = recordLedgerTurn(current, {
      message: `Different saved-home question: retain precursor decision ${index}.`,
      activeTopic: ["solar", "battery_vpp", "rcac", "glazing_shading"][index % 4],
      goal: `Retain precursor decision ${index}`,
      answerSummary: `Delivered precursor conclusion ${index}.`,
      intent: "topic_change",
      planFacts: index === 1 ? [{ key: "postcode", value: "3072" }] : [],
    });
  }

  const comparisonMessage = "My home's postcode is 3072, Mum's postcode is 3000, Dad's postcode is 4000. Compare solar for all three homes.";
  current = recordLedgerTurn(current, {
    message: comparisonMessage,
    activeTopic: "solar",
    goal: "Compare solar for my home, Mum's home and Dad's home",
    answerSummary: "Compared the three homes separately and identified which solar check should come first.",
    intent: "topic_change",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const comparisonDecisionId = current.ledger.activeDecisionId;
  const comparisonBeforeFollowUp = current.ledger.decisions.find(
    (decision) => decision.id === comparisonDecisionId,
  );
  assert.deepEqual(
    new Set(comparisonBeforeFollowUp?.subjectIds),
    new Set(["saved_home", "mums_home", "dads_home"]),
  );

  current = recordLedgerTurn(current, {
    message: "Which one should go first?",
    activeTopic: "general",
    goal: "Explain which of the three homes should be checked first",
    answerSummary: "Explained why the saved home should receive the first solar suitability check.",
    intent: "contextual_follow_up",
  });

  const comparisonAfterFollowUp = current.ledger.decisions.find(
    (decision) => decision.id === comparisonDecisionId,
  );
  assert.equal(current.ledger.activeDecisionId, comparisonDecisionId);
  assert.equal(current.ledger.decisions.length, 50);
  assert.deepEqual(
    new Set(comparisonAfterFollowUp?.subjectIds),
    new Set(["saved_home", "mums_home", "dads_home"]),
  );
  assert.match(comparisonAfterFollowUp?.goal || "", /my home, Mum's home and Dad's home/i);
  assert.match(comparisonAfterFollowUp?.outcomeSummary || "", /three homes separately/i);
  assert.match(comparisonAfterFollowUp?.outcomeSummary || "", /saved home should receive the first/i);

  const expectedPostcodes = new Map([
    ["saved_home", "3072"],
    ["mums_home", "3000"],
    ["dads_home", "4000"],
  ]);
  for (const [subjectId, postcode] of expectedPostcodes) {
    const subject = current.ledger.subjects.find((candidate) => candidate.id === subjectId);
    assert.ok(subject, subjectId);
    assert.equal(subject.facts.find((fact) => fact.key === "postcode")?.value, postcode, subjectId);
  }

  const followUpFrame = selectSurgeConversationFrame("Why that one?", current, true);
  assert.deepEqual(
    new Set(followUpFrame.subjects.map((subject) => subject.id)),
    new Set(["saved_home", "mums_home", "dads_home"]),
  );
  assert.equal(followUpFrame.decision?.id, comparisonDecisionId);
  assert.ok(new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES);
  assert.ok(parseSurgeConversationState(current));
});

test("a Mum and Dad comparison includes both pre-existing property histories", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum's solar system is in postcode 3000.",
    activeTopic: "solar",
    goal: "Review Mum's solar system",
  });
  current = recordLedgerTurn(current, {
    message: "Dad's solar system is in postcode 4000.",
    activeTopic: "solar",
    goal: "Review Dad's solar system",
    intent: "topic_change",
  });

  const frame = selectSurgeConversationFrame(
    "Compare Mum's solar with Dad's solar for both homes.",
    current,
    false,
  );
  assert.equal(frame.subject, null);
  assert.deepEqual(new Set(frame.subjects.map((subject) => subject.id)), new Set(["mums_home", "dads_home"]));
  assert.deepEqual(
    new Set(frame.relatedDecisions.flatMap((decision) => decision.subjectIds)),
    new Set(["mums_home", "dads_home"]),
  );
});

test("one comparison turn stores Mum and Dad as separate subjects with separate postcodes", () => {
  const message = "Mum’s postcode is 3000, Dad’s postcode is 4000. Compare solar for both.";
  const current = recordLedgerTurn(emptySurgeConversationState(), {
    message,
    activeTopic: "solar",
    goal: "Compare solar for Mum and Dad",
  });
  const mumsHome = current.ledger.subjects.find((subject) => subject.id === "mums_home");
  const dadsHome = current.ledger.subjects.find((subject) => subject.id === "dads_home");
  const decision = current.ledger.decisions.find((item) => item.id === current.ledger.activeDecisionId);

  assert.equal(mumsHome?.facts.find((fact) => fact.key === "postcode")?.value, "3000");
  assert.equal(dadsHome?.facts.find((fact) => fact.key === "postcode")?.value, "4000");
  assert.deepEqual(new Set(decision?.subjectIds), new Set(["mums_home", "dads_home"]));
  assert.equal(decision?.topic, "general");
  assert.match(decision?.facts.find((fact) => fact.key === "multi_subject_context")?.value || "", /3000.*4000/i);
});

test("inverter clipping is classified and continued as solar", () => {
  assert.equal(surgeConversationTopicFor("Why is my inverter clipping at midday?"), "solar");

  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Is the 6.6 kW solar quote worthwhile for my saved home?",
    activeTopic: "solar",
    goal: "Review the 6.6 kW solar quote",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const solarDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "The inverter is clipping at midday. Does that change the answer?",
    activeTopic: "solar",
    goal: "Check whether inverter clipping changes the solar recommendation",
    intent: "contextual_follow_up",
  });

  assert.equal(current.ledger.activeDecisionId, solarDecisionId);
  assert.equal(current.ledger.decisions.find((decision) => decision.id === solarDecisionId)?.topic, "solar");
});

test("a cross-topic $1,500 choice creates a general decision without overwriting prior goals", () => {
  const earlier = [
    ["glazing_shading", "Review honeycomb blinds for the cold windows"],
    ["solar", "Review adding more solar panels"],
    ["rcac", "Keep the working reverse-cycle split"],
  ];
  let current = emptySurgeConversationState();
  for (const [index, [activeTopic, goal]] of earlier.entries()) {
    current = recordLedgerTurn(current, {
      message: `Different question for my saved home: ${goal}.`,
      activeTopic,
      goal,
      intent: "topic_change",
      planFacts: index === 0 ? [{ key: "postcode", value: "3072" }] : [],
    });
  }
  const priorGoals = new Map(current.ledger.decisions.map((decision) => [decision.id, decision.goal]));

  const message = "Ok, I have $1,500. Blinds, a solar deposit, or a new split?";
  assert.equal(classifySurgeConversationTurn(message, current), "new_question");
  current = recordLedgerTurn(current, {
    message,
    activeTopic: "general",
    goal: "Choose the best use of the $1,500 budget",
    answerSummary: "Keep the working split and spend first on the option with the strongest practical benefit.",
  });
  const active = current.ledger.decisions.find((decision) => decision.id === current.ledger.activeDecisionId);
  const frame = selectSurgeConversationFrame(message, current, true);

  assert.equal(current.ledger.decisions.length, 4);
  assert.equal(active?.topic, "general");
  assert.match(active?.goal || "", /1,500 budget/i);
  for (const [decisionId, goal] of priorGoals) {
    assert.equal(current.ledger.decisions.find((decision) => decision.id === decisionId)?.goal, goal);
  }
  assert.deepEqual(
    new Set(frame.relatedDecisions.map((decision) => decision.topic)),
    new Set(["glazing_shading", "solar", "rcac"]),
  );
});

test("why not the solar deposit stays with the combined $1,500 decision and its delivered outcome", () => {
  const choiceMessage = "I have $1,500. Should I buy honeycomb blinds, put it toward a solar deposit, or replace my working split system?";
  const current = recordLedgerTurn(emptySurgeConversationState(), {
    message: choiceMessage,
    activeTopic: "general",
    goal: "Choose between blinds, a solar deposit and replacing the working split for $1,500",
    answerSummary: "Honeycomb blinds are the best use of the $1,500 because the split still works and a solar deposit does not deliver an immediate complete upgrade.",
    planFacts: [
      { key: "postcode", value: "3072" },
      { key: "property_type", value: "Apartment or unit" },
    ],
  });
  const combinedDecisionId = current.ledger.activeDecisionId;

  const followUp = "Why not the solar deposit?";
  assert.equal(classifySurgeConversationTurn(followUp, current), "contextual_follow_up");
  const frame = selectSurgeConversationFrame(followUp, current, true);

  assert.equal(frame.decision?.id, combinedDecisionId);
  assert.equal(frame.decision?.topic, "general");
  assert.match(frame.decision?.goal || "", /blinds.*solar deposit.*working split.*1,500/i);
  assert.match(frame.decision?.outcomeSummary || "", /blinds are the best use.*solar deposit/i);
  assert.equal(frame.relatedDecisions.some((decision) => decision.id === combinedDecisionId), true);
});

test("zero-export wording after a clipping detour reactivates the stronger prior solar decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My zero-export solar proposal has a 5 kW export limit. Will zero export hurt the payback?",
    activeTopic: "solar",
    goal: "Assess the zero-export limit and solar payback",
    answerSummary: "The zero-export limit makes daytime self-use central to the payback.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const zeroExportDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Different solar issue: why is the inverter clipping at midday?",
    activeTopic: "solar",
    goal: "Explain the separate inverter clipping issue",
    answerSummary: "Midday clipping can be normal when panel output exceeds inverter capacity.",
    intent: "topic_change",
  });
  assert.notEqual(current.ledger.activeDecisionId, zeroExportDecisionId);

  const frame = selectSurgeConversationFrame(
    "Back to the zero-export limit: will it reduce that solar payback?",
    current,
    true,
  );
  assert.equal(frame.decision?.id, zeroExportDecisionId);
  assert.match(frame.decision?.goal || "", /zero-export.*payback/i);
});

test("a yes-or-no zero-export follow-up returns from clipping to the earlier sizing decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Is 6.6 kW of panels with a 5 kW inverter a sensible solar size for my home?",
    activeTopic: "solar",
    goal: "Assess the 6.6 kW panel and 5 kW inverter solar sizing",
    answerSummary: "The 6.6 kW panel array and 5 kW inverter are a common pairing, subject to the home's usage and site constraints.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const zeroExportDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "The installer has now said the system will be zero export. Is it still worthwhile?",
    activeTopic: "solar",
    goal: "Assess whether the proposed zero-export solar system is still worthwhile",
    answerSummary: "Zero export does not make the system pointless, but it makes daytime self-use more important.",
    intent: "contextual_follow_up",
  });
  assert.equal(current.ledger.activeDecisionId, zeroExportDecisionId);
  assert.match(
    current.ledger.decisions.find((decision) => decision.id === zeroExportDecisionId)?.goal || "",
    /6\.6 kW.*zero export/i,
  );
  assert.match(
    current.ledger.decisions.find((decision) => decision.id === zeroExportDecisionId)?.outcomeSummary || "",
    /zero export does not make the system pointless/i,
  );

  current = recordLedgerTurn(current, {
    message: "Separate solar question: what does inverter clipping mean?",
    activeTopic: "solar",
    goal: "Explain inverter clipping",
    answerSummary: "Clipping is the normal limiting of panel output when it exceeds the inverter's conversion capacity.",
    intent: "topic_change",
  });
  const clippingDecisionId = current.ledger.activeDecisionId;
  assert.notEqual(clippingDecisionId, zeroExportDecisionId);

  const followUp = "So is zero-export solar pointless, yes or no?";
  const frame = selectSurgeConversationFrame(followUp, current, true);
  assert.equal(frame.decision?.id, zeroExportDecisionId);
  assert.notEqual(frame.decision?.id, clippingDecisionId);
  assert.match(frame.decision?.outcomeSummary || "", /zero export does not make the system pointless/i);
  assert.doesNotMatch(frame.decision?.goal || "", /clipping/i);
});

test("a correction immediately removes superseded derived conclusions from the active decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The quote is $5,900 and finance is $58 a month for seven years.",
    activeTopic: "heat_pump_hot_water",
    goal: "Check the $5,900 quote and $58 monthly finance",
    answerSummary: "$58 a month totals $4,872, leaving a $1,028 gap.",
    planFacts: [{ key: "postcode", value: "3000" }],
    facts: [{ key: "proposed_or_quoted_details", value: "$5,900 quote with $58 monthly finance" }],
  });
  const decisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Sorry, I read it wrong. It is $68 a month, not $58.",
    activeTopic: "heat_pump_hot_water",
    goal: "Check the $5,900 quote and $68 monthly finance",
    answerSummary: "$68 a month totals $5,712, leaving a $188 gap.",
    intent: "correction",
    facts: [{ key: "proposed_or_quoted_details", value: "$5,900 quote with $68 monthly finance" }],
  });

  assert.equal(current.ledger.activeDecisionId, decisionId);
  const activeDecision = current.ledger.decisions.find((decision) => decision.id === decisionId);
  assert.match(JSON.stringify(activeDecision), /\$68/);
  assert.match(JSON.stringify(activeDecision), /\$5,712/);
  assert.match(JSON.stringify(activeDecision), /\$188/);
  assert.doesNotMatch(JSON.stringify(activeDecision), /\$58|\$4,872|\$1,028/);
});

test("an explicit return to my apartment selects the $1,500 blinds decision after another-property detour", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My apartment windows feel freezing in winter. Would close-fitting honeycomb blinds help?",
    activeTopic: "glazing_shading",
    goal: "Improve the saved apartment's cold windows",
    answerSummary: "Close-fitting honeycomb blinds can reduce heat loss through the apartment windows.",
    planFacts: [
      { key: "postcode", value: "3072" },
      { key: "property_type", value: "Apartment or unit" },
    ],
  });
  const glazingDecisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Back to my apartment: the reverse-cycle split still heats fine, but the bill jumps when I use it.",
    activeTopic: "rcac",
    goal: "Keep the saved apartment's working reverse-cycle split efficient",
    answerSummary: "The existing split still heats properly, so a higher bill alone does not justify replacing it.",
    intent: "topic_change",
    facts: [{ key: "split_heating", value: "heats_fine" }],
  });
  const rcacDecisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "For my apartment, is honeycomb blinds, a solar deposit, or replacing the working split the best use of my $1,500?",
    activeTopic: "general",
    goal: "Choose between honeycomb blinds, a solar deposit and replacing the working split for the $1,500 saved-apartment budget",
    answerSummary: "Honeycomb blinds are the best use of the $1,500 while the split still works and solar remains only a deposit.",
    intent: "topic_change",
  });
  const budgetDecisionId = current.ledger.activeDecisionId;
  assert.notEqual(budgetDecisionId, glazingDecisionId);

  current = recordLedgerTurn(current, {
    message: "At Mum's separate house in postcode 3000, what insulation should she check first?",
    activeTopic: "insulation_draughts",
    goal: "Prioritise insulation checks at Mum's house",
    answerSummary: "Mum should confirm the ceiling insulation condition and coverage first.",
    intent: "topic_change",
  });
  assert.equal(current.ledger.subjects.some((subject) => subject.id === "mums_home"), true);

  const frame = selectSurgeConversationFrame(
    "Back to my apartment now. Do you still think blinds are the best use of my $1,500?",
    current,
    true,
  );
  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.id, budgetDecisionId);
  assert.notEqual(frame.decision?.id, glazingDecisionId);
  assert.match(frame.decision?.goal || "", /blinds.*solar.*split.*\$1,500.*saved-apartment/i);
  assert.match(frame.decision?.outcomeSummary || "", /blinds are the best use.*split still works.*solar.*deposit/i);
  assert.equal(frame.relatedDecisions.some((decision) => (
    decision.id === rcacDecisionId
      && decision.facts.some((fact) => fact.key === "split_heating" && fact.value === "heats_fine")
  )), true);
  assert.doesNotMatch(JSON.stringify(frame.relatedDecisions), /Mum|3073/);

  const framed = projectSurgeConversationStateToFrame(
    "Back to my apartment now. Do you still think blinds are the best use of my $1,500?",
    current,
    true,
  );
  assert.equal(
    classifySurgeConversationTurn(
      "Back to my apartment now. Do you still think blinds are the best use of my $1,500?",
      framed,
      [],
    ),
    "contextual_follow_up",
  );
  const decisionContext = surgeConversationDecisionContext(
    "Back to my apartment now. Do you still think blinds are the best use of my $1,500?",
    framed,
    [],
  );
  assert.match(decisionContext, /blinds.*solar.*split.*\$1,500.*saved-apartment/i);
  assert.match(decisionContext, /back to my apartment.*blinds.*\$1,500/i);
  assert.equal(
    classifySurgeConversationTurn("Are honeycomb blinds better than curtains?", framed, []),
    "new_question",
  );
});

test("explicit return anchors select one prior decision without overriding named topics or ambiguity", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "I feel a draught under the front door.",
    activeTopic: "comfort_fabric",
    goal: "Stop the draught under the front door",
    answerSummary: "Use a door snake first, then fit a correctly sized door-bottom weather seal.",
    planFacts: [{ key: "property_type", value: "Apartment or unit" }],
  });
  const doorDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "What should I check when comparing solar quotes?",
    activeTopic: "solar",
    goal: "Compare the solar quotes and inverter warranty",
    answerSummary: "Compare the same site design and the written inverter warranty.",
    intent: "topic_change",
  });
  const solarDecisionId = current.ledger.activeDecisionId;

  const doorReturn = selectSurgeConversationFrame(
    "Back to the front door, what lasting fix did you recommend?",
    current,
    true,
  );
  assert.equal(doorReturn.decision?.id, doorDecisionId);
  assert.equal(selectSurgeConversationFrame("Back to door.", current, true).decision?.id, doorDecisionId);

  const namedSolarReturn = selectSurgeConversationFrame(
    "Back to the solar quote: what should I ask first?",
    current,
    true,
  );
  assert.equal(namedSolarReturn.decision?.id, solarDecisionId);

  const genericReturn = selectSurgeConversationFrame(
    "Back to the recommendation, what should I do first?",
    current,
    true,
  );
  assert.equal(genericReturn.decision?.id, solarDecisionId);

  const doorDecision = current.ledger.decisions.find((decision) => decision.id === doorDecisionId);
  assert.ok(doorDecision);
  const tied = {
    ...current,
    ledger: {
      ...current.ledger,
      turn: current.ledger.turn + 1,
      decisions: [
        ...current.ledger.decisions,
        {
          ...doorDecision,
          id: "decision_3_duplicate_front_door",
          lastTouchedTurn: current.ledger.turn + 1,
        },
      ],
    },
  };
  const ambiguousMessage = "Back to the front door, what lasting fix did you recommend?";
  const ambiguousFrame = selectSurgeConversationFrame(ambiguousMessage, tied, true);
  assert.equal(ambiguousFrame.subject, null);
  assert.equal(ambiguousFrame.decision, null);
  assert.equal(
    resolveSurgeConversationReference(ambiguousMessage, [], tied).status,
    "needs_clarification",
  );
  assert.equal(
    selectSurgeConversationFrame(
      "Back to the first front door, what lasting fix did you recommend?",
      tied,
      true,
    ).decision?.id,
    doorDecisionId,
  );
  assert.equal(
    selectSurgeConversationFrame(
      "Back to the latest front door, what lasting fix did you recommend?",
      tied,
      true,
    ).decision?.id,
    "decision_3_duplicate_front_door",
  );

  const returnedToDoor = {
    ...current,
    activeTopic: doorDecision.topic,
    goal: doorDecision.goal,
    lastAnswerSummary: doorDecision.outcomeSummary,
    ledger: {
      ...current.ledger,
      activeDecisionId: doorDecisionId,
    },
  };
  const recallMessage = "What lasting fix did you recommend?";
  assert.equal(isSurgeContextDependentMessage(recallMessage), true);
  assert.equal(classifySurgeConversationTurn(recallMessage, returnedToDoor, []), "contextual_follow_up");
  assert.equal(selectSurgeConversationFrame(recallMessage, returnedToDoor, true).decision?.id, doorDecisionId);
  for (const newSolarQuestion of [
    "What solar system would you recommend?",
    "What do you recommend for solar?",
  ]) {
    assert.equal(isSurgeContextDependentMessage(newSolarQuestion), false);
    assert.equal(classifySurgeConversationTurn(newSolarQuestion, returnedToDoor, []), "new_question");
  }

  const filteredRecallTurns = filterSurgeRecentTurnsForFrame(
    recallMessage,
    returnedToDoor,
    true,
    [
      { role: "user", content: "Which reverse-cycle air conditioner should I choose?" },
      { role: "assistant", content: "Compare capacity, efficiency and installation scope." },
      { role: "user", content: "Back to the front door." },
      { role: "assistant", content: "Back to the draught and the lasting door seal." },
    ],
  );
  assert.doesNotMatch(JSON.stringify(filteredRecallTurns), /reverse-cycle|capacity|efficiency/i);
  assert.match(JSON.stringify(filteredRecallTurns), /front door|door seal/i);

  const sameSubjectTopicDetourText = JSON.stringify(filterSurgeRecentTurnsForFrame(
    recallMessage,
    returnedToDoor,
    true,
    [
      { role: "user", content: "At my home, what else should I check when comparing solar quotes?" },
      { role: "assistant", content: "Compare the site design, equipment, warranties and exclusions." },
      { role: "user", content: "Back to the front door." },
      { role: "assistant", content: "Back to the lasting door seal." },
    ],
  ));
  assert.doesNotMatch(sameSubjectTopicDetourText, /solar|equipment|warranties|exclusions/i);
  assert.match(sameSubjectTopicDetourText, /front door|door seal/i);

  const returnedAfterMoistureDetour = {
    ...returnedToDoor,
    ledger: {
      ...returnedToDoor.ledger,
      decisions: [
        ...returnedToDoor.ledger.decisions,
        {
          ...doorDecision,
          id: "decision_3_bedroom_moisture",
          goal: "Fix bedroom humidity and mould",
          facts: [],
          outcomeSummary: "Find and stop the moisture source before treating the mould.",
          lastTouchedTurn: current.ledger.turn + 1,
        },
      ],
    },
  };
  const moistureFilteredText = JSON.stringify(filterSurgeRecentTurnsForFrame(
    recallMessage,
    returnedAfterMoistureDetour,
    true,
    [
      { role: "user", content: "The bedroom has humidity." },
      { role: "assistant", content: "Find and stop the moisture source before treating mould." },
      { role: "user", content: "Back to the front door." },
      { role: "assistant", content: "Back to the lasting door seal." },
    ],
  ));
  assert.doesNotMatch(moistureFilteredText, /bedroom|humidity|moisture|mould/i);
  assert.match(moistureFilteredText, /front door|door seal/i);

  const glazingDecision = {
    ...doorDecision,
    id: "decision_2_glazing",
    topic: "glazing_shading",
    goal: "Reduce heat loss through the single-glazed windows",
    facts: [],
    outcomeSummary: "Use close-fitting window coverings before replacing glazing.",
    lastTouchedTurn: 2,
  };
  const rcacDecision = {
    ...doorDecision,
    id: "decision_3_rcac",
    topic: "rcac",
    goal: "Choose a correctly sized reverse-cycle air conditioner",
    facts: [],
    outcomeSummary: "Compare capacity, efficiency and installation scope.",
    lastTouchedTurn: 3,
  };
  const activeRcacState = {
    ...returnedToDoor,
    activeTopic: "rcac",
    goal: rcacDecision.goal,
    lastAnswerSummary: rcacDecision.outcomeSummary,
    ledger: {
      ...returnedToDoor.ledger,
      turn: 3,
      activeDecisionId: rcacDecision.id,
      decisions: [doorDecision, glazingDecision, rcacDecision],
    },
  };
  const historicalDoorText = JSON.stringify(filterSurgeRecentTurnsForFrame(
    "Back to the front door, what lasting fix did you recommend?",
    activeRcacState,
    true,
    [
      { role: "user", content: "I feel a draught under the front door." },
      { role: "assistant", content: "Use a door snake, then fit a door-bottom seal." },
      { role: "user", content: "The single-glazed windows also feel cold." },
      { role: "assistant", content: "Try close-fitting window coverings." },
      { role: "user", content: "Which reverse-cycle air conditioner should I choose?" },
      { role: "assistant", content: "Compare capacity, efficiency and installation scope." },
    ],
  ));
  assert.match(historicalDoorText, /front door|door-bottom seal/i);
  assert.doesNotMatch(historicalDoorText, /single-glazed|window coverings|reverse-cycle|capacity|efficiency/i);
});

test("return history isolates one of two same-home solar quotes", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My first solar quote is $8,000 for 6.6 kW with an Alpha inverter.",
    activeTopic: "solar",
    goal: "Review the first $8,000 6.6 kW solar quote",
    answerSummary: "The Alpha inverter has a five-year warranty.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const firstQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "For my saved home, how does the feed-in tariff affect it?",
    activeTopic: "solar",
    goal: "Review the first $8,000 6.6 kW solar quote",
    answerSummary: "The feed-in tariff affects the value of exported solar.",
    intent: "contextual_follow_up",
  });
  assert.equal(current.ledger.activeDecisionId, firstQuoteId);
  current = recordLedgerTurn(current, {
    message: "Different solar quote: $12,000 for 16.6 kW with a Beta inverter.",
    activeTopic: "solar",
    goal: "Review the second $12,000 16.6 kW solar quote",
    answerSummary: "The Beta inverter has a ten-year warranty.",
    intent: "topic_change",
  });
  const secondQuoteId = current.ledger.activeDecisionId;
  assert.notEqual(secondQuoteId, firstQuoteId);
  current = recordLedgerTurn(current, {
    message: "For my saved home, how should the STC rebate affect it?",
    activeTopic: "solar",
    goal: "Review the second $12,000 16.6 kW solar quote",
    answerSummary: "The STC discount should be shown clearly in the second quote.",
    intent: "contextual_follow_up",
  });
  assert.equal(current.ledger.activeDecisionId, secondQuoteId);
  for (const genericFacetMessage of [
    "For my saved home, how does the STC rebate affect it?",
    "For my saved home, how should we apply the STC rebate to it?",
  ]) {
    const genericFacet = recordLedgerTurn(current, {
      message: genericFacetMessage,
      activeTopic: "solar",
      goal: "Review the second $12,000 16.6 kW solar quote",
      answerSummary: "The STC discount should be shown clearly in the active quote.",
      intent: "contextual_follow_up",
    });
    assert.equal(genericFacet.ledger.activeDecisionId, secondQuoteId, genericFacetMessage);
  }
  for (const priorQuoteReference of ["Alpha", "$8,000", "6.6 kW"]) {
    const priorQuoteMessage = `For the ${priorQuoteReference} quote, how should the STC rebate affect it?`;
    assert.equal(
      classifySurgeConversationTurn(priorQuoteMessage, current, []),
      "contextual_follow_up",
      `intent: ${priorQuoteReference}`,
    );
    assert.equal(
      selectSurgeConversationFrame(priorQuoteMessage, current, true).decision?.id,
      firstQuoteId,
      `frame: ${priorQuoteReference}`,
    );
    const explicitlyRevisited = recordLedgerTurn(current, {
      message: priorQuoteMessage,
      activeTopic: "solar",
      goal: "Review the first $8,000 6.6 kW solar quote",
      answerSummary: "The STC discount should be shown clearly in the first quote.",
      intent: "contextual_follow_up",
    });
    assert.equal(explicitlyRevisited.ledger.activeDecisionId, firstQuoteId, priorQuoteReference);
  }

  const recentTurns = [
    { role: "user", content: "My first solar quote is $8,000 for 6.6 kW with an Alpha inverter." },
    { role: "assistant", content: "The Alpha inverter has a five-year warranty." },
    { role: "user", content: "For my saved home, how does the feed-in tariff affect it?" },
    { role: "assistant", content: "The feed-in tariff affects the value of exported solar." },
    { role: "user", content: "Different solar quote: $12,000 for 16.6 kW with a Beta inverter." },
    { role: "assistant", content: "The Beta inverter has a ten-year warranty." },
    { role: "user", content: "For my saved home, how should the STC rebate affect it?" },
    { role: "assistant", content: "The STC discount should be shown clearly in the second quote." },
    { role: "user", content: "Does that second quote need optimisers?" },
    { role: "assistant", content: "Only if the site design has a reason for them." },
  ];
  for (const message of [
    "Back to the first solar quote: what warranty did it have?",
    "Back to the $8,000 solar quote: what warranty did it have?",
  ]) {
    const frame = selectSurgeConversationFrame(message, current, true);
    assert.equal(frame.decision?.id, firstQuoteId);
    const filteredText = JSON.stringify(filterSurgeRecentTurnsForFrame(
      message,
      current,
      true,
      recentTurns,
    ));
    assert.match(filteredText, /\$8,000|6\.6 kW|Alpha|five-year/i);
    assert.match(filteredText, /feed-in tariff|exported solar/i);
    assert.doesNotMatch(filteredText, /\$12,000|16\.6 kW|Beta|ten-year|STC discount|optimisers/i);
  }

  const secondQuoteReturn = "Back to the $12,000 solar quote: what did the STC discount change?";
  assert.equal(selectSurgeConversationFrame(secondQuoteReturn, current, true).decision?.id, secondQuoteId);
  const secondQuoteHistory = JSON.stringify(filterSurgeRecentTurnsForFrame(
    secondQuoteReturn,
    current,
    true,
    recentTurns,
  ));
  assert.match(secondQuoteHistory, /\$12,000|16\.6 kW|Beta|ten-year|STC discount/i);
  assert.doesNotMatch(secondQuoteHistory, /\$8,000|(?:^|[^0-9.])6\.6 kW|Alpha|five-year|feed-in tariff/i);

  let lexicalTarget = recordLedgerTurn(emptySurgeConversationState(), {
    message: "I have another solar quote using an Alpha inverter; is it better?",
    activeTopic: "solar",
    goal: "Review another solar quote using an Alpha inverter and warranty",
    answerSummary: "Check the Alpha inverter warranty and complete installed scope.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const alphaDecisionId = lexicalTarget.ledger.activeDecisionId;
  lexicalTarget = recordLedgerTurn(lexicalTarget, {
    message: "Different topic: should I replace my hot-water system?",
    activeTopic: "heat_pump_hot_water",
    goal: "Review a hot-water system replacement",
    answerSummary: "Check the existing system before choosing a replacement.",
    intent: "topic_change",
  });
  const alphaReturn = "Back to the Alpha inverter solar quote: what warranty did it have?";
  assert.equal(selectSurgeConversationFrame(alphaReturn, lexicalTarget, true).decision?.id, alphaDecisionId);
  assert.equal(selectSurgeConversationFrame("Back to Alpha.", lexicalTarget, true).decision?.id, alphaDecisionId);
  const lexicalFilteredText = JSON.stringify(filterSurgeRecentTurnsForFrame(
    alphaReturn,
    lexicalTarget,
    true,
    [
      { role: "user", content: "I have another solar quote using an Alpha inverter; is it better?" },
      { role: "assistant", content: "Check the Alpha inverter warranty and complete installed scope." },
      { role: "user", content: "Different topic: should I replace my hot-water system?" },
      { role: "assistant", content: "Check the existing system before choosing a replacement." },
    ],
  ));
  assert.match(lexicalFilteredText, /Alpha inverter|installed scope/i);
  assert.doesNotMatch(lexicalFilteredText, /hot-water|replacement/i);
});

test("comparison addenda keep the active priced quote instead of jumping to an older same-topic decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My single-glazed windows feel freezing even when there is no wind.",
    activeTopic: "glazing_shading",
    goal: "Reduce cold-window discomfort at the saved home",
    answerSummary: "Close-fitting window coverings can reduce cold-window discomfort.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const olderWindowDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "I got two quotes: honeycomb blinds are $1,400 and thermal curtains are $900, both installed. Which one makes more sense?",
    activeTopic: "glazing_shading",
    goal: "Compare the $1,400 honeycomb blinds with the $900 thermal curtains",
    answerSummary: "The quotes differ by $500, so fit and winter comfort decide whether the honeycomb premium is worthwhile.",
    intent: "topic_change",
    facts: [
      { key: "honeycomb_blinds_quote", value: "$1,400 installed" },
      { key: "thermal_curtains_quote", value: "$900 installed" },
    ],
  });
  const quoteDecisionId = current.ledger.activeDecisionId;
  assert.notEqual(quoteDecisionId, olderWindowDecisionId);

  current = recordLedgerTurn(current, {
    message: "Same five-year warranty, but winter comfort is my priority.",
    activeTopic: "glazing_shading",
    goal: "Use the equal warranty and winter priority to choose between the two window quotes",
    answerSummary: "Winter comfort may justify the $500 honeycomb premium if the blinds fit closely.",
    intent: "contextual_follow_up",
    facts: [{ key: "warranty", value: "same_five_year_warranty" }],
  });

  assert.equal(current.ledger.activeDecisionId, quoteDecisionId);
  const frame = selectSurgeConversationFrame("So which would you pick?", current, true);
  assert.equal(frame.decision?.id, quoteDecisionId);
  assert.match(JSON.stringify(frame.relatedDecisions), /\$1,400/);
  assert.match(JSON.stringify(frame.relatedDecisions), /\$900/);
  assert.notEqual(frame.decision?.id, olderWindowDecisionId);
});

test("an explicit general-question detour cannot inherit saved-home facts and returning home restores them", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home, where should I start?",
    activeTopic: "general",
    goal: "Prioritise the saved home",
    planFacts: [
      { key: "postcode", value: "3072" },
      { key: "property_type", value: "Apartment or unit" },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "General question, not about my apartment: does a heat-pump clothes dryer need a vent outside?",
    activeTopic: "general",
    goal: "Explain whether a heat-pump clothes dryer needs an outside vent",
    facts: [
      { key: "postcode", value: "3072" },
      { key: "property_type", value: "Apartment or unit" },
    ],
  });

  assert.equal(current.ledger.subjects.find((subject) => subject.id === "general_advice")?.facts.length, 0);
  assert.doesNotMatch(JSON.stringify(current.facts), /3072|apartment/i);

  current = recordLedgerTurn(current, {
    message: "And are they cheaper to run than a vented dryer?",
    activeTopic: "general",
    goal: "Compare heat-pump and vented dryer running costs",
    intent: "contextual_follow_up",
    facts: current.facts,
  });
  assert.equal(current.ledger.subjects.find((subject) => subject.id === "general_advice")?.facts.length, 0);
  assert.doesNotMatch(JSON.stringify(current.facts), /3072|apartment/i);

  current = recordLedgerTurn(current, {
    message: "Back to my place: is the split likely faulty?",
    activeTopic: "rcac",
    goal: "Check the saved home's split system",
    planFacts: [
      { key: "postcode", value: "3072" },
      { key: "property_type", value: "Apartment or unit" },
    ],
  });
  assert.match(JSON.stringify(current.facts), /3072/i);
  assert.equal(current.ledger.subjects.find((subject) => subject.id === "general_advice")?.facts.length, 0);
});

test("ledger compaction keeps the active decision and older open work ahead of resolved history", () => {
  const decisions = [
    {
      id: "decision_open_old",
      subjectIds: ["saved_home"],
      topic: "topic_open",
      goal: "Old decision still awaiting an answer",
      facts: [],
      outcomeSummary: "Waiting for one detail.",
      openItems: ["Confirm the missing detail."],
      pendingQuestion: "Confirm the missing detail.",
      status: "open",
      lastTouchedTurn: 1,
    },
    ...Array.from({ length: SURGE_MAX_LEDGER_DECISIONS - 1 }, (_, index) => ({
      id: `decision_resolved_${index + 2}`,
      subjectIds: ["saved_home"],
      topic: `topic_${index + 2}`,
      goal: `Resolved item ${index + 2}`,
      facts: [],
      outcomeSummary: "Resolved.",
      openItems: [],
      pendingQuestion: "",
      status: "resolved",
      lastTouchedTurn: index + 2,
    })),
  ];
  const parsed = parseSurgeConversationState(state({
    ledger: {
      turn: SURGE_MAX_LEDGER_DECISIONS,
      activeDecisionId: `decision_resolved_${SURGE_MAX_LEDGER_DECISIONS}`,
      subjects: [{
        id: "saved_home",
        kind: "saved_home",
        label: "Saved home",
        facts: [],
        lastTouchedTurn: SURGE_MAX_LEDGER_DECISIONS,
      }],
      decisions,
    },
  }));
  assert.ok(parsed, "maximum-size decision fixture must pass the public parser");

  const compacted = recordLedgerTurn(parsed, {
    message: "Different question: solar panels for my saved home",
    activeTopic: "solar",
    goal: "Decide whether to install solar panels",
    answerSummary: "Solar is worth assessing against daytime use and roof suitability.",
    intent: "topic_change",
  });
  const decisionIds = compacted.ledger.decisions.map((decision) => decision.id);

  assert.equal(compacted.ledger.decisions.length, SURGE_MAX_LEDGER_DECISIONS);
  assert.equal(decisionIds.includes(compacted.ledger.activeDecisionId), true);
  assert.equal(compacted.ledger.decisions[0].id, compacted.ledger.activeDecisionId);
  assert.equal(decisionIds.includes("decision_open_old"), true);
  assert.equal(decisionIds.includes("decision_resolved_2"), false);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(compacted.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES,
  );
  assert.ok(parseSurgeConversationState(compacted));
});

test("two explicitly different properties receive distinct subjects and never overwrite each other", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Using my saved answers, where should I start?",
    activeTopic: "comfort_fabric",
    goal: "Prioritise the saved home",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  current = recordLedgerTurn(current, {
    message: "Another property is in postcode 4000 and needs solar advice.",
    activeTopic: "solar",
    goal: "Review solar for another property",
  });
  current = recordLedgerTurn(current, {
    message: "A different property is in postcode 5000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for a different property",
  });

  const otherProperties = current.ledger.subjects.filter((subject) => subject.id.startsWith("other_property_"));
  assert.equal(otherProperties.length, 2);
  assert.equal(new Set(otherProperties.map((subject) => subject.id)).size, 2);
  assert.deepEqual(
    new Set(otherProperties.map((subject) => subject.facts.find((fact) => fact.key === "postcode")?.value)),
    new Set(["4000", "5000"]),
  );
});

test("based on my survey explicitly returns to the saved-home frame", () => {
  const current = savedHomeAndMumLedger();
  const frame = selectSurgeConversationFrame(
    "Based on my survey, what should I do first?",
    current,
    true,
  );

  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision, null, "a new whole-home priority question must not be forced into an old solar decision");
  assert.equal(frame.relatedDecisions.some((decision) => decision.subjectIds.includes("mums_home")), false);
});

test("capacity and tenure corrections remove every superseded value from the selected frame", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "I own the home and the battery quote is for 10 kWh.",
    activeTopic: "battery_vpp",
    goal: "Check my 10 kWh battery quote as an owner",
    facts: [
      { key: "tenure", value: "owner" },
      { key: "supplied_quantities", value: "10 kWh" },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "Actually it is 13 kWh, not 10 kWh, and I rent.",
    activeTopic: "battery_vpp",
    goal: "Check my battery quote",
    answerSummary: "Updated the corrected capacity and renter context.",
    intent: "correction",
    facts: [
      { key: "tenure", value: "renter" },
      { key: "supplied_quantities", value: "13 kWh" },
    ],
  });

  const frame = selectSurgeConversationFrame("Does that quote make sense now?", current, false);
  const selectedText = JSON.stringify({ subject: frame.subject, decision: frame.decision });
  assert.match(selectedText, /13 kWh/i);
  assert.match(selectedText, /renter/i);
  assert.doesNotMatch(selectedText, /10 kWh|\bowner\b/i);
});

test("overall wording does not expose unrelated decisions or their figures", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My solar quote is $12,400 for 7.2 kW.",
    activeTopic: "solar",
    goal: "Review the $12,400 solar quote",
  });
  current = recordLedgerTurn(current, {
    message: "My battery quote is $9,500 for 10 kWh.",
    activeTopic: "battery_vpp",
    goal: "Review the $9,500 battery quote",
  });

  const frame = selectSurgeConversationFrame("Overall, is this battery quote good?", current, false);
  assert.deepEqual(frame.relatedDecisions.map((decision) => decision.topic), ["battery_vpp"]);
  assert.doesNotMatch(JSON.stringify(frame.relatedDecisions), /12,400|7\.2 kW/);
});

test("an overall quote return restores the original subject and gathers only later quote facets", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My window quote is $1,400 for honeycomb blinds.",
    activeTopic: "glazing_shading",
    goal: "Review the $1,400 honeycomb blind quote",
    answerSummary: "The window quote is separate from the hot-water decision.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  current = recordLedgerTurn(current, {
    message: "Different quote: heat-pump hot water is $5,900 and switchboard work is extra.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 heat-pump hot-water quote",
    answerSummary: "The finance is $188 short and switchboard work remains extra.",
    intent: "topic_change",
  });
  const quoteDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "For my saved home's hot-water quote, what are STCs and VEECs?",
    activeTopic: "rebates_certificates",
    goal: "Explain STCs and VEECs used in the quote",
    answerSummary: "STCs and VEECs can reduce the customer price.",
    intent: "topic_change",
  });
  current = recordLedgerTurn(current, {
    message: "For my saved home's hot-water quote, the admin fee is $330. Is that reasonable?",
    activeTopic: "products_ratings",
    goal: "Check the $330 admin fee in the quote",
    answerSummary: "The $330 fee is plausible if its scope is clear.",
    intent: "topic_change",
  });
  const feeDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Unrelated: can you help with a scone recipe?",
    activeTopic: "general",
    goal: "Answer the unrelated recipe request",
    answerSummary: "The recipe is outside the home-energy scope.",
    intent: "topic_change",
  });

  const frame = selectSurgeConversationFrame(
    "Right, back to the hot-water quote. Overall, is it a good deal?",
    current,
    true,
  );
  const relatedIds = new Set(frame.relatedDecisions.map((decision) => decision.id));
  const relatedText = JSON.stringify(frame.relatedDecisions);

  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.id, quoteDecisionId);
  assert.equal(relatedIds.has(quoteDecisionId), true);
  assert.equal(relatedIds.has(feeDecisionId), true);
  assert.match(relatedText, /\$188/);
  assert.match(relatedText, /\$330/);
  assert.match(relatedText, /STCs and VEECs/i);
  assert.doesNotMatch(relatedText, /1,400|scone|recipe/i);
});

test("an inactive finance quote retains its repayment total, quote gap and excluded work after an interruption", () => {
  const quoteMessage = "Different quote: heat-pump hot water is $5,900 after rebates, finance is $68 a month for seven years, and switchboard work is extra.";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: quoteMessage,
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 heat-pump hot-water quote and finance",
    answerSummary: "$68 a month for seven years totals $5,712, which is $188 short of the quote, and switchboard work is extra.",
    planFacts: [{ key: "postcode", value: "3072" }],
    derivedFacts: surgeRecurringFinanceConversationFacts(quoteMessage, []),
  });
  const quoteDecisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Separate question: would honeycomb blinds help my cold windows?",
    activeTopic: "glazing_shading",
    goal: "Review honeycomb blinds for the saved home's cold windows",
    answerSummary: "Close-fitting honeycomb blinds can reduce heat loss through cold windows.",
    intent: "topic_change",
  });

  assert.notEqual(current.ledger.activeDecisionId, quoteDecisionId);
  const quoteDecision = current.ledger.decisions.find((decision) => decision.id === quoteDecisionId);
  const quoteFacts = Object.fromEntries(
    (quoteDecision?.facts || []).map((fact) => [fact.key, fact.value]),
  );
  assert.equal(quoteFacts.finance_repayment_total, "$5,712");
  assert.equal(quoteFacts.finance_quote_gap, "$188 short of the quoted price");
  assert.equal(quoteFacts.finance_excluded_work, "switchboard work");

  const frame = selectSurgeConversationFrame(
    "Back to the hot-water quote: does that finance add up once the extra switchboard work is included?",
    current,
    true,
  );
  assert.equal(frame.decision?.id, quoteDecisionId);
  assert.deepEqual(
    Object.fromEntries((frame.decision?.facts || []).map((fact) => [fact.key, fact.value])),
    quoteFacts,
  );
});

test("back to my place selects the saved-home subject without overwriting an unrelated decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Does this mean we have a mould problem?",
    activeTopic: "comfort_fabric",
    goal: "Work out whether the saved home has a mould problem",
    answerSummary: "Condensation raises mould risk but does not prove mould.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const mouldDecisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Back to my place: the reverse-cycle split still heats fine, but the bill jumps. Is it faulty?",
    activeTopic: "rcac",
    goal: "Check whether the reverse-cycle split is faulty or simply running more",
    answerSummary: "A higher bill alone does not prove the working split system is faulty.",
    intent: "contextual_follow_up",
  });

  assert.equal(current.ledger.decisions.length, 2);
  assert.notEqual(current.ledger.activeDecisionId, mouldDecisionId);
  assert.equal(current.ledger.decisions.find((decision) => decision.id === mouldDecisionId)?.topic, "comfort_fabric");
  assert.match(
    current.ledger.decisions.find((decision) => decision.id === mouldDecisionId)?.goal || "",
    /mould problem/i,
  );
  const active = current.ledger.decisions.find((decision) => decision.id === current.ledger.activeDecisionId);
  assert.equal(active?.topic, "rcac");
  assert.match(active?.goal || "", /reverse-cycle split/i);
});

test("a reused decision retains the previous delivered answer and unresolved work", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "How should I compare these two quotes?",
    activeTopic: "products_ratings",
    goal: "Compare two quotes",
    answerSummary: "First compare the exact models. Second compare every installation inclusion.",
    followUpQuestion: "What warranty does each quote include?",
  });
  current = recordLedgerTurn(current, {
    message: "What about the installation dates too?",
    activeTopic: "products_ratings",
    goal: "Compare two quotes",
    answerSummary: "Also compare the promised installation dates and cancellation terms.",
    followUpQuestion: "What installation date does each quote promise?",
    intent: "contextual_follow_up",
  });

  const decision = current.ledger.decisions.find((item) => item.id === current.ledger.activeDecisionId);
  assert.match(decision.outcomeSummary, /Second compare every installation inclusion/i);
  assert.match(decision.outcomeSummary, /promised installation dates/i);
  assert.deepEqual(decision.openItems, [
    "What warranty does each quote include?",
    "What installation date does each quote promise?",
  ]);
  assert.match(current.lastAnswerSummary, /^Also compare the promised installation dates/i);
});

test("compatible follow-ups retain the decision's primary topic", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home, is the bedroom condensation a moisture problem?",
    activeTopic: "comfort_fabric",
    goal: "Work out why the bedroom has condensation",
    answerSummary: "The bedroom condensation needs moisture control and a check for cold surfaces.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const decisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Could the cold windows be causing it too?",
    activeTopic: "glazing_shading",
    goal: "Check whether cold windows are contributing to the condensation",
    answerSummary: "Cold glass can contribute when moist indoor air reaches the window.",
    intent: "contextual_follow_up",
  });

  const decision = current.ledger.decisions.find((item) => item.id === decisionId);
  assert.equal(current.ledger.activeDecisionId, decisionId);
  assert.equal(decision?.topic, "comfort_fabric");
  assert.match(decision?.goal || "", /condensation/i);
  assert.match(decision?.goal || "", /cold windows/i);
});

test("different quote starts a new decision instead of overwriting the prior quote", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My honeycomb blind quote is $1,400.",
    activeTopic: "glazing_shading",
    goal: "Review the $1,400 honeycomb blind quote",
    answerSummary: "The blind quote needs its dimensions and installation scope checked.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const firstDecisionId = current.ledger.activeDecisionId;
  const nextMessage = "Different quote: heat-pump hot water is $5,900 after rebates.";
  const intent = classifySurgeConversationTurn(nextMessage, current, []);
  assert.equal(intent, "topic_change");

  current = recordLedgerTurn(current, {
    message: nextMessage,
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 heat-pump hot-water quote",
    answerSummary: "The hot-water quote needs the exact model and full installed scope checked.",
    intent,
  });

  assert.equal(current.ledger.decisions.length, 2);
  assert.equal(current.ledger.decisions.find((item) => item.id === firstDecisionId)?.topic, "glazing_shading");
  assert.equal(
    current.ledger.decisions.find((item) => item.id === current.ledger.activeDecisionId)?.topic,
    "heat_pump_hot_water",
  );
});

test("ledger parser rejects impossible active ids and future touch timestamps", () => {
  const noActive = validLedger();
  noActive.activeDecisionId = "";
  const futureSubject = validLedger();
  futureSubject.subjects[0].lastTouchedTurn = 2;
  const futureFact = validLedger();
  futureFact.subjects[0].facts[0].updatedTurn = 2;
  const futureDecision = validLedger();
  futureDecision.decisions[0].lastTouchedTurn = 2;

  for (const ledger of [noActive, futureSubject, futureFact, futureDecision]) {
    assert.equal(parseSurgeConversationState(state({ ledger })), null);
  }
});

test("ledger parser rejects contradictory unresolved-work state", () => {
  const resolvedWithOpenWork = validLedger();
  resolvedWithOpenWork.decisions[0].openItems = ["What is still missing?"];
  const resolvedWithPendingQuestion = validLedger();
  resolvedWithPendingQuestion.decisions[0].pendingQuestion = "What is still missing?";
  const pendingQuestionNotTracked = validLedger();
  pendingQuestionNotTracked.decisions[0] = {
    ...pendingQuestionNotTracked.decisions[0],
    openItems: ["First missing detail?"],
    pendingQuestion: "Different missing detail?",
    status: "open",
  };

  for (const ledger of [resolvedWithOpenWork, resolvedWithPendingQuestion, pendingQuestionNotTracked]) {
    assert.equal(parseSurgeConversationState(state({ ledger })), null);
  }
});

test("ledger compaction keeps the aggregate unresolved-item count parseable", () => {
  const decisions = Array.from({ length: 8 }, (_, index) => ({
    id: `decision_${index + 1}_topic`,
    subjectIds: ["saved_home"],
    topic: `topic_${index + 1}`,
    goal: `Review item ${index + 1}`,
    facts: [],
    outcomeSummary: "Review is still in progress.",
    openItems: [`Question ${index + 1}a?`, `Question ${index + 1}b?`],
    pendingQuestion: `Question ${index + 1}b?`,
    status: "open",
    lastTouchedTurn: index + 1,
  }));
  const parsed = parseSurgeConversationState(state({
    ledger: {
      turn: 8,
      activeDecisionId: "decision_8_topic",
      subjects: [{
        id: "saved_home",
        kind: "saved_home",
        label: "Saved home",
        facts: [],
        lastTouchedTurn: 8,
      }],
      decisions,
    },
  }));
  assert.ok(parsed);

  const compacted = recordLedgerTurn(parsed, {
    message: "Different question: should I install a heat-pump hot-water system?",
    activeTopic: "heat_pump_hot_water",
    goal: "Review heat-pump hot water",
    followUpQuestion: "How many people use hot water in the home?",
    intent: "topic_change",
  });
  const openItemCount = compacted.ledger.decisions
    .reduce((count, decision) => count + decision.openItems.length, 0);

  assert.equal(openItemCount, SURGE_MAX_LEDGER_OPEN_ITEMS);
  assert.ok(parseSurgeConversationState(compacted));
});

test("exported ledger updates clamp oversized typed state to the public byte boundary", () => {
  const oversized = state({
    ledger: {
      turn: 1,
      activeDecisionId: "decision_1_solar",
      subjects: [{
        id: "saved_home",
        kind: "saved_home",
        label: "Saved home ".repeat(1_000),
        facts: Array.from({ length: 20 }, (_, index) => ({
          key: `detail_${index}`,
          value: "large subject detail ".repeat(1_000),
          source: "chat",
          updatedTurn: 1,
        })),
        lastTouchedTurn: 1,
      }],
      decisions: [{
        id: "decision_1_solar",
        subjectIds: ["saved_home"],
        topic: "solar",
        goal: "large goal ".repeat(1_000),
        facts: Array.from({ length: 20 }, (_, index) => ({
          key: `quote_detail_${index}`,
          value: "large decision detail ".repeat(1_000),
          source: "chat",
          updatedTurn: 1,
        })),
        outcomeSummary: "large delivered answer ".repeat(1_000),
        openItems: Array.from({ length: 4 }, (_, index) => `Question ${index}? ${"detail ".repeat(1_000)}`),
        pendingQuestion: `Question 3? ${"detail ".repeat(1_000)}`,
        status: "open",
        lastTouchedTurn: 1,
      }],
    },
  });

  const compacted = recordLedgerTurn(oversized, {
    message: "For my saved home, what should I check next?",
    activeTopic: "solar",
    goal: "Keep reviewing solar for my saved home",
  });

  assert.ok(
    new TextEncoder().encode(JSON.stringify(compacted.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES,
  );
  assert.ok(parseSurgeConversationState(compacted));
});

test("ordinal quote corrections update the named quote and preserve the other quote", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My first solar quote is $10,000 for 6.6 kW.",
    activeTopic: "solar",
    goal: "Review the first $10,000 solar quote for 6.6 kW",
  });
  const firstQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "My second solar quote is $12,000 for 8 kW.",
    activeTopic: "solar",
    goal: "Review the second $12,000 solar quote for 8 kW",
    intent: "topic_change",
  });
  const secondQuoteId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Back to the first quote: actually it is $9,500, not $10,000.",
    activeTopic: "solar",
    goal: "Review the corrected first $9,500 solar quote for 6.6 kW",
    intent: "correction",
  });
  current = recordLedgerTurn(current, {
    message: "Back to the second quote: actually it is $11,500, not $12,000.",
    activeTopic: "solar",
    goal: "Review the corrected second $11,500 solar quote for 8 kW",
    intent: "correction",
  });

  const firstQuote = current.ledger.decisions.find((decision) => decision.id === firstQuoteId);
  const secondQuote = current.ledger.decisions.find((decision) => decision.id === secondQuoteId);
  const firstText = JSON.stringify(firstQuote);
  const secondText = JSON.stringify(secondQuote);
  assert.match(firstText, /9,500/);
  assert.doesNotMatch(firstText, /10,000|11,500|12,000/);
  assert.match(secondText, /11,500/);
  assert.doesNotMatch(secondText, /9,500|10,000|12,000/);
});

test("a quote described as was actually keeps the corrected value in the right direction", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My solar quote is $10,000 for 6.6 kW.",
    activeTopic: "solar",
    goal: "Review the $10,000 solar quote for 6.6 kW",
  });
  current = recordLedgerTurn(current, {
    message: "The $10,000 quote was actually $9,500.",
    activeTopic: "solar",
    goal: "Review the corrected $9,500 solar quote for 6.6 kW",
    intent: "correction",
  });

  const correctedDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  const selectedText = JSON.stringify(correctedDecision);
  assert.match(selectedText, /9,500/);
  assert.doesNotMatch(selectedText, /10,000/);
});

test("first and second other-property corrections target the numbered property only", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Another property is in postcode 4000 and needs solar advice.",
    activeTopic: "solar",
    goal: "Review solar for the first other property",
  });
  current = recordLedgerTurn(current, {
    message: "A different property is in postcode 5000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for the second other property",
    intent: "topic_change",
  });
  current = recordLedgerTurn(current, {
    message: "Actually the first other property's postcode is 4001, not 4000.",
    activeTopic: "solar",
    goal: "Review solar for the first other property",
    intent: "correction",
  });
  current = recordLedgerTurn(current, {
    message: "Actually the second other property's postcode is 5001, not 5000.",
    activeTopic: "rcac",
    goal: "Review heating for the second other property",
    intent: "correction",
  });

  const firstProperty = current.ledger.subjects.find((subject) => subject.id === "other_property_1");
  const secondProperty = current.ledger.subjects.find((subject) => subject.id === "other_property_2");
  assert.equal(firstProperty?.facts.find((fact) => fact.key === "postcode")?.value, "4001");
  assert.equal(secondProperty?.facts.find((fact) => fact.key === "postcode")?.value, "5001");
  assert.doesNotMatch(JSON.stringify(firstProperty), /5000|5001/);
  assert.doesNotMatch(JSON.stringify(secondProperty), /4000|4001/);
});

test("another named investment property remains isolated from the first one", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My investment property is in postcode 3000 and has a solar quote.",
    activeTopic: "solar",
    goal: "Review solar for the first investment property",
  });
  current = recordLedgerTurn(current, {
    message: "Another investment property is in postcode 4000 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for the second investment property",
    intent: "topic_change",
  });

  const properties = current.ledger.subjects
    .filter((subject) => subject.id === "investment_property" || subject.id.startsWith("investment_property_"));
  assert.equal(properties.length, 2);
  assert.equal(new Set(properties.map((subject) => subject.id)).size, 2);
  assert.deepEqual(
    new Set(properties.map((subject) => subject.facts.find((fact) => fact.key === "postcode")?.value)),
    new Set(["3000", "4000"]),
  );
  assert.equal(
    current.ledger.decisions.filter((decision) => (
      decision.subjectIds.some((subjectId) => subjectId.startsWith("investment_property"))
    )).length,
    2,
  );
});

test("a generic explainer detours to general advice and back to her house restores Mum", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum's house is in postcode 3350 and has a solar quote.",
    activeTopic: "solar",
    goal: "Review Mum's solar quote",
  });
  current = recordLedgerTurn(current, {
    message: "What is an STC?",
    activeTopic: "rebates_certificates",
    goal: "Explain what an STC is",
    intent: "topic_change",
  });

  const generalDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(generalDecision?.subjectIds, ["general_advice"]);
  assert.equal(current.ledger.subjects.find((subject) => subject.id === "general_advice")?.facts.length, 0);

  const frame = selectSurgeConversationFrame(
    "Back to her house: would a battery help with Mum's solar?",
    current,
    false,
  );
  assert.equal(frame.subject?.id, "mums_home");
  assert.doesNotMatch(JSON.stringify(frame.subject), /general_advice/);
});

test("multi-subject postcode corrections remove stale values from every Mum and Dad decision memory", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum's postcode is 3000 and Dad's postcode is 4000. Compare solar for both homes.",
    activeTopic: "solar",
    goal: "Compare solar for Mum at 3000 and Dad at 4000",
  });
  current = recordLedgerTurn(current, {
    message: "Correction: Mum's postcode is 3001, not 3000, and Dad's postcode is 4001, not 4000.",
    activeTopic: "solar",
    goal: "Compare solar for Mum at 3001 and Dad at 4001",
    intent: "correction",
  });

  const mum = current.ledger.subjects.find((subject) => subject.id === "mums_home");
  const dad = current.ledger.subjects.find((subject) => subject.id === "dads_home");
  assert.equal(mum?.facts.find((fact) => fact.key === "postcode")?.value, "3001");
  assert.equal(dad?.facts.find((fact) => fact.key === "postcode")?.value, "4001");

  const relevantDecisions = current.ledger.decisions.filter((decision) => (
    decision.subjectIds.includes("mums_home") || decision.subjectIds.includes("dads_home")
  ));
  const rememberedText = JSON.stringify(relevantDecisions);
  assert.match(rememberedText, /3001/);
  assert.match(rememberedText, /4001/);
  assert.doesNotMatch(rememberedText, /3000|4000/);
});

test("overall quote synthesis never imports a later fee from another property", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My saved home's heat-pump hot-water quote is $5,900 installed.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the saved home's $5,900 heat-pump hot-water quote",
    answerSummary: "The saved-home quote needs its exact model and full installed scope checked.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const savedHomeQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Mum's unit has a separate hot-water quote for $6,200 installed.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review Mum's separate $6,200 hot-water quote",
    answerSummary: "Mum's quote is a separate property decision.",
    intent: "topic_change",
  });
  current = recordLedgerTurn(current, {
    message: "For Mum's unit, that quote also has a $330 administration fee.",
    activeTopic: "products_ratings",
    goal: "Check Mum's $330 administration fee",
    answerSummary: "The $330 fee needs to be itemised for Mum's quote.",
    intent: "topic_change",
  });

  const frame = selectSurgeConversationFrame(
    "Back to my saved home: overall, is its hot-water quote a good deal?",
    current,
    true,
  );
  const relatedText = JSON.stringify(frame.relatedDecisions);

  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.id, savedHomeQuoteId);
  assert.doesNotMatch(relatedText, /Mum|6,200|330/i);
});

test("ordinal quote references use creation chronology after compaction reorders the active quote", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My first solar quote uses Alpha panels.",
    activeTopic: "solar",
    goal: "Review the first solar quote with Alpha panels",
    answerSummary: "The first quote uses Alpha panels.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const firstQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Different quote for my saved home: the second solar quote uses Beta panels.",
    activeTopic: "solar",
    goal: "Review the second solar quote with Beta panels",
    answerSummary: "The second quote uses Beta panels.",
    intent: "topic_change",
  });
  const secondQuoteId = current.ledger.activeDecisionId;

  assert.deepEqual(
    current.ledger.decisions.slice(0, 2).map((decision) => decision.id),
    [secondQuoteId, firstQuoteId],
    "compaction must reproduce the non-chronological active-first storage order",
  );
  assert.equal(
    selectSurgeConversationFrame("Back to the first quote.", current, true).decision?.id,
    firstQuoteId,
  );
  assert.equal(
    selectSurgeConversationFrame("Back to the second quote.", current, true).decision?.id,
    secondQuoteId,
  );
  assert.equal(
    selectSurgeConversationFrame("Back to the previous quote.", current, true).decision?.id,
    firstQuoteId,
  );
});

test("single-subject corrections scrub older memories without changing another property", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home in postcode 3000, I own it and the battery quote is 10 kWh.",
    activeTopic: "battery_vpp",
    goal: "Review the saved home's 10 kWh battery quote at postcode 3000 as an owner",
    answerSummary: "Reviewed the owner's 10 kWh battery quote for postcode 3000.",
    planFacts: [{ key: "postcode", value: "3000" }],
    facts: [
      { key: "tenure", value: "owner" },
      { key: "supplied_quantities", value: "10 kWh" },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "Different question for my saved home: should an owner at postcode 3000 add solar?",
    activeTopic: "solar",
    goal: "Review solar for the owner at postcode 3000",
    answerSummary: "Reviewed solar for the owner at postcode 3000.",
    intent: "topic_change",
  });
  current = recordLedgerTurn(current, {
    message: "Mum's property is in postcode 3350, she owns it, and her battery quote is also 10 kWh.",
    activeTopic: "battery_vpp",
    goal: "Review Mum's 10 kWh battery quote as an owner at postcode 3350",
    answerSummary: "Reviewed Mum's 10 kWh owner quote at postcode 3350.",
    intent: "topic_change",
  });
  const mumsDecisionId = current.ledger.activeDecisionId;

  current = recordLedgerTurn(current, {
    message: "Back to my home: actually my postcode is 3001, not 3000.",
    activeTopic: "general",
    goal: "Use postcode 3001 for my saved home",
    answerSummary: "Updated the saved-home postcode to 3001.",
    intent: "correction",
  });
  current = recordLedgerTurn(current, {
    message: "Back to my home: actually I rent rather than own.",
    activeTopic: "general",
    goal: "Use renter tenure for my saved home",
    answerSummary: "Updated the saved home to renter tenure.",
    intent: "correction",
    facts: [{ key: "tenure", value: "renter" }],
  });
  current = recordLedgerTurn(current, {
    message: "Back to my home: the battery quote is actually 13 kWh, not 10 kWh.",
    activeTopic: "battery_vpp",
    goal: "Review the corrected 13 kWh battery quote for my saved home",
    answerSummary: "Updated the saved-home battery quote to 13 kWh.",
    intent: "correction",
    facts: [{ key: "supplied_quantities", value: "13 kWh" }],
  });

  const frame = selectSurgeConversationFrame(
    "Back to my home: based on everything we discussed, what should I prioritise?",
    current,
    true,
  );
  const savedHomeMemory = JSON.stringify({
    subject: frame.subject,
    decisions: frame.relatedDecisions,
  });
  const mumsMemory = JSON.stringify(
    current.ledger.decisions.find((decision) => decision.id === mumsDecisionId),
  );

  assert.match(savedHomeMemory, /3001/);
  assert.match(savedHomeMemory, /renter/i);
  assert.match(savedHomeMemory, /13 kWh/i);
  assert.doesNotMatch(savedHomeMemory, /3000|10 kWh|\bowner\b/i);
  assert.match(mumsMemory, /3350|10 kWh|owner/i);
  assert.doesNotMatch(mumsMemory, /3001|13 kWh|renter/i);
});

test("max-shaped typed ledgers prune resolved history to the serialized byte boundary", () => {
  const subjects = Array.from({ length: 150 }, (_, index) => ({
    id: `property_${String(index + 1).padStart(3, "0")}_${"x".repeat(48)}`,
    kind: "property",
    label: `Property ${index + 1} ${"long retained label ".repeat(8)}`.slice(0, 120),
    facts: [],
    lastTouchedTurn: Math.floor(index / 3) + 1,
  }));
  const decisions = Array.from({ length: 50 }, (_, index) => {
    const turn = index + 1;
    const open = index === 0;
    return {
      id: `decision_${turn}_solar`,
      subjectIds: subjects.slice(index * 3, index * 3 + 3).map((subject) => subject.id),
      topic: "solar",
      goal: `Review decision ${turn}: ${"large retained goal ".repeat(20)}`.slice(0, 300),
      facts: [],
      outcomeSummary: `Decision ${turn}: ${"large retained answer ".repeat(35)}`.slice(0, 640),
      openItems: open ? ["Confirm the older open decision detail."] : [],
      pendingQuestion: open ? "Confirm the older open decision detail." : "",
      status: open ? "open" : "resolved",
      lastTouchedTurn: turn,
    };
  });
  const oversized = state({
    ledger: {
      turn: 50,
      activeDecisionId: "decision_50_solar",
      subjects,
      decisions,
    },
  });

  const compacted = recordLedgerTurn(oversized, {
    message: "Different question for my saved home: should I add solar?",
    activeTopic: "solar",
    goal: "Review solar for my saved home",
    answerSummary: "Solar depends on the saved home's roof and daytime use.",
    intent: "topic_change",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const encodedBytes = new TextEncoder().encode(JSON.stringify(compacted.ledger)).byteLength;

  assert.ok(encodedBytes <= SURGE_MAX_LEDGER_BYTES, `${encodedBytes} exceeds the ledger byte cap`);
  assert.equal(compacted.ledger.decisions.some((decision) => (
    decision.id === compacted.ledger.activeDecisionId
  )), true);
  assert.equal(compacted.ledger.decisions.some((decision) => decision.id === "decision_1_solar"), true);
  assert.ok(parseSurgeConversationState(compacted));
});

test("ledger compaction pins exact saved-home updates through fact and decision limits", () => {
  const savedPlanUpdate = {
    key: "saved_plan_update_solar_changed",
    value: "We installed a 6.6 kW solar system last month.",
    source: "chat",
    updatedTurn: 1,
  };
  const subjects = [
    {
      id: "saved_home",
      kind: "saved_home",
      label: "Saved home",
      facts: [
        savedPlanUpdate,
        ...Array.from({ length: 117 }, (_, index) => ({
          key: `fact_${String(index + 1).padStart(3, "0")}`,
          value: `value_${String(index + 1).padStart(3, "0")}`,
          source: "chat",
          updatedTurn: index + 2,
        })),
      ],
      lastTouchedTurn: 1,
    },
    ...Array.from({ length: 49 }, (_, index) => ({
      id: `property_${index + 2}`,
      kind: "property",
      label: `Property ${index + 2}`,
      facts: [],
      lastTouchedTurn: index + 2,
    })),
  ];
  const decisions = Array.from({ length: 50 }, (_, index) => ({
    id: `decision_${index + 1}_solar`,
    subjectIds: [subjects[index].id],
    topic: "solar",
    goal: `Review solar decision ${index + 1}`,
    facts: [],
    outcomeSummary: `Reviewed solar decision ${index + 1}.`,
    openItems: [],
    pendingQuestion: "",
    status: "resolved",
    lastTouchedTurn: index + 1,
  }));
  const atLimit = state({
    planContextCorrections: ["solar_changed"],
    ledger: {
      turn: 50,
      activeDecisionId: "decision_50_solar",
      subjects,
      decisions,
    },
  });

  const compacted = recordLedgerTurn(atLimit, {
    message: "Mum's home needs separate battery advice.",
    activeTopic: "battery_vpp",
    goal: "Review a battery for Mum's home",
    answerSummary: "Started the separate battery review.",
    intent: "topic_change",
  });
  const savedHome = compacted.ledger.subjects.find((subject) => subject.id === "saved_home");
  const aggregateFacts = compacted.ledger.subjects.reduce(
    (count, subject) => count + subject.facts.length,
    compacted.ledger.decisions.reduce((count, decision) => count + decision.facts.length, 0),
  );

  assert.equal(compacted.ledger.decisions.some((decision) => decision.id === "decision_1_solar"), false);
  assert.deepEqual(savedHome?.facts.find((fact) => fact.key === savedPlanUpdate.key), savedPlanUpdate);
  assert.deepEqual(compacted.planContextCorrections, ["solar_changed"]);
  assert.ok(aggregateFacts <= 120, `${aggregateFacts} exceeds the fact cap`);
  assert.ok(new TextEncoder().encode(JSON.stringify(compacted.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES);
  assert.ok(parseSurgeConversationState(compacted));
});

test("I rent rather than own is a correction that reuses the current decision", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "I own the home and I am reviewing a battery quote.",
    activeTopic: "battery_vpp",
    goal: "Review the battery quote as an owner",
    facts: [{ key: "tenure", value: "owner" }],
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const decisionId = current.ledger.activeDecisionId;
  const message = "I rent rather than own.";
  const intent = classifySurgeConversationTurn(message, current, []);

  assert.equal(intent, "correction");
  assert.equal(surgeConversationCorrectionReframesDecision(message), false);
  current = recordLedgerTurn(current, {
    message,
    activeTopic: "battery_vpp",
    goal: "Review the battery quote as a renter",
    answerSummary: "Updated the quote context to renter tenure.",
    intent,
    facts: [{ key: "tenure", value: "renter" }],
  });

  assert.equal(current.ledger.activeDecisionId, decisionId);
  assert.equal(current.ledger.decisions.length, 1);
  assert.match(JSON.stringify(current), /renter/i);
  assert.doesNotMatch(JSON.stringify(current), /\bowner\b/i);
});

test("a contextual admin fee stays linked to the hot-water quote across a general certificate detour", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Different quote: heat-pump hot water is $5,900 after rebates, $58 a month for seven years, and switchboard work is extra. Is the finance the same total, and is that a complete installed price?",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the saved-home heat-pump hot-water quote and finance total",
    answerSummary: "The finance totals $4,872, which is $1,028 short of $5,900, and switchboard work is extra.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const quoteDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Just answer yes or no: is the finance total the same?",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the saved-home heat-pump hot-water quote and finance total",
    answerSummary: "No.",
    intent: "contextual_follow_up",
  });
  current = recordLedgerTurn(current, {
    message: "Sorry, I read it wrong. It's $68 a month, not $58.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the corrected saved-home heat-pump hot-water quote and finance total",
    answerSummary: "The corrected finance total is $5,712, which is $188 short of $5,900.",
    intent: "correction",
  });
  current = recordLedgerTurn(current, {
    message: "So it's only $188 short now, but the switchboard could still push the final price up?",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the corrected saved-home heat-pump hot-water quote and final installed price",
    answerSummary: "Yes. The $188 gap remains and switchboard work can increase the final price.",
    intent: "contextual_follow_up",
  });
  current = recordLedgerTurn(current, {
    message: "What are STCs and VEECs in normal words?",
    activeTopic: "rebates_certificates",
    goal: "Explain STCs and VEECs in normal words",
    answerSummary: "STCs and VEECs are certificates that can reduce an eligible upgrade price.",
    intent: "topic_change",
  });
  const generalDecisionId = current.ledger.activeDecisionId;
  assert.deepEqual(
    current.ledger.decisions.find((decision) => decision.id === generalDecisionId)?.subjectIds,
    ["general_advice"],
  );
  current = recordLedgerTurn(current, {
    message: "What are they worth today?",
    activeTopic: "rebates_certificates",
    goal: "Explain the current value of STCs and VEECs",
    answerSummary: "Their gross market value can move and is not the same as the customer's net discount.",
    intent: "contextual_follow_up",
  });
  current = recordLedgerTurn(current, {
    message: "Forget the exact price. Do the admin fees in that quote sound normal?",
    activeTopic: "rebates_certificates",
    goal: "Assess the administration fees in the referenced quote",
    answerSummary: "A disclosed administration fee can be normal, but its amount and coverage matter.",
    intent: "topic_change",
  });
  current = recordLedgerTurn(current, {
    message: "The fee line is $330 total. Does that sound reasonable?",
    activeTopic: "rebates_certificates",
    goal: "Assess the $330 administration fee in the referenced quote",
    answerSummary: "The $330 fee may be reasonable if it is disclosed, included and not duplicated.",
    intent: "contextual_follow_up",
  });

  const feeDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.equal(feeDecision?.id, quoteDecisionId);
  assert.deepEqual(feeDecision?.subjectIds, ["saved_home"]);
  assert.match(JSON.stringify(feeDecision), /\$330/);
  assert.deepEqual(
    current.ledger.decisions.find((decision) => decision.id === generalDecisionId)?.subjectIds,
    ["general_advice"],
  );

  const frame = selectSurgeConversationFrame(
    "Right, back to the hot-water quote. Overall, is it a good deal?",
    current,
    true,
  );
  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.id, quoteDecisionId);
  assert.match(JSON.stringify(frame.relatedDecisions), /\$330/);
});

test("service-enquiry follow-ups keep the normalized Mum 3073 enquiry goal", () => {
  const enquiryGoal = "Arrange honeycomb blinds and heat-pump hot water enquiries for Mum's place at 3073";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Know anyone around Preston who can quote heat-pump hot water and honeycomb blinds? Can you send it to the right trades?",
    activeTopic: "service_enquiry",
    goal: "Arrange honeycomb blinds and heat-pump hot water enquiries for the property at Preston",
    answerSummary: "The enquiry can be sent to relevant local trades.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  current = recordLedgerTurn(current, {
    message: "I don't want a preferred supplier. I want all relevant local trades.",
    activeTopic: "service_enquiry",
    goal: "Arrange honeycomb blinds and heat-pump hot water enquiries for the property at Preston",
    answerSummary: "The enquiry will go to relevant local trades without preferring one supplier.",
    intent: "contextual_follow_up",
  });
  current = recordLedgerTurn(current, {
    message: "Actually this job is at Mum's place in 3073, not my 3072 apartment.",
    activeTopic: "service_enquiry",
    goal: enquiryGoal,
    answerSummary: "Updated the enquiry to Mum's place at 3073.",
    intent: "correction",
  });
  current = recordLedgerTurn(current, {
    message: "Can I send the enquiry now?",
    activeTopic: "service_enquiry",
    goal: enquiryGoal,
    answerSummary: "Yes, the enquiry can be sent when the required contact details are confirmed.",
    intent: "contextual_follow_up",
  });
  current = recordLedgerTurn(current, {
    message: "Before I do, why don't you just tell me who the best installer is?",
    activeTopic: "service_enquiry",
    goal: enquiryGoal,
    answerSummary: "Wattzun AI does not prefer one installer and can send the enquiry to relevant local trades.",
    intent: "contextual_follow_up",
  });

  const activeDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.equal(current.goal, enquiryGoal);
  assert.equal(activeDecision?.goal, enquiryGoal);
  assert.match(activeDecision?.goal || "", /honeycomb blinds/i);
  assert.match(activeDecision?.goal || "", /heat-pump hot water/i);
  assert.match(activeDecision?.goal || "", /Mum's place/i);
  assert.match(activeDecision?.goal || "", /3073/);
  assert.doesNotMatch(activeDecision?.goal || "", /best installer/i);
});

test("whole-quote synthesis includes an earlier same-home fee without importing another property's fee", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home's heat-pump hot-water quote, the administration fee is $330.",
    activeTopic: "products_ratings",
    goal: "Check the $330 administration fee in the saved-home heat-pump hot-water quote",
    answerSummary: "The $330 fee needs to be disclosed and included in the final price.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const feeDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Heat-pump hot water is $5,900 installed for my saved home.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the full $5,900 installed heat-pump hot-water quote for my saved home",
    answerSummary: "The $5,900 installed total needs its exact model and scope checked.",
    intent: "topic_change",
  });
  const quoteDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Mum's unit has a separate $500 administration fee in her hot-water quote.",
    activeTopic: "products_ratings",
    goal: "Check Mum's separate $500 hot-water administration fee",
    answerSummary: "Mum's $500 fee belongs to her separate quote.",
    intent: "topic_change",
  });

  const frame = selectSurgeConversationFrame(
    "Back to my saved home's hot-water quote. Overall, is it a good deal?",
    current,
    true,
  );
  const relatedIds = new Set(frame.relatedDecisions.map((decision) => decision.id));
  const relatedText = JSON.stringify(frame.relatedDecisions);

  assert.equal(frame.subject?.id, "saved_home");
  assert.equal(frame.decision?.id, quoteDecisionId);
  assert.equal(relatedIds.has(quoteDecisionId), true);
  assert.equal(relatedIds.has(feeDecisionId), true);
  assert.match(relatedText, /\$5,900/);
  assert.match(relatedText, /\$330/);
  assert.doesNotMatch(relatedText, /Mum|\$500/i);
});

test("a compound quote correction retains the total and replaces only the administration fee", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The full heat-pump hot-water quote is $5,900 and includes a $500 administration fee.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 quote with a $500 administration fee",
    answerSummary: "Reviewed the $5,900 quote and its $500 administration fee.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const decisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Actually, the full quote is $5,900 and the administration fee is $330, not $500.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 quote with the corrected $330 administration fee",
    answerSummary: "Updated the administration fee to $330 while retaining the $5,900 total.",
    intent: "correction",
  });

  const corrected = current.ledger.decisions.find((decision) => decision.id === decisionId);
  const correctedText = JSON.stringify(corrected);
  assert.equal(current.ledger.activeDecisionId, decisionId);
  assert.match(correctedText, /\$5,900/);
  assert.match(correctedText, /\$330/);
  assert.doesNotMatch(correctedText, /\$500/);
});

test("a compound capacity correction retains the quote price and replaces only the capacity", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The heat-pump hot-water quote is $5,900 for a 315 L unit.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 quote for a 315 L unit",
    answerSummary: "Reviewed the $5,900 quote for a 315 L unit.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  current = recordLedgerTurn(current, {
    message: "Actually, the quote is still $5,900 and the unit is 270 L, not 315 L.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 quote for the corrected 270 L unit",
    answerSummary: "Updated the quoted capacity to 270 L while retaining the $5,900 price.",
    intent: "correction",
  });

  const correctedText = JSON.stringify(
    current.ledger.decisions.find((decision) => decision.id === current.ledger.activeDecisionId),
  );
  assert.match(correctedText, /\$5,900/);
  assert.match(correctedText, /270 L/i);
  assert.doesNotMatch(correctedText, /315 L/i);
});

test("landlord tenant and client beneficiaries never inherit the saved-home subject", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Should I help my mum get a battery?",
    activeTopic: "battery_vpp",
    goal: "Assess a battery for Mum's home",
  });
  const mumDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(mumDecision?.subjectIds, ["mums_home"]);

  current = recordLedgerTurn(current, {
    message: "Should we get a battery for our landlord?",
    activeTopic: "battery_vpp",
    goal: "Assess a battery for our landlord's property",
    planFacts: [{ key: "postcode", value: "3000" }],
    intent: "topic_change",
  });
  const landlordDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(landlordDecision?.subjectIds, ["landlords_home"]);

  current = recordLedgerTurn(current, {
    message: "Different question: should we replace the hot-water system for our tenant?",
    activeTopic: "heat_pump_hot_water",
    goal: "Assess hot-water replacement for our tenant's home",
    intent: "topic_change",
  });
  const tenantDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(tenantDecision?.subjectIds, ["tenants_home"]);

  current = recordLedgerTurn(current, {
    message: "Different question: should we install a split system for our client?",
    activeTopic: "rcac",
    goal: "Assess a split-system installation for the client job",
    intent: "topic_change",
  });
  const clientDecision = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(clientDecision?.subjectIds, ["client_job_1"]);
  assert.equal(
    current.ledger.decisions.some((decision) => decision.subjectIds.includes("saved_home")),
    false,
  );

  current = recordLedgerTurn(current, {
    message: "Compare my saved home with my landlord's property for solar.",
    activeTopic: "solar",
    goal: "Compare solar for my saved home and my landlord's property",
    intent: "topic_change",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const comparison = current.ledger.decisions.find(
    (decision) => decision.id === current.ledger.activeDecisionId,
  );
  assert.deepEqual(new Set(comparison?.subjectIds), new Set(["saved_home", "landlords_home"]));
});

test("an assessor's client rental remains one client job through tenant and landlord follow-ups", () => {
  const turns = [
    {
      message: "I am an assessor asking about a client's rental in Ballarat, not my own home. Keep those roles clear.",
      answerSummary: "Kept the assessor, client and Ballarat rental roles separate from the assessor's own home.",
    },
    {
      message: "The tenant says the bedroom window is wet every morning. What should I ask them to observe?",
      answerSummary: "Listed the bedroom-window, overnight heating and ventilation observations for the tenant.",
    },
    {
      message: "The landlord wants a sensible first scope before approving major work. What should I report?",
      answerSummary: "Set out a staged evidence and inspection scope for the landlord.",
    },
    {
      message: "Who would normally need to approve work affecting common property?",
      answerSummary: "Explained the owners-corporation and landlord approval boundary for the client rental.",
    },
  ];
  const forbiddenSubjectIds = new Set(["saved_home", "tenants_home", "landlords_home"]);
  const recentTurns = [];
  let current = emptySurgeConversationState();
  let clientSubjectId = "";

  for (const [index, turn] of turns.entries()) {
    const detectedTopic = surgeConversationTopicFor(turn.message);
    const activeTopic = detectedTopic
      || (current.activeTopic === "general" ? "renters_strata" : current.activeTopic);
    const intent = classifySurgeConversationTurn(turn.message, current, recentTurns);
    current = recordLedgerTurn(current, {
      message: turn.message,
      activeTopic,
      goal: turn.message,
      answerSummary: turn.answerSummary,
      intent,
      planFacts: index === 0
        ? [{ key: "postcode", value: "3072" }, { key: "property_type", value: "apartment" }]
        : [],
    });

    const clientSubjects = current.ledger.subjects.filter((subject) => (
      subject.id.startsWith("client_job_")
    ));
    assert.equal(clientSubjects.length, 1, `turn ${index + 1} should retain one client job`);
    clientSubjectId ||= clientSubjects[0].id;
    assert.equal(clientSubjects[0].id, clientSubjectId, `turn ${index + 1} changed the client job`);
    assert.equal(
      current.ledger.subjects.some((subject) => forbiddenSubjectIds.has(subject.id)),
      false,
      `turn ${index + 1} fragmented the client rental into a personal-home subject`,
    );
    assert.deepEqual(
      current.ledger.decisions.find(
        (decision) => decision.id === current.ledger.activeDecisionId,
      )?.subjectIds,
      [clientSubjectId],
      `turn ${index + 1} moved the active decision away from the client job`,
    );
    assert.ok(
      current.ledger.decisions.every((decision) => (
        decision.subjectIds.length === 1 && decision.subjectIds[0] === clientSubjectId
      )),
      `turn ${index + 1} created a decision outside the client job`,
    );

    recentTurns.push(
      { role: "user", content: turn.message },
      { role: "assistant", content: turn.answerSummary },
    );
  }

  const retainedContext = JSON.stringify(
    current.ledger.decisions.filter((decision) => decision.subjectIds.includes(clientSubjectId)),
  );
  assert.match(retainedContext, /assessor/i);
  assert.match(retainedContext, /client/i);
  assert.match(retainedContext, /rental/i);
  assert.match(retainedContext, /Ballarat/i);
  assert.match(retainedContext, /tenant/i);
  assert.match(retainedContext, /landlord/i);

  const finalFrame = selectSurgeConversationFrame(turns.at(-1).message, current, true);
  assert.equal(finalFrame.subject?.id, clientSubjectId);
});

test("an arbitrary decision fact survives twelve later turns in the selected frame", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The roof faces west and gets heavy shade after 2 pm.",
    activeTopic: "solar",
    goal: "Assess solar suitability for my saved home",
    answerSummary: "Noted the roof conditions for the solar assessment.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const solarDecisionId = current.ledger.activeDecisionId;
  const laterTopics = [
    "rcac",
    "insulation",
    "glazing_shading",
    "battery_vpp",
    "heat_pump_hot_water",
    "bills_tariffs",
    "draughts_ventilation",
    "comfort_fabric",
    "induction",
    "ev_charging",
    "rebates_certificates",
    "products_ratings",
  ];
  for (const [index, activeTopic] of laterTopics.entries()) {
    current = recordLedgerTurn(current, {
      message: `Different question ${index + 1}: review ${activeTopic.replaceAll("_", " ")} for my saved home.`,
      activeTopic,
      goal: `Review later decision ${index + 1}`,
      answerSummary: `Answered later decision ${index + 1}.`,
      intent: "topic_change",
    });
  }

  const frame = selectSurgeConversationFrame(
    "Back to my saved home's solar decision: does the shade matter?",
    current,
    true,
  );
  const selectedText = JSON.stringify(frame.relatedDecisions);
  assert.equal(frame.decision?.id, solarDecisionId);
  assert.match(selectedText, /west/i);
  assert.match(selectedText, /heavy shade/i);
  assert.match(selectedText, /2 pm/i);
  assert.ok(new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength <= SURGE_MAX_LEDGER_BYTES);
  assert.ok(parseSurgeConversationState(current));
});

test("whole-conversation summaries include every subject while Mum-only summaries stay scoped", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home, review solar first.",
    activeTopic: "solar",
    goal: "Review solar for my saved home",
    answerSummary: "Reviewed saved-home solar.",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const savedDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Mum's house is in 3350 and needs heating advice.",
    activeTopic: "rcac",
    goal: "Review heating for Mum's house at 3350",
    answerSummary: "Reviewed Mum's heating options.",
    intent: "topic_change",
  });
  const mumDecisionId = current.ledger.activeDecisionId;

  const whole = selectSurgeConversationFrame("Summarise our whole conversation.", current, true);
  assert.deepEqual(
    new Set(whole.subjects.map((subject) => subject.id)),
    new Set(["saved_home", "mums_home"]),
  );
  assert.deepEqual(
    new Set(whole.relatedDecisions.map((decision) => decision.id)),
    new Set([savedDecisionId, mumDecisionId]),
  );

  const mumOnly = selectSurgeConversationFrame(
    "Summarise everything about Mum's house.",
    current,
    true,
  );
  assert.deepEqual(mumOnly.subjects.map((subject) => subject.id), ["mums_home"]);
  assert.deepEqual(mumOnly.relatedDecisions.map((decision) => decision.id), [mumDecisionId]);
});

test("same-home two-quote comparisons select both quotes and exclude another property", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum's solar quote is $7,000 with Gamma panels.",
    activeTopic: "solar",
    goal: "Review Mum's $7,000 Gamma solar quote",
    answerSummary: "Reviewed Mum's separate Gamma quote.",
  });
  const mumsQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "For my saved home, the first solar quote is $5,900 with Alpha panels.",
    activeTopic: "solar",
    goal: "Review the first saved-home $5,900 Alpha solar quote",
    answerSummary: "Reviewed the first saved-home Alpha quote.",
    intent: "topic_change",
    planFacts: [{ key: "postcode", value: "3000" }],
  });
  const firstQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Different quote for my saved home: the second solar quote is $6,200 with Beta panels.",
    activeTopic: "solar",
    goal: "Review the second saved-home $6,200 Beta solar quote",
    answerSummary: "Reviewed the second saved-home Beta quote.",
    intent: "topic_change",
  });
  const secondQuoteId = current.ledger.activeDecisionId;

  for (const message of [
    "Compare both quotes.",
    "Which of the two quotes is better?",
    "Compare the first and second quotes.",
  ]) {
    const frame = selectSurgeConversationFrame(message, current, true);
    assert.ok(frame.decision);
    assert.deepEqual(
      new Set(frame.relatedDecisions.map((decision) => decision.id)),
      new Set([firstQuoteId, secondQuoteId]),
      message,
    );
    assert.equal(frame.relatedDecisions.some((decision) => decision.id === mumsQuoteId), false);
  }
});

test("bounded decision memory keeps middle-turn details while there is byte headroom", () => {
  const messages = [
    "For this solar quote, my west front roof faces about 285 degrees.",
    "For the same solar quote, 18 panels would sit above the blue bedroom.",
    "For the same solar quote, the roof pitch is about 22 degrees.",
    "For the same solar quote, the existing inverter is in the garage.",
    "For the same solar quote, the switchboard is on the east wall.",
    "For the same solar quote, black panels are proposed but appearance is not my priority.",
  ];
  let current = emptySurgeConversationState();
  for (const [index, message] of messages.entries()) {
    current = recordLedgerTurn(current, {
      message,
      activeTopic: "solar",
      goal: "Review solar for the west front roof",
      answerSummary: "Kept the supplied solar decision details.",
      intent: index === 0 ? "new_question" : "contextual_follow_up",
    });
  }

  const decision = current.ledger.decisions.find(
    (candidate) => candidate.id === current.ledger.activeDecisionId,
  );
  const context = decision?.facts.find((fact) => fact.key === "user_context")?.value || "";
  assert.match(context, /west front roof/i);
  assert.match(context, /roof pitch is about 22 degrees/i);
  assert.match(context, /black panels/i);
  assert.ok(context.length > 220);
  assert.ok(new TextEncoder().encode(JSON.stringify(current.ledger)).byteLength < SURGE_MAX_LEDGER_BYTES);
});

test("natural Mum ownership creates a separate home without treating Mum's opinion as ownership", () => {
  const mumState = recordLedgerTurn(emptySurgeConversationState(), {
    message: "Mum has an $8,000 battery quote for a 10 kWh system.",
    activeTopic: "battery_vpp",
    goal: "Review Mum's $8,000 battery quote",
  });
  const mumDecision = mumState.ledger.decisions.find(
    (decision) => decision.id === mumState.ledger.activeDecisionId,
  );
  assert.deepEqual(mumDecision?.subjectIds, ["mums_home"]);

  let savedHomeState = recordLedgerTurn(emptySurgeConversationState(), {
    message: "For my saved home, my battery quote is $9,000.",
    activeTopic: "battery_vpp",
    goal: "Review my saved-home battery quote",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  savedHomeState = recordLedgerTurn(savedHomeState, {
    message: "Mum said my quote looks expensive. Do you agree?",
    activeTopic: "battery_vpp",
    goal: "Review my saved-home battery quote",
    intent: "contextual_follow_up",
  });
  const opinionDecision = savedHomeState.ledger.decisions.find(
    (decision) => decision.id === savedHomeState.ledger.activeDecisionId,
  );
  assert.deepEqual(opinionDecision?.subjectIds, ["saved_home"]);
});

test("equal-price quotes stay separate and a correction changes only the selected quote", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "My first solar quote is $10,000 for 6.6 kW with Alpha panels.",
    activeTopic: "solar",
    goal: "Review the first $10,000 Alpha solar quote",
  });
  const firstQuoteId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "My second solar quote is $10,000 for 6.6 kW with Beta panels.",
    activeTopic: "solar",
    goal: "Review the second $10,000 Beta solar quote",
    intent: "topic_change",
  });
  const secondQuoteId = current.ledger.activeDecisionId;
  assert.notEqual(secondQuoteId, firstQuoteId);

  current = recordLedgerTurn(current, {
    message: "Back to the second quote: actually it is $9,500, not $10,000.",
    activeTopic: "solar",
    goal: "Review the corrected second $9,500 Beta solar quote",
    intent: "correction",
  });
  const firstText = JSON.stringify(current.ledger.decisions.find((decision) => decision.id === firstQuoteId));
  const secondText = JSON.stringify(current.ledger.decisions.find((decision) => decision.id === secondQuoteId));
  assert.match(firstText, /\$10,000/);
  assert.doesNotMatch(firstText, /\$9,500/);
  assert.match(secondText, /\$9,500/);
  assert.doesNotMatch(secondText, /\$10,000/);
});

test("natural recall returns to the uniquely described decision after a topic detour", () => {
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: "The west front roof has heavy solar shade after 2 pm.",
    activeTopic: "solar",
    goal: "Assess solar shade on the west front roof",
    answerSummary: "The front-roof shade reduces late-day solar production.",
    planFacts: [{ key: "postcode", value: "3072" }],
  });
  const solarDecisionId = current.ledger.activeDecisionId;
  current = recordLedgerTurn(current, {
    message: "Different question: my heat-pump hot-water quote is $5,900.",
    activeTopic: "heat_pump_hot_water",
    goal: "Review the $5,900 hot-water quote",
    intent: "topic_change",
  });

  const frame = selectSurgeConversationFrame(
    "What did I tell you about the west front roof and its solar shade?",
    current,
    true,
  );
  assert.equal(frame.decision?.id, solarDecisionId);
  assert.match(JSON.stringify(frame.relatedDecisions), /heavy solar shade after 2 pm/i);
});

test("natural whole-chat summary wording selects every retained subject and decision", () => {
  const current = savedHomeAndMumLedger();
  for (const message of [
    "Give me a summary of everything so far.",
    "What have we covered so far?",
  ]) {
    const frame = selectSurgeConversationFrame(message, current, true);
    assert.deepEqual(
      new Set(frame.subjects.map((subject) => subject.id)),
      new Set(["saved_home", "mums_home"]),
      message,
    );
    assert.equal(frame.relatedDecisions.length, 2, message);
  }
});

test("labelled quote follow-ups retain prices and warranties through an equal-price correction", () => {
  const turns = [];
  let current = emptySurgeConversationState();
  const firstMessage = "Quote A is $6,900 with a five-year warranty. Quote B is $7,400 with a seven-year warranty. How should I compare them?";
  current = recordLedgerTurn(current, {
    message: firstMessage,
    activeTopic: "products_ratings",
    goal: firstMessage,
    answerSummary: "Compare both quotes on price, exact scope and warranty coverage.",
    followUpQuestion: "What product, exact models and installation scope do the quotes cover?",
    facts: [
      { key: "quote_a", value: "$6,900 with a five-year warranty" },
      { key: "quote_b", value: "$7,400 with a seven-year warranty" },
    ],
  });
  const comparisonDecisionId = current.ledger.activeDecisionId;
  turns.push({ role: "user", content: firstMessage });
  turns.push({ role: "assistant", content: "Compare both quotes on price, scope and warranty coverage." });

  const premiumMessage = "Is B worth the extra money just for the longer warranty?";
  const premiumIntent = classifySurgeConversationTurn(premiumMessage, current, turns);
  assert.equal(premiumIntent, "contextual_follow_up");
  current = recordLedgerTurn(current, {
    message: premiumMessage,
    activeTopic: "general",
    goal: premiumMessage,
    answerSummary: "The $500 premium is not justified by warranty length alone.",
    followUpQuestion: "Are the exact products and installation scope otherwise identical?",
    intent: premiumIntent,
  });
  assert.equal(current.ledger.activeDecisionId, comparisonDecisionId);
  assert.equal(current.ledger.decisions.some((decision) => decision.topic === "general"), false);
  const premiumFrame = selectSurgeConversationFrame(premiumMessage, current, true);
  const premiumText = JSON.stringify(premiumFrame.relatedDecisions);
  assert.match(premiumText, /\$6,900/);
  assert.match(premiumText, /\$7,400/);
  assert.match(premiumText, /five-year warranty/i);
  assert.match(premiumText, /seven-year warranty/i);

  turns.push({ role: "user", content: premiumMessage });
  turns.push({ role: "assistant", content: "The $500 premium is not justified by warranty length alone." });
  const correctionMessage = "Correction: they are both $6,900. I copied B's price incorrectly.";
  const stateBeforeCorrection = current;
  const correctionIntent = classifySurgeConversationTurn(correctionMessage, current, turns);
  assert.equal(correctionIntent, "correction");
  current = recordLedgerTurn(current, {
    message: correctionMessage,
    activeTopic: "products_ratings",
    goal: "Compare the corrected equal-price quotes",
    answerSummary: "Both quotes are now $6,900, so compare scope and warranty coverage.",
    followUpQuestion: "Are the exact products and installation scope otherwise identical?",
    intent: correctionIntent,
    facts: [
      { key: "quote_a", value: "$6,900 with a five-year warranty" },
      { key: "quote_b", value: "$7,400 with a seven-year warranty" },
      { key: "proposed_or_quoted_details", value: firstMessage },
    ],
  });
  assert.equal(current.ledger.activeDecisionId, comparisonDecisionId);
  const correctedStateText = JSON.stringify(current);
  assert.doesNotMatch(correctedStateText, /\$7,400/);
  assert.match(correctedStateText, /\$6,900/);
  assert.match(correctedStateText, /five-year warranty/i);
  assert.match(correctedStateText, /seven-year warranty/i);
  const correctedFrame = selectSurgeConversationFrame(
    "At the same price, which one would you choose now?",
    current,
    true,
  );
  const correctedText = JSON.stringify(correctedFrame.relatedDecisions);
  assert.doesNotMatch(correctedText, /\$7,400/);
  assert.match(correctedText, /\$6,900/);
  assert.match(correctedText, /five-year warranty/i);
  assert.match(correctedText, /seven-year warranty/i);

  const correctedDespiteGenericIntent = recordLedgerTurn(stateBeforeCorrection, {
    message: correctionMessage,
    activeTopic: "products_ratings",
    goal: "Compare the corrected equal-price quotes",
    answerSummary: "Both quotes are now $6,900, so compare scope and warranty coverage.",
    followUpQuestion: "Are the exact products and installation scope otherwise identical?",
    intent: "new_question",
    facts: [
      { key: "quote_a", value: "$6,900 with a five-year warranty" },
      { key: "quote_b", value: "$7,400 with a seven-year warranty" },
      { key: "proposed_or_quoted_details", value: firstMessage },
    ],
  });
  assert.doesNotMatch(JSON.stringify(correctedDespiteGenericIntent), /\$7,400/);
});

test("an equal-price correction removes stale composite details when model quote facts are already corrected", () => {
  const firstMessage = "Quote A is $6,900 with a five-year warranty. Quote B is $7,400 with a seven-year warranty. How should I compare them?";
  let current = recordLedgerTurn(emptySurgeConversationState(), {
    message: firstMessage,
    activeTopic: "products_ratings",
    goal: firstMessage,
    facts: [
      { key: "quote_a", value: "$6,900, five-year warranty" },
      { key: "quote_b", value: "$7,400, seven-year warranty" },
      { key: "proposed_or_quoted_details", value: firstMessage },
    ],
  });
  current = recordLedgerTurn(current, {
    message: "Is B worth the extra money just for the longer warranty?",
    activeTopic: "products_ratings",
    goal: `${firstMessage} | Is B worth the extra money just for the longer warranty?`,
    intent: "contextual_follow_up",
  });

  const correctionMessage = "Correction: they are both $6,900. I copied B's price incorrectly.";
  current = recordLedgerTurn(current, {
    message: correctionMessage,
    activeTopic: "products_ratings",
    goal: current.goal,
    answerSummary: "Both quotes are now $6,900, so compare scope and warranty coverage.",
    intent: "correction",
    facts: [
      { key: "quote_a", value: "$6,900 five-year warranty" },
      { key: "quote_b", value: "$6,900 seven-year warranty" },
      { key: "proposed_or_quoted_details", value: firstMessage },
    ],
  });

  assert.doesNotMatch(JSON.stringify(current), /\$7,400/);
  assert.match(JSON.stringify(current), /\$6,900/);
  assert.match(JSON.stringify(current), /five-year warranty/i);
  assert.match(JSON.stringify(current), /seven-year warranty/i);

  const frame = selectSurgeConversationFrame(
    "At the same price, which one would you choose now?",
    current,
    true,
  );
  assert.doesNotMatch(JSON.stringify(frame), /\$7,400/);
});

test("a declarative same-home constraint keeps the active decision in the answer frame without merging the new topic", () => {
  const firstMessage = "At my saved apartment, air comes under the front door and the single-glazed windows feel cold. I have $1,500. What should come first?";
  const current = recordLedgerTurn(emptySurgeConversationState(), {
    message: firstMessage,
    activeTopic: "glazing_shading",
    goal: firstMessage,
    answerSummary: "Use the budget on the front-door draught and cold windows.",
    planFacts: [{ key: "property_type", value: "Apartment or unit" }],
    facts: [{ key: "budget", value: "$1,500" }],
  });
  const originalDecisionId = current.ledger.activeDecisionId;
  const constraint = "My existing reverse-cycle split still heats properly, so I do not want to replace a working unit.";
  const frame = selectSurgeConversationFrame(constraint, current, true);
  const projected = projectSurgeConversationStateToFrame(constraint, current, true);

  assert.equal(frame.decision?.id, originalDecisionId);
  assert.match(frame.decision?.goal || "", /front door/i);
  assert.match(JSON.stringify(frame.relatedDecisions), /\$1,500/);
  assert.equal(projected?.goal, firstMessage);

  const generalKnowledgeFrame = selectSurgeConversationFrame("What is an STC?", current, true);
  assert.equal(generalKnowledgeFrame.decision, null);

  const newHomeFrame = selectSurgeConversationFrame("Our new home already has solar.", current, true);
  assert.equal(newHomeFrame.decision, null);
  assert.deepEqual(newHomeFrame.subjects, []);

  const updated = recordLedgerTurn(current, {
    message: constraint,
    activeTopic: "rcac",
    goal: constraint,
    answerSummary: "Keep the working split and retain the door and window priorities.",
    intent: "new_question",
  });
  assert.notEqual(updated.ledger.activeDecisionId, originalDecisionId);
  assert.equal(updated.ledger.decisions.some((decision) => decision.id === originalDecisionId), true);

  const newHomeState = recordLedgerTurn(current, {
    message: "Our new home already has solar.",
    activeTopic: "solar",
    goal: "Review solar at our new home",
    answerSummary: "Kept the new home separate from the saved apartment.",
    intent: "new_question",
  });
  const newHomeDecision = newHomeState.ledger.decisions.find(
    (decision) => decision.id === newHomeState.ledger.activeDecisionId,
  );
  assert.deepEqual(newHomeDecision?.subjectIds, ["new_home"]);
  assert.equal(newHomeState.ledger.decisions.some((decision) => decision.id === originalDecisionId), true);
});

test("same-home constraint history removes intervening inactive-property turns", () => {
  const savedGoal = "Fix the saved-home door and windows within $1,500";
  const current = state({
    activeTopic: "glazing_shading",
    goal: savedGoal,
    pendingQuestion: "",
    ledger: {
      turn: 3,
      activeDecisionId: "decision_saved_comfort",
      subjects: [
        { id: "saved_home", kind: "saved_home", label: "Saved home", facts: [], lastTouchedTurn: 3 },
        { id: "mums_home", kind: "property", label: "Mum's home", facts: [], lastTouchedTurn: 2 },
      ],
      decisions: [
        {
          id: "decision_saved_comfort",
          subjectIds: ["saved_home"],
          topic: "glazing_shading",
          goal: savedGoal,
          facts: [{ key: "budget", value: "$1,500", source: "chat", updatedTurn: 1 }],
          outcomeSummary: "Use the budget on the door and windows.",
          openItems: [],
          pendingQuestion: "",
          status: "resolved",
          lastTouchedTurn: 3,
        },
        {
          id: "decision_mum_battery",
          subjectIds: ["mums_home"],
          topic: "battery_vpp",
          goal: "Review Mum's $9,000 battery quote",
          facts: [{ key: "quoted_price", value: "$9,000", source: "chat", updatedTurn: 2 }],
          outcomeSummary: "Kept Mum's battery quote separate.",
          openItems: [],
          pendingQuestion: "",
          status: "resolved",
          lastTouchedTurn: 2,
        },
      ],
    },
  });
  const recentTurns = [
    { role: "user", content: savedGoal },
    { role: "assistant", content: "Use $1,500 on the saved-home door and windows." },
    { role: "user", content: "Mum's home has a $9,000 battery quote." },
    { role: "assistant", content: "I will keep Mum's battery quote separate." },
    { role: "user", content: "Back to the first one." },
    { role: "assistant", content: "Back to your saved home's door and windows." },
    { role: "user", content: "Mum says her gas heater is expensive. Does that change what I should do at my apartment?" },
    { role: "assistant", content: "No. Mum's heating is separate from your apartment." },
    { role: "user", content: "Back to my home only." },
    { role: "assistant", content: "Back to your saved-home plan only." },
  ];
  const filtered = filterSurgeRecentTurnsForFrame(
    "My existing reverse-cycle split still heats properly, so I do not want to replace a working unit.",
    current,
    true,
    recentTurns,
  );
  const text = JSON.stringify(filtered);
  assert.match(text, /\$1,500/);
  assert.match(text, /Back to the first one/i);
  assert.match(text, /Back to my home only/i);
  assert.doesNotMatch(text, /Mum|\$9,000|battery|gas heater/i);
});
