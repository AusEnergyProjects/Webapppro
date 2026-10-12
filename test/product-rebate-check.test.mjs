import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/lib/product-rebate-check.ts";
import * as locality from "../src/lib/address-localities.mjs";
import * as sresRegistry from "../src/lib/creditex-sres-registry.ts";
import * as stc from "../src/lib/creditex-stc-estimator.ts";
import * as official from "../src/lib/creditex-official-product-registry.ts";
import * as veu from "../src/lib/creditex-veu-calculator-estimator.ts";
import * as postcode from "../src/lib/creditex-veu-postcode-resolver.ts";
import * as routeErrors from "../src/lib/creditex-calculator-route-response.ts";
import { productCertificateValue } from "../src/lib/product-rebate-value.ts";

const modelData = JSON.parse(readFileSync(new URL("../src/data/product-rebate-models.json", import.meta.url), "utf8"));
const coolingData = JSON.parse(readFileSync(new URL("../src/data/product-rebate-cooling-models.json", import.meta.url), "utf8"));
function compile(relative, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const server = compile("../src/lib/product-rebate-check-server.ts", {
  "../data/product-rebate-models.json": modelData,
  "../data/product-rebate-cooling-models.json": coolingData,
  "./address-localities.mjs": locality,
  "./product-rebate-check.ts": contract,
  "./creditex-sres-calculator-estimator.ts": { estimateCreditexSresQuote() { throw new Error("Unexpected live SRES call"); } },
  "./creditex-sres-registry-server.ts": { searchCerSresProducts() { throw new Error("Unexpected live SRES search"); } },
  "./creditex-sres-registry.ts": sresRegistry,
  "./creditex-stc-estimator.ts": stc,
  "./creditex-official-product-registry.ts": official,
  "./creditex-official-product-registry-server.ts": {},
  "./creditex-veu-calculator-estimator.ts": veu,
  "./creditex-veu-postcode-resolver.ts": postcode,
  "./creditex-calculator-route-response.ts": routeErrors,
  "./certificate-prices-server.ts": { loadCertificatePriceDataset() { throw new Error("Unexpected live prices call"); } },
  "./product-rebate-value.ts": { productCertificateValue },
});
const request = (overrides = {}) => ({
  productId: "reclaim-eco-r290", postcode: "3000", suburb: "MELBOURNE", state: "VIC",
  installationDate: "2026-10-20", currentSystem: "electric-storage", ...overrides,
});
function selected(activity = "1D", overrides = {}) {
  return {
    id: "exact-approval", brand: "Reclaim Energy", model: "300REC25P", productKind: "veu_water_heater",
    registryCode: "veu-approved-products", approvalStatus: "approved", eligibleFrom: "2026-01-01", eligibleTo: "2030-12-31",
    sourceSha256: "a".repeat(64), attributes: {
      veuProductId: "VEU-EXACT-01", veuProductCategoryNumber: activity, veuSystemSize: activity === "3C" ? "Medium" : "Small",
      zone4AnnualEnergySavings: 70, zone5AnnualEnergySavings: 70,
      bs2021Zone4StepDownLoadGjPerYear: 1, be2021Zone4StepDownLoadGjPerYear: 0.5,
      bs2021Zone5StepDownLoadGjPerYear: 1, be2021Zone5StepDownLoadGjPerYear: 0.5,
      refrigerantType: "R-290",
    }, ...overrides,
  };
}
function dependencies(overrides = {}) {
  return {
    searchSres: async (_db, input) => ({ products: [{ brand: "Reclaim Energy", model: input.query, sourceRecordKey: "cer-ashp:725" }] }),
    estimateSres: async (_db, input) => {
      assert.equal(input.estimatePurpose, "quote");
      assert.equal(input.unitQuantity, "1");
      assert.equal(input.productKey, "cer-ashp:725");
      const estimate = stc.estimateCreditexStcs({ technology: "air_source_heat_pump", installationDate: input.installationDate, registeredTenYearStcs: "32" });
      return { ...estimate, resolution: { brand: "Reclaim Energy", model: "300REC25P", registryLastCheckedAt: "2026-10-12T01:00:00Z", postcodeSourceUrl: sresRegistry.CER_SRES_POSTCODE_ZONE_URL }, eligibilityConfirmed: false };
    },
    searchVeu: async (_db, input) => ({ products: [selected(input.veuActivityCode)], registry: { lastCheckedAt: "2026-10-12T01:00:00Z" } }),
    validateVeu: async (_db, input) => {
      assert.deepEqual(input.requiredKinds, ["veu_water_heater"]);
      assert.deepEqual(input.selectedProductIds, { veu_water_heater: "exact-approval" });
      return { selections: [selected()] };
    },
    estimateVeu: veu.estimateCreditexVeu,
    loadPrices: async () => null,
    ...overrides,
  };
}
const run = (input = request(), deps = dependencies()) => server.checkProductRebates({}, contract.parseProductRebateCheckRequest(input), {
  now: new Date("2026-10-12T02:00:00Z"), dependencies: deps,
});

test("public input is narrow, real-dated and rejects caller certificate or pricing facts", () => {
  assert.deepEqual(contract.parseProductRebateCheckRequest(request()), request());
  for (const extra of [{ registeredTenYearStcs: "32" }, { bs2021: "0" }, { price: "1" }, { customerId: "private" }]) {
    assert.throws(() => contract.parseProductRebateCheckRequest({ ...request(), ...extra }), /unsupported fields/);
  }
  assert.throws(() => contract.parseProductRebateCheckRequest(request({ installationDate: "2026-02-30" })), /real installation date/);
  assert.throws(() => contract.parseProductRebateCheckRequest(request({ currentSystem: "electric" })), /current hot-water/);
  assert.equal(contract.exactRebateIdentity("EHPA300VM", "EHPA300VMH"), false);
  assert.equal(contract.exactRebateIdentity("EHPG300VM10", "EHPG300VM"), false);
});

test("all 62 products have exact reviewed lookup identities, without copied certificate amounts or rebrand substitutions", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../src/lib/product-guides/hot-water.json", import.meta.url), "utf8"));
  assert.deepEqual(new Set(modelData.products.map(p => p.id)), new Set(catalogue.map(p => p.id)));
  assert.equal(modelData.products.length, 62);
  for (const model of modelData.products) {
    assert.ok(model.models.length > 0 && model.models.every(name => name.trim() === name && name.length > 0));
    assert.ok(!JSON.stringify(model).includes("Number of certificates"));
    assert.ok(!Object.hasOwn(model, "cost"));
  }
  assert.ok(!modelData.products.find(p => p.id === "earthworker-neo-250").brands.includes("Neopower"));
  assert.ok(!modelData.products.find(p => p.id === "istore-r290-270").brands.includes("PHNIX"));
});

