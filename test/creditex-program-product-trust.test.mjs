import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CreditexOfficialProductError,
  creditexSresCalculationBlocker,
  deriveCreditexNswOfficialProductInputs,
  deriveCreditexVeuOfficialProductInputs,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
  unresolvedNswProductKinds,
} from "../src/lib/creditex-official-product-registry.ts";
import {
  creditexNswActivityDefinition,
} from "../src/lib/creditex-nsw-program-catalogue.ts";
import {
  estimateCreditexNswProgram,
} from "../src/lib/creditex-nsw-program-estimator.ts";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";

function product(productKind, attributes, overrides = {}) {
  return {
    productKind,
    eligibleFrom: "2026-08-08",
    attributes,
    ...overrides,
  };
}

function officialError(error) {
  return error instanceof CreditexOfficialProductError
    && error.code === "OFFICIAL_PRODUCT_NOT_ELIGIBLE";
}

test("NSW PDRS battery activities use the exact CEC authority while BESS5 remains distinct and unresolved", () => {
  assert.deepEqual(
    officialProductKindsForNswProductKinds(["cec_battery"]),
    ["cec_battery"],
  );
  assert.deepEqual(
    unresolvedNswProductKinds(["cec_battery"]),
    [],
  );
  assert.deepEqual(officialProductKindsForNswProductKinds(["battery"]), []);
  assert.deepEqual(unresolvedNswProductKinds(["battery"]), ["battery"]);
  for (const activityCode of ["BESS1", "BESS2", "BESS3", "BESS4"]) {
    const activity = creditexNswActivityDefinition(
      "NSW-PDRS-2026",
      activityCode,
    );
    assert.deepEqual(activity.productKinds, ["cec_battery"]);
    assert.equal(
      activity.calculationStatus,
      "official_registry_required",
    );
  }
  const bess5 = creditexNswActivityDefinition("NSW-PDRS-2026", "BESS5");
  assert.deepEqual(
    bess5.productKinds,
    ["administrator_recorded_bess5_system"],
  );
  assert.deepEqual(
    officialProductKindsForNswProductKinds(bess5.productKinds),
    [],
  );
  assert.deepEqual(
    unresolvedNswProductKinds(bess5.productKinds),
    ["administrator_recorded_bess5_system"],
  );
  assert.equal(bess5.calculationStatus, "official_registry_required");
  for (const activityCode of ["D17", "D18", "D19", "D20"]) {
    assert.equal(
      creditexNswActivityDefinition("NSW-ESS-2026", activityCode).calculationStatus,
      "official_registry_required",
    );
  }
});

test("BESS1 and BESS2 discard caller capacity tampering and apply the Rule-governed 90 percent usable capacity", () => {
  const activity = creditexNswActivityDefinition("NSW-PDRS-2026", "BESS1");
  const defaults = Object.fromEntries(activity.inputDefinitions.map((definition) => [
    definition.key,
    definition.defaultValue,
  ]));
  const selection = product("cec_battery", {
    nominalBatteryCapacityKwh: 10,
    cecPublishedUsableCapacityKwh: 9.6,
    cecRatedDcPowerKw: 5,
  });
  const firstInputs = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "BESS1",
    defaults,
    [selection],
  );
  const tamperedInputs = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "BESS1",
    {
      ...defaults,
      nominal_battery_capacity_kwh: "999999",
      product_registry_eligibility_confirmed: "no",
    },
    [selection],
  );
  assert.equal(firstInputs.nominal_battery_capacity_kwh, "10");
  assert.equal(tamperedInputs.nominal_battery_capacity_kwh, "10");
  assert.equal(tamperedInputs.product_registry_eligibility_confirmed, "yes");

  const first = estimateCreditexNswProgram({
    programCode: "NSW-PDRS-2026",
    activityCode: "BESS1",
    effectiveDate: "2026-08-08",
    inputs: firstInputs,
  });
  const tampered = estimateCreditexNswProgram({
    programCode: "NSW-PDRS-2026",
    activityCode: "BESS1",
    effectiveDate: "2026-08-08",
    inputs: tamperedInputs,
  });
  assert.deepEqual(tampered.output, first.output);
  assert.equal(tampered.receiptHash, first.receiptHash);
  assert.equal(
    first.trace.find((entry) => entry.key === "usable_battery_capacity")?.output,
    "9",
  );

  const bess2 = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "BESS2",
    {
      ...Object.fromEntries(
        creditexNswActivityDefinition("NSW-PDRS-2026", "BESS2")
          .inputDefinitions.map((definition) => [
            definition.key,
            definition.defaultValue,
          ]),
      ),
      nominal_battery_capacity_kwh: "1",
    },
    [selection],
  );
  assert.equal(bess2.nominal_battery_capacity_kwh, "10");
});

