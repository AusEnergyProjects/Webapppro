import type { ComplianceIdentity } from "./compliance-access-server";
import type { CreditexCustodyBucket } from "./creditex-custody-bucket";

export type CreditexGovernanceReviewDecision =
  | "approved"
  | "rejected"
  | "withdrawn";

export type CreditexOfficialSourceReviewSubject =
  | "artifact"
  | "binding";

export type CreditexOfficialSourceBindingTarget =
  | "program"
  | "activity"
  | "evidence_policy"
  | "calculator";

type GovernanceReviewer = Pick<
  ComplianceIdentity,
  "uid" | "organisationId" | "role" | "governanceIdentityVerified"
>;

export type ReviewCreditexOfficialSourceInput = {
  subjectType: unknown;
  subjectId: unknown;
  decision: unknown;
  reviewNote: unknown;
};

export type ReviewCreditexOperationalLookupInput = {
  importId: unknown;
  decision: unknown;
  reviewNote: unknown;
};

type SourceSubjectRecord = {
  subject_id: string;
  subject_type: CreditexOfficialSourceReviewSubject;
  subject_created_by_uid: string;
  artifact_id: string;
  artifact_sha256: string;
  artifact_object_key: string;
  artifact_size_bytes: number;
  binding_target_type: string;
  binding_target_id: string;
  citation_location: string;
};

type SourceDecisionRecord = {
  id: string;
  organisation_id: string;
  subject_type: CreditexOfficialSourceReviewSubject;
  subject_id: string;
  artifact_id: string;
  artifact_sha256: string;
  artifact_object_key: string;
  binding_target_type: string;
  binding_target_id: string;
  citation_location: string;
  decision: CreditexGovernanceReviewDecision;
  supersedes_decision_id: string;
  review_note: string;
  reviewed_by_uid: string;
  reviewed_at: string;
};

type LookupImportForReview = {
  id: string;
  created_by_uid: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  records_sha256: string;
  record_count: number;
  artifact_object_key: string;
  artifact_size_bytes: number;
};

type LookupDecisionRecord = {
  id: string;
  organisation_id: string;
  import_id: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  records_sha256: string;
  record_count: number;
  decision: CreditexGovernanceReviewDecision;
  supersedes_decision_id: string;
  review_note: string;
  reviewed_by_uid: string;
  reviewed_at: string;
};

type LookupMaterialisationRow = {
  row_number: number;
  source_record_key: string;
  source_effective_from: string;
  source_effective_to: string;
  source_status: string;
  record_json: string;
  record_sha256: string;
};

export class CreditexSourceLookupReviewError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexSourceLookupReviewError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexSourceLookupReviewError(code, status, message);
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

function cleanDecision(value: unknown): CreditexGovernanceReviewDecision {
  const decision = String(value || "").trim();
  if (
    decision === "approved"
    || decision === "rejected"
    || decision === "withdrawn"
  ) {
    return decision;
  }
  return fail(
    "GOVERNANCE_REVIEW_DECISION_INVALID",
    400,
    "Choose approve, reject or withdraw.",
  );
}

function cleanSubjectType(
  value: unknown,
): CreditexOfficialSourceReviewSubject {
  const subjectType = String(value || "").trim();
  if (subjectType === "artifact" || subjectType === "binding") {
    return subjectType;
  }
  return fail(
    "SOURCE_REVIEW_SUBJECT_INVALID",
    400,
    "Choose an official source artifact or binding.",
  );
}

function requireGovernanceReviewer(member: GovernanceReviewer) {
  if (member.role !== "admin" || !member.governanceIdentityVerified) {
    fail(
      "GOVERNANCE_REVIEWER_REQUIRED",
      403,
      "A named Creditex administrator with independently verified governance identity is required.",
    );
  }
}

