import assert from "node:assert/strict";
import test from "node:test";
import {
  createSurgeRegressionCacheKey,
  createSurgeRegressionRunIdentity,
  loadSurgeRegressionFixture,
  parseSurgeRegressionArgs,
  sanitizeSurgeRegressionRejectionDiagnostic,
  selectSurgeRegressionCases,
  surgeRegressionObservationIsValid,
  validateSurgeRegressionFixture,
} from "../scripts/run-surge-response-regression.mjs";

const HELDOUT_FIXTURE_PATH = "test/fixtures/surge-heldout-customer-2026-08-29.json";

const CASE = {
  id: "case-1",
  question: "Should I replace my gas heater?",
  recentTurns: [],
  planContext: null,
};

function identity(overrides = {}) {
  return createSurgeRegressionRunIdentity({
    runLabel: "release-candidate",
    execution: "real-model",
    sourceFingerprint: "source-a",
    model: "gpt-5.6-sol",
    ...overrides,
  });
}

test("checkpoint identity is bound to code fingerprint and model, not the label alone", () => {
  const baseline = identity();
  assert.notEqual(baseline, identity({ sourceFingerprint: "source-b" }));
  assert.notEqual(baseline, identity({ model: "another-model" }));
  assert.notEqual(baseline, identity({ execution: "dry-run" }));
  assert.notEqual(baseline, identity({ runLabel: "another-release" }));
});

test("cache keys are bound to the full case payload and run identity", () => {
  const baseline = createSurgeRegressionCacheKey(identity(), CASE);
  assert.notEqual(
    baseline,
    createSurgeRegressionCacheKey(identity({ sourceFingerprint: "source-b" }), CASE),
  );
  assert.notEqual(
    baseline,
    createSurgeRegressionCacheKey(identity(), { ...CASE, question: "Should I replace my gas hot water?" }),
  );
  assert.notEqual(
    baseline,
    createSurgeRegressionCacheKey(identity(), { ...CASE, recentTurns: [{ role: "user", content: "It is old." }] }),
  );
});

test("checkpoint observations retain bounded model rejection stages", () => {
  const observation = {
    caseId: "case-1",
    httpStatus: 200,
    visibleAnswer: "A direct answer.",
    content: "A direct answer.",
    directAnswer: "A direct answer.",
    followUpQuestion: "",
    quickReplies: [],
    estimatedMicroUsd: 1,
    modelReservations: 1,
    modelAttempted: true,
    modelFailureCode: "provider_output_rejected",
    modelFailureStage: "question_coverage",
    modelRejectionDiagnostic: null,
    answerSource: "deterministic",
    budgetDenied: false,
  };
  assert.equal(surgeRegressionObservationIsValid(observation, "case-1"), true);
  assert.equal(surgeRegressionObservationIsValid({
    ...observation,
    modelFailureStage: undefined,
  }, "case-1"), false);
  assert.equal(surgeRegressionObservationIsValid({
    ...observation,
    modelRejectionDiagnostic: undefined,
  }, "case-1"), false);
  const diagnostic = sanitizeSurgeRegressionRejectionDiagnostic({
    stage: "question_coverage",
    visibleCandidate: "A bounded candidate.",
    answerWordCount: 3,
    visibleBlockCount: 1,
    questionPartCount: 2,
    declaredCoveredQuestionPartCount: 1,
    completeQuestionCoverage: false,
    quantitiesGrounded: true,
    suppliedQuestionQuantitiesPreserved: true,
    everydayLanguagePassed: true,
  });
  assert.equal(surgeRegressionObservationIsValid({
    ...observation,
    modelRejectionDiagnostic: diagnostic,
  }, "case-1"), true);
  assert.equal(surgeRegressionObservationIsValid({
    ...observation,
    modelRejectionDiagnostic: { ...diagnostic, rawProviderPayload: "not allowed" },
  }, "case-1"), false);
});

test("rejection diagnostics are bounded, redacted and stripped to reviewed fields", () => {
  const diagnostic = sanitizeSurgeRegressionRejectionDiagnostic({
    stage: "question_coverage",
    visibleCandidate: "Candidate accidentally repeated sk-proj-1234567890abcdef.",
    answerWordCount: 5,
    visibleBlockCount: 1,
    questionPartCount: 2,
    declaredCoveredQuestionPartCount: 1,
    completeQuestionCoverage: false,
    quantitiesGrounded: true,
    suppliedQuestionQuantitiesPreserved: true,
    everydayLanguagePassed: true,
    rawProviderPayload: "must not be retained",
    hiddenPrompt: "must not be retained",
  });
  assert.ok(diagnostic);
  assert.match(diagnostic.visibleCandidate, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /sk-proj|rawProviderPayload|hiddenPrompt|must not be retained/i);
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "answerWordCount",
    "completeQuestionCoverage",
    "declaredCoveredQuestionPartCount",
    "everydayLanguagePassed",
    "quantitiesGrounded",
    "questionPartCount",
    "stage",
    "suppliedQuestionQuantitiesPreserved",
    "visibleBlockCount",
    "visibleCandidate",
  ]);
});