test("current Sanden D systems keep exact suffixes and independent Solar Victoria list evidence", async () => {
  for (const litres of [160, 250, 300, 315]) {
    const productId = `sanden-eco-plus-${litres}-fqtd`;
    const model = `GAUS-${litres}FQTD`;
    const mapping = modelData.products.find(product => product.id === productId);
    assert.deepEqual(mapping.models, [model]);
    assert.equal(mapping.solarVictoriaLocal.length, 0);
    const output = await run(request({ productId }), dependencies({
      searchSres: async (_db, input) => {
        assert.equal(input.query, model);
        return { products: [{ brand: "Sanden", model, sourceRecordKey: "exact-d-system" }] };
      },
      estimateSres: async () => ({ output: { quantity: "17" }, resolution: { brand: "Sanden", model } }),
      searchVeu: async () => ({ products: [] }),
    }));
    assert.equal(output.results[0].quantity, 17);
    if (litres === 160) {
      assert.equal(mapping.solarVictoria.length, 0, "Blank official equipment categories do not create an approved product");
      assert.equal(output.results[2].status, "not-confirmed");
      assert.equal(output.results[2].maximumAmountAud, null);
    } else {
      assert.equal(mapping.solarVictoria.length, 1);
      assert.equal(mapping.solarVictoria[0].model, model);
      assert.equal(mapping.solarVictoria[0].localContent, false);
      assert.equal(output.results[2].status, "potential");
      assert.equal(output.results[2].maximumAmountAud, 1000);
    }
  }
});

test("Rinnai S7 STC expiry is checked independently of its longer Solar Victoria approval", async () => {
  const products = modelData.products.filter(product => /^rinnai-kshp(?:250|315|400)m24l70h?$/.test(product.id));
  assert.equal(products.length, 6);
  for (const product of products) {
    assert.equal(product.solarVictoria[0].eligibleTo, "2030-12-31");
    const model = product.models[0];
    let resolutions = 0;
    const deps = dependencies({
      searchSres: async (_db, input) => {
        assert.equal(input.query, model);
        // A stale candidate can still reach final authoritative resolution.
        return { products: [{ brand: "Rinnai", model, sourceRecordKey: "exact-s7-registration" }] };
      },
      estimateSres: async (_db, input) => {
        resolutions++;
        assert.equal(input.productKey, "exact-s7-registration");
        if (input.installationDate > "2026-12-13") {
          throw new sresRegistry.CreditexSresRegistryError("SRES_PRODUCT_INELIGIBLE", 422,
            "The selected product is not eligible in the current registry on the installation date.");
        }
        return { output: { quantity: "16" }, resolution: { brand: "Rinnai", model } };
      },
      searchVeu: async () => ({ products: [] }),
    });
    const lastEligible = await run(request({ productId: product.id, installationDate: "2026-12-13" }), deps);
    assert.equal(lastEligible.results[0].status, "calculated");
    const expired = await run(request({ productId: product.id, installationDate: "2027-01-01" }), deps);
    assert.equal(resolutions, 2);
    assert.equal(expired.results[0].status, "not-confirmed");
    assert.equal(expired.results[0].quantity, null);
    assert.equal(expired.results[0].issueCode, "SRES_PRODUCT_INELIGIBLE");
    assert.equal(expired.results[2].status, "potential");
    assert.equal(expired.results[2].maximumAmountAud, 1400);
  }
});

test("electric storage gives exact dated STCs and governed VEEC math with visible household assumptions", async () => {
  const output = await run();
  assert.equal(contract.isProductRebateCheckResult(output), true);
  assert.deepEqual(output.results.slice(0, 2).map(p => [p.status, p.quantity, p.unit]), [["calculated", 16, "STC"], ["calculated", 8, "VEEC"]]);
  assert.ok(output.results[1].conditions.some(text => /does not include an earlier hot-water upgrade claim/.test(text) && /must check.*claim history/.test(text)));
  assert.ok(output.results[1].conditions.some(text => /\$200 including GST/.test(text)));
  assert.ok(output.results[1].conditions.some(text => /cannot be rebated or reimbursed/.test(text)));
  assert.equal(output.results[2].maximumAmountAud, 1400);
  assert.equal(output.results[2].status, "potential");
  assert.ok(output.results[2].conditions.some(text => /50%/.test(text)));
  assert.equal(output.results[0].certificateValue.status, "unavailable");
  assert.equal(output.results[0].certificateValue.grossValueCents, null);
});

