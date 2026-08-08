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

const SOURCE_HASH = `sha256:${"d".repeat(64)}`;

function product(activityCategory) {
  return {
    registry: "VEU",
    activityCategory,
    productId: `VEU-${activityCategory}`,
    status: "Approved",
    effectiveFrom: "2026-06-30",
    effectiveTo: "",
    sourceSnapshotHash: SOURCE_HASH,
  };
}

function estimate(activityCode, inputs, evidence) {
  const request = {
    activityCode,
    installationDate: "2026-08-09",
    inputs,
  };
  if (evidence !== undefined) request.product = evidence;
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

function part34Controls(prefix, overrides = {}) {
  return {
    [`${prefix}_occupancy_sensor_scope`]: "none",
    [`${prefix}_daylight_linked_control`]: "no",
    [`${prefix}_programmable_dimmer`]: "no",
    [`${prefix}_manual_dimmer`]: "no",
    [`${prefix}_voltage_reduction_unit`]: "no",
    ...overrides,
  };
}

function part34Base(scenario, overrides = {}) {
  return {
    scenario,
    site_part_j6_status: "not_required",
    geography: "metropolitan",
    space_air_conditioned: "no",
    annual_operating_hours: "3000",
    baseline_lcp_w: "100",
    ...part34Controls("baseline"),
    incumbent_source_count: "1",
    ...(scenario === "34E" ? {} : { upgrade_source_count: "1" }),
    ...overrides,
  };
}

test("catalogue exposes exact governed lighting contracts for Parts 27, 34 and 35", () => {
  const expected = ["27", "34", "35"];
  const definitions = CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter(({ activityCode }) =>
    expected.includes(activityCode));
  assert.deepEqual(definitions.map(({ activityCode }) => activityCode), expected);
  for (const definition of definitions) {
    assert.equal(definition.productRegistry, "VEU");
    assert.ok(!CREDITEX_VEU_DEFERRED_ACTIVITIES.some(({ activityCode }) =>
      activityCode === definition.activityCode));
    assert.ok(definition.inputDefinitions.some(({ source }) => source === "approved_product"));
  }
  const part34 = definitions.find(({ activityCode }) => activityCode === "34");
  assert.match(part34.sourcePages, /Part J6 refurbishment branch not enabled/i);
  assert.deepEqual(part34.scenarios, ["34A", "34B", "34C", "34D", "34E"]);
});

test("Part 27 applies exact Table 27.7 controls, fixed hours and scenario lifetimes", () => {
  const controlUpgrade = estimate("27", {
    scenario: "27A",
    geography: "metropolitan",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_control_profile: "occupancy_1_to_2",
    incumbent_source_count: "2",
    upgrade_source_count: "2",
  }, product("27A"));
  assert.equal(controlUpgrade.output.exactFraction, "1559817/2000000");
  assert.equal(controlUpgrade.inputSnapshot.assetLifetimeYears, "5/1");
  assert.equal(controlUpgrade.inputSnapshot.annualOperatingHours, "4500/1");
  assert.equal(controlUpgrade.inputSnapshot.upgradeControlMultiplier, "11/20");

  const removal = estimate("27", {
    scenario: "27C",
    geography: "regional",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    incumbent_source_count: "1",
    removal_requirements_confirmed: "yes",
  });
  assert.equal(removal.output.exactFraction, "45981/25000");
  assert.equal(removal.inputSnapshot.product, null);
  assert.equal(removal.inputSnapshot.assetLifetimeYears, "10/1");
});

test("Parts 27, 34 and 35 independently sum incumbent and upgrade source quantities", () => {
  const part27 = estimate("27", {
    scenario: "27B",
    geography: "metropolitan",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_lcp_w: "50",
    approved_upgrade_control_profile: "none",
    incumbent_source_count: "4",
    upgrade_source_count: "2",
  }, product("27B"));
  assert.equal(part27.inputSnapshot.incumbentSourceCount, "4/1");
  assert.equal(part27.inputSnapshot.upgradeSourceCount, "2/1");
  assert.equal(part27.trace[0].output.exactFraction, "786/5");
  assert.equal(part27.trace[1].output.exactFraction, "393/10");
  assert.equal(part27.output.exactFraction, "519939/100000");

  const part34 = estimate("34", part34Base("34C", {
    approved_upgrade_lcp_w: "50",
    ...part34Controls("approved_upgrade"),
    replacement_method: "luminaire_replacement",
    incumbent_source_count: "4",
    upgrade_source_count: "2",
  }), product("34C"));
  assert.equal(part34.inputSnapshot.incumbentSourceCount, "4/1");
  assert.equal(part34.inputSnapshot.upgradeSourceCount, "2/1");
  assert.equal(part34.output.exactFraction, "173313/50000");

  const part35 = estimate("35", {
    scenario: "35B",
    geography: "regional",
    area_type: "other",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_lcp_w: "50",
    approved_upgrade_control_profile: "none",
    replacement_method: "luminaire_replacement",
    incumbent_source_count: "4",
    upgrade_source_count: "2",
  }, product("35B"));
  assert.equal(part35.inputSnapshot.incumbentSourceCount, "4/1");
  assert.equal(part35.inputSnapshot.upgradeSourceCount, "2/1");
  assert.equal(part35.output.exactFraction, "15327/12500");
});

test("control-only and delamping scenarios enforce their exact source-count invariants", () => {
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("27", {
    scenario: "27A",
    geography: "metropolitan",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_control_profile: "programmable_dimmer",
    incumbent_source_count: "2",
    upgrade_source_count: "1",
  }, product("27A")), /equal incumbent and upgrade/i);

  for (const scenario of ["34A", "34B"]) {
    assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("34", part34Base(scenario, {
      incumbent_source_count: "2",
      upgrade_source_count: "1",
    }), product(scenario)), /equal incumbent and upgrade/i);
  }
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("35", {
    scenario: "35A",
    geography: "metropolitan",
    area_type: "other",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_control_profile: "programmable_dimmer",
    incumbent_source_count: "2",
    upgrade_source_count: "1",
  }, product("35A")), /equal incumbent and upgrade/i);

  for (const upgradeSourceCount of ["4", "1"]) {
    const pattern = upgradeSourceCount === "4" ? /at least one incumbent/i : /more than half/i;
    assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("34", part34Base("34D", {
      incumbent_source_count: "4",
      upgrade_source_count: upgradeSourceCount,
    })), pattern);
    assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("35", {
      scenario: "35C",
      geography: "metropolitan",
      area_type: "other",
      baseline_lcp_w: "100",
      baseline_control_profile: "none",
      incumbent_source_count: "4",
      upgrade_source_count: upgradeSourceCount,
    }), pattern);
  }

  const part34Delamp = estimate("34", part34Base("34D", {
    retained_upgrade_lcp_w: "50",
    ...part34Controls("retained_upgrade"),
    incumbent_source_count: "4",
    upgrade_source_count: "2",
    removal_requirements_confirmed: "yes",
  }));
  assert.equal(part34Delamp.output.exactFraction, "173313/100000");
  assert.equal(part34Delamp.inputSnapshot.upgradeSourceCount, "2/1");

  const part35Delamp = estimate("35", {
    scenario: "35C",
    geography: "metropolitan",
    area_type: "other",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    retained_upgrade_lcp_w: "50",
    retained_upgrade_control_profile: "none",
    incumbent_source_count: "4",
    upgrade_source_count: "2",
    removal_requirements_confirmed: "yes",
  });
  assert.equal(part35Delamp.output.exactFraction, "57771/100000");
  assert.equal(part35Delamp.inputSnapshot.upgradeSourceCount, "2/1");
});

