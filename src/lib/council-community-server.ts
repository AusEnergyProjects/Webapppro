import { CER_COMMUNITY_URL, COMMUNITY_METRICS, isCommunitySnapshot, parseCerPostcodeCsv } from "./council-community.ts";
import type { CommunitySnapshot, CouncilCommunityReport } from "./council-community.ts";

type SourceFetch = (url: string, init?: RequestInit) => Promise<Response>;
type CommunityCache = Pick<Cache, "match" | "put">;
type SavedCommunity = { snapshot: CommunitySnapshot; checkedAt: string; refreshFailed: boolean };
export type LoadedCommunity = SavedCommunity & { dataOrigin: CouncilCommunityReport["dataOrigin"] };
const CACHE_KEY = new Request("https://council-community.internal/cer-snapshot-v1");
const REFRESH_MS = 12 * 60 * 60_000;
const RETRY_MS = 60 * 60_000;
const RETAIN_SECONDS = 90 * 86400;

export async function runtimeCommunityCache(storage: Pick<CacheStorage, "open"> | undefined = typeof caches === "undefined" ? undefined : caches): Promise<CommunityCache | undefined> {
  try { return await storage?.open("aea-council-community-v1"); }
  catch { console.warn("Community data cache unavailable"); return undefined; }
}

async function sourceBytes(fetchImpl: SourceFetch, url: string, signal: AbortSignal, isPage = false): Promise<Uint8Array> {
  const allowed = url === CER_COMMUNITY_URL || COMMUNITY_METRICS.some(metric => url === `https://cer.gov.au/document/${metric.path}`);
  if (!allowed) throw new Error("Unapproved community source");
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal, headers: { Accept: isPage ? "text/html" : "text/csv, application/octet-stream" } });
  if (!response.ok || (response.url && response.url !== url)) throw new Error("Community source unavailable");
  const type = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (!type || !(isPage ? ["text/html"] : ["text/csv", "text/plain", "application/octet-stream"]).includes(type)) throw new Error("Unexpected community source content type");
  const maximum = isPage ? 1_000_000 : 5_000_000;
  if (Number(response.headers.get("Content-Length")) > maximum || !response.body) throw new Error("Community source exceeds size limit");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error("Community source exceeds size limit"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)), byte => byte.toString(16).padStart(2, "0")).join("");

export function cerPageContract(html: string, now = Date.now()): { sourceAsOf: string; urls: string[] } {
  const plain = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ");
  const match = /This data is current as at (\d{1,2}) ([A-Za-z]+) (20\d{2})\./.exec(plain);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (!match || !names.includes(match[2])) throw new Error("CER publication date is missing");
  const date = new Date(Date.UTC(Number(match[3]), names.indexOf(match[2]), Number(match[1])));
  if (date.getUTCDate() !== Number(match[1]) || date.getUTCMonth() !== names.indexOf(match[2]) || date.getTime() > now) throw new Error("Invalid CER publication date");
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (date.getUTCDate() !== lastDay) throw new Error("CER reporting month is incomplete");
  const links = new Set(Array.from(html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi), result => {
    try { return new URL(result[1], CER_COMMUNITY_URL).href; } catch { return ""; }
  }));
  const urls = COMMUNITY_METRICS.map(metric => `https://cer.gov.au/document/${metric.path}`);
  if (urls.some(url => !links.has(url))) throw new Error("CER download catalogue changed");
  return { sourceAsOf: date.toISOString().slice(0, 10), urls };
}

