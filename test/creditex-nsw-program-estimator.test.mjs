import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_NSW_BLOCKED_ACTIVITIES,
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
  creditexNswActivityDefinition,
} from "../src/lib/creditex-nsw-program-catalogue.ts";
import {
  CreditexNswEstimateError,
  estimateCreditexNswProgram,
} from "../src/lib/creditex-nsw-program-estimator.ts";

function activity(programCode, activityCode) {
  const definition = creditexNswActivityDefinition(programCode, activityCode);
  assert.ok(definition, `missing ${programCode}/${activityCode}`);
  return definition;
}

function defaultInputs(programCode, activityCode) {
  return Object.fromEntries(
    activity(programCode, activityCode).inputDefinitions.map((definition) => [
      definition.key,
      definition.defaultValue,
    ]),
  );
}

function estimate(programCode, activityCode, effectiveDate, overrides = {}) {
  return estimateCreditexNswProgram({
    programCode,
    activityCode,
    effectiveDate,
    inputs: {
      ...defaultInputs(programCode, activityCode),
      ...overrides,
    },
  });
}

function assertError(code, callback) {
  assert.throws(
    callback,
    (error) => error instanceof CreditexNswEstimateError && error.code === code,
  );
}

function assertOutput(result, quantity, unit) {
  assert.equal(result.output.quantity, quantity);
  assert.equal(result.output.unit, unit);
  assert.equal(result.certificateActionEnabled, false);
  assert.equal(result.receiptHash.length, 64);
  assert.ok(result.trace.length >= 4);
}

test("all 20 executable NSW scenarios expose a complete UI contract and execute their governed default vectors", () => {
  const expected = new Map([
    ["NSW-PDRS-2026/BESS1", "718"],
    ["NSW-PDRS-2026/BESS2", "197"],
    ["NSW-PDRS-2026/BESS3", "4043"],
    ["NSW-PDRS-2026/BESS4", "1684"],
    ["NSW-PDRS-2026/BESS5", "18720"],
    ["NSW-PDRS-2026/HVAC1-SINGLE", "547"],
    ["NSW-PDRS-2026/HVAC1-MULTI", "500"],
    ["NSW-PDRS-2026/HVAC2-SINGLE", "1185"],
    ["NSW-PDRS-2026/HVAC2-MULTI", "1084"],
    ["NSW-PDRS-2026/RF2-REMOTE", "376"],
    ["NSW-PDRS-2026/SYS2", "143"],
    ["NSW-ESS-2026/D5", "6"],
    ["NSW-ESS-2026/D16-SINGLE", "27"],
    ["NSW-ESS-2026/D16-MULTI", "37"],
    ["NSW-ESS-2026/D17", "21"],
    ["NSW-ESS-2026/D18", "27"],
    ["NSW-ESS-2026/D19", "10"],
    ["NSW-ESS-2026/D20", "14"],
    ["NSW-ESS-2026/F4-SINGLE", "71"],
    ["NSW-ESS-2026/F4-MULTI", "56"],
  ]);

  let count = 0;
  for (const program of CREDITEX_NSW_PROGRAM_DEFINITIONS) {
    for (const definition of program.activities) {
      assert.ok(definition.productKinds.length > 0);
      assert.ok(definition.productRegistryRequirements.length > 0);
      assert.ok(definition.sourceReferences.length >= 2);
      assert.ok(definition.supportedScenario.length > 20);
      for (const input of definition.inputDefinitions) {
        assert.ok(input.key);
        assert.ok(input.label);
        assert.ok(input.type);
        assert.ok(input.unit);
        assert.ok(input.defaultValue);
        assert.ok(input.help);
        if (input.type === "select") assert.ok(input.options?.length >= 2);
        if (input.type !== "select") {
          assert.notEqual(input.minimum, undefined);
          assert.notEqual(input.maximum, undefined);
        }
      }
      const result = estimate(
        program.programCode,
        definition.activityCode,
        definition.effectiveFrom,
      );
      assertOutput(
        result,
        expected.get(`${program.programCode}/${definition.activityCode}`),
        program.outputUnit,
      );
      count += 1;
    }
  }
  assert.equal(count, 20);
  assert.equal(expected.size, count);
});

