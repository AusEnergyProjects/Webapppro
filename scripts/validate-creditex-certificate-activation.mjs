import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CREDITEX_WORK_PACK_COVERAGE,
} from "../src/lib/creditex-work-pack-coverage.ts";
import {
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";

export const CREDITEX_CERTIFICATE_ACTIVATION_ENDPOINT =
  "/api/creditex/work-packs";
export const CREDITEX_CERTIFICATE_ACTIVATION_TOKEN_ENV =
  "CREDITEX_CERTIFICATE_ACTIVATION_BEARER_TOKEN";
export const CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT = 192;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL_PATTERN =
  /^(?:[1-9]\d*|(?:0|[1-9]\d*)\.\d*[1-9])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOKEN_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMON_READINESS_FIELDS = Object.freeze([
  "currentActivityVersionReady",
  "independentlyApprovedPackReady",
  "approvedExactSourcesReady",
  "productRegistrySnapshotReady",
  "scenarioRulesReady",
  "authoritativeCalculatorReady",
  "fieldCollectionReady",
  "completionReady",
]);
const REQUIRED_SOURCE_ROLES = Object.freeze([
  "requirement",
  "product",
  "scenario",
  "calculator",
]);

const expectedById = new Map(CREDITEX_WORK_PACK_COVERAGE.map((row) => [
  row.activityTemplateId,
  row,
]));
const expectedProgramByCode = new Map(GOVERNMENT_PROGRAM_TEMPLATES.map(
  (program) => [program.programCode, program],
));
if (
  CREDITEX_WORK_PACK_COVERAGE.length
    !== CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT
  || expectedById.size !== CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT
) {
  throw new Error(
    "Certificate activation gate configuration is invalid: the release catalogue must contain exactly 192 unique current or limited activity IDs.",
  );
}

export class CreditexCertificateActivationError extends Error {
  constructor(errors) {
    super([
      "Creditex certificate activation is blocked.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"));
    this.name = "CreditexCertificateActivationError";
    this.errors = Object.freeze([...errors]);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactIdentity(value) {
  return typeof value === "string" && value && value === value.trim()
    ? value
    : "";
}

function hasExactSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function dateValue(value) {
  const candidate = typeof value === "string" ? value : "";
  if (!DATE_PATTERN.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

function timestampValue(value) {
  const candidate = typeof value === "string" ? value : "";
  if (!TIMESTAMP_PATTERN.test(candidate)) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== candidate
    ? null
    : candidate;
}

function requireIdentity(errors, path, value) {
  if (!exactIdentity(value)) {
    errors.push(`${path} must contain an exact identity.`);
  }
}

function requireHash(errors, path, value) {
  if (!hasExactSha256(value)) {
    errors.push(`${path} must contain an exact SHA-256 identity.`);
  }
}

function requireVersionIdentity(errors, path, value) {
  if (!exactIdentity(value)) {
    errors.push(`${path} must contain an exact version identity.`);
  }
}

function requireTimestamp(errors, path, value) {
  if (!timestampValue(value)) {
    errors.push(`${path} must contain an exact timestamp.`);
  }
}

function requirePositiveDecimalIdentity(errors, path, value) {
  const candidate = typeof value === "string" ? value : "";
  if (!POSITIVE_DECIMAL_PATTERN.test(candidate)) {
    errors.push(`${path} must contain a positive decimal identity.`);
  }
}

function validateEffectivePeriod(errors, path, value, asAtDate) {
  if (!isRecord(value)) return;
  const effectiveFrom = dateValue(value.effectiveFrom);
  const effectiveToText = text(value.effectiveTo);
  const effectiveTo = effectiveToText ? dateValue(effectiveToText) : "";
  if (!effectiveFrom) {
    errors.push(`${path}.effectiveFrom must contain an exact date.`);
  }
  if (effectiveToText && !effectiveTo) {
    errors.push(`${path}.effectiveTo must be empty or contain an exact date.`);
  }
  if (effectiveFrom && effectiveFrom > asAtDate) {
    errors.push(`${path} is not effective on ${asAtDate}.`);
  }
  if (effectiveTo && effectiveTo < asAtDate) {
    errors.push(`${path} expired before ${asAtDate}.`);
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    errors.push(`${path} has an invalid effective date range.`);
  }
}

function requireIndependentActors(errors, path, author, reviewer) {
  requireIdentity(errors, `${path}.author`, author);
  requireIdentity(errors, `${path}.reviewer`, reviewer);
  if (text(author) && text(author) === text(reviewer)) {
    errors.push(`${path} must have independent author and reviewer actors.`);
  }
}

function validateProductRegistrySnapshot(
  errors,
  rowPath,
  value,
  asAtDate,
) {
  const pathPrefix = `${rowPath}.activationEvidence.productRegistrySnapshot`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return null;
  }
  for (const field of [
    "selectionId",
    "snapshotId",
    "registryCode",
    "productId",
    "productKind",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  requireHash(errors, `${pathPrefix}.sourceSha256`, value.sourceSha256);
  const installationDate = dateValue(value.installationDate);
  if (!installationDate) {
    errors.push(`${pathPrefix}.installationDate must contain an exact date.`);
  }
  validateEffectivePeriod(
    errors,
    pathPrefix,
    value,
    installationDate || asAtDate,
  );
  requireTimestamp(errors, `${pathPrefix}.verifiedAt`, value.verifiedAt);
  requireIndependentActors(
    errors,
    pathPrefix,
    value.selectedByUid,
    value.verifiedByUid,
  );
  return installationDate;
}

function validateScenarioRules(errors, rowPath, value, activityDate) {
  const pathPrefix = `${rowPath}.activationEvidence.scenarioRules`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return;
  }
  for (const field of [
    "resolutionId",
    "scenarioBindingId",
    "scenarioCode",
    "sourceArtifactId",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  requireHash(errors, `${pathPrefix}.sourceSha256`, value.sourceSha256);
  validateEffectivePeriod(errors, pathPrefix, value, activityDate);
  requireTimestamp(errors, `${pathPrefix}.reviewedAt`, value.reviewedAt);
  requireIndependentActors(
    errors,
    pathPrefix,
    value.authoredByUid,
    value.reviewedByUid,
  );
}

function validateAuthoritativeCalculator(
  errors,
  rowPath,
  value,
  activityDate,
  expectedCertificateUnit,
) {
  const pathPrefix = `${rowPath}.activationEvidence.authoritativeCalculator`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return;
  }
  for (const field of [
    "runId",
    "dependencyKey",
    "catalogueFormulaKey",
    "engineCalculatorKey",
    "specificationId",
    "specificationVersion",
    "sourceBindingId",
    "sourceArtifactId",
    "certificateUnit",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  if (
    !Number.isSafeInteger(value.engineCalculatorVersion)
    || value.engineCalculatorVersion < 1
  ) {
    errors.push(`${pathPrefix}.engineCalculatorVersion must be a positive integer.`);
  }
  for (const field of [
    "specificationSha256",
    "inputSha256",
    "outputSha256",
    "engineContractSha256",
    "receiptSha256",
    "sourceSha256",
  ]) {
    requireHash(errors, `${pathPrefix}.${field}`, value[field]);
  }
  validateEffectivePeriod(errors, pathPrefix, value, activityDate);
  requireTimestamp(errors, `${pathPrefix}.verifiedAt`, value.verifiedAt);
  requireIndependentActors(
    errors,
    pathPrefix,
    value.runByUid,
    value.verifiedByUid,
  );
  requirePositiveDecimalIdentity(
    errors,
    `${pathPrefix}.certificateQuantity`,
    value.certificateQuantity,
  );
  if (
    expectedCertificateUnit
    && value.certificateUnit !== expectedCertificateUnit
  ) {
    errors.push(
      `${pathPrefix}.certificateUnit does not match the programme output code.`,
    );
  }
}

function validateFieldCollection(errors, rowPath, value) {
  const pathPrefix = `${rowPath}.activationEvidence.fieldCollection`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return;
  }
  for (const field of ["instanceId", "instanceKey", "completedByUid"]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    errors.push(`${pathPrefix}.revision must be a positive integer.`);
  }
  for (const field of [
    "definitionSha256",
    "prefillSha256",
    "responseSha256",
  ]) {
    requireHash(errors, `${pathPrefix}.${field}`, value[field]);
  }
  requireTimestamp(errors, `${pathPrefix}.completedAt`, value.completedAt);
}

function validateCompletion(errors, rowPath, value) {
  const pathPrefix = `${rowPath}.activationEvidence.completion`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return;
  }
  for (const field of [
    "caseInstanceId",
    "finalRecordId",
    "integrityReceiptId",
    "finalisedByUid",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  for (const field of [
    "instanceSha256",
    "responseSha256",
    "signatureManifestSha256",
    "pdfSha256",
  ]) {
    requireHash(errors, `${pathPrefix}.${field}`, value[field]);
  }
  requireTimestamp(errors, `${pathPrefix}.finalisedAt`, value.finalisedAt);
}

function validateExternalSubmission(errors, rowPath, value) {
  const pathPrefix = `${rowPath}.activationEvidence.externalSubmission`;
  if (!isRecord(value)) {
    errors.push(`${pathPrefix} is required.`);
    return;
  }
  for (const field of [
    "submissionId",
    "submissionReference",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, value[field]);
  }
  if (value.status !== "accepted") {
    errors.push(`${pathPrefix}.status must be accepted.`);
  }
  for (const field of ["submittedPayloadSha256", "providerReceiptSha256"]) {
    requireHash(errors, `${pathPrefix}.${field}`, value[field]);
  }
  requireTimestamp(errors, `${pathPrefix}.submittedAt`, value.submittedAt);
  requireTimestamp(errors, `${pathPrefix}.verifiedAt`, value.verifiedAt);
  requireIndependentActors(
    errors,
    pathPrefix,
    value.submittedByUid,
    value.verifiedByUid,
  );
}

function validateActivationEvidence(
  errors,
  rowPath,
  row,
  asAtDate,
  expectedProgram,
) {
  const evidence = row.activationEvidence;
  if (!isRecord(evidence)) {
    errors.push(`${rowPath}.activationEvidence is required.`);
    return;
  }

  const activityVersion = evidence.activityVersion;
  if (!isRecord(activityVersion)) {
    errors.push(`${rowPath}.activationEvidence.activityVersion is required.`);
  } else {
    requireIdentity(
      errors,
      `${rowPath}.activationEvidence.activityVersion.id`,
      activityVersion.id,
    );
    validateEffectivePeriod(
      errors,
      `${rowPath}.activationEvidence.activityVersion`,
      activityVersion,
      asAtDate,
    );
    if (text(activityVersion.id) !== text(row.activityVersionId)) {
      errors.push(
        `${rowPath}.activityVersionId does not match its activation evidence.`,
      );
    }
  }

  const workPackVersion = evidence.workPackVersion;
  if (!isRecord(workPackVersion)) {
    errors.push(`${rowPath}.activationEvidence.workPackVersion is required.`);
  } else {
    requireIdentity(
      errors,
      `${rowPath}.activationEvidence.workPackVersion.id`,
      workPackVersion.id,
    );
    requireHash(
      errors,
      `${rowPath}.activationEvidence.workPackVersion.schemaSha256`,
      workPackVersion.schemaSha256,
    );
    validateEffectivePeriod(
      errors,
      `${rowPath}.activationEvidence.workPackVersion`,
      workPackVersion,
      asAtDate,
    );
    requireTimestamp(
      errors,
      `${rowPath}.activationEvidence.workPackVersion.reviewedAt`,
      workPackVersion.reviewedAt,
    );
    requireIndependentActors(
      errors,
      `${rowPath}.activationEvidence.workPackVersion`,
      workPackVersion.authoredByUid,
      workPackVersion.reviewedByUid,
    );
    if (text(workPackVersion.id) !== text(row.versionId)) {
      errors.push(`${rowPath}.versionId does not match its activation evidence.`);
    }
    if (text(workPackVersion.schemaSha256) !== text(row.schemaSha256)) {
      errors.push(
        `${rowPath}.schemaSha256 does not match its activation evidence.`,
      );
    }
  }

  const manualPolicy = evidence.manualPolicy;
  if (!isRecord(manualPolicy)) {
    errors.push(`${rowPath}.activationEvidence.manualPolicy is required.`);
  } else {
    requireIdentity(
      errors,
      `${rowPath}.activationEvidence.manualPolicy.id`,
      manualPolicy.id,
    );
    requireVersionIdentity(
      errors,
      `${rowPath}.activationEvidence.manualPolicy.version`,
      manualPolicy.version,
    );
    requireHash(
      errors,
      `${rowPath}.activationEvidence.manualPolicy.sha256`,
      manualPolicy.sha256,
    );
    requireTimestamp(
      errors,
      `${rowPath}.activationEvidence.manualPolicy.approvedAt`,
      manualPolicy.approvedAt,
    );
    requireIndependentActors(
      errors,
      `${rowPath}.activationEvidence.manualPolicy`,
      manualPolicy.requestedByUid,
      manualPolicy.approvedByUid,
    );
  }

  const evidencePolicy = evidence.evidencePolicy;
  if (!isRecord(evidencePolicy)) {
    errors.push(`${rowPath}.activationEvidence.evidencePolicy is required.`);
  } else {
    requireIdentity(
      errors,
      `${rowPath}.activationEvidence.evidencePolicy.id`,
      evidencePolicy.id,
    );
    requireVersionIdentity(
      errors,
      `${rowPath}.activationEvidence.evidencePolicy.version`,
      evidencePolicy.version,
    );
    requireHash(
      errors,
      `${rowPath}.activationEvidence.evidencePolicy.sha256`,
      evidencePolicy.sha256,
    );
  }

  if (!Array.isArray(evidence.sourceBindings) || !evidence.sourceBindings.length) {
    errors.push(
      `${rowPath}.activationEvidence.sourceBindings must contain exact retained source identities.`,
    );
    return;
  }

  const bindingIds = new Set();
  const bindingTargets = new Set();
  const bindingRoles = new Set();
  for (const [index, binding] of evidence.sourceBindings.entries()) {
    const bindingPath =
      `${rowPath}.activationEvidence.sourceBindings[${index}]`;
    if (!isRecord(binding)) {
      errors.push(`${bindingPath} must be an object.`);
      continue;
    }
    requireIdentity(errors, `${bindingPath}.id`, binding.id);
    requireIdentity(errors, `${bindingPath}.role`, binding.role);
    requireIdentity(errors, `${bindingPath}.targetKey`, binding.targetKey);
    requireIdentity(errors, `${bindingPath}.artifactId`, binding.artifactId);
    requireHash(errors, `${bindingPath}.artifactSha256`, binding.artifactSha256);
    requireTimestamp(errors, `${bindingPath}.reviewedAt`, binding.reviewedAt);
    requireIndependentActors(
      errors,
      bindingPath,
      binding.createdByUid,
      binding.reviewedByUid,
    );

    const bindingId = text(binding.id);
    if (bindingId && bindingIds.has(bindingId)) {
      errors.push(`${rowPath} contains duplicate source binding ${bindingId}.`);
    }
    bindingIds.add(bindingId);
    const bindingTarget = `${text(binding.role)}:${text(binding.targetKey)}`;
    if (bindingTarget !== ":" && bindingTargets.has(bindingTarget)) {
      errors.push(
        `${rowPath} contains duplicate source target ${bindingTarget}.`,
      );
    }
    bindingTargets.add(bindingTarget);
    bindingRoles.add(text(binding.role));
  }
  for (const role of REQUIRED_SOURCE_ROLES) {
    if (!bindingRoles.has(role)) {
      errors.push(`${rowPath} is missing an approved ${role} source binding.`);
    }
  }

  const installationDate = validateProductRegistrySnapshot(
    errors,
    rowPath,
    evidence.productRegistrySnapshot,
    asAtDate,
  );
  const activityDate = installationDate || asAtDate;
  validateScenarioRules(
    errors,
    rowPath,
    evidence.scenarioRules,
    activityDate,
  );
  validateAuthoritativeCalculator(
    errors,
    rowPath,
    evidence.authoritativeCalculator,
    activityDate,
    expectedProgram?.outcomeClass === "tradable_certificate"
      ? expectedProgram.claimOutputCode
      : "",
  );
  validateFieldCollection(errors, rowPath, evidence.fieldCollection);
  validateCompletion(errors, rowPath, evidence.completion);
  if (expectedProgram?.outcomeClass === "tradable_certificate") {
    validateExternalSubmission(
      errors,
      rowPath,
      evidence.externalSubmission,
    );
  } else if (evidence.externalSubmission !== null) {
    errors.push(
      `${rowPath}.activationEvidence.externalSubmission must be null for non-certificate output classes.`,
    );
  }

  if (
    isRecord(evidence.fieldCollection)
    && isRecord(evidence.completion)
    && text(evidence.fieldCollection.responseSha256)
      !== text(evidence.completion.responseSha256)
  ) {
    errors.push(
      `${rowPath} field collection and completion response identities differ.`,
    );
  }

  if (installationDate) {
    validateEffectivePeriod(
      errors,
      `${rowPath}.activationEvidence.activityVersion`,
      evidence.activityVersion,
      installationDate,
    );
    validateEffectivePeriod(
      errors,
      `${rowPath}.activationEvidence.workPackVersion`,
      evidence.workPackVersion,
      installationDate,
    );
  }
}

function validateOperationalOutputDefinition(
  errors,
  rowPath,
  row,
  expectedProgram,
  activityDate,
) {
  const definition = row.operationalOutputDefinition;
  const pathPrefix = `${rowPath}.operationalOutputDefinition`;
  if (!isRecord(definition)) {
    errors.push(
      `${pathPrefix} is required for non-certificate output classes.`,
    );
    return;
  }
  for (const field of [
    "outputCode",
    "sourceBindingId",
    "sourceArtifactId",
  ]) {
    requireIdentity(errors, `${pathPrefix}.${field}`, definition[field]);
  }
  requireHash(errors, `${pathPrefix}.sourceSha256`, definition.sourceSha256);
  validateEffectivePeriod(errors, pathPrefix, definition, activityDate);
  requireTimestamp(errors, `${pathPrefix}.reviewedAt`, definition.reviewedAt);
  requireIndependentActors(
    errors,
    pathPrefix,
    definition.authoredByUid,
    definition.reviewedByUid,
  );
  if (definition.outputClass !== expectedProgram?.outcomeClass) {
    errors.push(`${pathPrefix}.outputClass does not match the programme.`);
  }
  if (definition.outputCode !== expectedProgram?.claimOutputCode) {
    errors.push(`${pathPrefix}.outputCode does not match the programme.`);
  }
  const activationEvidence = isRecord(row.activationEvidence)
    ? row.activationEvidence
    : {};
  const bindings = Array.isArray(activationEvidence.sourceBindings)
    ? activationEvidence.sourceBindings
    : [];
  if (!bindings.some((binding) =>
    isRecord(binding)
      && text(binding.id) === text(definition.sourceBindingId)
      && text(binding.artifactId) === text(definition.sourceArtifactId)
      && text(binding.artifactSha256) === text(definition.sourceSha256)
      && text(binding.createdByUid) === text(definition.authoredByUid)
      && text(binding.reviewedByUid) === text(definition.reviewedByUid)
      && text(binding.reviewedAt) === text(definition.reviewedAt)
  )) {
    errors.push(`${pathPrefix} is not bound to an exact approved source.`);
  }
}

function validateCoverageRow(errors, row, index, asAtDate) {
  const rowPath = `coverage[${index}]`;
  if (!isRecord(row)) {
    errors.push(`${rowPath} must be an object.`);
    return;
  }
  const activityTemplateId = exactIdentity(row.activityTemplateId);
  const expected = expectedById.get(activityTemplateId);
  if (!activityTemplateId) {
    errors.push(`${rowPath}.activityTemplateId is required.`);
  } else if (!expected) {
    errors.push(`${rowPath} contains unexpected activity ${activityTemplateId}.`);
  } else {
    for (const [field, expectedValue] of [
      ["programCode", expected.programCode],
      ["activityCode", expected.activityKey],
      ["title", expected.title],
      ["catalogueState", expected.catalogueState],
    ]) {
      if (row[field] !== expectedValue) {
        errors.push(
          `${rowPath}.${field} does not match catalogue activity ${activityTemplateId}.`,
        );
      }
    }
  }
  const expectedProgram = expected
    ? expectedProgramByCode.get(expected.programCode)
    : null;
  if (!expectedProgram) {
    errors.push(`${rowPath} has no authoritative programme identity.`);
  } else if (row.outputClass !== expectedProgram.outcomeClass) {
    errors.push(`${rowPath}.outputClass does not match the programme.`);
  }

  requireIdentity(errors, `${rowPath}.activityVersionId`, row.activityVersionId);
  requireIdentity(errors, `${rowPath}.versionId`, row.versionId);
  requireHash(errors, `${rowPath}.schemaSha256`, row.schemaSha256);
  if (row.ready !== true) errors.push(`${rowPath}.ready must be true.`);
  if (!Array.isArray(row.blockers) || row.blockers.length !== 0) {
    errors.push(`${rowPath}.blockers must be an empty array.`);
  }
  for (const field of COMMON_READINESS_FIELDS) {
    if (row[field] !== true) errors.push(`${rowPath}.${field} must be true.`);
  }
  validateActivationEvidence(
    errors,
    rowPath,
    row,
    asAtDate,
    expectedProgram,
  );

  const certificateOutput = expectedProgram?.outcomeClass
    === "tradable_certificate";
  if (certificateOutput) {
    if (row.externalSubmissionReady !== true) {
      errors.push(`${rowPath}.externalSubmissionReady must be true.`);
    }
    if (row.certificateActionEnabled !== true) {
      errors.push(`${rowPath}.certificateActionEnabled must be true.`);
    }
    if (!Array.isArray(row.certificateBlockers)
      || row.certificateBlockers.length !== 0) {
      errors.push(`${rowPath}.certificateBlockers must be an empty array.`);
    }
    if (row.outputActionReady !== false) {
      errors.push(`${rowPath}.outputActionReady must be false.`);
    }
    if (row.operationalOutputDefinition !== null) {
      errors.push(`${rowPath}.operationalOutputDefinition must be null.`);
    }
    if (
      !Array.isArray(row.outputActionBlockers)
      || row.outputActionBlockers.length !== 1
      || row.outputActionBlockers[0]
        !== "output_action_not_applicable_for_tradable_certificate"
    ) {
      errors.push(
        `${rowPath}.outputActionBlockers must contain only the tradable-certificate not-applicable reason.`,
      );
    }
  } else if (expectedProgram) {
    if (row.externalSubmissionReady !== false) {
      errors.push(`${rowPath}.externalSubmissionReady must be false.`);
    }
    if (row.certificateActionEnabled !== false) {
      errors.push(`${rowPath}.certificateActionEnabled must be false.`);
    }
    if (
      !Array.isArray(row.certificateBlockers)
      || row.certificateBlockers.length !== 1
      || row.certificateBlockers[0]
        !== "certificate_action_not_applicable_for_output_class"
    ) {
      errors.push(
        `${rowPath}.certificateBlockers must contain only the non-certificate not-applicable reason.`,
      );
    }
    if (row.outputActionReady !== true) {
      errors.push(`${rowPath}.outputActionReady must be true.`);
    }
    if (!Array.isArray(row.outputActionBlockers)
      || row.outputActionBlockers.length !== 0) {
      errors.push(`${rowPath}.outputActionBlockers must be an empty array.`);
    }
    const installationDate = isRecord(row.activationEvidence)
      && isRecord(row.activationEvidence.productRegistrySnapshot)
      ? dateValue(row.activationEvidence.productRegistrySnapshot.installationDate)
      : null;
    validateOperationalOutputDefinition(
      errors,
      rowPath,
      row,
      expectedProgram,
      installationDate || asAtDate,
    );
  }
}

export function validateCreditexCertificateActivationPayload(
  payload,
  { asAtDate = new Date().toISOString().slice(0, 10) } = {},
) {
  const errors = [];
  if (!dateValue(asAtDate)) {
    throw new TypeError("asAtDate must be an exact YYYY-MM-DD date.");
  }
  if (!isRecord(payload) || payload.ok !== true) {
    throw new CreditexCertificateActivationError([
      "The candidate endpoint did not return an authenticated ok response.",
    ]);
  }
  if (!Array.isArray(payload.coverage)) {
    throw new CreditexCertificateActivationError([
      "The candidate endpoint did not return a coverage array.",
    ]);
  }
  if (
    payload.coverage.length
    !== CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT
  ) {
    errors.push(
      `Coverage must contain exactly ${CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT} rows; received ${payload.coverage.length}.`,
    );
  }

  const counts = new Map();
  for (const row of payload.coverage) {
    const id = isRecord(row) ? text(row.activityTemplateId) : "";
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const expectedId of expectedById.keys()) {
    if (!counts.has(expectedId)) {
      errors.push(`Coverage is missing activity ${expectedId}.`);
    }
  }
  for (const [id, count] of counts) {
    if (count > 1) errors.push(`Coverage contains duplicate activity ${id}.`);
  }
  for (const [index, row] of payload.coverage.entries()) {
    validateCoverageRow(errors, row, index, asAtDate);
  }
  if (errors.length) throw new CreditexCertificateActivationError(errors);

  return Object.freeze({
    activityCount: CREDITEX_CERTIFICATE_ACTIVATION_ACTIVITY_COUNT,
    asAtDate,
  });
}

export function parseCreditexCertificateActivationArguments(
  argv,
  environment = process.env,
) {
  let baseUrl = "";
  let tokenEnvironmentName = CREDITEX_CERTIFICATE_ACTIVATION_TOKEN_ENV;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url") {
      baseUrl = argv[index + 1] || "";
      index += 1;
    } else if (argument === "--token-env") {
      tokenEnvironmentName = argv[index + 1] || "";
      index += 1;
    } else {
      throw new Error(`Unknown certificate activation argument: ${argument}`);
    }
  }
  if (!baseUrl) {
    throw new Error(
      "Provide the explicit deployed candidate URL with --base-url https://candidate.example.",
    );
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("The deployed candidate base URL is invalid.");
  }
  if (
    parsedBaseUrl.protocol !== "https:"
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || parsedBaseUrl.search
    || parsedBaseUrl.hash
    || parsedBaseUrl.pathname !== "/"
  ) {
    throw new Error(
      "The deployed candidate base URL must be an explicit HTTPS origin without credentials, query parameters or a fragment.",
    );
  }
  if (!TOKEN_ENV_PATTERN.test(tokenEnvironmentName)) {
    throw new Error("The bearer-token environment variable name is invalid.");
  }
  const bearerToken = text(environment[tokenEnvironmentName]);
  if (!bearerToken) {
    throw new Error(
      `Set ${tokenEnvironmentName} to an authorised Creditex bearer token.`,
    );
  }
  return Object.freeze({
    baseUrl: parsedBaseUrl.origin,
    bearerToken,
    tokenEnvironmentName,
  });
}

export async function fetchCreditexCertificateActivationPayload({
  baseUrl,
  bearerToken,
  fetchImplementation = fetch,
}) {
  const endpoint = new URL(
    CREDITEX_CERTIFICATE_ACTIVATION_ENDPOINT,
    baseUrl,
  );
  const response = await fetchImplementation(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Candidate coverage request failed with HTTP ${response.status}.`,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Candidate coverage response was not JSON.");
  }
  return response.json();
}

export async function runCreditexCertificateActivationGate(
  argv = process.argv.slice(2),
  environment = process.env,
) {
  const configuration = parseCreditexCertificateActivationArguments(
    argv,
    environment,
  );
  const payload = await fetchCreditexCertificateActivationPayload(
    configuration,
  );
  const result = validateCreditexCertificateActivationPayload(payload);
  process.stdout.write(
    `Creditex certificate activation gate passed for ${result.activityCount} current or limited activities on ${configuration.baseUrl}.\n`,
  );
  return result;
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (
  executedPath
  && path.normalize(fileURLToPath(import.meta.url)).toLowerCase()
    === path.normalize(executedPath).toLowerCase()
) {
  runCreditexCertificateActivationGate().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
