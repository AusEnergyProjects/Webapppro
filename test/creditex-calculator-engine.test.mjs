import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_CALCULATOR_SPEC_SCHEMA,
  CreditexCalculatorError,
  creditexCalculatorEngineContractHash,
  evaluateCreditexCalculator,
  runCreditexCalculatorTestSuite,
  validateCreditexCalculatorSpecification,
} from "../src/lib/creditex-calculator-engine.ts";

const GENERIC_SPECIFICATION = {
  schemaVersion: CREDITEX_CALCULATOR_SPEC_SCHEMA,
  key: "generic_banded_score",
  version: 1,
  title: "Generic banded score test fixture",
  inputs: [
    {
      key: "band",
      unit: "index",
      precision: 0,
      minimum: "1",
      maximum: "4",
    },
  ],
  steps: [
    {
      kind: "lookup",
      key: "band_ratio",
      source: "band",
      inputUnit: "index",
      outputUnit: "ratio",
      entries: [
        { match: "3", value: "1.5" },
        { match: "1", value: "1" },
        { match: "2", value: "1.25" },
      ],
    },
    {
      kind: "factor",
      key: "weighted_score",
      source: "band_ratio",
      inputUnit: "ratio",
      outputUnit: "points",
      factor: "2.4",
    },
    {
      kind: "cap",
      key: "capped_score",
      source: "weighted_score",
      unit: "points",
      maximum: "2.85",
    },
    {
      kind: "rounding",
      key: "reported_score",
      source: "capped_score",
      unit: "points",
      mode: "nearest_half_away_from_zero",
      decimalPlaces: 1,
    },
  ],
  output: {
    source: "reported_score",
    unit: "points",
  },
};

const PRECISE_MULTIPLICATION_SPECIFICATION = {
  schemaVersion: CREDITEX_CALCULATOR_SPEC_SCHEMA,
  key: "precise_multiplication",
  version: 1,
  title: "Precise fixed-decimal multiplication fixture",
  inputs: [
    {
      key: "amount",
      unit: "quantity",
      precision: 9,
      minimum: "-999999999999.123456789",
      maximum: "999999999999.123456789",
    },
  ],
  steps: [
    {
      kind: "factor",
      key: "result",
      source: "amount",
      inputUnit: "quantity",
      outputUnit: "result",
      factor: "0.123456789",
    },
  ],
  output: {
    source: "result",
    unit: "result",
  },
};

const SRES_PV_2026_SPECIFICATION = {
  schemaVersion: CREDITEX_CALCULATOR_SPEC_SCHEMA,
  key: "cer_sres_pv_2026",
  version: 1,
  title: "CER SRES solar PV entitlement for 2026 installations",
  inputs: [
    {
      key: "rated_capacity_kw",
      unit: "kW",
      precision: 3,
      minimum: "0.001",
      maximum: "100",
    },
    {
      key: "zone_rating",
      unit: "STC/kW/year",
      precision: 3,
      minimum: "1.185",
      maximum: "1.622",
    },
    {
      key: "deeming_years",
      unit: "year",
      precision: 0,
      minimum: "5",
      maximum: "5",
    },
  ],
  steps: [
    {
      kind: "multiply",
      key: "annual_stcs",
      leftSource: "rated_capacity_kw",
      rightSource: "zone_rating",
      leftUnit: "kW",
      rightUnit: "STC/kW/year",
      outputUnit: "STC/year",
    },
    {
      kind: "multiply",
      key: "deemed_stcs",
      leftSource: "annual_stcs",
      rightSource: "deeming_years",
      leftUnit: "STC/year",
      rightUnit: "year",
      outputUnit: "STC",
    },
    {
      kind: "rounding",
      key: "whole_stcs",
      source: "deemed_stcs",
      unit: "STC",
      mode: "floor",
      decimalPlaces: 0,
    },
  ],
  output: { source: "whole_stcs", unit: "STC" },
};

function assertCalculatorError(expectedCode) {
  return (error) => {
    assert.ok(error instanceof CreditexCalculatorError);
    assert.equal(error.code, expectedCode);
    return true;
  };
}

