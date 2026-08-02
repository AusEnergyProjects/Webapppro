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
      WHERE target.id = ? AND target.organisation_id = ?
        AND target.publish_state = 'draft'`,
    calculator: `SELECT target.id
      FROM compliance_calculator_versions target
      WHERE target.id = ? AND target.organisation_id = ?
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
    if (!await bucket.head(existing.object_key)) {
      throw new CreditexOfficialSourceCustodyError(
        "SOURCE_OBJECT_NOT_FOUND",
        409,
        "The recorded official source bytes are missing from custody storage.",
      );
    }
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

export async function listCreditexOfficialSources(
  database: D1Database,
  member: CustodyMember,
) {
  const rows = await database.prepare(`SELECT
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
      binding.created_at binding_created_at
    FROM compliance_official_source_artifacts artifact
    JOIN compliance_official_source_bindings binding
      ON binding.artifact_id = artifact.id
      AND binding.organisation_id = artifact.organisation_id
    WHERE artifact.organisation_id = ?
    ORDER BY artifact.captured_at DESC, artifact.id DESC
    LIMIT 100`)
    .bind(member.organisationId)
    .all<OfficialSourceArtifactRecord & {
      binding_id: string;
      artifact_id: string;
      target_type: string;
      target_id: string;
      citation_location: string;
      binding_state: string;
      binding_created_by_uid: string;
      binding_created_at: string;
    }>();
  return rows.results.map((record) => ({
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
  }));
}
