import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let governedModule;
let allProgramModule;
let officialPickerModule;
let veuCatalogueModule;

before(async () => {
  server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true },
  });
  governedModule = await server.ssrLoadModule(
    "/src/components/CreditexGovernedProgramCalculator.tsx",
  );
  allProgramModule = await server.ssrLoadModule(
    "/src/components/CreditexAllProgramCalculator.tsx",
  );
  officialPickerModule = await server.ssrLoadModule(
    "/src/components/CreditexOfficialProductPicker.tsx",
  );
  veuCatalogueModule = await server.ssrLoadModule(
    "/src/lib/creditex-veu-calculator-catalogue.ts",
  );
});

after(async () => {
  await server?.close();
});

function veuProduct(overrides = {}) {
  return {
    id: "official:27:veu-public-product-register000060640",
    productKind: "veu_induction_cooktop",
    brand: "Exact Brand",
    manufacturer: "",
    model: "Exact Model 46A",
    series: "",
    certificateNumber: "",
    registrationNumber: "000060640",
    registryCode: "veu-approved-products",
    approvalStatus: "approved",
    snapshotId: "veu-snapshot-2026-08-09",
    sourceSha256: "a".repeat(64),
    eligibleFrom: "2026-07-01",
    eligibleTo: "",
    attributes: { veuProductCategoryNumber: "46A" },
    ...overrides,
  };
}

test("VEU activity 46 stays disabled without one exact dated approved product", () => {
  const missing = governedModule.creditexVeuProductEvidenceState(
    "46",
    "2026-08-09",
    {},
  );
  assert.deepEqual(missing.requiredKinds, ["veu_induction_cooktop"]);
  assert.equal(missing.missingProduct, true);
  assert.equal(missing.blocked, true);
  assert.deepEqual(missing.selectedProductIds, {});

  const product = veuProduct();
  const complete = governedModule.creditexVeuProductEvidenceState(
    "46",
    "2026-08-09",
    { veu_induction_cooktop: product },
  );
  assert.equal(complete.blocked, false);
  assert.deepEqual(complete.selectedProductIds, {
    veu_induction_cooktop: product.id,
  });
  assert.deepEqual(complete.completeSelections, [product]);
});