test("a validated generic specification evaluates deterministically and emits canonical receipts", () => {
  const validated = validateCreditexCalculatorSpecification(
    GENERIC_SPECIFICATION,
  );
  assert.deepEqual(
    validated.steps[0].entries.map((entry) => entry.match),
    ["1", "2", "3"],
  );

  const first = evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
    band: { value: "2", unit: "index" },
  });
  const second = evaluateCreditexCalculator(
    structuredClone(GENERIC_SPECIFICATION),
    {
      band: { unit: "index", value: "2" },
    },
  );

  assert.deepEqual(first.output, {
    decimal: "2.9",
    unit: "points",
  });
  assert.equal(first.trace[1].output.decimal, "3");
  assert.equal(first.trace[2].output.decimal, "2.85");
  assert.equal(first.receiptHash, second.receiptHash);
  assert.equal(
    first.engineContractHash,
    creditexCalculatorEngineContractHash(GENERIC_SPECIFICATION),
  );
  assert.equal("implementationHash" in first, false);
  assert.equal("value" in first.output, false);
  assert.match(first.receiptHash, /^sha256:[a-f0-9]{64}$/);

  const suiteOne = runCreditexCalculatorTestSuite(
    GENERIC_SPECIFICATION,
    [
      {
        key: "band_two",
        inputs: { band: { value: "2", unit: "index" } },
        expected: { value: "2.9", unit: "points" },
      },
      {
        key: "band_one",
        inputs: { band: { value: "1", unit: "index" } },
        expected: { value: "2.4", unit: "points" },
      },
    ],
  );
  const suiteTwo = runCreditexCalculatorTestSuite(
    structuredClone(GENERIC_SPECIFICATION),
    [
      {
        key: "band_one",
        inputs: { band: { unit: "index", value: "1" } },
        expected: { unit: "points", value: "2.4" },
      },
      {
        key: "band_two",
        inputs: { band: { unit: "index", value: "2" } },
        expected: { unit: "points", value: "2.9" },
      },
    ],
  );
  assert.equal(suiteOne.passed, true);
  assert.equal(suiteOne.receiptHash, suiteTwo.receiptHash);
  assert.equal(suiteOne.engineContractHash, first.engineContractHash);
  assert.equal("implementationHash" in suiteOne, false);
});

test("binary fixed-decimal multiplication reproduces the governed 2026 CER PV vector", () => {
  const receipt = evaluateCreditexCalculator(SRES_PV_2026_SPECIFICATION, {
    rated_capacity_kw: { value: "6.6", unit: "kW" },
    zone_rating: { value: "1.382", unit: "STC/kW/year" },
    deeming_years: { value: "5", unit: "year" },
  });
  assert.deepEqual(receipt.output, { decimal: "45", unit: "STC" });
  assert.equal(receipt.trace[0].input.decimal, "6.6");
  assert.equal(receipt.trace[0].secondaryInput.decimal, "1.382");
  assert.equal(receipt.trace[0].output.decimal, "9.1212");
  assert.equal(receipt.trace[1].secondaryInput.decimal, "5");
  assert.equal(receipt.trace[1].output.decimal, "45.606");
  assert.match(receipt.receiptHash, /^sha256:[a-f0-9]{64}$/);

  const suite = runCreditexCalculatorTestSuite(SRES_PV_2026_SPECIFICATION, [{
    key: "cer_2026_6_6kw_zone_1_382",
    inputs: {
      rated_capacity_kw: { value: "6.6", unit: "kW" },
      zone_rating: { value: "1.382", unit: "STC/kW/year" },
      deeming_years: { value: "5", unit: "year" },
    },
    expected: { value: "45", unit: "STC" },
  }]);
  assert.equal(suite.passed, true);
});

test("unit mismatches fail at both specification and runtime boundaries", () => {
  const invalidSpecification = structuredClone(GENERIC_SPECIFICATION);
  invalidSpecification.steps[0].inputUnit = "other_index";
  assert.throws(
    () => validateCreditexCalculatorSpecification(invalidSpecification),
    assertCalculatorError("unit_mismatch"),
  );

  assert.throws(
    () => evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
      band: { value: "2", unit: "count" },
    }),
    assertCalculatorError("unit_mismatch"),
  );
});

test("missing inputs and unmatched lookup values fail closed", () => {
  assert.throws(
    () => evaluateCreditexCalculator(GENERIC_SPECIFICATION, {}),
    assertCalculatorError("missing_input"),
  );
  assert.throws(
    () => evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
      band: { value: "4", unit: "index" },
    }),
    assertCalculatorError("missing_lookup"),
  );
});

