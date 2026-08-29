import assert from "node:assert/strict";
import test from "node:test";
import {
  createSurgeRegressionCacheKey,
  createSurgeRegressionRunIdentity,
  sanitizeSurgeRegressionRejectionDiagnostic,
  selectSurgeRegressionCases,
  surgeRegressionObservationIsValid,
} from "../scripts/run-surge-response-regression.mjs";

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
