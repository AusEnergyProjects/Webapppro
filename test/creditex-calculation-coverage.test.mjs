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
import {
  CREDITEX_LOCAL_PROGRAM_DEFINITIONS,
} from "../src/lib/creditex-local-program-catalogue.ts";

test("coverage accounts deterministically for all programs and activities", () => {
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_CONTRACT,
    "creditex-calculation-coverage/v1",
  );
  assert.equal(GOVERNMENT_PROGRAM_TEMPLATES.length, 35);
  assert.equal(GOVERNMENT_ACTIVITY_TEMPLATES.length, 216);
  assert.equal(CREDITEX_CALCULATION_COVERAGE.length, 216);
  assert.equal(
    new Set(
      CREDITEX_CALCULATION_COVERAGE.map(
        (row) => row.activityTemplateId,
      ),
    ).size,
    216,
  );
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.programs, 35);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.activities, 216);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.coverageSha256,
    "sha256:7b72a3203fac97b405210500edb541d79560e4aa1176f40eefa37de1f7945a7e",
  );
});

test("source-complete SRES, local, VEU and NSW formulas are executable", () => {
  const executable = CREDITEX_CALCULATION_COVERAGE.filter(
    (row) => row.estimateExecutable,
  );
  assert.equal(executable.length, 29);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.estimateExecutable, 29);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.blockedOrNonExecutable,
    187,
  );
  const localProgramCodes = new Set(
    CREDITEX_LOCAL_PROGRAM_DEFINITIONS.map((program) => program.programCode),
  );
  assert.equal(executable.filter((row) => row.programCode === "SRES").length, 2);
  assert.equal(
    executable.filter((row) => localProgramCodes.has(row.programCode)).length,
    20,
  );
  assert.equal(executable.filter((row) => row.programCode === "VEU").length, 0);
  assert.equal(
    executable.filter((row) => row.programCode === "NSW-ESS").length,
    3,
  );
  assert.equal(
    executable.filter((row) => row.programCode === "NSW-PDRS").length,
    4,
  );
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
      { state: "estimate_available", count: 29 },
      { state: "governed_formula_required", count: 105 },
      { state: "not_applicable", count: 27 },
      { state: "official_registry_required", count: 36 },
      { state: "project_method_required", count: 2 },
    ],
  );
});