test("BESS1 and BESS2 apply usable capacity, firmness, lifetime, network loss and whole-certificate floor", () => {
  assertOutput(estimate("NSW-PDRS-2026", "BESS1", "2026-07-01"), "718", "PRC");
  assertOutput(estimate("NSW-PDRS-2026", "BESS2", "2026-07-01"), "197", "PRC");

  const endeavour = estimate("NSW-PDRS-2026", "BESS1", "2026-07-01", {
    distribution_network: "endeavour",
  });
  assertOutput(endeavour, "725", "PRC");
  assert.equal(endeavour.trace.find((entry) => entry.key === "raw_prcs")?.output, "725.4765");
});

test("BESS1 fails closed without its post-30 June 2025 exception or minimum purchaser payment", () => {
  assertError("NSW_ELIGIBILITY_NOT_CONFIRMED", () => estimate(
    "NSW-PDRS-2026",
    "BESS1",
    "2026-07-01",
    { post_2025_exception: "none" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS1",
    "2026-07-01",
    { net_payment_ex_gst_aud: "199.99" },
  ));
  assertOutput(estimate("NSW-PDRS-2026", "BESS1", "2026-07-01", {
    net_payment_ex_gst_aud: "0",
    payment_exemption: "low_income",
  }), "718", "PRC");
});

test("battery usable-capacity boundaries are exact and do not round into eligibility", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS1",
    "2026-07-01",
    { nominal_battery_capacity_kwh: "2.222222222" },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-PDRS-2026",
    "BESS1",
    "2026-07-01",
    { nominal_battery_capacity_kwh: "2.222222223" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS1",
    "2026-07-01",
    { nominal_battery_capacity_kwh: "31.111111112" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS2",
    "2026-07-01",
    { nominal_battery_capacity_kwh: "60" },
  ));
});

test("BESS3, BESS4 and BESS5 cannot execute before their 1 September 2026 commencement", () => {
  for (const activityCode of ["BESS3", "BESS4", "BESS5"]) {
    assertError("NSW_EFFECTIVE_DATE_UNSUPPORTED", () => estimate(
      "NSW-PDRS-2026",
      activityCode,
      "2026-08-31",
    ));
    assert.doesNotThrow(() => estimate(
      "NSW-PDRS-2026",
      activityCode,
      "2026-09-01",
    ));
  }
});

test("BESS3 uses the dwelling and four-hour inverter caps and distinguishes the funded-solar pathway", () => {
  const preferred = estimate("NSW-PDRS-2026", "BESS3", "2026-09-01", {
    nominal_battery_capacity_kwh: "100",
    battery_inverter_output_kw: "20",
    individual_dwellings: "8",
    solar_pathway: "within_90_days_no_nsw_funding",
  });
  assert.equal(preferred.trace.find((entry) => entry.key === "calculation_battery_capacity")?.output, "40");
  assertOutput(preferred, "4492", "PRC");

  const other = estimate("NSW-PDRS-2026", "BESS3", "2026-09-01", {
    nominal_battery_capacity_kwh: "100",
    battery_inverter_output_kw: "20",
    individual_dwellings: "8",
    solar_pathway: "other",
  });
  assertOutput(other, "3193", "PRC");
});

test("BESS4 applies every piecewise boundary exactly", () => {
  const atFifty = estimate("NSW-PDRS-2026", "BESS4", "2026-09-01", {
    nominal_battery_capacity_kwh: "77.777777777",
    battery_inverter_output_kw: "12.5",
    new_solar_capacity_kw: "20",
  });
  assertOutput(atFifty, "2340", "PRC");
  assert.match(atFifty.trace.find((entry) => entry.key === "demand_component")?.operation ?? "", /BESS4\.2A/);

  const atHundred = estimate("NSW-PDRS-2026", "BESS4", "2026-09-01", {
    nominal_battery_capacity_kwh: "140",
    battery_inverter_output_kw: "25",
    new_solar_capacity_kw: "40",
  });
  assertOutput(atHundred, "5616", "PRC");
  assert.match(atHundred.trace.find((entry) => entry.key === "demand_component")?.operation ?? "", /BESS4\.2B/);

  const aboveHundred = estimate("NSW-PDRS-2026", "BESS4", "2026-09-01", {
    nominal_battery_capacity_kwh: "140",
    battery_inverter_output_kw: "25.000000001",
    new_solar_capacity_kw: "40",
  });
  assert.equal(aboveHundred.output.quantity, "9360");
  assert.match(aboveHundred.trace.find((entry) => entry.key === "demand_component")?.operation ?? "", /BESS4\.2C/);
});

