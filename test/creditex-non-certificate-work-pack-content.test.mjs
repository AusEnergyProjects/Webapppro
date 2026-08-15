import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GOVERNMENT_PROGRAM_TEMPLATES,
  governmentActivityTemplates,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  governmentActivityCalculationMethods,
} from "../src/lib/australian-certificate-calculation-catalogue.ts";
import {
  creditexLocalActivityDefinition,
  creditexLocalProgramDefinition,
} from "../src/lib/creditex-local-program-catalogue.ts";
import {
  officialProductKindsForLocalActivity,
} from "../src/lib/creditex-official-product-registry.ts";
import {
  CREDITEX_NON_CERTIFICATE_ADMINISTRATOR_SOURCE_DEPENDENCIES,
  CREDITEX_NON_CERTIFICATE_PROGRAM_CODES,
  CREDITEX_NON_CERTIFICATE_SOURCE_CUSTODY_AUDIT,
  CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY,
  CREDITEX_NON_CERTIFICATE_UNTRACKED_GOVERNMENT_SOURCE_POINTERS,
  CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256,
  CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
  CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS,
  canonicalCreditexNonCertificateWorkPackContent,
  validateCreditexNonCertificateWorkPackContent,
} from "../src/data/creditex-non-certificate-work-pack-content.ts";

const manifestUrl = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);

function expectedPrograms() {
  return GOVERNMENT_PROGRAM_TEMPLATES.filter(
    (program) =>
      program.outcomeClass !== "tradable_certificate" &&
      governmentActivityTemplates(program.programCode).some(
        (template) =>
          template.catalogueState === "current" ||
          template.catalogueState === "limited",
      ),
  );
}

function expectedTemplates(programCode) {
  return governmentActivityTemplates(programCode).filter(
    (template) =>
      template.catalogueState === "current" ||
      template.catalogueState === "limited",
  );
}

function program(candidate) {
  return GOVERNMENT_PROGRAM_TEMPLATES.find(
    (item) => item.programCode === candidate.programCode,
  );
}

function calculationMethod(candidate) {
  return governmentActivityCalculationMethods(candidate.programCode).find(
    (method) => method.activityTemplateId === candidate.templateId,
  );
}

function localDefinition(candidate) {
  return creditexLocalActivityDefinition(
    candidate.programCode,
    candidate.registryActivityCode,
  );
}

function withoutBindingFields(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => key !== "referenceKind" && key !== "citation",
    ),
  );
}

test("publishes exactly 107 unique current or limited non-certificate candidates", () => {
  const programs = expectedPrograms();
  const expected = programs.flatMap((item) =>
    expectedTemplates(item.programCode)
  );
  const actualIds = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate) => candidate.templateId,
  );

  assert.deepEqual(
    CREDITEX_NON_CERTIFICATE_PROGRAM_CODES,
    programs.map((item) => item.programCode),
  );
  assert.equal(programs.length, 26);
  assert.equal(CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.length, 107);
  assert.equal(new Set(actualIds).size, 107);
  assert.deepEqual(actualIds, expected.map((template) => template.templateId));
  assert.ok(
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.every(
      (candidate) => program(candidate)?.outcomeClass !== "tradable_certificate",
    ),
  );
});

test("preserves the exact 50 retailer-obligation and 57 other output split", () => {
  const outcomeCounts = Object.fromEntries(
    [
      "retailer_obligation_credit",
      "rebate",
      "grant",
      "loan",
      "tariff_only",
      "procurement_only",
    ].map((outcomeClass) => [
      outcomeClass,
      CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.filter(
        (candidate) => candidate.output.outcomeClass === outcomeClass,
      ).length,
    ]),
  );
  assert.deepEqual(outcomeCounts, {
    retailer_obligation_credit: 50,
    rebate: 10,
    grant: 24,
    loan: 15,
    tariff_only: 7,
    procurement_only: 1,
  });
  assert.equal(
    outcomeCounts.rebate +
      outcomeCounts.grant +
      outcomeCounts.loan +
      outcomeCounts.tariff_only +
      outcomeCounts.procurement_only,
    57,
  );

  const expectedActions = {
    retailer_obligation_credit: "retailer_obligation_claim",
    rebate: "rebate_application_or_claim",
    grant: "grant_application_or_acquittal",
    loan: "finance_application_or_settlement",
    tariff_only: "tariff_enrolment_or_metered_credit",
    procurement_only: "procurement_delivery_or_acceptance",
  };
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const definition = program(candidate);
    assert.ok(definition);
    assert.equal(candidate.output.claimOutputCode, definition.claimOutputCode);
    assert.equal(candidate.output.claimOutputLabel, definition.claimOutputLabel);
    assert.equal(
      candidate.output.actionClass,
      expectedActions[candidate.output.outcomeClass],
    );
    assert.equal(
      candidate.output.actionState,
      "blocked_until_all_governance_gaps_resolved",
    );
    assert.equal(candidate.output.externalOutcomeReceiptRequired, true);
  }
});

