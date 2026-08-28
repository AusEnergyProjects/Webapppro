import assert from "node:assert/strict";
import test from "node:test";
import {
  ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE,
  REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS,
  allReviewedCertificatePathways,
  currentReviewedCertificatePathwayCoverage,
  currentReviewedPracticalTips,
  isCurrentReviewedProductGuidanceCategory,
  resolveReviewedProductGuidanceIntent,
  reviewedCertificatePathwaysFor,
} from "../src/data/energy-assistant-reviewed-product-guidance.ts";
import { createSurgeGroundedProductGuidanceResolver } from "../src/lib/energy-assistant-product-guidance-server.ts";

const NOW = new Date("2026-08-25T02:00:00.000Z");
const REGISTRY_CHECKED_AT = "2026-08-24T20:00:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function facet(values) {
  return [...new Set(values)].map((value) => ({ value, label: value, count: 1 }));
}

function officialProduct({
  kind,
  key,
  brand,
  model,
  attributes = {},
}) {
  return {
    id: `product:${key}`,
    registryCode: `registry:${kind}`,
    snapshotId: `snapshot:${kind}`,
    sourceKey: `source:${kind}`,
    sourceRecordKey: key,
    productKind: kind,
    manufacturer: `${brand} Industries`,
    brand,
    model,
    series: "",
    registrationNumber: `registration:${key}`,
    certificateNumber: `certificate:${key}`,
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "2099-12-31",
    attributes,
    sourceSha256: SHA_B,
  };
}

function registryStatus(kind, overrides = {}) {
  return {
    registryCode: `registry:${kind}`,
    status: "current",
    freshnessWindowHours: 48,
    snapshotId: `snapshot:${kind}`,
    sourceSha256: SHA_A,
    recordCount: 1,
    lastCheckedAt: REGISTRY_CHECKED_AT,
    lastAttempt: {
      status: "success",
      checkedAt: REGISTRY_CHECKED_AT,
      message: "Test fixture",
    },
    ...overrides,
  };
}

function registryResult(kind, products, allProducts = products, statusOverrides = {}) {
  return {
    registry: registryStatus(kind, {
      recordCount: allProducts.length,
      ...statusOverrides,
    }),
    productKind: kind,
    installationDate: "2026-08-25",
    facets: {
      brands: facet(allProducts.map((product) => product.brand)),
      models: facet(products.map((product) => product.model)),
      productTypes: [],
    },
    matchCount: products.length,
    products,
  };
}

function createRegistrySearch(productsByKind, options = {}) {
  return async (_db, input) => {
    if (options.throwError) throw new Error("Registry unavailable");
    const all = productsByKind[input.productKind] || [];
    const brandPool = input.brand
      ? all.filter((product) => product.brand === input.brand)
      : all;
    const matches = brandPool.filter((product) => !input.model || product.model === input.model);
    return registryResult(
      input.productKind,
      matches,
      input.brand ? brandPool : all,
      options.statusOverrides,
    );
  };
}

function request(message, facts = []) {
  return {
    message,
    audience: "public",
    pageContext: "/surge",
    asOf: NOW,
    recentTurns: [],
    continuation: null,
    planContext: {
      version: 1,
      source: "home_energy_plan",
      facts,
    },
    deterministicAnswer: {
      directAnswer: "",
      practicalSteps: [],
      nextAction: "",
      status: "needs_context",
      citations: [],
      assumptions: [],
      confidence: "low",
      suggestedQuestions: [],
      toolActions: [],
      sourceBoundary: "",
    },
  };
}

function prices(status = "current") {
  const definition = {
    name: "Certificate",
    region: "Australia",
    relevance: "Household upgrades",
    plainEnglish: "Market reference",
    represents: "One certificate",
    whyPriceMatters: "The market price changes",
    officialUrl: "https://example.test",
    colour: "#00aa88",
    points: [],
  };
  return {
    asOf: "2026-08-25T02:00:00.000Z",
    source: {
      lastCheckedAt: "2026-08-24T19:00:00.000Z",
      status,
      note: "Test fixture",
    },
    certificates: [
      { ...definition, code: "STC", latest: { priceCents: 3950, tradedOn: "2026-08-24" } },
      { ...definition, code: "VEEC", latest: { priceCents: 10450, tradedOn: "2026-08-24" } },
      { ...definition, code: "ESC", latest: { priceCents: 2275, tradedOn: "2026-08-24" } },
      { ...definition, code: "PRC", latest: { priceCents: 185, tradedOn: "2026-08-24" } },
    ],
  };
}

