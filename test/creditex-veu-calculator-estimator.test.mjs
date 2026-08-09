import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
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

function waterHeaterEligibility(heatPump, overrides = {}) {
  return {
    premises: "residential",
    incumbent_scenario_requirements_confirmed: "yes",
    residential_consumer_fact_sheet_provided: "yes",
    residential_suitability_and_sizing_advice_confirmed: "yes",
    no_additional_inline_storage_or_system_confirmed: "yes",
    decommissioning_and_disposal_confirmed: "yes",
    co_payment_per_installed_product_aud: "200",
    ...(heatPump
      ? {
          refrigerant_gwp: "675",
          warranty_years: "5",
          warranty_requirements_confirmed: "yes",
        }
      : {}),
    ...overrides,
  };
}

function part6Inputs(overrides = {}) {
  const scenario = overrides.scenario ?? "xi";
  return {
    scenario,
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
    ...(scenario === "xi"
      ? {}
      : {
          incumbent_scenario_requirements_confirmed: "yes",
          decommissioning_and_disposal_confirmed: "yes",
        }),
    residential_consumer_fact_sheet_provided: "yes",
    residential_suitability_and_sizing_advice_confirmed: "yes",
    warranty_years: "5",
    warranty_requirements_confirmed: "yes",
    co_payment_per_installed_product_aud: "3000",
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
    ...waterHeaterEligibility(false),
  }, product("VEU", "1C")],
  ["1D", {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(true),
  }, product("VEU", "1D")],
  ["3C", {
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(true),
  }, product("VEU", "3C")],
  ["3D", {
    climate_zone: "4",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(false),
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

function defaultEvidenceFromCatalogue(activityCode, inputs) {
  if (["37", "38", "39", "40", "41", "42", "43"].includes(activityCode)) {
    return undefined;
  }
  if (activityCode === "31") return product("GEMS", "electric_motor");
  if (activityCode === "32") return product("GEMS", "commercial_refrigerator");
  if (activityCode === "6") return product("VEU", inputs.category);
  if (["15", "22", "24", "25", "27", "28", "30", "33", "34", "35", "46"].includes(activityCode)) {
    return product("VEU", inputs.scenario);
  }
  const category = {
    "13": "13A",
    "14": "14A",
    "17": "17A",
    "26": "26A",
    "36": "36A",
    "44": "44A",
    "48": "48A",
  }[activityCode] || activityCode;
  return product("VEU", category);
}

function governedEligibleInputs(activityCode, defaultInputs) {
  if (["1C", "1D", "3C", "3D"].includes(activityCode)) {
    return {
      ...defaultInputs,
      ...waterHeaterEligibility(activityCode === "1D" || activityCode === "3C"),
    };
  }
  if (activityCode === "6") {
    return {
      ...defaultInputs,
      residential_consumer_fact_sheet_provided: "yes",
      residential_suitability_and_sizing_advice_confirmed: "yes",
      warranty_years: "5",
      warranty_requirements_confirmed: "yes",
      co_payment_per_installed_product_aud: "3000",
    };
  }
  return defaultInputs;
}

test("the bounded catalogue declares one governed executable vector per activity and keeps eligibility confirmations fail-closed by default", () => {
  assert.equal(
    new Set(CREDITEX_VEU_ACTIVITY_DEFINITIONS.map((activity) => activity.activityCode)).size,
    CREDITEX_VEU_ACTIVITY_DEFINITIONS.length,
  );

  for (const activity of CREDITEX_VEU_ACTIVITY_DEFINITIONS) {
    const activityCode = activity.activityCode;
    const defaultInputs = defaultsFromCatalogue(activity);
    const inputs = governedEligibleInputs(activityCode, defaultInputs);
    const evidence = defaultEvidenceFromCatalogue(activityCode, inputs);
    assert.deepEqual(defaultsFromCatalogue(activity), defaultInputs);
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
    if (["1C", "1D", "3C", "3D", "6"].includes(activityCode)) {
      assert.throws(
        () => estimate(activityCode, defaultInputs, evidence),
        (error) => error instanceof CreditexVeuEstimateError
          && error.code === "VEU_SYSTEM_INELIGIBLE",
      );
    }
    const result = estimate(activityCode, inputs, evidence);
    assert.equal(result.activityCode, activityCode);
    assert.equal(result.certificateActionEnabled, false);
    assert.ok(result.trace.length > 0);
    assert.match(result.receiptHash, /^sha256:[a-f0-9]{64}$/);
  }
});

test("the released Part 31 catalogue exposes only the exact GEMS-backed 31A pathway", () => {
  const part31 = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(({ activityCode }) => activityCode === "31");
  assert.ok(part31);
  assert.deepEqual(part31.scenarios, ["31A"]);
  assert.equal(part31.productRegistry, "GEMS");
  const scenario = part31.inputDefinitions.find(({ key }) => key === "scenario");
  assert.deepEqual(scenario.options.map(({ value }) => value), ["31A"]);
  assert.match(scenario.help, /31B VEU pathway remains hidden/i);
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

test("Parts 1 and 3 fail closed on every supported quote and installation eligibility gate", () => {
  const part1dInputs = DEFAULT_VECTORS[1][1];
  const evidence = DEFAULT_VECTORS[1][2];
  const ineligible = [
    [{ incumbent_scenario_requirements_confirmed: "no" }, /incumbent water heater/i],
    [{ residential_consumer_fact_sheet_provided: "no" }, /consumer fact sheet/i],
    [{ residential_suitability_and_sizing_advice_confirmed: "no" }, /fit-for-purpose information/i],
    [{ no_additional_inline_storage_or_system_confirmed: "no" }, /manifold system/i],
    [{ decommissioning_and_disposal_confirmed: "no" }, /incapable of reuse/i],
    [{ co_payment_per_installed_product_aud: "199.99" }, /minimum co-payment of \$200/i],
    [{ refrigerant_gwp: "700" }, /refrigerant GWP below 700/i],
    [{ warranty_years: "4.99" }, /at least five years/i],
    [{ warranty_requirements_confirmed: "no" }, /Australian warranty contact/i],
  ];
  for (const [override, pattern] of ineligible) {
    assert.throws(
      () => estimate("1D", { ...part1dInputs, ...override }, evidence),
      (error) => error instanceof CreditexVeuEstimateError
        && error.code === "VEU_SYSTEM_INELIGIBLE"
        && pattern.test(error.message),
    );
  }

  const business = estimate("3D", {
    ...DEFAULT_VECTORS[3][1],
    premises: "business",
    residential_consumer_fact_sheet_provided: undefined,
    residential_suitability_and_sizing_advice_confirmed: undefined,
  }, DEFAULT_VECTORS[3][2]);
  assert.equal(business.inputSnapshot.premises, "business");
  assert.equal(business.inputSnapshot.residentialConsumerFactSheetProvided, null);
  assert.equal(business.inputSnapshot.residentialSuitabilityAndSizingAdviceConfirmed, null);
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
  assert.equal(beforeRevision.inputSnapshot.minimumCoPaymentAud, "1000/1");
  assert.equal(beforeRevision.inputSnapshot.coPaymentRule, "v24-and-v25-through-2026-09-29");
  assert.equal(revised.formulaProfile, "veu-v25-part6-from-2026-09-30");
  assert.equal(revised.inputSnapshot.governedHeatingCapacityKw, "20/1");
  assert.equal(revised.inputSnapshot.governedCoolingCapacityKw, "20/1");
  assert.equal(revised.inputSnapshot.minimumCoPaymentAud, "3000/1");
  assert.equal(revised.inputSnapshot.coPaymentRule, "v25-multi-split-from-2026-09-30");
  assert.notEqual(beforeRevision.output.exactFraction, revised.output.exactFraction);
});

test("Part 6 enforces site evidence, residential duties and exact dated co-payment categories", () => {
  const incumbent = part6Inputs({ scenario: "i" });
  const gates = [
    [{ incumbent_scenario_requirements_confirmed: "no" }, /Table 6\.1 incumbent-equipment/i],
    [{ decommissioning_and_disposal_confirmed: "no" }, /refrigerant to be lawfully disposed/i],
    [{ residential_consumer_fact_sheet_provided: "no" }, /Consumer Fact Sheet/i],
    [{ residential_suitability_and_sizing_advice_confirmed: "no" }, /fit-for-purpose information/i],
    [{ warranty_years: "4.99" }, /at least five years/i],
    [{ warranty_requirements_confirmed: "no" }, /Australian warranty contact/i],
    [{ refrigerant_gwp: "700" }, /GWP below 700/i],
  ];
  for (const [override, pattern] of gates) {
    assert.throws(
      () => estimate("6", { ...incumbent, ...override }, product("VEU", "6D")),
      (error) => error instanceof CreditexVeuEstimateError
        && error.code === "VEU_SYSTEM_INELIGIBLE"
        && pattern.test(error.message),
    );
  }

  assert.throws(
    () => estimate("6", part6Inputs({ co_payment_per_installed_product_aud: "199.99" }), product("VEU", "6D"), "2026-09-29"),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE"
      && /minimum co-payment of \$200/i.test(error.message),
  );

  const ductedAfterRevision = estimate("6", part6Inputs({
    category: "6A",
    co_payment_per_installed_product_aud: "3000",
  }), product("VEU", "6A"), "2026-09-30");
  assert.equal(ductedAfterRevision.inputSnapshot.minimumCoPaymentAud, "3000/1");
  assert.equal(ductedAfterRevision.inputSnapshot.coPaymentRule, "v25-ducted-from-2026-09-30");

  const nonDuctedAfterRevision = estimate("6", part6Inputs({
    category: "6F",
    rated_heating_capacity_kw: "10",
    rated_cooling_capacity_kw: "10",
    co_payment_per_installed_product_aud: "1000",
  }), product("VEU", "6F"), "2026-09-30");
  assert.equal(nonDuctedAfterRevision.inputSnapshot.minimumCoPaymentAud, "1000/1");
  assert.equal(nonDuctedAfterRevision.inputSnapshot.coPaymentRule, "v25-other-non-ducted-from-2026-09-30");
});

test("future-dated Part 6 quote estimates relax only non-arithmetic evidence", () => {
  const installationDate = "2026-10-15";
  const evidence = product("VEU", "6D", {
    effectiveFrom: "2026-07-21",
    effectiveTo: "2026-12-31",
  });
  const unconfirmed = part6Inputs({
    scenario: "vii",
    incumbent_scenario_requirements_confirmed: "no",
    decommissioning_and_disposal_confirmed: "no",
    residential_consumer_fact_sheet_provided: "no",
    residential_suitability_and_sizing_advice_confirmed: "no",
    warranty_years: "0",
    warranty_requirements_confirmed: "no",
    co_payment_per_installed_product_aud: "0",
  });

  const quote = estimateCreditexVeu({
    activityCode: "6",
    installationDate,
    estimatePurpose: "quote",
    inputs: unconfirmed,
    product: evidence,
  });
  assert.equal(quote.estimatePurpose, "quote");
  assert.equal(quote.eligibilityConfirmed, false);
  assert.equal(quote.specificationVersion, "25.0");
  assert.equal(quote.formulaProfile, "veu-v25-part6-from-2026-09-30");
  assert.equal(quote.inputSnapshot.product.productId, "TEST-6D");
  assert.ok(quote.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "co_payment_per_installed_product_aud" && assumptionApplied,
  ));
  assert.match(quote.receiptHash, /^sha256:[a-f0-9]{64}$/);

  assert.throws(
    () => estimate("6", unconfirmed, evidence, installationDate),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE",
  );
  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "6",
      installationDate,
      estimatePurpose: "compliance",
      inputs: unconfirmed,
      product: evidence,
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE",
  );
});

test("future-dated Part 6 multi and VRF quotes use indoor sums capped by the approved outdoor row", () => {
  const quote = estimateCreditexVeu({
    activityCode: "6",
    installationDate: "2026-10-15",
    estimatePurpose: "quote",
    inputs: part6Inputs({
      scenario: "vii",
      category: "6B(i)",
      configuration: "multi",
      rated_heating_capacity_kw: "18",
      rated_cooling_capacity_kw: "16",
      outdoor_heating_capacity_kw: "12",
      outdoor_cooling_capacity_kw: "10",
      hspf_upgrade: "5",
      tcspf_upgrade: "5",
      hspf_cold_eligibility: "3.4",
      tcspf_cold_eligibility: "4.2",
      same_oem_confirmed: "no",
      incumbent_scenario_requirements_confirmed: "no",
      decommissioning_and_disposal_confirmed: "no",
      residential_consumer_fact_sheet_provided: "no",
      residential_suitability_and_sizing_advice_confirmed: "no",
      warranty_years: "0",
      warranty_requirements_confirmed: "no",
      co_payment_per_installed_product_aud: "0",
    }),
    product: product("VEU", "6B(i)", {
      effectiveFrom: "2026-07-21",
      effectiveTo: "2026-12-31",
    }),
  });

  assert.equal(quote.scenario, "vii");
  assert.equal(quote.inputSnapshot.configuration, "multi");
  assert.equal(quote.inputSnapshot.ratedHeatingCapacityKw, "18/1");
  assert.equal(quote.inputSnapshot.ratedCoolingCapacityKw, "16/1");
  assert.equal(quote.inputSnapshot.outdoorHeatingCapacityKw, "12/1");
  assert.equal(quote.inputSnapshot.outdoorCoolingCapacityKw, "10/1");
  assert.equal(quote.inputSnapshot.governedHeatingCapacityKw, "12/1");
  assert.equal(quote.inputSnapshot.governedCoolingCapacityKw, "10/1");
  assert.ok(quote.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "same_oem_confirmed" && assumptionApplied,
  ));
});

test("quote mode still rejects formula-critical performance, category and product dates", () => {
  const request = {
    activityCode: "6",
    installationDate: "2026-10-15",
    estimatePurpose: "quote",
    inputs: part6Inputs({
      refrigerant_gwp: "700",
      residential_consumer_fact_sheet_provided: "no",
    }),
    product: product("VEU", "6D"),
  };
  assert.throws(
    () => estimateCreditexVeu(request),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE"
      && /GWP below 700/.test(error.message),
  );
  assert.throws(
    () => estimateCreditexVeu({
      ...request,
      inputs: part6Inputs(),
      product: product("VEU", "6A"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_EVIDENCE_INVALID",
  );
  assert.throws(
    () => estimateCreditexVeu({
      ...request,
      inputs: part6Inputs(),
      product: product("VEU", "6D", { effectiveTo: "2026-10-14" }),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_NOT_EFFECTIVE",
  );
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
  }, product("VEU", "48B"));
  assert.equal(part48Replacement.scenario, "48B(i)");
  assert.equal(part48Replacement.inputSnapshot.product.activityCategory, "48B");
  assert.throws(
    () => estimate("48", {
      ...DEFAULT_VECTORS[14][1],
      scenario: "48B(i)",
    }, product("VEU", "48A")),
    /must be 48B/,
  );
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
      activityCode: "47",
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
