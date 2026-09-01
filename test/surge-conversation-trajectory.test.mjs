import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createSurgeTrajectoryCheckpointState,
  evaluateSurgeConversationAssertions,
  evaluateSurgeTrajectoryTurn,
  loadSurgeConversationTrajectoryFixture,
  loadSurgeTrajectoryCheckpoint,
  recentTurnsForTrajectory,
} from "../scripts/run-surge-conversation-trajectory.mjs";
import { handleEnergyAssistantRequest } from "../src/lib/energy-assistant-server.ts";
import { buildSurgePlanContextFromStoredAssessment } from "../src/lib/energy-assistant-plan-context.ts";

const ORIGIN = "https://compare.example.test";
const NOW = new Date("2026-08-29T00:00:00.000Z");
const PLAN = buildSurgePlanContextFromStoredAssessment(JSON.stringify({
  version: 1,
  stage: 4,
  draft: {
    postcode: "3000",
    situation: "owner",
    approvalContext: "no_approval",
    propertyType: "house",
    occupants: "two",
  },
}));

async function runTrajectory(messages, dependencyOverrides = {}) {
  let recentTurns = [];
  let continuation = null;
  const results = [];
  for (const [index, message] of messages.entries()) {
    const request = new Request(`${ORIGIN}/api/energy-assistant`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        action: "ask",
        requestId: `trajectory-${String(index + 1).padStart(16, "0")}`,
        message,
        recentTurns,
        continuation,
        planContext: PLAN,
        audience: "public",
        pageContext: "/surge",
      }),
    });
    const response = await handleEnergyAssistantRequest(request, {
      now: () => NOW,
      randomUUID: () => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      reserveModelCall: async () => ({ allowed: false }),
      ...dependencyOverrides,
    });
    assert.equal(response.status, 200, message);
    const payload = await response.json();
    results.push(payload);
    recentTurns = [
      ...recentTurns,
      { role: "user", content: message },
      { role: "assistant", content: payload.reply.content },
    ].slice(-12);
    continuation = payload.continuation;
  }
  return results;
}

function scoringTurn(overrides = {}) {
  return {
    id: "c01t01",
    sourcePolicy: "model_required",
    clauses: [],
    forbiddenPatterns: [],
    maxWords: 300,
    maxParagraphs: 8,
    maxQuestions: 1,
    state: {
      activeTopicAnyOf: [],
      goalAnyOf: [],
      factsExclude: [],
      pendingQuestion: "optional_material",
    },
    ...overrides,
  };
}

function scoringObservation(overrides = {}) {
  return {
    conversationId: "c01",
    turnId: "c01t01",
    message: "",
    httpStatus: 200,
    visibleAnswer: "A complete answer.",
    followUpQuestion: "",
    practicalStepCount: 0,
    quickReplyCount: 0,
    citationCount: 0,
    officialCitationUrls: [],
    officialCitationHosts: [],
    answerSource: "model",
    officialWebLookupRequested: false,
    modelAttempted: true,
    modelFailureCode: "",
    rejectionDiagnostic: null,
    continuation: {
      version: 1,
      activeTopic: "general",
      goal: "",
      facts: [],
      pendingQuestion: "",
    },
    failures: [],
    ...overrides,
  };
}

function checkpointTranscriptHash(observations) {
  const transcript = observations.map((item) => (
    `${item.conversationId || "trajectory-v1"}\0${item.turnId}\0${item.message}\0${item.assistant}`
  )).join("\0");
  return createHash("sha256").update(transcript).digest("hex");
}

