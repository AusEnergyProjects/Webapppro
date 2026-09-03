import { isNemSnapshot, normaliseNemFlows, normaliseNemHistory } from "./nem-wholesale.ts";
import type { NemSnapshot } from "./nem-wholesale.ts";

export const NEM_HISTORY_URL = "https://visualisations.aemo.com.au/aemo/apps/api/report/5MIN";
export const NEM_SUMMARY_URL = "https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY";
const CACHE_FRESH_MS = 60_000;
const CACHE_RETAIN_MS = 60 * 60_000;
type SourceFetch = (url: string, init?: RequestInit) => Promise<Response>;
type MarketCache = Pick<Cache, "match" | "put">;

export async function runtimeMarketCache(cacheStorage: Pick<CacheStorage, "open"> | undefined = typeof caches === "undefined" ? undefined : caches): Promise<MarketCache | undefined> {
  // Namespaced Sites Workers cannot use caches.default. A named cache is isolated to this script.
  return cacheStorage?.open("aea-nem-wholesale-v1");
}

async function readSource(fetchImpl: SourceFetch, url: string, signal: AbortSignal, body?: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body } : {}),
    signal,
  });
  if (!response.ok) throw new Error(`AEMO returned HTTP ${response.status}`);
  if (Number(response.headers.get("Content-Length")) > 2_000_000) throw new Error("AEMO response exceeded size limit");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("AEMO response exceeded size limit");
  return JSON.parse(text);
}

export async function loadNemSnapshot(options: { fetchImpl?: SourceFetch; now?: number; cache?: MarketCache; cacheKey?: Request } = {}): Promise<NemSnapshot> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let saved: NemSnapshot | null = null;
  if (options.cache && options.cacheKey) {
    try {
      const response = await options.cache.match(options.cacheKey);
      const candidate: unknown = response ? await response.json() : null;
      if (isNemSnapshot(candidate) && candidate.fetchedAt <= now && now - candidate.fetchedAt < CACHE_RETAIN_MS) saved = candidate;
    } catch { console.warn("Wholesale cache read unavailable"); }
  }
  if (saved && now - saved.fetchedAt < CACHE_FRESH_MS) return saved;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10_000);
  try {
    const [history, summary] = await Promise.allSettled([
      readSource(fetchImpl, NEM_HISTORY_URL, controller.signal, JSON.stringify({ timeScale: ["5MIN"] })),
      readSource(fetchImpl, NEM_SUMMARY_URL, controller.signal),
    ]);
    if (history.status === "rejected") throw history.reason;
    const snapshot: NemSnapshot = {
      ...normaliseNemHistory(history.value, now),
      fetchedAt: now,
      refreshFailed: false,
      flows: summary.status === "fulfilled" ? normaliseNemFlows(summary.value, now) : [],
    };
    if (options.cache && options.cacheKey) {
      try { await options.cache.put(options.cacheKey, Response.json(snapshot, { headers: { "Cache-Control": "public, max-age=3600" } })); }
      catch { console.warn("Wholesale cache write unavailable"); }
    }
    return snapshot;
  } catch (error) {
    if (saved) return { ...saved, refreshFailed: true };
    throw error;
  } finally { clearTimeout(deadline); }
}
