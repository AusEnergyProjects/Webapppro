import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  createSurgeTrajectoryBudget,
  createSurgeTrajectoryCheckpointState,
  evaluateSurgeConversationAssertions,
  evaluateSurgeTrajectoryTurn,
  loadSurgeConversationTrajectoryFixture,
  loadSurgeTrajectoryCheckpoint,
  parseSurgeConversationTrajectoryArgs,
  recentTurnsForTrajectory,
  resetSurgeTrajectoryStateAtConversationBoundary,
  sanitizeTrajectoryRejectionDiagnostic,
} from "../scripts/run-surge-conversation-trajectory.mjs";

function trajectoryObservation(turnId, overrides = {}) {
  return {
    turnId,
    message: "Test message",
    httpStatus: 200,
    assistant: "Test answer",
    visibleAnswer: "Test answer",
    directAnswer: "Test answer",
    followUpQuestion: "",
    practicalSteps: [],
    practicalStepCount: 0,
    quickReplyCount: 0,
    citationCount: 0,
    officialCitationUrls: [],
    officialCitationHosts: [],
    answerSource: "model",
    continuation: {
      version: 1,
      activeTopic: "general",
      goal: "Test goal",
      facts: [],
      pendingQuestion: "",
      lastAnswerSummary: "Test answer",
      ledger: {
        turn: 1,
        activeDecisionId: "decision_saved",
        subjects: [],
        decisions: [{
          id: "decision_saved",
          subjectIds: ["saved_home"],
          topic: "general",
          goal: "Test goal",
          facts: [],
          outcomeSummary: "Test answer",
          openItems: [],
          pendingQuestion: "",
          status: "resolved",
          lastTouchedTurn: 1,
        }],
      },
    },
    modelAttempted: true,
    modelFailureCode: "",
    failures: [],
    ...overrides,
  };
}

function checkpointTranscriptHash(observations) {
  return createHash("sha256").update(observations.map((item) => (
    `${item.conversationId || "trajectory-v1"}\0${item.turnId}\0${item.message}\0${item.assistant}`
  )).join("\0")).digest("hex");
}

test("trajectory retry keeps failed and timed-out reservations committed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "surge-trajectory-budget-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkpointPath = join(directory, "checkpoint.json");
  const expected = createSurgeTrajectoryCheckpointState(
    "run-identity",
    { runLabel: "budget-retry", scripted: false, budgetMicroUsd: 500_000 },
    "source-hash",
    "gpt-5.6-sol",
  );
  expected.committedReservationMicroUsd = 400_000;
  expected.failedTurn = {
    turnId: "t11-bathroom-follow-up",
    modelAttempted: true,
    reservationEstimate: 400_000,
    modelFailureCode: "request_timeout",
  };
  await writeFile(checkpointPath, `${JSON.stringify(expected)}\n`, "utf8");

  const retried = await loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true);
  assert.equal(retried.committedReservationMicroUsd, 400_000);
  assert.equal(retried.failedTurn.turnId, "t11-bathroom-follow-up");

  const budget = createSurgeTrajectoryBudget(500_000, retried.committedReservationMicroUsd);
  assert.equal(budget.reserve(100_001), false);
  assert.equal(budget.reserve(100_000), true);
  assert.deepEqual(budget.summary(), {
    limitMicroUsd: 500_000,
    requestedMicroUsd: 600_001,
    committedMicroUsd: 500_000,
  });
});

test("trajectory checkpoint schema fails closed when durable reservation accounting is absent", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "surge-trajectory-schema-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkpointPath = join(directory, "checkpoint.json");
  const expected = createSurgeTrajectoryCheckpointState(
    "run-identity",
    { runLabel: "legacy-budget", scripted: false, budgetMicroUsd: 500_000 },
    "source-hash",
    "gpt-5.6-sol",
  );
  const legacy = { ...expected, version: 1 };
  delete legacy.committedReservationMicroUsd;
  await writeFile(checkpointPath, `${JSON.stringify(legacy)}\n`, "utf8");

  await assert.rejects(
    loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true),
    /belongs to different code, fixture, model or run label/i,
  );

  const undercounted = {
    ...expected,
    mode: "paid",
    committedReservationMicroUsd: 399_999,
    failedTurn: {
      turnId: "t11-bathroom-follow-up",
      reservationEstimate: 400_000,
      budgetDenied: false,
    },
  };
  await writeFile(checkpointPath, `${JSON.stringify(undercounted)}\n`, "utf8");
  await assert.rejects(
    loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true),
    /belongs to different code, fixture, model or run label/i,
  );
});

test("trajectory checkpoint binds the cap and forces an explicit retry after an in-flight interruption", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "surge-trajectory-inflight-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkpointPath = join(directory, "checkpoint.json");
  const expected = createSurgeTrajectoryCheckpointState(
    "run-identity",
    { runLabel: "inflight", scripted: false, budgetMicroUsd: 16_000_000 },
    "source-hash",
    "gpt-5.6-sol",
  );
  expected.committedReservationMicroUsd = 300_000;
  expected.inFlightTurn = {
    conversationId: "trajectory-v1",
    turnId: "t07-inflight",
    message: "Keep the whole conversation context.",
    reservationEstimate: 300_000,
  };
  await writeFile(checkpointPath, `${JSON.stringify(expected)}\n`, "utf8");

  await assert.rejects(
    loadSurgeTrajectoryCheckpoint(checkpointPath, expected, false),
    /failed or in-flight turn/i,
  );
  const resumed = await loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true);
  assert.equal(resumed.inFlightTurn.turnId, "t07-inflight");
  assert.equal(resumed.committedReservationMicroUsd, 300_000);

  const differentCap = createSurgeTrajectoryCheckpointState(
    "run-identity",
    { runLabel: "inflight", scripted: false, budgetMicroUsd: 17_000_000 },
    "source-hash",
    "gpt-5.6-sol",
  );
  await assert.rejects(
    loadSurgeTrajectoryCheckpoint(checkpointPath, differentCap, true),
    /belongs to different code, fixture, model or run label/i,
  );
});

test("trajectory retry accepts the intentionally empty context at a new conversation boundary", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "surge-trajectory-boundary-retry-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkpointPath = join(directory, "checkpoint.json");
  const expected = createSurgeTrajectoryCheckpointState(
    "run-identity",
    { runLabel: "boundary-retry", scripted: false, budgetMicroUsd: 500_000 },
    "source-hash",
    "gpt-5.6-sol",
  );
  expected.observations = [trajectoryObservation("c01t03", { conversationId: "c01" })];
  expected.recentTurns = [];
  expected.continuation = null;
  expected.transcriptHash = checkpointTranscriptHash(expected.observations);
  expected.committedReservationMicroUsd = 100_000;
  expected.failedTurn = {
    conversationId: "c02",
    turnId: "c02t01",
    message: "Start a separate conversation.",
    httpStatus: 503,
    reservationEstimate: 100_000,
    budgetDenied: false,
  };
  await writeFile(checkpointPath, `${JSON.stringify(expected)}\n`, "utf8");

  const resumed = await loadSurgeTrajectoryCheckpoint(checkpointPath, expected, true);
  assert.deepEqual(resumed.recentTurns, []);
  assert.equal(resumed.continuation, null);
  assert.equal(resumed.failedTurn.turnId, "c02t01");
});

test("reviewed trajectory fixture contains exactly fifty sequential turns", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  assert.equal(loaded.fixture.turns.length, 50);
  assert.match(loaded.fixture.turns[0].id, /^t01-/);
  assert.match(loaded.fixture.turns.at(-1).id, /^t50-/);
});

test("durability fixture contains twenty isolated conversations with one transcript-eviction return", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const counts = loaded.fixture.turns.reduce((result, turn) => {
    result.set(turn.conversationId, (result.get(turn.conversationId) || 0) + 1);
    return result;
  }, new Map());
  assert.equal(loaded.fixture.version, 2);
  assert.equal(loaded.fixture.turns.length, 73);
  assert.equal(counts.size, 20);
  assert.ok([...counts.values()].every((count) => count >= 3 && count <= 8));
  assert.equal(counts.get("c12"), 8);
  assert.equal(loaded.fixture.execution.resetStateBetweenConversations, true);
  assert.equal(loaded.fixture.execution.persistContinuationWithinConversation, true);
});