test("rebate clarification and equipment details remain one useful conversation without the model", async () => {
  assert.ok(PLAN);
  const results = await runTrajectory([
    "whats the rebate for replacing ducted gas heating",
    "i dont understand",
    "im looking at installing next friday, a multi head emerald 18 kw system with 3 heads an 8.5 and 2 4.5s",
    "thats useless answer",
  ]);
  const answers = results.map((result) => result.reply.content);
  for (const [index, answer] of answers.entries()) {
    assert.match(answer, /Victorian Energy Upgrades|discount|exact (?:outdoor and indoor )?model/i, `turn ${index + 1}`);
    assert.doesNotMatch(answer, /Wattzun AI is here|only covers|SRES|solar panels?|inverter|roof layout|battery/i, `turn ${index + 1}`);
    assert.doesNotMatch(answer, /what (?:is )?the property postcode|do you own|rent it|strata approval/i, `turn ${index + 1}`);
    assert.ok(answer.split(/\s+/u).filter(Boolean).length <= 90, `turn ${index + 1}: ${answer}`);
  }
  assert.match(answers[1], /not (?:one )?fixed|exact .*model/i);
  assert.match(answers[2], /18 kW|size and number of heads/i);
  assert.match(answers[2], /exact model numbers.*outdoor and indoor/i);

  const finalState = results.at(-1).continuation;
  assert.equal(finalState.activeTopic, "rebates_certificates");
  assert.match(finalState.goal, /rebate.*ducted gas heating/i);
  assert.ok(finalState.facts.some((fact) => fact.key === "existing_heating" && /ducted gas/i.test(fact.value)));
  assert.ok(finalState.facts.some((fact) => fact.key === "installation_timing" && /next friday/i.test(fact.value)));
  assert.ok(finalState.facts.some((fact) => fact.key === "proposed_or_quoted_details" && /emerald 18 kw/i.test(fact.value)));
});

test("the same rebate conversation survives a rejected model and unavailable grounded resolver", async () => {
  const results = await runTrajectory([
    "whats the rebate for replacing ducted gas heating",
    "i dont understand",
    "im looking at installing next friday, a multi head emerald 18 kw system with 3 heads an 8.5 and 2 4.5s",
    "thats useless answer",
  ], {
    reserveModelCall: async () => ({ allowed: true, release: async () => undefined }),
    generateAnswer: async () => null,
    resolveGroundedAnswer: async () => null,
  });
  for (const [index, result] of results.entries()) {
    assert.match(result.reply.content, /Victorian Energy Upgrades|discount|exact (?:outdoor and indoor )?model/i, `turn ${index + 1}`);
    assert.doesNotMatch(result.reply.content, /only covers|SRES|solar panels?|inverter|battery/i, `turn ${index + 1}`);
  }
  assert.equal(results.at(-1).continuation.activeTopic, "rebates_certificates");
  assert.match(results.at(-1).continuation.goal, /rebate.*ducted gas heating/i);
});

test("a quote-fairness correction replaces the rebate goal and cannot corrupt the saved postcode", async () => {
  const results = await runTrajectory([
    "whats the rebate for replacing ducted gas heating",
    "Actually I want to know if the quote is fair, not the rebate",
    "the quote is $6500 installed and the model is ABC 1234",
  ]);
  const correctedState = results[1].continuation;
  assert.equal(correctedState.activeTopic, "products_ratings");
  assert.match(correctedState.goal, /quote is fair/i);
  assert.doesNotMatch(correctedState.goal, /^whats the rebate/i);

  const finalState = results[2].continuation;
  assert.equal(finalState.activeTopic, "products_ratings");
  assert.match(finalState.goal, /quote is fair/i);
  assert.match(results[2].reply.content, /\$6,?500/i);
  assert.match(results[2].reply.content, /ABC 1234/i);
  assert.match(results[2].reply.content, /installed|scope|included|warranty/i);
  assert.doesNotMatch(results[2].reply.content, /Victorian Energy Upgrades|\bVEU\b|rebate|certificate discount/i);
  assert.equal(finalState.facts.some((fact) => (
    fact.key === "postcode" && /^(?:6500|1234)$/.test(fact.value)
  )), false);
});

test("a new solar decision cannot inherit an earlier heating answer or state", async () => {
  const results = await runTrajectory([
    "I have ducted gas and am looking at reverse-cycle air conditioning",
    "I am installing solar next Friday",
  ]);
  const finalPayload = results.at(-1);
  assert.match(finalPayload.reply.content, /solar|panels?|inverter|roof/i);
  assert.doesNotMatch(finalPayload.reply.content, /reverse-cycle|air condition|ducted gas|Victorian Energy Upgrades|\bVEU\b/i);
  assert.equal(finalPayload.continuation.activeTopic, "solar");
});