test("binds all 94 relevant source identities exactly to the tracked 167-source custody manifest", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const relevantProgramCodes = new Set(CREDITEX_NON_CERTIFICATE_PROGRAM_CODES);
  const expectedSources = manifest.candidates.filter((source) =>
    source.programCodes.some((programCode) =>
      relevantProgramCodes.has(programCode)
    )
  );
  const manifestById = new Map(
    manifest.candidates.map((source) => [source.sourceId, source]),
  );

  assert.equal(manifest.candidateCount, 167);
  assert.equal(manifest.candidates.length, 167);
  assert.deepEqual(CREDITEX_NON_CERTIFICATE_SOURCE_CUSTODY_AUDIT, {
    contract: manifest.contract,
    observedOn: manifest.observedOn,
    sourceAuditManifestSha256: manifest.sourceAuditManifestSha256,
    candidateCount: manifest.candidateCount,
    authorityBoundary: manifest.authorityBoundary,
    custodyBoundary: manifest.custodyBoundary,
  });
  assert.equal(CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY.length, 94);
  assert.deepEqual(CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY, expectedSources);
  assert.equal(
    new Set(
      CREDITEX_NON_CERTIFICATE_TRACKED_SOURCE_LIBRARY.map(
        (source) => source.sourceId,
      ),
    ).size,
    94,
  );

  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const expected = expectedSources.filter((source) =>
      source.programCodes.includes(candidate.programCode)
    );
    assert.deepEqual(
      candidate.trackedSourceBindings.map(withoutBindingFields),
      expected,
    );
    for (const source of candidate.trackedSourceBindings) {
      assert.deepEqual(withoutBindingFields(source), manifestById.get(source.sourceId));
      assert.equal(source.authorityClass, "government_or_regulator");
      assert.equal(source.pendingIndependentCreditexReview, true);
      assert.equal(source.operationallyApproved, false);
      assert.match(source.expectedSha256, /^[a-f0-9]{64}$/);
      assert.match(source.officialUrl, /^https:\/\//);
      assert.match(source.citation, new RegExp(candidate.programCode));
      assert.match(source.citation, new RegExp(candidate.registryActivityCode));
    }
  }
});

test("keeps administrator-only and untracked government pointers outside governed custody", () => {
  assert.equal(CREDITEX_NON_CERTIFICATE_ADMINISTRATOR_SOURCE_DEPENDENCIES.length, 4);
  assert.equal(
    CREDITEX_NON_CERTIFICATE_UNTRACKED_GOVERNMENT_SOURCE_POINTERS.length,
    2,
  );
  for (const dependency of CREDITEX_NON_CERTIFICATE_ADMINISTRATOR_SOURCE_DEPENDENCIES) {
    assert.equal(
      dependency.authorityClass,
      "programme_administrator_not_government_or_regulator",
    );
    assert.equal(dependency.custodyIngestionCandidate, false);
    assert.equal(dependency.sourceId, null);
    assert.equal(dependency.expectedSha256, null);
  }
  for (const pointer of CREDITEX_NON_CERTIFICATE_UNTRACKED_GOVERNMENT_SOURCE_POINTERS) {
    assert.equal(
      pointer.authorityClass,
      "government_or_regulator_pointer_not_in_custody",
    );
    assert.equal(pointer.custodyIngestionCandidate, false);
    assert.equal(pointer.sourceId, null);
    assert.equal(pointer.expectedSha256, null);
  }

  const noTrackedSource = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.filter(
    (candidate) => candidate.trackedSourceBindings.length === 0,
  );
  assert.deepEqual(
    [...new Set(noTrackedSource.map((candidate) => candidate.programCode))],
    ["WA-BATTERY-REWARDS", "WA-HORIZON-BUYBACK", "TAS-NILS-ES"],
  );
  assert.ok(
    noTrackedSource.every((candidate) =>
      candidate.gaps.some(
        (gap) => gap.code === "NONCERT_NO_TRACKED_GOVERNMENT_SOURCE",
      )
    ),
  );
  assert.ok(
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.every(
      (candidate) => candidate.referenceDocuments.length > 0,
    ),
  );
});