test("new assertion schemas reject malformed fields and unknown turns during fixture load", async (context) => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const directory = await mkdtemp(join(
    process.cwd(),
    "test",
    "fixtures",
    ".surge-assertion-schema-",
  ));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureDirectory = `test/fixtures/${basename(directory)}`;
  const officialUrl = "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/heating-and-cooling-discounts";
  const cases = [
    {
      name: "official missing checkpoints",
      assertion: { id: "bad-official", type: "official_citation_requirements" },
    },
    {
      name: "official non-text ID",
      assertion: {
        id: 123,
        type: "official_citation_requirements",
        checkpoints: [{ turn: "c08t02", minimumCount: 1, requiredUrls: [officialUrl] }],
      },
    },
    {
      name: "official wrong minimum type",
      assertion: {
        id: "bad-official",
        type: "official_citation_requirements",
        checkpoints: [{ turn: "c08t02", minimumCount: "1", requiredUrls: [officialUrl] }],
      },
    },
    {
      name: "official count below range",
      assertion: {
        id: "bad-official",
        type: "official_citation_requirements",
        checkpoints: [{ turn: "c08t02", minimumCount: 0, requiredUrls: [officialUrl] }],
      },
    },
    {
      name: "official checkpoint missing URLs",
      assertion: {
        id: "bad-official",
        type: "official_citation_requirements",
        checkpoints: [{ turn: "c08t02", minimumCount: 1 }],
      },
    },
    {
      name: "official unknown turn",
      assertion: {
        id: "bad-official",
        type: "official_citation_requirements",
        checkpoints: [{ turn: "c99t99", minimumCount: 1, requiredUrls: [officialUrl] }],
      },
    },
    {
      name: "structured missing count",
      assertion: { id: "bad-steps", type: "structured_action_count", turn: "c13t03" },
    },
    {
      name: "structured wrong count type",
      assertion: {
        id: "bad-steps",
        type: "structured_action_count",
        turn: "c13t03",
        exactActionCount: "3",
      },
    },
    {
      name: "structured count below range",
      assertion: {
        id: "bad-steps",
        type: "structured_action_count",
        turn: "c13t03",
        exactActionCount: 0,
      },
    },
    {
      name: "structured unknown turn",
      assertion: {
        id: "bad-steps",
        type: "structured_action_count",
        turn: "c99t99",
        exactActionCount: 3,
      },
    },
  ];

  for (const [index, candidate] of cases.entries()) {
    const fixture = structuredClone(loaded.fixture);
    fixture.conversationAssertions = [candidate.assertion];
    const filename = `${String(index + 1).padStart(2, "0")}.json`;
    await writeFile(join(directory, filename), `${JSON.stringify(fixture)}\n`, "utf8");
    await assert.rejects(
      loadSurgeConversationTrajectoryFixture(`${fixtureDirectory}/${filename}`),
      /schema|configured turn/i,
      candidate.name,
    );
  }
});

test("durability fixture exercises the exact front-door warmth follow-up without losing door memory", async () => {
  const { fixture } = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const doorTurn = fixture.turns.find((item) => item.id === "c01t01");
  const warmthTurn = fixture.turns.find((item) => item.id === "c01t02");
  assert.equal(doorTurn.message, "I feel a draft under my front door");
  assert.equal(
    warmthTurn.message,
    "great idea, also i find it hard to keep the house warm sometimes",
  );

  const contextual = "The draught under your front door is one place warm air escapes. Keep the door snake, then check other gaps and use close-fitting curtains or blinds at cold windows.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(warmthTurn, trajectoryObservation(warmthTurn.id, {
    visibleAnswer: contextual,
    directAnswer: contextual,
    assistant: contextual,
  }), "paid"), []);

  const recordedDoorAnswer = "Start with a removable door snake along the inside bottom edge. It is a low-cost, reversible way to reduce the draught without modifying the door. Check that the door still closes and latches normally. If more sealing is needed, confirm approval before fitting a permanent sweep or seal because an apartment entry door may be shared property or fire-rated.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(doorTurn, trajectoryObservation(doorTurn.id, {
    visibleAnswer: recordedDoorAnswer,
    directAnswer: recordedDoorAnswer,
    assistant: recordedDoorAnswer,
  }), "paid"), []);

  const amnesiac = "Heat loss can come from windows, ceiling insulation and heating settings. Check curtains and the thermostat.";
  assert.ok(evaluateSurgeTrajectoryTurn(warmthTurn, trajectoryObservation(warmthTurn.id, {
    visibleAnswer: amnesiac,
    directAnswer: amnesiac,
    assistant: amnesiac,
  }), "paid").includes("clause:uses-confirmed-door-history"));
});

test("initial saved-plan advice puts moisture first and explains that priority on follow-up", async () => {
  const { fixture } = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const firstTurn = fixture.turns.find((item) => item.id === "t01-saved-home-start");
  const whyTurn = fixture.turns.find((item) => item.id === "t02-resolve-that");
  const continuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "general",
    goal: "Start with the first home priority",
  };
  const moistureFirst = "Your first priority is condensation and moisture control because damp can damage the home. Then address the front-door draught and cold single-glazed windows.";
  const moistureSteps = [
    "1. Address condensation and moisture control first.",
    "2. Seal the front-door draught.",
    "3. Improve the cold single-glazed windows.",
  ];
  assert.deepEqual(evaluateSurgeTrajectoryTurn(firstTurn, trajectoryObservation(firstTurn.id, {
    visibleAnswer: moistureFirst,
    directAnswer: moistureFirst,
    assistant: moistureFirst,
    practicalSteps: moistureSteps,
    practicalStepCount: moistureSteps.length,
    continuation,
  }), "paid"), []);

  const doorFirst = "Start with the front-door draught because it is cheap, then deal with the windows and condensation.";
  const doorSteps = [
    "1. Start with the front-door draught.",
    "2. Deal with the windows.",
    "3. Address condensation.",
  ];
  assert.ok(evaluateSurgeTrajectoryTurn(firstTurn, trajectoryObservation(firstTurn.id, {
    visibleAnswer: doorFirst,
    directAnswer: doorFirst,
    assistant: doorFirst,
    practicalSteps: doorSteps,
    practicalStepCount: doorSteps.length,
    continuation,
  }), "paid").some((failure) => (
    failure === "clause:saved-moisture-priority-first" || failure.startsWith("forbidden:")
  )));

  const explainsMoisture = "Moisture and condensation come first because leaving damp can worsen mould, damage finishes and reduce indoor air quality.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(whyTurn, trajectoryObservation(whyTurn.id, {
    visibleAnswer: explainsMoisture,
    directAnswer: explainsMoisture,
    assistant: explainsMoisture,
    continuation,
  }), "paid"), []);

  const explainsDoor = "The front door comes first because it cheaply stops cold air. Moisture can wait.";
  assert.ok(evaluateSurgeTrajectoryTurn(whyTurn, trajectoryObservation(whyTurn.id, {
    visibleAnswer: explainsDoor,
    directAnswer: explainsDoor,
    assistant: explainsDoor,
    continuation,
  }), "paid").includes("clause:explains-moisture-first"));
});

test("zero-export durability clauses require affirmative home self-use", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "c04t02");
  const affirmatives = [
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home can still use the 6.6 kW array output as it is generated.",
    "Zero export blocks surplus exports. Solar first supplies the home, so self-use remains useful even when extra generation is curtailed.",
  ];
  const opposites = [
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home cannot use the array output.",
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home can never use the array output.",
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home may not use the solar generation.",
    "The system cannot supply the home.",
    "Solar use is not possible in the home.",
  ];
  const solarContinuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "solar",
    goal: "Check what zero export changes for the solar quote",
  };

  for (const affirmative of affirmatives) {
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: affirmative,
      directAnswer: affirmative,
      assistant: affirmative,
      continuation: solarContinuation,
    }), "paid"), [], affirmative);
  }
  for (const opposite of opposites) {
    assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: opposite,
      directAnswer: opposite,
      assistant: opposite,
      continuation: solarContinuation,
    }), "paid").some((failure) => failure === "clause:self-use-remains" || failure.startsWith("forbidden:")), opposite);
  }
});

