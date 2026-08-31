import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createSharedSurgeUsageGuard,
  SURGE_USAGE_GUARD_DEFAULTS,
  SURGE_USAGE_GUARD_ENV,
} from "../src/lib/energy-assistant-usage-guard.ts";

const START = Date.parse("2026-08-21T10:15:00.000Z");

function opaqueKey(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestKey(index) {
  return `surge-request-${String(index).padStart(8, "0")}`;
}

function productionEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    [SURGE_USAGE_GUARD_ENV.secret]: "test-secret-that-is-at-least-thirty-two-characters-long",
    [SURGE_USAGE_GUARD_ENV.clientMinuteLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.clientMinuteLimit),
    [SURGE_USAGE_GUARD_ENV.clientDailyLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.clientDailyLimit),
    [SURGE_USAGE_GUARD_ENV.networkMinuteLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.networkMinuteLimit),
    [SURGE_USAGE_GUARD_ENV.networkDailyLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.networkDailyLimit),
    [SURGE_USAGE_GUARD_ENV.globalMinuteLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.globalMinuteLimit),
    [SURGE_USAGE_GUARD_ENV.globalInFlightLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.globalInFlightLimit),
    [SURGE_USAGE_GUARD_ENV.globalDailyMicroUsdLimit]: String(SURGE_USAGE_GUARD_DEFAULTS.globalDailyMicroUsdLimit),
    ...overrides,
  };
}

class FakeD1Database {
  constructor({ fail = false, conflict = false, yieldReads = true } = {}) {
    this.rows = new Map();
    this.fail = fail;
    this.conflict = conflict;
    this.yieldReads = yieldReads;
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    return {
      bind: (...values) => ({
        first: async () => {
          if (this.fail) throw new Error("fake D1 unavailable");
          if (!normalized.startsWith("SELECT STATE_JSON, VERSION")) {
            throw new Error(`unsupported fake D1 read: ${normalized}`);
          }
          if (this.yieldReads) await new Promise((resolve) => setImmediate(resolve));
          const row = this.rows.get(values[0]);
          return row ? { state_json: row.state_json, version: row.version } : null;
        },
        run: async () => {
          if (this.fail) throw new Error("fake D1 unavailable");
          if (this.conflict) return { meta: { changes: 0 } };
          await Promise.resolve();
          if (normalized.startsWith("INSERT OR IGNORE")) {
            const [scopeHash, stateJson, updatedAt] = values;
            if (this.rows.has(scopeHash)) return { meta: { changes: 0 } };
            this.rows.set(scopeHash, {
              state_json: stateJson,
              version: 0,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          if (normalized.startsWith("UPDATE SURGE_MODEL_USAGE_STATE")) {
            const [stateJson, updatedAt, scopeHash, version] = values;
            const row = this.rows.get(scopeHash);
            if (!row || row.version !== version) return { meta: { changes: 0 } };
            this.rows.set(scopeHash, {
              state_json: stateJson,
              version: row.version + 1,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`unsupported fake D1 write: ${normalized}`);
        },
      }),
    };
  }

  parsedStates() {
    return [...this.rows.entries()].map(([scopeHash, row]) => ({
      scopeHash,
      state: JSON.parse(row.state_json),
      stateJson: row.state_json,
      version: row.version,
    }));
  }

  globalState() {
    return this.parsedStates().find((row) => row.state.kind === "global")?.state || null;
  }
}

function fixture(options = {}) {
  const database = options.database || new FakeD1Database();
  const clock = options.clock || { value: START };
  let sequence = 0;
  const guard = createSharedSurgeUsageGuard({
    env: productionEnvironment(options.env),
    getDatabase: options.noDatabase ? undefined : () => database,
    now: () => clock.value,
    randomUUID: () => `lease-${String(sequence += 1).padStart(12, "0")}`,
  });
  return { database, clock, guard };
}

function reservation(index, overrides = {}) {
  return {
    clientKey: opaqueKey(`client-${index}`),
    networkKey: opaqueKey(`network-${index}`),
    requestKey: requestKey(index),
    estimatedMicroUsd: 1,
    ...overrides,
  };
}

function admitted(results) {
  return results.filter((result) => result.allowed);
}

async function concurrentBurst(guard, count, makeReservation) {
  return Promise.all(Array.from({ length: count }, (_, index) =>
    guard.reserve(makeReservation(index))));
}

test("production configuration exposes the exact fixed default ceilings", () => {
  assert.deepEqual(SURGE_USAGE_GUARD_DEFAULTS, {
    clientMinuteLimit: 20,
    clientDailyLimit: 200,
    networkMinuteLimit: 120,
    networkDailyLimit: 2_000,
    globalMinuteLimit: 120,
    globalInFlightLimit: 20,
    globalDailyMicroUsdLimit: 100_000_000,
    inFlightLeaseMs: 120_000,
    requestIdempotencyMs: 600_000,
  });
  assert.equal(SURGE_USAGE_GUARD_ENV.globalInFlightLimit, "SURGE_GLOBAL_INFLIGHT_LIMIT");
  assert.equal(SURGE_USAGE_GUARD_ENV.globalDailyMicroUsdLimit, "SURGE_GLOBAL_DAILY_MICRO_USD");
});

test("concurrent reservations cannot cross any configured client, network or global ceiling", async (t) => {
  await t.test("client minute 20", async () => {
    const { guard } = fixture({ env: {
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index, {
      clientKey: opaqueKey("same-client"),
    }));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.clientMinuteLimit);
  });

  await t.test("client day 200", async () => {
    const { guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index, {
      clientKey: opaqueKey("same-client"),
    }));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.clientDailyLimit);
  });

  await t.test("network minute 120", async () => {
    const { guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index, {
      networkKey: opaqueKey("same-network"),
    }));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.networkMinuteLimit);
  });

  await t.test("network day 2000", async () => {
    const { guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 2_500, (index) => reservation(index, {
      networkKey: opaqueKey("same-network"),
    }));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.networkDailyLimit);
  });

  await t.test("global minute 120", async () => {
    const { database, guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.globalMinuteLimit);
    assert.ok(database.globalState().minuteCount <= SURGE_USAGE_GUARD_DEFAULTS.globalMinuteLimit);
  });

  await t.test("global active leases 20", async () => {
    const { database, guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= SURGE_USAGE_GUARD_DEFAULTS.globalInFlightLimit);
    assert.ok(database.globalState().leases.length <= SURGE_USAGE_GUARD_DEFAULTS.globalInFlightLimit);
  });

  await t.test("global daily micro-USD", async () => {
    const cap = 2_000_000;
    const { database, guard } = fixture({ env: {
      SURGE_CLIENT_MINUTE_LIMIT: "1000",
      SURGE_CLIENT_DAILY_LIMIT: "1000",
      SURGE_NETWORK_MINUTE_LIMIT: "1000",
      SURGE_NETWORK_DAILY_LIMIT: "1000",
      SURGE_GLOBAL_MINUTE_LIMIT: "1000",
      SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
      SURGE_GLOBAL_DAILY_MICRO_USD: String(cap),
    } });
    const results = await concurrentBurst(guard, 1_000, (index) => reservation(index, {
      estimatedMicroUsd: 400_000,
    }));
    assert.ok(admitted(results).length > 0);
    assert.ok(admitted(results).length <= 5);
    assert.ok(database.globalState().dailyReservedMicroUsd <= cap);
  });
});

