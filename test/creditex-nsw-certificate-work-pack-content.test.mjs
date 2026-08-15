import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  governmentActivityTemplates,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  governmentActivityCalculationMethods,
} from "../src/lib/australian-certificate-calculation-catalogue.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
} from "../src/lib/creditex-nsw-program-catalogue.ts";
import {
  CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY,
  CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES,
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256,
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS,
  canonicalCreditexNswCertificateWorkPackContent,
  validateCreditexNswCertificateWorkPackContent,
} from "../src/data/creditex-nsw-certificate-work-pack-content.ts";

const manifestUrl = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);

function expectedTemplates(programCode) {
  return governmentActivityTemplates(programCode).filter(
    (template) =>
      template.catalogueState === "current" ||
      template.catalogueState === "limited",
  );
}

function localProgram(programCode) {
  return CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === `${programCode}-2026`,
  );
}

function localDefinitions(candidate) {
  return localProgram(candidate.programCode).activities.filter(
    (definition) =>
      definition.officialActivityCode === candidate.registryActivityCode,
  );
}

test("publishes exactly 48 unique current or limited NSW certificate candidates", () => {
  const expected = CREDITEX_NSW_CERTIFICATE_PROGRAM_CODES.flatMap(expectedTemplates);
  const actualIds = CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate) => candidate.templateId,
  );

  assert.equal(CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.length, 48);
  assert.equal(new Set(actualIds).size, 48);
  assert.deepEqual(actualIds, expected.map((template) => template.templateId));
  assert.equal(
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.filter(
      (candidate) => candidate.programCode === "NSW-ESS",
    ).length,
    42,
  );
  assert.equal(
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.filter(
      (candidate) => candidate.programCode === "NSW-PDRS",
    ).length,
    6,
  );
  assert.ok(
    !CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.some(
      (candidate) => candidate.registryActivityCode === "45",
    ),
  );
});

test("binds all 14 NSW official-source identities exactly to the tracked custody manifest", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const manifestById = new Map(
    manifest.candidates.map((candidate) => [candidate.sourceId, candidate]),
  );
  const sources = Object.values(
    CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY,
  );

  assert.equal(sources.length, 14);
  assert.equal(new Set(sources.map((source) => source.sourceId)).size, 14);
  for (const source of sources) {
    const manifestSource = manifestById.get(source.sourceId);
    assert.ok(manifestSource, `missing manifest source ${source.sourceId}`);
    assert.deepEqual(manifestSource.programCodes, [source.programCode]);
    assert.equal(manifestSource.sourceTitle, source.sourceTitle);
    assert.equal(manifestSource.sourceVersion, source.sourceVersion);
    assert.equal(manifestSource.statedEffectiveDate, source.statedEffectiveDate);
    assert.equal(manifestSource.officialUrl, source.officialUrl);
    assert.equal(manifestSource.expectedContentType, source.expectedContentType);
    assert.equal(manifestSource.expectedSizeBytes, source.expectedSizeBytes);
    assert.equal(manifestSource.expectedSha256, source.expectedSha256);
    assert.equal(manifestSource.observedOn, source.observedOn);
    assert.equal(source.pendingIndependentCreditexReview, true);
    assert.equal(source.operationallyApproved, false);
    assert.match(source.expectedSha256, /^[a-f0-9]{64}$/);
  }
});

test("provides every requested work-pack section while keeping unresolved decisions explicit", () => {
  for (const candidate of CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const sourceCount = candidate.programCode === "NSW-ESS" ? 10 : 4;
    assert.equal(candidate.sourceBindings.length, sourceCount);
    assert.ok(candidate.prompts.length >= 7);
    assert.equal(candidate.evidenceRequirements.length, 4);
    assert.ok(candidate.referenceDocuments.length > 0);
    assert.equal(candidate.signers.length, 1);
    assert.equal(candidate.signers[0].decisionState, "unresolved");
    assert.equal(candidate.signers[0].visibleSignatureBoxWhenPublished, true);
    assert.equal(candidate.signers[0].signingEnabled, false);
    assert.equal(candidate.finalDocumentNeeds.length, 2);
    assert.ok(
      candidate.finalDocumentNeeds.every(
        (document) => document.immutableAfterFinalisation,
      ),
    );
    assert.equal(candidate.productKind.decisionState, "unresolved");
    assert.deepEqual(candidate.productKind.officialValues, []);
    assert.equal(candidate.product.registryApplicabilityDecision, "unresolved");
    assert.equal(candidate.product.registrySnapshotRequired, null);
    assert.equal(candidate.scenario.decisionState, "unresolved");
    assert.deepEqual(candidate.scenario.officialCodes, []);
    assert.equal(candidate.calculator.exactOfficialGoldenVectorState, "missing");
    assert.equal(candidate.calculator.independentReviewState, "missing");
    assert.equal(candidate.calculator.executionState, "blocked");
    assert.ok(candidate.gaps.length >= 11);
    assert.ok(candidate.gaps.every((gap) => gap.blocksActivation));
    assert.equal(candidate.candidateOnly, true);
    assert.equal(candidate.independentlyApproved, false);
    assert.equal(candidate.published, false);
    assert.equal(candidate.activationReady, false);
  }
});

