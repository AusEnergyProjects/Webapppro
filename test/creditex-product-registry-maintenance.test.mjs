import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CreditexOfficialProductError } from "../src/lib/creditex-official-product-registry.ts";
import {
  creditexAutomaticProductRegistries,
} from "../src/lib/creditex-official-product-registry-definitions.ts";
import {
  CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS,
  CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS,
  CREDITEX_PRODUCT_REGISTRY_CONTINUATION_HEADROOM_MS,
  CREDITEX_PRODUCT_REGISTRY_PROACTIVE_REFRESH_MS,
  CREDITEX_PRODUCT_REGISTRY_QUEUED_RETRY_MAX_MS,
  CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS,
  creditexAutomaticProductRegistryStreamingBudget,
  creditexProductRegistryRefreshDue,
  drainCreditexProductRegistryMaintenance,
  enqueueCreditexProductRegistryRefresh,
  hasDueCreditexProductRegistryRefreshRequest,
  hasQueuedCreditexProductRegistryRefreshRequest,
  maintainCreditexAutomaticProductRegistry,
  maintainNextCreditexProductRegistry,
  seedDueCreditexProductRegistryRefreshRequests,
  withCreditexProductRegistryFleetLease,
} from "../src/lib/creditex-product-registry-maintenance.ts";
import {
  CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET,
} from "../src/lib/creditex-official-product-registry-server.ts";
import {
  CREDITEX_VEU_DURABLE_ACQUISITION_MAX_CURRENT_SCALE_QUANTA,
} from "../src/lib/creditex-veu-product-sources.ts";

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

