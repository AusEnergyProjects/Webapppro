import {
  CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE,
  CreditexOfficialProductError,
  type CreditexOfficialProductRegistryStatus,
} from "./creditex-official-product-registry.ts";
import {
  creditexAutomaticProductRegistries,
} from "./creditex-official-product-registry-definitions.ts";
import {
  CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET,
  hasPendingCreditexOfficialProductRefresh,
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
export const CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_MS = 3 * 60 * 1000;
export const CREDITEX_PRODUCT_REGISTRY_FLEET_HEARTBEAT_MS = 30 * 1000;
export const CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MS = 22_000;
export const CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS = 64;
export const CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS = 18_000;
export const CREDITEX_PRODUCT_REGISTRY_CONTINUATION_HEADROOM_MS = 4_000;
export const CREDITEX_PRODUCT_REGISTRY_QUEUED_RETRY_MAX_MS = 30_000;
export const CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER =
  "X-AEA-Creditex-Product-Registry-Dispatch";

type FleetLeaseOptions = Readonly<{
  leaseMs?: number;
  heartbeatMs?: number;
  now?: () => Date;
  leaseId?: string;
  ensureSchema?: typeof ensureCreditexProductRegistrySchemaGuards;
}>;

export type CreditexProductRegistryFleetLeaseContext = Readonly<{
  leaseId: string;
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
  operation: (
    context: CreditexProductRegistryFleetLeaseContext,
  ) => Promise<TResult>,
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
    const result = await operation({ leaseId });
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
  hasPendingWork?(database: D1Database): Promise<boolean>;
  refresh(
    database: D1Database,
    now: Date,
    fleetLeaseId: string,
    signal?: AbortSignal,
  ): Promise<{
    changed: boolean;
    complete?: boolean;
    stagedRecordCount?: number;
    recordCount?: number;
  }>;
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

export function creditexAutomaticProductRegistryStreamingBudget(
  definition: CreditexOfficialProductRegistryDefinition,
) {
  return definition.sources.length === 1
    && definition.sources[0]?.streamingParser
    ? CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET
    : undefined;
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
      hasPendingWork: (database: D1Database) => (
        hasPendingCreditexOfficialProductRefresh(
          database,
          definition.registryCode,
        )
      ),
      refresh: (
        database: D1Database,
        now: Date,
        fleetLeaseId: string,
        signal?: AbortSignal,
      ) => (
        syncOfficialProductRegistry(database, definition, {
          artifactStore,
          now,
          fleetLeaseId,
          maximumStreamingRecordsPerRun:
            creditexAutomaticProductRegistryStreamingBudget(definition),
          sourceFetchTimeoutMs:
            CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
          signal,
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
      refresh: (
        database: D1Database,
        now: Date,
        fleetLeaseId: string,
        signal?: AbortSignal,
      ) => (
        syncCerSresProductRegistry(database, {
          artifactStore,
          now,
          fleetLeaseId,
          sourceFetchTimeoutMs:
            CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
          signal,
        })
      ),
    },
  ];
}

type RefreshRequestRow = Readonly<{
  registry_code: string;
  attempt_count: number;
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
  return database.prepare(`SELECT registry_code, attempt_count
      FROM compliance_official_product_refresh_requests
      WHERE not_before <= ? AND registry_code IN (${placeholders})
      ORDER BY requested_at, registry_code LIMIT 1`)
    .bind(now.toISOString(), ...registryCodes)
    .first<RefreshRequestRow>();
}

export async function hasDueCreditexProductRegistryRefreshRequest(
  database: D1Database,
  registryCodes: readonly string[],
  now = new Date(),
  options: Readonly<{
    ensureSchema?: typeof ensureCreditexProductRegistrySchemaGuards;
  }> = {},
) {
  await (options.ensureSchema || ensureCreditexProductRegistrySchemaGuards)(
    database,
  );
  return Boolean(await loadQueuedRefreshRequest(database, registryCodes, now));
}

export async function hasQueuedCreditexProductRegistryRefreshRequest(
  database: D1Database,
  registryCodes: readonly string[],
  options: Readonly<{
    ensureSchema?: typeof ensureCreditexProductRegistrySchemaGuards;
  }> = {},
) {
  await (options.ensureSchema || ensureCreditexProductRegistrySchemaGuards)(
    database,
  );
  if (registryCodes.length < 1) return false;
  const placeholders = registryCodes.map(() => "?").join(", ");
  return Boolean(await database.prepare(`SELECT registry_code
      FROM compliance_official_product_refresh_requests
      WHERE registry_code IN (${placeholders})
      ORDER BY requested_at, registry_code LIMIT 1`)
    .bind(...registryCodes)
    .first<{ registry_code: string }>());
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
  attemptCount = 0,
) {
  const rapidRetryDelays = [3_000, 6_000, 12_000] as const;
  const retryDelay = error === undefined
    ? CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS
    : rapidRetryDelays[attemptCount]
      ?? CREDITEX_PRODUCT_REGISTRY_QUEUED_RETRY_MAX_MS;
  const notBefore = new Date(
    now.getTime() + retryDelay,
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
    return retryDelay;
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
  return retryDelay;
}

/**
 * Each invocation services exactly one registry. A calculator-triggered call
 * prioritises that exact registry; health and cron calls choose the oldest due
 * producer. The fleet lease prevents concurrent source acquisition and replay.
 */
export async function maintainNextCreditexProductRegistry({
  database,
  enqueueRefresh = enqueueCreditexProductRegistryRefresh,
  loadQueuedRefresh = loadQueuedRefreshRequest,
  now = new Date(),
  preferredRegistryCode,
  returnScheduledFailures = false,
  scheduledOperationTimeoutMs =
    CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
  targets,
  withFleetLease = withCreditexProductRegistryFleetLease,
}: {
  database: D1Database;
  enqueueRefresh?: typeof enqueueCreditexProductRegistryRefresh;
  loadQueuedRefresh?: typeof loadQueuedRefreshRequest;
  now?: Date;
  preferredRegistryCode?: string;
  returnScheduledFailures?: boolean;
  scheduledOperationTimeoutMs?: number;
  targets: readonly CreditexProductRegistryMaintenanceTarget[];
  withFleetLease?: typeof withCreditexProductRegistryFleetLease;
}) {
  try {
    return await withFleetLease(database, async (fleetLease) => {
      const preferredTarget = preferredRegistryCode
        ? targets.find((target) => target.registryCode === preferredRegistryCode)
        : undefined;
      const queued = await loadQueuedRefresh(
        database,
        preferredTarget
          ? [preferredTarget.registryCode]
          : targets.map((target) => target.registryCode),
        now,
      );
      if (!queued && targets.length === 0) {
        return { outcome: "no_targets" as const };
      }
      let target: CreditexProductRegistryMaintenanceTarget;
      let status: RegistryMaintenanceStatus;
      if (queued || preferredTarget) {
        target = targets.find((candidate) => (
          candidate.registryCode === (
            queued?.registry_code || preferredTarget?.registryCode
          )
        ))!;
        status = await target.loadStatus(database, now);
      } else {
        const candidates = await Promise.all(targets.map(async (candidate) => ({
          target: candidate,
          status: await candidate.loadStatus(database, now),
        })));
        const due = candidates.filter((candidate) => (
          creditexProductRegistryRefreshDue(candidate.status, now)
        )).sort((left, right) => {
          const leftCheckedAt = left.status.lastCheckedAt
            ? Date.parse(left.status.lastCheckedAt)
            : Number.NEGATIVE_INFINITY;
          const rightCheckedAt = right.status.lastCheckedAt
            ? Date.parse(right.status.lastCheckedAt)
            : Number.NEGATIVE_INFINITY;
          return leftCheckedAt - rightCheckedAt
            || left.target.registryCode.localeCompare(right.target.registryCode);
        });
        if (due.length === 0) return { outcome: "all_current" as const };
        ({ target, status } = due[0]);
      }
      const pendingWork = target.hasPendingWork
        ? await target.hasPendingWork(database)
        : false;
      if (
        creditexProductRegistryRetryBackoffActive(status, now)
        && !pendingWork
        && !queued
      ) {
        return {
          registryCode: target.registryCode,
          outcome: "retry_backoff" as const,
        };
      }
      if (
        !creditexProductRegistryRefreshDue(status, now)
        && !pendingWork
        && !queued
      ) {
        if (queued) {
          await completeQueuedRefreshRequest(database, target.registryCode);
        }
        return {
          registryCode: target.registryCode,
          outcome: "current" as const,
        };
      }
      let result: {
        changed: boolean;
        complete?: boolean;
        stagedRecordCount?: number;
        recordCount?: number;
      };
      try {
        const controller = new AbortController();
        const operationTimeout = returnScheduledFailures
          ? setTimeout(
              () => controller.abort("official-product-background-timeout"),
              positiveBoundedMilliseconds(
                scheduledOperationTimeoutMs,
                CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
                CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
              ),
            )
          : undefined;
        try {
          result = await target.refresh(
            database,
            now,
            fleetLease.leaseId,
            returnScheduledFailures ? controller.signal : undefined,
          );
        } finally {
          if (operationTimeout !== undefined) clearTimeout(operationTimeout);
        }
      } catch (error) {
        const retainedPendingWork = target.hasPendingWork
          ? await target.hasPendingWork(database).catch(() => false)
          : false;
        let retryAfterMs = 0;
        if (returnScheduledFailures && !queued) {
          await enqueueRefresh(
            database,
            target.registryCode,
            now,
          );
        }
        if ((queued || returnScheduledFailures) && !retainedPendingWork) {
          retryAfterMs = await deferQueuedRefreshRequest(
            database,
            target.registryCode,
            now,
            error,
            returnScheduledFailures ? 0 : queued?.attempt_count || 0,
          );
        }
        if (returnScheduledFailures) {
          return {
            registryCode: target.registryCode,
            outcome: "retry_scheduled" as const,
            retryAfterMs,
          };
        }
        throw error;
      }
      if (result.complete === false) {
        if (!queued) {
          await enqueueRefresh(
            database,
            target.registryCode,
            now,
          );
        }
        return {
          registryCode: target.registryCode,
          outcome: "progressed" as const,
          stagedRecordCount: result.stagedRecordCount || 0,
          recordCount: result.recordCount || 0,
        };
      }
      if (queued || pendingWork) {
        // Activation and historical cleanup can finish in separate invocations.
        // Keep the durable request until a real source check has superseded any
        // transient failure recorded between those phases.
        const completedStatus = await target.loadStatus(database, now);
        if (completedStatus.lastAttempt?.status === "failed") {
          if (!queued) {
            await enqueueRefresh(
              database,
              target.registryCode,
              now,
            );
          }
          return {
            registryCode: target.registryCode,
            outcome: "progressed" as const,
            stagedRecordCount: result.stagedRecordCount || 0,
            recordCount: result.recordCount || 0,
          };
        }
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

export async function drainCreditexProductRegistryMaintenance({
  database,
  maximumElapsedMs = CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MS,
  maximumSteps = CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS,
  now = () => new Date(),
  operationTimeoutMs = CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
  preferredRegistryCode,
  targets,
  maintain = maintainNextCreditexProductRegistry,
}: {
  database: D1Database;
  maximumElapsedMs?: number;
  maximumSteps?: number;
  now?: () => Date;
  operationTimeoutMs?: number;
  preferredRegistryCode?: string;
  targets: readonly CreditexProductRegistryMaintenanceTarget[];
  maintain?: typeof maintainNextCreditexProductRegistry;
}) {
  const startedAt = now().getTime();
  const elapsedLimit = Math.min(Math.max(maximumElapsedMs, 1_000), 25_000);
  const stepLimit = Math.min(Math.max(maximumSteps, 1), 64);
  let lastResult: Awaited<ReturnType<typeof maintainNextCreditexProductRegistry>>
    | null = null;
  let steps = 0;
  let continuationRequired = false;
  const exactPreferred = Boolean(
    preferredRegistryCode
    && targets.some((target) => target.registryCode === preferredRegistryCode),
  );
  let nextPreferredRegistryCode = preferredRegistryCode;
  while (steps < stepLimit) {
    const elapsedMs = now().getTime() - startedAt;
    const remainingMs = elapsedLimit - elapsedMs;
    const operationBudgetMs = positiveBoundedMilliseconds(
      operationTimeoutMs,
      CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
      CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
    );
    if (
      remainingMs < 100
      || (
        steps > 0
        && remainingMs < operationBudgetMs
          + CREDITEX_PRODUCT_REGISTRY_CONTINUATION_HEADROOM_MS
      )
    ) {
      continuationRequired = true;
      break;
    }
    lastResult = await maintain({
      database,
      now: now(),
      preferredRegistryCode: nextPreferredRegistryCode,
      returnScheduledFailures: true,
      scheduledOperationTimeoutMs: Math.min(operationBudgetMs, remainingMs),
      targets,
    });
    steps += 1;
    if (lastResult.outcome === "retry_scheduled") {
      continuationRequired = true;
      break;
    }
    const progressed = lastResult.outcome === "progressed";
    const completedOne = lastResult.outcome === "refreshed"
      || lastResult.outcome === "current";
    if (!progressed && (!completedOne || exactPreferred)) break;
    nextPreferredRegistryCode = lastResult.outcome === "progressed"
      ? lastResult.registryCode
      : undefined;
    if (
      steps >= stepLimit
      || now().getTime() - startedAt >= elapsedLimit
    ) {
      continuationRequired = true;
      break;
    }
  }
  return {
    ...(lastResult || { outcome: "no_targets" as const }),
    continuationRequired,
    continuationDelayMs: lastResult?.outcome === "retry_scheduled"
      ? lastResult.retryAfterMs
      : 0,
    steps,
  };
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
