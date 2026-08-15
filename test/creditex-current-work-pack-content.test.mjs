import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";
import {
  validateCreditexActivityWorkPack,
} from "../src/lib/creditex-activity-work-pack.ts";
import {
  createCreditexSourcedWorkPackDraft,
  creditexSourcedWorkPackSourceBindings,
} from "../src/lib/creditex-work-pack-content-draft.ts";
import {
  CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID,
  CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES,
  CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION,
  validateCreditexCurrentWorkPackContent,
} from "../src/data/creditex-current-work-pack-content.ts";
import {
  CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY,
} from "../src/data/creditex-sres-work-pack-content.ts";

const expected = GOVERNMENT_ACTIVITY_TEMPLATES.filter(
  (template) =>
    template.catalogueState === "current" || template.catalogueState === "limited",
);

test("aggregates the exact 192 current or limited activities once", () => {
  assert.equal(CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.length, 192);
  assert.equal(CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID.size, 192);
  assert.deepEqual(
    CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((item) => item.templateId),
    expected.map((template) => template.templateId),
  );
  assert.equal(
    new Set(CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((item) => item.templateId)).size,
    192,
  );
  assert.deepEqual(CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION.sourceCatalogueCounts, {
    VEU: 31,
    NSW_CERTIFICATE: 48,
    SRES: 6,
    NON_CERTIFICATE: 107,
  });
  assert.deepEqual(CREDITEX_CURRENT_WORK_PACK_CONTENT_VALIDATION.contentStateCounts, {
    guidedCapturePublishable: 31,
    sourceBackedReviewCandidate: 26,
    sourceOnlyNotPublishable: 22,
    candidateOnly: 113,
    activationReady: 0,
  });
});

test("exposes all 31 VEU guided capture definitions without inflating statutory or activation readiness", () => {
  const veu = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(
    (item) => item.sourceCatalogue === "VEU",
  );
  assert.equal(veu.length, 31);
  for (const item of veu) {
    assert.equal(item.guidedCaptureState, "publishable_source_bound");
    assert.equal(item.statutoryDocumentState, "blocked_exact_provider_template_required");
    assert.equal(item.providerSchemaState, "blocked_exact_provider_schema_required");
    assert.equal(item.draftCreationState, "source_bound_guided_capture");
    assert.equal(item.candidateOnly, false);
    assert.equal(item.independentlyApproved, false);
    assert.equal(item.published, false);
    assert.equal(item.activationReady, false);
    assert.ok(item.prompts.every((prompt) =>
      prompt.approvalState === "guided_capture_publishable"
    ));
    assert.ok(item.evidenceRequirements.every((evidence) =>
      evidence.captureState === "guided_capture_publishable"
    ));
    assert.ok(item.productNeeds.every((product) =>
      product.decisionState === "executable_source_bound"
      || product.decisionState === "not_applicable_by_source"
    ));
    assert.equal(item.scenarioNeed.decisionState, "executable_source_bound");
    assert.ok(item.calculatorNeeds.every((calculator) =>
      calculator.decisionState === "executable_source_bound"
      && calculator.executableCalculatorKey !== "not_applicable"
    ));
    assert.ok(item.signatureNeeds.every((signature) =>
      !signature.requiredCandidate
      && signature.decisionState === "blocked_exact_provider_declaration_required"
    ));
    assert.ok(item.finalDocumentNeeds.every((document) =>
      !document.requiredCandidate
      && document.decisionState === "blocked_exact_provider_template_required"
    ));
    assert.deepEqual(
      item.blockers.map((blocker) => blocker.code),
      [
        "INDEPENDENT_CREDITEX_REVIEW",
        "EXACT_PROVIDER_PORTAL_ASSIGNMENT_TEMPLATE",
        "EXACT_PROVIDER_PORTAL_CREATION_SCHEMA",
      ],
    );
  }
});

test("surfaces the 26 NSW source-backed form review candidates separately from 22 source-only contracts", () => {
  const nsw = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(
    (item) => item.sourceCatalogue === "NSW_CERTIFICATE",
  );
  assert.equal(nsw.length, 48);
  assert.equal(
    nsw.filter((item) =>
      item.guidedCaptureState === "source_backed_review_candidate"
    ).length,
    26,
  );
  assert.equal(
    nsw.filter((item) => item.guidedCaptureState === "source_only_not_publishable").length,
    22,
  );
  for (const item of nsw) {
    assert.equal(item.providerSchemaState, "external_provider_schema_not_retained");
    assert.equal(
      item.draftCreationState,
      item.guidedCaptureState === "source_backed_review_candidate"
        ? "source_backed_review_draft"
        : "not_available",
    );
    assert.equal(item.candidateOnly, true);
    assert.equal(item.activationReady, false);
    assert.ok(item.productNeeds.every((product) =>
      product.executableRegistryCode === "not_applicable"
      && product.executableProductKind === "not_applicable"
    ));
    assert.ok(item.calculatorNeeds.every((calculator) =>
      calculator.executableCalculatorKey === "not_applicable"
    ));
  }
});

