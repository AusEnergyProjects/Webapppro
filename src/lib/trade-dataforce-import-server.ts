import { DATAFORCE_JOB_CSV_HEADERS } from "./creditex-dataforce-job-csv.ts";
import { prepareTradeDataforceImport, TRADE_DATAFORCE_FIELD_MAPPINGS, TRADE_DATAFORCE_IMPORT_LIMITS, type TradeDataforceImportRow } from "./trade-dataforce-import.ts";
import { reserveTlinkJobNumbers } from "./trade-job-number-server.ts";
import { prepareTradeImportEntities, tradeImportHash as hash } from "./trade-import-entities-server.ts";
import { listTradeImportLinkedRecords, pageTradeImportRows, type TradeImportRecordKind } from "./trade-import-review-server.ts";

type Database = D1Database;
type Stored = Record<string, unknown>;
type Source = { source_job_id: string; row_sha256: string; work_order_id: string; import_batch_id: string; target_live: number; target_removed: number; mapped_service_category: string };
const SOURCE_QUERY = `SELECT source.source_job_id,source.row_sha256,source.work_order_id,source.import_batch_id,
  EXISTS(SELECT 1 FROM trade_work_orders removed_work WHERE removed_work.id=source.work_order_id AND removed_work.firebase_uid=source.firebase_uid AND removed_work.record_status='archived') target_removed,
  json_extract(source_receipt.normalized_data,'$.job.serviceCategory') mapped_service_category,
  CASE WHEN work.id IS NOT NULL AND detail.work_order_id IS NOT NULL AND customer.id IS NOT NULL AND site.id IS NOT NULL
    AND detail.crm_customer_id=source.customer_id AND detail.service_site_id=source.service_site_id AND site.customer_id=source.customer_id
    THEN 1 ELSE 0 END target_live
  FROM trade_dataforce_sources source
  LEFT JOIN trade_data_import_rows source_receipt ON source_receipt.id=source.import_row_id AND source_receipt.firebase_uid=source.firebase_uid
  LEFT JOIN trade_work_orders work ON work.id=source.work_order_id AND work.firebase_uid=source.firebase_uid AND work.record_status='active'
  LEFT JOIN trade_crm_job_details detail ON detail.work_order_id=source.work_order_id AND detail.firebase_uid=source.firebase_uid
  LEFT JOIN trade_crm_customers customer ON customer.id=source.customer_id AND customer.firebase_uid=source.firebase_uid AND customer.record_status='active'
  LEFT JOIN trade_crm_service_sites site ON site.id=source.service_site_id AND site.firebase_uid=source.firebase_uid AND site.record_status='active'
  WHERE source.firebase_uid=? AND source.source_system='dataforce'`;
export const DATAFORCE_COMMIT_CHUNK_SIZE = 20;
export const DATAFORCE_IMPORT_MAX_BYTES = TRADE_DATAFORCE_IMPORT_LIMITS.maximumSourceBytes;
export const DATAFORCE_IMPORT_MAX_ROWS = TRADE_DATAFORCE_IMPORT_LIMITS.maximumRows;