test("continuous zero-export coverage accepts affirmative household use without spanning sentences", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "t23-zero-export");
  const affirmatives = [
    "Zero export means the system cannot send surplus electricity to the grid. The system may generate for household use, while any extra is curtailed.",
    "Zero export blocks surplus exports. The 6.6 kW panels can supply household demand up to the 5 kW inverter limit.",
  ];
  const opposites = [
    "Zero export means the system cannot send surplus electricity to the grid. The system cannot generate for household use.",
    "Your home cannot use the solar generation. A later sentence mentions home use and solar without affirming either.",
    "Zero export means the system cannot send surplus electricity to the grid. You cannot use it directly.",
    "Zero export means the system cannot send surplus electricity to the grid. It is not still useful.",
    "Panels cannot supply the home.",
  ];
  const solarContinuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "solar",
    goal: "Check what zero export changes for the solar quote",
  };

  for (const affirmative of affirmatives) {
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: affirmative,
      directAnswer: affirmative,
      assistant: affirmative,
      continuation: solarContinuation,
    }), "paid"), [], affirmative);
  }
  for (const opposite of opposites) {
    assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: opposite,
      directAnswer: opposite,
      assistant: opposite,
      continuation: solarContinuation,
    }), "paid").some((failure) => failure === "clause:solar-still-useful" || failure.startsWith("forbidden:")), opposite);
  }
});

test("durability formatting and fault-negation checks accept good paid answers without weakening their limits", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const doorTurn = loaded.fixture.turns.find((item) => item.id === "c01t03");
  const fiveBlocks = [
    "Check the sides and top of the door next.",
    "A gap at the frame can keep admitting air after the bottom edge is covered.",
    "Hold a tissue around each door edge on a windy day.",
    "Mark any place where the tissue moves.",
    "Fit weather strip only to that visible gap.",
  ].join("\n\n");
  assert.deepEqual(evaluateSurgeTrajectoryTurn(doorTurn, trajectoryObservation(doorTurn.id, {
    visibleAnswer: fiveBlocks,
    directAnswer: fiveBlocks,
    assistant: fiveBlocks,
  }), "paid"), []);
  const sixBlocks = `${fiveBlocks}\n\nKeep checking after every change.`;
  assert.ok(evaluateSurgeTrajectoryTurn(doorTurn, trajectoryObservation(doorTurn.id, {
    visibleAnswer: sixBlocks,
    directAnswer: sixBlocks,
    assistant: sixBlocks,
  }), "paid").includes("paragraph_limit"));

  const bathroomTurn = loaded.fixture.turns.find((item) => item.id === "c02t02");
  const fiveBathroomBlocks = [
    "No. Fogging for 45 minutes with barely detectable airflow is not normal.",
    "Likely causes include a dirty grille, inadequate replacement air, a weak fan or a restricted duct.",
    "Clean the accessible grille with the power isolated.",
    "Run the fan with the bathroom door slightly open to test the replacement-air path.",
    "If airflow stays weak, have the fan and duct checked before replacing the fan.",
  ].join("\n\n");
  assert.deepEqual(evaluateSurgeTrajectoryTurn(bathroomTurn, trajectoryObservation(bathroomTurn.id, {
    visibleAnswer: fiveBathroomBlocks,
    directAnswer: fiveBathroomBlocks,
    assistant: fiveBathroomBlocks,
  }), "paid"), []);
  const sixBathroomBlocks = `${fiveBathroomBlocks}\n\nDo not ignore persistent moisture.`;
  assert.ok(evaluateSurgeTrajectoryTurn(bathroomTurn, trajectoryObservation(bathroomTurn.id, {
    visibleAnswer: sixBathroomBlocks,
    directAnswer: sixBathroomBlocks,
    assistant: sixBathroomBlocks,
  }), "paid").includes("paragraph_limit"));

  const faultTurn = loaded.fixture.turns.find((item) => item.id === "c03t01");
  const safeFaultAnswer = "No, a higher bill when heating does not by itself mean the split system is faulty. Because it still heats well, check running time and electricity use before assuming a fault.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(faultTurn, trajectoryObservation(faultTurn.id, {
    visibleAnswer: safeFaultAnswer,
    directAnswer: safeFaultAnswer,
    assistant: safeFaultAnswer,
  }), "paid"), []);
  const unsafeFaultAnswer = "Yes, a higher bill means the split system is faulty. It still heats well.";
  assert.ok(evaluateSurgeTrajectoryTurn(faultTurn, trajectoryObservation(faultTurn.id, {
    visibleAnswer: unsafeFaultAnswer,
    directAnswer: unsafeFaultAnswer,
    assistant: unsafeFaultAnswer,
  }), "paid").includes("clause:no-false-fault"));
  const contextBlindFaultAnswer = "No, not by itself. A fault is more likely if use rises in similar weather or the unit makes unusual noises.";
  assert.ok(evaluateSurgeTrajectoryTurn(faultTurn, trajectoryObservation(faultTurn.id, {
    visibleAnswer: contextBlindFaultAnswer,
    directAnswer: contextBlindFaultAnswer,
    assistant: contextBlindFaultAnswer,
  }), "paid").includes("clause:uses-working-fact"));
});

test("durability scorer accepts the audited language variants without accepting their opposites", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const cases = [
    {
      id: "c02t03",
      answer: "Test the replacement-air path first. Check the grille and duct to outdoors before replacing the fan.",
      opposite: "Replace it immediately without checking the grille, duct or airflow.",
    },
    {
      id: "c03t02",
      answer: "The filter is clean and the 24 degree setting is known. Check the meter or electricity usage data next, then compare running time and weather.",
      opposite: "Clean the filter first, then ask what temperature it is set to.",
    },
    {
      id: "c04t03",
      answer: "No, it is not pointless. The 6.6 kW of panels can still reduce bills by supplying electricity your home uses while the sun is shining, and the 5 kW inverter is a normal match. Zero export weakens the value because unused generation earns nothing and may be curtailed. It is worthwhile only if your daytime use, or compatible battery charging, can absorb enough solar.",
      opposite: "No. Self-consumption is of no benefit under zero export.",
      expectedFailure: "clause:why-not-pointless",
    },
    {
      id: "c06t01",
      answer: "Quote A is $6,900 with five years. Quote B is $7,400 with seven years, so compare their installation scope and warranty coverage.",
      opposite: "Quote A is $6,900. Quote B's price is unknown. An unrelated old quote was $7,400. Compare warranty scope.",
    },
    {
      id: "c12t04",
      answer: "Self-consumption means using your solar electricity at home instead of sending it to the grid.",
      opposite: "Self-consumption means solar electricity is not used at home instead of sending it to the grid while it is produced.",
    },
    {
      id: "c13t01",
      answer: "No, the quote is not complete. The finance is $188 short, the admin fee is $330, and switchboard work has no included price.",
      opposite: "The $188 and $330 are included, and switchboard work has a complete fixed price.",
    },
  ];

  for (const candidate of cases) {
    const turn = loaded.fixture.turns.find((item) => item.id === candidate.id);
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: candidate.answer,
      directAnswer: candidate.answer,
      assistant: candidate.answer,
    }), "paid"), [], candidate.id);
    const oppositeFailures = evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: candidate.opposite,
      directAnswer: candidate.opposite,
      assistant: candidate.opposite,
    }), "paid");
    assert.notDeepEqual(oppositeFailures, [], `${candidate.id} opposite`);
    if (candidate.expectedFailure) {
      assert.ok(oppositeFailures.includes(candidate.expectedFailure), candidate.id);
    }
  }
});

test("paid-run scorer variants accept equivalent advice without accepting the opposite meaning", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const cases = [
    {
      id: "c02t02",
      answer: "The corrected 45-minute clearing time and barely detectable airflow suggest ineffective extraction at the grille.",
      opposite: "The current clearing time is 20 minutes and airflow at the grille is strong.",
      expectedFailure: "clause:accepts-forty-five",
    },
    {
      id: "c02t03",
      answer: "Check the grille and duct first because replacing the fan alone may not help.",
      opposite: "Check the grille and duct. Replacing the fan alone will help.",
      expectedFailure: "clause:no-rushed-replacement",
    },
    {
      id: "c04t03",
      answer: "No, it is not pointless. The system can still reduce electricity bought from the grid.",
      opposite: "No, it is not pointless. The system cannot reduce electricity bought from the grid.",
      expectedFailure: "clause:why-not-pointless",
    },
    {
      id: "c04t02",
      answer: "Zero export means the system cannot send surplus solar to the grid. Production is reduced when solar exceeds what your home can use, so daytime self-use is more important.",
      opposite: "Zero export means the system cannot send surplus solar to the grid. Daytime self-use is not important because the home cannot use solar.",
      expectedFailure: "clause:self-use-remains",
    },
    {
      id: "c04t03",
      answer: "No, it is not pointless. The system can still cut bills when the home uses electricity during daylight.",
      opposite: "No, it is not pointless. The system cannot cut bills even when the home uses electricity during daylight.",
      expectedFailure: "clause:why-not-pointless",
    },
    {
      id: "c04t03",
      answer: "No, it is not pointless. It can still reduce grid electricity use whenever the home is using power during solar generation.",
      opposite: "No, it is not pointless. It cannot reduce grid electricity use even when the home is using power during solar generation.",
      expectedFailure: "clause:why-not-pointless",
    },
    {
      id: "c04t03",
      answer: "No, it is not pointless. It can reduce grid electricity usage while the home uses solar.",
      opposite: "No, it is not pointless. It does not reduce grid electricity usage while the home uses solar.",
      expectedFailure: "clause:why-not-pointless",
    },
  ];

  for (const candidate of cases) {
    const turn = loaded.fixture.turns.find((item) => item.id === candidate.id);
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: candidate.answer,
      directAnswer: candidate.answer,
      assistant: candidate.answer,
    }), "paid"), [], candidate.id);
    const oppositeFailures = evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: candidate.opposite,
      directAnswer: candidate.opposite,
      assistant: candidate.opposite,
    }), "paid");
    assert.ok(oppositeFailures.includes(candidate.expectedFailure), candidate.id);
  }
});

