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
    "sha256:35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347",
  );
});

test("source-complete SRES, local, VEU and NSW formulas are executable", () => {
  const executable = CREDITEX_CALCULATION_COVERAGE.filter(
    (row) => row.estimateExecutable,
  );
  assert.equal(executable.length, 56);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.estimateExecutable, 56);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.blockedOrNonExecutable,
    160,
  );
  const localProgramCodes = new Set(
    CREDITEX_LOCAL_PROGRAM_DEFINITIONS.map((program) => program.programCode),
  );
  assert.equal(executable.filter((row) => row.programCode === "SRES").length, 2);
  assert.equal(
    executable.filter((row) => localProgramCodes.has(row.programCode)).length,
    20,
  );
  assert.equal(executable.filter((row) => row.programCode === "VEU").length, 27);
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
        ["estimate_available", "partial_estimate_available"].includes(
          row.calculationState,
        )
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
      { state: "estimate_available", count: 50 },
      { state: "governed_formula_required", count: 88 },
      { state: "not_applicable", count: 27 },
      { state: "official_registry_required", count: 26 },
      { state: "partial_estimate_available", count: 6 },
      { state: "project_method_required", count: 2 },
    ],
  );
});
