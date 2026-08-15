import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { governmentActivityTemplates } from "../src/lib/australian-government-program-catalogue.ts";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  CREDITEX_VEU_PART_6_SCENARIOS,
} from "../src/lib/creditex-veu-calculator-catalogue.ts";
import {
  CREDITEX_CURRENT_ACTIVITY_CODES,
  CREDITEX_VEU_OFFICIAL_SOURCE_LIBRARY,
  CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES,
  CREDITEX_VEU_WORK_PACK_CONTENT_COMPLETENESS,
  validateCreditexVeuWorkPackContentCandidate,
} from "../src/data/creditex-veu-work-pack-content.ts";

const manifestUrl = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);

function formulasForCatalogueActivity(activityCode) {
  if (activityCode === "1") {
    return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter((definition) =>
      ["1C", "1D"].includes(definition.activityCode),
    );
  }
  if (activityCode === "3") {
    return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter((definition) =>
      ["3C", "3D"].includes(definition.activityCode),
    );
  }
  return CREDITEX_VEU_ACTIVITY_DEFINITIONS.filter(
    (definition) => definition.activityCode === activityCode,
  );
}

function allCandidateSources(candidate) {
  return [
    candidate.statusDecision.source,
    ...candidate.sourceBindings,
    ...candidate.prompts.map((prompt) => prompt.source),
    ...candidate.evidenceRequirements.map((requirement) => requirement.source),
    candidate.product.source,
    candidate.scenarios.source,
    ...candidate.calculator.formulas.map((formula) => formula.source),
    ...candidate.signatures.map((signature) => signature.source),
    ...candidate.referenceDocuments,
    ...candidate.finalDocumentNeeds.map((document) => document.source),
  ];
}

test("publishes exactly 31 unique current VEU candidate templates and excludes closed activity 45", () => {
  const currentCatalogue = governmentActivityTemplates("VEU").filter(
    (template) => template.catalogueState === "current" || template.catalogueState === "limited",
  );
  const expectedCodes = currentCatalogue.map((template) => template.registryActivityCode);
  const actualCodes = CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate) => candidate.activityCode,
  );

  assert.equal(CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.length, 31);
  assert.equal(new Set(actualCodes).size, 31);
  assert.equal(new Set(CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.map((candidate) => candidate.templateId)).size, 31);
  assert.deepEqual(actualCodes, [...CREDITEX_CURRENT_ACTIVITY_CODES]);
  assert.deepEqual([...actualCodes].sort(), [...expectedCodes].sort());
  assert.ok(!actualCodes.includes("45"));
  assert.ok(!actualCodes.some((code) => code.startsWith("PBA")));
});

test("binds every official source identity exactly to the tracked custody candidate manifest", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const manifestById = new Map(
    manifest.candidates.map((candidate) => [candidate.sourceId, candidate]),
  );

  for (const source of Object.values(CREDITEX_VEU_OFFICIAL_SOURCE_LIBRARY)) {
    const manifestSource = manifestById.get(source.sourceId);
    assert.ok(manifestSource, `missing manifest source ${source.sourceId}`);
    assert.equal(manifestSource.expectedSha256, source.expectedSha256);
    assert.equal(manifestSource.officialUrl, source.officialUrl);
    assert.equal(manifestSource.expectedContentType, source.expectedContentType);
    assert.equal(manifestSource.expectedSizeBytes, source.expectedSizeBytes);
    assert.equal(source.pendingIndependentCreditexReview, true);
    assert.equal(source.operationallyApproved, false);
  }
});