test("gas/LPG uses Part 3C and does not reuse the electric baseline", async () => {
  const output = await run(request({ currentSystem: "gas-lpg" }), dependencies({ validateVeu: async () => ({ selections: [selected("3C")] }) }));
  assert.equal(output.results[1].quantity, 11);
  assert.match(output.results[1].summary, /mains or bottled gas/);
});

test("the locality tuple handles cross-border postcodes without guessing state from digits", async () => {
  const nsw = await run(request({ postcode: "3644", suburb: "BAROOGA", state: "NSW" }));
  const vic = await run(request({ postcode: "3644", suburb: "COBRAM", state: "VIC" }));
  assert.equal(nsw.results[1].status, "not-applicable");
  assert.equal(nsw.results[2].status, "not-applicable");
  assert.equal(vic.results[1].status, "calculated");
  await assert.rejects(run(request({ postcode: "3644", suburb: "BAROOGA", state: "VIC" })), /matching suburb and state/);
});

test("heat-pump, solar and unknown incumbents never become inferred VEU electric replacements", async () => {
  for (const currentSystem of ["heat-pump", "solar-hot-water", "not-sure"]) {
    const output = await run(request({ currentSystem }));
    assert.equal(output.results[0].status, "calculated");
    assert.equal(output.results[1].status, "not-confirmed");
    assert.equal(output.results[1].quantity, null);
  }
  const fresh = await run(request({ currentSystem: "new-installation" }));
  assert.equal(fresh.results[0].status, "calculated");
  assert.equal(fresh.results[1].status, "not-applicable");
  assert.equal(fresh.results[2].status, "not-applicable");
});

test("missing and ambiguous official matches remain unknown while other programmes resolve independently", async () => {
  const missing = await run(request(), dependencies({ searchVeu: async () => ({ products: [] }) }));
  assert.equal(missing.results[1].quantity, null);
  assert.equal(missing.results[1].status, "not-confirmed");
  assert.equal(missing.results[0].quantity, 16);
  assert.equal(missing.results[2].maximumAmountAud, 1400);
  const duplicate = await run(request(), dependencies({ searchSres: async () => ({ products: [
    { brand: "Reclaim Energy", model: "300REC25P", sourceRecordKey: "cer-ashp:1" },
    { brand: "Reclaim Energy", model: "300REC25P", sourceRecordKey: "cer-ashp:2" },
  ] }) }));
  assert.equal(duplicate.results[0].quantity, null);
  assert.match(duplicate.results[0].summary, /More than one/);
});

test("candidate lookup uses the model query but full suffix and approved brand equality still decide the match", async () => {
  let sresQuery, veuQuery;
  const output = await run(request(), dependencies({
    searchSres: async (_db, input) => {
      sresQuery = input;
      return { products: [
        { brand: "Other brand", model: "300REC25P", sourceRecordKey: "wrong-brand" },
        { brand: "Reclaim Energy", model: "300REC25P-H", sourceRecordKey: "wrong-suffix" },
        { brand: "RECLAIM ENERGY", model: "300REC25P", sourceRecordKey: "cer-ashp:725" },
      ] };
    },
    searchVeu: async (_db, input) => {
      veuQuery = input;
      return { products: [selected("1D", { brand: "RECLAIM ENERGY" }), selected("1D", { id: "suffix", model: "300REC25P-H" })] };
    },
  }));
  assert.equal(sresQuery.query, "300REC25P");
  assert.equal(veuQuery.query, "300REC25P");
  assert.equal(sresQuery.brand, undefined);
  assert.equal(veuQuery.brand, undefined);
  assert.equal(output.results[0].quantity, 16);
  assert.equal(output.results[1].quantity, 8);
});

test("a truncated official candidate set is never treated as a unique match", async () => {
  const output = await run(request(), dependencies({ searchVeu: async () => ({
    products: [selected()], matchCount: 101,
  }) }));
  assert.equal(output.results[1].quantity, null);
  assert.equal(output.results[1].issueCode, "OFFICIAL_MODEL_MATCH_OVERFLOW");
});

test("an official source outage and an NA zone never create zero or substitute another registration", async () => {
  let estimateCalls = 0;
  const output = await run(request(), dependencies({
    estimateSres: async () => { estimateCalls++; throw new sresRegistry.CreditexSresRegistryError("SRES_PRODUCT_ZONE_UNAVAILABLE", 409, "The exact model has no entitlement for this zone."); },
    searchVeu: async () => { throw new official.CreditexOfficialProductError("OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE", 503, "The official product data is unavailable."); },
  }));
  assert.equal(estimateCalls, 1);
  assert.equal(output.results[0].quantity, null);
  assert.equal(output.results[1].quantity, null);
  assert.equal(output.results[1].issueCode, "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE");
  assert.equal(output.results[1].retryable, true);
  assert.equal(output.results[2].status, "potential");
  assert.match(output.results[0].summary, /no entitlement/);
  assert.equal(contract.wholeCertificateQuantity("0"), 0);
  assert.throws(() => contract.wholeCertificateQuantity("NA"), /invalid certificate/);
});

test("unexpected implementation failures are not disguised as absent rebate data", async () => {
  await assert.rejects(run(request(), dependencies({ searchVeu: async () => { throw new TypeError("Synthetic implementation error"); } })), /Synthetic implementation error/);
});

