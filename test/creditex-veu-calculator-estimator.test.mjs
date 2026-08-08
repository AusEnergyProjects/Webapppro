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

const SNAPSHOT_HASH = `sha256:${"a".repeat(64)}`;

function product(
  registry,
  activityCategory,
  overrides = {},
) {
  return {
    registry,
    activityCategory,
    productId: `TEST-${activityCategory}`,
    status: registry === "VEU" ? "Approved" : "Registered",
    effectiveFrom: "2026-01-01",
    effectiveTo: "",
    sourceSnapshotHash: SNAPSHOT_HASH,
    ...overrides,
  };
}

function estimate(activityCode, inputs, productEvidence, installationDate = "2026-08-08") {
  const request = {
    activityCode,
    installationDate,
    inputs,
  };
  if (productEvidence !== undefined) request.product = productEvidence;
  return estimateCreditexVeu(request);
}

function part6Inputs(overrides = {}) {
  return {
    scenario: "xi",
    category: "6D",
    premises: "residential",
    location_class: "metro_mild",
    configuration: "single",
    rated_heating_capacity_kw: "3.5",
    rated_cooling_capacity_kw: "3.5",
    hspf_upgrade: "6",
    tcspf_upgrade: "7",
    hspf_cold_eligibility: "4.2",
    tcspf_cold_eligibility: "5.4",
    refrigerant_gwp: "675",
    performance_basis: "gems",
    ...overrides,
  };
}

const DEFAULT_VECTORS = [
  ["1C", {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "4",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
  }, product("VEU", "1C")],
  ["1D", {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
  }, product("VEU", "1D")],
  ["3C", {
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
  }, product("VEU", "3C")],
  ["3D", {
    climate_zone: "4",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
  }, product("VEU", "3D")],
  ["6", part6Inputs(), product("VEU", "6D")],
  ["13", {
    location_class: "metro_mild",
    area_m2: "5",
    wers_heating_stars: "4",
  }, product("VEU", "13A")],
  ["14", {
    location_class: "metro_mild",
    area_m2: "5",
    product_type: "glass",
  }, product("VEU", "14A")],
  ["15", {
    scenario: "15A",
    location_class: "metro_mild",
    installation_count: "1",
    warranty_years: "5",
  }, product("VEU", "15A")],
  ["17", {
    geography: "metropolitan",
    installation_count: "1",
  }, product("VEU", "17A")],
  ["22", { scenario: "22A" }, product("VEU", "22A")],
  ["24", { scenario: "24A" }, product("VEU", "24A")],
  ["25", { scenario: "25A" }, product("VEU", "25A")],
  ["26", {
    geography: "metropolitan",
    paec_kwh_per_year: "500",
  }, product("VEU", "26A")],
  ["46", { scenario: "46A" }, product("VEU", "46A")],
  ["48", {
    scenario: "48A(i)",
    geography: "metropolitan",
    climatic_region: "mild",
    area_m2: "100",
  }, product("VEU", "48A")],
];

function defaultsFromCatalogue(activity) {
  const defaults = {};
  for (const definition of activity.inputDefinitions) {
    const condition = definition.showWhen;
    const controllingValue = condition ? defaults[condition.key] : undefined;
    const visible = !condition
      || (condition.oneOf?.includes(controllingValue) ?? true)
        && !(condition.notOneOf?.includes(controllingValue) ?? false);
    if (!visible && definition.omitWhenHidden) continue;
    defaults[definition.key] = definition.defaultValue;
  }
  return defaults;
}

test("the bounded catalogue declares one executable default vector per activity", () => {
  assert.equal(CREDITEX_VEU_ACTIVITY_DEFINITIONS.length, DEFAULT_VECTORS.length);
  assert.equal(
    new Set(CREDITEX_VEU_ACTIVITY_DEFINITIONS.map((activity) => activity.activityCode)).size,
    CREDITEX_VEU_ACTIVITY_DEFINITIONS.length,
  );
  assert.ok(CREDITEX_VEU_DEFERRED_ACTIVITIES.some((activity) => activity.activityCode === "44"));

  for (const [activityCode, inputs, evidence] of DEFAULT_VECTORS) {
    const activity = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) => candidate.activityCode === activityCode);
    assert.ok(activity);
    assert.deepEqual(defaultsFromCatalogue(activity), inputs);
    assert.ok(activity.inputDefinitions.length > 0);
    for (const definition of activity.inputDefinitions) {
      assert.ok(definition.help.length > 20);
      assert.ok(definition.defaultValue.length > 0);
      assert.ok(["operator", "approved_product", "postcode_lookup"].includes(definition.source));
      if (definition.type === "select") {
        assert.ok(definition.options?.some((option) => option.value === definition.defaultValue));
      } else {
        assert.ok(definition.min !== undefined);
        assert.ok(definition.step);
      }
    }
    const result = estimate(activityCode, inputs, evidence);
    assert.equal(result.activityCode, activityCode);
    assert.equal(result.certificateActionEnabled, false);
    assert.ok(result.trace.length > 0);
    assert.match(result.receiptHash, /^sha256:[a-f0-9]{64}$/);
  }
});