function noDash(value) {
  assert.doesNotMatch(JSON.stringify(value), /[\u2013\u2014]/);
}

test("publishes six approved, current categories with deterministic intent resolution", () => {
  assert.deepEqual(
    ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE.map((category) => category.id),
    [...REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS],
  );
  const intents = new Map([
    ["Compare solar hot water systems", "hot_water"],
    ["How should I size a reverse cycle air conditioner?", "heating_cooling"],
    ["Give me home battery advice", "solar_storage"],
    ["How do I stop a window draught?", "insulation_glazing_draughts"],
    ["What EV charging setup suits a home?", "ev_charging"],
    ["Compare two heat pump dryer models", "cooking_appliances"],
  ]);

  for (const category of ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE) {
    assert.equal(category.reviewStatus, "approved");
    assert.ok(category.reviewedBy);
    assert.equal(isCurrentReviewedProductGuidanceCategory(category, NOW), true);
    assert.ok(currentReviewedPracticalTips(category.id, NOW).length > 0);
  }
  for (const [message, expected] of intents) {
    assert.equal(resolveReviewedProductGuidanceIntent(message)?.id, expected);
  }
  assert.equal(
    isCurrentReviewedProductGuidanceCategory(
      ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE[0],
      "2026-08-23",
    ),
    false,
  );
  assert.equal(
    isCurrentReviewedProductGuidanceCategory(
      ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE[0],
      "2026-09-21",
    ),
    false,
  );
  noDash(ENERGY_ASSISTANT_REVIEWED_PRODUCT_GUIDANCE);
});

test("declares conservative certificate pathway coverage for every category", () => {
  const expected = {
    hot_water: ["sres_stc", "veu_veec", "nsw_ess_esc", "state_rebate_discovery"],
    heating_cooling: ["veu_veec", "state_rebate_discovery"],
    solar_storage: ["sres_stc", "nsw_pdrs_prc", "state_rebate_discovery"],
    insulation_glazing_draughts: ["state_rebate_discovery"],
    ev_charging: ["state_rebate_discovery"],
    cooking_appliances: ["state_rebate_discovery"],
  };
  for (const categoryId of REVIEWED_PRODUCT_GUIDANCE_CATEGORY_IDS) {
    assert.deepEqual(
      currentReviewedCertificatePathwayCoverage(categoryId, NOW).map((pathway) => pathway.id),
      expected[categoryId],
    );
  }
  assert.deepEqual(
    reviewedCertificatePathwaysFor({ categoryId: "hot_water", jurisdiction: "VIC", asOf: NOW })
      .map((pathway) => pathway.code),
    ["STC", "VEEC", "REBATE"],
  );
  assert.deepEqual(
    reviewedCertificatePathwaysFor({ categoryId: "hot_water", jurisdiction: "NSW", asOf: NOW })
      .map((pathway) => pathway.code),
    ["STC", "ESC", "REBATE"],
  );
  assert.deepEqual(
    allReviewedCertificatePathways().map((pathway) => pathway.code),
    ["STC", "VEEC", "ESC", "PRC", "REBATE"],
  );
  assert.ok(allReviewedCertificatePathways().every((pathway) => (
    pathway.calculationMode === "governed_exact_inputs_only"
    && pathway.exactInputs.length > 0
  )));
});

