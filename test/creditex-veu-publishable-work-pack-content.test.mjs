import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_CURRENT_ACTIVITY_CODES,
} from "../src/data/creditex-veu-work-pack-content.ts";
import {
  CREDITEX_VEU_CAPTURED_ACTIVITY_GUIDES,
  CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT,
  CREDITEX_VEU_PUBLISHABLE_WORK_PACK_VALIDATION,
  validateCreditexVeuPublishableWorkPackContent,
} from "../src/data/creditex-veu-publishable-work-pack-content.ts";
import {
  CREDITEX_VEU_PART_6_CATEGORIES,
  CREDITEX_VEU_PART_6_SCENARIOS,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";
import {
  calculateCreditexVeuPart47,
  CreditexVeuPart47CalculationError,
} from "../src/lib/creditex-veu-part-47-calculator.ts";

test("publishes governed field workflow content for all 31 current VEU activities", () => {
  assert.deepEqual(
    CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.map((row) => row.activityCode),
    [...CREDITEX_CURRENT_ACTIVITY_CODES],
  );
  assert.equal(CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.length, 31);
  assert.equal(new Set(CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.map((row) => row.activityCode)).size, 31);
  assert.ok(!CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.some((row) => row.activityCode === "45"));
  assert.deepEqual(CREDITEX_VEU_PUBLISHABLE_WORK_PACK_VALIDATION, {
    valid: true,
    errors: [],
    total: 31,
    guidedCapturePublishableCount: 31,
    statutoryAssignmentDocumentReadyCount: 0,
    governancePublishableCount: 31,
  });

  for (const row of CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT) {
    assert.equal(row.guidedCaptureContentState, "publishable");
    assert.equal(
      row.statutoryAssignmentDocumentState,
      "blocked_exact_provider_template_required",
    );
    assert.equal(
      row.certificateCreationSchemaState,
      "blocked_exact_provider_schema_required",
    );
    assert.equal(row.governancePublicationState, "publishable");
    assert.equal(row.operationalApprovalState, "pending_independent_creditex_review");
    assert.ok(row.prompts.length >= 8, `VEU ${row.activityCode} prompts`);
    assert.ok(row.evidenceRequirements.length >= 1, `VEU ${row.activityCode} evidence`);
    assert.equal(row.productRequirements.scenarioResolution.length, row.scenarios.codes.length);
    assert.ok(row.calculator.formulas.length >= 1, `VEU ${row.activityCode} formulas`);
    assert.ok(row.signatures.length >= 3, `VEU ${row.activityCode} signatures`);
    assert.ok(row.signatures.every((signature) => signature.visibleSignatureBox));
    assert.deepEqual(row.tlinkDocumentContract, {
      governedEvidencePack: "renderable_from_published_obligations",
      statutoryAssignmentForm: "blocked_exact_provider_template_required",
      statutorySignatureCollection: "blocked_until_exact_declarations_are_imported",
      certificateCreationRecord: "blocked_exact_provider_schema_required",
      visibleSignatureBoxesAfterTemplateImport: true,
      signerRoles: [...new Set(row.signatures.map((signature) => signature.signerRole))],
    });
    assert.ok(!/\b(candidate|placeholder|guess)\b/i.test(JSON.stringify(row)));
    assert.deepEqual(
      row.publicationRequirements.map((requirement) => requirement.requirementCode),
      [
        "INDEPENDENT_CREDITEX_REVIEW",
        "EXACT_PROVIDER_PORTAL_ASSIGNMENT_TEMPLATE",
        "EXACT_PROVIDER_PORTAL_CREATION_SCHEMA",
      ],
    );
  }
});

test("binds nine exact-byte current ESC activity guides to the applicable activity families", () => {
  assert.equal(Object.keys(CREDITEX_VEU_CAPTURED_ACTIVITY_GUIDES).length, 9);
  for (const guide of Object.values(CREDITEX_VEU_CAPTURED_ACTIVITY_GUIDES)) {
    assert.match(guide.sourceId, /^source-[a-f0-9]{20}$/);
    assert.match(guide.expectedSha256, /^[a-f0-9]{64}$/);
    assert.ok(guide.expectedSizeBytes > 100000);
    assert.match(guide.officialUrl, /^https:\/\/www\.esc\.vic\.gov\.au\//);
    assert.match(guide.publicationDate, /^20\d{2}-\d{2}-\d{2}$/);
    assert.ok(guide.citation.includes("pp."));
  }

  const guideBoundCodes = CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT
    .filter((row) => row.activityGuide !== null)
    .map((row) => row.activityCode);
  assert.deepEqual(guideBoundCodes, [
    "13", "14", "15", "17", "22", "24", "25", "26", "27", "30",
    "31", "32", "33", "34", "35", "36", "37", "38", "39", "40",
    "41", "42", "43", "44", "46", "47",
  ]);
});

test("Activity 6 has a publishable governed capture pack with the live VEU product resolver", () => {
  const part6 = CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT.find(
    (row) => row.activityCode === "6",
  );
  assert.ok(part6);
  assert.deepEqual(part6.scenarios.codes, [...CREDITEX_VEU_PART_6_SCENARIOS]);
  assert.deepEqual(part6.effectivePeriods.map((period) => [
    period.effectiveFrom,
    period.effectiveTo,
  ]), [
    ["2026-07-21", "2026-09-29"],
    ["2026-09-30", null],
  ]);
  assert.equal(part6.calculator.engineId, "creditex-veu-calculator-estimator");
  assert.equal(part6.calculator.formulas[0].formulaKey, "veu-part-6-equations-6.1-to-6.5/v2");
  assert.equal(part6.productRequirements.scenarioResolution.length, 11);
  for (const resolution of part6.productRequirements.scenarioResolution) {
    assert.deepEqual(resolution.productKinds, ["veu_air_conditioner"]);
    assert.deepEqual(resolution.registryCodes, ["veu-approved-products"]);
    assert.deepEqual(
      resolution.veuProductCategoryNumbers,
      [...CREDITEX_VEU_PART_6_CATEGORIES],
    );
    assert.equal(resolution.resolutionDateField, "installation_date");
  }
  for (const input of [
    "scenario",
    "category",
    "location_class",
    "configuration",
    "rated_heating_capacity_kw",
    "rated_cooling_capacity_kw",
    "hspf_upgrade",
    "tcspf_upgrade",
    "refrigerant_gwp",
    "co_payment_per_installed_product_aud",
  ]) {
    assert.ok(part6.calculator.formulas[0].inputKeys.includes(input), input);
  }
});

test("publishable validator rejects incomplete Activity 6 scenario coverage", () => {
  const rows = structuredClone(CREDITEX_VEU_PUBLISHABLE_WORK_PACK_CONTENT);
  const part6 = rows.find((row) => row.activityCode === "6");
  assert.ok(part6);
  part6.scenarios.codes = part6.scenarios.codes.slice(0, -1);
  const result = validateCreditexVeuPublishableWorkPackContent(rows);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("all eleven scenarios")));
});