test("BESS4 and BESS5 enforce solar, inverter and administrator-recording gates", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS4",
    "2026-09-01",
    { new_solar_capacity_kw: "8" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "BESS4",
    "2026-09-01",
    { battery_inverter_output_kw: "5" },
  ));
  assertError("NSW_PRODUCT_DATA_NOT_CONFIRMED", () => estimate(
    "NSW-PDRS-2026",
    "BESS5",
    "2026-09-01",
    { administrator_recording_confirmed: "no" },
  ));

  const capped = estimate("NSW-PDRS-2026", "BESS5", "2026-09-01", {
    nominal_battery_capacity_kwh: "20000",
    battery_inverter_output_kw: "3000",
    new_solar_capacity_kw: "4500",
  });
  assert.equal(capped.trace.find((entry) => entry.key === "calculation_battery_capacity")?.output, "10000");
  assertOutput(capped, "936000", "PRC");
});

test("PDRS HVAC threshold, capacity and multi-split certificate-cap boundaries fail closed", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "HVAC1-SINGLE",
    "2026-07-01",
    { cooling_efficiency_value: "5.499999999" },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-PDRS-2026",
    "HVAC1-SINGLE",
    "2026-07-01",
    { cooling_efficiency_value: "5.5" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "HVAC2-SINGLE",
    "2026-07-01",
    { rated_cooling_capacity_kw: "29.999999999" },
  ));
  assertOutput(estimate("NSW-PDRS-2026", "HVAC1-MULTI", "2026-07-01"), "500", "PRC");
});

test("RF2 exposes only active remote classes and enforces the below-81 EEI threshold", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    "2026-07-01",
    { product_class: "1" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    "2026-07-01",
    { product_eei: "81" },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    "2026-07-01",
    { product_eei: "80.999999999" },
  ));
  assert.ok(CREDITEX_NSW_BLOCKED_ACTIVITIES.some((item) => (
    item.activityCode === "RF2-CLASSES-1-11" && item.status === "suspended"
  )));
});

test("SYS2 preserves the exact PAEC/365/DRT fraction and rejects a non-saving product", () => {
  const result = estimate("NSW-PDRS-2026", "SYS2", "2026-07-01");
  assert.equal(result.trace.find((entry) => entry.key === "input_power")?.output, "35/146");
  assert.equal(result.output.rawExact, "1307982/9125");
  assertError("NSW_NON_POSITIVE_SAVINGS", () => estimate(
    "NSW-PDRS-2026",
    "SYS2",
    "2026-07-01",
    { paec_kwh_per_year: "5000" },
  ));
});

test("PDRS allocation sums to the floored total and gives every remainder to earlier periods", () => {
  const result = estimate("NSW-PDRS-2026", "BESS2", "2026-07-01");
  assert.equal(result.annualAllocation.length, 6);
  const sum = result.annualAllocation.reduce(
    (total, row) => total + BigInt(row.quantity),
    BigInt(0),
  );
  assert.equal(sum.toString(), result.output.quantity);
  assert.deepEqual(result.annualAllocation.map((row) => row.quantity), ["33", "33", "33", "33", "33", "32"]);
});

test("ESS D5 applies the full Table D5.1 maximum-input boundary table", () => {
  const vectors = [
    ["1000", "1300"],
    ["1000.000000001", "1500"],
    ["1500", "1500"],
    ["1500.000000001", "1700"],
    ["2000", "1700"],
    ["2000.000000001", "2000"],
  ];
  for (const [maximum, baseline] of vectors) {
    const result = estimate("NSW-ESS-2026", "D5", "2026-07-01", {
      maximum_tested_input_w: maximum,
      paec_kwh_per_year: "1",
    });
    assert.equal(result.trace.find((entry) => entry.key === "baseline_paec")?.output, baseline);
  }
});

test("ESS Table A24 regional factor is driven by postcode and changes Equation 1", () => {
  const metro = estimate("NSW-ESS-2026", "D5", "2026-07-01", {
    site_postcode: "2000",
  });
  const regional = estimate("NSW-ESS-2026", "D5", "2026-07-01", {
    site_postcode: "2311",
  });
  assert.equal(metro.output.rawExact, "6.36");
  assert.equal(regional.output.rawExact, "6.5508");
});

