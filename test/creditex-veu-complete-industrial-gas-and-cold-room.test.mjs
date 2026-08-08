import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_DEFERRED_ACTIVITIES,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";
import {
  CreditexVeuEstimateError,
  estimateCreditexVeu,
} from "../src/lib/creditex-veu-calculator-estimator.ts";

function estimate(activityCode, inputs, options = {}) {
  const request = {
    activityCode,
    installationDate: options.installationDate ?? "2026-08-09",
    inputs,
  };
  if (Object.hasOwn(options, "product")) request.product = options.product;
  return estimateCreditexVeu(request);
}

function assertError(code, callback, pattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CreditexVeuEstimateError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

function part37(overrides = {}) {
  return {
    incumbent_nominal_gas_consumption_mj_per_h: "1000",
    replacement_nominal_gas_consumption_mj_per_h: "1000",
    incumbent_equipment_age_years: "10",
    incumbent_manufacture_period: "1990_or_later",
    incumbent_burner_age_band: "up_to_10_years",
    replacement_gross_thermal_efficiency_percent: "80",
    replacement_control_system: "not_required",
    ...overrides,
  };
}

function part38(overrides = {}) {
  return {
    scenario: "38A(ii)",
    incumbent_nominal_gas_consumption_mj_per_h: "1000",
    replacement_nominal_gas_consumption_mj_per_h: "1000",
    incumbent_equipment_age_years: "10",
    part_j5_2d_refurbishment: "no",
    incumbent_manufacture_period: "1990_or_later",
    incumbent_burner_age_band: "up_to_10_years",
    replacement_gross_thermal_efficiency_percent: "85",
    replacement_control_system: "not_required",
    ...overrides,
  };
}

test("catalogue exposes activities 37-43 as governed product-free formulas", () => {
  const definitions = CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter(({ activityCode }) =>
    ["37", "38", "39", "40", "41", "42", "43"].includes(activityCode));
  assert.deepEqual(definitions.map(({ activityCode }) => activityCode), ["37", "38", "39", "40", "41", "42", "43"]);
  for (const definition of definitions) {
    assert.equal(definition.productRegistry, "none");
    assert.deepEqual(definition.productPerformanceInputs, []);
    assert.ok(definition.inputDefinitions.length > 0);
    assert.ok(definition.inputDefinitions.every(({ source }) => source !== "approved_product"));
  }
  assert.ok(!CREDITEX_VEU_DEFERRED_ACTIVITIES.some(({ activityCode }) =>
    activityCode === "37-42" || activityCode === "43"));
});

test("Part 37 independently covers every Table 37.3 DEI branch", () => {
  const vectors = [
    ["1989_or_earlier", "over_10_years", "80", "6112947/62500"],
    ["1989_or_earlier", "over_10_years", "85", "12338679/62500"],
    ["1989_or_earlier", "up_to_10_years", "80", "2503827/31250"],
    ["1989_or_earlier", "up_to_10_years", "85", "5616693/31250"],
    ["1990_or_later", "over_10_years", "80", "5616693/62500"],
    ["1990_or_later", "over_10_years", "85", "473697/2500"],
    ["1990_or_later", "up_to_10_years", "80", "45114/625"],
    ["1990_or_later", "up_to_10_years", "85", "2684283/15625"],
  ];
  for (const [manufacture, burnerAge, efficiency, exactFraction] of vectors) {
    const result = estimate("37", part37({
      incumbent_manufacture_period: manufacture,
      incumbent_burner_age_band: burnerAge,
      replacement_gross_thermal_efficiency_percent: efficiency,
    }));
    assert.equal(result.output.exactFraction, exactFraction, `${manufacture}/${burnerAge}/${efficiency}`);
    assert.equal(result.scenario, "37A");
  }
});

test("Part 37 uses the lower equipment consumption and enforces age, efficiency and control thresholds", () => {
  const lowerReplacement = estimate("37", part37({
    incumbent_nominal_gas_consumption_mj_per_h: "1400",
    replacement_nominal_gas_consumption_mj_per_h: "1000",
  }));
  assert.equal(lowerReplacement.inputSnapshot.governedConsumptionMjPerH, "1000/1");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("37", part37({ incumbent_equipment_age_years: "9.99" })), /at least 10 years/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("37", part37({ replacement_gross_thermal_efficiency_percent: "79.99" })), /at least 80%/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("37", part37({
    replacement_nominal_gas_consumption_mj_per_h: "3700.01",
  })), /gas\/air ratio control/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("37", part37({
    replacement_nominal_gas_consumption_mj_per_h: "7500.01",
    replacement_control_system: "electronic_gas_air_ratio",
  })), /combustion trim/i);
});

