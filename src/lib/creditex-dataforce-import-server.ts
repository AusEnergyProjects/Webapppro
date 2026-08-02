import type { ComplianceIdentity } from "./compliance-access-server";
import {
  type DataforceJobCsvIssue,
  type DataforceJobCsvRecord,
  validateDataforceJobCsv,
} from "./creditex-dataforce-job-csv";

export const CREDITEX_DATAFORCE_IMPORT_LIMITS = Object.freeze({
  maximumSourceBytes: 5 * 1024 * 1024,
  maximumRows: 2_500,
  maximumReturnedIssues: 50,
  maximumFileNameCharacters: 160,
  maximumRowsPerStatement: 100,
  maximumChunkBytes: 350 * 1024,
  recentBatchLimit: 50,
});

export type CreditexDataforceImportSummary = {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
};

export type CreditexDataforceImportValidation = {
  summary: CreditexDataforceImportSummary;
  issues: readonly DataforceJobCsvIssue[];
  issuesTruncated: boolean;
};

export type CreditexDataforceImportBatch = {
  id: string;
  fileName: string;
  rowCount: number;
  status: "staged_unmapped";
  createdAt: string;
  reused?: boolean;
};

export class CreditexDataforceImportError extends Error {
  readonly code: string;
  readonly status: number;
  readonly validation?: CreditexDataforceImportValidation;

  constructor(
    code: string,
    status: number,
    message: string,
    validation?: CreditexDataforceImportValidation,
  ) {
    super(message);
    this.name = "CreditexDataforceImportError";
    this.code = code;
    this.status = status;
    this.validation = validation;
  }
}

type DataforceImportBatchRow = {
  id: string;
  file_name: string;
  row_count: number;
  status: string;
  created_at: string;
};

type PreparedImportRow = {
  id: string;
  batchId: string;
  organisationId: string;
  rowNumber: number;
  appId: string;
  jobId: string;
  rowSha256: string;
  dataJson: string;
  mappingStatus: "staged_unmapped";
  createdAt: string;
};

function sourceBytes(value: string) {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? sourceBytes(value) : value;
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function emptySummary(): CreditexDataforceImportSummary {
  return {
    totalRows: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    duplicateRows: 0,
  };
}

function safeValidation(
  summary: CreditexDataforceImportSummary,
  issues: readonly DataforceJobCsvIssue[],
  issuesTruncated = false,
): CreditexDataforceImportValidation {
  const returnedIssues = issues
    .slice(0, CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumReturnedIssues)
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      ...(issue.rowNumber === undefined
        ? {}
        : { rowNumber: issue.rowNumber }),
      ...(issue.columnNumber === undefined
        ? {}
        : { columnNumber: issue.columnNumber }),
      ...(issue.header === undefined ? {} : { header: issue.header }),
      ...(issue.firstRowNumber === undefined
        ? {}
        : { firstRowNumber: issue.firstRowNumber }),
    }));
  return {
    summary: { ...summary },
    issues: returnedIssues,
    issuesTruncated:
      issuesTruncated
      || issues.length > CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumReturnedIssues,
  };
}

function sizeValidationIssue(): DataforceJobCsvIssue {
  return {
    code: "SOURCE_TOO_LARGE",
    message: "CSV source exceeds the 5 MiB staging limit.",
  };
}

function rowLimitValidationIssue(): DataforceJobCsvIssue {
  return {
    code: "CSV_TOO_MANY_ROWS",
    message: "CSV contains more than 2,500 rows permitted in one staging batch.",
  };
}

export function sanitizeDataforceImportFileName(value: unknown) {
  const supplied = typeof value === "string" ? value.normalize("NFKC") : "";
  const baseName = supplied.split(/[\\/]/).at(-1) || "";
  const safeName = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._() -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!safeName) return "dataforce-jobs.csv";
  if (/\.csv$/i.test(safeName)) {
    if (
      safeName.length
      <= CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumFileNameCharacters
    ) return safeName;
    return `${safeName.slice(
      0,
      CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumFileNameCharacters - 4,
    )}.csv`;
  }
  return `${safeName.slice(
    0,
    CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumFileNameCharacters - 4,
  )}.csv`;
}

