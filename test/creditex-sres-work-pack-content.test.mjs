import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { governmentActivityCalculationMethods } from "../src/lib/australian-certificate-calculation-catalogue.ts";
import { governmentActivityTemplates } from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_CURRENT_SRES_ACTIVITY_CODES,
  CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY,
  CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES,
  CREDITEX_SRES_WORK_PACK_CONTENT_COMPLETENESS,
  CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA,
  validateCreditexSresWorkPackContentCandidate,
} from "../src/data/creditex-sres-work-pack-content.ts";

const manifestUrl = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);

function allCandidateSources(candidate) {
  return [
    candidate.statusDecision.source,
    ...candidate.sourceBindings,
    ...candidate.prompts.map((prompt) => prompt.source),
    ...candidate.evidenceRequirements.map((requirement) => requirement.source),
    ...candidate.productDependencies.map((dependency) => dependency.source),
    candidate.postcodeZoneRule.source,
    candidate.deemingRule.source,
    candidate.scenarioRules.source,
    candidate.calculator.source,
    ...candidate.signatures.map((signature) => signature.source),
    ...candidate.referenceDocuments,
    ...candidate.finalDocumentNeeds.map((document) => document.source),
    candidate.certificateOutput.source,
  ];
}

function candidate(activityCode) {
  const result = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.find(
    (item) => item.activityCode === activityCode,
  );
  assert.ok(result, `missing SRES ${activityCode}`);
  return result;
}

test("publishes exactly six unique current or limited SRES work-pack candidates", () => {
  const staticCatalogue = governmentActivityTemplates("SRES").filter(
    (template) => template.catalogueState === "current" || template.catalogueState === "limited",
  );
  const expectedCodes = staticCatalogue.map((template) => template.registryActivityCode);
  const actualCodes = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.map(
    (item) => item.activityCode,
  );

  assert.equal(CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.length, 6);
  assert.equal(new Set(actualCodes).size, 6);
  assert.equal(
    new Set(CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.map((item) => item.templateId)).size,
    6,
  );
  assert.deepEqual(actualCodes, [...CREDITEX_CURRENT_SRES_ACTIVITY_CODES]);
  assert.deepEqual([...actualCodes].sort(), [...expectedCodes].sort());
  assert.ok(
    CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.every(
      (item) => item.catalogueState === "current" || item.catalogueState === "limited",
    ),
  );
});

test("binds every official source identity exactly to the tracked custody candidate manifest", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const manifestById = new Map(
    manifest.candidates.map((item) => [item.sourceId, item]),
  );

  for (const source of Object.values(CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY)) {
    const manifestSource = manifestById.get(source.sourceId);
    assert.ok(manifestSource, `missing manifest source ${source.sourceId}`);
    assert.equal(manifestSource.expectedSha256, source.expectedSha256);
    assert.equal(manifestSource.officialUrl, source.officialUrl);
    assert.equal(manifestSource.expectedContentType, source.expectedContentType);
    assert.equal(manifestSource.expectedSizeBytes, source.expectedSizeBytes);
    assert.equal(source.pendingIndependentCreditexReview, true);
    assert.equal(source.operationallyApproved, false);
  }

  const sourceIdsUsed = new Set(
    CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.flatMap(allCandidateSources)
      .map((source) => source.sourceId),
  );
  assert.deepEqual(
    [...sourceIdsUsed].sort(),
    Object.values(CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY)
      .map((source) => source.sourceId)
      .sort(),
  );
});

