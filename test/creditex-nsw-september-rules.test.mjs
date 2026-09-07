import assert from "node:assert/strict";
import test from "node:test";
import {
  creditexNswActivityDefinition,
} from "../src/lib/creditex-nsw-program-catalogue.ts";
import {
  estimateCreditexNswProgram,
  CreditexNswEstimateError,
} from "../src/lib/creditex-nsw-program-estimator.ts";
import {
  GOVERNMENT_CALCULATION_SOURCE_WINDOWS,
} from "../src/lib/australian-certificate-calculation-catalogue.ts";

const BASE = "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/";
export const SOURCES = Object.freeze({
  essSeptember: `${BASE}Energy-Savings-Scheme-(Amendment-No.-2)-Rule-2026.PDF`,
  pdrsSeptember: `${BASE}Peak-Demand-Reduction-Scheme-(Amendment-No.-3)-Rule-2026.PDF`,
  essJuly: `${BASE}Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF`,
  pdrsJuly: `${BASE}Peak-Demand-Reduction-Scheme-Rule-of-2022-1-July-2026.PDF`,
  pdrsGuide: `${BASE}PDRS-Method-Guide-V3.1.PDF`,
});
const CURRENT = "2026-09-07";

function estimate(programCode, activityCode, effectiveDate, overrides = {}) {
  // Third argument is harmless to the current two-argument function and allows
  // the smallest date-aware lookup extension without coupling to its internals.
  const definition = creditexNswActivityDefinition(programCode, activityCode, effectiveDate);
  assert.ok(definition, `Missing ${programCode}/${activityCode} for ${effectiveDate}`);
  const inputs = Object.fromEntries(definition.inputDefinitions.map((item) => [item.key, item.defaultValue]));
  return estimateCreditexNswProgram({
    programCode,
    activityCode,
    effectiveDate,
    inputs: { ...inputs, ...overrides },
  });
}

function assertCurrent(result, source) {
  assert.equal(result.effectiveDate, CURRENT);
  assert.equal(result.officialSourceUrl, source, "Current job must not cite the July Rule as its selected source");
  assert.ok(BigInt(result.output.quantity) > 0n);
  assert.equal(result.certificateActionEnabled, false, "A corrected estimate must remain separate from certificate creation");
  assert.equal(result.receiptHash.length, 64);
}

function assertInvalid(callback) {
  assert.throws(callback, (error) => (
    error instanceof CreditexNswEstimateError
    && ["NSW_INPUT_INVALID", "NSW_ESTIMATE_INVALID"].includes(error.code)
  ));
}

export const CURRENT_VECTORS = Object.freeze([
  {
    id: "HVAC2_SINGLE_BELOW_30",
    programCode: "NSW-PDRS-2026", activityCode: "HVAC2-SINGLE",
    overrides: { product_class: "8", rated_cooling_capacity_kw: "20", rated_cooling_input_kw: "2" },
    expected: "accept", source: SOURCES.pdrsSeptember,
    clause: "HVAC2 Eligibility Requirement 2: >=30kW applies only to multi-split classes20/21/27",
  },
  {
    id: "HVAC2_EXCLUDES_CLASS_18",
    programCode: "NSW-PDRS-2026", activityCode: "HVAC2-MULTI",
    overrides: { product_class: "18" },
    expected: "reject", source: SOURCES.pdrsSeptember,
    clause: "HVAC2 Equipment Requirements1/4: commercial multi-split classes20/21/27; class18 excluded",
  },
  {
    id: "BESS4_WITHOUT_NEW_PV",
    programCode: "NSW-PDRS-2026", activityCode: "BESS4",
    overrides: { new_solar_within_90_days: "no", new_solar_capacity_kw: "0" },
    expected: "accept", source: SOURCES.pdrsSeptember,
    clause: "BESS4 Equipment Requirement4 and EquationsBESS4.2/BESS4.3: quarter-capacity PV condition applies only to solar-linked formula",
  },
  {
    id: "BESS5_WITHOUT_NEW_PV",
    programCode: "NSW-PDRS-2026", activityCode: "BESS5",
    overrides: { new_solar_within_90_days: "no", new_solar_capacity_kw: "0" },
    expected: "accept", source: SOURCES.pdrsSeptember,
    clause: "BESS5 Equipment Requirement4 and EquationsBESS5.2/BESS5.3: quarter-capacity PV condition applies only to solar-linked formula",
  },
  {
    id: "D16_CLASS6_REQUIRES_1000",
    programCode: "NSW-ESS-2026", activityCode: "D16-SINGLE",
    overrides: { product_class: "6", installation_configuration: "non_ducted", net_payment_ex_gst_aud: "500" },
    expected: "reject", source: SOURCES.essSeptember,
    clause: "9.8.1(f)(ii)B: class6 requires >=$1000 exGST irrespective of an operator-selected non-ducted flag",
  },
  {
    id: "D16_CLASS5_CORRECT_MINIMUM_ROW",
    programCode: "NSW-ESS-2026", activityCode: "D16-SINGLE",
    overrides: { product_class: "5", cooling_efficiency_value: "3", heating_efficiency_value: "2.5" },
    expected: "accept", source: SOURCES.essSeptember,
    clause: "TableD16.4: class5 has residential TCSPF3.0/HSPF-mixed2.5; baseline grouping inD16.2 is different",
  },
  {
    id: "F4_SINGLE_BELOW_30",
    programCode: "NSW-ESS-2026", activityCode: "F4-SINGLE",
    overrides: { product_class: "8", cooling_capacity_kw: "20" },
    expected: "accept", source: SOURCES.essSeptember,
    clause: "F4 Eligibility Requirement2: >=30kW applies only to classes20/21/27 multi-split",
  },
  {
    id: "F4_EXCLUDES_CLASS_18",
    programCode: "NSW-ESS-2026", activityCode: "F4-MULTI",
    overrides: { product_class: "18" },
    expected: "reject", source: SOURCES.essSeptember,
    clause: "F4 Equipment Requirements1/6: commercial multi-split classes20/21/27; class18 excluded",
  },
]);

