import {
  CreditexOfficialProductError,
  type CreditexOfficialProductRegistryStatus,
} from "./creditex-official-product-registry.ts";
import {
  creditexAutomaticProductRegistries,
} from "./creditex-official-product-registry-definitions.ts";
import {
  loadOfficialProductRegistryStatus,
  syncOfficialProductRegistry,
  type CreditexOfficialProductArtifactStore,
  type CreditexOfficialProductRegistryDefinition,
} from "./creditex-official-product-registry-server.ts";
import { CreditexSresRegistryError } from "./creditex-sres-registry.ts";
import {
  loadCerSresRegistryStatus,
  syncCerSresProductRegistry,
  type CreditexSresArtifactStore,
} from "./creditex-sres-registry-server.ts";
import { ensureCreditexProductRegistrySchemaGuards } from
  "./creditex-product-registry-schema-guards.ts";

export const CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS =
  24 * 60 * 60 * 1000;
export const CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS =
  15 * 60 * 1000;
export const CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE =
  "automatic-registry-fleet";
export const CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_MS = 3 * 60 * 1000;
export const CREDITEX_PRODUCT_REGISTRY_FLEET_HEARTBEAT_MS = 30 * 1000;

type FleetLeaseOptions = Readonly<{
  leaseMs?: number;
  heartbeatMs?: number;
  now?: () => Date;
  leaseId?: string;
  ensureSchema?: typeof ensureCreditexProductRegistrySchemaGuards;
}>;

function positiveBoundedMilliseconds(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  const milliseconds = value ?? fallback;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 100) {
    throw new Error("Creditex product registry fleet timing is invalid.");
  }
  return Math.min(milliseconds, maximum);
}

async function acquireFleetLease(
  database: D1Database,
  leaseId: string,
  startedAt: string,
  leaseMs: number,
) {
  const expiresAt = new Date(Date.parse(startedAt) + leaseMs).toISOString();
  const result = await database.prepare(`INSERT INTO
      compliance_official_product_sync_leases (
        registry_code, lease_id, started_at, expires_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(registry_code) DO UPDATE SET
        lease_id = excluded.lease_id,
        started_at = excluded.started_at,
        expires_at = excluded.expires_at
      WHERE compliance_official_product_sync_leases.expires_at
        <= excluded.started_at`)
    .bind(
      CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
      leaseId,
      startedAt,
      expiresAt,
    )
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_FLEET_BUSY",
      503,
      "An official product registry refresh is already running. Retry shortly.",
    );
  }
}

async function renewFleetLease(
  database: D1Database,
  leaseId: string,
  now: Date,
  leaseMs: number,
) {
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const result = await database.prepare(`UPDATE
      compliance_official_product_sync_leases
    SET expires_at = ?
    WHERE registry_code = ? AND lease_id = ?`)
    .bind(
      expiresAt,
      CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
      leaseId,
    )
    .run();
  if (Number(result.meta?.changes || 0) !== 1) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_FLEET_BUSY",
      503,
      "Official product registry fleet ownership was lost. Retry shortly.",
    );
  }
}

async function releaseFleetLease(
  database: D1Database,
  leaseId: string,
) {
  await database.prepare(`DELETE FROM compliance_official_product_sync_leases
    WHERE registry_code = ? AND lease_id = ?`)
    .bind(CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE, leaseId)
    .run();
}

/**
 * Serialises every automatic/manual registry producer across HTTP and cron.
 * The owner token prevents an old invocation from releasing a successor's
 * lease, while the bounded heartbeat keeps a valid long ingestion owned.
 */
export async function withCreditexProductRegistryFleetLease<TResult>(
  database: D1Database,
  operation: () => Promise<TResult>,
  options: FleetLeaseOptions = {},
) {
  await (options.ensureSchema || ensureCreditexProductRegistrySchemaGuards)(
    database,
  );
  const clock = options.now || (() => new Date());
  const leaseMs = positiveBoundedMilliseconds(
    options.leaseMs,
    CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_MS,
    30 * 60 * 1000,
  );
  const heartbeatMs = positiveBoundedMilliseconds(
    options.heartbeatMs,
    CREDITEX_PRODUCT_REGISTRY_FLEET_HEARTBEAT_MS,
    Math.max(leaseMs - 100, 100),
  );
  if (heartbeatMs >= leaseMs) {
    throw new Error("Creditex product registry heartbeat must precede expiry.");
  }
  const leaseId = options.leaseId || crypto.randomUUID();
  const startedAt = clock().toISOString();
  await acquireFleetLease(database, leaseId, startedAt, leaseMs);

  let heartbeatFailure: unknown;
  let heartbeat = Promise.resolve();
  const interval = setInterval(() => {
    heartbeat = heartbeat
      .then(() => renewFleetLease(database, leaseId, clock(), leaseMs))
      .catch((error) => {
        heartbeatFailure = error;
      });
  }, heartbeatMs);

  try {
    const result = await operation();
    await heartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    await renewFleetLease(database, leaseId, clock(), leaseMs);
    return result;
  } finally {
    clearInterval(interval);
    await heartbeat.catch(() => undefined);
    await releaseFleetLease(database, leaseId).catch(() => undefined);
  }
}