test("UI source-complete activities stay synchronized with the estimate API", () => {
  assert.deepEqual(
    governedModule.CREDITEX_VEU_UI_SOURCE_COMPLETE_ACTIVITY_CODES,
    [
      "1C", "1D", "3C", "3D", "6", "13", "15", "17",
      "22", "24", "25", "26", "27", "30", "31", "33", "34", "35", "36",
      "37", "38", "39", "40", "41", "42", "43",
      "44", "46", "48",
    ],
  );
  const route = fs.readFileSync(
    new URL(
      "../src/app/api/creditex/program-estimates/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const sourceSet = /const CREDITEX_VEU_SOURCE_COMPLETE_ACTIVITY_CODES = new Set\(\[([\s\S]*?)\]\);/
    .exec(route);
  assert.ok(sourceSet);
  const routeCodes = Array.from(
    sourceSet[1].matchAll(/"([^"]+)"/g),
    (match) => match[1],
  );
  assert.deepEqual(
    governedModule.CREDITEX_VEU_UI_SOURCE_COMPLETE_ACTIVITY_CODES,
    routeCodes,
  );
  for (const code of ["14", "28", "32"]) {
    assert.equal(governedModule.creditexVeuActivitySourceComplete(code), false);
  }
});

test("product-free governed VEU activities do not invent a registry selection", () => {
  for (const activityCode of ["37", "38", "39", "40", "41", "42", "43"]) {
    const state = governedModule.creditexVeuProductEvidenceState(
      activityCode,
      "2026-08-09",
      {},
    );
    assert.deepEqual(state.requiredKinds, []);
    assert.deepEqual(state.selectedProductIds, {});
    assert.equal(state.missingProduct, false);
    assert.equal(state.blocked, false);
  }
});

test("VEU UI evidence fails closed for unavailable, undated, expired and wrong-category rows", () => {
  for (const [product, expected] of [
    [veuProduct({ eligibleFrom: "" }), /Effective From/],
    [veuProduct({ eligibleTo: "2026-08-08" }), /approval window/],
    [veuProduct({
      attributes: { veuProductCategoryNumber: "24A" },
    }), /does not match activity 46/],
    [veuProduct({ productKind: "veu_television_listing" }), /identity is incomplete or does not match/],
    [veuProduct({ approvalStatus: "unknown" }), /not pinned to a VEU Public Registry approval/],
    [veuProduct({ approvalStatus: "legacy", eligibleTo: "" }), /historical.*no defensible Effective To/],
  ]) {
    const state = governedModule.creditexVeuProductEvidenceState(
      "46",
      "2026-08-09",
      { veu_induction_cooktop: product },
    );
    assert.equal(state.blocked, true);
    assert.match(state.issue, expected);
  }

  const unavailable = governedModule.creditexVeuProductEvidenceState(
    "46",
    "2026-08-09",
    { veu_induction_cooktop: veuProduct() },
    "The current VEU Public Registry snapshot is stale or unavailable.",
  );
  assert.equal(unavailable.blocked, true);
  assert.match(unavailable.issue, /stale or unavailable/);

  const historical = governedModule.creditexVeuProductEvidenceState(
    "46",
    "2026-08-09",
    {
      veu_induction_cooktop: veuProduct({
        approvalStatus: "legacy",
        eligibleFrom: "2026-07-01",
        eligibleTo: "2026-08-31",
      }),
    },
  );
  assert.equal(historical.blocked, false);
});

test("activity and installation-date identity changes clear selected products and evidence", () => {
  const selected = governedModule.creditexVeuProductUiReducer(
    { selectedProducts: {}, registryIssue: "", evidenceError: "" },
    {
      type: "product_selected",
      kind: "veu_induction_cooktop",
      product: veuProduct(),
    },
  );
  assert.equal(
    selected.selectedProducts.veu_induction_cooktop.model,
    "Exact Model 46A",
  );

  for (const reason of ["activity", "installation_date"]) {
    const reset = governedModule.creditexVeuProductUiReducer(selected, {
      type: "identity_changed",
      reason,
    });
    assert.deepEqual(reset, {
      selectedProducts: {},
      registryIssue: "",
      evidenceError: "",
    });
  }
});

test("a stale picker response cannot clear a newer activity or date selection", () => {
  let state = governedModule.creditexVeuProductUiReducer(
    { selectedProducts: {}, registryIssue: "", evidenceError: "" },
    {
      type: "product_selected",
      kind: "veu_induction_cooktop",
      product: veuProduct(),
    },
  );
  const staleRequestGeneration = 4;
  const currentIdentityGeneration = 5;
  if (governedModule.creditexVeuShouldApplyProductResponse(
    staleRequestGeneration,
    currentIdentityGeneration,
  )) {
    state = governedModule.creditexVeuProductUiReducer(state, {
      type: "identity_changed",
      reason: "registry_snapshot",
      issue: "Old request failed",
    });
  }
  assert.equal(
    state.selectedProducts.veu_induction_cooktop.model,
    "Exact Model 46A",
  );
  assert.equal(state.registryIssue, "");
});

test("a settled current registry does not schedule another parent render", () => {
  const state = { selectedProducts: {}, registryIssue: "", evidenceError: "" };
  assert.equal(
    governedModule.creditexVeuProductUiReducer(state, { type: "registry_current" }),
    state,
  );
});

test("shared admin and trade VEU rendering leads with a short quote flow", () => {
  const api = async () => ({ ok: true });
  const adminHtml = renderToStaticMarkup(React.createElement(
    allProgramModule.CreditexAllProgramCalculator,
    { api, role: "admin", initialProgramCode: "VEU" },
  ));
  const tradeHtml = renderToStaticMarkup(React.createElement(
    allProgramModule.CreditexAllProgramCalculator,
    { api, role: "trade", initialProgramCode: "VEU" },
  ));

  for (const html of [adminHtml, tradeHtml]) {
    const visibleOrder = [
      ">Activity<",
      ">Installation date<",
      ">Brand<",
      ">Model<",
      ">Postcode<",
      ">Premises type<",
      ">Eligibility and evidence<",
      ">Calculate rebate estimate<",
    ];
    let previous = -1;
    for (const marker of visibleOrder) {
      const index = html.indexOf(marker);
      assert.ok(index > previous, `${marker} must follow the prior quote field`);
      previous = index;
    }
    assert.match(
      html,
      /<input type="date" min="2026-06-30" required="" value="[^"]+"/,
    );
    assert.match(html, /Number of identical systems/);
    assert.match(html, /max="10"/);
    assert.doesNotMatch(html, /type="date"[^>]*max=/);
    assert.match(html, /<button type="submit">Calculate rebate estimate<\/button>/);
    assert.doesNotMatch(html, /AS\/NZS 4234 system size|Bs2021/);
    assert.doesNotMatch(
      html,
      /VEU consumer fact sheet provided|Decommissioning and lawful disposal|Warranty obligations evidence/,
    );
    assert.doesNotMatch(
      html,
      /Certificate actions disabled|official rows|snapshot [a-z0-9]/i,
    );
    const evidence = /<details><summary>Eligibility and evidence<\/summary>([\s\S]*?)<\/details>/
      .exec(html)?.[1] || "";
    assert.doesNotMatch(evidence, /<(?:input|select)\b/);
  }

  assert.match(adminHtml, /Refresh VEU-approved products/);
  assert.doesNotMatch(tradeHtml, /Refresh VEU-approved products/);
});