test("BESS3 and BESS4 reject caller inverter values when the licensed CEC row has only RatedDCPower", () => {
  const selection = product("cec_battery", {
    nominalBatteryCapacityKwh: 40,
    cecPublishedUsableCapacityKwh: 36,
    cecRatedDcPowerKw: 10,
  });
  for (const activityCode of ["BESS3", "BESS4"]) {
    const activity = creditexNswActivityDefinition(
      "NSW-PDRS-2026",
      activityCode,
    );
    const callerInputs = Object.fromEntries(activity.inputDefinitions.map(
      (definition) => [definition.key, definition.defaultValue],
    ));
    callerInputs.battery_inverter_output_kw = "999999";
    assert.throws(
      () => deriveCreditexNswOfficialProductInputs(
        "NSW-PDRS-2026",
        activityCode,
        callerInputs,
        [selection],
      ),
      (error) => officialError(error)
        && /PDRS Battery Inverter Output/.test(error.message),
    );
  }
});

test("strict SRES paths fail closed while quote mode uses the bounded quote estimator", () => {
  for (const technology of [
    "solar_pv",
    "solar_battery",
    "small_wind",
    "small_hydro",
  ]) {
    assert.ok(creditexSresCalculationBlocker(technology));
  }
  assert.equal(creditexSresCalculationBlocker("solar_water_heater"), null);
  assert.equal(creditexSresCalculationBlocker("air_source_heat_pump"), null);

  const route = fs.readFileSync(
    new URL("../src/app/api/creditex/stc-estimates/route.ts", import.meta.url),
    "utf8",
  );
  const ui = fs.readFileSync(
    new URL("../src/components/CreditexSresCalculator.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /creditexSresCalculationBlocker\(technology\)/);
  assert.match(route, /OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE/);
  assert.match(route, /estimatePurpose !== "quote"/);
  assert.match(route, /estimateCreditexSresQuote\(database, body\)/);
  assert.match(ui, /estimatePurpose: "quote"/);
  assert.match(ui, /productKey: productCascade\.productKey/);
  assert.match(ui, /disabled=\{estimateBusy\}/);
  assert.doesNotMatch(ui, /Official product evidence required/);
});

test("NSW RF2 and pool-pump formula values are derived and caller tampering is discarded", () => {
  const rf2 = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    {
      product_class: "15",
      tec_kwh_per_24h: "999999",
      product_eei: "1",
      product_registry_eligibility_confirmed: "no",
    },
    [product("commercial_refrigerator", {
      productClassNumber: 12,
      totalEnergyConsumptionKwhPer24h: 8.25,
      energyEfficiencyIndex: 60,
    })],
  );
  assert.equal(rf2.product_class, "12");
  assert.equal(rf2.tec_kwh_per_24h, "8.25");
  assert.equal(rf2.product_eei, "60");
  assert.equal(rf2.product_registry_eligibility_confirmed, "yes");

  const pump = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "SYS2",
    {
      maximum_tested_input_w: "1",
      paec_kwh_per_year: "1",
      daily_run_time_hours: "1",
    },
    [product("pool_pump", {
      starRating: 5,
      maximumTestedInputW: 950,
      projectedAnnualEnergyConsumptionKwh: 640,
      dailyRunTimeHours: 8,
    })],
  );
  assert.deepEqual(
    {
      maximum: pump.maximum_tested_input_w,
      paec: pump.paec_kwh_per_year,
      runTime: pump.daily_run_time_hours,
    },
    { maximum: "950", paec: "640", runTime: "8" },
  );
  assert.throws(
    () => deriveCreditexNswOfficialProductInputs(
      "NSW-ESS-2026",
      "D5",
      {},
      [product("pool_pump", {
        starRating: 3.5,
        maximumTestedInputW: 950,
        projectedAnnualEnergyConsumptionKwh: 640,
      })],
    ),
    officialError,
  );
});

