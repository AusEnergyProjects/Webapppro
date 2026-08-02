import type { CreditexCustodyBucket } from "./creditex-custody-bucket";

export const CREDITEX_OFFICIAL_SOURCE_LIMITS = {
  maximumBytes: 15 * 1024 * 1024,
  maximumRequestBytes: 16 * 1024 * 1024,
} as const;

export const CREDITEX_OFFICIAL_SOURCE_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type CreditexOfficialSourceTargetType =
  | "program"
  | "activity"
  | "evidence_policy"
  | "calculator";

type CustodyMember = {
  uid: string;
  organisationId: string;
  role: string;
};

export type CaptureCreditexOfficialSourceInput = {
  clientRequestId: unknown;
  sourceUrl: unknown;
  sourceTitle: unknown;
  sourceVersion?: unknown;
  originalFileName: unknown;
  contentType: unknown;
  assertedRetrievedAt: unknown;
  sourceEtag?: unknown;
  sourceLastModified?: unknown;
  targetType: unknown;
  targetId: unknown;
  citationLocation: unknown;
  bytes: Uint8Array;
};

type OfficialSourceArtifactRecord = {
  id: string;
  organisation_id: string;
  client_request_id: string;
  source_url: string;
  source_host: string;
  source_title: string;
  source_version: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  asserted_retrieved_at: string;
  source_etag: string;
  source_last_modified: string;
  custody_state: string;
  captured_by_uid: string;
  captured_at: string;
};

type OfficialSourceBindingRecord = {
  id: string;
  artifact_id: string;
  target_type: string;
  target_id: string;
  citation_location: string;
  binding_state: string;
  created_by_uid: string;
  created_at: string;
};

type OfficialSourceReviewRecord = {
  id: string;
  subject_type: "artifact" | "binding";
  subject_id: string;
  decision: "approved" | "rejected" | "withdrawn";
  supersedes_decision_id: string;
  review_note: string;
  reviewed_by_uid: string;
  reviewed_at: string;
};

type OfficialSourceDownloadRecord = {
  id: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
};

type OfficialSourceListingRecord = OfficialSourceArtifactRecord & {
  binding_id: string;
  artifact_id: string;
  target_type: string;
  target_id: string;
  citation_location: string;
  binding_state: string;
  binding_created_by_uid: string;
  binding_created_at: string;
  artifact_review_id: string | null;
  artifact_review_decision: OfficialSourceReviewRecord["decision"] | null;
  artifact_review_supersedes_decision_id: string | null;
  artifact_review_note: string | null;
  artifact_reviewed_by_uid: string | null;
  artifact_reviewed_at: string | null;
  binding_review_id: string | null;
  binding_review_decision: OfficialSourceReviewRecord["decision"] | null;
  binding_review_supersedes_decision_id: string | null;
  binding_review_note: string | null;
  binding_reviewed_by_uid: string | null;
  binding_reviewed_at: string | null;
};

export type CreditexOfficialSourcePageOptions = {
  cursor?: unknown;
  pageSize?: unknown;
};

type OfficialSourceCursor = {
  capturedAt: string;
  artifactId: string;
  bindingId: string;
};

export class CreditexOfficialSourceCustodyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cleanText(
  value: unknown,
  maximum: number,
  code: string,
  message: string,
  required = true,
) {
  const cleaned = String(value ?? "").replaceAll("\u0000", "").trim();
  if ((required && !cleaned) || cleaned.length > maximum) {
    throw new CreditexOfficialSourceCustodyError(code, 400, message);
  }
  return cleaned;
}

function cleanClientRequestId(value: unknown) {
  const cleaned = cleanText(
    value,
    120,
    "SOURCE_REQUEST_ID_INVALID",
    "Add a stable source capture request reference.",
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(cleaned)) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_REQUEST_ID_INVALID",
      400,
      "Add a stable source capture request reference.",
    );
  }
  return cleaned;
}

function cleanFileName(value: unknown) {
  const baseName = cleanText(
    value,
    260,
    "SOURCE_FILE_NAME_INVALID",
    "Add the original official source file name.",
  )
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim() || "";
  if (!baseName || baseName.length > 180) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_FILE_NAME_INVALID",
      400,
      "Add the original official source file name.",
    );
  }
  return baseName;
}

function normalContentType(value: unknown) {
  const contentType = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!CREDITEX_OFFICIAL_SOURCE_CONTENT_TYPES.has(contentType)) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CONTENT_TYPE_INVALID",
      415,
      "Upload an official PDF, Office document, JSON, XML, HTML, text or CSV source.",
    );
  }
  return contentType;
}

