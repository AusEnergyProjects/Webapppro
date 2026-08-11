import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as boundedJson from "../src/lib/bounded-json-request.ts";
import * as localCatalogue from "../src/lib/creditex-local-program-catalogue.ts";
import * as localEstimator from "../src/lib/creditex-local-program-estimator.ts";
import * as officialRegistry from "../src/lib/creditex-official-product-registry.ts";
import * as nswCatalogue from "../src/lib/creditex-nsw-program-catalogue.ts";
import * as nswEstimator from "../src/lib/creditex-nsw-program-estimator.ts";
import * as veuCatalogue from "../src/lib/creditex-veu-calculator-catalogue.ts";
import * as veuEstimator from "../src/lib/creditex-veu-calculator-estimator.ts";

const ROUTE_PATH = "../src/app/api/creditex/program-estimates/route.ts";

function loadRoute(
  validateOfficialProductSelections,
  observeCalculatorAccess = () => undefined,
) {
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
      requireCreditexCalculatorAccess: async (...args) => {
        observeCalculatorAccess(args[2]);
        return { accessType: "installer" };
      },
    },
    "@/lib/creditex-calculator-route-response": {
      describeCreditexCalculatorRouteError: () => null,
    },
    "@/lib/creditex-local-program-estimator": localEstimator,
    "@/lib/creditex-local-program-catalogue": localCatalogue,
    "@/lib/creditex-nsw-program-catalogue": {
      ...nswCatalogue,
    },
    "@/lib/creditex-nsw-program-estimator": nswEstimator,
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
  estimatePurpose,
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
        ...(estimatePurpose ? { estimatePurpose } : {}),
        selectedProductIds,
      }),
    },
  );
}

function airConditionerSelection(configurationClass = "single") {
  return televisionSelection({
    productKind: "veu_air_conditioner",
    registrationNumber: "VEU-000006",
    sourceRecordKey: "VEU-000006",
    eligibleFrom: "2026-07-21",
    eligibleTo: "2026-12-31",
    attributes: {
      veuProductId: "VEU-000006",
      veuProductCategoryNumber: "6D",
      veuProductConfiguration: configurationClass === "multi"
        ? "Multiple split - variable refrigerant flow"
        : configurationClass === "packaged"
          ? "Packaged air conditioner"
          : "Single split system",
      veuProductConfigurationClass: configurationClass,
      ratedHeatingCapacityKw: 3.8,
      ratedCoolingCapacityKw: 3.5,
      refrigerantType: "R-32",
      gemsHspfColdResidential: 4.8,
      gemsTcspfColdResidential: 5.9,
      gemsHspfMixedResidential: 5.1,
      gemsTcspfMixedResidential: 6.2,
    },
  });
}

function waterHeaterSelection(id, bs2021 = 1) {
  return televisionSelection({
    id,
    productKind: "veu_water_heater",
    registrationNumber: id,
    sourceRecordKey: id,
    eligibleFrom: "2026-01-01",
    eligibleTo: "",
    attributes: {
      veuProductId: id,
      veuProductCategoryNumber: "1D",
      veuSystemSize: "Small",
      zone4AnnualEnergySavings: 70,
      bs2021Zone4StepDownLoadGjPerYear: bs2021,
      be2021Zone4StepDownLoadGjPerYear: 1,
    },
  });
}

function waterHeaterQuoteInputs() {
  return {
    geography: "caller-value",
    system_size: "caller-value",
    climate_zone: "caller-value",
    bs2021_gj_per_year: "999",
    be2021_gj_per_year: "999",
    premises: "residential",
    prior_relevant_period_water_heater_products: "0",
    incumbent_scenario_requirements_confirmed: "no",
    residential_consumer_fact_sheet_provided: "no",
    residential_suitability_and_sizing_advice_confirmed: "no",
    no_additional_inline_storage_or_system_confirmed: "no",
    decommissioning_and_disposal_confirmed: "no",
    co_payment_per_installed_product_aud: "0",
    refrigerant_gwp: "675",
    warranty_years: "0",
    warranty_requirements_confirmed: "no",
  };
}

