import {
  CreditexManualEvidenceContractError,
  validateManualEvidenceField,
  type ManualEvidenceField,
} from "./creditex-manual-evidence-lab.ts";

export const CREDITEX_MANUAL_POLICY_BINDING_CONTRACT =
  "creditex-manual-policy-binding-v1";
export const CREDITEX_MANUAL_EVIDENCE_FORM_V2_CONTRACT =
  "creditex-manual-evidence-form-v2";
export const CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT =
  "creditex-manual-policy-activity-reference-v1";

export type ManualPolicyBindingLifecycle =
  | "draft"
  | "approved"
  | "withdrawn";

export type ManualPolicyJson =
  | null
  | boolean
  | number
  | string
  | ManualPolicyJson[]
  | { [key: string]: ManualPolicyJson };

export type ManualPolicyActivityTemplateSnapshot = {
  templateId: string;
  programCode: string;
  activityKey: string;
  registryActivityCode: string;
  title: string;
  serviceCategory: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  catalogueState: string;
};

export type ManualPolicyProgramSnapshot = {
  id: string;
  programCode: string;
  name: string;
  schemeKind: string;
  jurisdiction: string;
  administeringBody: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  publishedByUid: string;
  publishedAt: string;
};

export type ManualPolicyActivitySnapshot = {
  id: string;
  programId: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: string;
  registryActivityCode: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  publishedByUid: string;
  publishedAt: string;
};

export type ManualPolicyEvidencePolicySnapshot = {
  id: string;
  organisationId: string;
  activityVersionId: string;
  version: number;
  title: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceSha256: string;
  officialSourceCheckedAt: string;
  publicationRequestId: string;
  publicationSnapshotSha256: string;
  contentRevision: number;
  publishedByUid: string;
  publishedAt: string;
};

export type ManualPolicyGovernmentRequirement = {
  id: string;
  requirementCode: string;
  title: string;
  description: string;
  evidenceType: string;
  captureTiming: string;
  minimumCount: number;
  maximumCount: number;
  originalRequired: boolean;
  metadataRequired: boolean;
  gpsRequired: boolean;
  dateStampRequired: boolean;
  installerSignatureRequired: boolean;
  customerSignatureRequired: boolean;
  allowedContentTypes: ManualPolicyJson;
  conditionSnapshot: ManualPolicyJson;
  fieldSchema: ManualPolicyJson;
  sourceCitation: string;
  sortOrder: number;
};

export type ManualPolicyBindingSnapshot = {
  contract: typeof CREDITEX_MANUAL_POLICY_BINDING_CONTRACT;
  organisationId: string;
  activityTemplate: ManualPolicyActivityTemplateSnapshot;
  program: ManualPolicyProgramSnapshot;
  activity: ManualPolicyActivitySnapshot;
  evidencePolicy: ManualPolicyEvidencePolicySnapshot;
  sourceApprovals: {
    programBindingId: string;
    activityBindingId: string;
    evidencePolicyBindingId: string;
  };
  requirements: ManualPolicyGovernmentRequirement[];
};

export type ManualPolicyInstructionOverlay = {
  requirementId: string;
  instructions: string;
};

export type ApprovedManualPolicyBinding = {
  id: string;
  version: number;
  lifecycleState: ManualPolicyBindingLifecycle;
  bindingSnapshot: ManualPolicyBindingSnapshot;
  bindingSnapshotSha256: string;
  approvedByUid: string;
  approvedAt: string;
};

export type ManualPolicyActivityReference = {
  contract: typeof CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT;
  referenceType: "compliance_case" | "synthetic_pilot_job";
  referenceId: string;
  referenceMode: "regulated_case" | "synthetic_test";
  activityDate: string;
  activityVersionId: string;
  activityTemplateId: string;
  referenceRevision: number;
  referenceUpdatedAt: string;
  referenceSnapshotSha256: string;
};

export type ManualEvidenceFormV2 = {
  contract: typeof CREDITEX_MANUAL_EVIDENCE_FORM_V2_CONTRACT;
  bindingId: string;
  bindingVersion: number;
  bindingSnapshotSha256: string;
  bindingApprovedByUid: string;
  bindingApprovedAt: string;
  bindingSnapshot: ManualPolicyBindingSnapshot;
  activityReference: ManualPolicyActivityReference;
  governmentRequirements: ManualPolicyGovernmentRequirement[];
  instructionOverlays: ManualPolicyInstructionOverlay[];
  operationalFields: ManualEvidenceField[];
};

