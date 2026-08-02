import type { CreditexCustodyBucket } from "./creditex-custody-bucket";
import { sha256Hex } from "./creditex-official-source-custody-server.ts";

export const CREDITEX_EVIDENCE_INTEGRITY_MAXIMUM_BYTES = 50 * 1024 * 1024;

type IntegrityMember = {
  uid: string;
  membershipId: string;
  organisationId: string;
  role: string;
};

type EvidenceRecord = {
  id: string;
  organisation_id: string;
  case_id: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  original_sha256: string;
};

type IntegrityReceiptRecord = {
  id: string;
  organisation_id: string;
  evidence_id: string;
  request_id: string;
  object_key: string;
  expected_sha256: string;
  observed_sha256: string;
  expected_size_bytes: number;
  observed_size_bytes: number;
  expected_content_type: string;
  observed_content_type: string;
  result: string;
  verification_scope: string;
  physical_device_validation_state: string;
  verified_by_uid: string;
  verified_at: string;
};

export class CreditexEvidenceIntegrityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cleanIdentifier(
  value: unknown,
  code: string,
  message: string,
  maximum = 180,
) {
  const cleaned = String(value || "").trim();
  if (
    !cleaned
    || cleaned.length > maximum
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cleaned)
  ) {
    throw new CreditexEvidenceIntegrityError(code, 400, message);
  }
  return cleaned;
}

function cleanRequestId(value: unknown) {
  const cleaned = cleanIdentifier(
    value,
    "EVIDENCE_INTEGRITY_REQUEST_ID_INVALID",
    "Add a stable evidence integrity request reference.",
    120,
  );
  if (cleaned.length < 8) {
    throw new CreditexEvidenceIntegrityError(
      "EVIDENCE_INTEGRITY_REQUEST_ID_INVALID",
      400,
      "Add a stable evidence integrity request reference.",
    );
  }
  return cleaned;
}

function publicReceipt(record: IntegrityReceiptRecord) {
  return {
    id: record.id,
    evidenceId: record.evidence_id,
    requestId: record.request_id,
    expectedSha256: record.expected_sha256,
    observedSha256: record.observed_sha256,
    expectedSizeBytes: Number(record.expected_size_bytes),
    observedSizeBytes: Number(record.observed_size_bytes),
    expectedContentType: record.expected_content_type,
    observedContentType: record.observed_content_type,
    result: record.result,
    integrityMatched: record.result === "matched",
    verificationScope: record.verification_scope,
    physicalDeviceValidationState:
      record.physical_device_validation_state,
    verifiedByUid: record.verified_by_uid,
    verifiedAt: record.verified_at,
  };
}

async function authorisedEvidence(
  database: D1Database,
  member: IntegrityMember,
  evidenceId: string,
) {
  const evidence = await database.prepare(`SELECT
      evidence.id,
      evidence.organisation_id,
      evidence.case_id,
      evidence.object_key,
      evidence.content_type,
      evidence.size_bytes,
      evidence.original_sha256
    FROM compliance_case_evidence evidence
    JOIN compliance_cases compliance_case
      ON compliance_case.id = evidence.case_id
      AND compliance_case.organisation_id = evidence.organisation_id
    WHERE evidence.id = ?
      AND evidence.organisation_id = ?
      AND (
        ? = 'admin'
        OR (
          ? = 'reviewer'
          AND EXISTS (
            SELECT 1 FROM compliance_case_assignments assignment
            WHERE assignment.organisation_id = evidence.organisation_id
              AND assignment.case_id = evidence.case_id
              AND assignment.compliance_user_id = ?
              AND assignment.assignment_role IN (
                'primary_reviewer', 'secondary_reviewer'
              )
              AND assignment.status = 'assigned'
          )
        )
        OR (
          ? = 'auditor'
          AND EXISTS (
            SELECT 1 FROM compliance_case_assignments assignment
            WHERE assignment.organisation_id = evidence.organisation_id
              AND assignment.case_id = evidence.case_id
              AND assignment.compliance_user_id = ?
              AND assignment.assignment_role = 'auditor'
              AND assignment.status = 'assigned'
          )
        )
      )
    LIMIT 1`)
    .bind(
      evidenceId,
      member.organisationId,
      member.role,
      member.role,
      member.membershipId,
      member.role,
      member.membershipId,
    )
    .first<EvidenceRecord>();
  if (!evidence) {
    throw new CreditexEvidenceIntegrityError(
      "EVIDENCE_INTEGRITY_NOT_FOUND",
      404,
      "The evidence item was not found or is not assigned to you.",
    );
  }
  return evidence;
}

