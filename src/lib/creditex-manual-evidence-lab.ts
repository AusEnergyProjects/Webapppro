import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type GovernmentActivityTemplate,
} from "./australian-government-program-catalogue.ts";

export const CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT =
  "creditex-manual-evidence-form-v1";
export const CREDITEX_MANUAL_EVIDENCE_JOB_CONTRACT =
  "creditex-manual-evidence-job-v1";

export const MANUAL_EVIDENCE_FIELD_TYPES = [
  "photo",
  "document",
  "text",
  "number",
  "select",
  "checkbox",
  "date",
  "signature",
] as const;

export const MANUAL_EVIDENCE_CAPTURE_TIMINGS = [
  "before_install",
  "during_install",
  "after_install",
  "any_time",
] as const;

export const MANUAL_EVIDENCE_FIELD_ORIGINS = [
  "creditex_operational_test",
  "government_requirement_candidate",
] as const;

export const MANUAL_EVIDENCE_RESPONSE_OUTCOMES = [
  "not_started",
  "provided",
  "not_applicable",
  "issue",
] as const;

export type ManualEvidenceFieldType =
  typeof MANUAL_EVIDENCE_FIELD_TYPES[number];
export type ManualEvidenceCaptureTiming =
  typeof MANUAL_EVIDENCE_CAPTURE_TIMINGS[number];
export type ManualEvidenceFieldOrigin =
  typeof MANUAL_EVIDENCE_FIELD_ORIGINS[number];
export type ManualEvidenceResponseOutcome =
  typeof MANUAL_EVIDENCE_RESPONSE_OUTCOMES[number];

export type ManualEvidenceSource = {
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  clause: string;
};

export type ManualEvidenceField = {
  fieldCode: string;
  label: string;
  instructions: string;
  fieldType: ManualEvidenceFieldType;
  captureTiming: ManualEvidenceCaptureTiming;
  origin: ManualEvidenceFieldOrigin;
  required: boolean;
  minimumCount: number;
  maximumCount: number;
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  options: string[];
  allowedContentTypes: string[];
  source: ManualEvidenceSource | null;
};

export type ManualEvidenceFormSchema = {
  contract: typeof CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT;
  catalogueReviewedOn: string;
  fields: ManualEvidenceField[];
};

export type ManualEvidenceCapture = {
  captureId: string;
  fileName: string;
  contentType: string;
  originalPresent: boolean;
  metadataPresent: boolean;
  gpsPresent: boolean;
  captureTimePresent: boolean;
  originalSha256: string;
  deviceId: string;
  capturedAt: string;
  verificationState: "manual_metadata_only" | "server_verified";
  physicalDeviceState: "not_assessed" | "reported_physical" | "reported_emulator";
};

export type ManualEvidenceResponse = {
  fieldCode: string;
  outcome: ManualEvidenceResponseOutcome;
  value: string;
  captures: ManualEvidenceCapture[];
  note: string;
};

export class CreditexManualEvidenceContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreditexManualEvidenceContractError";
    this.code = code;
  }
}

const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const ALLOWED_CONTENT_TYPES: Set<string> = new Set([
  ...IMAGE_CONTENT_TYPES,
  ...DOCUMENT_CONTENT_TYPES,
]);

function normalText(value: unknown, maximum: number) {
  return String(value || "").trim().slice(0, maximum);
}

function requiredText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  const cleaned = normalText(value, maximum);
  if (!cleaned) {
    throw new CreditexManualEvidenceContractError(
      code,
      `${label} is required.`,
    );
  }
  return cleaned;
}