test("creates locked source-backed review drafts for all 26 exact-form NSW activities", () => {
  const nsw = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(
    (item) => item.draftCreationState === "source_backed_review_draft",
  );
  assert.equal(nsw.length, 26);
  for (const item of nsw) {
    const draft = createCreditexSourcedWorkPackDraft({
      candidate: item,
      version: 1,
      effectiveFrom: "2026-07-01",
      effectiveTo: "",
      catalogueReviewedOn: "2026-08-15",
    });
    const validated = validateCreditexActivityWorkPack(draft);
    const bindings = creditexSourcedWorkPackSourceBindings(item, validated);
    const prompts = validated.sections.flatMap((section) => section.prompts);
    assert.equal(validated.activityTemplateId, item.templateId);
    assert.ok(item.prompts.every((prompt) =>
      prompts.some((mapped) =>
        mapped.requirementKeys.includes(prompt.key)
          && mapped.required === prompt.requiredCandidate
      )
    ));
    assert.ok(item.evidenceRequirements.every((evidence) =>
      prompts.some((mapped) =>
        mapped.requirementKeys.includes(evidence.requirementId)
          && mapped.required === evidence.requiredCandidate
      )
    ));
    assert.ok(bindings.length >= item.sources.length);
    assert.ok(bindings.every((binding) =>
      /^source-[0-9a-f]{20}$/.test(binding.sourceId)
        && /^[0-9a-f]{64}$/.test(binding.expectedSha256)
    ));
    assert.ok(validated.dependencies
      .filter((dependency) => dependency.kind !== "product")
      .every((dependency) => !dependency.required));
    assert.equal(validated.signerRoles.length, 0);
    assert.equal(
      prompts.filter((prompt) => prompt.type === "signature").length,
      0,
    );
  }
});

test("creates an editable source-bound guided draft for every VEU activity without inventing declarations", () => {
  const veu = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(
    (item) => item.draftCreationState === "source_bound_guided_capture",
  );
  assert.equal(veu.length, 31);
  for (const item of veu) {
    const draft = createCreditexSourcedWorkPackDraft({
      candidate: item,
      version: 1,
      effectiveFrom: "2026-08-15",
      effectiveTo: "",
      catalogueReviewedOn: "2026-08-15",
    });
    const validated = validateCreditexActivityWorkPack(draft);
    assert.equal(validated.activityTemplateId, item.templateId);
    assert.equal(validated.documentOutputs.filter((output) => output.required).length, 1);
    assert.equal(validated.documentOutputs[0].sourceBindingTargetKey, "provider_assignment_pdf_required");
    assert.equal(validated.signerRoles.length, 0);
    assert.equal(
      validated.sections.flatMap((section) => section.prompts)
        .filter((prompt) => prompt.type === "signature").length,
      0,
    );
    assert.doesNotMatch(JSON.stringify(validated), /\b(candidate|placeholder)\b/i);

    const products = validated.dependencies.filter((dependency) =>
      dependency.kind === "product"
    );
    assert.equal(products.length, item.productNeeds.length);
    assert.ok(products.every((dependency, index) =>
      dependency.required
        ? item.productNeeds[index].decisionState === "executable_source_bound"
          && dependency.productKind !== "not_applicable"
          && dependency.registryCode !== "not_applicable"
        : item.productNeeds[index].decisionState === "not_applicable_by_source"
          && dependency.productKind === "not_applicable"
          && dependency.registryCode === "not_applicable"
    ));
    const scenario = validated.dependencies.find((dependency) =>
      dependency.kind === "scenario"
    );
    assert.ok(scenario?.required);
    assert.deepEqual(scenario.scenarioCodes, item.scenarioNeed.codesOrSignals);
    const calculators = validated.dependencies.filter((dependency) =>
      dependency.kind === "calculator"
    );
    assert.deepEqual(
      calculators.map((dependency) => ({
        formula: dependency.catalogueFormulaKey,
        engine: dependency.calculatorKey,
        version: dependency.calculatorVersion,
      })),
      item.calculatorNeeds.map((calculator) => ({
        formula: calculator.key,
        engine: calculator.executableCalculatorKey,
        version: calculator.executableCalculatorVersion,
      })),
    );
    assert.ok(calculators.every((dependency) => dependency.required));
  }
});