export type ManualPolicyDiffEntry = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: ManualPolicyJson;
  after?: ManualPolicyJson;
};

export class CreditexManualPolicyMergeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexManualPolicyMergeError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexManualPolicyMergeError(code, status, message);
}

function objectRecord(
  value: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, 400, message);
  }
  return value as Record<string, unknown>;
}

function exactText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  if (typeof value !== "string") {
    fail(code, 400, `${label} is required.`);
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned.length > maximum || cleaned !== value.trim()) {
    fail(code, 400, `${label} is invalid.`);
  }
  return cleaned;
}

function exactOptionalText(
  value: unknown,
  maximum: number,
  code: string,
  label: string,
) {
  if (typeof value !== "string") {
    fail(code, 400, `${label} is invalid.`);
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length > maximum || cleaned !== value.trim()) {
    fail(code, 400, `${label} is invalid.`);
  }
  return cleaned;
}

function exactInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
  label: string,
) {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < minimum
    || Number(value) > maximum
  ) {
    fail(code, 400, `${label} is invalid.`);
  }
  return Number(value);
}

function exactIsoDate(
  value: unknown,
  code: string,
  label: string,
) {
  const date = exactText(value, 10, code, label);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date
  ) {
    fail(code, 400, `${label} is invalid.`);
  }
  return date;
}

function exactOptionalIsoDate(
  value: unknown,
  code: string,
  label: string,
) {
  const date = exactOptionalText(value, 10, code, label);
  return date ? exactIsoDate(date, code, label) : "";
}

function exactIsoDateTime(
  value: unknown,
  code: string,
  label: string,
) {
  const dateTime = exactText(value, 40, code, label);
  const timestamp = Date.parse(dateTime);
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== dateTime
  ) {
    fail(code, 400, `${label} is invalid.`);
  }
  return dateTime;
}

function exactBoolean(
  value: unknown,
  code: string,
  label: string,
) {
  if (typeof value !== "boolean") {
    fail(code, 400, `${label} is invalid.`);
  }
  return value;
}

function sha256Text(value: unknown, code: string, label: string) {
  const text = exactText(value, 64, code, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) {
    fail(code, 400, `${label} must be an exact SHA-256 digest.`);
  }
  return text;
}