test("classifies all NSW rows as Creditex-owned ESC or PRC certificate actions", () => {
  for (const candidate of CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const expectedUnit = candidate.programCode === "NSW-ESS" ? "ESC" : "PRC";
    assert.deepEqual(candidate.identityBindings, {
      accreditedCertificateProvider: "creditex_provider_for_job",
      installerBusiness: "assigned_trade_business_for_job",
      assignedTechnician: "assigned_trade_technician_for_appointment",
      purchaserOrSiteContact: "job_customer_or_authorised_site_contact",
    });
    assert.equal(candidate.output.outcomeClass, "tradable_certificate");
    assert.equal(candidate.output.claimOutputCode, expectedUnit);
    assert.equal(candidate.output.outputUnit, expectedUnit);
    assert.equal(candidate.calculator.outputUnit, expectedUnit);
    assert.equal(
      candidate.output.actionOwner,
      "creditex_accredited_certificate_provider_for_job",
    );
    assert.equal(
      candidate.output.actionState,
      "blocked_until_all_governance_gaps_resolved",
    );
    assert.equal(candidate.output.providerOutcomeReceiptRequired, true);
  }
});

test("reconciles formula, prompt, product and scenario signals without elevating them to official decisions", () => {
  for (const candidate of CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    const definitions = localDefinitions(candidate);
    assert.deepEqual(
      candidate.calculator.formulaSignals.map((signal) => ({
        activityCode: signal.activityCode,
        officialActivityCode: signal.officialActivityCode,
        formulaKey: signal.formulaKey,
        supportedScenario: signal.supportedScenario,
        effectiveFrom: signal.effectiveFrom,
        effectiveTo: signal.effectiveTo,
        calculationStatus: signal.calculationStatus,
        productKinds: signal.productKinds,
        inputs: signal.inputs,
        productRegistryRequirements: signal.productRegistryRequirements,
      })),
      definitions.map((definition) => ({
        activityCode: definition.activityCode,
        officialActivityCode: definition.officialActivityCode,
        formulaKey: definition.formulaKey,
        supportedScenario: definition.supportedScenario,
        effectiveFrom: definition.effectiveFrom,
        effectiveTo: definition.effectiveTo,
        calculationStatus: definition.calculationStatus,
        productKinds: definition.productKinds,
        inputs: definition.inputDefinitions,
        productRegistryRequirements: definition.productRegistryRequirements,
      })),
    );

    const expectedProductSignals = [
      ...new Set(definitions.flatMap((definition) => definition.productKinds)),
    ].sort((left, right) => left.localeCompare(right));
    const expectedScenarioSignals = [
      ...new Set(definitions.map((definition) => definition.supportedScenario)),
    ].sort((left, right) => left.localeCompare(right));
    assert.deepEqual(
      candidate.productKind.localCalculationSignals,
      expectedProductSignals,
    );
    assert.deepEqual(
      candidate.scenario.localCalculationSignals,
      expectedScenarioSignals,
    );

    const method = governmentActivityCalculationMethods(candidate.programCode).find(
      (entry) => entry.activityTemplateId === candidate.templateId,
    );
    assert.ok(method);
    assert.equal(candidate.calculator.localCatalogueState, method.state);
    assert.equal(candidate.calculator.localCataloguePathway, method.pathway);
    assert.equal(
      candidate.calculator.localCatalogueFormulaKeySignal,
      method.formulaKey,
    );
  }
});