test("only the VEU streaming registry receives a bounded replay budget", () => {
  const budgets = Object.fromEntries(
    creditexAutomaticProductRegistries({}).map((registry) => [
      registry.registryCode,
      creditexAutomaticProductRegistryStreamingBudget(registry),
    ]),
  );
  assert.deepEqual(budgets, {
    "gems-products": undefined,
    "nsw-tessa-products": undefined,
    "veu-approved-products":
      CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET,
  });
  assert.ok(CREDITEX_PRODUCT_REGISTRY_BACKGROUND_SOURCE_TIMEOUT_MS < 20_000);
  assert.ok(
    CREDITEX_VEU_DURABLE_ACQUISITION_MAX_CURRENT_SCALE_QUANTA
      + 1
      + 2 * Math.ceil(
        75_492 / CREDITEX_AUTOMATIC_STREAMING_REFRESH_RECORD_BUDGET,
      ) < 16,
    "a current-scale VEU activation must fit below the Worker subrequest chain limit",
  );
});

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
        if (!sql.includes("not_before <= ?")) {
          const queued = [...state.refreshRequests.values()]
            .filter((request) => values.includes(request.registryCode))
            .sort((left, right) => (
              left.requestedAt.localeCompare(right.requestedAt)
              || left.registryCode.localeCompare(right.registryCode)
            ))[0];
          return queued ? { registry_code: queued.registryCode } : null;
        }
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
        return due ? {
          registry_code: due.registryCode,
          attempt_count: due.attemptCount,
          requested_at: due.requestedAt,
        } : null;
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
const enqueueWithoutSchema = (database, registryCode, now) => (
  enqueueCreditexProductRegistryRefresh(database, registryCode, now, {
    ensureSchema: withoutSchemaInstall,
  })
);
const seedWithoutSchema = (input) => (
  seedDueCreditexProductRegistryRefreshRequests({
    ...input,
    enqueueRefresh: enqueueWithoutSchema,
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

test("queued status remains true while a deferred retry is not due", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  database.state.refreshRequests.get(registryCode).notBefore = new Date(
    NOW.getTime() + 3_000,
  ).toISOString();
  assert.equal(await hasQueuedCreditexProductRegistryRefreshRequest(
    database,
    [registryCode],
    { ensureSchema: withoutSchemaInstall },
  ), true);
  assert.equal(await hasDueCreditexProductRegistryRefreshRequest(
    database,
    [registryCode],
    NOW,
    { ensureSchema: withoutSchemaInstall },
  ), false);
});

test("a current registry retries as soon as its failed-attempt backoff ends", () => {
  const failedAt = new Date(
    NOW.getTime() - CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS,
  );
  const status = registryStatus({
    lastCheckedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    lastAttempt: {
      status: "failed",
      checkedAt: failedAt.toISOString(),
      message: "transient refresh failure",
    },
  });
  assert.equal(
    creditexProductRegistryRefreshDue(
      status,
      new Date(NOW.getTime() - 1),
    ),
    false,
  );
  assert.equal(creditexProductRegistryRefreshDue(status, NOW), true);
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

test("unscoped maintenance selects exactly one oldest due registry", async () => {
  const refreshed = [];
  const targets = ["gems-products", "nsw-tessa-products", "veu-approved-products"]
    .map((registryCode) => ({
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        status: "stale",
      }),
      refresh: async (_database, _now, fleetLeaseId) => {
        refreshed.push({ registryCode, fleetLeaseId });
        return { changed: true };
      },
    }));
  const result = await maintainNextCreditexProductRegistry({
    database: {},
    hasQueuedRefresh: async () => false,
    now: NOW,
    targets,
    loadQueuedRefresh: async () => null,
    withFleetLease: async (_database, operation) => operation({
      leaseId: "callback-issued-fleet-lease",
    }),
  });
  assert.deepEqual(refreshed, [{
    registryCode: "gems-products",
    fleetLeaseId: "callback-issued-fleet-lease",
  }]);
  assert.deepEqual(result, {
    registryCode: "gems-products",
    outcome: "refreshed",
    changed: true,
  });
});

test("unscoped maintenance does not bypass a durable request not-before time", async () => {
  const database = fleetDatabase();
  const registryCode = "gems-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  database.state.refreshRequests.get(registryCode).notBefore = new Date(
    NOW.getTime() + 3_000,
  ).toISOString();
  let refreshCalls = 0;
  const result = await maintainNextCreditexProductRegistry({
    database,
    hasQueuedRefresh: (targetDatabase, registryCodes) => (
      hasQueuedCreditexProductRegistryRefreshRequest(
        targetDatabase,
        registryCodes,
        { ensureSchema: withoutSchemaInstall },
      )
    ),
    now: NOW,
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        status: "stale",
      }),
      refresh: async () => {
        refreshCalls += 1;
        return { changed: true };
      },
    }],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(result, {
    registryCode,
    outcome: "retry_backoff",
  });
  assert.equal(refreshCalls, 0);
  assert.equal(database.state.refreshRequests.has(registryCode), true);
});

test("a fresh fleet root seeds stale GEMS and NSW work then advances only the oldest target", async () => {
  const database = fleetDatabase();
  const refreshed = [];
  const targets = [
    {
      registryCode: "gems-products",
      loadStatus: async () => registryStatus({
        registryCode: "gems-products",
        status: "stale",
      }),
      refresh: async () => {
        refreshed.push("gems-products");
        return { changed: true, complete: true };
      },
    },
    {
      registryCode: "nsw-tessa-products",
      loadStatus: async () => registryStatus({
        registryCode: "nsw-tessa-products",
        status: "stale",
      }),
      refresh: async () => {
        refreshed.push("nsw-tessa-products");
        return { changed: true, complete: true };
      },
    },
    {
      registryCode: "veu-approved-products",
      loadStatus: async () => registryStatus({
        registryCode: "veu-approved-products",
        lastCheckedAt: NOW.toISOString(),
        lastAttempt: {
          status: "success",
          checkedAt: NOW.toISOString(),
          message: "",
        },
      }),
      refresh: async () => {
        throw new Error("healthy VEU registry must not churn");
      },
    },
  ];
  const result = await drainCreditexProductRegistryMaintenance({
    database,
    now: () => NOW,
    seedRefreshes: seedWithoutSchema,
    targets,
    maintain: (input) => maintainNextCreditexProductRegistry({
      ...input,
      withFleetLease: realFleetLease,
    }),
  });
  assert.deepEqual(refreshed, ["gems-products"]);
  assert.equal(result.outcome, "refreshed");
  assert.equal(result.steps, 1);
  assert.equal(database.state.refreshRequests.has("gems-products"), false);
  assert.equal(database.state.refreshRequests.has("nsw-tessa-products"), true);
  assert.equal(database.state.refreshRequests.has("veu-approved-products"), false);
});