function part6QuoteInputs(overrides = {}) {
  return {
    scenario: "vii",
    category: "caller-value",
    premises: "residential",
    location_class: "caller-value",
    configuration: "single",
    rated_heating_capacity_kw: "12.5",
    rated_cooling_capacity_kw: "11.25",
    hspf_upgrade: "99",
    tcspf_upgrade: "99",
    hspf_cold_eligibility: "99",
    tcspf_cold_eligibility: "99",
    refrigerant_gwp: "1",
    performance_basis: "gems",
    same_oem_confirmed: "no",
    incumbent_scenario_requirements_confirmed: "no",
    decommissioning_and_disposal_confirmed: "no",
    residential_consumer_fact_sheet_provided: "no",
    residential_suitability_and_sizing_advice_confirmed: "no",
    warranty_years: "0",
    warranty_requirements_confirmed: "no",
    co_payment_per_installed_product_aud: "0",
    ...overrides,
  };
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

test("VEU route produces a future-dated single-system quote without treating evidence assumptions as eligibility", async () => {
  const selection = airConditionerSelection("single");
  let validationInput;
  let accessOptions;
  const route = loadRoute(async (_database, input) => {
    validationInput = input;
    return validationResult(selection);
  }, (options) => {
    accessOptions = options;
  });
  const response = await route.POST(request(
    "6",
    part6QuoteInputs(),
    { veu_air_conditioner: "veu-public-product-register:VEU-000006" },
    "3000",
    "2026-10-15",
    "quote",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(accessOptions, { allowPublicQuote: true });
  assert.equal(validationInput.installationDate, "2026-10-15");
  assert.equal(body.estimate.estimatePurpose, "quote");
  assert.equal(body.estimate.eligibilityConfirmed, false);
  assert.equal(body.estimate.inputSnapshot.configuration, "single");
  assert.equal(body.estimate.inputSnapshot.ratedHeatingCapacityKw, "19/5");
  assert.equal(body.estimate.inputSnapshot.ratedCoolingCapacityKw, "7/2");
  assert.equal(body.estimate.inputSnapshot.product.productId, "VEU-000006");
  assert.equal(body.estimate.inputSnapshot.product.effectiveTo, "2026-12-31");
  assert.ok(body.estimate.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "co_payment_per_installed_product_aud" && assumptionApplied,
  ));
});

test("VEU route validates and seals every mixed water-heater model before totaling the property", async () => {
  const selections = {
    "official:wh-a": waterHeaterSelection("VEU-WH-A", 1),
    "official:wh-b": waterHeaterSelection("VEU-WH-B", 2),
  };
  const validationInputs = [];
  const route = loadRoute(async (_database, input) => {
    validationInputs.push(input);
    const selectedId = input.selectedProductIds.veu_water_heater;
    return validationResult(selections[selectedId]);
  });
  const requestBody = {
    estimatePurpose: "quote",
    programCode: "VEU",
    activityCode: "1D",
    effectiveDate: "2026-08-08",
    postcode: "3000",
    inputs: waterHeaterQuoteInputs(),
    waterHeaterItems: [
      { selectedProductId: "official:wh-a", unitQuantity: "1" },
      { selectedProductId: "official:wh-b", unitQuantity: "1" },
    ],
  };
  const response = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify(requestBody),
    },
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(validationInputs.length, 2);
  assert.deepEqual(validationInputs.map((input) => input.selectedProductIds), [
    { veu_water_heater: "official:wh-a" },
    { veu_water_heater: "official:wh-b" },
  ]);
  assert.ok(validationInputs.every(
    (input) => input.installationDate === "2026-08-08",
  ));
  assert.equal(body.estimate.output.unitQuantity, "2");
  assert.equal(body.estimate.propertyItems.length, 2);
  assert.equal(body.estimate.propertyItems[0].unitQuantity, "1");
  assert.equal(body.estimate.propertyItems[0].approvedProducts[0].attributes.veuProductId, "VEU-WH-A");
  assert.equal(body.estimate.propertyItems[1].approvedProducts[0].attributes.veuProductId, "VEU-WH-B");
  assert.equal(body.estimate.propertyItems[0].registryReceipt.installationDate, "2026-08-08");
  assert.equal(body.estimate.registryReceipt.items.length, 2);
  assert.equal(body.estimate.approvedProducts.length, 2);
  assert.equal(body.estimate.certificateActionEnabled, false);
  assert.equal(body.estimate.eligibilityConfirmed, false);
  assert.notEqual(body.estimate.receiptHash, body.estimate.arithmeticReceiptHash);

  const strictResponse = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, estimatePurpose: "compliance" }),
    },
  ));
  const strictBody = await strictResponse.json();
  assert.equal(strictResponse.status, 400);
  assert.equal(strictBody.code, "VEU_REQUEST_INVALID");
  assert.match(strictBody.error, /Strict compliance requires every installed unit/);
});