test("tampering with official RF2 inputs cannot change the final certificate result", () => {
  const activity = creditexNswActivityDefinition(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
  );
  const defaults = Object.fromEntries(activity.inputDefinitions.map((definition) => [
    definition.key,
    definition.defaultValue,
  ]));
  const selection = product("commercial_refrigerator", {
    productClassNumber: 12,
    totalEnergyConsumptionKwhPer24h: 8.25,
    energyEfficiencyIndex: 60,
  });
  const firstInputs = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    defaults,
    [selection],
  );
  const tamperedInputs = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "RF2-REMOTE",
    {
      ...defaults,
      product_class: "15",
      tec_kwh_per_24h: "999999",
      product_eei: "1",
      product_registry_eligibility_confirmed: "no",
    },
    [selection],
  );
  const first = estimateCreditexNswProgram({
    programCode: "NSW-PDRS-2026",
    activityCode: "RF2-REMOTE",
    effectiveDate: "2026-08-08",
    inputs: firstInputs,
  });
  const tampered = estimateCreditexNswProgram({
    programCode: "NSW-PDRS-2026",
    activityCode: "RF2-REMOTE",
    effectiveDate: "2026-08-08",
    inputs: tamperedInputs,
  });
  assert.deepEqual(tampered.output, first.output);
  assert.equal(tampered.receiptHash, first.receiptHash);
});

test("NSW HVAC class, capacity, input, efficiencies and annual energy are official-product controlled", () => {
  const attributes = {
    sourceProductClass: "Class 8",
    ratedCoolingCapacityKw: 8.2,
    ratedHeatingCapacityKw: 9.1,
    ratedCoolingInputKw: 1.25,
    residentialTcspfMixed: 6.2,
    residentialHspfCold: 4.3,
    residentialCoolingEnergyColdKwh: 520,
    residentialHeatingEnergyColdKwh: 810,
    aeeR: 4.5,
    acop: 4.6,
  };
  const pdrs = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "HVAC1-SINGLE",
    {
      product_class: "12",
      cooling_efficiency_basis: "rated_aeer_no_tcspf",
      cooling_efficiency_value: "99",
      rated_cooling_capacity_kw: "99",
      rated_cooling_input_kw: "0.01",
    },
    [product("air_conditioner", attributes)],
  );
  assert.equal(pdrs.product_class, "8");
  assert.equal(pdrs.cooling_efficiency_basis, "tcspf");
  assert.equal(pdrs.cooling_efficiency_value, "6.2");
  assert.equal(pdrs.rated_cooling_capacity_kw, "8.2");
  assert.equal(pdrs.rated_cooling_input_kw, "1.25");

  const ess = deriveCreditexNswOfficialProductInputs(
    "NSW-ESS-2026",
    "D16-SINGLE",
    {
      site_postcode: "2600",
      product_class: "12",
      cooling_efficiency_value: "99",
      heating_efficiency_value: "99",
      cooling_capacity_kw: "99",
      heating_capacity_kw: "99",
      cooling_annual_energy_kwh: "1",
      heating_annual_energy_kwh: "1",
    },
    [product("air_conditioner", attributes)],
  );
  assert.equal(ess.product_class, "8");
  assert.equal(ess.heating_efficiency_basis, "hspf");
  assert.equal(ess.heating_efficiency_value, "4.3");
  assert.equal(ess.cooling_capacity_kw, "8.2");
  assert.equal(ess.heating_capacity_kw, "9.1");
  assert.equal(ess.cooling_annual_energy_kwh, "520");
  assert.equal(ess.heating_annual_energy_kwh, "810");

  assert.throws(
    () => deriveCreditexNswOfficialProductInputs(
      "NSW-PDRS-2026",
      "HVAC1-SINGLE",
      {},
      [product("air_conditioner", {
        ...attributes,
        ratedCoolingInputKw: null,
      })],
    ),
    officialError,
  );
});