test("a healthy current registry is not seeded or refreshed", async () => {
  const enqueued = [];
  const registryCodes = await seedDueCreditexProductRegistryRefreshRequests({
    database: {},
    enqueueRefresh: async (_database, registryCode) => {
      enqueued.push(registryCode);
    },
    now: NOW,
    targets: [{
      registryCode: "veu-approved-products",
      loadStatus: async () => registryStatus({
        lastCheckedAt: NOW.toISOString(),
        lastAttempt: {
          status: "unchanged",
          checkedAt: NOW.toISOString(),
          message: "",
        },
      }),
      refresh: async () => {
        throw new Error("healthy current registry must not refresh");
      },
    }],
  });
  assert.deepEqual(registryCodes, []);
  assert.deepEqual(enqueued, []);
});

test("fleet seeding respects failed-attempt backoff", async () => {
  const enqueued = [];
  const target = {
    registryCode: "gems-products",
    loadStatus: async () => registryStatus({
      registryCode: "gems-products",
      status: "stale",
      lastAttempt: {
        status: "failed",
        checkedAt: NOW.toISOString(),
        message: "temporary source failure",
      },
    }),
    refresh: async () => ({ changed: false }),
  };
  assert.deepEqual(await seedDueCreditexProductRegistryRefreshRequests({
    database: {},
    enqueueRefresh: async (_database, registryCode) => {
      enqueued.push(registryCode);
    },
    now: new Date(NOW.getTime() + CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS - 1),
    targets: [target],
  }), []);
  assert.deepEqual(enqueued, []);
  assert.deepEqual(await seedDueCreditexProductRegistryRefreshRequests({
    database: {},
    enqueueRefresh: async (_database, registryCode) => {
      enqueued.push(registryCode);
    },
    now: new Date(NOW.getTime() + CREDITEX_PRODUCT_REGISTRY_RETRY_BACKOFF_MS),
    targets: [target],
  }), ["gems-products"]);
  assert.deepEqual(enqueued, ["gems-products"]);
});