test("Part 27 enforces scenario-specific product evidence and a real control reduction", () => {
  const inputs = {
    scenario: "27A",
    geography: "metropolitan",
    baseline_lcp_w: "100",
    baseline_control_profile: "occupancy_1_to_2",
    approved_upgrade_control_profile: "none",
    incumbent_source_count: "1",
    upgrade_source_count: "1",
  };
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("27", inputs, product("27A")), /reduce the incumbent control multiplier/i);
  assertError("VEU_PRODUCT_EVIDENCE_INVALID", () => estimate("27", {
    scenario: "27C",
    geography: "metropolitan",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    incumbent_source_count: "1",
    removal_requirements_confirmed: "yes",
  }, product("27C")), /remove product evidence/i);
});

test("Part 34 calculates the exact multiple-control floor and air-conditioning multiplier", () => {
  const result = estimate("34", part34Base("34A", {
    space_air_conditioned: "yes",
    incumbent_source_count: "2",
    upgrade_source_count: "2",
    ...part34Controls("approved_upgrade", {
      approved_upgrade_occupancy_sensor_scope: "one_to_two_luminaires",
      approved_upgrade_daylight_linked_control: "yes",
      approved_upgrade_programmable_dimmer: "yes",
    }),
  }), product("34A"));
  assert.equal(result.inputSnapshot.upgradeControlMultiplier, "2/5");
  assert.equal(result.inputSnapshot.airConditioningMultiplier, "21/20");
  assert.equal(result.output.exactFraction, "3639573/5000000");
});

