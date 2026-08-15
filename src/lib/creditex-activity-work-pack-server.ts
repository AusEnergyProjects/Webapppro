import {
  CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_FINAL_RECORD_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_MANIFEST_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
  type CreditexActivityWorkPack,
  type CreditexActivityWorkPackCompletion,
  type CreditexActivityWorkPackCustomerContext,
  type CreditexActivityWorkPackDeviceAttestation,
  type CreditexActivityWorkPackResponse,
  type CreditexActivityWorkPackReferenceDocumentAcknowledgement,
  type CreditexActivityWorkPackSignatureAttestation,
  type CreditexActivityWorkPackSignatureManifest,
  type CreditexActivityWorkPackSignaturePayload,
  type CreditexActivityWorkPackSignerIdentity,
  type CreditexWorkPackDependency,
  type CreditexWorkPackDocumentOutput,
  type CreditexWorkPackPrompt,
  type CreditexWorkPackSignerRole,
  type CreditexWorkPackSignerIdentitySource,
  creditexActivityWorkPackCompletion,
  creditexActivityWorkPackVisibilityMatches,
  creditexActivityWorkPackSha256,
  emptyCreditexActivityWorkPackResponse,
  validateCreditexActivityWorkPack,
} from "./creditex-activity-work-pack.ts";
import {
  creditexCanonicalSha256,
} from "./creditex-interchange-preflight.ts";
import {
  CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
  buildManualEvidenceFormV2CompositionPreview,
  canonicalManualPolicyJson,
  manualPolicySha256,
  validateManualPolicyBindingSnapshot,
  type ApprovedManualPolicyBinding,
  type ManualPolicyBindingSnapshot,
  type ManualPolicyGovernmentRequirement,
  type ManualPolicyJson,
} from "./creditex-manual-policy-merge.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type ComplianceClaimOutputCode,
  type ComplianceOutcomeClass,
} from "./australian-government-program-catalogue.ts";
import {
  CREDITEX_WORK_PACK_COVERAGE,
  type CreditexWorkPackGovernanceCoverageRow,
} from "./creditex-work-pack-coverage.ts";
import {
  CREDITEX_CALCULATION_COVERAGE,
} from "./creditex-calculation-coverage.ts";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
} from "./creditex-veu-calculator-catalogue.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
} from "./creditex-nsw-program-catalogue.ts";
import {
  CREDITEX_PRODUCT_KIND_REGISTRY,
  officialProductKindsForLocalActivity,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
} from "./creditex-official-product-registry.ts";
import {
  CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
  CREDITEX_CALCULATOR_ENGINE_VERSION,
  CREDITEX_CALCULATOR_RECEIPT_SCHEMA,
  CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
  creditexCalculatorEngineContractHash,
  evaluateCreditexCalculator,
  runCreditexCalculatorTestSuite,
  validateCreditexCalculatorSpecification,
  type CreditexCalculatorInputs,
  type CreditexCalculatorSpecification,
} from "./creditex-calculator-engine.ts";
import {
  CreditexSourceLookupReviewError,
  requireCurrentApprovedOfficialSourceBinding,
} from "./creditex-source-lookup-review-server.ts";
import { getCreditexCustodyBucket } from "./creditex-custody-bucket.ts";
import { verifyJpegExif } from "./jpeg-exif-verifier.ts";
import {
  renderCreditexActivityWorkPackPdf,
  type CreditexWorkPackPdfSignature,
} from "./creditex-activity-work-pack-pdf-renderer.ts";
import {
  loadCreditexSresActivationState,
} from "./creditex-sres-certificate-activation-server.ts";
import {
  CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID,
  CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
  type CreditexCurrentWorkPackContentCandidate,
} from "../data/creditex-current-work-pack-content.ts";
import {
  createCreditexSourcedWorkPackDraft as buildCreditexSourcedWorkPackDraft,
  creditexSourcedWorkPackSourceBindings,
} from "./creditex-work-pack-content-draft.ts";
import {
  ensureCreditexWorkPackSchemaGuards,
} from "./creditex-work-pack-schema-guards.ts";

export const CREDITEX_ACTIVITY_WORK_PACK_INSTANCE_CONTRACT =
  "creditex-activity-work-pack-instance/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_PREFILL_CONTRACT =
  "creditex-activity-work-pack-prefill/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_ATTESTATION_CONTRACT =
  "creditex-activity-work-pack-attestation/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_FINALISATION_CONTRACT =
  "creditex-activity-work-pack-finalisation/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_ARTIFACT_HOOK_CONTRACT =
  "creditex-activity-work-pack-artifact-hook/v1";
export const CREDITEX_SOURCED_WORK_PACK_DRAFT_BINDING_MAP_CONTRACT =
  "creditex-sourced-work-pack-draft-binding-map/v1";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_JSON_BYTES = 256 * 1024;

// Field signatures may wait in the encrypted offline queue during a remote
// site outage, but must never become an unbounded backdating mechanism. Seven
// days covers a full field-work week while the exact prepared revision, actor,
// device session and retained bytes remain independently bound. Device clocks
// may differ from the server by at most five minutes in either direction.
export const CREDITEX_WORK_PACK_SIGNATURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const CREDITEX_WORK_PACK_SIGNATURE_OFFLINE_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;

export class CreditexActivityWorkPackServerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexActivityWorkPackServerError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexActivityWorkPackServerError(code, status, message);
}

function text(value: unknown, maximum: number, code: string, label: string) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum) {
    return fail(code, 400, `${label} is required.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value || "").trim();
  if (result.length > maximum) {
    return fail("WORK_PACK_INPUT_TOO_LONG", 400, "A work-pack value is too long.");
  }
  return result;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function date(value: unknown, code: string, label: string) {
  const result = text(value, 10, code, label);
  if (!ISO_DATE_PATTERN.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    return fail(code, 400, `${label} must be an ISO date.`);
  }
  return result;
}

function instant(value: unknown, code: string, label: string) {
  const result = text(value, 40, code, label);
  if (!ISO_INSTANT_PATTERN.test(result) || Number.isNaN(Date.parse(result))) {
    return fail(code, 400, `${label} must be an ISO UTC instant.`);
  }
  return result;
}

function boundedSignatureDisplayTime(input: Readonly<{
  signedAt: unknown;
  preparedAt: string;
  capturedAt: string;
}>) {
  const signedAt = instant(
    input.signedAt,
    "WORK_PACK_SIGNATURE_TIME_INVALID",
    "Signature time",
  );
  const signedAtMs = Date.parse(signedAt);
  const preparedAtMs = Date.parse(input.preparedAt);
  const capturedAtMs = Date.parse(input.capturedAt);
  if (
    !Number.isFinite(preparedAtMs)
    || !Number.isFinite(capturedAtMs)
    || signedAtMs < preparedAtMs - CREDITEX_WORK_PACK_SIGNATURE_CLOCK_SKEW_MS
    || signedAtMs < capturedAtMs - CREDITEX_WORK_PACK_SIGNATURE_OFFLINE_MAX_AGE_MS
    || signedAtMs > capturedAtMs + CREDITEX_WORK_PACK_SIGNATURE_CLOCK_SKEW_MS
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_TIME_OUT_OF_BOUNDS",
      409,
      "Signature time must match this prepared revision and the bounded field capture window.",
    );
  }
  return signedAt;
}

function object(value: unknown, code: string, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(code, 400, message);
  }
  return value as Record<string, unknown>;
}

function parseObject(value: unknown, code: string, message: string) {
  try {
    return object(JSON.parse(String(value || "")), code, message);
  } catch (error) {
    if (error instanceof CreditexActivityWorkPackServerError) throw error;
    return fail(code, 500, message);
  }
}

function parseArray(value: unknown, code: string, message: string) {
  try {
    const parsed = JSON.parse(String(value || "")) as unknown;
    if (!Array.isArray(parsed)) return fail(code, 500, message);
    return parsed;
  } catch (error) {
    if (error instanceof CreditexActivityWorkPackServerError) throw error;
    return fail(code, 500, message);
  }
}

function checkedJson(value: unknown, maximumBytes = MAX_JSON_BYTES) {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maximumBytes) {
    return fail(
      "WORK_PACK_RESPONSE_TOO_LARGE",
      413,
      "The work-pack response is too large.",
    );
  }
  return encoded;
}

function normaliseSha256(value: unknown, code: string, label: string) {
  const result = String(value || "").trim().toLowerCase();
  const prefixed = result.startsWith("sha256:") ? result : `sha256:${result}`;
  if (!SHA256_PATTERN.test(prefixed)) {
    return fail(code, 400, `${label} must be an exact SHA-256 digest.`);
  }
  return prefixed;
}

function bareSha256(value: string) {
  return normaliseSha256(value, "WORK_PACK_SHA256_INVALID", "SHA-256").slice(7);
}

async function sha256Bytes(value: Uint8Array) {
  const exact = new Uint8Array(value.byteLength);
  exact.set(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    exact.buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function exactCustodyBytes(input: Readonly<{
  objectKey: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  expectedContentType: string;
}>) {
  const object = await getCreditexCustodyBucket().get(input.objectKey);
  if (!object) {
    return fail(
      "WORK_PACK_CUSTODY_OBJECT_UNAVAILABLE",
      409,
      "The exact retained work-pack document is unavailable.",
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const actualSha256 = await sha256Bytes(bytes);
  if (
    bytes.byteLength !== input.expectedSizeBytes
    || actualSha256 !== bareSha256(input.expectedSha256)
    || (
      object.httpMetadata?.contentType
      && object.httpMetadata.contentType.toLowerCase()
        !== input.expectedContentType.toLowerCase()
    )
  ) {
    return fail(
      "WORK_PACK_CUSTODY_OBJECT_INTEGRITY_MISMATCH",
      409,
      "The retained work-pack document does not match its approved exact bytes.",
    );
  }
  return Object.freeze({ bytes, sha256: actualSha256 });
}

function safeInteger(value: unknown, minimum: number, code: string, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    return fail(code, 400, `${label} is invalid.`);
  }
  return result;
}

type WorkPackVersionRecord = {
  id: string;
  organisation_id: string;
  activity_version_id: string;
  activity_template_id: string;
  manual_policy_binding_id: string;
  manual_policy_binding_version: number;
  manual_policy_binding_sha256: string;
  evidence_policy_version_id: string;
  evidence_policy_version: number;
  evidence_policy_source_sha256: string;
  origin_kind: string;
  client_request_id: string;
  source_candidate_contract: string;
  source_candidate_snapshot: string;
  source_candidate_sha256: string;
  source_binding_map_snapshot: string;
  source_binding_map_sha256: string;
  candidate_blockers_snapshot: string;
  version: number;
  contract: string;
  title: string;
  schema_snapshot: string;
  schema_sha256: string;
  effective_from: string;
  effective_to: string;
  publish_state: string;
  authored_by_uid: string;
  authored_at: string;
  reviewed_by_uid: string;
  reviewed_at: string;
  review_note: string;
  manual_binding_snapshot: string;
  manual_binding_lifecycle_state: string;
  manual_binding_approved_by_uid: string;
  manual_binding_approved_at: string;
  evidence_policy_publish_state: string;
  evidence_policy_requirements_complete: number;
};

type WorkPackSourceBindingRecord = {
  id: string;
  schema_sha256: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  source_role: string;
  target_key: string;
  citation_location: string;
  binding_state: string;
  created_by_uid: string;
  created_at: string;
  reviewed_by_uid: string;
  reviewed_at: string;
  review_note: string;
  artifact_sha256: string;
  artifact_object_key: string;
  artifact_captured_by_uid: string;
  artifact_decision: string;
  artifact_reviewed_by_uid: string;
  artifact_review_sha256: string;
  artifact_review_object_key: string;
};

export type ResolvedCreditexActivityWorkPack = Readonly<{
  id: string;
  organisationId: string;
  activityVersionId: string;
  activityTemplateId: string;
  manualPolicyBindingId: string;
  manualPolicyBindingVersion: number;
  manualPolicyBindingSha256: string;
  evidencePolicyVersionId: string;
  evidencePolicyVersion: number;
  evidencePolicySourceSha256: string;
  version: number;
  title: string;
  schemaSha256: string;
  effectiveFrom: string;
  effectiveTo: string;
  reviewedByUid: string;
  reviewedAt: string;
  workPack: CreditexActivityWorkPack;
  manualPolicyBinding: ApprovedManualPolicyBinding;
  sourceBindings: readonly Readonly<{
    id: string;
    sourceArtifactId: string;
    sourceArtifactSha256: string;
    sourceRole: string;
    targetKey: string;
    citationLocation: string;
    createdByUid: string;
    reviewedByUid: string;
    reviewedAt: string;
  }>[];
}>;

function sourceTargetKeys(workPack: CreditexActivityWorkPack) {
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find((candidate) =>
    candidate.templateId === workPack.activityTemplateId
  );
  const governedOutput = activity
    ? GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
        candidate.programCode === activity.programCode
      )
    : undefined;
  return new Set([
    "work_pack",
    ...(governedOutput && governedOutput.outcomeClass !== "tradable_certificate"
      ? [`output:${governedOutput.claimOutputCode}`]
      : []),
    ...workPack.sections.map((section) => section.sectionKey),
    ...workPack.sections.flatMap((section) =>
      section.prompts.map((prompt) => prompt.promptKey)
    ),
    ...workPack.sections.flatMap((section) =>
      section.prompts.flatMap((prompt) => prompt.attestation
        ? [prompt.attestation.sourceBindingTargetKey]
        : [])
    ),
    ...workPack.sections.flatMap((section) =>
      section.prompts.flatMap((prompt) => prompt.referenceDocument
        ? [prompt.referenceDocument.sourceBindingTargetKey]
        : [])
    ),
    ...workPack.documentOutputs.map((output) =>
      output.sourceBindingTargetKey
    ),
    ...workPack.dependencies.map((dependency) => dependency.dependencyKey),
  ]);
}

async function approvedSourceBindings(
  database: D1Database,
  organisationId: string,
  workPackVersionId: string,
) {
  const rows = await database.prepare(`SELECT
      binding.id, binding.schema_sha256, binding.source_artifact_id,
      binding.source_artifact_sha256, binding.source_role,
      binding.target_key, binding.citation_location,
      binding.binding_state, binding.created_by_uid, binding.created_at,
      binding.reviewed_by_uid, binding.reviewed_at, binding.review_note,
      artifact.sha256 artifact_sha256,
      artifact.object_key artifact_object_key,
      artifact.captured_by_uid artifact_captured_by_uid,
      COALESCE((SELECT decision.decision
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1), '') artifact_decision,
      COALESCE((SELECT decision.reviewed_by_uid
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1), '') artifact_reviewed_by_uid,
      COALESCE((SELECT decision.artifact_sha256
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1), '') artifact_review_sha256,
      COALESCE((SELECT decision.artifact_object_key
        FROM compliance_official_source_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.subject_type = 'artifact'
          AND decision.subject_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1), '') artifact_review_object_key
    FROM compliance_activity_work_pack_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.source_artifact_id
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.sha256 = binding.source_artifact_sha256
    WHERE binding.organisation_id = ?
      AND binding.work_pack_version_id = ?
    ORDER BY binding.source_role, binding.target_key, binding.id`)
    .bind(organisationId, workPackVersionId)
    .all<WorkPackSourceBindingRecord>();
  return rows.results;
}

function validateSourceComposition(
  workPack: CreditexActivityWorkPack,
  rows: readonly WorkPackSourceBindingRecord[],
) {
  if (!rows.length) {
    return fail(
      "WORK_PACK_APPROVED_SOURCE_BINDING_REQUIRED",
      409,
      "The activity work pack has no independently approved exact source binding.",
    );
  }
  const targetKeys = sourceTargetKeys(workPack);
  const schemaSha256 = creditexActivityWorkPackSha256(workPack);
  const fulfilledTargets = new Set<string>();
  const bindingIdentities = new Set<string>();
  const bindingIds = new Set<string>();
  for (const row of rows) {
    const artifactSha256 = normaliseSha256(
      row.artifact_sha256,
      "WORK_PACK_SOURCE_BINDING_INVALID",
      "Source artifact SHA-256",
    );
    const bindingSha256 = normaliseSha256(
      row.source_artifact_sha256,
      "WORK_PACK_SOURCE_BINDING_INVALID",
      "Source binding SHA-256",
    );
    if (
      row.binding_state !== "approved"
      || !row.reviewed_by_uid
      || !row.reviewed_at
      || !row.review_note
      || row.reviewed_by_uid === row.created_by_uid
      || row.artifact_decision !== "approved"
      || !row.artifact_reviewed_by_uid
      || row.artifact_reviewed_by_uid === row.artifact_captured_by_uid
      || normaliseSha256(
        row.artifact_review_sha256,
        "WORK_PACK_SOURCE_BINDING_INVALID",
        "Source artifact review SHA-256",
      ) !== artifactSha256
      || row.artifact_review_object_key !== row.artifact_object_key
      || artifactSha256 !== bindingSha256
      || normaliseSha256(
        row.schema_sha256,
        "WORK_PACK_SOURCE_BINDING_INVALID",
        "Source binding schema SHA-256",
      ) !== schemaSha256
      || !row.artifact_object_key
      || !row.citation_location
      || !targetKeys.has(row.target_key)
    ) {
      return fail(
        "WORK_PACK_SOURCE_COMPOSITION_NOT_APPROVED",
        409,
        "The activity work pack source composition is not independently approved and exact.",
      );
    }
    const bindingIdentity = [
      row.source_artifact_id,
      row.source_role,
      row.target_key,
      row.citation_location,
    ].join("\u001f");
    if (bindingIds.has(row.id) || bindingIdentities.has(bindingIdentity)) {
      return fail(
        "WORK_PACK_SOURCE_COMPOSITION_DUPLICATE",
        409,
        "The activity work pack has a duplicate governed source binding.",
      );
    }
    bindingIds.add(row.id);
    bindingIdentities.add(bindingIdentity);
    fulfilledTargets.add(`${row.source_role}:${row.target_key}`);
  }
  if (!rows.some((row) => row.target_key === "work_pack")) {
    return fail(
      "WORK_PACK_COMPOSITION_IDENTITY_REQUIRED",
      409,
      "The activity work pack needs an approved top-level composition binding.",
    );
  }
  const requiredTargets = new Set([
    "requirement:work_pack",
    ...workPack.dependencies
      .map((dependency) => `${dependency.kind}:${dependency.dependencyKey}`),
    ...workPack.sections.flatMap((section) =>
      section.prompts.flatMap((prompt) => prompt.attestation
        ? [`requirement:${prompt.attestation.sourceBindingTargetKey}`]
        : [])
    ),
    ...workPack.sections.flatMap((section) =>
      section.prompts.flatMap((prompt) => prompt.referenceDocument
        ? [`requirement:${prompt.referenceDocument.sourceBindingTargetKey}`]
        : [])
    ),
    ...workPack.documentOutputs
      .filter((output) => output.required)
      .map((output) => `requirement:${output.sourceBindingTargetKey}`),
  ]);
  for (const requiredTarget of requiredTargets) {
    if (!fulfilledTargets.has(requiredTarget)) {
      return fail(
        "WORK_PACK_SOURCE_COMPOSITION_INCOMPLETE",
        409,
        "The activity work pack is missing an approved source binding required by its exact composition.",
      );
    }
  }
}

function dependencyApplicabilityForResolved(input: Readonly<{
  schemaSha256: string;
  workPack: CreditexActivityWorkPack;
  sourceBindings: ResolvedCreditexActivityWorkPack["sourceBindings"];
}>) {
  return Object.freeze(input.workPack.dependencies.map((dependency) => {
    const sourceBindings = Object.freeze(input.sourceBindings
      .filter((binding) =>
        binding.sourceRole === dependency.kind
        && binding.targetKey === dependency.dependencyKey
      )
      .map((binding) => Object.freeze({
        bindingId: binding.id,
        sourceArtifactId: binding.sourceArtifactId,
        sourceArtifactSha256: binding.sourceArtifactSha256,
        citationLocation: binding.citationLocation,
      }))
      .sort((left, right) => compareText(left.bindingId, right.bindingId)));
    if (!sourceBindings.length) {
      return fail(
        "WORK_PACK_DEPENDENCY_APPLICABILITY_SOURCE_REQUIRED",
        409,
        "Every product, scenario and calculator applicability decision needs an independently reviewed exact official source binding.",
      );
    }
    const core = Object.freeze({
      contract: "creditex-activity-work-pack-dependency-applicability/v1" as const,
      dependencyKey: dependency.dependencyKey,
      kind: dependency.kind,
      applicability: dependency.required
        ? "required" as const
        : "not_applicable" as const,
      definitionSha256: input.schemaSha256,
      sourceBindings,
    });
    return Object.freeze({
      ...core,
      decisionSha256: creditexCanonicalSha256(core),
    });
  }).sort((left, right) => compareText(left.dependencyKey, right.dependencyKey)));
}

function validateCatalogueDependencies(workPack: CreditexActivityWorkPack) {
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find((candidate) =>
    candidate.templateId === workPack.activityTemplateId
  );
  const calculation = CREDITEX_CALCULATION_COVERAGE.find((candidate) =>
    candidate.activityTemplateId === workPack.activityTemplateId
  );
  if (!activity || !calculation) {
    return fail(
      "WORK_PACK_CATALOGUE_DEPENDENCIES_INCOMPLETE",
      409,
      "The activity work pack cannot be matched to the independently governed activity and calculation catalogue.",
    );
  }
  const byKind = (kind: CreditexWorkPackDependency["kind"]) =>
    workPack.dependencies.filter((dependency) => dependency.kind === kind);
  const productDependencies = byKind("product");
  const scenarioDependencies = byKind("scenario");
  const calculatorDependencies = byKind("calculator");
  const veuDefinition = activity.programCode === "VEU"
    ? CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) =>
        candidate.activityCode === activity.registryActivityCode
          || candidate.activityCode === activity.specificationPart
      )
    : undefined;
  const nswProgramCode = activity.programCode === "NSW-ESS"
    ? "NSW-ESS-2026"
    : activity.programCode === "NSW-PDRS"
      ? "NSW-PDRS-2026"
      : "";
  const nswDefinitions = nswProgramCode
    ? CREDITEX_NSW_PROGRAM_DEFINITIONS
      .find((program) => program.programCode === nswProgramCode)
      ?.activities.filter((candidate) =>
        candidate.officialActivityCode.toUpperCase()
          === activity.registryActivityCode.toUpperCase()
          || candidate.activityCode.toUpperCase()
            === activity.registryActivityCode.toUpperCase()
      ) || []
    : [];
  const expectedScenarioCodes = Object.freeze([
    ...(veuDefinition?.scenarios || []),
    ...nswDefinitions.map((candidate) => candidate.supportedScenario),
  ].filter(Boolean));
  const expectedProductKinds = Object.freeze([
    ...(activity.programCode === "VEU"
      ? officialProductKindsForVeuActivity(
        activity.registryActivityCode || activity.specificationPart,
      )
      : []),
    ...officialProductKindsForNswProductKinds(
      nswDefinitions.flatMap((candidate) => candidate.productKinds),
    ),
    ...officialProductKindsForLocalActivity(
      activity.programCode,
      activity.registryActivityCode,
    ),
  ].filter((value, index, values) => values.indexOf(value) === index));
  const productKnownRequired = Boolean(
    expectedProductKinds.length
    || nswDefinitions.some((candidate) =>
      candidate.productKinds.length > 0
        || candidate.productRegistryRequirements.length > 0
    ),
  );
  const scenarioKnownRequired = expectedScenarioCodes.length > 0;
  const explicitlyNotApplicable = (
    dependency: CreditexWorkPackDependency,
  ) => {
    if (dependency.required) return false;
    if (dependency.kind === "product") {
      return dependency.registryCode === "not_applicable"
        && dependency.productKind === "not_applicable"
        && dependency.productCategory.trim().toLowerCase() === "not applicable";
    }
    if (dependency.kind === "scenario") {
      return dependency.scenarioCodes.length === 1
        && dependency.scenarioCodes[0] === "not_applicable";
    }
    return dependency.catalogueFormulaKey === "not_applicable"
      && dependency.calculatorKey === "not_applicable"
      && dependency.calculatorVersion === 1;
  };
  const hasCoherentDecision = (
    dependencies: readonly CreditexWorkPackDependency[],
  ) => dependencies.length > 0 && !(
    dependencies.some((dependency) => dependency.required)
    && dependencies.some((dependency) => !dependency.required)
  ) && dependencies.every((dependency) =>
    dependency.required || explicitlyNotApplicable(dependency)
  );
  const productReady = hasCoherentDecision(productDependencies)
    && productDependencies.every((dependency) =>
      dependency.kind !== "product"
      || !dependency.required
      || dependency.productKind !== "not_applicable"
        && dependency.registryCode
          === CREDITEX_PRODUCT_KIND_REGISTRY[dependency.productKind]
    )
    && (!productKnownRequired || productDependencies.some((dependency) =>
      dependency.kind === "product" && dependency.required
    ))
    && expectedProductKinds.every((expected) =>
      productDependencies.some((dependency) =>
        dependency.kind === "product"
          && dependency.required
          && dependency.productKind === expected
      )
    )
    && (productKnownRequired && activity.productCategory.trim()
      ? productDependencies.some((dependency) =>
          dependency.kind === "product"
            && dependency.required
            && dependency.productCategory === activity.productCategory
        )
      : true);
  const scenarioReady = hasCoherentDecision(scenarioDependencies)
    && (!scenarioKnownRequired || expectedScenarioCodes.every((expected) =>
      scenarioDependencies.some((dependency) =>
        dependency.kind === "scenario" && dependency.required
          && dependency.scenarioCodes.includes(expected)
      )
    ))
    && (activity.scenarioCode.trim()
      ? scenarioDependencies.some((dependency) =>
          dependency.kind === "scenario"
            && dependency.required
            && dependency.scenarioCodes.includes(activity.scenarioCode)
        )
      : true);
  const calculatorExpected = calculation.calculationState !== "not_applicable";
  const calculatorReady = hasCoherentDecision(calculatorDependencies)
    && (calculatorExpected
      ? calculatorDependencies.some((dependency) =>
          dependency.kind === "calculator"
            && dependency.required
            && dependency.catalogueFormulaKey === calculation.formulaKey
        )
      : calculatorDependencies.every(explicitlyNotApplicable));
  if (!productReady || !scenarioReady || !calculatorReady) {
    return fail(
      "WORK_PACK_CATALOGUE_DEPENDENCIES_INCOMPLETE",
      409,
      "The activity work pack omits a required product, scenario or authoritative calculator dependency from the independently governed catalogue.",
    );
  }
}

type EvidenceRequirementRecord = {
  id: string;
  requirement_code: string;
  title: string;
  description: string;
  evidence_type: string;
  capture_timing: string;
  minimum_count: number;
  maximum_count: number;
  original_required: number;
  metadata_required: number;
  gps_required: number;
  date_stamp_required: number;
  installer_signature_required: number;
  customer_signature_required: number;
  allowed_content_types: string;
  condition_snapshot: string;
  field_schema: string;
  source_citation: string;
  sort_order: number;
};

function governedJson(value: unknown, fallback: ManualPolicyJson): ManualPolicyJson {
  try {
    const parsed = JSON.parse(String(value || "")) as ManualPolicyJson;
    return parsed ?? fallback;
  } catch {
    return fail(
      "WORK_PACK_EVIDENCE_POLICY_INVALID",
      409,
      "The pinned evidence-policy requirement JSON is invalid.",
    );
  }
}

function projectedRequirement(
  row: EvidenceRequirementRecord,
): ManualPolicyGovernmentRequirement {
  return {
    id: String(row.id),
    requirementCode: String(row.requirement_code),
    title: String(row.title),
    description: String(row.description || ""),
    evidenceType: String(row.evidence_type),
    captureTiming: String(row.capture_timing),
    minimumCount: Number(row.minimum_count),
    maximumCount: Number(row.maximum_count),
    originalRequired: Number(row.original_required) === 1,
    metadataRequired: Number(row.metadata_required) === 1,
    gpsRequired: Number(row.gps_required) === 1,
    dateStampRequired: Number(row.date_stamp_required) === 1,
    installerSignatureRequired: Number(row.installer_signature_required) === 1,
    customerSignatureRequired: Number(row.customer_signature_required) === 1,
    allowedContentTypes: governedJson(row.allowed_content_types, []),
    conditionSnapshot: governedJson(row.condition_snapshot, {}),
    fieldSchema: governedJson(row.field_schema, {}),
    sourceCitation: String(row.source_citation),
    sortOrder: Number(row.sort_order),
  };
}

function signerCapacityMatches(capacity: string, expected: "customer" | "installer") {
  const normalised = capacity.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return expected === "customer"
    ? ["customer", "consumer", "owner", "tenant", "landlord"].some((item) =>
      normalised.includes(item)
    )
    : ["installer", "technician", "assessor", "fieldworker", "field_worker"]
      .some((item) => normalised.includes(item));
}

function validateRequirementPromptCompatibility(
  workPack: CreditexActivityWorkPack,
  requirement: ManualPolicyGovernmentRequirement,
  prompts: readonly CreditexActivityWorkPack["sections"][number]["prompts"][number][],
) {
  if (!prompts.length) {
    return fail(
      "WORK_PACK_REQUIREMENT_COVERAGE_INCOMPLETE",
      409,
      "The work-pack omits a governed evidence-policy requirement.",
    );
  }
  const allowedPromptTypes = requirement.evidenceType === "photo"
    ? new Set(["photo"])
    : ["document", "licence", "invoice", "payment"].includes(requirement.evidenceType)
      ? new Set(["document"])
      : requirement.evidenceType === "signature"
        ? new Set(["signature"])
        : requirement.evidenceType === "declaration"
          ? new Set(["text", "textarea", "select", "multiselect", "checkbox", "signature"])
          : new Set(["text", "textarea", "number", "date", "select", "multiselect", "checkbox", "photo", "document"]);
  if (prompts.some((prompt) => !allowedPromptTypes.has(prompt.type))) {
    return fail(
      "WORK_PACK_REQUIREMENT_MAPPING_INCOMPATIBLE",
      409,
      "A work-pack prompt type conflicts with its governed evidence-policy requirement.",
    );
  }
  const filePrompts = prompts.filter((prompt) =>
    prompt.type === "photo" || prompt.type === "document"
  );
  if (filePrompts.length) {
    const fileRequirements = filePrompts.map((prompt) => prompt.fileRequirement!);
    const minimumCount = fileRequirements.reduce(
      (total, fileRequirement) => total + fileRequirement.minimumCount,
      0,
    );
    const maximumCount = fileRequirements.reduce(
      (total, fileRequirement) => total + fileRequirement.maximumCount,
      0,
    );
    const governedTypes = Array.isArray(requirement.allowedContentTypes)
      ? new Set(requirement.allowedContentTypes.filter((item): item is string =>
        typeof item === "string"
      ))
      : new Set<string>();
    if (
      minimumCount < requirement.minimumCount
      || (requirement.maximumCount > 0 && maximumCount > requirement.maximumCount)
      || fileRequirements.some((fileRequirement) =>
        (requirement.originalRequired && !fileRequirement.originalRequired)
        || (requirement.metadataRequired && !fileRequirement.metadataRequired)
        || (requirement.gpsRequired && !fileRequirement.gpsRequired)
        || (requirement.dateStampRequired && !fileRequirement.captureTimeRequired)
        || (governedTypes.size > 0 && fileRequirement.allowedContentTypes.some(
          (contentType) => !governedTypes.has(contentType),
        ))
      )
    ) {
      return fail(
        "WORK_PACK_REQUIREMENT_MAPPING_INCOMPATIBLE",
        409,
        "A work-pack file prompt weakens the governed evidence-policy capture rules.",
      );
    }
  }
  const signaturePrompts = prompts.filter((prompt) => prompt.type === "signature");
  const roleByKey = new Map(workPack.signerRoles.map((role) => [role.roleKey, role]));
  if (
    requirement.evidenceType === "signature" && signaturePrompts.length < 1
    || requirement.customerSignatureRequired && !signaturePrompts.some((prompt) => {
      const role = roleByKey.get(prompt.signerRoleKey);
      return role ? signerCapacityMatches(role.capacity, "customer") : false;
    })
    || requirement.installerSignatureRequired && !signaturePrompts.some((prompt) => {
      const role = roleByKey.get(prompt.signerRoleKey);
      return role ? signerCapacityMatches(role.capacity, "installer") : false;
    })
  ) {
    return fail(
      "WORK_PACK_REQUIREMENT_MAPPING_INCOMPATIBLE",
      409,
      "The work-pack omits a signer capacity required by the governed evidence policy.",
    );
  }
}

async function validatePinnedPolicyComposition(
  database: D1Database,
  row: WorkPackVersionRecord,
  workPack: CreditexActivityWorkPack,
) {
  if (
    row.manual_binding_lifecycle_state !== "approved"
    || !row.manual_binding_approved_by_uid
    || !row.manual_binding_approved_at
    || row.evidence_policy_publish_state !== "published"
    || Number(row.evidence_policy_requirements_complete) !== 1
  ) {
    return fail(
      "WORK_PACK_APPROVED_POLICY_BINDING_REQUIRED",
      409,
      "The work-pack policy binding is not independently approved and current.",
    );
  }
  let bindingSnapshot: ManualPolicyBindingSnapshot;
  try {
    bindingSnapshot = validateManualPolicyBindingSnapshot(parseObject(
      row.manual_binding_snapshot,
      "WORK_PACK_MANUAL_POLICY_BINDING_INVALID",
      "The work-pack manual-policy binding snapshot is invalid.",
    ));
  } catch {
    return fail(
      "WORK_PACK_MANUAL_POLICY_BINDING_INVALID",
      409,
      "The work-pack manual-policy binding snapshot is invalid.",
    );
  }
  const bindingSha256 = await manualPolicySha256(canonicalManualPolicyJson(
    bindingSnapshot as unknown as ManualPolicyJson,
  ));
  if (
    bindingSha256 !== bareSha256(row.manual_policy_binding_sha256)
    || bindingSnapshot.organisationId !== row.organisation_id
    || bindingSnapshot.activity.id !== row.activity_version_id
    || bindingSnapshot.activityTemplate.templateId !== row.activity_template_id
    || bindingSnapshot.evidencePolicy.id !== row.evidence_policy_version_id
    || bindingSnapshot.evidencePolicy.version !== Number(row.evidence_policy_version)
    || bindingSnapshot.evidencePolicy.officialSourceSha256
      !== bareSha256(row.evidence_policy_source_sha256)
  ) {
    return fail(
      "WORK_PACK_POLICY_COMPOSITION_IDENTITY_MISMATCH",
      409,
      "The work-pack no longer matches its exact approved manual-policy and evidence-policy identity.",
    );
  }
  const rows = await database.prepare(`SELECT id, requirement_code, title,
      description, evidence_type, capture_timing, minimum_count, maximum_count,
      original_required, metadata_required, gps_required, date_stamp_required,
      installer_signature_required, customer_signature_required,
      allowed_content_types, condition_snapshot, field_schema, source_citation,
      sort_order
    FROM compliance_evidence_requirements
    WHERE organisation_id = ? AND policy_version_id = ?
    ORDER BY sort_order, requirement_code, id`)
    .bind(row.organisation_id, row.evidence_policy_version_id)
    .all<EvidenceRequirementRecord>();
  const liveRequirements = rows.results.map(projectedRequirement);
  if (
    canonicalManualPolicyJson(liveRequirements as unknown as ManualPolicyJson)
      !== canonicalManualPolicyJson(bindingSnapshot.requirements as unknown as ManualPolicyJson)
  ) {
    return fail(
      "WORK_PACK_EVIDENCE_POLICY_REQUIREMENTS_CHANGED",
      409,
      "The pinned evidence-policy requirements no longer match the approved manual-policy composition.",
    );
  }
  const promptsByRequirement = new Map<string, Array<CreditexActivityWorkPack["sections"][number]["prompts"][number]>>();
  for (const section of workPack.sections) {
    for (const prompt of section.prompts) {
      for (const requirementKey of prompt.requirementKeys) {
        const prompts = promptsByRequirement.get(requirementKey) || [];
        prompts.push(prompt);
        promptsByRequirement.set(requirementKey, prompts);
      }
    }
  }
  const requirementByCode = new Map(liveRequirements.map((requirement) => [
    requirement.requirementCode,
    requirement,
  ]));
  if ([...promptsByRequirement.keys()].some((key) => !requirementByCode.has(key))) {
    return fail(
      "WORK_PACK_REQUIREMENT_MAPPING_INVALID",
      409,
      "The work-pack maps a prompt to a requirement outside its pinned evidence policy.",
    );
  }
  for (const requirement of liveRequirements) {
    validateRequirementPromptCompatibility(
      workPack,
      requirement,
      promptsByRequirement.get(requirement.requirementCode) || [],
    );
  }
  return Object.freeze({
    id: row.manual_policy_binding_id,
    version: Number(row.manual_policy_binding_version),
    lifecycleState: "approved" as const,
    bindingSnapshot,
    bindingSnapshotSha256: bindingSha256,
    approvedByUid: row.manual_binding_approved_by_uid,
    approvedAt: row.manual_binding_approved_at,
  }) satisfies ApprovedManualPolicyBinding;
}

export async function resolvePublishedCreditexActivityWorkPack(
  database: D1Database,
  input: {
    organisationId: string;
    activityVersionId: string;
    activityDate: string;
  },
): Promise<ResolvedCreditexActivityWorkPack> {
  await ensureCreditexWorkPackSchemaGuards(database);
  const organisationId = text(
    input.organisationId,
    180,
    "WORK_PACK_ORGANISATION_REQUIRED",
    "Compliance organisation",
  );
  const activityVersionId = text(
    input.activityVersionId,
    180,
    "WORK_PACK_ACTIVITY_REQUIRED",
    "Compliance activity version",
  );
  const activityDate = date(
    input.activityDate,
    "WORK_PACK_ACTIVITY_DATE_INVALID",
    "Activity date",
  );
  const row = await database.prepare(`SELECT pack.*,
      binding.binding_snapshot manual_binding_snapshot,
      binding.lifecycle_state manual_binding_lifecycle_state,
      binding.approved_by_uid manual_binding_approved_by_uid,
      binding.approved_at manual_binding_approved_at,
      policy.publish_state evidence_policy_publish_state,
      policy.requirements_complete evidence_policy_requirements_complete
    FROM compliance_activity_work_pack_versions pack
    JOIN compliance_activity_versions activity
      ON activity.id = pack.activity_version_id
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = pack.organisation_id
    JOIN compliance_manual_policy_bindings binding
      ON binding.id = pack.manual_policy_binding_id
      AND binding.organisation_id = pack.organisation_id
      AND binding.activity_template_id = pack.activity_template_id
      AND binding.activity_version_id = pack.activity_version_id
      AND binding.version = pack.manual_policy_binding_version
      AND binding.binding_snapshot_sha256 = pack.manual_policy_binding_sha256
      AND binding.evidence_policy_version_id = pack.evidence_policy_version_id
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = pack.evidence_policy_version_id
      AND policy.organisation_id = pack.organisation_id
      AND policy.activity_version_id = pack.activity_version_id
      AND policy.version = pack.evidence_policy_version
      AND policy.official_source_sha256 = pack.evidence_policy_source_sha256
    WHERE pack.organisation_id = ?
      AND pack.activity_version_id = ?
      AND pack.publish_state = 'published'
      AND pack.effective_from <= ?
      AND (pack.effective_to = '' OR pack.effective_to >= ?)
      AND activity.publish_state = 'published'
      AND activity.effective_from <= ?
      AND (activity.effective_to = '' OR activity.effective_to >= ?)
      AND program.publish_state = 'published'
      AND binding.lifecycle_state = 'approved'
      AND policy.publish_state = 'published'
      AND policy.requirements_complete = 1
    ORDER BY pack.version DESC, pack.id DESC
    LIMIT 1`)
    .bind(
      organisationId,
      activityVersionId,
      activityDate,
      activityDate,
      activityDate,
      activityDate,
    )
    .first<WorkPackVersionRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_PUBLISHED_EFFECTIVE_VERSION_REQUIRED",
      409,
      "No independently approved activity work pack is effective for this activity date.",
    );
  }
  if (
    !row.reviewed_by_uid
    || !row.reviewed_at
    || !row.review_note
    || row.reviewed_by_uid === row.authored_by_uid
  ) {
    return fail(
      "WORK_PACK_INDEPENDENT_REVIEW_REQUIRED",
      409,
      "A different named reviewer must approve the activity work pack before use.",
    );
  }
  const workPack = validateCreditexActivityWorkPack(
    parseObject(
      row.schema_snapshot,
      "WORK_PACK_SCHEMA_INVALID",
      "The published activity work-pack schema is invalid.",
    ),
  );
  const schemaSha256 = creditexActivityWorkPackSha256(workPack);
  if (
    normaliseSha256(
      row.schema_sha256,
      "WORK_PACK_SCHEMA_SHA256_INVALID",
      "Work-pack schema SHA-256",
    ) !== schemaSha256
    || workPack.activityTemplateId !== row.activity_template_id
    || workPack.version !== Number(row.version)
    || workPack.effectiveFrom !== row.effective_from
    || workPack.effectiveTo !== row.effective_to
  ) {
    return fail(
      "WORK_PACK_COMPOSITION_IDENTITY_MISMATCH",
      409,
      "The published work-pack schema does not match its sealed version identity.",
    );
  }
  validateCatalogueDependencies(workPack);
  const sourceRows = await approvedSourceBindings(
    database,
    organisationId,
    String(row.id),
  );
  validateSourceComposition(workPack, sourceRows);
  const manualPolicyBinding = await validatePinnedPolicyComposition(
    database,
    row,
    workPack,
  );
  return Object.freeze({
    id: String(row.id),
    organisationId,
    activityVersionId,
    activityTemplateId: String(row.activity_template_id),
    manualPolicyBindingId: String(row.manual_policy_binding_id),
    manualPolicyBindingVersion: Number(row.manual_policy_binding_version),
    manualPolicyBindingSha256: bareSha256(row.manual_policy_binding_sha256),
    evidencePolicyVersionId: String(row.evidence_policy_version_id),
    evidencePolicyVersion: Number(row.evidence_policy_version),
    evidencePolicySourceSha256: bareSha256(row.evidence_policy_source_sha256),
    version: Number(row.version),
    title: String(row.title),
    schemaSha256,
    effectiveFrom: String(row.effective_from),
    effectiveTo: String(row.effective_to || ""),
    reviewedByUid: String(row.reviewed_by_uid),
    reviewedAt: String(row.reviewed_at),
    workPack,
    manualPolicyBinding,
    sourceBindings: Object.freeze(sourceRows.map((binding) => Object.freeze({
      id: binding.id,
      sourceArtifactId: binding.source_artifact_id,
      sourceArtifactSha256: normaliseSha256(
        binding.source_artifact_sha256,
        "WORK_PACK_SOURCE_BINDING_INVALID",
        "Source binding SHA-256",
      ),
      sourceRole: binding.source_role,
      targetKey: binding.target_key,
      citationLocation: binding.citation_location,
      createdByUid: binding.created_by_uid,
      reviewedByUid: binding.reviewed_by_uid,
      reviewedAt: binding.reviewed_at,
    }))),
  });
}

export type CreditexActivityWorkPackProviderContext = Readonly<{
  contract: "creditex-activity-work-pack-provider-context/v1";
  organisationId: string;
  organisationCode: string;
  legalName: string;
  tradingName: string;
  abn: string;
  revision: string;
  contextSha256: string;
}>;

export type CreditexActivityWorkPackInstallerBusinessContext = Readonly<{
  contract: "creditex-activity-work-pack-installer-business-context/v1";
  ownerUid: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  abn: string;
  verifiedAbn: string;
  participantId: string;
  participantLegalName: string;
  participantTradingName: string;
  participantAbn: string;
  accountRevision: string;
  participantRevision: string;
  contextSha256: string;
}>;

export type CreditexActivityWorkPackAssignmentContext = Readonly<{
  contract: "creditex-activity-work-pack-assignment-context/v1";
  ownerUid: string;
  memberId: string;
  memberUid: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  revision: string;
  contextSha256: string;
}>;

export type CreditexActivityWorkPackJobContext = Readonly<{
  contract: "creditex-activity-work-pack-job-context/v1";
  workOrderId: string;
  workNumber: string;
  title: string;
  serviceCategory: string;
  sourceType: string;
  sourceReference: string;
  revision: number;
  updatedAt: string;
  contextSha256: string;
}>;

export type CreditexActivityWorkPackCustomerSnapshot = Readonly<{
  contract: "creditex-activity-work-pack-customer-context-snapshot/v1";
  customerId: string;
  siteId: string;
  contactId: string;
  customerRevision: string;
  siteRevision: string;
  contactRevision: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
}>;

export type CreditexActivityWorkPackDependencyApplicability = Readonly<{
  contract: "creditex-activity-work-pack-dependency-applicability/v1";
  dependencyKey: string;
  kind: CreditexWorkPackDependency["kind"];
  applicability: "required" | "not_applicable";
  definitionSha256: string;
  sourceBindings: readonly Readonly<{
    bindingId: string;
    sourceArtifactId: string;
    sourceArtifactSha256: string;
    citationLocation: string;
  }>[];
  decisionSha256: string;
}>;

export type CreditexActivityWorkPackPrefill = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_PREFILL_CONTRACT;
  caseId: string;
  workOrderId: string;
  complianceIntentId: string;
  organisationId: string;
  activityVersionId: string;
  activityDate: string;
  customerContext: CreditexActivityWorkPackCustomerContext;
  customerSnapshot: CreditexActivityWorkPackCustomerSnapshot;
  providerContext: CreditexActivityWorkPackProviderContext;
  installerBusinessContext: CreditexActivityWorkPackInstallerBusinessContext;
  assignmentContext: CreditexActivityWorkPackAssignmentContext;
  jobContext: CreditexActivityWorkPackJobContext;
  dependencyApplicability:
    readonly CreditexActivityWorkPackDependencyApplicability[];
}>;

export type CreditexActivityWorkPackCustomerProjection = Readonly<{
  editable: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  customerRevision: string;
  siteRevision: string;
  contactRevision: string;
}>;

type CustomerContextRow = {
  source_type: string;
  customer_source: string;
  customer_id: string;
  site_id: string;
  contact_id: string;
  customer_revision: string;
  site_revision: string;
  contact_revision: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address_line_1: string;
  address_line_2: string;
  suburb: string;
  address_state: string;
  postcode: string;
};

type ServerCustomerContext = Readonly<{
  envelope: CreditexActivityWorkPackCustomerContext;
  snapshot: CreditexActivityWorkPackCustomerSnapshot;
  projection: CreditexActivityWorkPackCustomerProjection;
}>;

const EMPTY_CUSTOMER_PROJECTION = Object.freeze({
  editable: false,
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  customerRevision: "",
  siteRevision: "",
  contactRevision: "",
}) satisfies CreditexActivityWorkPackCustomerProjection;

function customerContextSnapshot(row: CustomerContextRow) {
  return Object.freeze({
    contract: "creditex-activity-work-pack-customer-context-snapshot/v1",
    customerId: row.customer_id,
    siteId: row.site_id,
    contactId: row.contact_id,
    customerRevision: row.customer_revision,
    siteRevision: row.site_revision,
    contactRevision: row.contact_revision,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    suburb: row.suburb,
    state: row.address_state,
    postcode: row.postcode,
  }) satisfies CreditexActivityWorkPackCustomerSnapshot;
}

const EMPTY_CUSTOMER_SNAPSHOT = Object.freeze({
  contract: "creditex-activity-work-pack-customer-context-snapshot/v1" as const,
  customerId: "",
  siteId: "",
  contactId: "",
  customerRevision: "",
  siteRevision: "",
  contactRevision: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
}) satisfies CreditexActivityWorkPackCustomerSnapshot;

async function loadServerCustomerContext(
  database: D1Database,
  input: { ownerUid: string; workOrderId: string },
): Promise<ServerCustomerContext> {
  const base = await database.prepare(`SELECT work_order.source_type,
      COALESCE(detail.customer_source, 'internal') customer_source
    FROM trade_work_orders work_order
    LEFT JOIN trade_crm_job_details detail
      ON detail.work_order_id = work_order.id
      AND detail.firebase_uid = work_order.firebase_uid
    WHERE work_order.id = ? AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    LIMIT 1`)
    .bind(input.workOrderId, input.ownerUid)
    .first<{ source_type: string; customer_source: string }>();
  if (!base) {
    return fail(
      "WORK_PACK_WORK_ORDER_REQUIRED",
      404,
      "The installer work order was not found.",
    );
  }
  const editable = (
    base.customer_source === "trade_owned" && base.source_type !== "opportunity"
  ) || (
    base.customer_source === "public_lead_released"
    && base.source_type === "public_lead"
  );
  if (!editable) {
    const snapshot = EMPTY_CUSTOMER_SNAPSHOT;
    const envelope = Object.freeze({
      contract: CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT,
      editable: false,
      customerId: "",
      siteId: "",
      contactId: "",
      customerRevision: "",
      siteRevision: "",
      contactRevision: "",
      contextSha256: creditexCanonicalSha256(snapshot),
    }) satisfies CreditexActivityWorkPackCustomerContext;
    return Object.freeze({
      envelope,
      snapshot,
      projection: EMPTY_CUSTOMER_PROJECTION,
    });
  }
  const row = await database.prepare(`SELECT work_order.source_type,
      detail.customer_source, customer.id customer_id, site.id site_id,
      contact.id contact_id, customer.updated_at customer_revision,
      site.updated_at site_revision, contact.updated_at contact_revision,
      contact.first_name, contact.last_name, contact.phone, contact.email,
      site.address_line_1, site.address_line_2, site.suburb,
      site.address_state, site.postcode
    FROM trade_work_orders work_order
    JOIN trade_crm_job_details detail
      ON detail.work_order_id = work_order.id
      AND detail.firebase_uid = work_order.firebase_uid
    JOIN trade_crm_customers customer
      ON customer.id = detail.crm_customer_id
      AND customer.firebase_uid = work_order.firebase_uid
      AND customer.record_status = 'active'
    JOIN trade_crm_service_sites site
      ON site.id = detail.service_site_id
      AND site.firebase_uid = work_order.firebase_uid
      AND site.customer_id = customer.id
      AND site.record_status = 'active'
    JOIN trade_crm_site_contacts site_contact
      ON site_contact.firebase_uid = work_order.firebase_uid
      AND site_contact.service_site_id = site.id
      AND site_contact.record_status = 'active'
    JOIN trade_crm_customer_contacts contact
      ON contact.id = site_contact.customer_contact_id
      AND contact.firebase_uid = work_order.firebase_uid
      AND contact.customer_id = customer.id
      AND contact.record_status = 'active'
    WHERE work_order.id = ? AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    ORDER BY site_contact.is_primary DESC, contact.is_primary DESC,
      contact.id
    LIMIT 1`)
    .bind(input.workOrderId, input.ownerUid)
    .first<CustomerContextRow>();
  if (!row) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_INCOMPLETE",
      409,
      "This direct job needs one active linked customer, site and contact before its governed work pack can open.",
    );
  }
  const snapshot = customerContextSnapshot(row);
  const envelope = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT,
    editable: true,
    customerId: row.customer_id,
    siteId: row.site_id,
    contactId: row.contact_id,
    customerRevision: row.customer_revision,
    siteRevision: row.site_revision,
    contactRevision: row.contact_revision,
    contextSha256: creditexCanonicalSha256(snapshot),
  }) satisfies CreditexActivityWorkPackCustomerContext;
  const projection = Object.freeze({
    editable: true,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    suburb: row.suburb,
    state: row.address_state,
    postcode: row.postcode,
    customerRevision: row.customer_revision,
    siteRevision: row.site_revision,
    contactRevision: row.contact_revision,
  }) satisfies CreditexActivityWorkPackCustomerProjection;
  return Object.freeze({ envelope, snapshot, projection });
}

function contextWithSha256<T extends Record<string, unknown>>(
  value: T,
): Readonly<T & { contextSha256: string }> {
  return Object.freeze({
    ...value,
    contextSha256: creditexCanonicalSha256(value),
  });
}

type ServerExecutionContexts = Readonly<{
  providerContext: CreditexActivityWorkPackProviderContext;
  installerBusinessContext: CreditexActivityWorkPackInstallerBusinessContext;
  assignmentContext: CreditexActivityWorkPackAssignmentContext;
  jobContext: CreditexActivityWorkPackJobContext;
}>;

async function loadServerExecutionContexts(
  database: D1Database,
  input: {
    organisationId: string;
    ownerUid: string;
    workOrderId: string;
  },
): Promise<ServerExecutionContexts> {
  const provider = await database.prepare(`SELECT id, organisation_code,
      legal_name, trading_name, abn, updated_at
    FROM compliance_organisations
    WHERE id = ? AND organisation_code = 'CREDITEX-AU' AND status = 'active'
    LIMIT 1`)
    .bind(input.organisationId)
    .first<Record<string, unknown>>();
  if (!provider) {
    return fail(
      "WORK_PACK_PROVIDER_CONTEXT_REQUIRED",
      409,
      "The active Creditex authorised-provider identity is unavailable.",
    );
  }
  const account = await database.prepare(`SELECT firebase_uid, business_name,
      contact_name, email, phone, abn, verified_abn, updated_at
    FROM trade_accounts
    WHERE firebase_uid = ? AND partner_type = 'installer'
      AND account_status = 'active'
    LIMIT 1`)
    .bind(input.ownerUid)
    .first<Record<string, unknown>>();
  if (!account) {
    return fail(
      "WORK_PACK_INSTALLER_CONTEXT_REQUIRED",
      409,
      "The active installer business identity is unavailable.",
    );
  }
  const verifiedAbn = String(account.verified_abn || "").trim();
  const linkedParticipants = await database.prepare(`SELECT id, legal_name,
      trading_name, abn, external_reference, updated_at
    FROM compliance_participants
    WHERE organisation_id = ? AND participant_type = 'installer'
      AND status = 'active'
      AND (external_reference = ? OR (? <> '' AND abn = ?))
    ORDER BY external_reference = ? DESC, updated_at DESC, id
    LIMIT 3`)
    .bind(
      input.organisationId,
      input.ownerUid,
      verifiedAbn,
      verifiedAbn,
      input.ownerUid,
    )
    .all<Record<string, unknown>>();
  const exactOwnerParticipants = linkedParticipants.results.filter(
    (item) => String(item.external_reference) === input.ownerUid,
  );
  const participantCandidates = exactOwnerParticipants.length
    ? exactOwnerParticipants
    : linkedParticipants.results;
  if (participantCandidates.length > 1) {
    return fail(
      "WORK_PACK_INSTALLER_PARTICIPANT_AMBIGUOUS",
      409,
      "Creditex has more than one active compliance participant for this installer business.",
    );
  }
  const participant = participantCandidates[0];
  const assignment = await database.prepare(`SELECT work.id work_order_id,
      work.work_number, work.title, work.service_category, work.source_type,
      work.source_reference, work.revision work_revision,
      work.updated_at work_updated_at, work.assignee_member_id,
      member.member_uid, member.display_name, member.first_name,
      member.last_name, member.email, member.phone, member.role,
      member.updated_at member_revision
    FROM trade_work_orders work
    LEFT JOIN trade_team_members member
      ON member.id = work.assignee_member_id
      AND member.owner_uid = work.firebase_uid
      AND member.status = 'active'
    WHERE work.id = ? AND work.firebase_uid = ?
      AND work.partner_type = 'installer' AND work.record_status = 'active'
    LIMIT 1`)
    .bind(input.workOrderId, input.ownerUid)
    .first<Record<string, unknown>>();
  if (!assignment) {
    return fail(
      "WORK_PACK_ASSIGNMENT_CONTEXT_REQUIRED",
      409,
      "The active assigned work order is unavailable.",
    );
  }
  const assigneeMemberId = String(assignment.assignee_member_id || "");
  if (assigneeMemberId && !String(assignment.member_uid || "")) {
    return fail(
      "WORK_PACK_ASSIGNMENT_CONTEXT_REQUIRED",
      409,
      "Assign this job to an active team member before opening its governed work pack.",
    );
  }
  const providerContext = contextWithSha256({
    contract: "creditex-activity-work-pack-provider-context/v1" as const,
    organisationId: String(provider.id),
    organisationCode: String(provider.organisation_code),
    legalName: String(provider.legal_name),
    tradingName: String(provider.trading_name || provider.legal_name),
    abn: String(provider.abn || ""),
    revision: String(provider.updated_at),
  }) satisfies CreditexActivityWorkPackProviderContext;
  const installerBusinessContext = contextWithSha256({
    contract: "creditex-activity-work-pack-installer-business-context/v1" as const,
    ownerUid: input.ownerUid,
    businessName: String(account.business_name),
    contactName: String(account.contact_name),
    email: String(account.email),
    phone: String(account.phone || ""),
    abn: String(account.abn || ""),
    verifiedAbn,
    participantId: String(participant?.id || ""),
    participantLegalName: String(participant?.legal_name || ""),
    participantTradingName: String(participant?.trading_name || ""),
    participantAbn: String(participant?.abn || ""),
    accountRevision: String(account.updated_at),
    participantRevision: String(participant?.updated_at || ""),
  }) satisfies CreditexActivityWorkPackInstallerBusinessContext;
  const assignmentContext = contextWithSha256({
    contract: "creditex-activity-work-pack-assignment-context/v1" as const,
    ownerUid: input.ownerUid,
    memberId: assigneeMemberId,
    memberUid: assigneeMemberId
      ? String(assignment.member_uid)
      : input.ownerUid,
    displayName: assigneeMemberId
      ? String(assignment.display_name)
      : String(account.contact_name || account.business_name),
    firstName: assigneeMemberId ? String(assignment.first_name || "") : "",
    lastName: assigneeMemberId ? String(assignment.last_name || "") : "",
    email: assigneeMemberId
      ? String(assignment.email || "")
      : String(account.email),
    phone: assigneeMemberId
      ? String(assignment.phone || "")
      : String(account.phone || ""),
    role: assigneeMemberId ? String(assignment.role) : "business_owner",
    revision: assigneeMemberId
      ? String(assignment.member_revision)
      : String(account.updated_at),
  }) satisfies CreditexActivityWorkPackAssignmentContext;
  const jobContext = contextWithSha256({
    contract: "creditex-activity-work-pack-job-context/v1" as const,
    workOrderId: String(assignment.work_order_id),
    workNumber: String(assignment.work_number),
    title: String(assignment.title),
    serviceCategory: String(assignment.service_category),
    sourceType: String(assignment.source_type),
    sourceReference: String(assignment.source_reference || ""),
    revision: Number(assignment.work_revision),
    updatedAt: String(assignment.work_updated_at),
  }) satisfies CreditexActivityWorkPackJobContext;
  return Object.freeze({
    providerContext,
    installerBusinessContext,
    assignmentContext,
    jobContext,
  });
}

export type CreditexActivityWorkPackInstanceEnvelope = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_INSTANCE_CONTRACT;
  definitionSha256: string;
  compositionLockId: string;
  compositionSha256: string;
  prefill: CreditexActivityWorkPackPrefill;
  prefillSha256: string;
  response: CreditexActivityWorkPackResponse;
  responseSha256: string;
  declarations: Readonly<Record<string, unknown>>;
  declarationsSha256: string;
  finalisation: Readonly<Record<string, unknown>> | null;
}>;

function emptyInstanceEnvelope(input: {
  resolved: ResolvedCreditexActivityWorkPack;
  caseId: string;
  workOrderId: string;
  complianceIntentId: string;
  activityDate: string;
  compositionLockId: string;
  compositionSha256: string;
  customerContext: CreditexActivityWorkPackCustomerContext;
  customerSnapshot: CreditexActivityWorkPackCustomerSnapshot;
  executionContexts: ServerExecutionContexts;
}) {
  const prefill = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_PREFILL_CONTRACT,
    caseId: input.caseId,
    workOrderId: input.workOrderId,
    complianceIntentId: input.complianceIntentId,
    organisationId: input.resolved.organisationId,
    activityVersionId: input.resolved.activityVersionId,
    activityDate: input.activityDate,
    customerContext: input.customerContext,
    customerSnapshot: input.customerSnapshot,
    providerContext: input.executionContexts.providerContext,
    installerBusinessContext: input.executionContexts.installerBusinessContext,
    assignmentContext: input.executionContexts.assignmentContext,
    jobContext: input.executionContexts.jobContext,
    dependencyApplicability: dependencyApplicabilityForResolved(
      input.resolved,
    ),
  });
  const response = emptyCreditexActivityWorkPackResponse(
    input.resolved.workPack,
  );
  const declarations = Object.freeze({});
  return Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_INSTANCE_CONTRACT,
    definitionSha256: input.resolved.schemaSha256,
    compositionLockId: input.compositionLockId,
    compositionSha256: input.compositionSha256,
    prefill,
    prefillSha256: creditexCanonicalSha256(prefill),
    response,
    responseSha256: creditexCanonicalSha256(response),
    declarations,
    declarationsSha256: creditexCanonicalSha256(declarations),
    finalisation: null,
  }) satisfies CreditexActivityWorkPackInstanceEnvelope;
}

export type PreparedCreditexActivityWorkPackAttachment = Readonly<{
  instanceId: string;
  instanceKey: string;
  workPackVersionId: string;
  definitionSha256: string;
  compositionLockId: string;
  compositionSha256: string;
  responseSha256: string;
  statement: D1PreparedStatement;
  statements: readonly D1PreparedStatement[];
}>;

async function prepareManualPolicyCompositionLock(
  database: D1Database,
  input: {
    resolved: ResolvedCreditexActivityWorkPack;
    caseId: string;
    activityDate: string;
    activitySnapshot: Record<string, unknown>;
    createdAt: string;
  },
) {
  if (
    input.activitySnapshot.organisationId !== input.resolved.organisationId
    || input.activitySnapshot.activityVersionId !== input.resolved.activityVersionId
    || input.activitySnapshot.evidencePolicyVersionId
      !== input.resolved.evidencePolicyVersionId
    || input.activitySnapshot.activityDate !== input.activityDate
  ) {
    return fail(
      "WORK_PACK_CASE_POLICY_MISMATCH",
      409,
      "The case activity snapshot does not match the work-pack policy identity.",
    );
  }
  const referenceSnapshotSha256 = await manualPolicySha256(
    canonicalManualPolicyJson(
      input.activitySnapshot as unknown as ManualPolicyJson,
    ),
  );
  const activityReference = {
    contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
    referenceType: "compliance_case" as const,
    referenceId: input.caseId,
    referenceMode: "regulated_case" as const,
    activityDate: input.activityDate,
    activityVersionId: input.resolved.activityVersionId,
    activityTemplateId: input.resolved.activityTemplateId,
    referenceRevision: 1,
    referenceUpdatedAt: input.createdAt,
    referenceSnapshotSha256,
  };
  const preview = await buildManualEvidenceFormV2CompositionPreview(
    input.resolved.manualPolicyBinding,
    activityReference,
  );
  const compositionLockId = `work-pack-lock:${crypto.randomUUID()}`;
  const compositionSnapshot = canonicalManualPolicyJson(
    preview.composition as unknown as ManualPolicyJson,
  );
  const diffSnapshot = canonicalManualPolicyJson(
    preview.diff as unknown as ManualPolicyJson,
  );
  return Object.freeze({
    id: compositionLockId,
    sha256: preview.compositionSha256,
    statement: database.prepare(`INSERT INTO compliance_manual_policy_composition_locks
      (id, organisation_id, binding_id, binding_version,
       binding_snapshot_sha256, activity_template_id, activity_version_id,
       reference_type, reference_id, reference_activity_date,
       reference_updated_at, reference_snapshot_sha256, revision,
       composition_snapshot, composition_sha256, diff_snapshot, diff_sha256,
       locked_by_uid, locked_at, superseded_by_id, superseded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'compliance_case', ?, ?, ?, ?, 1,
        ?, ?, ?, ?, ?, ?, '', '')`)
      .bind(
        compositionLockId,
        input.resolved.organisationId,
        input.resolved.manualPolicyBindingId,
        input.resolved.manualPolicyBindingVersion,
        input.resolved.manualPolicyBindingSha256,
        input.resolved.activityTemplateId,
        input.resolved.activityVersionId,
        input.caseId,
        input.activityDate,
        input.createdAt,
        referenceSnapshotSha256,
        compositionSnapshot,
        preview.compositionSha256,
        diffSnapshot,
        preview.diffSha256,
        input.resolved.manualPolicyBinding.approvedByUid,
        input.createdAt,
      ),
  });
}

export async function prepareCreditexActivityWorkPackAttachment(
  database: D1Database,
  input: {
    caseId: string;
    organisationId: string;
    workOrderId: string;
    complianceIntentId?: string;
    activityVersionId: string;
    activityDate: string;
    evidencePolicyVersionId: string;
    activitySnapshot: Record<string, unknown>;
    ownerUid: string;
    actorUid: string;
    createdAt?: string;
  },
): Promise<PreparedCreditexActivityWorkPackAttachment> {
  const caseId = text(input.caseId, 180, "WORK_PACK_CASE_REQUIRED", "Compliance case");
  const workOrderId = text(
    input.workOrderId,
    180,
    "WORK_PACK_WORK_ORDER_REQUIRED",
    "Work order",
  );
  const complianceIntentId = optionalText(input.complianceIntentId, 180);
  const actorUid = text(input.actorUid, 180, "WORK_PACK_ACTOR_REQUIRED", "Actor");
  const createdAt = input.createdAt
    ? instant(input.createdAt, "WORK_PACK_CREATED_AT_INVALID", "Created time")
    : new Date().toISOString();
  const resolved = await resolvePublishedCreditexActivityWorkPack(database, {
    organisationId: input.organisationId,
    activityVersionId: input.activityVersionId,
    activityDate: input.activityDate,
  });
  if (
    resolved.evidencePolicyVersionId !== text(
      input.evidencePolicyVersionId,
      180,
      "WORK_PACK_EVIDENCE_POLICY_REQUIRED",
      "Evidence policy version",
    )
  ) {
    return fail(
      "WORK_PACK_CASE_POLICY_MISMATCH",
      409,
      "The effective work pack is not bound to the case evidence policy.",
    );
  }
  const compositionLock = await prepareManualPolicyCompositionLock(database, {
    resolved,
    caseId,
    activityDate: input.activityDate,
    activitySnapshot: input.activitySnapshot,
    createdAt,
  });
  const customerContext = await loadServerCustomerContext(database, {
    ownerUid: text(
      input.ownerUid,
      180,
      "WORK_PACK_OWNER_REQUIRED",
      "Installer account",
    ),
    workOrderId,
  });
  const executionContexts = await loadServerExecutionContexts(database, {
    organisationId: resolved.organisationId,
    ownerUid: input.ownerUid,
    workOrderId,
  });
  const instanceId = `work-pack:${caseId}:revision:1`;
  const instanceKey = `case:${caseId}:work-pack:${resolved.id}`;
  const envelope = emptyInstanceEnvelope({
    resolved,
    caseId,
    workOrderId,
    complianceIntentId,
    activityDate: input.activityDate,
    compositionLockId: compositionLock.id,
    compositionSha256: compositionLock.sha256,
    customerContext: customerContext.envelope,
    customerSnapshot: customerContext.snapshot,
    executionContexts,
  });
  const responseSnapshot = checkedJson(envelope);
  const responseSha256 = creditexCanonicalSha256(envelope);
  const statement = database.prepare(`INSERT INTO compliance_activity_work_pack_instances
    (id, instance_key, organisation_id, compliance_case_id, work_order_id,
     compliance_intent_id, work_pack_version_id,
     manual_policy_composition_lock_id, manual_policy_composition_sha256,
     activity_date, revision, supersedes_instance_id, status,
     response_snapshot, response_sha256, created_by_uid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', 'not_started', ?, ?, ?, ?)`)
    .bind(
      instanceId,
      instanceKey,
      resolved.organisationId,
      caseId,
      workOrderId,
      complianceIntentId,
      resolved.id,
      compositionLock.id,
      compositionLock.sha256,
      input.activityDate,
      responseSnapshot,
      responseSha256,
      actorUid,
      createdAt,
    );
  return Object.freeze({
    instanceId,
    instanceKey,
    workPackVersionId: resolved.id,
    definitionSha256: resolved.schemaSha256,
    responseSha256,
    compositionLockId: compositionLock.id,
    compositionSha256: compositionLock.sha256,
    statement,
    statements: Object.freeze([compositionLock.statement, statement]),
  });
}

type WorkPackInstanceRecord = {
  id: string;
  instance_key: string;
  organisation_id: string;
  compliance_case_id: string;
  work_order_id: string;
  compliance_intent_id: string;
  work_pack_version_id: string;
  manual_policy_composition_lock_id: string;
  manual_policy_composition_sha256: string;
  activity_date: string;
  revision: number;
  supersedes_instance_id: string;
  status: string;
  response_snapshot: string;
  response_sha256: string;
  created_by_uid: string;
  created_at: string;
  activity_version_id: string;
  case_revision: number;
  evidence_policy_version_id: string;
  installer_uid: string;
  source_type: string;
  customer_source: string;
  assignee_member_id: string;
  assigned_worker_uid: string;
  work_order_revision: number;
};

export type CreditexWorkPackTradeScope = Readonly<{
  ownerUid: string;
  actorUid: string;
  actorMemberId: string;
  scope: "own" | "team";
}>;

export type CreditexActivityWorkPackSignatureProjection = Readonly<{
  id: string;
  promptKey: string;
  signerRole: string;
  signerCapacity: string;
  signerName: string;
  signerUid: string;
  signatureSha256: string;
  signaturePayload: CreditexActivityWorkPackSignaturePayload;
  previewUrl: string;
  attestationSha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  action: "captured" | "revoked";
  supersedesSignatureId: string;
  capturedDeviceId: string;
  signedAt: string;
  capturedAt: string;
  createdAt: string;
}>;

export type CreditexActivityWorkPackArtifactProjection = Readonly<{
  id: string;
  promptKey: string;
  artifactKind: "photo" | "document";
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  originalSha256: string;
  metadataSha256: string;
  integrityReceiptId: string;
  verificationState: "matched";
  supersedesArtifactId: string;
  capturedDeviceId: string;
  capturedByUid: string;
  capturedAt: string;
  createdAt: string;
}>;

export type CreditexActivityWorkPackSignerBindingProjection = Readonly<{
  roleKey: string;
  capacity: string;
  identitySource: CreditexWorkPackSignerIdentitySource;
  signerUid: string;
  signerName: string;
  fields: Readonly<Record<string, string>>;
}>;

export type CreditexActivityWorkPackReferenceDocumentProjection = Readonly<{
  responseKey: string;
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
  sourceBindingTargetKey: string;
  acknowledgementMode: "none" | "viewed" | "confirmed";
  acknowledgementText: string;
  acknowledgementVersion: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  title: string;
  version: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  openUrl: string;
}>;

export type CreditexActivityWorkPackFinalRecordProjection = Readonly<{
  id: string;
  caseInstanceId: string;
  instanceSha256: string;
  signatureManifestSha256: string;
  rendererVersion: string;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  pdfSha256: string;
  finalisedAt: string;
  downloadUrl: string;
}>;

export type CreditexActivityWorkPackCalculatorOutputProjection = Readonly<{
  dependencyKey: string;
  catalogueFormulaKey: string;
  outcomeClass: ComplianceOutcomeClass;
  claimOutputCode: ComplianceClaimOutputCode;
  claimOutputLabel: string;
  calculationRunId: string;
  caseRevision: number;
  calculatorVersionId: string;
  calculatorKey: string;
  calculatorVersion: number;
  calculatorSourceSha256: string;
  quantity: string;
  unit: string;
  outputSha256: string;
  executionReceiptSha256: string;
  engineReceiptId: string;
  engineContractSha256: string;
  goldenVectorSuiteSha256: string;
  engineSuiteReceiptSha256: string;
  verifiedByUid: string;
  verifiedAt: string;
}>;

export type CreditexActivityWorkPackCalculatorPendingReviewProjection = Readonly<{
  dependencyKey: string;
  calculationRunId: string;
  status: "calculated";
  reviewStatus: "creditex_review_required" | "creditex_review_rejected";
  runAt: string;
}>;

export type CreditexActivityWorkPackOfficialProductProjection = Readonly<{
  dependencyKey: string;
  selectionId: string;
  snapshotId: string;
  registryCode: string;
  productKind: string;
  sourceKey: string;
  sourceRecordKey: string;
  sourceSha256: string;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registrationNumber: string;
  certificateNumber: string;
  approvalStatus: string;
  eligibleFrom: string;
  eligibleTo: string;
  registryEffectiveFrom: string;
}>;

export type CreditexAssignedActivityWorkPackProjection = Readonly<{
  instance: Readonly<{
    id: string;
    instanceKey: string;
    caseId: string;
    workOrderId: string;
    complianceIntentId: string;
    workPackVersionId: string;
    compositionLockId: string;
    compositionSha256: string;
    activityDate: string;
    revision: number;
    supersedesInstanceId: string;
    status: "not_started" | "in_progress" | "ready_to_sign" | "completed" | "void";
    responseSha256: string;
    createdAt: string;
  }>;
  signatureBindings: Readonly<{
    definitionSha256: string;
    prefillSha256: string;
    responseSha256: string;
    declarationsSha256: string;
  }>;
  signerBindings: readonly CreditexActivityWorkPackSignerBindingProjection[];
  definition: Readonly<{
    id: string;
    title: string;
    activityVersionId: string;
    activityTemplateId: string;
    version: number;
    schemaSha256: string;
    effectiveFrom: string;
    effectiveTo: string;
    schema: CreditexActivityWorkPack;
  }>;
  response: CreditexActivityWorkPackResponse;
  completion: CreditexActivityWorkPackCompletion;
  signatures: readonly CreditexActivityWorkPackSignatureProjection[];
  artifacts: readonly CreditexActivityWorkPackArtifactProjection[];
  calculatorOutputs: readonly CreditexActivityWorkPackCalculatorOutputProjection[];
  calculatorPendingReviews:
    readonly CreditexActivityWorkPackCalculatorPendingReviewProjection[];
  referenceDocuments: readonly CreditexActivityWorkPackReferenceDocumentProjection[];
  finalRecord: CreditexActivityWorkPackFinalRecordProjection | null;
  protectedCustomer: boolean;
  customerContextBinding: CreditexActivityWorkPackCustomerContext;
  customerContext: CreditexActivityWorkPackCustomerProjection;
  executionContextStale: boolean;
  executionContext: Readonly<{
    provider: CreditexActivityWorkPackProviderContext;
    installerBusiness: CreditexActivityWorkPackInstallerBusinessContext;
    assignment: CreditexActivityWorkPackAssignmentContext;
    job: CreditexActivityWorkPackJobContext;
  }>;
  artifactHook: Readonly<{
    contract: typeof CREDITEX_ACTIVITY_WORK_PACK_ARTIFACT_HOOK_CONTRACT;
    status: "not_ready" | "generation_required" | "retained";
    finalisationSha256: string;
  }>;
}>;

function instanceStatus(value: unknown) {
  if (
    value === "not_started" || value === "in_progress"
    || value === "ready_to_sign" || value === "completed" || value === "void"
  ) return value;
  return fail(
    "WORK_PACK_INSTANCE_STATUS_INVALID",
    500,
    "The activity work-pack instance has an invalid status.",
  );
}

async function resolvePinnedCreditexActivityWorkPack(
  database: D1Database,
  input: {
    organisationId: string;
    workPackVersionId: string;
    activityVersionId: string;
    activityDate: string;
  },
) {
  const row = await database.prepare(`SELECT pack.*,
      binding.binding_snapshot manual_binding_snapshot,
      binding.lifecycle_state manual_binding_lifecycle_state,
      binding.approved_by_uid manual_binding_approved_by_uid,
      binding.approved_at manual_binding_approved_at,
      policy.publish_state evidence_policy_publish_state,
      policy.requirements_complete evidence_policy_requirements_complete
    FROM compliance_activity_work_pack_versions pack
    JOIN compliance_activity_versions activity
      ON activity.id = pack.activity_version_id
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = pack.organisation_id
    JOIN compliance_manual_policy_bindings binding
      ON binding.id = pack.manual_policy_binding_id
      AND binding.organisation_id = pack.organisation_id
      AND binding.activity_template_id = pack.activity_template_id
      AND binding.activity_version_id = pack.activity_version_id
      AND binding.version = pack.manual_policy_binding_version
      AND binding.binding_snapshot_sha256 = pack.manual_policy_binding_sha256
      AND binding.evidence_policy_version_id = pack.evidence_policy_version_id
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = pack.evidence_policy_version_id
      AND policy.organisation_id = pack.organisation_id
      AND policy.activity_version_id = pack.activity_version_id
      AND policy.version = pack.evidence_policy_version
      AND policy.official_source_sha256 = pack.evidence_policy_source_sha256
    WHERE pack.id = ?
      AND pack.organisation_id = ?
      AND pack.activity_version_id = ?
      AND pack.publish_state = 'published'
      AND pack.effective_from <= ?
      AND (pack.effective_to = '' OR pack.effective_to >= ?)
      AND activity.publish_state = 'published'
      AND activity.effective_from <= ?
      AND (activity.effective_to = '' OR activity.effective_to >= ?)
      AND program.publish_state = 'published'
      AND binding.lifecycle_state = 'approved'
      AND policy.publish_state = 'published'
      AND policy.requirements_complete = 1
    LIMIT 1`)
    .bind(
      input.workPackVersionId,
      input.organisationId,
      input.activityVersionId,
      input.activityDate,
      input.activityDate,
      input.activityDate,
      input.activityDate,
    )
    .first<WorkPackVersionRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_PINNED_VERSION_UNAVAILABLE",
      409,
      "The exact pinned activity work-pack version is no longer available for completion.",
    );
  }
  if (
    !row.reviewed_by_uid || !row.reviewed_at || !row.review_note
    || row.reviewed_by_uid === row.authored_by_uid
  ) {
    return fail(
      "WORK_PACK_INDEPENDENT_REVIEW_REQUIRED",
      409,
      "The exact pinned work-pack version lacks independent approval.",
    );
  }
  const workPack = validateCreditexActivityWorkPack(parseObject(
    row.schema_snapshot,
    "WORK_PACK_SCHEMA_INVALID",
    "The pinned activity work-pack schema is invalid.",
  ));
  const schemaSha256 = creditexActivityWorkPackSha256(workPack);
  if (
    normaliseSha256(
      row.schema_sha256,
      "WORK_PACK_SCHEMA_SHA256_INVALID",
      "Work-pack schema SHA-256",
    ) !== schemaSha256
    || workPack.activityTemplateId !== row.activity_template_id
    || workPack.version !== Number(row.version)
    || workPack.effectiveFrom !== row.effective_from
    || workPack.effectiveTo !== row.effective_to
  ) {
    return fail(
      "WORK_PACK_COMPOSITION_IDENTITY_MISMATCH",
      409,
      "The pinned work-pack schema does not match its sealed version identity.",
    );
  }
  validateCatalogueDependencies(workPack);
  const sourceRows = await approvedSourceBindings(
    database,
    input.organisationId,
    input.workPackVersionId,
  );
  validateSourceComposition(workPack, sourceRows);
  const manualPolicyBinding = await validatePinnedPolicyComposition(
    database,
    row,
    workPack,
  );
  return Object.freeze({
    id: String(row.id),
    organisationId: input.organisationId,
    activityVersionId: input.activityVersionId,
    activityTemplateId: String(row.activity_template_id),
    manualPolicyBindingId: String(row.manual_policy_binding_id),
    manualPolicyBindingVersion: Number(row.manual_policy_binding_version),
    manualPolicyBindingSha256: bareSha256(row.manual_policy_binding_sha256),
    evidencePolicyVersionId: String(row.evidence_policy_version_id),
    evidencePolicyVersion: Number(row.evidence_policy_version),
    evidencePolicySourceSha256: bareSha256(row.evidence_policy_source_sha256),
    version: Number(row.version),
    title: String(row.title),
    schemaSha256,
    effectiveFrom: String(row.effective_from),
    effectiveTo: String(row.effective_to || ""),
    reviewedByUid: String(row.reviewed_by_uid),
    reviewedAt: String(row.reviewed_at),
    workPack,
    manualPolicyBinding,
    sourceBindings: Object.freeze(sourceRows.map((binding) => Object.freeze({
      id: binding.id,
      sourceArtifactId: binding.source_artifact_id,
      sourceArtifactSha256: normaliseSha256(
        binding.source_artifact_sha256,
        "WORK_PACK_SOURCE_BINDING_INVALID",
        "Source binding SHA-256",
      ),
      sourceRole: binding.source_role,
      targetKey: binding.target_key,
      citationLocation: binding.citation_location,
      createdByUid: binding.created_by_uid,
      reviewedByUid: binding.reviewed_by_uid,
      reviewedAt: binding.reviewed_at,
    }))),
  });
}

function validateInstanceEnvelope(
  row: WorkPackInstanceRecord,
  resolved: Awaited<ReturnType<typeof resolvePinnedCreditexActivityWorkPack>>,
  options: Readonly<{ allowStaleExecutionContext?: boolean }> = {},
) {
  const envelope = parseObject(
    row.response_snapshot,
    "WORK_PACK_INSTANCE_RESPONSE_INVALID",
    "The stored activity work-pack response is invalid.",
  );
  if (envelope.contract !== CREDITEX_ACTIVITY_WORK_PACK_INSTANCE_CONTRACT) {
    return fail(
      "WORK_PACK_INSTANCE_CONTRACT_INVALID",
      500,
      "The stored activity work-pack response contract is invalid.",
    );
  }
  const prefill = object(
    envelope.prefill,
    "WORK_PACK_PREFILL_INVALID",
    "The stored activity work-pack prefill is invalid.",
  );
  const response = object(
    envelope.response,
    "WORK_PACK_RESPONSE_INVALID",
    "The stored activity work-pack response is invalid.",
  ) as CreditexActivityWorkPackResponse;
  const declarations = object(
    envelope.declarations,
    "WORK_PACK_DECLARATIONS_INVALID",
    "The stored activity work-pack declarations are invalid.",
  );
  const finalisation = envelope.finalisation === null
    ? null
    : object(
      envelope.finalisation,
      "WORK_PACK_FINALISATION_INVALID",
      "The stored activity work-pack finalisation is invalid.",
    );
  const customerContext = object(
    prefill.customerContext,
    "WORK_PACK_CUSTOMER_CONTEXT_INVALID",
    "The stored customer context binding is invalid.",
  ) as unknown as CreditexActivityWorkPackCustomerContext;
  const customerSnapshot = object(
    prefill.customerSnapshot,
    "WORK_PACK_CUSTOMER_SNAPSHOT_INVALID",
    "The stored customer display snapshot is invalid.",
  ) as unknown as CreditexActivityWorkPackCustomerSnapshot;
  const providerContext = object(
    prefill.providerContext,
    "WORK_PACK_PROVIDER_CONTEXT_INVALID",
    "The stored authorised-provider context is invalid.",
  ) as unknown as CreditexActivityWorkPackProviderContext;
  const installerBusinessContext = object(
    prefill.installerBusinessContext,
    "WORK_PACK_INSTALLER_CONTEXT_INVALID",
    "The stored installer business context is invalid.",
  ) as unknown as CreditexActivityWorkPackInstallerBusinessContext;
  const assignmentContext = object(
    prefill.assignmentContext,
    "WORK_PACK_ASSIGNMENT_CONTEXT_INVALID",
    "The stored assignment context is invalid.",
  ) as unknown as CreditexActivityWorkPackAssignmentContext;
  const jobContext = object(
    prefill.jobContext,
    "WORK_PACK_JOB_CONTEXT_INVALID",
    "The stored job context is invalid.",
  ) as unknown as CreditexActivityWorkPackJobContext;
  if (!Array.isArray(prefill.dependencyApplicability)) {
    return fail(
      "WORK_PACK_DEPENDENCY_APPLICABILITY_INVALID",
      409,
      "The stored work pack is missing its pinned dependency applicability decisions.",
    );
  }
  const dependencyApplicability = prefill.dependencyApplicability as unknown as
    readonly CreditexActivityWorkPackDependencyApplicability[];
  const expectedDependencyApplicability = dependencyApplicabilityForResolved(
    resolved,
  );
  const providerSnapshot = { ...providerContext } as Record<string, unknown>;
  const installerSnapshot = {
    ...installerBusinessContext,
  } as Record<string, unknown>;
  const assignmentSnapshot = { ...assignmentContext } as Record<string, unknown>;
  const jobSnapshot = { ...jobContext } as Record<string, unknown>;
  delete providerSnapshot.contextSha256;
  delete installerSnapshot.contextSha256;
  delete assignmentSnapshot.contextSha256;
  delete jobSnapshot.contextSha256;
  if (
    envelope.definitionSha256 !== resolved.schemaSha256
    || envelope.compositionLockId !== row.manual_policy_composition_lock_id
    || bareSha256(String(envelope.compositionSha256 || ""))
      !== bareSha256(row.manual_policy_composition_sha256)
    || resolved.evidencePolicyVersionId !== row.evidence_policy_version_id
    || prefill.contract !== CREDITEX_ACTIVITY_WORK_PACK_PREFILL_CONTRACT
    || prefill.caseId !== row.compliance_case_id
    || prefill.workOrderId !== row.work_order_id
    || prefill.complianceIntentId !== row.compliance_intent_id
    || prefill.organisationId !== row.organisation_id
    || prefill.activityVersionId !== row.activity_version_id
    || prefill.activityDate !== row.activity_date
    || customerContext.contract
      !== CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT
    || typeof customerContext.editable !== "boolean"
    || !SHA256_PATTERN.test(String(customerContext.contextSha256 || ""))
    || customerSnapshot.contract
      !== "creditex-activity-work-pack-customer-context-snapshot/v1"
    || customerSnapshot.customerId !== customerContext.customerId
    || customerSnapshot.siteId !== customerContext.siteId
    || customerSnapshot.contactId !== customerContext.contactId
    || customerSnapshot.customerRevision !== customerContext.customerRevision
    || customerSnapshot.siteRevision !== customerContext.siteRevision
    || customerSnapshot.contactRevision !== customerContext.contactRevision
    || customerContext.contextSha256
      !== creditexCanonicalSha256(customerSnapshot)
    || providerContext.contract
      !== "creditex-activity-work-pack-provider-context/v1"
    || providerContext.organisationId !== row.organisation_id
    || providerContext.contextSha256
      !== creditexCanonicalSha256(providerSnapshot)
    || installerBusinessContext.contract
      !== "creditex-activity-work-pack-installer-business-context/v1"
    || installerBusinessContext.ownerUid !== row.installer_uid
    || installerBusinessContext.contextSha256
      !== creditexCanonicalSha256(installerSnapshot)
    || assignmentContext.contract
      !== "creditex-activity-work-pack-assignment-context/v1"
    || assignmentContext.ownerUid !== row.installer_uid
    || (!options.allowStaleExecutionContext
      && assignmentContext.memberId !== row.assignee_member_id)
    || (!options.allowStaleExecutionContext
      && assignmentContext.memberUid !== row.assigned_worker_uid)
    || assignmentContext.contextSha256
      !== creditexCanonicalSha256(assignmentSnapshot)
    || jobContext.contract !== "creditex-activity-work-pack-job-context/v1"
    || jobContext.workOrderId !== row.work_order_id
    || jobContext.contextSha256 !== creditexCanonicalSha256(jobSnapshot)
    || creditexCanonicalSha256(dependencyApplicability)
      !== creditexCanonicalSha256(expectedDependencyApplicability)
    || envelope.prefillSha256 !== creditexCanonicalSha256(prefill)
    || response.schemaSha256 !== resolved.schemaSha256
    || envelope.responseSha256 !== creditexCanonicalSha256(response)
    || envelope.declarationsSha256 !== creditexCanonicalSha256(declarations)
    || row.response_sha256 !== creditexCanonicalSha256(envelope)
  ) {
    return fail(
      "WORK_PACK_INSTANCE_INTEGRITY_MISMATCH",
      409,
      "The activity work-pack instance no longer matches its pinned definition and hashes.",
    );
  }
  if (
    !response.answers || typeof response.answers !== "object"
    || Array.isArray(response.answers)
    || !response.repeatableSections
    || typeof response.repeatableSections !== "object"
    || Array.isArray(response.repeatableSections)
    || !response.dependencyResolutions
    || typeof response.dependencyResolutions !== "object"
    || Array.isArray(response.dependencyResolutions)
  ) {
    return fail(
      "WORK_PACK_RESPONSE_INVALID",
      409,
      "The activity work-pack response fields are invalid.",
    );
  }
  return Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_INSTANCE_CONTRACT,
    definitionSha256: resolved.schemaSha256,
    compositionLockId: String(envelope.compositionLockId),
    compositionSha256: bareSha256(String(envelope.compositionSha256)),
    prefill: prefill as CreditexActivityWorkPackPrefill,
    prefillSha256: String(envelope.prefillSha256),
    response,
    responseSha256: String(envelope.responseSha256),
    declarations,
    declarationsSha256: String(envelope.declarationsSha256),
    finalisation,
  }) satisfies CreditexActivityWorkPackInstanceEnvelope;
}

async function assignedInstanceRow(
  database: D1Database,
  scope: CreditexWorkPackTradeScope,
  instanceId: string,
) {
  await ensureCreditexWorkPackSchemaGuards(database);
  const row = await database.prepare(`SELECT instance.*,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      compliance_case.evidence_policy_version_id,
      compliance_case.installer_uid,
      work_order.source_type, work_order.assignee_member_id,
      work_order.revision work_order_revision,
      CASE
        WHEN work_order.assignee_member_id = '' THEN work_order.firebase_uid
        ELSE COALESCE(assigned_member.member_uid, '')
      END assigned_worker_uid,
      COALESCE(job_detail.customer_source, '') customer_source
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
      AND compliance_case.work_order_id = instance.work_order_id
    JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
      AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id
      AND job_detail.firebase_uid = work_order.firebase_uid
    LEFT JOIN trade_team_members assigned_member
      ON assigned_member.id = work_order.assignee_member_id
      AND assigned_member.owner_uid = work_order.firebase_uid
      AND assigned_member.status = 'active'
    WHERE instance.instance_key = (
        SELECT requested.instance_key
        FROM compliance_activity_work_pack_instances requested
        WHERE requested.id = ?
        LIMIT 1
      )
      AND (? = 'team' OR work_order.assignee_member_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.compliance_case_id = instance.compliance_case_id
          AND newer.revision > instance.revision
      )
    LIMIT 1`)
    .bind(scope.ownerUid, instanceId, scope.scope, scope.actorMemberId)
    .first<WorkPackInstanceRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_INSTANCE_NOT_ASSIGNED",
      404,
      "The current assigned activity work pack was not found.",
    );
  }
  return row;
}

async function instanceSignatures(database: D1Database, row: WorkPackInstanceRecord) {
  const records = await database.prepare(`SELECT *
    FROM compliance_activity_work_pack_signatures signature
    WHERE signature.organisation_id = ?
      AND signature.instance_key = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_signatures successor
        WHERE successor.organisation_id = signature.organisation_id
          AND successor.instance_key = signature.instance_key
          AND successor.supersedes_signature_id = signature.id
      )
    ORDER BY signature.signed_at, signature.created_at, signature.id`)
    .bind(row.organisation_id, row.instance_key)
    .all<Record<string, unknown>>();
  return records.results.map((signature) => {
    const payload = parseObject(
      signature.signature_payload_snapshot,
      "WORK_PACK_SIGNATURE_INVALID",
      "A retained signature payload is invalid.",
    );
    signaturePoints(payload.strokes);
    if (
      payload.contract !== CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT
      || payload.promptKey !== String(signature.prompt_key)
      || payload.signerRoleKey !== String(signature.signer_role)
      || creditexCanonicalSha256(payload) !== normaliseSha256(
        signature.signature_payload_sha256,
        "WORK_PACK_SIGNATURE_INVALID",
        "Signature payload SHA-256",
      )
    ) {
      return fail(
        "WORK_PACK_SIGNATURE_INVALID",
        409,
        "A retained signature payload no longer matches its exact hashes.",
      );
    }
    const query = new URLSearchParams({
      caseInstanceId: row.id,
      signatureId: String(signature.id),
    });
    return Object.freeze({
    id: String(signature.id),
    promptKey: String(signature.prompt_key),
    signerRole: String(signature.signer_role),
    signerCapacity: String(signature.signer_capacity),
    signerName: String(signature.signer_name),
    signerUid: String(signature.signer_uid || ""),
    signatureSha256: normaliseSha256(
      signature.signature_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature SHA-256",
    ),
    signaturePayload: payload as CreditexActivityWorkPackSignaturePayload,
    previewUrl: `/api/trade-team/work-packs/signature?${query.toString()}`,
    attestationSha256: normaliseSha256(
      signature.attestation_sha256,
      "WORK_PACK_ATTESTATION_INVALID",
      "Attestation SHA-256",
    ),
    definitionSha256: normaliseSha256(
      signature.definition_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature definition SHA-256",
    ),
    prefillSha256: normaliseSha256(
      signature.prefill_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature prefill SHA-256",
    ),
    responseSha256: normaliseSha256(
      signature.response_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature response SHA-256",
    ),
    declarationsSha256: normaliseSha256(
      signature.declarations_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature declarations SHA-256",
    ),
    action: signature.action === "revoked" ? "revoked" : "captured",
    supersedesSignatureId: String(signature.supersedes_signature_id || ""),
    capturedDeviceId: String(signature.captured_device_id),
    signedAt: String(signature.signed_at),
    capturedAt: String(signature.created_at),
    createdAt: String(signature.created_at),
  });
  }) satisfies CreditexActivityWorkPackSignatureProjection[];
}

async function instanceArtifacts(database: D1Database, row: WorkPackInstanceRecord) {
  const records = await database.prepare(`SELECT *
    FROM compliance_activity_work_pack_artifacts artifact
    WHERE artifact.organisation_id = ?
      AND artifact.instance_key = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_artifacts successor
        WHERE successor.organisation_id = artifact.organisation_id
          AND successor.instance_key = artifact.instance_key
          AND successor.supersedes_artifact_id = artifact.id
      )
    ORDER BY artifact.captured_at, artifact.created_at, artifact.id`)
    .bind(row.organisation_id, row.instance_key)
    .all<Record<string, unknown>>();
  return records.results.map((artifact) => Object.freeze({
    id: String(artifact.id),
    promptKey: String(artifact.prompt_key),
    artifactKind: artifact.artifact_kind === "document" ? "document" : "photo",
    originalFileName: String(artifact.original_file_name),
    contentType: String(artifact.content_type),
    sizeBytes: Number(artifact.size_bytes),
    originalSha256: normaliseSha256(
      artifact.original_sha256,
      "WORK_PACK_ARTIFACT_INVALID",
      "Artifact SHA-256",
    ),
    metadataSha256: normaliseSha256(
      artifact.metadata_sha256,
      "WORK_PACK_ARTIFACT_INVALID",
      "Artifact metadata SHA-256",
    ),
    integrityReceiptId: String(artifact.integrity_receipt_id),
    verificationState: "matched" as const,
    supersedesArtifactId: String(artifact.supersedes_artifact_id || ""),
    capturedDeviceId: String(artifact.captured_device_id),
    capturedByUid: String(artifact.captured_by_uid),
    capturedAt: String(artifact.captured_at),
    createdAt: String(artifact.created_at),
  })) satisfies CreditexActivityWorkPackArtifactProjection[];
}

async function instanceFinalRecord(
  database: D1Database,
  row: WorkPackInstanceRecord,
) {
  const record = await database.prepare(`SELECT id, case_instance_id,
      instance_sha256, signature_manifest_sha256, renderer_version,
      file_name, content_type, size_bytes, pdf_sha256, finalised_at
    FROM compliance_activity_work_pack_final_records
    WHERE organisation_id = ? AND instance_key = ? AND case_instance_id = ?
    ORDER BY finalised_at DESC, id DESC
    LIMIT 1`)
    .bind(row.organisation_id, row.instance_key, row.id)
    .first<Record<string, unknown>>();
  if (!record) return null;
  const query = new URLSearchParams({
    caseInstanceId: String(record.case_instance_id),
  });
  return Object.freeze({
    id: String(record.id),
    caseInstanceId: String(record.case_instance_id),
    instanceSha256: normaliseSha256(
      record.instance_sha256,
      "WORK_PACK_FINAL_RECORD_INVALID",
      "Final record instance SHA-256",
    ),
    signatureManifestSha256: normaliseSha256(
      record.signature_manifest_sha256,
      "WORK_PACK_FINAL_RECORD_INVALID",
      "Final record signature manifest SHA-256",
    ),
    rendererVersion: String(record.renderer_version),
    fileName: String(record.file_name),
    contentType: "application/pdf" as const,
    sizeBytes: Number(record.size_bytes),
    pdfSha256: normaliseSha256(
      record.pdf_sha256,
      "WORK_PACK_FINAL_RECORD_INVALID",
      "Final record PDF SHA-256",
    ),
    finalisedAt: String(record.finalised_at),
    downloadUrl: `/api/trade-team/work-packs/final-record?${query.toString()}`,
  }) satisfies CreditexActivityWorkPackFinalRecordProjection;
}

type ReferenceDocumentSourceRecord = {
  target_key: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  source_title: string;
  source_version: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
};

async function instanceReferenceDocuments(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
) {
  const records = await database.prepare(`SELECT binding.target_key,
      binding.source_artifact_id, binding.source_artifact_sha256,
      artifact.source_title, artifact.source_version,
      artifact.original_file_name, artifact.content_type, artifact.size_bytes
    FROM compliance_activity_work_pack_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.source_artifact_id
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.sha256 = binding.source_artifact_sha256
    JOIN compliance_official_source_review_decisions decision
      ON decision.organisation_id = artifact.organisation_id
      AND decision.subject_type = 'artifact'
      AND decision.subject_id = artifact.id
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE binding.organisation_id = ?
      AND binding.work_pack_version_id = ?
      AND binding.schema_sha256 = ?
      AND binding.source_role = 'requirement'
      AND binding.binding_state = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = decision.id
      )
    ORDER BY binding.target_key, binding.source_artifact_id`)
    .bind(row.organisation_id, row.work_pack_version_id,
      creditexActivityWorkPackSha256(workPack))
    .all<ReferenceDocumentSourceRecord>();
  const sources = new Map<string, ReferenceDocumentSourceRecord[]>();
  for (const record of records.results) {
    const list = sources.get(record.target_key) || [];
    list.push(record);
    sources.set(record.target_key, list);
  }
  const projected: CreditexActivityWorkPackReferenceDocumentProjection[] = [];
  for (const section of workPack.sections) {
    const repeatInstances = section.repeatability
      ? response.repeatableSections[section.sectionKey] || []
      : [{ instanceKey: "", answers: response.answers }];
    for (const prompt of section.prompts) {
      if (prompt.type !== "reference_document" || !prompt.referenceDocument) {
        continue;
      }
      const target = prompt.referenceDocument.sourceBindingTargetKey;
      const targetSources = sources.get(target) || [];
      if (!targetSources.length) {
        return fail(
          "WORK_PACK_REFERENCE_DOCUMENT_SOURCE_UNAVAILABLE",
          409,
          "A governed reference document is no longer available for this work pack.",
        );
      }
      for (const repeatInstance of repeatInstances) {
        const responseKey = section.repeatability
          ? `${section.sectionKey}[${repeatInstance.instanceKey}].${prompt.promptKey}`
          : prompt.promptKey;
        for (const source of targetSources) {
          const query = new URLSearchParams({
            caseInstanceId: row.id,
            responseKey,
            sourceArtifactId: source.source_artifact_id,
          });
          projected.push(Object.freeze({
            responseKey,
            sectionKey: section.sectionKey,
            repeatInstanceKey: repeatInstance.instanceKey,
            promptKey: prompt.promptKey,
            sourceBindingTargetKey: target,
            acknowledgementMode: prompt.referenceDocument.acknowledgementMode,
            acknowledgementText: prompt.referenceDocument.acknowledgementText,
            acknowledgementVersion: prompt.referenceDocument.acknowledgementVersion,
            sourceArtifactId: source.source_artifact_id,
            sourceArtifactSha256: source.source_artifact_sha256,
            title: source.source_title,
            version: source.source_version,
            originalFileName: source.original_file_name,
            contentType: source.content_type,
            sizeBytes: Number(source.size_bytes),
            openUrl: `/api/trade-team/work-packs/reference-document?${query.toString()}`,
          }));
        }
      }
    }
  }
  return Object.freeze(projected);
}

function signerBindingsForInstance(
  envelope: CreditexActivityWorkPackInstanceEnvelope,
  workPack: CreditexActivityWorkPack,
  actorUid: string,
) {
  return Object.freeze(workPack.signerRoles.map((role) =>
    authoritativeSignerBinding(envelope, role, actorUid)
  )) satisfies readonly CreditexActivityWorkPackSignerBindingProjection[];
}

function authoritativeSignerBinding(
  envelope: CreditexActivityWorkPackInstanceEnvelope,
  role: CreditexWorkPackSignerRole,
  actorUid: string,
  options: Readonly<{ enforceCaptureActor?: boolean }> = {},
): CreditexActivityWorkPackSignerBindingProjection {
    if (role.identitySource === "manual_verified") {
      return fail(
        "WORK_PACK_MANUAL_VERIFIED_SIGNER_UNSUPPORTED",
        409,
        "This signer role needs a governed identity-evidence prompt before it can be published or signed.",
      );
    }
    const customer = envelope.prefill.customerSnapshot;
    const assignment = envelope.prefill.assignmentContext;
    const installer = envelope.prefill.installerBusinessContext;
    const signerUid = role.identitySource === "authenticated_actor"
      ? actorUid
      : role.identitySource === "assigned_worker"
        ? assignment.memberUid
        : "";
    if (role.identitySource === "assigned_worker" && !signerUid) {
      return fail(
        "WORK_PACK_ASSIGNED_SIGNER_REQUIRED",
        409,
        "Assign this job to an active worker before capturing its governed signature.",
      );
    }
    const actorIsAssignedWorker = actorUid === assignment.memberUid;
    const actorIsBusinessOwner = actorUid === installer.ownerUid;
    if (options.enforceCaptureActor
      && role.identitySource === "assigned_worker" && !actorIsAssignedWorker) {
      return fail(
        "WORK_PACK_ASSIGNED_SIGNER_ACTOR_MISMATCH",
        403,
        "Only the exact worker assigned to this job can capture the assigned-worker signature.",
      );
    }
    if (role.identitySource === "authenticated_actor"
      && !actorIsAssignedWorker && !actorIsBusinessOwner) {
      return fail(
        "WORK_PACK_AUTHENTICATED_SIGNER_CONTEXT_REQUIRED",
        409,
        "The signed-in actor has no exact governed identity in this work-pack context.",
      );
    }
    const source = role.identitySource === "customer_context"
      ? {
        fullName: `${customer.firstName} ${customer.lastName}`.trim(),
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        customerId: customer.customerId,
        siteId: customer.siteId,
        contactId: customer.contactId,
        address: [customer.addressLine1, customer.addressLine2,
          customer.suburb, customer.state, customer.postcode]
          .filter(Boolean).join(", "),
        postcode: customer.postcode,
        memberId: "",
        uid: "",
        role: "customer",
      }
      : role.identitySource === "assigned_worker" || actorIsAssignedWorker
        ? {
          fullName: assignment.displayName
            || `${assignment.firstName} ${assignment.lastName}`.trim(),
          firstName: assignment.firstName,
          lastName: assignment.lastName,
          phone: assignment.phone,
          email: assignment.email,
          customerId: "",
          siteId: "",
          contactId: "",
          address: "",
          postcode: "",
          memberId: assignment.memberId,
          uid: assignment.memberUid,
          role: assignment.role,
        }
        : {
          fullName: installer.contactName,
          firstName: installer.contactName,
          lastName: "",
          phone: installer.phone,
          email: installer.email,
          customerId: "",
          siteId: "",
          contactId: "",
          address: "",
          postcode: "",
          memberId: "",
          uid: installer.ownerUid,
          role: "business_owner",
        };
    const knownFields: Record<string, string> = {
      full_name: source.fullName,
      name: source.fullName,
      first_name: source.firstName,
      last_name: source.lastName,
      surname: source.lastName,
      phone: source.phone,
      mobile: source.phone,
      email: source.email,
      customer_id: source.customerId,
      site_id: source.siteId,
      contact_id: source.contactId,
      address: source.address,
      postcode: source.postcode,
      member_id: source.memberId,
      uid: source.uid,
      role: source.role,
    };
    const fields: Record<string, string> = {};
    for (const requirement of role.identityRequirements) {
      const canonicalKey = requirement.fieldKey.toLowerCase().replaceAll("-", "_");
      if (!(canonicalKey in knownFields)) {
        return fail(
          "WORK_PACK_SIGNER_IDENTITY_FIELD_UNSUPPORTED",
          409,
          "A governed signer identity field has no authoritative server source.",
        );
      }
      const value = knownFields[canonicalKey];
      if (requirement.required && !value.trim()) {
        return fail(
          "WORK_PACK_SIGNER_IDENTITY_INCOMPLETE",
          409,
          "The authoritative signer record is missing a required governed identity field.",
        );
      }
      fields[requirement.fieldKey] = value;
    }
    return Object.freeze({
      roleKey: role.roleKey,
      capacity: role.capacity,
      identitySource: role.identitySource,
      signerUid,
      signerName: source.fullName,
      fields: Object.freeze(fields),
    });
}

function responseWithBoundPackets(
  response: CreditexActivityWorkPackResponse,
  workPack: CreditexActivityWorkPack,
  signatures: readonly CreditexActivityWorkPackSignatureProjection[],
  artifacts: readonly CreditexActivityWorkPackArtifactProjection[],
  bindings: Readonly<{
    definitionSha256: string;
    prefillSha256: string;
    responseSha256: string;
    declarationsSha256: string;
  }>,
) {
  const activeSignatures = signatures.filter((candidate) =>
    candidate.action === "captured"
    && candidate.definitionSha256 === bindings.definitionSha256
    && candidate.prefillSha256 === bindings.prefillSha256
    && candidate.responseSha256 === bindings.responseSha256
    && candidate.declarationsSha256 === bindings.declarationsSha256
  );
  const answers = { ...response.answers };
  const repeatableSections = Object.fromEntries(Object.entries(
    response.repeatableSections,
  ).map(([sectionKey, instances]) => [sectionKey, instances.map((instance) => ({
    instanceKey: instance.instanceKey,
    answers: { ...instance.answers },
  }))]));
  for (const section of workPack.sections) {
    for (const prompt of section.prompts) {
      if (
        prompt.type !== "signature"
        && prompt.type !== "photo"
        && prompt.type !== "document"
      ) continue;
      if (section.repeatability) {
        for (const instance of repeatableSections[section.sectionKey] || []) {
          const expandedKey =
            `${section.sectionKey}[${instance.instanceKey}].${prompt.promptKey}`;
          const packetIds = prompt.type === "signature"
            ? activeSignatures.filter((signature) =>
              signature.promptKey === expandedKey
              && signature.signerRole === prompt.signerRoleKey
            ).map((signature) => signature.id)
            : artifacts.filter((artifact) =>
              artifact.promptKey === expandedKey
              && artifact.artifactKind === prompt.type
            ).map((artifact) => artifact.id);
          if (packetIds.length) instance.answers[prompt.promptKey] = packetIds;
        }
      } else {
        const packetIds = prompt.type === "signature"
          ? activeSignatures.filter((signature) =>
            signature.promptKey === prompt.promptKey
            && signature.signerRole === prompt.signerRoleKey
          ).map((signature) => signature.id)
          : artifacts.filter((artifact) =>
            artifact.promptKey === prompt.promptKey
            && artifact.artifactKind === prompt.type
          ).map((artifact) => artifact.id);
        if (packetIds.length) answers[prompt.promptKey] = packetIds;
      }
    }
  }
  return {
    ...response,
    answers,
    repeatableSections,
  } satisfies CreditexActivityWorkPackResponse;
}

async function projectAssignedInstance(
  database: D1Database,
  row: WorkPackInstanceRecord,
  actorUid: string,
): Promise<CreditexAssignedActivityWorkPackProjection> {
  await ensureCreditexWorkPackSchemaGuards(database);
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved, {
    allowStaleExecutionContext: true,
  });
  const [
    signatures,
    artifacts,
    customerContext,
    executionContexts,
    referenceDocuments,
    finalRecord,
  ] = await Promise.all([
    instanceSignatures(database, row),
    instanceArtifacts(database, row),
    loadServerCustomerContext(database, {
      ownerUid: row.installer_uid,
      workOrderId: row.work_order_id,
    }),
    loadServerExecutionContexts(database, {
      organisationId: row.organisation_id,
      ownerUid: row.installer_uid,
      workOrderId: row.work_order_id,
    }),
    instanceReferenceDocuments(
      database,
      row,
      resolved.workPack,
      envelope.response,
    ),
    instanceFinalRecord(database, row),
  ]);
  if (
    creditexCanonicalSha256(envelope.prefill.customerContext)
      !== creditexCanonicalSha256(customerContext.envelope)
    || creditexCanonicalSha256(envelope.prefill.customerSnapshot)
      !== creditexCanonicalSha256(customerContext.snapshot)
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_STALE",
      409,
      "The work-pack customer context changed. Reload before continuing.",
    );
  }
  const executionContextStale =
    creditexCanonicalSha256(envelope.prefill.providerContext)
      !== creditexCanonicalSha256(executionContexts.providerContext)
    || creditexCanonicalSha256(envelope.prefill.installerBusinessContext)
      !== creditexCanonicalSha256(executionContexts.installerBusinessContext)
    || creditexCanonicalSha256(envelope.prefill.assignmentContext)
      !== creditexCanonicalSha256(executionContexts.assignmentContext)
    || creditexCanonicalSha256(envelope.prefill.jobContext)
      !== creditexCanonicalSha256(executionContexts.jobContext);
  const dependencies = await resolveServerDependencies(
    database,
    row,
    resolved.workPack,
    Object.fromEntries(Object.entries(envelope.response.dependencyResolutions)
      .map(([dependencyKey, resolution]) => [dependencyKey, {
        referenceIds: resolution.referenceIds,
      }])),
  );
  const liveResponse = validateResponseValues(resolved.workPack, Object.freeze({
    ...envelope.response,
    dependencyResolutions: dependencies.resolutions,
  }));
  const completionResponse = responseWithBoundPackets(
    liveResponse,
    resolved.workPack,
    signatures,
    artifacts,
    {
      definitionSha256: envelope.definitionSha256,
      prefillSha256: envelope.prefillSha256,
      responseSha256: envelope.responseSha256,
      declarationsSha256: envelope.declarationsSha256,
    },
  );
  const evaluatedCompletion = creditexActivityWorkPackCompletion({
    workPack: resolved.workPack,
    response: completionResponse,
  });
  const completion = executionContextStale
    ? Object.freeze({
      ...evaluatedCompletion,
      ready: false,
      blockers: Object.freeze([
        ...evaluatedCompletion.blockers,
        Object.freeze({
          code: "WORK_PACK_EXECUTION_CONTEXT_STALE",
          key: "executionContext",
          message:
            "The provider, installer business, assigned technician or job identity changed. Refresh the governed work-pack revision before signing.",
        }),
      ]),
    })
    : evaluatedCompletion;
  const finalisationSha256 = envelope.finalisation
    ? creditexCanonicalSha256(envelope.finalisation)
    : "";
  return Object.freeze({
    instance: Object.freeze({
      id: row.id,
      instanceKey: row.instance_key,
      caseId: row.compliance_case_id,
      workOrderId: row.work_order_id,
      complianceIntentId: row.compliance_intent_id,
      workPackVersionId: row.work_pack_version_id,
      compositionLockId: row.manual_policy_composition_lock_id,
      compositionSha256: row.manual_policy_composition_sha256,
      activityDate: row.activity_date,
      revision: Number(row.revision),
      supersedesInstanceId: row.supersedes_instance_id,
      status: instanceStatus(row.status),
      responseSha256: row.response_sha256,
      createdAt: row.created_at,
    }),
    signatureBindings: Object.freeze({
      definitionSha256: envelope.definitionSha256,
      prefillSha256: envelope.prefillSha256,
      responseSha256: envelope.responseSha256,
      declarationsSha256: envelope.declarationsSha256,
    }),
    signerBindings: signerBindingsForInstance(envelope, resolved.workPack, actorUid),
    definition: Object.freeze({
      id: resolved.id,
      title: resolved.title,
      activityVersionId: resolved.activityVersionId,
      activityTemplateId: resolved.activityTemplateId,
      version: resolved.version,
      schemaSha256: resolved.schemaSha256,
      effectiveFrom: resolved.effectiveFrom,
      effectiveTo: resolved.effectiveTo,
      schema: resolved.workPack,
    }),
    // Project the same server-bound packet view that drives completion so the
    // offline client cannot disagree with the authoritative completion result.
    response: Object.freeze(completionResponse),
    completion,
    signatures: Object.freeze(signatures),
    artifacts: Object.freeze(artifacts),
    calculatorOutputs: dependencies.calculatorOutputs,
    calculatorPendingReviews: dependencies.calculatorPendingReviews,
    referenceDocuments,
    finalRecord,
    protectedCustomer:
      row.source_type === "opportunity" || row.customer_source === "platform_private",
    customerContextBinding: envelope.prefill.customerContext,
    customerContext: customerContext.projection,
    executionContextStale,
    executionContext: Object.freeze({
      provider: envelope.prefill.providerContext,
      installerBusiness: envelope.prefill.installerBusinessContext,
      assignment: envelope.prefill.assignmentContext,
      job: envelope.prefill.jobContext,
    }),
    artifactHook: Object.freeze({
      contract: CREDITEX_ACTIVITY_WORK_PACK_ARTIFACT_HOOK_CONTRACT,
      status: finalRecord
        ? "retained"
        : row.status === "completed"
          ? "generation_required"
        : "not_ready",
      finalisationSha256,
    }),
  });
}

export async function loadAssignedCreditexActivityWorkPack(
  database: D1Database,
  input: CreditexWorkPackTradeScope & { caseInstanceId: string },
) {
  const row = await assignedInstanceRow(
    database,
    input,
    text(
      input.caseInstanceId,
      240,
      "WORK_PACK_INSTANCE_REQUIRED",
      "Work-pack instance",
    ),
  );
  return projectAssignedInstance(database, row, input.actorUid);
}

export async function listAssignedCreditexActivityWorkPacks(
  database: D1Database,
  input: CreditexWorkPackTradeScope & { workOrderIds?: readonly string[] },
) {
  await ensureCreditexWorkPackSchemaGuards(database);
  const workOrderIds = [...new Set((input.workOrderIds || [])
    .map((item) => optionalText(item, 180))
    .filter(Boolean))];
  if (workOrderIds.length > 500) {
    return fail(
      "WORK_PACK_LIST_TOO_LARGE",
      409,
      "Load at most 500 assigned jobs in one work-pack request.",
    );
  }
  const workOrderFilter = workOrderIds.length
    ? `AND instance.work_order_id IN (${workOrderIds.map(() => "?").join(",")})`
    : "";
  const rows = await database.prepare(`SELECT instance.*,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      compliance_case.evidence_policy_version_id,
      compliance_case.installer_uid,
      work_order.source_type, work_order.assignee_member_id,
      work_order.revision work_order_revision,
      CASE
        WHEN work_order.assignee_member_id = '' THEN work_order.firebase_uid
        ELSE COALESCE(assigned_member.member_uid, '')
      END assigned_worker_uid,
      COALESCE(job_detail.customer_source, '') customer_source
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
      AND compliance_case.work_order_id = instance.work_order_id
    JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
      AND work_order.firebase_uid = ?
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id
      AND job_detail.firebase_uid = work_order.firebase_uid
    LEFT JOIN trade_team_members assigned_member
      ON assigned_member.id = work_order.assignee_member_id
      AND assigned_member.owner_uid = work_order.firebase_uid
      AND assigned_member.status = 'active'
    WHERE (? = 'team' OR work_order.assignee_member_id = ?)
      ${workOrderFilter}
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.compliance_case_id = instance.compliance_case_id
          AND newer.revision > instance.revision
      )
    ORDER BY instance.work_order_id, instance.activity_date,
      instance.compliance_case_id
    LIMIT 6000`)
    .bind(
      input.ownerUid,
      input.scope,
      input.actorMemberId,
      ...workOrderIds,
    )
    .all<WorkPackInstanceRecord>();
  if (rows.results.length >= 6000) {
    return fail(
      "WORK_PACK_LIST_CARDINALITY_EXCEEDED",
      409,
      "The assigned work-pack list is too large for one safe response.",
    );
  }
  const projections: CreditexAssignedActivityWorkPackProjection[] = [];
  for (const row of rows.results) {
    projections.push(await projectAssignedInstance(database, row, input.actorUid));
  }
  return Object.freeze(projections);
}

export type CreditexWorkPackSectionPatch = Readonly<{
  sectionKey: string;
  repeatInstanceKey?: string;
  remove?: boolean;
  answers?: Readonly<Record<string, unknown>>;
}>;

export type CreditexWorkPackReferenceAcknowledgementInput = Readonly<{
  sectionKey: string;
  repeatInstanceKey?: string;
  promptKey: string;
  sourceArtifactId: string;
  acknowledgedAt: string;
}>;

export type CreditexWorkPackDependencyInput = Readonly<{
  referenceIds: readonly string[];
}>;

export type CreditexWorkPackOfficialProductSelectionInput = Readonly<{
  selectionId: string;
  snapshotId: string;
  quantity: number;
}>;

export type CreditexWorkPackMutationIdempotency = Readonly<{
  clientActionId: string;
  deviceId: string;
  payloadHash: string;
}>;

export type CreditexWorkPackMutationResult = Readonly<{
  status: "applied" | "duplicate";
  action:
    | "work_pack_commit"
    | "work_pack_prepare_signing"
    | "work_pack_capture_signatures"
    | "work_pack_finalize"
    | "work_pack_update_customer_context"
    | "work_pack_refresh_execution_context"
    | "work_pack_select_scenario"
    | "work_pack_select_official_products"
    | "work_pack_run_calculator";
  projection: CreditexAssignedActivityWorkPackProjection;
}>;

function responsePrompt(
  workPack: CreditexActivityWorkPack,
  sectionKeyValue: unknown,
  repeatInstanceKeyValue: unknown,
  promptKeyValue: unknown,
) {
  const sectionKey = text(
    sectionKeyValue,
    180,
    "WORK_PACK_SECTION_REQUIRED",
    "Work-pack section",
  );
  const repeatInstanceKey = optionalText(repeatInstanceKeyValue, 180);
  const promptKey = text(
    promptKeyValue,
    180,
    "WORK_PACK_PROMPT_REQUIRED",
    "Work-pack prompt",
  );
  const section = workPack.sections.find((candidate) =>
    candidate.sectionKey === sectionKey
  );
  const prompt = section?.prompts.find((candidate) =>
    candidate.promptKey === promptKey
  );
  if (!section || !prompt) {
    return fail(
      "WORK_PACK_PROMPT_UNKNOWN",
      400,
      "The response refers to a prompt outside this exact work-pack version.",
    );
  }
  if (Boolean(section.repeatability) !== Boolean(repeatInstanceKey)) {
    return fail(
      "WORK_PACK_REPEAT_INSTANCE_INVALID",
      400,
      section.repeatability
        ? "This section response needs a repeat-item key."
        : "This section is not repeatable.",
    );
  }
  if (
    repeatInstanceKey
    && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(repeatInstanceKey)
  ) {
    return fail(
      "WORK_PACK_REPEAT_INSTANCE_INVALID",
      400,
      "The repeat-item key is invalid.",
    );
  }
  return Object.freeze({
    section,
    prompt,
    sectionKey,
    repeatInstanceKey,
    promptKey,
    responseKey: repeatInstanceKey
      ? `${sectionKey}[${repeatInstanceKey}].${promptKey}`
      : promptKey,
  });
}

function responsePromptIsVisible(
  response: CreditexActivityWorkPackResponse,
  location: ReturnType<typeof responsePrompt>,
) {
  if (!creditexActivityWorkPackVisibilityMatches(
    location.section.visibility,
    response.answers,
  )) return false;
  const instanceAnswers = location.repeatInstanceKey
    ? response.repeatableSections[location.sectionKey]?.find((instance) =>
        instance.instanceKey === location.repeatInstanceKey
      )?.answers
    : response.answers;
  if (!instanceAnswers) return false;
  return creditexActivityWorkPackVisibilityMatches(
    location.prompt.visibility,
    response.answers,
    instanceAnswers,
  );
}

function requireVisibleResponsePrompt(
  response: CreditexActivityWorkPackResponse,
  location: ReturnType<typeof responsePrompt>,
) {
  if (!responsePromptIsVisible(response, location)) {
    return fail(
      "WORK_PACK_PROMPT_NOT_VISIBLE",
      409,
      "This work-pack step is not currently visible and cannot accept evidence or an acknowledgement.",
    );
  }
}

function hasResponseValue(value: unknown) {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function validPromptValue(prompt: CreditexWorkPackPrompt, answer: unknown) {
  if (!hasResponseValue(answer)) return true;
  if (prompt.type === "text" || prompt.type === "textarea") {
    return typeof answer === "string"
      && (prompt.minimumLength === null || answer.length >= prompt.minimumLength)
      && (prompt.maximumLength === null || answer.length <= prompt.maximumLength);
  }
  if (prompt.type === "number") {
    if (typeof answer !== "number" || !Number.isFinite(answer)) return false;
    if (prompt.minimumNumber !== null && answer < prompt.minimumNumber) return false;
    if (prompt.maximumNumber !== null && answer > prompt.maximumNumber) return false;
    if (prompt.numberStep !== null) {
      const origin = prompt.minimumNumber ?? 0;
      const quotient = (answer - origin) / prompt.numberStep;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return false;
    }
    return true;
  }
  if (prompt.type === "date") {
    return typeof answer === "string" && ISO_DATE_PATTERN.test(answer)
      && !Number.isNaN(Date.parse(`${answer}T00:00:00Z`));
  }
  if (prompt.type === "select") {
    return typeof answer === "string"
      && prompt.options.some((option) => option.value === answer);
  }
  if (prompt.type === "multiselect") {
    if (!Array.isArray(answer) || answer.some((item) => typeof item !== "string")) {
      return false;
    }
    const values = answer as string[];
    return new Set(values).size === values.length
      && (prompt.minimumSelections === null
        || values.length >= prompt.minimumSelections)
      && (prompt.maximumSelections === null
        || values.length <= prompt.maximumSelections)
      && values.every((item) =>
        prompt.options.some((option) => option.value === item)
      );
  }
  if (prompt.type === "checkbox") return answer === true;
  if (prompt.type === "reference_document") {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
    const acknowledgement = answer as Record<string, unknown>;
    return acknowledgement.contract
        === CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT
      && acknowledgement.sourceBindingTargetKey
        === prompt.referenceDocument?.sourceBindingTargetKey
      && typeof acknowledgement.sourceArtifactId === "string"
      && /^[0-9a-f]{64}$/.test(String(acknowledgement.sourceArtifactSha256 || ""))
      && acknowledgement.acknowledgementMode
        === prompt.referenceDocument?.acknowledgementMode
      && acknowledgement.acknowledged === true
      && ISO_INSTANT_PATTERN.test(String(acknowledgement.acknowledgedAt || ""));
  }
  // File and signature answers are server-bound custody IDs, never client values.
  return false;
}

function validateResponseValues(
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
) {
  const ordinarySections = workPack.sections.filter((section) =>
    !section.repeatability
  );
  const ordinaryPrompts = new Map(ordinarySections.flatMap((section) =>
    section.prompts.map((prompt) => [prompt.promptKey, prompt] as const)
  ));
  for (const [key, answer] of Object.entries(response.answers)) {
    const prompt = ordinaryPrompts.get(key);
    if (!prompt) {
      return fail(
        "WORK_PACK_RESPONSE_KEY_UNKNOWN",
        400,
        "The response contains a field outside this exact work-pack version.",
      );
    }
    if (!validPromptValue(prompt, answer)) {
      return fail(
        "WORK_PACK_RESPONSE_VALUE_INVALID",
        400,
        `${prompt.label} has an invalid response.`,
      );
    }
  }
  const repeatSections = new Map(workPack.sections.filter((section) =>
    section.repeatability
  ).map((section) => [section.sectionKey, section]));
  for (const [sectionKey, instances] of Object.entries(
    response.repeatableSections,
  )) {
    const section = repeatSections.get(sectionKey);
    if (!section) {
      return fail(
        "WORK_PACK_REPEAT_SECTION_UNKNOWN",
        400,
        "The response contains a repeatable section outside this work-pack version.",
      );
    }
    const promptMap = new Map(section.prompts.map((prompt) =>
      [prompt.promptKey, prompt]
    ));
    if (
      instances.length > (section.repeatability?.maximumInstances || 0)
      || new Set(instances.map((instance) => instance.instanceKey)).size
        !== instances.length
    ) {
      return fail(
        "WORK_PACK_REPEATABLE_SECTION_INVALID",
        400,
        `${section.title} has too many or duplicate items.`,
      );
    }
    for (const instance of instances) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(instance.instanceKey)) {
        return fail(
          "WORK_PACK_REPEAT_INSTANCE_INVALID",
          400,
          "A repeat-item key is invalid.",
        );
      }
      for (const [key, answer] of Object.entries(instance.answers)) {
        const prompt = promptMap.get(key);
        if (!prompt || !validPromptValue(prompt, answer)) {
          return fail(
            "WORK_PACK_RESPONSE_VALUE_INVALID",
            400,
            prompt
              ? `${prompt.label} has an invalid response.`
              : "A repeat-item response is outside this work-pack version.",
          );
        }
      }
    }
  }
  return response;
}

function patchResponse(
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
  patches: readonly CreditexWorkPackSectionPatch[],
) {
  const answers = { ...response.answers };
  const repeatableSections = Object.fromEntries(Object.entries(
    response.repeatableSections,
  ).map(([sectionKey, instances]) => [sectionKey, instances.map((instance) => ({
    instanceKey: instance.instanceKey,
    answers: { ...instance.answers },
  }))]));
  if (patches.length > 100) {
    return fail(
      "WORK_PACK_PATCH_LIMIT",
      413,
      "Save at most 100 work-pack section changes at once.",
    );
  }
  for (const patch of patches) {
    const sectionKey = text(
      patch.sectionKey,
      180,
      "WORK_PACK_SECTION_REQUIRED",
      "Work-pack section",
    );
    const section = workPack.sections.find((candidate) =>
      candidate.sectionKey === sectionKey
    );
    if (!section) {
      return fail(
        "WORK_PACK_SECTION_UNKNOWN",
        400,
        "The response refers to a section outside this work-pack version.",
      );
    }
    const repeatInstanceKey = optionalText(patch.repeatInstanceKey, 180);
    const patchAnswers = object(
      patch.answers || {},
      "WORK_PACK_PATCH_INVALID",
      "Work-pack section answers must be an object.",
    );
    if (section.repeatability) {
      if (!repeatInstanceKey
        || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(repeatInstanceKey)) {
        return fail(
          "WORK_PACK_REPEAT_INSTANCE_INVALID",
          400,
          "This repeatable section needs a valid item key.",
        );
      }
      const instances = repeatableSections[sectionKey] || [];
      const index = instances.findIndex((instance) =>
        instance.instanceKey === repeatInstanceKey
      );
      if (patch.remove) {
        if (index >= 0) instances.splice(index, 1);
        continue;
      }
      const target = index >= 0
        ? instances[index]
        : { instanceKey: repeatInstanceKey, answers: {} };
      if (index < 0) instances.push(target);
      for (const [promptKey, answer] of Object.entries(patchAnswers)) {
        const prompt = section.prompts.find((candidate) =>
          candidate.promptKey === promptKey
        );
        if (!prompt) {
          return fail(
            "WORK_PACK_PROMPT_UNKNOWN",
            400,
            "The response refers to a prompt outside this work-pack version.",
          );
        }
        if (["signature", "photo", "document", "reference_document"].includes(
          prompt.type,
        )) {
          return fail(
            "WORK_PACK_GOVERNED_RESPONSE_REQUIRED",
            400,
            "Signatures, files and governed document acknowledgements must use their dedicated custody actions.",
          );
        }
        if (answer === null || answer === "") delete target.answers[promptKey];
        else target.answers[promptKey] = answer;
      }
      repeatableSections[sectionKey] = instances;
    } else {
      if (repeatInstanceKey || patch.remove) {
        return fail(
          "WORK_PACK_REPEAT_INSTANCE_INVALID",
          400,
          "This work-pack section is not repeatable.",
        );
      }
      for (const [promptKey, answer] of Object.entries(patchAnswers)) {
        const prompt = section.prompts.find((candidate) =>
          candidate.promptKey === promptKey
        );
        if (!prompt) {
          return fail(
            "WORK_PACK_PROMPT_UNKNOWN",
            400,
            "The response refers to a prompt outside this work-pack version.",
          );
        }
        if (["signature", "photo", "document", "reference_document"].includes(
          prompt.type,
        )) {
          return fail(
            "WORK_PACK_GOVERNED_RESPONSE_REQUIRED",
            400,
            "Signatures, files and governed document acknowledgements must use their dedicated custody actions.",
          );
        }
        if (answer === null || answer === "") delete answers[promptKey];
        else answers[promptKey] = answer;
      }
    }
  }
  return validateResponseValues(workPack, Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT,
    schemaSha256: response.schemaSha256,
    answers: Object.freeze(answers),
    repeatableSections: Object.freeze(repeatableSections),
    dependencyResolutions: response.dependencyResolutions,
  }));
}

function uniqueReferenceIds(value: readonly string[] | undefined) {
  const ids = [...new Set((value || []).map((item) => optionalText(item, 180))
    .filter(Boolean))];
  if (ids.length > 100) {
    return fail(
      "WORK_PACK_DEPENDENCY_REFERENCE_LIMIT",
      413,
      "A work-pack dependency has too many references.",
    );
  }
  return ids;
}

type CalculatorGoldenVectorRecord = {
  id: string;
  vector_key: string;
  input_snapshot: string;
  expected_output: string;
  tolerance_snapshot: string;
  source_citation: string;
};

type CalculatorRunRecord = {
  id: string;
  case_revision: number;
  current_case_revision: number;
  input_snapshot: string;
  output_snapshot: string;
  status: string;
  run_by_uid: string;
  run_at: string;
  verified_by_uid: string;
  verified_at: string;
  calculator_version_id: string;
  calculator_key: string;
  calculator_version: number;
  calculator_source_sha256: string;
  calculator_specification: string;
  calculator_output_type: string;
  calculator_approval_state: string;
  primary_approver_uid: string;
  secondary_approver_uid: string;
  calculator_approved_at: string;
  review_id?: string;
  review_decision?: string;
  review_input_sha256?: string;
  review_output_sha256?: string;
  review_engine_receipt_id?: string;
  reviewer_uid?: string;
  reviewed_at?: string;
};

type CalculatorEngineReceiptRecord = {
  id: string;
  engine_contract_hash: string;
  golden_vector_suite_sha256: string;
  engine_suite_hash: string;
  suite_receipt_hash: string;
  vector_count: number;
  result: string;
  executed_by_uid: string;
  executed_at: string;
};

type CalculatorExecutionBasis = Readonly<{
  calculatorVersionId: string;
  calculatorVersion: number;
  calculatorSourceSha256: string;
  specification: CreditexCalculatorSpecification;
  engineReceipt: CalculatorEngineReceiptRecord;
  engineContractSha256: string;
  goldenVectorSuiteSha256: string;
}>;

type ResolvedServerDependencies = Readonly<{
  resolutions: CreditexActivityWorkPackResponse["dependencyResolutions"];
  calculatorOutputs: readonly CreditexActivityWorkPackCalculatorOutputProjection[];
  calculatorPendingReviews:
    readonly CreditexActivityWorkPackCalculatorPendingReviewProjection[];
}>;

type DependencySourceIdentity = Readonly<{
  bindingId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  citationLocation: string;
}>;

async function approvedDependencySourceIdentity(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  dependency: CreditexWorkPackDependency,
) {
  const records = await database.prepare(`SELECT binding.id,
      binding.source_artifact_id, binding.source_artifact_sha256,
      binding.citation_location
    FROM compliance_activity_work_pack_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.source_artifact_id
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.sha256 = binding.source_artifact_sha256
    JOIN compliance_official_source_review_decisions decision
      ON decision.organisation_id = artifact.organisation_id
      AND decision.subject_type = 'artifact'
      AND decision.subject_id = artifact.id
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE binding.organisation_id = ?
      AND binding.work_pack_version_id = ?
      AND binding.schema_sha256 = ?
      AND binding.source_role = ?
      AND binding.target_key = ?
      AND binding.binding_state = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = decision.id
      )
    ORDER BY binding.id, binding.source_artifact_id`)
    .bind(
      row.organisation_id,
      row.work_pack_version_id,
      creditexActivityWorkPackSha256(workPack),
      dependency.kind,
      dependency.dependencyKey,
    )
    .all<Record<string, unknown>>();
  if (!records.results.length) {
    return fail(
      "WORK_PACK_DEPENDENCY_SOURCE_REQUIRED",
      409,
      "This dependency has no exact independently approved official source binding.",
    );
  }
  return Object.freeze(records.results.map((record) => Object.freeze({
    bindingId: String(record.id),
    sourceArtifactId: String(record.source_artifact_id),
    sourceArtifactSha256: bareSha256(String(record.source_artifact_sha256)),
    citationLocation: String(record.citation_location),
  }))) satisfies readonly DependencySourceIdentity[];
}

function scenarioResolutionSha256(input: Readonly<{
  row: WorkPackInstanceRecord;
  dependencyKey: string;
  scenarioCode: string;
  sourceBindings: readonly DependencySourceIdentity[];
}>) {
  return creditexCanonicalSha256({
    contract: "creditex-work-pack-scenario-resolution/v2",
    workPackVersionId: input.row.work_pack_version_id,
    dependencyKey: input.dependencyKey,
    caseId: input.row.compliance_case_id,
    activityVersionId: input.row.activity_version_id,
    activityDate: input.row.activity_date,
    scenarioCode: input.scenarioCode,
    sourceBindings: input.sourceBindings,
  });
}

function storedJson(value: unknown) {
  try {
    return JSON.parse(String(value || "")) as unknown;
  } catch {
    return null;
  }
}

async function currentCalculatorGoldenVectorSuite(
  database: D1Database,
  calculatorVersionId: string,
  specification: unknown,
) {
  const result = await database.prepare(`SELECT id, vector_key,
      input_snapshot, expected_output, tolerance_snapshot, source_citation
    FROM compliance_calculator_test_vectors
    WHERE calculator_version_id = ?
    ORDER BY vector_key, id`)
    .bind(calculatorVersionId)
    .all<CalculatorGoldenVectorRecord>();
  if (!result.results.length) return null;
  const parsed = result.results.map((vector) => Object.freeze({
    id: String(vector.id),
    vectorKey: String(vector.vector_key),
    inputSnapshot: storedJson(vector.input_snapshot),
    expectedOutput: storedJson(vector.expected_output),
    toleranceSnapshot: storedJson(vector.tolerance_snapshot),
    sourceCitation: String(vector.source_citation || ""),
  }));
  if (parsed.some((vector) =>
    vector.inputSnapshot === null
    || vector.expectedOutput === null
    || vector.toleranceSnapshot === null
    || !vector.sourceCitation
  )) return null;
  try {
    const execution = runCreditexCalculatorTestSuite(
      specification,
      parsed.map((vector) => ({
        key: vector.vectorKey,
        inputs: vector.inputSnapshot,
        expected: vector.expectedOutput,
      })),
    );
    if (!execution.passed) return null;
    return Object.freeze({
      count: parsed.length,
      suiteSha256: bareSha256(creditexCanonicalSha256(parsed)),
      execution,
    });
  } catch {
    return null;
  }
}

async function currentCalculatorEngineReceipt(
  database: D1Database,
  input: Readonly<{
    organisationId: string;
    calculatorVersionId: string;
    calculatorVersion: number;
    specification: CreditexCalculatorSpecification;
    golden: NonNullable<Awaited<ReturnType<typeof currentCalculatorGoldenVectorSuite>>>;
  }>,
) {
  const engineContractSha256 = creditexCalculatorEngineContractHash(
    input.specification,
  );
  const receipt = await database.prepare(`SELECT id,
      engine_contract_hash, golden_vector_suite_sha256, engine_suite_hash,
      suite_receipt_hash, vector_count, result, executed_by_uid, executed_at
    FROM compliance_calculator_engine_receipts
    WHERE organisation_id = ? AND calculator_version_id = ?
      AND calculator_version_number = ?
      AND engine_contract_id = ? AND engine_contract_hash = ?
      AND golden_vector_suite_sha256 = ? AND suite_receipt_schema = ?
      AND engine_suite_hash = ? AND suite_receipt_hash = ?
      AND vector_count = ? AND result = 'passed'
    ORDER BY executed_at DESC, id DESC
    LIMIT 1`)
    .bind(
      input.organisationId,
      input.calculatorVersionId,
      input.calculatorVersion,
      CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
      engineContractSha256,
      input.golden.suiteSha256,
      CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
      input.golden.execution.suiteHash,
      input.golden.execution.receiptHash,
      input.golden.count,
    )
    .first<CalculatorEngineReceiptRecord>();
  if (
    !receipt
    || receipt.result !== "passed"
    || Number(receipt.vector_count) !== input.golden.count
    || !receipt.executed_by_uid
    || !receipt.executed_at
    || Number.isNaN(Date.parse(receipt.executed_at))
  ) return null;
  return Object.freeze({ receipt, engineContractSha256 });
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

async function assignedCalculatorExecutionBasis(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  dependency: Extract<CreditexWorkPackDependency, { kind: "calculator" }>,
): Promise<CalculatorExecutionBasis> {
  const sourceBindings = await approvedDependencySourceIdentity(
    database,
    row,
    workPack,
    dependency,
  );
  const candidates = await database.prepare(`SELECT id, version,
      calculator_key, specification, official_source_sha256,
      approval_state, primary_approver_uid, secondary_approver_uid, approved_at
    FROM compliance_calculator_versions
    WHERE organisation_id = ? AND activity_version_id = ?
      AND calculator_key = ? AND version = ? AND approval_state = 'approved'
    ORDER BY version DESC, id
    LIMIT 25`)
    .bind(
      row.organisation_id,
      row.activity_version_id,
      dependency.calculatorKey,
      dependency.calculatorVersion,
    )
    .all<Record<string, unknown>>();
  const valid: CalculatorExecutionBasis[] = [];
  for (const candidate of candidates.results) {
    const calculatorVersionId = String(candidate.id || "");
    const calculatorVersion = Number(candidate.version || 0);
    const calculatorSourceSha256 = bareSha256(String(
      candidate.official_source_sha256 || "",
    ));
    if (
      !calculatorVersionId
      || !Number.isSafeInteger(calculatorVersion)
      || calculatorVersion < 1
      || String(candidate.primary_approver_uid || "") === ""
      || String(candidate.secondary_approver_uid || "") === ""
      || candidate.primary_approver_uid === candidate.secondary_approver_uid
      || Number.isNaN(Date.parse(String(candidate.approved_at || "")))
      || !sourceBindings.some((binding) =>
        binding.sourceArtifactSha256 === calculatorSourceSha256
      )
    ) continue;
    let specification: CreditexCalculatorSpecification;
    try {
      specification = validateCreditexCalculatorSpecification(
        storedJson(candidate.specification),
      );
    } catch {
      continue;
    }
    if (
      specification.key !== dependency.calculatorKey
      || specification.version !== dependency.calculatorVersion
      || calculatorVersion !== dependency.calculatorVersion
      || !sameStringSet(
        specification.inputs.map((input) => input.key),
        dependency.requiredInputKeys,
      )
    ) continue;
    try {
      await requireCurrentApprovedOfficialSourceBinding(
        database,
        row.organisation_id,
        "calculator",
        calculatorVersionId,
        calculatorSourceSha256,
      );
    } catch (error) {
      if (error instanceof CreditexSourceLookupReviewError) continue;
      throw error;
    }
    const golden = await currentCalculatorGoldenVectorSuite(
      database,
      calculatorVersionId,
      specification,
    );
    if (!golden) continue;
    const exactReceipt = await currentCalculatorEngineReceipt(database, {
      organisationId: row.organisation_id,
      calculatorVersionId,
      calculatorVersion,
      specification,
      golden,
    });
    if (!exactReceipt) continue;
    valid.push(Object.freeze({
      calculatorVersionId,
      calculatorVersion,
      calculatorSourceSha256,
      specification,
      engineReceipt: exactReceipt.receipt,
      engineContractSha256: exactReceipt.engineContractSha256,
      goldenVectorSuiteSha256: golden.suiteSha256,
    }));
  }
  if (valid.length !== 1) {
    return fail(
      valid.length ? "WORK_PACK_CALCULATOR_AMBIGUOUS" : "WORK_PACK_CALCULATOR_NOT_READY",
      409,
      valid.length
        ? "More than one exact approved calculator is effective for this activity. Creditex must resolve the governed version before field execution."
        : "This activity has no single exact approved calculator, official source, golden-vector suite and engine receipt ready for field execution.",
    );
  }
  return valid[0];
}

async function strictCalculatorOutput(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  dependency: Extract<CreditexWorkPackDependency, { kind: "calculator" }>,
  record: CalculatorRunRecord,
): Promise<CreditexActivityWorkPackCalculatorOutputProjection | null> {
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find((candidate) =>
    candidate.templateId === workPack.activityTemplateId
  );
  const program = activity
    ? GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
        candidate.programCode === activity.programCode
      )
    : undefined;
  const calculation = CREDITEX_CALCULATION_COVERAGE.find((candidate) =>
    candidate.activityTemplateId === workPack.activityTemplateId
  );
  if (!activity || !program || !calculation) return null;
  const inputSnapshot = storedJson(record.input_snapshot);
  const outputSnapshot = storedJson(record.output_snapshot);
  if (!inputSnapshot || typeof inputSnapshot !== "object" || Array.isArray(inputSnapshot)
    || !outputSnapshot || typeof outputSnapshot !== "object" || Array.isArray(outputSnapshot)) {
    return null;
  }
  let specification: ReturnType<typeof validateCreditexCalculatorSpecification>;
  let execution: ReturnType<typeof evaluateCreditexCalculator>;
  try {
    specification = validateCreditexCalculatorSpecification(
      storedJson(record.calculator_specification),
    );
    execution = evaluateCreditexCalculator(specification, inputSnapshot);
  } catch {
    return null;
  }
  const sourceSha256 = bareSha256(String(record.calculator_source_sha256 || ""));
  const engineContractSha256 = creditexCalculatorEngineContractHash(specification);
  const legacyVerified = record.status === "verified"
    && Boolean(record.verified_by_uid)
    && record.run_by_uid !== record.verified_by_uid
    && Boolean(record.verified_at)
    && !Number.isNaN(Date.parse(record.verified_at));
  const independentlyReviewed = record.status === "calculated"
    && record.review_decision === "approved"
    && Boolean(record.review_id)
    && Boolean(record.reviewer_uid)
    && record.run_by_uid !== record.reviewer_uid
    && Boolean(record.reviewed_at)
    && !Number.isNaN(Date.parse(String(record.reviewed_at)))
    && record.review_input_sha256 === creditexCanonicalSha256(inputSnapshot)
    && record.review_output_sha256 === creditexCanonicalSha256(outputSnapshot);
  const validIdentity = (legacyVerified || independentlyReviewed)
    && Number(record.case_revision) === Number(record.current_case_revision)
    && Number(record.current_case_revision) > 0
    && record.calculator_approval_state === "approved"
    && record.calculator_key === dependency.calculatorKey
    && specification.key === dependency.calculatorKey
    && calculation.formulaKey === dependency.catalogueFormulaKey
    && Number(record.calculator_version) === dependency.calculatorVersion
    && Number(record.calculator_version) === specification.version
    && Boolean(record.primary_approver_uid)
    && Boolean(record.secondary_approver_uid)
    && record.primary_approver_uid !== record.secondary_approver_uid
    && Boolean(record.calculator_approved_at)
    && !Number.isNaN(Date.parse(record.calculator_approved_at))
    && Boolean(record.run_by_uid)
    && Boolean(record.run_at)
    && !Number.isNaN(Date.parse(record.run_at))
    && dependency.requiredInputKeys.every((key) => key in inputSnapshot)
    && (record.calculator_output_type === "other"
      || record.calculator_output_type === specification.output.unit)
    && (program.outcomeClass !== "tradable_certificate"
      || execution.output.unit === program.claimOutputCode)
    && engineContractSha256 === execution.engineContractHash
    && execution.schemaVersion === CREDITEX_CALCULATOR_RECEIPT_SCHEMA
    && execution.engineVersion === CREDITEX_CALCULATOR_ENGINE_VERSION
    && creditexCanonicalSha256(outputSnapshot) === creditexCanonicalSha256(execution);
  if (!validIdentity) return null;
  try {
    await requireCurrentApprovedOfficialSourceBinding(
      database,
      row.organisation_id,
      "calculator",
      record.calculator_version_id,
      sourceSha256,
    );
  } catch (error) {
    if (error instanceof CreditexSourceLookupReviewError) return null;
    throw error;
  }
  const golden = await currentCalculatorGoldenVectorSuite(
    database,
    record.calculator_version_id,
    specification,
  );
  if (!golden
    || golden.execution.engineContractHash !== engineContractSha256) return null;
  const engineReceipt = await database.prepare(`SELECT id,
      engine_contract_hash, golden_vector_suite_sha256, engine_suite_hash,
      suite_receipt_hash, vector_count, result, executed_by_uid, executed_at
    FROM compliance_calculator_engine_receipts
    WHERE organisation_id = ? AND calculator_version_id = ?
      AND calculator_version_number = ?
      AND engine_contract_id = ? AND engine_contract_hash = ?
      AND golden_vector_suite_sha256 = ? AND suite_receipt_schema = ?
      AND engine_suite_hash = ? AND suite_receipt_hash = ?
      AND vector_count = ? AND result = 'passed'
    ORDER BY executed_at DESC, id DESC
    LIMIT 1`)
    .bind(
      row.organisation_id,
      record.calculator_version_id,
      Number(record.calculator_version),
      CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
      engineContractSha256,
      golden.suiteSha256,
      CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
      golden.execution.suiteHash,
      golden.execution.receiptHash,
      golden.count,
    )
    .first<CalculatorEngineReceiptRecord>();
  if (
    !engineReceipt
    || engineReceipt.result !== "passed"
    || Number(engineReceipt.vector_count) !== golden.count
    || !engineReceipt.executed_by_uid
    || !engineReceipt.executed_at
    || Number.isNaN(Date.parse(engineReceipt.executed_at))
    || (independentlyReviewed
      && record.review_engine_receipt_id !== engineReceipt.id)
  ) return null;
  return Object.freeze({
    dependencyKey: dependency.dependencyKey,
    catalogueFormulaKey: dependency.catalogueFormulaKey,
    outcomeClass: program.outcomeClass,
    claimOutputCode: program.claimOutputCode,
    claimOutputLabel: program.claimOutputLabel,
    calculationRunId: record.id,
    caseRevision: Number(record.case_revision),
    calculatorVersionId: record.calculator_version_id,
    calculatorKey: record.calculator_key,
    calculatorVersion: Number(record.calculator_version),
    calculatorSourceSha256: sourceSha256,
    quantity: execution.output.decimal,
    unit: execution.output.unit,
    outputSha256: execution.outputHash,
    executionReceiptSha256: execution.receiptHash,
    engineReceiptId: engineReceipt.id,
    engineContractSha256,
    goldenVectorSuiteSha256: golden.suiteSha256,
    engineSuiteReceiptSha256: engineReceipt.suite_receipt_hash,
    verifiedByUid: independentlyReviewed
      ? String(record.reviewer_uid)
      : record.verified_by_uid,
    verifiedAt: independentlyReviewed
      ? String(record.reviewed_at)
      : record.verified_at,
  });
}

const OFFICIAL_PRODUCT_SELECTION_PREFIX = "official-product-v1:";
const INELIGIBLE_OFFICIAL_PRODUCT_STATUSES = new Set([
  "cancelled",
  "ineligible",
  "not_approved",
  "rejected",
  "superseded",
  "unknown",
  "withdrawn",
]);

function parseOfficialProductSelectionId(value: unknown) {
  const selectionId = String(value || "").trim();
  if (!selectionId.startsWith(OFFICIAL_PRODUCT_SELECTION_PREFIX)) return null;
  const payload = selectionId.slice(OFFICIAL_PRODUCT_SELECTION_PREFIX.length);
  const separator = payload.indexOf(":");
  const sourceKeyLength = separator > 0
    ? Number(payload.slice(0, separator))
    : Number.NaN;
  if (!Number.isSafeInteger(sourceKeyLength)
    || sourceKeyLength < 3 || sourceKeyLength > 80) return null;
  const sourceKeyStart = separator + 1;
  const sourceKey = payload.slice(sourceKeyStart, sourceKeyStart + sourceKeyLength);
  const sourceRecordKey = payload.slice(sourceKeyStart + sourceKeyLength);
  if (!/^[a-z0-9:_-]+$/.test(sourceKey)
    || !sourceRecordKey || sourceRecordKey.length > 500
    || `${OFFICIAL_PRODUCT_SELECTION_PREFIX}${sourceKey.length}:${sourceKey}${sourceRecordKey}`
      !== selectionId) return null;
  return Object.freeze({ selectionId, sourceKey, sourceRecordKey });
}

function officialProductSelectionId(sourceKey: string, sourceRecordKey: string) {
  return `${OFFICIAL_PRODUCT_SELECTION_PREFIX}${sourceKey.length}:${sourceKey}${sourceRecordKey}`;
}

function validatedOfficialProductSelection(
  dependency: Extract<CreditexWorkPackDependency, { kind: "product" }>,
  activityDate: string,
  selection: Readonly<{
    selectionId: string;
    sourceKey: string;
    sourceRecordKey: string;
  }>,
  official: Readonly<Record<string, unknown>>,
): Omit<CreditexActivityWorkPackOfficialProductProjection, "dependencyKey"> | null {
  const approvalStatus = String(official.approval_status).toLowerCase();
  const activatedOn = String(official.activated_on || "");
  const eligibleFrom = String(official.eligible_from || "");
  const eligibleTo = String(official.eligible_to || "");
  const registryEffectiveFrom = String(official.registry_effective_from || "");
  const snapshotStatus = String(official.snapshot_status || "");
  const sourceSha256 = bareSha256(String(official.source_sha256 || ""));
  const valid = selection.sourceKey === String(official.source_key)
    && selection.sourceRecordKey === String(official.source_record_key)
    && String(official.registry_code) === dependency.registryCode
    && String(official.product_kind) === dependency.productKind
    && Number(official.available_in_australia) === 1
    && Number(official.artifact_count) === Number(official.source_count)
    && Number(official.artifact_count) > 0
    && ["current", "superseded"].includes(snapshotStatus)
    && (dependency.registryCode !== "veu-approved-products"
      || snapshotStatus === "current")
    && !INELIGIBLE_OFFICIAL_PRODUCT_STATUSES.has(approvalStatus)
    && (dependency.registryCode !== "gems-products"
      || approvalStatus === "approved")
    && (eligibleFrom ? eligibleFrom <= activityDate : activatedOn <= activityDate)
    && (!eligibleTo || eligibleTo >= activityDate)
    && (dependency.registryCode === "veu-approved-products"
      || registryEffectiveFrom <= activityDate)
    && (dependency.registryCode === "veu-approved-products"
      || snapshotStatus === "current"
      || String(official.superseded_on || "") > activityDate);
  if (!valid) return null;
  return Object.freeze({
    selectionId: selection.selectionId,
    snapshotId: String(official.snapshot_id),
    registryCode: String(official.registry_code),
    productKind: String(official.product_kind),
    sourceKey: String(official.source_key),
    sourceRecordKey: String(official.source_record_key),
    sourceSha256,
    manufacturer: String(official.manufacturer || ""),
    brand: String(official.brand || ""),
    model: String(official.model || ""),
    series: String(official.series || ""),
    registrationNumber: String(official.registration_number || ""),
    certificateNumber: String(official.certificate_number || ""),
    approvalStatus,
    eligibleFrom,
    eligibleTo,
    registryEffectiveFrom,
  });
}

function officialProductSelectionEvidence(input: Readonly<{
  row: WorkPackInstanceRecord;
  dependencyKey: string;
  selection: Omit<CreditexActivityWorkPackOfficialProductProjection,
    "dependencyKey">;
  sourceBindings: readonly DependencySourceIdentity[];
  quantity: number;
  selectedByUid: string;
  selectedAt: string;
}>) {
  return Object.freeze({
    contract: "creditex-work-pack-official-product-selection/v2" as const,
    workPackVersionId: input.row.work_pack_version_id,
    activityVersionId: input.row.activity_version_id,
    caseId: input.row.compliance_case_id,
    activityDate: input.row.activity_date,
    dependencyKey: input.dependencyKey,
    selectionId: input.selection.selectionId,
    snapshotId: input.selection.snapshotId,
    registryCode: input.selection.registryCode,
    productKind: input.selection.productKind,
    sourceKey: input.selection.sourceKey,
    sourceRecordKey: input.selection.sourceRecordKey,
    sourceSha256: input.selection.sourceSha256,
    sourceBindings: input.sourceBindings,
    quantity: input.quantity,
    selectedByUid: input.selectedByUid,
    selectedAt: input.selectedAt,
  });
}

async function strictOfficialProductRecord(
  database: D1Database,
  row: WorkPackInstanceRecord,
  dependency: Extract<CreditexWorkPackDependency, { kind: "product" }>,
  record: Readonly<Record<string, unknown>>,
  sourceBindings: readonly DependencySourceIdentity[],
) {
  const selection = parseOfficialProductSelectionId(record.product_reference);
  if (!selection
    || String(record.product_registry).toLowerCase()
      !== dependency.registryCode.toLowerCase()
    || ["removed", "returned", "scrapped"].includes(String(record.status))) {
    return null;
  }
  const evidence = parseObject(
    record.evidence_snapshot,
    "WORK_PACK_PRODUCT_SOURCE_INVALID",
    "The equipment record has invalid official-product evidence.",
  );
  const snapshotId = String(evidence.snapshotId || "").trim();
  const sourceSha256 = bareSha256(String(evidence.sourceSha256 || ""));
  if (
    evidence.contract !== "creditex-work-pack-official-product-selection/v2"
    || evidence.selectionId !== selection.selectionId
    || evidence.registryCode !== dependency.registryCode
    || evidence.productKind !== dependency.productKind
    || !snapshotId
  ) return null;
  const official = await database.prepare(`SELECT product.id,
      product.snapshot_id, product.source_key, product.source_record_key,
      product.product_kind, product.manufacturer, product.brand, product.model,
      product.series,
      product.registration_number, product.certificate_number,
      product.approval_status, product.eligible_from, product.eligible_to,
      product.available_in_australia, product.registry_effective_from,
      snapshot.registry_code, snapshot.source_sha256, snapshot.source_count,
      snapshot.status snapshot_status, snapshot.activated_on,
      snapshot.superseded_on,
      (SELECT COUNT(*) FROM compliance_official_product_artifacts artifact
        WHERE artifact.snapshot_id = snapshot.id) artifact_count
    FROM compliance_official_products product
    JOIN compliance_official_product_snapshots snapshot
      ON snapshot.id = product.snapshot_id
    WHERE product.snapshot_id = ? AND product.source_key = ?
      AND product.source_record_key = ? AND snapshot.registry_code = ?
      AND product.product_kind = ?
    LIMIT 1`)
    .bind(
      snapshotId,
      selection.sourceKey,
      selection.sourceRecordKey,
      dependency.registryCode,
      dependency.productKind,
    )
    .first<Record<string, unknown>>();
  if (!official) return null;
  const officialSelection = validatedOfficialProductSelection(
    dependency,
    row.activity_date,
    selection,
    official,
  );
  const valid = officialSelection !== null
    && officialSelection.sourceSha256 === sourceSha256
    && Number(official.available_in_australia) === 1
    && (!record.manufacturer
      || [official.manufacturer, official.brand].some((value) =>
        String(value || "").trim().toLowerCase()
          === String(record.manufacturer).trim().toLowerCase()
      ))
    && (!record.model
      || String(official.model).trim().toLowerCase()
        === String(record.model).trim().toLowerCase());
  if (!valid) return null;
  const expectedEvidence = officialProductSelectionEvidence({
    row,
    dependencyKey: dependency.dependencyKey,
    selection: officialSelection,
    sourceBindings,
    quantity: Number(record.quantity),
    selectedByUid: String(record.recorded_by_uid),
    selectedAt: String(record.recorded_at),
  });
  if (creditexCanonicalSha256(evidence)
    !== creditexCanonicalSha256(expectedEvidence)) return null;
  return Object.freeze({
    equipmentRecordId: String(record.id),
    ...officialSelection,
    quantity: Number(record.quantity),
    status: String(record.status),
  });
}

async function exactOfficialProductSelection(
  database: D1Database,
  row: WorkPackInstanceRecord,
  dependency: Extract<CreditexWorkPackDependency, { kind: "product" }>,
  selectionIdValue: unknown,
  snapshotIdValue: unknown,
) {
  const selection = parseOfficialProductSelectionId(selectionIdValue);
  const snapshotId = text(
    snapshotIdValue,
    160,
    "WORK_PACK_PRODUCT_SNAPSHOT_REQUIRED",
    "Official product snapshot",
  );
  if (!selection) {
    return fail(
      "WORK_PACK_PRODUCT_SELECTION_INVALID",
      400,
      "Choose a product from the exact official registry results for this activity.",
    );
  }
  const official = await database.prepare(`SELECT product.id,
      product.snapshot_id, product.source_key, product.source_record_key,
      product.product_kind, product.manufacturer, product.brand, product.model,
      product.series, product.registration_number, product.certificate_number,
      product.approval_status, product.eligible_from, product.eligible_to,
      product.available_in_australia, product.registry_effective_from,
      snapshot.registry_code, snapshot.source_sha256, snapshot.source_count,
      snapshot.status snapshot_status, snapshot.activated_on,
      snapshot.superseded_on,
      (SELECT COUNT(*) FROM compliance_official_product_artifacts artifact
        WHERE artifact.snapshot_id = snapshot.id) artifact_count
    FROM compliance_official_products product
    JOIN compliance_official_product_snapshots snapshot
      ON snapshot.id = product.snapshot_id
    WHERE product.snapshot_id = ? AND product.source_key = ?
      AND product.source_record_key = ? AND snapshot.registry_code = ?
      AND product.product_kind = ?
    LIMIT 1`)
    .bind(
      snapshotId,
      selection.sourceKey,
      selection.sourceRecordKey,
      dependency.registryCode,
      dependency.productKind,
    )
    .first<Record<string, unknown>>();
  const validated = official
    ? validatedOfficialProductSelection(
      dependency,
      row.activity_date,
      selection,
      official,
    )
    : null;
  if (!validated) {
    return fail(
      "WORK_PACK_PRODUCT_NOT_EFFECTIVE",
      409,
      "The selected official product is not exact, approved and effective for this activity date.",
    );
  }
  return validated;
}

export async function listAssignedCreditexActivityWorkPackOfficialProducts(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    dependencyKey: string;
    search?: string;
    limit?: number;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  validateInstanceEnvelope(row, resolved, { allowStaleExecutionContext: true });
  const dependencyKey = text(
    input.dependencyKey,
    180,
    "WORK_PACK_DEPENDENCY_REQUIRED",
    "Product dependency",
  );
  const dependency = resolved.workPack.dependencies.find((candidate) =>
    candidate.kind === "product" && candidate.dependencyKey === dependencyKey
  );
  if (!dependency || dependency.kind !== "product" || !dependency.required
    || dependency.productKind === "not_applicable") {
    return fail(
      "WORK_PACK_PRODUCT_DEPENDENCY_INVALID",
      400,
      "Choose a required official-product dependency from this exact activity form.",
    );
  }
  await approvedDependencySourceIdentity(
    database,
    row,
    resolved.workPack,
    dependency,
  );
  const search = optionalText(input.search, 120).toLowerCase();
  const limit = input.limit === undefined
    ? 30
    : safeInteger(input.limit, 1, "WORK_PACK_PRODUCT_LIMIT_INVALID", "Product limit");
  if (limit > 50) {
    return fail(
      "WORK_PACK_PRODUCT_LIMIT_INVALID",
      400,
      "Load at most 50 exact official products at once.",
    );
  }
  const rows = await database.prepare(`SELECT product.id,
      product.snapshot_id, product.source_key, product.source_record_key,
      product.product_kind, product.manufacturer, product.brand, product.model,
      product.series, product.registration_number, product.certificate_number,
      product.approval_status, product.eligible_from, product.eligible_to,
      product.available_in_australia, product.registry_effective_from,
      snapshot.registry_code, snapshot.source_sha256, snapshot.source_count,
      snapshot.status snapshot_status, snapshot.activated_on,
      snapshot.superseded_on,
      (SELECT COUNT(*) FROM compliance_official_product_artifacts artifact
        WHERE artifact.snapshot_id = snapshot.id) artifact_count
    FROM compliance_official_products product
    JOIN compliance_official_product_snapshots snapshot
      ON snapshot.id = product.snapshot_id
    WHERE snapshot.registry_code = ? AND product.product_kind = ?
      AND (? = '' OR product.search_text LIKE ?)
    ORDER BY CASE snapshot.status WHEN 'current' THEN 0 ELSE 1 END,
      snapshot.activated_on DESC, product.manufacturer, product.brand,
      product.model, product.source_key, product.source_record_key
    LIMIT 250`)
    .bind(
      dependency.registryCode,
      dependency.productKind,
      search,
      `%${search}%`,
    )
    .all<Record<string, unknown>>();
  const projected: CreditexActivityWorkPackOfficialProductProjection[] = [];
  const seen = new Set<string>();
  for (const official of rows.results) {
    const sourceKey = String(official.source_key);
    const sourceRecordKey = String(official.source_record_key);
    const selectionId = officialProductSelectionId(sourceKey, sourceRecordKey);
    if (seen.has(selectionId)) continue;
    const validated = validatedOfficialProductSelection(
      dependency,
      row.activity_date,
      { selectionId, sourceKey, sourceRecordKey },
      official,
    );
    if (!validated) continue;
    seen.add(selectionId);
    projected.push(Object.freeze({ dependencyKey, ...validated }));
    if (projected.length >= limit) break;
  }
  return Object.freeze(projected);
}

async function resolveServerDependencies(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  supplied: Readonly<Record<string, CreditexWorkPackDependencyInput>>,
): Promise<ResolvedServerDependencies> {
  const unknown = Object.keys(supplied).filter((key) =>
    !workPack.dependencies.some((dependency) => dependency.dependencyKey === key)
  );
  if (unknown.length) {
    return fail(
      "WORK_PACK_DEPENDENCY_UNKNOWN",
      400,
      "The response refers to a dependency outside this work-pack version.",
    );
  }
  const resolutions: Record<string, {
    status: "resolved" | "blocked" | "not_applicable";
    referenceIds: readonly string[];
    snapshotSha256: string;
  }> = {};
  const calculatorOutputs: CreditexActivityWorkPackCalculatorOutputProjection[] = [];
  const calculatorPendingReviews:
    CreditexActivityWorkPackCalculatorPendingReviewProjection[] = [];
  for (const dependency of workPack.dependencies) {
    let ids = uniqueReferenceIds(supplied[dependency.dependencyKey]?.referenceIds);
    if (dependency.kind === "scenario") {
      const caseRow = await database.prepare(`SELECT activity_snapshot
        FROM compliance_cases
        WHERE id = ? AND organisation_id = ? AND work_order_id = ?`)
        .bind(row.compliance_case_id, row.organisation_id, row.work_order_id)
        .first<{ activity_snapshot: string }>();
      const caseSnapshot = parseObject(
        caseRow?.activity_snapshot,
        "WORK_PACK_SCENARIO_SOURCE_INVALID",
        "The governed case scenario source is unavailable.",
      );
      const caseScenario = String(caseSnapshot.scenarioCode || "").trim();
      const storedEnvelope = parseObject(
        row.response_snapshot,
        "WORK_PACK_SCENARIO_SOURCE_INVALID",
        "The stored governed scenario resolution is unavailable.",
      );
      const storedResponse = object(
        storedEnvelope.response,
        "WORK_PACK_SCENARIO_SOURCE_INVALID",
        "The stored governed scenario response is unavailable.",
      ) as unknown as CreditexActivityWorkPackResponse;
      const storedResolution = storedResponse.dependencyResolutions[
        dependency.dependencyKey
      ];
      if (!ids.length && storedResolution?.status === "resolved") {
        ids = uniqueReferenceIds(storedResolution.referenceIds);
      }
      const sourceBindings = await approvedDependencySourceIdentity(
        database,
        row,
        workPack,
        dependency,
      );
      const scenarioCode = ids.length === 1 ? ids[0] : "";
      const expectedSha256 = scenarioCode
        ? scenarioResolutionSha256({
          row,
          dependencyKey: dependency.dependencyKey,
          scenarioCode,
          sourceBindings,
        })
        : "";
      const resolved = Boolean(
        scenarioCode
        && dependency.scenarioCodes.includes(scenarioCode)
        && (!caseScenario || caseScenario === scenarioCode)
        && storedResolution?.status === "resolved"
        && storedResolution.referenceIds.length === 1
        && storedResolution.referenceIds[0] === scenarioCode
        && storedResolution.snapshotSha256 === expectedSha256,
      );
      resolutions[dependency.dependencyKey] = Object.freeze({
        status: resolved ? "resolved" : dependency.required ? "blocked" : "not_applicable",
        referenceIds: Object.freeze(resolved ? [scenarioCode] : []),
        snapshotSha256: resolved ? expectedSha256 : "",
      });
      continue;
    }
    if (!ids.length) {
      resolutions[dependency.dependencyKey] = Object.freeze({
        status: dependency.required ? "blocked" : "not_applicable",
        referenceIds: Object.freeze([]),
        snapshotSha256: "",
      });
      continue;
    }
    if (dependency.kind === "product") {
      const records = await database.prepare(`SELECT id, record_type,
          manufacturer, model, serial_number, product_registry,
          product_reference, quantity, status, evidence_snapshot,
          recorded_by_uid, recorded_at, updated_at
        FROM compliance_equipment_records
        WHERE organisation_id = ? AND case_id = ?
          AND id IN (${ids.map(() => "?").join(",")})
        ORDER BY id`)
        .bind(row.organisation_id, row.compliance_case_id, ...ids)
        .all<Record<string, unknown>>();
      const sourceBindings = await approvedDependencySourceIdentity(
        database,
        row,
        workPack,
        dependency,
      );
      const officialRecords = records.results.length === ids.length
        ? await Promise.all(records.results.map((record) =>
          strictOfficialProductRecord(
            database,
            row,
            dependency,
            record,
            sourceBindings,
          )
        ))
        : [];
      const valid = officialRecords.length === ids.length
        && officialRecords.every((record) => record !== null)
        && ids.length >= dependency.minimumCount
        && ids.length <= dependency.maximumCount;
      resolutions[dependency.dependencyKey] = Object.freeze({
        status: valid ? "resolved" : "blocked",
        referenceIds: Object.freeze(ids),
        snapshotSha256: valid
          ? creditexCanonicalSha256({
            contract: "creditex-work-pack-product-resolution/v1",
            dependencyKey: dependency.dependencyKey,
            caseId: row.compliance_case_id,
            activityDate: row.activity_date,
            records: officialRecords,
          })
          : "",
      });
      continue;
    }
    const records = await database.prepare(`SELECT run.id, run.case_revision,
        compliance_case.revision current_case_revision,
        run.input_snapshot, run.output_snapshot, run.status, run.run_by_uid,
        run.run_at, run.verified_by_uid, run.verified_at,
        version.id calculator_version_id, version.calculator_key,
        version.version calculator_version,
        version.official_source_sha256 calculator_source_sha256,
        version.specification calculator_specification,
        version.output_type calculator_output_type,
        version.approval_state calculator_approval_state,
        version.primary_approver_uid, version.secondary_approver_uid,
        version.approved_at calculator_approved_at,
        calculation_review.id review_id,
        calculation_review.decision review_decision,
        calculation_review.input_sha256 review_input_sha256,
        calculation_review.output_sha256 review_output_sha256,
        calculation_review.engine_receipt_id review_engine_receipt_id,
        calculation_review.reviewer_uid,
        calculation_review.reviewed_at
      FROM compliance_calculation_runs run
      JOIN compliance_cases compliance_case
        ON compliance_case.id = run.case_id
        AND compliance_case.organisation_id = run.organisation_id
      JOIN compliance_calculator_versions version
        ON version.id = run.calculator_version_id
        AND version.organisation_id = run.organisation_id
        AND version.activity_version_id = ?
        AND version.calculator_key = ?
        AND version.version = ?
      LEFT JOIN compliance_activity_work_pack_calculation_reviews calculation_review
        ON calculation_review.organisation_id = run.organisation_id
        AND calculation_review.calculation_run_id = run.id
      WHERE run.organisation_id = ? AND run.case_id = ?
        AND run.id IN (${ids.map(() => "?").join(",")})
      ORDER BY run.id`)
      .bind(
        row.activity_version_id,
        dependency.calculatorKey,
        dependency.calculatorVersion,
        row.organisation_id,
        row.compliance_case_id,
        ...ids,
      )
      .all<CalculatorRunRecord>();
    const outputs = records.results.length === ids.length
      ? await Promise.all(records.results.map((record) =>
        strictCalculatorOutput(database, row, workPack, dependency, record)
      ))
      : [];
    const valid = outputs.length === ids.length
      && outputs.every((output): output is CreditexActivityWorkPackCalculatorOutputProjection =>
        output !== null
      );
    if (valid) calculatorOutputs.push(...outputs);
    if (!valid) {
      for (const record of records.results) {
        if (
          record.status === "calculated"
          && Number(record.case_revision) === Number(record.current_case_revision)
          && Number(record.current_case_revision) > 0
          && record.calculator_approval_state === "approved"
        ) {
          calculatorPendingReviews.push(Object.freeze({
            dependencyKey: dependency.dependencyKey,
            calculationRunId: record.id,
            status: "calculated" as const,
            reviewStatus: record.review_decision === "rejected"
              ? "creditex_review_rejected" as const
              : "creditex_review_required" as const,
            runAt: record.run_at,
          }));
        }
      }
    }
    resolutions[dependency.dependencyKey] = Object.freeze({
      status: valid ? "resolved" : "blocked",
      referenceIds: Object.freeze(ids),
      snapshotSha256: valid
        ? creditexCanonicalSha256({
          contract: "creditex-work-pack-calculator-resolution/v1",
          dependencyKey: dependency.dependencyKey,
          caseId: row.compliance_case_id,
            records: outputs,
          })
        : "",
    });
  }
  return Object.freeze({
    resolutions: Object.freeze(resolutions),
    calculatorOutputs: Object.freeze(calculatorOutputs),
    calculatorPendingReviews: Object.freeze(calculatorPendingReviews),
  });
}

function nextInstanceEnvelope(
  prior: CreditexActivityWorkPackInstanceEnvelope,
  response: CreditexActivityWorkPackResponse,
  customerContext: CreditexActivityWorkPackCustomerContext = prior.prefill.customerContext,
  executionContexts: ServerExecutionContexts = {
    providerContext: prior.prefill.providerContext,
    installerBusinessContext: prior.prefill.installerBusinessContext,
    assignmentContext: prior.prefill.assignmentContext,
    jobContext: prior.prefill.jobContext,
  },
  customerSnapshot: CreditexActivityWorkPackCustomerSnapshot = prior.prefill.customerSnapshot,
) {
  const prefill = Object.freeze({
    ...prior.prefill,
    customerContext,
    customerSnapshot,
    providerContext: executionContexts.providerContext,
    installerBusinessContext: executionContexts.installerBusinessContext,
    assignmentContext: executionContexts.assignmentContext,
    jobContext: executionContexts.jobContext,
  });
  return Object.freeze({
    ...prior,
    prefill,
    prefillSha256: creditexCanonicalSha256(prefill),
    response,
    responseSha256: creditexCanonicalSha256(response),
    finalisation: null,
  }) satisfies CreditexActivityWorkPackInstanceEnvelope;
}

function appendInstanceStatement(
  database: D1Database,
  row: WorkPackInstanceRecord,
  input: {
    id: string;
    status: "in_progress" | "ready_to_sign" | "completed" | "void";
    envelope: CreditexActivityWorkPackInstanceEnvelope;
    actorUid: string;
    createdAt: string;
  },
) {
  return database.prepare(`INSERT INTO compliance_activity_work_pack_instances
    (id, instance_key, organisation_id, compliance_case_id, work_order_id,
     compliance_intent_id, work_pack_version_id,
     manual_policy_composition_lock_id, manual_policy_composition_sha256,
     activity_date, revision, supersedes_instance_id, status,
     response_snapshot, response_sha256, created_by_uid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id,
      row.instance_key,
      row.organisation_id,
      row.compliance_case_id,
      row.work_order_id,
      row.compliance_intent_id,
      row.work_pack_version_id,
      row.manual_policy_composition_lock_id,
      row.manual_policy_composition_sha256,
      row.activity_date,
      Number(row.revision) + 1,
      row.id,
      input.status,
      checkedJson(input.envelope),
      creditexCanonicalSha256(input.envelope),
      input.actorUid,
      input.createdAt,
    );
}

type MutationReceipt = {
  id: string;
  payload_hash: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  base_revision: number;
  result_revision: number;
  status: string;
  actor_uid: string;
  member_id: string;
  device_id: string;
};

async function mutationReceipt(
  database: D1Database,
  scope: CreditexWorkPackTradeScope,
  idempotency: CreditexWorkPackMutationIdempotency,
) {
  return database.prepare(`SELECT id, payload_hash, action_type, entity_type,
      entity_id, base_revision, result_revision, status, actor_uid, member_id,
      device_id
    FROM trade_offline_actions
    WHERE owner_uid = ? AND client_action_id = ?`)
    .bind(scope.ownerUid, idempotency.clientActionId)
    .first<MutationReceipt>();
}

function validateMutationIdempotency(
  input: CreditexWorkPackMutationIdempotency,
) {
  return Object.freeze({
    clientActionId: text(
      input.clientActionId,
      120,
      "WORK_PACK_ACTION_ID_REQUIRED",
      "Client action ID",
    ),
    deviceId: text(
      input.deviceId,
      180,
      "WORK_PACK_DEVICE_REQUIRED",
      "Device ID",
    ),
    payloadHash: text(
      input.payloadHash,
      180,
      "WORK_PACK_ACTION_HASH_REQUIRED",
      "Action payload hash",
    ),
  });
}

async function runWorkPackMutation(
  database: D1Database,
  input: {
    scope: CreditexWorkPackTradeScope;
    row: WorkPackInstanceRecord;
    idempotency: CreditexWorkPackMutationIdempotency;
    action: CreditexWorkPackMutationResult["action"];
    resultRevision: number;
    newInstanceId: string;
    now: string;
    statements: readonly D1PreparedStatement[];
  },
): Promise<CreditexWorkPackMutationResult> {
  const idempotency = validateMutationIdempotency(input.idempotency);
  const existing = await mutationReceipt(database, input.scope, idempotency);
  const identityExact = existing
    && existing.payload_hash === idempotency.payloadHash
    && existing.action_type === input.action
    && existing.entity_type === "work_pack"
    && existing.entity_id === input.row.instance_key
    && existing.actor_uid === input.scope.actorUid
    && existing.member_id === input.scope.actorMemberId
    && existing.device_id === idempotency.deviceId;
  if (existing?.status === "applied" && identityExact) {
    return Object.freeze({
      status: "duplicate",
      action: input.action,
      projection: await projectAssignedInstance(
        database,
        await assignedInstanceRow(database, input.scope, input.row.id),
        input.scope.actorUid,
      ),
    });
  }
  const exact = identityExact
    && Number(existing?.base_revision) === Number(input.row.revision);
  if (existing && !exact) {
    return fail(
      "WORK_PACK_IDEMPOTENCY_MISMATCH",
      409,
      "This client action ID was already used for different work-pack content.",
    );
  }
  const receiptId = existing?.id || `work-pack-action:${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(database.prepare(`INSERT INTO trade_offline_actions
      (id, owner_uid, actor_uid, member_id, device_id, client_action_id,
       payload_hash, action_type, entity_type, entity_id, base_revision,
       result_revision, status, lease_until, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'work_pack', ?, ?, 0,
        'processing', ?, '', ?, ?)`)
      .bind(
        receiptId,
        input.scope.ownerUid,
        input.scope.actorUid,
        input.scope.actorMemberId,
        idempotency.deviceId,
        idempotency.clientActionId,
        idempotency.payloadHash,
        input.action,
        input.row.instance_key,
        Number(input.row.revision),
        new Date(Date.parse(input.now) + 5 * 60 * 1000).toISOString(),
        input.now,
        input.now,
      ));
  }
  statements.push(...input.statements);
  statements.push(database.prepare(`UPDATE trade_offline_actions
      SET result_revision = ?, status = 'applied', lease_until = '',
        error_code = '', updated_at = ?
    WHERE id = ? AND owner_uid = ? AND client_action_id = ?
      AND payload_hash = ? AND action_type = ? AND entity_type = 'work_pack'
      AND entity_id = ? AND base_revision = ? AND status = 'processing'
      AND actor_uid = ? AND member_id = ? AND device_id = ?`)
    .bind(
      input.resultRevision,
      input.now,
      receiptId,
      input.scope.ownerUid,
      idempotency.clientActionId,
      idempotency.payloadHash,
      input.action,
      input.row.instance_key,
      Number(input.row.revision),
      input.scope.actorUid,
      input.scope.actorMemberId,
      idempotency.deviceId,
    ));
  statements.push(database.prepare(`INSERT INTO trade_team_sync_changes
      (owner_uid, audience_member_id, entity_type, entity_id, operation,
       revision, changed_at)
    SELECT ?, '', 'job', ?, 'upsert', ?, ?
    WHERE EXISTS (
      SELECT 1 FROM trade_offline_actions receipt
      WHERE receipt.id = ? AND receipt.owner_uid = ?
        AND receipt.status = 'applied' AND receipt.result_revision = ?
    )`)
    .bind(
      input.scope.ownerUid,
      input.row.work_order_id,
      Number(input.row.work_order_revision),
      input.now,
      receiptId,
      input.scope.ownerUid,
      input.resultRevision,
    ));
  if (input.row.assignee_member_id) {
    statements.push(database.prepare(`INSERT INTO trade_team_sync_changes
        (owner_uid, audience_member_id, entity_type, entity_id, operation,
         revision, changed_at)
      SELECT ?, ?, 'job', ?, 'upsert', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM trade_offline_actions receipt
        WHERE receipt.id = ? AND receipt.owner_uid = ?
          AND receipt.status = 'applied' AND receipt.result_revision = ?
      )`)
      .bind(
        input.scope.ownerUid,
        input.row.assignee_member_id,
        input.row.work_order_id,
        Number(input.row.work_order_revision),
        input.now,
        receiptId,
        input.scope.ownerUid,
        input.resultRevision,
      ));
  }
  statements.push(database.prepare(`UPDATE trade_work_orders SET revision = NULL
    WHERE id = ? AND firebase_uid = ? AND NOT EXISTS (
      SELECT 1 FROM trade_offline_actions receipt
      WHERE receipt.id = ? AND receipt.owner_uid = ?
        AND receipt.status = 'applied' AND receipt.result_revision = ?
    )`)
    .bind(
      input.row.work_order_id,
      input.scope.ownerUid,
      receiptId,
      input.scope.ownerUid,
      input.resultRevision,
    ));
  try {
    await database.batch(statements);
  } catch (error) {
    const replay = await mutationReceipt(database, input.scope, idempotency);
    if (
      replay?.status === "applied"
      && replay.payload_hash === idempotency.payloadHash
      && replay.action_type === input.action
      && replay.entity_type === "work_pack"
      && replay.entity_id === input.row.instance_key
      && Number(replay.base_revision) === Number(input.row.revision)
      && Number(replay.result_revision) === Number(input.resultRevision)
      && replay.actor_uid === input.scope.actorUid
      && replay.member_id === input.scope.actorMemberId
      && replay.device_id === idempotency.deviceId
    ) {
      return Object.freeze({
        status: "duplicate",
        action: input.action,
        projection: await projectAssignedInstance(
          database,
          await assignedInstanceRow(database, input.scope, input.row.id),
          input.scope.actorUid,
        ),
      });
    }
    throw error;
  }
  const current = await assignedInstanceRow(
    database,
    input.scope,
    input.newInstanceId || input.row.id,
  );
  return Object.freeze({
    status: "applied",
    action: input.action,
    projection: await projectAssignedInstance(
      database,
      current,
      input.scope.actorUid,
    ),
  });
}

async function replayAppliedWorkPackMutation(
  database: D1Database,
  input: {
    scope: CreditexWorkPackTradeScope;
    row: WorkPackInstanceRecord;
    idempotency: CreditexWorkPackMutationIdempotency;
    action: CreditexWorkPackMutationResult["action"];
  },
) {
  const receipt = await mutationReceipt(
    database,
    input.scope,
    validateMutationIdempotency(input.idempotency),
  );
  if (receipt?.status !== "applied") return null;
  return runWorkPackMutation(database, {
    ...input,
    resultRevision: Number(receipt.result_revision),
    newInstanceId: input.row.id,
    now: new Date().toISOString(),
    statements: [],
  });
}

async function applyReferenceAcknowledgements(
  database: D1Database,
  row: WorkPackInstanceRecord,
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
  inputs: readonly CreditexWorkPackReferenceAcknowledgementInput[],
) {
  if (inputs.length > 100) {
    return fail(
      "WORK_PACK_REFERENCE_ACK_LIMIT",
      413,
      "Acknowledge at most 100 governed documents at once.",
    );
  }
  const available = await instanceReferenceDocuments(
    database,
    row,
    workPack,
    response,
  );
  const answers = { ...response.answers };
  const repeatableSections = Object.fromEntries(Object.entries(
    response.repeatableSections,
  ).map(([sectionKey, instances]) => [sectionKey, instances.map((instance) => ({
    instanceKey: instance.instanceKey,
    answers: { ...instance.answers },
  }))]));
  for (const input of inputs) {
    const location = responsePrompt(
      workPack,
      input.sectionKey,
      input.repeatInstanceKey,
      input.promptKey,
    );
    requireVisibleResponsePrompt(response, location);
    if (
      location.prompt.type !== "reference_document"
      || !location.prompt.referenceDocument
      || location.prompt.referenceDocument.acknowledgementMode === "none"
    ) {
      return fail(
        "WORK_PACK_REFERENCE_ACK_INVALID",
        400,
        "This prompt does not require a governed document acknowledgement.",
      );
    }
    const sourceArtifactId = text(
      input.sourceArtifactId,
      180,
      "WORK_PACK_REFERENCE_SOURCE_REQUIRED",
      "Governed source artifact",
    );
    const source = available.find((candidate) =>
      candidate.responseKey === location.responseKey
      && candidate.sourceArtifactId === sourceArtifactId
      && candidate.sourceBindingTargetKey
        === location.prompt.referenceDocument?.sourceBindingTargetKey
    );
    if (!source) {
      return fail(
        "WORK_PACK_REFERENCE_SOURCE_INVALID",
        409,
        "The governed document no longer matches this pinned work-pack prompt.",
      );
    }
    const acknowledgement = Object.freeze({
      contract:
        CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT,
      sourceBindingTargetKey: source.sourceBindingTargetKey,
      sourceArtifactId: source.sourceArtifactId,
      sourceArtifactSha256: source.sourceArtifactSha256,
      acknowledgementMode: source.acknowledgementMode === "confirmed"
        ? "confirmed"
        : "viewed",
      acknowledged: true,
      acknowledgedAt: instant(
        input.acknowledgedAt,
        "WORK_PACK_REFERENCE_ACK_TIME_INVALID",
        "Acknowledgement time",
      ),
    }) satisfies CreditexActivityWorkPackReferenceDocumentAcknowledgement;
    if (location.repeatInstanceKey) {
      const instance = repeatableSections[location.sectionKey]?.find(
        (candidate) => candidate.instanceKey === location.repeatInstanceKey,
      );
      if (!instance) {
        return fail(
          "WORK_PACK_REPEAT_INSTANCE_REQUIRED",
          409,
          "Add the repeatable item before acknowledging its governed document.",
        );
      }
      instance.answers[location.promptKey] = acknowledgement;
    } else {
      answers[location.promptKey] = acknowledgement;
    }
  }
  return validateResponseValues(workPack, Object.freeze({
    ...response,
    answers: Object.freeze(answers),
    repeatableSections: Object.freeze(repeatableSections),
  }));
}

export type CreditexWorkPackArtifactLinkInput = Readonly<{
  sectionKey: string;
  repeatInstanceKey?: string;
  promptKey: string;
  clientUploadId: string;
  deviceId: string;
}>;

export type CreditexWorkPackBrowserUploadPurpose = "artifact" | "signature";

export type CreditexWorkPackBrowserUploadInput = CreditexWorkPackTradeScope & Readonly<{
  caseInstanceId: string;
  sectionKey: string;
  repeatInstanceKey?: string;
  promptKey: string;
  clientUploadId: string;
  purpose: CreditexWorkPackBrowserUploadPurpose;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  now?: string;
}>;

export type CreditexWorkPackBrowserUploadResult = Readonly<{
  status: "applied" | "duplicate";
  upload: Readonly<{
    clientUploadId: string;
    sessionId: string;
    deviceId: string;
    sha256: string;
    sizeBytes: number;
    contentType: string;
    fileName: string;
    purpose: CreditexWorkPackBrowserUploadPurpose;
    promptKey: string;
    capturedAt: string;
  }>;
}>;

type BrowserUploadReceiptRecord = {
  id: string;
  organisation_id: string;
  instance_key: string;
  case_instance_id: string;
  owner_uid: string;
  actor_uid: string;
  member_id: string;
  work_order_id: string;
  client_upload_id: string;
  prompt_key: string;
  purpose: CreditexWorkPackBrowserUploadPurpose;
  artifact_kind: string;
  device_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  original_sha256: string;
  metadata_snapshot: string;
  metadata_sha256: string;
  captured_at: string;
  created_at: string;
};

const MAXIMUM_BROWSER_WORK_PACK_UPLOAD_BYTES = 50 * 1024 * 1024;

function browserUploadId(value: unknown) {
  const result = text(
    value,
    180,
    "WORK_PACK_UPLOAD_REQUIRED",
    "Browser upload ID",
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(result)) {
    return fail(
      "WORK_PACK_UPLOAD_ID_INVALID",
      400,
      "The browser upload ID is invalid.",
    );
  }
  return result;
}

function browserUploadFileName(value: unknown) {
  const result = text(
    value,
    240,
    "WORK_PACK_UPLOAD_FILE_NAME_REQUIRED",
    "File name",
  );
  if (/[\u0000-\u001f\u007f]/.test(result)) {
    return fail(
      "WORK_PACK_UPLOAD_FILE_NAME_INVALID",
      400,
      "The browser upload file name is invalid.",
    );
  }
  return result;
}

function browserUploadContentType(value: unknown) {
  const result = text(
    value,
    180,
    "WORK_PACK_UPLOAD_CONTENT_TYPE_REQUIRED",
    "Content type",
  ).toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(result)) {
    return fail(
      "WORK_PACK_UPLOAD_CONTENT_TYPE_INVALID",
      400,
      "The browser upload content type is invalid.",
    );
  }
  return result;
}

function isPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.byteLength >= signature.length
    && signature.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array) {
  return bytes.byteLength >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function isPdf(bytes: Uint8Array) {
  if (
    bytes.byteLength < 12
    || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
  ) return false;
  const tail = new TextDecoder().decode(bytes.slice(Math.max(0, bytes.length - 2048)));
  return /%%EOF\s*$/.test(tail);
}

function exactBrowserUploadBytes(
  bytes: Uint8Array,
  contentType: string,
  purpose: CreditexWorkPackBrowserUploadPurpose,
) {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1
    || bytes.byteLength > MAXIMUM_BROWSER_WORK_PACK_UPLOAD_BYTES
  ) {
    return fail(
      "WORK_PACK_UPLOAD_SIZE_INVALID",
      413,
      "Browser work-pack files must be between 1 byte and 50 MB.",
    );
  }
  if (purpose === "signature" && contentType !== "application/json") {
    return fail(
      "WORK_PACK_SIGNATURE_UPLOAD_TYPE_INVALID",
      415,
      "Browser signature custody accepts the exact JSON signature payload only.",
    );
  }
  if (contentType === "image/jpeg") {
    const exif = verifyJpegExif(bytes);
    if (!exif.validJpeg) {
      return fail(
        "WORK_PACK_UPLOAD_BYTES_INVALID",
        400,
        "The uploaded bytes are not a valid JPEG file.",
      );
    }
    return Object.freeze({ exif, json: null });
  }
  if (contentType === "image/png") {
    if (!isPng(bytes)) {
      return fail(
        "WORK_PACK_UPLOAD_BYTES_INVALID",
        400,
        "The uploaded bytes are not a valid PNG file.",
      );
    }
    return Object.freeze({ exif: null, json: null });
  }
  if (contentType === "image/webp") {
    if (!isWebp(bytes)) {
      return fail(
        "WORK_PACK_UPLOAD_BYTES_INVALID",
        400,
        "The uploaded bytes are not a valid WebP file.",
      );
    }
    return Object.freeze({ exif: null, json: null });
  }
  if (contentType === "application/pdf") {
    if (!isPdf(bytes)) {
      return fail(
        "WORK_PACK_UPLOAD_BYTES_INVALID",
        400,
        "The uploaded bytes are not a complete PDF file.",
      );
    }
    return Object.freeze({ exif: null, json: null });
  }
  if (contentType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail(
        "WORK_PACK_UPLOAD_BYTES_INVALID",
        400,
        "The uploaded bytes are not valid UTF-8 JSON.",
      );
    }
    if (
      purpose === "signature"
      && object(
        parsed,
        "WORK_PACK_SIGNATURE_PAYLOAD_INVALID",
        "The uploaded signature payload is invalid.",
      ).contract !== CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT
    ) {
      return fail(
        "WORK_PACK_SIGNATURE_PAYLOAD_INVALID",
        400,
        "The uploaded JSON is not a governed work-pack signature payload.",
      );
    }
    return Object.freeze({ exif: null, json: parsed });
  }
  return fail(
    "WORK_PACK_BROWSER_UPLOAD_TYPE_UNSUPPORTED",
    415,
    "This exact file type is not supported by browser custody. Use JPEG, PNG, WebP or PDF field files.",
  );
}

async function browserUploadReceipt(
  database: D1Database,
  ownerUid: string,
  actorUid: string,
  clientUploadId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_activity_work_pack_browser_upload_receipts
    WHERE owner_uid = ? AND actor_uid = ? AND client_upload_id = ?
    LIMIT 1`)
    .bind(ownerUid, actorUid, clientUploadId)
    .first<BrowserUploadReceiptRecord>();
}

function browserUploadResult(
  status: "applied" | "duplicate",
  receipt: BrowserUploadReceiptRecord,
): CreditexWorkPackBrowserUploadResult {
  return Object.freeze({
    status,
    upload: Object.freeze({
      clientUploadId: receipt.client_upload_id,
      sessionId: receipt.id,
      deviceId: receipt.device_id,
      sha256: receipt.original_sha256,
      sizeBytes: Number(receipt.size_bytes),
      contentType: receipt.content_type,
      fileName: receipt.file_name,
      purpose: receipt.purpose,
      promptKey: receipt.prompt_key,
      capturedAt: receipt.captured_at,
    }),
  });
}

async function exactBrowserUploadReplay(
  receipt: BrowserUploadReceiptRecord | null,
  input: {
    row: WorkPackInstanceRecord;
    responseKey: string;
    purpose: CreditexWorkPackBrowserUploadPurpose;
    artifactKind: string;
    deviceId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  },
) {
  if (!receipt) return null;
  if (
    receipt.organisation_id !== input.row.organisation_id
    || receipt.instance_key !== input.row.instance_key
    || receipt.work_order_id !== input.row.work_order_id
    || receipt.prompt_key !== input.responseKey
    || receipt.purpose !== input.purpose
    || receipt.artifact_kind !== input.artifactKind
    || receipt.device_id !== input.deviceId
    || receipt.file_name !== input.fileName
    || receipt.content_type !== input.contentType
    || Number(receipt.size_bytes) !== input.sizeBytes
    || receipt.original_sha256 !== input.sha256
  ) {
    return fail(
      "WORK_PACK_UPLOAD_ID_CONFLICT",
      409,
      "This browser upload ID was already used for different exact bytes or work-pack scope.",
    );
  }
  await exactCustodyBytes({
    objectKey: receipt.object_key,
    expectedSha256: receipt.original_sha256,
    expectedSizeBytes: Number(receipt.size_bytes),
    expectedContentType: receipt.content_type,
  });
  return browserUploadResult("duplicate", receipt);
}

export async function captureAssignedCreditexActivityWorkPackBrowserUpload(
  database: D1Database,
  input: CreditexWorkPackBrowserUploadInput,
): Promise<CreditexWorkPackBrowserUploadResult> {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot accept another field file.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved);
  const location = responsePrompt(
    resolved.workPack,
    input.sectionKey,
    input.repeatInstanceKey,
    input.promptKey,
  );
  requireVisibleResponsePrompt(envelope.response, location);
  if (
    location.repeatInstanceKey
    && !envelope.response.repeatableSections[location.sectionKey]?.some(
      (instance) => instance.instanceKey === location.repeatInstanceKey,
    )
  ) {
    return fail(
      "WORK_PACK_REPEAT_INSTANCE_REQUIRED",
      409,
      "Add the repeatable item before capturing its field file.",
    );
  }
  const purpose = input.purpose;
  const isArtifact = purpose === "artifact"
    && (location.prompt.type === "photo" || location.prompt.type === "document")
    && Boolean(location.prompt.fileRequirement);
  const isSignature = purpose === "signature"
    && location.prompt.type === "signature";
  if (!isArtifact && !isSignature) {
    return fail(
      "WORK_PACK_UPLOAD_PROMPT_INVALID",
      400,
      "The browser file purpose does not match this exact work-pack prompt.",
    );
  }
  const clientUploadId = browserUploadId(input.clientUploadId);
  const fileName = browserUploadFileName(input.fileName);
  const contentType = browserUploadContentType(input.contentType);
  const exact = new Uint8Array(input.bytes.byteLength);
  exact.set(input.bytes);
  const inspected = exactBrowserUploadBytes(exact, contentType, purpose);
  if (
    isArtifact
    && !location.prompt.fileRequirement?.allowedContentTypes.some(
      (candidate) => candidate.toLowerCase() === contentType,
    )
  ) {
    return fail(
      "WORK_PACK_ARTIFACT_CONTENT_TYPE_INVALID",
      415,
      "This exact file type is not allowed for the governed prompt.",
    );
  }
  const exif = inspected.exif;
  if (
    isArtifact
    && location.prompt.fileRequirement?.metadataRequired
    && exif?.status !== "valid"
  ) {
    return fail(
      "WORK_PACK_ARTIFACT_METADATA_REQUIRED",
      409,
      "This prompt requires an original JPEG with valid embedded EXIF metadata.",
    );
  }
  if (
    isArtifact
    && location.prompt.fileRequirement?.gpsRequired
    && !exif?.gps
  ) {
    return fail(
      "WORK_PACK_ARTIFACT_GPS_REQUIRED",
      409,
      "This prompt requires an original JPEG with embedded GPS coordinates.",
    );
  }
  if (
    isArtifact
    && location.prompt.fileRequirement?.captureTimeRequired
    && !exif?.captureTimestamp
  ) {
    return fail(
      "WORK_PACK_ARTIFACT_CAPTURE_TIME_REQUIRED",
      409,
      "This prompt requires an original JPEG with an embedded capture time.",
    );
  }
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Browser capture time")
    : new Date().toISOString();
  const sha256 = await sha256Bytes(exact);
  const deviceId = `browser:${creditexCanonicalSha256({
    contract: "creditex-activity-work-pack-browser-device/v1",
    ownerUid: input.ownerUid,
    actorUid: input.actorUid,
    memberId: input.actorMemberId,
  }).slice(7, 39)}`;
  const sourceEnvelope = Object.freeze({
    contract: "creditex-activity-work-pack-browser-capture/v1",
    instanceKey: row.instance_key,
    responseKey: location.responseKey,
    purpose,
    originalSha256: sha256,
    sizeBytes: exact.byteLength,
    contentType,
    deviceId,
    capturedAt: now,
    exif: exif || Object.freeze({
      status: "not_applicable",
      validJpeg: false,
      exifPresent: false,
      captureTimestamp: null,
      captureTimestampTag: null,
      gps: null,
    }),
  });
  const metadata = Object.freeze({
    contract: "creditex-work-pack-artifact-metadata/v1",
    originalSha256: sha256,
    deviceId,
    capturedAt: now,
    exif: sourceEnvelope.exif,
    gps: exif?.gps
      ? Object.freeze({
        latitude: exif.gps.latitude,
        longitude: exif.gps.longitude,
      })
      : Object.freeze({}),
    sourceEnvelopeSha256: creditexCanonicalSha256(sourceEnvelope),
  });
  const artifactKind = isArtifact ? location.prompt.type : "";
  const replayInput = {
    row,
    responseKey: location.responseKey,
    purpose,
    artifactKind,
    deviceId,
    fileName,
    contentType,
    sizeBytes: exact.byteLength,
    sha256,
  };
  const replay = await exactBrowserUploadReplay(
    await browserUploadReceipt(
      database,
      input.ownerUid,
      input.actorUid,
      clientUploadId,
    ),
    replayInput,
  );
  if (replay) return replay;
  const receiptId = `work-pack-browser-upload:${crypto.randomUUID()}`;
  const objectKey = [
    "creditex", "activity-work-packs", "browser",
    storageKeyPart(row.organisation_id), storageKeyPart(row.instance_key),
    storageKeyPart(clientUploadId), sha256,
  ].join("/");
  try {
    await getCreditexCustodyBucket().put(objectKey, exact.buffer, {
      httpMetadata: { contentType },
      customMetadata: {
        contract: "creditex-activity-work-pack-browser-upload/v1",
        originalSha256: sha256,
      },
    });
  } catch {
    return fail(
      "WORK_PACK_CUSTODY_STORAGE_UNAVAILABLE",
      503,
      "The exact browser field file could not be retained.",
    );
  }
  const receipt: BrowserUploadReceiptRecord = {
    id: receiptId,
    organisation_id: row.organisation_id,
    instance_key: row.instance_key,
    case_instance_id: row.id,
    owner_uid: input.ownerUid,
    actor_uid: input.actorUid,
    member_id: input.actorMemberId,
    work_order_id: row.work_order_id,
    client_upload_id: clientUploadId,
    prompt_key: location.responseKey,
    purpose,
    artifact_kind: artifactKind,
    device_id: deviceId,
    object_key: objectKey,
    file_name: fileName,
    content_type: contentType,
    size_bytes: exact.byteLength,
    original_sha256: sha256,
    metadata_snapshot: checkedJson(metadata),
    metadata_sha256: creditexCanonicalSha256(metadata),
    captured_at: now,
    created_at: now,
  };
  try {
    const result = await database.prepare(`INSERT INTO
      compliance_activity_work_pack_browser_upload_receipts (
        id, contract, organisation_id, instance_key, case_instance_id,
        owner_uid, actor_uid, member_id, work_order_id, client_upload_id,
        prompt_key, purpose, artifact_kind, device_id, object_key, file_name,
        content_type, size_bytes, original_sha256, metadata_snapshot,
        metadata_sha256, captured_at, created_at
      ) VALUES (?, 'creditex-activity-work-pack-browser-upload/v1', ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        receipt.id,
        receipt.organisation_id,
        receipt.instance_key,
        receipt.case_instance_id,
        receipt.owner_uid,
        receipt.actor_uid,
        receipt.member_id,
        receipt.work_order_id,
        receipt.client_upload_id,
        receipt.prompt_key,
        receipt.purpose,
        receipt.artifact_kind,
        receipt.device_id,
        receipt.object_key,
        receipt.file_name,
        receipt.content_type,
        receipt.size_bytes,
        receipt.original_sha256,
        receipt.metadata_snapshot,
        receipt.metadata_sha256,
        receipt.captured_at,
        receipt.created_at,
      ).run();
    if (Number(result.meta.changes || 0) !== 1) {
      throw new Error("WORK_PACK_BROWSER_UPLOAD_NOT_RECORDED");
    }
    return browserUploadResult("applied", receipt);
  } catch (error) {
    const concurrent = await exactBrowserUploadReplay(
      await browserUploadReceipt(
        database,
        input.ownerUid,
        input.actorUid,
        clientUploadId,
      ),
      replayInput,
    );
    if (concurrent) return concurrent;
    try {
      await getCreditexCustodyBucket().delete(objectKey);
    } catch {
      // The immutable database receipt was not created; cleanup is best effort.
    }
    throw error;
  }
}

type CompletedUploadRecord = {
  session_id: string;
  device_id: string;
  client_upload_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  evidence_envelope: string;
  original_sha256: string;
  completed_at: string;
  media_id: string;
  integrity_receipt_id: string;
  upload_source: "mobile" | "browser";
};

async function completedUpload(
  database: D1Database,
  input: {
    scope: CreditexWorkPackTradeScope;
    row: WorkPackInstanceRecord;
    clientUploadId: string;
    deviceId?: string;
  },
) {
  const record = await database.prepare(`SELECT session.id session_id,
      session.device_id, session.client_upload_id, session.object_key,
      session.file_name, session.content_type, session.size_bytes,
      session.evidence_envelope, session.original_sha256,
      session.completed_at, session.media_id,
      guard.id integrity_receipt_id, 'mobile' upload_source
    FROM trade_mobile_upload_sessions session
    JOIN trade_mobile_upload_finalisation_guards guard
      ON guard.session_id = session.id
      AND guard.owner_uid = session.owner_uid
      AND guard.step_number = 2
      AND guard.verified = 1
    JOIN trade_crm_job_media media
      ON media.id = session.media_id
      AND media.firebase_uid = session.owner_uid
      AND media.work_order_id = session.work_order_id
      AND media.object_key = session.object_key
      AND media.content_type = session.content_type
      AND media.size_bytes = session.size_bytes
      AND media.original_sha256 = session.original_sha256
    WHERE session.owner_uid = ? AND session.actor_uid = ?
      AND session.member_id = ? AND session.work_order_id = ?
      AND session.client_upload_id = ? AND session.status = 'completed'
      AND (? = '' OR session.device_id = ?)
    LIMIT 1`)
    .bind(
      input.scope.ownerUid,
      input.scope.actorUid,
      input.scope.actorMemberId,
      input.row.work_order_id,
      text(
        input.clientUploadId,
        180,
        "WORK_PACK_UPLOAD_REQUIRED",
        "Completed upload",
      ),
      optionalText(input.deviceId, 180),
      optionalText(input.deviceId, 180),
    )
    .first<CompletedUploadRecord>();
  const browser = record || await database.prepare(`SELECT
      receipt.id session_id, receipt.device_id, receipt.client_upload_id,
      receipt.object_key, receipt.file_name, receipt.content_type,
      receipt.size_bytes, receipt.metadata_snapshot evidence_envelope,
      receipt.original_sha256, receipt.captured_at completed_at,
      '' media_id, receipt.id integrity_receipt_id, 'browser' upload_source
    FROM compliance_activity_work_pack_browser_upload_receipts receipt
    WHERE receipt.owner_uid = ? AND receipt.actor_uid = ?
      AND receipt.member_id = ? AND receipt.work_order_id = ?
      AND receipt.instance_key = ? AND receipt.client_upload_id = ?
      AND (? = '' OR receipt.device_id = ?)
    LIMIT 1`)
    .bind(
      input.scope.ownerUid,
      input.scope.actorUid,
      input.scope.actorMemberId,
      input.row.work_order_id,
      input.row.instance_key,
      text(
        input.clientUploadId,
        180,
        "WORK_PACK_UPLOAD_REQUIRED",
        "Completed upload",
      ),
      optionalText(input.deviceId, 180),
      optionalText(input.deviceId, 180),
    )
    .first<CompletedUploadRecord>();
  if (!browser || !/^[0-9a-f]{64}$/.test(browser.original_sha256)) {
    return fail(
      "WORK_PACK_EXACT_UPLOAD_REQUIRED",
      409,
      "Complete the exact field file upload before linking it to this work pack.",
    );
  }
  return browser;
}

function retainedSignaturePayloadFromPdf(bytes: Uint8Array) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(
      "WORK_PACK_SIGNATURE_CONTAINER_INVALID",
      409,
      "The retained signature PDF is not the supported exact UTF-8 container.",
    );
  }
  const streams = [...source.matchAll(
    /<<\s*\/Type\s*\/EmbeddedFile\b[\s\S]*?>>\s*\r?\nstream\r?\n([\s\S]*?)\r?\nendstream/g,
  )];
  if (streams.length !== 1) {
    return fail(
      "WORK_PACK_SIGNATURE_CONTAINER_INVALID",
      409,
      "The retained signature PDF must contain one exact embedded signature payload.",
    );
  }
  try {
    return object(
      JSON.parse(streams[0][1]),
      "WORK_PACK_SIGNATURE_CONTAINER_INVALID",
      "The retained signature PDF payload is invalid.",
    );
  } catch (error) {
    if (error instanceof CreditexActivityWorkPackServerError) throw error;
    return fail(
      "WORK_PACK_SIGNATURE_CONTAINER_INVALID",
      409,
      "The retained signature PDF payload is invalid.",
    );
  }
}

async function verifyRetainedSignaturePayload(
  upload: CompletedUploadRecord,
  payload: CreditexActivityWorkPackSignaturePayload,
  payloadSha256: string,
) {
  const retained = await exactCustodyBytes({
    objectKey: upload.object_key,
    expectedSha256: upload.original_sha256,
    expectedSizeBytes: Number(upload.size_bytes),
    expectedContentType: upload.content_type,
  });
  let decoded: Record<string, unknown>;
  if (upload.content_type.toLowerCase() === "application/json") {
    try {
      decoded = object(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes)),
        "WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED",
        "The retained signature JSON is invalid.",
      );
    } catch (error) {
      if (error instanceof CreditexActivityWorkPackServerError) throw error;
      return fail(
        "WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED",
        409,
        "The retained signature JSON is invalid.",
      );
    }
  } else if (upload.content_type.toLowerCase() === "application/pdf") {
    decoded = retainedSignaturePayloadFromPdf(retained.bytes);
  } else {
    return fail(
      "WORK_PACK_SIGNATURE_CONTAINER_UNSUPPORTED",
      415,
      "Governed signatures require the exact JSON payload or supported PDF signature container.",
    );
  }
  if (
    decoded.contract !== CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT
    || creditexCanonicalSha256(decoded) !== payloadSha256
    || creditexCanonicalSha256(decoded) !== creditexCanonicalSha256(payload)
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED",
      409,
      "The retained signature bytes do not contain this exact governed signature payload.",
    );
  }
}

function artifactMetadata(upload: CompletedUploadRecord) {
  const evidence = parseObject(
    upload.evidence_envelope,
    "WORK_PACK_ARTIFACT_METADATA_INVALID",
    "The completed upload is missing governed capture metadata.",
  );
  if (upload.upload_source === "browser") {
    if (
      evidence.contract !== "creditex-work-pack-artifact-metadata/v1"
      || evidence.originalSha256 !== upload.original_sha256
      || evidence.deviceId !== upload.device_id
      || !ISO_INSTANT_PATTERN.test(String(evidence.capturedAt || ""))
    ) {
      return fail(
        "WORK_PACK_ARTIFACT_METADATA_INVALID",
        409,
        "The browser custody receipt no longer matches its governed metadata.",
      );
    }
    return Object.freeze({
      metadata: evidence,
      metadataSha256: creditexCanonicalSha256(evidence),
      capturedAt: String(evidence.capturedAt),
    });
  }
  const capture = evidence.capture && typeof evidence.capture === "object"
    ? evidence.capture as Record<string, unknown>
    : {};
  const original = evidence.original && typeof evidence.original === "object"
    ? evidence.original as Record<string, unknown>
    : {};
  const location = evidence.location && typeof evidence.location === "object"
    ? evidence.location as Record<string, unknown>
    : {};
  const capturedAt = ISO_INSTANT_PATTERN.test(String(capture.observedAtUtc || ""))
    ? String(capture.observedAtUtc)
    : upload.completed_at;
  const metadata = Object.freeze({
    contract: "creditex-work-pack-artifact-metadata/v1",
    originalSha256: upload.original_sha256,
    deviceId: upload.device_id,
    capturedAt,
    exif: original.exif && typeof original.exif === "object"
      ? original.exif
      : {},
    gps: location.state === "captured"
      ? Object.freeze({
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        accuracyMetres: Number(location.accuracyMetres),
      })
      : Object.freeze({}),
    sourceEnvelopeSha256: creditexCanonicalSha256(evidence),
  });
  return Object.freeze({
    metadata,
    metadataSha256: creditexCanonicalSha256(metadata),
    capturedAt,
  });
}

async function prepareArtifactStatements(
  database: D1Database,
  input: {
    scope: CreditexWorkPackTradeScope;
    row: WorkPackInstanceRecord;
    workPack: CreditexActivityWorkPack;
    response: CreditexActivityWorkPackResponse;
    newInstanceId: string;
    links: readonly CreditexWorkPackArtifactLinkInput[];
    now: string;
  },
) {
  if (input.links.length > 100) {
    return fail(
      "WORK_PACK_ARTIFACT_LINK_LIMIT",
      413,
      "Link at most 100 field files at once.",
    );
  }
  const statements: D1PreparedStatement[] = [];
  const active = await instanceArtifacts(database, input.row);
  const plannedCounts = new Map<string, number>();
  for (const link of input.links) {
    const location = responsePrompt(
      input.workPack,
      link.sectionKey,
      link.repeatInstanceKey,
      link.promptKey,
    );
    requireVisibleResponsePrompt(input.response, location);
    if (
      (location.prompt.type !== "photo" && location.prompt.type !== "document")
      || !location.prompt.fileRequirement
    ) {
      return fail(
        "WORK_PACK_ARTIFACT_PROMPT_INVALID",
        400,
        "This work-pack prompt does not accept a field file.",
      );
    }
    if (location.repeatInstanceKey) {
      const exists = input.response.repeatableSections[location.sectionKey]
        ?.some((instance) => instance.instanceKey === location.repeatInstanceKey);
      if (!exists) {
        return fail(
          "WORK_PACK_REPEAT_INSTANCE_REQUIRED",
          409,
          "Add the repeatable item before linking its field file.",
        );
      }
    }
    const upload = await completedUpload(database, {
      scope: input.scope,
      row: input.row,
      clientUploadId: link.clientUploadId,
      deviceId: link.deviceId,
    });
    if (!location.prompt.fileRequirement.allowedContentTypes.some((item) =>
      item.toLowerCase() === upload.content_type.toLowerCase()
    )) {
      return fail(
        "WORK_PACK_ARTIFACT_CONTENT_TYPE_INVALID",
        409,
        "The completed upload type is not allowed for this work-pack prompt.",
      );
    }
    const existing = active.filter((artifact) =>
      artifact.promptKey === location.responseKey
      && artifact.artifactKind === location.prompt.type
    );
    const added = plannedCounts.get(location.responseKey) || 0;
    const maximum = location.prompt.fileRequirement.maximumCount;
    let supersedesArtifactId = "";
    if (existing.length + added >= maximum) {
      if (maximum === 1 && existing.length === 1 && added === 0) {
        supersedesArtifactId = existing[0].id;
      } else {
        return fail(
          "WORK_PACK_ARTIFACT_MAXIMUM_REACHED",
          409,
          `${location.prompt.label} already has the maximum number of files.`,
        );
      }
    }
    const metadata = artifactMetadata(upload);
    const artifactId = `work-pack-artifact:${crypto.randomUUID()}`;
    statements.push(database.prepare(`INSERT INTO compliance_activity_work_pack_artifacts
      (id, organisation_id, instance_key, case_instance_id, prompt_key,
       artifact_kind, object_key, original_file_name, content_type, size_bytes,
       original_sha256, metadata_snapshot, metadata_sha256,
       integrity_receipt_id, verification_state, supersedes_artifact_id,
       captured_device_id, captured_by_uid, captured_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?)`)
      .bind(
        artifactId,
        input.row.organisation_id,
        input.row.instance_key,
        input.newInstanceId,
        location.responseKey,
        location.prompt.type,
        upload.object_key,
        upload.file_name,
        upload.content_type,
        Number(upload.size_bytes),
        upload.original_sha256,
        checkedJson(metadata.metadata),
        metadata.metadataSha256,
        upload.integrity_receipt_id,
        supersedesArtifactId,
        upload.device_id,
        input.scope.actorUid,
        metadata.capturedAt,
        input.now,
      ));
    plannedCounts.set(location.responseKey, added + 1);
  }
  return statements;
}

type ActiveSignatureRecord = Record<string, unknown> & {
  id: string;
  prompt_key: string;
  signer_role: string;
  signer_name: string;
  action: string;
};

async function activeSignatureRecords(
  database: D1Database,
  row: WorkPackInstanceRecord,
) {
  const records = await database.prepare(`SELECT signature.*
    FROM compliance_activity_work_pack_signatures signature
    WHERE signature.organisation_id = ? AND signature.instance_key = ?
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_signatures successor
        WHERE successor.supersedes_signature_id = signature.id
      )
    ORDER BY signature.prompt_key, signature.signer_role,
      signature.signer_name, signature.id`)
    .bind(row.organisation_id, row.instance_key)
    .all<ActiveSignatureRecord>();
  return records.results;
}

function signatureSuccessorStatement(
  database: D1Database,
  input: {
    prior: ActiveSignatureRecord;
    id: string;
    caseInstanceId: string;
    action: "revoked" | "captured";
    createdAt: string;
  },
) {
  const prior = input.prior;
  return database.prepare(`INSERT INTO compliance_activity_work_pack_signatures
    (id, organisation_id, instance_key, case_instance_id, prompt_key,
     signer_role, signer_capacity, signer_name, signer_uid,
     signer_identity_snapshot, signer_identity_sha256, signature_sha256,
     signature_object_key, signature_content_type, signature_size_bytes,
     signature_payload_contract, signature_payload_snapshot,
     signature_payload_sha256, integrity_receipt_id, attestation_snapshot,
     attestation_sha256, definition_sha256, prefill_sha256, response_sha256,
     declarations_sha256, action, supersedes_signature_id, app_id,
     app_version, app_build, capture_session_id, captured_device_id,
     captured_by_uid, device_attestation_snapshot, device_attestation_sha256,
     signed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id,
      String(prior.organisation_id),
      String(prior.instance_key),
      input.caseInstanceId,
      String(prior.prompt_key),
      String(prior.signer_role),
      String(prior.signer_capacity),
      String(prior.signer_name),
      String(prior.signer_uid || ""),
      String(prior.signer_identity_snapshot),
      String(prior.signer_identity_sha256),
      String(prior.signature_sha256),
      String(prior.signature_object_key),
      String(prior.signature_content_type),
      Number(prior.signature_size_bytes),
      String(prior.signature_payload_contract),
      String(prior.signature_payload_snapshot),
      String(prior.signature_payload_sha256),
      String(prior.integrity_receipt_id),
      String(prior.attestation_snapshot),
      String(prior.attestation_sha256),
      String(prior.definition_sha256),
      String(prior.prefill_sha256),
      String(prior.response_sha256),
      String(prior.declarations_sha256),
      input.action,
      String(prior.id),
      String(prior.app_id),
      String(prior.app_version),
      String(prior.app_build),
      String(prior.capture_session_id),
      String(prior.captured_device_id),
      String(prior.captured_by_uid),
      String(prior.device_attestation_snapshot),
      String(prior.device_attestation_sha256),
      String(prior.signed_at),
      input.createdAt,
    );
}

async function signatureRevocationStatements(
  database: D1Database,
  row: WorkPackInstanceRecord,
  createdAt: string,
) {
  const active = (await activeSignatureRecords(database, row)).filter(
    (signature) => signature.action === "captured",
  );
  return active.map((prior) => signatureSuccessorStatement(database, {
    prior,
    id: `work-pack-signature-revocation:${crypto.randomUUID()}`,
    caseInstanceId: String(prior.case_instance_id),
    action: "revoked",
    createdAt,
  }));
}

export async function commitAssignedCreditexActivityWorkPack(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    sectionPatches?: readonly CreditexWorkPackSectionPatch[];
    dependencyResolutions?: Readonly<Record<string, CreditexWorkPackDependencyInput>>;
    referenceAcknowledgements?: readonly CreditexWorkPackReferenceAcknowledgementInput[];
    artifactLinks?: readonly CreditexWorkPackArtifactLinkInput[];
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_commit",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot be edited.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before saving.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved);
  let response = patchResponse(
    resolved.workPack,
    prior.response,
    input.sectionPatches || [],
  );
  response = await applyReferenceAcknowledgements(
    database,
    row,
    resolved.workPack,
    response,
    input.referenceAcknowledgements || [],
  );
  const dependencies = await resolveServerDependencies(
    database,
    row,
    resolved.workPack,
    input.dependencyResolutions || {},
  );
  response = validateResponseValues(resolved.workPack, Object.freeze({
    ...response,
    dependencyResolutions: dependencies.resolutions,
  }));
  const executionContexts = await loadServerExecutionContexts(database, {
    organisationId: row.organisation_id,
    ownerUid: row.installer_uid,
    workOrderId: row.work_order_id,
  });
  const envelope = nextInstanceEnvelope(
    prior,
    response,
    prior.prefill.customerContext,
    executionContexts,
  );
  if (creditexCanonicalSha256(envelope) === row.response_sha256
    && !(input.artifactLinks || []).length) {
    return fail(
      "WORK_PACK_NO_CHANGES",
      409,
      "This save does not change the work pack.",
    );
  }
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Save time")
    : new Date().toISOString();
  const newInstanceId = `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const artifactStatements = await prepareArtifactStatements(database, {
    scope: input,
    row,
    workPack: resolved.workPack,
    response,
    newInstanceId,
    links: input.artifactLinks || [],
    now,
  });
  const revocationStatements = row.status === "ready_to_sign"
    ? await signatureRevocationStatements(database, row, now)
    : [];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_commit",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements: [
      ...revocationStatements,
      appendInstanceStatement(database, row, {
        id: newInstanceId,
        status: "in_progress",
        envelope,
        actorUid: input.actorUid,
        createdAt: now,
      }),
      ...artifactStatements,
    ],
  });
}

export async function selectAssignedCreditexActivityWorkPackScenario(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    dependencyKey: string;
    scenarioCode: string;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_select_scenario",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot change its governed scenario.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before choosing its scenario.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved);
  const dependencyKey = text(
    input.dependencyKey,
    180,
    "WORK_PACK_DEPENDENCY_REQUIRED",
    "Scenario dependency",
  );
  const dependency = resolved.workPack.dependencies.find((candidate) =>
    candidate.dependencyKey === dependencyKey && candidate.kind === "scenario"
  );
  if (!dependency || dependency.kind !== "scenario") {
    return fail(
      "WORK_PACK_SCENARIO_DEPENDENCY_INVALID",
      400,
      "Choose a scenario dependency from this exact activity form.",
    );
  }
  const scenarioCode = text(
    input.scenarioCode,
    180,
    "WORK_PACK_SCENARIO_REQUIRED",
    "Scenario",
  );
  if (!dependency.scenarioCodes.includes(scenarioCode)) {
    return fail(
      "WORK_PACK_SCENARIO_INVALID",
      400,
      "Choose a scenario from the exact independently approved activity source.",
    );
  }
  const sourceBindings = await approvedDependencySourceIdentity(
    database,
    row,
    resolved.workPack,
    dependency,
  );
  const snapshotSha256 = scenarioResolutionSha256({
    row,
    dependencyKey,
    scenarioCode,
    sourceBindings,
  });
  const response = validateResponseValues(resolved.workPack, Object.freeze({
    ...prior.response,
    dependencyResolutions: Object.freeze({
      ...prior.response.dependencyResolutions,
      [dependencyKey]: Object.freeze({
        status: "resolved" as const,
        referenceIds: Object.freeze([scenarioCode]),
        snapshotSha256,
      }),
    }),
  }));
  const envelope = nextInstanceEnvelope(prior, response);
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Scenario selection time")
    : new Date().toISOString();
  const newInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const statements = [
    ...(row.status === "ready_to_sign"
      ? await signatureRevocationStatements(database, row, now)
      : []),
    appendInstanceStatement(database, row, {
      id: newInstanceId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
  ];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_select_scenario",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements,
  });
}

export async function selectAssignedCreditexActivityWorkPackOfficialProducts(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    dependencyKey: string;
    selections: readonly CreditexWorkPackOfficialProductSelectionInput[];
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_select_official_products",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot change its installed products.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before selecting products.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved);
  const dependencyKey = text(
    input.dependencyKey,
    180,
    "WORK_PACK_DEPENDENCY_REQUIRED",
    "Product dependency",
  );
  const dependency = resolved.workPack.dependencies.find((candidate) =>
    candidate.kind === "product" && candidate.dependencyKey === dependencyKey
  );
  if (!dependency || dependency.kind !== "product" || !dependency.required
    || dependency.productKind === "not_applicable") {
    return fail(
      "WORK_PACK_PRODUCT_DEPENDENCY_INVALID",
      400,
      "Choose a required official-product dependency from this exact activity form.",
    );
  }
  if (!Array.isArray(input.selections)
    || input.selections.length < dependency.minimumCount
    || input.selections.length > dependency.maximumCount
    || (dependency.selectionMode === "single" && input.selections.length !== 1)) {
    return fail(
      "WORK_PACK_PRODUCT_COUNT_INVALID",
      400,
      "Select the exact number of official products required by this activity form.",
    );
  }
  const normalisedSelections = input.selections.map((selection) => Object.freeze({
    selectionId: text(
      selection.selectionId,
      700,
      "WORK_PACK_PRODUCT_SELECTION_REQUIRED",
      "Official product selection",
    ),
    snapshotId: text(
      selection.snapshotId,
      160,
      "WORK_PACK_PRODUCT_SNAPSHOT_REQUIRED",
      "Official product snapshot",
    ),
    quantity: safeInteger(
      selection.quantity,
      1,
      "WORK_PACK_PRODUCT_QUANTITY_INVALID",
      "Installed product quantity",
    ),
  }));
  if (normalisedSelections.some((selection) => selection.quantity > 1000)
    || new Set(normalisedSelections.map((selection) =>
      `${selection.snapshotId}\u001f${selection.selectionId}`
    )).size !== normalisedSelections.length) {
    return fail(
      "WORK_PACK_PRODUCT_SELECTION_INVALID",
      400,
      "Official product selections must be unique with a valid installed quantity.",
    );
  }
  const sourceBindings = await approvedDependencySourceIdentity(
    database,
    row,
    resolved.workPack,
    dependency,
  );
  const officialSelections = await Promise.all(normalisedSelections.map(
    (selection) => exactOfficialProductSelection(
      database,
      row,
      dependency,
      selection.selectionId,
      selection.snapshotId,
    ),
  ));
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Product selection time")
    : new Date().toISOString();
  const equipmentRecords = officialSelections.map((selection, index) => {
    const equipmentRecordId = `work-pack-equipment:${crypto.randomUUID()}`;
    const quantity = normalisedSelections[index].quantity;
    const evidence = officialProductSelectionEvidence({
      row,
      dependencyKey,
      selection,
      sourceBindings,
      quantity,
      selectedByUid: input.actorUid,
      selectedAt: now,
    });
    return Object.freeze({
      equipmentRecordId,
      selection,
      quantity,
      evidence,
    });
  });
  const resolvedProductRecords = equipmentRecords.map((record) => Object.freeze({
    equipmentRecordId: record.equipmentRecordId,
    ...record.selection,
    quantity: record.quantity,
    status: "installed",
  }));
  const productResolutionSha256 = creditexCanonicalSha256({
    contract: "creditex-work-pack-product-resolution/v1",
    dependencyKey,
    caseId: row.compliance_case_id,
    activityDate: row.activity_date,
    records: resolvedProductRecords,
  });
  const response = validateResponseValues(resolved.workPack, Object.freeze({
    ...prior.response,
    dependencyResolutions: Object.freeze({
      ...prior.response.dependencyResolutions,
      [dependencyKey]: Object.freeze({
        status: "resolved" as const,
        referenceIds: Object.freeze(equipmentRecords.map((record) =>
          record.equipmentRecordId
        )),
        snapshotSha256: productResolutionSha256,
      }),
    }),
  }));
  const envelope = nextInstanceEnvelope(prior, response);
  const newInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const equipmentStatements = equipmentRecords.map((record) =>
    database.prepare(`INSERT INTO compliance_equipment_records (
        id, organisation_id, case_id, record_type, manufacturer, model,
        serial_number, product_registry, product_reference, quantity, status,
        evidence_snapshot, recorded_by_uid, recorded_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'installed', ?, ?, '', ?, ?, ?, 'installed',
        ?, ?, ?, ?, ?)`)
      .bind(
        record.equipmentRecordId,
        row.organisation_id,
        row.compliance_case_id,
        record.selection.manufacturer || record.selection.brand,
        record.selection.model,
        dependency.registryCode,
        record.selection.selectionId,
        record.quantity,
        checkedJson(record.evidence),
        input.actorUid,
        now,
        now,
        now,
      )
  );
  const statements = [
    ...(row.status === "ready_to_sign"
      ? await signatureRevocationStatements(database, row, now)
      : []),
    ...equipmentStatements,
    appendInstanceStatement(database, row, {
      id: newInstanceId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
  ];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_select_official_products",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements,
  });
}

function plainCalculatorDecimal(value: number) {
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const matched = raw.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!matched) {
    return fail(
      "WORK_PACK_CALCULATOR_INPUT_INVALID",
      409,
      "A governed numeric answer cannot be represented by the exact calculator decimal contract.",
    );
  }
  const sign = matched[1];
  const integer = matched[2];
  const fraction = matched[3] || "";
  const exponent = Number(matched[4]);
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function assignedCalculatorInputs(
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
  dependency: Extract<CreditexWorkPackDependency, { kind: "calculator" }>,
  specification: CreditexCalculatorSpecification,
): CreditexCalculatorInputs {
  const inputs: CreditexCalculatorInputs = {};
  for (const definition of specification.inputs) {
    const locations = workPack.sections.flatMap((section) =>
      section.prompts.filter((prompt) => prompt.promptKey === definition.key)
        .map((prompt) => ({ section, prompt }))
    );
    if (
      locations.length !== 1
      || locations[0].section.repeatability
      || locations[0].prompt.type !== "number"
      || locations[0].prompt.unit !== definition.unit
      || !creditexActivityWorkPackVisibilityMatches(
        locations[0].section.visibility,
        response.answers,
      )
      || !creditexActivityWorkPackVisibilityMatches(
        locations[0].prompt.visibility,
        response.answers,
        response.answers,
      )
    ) {
      return fail(
        "WORK_PACK_CALCULATOR_INPUT_MAPPING_INVALID",
        409,
        `Calculator input ${definition.key} must map to one visible non-repeatable governed number prompt with the exact unit.`,
      );
    }
    const answer = response.answers[definition.key];
    if (typeof answer !== "number" || !Number.isFinite(answer)) {
      return fail(
        "WORK_PACK_CALCULATOR_INPUT_REQUIRED",
        409,
        `Complete the governed ${locations[0].prompt.label} answer before running the calculator.`,
      );
    }
    inputs[definition.key] = Object.freeze({
      value: plainCalculatorDecimal(answer),
      unit: definition.unit,
    });
  }
  if (!sameStringSet(Object.keys(inputs), dependency.requiredInputKeys)) {
    return fail(
      "WORK_PACK_CALCULATOR_INPUT_MAPPING_INVALID",
      409,
      "The governed form and approved calculator do not declare the same exact input set.",
    );
  }
  return Object.freeze(inputs);
}

export async function runAssignedCreditexActivityWorkPackCalculator(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    dependencyKey: string;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_run_calculator",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot run another calculator.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before running its calculator.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved);
  const dependencyKey = text(
    input.dependencyKey,
    180,
    "WORK_PACK_DEPENDENCY_REQUIRED",
    "Calculator dependency",
  );
  const dependency = resolved.workPack.dependencies.find((candidate) =>
    candidate.kind === "calculator" && candidate.dependencyKey === dependencyKey
  );
  if (!dependency || dependency.kind !== "calculator" || !dependency.required) {
    return fail(
      "WORK_PACK_CALCULATOR_DEPENDENCY_INVALID",
      400,
      "Choose a required calculator dependency from this exact activity form.",
    );
  }
  const basis = await assignedCalculatorExecutionBasis(
    database,
    row,
    resolved.workPack,
    dependency,
  );
  const calculatorInputs = assignedCalculatorInputs(
    resolved.workPack,
    prior.response,
    dependency,
    basis.specification,
  );
  let execution: ReturnType<typeof evaluateCreditexCalculator>;
  try {
    execution = evaluateCreditexCalculator(basis.specification, calculatorInputs);
  } catch {
    return fail(
      "WORK_PACK_CALCULATOR_INPUT_INVALID",
      409,
      "The governed field answers do not satisfy the exact approved calculator input contract.",
    );
  }
  if (execution.engineContractHash !== basis.engineContractSha256) {
    return fail(
      "WORK_PACK_CALCULATOR_ENGINE_MISMATCH",
      409,
      "The deterministic calculator engine no longer matches its approved execution receipt.",
    );
  }
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find((candidate) =>
    candidate.templateId === resolved.workPack.activityTemplateId
  );
  const program = activity && GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
    candidate.programCode === activity.programCode
  );
  if (
    program?.outcomeClass === "tradable_certificate"
    && execution.output.unit !== program.claimOutputCode
  ) {
    return fail(
      "WORK_PACK_CALCULATOR_OUTPUT_UNIT_INVALID",
      409,
      "The approved calculator output unit does not match the governed programme certificate type.",
    );
  }
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Calculator execution time")
    : new Date().toISOString();
  const calculationRunId = `work-pack-calculation:${crypto.randomUUID()}`;
  const response = validateResponseValues(resolved.workPack, Object.freeze({
    ...prior.response,
    dependencyResolutions: Object.freeze({
      ...prior.response.dependencyResolutions,
      [dependencyKey]: Object.freeze({
        status: "blocked" as const,
        referenceIds: Object.freeze([calculationRunId]),
        snapshotSha256: "",
      }),
    }),
  }));
  const envelope = nextInstanceEnvelope(prior, response);
  const newInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const statements = [
    ...(row.status === "ready_to_sign"
      ? await signatureRevocationStatements(database, row, now)
      : []),
    database.prepare(`INSERT INTO compliance_calculation_runs (
        id, organisation_id, case_id, case_revision, calculator_version_id,
        input_snapshot, output_snapshot, status, blocked_reason, run_by_uid,
        run_at, verified_by_uid, verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'calculated',
        'Independent Creditex review required.', ?, ?, '', '', ?)`)
      .bind(
        calculationRunId,
        row.organisation_id,
        row.compliance_case_id,
        Number(row.case_revision),
        basis.calculatorVersionId,
        checkedJson(calculatorInputs),
        checkedJson(execution),
        input.actorUid,
        now,
        now,
      ),
    appendInstanceStatement(database, row, {
      id: newInstanceId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
  ];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_run_calculator",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements,
  });
}

function visibleSignaturePromptKeys(
  workPack: CreditexActivityWorkPack,
  response: CreditexActivityWorkPackResponse,
) {
  const keys = new Set<string>();
  for (const section of workPack.sections) {
    if (!creditexActivityWorkPackVisibilityMatches(
      section.visibility,
      response.answers,
    )) continue;
    const instances = section.repeatability
      ? response.repeatableSections[section.sectionKey] || []
      : [{ instanceKey: "", answers: response.answers }];
    for (const instance of instances) {
      for (const prompt of section.prompts) {
        if (
          prompt.type !== "signature"
          || !creditexActivityWorkPackVisibilityMatches(
            prompt.visibility,
            response.answers,
            instance.answers,
          )
        ) continue;
        keys.add(section.repeatability
          ? `${section.sectionKey}[${instance.instanceKey}].${prompt.promptKey}`
          : prompt.promptKey);
      }
    }
  }
  return keys;
}

export async function prepareAssignedCreditexActivityWorkPackSigning(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_prepare_signing",
  });
  if (replay) return replay;
  if (row.status !== "not_started" && row.status !== "in_progress") {
    return fail(
      "WORK_PACK_NOT_EDITABLE",
      409,
      row.status === "ready_to_sign"
        ? "This work pack is already ready for signatures."
        : "This work pack cannot move to signing from its current state.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before preparing signatures.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  let envelope = validateInstanceEnvelope(row, resolved, {
    allowStaleExecutionContext: true,
  });
  let projection = await projectAssignedInstance(database, row, input.actorUid);
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Signing preparation time")
    : new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let base = row;
  const liveResponse = validateResponseValues(
    resolved.workPack,
    Object.freeze({
      ...envelope.response,
      dependencyResolutions: projection.response.dependencyResolutions,
    }),
  );
  const dependencyResolutionStale = creditexCanonicalSha256(
    envelope.response.dependencyResolutions,
  ) !== creditexCanonicalSha256(liveResponse.dependencyResolutions);
  if (projection.executionContextStale || dependencyResolutionStale) {
    const executionContexts = projection.executionContextStale
      ? await loadServerExecutionContexts(database, {
          organisationId: row.organisation_id,
          ownerUid: row.installer_uid,
          workOrderId: row.work_order_id,
        })
      : {
          providerContext: envelope.prefill.providerContext,
          installerBusinessContext: envelope.prefill.installerBusinessContext,
          assignmentContext: envelope.prefill.assignmentContext,
          jobContext: envelope.prefill.jobContext,
        };
    envelope = nextInstanceEnvelope(
      envelope,
      liveResponse,
      envelope.prefill.customerContext,
      executionContexts,
      envelope.prefill.customerSnapshot,
    );
    const refreshedId =
      `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
    statements.push(
      ...await signatureRevocationStatements(database, row, now),
      appendInstanceStatement(database, row, {
        id: refreshedId,
        status: "in_progress",
        envelope,
        actorUid: input.actorUid,
        createdAt: now,
      }),
    );
    base = {
      ...row,
      id: refreshedId,
      revision: Number(row.revision) + 1,
      supersedes_instance_id: row.id,
      status: "in_progress",
      response_snapshot: checkedJson(envelope),
      response_sha256: creditexCanonicalSha256(envelope),
      created_by_uid: input.actorUid,
      created_at: now,
    };
    projection = await projectAssignedInstance(database, base, input.actorUid);
  }
  const signatureKeys = visibleSignaturePromptKeys(
    resolved.workPack,
    projection.response,
  );
  if (!signatureKeys.size) {
    return fail(
      "WORK_PACK_SIGNATURE_PROMPT_REQUIRED",
      409,
      "This work-pack definition has no currently visible signature prompt.",
    );
  }
  const nonSignatureBlockers = projection.completion.blockers.filter(
    (blocker) => !signatureKeys.has(blocker.key),
  );
  if (nonSignatureBlockers.length) {
    return fail(
      "WORK_PACK_COMPLETION_REQUIRED",
      409,
      nonSignatureBlockers[0].message,
    );
  }
  if (base.status === "not_started") {
    const inProgressId =
      `work-pack:${row.compliance_case_id}:revision:${Number(base.revision) + 1}`;
    statements.push(appendInstanceStatement(database, base, {
      id: inProgressId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }));
    base = {
      ...base,
      id: inProgressId,
      revision: Number(base.revision) + 1,
      supersedes_instance_id: base.id,
      status: "in_progress",
      response_snapshot: checkedJson(envelope),
      response_sha256: creditexCanonicalSha256(envelope),
      created_by_uid: input.actorUid,
      created_at: now,
    };
  }
  const readyId =
    `work-pack:${row.compliance_case_id}:revision:${Number(base.revision) + 1}`;
  statements.push(appendInstanceStatement(database, base, {
    id: readyId,
    status: "ready_to_sign",
    envelope,
    actorUid: input.actorUid,
    createdAt: now,
  }));
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_prepare_signing",
    resultRevision: Number(base.revision) + 1,
    newInstanceId: readyId,
    now,
    statements,
  });
}

export type CreditexWorkPackSignaturePacketInput = Readonly<{
  sectionKey: string;
  repeatInstanceKey?: string;
  promptKey: string;
  clientUploadId: string;
  signerIdentity: CreditexActivityWorkPackSignerIdentity;
  signerIdentitySha256: string;
  signaturePayload: CreditexActivityWorkPackSignaturePayload;
  signaturePayloadSha256: string;
  attestation: CreditexActivityWorkPackSignatureAttestation;
  attestationSha256: string;
  deviceAttestation: CreditexActivityWorkPackDeviceAttestation;
  deviceAttestationSha256: string;
  signatureSha256: string;
}>;

function exactCanonicalHash(
  value: unknown,
  supplied: unknown,
  code: string,
  label: string,
) {
  const expected = normaliseSha256(supplied, code, label);
  if (creditexCanonicalSha256(value) !== expected) {
    return fail(code, 400, `${label} does not match the submitted content.`);
  }
  return expected;
}

function stringRecord(
  value: unknown,
  code: string,
  label: string,
) {
  const source = object(value, code, `${label} must be an object.`);
  const entries = Object.entries(source);
  if (
    entries.length > 40
    || entries.some(([key, item]) =>
      !key || key.length > 120 || typeof item !== "string" || item.length > 500
    )
  ) {
    return fail(code, 400, `${label} has invalid fields.`);
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, string>>;
}

function signaturePoints(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return fail(
      "WORK_PACK_SIGNATURE_STROKES_INVALID",
      400,
      "Capture at least one valid signature stroke.",
    );
  }
  for (const strokeValue of value) {
    const stroke = object(
      strokeValue,
      "WORK_PACK_SIGNATURE_STROKES_INVALID",
      "A signature stroke is invalid.",
    );
    if (!Array.isArray(stroke.points)
      || stroke.points.length < 1 || stroke.points.length > 10_000) {
      return fail(
        "WORK_PACK_SIGNATURE_STROKES_INVALID",
        400,
        "A signature stroke has an invalid number of points.",
      );
    }
    for (const pointValue of stroke.points) {
      const point = object(
        pointValue,
        "WORK_PACK_SIGNATURE_STROKES_INVALID",
        "A signature point is invalid.",
      );
      if (
        !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || Number(point.x) < 0 || Number(point.x) > 1
        || Number(point.y) < 0 || Number(point.y) > 1
        || (
          point.pressure !== null
          && (!Number.isFinite(point.pressure)
            || Number(point.pressure) < 0 || Number(point.pressure) > 1)
        )
        || !Number.isSafeInteger(point.capturedAtOffsetMs)
        || Number(point.capturedAtOffsetMs) < 0
      ) {
        return fail(
          "WORK_PACK_SIGNATURE_STROKES_INVALID",
          400,
          "A signature point is outside the supported capture range.",
        );
      }
    }
  }
}

function validateSignaturePacket(
  input: {
    scope: CreditexWorkPackTradeScope;
    row: WorkPackInstanceRecord;
    envelope: CreditexActivityWorkPackInstanceEnvelope;
    workPack: CreditexActivityWorkPack;
    packet: CreditexWorkPackSignaturePacketInput;
    idempotencyDeviceId: string;
    capturedAt: string;
  },
) {
  const location = responsePrompt(
    input.workPack,
    input.packet.sectionKey,
    input.packet.repeatInstanceKey,
    input.packet.promptKey,
  );
  requireVisibleResponsePrompt(input.envelope.response, location);
  if (
    location.prompt.type !== "signature"
    || !location.prompt.attestation
    || !location.prompt.signerRoleKey
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_PROMPT_INVALID",
      400,
      "This prompt does not accept a governed signature.",
    );
  }
  if (location.repeatInstanceKey) {
    const instanceExists = input.envelope.response.repeatableSections[
      location.sectionKey
    ]?.some((instance) => instance.instanceKey === location.repeatInstanceKey);
    if (!instanceExists) {
      return fail(
        "WORK_PACK_REPEAT_INSTANCE_REQUIRED",
        409,
        "Add the repeatable item before capturing its signature.",
      );
    }
  }
  const role = input.workPack.signerRoles.find((candidate) =>
    candidate.roleKey === location.prompt.signerRoleKey
  );
  if (!role) {
    return fail(
      "WORK_PACK_SIGNER_ROLE_INVALID",
      409,
      "The pinned work pack has no valid signer role for this prompt.",
    );
  }
  const identitySource = input.packet.signerIdentity as unknown;
  const identity = object(
    identitySource,
    "WORK_PACK_SIGNER_IDENTITY_INVALID",
    "Signer identity is required.",
  );
  const authoritative = authoritativeSignerBinding(
    input.envelope,
    role,
    input.scope.actorUid,
    { enforceCaptureActor: true },
  );
  const fields = stringRecord(
    identity.fields,
    "WORK_PACK_SIGNER_IDENTITY_INVALID",
    "Signer identity fields",
  );
  if (
    identity.contract !== CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT
    || identity.roleKey !== role.roleKey
    || identity.capacity !== role.capacity
    || identity.identitySource !== role.identitySource
    || identity.signerName !== authoritative.signerName
    || identity.signerUid !== authoritative.signerUid
    || creditexCanonicalSha256(fields)
      !== creditexCanonicalSha256(authoritative.fields)
  ) {
    return fail(
      "WORK_PACK_SIGNER_IDENTITY_INVALID",
      409,
      "Signer identity does not match this exact governed signer role.",
    );
  }
  const signerIdentity = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
    roleKey: role.roleKey,
    capacity: role.capacity,
    identitySource: role.identitySource,
    signerName: authoritative.signerName,
    signerUid: authoritative.signerUid,
    fields: authoritative.fields,
  }) satisfies CreditexActivityWorkPackSignerIdentity;
  const signerIdentitySha256 = exactCanonicalHash(
    signerIdentity,
    input.packet.signerIdentitySha256,
    "WORK_PACK_SIGNER_IDENTITY_HASH_INVALID",
    "Signer identity SHA-256",
  );
  const attestationValue = object(
    input.packet.attestation,
    "WORK_PACK_SIGNATURE_ATTESTATION_INVALID",
    "Signature attestation is required.",
  );
  const attestation = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
    promptKey: location.responseKey,
    signerRoleKey: role.roleKey,
    text: location.prompt.attestation.text,
    version: location.prompt.attestation.version,
    sourceBindingTargetKey:
      location.prompt.attestation.sourceBindingTargetKey,
    signerIdentity,
    signerIdentitySha256,
    definitionSha256: input.envelope.definitionSha256,
    prefillSha256: input.envelope.prefillSha256,
    responseSha256: input.envelope.responseSha256,
    declarationsSha256: input.envelope.declarationsSha256,
  }) satisfies CreditexActivityWorkPackSignatureAttestation;
  if (
    attestationValue.contract !== attestation.contract
    || creditexCanonicalSha256(attestationValue) !== creditexCanonicalSha256(attestation)
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_ATTESTATION_INVALID",
      409,
      "The signature attestation does not match this exact prompt and response.",
    );
  }
  const attestationSha256 = exactCanonicalHash(
    attestation,
    input.packet.attestationSha256,
    "WORK_PACK_SIGNATURE_ATTESTATION_HASH_INVALID",
    "Signature attestation SHA-256",
  );
  const payloadValue = object(
    input.packet.signaturePayload,
    "WORK_PACK_SIGNATURE_PAYLOAD_INVALID",
    "Signature payload is required.",
  );
  signaturePoints(payloadValue.strokes);
  const strokes = payloadValue.strokes as CreditexActivityWorkPackSignaturePayload["strokes"];
  const signedAt = boundedSignatureDisplayTime({
    signedAt: payloadValue.signedAt,
    preparedAt: input.row.created_at,
    capturedAt: input.capturedAt,
  });
  const payload = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
    instanceKey: input.row.instance_key,
    caseInstanceId: input.row.id,
    promptKey: location.responseKey,
    signerRoleKey: role.roleKey,
    signerName: signerIdentity.signerName,
    signerCapacity: role.capacity,
    signerIdentitySha256,
    attestationSha256,
    definitionSha256: input.envelope.definitionSha256,
    prefillSha256: input.envelope.prefillSha256,
    responseSha256: input.envelope.responseSha256,
    declarationsSha256: input.envelope.declarationsSha256,
    strokes,
    signedAt,
  }) satisfies CreditexActivityWorkPackSignaturePayload;
  if (
    payloadValue.contract !== payload.contract
    || creditexCanonicalSha256(payloadValue) !== creditexCanonicalSha256(payload)
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_PAYLOAD_INVALID",
      409,
      "The signature payload does not match this exact work-pack revision.",
    );
  }
  const signaturePayloadSha256 = exactCanonicalHash(
    payload,
    input.packet.signaturePayloadSha256,
    "WORK_PACK_SIGNATURE_PAYLOAD_HASH_INVALID",
    "Signature payload SHA-256",
  );
  const deviceValue = object(
    input.packet.deviceAttestation,
    "WORK_PACK_DEVICE_ATTESTATION_INVALID",
    "Device attestation is required.",
  );
  const deviceAttestation = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
    deviceId: text(
      deviceValue.deviceId,
      180,
      "WORK_PACK_DEVICE_REQUIRED",
      "Device ID",
    ),
    appId: text(deviceValue.appId, 180, "WORK_PACK_APP_REQUIRED", "App ID"),
    appVersion: text(
      deviceValue.appVersion,
      80,
      "WORK_PACK_APP_REQUIRED",
      "App version",
    ),
    appBuild: text(
      deviceValue.appBuild,
      80,
      "WORK_PACK_APP_REQUIRED",
      "App build",
    ),
    sessionId: text(
      deviceValue.sessionId,
      180,
      "WORK_PACK_CAPTURE_SESSION_REQUIRED",
      "Capture session",
    ),
    capturedByUid: input.scope.actorUid,
    signedAt,
    deviceContext: object(
      deviceValue.deviceContext,
      "WORK_PACK_DEVICE_ATTESTATION_INVALID",
      "Device context must be an object.",
    ) as Readonly<Record<string, string | number | boolean>>,
  }) satisfies CreditexActivityWorkPackDeviceAttestation;
  if (
    deviceAttestation.deviceId !== input.idempotencyDeviceId
    || deviceValue.contract !== deviceAttestation.contract
    || creditexCanonicalSha256(deviceValue)
      !== creditexCanonicalSha256(deviceAttestation)
    || Object.values(deviceAttestation.deviceContext).some((value) =>
      !["string", "number", "boolean"].includes(typeof value)
    )
  ) {
    return fail(
      "WORK_PACK_DEVICE_ATTESTATION_INVALID",
      409,
      "The device attestation does not match this exact signing action.",
    );
  }
  const deviceAttestationSha256 = exactCanonicalHash(
    deviceAttestation,
    input.packet.deviceAttestationSha256,
    "WORK_PACK_DEVICE_ATTESTATION_HASH_INVALID",
    "Device attestation SHA-256",
  );
  return Object.freeze({
    location,
    role,
    signerIdentity,
    signerIdentitySha256,
    attestation,
    attestationSha256,
    payload,
    signaturePayloadSha256,
    deviceAttestation,
    deviceAttestationSha256,
    signatureSha256: bareSha256(input.packet.signatureSha256),
    clientUploadId: text(
      input.packet.clientUploadId,
      180,
      "WORK_PACK_UPLOAD_REQUIRED",
      "Signature upload",
    ),
  });
}

export async function captureAssignedCreditexActivityWorkPackSignatures(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    packets: readonly CreditexWorkPackSignaturePacketInput[];
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_capture_signatures",
  });
  if (replay) return replay;
  if (row.status !== "ready_to_sign") {
    return fail(
      "WORK_PACK_NOT_READY_TO_SIGN",
      409,
      "Complete and prepare this work pack before capturing signatures.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before signing.",
    );
  }
  if (!Array.isArray(input.packets)
    || input.packets.length < 1 || input.packets.length > 20) {
    return fail(
      "WORK_PACK_SIGNATURE_PACKET_LIMIT",
      400,
      "Capture between one and 20 signature packets at once.",
    );
  }
  const idempotency = validateMutationIdempotency(input.idempotency);
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved);
  const active = await activeSignatureRecords(database, row);
  const planned = new Set<string>();
  const uploads = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Signature save time")
    : new Date().toISOString();
  for (const packetInput of input.packets) {
    const packet = validateSignaturePacket({
      scope: input,
      row,
      envelope,
      workPack: resolved.workPack,
      packet: packetInput,
      idempotencyDeviceId: idempotency.deviceId,
      capturedAt: now,
    });
    const signatureKey = `${packet.location.responseKey}\u0000${packet.role.roleKey}\u0000${packet.signerIdentity.signerName}`;
    if (planned.has(signatureKey) || uploads.has(packet.clientUploadId)) {
      return fail(
        "WORK_PACK_SIGNATURE_DUPLICATE",
        409,
        "Each signer and exact uploaded signature can be captured once per action.",
      );
    }
    const roleCount = active.filter((signature) =>
      signature.action === "captured"
      && signature.prompt_key === packet.location.responseKey
      && signature.signer_role === packet.role.roleKey
    ).length + [...planned].filter((key) => key.startsWith(
      `${packet.location.responseKey}\u0000${packet.role.roleKey}\u0000`,
    )).length;
    if (roleCount >= packet.role.maximumSignatures) {
      return fail(
        "WORK_PACK_SIGNATURE_MAXIMUM_REACHED",
        409,
        `${packet.role.label} already has the maximum number of signatures.`,
      );
    }
    const predecessor = active.find((signature) =>
      signature.prompt_key === packet.location.responseKey
      && signature.signer_role === packet.role.roleKey
      && signature.signer_name === packet.signerIdentity.signerName
    );
    if (predecessor?.action === "captured") {
      return fail(
        "WORK_PACK_SIGNATURE_ALREADY_CAPTURED",
        409,
        "Edit and prepare a superseding work-pack revision before replacing this signature.",
      );
    }
    const upload = await completedUpload(database, {
      scope: input,
      row,
      clientUploadId: packet.clientUploadId,
      deviceId: packet.deviceAttestation.deviceId,
    });
    if (
      upload.original_sha256 !== packet.signatureSha256
      || upload.session_id !== packet.deviceAttestation.sessionId
      || !["application/json", "application/pdf"].includes(
        upload.content_type.toLowerCase(),
      )
    ) {
      return fail(
        "WORK_PACK_SIGNATURE_EXACT_BYTES_REQUIRED",
        409,
        "The signature packet does not match the exact completed field upload.",
      );
    }
    await verifyRetainedSignaturePayload(
      upload,
      packet.payload,
      packet.signaturePayloadSha256,
    );
    const signatureId = `work-pack-signature:${crypto.randomUUID()}`;
    statements.push(database.prepare(`INSERT INTO compliance_activity_work_pack_signatures
      (id, organisation_id, instance_key, case_instance_id, prompt_key,
       signer_role, signer_capacity, signer_name, signer_uid,
       signer_identity_snapshot, signer_identity_sha256, signature_sha256,
       signature_object_key, signature_content_type, signature_size_bytes,
       signature_payload_contract, signature_payload_snapshot,
       signature_payload_sha256, integrity_receipt_id, attestation_snapshot,
       attestation_sha256, definition_sha256, prefill_sha256, response_sha256,
       declarations_sha256, action, supersedes_signature_id, app_id,
       app_version, app_build, capture_session_id, captured_device_id,
       captured_by_uid, device_attestation_snapshot, device_attestation_sha256,
       signed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'captured', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        signatureId,
        row.organisation_id,
        row.instance_key,
        row.id,
        packet.location.responseKey,
        packet.role.roleKey,
        packet.role.capacity,
        packet.signerIdentity.signerName,
        packet.signerIdentity.signerUid,
        checkedJson(packet.signerIdentity),
        packet.signerIdentitySha256,
        packet.signatureSha256,
        upload.object_key,
        upload.content_type,
        Number(upload.size_bytes),
        CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
        checkedJson(packet.payload),
        packet.signaturePayloadSha256,
        upload.integrity_receipt_id,
        checkedJson(packet.attestation),
        packet.attestationSha256,
        envelope.definitionSha256,
        envelope.prefillSha256,
        envelope.responseSha256,
        envelope.declarationsSha256,
        predecessor?.id || "",
        packet.deviceAttestation.appId,
        packet.deviceAttestation.appVersion,
        packet.deviceAttestation.appBuild,
        upload.session_id,
        upload.device_id,
        input.actorUid,
        checkedJson(packet.deviceAttestation),
        packet.deviceAttestationSha256,
        packet.payload.signedAt,
        now,
      ));
    planned.add(signatureKey);
    uploads.add(packet.clientUploadId);
  }
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency,
    action: "work_pack_capture_signatures",
    resultRevision: Number(row.revision),
    newInstanceId: row.id,
    now,
    statements,
  });
}

export type CreditexWorkPackCustomerContextPatch = Readonly<{
  firstName?: string;
  lastName?: string;
}>;

export type CreditexWorkPackSiteContextPatch = Readonly<{
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
}>;

export type CreditexWorkPackContactContextPatch = Readonly<{
  phone?: string;
  email?: string;
}>;

function correctedText(
  value: unknown,
  fallback: string,
  maximum: number,
) {
  return value === undefined ? fallback : optionalText(value, maximum);
}

export async function updateAssignedCreditexActivityWorkPackCustomerContext(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    customerContextBinding: CreditexActivityWorkPackCustomerContext;
    customerPatch?: CreditexWorkPackCustomerContextPatch;
    sitePatch?: CreditexWorkPackSiteContextPatch;
    contactPatch?: CreditexWorkPackContactContextPatch;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_update_customer_context",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot change customer context.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before correcting customer details.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved);
  const suppliedBinding = object(
    input.customerContextBinding,
    "WORK_PACK_CUSTOMER_CONTEXT_INVALID",
    "Customer context binding is required.",
  );
  if (
    creditexCanonicalSha256(suppliedBinding)
      !== creditexCanonicalSha256(prior.prefill.customerContext)
    || !prior.prefill.customerContext.editable
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_NOT_EDITABLE",
      403,
      "Only the assigned direct or released customer context can be corrected here.",
    );
  }
  const current = await loadServerCustomerContext(database, {
    ownerUid: row.installer_uid,
    workOrderId: row.work_order_id,
  });
  if (
    creditexCanonicalSha256(current.envelope)
      !== creditexCanonicalSha256(prior.prefill.customerContext)
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_STALE",
      409,
      "Customer details changed elsewhere. Reload before applying this correction.",
    );
  }
  const customerPatch = input.customerPatch || {};
  const sitePatch = input.sitePatch || {};
  const contactPatch = input.contactPatch || {};
  const nextProjection = Object.freeze({
    ...current.projection,
    firstName: correctedText(
      customerPatch.firstName,
      current.projection.firstName,
      80,
    ),
    lastName: correctedText(
      customerPatch.lastName,
      current.projection.lastName,
      80,
    ),
    phone: correctedText(contactPatch.phone, current.projection.phone, 40),
    email: correctedText(contactPatch.email, current.projection.email, 254),
    addressLine1: correctedText(
      sitePatch.addressLine1,
      current.projection.addressLine1,
      180,
    ),
    addressLine2: correctedText(
      sitePatch.addressLine2,
      current.projection.addressLine2,
      180,
    ),
    suburb: correctedText(sitePatch.suburb, current.projection.suburb, 100),
    state: correctedText(sitePatch.state, current.projection.state, 3)
      .toUpperCase(),
    postcode: correctedText(
      sitePatch.postcode,
      current.projection.postcode,
      4,
    ),
  });
  if (
    nextProjection.email
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextProjection.email)
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_EMAIL_INVALID",
      400,
      "Enter a valid customer email address.",
    );
  }
  if (nextProjection.state && !/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(
    nextProjection.state,
  )) {
    return fail(
      "WORK_PACK_CUSTOMER_STATE_INVALID",
      400,
      "Choose a valid Australian state or territory.",
    );
  }
  if (nextProjection.postcode && !/^\d{4}$/.test(nextProjection.postcode)) {
    return fail(
      "WORK_PACK_CUSTOMER_POSTCODE_INVALID",
      400,
      "Enter a four-digit Australian postcode.",
    );
  }
  const changed = Object.entries(nextProjection).some(([key, value]) =>
    !["editable", "customerRevision", "siteRevision", "contactRevision"]
      .includes(key)
    && value !== current.projection[
      key as keyof CreditexActivityWorkPackCustomerProjection
    ]
  );
  if (!changed) {
    return fail(
      "WORK_PACK_NO_CHANGES",
      409,
      "This correction does not change the customer context.",
    );
  }
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Correction time")
    : new Date().toISOString();
  if (
    now <= current.projection.customerRevision
    || now <= current.projection.siteRevision
    || now <= current.projection.contactRevision
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_TIME_INVALID",
      409,
      "The correction time must follow the current customer revisions.",
    );
  }
  const snapshot = Object.freeze({
    contract: "creditex-activity-work-pack-customer-context-snapshot/v1" as const,
    customerId: current.envelope.customerId,
    siteId: current.envelope.siteId,
    contactId: current.envelope.contactId,
    customerRevision: now,
    siteRevision: now,
    contactRevision: now,
    firstName: nextProjection.firstName,
    lastName: nextProjection.lastName,
    phone: nextProjection.phone,
    email: nextProjection.email,
    addressLine1: nextProjection.addressLine1,
    addressLine2: nextProjection.addressLine2,
    suburb: nextProjection.suburb,
    state: nextProjection.state,
    postcode: nextProjection.postcode,
  }) satisfies CreditexActivityWorkPackCustomerSnapshot;
  const correctedContext = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT,
    editable: true,
    customerId: current.envelope.customerId,
    siteId: current.envelope.siteId,
    contactId: current.envelope.contactId,
    customerRevision: now,
    siteRevision: now,
    contactRevision: now,
    contextSha256: creditexCanonicalSha256(snapshot),
  }) satisfies CreditexActivityWorkPackCustomerContext;
  const executionContexts = await loadServerExecutionContexts(database, {
    organisationId: row.organisation_id,
    ownerUid: row.installer_uid,
    workOrderId: row.work_order_id,
  });
  const envelope = nextInstanceEnvelope(
    prior,
    prior.response,
    correctedContext,
    executionContexts,
    snapshot,
  );
  const newInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const statements: D1PreparedStatement[] = [
    database.prepare(`UPDATE trade_crm_customers SET first_name = ?,
        last_name = ?, email = ?, phone = ?, address_line_1 = ?,
        address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
        updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
        AND updated_at = ?`)
      .bind(
        nextProjection.firstName,
        nextProjection.lastName,
        nextProjection.email,
        nextProjection.phone,
        nextProjection.addressLine1,
        nextProjection.addressLine2,
        nextProjection.suburb,
        nextProjection.state,
        nextProjection.postcode,
        now,
        current.envelope.customerId,
        row.installer_uid,
        current.envelope.customerRevision,
      ),
    database.prepare(`UPDATE trade_crm_service_sites SET address_line_1 = ?,
        address_line_2 = ?, suburb = ?, address_state = ?, postcode = ?,
        updated_at = ?
      WHERE id = ? AND customer_id = ? AND firebase_uid = ?
        AND record_status = 'active' AND updated_at = ?`)
      .bind(
        nextProjection.addressLine1,
        nextProjection.addressLine2,
        nextProjection.suburb,
        nextProjection.state,
        nextProjection.postcode,
        now,
        current.envelope.siteId,
        current.envelope.customerId,
        row.installer_uid,
        current.envelope.siteRevision,
      ),
    database.prepare(`UPDATE trade_crm_customer_contacts SET first_name = ?,
        last_name = ?, email = ?, phone = ?, updated_at = ?
      WHERE id = ? AND customer_id = ? AND firebase_uid = ?
        AND record_status = 'active' AND updated_at = ?`)
      .bind(
        nextProjection.firstName,
        nextProjection.lastName,
        nextProjection.email,
        nextProjection.phone,
        now,
        current.envelope.contactId,
        current.envelope.customerId,
        row.installer_uid,
        current.envelope.contactRevision,
      ),
    database.prepare(`UPDATE trade_work_orders SET revision = NULL
      WHERE id = ? AND firebase_uid = ? AND NOT EXISTS (
        SELECT 1 FROM trade_crm_customers customer
        WHERE customer.id = ? AND customer.firebase_uid = ?
          AND customer.record_status = 'active' AND customer.updated_at = ?
      )`)
      .bind(
        row.work_order_id,
        row.installer_uid,
        current.envelope.customerId,
        row.installer_uid,
        now,
      ),
    database.prepare(`UPDATE trade_work_orders SET revision = NULL
      WHERE id = ? AND firebase_uid = ? AND NOT EXISTS (
        SELECT 1 FROM trade_crm_service_sites site
        WHERE site.id = ? AND site.customer_id = ? AND site.firebase_uid = ?
          AND site.record_status = 'active' AND site.updated_at = ?
      )`)
      .bind(
        row.work_order_id,
        row.installer_uid,
        current.envelope.siteId,
        current.envelope.customerId,
        row.installer_uid,
        now,
      ),
    database.prepare(`UPDATE trade_work_orders SET revision = NULL
      WHERE id = ? AND firebase_uid = ? AND NOT EXISTS (
        SELECT 1 FROM trade_crm_customer_contacts contact
        WHERE contact.id = ? AND contact.customer_id = ?
          AND contact.firebase_uid = ? AND contact.record_status = 'active'
          AND contact.updated_at = ?
      )`)
      .bind(
        row.work_order_id,
        row.installer_uid,
        current.envelope.contactId,
        current.envelope.customerId,
        row.installer_uid,
        now,
      ),
    ...(row.status === "ready_to_sign"
      ? await signatureRevocationStatements(database, row, now)
      : []),
    appendInstanceStatement(database, row, {
      id: newInstanceId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
  ];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_update_customer_context",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements,
  });
}

export async function refreshAssignedCreditexActivityWorkPackExecutionContext(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_refresh_execution_context",
  });
  if (replay) return replay;
  if (row.status === "completed" || row.status === "void") {
    return fail(
      "WORK_PACK_INSTANCE_IMMUTABLE",
      409,
      "A completed or void work pack cannot be reassigned.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before refreshing its assignment.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const prior = validateInstanceEnvelope(row, resolved, {
    allowStaleExecutionContext: true,
  });
  const [customerContext, executionContexts] = await Promise.all([
    loadServerCustomerContext(database, {
      ownerUid: row.installer_uid,
      workOrderId: row.work_order_id,
    }),
    loadServerExecutionContexts(database, {
      organisationId: row.organisation_id,
      ownerUid: row.installer_uid,
      workOrderId: row.work_order_id,
    }),
  ]);
  if (
    creditexCanonicalSha256(prior.prefill.customerContext)
      !== creditexCanonicalSha256(customerContext.envelope)
    || creditexCanonicalSha256(prior.prefill.customerSnapshot)
      !== creditexCanonicalSha256(customerContext.snapshot)
  ) {
    return fail(
      "WORK_PACK_CUSTOMER_CONTEXT_STALE",
      409,
      "Customer details changed separately. Refresh or correct that governed context first.",
    );
  }
  const executionChanged =
    creditexCanonicalSha256(prior.prefill.providerContext)
      !== creditexCanonicalSha256(executionContexts.providerContext)
    || creditexCanonicalSha256(prior.prefill.installerBusinessContext)
      !== creditexCanonicalSha256(executionContexts.installerBusinessContext)
    || creditexCanonicalSha256(prior.prefill.assignmentContext)
      !== creditexCanonicalSha256(executionContexts.assignmentContext)
    || creditexCanonicalSha256(prior.prefill.jobContext)
      !== creditexCanonicalSha256(executionContexts.jobContext);
  if (!executionChanged) {
    return fail(
      "WORK_PACK_EXECUTION_CONTEXT_UNCHANGED",
      409,
      "The governed provider, business, technician and job context is already current.",
    );
  }
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Execution-context refresh time")
    : new Date().toISOString();
  const envelope = nextInstanceEnvelope(
    prior,
    prior.response,
    prior.prefill.customerContext,
    executionContexts,
    prior.prefill.customerSnapshot,
  );
  const newInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const statements = [
    ...await signatureRevocationStatements(database, row, now),
    appendInstanceStatement(database, row, {
      id: newInstanceId,
      status: "in_progress",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
  ];
  return runWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_refresh_execution_context",
    resultRevision: Number(row.revision) + 1,
    newInstanceId,
    now,
    statements,
  });
}

type GovernedPdfTemplateRecord = {
  source_artifact_id: string;
  source_artifact_sha256: string;
  object_key: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
};

async function governedPdfTemplate(
  database: D1Database,
  row: WorkPackInstanceRecord,
  resolved: Readonly<{ schemaSha256: string }>,
  output: CreditexWorkPackDocumentOutput,
) {
  const records = await database.prepare(`SELECT
      binding.source_artifact_id, binding.source_artifact_sha256,
      artifact.object_key, artifact.original_file_name,
      artifact.content_type, artifact.size_bytes
    FROM compliance_activity_work_pack_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = binding.source_artifact_id
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.sha256 = binding.source_artifact_sha256
      AND lower(artifact.content_type) = 'application/pdf'
    JOIN compliance_official_source_review_decisions decision
      ON decision.organisation_id = artifact.organisation_id
      AND decision.subject_type = 'artifact'
      AND decision.subject_id = artifact.id
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE binding.organisation_id = ?
      AND binding.work_pack_version_id = ?
      AND binding.schema_sha256 = ?
      AND binding.source_role = 'requirement'
      AND binding.target_key = ?
      AND binding.binding_state = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_official_source_review_decisions successor
        WHERE successor.supersedes_decision_id = decision.id
      )
    ORDER BY binding.source_artifact_id`)
    .bind(
      row.organisation_id,
      row.work_pack_version_id,
      resolved.schemaSha256,
      output.sourceBindingTargetKey,
    )
    .all<GovernedPdfTemplateRecord>();
  if (records.results.length !== 1) {
    return fail(
      "WORK_PACK_PDF_TEMPLATE_BINDING_INVALID",
      409,
      "The final form must resolve to one exact independently approved PDF template.",
    );
  }
  return records.results[0];
}

function storedSignaturePayload(signature: ActiveSignatureRecord) {
  const payload = parseObject(
    signature.signature_payload_snapshot,
    "WORK_PACK_SIGNATURE_INVALID",
    "A retained signature payload is invalid.",
  );
  signaturePoints(payload.strokes);
  if (
    payload.contract !== CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT
    || payload.promptKey !== String(signature.prompt_key)
    || payload.signerRoleKey !== String(signature.signer_role)
    || payload.signerName !== String(signature.signer_name)
    || payload.signerCapacity !== String(signature.signer_capacity)
    || creditexCanonicalSha256(payload) !== normaliseSha256(
      signature.signature_payload_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature payload SHA-256",
    )
  ) {
    return fail(
      "WORK_PACK_SIGNATURE_INVALID",
      409,
      "A retained signature payload no longer matches its exact identity and hashes.",
    );
  }
  return payload as CreditexActivityWorkPackSignaturePayload;
}

function workPackPdfFileName(output: CreditexWorkPackDocumentOutput) {
  const base = output.title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Completed activity form";
  return `${base}.pdf`;
}

function storageKeyPart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 180);
}

export async function finaliseAssignedCreditexActivityWorkPack(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    expectedResponseSha256: string;
    idempotency: CreditexWorkPackMutationIdempotency;
    now?: string;
  }>,
) {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const replay = await replayAppliedWorkPackMutation(database, {
    scope: input,
    row,
    idempotency: input.idempotency,
    action: "work_pack_finalize",
  });
  if (replay) return replay;
  if (row.status !== "ready_to_sign") {
    return fail(
      "WORK_PACK_NOT_READY_TO_FINALIZE",
      409,
      "Complete, prepare and sign this exact work-pack revision before finalising it.",
    );
  }
  if (normaliseSha256(
    input.expectedResponseSha256,
    "WORK_PACK_REVISION_REQUIRED",
    "Expected work-pack response SHA-256",
  ) !== row.response_sha256) {
    return fail(
      "WORK_PACK_REVISION_CONFLICT",
      409,
      "This work pack changed elsewhere. Reload before finalising it.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved);
  const dependencies = await resolveServerDependencies(
    database,
    row,
    resolved.workPack,
    Object.fromEntries(Object.entries(envelope.response.dependencyResolutions)
      .map(([dependencyKey, resolution]) => [dependencyKey, {
        referenceIds: resolution.referenceIds,
      }])),
  );
  const liveResponse = validateResponseValues(resolved.workPack, Object.freeze({
    ...envelope.response,
    dependencyResolutions: dependencies.resolutions,
  }));
  if (creditexCanonicalSha256(liveResponse) !== envelope.responseSha256) {
    return fail(
      "WORK_PACK_DEPENDENCY_REVIEW_REQUIRED",
      409,
      "A governed product, scenario or calculator dependency changed. Save the refreshed work pack and collect signatures again.",
    );
  }
  const [signatureRows, projectedArtifacts] = await Promise.all([
    activeSignatureRecords(database, row),
    instanceArtifacts(database, row),
  ]);
  const activeSignatures = signatureRows.filter((signature) =>
    signature.action === "captured"
    && normaliseSha256(
      signature.definition_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature definition SHA-256",
    ) === envelope.definitionSha256
    && normaliseSha256(
      signature.prefill_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature prefill SHA-256",
    ) === envelope.prefillSha256
    && normaliseSha256(
      signature.response_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature response SHA-256",
    ) === envelope.responseSha256
    && normaliseSha256(
      signature.declarations_sha256,
      "WORK_PACK_SIGNATURE_INVALID",
      "Signature declarations SHA-256",
    ) === envelope.declarationsSha256
  );
  const projectedSignatures = await instanceSignatures(database, row);
  const completionResponse = responseWithBoundPackets(
    liveResponse,
    resolved.workPack,
    projectedSignatures,
    projectedArtifacts,
    {
      definitionSha256: envelope.definitionSha256,
      prefillSha256: envelope.prefillSha256,
      responseSha256: envelope.responseSha256,
      declarationsSha256: envelope.declarationsSha256,
    },
  );
  const completion = creditexActivityWorkPackCompletion({
    workPack: resolved.workPack,
    response: completionResponse,
  });
  if (!completion.ready) {
    return fail(
      "WORK_PACK_FINALIZATION_INCOMPLETE",
      409,
      "Finish every currently required visible response, evidence item, document acknowledgement and signature first.",
    );
  }
  const outputs = resolved.workPack.documentOutputs.filter((output) => output.required);
  if (outputs.length !== 1) {
    return fail(
      "WORK_PACK_DOCUMENT_OUTPUT_REQUIRED",
      409,
      "This activity has no single governed final PDF mapping.",
    );
  }
  const output = outputs[0];
  const template = await governedPdfTemplate(database, row, resolved, output);
  const templateBytes = await exactCustodyBytes({
    objectKey: template.object_key,
    expectedSha256: template.source_artifact_sha256,
    expectedSizeBytes: Number(template.size_bytes),
    expectedContentType: "application/pdf",
  });
  const pdfSignatures: CreditexWorkPackPdfSignature[] = activeSignatures.map(
    (signature) => Object.freeze({
      promptKey: String(signature.prompt_key),
      signerRoleKey: String(signature.signer_role),
      signerName: String(signature.signer_name),
      signerCapacity: String(signature.signer_capacity),
      signedAt: String(signature.signed_at),
      payload: storedSignaturePayload(signature),
    }),
  );
  const rendered = await renderCreditexActivityWorkPackPdf({
    templateBytes: templateBytes.bytes,
    output,
    context: {
      prefill: envelope.prefill as unknown as Readonly<Record<string, unknown>>,
      response: completionResponse as unknown as Readonly<Record<string, unknown>>,
      declarations: envelope.declarations,
    },
    signatures: pdfSignatures,
  });
  if (rendered.bytes.byteLength < 1 || rendered.bytes.byteLength > 50 * 1024 * 1024) {
    return fail(
      "WORK_PACK_FINAL_PDF_SIZE_INVALID",
      409,
      "The generated governed PDF is outside the supported retained size.",
    );
  }
  const pdfSha256 = await sha256Bytes(rendered.bytes);
  const now = input.now
    ? instant(input.now, "WORK_PACK_NOW_INVALID", "Finalisation time")
    : new Date().toISOString();
  const completedInstanceId =
    `work-pack:${row.compliance_case_id}:revision:${Number(row.revision) + 1}`;
  const renderReceiptId = `work-pack-render:${crypto.randomUUID()}`;
  const finalRecordId = `work-pack-final:${crypto.randomUUID()}`;
  const outputDefinitionSha256 = creditexCanonicalSha256(output);
  const signatureManifest = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_MANIFEST_CONTRACT,
    instanceKey: row.instance_key,
    caseInstanceId: completedInstanceId,
    definitionSha256: envelope.definitionSha256,
    prefillSha256: envelope.prefillSha256,
    responseSha256: envelope.responseSha256,
    declarationsSha256: envelope.declarationsSha256,
    signatures: Object.freeze(activeSignatures.map((signature) => Object.freeze({
      id: String(signature.id),
      promptKey: String(signature.prompt_key),
      signerRole: String(signature.signer_role),
      signerName: String(signature.signer_name),
      signatureSha256: bareSha256(String(signature.signature_sha256)),
      signaturePayloadSha256: normaliseSha256(
        signature.signature_payload_sha256,
        "WORK_PACK_SIGNATURE_INVALID",
        "Signature payload SHA-256",
      ),
      attestationSha256: normaliseSha256(
        signature.attestation_sha256,
        "WORK_PACK_SIGNATURE_INVALID",
        "Signature attestation SHA-256",
      ),
      signerIdentitySha256: normaliseSha256(
        signature.signer_identity_sha256,
        "WORK_PACK_SIGNATURE_INVALID",
        "Signer identity SHA-256",
      ),
      signedAt: String(signature.signed_at),
    }))),
  }) satisfies CreditexActivityWorkPackSignatureManifest;
  const signatureManifestSha256 = creditexCanonicalSha256(signatureManifest);
  const instanceSha256 = creditexCanonicalSha256(envelope);
  const fileName = workPackPdfFileName(output);
  const objectKey = [
    "creditex", "activity-work-packs", storageKeyPart(row.organisation_id),
    storageKeyPart(row.instance_key), output.outputKey, `${pdfSha256}.pdf`,
  ].join("/");
  const exactBytes = new Uint8Array(rendered.bytes.byteLength);
  exactBytes.set(rendered.bytes);
  await getCreditexCustodyBucket().put(objectKey, exactBytes.buffer, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      contract: CREDITEX_ACTIVITY_WORK_PACK_FINAL_RECORD_CONTRACT,
      instanceSha256,
      pdfSha256,
    },
  });
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT INTO compliance_activity_work_pack_render_receipts
      (id, contract, organisation_id, instance_key, case_instance_id,
       output_key, output_definition_snapshot, output_definition_sha256,
       template_source_artifact_id, template_source_artifact_sha256,
       renderer_contract, renderer_version, object_key, file_name,
       content_type, size_bytes, pdf_sha256, rendered_by_uid, rendered_at)
      VALUES (?, 'creditex-activity-work-pack-render-receipt/v1', ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?)`)
      .bind(
        renderReceiptId,
        row.organisation_id,
        row.instance_key,
        row.id,
        output.outputKey,
        checkedJson(output),
        outputDefinitionSha256,
        template.source_artifact_id,
        bareSha256(template.source_artifact_sha256),
        rendered.rendererContract,
        rendered.rendererVersion,
        objectKey,
        fileName,
        rendered.bytes.byteLength,
        pdfSha256,
        input.actorUid,
        now,
      ),
    appendInstanceStatement(database, row, {
      id: completedInstanceId,
      status: "completed",
      envelope,
      actorUid: input.actorUid,
      createdAt: now,
    }),
    database.prepare(`INSERT INTO compliance_activity_work_pack_final_records
      (id, contract, organisation_id, instance_key, case_instance_id,
       work_pack_version_id, instance_sha256, definition_sha256,
       prefill_sha256, response_sha256, declarations_sha256,
       signature_manifest_snapshot, signature_manifest_sha256,
       renderer_contract, renderer_version, output_key,
       output_definition_sha256, template_source_artifact_id,
       template_source_artifact_sha256, object_key, file_name, content_type,
       size_bytes, pdf_sha256, integrity_receipt_id, created_by_uid,
       created_at, finalised_by_uid, finalised_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'application/pdf', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        finalRecordId,
        CREDITEX_ACTIVITY_WORK_PACK_FINAL_RECORD_CONTRACT,
        row.organisation_id,
        row.instance_key,
        completedInstanceId,
        row.work_pack_version_id,
        instanceSha256,
        envelope.definitionSha256,
        envelope.prefillSha256,
        envelope.responseSha256,
        envelope.declarationsSha256,
        checkedJson(signatureManifest),
        signatureManifestSha256,
        rendered.rendererContract,
        rendered.rendererVersion,
        output.outputKey,
        outputDefinitionSha256,
        template.source_artifact_id,
        bareSha256(template.source_artifact_sha256),
        objectKey,
        fileName,
        rendered.bytes.byteLength,
        pdfSha256,
        renderReceiptId,
        input.actorUid,
        now,
        input.actorUid,
        now,
      ),
  ];
  try {
    return await runWorkPackMutation(database, {
      scope: input,
      row,
      idempotency: input.idempotency,
      action: "work_pack_finalize",
      resultRevision: Number(row.revision) + 1,
      newInstanceId: completedInstanceId,
      now,
      statements,
    });
  } catch (error) {
    // R2 and D1 cannot share a transaction. Delete the staged object only
    // after D1 positively confirms that no immutable final-record row retained
    // it. A D1 read failure preserves the object for operator reconciliation.
    try {
      const retained = await database.prepare(`SELECT id
        FROM compliance_activity_work_pack_final_records
        WHERE organisation_id = ? AND instance_key = ? AND object_key = ?
        LIMIT 1`)
        .bind(row.organisation_id, row.instance_key, objectKey)
        .first<{ id: string }>();
      if (!retained) await getCreditexCustodyBucket().delete(objectKey);
    } catch (cleanupError) {
      console.error("Work-pack final PDF cleanup needs reconciliation", {
        instanceKey: row.instance_key,
        error: cleanupError instanceof Error ? cleanupError.message : "unknown",
      });
    }
    throw error;
  }
}

export type CreditexAssignedWorkPackBytes = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  custodyReceiptId: string;
}>;

export async function loadAssignedCreditexActivityWorkPackReferenceDocument(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    responseKey: string;
    sourceArtifactId: string;
  }>,
): Promise<CreditexAssignedWorkPackBytes> {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved);
  const reference = (await instanceReferenceDocuments(
    database,
    row,
    resolved.workPack,
    envelope.response,
  )).find((candidate) =>
    candidate.responseKey === input.responseKey
    && candidate.sourceArtifactId === input.sourceArtifactId
  );
  if (!reference) {
    return fail(
      "WORK_PACK_REFERENCE_DOCUMENT_NOT_ASSIGNED",
      404,
      "The governed document is not assigned to this exact work-pack prompt.",
    );
  }
  const artifact = await database.prepare(`SELECT object_key
    FROM compliance_official_source_artifacts
    WHERE id = ? AND organisation_id = ? AND sha256 = ?
      AND content_type = ? AND size_bytes = ?
    LIMIT 1`)
    .bind(
      reference.sourceArtifactId,
      row.organisation_id,
      bareSha256(reference.sourceArtifactSha256),
      reference.contentType,
      reference.sizeBytes,
    )
    .first<{ object_key: string }>();
  if (!artifact) {
    return fail(
      "WORK_PACK_REFERENCE_DOCUMENT_UNAVAILABLE",
      409,
      "The exact governed reference document is unavailable.",
    );
  }
  const retained = await exactCustodyBytes({
    objectKey: artifact.object_key,
    expectedSha256: reference.sourceArtifactSha256,
    expectedSizeBytes: reference.sizeBytes,
    expectedContentType: reference.contentType,
  });
  return Object.freeze({
    bytes: retained.bytes,
    contentType: reference.contentType,
    fileName: reference.originalFileName,
    sizeBytes: retained.bytes.byteLength,
    sha256: retained.sha256,
    custodyReceiptId:
      `official-source:${reference.sourceArtifactId}:${retained.sha256}`,
  });
}

export async function loadAssignedCreditexActivityWorkPackFinalRecord(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{ caseInstanceId: string }>,
): Promise<CreditexAssignedWorkPackBytes> {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const record = await database.prepare(`SELECT object_key, file_name,
      content_type, size_bytes, pdf_sha256, integrity_receipt_id
    FROM compliance_activity_work_pack_final_records
    WHERE organisation_id = ? AND instance_key = ? AND case_instance_id = ?
    ORDER BY finalised_at DESC, id DESC LIMIT 1`)
    .bind(row.organisation_id, row.instance_key, row.id)
    .first<Record<string, unknown>>();
  if (!record) {
    return fail(
      "WORK_PACK_FINAL_RECORD_NOT_FOUND",
      404,
      "The completed immutable work-pack PDF was not found.",
    );
  }
  const retained = await exactCustodyBytes({
    objectKey: String(record.object_key),
    expectedSha256: String(record.pdf_sha256),
    expectedSizeBytes: Number(record.size_bytes),
    expectedContentType: String(record.content_type),
  });
  return Object.freeze({
    bytes: retained.bytes,
    contentType: String(record.content_type),
    fileName: String(record.file_name),
    sizeBytes: retained.bytes.byteLength,
    sha256: retained.sha256,
    custodyReceiptId: String(record.integrity_receipt_id),
  });
}

export async function loadAssignedCreditexActivityWorkPackSignature(
  database: D1Database,
  input: CreditexWorkPackTradeScope & Readonly<{
    caseInstanceId: string;
    signatureId: string;
  }>,
): Promise<CreditexAssignedWorkPackBytes> {
  const row = await assignedInstanceRow(database, input, input.caseInstanceId);
  const signature = await database.prepare(`SELECT signature_object_key,
      signature_content_type, signature_size_bytes, signature_sha256,
      integrity_receipt_id
    FROM compliance_activity_work_pack_signatures signature
    WHERE signature.id = ? AND signature.organisation_id = ?
      AND signature.instance_key = ? AND signature.action = 'captured'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_signatures successor
        WHERE successor.supersedes_signature_id = signature.id
      ) LIMIT 1`)
    .bind(input.signatureId, row.organisation_id, row.instance_key)
    .first<Record<string, unknown>>();
  if (!signature) {
    return fail(
      "WORK_PACK_SIGNATURE_NOT_FOUND",
      404,
      "The current retained signature was not found.",
    );
  }
  const retained = await exactCustodyBytes({
    objectKey: String(signature.signature_object_key),
    expectedSha256: String(signature.signature_sha256),
    expectedSizeBytes: Number(signature.signature_size_bytes),
    expectedContentType: String(signature.signature_content_type),
  });
  return Object.freeze({
    bytes: retained.bytes,
    contentType: String(signature.signature_content_type),
    fileName: `signature-${storageKeyPart(input.signatureId)}.${
      String(signature.signature_content_type).includes("pdf") ? "pdf" : "bin"
    }`,
    sizeBytes: retained.bytes.byteLength,
    sha256: retained.sha256,
    custodyReceiptId: String(signature.integrity_receipt_id),
  });
}

export type CreditexWorkPackGovernanceActor = Readonly<{
  actorUid: string;
  organisationId: string;
  actorKind: "compliance" | "admin";
}>;

export type CreditexWorkPackGovernanceAccess = Readonly<{
  canRead: boolean;
  canAuthor: boolean;
  canReview: boolean;
  canPublish: boolean;
  canWithdraw: boolean;
}>;

export type CreditexWorkPackGovernanceIdentity = Readonly<{
  actorUid: string;
  actorKind: "compliance" | "admin";
  role: string;
  displayName: string;
  access: CreditexWorkPackGovernanceAccess;
}>;

type GovernanceIdentity = CreditexWorkPackGovernanceIdentity;

type GovernanceOptions = Readonly<{
  now?: string;
  idFactory?: () => string;
}>;

function governedNow(options?: GovernanceOptions) {
  return options?.now
    ? instant(options.now, "WORK_PACK_NOW_INVALID", "Work-pack time")
    : new Date().toISOString();
}

function governedId(prefix: string, options?: GovernanceOptions) {
  return `${prefix}:${(options?.idFactory || (() => crypto.randomUUID()))()}`;
}

async function governanceIdentity(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
): Promise<GovernanceIdentity> {
  await ensureCreditexWorkPackSchemaGuards(database);
  const actorUid = text(
    actor.actorUid,
    240,
    "WORK_PACK_ACTOR_REQUIRED",
    "Governance actor",
  );
  const organisationId = text(
    actor.organisationId,
    180,
    "WORK_PACK_ORGANISATION_REQUIRED",
    "Governance organisation",
  );
  if (actor.actorKind === "compliance") {
    const row = await database.prepare(`SELECT member.role, member.display_name,
        member.governance_identity_verified,
        member.governance_identity_verified_by_uid,
        organisation.organisation_code
      FROM compliance_users member
      JOIN compliance_organisations organisation
        ON organisation.id = member.organisation_id
        AND organisation.status = 'active'
      WHERE member.organisation_id = ? AND member.firebase_uid = ?
        AND member.status = 'active'`)
      .bind(organisationId, actorUid)
      .first<{
        role: string;
        display_name: string;
        governance_identity_verified: number;
        governance_identity_verified_by_uid: string;
        organisation_code: string;
      }>();
    if (!row) {
      return fail(
        "WORK_PACK_GOVERNANCE_ACCESS_DENIED",
        403,
        "This account cannot access governed activity work packs.",
      );
    }
    const named = Number(row.governance_identity_verified) === 1
      && Boolean(row.display_name.trim());
    const independentlyVerified = named
      && Boolean(row.governance_identity_verified_by_uid.trim())
      && row.governance_identity_verified_by_uid !== actorUid;
    const canAuthor = named
      && ["admin", "case_manager", "reviewer"].includes(row.role);
    const canReview = independentlyVerified
      && ["admin", "reviewer"].includes(row.role);
    return Object.freeze({
      actorUid,
      actorKind: actor.actorKind,
      role: row.role,
      displayName: row.display_name,
      access: Object.freeze({
        canRead: true,
        canAuthor,
        canReview,
        canPublish: canReview,
        canWithdraw: canReview,
      }),
    });
  }
  const row = await database.prepare(`SELECT administrator.role,
      administrator.display_name
    FROM admin_users administrator
    JOIN compliance_organisations organisation
      ON organisation.id = ?
      AND organisation.organisation_code = 'CREDITEX-AU'
      AND organisation.status = 'active'
    WHERE administrator.firebase_uid = ?
      AND administrator.status = 'active'`)
    .bind(organisationId, actorUid)
    .first<{ role: string; display_name: string }>();
  if (!row) {
    return fail(
      "WORK_PACK_GOVERNANCE_ACCESS_DENIED",
      403,
      "This admin account cannot access Creditex activity work packs.",
    );
  }
  const canAuthor = ["owner", "admin"].includes(row.role);
  const canReview = ["owner", "admin", "reviewer"].includes(row.role);
  return Object.freeze({
    actorUid,
    actorKind: actor.actorKind,
    role: row.role,
    displayName: row.display_name,
    access: Object.freeze({
      canRead: true,
      canAuthor,
      canReview,
      canPublish: canReview,
      canWithdraw: canReview,
    }),
  });
}

export async function loadCreditexWorkPackGovernanceIdentity(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  return governanceIdentity(database, actor);
}

function requireGovernancePermission(
  identity: GovernanceIdentity,
  permission: keyof Omit<CreditexWorkPackGovernanceAccess, "canRead">,
) {
  if (!identity.access[permission]) {
    return fail(
      "WORK_PACK_GOVERNANCE_PERMISSION_DENIED",
      403,
      "This account is not authorised for that governed work-pack action.",
    );
  }
}

type GovernanceCalculationRunRecord = WorkPackInstanceRecord & {
  calculation_run_id: string;
  calculation_case_revision: number;
  calculation_input_snapshot: string;
  calculation_output_snapshot: string;
  calculation_status: string;
  calculation_run_by_uid: string;
  calculation_run_at: string;
  calculation_calculator_version_id: string;
};

export async function reviewCreditexActivityWorkPackCalculation(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    calculationRunId: unknown;
    decision: unknown;
    comment: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canReview");
  const calculationRunId = text(
    input.calculationRunId,
    240,
    "WORK_PACK_CALCULATION_RUN_REQUIRED",
    "Calculation run",
  );
  const decision = String(input.decision || "").trim();
  if (decision !== "approved" && decision !== "rejected") {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_DECISION_INVALID",
      400,
      "Choose approved or rejected for the exact calculation run.",
    );
  }
  const reviewNote = text(
    input.comment,
    2000,
    "WORK_PACK_CALCULATION_REVIEW_NOTE_REQUIRED",
    "Independent calculation review note",
  );
  if (reviewNote.length < 3) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_NOTE_REQUIRED",
      400,
      "Independent calculation review note is required.",
    );
  }
  const row = await database.prepare(`SELECT instance.*,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      compliance_case.evidence_policy_version_id,
      compliance_case.installer_uid,
      work_order.source_type, work_order.assignee_member_id,
      work_order.revision work_order_revision,
      CASE
        WHEN work_order.assignee_member_id = '' THEN work_order.firebase_uid
        ELSE COALESCE(assigned_member.member_uid, '')
      END assigned_worker_uid,
      COALESCE(job_detail.customer_source, '') customer_source,
      calculation.id calculation_run_id,
      calculation.case_revision calculation_case_revision,
      calculation.input_snapshot calculation_input_snapshot,
      calculation.output_snapshot calculation_output_snapshot,
      calculation.status calculation_status,
      calculation.run_by_uid calculation_run_by_uid,
      calculation.run_at calculation_run_at,
      calculation.calculator_version_id calculation_calculator_version_id
    FROM compliance_calculation_runs calculation
    JOIN compliance_cases compliance_case
      ON compliance_case.id = calculation.case_id
      AND compliance_case.organisation_id = calculation.organisation_id
      AND compliance_case.revision = calculation.case_revision
    JOIN compliance_activity_work_pack_instances instance
      ON instance.compliance_case_id = compliance_case.id
      AND instance.organisation_id = compliance_case.organisation_id
    JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
      AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active'
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id
      AND job_detail.firebase_uid = work_order.firebase_uid
    LEFT JOIN trade_team_members assigned_member
      ON assigned_member.id = work_order.assignee_member_id
      AND assigned_member.owner_uid = work_order.firebase_uid
      AND assigned_member.status = 'active'
    WHERE calculation.id = ? AND calculation.organisation_id = ?
      AND calculation.status = 'calculated'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    LIMIT 1`)
    .bind(calculationRunId, actor.organisationId)
    .first<GovernanceCalculationRunRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_NOT_FOUND",
      404,
      "The current exact calculated work-pack run was not found.",
    );
  }
  if (row.calculation_run_by_uid === identity.actorUid) {
    return fail(
      "WORK_PACK_CALCULATION_SELF_REVIEW_BLOCKED",
      409,
      "The person who ran a calculation cannot independently review it.",
    );
  }
  const existing = await database.prepare(`SELECT id
    FROM compliance_activity_work_pack_calculation_reviews
    WHERE organisation_id = ? AND calculation_run_id = ?
    LIMIT 1`)
    .bind(row.organisation_id, row.calculation_run_id)
    .first<{ id: string }>();
  if (existing) {
    return fail(
      "WORK_PACK_CALCULATION_ALREADY_REVIEWED",
      409,
      "This immutable calculation run already has an independent review.",
    );
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: row.organisation_id,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved, {
    allowStaleExecutionContext: true,
  });
  const matches = Object.entries(envelope.response.dependencyResolutions)
    .filter(([, resolution]) =>
      resolution.referenceIds.length === 1
      && resolution.referenceIds[0] === calculationRunId
    );
  if (matches.length !== 1) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_BINDING_INVALID",
      409,
      "The calculation run is not the exact current dependency of one work-pack field form.",
    );
  }
  const dependencyKey = matches[0][0];
  const dependency = resolved.workPack.dependencies.find((candidate) =>
    candidate.kind === "calculator" && candidate.required
      && candidate.dependencyKey === dependencyKey
  );
  if (!dependency || dependency.kind !== "calculator") {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_BINDING_INVALID",
      409,
      "The calculation run is not bound to a required governed calculator dependency.",
    );
  }
  const basis = await assignedCalculatorExecutionBasis(
    database,
    row,
    resolved.workPack,
    dependency,
  );
  if (
    row.calculation_calculator_version_id !== basis.calculatorVersionId
    || Number(row.calculation_case_revision) !== Number(row.case_revision)
    || Number(row.case_revision) < 1
    || Number.isNaN(Date.parse(row.calculation_run_at))
  ) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_IDENTITY_INVALID",
      409,
      "The calculated run no longer matches the exact current case and approved calculator identity.",
    );
  }
  const expectedInputs = assignedCalculatorInputs(
    resolved.workPack,
    envelope.response,
    dependency,
    basis.specification,
  );
  const storedInputs = storedJson(row.calculation_input_snapshot);
  const storedOutput = storedJson(row.calculation_output_snapshot);
  if (
    !storedInputs || typeof storedInputs !== "object" || Array.isArray(storedInputs)
    || !storedOutput || typeof storedOutput !== "object" || Array.isArray(storedOutput)
    || creditexCanonicalSha256(storedInputs)
      !== creditexCanonicalSha256(expectedInputs)
  ) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_SNAPSHOT_INVALID",
      409,
      "The retained calculation inputs no longer match the exact governed field answers.",
    );
  }
  let execution: ReturnType<typeof evaluateCreditexCalculator>;
  try {
    execution = evaluateCreditexCalculator(basis.specification, expectedInputs);
  } catch {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_EXECUTION_INVALID",
      409,
      "The retained calculation cannot be reproduced by the exact approved engine.",
    );
  }
  if (
    execution.engineContractHash !== basis.engineContractSha256
    || creditexCanonicalSha256(storedOutput)
      !== creditexCanonicalSha256(execution)
    || basis.engineReceipt.engine_contract_hash !== basis.engineContractSha256
    || basis.engineReceipt.golden_vector_suite_sha256
      !== basis.goldenVectorSuiteSha256
  ) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_EXECUTION_INVALID",
      409,
      "The retained output or engine receipt does not reproduce the exact approved calculation.",
    );
  }
  const now = governedNow(options);
  const id = governedId("work-pack-calculation-review", options);
  const result = await database.prepare(`INSERT INTO
      compliance_activity_work_pack_calculation_reviews (
        id, organisation_id, instance_key, case_instance_id,
        calculation_run_id, dependency_key, decision,
        input_sha256, output_sha256, calculator_version_id,
        calculator_source_sha256, engine_receipt_id, reviewer_uid,
        review_note, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      row.organisation_id,
      row.instance_key,
      row.id,
      row.calculation_run_id,
      dependencyKey,
      decision,
      creditexCanonicalSha256(storedInputs),
      creditexCanonicalSha256(storedOutput),
      basis.calculatorVersionId,
      basis.calculatorSourceSha256,
      basis.engineReceipt.id,
      identity.actorUid,
      reviewNote,
      now,
      now,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_CALCULATION_REVIEW_FAILED",
      409,
      "The immutable calculation review was not recorded.",
    );
  }
  return Object.freeze({
    savedCalculationReviewId: id,
    calculationRunId,
    decision,
    reviewedAt: now,
  });
}

type GovernanceActivityRecord = {
  id: string;
  program_id: string;
  program_code: string;
  activity_key: string;
  version: number;
  title: string;
  service_category: string;
  registry_activity_code: string;
  specification_part: string;
  product_category: string;
  scenario_code: string;
  jurisdiction: string;
  effective_from: string;
  effective_to: string;
  publish_state: string;
};

type GovernanceVersionRecord = WorkPackVersionRecord & {
  updated_by_uid: string;
  updated_at: string;
  withdrawn_by_uid: string;
  withdrawn_at: string;
  withdrawal_note: string;
  abandoned_by_uid: string;
  abandoned_at: string;
  abandonment_note: string;
  authored_by_name: string;
  updated_by_name: string;
  reviewed_by_name: string;
};

type GovernanceSourceArtifactRecord = {
  id: string;
  source_url: string;
  source_host: string;
  source_title: string;
  source_version: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  retrieval_method: string;
  asserted_retrieved_at: string;
  captured_by_uid: string;
  captured_at: string;
  decision: string;
  reviewed_by_uid: string;
  reviewed_at: string;
};

type GovernanceSourceBindingRecord = {
  id: string;
  work_pack_version_id: string;
  schema_sha256: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  source_role: string;
  target_key: string;
  citation_location: string;
  binding_state: string;
  created_by_uid: string;
  created_by_name: string;
  created_at: string;
  reviewed_by_uid: string;
  reviewed_by_name: string;
  reviewed_at: string;
  review_note: string;
  withdrawn_by_uid: string;
  withdrawn_at: string;
  withdrawal_note: string;
};

type GovernanceManualPolicyRecord = {
  id: string;
  activity_template_id: string;
  activity_version_id: string;
  evidence_policy_version_id: string;
  version: number;
  binding_snapshot_sha256: string;
  lifecycle_state: string;
  requested_by_uid: string;
  approved_by_uid: string;
  approved_at: string;
  title: string;
};

type GovernanceEvidencePolicyRecord = {
  id: string;
  activity_version_id: string;
  version: number;
  title: string;
  official_source_url: string;
  official_source_title: string;
  official_source_version: string;
  official_source_sha256: string;
  requirements_complete: number;
  publish_state: string;
};

type GovernanceCalculationReviewRecord = {
  calculation_run_id: string;
  case_id: string;
  work_order_id: string;
  case_instance_id: string;
  instance_key: string;
  dependency_key: string;
  input_snapshot: string;
  output_snapshot: string;
  run_by_uid: string;
  run_at: string;
  calculator_version_id: string;
  calculator_key: string;
  calculator_version: number;
  review_id: string;
  review_decision: string;
  review_input_sha256: string;
  review_output_sha256: string;
  reviewer_uid: string;
  review_note: string;
  reviewed_at: string;
};

function activityTemplateId(row: GovernanceActivityRecord) {
  return GOVERNMENT_ACTIVITY_TEMPLATES.find((template) =>
    template.programCode === row.program_code
      && template.activityKey === row.activity_key
      && (
        !template.registryActivityCode
        || template.registryActivityCode === row.registry_activity_code
      )
  )?.templateId || "";
}

export async function listCreditexWorkPackGovernance(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
) {
  const identity = await governanceIdentity(database, actor);
  const organisationId = actor.organisationId;
  const [activityRows, versionRows, artifactRows, bindingRows, manualRows,
    policyRows, calculationRows] = await Promise.all([
    database.prepare(`SELECT activity.id, activity.program_id,
        program.program_code, activity.activity_key, activity.version,
        activity.title, activity.service_category,
        activity.registry_activity_code, activity.specification_part,
        activity.product_category, activity.scenario_code,
        activity.jurisdiction, activity.effective_from,
        activity.effective_to, activity.publish_state
      FROM compliance_activity_versions activity
      JOIN compliance_programs program
        ON program.id = activity.program_id
        AND program.organisation_id = ?
      WHERE activity.publish_state IN ('draft', 'published', 'withdrawn')
      ORDER BY program.program_code, activity.activity_key,
        activity.version DESC, activity.id`)
      .bind(organisationId).all<GovernanceActivityRecord>(),
    database.prepare(`SELECT version.*,
        binding.binding_snapshot manual_binding_snapshot,
        binding.lifecycle_state manual_binding_lifecycle_state,
        binding.approved_by_uid manual_binding_approved_by_uid,
        binding.approved_at manual_binding_approved_at,
        policy.publish_state evidence_policy_publish_state,
        policy.requirements_complete evidence_policy_requirements_complete,
        COALESCE((SELECT member.display_name FROM compliance_users member
          WHERE member.organisation_id = version.organisation_id
            AND member.firebase_uid = version.authored_by_uid LIMIT 1),
          (SELECT administrator.display_name FROM admin_users administrator
          WHERE administrator.firebase_uid = version.authored_by_uid LIMIT 1),
          '') authored_by_name,
        COALESCE((SELECT member.display_name FROM compliance_users member
          WHERE member.organisation_id = version.organisation_id
            AND member.firebase_uid = version.updated_by_uid LIMIT 1),
          (SELECT administrator.display_name FROM admin_users administrator
          WHERE administrator.firebase_uid = version.updated_by_uid LIMIT 1),
          '') updated_by_name,
        COALESCE((SELECT member.display_name FROM compliance_users member
          WHERE member.organisation_id = version.organisation_id
            AND member.firebase_uid = version.reviewed_by_uid LIMIT 1),
          (SELECT administrator.display_name FROM admin_users administrator
          WHERE administrator.firebase_uid = version.reviewed_by_uid LIMIT 1),
          '') reviewed_by_name
      FROM compliance_activity_work_pack_versions version
      LEFT JOIN compliance_manual_policy_bindings binding
        ON binding.id = version.manual_policy_binding_id
        AND binding.organisation_id = version.organisation_id
      LEFT JOIN compliance_evidence_policy_versions policy
        ON policy.id = version.evidence_policy_version_id
        AND policy.organisation_id = version.organisation_id
      WHERE version.organisation_id = ?
      ORDER BY version.activity_version_id, version.version DESC, version.id`)
      .bind(organisationId).all<GovernanceVersionRecord>(),
    database.prepare(`SELECT artifact.*,
        decision.decision, decision.reviewed_by_uid, decision.reviewed_at
      FROM compliance_official_source_artifacts artifact
      JOIN compliance_official_source_review_decisions decision
        ON decision.id = (
          SELECT latest.id
          FROM compliance_official_source_review_decisions latest
          WHERE latest.organisation_id = artifact.organisation_id
            AND latest.subject_type = 'artifact'
            AND latest.subject_id = artifact.id
          ORDER BY latest.reviewed_at DESC, latest.id DESC LIMIT 1
        )
        AND decision.artifact_id = artifact.id
        AND decision.artifact_sha256 = artifact.sha256
        AND decision.artifact_object_key = artifact.object_key
      WHERE artifact.organisation_id = ? AND decision.decision = 'approved'
      ORDER BY artifact.source_title, artifact.source_version,
        artifact.captured_at DESC, artifact.id`)
      .bind(organisationId).all<GovernanceSourceArtifactRecord>(),
    database.prepare(`SELECT binding.*,
        COALESCE((SELECT member.display_name FROM compliance_users member
          WHERE member.organisation_id = binding.organisation_id
            AND member.firebase_uid = binding.created_by_uid LIMIT 1),
          (SELECT administrator.display_name FROM admin_users administrator
          WHERE administrator.firebase_uid = binding.created_by_uid LIMIT 1),
          '') created_by_name,
        COALESCE((SELECT member.display_name FROM compliance_users member
          WHERE member.organisation_id = binding.organisation_id
            AND member.firebase_uid = binding.reviewed_by_uid LIMIT 1),
          (SELECT administrator.display_name FROM admin_users administrator
          WHERE administrator.firebase_uid = binding.reviewed_by_uid LIMIT 1),
          '') reviewed_by_name
      FROM compliance_activity_work_pack_source_bindings binding
      WHERE binding.organisation_id = ?
      ORDER BY binding.work_pack_version_id, binding.created_at, binding.id`)
      .bind(organisationId).all<GovernanceSourceBindingRecord>(),
    database.prepare(`SELECT binding.id, binding.activity_template_id,
        binding.activity_version_id, binding.evidence_policy_version_id,
        binding.version, binding.binding_snapshot_sha256,
        binding.lifecycle_state, binding.requested_by_uid,
        binding.approved_by_uid, binding.approved_at,
        COALESCE(json_extract(binding.binding_snapshot, '$.activity.title'), '') title
      FROM compliance_manual_policy_bindings binding
      WHERE binding.organisation_id = ?
      ORDER BY binding.activity_version_id, binding.version DESC, binding.id`)
      .bind(organisationId).all<GovernanceManualPolicyRecord>(),
    database.prepare(`SELECT policy.id, policy.activity_version_id,
        policy.version, policy.title, policy.official_source_url,
        policy.official_source_title, policy.official_source_version,
        policy.official_source_sha256, policy.requirements_complete,
        policy.publish_state
      FROM compliance_evidence_policy_versions policy
      WHERE policy.organisation_id = ?
      ORDER BY policy.activity_version_id, policy.version DESC, policy.id`)
      .bind(organisationId).all<GovernanceEvidencePolicyRecord>(),
    database.prepare(`SELECT calculation.id calculation_run_id,
        calculation.case_id, instance.work_order_id,
        instance.id case_instance_id, instance.instance_key,
        dependency.key dependency_key,
        calculation.input_snapshot, calculation.output_snapshot,
        calculation.run_by_uid, calculation.run_at,
        calculator.id calculator_version_id,
        calculator.calculator_key,
        calculator.version calculator_version,
        COALESCE(review.id, '') review_id,
        COALESCE(review.decision, '') review_decision,
        COALESCE(review.input_sha256, '') review_input_sha256,
        COALESCE(review.output_sha256, '') review_output_sha256,
        COALESCE(review.reviewer_uid, '') reviewer_uid,
        COALESCE(review.review_note, '') review_note,
        COALESCE(review.reviewed_at, '') reviewed_at
      FROM compliance_calculation_runs calculation
      JOIN compliance_cases compliance_case
        ON compliance_case.id = calculation.case_id
        AND compliance_case.organisation_id = calculation.organisation_id
        AND compliance_case.revision = calculation.case_revision
      JOIN compliance_calculator_versions calculator
        ON calculator.id = calculation.calculator_version_id
        AND calculator.organisation_id = calculation.organisation_id
        AND calculator.activity_version_id = compliance_case.activity_version_id
      JOIN compliance_activity_work_pack_instances instance
        ON instance.organisation_id = compliance_case.organisation_id
        AND instance.compliance_case_id = compliance_case.id
      JOIN json_each(
        instance.response_snapshot, '$.response.dependencyResolutions'
      ) dependency
        ON json_extract(dependency.value, '$.referenceIds[0]') = calculation.id
        AND json_array_length(
          json_extract(dependency.value, '$.referenceIds')
        ) = 1
      LEFT JOIN compliance_activity_work_pack_calculation_reviews review
        ON review.organisation_id = calculation.organisation_id
        AND review.calculation_run_id = calculation.id
      WHERE calculation.organisation_id = ?
        AND calculation.status = 'calculated'
        AND NOT EXISTS (
          SELECT 1 FROM compliance_activity_work_pack_instances newer
          WHERE newer.organisation_id = instance.organisation_id
            AND newer.instance_key = instance.instance_key
            AND newer.revision > instance.revision
        )
      ORDER BY calculation.run_at DESC, calculation.id`)
      .bind(organisationId).all<GovernanceCalculationReviewRecord>(),
  ]);

  const activities = activityRows.results.map((row) => Object.freeze({
    id: row.id,
    activityTemplateId: activityTemplateId(row),
    programId: row.program_id,
    programCode: row.program_code,
    activityCode: row.activity_key,
    version: Number(row.version),
    title: row.title,
    serviceCategory: row.service_category,
    registryActivityCode: row.registry_activity_code,
    specificationPart: row.specification_part,
    productCategory: row.product_category,
    scenarioCode: row.scenario_code,
    jurisdiction: row.jurisdiction,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    publishState: row.publish_state,
  }));
  const sourceBindings = bindingRows.results.map((row) => Object.freeze({
    id: row.id,
    workPackVersionId: row.work_pack_version_id,
    schemaSha256: row.schema_sha256,
    sourceArtifactId: row.source_artifact_id,
    sourceArtifactSha256: row.source_artifact_sha256,
    sourceRole: row.source_role,
    targetKey: row.target_key,
    citationLocation: row.citation_location,
    state: row.binding_state,
    createdByUid: row.created_by_uid,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    reviewedByUid: row.reviewed_by_uid,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    withdrawnByUid: row.withdrawn_by_uid,
    withdrawnAt: row.withdrawn_at,
    withdrawalNote: row.withdrawal_note,
  }));
  const versions = versionRows.results.map((row) => {
    const originKind = row.origin_kind === "source_candidate"
      ? "source_candidate" as const
      : "manual" as const;
    const sourceCandidate = originKind === "source_candidate"
      ? parseObject(
          row.source_candidate_snapshot,
          "WORK_PACK_SOURCE_CANDIDATE_INVALID",
          "A sourced work-pack draft has invalid retained candidate provenance.",
        )
      : null;
    const sourceBindingMap = originKind === "source_candidate"
      ? parseArray(
          row.source_binding_map_snapshot,
          "WORK_PACK_SOURCE_BINDING_MAP_INVALID",
          "A sourced work-pack draft has an invalid retained source-binding map.",
        )
      : [];
    const candidateBlockers = originKind === "source_candidate"
      ? parseArray(
          row.candidate_blockers_snapshot,
          "WORK_PACK_SOURCE_CANDIDATE_BLOCKERS_INVALID",
          "A sourced work-pack draft has an invalid retained blocker list.",
        )
      : [];
    if (originKind === "source_candidate" && (
      row.source_candidate_contract !== CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA
      || creditexCanonicalSha256(sourceCandidate) !== row.source_candidate_sha256
      || creditexCanonicalSha256(sourceBindingMap) !== row.source_binding_map_sha256
    )) {
      return fail(
        "WORK_PACK_SOURCE_CANDIDATE_INTEGRITY_MISMATCH",
        500,
        "A sourced work-pack draft no longer matches its retained exact provenance.",
      );
    }
    return Object.freeze({
    id: row.id,
    activityVersionId: row.activity_version_id,
    activityTemplateId: row.activity_template_id,
    version: Number(row.version),
    state: row.publish_state,
    title: row.title,
    schema: validateCreditexActivityWorkPack(parseObject(
      row.schema_snapshot,
      "WORK_PACK_SCHEMA_INVALID",
      "A governed work-pack schema is invalid.",
    )),
    schemaSha256: row.schema_sha256,
    sourceBindingIds: sourceBindings.filter((binding) =>
      binding.workPackVersionId === row.id
        && binding.schemaSha256 === row.schema_sha256
    ).map((binding) => binding.id),
    manualPolicyBindingId: row.manual_policy_binding_id,
    manualPolicyBindingVersion: Number(row.manual_policy_binding_version),
    manualPolicyBindingSha256: row.manual_policy_binding_sha256,
    evidencePolicyVersionId: row.evidence_policy_version_id,
    evidencePolicyVersion: Number(row.evidence_policy_version),
    evidencePolicySourceSha256: row.evidence_policy_source_sha256,
    originKind,
    clientRequestId: row.client_request_id,
    sourceCandidateContract: row.source_candidate_contract,
    sourceCandidateSha256: row.source_candidate_sha256,
    sourceCandidate,
    sourceBindingMapSha256: row.source_binding_map_sha256,
    sourceBindingMap,
    candidateBlockers,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    authoredByUid: row.authored_by_uid,
    authoredByName: row.authored_by_name,
    authoredAt: row.authored_at,
    updatedByUid: row.updated_by_uid,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    reviewedByUid: row.reviewed_by_uid,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    withdrawnByUid: row.withdrawn_by_uid,
    withdrawnAt: row.withdrawn_at,
    withdrawalNote: row.withdrawal_note,
    abandonedByUid: row.abandoned_by_uid,
    abandonedAt: row.abandoned_at,
    abandonmentNote: row.abandonment_note,
  });
  });

  const today = new Date().toISOString().slice(0, 10);
  const coverage = await Promise.all(CREDITEX_WORK_PACK_COVERAGE.map(
    async (catalogueActivity): Promise<CreditexWorkPackGovernanceCoverageRow> => {
    const activity = activities
      .filter((candidate) =>
        candidate.activityTemplateId === catalogueActivity.activityTemplateId
          && candidate.publishState === "published"
          && candidate.effectiveFrom <= today
          && (!candidate.effectiveTo || candidate.effectiveTo >= today)
      )
      .sort((left, right) => right.version - left.version)[0];
    const published = activity
      ? versions.find((version) =>
          version.activityVersionId === activity.id
            && version.state === "published"
            && version.effectiveFrom <= today
            && (!version.effectiveTo || version.effectiveTo >= today)
        )
      : undefined;
    const blockers: string[] = [];
    let resolved: ResolvedCreditexActivityWorkPack | null = null;
    if (!activity) {
      blockers.push("current_activity_version_required");
    }
    if (activity && !published) {
      blockers.push("approved_effective_dated_work_pack_version_required");
    } else if (published) {
      try {
        resolved = await resolvePublishedCreditexActivityWorkPack(
          database,
          {
            organisationId,
            activityVersionId: published.activityVersionId,
            activityDate: today,
          },
        );
        if (resolved.id !== published.id
          || resolved.schemaSha256 !== published.schemaSha256) {
          blockers.push("published_work_pack_identity_changed");
        }
      } catch (error) {
        if (error instanceof CreditexActivityWorkPackServerError) {
          blockers.push(error.code.toLowerCase());
        } else {
          throw error;
        }
      }
    }
    const exactFieldPackReady = Boolean(resolved) && blockers.length === 0;
    const reviewedPackReady = Boolean(
      exactFieldPackReady
      && published
      && published.authoredByUid
      && published.reviewedByUid
      && published.authoredByUid !== published.reviewedByUid
      && published.reviewedAt
      && published.reviewNote,
    );
    const resolvedSourceBindings = resolved
      ? resolved.sourceBindings.map((binding) => {
          const governed = sourceBindings.find((candidate) =>
            candidate.id === binding.id
              && candidate.workPackVersionId === resolved?.id
              && candidate.state === "approved"
          );
          if (
            !governed
            || !["requirement", "product", "scenario", "calculator"]
              .includes(binding.sourceRole)
          ) {
            return fail(
              "WORK_PACK_ACTIVATION_SOURCE_EVIDENCE_INVALID",
              500,
              "A resolved source binding is missing its exact governance evidence.",
            );
          }
          const role = binding.sourceRole === "product"
            ? "product" as const
            : binding.sourceRole === "scenario"
              ? "scenario" as const
              : binding.sourceRole === "calculator"
                ? "calculator" as const
                : "requirement" as const;
          return Object.freeze({
            id: binding.id,
            role,
            targetKey: binding.targetKey,
            artifactId: binding.sourceArtifactId,
            artifactSha256: normaliseSha256(
              binding.sourceArtifactSha256,
              "WORK_PACK_ACTIVATION_SOURCE_SHA256_INVALID",
              "Activation source SHA-256",
            ),
            createdByUid: governed.createdByUid,
            reviewedByUid: governed.reviewedByUid,
            reviewedAt: governed.reviewedAt,
          });
        })
      : [];
    const manualPolicy = resolved
      ? manualRows.results.find((candidate) =>
          candidate.id === resolved?.manualPolicyBindingId
        )
      : undefined;
    const evidencePolicy = resolved
      ? policyRows.results.find((candidate) =>
          candidate.id === resolved?.evidencePolicyVersionId
        )
      : undefined;
    if (resolved && (!manualPolicy || !evidencePolicy)) {
      return fail(
        "WORK_PACK_ACTIVATION_POLICY_EVIDENCE_INVALID",
        500,
        "A resolved work pack is missing its exact policy activation evidence.",
      );
    }
    const calculation = CREDITEX_CALCULATION_COVERAGE.find((candidate) =>
      candidate.activityTemplateId === catalogueActivity.activityTemplateId
    );
    if (!calculation) {
      return fail(
        "WORK_PACK_ACTIVATION_OUTPUT_CLASS_REQUIRED",
        500,
        "The governed catalogue is missing its exact activity output classification.",
      );
    }
    const certificateBlockers = Array.from(new Set(
      calculation.outcomeClass === "tradable_certificate"
        ? [
            ...blockers,
            "exact_product_registry_snapshot_required",
            "exact_scenario_rule_resolution_required",
            "approved_verified_calculator_run_required",
            "completed_current_work_pack_response_required",
            "immutable_final_work_pack_record_required",
            "accepted_external_submission_receipt_required",
          ]
        : [
            ...blockers,
            "certificate_action_not_applicable_for_output_class",
          ],
    )).sort(compareText);
    const outputActionBlockers = calculation.outcomeClass === "tradable_certificate"
      ? ["output_action_not_applicable_for_tradable_certificate"]
      : Array.from(new Set([
          ...blockers,
          `authoritative_${calculation.outcomeClass}_output_action_required`,
        ])).sort(compareText);
    return Object.freeze({
      activityTemplateId: catalogueActivity.activityTemplateId,
      programCode: catalogueActivity.programCode,
      activityCode: catalogueActivity.activityKey,
      title: catalogueActivity.title,
      catalogueState: catalogueActivity.catalogueState === "limited"
        ? "limited" as const
        : "current" as const,
      activityVersionId: activity?.id || null,
      ready: exactFieldPackReady,
      versionId: resolved?.id || null,
      schemaSha256: resolved?.schemaSha256 || null,
      blockers: Object.freeze(blockers),
      currentActivityVersionReady: Boolean(activity),
      independentlyApprovedPackReady: reviewedPackReady,
      approvedExactSourcesReady: exactFieldPackReady,
      productRegistrySnapshotReady: false,
      scenarioRulesReady: false,
      authoritativeCalculatorReady: false,
      fieldCollectionReady: false,
      completionReady: false,
      externalSubmissionReady: false,
      certificateActionEnabled: false,
      certificateBlockers: Object.freeze(certificateBlockers),
      outputClass: calculation.outcomeClass,
      outputActionReady: false,
      outputActionBlockers: Object.freeze(outputActionBlockers),
      operationalOutputDefinition: null,
      activationEvidence: Object.freeze({
        activityVersion: activity
          ? Object.freeze({
              id: activity.id,
              effectiveFrom: activity.effectiveFrom,
              effectiveTo: activity.effectiveTo || null,
            })
          : null,
        workPackVersion: resolved && published
          ? Object.freeze({
              id: resolved.id,
              schemaSha256: resolved.schemaSha256,
              effectiveFrom: resolved.effectiveFrom,
              effectiveTo: resolved.effectiveTo || null,
              authoredByUid: published.authoredByUid,
              reviewedByUid: resolved.reviewedByUid,
              reviewedAt: resolved.reviewedAt,
            })
          : null,
        manualPolicy: resolved && manualPolicy
          ? Object.freeze({
              id: resolved.manualPolicyBindingId,
              version: String(resolved.manualPolicyBindingVersion),
              sha256: normaliseSha256(
                resolved.manualPolicyBindingSha256,
                "WORK_PACK_ACTIVATION_MANUAL_POLICY_SHA256_INVALID",
                "Activation manual-policy SHA-256",
              ),
              requestedByUid: manualPolicy.requested_by_uid,
              approvedByUid: resolved.manualPolicyBinding.approvedByUid,
              approvedAt: resolved.manualPolicyBinding.approvedAt,
            })
          : null,
        evidencePolicy: resolved && evidencePolicy
          ? Object.freeze({
              id: resolved.evidencePolicyVersionId,
              version: String(resolved.evidencePolicyVersion),
              sha256: normaliseSha256(
                resolved.evidencePolicySourceSha256,
                "WORK_PACK_ACTIVATION_EVIDENCE_POLICY_SHA256_INVALID",
                "Activation evidence-policy SHA-256",
              ),
            })
          : null,
        sourceBindings: Object.freeze(resolvedSourceBindings),
        productRegistrySnapshot: null,
        scenarioRules: null,
        authoritativeCalculator: null,
        fieldCollection: null,
        completion: null,
        programActivationEvidence: null,
        externalSubmission: null,
      }),
    });
  }));

  return Object.freeze({
    access: identity.access,
    activities: Object.freeze(activities),
    versions: Object.freeze(versions),
    sourceArtifacts: Object.freeze(artifactRows.results.map((row) =>
      Object.freeze({
        id: row.id,
        title: row.source_title,
        version: row.source_version,
        sourceUrl: row.source_url,
        sourceHost: row.source_host,
        originalFileName: row.original_file_name,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        retrievalMethod: row.retrieval_method,
        assertedRetrievedAt: row.asserted_retrieved_at,
        capturedByUid: row.captured_by_uid,
        capturedAt: row.captured_at,
        decision: row.decision,
        reviewedByUid: row.reviewed_by_uid,
        reviewedAt: row.reviewed_at,
      })
    )),
    sourceBindings: Object.freeze(sourceBindings),
    manualPolicyBindings: Object.freeze(manualRows.results.map((row) =>
      Object.freeze({
        id: row.id,
        activityTemplateId: row.activity_template_id,
        activityVersionId: row.activity_version_id,
        evidencePolicyVersionId: row.evidence_policy_version_id,
        version: Number(row.version),
        sha256: row.binding_snapshot_sha256,
        status: row.lifecycle_state,
        requestedByUid: row.requested_by_uid,
        approvedByUid: row.approved_by_uid,
        approvedAt: row.approved_at,
        title: row.title,
      })
    )),
    evidencePolicies: Object.freeze(policyRows.results.map((row) =>
      Object.freeze({
        id: row.id,
        activityVersionId: row.activity_version_id,
        version: Number(row.version),
        title: row.title,
        sha256: row.official_source_sha256,
        status: row.publish_state,
        requirementsComplete: Number(row.requirements_complete) === 1,
        officialSourceUrl: row.official_source_url,
        officialSourceTitle: row.official_source_title,
        officialSourceVersion: row.official_source_version,
      })
    )),
    calculatorReviews: Object.freeze(calculationRows.results.map((row) => {
      const inputSnapshot = parseObject(
        row.input_snapshot,
        "WORK_PACK_CALCULATION_REVIEW_SNAPSHOT_INVALID",
        "A governed calculation input snapshot is invalid.",
      );
      const outputSnapshot = parseObject(
        row.output_snapshot,
        "WORK_PACK_CALCULATION_REVIEW_SNAPSHOT_INVALID",
        "A governed calculation output snapshot is invalid.",
      );
      const inputSha256 = creditexCanonicalSha256(inputSnapshot);
      const outputSha256 = creditexCanonicalSha256(outputSnapshot);
      if (row.review_id && (
        row.review_input_sha256 !== inputSha256
        || row.review_output_sha256 !== outputSha256
      )) {
        return fail(
          "WORK_PACK_CALCULATION_REVIEW_SNAPSHOT_INVALID",
          500,
          "A retained calculation review no longer matches its immutable snapshots.",
        );
      }
      return Object.freeze({
        calculationRunId: row.calculation_run_id,
        caseId: row.case_id,
        workOrderId: row.work_order_id,
        caseInstanceId: row.case_instance_id,
        instanceKey: row.instance_key,
        dependencyKey: row.dependency_key,
        calculatorVersionId: row.calculator_version_id,
        calculatorKey: row.calculator_key,
        calculatorVersion: Number(row.calculator_version),
        runByUid: row.run_by_uid,
        runAt: row.run_at,
        inputSha256,
        outputSha256,
        status: row.review_decision === "approved"
          ? "approved" as const
          : row.review_decision === "rejected"
            ? "rejected" as const
            : "pending_review" as const,
        reviewId: row.review_id || null,
        reviewerUid: row.reviewer_uid || null,
        reviewNote: row.review_note || null,
        reviewedAt: row.reviewed_at || null,
      });
    })),
    coverage: Object.freeze(coverage),
  });
}

type GovernancePolicyIdentityRecord = {
  manual_policy_binding_id: string;
  activity_template_id: string;
  activity_version_id: string;
  manual_policy_binding_version: number;
  manual_policy_binding_sha256: string;
  evidence_policy_version_id: string;
  evidence_policy_version: number;
  evidence_policy_source_sha256: string;
  manual_binding_snapshot: string;
  manual_binding_lifecycle_state: string;
  manual_binding_approved_by_uid: string;
  manual_binding_approved_at: string;
  evidence_policy_publish_state: string;
  evidence_policy_requirements_complete: number;
  activity_effective_from: string;
  activity_effective_to: string;
};

async function governancePolicyIdentity(
  database: D1Database,
  organisationId: string,
  input: {
    activityVersionId: unknown;
    manualPolicyBindingId: unknown;
    evidencePolicyVersionId: unknown;
  },
) {
  const activityVersionId = text(
    input.activityVersionId,
    180,
    "WORK_PACK_ACTIVITY_REQUIRED",
    "Activity version",
  );
  const manualPolicyBindingId = text(
    input.manualPolicyBindingId,
    180,
    "WORK_PACK_MANUAL_POLICY_REQUIRED",
    "Manual policy binding",
  );
  const evidencePolicyVersionId = text(
    input.evidencePolicyVersionId,
    180,
    "WORK_PACK_EVIDENCE_POLICY_REQUIRED",
    "Evidence policy version",
  );
  const row = await database.prepare(`SELECT
      binding.id manual_policy_binding_id,
      binding.activity_template_id, binding.activity_version_id,
      binding.version manual_policy_binding_version,
      binding.binding_snapshot_sha256 manual_policy_binding_sha256,
      binding.evidence_policy_version_id,
      binding.binding_snapshot manual_binding_snapshot,
      binding.lifecycle_state manual_binding_lifecycle_state,
      binding.approved_by_uid manual_binding_approved_by_uid,
      binding.approved_at manual_binding_approved_at,
      policy.version evidence_policy_version,
      policy.official_source_sha256 evidence_policy_source_sha256,
      policy.publish_state evidence_policy_publish_state,
      policy.requirements_complete evidence_policy_requirements_complete,
      activity.effective_from activity_effective_from,
      activity.effective_to activity_effective_to
    FROM compliance_manual_policy_bindings binding
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = binding.evidence_policy_version_id
      AND policy.organisation_id = binding.organisation_id
      AND policy.activity_version_id = binding.activity_version_id
    JOIN compliance_activity_versions activity
      ON activity.id = binding.activity_version_id
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = binding.organisation_id
    WHERE binding.id = ? AND binding.organisation_id = ?
      AND binding.activity_version_id = ?
      AND binding.evidence_policy_version_id = ?
      AND binding.lifecycle_state = 'approved'
      AND policy.publish_state = 'published'
      AND policy.requirements_complete = 1
      AND activity.publish_state IN ('draft', 'published')
      AND program.publish_state IN ('draft', 'published')`)
    .bind(
      manualPolicyBindingId,
      organisationId,
      activityVersionId,
      evidencePolicyVersionId,
    )
    .first<GovernancePolicyIdentityRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_APPROVED_POLICY_BINDING_REQUIRED",
      409,
      "Choose an exact approved manual-policy binding and published complete evidence policy for this activity.",
    );
  }
  return row;
}

function validateGovernanceSchemaIdentity(
  value: unknown,
  input: {
    activityTemplateId: string;
    version: number;
    effectiveFrom: unknown;
    effectiveTo: unknown;
  },
) {
  const workPack = validateCreditexActivityWorkPack(object(
    value,
    "WORK_PACK_SCHEMA_REQUIRED",
    "A valid activity work-pack schema is required.",
  ));
  const effectiveFrom = date(
    input.effectiveFrom,
    "WORK_PACK_EFFECTIVE_FROM_REQUIRED",
    "Effective from",
  );
  const effectiveTo = optionalText(input.effectiveTo, 10);
  if (effectiveTo) {
    date(effectiveTo, "WORK_PACK_EFFECTIVE_TO_INVALID", "Effective to");
  }
  if (
    workPack.activityTemplateId !== input.activityTemplateId
    || workPack.version !== input.version
    || workPack.effectiveFrom !== effectiveFrom
    || workPack.effectiveTo !== effectiveTo
  ) {
    return fail(
      "WORK_PACK_SCHEMA_IDENTITY_MISMATCH",
      409,
      "The schema identity, version and effective dates must exactly match the governed draft.",
    );
  }
  return Object.freeze({
    workPack,
    schemaSnapshot: checkedJson(workPack),
    schemaSha256: creditexActivityWorkPackSha256(workPack),
    effectiveFrom,
    effectiveTo,
  });
}

function laterGovernanceInstant(now: string, previous: string) {
  const nowMs = Date.parse(now);
  const previousMs = Date.parse(previous);
  return new Date(Math.max(nowMs, previousMs + 1)).toISOString();
}

export async function createCreditexWorkPackDraft(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    activityVersionId: unknown;
    manualPolicyBindingId: unknown;
    evidencePolicyVersionId: unknown;
    schema: unknown;
    effectiveFrom: unknown;
    effectiveTo?: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canAuthor");
  const policy = await governancePolicyIdentity(
    database,
    actor.organisationId,
    input,
  );
  const next = await database.prepare(`SELECT 1 + COALESCE(MAX(version), 0) value
    FROM compliance_activity_work_pack_versions
    WHERE organisation_id = ? AND activity_template_id = ?`)
    .bind(actor.organisationId, policy.activity_template_id)
    .first<{ value: number }>();
  const version = safeInteger(
    next?.value,
    1,
    "WORK_PACK_VERSION_INVALID",
    "Work-pack version",
  );
  const schema = validateGovernanceSchemaIdentity(input.schema, {
    activityTemplateId: policy.activity_template_id,
    version,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  });
  if (
    schema.effectiveFrom < policy.activity_effective_from
    || policy.activity_effective_to
      && (!schema.effectiveTo || schema.effectiveTo > policy.activity_effective_to)
  ) {
    return fail(
      "WORK_PACK_EFFECTIVE_RANGE_INVALID",
      409,
      "The work-pack effective range must stay inside its governed activity version.",
    );
  }
  const now = governedNow(options);
  const id = governedId("work-pack-version", options);
  const result = await database.prepare(`INSERT INTO
      compliance_activity_work_pack_versions (
        id, organisation_id, activity_version_id, activity_template_id,
        manual_policy_binding_id, manual_policy_binding_version,
        manual_policy_binding_sha256, evidence_policy_version_id,
        evidence_policy_version, evidence_policy_source_sha256,
        version, contract, title, schema_snapshot, schema_sha256,
        effective_from, effective_to, publish_state,
        authored_by_uid, authored_at, updated_by_uid, updated_at,
        reviewed_by_uid, reviewed_at, review_note,
        withdrawn_by_uid, withdrawn_at, withdrawal_note,
        abandoned_by_uid, abandoned_at, abandonment_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'draft', ?, ?, ?, ?, '', '', '', '', '', '', '', '', '', ?)`)
    .bind(
      id,
      actor.organisationId,
      policy.activity_version_id,
      policy.activity_template_id,
      policy.manual_policy_binding_id,
      Number(policy.manual_policy_binding_version),
      policy.manual_policy_binding_sha256,
      policy.evidence_policy_version_id,
      Number(policy.evidence_policy_version),
      policy.evidence_policy_source_sha256,
      version,
      schema.workPack.contract,
      schema.workPack.title,
      schema.schemaSnapshot,
      schema.schemaSha256,
      schema.effectiveFrom,
      schema.effectiveTo,
      identity.actorUid,
      now,
      identity.actorUid,
      now,
      now,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_DRAFT_CREATE_FAILED",
      409,
      "The governed work-pack draft was not created.",
    );
  }
  return Object.freeze({ savedVersionId: id, schemaSha256: schema.schemaSha256 });
}

type SourcedDraftActivityRecord = GovernanceActivityRecord;

type SourcedDraftReplayRecord = {
  id: string;
  activity_version_id: string;
  activity_template_id: string;
  origin_kind: string;
  source_candidate_sha256: string;
  source_binding_map_sha256: string;
  schema_sha256: string;
};

type SourcedDraftArtifactRecord = {
  id: string;
  client_request_id: string;
  source_url: string;
  source_title: string;
  source_version: string;
  sha256: string;
  captured_at: string;
  decision: string;
};

async function sourcedDraftReplay(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
  expected: Readonly<{
    activityVersionId: string;
    activityTemplateId: string;
    sourceCandidateSha256: string;
  }>,
) {
  const existing = await database.prepare(`SELECT id, activity_version_id,
      activity_template_id, origin_kind, source_candidate_sha256,
      source_binding_map_sha256, schema_sha256
    FROM compliance_activity_work_pack_versions
    WHERE organisation_id = ? AND client_request_id = ?`)
    .bind(organisationId, clientRequestId)
    .first<SourcedDraftReplayRecord>();
  if (!existing) return null;
  if (
    existing.origin_kind !== "source_candidate"
    || existing.activity_version_id !== expected.activityVersionId
    || existing.activity_template_id !== expected.activityTemplateId
    || existing.source_candidate_sha256 !== expected.sourceCandidateSha256
  ) {
    return fail(
      "WORK_PACK_SOURCE_DRAFT_IDEMPOTENCY_MISMATCH",
      409,
      "That sourced-draft request identity is already bound to different exact content.",
    );
  }
  return Object.freeze({
    savedVersionId: existing.id,
    schemaSha256: existing.schema_sha256,
    sourceCandidateSha256: existing.source_candidate_sha256,
    sourceBindingMapSha256: existing.source_binding_map_sha256,
    replayed: true,
  });
}

function exactSourcedDraftBindingMap(
  candidate: CreditexCurrentWorkPackContentCandidate,
  workPack: CreditexActivityWorkPack,
  artifacts: readonly SourcedDraftArtifactRecord[],
) {
  return Object.freeze(creditexSourcedWorkPackSourceBindings(candidate, workPack)
    .map((binding) => {
      const sourceArtifacts = artifacts.filter((artifact) =>
        artifact.client_request_id.endsWith(`:${binding.sourceId}`)
      ).sort((left, right) =>
        compareText(right.captured_at, left.captured_at)
          || compareText(right.id, left.id)
      );
      const exactArtifact = sourceArtifacts.find((artifact) =>
        artifact.source_url === binding.officialUrl
          && artifact.sha256 === binding.expectedSha256
      );
      const identityMismatch = sourceArtifacts.length > 0 && !exactArtifact;
      return Object.freeze({
        contract: CREDITEX_SOURCED_WORK_PACK_DRAFT_BINDING_MAP_CONTRACT,
        ...binding,
        artifactId: exactArtifact?.id || "",
        artifactSha256: exactArtifact?.sha256 || "",
        artifactReviewState: exactArtifact?.decision || (
          identityMismatch ? "identity_mismatch" : "not_imported"
        ),
        exactArtifactMatch: Boolean(exactArtifact),
      });
    }));
}

export async function createCreditexSourcedWorkPackDraft(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    activityVersionId: unknown;
    clientRequestId: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canAuthor");
  const activityVersionId = text(
    input.activityVersionId,
    220,
    "WORK_PACK_ACTIVITY_VERSION_REQUIRED",
    "Activity version",
  );
  const clientRequestId = text(
    input.clientRequestId,
    240,
    "WORK_PACK_SOURCE_DRAFT_REQUEST_REQUIRED",
    "Sourced-draft request",
  );
  if (clientRequestId.length < 8) {
    return fail(
      "WORK_PACK_SOURCE_DRAFT_REQUEST_REQUIRED",
      400,
      "Sourced-draft request must contain at least 8 characters.",
    );
  }
  const activity = await database.prepare(`SELECT activity.id,
      activity.program_id, program.program_code, activity.activity_key,
      activity.version, activity.title, activity.service_category,
      activity.registry_activity_code, activity.specification_part,
      activity.product_category, activity.scenario_code,
      activity.jurisdiction, activity.effective_from,
      activity.effective_to, activity.publish_state
    FROM compliance_activity_versions activity
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = ?
    WHERE activity.id = ?`)
    .bind(actor.organisationId, activityVersionId)
    .first<SourcedDraftActivityRecord>();
  if (!activity) {
    return fail(
      "WORK_PACK_ACTIVITY_VERSION_REQUIRED",
      404,
      "The governed activity version was not found.",
    );
  }
  const templateId = activityTemplateId(activity);
  const candidate = CREDITEX_CURRENT_WORK_PACK_CONTENT_BY_TEMPLATE_ID.get(
    templateId,
  );
  if (
    !templateId
    || !candidate
    || candidate.schema !== CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA
    || candidate.templateId !== templateId
    || candidate.draftCreationState === "not_available"
    || (
      candidate.draftCreationState === "source_bound_guided_capture"
      && (
        candidate.guidedCaptureState !== "publishable_source_bound"
        || candidate.candidateOnly
      )
    )
    || (
      candidate.draftCreationState === "source_backed_review_draft"
      && (
        candidate.guidedCaptureState !== "source_backed_review_candidate"
        || !candidate.candidateOnly
      )
    )
    || candidate.activationReady
  ) {
    return fail(
      "WORK_PACK_SOURCE_DRAFT_NOT_AVAILABLE",
      409,
      "This activity has no exact current source-backed governed-draft contract.",
    );
  }
  const candidateSnapshot = checkedJson(candidate);
  const sourceCandidateSha256 = creditexCanonicalSha256(candidate);
  const replay = await sourcedDraftReplay(
    database,
    actor.organisationId,
    clientRequestId,
    {
      activityVersionId,
      activityTemplateId: templateId,
      sourceCandidateSha256,
    },
  );
  if (replay) return replay;

  const artifactRows = await database.prepare(`SELECT artifact.id,
      artifact.client_request_id, artifact.source_url,
      artifact.source_title, artifact.source_version, artifact.sha256,
      artifact.captured_at, COALESCE(decision.decision, 'pending_review') decision
    FROM compliance_official_source_artifacts artifact
    LEFT JOIN compliance_official_source_review_decisions decision
      ON decision.id = (
        SELECT latest.id
        FROM compliance_official_source_review_decisions latest
        WHERE latest.organisation_id = artifact.organisation_id
          AND latest.subject_type = 'artifact'
          AND latest.subject_id = artifact.id
        ORDER BY latest.reviewed_at DESC, latest.id DESC LIMIT 1
      )
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
    WHERE artifact.organisation_id = ?
      AND artifact.client_request_id LIKE 'official-source-import:%'
    ORDER BY artifact.captured_at DESC, artifact.id DESC`)
    .bind(actor.organisationId)
    .all<SourcedDraftArtifactRecord>();
  const now = governedNow(options);
  const catalogueReviewedOn = now.slice(0, 10);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = await database.prepare(`SELECT 1 + COALESCE(MAX(version), 0) value
      FROM compliance_activity_work_pack_versions
      WHERE organisation_id = ? AND activity_template_id = ?`)
      .bind(actor.organisationId, templateId)
      .first<{ value: number }>();
    const version = safeInteger(
      next?.value,
      1,
      "WORK_PACK_VERSION_INVALID",
      "Work-pack version",
    );
    let workPack: CreditexActivityWorkPack;
    let sourceBindingMap: ReturnType<typeof exactSourcedDraftBindingMap>;
    try {
      workPack = buildCreditexSourcedWorkPackDraft({
        candidate,
        version,
        effectiveFrom: activity.effective_from,
        effectiveTo: activity.effective_to,
        catalogueReviewedOn,
      });
      sourceBindingMap = exactSourcedDraftBindingMap(
        candidate,
        workPack,
        artifactRows.results,
      );
    } catch {
      return fail(
        "WORK_PACK_SOURCE_DRAFT_CONTRACT_INVALID",
        409,
        "The current source-backed content cannot produce an exact governed draft.",
      );
    }
    const schemaSnapshot = checkedJson(workPack);
    const schemaSha256 = creditexActivityWorkPackSha256(workPack);
    const sourceBindingMapSnapshot = checkedJson(sourceBindingMap);
    const sourceBindingMapSha256 = creditexCanonicalSha256(sourceBindingMap);
    const candidateBlockersSnapshot = checkedJson(candidate.blockers);
    const id = governedId("work-pack-version", options);
    try {
      const result = await database.prepare(`INSERT INTO
          compliance_activity_work_pack_versions (
            id, organisation_id, activity_version_id, activity_template_id,
            manual_policy_binding_id, manual_policy_binding_version,
            manual_policy_binding_sha256, evidence_policy_version_id,
            evidence_policy_version, evidence_policy_source_sha256,
            origin_kind, client_request_id, source_candidate_contract,
            source_candidate_snapshot, source_candidate_sha256,
            source_binding_map_snapshot, source_binding_map_sha256,
            candidate_blockers_snapshot, version, contract, title,
            schema_snapshot, schema_sha256, effective_from, effective_to,
            publish_state, authored_by_uid, authored_at, updated_by_uid,
            updated_at, reviewed_by_uid, reviewed_at, review_note,
            withdrawn_by_uid, withdrawn_at, withdrawal_note,
            abandoned_by_uid, abandoned_at, abandonment_note, created_at
          ) VALUES (?, ?, ?, ?, '', 0, '', '', 0, '',
            'source_candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'draft', ?, ?, ?, ?, '', '', '', '', '', '', '', '', '', ?)`)
        .bind(
          id,
          actor.organisationId,
          activityVersionId,
          templateId,
          clientRequestId,
          CREDITEX_CURRENT_WORK_PACK_CONTENT_SCHEMA,
          candidateSnapshot,
          sourceCandidateSha256,
          sourceBindingMapSnapshot,
          sourceBindingMapSha256,
          candidateBlockersSnapshot,
          version,
          workPack.contract,
          workPack.title,
          schemaSnapshot,
          schemaSha256,
          workPack.effectiveFrom,
          workPack.effectiveTo,
          identity.actorUid,
          now,
          identity.actorUid,
          now,
          now,
        ).run();
      if (Number(result.meta.changes || 0) !== 1) {
        return fail(
          "WORK_PACK_SOURCE_DRAFT_CREATE_FAILED",
          409,
          "The sourced governed work-pack draft was not created.",
        );
      }
      return Object.freeze({
        savedVersionId: id,
        schemaSha256,
        sourceCandidateSha256,
        sourceBindingMapSha256,
        replayed: false,
      });
    } catch (error) {
      const concurrentReplay = await sourcedDraftReplay(
        database,
        actor.organisationId,
        clientRequestId,
        {
          activityVersionId,
          activityTemplateId: templateId,
          sourceCandidateSha256,
        },
      );
      if (concurrentReplay) return concurrentReplay;
      if (attempt === 1) throw error;
    }
  }
  return fail(
    "WORK_PACK_SOURCE_DRAFT_CREATE_FAILED",
    409,
    "The sourced governed work-pack draft was not created.",
  );
}

type DraftGovernanceVersionRecord = {
  id: string;
  activity_template_id: string;
  activity_version_id: string;
  origin_kind: string;
  version: number;
  schema_sha256: string;
  publish_state: string;
  updated_at: string;
};

async function draftGovernanceVersion(
  database: D1Database,
  organisationId: string,
  idValue: unknown,
) {
  const id = text(
    idValue,
    220,
    "WORK_PACK_VERSION_REQUIRED",
    "Work-pack version",
  );
  const row = await database.prepare(`SELECT id, activity_template_id,
      activity_version_id, origin_kind, version, schema_sha256,
      publish_state, updated_at
    FROM compliance_activity_work_pack_versions
    WHERE id = ? AND organisation_id = ?`)
    .bind(id, organisationId)
    .first<DraftGovernanceVersionRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_VERSION_NOT_FOUND",
      404,
      "The governed work-pack version was not found.",
    );
  }
  return row;
}

export async function updateCreditexWorkPackDraft(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    id: unknown;
    expectedSchemaSha256: unknown;
    schema: unknown;
    effectiveFrom: unknown;
    effectiveTo?: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canAuthor");
  const row = await draftGovernanceVersion(
    database,
    actor.organisationId,
    input.id,
  );
  const expected = normaliseSha256(
    input.expectedSchemaSha256,
    "WORK_PACK_SCHEMA_CAS_REQUIRED",
    "Expected schema SHA-256",
  );
  if (row.publish_state !== "draft" || row.schema_sha256 !== expected) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before editing it.",
    );
  }
  const schema = validateGovernanceSchemaIdentity(input.schema, {
    activityTemplateId: row.activity_template_id,
    version: Number(row.version),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  });
  if (schema.schemaSha256 === expected) {
    return Object.freeze({ savedVersionId: row.id, schemaSha256: expected });
  }
  const now = laterGovernanceInstant(governedNow(options), row.updated_at);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_versions
    SET title = ?, schema_snapshot = ?, schema_sha256 = ?,
      effective_from = ?, effective_to = ?, updated_by_uid = ?, updated_at = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
      AND schema_sha256 = ?`)
    .bind(
      schema.workPack.title,
      schema.schemaSnapshot,
      schema.schemaSha256,
      schema.effectiveFrom,
      schema.effectiveTo,
      identity.actorUid,
      now,
      row.id,
      actor.organisationId,
      expected,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before editing it.",
    );
  }
  return Object.freeze({
    savedVersionId: row.id,
    schemaSha256: schema.schemaSha256,
  });
}

function sourceRole(value: unknown) {
  const result = String(value || "");
  if (["requirement", "product", "scenario", "calculator"].includes(result)) {
    return result as "requirement" | "product" | "scenario" | "calculator";
  }
  return fail(
    "WORK_PACK_SOURCE_ROLE_INVALID",
    400,
    "Choose a governed source role.",
  );
}

export async function addCreditexWorkPackSourceBinding(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    id: unknown;
    expectedSchemaSha256: unknown;
    sourceArtifactId: unknown;
    sourceRole: unknown;
    targetKey: unknown;
    citationLocation: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canAuthor");
  const version = await draftGovernanceVersion(
    database,
    actor.organisationId,
    input.id,
  );
  const expected = normaliseSha256(
    input.expectedSchemaSha256,
    "WORK_PACK_SCHEMA_CAS_REQUIRED",
    "Expected schema SHA-256",
  );
  if (version.publish_state !== "draft" || version.schema_sha256 !== expected) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before attaching a source.",
    );
  }
  const versionSchema = await database.prepare(`SELECT schema_snapshot
    FROM compliance_activity_work_pack_versions
    WHERE id = ? AND organisation_id = ?`)
    .bind(version.id, actor.organisationId)
    .first<{ schema_snapshot: string }>();
  const workPack = validateCreditexActivityWorkPack(parseObject(
    versionSchema?.schema_snapshot,
    "WORK_PACK_SCHEMA_INVALID",
    "The governed work-pack schema is invalid.",
  ));
  const role = sourceRole(input.sourceRole);
  const targetKey = text(
    input.targetKey,
    180,
    "WORK_PACK_SOURCE_TARGET_REQUIRED",
    "Source target",
  );
  if (!sourceTargetKeys(workPack).has(targetKey)) {
    return fail(
      "WORK_PACK_SOURCE_TARGET_INVALID",
      409,
      "The source target is not present in the exact work-pack schema.",
    );
  }
  if (role !== "requirement" && !workPack.dependencies.some((dependency) =>
    dependency.kind === role && dependency.dependencyKey === targetKey
  )) {
    return fail(
      "WORK_PACK_SOURCE_TARGET_INVALID",
      409,
      "Product, scenario and calculator sources must target the matching schema dependency.",
    );
  }
  const sourceArtifactId = text(
    input.sourceArtifactId,
    220,
    "WORK_PACK_SOURCE_ARTIFACT_REQUIRED",
    "Source artifact",
  );
  const artifact = await database.prepare(`SELECT artifact.id, artifact.sha256
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_review_decisions decision
      ON decision.id = (
        SELECT latest.id FROM compliance_official_source_review_decisions latest
        WHERE latest.organisation_id = artifact.organisation_id
          AND latest.subject_type = 'artifact'
          AND latest.subject_id = artifact.id
        ORDER BY latest.reviewed_at DESC, latest.id DESC LIMIT 1
      )
      AND decision.artifact_id = artifact.id
      AND decision.artifact_sha256 = artifact.sha256
      AND decision.artifact_object_key = artifact.object_key
      AND decision.decision = 'approved'
    WHERE artifact.id = ? AND artifact.organisation_id = ?`)
    .bind(sourceArtifactId, actor.organisationId)
    .first<{ id: string; sha256: string }>();
  if (!artifact) {
    return fail(
      "WORK_PACK_APPROVED_SOURCE_ARTIFACT_REQUIRED",
      409,
      "Choose an exact independently approved official source artifact.",
    );
  }
  const citationLocation = text(
    input.citationLocation,
    2000,
    "WORK_PACK_SOURCE_CITATION_REQUIRED",
    "Source citation location",
  );
  const id = governedId("work-pack-source", options);
  const now = governedNow(options);
  const result = await database.prepare(`INSERT INTO
      compliance_activity_work_pack_source_bindings (
        id, organisation_id, work_pack_version_id, schema_sha256,
        source_artifact_id, source_artifact_sha256, source_role,
        target_key, citation_location, binding_state,
        created_by_uid, created_at, reviewed_by_uid, reviewed_at,
        review_note, withdrawn_by_uid, withdrawn_at, withdrawal_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?,
        '', '', '', '', '', '')`)
    .bind(
      id,
      actor.organisationId,
      version.id,
      expected,
      artifact.id,
      artifact.sha256,
      role,
      targetKey,
      citationLocation,
      identity.actorUid,
      now,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_SOURCE_BINDING_CREATE_FAILED",
      409,
      "The governed source binding was not created.",
    );
  }
  return Object.freeze({ savedVersionId: version.id, savedBindingId: id });
}

type GovernanceBindingTransitionRecord = {
  id: string;
  work_pack_version_id: string;
  schema_sha256: string;
  binding_state: string;
};

async function governanceBinding(
  database: D1Database,
  organisationId: string,
  idValue: unknown,
) {
  const id = text(
    idValue,
    220,
    "WORK_PACK_SOURCE_BINDING_REQUIRED",
    "Source binding",
  );
  const row = await database.prepare(`SELECT id, work_pack_version_id,
      schema_sha256, binding_state
    FROM compliance_activity_work_pack_source_bindings
    WHERE id = ? AND organisation_id = ?`)
    .bind(id, organisationId)
    .first<GovernanceBindingTransitionRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_SOURCE_BINDING_NOT_FOUND",
      404,
      "The governed source binding was not found.",
    );
  }
  return row;
}

function governanceComment(value: unknown, label: string) {
  const result = text(
    value,
    2000,
    "WORK_PACK_GOVERNANCE_COMMENT_REQUIRED",
    label,
  );
  if (result.length < 10) {
    return fail(
      "WORK_PACK_GOVERNANCE_COMMENT_REQUIRED",
      400,
      `${label} must explain the governed decision in at least 10 characters.`,
    );
  }
  return result;
}

export async function reviewCreditexWorkPackSourceBinding(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    id: unknown;
    expectedSchemaSha256: unknown;
    decision: unknown;
    comment: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canReview");
  const binding = await governanceBinding(
    database,
    actor.organisationId,
    input.id,
  );
  const expected = normaliseSha256(
    input.expectedSchemaSha256,
    "WORK_PACK_SCHEMA_CAS_REQUIRED",
    "Expected schema SHA-256",
  );
  const decision = String(input.decision || "");
  if (decision !== "approved" && decision !== "rejected") {
    return fail(
      "WORK_PACK_SOURCE_DECISION_INVALID",
      400,
      "Choose approved or rejected for the source binding review.",
    );
  }
  if (binding.binding_state !== "pending_review"
    || binding.schema_sha256 !== expected) {
    return fail(
      "WORK_PACK_SOURCE_BINDING_CHANGED",
      409,
      "The source binding or its draft schema changed. Reload before reviewing it.",
    );
  }
  const comment = governanceComment(input.comment, "Source review note");
  const now = governedNow(options);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_source_bindings
    SET binding_state = ?, reviewed_by_uid = ?, reviewed_at = ?, review_note = ?
    WHERE id = ? AND organisation_id = ?
      AND binding_state = 'pending_review' AND schema_sha256 = ?`)
    .bind(
      decision,
      identity.actorUid,
      now,
      comment,
      binding.id,
      actor.organisationId,
      expected,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_SOURCE_BINDING_CHANGED",
      409,
      "The source binding changed. Reload before reviewing it.",
    );
  }
  return Object.freeze({
    savedVersionId: binding.work_pack_version_id,
    savedBindingId: binding.id,
  });
}

export async function withdrawCreditexWorkPackSourceBinding(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{ id: unknown; comment: unknown }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canWithdraw");
  const binding = await governanceBinding(
    database,
    actor.organisationId,
    input.id,
  );
  if (binding.binding_state !== "approved") {
    return fail(
      "WORK_PACK_SOURCE_BINDING_CHANGED",
      409,
      "Only an approved source binding can be withdrawn.",
    );
  }
  const comment = governanceComment(input.comment, "Source withdrawal note");
  const now = governedNow(options);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_source_bindings
    SET binding_state = 'withdrawn', withdrawn_by_uid = ?,
      withdrawn_at = ?, withdrawal_note = ?
    WHERE id = ? AND organisation_id = ? AND binding_state = 'approved'`)
    .bind(
      identity.actorUid,
      now,
      comment,
      binding.id,
      actor.organisationId,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_SOURCE_BINDING_CHANGED",
      409,
      "The source binding changed. Reload before withdrawing it.",
    );
  }
  return Object.freeze({
    savedVersionId: binding.work_pack_version_id,
    savedBindingId: binding.id,
  });
}

async function governanceVersionForPublish(
  database: D1Database,
  organisationId: string,
  idValue: unknown,
) {
  const id = text(
    idValue,
    220,
    "WORK_PACK_VERSION_REQUIRED",
    "Work-pack version",
  );
  const row = await database.prepare(`SELECT version.*,
      binding.binding_snapshot manual_binding_snapshot,
      binding.lifecycle_state manual_binding_lifecycle_state,
      binding.approved_by_uid manual_binding_approved_by_uid,
      binding.approved_at manual_binding_approved_at,
      policy.publish_state evidence_policy_publish_state,
      policy.requirements_complete evidence_policy_requirements_complete
    FROM compliance_activity_work_pack_versions version
    JOIN compliance_manual_policy_bindings binding
      ON binding.id = version.manual_policy_binding_id
      AND binding.organisation_id = version.organisation_id
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = version.evidence_policy_version_id
      AND policy.organisation_id = version.organisation_id
    WHERE version.id = ? AND version.organisation_id = ?`)
    .bind(id, organisationId)
    .first<WorkPackVersionRecord>();
  if (!row) {
    return fail(
      "WORK_PACK_VERSION_NOT_FOUND",
      404,
      "The governed work-pack version was not found.",
    );
  }
  return row;
}

export async function publishCreditexWorkPackVersion(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    id: unknown;
    expectedSchemaSha256: unknown;
    comment: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canPublish");
  const draft = await draftGovernanceVersion(
    database,
    actor.organisationId,
    input.id,
  );
  if (draft.origin_kind === "source_candidate") {
    return fail(
      "WORK_PACK_SOURCE_CANDIDATE_REVIEW_REQUIRED",
      409,
      "A source-backed candidate draft must be rebuilt through the approved policy and independently reviewed source-binding path before publication.",
    );
  }
  const row = await governanceVersionForPublish(
    database,
    actor.organisationId,
    input.id,
  );
  const expected = normaliseSha256(
    input.expectedSchemaSha256,
    "WORK_PACK_SCHEMA_CAS_REQUIRED",
    "Expected schema SHA-256",
  );
  if (row.publish_state !== "draft" || row.schema_sha256 !== expected) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before publishing it.",
    );
  }
  if (row.authored_by_uid === identity.actorUid) {
    return fail(
      "WORK_PACK_INDEPENDENT_REVIEWER_REQUIRED",
      409,
      "A different named reviewer must publish this work-pack version.",
    );
  }
  const workPack = validateCreditexActivityWorkPack(parseObject(
    row.schema_snapshot,
    "WORK_PACK_SCHEMA_INVALID",
    "The governed work-pack schema is invalid.",
  ));
  if (creditexActivityWorkPackSha256(workPack) !== expected) {
    return fail(
      "WORK_PACK_SCHEMA_SHA256_MISMATCH",
      409,
      "The governed work-pack schema no longer matches its exact SHA-256.",
    );
  }
  validateCatalogueDependencies(workPack);
  await validatePinnedPolicyComposition(database, row, workPack);
  validateSourceComposition(
    workPack,
    await approvedSourceBindings(database, actor.organisationId, row.id),
  );
  const comment = governanceComment(input.comment, "Publication review note");
  const now = governedNow(options);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_versions
    SET publish_state = 'published', reviewed_by_uid = ?,
      reviewed_at = ?, review_note = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
      AND schema_sha256 = ?`)
    .bind(
      identity.actorUid,
      now,
      comment,
      row.id,
      actor.organisationId,
      expected,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before publishing it.",
    );
  }
  return Object.freeze({ savedVersionId: row.id, schemaSha256: expected });
}

export async function withdrawCreditexWorkPackVersion(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{ id: unknown; comment: unknown }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canWithdraw");
  const row = await governanceVersionForPublish(
    database,
    actor.organisationId,
    input.id,
  );
  if (row.publish_state !== "published") {
    return fail(
      "WORK_PACK_VERSION_CHANGED",
      409,
      "Only a published work-pack version can be withdrawn.",
    );
  }
  if (row.authored_by_uid === identity.actorUid) {
    return fail(
      "WORK_PACK_NAMED_WITHDRAWER_REQUIRED",
      409,
      "A different named governance actor must withdraw this version.",
    );
  }
  const comment = governanceComment(input.comment, "Version withdrawal note");
  const now = governedNow(options);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_versions
    SET publish_state = 'withdrawn', withdrawn_by_uid = ?,
      withdrawn_at = ?, withdrawal_note = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'published'`)
    .bind(
      identity.actorUid,
      now,
      comment,
      row.id,
      actor.organisationId,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_VERSION_CHANGED",
      409,
      "The work-pack version changed. Reload before withdrawing it.",
    );
  }
  return Object.freeze({ savedVersionId: row.id });
}

export async function abandonCreditexWorkPackDraft(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    id: unknown;
    expectedSchemaSha256: unknown;
    comment: unknown;
  }>,
  options?: GovernanceOptions,
) {
  const identity = await governanceIdentity(database, actor);
  requireGovernancePermission(identity, "canAuthor");
  const row = await draftGovernanceVersion(
    database,
    actor.organisationId,
    input.id,
  );
  const expected = normaliseSha256(
    input.expectedSchemaSha256,
    "WORK_PACK_SCHEMA_CAS_REQUIRED",
    "Expected schema SHA-256",
  );
  if (row.publish_state !== "draft" || row.schema_sha256 !== expected) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before abandoning it.",
    );
  }
  const comment = governanceComment(input.comment, "Draft abandonment note");
  const now = governedNow(options);
  const result = await database.prepare(`UPDATE
      compliance_activity_work_pack_versions
    SET publish_state = 'abandoned', abandoned_by_uid = ?,
      abandoned_at = ?, abandonment_note = ?
    WHERE id = ? AND organisation_id = ? AND publish_state = 'draft'
      AND schema_sha256 = ?`)
    .bind(
      identity.actorUid,
      now,
      comment,
      row.id,
      actor.organisationId,
      expected,
    ).run();
  if (Number(result.meta.changes || 0) !== 1) {
    return fail(
      "WORK_PACK_DRAFT_CHANGED",
      409,
      "The governed draft changed. Reload before abandoning it.",
    );
  }
  return Object.freeze({ savedVersionId: row.id });
}

type OutputReadinessInstanceRecord = WorkPackInstanceRecord & Readonly<{
  activity_effective_from: string;
  activity_effective_to: string;
  activity_publish_state: string;
  pack_effective_from: string;
  pack_effective_to: string;
  pack_authored_by_uid: string;
  pack_reviewed_by_uid: string;
  pack_reviewed_at: string;
  manual_requested_by_uid: string;
  manual_approved_by_uid: string;
  manual_approved_at: string;
  evidence_policy_version: number;
  evidence_policy_source_sha256: string;
  final_record_id: string;
  final_instance_sha256: string;
  final_prefill_sha256: string;
  final_response_sha256: string;
  final_signature_manifest_sha256: string;
  final_pdf_sha256: string;
  final_integrity_receipt_id: string;
  finalised_by_uid: string;
  finalised_at: string;
}>;

type OutputReadinessCalculationIdentity = Readonly<{
  id: string;
  input_snapshot: string;
  output_snapshot: string;
  run_by_uid: string;
  calculator_version_id: string;
  calculator_specification: string;
  review_input_sha256: string;
  review_output_sha256: string;
}>;

/**
 * Resolves output readiness for one immutable completed case. This deliberately
 * replays the same product, scenario and calculator validators used by field
 * completion instead of promoting the catalogue-level governance summary.
 */
async function resolveCreditexActivityWorkPackOutputReadiness(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    activityTemplateId: string;
    caseInstanceId: string;
  }>,
  governance: Readonly<{
    coverage: readonly CreditexWorkPackGovernanceCoverageRow[];
  }>,
): Promise<CreditexWorkPackGovernanceCoverageRow> {
  const activityTemplateIdValue = text(
    input.activityTemplateId,
    240,
    "WORK_PACK_OUTPUT_ACTIVITY_REQUIRED",
    "Governed activity",
  );
  const caseInstanceId = text(
    input.caseInstanceId,
    240,
    "WORK_PACK_OUTPUT_INSTANCE_REQUIRED",
    "Completed work-pack instance",
  );
  const base = governance.coverage.find((candidate) =>
    candidate.activityTemplateId === activityTemplateIdValue
  );
  if (!base) {
    return fail(
      "WORK_PACK_OUTPUT_ACTIVITY_UNAVAILABLE",
      404,
      "The exact governed activity readiness row was not found.",
    );
  }
  const row = await database.prepare(`SELECT instance.*,
      compliance_case.activity_version_id,
      compliance_case.revision case_revision,
      compliance_case.evidence_policy_version_id,
      compliance_case.installer_uid,
      COALESCE(work_order.source_type, '') source_type,
      COALESCE(job_detail.customer_source, '') customer_source,
      COALESCE(work_order.assignee_member_id, '') assignee_member_id,
      CASE
        WHEN COALESCE(work_order.assignee_member_id, '') = ''
          THEN COALESCE(work_order.firebase_uid, '')
        ELSE COALESCE(assigned_member.member_uid, '')
      END assigned_worker_uid,
      COALESCE(work_order.revision, 1) work_order_revision,
      activity.effective_from activity_effective_from,
      activity.effective_to activity_effective_to,
      activity.publish_state activity_publish_state,
      pack.effective_from pack_effective_from,
      pack.effective_to pack_effective_to,
      pack.authored_by_uid pack_authored_by_uid,
      pack.reviewed_by_uid pack_reviewed_by_uid,
      pack.reviewed_at pack_reviewed_at,
      manual.requested_by_uid manual_requested_by_uid,
      manual.approved_by_uid manual_approved_by_uid,
      manual.approved_at manual_approved_at,
      policy.version evidence_policy_version,
      policy.official_source_sha256 evidence_policy_source_sha256,
      final_record.id final_record_id,
      final_record.instance_sha256 final_instance_sha256,
      final_record.prefill_sha256 final_prefill_sha256,
      final_record.response_sha256 final_response_sha256,
      final_record.signature_manifest_sha256 final_signature_manifest_sha256,
      final_record.pdf_sha256 final_pdf_sha256,
      final_record.integrity_receipt_id final_integrity_receipt_id,
      final_record.finalised_by_uid, final_record.finalised_at
    FROM compliance_activity_work_pack_instances instance
    JOIN compliance_cases compliance_case
      ON compliance_case.id = instance.compliance_case_id
      AND compliance_case.organisation_id = instance.organisation_id
    JOIN compliance_activity_work_pack_versions pack
      ON pack.id = instance.work_pack_version_id
      AND pack.organisation_id = instance.organisation_id
      AND pack.activity_template_id = ?
      AND pack.activity_version_id = compliance_case.activity_version_id
      AND pack.publish_state = 'published'
    JOIN compliance_activity_versions activity
      ON activity.id = compliance_case.activity_version_id
      AND activity.publish_state = 'published'
      AND activity.effective_from <= compliance_case.activity_date
      AND (activity.effective_to = ''
        OR activity.effective_to >= compliance_case.activity_date)
    JOIN compliance_manual_policy_bindings manual
      ON manual.id = pack.manual_policy_binding_id
      AND manual.organisation_id = pack.organisation_id
      AND manual.activity_version_id = compliance_case.activity_version_id
      AND manual.version = pack.manual_policy_binding_version
      AND manual.binding_snapshot_sha256 = pack.manual_policy_binding_sha256
      AND manual.lifecycle_state = 'approved'
      AND manual.approved_by_uid <> manual.requested_by_uid
    JOIN compliance_evidence_policy_versions policy
      ON policy.id = pack.evidence_policy_version_id
      AND policy.organisation_id = pack.organisation_id
      AND policy.activity_version_id = compliance_case.activity_version_id
      AND policy.version = pack.evidence_policy_version
      AND policy.official_source_sha256 = pack.evidence_policy_source_sha256
      AND policy.publish_state = 'published'
      AND policy.requirements_complete = 1
    JOIN compliance_activity_work_pack_final_records final_record
      ON final_record.organisation_id = instance.organisation_id
      AND final_record.case_instance_id = instance.id
      AND final_record.work_pack_version_id = instance.work_pack_version_id
      AND final_record.instance_sha256 = instance.response_sha256
    LEFT JOIN trade_work_orders work_order
      ON work_order.id = instance.work_order_id
      AND work_order.firebase_uid = compliance_case.installer_uid
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id
      AND job_detail.firebase_uid = work_order.firebase_uid
    LEFT JOIN trade_team_members assigned_member
      ON assigned_member.id = work_order.assignee_member_id
      AND assigned_member.owner_uid = work_order.firebase_uid
      AND assigned_member.status = 'active'
    WHERE instance.id = ? AND instance.organisation_id = ?
      AND instance.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM compliance_activity_work_pack_instances newer
        WHERE newer.organisation_id = instance.organisation_id
          AND newer.instance_key = instance.instance_key
          AND newer.revision > instance.revision
      )
    LIMIT 1`)
    .bind(activityTemplateIdValue, caseInstanceId, actor.organisationId)
    .first<OutputReadinessInstanceRecord>();
  if (!row) {
    const blockers = Object.freeze(Array.from(new Set([
      ...base.blockers,
      "completed_current_work_pack_response_required",
      "immutable_final_work_pack_record_required",
    ])).sort(compareText));
    return Object.freeze({
      ...base,
      certificateActionEnabled: false,
      certificateBlockers: base.outputClass === "tradable_certificate"
        ? blockers
        : base.certificateBlockers,
      outputActionReady: false,
      outputActionBlockers: base.outputClass === "tradable_certificate"
        ? base.outputActionBlockers
        : blockers,
    });
  }
  const resolved = await resolvePinnedCreditexActivityWorkPack(database, {
    organisationId: actor.organisationId,
    workPackVersionId: row.work_pack_version_id,
    activityVersionId: row.activity_version_id,
    activityDate: row.activity_date,
  });
  const envelope = validateInstanceEnvelope(row, resolved, {
    allowStaleExecutionContext: true,
  });
  const dependencies = await resolveServerDependencies(
    database,
    row,
    resolved.workPack,
    envelope.response.dependencyResolutions,
  );
  const allDependenciesReady = resolved.workPack.dependencies.every((dependency) => {
    const resolution = dependencies.resolutions[dependency.dependencyKey];
    return dependency.required
      ? resolution?.status === "resolved"
      : resolution?.status === "resolved" || resolution?.status === "not_applicable";
  });
  const productDependencies = resolved.workPack.dependencies.filter((dependency) =>
    dependency.kind === "product"
  );
  const scenarioDependencies = resolved.workPack.dependencies.filter((dependency) =>
    dependency.kind === "scenario"
  );
  const productResolutions = productDependencies.map((dependency) => ({
    dependencyKey: dependency.dependencyKey,
    registryCode: dependency.registryCode,
    productKind: dependency.productKind,
    ...dependencies.resolutions[dependency.dependencyKey],
  }));
  const scenarioResolutions = scenarioDependencies.map((dependency) => ({
    dependencyKey: dependency.dependencyKey,
    scenarioCodes: dependency.scenarioCodes,
    ...dependencies.resolutions[dependency.dependencyKey],
  }));
  const productReady = productResolutions.every((resolution) =>
    resolution.status === "resolved" || resolution.status === "not_applicable"
  );
  const scenarioReady = scenarioResolutions.every((resolution) =>
    resolution.status === "resolved" || resolution.status === "not_applicable"
  );
  const productDigest = creditexCanonicalSha256({
    contract: "creditex-output-readiness-product-set/v1",
    caseInstanceId,
    resolutions: productResolutions,
  });
  const scenarioDigest = creditexCanonicalSha256({
    contract: "creditex-output-readiness-scenario-set/v1",
    caseInstanceId,
    resolutions: scenarioResolutions,
  });
  const selectedProductIds = productResolutions.flatMap((resolution) =>
    resolution.referenceIds || []
  );
  const selectedScenarioCodes = scenarioResolutions.flatMap((resolution) =>
    resolution.referenceIds || []
  );
  const activityVersion = Object.freeze({
    id: row.activity_version_id,
    effectiveFrom: row.activity_effective_from,
    effectiveTo: row.activity_effective_to || null,
  });
  const workPackVersion = Object.freeze({
    id: resolved.id,
    schemaSha256: resolved.schemaSha256,
    effectiveFrom: row.pack_effective_from,
    effectiveTo: row.pack_effective_to || null,
    authoredByUid: row.pack_authored_by_uid,
    reviewedByUid: row.pack_reviewed_by_uid,
    reviewedAt: row.pack_reviewed_at,
  });
  const manualPolicy = Object.freeze({
    id: resolved.manualPolicyBindingId,
    version: String(resolved.manualPolicyBindingVersion),
    sha256: normaliseSha256(
      resolved.manualPolicyBindingSha256,
      "WORK_PACK_OUTPUT_MANUAL_POLICY_INVALID",
      "Manual-policy SHA-256",
    ),
    requestedByUid: row.manual_requested_by_uid,
    approvedByUid: row.manual_approved_by_uid,
    approvedAt: row.manual_approved_at,
  });
  const evidencePolicy = Object.freeze({
    id: resolved.evidencePolicyVersionId,
    version: String(row.evidence_policy_version),
    sha256: normaliseSha256(
      row.evidence_policy_source_sha256,
      "WORK_PACK_OUTPUT_EVIDENCE_POLICY_INVALID",
      "Evidence-policy SHA-256",
    ),
  });
  const runtimeSourceBindings = Object.freeze(resolved.sourceBindings.map((binding) =>
    Object.freeze({
      id: binding.id,
      role: binding.sourceRole === "product"
        ? "product" as const
        : binding.sourceRole === "scenario"
          ? "scenario" as const
          : binding.sourceRole === "calculator"
            ? "calculator" as const
            : "requirement" as const,
      targetKey: binding.targetKey,
      artifactId: binding.sourceArtifactId,
      artifactSha256: normaliseSha256(
        binding.sourceArtifactSha256,
        "WORK_PACK_OUTPUT_SOURCE_INVALID",
        "Output source SHA-256",
      ),
      createdByUid: binding.createdByUid,
      reviewedByUid: binding.reviewedByUid,
      reviewedAt: binding.reviewedAt,
    }))
  );
  const productSource = resolved.sourceBindings.find((binding) =>
    binding.sourceRole === "product"
  ) || resolved.sourceBindings.find((binding) =>
    binding.sourceRole === "requirement"
  );
  const scenarioSource = resolved.sourceBindings.find((binding) =>
    binding.sourceRole === "scenario"
  ) || resolved.sourceBindings.find((binding) =>
    binding.sourceRole === "requirement"
  );
  const productRegistrySnapshot = productReady
    && productSource
    ? Object.freeze({
        selectionId: selectedProductIds.join("|") || "not_applicable",
        snapshotId: productDigest,
        resolutionSha256: productDigest,
        registryCode: productDependencies.map((dependency) => dependency.registryCode)
          .join("|") || "not_applicable",
        productId: selectedProductIds.join("|") || "not_applicable",
        productKind: productDependencies.map((dependency) => dependency.productKind)
          .join("|") || "not_applicable",
        sourceSha256: normaliseSha256(
          productSource.sourceArtifactSha256,
          "WORK_PACK_OUTPUT_PRODUCT_SOURCE_INVALID",
          "Product source SHA-256",
        ),
        effectiveFrom: resolved.effectiveFrom,
        effectiveTo: resolved.effectiveTo || null,
        installationDate: row.activity_date,
        selectedByUid: row.created_by_uid,
        verifiedByUid: resolved.reviewedByUid,
        verifiedAt: resolved.reviewedAt,
      })
    : null;
  const scenarioRules = scenarioReady && scenarioSource
    ? Object.freeze({
        resolutionId: scenarioDigest,
        resolutionSha256: scenarioDigest,
        scenarioBindingId: scenarioSource.id,
        scenarioCode: selectedScenarioCodes.join("|") || "not_applicable",
        sourceArtifactId: scenarioSource.sourceArtifactId,
        sourceSha256: normaliseSha256(
          scenarioSource.sourceArtifactSha256,
          "WORK_PACK_OUTPUT_SCENARIO_SOURCE_INVALID",
          "Scenario source SHA-256",
        ),
        effectiveFrom: resolved.effectiveFrom,
        effectiveTo: resolved.effectiveTo || null,
        authoredByUid: row.created_by_uid,
        reviewedByUid: resolved.reviewedByUid,
        reviewedAt: resolved.reviewedAt,
      })
    : null;
  let authoritativeCalculator: CreditexWorkPackGovernanceCoverageRow[
    "activationEvidence"
  ]["authoritativeCalculator"] = null;
  if (dependencies.calculatorOutputs.length === 1) {
    const output = dependencies.calculatorOutputs[0];
    const calculatorSourceSha256 = normaliseSha256(
      output.calculatorSourceSha256,
      "WORK_PACK_OUTPUT_CALCULATOR_INVALID",
      "Calculator source SHA-256",
    );
    const calculatorSourceBinding = runtimeSourceBindings.find((binding) =>
      binding.role === "calculator"
        && binding.targetKey === output.dependencyKey
        && binding.artifactSha256 === calculatorSourceSha256
        && binding.createdByUid !== binding.reviewedByUid
        && Boolean(binding.reviewedAt)
    );
    const calculation = await database.prepare(`SELECT calculation.id,
        calculation.input_snapshot, calculation.output_snapshot,
        calculation.run_by_uid, calculation.calculator_version_id,
        calculator.specification calculator_specification,
        review.input_sha256 review_input_sha256,
        review.output_sha256 review_output_sha256
      FROM compliance_calculation_runs calculation
      JOIN compliance_calculator_versions calculator
        ON calculator.id = calculation.calculator_version_id
        AND calculator.organisation_id = calculation.organisation_id
      JOIN compliance_activity_work_pack_calculation_reviews review
        ON review.organisation_id = calculation.organisation_id
        AND review.calculation_run_id = calculation.id
        AND review.decision = 'approved'
        AND review.reviewer_uid <> calculation.run_by_uid
      WHERE calculation.organisation_id = ? AND calculation.case_id = ?
        AND calculation.id = ? LIMIT 1`)
      .bind(actor.organisationId, row.compliance_case_id, output.calculationRunId)
      .first<OutputReadinessCalculationIdentity>();
    if (calculation && calculatorSourceBinding) {
      authoritativeCalculator = Object.freeze({
        runId: output.calculationRunId,
        dependencyKey: output.dependencyKey,
        catalogueFormulaKey: output.catalogueFormulaKey,
        engineCalculatorKey: output.calculatorKey,
        engineCalculatorVersion: output.calculatorVersion,
        specificationId: output.calculatorVersionId,
        specificationVersion: String(output.calculatorVersion),
        specificationSha256: creditexCanonicalSha256(
          parseObject(calculation.calculator_specification,
            "WORK_PACK_OUTPUT_CALCULATOR_INVALID", "Calculator specification"),
        ),
        inputSha256: normaliseSha256(calculation.review_input_sha256,
          "WORK_PACK_OUTPUT_CALCULATOR_INVALID", "Calculation input SHA-256"),
        outputSha256: normaliseSha256(calculation.review_output_sha256,
          "WORK_PACK_OUTPUT_CALCULATOR_INVALID", "Calculation output SHA-256"),
        engineContractSha256: normaliseSha256(output.engineContractSha256,
          "WORK_PACK_OUTPUT_CALCULATOR_INVALID", "Calculator engine SHA-256"),
        receiptSha256: normaliseSha256(output.executionReceiptSha256,
          "WORK_PACK_OUTPUT_CALCULATOR_INVALID", "Calculation receipt SHA-256"),
        sourceBindingId: calculatorSourceBinding.id,
        sourceArtifactId: calculatorSourceBinding.artifactId,
        sourceSha256: calculatorSourceSha256,
        effectiveFrom: resolved.effectiveFrom,
        effectiveTo: resolved.effectiveTo || null,
        runByUid: calculation.run_by_uid,
        verifiedByUid: output.verifiedByUid,
        verifiedAt: output.verifiedAt,
        certificateQuantity: output.quantity,
        certificateUnit: output.unit,
      });
    }
  }
  const fieldCollection = Object.freeze({
    instanceId: row.id,
    instanceKey: row.instance_key,
    revision: Number(row.revision),
    definitionSha256: resolved.schemaSha256,
    prefillSha256: normaliseSha256(row.final_prefill_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Final prefill SHA-256"),
    responseSha256: normaliseSha256(row.final_response_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Final response SHA-256"),
    completedByUid: row.finalised_by_uid,
    completedAt: row.finalised_at,
  });
  const completion = Object.freeze({
    caseInstanceId: row.id,
    finalRecordId: row.final_record_id,
    instanceSha256: normaliseSha256(row.final_instance_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Final instance SHA-256"),
    responseSha256: normaliseSha256(row.final_response_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Final response SHA-256"),
    signatureManifestSha256: normaliseSha256(row.final_signature_manifest_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Signature manifest SHA-256"),
    pdfSha256: normaliseSha256(row.final_pdf_sha256,
      "WORK_PACK_OUTPUT_FINAL_RECORD_INVALID", "Final PDF SHA-256"),
    integrityReceiptId: row.final_integrity_receipt_id,
    finalisedByUid: row.finalised_by_uid,
    finalisedAt: row.finalised_at,
  });
  const sresActivationState = base.programCode === "SRES"
    && base.outputClass === "tradable_certificate"
    ? await loadCreditexSresActivationState(database, actor, {
        activityTemplateId: activityTemplateIdValue,
        caseId: row.compliance_case_id,
      })
    : null;
  const programActivationEvidence = sresActivationState?.snapshot || null;
  const governedProgram = GOVERNMENT_PROGRAM_TEMPLATES.find((candidate) =>
    candidate.programCode === base.programCode
      && candidate.outcomeClass === base.outputClass
  );
  const operationalSourceTarget = governedProgram
    && governedProgram.outcomeClass !== "tradable_certificate"
    ? `output:${governedProgram.claimOutputCode}`
    : "";
  const operationalSource = base.outputClass === "tradable_certificate"
    ? null
    : runtimeSourceBindings.find((binding) =>
        binding.role === "requirement"
          && binding.targetKey === operationalSourceTarget
      ) || null;
  const operationalOutputDefinition = governedProgram
    && governedProgram.outcomeClass !== "tradable_certificate"
    && operationalSource
    && operationalSource.createdByUid !== operationalSource.reviewedByUid
    ? Object.freeze({
        outputClass: governedProgram.outcomeClass,
        outputCode: governedProgram.claimOutputCode,
        sourceBindingId: operationalSource.id,
        sourceArtifactId: operationalSource.artifactId,
        sourceSha256: operationalSource.artifactSha256,
        effectiveFrom: resolved.effectiveFrom,
        effectiveTo: resolved.effectiveTo || null,
        authoredByUid: operationalSource.createdByUid,
        reviewedByUid: operationalSource.reviewedByUid,
        reviewedAt: operationalSource.reviewedAt,
      })
    : null;
  const coreReady = Boolean(
    row.activity_publish_state === "published"
    && activityVersion && workPackVersion
    && workPackVersion.authoredByUid !== workPackVersion.reviewedByUid
    && manualPolicy.requestedByUid !== manualPolicy.approvedByUid
    && runtimeSourceBindings.length
    && runtimeSourceBindings.every((binding) =>
      binding.createdByUid !== binding.reviewedByUid
        && Boolean(binding.reviewedAt)
    )
    && productRegistrySnapshot && scenarioRules
    && allDependenciesReady,
  );
  const programActivationReady = base.programCode !== "SRES"
    || Boolean(programActivationEvidence);
  const certificateReady = base.outputClass === "tradable_certificate"
    && coreReady && Boolean(authoritativeCalculator) && programActivationReady;
  const certificateBlockers = certificateReady
    ? []
    : Array.from(new Set([
        ...(!productRegistrySnapshot ? ["exact_product_registry_snapshot_required"] : []),
        ...(!scenarioRules ? ["exact_scenario_rule_resolution_required"] : []),
        ...(!authoritativeCalculator ? ["approved_verified_calculator_run_required"] : []),
        ...(sresActivationState?.blockers || []),
        ...(!programActivationReady
          && !sresActivationState?.blockers.length
          ? ["program_specific_certificate_activation_evidence_required"]
          : []),
        ...(!allDependenciesReady ? ["completed_current_work_pack_response_required"] : []),
      ])).sort(compareText);
  const operationalReady = base.outputClass !== "tradable_certificate"
    && coreReady && Boolean(operationalOutputDefinition);
  const outputActionBlockers = base.outputClass === "tradable_certificate"
    ? ["output_action_not_applicable_for_tradable_certificate"]
    : operationalReady
      ? []
      : Array.from(new Set([
          ...(!productRegistrySnapshot ? ["exact_product_registry_snapshot_required"] : []),
          ...(!scenarioRules ? ["exact_scenario_rule_resolution_required"] : []),
          ...(!allDependenciesReady ? ["completed_current_work_pack_response_required"] : []),
          ...(!operationalOutputDefinition
            ? ["approved_output_class_source_binding_required"]
            : []),
        ])).sort(compareText);
  return Object.freeze({
    ...base,
    ready: coreReady,
    versionId: workPackVersion.id,
    schemaSha256: workPackVersion.schemaSha256,
    blockers: Object.freeze(coreReady ? [] : [
      "case_specific_governed_activation_evidence_required",
    ]),
    currentActivityVersionReady: row.activity_publish_state === "published",
    independentlyApprovedPackReady:
      workPackVersion.authoredByUid !== workPackVersion.reviewedByUid,
    approvedExactSourcesReady: runtimeSourceBindings.length > 0,
    productRegistrySnapshotReady: Boolean(productRegistrySnapshot),
    scenarioRulesReady: Boolean(scenarioRules),
    authoritativeCalculatorReady: Boolean(authoritativeCalculator),
    fieldCollectionReady: true,
    completionReady: true,
    certificateActionEnabled: certificateReady,
    certificateBlockers: Object.freeze(certificateBlockers),
    outputActionReady: operationalReady,
    outputActionBlockers: Object.freeze(outputActionBlockers),
    operationalOutputDefinition,
    activationEvidence: Object.freeze({
      ...base.activationEvidence,
      activityVersion,
      workPackVersion,
      manualPolicy,
      evidencePolicy,
      sourceBindings: runtimeSourceBindings,
      productRegistrySnapshot,
      scenarioRules,
      authoritativeCalculator,
      fieldCollection,
      completion,
      programActivationEvidence,
      externalSubmission: null,
    }),
  });
}

export async function loadCreditexActivityWorkPackOutputReadiness(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  input: Readonly<{
    activityTemplateId: string;
    caseInstanceId: string;
  }>,
) {
  await governanceIdentity(database, actor);
  const governance = await listCreditexWorkPackGovernance(database, actor);
  return resolveCreditexActivityWorkPackOutputReadiness(
    database,
    actor,
    input,
    governance,
  );
}

export async function loadCreditexActivityWorkPackOutputReadinessBatch(
  database: D1Database,
  actor: CreditexWorkPackGovernanceActor,
  inputs: readonly Readonly<{
    activityTemplateId: string;
    caseInstanceId: string;
  }>[],
) {
  await governanceIdentity(database, actor);
  const governance = await listCreditexWorkPackGovernance(database, actor);
  const rows: Array<Readonly<{
    activityTemplateId: string;
    caseInstanceId: string;
    readiness: CreditexWorkPackGovernanceCoverageRow | null;
    errorCode: string;
    errorMessage: string;
  }>> = [];
  for (const input of inputs) {
    try {
      rows.push(Object.freeze({
        ...input,
        readiness: await resolveCreditexActivityWorkPackOutputReadiness(
          database,
          actor,
          input,
          governance,
        ),
        errorCode: "",
        errorMessage: "",
      }));
    } catch (error) {
      if (!(error instanceof CreditexActivityWorkPackServerError)) throw error;
      rows.push(Object.freeze({
        ...input,
        readiness: null,
        errorCode: error.code,
        errorMessage: error.message,
      }));
    }
  }
  return Object.freeze(rows);
}