test("durability list explainers allow five intentional blocks but still reject a sixth", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const cases = [
    {
      id: "c08t03",
      blocks: [
        "Get the exact proposed equipment details in writing.",
        "Record every indoor model and outdoor model number.",
        "Confirm the heating capacity and final configuration.",
        "Have the installation scope and invoice name the approved product.",
        "Record the existing gas heater and how it will be decommissioned.",
      ],
    },
    {
      id: "c11t02",
      blocks: [
        "Ask the tenant about the bedroom window each morning.",
        "Record where the water appears.",
        "Note overnight humidity and heating.",
        "Check ventilation and when the room was occupied.",
        "Photograph visible mould and record any musty smell.",
      ],
    },
    {
      id: "c11t03",
      blocks: [
        "Give the landlord a short evidence-based report and first scope.",
        "Inspect moisture before major work.",
        "Record airflow and exhaust operation.",
        "Check the window and heating condition.",
        "Stage later upgrades separately from the maintenance checks.",
      ],
    },
    {
      id: "c19t01",
      blocks: [
        "Start with moisture control and record the window condensation.",
        "A suitable split system can heat the unit.",
        "Body corporate approval may be needed.",
        "Ask about the outdoor unit and wall opening.",
        "Confirm any common-property requirements before installation.",
      ],
    },
    {
      id: "c20t01",
      blocks: [
        "Start with moisture control: check the condensation, damp or mould and confirm the bathroom fan and airflow.",
        "Once the moisture source is understood, use a removable door snake for the front-door draught.",
        "These first checks keep the work practical within the $1,500 budget.",
        "Check approval before sealing common property or a fire-rated door.",
        "Use the remaining budget for close-fitting blinds or curtains on the single-glazed windows.",
      ],
    },
  ];

  for (const candidate of cases) {
    const turn = loaded.fixture.turns.find((item) => item.id === candidate.id);
    const fiveBlocks = candidate.blocks.join("\n\n");
    const practicalSteps = candidate.id === "c20t01" ? [candidate.blocks[0]] : [];
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: fiveBlocks,
      directAnswer: fiveBlocks,
      assistant: fiveBlocks,
      practicalSteps,
      practicalStepCount: practicalSteps.length,
    }), "paid"), [], candidate.id);
    const sixBlocks = `${fiveBlocks}\n\nThis sixth block is deliberately outside the reviewed format.`;
    assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: sixBlocks,
      directAnswer: sixBlocks,
      assistant: sixBlocks,
      practicalSteps,
      practicalStepCount: practicalSteps.length,
    }), "paid").includes("paragraph_limit"), candidate.id);
  }

  const moisturePriorityTurn = loaded.fixture.turns.find((item) => item.id === "c20t01");
  const doorFirst = "Start with the front-door draught, then address condensation and the single-glazed windows within the $1,500 budget.";
  assert.ok(evaluateSurgeTrajectoryTurn(moisturePriorityTurn, trajectoryObservation("c20t01", {
    visibleAnswer: doorFirst,
    directAnswer: doorFirst,
    assistant: doorFirst,
    practicalSteps: ["1. Start with the front-door draught."],
    practicalStepCount: 1,
  }), "paid").includes("clause:saved-moisture-priority-first"));
});

test("moisture-first wording accepts a natural priority sentence and working reverse-cycle unit", async () => {
  const durability = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const continuous = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const durabilityTurn = durability.fixture.turns.find((item) => item.id === "c20t04");
  const continuousTurn = continuous.fixture.turns.find((item) => item.id === "t50-long-range-home-synthesis");
  const answer = "Your first priority is condensation and moisture control within the $1,500 budget. Second, seal the front-door draught. Third, fit honeycomb blinds. Keep the reverse-cycle unit, which still heats properly.";
  const practicalSteps = [
    "1. Address moisture first by checking the condensation and bathroom airflow.",
    "2. Seal the front-door draught.",
    "3. Fit honeycomb blinds.",
  ];
  assert.deepEqual(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: answer,
    directAnswer: answer,
    assistant: answer,
    practicalSteps,
    practicalStepCount: practicalSteps.length,
  }), "paid"), []);

  const continuousObservation = trajectoryObservation(continuousTurn.id, {
    visibleAnswer: answer,
    directAnswer: answer,
    assistant: answer,
    practicalSteps,
    practicalStepCount: practicalSteps.length,
    continuation: {
      ...trajectoryObservation("context").continuation,
      activeTopic: "general",
      goal: "Top three home actions from saved answers in order",
    },
  });
  assert.deepEqual(evaluateSurgeTrajectoryTurn(continuousTurn, continuousObservation, "paid"), []);
  const longRangeAssertion = continuous.fixture.conversationAssertions.find((item) => (
    item.id === "final-long-range-home-memory"
  ));
  assert.deepEqual(evaluateSurgeConversationAssertions({
    ...continuous.fixture,
    turns: [continuousTurn],
    conversationAssertions: [longRangeAssertion],
  }, [continuousObservation]), []);

  const jargon = `${answer} Use psychrometric dew-point and hygrothermal analysis.`;
  assert.ok(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: jargon,
    directAnswer: jargon,
    assistant: jargon,
    practicalSteps,
    practicalStepCount: practicalSteps.length,
  }), "paid").some((failure) => failure.startsWith("forbidden:")));
  assert.ok(evaluateSurgeTrajectoryTurn(continuousTurn, {
    ...continuousObservation,
    visibleAnswer: jargon,
    directAnswer: jargon,
    assistant: jargon,
  }, "paid").some((failure) => failure.startsWith("forbidden:")));

  const openingWordGame = "Address moisture first? Absolutely not; seal the door first.";
  assert.ok(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: answer,
    directAnswer: answer,
    assistant: answer,
    practicalSteps: [openingWordGame, practicalSteps[1], practicalSteps[2]],
    practicalStepCount: 3,
  }), "paid").includes("clause:saved-moisture-priority-first"));

  const wrongStructuredOrder = "Start with moisture control within the $1,500 budget, then seal the front door and fit honeycomb blinds. Keep the reverse-cycle unit, which still heats properly.";
  assert.ok(evaluateSurgeTrajectoryTurn(continuousTurn, trajectoryObservation(continuousTurn.id, {
    visibleAnswer: wrongStructuredOrder,
    directAnswer: wrongStructuredOrder,
    assistant: wrongStructuredOrder,
    practicalSteps: [
      "1. Seal the front-door draught.",
      "2. Address moisture and condensation.",
      "3. Fit honeycomb blinds.",
    ],
    practicalStepCount: 3,
    continuation: continuousObservation.continuation,
  }), "paid").includes("clause:retains-moisture-first-priority"));
});