function fieldCode(value: unknown) {
  const cleaned = requiredText(
    value,
    80,
    "MANUAL_EVIDENCE_FIELD_CODE_REQUIRED",
    "Field code",
  ).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(cleaned)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FIELD_CODE_INVALID",
      "Field codes must use 2 to 80 lowercase letters, numbers, hyphens or underscores.",
    );
  }
  return cleaned;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
  label: string,
) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number)
    || number < minimum
    || number > maximum
  ) {
    throw new CreditexManualEvidenceContractError(
      code,
      `${label} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return number;
}

function booleanValue(value: unknown) {
  return value === true;
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function sourceRecord(
  value: unknown,
  origin: ManualEvidenceFieldOrigin,
): ManualEvidenceSource | null {
  if (origin === "creditex_operational_test") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_SOURCE_REQUIRED",
      "Candidate government requirements need an exact official source.",
    );
  }
  const source = value as Record<string, unknown>;
  const officialSourceUrl = requiredText(
    source.officialSourceUrl,
    1_000,
    "MANUAL_EVIDENCE_SOURCE_URL_REQUIRED",
    "Official source URL",
  );
  let parsed: URL;
  try {
    parsed = new URL(officialSourceUrl);
  } catch {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_SOURCE_URL_INVALID",
      "The official source URL is invalid.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_SOURCE_URL_INVALID",
      "Official source URLs must use HTTPS.",
    );
  }
  const officialSourceSha256 = requiredText(
    source.officialSourceSha256,
    64,
    "MANUAL_EVIDENCE_SOURCE_HASH_REQUIRED",
    "Official source SHA-256",
  ).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(officialSourceSha256)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_SOURCE_HASH_INVALID",
      "Official source SHA-256 must contain exactly 64 hexadecimal characters.",
    );
  }
  return {
    officialSourceUrl,
    officialSourceTitle: requiredText(
      source.officialSourceTitle,
      240,
      "MANUAL_EVIDENCE_SOURCE_TITLE_REQUIRED",
      "Official source title",
    ),
    officialSourceVersion: requiredText(
      source.officialSourceVersion,
      120,
      "MANUAL_EVIDENCE_SOURCE_VERSION_REQUIRED",
      "Official source version",
    ),
    officialSourceSha256,
    clause: requiredText(
      source.clause,
      240,
      "MANUAL_EVIDENCE_SOURCE_CLAUSE_REQUIRED",
      "Source clause or page",
    ),
  };
}

export function manualEvidenceActivity(activityTemplateId: string) {
  return GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (activity) => activity.templateId === activityTemplateId,
  ) || null;
}

export function manualEvidenceProgram(programCode: string) {
  return GOVERNMENT_PROGRAM_TEMPLATES.find(
    (program) => program.programCode === programCode,
  ) || null;
}

function starterField(
  field: Omit<
    ManualEvidenceField,
    "origin" | "options" | "source"
  > & Partial<Pick<ManualEvidenceField, "options">>,
): ManualEvidenceField {
  return {
    ...field,
    origin: "creditex_operational_test",
    options: field.options || [],
    source: null,
  };
}

function existingAssetLabel(activity: GovernmentActivityTemplate) {
  if (
    ["heating-cooling", "hot-water", "electrical", "plumbing", "controls"]
      .includes(activity.serviceCategory)
  ) {
    return "Existing appliance or equipment model plate";
  }
  if (
    ["solar", "battery", "ev-charging", "mounting-hardware"]
      .includes(activity.serviceCategory)
  ) {
    return "Existing system, switchboard or installation label";
  }
  if (
    ["insulation", "glazing", "window-coverings", "draught-proofing"]
      .includes(activity.serviceCategory)
  ) {
    return "Existing condition and measurement reference";
  }
  return "Existing site or equipment reference";
}

function completionLabel(activity: GovernmentActivityTemplate) {
  if (activity.serviceCategory === "assessment") {
    return "Completed assessment output";
  }
  if (
    ["insulation", "glazing", "window-coverings", "draught-proofing"]
      .includes(activity.serviceCategory)
  ) {
    return "Completed work and measurement reference";
  }
  return "Completed installation and installed product";
}

export function starterManualEvidenceForm(
  activity: GovernmentActivityTemplate,
): ManualEvidenceFormSchema {
  const fields: ManualEvidenceField[] = [
    starterField({
      fieldCode: "site_context_before",
      label: "Site context before work",
      instructions:
        "Capture a clear wide photo showing the work area before anything is removed or altered.",
      fieldType: "photo",
      captureTiming: "before_install",
      required: true,
      minimumCount: 1,
      maximumCount: 3,
      originalRequired: true,
      metadataRequired: true,
      gpsRequired: true,
      allowedContentTypes: [...IMAGE_CONTENT_TYPES],
    }),
    starterField({
      fieldCode: "existing_asset_reference",
      label: existingAssetLabel(activity),
      instructions:
        "Capture the identifying label, model, serial or measured existing condition in focus. This is an editable Creditex operational test prompt, not a government rule transcription.",
      fieldType: "photo",
      captureTiming: "before_install",
      required: true,
      minimumCount: 1,
      maximumCount: 3,
      originalRequired: true,
      metadataRequired: true,
      gpsRequired: true,
      allowedContentTypes: [...IMAGE_CONTENT_TYPES],
    }),
    starterField({
      fieldCode: "work_in_progress",
      label: "Work in progress",
      instructions:
        "Capture the installation or activity while key components remain visible for review.",
      fieldType: "photo",
      captureTiming: "during_install",
      required: true,
      minimumCount: 1,
      maximumCount: 4,
      originalRequired: true,
      metadataRequired: true,
      gpsRequired: true,
      allowedContentTypes: [...IMAGE_CONTENT_TYPES],
    }),
    starterField({
      fieldCode: "completed_work",
      label: completionLabel(activity),
      instructions:
        "Capture a clear overview after completion and any installed model, serial or compliance label.",
      fieldType: "photo",
      captureTiming: "after_install",
      required: true,
      minimumCount: 1,
      maximumCount: 5,
      originalRequired: true,
      metadataRequired: true,
      gpsRequired: true,
      allowedContentTypes: [...IMAGE_CONTENT_TYPES],
    }),
    starterField({
      fieldCode: "completion_document",
      label: "Completion or commissioning document",
      instructions:
        "Attach the relevant completion, commissioning, assessment or compliance document for this manual test.",
      fieldType: "document",
      captureTiming: "after_install",
      required: true,
      minimumCount: 1,
      maximumCount: 3,
      originalRequired: true,
      metadataRequired: false,
      gpsRequired: false,
      allowedContentTypes: [...DOCUMENT_CONTENT_TYPES],
    }),
  ];

  if (activity.serviceCategory !== "assessment") {
    fields.push(starterField({
      fieldCode: "installer_declaration",
      label: "Installer completion declaration",
      instructions:
        "Confirm the manual test work matches the selected activity and the evidence shown is complete.",
      fieldType: "checkbox",
      captureTiming: "after_install",
      required: true,
      minimumCount: 1,
      maximumCount: 1,
      originalRequired: false,
      metadataRequired: false,
      gpsRequired: false,
      allowedContentTypes: [],
    }));
  }

  return {
    contract: CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
    catalogueReviewedOn: GOVERNMENT_CATALOGUE_REVIEWED_ON,
    fields,
  };
}

export function validateManualEvidenceField(
  input: unknown,
): ManualEvidenceField {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FIELD_INVALID",
      "Each evidence prompt must be an object.",
    );
  }
  const value = input as Record<string, unknown>;
  const type = normalText(value.fieldType, 40) as ManualEvidenceFieldType;
  if (!MANUAL_EVIDENCE_FIELD_TYPES.includes(type)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FIELD_TYPE_INVALID",
      "Choose a supported evidence field type.",
    );
  }
  const timing = normalText(
    value.captureTiming,
    40,
  ) as ManualEvidenceCaptureTiming;
  if (!MANUAL_EVIDENCE_CAPTURE_TIMINGS.includes(timing)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_TIMING_INVALID",
      "Choose a supported capture timing.",
    );
  }
  const origin = normalText(
    value.origin,
    60,
  ) as ManualEvidenceFieldOrigin;
  if (!MANUAL_EVIDENCE_FIELD_ORIGINS.includes(origin)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_ORIGIN_INVALID",
      "Choose Creditex operational test or government requirement candidate.",
    );
  }
  const minimumCount = integer(
    value.minimumCount,
    0,
    20,
    "MANUAL_EVIDENCE_MINIMUM_INVALID",
    "Minimum count",
  );
  const maximumCount = integer(
    value.maximumCount,
    0,
    20,
    "MANUAL_EVIDENCE_MAXIMUM_INVALID",
    "Maximum count",
  );
  if (maximumCount !== 0 && maximumCount < minimumCount) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_COUNT_RANGE_INVALID",
      "Maximum count must be zero for no limit or at least the minimum count.",
    );
  }
  if (
    booleanValue(value.required)
    && (type === "photo" || type === "document")
    && minimumCount < 1
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_REQUIRED_CAPTURE_MINIMUM_INVALID",
      "Required photo and document prompts need at least one capture.",
    );
  }
  const options = Array.isArray(value.options)
    ? value.options.map((option) => normalText(option, 120)).filter(Boolean)
    : [];
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_OPTIONS_DUPLICATE",
      "Dropdown options must be unique.",
    );
  }
  if (type === "select" && (options.length < 2 || options.length > 25)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_OPTIONS_INVALID",
      "Dropdown prompts need 2 to 25 options.",
    );
  }
  const allowedContentTypes = Array.isArray(value.allowedContentTypes)
    ? value.allowedContentTypes
      .map((contentType) => normalText(contentType, 120).toLowerCase())
      .filter(Boolean)
    : [];
  if (
    allowedContentTypes.some(
      (contentType) => !ALLOWED_CONTENT_TYPES.has(contentType),
    )
    || new Set(allowedContentTypes).size !== allowedContentTypes.length
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_CONTENT_TYPES_INVALID",
      "Choose supported, unique file types.",
    );
  }
  if (
    (type === "photo" || type === "document")
    && allowedContentTypes.length === 0
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_CONTENT_TYPES_REQUIRED",
      "Photo and document prompts need at least one allowed file type.",
    );
  }
  if (
    type === "photo"
    && allowedContentTypes.some(
      (contentType) => !IMAGE_CONTENT_TYPES.includes(
        contentType as typeof IMAGE_CONTENT_TYPES[number],
      ),
    )
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_PHOTO_CONTENT_TYPE_INVALID",
      "Photo prompts can only accept supported image file types.",
    );
  }
  if (
    type !== "photo"
    && type !== "document"
    && allowedContentTypes.length > 0
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_CONTENT_TYPES_NOT_ALLOWED",
      "Only photo and document prompts can accept files.",
    );
  }
  if (
    type !== "photo"
    && type !== "document"
    && (minimumCount > 1 || maximumCount !== 1)
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_NON_FILE_COUNT_INVALID",
      "Non-file prompts must use a maximum count of one and a minimum count of zero or one.",
    );
  }
  if (
    type !== "photo"
    && (
      booleanValue(value.metadataRequired)
      || booleanValue(value.gpsRequired)
    )
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_METADATA_TYPE_INVALID",
      "Metadata and GPS checks can only be required for photo prompts.",
    );
  }
  if (
    type !== "photo"
    && type !== "document"
    && booleanValue(value.originalRequired)
  ) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_ORIGINAL_TYPE_INVALID",
      "Original-file checks can only be required for photo and document prompts.",
    );
  }
  return {
    fieldCode: fieldCode(value.fieldCode),
    label: requiredText(
      value.label,
      180,
      "MANUAL_EVIDENCE_LABEL_REQUIRED",
      "Installer-facing label",
    ),
    instructions: requiredText(
      value.instructions,
      1_200,
      "MANUAL_EVIDENCE_INSTRUCTIONS_REQUIRED",
      "Capture instructions",
    ),
    fieldType: type,
    captureTiming: timing,
    origin,
    required: booleanValue(value.required),
    minimumCount,
    maximumCount,
    originalRequired: booleanValue(value.originalRequired),
    metadataRequired: booleanValue(value.metadataRequired),
    gpsRequired: booleanValue(value.gpsRequired),
    options,
    allowedContentTypes,
    source: sourceRecord(value.source, origin),
  };
}

export function validateManualEvidenceFormSchema(
  input: unknown,
): ManualEvidenceFormSchema {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FORM_INVALID",
      "The evidence form is invalid.",
    );
  }
  const value = input as Record<string, unknown>;
  if (value.contract !== CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FORM_CONTRACT_INVALID",
      "The evidence form contract version is not supported.",
    );
  }
  if (!Array.isArray(value.fields) || value.fields.length < 1) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FORM_EMPTY",
      "Add at least one evidence prompt.",
    );
  }
  if (value.fields.length > 40) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FORM_TOO_LARGE",
      "A manual evidence form can contain up to 40 prompts.",
    );
  }
  const fields = value.fields.map(validateManualEvidenceField);
  const codes = fields.map((field) => field.fieldCode);
  if (new Set(codes).size !== codes.length) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_FIELD_CODE_DUPLICATE",
      "Every evidence prompt needs a unique field code.",
    );
  }
  return {
    contract: CREDITEX_MANUAL_EVIDENCE_FORM_CONTRACT,
    catalogueReviewedOn: requiredText(
      value.catalogueReviewedOn,
      10,
      "MANUAL_EVIDENCE_CATALOGUE_DATE_REQUIRED",
      "Catalogue reviewed date",
    ),
    fields,
  };
}

export function validateManualEvidenceResponses(
  fields: readonly ManualEvidenceField[],
  input: unknown,
): ManualEvidenceResponse[] {
  if (!Array.isArray(input)) {
    throw new CreditexManualEvidenceContractError(
      "MANUAL_EVIDENCE_RESPONSES_INVALID",
      "Manual evidence responses must be a list.",
    );
  }
  const knownFields = new Map(fields.map((field) => [field.fieldCode, field]));
  const seen = new Set<string>();
  return input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_INVALID",
        "Each manual evidence response must be an object.",
      );
    }
    const value = item as Record<string, unknown>;
    const code = fieldCode(value.fieldCode);
    const field = knownFields.get(code);
    if (!field || seen.has(code)) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_FIELD_INVALID",
        "Manual evidence responses must reference each form prompt at most once.",
      );
    }
    seen.add(code);
    const outcome = normalText(
      value.outcome,
      40,
    ) as ManualEvidenceResponseOutcome;
    if (!MANUAL_EVIDENCE_RESPONSE_OUTCOMES.includes(outcome)) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_OUTCOME_INVALID",
        "Choose a supported response outcome.",
      );
    }
    const captures: ManualEvidenceCapture[] = Array.isArray(value.captures)
      ? value.captures.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new CreditexManualEvidenceContractError(
              "MANUAL_EVIDENCE_CAPTURE_INVALID",
              `${field.label} contains an invalid test capture.`,
            );
          }
          const captureValue = item as Record<string, unknown>;
          const contentType = normalText(
            captureValue.contentType,
            120,
          ).toLowerCase();
          if (
            contentType
            && !field.allowedContentTypes.includes(contentType)
          ) {
            throw new CreditexManualEvidenceContractError(
              "MANUAL_EVIDENCE_RESPONSE_CONTENT_TYPE_INVALID",
              `${field.label} does not allow that file type.`,
            );
          }
          return {
            captureId: normalText(captureValue.captureId, 180),
            fileName: normalText(captureValue.fileName, 240),
            contentType,
            originalPresent: booleanValue(captureValue.originalPresent),
            metadataPresent: booleanValue(captureValue.metadataPresent),
            gpsPresent: booleanValue(captureValue.gpsPresent),
            captureTimePresent: booleanValue(
              captureValue.captureTimePresent,
            ),
            originalSha256: normalText(
              captureValue.originalSha256,
              64,
            ).toLowerCase(),
            deviceId: normalText(captureValue.deviceId, 120),
            capturedAt: normalText(captureValue.capturedAt, 60),
            verificationState:
              captureValue.verificationState === "server_verified"
                ? "server_verified"
                : "manual_metadata_only",
            physicalDeviceState:
              captureValue.physicalDeviceState === "reported_physical"
                ? "reported_physical"
                : captureValue.physicalDeviceState === "reported_emulator"
                  ? "reported_emulator"
                  : "not_assessed",
          };
        })
      : [];
    if (captures.length > 20) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_CAPTURE_LIMIT_EXCEEDED",
        `${field.label} can contain up to 20 test captures.`,
      );
    }
    if (
      field.maximumCount !== 0
      && captures.length > field.maximumCount
    ) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_CAPTURE_MAXIMUM_EXCEEDED",
        `${field.label} allows up to ${field.maximumCount} captures.`,
      );
    }
    const response: ManualEvidenceResponse = {
      fieldCode: code,
      outcome,
      value: normalText(value.value, 2_000),
      captures,
      note: normalText(value.note, 1_200),
    };
    if (field.fieldType === "select" && response.value) {
      if (!field.options.includes(response.value)) {
        throw new CreditexManualEvidenceContractError(
          "MANUAL_EVIDENCE_RESPONSE_OPTION_INVALID",
          `${field.label} must use one of the configured dropdown options.`,
        );
      }
    }
    if (
      field.fieldType === "checkbox"
      && response.value
      && response.value !== "Yes"
      && response.value !== "No"
    ) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_CHECKBOX_INVALID",
        `${field.label} must use Yes or No.`,
      );
    }
    if (
      field.fieldType === "number"
      && response.value
      && !Number.isFinite(Number(response.value))
    ) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_NUMBER_INVALID",
        `${field.label} must contain a valid number.`,
      );
    }
    if (
      field.fieldType === "date"
      && response.value
      && !validIsoDate(response.value)
    ) {
      throw new CreditexManualEvidenceContractError(
        "MANUAL_EVIDENCE_RESPONSE_DATE_INVALID",
        `${field.label} must contain a valid date.`,
      );
    }
    return response;
  });
}

function captureComplete(
  field: ManualEvidenceField,
  capture: ManualEvidenceCapture,
) {
  if (capture.verificationState !== "server_verified") return false;
  if (capture.physicalDeviceState !== "reported_physical") return false;
  if (
    !capture.captureId
    || !/^[0-9a-f]{64}$/.test(capture.originalSha256)
    || !capture.deviceId
    || !Number.isFinite(Date.parse(capture.capturedAt))
  ) return false;
  if (!capture.fileName || !capture.contentType) return false;
  if (!field.allowedContentTypes.includes(capture.contentType)) return false;
  if (field.originalRequired && !capture.originalPresent) return false;
  if (field.metadataRequired && !capture.metadataPresent) return false;
  if (field.gpsRequired && !capture.gpsPresent) return false;
  if (field.fieldType === "photo" && !capture.captureTimePresent) return false;
  return true;
}

function responseComplete(
  field: ManualEvidenceField,
  response: ManualEvidenceResponse | undefined,
) {
  if (!response || response.outcome !== "provided") return false;
  if (field.fieldType === "photo" || field.fieldType === "document") {
    if (response.captures.length < field.minimumCount) return false;
    if (
      field.maximumCount !== 0
      && response.captures.length > field.maximumCount
    ) return false;
    return response.captures.every(
      (capture) => captureComplete(field, capture),
    );
  }
  if (
    !["photo", "document"].includes(field.fieldType)
    && !response.value
  ) return false;
  if (field.fieldType === "checkbox" && response.value !== "Yes") return false;
  if (
    field.fieldType === "number"
    && !Number.isFinite(Number(response.value))
  ) return false;
  if (
    field.fieldType === "date"
    && !validIsoDate(response.value)
  ) return false;
  return true;
}

export function manualEvidenceProgress(
  fields: readonly ManualEvidenceField[],
  responses: readonly ManualEvidenceResponse[],
) {
  const responseByCode = new Map(
    responses.map((response) => [response.fieldCode, response]),
  );
  const requiredFields = fields.filter((field) => field.required);
  const completedRequired = requiredFields.filter((field) =>
    responseComplete(field, responseByCode.get(field.fieldCode))
  ).length;
  const completedAll = fields.filter((field) =>
    responseComplete(field, responseByCode.get(field.fieldCode))
  ).length;
  const issueCount = responses.filter(
    (response) =>
      response.outcome === "issue"
      || (
        response.outcome === "not_applicable"
        && fields.find((field) => field.fieldCode === response.fieldCode)
          ?.required
      ),
  ).length;
  return {
    requiredCount: requiredFields.length,
    completedRequired,
    fieldCount: fields.length,
    completedAll,
    issueCount,
    readyForAudit:
      requiredFields.length > 0
      && completedRequired === requiredFields.length
      && issueCount === 0,
  };
}

export function emptyManualEvidenceResponse(
  fieldCodeValue: string,
): ManualEvidenceResponse {
  return {
    fieldCode: fieldCodeValue,
    outcome: "not_started",
    value: "",
    captures: [],
    note: "",
  };
}

export const MANUAL_EVIDENCE_CATALOGUE_SUMMARY = {
  programs: GOVERNMENT_PROGRAM_TEMPLATES.length,
  activities: GOVERNMENT_ACTIVITY_TEMPLATES.length,
  reviewedOn: GOVERNMENT_CATALOGUE_REVIEWED_ON,
};
