import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryLeadRateLimiter,
  createSharedLeadRateLimiter,
  LEAD_RATE_LIMIT,
  LEAD_RATE_WINDOW_MS,
} from "../src/lib/lead-rate-limit.mjs";

const SECRET = "test-only-secret-with-at-least-32-characters";

function createAtomicDatabase() {
  const entries = new Map();

  return {
    entries,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              await Promise.resolve();
              if (!sql.includes("SELECT timestamps, version")) throw new Error(`Unexpected query: ${sql}`);
              return structuredClone(entries.get(values[0]) || null);
            },
            async run() {
              await Promise.resolve();
              if (sql.includes("INSERT OR IGNORE")) {
                const [clientHash, timestamps, updatedAt] = values;
                if (entries.has(clientHash)) return { meta: { changes: 0 } };
                entries.set(clientHash, { timestamps, version: 0, updated_at: updatedAt });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE lead_rate_limits")) {
                const [timestamps, updatedAt, clientHash, version] = values;
                const existing = entries.get(clientHash);
                if (!existing || existing.version !== version) return { meta: { changes: 0 } };
                entries.set(clientHash, {
                  timestamps,
                  version: existing.version + 1,
                  updated_at: updatedAt,
                });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected statement: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test("memory limiter enforces the rolling window and reports retry timing", async () => {
  let time = 1_800_000_000_000;
  const limiter = createMemoryLeadRateLimiter({ now: () => time });

  for (let request = 0; request < LEAD_RATE_LIMIT; request += 1) {
    assert.deepEqual(await limiter.check("client"), { allowed: true });
  }

  assert.deepEqual(await limiter.check("client"), {
    allowed: false,
    retryAfterSeconds: LEAD_RATE_WINDOW_MS / 1000,
  });

  time += LEAD_RATE_WINDOW_MS;
  assert.deepEqual(await limiter.check("client"), { allowed: true });
});

test("shared limiter atomically allows only five simultaneous requests", async () => {
  const database = createAtomicDatabase();
  const limiter = createSharedLeadRateLimiter({
    env: { NODE_ENV: "production", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    now: () => 1_800_000_000_000,
    getDatabase: () => database,
  });

  const results = await Promise.all(
    Array.from({ length: LEAD_RATE_LIMIT + 1 }, () => limiter.check("203.0.113.42")),
  );

  assert.equal(results.filter((result) => result.allowed).length, LEAD_RATE_LIMIT);
  assert.equal(results.filter((result) => !result.allowed && !result.unavailable).length, 1);
  const [storedKey] = database.entries.keys();
  assert.match(storedKey, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(storedKey, /203\.0\.113\.42/);
  assert.equal(JSON.parse(database.entries.get(storedKey).timestamps).length, LEAD_RATE_LIMIT);
});

test("shared limiter expires old requests and isolates clients", async () => {
  let time = 1_800_000_000_000;
  const database = createAtomicDatabase();
  const limiter = createSharedLeadRateLimiter({
    env: { NODE_ENV: "production", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    now: () => time,
    getDatabase: () => database,
  });

  for (let request = 0; request < LEAD_RATE_LIMIT; request += 1) {
    assert.equal((await limiter.check("client-a")).allowed, true);
  }
  assert.equal((await limiter.check("client-a")).allowed, false);
  assert.equal((await limiter.check("client-b")).allowed, true);

  time += LEAD_RATE_WINDOW_MS;
  assert.equal((await limiter.check("client-a")).allowed, true);
  assert.equal(database.entries.size, 2);
});

test("production limiter fails closed when its secret or durable store is unavailable", async () => {
  const missingSecret = createSharedLeadRateLimiter({
    env: { NODE_ENV: "production" },
    getDatabase: () => assert.fail("database should not be opened without a secret"),
  });
  assert.deepEqual(await missingSecret.check("client"), { allowed: false, unavailable: true });

  const failedStore = createSharedLeadRateLimiter({
    env: { NODE_ENV: "production", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    getDatabase: () => ({
      prepare() {
        throw new Error("storage unavailable");
      },
    }),
  });
  assert.deepEqual(await failedStore.check("client"), { allowed: false, unavailable: true });
});

test("local development uses isolated memory without opening D1", async () => {
  const limiter = createSharedLeadRateLimiter({
    env: { NODE_ENV: "development" },
    getDatabase: () => assert.fail("local fallback should not open D1"),
  });

  assert.equal(limiter.mode, "memory");
  assert.equal((await limiter.check("local-client")).allowed, true);
});
