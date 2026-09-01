import test from 'node:test';
import assert from 'node:assert/strict';

import { createElectricityPlanCache } from '../src/lib/electricity-plan-cache.mjs';

function planResult(planId) {
  return {
    plans: [{ planId }],
    fetchedAt: '2026-09-02T00:00:00.000Z',
    source: { partial: false },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('cache coalesces concurrent cold loads for the same postcode and customer type', async () => {
  const request = deferred();
  let loads = 0;
  const cache = createElectricityPlanCache({
    loadPlans: async () => {
      loads += 1;
      return request.promise;
    },
  });

  const first = cache.get('3000', 'RESIDENTIAL');
  const second = cache.get('3000', 'RESIDENTIAL');
  request.resolve(planResult('first'));
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(loads, 1);
  assert.equal(firstResult.cache, 'miss');
  assert.equal(secondResult.cache, 'coalesced');
  assert.equal(firstResult.result.plans[0].planId, 'first');
  assert.equal(secondResult.result.plans[0].planId, 'first');
});

test('cache serves a bounded last-known-good result when a stale refresh fails', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createElectricityPlanCache({
    now: () => clock,
    freshTtlMs: 1_000,
    maxStaleMs: 5_000,
    loadPlans: async () => {
      loads += 1;
      if (loads === 1) return planResult('known-good');
      throw new Error('retailer unavailable');
    },
  });

  await cache.get('3000', 'RESIDENTIAL');
  clock = 1_500;
  const fallback = await cache.get('3000', 'RESIDENTIAL');

  assert.equal(loads, 2);
  assert.equal(fallback.cache, 'last_known_good');
  assert.equal(fallback.result.plans[0].planId, 'known-good');
  assert.equal(fallback.result.source.cacheFallback, true);
  assert.equal(fallback.result.source.cacheFallbackAgeSeconds, 1);
  assert.equal(fallback.result.source.cacheRefreshInProgress, false);
  assert.equal(fallback.result.source.partial, true);
});

test('cache rejects a refresh failure after the last-known-good window expires', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createElectricityPlanCache({
    now: () => clock,
    freshTtlMs: 1_000,
    maxStaleMs: 5_000,
    loadPlans: async () => {
      loads += 1;
      if (loads === 1) return planResult('expired');
      throw Object.assign(new Error('retailer unavailable'), { code: 'ELECTRICITY_UPSTREAM_TIMEOUT' });
    },
  });

  await cache.get('3000', 'RESIDENTIAL');
  clock = 5_001;

  await assert.rejects(
    () => cache.get('3000', 'RESIDENTIAL'),
    (error) => error.code === 'ELECTRICITY_UPSTREAM_TIMEOUT',
  );
  assert.equal(loads, 2);
});

test('a successful stale refresh replaces the previous cached result', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createElectricityPlanCache({
    now: () => clock,
    freshTtlMs: 1_000,
    maxStaleMs: 5_000,
    loadPlans: async () => {
      loads += 1;
      return planResult(loads === 1 ? 'old' : 'new');
    },
  });

  const initial = await cache.get('3000', 'RESIDENTIAL');
  clock = 1_500;
  const refreshed = await cache.get('3000', 'RESIDENTIAL');
  const hit = await cache.get('3000', 'RESIDENTIAL');

  assert.equal(initial.cache, 'miss');
  assert.equal(refreshed.cache, 'refresh');
  assert.equal(refreshed.result.plans[0].planId, 'new');
  assert.equal(hit.cache, 'memory_hit');
  assert.equal(hit.result.plans[0].planId, 'new');
  assert.equal(loads, 2);
});

test('an empty refresh is not stored as a successful cache value', async () => {
  let loads = 0;
  const cache = createElectricityPlanCache({
    loadPlans: async () => {
      loads += 1;
      return { plans: [], source: { partial: true } };
    },
  });

  await assert.rejects(
    () => cache.get('3000', 'RESIDENTIAL'),
    (error) => error.code === 'NO_USABLE_ELECTRICITY_PLANS',
  );
  await assert.rejects(
    () => cache.get('3000', 'RESIDENTIAL'),
    (error) => error.code === 'NO_USABLE_ELECTRICITY_PLANS',
  );
  assert.equal(loads, 2);
  assert.equal(cache.size(), 0);
});