test("ESS Table A27 resolves hot, average and cold air-conditioner climates but rejects contradictory postcode 2730", () => {
  const hot = estimate("NSW-ESS-2026", "D16-SINGLE", "2026-07-01", {
    site_postcode: "2481",
    heating_efficiency_value: "4.5",
  });
  const average = estimate("NSW-ESS-2026", "D16-SINGLE", "2026-07-01", {
    site_postcode: "2000",
  });
  const cold = estimate("NSW-ESS-2026", "D16-SINGLE", "2026-07-01", {
    site_postcode: "2600",
    heating_efficiency_value: "4.0",
  });
  assert.equal(hot.trace.find((entry) => entry.key === "aircon_climate_zone")?.output, "1");
  assert.equal(average.trace.find((entry) => entry.key === "aircon_climate_zone")?.output, "2");
  assert.equal(cold.trace.find((entry) => entry.key === "aircon_climate_zone")?.output, "3");
  assertError("NSW_RULE_AMBIGUITY", () => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    { site_postcode: "2730" },
  ));
});

test("D16 enforces seasonal and rated-fallback thresholds without treating them as interchangeable", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    { cooling_efficiency_basis: "tcspf", cooling_efficiency_value: "5.49" },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    { cooling_efficiency_basis: "rated_aeer_no_tcspf", cooling_efficiency_value: "4.3" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    { cooling_efficiency_basis: "rated_aeer_no_tcspf", cooling_efficiency_value: "4.299999999" },
  ));
});

test("D16 multi-split payment bands use cooling capacity rounded down and its ESC cap is enforced", () => {
  assert.doesNotThrow(() => estimate(
    "NSW-ESS-2026",
    "D16-MULTI",
    "2026-07-01",
    {
      outdoor_cooling_capacity_kw: "15.9",
      indoor_cooling_capacity_sum_kw: "15.9",
      net_payment_ex_gst_aud: "1000",
    },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "D16-MULTI",
    "2026-07-01",
    {
      outdoor_cooling_capacity_kw: "16",
      indoor_cooling_capacity_sum_kw: "16",
      net_payment_ex_gst_aud: "1000",
    },
  ));
  const capped = estimate("NSW-ESS-2026", "D16-MULTI", "2026-07-01", {
    outdoor_cooling_capacity_kw: "100",
    indoor_cooling_capacity_sum_kw: "100",
    outdoor_heating_capacity_kw: "100",
    indoor_heating_capacity_sum_kw: "100",
    cooling_annual_energy_kwh: "0",
    heating_annual_energy_kwh: "0",
    net_payment_ex_gst_aud: "3000",
  });
  assertOutput(capped, "70", "ESC");
});

test("D16 and F4 treat ducted-system purchaser payments separately from non-ducted single systems", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    {
      installation_configuration: "ducted",
      cooling_capacity_kw: "16",
      net_payment_ex_gst_aud: "1000",
    },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-ESS-2026",
    "D16-SINGLE",
    "2026-07-01",
    {
      installation_configuration: "ducted",
      cooling_capacity_kw: "16",
      net_payment_ex_gst_aud: "2000",
    },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "F4-SINGLE",
    "2026-07-01",
    {
      installation_configuration: "ducted",
      net_payment_ex_gst_aud: "2999.999999999",
    },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-ESS-2026",
    "F4-SINGLE",
    "2026-07-01",
    {
      installation_configuration: "ducted",
      net_payment_ex_gst_aud: "3000",
    },
  ));
});

test("F4 requires 30 kW and applies the commercial threshold rows", () => {
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "F4-SINGLE",
    "2026-07-01",
    { cooling_capacity_kw: "29.999999999" },
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "F4-SINGLE",
    "2026-07-01",
    { cooling_efficiency_value: "6.999999999" },
  ));
  assert.doesNotThrow(() => estimate(
    "NSW-ESS-2026",
    "F4-SINGLE",
    "2026-07-01",
    { cooling_capacity_kw: "30", cooling_efficiency_value: "7" },
  ));
});

