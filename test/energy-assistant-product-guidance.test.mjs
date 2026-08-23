import assert from "node:assert/strict";
import test from "node:test";
import { createSurgeGroundedProductGuidanceResolver } from "../src/lib/energy-assistant-product-guidance-server.ts";

const NOW = new Date("2026-08-23T02:00:00.000Z");

function facet(values) {
  return values.map((value) => ({ value, label: value, count: 1 }));
}

function registryResult(productKind, products, brands = [], models = []) {
  return {
    productKind,
    installationDate: "2026-08-23",
    facets: {
      brands: facet(brands),
      models: facet(models),
      manufacturers: [],
      approvalStatuses: [],
      capacityBands: [],
      sourceLists: [],
    },
    matchCount: products.length,
    products,
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

function prices() {
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
    asOf: "2026-08-23",
    source: {
      lastCheckedAt: "2026-08-23T02:00:00.000Z",
      status: "current",
      note: "Test fixture",
    },
    certificates: [
      { ...definition, code: "STC", latest: { priceCents: 3950, tradedOn: "2026-08-22" } },
      { ...definition, code: "VEEC", latest: { priceCents: 10450, tradedOn: "2026-08-22" } },
    ],
  };
}

test("grounds an unrelated heat-pump brand in the current registry and calculates exact STCs", async () => {
  const product = {
    sourceRecordKey: "futureco-hp-300",
    brand: "FutureCo",
    manufacturer: "FutureCo Industries",
    model: "HP-300",
    attributes: { tankCapacityLitres: 300 },
  };
  const searches = [];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => {
      searches.push(input);
      if (input.model) return registryResult(input.productKind, [product], ["FutureCo"], ["HP-300"]);
      return registryResult(input.productKind, [product], ["FutureCo"], ["HP-300"]);
    },
    estimateSres: async (_db, input) => ({
      output: { quantity: "31" },
      input,
    }),
    loadPrices: async () => prices(),
  });

  const result = await resolver(request(
    "What rebate can I get for a FutureCo HP-300 300L heat pump hot water system?",
    [
      { key: "postcode", value: "3000" },
      { key: "home battery", value: "No home battery" },
    ],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /every listed brand rather than a fixed brand shortlist/i);
  assert.match(result.directAnswer, /FutureCo HP-300/);
  assert.match(result.directAnswer, /up to \$1,000/);
  assert.match(result.directAnswer, /up to \$1,400/);
  assert.match(result.directAnswer, /31 STCs/);
  assert.match(result.directAnswer, /STC last reported at \$39\.50 on 2026-08-22/);
  assert.match(result.directAnswer, /VEEC last reported at \$104\.50 on 2026-08-22/);
  assert.match(result.directAnswer, /can move like a share price/i);
  assert.match(result.directAnswer, /actual discount is normally lower after registry, compliance, administration and aggregator costs/i);
  assert.doesNotMatch(result.directAnswer, /[\u2013\u2014]/);
  assert.deepEqual(
    result.citations.map((item) => item.publisher),
    ["Clean Energy Regulator", "Solar Victoria", "Clean Energy Regulator", "Demand Manager"],
  );
  assert.ok(result.citations.every((item) => item.url.startsWith("https://")));
  assert.equal(result.suggestedQuestions.length, 1);
  assert.match(result.nextAction, /complete installed quote/i);
  assert.ok(searches.some((input) => input.brand === "FutureCo" && input.model === "HP-300"));
  assert.ok(searches.every((input) => input.productKind === "sres_air_source_heat_pump"));
});

test("compares any two registry brands without inventing performance differences", async () => {
  const products = [
    { sourceRecordKey: "alpha-a300", brand: "AlphaHeat", model: "A300", attributes: { tankCapacityLitres: 300 } },
    { sourceRecordKey: "beta-b280", brand: "BetaTherm", model: "B280", attributes: { tankCapacityLitres: 280 } },
  ];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => {
      const matching = products.filter((product) => (
        (!input.brand || product.brand === input.brand)
        && (!input.model || product.model === input.model)
      ));
      const brandProducts = input.brand ? products.filter((product) => product.brand === input.brand) : products;
      return registryResult(
        input.productKind,
        matching,
        [...new Set(products.map((product) => product.brand))],
        [...new Set(brandProducts.map((product) => product.model))],
      );
    },
    loadPrices: async () => prices(),
  });

  const result = await resolver(request(
    "Compare the AlphaHeat A300 300L and BetaTherm B280 280L heat pump hot water systems",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /AlphaHeat A300/);
  assert.match(result.directAnswer, /BetaTherm B280/);
  assert.match(result.directAnswer, /compare official approval and governed certificate support/i);
  assert.match(result.directAnswer, /will not invent brand differences/i);
  assert.match(result.nextAction, /complete installed quotes and verified specification sheets/i);
  assert.doesNotMatch(result.directAnswer, /quieter|faster recovery/i);
  assert.doesNotMatch(result.directAnswer, /[\u2013\u2014]/);
  assert.equal(result.status, "answered");
});

