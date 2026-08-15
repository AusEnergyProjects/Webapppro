import {
  creditexCanonicalSha256,
} from "./creditex-interchange-preflight.ts";
import {
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  type CreditexOfficialProductKind,
} from "./creditex-official-product-registry.ts";

export const CREDITEX_ACTIVITY_WORK_PACK_CONTRACT =
  "creditex-activity-work-pack/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT =
  "creditex-activity-work-pack-response/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT =
  "creditex-activity-work-pack-customer-context/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT =
  "creditex-activity-work-pack-reference-document-acknowledgement/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_VERSION_IDENTITY_CONTRACT =
  "creditex-activity-work-pack-version-identity/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT =
  "creditex-activity-work-pack-signature-payload/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT =
  "creditex-activity-work-pack-signer-identity/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT =
  "creditex-activity-work-pack-signature-attestation/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT =
  "creditex-activity-work-pack-device-attestation/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_FINAL_RECORD_CONTRACT =
  "creditex-activity-work-pack-final-record/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_MANIFEST_CONTRACT =
  "creditex-activity-work-pack-signature-manifest/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_CONTRACT =
  "creditex-activity-work-pack-pdf-renderer/v1";
export const CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION = "1.0.0";

export const CREDITEX_WORK_PACK_PROMPT_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "photo",
  "document",
  "reference_document",
  "signature",
] as const;

export const CREDITEX_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_MODES = [
  "none",
  "viewed",
  "confirmed",
] as const;

export const CREDITEX_WORK_PACK_SIGNER_IDENTITY_SOURCES = [
  "customer_context",
  "assigned_worker",
  "authenticated_actor",
  "manual_verified",
] as const;

export const CREDITEX_WORK_PACK_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "contains",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "answered",
  "not_answered",
] as const;

export const CREDITEX_WORK_PACK_DEPENDENCY_KINDS = [
  "product",
  "scenario",
  "calculator",
] as const;

export const CREDITEX_WORK_PACK_DOCUMENT_PLACEMENT_KINDS = [
  "text",
  "signature",
] as const;

export const CREDITEX_WORK_PACK_DOCUMENT_OVERFLOW_MODES = [
  "shrink",
  "wrap",
  "clip",
] as const;

export const CREDITEX_WORK_PACK_DOCUMENT_TEXT_FORMATS = [
  "text",
  "date_au",
  "boolean_mark",
] as const;

export const CREDITEX_WORK_PACK_DOCUMENT_SOURCE_PATH_PREFIXES = [
  "/prefill/",
  "/response/answers/",
  "/response/repeatableSections/",
  "/declarations/",
  "/signatures/",
] as const;

export type CreditexWorkPackPromptType =
  typeof CREDITEX_WORK_PACK_PROMPT_TYPES[number];
export type CreditexWorkPackConditionOperator =
  typeof CREDITEX_WORK_PACK_CONDITION_OPERATORS[number];
export type CreditexWorkPackDependencyKind =
  typeof CREDITEX_WORK_PACK_DEPENDENCY_KINDS[number];
export type CreditexWorkPackReferenceDocumentAcknowledgementMode =
  typeof CREDITEX_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_MODES[number];
export type CreditexWorkPackSignerIdentitySource =
  typeof CREDITEX_WORK_PACK_SIGNER_IDENTITY_SOURCES[number];
export type CreditexWorkPackDocumentPlacementKind =
  typeof CREDITEX_WORK_PACK_DOCUMENT_PLACEMENT_KINDS[number];
export type CreditexWorkPackConditionValue = string | number | boolean;

export type CreditexWorkPackCondition = Readonly<{
  promptKey: string;
  scope: "work_pack" | "section_instance";
  operator: CreditexWorkPackConditionOperator;
  value: CreditexWorkPackConditionValue
    | readonly CreditexWorkPackConditionValue[]
    | null;
}>;

export type CreditexWorkPackVisibility = Readonly<{
  match: "all" | "any";
  conditions: readonly CreditexWorkPackCondition[];
}>;

export type CreditexWorkPackOption = Readonly<{
  value: string;
  label: string;
}>;

export type CreditexWorkPackFileRequirement = Readonly<{
  minimumCount: number;
  maximumCount: number;
  allowedContentTypes: readonly string[];
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  captureTimeRequired: boolean;
}>;

export type CreditexWorkPackStage = Readonly<{
  stageKey: string;
  order: number;
  label: string;
  description: string;
}>;

export type CreditexWorkPackAttestation = Readonly<{
  text: string;
  version: string;
  sourceBindingTargetKey: string;
}>;

export type CreditexWorkPackReferenceDocument = Readonly<{
  sourceBindingTargetKey: string;
  acknowledgementMode: CreditexWorkPackReferenceDocumentAcknowledgementMode;
  acknowledgementText: string;
  acknowledgementVersion: string;
}>;

export type CreditexWorkPackSignerIdentityRequirement = Readonly<{
  fieldKey: string;
  label: string;
  required: boolean;
}>;

export type CreditexWorkPackSignerRole = Readonly<{
  roleKey: string;
  label: string;
  capacity: string;
  identitySource: CreditexWorkPackSignerIdentitySource;
  minimumSignatures: number;
  maximumSignatures: number;
  identityRequirements: readonly CreditexWorkPackSignerIdentityRequirement[];
}>;

export type CreditexWorkPackDocumentPlacement = Readonly<{
  placementKey: string;
  kind: CreditexWorkPackDocumentPlacementKind;
  sourcePath: string;
  signaturePromptKey: string;
  signerRoleKey: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: "helvetica" | "helvetica_bold";
  fontSize: number;
  minimumFontSize: number;
  overflow: "shrink" | "wrap" | "clip";
  maximumLines: number;
  textFormat: "text" | "date_au" | "boolean_mark";
}>;

export type CreditexWorkPackDocumentOutput = Readonly<{
  outputKey: string;
  title: string;
  sourceBindingTargetKey: string;
  rendererVersion: string;
  required: boolean;
  placements: readonly CreditexWorkPackDocumentPlacement[];
}>;

export type CreditexWorkPackProductDependency = Readonly<{
  dependencyKey: string;
  kind: "product";
  label: string;
  required: boolean;
  registryCode: string;
  productKind: CreditexOfficialProductKind | "not_applicable";
  productCategory: string;
  selectionMode: "single" | "multiple";
  minimumCount: number;
  maximumCount: number;
}>;

export type CreditexWorkPackScenarioDependency = Readonly<{
  dependencyKey: string;
  kind: "scenario";
  label: string;
  required: boolean;
  scenarioCodes: readonly string[];
  selectionMode: "single" | "multiple";
}>;

export type CreditexWorkPackCalculatorDependency = Readonly<{
  dependencyKey: string;
  kind: "calculator";
  label: string;
  required: boolean;
  catalogueFormulaKey: string;
  calculatorKey: string;
  calculatorVersion: number;
  requiredInputKeys: readonly string[];
}>;

export type CreditexWorkPackDependency =
  | CreditexWorkPackProductDependency
  | CreditexWorkPackScenarioDependency
  | CreditexWorkPackCalculatorDependency;

export type CreditexWorkPackPrompt = Readonly<{
  promptKey: string;
  order: number;
  type: CreditexWorkPackPromptType;
  label: string;
  instructions: string;
  required: boolean;
  visibility: CreditexWorkPackVisibility | null;
  dependencyKeys: readonly string[];
  requirementKeys: readonly string[];
  stageKey: string;
  options: readonly CreditexWorkPackOption[];
  signerRoleKey: string;
  attestation: CreditexWorkPackAttestation | null;
  minimumLength: number | null;
  maximumLength: number | null;
  minimumNumber: number | null;
  maximumNumber: number | null;
  numberStep: number | null;
  unit: string;
  minimumSelections: number | null;
  maximumSelections: number | null;
  fileRequirement: CreditexWorkPackFileRequirement | null;
  referenceDocument: CreditexWorkPackReferenceDocument | null;
}>;

export type CreditexWorkPackRepeatability = Readonly<{
  itemKey: string;
  itemLabel: string;
  minimumInstances: number;
  maximumInstances: number;
}>;

export type CreditexWorkPackSection = Readonly<{
  sectionKey: string;
  order: number;
  title: string;
  description: string;
  visibility: CreditexWorkPackVisibility | null;
  repeatability: CreditexWorkPackRepeatability | null;
  prompts: readonly CreditexWorkPackPrompt[];
}>;

export type CreditexActivityWorkPack = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_CONTRACT;
  activityTemplateId: string;
  version: number;
  title: string;
  effectiveFrom: string;
  effectiveTo: string;
  catalogueReviewedOn: string;
  stages: readonly CreditexWorkPackStage[];
  signerRoles: readonly CreditexWorkPackSignerRole[];
  dependencies: readonly CreditexWorkPackDependency[];
  sections: readonly CreditexWorkPackSection[];
  documentOutputs: readonly CreditexWorkPackDocumentOutput[];
}>;

export type CreditexWorkPackDependencyResolution = Readonly<{
  status: "resolved" | "blocked" | "not_applicable";
  referenceIds: readonly string[];
  snapshotSha256: string;
}>;