const validPart47 = {
  scenario: "47A",
  systemSizeKw: "100",
  region: "metropolitan",
  totalConnectedInverterCapacityKva: "100",
  cecModulesCurrentAtInstallation: true,
  cecInvertersCurrentAtInstallation: true,
  solarPanelValidationParticipatingBrands: true,
  monitoringPortalConfirmed: true,
  saaSizingConfirmed: true,
  dnspNegotiatedConnectionContractConfirmed: true,
  moduleWarrantyYears: "10",
  inverterWarrantyYears: "5",
};

test("executes exact Part 47 Equation 47.1 and section 18 half-up certificate rounding", () => {
  assert.deepEqual(calculateCreditexVeuPart47(validPart47), {
    schema: "creditex-veu-part-47-calculator/v1",
    scenario: "47A",
    systemSizeKw: "100",
    inputFactor: "0.133",
    lifetimeYears: "10",
    regionalFactor: "0.98",
    ghgEquivalentReductionTonnesCo2e: "130.34",
    wholeCertificates: "130",
    outputUnit: "VEEC",
    formulaKey: "veu-part-47-equation-47.1/v1",
    sourceCitation: "Victorian Energy Upgrades Specifications 2018 Version 25.0, Part 47, pp. 136-138, Equation 47.1 and Tables 47.1-47.3",
  });

  const regional47B = calculateCreditexVeuPart47({
    ...validPart47,
    scenario: "47B",
    systemSizeKw: "150",
    region: "regional",
    solarPanelValidationParticipatingBrands: false,
  });
  assert.equal(regional47B.ghgEquivalentReductionTonnesCo2e, "390");
  assert.equal(regional47B.wholeCertificates, "390");
});

test("Part 47 calculator fails closed on scenario range and source-dependent eligibility", () => {
  assert.throws(
    () => calculateCreditexVeuPart47({ ...validPart47, systemSizeKw: "100.01" }),
    (error) => error instanceof CreditexVeuPart47CalculationError
      && error.code === "VEU_PART_47_SYSTEM_INELIGIBLE",
  );
  assert.throws(
    () => calculateCreditexVeuPart47({
      ...validPart47,
      cecModulesCurrentAtInstallation: false,
    }),
    (error) => error instanceof CreditexVeuPart47CalculationError
      && error.message.includes("approved modules list"),
  );
});