test("request idempotency admits one concurrent request and survives release for ten minutes", async () => {
  const { guard } = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "1000",
    SURGE_CLIENT_DAILY_LIMIT: "1000",
    SURGE_NETWORK_MINUTE_LIMIT: "1000",
    SURGE_NETWORK_DAILY_LIMIT: "1000",
    SURGE_GLOBAL_MINUTE_LIMIT: "1000",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1000",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
  } });
  const exact = reservation(1);
  const results = await concurrentBurst(guard, 100, () => exact);
  const successes = admitted(results);
  assert.equal(successes.length, 1);
  await successes[0].release();
  const replay = await guard.reserve(exact);
  assert.equal(replay.allowed, false);
  assert.equal(replay.reason, "duplicate_request");
  assert.ok(replay.retryAfterSeconds > 0 && replay.retryAfterSeconds <= 600);
});

test("global in-flight denial does not consume client or network quota", async () => {
  const { database, guard } = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "1",
    SURGE_CLIENT_DAILY_LIMIT: "1",
    SURGE_NETWORK_MINUTE_LIMIT: "1",
    SURGE_NETWORK_DAILY_LIMIT: "1",
    SURGE_GLOBAL_MINUTE_LIMIT: "10",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1000",
  } });
  const blocking = await guard.reserve(reservation(1));
  assert.equal(blocking.allowed, true);

  const deniedInput = reservation(2);
  const denied = await guard.reserve(deniedInput);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "global_in_flight");

  const counterStates = database.parsedStates()
    .filter((row) => row.state.kind === "counter")
    .map((row) => row.state);
  assert.equal(counterStates.length, 4);
  assert.equal(counterStates.filter((state) => state.minuteCount === 0 && state.dayCount === 0).length, 2);

  await blocking.release();
  const retry = await guard.reserve(reservation(3, {
    clientKey: deniedInput.clientKey,
    networkKey: deniedInput.networkKey,
  }));
  assert.equal(retry.allowed, true);
  await retry.release();
});