test("durability moisture priority accepts observed imperative first steps but rejects door-first order", async () => {
  const { fixture } = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const earlierObservedFirstStep = "Check recurring condensation, damp and mould… Address this before tightening the apartment.";
  const observedFirstSteps = {
    c20t01: [
      earlierObservedFirstStep,
      "Check that the bathroom fan removes air outside and use it whenever moisture is produced; investigate persistent damp or mould before tightening the apartment.",
    ],
    c20t04: [
      earlierObservedFirstStep,
      "Control condensation, damp and mould first by using the bathroom exhaust fan and fixing any leak or persistent mould source. This protects indoor air and avoids trapping moisture.",
    ],
  };
  const doorFirstStep = "Start with the front-door draught, then check recurring condensation, damp and mould.";
  const negatedFirstSteps = {
    c20t01: [
      "Check that the bathroom fan removes air outside; do not investigate persistent damp before tightening the apartment.",
      "Check that the bathroom fan removes air outside; you shouldn't investigate persistent damp before tightening the apartment.",
      "Check that the bathroom fan removes air outside; you cannot investigate persistent damp before tightening the apartment.",
      "Check that the bathroom fan removes air outside; you can't investigate persistent damp before tightening the apartment.",
      "Check that the bathroom fan removes air outside; investigate persistent damp, but not before tightening the apartment.",
    ],
    c20t04: ["Control condensation, but not first by using the bathroom exhaust fan; seal the front-door draught first."],
  };

  for (const turnId of ["c20t01", "c20t04"]) {
    const turn = fixture.turns.find((item) => item.id === turnId);
    for (const observedFirstStep of observedFirstSteps[turnId]) {
      const answer = turnId === "c20t01"
        ? `${observedFirstStep} Then use a removable door snake at the front door and fit close-fitting curtains to the single-glazed windows. Keep the work within the $1,500 budget.`
        : `${observedFirstStep} Then seal the front-door draught and fit honeycomb blinds to the single-glazed windows. Keep the working reverse-cycle split because it still heats properly. Use the $1,500 budget for these actions.`;
      const practicalSteps = [
        observedFirstStep,
        "Seal the front-door draught.",
        "Fit close-fitting window coverings.",
      ];
      const observation = trajectoryObservation(turnId, {
        visibleAnswer: answer,
        directAnswer: answer,
        assistant: answer,
        practicalSteps,
        practicalStepCount: practicalSteps.length,
      });

      assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, observation, "paid"), [], `${turnId}: ${observedFirstStep}`);
      assert.ok(evaluateSurgeTrajectoryTurn(turn, {
        ...observation,
        practicalSteps: [doorFirstStep, ...practicalSteps.slice(1)],
      }, "paid").includes("clause:saved-moisture-priority-first"), turnId);
      for (const negatedFirstStep of negatedFirstSteps[turnId]) {
        assert.ok(evaluateSurgeTrajectoryTurn(turn, {
          ...observation,
          practicalSteps: [negatedFirstStep, ...practicalSteps.slice(1)],
        }, "paid").includes("clause:saved-moisture-priority-first"), `${turnId}: ${negatedFirstStep}`);
      }
    }
  }
});

test("a superseded under-two-thousand budget cannot remain current", async () => {
  const durability = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const continuous = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const durabilityTurn = durability.fixture.turns.find((item) => item.id === "c20t01");
  const current = "Start with condensation control within the $1,500 budget. Then seal the front-door draught and fit a blind to the single-glazed window.";
  const prioritySteps = ["1. Start with condensation control."];
  assert.deepEqual(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: current,
    directAnswer: current,
    assistant: current,
    practicalSteps: prioritySteps,
    practicalStepCount: prioritySteps.length,
  }), "paid"), []);
  const stale = `${current} Your current overall budget also remains Under $2,000.`;
  assert.ok(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: stale,
    directAnswer: stale,
    assistant: stale,
    practicalSteps: prioritySteps,
    practicalStepCount: prioritySteps.length,
  }), "paid").some((failure) => failure.startsWith("forbidden:")));
  const corrected = "Start with condensation control. The old figure Under $2,000 was replaced with the current $1,500 budget. Then seal the front-door draught and fit a blind to the single-glazed window.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(durabilityTurn, trajectoryObservation(durabilityTurn.id, {
    visibleAnswer: corrected,
    directAnswer: corrected,
    assistant: corrected,
    practicalSteps: prioritySteps,
    practicalStepCount: prioritySteps.length,
  }), "paid"), []);

  const cases = [{
    id: "t20-budget-three-options",
    currentAnswer: "Use the $1,500 on blinds first. Leave the solar deposit until strata approval and keep the split because it still works.",
    goal: "$1,500 blinds solar split",
  }, {
    id: "t31-return-own-apartment-budget",
    currentAnswer: "With $1,500, blinds still make sense for the cold single-glazed windows. Keep the existing split because it still heats.",
    goal: "Apartment $1,500 blinds",
  }];
  for (const candidate of cases) {
    const turn = continuous.fixture.turns.find((item) => item.id === candidate.id);
    const continuation = {
      ...trajectoryObservation("context").continuation,
      activeTopic: "general",
      goal: candidate.goal,
    };
    assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: candidate.currentAnswer,
      directAnswer: candidate.currentAnswer,
      assistant: candidate.currentAnswer,
      continuation,
    }), "paid"), [], candidate.id);
    const staleAnswer = `${candidate.currentAnswer} The current overall budget is also Under $2,000.`;
    assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: staleAnswer,
      directAnswer: staleAnswer,
      assistant: staleAnswer,
      continuation,
    }), "paid").some((failure) => failure.startsWith("forbidden:")), candidate.id);
  }
});

test("a correction may name the superseded quote price only as an explicit historical exclusion", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "c06t03");
  const corrected = "Correction applied: Quote A and Quote B are both $6,900. At the same price, compare the warranty and installation scope. The earlier $7,400 price for B is excluded.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: corrected,
    directAnswer: corrected,
    assistant: corrected,
  }), "paid"), []);
  const directNegation = "With both quotes at $6,900, B offers better warranty value. Correction noted: Quote B is $6,900, not $7,400. Compare warranty coverage and installation scope.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: directNegation,
    directAnswer: directNegation,
    assistant: directNegation,
  }), "paid"), []);
  const noLonger = "Both quotes are $6,900. Quote B is no longer $7,400. Compare warranty coverage and installation scope.";
  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: noLonger,
    directAnswer: noLonger,
    assistant: noLonger,
  }), "paid"), []);
  const stale = "Quote A is $6,900, but Quote B is $7,400. Compare the warranty and installation scope.";
  assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: stale,
    directAnswer: stale,
    assistant: stale,
  }), "paid").some((failure) => failure.startsWith("forbidden:")));
  const notOnly = "Quote A is $6,900. Quote B is not only well covered; Quote B is $7,400. Compare the warranty and installation scope.";
  assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: notOnly,
    directAnswer: notOnly,
    assistant: notOnly,
  }), "paid").some((failure) => failure.startsWith("forbidden:")));
  const unrelatedNegation = "Both quotes are $6,900. B is not expensive at $7,400. Compare warranty coverage and installation scope.";
  assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: unrelatedNegation,
    directAnswer: unrelatedNegation,
    assistant: unrelatedNegation,
  }), "paid").some((failure) => failure.startsWith("forbidden:")));
});

test("unresolved switchboard scope cannot pass with an affirmative fixed price", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "c13t03");
  const opposite = "The finance gap is $188 and the admin fee is $330. The switchboard has a fixed price or cap.";
  assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: opposite,
    directAnswer: opposite,
    assistant: opposite,
  }), "paid").some((failure) => failure === "clause:returns-switchboard" || failure.startsWith("forbidden:")));
});

test("three requested unresolved points require three structured practical steps", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "c13t03");
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "three-unresolved-points-are-structured"
  ));
  const fixture = { ...loaded.fixture, turns: [turn], conversationAssertions: [assertion] };
  const answer = "The three unresolved points are the $188 finance shortfall, the $330 admin fee and extra unpriced switchboard work.";
  const structured = trajectoryObservation(turn.id, {
    visibleAnswer: answer,
    directAnswer: answer,
    assistant: answer,
    practicalStepCount: 3,
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [structured]), []);

  const proseOnly = { ...structured, practicalStepCount: 0 };
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [proseOnly]).map((item) => item.code),
    ["structured_action_count"],
  );
});

test("trajectory tail preserves quote state and uses structured action counting", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const feeTurn = loaded.fixture.turns.find((turn) => turn.id === "t42-fee-330");
  const interruptionTurn = loaded.fixture.turns.find((turn) => turn.id === "t43-off-scope-recipe");
  const installerTurn = loaded.fixture.turns.find((turn) => turn.id === "t49-best-installer-neutrality");
  const finalTurn = loaded.fixture.turns.find((turn) => turn.id === "t50-long-range-home-synthesis");
  assert.deepEqual(interruptionTurn.state, feeTurn.state);
  assert.ok(installerTurn.clauses.find((clause) => clause.id === "no-unverified-best")
    .anyOf.some((pattern) => new RegExp(pattern, "i").test("Surge does not rank installers.")));
  assert.equal(finalTurn.clauses.some((clause) => clause.id === "exact-three-actions"), false);
  assert.equal(loaded.fixture.conversationAssertions.find((item) => (
    item.id === "final-long-range-home-memory"
  )).exactActionCount, 3);
});

