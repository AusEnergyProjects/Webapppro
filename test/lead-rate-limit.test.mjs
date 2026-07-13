import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryLeadRateLimiter,
  createSharedLeadRateLimiter,
  LEAD_RATE_LIMIT,
  LEAD_RATE_WINDOW_MS,
} from "../src/lib/lead-rate-limit.mjs";

const SECRET = "test-only-secret-with-at-least-32-characters";

function createAtomicStore() {
  const entries = new Map();
  let version = 0;

  return {
    entries,
    async getWithMetadata(key) {
      await Promise.resolve();
      const entry = entries.get(key);
      if (!entry) return null;
      return {
        data: structuredClone(entry.data),
        etag: entry.etag,
        metadata: {},
      };
    },
    async setJSON(key, data, options = {}) {
      await Promise.resolve();
      const existing = entries.get(key);
      if (options.onlyIfNew && existing) return { modified: false };
      if (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      if (options.onlyIfMatch && !existing) return { modified: false };

      version += 1;
      const etag = `etag-${version}`;
      entries.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
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
  const store = createAtomicStore();
  const storeOptions = [];
  const limiter = createSharedLeadRateLimiter({
    env: { NETLIFY: "true", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    now: () => 1_800_000_000_000,
    getStoreImpl(options) {
      storeOptions.push(options);
      return store;
    },
  });

  const results = await Promise.all(
    Array.from({ length: LEAD_RATE_LIMIT + 1 }, () => limiter.check("203.0.113.42")),
  );

  assert.equal(results.filter((result) => result.allowed).length, LEAD_RATE_LIMIT);
  assert.equal(results.filter((result) => !result.allowed && !result.unavailable).length, 1);
  assert.ok(storeOptions.every((options) => options.name === "aea-lead-rate-limit"));
  assert.ok(storeOptions.every((options) => options.consistency === "strong"));

  const [storedKey] = store.entries.keys();
  assert.match(storedKey, /^v1\/[a-f0-9]{40}$/);
  assert.doesNotMatch(storedKey, /203\.0\.113\.42/);
  assert.equal(store.entries.get(storedKey).data.timestamps.length, LEAD_RATE_LIMIT);
});

test("shared limiter expires old requests and isolates clients", async () => {
  let time = 1_800_000_000_000;
  const store = createAtomicStore();
  const limiter = createSharedLeadRateLimiter({
    env: { NETLIFY: "true", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    now: () => time,
    getStoreImpl: () => store,
  });

  for (let request = 0; request < LEAD_RATE_LIMIT; request += 1) {
    assert.equal((await limiter.check("client-a")).allowed, true);
  }
  assert.equal((await limiter.check("client-a")).allowed, false);
  assert.equal((await limiter.check("client-b")).allowed, true);

  time += LEAD_RATE_WINDOW_MS;
  assert.equal((await limiter.check("client-a")).allowed, true);
  assert.equal(store.entries.size, 2);
});

test("production limiter fails closed when its secret or durable store is unavailable", async () => {
  const missingSecret = createSharedLeadRateLimiter({
    env: { NETLIFY: "true" },
    getStoreImpl: () => assert.fail("store should not be opened without a secret"),
  });
  assert.deepEqual(await missingSecret.check("client"), { allowed: false, unavailable: true });

  const failedStore = createSharedLeadRateLimiter({
    env: { NETLIFY: "true", AEA_LEAD_RATE_LIMIT_SECRET: SECRET },
    getStoreImpl: () => ({
      async getWithMetadata() {
        throw new Error("storage unavailable");
      },
    }),
  });
  assert.deepEqual(await failedStore.check("client"), { allowed: false, unavailable: true });
});

test("local development uses isolated memory without opening Netlify Blobs", async () => {
  const limiter = createSharedLeadRateLimiter({
    env: {},
    getStoreImpl: () => assert.fail("local fallback should not open Netlify Blobs"),
  });

  assert.equal(limiter.mode, "memory");
  assert.equal((await limiter.check("local-client")).allowed, true);
});
