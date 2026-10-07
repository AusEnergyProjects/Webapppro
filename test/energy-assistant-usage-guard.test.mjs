import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { Miniflare } from "miniflare";
import {
  createSharedSurgeUsageGuard,
  SURGE_USAGE_GUARD_DEFAULTS,
  SURGE_USAGE_GUARD_ENV,
} from "../src/lib/energy-assistant-usage-guard.ts";

const START = Date.parse("2026-08-21T10:15:00.000Z");
const migration = readFileSync(new URL("../drizzle/0153_surge_model_usage_guard.sql", import.meta.url), "utf8");
const fixtureDatabases = new Set();
after(() => { for (const database of fixtureDatabases) database.close(); });

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

class SqliteD1Database {
  constructor({ fail = false, conflict = false, yieldReads = true } = {}) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(migration);
    fixtureDatabases.add(this.sqlite);
    this.fail = fail;
    this.conflict = conflict;
    this.yieldReads = yieldReads;
    this.calls = [];
    this.writeChanges = [];
    this.beforeRun = null;
    this.afterRun = null;
  }

  get rows() {
    return new Map(this.sqlite.prepare("SELECT * FROM surge_model_usage_state").all()
      .map((row) => [row.scope_hash, row]));
  }

  prepare(sql) {
    return {
      bind: (...values) => ({
        first: async () => {
          this.calls.push("first");
          if (this.fail) throw new Error("fixture D1 unavailable");
          if (this.yieldReads) await new Promise((resolve) => setImmediate(resolve));
          return this.sqlite.prepare(sql).get(...values) || null;
        },
        all: async () => {
          this.calls.push("all");
          if (this.fail) throw new Error("fixture D1 unavailable");
          if (this.yieldReads) await new Promise((resolve) => setImmediate(resolve));
          return { success: true, results: this.sqlite.prepare(sql).all(...values), meta: { changes: 0 } };
        },
        run: async () => {
          this.calls.push("run");
          if (this.fail) throw new Error("fixture D1 unavailable");
          if (this.conflict) return { success: true, meta: { changes: 0 } };
          await Promise.resolve();
          if (this.beforeRun) await this.beforeRun(sql, values);
          const result = this.sqlite.prepare(sql).run(...values);
          this.writeChanges.push(Number(result.changes));
          if (this.afterRun) await this.afterRun(result);
          return { success: true, meta: { changes: Number(result.changes) } };
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
  const database = options.database || new SqliteD1Database();
  const clock = options.clock || { value: START };
  let sequence = 0;
  const guard = createSharedSurgeUsageGuard({
    env: productionEnvironment(options.env),
    getDatabase: options.noDatabase ? undefined : () => database,
    now: () => clock.value,
    randomUUID: () => `lease-${String(sequence += 1).padStart(12, "0")}`,
    usageNamespace: options.usageNamespace,
    dailyLimits: options.dailyLimits,
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

test("explicit unlimited product policy passes daily ceilings while keeping finite usage accounting", async () => {
  const { guard, clock, database } = fixture({ usageNamespace: "wattzun", dailyLimits: "unlimited",
    database: new SqliteD1Database({ yieldReads: false }) });
  const identity = { clientKey: opaqueKey("authenticated-actor"), networkKey: opaqueKey("authenticated-business") };
  for (let index = 0; index < 2_001; index++) {
    if (index && index % 20 === 0) clock.value += 60_000;
    const admitted = await guard.reserve(reservation(index, { ...identity,
      estimatedMicroUsd: index === 0 ? 100_000_001 : 1_000_000 }));
    assert.equal(admitted.allowed, true, `Paid turn ${index + 1} remains eligible after daily ceilings`);
    await admitted.release();
  }
  const states = database.parsedStates();
  assert.equal(states.length, 3);
  assert.ok(states.filter(row => row.state.kind === "counter").every(row => row.state.dayCount === 2_001));
  assert.equal(database.globalState().dailyReservedMicroUsd, 2_100_000_001);
  assert.equal(database.globalState().leases.length, 0);
  assert.ok(states.every(row => Object.values(row.state).filter(value => typeof value === "number").every(Number.isSafeInteger)));
});

test("unlimited product ledger cannot consume or relax the public assistant's configured daily limits", async () => {
  const env = { SURGE_CLIENT_DAILY_LIMIT: "1", SURGE_NETWORK_DAILY_LIMIT: "1", SURGE_GLOBAL_DAILY_MICRO_USD: "10" };
  const ordinary = fixture({ env });
  const product = fixture({ env, database: ordinary.database, clock: ordinary.clock, usageNamespace: "wattzun", dailyLimits: "unlimited" });
  const input = reservation(1, { estimatedMicroUsd: 10 });
  const original = await ordinary.guard.reserve(input); assert.equal(original.allowed, true); await original.release();
  const before = ordinary.database.parsedStates();
  const own = await product.guard.reserve({ ...input, estimatedMicroUsd: 20 });
  assert.equal(own.allowed, true, "The same caller/request identifier belongs to a separately scoped ledger");
  await own.release();
  const second = await product.guard.reserve(reservation(2, { clientKey: input.clientKey, networkKey: input.networkKey, estimatedMicroUsd: 20 }));
  assert.equal(second.allowed, true); await second.release();
  assert.deepEqual(ordinary.database.parsedStates().filter(row => before.some(prior => prior.scopeHash === row.scopeHash)), before);
  assert.equal(ordinary.database.rows.size, 6);
  assert.equal((await ordinary.guard.reserve(reservation(3, { clientKey: input.clientKey }))).reason, "client_day");
  assert.equal((await ordinary.guard.reserve(reservation(4, { networkKey: input.networkKey }))).reason, "network_day");
  assert.equal((await ordinary.guard.reserve(reservation(5))).reason, "global_daily_budget");
  assert.equal((await ordinary.guard.reserve(reservation(6, { estimatedMicroUsd: 11 }))).reason, "invalid_estimate");
});

test("the 201st public customer stage is capped while the same caller's business conversation continues", async () => {
  const database = new SqliteD1Database({ yieldReads: false });
  const ordinary = fixture({ database });
  const product = fixture({ database, clock: ordinary.clock, usageNamespace: "wattzun", dailyLimits: "unlimited" });
  const identity = { clientKey: opaqueKey("same-browser-and-business-actor"), networkKey: opaqueKey("same-network-and-business") };
  let publicScopes;
  for (let index = 0; index < 200; index++) {
    if (index && index % 20 === 0) ordinary.clock.value += 60_000;
    const input = reservation(index, identity);
    const customer = await ordinary.guard.reserve(input);
    assert.equal(customer.allowed, true, `Public customer stage ${index + 1} remains within the configured 200/day`);
    await customer.release();
    if (index === 0) publicScopes = new Set(database.rows.keys());
    const business = await product.guard.reserve({ ...input, estimatedMicroUsd: 100_000_001 });
    assert.equal(business.allowed, true, `Business stage ${index + 1} uses its own ledger despite exceeding the public spend ceiling`);
    await business.release();
  }
  ordinary.clock.value += 60_000;
  const publicBefore = database.parsedStates().filter(row => publicScopes.has(row.scopeHash));
  assert.ok(publicBefore.filter(row => row.state.kind === "counter").every(row => row.state.dayCount === 200));
  assert.equal(publicBefore.find(row => row.state.kind === "global").state.dailyReservedMicroUsd, 200);
  const next = reservation(200, identity);
  assert.equal((await ordinary.guard.reserve(next)).reason, "client_day");
  const businessNext = await product.guard.reserve({ ...next, estimatedMicroUsd: 100_000_001 });
  assert.equal(businessNext.allowed, true, "A capped customer request does not stop the authenticated business conversation");
  await businessNext.release();
  assert.deepEqual(database.parsedStates().filter(row => publicScopes.has(row.scopeHash)), publicBefore);
  assert.equal(database.rows.size, 6);
  assert.ok(database.parsedStates().filter(row => !publicScopes.has(row.scopeHash) && row.state.kind === "counter")
    .every(row => row.state.dayCount === 201));
});

test("unlimited daily policy still rejects bursts, concurrency and duplicate requests without consuming state", async t => {
  for (const [reason, limit, sharedKey] of [
    ["client_minute", "SURGE_CLIENT_MINUTE_LIMIT", "clientKey"],
    ["network_minute", "SURGE_NETWORK_MINUTE_LIMIT", "networkKey"],
    ["global_minute", "SURGE_GLOBAL_MINUTE_LIMIT"],
    ["global_in_flight", "SURGE_GLOBAL_INFLIGHT_LIMIT"],
    ["duplicate_request"],
  ]) await t.test(reason, async () => {
    const { guard, database } = fixture({ usageNamespace: "wattzun", dailyLimits: "unlimited", env: {
      SURGE_CLIENT_DAILY_LIMIT: "1", SURGE_NETWORK_DAILY_LIMIT: "1", SURGE_GLOBAL_DAILY_MICRO_USD: "1", ...(limit ? { [limit]: "1" } : {}),
    } });
    const input = reservation(1, { estimatedMicroUsd: 100 });
    const first = await guard.reserve(input); assert.equal(first.allowed, true);
    const before = database.parsedStates();
    const next = reason === "duplicate_request" ? input : reservation(2, { estimatedMicroUsd: 100, ...(sharedKey ? { [sharedKey]: input[sharedKey] } : {}) });
    assert.equal((await guard.reserve(next)).reason, reason);
    assert.deepEqual(database.parsedStates(), before);
    await first.release();
  });
});

test("unlimited daily policy preserves lease expiry, release and ten-minute idempotency", async () => {
  const { guard, clock, database } = fixture({ usageNamespace: "wattzun", dailyLimits: "unlimited", env: { SURGE_GLOBAL_INFLIGHT_LIMIT: "1" } });
  const input = reservation(1);
  const first = await guard.reserve(input); assert.equal(first.allowed, true);
  assert.equal((await guard.reserve(reservation(2))).reason, "global_in_flight");
  clock.value += SURGE_USAGE_GUARD_DEFAULTS.inFlightLeaseMs + 1;
  const next = await guard.reserve(reservation(3)); assert.equal(next.allowed, true);
  assert.equal(database.globalState().leases.length, 1); await first.release();
  assert.equal(database.globalState().leases.length, 1, "Releasing an expired lease cannot remove a newer request");
  await next.release(); await next.release(); assert.equal(database.globalState().leases.length, 0);
  assert.equal((await guard.reserve(input)).reason, "duplicate_request");
  clock.value = START + SURGE_USAGE_GUARD_DEFAULTS.requestIdempotencyMs;
  const expired = await guard.reserve(input); assert.equal(expired.allowed, true); await expired.release();
});

test("unlimited accounting saturates safely without becoming an admission ceiling", async () => {
  const { guard, database } = fixture({ usageNamespace: "wattzun", dailyLimits: "unlimited" });
  const input = reservation(1, { estimatedMicroUsd: Number.MAX_SAFE_INTEGER });
  const first = await guard.reserve(input); assert.equal(first.allowed, true); await first.release();
  for (const row of database.parsedStates().filter(row => row.state.kind === "counter")) {
    database.sqlite.prepare("UPDATE surge_model_usage_state SET state_json = ? WHERE scope_hash = ?")
      .run(JSON.stringify({ ...row.state, dayCount: Number.MAX_SAFE_INTEGER }), row.scopeHash);
  }
  const next = await guard.reserve(reservation(2, { clientKey: input.clientKey, networkKey: input.networkKey, estimatedMicroUsd: 1 }));
  assert.equal(next.allowed, true); await next.release();
  assert.equal(database.globalState().dailyReservedMicroUsd, Number.MAX_SAFE_INTEGER);
  assert.ok(database.parsedStates().filter(row => row.state.kind === "counter").every(row => row.state.dayCount === Number.MAX_SAFE_INTEGER));
  for (const estimatedMicroUsd of [0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await guard.reserve(reservation(3, { estimatedMicroUsd }))).reason, "invalid_estimate");
  }
});

test("an unlimited daily policy requires a valid explicit static namespace and configured operational protection", async () => {
  for (const options of [
    { dailyLimits: "unlimited" }, { usageNamespace: "", dailyLimits: "unlimited" }, { usageNamespace: null, dailyLimits: "unlimited" },
    { usageNamespace: "user supplied", dailyLimits: "unlimited" }, { usageNamespace: "x".repeat(33), dailyLimits: "unlimited" },
    { usageNamespace: "wattzun", dailyLimits: "other" }, { usageNamespace: "wattzun", dailyLimits: "unlimited", env: { SURGE_GLOBAL_MINUTE_LIMIT: undefined } },
  ]) {
    const { guard, database } = fixture(options);
    assert.deepEqual(await guard.reserve(reservation(1)), { allowed: false, reason: "configuration" });
    assert.equal(database.rows.size, 0);
  }
  const configured = fixture({ usageNamespace: "wattzun", env: { SURGE_CLIENT_DAILY_LIMIT: "1" } });
  const input = reservation(1), first = await configured.guard.reserve(input);
  assert.equal(first.allowed, true); await first.release();
  assert.equal((await configured.guard.reserve(reservation(2, { clientKey: input.clientKey }))).reason, "client_day");
});

test("admission uses one shared snapshot read and one atomic write, including mixed existing rows", async () => {
  const { database, guard } = fixture();
  const first = await guard.reserve(reservation(1));
  assert.equal(first.allowed, true);
  assert.deepEqual(database.calls, ["all", "run"]);
  assert.deepEqual(database.writeChanges, [3]);
  database.calls.length = 0;
  const next = await guard.reserve(reservation(2));
  assert.equal(next.allowed, true);
  assert.deepEqual(database.calls, ["all", "run"]);
  assert.deepEqual(database.writeChanges, [3, 3]);
  assert.equal(database.rows.size, 5);
  assert.equal(database.globalState().minuteCount, 2);
  assert.equal(database.globalState().dailyReservedMicroUsd, 2);
  await first.release();
  await next.release();
});

test("all quota denials and duplicates leave every stored state unchanged", async (t) => {
  const cases = [
    ["client_minute", "SURGE_CLIENT_MINUTE_LIMIT", "clientKey"],
    ["client_day", "SURGE_CLIENT_DAILY_LIMIT", "clientKey"],
    ["network_minute", "SURGE_NETWORK_MINUTE_LIMIT", "networkKey"],
    ["network_day", "SURGE_NETWORK_DAILY_LIMIT", "networkKey"],
    ["global_minute", "SURGE_GLOBAL_MINUTE_LIMIT"],
    ["global_in_flight", "SURGE_GLOBAL_INFLIGHT_LIMIT"],
    ["global_daily_budget", "SURGE_GLOBAL_DAILY_MICRO_USD"],
    ["duplicate_request"],
  ];
  for (const [reason, limit, sharedKey] of cases) {
    await t.test(reason, async () => {
      const { database, guard } = fixture({ env: limit ? { [limit]: "1" } : {} });
      const input = reservation(1);
      assert.equal((await guard.reserve(input)).allowed, true);
      const before = database.parsedStates();
      const callsBefore = database.calls.length;
      const denied = await guard.reserve(reason === "duplicate_request" ? input : reservation(2,
        sharedKey ? { [sharedKey]: input[sharedKey] } : {}));
      assert.equal(denied.allowed, false);
      assert.equal(denied.reason, reason);
      assert.ok(denied.retryAfterSeconds >= 1);
      assert.deepEqual(database.parsedStates(), before);
      assert.deepEqual(database.calls.slice(callsBefore), ["all"]);
    });
  }
});

test("a changed or newly inserted row blocks all three writes before a fresh CAS retry", async (t) => {
  for (const [scope, offset] of [["client", 0], ["network", 5], ["global", 10]]) {
    for (const absent of [false, true]) {
      await t.test(`${scope} ${absent ? "absent-row insertion" : "version collision"}`, async () => {
        const { database, guard } = fixture();
        const input = reservation(1);
        assert.equal((await guard.reserve(input)).allowed, true);
        const originalRows = database.parsedStates();
        const targetHash = scope === "global"
          ? originalRows.find((row) => row.state.kind === "global").scopeHash
          : null;
        // The next write supplies authoritative ordered scope hashes. To make a
        // mixed snapshot, first capture them from the initial atomic statement.
        const scopeHashes = [];
        database.beforeRun = (_sql, values) => {
          scopeHashes.push(values[0], values[5], values[10]);
          database.beforeRun = null;
        };
        assert.equal((await guard.reserve(reservation(2, {
          clientKey: input.clientKey, networkKey: input.networkKey,
        }))).allowed, true);
        const scopeHash = targetHash || scopeHashes[offset / 5];
        if (absent) database.sqlite.prepare("DELETE FROM surge_model_usage_state WHERE scope_hash = ?").run(scopeHash);
        const beforeRace = database.parsedStates();
        const writesBefore = database.writeChanges.length;
        let racedSnapshot;
        database.beforeRun = (_sql, values) => {
          database.beforeRun = null;
          assert.equal(values[offset], scopeHash);
          if (absent) {
            assert.equal(values[offset + 2], null);
            const inserted = JSON.parse(values[offset + 1]);
            inserted.minuteCount = 0;
            if (inserted.kind === "counter") inserted.dayCount = 0;
            else { inserted.dailyReservedMicroUsd = 0; inserted.leases = []; inserted.requests = []; }
            database.sqlite.prepare("INSERT INTO surge_model_usage_state VALUES (?, ?, 0, ?)")
              .run(scopeHash, JSON.stringify(inserted), START);
          } else {
            database.sqlite.prepare("UPDATE surge_model_usage_state SET version = version + 1 WHERE scope_hash = ?")
              .run(scopeHash);
          }
          racedSnapshot = database.parsedStates();
          for (const row of beforeRace.filter((row) => row.scopeHash !== scopeHash)) {
            assert.deepEqual(racedSnapshot.find((value) => value.scopeHash === row.scopeHash), row);
          }
        };
        database.afterRun = (result) => {
          database.afterRun = null;
          assert.equal(Number(result.changes), 0);
          assert.deepEqual(database.parsedStates(), racedSnapshot);
        };
        const result = await guard.reserve(reservation(3, { clientKey: input.clientKey, networkKey: input.networkKey }));
        assert.equal(result.allowed, true);
        assert.deepEqual(database.writeChanges.slice(writesBefore), [0, 3]);
        for (const row of database.parsedStates()) {
          const raced = racedSnapshot.find((value) => value.scopeHash === row.scopeHash);
          assert.equal(row.state.minuteCount, raced.state.minuteCount + 1);
          assert.equal(row.version, raced.version + 1);
          if (row.state.kind === "counter") assert.equal(row.state.dayCount, raced.state.dayCount + 1);
          else assert.equal(row.state.dailyReservedMicroUsd, raced.state.dailyReservedMicroUsd + 1);
        }
      });
    }
  }
});

test("collision retries recheck newly exhausted quotas without partial debits", async () => {
  const { database, guard } = fixture({ env: { SURGE_NETWORK_MINUTE_LIMIT: "2" } });
  const input = reservation(1);
  assert.equal((await guard.reserve(input)).allowed, true);
  let afterCompetitor;
  database.beforeRun = (_sql, values) => {
    database.beforeRun = null;
    const networkHash = values[5];
    const network = database.rows.get(networkHash);
    const state = JSON.parse(network.state_json);
    state.minuteCount = 2;
    state.dayCount = 2;
    database.sqlite.prepare("UPDATE surge_model_usage_state SET state_json = ?, version = version + 1 WHERE scope_hash = ?")
      .run(JSON.stringify(state), networkHash);
    afterCompetitor = database.parsedStates();
  };
  const denied = await guard.reserve(reservation(2, { clientKey: input.clientKey, networkKey: input.networkKey }));
  assert.equal(denied.reason, "network_minute");
  assert.deepEqual(database.writeChanges, [3, 0]);
  assert.deepEqual(database.parsedStates(), afterCompetitor);
});

test("write failure rolls back the SQLite statement and corrupt snapshots fail closed", async (t) => {
  await t.test("a last-row trigger failure leaves both earlier counter writes uncommitted", async () => {
    const { database, guard } = fixture();
    database.sqlite.exec(`CREATE TRIGGER reject_global BEFORE INSERT ON surge_model_usage_state
      WHEN json_extract(NEW.state_json, '$.kind') = 'global'
      BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    assert.deepEqual(await guard.reserve(reservation(1)), { allowed: false, reason: "unavailable" });
    assert.equal(database.rows.size, 0);
    assert.deepEqual(database.calls, ["all", "run"]);
  });
  await t.test("invalid counter JSON does not permit either other quota to advance", async () => {
    const { database, guard } = fixture();
    const input = reservation(1);
    assert.equal((await guard.reserve(input)).allowed, true);
    const counter = database.parsedStates().find((row) => row.state.kind === "counter");
    database.sqlite.prepare("UPDATE surge_model_usage_state SET state_json = ? WHERE scope_hash = ?")
      .run('{"kind":"counter"}', counter.scopeHash);
    const before = database.rows;
    assert.deepEqual(await guard.reserve(reservation(2, { clientKey: input.clientKey, networkKey: input.networkKey })),
      { allowed: false, reason: "unavailable" });
    assert.deepEqual(database.rows, before);
  });
  await t.test("D1 write acknowledgement must represent all three updates", async () => {
    for (const acknowledgement of [{ success: false, meta: { changes: 3 } }, { success: true, meta: { changes: 1 } }]) {
      const { database, guard } = fixture();
      const prepare = database.prepare.bind(database);
      database.prepare = (sql) => sql.trim().startsWith("WITH proposed")
        ? { bind: () => ({ run: async () => acknowledgement }) } : prepare(sql);
      assert.deepEqual(await guard.reserve(reservation(1)), { allowed: false, reason: "unavailable" });
      assert.equal(database.rows.size, 0);
    }
  });
});

test("local Workers D1 preserves atomic mixed-state admission, stale versions and duplicate races", async (t) => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: "2026-05-01", d1Databases: ["DB"] });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database("DB");
  await db.batch(migration.split("--> statement-breakpoint").map((sql) => db.prepare(sql.trim())));
  let collision = null;
  const writeChanges = [];
  const proxy = {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return { bind: (...values) => {
        const bound = statement.bind(...values);
        return {
          first: () => bound.first(), all: () => bound.all(),
          run: async () => {
            if (collision !== null && sql.trim().startsWith("WITH proposed")) {
              const offset = collision;
              collision = null;
              const before = (await db.prepare("SELECT * FROM surge_model_usage_state ORDER BY scope_hash").all()).results;
              await db.prepare("UPDATE surge_model_usage_state SET version = version + 1 WHERE scope_hash = ?").bind(values[offset]).run();
              const raced = (await db.prepare("SELECT * FROM surge_model_usage_state ORDER BY scope_hash").all()).results;
              const result = await bound.run();
              assert.equal(result.meta.changes, 0);
              assert.equal(raced.length, before.length);
              assert.deepEqual((await db.prepare("SELECT * FROM surge_model_usage_state ORDER BY scope_hash").all()).results, raced);
              writeChanges.push(result.meta.changes);
              return result;
            }
            const result = await bound.run();
            if (sql.trim().startsWith("WITH proposed")) writeChanges.push(result.meta.changes);
            return result;
          },
        };
      } };
    },
  };
  const { guard } = fixture({ database: proxy });
  const initial = await guard.reserve(reservation(1));
  assert.equal(initial.allowed, true);
  collision = 10;
  const input = reservation(2);
  const raced = await guard.reserve(input);
  assert.equal(raced.allowed, true);
  assert.deepEqual(writeChanges, [3, 0, 3]);
  // Each later collision mixes an existing counter with one absent counter.
  // The failed statement must neither create the absent one nor debit global.
  const clientInput = reservation(4, { clientKey: reservation(1).clientKey });
  collision = 0;
  const clientRace = await guard.reserve(clientInput);
  assert.equal(clientRace.allowed, true);
  const networkInput = reservation(5, { networkKey: reservation(1).networkKey });
  collision = 5;
  const networkRace = await guard.reserve(networkInput);
  assert.equal(networkRace.allowed, true);
  assert.deepEqual(writeChanges, [3, 0, 3, 0, 3, 0, 3]);
  await initial.release();
  await raced.release();
  await clientRace.release();
  await networkRace.release();
  const duplicates = await concurrentBurst(guard, 12, () => reservation(3));
  assert.equal(admitted(duplicates).length, 1);
  assert.ok(duplicates.filter((result) => !result.allowed).every((result) => result.reason === "duplicate_request"));
  const rows = (await db.prepare("SELECT state_json FROM surge_model_usage_state").all()).results.map((row) => JSON.parse(row.state_json));
  assert.equal(rows.filter((row) => row.kind === "counter").length, 8);
  const global = rows.find((row) => row.kind === "global");
  assert.equal(global.minuteCount, 5);
  assert.equal(global.dailyReservedMicroUsd, 5);
  assert.equal(global.leases.length, 1);
  assert.equal(global.requests.length, 5);
  const beforeFailure = (await db.prepare("SELECT * FROM surge_model_usage_state ORDER BY scope_hash").all()).results;
  await db.prepare(`CREATE TRIGGER reject_global BEFORE INSERT ON surge_model_usage_state
    WHEN json_extract(NEW.state_json, '$.kind') = 'global'
    BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`).run();
  assert.deepEqual(await guard.reserve(reservation(6)), { allowed: false, reason: "unavailable" });
  assert.deepEqual((await db.prepare("SELECT * FROM surge_model_usage_state ORDER BY scope_hash").all()).results, beforeFailure);
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
  const statesBeforeDenial = database.parsedStates();

  const deniedInput = reservation(2);
  const denied = await guard.reserve(deniedInput);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "global_in_flight");

  const counterStates = database.parsedStates()
    .filter((row) => row.state.kind === "counter")
    .map((row) => row.state);
  assert.equal(counterStates.length, 2);
  assert.ok(counterStates.every((state) => state.minuteCount === 1 && state.dayCount === 1));
  assert.deepEqual(database.parsedStates(), statesBeforeDenial);

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
    const database = new SqliteD1Database();
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
      const guard = createSharedSurgeUsageGuard({ env, getDatabase: () => new SqliteD1Database() });
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
      getDatabase: () => new SqliteD1Database(),
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
    const failing = fixture({ database: new SqliteD1Database({ fail: true }) }).guard;
    assert.deepEqual(await failing.reserve(reservation(2)), {
      allowed: false,
      reason: "unavailable",
    });
  });

  await t.test("CAS contention exhaustion", async () => {
    const { database, guard } = fixture({ database: new SqliteD1Database({ conflict: true }) });
    assert.deepEqual(await guard.reserve(reservation(3)), {
      allowed: false,
      reason: "unavailable",
    });
    assert.equal(database.calls.filter((call) => call === "all").length, 16);
    assert.equal(database.calls.filter((call) => call === "run").length, 16);
    assert.equal(database.rows.size, 0);
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
