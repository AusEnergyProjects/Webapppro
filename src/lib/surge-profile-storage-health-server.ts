import type { SurgeProfileStorageHealthStatus } from "./surge-profile-storage-health";

const ALLOWED_STATUSES = new Set<SurgeProfileStorageHealthStatus>([
  "save_failed",
  "load_failed",
  "merge_recovered",
]);

export function parseSurgeProfileStorageHealthStatus(value: unknown): SurgeProfileStorageHealthStatus | null {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as SurgeProfileStorageHealthStatus)
    ? value as SurgeProfileStorageHealthStatus
    : null;
}

export async function recordSurgeProfileStorageHealthAggregate(
  status: SurgeProfileStorageHealthStatus,
  database: D1Database,
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10);
  const updatedAt = now.getTime();
  await database.prepare(`INSERT INTO surge_profile_storage_health_daily
    (day, status, event_count, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(day, status) DO UPDATE SET
      event_count = event_count + 1,
      updated_at = excluded.updated_at`)
    .bind(day, status, updatedAt)
    .run();
}