test("returns reviewed practical guidance for all six live categories", async () => {
  const productsByKind = {
    sres_air_source_heat_pump: [officialProduct({
      kind: "sres_air_source_heat_pump", key: "hp-1", brand: "HeatCo", model: "HP-1",
    })],
    air_conditioner: [officialProduct({
      kind: "air_conditioner", key: "ac-1", brand: "CoolCo", model: "AC-1",
    })],
    cec_battery: [officialProduct({
      kind: "cec_battery", key: "bat-1", brand: "StoreCo", model: "BAT-1",
    })],
    clothes_dryer: [officialProduct({
      kind: "clothes_dryer", key: "dry-1", brand: "DryCo", model: "DRY-1",
    })],
  };
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch(productsByKind),
    loadPrices: async () => prices(),
  });
  const cases = [
    ["hot_water", "Give me practical heat pump hot water tips", "hot water"],
    ["heating_cooling", "Give me practical air conditioner tips", "heating and cooling"],
    ["solar_storage", "Give me practical home battery tips", "solar and storage"],
    ["insulation_glazing_draughts", "Give me practical draught sealing tips", "insulation, glazing and draught control"],
    ["ev_charging", "Give me practical EV charging tips", "ev charging"],
    ["cooking_appliances", "Give me practical heat pump dryer tips", "cooking and appliances"],
  ];
  for (const [categoryId, message, label] of cases) {
    const result = await resolver(request(message));
    assert.ok(result, categoryId);
    assert.match(result.directAnswer.toLowerCase(), new RegExp(label));
    assert.ok(result.practicalSteps.length > 0, categoryId);
    assert.match(result.directAnswer, /start here/i);
    assert.doesNotMatch(result.directAnswer, /ask for exact model and variant|reviewed comparison dimensions|reviewed pathway coverage/i);
    assert.equal(result.status, "answered");
    noDash(result);
  }
});

test("does not hijack a short answer to Surge's room-comfort follow-up", async () => {
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({}),
    loadPrices: async () => prices(),
  });
  const followUp = request("mostly my louge and bedroom");
  followUp.recentTurns = [
    {
      role: "assistant",
      content: "A moving draught can point to gaps that may be sealed. Which rooms are hardest to keep comfortable?",
    },
  ];
  followUp.continuation = {
    version: 1,
    activeTopic: "heating_cooling",
    goal: "Improve winter comfort",
    facts: [],
    pendingQuestion: "Which rooms are hardest to keep comfortable?",
    lastAnswerSummary: "Explained how to distinguish draughts from cold surfaces.",
  };

  assert.equal(await resolver(followUp), null);
});

test("does not hijack a broad topic requested in response to Surge's guide prompt", async () => {
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({}),
    loadPrices: async () => prices(),
  });
  const broadTopic = request("ok tell me about insulation");
  broadTopic.recentTurns = [
    { role: "assistant", content: "What topic would you like recreated here?" },
    { role: "user", content: "anything related to companies you sourced info from" },
    { role: "assistant", content: "I keep the background research private and focus on explaining what matters for your home." },
  ];

  assert.equal(await resolver(broadTopic), null);
});

test("compares exact models only on the same reviewed unit and test condition", async () => {
  const products = [
    officialProduct({
      kind: "sres_air_source_heat_pump",
      key: "alpha-a300",
      brand: "AlphaHeat",
      model: "A300",
      attributes: {
        tankCapacityLitres: 300,
        tankCapacityLitresUnit: "L",
        tankCapacityLitresTestCondition: "Published nominal storage test",
        soundPowerDb: 48,
        soundPowerDbUnit: "dB",
        soundPowerDbTestCondition: "AS/NZS sound power test",
      },
    }),
    officialProduct({
      kind: "sres_air_source_heat_pump",
      key: "beta-b280",
      brand: "BetaTherm",
      model: "B280",
      attributes: {
        tankCapacityLitres: 280,
        tankCapacityLitresUnit: "L",
        tankCapacityLitresTestCondition: "Published nominal storage test",
        soundPowerDb: 45,
        soundPowerDbUnit: "dB",
        soundPowerDbTestCondition: "AS/NZS sound power test",
      },
    }),
  ];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: products }),
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "Compare the AlphaHeat A300 and BetaTherm B280 heat pump hot water systems",
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /Exact current registry matches are AlphaHeat A300, BetaTherm B280/);
  assert.match(result.directAnswer, /Verified like-for-like model facts/);
  assert.match(result.directAnswer, /AlphaHeat A300: 300 L/);
  assert.match(result.directAnswer, /BetaTherm B280: 280 L/);
  assert.match(result.directAnswer, /Same published test condition: AS\/NZS sound power test/);
  assert.equal(result.status, "answered");
  const registryCitation = result.citations.find((citation) => citation.id.includes("product-registry"));
  assert.equal(registryCitation.lastChecked, "2026-08-24");
  assert.equal(registryCitation.reviewDue, "2026-08-26");
  noDash(result);
});