test("Part 38 independently covers standard and Part J5.2d Table 38.3 branches", () => {
  const vectors = [
    [part38({ incumbent_manufacture_period: "1989_or_earlier", incumbent_burner_age_band: "over_10_years", replacement_gross_thermal_efficiency_percent: "85" }), "2909853/31250"],
    [part38({ incumbent_manufacture_period: "1989_or_earlier", incumbent_burner_age_band: "over_10_years", replacement_gross_thermal_efficiency_percent: "90" }), "6022719/31250"],
    [part38({ incumbent_manufacture_period: "1989_or_earlier", incumbent_burner_age_band: "up_to_10_years", replacement_gross_thermal_efficiency_percent: "85" }), "2323371/31250"],
    [part38({ incumbent_manufacture_period: "1989_or_earlier", incumbent_burner_age_band: "up_to_10_years", replacement_gross_thermal_efficiency_percent: "90" }), "5436237/31250"],
    [part38({ incumbent_manufacture_period: "1990_or_later", incumbent_burner_age_band: "over_10_years", replacement_gross_thermal_efficiency_percent: "85" }), "5165553/62500"],
    [part38({ incumbent_manufacture_period: "1990_or_later", incumbent_burner_age_band: "over_10_years", replacement_gross_thermal_efficiency_percent: "90" }), "5706921/31250"],
    [part38({ incumbent_manufacture_period: "1990_or_later", incumbent_burner_age_band: "up_to_10_years", replacement_gross_thermal_efficiency_percent: "85" }), "2007573/31250"],
    [part38({ incumbent_manufacture_period: "1990_or_later", incumbent_burner_age_band: "up_to_10_years", replacement_gross_thermal_efficiency_percent: "90" }), "5120439/31250"],
    [part38({ part_j5_2d_refurbishment: "yes", incumbent_manufacture_period: undefined, incumbent_burner_age_band: undefined, replacement_gross_thermal_efficiency_percent: "85" }), "248127/6250"],
    [part38({ part_j5_2d_refurbishment: "yes", incumbent_manufacture_period: undefined, incumbent_burner_age_band: undefined, replacement_gross_thermal_efficiency_percent: "90" }), "8729559/62500"],
  ];
  for (const [inputs, exactFraction] of vectors) {
    const cleaned = Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== undefined));
    assert.equal(estimate("38", cleaned).output.exactFraction, exactFraction);
  }
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("38", part38({ replacement_gross_thermal_efficiency_percent: "84.99" })), /requires at least 85%/i);
});

test("Parts 39-42 apply exact caps, equipment branches and lifetimes", () => {
  const part39 = estimate("39", {
    nominal_gas_consumption_mj_per_h: "12000",
    eligibility_requirements_confirmed: "yes",
  });
  assert.equal(part39.inputSnapshot.governedConsumptionMjPerH, "11400/1");
  assert.equal(part39.output.exactFraction, "16714737/62500");

  const part40Steam = estimate("40", {
    equipment_type: "steam_boiler",
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  });
  const part40Water = estimate("40", {
    equipment_type: "hot_water_boiler_or_water_heater",
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  });
  assert.equal(part40Steam.output.exactFraction, "45114/3125");
  assert.equal(part40Water.output.exactFraction, "157899/12500");

  const part41 = estimate("41", {
    incumbent_nominal_gas_consumption_mj_per_h: "12000",
    replacement_nominal_gas_consumption_mj_per_h: "13000",
    incumbent_burner_age_years: "10",
    replacement_control_system: "electronic_gas_air_ratio_with_flue_signal",
  });
  assert.equal(part41.inputSnapshot.governedConsumptionMjPerH, "11400/1");
  assert.equal(part41.output.exactFraction, "137575143/312500");

  const part42Steam = estimate("42", {
    scenario: "42A(i)",
    equipment_type: "steam_boiler",
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  });
  const part42Water = estimate("42", {
    scenario: "42A(i)",
    equipment_type: "hot_water_boiler_or_water_heater",
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  });
  assert.equal(part42Steam.output.exactFraction, "4082817/125000");
  assert.equal(part42Water.output.exactFraction, "3180537/125000");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("42", {
    scenario: "42A(ii)",
    equipment_type: "hot_water_boiler_or_water_heater",
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  }), /only eligible on a gas-fired steam boiler/i);
});

