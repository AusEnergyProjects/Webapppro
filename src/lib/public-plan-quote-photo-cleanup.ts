const PENDING_EXPIRY_MS = 60 * 60 * 1000;
const DELETED_RETRY_MS = 60 * 1000;
const PURGED_GRACE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type CleanupPhotoRow = {
  id: string;
  opportunity_id: string;
  object_key: string;
  status: "pending" | "active" | "deleted" | "purged";
  updated_at: string;
};

type CleanupOptions = {
  db: D1Database;
  bucket: {
    delete(objectKey: string): Promise<void>;
  };
  limit?: number;
  nowMs?: number;
};

export function shouldDrainPublicPlanQuotePhotoCleanup({
  method,
  pathname,
  responseOk,
}: {
  method: string;
  pathname: string;
  responseOk: boolean;
}) {
  return method.toUpperCase() === "GET"
    && pathname === "/api/health"
    && responseOk;
}

export async function drainPublicPlanQuotePhotoCleanup({
  db,
  bucket,
  limit = DEFAULT_LIMIT,
  nowMs = Date.now(),
}: CleanupOptions) {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
    : DEFAULT_LIMIT;
  const now = new Date(nowMs).toISOString();
  const pendingCutoff = new Date(nowMs - PENDING_EXPIRY_MS).toISOString();
  const deletedCutoff = new Date(nowMs - DELETED_RETRY_MS).toISOString();
  const purgedCutoff = new Date(nowMs - PURGED_GRACE_MS).toISOString();
  const candidates = await db.prepare(`SELECT photo.*
    FROM public_trade_lead_quote_photos photo
    LEFT JOIN public_trade_lead_quote_preparations preparation
      ON preparation.opportunity_id = photo.opportunity_id
    WHERE (
      photo.status IN ('pending', 'active')
      AND preparation.status = 'withdrawn'
    ) OR (
      photo.status = 'pending' AND photo.updated_at < ?
    ) OR (
      photo.status = 'deleted' AND photo.updated_at < ?
    ) OR (
      photo.status = 'purged' AND photo.updated_at < ?
    )
    ORDER BY photo.updated_at
    LIMIT ?`)
    .bind(pendingCutoff, deletedCutoff, purgedCutoff, boundedLimit)
    .all<CleanupPhotoRow>();

  let tombstoned = 0;
  let objectDeletes = 0;
  let rowsRemoved = 0;
  for (const candidate of candidates.results) {
    let photo = candidate;
    if (photo.status === "pending" || photo.status === "active") {
      const claimed = await db.prepare(`UPDATE public_trade_lead_quote_photos
        SET status = 'deleted', client_upload_id = ?, updated_at = ?
        WHERE id = ? AND object_key = ? AND status = ? AND updated_at = ?`)
        .bind(
          `cleanup.${crypto.randomUUID()}`,
          now,
          photo.id,
          photo.object_key,
          photo.status,
          photo.updated_at,
        )
        .run();
      if (Number(claimed.meta.changes || 0) !== 1) continue;
      tombstoned += 1;
      photo = { ...photo, status: "deleted", updated_at: now };
    }

    if (photo.status === "deleted") {
      try {
        await bucket.delete(photo.object_key);
      } catch {
        await db.prepare(`UPDATE public_trade_lead_quote_photos
          SET updated_at = ?
          WHERE id = ? AND object_key = ? AND status = 'deleted'`)
          .bind(now, photo.id, photo.object_key)
          .run();
        continue;
      }
      objectDeletes += 1;
      await db.prepare(`UPDATE public_trade_lead_quote_photos
        SET status = 'purged', updated_at = ?
        WHERE id = ? AND object_key = ? AND status = 'deleted'`)
        .bind(now, photo.id, photo.object_key)
        .run();
      continue;
    }

    if (photo.status === "purged") {
      try {
        await bucket.delete(photo.object_key);
      } catch {
        await db.prepare(`UPDATE public_trade_lead_quote_photos
          SET updated_at = ?
          WHERE id = ? AND object_key = ? AND status = 'purged'`)
          .bind(now, photo.id, photo.object_key)
          .run();
        continue;
      }
      objectDeletes += 1;
      const removed = await db.prepare(`DELETE FROM public_trade_lead_quote_photos
        WHERE id = ? AND object_key = ? AND status = 'purged' AND updated_at = ?`)
        .bind(photo.id, photo.object_key, photo.updated_at)
        .run();
      rowsRemoved += Number(removed.meta.changes || 0);
    }
  }

  return {
    scanned: candidates.results.length,
    tombstoned,
    objectDeletes,
    rowsRemoved,
  };
}