test("VEU 22, 24 and 25 derive the scenario and enforce every published product threshold", () => {
  for (const activityCode of ["22", "24", "25"]) {
    assert.equal(
      CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(
        (activity) => activity.activityCode === activityCode,
      )?.productRegistry,
      "VEU",
    );
  }
  assert.deepEqual(
    officialProductKindsForVeuActivity("22"),
    ["veu_refrigerator_freezer_listing"],
  );
  assert.deepEqual(
    officialProductKindsForVeuActivity("24"),
    ["veu_television_listing"],
  );
  assert.deepEqual(
    officialProductKindsForVeuActivity("25"),
    ["veu_clothes_dryer_listing"],
  );
  const refrigerator = product("veu_refrigerator_freezer_listing", {
    veuProductCategoryNumber: "22C",
    totalVolumeLitres: 300,
    starRating: 4.5,
  });
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "22",
      { scenario: "22A" },
      [refrigerator],
    ).scenario,
    "22C",
  );
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "22",
      { scenario: "22A" },
      [product("veu_refrigerator_freezer_listing", {
        ...refrigerator.attributes,
        veuProductCategoryNumber: "24A",
      })],
    ),
    officialError,
  );

  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "24",
      { scenario: "tampered" },
      [product("veu_television_listing", {
        veuProductCategoryNumber: "24A",
        starRating: 6.5,
        screenAreaCm2: 4_500,
      })],
    ).scenario,
    "24A",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "25",
      { scenario: "tampered" },
      [product("veu_clothes_dryer_listing", {
        veuProductCategoryNumber: "25A",
        starRating: 8,
        capacityKg: 8,
      })],
    ).scenario,
    "25A",
  );
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "25",
      { scenario: "25A" },
      [product("veu_clothes_dryer_listing", {
        veuProductCategoryNumber: "25A",
        starRating: 8,
        capacityKg: 0,
      })],
    ),
    officialError,
  );
});

test("VEU water-heater model values are installation-zone controlled and ambiguous branches fail closed", () => {
  const mediumHeatPump = product("veu_water_heater", {
    veuProductCategoryNumber: "1D",
    veuSystemSize: "Medium",
    bs2021Zone4StepDownLoadGjPerYear: 5.1,
    be2021Zone4StepDownLoadGjPerYear: 2.2,
    zone4AnnualEnergySavings: 65,
    bs2021Zone5StepDownLoadGjPerYear: 6.3,
    be2021Zone5StepDownLoadGjPerYear: 2.9,
    zone5AnnualEnergySavings: 64,
  });
  const derived = deriveCreditexVeuOfficialProductInputs(
    "1D",
    {
      climate_zone: "5",
      system_size: "small",
      bs2021_gj_per_year: "999",
      be2021_gj_per_year: "999",
    },
    [mediumHeatPump],
  );
  assert.equal(derived.system_size, "medium");
  assert.equal(derived.bs2021_gj_per_year, "6.3");
  assert.equal(derived.be2021_gj_per_year, "2.9");

  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "1C",
      { climate_zone: "4" },
      [product("veu_water_heater", {
        ...mediumHeatPump.attributes,
        veuProductCategoryNumber: "1C",
      })],
    ),
    officialError,
  );
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "3C",
      { climate_zone: "5" },
      [product("veu_water_heater", {
        ...mediumHeatPump.attributes,
        veuProductCategoryNumber: "3C",
        veuSystemSize: "Small",
      })],
    ),
    officialError,
  );
});