test("trajectory fixture accepts safe negation and practical existing window coverings", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const draughtTurn = loaded.fixture.turns.find((turn) => turn.id === "t07-find-other-air-leaks");
  const coldGlassTurn = loaded.fixture.turns.find((turn) => turn.id === "t08-cold-glass-without-wind");
  assert.ok(draughtTurn);
  assert.ok(coldGlassTurn);

  const matchesForbidden = (answer) => draughtTurn.forbiddenPatterns.some((pattern) => (
    new RegExp(pattern, "i").test(answer)
  ));
  assert.equal(matchesForbidden("Do not seal exhausts, wall vents, chimneys or flues."), false);
  assert.equal(matchesForbidden("Seal the wall vent to stop the draught."), true);
  assert.equal(matchesForbidden("You should seal the chimney opening."), true);

  const coveringClause = coldGlassTurn.clauses.find((clause) => clause.id === "covering-option");
  assert.ok(coveringClause);
  assert.equal(coveringClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("Tonight, close your existing blinds or curtains.")
  )), true);
});

test("turn evaluation does not break an exact anchored answer with an empty follow-up", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "t36-finance-yes-no");
  const observation = trajectoryObservation(turn.id, {
    visibleAnswer: "No.",
    directAnswer: "No.",
    assistant: "No.",
    answerSource: "deterministic",
    continuation: {
      ...trajectoryObservation(turn.id).continuation,
      activeTopic: "heat_pump_hot_water",
      goal: "Check whether the finance total matches the quote",
      pendingQuestion: "",
    },
  });
  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, observation, "paid"), []);
});

test("turn evaluation rejects a customer-visible trailing fragment", async () => {
  const { fixture } = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = fixture.turns[0];
  const observation = trajectoryObservation(turn.id, {
    visibleAnswer: `${"Check the written scope and exclusions carefully. ".repeat(3)}Check that the`,
  });
  assert.ok(evaluateSurgeTrajectoryTurn(turn, observation, "scripted").includes("incomplete_visible_answer"));
});

test("global source privacy rejects disclosure but accepts an explicit non-disclosure", async () => {
  for (const path of [
    "test/fixtures/surge-conversation-durability-20.json",
    "test/fixtures/surge-conversation-trajectory-50.json",
  ]) {
    const loaded = await loadSurgeConversationTrajectoryFixture(path);
    const assertion = loaded.fixture.conversationAssertions.find((item) => (
      item.id === "never-surface-generic-fallback"
    ));
    const fixture = { ...loaded.fixture, turns: [], conversationAssertions: [assertion] };
    const disclosed = trajectoryObservation("privacy", {
      visibleAnswer: "According to our proprietary internal source pack, this is the best order.",
    });
    assert.deepEqual(
      evaluateSurgeConversationAssertions(fixture, [disclosed]).map((item) => item.code),
      ["forbidden_pattern"],
      path,
    );

    const protectedAnswer = trajectoryObservation("privacy", {
      visibleAnswer: "I won't reveal any proprietary internal source pack; I can give you the practical answer and public official link.",
    });
    assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [protectedAnswer]), [], path);
  }
});

test("official lookup assertions require a citation or a responsible unavailable answer", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "current-fact-uses-official-lookup"
  ));
  const turn = loaded.fixture.turns.find((item) => item.id === "t40-current-certificate-values");
  const fixture = { ...loaded.fixture, turns: [turn], conversationAssertions: [assertion] };
  const cited = trajectoryObservation(turn.id, {
    citationCount: 1,
    officialCitationUrls: ["https://cer.gov.au/"],
    officialCitationHosts: ["cer.gov.au"],
    officialWebLookupRequested: true,
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [cited]), []);

  const unsupported = trajectoryObservation(turn.id);
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [unsupported]).map((item) => item.code),
    ["official_evidence_missing"],
  );

  const unavailable = trajectoryObservation(turn.id, {
    answerSource: "deterministic",
    visibleAnswer: "I could not verify today's official certificate information, so I cannot confirm it.",
    modelFailureCode: "official_web_unavailable",
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [unavailable]), []);

  const paidRecovery = trajectoryObservation(turn.id, {
    answerSource: "model",
    officialWebLookupRequested: true,
    citationCount: 0,
    officialCitationUrls: [],
    officialCitationHosts: [],
    visibleAnswer: "I could not verify today's official certificate value. Check the system size, installation date and postcode on the official programme page before relying on an estimate.",
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [paidRecovery]), []);
});

test("official reference assertions distinguish maintained links from live lookup", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "official-directories-use-reviewed-references"
  ));
  const turn = loaded.fixture.turns.find((item) => item.id === "c09t03");
  const fixture = { ...loaded.fixture, turns: [turn], conversationAssertions: [assertion] };
  const maintained = trajectoryObservation(turn.id, {
    citationCount: 2,
    officialCitationUrls: ["https://cer.gov.au/", "https://esc.vic.gov.au/"],
    officialCitationHosts: ["cer.gov.au", "esc.vic.gov.au"],
    answerSource: "model",
    officialWebLookupRequested: false,
    visibleAnswer: "Use the Clean Energy Regulator for STCs and the Essential Services Commission for VEECs.",
    directAnswer: "Use the Clean Energy Regulator for STCs and the Essential Services Commission for VEECs.",
    assistant: "Use the Clean Energy Regulator for STCs and the Essential Services Commission for VEECs.",
  });
  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, maintained, "paid"), []);
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [maintained]), []);

  const mislabeledLiveLookup = {
    ...maintained,
    officialWebLookupRequested: true,
  };
  assert.deepEqual(
    evaluateSurgeTrajectoryTurn(turn, mislabeledLiveLookup, "paid"),
    ["official_reference_required"],
  );
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [mislabeledLiveLookup]).map((item) => item.code),
    ["official_reference_missing"],
  );
});

test("official reference scoring requires the relevant direct pages and both certificate sources", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "official-links-match-the-request"
  ));
  const turns = loaded.fixture.turns.filter((item) => ["c08t02", "c09t03"].includes(item.id));
  const fixture = { ...loaded.fixture, turns, conversationAssertions: [assertion] };
  const heatingUrl = "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/heating-and-cooling-discounts";
  const stcUrl = "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements";
  const veecUrl = "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Water%20Heating%20and%20Space%20Heating%20Cooling%20Activity%20Guide%20-%20V.%203.19%20-%2020260324.pdf";
  const correct = [
    trajectoryObservation("c08t02", {
      citationCount: 1,
      officialCitationUrls: [heatingUrl],
      officialCitationHosts: ["www.energy.vic.gov.au"],
    }),
    trajectoryObservation("c09t03", {
      citationCount: 2,
      officialCitationUrls: [stcUrl, veecUrl],
      officialCitationHosts: ["cer.gov.au", "www.esc.vic.gov.au"],
    }),
  ];
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, correct), []);

  const genericOrIncomplete = [
    trajectoryObservation("c08t02", {
      citationCount: 1,
      officialCitationUrls: ["https://www.energy.vic.gov.au/"],
      officialCitationHosts: ["www.energy.vic.gov.au"],
    }),
    trajectoryObservation("c09t03", {
      citationCount: 2,
      officialCitationUrls: ["https://cer.gov.au/", "https://www.energy.vic.gov.au/"],
      officialCitationHosts: ["cer.gov.au", "www.energy.vic.gov.au"],
    }),
  ];
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, genericOrIncomplete).map((item) => [item.turnId, item.code]),
    [
      ["c08t02", "official_citation_relevance"],
      ["c09t03", "official_citation_relevance"],
    ],
  );

  const oneCertificateSource = [correct[0], {
    ...correct[1],
    citationCount: 1,
    officialCitationUrls: [stcUrl],
    officialCitationHosts: ["cer.gov.au"],
  }];
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, oneCertificateSource).map((item) => [item.turnId, item.code]),
    [["c09t03", "official_citation_relevance"]],
  );
});

