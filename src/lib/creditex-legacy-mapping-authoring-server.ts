import type { ComplianceIdentity } from "./compliance-access-server";
import {
  ensureCreditexLegacyMappingGuards,
} from "./creditex-legacy-mapping-guards.ts";

const LEGACY_MAPPING_CONTRACT_FORMAT =
  "creditex-legacy-field-mapping-v1" as const;
const BOOTSTRAP_EMAIL = "info@ausenergyassessments.com";
const MAXIMUM_MAPPING_FIELDS = 250;

const LEGACY_MAPPING_TRANSFORMS = [
  "identity",
  "trim",
  "lowercase",
  "uppercase",
  "iso_date",
  "decimal_string",
  "integer_string",
  "boolean_string",
] as const;

type LegacyMappingTransform = typeof LEGACY_MAPPING_TRANSFORMS[number];

const DATAFORCE_SOURCE_FIELDS = Object.freeze({
  app_id: "App Id",
  job_id: "Job Id",
  status: "Status",
  sub_status: "SubStatus",
  type: "Type",
  work_type: "Work Type",
  scheduled_datetime: "Scheduled Datetime",
  balance: "Balance",
  certificates_veecs: "Certificates (VEECs)",
  submission: "Submission",
  invoiced: "Invoiced",
  field_worker: "Field Worker",
  agent: "Agent",
  client: "Client",
  customer: "Customer",
  company_name: "Company Name",
  ext_cust_ref: "Ext Cust Ref",
  phone: "Phone",
  mobile: "Mobile",
  email: "Email",
  address: "Address",
  suburb: "Suburb",
  postcode: "Postcode",
});

const SOURCE_FIELD_DICTIONARIES = Object.freeze({
  "dataforce-jobs-v1": DATAFORCE_SOURCE_FIELDS,
});

const TLINK_LEGACY_TARGET_FIELDS = new Set([
  "appointment.externalId",
  "appointment.scheduledAt",
  "assignment.fieldWorker",
  "customer.companyName",
  "customer.displayName",
  "customer.email",
  "customer.externalReference",
  "customer.mobile",
  "customer.phone",
  "legacy.agent",
  "legacy.balance",
  "legacy.certificateQuantity",
  "legacy.client",
  "legacy.invoiceStatus",
  "legacy.status",
  "legacy.subStatus",
  "legacy.submissionStatus",
  "legacy.type",
  "site.address",
  "site.postcode",
  "site.suburb",
  "workOrder.workNumber",
  "workOrder.workType",
]);

const TARGET_FIELD_DICTIONARIES = Object.freeze({
  "tlink-legacy-job-binding-v1": TLINK_LEGACY_TARGET_FIELDS,
});

type MappingActor = Pick<
  ComplianceIdentity,
  | "uid"
  | "organisationId"
  | "role"
  | "governanceIdentityVerified"
  | "email"
  | "displayName"
>;

type MappingField = {
  sourceFieldKey: string;
  sourceField: string;
  targetField: string;
  transform: LegacyMappingTransform;
  required: boolean;
};

type CanonicalLegacyMapping = {
  contractFormat: typeof LEGACY_MAPPING_CONTRACT_FORMAT;
  sourceContract: string;
  targetContract: string;
  fields: MappingField[];
};

type MappingArtifactRecord = {
  id: string;
  organisation_id: string;
  legacy_system_key: string;
  mapping_version: string;
  artifact_sha256: string;
  payload_artifact_sha256: string;
  canonical_mapping_json: string;
  contract_format: typeof LEGACY_MAPPING_CONTRACT_FORMAT;
  created_by_uid: string;
  created_at: string;
};

type ListedMappingArtifactRecord = MappingArtifactRecord & {
  decision_id: string | null;
  decision: MappingDecision | null;
  supersedes_decision_id: string | null;
  review_note: string | null;
  reviewed_by_uid: string | null;
  reviewed_at: string | null;
};

type MappingDecision = "approved" | "rejected" | "withdrawn";

type MappingDecisionRecord = {
  id: string;
  organisation_id: string;
  artifact_id: string;
  legacy_system_key: string;
  mapping_version: string;
  artifact_sha256: string;
  decision: MappingDecision;
  supersedes_decision_id: string;
  review_note: string;
  reviewed_by_uid: string;
  reviewed_at: string;
};