test("does not claim a quieter winner when exact-model test conditions differ", async () => {
  const products = [
    officialProduct({
      kind: "sres_air_source_heat_pump", key: "alpha-a300", brand: "AlphaHeat", model: "A300",
      attributes: {
        soundPowerDb: 44,
        soundPowerDbUnit: "dB",
        soundPowerDbTestCondition: "Outdoor test at 7 C",
      },
    }),
    officialProduct({
      kind: "sres_air_source_heat_pump", key: "beta-b280", brand: "BetaTherm", model: "B280",
      attributes: {
        soundPowerDb: 40,
        soundPowerDbUnit: "dB",
        soundPowerDbTestCondition: "Outdoor test at 20 C",
      },
    }),
  ];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: products }),
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "Which is quieter, AlphaHeat A300 or BetaTherm B280 heat pump hot water?",
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /cannot verify a like-for-like model performance difference for verified sound level/i);
  assert.match(result.directAnswer, /same units and the same published test conditions/i);
  assert.doesNotMatch(result.directAnswer, /AlphaHeat A300 is quieter|BetaTherm B280 is quieter/i);
  assert.match(result.nextAction, /verified specification sheet/i);
  assert.equal(result.status, "needs_context");
  noDash(result);
});

test("treats brand and capacity as candidates and never substitutes another capacity", async () => {
  const products = [
    officialProduct({
      kind: "sres_air_source_heat_pump", key: "any-280-a", brand: "AnyBrand", model: "AB280-A",
      attributes: { tankCapacityLitres: 280 },
    }),
    officialProduct({
      kind: "sres_air_source_heat_pump", key: "any-280-b", brand: "AnyBrand", model: "AB280-B",
      attributes: { tankCapacityLitres: 280 },
    }),
    officialProduct({
      kind: "sres_air_source_heat_pump", key: "any-300", brand: "AnyBrand", model: "AB300",
      attributes: { tankCapacityLitres: 300, unrelatedReference: 280 },
    }),
  ];
  let estimateCalls = 0;
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: products }),
    estimateSres: async () => {
      estimateCalls += 1;
      return { output: { quantity: "31" } };
    },
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "What certificate support applies to an AnyBrand 280 L heat pump hot water system?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /AnyBrand AB280-A, AnyBrand AB280-B/);
  assert.doesNotMatch(result.directAnswer, /AnyBrand AB300/);
  assert.match(result.directAnswer, /candidate filters only, not exact model identification/i);
  assert.doesNotMatch(result.directAnswer, /\b\d+ STCs\b/);
  assert.match(result.nextAction, /exact brand and model number/i);
  assert.equal(result.status, "needs_context");
  assert.equal(estimateCalls, 0);
  noDash(result);
});

test("uses the governed calculator for quantity without deriving a customer discount", async () => {
  const product = officialProduct({
    kind: "sres_air_source_heat_pump",
    key: "futureco-hp-300",
    brand: "FutureCo",
    model: "HP-300",
    attributes: { tankCapacityLitres: 300 },
  });
  const estimateInputs = [];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: [product] }),
    estimateSres: async (_db, input) => {
      estimateInputs.push(input);
      return { output: { quantity: "31" } };
    },
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "What certificate support applies to a FutureCo HP-300 heat pump hot water system?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /31 STCs/);
  assert.match(result.directAnswer, /STC last reported at \$39\.50 on 2026-08-24/);
  assert.match(result.directAnswer, /VEEC last reported at \$104\.50 on 2026-08-24/);
  assert.match(result.directAnswer, /will not multiply a certificate quantity by a trade price/i);
  assert.match(result.directAnswer, /will not guess fees/i);
  assert.doesNotMatch(result.directAnswer, /\$1,224\.50|Solar Victoria|up to \$1,000|up to \$1,400/i);
  assert.equal(estimateInputs.length, 1);
  assert.equal(estimateInputs[0].productKey, "futureco-hp-300");
  assert.equal(estimateInputs[0].postcode, "3000");
  assert.equal(result.status, "answered");
  noDash(result);
});

