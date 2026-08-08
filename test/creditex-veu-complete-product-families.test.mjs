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

const SOURCE_HASH = `sha256:${"b".repeat(64)}`;

function product(registry, activityCategory) {
  return {
    registry,
    activityCategory,
    productId: `${registry}-${activityCategory}`,
    status: registry === "VEU" ? "Approved" : "Registered",
    effectiveFrom: "2026-06-30",
    effectiveTo: "",
    sourceSnapshotHash: SOURCE_HASH,
  };
}

function estimate(activityCode, inputs, evidence) {
  return estimateCreditexVeu({
    activityCode,
    installationDate: "2026-08-09",
    inputs,
    product: evidence,
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

test("catalogue exposes governed formula contracts for Parts 28, 30-33 and 36", () => {
  const expected = ["28", "30", "31", "32", "33", "36"];
  const definitions = CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter(({ activityCode }) =>
    expected.includes(activityCode));
  assert.deepEqual(definitions.map(({ activityCode }) => activityCode), expected);
  const part31 = definitions.find(({ activityCode }) => activityCode === "31");
  assert.equal(part31.productRegistry, "GEMS");
  assert.deepEqual(part31.scenarios, ["31A"]);
  assert.deepEqual(part31.internalExecutableScenarios, ["31B"]);
  assert.equal(definitions.find(({ activityCode }) => activityCode === "32").productRegistry, "GEMS");
  for (const activityCode of expected) {
    assert.ok(!CREDITEX_VEU_DEFERRED_ACTIVITIES.some((item) => item.activityCode === activityCode));
  }
  const part32 = definitions.find(({ activityCode }) => activityCode === "32");
  assert.deepEqual(part32.scenarios, ["32A(i)", "32A(ii)", "32A(iii)"]);
  assert.ok(!part32.scenarios.includes("32A"));
});

test("Part 14 keeps film within current category 14A and changes only its asset life", () => {
  const glass = estimate("14", {
    location_class: "metro_mild",
    area_m2: "5",
    product_type: "glass",
  }, product("VEU", "14A"));
  const film = estimate("14", {
    location_class: "metro_mild",
    area_m2: "5",
    product_type: "film",
  }, product("VEU", "14A"));
  assert.equal(glass.scenario, "14A");
  assert.equal(film.scenario, "14A");
  assert.equal(glass.inputSnapshot.product.activityCategory, "14A");
  assert.equal(film.inputSnapshot.product.activityCategory, "14A");
  assert.equal(BigInt(glass.output.exactFraction.split("/")[0]) * BigInt(film.output.exactFraction.split("/")[1]),
    BigInt(film.output.exactFraction.split("/")[0]) * BigInt(glass.output.exactFraction.split("/")[1]) * 3n);
  assertError("VEU_PRODUCT_EVIDENCE_INVALID", () => estimate("14", {
    location_class: "metro_mild",
    area_m2: "5",
    product_type: "film",
  }, product("VEU", "14B")), /must be 14A/i);
});

function part28(overrides = {}) {
  return {
    scenario: "28A",
    location_class: "metro_mild",
    heater_output_status: "known",
    heater_thermal_output_kw: "18",
    r_value: "1.5",
    ...overrides,
  };
}

test("Part 28 applies exact 18 kW and 28 kW size boundaries plus the unknown branch", () => {
  const evidence = product("VEU", "28A");
  assert.equal(estimate("28", part28(), evidence).output.exactFraction, "200753/25000");
  assert.equal(estimate("28", part28({ heater_thermal_output_kw: "18.0001" }), evidence).inputSnapshot.heaterSizeClass, "medium");
  assert.equal(estimate("28", part28({ heater_thermal_output_kw: "28" }), evidence).inputSnapshot.heaterSizeClass, "medium");
  const large = estimate("28", part28({
    location_class: "regional_cold",
    heater_thermal_output_kw: "28.0001",
  }), evidence);
  assert.equal(large.inputSnapshot.heaterSizeClass, "large");
  assert.equal(large.output.exactFraction, "105584717/5000000");
  const unknown = estimate("28", {
    scenario: "28A",
    location_class: "metro_mild",
    heater_output_status: "unknown",
    r_value: "1.5",
  }, evidence);
  assert.equal(unknown.inputSnapshot.heaterSizeClass, "unknown");
  assert.equal(unknown.output.exactFraction, "200753/25000");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("28", part28({ heater_thermal_output_kw: "9.99" }), evidence), /at least 10 kW/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("28", part28({ r_value: "1.49" }), evidence), /R-value of at least 1.5/i);
});

test("Part 30 resolves gas-reticulation and regional branches exactly", () => {
  const metro = estimate("30", {
    scenario: "30A",
    geography: "metropolitan",
    gas_reticulation: "reticulated",
    installation_count: "1",
  }, product("VEU", "30A"));
  const regional = estimate("30", {
    scenario: "30B",
    geography: "regional",
    gas_reticulation: "not_reticulated",
    installation_count: "2",
  }, product("VEU", "30B"));
  assert.equal(metro.output.exactFraction, "751023/1000000");
  assert.equal(regional.output.exactFraction, "260559/125000");
  assert.equal(regional.inputSnapshot.installationCount, "2/1");
});

const MOTOR_OUTPUTS = [
  "0.75", "1.1", "1.5", "2.2", "3", "4", "5.5", "7.5", "11", "15", "18.5",
  "22", "30", "37", "45", "55", "75", "90", "110", "132", "150", "185",
];
const MOTOR_SAVINGS = {
  "31A": ["0.0249", "0.0326", "0.0400", "0.0545", "0.0666", "0.0792", "0.102", "0.122", "0.214", "0.269", "0.306", "0.361", "0.451", "0.509", "0.620", "0.751", "0.922", "1.15", "1.32", "1.57", "1.78", "2.28"],
  "31B": ["0.0502", "0.0673", "0.0831", "0.121", "0.173", "0.208", "0.263", "0.329", "0.413", "0.523", "0.645", "0.736", "0.889", "1.05", "1.28", "1.49", "1.83", "2.07", "2.39", "2.70", "3.05", "3.53"],
};

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(numerator, denominator = 1n) {
  const divisor = gcd(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}

function decimal(value) {
  const [whole, places = ""] = value.split(".");
  return rational(BigInt(`${whole}${places}`), 10n ** BigInt(places.length));
}

function multiply(...values) {
  return values.reduce((left, right) => rational(left.n * right.n, left.d * right.d), rational(1n));
}

function expectedMotorFraction(savings, lifetime, regionalFactor) {
  const value = multiply(decimal(savings), decimal("0.393"), decimal(lifetime), decimal(regionalFactor));
  return `${value.n}/${value.d}`;
}

test("Part 31 covers every official rated-output savings and lifetime row for both registries", () => {
  for (const scenario of ["31A", "31B"]) {
    const registry = scenario === "31A" ? "GEMS" : "VEU";
    const category = scenario === "31A" ? "electric_motor" : "31B";
    for (let index = 0; index < MOTOR_OUTPUTS.length; index += 1) {
      const lifetime = index <= 3 ? "12" : index <= 7 ? "15" : index <= 13 ? "20" : index <= 17 ? "22" : "25";
      const result = estimate("31", {
        scenario,
        geography: "metropolitan",
        rated_output_kw: MOTOR_OUTPUTS[index],
        installation_count: "1",
        co_payment_per_motor_aud: "200",
      }, product(registry, category));
      assert.equal(
        result.output.exactFraction,
        expectedMotorFraction(MOTOR_SAVINGS[scenario][index], lifetime, "0.98"),
        `${scenario}/${MOTOR_OUTPUTS[index]} kW`,
      );
    }
  }
  assertError("VEU_PRODUCT_EVIDENCE_INVALID", () => estimate("31", {
    scenario: "31A",
    geography: "metropolitan",
    rated_output_kw: "0.75",
    installation_count: "1",
    co_payment_per_motor_aud: "200",
  }, product("VEU", "31A")), /requires GEMS product evidence/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("31", {
    scenario: "31B",
    geography: "metropolitan",
    rated_output_kw: "185",
    installation_count: "1",
    co_payment_per_motor_aud: "199.99",
  }, product("VEU", "31B")), /minimum co-payment of \$200/i);
});

test("Part 32 executes all current equations with exact GEMS inputs and strict class/EEI gates", () => {
  const evidence = product("GEMS", "commercial_refrigerator");
  const scenarioOne = estimate("32", {
    scenario: "32A(i)",
    geography: "metropolitan",
    product_class: "1",
    product_eei: "80",
    total_display_area_m2: "3",
    tec_kwh_per_24h: "10",
    installation_count: "1",
  }, evidence);
  assert.equal(scenarioOne.output.exactFraction, "74378487141/7812500000");
  const lifetimeBoundary = estimate("32", {
    scenario: "32A(i)",
    geography: "metropolitan",
    product_class: "7",
    product_eei: "80",
    total_display_area_m2: "3.3",
    tec_kwh_per_24h: "10",
    installation_count: "1",
  }, evidence);
  assert.equal(lifetimeBoundary.output.exactFraction, "13302144044217/312500000000");
  const scenarioTwo = estimate("32", {
    scenario: "32A(ii)",
    geography: "regional",
    product_class: "5",
    product_eei: "50",
    net_volume_litres: "500",
    tec_kwh_per_24h: "3",
    installation_count: "1",
  }, evidence);
  assert.equal(scenarioTwo.output.exactFraction, "3871973157/781250000");
  const scenarioThree = estimate("32", {
    scenario: "32A(iii)",
    geography: "metropolitan",
    product_class: "3",
    product_eei: "80",
    net_volume_litres: "500",
    tec_kwh_per_24h: "3",
    duty_type: "normal_duty",
    installation_count: "1",
  }, evidence);
  assert.equal(scenarioThree.output.exactFraction, "4168004337/1250000000");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("32", {
    scenario: "32A(ii)", geography: "regional", product_class: "4", product_eei: "50",
    net_volume_litres: "500", tec_kwh_per_24h: "3", installation_count: "1",
  }, evidence), /requires GEMS product class 5/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("32", {
    scenario: "32A(i)", geography: "regional", product_class: "1", product_eei: "81",
    total_display_area_m2: "3", tec_kwh_per_24h: "10", installation_count: "1",
  }, evidence), /below 81/i);
});

test("Part 33 applies NFIP, COP and rotor eligibility exactly", () => {
  const part33A = estimate("33", {
    scenario: "33A",
    geography: "metropolitan",
    rotor_motor_type: "internal",
    input_power_w: "100",
    output_power_w: "100",
    refrigeration_application: "refrigerated_cabinet",
    installation_count: "1",
  }, product("VEU", "33A"));
  assert.equal(part33A.output.exactFraction, "772357425903/500000000000");
  const part33B = estimate("33", {
    scenario: "33B",
    geography: "regional",
    rotor_motor_type: "external",
    input_power_w: "100",
    output_power_w: "100",
    installation_count: "1",
  }, product("VEU", "33B"));
  assert.equal(part33B.output.exactFraction, "75493582983/62500000000");
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("33", {
    scenario: "33A", geography: "metropolitan", rotor_motor_type: "internal",
    input_power_w: "100", output_power_w: "600.01", refrigeration_application: "refrigerated_cabinet",
    installation_count: "1",
  }, product("VEU", "33A")), /no more than 600 W/i);
  assertError("VEU_SYSTEM_INELIGIBLE", () => estimate("33", {
    scenario: "33B", geography: "metropolitan", rotor_motor_type: "external",
    input_power_w: "800.01", output_power_w: "100", installation_count: "1",
  }, product("VEU", "33B")), /no more than 800 W/i);
});

test("Part 36 executes both official installation scenarios and regional factors", () => {
  const metro = estimate("36", {
    scenario: "36A(i)",
    geography: "metropolitan",
    installation_count: "1",
  }, product("VEU", "36A"));
  const regional = estimate("36", {
    scenario: "36A(ii)",
    geography: "regional",
    installation_count: "2",
  }, product("VEU", "36A"));
  assert.equal(metro.output.exactFraction, "1272613/500000");
  assert.equal(regional.output.exactFraction, "6695051/1000000");
  assert.equal(metro.scenario, "36A(i)");
  assert.equal(regional.scenario, "36A(ii)");
});
