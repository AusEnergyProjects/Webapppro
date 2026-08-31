import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("zero-export durability clauses require affirmative home self-use", async () => {
  const loaded = await loadSurgeConversationTrajectoryFixture(
    "test/fixtures/surge-conversation-durability-20.json",
  );
  const turn = loaded.fixture.turns.find((item) => item.id === "c04t02");
  const affirmative = "Zero export means the system cannot send surplus solar electricity to the grid. Your home can still use the 6.6 kW array output as it is generated.";
  const opposites = [
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home cannot use the array output.",
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home can never use the array output.",
    "Zero export means the system cannot send surplus solar electricity to the grid. Your home may not use the solar generation.",
  ];
  const solarContinuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "solar",
    goal: "Check what zero export changes for the solar quote",
  };

  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: affirmative,
    directAnswer: affirmative,
    assistant: affirmative,
    continuation: solarContinuation,
  }), "paid"), []);
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
  const affirmative = "Zero export means the system cannot send surplus electricity to the grid. The system may generate for household use, while any extra is curtailed.";
  const opposites = [
    "Zero export means the system cannot send surplus electricity to the grid. The system cannot generate for household use.",
    "Your home cannot use the solar generation. A later sentence mentions home use and solar without affirming either.",
    "Zero export means the system cannot send surplus electricity to the grid. You cannot use it directly.",
    "Zero export means the system cannot send surplus electricity to the grid. It is not still useful.",
  ];
  const solarContinuation = {
    ...trajectoryObservation("context").continuation,
    activeTopic: "solar",
    goal: "Check what zero export changes for the solar quote",
  };

  assert.deepEqual(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
    visibleAnswer: affirmative,
    directAnswer: affirmative,
    assistant: affirmative,
    continuation: solarContinuation,
  }), "paid"), []);
  for (const opposite of opposites) {
    assert.ok(evaluateSurgeTrajectoryTurn(turn, trajectoryObservation(turn.id, {
      visibleAnswer: opposite,
      directAnswer: opposite,
      assistant: opposite,
      continuation: solarContinuation,
    }), "paid").some((failure) => failure === "clause:solar-still-useful" || failure.startsWith("forbidden:")), opposite);
  }
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
  assert.equal(moisturePriorityClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("For your apartment, start with the windows, then moisture control, then the front-door gap.")
  )), false);
  assert.equal(moisturePriorityClause.anyOf.some((pattern) => (
    new RegExp(pattern, "i").test("For your apartment, start by checking the bathroom fan and condensation first.")
  )), true);
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
