import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as boundedJson from "../src/lib/bounded-json-request.ts";
import * as officialRegistry from "../src/lib/creditex-official-product-registry.ts";
import * as veuCatalogue from "../src/lib/creditex-veu-calculator-catalogue.ts";
import * as veuEstimator from "../src/lib/creditex-veu-calculator-estimator.ts";

const ROUTE_PATH = "../src/app/api/creditex/program-estimates/route.ts";

function loadRoute(validateOfficialProductSelections) {
  const source = fs.readFileSync(new URL(ROUTE_PATH, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: ROUTE_PATH,
  }).outputText;
  class TypedError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  class PostcodeError extends Error {}
  const mocks = {
    "../../../../../db": { getD1: () => ({}) },
    "@/lib/creditex-calculator-access-server": {
      CreditexCalculatorAccessError: TypedError,
      requireCreditexCalculatorAccess: async () => ({ accessType: "installer" }),
    },
    "@/lib/creditex-calculator-route-response": {
      describeCreditexCalculatorRouteError: () => null,
    },
    "@/lib/creditex-local-program-estimator": {
      CreditexLocalEstimateError: TypedError,
      estimateCreditexLocalProgram: () => {
        throw new Error("Local estimator must not run in a VEU route test");
      },
    },
    "@/lib/creditex-nsw-program-catalogue": {
      creditexNswActivityDefinition: () => null,
    },
    "@/lib/creditex-nsw-program-estimator": {
      CreditexNswEstimateError: TypedError,
      estimateCreditexNswProgram: () => {
        throw new Error("NSW estimator must not run in a VEU route test");
      },
    },
    "@/lib/creditex-veu-calculator-catalogue": veuCatalogue,
    "@/lib/creditex-veu-calculator-estimator": veuEstimator,
    "@/lib/creditex-veu-postcode-resolver": {
      CreditexVeuPostcodeError: PostcodeError,
      resolveCreditexVeuPostcode: () => ({
        geography: "metropolitan",
        climateZone: "6",
        climateRegion: "mild",
        locationClass: "metro_mild",
      }),
    },
    "@/lib/creditex-official-product-registry": officialRegistry,
    "@/lib/creditex-official-product-registry-server": {
      validateOfficialProductSelections,
    },
    "@/lib/bounded-json-request": boundedJson,
  };
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(
    require,
    moduleRecord,
    moduleRecord.exports,
  );
  return moduleRecord.exports;
}

function televisionSelection(overrides = {}) {
  return {
    id: "official-product-id",
    registryCode: "veu-approved-products",
    snapshotId: "veu-snapshot-1",
    sourceKey: "veu-public-product-register",
    sourceRecordKey: "VEU-000024",
    productKind: "veu_television_listing",
    manufacturer: "",
    brand: "Test brand",
    model: "Test model",
    series: "",
    registrationNumber: "VEU-000024",
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    attributes: {
      veuProductId: "VEU-000024",
      veuProductCategoryNumber: "24A",
      starRating: 6.5,
      screenAreaCm2: 4_500,
    },
    sourceSha256: "a".repeat(64),
    ...overrides,
  };
}

function validationResult(selection) {
  return {
    selections: [selection],
    registryReceipt: {
      installationDate: "2026-08-08",
      snapshots: [{
        registryCode: selection.registryCode,
        snapshotId: selection.snapshotId,
        sourceSha256: selection.sourceSha256,
      }],
    },
  };
}

function request(
  activityCode,
  inputs,
  selectedProductIds,
  postcode,
  effectiveDate = "2026-08-08",
) {
  return new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify({
        programCode: "VEU",
        activityCode,
        effectiveDate,
        inputs,
        ...(postcode ? { postcode } : {}),
        selectedProductIds,
      }),
    },
  );
}

test("VEU route derives formula inputs and seals exact Public Registry evidence", async () => {
  const selection = televisionSelection();
  let validationInput;
  const route = loadRoute(async (_database, input) => {
    validationInput = input;
    return validationResult(selection);
  });
  const response = await route.POST(request(
    "24",
    { scenario: "caller-tampering" },
    { veu_television_listing: "veu-public-product-register:VEU-000024" },
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(validationInput.requiredKinds, ["veu_television_listing"]);
  assert.equal(validationInput.installationDate, "2026-08-08");
  assert.equal(body.estimate.scenario, "24A");
  assert.equal(body.estimate.certificateActionEnabled, false);
  assert.equal(body.estimate.inputSnapshot.product.registry, "VEU");
  assert.equal(body.estimate.inputSnapshot.product.status, "Approved");
  assert.equal(body.estimate.inputSnapshot.product.activityCategory, "24A");
  assert.equal(body.estimate.inputSnapshot.product.productId, "VEU-000024");
  assert.equal(body.estimate.inputSnapshot.product.effectiveFrom, "2026-01-01");
  assert.equal(
    body.estimate.inputSnapshot.product.sourceSnapshotHash,
    `sha256:${"a".repeat(64)}`,
  );
  assert.equal(body.estimate.registryReceipt.snapshots.length, 1);
  assert.equal(body.estimate.approvedProducts[0].registryCode, "veu-approved-products");
  assert.notEqual(body.estimate.receiptHash, body.estimate.arithmeticReceiptHash);
});

test("VEU route preserves Legacy status for a product approved on the historical installation date", async () => {
  const selection = televisionSelection({
    approvalStatus: "legacy",
    eligibleFrom: "2024-01-01",
    eligibleTo: "2026-07-20",
  });
  const route = loadRoute(async () => ({
    ...validationResult(selection),
    registryReceipt: {
      ...validationResult(selection).registryReceipt,
      installationDate: "2026-07-01",
    },
  }));
  const response = await route.POST(request(
    "24",
    { scenario: "24A" },
    { veu_television_listing: "veu-public-product-register:VEU-000024" },
    undefined,
    "2026-07-01",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.estimate.inputSnapshot.product.status, "Legacy");
  assert.equal(body.estimate.approvedProducts[0].approvalStatus, "legacy");
  assert.equal(body.estimate.inputSnapshot.product.effectiveTo, "2026-07-20");
});

test("VEU route rejects Legacy evidence outside its official approval window", async () => {
  const selection = televisionSelection({
    approvalStatus: "legacy",
    eligibleFrom: "2024-01-01",
    eligibleTo: "2025-06-30",
  });
  const route = loadRoute(async () => validationResult(selection));
  const response = await route.POST(request(
    "24",
    { scenario: "24A" },
    { veu_television_listing: "veu-public-product-register:VEU-000024" },
  ));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "VEU_PRODUCT_NOT_EFFECTIVE");
});

test("VEU route rejects a GEMS-only selection even behind a compromised validator", async () => {
  const selection = televisionSelection({ registryCode: "gems-products" });
  const route = loadRoute(async () => validationResult(selection));
  const response = await route.POST(request(
    "24",
    { scenario: "24A" },
    { veu_television_listing: "veu-public-product-register:VEU-000024" },
  ));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.code, "VEU_PRODUCT_EVIDENCE_INVALID");
  assert.match(body.error, /did not come from the VEU Public Registry/);
});

test("VEU route keeps formula-attribute-incomplete activities unavailable", async () => {
  let validationCalls = 0;
  const route = loadRoute(async () => {
    validationCalls += 1;
    return validationResult(televisionSelection());
  });
  const response = await route.POST(request(
    "13",
    {},
    undefined,
  ));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "VEU_PRODUCT_EVIDENCE_INVALID");
  assert.match(body.error, /formula-critical approved-product attribute/);
  assert.equal(validationCalls, 0);
});