test("VEU Part 6 derives the exact single-system category, capacities, seasonal metrics and refrigerant", () => {
  const selection = product("veu_air_conditioner", {
    veuProductCategoryNumber: "6D",
    veuProductConfiguration: "Single split system",
    veuProductConfigurationClass: "single",
    ratedHeatingCapacityKw: 3.8,
    ratedCoolingCapacityKw: 3.5,
    refrigerantType: "R-32",
    gemsHspfColdResidential: 4.8,
    gemsTcspfColdResidential: 5.9,
    gemsHspfMixedResidential: 0,
    calculatedHspfMixedResidential: 5.1,
    gemsTcspfMixedResidential: 6.2,
  });
  const derived = deriveCreditexVeuOfficialProductInputs(
    "6",
    {
      premises: "residential",
      location_class: "regional_hot",
      category: "6A",
      configuration: "multi",
      rated_heating_capacity_kw: "99",
      rated_cooling_capacity_kw: "99",
      outdoor_heating_capacity_kw: "99",
      outdoor_cooling_capacity_kw: "99",
      same_oem_confirmed: "yes",
    },
    [selection],
  );
  assert.equal(derived.category, "6D");
  assert.equal(derived.configuration, "single");
  assert.equal(derived.rated_heating_capacity_kw, "3.8");
  assert.equal(derived.rated_cooling_capacity_kw, "3.5");
  assert.equal(derived.hspf_upgrade, "5.1");
  assert.equal(derived.tcspf_upgrade, "6.2");
  assert.equal(derived.hspf_cold_eligibility, "4.8");
  assert.equal(derived.tcspf_cold_eligibility, "5.9");
  assert.equal(derived.refrigerant_gwp, "675");
  assert.equal(derived.performance_basis, "mixed_gems_and_calculated");
  assert.equal(derived.outdoor_heating_capacity_kw, undefined);
  assert.equal(derived.same_oem_confirmed, undefined);

  const multi = deriveCreditexVeuOfficialProductInputs(
    "6",
    {
      premises: "residential",
      location_class: "metro_mild",
      rated_heating_capacity_kw: "12.5",
      rated_cooling_capacity_kw: "11.25",
      same_oem_confirmed: "no",
    },
    [product("veu_air_conditioner", {
      ...selection.attributes,
      veuProductConfiguration: "Multiple split - variable refrigerant flow",
      veuProductConfigurationClass: "multi",
    })],
  );
  assert.equal(multi.configuration, "multi");
  assert.equal(multi.rated_heating_capacity_kw, "12.5");
  assert.equal(multi.rated_cooling_capacity_kw, "11.25");
  assert.equal(multi.outdoor_heating_capacity_kw, "3.8");
  assert.equal(multi.outdoor_cooling_capacity_kw, "3.5");
  assert.equal(multi.hspf_upgrade, "4.8");
  assert.equal(multi.tcspf_upgrade, "5.9");
  assert.equal(multi.refrigerant_gwp, "675");
  assert.equal(multi.same_oem_confirmed, "no");
});