type CurrentMappingApprovalRecord = {
  artifact_id: string;
  artifact_sha256: string;
  approval_decision_id: string;
  approved_by_uid: string;
  approved_at: string;
};

export class CreditexLegacyMappingAuthoringError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexLegacyMappingAuthoringError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexLegacyMappingAuthoringError(code, status, message);
}

function inputRecord(
  value: unknown,
  code = "LEGACY_MAPPING_REQUEST_INVALID",
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, 400, "Enter a valid legacy field-mapping request.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
  message: string,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) {
    fail(code, 400, message);
  }
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
) {
  if (typeof value !== "string") fail(code, 400, message);
  const text = value.trim();
  if (
    !text
    || text.length > maximum
    || /[\u0000-\u001f\u007f]/.test(text)
  ) {
    fail(code, 400, message);
  }
  return text;
}

function cleanSystemKey(value: unknown) {
  const key = cleanText(
    value,
    120,
    "LEGACY_MAPPING_SYSTEM_INVALID",
    "Enter the exact lower-case legacy provider or system key.",
  );
  if (
    key !== key.toLowerCase()
    || !/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(key)
  ) {
    fail(
      "LEGACY_MAPPING_SYSTEM_INVALID",
      400,
      "Enter the exact lower-case legacy provider or system key.",
    );
  }
  return key;
}

function cleanMappingVersion(value: unknown) {
  const version = cleanText(
    value,
    120,
    "LEGACY_MAPPING_VERSION_INVALID",
    "Enter an explicit lower-case mapping version.",
  );
  if (
    version !== version.toLowerCase()
    || !/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(version)
  ) {
    fail(
      "LEGACY_MAPPING_VERSION_INVALID",
      400,
      "Enter an explicit lower-case mapping version.",
    );
  }
  return version;
}

function requireNamedMappingActor(member: MappingActor) {
  const email = String(member.email || "").trim().toLowerCase();
  if (
    !["admin", "reviewer"].includes(member.role)
    || !member.governanceIdentityVerified
    || !String(member.displayName || "").trim()
    || !email.includes("@")
    || email === BOOTSTRAP_EMAIL
  ) {
    fail(
      "LEGACY_MAPPING_NAMED_VERIFIED_MEMBER_REQUIRED",
      403,
      "A named Creditex administrator or reviewer with independently verified governance identity is required.",
    );
  }
}

function mappingTransform(value: unknown): LegacyMappingTransform {
  const transform = String(value || "").trim();
  if (
    LEGACY_MAPPING_TRANSFORMS.includes(
      transform as LegacyMappingTransform,
    )
  ) {
    return transform as LegacyMappingTransform;
  }
  return fail(
    "LEGACY_MAPPING_TRANSFORM_INVALID",
    400,
    "Choose a supported declarative field transform.",
  );
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanContractIdentifier(
  value: unknown,
  code: string,
  message: string,
) {
  const identifier = cleanText(value, 120, code, message);
  if (
    identifier !== identifier.toLowerCase()
    || !/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(identifier)
  ) {
    fail(code, 400, message);
  }
  return identifier;
}

function cleanSourceFieldKey(value: unknown) {
  const key = cleanText(
    value,
    40,
    "LEGACY_MAPPING_FIELD_INVALID",
    "Choose a controlled source field key.",
  );
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) {
    fail(
      "LEGACY_MAPPING_FIELD_INVALID",
      400,
      "Choose a controlled source field key.",
    );
  }
  return key;
}

function cleanTargetField(
  value: unknown,
  dictionary: ReadonlySet<string>,
) {
  const target = cleanText(
    value,
    80,
    "LEGACY_MAPPING_FIELD_INVALID",
    "Choose a controlled TLink target field path.",
  );
  if (
    !/^[A-Za-z][A-Za-z0-9]{1,31}(?:\.[A-Za-z][A-Za-z0-9]{1,31}){1,3}$/
      .test(target)
    || !dictionary.has(target)
  ) {
    fail(
      "LEGACY_MAPPING_FIELD_INVALID",
      400,
      "Choose a controlled TLink target field path.",
    );
  }
  return target;
}