function jsonValue(
  value: unknown,
  code: string,
  depth = 0,
): ManualPolicyJson {
  if (depth > 16) {
    fail(code, 400, "The governed JSON value is too deeply nested.");
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(code, 400, "The governed JSON value contains an invalid number.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      fail(code, 400, "The governed JSON array is too large.");
    }
    return value.map((item) => jsonValue(item, code, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 250) {
      fail(code, 400, "The governed JSON object is too large.");
    }
    return Object.fromEntries(entries.map(([key, item]) => [
      exactText(key, 160, code, "Governed JSON key"),
      jsonValue(item, code, depth + 1),
    ]));
  }
  return fail(code, 400, "The governed JSON value is invalid.");
}

export function canonicalManualPolicyJson(
  value: ManualPolicyJson | object,
): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) =>
      canonicalManualPolicyJson(item)).join(",")}]`;
  }
  const record = value as Record<string, ManualPolicyJson>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalManualPolicyJson(record[key])}`
  ).join(",")}}`;
}

export async function manualPolicySha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function activityTemplateSnapshot(
  value: unknown,
): ManualPolicyActivityTemplateSnapshot {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The activity-template snapshot is invalid.",
  );
  return {
    templateId: exactText(
      record.templateId,
      180,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Activity template ID",
    ),
    programCode: exactText(
      record.programCode,
      80,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Program code",
    ),
    activityKey: exactText(
      record.activityKey,
      180,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Activity key",
    ),
    registryActivityCode: exactOptionalText(
      record.registryActivityCode,
      120,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Registry activity code",
    ),
    title: exactText(
      record.title,
      300,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Activity title",
    ),
    serviceCategory: exactText(
      record.serviceCategory,
      80,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Service category",
    ),
    specificationPart: exactOptionalText(
      record.specificationPart,
      120,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Specification part",
    ),
    productCategory: exactText(
      record.productCategory,
      240,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Product category",
    ),
    scenarioCode: exactOptionalText(
      record.scenarioCode,
      120,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Scenario code",
    ),
    scenario: exactText(
      record.scenario,
      500,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Scenario",
    ),
    catalogueState: exactText(
      record.catalogueState,
      40,
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      "Catalogue state",
    ),
  };
}

function programSnapshot(value: unknown): ManualPolicyProgramSnapshot {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The program snapshot is invalid.",
  );
  return {
    id: exactText(record.id, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program ID"),
    programCode: exactText(record.programCode, 80, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program code"),
    name: exactText(record.name, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program name"),
    schemeKind: exactText(record.schemeKind, 80, "MANUAL_POLICY_SNAPSHOT_INVALID", "Scheme kind"),
    jurisdiction: exactText(record.jurisdiction, 8, "MANUAL_POLICY_SNAPSHOT_INVALID", "Jurisdiction"),
    administeringBody: exactText(record.administeringBody, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Administering body"),
    officialSourceUrl: exactText(record.officialSourceUrl, 1_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source URL"),
    officialSourceTitle: exactText(record.officialSourceTitle, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source title"),
    officialSourceVersion: exactOptionalText(record.officialSourceVersion, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source version"),
    officialSourceSha256: sha256Text(record.officialSourceSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source SHA-256"),
    officialSourceCheckedAt: exactText(record.officialSourceCheckedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source checked time"),
    publicationRequestId: exactText(record.publicationRequestId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program publication request"),
    publicationSnapshotSha256: sha256Text(record.publicationSnapshotSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program publication SHA-256"),
    publishedByUid: exactText(record.publishedByUid, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program publisher"),
    publishedAt: exactText(record.publishedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program published time"),
  };
}

function activitySnapshot(value: unknown): ManualPolicyActivitySnapshot {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The activity snapshot is invalid.",
  );
  return {
    id: exactText(record.id, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity ID"),
    programId: exactText(record.programId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity program ID"),
    activityKey: exactText(record.activityKey, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity key"),
    version: exactInteger(record.version, 1, 1_000_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity version"),
    title: exactText(record.title, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity title"),
    serviceCategory: exactText(record.serviceCategory, 80, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity service category"),
    registryActivityCode: exactOptionalText(record.registryActivityCode, 120, "MANUAL_POLICY_SNAPSHOT_INVALID", "Registry activity code"),
    specificationPart: exactOptionalText(record.specificationPart, 120, "MANUAL_POLICY_SNAPSHOT_INVALID", "Specification part"),
    productCategory: exactText(record.productCategory, 240, "MANUAL_POLICY_SNAPSHOT_INVALID", "Product category"),
    scenarioCode: exactOptionalText(record.scenarioCode, 120, "MANUAL_POLICY_SNAPSHOT_INVALID", "Scenario code"),
    scenario: exactText(record.scenario, 500, "MANUAL_POLICY_SNAPSHOT_INVALID", "Scenario"),
    jurisdiction: exactText(record.jurisdiction, 8, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity jurisdiction"),
    effectiveFrom: exactIsoDate(record.effectiveFrom, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity effective date"),
    effectiveTo: exactOptionalIsoDate(record.effectiveTo, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity end date"),
    officialSourceUrl: exactText(record.officialSourceUrl, 1_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source URL"),
    officialSourceTitle: exactText(record.officialSourceTitle, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source title"),
    officialSourceVersion: exactOptionalText(record.officialSourceVersion, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source version"),
    officialSourceSha256: sha256Text(record.officialSourceSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source SHA-256"),
    officialSourceCheckedAt: exactText(record.officialSourceCheckedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source checked time"),
    publicationRequestId: exactText(record.publicationRequestId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity publication request"),
    publicationSnapshotSha256: sha256Text(record.publicationSnapshotSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity publication SHA-256"),
    publishedByUid: exactText(record.publishedByUid, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity publisher"),
    publishedAt: exactText(record.publishedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity published time"),
  };
}

function evidencePolicySnapshot(
  value: unknown,
): ManualPolicyEvidencePolicySnapshot {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The evidence-policy snapshot is invalid.",
  );
  return {
    id: exactText(record.id, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy ID"),
    organisationId: exactText(record.organisationId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy organisation"),
    activityVersionId: exactText(record.activityVersionId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy activity"),
    version: exactInteger(record.version, 1, 1_000_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy version"),
    title: exactText(record.title, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy title"),
    officialSourceUrl: exactText(record.officialSourceUrl, 1_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source URL"),
    officialSourceTitle: exactText(record.officialSourceTitle, 300, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source title"),
    officialSourceVersion: exactText(record.officialSourceVersion, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source version"),
    officialSourceSha256: sha256Text(record.officialSourceSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source SHA-256"),
    officialSourceCheckedAt: exactText(record.officialSourceCheckedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source checked time"),
    publicationRequestId: exactText(record.publicationRequestId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy publication request"),
    publicationSnapshotSha256: sha256Text(record.publicationSnapshotSha256, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy publication SHA-256"),
    contentRevision: exactInteger(record.contentRevision, 1, 1_000_000, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy content revision"),
    publishedByUid: exactText(record.publishedByUid, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy publisher"),
    publishedAt: exactText(record.publishedAt, 40, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy published time"),
  };
}

function governmentRequirement(
  value: unknown,
): ManualPolicyGovernmentRequirement {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_REQUIREMENT_INVALID",
    "A government evidence requirement is invalid.",
  );
  return {
    id: exactText(record.id, 180, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement ID"),
    requirementCode: exactText(record.requirementCode, 180, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement code"),
    title: exactText(record.title, 300, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement title"),
    description: exactOptionalText(record.description, 4_000, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement description"),
    evidenceType: exactText(record.evidenceType, 40, "MANUAL_POLICY_REQUIREMENT_INVALID", "Evidence type"),
    captureTiming: exactText(record.captureTiming, 40, "MANUAL_POLICY_REQUIREMENT_INVALID", "Capture timing"),
    minimumCount: exactInteger(record.minimumCount, 0, 1_000, "MANUAL_POLICY_REQUIREMENT_INVALID", "Minimum count"),
    maximumCount: exactInteger(record.maximumCount, 0, 1_000, "MANUAL_POLICY_REQUIREMENT_INVALID", "Maximum count"),
    originalRequired: exactBoolean(record.originalRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "Original-required flag"),
    metadataRequired: exactBoolean(record.metadataRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "Metadata-required flag"),
    gpsRequired: exactBoolean(record.gpsRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "GPS-required flag"),
    dateStampRequired: exactBoolean(record.dateStampRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "Date-stamp-required flag"),
    installerSignatureRequired: exactBoolean(record.installerSignatureRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "Installer-signature-required flag"),
    customerSignatureRequired: exactBoolean(record.customerSignatureRequired, "MANUAL_POLICY_REQUIREMENT_INVALID", "Customer-signature-required flag"),
    allowedContentTypes: jsonValue(record.allowedContentTypes, "MANUAL_POLICY_REQUIREMENT_INVALID"),
    conditionSnapshot: jsonValue(record.conditionSnapshot, "MANUAL_POLICY_REQUIREMENT_INVALID"),
    fieldSchema: jsonValue(record.fieldSchema, "MANUAL_POLICY_REQUIREMENT_INVALID"),
    sourceCitation: exactText(record.sourceCitation, 1_000, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement source citation"),
    sortOrder: exactInteger(record.sortOrder, 0, 1_000_000, "MANUAL_POLICY_REQUIREMENT_INVALID", "Requirement sort order"),
  };
}

export function validateManualPolicyBindingSnapshot(
  value: unknown,
): ManualPolicyBindingSnapshot {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The governed binding snapshot is invalid.",
  );
  if (record.contract !== CREDITEX_MANUAL_POLICY_BINDING_CONTRACT) {
    fail(
      "MANUAL_POLICY_SNAPSHOT_INVALID",
      400,
      "The governed binding contract is not supported.",
    );
  }
  const sourceApprovals = objectRecord(
    record.sourceApprovals,
    "MANUAL_POLICY_SNAPSHOT_INVALID",
    "The official-source approvals are invalid.",
  );
  if (!Array.isArray(record.requirements) || record.requirements.length === 0) {
    fail(
      "GOVERNED_POLICY_INVENTORY_EMPTY",
      409,
      "The published evidence policy has no governed requirements.",
    );
  }
  if (record.requirements.length > 500) {
    fail(
      "MANUAL_POLICY_REQUIREMENT_LIMIT",
      400,
      "The governed evidence policy exceeds the supported requirement limit.",
    );
  }
  const snapshot: ManualPolicyBindingSnapshot = {
    contract: CREDITEX_MANUAL_POLICY_BINDING_CONTRACT,
    organisationId: exactText(record.organisationId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Organisation ID"),
    activityTemplate: activityTemplateSnapshot(record.activityTemplate),
    program: programSnapshot(record.program),
    activity: activitySnapshot(record.activity),
    evidencePolicy: evidencePolicySnapshot(record.evidencePolicy),
    sourceApprovals: {
      programBindingId: exactText(sourceApprovals.programBindingId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Program source binding"),
      activityBindingId: exactText(sourceApprovals.activityBindingId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Activity source binding"),
      evidencePolicyBindingId: exactText(sourceApprovals.evidencePolicyBindingId, 180, "MANUAL_POLICY_SNAPSHOT_INVALID", "Evidence policy source binding"),
    },
    requirements: record.requirements.map(governmentRequirement),
  };
  if (
    snapshot.program.programCode !== snapshot.activityTemplate.programCode
    || snapshot.activity.programId !== snapshot.program.id
    || snapshot.activity.activityKey !== snapshot.activityTemplate.activityKey
    || snapshot.evidencePolicy.organisationId !== snapshot.organisationId
    || snapshot.evidencePolicy.activityVersionId !== snapshot.activity.id
  ) {
    fail(
      "MANUAL_POLICY_BINDING_MISMATCH",
      409,
      "The activity template, program, activity and evidence policy are not one exact governed chain.",
    );
  }
  if (
    snapshot.activity.effectiveTo
    && snapshot.activity.effectiveTo < snapshot.activity.effectiveFrom
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_EFFECTIVE_RANGE_INVALID",
      409,
      "The published activity version has an invalid effective-date range.",
    );
  }
  const identities = new Set<string>();
  let prior: ManualPolicyGovernmentRequirement | null = null;
  for (const requirement of snapshot.requirements) {
    const identity = `${requirement.id}\u0000${requirement.requirementCode.toLowerCase()}`;
    if (
      [...identities].some((item) =>
        item.startsWith(`${requirement.id}\u0000`)
        || item.endsWith(`\u0000${requirement.requirementCode.toLowerCase()}`)
      )
    ) {
      fail(
        "MANUAL_POLICY_REQUIREMENT_DUPLICATE",
        409,
        "Government requirement IDs and codes must be unique.",
      );
    }
    identities.add(identity);
    if (
      prior
      && (
        requirement.sortOrder < prior.sortOrder
        || (
          requirement.sortOrder === prior.sortOrder
          && requirement.requirementCode.toLowerCase()
            < prior.requirementCode.toLowerCase()
        )
      )
    ) {
      fail(
        "MANUAL_POLICY_REQUIREMENT_ORDER_INVALID",
        409,
        "Government requirements must retain their published order.",
      );
    }
    if (
      requirement.maximumCount !== 0
      && requirement.maximumCount < requirement.minimumCount
    ) {
      fail(
        "MANUAL_POLICY_REQUIREMENT_INVALID",
        409,
        "A government requirement has invalid evidence cardinality.",
      );
    }
    prior = requirement;
  }
  return snapshot;
}

export function validateManualPolicyActivityReference(
  value: unknown,
  bindingSnapshot: ManualPolicyBindingSnapshot,
): ManualPolicyActivityReference {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_ACTIVITY_REFERENCE_REQUIRED",
    "Choose an authoritative dated job or case before composing evidence.",
  );
  if (
    record.contract !== CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      400,
      "The authoritative activity-date reference contract is not supported.",
    );
  }
  const referenceType = exactText(
    record.referenceType,
    40,
    "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
    "Activity reference type",
  );
  const referenceMode = exactText(
    record.referenceMode,
    40,
    "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
    "Activity reference mode",
  );
  if (
    !(
      referenceType === "compliance_case"
      && referenceMode === "regulated_case"
    )
    && !(
      referenceType === "synthetic_pilot_job"
      && referenceMode === "synthetic_test"
    )
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      400,
      "The authoritative activity-date reference type and mode do not match.",
    );
  }
  const reference: ManualPolicyActivityReference = {
    contract: CREDITEX_MANUAL_POLICY_ACTIVITY_REFERENCE_CONTRACT,
    referenceType,
    referenceId: exactText(
      record.referenceId,
      180,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity reference ID",
    ),
    referenceMode,
    activityDate: exactIsoDate(
      record.activityDate,
      "MANUAL_POLICY_ACTIVITY_DATE_INVALID",
      "Activity date",
    ),
    activityVersionId: exactText(
      record.activityVersionId,
      180,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity version ID",
    ),
    activityTemplateId: exactText(
      record.activityTemplateId,
      180,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity template ID",
    ),
    referenceRevision: exactInteger(
      record.referenceRevision,
      1,
      1_000_000_000,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity reference revision",
    ),
    referenceUpdatedAt: exactIsoDateTime(
      record.referenceUpdatedAt,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity reference update time",
    ),
    referenceSnapshotSha256: sha256Text(
      record.referenceSnapshotSha256,
      "MANUAL_POLICY_ACTIVITY_REFERENCE_INVALID",
      "Activity reference snapshot SHA-256",
    ),
  };
  if (
    reference.activityVersionId !== bindingSnapshot.activity.id
    || reference.activityTemplateId
      !== bindingSnapshot.activityTemplate.templateId
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_REFERENCE_MISMATCH",
      409,
      "The dated job or case is not linked to this exact published activity version and controlled template.",
    );
  }
  if (
    reference.activityDate < bindingSnapshot.activity.effectiveFrom
    || (
      bindingSnapshot.activity.effectiveTo
      && reference.activityDate > bindingSnapshot.activity.effectiveTo
    )
  ) {
    fail(
      "MANUAL_POLICY_ACTIVITY_DATE_OUTSIDE_EFFECTIVE_RANGE",
      409,
      "The authoritative job activity date is outside the published activity version effective dates.",
    );
  }
  return reference;
}

function instructionOverlays(
  value: unknown,
  requirements: readonly ManualPolicyGovernmentRequirement[],
): ManualPolicyInstructionOverlay[] {
  if (!Array.isArray(value) || value.length > requirements.length) {
    fail(
      "MANUAL_POLICY_OVERLAY_INVALID",
      400,
      "Instruction overlays must map to governed requirements.",
    );
  }
  const requirementIds = new Set(requirements.map(({ id }) => id));
  const seen = new Set<string>();
  return value.map((item) => {
    const record = objectRecord(
      item,
      "MANUAL_POLICY_OVERLAY_INVALID",
      "An instruction overlay is invalid.",
    );
    const requirementId = exactText(
      record.requirementId,
      180,
      "MANUAL_POLICY_OVERLAY_INVALID",
      "Overlay requirement ID",
    );
    if (!requirementIds.has(requirementId) || seen.has(requirementId)) {
      fail(
        "MANUAL_POLICY_OVERLAY_INVALID",
        400,
        "Each instruction overlay must target one unique governed requirement.",
      );
    }
    seen.add(requirementId);
    return {
      requirementId,
      instructions: exactText(
        record.instructions,
        2_000,
        "MANUAL_POLICY_OVERLAY_INVALID",
        "Creditex field instruction",
      ),
    };
  });
}

function operationalFields(
  value: unknown,
  requirements: readonly ManualPolicyGovernmentRequirement[],
): ManualEvidenceField[] {
  if (!Array.isArray(value) || value.length > 40) {
    fail(
      "MANUAL_POLICY_OPERATIONAL_FIELDS_INVALID",
      400,
      "Creditex operational fields must be an array of no more than 40 fields.",
    );
  }
  const governmentCodes = new Set(
    requirements.map(({ requirementCode }) => requirementCode.toLowerCase()),
  );
  const seen = new Set<string>();
  return value.map((item) => {
    const input = objectRecord(
      item,
      "MANUAL_POLICY_OPERATIONAL_FIELDS_INVALID",
      "A Creditex operational field is invalid.",
    );
    if (
      input.origin === "government_requirement_candidate"
      || input.origin !== "creditex_operational_test"
      || input.source !== null
    ) {
      fail(
        "GOVERNMENT_CANDIDATE_NON_AUTHORITATIVE",
        409,
        "Government candidate fields cannot be merged into an authoritative evidence form.",
      );
    }
    let field: ManualEvidenceField;
    try {
      field = validateManualEvidenceField(input);
    } catch (error) {
      if (error instanceof CreditexManualEvidenceContractError) {
        fail(error.code, 400, error.message);
      }
      throw error;
    }
    const code = field.fieldCode.toLowerCase();
    if (seen.has(code) || governmentCodes.has(code)) {
      fail(
        "MANUAL_POLICY_FIELD_CODE_CONFLICT",
        409,
        "Operational field codes must be unique and cannot reuse a government requirement code.",
      );
    }
    seen.add(code);
    return field;
  });
}

export function assertGovernmentRequirementsUnchanged(
  bindingSnapshot: ManualPolicyBindingSnapshot,
  governmentRequirements: unknown,
) {
  const requirements = Array.isArray(governmentRequirements)
    ? governmentRequirements.map(governmentRequirement)
    : fail(
      "GOVERNMENT_REQUIREMENTS_CHANGED",
      409,
      "The government requirements are missing or changed.",
    );
  if (
    canonicalManualPolicyJson(requirements)
    !== canonicalManualPolicyJson(bindingSnapshot.requirements)
  ) {
    fail(
      "GOVERNMENT_REQUIREMENTS_CHANGED",
      409,
      "Government requirements cannot be weakened, removed or reordered.",
    );
  }
  return bindingSnapshot.requirements;
}

export async function composeManualEvidenceFormV2(
  binding: ApprovedManualPolicyBinding,
  activityReferenceValue: unknown,
  overlaysValue: unknown = [],
  operationalFieldsValue: unknown = [],
): Promise<ManualEvidenceFormV2> {
  if (binding.lifecycleState === "withdrawn") {
    fail(
      "MANUAL_POLICY_BINDING_WITHDRAWN",
      409,
      "This governed binding is withdrawn and cannot create new form compositions.",
    );
  }
  if (binding.lifecycleState !== "approved") {
    fail(
      "MANUAL_POLICY_BINDING_APPROVAL_REQUIRED",
      409,
      "The governed binding requires independent approval before composition.",
    );
  }
  const snapshot = validateManualPolicyBindingSnapshot(
    binding.bindingSnapshot,
  );
  const expectedSha256 = sha256Text(
    binding.bindingSnapshotSha256,
    "MANUAL_POLICY_BINDING_HASH_INVALID",
    "Binding snapshot SHA-256",
  );
  const computedSha256 = await manualPolicySha256(
    canonicalManualPolicyJson(snapshot),
  );
  if (computedSha256 !== expectedSha256) {
    fail(
      "MANUAL_POLICY_BINDING_HASH_MISMATCH",
      409,
      "The governed binding snapshot does not match its immutable hash.",
    );
  }
  const activityReference = validateManualPolicyActivityReference(
    activityReferenceValue,
    snapshot,
  );
  return {
    contract: CREDITEX_MANUAL_EVIDENCE_FORM_V2_CONTRACT,
    bindingId: exactText(binding.id, 180, "MANUAL_POLICY_BINDING_INVALID", "Binding ID"),
    bindingVersion: exactInteger(binding.version, 1, 1_000_000, "MANUAL_POLICY_BINDING_INVALID", "Binding version"),
    bindingSnapshotSha256: expectedSha256,
    bindingApprovedByUid: exactText(binding.approvedByUid, 180, "MANUAL_POLICY_BINDING_INVALID", "Binding approver"),
    bindingApprovedAt: exactText(binding.approvedAt, 40, "MANUAL_POLICY_BINDING_INVALID", "Binding approval time"),
    bindingSnapshot: snapshot,
    activityReference,
    governmentRequirements: snapshot.requirements,
    instructionOverlays: instructionOverlays(
      overlaysValue,
      snapshot.requirements,
    ),
    operationalFields: operationalFields(
      operationalFieldsValue,
      snapshot.requirements,
    ),
  };
}

export async function validatePinnedManualEvidenceFormV2(
  value: unknown,
): Promise<ManualEvidenceFormV2> {
  const record = objectRecord(
    value,
    "MANUAL_POLICY_COMPOSITION_INVALID",
    "The pinned manual evidence form is invalid.",
  );
  if (record.contract !== CREDITEX_MANUAL_EVIDENCE_FORM_V2_CONTRACT) {
    fail(
      "MANUAL_POLICY_COMPOSITION_INVALID",
      400,
      "The pinned manual evidence form contract is not supported.",
    );
  }
  const snapshot = validateManualPolicyBindingSnapshot(
    record.bindingSnapshot,
  );
  const bindingSnapshotSha256 = sha256Text(
    record.bindingSnapshotSha256,
    "MANUAL_POLICY_BINDING_HASH_INVALID",
    "Binding snapshot SHA-256",
  );
  if (
    await manualPolicySha256(canonicalManualPolicyJson(snapshot))
    !== bindingSnapshotSha256
  ) {
    fail(
      "MANUAL_POLICY_BINDING_HASH_MISMATCH",
      409,
      "The pinned governed binding snapshot does not match its immutable hash.",
    );
  }
  const governmentRequirements = assertGovernmentRequirementsUnchanged(
    snapshot,
    record.governmentRequirements,
  );
  const activityReference = validateManualPolicyActivityReference(
    record.activityReference,
    snapshot,
  );
  return {
    contract: CREDITEX_MANUAL_EVIDENCE_FORM_V2_CONTRACT,
    bindingId: exactText(record.bindingId, 180, "MANUAL_POLICY_COMPOSITION_INVALID", "Binding ID"),
    bindingVersion: exactInteger(record.bindingVersion, 1, 1_000_000, "MANUAL_POLICY_COMPOSITION_INVALID", "Binding version"),
    bindingSnapshotSha256,
    bindingApprovedByUid: exactText(record.bindingApprovedByUid, 180, "MANUAL_POLICY_COMPOSITION_INVALID", "Binding approver"),
    bindingApprovedAt: exactText(record.bindingApprovedAt, 40, "MANUAL_POLICY_COMPOSITION_INVALID", "Binding approval time"),
    bindingSnapshot: snapshot,
    activityReference,
    governmentRequirements,
    instructionOverlays: instructionOverlays(
      record.instructionOverlays,
      snapshot.requirements,
    ),
    operationalFields: operationalFields(
      record.operationalFields,
      snapshot.requirements,
    ),
  };
}

function pointerToken(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function exactDiff(
  before: ManualPolicyJson | undefined,
  after: ManualPolicyJson | undefined,
  path: string,
  output: ManualPolicyDiffEntry[],
) {
  if (before === undefined) {
    output.push({ path, kind: "added", after });
    return;
  }
  if (after === undefined) {
    output.push({ path, kind: "removed", before });
    return;
  }
  if (canonicalManualPolicyJson(before) === canonicalManualPolicyJson(after)) {
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      exactDiff(before[index], after[index], `${path}/${index}`, output);
    }
    return;
  }
  if (
    before !== null
    && after !== null
    && typeof before === "object"
    && typeof after === "object"
    && !Array.isArray(before)
    && !Array.isArray(after)
  ) {
    const keys = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);
    for (const key of [...keys].sort()) {
      exactDiff(
        before[key],
        after[key],
        `${path}/${pointerToken(key)}`,
        output,
      );
    }
    return;
  }
  output.push({ path, kind: "changed", before, after });
}

export function exactManualPolicyCompositionDiff(
  previous: ManualEvidenceFormV2 | null,
  next: ManualEvidenceFormV2,
) {
  const output: ManualPolicyDiffEntry[] = [];
  exactDiff(
    previous as unknown as ManualPolicyJson | undefined,
    next as unknown as ManualPolicyJson,
    "",
    output,
  );
  return output;
}

export async function buildManualEvidenceFormV2CompositionPreview(
  binding: ApprovedManualPolicyBinding,
  activityReferenceValue: unknown,
  overlaysValue: unknown = [],
  operationalFieldsValue: unknown = [],
  authoritativePreviousValue: unknown = null,
) {
  const composition = await composeManualEvidenceFormV2(
    binding,
    activityReferenceValue,
    overlaysValue,
    operationalFieldsValue,
  );
  const previous = authoritativePreviousValue === null
    ? null
    : await validatePinnedManualEvidenceFormV2(authoritativePreviousValue);
  const diff = exactManualPolicyCompositionDiff(previous, composition);
  const canonicalComposition = canonicalManualPolicyJson(
    composition as unknown as ManualPolicyJson,
  );
  return {
    composition,
    compositionSha256: await manualPolicySha256(canonicalComposition),
    diff,
    diffSha256: await manualPolicySha256(
      canonicalManualPolicyJson(diff as unknown as ManualPolicyJson),
    ),
  };
}