export function isAllowedOfficialGovernmentHost(value: unknown) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  return host === "gov.au" || host.endsWith(".gov.au");
}

export function normaliseOfficialSourceUrl(value: unknown) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_URL_INVALID",
      400,
      "Add a valid HTTPS government source URL.",
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || !isAllowedOfficialGovernmentHost(host)
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_DOMAIN_NOT_ALLOWED",
      400,
      "Use an official Australian government HTTPS source.",
    );
  }
  parsed.hostname = host;
  parsed.hash = "";
  const url = parsed.toString();
  if (url.length > 2_048) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_URL_INVALID",
      400,
      "The official source URL is too long.",
    );
  }
  return { url, host };
}

function normaliseRetrievedAt(value: unknown) {
  const cleaned = String(value || "").trim();
  const timestamp = Date.parse(cleaned);
  if (
    !Number.isFinite(timestamp)
    || timestamp > Date.now() + 5 * 60 * 1000
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_RETRIEVAL_TIME_INVALID",
      400,
      "Add the time the official source was retrieved.",
    );
  }
  return new Date(timestamp).toISOString();
}

function isLikelyText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function hasOfficeZipSignature(bytes: Uint8Array) {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && [0x03, 0x05, 0x07].includes(bytes[2])
    && [0x04, 0x06, 0x08].includes(bytes[3]);
}

function hasLegacyOfficeSignature(bytes: Uint8Array) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

export function hasOfficialSourceSignature(
  bytes: Uint8Array,
  contentType: string,
) {
  if (contentType === "application/pdf") {
    return bytes.length >= 5
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
      && bytes[4] === 0x2d;
  }
  if (contentType === "application/json") {
    if (!isLikelyText(bytes)) return false;
    try {
      JSON.parse(new TextDecoder().decode(bytes));
      return true;
    } catch {
      return false;
    }
  }
  if (
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return hasOfficeZipSignature(bytes);
  }
  if (
    contentType === "application/msword"
    || contentType === "application/vnd.ms-excel"
  ) {
    return hasLegacyOfficeSignature(bytes);
  }
  return isLikelyText(bytes);
}

export async function sha256Hex(bytes: Uint8Array) {
  const exact = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exact).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function safeObjectSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function exactArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function targetType(value: unknown): CreditexOfficialSourceTargetType {
  const cleaned = String(value || "").trim();
  if (
    cleaned === "program"
    || cleaned === "activity"
    || cleaned === "evidence_policy"
    || cleaned === "calculator"
  ) {
    return cleaned;
  }
  throw new CreditexOfficialSourceCustodyError(
    "SOURCE_TARGET_TYPE_INVALID",
    400,
    "Choose a supported draft compliance target.",
  );
}

async function requireDraftTarget(
  database: D1Database,
  organisationId: string,
  type: CreditexOfficialSourceTargetType,
  id: string,
) {
  const queries: Record<CreditexOfficialSourceTargetType, string> = {
    program: `SELECT target.id
      FROM compliance_programs target
      WHERE target.id = ? AND target.organisation_id = ?
        AND target.publish_state = 'draft'`,
    activity: `SELECT target.id
      FROM compliance_activity_versions target
      JOIN compliance_programs program ON program.id = target.program_id
      WHERE target.id = ? AND program.organisation_id = ?
        AND target.publish_state = 'draft'`,
    evidence_policy: `SELECT target.id
      FROM compliance_evidence_policy_versions target
      JOIN compliance_activity_versions activity
        ON activity.id = target.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
      WHERE target.id = ? AND target.organisation_id = ?
        AND program.organisation_id = target.organisation_id
        AND target.publish_state = 'draft'`,
    calculator: `SELECT target.id
      FROM compliance_calculator_versions target
      JOIN compliance_activity_versions activity
        ON activity.id = target.activity_version_id
      JOIN compliance_programs program
        ON program.id = activity.program_id
      WHERE target.id = ? AND target.organisation_id = ?
        AND program.organisation_id = target.organisation_id
        AND target.approval_state = 'draft'`,
  };
  const record = await database.prepare(queries[type])
    .bind(id, organisationId)
    .first<{ id: string }>();
  if (!record) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_DRAFT_TARGET_NOT_FOUND",
      409,
      "The source can be bound only to an existing draft compliance target.",
    );
  }
}

