import type { ComplianceIdentity } from "./compliance-access-server";
import {
  creditexCalculatorEngineContractHash,
  runCreditexCalculatorTestSuite,
  validateCreditexCalculatorSpecification,
  type CreditexCalculatorSpecification,
  type CreditexCalculatorTestVector,
} from "./creditex-calculator-engine.ts";
import type {
  CreditexCustodyBucket,
} from "./creditex-custody-bucket";
import { sha256Hex } from "./creditex-official-source-custody-server.ts";
import {
  CreditexSourceLookupReviewError,
  requireCurrentApprovedOfficialSourceBinding,
} from "./creditex-source-lookup-review-server.ts";

export const CREDITEX_CALCULATOR_AUTHORING_CONTRACT =
  "creditex-calculator-draft-authoring/v2" as const;
export const CREDITEX_CALCULATOR_VECTOR_AUTHORING_CONTRACT =
  "creditex-calculator-vector-authoring/v2" as const;
export const CREDITEX_CALCULATOR_AUTHORING_LIMITS = Object.freeze({
  maximumRequestBytes: 256 * 1024,
  maximumReturnedDrafts: 100,
  maximumCitationLength: 500,
});
export const CREDITEX_BOOTSTRAP_MAILBOX =
  "info@ausenergyassessments.com" as const;

type CalculatorAuthoringMember = Pick<
  ComplianceIdentity,
  | "uid"
  | "email"
  | "displayName"
  | "organisationId"
  | "role"
  | "governanceIdentityVerified"
>;

type SourceContextRecord = {
  activity_version_id: string;
  activity_publish_state: string;
  activity_official_source_sha256: string;
  source_artifact_id: string;
  source_url: string;
  source_title: string;
  source_version: string;
  source_size_bytes: number;
  source_sha256: string;
  source_object_key: string;
  source_custody_state: string;
  activity_source_binding_id: string;
  activity_source_binding_state: string;
};

type CalculatorDraftRecord = {
  receipt_id: string;
  client_request_id: string;
  request_sha256: string;
  calculator_version_id: string;
  activity_version_id: string;
  calculator_key: string;
  version: number;
  title: string;
  output_type: string;
  specification: string;
  rounding_policy: string;
  approval_state: string;
  source_artifact_id: string;
  activity_source_binding_id: string;
  calculator_source_binding_id: string;
  official_source_url: string;
  official_source_title: string;
  official_source_version: string;
  official_source_sha256: string;
  calculator_official_source_url: string;
  calculator_official_source_version: string;
  calculator_official_source_sha256: string;
  source_citation: string;
  specification_sha256: string;
  engine_contract_hash: string;
  authoring_contract_sha256: string;
  authoring_state: string;
  created_by_uid: string;
  created_at: string;
  calculator_created_by_uid: string;
  calculator_created_at: string;
};

type CalculatorVectorRecord = {
  receipt_id: string;
  client_request_id: string;
  request_sha256: string;
  vector_id: string;
  calculator_version_id: string;
  source_artifact_id: string;
  activity_source_binding_id: string;
  source_artifact_sha256: string;
  vector_key: string;
  input_snapshot: string;
  expected_output: string;
  tolerance_snapshot: string;
  source_citation: string;
  input_sha256: string;
  expected_output_sha256: string;
  source_citation_sha256: string;
  vector_contract_sha256: string;
  authoring_state: string;
  created_by_uid: string;
  created_at: string;
  vector_created_by_uid: string;
  vector_created_at: string;
};

type UnknownRecord = Record<string, unknown>;

export class CreditexCalculatorAuthoringError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexCalculatorAuthoringError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexCalculatorAuthoringError(code, status, message);
}

function recordValue(
  value: unknown,
  code: string,
  message: string,
): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, 400, message);
  }
  return value as UnknownRecord;
}

function exactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  code: string,
  message: string,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    fail(code, 400, message);
  }
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
) {
  const cleaned = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : "";
  if (!cleaned || cleaned.length > maximum) {
    fail(code, 400, message);
  }
  return cleaned;
}

function cleanClientRequestId(value: unknown) {
  const cleaned = cleanText(
    value,
    120,
    "CALCULATOR_REQUEST_ID_INVALID",
    "Add a stable calculator authoring request reference.",
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(cleaned)) {
    fail(
      "CALCULATOR_REQUEST_ID_INVALID",
      400,
      "Add a stable calculator authoring request reference.",
    );
  }
  return cleaned;
}

function cleanIdentifier(value: unknown, label: string) {
  return cleanText(
    value,
    180,
    "CALCULATOR_REFERENCE_INVALID",
    `Choose the exact ${label}.`,
  );
}

