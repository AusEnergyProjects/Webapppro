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