function publicArtifact(record: OfficialSourceArtifactRecord) {
  return {
    id: record.id,
    clientRequestId: record.client_request_id,
    sourceUrl: record.source_url,
    sourceHost: record.source_host,
    sourceTitle: record.source_title,
    sourceVersion: record.source_version,
    originalFileName: record.original_file_name,
    contentType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    sha256: record.sha256,
    retrievalMethod: "manual_upload",
    assertedRetrievedAt: record.asserted_retrieved_at,
    sourceEtag: record.source_etag,
    sourceLastModified: record.source_last_modified,
    custodyState: record.custody_state,
    ruleActivationEnabled: false,
    capturedByUid: record.captured_by_uid,
    capturedAt: record.captured_at,
  };
}

function publicBinding(record: OfficialSourceBindingRecord) {
  return {
    id: record.id,
    artifactId: record.artifact_id,
    targetType: record.target_type,
    targetId: record.target_id,
    citationLocation: record.citation_location,
    bindingState: record.binding_state,
    ruleActivationEnabled: false,
    createdByUid: record.created_by_uid,
    createdAt: record.created_at,
  };
}

function publicReview(
  record: OfficialSourceReviewRecord | null | undefined,
) {
  if (!record) return null;
  return {
    id: record.id,
    decision: record.decision,
    supersedesDecisionId: record.supersedes_decision_id,
    reviewNote: record.review_note,
    reviewedByUid: record.reviewed_by_uid,
    reviewedAt: record.reviewed_at,
  };
}

function officialSourcePageSize(value: unknown) {
  if (value === undefined || value === null || value === "") return 50;
  const pageSize = Number(value);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_PAGE_SIZE_INVALID",
      400,
      "Choose an official source page size from 1 to 100.",
    );
  }
  return pageSize;
}

function cursorText(value: unknown, maximum: number) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || cleaned.length > maximum) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CURSOR_INVALID",
      400,
      "The official source page cursor is invalid.",
    );
  }
  return cleaned;
}

function encodeOfficialSourceCursor(
  cursor: OfficialSourceCursor,
) {
  const bytes = new TextEncoder().encode(JSON.stringify([
    cursor.capturedAt,
    cursor.artifactId,
    cursor.bindingId,
  ]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeOfficialSourceCursor(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const encoded = cursorText(value, 640);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CURSOR_INVALID",
      400,
      "The official source page cursor is invalid.",
    );
  }
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error();
    const capturedAt = cursorText(parsed[0], 64);
    const artifactId = cursorText(parsed[1], 180);
    const bindingId = cursorText(parsed[2], 180);
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error();
    return { capturedAt, artifactId, bindingId };
  } catch (error) {
    if (error instanceof CreditexOfficialSourceCustodyError) throw error;
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CURSOR_INVALID",
      400,
      "The official source page cursor is invalid.",
    );
  }
}

async function verifiedOfficialSourceBytes(
  bucket: CreditexCustodyBucket,
  record: {
    object_key: string;
    size_bytes: number;
    sha256: string;
  },
) {
  let object;
  try {
    object = await bucket.get(record.object_key);
  } catch {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_OBJECT_UNAVAILABLE",
      503,
      "The retained official source bytes could not be read.",
    );
  }
  if (!object) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_OBJECT_NOT_FOUND",
      409,
      "The recorded official source bytes are missing from custody storage.",
    );
  }
  if (
    typeof object.size === "number"
    && object.size !== Number(record.size_bytes)
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_OBJECT_INTEGRITY_FAILED",
      409,
      "The retained official source bytes do not match the custody record.",
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== Number(record.size_bytes)
    || await sha256Hex(bytes) !== record.sha256
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_OBJECT_INTEGRITY_FAILED",
      409,
      "The retained official source bytes do not match the custody record.",
    );
  }
  return bytes;
}

async function existingCapture(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
) {
  return database.prepare(`SELECT
      artifact.*,
      binding.id binding_id,
      binding.target_type,
      binding.target_id,
      binding.citation_location,
      binding.binding_state,
      binding.created_by_uid binding_created_by_uid,
      binding.created_at binding_created_at
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_bindings binding
      ON binding.artifact_id = artifact.id
      AND binding.organisation_id = artifact.organisation_id
    WHERE artifact.organisation_id = ?
      AND artifact.client_request_id = ?
    ORDER BY binding.created_at, binding.id
    LIMIT 1`)
    .bind(organisationId, clientRequestId)
    .first<OfficialSourceArtifactRecord & {
      binding_id: string;
      target_type: string;
      target_id: string;
      citation_location: string;
      binding_state: string;
      binding_created_by_uid: string;
      binding_created_at: string;
    }>();
}

