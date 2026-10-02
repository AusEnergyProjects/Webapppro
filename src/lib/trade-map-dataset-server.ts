import type { TradeMapBounds, TradeMapDatasetItem, TradeMapDatasetMarker, TradeMapDatasetResponse } from "./trade-map-contract.ts";
import { TRADE_MAP_PIN_CATEGORY_ORDER, type TradeMapRecord } from "./trade-record-map.ts";
import { TRADE_JOB_LIFECYCLE_STATUSES } from "./trade-job-lifecycle.ts";
import type { TradeMapAuthorizedDataset } from "./trade-map-location-cache.ts";

/** Authorised, filtered records. Only server-built SQL may cross this boundary. */
export type TradeMapDataset = TradeMapAuthorizedDataset & { cacheOwnerColumn?: 'owner_uid' };

const PAGE_SIZE = 50;
const GRID_COLUMNS = 12;
const GRID_ROWS = 8;
type Row = Record<string, unknown>;

export class TradeMapInputError extends Error {}

function viewport(url: URL): TradeMapBounds | null {
  const names = ["north", "south", "east", "west"] as const;
  if (names.every(name => !url.searchParams.has(name))) return null;
  const values = names.map(name => {
    const raw = url.searchParams.get(name);
    if (raw === null || !raw.trim()) throw new TradeMapInputError("Map bounds are incomplete.");
    return Number(raw);
  });
  const [north, south, east, west] = values;
  if (values.some(value => !Number.isFinite(value)) || north > 90 || south < -90 || north <= south
    || east > 180 || east < -180 || west > 180 || west < -180 || east === west) {
    throw new TradeMapInputError("Map bounds are invalid.");
  }
  return { north, south, east, west };
}

function bounds(row: Row): TradeMapBounds | null {
  if (row.north === null || row.south === null || row.east === null || row.west === null) return null;
  return { north: Number(row.north), south: Number(row.south), east: Number(row.east), west: Number(row.west) };
}

function record(row: Row): TradeMapRecord {
  const kind = row.kind === "job" ? "job" : "customer";
  const jobStatus = kind === "job" ? TRADE_JOB_LIFECYCLE_STATUSES.find(value => value === row.category) : undefined;
  return { id: String(row.id), kind, title: String(row.title || ""), reference: String(row.reference || ""),
    address: String(row.address || ""), detail: String(row.detail || ""), ...(jobStatus ? { jobStatus } : {}) };
}

function item(row: Row): TradeMapDatasetItem {
  const located = row.location_status === "located";
  return { ...record(row), addressKey: String(row.address_key || ""),
    locationStatus: located ? "located" : row.location_status === "unlocated" ? "unlocated" : "pending",
    ...(located ? { position: { lat: Number(row.lat), lng: Number(row.lng) }, approximate: Boolean(row.approximate) } : {}),
  };
}

function marker(row: Row): TradeMapDatasetMarker {
  const count = Number(row.record_count);
  return {
    id: `${row.cell_x}:${row.cell_y}`, count,
    position: { lat: Number(row.lat), lng: Number(row.lng) },
    bounds: { north: Number(row.north), south: Number(row.south), east: Number(row.east), west: Number(row.west) },
    category: TRADE_MAP_PIN_CATEGORY_ORDER.find(value => value === row.category) || "unknown",
    approximate: Boolean(row.approximate),
    ...(count === 1 ? { record: record(row) } : {}),
    ...(Number(row.address_count) === 1 ? { addressKey: String(row.address_key) } : {}),
  };
}