test("new household decisions reset state while off-scope interruptions leave it untouched", async () => {
  for (const scenario of [
    {
      message: "I am installing a dishwasher next Friday",
      expected: /dishwasher|appliance|energy rating|water/i,
      expectedTopic: "general",
    },
    {
      message: "I am installing a fence next Friday",
      expected: /home energy|energy use|outside|scope/i,
      expectedTopic: "rcac",
    },
  ]) {
    const results = await runTrajectory([
      "I have ducted gas and am looking at reverse-cycle air conditioning",
      scenario.message,
    ]);
    const finalPayload = results.at(-1);
    assert.match(finalPayload.reply.content, scenario.expected, scenario.message);
    assert.doesNotMatch(finalPayload.reply.content, /reverse-cycle|air condition|ducted gas|Victorian Energy Upgrades|\bVEU\b/i, scenario.message);
    assert.equal(finalPayload.continuation.activeTopic, scenario.expectedTopic, scenario.message);
  }
});

test("an additive topic switch borrows the comparison but not the old decision state", async () => {
  const results = await runTrajectory([
    "Why is a home battery so expensive?",
    "solar too?",
  ]);
  const finalPayload = results.at(-1);
  assert.match(finalPayload.reply.content, /^Solar can look expensive/i);
  assert.doesNotMatch(finalPayload.reply.content, /assess a battery|usable battery capacity|VPP/i);
  assert.equal(finalPayload.continuation.activeTopic, "solar");
  assert.match(finalPayload.continuation.goal, /solar too/i);
  assert.doesNotMatch(finalPayload.continuation.goal, /battery/i);
});

test("saved postcode and owner context are used for a relevant upgrade decision without magic wording", async () => {
  const [payload] = await runTrajectory([
    "how much rebate applies when replacing ducted gas heating with reverse-cycle?",
  ]);
  assert.match(payload.reply.content, /Victorian Energy Upgrades/i);
  assert.doesNotMatch(payload.reply.content, /what (?:is )?the property postcode|do you own|rent it|strata approval/i);
});

test("the reviewed fixture forces quote recall after the seed transcript is evicted", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const conversationIds = new Set(loaded.fixture.turns.map((turn) => turn.conversationId));
  const quoteConversation = loaded.fixture.turns.filter((turn) => turn.conversationId === "c12");
  assert.equal(conversationIds.size, 20);
  assert.equal(loaded.fixture.turns.length, 73);
  assert.equal(quoteConversation.length, 8);
  assert.equal(quoteConversation.at(-1).id, "c12t08");

  const historyBeforeReturn = recentTurnsForTrajectory(quoteConversation.slice(0, -1).flatMap((turn) => [
    { role: "user", content: turn.message },
    { role: "assistant", content: `Answer for ${turn.id}.` },
  ]));
  assert.equal(historyBeforeReturn.length, 12);
  assert.equal(historyBeforeReturn.some((turn) => turn.content === quoteConversation[0].message), false);
  assert.equal(historyBeforeReturn[0].content, quoteConversation[1].message);
  assert.match(quoteConversation.at(-1).message, /Back to the window quotes/i);
});

