import type { TradeMapPinCategory, TradeMapPosition, TradeMapRecord } from "./trade-record-map.ts";

export type TradeMapResource = "customers" | "jobs";
export type TradeMapQuery = { resource: TradeMapResource; filters: Record<string, string>; revision?: number };
export type TradeMapBounds = { north: number; south: number; east: number; west: number };

export type TradeMapDatasetItem = TradeMapRecord & {
  addressKey: string;
  position?: TradeMapPosition;
  approximate?: boolean;
  locationStatus: "located" | "pending" | "unlocated";
};

export type TradeMapDatasetMarker = {
  id: string;
  count: number;
  position: TradeMapPosition;
  bounds: TradeMapBounds;
  category: TradeMapPinCategory;
  approximate: boolean;
  record?: TradeMapRecord;
  addressKey?: string;
};

/** Counts cover all matching records, independently of the register's list page. */
export type TradeMapDatasetResponse = {
  resource: TradeMapResource;
  total: number;
  mapped: number;
  approximate: number;
  pending: number;
  unmapped: number;
  inViewport: number;
  listTotal: number;
  bounds: TradeMapBounds | null;
  markers: TradeMapDatasetMarker[];
  items: TradeMapDatasetItem[];
  page: number;
  pageSize: 50;
  hasMore: boolean;
};

/** A register page or cursor must never limit map coverage. */
export function tradeMapQuery(resource: TradeMapResource, params: URLSearchParams, revision = 0): TradeMapQuery {
  const filters: Record<string, string> = {};
  const listOnly = new Set(["mode", "resource", "page", "pageSize", "cursor", "total", "sort"]);
  params.forEach((value, key) => { if (value && !listOnly.has(key)) filters[key] = value; });
  return { resource, filters, revision };
}
