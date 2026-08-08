import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_DEFERRED_ACTIVITIES,
  CREDITEX_VEU_PART_44_APPLICATION_GUIDE,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";
import {
  CreditexVeuEstimateError,
  estimateCreditexVeu,
} from "../src/lib/creditex-veu-calculator-estimator.ts";

const PRODUCT = {
  registry: "VEU",
  activityCategory: "44A",
  productId: "PART44-TEST",
  status: "Approved",
  effectiveFrom: "2026-03-31",
  effectiveTo: "",
  sourceSnapshotHash: `sha256:${"c".repeat(64)}`,
};

function inputs(overrides = {}) {
  return {
    scenario: "44A(i)",
    climate_zone: "4",
    storage_configuration: "modelled_storage",
    number_of_heat_pumps: "1",
    number_of_tanks: "1",
    total_heat_pump_thermal_capacity_kw: "5",
    existing_system_thermal_capacity_kw: "5",
    total_storage_volume_litres: "425",
    annual_energy_savings_percent: "60",
    commercial_peak_load_mj_per_day: "42",
    hp_electricity_gj_per_year: "5",
    hp_gas_gj_per_year: "0",
    refrigerant_gwp: "675",
    refrigerant_charge_kg: "1",
    delivery_temperature_c: "45",
    warranty_years: "5",
    as_nzs_2712_status: "certified",
    incumbent_equipment_age_years: "10",
    incumbent_decommissioning_evidence_confirmed: "yes",
    installation_and_model_evidence_confirmed: "yes",
    co_payment_per_installed_product_aud: "10000",
    installation_count: "1",
    ...overrides,
  };
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function estimate(activityInputs) {
  return estimateCreditexVeu({
    activityCode: "44",
    installationDate: "2026-08-09",
    inputs: withoutUndefined(activityInputs),
    product: PRODUCT,
  });
}

function assertError(code, callback, pattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CreditexVeuEstimateError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("Part 44 catalogue pins Specification v25 and official Application Guide v2.2", () => {
  const definition = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(({ activityCode }) => activityCode === "44");
  assert.ok(definition);
  assert.deepEqual(definition.scenarios, ["44A(i)", "44A(ii)", "44A(iii)"]);
  assert.equal(definition.productRegistry, "VEU");
  assert.match(definition.formulaKey, /guide-v2\.2/);
  assert.deepEqual(definition.supportingSources, [CREDITEX_VEU_PART_44_APPLICATION_GUIDE]);
  assert.equal(CREDITEX_VEU_PART_44_APPLICATION_GUIDE.publishedOn, "2026-03-31");
  assert.match(CREDITEX_VEU_PART_44_APPLICATION_GUIDE.pages, /pages 19-20/);
  assert.ok(!CREDITEX_VEU_DEFERRED_ACTIVITIES.some(({ activityCode }) => activityCode === "44"));
});

test("Part 44 derives RefElec from exact guide factors instead of a rounded coefficient", () => {
  const result = estimate(inputs());
  const reference = result.trace.find(({ key }) => key === "reference_electricity");
  assert.equal(reference.operation, "365 x 0.905 x 1.05 x ComPeakLoad / 1000");
  assert.equal(reference.output.exactFraction, "5826933/400000");
  assert.equal(reference.output.decimal, "14.5673325");
  assert.equal(result.inputSnapshot.referenceElectricityGjPerYear, "5826933/400000");
  assert.equal(result.inputSnapshot.applicationGuideVersion, "2.2");
  assert.deepEqual(result.supportingSources, [CREDITEX_VEU_PART_44_APPLICATION_GUIDE]);
});

test("Part 44 executes all three official emissions equations exactly", () => {
  const gas = estimate(inputs());
  const electric = estimate(inputs({ scenario: "44A(ii)" }));
  const fresh = estimate(inputs({
    scenario: "44A(iii)",
    existing_system_thermal_capacity_kw: undefined,
    incumbent_equipment_age_years: undefined,
    incumbent_decommissioning_evidence_confirmed: undefined,
  }));
  assert.equal(gas.output.exactFraction, "47312212877/6304000000");
  assert.equal(electric.output.exactFraction, "513408223/32000000");
  assert.equal(fresh.output.exactFraction, "43438452877/6800000000");
  assert.match(gas.trace.find(({ key }) => key === "reference_emissions").operation, /0\.788/);
  assert.match(electric.trace.find(({ key }) => key === "reference_emissions").operation, /EEF x RefElec \/ 3\.6/);
  assert.match(fresh.trace.find(({ key }) => key === "reference_emissions").operation, /0\.85/);
});

test("Part 44 applies capacity, load and storage-lifetime factors at exact boundaries", () => {
  const reduced = estimate(inputs({
    storage_configuration: "existing_storage",
    existing_storage_requirements_confirmed: "yes",
    total_heat_pump_thermal_capacity_kw: "8",
    existing_system_thermal_capacity_kw: "4",
    commercial_peak_load_mj_per_day: "84",
  }));
  assert.equal(reduced.trace.find(({ key }) => key === "capacity_factor").output.exactFraction, "1/2");
  assert.equal(reduced.trace.find(({ key }) => key === "load_factor").output.exactFraction, "1/2");
  assert.equal(reduced.inputSnapshot.storageConfiguration, "existing_storage");
  const threshold = estimate(inputs({
    total_heat_pump_thermal_capacity_kw: "10",
    commercial_peak_load_mj_per_day: "1000",
  }));
  assert.equal(threshold.trace.find(({ key }) => key === "load_factor").output.exactFraction, "1/1");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({
    scenario: "44A(iii)",
    storage_configuration: "existing_storage",
    existing_storage_requirements_confirmed: "yes",
    existing_system_thermal_capacity_kw: undefined,
    incumbent_equipment_age_years: undefined,
    incumbent_decommissioning_evidence_confirmed: undefined,
  })), /cannot use the existing-storage pathway/i);
});

test("Part 44 fails closed on every prescribed product and installation boundary", () => {
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ total_storage_volume_litres: "424.99" })), /at least 425 litres/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ annual_energy_savings_percent: "59.99" })), /at least 60%/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ delivery_temperature_c: "44.99" })), /minimum delivery temperature of 45/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ warranty_years: "4.99" })), /five-year product warranty/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ as_nzs_2712_status: "not_applicable_over_700_litres" })), /require accredited AS\/NZS 2712/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ incumbent_equipment_age_years: "9.99" })), /at least 10 years old/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate(inputs({ co_payment_per_installed_product_aud: "9999.99" })), /minimum co-payment of \$10,000/i);
});

test("Part 44 allows the over-700-litre certification/warranty branch and seals deterministic receipts", () => {
  const activityInputs = inputs({
    total_storage_volume_litres: "701",
    warranty_years: "0",
    as_nzs_2712_status: "not_applicable_over_700_litres",
  });
  const first = estimate(activityInputs);
  const second = estimate(activityInputs);
  assert.equal(first.receiptHash, second.receiptHash);
  assert.equal(first.inputSnapshot.averageStorageVolumeLitres, "701/1");
  assert.equal(first.inputSnapshot.asNzs2712Status, "not_applicable_over_700_litres");
});