test("encodes complete source-backed form, evidence, identity, signing and output content", () => {
  const knownSourceIds = new Set(
    Object.values(CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY).map((source) => source.sourceId),
  );
  for (const item of CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES) {
    assert.equal(item.schema, CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA);
    assert.equal(item.programCode, "SRES");
    assert.ok(item.sourceBindings.length >= 7, `SRES ${item.activityCode} source bindings`);
    assert.ok(item.prompts.length >= 6, `SRES ${item.activityCode} prompts`);
    assert.ok(item.evidenceRequirements.length >= 3, `SRES ${item.activityCode} evidence`);
    assert.ok(item.productDependencies.length >= 1, `SRES ${item.activityCode} products`);
    assert.ok(item.productDependencies.every((dependency) => dependency.requiredSnapshotFields.length > 0));
    assert.equal(item.postcodeZoneRule.postcodeRequired, true);
    assert.ok(item.deemingRule.installationYears.length > 0);
    assert.ok(item.deemingRule.sourceOptions.length > 0);
    assert.equal(item.scenarioRules.officialScenarioCode, null);
    assert.equal(item.scenarioRules.classification, "no_separate_scenario_code_use_source_options");
    assert.ok(item.scenarioRules.sourceOptions.length > 0);
    assert.ok(item.signatures.length >= 2, `SRES ${item.activityCode} signatures`);
    assert.ok(item.signatures.every((signature) => signature.visibleSignatureBox));
    assert.ok(item.signatures.every((signature) => signature.autofillIntoFinalPdf));
    assert.ok(item.referenceDocuments.length > 0);
    assert.ok(item.finalDocumentNeeds.some((document) => document.documentType.endsWith("_stc_assignment_pdf")));
    assert.ok(item.finalDocumentNeeds.some((document) => document.documentType.endsWith("_compliance_work_pack_pdf")));
    assert.ok(item.finalDocumentNeeds.some((document) => document.documentType.endsWith("_calculation_receipt_pdf")));
    assert.ok(item.finalDocumentNeeds.some((document) => document.documentType.endsWith("_original_evidence_bundle")));
    assert.ok(item.finalDocumentNeeds.some((document) => document.documentType.endsWith("_rec_registry_creation_record")));
    assert.ok(item.finalDocumentNeeds.every((document) => document.immutableAfterFinalisation));
    assert.ok(item.gaps.length >= 7, `SRES ${item.activityCode} fail-closed gaps`);
    assert.ok(item.gaps.every((gap) => gap.blocksActivation));
    assert.equal(item.candidateOnly, true);
    assert.equal(item.independentlyApproved, false);
    assert.equal(item.published, false);
    assert.equal(item.activationReady, false);

    assert.deepEqual(item.identityBindings, {
      registeredAgent: "creditex_provider_for_job",
      systemOwner: "job_system_owner_or_authorised_signatory",
      installerBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      installerIndividual: "captured_individual_installer_for_system",
      designerIndividual: ["PV", "BESS", "WIND", "HYDRO"].includes(item.activityCode)
        ? "captured_individual_designer_for_system"
        : "not_required_by_activity_source",
      electricianIndividual: ["PV", "BESS", "WIND", "HYDRO"].includes(item.activityCode)
        ? "captured_individual_electrician_for_system"
        : "not_required_by_activity_source",
      retailerLegalEntity: ["PV", "BESS"].includes(item.activityCode)
        ? "captured_selling_legal_entity_for_system"
        : "not_required_by_activity_source",
    });

    for (const source of allCandidateSources(item)) {
      assert.ok(knownSourceIds.has(source.sourceId));
      assert.match(source.expectedSha256, /^[a-f0-9]{64}$/);
      assert.ok(source.citation.trim().length > 0);
      assert.equal(source.operationallyApproved, false);
    }
  }
});

test("pins exact PV and battery component, postcode, factor and scenario dependencies", () => {
  const pv = candidate("PV");
  assert.deepEqual(
    pv.productDependencies.map((dependency) => dependency.productKind),
    ["cec_approved_pv_module_csv", "cec_approved_inverter_csv"],
  );
  assert.ok(pv.productDependencies.every((dependency) => dependency.registrySnapshotRequired));
  assert.equal(pv.postcodeZoneRule.zoneApplicability, "solar_pv_zone_rating_required");
  assert.equal(pv.postcodeZoneRule.zoneCount, 4);
  assert.deepEqual(pv.postcodeZoneRule.ratingValues, ["1.622", "1.536", "1.382", "1.185"]);
  assert.equal(pv.deemingRule.applicability, "one_five_or_maximum_period");
  assert.deepEqual(pv.deemingRule.sourceOptions, ["one_year", "five_years", "maximum_deeming_period"]);
  assert.ok(pv.scenarioRules.sourceOptions.includes("rated_capacity_at_most_100_kw"));

  const battery = candidate("BESS");
  assert.deepEqual(
    battery.productDependencies.map((dependency) => dependency.productKind),
    ["cec_approved_solar_battery_csv", "cec_approved_inverter_csv"],
  );
  assert.equal(battery.statusDecision.activityEffectiveFrom, "2025-07-01");
  assert.equal(battery.postcodeZoneRule.zoneApplicability, "not_used_in_certificate_arithmetic");
  assert.equal(battery.postcodeZoneRule.zoneCount, 0);
  assert.equal(battery.deemingRule.applicability, "not_applicable_battery_date_factor");
  assert.equal(battery.deemingRule.sourceOptions.length, 10);
  assert.ok(battery.scenarioRules.sourceOptions.includes("one_stc_claim_per_address"));
  assert.ok(
    battery.scenarioRules.sourceOptions.includes(
      "replacement_or_expansion_only_where_pre_2025-07-01_battery_was_installed",
    ),
  );
  for (const gapCode of [
    "SRES_BATTERY_BULK_UPLOAD_WORKBOOK_MISSING",
    "SRES_BATTERY_ONE_CLAIM_PER_ADDRESS_CHECK_MISSING",
    "SRES_BATTERY_PRE_2025_REPLACEMENT_EXPANSION_CONTRACT_MISSING",
    "SRES_BATTERY_INSTALLER_DAILY_LIMIT_CONNECTOR_MISSING",
  ]) {
    assert.ok(battery.gaps.some((gap) => gap.code === gapCode));
  }
});