test("VEU mixed water-heater route rejects a property total above five before product lookup", async () => {
  let validationCalls = 0;
  const route = loadRoute(async () => {
    validationCalls += 1;
    return validationResult(waterHeaterSelection("VEU-WH-A"));
  });
  const response = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        estimatePurpose: "quote",
        programCode: "VEU",
        activityCode: "1D",
        effectiveDate: "2026-08-08",
        postcode: "3000",
        inputs: waterHeaterQuoteInputs(),
        waterHeaterItems: [
          { selectedProductId: "official:wh-a", unitQuantity: "6" },
          { selectedProductId: "official:wh-b", unitQuantity: "5" },
        ],
      }),
    },
  ));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "VEU_INPUT_INVALID");
  assert.equal(validationCalls, 0);
});

test("VEU mixed water-heater route enforces the residential Schedule 4 property allowance", async () => {
  const selections = {
    "official:wh-a": waterHeaterSelection("VEU-WH-A", 1),
    "official:wh-b": waterHeaterSelection("VEU-WH-B", 2),
  };
  let validationCalls = 0;
  const route = loadRoute(async (_database, input) => {
    validationCalls += 1;
    return validationResult(
      selections[input.selectedProductIds.veu_water_heater],
    );
  });
  const response = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify({
        estimatePurpose: "quote",
        programCode: "VEU",
        activityCode: "1D",
        effectiveDate: "2026-08-08",
        postcode: "3000",
        inputs: waterHeaterQuoteInputs(),
        waterHeaterItems: [
          { selectedProductId: "official:wh-a", unitQuantity: "2" },
          { selectedProductId: "official:wh-b", unitQuantity: "1" },
        ],
      }),
    },
  ));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "VEU_SYSTEM_INELIGIBLE");
  assert.match(body.error, /no more than 2 Part 1 or Part 3/);
  assert.equal(validationCalls, 2);
});

test("VEU route produces a future-dated scenario vii multi and VRF quote from official outdoor metrics and operator indoor sums", async () => {
  const selection = airConditionerSelection("multi");
  const route = loadRoute(async () => validationResult(selection));
  const inputs = part6QuoteInputs({ configuration: "multi" });
  delete inputs.rated_heating_capacity_kw;
  delete inputs.rated_cooling_capacity_kw;
  inputs.indoor_units = [
    {
      label: "Living areas",
      model: "INDOOR-40",
      quantity: "2",
      heatingCapacityKw: "4",
      coolingCapacityKw: "3.5",
    },
    {
      label: "Bedrooms",
      model: "INDOOR-45",
      quantity: "1",
      heatingCapacityKw: "4.5",
      coolingCapacityKw: "4.25",
    },
  ];
  const response = await route.POST(request(
    "6",
    inputs,
    { veu_air_conditioner: "veu-public-product-register:VEU-000006" },
    "3000",
    "2026-10-15",
    "quote",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.estimate.scenario, "vii");
  assert.equal(body.estimate.inputSnapshot.configuration, "multi");
  assert.equal(body.estimate.inputSnapshot.ratedHeatingCapacityKw, "25/2");
  assert.equal(body.estimate.inputSnapshot.ratedCoolingCapacityKw, "45/4");
  assert.equal(body.estimate.inputSnapshot.indoorUnitQuantity, "3");
  assert.equal(body.estimate.inputSnapshot.indoorUnits.length, 2);
  assert.equal(body.estimate.inputSnapshot.outdoorHeatingCapacityKw, "19/5");
  assert.equal(body.estimate.inputSnapshot.outdoorCoolingCapacityKw, "7/2");
  assert.equal(body.estimate.inputSnapshot.governedHeatingCapacityKw, "19/5");
  assert.equal(body.estimate.inputSnapshot.governedCoolingCapacityKw, "7/2");
  assert.equal(body.estimate.inputSnapshot.hspfUpgrade, "24/5");
  assert.equal(body.estimate.inputSnapshot.tcspfUpgrade, "59/10");
  assert.equal(body.estimate.eligibilityConfirmed, false);
  assert.ok(body.estimate.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "same_oem_confirmed" && assumptionApplied,
  ));
});