test("provides activity-specific prompts, evidence, identities, signatures and final records", () => {
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    assert.deepEqual(candidate.identityBindings, {
      complianceController: "creditex_compliance_team_for_job",
      deliveryBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      participantOrCustomer: "job_customer_or_authorised_site_contact",
      externalCounterparty:
        "program_administrator_or_delivery_counterparty_for_job",
    });
    assert.ok(candidate.prompts.length >= 8);
    assert.equal(candidate.evidenceRequirements.length, 6);
    assert.ok(
      candidate.prompts.every(
        (prompt) =>
          prompt.programCode === candidate.programCode &&
          prompt.activityCode === candidate.registryActivityCode &&
          prompt.label.includes(candidate.programCode) &&
          prompt.label.includes(candidate.registryActivityCode) &&
          prompt.collectionState === "candidate_not_approved",
      ),
    );
    assert.ok(
      candidate.evidenceRequirements.every(
        (evidence) =>
          evidence.programCode === candidate.programCode &&
          evidence.activityCode === candidate.registryActivityCode &&
          evidence.label.includes(candidate.programCode) &&
          evidence.label.includes(candidate.registryActivityCode) &&
          evidence.captureEnabled === false &&
          evidence.preserveOriginalBytes === true &&
          evidence.preserveOriginalMetadataForMedia === true,
      ),
    );
    assert.equal(candidate.signers.length, 1);
    assert.equal(candidate.signers[0].signerRole, "activity_signer_roles_unresolved");
    assert.equal(candidate.signers[0].decisionState, "unresolved");
    assert.equal(candidate.signers[0].visibleSignatureBoxWhenPublished, true);
    assert.equal(candidate.signers[0].signingEnabled, false);
    assert.equal(candidate.finalDocumentNeeds.length, 2);
    assert.ok(
      candidate.finalDocumentNeeds.every(
        (document) => document.immutableAfterFinalisation,
      ),
    );
  }
});

test("reconciles all 30 local method signals and marks the other 77 exact gaps", () => {
  const withLocalMethod = [];
  const withoutLocalMethod = [];
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const definition = localDefinition(candidate);
    if (!definition) {
      withoutLocalMethod.push(candidate);
      assert.equal(candidate.calculator.formulaSignals.length, 0);
      assert.ok(
        candidate.gaps.some(
          (gap) => gap.code === "NONCERT_GOVERNED_METHOD_CONTRACT_MISSING",
        ),
      );
      assert.ok(
        candidate.prompts.some(
          (prompt) => prompt.key === "governed_activity_input_contract",
        ),
      );
      continue;
    }
    withLocalMethod.push(candidate);
    const localProgram = creditexLocalProgramDefinition(candidate.programCode);
    assert.ok(localProgram);
    assert.equal(candidate.calculator.formulaSignals.length, 1);
    assert.deepEqual(candidate.calculator.formulaSignals[0], {
      activityCode: definition.activityCode,
      title: definition.title,
      scenario: definition.scenario,
      formulaKey: definition.formulaKey,
      inputs: definition.inputDefinitions,
      productRegistryRequirements: definition.productRegistryRequirements,
      sourceAuthority: "local_non_authoritative_signal",
      localProgramSource: {
        officialSourceUrl: localProgram.officialSourceUrl,
        officialSourceTitle: localProgram.officialSourceTitle,
        sourceVersion: localProgram.sourceVersion,
        effectiveFrom: localProgram.effectiveFrom,
        effectiveTo: localProgram.effectiveTo,
      },
    });
    assert.ok(
      !candidate.gaps.some(
        (gap) => gap.code === "NONCERT_GOVERNED_METHOD_CONTRACT_MISSING",
      ),
    );
    assert.equal(
      candidate.prompts.filter(
        (prompt) =>
          prompt.signalOrigin ===
          "local_non_authoritative_calculation_catalogue",
      ).length,
      definition.inputDefinitions.length,
    );
  }
  assert.equal(withLocalMethod.length, 30);
  assert.equal(withoutLocalMethod.length, 77);
});