test("calculator dispatch prioritises its exact queued registry", async () => {
  const database = fleetDatabase();
  await enqueueCreditexProductRegistryRefresh(
    database,
    "gems-products",
    new Date(NOW.getTime() - 1_000),
    { ensureSchema: withoutSchemaInstall },
  );
  await enqueueCreditexProductRegistryRefresh(
    database,
    "veu-approved-products",
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  const refreshed = [];
  const targets = ["gems-products", "veu-approved-products"].map(
    (registryCode) => ({
      registryCode,
      loadStatus: async () => registryStatus({ registryCode, status: "stale" }),
      refresh: async (_database, _now, fleetLeaseId) => {
        refreshed.push({ registryCode, fleetLeaseId });
        return { changed: true };
      },
    }),
  );
  const result = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    preferredRegistryCode: "veu-approved-products",
    targets,
    withFleetLease: realFleetLease,
  });
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].registryCode, "veu-approved-products");
  assert.ok(refreshed[0].fleetLeaseId);
  assert.equal(result.registryCode, "veu-approved-products");
  assert.equal(database.state.refreshRequests.has("veu-approved-products"), false);
  assert.equal(database.state.refreshRequests.has("gems-products"), true);
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
  let callbackLeaseId = "";
  assert.equal(await withCreditexProductRegistryFleetLease(
    database,
    async (fleetLease) => {
      callbackLeaseId = fleetLease.leaseId;
      return "recovered";
    },
    {
      ensureSchema: withoutSchemaInstall,
      now: () => NOW,
      leaseId: "successor-owner",
    },
  ), "recovered");
  assert.equal(callbackLeaseId, "successor-owner");
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
  assert.equal(await hasDueCreditexProductRegistryRefreshRequest(
    database,
    ["gems-products"],
    NOW,
    { ensureSchema: withoutSchemaInstall },
  ), true);
  const failure = new Error("official source failed");
  const target = {
    registryCode: "gems-products",
    loadStatus: async () => registryStatus({
      registryCode: "gems-products",
      status: "stale",
    }),
    refresh: async () => { throw failure; },
  };
  await assert.rejects(
    maintainNextCreditexProductRegistry({
      database,
      now: NOW,
      targets: [target],
      withFleetLease: realFleetLease,
    }),
    failure,
  );
  const request = database.state.refreshRequests.get("gems-products");
  assert.equal(request.attemptCount, 1);
  assert.equal(request.lastError, failure.message);
  assert.equal(
    request.notBefore,
    new Date(NOW.getTime() + 3_000)
      .toISOString(),
  );
  let attemptedAt = new Date(request.notBefore);
  for (const delay of [6_000, 12_000, CREDITEX_PRODUCT_REGISTRY_QUEUED_RETRY_MAX_MS]) {
    await assert.rejects(
      maintainNextCreditexProductRegistry({
        database,
        now: attemptedAt,
        targets: [target],
        withFleetLease: realFleetLease,
      }),
      failure,
    );
    const retried = database.state.refreshRequests.get("gems-products");
    assert.equal(
      retried.notBefore,
      new Date(attemptedAt.getTime() + delay).toISOString(),
    );
    attemptedAt = new Date(retried.notBefore);
  }
  assert.equal(
    database.state.refreshRequests.get("gems-products").attemptCount,
    4,
  );
  assert.equal(database.state.lease, null);
});

test("a due durable retry overrides the failed-attempt status backoff", async () => {
  const database = fleetDatabase();
  const registryCode = "gems-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  let failed = false;
  let recovered = false;
  let refreshCalls = 0;
  const target = {
    registryCode,
    loadStatus: async (_database, now) => registryStatus({
      registryCode,
      status: failed ? "current" : "stale",
      lastAttempt: failed && !recovered
        ? {
            status: "failed",
            checkedAt: NOW.toISOString(),
            message: "transient source failure",
          }
        : registryStatus().lastAttempt,
      lastCheckedAt: now.toISOString(),
    }),
    refresh: async () => {
      refreshCalls += 1;
      if (!failed) {
        failed = true;
        throw new Error("transient source failure");
      }
      recovered = true;
      return { changed: true, complete: true };
    },
  };
  await assert.rejects(
    maintainNextCreditexProductRegistry({
      database,
      now: NOW,
      targets: [target],
      withFleetLease: realFleetLease,
    }),
    /transient source failure/,
  );
  const retryAt = new Date(
    database.state.refreshRequests.get(registryCode).notBefore,
  );
  const retried = await maintainNextCreditexProductRegistry({
    database,
    now: retryAt,
    targets: [target],
    withFleetLease: realFleetLease,
  });
  assert.equal(refreshCalls, 2);
  assert.equal(retried.outcome, "refreshed");
  assert.equal(database.state.refreshRequests.size, 0);
});

test("an explicit due queue refreshes a current registry", async () => {
  const database = fleetDatabase();
  const registryCode = "nsw-tessa-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  let refreshCalls = 0;
  const result = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({ registryCode, status: "current" }),
      refresh: async () => {
        refreshCalls += 1;
        return { changed: false, complete: true };
      },
    }],
    withFleetLease: realFleetLease,
  });
  assert.equal(refreshCalls, 1);
  assert.equal(result.outcome, "refreshed");
  assert.equal(database.state.refreshRequests.size, 0);
});

