export const ELECTRICITY_PLAN_CACHE_TTL_MS = 60 * 60 * 1_000;
export const ELECTRICITY_PLAN_CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 120;

function cacheKey(postcode, customerType) {
  return postcode + ":" + customerType;
}

function usableResult(result) {
  return Array.isArray(result?.plans) && result.plans.length > 0;
}

function noUsablePlansError() {
  const error = new Error("The electricity-plan refresh returned no usable plans.");
  error.code = "NO_USABLE_ELECTRICITY_PLANS";
  return error;
}

function fallbackResult(result, ageMs, refreshInProgress) {
  return {
    ...result,
    source: {
      ...result.source,
      partial: true,
      cacheFallback: true,
      cacheFallbackAgeSeconds: Math.max(0, Math.floor(ageMs / 1_000)),
      cacheRefreshInProgress: refreshInProgress,
    },
  };
}

export function createElectricityPlanCache({
  loadPlans,
  now = Date.now,
  freshTtlMs = ELECTRICITY_PLAN_CACHE_TTL_MS,
  maxStaleMs = ELECTRICITY_PLAN_CACHE_MAX_STALE_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
}) {
  if (typeof loadPlans !== "function") throw new TypeError("loadPlans is required.");
  const entries = new Map();

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function prune() {
    while (entries.size > maxEntries) {
      const removable = [...entries.entries()].find(([, entry]) => !entry.inFlight);
      if (!removable) return;
      entries.delete(removable[0]);
    }
  }

  function currentFallback(entry, refreshInProgress) {
    if (!entry?.lastSuccess) return null;
    const ageMs = now() - entry.lastSuccess.createdAt;
    if (ageMs > maxStaleMs) return null;
    return fallbackResult(entry.lastSuccess.result, ageMs, refreshInProgress);
  }

  function beginRefresh(key, postcode, customerType, previousEntry) {
    const entry = {
      lastSuccess: previousEntry?.lastSuccess || null,
      inFlight: null,
    };
    const inFlight = Promise.resolve()
      .then(() => loadPlans({ postcode, customerType }))
      .then((result) => {
        if (!usableResult(result)) throw noUsablePlansError();
        const completed = {
          lastSuccess: { result, createdAt: now() },
          inFlight: null,
        };
        touch(key, completed);
        prune();
        return result;
      })
      .catch((error) => {
        const current = entries.get(key);
        if (current?.inFlight === inFlight) {
          if (current.lastSuccess) touch(key, { lastSuccess: current.lastSuccess, inFlight: null });
          else entries.delete(key);
        }
        throw error;
      });
    entry.inFlight = inFlight;
    touch(key, entry);
    prune();
    return inFlight;
  }

  async function get(postcode, customerType) {
    const key = cacheKey(postcode, customerType);
    const existing = entries.get(key);
    if (existing?.lastSuccess && now() - existing.lastSuccess.createdAt < freshTtlMs) {
      touch(key, existing);
      return { result: existing.lastSuccess.result, cache: "memory_hit" };
    }
    if (existing?.inFlight) {
      const fallback = currentFallback(existing, true);
      if (fallback) return { result: fallback, cache: "last_known_good_refreshing" };
      return { result: await existing.inFlight, cache: "coalesced" };
    }

    const inFlight = beginRefresh(key, postcode, customerType, existing);
    try {
      return { result: await inFlight, cache: existing?.lastSuccess ? "refresh" : "miss" };
    } catch (error) {
      const fallback = currentFallback(entries.get(key), false);
      if (fallback) return { result: fallback, cache: "last_known_good" };
      throw error;
    }
  }

  return {
    clear: () => entries.clear(),
    get,
    size: () => entries.size,
  };
}
