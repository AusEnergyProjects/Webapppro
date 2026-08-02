import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_CALCULATION_COVERAGE,
  CREDITEX_CALCULATION_COVERAGE_CONTRACT,
  CREDITEX_CALCULATION_COVERAGE_SUMMARY,
} from "../src/lib/creditex-calculation-coverage.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";

test("coverage accounts deterministically for all programs and activities", () => {
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_CONTRACT,
    "creditex-calculation-coverage/v1",
  );
  assert.equal(GOVERNMENT_PROGRAM_TEMPLATES.length, 32);
  assert.equal(GOVERNMENT_ACTIVITY_TEMPLATES.length, 212);
  assert.equal(CREDITEX_CALCULATION_COVERAGE.length, 212);
  assert.equal(
    new Set(
      CREDITEX_CALCULATION_COVERAGE.map(
        (row) => row.activityTemplateId,
      ),
    ).size,
    212,
  );
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.programs, 32);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.activities, 212);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.coverageSha256,
    "sha256:13aacf29e36038eaa3900a5716be816496f0f51574912e61cba7a941911a79de",
  );
});

test("only the existing six SRES estimate paths are executable", () => {
  const executable = CREDITEX_CALCULATION_COVERAGE.filter(
    (row) => row.estimateExecutable,
  );
  assert.equal(executable.length, 6);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.estimateExecutable, 6);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.blockedOrNonExecutable,
    206,
  );
  assert.ok(executable.every((row) => row.programCode === "SRES"));
  assert.ok(
    executable.every(
      (row) =>
        row.calculationState === "estimate_available"
        && row.calculationPathway === "deterministic_local_estimate"
        && row.officialReconciliationRequired,
    ),
  );
});

test("coverage never enables certificate action for any activity", () => {
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.certificateActionsEnabled,
    0,
  );
  assert.ok(
    CREDITEX_CALCULATION_COVERAGE.every(
      (row) => row.certificateActionEnabled === false,
    ),
  );
  assert.deepEqual(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.stateCounts,
    [
      { state: "activity_closed", count: 9 },
      { state: "activity_not_commenced", count: 8 },
      { state: "estimate_available", count: 6 },
      { state: "governed_formula_required", count: 131 },
      { state: "not_applicable", count: 53 },
      { state: "official_registry_required", count: 3 },
      { state: "project_method_required", count: 2 },
    ],
  );
});