export class TradeDataforceImportError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function rawJson(row: TradeDataforceImportRow) {
  return JSON.stringify(Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map(header => [header, row.record[header]])));
}
function fileName(value: unknown) {
  return String(value || "job-import.csv").split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "job-import.csv";
}
function parsedRow(row: Stored): TradeDataforceImportRow {
  // Revalidate persisted input through the same mapper before any CRM write.
  let value: unknown;
  try { value = JSON.parse(String(row.normalized_data)); } catch { throw new TradeDataforceImportError("The saved import row is invalid. Prepare a new preview.", 409); }
  if (!value || typeof value !== "object" || !("record" in value)) throw new TradeDataforceImportError("The saved import row is incomplete.", 409);
  const record = value.record;
  if (!record || typeof record !== "object" || DATAFORCE_JOB_CSV_HEADERS.some(header => !(header in record) || typeof Reflect.get(record, header) !== "string")) {
    throw new TradeDataforceImportError("The saved source record is incomplete.", 409);
  }
  const csv = [DATAFORCE_JOB_CSV_HEADERS, DATAFORCE_JOB_CSV_HEADERS.map(header => Reflect.get(record, header))]
    .map(columns => columns.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const override = "serviceCategoryOverride" in value ? value.serviceCategoryOverride : undefined;
  if (override !== undefined && typeof override !== "string") throw new TradeDataforceImportError("The saved service category choice is invalid.", 409);
  const validated = prepareTradeDataforceImport(csv, override === undefined ? {} : { serviceCategoryMappings: { [Reflect.get(record, "Work Type")]: override } });
  const input = validated.rows[0];
  if (!input || input.status === "error") throw new TradeDataforceImportError("The saved source row no longer passes validation. Prepare a new preview.", 409);
  return { ...input, rowNumber: Number(row.row_number) };
}
function rowPayload(row: Stored) {
  const issues: unknown = JSON.parse(String(row.issues));
  const visibleIssues = Array.isArray(issues) ? issues.map(issue => issue && typeof issue === "object" && "message" in issue
    ? { ...issue, message: String(issue.message).replace(/\bDataforce\b/gi, "source") } : issue) : issues;
  return { id: String(row.id), rowNumber: Number(row.row_number), key: String(row.row_key),
    values: JSON.parse(String(row.normalized_data)), status: String(row.validation_status),
    issues: visibleIssues, resolution: String(row.resolution), resultStatus: row.target_removed ? "removed" : String(row.result_status),
    targetEntityType: String(row.target_entity_type || ""), targetEntityId: String(row.target_entity_id || ""), error: String(row.error || "").replace(/\bDataforce\b/gi, "source") };
}
async function ownedBatch(db: Database, owner: string, batchId: string) {
  const batch = await db.prepare("SELECT * FROM trade_data_import_batches WHERE id=? AND firebase_uid=? AND import_type='dataforce'").bind(batchId, owner).first<Stored>();
  if (!batch) throw new TradeDataforceImportError("Job import batch not found.", 404);
  return batch;
}
async function batchPayload(db: Database, owner: string, batch: Stored) {
  const counts = await db.prepare(`SELECT
    SUM(CASE WHEN result_status='pending' AND resolution='import' THEN 1 ELSE 0 END) pending_count,
    SUM(CASE WHEN result_status='conflict' THEN 1 ELSE 0 END) conflict_count,
    SUM(CASE WHEN result_status='duplicate' THEN 1 ELSE 0 END) duplicate_count,
    SUM(CASE WHEN result_status='invalid' THEN 1 ELSE 0 END) error_count,
    SUM(CASE WHEN result_status='imported' THEN 1 ELSE 0 END) historical_imported_count,
    SUM(CASE WHEN result_status='imported' AND NOT EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=trade_data_import_rows.target_entity_id AND w.firebase_uid=trade_data_import_rows.firebase_uid AND w.record_status='archived') THEN 1 ELSE 0 END) imported_count,
    SUM(CASE WHEN result_status IN ('skipped','removed') OR EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=trade_data_import_rows.target_entity_id AND w.firebase_uid=trade_data_import_rows.firebase_uid AND w.record_status='archived') THEN 1 ELSE 0 END) excluded_count,
    SUM(CASE WHEN result_status IN ('duplicate','invalid','conflict') THEN 1 ELSE 0 END) skipped_count
    FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=?`).bind(batch.id, owner).first<Stored>();
  return { id: String(batch.id), importType: "dataforce", fileName: String(batch.file_name), rowCount: Number(batch.row_count),
    readyCount: Number(batch.ready_count), warningCount: Number(batch.warning_count), errorCount: Number(counts?.error_count || 0),
    duplicateCount: Number(counts?.duplicate_count || 0), importedCount: Number(counts?.imported_count || 0),
    historicalImportedCount: Number(counts?.historical_imported_count || 0), excludedCount: Number(counts?.excluded_count || 0),
    skippedCount: Number(counts?.skipped_count || 0), failedCount: Number(batch.failed_count || 0),
    conflictCount: Number(counts?.conflict_count || 0), pendingCount: Number(counts?.pending_count || 0),
    status: String(batch.status), createdAt: String(batch.created_at), updatedAt: String(batch.updated_at),
    committedAt: String(batch.committed_at || ""), rollbackUntil: "" };
}

export async function getTradeDataforceImport(db: Database, owner: string, batchId = "", offset = 0, limit = 100, rowFilter = "all", records?: TradeImportRecordKind) {
  if (batchId && records) {
    const batch = await ownedBatch(db, owner, batchId);
    return { batch: await batchPayload(db, owner, batch), ...await listTradeImportLinkedRecords(db, owner, batchId, "dataforce", records, offset, limit) };
  }
  const history = await db.prepare("SELECT * FROM trade_data_import_batches WHERE firebase_uid=? AND import_type='dataforce' ORDER BY created_at DESC LIMIT 30").bind(owner).all<Stored>();
  const batches = await Promise.all(history.results.map(batch => batchPayload(db, owner, batch)));
  if (!batchId) return { batches, fieldMappings: TRADE_DATAFORCE_FIELD_MAPPINGS };
  const stored = await ownedBatch(db, owner, batchId);
  const page = await pageTradeImportRows(db, owner, batchId, offset, limit, rowFilter);
  const payload = await batchPayload(db, owner, stored);
  const reconciliation = await reconcileTradeDataforceImport(db, owner, batchId);
  const integrityWarning = reconciliation.brokenLinks || reconciliation.mismatchedSourceRows ? "Some previously imported records have been deleted, archived or relinked, or a source record no longer matches its preview. The original source remains available; review these records before importing again." : "";
  return { batches, batch: { ...payload, ...(integrityWarning ? { status: "needs_review", integrityWarning } : {}) }, ...page, rows: page.rows.map(rowPayload), reconciliation,
    fieldMappings: TRADE_DATAFORCE_FIELD_MAPPINGS };
}

export async function previewTradeDataforceImport(db: Database, owner: string, source: string, suppliedName: unknown, mappingInput: unknown = {}) {
  if (new TextEncoder().encode(source).byteLength > DATAFORCE_IMPORT_MAX_BYTES) throw new TradeDataforceImportError("Choose a jobs CSV no larger than 10 MB.", 413);
  if (!mappingInput || typeof mappingInput !== "object" || Array.isArray(mappingInput)
    || Object.values(mappingInput).some(value => typeof value !== "string")) throw new TradeDataforceImportError("Choose a valid service category for each source work type.");
  const serviceCategoryMappings = Object.fromEntries(Object.entries(mappingInput).map(([key, value]) => [key, String(value)]));
  const plan = prepareTradeDataforceImport(source, { serviceCategoryMappings });
  const invalidMapping = plan.issues.find(issue => issue.code === "SERVICE_CATEGORY_MAPPING_INVALID");
  if (invalidMapping) throw new TradeDataforceImportError(invalidMapping.message);
  if (plan.summary.totalRows !== plan.rows.length) {
    const issue = plan.issues.find(item => item.code === "CSV_ROW_COLUMN_COUNT" || item.code === "CSV_BLANK_ROW");
    throw new TradeDataforceImportError(`${issue?.rowNumber ? `Row ${issue.rowNumber}: ` : ""}${issue?.message || "Every source row must have the complete 23-column record. Correct the CSV before previewing."}`);
  }
  if (!plan.rows.length) throw new TradeDataforceImportError(plan.issues[0]?.message || "The file has no importable job rows.");
  if (plan.rows.length > DATAFORCE_IMPORT_MAX_ROWS) throw new TradeDataforceImportError("A job import batch supports up to 20,000 jobs.");
  // File identity includes the owner. A filename change never creates another migration.
  const sortedMappings = Object.fromEntries(Object.entries(serviceCategoryMappings).map(([key, value]) => [key.trim().replace(/\s+/g, " ").toLowerCase(), value])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const batchId = `df-${await hash(`${owner}\n${source}\n${JSON.stringify(sortedMappings)}`)}`;
  const existing = await db.prepare("SELECT id FROM trade_data_import_batches WHERE id=? AND firebase_uid=? AND import_type='dataforce'").bind(batchId, owner).first();
  if (existing) return { ...await getTradeDataforceImport(db, owner, batchId), reused: true };
  const known = new Map<string, Source>();
  for (let start = 0; start < plan.rows.length; start += 250) {
    const sources = await db.prepare(`${SOURCE_QUERY} AND source.source_job_id IN (SELECT value FROM json_each(?))`)
      .bind(owner, JSON.stringify(plan.rows.slice(start, start + 250).map(row => row.sourceJobId))).all<Source>();
    for (const source of sources.results) known.set(source.source_job_id, source);
  }
  const now = new Date().toISOString();
  const rows = await Promise.all(plan.rows.map(async input => {
    const old = known.get(input.sourceJobId);
    const fingerprint = await hash(rawJson(input));
    const status = input.status === "error" ? "error" : old ? old.target_removed ? "removed" : old.row_sha256 === fingerprint && old.target_live && old.mapped_service_category === input.job.serviceCategory ? "duplicate" : "conflict" : input.status;
    const message = status === "duplicate" ? "This exact source job is already imported. The existing job is retained."
      : status === "conflict" ? old && !old.target_live ? "This source was imported previously, but its linked record was deleted, archived or changed. Review it; it will not be recreated automatically."
        : "This source job ID already exists with different source data. Review it before changing the existing job." : "";
    const issues = [...input.issues, ...(message ? [{ code: status === "conflict" ? "SOURCE_CONFLICT" : "SOURCE_DUPLICATE", level: "warning", message, rowNumber: input.rowNumber }] : [])];
    return { id: `${batchId}:${input.rowNumber}`, rowNumber: input.rowNumber, key: input.sourceJobId, data: JSON.stringify(input),
      status, issues: JSON.stringify(issues), resolution: ["error", "duplicate", "conflict", "removed"].includes(status) ? "skip" : "import",
      result: status === "error" ? "invalid" : status === "duplicate" || status === "conflict" || status === "removed" ? status : "pending", target: old?.work_order_id || "" };
  }));
  const count = (status: string) => rows.filter(row => row.status === status).length;
  const statements = [db.prepare(`INSERT INTO trade_data_import_batches
    (id,firebase_uid,partner_type,import_type,file_name,file_size_bytes,row_count,ready_count,warning_count,duplicate_count,error_count,status,created_at,updated_at)
    VALUES (?,?,'installer','dataforce',?,?,?,?,?,?,?,'preview',?,?)`).bind(batchId, owner, fileName(suppliedName), new TextEncoder().encode(source).byteLength,
      rows.length, count("ready"), count("warning"), count("duplicate"), count("error"), now, now)];
  // All preview rows and their batch commit together. A interrupted upload is never a partial preview.
  const chunks: typeof rows[] = [];
  let chunk: typeof rows = [];
  let chunkBytes = 2;
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (rowBytes > 1_500_000) throw new TradeDataforceImportError(`Row ${row.rowNumber} is too large to store safely. Split its oversized source fields before importing.`, 413);
    if (chunk.length && (chunk.length >= 50 || chunkBytes + rowBytes > 350_000)) { chunks.push(chunk); chunk = []; chunkBytes = 2; }
    chunk.push(row); chunkBytes += rowBytes;
  }
  if (chunk.length) chunks.push(chunk);
  for (const previewRows of chunks) {
    statements.push(db.prepare(`INSERT INTO trade_data_import_rows
      (id,batch_id,firebase_uid,row_number,row_key,normalized_data,validation_status,issues,resolution,result_status,target_entity_type,target_entity_id,error,created_at,updated_at)
      SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.rowNumber'),json_extract(value,'$.key'),json_extract(value,'$.data'),
        json_extract(value,'$.status'),json_extract(value,'$.issues'),json_extract(value,'$.resolution'),json_extract(value,'$.result'),
        CASE WHEN json_extract(value,'$.target')<>'' THEN 'work_order' ELSE '' END,json_extract(value,'$.target'),'',?,?
      FROM json_each(?)`).bind(batchId, owner, now, now, JSON.stringify(previewRows)));
  }
  try { await db.batch(statements); }
  catch (error) {
    // Another identical preview can win the same unique batch ID transaction.
    const winner = await db.prepare("SELECT id FROM trade_data_import_batches WHERE id=? AND firebase_uid=? AND import_type='dataforce'").bind(batchId, owner).first();
    if (!winner) throw error;
  }
  return { ...await getTradeDataforceImport(db, owner, batchId), reused: false };
}

async function existingSource(db: Database, owner: string, sourceJobId: string) {
  return db.prepare(`${SOURCE_QUERY} AND source.source_job_id=?`)
    .bind(owner, sourceJobId).first<Source>();
}
async function resolveExistingSource(db: Database, owner: string, batchId: string, row: Stored, old: Source, fingerprint: string, serviceCategory: string) {
  const same = old.row_sha256 === fingerprint && old.target_live && old.mapped_service_category === serviceCategory;
  const status = old.target_removed ? "removed" : same ? old.import_batch_id === batchId ? "imported" : "duplicate" : "conflict";
  await db.prepare(`UPDATE trade_data_import_rows SET result_status=?,target_entity_type='work_order',target_entity_id=?,
    error=?,updated_at=? WHERE id=? AND batch_id=? AND firebase_uid=? AND result_status='pending'`)
    .bind(status, old.work_order_id, same ? "" : "Source job already exists with different original data. Existing records were retained.", new Date().toISOString(), row.id, batchId, owner).run();
}

async function commitRow(db: Database, owner: string, batchId: string, stored: Stored, workNumber: string) {
  let input: TradeDataforceImportRow;
  try { input = parsedRow(stored); }
  catch (error) {
    if (!(error instanceof TradeDataforceImportError)) throw error;
    await db.prepare("UPDATE trade_data_import_rows SET result_status='invalid',validation_status='error',resolution='skip',error=?,updated_at=? WHERE id=? AND batch_id=? AND firebase_uid=? AND result_status='pending'")
      .bind(error.message, new Date().toISOString(), stored.id, batchId, owner).run();
    return;
  }
  const sourceJson = rawJson(input);
  const fingerprint = await hash(sourceJson);
  const old = await existingSource(db, owner, input.sourceJobId);
  if (old) { await resolveExistingSource(db, owner, batchId, stored, old, fingerprint, input.job.serviceCategory); return; }
  const now = new Date().toISOString();
  const workOrderId = `dfj-${await hash(`${owner}\n${input.sourceJobId}`)}`;
  const entities = await prepareTradeImportEntities(db, owner, input, { prefix: "df", workOrderId, workNumber, now });
  if (!entities.ok) {
    await db.prepare(`UPDATE trade_data_import_rows SET result_status='conflict',validation_status='conflict',resolution='skip',error=?,updated_at=?
      WHERE id=? AND batch_id=? AND firebase_uid=? AND result_status='pending'`)
      .bind(entities.message, now, stored.id, batchId, owner).run();
    return;
  }
  const statements = [db.prepare(`INSERT INTO trade_dataforce_sources
    (id,firebase_uid,source_system,source_job_id,source_app_id,row_sha256,raw_json,mapping_version,import_batch_id,import_row_id,work_order_id,customer_id,service_site_id,customer_key,site_key,created_at)
    VALUES (?,?,'dataforce',?,?,?,?,'dataforce-crm-v1',?,?,?,?,?,?,?,?)`).bind(workOrderId, owner, input.sourceJobId, input.sourceAppId,
      fingerprint, sourceJson, batchId, String(stored.id), workOrderId, entities.customerId, entities.serviceSiteId, input.customerKey, input.siteKey, now),
    ...entities.statements,
    db.prepare(`UPDATE trade_data_import_rows SET result_status='imported',target_entity_type='work_order',target_entity_id=?,error='',updated_at=?
      WHERE id=? AND batch_id=? AND firebase_uid=? AND result_status='pending'`).bind(workOrderId, now, String(stored.id), batchId, owner),
  ];
  // The unique source claim, every CRM entity and the row receipt share one D1 transaction.
  try { await db.batch(statements); }
  catch (error) {
    const winner = await existingSource(db, owner, input.sourceJobId);
    if (!winner) throw error;
    await resolveExistingSource(db, owner, batchId, stored, winner, fingerprint, input.job.serviceCategory);
  }
}

export async function commitTradeDataforceImport(db: Database, owner: string, batchId: string) {
  const batch = await ownedBatch(db, owner, batchId);
  if (!["preview", "committing", "committed", "needs_review"].includes(String(batch.status))) throw new TradeDataforceImportError("This batch cannot be resumed.", 409);
  const rows = await db.prepare(`SELECT * FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=? AND result_status='pending'
    AND resolution='import' ORDER BY row_number LIMIT ?`).bind(batchId, owner, DATAFORCE_COMMIT_CHUNK_SIZE).all<Stored>();
  const now = new Date().toISOString();
  if (rows.results.length) {
    await db.prepare("UPDATE trade_data_import_batches SET status='committing',updated_at=? WHERE id=? AND firebase_uid=? AND import_type='dataforce'").bind(now, batchId, owner).run();
    const numbers = await reserveTlinkJobNumbers(db, rows.results.length, now);
    for (let offset = 0; offset < rows.results.length; offset += 4) {
      const results = await Promise.allSettled(rows.results.slice(offset, offset + 4).map((row, index) => commitRow(db, owner, batchId, row, numbers[offset + index])));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
  }
  const current = await batchPayload(db, owner, await ownedBatch(db, owner, batchId));
  const status = current.pendingCount ? "committing" : current.errorCount || current.conflictCount ? "needs_review" : "committed";
  await db.prepare(`UPDATE trade_data_import_batches SET status=?,imported_count=?,skipped_count=?,failed_count=0,
    committed_at=CASE WHEN ?=0 THEN ? ELSE committed_at END,updated_at=? WHERE id=? AND firebase_uid=? AND import_type='dataforce'`)
    .bind(status, current.historicalImportedCount, current.skippedCount, current.pendingCount, now, now, batchId, owner).run();
  const reconciliation = current.pendingCount ? undefined : await reconcileTradeDataforceImport(db, owner, batchId);
  if (reconciliation && (reconciliation.brokenLinks || reconciliation.mismatchedSourceRows || reconciliation.jobs !== current.importedCount)) {
    throw new TradeDataforceImportError("Import reconciliation found an incomplete link. Saved source records are retained for review.", 409);
  }
  return { batch: await batchPayload(db, owner, await ownedBatch(db, owner, batchId)), processedCount: rows.results.length,
    hasMore: current.pendingCount > 0, ...(reconciliation ? { reconciliation } : {}) };
}

export async function reconcileTradeDataforceImport(db: Database, owner: string, batchId: string) {
  await ownedBatch(db, owner, batchId);
  const result = await db.prepare(`SELECT COUNT(DISTINCT source.work_order_id) jobs,
    COUNT(DISTINCT CASE WHEN work.record_status='archived' THEN source.work_order_id END) removed_count,
    COUNT(DISTINCT source.customer_id) customers,COUNT(DISTINCT source.service_site_id) sites,
    COUNT(DISTINCT appointment.id) appointments,COUNT(DISTINCT contact.id) contacts,
    COUNT(DISTINCT CASE WHEN work.record_status='archived' THEN NULL WHEN work.id IS NULL OR detail.work_order_id IS NULL OR customer.id IS NULL OR site.id IS NULL
      OR work.record_status<>'active' OR customer.record_status<>'active' OR site.record_status<>'active'
      OR detail.crm_customer_id<>source.customer_id OR detail.service_site_id<>source.service_site_id
      OR site.customer_id<>source.customer_id OR receipt.target_entity_id<>source.work_order_id
      OR receipt.result_status<>'imported' THEN source.id END) broken_links
    FROM trade_dataforce_sources source
    LEFT JOIN trade_work_orders work ON work.id=source.work_order_id AND work.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_job_details detail ON detail.work_order_id=source.work_order_id AND detail.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_customers customer ON customer.id=source.customer_id AND customer.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_service_sites site ON site.id=source.service_site_id AND site.firebase_uid=source.firebase_uid
    LEFT JOIN trade_data_import_rows receipt ON receipt.id=source.import_row_id AND receipt.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_appointments appointment ON appointment.work_order_id=source.work_order_id AND appointment.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_site_contacts site_contact ON site_contact.service_site_id=source.service_site_id AND site_contact.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_customer_contacts contact ON contact.id=site_contact.customer_contact_id AND contact.firebase_uid=source.firebase_uid
    WHERE source.firebase_uid=? AND source.import_batch_id=?`).bind(owner, batchId).first<Stored>();
  const expected = (path: string) => path === "job.workStage" || path === "job.pipelineStage" ? "'imported'" : `json_extract(receipt.normalized_data,'$.${path}')`;
  const differentText = (column: string, path: string) => `lower(trim(COALESCE(${column},''))) <> lower(trim(COALESCE(${expected(path)},'')))`;
  const phoneSql = (value: string) => {
    const digits = `replace(replace(replace(replace(replace(COALESCE(${value},''),' ',''),'-',''),'+',''),'(',''),')','')`;
    return `(CASE WHEN substr(${digits},1,2)='61' AND length(${digits})=11 THEN '0'||substr(${digits},3) ELSE ${digits} END)`;
  };
  const differences = [
    ["customer.first_name", "customer.firstName"], ["customer.last_name", "customer.lastName"],
    ["customer.business_name", "customer.businessName"], ["customer.email", "customer.email"],
    ["site.address_line_1", "site.addressLine1"], ["site.suburb", "site.suburb"], ["site.address_state", "site.state"], ["site.postcode", "site.postcode"],
    ["work.service_category", "job.serviceCategory"], ["work.stage", "job.workStage"], ["work.title", "job.title"],
    ["work.scheduled_start", "job.scheduledStart"], ["work.scheduled_end", "job.scheduledEnd"],
    ["work.assignee_label", "worker.displayName"], ["detail.pipeline_stage", "job.pipelineStage"],
    ["detail.customer_reference", "customer.externalReference"],
  ].map(([column, path]) => differentText(column, path));
  differences.push(`${phoneSql("customer.phone")} <> ${phoneSql(expected("customer.contactPhone"))}`);
  for (const field of ["phone", "mobile"]) differences.push(`(${expected(`customer.${field}`)}<>'' AND NOT EXISTS(
    SELECT 1 FROM trade_crm_customer_contacts source_contact WHERE source_contact.firebase_uid=source.firebase_uid
      AND source_contact.customer_id=source.customer_id AND source_contact.record_status='active'
      AND ${phoneSql("source_contact.phone")}=${phoneSql(expected(`customer.${field}`))}))`);
  const fidelity = await db.prepare(`SELECT COUNT(*) source_rows,
    COALESCE(SUM((SELECT COUNT(*) FROM json_each(source.raw_json))),0) source_cells,
    COALESCE(SUM(CASE WHEN receipt.id IS NULL OR (SELECT COUNT(*) FROM json_each(source.raw_json))<>23
      OR EXISTS(SELECT 1 FROM json_each(source.raw_json) cell
        WHERE cell.value IS NOT json_extract(receipt.normalized_data,'$.record.' || json_quote(cell.key))) THEN 1 ELSE 0 END),0) mismatched_source_rows,
    COALESCE(SUM(CASE WHEN work.record_status='archived' THEN 0 WHEN work.stage IS NOT 'imported'
      OR work.scheduled_start IS NOT json_extract(receipt.normalized_data,'$.job.scheduledStart')
      OR (json_extract(receipt.normalized_data,'$.job.scheduledStart')<>''
        AND appointment.starts_at IS NOT json_extract(receipt.normalized_data,'$.job.scheduledStart')) THEN 1 ELSE 0 END),0) changed_jobs,
    COALESCE(SUM(CASE WHEN work.record_status='archived' THEN 0 WHEN ${differences.join(" OR ")} THEN 1 ELSE 0 END),0) mapped_field_mismatches
    FROM trade_dataforce_sources source
    LEFT JOIN trade_data_import_rows receipt ON receipt.id=source.import_row_id AND receipt.firebase_uid=source.firebase_uid
    LEFT JOIN trade_work_orders work ON work.id=source.work_order_id AND work.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_job_details detail ON detail.work_order_id=source.work_order_id AND detail.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_customers customer ON customer.id=source.customer_id AND customer.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_service_sites site ON site.id=source.service_site_id AND site.firebase_uid=source.firebase_uid
    LEFT JOIN trade_crm_appointments appointment ON appointment.id=source.work_order_id || ':visit' AND appointment.firebase_uid=source.firebase_uid
    WHERE source.firebase_uid=? AND source.import_batch_id=?`).bind(owner, batchId).first<Stored>();
  const kinds = ["jobs", "customers", "sites", "appointments", "contacts"] as const;
  const pages = await Promise.all(kinds.map(kind => listTradeImportLinkedRecords(db, owner, batchId, "dataforce", kind, 0, 1)));
  return { jobs: pages[0].total, customers: pages[1].total, sites: pages[2].total,
    appointments: pages[3].total, contacts: pages[4].total, removedCount: Number(result?.removed_count || 0), brokenLinks: Number(result?.broken_links || 0),
    sourceRows: Number(fidelity?.source_rows || 0), sourceCells: Number(fidelity?.source_cells || 0),
    mismatchedSourceRows: Number(fidelity?.mismatched_source_rows || 0), changedJobs: Number(fidelity?.changed_jobs || 0),
    mappedFieldMismatches: Number(fidelity?.mapped_field_mismatches || 0) };
}

export async function exportTradeDataforceSource(db: Database, owner: string, batchId: string) {
  await ownedBatch(db, owner, batchId);
  const rows = await db.prepare("SELECT normalized_data FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=? ORDER BY row_number").bind(batchId, owner).all<Stored>();
  const columns = [DATAFORCE_JOB_CSV_HEADERS, ...rows.results.map(row => {
    const value = JSON.parse(String(row.normalized_data)) as TradeDataforceImportRow;
    return DATAFORCE_JOB_CSV_HEADERS.map(header => value.record[header]);
  })];
  return { fileName: "job-import-source.csv", csv: `\uFEFF${columns.map(values => values.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n")}\r\n` };
}
