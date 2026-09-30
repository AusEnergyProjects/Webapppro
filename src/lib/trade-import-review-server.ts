export type TradeImportRowFilter = "all" | "ready" | "warning" | "duplicate" | "invalid" | "imported" | "conflict" | "excluded";
export type TradeImportRecordKind = "jobs" | "customers" | "sites" | "appointments" | "contacts";
export type TradeImportLinkedRecord = { id: string; label: string; detail: string; jobId?: string; customerId?: string };
const removedTarget = "EXISTS(SELECT 1 FROM trade_work_orders removed_work WHERE removed_work.id=trade_data_import_rows.target_entity_id AND removed_work.firebase_uid=trade_data_import_rows.firebase_uid AND trade_data_import_rows.target_entity_type='work_order' AND removed_work.record_status='archived')";
const filters: Record<TradeImportRowFilter, string> = {
  all: "1=1", ready: "validation_status='ready'", warning: "validation_status='warning'", duplicate: "result_status='duplicate'",
  invalid: "result_status='invalid'", imported: `result_status='imported' AND NOT ${removedTarget}`, conflict: "result_status='conflict'", excluded: `(result_status IN ('skipped','removed') OR ${removedTarget})`,
};
export function importRowFilter(value: string): TradeImportRowFilter {
  for (const key of ["all", "ready", "warning", "duplicate", "invalid", "imported", "conflict", "excluded"] as const) if (key === value) return key;
  return "all";
}
export function importPage(offset = 0, limit = 100) {
  return { offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0, limit: Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 100 };
}
export async function pageTradeImportRows(db: D1Database, owner: string, batchId: string, offset: number, limit: number, rowFilter = "all") {
  const page = importPage(offset, limit);
  const filter = importRowFilter(rowFilter);
  const where = filters[filter];
  const total = await db.prepare(`SELECT COUNT(*) total FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=? AND ${where}`).bind(batchId, owner).first<{ total: number }>();
  const rows = await db.prepare(`SELECT *,${removedTarget} target_removed FROM trade_data_import_rows WHERE batch_id=? AND firebase_uid=? AND ${where} ORDER BY row_number LIMIT ? OFFSET ?`)
    .bind(batchId, owner, page.limit, page.offset).all<Record<string, unknown>>();
  return { rows: rows.results, total: Number(total?.total || 0), rowFilter: filter,
    nextOffset: page.offset + rows.results.length < Number(total?.total || 0) ? page.offset + rows.results.length : null };
}
export function isTradeImportRecordKind(value: string): value is TradeImportRecordKind {
  return ["jobs", "customers", "sites", "appointments", "contacts"].includes(value);
}

export async function listTradeImportLinkedRecords(db: D1Database, owner: string, batchId: string, format: "dataforce" | "crm_csv", kind: TradeImportRecordKind, offset = 0, limit = 100) {
  const table = format === "dataforce" ? "trade_dataforce_sources" : "trade_csv_import_sources";
  const activeSource = `(source.work_order_id='' OR EXISTS(SELECT 1 FROM trade_work_orders live_work WHERE live_work.id=source.work_order_id AND live_work.firebase_uid=source.firebase_uid AND live_work.record_status='active'))`;
  const queries: Record<TradeImportRecordKind, string> = {
    jobs: `SELECT DISTINCT w.id,w.work_number || ' · ' || w.title label,w.stage detail,w.id jobId,s.crm_customer_id customerId FROM ${table} source JOIN trade_work_orders w ON w.id=source.work_order_id AND w.firebase_uid=source.firebase_uid JOIN trade_crm_job_details s ON s.work_order_id=w.id AND s.firebase_uid=w.firebase_uid WHERE source.firebase_uid=? AND source.import_batch_id=? AND w.record_status='active'`,
    customers: `SELECT DISTINCT c.id,CASE WHEN c.business_name<>'' THEN c.business_name ELSE trim(c.first_name || ' ' || c.last_name) END label,c.email detail,c.id customerId FROM ${table} source JOIN trade_crm_customers c ON c.id=source.customer_id AND c.firebase_uid=source.firebase_uid WHERE source.firebase_uid=? AND source.import_batch_id=? AND c.record_status='active' AND ${activeSource}`,
    sites: `SELECT DISTINCT s.id,s.address_line_1 label,trim(s.suburb || ' ' || s.address_state || ' ' || s.postcode) detail,s.customer_id customerId FROM ${table} source JOIN trade_crm_service_sites s ON s.id=source.service_site_id AND s.firebase_uid=source.firebase_uid WHERE source.firebase_uid=? AND source.import_batch_id=? AND s.record_status='active' AND ${activeSource}`,
    appointments: `SELECT DISTINCT a.id,a.title label,a.starts_at || ' · ' || a.status detail,a.work_order_id jobId,source.customer_id customerId FROM ${table} source JOIN trade_crm_appointments a ON a.work_order_id=source.work_order_id AND a.firebase_uid=source.firebase_uid WHERE source.firebase_uid=? AND source.import_batch_id=? AND ${activeSource}`,
    contacts: `SELECT DISTINCT c.id,trim(c.first_name || ' ' || c.last_name) label,trim(c.role_label || ' · ' || c.email || ' ' || c.phone) detail,c.customer_id customerId FROM ${table} source JOIN trade_crm_customer_contacts c ON c.customer_id=source.customer_id AND c.firebase_uid=source.firebase_uid WHERE source.firebase_uid=? AND source.import_batch_id=? AND c.record_status='active' AND ${activeSource}`,
  };
  const page = importPage(offset, limit); const query = queries[kind];
  const total = await db.prepare(`SELECT COUNT(*) total FROM (${query})`).bind(owner, batchId).first<{ total: number }>();
  const records = await db.prepare(`SELECT * FROM (${query}) ORDER BY label,id LIMIT ? OFFSET ?`).bind(owner, batchId, page.limit, page.offset).all<TradeImportLinkedRecord>();
  return { records: records.results, recordKind: kind, total: Number(total?.total || 0), nextOffset: page.offset + records.results.length < Number(total?.total || 0) ? page.offset + records.results.length : null };
}