test("the default in-flight lease covers three slow paid attempts", async () => {
  const { clock, guard } = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "1000",
    SURGE_CLIENT_DAILY_LIMIT: "1000",
    SURGE_NETWORK_MINUTE_LIMIT: "1000",
    SURGE_NETWORK_DAILY_LIMIT: "1000",
    SURGE_GLOBAL_MINUTE_LIMIT: "1000",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1000000000",
  } });
  const slow = await guard.reserve(reservation(1));
  assert.equal(slow.allowed, true);

  clock.value += 90_001;
  const duringThirdAttemptWindow = await guard.reserve(reservation(2));
  assert.equal(duringThirdAttemptWindow.allowed, false);
  assert.equal(duringThirdAttemptWindow.reason, "global_in_flight");

  clock.value += 30_000;
  const afterLease = await guard.reserve(reservation(3));
  assert.equal(afterLease.allowed, true);
  await afterLease.release();
});

test("fixed UTC minute and day buckets reset only at their exact boundaries", async () => {
  const minuteFixture = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "1",
    SURGE_CLIENT_DAILY_LIMIT: "10",
    SURGE_NETWORK_MINUTE_LIMIT: "1",
    SURGE_NETWORK_DAILY_LIMIT: "10",
    SURGE_GLOBAL_MINUTE_LIMIT: "1",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "10",
  }, clock: { value: Date.parse("2026-08-21T10:15:59.900Z") } });
  const firstMinute = await minuteFixture.guard.reserve(reservation(1));
  assert.equal(firstMinute.allowed, true);
  await firstMinute.release();
  minuteFixture.clock.value += 99;
  assert.equal((await minuteFixture.guard.reserve(reservation(2))).allowed, false);
  minuteFixture.clock.value += 1;
  assert.equal((await minuteFixture.guard.reserve(reservation(3))).allowed, true);

  const dayFixture = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "10",
    SURGE_CLIENT_DAILY_LIMIT: "1",
    SURGE_NETWORK_MINUTE_LIMIT: "10",
    SURGE_NETWORK_DAILY_LIMIT: "1",
    SURGE_GLOBAL_MINUTE_LIMIT: "10",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1",
  }, clock: { value: Date.parse("2026-08-21T23:59:59.900Z") } });
  const firstDay = await dayFixture.guard.reserve(reservation(10));
  assert.equal(firstDay.allowed, true);
  await firstDay.release();
  dayFixture.clock.value += 99;
  assert.equal((await dayFixture.guard.reserve(reservation(11))).allowed, false);
  dayFixture.clock.value += 1;
  assert.equal((await dayFixture.guard.reserve(reservation(12))).allowed, true);
});

test("expired leases free capacity but neither refund cost nor erase request idempotency", async () => {
  const { clock, database, guard } = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "10",
    SURGE_CLIENT_DAILY_LIMIT: "10",
    SURGE_NETWORK_MINUTE_LIMIT: "10",
    SURGE_NETWORK_DAILY_LIMIT: "10",
    SURGE_GLOBAL_MINUTE_LIMIT: "10",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1000",
  } });
  const firstInput = reservation(1, { estimatedMicroUsd: 100 });
  const first = await guard.reserve(firstInput);
  assert.equal(first.allowed, true);
  const blocked = await guard.reserve(reservation(2, { estimatedMicroUsd: 100 }));
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "global_in_flight");
  clock.value += SURGE_USAGE_GUARD_DEFAULTS.inFlightLeaseMs + 1;
  const afterExpiry = await guard.reserve(reservation(3, { estimatedMicroUsd: 100 }));
  assert.equal(afterExpiry.allowed, true);
  assert.equal(database.globalState().leases.length, 1);
  assert.equal(database.globalState().dailyReservedMicroUsd, 200);
  const duplicate = await guard.reserve(firstInput);
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.reason, "duplicate_request");
});

