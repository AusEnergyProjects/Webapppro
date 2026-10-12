// Public CDR directory, plan lists and contract details contain no customer data.
// Reuse these identical upstream resources across postcode lookups for five
// minutes. Callers still validate current offer dates, eligibility and tariffs.
export const ENERGY_CDR_UPSTREAM_CACHE_SECONDS = 300;

export function energyCdrCacheOptions(url, version) {
  const key = new URL(url);
  key.searchParams.set("__aea_cdr_version", version || "directory");
  return {
    cacheEverything: true,
    cacheKey: key.href,
    cacheTtlByStatus: {
      "200-299": ENERGY_CDR_UPSTREAM_CACHE_SECONDS,
      "300-599": -1,
    },
  };
}