async function existingReceipt(
  database: D1Database,
  organisationId: string,
  requestId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_evidence_integrity_receipts
    WHERE organisation_id = ? AND request_id = ?
    LIMIT 1`)
    .bind(organisationId, requestId)
    .first<IntegrityReceiptRecord>();
}

export async function verifyCreditexEvidenceIntegrity(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: IntegrityMember,
  input: { evidenceId: unknown; requestId: unknown },
) {
  if (!["admin", "reviewer", "auditor"].includes(member.role)) {
    throw new CreditexEvidenceIntegrityError(
      "EVIDENCE_INTEGRITY_ROLE_REQUIRED",
      403,
      "This compliance role cannot verify protected evidence custody.",
    );
  }
  const evidenceId = cleanIdentifier(
    input.evidenceId,
    "EVIDENCE_INTEGRITY_ID_REQUIRED",
    "Choose an evidence item.",
  );
  const requestId = cleanRequestId(input.requestId);
  const evidence = await authorisedEvidence(database, member, evidenceId);
  const previous = await existingReceipt(
    database,
    member.organisationId,
    requestId,
  );
  if (previous) {
    if (previous.evidence_id !== evidence.id) {
      throw new CreditexEvidenceIntegrityError(
        "EVIDENCE_INTEGRITY_REQUEST_ID_CONFLICT",
        409,
        "This integrity request reference was already used for another evidence item.",
      );
    }
    return { reused: true, receipt: publicReceipt(previous) };
  }

  let result:
    | "matched"
    | "mismatch"
    | "object_missing"
    | "object_oversize"
    | "storage_unavailable";
  let observedSha256 = "";
  let observedSizeBytes = 0;
  let observedContentType = "";
  try {
    const object = await bucket.get(evidence.object_key);
    if (!object) {
      result = "object_missing";
    } else if (
      typeof object.size === "number"
      && object.size > CREDITEX_EVIDENCE_INTEGRITY_MAXIMUM_BYTES
    ) {
      observedSizeBytes = object.size;
      observedContentType = String(
        object.httpMetadata?.contentType || "",
      ).toLowerCase();
      result = "object_oversize";
    } else {
      const bytes = new Uint8Array(await object.arrayBuffer());
      observedSizeBytes = bytes.byteLength;
      observedContentType = String(
        object.httpMetadata?.contentType || "",
      ).toLowerCase();
      if (bytes.byteLength > CREDITEX_EVIDENCE_INTEGRITY_MAXIMUM_BYTES) {
        result = "object_oversize";
      } else {
        observedSha256 = await sha256Hex(bytes);
        result = (
          observedSha256 === evidence.original_sha256.toLowerCase()
          && observedSizeBytes === Number(evidence.size_bytes)
          && (
            !observedContentType
            || observedContentType === evidence.content_type.toLowerCase()
          )
        )
          ? "matched"
          : "mismatch";
      }
    }
  } catch {
    observedSha256 = "";
    observedSizeBytes = 0;
    observedContentType = "";
    result = "storage_unavailable";
  }

  const receiptId = crypto.randomUUID();
  const verifiedAt = new Date().toISOString();
  const hashMatched = Boolean(observedSha256)
    && observedSha256 === evidence.original_sha256.toLowerCase();
  const sizeMatched = observedSizeBytes === Number(evidence.size_bytes);
  const contentTypeMetadataMatched = !observedContentType
    || observedContentType === evidence.content_type.toLowerCase();
  const summary = result === "matched"
    ? "Stored evidence bytes matched the immutable Creditex custody envelope."
    : "Stored evidence bytes did not pass the Creditex custody integrity check.";
  await database.batch([
    database.prepare(`INSERT INTO compliance_evidence_integrity_receipts (
        id, organisation_id, evidence_id, request_id, object_key,
        expected_sha256, observed_sha256, expected_size_bytes,
        observed_size_bytes, expected_content_type, observed_content_type,
        result, verification_scope, physical_device_validation_state,
        verified_by_uid, verified_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'r2_object_bytes_only', 'not_assessed', ?, ?
      )`)
      .bind(
        receiptId,
        member.organisationId,
        evidence.id,
        requestId,
        evidence.object_key,
        evidence.original_sha256.toLowerCase(),
        observedSha256,
        Number(evidence.size_bytes),
        observedSizeBytes,
        evidence.content_type,
        observedContentType,
        result,
        member.uid,
        verifiedAt,
      ),
    database.prepare(`INSERT INTO compliance_audit_events (
        id, organisation_id, actor_type, actor_uid, event_type,
        target_type, target_id, summary, metadata, created_at
      ) VALUES (
        ?, ?, 'compliance', ?, 'evidence.integrity_checked',
        'compliance_case_evidence', ?, ?, ?, ?
      )`)
      .bind(
        crypto.randomUUID(),
        member.organisationId,
        member.uid,
        evidence.id,
        summary,
        JSON.stringify({
          receiptId,
          result,
          hashMatched,
          sizeMatched,
          contentTypeMetadataMatched,
          verificationScope: "r2_object_bytes_only",
          physicalDeviceValidationState: "not_assessed",
        }),
        verifiedAt,
      ),
  ]);

  return {
    reused: false,
    receipt: {
      id: receiptId,
      evidenceId: evidence.id,
      requestId,
      expectedSha256: evidence.original_sha256.toLowerCase(),
      observedSha256,
      expectedSizeBytes: Number(evidence.size_bytes),
      observedSizeBytes,
      expectedContentType: evidence.content_type,
      observedContentType,
      result,
      integrityMatched: result === "matched",
      verificationScope: "r2_object_bytes_only",
      physicalDeviceValidationState: "not_assessed",
      verifiedByUid: member.uid,
      verifiedAt,
    },
  };
}

export async function listCreditexEvidenceIntegrityReceipts(
  database: D1Database,
  member: IntegrityMember,
  evidenceIdValue: unknown,
) {
  const evidenceId = cleanIdentifier(
    evidenceIdValue,
    "EVIDENCE_INTEGRITY_ID_REQUIRED",
    "Choose an evidence item.",
  );
  await authorisedEvidence(database, member, evidenceId);
  const rows = await database.prepare(`SELECT *
    FROM compliance_evidence_integrity_receipts
    WHERE organisation_id = ? AND evidence_id = ?
    ORDER BY verified_at DESC, id DESC
    LIMIT 50`)
    .bind(member.organisationId, evidenceId)
    .all<IntegrityReceiptRecord>();
  return rows.results.map(publicReceipt);
}