test("answer clauses cannot be satisfied by an echoed follow-up and incomplete diagnostics bind to the delivered answer", () => {
  const turn = scoringTurn({
    clauses: [{ id: "approval", anyOf: ["body corporate", "approval"] }],
  });
  const echoedOnly = scoringObservation({
    visibleAnswer: "Check the moisture pattern first.",
    followUpQuestion: "Do you know whether body corporate approval applies?",
  });
  assert.ok(evaluateSurgeTrajectoryTurn(turn, echoedOnly, "paid").includes("clause:approval"));

  const rejectedIncomplete = scoringObservation({
    visibleAnswer: "Body corporate approval may apply.",
    rejectionDiagnostic: { completeQuestionCoverage: false },
  });
  assert.ok(evaluateSurgeTrajectoryTurn(turn, rejectedIncomplete, "paid")
    .includes("incomplete_question_coverage"));

  const repairedAnswer = scoringObservation({
    visibleAnswer: "Body corporate approval may apply.",
    rejectionDiagnostic: {
      completeQuestionCoverage: false,
      visibleCandidate: "Body corporate...",
    },
  });
  assert.equal(evaluateSurgeTrajectoryTurn(turn, repairedAnswer, "paid")
    .includes("incomplete_question_coverage"), false);

  const deliveredRejectedCandidate = scoringObservation({
    visibleAnswer: "Body corporate approval may apply.",
    rejectionDiagnostic: {
      completeQuestionCoverage: false,
      visibleCandidate: "  Body corporate\napproval may apply.  ",
    },
  });
  assert.ok(evaluateSurgeTrajectoryTurn(turn, deliveredRejectedCandidate, "paid")
    .includes("incomplete_question_coverage"));
});

test("reviewed semantic clauses accept explicit working, self-use and condensation explanations", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const answers = new Map([
    [
      "c03t01",
      "No, not necessarily. Heating naturally adds a substantial electrical load, even though reverse-cycle systems are usually the most efficient electric room heaters. A larger-than-expected jump can also come from longer run time, colder weather, high temperature settings, dirty filters, draughts or your tariff. Poor heating, unusual noise, icing, error codes or sharply increased electricity use under similar conditions would make a fault more likely.",
    ],
    [
      "c04t03",
      "No, it is not pointless. The 6.6 kW panels and 5 kW inverter are a normal pairing, and the system can still reduce bills by supplying your home directly. Zero export means unused solar is curtailed rather than sold to the grid, so its value depends heavily on daytime electricity use or battery charging. It becomes poor value only if the quote's savings rely on exports or you use very little power while solar is available.",
    ],
    [
      "c10t03",
      "First, check exactly where the moisture appears first thing in the morning: on the room-side glass, the window frame, or the wall and ceiling. Moisture on the glass usually means humid bedroom air is meeting a cold window. Damp patches or staining on walls or ceilings may instead indicate a leak or persistent damp needing investigation.",
    ],
  ]);
  for (const [turnId, visibleAnswer] of answers) {
    const turn = loaded.fixture.turns.find((candidate) => candidate.id === turnId);
    assert.ok(turn, turnId);
    assert.deepEqual(
      evaluateSurgeTrajectoryTurn(turn, scoringObservation({ turnId, visibleAnswer }), "paid"),
      [],
      turnId,
    );
  }
});