export async function fetchCommunitySnapshot(options: { fetchImpl?: SourceFetch; now?: number; timeoutMs?: number } = {}): Promise<CommunitySnapshot> {
  const now = options.now ?? Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 15_000, 15_000));
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const page = await sourceBytes(fetchImpl, CER_COMMUNITY_URL, controller.signal, true);
    const contract = cerPageContract(new TextDecoder().decode(page), now);
    const datasets = await Promise.all(COMMUNITY_METRICS.map(async (metric, index) => {
      const bytes = await sourceBytes(fetchImpl, contract.urls[index], controller.signal);
      let csv: string;
      // CER's heat-pump export contains Windows-1252 non-breaking spaces despite its UTF-8 header.
      try { csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { csv = new TextDecoder("windows-1252", { fatal: true }).decode(bytes); }
      return { ...parseCerPostcodeCsv(csv, metric.id, contract.sourceAsOf), url: contract.urls[index], sha256: await hash(bytes) };
    }));
    const snapshot: CommunitySnapshot = { version: 1, sourceAsOf: contract.sourceAsOf, fetchedAt: new Date(now).toISOString(), sourcePage: { url: CER_COMMUNITY_URL, sha256: await hash(page) }, datasets };
    if (!isCommunitySnapshot(snapshot)) throw new Error("Invalid CER community snapshot");
    return snapshot;
  } catch (error) { controller.abort(); throw error; }
  finally { clearTimeout(timeout); }
}

export async function bundledCommunitySnapshot(): Promise<CommunitySnapshot> {
  const imported = await import("../data/council-community-baseline.json", { with: { type: "json" } });
  const value: unknown = imported.default;
  if (!isCommunitySnapshot(value)) throw new Error("Invalid saved community baseline");
  return value;
}

export async function loadCommunitySnapshot(options: { fetchImpl?: SourceFetch; now?: number; cache?: CommunityCache; baseline?: CommunitySnapshot; timeoutMs?: number } = {}): Promise<LoadedCommunity> {
  const now = options.now ?? Date.now();
  const baseline = options.baseline ?? await bundledCommunitySnapshot();
  if (!isCommunitySnapshot(baseline) || Date.parse(baseline.fetchedAt) > now || Date.parse(baseline.sourceAsOf) > now) throw new Error("Invalid saved community baseline");
  let saved: SavedCommunity = { snapshot: baseline, checkedAt: baseline.fetchedAt, refreshFailed: false };
  let dataOrigin: LoadedCommunity["dataOrigin"] = "baseline";
  if (options.cache) {
    try {
      const response = await options.cache.match(CACHE_KEY);
      const candidate: unknown = response ? await response.json() : null;
      if (candidate && typeof candidate === "object" && "snapshot" in candidate && isCommunitySnapshot(candidate.snapshot)
        && "checkedAt" in candidate && typeof candidate.checkedAt === "string" && Number.isFinite(Date.parse(candidate.checkedAt))
        && "refreshFailed" in candidate && typeof candidate.refreshFailed === "boolean"
        && Date.parse(candidate.checkedAt) <= now && Date.parse(candidate.snapshot.fetchedAt) <= Date.parse(candidate.checkedAt)
        && candidate.snapshot.sourceAsOf >= baseline.sourceAsOf && now - Date.parse(candidate.checkedAt) < RETAIN_SECONDS * 1000) {
        saved = { snapshot: candidate.snapshot, checkedAt: candidate.checkedAt, refreshFailed: candidate.refreshFailed };
        dataOrigin = "cache";
      }
    } catch { console.warn("Community data cache read unavailable"); }
  }
  // A fresh shipped baseline also avoids repeated external downloads before the first cache entry.
  if (now - Date.parse(saved.checkedAt) < (saved.refreshFailed ? RETRY_MS : REFRESH_MS)) return { ...saved, dataOrigin };
  let next: SavedCommunity;
  try {
    const snapshot = await fetchCommunitySnapshot({ fetchImpl: options.fetchImpl, now, timeoutMs: options.timeoutMs });
    if (snapshot.sourceAsOf < saved.snapshot.sourceAsOf) throw new Error("CER publication date moved backwards");
    next = { snapshot, checkedAt: new Date(now).toISOString(), refreshFailed: false };
    dataOrigin = "live";
  } catch {
    next = { snapshot: saved.snapshot, checkedAt: new Date(now).toISOString(), refreshFailed: true };
  }
  if (options.cache) {
    try { await options.cache.put(CACHE_KEY, Response.json(next, { headers: { "Cache-Control": `public, max-age=${RETAIN_SECONDS}` } })); }
    catch { console.warn("Community data cache write unavailable"); }
  }
  return { ...next, dataOrigin };
}