test("known missing registry schema stays an explicit source issue, with other programme results independent", async () => {
  const unavailable = async () => { throw new Error("CREDITEX_PRODUCT_REGISTRY_MIGRATIONS_REQUIRED: synthetic registry tables"); };
  const output = await run(request(), dependencies({ searchSres: unavailable, searchVeu: unavailable }));
  for (const programme of output.results.slice(0, 2)) {
    assert.equal(programme.quantity, null);
    assert.equal(programme.issueCode, "CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED");
    assert.equal(programme.retryable, false);
  }
  assert.equal(output.results[2].status, "potential");
  assert.equal(output.results[2].maximumAmountAud, 1400);
});

test("the model is rechecked after authoritative STC resolution, not just search", async () => {
  const output = await run(request(), dependencies({ estimateSres: async () => ({
    output: { quantity: "32" }, resolution: { brand: "Other brand", model: "Other model" }, receiptHash: "other",
  }) }));
  assert.equal(output.results[0].quantity, null);
  assert.equal(output.results[0].issueCode, "SRES_PRODUCT_REGISTRY_CHANGED");
});

test("Solar Victoria's current policy is bounded to the reviewed financial year", async () => {
  for (const installationDate of ["2026-06-30", "2027-07-01"]) {
    const output = await run(request({ installationDate }));
    assert.equal(output.results[2].status, "not-confirmed");
    assert.equal(output.results[2].maximumAmountAud, null);
    assert.equal(output.results[2].issueCode, "SOLAR_VICTORIA_RULE_PERIOD_UNCONFIRMED");
  }
  const end = await run(request({ installationDate: "2027-06-30" }));
  assert.equal(end.results[2].maximumAmountAud, 1400);
  const outside = await run(request({ postcode: "3644", suburb: "BAROOGA", state: "NSW", installationDate: "2027-07-01" }));
  assert.equal(outside.results[2].status, "not-applicable");
  const newHome = await run(request({ currentSystem: "new-installation", installationDate: "2027-07-01" }));
  assert.equal(newHome.results[2].status, "not-applicable");
});

test("server response decoder rejects untyped quantities, inconsistent zero states and unsafe source URLs", async () => {
  const output = await run();
  const malformed = structuredClone(output);
  malformed.results[0].quantity = "16";
  assert.throws(() => contract.readProductRebateCheckResult(malformed), /invalid response/);
  const zero = structuredClone(output);
  zero.results[0].quantity = 0;
  assert.equal(contract.readProductRebateCheckResult(zero).results[0].quantity, 0);
  zero.results[0].status = "not-confirmed";
  assert.throws(() => contract.readProductRebateCheckResult(zero), /invalid response/);
  const unsafe = structuredClone(output);
  unsafe.results[0].sources[0].url = "javascript:alert(1)";
  assert.throws(() => contract.readProductRebateCheckResult(unsafe), /invalid response/);
});