function assertIdempotentCapture(
  existing: NonNullable<Awaited<ReturnType<typeof existingCapture>>>,
  expected: {
    sourceUrl: string;
    sourceTitle: string;
    sourceVersion: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    assertedRetrievedAt: string;
    sourceEtag: string;
    sourceLastModified: string;
    targetType: string;
    targetId: string;
    citationLocation: string;
  },
) {
  if (
    existing.source_url !== expected.sourceUrl
    || existing.source_title !== expected.sourceTitle
    || existing.source_version !== expected.sourceVersion
    || existing.original_file_name !== expected.fileName
    || existing.content_type !== expected.contentType
    || Number(existing.size_bytes) !== expected.sizeBytes
    || existing.sha256 !== expected.sha256
    || existing.asserted_retrieved_at !== expected.assertedRetrievedAt
    || existing.source_etag !== expected.sourceEtag
    || existing.source_last_modified !== expected.sourceLastModified
    || existing.target_type !== expected.targetType
    || existing.target_id !== expected.targetId
    || existing.citation_location !== expected.citationLocation
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_REQUEST_ID_CONFLICT",
      409,
      "This source capture request reference was already used for different content or binding details.",
    );
  }
}

export async function captureCreditexOfficialSource(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: CustodyMember,
  input: CaptureCreditexOfficialSourceInput,
) {
  if (!["admin", "case_manager"].includes(member.role)) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CUSTODY_ROLE_REQUIRED",
      403,
      "This compliance role cannot capture official source material.",
    );
  }
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const source = normaliseOfficialSourceUrl(input.sourceUrl);
  const sourceTitle = cleanText(
    input.sourceTitle,
    500,
    "SOURCE_TITLE_INVALID",
    "Add the official source title.",
  );
  const sourceVersion = cleanText(
    input.sourceVersion,
    240,
    "SOURCE_VERSION_INVALID",
    "The source version is too long.",
    false,
  );
  const fileName = cleanFileName(input.originalFileName);
  const contentType = normalContentType(input.contentType);
  const assertedRetrievedAt = normaliseRetrievedAt(input.assertedRetrievedAt);
  const sourceEtag = cleanText(
    input.sourceEtag,
    500,
    "SOURCE_ETAG_INVALID",
    "The source ETag is too long.",
    false,
  );
  const sourceLastModified = cleanText(
    input.sourceLastModified,
    240,
    "SOURCE_LAST_MODIFIED_INVALID",
    "The source last-modified value is too long.",
    false,
  );
  const type = targetType(input.targetType);
  const targetId = cleanText(
    input.targetId,
    180,
    "SOURCE_TARGET_INVALID",
    "Choose a draft compliance target.",
  );
  const citationLocation = cleanText(
    input.citationLocation,
    500,
    "SOURCE_CITATION_INVALID",
    "Add the page, section, clause, schedule or table used by the draft target.",
  );
  const bytes = input.bytes;
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1
    || bytes.byteLength > CREDITEX_OFFICIAL_SOURCE_LIMITS.maximumBytes
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_FILE_SIZE_INVALID",
      413,
      "Upload an official source file no larger than 15 MB.",
    );
  }
  if (!hasOfficialSourceSignature(bytes, contentType)) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_FILE_SIGNATURE_INVALID",
      400,
      "The source bytes do not match the declared file type.",
    );
  }

  await requireDraftTarget(
    database,
    member.organisationId,
    type,
    targetId,
  );
  const sha256 = await sha256Hex(bytes);
  const idempotentValues = {
    sourceUrl: source.url,
    sourceTitle,
    sourceVersion,
    fileName,
    contentType,
    sizeBytes: bytes.byteLength,
    sha256,
    assertedRetrievedAt,
    sourceEtag,
    sourceLastModified,
    targetType: type,
    targetId,
    citationLocation,
  };
  const existing = await existingCapture(
    database,
    member.organisationId,
    clientRequestId,
  );
  if (existing) {
    assertIdempotentCapture(existing, idempotentValues);
    await verifiedOfficialSourceBytes(bucket, existing);
    return {
      reused: true,
      artifact: publicArtifact(existing),
      binding: publicBinding({
        id: existing.binding_id,
        artifact_id: existing.id,
        target_type: existing.target_type,
        target_id: existing.target_id,
        citation_location: existing.citation_location,
        binding_state: existing.binding_state,
        created_by_uid: existing.binding_created_by_uid,
        created_at: existing.binding_created_at,
      }),
    };
  }

  const artifactId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const objectKey = [
    "creditex",
    "official-sources",
    safeObjectSegment(member.organisationId),
    sha256,
    artifactId,
  ].join("/");
  await bucket.put(objectKey, exactArrayBuffer(bytes), {
    httpMetadata: { contentType },
    customMetadata: {
      organisationId: member.organisationId,
      artifactId,
      sha256,
      sourceHost: source.host,
      custodyState: "pending_review",
    },
  });

  try {
    await database.batch([
      database.prepare(`INSERT INTO compliance_official_source_artifacts (
          id, organisation_id, client_request_id, source_url, source_host,
          source_title, source_version, original_file_name, content_type,
          size_bytes, sha256, object_key, retrieval_method,
          asserted_retrieved_at, source_etag, source_last_modified,
          custody_state, rule_activation_enabled, captured_by_uid, captured_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_upload',
          ?, ?, ?, 'pending_review', 0, ?, ?
        )`)
        .bind(
          artifactId,
          member.organisationId,
          clientRequestId,
          source.url,
          source.host,
          sourceTitle,
          sourceVersion,
          fileName,
          contentType,
          bytes.byteLength,
          sha256,
          objectKey,
          assertedRetrievedAt,
          sourceEtag,
          sourceLastModified,
          member.uid,
          capturedAt,
        ),
      database.prepare(`INSERT INTO compliance_official_source_bindings (
          id, organisation_id, artifact_id, target_type, target_id,
          citation_location, binding_state, rule_activation_enabled,
          created_by_uid, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending_review', 0, ?, ?)`)
        .bind(
          bindingId,
          member.organisationId,
          artifactId,
          type,
          targetId,
          citationLocation,
          member.uid,
          capturedAt,
        ),
      database.prepare(`INSERT INTO compliance_audit_events (
          id, organisation_id, actor_type, actor_uid, event_type,
          target_type, target_id, summary, metadata, created_at
        ) VALUES (
          ?, ?, 'compliance', ?, 'official_source.captured_for_review',
          'compliance_official_source_artifact', ?,
          'Official source bytes captured for independent governance review.',
          ?, ?
        )`)
        .bind(
          auditId,
          member.organisationId,
          member.uid,
          artifactId,
          JSON.stringify({
            bindingId,
            sourceHost: source.host,
            sha256,
            sizeBytes: bytes.byteLength,
            targetType: type,
            targetId,
            citationLocation,
            custodyState: "pending_review",
            ruleActivationEnabled: false,
          }),
          capturedAt,
        ),
    ]);
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    throw error;
  }

  return {
    reused: false,
    artifact: {
      id: artifactId,
      clientRequestId,
      sourceUrl: source.url,
      sourceHost: source.host,
      sourceTitle,
      sourceVersion,
      originalFileName: fileName,
      contentType,
      sizeBytes: bytes.byteLength,
      sha256,
      retrievalMethod: "manual_upload",
      assertedRetrievedAt,
      sourceEtag,
      sourceLastModified,
      custodyState: "pending_review",
      ruleActivationEnabled: false,
      capturedByUid: member.uid,
      capturedAt,
    },
    binding: {
      id: bindingId,
      artifactId,
      targetType: type,
      targetId,
      citationLocation,
      bindingState: "pending_review",
      ruleActivationEnabled: false,
      createdByUid: member.uid,
      createdAt: capturedAt,
    },
  };
}