test("rejects source-bound draft creation only where no exact governed-draft contract exists", () => {
  for (const item of CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.filter(
    (candidate) => candidate.draftCreationState === "not_available",
  )) {
    assert.throws(() => createCreditexSourcedWorkPackDraft({
      candidate: item,
      version: 1,
      effectiveFrom: "2026-08-15",
      effectiveTo: "",
      catalogueReviewedOn: "2026-08-15",
    }), /no source-backed governed draft definition/);
  }
});

test("keeps SRES solar PV exact-form content review-only until its PDF placement contract exists", () => {
  const pv = CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID.get("sres-pv");
  assert.ok(pv);
  assert.equal(pv.sourceCatalogue, "SRES");
  assert.equal(pv.guidedCaptureState, "candidate_only");
  assert.equal(pv.statutoryDocumentState, "candidate_only");
  assert.equal(pv.draftCreationState, "not_available");
  assert.equal(pv.activationReady, false);
  assert.equal(
    CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY.pvAssignmentExample.expectedContentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.ok(pv.sources.some((source) =>
    source.sourceId === "source-50b61a941eebdd6fd80f"
    && source.expectedSha256
      === "3610a4f12bd154d4920fc7580541bdd94caf2830bcea70d7524b711866669c53"
    && source.title === "CER sample STC assignment form and compulsory written statements"
  ));
  assert.deepEqual(
    pv.blockers.map((blocker) => blocker.code),
    [
      "SRES_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      "SRES_REC_REGISTRY_CURRENT_SUBMISSION_SCHEMA_MISSING",
      "SRES_CURRENT_DECLARATION_SNAPSHOT_CONNECTOR_MISSING",
      "SRES_CURRENT_PRODUCT_RECALL_CONNECTOR_MISSING",
      "SRES_OFFICIAL_CALCULATOR_GOLDEN_VECTORS_MISSING",
      "SRES_REGISTERED_AGENT_ACCOUNT_AND_ASSIGNMENT_NOT_VERIFIED",
      "SRES_APPROVED_COMPONENT_SNAPSHOT_CONNECTOR_MISSING",
      "SRES_ACCREDITATION_SNAPSHOT_CONNECTOR_MISSING",
    ],
  );
  assert.ok(pv.productNeeds.every((product) =>
    product.executableRegistryCode === "not_applicable"
    && product.executableProductKind === "not_applicable"
  ));
  assert.ok(pv.calculatorNeeds.every((calculator) =>
    calculator.executableCalculatorKey === "not_applicable"
  ));
  assert.throws(() => createCreditexSourcedWorkPackDraft({
    candidate: pv,
    version: 1,
    effectiveFrom: "2026-08-15",
    effectiveTo: "",
    catalogueReviewedOn: "2026-08-15",
  }), /no source-backed governed draft definition/);
});

test("fails aggregate validation closed for missing rows, false activation and removed blockers", () => {
  const missing = validateCreditexCurrentWorkPackContent(
    CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.slice(1),
  );
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes("Expected 192")));

  const activated = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((item, index) =>
    index === 0 ? { ...item, activationReady: true } : item
  );
  assert.equal(validateCreditexCurrentWorkPackContent(activated).valid, false);

  const withoutBlocker = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map(
    (item, index) => index === 0 ? { ...item, blockers: [] } : item,
  );
  assert.equal(validateCreditexCurrentWorkPackContent(withoutBlocker).valid, false);
});

test("Forms labels each content boundary and persists guided drafts through the governed API", async () => {
  const source = await readFile(
    new URL("../src/components/CreditexActivityWorkPackGovernance.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Guided capture publishable/);
  assert.match(source, /Source-backed form review candidate/);
  assert.match(source, /Source-only contract/);
  assert.match(source, /Candidate-only content/);
  assert.match(source, /Create guided draft/);
  assert.match(source, /action: "create_sourced_draft"/);
  assert.match(source, /clientRequestId/);
  assert.match(source, /Governed source-backed draft saved and opened for editing/);
  assert.match(source, /It is not reviewed, published or active for trade accounts/);
  assert.doesNotMatch(source, /Start sourced draft/);
  assert.doesNotMatch(source, /createCreditexSourcedWorkPackDraft/);
  assert.doesNotMatch(source, /Nothing has been saved yet/);
});