test("admin refresh selects only the program-specific governed registry", () => {
  const veu = allProgramModule.creditexAutomaticRegistryRefreshContract("VEU");
  assert.deepEqual(veu.registryCodes, ["veu-approved-products"]);
  assert.equal(veu.requestTimeoutMs, 300_000);
  assert.match(veu.sourceLabel, /VEU Public Registry/);
  assert.equal(veu.buttonLabel, "Refresh VEU-approved products");

  for (const programCode of ["NSW-ESS-2026", "NSW-PDRS-2026"] ) {
    const other = allProgramModule.creditexAutomaticRegistryRefreshContract(
      programCode,
    );
    assert.deepEqual(
      other.registryCodes,
      ["gems-products", "nsw-tessa-products"],
    );
    assert.equal(other.requestTimeoutMs, 300_000);
    assert.equal(other.buttonLabel, "Refresh NSW official products");
    assert.match(other.currentLabel, /NSW official product rows are current/);
  }
  assert.equal(
    allProgramModule.creditexAutomaticRegistryRefreshContract("QLD-GRANT"),
    null,
  );
});

test("NSW admin refresh updates GEMS then TESSA and combines their current row counts", async () => {
  const contract = allProgramModule.creditexAutomaticRegistryRefreshContract(
    "NSW-PDRS-2026",
  );
  const calls = [];
  const recordCount = await allProgramModule.creditexRefreshAutomaticProductRegistries(
    async (path, init, options) => {
      const body = JSON.parse(init.body);
      calls.push({ path, body, options });
      return {
        ok: true,
        registries: [{
          registryCode: body.registryCode,
          recordCount: body.registryCode === "gems-products" ? 31_418 : 746,
        }],
      };
    },
    contract,
  );

  assert.equal(recordCount, 32_164);
  assert.deepEqual(
    calls.map((call) => call.body.registryCode),
    ["gems-products", "nsw-tessa-products"],
  );
  for (const call of calls) {
    assert.equal(call.path, "/api/creditex/official-products");
    assert.equal(call.body.action, "refresh");
    assert.equal(call.options.requestTimeoutMs, 300_000);
  }
});

test("NSW admin refresh fails closed when either governed source cannot refresh", async () => {
  const contract = allProgramModule.creditexAutomaticRegistryRefreshContract(
    "NSW-ESS-2026",
  );
  const registryCodes = [];

  await assert.rejects(
    allProgramModule.creditexRefreshAutomaticProductRegistries(
      async (_path, init) => {
        const { registryCode } = JSON.parse(init.body);
        registryCodes.push(registryCode);
        if (registryCode === "nsw-tessa-products") {
          throw new Error("TESSA refresh unavailable");
        }
        return { registries: [{ recordCount: 31_418 }] };
      },
      contract,
    ),
    /TESSA refresh unavailable/,
  );
  assert.deepEqual(registryCodes, ["gems-products", "nsw-tessa-products"]);
});

test("NSW official-product refresh remains admin-only", () => {
  const api = async () => ({ ok: true });
  const adminHtml = renderToStaticMarkup(React.createElement(
    allProgramModule.CreditexAllProgramCalculator,
    { api, role: "admin", initialProgramCode: "NSW-PDRS-2026" },
  ));
  const tradeHtml = renderToStaticMarkup(React.createElement(
    allProgramModule.CreditexAllProgramCalculator,
    { api, role: "trade", initialProgramCode: "NSW-PDRS-2026" },
  ));

  assert.match(adminHtml, /Refresh NSW official products/);
  assert.match(adminHtml, /NSW official product data/);
  assert.doesNotMatch(adminHtml, /GEMS controlled registry|TESSA/);
  assert.doesNotMatch(tradeHtml, /Refresh NSW official products/);
  assert.doesNotMatch(tradeHtml, /Official data status/);
});

test("VEU product lookups use the registry governed by each exact product kind", () => {
  assert.equal(
    governedModule.creditexVeuRegistryCodeForProductKind("veu_water_heater"),
    "veu-approved-products",
  );
  assert.equal(
    governedModule.creditexVeuRegistryCodeForProductKind("electric_motor"),
    "gems-products",
  );
  assert.equal(
    governedModule.creditexVeuRegistryCodeForProductKind("unknown"),
    "",
  );
});

