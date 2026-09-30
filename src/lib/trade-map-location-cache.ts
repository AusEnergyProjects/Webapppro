import type { TradeMapGeocodeResult } from "./trade-record-map.ts";
import type { TradeMapLocationClaim, TradeMapLocationClaimsResponse, TradeMapLocationSave } from "./trade-map-contract.ts";

/** The caller supplies its already permission-filtered CRM projection, never client SQL. */
export type TradeMapAuthorizedDataset = { sql: string; bindings: unknown[] };

// Refresh before Google's 30-day storage limit, leaving time for scheduled deletion.
export const TRADE_MAP_LOCATION_TTL_MS = 29 * 24 * 60 * 60 * 1000;
export const TRADE_MAP_LOCATION_LEASE_MS = 2 * 60 * 1000;
const MAX_BATCH = 20;
const ERROR_BACKOFF_MS = { denied: 60 * 60 * 1000, quota: 15 * 60 * 1000, unavailable: 60 * 1000 };

export class TradeMapLocationInputError extends Error {
  constructor() { super("Invalid map location results."); this.name = "TradeMapLocationInputError"; }
}

function isoNow(value?: string) {
  const now = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(now.getTime())) throw new TradeMapLocationInputError();
  return now.toISOString();
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(value: unknown): TradeMapGeocodeResult {
  if (!object(value)) throw new TradeMapLocationInputError();
  if (value.status === "located" && object(value.position)
    && typeof value.position.lat === "number" && Number.isFinite(value.position.lat)
    && typeof value.position.lng === "number" && Number.isFinite(value.position.lng)
    // Australian mainland, Tasmania and external island territories.
    && value.position.lat >= -55 && value.position.lat <= -9
    && value.position.lng >= 96 && value.position.lng <= 169
    && typeof value.approximate === "boolean") {
    return { status: "located", position: { lat: value.position.lat, lng: value.position.lng }, approximate: value.approximate };
  }
  if (value.status === "unlocated" && (value.reason === "missing_address" || value.reason === "invalid_address"
    || value.reason === "zero_results" || value.reason === "outside_australia")) return { status: "unlocated", reason: value.reason };
  if (value.status === "error" && (value.reason === "denied" || value.reason === "quota" || value.reason === "unavailable")) {
    return { status: "error", reason: value.reason };
  }
  throw new TradeMapLocationInputError();
}

export function parseTradeMapLocationResults(input: unknown): TradeMapLocationSave[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BATCH) throw new TradeMapLocationInputError();
  const keys = new Set<string>();
  return input.map((value) => {
    if (!object(value) || typeof value.addressKey !== "string" || value.addressKey.length < 1 || value.addressKey.length > 1000
      || typeof value.leaseToken !== "string" || !/^[a-f0-9-]{36}$/i.test(value.leaseToken)
      || keys.has(value.addressKey)) throw new TradeMapLocationInputError();
    keys.add(value.addressKey);
    return { addressKey: value.addressKey, leaseToken: value.leaseToken, result: result(value.result) };
  });
}

/** Also called by the existing worker maintenance schedule, independently of map visits. */
export async function cleanupExpiredTradeMapLocations(db: D1Database, timestamp?: string) {
  const now = isoNow(timestamp);
  const cleared = await db.prepare(`UPDATE trade_map_location_cache
    SET status='pending', lat=NULL, lng=NULL, approximate=0, reason='', checked_at='', expires_at=''
    WHERE expires_at<>'' AND expires_at<=?`).bind(now).run();
  return Number(cleared.meta?.changes || 0);
}