test("a healthy accepted attempt clears an older orphaned current VEU request", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    new Date(NOW.getTime() - 60_000),
    { ensureSchema: withoutSchemaInstall },
  );
  let refreshCalls = 0;
  const result = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        lastCheckedAt: NOW.toISOString(),
        lastAttempt: {
          status: "success",
          checkedAt: NOW.toISOString(),
          message: "",
        },
      }),
      hasPendingWork: async () => false,
      refresh: async () => {
        refreshCalls += 1;
        return { changed: false, complete: true };
      },
    }],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(result, {
    registryCode,
    outcome: "current",
  });
  assert.equal(refreshCalls, 0);
  assert.equal(database.state.refreshRequests.size, 0);
});

test("an incomplete replay keeps its queue due without recording failure backoff", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  let complete = false;
  const target = {
    registryCode,
    loadStatus: async () => registryStatus({ registryCode, status: "stale" }),
    refresh: async () => complete
      ? { changed: true, complete: true }
      : {
          changed: false,
          complete: false,
          stagedRecordCount: 500,
          recordCount: 2_501,
        },
  };
  const progressed = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [target],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(progressed, {
    registryCode,
    outcome: "progressed",
    stagedRecordCount: 500,
    recordCount: 2_501,
  });
  const queued = database.state.refreshRequests.get(registryCode);
  assert.equal(queued.attemptCount, 0);
  assert.equal(queued.notBefore, NOW.toISOString());
  assert.equal(queued.lastAttemptAt, null);
  assert.equal(queued.lastError, null);
  assert.equal(database.state.lease, null);

  complete = true;
  const finished = await maintainNextCreditexProductRegistry({
    database,
    now: new Date(NOW.getTime() + 1),
    targets: [target],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(finished, {
    registryCode,
    outcome: "refreshed",
    changed: true,
  });
  assert.equal(database.state.refreshRequests.size, 0);
  assert.equal(database.state.lease, null);
});

test("retained replay bypasses a failed-source backoff and finishes immediately", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  let refreshCalls = 0;
  let recovered = false;
  const result = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        status: "stale",
        lastAttempt: recovered
          ? registryStatus().lastAttempt
          : {
              status: "failed",
              checkedAt: new Date(NOW.getTime() - 1_000).toISOString(),
              message: "transient worker cancellation",
            },
      }),
      hasPendingWork: async () => !recovered,
      refresh: async () => {
        refreshCalls += 1;
        recovered = true;
        return { changed: true, complete: true };
      },
    }],
    withFleetLease: realFleetLease,
  });
  assert.equal(refreshCalls, 1);
  assert.equal(result.outcome, "refreshed");
  assert.equal(database.state.refreshRequests.size, 0);
});