test("pins exact wind and hydro equipment, resource, deeming and missing-form contracts", () => {
  for (const code of ["WIND", "HYDRO"]) {
    const item = candidate(code);
    assert.deepEqual(
      item.productDependencies.map((dependency) => dependency.productKind),
      ["wind_or_hydro_equipment_identity", "cec_approved_inverter_csv"],
    );
    assert.equal(item.productDependencies[0].registrySnapshotRequired, false);
    assert.equal(item.productDependencies[1].applicability, "required_if_inverter_used");
    assert.equal(item.postcodeZoneRule.zoneApplicability, "not_used_in_certificate_arithmetic");
    assert.equal(item.postcodeZoneRule.zoneCount, 0);
    assert.equal(item.deemingRule.applicability, "one_or_current_maximum_period");
    assert.deepEqual(item.deemingRule.sourceOptions, ["one_year", "maximum_deeming_period"]);
    assert.ok(item.prompts.some((prompt) => prompt.key.endsWith("_resource_availability")));
    assert.ok(item.evidenceRequirements.some((evidence) => evidence.requirementId.endsWith("_site_audit_report")));
    assert.ok(item.gaps.some((gap) => gap.code === "SRES_WIND_HYDRO_ASSIGNMENT_FORM_TEMPLATE_MISSING"));
    assert.ok(item.gaps.some((gap) => gap.code === "SRES_WIND_HYDRO_SITE_AUDIT_TEMPLATE_MISSING"));
  }
});

test("pins the Version 58 water-heater registers, zones, deeming and conditional statutory documents", () => {
  const swh = candidate("SWH");
  assert.deepEqual(
    swh.productDependencies.map((dependency) => dependency.productKind),
    ["cer_swh_under_700l_register_csv", "cer_swh_over_700l_register_csv"],
  );
  assert.ok(swh.productDependencies.every((dependency) => dependency.applicability === "conditional_by_capacity"));
  assert.equal(swh.postcodeZoneRule.zoneCount, 4);
  assert.equal(swh.deemingRule.applicability, "registered_ten_year_entitlement_multiplier");
  assert.deepEqual(swh.deemingRule.sourceOptions, [
    "2026:0.5",
    "2027:0.4",
    "2028:0.3",
    "2029:0.2",
    "2030:0.1",
  ]);
  assert.ok(swh.scenarioRules.sourceOptions.includes("capacity_at_least_700_litres_with_additional_documents"));
  assert.ok(swh.evidenceRequirements.some((evidence) => evidence.requirementId === "swh_over_700l_owner_declaration"));
  assert.ok(swh.evidenceRequirements.some((evidence) => evidence.requirementId === "swh_over_700l_size_declaration"));
  assert.equal(
    swh.evidenceRequirements.filter(
      (evidence) => evidence.alternativeGroup?.groupId === "swh_invoice_or_dated_unit_photo",
    ).length,
    2,
  );
  assert.equal(swh.signatures.filter((signature) => signature.signerRole === "statutory_declarant").length, 2);
  assert.equal(swh.signatures.filter((signature) => signature.signerRole === "authorised_statutory_witness").length, 2);

  const ashp = candidate("ASHP");
  assert.deepEqual(
    ashp.productDependencies.map((dependency) => dependency.productKind),
    ["cer_ashp_register_csv"],
  );
  assert.equal(ashp.postcodeZoneRule.zoneCount, 5);
  assert.equal(ashp.deemingRule.applicability, "registered_ten_year_entitlement_multiplier");
  assert.ok(ashp.scenarioRules.sourceOptions.includes("capacity_at_most_425_litres"));
  assert.equal(
    ashp.evidenceRequirements.filter(
      (evidence) => evidence.alternativeGroup?.groupId === "ashp_invoice_or_dated_unit_photo",
    ).length,
    2,
  );
  assert.ok(ashp.gaps.some((gap) => gap.code === "SRES_WATER_HEATER_ASSIGNMENT_FORM_TEMPLATE_MISSING"));
});