export type CreditexActivityWorkPackResponse = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT;
  schemaSha256: string;
  answers: Readonly<Record<string, unknown>>;
  repeatableSections: Readonly<Record<
    string,
    readonly Readonly<{
      instanceKey: string;
      answers: Readonly<Record<string, unknown>>;
    }>[]
  >>;
  dependencyResolutions: Readonly<
    Record<string, CreditexWorkPackDependencyResolution>
  >;
}>;

export type CreditexActivityWorkPackCustomerContext = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_CUSTOMER_CONTEXT_CONTRACT;
  editable: boolean;
  customerId: string;
  siteId: string;
  contactId: string;
  customerRevision: string;
  siteRevision: string;
  contactRevision: string;
  contextSha256: string;
}>;

export type CreditexActivityWorkPackReferenceDocumentAcknowledgement = Readonly<{
  contract:
    typeof CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT;
  sourceBindingTargetKey: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  acknowledgementMode: Exclude<
    CreditexWorkPackReferenceDocumentAcknowledgementMode,
    "none"
  >;
  acknowledged: true;
  acknowledgedAt: string;
}>;

export type CreditexActivityWorkPackCompletion = Readonly<{
  ready: boolean;
  visiblePromptKeys: readonly string[];
  requiredPromptKeys: readonly string[];
  completedPromptKeys: readonly string[];
  blockers: readonly Readonly<{
    code: string;
    key: string;
    message: string;
  }>[];
}>;

export type CreditexActivityWorkPackSignerIdentity = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_SIGNER_IDENTITY_CONTRACT;
  roleKey: string;
  capacity: string;
  identitySource: CreditexWorkPackSignerIdentitySource;
  signerName: string;
  signerUid: string;
  fields: Readonly<Record<string, string>>;
}>;

export type CreditexActivityWorkPackSignaturePoint = Readonly<{
  x: number;
  y: number;
  pressure: number | null;
  capturedAtOffsetMs: number;
}>;

export type CreditexActivityWorkPackSignatureStroke = Readonly<{
  points: readonly CreditexActivityWorkPackSignaturePoint[];
}>;

export type CreditexActivityWorkPackSignaturePayload = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT;
  instanceKey: string;
  caseInstanceId: string;
  promptKey: string;
  signerRoleKey: string;
  signerName: string;
  signerCapacity: string;
  signerIdentitySha256: string;
  attestationSha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  strokes: readonly CreditexActivityWorkPackSignatureStroke[];
  signedAt: string;
}>;

export type CreditexActivityWorkPackSignatureAttestation = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT;
  promptKey: string;
  signerRoleKey: string;
  text: string;
  version: string;
  sourceBindingTargetKey: string;
  signerIdentity: CreditexActivityWorkPackSignerIdentity;
  signerIdentitySha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
}>;

export type CreditexActivityWorkPackDeviceAttestation = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_DEVICE_ATTESTATION_CONTRACT;
  deviceId: string;
  appId: string;
  appVersion: string;
  appBuild: string;
  sessionId: string;
  capturedByUid: string;
  signedAt: string;
  deviceContext: Readonly<Record<string, string | number | boolean>>;
}>;

export type CreditexActivityWorkPackSignatureManifestEntry = Readonly<{
  id: string;
  promptKey: string;
  signerRole: string;
  signerName: string;
  signatureSha256: string;
  signaturePayloadSha256: string;
  attestationSha256: string;
  signerIdentitySha256: string;
  signedAt: string;
}>;

export type CreditexActivityWorkPackSignatureManifest = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_SIGNATURE_MANIFEST_CONTRACT;
  instanceKey: string;
  caseInstanceId: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  signatures: readonly CreditexActivityWorkPackSignatureManifestEntry[];
}>;

export type CreditexActivityWorkPackFinalRecord = Readonly<{
  contract: typeof CREDITEX_ACTIVITY_WORK_PACK_FINAL_RECORD_CONTRACT;
  instanceKey: string;
  caseInstanceId: string;
  workPackVersionId: string;
  instanceSha256: string;
  definitionSha256: string;
  prefillSha256: string;
  responseSha256: string;
  declarationsSha256: string;
  signatureManifest: CreditexActivityWorkPackSignatureManifest;
  signatureManifestSha256: string;
  rendererContract: typeof CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_CONTRACT;
  rendererVersion: string;
  outputKey: string;
  outputDefinitionSha256: string;
  templateSourceArtifactId: string;
  templateSourceArtifactSha256: string;
  objectKey: string;
  fileName: string;
  contentType: "application/pdf";
  sizeBytes: number;
  pdfSha256: string;
  integrityReceiptId: string;
  createdByUid: string;
  createdAt: string;
  finalisedByUid: string;
  finalisedAt: string;
}>;

export class CreditexActivityWorkPackContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreditexActivityWorkPackContractError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new CreditexActivityWorkPackContractError(code, message);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

function objectValue(
  value: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(code, message);
  }
  return value as Record<string, unknown>;
}

function textValue(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
  allowEmpty = false,
) {
  const result = String(value ?? "").trim();
  if ((!allowEmpty && !result) || result.length > maximum) {
    return fail(
      code,
      allowEmpty
        ? `${label} must contain no more than ${maximum} characters.`
        : `${label} is required and must contain no more than ${maximum} characters.`,
    );
  }
  return result;
}

function keyValue(value: unknown, code: string, label: string) {
  const result = textValue(value, 120, code, label).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) {
    return fail(
      code,
      `${label} must use lowercase letters, numbers, dots, underscores or hyphens.`,
    );
  }
  return result;
}

function calculatorEngineKeyValue(value: unknown, code: string, label: string) {
  const result = textValue(value, 64, code, label).toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(result)) {
    return fail(
      code,
      `${label} must use lower snake case and begin with a letter.`,
    );
  }
  return result;
}