export async function claimTradeMapLocations(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset,
  options: { limit?: number; now?: string } = {}): Promise<TradeMapLocationClaimsResponse> {
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new TradeMapLocationInputError();
  const now = isoNow(options.now);
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(now) + TRADE_MAP_LOCATION_LEASE_MS).toISOString();
  await cleanupExpiredTradeMapLocations(db, now);
  // A provider denial/outage applies to this business's processing, not just one
  // address. Reopening another tab must not drain its remaining addresses into it.
  const cooldown = await db.prepare(`SELECT MAX(retry_after) next_at FROM trade_map_location_cache
    WHERE owner_uid=? AND status='error' AND retry_after>?`).bind(ownerUid, now).first<{ next_at: string | null }>();
  if (cooldown?.next_at) return { claims: [], retryAfterMs: Date.parse(cooldown.next_at) - Date.parse(now) };
  // One atomic statement chooses and leases the work. A second concurrent claimant sees
  // the first claim's lease and chooses different addresses, even for overlapping datasets.
  await db.prepare(`WITH dataset AS (${dataset.sql}), candidates AS (
      SELECT d.address_key, MIN(d.address) address FROM dataset d
      LEFT JOIN trade_map_location_cache c ON c.owner_uid=? AND c.address_key=d.address_key
      WHERE d.address_key<>'' AND length(d.address) BETWEEN 1 AND 1000
        AND (c.address_key IS NULL OR (c.expires_at<=? AND c.lease_expires_at<=? AND c.retry_after<=?))
      GROUP BY d.address_key ORDER BY d.address_key LIMIT ?
    ) INSERT INTO trade_map_location_cache
      (owner_uid,address_key,address,status,lease_token,lease_expires_at)
      SELECT ?,address_key,address,'pending',?,? FROM candidates WHERE 1
      ON CONFLICT(owner_uid,address_key) DO UPDATE SET address=excluded.address,status='pending',
        lat=NULL,lng=NULL,approximate=0,reason='',checked_at='',expires_at='',retry_after='',
        lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
      WHERE trade_map_location_cache.expires_at<=? AND trade_map_location_cache.lease_expires_at<=?
        AND trade_map_location_cache.retry_after<=?`)
    .bind(...dataset.bindings, ownerUid, now, now, now, limit, ownerUid, leaseToken, leaseExpiresAt, now, now, now).run();
  const claimed = await db.prepare(`SELECT address_key addressKey,address,lease_token leaseToken
    FROM trade_map_location_cache WHERE owner_uid=? AND lease_token=? ORDER BY address_key LIMIT ?`)
    .bind(ownerUid, leaseToken, limit).all<TradeMapLocationClaim>();
  if (claimed.results.length) return { claims: claimed.results, retryAfterMs: 0 };
  const deferred = await db.prepare(`WITH dataset AS (${dataset.sql}) SELECT MIN(MAX(c.lease_expires_at,c.retry_after)) next_at
    FROM trade_map_location_cache c WHERE c.owner_uid=? AND c.expires_at<=?
      AND MAX(c.lease_expires_at,c.retry_after)>?
      AND EXISTS(SELECT 1 FROM dataset d WHERE d.address_key=c.address_key)`)
    .bind(...dataset.bindings, ownerUid, now, now).first<{ next_at: string | null }>();
  return { claims: [], retryAfterMs: deferred?.next_at ? Math.max(0, Date.parse(deferred.next_at) - Date.parse(now)) : 0 };
}

export async function saveTradeMapLocations(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset,
  input: unknown, options: { now?: string } = {}): Promise<{ saved: number; ignored: number }> {
  // Validate the complete batch before writing any item.
  const values = parseTradeMapLocationResults(input);
  const now = isoNow(options.now);
  const expiresAt = new Date(Date.parse(now) + TRADE_MAP_LOCATION_TTL_MS).toISOString();
  const rows = values.map((value) => {
    const geocode = value.result;
    const located = geocode.status === "located";
    const error = geocode.status === "error";
    const retryAfter = error ? new Date(Date.parse(now) + ERROR_BACKOFF_MS[geocode.reason]).toISOString() : "";
    return { addressKey: value.addressKey, leaseToken: value.leaseToken, status: geocode.status,
      lat: located ? geocode.position.lat : null, lng: located ? geocode.position.lng : null,
      approximate: located && geocode.approximate ? 1 : 0, reason: located ? "" : geocode.reason,
      checkedAt: now, expiresAt: error ? "" : expiresAt, retryAfter };
  });
  // Materialize the authorized projection once for the entire batch, including large
  // registers whose row permission predicate is more expensive than a primary-key lookup.
  const updated = await db.prepare(`WITH dataset AS MATERIALIZED (${dataset.sql}), results AS MATERIALIZED (
      SELECT value, json_extract(value,'$.addressKey') address_key, json_extract(value,'$.leaseToken') lease_token
      FROM json_each(?)
    ) UPDATE trade_map_location_cache
    SET (status,lat,lng,approximate,reason,checked_at,expires_at,retry_after)=(
      SELECT json_extract(r.value,'$.status'),json_extract(r.value,'$.lat'),json_extract(r.value,'$.lng'),
        json_extract(r.value,'$.approximate'),json_extract(r.value,'$.reason'),json_extract(r.value,'$.checkedAt'),
        json_extract(r.value,'$.expiresAt'),json_extract(r.value,'$.retryAfter')
      FROM results r WHERE r.address_key=trade_map_location_cache.address_key
    ), lease_token='',lease_expires_at=''
    WHERE owner_uid=? AND address_key IN(SELECT address_key FROM results) AND lease_expires_at>?
      AND EXISTS(SELECT 1 FROM results r WHERE r.address_key=trade_map_location_cache.address_key
        AND r.lease_token=trade_map_location_cache.lease_token)
      AND EXISTS(SELECT 1 FROM dataset d WHERE d.address_key=trade_map_location_cache.address_key
        AND d.address=trade_map_location_cache.address)`)
    .bind(...dataset.bindings, JSON.stringify(rows), ownerUid, now).run();
  const saved = Number(updated.meta?.changes || 0);
  return { saved, ignored: values.length - saved };
}