test("a completed cleanup keeps its queue until a healthy source receipt exists", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  let refreshCalls = 0;
  let healthyReceipt = false;
  const target = {
    registryCode,
    loadStatus: async () => registryStatus({
      registryCode,
      status: "current",
      lastAttempt: healthyReceipt
        ? registryStatus().lastAttempt
        : {
            status: "failed",
            checkedAt: new Date(NOW.getTime() - 1_000).toISOString(),
            message: "transient cleanup cancellation",
          },
    }),
    refresh: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        return { changed: false, complete: true };
      }
      healthyReceipt = true;
      return { changed: false, complete: true };
    },
  };

  const cleanup = await maintainNextCreditexProductRegistry({
    database,
    now: NOW,
    targets: [target],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(cleanup, {
    registryCode,
    outcome: "progressed",
    stagedRecordCount: 0,
    recordCount: 0,
  });
  assert.equal(database.state.refreshRequests.size, 1);

  const verified = await maintainNextCreditexProductRegistry({
    database,
    now: new Date(NOW.getTime() + 1),
    targets: [target],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(verified, {
    registryCode,
    outcome: "refreshed",
    changed: false,
  });
  assert.equal(refreshCalls, 2);
  assert.equal(database.state.refreshRequests.size, 0);
});

test("orphaned retained cleanup recreates its queue until a healthy receipt exists", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  const result = await maintainNextCreditexProductRegistry({
    database,
    enqueueRefresh: (targetDatabase, code, queuedAt) => (
      enqueueCreditexProductRegistryRefresh(
        targetDatabase,
        code,
        queuedAt,
        { ensureSchema: withoutSchemaInstall },
      )
    ),
    now: NOW,
    preferredRegistryCode: registryCode,
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({
        registryCode,
        status: "current",
        lastAttempt: {
          status: "failed",
          checkedAt: new Date(NOW.getTime() - 1_000).toISOString(),
          message: "worker cancelled after retained progress commit",
        },
      }),
      hasPendingWork: async () => true,
      refresh: async () => ({ changed: false, complete: true }),
    }],
    withFleetLease: realFleetLease,
  });
  assert.deepEqual(result, {
    registryCode,
    outcome: "progressed",
    stagedRecordCount: 0,
    recordCount: 0,
  });
  assert.equal(database.state.refreshRequests.size, 1);
  assert.equal(
    database.state.refreshRequests.get(registryCode).notBefore,
    NOW.toISOString(),
  );
});

test("background drain advances consecutive replay quanta in one invocation", async () => {
  let calls = 0;
  const result = await drainCreditexProductRegistryMaintenance({
    database: {},
    maximumElapsedMs: 25_000,
    maximumSteps: CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS,
    now: () => NOW,
    preferredRegistryCode: "veu-approved-products",
    targets: [{
      registryCode: "veu-approved-products",
      loadStatus: async () => registryStatus(),
      refresh: async () => ({ changed: false }),
    }],
    maintain: async () => {
      calls += 1;
      return calls < 5
        ? { registryCode: "veu-approved-products", outcome: "progressed" }
        : {
            registryCode: "veu-approved-products",
            outcome: "refreshed",
            changed: true,
          };
    },
  });
  assert.equal(calls, 5);
  assert.equal(result.steps, 5);
  assert.equal(result.outcome, "refreshed");
  assert.equal(result.continuationRequired, false);
});

