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
        gasReticulated: true,
        climateZone: "4",
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
    "14",
    {},
    undefined,
  ));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "VEU_PRODUCT_EVIDENCE_INVALID");
  assert.match(body.error, /formula-critical approved-product attribute/);
  assert.equal(validationCalls, 0);
});

test("VEU route calculates product-free governed activities without inventing a registry record", async () => {
  let validationCalls = 0;
  const route = loadRoute(async () => {
    validationCalls += 1;
    throw new Error("Product validation must not run for activity 43");
  });
  const response = await route.POST(request(
    "43",
    {
      scenario: "43A",
      geography: "regional",
      operating_temperature_band: "at_or_above_zero_c",
      internal_floor_area_m2: "10",
      system_count: "1",
      eligible_parts_configuration_confirmed: "yes",
    },
    undefined,
    "3000",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(validationCalls, 0);
  assert.equal(body.estimate.activityCode, "43");
  assert.equal(body.estimate.scenario, "43A");
  assert.equal(body.estimate.output.wholeCertificates, "8");
  assert.equal(body.estimate.inputSnapshot.geography, "metropolitan");
  assert.equal(body.estimate.inputSnapshot.product, null);
  assert.equal(body.estimate.registryReceipt, undefined);
});

test("VEU route derives Activity 30 category and postcode gas class server-side", async () => {
  const selection = televisionSelection({
    productKind: "veu_in_home_display",
    registrationNumber: "VEU-000030",
    sourceRecordKey: "VEU-000030",
    attributes: {
      veuProductId: "VEU-000030",
      veuProductCategoryNumber: "30A",
    },
  });
  const route = loadRoute(async () => validationResult(selection));
  const response = await route.POST(request(
    "30",
    {
      scenario: "30B",
      geography: "regional",
      gas_reticulation: "not_reticulated",
      installation_count: "1",
    },
    { veu_in_home_display: "veu-public-product-register:VEU-000030" },
    "3000",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.estimate.scenario, "30A");
  assert.equal(body.estimate.inputSnapshot.geography, "metropolitan");
  assert.equal(body.estimate.inputSnapshot.gasReticulation, "reticulated");
  assert.equal(body.estimate.inputSnapshot.product.registry, "VEU");
});

test("VEU Activity 31A accepts only the exact dated GEMS motor and derives rated output", async () => {
  const selection = televisionSelection({
    registryCode: "gems-products",
    productKind: "electric_motor",
    registrationNumber: "GEMS-MOTOR-31",
    sourceRecordKey: "GEMS-MOTOR-31",
    approvalStatus: "approved",
    attributes: { ratedOutputKw: 7.5 },
  });
  const route = loadRoute(async () => validationResult(selection));
  const response = await route.POST(request(
    "31",
    {
      scenario: "31A",
      geography: "regional",
      rated_output_kw: "185",
      installation_count: "1",
      co_payment_per_motor_aud: "200",
    },
    { electric_motor: "gems-motor:GEMS-MOTOR-31" },
    "3000",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.estimate.scenario, "31A");
  assert.equal(body.estimate.inputSnapshot.ratedOutputKw, "7.5");
  assert.equal(body.estimate.inputSnapshot.product.registry, "GEMS");
  assert.equal(body.estimate.inputSnapshot.product.status, "Registered");
  assert.equal(body.estimate.inputSnapshot.product.productId, "GEMS-MOTOR-31");
});

test("VEU route rejects unreleased product scenarios before official derivation", async () => {
  let validationCalls = 0;
  const route = loadRoute(async () => {
    validationCalls += 1;
    throw new Error("Unsupported scenarios must not reach product validation");
  });
  for (const [activityCode, scenario] of [["31", "31B"], ["33", "33B"]]) {
    const response = await route.POST(request(
      activityCode,
      { scenario },
      undefined,
      "3000",
    ));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "VEU_INPUT_INVALID");
    assert.match(body.error, /not available/i);
  }
  assert.equal(validationCalls, 0);
});

test("VEU Part 27 uses the selected registry product for power and validates installed controls", async () => {
  const selection = televisionSelection({
    productKind: "veu_activity_27_product",
    registrationNumber: "VEU-000027",
    sourceRecordKey: "VEU-000027",
    attributes: {
      veuProductId: "VEU-000027",
      veuProductCategoryNumber: "27B",
      victorianLampCircuitPowerW: 20,
      occupancySensor: false,
      programmableDimmer: true,
    },
  });
  let validationInput;
  const route = loadRoute(async (_database, input) => {
    validationInput = input;
    return validationResult(selection);
  });
  const response = await route.POST(request(
    "27",
    {
      scenario: "27B",
      geography: "regional",
      baseline_lcp_w: "100",
      baseline_control_profile: "none",
      approved_upgrade_lcp_w: "999",
      approved_upgrade_control_profile: "programmable_dimmer",
      incumbent_source_count: "1",
      upgrade_source_count: "1",
    },
    { veu_activity_27_product: "veu-public-product-register:VEU-000027" },
    "3000",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(validationInput.requiredKinds, ["veu_activity_27_product"]);
  assert.equal(body.estimate.scenario, "27B");
  assert.equal(body.estimate.inputSnapshot.upgradeLcpW, "20/1");
  assert.equal(body.estimate.inputSnapshot.upgradeControlProfile, "programmable_dimmer");
  assert.equal(body.estimate.inputSnapshot.product.productId, "VEU-000027");
});

test("VEU product-free lighting scenarios skip registry validation and invent no selection", async () => {
  let validationCalls = 0;
  const route = loadRoute(async () => {
    validationCalls += 1;
    throw new Error("Product validation must not run for Part 27C");
  });
  const response = await route.POST(request(
    "27",
    {
      scenario: "27C",
      geography: "regional",
      baseline_lcp_w: "100",
      baseline_control_profile: "none",
      incumbent_source_count: "1",
      removal_requirements_confirmed: "yes",
    },
    undefined,
    "3000",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(validationCalls, 0);
  assert.equal(body.estimate.scenario, "27C");
  assert.equal(body.estimate.inputSnapshot.product, null);
  assert.equal(body.estimate.registryReceipt, undefined);
});