test("Part 34 uses exact V squared over 240 squared for a voltage reduction unit", () => {
  const inputs = part34Base("34B", {
    ...part34Controls("approved_upgrade", {
      approved_upgrade_voltage_reduction_unit: "yes",
      approved_upgrade_voltage_reduction_unit_output_v: "220",
    }),
    vru_compatibility_confirmed: "yes",
  });
  const result = estimate("34", inputs, product("34B"));
  assert.equal(result.inputSnapshot.upgradeControlMultiplier, "121/144");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("34", {
    ...inputs,
    approved_upgrade_voltage_reduction_unit: "no",
  }, product("34B")), /requires an approved voltage reduction unit/i);
  assertError("VEU_INPUT_INVALID", () => estimate("34", {
    ...inputs,
    approved_upgrade_voltage_reduction_unit_output_v: "240.01",
  }, product("34B")), /must not exceed 240/i);
});

test("Part 34 caps rated life at 30,000 hours and fails closed for Part J6 work", () => {
  const inputs = part34Base("34C", {
    annual_operating_hours: "8500",
    approved_upgrade_lcp_w: "40",
    ...part34Controls("approved_upgrade"),
    replacement_method: "retrofit",
    upgrade_rated_lifetime_hours: "50000",
  });
  const result = estimate("34", inputs, product("34C"));
  assert.equal(result.inputSnapshot.ratedLifetimeHours, "50000/1");
  assert.equal(result.inputSnapshot.assetLifetimeYears, "60/17");
  assert.equal(result.output.exactFraction, "173313/250000");
  assertError("VEU_INPUT_INVALID", () => estimate("34", {
    ...inputs,
    site_part_j6_status: "required",
  }, product("34C")), /valid part j6 status/i);
});

test("Part 34 removal scenarios are product-free and require governed removal evidence", () => {
  const delamping = estimate("34", part34Base("34D", {
    retained_upgrade_lcp_w: "50",
    ...part34Controls("retained_upgrade"),
    incumbent_source_count: "2",
    upgrade_source_count: "1",
    removal_requirements_confirmed: "yes",
  }));
  assert.equal(delamping.inputSnapshot.product, null);
  assert.equal(delamping.inputSnapshot.assetLifetimeYears, "5/1");
  assertError("VEU_PRODUCT_EVIDENCE_INVALID", () => estimate("34", part34Base("34E", {
    removal_requirements_confirmed: "yes",
  }), product("34E")), /remove product evidence/i);
});

test("Part 35 applies exact combined control, operating-hours and rated-life branches", () => {
  const result = estimate("35", {
    scenario: "35B",
    geography: "regional",
    area_type: "road_or_public_outdoor_space",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_lcp_w: "40",
    approved_upgrade_control_profile: "occupancy_1_to_2_and_programmable_dimmer",
    replacement_method: "retrofit",
    upgrade_rated_lifetime_hours: "50000",
    incumbent_source_count: "1",
    upgrade_source_count: "1",
  }, product("35B"));
  assert.equal(result.inputSnapshot.upgradeControlMultiplier, "187/400");
  assert.equal(result.inputSnapshot.assetLifetimeYears, "5/1");
  assert.equal(result.inputSnapshot.annualOperatingHours, "4500/1");
  assert.equal(result.output.exactFraction, "37382553/50000000");

  const removal = estimate("35", {
    scenario: "35C",
    geography: "metropolitan",
    area_type: "other",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    retained_upgrade_lcp_w: "50",
    retained_upgrade_control_profile: "none",
    incumbent_source_count: "2",
    upgrade_source_count: "1",
    removal_requirements_confirmed: "yes",
  });
  assert.equal(removal.inputSnapshot.product, null);
  assert.equal(removal.inputSnapshot.annualOperatingHours, "1000/1");
});

test("lighting receipts are deterministic and reject unsupported extra fields", () => {
  const inputs = {
    scenario: "35A",
    geography: "metropolitan",
    area_type: "other",
    baseline_lcp_w: "100",
    baseline_control_profile: "none",
    approved_upgrade_control_profile: "programmable_dimmer",
    incumbent_source_count: "1",
    upgrade_source_count: "1",
  };
  const first = estimate("35", inputs, product("35A"));
  const second = estimate("35", inputs, product("35A"));
  assert.equal(first.receiptHash, second.receiptHash);
  assert.deepEqual(first.trace, second.trace);
  assertError("VEU_REQUEST_INVALID", () => estimate("35", {
    ...inputs,
    ungoverned_override: "1",
  }, product("35A")), /unsupported Part 35 input field/i);
  assertError("VEU_REQUEST_INVALID", () => estimate("35", {
    ...inputs,
    lighting_source_count: "1",
  }, product("35A")), /lighting_source_count/i);
});
