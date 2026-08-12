import {
  cleanupTradeCrmJobMediaRows as cleanupRows,
} from "./trade-crm-job-media-cleanup-core.mjs";

export type TradeCrmJobMediaCleanupBucket = { delete(key: string): Promise<void> };
type CleanupRow = {
  object_key: string;
  firebase_uid: string;
  work_order_id: string;
  attempt_id: string;
  claim_token: string;
  attempts: number;
};

export async function drainTradeCrmJobMediaCleanup(options: {
  db: D1Database;
  bucket: TradeCrmJobMediaCleanupBucket;
  limit?: number;
  now?: Date;
}) {
  const now = options.now || new Date();
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit || 10)));
  const staleClaimAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const due = await options.db.prepare(`SELECT object_key, firebase_uid, work_order_id,
      attempt_id, attempts
    FROM trade_crm_job_media_cleanup
    WHERE (status IN ('staged', 'retry') AND next_attempt_at <= ?)
      OR (status = 'claimed' AND updated_at <= ?)
    ORDER BY next_attempt_at, created_at, object_key LIMIT ?`)
    .bind(now.toISOString(), staleClaimAt, limit).all<CleanupRow>();
  const rows: CleanupRow[] = [];
  for (const row of due.results) {
    const claimToken = crypto.randomUUID();
    const claimed = await options.db.prepare(`UPDATE trade_crm_job_media_cleanup
      SET status = 'claimed', claim_token = ?, updated_at = ?
      WHERE object_key = ? AND attempt_id = ?
        AND ((status IN ('staged', 'retry') AND next_attempt_at <= ?)
          OR (status = 'claimed' AND updated_at <= ?))
        AND NOT EXISTS (SELECT 1 FROM trade_crm_job_media media
          WHERE media.object_key = trade_crm_job_media_cleanup.object_key
            AND media.firebase_uid = trade_crm_job_media_cleanup.firebase_uid
            AND media.work_order_id = trade_crm_job_media_cleanup.work_order_id)`)
      .bind(claimToken, now.toISOString(), row.object_key, row.attempt_id, now.toISOString(), staleClaimAt).run();
    if (Number(claimed.meta.changes || 0) === 1) rows.push({ ...row, claim_token: claimToken });
    else if (await options.db.prepare(`SELECT 1 FROM trade_crm_job_media media
      WHERE media.object_key = ? AND media.firebase_uid = ? AND media.work_order_id = ?`)
      .bind(row.object_key, row.firebase_uid, row.work_order_id).first()) {
      await options.db.prepare(`DELETE FROM trade_crm_job_media_cleanup
        WHERE object_key = ? AND attempt_id = ? AND status IN ('staged', 'retry')`)
        .bind(row.object_key, row.attempt_id).run();
    }
  }
  return cleanupRows({
    rows,
    bucket: options.bucket,
    now,
    store: {
      isCanonical: async (row: CleanupRow) => Boolean(await options.db.prepare(`SELECT 1
        FROM trade_crm_job_media WHERE object_key = ? AND firebase_uid = ? AND work_order_id = ?
        LIMIT 1`).bind(row.object_key, row.firebase_uid, row.work_order_id).first()),
      ownsClaim: async (row: CleanupRow) => Boolean(await options.db.prepare(`SELECT 1
        FROM trade_crm_job_media_cleanup
        WHERE object_key = ? AND attempt_id = ? AND claim_token = ? AND status = 'claimed' LIMIT 1`)
        .bind(row.object_key, row.attempt_id, row.claim_token).first()),
      clear: async (row: CleanupRow) => {
        await options.db.prepare(`DELETE FROM trade_crm_job_media_cleanup
          WHERE object_key = ? AND attempt_id = ? AND claim_token = ? AND status = 'claimed'`)
          .bind(row.object_key, row.attempt_id, row.claim_token).run();
      },
      markFailed: async (row: CleanupRow, attempts: number, nextAttemptAt: string,
        message: string, timestamp: string) => {
        await options.db.prepare(`UPDATE trade_crm_job_media_cleanup
          SET status = 'retry', claim_token = '', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
          WHERE object_key = ? AND attempt_id = ? AND claim_token = ? AND status = 'claimed'`)
          .bind(attempts, nextAttemptAt, message.slice(0, 500), timestamp,
            row.object_key, row.attempt_id, row.claim_token).run();
      },
    },
  });
}
