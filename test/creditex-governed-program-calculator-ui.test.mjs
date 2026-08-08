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
    ["17", "22", "24", "25", "46", "48"],
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
  for (const code of ["1C", "1D", "3C", "3D", "6", "13", "14", "15", "26"]) {
    assert.equal(governedModule.creditexVeuActivitySourceComplete(code), false);
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
    assert.match(html, /VEU formula inputs unavailable/);
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