function requireNamedGovernanceMember(member: CalculatorAuthoringMember) {
  const namedRole = member.role === "admin" || member.role === "reviewer";
  const bootstrapMailbox =
    String(member.email || "").trim().toLowerCase()
      === CREDITEX_BOOTSTRAP_MAILBOX;
  if (
    !namedRole
    || !member.governanceIdentityVerified
    || !String(member.displayName || "").trim()
    || bootstrapMailbox
  ) {
    fail(
      "CALCULATOR_NAMED_GOVERNANCE_REQUIRED",
      403,
      "A named, governance-verified Creditex administrator or reviewer is required to author calculator drafts.",
    );
  }
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 50) {
    fail(
      "CALCULATOR_AUTHORING_PAYLOAD_INVALID",
      400,
      "The calculator authoring payload is too deeply nested.",
    );
  }
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        "CALCULATOR_AUTHORING_PAYLOAD_INVALID",
        400,
        "The calculator authoring payload contains a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as UnknownRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => (
      `${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`
    )).join(",")}}`;
  }
  fail(
    "CALCULATOR_AUTHORING_PAYLOAD_INVALID",
    400,
    "The calculator authoring payload contains an unsupported value.",
  );
}

async function textSha256(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

function outputType(specification: CreditexCalculatorSpecification) {
  const supported = new Set([
    "STC",
    "VEEC",
    "ESC",
    "PRC",
    "GJ",
    "dollars",
  ]);
  return supported.has(specification.output.unit)
    ? specification.output.unit
    : "other";
}

function calculationPolicies(specification: CreditexCalculatorSpecification) {
  return canonicalJson({
    schemaVersion: "creditex-calculation-policy/v1",
    roundingSteps: specification.steps
      .filter((step) => step.kind === "rounding")
      .map((step) => ({
        key: step.key,
        source: step.source,
        unit: step.unit,
        mode: step.mode,
        decimalPlaces: step.decimalPlaces,
      })),
    capSteps: specification.steps
      .filter((step) => step.kind === "cap")
      .map((step) => ({
        key: step.key,
        source: step.source,
        unit: step.unit,
        minimum: step.minimum || "",
        maximum: step.maximum || "",
      })),
  });
}

function engineCaseHashHex(value: string, label: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail(
      "CALCULATOR_ENGINE_HASH_INVALID",
      500,
      `The calculator engine returned an invalid ${label} hash.`,
    );
  }
  return value.slice(7);
}

function canonicalVectorHashes(
  specification: CreditexCalculatorSpecification,
  vector: CreditexCalculatorTestVector,
) {
  const suite = runCreditexCalculatorTestSuite(specification, [vector]);
  const result = suite.cases[0];
  if (!result || result.key !== vector.key) {
    fail(
      "CALCULATOR_VECTOR_CONTRACT_INVALID",
      500,
      "The calculator engine did not return the requested vector case.",
    );
  }
  return {
    inputSha256: engineCaseHashHex(result.inputHash, "input"),
    expectedOutputSha256: engineCaseHashHex(
      result.expectedOutputHash,
      "expected output",
    ),
  };
}

async function draftRequestSha256(input: {
  clientRequestId: string;
  organisationId: string;
  activityVersionId: string;
  sourceArtifactId: string;
  activitySourceBindingId: string;
  sourceCitation: string;
  sourceArtifactSha256: string;
  specificationSha256: string;
  engineContractHash: string;
}) {
  return textSha256(canonicalJson({
    contract: CREDITEX_CALCULATOR_AUTHORING_CONTRACT,
    ...input,
  }));
}

async function draftAuthoringContractSha256(input: {
  calculatorVersionId: string;
  activityVersionId: string;
  sourceArtifactId: string;
  activitySourceBindingId: string;
  calculatorSourceBindingId: string;
  sourceArtifactSha256: string;
  sourceCitation: string;
  specificationSha256: string;
  engineContractHash: string;
  calculationPolicy: UnknownRecord;
}) {
  return textSha256(canonicalJson({
    contract: CREDITEX_CALCULATOR_AUTHORING_CONTRACT,
    ...input,
    authoringState: "pending_review",
    approvalState: "draft",
    estimateEnabled: false,
  }));
}

async function vectorRequestSha256(input: {
  clientRequestId: string;
  organisationId: string;
  calculatorVersionId: string;
  vectorKey: string;
  sourceArtifactId: string;
  activitySourceBindingId: string;
  sourceArtifactSha256: string;
  inputSha256: string;
  expectedOutputSha256: string;
  sourceCitationSha256: string;
}) {
  return textSha256(canonicalJson({
    contract: CREDITEX_CALCULATOR_VECTOR_AUTHORING_CONTRACT,
    ...input,
  }));
}

async function vectorAuthoringContractSha256(input: {
  calculatorVersionId: string;
  vectorId: string;
  vectorKey: string;
  sourceArtifactId: string;
  activitySourceBindingId: string;
  sourceArtifactSha256: string;
  inputSha256: string;
  expectedOutputSha256: string;
  sourceCitationSha256: string;
  toleranceSha256: string;
}) {
  return textSha256(canonicalJson({
    contract: CREDITEX_CALCULATOR_VECTOR_AUTHORING_CONTRACT,
    ...input,
    authoringState: "pending_review",
    result: "not_run",
  }));
}

function storedIntegrityFailure(message: string): never {
  fail(
    "CALCULATOR_STORED_INTEGRITY_FAILED",
    409,
    message,
  );
}

async function sourceContext(
  database: D1Database,
  organisationId: string,
  activityVersionId: string,
  sourceArtifactId: string,
  activitySourceBindingId: string,
) {
  const context = await database.prepare(`SELECT
      activity.id activity_version_id,
      activity.publish_state activity_publish_state,
      activity.official_source_sha256 activity_official_source_sha256,
      artifact.id source_artifact_id,
      artifact.source_url,
      artifact.source_title,
      artifact.source_version,
      artifact.size_bytes source_size_bytes,
      artifact.sha256 source_sha256,
      artifact.object_key source_object_key,
      artifact.custody_state source_custody_state,
      binding.id activity_source_binding_id,
      binding.binding_state activity_source_binding_state
    FROM compliance_activity_versions activity
    JOIN compliance_programs program
      ON program.id = activity.program_id
      AND program.organisation_id = ?
      AND program.publish_state IN ('draft', 'published')
    JOIN compliance_official_source_bindings binding
      ON binding.id = ?
      AND binding.organisation_id = program.organisation_id
      AND binding.target_type = 'activity'
      AND binding.target_id = activity.id
      AND binding.rule_activation_enabled = 0
      AND binding.binding_state IN ('draft', 'pending_review')
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = ?
      AND artifact.organisation_id = binding.organisation_id
      AND artifact.id = binding.artifact_id
      AND artifact.rule_activation_enabled = 0
      AND artifact.custody_state IN ('draft', 'pending_review')
    WHERE activity.id = ?
      AND activity.publish_state IN ('draft', 'published')
    LIMIT 1`)
    .bind(
      organisationId,
      activitySourceBindingId,
      sourceArtifactId,
      activityVersionId,
    )
    .first<SourceContextRecord>();
  if (!context) {
    fail(
      "CALCULATOR_SOURCE_BINDING_REQUIRED",
      409,
      "The calculator draft requires one retained official source artifact bound to this governed activity version.",
    );
  }
  if (
    context.activity_publish_state === "published"
    && context.activity_official_source_sha256 !== context.source_sha256
  ) {
    fail(
      "CALCULATOR_SOURCE_BINDING_MISMATCH",
      409,
      "The published activity and retained calculator source do not share the exact source hash.",
    );
  }
  return context;
}

async function verifyRetainedSource(
  bucket: CreditexCustodyBucket,
  source: SourceContextRecord,
) {
  const object = await bucket.get(source.source_object_key);
  if (!object) {
    fail(
      "CALCULATOR_SOURCE_BYTES_MISSING",
      409,
      "The exact retained source bytes are unavailable.",
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== Number(source.source_size_bytes)
    || (
      Number.isFinite(Number(object.size))
      && Number(object.size) > 0
      && Number(object.size) !== bytes.byteLength
    )
    || await sha256Hex(bytes) !== source.source_sha256
  ) {
    fail(
      "CALCULATOR_SOURCE_BYTES_CHANGED",
      409,
      "The retained source bytes no longer match their exact custody record.",
    );
  }
}

async function requireApprovedRetainedSource(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  organisationId: string,
  activityVersionId: string,
  sourceArtifactId: string,
  activitySourceBindingId: string,
  expectedSourceArtifactSha256 = "",
) {
  const source = await sourceContext(
    database,
    organisationId,
    activityVersionId,
    sourceArtifactId,
    activitySourceBindingId,
  );
  if (
    expectedSourceArtifactSha256
    && source.source_sha256 !== expectedSourceArtifactSha256
  ) {
    storedIntegrityFailure(
      "The stored calculator source hash no longer matches its retained artifact.",
    );
  }
  let approvedActivitySourceBindingId = "";
  try {
    approvedActivitySourceBindingId =
      await requireCurrentApprovedOfficialSourceBinding(
        database,
        organisationId,
        "activity",
        activityVersionId,
        source.source_sha256,
      );
  } catch (error) {
    if (
      !(error instanceof CreditexSourceLookupReviewError)
      || error.code !== "SOURCE_BINDING_APPROVAL_REQUIRED"
    ) {
      throw error;
    }
    fail(
      "CALCULATOR_SOURCE_APPROVAL_REQUIRED",
      409,
      "The exact retained activity source and binding require current independent approval.",
    );
  }
  if (approvedActivitySourceBindingId !== activitySourceBindingId) {
    fail(
      "CALCULATOR_SOURCE_APPROVAL_REQUIRED",
      409,
      "The selected activity source binding is not the currently approved exact binding.",
    );
  }
  await verifyRetainedSource(bucket, source);
  return source;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    fail(
      "CALCULATOR_STORED_DATA_INVALID",
      500,
      `The stored ${label} is not valid JSON.`,
    );
  }
}

async function validatedDraftContent(
  record: CalculatorDraftRecord,
  organisationId: string,
) {
  let specification: CreditexCalculatorSpecification;
  try {
    specification = validateCreditexCalculatorSpecification(
      parseJson<unknown>(
        record.specification,
        "calculator specification",
      ),
    );
  } catch {
    storedIntegrityFailure(
      "The stored calculator specification no longer validates.",
    );
  }
  const specificationJson = canonicalJson(specification);
  const specificationSha256 = await textSha256(specificationJson);
  const engineContractHash = creditexCalculatorEngineContractHash(
    specification,
  );
  const calculationPolicyJson = calculationPolicies(specification);
  const calculationPolicy = parseJson<UnknownRecord>(
    calculationPolicyJson,
    "calculator policy",
  );
  const requestSha256 = await draftRequestSha256({
    clientRequestId: record.client_request_id,
    organisationId,
    activityVersionId: record.activity_version_id,
    sourceArtifactId: record.source_artifact_id,
    activitySourceBindingId: record.activity_source_binding_id,
    sourceCitation: record.source_citation,
    sourceArtifactSha256: record.official_source_sha256,
    specificationSha256,
    engineContractHash,
  });
  const authoringContractSha256 =
    await draftAuthoringContractSha256({
      calculatorVersionId: record.calculator_version_id,
      activityVersionId: record.activity_version_id,
      sourceArtifactId: record.source_artifact_id,
      activitySourceBindingId: record.activity_source_binding_id,
      calculatorSourceBindingId: record.calculator_source_binding_id,
      sourceArtifactSha256: record.official_source_sha256,
      sourceCitation: record.source_citation,
      specificationSha256,
      engineContractHash,
      calculationPolicy,
    });
  if (
    record.approval_state !== "draft"
    || record.authoring_state !== "pending_review"
    || record.specification !== specificationJson
    || record.rounding_policy !== calculationPolicyJson
    || record.calculator_key !== specification.key
    || Number(record.version) !== specification.version
    || record.title !== specification.title
    || record.output_type !== outputType(specification)
    || record.calculator_official_source_url !== record.official_source_url
    || record.calculator_official_source_version
      !== record.official_source_version
    || record.calculator_official_source_sha256
      !== record.official_source_sha256
    || record.calculator_created_by_uid !== record.created_by_uid
    || record.calculator_created_at !== record.created_at
    || record.specification_sha256 !== specificationSha256
    || record.engine_contract_hash !== engineContractHash
    || record.request_sha256 !== requestSha256
    || record.authoring_contract_sha256 !== authoringContractSha256
  ) {
    storedIntegrityFailure(
      "The stored calculator draft no longer matches its immutable authoring receipts.",
    );
  }
  return { specification, calculationPolicy };
}

async function validatedPublicVector(
  record: CalculatorVectorRecord,
  draft: CalculatorDraftRecord,
  specification: CreditexCalculatorSpecification,
  organisationId: string,
) {
  const inputs = parseJson<UnknownRecord>(
    record.input_snapshot,
    "vector input",
  );
  const expected = parseJson<UnknownRecord>(
    record.expected_output,
    "vector expected output",
  );
  const tolerance = parseJson<UnknownRecord>(
    record.tolerance_snapshot,
    "vector tolerance",
  );
  let canonicalHashes: ReturnType<typeof canonicalVectorHashes>;
  try {
    canonicalHashes = canonicalVectorHashes(specification, {
      key: record.vector_key,
      inputs: inputs as CreditexCalculatorTestVector["inputs"],
      expected: expected as CreditexCalculatorTestVector["expected"],
    });
  } catch {
    storedIntegrityFailure(
      "The stored authoritative vector no longer validates against its calculator draft.",
    );
  }
  const sourceCitationSha256 = await textSha256(record.source_citation);
  const toleranceSnapshot = canonicalJson(tolerance);
  const toleranceSha256 = await textSha256(toleranceSnapshot);
  const requestSha256 = await vectorRequestSha256({
    clientRequestId: record.client_request_id,
    organisationId,
    calculatorVersionId: record.calculator_version_id,
    vectorKey: record.vector_key,
    sourceArtifactId: record.source_artifact_id,
    activitySourceBindingId: record.activity_source_binding_id,
    sourceArtifactSha256: record.source_artifact_sha256,
    inputSha256: canonicalHashes.inputSha256,
    expectedOutputSha256: canonicalHashes.expectedOutputSha256,
    sourceCitationSha256,
  });
  const vectorContractSha256 =
    await vectorAuthoringContractSha256({
      calculatorVersionId: record.calculator_version_id,
      vectorId: record.vector_id,
      vectorKey: record.vector_key,
      sourceArtifactId: record.source_artifact_id,
      activitySourceBindingId: record.activity_source_binding_id,
      sourceArtifactSha256: record.source_artifact_sha256,
      inputSha256: canonicalHashes.inputSha256,
      expectedOutputSha256: canonicalHashes.expectedOutputSha256,
      sourceCitationSha256,
      toleranceSha256,
    });
  if (
    record.authoring_state !== "pending_review"
    || record.calculator_version_id !== draft.calculator_version_id
    || record.source_artifact_id !== draft.source_artifact_id
    || record.activity_source_binding_id
      !== draft.activity_source_binding_id
    || record.source_artifact_sha256 !== draft.official_source_sha256
    || record.created_by_uid === draft.created_by_uid
    || record.vector_created_by_uid !== record.created_by_uid
    || record.vector_created_at !== record.created_at
    || toleranceSnapshot !== "{}"
    || record.tolerance_snapshot !== "{}"
    || record.input_sha256 !== canonicalHashes.inputSha256
    || record.expected_output_sha256
      !== canonicalHashes.expectedOutputSha256
    || record.source_citation_sha256 !== sourceCitationSha256
    || record.request_sha256 !== requestSha256
    || record.vector_contract_sha256 !== vectorContractSha256
  ) {
    storedIntegrityFailure(
      "The stored authoritative vector no longer matches its immutable authoring receipt.",
    );
  }
  return {
    id: record.vector_id,
    clientRequestId: record.client_request_id,
    calculatorVersionId: record.calculator_version_id,
    vectorKey: record.vector_key,
    inputs,
    expected,
    tolerance,
    sourceCitation: record.source_citation,
    sourceArtifactId: record.source_artifact_id,
    activitySourceBindingId: record.activity_source_binding_id,
    sourceArtifactSha256: record.source_artifact_sha256,
    inputSha256: record.input_sha256,
    expectedOutputSha256: record.expected_output_sha256,
    sourceCitationSha256: record.source_citation_sha256,
    vectorContractSha256: record.vector_contract_sha256,
    authoringState: "pending_review" as const,
    result: "not_run" as const,
    computedReceipt: null,
    createdByUid: record.created_by_uid,
    createdAt: record.created_at,
  };
}

async function validatedPublicDraft(
  record: CalculatorDraftRecord,
  vectors: CalculatorVectorRecord[],
  organisationId: string,
  reused?: boolean,
) {
  const validated = await validatedDraftContent(record, organisationId);
  const publicVectors = await Promise.all(vectors.map((vector) => (
    validatedPublicVector(
      vector,
      record,
      validated.specification,
      organisationId,
    )
  )));
  return {
    id: record.calculator_version_id,
    clientRequestId: record.client_request_id,
    activityVersionId: record.activity_version_id,
    calculatorKey: record.calculator_key,
    version: Number(record.version),
    title: record.title,
    outputType: record.output_type,
    specification: validated.specification,
    calculationPolicy: validated.calculationPolicy,
    approvalState: "draft" as const,
    authoringState: "pending_review" as const,
    sourceArtifactId: record.source_artifact_id,
    activitySourceBindingId: record.activity_source_binding_id,
    calculatorSourceBindingId: record.calculator_source_binding_id,
    officialSourceUrl: record.official_source_url,
    officialSourceTitle: record.official_source_title,
    officialSourceVersion: record.official_source_version,
    officialSourceSha256: record.official_source_sha256,
    specificationSha256: record.specification_sha256,
    engineContractHash: record.engine_contract_hash,
    authoringContractSha256: record.authoring_contract_sha256,
    estimateEnabled: false,
    calculationExecutionEnabled: false,
    certificateCreationEnabled: false,
    vectors: publicVectors,
    createdByUid: record.created_by_uid,
    createdAt: record.created_at,
    ...(reused === undefined ? {} : { reused }),
  };
}

async function draftRecords(
  database: D1Database,
  organisationId: string,
  calculatorVersionId = "",
) {
  const result = await database.prepare(`SELECT
      receipt.id receipt_id,
      receipt.client_request_id,
      receipt.request_sha256,
      calculator.id calculator_version_id,
      calculator.activity_version_id,
      calculator.calculator_key,
      calculator.version,
      calculator.title,
      calculator.output_type,
      calculator.specification,
      calculator.rounding_policy,
      calculator.approval_state,
      receipt.source_artifact_id,
      receipt.activity_source_binding_id,
      receipt.calculator_source_binding_id,
      artifact.source_url official_source_url,
      artifact.source_title official_source_title,
      artifact.source_version official_source_version,
      receipt.source_artifact_sha256 official_source_sha256,
      calculator.official_source_url calculator_official_source_url,
      calculator.official_source_version calculator_official_source_version,
      calculator.official_source_sha256 calculator_official_source_sha256,
      calculator_binding.citation_location source_citation,
      receipt.specification_sha256,
      receipt.engine_contract_hash,
      receipt.authoring_contract_sha256,
      receipt.authoring_state,
      receipt.created_by_uid,
      receipt.created_at,
      calculator.created_by_uid calculator_created_by_uid,
      calculator.created_at calculator_created_at
    FROM compliance_calculator_authoring_receipts receipt
    JOIN compliance_calculator_versions calculator
      ON calculator.id = receipt.calculator_version_id
      AND calculator.organisation_id = receipt.organisation_id
      AND calculator.approval_state = 'draft'
    JOIN compliance_official_source_artifacts artifact
      ON artifact.id = receipt.source_artifact_id
      AND artifact.organisation_id = receipt.organisation_id
      AND artifact.sha256 = receipt.source_artifact_sha256
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
    JOIN compliance_official_source_bindings activity_binding
      ON activity_binding.id = receipt.activity_source_binding_id
      AND activity_binding.organisation_id = receipt.organisation_id
      AND activity_binding.artifact_id = receipt.source_artifact_id
      AND activity_binding.target_type = 'activity'
      AND activity_binding.target_id = receipt.activity_version_id
      AND activity_binding.binding_state IN ('draft', 'pending_review')
      AND activity_binding.rule_activation_enabled = 0
    JOIN compliance_official_source_bindings calculator_binding
      ON calculator_binding.id = receipt.calculator_source_binding_id
      AND calculator_binding.organisation_id = receipt.organisation_id
      AND calculator_binding.artifact_id = receipt.source_artifact_id
      AND calculator_binding.target_type = 'calculator'
      AND calculator_binding.target_id = receipt.calculator_version_id
      AND calculator_binding.binding_state IN ('draft', 'pending_review')
      AND calculator_binding.rule_activation_enabled = 0
    WHERE receipt.organisation_id = ?
      AND receipt.authoring_state = 'pending_review'
      AND (? = '' OR receipt.calculator_version_id = ?)
    ORDER BY receipt.created_at DESC, receipt.id DESC
    LIMIT ?`)
    .bind(
      organisationId,
      calculatorVersionId,
      calculatorVersionId,
      CREDITEX_CALCULATOR_AUTHORING_LIMITS.maximumReturnedDrafts,
    )
    .all<CalculatorDraftRecord>();
  return result.results;
}

async function vectorRecords(
  database: D1Database,
  organisationId: string,
  calculatorIds: readonly string[],
) {
  if (!calculatorIds.length) return [] as CalculatorVectorRecord[];
  const placeholders = calculatorIds.map(() => "?").join(",");
  const result = await database.prepare(`SELECT
      receipt.id receipt_id,
      receipt.client_request_id,
      receipt.request_sha256,
      vector.id vector_id,
      vector.calculator_version_id,
      receipt.source_artifact_id,
      receipt.activity_source_binding_id,
      receipt.source_artifact_sha256,
      vector.vector_key,
      vector.input_snapshot,
      vector.expected_output,
      vector.tolerance_snapshot,
      vector.source_citation,
      receipt.input_sha256,
      receipt.expected_output_sha256,
      receipt.source_citation_sha256,
      receipt.vector_contract_sha256,
      receipt.authoring_state,
      receipt.created_by_uid,
      receipt.created_at,
      vector.created_by_uid vector_created_by_uid,
      vector.created_at vector_created_at
    FROM compliance_calculator_vector_authoring_receipts receipt
    JOIN compliance_calculator_test_vectors vector
      ON vector.id = receipt.vector_id
      AND vector.calculator_version_id = receipt.calculator_version_id
      AND vector.last_result = 'not_run'
      AND vector.last_run_at = ''
    WHERE receipt.organisation_id = ?
      AND receipt.authoring_state = 'pending_review'
      AND receipt.calculator_version_id IN (${placeholders})
    ORDER BY receipt.created_at, receipt.id`)
    .bind(organisationId, ...calculatorIds)
    .all<CalculatorVectorRecord>();
  return result.results;
}

async function onePublicDraft(
  database: D1Database,
  organisationId: string,
  calculatorVersionId: string,
  reused?: boolean,
) {
  const records = await draftRecords(
    database,
    organisationId,
    calculatorVersionId,
  );
  const record = records[0];
  if (!record) {
    fail(
      "CALCULATOR_DRAFT_NOT_FOUND",
      404,
      "The calculator draft was not found in this Creditex organisation.",
    );
  }
  const vectors = await vectorRecords(
    database,
    organisationId,
    [calculatorVersionId],
  );
  return validatedPublicDraft(
    record,
    vectors,
    organisationId,
    reused,
  );
}

export async function listCreditexCalculatorDrafts(
  database: D1Database,
  member: CalculatorAuthoringMember,
  calculatorVersionIdValue: unknown = "",
) {
  requireNamedGovernanceMember(member);
  const calculatorVersionId = String(calculatorVersionIdValue || "").trim();
  if (calculatorVersionId.length > 180) {
    fail(
      "CALCULATOR_REFERENCE_INVALID",
      400,
      "Choose a valid calculator draft.",
    );
  }
  const records = await draftRecords(
    database,
    member.organisationId,
    calculatorVersionId,
  );
  const vectors = await vectorRecords(
    database,
    member.organisationId,
    records.map((record) => record.calculator_version_id),
  );
  const vectorsByCalculator = new Map<string, CalculatorVectorRecord[]>();
  for (const vector of vectors) {
    const current = vectorsByCalculator.get(vector.calculator_version_id) || [];
    current.push(vector);
    vectorsByCalculator.set(vector.calculator_version_id, current);
  }
  return Promise.all(records.map((record) => validatedPublicDraft(
    record,
    vectorsByCalculator.get(record.calculator_version_id) || [],
    member.organisationId,
  )));
}

export async function createCreditexCalculatorDraft(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: CalculatorAuthoringMember,
  inputValue: unknown,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireNamedGovernanceMember(member);
  const input = recordValue(
    inputValue,
    "CALCULATOR_DRAFT_INVALID",
    "Enter a valid calculator draft.",
  );
  exactKeys(
    input,
    [
      "clientRequestId",
      "activityVersionId",
      "sourceArtifactId",
      "activitySourceBindingId",
      "sourceCitation",
      "specification",
    ],
    "CALCULATOR_DRAFT_FIELDS_INVALID",
    "Calculator drafts accept only source identity and exact specification fields.",
  );
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const activityVersionId = cleanIdentifier(
    input.activityVersionId,
    "governed activity version",
  );
  const sourceArtifactId = cleanIdentifier(
    input.sourceArtifactId,
    "retained source artifact",
  );
  const activitySourceBindingId = cleanIdentifier(
    input.activitySourceBindingId,
    "activity source binding",
  );
  const sourceCitation = cleanText(
    input.sourceCitation,
    CREDITEX_CALCULATOR_AUTHORING_LIMITS.maximumCitationLength,
    "CALCULATOR_SOURCE_CITATION_INVALID",
    "Add the exact official formula clause or table citation.",
  );
  let specification: CreditexCalculatorSpecification;
  try {
    specification = validateCreditexCalculatorSpecification(
      input.specification,
    );
  } catch (error) {
    fail(
      "CALCULATOR_SPECIFICATION_INVALID",
      400,
      error instanceof Error
        ? error.message
        : "The calculator specification is invalid.",
    );
  }
  const source = await requireApprovedRetainedSource(
    database,
    bucket,
    member.organisationId,
    activityVersionId,
    sourceArtifactId,
    activitySourceBindingId,
  );
  const specificationJson = canonicalJson(specification);
  const specificationSha256 = await textSha256(specificationJson);
  const engineContractHash = creditexCalculatorEngineContractHash(
    specification,
  );
  const policy = calculationPolicies(specification);
  const requestSha256 = await draftRequestSha256({
    clientRequestId,
    organisationId: member.organisationId,
    activityVersionId,
    sourceArtifactId,
    activitySourceBindingId,
    sourceCitation,
    sourceArtifactSha256: source.source_sha256,
    specificationSha256,
    engineContractHash,
  });
  const existing = await database.prepare(`SELECT
      calculator_version_id,
      request_sha256
    FROM compliance_calculator_authoring_receipts
    WHERE organisation_id = ?
      AND client_request_id = ?
    LIMIT 1`)
    .bind(member.organisationId, clientRequestId)
    .first<{ calculator_version_id: string; request_sha256: string }>();
  if (existing) {
    if (existing.request_sha256 !== requestSha256) {
      fail(
        "CALCULATOR_REQUEST_CONFLICT",
        409,
        "This calculator authoring request reference was already used for different immutable content.",
      );
    }
    return {
      draft: await onePublicDraft(
        database,
        member.organisationId,
        existing.calculator_version_id,
        true,
      ),
    };
  }
  const duplicate = await database.prepare(`SELECT id
    FROM compliance_calculator_versions
    WHERE organisation_id = ?
      AND activity_version_id = ?
      AND calculator_key = ?
      AND version = ?
    LIMIT 1`)
    .bind(
      member.organisationId,
      activityVersionId,
      specification.key,
      specification.version,
    )
    .first<{ id: string }>();
  if (duplicate) {
    fail(
      "CALCULATOR_VERSION_DUPLICATE",
      409,
      "This activity already has the same calculator key and version.",
    );
  }
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const calculatorVersionId = `calculator:${idFactory()}`;
  const calculatorSourceBindingId = `calculator-binding:${idFactory()}`;
  const receiptId = `calculator-authoring:${idFactory()}`;
  const now = options.now || new Date().toISOString();
  const authoringContractSha256 = await draftAuthoringContractSha256({
    calculatorVersionId,
    activityVersionId,
    sourceArtifactId,
    activitySourceBindingId,
    calculatorSourceBindingId,
    sourceArtifactSha256: source.source_sha256,
    sourceCitation,
    specificationSha256,
    engineContractHash,
    calculationPolicy: parseJson<UnknownRecord>(
      policy,
      "calculator policy",
    ),
  });
  await database.batch([
    database.prepare(`INSERT INTO compliance_calculator_versions (
        id, organisation_id, activity_version_id, calculator_key, version,
        title, output_type, specification, rounding_policy,
        official_source_url, official_source_version,
        official_source_sha256, approval_state, primary_approver_uid,
        secondary_approver_uid, approved_at, withdrawn_at,
        created_by_uid, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', '', '', '', ?, ?, ?
      )`).bind(
      calculatorVersionId,
      member.organisationId,
      activityVersionId,
      specification.key,
      specification.version,
      specification.title,
      outputType(specification),
      specificationJson,
      policy,
      source.source_url,
      source.source_version,
      source.source_sha256,
      member.uid,
      now,
      now,
    ),
    database.prepare(`INSERT INTO compliance_official_source_bindings (
        id, organisation_id, artifact_id, target_type, target_id,
        citation_location, binding_state, rule_activation_enabled,
        created_by_uid, created_at
      ) VALUES (?, ?, ?, 'calculator', ?, ?, 'pending_review', 0, ?, ?)`)
      .bind(
        calculatorSourceBindingId,
        member.organisationId,
        sourceArtifactId,
        calculatorVersionId,
        sourceCitation,
        member.uid,
        now,
      ),
    database.prepare(`INSERT INTO compliance_calculator_authoring_receipts (
        id, organisation_id, client_request_id, request_sha256,
        calculator_version_id, activity_version_id, source_artifact_id,
        activity_source_binding_id, calculator_source_binding_id,
        source_artifact_sha256, specification_sha256, engine_contract_hash,
        authoring_contract_sha256, authoring_state, created_by_uid, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?
      )`).bind(
      receiptId,
      member.organisationId,
      clientRequestId,
      requestSha256,
      calculatorVersionId,
      activityVersionId,
      sourceArtifactId,
      activitySourceBindingId,
      calculatorSourceBindingId,
      source.source_sha256,
      specificationSha256,
      engineContractHash,
      authoringContractSha256,
      member.uid,
      now,
    ),
  ]);
  return {
    draft: await onePublicDraft(
      database,
      member.organisationId,
      calculatorVersionId,
      false,
    ),
  };
}

export async function appendCreditexCalculatorVector(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: CalculatorAuthoringMember,
  inputValue: unknown,
  options: {
    now?: string;
    idFactory?: () => string;
  } = {},
) {
  requireNamedGovernanceMember(member);
  const input = recordValue(
    inputValue,
    "CALCULATOR_VECTOR_INVALID",
    "Enter a valid authoritative calculator vector.",
  );
  exactKeys(
    input,
    [
      "clientRequestId",
      "calculatorVersionId",
      "vectorKey",
      "inputs",
      "expected",
      "sourceCitation",
    ],
    "CALCULATOR_VECTOR_FIELDS_INVALID",
    "Calculator vectors accept only exact authoritative input and expected-output fields.",
  );
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const calculatorVersionId = cleanIdentifier(
    input.calculatorVersionId,
    "calculator draft",
  );
  const vectorKey = cleanText(
    input.vectorKey,
    64,
    "CALCULATOR_VECTOR_KEY_INVALID",
    "Add a stable authoritative vector key.",
  );
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(vectorKey)) {
    fail(
      "CALCULATOR_VECTOR_KEY_INVALID",
      400,
      "Use a lower-case authoritative vector key with letters, numbers or underscores.",
    );
  }
  const sourceCitation = cleanText(
    input.sourceCitation,
    CREDITEX_CALCULATOR_AUTHORING_LIMITS.maximumCitationLength,
    "CALCULATOR_VECTOR_CITATION_INVALID",
    "Add the exact official source citation for this vector.",
  );
  const drafts = await draftRecords(
    database,
    member.organisationId,
    calculatorVersionId,
  );
  const draft = drafts[0];
  if (!draft) {
    fail(
      "CALCULATOR_DRAFT_NOT_FOUND",
      404,
      "The calculator draft was not found in this Creditex organisation.",
    );
  }
  if (draft.created_by_uid === member.uid) {
    fail(
      "CALCULATOR_VECTOR_INDEPENDENT_AUTHOR_REQUIRED",
      403,
      "A different named governance member must author the authoritative vector.",
    );
  }
  const validatedDraft = await validatedDraftContent(
    draft,
    member.organisationId,
  );
  await requireApprovedRetainedSource(
    database,
    bucket,
    member.organisationId,
    draft.activity_version_id,
    draft.source_artifact_id,
    draft.activity_source_binding_id,
    draft.official_source_sha256,
  );
  const specification = validatedDraft.specification;
  const vector: CreditexCalculatorTestVector = {
    key: vectorKey,
    inputs: recordValue(
      input.inputs,
      "CALCULATOR_VECTOR_INPUT_INVALID",
      "Add the exact typed vector inputs.",
    ) as CreditexCalculatorTestVector["inputs"],
    expected: recordValue(
      input.expected,
      "CALCULATOR_VECTOR_OUTPUT_INVALID",
      "Add the exact typed expected output.",
    ) as CreditexCalculatorTestVector["expected"],
  };
  let canonicalHashes: ReturnType<typeof canonicalVectorHashes>;
  try {
    // The engine canonicalises the typed input and expected output. Its
    // execution result and receipt are deliberately discarded.
    canonicalHashes = canonicalVectorHashes(specification, vector);
  } catch (error) {
    fail(
      "CALCULATOR_VECTOR_CONTRACT_INVALID",
      400,
      error instanceof Error
        ? error.message
        : "The authoritative vector contract is invalid.",
    );
  }
  const inputSnapshot = canonicalJson(vector.inputs);
  const expectedOutput = canonicalJson(vector.expected);
  const toleranceSnapshot = "{}";
  const inputSha256 = canonicalHashes.inputSha256;
  const expectedOutputSha256 = canonicalHashes.expectedOutputSha256;
  const sourceCitationSha256 = await textSha256(sourceCitation);
  const requestSha256 = await vectorRequestSha256({
    clientRequestId,
    organisationId: member.organisationId,
    calculatorVersionId,
    vectorKey,
    sourceArtifactId: draft.source_artifact_id,
    activitySourceBindingId: draft.activity_source_binding_id,
    sourceArtifactSha256: draft.official_source_sha256,
    inputSha256,
    expectedOutputSha256,
    sourceCitationSha256,
  });
  const existing = await database.prepare(`SELECT
      vector_id,
      request_sha256
    FROM compliance_calculator_vector_authoring_receipts
    WHERE organisation_id = ?
      AND client_request_id = ?
    LIMIT 1`)
    .bind(member.organisationId, clientRequestId)
    .first<{ vector_id: string; request_sha256: string }>();
  if (existing) {
    if (existing.request_sha256 !== requestSha256) {
      fail(
        "CALCULATOR_VECTOR_REQUEST_CONFLICT",
        409,
        "This vector authoring request reference was already used for different immutable content.",
      );
    }
    const current = await vectorRecords(
      database,
      member.organisationId,
      [calculatorVersionId],
    );
    const reused = current.find((item) => item.vector_id === existing.vector_id);
    if (!reused) {
      fail(
        "CALCULATOR_VECTOR_NOT_FOUND",
        404,
        "The calculator vector was not found in this Creditex organisation.",
      );
    }
    return {
      vector: {
        ...await validatedPublicVector(
          reused,
          draft,
          specification,
          member.organisationId,
        ),
        reused: true,
      },
    };
  }
  const duplicate = await database.prepare(`SELECT id
    FROM compliance_calculator_test_vectors
    WHERE calculator_version_id = ?
      AND vector_key = ?
    LIMIT 1`)
    .bind(calculatorVersionId, vectorKey)
    .first<{ id: string }>();
  if (duplicate) {
    fail(
      "CALCULATOR_VECTOR_DUPLICATE",
      409,
      "This calculator draft already has the same authoritative vector key.",
    );
  }
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const vectorId = `calculator-vector:${idFactory()}`;
  const receiptId = `calculator-vector-authoring:${idFactory()}`;
  const now = options.now || new Date().toISOString();
  const vectorContractSha256 = await vectorAuthoringContractSha256({
    calculatorVersionId,
    vectorId,
    vectorKey,
    sourceArtifactId: draft.source_artifact_id,
    activitySourceBindingId: draft.activity_source_binding_id,
    sourceArtifactSha256: draft.official_source_sha256,
    inputSha256,
    expectedOutputSha256,
    sourceCitationSha256,
    toleranceSha256: await textSha256(toleranceSnapshot),
  });
  await database.batch([
    database.prepare(`INSERT INTO compliance_calculator_test_vectors (
        id, calculator_version_id, vector_key, input_snapshot,
        expected_output, tolerance_snapshot, source_citation,
        last_result, last_run_at, created_by_uid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, 'not_run', '', ?, ?, ?)`).bind(
      vectorId,
      calculatorVersionId,
      vectorKey,
      inputSnapshot,
      expectedOutput,
      sourceCitation,
      member.uid,
      now,
      now,
    ),
    database.prepare(`INSERT INTO
      compliance_calculator_vector_authoring_receipts (
        id, organisation_id, client_request_id, request_sha256, vector_id,
        calculator_version_id, source_artifact_id,
        activity_source_binding_id, source_artifact_sha256, input_sha256,
        expected_output_sha256, source_citation_sha256,
        vector_contract_sha256, authoring_state, created_by_uid, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?
      )`).bind(
      receiptId,
      member.organisationId,
      clientRequestId,
      requestSha256,
      vectorId,
      calculatorVersionId,
      draft.source_artifact_id,
      draft.activity_source_binding_id,
      draft.official_source_sha256,
      inputSha256,
      expectedOutputSha256,
      sourceCitationSha256,
      vectorContractSha256,
      member.uid,
      now,
    ),
  ]);
  const records = await vectorRecords(
    database,
    member.organisationId,
    [calculatorVersionId],
  );
  const stored = records.find((item) => item.vector_id === vectorId);
  if (!stored) {
    fail(
      "CALCULATOR_VECTOR_NOT_FOUND",
      500,
      "The immutable calculator vector could not be reloaded.",
    );
  }
  return {
    vector: {
      ...await validatedPublicVector(
        stored,
        draft,
        specification,
        member.organisationId,
      ),
      reused: false,
    },
  };
}
