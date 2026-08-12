export function tradeTeamMemberCleanupDelay(attempts) {
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.min(attempts, 6) * 60 * 1000));
}

export async function cleanupTradeTeamMemberFileRows(options) {
  const now = options.now || new Date();
  let completed = 0;
  let failed = 0;
  for (const row of options.rows) {
    try {
      await options.bucket.delete(row.object_key);
      await options.store.markDeleted(row, now.toISOString());
      completed += 1;
    } catch {
      const attempts = Number(row.cleanup_attempts || 0) + 1;
      await options.store.markFailed(
        row,
        attempts,
        new Date(now.getTime() + tradeTeamMemberCleanupDelay(attempts)).toISOString(),
        now.toISOString(),
      );
      failed += 1;
    }
  }
  return { attempted: options.rows.length, completed, failed };
}