test("the shared approved-product picker shows only choices that remain necessary", () => {
  const html = renderToStaticMarkup(React.createElement(
    officialPickerModule.CreditexOfficialProductPicker,
    {
      api: async () => ({ products: [], facets: {}, registry: {} }),
      kind: "air_conditioner",
      installationDate: "2026-08-09",
      selectedId: "",
      onSelect: () => undefined,
    },
  ));
  const labels = ["Brand", "Model"];
  let previous = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > previous, `${label} must follow the prior guided step`);
    previous = index;
  }
  assert.doesNotMatch(
    html,
    /Find model within this brand|Product type|Exact approval|official rows|snapshot/i,
  );
  const pickerSource = fs.readFileSync(
    path.resolve("src/components/CreditexOfficialProductPicker.tsx"),
    "utf8",
  );
  assert.match(
    pickerSource,
    /nextFacets\.productTypes\[0\]\.count === Number\([\s\S]*result\.matchCount/,
    "a sole type is selected only when it represents every matching approval",
  );
  assert.match(pickerSource, /facets\.productTypes\.length > 1 &&/);
  assert.match(pickerSource, /products\.length > 1/);
  assert.doesNotMatch(pickerSource, /hasUnclassifiedProducts/);
  assert.match(pickerSource, /Retry official registry/);
  assert.doesNotMatch(pickerSource, /Start product selection again/);
  assert.doesNotMatch(pickerSource, /modelQuery|official rows|snapshot \$\{/);
  assert.match(pickerSource, /aria-busy=\{busy\}/);
  assert.match(pickerSource, /aria-live="polite"/);
  assert.doesNotMatch(
    pickerSource.match(/\}, \[[\s\S]*?\]\);\s*\n\s*return \(/)?.[0] || "",
    /\bselectedId,\s*\n/,
    "selecting an exact approval must not repeat the same registry lookup",
  );
  assert.doesNotMatch(
    pickerSource.match(/\}, \[[\s\S]*?\]\);\s*\n\s*const options/)?.[0] || "",
    /\bonSelect,\s*\n/,
    "a fresh inline parent callback must not restart the registry fetch effect",
  );
});

