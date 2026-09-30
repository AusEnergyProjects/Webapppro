import type { TradeMapBounds, TradeMapDatasetResponse, TradeMapLocationClaim, TradeMapLocationClaimsResponse, TradeMapLocationSave, TradeMapQuery } from "./trade-map-contract.ts";
import { prepareTradeMapAddress, TRADE_MAP_PIN_LABELS, type TradeMapGeocodeResult } from "./trade-record-map.ts";

export type TradeMapLocationStatus = "all" | "located" | "pending" | "unlocated" | "approximate";

const reservedFilters = new Set(["mode", "resource", "page", "pageSize", "cursor", "mapPage", "mapAddressKey", "mapLocationStatus", "north", "south", "east", "west"]);

/** Register pagination never changes which records belong to a map. */
export function tradeMapQueryUrl(query: TradeMapQuery): string {
  const params = new URLSearchParams({ mode: "map", resource: query.resource });
  for (const key of Object.keys(query.filters).sort()) {
    if (!reservedFilters.has(key) && query.filters[key]) params.set(key, query.filters[key]);
  }
  return `/api/trade-crm?${params}`;
}

export function tradeMapViewportUrl(base: string, options: { bounds: TradeMapBounds | null; page: number; addressKey: string; locationStatus: TradeMapLocationStatus }): string {
  const params = new URLSearchParams(base.split("?")[1]);
  if (options.bounds) for (const key of ["north", "south", "east", "west"] as const) params.set(key, options.bounds[key].toFixed(5));
  params.set("mapPage", String(options.page));
  if (options.addressKey) params.set("mapAddressKey", options.addressKey);
  if (options.locationStatus !== "all") params.set("mapLocationStatus", options.locationStatus);
  return `/api/trade-crm?${params}`;
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function coordinate(value: unknown, limit: number): value is number { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit; }
function position(value: unknown): boolean { return object(value) && coordinate(value.lat, 90) && coordinate(value.lng, 180); }
function bounds(value: unknown): boolean {
  return object(value) && coordinate(value.north, 90) && coordinate(value.south, 90) && value.north >= value.south && coordinate(value.east, 180) && coordinate(value.west, 180);
}
function record(value: unknown): boolean {
  return object(value) && (value.kind === "customer" || value.kind === "job")
    && ["id", "title", "reference", "address", "detail"].every(key => typeof value[key] === "string")
    && (value.jobStatus === undefined || (typeof value.jobStatus === "string" && Object.hasOwn(TRADE_MAP_PIN_LABELS, value.jobStatus)));
}

/** Reject malformed or unexpectedly unbounded responses before creating map DOM. */
export function isTradeMapDatasetResponse(value: unknown): value is TradeMapDatasetResponse {
  if (!object(value) || !["customers", "jobs"].includes(String(value.resource))
    || !["total", "mapped", "approximate", "pending", "unmapped", "inViewport", "listTotal", "page"].every(key => count(value[key]))
    || value.page === 0 || value.pageSize !== 50 || typeof value.hasMore !== "boolean"
    || (value.bounds !== null && !bounds(value.bounds))
    || !Array.isArray(value.items) || value.items.length > 50 || !Array.isArray(value.markers) || value.markers.length > 400) return false;
  return value.items.every(item => record(item) && object(item) && typeof item.addressKey === "string"
    && ["located", "pending", "unlocated"].includes(String(item.locationStatus))
    && (item.position === undefined || position(item.position))
    && (item.approximate === undefined || typeof item.approximate === "boolean"))
    && value.markers.every(marker => object(marker) && typeof marker.id === "string" && count(marker.count) && marker.count > 0
      && position(marker.position) && bounds(marker.bounds) && typeof marker.category === "string" && Object.hasOwn(TRADE_MAP_PIN_LABELS, marker.category)
      && typeof marker.approximate === "boolean" && (marker.record === undefined || record(marker.record))
      && (marker.addressKey === undefined || typeof marker.addressKey === "string"));
}

export function isTradeMapClaimsResponse(value: unknown): value is TradeMapLocationClaimsResponse {
  return object(value) && count(value.retryAfterMs) && Array.isArray(value.claims) && value.claims.length <= 20
    && value.claims.every(claim => object(claim) && typeof claim.address === "string" && claim.address.length <= 1000
      && typeof claim.addressKey === "string" && claim.addressKey.length <= 1000
      && typeof claim.leaseToken === "string" && claim.leaseToken.length > 0 && claim.leaseToken.length <= 200);
}

function resolveAddress(address: string, resolve: (address: string) => Promise<TradeMapGeocodeResult>, signal: AbortSignal, timeoutMs: number): Promise<TradeMapGeocodeResult | null> {
  return new Promise(done => {
    let finished = false;
    const finish = (result: TradeMapGeocodeResult | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      done(result);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish({ status: "error", reason: "unavailable" }), timeoutMs);
    if (signal.aborted) { finish(null); return; }
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve().then(() => signal.aborted ? null : resolve(address)).then(finish, () => finish({ status: "error", reason: "unavailable" }));
  });
}

/** Two address-only lookups at a time, with no new work after an error or cancellation. */
export async function resolveTradeMapClaims(claims: readonly TradeMapLocationClaim[], resolve: (address: string) => Promise<TradeMapGeocodeResult>, signal: AbortSignal, timeoutMs = 15_000): Promise<{ results: TradeMapLocationSave[]; error: "denied" | "quota" | "unavailable" | null }> {
  const results: TradeMapLocationSave[] = [];
  let next = 0;
  let error: "denied" | "quota" | "unavailable" | null = null;
  async function worker() {
    while (!signal.aborted && !error && next < claims.length) {
      const claim = claims[next++];
      const address = prepareTradeMapAddress(claim.address);
      const result = address ? await resolveAddress(address, resolve, signal, timeoutMs) : { status: "unlocated", reason: "invalid_address" } satisfies TradeMapGeocodeResult;
      if (signal.aborted || !result) return;
      results.push({ addressKey: claim.addressKey, leaseToken: claim.leaseToken, result });
      if (result.status === "error") error = result.reason;
    }
  }
  await Promise.all([worker(), worker()]);
  return { results, error };
}

export function waitForTradeMapRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) { finish(); return; }
    signal.addEventListener("abort", finish, { once: true });
  });
}
