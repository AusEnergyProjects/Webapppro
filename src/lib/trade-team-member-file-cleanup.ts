export type TradeTeamMemberCleanupRow = {
  id: string;
  owner_uid: string;
  team_member_id: string;
  object_key: string;
  cleanup_attempts: number;
  status: "uploading" | "cleanup_pending";
};

export type TradeTeamMemberCleanupBucket = {
  delete(key: string): Promise<void>;
};

export type TradeTeamMemberCleanupStore = {
  markDeleted(row: TradeTeamMemberCleanupRow, now: string): Promise<void>;
  markFailed(row: TradeTeamMemberCleanupRow, attempts: number, nextCleanupAt: string, now: string): Promise<void>;
};

export { tradeTeamMemberCleanupDelay };

export async function cleanupTradeTeamMemberFileRows(options: {
  rows: TradeTeamMemberCleanupRow[];
  bucket: TradeTeamMemberCleanupBucket;
  store: TradeTeamMemberCleanupStore;
  now?: Date;
}) {
  return cleanupRows(options);
}

function auditStatement(db: D1Database, row: TradeTeamMemberCleanupRow, now: string) {
  return db.prepare(`INSERT INTO trade_team_member_events
    (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
    SELECT ?, ?, ?, 'system', 'file', ?, 'file.cleanup_completed', ?, ?
    WHERE EXISTS (SELECT 1 FROM trade_team_member_files
      WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'deleted' AND deleted_at = ?)
      AND NOT EXISTS (SELECT 1 FROM trade_team_member_events
        WHERE owner_uid = ? AND entity_type = 'file' AND entity_id = ? AND event_type = 'file.cleanup_completed')`)
    .bind(crypto.randomUUID(), row.owner_uid, row.team_member_id, row.id,
      JSON.stringify({ attempts: Number(row.cleanup_attempts || 0), recoveredFrom: row.status }), now,
      row.id, row.owner_uid, row.team_member_id, now, row.owner_uid, row.id);
}

export async function drainTradeTeamMemberFileCleanup(options: {
  db: D1Database;
  bucket: TradeTeamMemberCleanupBucket;
  ownerUid?: string;
  fileId?: string;
  limit?: number;
  now?: Date;
}) {
  const now = options.now || new Date();
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit || 10)));
  const ownerUid = options.ownerUid || "";
  const fileId = options.fileId || "";
  const staleUploadCutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = await options.db.prepare(`SELECT id, owner_uid, team_member_id, object_key, cleanup_attempts, status
    FROM trade_team_member_files
    WHERE (status = 'cleanup_pending' OR (status = 'uploading' AND updated_at <= ?))
      AND (? = '' OR owner_uid = ?) AND (? = '' OR id = ?)
      AND (status = 'uploading' OR next_cleanup_at = '' OR next_cleanup_at <= ?)
    ORDER BY updated_at, id LIMIT ?`)
    .bind(staleUploadCutoff, ownerUid, ownerUid, fileId, fileId, now.toISOString(), limit)
    .all<TradeTeamMemberCleanupRow>();
  return cleanupTradeTeamMemberFileRows({
    rows: rows.results,
    bucket: options.bucket,
    now,
    store: {
      markDeleted: async (row, timestamp) => {
        await options.db.batch([
          options.db.prepare(`UPDATE trade_team_member_files SET status = 'deleted', deleted_at = ?,
            updated_at = ?, next_cleanup_at = '', last_cleanup_error = ''
            WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status IN ('cleanup_pending', 'uploading')`)
            .bind(timestamp, timestamp, row.id, row.owner_uid, row.team_member_id),
          auditStatement(options.db, row, timestamp),
        ]);
      },
      markFailed: async (row, attempts, nextCleanupAt, timestamp) => {
        await options.db.prepare(`UPDATE trade_team_member_files SET cleanup_attempts = ?, next_cleanup_at = ?,
          status = 'cleanup_pending', last_cleanup_error = 'storage_delete_failed', updated_at = ?
          WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status IN ('cleanup_pending', 'uploading')`)
          .bind(attempts, nextCleanupAt, timestamp, row.id, row.owner_uid, row.team_member_id).run();
      },
    },
  });
}
import {
  cleanupTradeTeamMemberFileRows as cleanupRows,
  tradeTeamMemberCleanupDelay,
} from "./trade-team-member-file-cleanup-core.mjs";
