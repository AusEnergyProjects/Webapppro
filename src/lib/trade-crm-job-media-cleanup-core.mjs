export function tradeCrmJobMediaCleanupDelay(attempts) {
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.min(attempts, 6) * 60 * 1000));
}

export async function cleanupTradeCrmJobMediaRows(options) {
  const now = options.now || new Date();
  let completed = 0;
  let retained = 0;
  let failed = 0;
  for (const row of options.rows) {
    if (await options.store.isCanonical(row)) {
      await options.store.clear(row);
      retained += 1;
      continue;
    }
    if (!await options.store.ownsClaim(row)) continue;
    try {
      if (row.upload_id) {
        if (!options.bucket.resumeMultipartUpload) throw new Error("multipart_cleanup_unavailable");
        try {
          await options.bucket.resumeMultipartUpload(row.object_key, row.upload_id).abort();
        } catch (error) {
          const status = error && typeof error === 'object' ? error.status : undefined;
          const message = error instanceof Error ? error.message : String(error);
          if (status !== 404 && !/not found|no such upload|does not exist/i.test(message)) throw error;
        }
      }
      await options.bucket.delete(row.object_key);
      if (await options.store.isCanonical(row)) {
        throw new Error("canonical_reference_appeared_during_cleanup");
      }
      await options.store.clear(row);
      completed += 1;
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await options.store.markFailed(
        row,
        attempts,
        new Date(now.getTime() + tradeCrmJobMediaCleanupDelay(attempts)).toISOString(),
        error instanceof Error ? error.message : "storage_delete_failed",
        now.toISOString(),
      );
      failed += 1;
    }
  }
  return { attempted: options.rows.length, completed, retained, failed };
}