test("Parts 1 and 3 use the official factors with exact product Bs and Be inputs", () => {
  const part1c = estimate("1C", DEFAULT_VECTORS[0][1], DEFAULT_VECTORS[0][2]);
  assert.equal(part1c.output.exactFraction, "437409/50000");
  assert.equal(part1c.output.unroundedTonnes, "8.74818");
  assert.equal(part1c.output.wholeCertificates, "9");

  const part1d = estimate("1D", DEFAULT_VECTORS[1][1], DEFAULT_VECTORS[1][2]);
  assert.equal(part1d.output.unroundedTonnes, "6.9954");
  assert.equal(part1d.output.wholeCertificates, "7");

  for (const [index, activityCode] of [[2, "3C"], [3, "3D"]]) {
    const result = estimate(activityCode, DEFAULT_VECTORS[index][1], DEFAULT_VECTORS[index][2]);
    assert.equal(result.output.exactFraction, "497619/50000");
    assert.equal(result.output.unroundedTonnes, "9.95238");
    assert.equal(result.output.wholeCertificates, "10");
  }
});

test("Part 6 executes every incumbent scenario from exact approved-product performance inputs", () => {
  const scenarios = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi"];
  for (const scenario of scenarios) {
    const result = estimate(
      "6",
      part6Inputs({ scenario }),
      product("VEU", "6D"),
    );
    assert.equal(result.scenario, scenario);
    assert.ok(BigInt(result.output.exactFraction.split("/")[0]) > 0n);
    assert.equal(result.trace.at(-1).key, "ghg_reduction");
  }
});

test("Part 6 selects v24, the v25 transition, and the 30 September revision by installation date", () => {
  const multiInputs = part6Inputs({
    category: "6B(i)",
    configuration: "multi",
    rated_heating_capacity_kw: "25",
    rated_cooling_capacity_kw: "25",
    outdoor_heating_capacity_kw: "24",
    outdoor_cooling_capacity_kw: "24",
    hspf_upgrade: "5",
    tcspf_upgrade: "5",
    hspf_cold_eligibility: "3.4",
    tcspf_cold_eligibility: "4.2",
    same_oem_confirmed: "yes",
  });
  const evidence = product("VEU", "6B(i)");
  const v24 = estimate("6", multiInputs, evidence, "2026-07-20");
  const transition = estimate("6", multiInputs, evidence, "2026-07-21");
  const beforeRevision = estimate("6", multiInputs, evidence, "2026-09-29");
  const revised = estimate("6", multiInputs, evidence, "2026-09-30");

  assert.equal(v24.specificationVersion, "24.0");
  assert.equal(v24.formulaProfile, "veu-v24-part6");
  assert.equal(transition.specificationVersion, "25.0");
  assert.equal(transition.formulaProfile, "veu-v25-part6-transition-pre-2026-09-30");
  assert.equal(beforeRevision.inputSnapshot.governedCoolingCapacityKw, "24/1");
  assert.equal(revised.formulaProfile, "veu-v25-part6-from-2026-09-30");
  assert.equal(revised.inputSnapshot.governedHeatingCapacityKw, "20/1");
  assert.equal(revised.inputSnapshot.governedCoolingCapacityKw, "20/1");
  assert.notEqual(beforeRevision.output.exactFraction, revised.output.exactFraction);
});

test("Parts 13, 14, 17, 26 and 48 preserve governed tables and exact arithmetic", () => {
  const part13 = estimate("13", DEFAULT_VECTORS[5][1], DEFAULT_VECTORS[5][2]);
  assert.equal(part13.output.wholeCertificates, "2");

  const part14 = estimate("14", DEFAULT_VECTORS[6][1], DEFAULT_VECTORS[6][2]);
  assert.equal(part14.output.wholeCertificates, "1");

  const part17 = estimate("17", DEFAULT_VECTORS[8][1], DEFAULT_VECTORS[8][2]);
  assert.equal(part17.output.exactFraction, "915147/1250000");
  assert.equal(part17.output.wholeCertificates, "1");

  const part26 = estimate("26", DEFAULT_VECTORS[12][1], DEFAULT_VECTORS[12][2]);
  assert.equal(part26.output.wholeCertificates, "2");

  const part48 = estimate("48", DEFAULT_VECTORS[14][1], DEFAULT_VECTORS[14][2]);
  assert.equal(part48.output.exactFraction, "1764/125");
  assert.equal(part48.output.wholeCertificates, "14");
  const part48Replacement = estimate("48", {
    ...DEFAULT_VECTORS[14][1],
    scenario: "48B(i)",
  }, product("VEU", "48A"));
  assert.equal(part48Replacement.scenario, "48B(i)");
  assert.equal(part48Replacement.inputSnapshot.product.activityCategory, "48A");
});