function publicSourceDecision(record: SourceDecisionRecord) {
  return {
    id: record.id,
    subjectType: record.subject_type,
    subjectId: record.subject_id,
    artifactId: record.artifact_id,
    artifactSha256: record.artifact_sha256,
    bindingTargetType: record.binding_target_type,
    bindingTargetId: record.binding_target_id,
    citationLocation: record.citation_location,
    decision: record.decision,
    supersedesDecisionId: record.supersedes_decision_id,
    reviewNote: record.review_note,
    reviewedByUid: record.reviewed_by_uid,
    reviewedAt: record.reviewed_at,
  };
}

function publicLookupDecision(record: LookupDecisionRecord) {
  return {
    id: record.id,
    importId: record.import_id,
    sourceArtifactId: record.source_artifact_id,
    sourceArtifactSha256: record.source_artifact_sha256,
    recordsSha256: record.records_sha256,
    recordCount: Number(record.record_count),
    decision: record.decision,
    supersedesDecisionId: record.supersedes_decision_id,
    reviewNote: record.review_note,
    reviewedByUid: record.reviewed_by_uid,
    reviewedAt: record.reviewed_at,
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const exact = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exact).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function latestSourceDecision(
  database: D1Database,
  organisationId: string,
  subjectType: CreditexOfficialSourceReviewSubject,
  subjectId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_official_source_review_decisions
    WHERE organisation_id = ?
      AND subject_type = ?
      AND subject_id = ?
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId, subjectType, subjectId)
    .first<SourceDecisionRecord>();
}

async function latestLookupDecision(
  database: D1Database,
  organisationId: string,
  importId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_operational_lookup_review_decisions
    WHERE organisation_id = ?
      AND import_id = ?
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId, importId)
    .first<LookupDecisionRecord>();
}

function supersededDecisionId(
  current: SourceDecisionRecord | LookupDecisionRecord | null,
  decision: CreditexGovernanceReviewDecision,
) {
  if (decision === "withdrawn") {
    if (!current || current.decision !== "approved") {
      fail(
        "GOVERNANCE_REVIEW_WITHDRAWAL_INVALID",
        409,
        "Only the current approved decision can be withdrawn.",
      );
    }
    return current.id;
  }
  if (current) {
    fail(
      "GOVERNANCE_REVIEW_ALREADY_DECIDED",
      409,
      "This immutable subject already has a governance decision.",
    );
  }
  return "";
}

function decisionReviewedAt(
  value: string | undefined,
  current: SourceDecisionRecord | LookupDecisionRecord | null,
) {
  const reviewedAt = value || new Date().toISOString();
  const parsed = Date.parse(reviewedAt);
  if (!Number.isFinite(parsed)) {
    fail(
      "GOVERNANCE_REVIEW_TIME_INVALID",
      400,
      "Record a valid governance review time.",
    );
  }
  if (
    current
    && parsed <= Date.parse(current.reviewed_at)
  ) {
    fail(
      "GOVERNANCE_REVIEW_TIME_INVALID",
      409,
      "A superseding governance decision must be later than the decision it replaces.",
    );
  }
  return new Date(parsed).toISOString();
}

