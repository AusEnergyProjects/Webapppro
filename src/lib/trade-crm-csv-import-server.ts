import { prepareTradeCrmCsvImport, TradeCrmCsvValidationError, type TradeCrmCsvFile, type TradeCrmCsvOptions, type TradeCrmCsvImportRow, type TradeCrmCsvPlan } from "./trade-crm-csv-import.ts";
import { prepareTradeImportEntities, tradeImportHash as hash } from "./trade-import-entities-server.ts";
import { isTradeDataforceServiceCategory } from "./trade-dataforce-import-metadata.ts";
import { reserveTlinkJobNumbers } from "./trade-job-number-server.ts";
import { listTradeImportLinkedRecords, pageTradeImportRows, type TradeImportRecordKind } from "./trade-import-review-server.ts";

type Stored = Record<string, unknown>;
type StoredSourceFile = { id: string; firebase_uid: string; batch_id: string; file_id: string; file_name: string; file_role: string;
  source_sha256: string; mapping_json: string; options_json: string; row_count: number; created_at: string };
type Claim = { id: string; row_sha256: string; mapping_sha256: string; work_order_id: string; customer_id: string; import_batch_id: string; target_live: number; removed: number };
export class TradeCrmCsvImportError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const claimSelect = `SELECT s.*,CASE WHEN c.id IS NOT NULL AND (s.entity_type='customer' OR (w.id IS NOT NULL AND d.work_order_id IS NOT NULL AND site.id IS NOT NULL
    AND d.crm_customer_id=s.customer_id AND d.service_site_id=s.service_site_id AND site.customer_id=s.customer_id)) THEN 1 ELSE 0 END target_live,
    CASE WHEN archived.record_status='archived' THEN 1 ELSE 0 END removed
  FROM trade_csv_import_sources s
  LEFT JOIN trade_crm_customers c ON c.id=s.customer_id AND c.firebase_uid=s.firebase_uid AND c.record_status='active'
  LEFT JOIN trade_work_orders w ON w.id=s.work_order_id AND w.firebase_uid=s.firebase_uid AND w.record_status='active'
  LEFT JOIN trade_work_orders archived ON archived.id=s.work_order_id AND archived.firebase_uid=s.firebase_uid
  LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=s.firebase_uid
  LEFT JOIN trade_crm_service_sites site ON site.id=s.service_site_id AND site.firebase_uid=s.firebase_uid AND site.record_status='active'
  WHERE s.firebase_uid=? AND s.source_namespace=? AND s.entity_type=? AND s.source_id=?`;
const jsonObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const textMap = (value: unknown) => {
  if (!jsonObject(value) || Object.values(value).some(item => typeof item !== "string")) throw new TradeCrmCsvImportError("Review each file's column mapping.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
};
export function readTradeCrmCsvRequest(files: unknown, options: unknown): { files: TradeCrmCsvFile[]; options: TradeCrmCsvOptions } {
  if (!Array.isArray(files) || !jsonObject(options)) throw new TradeCrmCsvImportError("Choose CSV files and review their mapping.");
  const parsedFiles = files.map((file): TradeCrmCsvFile => {
    if (!jsonObject(file) || typeof file.id !== "string" || typeof file.fileName !== "string" || typeof file.csvText !== "string"
      || file.role !== "jobs" && file.role !== "customers") throw new TradeCrmCsvImportError("Each file needs its original CSV text, name and role.");
    return { id: file.id, fileName: file.fileName.split(/[\\/]/).at(-1)!.slice(0, 160), csvText: file.csvText, role: file.role, mapping: textMap(file.mapping) };
  });
  if (typeof options.sourceNamespace !== "string" || options.unmatchedJobs !== "block" && options.unmatchedJobs !== "use_job_contacts") throw new TradeCrmCsvImportError("Choose a source account and unmatched job handling.");
  const mappings = options.serviceCategoryMappings === undefined ? {} : textMap(options.serviceCategoryMappings);
  if (Object.values(mappings).some(category => !isTradeDataforceServiceCategory(category))) throw new TradeCrmCsvImportError("Choose supported service categories.");
  const exclusionEntries: [string, number[]][] = [];
  if (options.excludedRows !== undefined) {
    if (!jsonObject(options.excludedRows)) throw new TradeCrmCsvImportError("Choose valid rows to exclude.");
    for (const [key, rows] of Object.entries(options.excludedRows)) {
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row)) || !parsedFiles.some(file => file.id === key)) throw new TradeCrmCsvImportError("An excluded row or file is invalid.");
      exclusionEntries.push([key, rows.map(Number)]);
    }
  }
  return { files: parsedFiles, options: { sourceNamespace: options.sourceNamespace.trim(), unmatchedJobs: options.unmatchedJobs,
    serviceCategoryMappings: mappings, excludedRows: Object.fromEntries(exclusionEntries) } };
}
function canonicalJson(record: Record<string, unknown>) { return JSON.stringify(Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]))); }
async function fingerprints(row: TradeCrmCsvImportRow) {
  return { raw: await hash(canonicalJson(row.record)), mapping: await hash(JSON.stringify({ customerKey: row.customerKey, customer: row.customer,
    address: row.customerAddress, site: row.site, contacts: row.contacts, billing: row.billing, paymentTerms: row.paymentTerms, taxRate: row.taxRate,
    job: row.job, worker: row.worker, legacy: row.legacy })) };
}
async function ownedBatch(db: D1Database, owner: string, batchId: string) {
  const batch = await db.prepare("SELECT * FROM trade_data_import_batches WHERE id=? AND firebase_uid=? AND import_type='crm_csv'").bind(batchId, owner).first<Stored>();
  if (!batch) throw new TradeCrmCsvImportError("Import batch not found.", 404);
  return batch;
}
async function sourceFiles(db: D1Database, owner: string, batchId: string) {
  const files = (await db.prepare("SELECT * FROM trade_csv_import_files WHERE firebase_uid=? AND batch_id=? ORDER BY file_role,file_id").bind(owner, batchId).all<StoredSourceFile>()).results;
  const chunks = await db.prepare(`SELECT chunk.file_id,chunk.chunk_index,chunk.source_text FROM trade_csv_import_file_chunks chunk
    JOIN trade_csv_import_files file ON file.id=chunk.file_id AND file.firebase_uid=chunk.firebase_uid
    WHERE file.firebase_uid=? AND file.batch_id=? ORDER BY chunk.file_id,chunk.chunk_index`).bind(owner, batchId).all<{ file_id: string; chunk_index: number; source_text: string }>();
  return files.map(file => ({ ...file, source_text: chunks.results.filter(chunk => chunk.file_id === file.id).map(chunk => chunk.source_text).join("") }));
}
function sourceChunks(source: string) {
  const chunks: string[] = []; let chunk = ""; let bytes = 0;
  for (const character of source) {
    const point = character.codePointAt(0)!;
    const width = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + width > 250_000) { chunks.push(chunk); chunk = ""; bytes = 0; }
    chunk += character; bytes += width;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
async function storedPlan(db: D1Database, owner: string, batchId: string): Promise<TradeCrmCsvPlan> {
  const files = await sourceFiles(db, owner, batchId);
  if (!files.length) throw new TradeCrmCsvImportError("The original source files are missing.", 409);
  for (const file of files) if (await hash(String(file.source_text)) !== file.source_sha256 || file.options_json !== files[0].options_json) throw new TradeCrmCsvImportError("The original source files no longer match their integrity receipt.", 409);
  const request = readTradeCrmCsvRequest(files.map(file => ({ id: file.file_id, fileName: file.file_name, csvText: file.source_text, role: file.file_role, mapping: JSON.parse(String(file.mapping_json)) })), JSON.parse(String(files[0].options_json)));
  return prepareTradeCrmCsvImport(request.files, request.options);
}
async function batchPayload(db: D1Database, owner: string, batch: Stored) {
  const counts = await db.prepare(`SELECT
    SUM(result_status='pending' AND resolution='import') pending_count,SUM(result_status='conflict') conflict_count,
    SUM(result_status='duplicate') duplicate_count,SUM(result_status='invalid') error_count,SUM(result_status='imported') historical_imported_count,
    SUM(result_status='imported' AND NOT EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=trade_data_import_rows.target_entity_id AND w.firebase_uid=trade_data_import_rows.firebase_uid AND w.record_status='archived')) imported_count,
    SUM(result_status IN ('skipped','removed') OR EXISTS(SELECT 1 FROM trade_work_orders w WHERE w.id=trade_data_import_rows.target_entity_id AND w.firebase_uid=trade_data_import_rows.firebase_uid AND w.record_status='archived')) excluded_count,
    SUM(result_status IN ('duplicate','invalid','conflict','skipped','removed')) skipped_count
    FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=?`).bind(batch.id, owner).first<Stored>();
  return { id: String(batch.id), importType: "crm_csv", fileName: String(batch.file_name), rowCount: Number(batch.row_count), readyCount: Number(batch.ready_count), warningCount: Number(batch.warning_count),
    errorCount: Number(counts?.error_count || 0), duplicateCount: Number(counts?.duplicate_count || 0), importedCount: Number(counts?.imported_count || 0),
    historicalImportedCount: Number(counts?.historical_imported_count || 0),
    excludedCount: Number(counts?.excluded_count || 0), skippedCount: Number(counts?.skipped_count || 0), failedCount: 0, conflictCount: Number(counts?.conflict_count || 0), pendingCount: Number(counts?.pending_count || 0),
    status: String(batch.status), createdAt: String(batch.created_at), updatedAt: String(batch.updated_at), committedAt: String(batch.committed_at || ""), rollbackUntil: "" };
}
function rowPayload(row: Stored) {
  return { id: String(row.id), rowNumber: Number(row.row_number), key: String(row.row_key), values: JSON.parse(String(row.normalized_data)), status: String(row.validation_status),
    issues: JSON.parse(String(row.issues)), resolution: String(row.resolution), resultStatus: row.target_removed ? "removed" : String(row.result_status), targetEntityType: String(row.target_entity_type || ""), targetEntityId: String(row.target_entity_id || ""), error: String(row.error || "") };
}
export async function getTradeCrmCsvImport(db: D1Database, owner: string, batchId = "", offset = 0, limit = 100, rowFilter = "all", records?: TradeImportRecordKind) {
  if (batchId && records) {
    const batch = await ownedBatch(db, owner, batchId);
    return { batch: await batchPayload(db, owner, batch), ...await listTradeImportLinkedRecords(db, owner, batchId, "crm_csv", records, offset, limit) };
  }
  const history = await db.prepare("SELECT * FROM trade_data_import_batches WHERE firebase_uid=? AND import_type='crm_csv' ORDER BY created_at DESC LIMIT 30").bind(owner).all<Stored>();
  const batches = await Promise.all(history.results.map(batch => batchPayload(db, owner, batch)));
  if (!batchId) return { batches, fieldMappings: [] };
  const batch = await ownedBatch(db, owner, batchId); const page = await pageTradeImportRows(db, owner, batchId, offset, limit, rowFilter);
  const plan = await storedPlan(db, owner, batchId);
  const reconciliation = await reconcileTradeCrmCsvImport(db, owner, batchId);
  return { batches, batch: await batchPayload(db, owner, batch), ...page, rows: page.rows.map(rowPayload), reconciliation, fieldMappings: plan.fieldMappings,
    sourceFiles: plan.files.map(file => ({ id: file.id, fileName: file.fileName, role: file.role, rowCount: plan.rows.filter(row => row.sourceFileId === file.id).length })) };
}

export async function previewTradeCrmCsvImport(db: D1Database, owner: string, files: unknown, options: unknown) {
  const request = readTradeCrmCsvRequest(files, options);
  if (new TextEncoder().encode(JSON.stringify({ options: request.options, mappings: request.files.map(file => file.mapping) })).byteLength > 350_000) throw new TradeCrmCsvImportError("The mapping and exclusion choices are too large. Split this import into smaller reviewed batches.", 413);
  let plan: TradeCrmCsvPlan;
  try { plan = prepareTradeCrmCsvImport(request.files, request.options); }
  catch (error) { if (error instanceof Error) throw new TradeCrmCsvImportError(error.message); throw error; }
  const orderedFiles = [...request.files].sort((left, right) => left.role.localeCompare(right.role));
  const batchId = `csv-${await hash(`${owner}\n${JSON.stringify(orderedFiles.map(file => ({ ...file, fileName: "" })))}\n${JSON.stringify(request.options)}`)}`;
  if (await db.prepare("SELECT id FROM trade_data_import_batches WHERE id=? AND firebase_uid=?").bind(batchId, owner).first()) return { ...await getTradeCrmCsvImport(db, owner, batchId), reused: true };
  const now = new Date().toISOString();
  const rows = [];
  const knownSources = new Map<string, Claim>();
  for (const entityType of ["customer", "job"] as const) {
    const sourceIds = plan.rows.filter(row => row.entityType === entityType && row.sourceId).map(row => row.sourceId);
    for (let offset = 0; offset < sourceIds.length; offset += 250) {
      const claims = await db.prepare(claimSelect.replace("s.source_id=?", "s.source_id IN (SELECT value FROM json_each(?))"))
        .bind(owner, request.options.sourceNamespace, entityType, JSON.stringify(sourceIds.slice(offset, offset + 250))).all<Claim & { source_id: string }>();
      for (const claim of claims.results) knownSources.set(JSON.stringify([entityType, claim.source_id]), claim);
    }
  }
  for (const input of plan.rows) {
    const known = knownSources.get(JSON.stringify([input.entityType, input.sourceId]));
    const fingerprint = await fingerprints(input);
    const result = input.excluded ? "skipped" : input.status === "error" ? "invalid" : known ? known.removed ? "removed" : known.target_live && known.row_sha256 === fingerprint.raw && known.mapping_sha256 === fingerprint.mapping ? "duplicate" : "conflict" : "pending";
    rows.push({ id: `${batchId}:${input.rowNumber}`, rowNumber: input.rowNumber, key: input.sourceId, data: JSON.stringify(input),
      status: result === "duplicate" || result === "conflict" ? result : input.status, issues: JSON.stringify(input.issues), resolution: result === "pending" ? "import" : "skip", result,
      targetType: known ? input.entityType === "job" ? "work_order" : "customer" : "", target: known ? known.work_order_id || known.customer_id : "",
      error: result === "conflict" ? "This source key was imported with different data or its linked record changed. Existing records are retained."
        : result === "removed" ? "This source record was intentionally removed. It will not be recreated automatically." : "" });
  }
  const statements = [db.prepare(`INSERT INTO trade_data_import_batches
    (id,firebase_uid,partner_type,import_type,file_name,file_size_bytes,row_count,ready_count,warning_count,duplicate_count,error_count,status,created_at,updated_at)
    VALUES (?,?,'installer','crm_csv',?,?,?,?,?,?,?,'preview',?,?)`).bind(batchId, owner, request.files.map(file => file.fileName).join(" + "),
      request.files.reduce((total, file) => total + new TextEncoder().encode(file.csvText).byteLength, 0), rows.length,
      rows.filter(row => row.status === "ready").length, rows.filter(row => row.status === "warning").length, rows.filter(row => row.result === "duplicate").length, rows.filter(row => row.result === "invalid").length, now, now)];
  for (const file of request.files) {
    const fileId = `${batchId}:${file.id}`;
    statements.push(db.prepare(`INSERT INTO trade_csv_import_files
      (id,firebase_uid,batch_id,file_id,file_name,file_role,source_sha256,mapping_json,options_json,row_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(fileId, owner, batchId, file.id, file.fileName, file.role, await hash(file.csvText), JSON.stringify(file.mapping), JSON.stringify(request.options), plan.rows.filter(row => row.sourceFileId === file.id).length, now));
    sourceChunks(file.csvText).forEach((chunk, index) => statements.push(db.prepare("INSERT INTO trade_csv_import_file_chunks (id,firebase_uid,file_id,chunk_index,source_text) VALUES (?,?,?,?,?)")
      .bind(`${fileId}:${index}`, owner, fileId, index, chunk)));
  }
  // Each source cell remains in the immutable original file and in its exact row record.
  let chunk: typeof rows = []; let chunkBytes = 0;
  const append = () => {
    if (!chunk.length) return;
    statements.push(db.prepare(`INSERT INTO trade_data_import_rows
      (id,batch_id,firebase_uid,row_number,row_key,normalized_data,validation_status,issues,resolution,result_status,target_entity_type,target_entity_id,error,created_at,updated_at)
      SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.rowNumber'),json_extract(value,'$.key'),json_extract(value,'$.data'),json_extract(value,'$.status'),json_extract(value,'$.issues'),
        json_extract(value,'$.resolution'),json_extract(value,'$.result'),json_extract(value,'$.targetType'),json_extract(value,'$.target'),json_extract(value,'$.error'),?,? FROM json_each(?)`)
      .bind(batchId, owner, now, now, JSON.stringify(chunk)));
    chunk = []; chunkBytes = 0;
  };
  for (const row of rows) {
    const bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    if (bytes > 1_500_000) throw new TradeCrmCsvImportError(`Source row ${row.rowNumber} is too large for one record. Split oversized fields before importing.`, 413);
    if (chunk.length >= 50 || chunkBytes + bytes > 350_000) append();
    chunk.push(row); chunkBytes += bytes;
  }
  append();
  try { await db.batch(statements); }
  catch (error) { if (!await db.prepare("SELECT id FROM trade_data_import_batches WHERE id=? AND firebase_uid=?").bind(batchId, owner).first()) throw error; }
  return { ...await getTradeCrmCsvImport(db, owner, batchId), reused: false };
}

export async function commitTradeCrmCsvImport(db: D1Database, owner: string, batchId: string) {
  const batch = await ownedBatch(db, owner, batchId);
  if (!["preview", "committing", "committed", "needs_review"].includes(String(batch.status))) throw new TradeCrmCsvImportError("This batch cannot be resumed.", 409);
  const plan = await storedPlan(db, owner, batchId);
  const pending = await db.prepare("SELECT * FROM trade_data_import_rows WHERE firebase_uid=? AND batch_id=? AND result_status='pending' AND resolution='import' ORDER BY row_number LIMIT 20").bind(owner, batchId).all<Stored>();
  const now = new Date().toISOString();
  const numbers = await reserveTlinkJobNumbers(db, pending.results.filter(row => plan.rows.find(input => input.rowNumber === row.row_number)?.entityType === "job").length, now);
  let numberIndex = 0;
  for (const stored of pending.results) {
    const input = plan.rows.find(row => row.rowNumber === stored.row_number);
    const update = (result: string, error: string, targetType = "", target = "") => db.prepare(`UPDATE trade_data_import_rows SET result_status=?,error=?,target_entity_type=?,target_entity_id=?,updated_at=?
      WHERE id=? AND batch_id=? AND firebase_uid=? AND result_status='pending'`).bind(result, error, targetType, target, now, stored.id, batchId, owner);
    if (!input || input.excluded || input.status === "error" || JSON.stringify(input) !== stored.normalized_data) { await update("invalid", "The saved source row no longer matches its validated original. Prepare a new preview.").run(); continue; }
    const fingerprint = await fingerprints(input);
    const findClaim = () => db.prepare(claimSelect).bind(owner, plan.options.sourceNamespace, input.entityType, input.sourceId).first<Claim>();
    const resolve = async (known: Claim) => {
      const result = known.removed ? "removed" : known.target_live && known.row_sha256 === fingerprint.raw && known.mapping_sha256 === fingerprint.mapping
        ? known.import_batch_id === batchId ? "imported" : "duplicate" : "conflict";
      await update(result, result === "conflict" ? "This source key already belongs to changed or unavailable records. Existing records were retained."
        : result === "removed" ? "This source record was intentionally removed. It will not be recreated automatically." : "", input.entityType === "job" ? "work_order" : "customer", known.work_order_id || known.customer_id).run();
    };
    const existing = await findClaim();
    if (existing) { await resolve(existing); continue; }
    const workOrderId = input.entityType === "job" ? `csvj-${await hash(`${owner}\n${plan.options.sourceNamespace}\n${input.sourceId}`)}` : "";
    const entities = await prepareTradeImportEntities(db, owner, input, { prefix: "csv", workOrderId, workNumber: input.entityType === "job" ? numbers[numberIndex++] : "", now });
    if (!entities.ok) { await update("conflict", entities.message).run(); continue; }
    const sourceId = `csvs-${await hash(`${owner}\n${plan.options.sourceNamespace}\n${input.entityType}\n${input.sourceId}`)}`;
    const statements = [db.prepare(`INSERT INTO trade_csv_import_sources
      (id,firebase_uid,source_namespace,entity_type,source_id,row_sha256,mapping_sha256,raw_json,import_batch_id,import_row_id,source_file_id,source_row_number,work_order_id,customer_id,service_site_id,customer_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sourceId, owner, plan.options.sourceNamespace, input.entityType, input.sourceId, fingerprint.raw, fingerprint.mapping, JSON.stringify(input.record),
      batchId, String(stored.id), input.sourceFileId, input.sourceRowNumber, workOrderId, entities.customerId, entities.serviceSiteId, input.customerKey, now),
      ...entities.statements, update("imported", "", input.entityType === "job" ? "work_order" : "customer", workOrderId || entities.customerId)];
    try { await db.batch(statements); } catch (error) { const winner = await findClaim(); if (!winner) throw error; await resolve(winner); }
  }
  const payload = await batchPayload(db, owner, batch);
  await db.prepare(`UPDATE trade_data_import_batches SET status=?,imported_count=?,skipped_count=?,committed_at=CASE WHEN ?=0 THEN ? ELSE committed_at END,updated_at=? WHERE id=? AND firebase_uid=?`)
    .bind(payload.pendingCount ? "committing" : payload.errorCount || payload.conflictCount ? "needs_review" : "committed", payload.historicalImportedCount, payload.skippedCount, payload.pendingCount, now, now, batchId, owner).run();
  const reconciliation = payload.pendingCount ? undefined : await reconcileTradeCrmCsvImport(db, owner, batchId);
  if (reconciliation && (reconciliation.brokenLinks || reconciliation.mismatchedSourceRows)) throw new TradeCrmCsvImportError("Import reconciliation found an incomplete link. Original source records are retained for review.", 409);
  return { batch: await batchPayload(db, owner, await ownedBatch(db, owner, batchId)), processedCount: pending.results.length, hasMore: payload.pendingCount > 0, ...(reconciliation ? { reconciliation } : {}) };
}

export async function reconcileTradeCrmCsvImport(db: D1Database, owner: string, batchId: string) {
  await ownedBatch(db, owner, batchId);
  const counts = await db.prepare(`SELECT COUNT(*) source_rows,COALESCE(SUM((SELECT COUNT(*) FROM json_each(s.raw_json))),0) source_cells,
    COALESCE(SUM(CASE WHEN w.record_status='archived' THEN 1 ELSE 0 END),0) removed_count,
    COALESCE(SUM(CASE WHEN w.record_status='archived' THEN 0 WHEN c.id IS NULL OR c.record_status<>'active' OR r.id IS NULL
      OR (s.entity_type='job' AND (w.id IS NULL OR d.work_order_id IS NULL OR site.id IS NULL OR d.crm_customer_id<>s.customer_id OR d.service_site_id<>s.service_site_id OR site.customer_id<>s.customer_id)) THEN 1 ELSE 0 END),0) broken_links,
    COALESCE(SUM(CASE WHEN r.id IS NULL OR EXISTS(SELECT 1 FROM json_each(s.raw_json) cell WHERE cell.value IS NOT json_extract(r.normalized_data,'$.record.' || json_quote(cell.key)))
      OR (SELECT COUNT(*) FROM json_each(s.raw_json))<>(SELECT COUNT(*) FROM json_each(r.normalized_data,'$.record')) THEN 1 ELSE 0 END),0) mismatched_source_rows
    FROM trade_csv_import_sources s LEFT JOIN trade_data_import_rows r ON r.id=s.import_row_id AND r.firebase_uid=s.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id=s.customer_id AND c.firebase_uid=s.firebase_uid
    LEFT JOIN trade_work_orders w ON w.id=s.work_order_id AND w.firebase_uid=s.firebase_uid
    LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=s.firebase_uid
    LEFT JOIN trade_crm_service_sites site ON site.id=s.service_site_id AND site.firebase_uid=s.firebase_uid
    WHERE s.firebase_uid=? AND s.import_batch_id=?`).bind(owner, batchId).first<Stored>();
  const kinds = ["jobs", "customers", "sites", "appointments", "contacts"] as const;
  const pages = await Promise.all(kinds.map(kind => listTradeImportLinkedRecords(db, owner, batchId, "crm_csv", kind, 0, 1)));
  return { jobs: pages[0].total, customers: pages[1].total, sites: pages[2].total, appointments: pages[3].total, contacts: pages[4].total,
    sourceRows: Number(counts?.source_rows || 0), sourceCells: Number(counts?.source_cells || 0), removedCount: Number(counts?.removed_count || 0),
    brokenLinks: Number(counts?.broken_links || 0), mismatchedSourceRows: Number(counts?.mismatched_source_rows || 0) };
}
export async function exportTradeCrmCsvSource(db: D1Database, owner: string, batchId: string, fileId: string) {
  await ownedBatch(db, owner, batchId);
  const files = await sourceFiles(db, owner, batchId);
  const file = fileId ? files.find(file => file.file_id === fileId) : files.length === 1 ? files[0] : null;
  if (!file) throw new TradeCrmCsvImportError("Choose one original source file to download.", 404);
  if (await hash(String(file.source_text)) !== file.source_sha256) throw new TradeCrmCsvImportError("The source file failed its integrity check.", 409);
  return { fileName: file.file_role === "customers" ? "client-import-source.csv" : "job-import-source.csv", csv: String(file.source_text) };
}
export { TradeCrmCsvValidationError };