function canonicalMapping(
  value: unknown,
  mode: "input" | "stored" = "input",
): CanonicalLegacyMapping {
  const mapping = inputRecord(value, "LEGACY_MAPPING_CONTRACT_INVALID");
  exactKeys(
    mapping,
    mode === "stored"
      ? ["contractFormat", "sourceContract", "targetContract", "fields"]
      : ["sourceContract", "targetContract", "fields"],
    "LEGACY_MAPPING_CONTRACT_INVALID",
    "The mapping contract contains unsupported data.",
  );
  if (
    mode === "stored"
    && mapping.contractFormat !== LEGACY_MAPPING_CONTRACT_FORMAT
  ) {
    fail(
      "LEGACY_MAPPING_STORED_CONTRACT_INVALID",
      409,
      "The stored mapping contract format is invalid.",
    );
  }
  const sourceContract = cleanContractIdentifier(
    mapping.sourceContract,
    "LEGACY_MAPPING_SOURCE_CONTRACT_INVALID",
    "Enter a supported machine-readable source schema contract.",
  );
  const dictionary = SOURCE_FIELD_DICTIONARIES[
    sourceContract as keyof typeof SOURCE_FIELD_DICTIONARIES
  ];
  if (!dictionary) {
    fail(
      "LEGACY_MAPPING_SOURCE_CONTRACT_UNSUPPORTED",
      400,
      "This source contract does not have a controlled field dictionary.",
    );
  }
  const targetContract = cleanContractIdentifier(
    mapping.targetContract,
    "LEGACY_MAPPING_TARGET_CONTRACT_INVALID",
    "Enter a machine-readable target schema contract.",
  );
  const targetDictionary = TARGET_FIELD_DICTIONARIES[
    targetContract as keyof typeof TARGET_FIELD_DICTIONARIES
  ];
  if (!targetDictionary) {
    fail(
      "LEGACY_MAPPING_TARGET_CONTRACT_UNSUPPORTED",
      400,
      "This target contract does not have a controlled field dictionary.",
    );
  }
  if (
    !Array.isArray(mapping.fields)
    || mapping.fields.length < 1
    || mapping.fields.length > MAXIMUM_MAPPING_FIELDS
  ) {
    fail(
      "LEGACY_MAPPING_FIELDS_INVALID",
      400,
      `Enter between 1 and ${MAXIMUM_MAPPING_FIELDS} field mappings.`,
    );
  }
  const fields = mapping.fields.map((value, index): MappingField => {
    const field = inputRecord(value, "LEGACY_MAPPING_FIELD_INVALID");
    exactKeys(
      field,
      mode === "stored"
        ? [
          "sourceFieldKey",
          "sourceField",
          "targetField",
          "transform",
          "required",
        ]
        : ["sourceFieldKey", "targetField", "transform", "required"],
      "LEGACY_MAPPING_FIELD_INVALID",
      `Field mapping ${index + 1} contains unsupported data.`,
    );
    if (typeof field.required !== "boolean") {
      fail(
        "LEGACY_MAPPING_FIELD_INVALID",
        400,
        `Field mapping ${index + 1} must state whether it is required.`,
      );
    }
    const sourceFieldKey = cleanSourceFieldKey(field.sourceFieldKey);
    const sourceField = dictionary[
      sourceFieldKey as keyof typeof dictionary
    ];
    if (!sourceField) {
      fail(
        "LEGACY_MAPPING_FIELD_INVALID",
        400,
        `Field mapping ${index + 1} is not in the controlled source dictionary.`,
      );
    }
    if (mode === "stored" && field.sourceField !== sourceField) {
      fail(
        "LEGACY_MAPPING_STORED_CONTRACT_INVALID",
        409,
        "The stored source header does not match its controlled field key.",
      );
    }
    return {
      sourceFieldKey,
      sourceField,
      targetField: cleanTargetField(field.targetField, targetDictionary),
      transform: mappingTransform(field.transform),
      required: field.required,
    };
  }).sort((left, right) => (
    compareText(left.sourceField, right.sourceField)
    || compareText(left.targetField, right.targetField)
    || compareText(left.transform, right.transform)
    || Number(right.required) - Number(left.required)
  ));
  const sourceFields = new Set<string>();
  const sourceFieldKeys = new Set<string>();
  const targetFields = new Set<string>();
  for (const field of fields) {
    if (
      sourceFields.has(field.sourceField)
      || sourceFieldKeys.has(field.sourceFieldKey)
    ) {
      fail(
        "LEGACY_MAPPING_SOURCE_FIELD_DUPLICATE",
        400,
        `Source field "${field.sourceField}" is mapped more than once.`,
      );
    }
    if (targetFields.has(field.targetField)) {
      fail(
        "LEGACY_MAPPING_TARGET_FIELD_DUPLICATE",
        400,
        `Target field "${field.targetField}" is mapped more than once.`,
      );
    }
    sourceFieldKeys.add(field.sourceFieldKey);
    sourceFields.add(field.sourceField);
    targetFields.add(field.targetField);
  }
  return {
    contractFormat: LEGACY_MAPPING_CONTRACT_FORMAT,
    sourceContract,
    targetContract,
    fields,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(",")}}`;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const exact = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exact).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function validateStoredMappingArtifact(record: MappingArtifactRecord) {
  let mapping: CanonicalLegacyMapping;
  let canonical: string;
  try {
    mapping = canonicalMapping(
      JSON.parse(record.canonical_mapping_json),
      "stored",
    );
    canonical = canonicalJson(mapping);
  } catch {
    return fail(
      "LEGACY_MAPPING_STORED_CONTRACT_INVALID",
      409,
      "The stored mapping payload does not match the controlled contract.",
    );
  }
  const computedSha256 = await sha256Hex(canonical);
  if (
    canonical !== record.canonical_mapping_json
    || computedSha256 !== record.artifact_sha256
    || computedSha256 !== record.payload_artifact_sha256
  ) {
    fail(
      "LEGACY_MAPPING_STORED_HASH_MISMATCH",
      409,
      "The stored mapping payload does not match its immutable hash.",
    );
  }
  return mapping;
}

function exactTime(
  value: string | undefined,
  code: string,
  current?: string,
) {
  const parsed = Date.parse(value || new Date().toISOString());
  if (!Number.isFinite(parsed)) {
    fail(code, 400, "Record a valid governance time.");
  }
  const time = new Date(parsed).toISOString();
  if (current && Date.parse(time) <= Date.parse(current)) {
    fail(
      code,
      409,
      "A superseding decision must be later than the current decision.",
    );
  }
  return time;
}

function publicArtifact(
  record: MappingArtifactRecord,
  canonicalMappingValue?: CanonicalLegacyMapping,
) {
  return {
    id: record.id,
    legacySystemKey: record.legacy_system_key,
    mappingVersion: record.mapping_version,
    contractFormat: record.contract_format,
    canonicalMapping: canonicalMappingValue || JSON.parse(
      record.canonical_mapping_json,
    ) as CanonicalLegacyMapping,
    artifactSha256: record.artifact_sha256,
    createdByUid: record.created_by_uid,
    createdAt: record.created_at,
  };
}

function publicDecision(record: MappingDecisionRecord) {
  return {
    id: record.id,
    artifactId: record.artifact_id,
    legacySystemKey: record.legacy_system_key,
    mappingVersion: record.mapping_version,
    artifactSha256: record.artifact_sha256,
    decision: record.decision,
    supersedesDecisionId: record.supersedes_decision_id,
    reviewNote: record.review_note,
    reviewedByUid: record.reviewed_by_uid,
    reviewedAt: record.reviewed_at,
  };
}

async function mappingArtifact(
  database: D1Database,
  organisationId: string,
  artifactId: string,
) {
  return database.prepare(`SELECT
      artifact.id,
      artifact.organisation_id,
      artifact.legacy_system_key,
      artifact.mapping_version,
      artifact.artifact_sha256,
      payload.artifact_sha256 payload_artifact_sha256,
      payload.canonical_mapping_json,
      payload.contract_format,
      payload.created_by_uid,
      payload.created_at
    FROM compliance_legacy_mapping_artifacts artifact
    JOIN compliance_legacy_mapping_artifact_payloads payload
      ON payload.artifact_id = artifact.id
      AND payload.organisation_id = artifact.organisation_id
      AND payload.legacy_system_key = artifact.legacy_system_key
      AND payload.mapping_version = artifact.mapping_version
    WHERE artifact.organisation_id = ?
      AND artifact.id = ?
      AND artifact.authorization_state = 'draft'
      AND artifact.artifact_format = 'json'
    LIMIT 1`)
    .bind(organisationId, artifactId)
    .first<MappingArtifactRecord>();
}

async function latestMappingDecision(
  database: D1Database,
  organisationId: string,
  artifactId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_legacy_mapping_review_decisions
    WHERE organisation_id = ?
      AND artifact_id = ?
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId, artifactId)
    .first<MappingDecisionRecord>();
}

export async function createCreditexLegacyMappingDraft(
  database: D1Database,
  member: MappingActor,
  inputValue: unknown,
  options: { now?: string } = {},
) {
  requireNamedMappingActor(member);
  await ensureCreditexLegacyMappingGuards(database);
  const input = inputRecord(inputValue);
  if (
    [
      "artifactSha256",
      "sha256",
      "hash",
      "objectKey",
      "authorizationState",
    ].some((key) => Object.hasOwn(input, key))
  ) {
    fail(
      "LEGACY_MAPPING_CALLER_HASH_FORBIDDEN",
      400,
      "Artifact identity and hashes are produced only by the server.",
    );
  }
  exactKeys(
    input,
    ["legacySystemKey", "mappingVersion", "mapping"],
    "LEGACY_MAPPING_REQUEST_INVALID",
    "The draft request contains unsupported data.",
  );
  const legacySystemKey = cleanSystemKey(input.legacySystemKey);
  const mappingVersion = cleanMappingVersion(input.mappingVersion);
  const mapping = canonicalMapping(input.mapping);
  const canonicalMappingJson = canonicalJson(mapping);
  const artifactSha256 = await sha256Hex(canonicalMappingJson);
  const createdAt = exactTime(
    options.now,
    "LEGACY_MAPPING_TIME_INVALID",
  );
  const duplicate = await database.prepare(`SELECT id
    FROM compliance_legacy_mapping_artifacts
    WHERE organisation_id = ?
      AND legacy_system_key = ?
      AND mapping_version = ?
    LIMIT 1`)
    .bind(member.organisationId, legacySystemKey, mappingVersion)
    .first<{ id: string }>();
  if (duplicate) {
    fail(
      "LEGACY_MAPPING_VERSION_EXISTS",
      409,
      "This provider and mapping version already exists. Author an explicit new version.",
    );
  }
  const id = crypto.randomUUID();
  const objectKey =
    `d1:compliance_legacy_mapping_artifact_payloads:${id}`;
  await database.batch([
    database.prepare(`INSERT INTO compliance_legacy_mapping_artifacts (
        id,
        organisation_id,
        legacy_system_key,
        mapping_version,
        artifact_format,
        object_key,
        artifact_sha256,
        authorization_state,
        authorization_basis,
        requested_by_uid,
        primary_authorizer_uid,
        secondary_authorizer_uid,
        authorized_at,
        withdrawn_by_uid,
        withdrawn_at,
        created_at
      ) VALUES (
        ?, ?, ?, ?, 'json', ?, ?, 'draft', '', ?, '', '', '', '', '', ?
      )`)
      .bind(
        id,
        member.organisationId,
        legacySystemKey,
        mappingVersion,
        objectKey,
        artifactSha256,
        member.uid,
        createdAt,
      ),
    database.prepare(`INSERT INTO
        compliance_legacy_mapping_artifact_payloads (
          artifact_id,
          organisation_id,
          legacy_system_key,
          mapping_version,
          contract_format,
          canonical_mapping_json,
          artifact_sha256,
          created_by_uid,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        member.organisationId,
        legacySystemKey,
        mappingVersion,
        LEGACY_MAPPING_CONTRACT_FORMAT,
        canonicalMappingJson,
        artifactSha256,
        member.uid,
        createdAt,
      ),
  ]);
  return {
    artifact: publicArtifact({
      id,
      organisation_id: member.organisationId,
      legacy_system_key: legacySystemKey,
      mapping_version: mappingVersion,
      artifact_sha256: artifactSha256,
      payload_artifact_sha256: artifactSha256,
      canonical_mapping_json: canonicalMappingJson,
      contract_format: LEGACY_MAPPING_CONTRACT_FORMAT,
      created_by_uid: member.uid,
      created_at: createdAt,
    }),
  };
}