for (const vector of CURRENT_VECTORS) {
  test(`${vector.id}: ${vector.clause} [effective ${CURRENT}]`, () => {
    const run = () => estimate(vector.programCode, vector.activityCode, CURRENT, vector.overrides);
    if (vector.expected === "reject") assertInvalid(run);
    else assertCurrent(run(), vector.source);
  });
}

test("Preserve valid July and September1-6 battery vectors with their original Rule identity", () => {
  // July Rule clauses1.1,8.1 and ScheduleC/D. One EUE in each vector, so this
  // does not conflate the later per-implementation payment change with July.
  for (const [activityCode, effectiveDate, expectedQuantity] of [
    ["BESS1", "2026-07-01", "718"],
    ["BESS2", "2026-07-01", "197"],
    ["BESS3", "2026-09-01", "4043"],
    ["BESS4", "2026-09-01", "1684"],
    ["BESS5", "2026-09-01", "18720"],
  ]) {
    const result = estimate("NSW-PDRS-2026", activityCode, effectiveDate);
    assert.equal(result.output.quantity, expectedQuantity, `${activityCode} historic quantity`);
    assert.equal(result.officialSourceUrl, SOURCES.pdrsJuly, `${activityCode} historic source`);
    assert.equal(result.certificateActionEnabled, false);
  }
});

test("Source windows append September7 and retain July through September6", () => {
  for (const [programCode, julyUrl, septemberUrl] of [
    ["NSW-ESS", SOURCES.essJuly, SOURCES.essSeptember],
    ["NSW-PDRS", SOURCES.pdrsJuly, SOURCES.pdrsSeptember],
  ]) {
    const windows = GOVERNMENT_CALCULATION_SOURCE_WINDOWS.filter((item) => item.programCode === programCode);
    const july = windows.find((item) => item.officialSourceUrl === julyUrl);
    const september = windows.find((item) => item.officialSourceUrl === septemberUrl);
    assert.ok(july, `${programCode} must preserve July source`);
    assert.equal(july.effectiveFrom, "2026-07-01");
    assert.equal(july.effectiveTo, "2026-09-06");
    assert.ok(september, `${programCode} September source missing`);
    assert.equal(september.effectiveFrom, CURRENT);
  }
});

test("BESS3-5 remain unavailable before their original September1 commencement", () => {
  for (const activityCode of ["BESS3", "BESS4", "BESS5"]) {
    assert.throws(
      () => estimate("NSW-PDRS-2026", activityCode, "2026-08-31"),
      (error) => error instanceof CreditexNswEstimateError && error.code === "NSW_EFFECTIVE_DATE_UNSUPPORTED",
    );
  }
});
