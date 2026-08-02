import type { ComplianceIdentity } from "./compliance-access-server";

export const CREDITEX_OPERATIONAL_LOOKUP_LIMITS = Object.freeze({
  maximumRequestBytes: 2 * 1024 * 1024,
  maximumRecords: 1_000,
  maximumRecordBytes: 64 * 1024,
  maximumReturnedImports: 50,
  maximumRowsPerStatement: 80,
  maximumChunkBytes: 300 * 1024,
});

export const CREDITEX_OPERATIONAL_LOOKUP_KINDS = [
  "participant",
  "product",
  "licence",
  "recall",
  "suspension",
] as const;

export type CreditexOperationalLookupKind =
  typeof CREDITEX_OPERATIONAL_LOOKUP_KINDS[number];

type LookupMember = Pick<
  ComplianceIdentity,
  "uid" | "organisationId" | "role"
>;

export type StageCreditexOperationalLookupInput = {
  clientRequestId: unknown;
  lookupKind: unknown;
  sourceArtifactId: unknown;
  sourceTimestamp: unknown;
  records: unknown;
};

type SourceArtifactRecord = {
  id: string;
  organisation_id: string;
  sha256: string;
  custody_state: string;
  rule_activation_enabled: number;
};

type LookupImportRecord = {
  id: string;
  client_request_id: string;
  lookup_kind: string;
  source_artifact_id: string;
  source_artifact_sha256: string;
  source_artifact_custody_state: string;
  source_timestamp: string;
  request_sha256: string;
  records_sha256: string;
  record_count: number;
  status: string;
  created_at: string;
};

type PreparedLookupRecord = {
  id: string;
  organisationId: string;
  importId: string;
  rowNumber: number;
  sourceRecordKey: string;
  sourceEffectiveFrom: string;
  sourceEffectiveTo: string;
  sourceStatus: string;
  recordJson: string;
  recordSha256: string;
  createdAt: string;
};

export class CreditexOperationalLookupError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexOperationalLookupError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexOperationalLookupError(code, status, message);
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
    "LOOKUP_REQUEST_ID_INVALID",
    "Add a stable lookup staging request reference.",
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(cleaned)) {
    fail(
      "LOOKUP_REQUEST_ID_INVALID",
      400,
      "Add a stable lookup staging request reference.",
    );
  }
  return cleaned;
}

function cleanLookupKind(value: unknown): CreditexOperationalLookupKind {
  const cleaned = String(value || "").trim();
  if (
    CREDITEX_OPERATIONAL_LOOKUP_KINDS.includes(
      cleaned as CreditexOperationalLookupKind,
    )
  ) {
    return cleaned as CreditexOperationalLookupKind;
  }
  return fail(
    "LOOKUP_KIND_INVALID",
    400,
    "Choose participant, product, licence, recall or suspension source records.",
  );
}

function normalTimestamp(value: unknown) {
  const cleaned = String(value || "").trim();
  const timestamp = Date.parse(cleaned);
  if (
    !Number.isFinite(timestamp)
    || timestamp > Date.now() + 5 * 60 * 1000
  ) {
    fail(
      "LOOKUP_SOURCE_TIMESTAMP_INVALID",
      400,
      "Add the timestamp declared by the official source.",
    );
  }
  return new Date(timestamp).toISOString();
}

