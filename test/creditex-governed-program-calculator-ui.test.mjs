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

test("shared admin and trade VEU rendering requires the exact Public Registry model and locks product inputs", () => {
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
    assert.match(html, /VEU Public Registry eligibility evidence/);
    assert.match(html, /exact VEU Public Registry model approved on the installation date/i);
    assert.match(html, /Effective From and Effective To window/);
    assert.match(
      html,
      /Read from the exact VEU Public Registry model approved on the installation date/,
    );
    assert.doesNotMatch(html, /VEU formula inputs unavailable/);
    assert.match(
      html,
      /AS\/NZS 4234 system size<select required="" disabled=""/,
    );
    assert.match(
      html,
      /Bs2021<input inputMode="decimal" required="" disabled=""/,
    );
  }

  assert.match(adminHtml, /Refresh VEU-approved products/);
  assert.doesNotMatch(tradeHtml, /Refresh VEU-approved products/);
});

test("admin refresh selects only the program-specific governed registry", () => {
  const veu = allProgramModule.creditexAutomaticRegistryRefreshContract("VEU");
  assert.equal(veu.registryCode, "veu-approved-products");
  assert.equal(veu.requestTimeoutMs, 300_000);
  assert.match(veu.sourceLabel, /VEU Public Registry/);

  for (const programCode of ["NSW-ESS-2026", "NSW-PDRS-2026"] ) {
    const other = allProgramModule.creditexAutomaticRegistryRefreshContract(
      programCode,
    );
    assert.equal(other.registryCode, "gems-products");
    assert.equal(other.requestTimeoutMs, 300_000);
  }
  assert.equal(
    allProgramModule.creditexAutomaticRegistryRefreshContract("QLD-GRANT"),
    null,
  );
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

test("the shared approved-product picker guides brand, model, type and exact approval in order", () => {
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
  const labels = [
    "1. Product brand",
    "Find model within this brand",
    "2. Product model",
    "3. Product type or configuration",
    "4. Exact approval record",
  ];
  let previous = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > previous, `${label} must follow the prior guided step`);
    previous = index;
  }
  assert.doesNotMatch(html, /Search official registry/);
  const pickerSource = fs.readFileSync(
    path.resolve("src/components/CreditexOfficialProductPicker.tsx"),
    "utf8",
  );
  assert.match(
    pickerSource,
    /nextFacets\.productTypes\[0\]\.count === Number\([\s\S]*result\.matchCount/,
    "a sole type is selected only when it represents every matching approval",
  );
  assert.doesNotMatch(pickerSource, /hasUnclassifiedProducts/);
  assert.match(pickerSource, /Retry official registry/);
  assert.match(pickerSource, /Start product selection again/);
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