type RegistryStatusLoader = typeof loadOfficialProductRegistryStatus;
type RegistrySynchronizer = typeof syncOfficialProductRegistry;

type RegistryMaintenanceStatus = Pick<
  CreditexOfficialProductRegistryStatus,
  "registryCode" | "status" | "lastCheckedAt" | "lastAttempt"
>;

export type CreditexProductRegistryMaintenanceTarget = Readonly<{
  registryCode: string;
  loadStatus(
    database: D1Database,
    now: Date,
  ): Promise<RegistryMaintenanceStatus>;
  refresh(database: D1Database, now: Date): Promise<{ changed: boolean }>;
}>;

export function creditexProductRegistryRefreshDue(
  status: RegistryMaintenanceStatus,
  now = new Date(),
) {
  if (creditexProductRegistryRetryBackoffActive(status, now)) return false;
  if (status.status !== "current") return true;
  if (!status.lastCheckedAt) return true;
  const checkedAt = Date.parse(status.lastCheckedAt);
  const currentTime = now.getTime();
  if (!Number.isFinite(checkedAt) || !Number.isFinite(currentTime)) return true;
  if (checkedAt > currentTime) return true;
  return currentTime - checkedAt >= CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS;
}

export function creditexProductRegistryRetryBackoffActive(
  status: RegistryMaintenanceStatus,
  now = new Date(),
) {
  if (status.lastAttempt?.status !== "failed") return false;
  const attemptedAt = Date.parse(status.lastAttempt.checkedAt);
  const currentTime = now.getTime();
  if (!Number.isFinite(attemptedAt) || !Number.isFinite(currentTime)) {
    return false;
  }
  const elapsed = currentTime - attemptedAt;
  return elapsed >= 0 && elapsed < CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS;
}

export function creditexAutomaticProductRegistryMaintenanceTargets({
  artifactStore,
  environment = {},
}: {
  artifactStore?: CreditexOfficialProductArtifactStore
    & CreditexSresArtifactStore;
  environment?: Readonly<Record<string, unknown>>;
} = {}): readonly CreditexProductRegistryMaintenanceTarget[] {
  const standard = creditexAutomaticProductRegistries(environment).map(
    (definition) => ({
      registryCode: definition.registryCode,
      loadStatus: (database: D1Database, now: Date) => (
        loadOfficialProductRegistryStatus(database, definition.registryCode, {
          now,
        })
      ),
      refresh: (database: D1Database, now: Date) => (
        syncOfficialProductRegistry(database, definition, {
          artifactStore,
          now,
        })
      ),
    }),
  );
  return [
    ...standard,
    {
      registryCode: "cer_sres_swh",
      loadStatus: (database: D1Database, now: Date) => (
        loadCerSresRegistryStatus(database, { now })
      ),
      refresh: (database: D1Database, now: Date) => (
        syncCerSresProductRegistry(database, { artifactStore, now })
      ),
    },
  ];
}

export function creditexProductRegistryMaintenanceTargetIndex(
  now: Date,
  targetCount: number,
) {
  if (!Number.isSafeInteger(targetCount) || targetCount < 1) return -1;
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 60_000) % targetCount;
}

type RefreshRequestRow = Readonly<{
  registry_code: string;
}>;

export async function enqueueCreditexProductRegistryRefresh(
  database: D1Database,
  registryCode: string,
  now = new Date(),
  options: Readonly<{
    ensureSchema?: typeof ensureCreditexProductRegistrySchemaGuards;
  }> = {},
) {
  await (options.ensureSchema || ensureCreditexProductRegistrySchemaGuards)(
    database,
  );
  if (!/^[a-z0-9_-]{1,80}$/.test(registryCode)) {
    throw new CreditexOfficialProductError(
      "OFFICIAL_PRODUCT_REQUEST_INVALID",
      400,
      "The official product registry refresh request is invalid.",
    );
  }
  const requestedAt = now.toISOString();
  await database.prepare(`INSERT INTO
      compliance_official_product_refresh_requests (
        registry_code, requested_at, not_before, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(registry_code) DO NOTHING`)
    .bind(registryCode, requestedAt, requestedAt, requestedAt)
    .run();
}

async function loadQueuedRefreshRequest(
  database: D1Database,
  registryCodes: readonly string[],
  now: Date,
) {
  if (registryCodes.length < 1) return null;
  const placeholders = registryCodes.map(() => "?").join(", ");
  return database.prepare(`SELECT registry_code
      FROM compliance_official_product_refresh_requests
      WHERE not_before <= ? AND registry_code IN (${placeholders})
      ORDER BY requested_at, registry_code LIMIT 1`)
    .bind(now.toISOString(), ...registryCodes)
    .first<RefreshRequestRow>();
}

async function completeQueuedRefreshRequest(
  database: D1Database,
  registryCode: string,
) {
  await database.prepare(`DELETE FROM
      compliance_official_product_refresh_requests WHERE registry_code = ?`)
    .bind(registryCode)
    .run();
}