test("v13 natural equivalents pass their intended clauses while incomplete answers still fail", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const cases = [
    {
      turnId: "c06t02",
      clauseId: "not-warranty-alone",
      accepted: "No. Quote B is not worth the extra money just for the longer warranty. Quote A is $6,900 with a five-year warranty, while Quote B is $7,400 with a seven-year warranty. B only becomes better value if its warranty also gives meaningfully broader product, labour or workmanship cover, fewer exclusions and dependable claim support.",
      rejected: "Quote A is $6,900 and Quote B is $7,400. B is worth the extra money because its warranty is longer.",
    },
    {
      turnId: "c12t04",
      clauseId: "generation-timing",
      accepted: "Self-consumption means using your solar electricity in your home at the time it is generated. For example, if your panels power the dishwasher during the day, that solar is self-consumed. Any extra solar you do not use is exported to the grid.",
      rejected: "Self-consumption means using solar electricity in your home. It can reduce electricity bought from the grid.",
    },
    {
      turnId: "c12t07",
      clauseId: "recovery-context",
      accepted: "No. A longer recovery time does not automatically mean the hot-water unit is faulty. Recovery can slow because of colder air or incoming water, heavier hot-water use, timer settings, or a unit that is small for the household.",
      rejected: "No. A longer recovery time does not automatically mean the hot-water unit is faulty.",
    },
    {
      turnId: "c13t01",
      clauseId: "switchboard-exclusion",
      accepted: "No, it does not yet sound complete. The finance is $188 short, the $330 admin fee is known, but extra switchboard work leaves the final installed cost open.",
      rejected: "No, it does not yet sound complete. The finance is $188 short and the $330 admin fee still needs checking.",
    },
    {
      turnId: "c20t02",
      clauseId: "preserves-budget",
      accepted: "Keep the working reverse-cycle split. Replacing one that still heats properly is unlikely to be the best use of your budget.",
      rejected: "Keep the working reverse-cycle split because it still heats properly.",
    },
    {
      turnId: "c20t03",
      clauseId: "retains-own-plan",
      accepted: "No. Mum's expensive gas heater does not change the decision for your apartment. Your reverse-cycle split still heats properly, so keep using it.",
      rejected: "No. Mum's home and heating costs are separate from your apartment.",
    },
  ];

  for (const item of cases) {
    const turn = loaded.fixture.turns.find((candidate) => candidate.id === item.turnId);
    assert.ok(turn, item.turnId);
    assert.deepEqual(
      evaluateSurgeTrajectoryTurn(
        turn,
        scoringObservation({ turnId: item.turnId, visibleAnswer: item.accepted }),
        "paid",
      ),
      [],
      item.turnId,
    );
    assert.ok(
      evaluateSurgeTrajectoryTurn(
        turn,
        scoringObservation({ turnId: item.turnId, visibleAnswer: item.rejected }),
        "paid",
      ).includes(`clause:${item.clauseId}`),
      `${item.turnId}:${item.clauseId}`,
    );
  }
});

test("official source policies require reviewed URLs and ordinary cited quantities remain grounded", () => {
  const referenceTurn = scoringTurn({
    sourcePolicy: "official_reference",
    clauses: [{ id: "official", anyOf: ["official"] }],
  });
  const commercialCitation = scoringObservation({
    visibleAnswer: "Use this official reference.",
    citationCount: 1,
    officialCitationUrls: ["https://example.com/"],
    officialCitationHosts: ["example.com"],
  });
  assert.ok(evaluateSurgeTrajectoryTurn(referenceTurn, commercialCitation, "paid")
    .includes("official_reference_required"));

  const reviewedCitation = scoringObservation({
    visibleAnswer: "Use this official reference.",
    citationCount: 1,
    officialCitationUrls: ["https://energy.vic.gov.au/"],
    officialCitationHosts: ["energy.vic.gov.au"],
  });
  assert.equal(evaluateSurgeTrajectoryTurn(referenceTurn, reviewedCitation, "paid")
    .includes("official_reference_required"), false);

  const fixture = {
    planContext: {},
    turns: [{ id: "c01t01", sourcePolicy: "model_required" }],
    conversationAssertions: [{
      id: "quantities",
      type: "quantity_grounding_all_turns",
      allowDerivedArithmetic: false,
    }],
  };
  const inventedQuantity = scoringObservation({
    message: "What size should it be?",
    visibleAnswer: "Use a 999 kW system.",
    citationCount: 1,
    officialCitationUrls: ["https://energy.vic.gov.au/"],
    officialCitationHosts: ["energy.vic.gov.au"],
  });
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [inventedQuantity]),
    [{
      assertionId: "quantities",
      type: "quantity_grounding_all_turns",
      code: "quantity_not_grounded",
      turnId: "c01t01",
    }],
  );
});