test("does not treat an approved inverter model as a complete STC calculation", async () => {
  const product = officialProduct({
    kind: "inverter", key: "future-fi-5", brand: "FutureInverter", model: "FI-5",
    attributes: { ratedPowerKw: 5 },
  });
  let estimateCalls = 0;
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ inverter: [product] }),
    estimateSres: async () => {
      estimateCalls += 1;
      return { output: { quantity: "80" } };
    },
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "Is the FutureInverter FI-5 inverter approved and what certificate discount applies?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /Exact current registry matches are FutureInverter FI-5/);
  assert.match(result.directAnswer, /will not infer STCs, VEECs, ESCs or PRCs/i);
  assert.doesNotMatch(result.directAnswer, /\b\d+ STCs for postcode/i);
  assert.equal(estimateCalls, 0);
  assert.equal(result.status, "needs_context");
  noDash(result);
});

test("routes gas, solar and heat-pump hot water to distinct official product kinds", async () => {
  const seen = [];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => {
      seen.push(input.productKind);
      return registryResult(input.productKind, []);
    },
    loadPrices: async () => prices(),
  });
  await resolver(request("Compare a gas hot water system"));
  await resolver(request("Compare a solar hot water system"));
  await resolver(request("Compare a heat pump hot water system"));
  assert.deepEqual(seen, [
    "gas_water_heater",
    "sres_solar_water_heater",
    "sres_air_source_heat_pump",
  ]);
});

test("fails closed when a matched registry lookup throws", async () => {
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({}, { throwError: true }),
    loadPrices: async () => prices(),
  });
  const result = await resolver(request("Compare two heat pump hot water models"));
  assert.ok(result);
  assert.equal(result.status, "source_review_required");
  assert.match(result.directAnswer, /will not fall back to unreviewed product claims/i);
  noDash(result);
});

test("three-phase supply upgrades are not hijacked by battery product matching", async () => {
  let registryCalls = 0;
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async () => {
      registryCalls += 1;
      throw new Error("Product search should not run");
    },
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "Is it worth getting 3 phase power with a battery and solar installation, or is it mainly a switchboard and mains upgrade?",
  ));

  assert.equal(result, null);
  assert.equal(registryCalls, 0);
});

test("fails closed when registry metadata is stale", async () => {
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({}, {
      statusOverrides: { status: "stale" },
    }),
    loadPrices: async () => prices(),
  });
  const result = await resolver(request("Compare two heat pump hot water models"));
  assert.ok(result);
  assert.equal(result.status, "source_review_required");
  assert.doesNotMatch(result.directAnswer, /snapshot was checked.*is current/i);
  noDash(result);
});

test("fails closed when the matched governed quantity calculator throws", async () => {
  const product = officialProduct({
    kind: "sres_air_source_heat_pump", key: "hp-300", brand: "HeatCo", model: "HP-300",
  });
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: [product] }),
    estimateSres: async () => {
      throw new Error("Calculator unavailable");
    },
    loadPrices: async () => prices(),
  });
  const result = await resolver(request(
    "What certificate support applies to HeatCo HP-300 heat pump hot water?",
    [{ key: "postcode", value: "3000" }],
  ));
  assert.ok(result);
  assert.equal(result.status, "source_review_required");
  assert.doesNotMatch(result.directAnswer, /\b\d+ STCs\b|\$\d/);
  noDash(result);
});

test("omits market values safely when the price source fails", async () => {
  const product = officialProduct({
    kind: "sres_air_source_heat_pump", key: "hp-300", brand: "HeatCo", model: "HP-300",
  });
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: createRegistrySearch({ sres_air_source_heat_pump: [product] }),
    estimateSres: async () => ({ output: { quantity: "31" } }),
    loadPrices: async () => {
      throw new Error("Price source unavailable");
    },
  });
  const result = await resolver(request(
    "What certificate support applies to HeatCo HP-300 heat pump hot water?",
    [{ key: "postcode", value: "3000" }],
  ));
  assert.ok(result);
  assert.match(result.directAnswer, /31 STCs/);
  assert.match(result.directAnswer, /current certificate trade reference could not be verified/i);
  assert.doesNotMatch(result.directAnswer, /last reported at|\$\d/);
  noDash(result);
});