function reviewFromListing(
  record: OfficialSourceListingRecord,
  subjectType: "artifact" | "binding",
) {
  const prefix = subjectType === "artifact" ? "artifact" : "binding";
  const id = record[`${prefix}_review_id`];
  const decision = record[`${prefix}_review_decision`];
  if (!id || !decision) return null;
  return publicReview({
    id,
    subject_type: subjectType,
    subject_id: subjectType === "artifact" ? record.id : record.binding_id,
    decision,
    supersedes_decision_id:
      record[`${prefix}_review_supersedes_decision_id`] || "",
    review_note: record[`${prefix}_review_note`] || "",
    reviewed_by_uid: record[`${prefix}_reviewed_by_uid`] || "",
    reviewed_at: record[`${prefix}_reviewed_at`] || "",
  });
}

export async function listCreditexOfficialSources(
  database: D1Database,
  member: CustodyMember,
  options: CreditexOfficialSourcePageOptions = {},
) {
  const pageSize = officialSourcePageSize(options.pageSize);
  const cursor = decodeOfficialSourceCursor(options.cursor);
  const cursorPredicate = cursor
    ? `AND (
        artifact.captured_at < ?
        OR (
          artifact.captured_at = ?
          AND artifact.id < ?
        )
        OR (
          artifact.captured_at = ?
          AND artifact.id = ?
          AND binding.id < ?
        )
      )`
    : "";
  const listBindings = cursor
    ? [
        member.organisationId,
        cursor.capturedAt,
        cursor.capturedAt,
        cursor.artifactId,
        cursor.capturedAt,
        cursor.artifactId,
        cursor.bindingId,
        pageSize + 1,
      ]
    : [member.organisationId, pageSize + 1];
  const [rows, totalRecord] = await Promise.all([
    database.prepare(`SELECT
      artifact.id,
      artifact.client_request_id,
      artifact.source_url,
      artifact.source_host,
      artifact.source_title,
      artifact.source_version,
      artifact.original_file_name,
      artifact.content_type,
      artifact.size_bytes,
      artifact.sha256,
      artifact.asserted_retrieved_at,
      artifact.source_etag,
      artifact.source_last_modified,
      artifact.custody_state,
      artifact.captured_by_uid,
      artifact.captured_at,
      binding.id binding_id,
      binding.artifact_id,
      binding.target_type,
      binding.target_id,
      binding.citation_location,
      binding.binding_state,
      binding.created_by_uid binding_created_by_uid,
      binding.created_at binding_created_at,
      artifact_review.id artifact_review_id,
      artifact_review.decision artifact_review_decision,
      artifact_review.supersedes_decision_id
        artifact_review_supersedes_decision_id,
      artifact_review.review_note artifact_review_note,
      artifact_review.reviewed_by_uid artifact_reviewed_by_uid,
      artifact_review.reviewed_at artifact_reviewed_at,
      binding_review.id binding_review_id,
      binding_review.decision binding_review_decision,
      binding_review.supersedes_decision_id
        binding_review_supersedes_decision_id,
      binding_review.review_note binding_review_note,
      binding_review.reviewed_by_uid binding_reviewed_by_uid,
      binding_review.reviewed_at binding_reviewed_at
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_bindings binding
      ON binding.artifact_id = artifact.id
      AND binding.organisation_id = artifact.organisation_id
    LEFT JOIN compliance_official_source_review_decisions artifact_review
      ON artifact_review.organisation_id = artifact.organisation_id
      AND artifact_review.subject_type = 'artifact'
      AND artifact_review.subject_id = artifact.id
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = artifact_review.organisation_id
          AND newer.subject_type = artifact_review.subject_type
          AND newer.subject_id = artifact_review.subject_id
          AND (
            newer.reviewed_at > artifact_review.reviewed_at
            OR (
              newer.reviewed_at = artifact_review.reviewed_at
              AND newer.id > artifact_review.id
            )
          )
      )
    LEFT JOIN compliance_official_source_review_decisions binding_review
      ON binding_review.organisation_id = binding.organisation_id
      AND binding_review.subject_type = 'binding'
      AND binding_review.subject_id = binding.id
      AND NOT EXISTS (
        SELECT 1
        FROM compliance_official_source_review_decisions newer
        WHERE newer.organisation_id = binding_review.organisation_id
          AND newer.subject_type = binding_review.subject_type
          AND newer.subject_id = binding_review.subject_id
          AND (
            newer.reviewed_at > binding_review.reviewed_at
            OR (
              newer.reviewed_at = binding_review.reviewed_at
              AND newer.id > binding_review.id
            )
          )
      )
    WHERE artifact.organisation_id = ?
      ${cursorPredicate}
    ORDER BY
      artifact.captured_at DESC,
      artifact.id DESC,
      binding.id DESC
    LIMIT ?`)
      .bind(...listBindings)
      .all<OfficialSourceListingRecord>(),
    database.prepare(`SELECT COUNT(*) total
      FROM compliance_official_source_artifacts artifact
      JOIN compliance_official_source_bindings binding
        ON binding.artifact_id = artifact.id
        AND binding.organisation_id = artifact.organisation_id
      WHERE artifact.organisation_id = ?`)
      .bind(member.organisationId)
      .first<{ total: number }>(),
  ]);
  const hasNext = rows.results.length > pageSize;
  const pageRows = rows.results.slice(0, pageSize);
  const items = pageRows.map((record) => ({
    artifact: publicArtifact(record),
    binding: publicBinding({
      id: record.binding_id,
      artifact_id: record.artifact_id,
      target_type: record.target_type,
      target_id: record.target_id,
      citation_location: record.citation_location,
      binding_state: record.binding_state,
      created_by_uid: record.binding_created_by_uid,
      created_at: record.binding_created_at,
    }),
    artifactReview: reviewFromListing(record, "artifact"),
    bindingReview: reviewFromListing(record, "binding"),
  }));
  const last = hasNext ? pageRows.at(-1) : null;
  return {
    items,
    total: Number(totalRecord?.total || 0),
    pageSize,
    hasNext,
    nextCursor: last
      ? encodeOfficialSourceCursor({
          capturedAt: last.captured_at,
          artifactId: last.id,
          bindingId: last.binding_id,
        })
      : null,
  };
}