test("VEU route supports an exact approved packaged Part 6 row in quote mode", async () => {
  const selection = airConditionerSelection("packaged");
  const route = loadRoute(async () => validationResult(selection));
  const response = await route.POST(request(
    "6",
    part6QuoteInputs(),
    { veu_air_conditioner: "veu-public-product-register:VEU-000006" },
    "3000",
    "2026-10-15",
    "quote",
  ));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.estimate.inputSnapshot.configuration, "packaged");
  assert.equal(body.estimate.inputSnapshot.ratedHeatingCapacityKw, "19/5");
  assert.equal(body.estimate.inputSnapshot.ratedCoolingCapacityKw, "7/2");
  assert.equal(body.estimate.inputSnapshot.outdoorHeatingCapacityKw, "");
  assert.equal(body.estimate.inputSnapshot.outdoorCoolingCapacityKw, "");
  assert.equal(body.estimate.eligibilityConfirmed, false);
});

test("VEU route keeps the same Part 6 evidence gates strict outside quote mode", async () => {
  const selection = airConditionerSelection("single");
  const accessOptions = [];
  const route = loadRoute(
    async () => validationResult(selection),
    (options) => {
      accessOptions.push(options);
    },
  );
  const response = await route.POST(request(
    "6",
    part6QuoteInputs(),
    { veu_air_conditioner: "veu-public-product-register:VEU-000006" },
    "3000",
    "2026-10-15",
  ));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(accessOptions[0], { allowPublicQuote: false });
  assert.equal(body.code, "VEU_SYSTEM_INELIGIBLE");

  const explicitComplianceResponse = await route.POST(request(
    "6",
    part6QuoteInputs(),
    { veu_air_conditioner: "veu-public-product-register:VEU-000006" },
    "3000",
    "2026-10-15",
    "compliance",
  ));
  assert.equal(explicitComplianceResponse.status, 409);
  assert.deepEqual(accessOptions[1], { allowPublicQuote: false });
});