test("VEU Parts 27, 34 and 35 cross-check exact lighting product power and controls", () => {
  const part27 = deriveCreditexVeuOfficialProductInputs(
    "27",
    {
      scenario: "27B",
      approved_upgrade_lcp_w: "999",
      approved_upgrade_control_profile:
        "occupancy_1_to_2_and_programmable_dimmer",
    },
    [product("veu_activity_27_product", {
      veuProductCategoryNumber: "27B",
      victorianLampCircuitPowerW: 23.6,
      occupancySensor: true,
      programmableDimmer: true,
    })],
  );
  assert.equal(part27.approved_upgrade_lcp_w, "23.6");
  assert.equal(
    part27.approved_upgrade_control_profile,
    "occupancy_1_to_2_and_programmable_dimmer",
  );
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "27",
      {
        scenario: "27B",
        approved_upgrade_control_profile: "programmable_dimmer",
      },
      [product("veu_activity_27_product", {
        veuProductCategoryNumber: "27B",
        victorianLampCircuitPowerW: 23.6,
        occupancySensor: true,
        programmableDimmer: true,
      })],
    ),
    officialError,
  );

  const part34 = deriveCreditexVeuOfficialProductInputs(
    "34",
    {
      scenario: "34C",
      approved_upgrade_lcp_w: "999",
      approved_upgrade_occupancy_sensor_scope: "three_to_six_luminaires",
      approved_upgrade_daylight_linked_control: "no",
      approved_upgrade_programmable_dimmer: "no",
      approved_upgrade_manual_dimmer: "no",
      approved_upgrade_voltage_reduction_unit: "yes",
      replacement_method: "retrofit",
      upgrade_rated_lifetime_hours: "1",
    },
    [product("veu_commercial_lighting", {
      veuProductCategoryNumber: "34C",
      lampCircuitPowerW: null,
      nominalLampPowerW: 42,
      reportedLifetimeL70Hours: 60_000,
      occupancySensor: true,
      daylightLinkedControl: true,
      programmableDimmer: false,
      manualDimmer: true,
      voltageReductionUnit: false,
    })],
  );
  assert.equal(part34.approved_upgrade_lcp_w, "42");
  assert.equal(part34.upgrade_rated_lifetime_hours, "60000");
  assert.equal(part34.approved_upgrade_daylight_linked_control, "yes");
  assert.equal(part34.approved_upgrade_manual_dimmer, "yes");
  assert.equal(part34.approved_upgrade_voltage_reduction_unit, "no");
  assert.equal(
    part34.approved_upgrade_occupancy_sensor_scope,
    "three_to_six_luminaires",
  );

  const part35 = deriveCreditexVeuOfficialProductInputs(
    "35",
    {
      scenario: "35B",
      approved_upgrade_lcp_w: "999",
      approved_upgrade_control_profile: "programmable_dimmer",
      replacement_method: "retrofit",
      upgrade_rated_lifetime_hours: "1",
    },
    [product("veu_activity_35_product", {
      veuProductCategoryNumber: "35B",
      lampCircuitPowerW: 16.4,
      reportedLifetimeL70Hours: 50_000,
      occupancySensor: false,
      programmableDimmer: true,
    })],
  );
  assert.equal(part35.approved_upgrade_lcp_w, "16.4");
  assert.equal(part35.upgrade_rated_lifetime_hours, "50000");
});

test("VEU product-backed fields for 13, 15, 26, 30, 31, 33 and 36 discard caller tampering", () => {
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "13",
      { wers_heating_stars: "99" },
      [product("veu_double_glazing", {
        veuProductCategoryNumber: "13A",
        wersHeatingStars: 5.5,
      })],
    ).wers_heating_stars,
    "5.5",
  );
  const sealing = deriveCreditexVeuOfficialProductInputs(
    "15",
    { scenario: "15H", warranty_years: "99" },
    [product("veu_weather_sealing", {
      veuProductCategoryNumber: "15C",
      warrantyYears: 4,
    })],
  );
  assert.equal(sealing.scenario, "15C");
  assert.equal(sealing.warranty_years, "4");
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "26",
      { paec_kwh_per_year: "1" },
      [product("veu_pool_pump", {
        veuProductCategoryNumber: "26A",
        paecKwhPerYear: 640,
      })],
    ).paec_kwh_per_year,
    "640",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "30",
      { scenario: "30B" },
      [product("veu_in_home_display", {
        veuProductCategoryNumber: "30A",
      })],
    ).scenario,
    "30A",
  );
  const motor = deriveCreditexVeuOfficialProductInputs(
    "31",
    { scenario: "31B", rated_output_kw: "185" },
    [product("electric_motor", { ratedOutputKw: 7.5 })],
  );
  assert.equal(motor.scenario, "31A");
  assert.equal(motor.rated_output_kw, "7.5");
  const fan = deriveCreditexVeuOfficialProductInputs(
    "33",
    { scenario: "33B", rotor_motor_type: "external", input_power_w: "1", output_power_w: "1" },
    [product("veu_activity_33_product", {
      veuProductCategoryNumber: "33A",
      rotorMotorType: "Internal",
      inputPowerW: 24,
      outputPowerW: 15,
    })],
  );
  assert.equal(fan.scenario, "33A");
  assert.equal(fan.rotor_motor_type, "internal");
  assert.equal(fan.input_power_w, "24");
  assert.equal(fan.output_power_w, "15");
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "36",
      { scenario: "36A(ii)" },
      [product("veu_activity_36_product", {
        veuProductCategoryNumber: "36A",
      })],
    ).scenario,
    "36A(ii)",
  );
});