test("background drain leaves activated predecessor cleanup to a fresh root invocation", async () => {
  let calls = 0;
  const result = await drainCreditexProductRegistryMaintenance({
    database: {},
    maximumElapsedMs: 25_000,
    maximumSteps: CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS,
    now: () => NOW,
    preferredRegistryCode: "veu-approved-products",
    targets: [],
    maintain: async () => {
      calls += 1;
      return {
        registryCode: "veu-approved-products",
        outcome: "progressed",
        deferContinuation: true,
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.outcome, "progressed");
  assert.equal(result.continuationRequired, false);
});

test("background drain requests a new invocation when bounded time expires", async () => {
  let calls = 0;
  let elapsed = 0;
  const result = await drainCreditexProductRegistryMaintenance({
    database: {},
    maximumElapsedMs: 1_000,
    maximumSteps: CREDITEX_PRODUCT_REGISTRY_BACKGROUND_DRAIN_MAX_STEPS,
    now: () => new Date(NOW.getTime() + elapsed),
    preferredRegistryCode: "veu-approved-products",
    targets: [],
    maintain: async () => {
      calls += 1;
      elapsed += 600;
      return { registryCode: "veu-approved-products", outcome: "progressed" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.outcome, "progressed");
  assert.equal(result.continuationRequired, true);
});

test("background drain never starts a second slow step beyond its one invocation deadline", async () => {
  let calls = 0;
  let elapsed = 0;
  const result = await drainCreditexProductRegistryMaintenance({
    database: {},
    maximumElapsedMs: 1_000,
    operationTimeoutMs: 800,
    now: () => new Date(NOW.getTime() + elapsed),
    preferredRegistryCode: "veu-approved-products",
    targets: [],
    maintain: async ({ scheduledOperationTimeoutMs }) => {
      calls += 1;
      assert.equal(scheduledOperationTimeoutMs, 800);
      elapsed += 950;
      return { registryCode: "veu-approved-products", outcome: "progressed" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.continuationRequired, true);
});

test("background drain reserves enough time to dispatch after one live-scale replay quantum", async () => {
  let calls = 0;
  let elapsed = 0;
  const result = await drainCreditexProductRegistryMaintenance({
    database: {},
    maximumElapsedMs: 22_000,
    operationTimeoutMs: 18_000,
    now: () => new Date(NOW.getTime() + elapsed),
    preferredRegistryCode: "veu-approved-products",
    targets: [],
    maintain: async ({ scheduledOperationTimeoutMs }) => {
      calls += 1;
      assert.equal(scheduledOperationTimeoutMs, 18_000);
      elapsed += 15_000;
      return { registryCode: "veu-approved-products", outcome: "progressed" };
    },
  });
  assert.equal(CREDITEX_PRODUCT_REGISTRY_CONTINUATION_HEADROOM_MS, 4_000);
  assert.equal(calls, 1);
  assert.equal(result.steps, 1);
  assert.equal(result.outcome, "progressed");
  assert.equal(result.continuationRequired, true);
});

test("background drain defers a bounded source failure to a fresh root continuation", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  const result = await drainCreditexProductRegistryMaintenance({
    database,
    now: () => NOW,
    operationTimeoutMs: 100,
    preferredRegistryCode: registryCode,
    maintain: (input) => maintainNextCreditexProductRegistry({
      ...input,
      withFleetLease: realFleetLease,
    }),
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({ registryCode, status: "stale" }),
      refresh: async (_database, _now, _fleetLeaseId, signal) => (
        new Promise((_resolve, reject) => {
          assert.ok(signal);
          signal.addEventListener("abort", () => {
            reject(new Error("bounded official source timeout"));
          }, { once: true });
        })
      ),
    }],
  });
  assert.deepEqual(result, {
    registryCode,
    outcome: "retry_scheduled",
    retryAfterMs: 3_000,
    continuationRequired: false,
    continuationDelayMs: 3_000,
    steps: 1,
  });
  const queued = database.state.refreshRequests.get(registryCode);
  assert.equal(queued.notBefore, new Date(NOW.getTime() + 3_000).toISOString());
  assert.equal(queued.attemptCount, 1);
  assert.match(queued.lastError, /bounded official source timeout/);
});

test("a timed-out durable acquisition stays queued for a fresh root continuation", async () => {
  const database = fleetDatabase();
  const registryCode = "veu-approved-products";
  await enqueueCreditexProductRegistryRefresh(
    database,
    registryCode,
    NOW,
    { ensureSchema: withoutSchemaInstall },
  );
  const result = await drainCreditexProductRegistryMaintenance({
    database,
    now: () => NOW,
    operationTimeoutMs: 100,
    preferredRegistryCode: registryCode,
    maintain: (input) => maintainNextCreditexProductRegistry({
      ...input,
      withFleetLease: realFleetLease,
    }),
    targets: [{
      registryCode,
      loadStatus: async () => registryStatus({ registryCode, status: "stale" }),
      hasPendingWork: async () => true,
      refresh: async (_database, _now, _fleetLeaseId, signal) => (
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("durable acquisition page timed out"));
          }, { once: true });
        })
      ),
    }],
  });
  assert.deepEqual(result, {
    registryCode,
    outcome: "retry_scheduled",
    retryAfterMs: 3_000,
    deferContinuation: true,
    continuationRequired: false,
    continuationDelayMs: 3_000,
    steps: 1,
  });
  const queued = database.state.refreshRequests.get(registryCode);
  assert.equal(queued.attemptCount, 1);
  assert.equal(queued.notBefore, new Date(NOW.getTime() + 3_000).toISOString());
  assert.match(queued.lastError, /durable acquisition page timed out/);
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

test("dispatch responses and health traffic each schedule one bounded registry maintenance drain", () => {
  const worker = fs.readFileSync(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const dispatchBlock = worker.slice(
    worker.indexOf("function queueCreditexProductRegistryDispatch"),
    worker.indexOf("function queueBackgroundDispatches"),
  );
  assert.match(
    dispatchBlock,
    /response\.headers\.get\(CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER\)/,
  );
  assert.match(
    dispatchBlock,
    /headers\.delete\(CREDITEX_PRODUCT_REGISTRY_DISPATCH_HEADER\)/,
  );
  assert.match(
    dispatchBlock,
    /ctx\.waitUntil\(\s*drainCreditexProductRegistryMaintenance\(\{/,
  );
  assert.match(dispatchBlock, /preferredRegistryCode: registryCode/);
  assert.match(dispatchBlock, /result\.continuationRequired/);
  assert.match(
    dispatchBlock,
    /requestCreditexProductRegistryContinuation\(\s*request,\s*registryCode/,
  );
  assert.equal(
    dispatchBlock.match(/drainCreditexProductRegistryMaintenance\(/g)?.length,
    1,
    "one stale response must schedule only one bounded maintenance drain",
  );
  assert.match(
    dispatchBlock,
    /return new Response\(response\.body,[\s\S]*headers,/,
  );
  const healthBlock = worker.slice(
    worker.indexOf('if (request.method === "GET" && url.pathname === "/api/health" && response.ok)'),
    worker.indexOf("return queueTradeQuoteDeliveryDispatch"),
  );
  assert.match(
    healthBlock,
    /ctx\.waitUntil\(\s*drainCreditexProductRegistryMaintenance\(\{/,
  );
  assert.match(
    healthBlock,
    /creditexAutomaticProductRegistryMaintenanceTargets\(\{/,
  );
  assert.match(healthBlock, /result\.continuationRequired/);
  assert.match(
    healthBlock,
    /CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE/,
  );
  assert.equal(
    healthBlock.match(/drainCreditexProductRegistryMaintenance\(/g)?.length,
    1,
    "one successful health request must schedule only one bounded maintenance drain",
  );
  assert.doesNotMatch(healthBlock, /for \(const definition of .*ProductRegistr/);
  const continuationBlock = worker.slice(
    worker.indexOf("async function requestCreditexProductRegistryContinuation"),
    worker.indexOf("function queueBackgroundDispatches"),
  );
  assert.match(continuationBlock, /continueRegistry/);
  assert.match(continuationBlock, /cache: "no-store"/);
  assert.match(continuationBlock, /redirect: "manual"/);
  assert.match(continuationBlock, /if \(!response\.ok\)/);
  const scheduledBlock = worker.slice(worker.indexOf("async scheduled"));
  assert.match(scheduledBlock, /drainCreditexProductRegistryMaintenance/);
  assert.match(scheduledBlock, /creditexAutomaticProductRegistryMaintenanceTargets/);
  assert.doesNotMatch(scheduledBlock, /for \(const definition of .*ProductRegistr/);
});

test("Sites deployment enables and audits public self-continuation fetches", () => {
  const vite = fs.readFileSync(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );
  const bundleAudit = fs.readFileSync(
    new URL("../scripts/audit-sites-server-bundle.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    vite,
    /compatibility_flags:\s*\[[\s\S]*"nodejs_compat"[\s\S]*"global_fetch_strictly_public"[\s\S]*\]/,
  );
  assert.match(bundleAudit, /dist[\s\S]*server[\s\S]*wrangler\.json/);
  assert.match(bundleAudit, /global_fetch_strictly_public/);
  assert.match(bundleAudit, /compatibilityFlags\.includes\(requiredFlag\)/);
});
