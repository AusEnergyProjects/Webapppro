import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CreditexOfficialProductError,
  creditexSresCalculationBlocker,
  deriveCreditexNswOfficialProductInputs,
  deriveCreditexVeuOfficialProductInputs,
  officialProductKindsForNswProductKinds,
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

test("NSW administrator lists cannot be substituted with generic CER battery products", () => {
  assert.deepEqual(
    officialProductKindsForNswProductKinds(["battery_energy_storage_system"]),
    [],
  );
  assert.deepEqual(
    unresolvedNswProductKinds(["battery_energy_storage_system"]),
    ["battery_energy_storage_system"],
  );
  for (const activityCode of ["BESS1", "BESS2", "BESS3", "BESS4", "BESS5"]) {
    assert.equal(
      creditexNswActivityDefinition("NSW-PDRS-2026", activityCode).calculationStatus,
      "official_registry_required",
    );
  }
  for (const activityCode of ["D17", "D18", "D19", "D20"]) {
    assert.equal(
      creditexNswActivityDefinition("NSW-ESS-2026", activityCode).calculationStatus,
      "official_registry_required",
    );
  }
});

test("SRES paths with incomplete controlled component evidence fail closed", () => {
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
  assert.match(ui, /Boolean\(productBlocker\)/);
  assert.match(ui, /Official product evidence required/);
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
      "VEU_AND_GEMS",
    );
  }
  const refrigerator = product("refrigerator_freezer", {
    refrigeratorGroup: "6C",
    refrigeratorDesignation: "Freezer",
    compartmentTypes: "Freezer",
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
      [product("refrigerator_freezer", {
        ...refrigerator.attributes,
        refrigeratorDesignation: "Cooled appliance",
      })],
    ),
    officialError,
  );

  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "24",
      { scenario: "tampered" },
      [product("television", { starRating: 6.5, screenAreaCm2: 4_500 })],
    ).scenario,
    "24A",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "25",
      { scenario: "tampered" },
      [product("clothes_dryer", {
        starRating: 8,
        capacityKg: 8,
        isStandaloneClothesDryer: true,
      })],
    ).scenario,
    "25A",
  );
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "25",
      { scenario: "25A" },
      [product("clothes_dryer", {
        starRating: 8,
        capacityKg: 8,
        isStandaloneClothesDryer: false,
      })],
    ),
    officialError,
  );
});

test("product-backed estimates require a defensible approval start and the API uses strict derivation", () => {
  assert.throws(
    () => deriveCreditexVeuOfficialProductInputs(
      "24",
      { scenario: "24A" },
      [product(
        "television",
        { starRating: 7, screenAreaCm2: 5_000 },
        { eligibleFrom: "" },
      )],
    ),
    officialError,
  );

  const route = fs.readFileSync(
    new URL("../src/app/api/creditex/program-estimates/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /activity\.calculationStatus === "official_registry_required"/);
  assert.match(route, /deriveCreditexNswOfficialProductInputs\(/);
  assert.match(route, /deriveCreditexVeuOfficialProductInputs\(/);
  assert.match(
    route,
    /\["VEU", "VEU_AND_GEMS"\]\.includes\(activity\.productRegistry\)/,
  );
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