async function exactRetainedArtifact(
  bucket: CreditexCustodyBucket,
  artifact: {
    artifact_object_key: string;
    artifact_sha256: string;
    artifact_size_bytes: number;
  },
) {
  let object;
  try {
    object = await bucket.get(artifact.artifact_object_key);
  } catch {
    return fail(
      "SOURCE_RETAINED_OBJECT_UNAVAILABLE",
      503,
      "The retained official source object could not be read.",
    );
  }
  if (!object) {
    return fail(
      "SOURCE_RETAINED_OBJECT_MISSING",
      409,
      "The retained official source object is missing.",
    );
  }
  if (
    typeof object.size === "number"
    && object.size !== Number(artifact.artifact_size_bytes)
  ) {
    return fail(
      "SOURCE_RETAINED_OBJECT_MISMATCH",
      409,
      "The retained official source size no longer matches its custody record.",
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== Number(artifact.artifact_size_bytes)
    || await sha256Hex(bytes) !== artifact.artifact_sha256
  ) {
    return fail(
      "SOURCE_RETAINED_OBJECT_MISMATCH",
      409,
      "The retained official source bytes no longer match their custody hash.",
    );
  }
}

async function sourceSubject(
  database: D1Database,
  organisationId: string,
  subjectType: CreditexOfficialSourceReviewSubject,
  subjectId: string,
) {
  if (subjectType === "artifact") {
    return database.prepare(`SELECT
        artifact.id subject_id,
        'artifact' subject_type,
        artifact.captured_by_uid subject_created_by_uid,
        artifact.id artifact_id,
        artifact.sha256 artifact_sha256,
        artifact.object_key artifact_object_key,
        artifact.size_bytes artifact_size_bytes,
        '' binding_target_type,
        '' binding_target_id,
        '' citation_location
      FROM compliance_official_source_artifacts artifact
      WHERE artifact.organisation_id = ?
        AND artifact.id = ?
        AND artifact.custody_state IN ('draft', 'pending_review')
        AND artifact.rule_activation_enabled = 0
      LIMIT 1`)
      .bind(organisationId, subjectId)
      .first<SourceSubjectRecord>();
  }
  return database.prepare(`SELECT
      binding.id subject_id,
      'binding' subject_type,
      binding.created_by_uid subject_created_by_uid,
      artifact.id artifact_id,
      artifact.sha256 artifact_sha256,
      artifact.object_key artifact_object_key,
      artifact.size_bytes artifact_size_bytes,
      binding.target_type binding_target_type,
      binding.target_id binding_target_id,
      binding.citation_location citation_location
    FROM compliance_official_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.organisation_id = binding.organisation_id
      AND artifact.id = binding.artifact_id
    WHERE binding.organisation_id = ?
      AND binding.id = ?
      AND binding.binding_state IN ('draft', 'pending_review')
      AND binding.rule_activation_enabled = 0
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
    LIMIT 1`)
    .bind(organisationId, subjectId)
    .first<SourceSubjectRecord>();
}

async function requireApprovedArtifact(
  database: D1Database,
  organisationId: string,
  artifactId: string,
  artifactSha256: string,
) {
  const decision = await latestSourceDecision(
    database,
    organisationId,
    "artifact",
    artifactId,
  );
  if (
    !decision
    || decision.decision !== "approved"
    || decision.artifact_sha256 !== artifactSha256
  ) {
    fail(
      "SOURCE_ARTIFACT_APPROVAL_REQUIRED",
      409,
      "The exact retained source artifact requires current governance approval.",
    );
  }
}

export async function requireCurrentApprovedOfficialSourceBinding(
  database: D1Database,
  organisationIdValue: string,
  targetType: CreditexOfficialSourceBindingTarget,
  targetIdValue: string,
  expectedArtifactSha256Value: string,
) {
  const organisationId = cleanText(
    organisationIdValue,
    180,
    "SOURCE_BINDING_APPROVAL_REQUIRED",
    "A current official-source approval is required.",
  );
  const targetId = cleanText(
    targetIdValue,
    180,
    "SOURCE_BINDING_APPROVAL_REQUIRED",
    "A current official-source approval is required.",
  );
  const expectedArtifactSha256 = String(expectedArtifactSha256Value || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedArtifactSha256)) {
    fail(
      "SOURCE_BINDING_APPROVAL_REQUIRED",
      409,
      "The governed record does not identify an exact approved official source.",
    );
  }
  const approval = await database.prepare(`SELECT binding.id
    FROM compliance_official_source_bindings binding
    JOIN compliance_official_source_artifacts artifact
      ON artifact.organisation_id = binding.organisation_id
      AND artifact.id = binding.artifact_id
      AND artifact.sha256 = ?
    JOIN compliance_official_source_review_decisions artifact_review
      ON artifact_review.organisation_id = artifact.organisation_id
      AND artifact_review.subject_type = 'artifact'
      AND artifact_review.subject_id = artifact.id
      AND artifact_review.artifact_id = artifact.id
      AND artifact_review.artifact_sha256 = artifact.sha256
      AND artifact_review.artifact_object_key = artifact.object_key
      AND artifact_review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_official_source_review_decisions newer_artifact
        WHERE newer_artifact.organisation_id = artifact_review.organisation_id
          AND newer_artifact.subject_type = artifact_review.subject_type
          AND newer_artifact.subject_id = artifact_review.subject_id
          AND (
            newer_artifact.reviewed_at > artifact_review.reviewed_at
            OR (
              newer_artifact.reviewed_at = artifact_review.reviewed_at
              AND newer_artifact.id > artifact_review.id
            )
          )
      )
    JOIN compliance_official_source_review_decisions binding_review
      ON binding_review.organisation_id = binding.organisation_id
      AND binding_review.subject_type = 'binding'
      AND binding_review.subject_id = binding.id
      AND binding_review.artifact_id = artifact.id
      AND binding_review.artifact_sha256 = artifact.sha256
      AND binding_review.artifact_object_key = artifact.object_key
      AND binding_review.binding_target_type = binding.target_type
      AND binding_review.binding_target_id = binding.target_id
      AND binding_review.citation_location = binding.citation_location
      AND binding_review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_official_source_review_decisions newer_binding
        WHERE newer_binding.organisation_id = binding_review.organisation_id
          AND newer_binding.subject_type = binding_review.subject_type
          AND newer_binding.subject_id = binding_review.subject_id
          AND (
            newer_binding.reviewed_at > binding_review.reviewed_at
            OR (
              newer_binding.reviewed_at = binding_review.reviewed_at
              AND newer_binding.id > binding_review.id
            )
          )
      )
    WHERE binding.organisation_id = ?
      AND binding.target_type = ?
      AND binding.target_id = ?
      AND binding.binding_state IN ('draft', 'pending_review')
      AND binding.rule_activation_enabled = 0
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
    LIMIT 1`)
    .bind(
      expectedArtifactSha256,
      organisationId,
      targetType,
      targetId,
    )
    .first<{ id: string }>();
  if (!approval) {
    fail(
      "SOURCE_BINDING_APPROVAL_REQUIRED",
      409,
      "The exact official-source artifact and target binding require current independent approval.",
    );
  }
  return approval.id;
}