test("correction assertions ignore historical user context but still catch stale current facts", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "corrections-replace-stale-context"
  ));
  const turns = loaded.fixture.turns.filter((item) => ["c02t02", "c02t03"].includes(item.id));
  const fixture = { ...loaded.fixture, turns, conversationAssertions: [assertion] };
  const baseContinuation = trajectoryObservation("c02t03").continuation;
  const corrected = trajectoryObservation("c02t03", {
    conversationId: "c02",
    visibleAnswer: "Use the corrected 45-minute result and check the airflow.",
    continuation: {
      ...baseContinuation,
      goal: "Originally 20 minutes, corrected to 45 minutes.",
      facts: [{ key: "fogging_duration", value: "45 minutes" }],
      ledger: {
        ...baseContinuation.ledger,
        decisions: [{
          ...baseContinuation.ledger.decisions[0],
          goal: "Originally 20 minutes, corrected to 45 minutes.",
          facts: [
            { key: "user_context", value: "Originally 20 minutes, corrected to 45 minutes." },
            { key: "fogging_duration", value: "45 minutes" },
          ],
        }],
      },
    },
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [corrected]), []);

  const stale = {
    ...corrected,
    continuation: {
      ...corrected.continuation,
      facts: [{ key: "fogging_duration", value: "20 minutes" }],
    },
  };
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [stale]).map((item) => item.code),
    ["stale_correction"],
  );
});

test("conversation assertions enforce corrections, property boundaries and interruption recovery", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const wanted = new Set([
    "corrections-replace-stale-context",
    "off-scope-interruption-does-not-erase-quote",
    "service-location-is-scoped-not-global",
  ]);
  const fixture = {
    ...loaded.fixture,
    conversationAssertions: loaded.fixture.conversationAssertions.filter((item) => wanted.has(item.id)),
  };
  const quoteState = trajectoryObservation("state").continuation;
  quoteState.activeTopic = "heat_pump_hot_water";
  quoteState.goal = "Is the $330 admin fee reasonable?";
  const serviceState = structuredClone(quoteState);
  serviceState.ledger.subjects = [
    { id: "saved_home", kind: "saved_home", label: "Saved home", facts: [{ key: "postcode", value: "3072" }] },
    { id: "mums_home", kind: "named_home", label: "Mum's home", facts: [{ key: "postcode", value: "3073" }] },
  ];
  serviceState.ledger.activeDecisionId = "decision_mum";
  serviceState.ledger.decisions.push({
    ...serviceState.ledger.decisions[0],
    id: "decision_mum",
    subjectIds: ["mums_home"],
  });
  const savedReturnState = structuredClone(serviceState);
  savedReturnState.ledger.activeDecisionId = "decision_saved";
  const observations = [
    trajectoryObservation("t37-correct-monthly-payment", { visibleAnswer: "It is $68, not $58." }),
    trajectoryObservation("t38-switchboard-still-extra", { visibleAnswer: "Yes, it is $188 short." }),
    trajectoryObservation("t42-fee-330", { continuation: structuredClone(quoteState) }),
    trajectoryObservation("t43-off-scope-recipe", { continuation: structuredClone(quoteState) }),
    trajectoryObservation("t44-return-overall-quote-verdict", {
      visibleAnswer: "The finance is $188 short, the admin fee is $330 and switchboard work is extra.",
      continuation: structuredClone(quoteState),
    }),
    trajectoryObservation("t47-correct-service-property-postcode", { continuation: serviceState }),
    trajectoryObservation("t50-long-range-home-synthesis", { continuation: savedReturnState }),
  ];
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, observations), []);

  const corrupted = observations.map((item) => structuredClone(item));
  corrupted.find((item) => item.turnId === "t43-off-scope-recipe").continuation.goal = "Scone recipe";
  corrupted.find((item) => item.turnId === "t44-return-overall-quote-verdict").visibleAnswer += " The old $58 figure applies.";
  corrupted.find((item) => item.turnId === "t47-correct-service-property-postcode")
    .continuation.ledger.subjects.find((item) => item.id === "saved_home").facts[0].value = "3073";
  assert.deepEqual(
    new Set(evaluateSurgeConversationAssertions(fixture, corrupted).map((item) => item.code)),
    new Set(["stale_correction", "interruption_changed_state", "property_boundary"]),
  );
});

test("long-range recall asserts structured practical steps rather than rendered numbering", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "final-long-range-home-memory"
  ));
  const turn = loaded.fixture.turns.find((item) => item.id === assertion.turn);
  const fixture = { ...loaded.fixture, turns: [turn], conversationAssertions: [assertion] };
  const moisturePriorityClause = turn.clauses.find((item) => item.id === "retains-moisture-first-priority");
  const initialMoisturePriorityClause = loaded.fixture.turns
    .find((item) => item.id === "t01-saved-home-start")
    .clauses.find((item) => item.id === "saved-moisture-priority-first");
  const acceptedNaturalFirstSteps = [
    "Check recurring condensation, damp and mould… Address this before tightening the apartment.",
    "Check that the bathroom fan removes air outside and use it whenever moisture is produced; investigate persistent damp or mould before tightening the apartment.",
    "Control condensation, damp and mould first by using the bathroom exhaust fan and fixing any leak or persistent mould source. This protects indoor air and avoids trapping moisture.",
  ];
  const negatedNaturalFirstSteps = [
    "Check that the bathroom fan removes air outside; do not investigate persistent damp before tightening the apartment.",
    "Check that the bathroom fan removes air outside; you shouldn't investigate persistent damp before tightening the apartment.",
    "Check that the bathroom fan removes air outside; you cannot investigate persistent damp before tightening the apartment.",
    "Check that the bathroom fan removes air outside; you can't investigate persistent damp before tightening the apartment.",
    "Check that the bathroom fan removes air outside; investigate persistent damp, but not before tightening the apartment.",
    "Control condensation, but not first by using the bathroom exhaust fan.",
  ];
  for (const clause of [initialMoisturePriorityClause, moisturePriorityClause]) {
    for (const firstStep of acceptedNaturalFirstSteps) {
      assert.equal(clause.anyOf.some((pattern) => new RegExp(pattern, "i").test(firstStep)), true, firstStep);
    }
    for (const firstStep of negatedNaturalFirstSteps) {
      assert.equal(clause.anyOf.some((pattern) => new RegExp(pattern, "i").test(firstStep)), false, firstStep);
    }
    assert.equal(clause.anyOf.some((pattern) => (
      new RegExp(pattern, "i").test("Start with the front-door draught, then check recurring condensation and damp.")
    )), false);
  }
  assert.equal(moisturePriorityClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("For your apartment, start with the windows, then moisture control, then the front-door gap.")
  )), false);
  assert.equal(moisturePriorityClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("For your apartment, start by checking the bathroom fan and condensation first.")
  )), true);
  assert.equal(moisturePriorityClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("For your apartment and under $1,500 budget, tackle moisture first, then cold windows, then the door draught.")
  )), true);
  assert.equal(assertion.forbidden.some((pattern) => new RegExp(pattern, "i").test("Under $2,000")), false);
  assert.equal(assertion.forbidden.some((pattern) => new RegExp(pattern, "i").test("Mum's home")), true);
  assert.equal(turn.forbiddenPatterns.some((pattern) => new RegExp(pattern, "i").test("Under $2,000")), true);
  const answer = trajectoryObservation(turn.id, {
    visibleAnswer: "Start with moisture control within the $1,500 budget. Seal under the front door. Add honeycomb blinds. Keep the working split.",
    practicalStepCount: 3,
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [answer]), []);

  answer.practicalStepCount = 2;
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [answer]).map((item) => item.code),
    ["structured_action_count"],
  );
});

test("quantity grounding accepts disclosed finance arithmetic but rejects invented amounts", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "no-invented-quantities"
  ));
  const turn = loaded.fixture.turns.find((item) => item.id === "t35-hot-water-finance-compound");
  const fixture = { ...loaded.fixture, turns: [turn], conversationAssertions: [assertion] };
  const grounded = trajectoryObservation(turn.id, {
    message: turn.message,
    visibleAnswer: "$58 a month for 7 years is $4,872, leaving a $1,028 gap from $5,900.",
  });
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, [grounded]), []);

  grounded.visibleAnswer += " The unrelated fee is $777.";
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, [grounded]).map((item) => item.code),
    ["quantity_not_grounded"],
  );
});

test("quantity grounding treats hyphenated number-word durations as supplied values", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "no-invented-quantities"
  ));
  const turns = loaded.fixture.turns.filter((item) => ["c06t01", "c06t02"].includes(item.id));
  const fixture = { ...loaded.fixture, turns, conversationAssertions: [assertion] };
  const observations = [
    trajectoryObservation("c06t01", {
      conversationId: "c06",
      message: turns[0].message,
      visibleAnswer: "Quote A is $6,900 with a five-year warranty and Quote B is $7,400 with a seven-year warranty.",
    }),
    trajectoryObservation("c06t02", {
      conversationId: "c06",
      message: turns[1].message,
      visibleAnswer: "The seven-year warranty is two years longer than the five-year warranty, but that alone does not justify the $500 difference.",
    }),
  ];

  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, observations), []);

  observations[1].visibleAnswer += " There is also a $5 processing fee.";
  assert.deepEqual(
    evaluateSurgeConversationAssertions(fixture, observations).map((item) => item.code),
    ["quantity_not_grounded"],
  );
});