test("every candidate contains executable source, prompt, evidence, product, scenario, calculation, signature and output content", () => {
  const knownSourceIds = new Set(
    Object.values(CREDITEX_VEU_OFFICIAL_SOURCE_LIBRARY).map((source) => source.sourceId),
  );

  for (const candidate of CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES) {
    assert.ok(candidate.sourceBindings.length >= 7, `VEU ${candidate.activityCode} sources`);
    assert.ok(candidate.prompts.length >= 8, `VEU ${candidate.activityCode} prompts`);
    assert.ok(candidate.evidenceRequirements.length >= 1, `VEU ${candidate.activityCode} evidence`);
    assert.equal(candidate.product.applicability, "required");
    assert.ok(candidate.product.requiredAttributes.length >= 2, `VEU ${candidate.activityCode} product attributes`);
    assert.equal(candidate.scenarios.applicability, "required");
    assert.ok(candidate.scenarios.codes.length >= 1, `VEU ${candidate.activityCode} scenarios`);
    assert.ok(candidate.calculator.formulas.length >= 1, `VEU ${candidate.activityCode} formulas`);
    assert.ok(candidate.calculator.formulas.every((formula) => formula.inputKeys.length >= 1));
    assert.ok(candidate.signatures.length >= 3, `VEU ${candidate.activityCode} signatures`);
    assert.ok(candidate.signatures.every((signature) => signature.visibleSignatureBox));
    assert.ok(candidate.referenceDocuments.length >= 1, `VEU ${candidate.activityCode} references`);
    assert.ok(candidate.finalDocumentNeeds.length > candidate.evidenceRequirements.length);
    assert.ok(candidate.gaps.length >= 4, `VEU ${candidate.activityCode} fail-closed gaps`);
    assert.ok(candidate.gaps.every((gap) => gap.blocksActivation));
    assert.equal(candidate.candidateOnly, true);
    assert.equal(candidate.independentlyApproved, false);
    assert.equal(candidate.published, false);
    assert.equal(candidate.activationReady, false);

    for (const source of allCandidateSources(candidate)) {
      assert.ok(knownSourceIds.has(source.sourceId), `VEU ${candidate.activityCode} unknown source ${source.sourceId}`);
      assert.match(source.expectedSha256, /^[a-f0-9]{64}$/);
      assert.ok(source.citation.trim().length > 0);
      assert.equal(source.operationallyApproved, false);
    }
  }
});

test("reconciles all imported calculator definitions and supplies the exact current Part 47 formula contract", () => {
  for (const candidate of CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES) {
    if (candidate.activityCode === "47") continue;
    const definitions = formulasForCatalogueActivity(candidate.activityCode);
    assert.ok(definitions.length > 0, `VEU ${candidate.activityCode} catalogue definitions`);
    assert.deepEqual(
      candidate.calculator.formulas.map((formula) => formula.formulaKey),
      definitions.map((definition) => definition.formulaKey),
    );
    assert.deepEqual(
      candidate.calculator.formulas.map((formula) => formula.scenarioCodes),
      definitions.map((definition) => definition.scenarios),
    );
    assert.deepEqual(
      candidate.calculator.formulas.map((formula) => formula.inputKeys),
      definitions.map((definition) => definition.inputDefinitions.map((input) => input.key)),
    );
  }

  const part47 = CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.find(
    (candidate) => candidate.activityCode === "47",
  );
  assert.ok(part47);
  assert.deepEqual(part47.scenarios.codes, ["47A", "47B"]);
  assert.equal(part47.product.productKind, "clean_energy_council_approved_solar_components");
  assert.deepEqual(part47.calculator.formulas, [
    {
      formulaKey: "veu-part-47-equation-47.1/v1",
      scenarioCodes: ["47A", "47B"],
      inputKeys: ["system_size_kw", "input_factor", "lifetime_years", "regional_factor"],
      source: part47.calculator.formulas[0].source,
    },
  ]);
  for (const evidenceId of [
    "solar-stage-photos",
    "solar-monitoring-portal",
    "solar-electrical-certificate",
    "solar-lei-checklist",
    "solar-single-line-diagram",
    "solar-dnsp-approval",
  ]) {
    assert.ok(part47.evidenceRequirements.some((requirement) => requirement.requirementId === evidenceId));
  }
});

test("VEU 6 carries all 11 scenarios, current formula inputs and product dependencies", () => {
  const part6 = CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.find(
    (candidate) => candidate.activityCode === "6",
  );
  assert.ok(part6);
  assert.deepEqual(part6.scenarios.codes, [...CREDITEX_VEU_PART_6_SCENARIOS]);
  assert.deepEqual(part6.statusDecision.transitionDates, ["2026-07-21", "2026-09-30"]);
  assert.equal(part6.product.productKind, "veu_register");
  assert.equal(part6.product.registrySnapshotRequired, true);
  for (const dependency of ["rated capacities", "HSPF", "TCSPF", "GWP", "configuration"]) {
    assert.ok(part6.product.requiredAttributes.includes(dependency));
  }
  const formula = part6.calculator.formulas.find(
    (item) => item.formulaKey === "veu-part-6-equations-6.1-to-6.5/v2",
  );
  assert.ok(formula);
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
    "performance_basis",
  ]) {
    assert.ok(formula.inputKeys.includes(input), `VEU 6 missing ${input}`);
  }
  assert.ok(
    part6.gaps.some((gap) => gap.code === "VEU_PART_6_TRANSITION_CONTRACT_INCOMPLETE"),
  );
});