test("an in-flight lease override cannot be shorter than the three-attempt provider window", async () => {
  const { clock, guard } = fixture({ env: {
    SURGE_CLIENT_MINUTE_LIMIT: "10",
    SURGE_CLIENT_DAILY_LIMIT: "10",
    SURGE_NETWORK_MINUTE_LIMIT: "10",
    SURGE_NETWORK_DAILY_LIMIT: "10",
    SURGE_GLOBAL_MINUTE_LIMIT: "10",
    SURGE_GLOBAL_INFLIGHT_LIMIT: "1",
    SURGE_GLOBAL_DAILY_MICRO_USD: "1000",
    SURGE_IN_FLIGHT_LEASE_MS: "1000",
  } });
  const first = await guard.reserve(reservation(1));
  assert.equal(first.allowed, true);
  clock.value += 1_001;
  const beforeSafeExpiry = await guard.reserve(reservation(2));
  assert.equal(beforeSafeExpiry.allowed, false);
  assert.equal(beforeSafeExpiry.reason, "global_in_flight");
  clock.value += SURGE_USAGE_GUARD_DEFAULTS.inFlightLeaseMs;
  assert.equal((await guard.reserve(reservation(3))).allowed, true);
});

test("D1 contains only second-stage HMAC identifiers and bounded JSON state", async () => {
  const { database, guard } = fixture();
  const input = reservation(7, { estimatedMicroUsd: 123 });
  const result = await guard.reserve(input);
  assert.equal(result.allowed, true);
  const serializedDatabase = JSON.stringify([...database.rows.entries()]);
  assert.doesNotMatch(serializedDatabase, /203\.0\.113\.|surge-request-00000007/);
  assert.doesNotMatch(serializedDatabase, new RegExp(input.clientKey));
  assert.doesNotMatch(serializedDatabase, new RegExp(input.networkKey));
  for (const row of database.parsedStates()) {
    assert.match(row.scopeHash, /^[0-9a-f]{64}$/);
    assert.ok(row.stateJson.length >= 2 && row.stateJson.length <= 131_072);
    if (row.state.kind === "global") {
      for (const entry of [...row.state.leases, ...row.state.requests]) {
        assert.match(entry.hash, /^[0-9a-f]{64}$/);
      }
    }
  }
});

test("configuration, D1 and exhausted CAS failures all deny model admission", async (t) => {
  await t.test("short or missing secret", async () => {
    const database = new FakeD1Database();
    for (const secret of [undefined, "too-short"]) {
      const env = productionEnvironment({ SURGE_USAGE_GUARD_SECRET: secret });
      const guard = createSharedSurgeUsageGuard({ env, getDatabase: () => database });
      const result = await guard.reserve(reservation(1));
      assert.deepEqual(result, { allowed: false, reason: "configuration" });
    }
    assert.equal(database.rows.size, 0);
  });

  await t.test("missing or invalid production limit", async () => {
    for (const value of [undefined, "0", "1.5", "-1"]) {
      const env = productionEnvironment({ SURGE_GLOBAL_MINUTE_LIMIT: value });
      const guard = createSharedSurgeUsageGuard({ env, getDatabase: () => new FakeD1Database() });
      assert.deepEqual(await guard.reserve(reservation(1)), {
        allowed: false,
        reason: "configuration",
      });
    }
  });

  await t.test("an unknown runtime cannot receive development defaults", async () => {
    const guard = createSharedSurgeUsageGuard({
      env: {
        SURGE_USAGE_GUARD_SECRET: "test-secret-that-is-at-least-thirty-two-characters-long",
      },
      getDatabase: () => new FakeD1Database(),
    });
    assert.deepEqual(await guard.reserve(reservation(1)), {
      allowed: false,
      reason: "configuration",
    });
  });

  await t.test("missing or throwing D1", async () => {
    const noDatabase = createSharedSurgeUsageGuard({ env: productionEnvironment() });
    assert.deepEqual(await noDatabase.reserve(reservation(1)), {
      allowed: false,
      reason: "unavailable",
    });
    const failing = fixture({ database: new FakeD1Database({ fail: true }) }).guard;
    assert.deepEqual(await failing.reserve(reservation(2)), {
      allowed: false,
      reason: "unavailable",
    });
  });

  await t.test("CAS contention exhaustion", async () => {
    const conflicted = fixture({ database: new FakeD1Database({ conflict: true }) }).guard;
    assert.deepEqual(await conflicted.reserve(reservation(3)), {
      allowed: false,
      reason: "unavailable",
    });
  });

  await t.test("invalid opaque keys or cost estimate", async () => {
    const { guard } = fixture();
    assert.equal((await guard.reserve(reservation(1, { clientKey: "raw-ip-address" }))).reason, "invalid_identity");
    assert.equal((await guard.reserve(reservation(2, { requestKey: "short" }))).reason, "invalid_identity");
    for (const estimatedMicroUsd of [0, -1, 1.2, Number.MAX_SAFE_INTEGER]) {
      assert.equal((await guard.reserve(reservation(3, { estimatedMicroUsd }))).reason, "invalid_estimate");
    }
  });
});
