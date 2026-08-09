import assert from "node:assert/strict";
import test from "node:test";

import {
  CreditexOfficialProductError,
  deriveCreditexNswOfficialProductInputs,
  deriveCreditexVeuOfficialProductInputs,
  officialProductInputKeysForNswActivity,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
  officialVeuProductCategoryNumbersForActivity,
  unresolvedNswProductKinds,
} from "../src/lib/creditex-official-product-registry.ts";

function selection(productKind, attributes, eligibleFrom = "2026-07-01") {
  return { productKind, eligibleFrom, attributes };
}

function notEligible(error) {
  return error instanceof CreditexOfficialProductError
    && error.code === "OFFICIAL_PRODUCT_NOT_ELIGIBLE"
    && error.status === 409;
}

test("NSW water-heater kinds and formula overrides resolve only to TESSA authority", () => {
  assert.deepEqual(
    officialProductKindsForNswProductKinds([
      "heat_pump_water_heater",
      "solar_water_heater",
    ]),
    ["nsw_heat_pump_water_heater", "nsw_solar_water_heater"],
  );
  assert.deepEqual(
    unresolvedNswProductKinds([
      "heat_pump_water_heater",
      "solar_water_heater",
      "unsupported_product",
    ]),
    ["unsupported_product"],
  );
  for (const activityCode of ["D17", "D18", "D19", "D20"]) {
    assert.deepEqual(officialProductInputKeysForNswActivity(activityCode), [
      "system_size",
      "annual_supplementary_energy_gj",
      "annual_auxiliary_electricity_gj",
      "product_registry_eligibility_confirmed",
    ]);
  }
});

test("D17-D20 derive exact TESSA activity, zone, size, Bs and Be without caller overrides", () => {
  const heatPump = selection("nsw_heat_pump_water_heater", {
    tessaAcceptedActivities: "D17,D19",
    zone3SystemSize: "Small",
    zone3BsGjPerYear: 1.25,
    zone3BeGjPerYear: 0,
    zone5SystemSize: "Medium",
    zone5BsGjPerYear: 2.5,
    zone5BeGjPerYear: 0.4,
  });
  const zone3 = deriveCreditexNswOfficialProductInputs(
    "NSW-ESS-2026",
    "D17",
    {
      system_size: "small",
      bca_climate_zone: "6",
      annual_supplementary_energy_gj: "999",
      annual_auxiliary_electricity_gj: "999",
    },
    [heatPump],
  );
  assert.equal(zone3.system_size, "small");
  assert.equal(zone3.annual_supplementary_energy_gj, "1.25");
  assert.equal(zone3.annual_auxiliary_electricity_gj, "0");
  assert.equal(zone3.product_registry_eligibility_confirmed, "yes");

  const zone5 = deriveCreditexNswOfficialProductInputs(
    "NSW-ESS-2026",
    "D19",
    { system_size: "medium", bca_climate_zone: "7" },
    [heatPump],
  );
  assert.equal(zone5.annual_supplementary_energy_gj, "2.5");
  assert.equal(zone5.annual_auxiliary_electricity_gj, "0.4");

  const solar = selection("nsw_solar_water_heater", {
    tessaAcceptedActivities: "D18,D20",
    zone3SystemSize: "Small",
    zone3BsGjPerYear: 1.75,
    zone3BeGjPerYear: 0.2,
  });
  const solarInputs = deriveCreditexNswOfficialProductInputs(
    "NSW-ESS-2026",
    "D20",
    { system_size: "small" },
    [solar],
  );
  assert.equal(solarInputs.annual_supplementary_energy_gj, "1.75");
  assert.equal(solarInputs.annual_auxiliary_electricity_gj, "0.2");

  assert.throws(
    () => deriveCreditexNswOfficialProductInputs(
      "NSW-ESS-2026",
      "D17",
      { system_size: "medium", bca_climate_zone: "5" },
      [heatPump],
    ),
    notEligible,
  );
  assert.throws(
    () => deriveCreditexNswOfficialProductInputs(
      "NSW-ESS-2026",
      "D18",
      { system_size: "small" },
      [selection("nsw_solar_water_heater", {
        tessaAcceptedActivities: "D20",
        zone3SystemSize: "Small",
        zone3BsGjPerYear: 1,
        zone3BeGjPerYear: 0.2,
      })],
    ),
    notEligible,
  );
  assert.throws(
    () => deriveCreditexNswOfficialProductInputs(
      "NSW-ESS-2026",
      "D18",
      { system_size: "small" },
      [selection("nsw_solar_water_heater", {
        tessaAcceptedActivities: "D18",
        zone3SystemSize: "Small",
        zone3BsGjPerYear: 1,
        zone3BeGjPerYear: null,
      })],
    ),
    notEligible,
  );
});