test("binds Creditex, trade business, technician and customer identities and emits visible signing outputs", () => {
  for (const candidate of CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES) {
    assert.deepEqual(candidate.identityBindings, {
      accreditedPerson: "creditex_provider_for_job",
      installerBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      consumer: "job_customer_or_authorised_signatory",
    });
    assert.ok(candidate.prompts.some((prompt) => prompt.key === "creditex_accredited_person"));
    assert.ok(candidate.prompts.some((prompt) => prompt.key === "installer_details_company_and_licences"));
    assert.ok(candidate.signatures.some((signature) => signature.signerRole === "consumer_or_authorised_signatory"));
    assert.ok(candidate.signatures.some((signature) => signature.signerRole === "installer"));
    assert.ok(candidate.finalDocumentNeeds.some((document) => document.documentType === "veu_assignment_form"));
    assert.ok(candidate.finalDocumentNeeds.some((document) => document.documentType === "consumer_assignment_copy"));
    assert.ok(candidate.finalDocumentNeeds.some((document) => document.documentType === "veu_registry_creation_record"));
  }
});

test("requires original metadata for photo and video evidence without mislabelling non-media evidence", () => {
  for (const candidate of CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES) {
    for (const evidence of candidate.evidenceRequirements) {
      assert.equal(
        evidence.preserveOriginalMetadata,
        evidence.kind === "geotagged_photograph" || evidence.kind === "video",
        `VEU ${candidate.activityCode} ${evidence.requirementId}`,
      );
    }
  }
});

test("runtime schema validation reports 100 percent machine-readable candidate coverage and zero activation coverage", () => {
  const validation = validateCreditexVeuWorkPackContentCandidate();
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.total, 31);
  assert.equal(validation.candidateContentCompleteCount, 31);
  assert.equal(validation.candidateContentCoveragePercent, 100);
  assert.equal(validation.activationReadyCount, 0);
  assert.equal(validation.activationCoveragePercent, 0);
  assert.deepEqual(CREDITEX_VEU_WORK_PACK_CONTENT_COMPLETENESS, {
    expectedCurrentActivityTemplates: 31,
    machineReadableCandidateTemplates: 31,
    machineReadableCandidateCoveragePercent: 100,
    independentlyApprovedActivationTemplates: 0,
    independentlyApprovedActivationCoveragePercent: 0,
    publicationState: "candidate_not_approved",
  });
});

test("runtime validation fails closed for missing activity content and incomplete VEU 6 scenario coverage", () => {
  const missingActivity = validateCreditexVeuWorkPackContentCandidate(
    CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.slice(1),
  );
  assert.equal(missingActivity.valid, false);
  assert.ok(missingActivity.errors.some((error) => error.includes("Expected 31")));
  assert.ok(missingActivity.errors.some((error) => error.includes("ordered catalogue")));

  const incompletePart6Candidates = CREDITEX_VEU_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate) => candidate.activityCode === "6"
      ? {
          ...candidate,
          scenarios: {
            ...candidate.scenarios,
            codes: CREDITEX_VEU_PART_6_SCENARIOS.slice(0, 10),
          },
        }
      : candidate,
  );
  const incompletePart6 = validateCreditexVeuWorkPackContentCandidate(
    incompletePart6Candidates,
  );
  assert.equal(incompletePart6.valid, false);
  assert.ok(
    incompletePart6.errors.some((error) => error.includes("all 11 exact scenario codes")),
  );
});

test("contains no guessed or auto-approved compliance claims", async () => {
  const source = await readFile(
    new URL("../src/data/creditex-veu-work-pack-content.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bguess(?:ed|ing)?\b/i);
  assert.doesNotMatch(source, /auto[- ]?approv(?:e|ed|al)/i);
  assert.doesNotMatch(source, /estimate[- ]only/i);
});