test("every Part 15 scenario executes only with its governed measure and lifetime inputs", () => {
  for (const scenario of ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "15H"]) {
    const inputs = {
      scenario,
      location_class: "regional_cold",
      ...(scenario === "15B" ? { area_m2: "10" } : { installation_count: "1" }),
      ...(["15F", "15G"].includes(scenario) ? {} : { warranty_years: "5" }),
    };
    const result = estimate("15", inputs, product("VEU", scenario));
    assert.equal(result.scenario, scenario);
    assert.ok(result.output.unroundedTonnes.length > 0);
  }
});

test("fixed-product activities require exact Approved VEU Public Registry evidence", () => {
  for (const [scenario, expected] of [["22A", "0.62"], ["22B", "0.62"], ["22C", "0.71"], ["22D", "0.71"]]) {
    const result = estimate("22", { scenario }, product("VEU", scenario));
    assert.equal(result.output.unroundedTonnes, expected);
    assert.equal(result.output.wholeCertificates, "1");
    assert.match(result.productRegistryUrl, /veu\.esc\.vic\.gov\.au/);
  }
  assert.equal(estimate("24", { scenario: "24A" }, product("VEU", "24A")).output.unroundedTonnes, "0.8");
  assert.equal(estimate("25", { scenario: "25A" }, product("VEU", "25A")).output.unroundedTonnes, "0.54");
  assert.throws(
    () => estimate("24", { scenario: "24A" }, product("GEMS", "24A")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_EVIDENCE_INVALID",
  );
});

test("an exact one-half VEEC tie is exposed unrounded and never guessed", () => {
  const result = estimate(
    "46",
    { scenario: "46A" },
    product("VEU", "46A"),
  );
  assert.equal(result.output.exactFraction, "3/2");
  assert.equal(result.output.unroundedTonnes, "1.5");
  assert.equal(result.output.wholeCertificates, null);
  assert.equal(result.output.roundingStatus, "exact_half_tie_requires_regulator_confirmation");
  assert.equal(result.status, "estimate_only_rounding_tie_unresolved");
  assert.equal(result.certificateActionEnabled, false);
});

test("product status, historical Legacy dates and source snapshot custody fail closed", () => {
  const historical = estimate("17", {
    geography: "metropolitan",
    installation_count: "1",
  }, product("VEU", "17A", {
    status: "Legacy",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2026-07-20",
  }), "2026-07-01");
  assert.equal(historical.inputSnapshot.product.status, "Legacy");
  assert.equal(historical.inputSnapshot.product.effectiveTo, "2026-07-20");

  assert.throws(
    () => estimate("17", {
      geography: "metropolitan",
      installation_count: "1",
    }, product("VEU", "17A", { status: "Legacy" })),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_EVIDENCE_INVALID",
  );
  assert.throws(
    () => estimate("17", {
      geography: "metropolitan",
      installation_count: "1",
    }, product("VEU", "17A", { effectiveTo: "2026-08-07" })),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_NOT_EFFECTIVE",
  );
  assert.throws(
    () => estimate("17", {
      geography: "metropolitan",
      installation_count: "1",
    }, product("VEU", "17A", { sourceSnapshotHash: "unverified" })),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_EVIDENCE_INVALID",
  );
});

test("activity eligibility and numeric boundaries reject unsafe estimates", () => {
  assert.throws(
    () => estimate("1C", {
      geography: "metropolitan",
      system_size: "small",
      climate_zone: "5",
      bs2021_gj_per_year: "1",
      be2021_gj_per_year: "1",
    }, product("VEU", "1C")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE",
  );
  assert.throws(
    () => estimate("6", part6Inputs({
      category: "6G",
      rated_heating_capacity_kw: "45",
      rated_cooling_capacity_kw: "45",
    }), product("VEU", "6G")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE",
  );
  assert.throws(
    () => estimate("6", part6Inputs({
      configuration: "multi",
      outdoor_heating_capacity_kw: "3.5",
      outdoor_cooling_capacity_kw: "3.5",
    }), product("VEU", "6D")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE",
  );
  assert.throws(
    () => estimate("26", {
      geography: "metropolitan",
      paec_kwh_per_year: "1e2",
    }, product("VEU", "26A")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_INPUT_INVALID",
  );
});

test("unsupported dates, activities and extra fields fail closed", () => {
  assert.throws(
    () => estimate("17", {
      geography: "metropolitan",
      installation_count: "1",
    }, product("VEU", "17A"), "2026-06-29"),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_DATE_UNSUPPORTED",
  );
  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "44",
      installationDate: "2026-08-08",
      inputs: {},
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_ACTIVITY_UNSUPPORTED",
  );
  assert.throws(
    () => estimate("17", {
      geography: "metropolitan",
      installation_count: "1",
      invented_factor: "99",
    }, product("VEU", "17A")),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_REQUEST_INVALID",
  );
});

test("identical normalized source and input data produces identical receipts", () => {
  const first = estimate("6", part6Inputs(), product("VEU", "6D"));
  const second = estimate("6", structuredClone(part6Inputs()), structuredClone(product("VEU", "6D")));
  assert.equal(first.inputHash, second.inputHash);
  assert.equal(first.traceHash, second.traceHash);
  assert.equal(first.outputHash, second.outputHash);
  assert.equal(first.receiptHash, second.receiptHash);
});