test("reconciles every formula key and state with the existing SRES calculation catalogue without a stored quantity", () => {
  const methods = new Map(
    governmentActivityCalculationMethods("SRES").map((method) => [
      method.registryActivityCode,
      method,
    ]),
  );
  const expectedInputs = {
    PV: ["installationDate", "ratedCapacityKw", "zoneRating"],
    BESS: ["certificationDate", "claimScope", "nominalCapacityKwh", "usableCapacityKwh"],
    WIND: ["installationDate", "ratedCapacityKw", "resourceAvailability", "resourceHoursPerYear", "deemingYears"],
    HYDRO: ["installationDate", "ratedCapacityKw", "resourceAvailability", "resourceHoursPerYear", "deemingYears"],
    SWH: ["installationDate", "registeredTenYearStcs"],
    ASHP: ["installationDate", "registeredTenYearStcs"],
  };

  for (const item of CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES) {
    const method = methods.get(item.activityCode);
    assert.ok(method);
    assert.equal(item.calculator.formulaKey, method.formulaKey);
    assert.equal(item.calculator.existingCatalogueState, method.state);
    assert.equal(item.calculator.officialReconciliationRequired, true);
    assert.equal(item.calculator.certificateActionEnabled, false);
    assert.equal(item.calculator.runtimeEstimatorContract, "creditex-stc-deterministic-estimate/v1");
    assert.deepEqual(item.calculator.inputKeys, expectedInputs[item.activityCode]);
    assert.equal(item.calculator.catalogueQuantity, null);
    assert.equal(item.certificateOutput.localWorkPackMayCreateCertificate, false);
    assert.equal(item.certificateOutput.quantitySource, "runtime_validated_calculation_only");
    assert.equal(item.certificateOutput.classification, "tradable_certificate_after_regulator_registration");
  }
});

test("preserves original metadata exactly for geotagged photograph evidence", () => {
  for (const item of CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES) {
    for (const evidence of item.evidenceRequirements) {
      assert.equal(
        evidence.preserveOriginalMetadata,
        evidence.kind === "geotagged_photograph",
        `SRES ${item.activityCode} ${evidence.requirementId}`,
      );
    }
  }
});

test("reports 100 percent machine-readable candidate coverage and zero activation coverage", () => {
  const validation = validateCreditexSresWorkPackContentCandidate();
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.total, 6);
  assert.equal(validation.candidateContentCompleteCount, 6);
  assert.equal(validation.candidateContentCoveragePercent, 100);
  assert.equal(validation.activationReadyCount, 0);
  assert.equal(validation.activationCoveragePercent, 0);
  assert.deepEqual(CREDITEX_SRES_WORK_PACK_CONTENT_COMPLETENESS, {
    expectedCurrentActivityTemplates: 6,
    machineReadableCandidateTemplates: 6,
    machineReadableCandidateCoveragePercent: 100,
    independentlyApprovedActivationTemplates: 0,
    independentlyApprovedActivationCoveragePercent: 0,
    publicationState: "candidate_not_approved",
  });
});

test("runtime validation fails closed for missing activities, changed source bytes and a false quantity", () => {
  const missing = validateCreditexSresWorkPackContentCandidate(
    CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.slice(1),
  );
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes("Expected 6")));
  assert.ok(missing.errors.some((error) => error.includes("ordered catalogue")));

  const changedSource = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.map((item) =>
    item.activityCode === "PV"
      ? {
          ...item,
          postcodeZoneRule: {
            ...item.postcodeZoneRule,
            source: {
              ...item.postcodeZoneRule.source,
              expectedSha256: "0".repeat(64),
            },
          },
        }
      : item,
  );
  const changedSourceValidation = validateCreditexSresWorkPackContentCandidate(changedSource);
  assert.equal(changedSourceValidation.valid, false);
  assert.ok(changedSourceValidation.errors.some((error) => error.includes("custody source identity")));

  const falseQuantity = CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES.map((item) =>
    item.activityCode === "BESS"
      ? { ...item, calculator: { ...item.calculator, catalogueQuantity: 42 } }
      : item,
  );
  const falseQuantityValidation = validateCreditexSresWorkPackContentCandidate(falseQuantity);
  assert.equal(falseQuantityValidation.valid, false);
  assert.ok(falseQuantityValidation.errors.some((error) => error.includes("unauthorised certificate quantity")));
});

test("contains no unreviewed operational approval claim", async () => {
  const source = await readFile(
    new URL("../src/data/creditex-sres-work-pack-content.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /auto[- ]?approv(?:e|ed|al)/i);
  assert.doesNotMatch(source, /certificateActionEnabled:\s*true/);
  const quantityDeclarations = [...source.matchAll(
    /catalogueQuantity:\s*([^,;\r\n}]+)/g,
  )];
  assert.ok(quantityDeclarations.length >= 2);
  assert.ok(quantityDeclarations.every((match) => match[1].trim() === "null"));
});