test("a first-turn crash in a new conversation reloads the reset checkpoint", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "surge-boundary-checkpoint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkpointPath = join(directory, "checkpoint.json");
  const expected = createSurgeTrajectoryCheckpointState(
    "boundary-run",
    { runLabel: "boundary-crash", scripted: false, budgetMicroUsd: 1_000 },
    "source-hash",
    "model-name",
  );
  const completedObservation = {
    conversationId: "c01",
    turnId: "c01t01",
    message: "First conversation question",
    assistant: "First conversation answer",
    reservationEstimate: 0,
    budgetDenied: false,
  };
  const checkpoint = {
    ...expected,
    observations: [completedObservation],
    committedReservationMicroUsd: 100,
    recentTurns: [],
    continuation: null,
    transcriptHash: checkpointTranscriptHash([completedObservation]),
    inFlightTurn: {
      conversationId: "c02",
      turnId: "c02t01",
      message: "First turn after reset",
      reservationEstimate: 100,
    },
  };
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint)}\n`, "utf8");

  const resumed = await loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true);
  assert.equal(resumed.inFlightTurn.conversationId, "c02");
  assert.deepEqual(resumed.recentTurns, []);
  assert.equal(resumed.continuation, null);

  const invalidCheckpoint = {
    ...checkpoint,
    inFlightTurn: {
      turnId: "c02t01",
      message: "First turn after reset",
      reservationEstimate: 100,
    },
  };
  await writeFile(checkpointPath, `${JSON.stringify(invalidCheckpoint)}\n`, "utf8");
  await assert.rejects(
    loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true),
    /belongs to different code, fixture, model or run label/i,
  );
});

test("deterministic safety provenance is strict and corrected history can be contrasted", () => {
  const safetyTurn = scoringTurn({ sourcePolicy: "deterministic" });
  const groundedSafety = scoringObservation({ answerSource: "grounded" });
  assert.ok(evaluateSurgeTrajectoryTurn(safetyTurn, groundedSafety, "paid")
    .includes("deterministic_required"));
  const deterministicSafety = scoringObservation({ answerSource: "deterministic" });
  assert.equal(evaluateSurgeTrajectoryTurn(safetyTurn, deterministicSafety, "paid")
    .includes("deterministic_required"), false);

  const correctionFixture = {
    turns: [{ id: "c02t02" }, { id: "c02t03" }],
    conversationAssertions: [{
      id: "correction",
      type: "cross_turn_correction",
      checkpoints: [{
        correctionTurn: "c02t02",
        throughTurn: "c02t03",
        forbidAsCurrent: ["20 minutes"],
      }],
    }],
  };
  const correctedContinuation = {
    version: 1,
    activeTopic: "ventilation",
    goal: "Check slow bathroom clearing",
    facts: [{ key: "clearing_time", value: "45 minutes" }],
    pendingQuestion: "",
  };
  const historicalContrast = scoringObservation({
    turnId: "c02t03",
    visibleAnswer: "You first said 20 minutes, then corrected it to 45 minutes.",
    continuation: correctedContinuation,
  });
  assert.deepEqual(
    evaluateSurgeConversationAssertions(correctionFixture, [historicalContrast]),
    [],
  );

  const staleCurrent = scoringObservation({
    turnId: "c02t03",
    visibleAnswer: "The current clearing time is 20 minutes.",
    continuation: correctedContinuation,
  });
  assert.deepEqual(
    evaluateSurgeConversationAssertions(correctionFixture, [staleCurrent]),
    [{
      assertionId: "correction",
      type: "cross_turn_correction",
      code: "stale_correction",
      turnId: "c02t03",
    }],
  );

  const fakeContrast = scoringObservation({
    turnId: "c02t03",
    visibleAnswer: "You previously said 20 minutes, but that remains the current clearing time.",
    continuation: correctedContinuation,
  });
  assert.deepEqual(
    evaluateSurgeConversationAssertions(correctionFixture, [fakeContrast]),
    [{
      assertionId: "correction",
      type: "cross_turn_correction",
      code: "stale_correction",
      turnId: "c02t03",
    }],
  );

  const negatedReplacement = scoringObservation({
    turnId: "c02t03",
    visibleAnswer: "You previously said 20 minutes, but the current clearing time is not 45 minutes.",
    continuation: correctedContinuation,
  });
  assert.deepEqual(
    evaluateSurgeConversationAssertions(correctionFixture, [negatedReplacement]),
    [{
      assertionId: "correction",
      type: "cross_turn_correction",
      code: "stale_correction",
      turnId: "c02t03",
    }],
  );
});