/** Bounded queries. SQLite aggregates the full matching set; raw records never leave storage in bulk. */
export async function loadTradeMapDataset(db: D1Database, ownerUid: string, dataset: TradeMapDataset, url: URL): Promise<TradeMapDatasetResponse> {
  const requestedViewport = viewport(url);
  const pageText = url.searchParams.get("mapPage") || "1";
  const page = Number(pageText);
  if (!/^\d{1,7}$/.test(pageText) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new TradeMapInputError("Map page is invalid.");
  const locationStatus = url.searchParams.get("mapLocationStatus") || "all";
  if (!["all", "located", "pending", "unlocated", "approximate"].includes(locationStatus)) throw new TradeMapInputError("Map location filter is invalid.");
  const addressKey = url.searchParams.get("mapAddressKey") || "";
  if (addressKey.length > 1000) throw new TradeMapInputError("Map address selection is invalid.");

  const cte = `WITH map_records AS (${dataset.sql}), map_locations AS (
    SELECT r.*, cache.lat, cache.lng, cache.approximate,
      CASE WHEN r.address_key = '' THEN 'unlocated'
        WHEN cache.status = 'located' AND cache.lat IS NOT NULL AND cache.lng IS NOT NULL THEN 'located'
        WHEN cache.status = 'unlocated' THEN 'unlocated' ELSE 'pending' END location_status
    FROM map_records r LEFT JOIN trade_map_location_cache cache
      ON cache.owner_uid = ${dataset.cacheOwnerColumn === 'owner_uid' ? 'r.owner_uid' : '?'} AND cache.address_key = r.address_key AND cache.provider = 'gnaf'
  )`;
  const args = dataset.cacheOwnerColumn === 'owner_uid' ? [...dataset.bindings] : [...dataset.bindings, ownerUid];
  const summary = await db.prepare(`${cte} SELECT COUNT(*) total,
    COUNT(CASE WHEN location_status = 'located' THEN 1 END) mapped,
    COUNT(CASE WHEN location_status = 'located' AND approximate = 1 THEN 1 END) approximate,
    COUNT(CASE WHEN location_status = 'pending' THEN 1 END) pending,
    COUNT(CASE WHEN location_status = 'unlocated' THEN 1 END) unmapped,
    MAX(CASE WHEN location_status = 'located' THEN lat END) north,
    MIN(CASE WHEN location_status = 'located' THEN lat END) south,
    MAX(CASE WHEN location_status = 'located' THEN lng END) east,
    MIN(CASE WHEN location_status = 'located' THEN lng END) west
    FROM map_locations`).bind(...args).first<Row>();
  if (!summary) throw new Error("Map summary is unavailable.");
  const globalBounds = bounds(summary);
  const view = requestedViewport || globalBounds || { north: -10, south: -45, east: 155, west: 110 };
  const latitudeSpan = Math.max(0.000001, view.north - view.south);
  const longitudeSpan = Math.max(0.000001, view.east < view.west ? view.east + 360 - view.west : view.east - view.west);
  const inView = `location_status = 'located' AND lat >= ? AND lat <= ? AND ${view.east < view.west ? "(lng >= ? OR lng <= ?)" : "lng >= ? AND lng <= ?"}`;
  const viewArgs = [view.south, view.north, view.west, view.east];
  const cells = `, visible_records AS (
    SELECT *, MIN(${GRID_COLUMNS - 1}, CAST(((CASE WHEN lng < ? THEN lng + 360 ELSE lng END) - ?) / ? * ${GRID_COLUMNS} AS INTEGER)) cell_x,
      MIN(${GRID_ROWS - 1}, CAST((lat - ?) / ? * ${GRID_ROWS} AS INTEGER)) cell_y
    FROM map_locations WHERE ${inView}
  )`;
  const cellArgs = [view.west, view.west, longitudeSpan, view.south, latitudeSpan, ...viewArgs];
  const sidebarConditions = [];
  const sidebarArgs: unknown[] = [];
  if (addressKey) { sidebarConditions.push("address_key = ?"); sidebarArgs.push(addressKey); }
  else { sidebarConditions.push(`(location_status <> 'located' OR (${inView}))`); sidebarArgs.push(...viewArgs); }
  if (locationStatus === "approximate") sidebarConditions.push("location_status = 'located' AND approximate = 1");
  else if (locationStatus !== "all") { sidebarConditions.push("location_status = ?"); sidebarArgs.push(locationStatus); }
  const [markerRows, itemRows, sidebarCount] = await Promise.all([
    db.prepare(`${cte}${cells} SELECT cell_x, cell_y, COUNT(*) record_count, AVG(lat) lat, AVG(lng) lng,
      MAX(lat) north, MIN(lat) south, MAX(lng) east, MIN(lng) west, MAX(approximate) approximate,
      CASE WHEN COUNT(DISTINCT category) = 1 THEN MIN(category)
        WHEN SUM(CASE WHEN kind = 'customer' THEN 1 ELSE 0 END) > 0 THEN 'mixed_records' ELSE 'mixed' END category,
      COUNT(DISTINCT address_key) address_count, MIN(address_key) address_key,
      MIN(id) id, MIN(kind) kind, MIN(title) title, MIN(reference) reference, MIN(address) address, MIN(detail) detail
      FROM visible_records GROUP BY cell_x, cell_y ORDER BY cell_y, cell_x LIMIT ${GRID_COLUMNS * GRID_ROWS}`)
      .bind(...args, ...cellArgs).all<Row>(),
    db.prepare(`${cte} SELECT id, kind, title, reference, address, address_key, detail, category, lat, lng, approximate, location_status
      FROM map_locations WHERE ${sidebarConditions.join(" AND ")} ORDER BY title COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .bind(...args, ...sidebarArgs, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE).all<Row>(),
    db.prepare(`${cte} SELECT COUNT(*) total FROM map_locations WHERE ${sidebarConditions.join(" AND ")}`)
      .bind(...args, ...sidebarArgs).first<{ total: number }>(),
  ]);
  const markers = markerRows.results.map(marker);
  return {
    resource: url.searchParams.get("resource") === "jobs" ? "jobs" : "customers",
    total: Number(summary.total), mapped: Number(summary.mapped), approximate: Number(summary.approximate),
    pending: Number(summary.pending), unmapped: Number(summary.unmapped),
    inViewport: markers.reduce((sum, value) => sum + value.count, 0), bounds: globalBounds, markers,
    listTotal: Number(sidebarCount?.total || 0),
    items: itemRows.results.slice(0, PAGE_SIZE).map(item), page, pageSize: PAGE_SIZE, hasMore: itemRows.results.length > PAGE_SIZE,
  };
}

/** Match the CRM map projection: a street and either suburb or postcode are required. */
export function tradeMapAddressSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Static map address alias required.");
  const part = (name: string) => `TRIM(COALESCE(${alias}.${name}, ''))`;
  const line1 = part("address_line_1");
  const line2 = part("address_line_2");
  const suburb = part("suburb");
  const state = part("address_state");
  const postcode = part("postcode");
  return `CASE WHEN ${line1} <> '' AND (${suburb} <> '' OR ${postcode} <> '') THEN
    ${line1} || CASE WHEN ${line2} <> '' THEN ', ' || ${line2} ELSE '' END
    || CASE WHEN ${suburb} <> '' THEN ', ' || ${suburb} ELSE '' END
    || CASE WHEN ${state} <> '' THEN ', ' || ${state} ELSE '' END
    || CASE WHEN ${postcode} <> '' THEN ', ' || ${postcode} ELSE '' END || ', Australia'
    ELSE '' END`;
}