async function deferQueuedRefreshRequest(
  database: D1Database,
  registryCode: string,
  now: Date,
  error?: unknown,
) {
  const notBefore = new Date(
    now.getTime() + CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS,
  ).toISOString();
  const message = error instanceof Error
    ? error.message.slice(0, 500)
    : error === undefined
      ? null
      : "Official registry refresh failed.";
  if (error === undefined) {
    await database.prepare(`UPDATE
        compliance_official_product_refresh_requests
      SET not_before = ?, updated_at = ?
      WHERE registry_code = ?`)
      .bind(notBefore, now.toISOString(), registryCode)
      .run();
    return;
  }
  await database.prepare(`UPDATE
      compliance_official_product_refresh_requests
    SET not_before = ?,
      attempt_count = attempt_count + 1,
      last_attempt_at = ?,
      last_error = ?,
      updated_at = ?
    WHERE registry_code = ?`)
    .bind(
      notBefore,
      now.toISOString(),
      message,
      now.toISOString(),
      registryCode,
    )
    .run();
}

/**
 * Scheduled invocations service exactly one registry. This keeps large source
 * acquisitions off request waitUntil, prevents concurrent fleet bootstrap and
 * gives every configured automatic producer a deterministic turn every few
 * minutes.
 */
export async function maintainNextCreditexProductRegistry({
  database,
  loadQueuedRefresh = loadQueuedRefreshRequest,
  now = new Date(),
  targets,
  withFleetLease = withCreditexProductRegistryFleetLease,
}: {
  database: D1Database;
  loadQueuedRefresh?: typeof loadQueuedRefreshRequest;
  now?: Date;
  targets: readonly CreditexProductRegistryMaintenanceTarget[];
  withFleetLease?: typeof withCreditexProductRegistryFleetLease;
}) {
  try {
    return await withFleetLease(database, async () => {
      const queued = await loadQueuedRefresh(
        database,
        targets.map((target) => target.registryCode),
        now,
      );
      const index = creditexProductRegistryMaintenanceTargetIndex(
        now,
        targets.length,
      );
      if (!queued && index < 0) return { outcome: "no_targets" as const };
      const target = queued
        ? targets.find((candidate) => (
            candidate.registryCode === queued.registry_code
          ))!
        : targets[index];
      const status = await target.loadStatus(database, now);
      if (creditexProductRegistryRetryBackoffActive(status, now)) {
        if (queued) {
          await deferQueuedRefreshRequest(
            database,
            target.registryCode,
            now,
          );
        }
        return {
          registryCode: target.registryCode,
          outcome: "retry_backoff" as const,
        };
      }
      if (!creditexProductRegistryRefreshDue(status, now)) {
        if (queued) {
          await completeQueuedRefreshRequest(database, target.registryCode);
        }
        return {
          registryCode: target.registryCode,
          outcome: "current" as const,
        };
      }
      let result: { changed: boolean };
      try {
        result = await target.refresh(database, now);
      } catch (error) {
        if (queued) {
          await deferQueuedRefreshRequest(
            database,
            target.registryCode,
            now,
            error,
          );
        }
        throw error;
      }
      if (queued) {
        await completeQueuedRefreshRequest(database, target.registryCode);
      }
      return {
        registryCode: target.registryCode,
        outcome: "refreshed" as const,
        changed: result.changed,
      };
    });
  } catch (error) {
    const refreshing = (
      error instanceof CreditexOfficialProductError
      && error.code === "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS"
    ) || (
      error instanceof CreditexSresRegistryError
      && error.code === "SRES_REFRESH_IN_PROGRESS"
    );
    if (
      refreshing
      || (
        error instanceof CreditexOfficialProductError
        && error.code === "OFFICIAL_PRODUCT_FLEET_BUSY"
      )
    ) {
      return { outcome: "refreshing" as const };
    }
    throw error;
  }
}

export async function maintainCreditexAutomaticProductRegistry({
  artifactStore,
  database,
  definition,
  loadStatus = loadOfficialProductRegistryStatus,
  now = new Date(),
  syncRegistry = syncOfficialProductRegistry,
}: {
  artifactStore?: CreditexOfficialProductArtifactStore;
  database: D1Database;
  definition: CreditexOfficialProductRegistryDefinition;
  loadStatus?: RegistryStatusLoader;
  now?: Date;
  syncRegistry?: RegistrySynchronizer;
}) {
  const status = await loadStatus(database, definition.registryCode, { now });
  if (creditexProductRegistryRetryBackoffActive(status, now)) {
    return {
      registryCode: definition.registryCode,
      outcome: "retry_backoff" as const,
    };
  }
  if (!creditexProductRegistryRefreshDue(status, now)) {
    return {
      registryCode: definition.registryCode,
      outcome: "current" as const,
    };
  }

  try {
    const result = await syncRegistry(database, definition, {
      artifactStore,
      now,
    });
    return {
      registryCode: definition.registryCode,
      outcome: "refreshed" as const,
      changed: result.changed,
    };
  } catch (error) {
    if (
      error instanceof CreditexOfficialProductError
      && error.code === "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS"
    ) {
      return {
        registryCode: definition.registryCode,
        outcome: "refreshing" as const,
      };
    }
    throw error;
  }
}
