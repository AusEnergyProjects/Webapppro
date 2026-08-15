import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT,
  CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION,
  validateCreditexNswGovernedWorkPackContent,
} from "../src/data/creditex-nsw-governed-work-pack-content.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
} from "../src/lib/creditex-nsw-program-catalogue.ts";

const manifestUrl = new URL(
  "../src/data/creditex-official-source-custody-candidates-2026-08-15.json",
  import.meta.url,
);

function byActivity(programCode, activityCode) {
  const item = CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT.find(
    (candidate) =>
      candidate.programCode === programCode &&
      candidate.activityCode === activityCode,
  );
  assert.ok(item, `missing ${programCode} ${activityCode}`);
  return item;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

test("publishes 48 source-transcribed NSW schemas without claiming trade readiness", () => {
  assert.deepEqual(CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION, {
    valid: true,
    errors: [],
    total: 48,
    sourceTranscribedReviewCandidates: 48,
    sourceBackedFormReviewCandidates: 26,
    sourceOnlyContracts: 22,
    tradeWorkflowReady: 0,
    executableEstimatorCandidates: 13,
    fieldPublished: 0,
    activationReady: 0,
  });
  assert.deepEqual(
    validateCreditexNswGovernedWorkPackContent(),
    CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION,
  );
  assert.equal(
    new Set(CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT.map((item) => item.templateId)).size,
    48,
  );
  for (const item of CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT) {
    assert.equal(item.contentState, "source_transcribed_review_pending");
    assert.equal(item.complianceReviewPublishable, true);
    assert.equal(item.tradeWorkflowReady, false);
    assert.equal(item.fieldPublished, false);
    assert.equal(item.activationReady, false);
  }
});

test("distinguishes complete retained official form sets from source-only contracts", () => {
  const sourceBacked = CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT
    .filter((item) => item.completeRetainedOfficialFieldForms)
    .map((item) => `${item.programCode}:${item.activityCode}`);
  assert.deepEqual(sourceBacked, [
    "NSW-ESS:D1",
    "NSW-ESS:D2",
    "NSW-ESS:D5",
    "NSW-ESS:D13",
    "NSW-ESS:D14",
    "NSW-ESS:D15",
    "NSW-ESS:D16",
    "NSW-ESS:D17",
    "NSW-ESS:D18",
    "NSW-ESS:D19",
    "NSW-ESS:D20",
    "NSW-ESS:E1",
    "NSW-ESS:E2",
    "NSW-ESS:E3",
    "NSW-ESS:E4",
    "NSW-ESS:E5",
    "NSW-ESS:E6",
    "NSW-ESS:E7",
    "NSW-ESS:E8",
    "NSW-ESS:E9",
    "NSW-ESS:E10",
    "NSW-ESS:E11",
    "NSW-ESS:E12",
    "NSW-ESS:E13",
    "NSW-PDRS:HVAC1",
    "NSW-PDRS:SYS2",
  ]);
  assert.ok(
    CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT
      .filter((item) => item.completeRetainedOfficialFieldForms)
      .every((item) => item.fieldWorkflowContentState === "source_backed_form_review_candidate"),
  );
  assert.ok(
    CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT
      .filter((item) => !item.completeRetainedOfficialFieldForms)
      .every((item) => item.fieldWorkflowContentState === "source_only_contract_not_publishable"),
  );
});

test("binds every retained source identity to exact tracked manifest metadata", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const manifestById = new Map(
    manifest.candidates.map((candidate) => [candidate.sourceId, candidate]),
  );
  for (const item of CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT) {
    for (const source of item.sources) {
      const tracked = manifestById.get(source.sourceId);
      assert.ok(tracked, `missing tracked source ${source.sourceId}`);
      assert.equal(source.sourceTitle, tracked.sourceTitle);
      assert.equal(source.sourceVersion, tracked.sourceVersion);
      assert.equal(source.statedEffectiveDate, tracked.statedEffectiveDate);
      assert.equal(source.officialUrl, tracked.officialUrl);
      assert.equal(source.expectedSizeBytes, tracked.expectedSizeBytes);
      assert.equal(source.expectedSha256, tracked.expectedSha256);
      assert.match(source.expectedSha256, /^[a-f0-9]{64}$/);
      assert.ok(source.citation.length > 20);
      assert.equal(source.pendingIndependentCreditexReview, true);
      assert.equal(source.operationallyApproved, false);
    }
  }
});