test("keeps product and scenario signals local while all official decisions remain unresolved", () => {
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    assert.equal(candidate.productKind.decisionState, "unresolved");
    assert.deepEqual(candidate.productKind.officialValues, []);
    assert.equal(candidate.productKind.signalAuthority, "local_non_authoritative_signal");
    assert.deepEqual(
      candidate.productKind.localProductKindSignals,
      [...officialProductKindsForLocalActivity(
        candidate.programCode,
        candidate.registryActivityCode,
      )].sort((left, right) => left.localeCompare(right)),
    );
    assert.equal(candidate.product.applicabilityDecision, "unresolved");
    assert.equal(candidate.product.officialRegistrySnapshotRequired, null);
    assert.equal(candidate.product.signalAuthority, "local_non_authoritative_signal");
    assert.equal(candidate.scenario.decisionState, "unresolved");
    assert.deepEqual(candidate.scenario.officialCodes, []);
    assert.equal(candidate.scenario.signalAuthority, "local_non_authoritative_signal");
  }
});

test("reconciles calculation catalogue signals without approving applicability or execution", () => {
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const method = calculationMethod(candidate);
    assert.ok(method);
    assert.equal(candidate.calculator.localCatalogueState, method.state);
    assert.equal(candidate.calculator.localCataloguePathway, method.pathway);
    assert.equal(
      candidate.calculator.localCatalogueFormulaKeySignal,
      method.formulaKey,
    );
    assert.equal(candidate.calculator.localCatalogueUnitSignal, method.unit);
    assert.deepEqual(candidate.calculator.localCatalogueSourceSignal, {
      officialSourceUrl: method.officialSourceUrl,
      officialSourceTitle: method.officialSourceTitle,
      sourceVersion: method.sourceVersion,
      sourceEffectiveFrom: method.sourceEffectiveFrom,
      sourceEffectiveTo: method.sourceEffectiveTo,
      officialReconciliationRequired: method.officialReconciliationRequired,
    });
    assert.equal(method.certificateActionEnabled, false);
    assert.equal(candidate.calculator.officialApplicabilityDecision, "unresolved");
    assert.equal(candidate.calculator.exactOfficialGoldenVectorState, "missing");
    assert.equal(candidate.calculator.officialReconciliationState, "missing");
    assert.equal(candidate.calculator.independentReviewState, "missing");
    assert.equal(candidate.calculator.executionState, "blocked");
    assert.ok(
      candidate.gaps.some(
        (gap) => gap.code === "NONCERT_CALCULATION_APPLICABILITY_NOT_APPROVED",
      ),
    );
  }
});