test("NSW quote mode keeps official product and future date controls while warning on documentary gates", async () => {
  const selection = televisionSelection({
    registryCode: "gems-products",
    productKind: "pool_pump",
    registrationNumber: "GEMS-POOL-1",
    sourceRecordKey: "GEMS-POOL-1",
    eligibleFrom: "2026-07-01",
    eligibleTo: "2026-12-31",
    attributes: {
      starRating: 5,
      maximumTestedInputW: 900,
      projectedAnnualEnergyConsumptionKwh: 700,
    },
  });
  const route = loadRoute(async () => validationResult(selection));
  const requestBody = {
    programCode: "NSW-ESS-2026",
    activityCode: "D5",
    effectiveDate: "2026-10-15",
    estimatePurpose: "quote",
    inputs: {
      maximum_tested_input_w: "99999",
      paec_kwh_per_year: "99999",
      manufacturer_warranty_years: "0",
      net_payment_ex_gst_aud: "0",
      payment_exemption: "none",
      site_postcode: "2000",
      nsw_site_confirmed: "no",
      product_registry_eligibility_confirmed: "no",
      all_non_formula_requirements_confirmed: "no",
    },
    selectedProductIds: { pool_pump: "gems-products:GEMS-POOL-1" },
  };
  const quoteResponse = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify(requestBody),
    },
  ));
  const quoteBody = await quoteResponse.json();

  assert.equal(quoteResponse.status, 200);
  assert.equal(quoteBody.estimate.estimatePurpose, "quote");
  assert.equal(quoteBody.estimate.eligibilityConfirmed, false);
  assert.equal(quoteBody.estimate.effectiveDate, "2026-10-15");
  assert.ok(quoteBody.estimate.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "manufacturer_warranty_years" && assumptionApplied,
  ));
  assert.equal(quoteBody.estimate.approvedProducts[0].sourceRecordKey, "GEMS-POOL-1");

  const strictResponse = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://compare.ausenergyassessments.com",
      },
      body: JSON.stringify({
        ...requestBody,
        estimatePurpose: "compliance",
      }),
    },
  ));
  const strictBody = await strictResponse.json();
  assert.equal(strictResponse.status, 400);
  assert.equal(strictBody.code, "NSW_INPUT_INVALID");
});

test("local product-free quote mode warns instead of blocking on an explicit eligibility confirmation", async () => {
  const route = loadRoute(async () => {
    throw new Error("Product validation must not run for QLD-FIT");
  });
  const base = {
    programCode: "QLD-FIT",
    activityCode: "SBS-44C",
    effectiveDate: "2026-10-15",
    inputs: {
      eligible_export_kwh: "100",
      legacy_eligibility_confirmed: "no",
    },
  };
  const quoteResponse = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...base, estimatePurpose: "quote" }),
    },
  ));
  const quoteBody = await quoteResponse.json();
  assert.equal(quoteResponse.status, 200);
  assert.equal(quoteBody.estimate.output.quantity, "44");
  assert.equal(quoteBody.estimate.estimatePurpose, "quote");
  assert.equal(quoteBody.estimate.eligibilityConfirmed, false);
  assert.ok(quoteBody.estimate.eligibilityWarnings.some(
    ({ inputKey, assumptionApplied }) => inputKey === "legacy_eligibility_confirmed" && assumptionApplied,
  ));

  const strictResponse = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(base),
    },
  ));
  const strictBody = await strictResponse.json();
  assert.equal(strictResponse.status, 409);
  assert.equal(strictBody.code, "LOCAL_ELIGIBILITY_NOT_CONFIRMED");
});

test("local product-backed quote mode retains installation-date registry validation", async () => {
  const selection = televisionSelection({
    registryCode: "gems-products",
    productKind: "air_conditioner",
    registrationNumber: "GEMS-AC-LOCAL",
    sourceRecordKey: "GEMS-AC-LOCAL",
    eligibleFrom: "2026-01-01",
    eligibleTo: "2027-06-30",
    attributes: {},
  });
  let validationInput;
  const route = loadRoute(async (_database, input) => {
    validationInput = input;
    return validationResult(selection);
  });
  const response = await route.POST(new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        programCode: "QLD-QCHEU",
        activityCode: "HVAC",
        effectiveDate: "2026-10-15",
        estimatePurpose: "quote",
        inputs: {
          eligible_dwellings: "2",
          eligible_cost_ex_gst_aud: "10000",
        },
        selectedProductIds: {
          air_conditioner: "gems-products:GEMS-AC-LOCAL",
        },
      }),
    },
  ));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(validationInput.installationDate, "2026-10-15");
  assert.deepEqual(validationInput.requiredKinds, ["air_conditioner"]);
  assert.equal(body.estimate.estimatePurpose, "quote");
  assert.equal(body.estimate.eligibilityConfirmed, false);
  assert.equal(body.estimate.approvedProducts[0].sourceRecordKey, "GEMS-AC-LOCAL");
  assert.notEqual(body.estimate.receiptHash, body.estimate.arithmeticReceiptHash);
});