test("Part 43 applies exact 4, 9 and 24 m2 size boundaries and homogeneous system count", () => {
  const base = {
    scenario: "43A",
    geography: "metropolitan",
    operating_temperature_band: "at_or_above_zero_c",
    internal_floor_area_m2: "4",
    system_count: "1",
    eligible_parts_configuration_confirmed: "yes",
  };
  assert.equal(estimate("43", base).output.exactFraction, "982107/250000");
  assert.equal(estimate("43", { ...base, internal_floor_area_m2: "9" }).output.exactFraction, "982107/250000");
  assert.equal(estimate("43", { ...base, internal_floor_area_m2: "9.0001" }).output.exactFraction, "982107/125000");
  assert.equal(estimate("43", { ...base, internal_floor_area_m2: "23.9999" }).output.exactFraction, "982107/125000");
  assert.equal(estimate("43", { ...base, internal_floor_area_m2: "24" }).output.exactFraction, "982107/62500");
  assert.equal(estimate("43", { ...base, system_count: "3" }).output.exactFraction, "2946321/250000");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("43", { ...base, internal_floor_area_m2: "3.9999" }), /at least 4 m2/i);
});

test("Part 43 covers freezer, regional and 43B branches and enforces per-room co-payment", () => {
  const result = estimate("43", {
    scenario: "43B(ii)",
    geography: "regional",
    operating_temperature_band: "below_zero_c",
    internal_floor_area_m2: "24",
    system_count: "1",
    eligible_parts_configuration_confirmed: "yes",
    co_payment_per_cold_room_aud: "500",
  });
  assert.equal(result.output.exactFraction, "5471739/78125");
  assert.equal(result.output.unroundedTonnes, "70.0382592");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("43", {
    scenario: "43B(i)",
    geography: "regional",
    operating_temperature_band: "below_zero_c",
    internal_floor_area_m2: "10",
    system_count: "1",
    eligible_parts_configuration_confirmed: "yes",
    co_payment_per_cold_room_aud: "499.99",
  }), /minimum co-payment of \$500/i);
});

test("product-free activities reject fabricated registry evidence and preserve deterministic receipts", () => {
  const inputs = {
    nominal_gas_consumption_mj_per_h: "1000",
    eligibility_requirements_confirmed: "yes",
  };
  const first = estimate("39", inputs);
  const second = estimate("39", inputs);
  assert.equal(first.receiptHash, second.receiptHash);
  assertError("VEU_PRODUCT_EVIDENCE_INVALID", () => estimate("39", inputs, {
    product: {
      registry: "VEU",
      activityCategory: "39A",
      productId: "FABRICATED",
      status: "Approved",
      effectiveFrom: "2026-01-01",
      effectiveTo: "",
      sourceSnapshotHash: `sha256:${"a".repeat(64)}`,
    },
  }), /no approved-product registry contract/i);
});

test("new formula families seal Version 24 and Version 25 effective dates", () => {
  const v24 = estimate("37", part37(), { installationDate: "2026-07-20" });
  const v25 = estimate("37", part37(), { installationDate: "2026-07-21" });
  assert.equal(v24.specificationVersion, "24.0");
  assert.equal(v24.formulaProfile, "veu-specification-v24.0");
  assert.equal(v25.specificationVersion, "25.0");
  assert.equal(v25.formulaProfile, "veu-specification-v25.0");
  assert.equal(v24.output.exactFraction, v25.output.exactFraction);
  assert.notEqual(v24.receiptHash, v25.receiptHash);
});
