import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";
import {
  aggregateCreditexVeuWaterHeaterQuotes,
  CreditexVeuEstimateError,
  estimateCreditexVeu,
  roundCreditexVeuWholeCertificates,
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
  const premises = overrides.premises ?? "residential";
  return {
    premises,
    prior_relevant_period_water_heater_products: "0",
    incumbent_scenario_requirements_confirmed: "yes",
    ...(premises === "residential"
      ? {
          residential_consumer_fact_sheet_provided: "yes",
          residential_suitability_and_sizing_advice_confirmed: "yes",
        }
      : {}),
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

test("Part 6 quote mode derives multi and VRF capacity from a repeatable indoor-unit list", () => {
  const inputs = part6Inputs({
    scenario: "vii",
    category: "6B(ii)",
    configuration: "multi",
    outdoor_heating_capacity_kw: "25",
    outdoor_cooling_capacity_kw: "25",
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
  });
  delete inputs.rated_heating_capacity_kw;
  delete inputs.rated_cooling_capacity_kw;
  inputs.indoor_units = [
    {
      label: "Living areas",
      model: "INDOOR-35",
      quantity: "4",
      heatingCapacityKw: "3.5",
      coolingCapacityKw: "3.5",
    },
    {
      label: "Bedrooms",
      model: "",
      quantity: "2",
      heatingCapacityKw: "4",
      coolingCapacityKw: "4",
    },
  ];

  const quote = estimateCreditexVeu({
    activityCode: "6",
    installationDate: "2026-10-15",
    estimatePurpose: "quote",
    inputs,
    product: product("VEU", "6B(ii)"),
  });

  assert.equal(quote.inputSnapshot.configuration, "multi");
  assert.equal(quote.inputSnapshot.ratedHeatingCapacityKw, "22/1");
  assert.equal(quote.inputSnapshot.ratedCoolingCapacityKw, "22/1");
  assert.equal(quote.inputSnapshot.indoorUnitQuantity, "6");
  assert.equal(quote.inputSnapshot.indoorUnits.length, 2);
  assert.equal(quote.inputSnapshot.governedHeatingCapacityKw, "20/1");
  assert.equal(quote.inputSnapshot.governedCoolingCapacityKw, "20/1");
  assert.ok(quote.trace.some(({ key }) => key === "connected_indoor_units"));

  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "6",
      installationDate: "2026-10-15",
      inputs: {
        ...inputs,
        same_oem_confirmed: "yes",
        incumbent_scenario_requirements_confirmed: "yes",
        decommissioning_and_disposal_confirmed: "yes",
        residential_consumer_fact_sheet_provided: "yes",
        residential_suitability_and_sizing_advice_confirmed: "yes",
        warranty_years: "5",
        warranty_requirements_confirmed: "yes",
        co_payment_per_installed_product_aud: "3000",
      },
      product: product("VEU", "6B(ii)"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_REQUEST_INVALID"
      && /quote-only indoor-unit list/.test(error.message),
  );
});

test("Part 6 packaged systems use exact selected-row inputs only in quote mode", () => {
  const inputs = part6Inputs({
    scenario: "i",
    category: "6A",
    configuration: "packaged",
    rated_heating_capacity_kw: "8",
    rated_cooling_capacity_kw: "8",
  });
  const quote = estimateCreditexVeu({
    activityCode: "6",
    installationDate: "2026-10-15",
    estimatePurpose: "quote",
    inputs,
    product: product("VEU", "6A"),
  });
  assert.equal(quote.inputSnapshot.configuration, "packaged");
  assert.equal(quote.inputSnapshot.ratedHeatingCapacityKw, "8/1");
  assert.equal(quote.inputSnapshot.ratedCoolingCapacityKw, "8/1");
  assert.equal(quote.inputSnapshot.governedHeatingCapacityKw, "12/5");
  assert.equal(quote.inputSnapshot.governedCoolingCapacityKw, "12/5");
  assert.match(
    quote.trace.find(({ key }) => key === "governed_heating_capacity").operation,
    /approved packaged-system rating/,
  );

  assert.throws(
    () => estimate("6", inputs, product("VEU", "6A"), "2026-10-15"),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_PRODUCT_EVIDENCE_INVALID"
      && /Packaged Part 6 systems/.test(error.message),
  );
});

test("Parts 1 and 3 quote mode shows per-system and repeated identical-system totals", () => {
  const baseInputs = {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(true, { premises: "business" }),
  };
  const perUnit = estimate("1D", baseInputs, product("VEU", "1D"));
  const quote = estimateCreditexVeu({
    activityCode: "1D",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: { ...baseInputs, unit_quantity: "2" },
    product: product("VEU", "1D"),
  });

  assert.equal(quote.output.unitQuantity, "2");
  assert.equal(
    quote.output.perUnit.wholeCertificates,
    perUnit.output.wholeCertificates,
  );
  assert.equal(
    quote.output.wholeCertificates,
    String(BigInt(perUnit.output.wholeCertificates) * 2n),
  );
  assert.equal(quote.inputSnapshot.unitQuantity, "2");
  assert.ok(quote.trace.some(({ key }) => key === "multi_unit_total"));
  assert.equal(quote.certificateActionEnabled, false);

  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "1D",
      installationDate: "2026-08-08",
      inputs: { ...baseInputs, unit_quantity: "2" },
      product: product("VEU", "1D"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_REQUEST_INVALID"
      && /one water-heater activity at a time/.test(error.message),
  );
  for (const unit_quantity of ["0", "11", "1.5"]) {
    assert.throws(
      () => estimateCreditexVeu({
        activityCode: "1D",
        installationDate: "2026-08-08",
        estimatePurpose: "quote",
        inputs: { ...baseInputs, unit_quantity },
        product: product("VEU", "1D"),
      }),
      (error) => error instanceof CreditexVeuEstimateError
        && error.code === "VEU_INPUT_INVALID",
    );
  }
});

test("Schedule 4 water-heater limits require prior property history and enforce the residential and non-residential totals", () => {
  const formulaInputs = {
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
  };
  const residential = waterHeaterEligibility(true);

  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "3C",
      installationDate: "2026-08-08",
      estimatePurpose: "quote",
      inputs: {
        ...formulaInputs,
        ...residential,
        prior_relevant_period_water_heater_products: "not_confirmed",
        unit_quantity: "1",
      },
      product: product("VEU", "3C"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_INPUT_INVALID"
      && /cannot safely assume none/.test(error.message),
  );

  const twoAtAHome = estimateCreditexVeu({
    activityCode: "3C",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: { ...formulaInputs, ...residential, unit_quantity: "2" },
    product: product("VEU", "3C"),
  });
  assert.deepEqual(twoAtAHome.inputSnapshot.schedule4WaterHeaterProductLimit, {
    premises: "residential",
    relevantPeriodStartsOn: "2019-06-10",
    priorInstalledProductCount: "0",
    currentInstallationCount: "2",
    propertyProductCountAfterCurrentInstallations: "2",
    statutoryProductLimit: "2",
  });
  assert.ok(twoAtAHome.supportingSources.some((source) => (
    source.version === "Authorised version 020"
      && source.title === "Victorian Energy Efficiency Target Regulations 2018"
      && /Schedule 4 clauses 1\(b\).+2\(1A\)/.test(source.pages)
  )));

  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "3C",
      installationDate: "2026-08-08",
      estimatePurpose: "quote",
      inputs: {
        ...formulaInputs,
        ...residential,
        prior_relevant_period_water_heater_products: "1",
        unit_quantity: "2",
      },
      product: product("VEU", "3C"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE"
      && /prior product plus 2 current installations would total 3/.test(error.message),
  );

  const fiveAtBusiness = estimateCreditexVeu({
    activityCode: "3C",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: {
      ...formulaInputs,
      ...waterHeaterEligibility(true, { premises: "business" }),
      unit_quantity: "5",
    },
    product: product("VEU", "3C"),
  });
  assert.equal(
    fiveAtBusiness.inputSnapshot.schedule4WaterHeaterProductLimit.relevantPeriodStartsOn,
    "2023-05-31",
  );
  assert.equal(
    fiveAtBusiness.inputSnapshot.schedule4WaterHeaterProductLimit.statutoryProductLimit,
    "5",
  );
  assert.throws(
    () => estimateCreditexVeu({
      activityCode: "3C",
      installationDate: "2026-08-08",
      estimatePurpose: "quote",
      inputs: {
        ...formulaInputs,
        ...waterHeaterEligibility(true, {
          premises: "business",
          prior_relevant_period_water_heater_products: "1",
        }),
        unit_quantity: "5",
      },
      product: product("VEU", "3C"),
    }),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE"
      && /plus 5 current installations would total 6/.test(error.message),
  );
});

test("VEU rounds the combined prescribed-activity reduction once", () => {
  const exactHalf = { numerator: 15n, denominator: 2n };
  const belowHalf = { numerator: 7_485_408n, denominator: 1_000_000n };

  assert.equal(roundCreditexVeuWholeCertificates(exactHalf), "8");
  assert.equal(
    roundCreditexVeuWholeCertificates({ numerator: 15n, denominator: 1n }),
    "15",
  );
  assert.equal(roundCreditexVeuWholeCertificates(belowHalf), "7");
  assert.equal(
    roundCreditexVeuWholeCertificates({
      numerator: 14_970_816n,
      denominator: 1_000_000n,
    }),
    "15",
  );
});

test("Part 3 combines repeated systems before rounding the prescribed activity", () => {
  const baseInputs = {
    climate_zone: "5",
    bs2021_gj_per_year: "3.5",
    be2021_gj_per_year: "0",
    ...waterHeaterEligibility(true),
  };
  const perUnit = estimate("3C", baseInputs, product("VEU", "3C"));
  const quote = estimateCreditexVeu({
    activityCode: "3C",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: { ...baseInputs, unit_quantity: "2" },
    product: product("VEU", "3C"),
  });

  assert.equal(perUnit.output.unroundedTonnes, "7.494165");
  assert.equal(perUnit.output.wholeCertificates, "7");
  assert.equal(quote.output.unroundedTonnes, "14.98833");
  assert.equal(quote.output.wholeCertificates, "15");
  assert.notEqual(quote.output.wholeCertificates, "14");
  assert.match(
    quote.trace.find(({ key }) => key === "multi_unit_total").operation,
    /round the activity total once/,
  );
  assert.ok(quote.supportingSources.some((source) => (
      source.version === "3.20"
      && source.title === "Water Heating and Space Heating and Cooling Activity Guide"
      && source.pages === "printed pages 4 and 47"
  )));
});

test("mixed water-heater models sum exact reductions before one activity rounding", () => {
  const baseInputs = {
    climate_zone: "5",
    bs2021_gj_per_year: "3.5",
    be2021_gj_per_year: "0",
    ...waterHeaterEligibility(true),
    unit_quantity: "1",
  };
  const first = estimateCreditexVeu({
    activityCode: "3C",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: baseInputs,
    product: product("VEU", "3C", { productId: "VEU-WH-MIXED-A" }),
  });
  const second = estimateCreditexVeu({
    activityCode: "3C",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: baseInputs,
    product: product("VEU", "3C", { productId: "VEU-WH-MIXED-B" }),
  });
  const property = aggregateCreditexVeuWaterHeaterQuotes([
    { selectedProductId: "official:mixed-a", unitQuantity: "1", estimate: first },
    { selectedProductId: "official:mixed-b", unitQuantity: "1", estimate: second },
  ]);

  assert.equal(first.output.unroundedTonnes, "7.494165");
  assert.equal(second.output.unroundedTonnes, "7.494165");
  assert.equal(first.output.wholeCertificates, "7");
  assert.equal(second.output.wholeCertificates, "7");
  assert.equal(property.output.unroundedTonnes, "14.98833");
  assert.equal(property.output.wholeCertificates, "15");
  assert.notEqual(
    property.output.wholeCertificates,
    String(BigInt(first.output.wholeCertificates)
      + BigInt(second.output.wholeCertificates)),
  );
  assert.match(
    property.trace.at(-1).operation,
    /round the prescribed activity total once/,
  );
});

test("mixed VEU water-heater quotes preserve per-model arithmetic and one property total", () => {
  const baseInputs = {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(true, { premises: "business" }),
  };
  const first = estimateCreditexVeu({
    activityCode: "1D",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: { ...baseInputs, unit_quantity: "2" },
    product: product("VEU", "1D", { productId: "VEU-WH-A" }),
  });
  const second = estimateCreditexVeu({
    activityCode: "1D",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: {
      ...baseInputs,
      bs2021_gj_per_year: "2",
      unit_quantity: "1",
    },
    product: product("VEU", "1D", { productId: "VEU-WH-B" }),
  });
  const property = aggregateCreditexVeuWaterHeaterQuotes([
    { selectedProductId: "official:wh-a", unitQuantity: "2", estimate: first },
    { selectedProductId: "official:wh-b", unitQuantity: "1", estimate: second },
  ]);

  assert.equal(property.output.unitQuantity, "3");
  assert.equal(
    property.output.wholeCertificates,
    String(
      BigInt(first.output.wholeCertificates)
        + BigInt(second.output.wholeCertificates),
    ),
  );
  assert.equal(property.propertyItems.length, 2);
  assert.equal(property.propertyItems[0].selectedProductId, "official:wh-a");
  assert.equal(property.propertyItems[0].unitQuantity, "2");
  assert.equal(property.propertyItems[1].inputSnapshot.product.productId, "VEU-WH-B");
  assert.equal(property.trace.at(-1).key, "property_total");
  assert.equal(property.certificateActionEnabled, false);
  assert.equal(property.estimatePurpose, "quote");
  assert.match(property.receiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(property.receiptHash, first.receiptHash);

  assert.throws(
    () => aggregateCreditexVeuWaterHeaterQuotes([
      { selectedProductId: "official:wh-a", unitQuantity: "2", estimate: first },
      { selectedProductId: "official:wh-b", unitQuantity: "10", estimate: second },
    ]),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_INPUT_INVALID",
  );
});

test("mixed VEU water-heater aggregation applies the Schedule 4 property limit across model groups", () => {
  const baseInputs = {
    geography: "metropolitan",
    system_size: "small",
    climate_zone: "5",
    bs2021_gj_per_year: "1",
    be2021_gj_per_year: "1",
    ...waterHeaterEligibility(true, {
      premises: "business",
      prior_relevant_period_water_heater_products: "4",
    }),
    unit_quantity: "1",
  };
  const first = estimateCreditexVeu({
    activityCode: "1D",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: baseInputs,
    product: product("VEU", "1D", { productId: "VEU-WH-C" }),
  });
  const second = estimateCreditexVeu({
    activityCode: "1D",
    installationDate: "2026-08-08",
    estimatePurpose: "quote",
    inputs: { ...baseInputs, bs2021_gj_per_year: "2" },
    product: product("VEU", "1D", { productId: "VEU-WH-D" }),
  });

  assert.throws(
    () => aggregateCreditexVeuWaterHeaterQuotes([
      { selectedProductId: "official:wh-c", unitQuantity: "1", estimate: first },
      { selectedProductId: "official:wh-d", unitQuantity: "1", estimate: second },
    ]),
    (error) => error instanceof CreditexVeuEstimateError
      && error.code === "VEU_SYSTEM_INELIGIBLE"
      && /4 prior products plus 2 current installations exceed that limit/.test(error.message),
  );
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

test("an exact one-half VEEC residual rounds up under VEET Act section 18(1A)", () => {
  const result = estimate(
    "46",
    { scenario: "46A" },
    product("VEU", "46A"),
  );
  assert.equal(result.output.exactFraction, "3/2");
  assert.equal(result.output.unroundedTonnes, "1.5");
  assert.equal(result.output.wholeCertificates, "2");
  assert.equal(result.output.roundingStatus, "nearest_whole_applied");
  assert.equal(result.status, "estimate_only_compliance_reconciliation_required");
  assert.equal(result.certificateActionEnabled, false);
  assert.ok(result.supportingSources.some((source) => (
    source.title === "Victorian Energy Efficiency Target Act 2007"
      && /18\(1A\)/.test(source.pages)
  )));
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
