import { GAS_HISTORY_MS, GAS_MARKETS, isGasSnapshot, normaliseDwgmGas, normaliseSttmGas } from "./gas-wholesale.ts";
import type { GasRegion, GasSnapshot } from "./gas-wholesale.ts";

export const GAS_STTM_URL = "https://visualisations.aemo.com.au/aemo/data/STTM/WEB_STTM_PRICE_AND_DEMAND.csv";
export const GAS_DWGM_URL = "https://visualisations.aemo.com.au/aemo/data/DWGM/WEB_DWGM_PRICE_AND_DEMAND.CSV";
const CACHE_FRESH_MS = 5 * 60_000;
const CACHE_RETAIN_MS = 36 * 60 * 60_000;
type SourceFetch = (url: string, init?: RequestInit) => Promise<Response>;
type MarketCache = Pick<Cache, "match" | "put">;

export async function runtimeGasCache(cacheStorage: Pick<CacheStorage, "open"> | undefined = typeof caches === "undefined" ? undefined : caches): Promise<MarketCache | undefined> {
  return cacheStorage?.open("aea-gas-wholesale-v1");
}

async function readGasSource(fetchImpl: SourceFetch, url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "text/csv, text/plain, application/octet-stream" }, signal });
  if (!response.ok) throw new Error(`Gas market source returned HTTP ${response.status}`);
  if (Number(response.headers.get("Content-Length")) > 500_000) throw new Error("Gas market response exceeded size limit");
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType && !["text/csv", "text/plain", "application/octet-stream"].includes(contentType)) throw new Error("Unexpected gas market content type");
  const text = await response.text();
  if (text.length > 500_000) throw new Error("Gas market response exceeded size limit");
  return text;
}

function emptyRegions(): GasRegion[] {
  return GAS_MARKETS.map(({ regionId }) => ({ id: regionId, points: [] }));
}

export async function loadGasSnapshot(options: { fetchImpl?: SourceFetch; now?: number; cache?: MarketCache; cacheKey?: Request } = {}): Promise<GasSnapshot> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let saved: GasSnapshot | null = null;
  if (options.cache && options.cacheKey) {
    try {
      const response = await options.cache.match(options.cacheKey);
      const candidate: unknown = response ? await response.json() : null;
      if (isGasSnapshot(candidate) && candidate.fetchedAt <= now && now - candidate.fetchedAt < CACHE_RETAIN_MS) saved = candidate;
    } catch { console.warn("Gas market cache read unavailable"); }
  }
  if (saved && !saved.refreshFailed && now - saved.fetchedAt < CACHE_FRESH_MS) return saved;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10_000);
  try {
    const [sttm, dwgm] = await Promise.allSettled([
      readGasSource(fetchImpl, GAS_STTM_URL, controller.signal).then((csv) => normaliseSttmGas(csv, now)),
      readGasSource(fetchImpl, GAS_DWGM_URL, controller.signal).then((csv) => normaliseDwgmGas(csv, now)),
    ]);
    if (sttm.status === "rejected" && dwgm.status === "rejected") {
      if (saved) return { ...saved, refreshFailed: true, failedSources: ["sttm", "dwgm"] };
      throw sttm.reason;
    }

    const regions = emptyRegions();
    const applyRegion = (incoming: GasRegion) => {
      const target = regions.find((region) => region.id === incoming.id)!;
      target.points = incoming.points.filter((point) => point.time >= now - GAS_HISTORY_MS);
    };
    if (sttm.status === "fulfilled") sttm.value.forEach(applyRegion);
    if (dwgm.status === "fulfilled") applyRegion(dwgm.value);

    const failedSources = [sttm.status === "rejected" ? "sttm" : null, dwgm.status === "rejected" ? "dwgm" : null].filter((source): source is "sttm" | "dwgm" => source !== null);
    const snapshot: GasSnapshot = { fetchedAt: now, regions, refreshFailed: failedSources.length > 0, failedSources };
    if (!isGasSnapshot(snapshot)) throw new Error("No current gas market prices");
    if (options.cache && options.cacheKey) {
      try { await options.cache.put(options.cacheKey, Response.json(snapshot, { headers: { "Cache-Control": "public, max-age=129600" } })); }
      catch { console.warn("Gas market cache write unavailable"); }
    }
    return snapshot;
  } catch (error) {
    if (saved) return { ...saved, refreshFailed: true, failedSources: ["sttm", "dwgm"] };
    throw error;
  } finally { clearTimeout(deadline); }
}