test("BESS3 and BESS4 never substitute CEC RatedDCPower for AC inverter output", () => {
  const battery = selection("cec_battery", {
    nominalBatteryCapacityKwh: 10,
    cecPublishedUsableCapacityKwh: 9,
    cecRatedDcPowerKw: 5,
  });
  const bess1 = deriveCreditexNswOfficialProductInputs(
    "NSW-PDRS-2026",
    "BESS1",
    {},
    [battery],
  );
  assert.equal(bess1.nominal_battery_capacity_kwh, "10");
  assert.equal(bess1.battery_inverter_output_kw, undefined);
  for (const activityCode of ["BESS3", "BESS4"]) {
    assert.throws(
      () => deriveCreditexNswOfficialProductInputs(
        "NSW-PDRS-2026",
        activityCode,
        {},
        [battery],
      ),
      notEligible,
    );
  }
});

test("VEU Activity 15 maps and derives against the exact caller scenario", () => {
  assert.deepEqual(
    officialProductKindsForVeuActivity("15"),
    ["veu_weather_sealing"],
  );
  assert.deepEqual(
    officialVeuProductCategoryNumbersForActivity("15"),
    ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "15H"],
  );
  assert.deepEqual(
    officialProductKindsForVeuActivity("15", "15C"),
    ["veu_weather_sealing"],
  );
  assert.deepEqual(
    officialVeuProductCategoryNumbersForActivity("15", "15C"),
    ["15C"],
  );
  assert.deepEqual(
    officialVeuProductCategoryNumbersForActivity("15", "15Z"),
    [],
  );

  const selected15C = selection("veu_weather_sealing", {
    veuProductCategoryNumber: "15C",
    warrantyYears: 5,
  });
  const derived = deriveCreditexVeuOfficialProductInputs(
    "15",
    { scenario: "15C", installation_count: "2" },
    [selected15C],
  );
  assert.equal(derived.scenario, "15C");
  assert.equal(derived.warranty_years, "5");
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "15",
      { scenario: "15D", installation_count: "2" },
      [selected15C],
    ),
    notEligible,
  );
});

test("VEU packaged air conditioners derive the same governed source metrics as single systems", () => {
  const packaged = selection("veu_air_conditioner", {
    veuProductCategoryNumber: "6D",
    veuProductConfiguration: "Packaged",
    veuProductConfigurationClass: "packaged",
    gemsHspfMixedResidential: 4.3,
    gemsTcspfMixedResidential: 6.2,
    gemsHspfColdResidential: 3.8,
    gemsTcspfColdResidential: 5.4,
    refrigerantType: "R-32",
    ratedHeatingCapacityKw: 12,
    ratedCoolingCapacityKw: 10,
  });
  const derived = deriveCreditexVeuOfficialProductInputs(
    "6",
    {
      premises: "residential",
      location_class: "regional_hot",
      outdoor_heating_capacity_kw: "999",
      outdoor_cooling_capacity_kw: "999",
      same_oem_confirmed: "yes",
    },
    [packaged],
  );
  assert.equal(derived.category, "6D");
  assert.equal(derived.configuration, "packaged");
  assert.equal(derived.rated_heating_capacity_kw, "12");
  assert.equal(derived.rated_cooling_capacity_kw, "10");
  assert.equal(derived.outdoor_heating_capacity_kw, undefined);
  assert.equal(derived.outdoor_cooling_capacity_kw, undefined);
  assert.equal(derived.same_oem_confirmed, undefined);
  assert.equal(derived.hspf_upgrade, "4.3");
  assert.equal(derived.tcspf_upgrade, "6.2");
  assert.equal(derived.hspf_cold_eligibility, "3.8");
  assert.equal(derived.tcspf_cold_eligibility, "5.4");
  assert.equal(derived.refrigerant_gwp, "675");
  assert.equal(derived.performance_basis, "gems");

  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "6",
      { premises: "residential", location_class: "regional_hot" },
      [selection("veu_air_conditioner", {
        ...packaged.attributes,
        gemsTcspfColdResidential: null,
      })],
    ),
    notEligible,
  );
});