export async function reviewCreditexOfficialSource(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: GovernanceReviewer,
  input: ReviewCreditexOfficialSourceInput,
  options: { now?: string } = {},
) {
  requireGovernanceReviewer(member);
  const subjectType = cleanSubjectType(input.subjectType);
  const subjectId = cleanText(
    input.subjectId,
    180,
    "SOURCE_REVIEW_SUBJECT_INVALID",
    "Choose an official source artifact or binding.",
  );
  const decision = cleanDecision(input.decision);
  const reviewNote = cleanText(
    input.reviewNote,
    1000,
    "GOVERNANCE_REVIEW_NOTE_REQUIRED",
    "Record the reason for this governance decision.",
  );
  const subject = await sourceSubject(
    database,
    member.organisationId,
    subjectType,
    subjectId,
  );
  if (!subject) {
    fail(
      "SOURCE_REVIEW_SUBJECT_NOT_FOUND",
      404,
      "The official source review subject was not found in this organisation.",
    );
  }
  if (subject.subject_created_by_uid === member.uid) {
    fail(
      "GOVERNANCE_REVIEW_INDEPENDENCE_REQUIRED",
      409,
      "The source capturer or binding author cannot review their own work.",
    );
  }
  const current = await latestSourceDecision(
    database,
    member.organisationId,
    subjectType,
    subjectId,
  );
  const supersedesDecisionId = supersededDecisionId(current, decision);
  const reviewedAt = decisionReviewedAt(options.now, current);
  if (decision === "approved") {
    if (subjectType === "binding") {
      await requireApprovedArtifact(
        database,
        member.organisationId,
        subject.artifact_id,
        subject.artifact_sha256,
      );
    }
    await exactRetainedArtifact(bucket, subject);
  }
  const record: SourceDecisionRecord = {
    id: crypto.randomUUID(),
    organisation_id: member.organisationId,
    subject_type: subjectType,
    subject_id: subjectId,
    artifact_id: subject.artifact_id,
    artifact_sha256: subject.artifact_sha256,
    artifact_object_key: subject.artifact_object_key,
    binding_target_type: subject.binding_target_type,
    binding_target_id: subject.binding_target_id,
    citation_location: subject.citation_location,
    decision,
    supersedes_decision_id: supersedesDecisionId,
    review_note: reviewNote,
    reviewed_by_uid: member.uid,
    reviewed_at: reviewedAt,
  };
  await database.prepare(`INSERT INTO
      compliance_official_source_review_decisions (
        id,
        organisation_id,
        subject_type,
        subject_id,
        artifact_id,
        artifact_sha256,
        artifact_object_key,
        binding_target_type,
        binding_target_id,
        citation_location,
        decision,
        supersedes_decision_id,
        review_note,
        reviewed_by_uid,
        reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      record.id,
      record.organisation_id,
      record.subject_type,
      record.subject_id,
      record.artifact_id,
      record.artifact_sha256,
      record.artifact_object_key,
      record.binding_target_type,
      record.binding_target_id,
      record.citation_location,
      record.decision,
      record.supersedes_decision_id,
      record.review_note,
      record.reviewed_by_uid,
      record.reviewed_at,
    )
    .run();
  return { decision: publicSourceDecision(record) };
}

export async function listCreditexOfficialSourceReviewDecisions(
  database: D1Database,
  member: GovernanceReviewer,
) {
  const result = await database.prepare(`SELECT *
    FROM compliance_official_source_review_decisions
    WHERE organisation_id = ?
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 200`)
    .bind(member.organisationId)
    .all<SourceDecisionRecord>();
  return result.results.map(publicSourceDecision);
}

export async function reviewCreditexOperationalLookupImport(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: GovernanceReviewer,
  input: ReviewCreditexOperationalLookupInput,
  options: { now?: string } = {},
) {
  requireGovernanceReviewer(member);
  const importId = cleanText(
    input.importId,
    180,
    "LOOKUP_REVIEW_IMPORT_INVALID",
    "Choose a staged official lookup import.",
  );
  const decision = cleanDecision(input.decision);
  const reviewNote = cleanText(
    input.reviewNote,
    1000,
    "GOVERNANCE_REVIEW_NOTE_REQUIRED",
    "Record the reason for this governance decision.",
  );
  const importBatch = await database.prepare(`SELECT
      import_batch.id,
      import_batch.created_by_uid,
      import_batch.source_artifact_id,
      import_batch.source_artifact_sha256,
      import_batch.records_sha256,
      import_batch.record_count,
      artifact.object_key artifact_object_key,
      artifact.size_bytes artifact_size_bytes
    FROM compliance_operational_lookup_imports import_batch
    JOIN compliance_official_source_artifacts artifact
      ON artifact.organisation_id = import_batch.organisation_id
      AND artifact.id = import_batch.source_artifact_id
      AND artifact.sha256 = import_batch.source_artifact_sha256
    WHERE import_batch.organisation_id = ?
      AND import_batch.id = ?
      AND import_batch.status = 'staged_pending'
      AND import_batch.live_verification_enabled = 0
      AND import_batch.eligibility_activation_enabled = 0
      AND import_batch.local_assertion_enabled = 0
    LIMIT 1`)
    .bind(member.organisationId, importId)
    .first<LookupImportForReview>();
  if (!importBatch) {
    fail(
      "LOOKUP_REVIEW_IMPORT_NOT_FOUND",
      404,
      "The staged lookup import was not found in this organisation.",
    );
  }
  if (importBatch.created_by_uid === member.uid) {
    fail(
      "GOVERNANCE_REVIEW_INDEPENDENCE_REQUIRED",
      409,
      "The lookup importer cannot review their own snapshot.",
    );
  }
  const current = await latestLookupDecision(
    database,
    member.organisationId,
    importId,
  );
  const supersedesDecisionId = supersededDecisionId(current, decision);
  const reviewedAt = decisionReviewedAt(options.now, current);
  if (decision === "approved") {
    await requireApprovedArtifact(
      database,
      member.organisationId,
      importBatch.source_artifact_id,
      importBatch.source_artifact_sha256,
    );
    await exactRetainedArtifact(bucket, {
      artifact_object_key: importBatch.artifact_object_key,
      artifact_sha256: importBatch.source_artifact_sha256,
      artifact_size_bytes: importBatch.artifact_size_bytes,
    });
    await validateStagedLookupRecords(
      database,
      member.organisationId,
      importBatch,
      "LOOKUP_REVIEW_RECORDS_INVALID",
      "The lookup snapshot",
    );
  }
  const record: LookupDecisionRecord = {
    id: crypto.randomUUID(),
    organisation_id: member.organisationId,
    import_id: importId,
    source_artifact_id: importBatch.source_artifact_id,
    source_artifact_sha256: importBatch.source_artifact_sha256,
    records_sha256: importBatch.records_sha256,
    record_count: Number(importBatch.record_count),
    decision,
    supersedes_decision_id: supersedesDecisionId,
    review_note: reviewNote,
    reviewed_by_uid: member.uid,
    reviewed_at: reviewedAt,
  };
  await database.prepare(`INSERT INTO
      compliance_operational_lookup_review_decisions (
        id,
        organisation_id,
        import_id,
        source_artifact_id,
        source_artifact_sha256,
        records_sha256,
        record_count,
        decision,
        supersedes_decision_id,
        review_note,
        reviewed_by_uid,
        reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      record.id,
      record.organisation_id,
      record.import_id,
      record.source_artifact_id,
      record.source_artifact_sha256,
      record.records_sha256,
      record.record_count,
      record.decision,
      record.supersedes_decision_id,
      record.review_note,
      record.reviewed_by_uid,
      record.reviewed_at,
    )
    .run();
  return { decision: publicLookupDecision(record) };
}

export async function listCreditexOperationalLookupReviewDecisions(
  database: D1Database,
  member: GovernanceReviewer,
) {
  const result = await database.prepare(`SELECT *
    FROM compliance_operational_lookup_review_decisions
    WHERE organisation_id = ?
    ORDER BY reviewed_at DESC, id DESC
    LIMIT 200`)
    .bind(member.organisationId)
    .all<LookupDecisionRecord>();
  return result.results.map(publicLookupDecision);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function textSha256(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

async function validateStagedLookupRecords(
  database: D1Database,
  organisationId: string,
  importBatch: Pick<
    LookupImportForReview,
    "id" | "record_count" | "records_sha256"
  >,
  errorCode: string,
  errorPrefix: string,
) {
  const result = await database.prepare(`SELECT
      row_number,
      source_record_key,
      source_effective_from,
      source_effective_to,
      source_status,
      record_json,
      record_sha256
    FROM compliance_operational_lookup_records
    WHERE organisation_id = ?
      AND import_id = ?
      AND status = 'staged_pending'
      AND live_verification_enabled = 0
      AND eligibility_activation_enabled = 0
      AND local_assertion_enabled = 0
    ORDER BY row_number`)
    .bind(organisationId, importBatch.id)
    .all<LookupMaterialisationRow>();
  if (result.results.length !== Number(importBatch.record_count)) {
    fail(
      errorCode,
      409,
      `${errorPrefix} row count does not match its staged records.`,
    );
  }
  for (const row of result.results) {
    if (await textSha256(row.record_json) !== row.record_sha256) {
      fail(
        errorCode,
        409,
        `${errorPrefix} contains a row that does not match its immutable hash.`,
      );
    }
  }
  const recordsSha256 = await textSha256(canonicalJson(
    result.results.map((row) => ({
      rowNumber: Number(row.row_number),
      sourceRecordKey: row.source_record_key,
      sourceEffectiveFrom: row.source_effective_from,
      sourceEffectiveTo: row.source_effective_to,
      sourceStatus: row.source_status,
      recordSha256: row.record_sha256,
    })),
  ));
  if (recordsSha256 !== importBatch.records_sha256) {
    fail(
      errorCode,
      409,
      `${errorPrefix} does not match its aggregate records hash.`,
    );
  }
  return result.results;
}

export async function materialiseApprovedCreditexOperationalLookup(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: GovernanceReviewer,
  importIdValue: unknown,
) {
  const importId = cleanText(
    importIdValue,
    180,
    "LOOKUP_MATERIALISATION_BLOCKED",
    "Choose an approved lookup snapshot.",
  );
  const approved = await database.prepare(`SELECT
      import_batch.id,
      import_batch.created_by_uid,
      import_batch.source_artifact_id,
      import_batch.source_artifact_sha256,
      import_batch.records_sha256,
      import_batch.record_count,
      artifact.object_key artifact_object_key,
      artifact.size_bytes artifact_size_bytes
    FROM compliance_operational_lookup_imports import_batch
    JOIN compliance_official_source_artifacts artifact
      ON artifact.organisation_id = import_batch.organisation_id
      AND artifact.id = import_batch.source_artifact_id
      AND artifact.sha256 = import_batch.source_artifact_sha256
    JOIN compliance_operational_lookup_review_decisions lookup_review
      ON lookup_review.organisation_id = import_batch.organisation_id
      AND lookup_review.import_id = import_batch.id
      AND lookup_review.decision = 'approved'
      AND lookup_review.source_artifact_id = import_batch.source_artifact_id
      AND lookup_review.source_artifact_sha256 =
        import_batch.source_artifact_sha256
      AND lookup_review.records_sha256 = import_batch.records_sha256
      AND lookup_review.record_count = import_batch.record_count
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_operational_lookup_review_decisions newer
        WHERE newer.organisation_id = lookup_review.organisation_id
          AND newer.import_id = lookup_review.import_id
          AND (
            newer.reviewed_at > lookup_review.reviewed_at
            OR (
              newer.reviewed_at = lookup_review.reviewed_at
              AND newer.id > lookup_review.id
            )
          )
      )
    JOIN compliance_official_source_review_decisions source_review
      ON source_review.organisation_id = artifact.organisation_id
      AND source_review.subject_type = 'artifact'
      AND source_review.subject_id = artifact.id
      AND source_review.artifact_id = artifact.id
      AND source_review.artifact_sha256 = artifact.sha256
      AND source_review.artifact_object_key = artifact.object_key
      AND source_review.decision = 'approved'
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = source_review.organisation_id
          AND newer.subject_type = 'artifact'
          AND newer.subject_id = source_review.subject_id
          AND (
            newer.reviewed_at > source_review.reviewed_at
            OR (
              newer.reviewed_at = source_review.reviewed_at
              AND newer.id > source_review.id
            )
          )
      )
    WHERE import_batch.organisation_id = ?
      AND import_batch.id = ?
      AND import_batch.status = 'staged_pending'
      AND import_batch.live_verification_enabled = 0
      AND import_batch.eligibility_activation_enabled = 0
      AND import_batch.local_assertion_enabled = 0
    LIMIT 1`)
    .bind(member.organisationId, importId)
    .first<LookupImportForReview>();
  if (!approved) {
    fail(
      "LOOKUP_MATERIALISATION_BLOCKED",
      409,
      "The lookup snapshot and exact retained source require current approval.",
    );
  }
  const records = await validateStagedLookupRecords(
    database,
    member.organisationId,
    approved,
    "LOOKUP_MATERIALISATION_BLOCKED",
    "The approved lookup snapshot",
  );
  await exactRetainedArtifact(bucket, {
    artifact_object_key: approved.artifact_object_key,
    artifact_sha256: approved.source_artifact_sha256,
    artifact_size_bytes: approved.artifact_size_bytes,
  });
  return {
    importId,
    sourceArtifactId: approved.source_artifact_id,
    sourceArtifactSha256: approved.source_artifact_sha256,
    recordsSha256: approved.records_sha256,
    records: records.map((row) => ({
      sourceRecordKey: row.source_record_key,
      effectiveFrom: row.source_effective_from,
      effectiveTo: row.source_effective_to,
      sourceStatus: row.source_status,
      sourceRecord: JSON.parse(row.record_json) as Record<string, unknown>,
    })),
  };
}
