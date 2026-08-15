import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CreditexOfficialProductError } from "../src/lib/creditex-official-product-registry.ts";
import {
  CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS,
  CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS,
  creditexProductRegistryMaintenanceTargetIndex,
  creditexProductRegistryRefreshDue,
  enqueueCreditexProductRegistryRefresh,
  maintainCreditexAutomaticProductRegistry,
  maintainNextCreditexProductRegistry,
  withCreditexProductRegistryFleetLease,
} from "../src/lib/creditex-product-registry-maintenance.ts";

const NOW = new Date("2027-01-16T00:00:00.000Z");
const definition = {
  registryCode: "veu-approved-products",
  title: "VEU products",
  sources: [{ sourceKey: "veu-products" }],
};

function registryStatus(overrides = {}) {
  return {
    registryCode: definition.registryCode,
    status: "current",
    freshnessWindowHours: 48,
    snapshotId: "snapshot-1",
    sourceSha256: "a".repeat(64),
    recordCount: 75_000,
    lastCheckedAt: new Date(
      NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS,
    ).toISOString(),
    lastAttempt: {
      status: "unchanged",
      checkedAt: new Date(
        NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS,
      ).toISOString(),
      message: "",
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fleetDatabase() {
  const state = {
    lease: null,
    renewals: 0,
    refreshRequests: new Map(),
    refreshRequestWrites: 0,
  };
  const statement = (sql, values = []) => ({
    bind(...bound) {
      return statement(sql, bound);
    },
    async run() {
      if (sql.includes("INSERT INTO\n      compliance_official_product_sync_leases")) {
        const [registryCode, leaseId, startedAt, expiresAt] = values;
        if (!state.lease || state.lease.expiresAt <= startedAt) {
          state.lease = { registryCode, leaseId, startedAt, expiresAt };
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (sql.includes("UPDATE\n      compliance_official_product_sync_leases")) {
        const [expiresAt, registryCode, leaseId] = values;
        if (
          state.lease?.registryCode === registryCode
          && state.lease.leaseId === leaseId
        ) {
          state.lease.expiresAt = expiresAt;
          state.renewals += 1;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (sql.includes("DELETE FROM compliance_official_product_sync_leases")) {
        const [registryCode, leaseId] = values;
        if (
          state.lease?.registryCode === registryCode
          && state.lease.leaseId === leaseId
        ) {
          state.lease = null;
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (sql.includes("INSERT INTO\n      compliance_official_product_refresh_requests")) {
        const [registryCode, requestedAt, notBefore, updatedAt] = values;
        const current = state.refreshRequests.get(registryCode);
        if (current) return { meta: { changes: 0 } };
        state.refreshRequestWrites += 1;
        state.refreshRequests.set(registryCode, {
          registryCode,
          requestedAt,
          notBefore,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          updatedAt,
        });
        return { meta: { changes: 1 } };
      }
      if (sql.includes("DELETE FROM\n      compliance_official_product_refresh_requests")) {
        return {
          meta: {
            changes: state.refreshRequests.delete(values[0]) ? 1 : 0,
          },
        };
      }
      if (sql.includes("UPDATE\n      compliance_official_product_refresh_requests")) {
        if (!sql.includes("attempt_count = attempt_count + 1")) {
          const [notBefore, updatedAt, code] = values;
          const current = state.refreshRequests.get(code);
          if (!current) return { meta: { changes: 0 } };
          state.refreshRequests.set(code, {
            ...current,
            notBefore,
            updatedAt,
          });
          return { meta: { changes: 1 } };
        }
        const [notBefore, lastAttemptAt, lastError, updatedAt, code] = values;
        const current = state.refreshRequests.get(code);
        if (!current) return { meta: { changes: 0 } };
        state.refreshRequests.set(code, {
          ...current,
          notBefore,
          attemptCount: current.attemptCount + 1,
          lastAttemptAt,
          lastError,
          updatedAt,
        });
        return { meta: { changes: 1 } };
      }
      throw new Error(`Unexpected run SQL: ${sql}`);
    },
    async first() {
      if (sql.includes("FROM compliance_official_product_refresh_requests")) {
        const [now, ...registryCodes] = values;
        const due = [...state.refreshRequests.values()]
          .filter((request) => (
            request.notBefore <= now && registryCodes.includes(
              request.registryCode,
            )
          ))
          .sort((left, right) => (
            left.requestedAt.localeCompare(right.requestedAt)
            || left.registryCode.localeCompare(right.registryCode)
          ))[0];
        return due ? { registry_code: due.registryCode } : null;
      }
      throw new Error(`Unexpected first SQL: ${sql}`);
    },
  });
  return {
    state,
    prepare(sql) {
      return statement(sql);
    },
  };
}

const withoutSchemaInstall = async () => undefined;
const realFleetLease = (database, operation) => (
  withCreditexProductRegistryFleetLease(database, operation, {
    ensureSchema: withoutSchemaInstall,
  })
);

test("official product maintenance becomes due at 24 hours but not before", () => {
  const justBefore = registryStatus({
    lastCheckedAt: new Date(
      NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS + 1,
    ).toISOString(),
  });
  assert.equal(creditexProductRegistryRefreshDue(justBefore, NOW), false);
  assert.equal(
    creditexProductRegistryRefreshDue(registryStatus(), NOW),
    true,
  );
});

test("recent failed maintenance observes bounded retry backoff then retries", async () => {
  let syncCalls = 0;
  const failedAt = new Date(NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS + 1);
  const degraded = registryStatus({
    lastCheckedAt: new Date(
      NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS - 1,
    ).toISOString(),
    lastAttempt: {
      status: "failed",
      checkedAt: failedAt.toISOString(),
      message: "upstream unavailable",
    },
  });
  const loadStatus = async () => degraded;
  const syncRegistry = async () => {
    syncCalls += 1;
    return { changed: false };
  };

  const backedOff = await maintainCreditexAutomaticProductRegistry({
    database: {},
    definition,
    loadStatus,
    now: NOW,
    syncRegistry,
  });
  assert.equal(backedOff.outcome, "retry_backoff");
  assert.equal(syncCalls, 0);
  assert.equal(creditexProductRegistryRefreshDue(degraded, NOW), false);

  const afterBackoff = new Date(NOW.getTime() + 1);
  const retried = await maintainCreditexAutomaticProductRegistry({
    database: {},
    definition,
    loadStatus,
    now: afterBackoff,
    syncRegistry,
  });
  assert.equal(retried.outcome, "refreshed");
  assert.equal(syncCalls, 1);
});

test("lease contention is treated as an active refresh", async () => {
  const result = await maintainCreditexAutomaticProductRegistry({
    database: {},
    definition,
    loadStatus: async () => registryStatus(),
    now: NOW,
    syncRegistry: async () => {
      throw new CreditexOfficialProductError(
        "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS",
        409,
        "Official registry is already refreshing.",
      );
    },
  });
  assert.deepEqual(result, {
    registryCode: definition.registryCode,
    outcome: "refreshing",
  });
});

test("scheduled maintenance selects exactly one registry for each minute", async () => {
  const refreshed = [];
  const targets = ["gems-products", "nsw-tessa-products", "veu-approved-products"]
    .map((registryCode) => ({
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        status: "stale",
      }),
      refresh: async () => {
        refreshed.push(registryCode);
        return { changed: true };
      },
    }));
  const index = creditexProductRegistryMaintenanceTargetIndex(NOW, targets.length);
  const result = await maintainNextCreditexProductRegistry({
    database: {},
    now: NOW,
    targets,
    loadQueuedRefresh: async () => null,
    withFleetLease: async (_database, operation) => operation(),
  });
  assert.deepEqual(refreshed, [targets[index].registryCode]);
  assert.deepEqual(result, {
    registryCode: targets[index].registryCode,
    outcome: "refreshed",
    changed: true,
  });
});

test("fleet lease rejects overlapping minute work and recovers stale ownership", async () => {
  const database = fleetDatabase();
  const held = deferred();
  const entered = deferred();
  const target = {
    registryCode: "veu-approved-products",
    loadStatus: async () => registryStatus({ status: "stale" }),
    refresh: async () => {
      entered.resolve();
      await held.promise;
      return { changed: true };
    },
  };
  await enqueueCreditexProductRegistryRefresh(
    database,
    target.registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  const first = maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [target],
    withFleetLease: realFleetLease,
  });
  await entered.promise;
  assert.deepEqual(await maintainNextCreditexProductRegistry({
    database,
    now: new Date(NOW.getTime() + 60_000),
    targets: [target],
    withFleetLease: realFleetLease,
  }), { outcome: "refreshing" });
  held.resolve();
  assert.equal((await first).outcome, "refreshed");
  assert.equal(database.state.refreshRequests.size, 0);
  assert.equal(database.state.lease, null);

  database.state.lease = {
    registryCode: "automatic-registry-fleet",
    leaseId: "abandoned-owner",
    startedAt: "2027-01-15T23:00:00.000Z",
    expiresAt: "2027-01-15T23:03:00.000Z",
  };
  assert.equal(await withCreditexProductRegistryFleetLease(
    database,
    async () => "recovered",
    {
      ensureSchema: withoutSchemaInstall,
      now: () => NOW,
      leaseId: "successor-owner",
    },
  ), "recovered");
  assert.equal(database.state.lease, null);
});

test("durable refresh requests coalesce and failure is deferred with backoff", async () => {
  const database = fleetDatabase();
  await enqueueCreditexProductRegistryRefresh(
    database,
    "gems-products",
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  await Promise.all(Array.from({ length: 100 }, (_, index) => (
    enqueueCreditexProductRegistryRefresh(
      database,
      "gems-products",
      new Date(NOW.getTime() + index + 1),
      { ensureSchema: withoutSchemaInstall },
    )
  )));
  assert.equal(database.state.refreshRequests.size, 1);
  assert.equal(database.state.refreshRequestWrites, 1);
  assert.equal(
    database.state.refreshRequests.get("gems-products").requestedAt,
    NOW.toISOString(),
  );
  assert.equal(
    database.state.refreshRequests.get("gems-products").updatedAt,
    NOW.toISOString(),
  );
  const failure = new Error("official source failed");
  await assert.rejects(
    maintainNextCreditexProductRegistry({
      database,
      now: NOW,
      targets: [{
        registryCode: "gems-products",
        loadStatus: async () => registryStatus({
          registryCode: "gems-products",
          status: "stale",
        }),
        refresh: async () => { throw failure; },
      }],
      withFleetLease: realFleetLease,
    }),
    failure,
  );
  const request = database.state.refreshRequests.get("gems-products");
  assert.equal(request.attemptCount, 1);
  assert.equal(request.lastError, failure.message);
  assert.equal(
    request.notBefore,
    new Date(NOW.getTime() + CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS)
      .toISOString(),
  );
  assert.equal(database.state.lease, null);
});

test("fleet ownership renews during long work and old owners cannot release successors", async () => {
  const renewable = fleetDatabase();
  await withCreditexProductRegistryFleetLease(
    renewable,
    async () => new Promise((resolve) => setTimeout(resolve, 230)),
    {
      ensureSchema: withoutSchemaInstall,
      leaseId: "renewable-owner",
      leaseMs: 300,
      heartbeatMs: 100,
    },
  );
  assert.ok(renewable.state.renewals >= 2);
  assert.equal(renewable.state.lease, null);

  const replaced = fleetDatabase();
  await assert.rejects(
    withCreditexProductRegistryFleetLease(
      replaced,
      async () => {
        replaced.state.lease = {
          registryCode: "automatic-registry-fleet",
          leaseId: "successor-owner",
          startedAt: "2027-01-16T00:01:00.000Z",
          expiresAt: "2027-01-16T00:04:00.000Z",
        };
      },
      {
        ensureSchema: withoutSchemaInstall,
        leaseId: "old-owner",
      },
    ),
    (error) => error.code === "OFFICIAL_PRODUCT_FLEET_BUSY",
  );
  assert.equal(replaced.state.lease.leaseId, "successor-owner");
});

test("HTTP health traffic never bootstraps product registries and cron does one bounded target", () => {
  const worker = fs.readFileSync(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const healthBlock = worker.slice(
    worker.indexOf('if (request.method === "GET" && url.pathname === "/api/health" && response.ok)'),
    worker.indexOf("return queueTradeQuoteDeliveryDispatch"),
  );
  assert.doesNotMatch(healthBlock, /ProductRegistr/);
  const scheduledBlock = worker.slice(worker.indexOf("async scheduled"));
  assert.match(scheduledBlock, /maintainNextCreditexProductRegistry/);
  assert.match(scheduledBlock, /creditexAutomaticProductRegistryMaintenanceTargets/);
  assert.doesNotMatch(scheduledBlock, /for \(const definition of .*ProductRegistr/);
});
