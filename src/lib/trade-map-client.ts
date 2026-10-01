import type { TradeMapBounds, TradeMapDatasetResponse, TradeMapQuery } from "./trade-map-contract.ts";
import { TRADE_MAP_PIN_LABELS } from "./trade-record-map.ts";

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

export function waitForTradeMapRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) { finish(); return; }
    signal.addEventListener("abort", finish, { once: true });
  });
}