test("quantity grounding recognises a unitless HVAC setpoint across its immediate follow-up only", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-trajectory-50.json",
  );
  const assertion = loaded.fixture.conversationAssertions.find((item) => (
    item.id === "no-invented-quantities"
  ));
  const turns = loaded.fixture.turns.filter((item) => (
    ["t17-back-home-split-bill", "t18-filter-clean-24", "t19-replace-working-split"].includes(item.id)
  ));
  const fixture = { ...loaded.fixture, turns, conversationAssertions: [assertion] };
  const rcacContinuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "rcac",
    goal: "Check whether the reverse-cycle split is faulty or simply running more",
  };
  const observations = [
    trajectoryObservation(turns[0].id, {
      message: turns[0].message,
      visibleAnswer: "The bill increase alone does not prove the reverse-cycle split is faulty.",
      continuation: rcacContinuation,
    }),
    trajectoryObservation(turns[1].id, {
      message: turns[1].message,
      visibleAnswer: "Check the indoor and outdoor airflow, then watch for icing, noise or error codes.",
      continuation: rcacContinuation,
    }),
    trajectoryObservation(turns[2].id, {
      message: turns[2].message,
      visibleAnswer: "No, not yet. The 24°C setting can increase consumption even when the unit is working normally.",
      continuation: rcacContinuation,
    }),
  ];
  assert.deepEqual(evaluateSurgeConversationAssertions(fixture, observations), []);

  const rejectedContexts = [
    {
      messages: ["I set the reverse-cycle timer to 24 minutes.", "Should I replace it?"],
      activeTopic: "rcac",
      goal: "Check the reverse-cycle timer",
    },
    {
      messages: ["I set the battery reserve to 24.", "Should I replace it?"],
      activeTopic: "battery_vpp",
      goal: "Choose a battery reserve setting",
    },
    {
      messages: [
        "My reverse-cycle split is working normally.",
        "New topic: my home battery. I set it to 24.",
        "Should I replace it?",
      ],
      activeTopic: "rcac",
      goal: "Check whether the reverse-cycle split should be replaced",
    },
  ];
  for (const [index, item] of rejectedContexts.entries()) {
    const negativeFixture = {
      ...loaded.fixture,
      turns: item.messages.map((_, messageIndex) => ({
        id: `negative-${index}-${messageIndex + 1}`,
      })),
      conversationAssertions: [assertion],
    };
    const negativeObservations = item.messages.map((message, messageIndex) => trajectoryObservation(
      `negative-${index}-${messageIndex + 1}`,
      {
        message,
        visibleAnswer: messageIndex < item.messages.length - 1
          ? "That setting needs context."
          : "Check whether the room reaches 24°C.",
        continuation: {
          ...trajectoryObservation("context").continuation,
          activeTopic: item.activeTopic,
          goal: item.goal,
        },
      },
    ));
    assert.deepEqual(
      evaluateSurgeConversationAssertions(negativeFixture, negativeObservations).map((failure) => failure.code),
      ["quantity_not_grounded"],
      item.messages[0],
    );
  }
});

test("trajectory rejection diagnostics are bounded and redact credential-shaped text", () => {
  const fakeKey = ["sk", "proj", "abcdefghijklmnop"].join("-");
  const fakeBearer = ["Bearer", "abcdefghijklmnop"].join(" ");
  const fakeEnvironmentValue = ["OPENAI_API_KEY", "abcdefghijklmnop"].join("=");
  const diagnostic = sanitizeTrajectoryRejectionDiagnostic({
    stage: "topic_drift",
    visibleCandidate: `Candidate ${fakeKey} ${fakeBearer} ${fakeEnvironmentValue}\u0000`,
    answerWordCount: 42,
    visibleBlockCount: 3,
    questionPartCount: 2,
    declaredCoveredQuestionPartCount: 1,
    completeQuestionCoverage: false,
    quantitiesGrounded: true,
    suppliedQuestionQuantitiesPreserved: true,
    everydayLanguagePassed: true,
    ignoredProviderPayload: { unsafe: fakeKey },
  });

  assert.deepEqual(Object.keys(diagnostic), [
    "stage",
    "visibleCandidate",
    "answerWordCount",
    "visibleBlockCount",
    "questionPartCount",
    "declaredCoveredQuestionPartCount",
    "completeQuestionCoverage",
    "quantitiesGrounded",
    "suppliedQuestionQuantitiesPreserved",
    "everydayLanguagePassed",
  ]);
  assert.equal(diagnostic.stage, "topic_drift");
  assert.match(diagnostic.visibleCandidate, /\[REDACTED\]/);
  assert.doesNotMatch(diagnostic.visibleCandidate, /sk-proj|abcdefghijklmnop|\u0000/i);
  assert.equal(diagnostic.answerWordCount, 42);
  assert.equal(sanitizeTrajectoryRejectionDiagnostic({
    stage: "topic_drift",
    visibleCandidate: "Yes, close-fitting curtains with a pelmet can help.",
  }).visibleCandidate, "Yes, close-fitting curtains with a pelmet can help.");
  assert.equal(sanitizeTrajectoryRejectionDiagnostic(null), null);
});

test("trajectory runner requires an explicit paid budget and one execution mode", () => {
  assert.throws(
    () => parseSurgeConversationTrajectoryArgs([
      "--fixture", "test/fixtures/trajectory.json",
      "--run-label", "paid-without-budget",
      "--confirm-paid",
    ]),
    /explicit --budget-micro-usd/i,
  );
  assert.throws(
    () => parseSurgeConversationTrajectoryArgs([
      "--fixture", "test/fixtures/trajectory.json",
      "--run-label", "ambiguous-mode",
      "--scripted",
      "--confirm-paid",
    ]),
    /exactly one/i,
  );
  assert.equal(parseSurgeConversationTrajectoryArgs([
    "--fixture", "test/fixtures/trajectory.json",
    "--run-label", "bounded-paid-run",
    "--budget-micro-usd", "16000000",
    "--confirm-paid",
  ]).budgetMicroUsd, 16_000_000);
});

test("trajectory context mirrors the widget twelve-turn rolling contract", () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}-${"x".repeat(20)}`,
  }));
  const recent = recentTurnsForTrajectory(messages);
  assert.equal(recent.length, 12);
  assert.equal(recent[0].role, "user");
  assert.match(recent[0].content, /^4-/);
  assert.match(recent.at(-1).content, /^15-/);
});

test("trajectory context enforces the 9000-character budget and starts with a user", () => {
  const messages = [
    { role: "assistant", content: "old assistant" },
    { role: "user", content: `first-${"a".repeat(2_590)}` },
    { role: "assistant", content: `reply-${"b".repeat(2_590)}` },
    { role: "user", content: `second-${"c".repeat(2_590)}` },
    { role: "assistant", content: `reply-${"d".repeat(2_590)}` },
  ];
  const recent = recentTurnsForTrajectory(messages);
  assert.equal(recent[0].role, "user");
  assert.ok(recent.reduce((total, turn) => total + turn.content.length, 0) <= 9_000);
  assert.doesNotMatch(JSON.stringify(recent), /first-/);
});

test("version two trajectories reset raw history and continuation only between conversations", () => {
  const firstContinuation = trajectoryObservation("c01t03-end").continuation;
  const state = {
    observations: [{
      conversationId: "c01",
      turnId: "c01t03-end",
      message: "Previous conversation",
      assistant: "Previous answer",
    }],
    recentTurns: [
      { role: "user", content: "Previous conversation" },
      { role: "assistant", content: "Previous answer" },
    ],
    continuation: firstContinuation,
  };
  const fixture = { version: 2 };

  resetSurgeTrajectoryStateAtConversationBoundary(
    fixture,
    { conversationId: "c01" },
    state,
  );
  assert.equal(state.continuation, firstContinuation);
  assert.equal(state.recentTurns.length, 2);

  resetSurgeTrajectoryStateAtConversationBoundary(
    fixture,
    { conversationId: "c02" },
    state,
  );
  assert.equal(state.continuation, null);
  assert.deepEqual(state.recentTurns, []);
});