test("marks external product, register, climate and legislation references as non-custody signals", () => {
  for (const candidate of CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    for (const reference of candidate.externalReferenceSignals) {
      assert.equal(
        reference.custodyState,
        "local_catalogue_reference_only_not_in_tracked_nsw_manifest",
      );
      assert.match(reference.url, /^https:\/\//);
      assert.ok(reference.title.trim().length > 0);
      assert.ok(
        candidate.gaps.some(
          (gap) => gap.code === "NSW_EXTERNAL_SOURCE_NOT_IN_CUSTODY",
        ),
      );
    }
    for (const formula of candidate.calculator.formulaSignals) {
      for (const reference of formula.externalReferences) {
        assert.equal(
          reference.custodyState,
          "local_catalogue_reference_only_not_in_tracked_nsw_manifest",
        );
      }
    }
  }
});

test("requires a governed calculator contract gap for every row without a tracked formula definition", () => {
  const withoutDefinitions =
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.filter(
      (candidate) => localDefinitions(candidate).length === 0,
    );
  assert.equal(withoutDefinitions.length, 35);
  for (const candidate of withoutDefinitions) {
    assert.equal(candidate.calculator.formulaSignals.length, 0);
    assert.ok(
      candidate.gaps.some(
        (gap) => gap.code === "NSW_GOVERNED_CALCULATOR_CONTRACT_MISSING",
      ),
    );
    assert.ok(
      candidate.prompts.some(
        (prompt) => prompt.key === "governed_activity_input_contract",
      ),
    );
  }
});

test("preserves original evidence bytes and media metadata before any field capture is enabled", () => {
  for (const candidate of CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES) {
    for (const evidence of candidate.evidenceRequirements) {
      assert.equal(evidence.captureEnabled, false);
      assert.equal(evidence.preserveOriginalBytes, true);
      assert.equal(evidence.preserveOriginalMetadataForMedia, true);
      assert.equal(
        evidence.exactRequirementState,
        "unresolved_pending_transcription_and_review",
      );
    }
  }
});

test("produces a stable canonical SHA-256 identity", () => {
  const canonical = canonicalCreditexNswCertificateWorkPackContent();
  const repeated = canonicalCreditexNswCertificateWorkPackContent();
  assert.equal(repeated, canonical);
  assert.equal(
    createHash("sha256").update(canonical).digest("hex"),
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANONICAL_SHA256,
  );
});

test("reports complete candidate coverage and zero approved activation coverage", () => {
  const validation = validateCreditexNswCertificateWorkPackContent();
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.total, 48);
  assert.deepEqual(validation.programCounts, {
    "NSW-ESS": 42,
    "NSW-PDRS": 6,
  });
  assert.equal(validation.candidateContentCompleteCount, 48);
  assert.equal(validation.activationReadyCount, 0);
  assert.deepEqual(CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_COMPLETENESS, {
    expectedCurrentOrLimitedTemplates: 48,
    machineReadableCandidateTemplates: 48,
    independentlyApprovedActivationTemplates: 0,
    publicationState: "candidate_not_approved",
  });
});

test("validation fails closed for missing rows, false activation and removed formula signals", () => {
  const missing = validateCreditexNswCertificateWorkPackContent(
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.slice(1),
  );
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes("Expected 48")));
  assert.ok(missing.errors.some((error) => error.includes("ordered")));

  const falseActivation = CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate, index) => index === 0
      ? { ...candidate, activationReady: true }
      : candidate,
  );
  const falseActivationValidation = validateCreditexNswCertificateWorkPackContent(
    falseActivation,
  );
  assert.equal(falseActivationValidation.valid, false);
  assert.ok(
    falseActivationValidation.errors.some((error) => error.includes("activation-blocked")),
  );

  const formulaCandidateIndex =
    CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.findIndex(
      (candidate) => candidate.calculator.formulaSignals.length > 0,
    );
  assert.ok(formulaCandidateIndex >= 0);
  const missingFormula = CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    (candidate, index) => index === formulaCandidateIndex
      ? {
          ...candidate,
          calculator: {
            ...candidate.calculator,
            formulaSignals: candidate.calculator.formulaSignals.slice(1),
          },
        }
      : candidate,
  );
  const missingFormulaValidation = validateCreditexNswCertificateWorkPackContent(
    missingFormula,
  );
  assert.equal(missingFormulaValidation.valid, false);
  assert.ok(
    missingFormulaValidation.errors.some(
      (error) => error.includes("formula-signal count"),
    ),
  );
});

test("contains no activity-45 branch, fabricated-source label or automatic approval path", async () => {
  const source = await readFile(
    new URL(
      "../src/data/creditex-nsw-certificate-work-pack-content.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /registryActivityCode\s*===\s*["']45["']/);
  assert.doesNotMatch(source, /case\s+["']45["']/);
  assert.doesNotMatch(source, /fabricated[_ -]source/i);
  assert.doesNotMatch(source, /auto(?:matic(?:ally)?|)[_ -]?approv/i);
});