test("uses the same registry-driven guidance for another product category and brand", async () => {
  const product = {
    sourceRecordKey: "dryfuture-df-8",
    brand: "DryFuture",
    manufacturer: "DryFuture Appliances",
    model: "DF-8",
    attributes: { ratedCapacityKg: 8 },
  };
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => registryResult(
      input.productKind,
      [product],
      ["DryFuture"],
      ["DF-8"],
    ),
    loadPrices: async () => prices(),
  });

  const result = await resolver(request(
    "Compare the DryFuture DF-8 heat pump clothes dryer for my home",
    [{ key: "postcode", value: "2000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /DryFuture DF-8/);
  assert.match(result.directAnswer, /official clothes dryer registry/i);
  assert.doesNotMatch(result.directAnswer, /Solar Victoria|STCs|Reclaim|iStore/i);
  assert.doesNotMatch(result.directAnswer, /[\u2013\u2014]/);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].publisher, "GEMS Regulator");
  assert.equal(result.suggestedQuestions.length, 1);
});

test("does not imply that an inverter model alone creates STCs", async () => {
  const product = {
    sourceRecordKey: "futureinverter-fi-5",
    brand: "FutureInverter",
    manufacturer: "FutureInverter Energy",
    model: "FI-5",
    attributes: { ratedPowerKw: 5 },
  };
  let priceLoads = 0;
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => registryResult(
      input.productKind,
      [product],
      ["FutureInverter"],
      ["FI-5"],
    ),
    loadPrices: async () => {
      priceLoads += 1;
      return prices();
    },
  });

  const result = await resolver(request(
    "Is the FutureInverter FI-5 solar inverter approved and what certificate discount does it get?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /FutureInverter FI-5/);
  assert.doesNotMatch(result.directAnswer, /STC last reported|VEEC last reported|exact certificate quantities/i);
  assert.equal(priceLoads, 0);
  assert.equal(result.citations[0].publisher, "Clean Energy Regulator");
});

test("asks for the exact model when a brand and capacity map to several approved products", async () => {
  const products = [
    { sourceRecordKey: "anybrand-280-a", brand: "AnyBrand", model: "AB280-A", attributes: { tankCapacityLitres: 280 } },
    { sourceRecordKey: "anybrand-280-b", brand: "AnyBrand", model: "AB280-B", attributes: { tankCapacityLitres: 280 } },
  ];
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => registryResult(
      input.productKind,
      products,
      ["AnyBrand"],
      ["AB280-A", "AB280-B"],
    ),
    loadPrices: async () => prices(),
  });

  const result = await resolver(request(
    "I was quoted an AnyBrand 280L heat pump hot water system. What support applies?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /Possible current matches.*AnyBrand AB280-A, AnyBrand AB280-B/i);
  assert.match(result.directAnswer, /candidates until the exact model number is confirmed/i);
  assert.doesNotMatch(result.directAnswer, /\b\d+ STCs\b/);
  assert.match(result.nextAction, /exact model number/i);
  assert.equal(result.status, "needs_context");
});

test("does not present a stale certificate trade as current", async () => {
  const product = {
    sourceRecordKey: "futureco-hp-300",
    brand: "FutureCo",
    model: "HP-300",
    attributes: { tankCapacityLitres: 300 },
  };
  const stalePrices = prices();
  stalePrices.source.status = "stale";
  const resolver = createSurgeGroundedProductGuidanceResolver({}, {
    searchProducts: async (_db, input) => registryResult(
      input.productKind,
      [product],
      ["FutureCo"],
      ["HP-300"],
    ),
    estimateSres: async () => ({ output: { quantity: "31" } }),
    loadPrices: async () => stalePrices,
  });

  const result = await resolver(request(
    "What rebate can I get for a FutureCo HP-300 heat pump hot water system?",
    [{ key: "postcode", value: "3000" }],
  ));

  assert.ok(result);
  assert.match(result.directAnswer, /will not present an older trade as current/i);
  assert.doesNotMatch(result.directAnswer, /last reported at/i);
  assert.doesNotMatch(result.directAnswer, /[\u2013\u2014]/);
  assert.doesNotMatch(result.citations.map((item) => item.publisher).join(" "), /Demand Manager/);
});
