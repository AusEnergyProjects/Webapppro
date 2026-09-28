import type { AccountingProvider } from "./trade-accounting";

export type AccountingDispatch = {
  invoice_id: string;
  firebase_uid: string;
  work_order_id: string;
  connection_id: string;
  provider: AccountingProvider;
  external_account_id: string;
  account_reference: string;
  attempts: number;
};

/** Append to the acceptance batch: no invoice or connection means no export intent. */
export function acceptedInvoiceAccountingDispatch(db: D1Database, invoiceId: string, now: string) {
  return db.prepare(`INSERT INTO trade_crm_accounting_dispatches
    (invoice_id, firebase_uid, work_order_id, connection_id, provider,
     external_account_id, account_reference, next_attempt_at, created_at, updated_at)
    SELECT invoice.id, invoice.firebase_uid, invoice.work_order_id, connection.id,
      connection.provider, connection.external_account_id, connection.default_account_reference, ?, ?, ?
    FROM trade_crm_accepted_invoices invoice
    JOIN trade_crm_integrations connection ON connection.id = (
      SELECT candidate.id FROM trade_crm_integrations candidate
      WHERE candidate.firebase_uid = invoice.firebase_uid AND candidate.status = 'connected'
        AND candidate.provider IN ('xero', 'myob', 'quickbooks') AND trim(candidate.external_account_id) <> ''
      ORDER BY candidate.last_sync_at DESC, candidate.provider ASC LIMIT 1)
    WHERE invoice.id = ? AND invoice.status = 'issued'
    ON CONFLICT(invoice_id) DO NOTHING`).bind(now, now, now, invoiceId);
}

const RETRYABLE = new Set(["PROVIDER_REQUEST_FAILED", "EXPORT_IN_PROGRESS", "ACCOUNTING_TEMPORARY_FAILURE"]);

export async function drainAccountingDispatches(options: {
  db: D1Database;
  exportInvoice: (dispatch: AccountingDispatch) => Promise<unknown>;
  invoiceId?: string;
  now?: string;
}) {
  const { db } = options;
  const now = options.now || new Date().toISOString();
  await db.prepare(`UPDATE trade_crm_accounting_dispatches
    SET status = 'needs_attention', last_error = 'ACCOUNTING_RETRY_LIMIT', lease_token = '', lease_expires_at = '', updated_at = ?
    WHERE status = 'processing' AND lease_expires_at <= ? AND attempts >= 8
      ${options.invoiceId ? "AND invoice_id = ?" : ""}`)
    .bind(now, now, ...(options.invoiceId ? [options.invoiceId] : [])).run();
  const rows = await db.prepare(`SELECT * FROM trade_crm_accounting_dispatches
    WHERE ((status IN ('pending', 'retry') AND next_attempt_at <= ?)
      OR (status = 'processing' AND lease_expires_at <= ?))
      ${options.invoiceId ? "AND invoice_id = ?" : ""}
    ORDER BY next_attempt_at, invoice_id LIMIT 5`)
    .bind(now, now, ...(options.invoiceId ? [options.invoiceId] : [])).all<AccountingDispatch>();
  for (const row of rows.results) {
    const lease = crypto.randomUUID();
    const expires = new Date(Date.parse(now) + 10 * 60_000).toISOString();
    const claim = await db.prepare(`UPDATE trade_crm_accounting_dispatches
      SET status = 'processing', lease_token = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE invoice_id = ? AND ((status IN ('pending', 'retry') AND next_attempt_at <= ?)
        OR (status = 'processing' AND lease_expires_at <= ?))`)
      .bind(lease, expires, now, row.invoice_id, now, now).run();
    if (Number(claim.meta.changes || 0) !== 1) continue;
    let errorCode = "";
    try { await options.exportInvoice(row); }
    catch (error) {
      // Store fixed codes only; provider error bodies can contain private information.
      const code = error instanceof Error ? error.message : "";
      errorCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "ACCOUNTING_TEMPORARY_FAILURE";
    }
    const retry = RETRYABLE.has(errorCode) && row.attempts < 7;
    const next = new Date(Date.parse(now) + Math.min(60, 2 ** (row.attempts + 1)) * 60_000).toISOString();
    await db.prepare(`UPDATE trade_crm_accounting_dispatches
      SET status = ?, last_error = ?, next_attempt_at = ?, lease_token = '', lease_expires_at = '', updated_at = ?
      WHERE invoice_id = ? AND lease_token = ? AND status = 'processing'`)
      .bind(errorCode ? retry ? "retry" : "needs_attention" : "synced", errorCode, next, now, row.invoice_id, lease).run();
  }
}

export async function accountingAutomationStatus(db: D1Database, ownerUid: string, workOrderId: string) {
  return db.prepare(`SELECT provider, status, last_error AS errorCode FROM trade_crm_accounting_dispatches
    WHERE firebase_uid = ? AND work_order_id = ?`).bind(ownerUid, workOrderId)
    .first<{ provider: AccountingProvider; status: string; errorCode: string }>();
}
