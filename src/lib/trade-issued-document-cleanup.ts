import { getD1 } from "../../db";
import { deleteImmutableIssuedPdf } from "@/lib/trade-issued-document-store";

type Row = Record<string, unknown>;

function retryAt(attempts: number) {
  const delay = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts, 10));
  return new Date(Date.now() + delay).toISOString();
}

export async function stageTradeIssuedDocumentCleanup(input: {
  kind: "quote" | "invoice";
  documentId: string;
  revision: number;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}) {
  const now = new Date().toISOString();
  const staleAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await getD1().prepare(`INSERT INTO trade_issued_document_cleanup
    (object_key, document_kind, document_id, revision, sha256, size_bytes,
     status, attempts, next_attempt_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'staged', 0, ?, '', ?, ?)
    ON CONFLICT(object_key) DO UPDATE SET status = 'staged',
      next_attempt_at = excluded.next_attempt_at, last_error = '',
      updated_at = excluded.updated_at`)
    .bind(input.objectKey, input.kind, input.documentId, input.revision,
      input.sha256, input.sizeBytes, staleAt, now, now).run();
}

export async function activateTradeIssuedDocumentCleanup(objectKey: string) {
  const now = new Date().toISOString();
  await getD1().prepare(`UPDATE trade_issued_document_cleanup
    SET status = 'pending', next_attempt_at = ?, updated_at = ?
    WHERE object_key = ?`).bind(now, now, objectKey).run();
}

export async function cleanupUnreferencedTradeIssuedDocuments(limit = 20) {
  const db = getD1();
  const now = new Date().toISOString();
  await db.prepare(`DELETE FROM trade_issued_document_cleanup
    WHERE EXISTS (
      SELECT 1 FROM trade_crm_quote_versions version
      WHERE version.issued_pdf_object_key = trade_issued_document_cleanup.object_key
        AND version.status = 'issued'
    )`).run();
  const rows = await db.prepare(`SELECT * FROM trade_issued_document_cleanup cleanup
    WHERE cleanup.status IN ('pending', 'staged') AND cleanup.next_attempt_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM trade_crm_quote_versions version
        WHERE version.issued_pdf_object_key = cleanup.object_key
          AND version.status = 'issued'
      )
    ORDER BY cleanup.next_attempt_at, cleanup.object_key LIMIT ?`)
    .bind(now, Math.max(1, Math.min(100, Math.trunc(limit)))).all<Row>();
  for (const row of rows.results) {
    try {
      await deleteImmutableIssuedPdf({
        objectKey: String(row.object_key),
        sha256: String(row.sha256),
        sizeBytes: Number(row.size_bytes),
      }, {
        kind: String(row.document_kind) as "quote" | "invoice",
        documentId: String(row.document_id),
        revision: Number(row.revision),
      });
      await db.prepare("DELETE FROM trade_issued_document_cleanup WHERE object_key = ?")
        .bind(row.object_key).run();
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await db.prepare(`UPDATE trade_issued_document_cleanup
        SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE object_key = ?`)
        .bind(attempts, retryAt(attempts),
          error instanceof Error ? error.message.slice(0, 180) : "Cleanup failed.",
          now, row.object_key).run();
    }
  }
  return rows.results.length;
}