test("authoritative decimal boundaries reject numbers and exponent notation", () => {
  assert.throws(
    () => evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
      band: { value: 2, unit: "index" },
    }),
    assertCalculatorError("invalid_input"),
  );

  const numericFactor = structuredClone(GENERIC_SPECIFICATION);
  numericFactor.steps[1].factor = 2.4;
  assert.throws(
    () => validateCreditexCalculatorSpecification(numericFactor),
    assertCalculatorError("invalid_specification"),
  );

  assert.throws(
    () => evaluateCreditexCalculator(PRECISE_MULTIPLICATION_SPECIFICATION, {
      amount: { value: "1e-9", unit: "quantity" },
    }),
    assertCalculatorError("invalid_input"),
  );

  assert.throws(
    () => runCreditexCalculatorTestSuite(GENERIC_SPECIFICATION, [
      {
        key: "numeric_expected",
        inputs: { band: { value: "1", unit: "index" } },
        expected: { value: 2.4, unit: "points" },
      },
    ]),
    assertCalculatorError("invalid_suite"),
  );
});

test("cap and rounding modes are explicit and deterministic", () => {
  const nearest = evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
    band: { value: "2", unit: "index" },
  });
  assert.equal(nearest.output.decimal, "2.9");

  const floorSpecification = structuredClone(GENERIC_SPECIFICATION);
  floorSpecification.steps[3].mode = "floor";
  const floor = evaluateCreditexCalculator(floorSpecification, {
    band: { value: "2", unit: "index" },
  });
  assert.equal(floor.output.decimal, "2.8");

  const ceilingSpecification = structuredClone(GENERIC_SPECIFICATION);
  ceilingSpecification.steps[3].mode = "ceiling";
  ceilingSpecification.steps[2].maximum = "2.81";
  const ceiling = evaluateCreditexCalculator(ceilingSpecification, {
    band: { value: "2", unit: "index" },
  });
  assert.equal(ceiling.output.decimal, "2.9");
});

test("high-precision values and declared limits remain exact base-10 strings", () => {
  const validated = validateCreditexCalculatorSpecification(
    PRECISE_MULTIPLICATION_SPECIFICATION,
  );
  assert.equal(
    validated.inputs[0].minimum,
    "-999999999999.123456789",
  );
  assert.equal(
    validated.inputs[0].maximum,
    "999999999999.123456789",
  );
  assert.equal(validated.steps[0].factor, "0.123456789");

  const execution = evaluateCreditexCalculator(
    PRECISE_MULTIPLICATION_SPECIFICATION,
    {
      amount: { value: "0.123456789", unit: "quantity" },
    },
  );
  assert.deepEqual(execution.output, {
    decimal: "0.015241578750190521",
    unit: "result",
  });
  assert.equal(
    execution.trace[0].input.decimal,
    "0.123456789",
  );
});

test("absolute and precision boundaries fail closed without floating-point coercion", () => {
  const boundarySpecification = structuredClone(
    PRECISE_MULTIPLICATION_SPECIFICATION,
  );
  boundarySpecification.inputs[0].minimum = "-1000000000000";
  boundarySpecification.inputs[0].maximum = "1000000000000";
  boundarySpecification.steps[0].factor = "1";

  const maximum = evaluateCreditexCalculator(boundarySpecification, {
    amount: { value: "1000000000000", unit: "quantity" },
  });
  assert.equal(maximum.output.decimal, "1000000000000");

  const precise = evaluateCreditexCalculator(boundarySpecification, {
    amount: { value: "999999999999.123456789", unit: "quantity" },
  });
  assert.equal(precise.output.decimal, "999999999999.123456789");

  assert.throws(
    () => evaluateCreditexCalculator(boundarySpecification, {
      amount: { value: "1000000000000.000000001", unit: "quantity" },
    }),
    assertCalculatorError("number_out_of_range"),
  );
  assert.throws(
    () => evaluateCreditexCalculator(boundarySpecification, {
      amount: { value: "1.0000000001", unit: "quantity" },
    }),
    assertCalculatorError("precision_exceeded"),
  );
});

test("engine contract hashes identify the validated contract, not executable bytes", () => {
  const receipt = evaluateCreditexCalculator(GENERIC_SPECIFICATION, {
    band: { value: "1", unit: "index" },
  });
  assert.equal(
    receipt.engineContractHash,
    creditexCalculatorEngineContractHash(GENERIC_SPECIFICATION),
  );

  const changedSpecification = structuredClone(GENERIC_SPECIFICATION);
  changedSpecification.steps[1].factor = "2.5";
  assert.notEqual(
    creditexCalculatorEngineContractHash(changedSpecification),
    receipt.engineContractHash,
  );
});