test("VEU Part 44 derives zone-specific guide outputs and exact ESC refrigerant GWP", () => {
  const derived = deriveCreditexVeuOfficialProductInputs(
    "44",
    {
      climate_zone: "5",
      number_of_heat_pumps: "99",
      number_of_tanks: "99",
      annual_energy_savings_percent: "1",
      commercial_peak_load_mj_per_day: "1",
      hp_electricity_gj_per_year: "1",
      hp_gas_gj_per_year: "99",
      refrigerant_gwp: "9999",
      refrigerant_charge_kg: "99",
    },
    [product("veu_commercial_water_heater", {
      veuProductCategoryNumber: "44A",
      numberOfHeatPumps: 2,
      numberOfTanks: 3,
      totalHeatPumpThermalCapacityKw: 30,
      totalSystemTankVolumeLitres: 1_500,
      zone5AnnualEnergySavings: 67,
      zone5CommercialPeakLoadMjPerDay: 1_250,
      zone5HpElectricityGjPerYear: 120,
      zone5HpGasGjPerYear: 0,
      refrigerantType: "R-513A",
      refrigerantChargeKg: 4.2,
    })],
  );
  assert.equal(derived.number_of_heat_pumps, "2");
  assert.equal(derived.number_of_tanks, "3");
  assert.equal(derived.total_heat_pump_thermal_capacity_kw, "30");
  assert.equal(derived.total_storage_volume_litres, "1500");
  assert.equal(derived.annual_energy_savings_percent, "67");
  assert.equal(derived.commercial_peak_load_mj_per_day, "1250");
  assert.equal(derived.hp_electricity_gj_per_year, "120");
  assert.equal(derived.hp_gas_gj_per_year, "0");
  assert.equal(derived.refrigerant_gwp, "629");
  assert.equal(derived.refrigerant_charge_kg, "4.2");
});

test("product-backed estimates require a defensible approval start and the API uses strict derivation", () => {
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "24",
      { scenario: "24A" },
      [product(
        "veu_television_listing",
        {
          veuProductCategoryNumber: "24A",
          starRating: 7,
          screenAreaCm2: 5_000,
        },
        { eligibleFrom: "" },
      )],
    ),
    officialError,
  );

  const route = fs.readFileSync(
    new URL("../src/app/api/creditex/program-estimates/route.ts", import.meta.url),
    "utf8",
  );
  const governedCalculator = fs.readFileSync(
    new URL(
      "../src/components/CreditexGovernedProgramCalculator.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    governedCalculator,
    /registryBlocked = activity\.calculationStatus/,
    "a mapped official registry must become usable as soon as its platform snapshot is current",
  );
  assert.doesNotMatch(governedCalculator, /const registryBlocked/);
  assert.match(governedCalculator, /estimatePurpose: "quote"/);
  assert.match(governedCalculator, /disabled=\{busy\}/);
  assert.doesNotMatch(
    route,
    /activity\.calculationStatus === "official_registry_required"/,
  );
  assert.match(route, /unresolvedProductKinds\.length > 0/);
  assert.match(route, /deriveCreditexNswOfficialProductInputs\(/);
  assert.match(route, /deriveCreditexVeuOfficialProductInputs\(/);
  assert.match(route, /CREDITEX_VEU_SOURCE_COMPLETE_ACTIVITY_CODES/);
  assert.match(route, /validateOfficialProductSelections\(/);
  assert.match(route, /deriveVeuProductEvidence\(/);
  assert.match(route, /selection\.registryCode !== "veu-approved-products"/);
  assert.match(route, /selection\.approvalStatus !== "approved"/);
  assert.ok(route.includes(
    'sourceSnapshotHash: `sha256:${selection.sourceSha256}`',
  ));
  assert.match(route, /estimateCreditexVeu\(/);
  assert.match(route, /attachRegistryReceipt\(/);
  const nswBranch = route.slice(
    route.indexOf('if (programCode === "NSW-PDRS-2026"'),
    route.indexOf("const requiredProductKinds = officialProductKindsForLocalActivity"),
  );
  assert.ok(nswBranch.length > 0);
  assert.doesNotMatch(
    nswBranch,
    /deriveProductBackedInputs\(/,
  );
});