test("D17 and D19 map BCA zones 2-6 to HP3-AU and 7-8 to HP5-AU", () => {
  const d17Hp3 = estimate("NSW-ESS-2026", "D17", "2026-07-01", { bca_climate_zone: "6" });
  const d17Hp5 = estimate("NSW-ESS-2026", "D17", "2026-07-01", { bca_climate_zone: "7" });
  assert.equal(d17Hp3.trace.find((entry) => entry.key === "baseline_a")?.output, "23.18");
  assert.equal(d17Hp5.trace.find((entry) => entry.key === "baseline_a")?.output, "25.43");

  const d19Hp3 = estimate("NSW-ESS-2026", "D19", "2026-07-01", { bca_climate_zone: "2" });
  const d19Hp5 = estimate("NSW-ESS-2026", "D19", "2026-07-01", { bca_climate_zone: "8" });
  assert.equal(d19Hp3.trace.find((entry) => entry.key === "gas_savings")?.output, "28.029");
  assert.equal(d19Hp5.trace.find((entry) => entry.key === "gas_savings")?.output, "31.65");
});

test("D17-D20 payment gates fail closed and permitted HEER exemptions are explicit", () => {
  for (const activityCode of ["D17", "D18", "D19", "D20"]) {
    assertError("NSW_INPUT_INVALID", () => estimate(
      "NSW-ESS-2026",
      activityCode,
      "2026-07-01",
      { net_payment_ex_gst_aud: "199.999999999" },
    ));
    assert.doesNotThrow(() => estimate(
      "NSW-ESS-2026",
      activityCode,
      "2026-07-01",
      { net_payment_ex_gst_aud: "0", payment_exemption: "exempt_energy" },
    ));
  }
});

test("D19 and D20 retain negative electricity savings when combining fuel contributions", () => {
  for (const activityCode of ["D19", "D20"]) {
    const result = estimate("NSW-ESS-2026", activityCode, "2026-07-01");
    assert.match(result.trace.find((entry) => entry.key === "electricity_savings")?.output ?? "", /^-/);
    assert.ok(BigInt(result.output.quantity) > BigInt(0));
  }
});

test("effective-date windows, exact request keys and decimal syntax fail closed", () => {
  assertError("NSW_EFFECTIVE_DATE_UNSUPPORTED", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2026-06-30",
  ));
  assertError("NSW_EFFECTIVE_DATE_UNSUPPORTED", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2027-01-01",
  ));
  assertError("NSW_INPUT_INVALID", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2026-07-01",
    { annual_supplementary_energy_gj: "1e2" },
  ));
  assertError("NSW_ESTIMATE_INVALID", () => estimateCreditexNswProgram({
    programCode: "NSW-ESS-2026",
    activityCode: "D17",
    effectiveDate: "2026-07-01",
    inputs: defaultInputs("NSW-ESS-2026", "D17"),
    inventedRate: "1",
  }));
});

test("jurisdiction, current registry and non-formula eligibility confirmations are mandatory", () => {
  assertError("NSW_ELIGIBILITY_NOT_CONFIRMED", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2026-07-01",
    { nsw_site_confirmed: "no" },
  ));
  assertError("NSW_PRODUCT_DATA_NOT_CONFIRMED", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2026-07-01",
    { product_registry_eligibility_confirmed: "no" },
  ));
  assertError("NSW_ELIGIBILITY_NOT_CONFIRMED", () => estimate(
    "NSW-ESS-2026",
    "D17",
    "2026-07-01",
    { all_non_formula_requirements_confirmed: "no" },
  ));
});

test("canonical decimal normalization and deterministic evidence produce stable hashes", () => {
  const first = estimate("NSW-ESS-2026", "D17", "2026-07-01", {
    annual_supplementary_energy_gj: "1.0",
    annual_auxiliary_electricity_gj: "0.20",
  });
  const second = estimate("NSW-ESS-2026", "D17", "2026-07-01", {
    annual_supplementary_energy_gj: "1",
    annual_auxiliary_electricity_gj: "0.2",
  });
  assert.equal(first.inputHash, second.inputHash);
  assert.equal(first.traceHash, second.traceHash);
  assert.equal(first.outputHash, second.outputHash);
  assert.equal(first.receiptHash, second.receiptHash);
});

test("non-executable methods have explicit blocked status instead of placeholder estimates", () => {
  const statuses = new Set(CREDITEX_NSW_BLOCKED_ACTIVITIES.map((item) => item.status));
  assert.deepEqual(
    [...statuses].sort(),
    ["expired", "external_dataset_required", "not_commenced", "outside_bounded_slice", "suspended"],
  );
  assertError("NSW_ACTIVITY_NOT_SUPPORTED", () => estimateCreditexNswProgram({
    programCode: "NSW-PDRS-2026",
    activityCode: "V2G1",
    effectiveDate: "2026-09-01",
    inputs: {},
  }));
});