export async function listCreditexOfficialSourceTargets(
  database: D1Database,
  member: CustodyMember,
) {
  const [programs, activities, evidencePolicies, calculators] =
    await Promise.all([
      database.prepare(`SELECT
          program.id,
          program.program_code,
          program.name,
          program.jurisdiction,
          program.publish_state state
        FROM compliance_programs program
        WHERE program.organisation_id = ?
          AND program.publish_state = 'draft'
        ORDER BY program.name, program.program_code, program.id`)
        .bind(member.organisationId)
        .all<{
          id: string;
          program_code: string;
          name: string;
          jurisdiction: string;
          state: string;
        }>(),
      database.prepare(`SELECT
          activity.id,
          activity.activity_key,
          activity.version,
          activity.title,
          activity.registry_activity_code,
          activity.specification_part,
          activity.scenario_code,
          activity.publish_state state,
          program.program_code,
          program.name program_name
        FROM compliance_activity_versions activity
        JOIN compliance_programs program
          ON program.id = activity.program_id
        WHERE program.organisation_id = ?
          AND activity.publish_state = 'draft'
        ORDER BY
          program.name,
          activity.registry_activity_code,
          activity.activity_key,
          activity.version,
          activity.id`)
        .bind(member.organisationId)
        .all<{
          id: string;
          activity_key: string;
          version: number;
          title: string;
          registry_activity_code: string;
          specification_part: string;
          scenario_code: string;
          state: string;
          program_code: string;
          program_name: string;
        }>(),
      database.prepare(`SELECT
          policy.id,
          policy.version,
          policy.title,
          policy.publish_state state,
          activity.activity_key,
          activity.title activity_title,
          program.program_code,
          program.name program_name
        FROM compliance_evidence_policy_versions policy
        JOIN compliance_activity_versions activity
          ON activity.id = policy.activity_version_id
        JOIN compliance_programs program
          ON program.id = activity.program_id
        WHERE policy.organisation_id = ?
          AND program.organisation_id = policy.organisation_id
          AND policy.publish_state = 'draft'
        ORDER BY
          program.name,
          activity.title,
          policy.title,
          policy.version,
          policy.id`)
        .bind(member.organisationId)
        .all<{
          id: string;
          version: number;
          title: string;
          state: string;
          activity_key: string;
          activity_title: string;
          program_code: string;
          program_name: string;
        }>(),
      database.prepare(`SELECT
          calculator.id,
          calculator.version,
          calculator.title,
          calculator.output_type,
          calculator.approval_state state,
          activity.activity_key,
          activity.title activity_title,
          program.program_code,
          program.name program_name
        FROM compliance_calculator_versions calculator
        JOIN compliance_activity_versions activity
          ON activity.id = calculator.activity_version_id
        JOIN compliance_programs program
          ON program.id = activity.program_id
        WHERE calculator.organisation_id = ?
          AND program.organisation_id = calculator.organisation_id
          AND calculator.approval_state = 'draft'
        ORDER BY
          program.name,
          activity.title,
          calculator.title,
          calculator.version,
          calculator.id`)
        .bind(member.organisationId)
        .all<{
          id: string;
          version: number;
          title: string;
          output_type: string;
          state: string;
          activity_key: string;
          activity_title: string;
          program_code: string;
          program_name: string;
        }>(),
    ]);

  const programLabel = (code: string, name: string) =>
    `${code} | ${name}`;
  return [
    ...programs.results.map((program) => ({
      type: "program" as const,
      id: program.id,
      label:
        `${program.jurisdiction} | ${programLabel(program.program_code, program.name)}`,
      state: program.state,
    })),
    ...activities.results.map((activity) => {
      const parentLabel = programLabel(
        activity.program_code,
        activity.program_name,
      );
      const activityCode = activity.registry_activity_code
        || activity.activity_key;
      const scenario = activity.scenario_code
        ? ` | Scenario ${activity.scenario_code}`
        : "";
      return {
        type: "activity" as const,
        id: activity.id,
        label:
          `${parentLabel} | ${activityCode} | ${activity.title}${scenario} | v${activity.version}`,
        programLabel: parentLabel,
        state: activity.state,
      };
    }),
    ...evidencePolicies.results.map((policy) => {
      const parentLabel = programLabel(
        policy.program_code,
        policy.program_name,
      );
      return {
        type: "evidence_policy" as const,
        id: policy.id,
        label:
          `${parentLabel} | ${policy.activity_title} | Evidence: ${policy.title} | v${policy.version}`,
        programLabel: parentLabel,
        state: policy.state,
      };
    }),
    ...calculators.results.map((calculator) => {
      const parentLabel = programLabel(
        calculator.program_code,
        calculator.program_name,
      );
      return {
        type: "calculator" as const,
        id: calculator.id,
        label:
          `${parentLabel} | ${calculator.activity_title} | Calculator: ${calculator.title} (${calculator.output_type}) | v${calculator.version}`,
        programLabel: parentLabel,
        state: calculator.state,
      };
    }),
  ];
}