test("the anonymous route defers calculators and rejects invalid requests before loading them or touching data", async () => {
  let calls = 0;
  let calculatorLoads = 0;
  const route = compile("../src/app/api/product-rebates/route.ts", {
    "../../../../db": { getD1() { calls++; return {}; } },
    "@/lib/bounded-json-request": await import("../src/lib/bounded-json-request.ts"),
    "@/lib/product-rebate-check": contract,
    get "@/lib/product-rebate-check-server"() {
      calculatorLoads++;
      return { checkProductRebates: async () => { calls++; return { ok: true }; } };
    },
  });
  const input = (body, origin = "https://example.com") => new Request("https://example.com/api/product-rebates", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(calculatorLoads, 0, "Worker startup must not load product calculations");
  assert.equal((await route.POST(input(request(), "https://other.example"))).status, 403);
  assert.equal((await route.POST(input({ ...request(), customerId: "private" }))).status, 400);
  assert.equal(calls, 0);
  assert.equal(calculatorLoads, 0, "Rejected public requests must not load product calculations");
  const response = await route.POST(input(request()));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(calculatorLoads, 1);
  assert.equal(calls, 2);
});

function coolingSelection(model, configuration = "single", overrides = {}) {
  return selected("6D", {
    productKind: "veu_air_conditioner", brand: "Mitsubishi Electric", model,
    attributes: {
      veuProductId: "VEU-AC-EXACT", veuProductCategoryNumber: configuration === "multi" ? "6E(i)" : "6D",
      veuProductConfiguration: configuration === "multi" ? "Multiple split system" : "Single split system",
      veuProductConfigurationClass: configuration, ratedHeatingCapacityKw: configuration === "multi" ? 6.8 : 3.7,
      ratedCoolingCapacityKw: configuration === "multi" ? 5.2 : 3.5, refrigerantType: "R-32",
      gemsHspfColdResidential: 4.8, gemsTcspfColdResidential: 5.9,
      gemsHspfMixedResidential: 5.1, gemsTcspfMixedResidential: 6.2,
    }, ...overrides,
  });
}
function coolingDependencies(selection, overrides = {}) {
  return dependencies({
    searchSres: async () => { throw new Error("Cooling must not search the water-heater register"); },
    searchVeu: async (_db, input) => {
      assert.equal(input.productKind, "veu_air_conditioner"); assert.equal(input.veuActivityCode, "6");
      return { products: [selection], registry: { lastCheckedAt: "2026-10-12T01:00:00Z" } };
    },
    validateVeu: async (_db, input) => {
      assert.deepEqual(input.requiredKinds, ["veu_air_conditioner"]);
      assert.deepEqual(input.selectedProductIds, { veu_air_conditioner: selection.id });
      return { selections: [selection] };
    }, ...overrides,
  });
}
const coolingRequest = overrides => request({ productId: "mitsubishi-electric-ap", currentSystem: "ducted-gas", ...overrides });

test("cooling uses the exact approved pair, all prescribed old-heater scenarios and official postcode location", async () => {
  const selection = coolingSelection("MSZ-AP35VGKD2-A2 / MUZ-AP35VGD2-A2");
  const quantities = [];
  for (const option of contract.CURRENT_HEATING_SYSTEM_OPTIONS.filter(option => option.scenario)) {
    let actual;
    const output = await run(coolingRequest({ currentSystem: option.value }), coolingDependencies(selection, {
      estimateVeu: input => { actual = input; return veu.estimateCreditexVeu(input); },
    }));
    assert.equal(contract.isProductRebateCheckResult(output), true);
    assert.equal(output.category, "air-conditioning"); assert.equal(output.results.length, 1);
    assert.equal(actual.activityCode, "6"); assert.equal(actual.inputs.scenario, option.scenario);
    assert.equal(actual.inputs.location_class, "metro_mild");
    assert.equal(actual.inputs.rated_cooling_capacity_kw, "3.5");
    assert.equal(output.results[0].status, "calculated");
    assert.match(output.results[0].conditions[1], /\$200/);
    quantities.push(output.results[0].quantity);
  }
  assert.ok(new Set(quantities).size > 1, "Replacement type must affect governed certificates");
});

test("cooling does not guess unknown heating or cross-category system choices", async () => {
  const deps = coolingDependencies(coolingSelection("MSZ-AP35VGKD2-A2 / MUZ-AP35VGD2-A2"), {
    searchVeu: async () => { throw new Error("Unknown old equipment must not calculate"); },
  });
  const unknown = await run(coolingRequest({ currentSystem: "not-sure" }), deps);
  assert.equal(unknown.results[0].quantity, null); assert.equal(unknown.results[0].issueCode, "EXISTING_HEATING_UNCONFIRMED");
  await assert.rejects(run(coolingRequest({ currentSystem: "electric-storage" }), deps), /existing system for this product category/);
  await assert.rejects(run(request({ currentSystem: "ducted-gas" })), /existing system for this product category/);
  const border = await run(coolingRequest({ postcode: "3644", suburb: "BAROOGA", state: "NSW" }), deps);
  assert.equal(border.results[0].status, "not-applicable");
});

test("cooling rejects partial suffixes, collisions and a changed authoritative approval", async () => {
  for (const model of ["MSZ-AP35VGK / MUZ-AP35VG", "MSZ-AP35VGKD2-A2 / MUZ-AP35VGD2-A1"]) {
    const output = await run(coolingRequest(), coolingDependencies(coolingSelection(model)));
    assert.equal(output.results[0].quantity, null);
  }
  const selection = coolingSelection("MSZ-AP35VGKD2-A2 / MUZ-AP35VGD2-A2");
  const ambiguous = await run(coolingRequest(), coolingDependencies(selection, { searchVeu: async () => ({ products: [selection, { ...selection, id: "second-approval" }] }) }));
  assert.equal(ambiguous.results[0].quantity, null); assert.match(ambiguous.results[0].summary, /More than one/);
  const changed = await run(coolingRequest(), coolingDependencies(selection, { validateVeu: async () => ({ selections: [{ ...selection, model: "different pair" }] }) }));
  assert.equal(changed.results[0].quantity, null); assert.equal(changed.results[0].issueCode, "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED");
});

test("multi-split uses the exact installed heads and their verified rated capacities, not outdoor capacity labels", async () => {
  const selection = coolingSelection("MXZ-2F52VGD-A1", "multi");
  let actual;
  const output = await run(coolingRequest({ productId: "mitsubishi-electric-ap-two-room-kit52" }), coolingDependencies(selection, {
    estimateVeu: input => { actual = input; return veu.estimateCreditexVeu(input); },
  }));
  assert.equal(output.results[0].status, "calculated", output.results[0].summary); assert.equal(output.category, "multi-split");
  assert.deepEqual(actual.inputs.indoor_units, [{ model: "MSZ-AP25VGKD2-A2", quantity: "2", heatingCapacityKw: "3.2", coolingCapacityKw: "2.5" }]);
  assert.equal(actual.inputs.outdoor_cooling_capacity_kw, "5.2");
  assert.equal(actual.inputs.rated_cooling_capacity_kw, undefined);
  assert.match(output.results[0].conditions[1], /\$1,000/);
  assert.equal(output.results[0].capacityAssumption, undefined, "A specified package must use its actual indoor capacities");
});

test("outdoor-only profiles use the approved rated-capacity planning assumption without inventing room-unit identities", async () => {
  const products = coolingData.products.filter(product => product.category === "multi-split" && product.brand === "Panasonic");
  assert.equal(products.length, 5);
  for (const product of products) {
    assert.equal(product.indoorUnits, null);
    assert.equal(product.combination, null);
    assert.equal(product.models.length, 1);
    assert.match(product.models[0], /^CU-(?:2Z52|3Z54|4Z71|4Z80|5Z100)VBR$/);
    let actual;
    const output = await run(coolingRequest({ productId: product.id }), coolingDependencies(
      coolingSelection(product.models[0], "multi", { brand: "Panasonic" }), {
        estimateVeu: input => { actual = input; return veu.estimateCreditexVeu(input); },
      }));
    assert.equal(output.results[0].status, "calculated", output.results[0].summary);
    assert.deepEqual(output.results[0].capacityAssumption, { heatingCapacityKw: "6.8", coolingCapacityKw: "5.2" });
    assert.equal(actual.inputs.rated_heating_capacity_kw, actual.inputs.outdoor_heating_capacity_kw);
    assert.equal(actual.inputs.rated_cooling_capacity_kw, actual.inputs.outdoor_cooling_capacity_kw);
    assert.equal(actual.inputs.indoor_units, undefined);
    assert.equal(actual.estimatePurpose, "quote");
    assert.ok(output.results[0].conditions.some(condition => /Lower combined room-unit.*fewer VEECs.*smaller rebate/.test(condition)));
    assert.equal(contract.isProductRebateCheckResult(output), true);
  }
});

test("an outdoor planning example still requires exact approval and authoritative performance values", async () => {
  const product = coolingData.products.find(product => product.id === "emerald-multi-ultra-20");
  const selection = coolingSelection(product.models[0], "multi", { brand: "Emerald" });
  const unmatched = await run(coolingRequest({ productId: product.id }), coolingDependencies(selection, {searchVeu: async () => ({products: []})}));
  assert.equal(unmatched.results[0].quantity, null);
  assert.equal(unmatched.results[0].capacityAssumption, undefined);
  const noPerformance = structuredClone(selection);
  delete noPerformance.attributes.gemsHspfColdResidential;
  const unavailable = await run(coolingRequest({ productId: product.id }), coolingDependencies(noPerformance));
  assert.equal(unavailable.results[0].quantity, null);
  assert.equal(unavailable.results[0].capacityAssumption, undefined);
});

test("reviewed Emerald Energy owner alias resolves exact models while preserving suffix and unrelated-brand boundaries", async () => {
  const products = coolingData.products.filter(product => product.brand === "Emerald");
  assert.equal(products.length, 4);
  for (const product of products) assert.deepEqual(product.brands, ["Emerald", "Emerald Energy"]);
  const selection = coolingSelection("ACV200U - Non-Ducted", "multi", {brand: "Emerald Energy"});
  Object.assign(selection.attributes, {veuProductCategoryNumber:"6F", ratedCoolingCapacityKw:20, ratedHeatingCapacityKw:26, refrigerantType:"R-410A"});
  const output = await run(coolingRequest({productId:"emerald-multi-ultra-20"}), coolingDependencies(selection));
  assert.equal(output.results[0].status, "calculated", output.results[0].summary);
  assert.deepEqual(output.results[0].capacityAssumption, {heatingCapacityKw:"26", coolingCapacityKw:"20"});
  for (const mismatch of [{model:"ACV200U-1"},{model:"ACV200U - Ducted"},{brand:"Emerald Energy Solutions"}]) {
    const rejected = await run(coolingRequest({productId:"emerald-multi-ultra-20"}), coolingDependencies({...selection,...mismatch}));
    assert.equal(rejected.results[0].quantity, null);
  }
});

test("reviewed registry names resolve Mitsubishi retail suffixes and precise non-ducted classifications explicitly", async () => {
  const products = coolingData.products.filter(product => product.category === "multi-split" && product.models.length === 2);
  assert.equal(products.length, 11);
  for (const product of products) {
    const approvedName = product.models[1];
    const selection = coolingSelection(approvedName, "multi", {brand:product.brand});
    const output = await run(coolingRequest({productId:product.id}), coolingDependencies(selection));
    assert.equal(output.results[0].status, "calculated", product.id+": "+output.results[0].summary);
    assert.equal(output.results[0].matchedModel, product.brand+" "+approvedName);
    const different = approvedName.includes("Non-Ducted") ? approvedName.replace("Non-Ducted", "Ducted") : approvedName+"-A2";
    const rejected = await run(coolingRequest({productId:product.id}), coolingDependencies({...selection,model:different}));
    assert.equal(rejected.results[0].quantity, null, product.id+": another hardware/type suffix must not match");
  }
});

test("the current Daikin R2 profile preserves its saved ID and uses approved outdoor capacity without the older room package", async () => {
  const product = coolingData.products.find(product => product.id === "daikin-multi-5mxm100rvma-cora-rated");
  assert.equal(product.name, "Daikin Super Multi NX 5MXM100R2VMA 10 kW");
  assert.deepEqual(product.models, ["5MXM100R2VMA"]);
  assert.equal(product.indoorUnits, null);
  assert.equal(product.combination, null);
  const profileData = JSON.parse(readFileSync(new URL("../src/lib/product-guides/multi-split.json", import.meta.url), "utf8"));
  const profile = profileData.find(profile => profile.id === product.id);
  assert.equal(profile.name, product.name);
  assert.equal(profile.measurements.capacity.value, 10);
  assert.equal(profile.measurements.warranty.value, 5);
  assert.ok(profile.image.src.includes("outdoor"));
  assert.match(profile.image.alt, /representative range photograph/);
  assert.ok(profile.technicalSpecs.some(spec => spec.label === "Photo shown"));
  assert.doesNotMatch(JSON.stringify({...profile,id:undefined}), /5MXM100RVMA|CTXM20RVMA|CTXM25RVMA|CTXM60RVMA|five-room package.*included/i);
  const selection = coolingSelection("5MXM100R2VMA", "multi", {brand:"Daikin"});
  Object.assign(selection.attributes,{veuProductCategoryNumber:"6F",ratedHeatingCapacityKw:11,ratedCoolingCapacityKw:10});
  const output = await run(coolingRequest({productId:product.id}), coolingDependencies(selection));
  assert.equal(output.results[0].status, "calculated", output.results[0].summary);
  assert.deepEqual(output.results[0].capacityAssumption,{heatingCapacityKw:"11",coolingCapacityKw:"10"});
  const previous = await run(coolingRequest({productId:product.id}), coolingDependencies({...selection,model:"5MXM100RVMA"}));
  assert.equal(previous.results[0].quantity,null,"A previous outdoor generation must not be treated as R2");
  const ducted = await run(coolingRequest({productId:product.id}), coolingDependencies({...selection,model:"5MXM100R2VMA-Ducted"}));
  assert.equal(ducted.results[0].quantity,null,"The approved ducted variant must not replace this non-ducted outdoor selection");
});

test("capacity assumptions cannot be attached to an uncalculated result, another category or malformed capacities", async () => {
  const product = coolingData.products.find(product => product.category === "multi-split" && product.brand === "Panasonic");
  const valid = await run(coolingRequest({ productId: product.id }), coolingDependencies(coolingSelection(product.models[0], "multi", {brand: "Panasonic"})));
  assert.equal(contract.isProductRebateCheckResult(valid), true);
  for (const value of ["0", "-5", "NaN", "Infinity", 5, null]) {
    const malformed = structuredClone(valid);
    malformed.results[0].capacityAssumption.heatingCapacityKw = value;
    assert.equal(contract.isProductRebateCheckResult(malformed), false);
  }
  const uncalculated = structuredClone(valid); uncalculated.results[0].status = "not-confirmed";
  assert.equal(contract.isProductRebateCheckResult(uncalculated), false);
  const wrongCategory = structuredClone(valid); wrongCategory.category = "air-conditioning";
  assert.equal(contract.isProductRebateCheckResult(wrongCategory), false);
});

test("multi-room contribution follows the governed installation-date transition rather than a repeated fee table", async () => {
  const selection = coolingSelection("MXZ-5F100VGD-A1", "multi");
  selection.attributes.veuProductCategoryNumber = "6F";
  selection.attributes.ratedCoolingCapacityKw = 10;
  selection.attributes.ratedHeatingCapacityKw = 12.2;
  const before = await run(coolingRequest({ productId: "me-ap-multi-kit-100a", installationDate: "2026-09-29" }), coolingDependencies(selection));
  const after = await run(coolingRequest({ productId: "me-ap-multi-kit-100a", installationDate: "2026-09-30" }), coolingDependencies(selection));
  assert.equal(before.results[0].status, "calculated"); assert.equal(after.results[0].status, "calculated");
  assert.match(before.results[0].conditions[1], /\$1,000/); assert.match(after.results[0].conditions[1], /\$3,000/);
});

function priceDataset(status = "current") {
  return { asOf: "2026-10-12T01:00:00Z", source: { status, lastCheckedAt: "2026-10-12T01:00:00Z", note: "Reported trades" }, certificates: [
    { code: "STC", latest: { tradedOn: "2026-10-09", priceCents: 3900 } },
    { code: "VEEC", latest: { tradedOn: "2026-10-09", priceCents: 6400 } },
  ] };
}
test("dated gross and fee estimates reuse official fees and the explicitly assumed allowance", async () => {
  const output = await run(request(), dependencies({ loadPrices: async () => priceDataset() }));
  const value = output.results[1].certificateValue;
  assert.equal(value.grossValueCents, output.results[1].quantity * 6400);
  assert.equal(value.registrationFeeCents, output.results[1].quantity * 435);
  assert.equal(value.allowancePercent, 10);
  assert.equal(value.estimatedValueCents, value.grossValueCents - value.registrationFeeCents - value.allowanceCents);
  assert.equal(value.tradedOn, "2026-10-09"); assert.equal(value.estimateAsOf, "2026-10-12");
  assert.match(value.note, /assumed 10%/); assert.equal(contract.isProductRebateCheckResult(output), true);
  assert.equal(output.results[0].certificateValue.registrationFeeCents, output.results[0].quantity * 8);
  const stale = await run(request(), dependencies({ loadPrices: async () => priceDataset("stale") }));
  assert.equal(stale.results[1].certificateValue.status, "stale");
  assert.equal(stale.results[1].certificateValue.estimatedValueCents, null);
  assert.equal(stale.results[1].quantity, output.results[1].quantity);
});

test("missing or invalid market evidence never erases certificate counts or becomes a zero value", async () => {
  const missing = await run(request(), dependencies({ loadPrices: async () => { throw new Error("Certificate price history is temporarily unavailable."); } }));
  assert.equal(missing.results[1].quantity, 8); assert.equal(missing.results[1].certificateValue.grossValueCents, null);
  const future = priceDataset(); future.certificates[1].latest.tradedOn = "2026-10-13";
  const invalid = productCertificateValue(future, "VEEC", 8, "6", new Date("2026-10-12T02:00:00Z"));
  assert.equal(invalid.status, "unavailable"); assert.equal(invalid.grossValueCents, null);
  await assert.rejects(run(request(), dependencies({ loadPrices: async () => { throw new TypeError("Synthetic price adapter failure"); } })), /Synthetic price adapter failure/);
});

test("an actual zero certificate result has zero gross, fees and allowance; unreviewed fee dates have no net", () => {
  const zero = productCertificateValue(priceDataset(), "VEEC", 0, "6", new Date("2026-10-12T02:00:00Z"));
  assert.equal(zero.status, "current"); assert.equal(zero.grossValueCents, 0);
  assert.equal(zero.registrationFeeCents, 0); assert.equal(zero.allowanceCents, 0); assert.equal(zero.estimatedValueCents, 0);
  const later = productCertificateValue(priceDataset(), "VEEC", 8, "6", new Date("2028-01-01T02:00:00Z"));
  assert.equal(later.grossValueCents, 51200); assert.equal(later.estimatedValueCents, null);
  assert.equal(later.registrationFeeCents, null);
});

test("decoder binds programme shape to product category and rejects unsafe or invented value metadata", async () => {
  const output = await run(request(), dependencies({ loadPrices: async () => priceDataset() }));
  const malformed = structuredClone(output); malformed.category = "multi-split";
  assert.throws(() => contract.readProductRebateCheckResult(malformed), /invalid response/);
  const unsafe = structuredClone(output); unsafe.results[1].certificateValue.feeSourceUrl = "javascript:alert(1)";
  assert.throws(() => contract.readProductRebateCheckResult(unsafe), /invalid response/);
  const invented = structuredClone(output); invented.results[1].certificateValue.allowancePercent = 5;
  assert.throws(() => contract.readProductRebateCheckResult(invented), /invalid response/);
  assert.equal(new Set(coolingData.products.map(p => p.id)).size, coolingData.products.length);
});

test("every current cooling card has a reviewed exact identity and sourced selected-head data is bounded", () => {
  const catalogue = ["air-conditioning", "multi-split"].flatMap(category => JSON.parse(readFileSync(new URL(`../src/lib/product-guides/${category}.json`, import.meta.url), "utf8")));
  assert.deepEqual(new Set(coolingData.products.map(product => product.id)), new Set(catalogue.map(product => product.id)));
  assert.equal(coolingData.products.length, 103);
  for (const product of coolingData.products) {
    assert.equal(product.name, catalogue.find(card => card.id === product.id).name);
    assert.ok(product.models.length > 0); assert.ok(product.models.every(model => model.trim() === model));
    assert.match(product.modelSourceUrl, /^https:\/\//);
    assert.ok(product.brands.includes(product.brand));
    if (!product.indoorUnits) continue;
    const selected = catalogue.find(card => card.id === product.id).technicalSpecs.find(spec => /Exact.*(combination|equipment)/.test(spec.label));
    assert.ok(selected && product.combination === selected.value);
    const authoredHeads = [...selected.value.matchAll(/\b(\d+)\s+(?:x\s+)?([A-Z0-9][A-Z0-9-]+)/g)]
      .filter(match => !product.models.includes(match[2])).map(match => [match[2], match[1]]).sort();
    assert.deepEqual(product.indoorUnits.map(unit => [unit.model, unit.quantity]).sort(), authoredHeads,
      "Every selected room unit must be counted exactly once; a partial known-head list cannot calculate");
    for (const unit of product.indoorUnits) {
      assert.ok(selected.value.includes(unit.model), "A different head model must not be silently substituted");
      assert.ok(Number.isInteger(Number(unit.quantity)) && Number(unit.quantity) >= 1 && Number(unit.quantity) <= 20);
      for (const value of [unit.heatingCapacityKw, unit.coolingCapacityKw]) assert.ok(/^\d+(\.\d+)?$/.test(value) && Number(value) > 0 && Number(value) <= 65);
      assert.match(unit.sourceUrl, /^https:\/\//);
    }
  }
  const rinnai = coolingData.products.find(product => product.id === "rinnai-multi-px");
  assert.equal(rinnai.indoorUnits[0].coolingCapacityKw, "2.6", "Manufacturer2.6kW must not be inferred as2.5 from the model name");
});

test("new Gree and Midea pairs preserve indoor/outdoor suffixes and reject older or partial identities", async () => {
  const cases = [
    { productId: "gree-pular-07", brand: "Gree", model: "GWH07AGAXB-K6DNA1A/I / GWH07AGAXB-K6DNA1A/O",
      wrong: ["GWH07AGAXB-K6DNA1A", "GWH07AGAXB-K6DNA1A/I", "GWH07AGAXB-K6DNA1A/O"] },
    { productId: "midea-xtreme-20", brand: "Midea", model: "MFXS20N / MFXS20W",
      wrong: ["MFXS20N", "MFXS20W", "MFAB20N / MFAB20W"] },
  ];
  for (const item of cases) {
    const mapping = coolingData.products.find(product => product.id === item.productId);
    const pair = item.model.split(" / ");
    assert.deepEqual(mapping.models, [item.model, pair.join("/"), `${pair[1]} / ${pair[0]}`, `${pair[1]}/${pair[0]}`]);
    for (const model of [item.model, ...item.wrong]) {
      const output = await run(coolingRequest({ productId: item.productId }),
        coolingDependencies(coolingSelection(model, "single", { brand: item.brand })));
      assert.equal(output.results[0].status, model === item.model ? "calculated" : "not-confirmed");
      if (model !== item.model) assert.equal(output.results[0].quantity, null);
    }
  }
});

test("customer results show dated gross and the assumed fee allowance, while stale and missing prices stay distinct", async () => {
  const ui = compile("../src/components/ProductRebateChecker.tsx", { react: React, "react/jsx-runtime": jsxRuntime, "@/lib/product-rebate-check": contract });
  const render = result => renderToStaticMarkup(React.createElement(ui.ProductRebateResult, {
    product: { id: result.productId, name: result.productName }, ready: true,
    check: { readyToCheck: true, entryFor: () => ({ status: "done", result }), checkProduct() {} },
  }));
  const current = render(await run(request(), dependencies({ loadPrices: async () => priceDataset() })));
  assert.match(current, /Gross certificate value: \$512\.00/);
  assert.match(current, /Estimated after fees: \$426\.00/);
  assert.match(current, /assumed 10% compliance and provider allowance/);
  assert.match(current, /9 Oct 2026/);
  const stale = render(await run(request(), dependencies({ loadPrices: async () => priceDataset("stale") })));
  assert.match(stale, /Older gross market reference/); assert.ok(!stale.includes("Estimated after fees:"));
  const missing = render(await run());
  assert.match(missing, /market value could not be confirmed/); assert.ok(!missing.includes("Gross certificate value:"));
  assert.match(missing, /8 VEECs/);
});