function cleanDecision(value: unknown): MappingDecision {
  const decision = String(value || "").trim();
  if (
    decision === "approved"
    || decision === "rejected"
    || decision === "withdrawn"
  ) {
    return decision;
  }
  return fail(
    "LEGACY_MAPPING_DECISION_INVALID",
    400,
    "Choose approve, reject or withdraw.",
  );
}

export async function reviewCreditexLegacyMappingArtifact(
  database: D1Database,
  member: MappingActor,
  inputValue: unknown,
  options: { now?: string } = {},
) {
  requireNamedMappingActor(member);
  await ensureCreditexLegacyMappingGuards(database);
  const input = inputRecord(inputValue);
  exactKeys(
    input,
    ["artifactId", "decision", "reviewNote"],
    "LEGACY_MAPPING_REVIEW_REQUEST_INVALID",
    "The review request contains unsupported data.",
  );
  const artifactId = cleanText(
    input.artifactId,
    180,
    "LEGACY_MAPPING_ARTIFACT_INVALID",
    "Choose an immutable mapping artifact.",
  );
  const decision = cleanDecision(input.decision);
  const reviewNote = cleanText(
    input.reviewNote,
    1000,
    "LEGACY_MAPPING_REVIEW_NOTE_REQUIRED",
    "Record the reason for this governance decision.",
  );
  const artifact = await mappingArtifact(
    database,
    member.organisationId,
    artifactId,
  );
  if (!artifact) {
    fail(
      "LEGACY_MAPPING_ARTIFACT_NOT_FOUND",
      404,
      "The mapping artifact was not found in this organisation.",
    );
  }
  await validateStoredMappingArtifact(artifact);
  if (artifact.created_by_uid === member.uid) {
    fail(
      "LEGACY_MAPPING_REVIEW_INDEPENDENCE_REQUIRED",
      409,
      "The mapping author cannot review their own artifact.",
    );
  }
  const current = await latestMappingDecision(
    database,
    member.organisationId,
    artifactId,
  );
  let supersedesDecisionId = "";
  if (decision === "withdrawn") {
    if (!current || current.decision !== "approved") {
      fail(
        "LEGACY_MAPPING_WITHDRAWAL_INVALID",
        409,
        "Only the current approved mapping can be withdrawn.",
      );
    }
    supersedesDecisionId = current.id;
  } else if (current) {
    fail(
      "LEGACY_MAPPING_ALREADY_DECIDED",
      409,
      "This immutable mapping already has a terminal review decision.",
    );
  }
  const reviewedAt = exactTime(
    options.now,
    "LEGACY_MAPPING_REVIEW_TIME_INVALID",
    current?.reviewed_at,
  );
  const record: MappingDecisionRecord = {
    id: crypto.randomUUID(),
    organisation_id: member.organisationId,
    artifact_id: artifact.id,
    legacy_system_key: artifact.legacy_system_key,
    mapping_version: artifact.mapping_version,
    artifact_sha256: artifact.artifact_sha256,
    decision,
    supersedes_decision_id: supersedesDecisionId,
    review_note: reviewNote,
    reviewed_by_uid: member.uid,
    reviewed_at: reviewedAt,
  };
  await database.prepare(`INSERT INTO
      compliance_legacy_mapping_review_decisions (
        id,
        organisation_id,
        artifact_id,
        legacy_system_key,
        mapping_version,
        artifact_sha256,
        decision,
        supersedes_decision_id,
        review_note,
        reviewed_by_uid,
        reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      record.id,
      record.organisation_id,
      record.artifact_id,
      record.legacy_system_key,
      record.mapping_version,
      record.artifact_sha256,
      record.decision,
      record.supersedes_decision_id,
      record.review_note,
      record.reviewed_by_uid,
      record.reviewed_at,
    )
    .run();
  return { decision: publicDecision(record) };
}

export async function requireCurrentApprovedCreditexLegacyMapping(
  database: D1Database,
  member: MappingActor,
  artifactIdValue: unknown,
) {
  requireNamedMappingActor(member);
  await ensureCreditexLegacyMappingGuards(database);
  const artifactId = cleanText(
    artifactIdValue,
    180,
    "LEGACY_MAPPING_CURRENT_APPROVAL_REQUIRED",
    "Choose a currently approved mapping artifact.",
  );
  const artifact = await mappingArtifact(
    database,
    member.organisationId,
    artifactId,
  );
  if (!artifact) {
    fail(
      "LEGACY_MAPPING_CURRENT_APPROVAL_REQUIRED",
      409,
      "The exact mapping artifact does not have current independent approval.",
    );
  }
  const canonicalMappingValue = await validateStoredMappingArtifact(artifact);
  const current = await database.prepare(`SELECT
      artifact_id,
      artifact_sha256,
      approval_decision_id,
      approved_by_uid,
      approved_at
    FROM compliance_current_legacy_mapping_approvals
    WHERE organisation_id = ?
      AND artifact_id = ?
    LIMIT 1`)
    .bind(member.organisationId, artifactId)
    .first<CurrentMappingApprovalRecord>();
  if (
    !current
    || current.artifact_id !== artifact.id
    || current.artifact_sha256 !== artifact.artifact_sha256
  ) {
    fail(
      "LEGACY_MAPPING_CURRENT_APPROVAL_REQUIRED",
      409,
      "The exact mapping artifact does not have current independent approval.",
    );
  }
  return {
    artifact: publicArtifact(artifact, canonicalMappingValue),
    approval: {
      decisionId: current.approval_decision_id,
      approvedByUid: current.approved_by_uid,
      approvedAt: current.approved_at,
    },
  };
}

export async function listCreditexLegacyMappingAuthoring(
  database: D1Database,
  member: MappingActor,
) {
  requireNamedMappingActor(member);
  await ensureCreditexLegacyMappingGuards(database);
  const artifacts = await database.prepare(`SELECT
      artifact.id,
      artifact.organisation_id,
      artifact.legacy_system_key,
      artifact.mapping_version,
      artifact.artifact_sha256,
      payload.artifact_sha256 payload_artifact_sha256,
      payload.canonical_mapping_json,
      payload.contract_format,
      payload.created_by_uid,
      payload.created_at,
      current_decision.id decision_id,
      current_decision.decision,
      current_decision.supersedes_decision_id,
      current_decision.review_note,
      current_decision.reviewed_by_uid,
      current_decision.reviewed_at
    FROM compliance_legacy_mapping_artifacts artifact
    JOIN compliance_legacy_mapping_artifact_payloads payload
      ON payload.artifact_id = artifact.id
      AND payload.organisation_id = artifact.organisation_id
      AND payload.legacy_system_key = artifact.legacy_system_key
      AND payload.mapping_version = artifact.mapping_version
    LEFT JOIN compliance_legacy_mapping_review_decisions current_decision
      ON current_decision.id = (
        SELECT decision.id
        FROM compliance_legacy_mapping_review_decisions decision
        WHERE decision.organisation_id = artifact.organisation_id
          AND decision.artifact_id = artifact.id
        ORDER BY decision.reviewed_at DESC, decision.id DESC
        LIMIT 1
      )
    WHERE artifact.organisation_id = ?
      AND artifact.authorization_state = 'draft'
      AND artifact.artifact_format = 'json'
    ORDER BY artifact.created_at DESC, artifact.id DESC
    LIMIT 200`)
    .bind(member.organisationId)
    .all<ListedMappingArtifactRecord>();
  return {
    artifacts: await Promise.all(artifacts.results.map(async (artifact) => {
      const canonicalMappingValue =
        await validateStoredMappingArtifact(artifact);
      const currentDecision = artifact.decision_id && artifact.decision
        ? publicDecision({
          id: artifact.decision_id,
          organisation_id: artifact.organisation_id,
          artifact_id: artifact.id,
          legacy_system_key: artifact.legacy_system_key,
          mapping_version: artifact.mapping_version,
          artifact_sha256: artifact.artifact_sha256,
          decision: artifact.decision,
          supersedes_decision_id: artifact.supersedes_decision_id || "",
          review_note: artifact.review_note || "",
          reviewed_by_uid: artifact.reviewed_by_uid || "",
          reviewed_at: artifact.reviewed_at || "",
        })
        : null;
      return {
        ...publicArtifact(artifact, canonicalMappingValue),
        currentDecision,
      };
    })),
  };
}