export async function downloadCreditexOfficialSource(
  database: D1Database,
  bucket: CreditexCustodyBucket,
  member: CustodyMember,
  artifactIdValue: unknown,
) {
  if (
    !["admin", "case_manager", "reviewer", "auditor"].includes(member.role)
  ) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_CUSTODY_ROLE_REQUIRED",
      403,
      "This compliance role cannot open official source material.",
    );
  }
  const artifactId = cleanText(
    artifactIdValue,
    180,
    "SOURCE_ARTIFACT_ID_INVALID",
    "Choose an official source artifact.",
  );
  const record = await database.prepare(`SELECT
      artifact.id,
      artifact.original_file_name,
      artifact.content_type,
      artifact.size_bytes,
      artifact.sha256,
      artifact.object_key
    FROM compliance_official_source_artifacts artifact
    WHERE artifact.organisation_id = ?
      AND artifact.id = ?
      AND artifact.custody_state IN ('draft', 'pending_review')
      AND artifact.rule_activation_enabled = 0
    LIMIT 1`)
    .bind(member.organisationId, artifactId)
    .first<OfficialSourceDownloadRecord>();
  if (!record) {
    throw new CreditexOfficialSourceCustodyError(
      "SOURCE_ARTIFACT_NOT_FOUND",
      404,
      "The official source artifact was not found in this organisation.",
    );
  }

  const bytes = await verifiedOfficialSourceBytes(bucket, record);

  const receiptId = crypto.randomUUID();
  const accessedAt = new Date().toISOString();
  const receipt = await database.prepare(`INSERT INTO compliance_audit_events (
      id, organisation_id, actor_type, actor_uid, event_type,
      target_type, target_id, summary, metadata, created_at
    ) VALUES (
      ?, ?, 'compliance', ?, 'official_source.retained_bytes_accessed',
      'compliance_official_source_artifact', ?,
      'Authorised Creditex member accessed verified retained official source bytes.',
      ?, ?
    )`)
    .bind(
      receiptId,
      member.organisationId,
      member.uid,
      record.id,
      JSON.stringify({
        accessRole: member.role,
        contentType: record.content_type,
        fileName: record.original_file_name,
        sha256: record.sha256,
        sizeBytes: Number(record.size_bytes),
        custodyState: "retained_exact_bytes_verified",
        ruleActivationEnabled: false,
      }),
      accessedAt,
    )
    .run();
  if (!receipt.success || Number(receipt.meta.changes) !== 1) {
    throw new Error("SOURCE_DOWNLOAD_AUDIT_FAILED");
  }

  return {
    artifactId: record.id,
    fileName: record.original_file_name,
    contentType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    sha256: record.sha256,
    bytes: exactArrayBuffer(bytes),
    receiptId,
    accessedAt,
  };
}
