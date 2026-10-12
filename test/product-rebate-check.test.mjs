import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contract from "../src/lib/product-rebate-check.ts";
import * as locality from "../src/lib/address-localities.mjs";
import * as sresRegistry from "../src/lib/creditex-sres-registry.ts";
import * as stc from "../src/lib/creditex-stc-estimator.ts";
import * as official from "../src/lib/creditex-official-product-registry.ts";
import * as veu from "../src/lib/creditex-veu-calculator-estimator.ts";
import * as postcode from "../src/lib/creditex-veu-postcode-resolver.ts";
import * as routeErrors from "../src/lib/creditex-calculator-route-response.ts";

const modelData = JSON.parse(readFileSync(new URL("../src/data/product-rebate-models.json", import.meta.url), "utf8"));
function compile(relative, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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

test("all 52 products have exact reviewed lookup identities, without copied certificate amounts or rebrand substitutions", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../src/lib/product-guides/hot-water.json", import.meta.url), "utf8"));
  assert.deepEqual(new Set(modelData.products.map(p => p.id)), new Set(catalogue.map(p => p.id)));
  assert.equal(modelData.products.length, 52);
  for (const model of modelData.products) {
    assert.ok(model.models.length > 0 && model.models.every(name => name.trim() === name && name.length > 0));
    assert.ok(!JSON.stringify(model).includes("Number of certificates"));
    assert.ok(!Object.hasOwn(model, "cost"));
  }
  assert.ok(!modelData.products.find(p => p.id === "earthworker-neo-250").brands.includes("Neopower"));
  assert.ok(!modelData.products.find(p => p.id === "istore-r290-270").brands.includes("PHNIX"));
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
  assert.ok(!JSON.stringify(output).includes("unitPrice") && !JSON.stringify(output).includes("grossValue"));
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

test("the anonymous route rejects unsupported input and cross-origin requests before touching data", async () => {
  let calls = 0;
  const route = compile("../src/app/api/product-rebates/route.ts", {
    "../../../../db": { getD1() { calls++; return {}; } },
    "@/lib/bounded-json-request": await import("../src/lib/bounded-json-request.ts"),
    "@/lib/product-rebate-check": contract,
    "@/lib/product-rebate-check-server": { checkProductRebates: async () => { calls++; return { ok: true }; } },
  });
  const input = (body, origin = "https://example.com") => new Request("https://example.com/api/product-rebates", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await route.POST(input(request(), "https://other.example"))).status, 403);
  assert.equal((await route.POST(input({ ...request(), customerId: "private" }))).status, 400);
  assert.equal(calls, 0);
  const response = await route.POST(input(request()));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});