test("quote requests allow future installation dates without exposing evidence controls", () => {
  const source = fs.readFileSync(
    path.resolve("src/components/CreditexGovernedProgramCalculator.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /max=\{todayIso\(\)\}/);
  assert.match(source, /estimatePurpose: "quote"/);
  assert.match(source, /effectiveDate: date/);
  assert.match(source, /creditexVeuQuoteInputVisible\(definition, inputs\)/);
  assert.match(source, /creditexQuoteEvidenceInput\(definition\.key\)/);
  assert.match(source, /<summary>Calculation details<\/summary>/);
  const veuUiSource = source.slice(source.indexOf("function CreditexVeuCalculator"));
  assert.ok(
    veuUiSource.indexOf("{scenarioInputs.map(renderVeuInput)}")
      < veuUiSource.indexOf("Installation date"),
    "plain-English scenario must precede installation date",
  );
  assert.ok(
    veuUiSource.indexOf("{requiredKinds.map((kind) => (")
      < veuUiSource.indexOf("{postcodeRequired && ("),
    "approved product must precede postcode in the quote flow",
  );

  const part6 = veuCatalogueModule.CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(
    (activity) => activity.activityCode === "6",
  );
  const indoorHeating = part6.inputDefinitions.find(
    (definition) => definition.key === "rated_heating_capacity_kw",
  );
  const outdoorHeating = part6.inputDefinitions.find(
    (definition) => definition.key === "outdoor_heating_capacity_kw",
  );
  assert.equal(
    governedModule.creditexVeuQuoteInputVisible(
      indoorHeating,
      { configuration: "single" },
    ),
    false,
  );
  assert.equal(
    governedModule.creditexVeuQuoteInputVisible(
      indoorHeating,
      { configuration: "multi" },
    ),
    false,
  );
  assert.equal(
    governedModule.creditexVeuQuoteInputVisible(
      outdoorHeating,
      { configuration: "multi" },
    ),
    false,
  );

  const allProgramSource = fs.readFileSync(
    path.resolve("src/components/CreditexAllProgramCalculator.tsx"),
    "utf8",
  );
  assert.match(allProgramSource, /max=\{program\.effectiveTo \|\| undefined\}/);
  assert.doesNotMatch(allProgramSource, /program\.effectiveTo \|\| todayIso\(\)/);
  assert.match(allProgramSource, /estimatePurpose: "quote"/);
  assert.match(allProgramSource, /effectiveDate: date/);
});

test("weather sealing starts with an exact plain-English job type", () => {
  const activity = veuCatalogueModule.CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(
    (candidate) => candidate.activityCode === "15",
  );
  const scenario = activity.inputDefinitions.find(
    (definition) => definition.key === "scenario",
  );
  assert.equal(scenario.source, "operator");
  assert.equal(scenario.label, "What are you sealing?");
  assert.deepEqual(
    scenario.options.map((option) => option.value),
    ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "15H"],
  );
  for (const expected of [
    /external door/i,
    /external window/i,
    /self-closing sealed fan/i,
    /damper or seal/i,
    /external wall vent/i,
    /permanent chimney/i,
    /temporary or seasonal chimney/i,
    /evaporative-cooling ceiling outlet/i,
  ]) {
    assert.ok(scenario.options.some(({ label }) => expected.test(label)));
  }

  const source = fs.readFileSync(
    path.resolve("src/components/CreditexGovernedProgramCalculator.tsx"),
    "utf8",
  );
  assert.match(source, /\["15", "27", "34", "35", "48"\]/);
  assert.match(source, /productContractScenario/);
  assert.match(source, /Number of external doors/);
  assert.match(source, /Number of permanent chimney or flue seals/);
  assert.match(source, /Number of temporary or seasonal chimney or flue seals/);

  const selectedDoorSeal = veuProduct({
    id: "official:15:door-seal",
    productKind: "veu_weather_sealing",
    registrationNumber: "VEU-15A-1",
    attributes: { veuProductCategoryNumber: "15A" },
  });
  const exactScenario = governedModule.creditexVeuProductEvidenceState(
    "15",
    "2026-08-09",
    { veu_weather_sealing: selectedDoorSeal },
    "",
    "15A",
  );
  assert.equal(exactScenario.blocked, false);
  const wrongScenario = governedModule.creditexVeuProductEvidenceState(
    "15",
    "2026-08-09",
    { veu_weather_sealing: selectedDoorSeal },
    "",
    "15B",
  );
  assert.equal(wrongScenario.blocked, true);
  assert.match(wrongScenario.issue, /does not match activity 15/);
});

test("Part 6 indoor-unit rows derive transparent connected totals", () => {
  const totals = governedModule.creditexPart6IndoorCapacityTotals([
    {
      id: "one",
      label: "Living",
      model: "INDOOR-35",
      quantity: "2",
      heatingCapacityKw: "3.5",
      coolingCapacityKw: "3",
    },
    {
      id: "two",
      label: "Bedroom",
      model: "",
      quantity: "1",
      heatingCapacityKw: "2.5",
      coolingCapacityKw: "2.5",
    },
  ]);
  assert.deepEqual(totals, {
    complete: true,
    quantity: 3,
    heatingCapacityKw: 9.5,
    coolingCapacityKw: 8.5,
  });
  assert.equal(governedModule.creditexPart6IndoorCapacityTotals([
    {
      id: "invalid",
      label: "",
      model: "",
      quantity: "",
      heatingCapacityKw: "3.5",
      coolingCapacityKw: "3.5",
    },
  ]).complete, false);

  const source = fs.readFileSync(
    path.resolve("src/components/CreditexGovernedProgramCalculator.tsx"),
    "utf8",
  );
  assert.match(source, /Connected indoor units/);
  assert.match(source, /Add another indoor unit/);
  assert.match(source, /visibleInputs\.indoor_units/);
  assert.doesNotMatch(source, /Indoor unit evidence confirmed/);
});

test("VEU Part 6 preserves governed codes behind plain-English scenario labels", () => {
  const options = veuCatalogueModule.CREDITEX_VEU_PART_6_SCENARIO_OPTIONS;
  assert.deepEqual(options.map((option) => option.value), [
    "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi",
  ]);
  assert.match(options[0].label, /hard-wired electric room heater/i);
  assert.match(options[1].label, /also decommission an air conditioner/i);
  assert.match(options[1].label, /heats the same area/i);
  assert.match(options[1].label, /residential bedroom/i);
  assert.match(options[1].label, /under 20 m²/i);
  assert.match(options[2].label, /at least 100 m²/i);
  assert.match(options[4].label, /main heating system/i);
  assert.match(options[7].label, /also decommission an air conditioner/i);
  assert.match(options[7].label, /heats the same area/i);
  assert.match(options[9].label, /also decommission an air conditioner/i);
  assert.match(options[9].label, /heats the same area/i);
  assert.match(options[10].label, /without decommissioning existing equipment/i);
  assert.equal(options.some((option) => /^Scenario \(/.test(option.label)), false);
});