function batchProjection(
  row: DataforceImportBatchRow,
  reused?: boolean,
): CreditexDataforceImportBatch {
  return {
    id: String(row.id),
    fileName: String(row.file_name),
    rowCount: Number(row.row_count),
    status: "staged_unmapped",
    createdAt: String(row.created_at),
    ...(reused === undefined ? {} : { reused }),
  };
}

async function findImportBatch(
  database: D1Database,
  organisationId: string,
  contentSha256: string,
) {
  return database.prepare(`SELECT
      id,
      file_name,
      row_count,
      status,
      created_at
    FROM compliance_legacy_import_batches
    WHERE organisation_id = ?
      AND content_sha256 = ?
    LIMIT 1`)
    .bind(organisationId, contentSha256)
    .first<DataforceImportBatchRow>();
}

function chunkImportRows(rows: readonly PreparedImportRow[]) {
  const chunks: PreparedImportRow[][] = [];
  let chunk: PreparedImportRow[] = [];
  let chunkBytes = 2;
  for (const row of rows) {
    const rowBytes = sourceBytes(JSON.stringify(row)).byteLength + 1;
    if (
      chunk.length > 0
      && (
        chunk.length
          >= CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumRowsPerStatement
        || chunkBytes + rowBytes
          > CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumChunkBytes
      )
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 2;
    }
    chunk.push(row);
    chunkBytes += rowBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

async function prepareImportRows(
  batchId: string,
  organisationId: string,
  rows: readonly { rowNumber: number; record: DataforceJobCsvRecord }[],
  createdAt: string,
) {
  return Promise.all(rows.map(async ({ rowNumber, record }) => {
    const dataJson = JSON.stringify(record);
    return {
      id: `${batchId}:row:${rowNumber}`,
      batchId,
      organisationId,
      rowNumber,
      appId: record["App Id"],
      jobId: record["Job Id"],
      rowSha256: await sha256Hex(dataJson),
      dataJson,
      mappingStatus: "staged_unmapped" as const,
      createdAt,
    };
  }));
}

function importRowStatement(
  database: D1Database,
  rows: readonly PreparedImportRow[],
) {
  return database.prepare(`INSERT INTO compliance_legacy_import_rows (
      id,
      batch_id,
      organisation_id,
      row_number,
      app_id,
      job_id,
      row_sha256,
      data_json,
      mapping_status,
      created_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.batchId'),
      json_extract(value, '$.organisationId'),
      json_extract(value, '$.rowNumber'),
      json_extract(value, '$.appId'),
      json_extract(value, '$.jobId'),
      json_extract(value, '$.rowSha256'),
      json_extract(value, '$.dataJson'),
      'staged_unmapped',
      json_extract(value, '$.createdAt')
    FROM json_each(?)
    WHERE 1
    ON CONFLICT(id) DO NOTHING`)
    .bind(JSON.stringify(rows));
}

function requireImportManager(identity: ComplianceIdentity) {
  if (identity.role !== "admin" && identity.role !== "case_manager") {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_ROLE_REQUIRED",
      403,
      "Creditex administrator or case manager access is required to stage an import.",
    );
  }
}

export async function listCreditexDataforceImportBatches(
  database: D1Database,
  identity: ComplianceIdentity,
) {
  const result = await database.prepare(`SELECT
      id,
      file_name,
      row_count,
      status,
      created_at
    FROM compliance_legacy_import_batches
    WHERE organisation_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?`)
    .bind(
      identity.organisationId,
      CREDITEX_DATAFORCE_IMPORT_LIMITS.recentBatchLimit,
    )
    .all<DataforceImportBatchRow>();
  return result.results.map((row) => batchProjection(row));
}

export async function stageCreditexDataforceImport(
  database: D1Database,
  identity: ComplianceIdentity,
  input: {
    fileName?: unknown;
    csv?: unknown;
  },
  options: {
    now?: string;
  } = {},
) {
  requireImportManager(identity);
  if (typeof input.csv !== "string") {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_REQUEST_INVALID",
      400,
      "CSV text is required.",
    );
  }

  const csvBytes = sourceBytes(input.csv);
  if (
    csvBytes.byteLength
    > CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumSourceBytes
  ) {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_TOO_LARGE",
      413,
      "The Dataforce CSV exceeds the staging limit.",
      safeValidation(emptySummary(), [sizeValidationIssue()]),
    );
  }

  const validation = validateDataforceJobCsv(input.csv);
  if (
    validation.summary.totalRows
    > CREDITEX_DATAFORCE_IMPORT_LIMITS.maximumRows
  ) {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_TOO_MANY_ROWS",
      413,
      "The Dataforce CSV contains too many rows for one staging batch.",
      safeValidation(
        validation.summary,
        [...validation.issues, rowLimitValidationIssue()],
        validation.issuesTruncated,
      ),
    );
  }
  if (!validation.valid) {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_VALIDATION_FAILED",
      400,
      "The Dataforce CSV does not match the required 23-column contract.",
      safeValidation(
        validation.summary,
        validation.issues,
        validation.issuesTruncated,
      ),
    );
  }

  const contentSha256 = await sha256Hex(csvBytes);
  const existing = await findImportBatch(
    database,
    identity.organisationId,
    contentSha256,
  );
  const successValidation = {
    summary: { ...validation.summary },
  };
  if (existing) {
    return {
      batch: batchProjection(existing, true),
      validation: successValidation,
    };
  }

  const batchScopeHash = await sha256Hex(
    `${identity.organisationId}\u0000${contentSha256}`,
  );
  const batchId = `dataforce:${batchScopeHash.slice(0, 48)}`;
  const createdAt = options.now || new Date().toISOString();
  const fileName = sanitizeDataforceImportFileName(input.fileName);
  const preparedRows = await prepareImportRows(
    batchId,
    identity.organisationId,
    validation.rows,
    createdAt,
  );
  const rowChunks = chunkImportRows(preparedRows);
  const auditId = `${batchId}:audit:staged`;
  const statements = [
    database.prepare(`INSERT INTO compliance_legacy_import_batches (
        id,
        organisation_id,
        source_system,
        contract_version,
        file_name,
        content_sha256,
        file_size_bytes,
        row_count,
        status,
        regulated_job_creation_enabled,
        created_by_uid,
        created_at
      ) VALUES (?, ?, 'dataforce', 'dataforce-jobs-v1', ?, ?, ?, ?,
        'staged_unmapped', 0, ?, ?)
      ON CONFLICT(organisation_id, content_sha256) DO NOTHING`)
      .bind(
        batchId,
        identity.organisationId,
        fileName,
        contentSha256,
        csvBytes.byteLength,
        validation.summary.acceptedRows,
        identity.uid,
        createdAt,
      ),
    ...rowChunks.map((chunk) => importRowStatement(database, chunk)),
    database.prepare(`INSERT INTO compliance_audit_events (
        id,
        organisation_id,
        actor_type,
        actor_uid,
        event_type,
        target_type,
        target_id,
        summary,
        metadata,
        created_at
      ) VALUES (?, ?, 'compliance', ?, 'legacy_import_staged',
        'legacy_import_batch', ?,
        'Dataforce jobs were staged for controlled mapping review.',
        ?, ?)
      ON CONFLICT(id) DO NOTHING`)
      .bind(
        auditId,
        identity.organisationId,
        identity.uid,
        batchId,
        JSON.stringify({
          sourceSystem: "dataforce",
          contractVersion: "dataforce-jobs-v1",
          contentSha256,
          fileSizeBytes: csvBytes.byteLength,
          rowCount: validation.summary.acceptedRows,
          status: "staged_unmapped",
          regulatedJobCreationEnabled: false,
        }),
        createdAt,
      ),
  ];
  const results = await database.batch(statements);
  const inserted = Number(results[0]?.meta?.changes || 0) === 1;

  const stored = await findImportBatch(
    database,
    identity.organisationId,
    contentSha256,
  );
  if (!stored) {
    throw new CreditexDataforceImportError(
      "DATAFORCE_IMPORT_WRITE_FAILED",
      500,
      "The Dataforce CSV could not be staged.",
    );
  }
  return {
    batch: batchProjection(stored, !inserted),
    validation: successValidation,
  };
}