function integerValue(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
  label: string,
) {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result)
    || result < minimum
    || result > maximum
  ) {
    return fail(
      code,
      `${label} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return result;
}

function optionalNumber(
  value: unknown,
  code: string,
  label: string,
) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result)) {
    return fail(code, `${label} must be a finite number.`);
  }
  return result;
}

function finiteNumberValue(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
  label: string,
) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    return fail(
      code,
      `${label} must be a finite number from ${minimum} to ${maximum}.`,
    );
  }
  return result;
}

function booleanValue(value: unknown) {
  if (value !== true && value !== false) {
    return fail(
      "WORK_PACK_BOOLEAN_INVALID",
      "Work-pack boolean fields must be true or false.",
    );
  }
  return value;
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validIsoDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function dateValue(value: unknown, code: string, label: string) {
  const result = textValue(value, 10, code, label);
  if (!validIsoDate(result)) {
    return fail(code, `${label} must be a valid ISO date.`);
  }
  return result;
}

function optionalDateValue(value: unknown, code: string, label: string) {
  const result = textValue(value, 10, code, label, true);
  if (result && !validIsoDate(result)) {
    return fail(code, `${label} must be blank or a valid ISO date.`);
  }
  return result;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  code: string,
  label: string,
): T[number] {
  const result = String(value ?? "") as T[number];
  if (!choices.includes(result)) {
    return fail(code, `Choose a supported ${label}.`);
  }
  return result;
}

function uniqueStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  code: string,
  label: string,
  minimumItems = 0,
) {
  if (!Array.isArray(value)) {
    return fail(code, `${label} must be a list.`);
  }
  const values = value.map((item) =>
    textValue(item, maximumLength, code, label)
  );
  if (
    values.length < minimumItems
    || values.length > maximumItems
    || new Set(values.map((item) => item.toLowerCase())).size !== values.length
  ) {
    return fail(
      code,
      `${label} must contain ${minimumItems} to ${maximumItems} unique values.`,
    );
  }
  return values;
}

function conditionValue(value: unknown): CreditexWorkPackConditionValue {
  if (
    typeof value !== "string"
    && typeof value !== "number"
    && typeof value !== "boolean"
  ) {
    return fail(
      "WORK_PACK_CONDITION_VALUE_INVALID",
      "Condition values must be text, numbers or booleans.",
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return fail(
      "WORK_PACK_CONDITION_VALUE_INVALID",
      "Condition numbers must be finite.",
    );
  }
  return typeof value === "string" ? value.slice(0, 500) : value;
}

function validateCondition(input: unknown): CreditexWorkPackCondition {
  const value = objectValue(
    input,
    "WORK_PACK_CONDITION_INVALID",
    "Every work-pack condition must be an object.",
  );
  const operator = enumValue(
    value.operator,
    CREDITEX_WORK_PACK_CONDITION_OPERATORS,
    "WORK_PACK_CONDITION_OPERATOR_INVALID",
    "condition operator",
  );
  let expected: CreditexWorkPackCondition["value"];
  if (operator === "answered" || operator === "not_answered") {
    if (value.value !== null && value.value !== undefined) {
      return fail(
        "WORK_PACK_CONDITION_VALUE_NOT_ALLOWED",
        "Answered and not-answered conditions cannot include a value.",
      );
    }
    expected = null;
  } else if (operator === "in" || operator === "not_in") {
    if (!Array.isArray(value.value) || value.value.length < 1
      || value.value.length > 100) {
      return fail(
        "WORK_PACK_CONDITION_LIST_INVALID",
        "In and not-in conditions need 1 to 100 values.",
      );
    }
    expected = value.value.map(conditionValue);
  } else {
    expected = conditionValue(value.value);
  }
  return {
    promptKey: keyValue(
      value.promptKey,
      "WORK_PACK_CONDITION_PROMPT_KEY_INVALID",
      "Condition prompt key",
    ),
    scope: enumValue(
      value.scope,
      ["work_pack", "section_instance"] as const,
      "WORK_PACK_CONDITION_SCOPE_INVALID",
      "condition scope",
    ),
    operator,
    value: expected,
  };
}

function validateVisibility(input: unknown): CreditexWorkPackVisibility | null {
  if (input === null || input === undefined) return null;
  const value = objectValue(
    input,
    "WORK_PACK_VISIBILITY_INVALID",
    "Work-pack visibility must be an object.",
  );
  if (!Array.isArray(value.conditions) || value.conditions.length < 1
    || value.conditions.length > 20) {
    return fail(
      "WORK_PACK_VISIBILITY_CONDITIONS_INVALID",
      "Visibility needs 1 to 20 conditions.",
    );
  }
  return {
    match: enumValue(
      value.match,
      ["all", "any"] as const,
      "WORK_PACK_VISIBILITY_MATCH_INVALID",
      "visibility match mode",
    ),
    conditions: value.conditions.map(validateCondition),
  };
}

function validateOptions(input: unknown, required: boolean) {
  if (!Array.isArray(input)) {
    return fail(
      "WORK_PACK_OPTIONS_INVALID",
      "Prompt options must be a list.",
    );
  }
  const options = input.map((item) => {
    const value = objectValue(
      item,
      "WORK_PACK_OPTION_INVALID",
      "Every prompt option must be an object.",
    );
    return {
      value: keyValue(
        value.value,
        "WORK_PACK_OPTION_VALUE_INVALID",
        "Option value",
      ),
      label: textValue(
        value.label,
        180,
        "WORK_PACK_OPTION_LABEL_INVALID",
        "Option label",
      ),
    };
  });
  if (
    (required && (options.length < 2 || options.length > 100))
    || (!required && options.length !== 0)
    || new Set(options.map((item) => item.value)).size !== options.length
  ) {
    return fail(
      "WORK_PACK_OPTIONS_INVALID",
      required
        ? "Select and multiselect prompts need 2 to 100 unique options."
        : "Only select and multiselect prompts can define options.",
    );
  }
  return options;
}

function validateFileRequirement(
  input: unknown,
  type: CreditexWorkPackPromptType,
): CreditexWorkPackFileRequirement | null {
  const isFile = type === "photo" || type === "document";
  if (!isFile) {
    if (input !== null && input !== undefined) {
      return fail(
        "WORK_PACK_FILE_REQUIREMENT_NOT_ALLOWED",
        "Only photo and document prompts can define file requirements.",
      );
    }
    return null;
  }
  const value = objectValue(
    input,
    "WORK_PACK_FILE_REQUIREMENT_REQUIRED",
    "Photo and document prompts need file requirements.",
  );
  const minimumCount = integerValue(
    value.minimumCount,
    0,
    20,
    "WORK_PACK_FILE_MINIMUM_INVALID",
    "Minimum file count",
  );
  const maximumCount = integerValue(
    value.maximumCount,
    1,
    20,
    "WORK_PACK_FILE_MAXIMUM_INVALID",
    "Maximum file count",
  );
  if (maximumCount < minimumCount) {
    return fail(
      "WORK_PACK_FILE_RANGE_INVALID",
      "Maximum file count must be at least the minimum file count.",
    );
  }
  const allowedContentTypes = uniqueStrings(
    value.allowedContentTypes,
    20,
    120,
    "WORK_PACK_FILE_CONTENT_TYPES_INVALID",
    "Allowed content types",
    1,
  ).map((item) => item.toLowerCase());
  if (
    type === "photo"
    && allowedContentTypes.some((item) => !item.startsWith("image/"))
  ) {
    return fail(
      "WORK_PACK_PHOTO_CONTENT_TYPE_INVALID",
      "Photo prompts can only accept image content types.",
    );
  }
  return {
    minimumCount,
    maximumCount,
    allowedContentTypes,
    originalRequired: booleanValue(value.originalRequired),
    metadataRequired: booleanValue(value.metadataRequired),
    gpsRequired: booleanValue(value.gpsRequired),
    captureTimeRequired: booleanValue(value.captureTimeRequired),
  };
}

function validateAttestation(input: unknown): CreditexWorkPackAttestation | null {
  if (input === null || input === undefined) return null;
  const value = objectValue(
    input,
    "WORK_PACK_ATTESTATION_INVALID",
    "Prompt attestation must be an object.",
  );
  return {
    text: textValue(
      value.text,
      10_000,
      "WORK_PACK_ATTESTATION_TEXT_INVALID",
      "Attestation text",
    ),
    version: textValue(
      value.version,
      120,
      "WORK_PACK_ATTESTATION_VERSION_INVALID",
      "Attestation version",
    ),
    sourceBindingTargetKey: keyValue(
      value.sourceBindingTargetKey,
      "WORK_PACK_ATTESTATION_SOURCE_TARGET_INVALID",
      "Attestation source-binding target key",
    ),
  };
}

function validateReferenceDocument(
  input: unknown,
  type: CreditexWorkPackPromptType,
  required: boolean,
): CreditexWorkPackReferenceDocument | null {
  if (type !== "reference_document") {
    if (input !== null && input !== undefined) {
      return fail(
        "WORK_PACK_REFERENCE_DOCUMENT_NOT_ALLOWED",
        "Only reference-document prompts can define a governed document.",
      );
    }
    return null;
  }
  const value = objectValue(
    input,
    "WORK_PACK_REFERENCE_DOCUMENT_REQUIRED",
    "Reference-document prompts need an exact governed source binding.",
  );
  const acknowledgementMode = enumValue(
    value.acknowledgementMode,
    CREDITEX_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_MODES,
    "WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_MODE_INVALID",
    "reference-document acknowledgement mode",
  );
  if (required !== (acknowledgementMode !== "none")) {
    return fail(
      "WORK_PACK_REFERENCE_DOCUMENT_REQUIREMENT_INVALID",
      "Required reference documents must use viewed or confirmed acknowledgement; non-blocking documents must use none.",
    );
  }
  const acknowledgementRequired = acknowledgementMode !== "none";
  return {
    sourceBindingTargetKey: keyValue(
      value.sourceBindingTargetKey,
      "WORK_PACK_REFERENCE_DOCUMENT_SOURCE_TARGET_INVALID",
      "Reference-document source-binding target key",
    ),
    acknowledgementMode,
    acknowledgementText: textValue(
      value.acknowledgementText,
      10_000,
      "WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_TEXT_INVALID",
      "Reference-document acknowledgement text",
      !acknowledgementRequired,
    ),
    acknowledgementVersion: textValue(
      value.acknowledgementVersion,
      120,
      "WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_VERSION_INVALID",
      "Reference-document acknowledgement version",
      !acknowledgementRequired,
    ),
  };
}

function validateRepeatability(
  input: unknown,
): CreditexWorkPackRepeatability | null {
  if (input === null || input === undefined) return null;
  const value = objectValue(
    input,
    "WORK_PACK_REPEATABILITY_INVALID",
    "Section repeatability must be an object.",
  );
  const minimumInstances = integerValue(
    value.minimumInstances,
    0,
    500,
    "WORK_PACK_REPEATABILITY_MINIMUM_INVALID",
    "Minimum section instances",
  );
  const maximumInstances = integerValue(
    value.maximumInstances,
    1,
    500,
    "WORK_PACK_REPEATABILITY_MAXIMUM_INVALID",
    "Maximum section instances",
  );
  if (maximumInstances < minimumInstances) {
    return fail(
      "WORK_PACK_REPEATABILITY_RANGE_INVALID",
      "Maximum section instances must be at least the minimum.",
    );
  }
  return {
    itemKey: keyValue(
      value.itemKey,
      "WORK_PACK_REPEATABILITY_ITEM_KEY_INVALID",
      "Repeatable item key",
    ),
    itemLabel: textValue(
      value.itemLabel,
      180,
      "WORK_PACK_REPEATABILITY_ITEM_LABEL_INVALID",
      "Repeatable item label",
    ),
    minimumInstances,
    maximumInstances,
  };
}

function validateStage(input: unknown): CreditexWorkPackStage {
  const value = objectValue(
    input,
    "WORK_PACK_STAGE_INVALID",
    "Every work-pack stage must be an object.",
  );
  return {
    stageKey: keyValue(
      value.stageKey,
      "WORK_PACK_STAGE_KEY_INVALID",
      "Stage key",
    ),
    order: integerValue(
      value.order,
      1,
      1_000,
      "WORK_PACK_STAGE_ORDER_INVALID",
      "Stage order",
    ),
    label: textValue(
      value.label,
      180,
      "WORK_PACK_STAGE_LABEL_INVALID",
      "Stage label",
    ),
    description: textValue(
      value.description,
      1_000,
      "WORK_PACK_STAGE_DESCRIPTION_INVALID",
      "Stage description",
      true,
    ),
  };
}

function validateSignerRole(input: unknown): CreditexWorkPackSignerRole {
  const value = objectValue(
    input,
    "WORK_PACK_SIGNER_ROLE_INVALID",
    "Every signer role must be an object.",
  );
  if (!Array.isArray(value.identityRequirements)
    || value.identityRequirements.length < 1
    || value.identityRequirements.length > 30) {
    return fail(
      "WORK_PACK_SIGNER_IDENTITY_REQUIREMENTS_INVALID",
      "Signer roles need 1 to 30 identity requirements.",
    );
  }
  const identityRequirements = value.identityRequirements.map((item) => {
    const requirement = objectValue(
      item,
      "WORK_PACK_SIGNER_IDENTITY_REQUIREMENT_INVALID",
      "Every signer identity requirement must be an object.",
    );
    return {
      fieldKey: keyValue(
        requirement.fieldKey,
        "WORK_PACK_SIGNER_IDENTITY_FIELD_INVALID",
        "Signer identity field key",
      ),
      label: textValue(
        requirement.label,
        180,
        "WORK_PACK_SIGNER_IDENTITY_LABEL_INVALID",
        "Signer identity label",
      ),
      required: booleanValue(requirement.required),
    };
  });
  if (new Set(identityRequirements.map((item) => item.fieldKey)).size
    !== identityRequirements.length) {
    return fail(
      "WORK_PACK_SIGNER_IDENTITY_FIELD_DUPLICATE",
      "Signer identity field keys must be unique within a role.",
    );
  }
  const minimumSignatures = integerValue(
    value.minimumSignatures,
    1,
    20,
    "WORK_PACK_SIGNER_MINIMUM_INVALID",
    "Minimum signatures",
  );
  const maximumSignatures = integerValue(
    value.maximumSignatures,
    1,
    20,
    "WORK_PACK_SIGNER_MAXIMUM_INVALID",
    "Maximum signatures",
  );
  if (maximumSignatures < minimumSignatures) {
    return fail(
      "WORK_PACK_SIGNER_RANGE_INVALID",
      "Maximum signatures must be at least the minimum.",
    );
  }
  if (minimumSignatures !== 1 || maximumSignatures !== 1) {
    return fail(
      "WORK_PACK_SIGNER_MULTIPLE_UNSUPPORTED",
      "Each governed signer role must capture exactly one signature in the v1 immutable PDF workflow.",
    );
  }
  return {
    roleKey: keyValue(
      value.roleKey,
      "WORK_PACK_SIGNER_ROLE_KEY_INVALID",
      "Signer role key",
    ),
    label: textValue(
      value.label,
      180,
      "WORK_PACK_SIGNER_ROLE_LABEL_INVALID",
      "Signer role label",
    ),
    capacity: textValue(
      value.capacity,
      240,
      "WORK_PACK_SIGNER_CAPACITY_INVALID",
      "Signer capacity",
    ),
    identitySource: enumValue(
      value.identitySource,
      CREDITEX_WORK_PACK_SIGNER_IDENTITY_SOURCES,
      "WORK_PACK_SIGNER_IDENTITY_SOURCE_INVALID",
      "signer identity source",
    ),
    minimumSignatures,
    maximumSignatures,
    identityRequirements,
  };
}

function validatePrompt(input: unknown): CreditexWorkPackPrompt {
  const value = objectValue(
    input,
    "WORK_PACK_PROMPT_INVALID",
    "Every work-pack prompt must be an object.",
  );
  const type = enumValue(
    value.type,
    CREDITEX_WORK_PACK_PROMPT_TYPES,
    "WORK_PACK_PROMPT_TYPE_INVALID",
    "prompt type",
  );
  const required = booleanValue(value.required);
  const options = validateOptions(
    value.options ?? [],
    type === "select" || type === "multiselect",
  );
  const signerRoleKey = type === "signature"
    ? keyValue(
        value.signerRoleKey,
        "WORK_PACK_SIGNER_ROLE_KEY_INVALID",
        "Signer role key",
      )
    : "";
  if (type !== "signature" && value.signerRoleKey !== ""
    && value.signerRoleKey !== null && value.signerRoleKey !== undefined) {
    return fail(
      "WORK_PACK_SIGNER_ROLE_NOT_ALLOWED",
      "Only signature prompts can define a signer role.",
    );
  }
  const attestation = validateAttestation(value.attestation);
  if (attestation && type !== "signature" && type !== "checkbox") {
    return fail(
      "WORK_PACK_ATTESTATION_TYPE_INVALID",
      "Only signature and checkbox prompts can define an attestation.",
    );
  }
  if (type === "signature" && !attestation) {
    return fail(
      "WORK_PACK_SIGNATURE_ATTESTATION_REQUIRED",
      "Signature prompts need exact versioned attestation text.",
    );
  }
  const referenceDocument = validateReferenceDocument(
    value.referenceDocument,
    type,
    required,
  );
  const minimumLength = optionalNumber(
    value.minimumLength,
    "WORK_PACK_MINIMUM_LENGTH_INVALID",
    "Minimum text length",
  );
  const maximumLength = optionalNumber(
    value.maximumLength,
    "WORK_PACK_MAXIMUM_LENGTH_INVALID",
    "Maximum text length",
  );
  if (
    (minimumLength !== null || maximumLength !== null)
    && type !== "text"
    && type !== "textarea"
  ) {
    return fail(
      "WORK_PACK_LENGTH_NOT_ALLOWED",
      "Only text and textarea prompts can define text lengths.",
    );
  }
  if (
    minimumLength !== null
    && (
      !Number.isSafeInteger(minimumLength)
      || minimumLength < 0
      || minimumLength > 20_000
    )
  ) {
    return fail(
      "WORK_PACK_MINIMUM_LENGTH_INVALID",
      "Minimum text length must be a whole number from 0 to 20000.",
    );
  }
  if (
    maximumLength !== null
    && (
      !Number.isSafeInteger(maximumLength)
      || maximumLength < 1
      || maximumLength > 20_000
      || (minimumLength !== null && maximumLength < minimumLength)
    )
  ) {
    return fail(
      "WORK_PACK_MAXIMUM_LENGTH_INVALID",
      "Maximum text length must be a whole number at least as large as the minimum.",
    );
  }
  const minimumNumber = optionalNumber(
    value.minimumNumber,
    "WORK_PACK_MINIMUM_NUMBER_INVALID",
    "Minimum number",
  );
  const maximumNumber = optionalNumber(
    value.maximumNumber,
    "WORK_PACK_MAXIMUM_NUMBER_INVALID",
    "Maximum number",
  );
  const numberStep = optionalNumber(
    value.numberStep,
    "WORK_PACK_NUMBER_STEP_INVALID",
    "Number step",
  );
  const unit = textValue(
    value.unit,
    40,
    "WORK_PACK_NUMBER_UNIT_INVALID",
    "Number unit",
    true,
  );
  if (
    (minimumNumber !== null || maximumNumber !== null
      || numberStep !== null || unit)
    && type !== "number"
  ) {
    return fail(
      "WORK_PACK_NUMBER_RULE_NOT_ALLOWED",
      "Only number prompts can define number rules.",
    );
  }
  if (
    minimumNumber !== null
    && maximumNumber !== null
    && maximumNumber < minimumNumber
  ) {
    return fail(
      "WORK_PACK_NUMBER_RANGE_INVALID",
      "Maximum number must be at least the minimum number.",
    );
  }
  if (numberStep !== null && numberStep <= 0) {
    return fail(
      "WORK_PACK_NUMBER_STEP_INVALID",
      "Number step must be greater than zero.",
    );
  }
  const minimumSelections = value.minimumSelections === null
    || value.minimumSelections === undefined
    ? null
    : integerValue(
        value.minimumSelections,
        0,
        100,
        "WORK_PACK_MINIMUM_SELECTIONS_INVALID",
        "Minimum selections",
      );
  const maximumSelections = value.maximumSelections === null
    || value.maximumSelections === undefined
    ? null
    : integerValue(
        value.maximumSelections,
        1,
        100,
        "WORK_PACK_MAXIMUM_SELECTIONS_INVALID",
        "Maximum selections",
      );
  if (
    (minimumSelections !== null || maximumSelections !== null)
    && type !== "multiselect"
  ) {
    return fail(
      "WORK_PACK_SELECTION_RULE_NOT_ALLOWED",
      "Only multiselect prompts can define selection counts.",
    );
  }
  if (
    type === "multiselect"
    && (
      minimumSelections === null
      || maximumSelections === null
      || maximumSelections < minimumSelections
      || maximumSelections > options.length
    )
  ) {
    return fail(
      "WORK_PACK_SELECTION_RANGE_INVALID",
      "Multiselect prompts need a valid selection range within their options.",
    );
  }
  return {
    promptKey: keyValue(
      value.promptKey,
      "WORK_PACK_PROMPT_KEY_INVALID",
      "Prompt key",
    ),
    order: integerValue(
      value.order,
      1,
      1_000,
      "WORK_PACK_PROMPT_ORDER_INVALID",
      "Prompt order",
    ),
    type,
    label: textValue(
      value.label,
      240,
      "WORK_PACK_PROMPT_LABEL_INVALID",
      "Prompt label",
    ),
    instructions: textValue(
      value.instructions,
      2_000,
      "WORK_PACK_PROMPT_INSTRUCTIONS_INVALID",
      "Prompt instructions",
      true,
    ),
    required,
    visibility: validateVisibility(value.visibility),
    dependencyKeys: uniqueStrings(
      value.dependencyKeys ?? [],
      20,
      120,
      "WORK_PACK_PROMPT_DEPENDENCIES_INVALID",
      "Prompt dependency keys",
    ).map((item) => item.toLowerCase()),
    requirementKeys: uniqueStrings(
      value.requirementKeys ?? [],
      100,
      180,
      "WORK_PACK_PROMPT_REQUIREMENTS_INVALID",
      "Prompt governed requirement keys",
    ),
    stageKey: value.stageKey === "" || value.stageKey === null
      || value.stageKey === undefined
      ? ""
      : keyValue(
          value.stageKey,
          "WORK_PACK_PROMPT_STAGE_INVALID",
          "Prompt stage key",
        ),
    options,
    signerRoleKey,
    attestation,
    minimumLength,
    maximumLength,
    minimumNumber,
    maximumNumber,
    numberStep,
    unit,
    minimumSelections,
    maximumSelections,
    fileRequirement: validateFileRequirement(value.fileRequirement, type),
    referenceDocument,
  };
}

function validateSection(input: unknown): CreditexWorkPackSection {
  const value = objectValue(
    input,
    "WORK_PACK_SECTION_INVALID",
    "Every work-pack section must be an object.",
  );
  if (!Array.isArray(value.prompts) || value.prompts.length < 1
    || value.prompts.length > 100) {
    return fail(
      "WORK_PACK_SECTION_PROMPTS_INVALID",
      "Every work-pack section needs 1 to 100 prompts.",
    );
  }
  const prompts = value.prompts.map(validatePrompt).sort(
    (left, right) => left.order - right.order
      || compareText(left.promptKey, right.promptKey),
  );
  if (new Set(prompts.map((prompt) => prompt.order)).size !== prompts.length) {
    return fail(
      "WORK_PACK_PROMPT_ORDER_DUPLICATE",
      "Prompt order must be unique within each section.",
    );
  }
  return {
    sectionKey: keyValue(
      value.sectionKey,
      "WORK_PACK_SECTION_KEY_INVALID",
      "Section key",
    ),
    order: integerValue(
      value.order,
      1,
      1_000,
      "WORK_PACK_SECTION_ORDER_INVALID",
      "Section order",
    ),
    title: textValue(
      value.title,
      240,
      "WORK_PACK_SECTION_TITLE_INVALID",
      "Section title",
    ),
    description: textValue(
      value.description,
      1_000,
      "WORK_PACK_SECTION_DESCRIPTION_INVALID",
      "Section description",
      true,
    ),
    visibility: validateVisibility(value.visibility),
    repeatability: validateRepeatability(value.repeatability),
    prompts,
  };
}

function validateDependency(input: unknown): CreditexWorkPackDependency {
  const value = objectValue(
    input,
    "WORK_PACK_DEPENDENCY_INVALID",
    "Every work-pack dependency must be an object.",
  );
  const kind = enumValue(
    value.kind,
    CREDITEX_WORK_PACK_DEPENDENCY_KINDS,
    "WORK_PACK_DEPENDENCY_KIND_INVALID",
    "dependency kind",
  );
  const common = {
    dependencyKey: keyValue(
      value.dependencyKey,
      "WORK_PACK_DEPENDENCY_KEY_INVALID",
      "Dependency key",
    ),
    label: textValue(
      value.label,
      240,
      "WORK_PACK_DEPENDENCY_LABEL_INVALID",
      "Dependency label",
    ),
    required: booleanValue(value.required),
  };
  if (kind === "product") {
    const minimumCount = integerValue(
      value.minimumCount,
      0,
      100,
      "WORK_PACK_PRODUCT_MINIMUM_INVALID",
      "Minimum product count",
    );
    const maximumCount = integerValue(
      value.maximumCount,
      1,
      100,
      "WORK_PACK_PRODUCT_MAXIMUM_INVALID",
      "Maximum product count",
    );
    const selectionMode = enumValue(
      value.selectionMode,
      ["single", "multiple"] as const,
      "WORK_PACK_PRODUCT_SELECTION_MODE_INVALID",
      "product selection mode",
    );
    if (
      maximumCount < minimumCount
      || (selectionMode === "single" && maximumCount !== 1)
    ) {
      return fail(
        "WORK_PACK_PRODUCT_COUNT_RANGE_INVALID",
        "Product count range must match the selection mode.",
      );
    }
    return {
      ...common,
      kind,
      registryCode: keyValue(
        value.registryCode,
        "WORK_PACK_PRODUCT_REGISTRY_INVALID",
        "Product registry code",
      ),
      productKind: enumValue(
        value.productKind,
        [...CREDITEX_OFFICIAL_PRODUCT_KINDS, "not_applicable"] as const,
        "WORK_PACK_PRODUCT_KIND_INVALID",
        "official product kind",
      ),
      productCategory: textValue(
        value.productCategory,
        240,
        "WORK_PACK_PRODUCT_CATEGORY_INVALID",
        "Product category",
      ),
      selectionMode,
      minimumCount,
      maximumCount,
    };
  }
  if (kind === "scenario") {
    return {
      ...common,
      kind,
      scenarioCodes: uniqueStrings(
        value.scenarioCodes,
        100,
        120,
        "WORK_PACK_SCENARIO_CODES_INVALID",
        "Scenario codes",
        1,
      ),
      selectionMode: enumValue(
        value.selectionMode,
        ["single", "multiple"] as const,
        "WORK_PACK_SCENARIO_SELECTION_MODE_INVALID",
        "scenario selection mode",
      ),
    };
  }
  return {
    ...common,
    kind,
    catalogueFormulaKey: textValue(
      value.catalogueFormulaKey,
      180,
      "WORK_PACK_CALCULATOR_FORMULA_KEY_INVALID",
      "Catalogue formula key",
    ),
    calculatorKey: calculatorEngineKeyValue(
      value.calculatorKey,
      "WORK_PACK_CALCULATOR_KEY_INVALID",
      "Calculator key",
    ),
    calculatorVersion: integerValue(
      value.calculatorVersion,
      1,
      1_000_000,
      "WORK_PACK_CALCULATOR_VERSION_INVALID",
      "Calculator version",
    ),
    requiredInputKeys: uniqueStrings(
      value.requiredInputKeys,
      100,
      120,
      "WORK_PACK_CALCULATOR_INPUTS_INVALID",
      "Calculator input keys",
      1,
    ).map((item) => item.toLowerCase()),
  };
}

function validDocumentSourcePath(value: string) {
  if (
    !CREDITEX_WORK_PACK_DOCUMENT_SOURCE_PATH_PREFIXES.some((prefix) =>
      value.startsWith(prefix)
    )
  ) {
    return false;
  }
  const tokens = value.slice(1).split("/");
  return tokens.length >= 2 && tokens.every((token) =>
    token.length > 0
    && token.length <= 240
    && !/~(?:[^01]|$)/.test(token)
  );
}

function validateDocumentPlacement(
  input: unknown,
): CreditexWorkPackDocumentPlacement {
  const value = objectValue(
    input,
    "WORK_PACK_DOCUMENT_PLACEMENT_INVALID",
    "Every document placement must be an object.",
  );
  const kind = enumValue(
    value.kind,
    CREDITEX_WORK_PACK_DOCUMENT_PLACEMENT_KINDS,
    "WORK_PACK_DOCUMENT_PLACEMENT_KIND_INVALID",
    "document placement kind",
  );
  const x = finiteNumberValue(
    value.x,
    0,
    1,
    "WORK_PACK_DOCUMENT_PLACEMENT_X_INVALID",
    "Document placement x coordinate",
  );
  const y = finiteNumberValue(
    value.y,
    0,
    1,
    "WORK_PACK_DOCUMENT_PLACEMENT_Y_INVALID",
    "Document placement y coordinate",
  );
  const width = finiteNumberValue(
    value.width,
    0.001,
    1,
    "WORK_PACK_DOCUMENT_PLACEMENT_WIDTH_INVALID",
    "Document placement width",
  );
  const height = finiteNumberValue(
    value.height,
    0.001,
    1,
    "WORK_PACK_DOCUMENT_PLACEMENT_HEIGHT_INVALID",
    "Document placement height",
  );
  if (x + width > 1.000_000_001 || y + height > 1.000_000_001) {
    return fail(
      "WORK_PACK_DOCUMENT_PLACEMENT_BOUNDS_INVALID",
      "Document placements must fit entirely within their normalized PDF page.",
    );
  }
  const sourcePath = textValue(
    value.sourcePath,
    1_000,
    "WORK_PACK_DOCUMENT_SOURCE_PATH_INVALID",
    "Document placement source path",
    kind === "signature",
  );
  const signaturePromptKey = kind === "signature"
    ? keyValue(
        value.signaturePromptKey,
        "WORK_PACK_DOCUMENT_SIGNATURE_PROMPT_INVALID",
        "Document signature prompt key",
      )
    : textValue(
        value.signaturePromptKey,
        120,
        "WORK_PACK_DOCUMENT_SIGNATURE_PROMPT_INVALID",
        "Document signature prompt key",
        true,
      );
  const signerRoleKey = kind === "signature"
    ? keyValue(
        value.signerRoleKey,
        "WORK_PACK_DOCUMENT_SIGNER_ROLE_INVALID",
        "Document signer role key",
      )
    : textValue(
        value.signerRoleKey,
        120,
        "WORK_PACK_DOCUMENT_SIGNER_ROLE_INVALID",
        "Document signer role key",
        true,
      );
  if (kind === "text" && !validDocumentSourcePath(sourcePath)) {
    return fail(
      "WORK_PACK_DOCUMENT_SOURCE_PATH_INVALID",
      "Document text source paths must be canonical JSON pointers rooted at prefill, response, declarations or signatures.",
    );
  }
  if (
    (kind === "signature" && sourcePath)
    || (kind === "text" && (signaturePromptKey || signerRoleKey))
  ) {
    return fail(
      "WORK_PACK_DOCUMENT_PLACEMENT_SOURCE_INVALID",
      "Text placements use a source path; signature placements use a signature prompt and signer role.",
    );
  }
  const fontSize = finiteNumberValue(
    value.fontSize,
    4,
    96,
    "WORK_PACK_DOCUMENT_FONT_SIZE_INVALID",
    "Document placement font size",
  );
  const minimumFontSize = finiteNumberValue(
    value.minimumFontSize,
    4,
    96,
    "WORK_PACK_DOCUMENT_MINIMUM_FONT_SIZE_INVALID",
    "Document placement minimum font size",
  );
  if (minimumFontSize > fontSize) {
    return fail(
      "WORK_PACK_DOCUMENT_FONT_RANGE_INVALID",
      "Document placement minimum font size cannot exceed its preferred font size.",
    );
  }
  return {
    placementKey: keyValue(
      value.placementKey,
      "WORK_PACK_DOCUMENT_PLACEMENT_KEY_INVALID",
      "Document placement key",
    ),
    kind,
    sourcePath,
    signaturePromptKey,
    signerRoleKey,
    pageIndex: integerValue(
      value.pageIndex,
      0,
      999,
      "WORK_PACK_DOCUMENT_PAGE_INDEX_INVALID",
      "Document placement page index",
    ),
    x,
    y,
    width,
    height,
    fontFamily: enumValue(
      value.fontFamily,
      ["helvetica", "helvetica_bold"] as const,
      "WORK_PACK_DOCUMENT_FONT_FAMILY_INVALID",
      "document placement font family",
    ),
    fontSize,
    minimumFontSize,
    overflow: enumValue(
      value.overflow,
      CREDITEX_WORK_PACK_DOCUMENT_OVERFLOW_MODES,
      "WORK_PACK_DOCUMENT_OVERFLOW_INVALID",
      "document placement overflow mode",
    ),
    maximumLines: integerValue(
      value.maximumLines,
      1,
      100,
      "WORK_PACK_DOCUMENT_MAXIMUM_LINES_INVALID",
      "Document placement maximum lines",
    ),
    textFormat: enumValue(
      value.textFormat,
      CREDITEX_WORK_PACK_DOCUMENT_TEXT_FORMATS,
      "WORK_PACK_DOCUMENT_TEXT_FORMAT_INVALID",
      "document placement text format",
    ),
  };
}

function validateDocumentOutput(input: unknown): CreditexWorkPackDocumentOutput {
  const value = objectValue(
    input,
    "WORK_PACK_DOCUMENT_OUTPUT_INVALID",
    "Every document output must be an object.",
  );
  if (
    !Array.isArray(value.placements)
    || value.placements.length < 1
    || value.placements.length > 500
  ) {
    return fail(
      "WORK_PACK_DOCUMENT_PLACEMENTS_INVALID",
      "A document output needs 1 to 500 governed placements.",
    );
  }
  const placements = value.placements.map(validateDocumentPlacement).sort(
    (left, right) => compareText(left.placementKey, right.placementKey),
  );
  if (
    new Set(placements.map((placement) => placement.placementKey)).size
      !== placements.length
  ) {
    return fail(
      "WORK_PACK_DOCUMENT_PLACEMENT_KEY_DUPLICATE",
      "Document placement keys must be unique within an output.",
    );
  }
  const rendererVersion = textValue(
    value.rendererVersion,
    120,
    "WORK_PACK_DOCUMENT_RENDERER_VERSION_INVALID",
    "Document renderer version",
  );
  if (rendererVersion !== CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION) {
    return fail(
      "WORK_PACK_DOCUMENT_RENDERER_UNSUPPORTED",
      "The document output must use a supported deterministic renderer version.",
    );
  }
  return {
    outputKey: keyValue(
      value.outputKey,
      "WORK_PACK_DOCUMENT_OUTPUT_KEY_INVALID",
      "Document output key",
    ),
    title: textValue(
      value.title,
      240,
      "WORK_PACK_DOCUMENT_OUTPUT_TITLE_INVALID",
      "Document output title",
    ),
    sourceBindingTargetKey: keyValue(
      value.sourceBindingTargetKey,
      "WORK_PACK_DOCUMENT_SOURCE_TARGET_INVALID",
      "Document output source-binding target key",
    ),
    rendererVersion,
    required: booleanValue(value.required),
    placements,
  };
}

function validateDocumentOutputs(
  input: unknown,
  sections: readonly CreditexWorkPackSection[],
  signerRoles: readonly CreditexWorkPackSignerRole[],
) {
  if (!Array.isArray(input) || input.length > 20) {
    return fail(
      "WORK_PACK_DOCUMENT_OUTPUTS_INVALID",
      "Document outputs must be a list of up to 20 governed PDFs.",
    );
  }
  const outputs = input.map(validateDocumentOutput).sort(
    (left, right) => compareText(left.outputKey, right.outputKey),
  );
  if (new Set(outputs.map((output) => output.outputKey)).size !== outputs.length) {
    return fail(
      "WORK_PACK_DOCUMENT_OUTPUT_KEY_DUPLICATE",
      "Document output keys must be unique.",
    );
  }
  const signaturePrompts = new Map(
    sections.flatMap((section) => section.prompts)
      .filter((prompt) => prompt.type === "signature")
      .map((prompt) => [prompt.promptKey, prompt] as const),
  );
  if (sections.some((section) =>
    section.repeatability
    && section.prompts.some((prompt) => prompt.type === "signature")
  )) {
    return fail(
      "WORK_PACK_REPEATABLE_SIGNATURE_UNSUPPORTED",
      "The v1 completed-PDF contract does not permit signature prompts in repeatable sections; use a non-repeatable governed signer step.",
    );
  }
  const signerRoleKeys = new Set(signerRoles.map((role) => role.roleKey));
  const signaturePlacements = outputs.flatMap((output) =>
    output.placements.filter((placement) => placement.kind === "signature")
  );
  const requiredOutputs = outputs.filter((output) => output.required);
  if (requiredOutputs.length !== 1) {
    return fail(
      "WORK_PACK_DOCUMENT_OUTPUT_REQUIRED",
      "Every work pack must have exactly one required immutable final PDF; use governed reference documents for supporting PDFs.",
    );
  }
  for (const placement of signaturePlacements) {
    const prompt = signaturePrompts.get(placement.signaturePromptKey);
    if (
      !prompt
      || prompt.signerRoleKey !== placement.signerRoleKey
      || !signerRoleKeys.has(placement.signerRoleKey)
    ) {
      return fail(
        "WORK_PACK_DOCUMENT_SIGNATURE_REFERENCE_INVALID",
        "Document signature placements must reference an exact declared signature prompt and signer role.",
      );
    }
  }
  for (const prompt of signaturePrompts.values()) {
    if (
      !outputs.some((output) =>
        output.required
        && output.placements.some((placement) =>
          placement.kind === "signature"
          && placement.signaturePromptKey === prompt.promptKey
          && placement.signerRoleKey === prompt.signerRoleKey
        )
      )
    ) {
      return fail(
        "WORK_PACK_SIGNATURE_DOCUMENT_PLACEMENT_REQUIRED",
        "Every signature prompt must have a placement in a required governed PDF output.",
      );
    }
  }
  return outputs;
}

function validateReferences(
  sections: readonly CreditexWorkPackSection[],
  dependencies: readonly CreditexWorkPackDependency[],
  stages: readonly CreditexWorkPackStage[],
  signerRoles: readonly CreditexWorkPackSignerRole[],
) {
  const dependencyKeys = new Set(
    dependencies.map((dependency) => dependency.dependencyKey),
  );
  const allPromptKeys = sections.flatMap((section) =>
    section.prompts.map((prompt) => prompt.promptKey)
  );
  if (new Set(allPromptKeys).size !== allPromptKeys.length) {
    return fail(
      "WORK_PACK_PROMPT_KEY_DUPLICATE",
      "Prompt keys must be unique across the work pack.",
    );
  }
  const stageKeys = new Set(stages.map((stage) => stage.stageKey));
  const signerRoleKeys = new Set(signerRoles.map((role) => role.roleKey));
  const globalPreceding = new Set<string>();
  for (const section of sections) {
    for (const condition of section.visibility?.conditions ?? []) {
      if (
        condition.scope !== "work_pack"
        || !globalPreceding.has(condition.promptKey)
      ) {
        return fail(
          "WORK_PACK_SECTION_CONDITION_FORWARD_REFERENCE",
          "Section visibility can only depend on non-repeatable prompts in earlier sections.",
        );
      }
    }
    const instancePreceding = new Set<string>();
    for (const prompt of section.prompts) {
      for (const condition of prompt.visibility?.conditions ?? []) {
        const referenceAvailable = condition.scope === "section_instance"
          ? Boolean(
              section.repeatability
              && instancePreceding.has(condition.promptKey)
            )
          : globalPreceding.has(condition.promptKey);
        if (!referenceAvailable) {
          return fail(
            "WORK_PACK_PROMPT_CONDITION_FORWARD_REFERENCE",
            "Prompt visibility can only depend on an earlier global or current-item prompt.",
          );
        }
      }
      if (
        prompt.dependencyKeys.some((key) => !dependencyKeys.has(key))
      ) {
        return fail(
          "WORK_PACK_PROMPT_DEPENDENCY_UNKNOWN",
          "Prompt dependencies must reference declared work-pack dependencies.",
        );
      }
      if (
        prompt.stageKey
        && !stageKeys.has(prompt.stageKey)
      ) {
        return fail(
          "WORK_PACK_PROMPT_STAGE_UNKNOWN",
          "Prompt stages must reference a declared work-pack stage.",
        );
      }
      if (
        ([
          "photo",
          "document",
          "reference_document",
          "signature",
        ].includes(prompt.type)
          || prompt.attestation)
        && !prompt.stageKey
      ) {
        return fail(
          "WORK_PACK_EVIDENCE_STAGE_REQUIRED",
          "Photo, document, reference-document and signature prompts need a governed capture stage.",
        );
      }
      if (
        prompt.type === "signature"
        && !signerRoleKeys.has(prompt.signerRoleKey)
      ) {
        return fail(
          "WORK_PACK_SIGNER_ROLE_UNKNOWN",
          "Signature prompts must reference a declared signer role.",
        );
      }
      instancePreceding.add(prompt.promptKey);
      if (!section.repeatability) globalPreceding.add(prompt.promptKey);
    }
  }
}

export function validateCreditexActivityWorkPack(
  input: unknown,
): CreditexActivityWorkPack {
  const value = objectValue(
    input,
    "WORK_PACK_INVALID",
    "The activity work pack must be an object.",
  );
  if (value.contract !== CREDITEX_ACTIVITY_WORK_PACK_CONTRACT) {
    return fail(
      "WORK_PACK_CONTRACT_INVALID",
      "The activity work-pack contract version is not supported.",
    );
  }
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 100) {
    return fail(
      "WORK_PACK_DEPENDENCIES_INVALID",
      "Work-pack dependencies must be a list of up to 100 items.",
    );
  }
  if (!Array.isArray(value.stages) || value.stages.length < 1
    || value.stages.length > 50) {
    return fail(
      "WORK_PACK_STAGES_INVALID",
      "A work pack needs 1 to 50 governed capture stages.",
    );
  }
  if (!Array.isArray(value.signerRoles) || value.signerRoles.length > 50) {
    return fail(
      "WORK_PACK_SIGNER_ROLES_INVALID",
      "Work-pack signer roles must be a list of up to 50 items.",
    );
  }
  if (!Array.isArray(value.sections) || value.sections.length < 1
    || value.sections.length > 50) {
    return fail(
      "WORK_PACK_SECTIONS_INVALID",
      "A work pack needs 1 to 50 sections.",
    );
  }
  const dependencies = value.dependencies.map(validateDependency).sort(
    (left, right) => compareText(left.dependencyKey, right.dependencyKey),
  );
  if (
    new Set(dependencies.map((dependency) => dependency.dependencyKey)).size
      !== dependencies.length
  ) {
    return fail(
      "WORK_PACK_DEPENDENCY_KEY_DUPLICATE",
      "Dependency keys must be unique.",
    );
  }
  const stages = value.stages.map(validateStage).sort(
    (left, right) => left.order - right.order
      || compareText(left.stageKey, right.stageKey),
  );
  if (
    new Set(stages.map((stage) => stage.stageKey)).size !== stages.length
    || new Set(stages.map((stage) => stage.order)).size !== stages.length
  ) {
    return fail(
      "WORK_PACK_STAGE_DUPLICATE",
      "Stage keys and stage order must be unique.",
    );
  }
  const signerRoles = value.signerRoles.map(validateSignerRole).sort(
    (left, right) => compareText(left.roleKey, right.roleKey),
  );
  if (new Set(signerRoles.map((role) => role.roleKey)).size
    !== signerRoles.length) {
    return fail(
      "WORK_PACK_SIGNER_ROLE_DUPLICATE",
      "Signer role keys must be unique.",
    );
  }
  const sections = value.sections.map(validateSection).sort(
    (left, right) => left.order - right.order
      || compareText(left.sectionKey, right.sectionKey),
  );
  if (
    new Set(sections.map((section) => section.sectionKey)).size
      !== sections.length
  ) {
    return fail(
      "WORK_PACK_SECTION_KEY_DUPLICATE",
      "Section keys must be unique.",
    );
  }
  if (new Set(sections.map((section) => section.order)).size
    !== sections.length) {
    return fail(
      "WORK_PACK_SECTION_ORDER_DUPLICATE",
      "Section order must be unique.",
    );
  }
  const repeatableItemKeys = sections.flatMap((section) =>
    section.repeatability ? [section.repeatability.itemKey] : []
  );
  if (new Set(repeatableItemKeys).size !== repeatableItemKeys.length) {
    return fail(
      "WORK_PACK_REPEATABLE_ITEM_KEY_DUPLICATE",
      "Repeatable item keys must be unique across the work pack.",
    );
  }
  if (sections.reduce((count, section) => count + section.prompts.length, 0)
    > 500) {
    return fail(
      "WORK_PACK_PROMPT_LIMIT_EXCEEDED",
      "A work pack can contain up to 500 prompts.",
    );
  }
  const documentOutputs = validateDocumentOutputs(
    value.documentOutputs,
    sections,
    signerRoles,
  );
  validateReferences(sections, dependencies, stages, signerRoles);
  const effectiveFrom = dateValue(
    value.effectiveFrom,
    "WORK_PACK_EFFECTIVE_FROM_INVALID",
    "Effective-from date",
  );
  const effectiveTo = optionalDateValue(
    value.effectiveTo,
    "WORK_PACK_EFFECTIVE_TO_INVALID",
    "Effective-to date",
  );
  if (effectiveTo && effectiveTo < effectiveFrom) {
    return fail(
      "WORK_PACK_EFFECTIVE_RANGE_INVALID",
      "Effective-to date cannot be before effective-from date.",
    );
  }
  return deepFreeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
    activityTemplateId: keyValue(
      value.activityTemplateId,
      "WORK_PACK_ACTIVITY_TEMPLATE_INVALID",
      "Activity template ID",
    ),
    version: integerValue(
      value.version,
      1,
      1_000_000,
      "WORK_PACK_VERSION_INVALID",
      "Work-pack version",
    ),
    title: textValue(
      value.title,
      240,
      "WORK_PACK_TITLE_INVALID",
      "Work-pack title",
    ),
    effectiveFrom,
    effectiveTo,
    catalogueReviewedOn: dateValue(
      value.catalogueReviewedOn,
      "WORK_PACK_CATALOGUE_DATE_INVALID",
      "Catalogue reviewed date",
    ),
    stages,
    signerRoles,
    dependencies,
    sections,
    documentOutputs,
  });
}

export function creditexActivityWorkPackSha256(input: unknown) {
  return creditexCanonicalSha256(validateCreditexActivityWorkPack(input));
}

export function createCreditexActivityWorkPackVersionIdentity(input: {
  organisationId: string;
  activityVersionId: string;
  workPack: unknown;
}) {
  const workPack = validateCreditexActivityWorkPack(input.workPack);
  const core = Object.freeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_VERSION_IDENTITY_CONTRACT,
    organisationId: textValue(
      input.organisationId,
      180,
      "WORK_PACK_ORGANISATION_INVALID",
      "Organisation ID",
    ),
    activityVersionId: textValue(
      input.activityVersionId,
      180,
      "WORK_PACK_ACTIVITY_VERSION_INVALID",
      "Activity version ID",
    ),
    activityTemplateId: workPack.activityTemplateId,
    version: workPack.version,
    effectiveFrom: workPack.effectiveFrom,
    effectiveTo: workPack.effectiveTo,
    schemaSha256: creditexCanonicalSha256(workPack),
  });
  return deepFreeze({
    ...core,
    identitySha256: creditexCanonicalSha256(core),
  });
}

export function emptyCreditexActivityWorkPackResponse(
  workPackInput: unknown,
): CreditexActivityWorkPackResponse {
  const workPack = validateCreditexActivityWorkPack(workPackInput);
  return deepFreeze({
    contract: CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT,
    schemaSha256: creditexCanonicalSha256(workPack),
    answers: {},
    repeatableSections: Object.fromEntries(
      workPack.sections
        .filter((section) => section.repeatability)
        .map((section) => [section.sectionKey, []]),
    ),
    dependencyResolutions: {},
  });
}

function hasAnswer(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function scalarEquals(left: unknown, right: unknown) {
  return typeof left === typeof right && left === right;
}

function conditionMatches(
  condition: CreditexWorkPackCondition,
  answers: Readonly<Record<string, unknown>>,
  instanceAnswers: Readonly<Record<string, unknown>>,
) {
  const answer = condition.scope === "section_instance"
    ? instanceAnswers[condition.promptKey]
    : answers[condition.promptKey];
  if (condition.operator === "answered") return hasAnswer(answer);
  if (condition.operator === "not_answered") return !hasAnswer(answer);
  if (condition.operator === "equals") {
    return scalarEquals(answer, condition.value);
  }
  if (condition.operator === "not_equals") {
    return !scalarEquals(answer, condition.value);
  }
  if (condition.operator === "in" || condition.operator === "not_in") {
    const expected = condition.value as readonly CreditexWorkPackConditionValue[];
    const matched = Array.isArray(answer)
      ? answer.some((item) => expected.some((value) => scalarEquals(item, value)))
      : expected.some((value) => scalarEquals(answer, value));
    return condition.operator === "in" ? matched : !matched;
  }
  if (condition.operator === "contains") {
    const matched = Array.isArray(answer)
      ? answer.some((item) => scalarEquals(item, condition.value))
      : typeof answer === "string"
        && typeof condition.value === "string"
        && answer.includes(condition.value);
    return matched;
  }
  if (typeof answer !== "number" || typeof condition.value !== "number") {
    return false;
  }
  if (condition.operator === "greater_than") return answer > condition.value;
  if (condition.operator === "greater_than_or_equal") {
    return answer >= condition.value;
  }
  if (condition.operator === "less_than") return answer < condition.value;
  return answer <= condition.value;
}

export function creditexActivityWorkPackVisibilityMatches(
  visibility: CreditexWorkPackVisibility | null,
  answers: Readonly<Record<string, unknown>>,
  instanceAnswers: Readonly<Record<string, unknown>> = {},
) {
  if (!visibility) return true;
  const results = visibility.conditions.map((condition) =>
    conditionMatches(condition, answers, instanceAnswers)
  );
  return visibility.match === "all"
    ? results.every(Boolean)
    : results.some(Boolean);
}

function answerMatchesPrompt(
  prompt: CreditexWorkPackPrompt,
  answer: unknown,
  signerRoleByKey: ReadonlyMap<string, CreditexWorkPackSignerRole>,
) {
  if (prompt.type === "reference_document") {
    const reference = prompt.referenceDocument;
    if (!reference) return false;
    if (reference.acknowledgementMode === "none") return true;
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      return false;
    }
    const acknowledgement = answer as Record<string, unknown>;
    return acknowledgement.contract
        === CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT
      && acknowledgement.sourceBindingTargetKey
        === reference.sourceBindingTargetKey
      && typeof acknowledgement.sourceArtifactId === "string"
      && acknowledgement.sourceArtifactId.length > 0
      && typeof acknowledgement.sourceArtifactSha256 === "string"
      && /^[0-9a-f]{64}$/.test(acknowledgement.sourceArtifactSha256)
      && acknowledgement.acknowledgementMode
        === reference.acknowledgementMode
      && acknowledgement.acknowledged === true
      && typeof acknowledgement.acknowledgedAt === "string"
      && validIsoDateTime(acknowledgement.acknowledgedAt);
  }
  if (!hasAnswer(answer)) return false;
  if (prompt.type === "text" || prompt.type === "textarea") {
    if (typeof answer !== "string") return false;
    if (prompt.minimumLength !== null && answer.length < prompt.minimumLength) {
      return false;
    }
    return prompt.maximumLength === null || answer.length <= prompt.maximumLength;
  }
  if (prompt.type === "number") {
    if (typeof answer !== "number" || !Number.isFinite(answer)) return false;
    if (prompt.minimumNumber !== null && answer < prompt.minimumNumber) {
      return false;
    }
    if (prompt.maximumNumber !== null && answer > prompt.maximumNumber) {
      return false;
    }
    if (prompt.numberStep !== null) {
      const origin = prompt.minimumNumber ?? 0;
      const quotient = (answer - origin) / prompt.numberStep;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) return false;
    }
    return true;
  }
  if (prompt.type === "date") {
    return typeof answer === "string" && validIsoDate(answer);
  }
  if (prompt.type === "select") {
    return typeof answer === "string"
      && prompt.options.some((option) => option.value === answer);
  }
  if (prompt.type === "multiselect") {
    if (!Array.isArray(answer)
      || answer.some((item) => typeof item !== "string")) return false;
    const values = answer as string[];
    if (new Set(values).size !== values.length) return false;
    if (
      prompt.minimumSelections !== null
      && values.length < prompt.minimumSelections
    ) return false;
    if (
      prompt.maximumSelections !== null
      && values.length > prompt.maximumSelections
    ) return false;
    return values.every((item) =>
      prompt.options.some((option) => option.value === item)
    );
  }
  if (prompt.type === "checkbox") return answer === true;
  if (prompt.type === "signature") {
    const role = signerRoleByKey.get(prompt.signerRoleKey);
    return Boolean(
      role
      && Array.isArray(answer)
      && answer.length >= role.minimumSignatures
      && answer.length <= role.maximumSignatures
      && answer.every((item) => typeof item === "string" && item.length > 0)
      && new Set(answer).size === answer.length,
    );
  }
  if (!Array.isArray(answer) || answer.some((item) => typeof item !== "string")) {
    return false;
  }
  const requirement = prompt.fileRequirement;
  return Boolean(
    requirement
    && answer.length >= requirement.minimumCount
    && answer.length <= requirement.maximumCount
    && new Set(answer).size === answer.length,
  );
}

export function creditexActivityWorkPackCompletion(input: {
  workPack: unknown;
  response: CreditexActivityWorkPackResponse;
}): CreditexActivityWorkPackCompletion {
  const workPack = validateCreditexActivityWorkPack(input.workPack);
  const blockers: Array<{ code: string; key: string; message: string }> = [];
  if (input.response.contract !== CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT) {
    blockers.push({
      code: "WORK_PACK_RESPONSE_CONTRACT_INVALID",
      key: "response",
      message: "The response contract does not match this work-pack engine.",
    });
  }
  const schemaSha256 = creditexCanonicalSha256(workPack);
  if (input.response.schemaSha256 !== schemaSha256) {
    blockers.push({
      code: "WORK_PACK_RESPONSE_SCHEMA_MISMATCH",
      key: "schemaSha256",
      message: "The response is not bound to this exact work-pack version.",
    });
  }
  for (const dependency of workPack.dependencies) {
    if (!dependency.required) continue;
    const resolution = input.response.dependencyResolutions[
      dependency.dependencyKey
    ];
    if (
      resolution?.status !== "resolved"
      || resolution.referenceIds.length < 1
      || !/^sha256:[0-9a-f]{64}$/.test(resolution.snapshotSha256)
    ) {
      blockers.push({
        code: "WORK_PACK_DEPENDENCY_UNRESOLVED",
        key: dependency.dependencyKey,
        message: `${dependency.label} must be resolved against its governed source.`,
      });
    }
  }
  const visiblePromptKeys: string[] = [];
  const requiredPromptKeys: string[] = [];
  const completedPromptKeys: string[] = [];
  const signerRoleByKey = new Map(
    workPack.signerRoles.map((role) => [role.roleKey, role]),
  );
  for (const section of workPack.sections) {
    if (!creditexActivityWorkPackVisibilityMatches(
      section.visibility,
      input.response.answers,
    )) continue;
    const instances = section.repeatability
      ? input.response.repeatableSections?.[section.sectionKey] ?? []
      : [{ instanceKey: "", answers: input.response.answers }];
    if (section.repeatability) {
      const instanceKeys = instances.map((instance) => instance.instanceKey);
      if (
        instances.length < section.repeatability.minimumInstances
        || instances.length > section.repeatability.maximumInstances
        || new Set(instanceKeys).size !== instanceKeys.length
        || instanceKeys.some((key) => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$/.test(key))
      ) {
        blockers.push({
          code: "WORK_PACK_REPEATABLE_SECTION_INVALID",
          key: section.sectionKey,
          message: `${section.title} needs ${section.repeatability.minimumInstances} to ${section.repeatability.maximumInstances} uniquely identified items.`,
        });
      }
    }
    for (const instance of instances) {
      for (const prompt of section.prompts) {
        if (!creditexActivityWorkPackVisibilityMatches(
          prompt.visibility,
          input.response.answers,
          instance.answers,
        )) continue;
        const responseKey = section.repeatability
          ? `${section.sectionKey}[${instance.instanceKey}].${prompt.promptKey}`
          : prompt.promptKey;
        visiblePromptKeys.push(responseKey);
        if (prompt.required) requiredPromptKeys.push(responseKey);
        const answer = instance.answers[prompt.promptKey];
        if (answerMatchesPrompt(prompt, answer, signerRoleByKey)) {
          completedPromptKeys.push(responseKey);
        } else if (prompt.required) {
          blockers.push({
            code: "WORK_PACK_REQUIRED_PROMPT_INCOMPLETE",
            key: responseKey,
            message: `${prompt.label} is required.`,
          });
        }
      }
    }
  }
  return deepFreeze({
    ready: blockers.length === 0 && requiredPromptKeys.length > 0,
    visiblePromptKeys,
    requiredPromptKeys,
    completedPromptKeys,
    blockers,
  });
}