test("provides activity-specific guided evidence and exact declaration placements", () => {
  const d1 = byActivity("NSW-ESS", "D1");
  assert.deepEqual(
    d1.evidenceRequirements.slice(-6).map((item) => item.key),
    [
      "site-assessor-declaration",
      "pre-installation-photo",
      "manufacturer-specification",
      "wers-rating",
      "post-implementation-declaration",
      "installed-equipment-photo",
    ],
  );
  assert.deepEqual(
    d1.signatures.map((signature) => signature.placement),
    [
      "nomination-form.capacity-holder-signature",
      "site-assessor-declaration.signature",
      "post-implementation-or-installer-declaration.installer-signature",
      "post-implementation-declaration.purchaser-signature",
    ],
  );
  assert.deepEqual(
    d1.documentOutputs.map((document) => document.documentKey),
    [
      "nomination-form",
      "site-assessor-declaration",
      "post-implementation-declaration",
      "governed-evidence-and-calculation-packet",
    ],
  );

  const f11 = byActivity("NSW-ESS", "F11");
  assert.ok(f11.evidenceRequirements.some((item) => item.key === "existing-boiler-data"));
  assert.ok(f11.documentOutputs.some((item) =>
    item.documentKey === "installer-declaration" &&
    item.templateMode === "source_transcribed_governed_template"
  ));

  const bess1 = byActivity("NSW-PDRS", "BESS1");
  assert.ok(bess1.evidenceRequirements.some((item) => item.key === "as-nzs-5139"));
  assert.ok(bess1.evidenceRequirements.some((item) => item.key === "installer-accreditation"));
  assert.ok(bess1.evidenceRequirements.some((item) => item.key === "eligible-delivery-path"));

  const bess2 = byActivity("NSW-PDRS", "BESS2");
  assert.ok(!bess2.documentOutputs.some((item) => item.documentKey === "nomination-form"));
  assert.ok(bess2.blockers.some((item) =>
    item.code === "NSW_BESS2_NOMINATION_SPECIFICATION_NOT_RETAINED"
  ));
  assert.ok(bess2.signatures.some((item) =>
    item.placement === "bess2-owner-declaration.signature"
  ));
  assert.ok(bess2.signatures.some((item) =>
    item.role === "original_energy_saver_or_capacity_holder" &&
    item.placement === "bess2-nomination-specification.capacity-holder-signature" &&
    item.source.sourceKey === "pdrsMethodGuide"
  ));
});

test("uses existing typed NSW estimator, product and scenario contracts only where they exist", () => {
  const expectedWithContracts = [];
  for (const program of CREDITEX_NSW_PROGRAM_DEFINITIONS) {
    for (const activityCode of new Set(
      program.activities.map((definition) => definition.officialActivityCode),
    )) {
      if (CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT.some((item) =>
        `${item.programCode}-2026` === program.programCode &&
        item.activityCode === activityCode
      )) {
        expectedWithContracts.push(`${program.programCode}:${activityCode}`);
      }
    }
  }
  const actualWithContracts = CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT
    .filter((item) => item.calculatorContracts.length > 0)
    .map((item) => `${item.programCode}-2026:${item.activityCode}`);
  assert.deepEqual(actualWithContracts.toSorted(), expectedWithContracts.toSorted());
  assert.equal(actualWithContracts.length, 13);

  for (const item of CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT) {
    const program = CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
      (candidate) => candidate.programCode === `${item.programCode}-2026`,
    );
    const definitions = program.activities.filter(
      (definition) => definition.officialActivityCode === item.activityCode,
    );
    assert.deepEqual(
      item.calculatorContracts.map((contract) => ({
        activityCode: contract.activityCode,
        formulaKey: contract.formulaKey,
        outputUnit: contract.outputUnit,
        calculationStatus: contract.calculationStatus,
        inputKeys: contract.inputKeys,
      })),
      definitions.map((definition) => ({
        activityCode: definition.activityCode,
        formulaKey: definition.formulaKey,
        outputUnit: definition.outputUnit,
        calculationStatus: definition.calculationStatus,
        inputKeys: definition.inputDefinitions.map((input) => input.key),
      })),
    );
    assert.equal(
      item.productContract.state,
      definitions.length
        ? "existing_typed_contract_review_pending"
        : "missing_existing_typed_contract",
    );
    assert.equal(
      item.scenarioContract.state,
      definitions.length
        ? "existing_typed_contract_review_pending"
        : "missing_existing_typed_contract",
    );
  }
});

test("keeps genuine external and human gates explicit for every row", () => {
  for (const item of CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT) {
    const blockerCodes = item.blockers.map((blocker) => blocker.code);
    assert.ok(blockerCodes.includes("NSW_INDEPENDENT_REVIEW_REQUIRED"));
    assert.ok(blockerCodes.includes("NSW_PROVIDER_SUBMISSION_SCHEMA_EXTERNAL"));
    assert.equal(new Set(blockerCodes).size, blockerCodes.length);
    assert.ok(item.signatures.every((signature) => signature.visibleSignatureBox));
    assert.ok(item.evidenceRequirements.every((requirement) =>
      requirement.preserveOriginalBytes && requirement.preserveOriginalMetadata
    ));
  }
  assert.ok(byActivity("NSW-ESS", "C1").blockers.some((item) =>
    item.code === "NSW_REMOVAL_ACTIVITY_RECORD_GUIDE_NOT_RETAINED"
  ));
});

test("has deterministic governed NSW content bytes", () => {
  const canonical = JSON.stringify(canonicalValue(CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT));
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  assert.equal(sha256.length, 64);
  assert.equal(
    sha256,
    "024982545530a16ee121804682cbbae2328d1ca66da2e8b66456139dafa71afc",
  );
});