function normalDate(
  value: unknown,
  code: string,
  message: string,
  optional = false,
) {
  const cleaned = String(value || "").trim();
  if (optional && !cleaned) return "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)
    || new Date(`${cleaned}T00:00:00.000Z`).toISOString().slice(0, 10)
      !== cleaned
  ) {
    fail(code, 400, message);
  }
  return cleaned;
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 16) {
    fail(
      "LOOKUP_RECORD_INVALID",
      400,
      "A source record is too deeply nested.",
    );
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        "LOOKUP_RECORD_INVALID",
        400,
        "Source records must contain valid JSON values.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`
      ))
      .join(",")}}`;
  }
  return fail(
    "LOOKUP_RECORD_INVALID",
    400,
    "Source records must contain valid JSON values.",
  );
}

function jsonBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
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

function requireLookupWriter(member: LookupMember) {
  if (member.role !== "admin" && member.role !== "case_manager") {
    fail(
      "LOOKUP_ROLE_REQUIRED",
      403,
      "Creditex administrator or case manager access is required to stage official lookup records.",
    );
  }
}

function requireLookupReader(member: LookupMember) {
  if (
    !["admin", "case_manager", "reviewer", "auditor"].includes(member.role)
  ) {
    fail(
      "LOOKUP_ROLE_REQUIRED",
      403,
      "Creditex compliance access is required to review staged lookup records.",
    );
  }
}

async function prepareRecords(
  records: unknown,
  importId: string,
  organisationId: string,
  createdAt: string,
) {
  if (
    !Array.isArray(records)
    || records.length < 1
    || records.length > CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRecords
  ) {
    fail(
      records && Array.isArray(records)
        ? "LOOKUP_RECORD_LIMIT_EXCEEDED"
        : "LOOKUP_RECORDS_INVALID",
      records && Array.isArray(records) ? 413 : 400,
      "Stage between 1 and 1,000 official-source records at a time.",
    );
  }
  const prepared: PreparedLookupRecord[] = [];
  const identities = new Set<string>();
  for (const [index, value] of records.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(
        "LOOKUP_RECORD_INVALID",
        400,
        `Source record ${index + 1} is not a valid record object.`,
      );
    }
    const record = value as Record<string, unknown>;
    const sourceRecordKey = cleanText(
      record.sourceRecordKey,
      240,
      "LOOKUP_RECORD_KEY_INVALID",
      `Source record ${index + 1} needs its exact source key.`,
    );
    const sourceEffectiveFrom = normalDate(
      record.effectiveFrom,
      "LOOKUP_EFFECTIVE_DATE_INVALID",
      `Source record ${index + 1} needs a valid effective-from date.`,
    );
    const sourceEffectiveTo = normalDate(
      record.effectiveTo,
      "LOOKUP_EFFECTIVE_DATE_INVALID",
      `Source record ${index + 1} has an invalid effective-to date.`,
      true,
    );
    if (sourceEffectiveTo && sourceEffectiveTo < sourceEffectiveFrom) {
      fail(
        "LOOKUP_EFFECTIVE_DATE_INVALID",
        400,
        `Source record ${index + 1} ends before it becomes effective.`,
      );
    }
    const sourceStatus = cleanText(
      record.sourceStatus,
      240,
      "LOOKUP_SOURCE_STATUS_INVALID",
      `Source record ${index + 1} needs the status stated by its source.`,
    );
    const sourceRecord = record.sourceRecord;
    if (
      !sourceRecord
      || typeof sourceRecord !== "object"
      || Array.isArray(sourceRecord)
    ) {
      fail(
        "LOOKUP_RECORD_INVALID",
        400,
        `Source record ${index + 1} needs its un-interpreted source object.`,
      );
    }
    const recordJson = canonicalJson(sourceRecord);
    if (
      jsonBytes(recordJson)
      > CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRecordBytes
    ) {
      fail(
        "LOOKUP_RECORD_TOO_LARGE",
        413,
        `Source record ${index + 1} exceeds the 64 KiB record limit.`,
      );
    }
    const identity = canonicalJson([
      sourceRecordKey,
      sourceEffectiveFrom,
      sourceEffectiveTo,
    ]);
    if (identities.has(identity)) {
      fail(
        "LOOKUP_RECORD_DUPLICATE",
        400,
        `Source record ${index + 1} duplicates an effective-dated source identity.`,
      );
    }
    identities.add(identity);
    prepared.push({
      id: `${importId}:row:${index + 1}`,
      organisationId,
      importId,
      rowNumber: index + 1,
      sourceRecordKey,
      sourceEffectiveFrom,
      sourceEffectiveTo,
      sourceStatus,
      recordJson,
      recordSha256: await sha256Hex(recordJson),
      createdAt,
    });
  }
  return prepared;
}

function recordsFingerprint(records: readonly PreparedLookupRecord[]) {
  return canonicalJson(records.map((record) => ({
    rowNumber: record.rowNumber,
    sourceRecordKey: record.sourceRecordKey,
    sourceEffectiveFrom: record.sourceEffectiveFrom,
    sourceEffectiveTo: record.sourceEffectiveTo,
    sourceStatus: record.sourceStatus,
    recordSha256: record.recordSha256,
  })));
}

function publicImport(record: LookupImportRecord, reused?: boolean) {
  return {
    id: String(record.id),
    clientRequestId: String(record.client_request_id),
    lookupKind: String(record.lookup_kind),
    sourceArtifactId: String(record.source_artifact_id),
    sourceArtifactSha256: String(record.source_artifact_sha256),
    sourceTimestamp: String(record.source_timestamp),
    recordsSha256: String(record.records_sha256),
    recordCount: Number(record.record_count),
    status: "staged_pending" as const,
    liveVerificationEnabled: false,
    eligibilityActivationEnabled: false,
    localAssertionEnabled: false,
    createdAt: String(record.created_at),
    ...(reused === undefined ? {} : { reused }),
  };
}

async function existingImport(
  database: D1Database,
  organisationId: string,
  clientRequestId: string,
) {
  return database.prepare(`SELECT
      id,
      client_request_id,
      lookup_kind,
      source_artifact_id,
      source_artifact_sha256,
      source_artifact_custody_state,
      source_timestamp,
      request_sha256,
      records_sha256,
      record_count,
      status,
      created_at
    FROM compliance_operational_lookup_imports
    WHERE organisation_id = ?
      AND client_request_id = ?
    LIMIT 1`)
    .bind(organisationId, clientRequestId)
    .first<LookupImportRecord>();
}

function chunkRecords(records: readonly PreparedLookupRecord[]) {
  const chunks: PreparedLookupRecord[][] = [];
  let chunk: PreparedLookupRecord[] = [];
  let bytes = 2;
  for (const record of records) {
    const size = jsonBytes(JSON.stringify(record)) + 1;
    if (
      chunk.length > 0
      && (
        chunk.length
          >= CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRowsPerStatement
        || bytes + size
          > CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumChunkBytes
      )
    ) {
      chunks.push(chunk);
      chunk = [];
      bytes = 2;
    }
    chunk.push(record);
    bytes += size;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function recordInsert(
  database: D1Database,
  records: readonly PreparedLookupRecord[],
) {
  return database.prepare(`INSERT INTO compliance_operational_lookup_records (
      id,
      organisation_id,
      import_id,
      row_number,
      source_record_key,
      source_effective_from,
      source_effective_to,
      source_status,
      record_json,
      record_sha256,
      status,
      live_verification_enabled,
      eligibility_activation_enabled,
      local_assertion_enabled,
      created_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.organisationId'),
      json_extract(value, '$.importId'),
      json_extract(value, '$.rowNumber'),
      json_extract(value, '$.sourceRecordKey'),
      json_extract(value, '$.sourceEffectiveFrom'),
      json_extract(value, '$.sourceEffectiveTo'),
      json_extract(value, '$.sourceStatus'),
      json_extract(value, '$.recordJson'),
      json_extract(value, '$.recordSha256'),
      'staged_pending',
      0,
      0,
      0,
      json_extract(value, '$.createdAt')
    FROM json_each(?)`)
    .bind(JSON.stringify(records));
}

export async function listCreditexOperationalLookupImports(
  database: D1Database,
  member: LookupMember,
) {
  requireLookupReader(member);
  const result = await database.prepare(`SELECT
      id,
      client_request_id,
      lookup_kind,
      source_artifact_id,
      source_artifact_sha256,
      source_artifact_custody_state,
      source_timestamp,
      request_sha256,
      records_sha256,
      record_count,
      status,
      created_at
    FROM compliance_operational_lookup_imports
    WHERE organisation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?`)
    .bind(
      member.organisationId,
      CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumReturnedImports,
    )
    .all<LookupImportRecord>();
  return result.results.map((record) => publicImport(record));
}

export async function stageCreditexOperationalLookupImport(
  database: D1Database,
  member: LookupMember,
  input: StageCreditexOperationalLookupInput,
  options: { now?: string } = {},
) {
  requireLookupWriter(member);
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  const lookupKind = cleanLookupKind(input.lookupKind);
  const sourceArtifactId = cleanText(
    input.sourceArtifactId,
    180,
    "LOOKUP_SOURCE_ARTIFACT_INVALID",
    "Choose a captured official source artifact.",
  );
  const sourceTimestamp = normalTimestamp(input.sourceTimestamp);
  const sourceArtifact = await database.prepare(`SELECT
      id,
      organisation_id,
      sha256,
      custody_state,
      rule_activation_enabled
    FROM compliance_official_source_artifacts
    WHERE id = ?
      AND organisation_id = ?
      AND custody_state IN ('draft', 'pending_review')
      AND rule_activation_enabled = 0
    LIMIT 1`)
    .bind(sourceArtifactId, member.organisationId)
    .first<SourceArtifactRecord>();
  if (!sourceArtifact) {
    fail(
      "LOOKUP_SOURCE_ARTIFACT_NOT_FOUND",
      409,
      "The official source artifact is unavailable in this Creditex organisation.",
    );
  }
  const createdAt = options.now || new Date().toISOString();
  const importId = crypto.randomUUID();
  const records = await prepareRecords(
    input.records,
    importId,
    member.organisationId,
    createdAt,
  );
  const recordsSha256 = await sha256Hex(recordsFingerprint(records));
  const requestSha256 = await sha256Hex(canonicalJson({
    lookupKind,
    sourceArtifactId,
    sourceArtifactSha256: sourceArtifact.sha256,
    sourceArtifactCustodyState: sourceArtifact.custody_state,
    sourceTimestamp,
    recordsSha256,
    recordCount: records.length,
  }));
  const requestBytes = jsonBytes(canonicalJson({
    clientRequestId,
    lookupKind,
    sourceArtifactId,
    sourceTimestamp,
    records: records.map((record) => ({
      sourceRecordKey: record.sourceRecordKey,
      sourceEffectiveFrom: record.sourceEffectiveFrom,
      sourceEffectiveTo: record.sourceEffectiveTo,
      sourceStatus: record.sourceStatus,
      recordJson: record.recordJson,
    })),
  }));
  if (requestBytes > CREDITEX_OPERATIONAL_LOOKUP_LIMITS.maximumRequestBytes) {
    fail(
      "LOOKUP_REQUEST_TOO_LARGE",
      413,
      "The lookup staging request exceeds the 2 MiB limit.",
    );
  }
  const existing = await existingImport(
    database,
    member.organisationId,
    clientRequestId,
  );
  if (existing) {
    if (existing.request_sha256 !== requestSha256) {
      fail(
        "LOOKUP_REQUEST_ID_CONFLICT",
        409,
        "This lookup request reference was already used for different source records.",
      );
    }
    return { importBatch: publicImport(existing, true) };
  }

  const importRecord: LookupImportRecord = {
    id: importId,
    client_request_id: clientRequestId,
    lookup_kind: lookupKind,
    source_artifact_id: sourceArtifact.id,
    source_artifact_sha256: sourceArtifact.sha256,
    source_artifact_custody_state: sourceArtifact.custody_state,
    source_timestamp: sourceTimestamp,
    request_sha256: requestSha256,
    records_sha256: recordsSha256,
    record_count: records.length,
    status: "staged_pending",
    created_at: createdAt,
  };
  await database.batch([
    database.prepare(`INSERT INTO compliance_operational_lookup_imports (
        id,
        organisation_id,
        client_request_id,
        lookup_kind,
        source_artifact_id,
        source_artifact_sha256,
        source_artifact_custody_state,
        source_timestamp,
        request_sha256,
        records_sha256,
        record_count,
        status,
        live_verification_enabled,
        eligibility_activation_enabled,
        local_assertion_enabled,
        created_by_uid,
        created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'staged_pending', 0, 0, 0, ?, ?
      )`)
      .bind(
        importId,
        member.organisationId,
        clientRequestId,
        lookupKind,
        sourceArtifact.id,
        sourceArtifact.sha256,
        sourceArtifact.custody_state,
        sourceTimestamp,
        requestSha256,
        recordsSha256,
        records.length,
        member.uid,
        createdAt,
      ),
    ...chunkRecords(records).map((chunk) => recordInsert(database, chunk)),
  ]);
  return { importBatch: publicImport(importRecord, false) };
}