test("malformed rejection diagnostics cannot enter a checkpoint observation", () => {
  assert.equal(sanitizeSurgeRegressionRejectionDiagnostic({
    stage: "question_coverage",
    visibleCandidate: "Candidate",
    answerWordCount: -1,
  }), null);
});

test("a bounded repair sample selects only explicit unique corpus cases in order", () => {
  const selected = selectSurgeRegressionCases("case-ids", [
    "rebate_eligibility-06",
    "hpwh_timing-02",
    "solar_shade-06",
  ]);
  assert.deepEqual(selected.map((entry) => entry.id), [
    "rebate_eligibility-06",
    "hpwh_timing-02",
    "solar_shade-06",
  ]);
  assert.throws(
    () => selectSurgeRegressionCases("case-ids", ["not-a-real-case"]),
    /Unknown regression case ID/,
  );
});

test("the held-out fixture flag is explicit and cannot use family sampling", () => {
  const args = parseSurgeRegressionArgs([
    "--fixture",
    HELDOUT_FIXTURE_PATH,
    "--run-label",
    "heldout-test",
    "--all",
    "--dry-run",
  ]);
  assert.equal(args.fixture, HELDOUT_FIXTURE_PATH);
  assert.equal(args.mode, "all");
  assert.throws(() => parseSurgeRegressionArgs([
    "--fixture",
    HELDOUT_FIXTURE_PATH,
    "--run-label",
    "heldout-test",
    "--one-per-family",
    "--dry-run",
  ]), /support only --all or explicit --case-id/);
  assert.throws(() => parseSurgeRegressionArgs([
    "--fixture",
    HELDOUT_FIXTURE_PATH,
    "--fixture",
    HELDOUT_FIXTURE_PATH,
    "--run-label",
    "heldout-test",
    "--all",
    "--dry-run",
  ]), /must not be repeated/);
  assert.throws(() => parseSurgeRegressionArgs([
    "--run-label",
    "corpus-test",
    "--case-id",
    "not-a-corpus-case",
    "--dry-run",
  ]), /unknown regression case ID/);
});

test("the immutable held-out fixture loads all fresh cases and keeps exact ID selection", async () => {
  const fixture = await loadSurgeRegressionFixture(HELDOUT_FIXTURE_PATH);
  assert.equal(fixture.cases.length, 13);
  assert.equal(Object.isFrozen(fixture.cases), true);
  assert.equal(Object.isFrozen(fixture.cases[0]), true);
  assert.equal(new Set(fixture.cases.map((entry) => entry.id)).size, 13);

  const selected = selectSurgeRegressionCases("case-ids", [
    "heldout-hpwh-document-finance-01",
    "heldout-outside-scope-recipe-01",
  ], fixture.cases);
  assert.deepEqual(selected.map((entry) => entry.id), [
    "heldout-hpwh-document-finance-01",
    "heldout-outside-scope-recipe-01",
  ]);
  assert.equal(selectSurgeRegressionCases("all", [], fixture.cases).length, 13);
  assert.throws(
    () => selectSurgeRegressionCases("case-ids", ["heldout-not-present"], fixture.cases),
    /Unknown regression case ID/,
  );
});

test("held-out fixture paths fail closed outside the reviewed JSON directory", async () => {
  await assert.rejects(
    loadSurgeRegressionFixture("package.json"),
    /under test\/fixtures/,
  );
  await assert.rejects(
    loadSurgeRegressionFixture("test/fixtures/../surge-response-regression-runner.test.mjs"),
    /JSON file under test\/fixtures/,
  );
  await assert.rejects(
    loadSurgeRegressionFixture("../outside.json"),
    /under test\/fixtures/,
  );
});

test("held-out fixture schema rejects extra fields, invalid regexes, duplicate and corpus IDs", async () => {
  const fixture = await loadSurgeRegressionFixture(HELDOUT_FIXTURE_PATH);
  const example = structuredClone(fixture.cases[0]);

  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{ ...example, unexpected: true }],
  }), /reviewed schema/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{
      ...example,
      forbiddenPatterns: ["("],
    }],
  }), /reviewed schema/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [example, structuredClone(example)],
  }), /IDs must be unique/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{ ...example, id: "hpwh_timing-02" }],
  }), /reviewed schema/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{
      ...example,
      question: selectSurgeRegressionCases("case-ids", ["hpwh_timing-02"])[0].question,
    }],
  }), /reviewed schema/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{ ...example, question: "OPENAI_API_KEY=not-allowed" }],
  }), /reviewed schema/);
  assert.throws(() => validateSurgeRegressionFixture({
    version: 1,
    cases: [{
      ...example,
      planContext: {
        version: 1,
        source: "home_energy_plan",
        facts: [{ key: "glazing", value: "An invented glazing option" }],
      },
    }],
  }), /reviewed schema/);
});