test("keeps every candidate explicitly incomplete and blocks external action", () => {
  for (const candidate of CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    assert.equal(candidate.candidateOnly, true);
    assert.equal(candidate.independentlyApproved, false);
    assert.equal(candidate.published, false);
    assert.equal(candidate.activationReady, false);
    assert.ok(candidate.gaps.length >= 12);
    assert.ok(candidate.gaps.every((gap) => gap.blocksActivation));
    assert.equal(
      new Set(candidate.gaps.map((gap) => gap.code)).size,
      candidate.gaps.length,
    );
    assert.ok(
      candidate.gaps.some(
        (gap) => gap.code === "NONCERT_SOURCE_ACTIVITY_INCORPORATION_REVIEW_REQUIRED",
      ),
    );
    assert.ok(
      candidate.gaps.some(
        (gap) => gap.code === "NONCERT_EXTERNAL_OUTCOME_SCHEMA_MISSING",
      ),
    );
    assert.ok(
      candidate.gaps.some(
        (gap) => gap.code === "NONCERT_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      ),
    );
  }
});

test("produces a stable canonical SHA-256 identity", () => {
  const canonical = canonicalCreditexNonCertificateWorkPackContent();
  assert.equal(canonicalCreditexNonCertificateWorkPackContent(), canonical);
  assert.equal(
    createHash("sha256").update(canonical).digest("hex"),
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256,
  );
});

test("reports exact candidate completeness and zero approved activation coverage", () => {
  const validation = validateCreditexNonCertificateWorkPackContent();
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.total, 107);
  assert.equal(validation.retailerObligationCount, 50);
  assert.equal(validation.otherOutcomeCount, 57);
  assert.equal(validation.localMethodSignalCount, 30);
  assert.equal(validation.missingLocalMethodSignalCount, 77);
  assert.equal(validation.candidateContentCompleteCount, 107);
  assert.equal(validation.activationReadyCount, 0);
  assert.deepEqual(CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS, {
    expectedCurrentOrLimitedTemplates: 107,
    expectedRetailerObligationTemplates: 50,
    expectedOtherOutcomeTemplates: 57,
    machineReadableCandidateTemplates: 107,
    localMethodSignalTemplates: 30,
    missingLocalMethodSignalTemplates: 77,
    independentlyApprovedActivationTemplates: 0,
    publicationState: "candidate_not_approved",
  });
});

test("validation fails closed for missing rows, false activation and source or method drift", () => {
  const missing = validateCreditexNonCertificateWorkPackContent(
    CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.slice(1),
  );
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes("Expected 107")));
  assert.ok(missing.errors.some((error) => error.includes("ordered")));

  const falseActivation = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate, index) => index === 0
      ? { ...candidate, activationReady: true }
      : candidate,
  );
  const falseActivationValidation = validateCreditexNonCertificateWorkPackContent(
    falseActivation,
  );
  assert.equal(falseActivationValidation.valid, false);
  assert.ok(
    falseActivationValidation.errors.some((error) =>
      error.includes("activation-blocked")
    ),
  );

  const sourcedIndex = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.findIndex(
    (candidate) => candidate.trackedSourceBindings.length > 0,
  );
  assert.ok(sourcedIndex >= 0);
  const sourceDrift = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate, index) => index === sourcedIndex
      ? {
          ...candidate,
          trackedSourceBindings: candidate.trackedSourceBindings.map(
            (source, sourceIndex) => sourceIndex === 0
              ? { ...source, expectedSha256: "0".repeat(64) }
              : source,
          ),
        }
      : candidate,
  );
  const sourceDriftValidation = validateCreditexNonCertificateWorkPackContent(
    sourceDrift,
  );
  assert.equal(sourceDriftValidation.valid, false);
  assert.ok(
    sourceDriftValidation.errors.some((error) =>
      error.includes("tracked source identities")
    ),
  );

  const methodIndex = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.findIndex(
    (candidate) => candidate.calculator.formulaSignals.length > 0,
  );
  assert.ok(methodIndex >= 0);
  const methodDrift = CREDITEX_NON_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate, index) => index === methodIndex
      ? {
          ...candidate,
          calculator: { ...candidate.calculator, formulaSignals: [] },
        }
      : candidate,
  );
  const methodDriftValidation = validateCreditexNonCertificateWorkPackContent(
    methodDrift,
  );
  assert.equal(methodDriftValidation.valid, false);
  assert.ok(
    methodDriftValidation.errors.some((error) =>
      error.includes("local method-signal contract")
    ),
  );
});

test("contains no activity-45 special branch or false publication path", async () => {
  const source = await readFile(
    new URL(
      "../src/data/creditex-non-certificate-work-pack-content.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /registryActivityCode\s*===\s*["']45["']/);
  assert.doesNotMatch(source, /case\s+["']45["']/);
  assert.doesNotMatch(source, /activationReady:\s*true/);
  assert.doesNotMatch(source, /published:\s*true/);
  assert.doesNotMatch(source, /independentlyApproved:\s*true/);
});
