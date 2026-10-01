import type { GnafDirectory, GnafMatch } from "./gnaf-directory.ts";

/** The caller supplies its already permission-filtered CRM projection, never client SQL. */
export type TradeMapAuthorizedDataset = { sql: string; bindings: unknown[] };
export type TradeMapLocationClaim = { addressKey: string; address: string; leaseToken: string };
type PermanentLocationSave = { addressKey: string; leaseToken: string; result: GnafMatch };
export type TradeMapLocateResult = { processed: number; located: number; unlocated: number; retryAfterMs: number; complete: boolean };

export const TRADE_MAP_LOCATION_LEASE_MS = 2 * 60 * 1000;
const MAX_BATCH = 200;

export class TradeMapLocationInputError extends Error {
  constructor() { super("Invalid map location request or directory results."); this.name = "TradeMapLocationInputError"; }
}

function isoNow(value?: string) {
  const now = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(now.getTime())) throw new TradeMapLocationInputError();
  return now.toISOString();
}

function validLimit(value = MAX_BATCH) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH) throw new TradeMapLocationInputError();
  return value;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validResult(value: unknown): value is GnafMatch {
  if (!object(value)) return false;
  if (value.status === "located" && object(value.position)) {
    return typeof value.position.lat === "number" && Number.isFinite(value.position.lat)
      && typeof value.position.lng === "number" && Number.isFinite(value.position.lng)
      && value.position.lat >= -55 && value.position.lat <= -9 && value.position.lng >= 96 && value.position.lng <= 169
      && typeof value.approximate === "boolean" && typeof value.sourceId === "string"
      && value.sourceId.trim().length > 0 && value.sourceId.length <= 180;
  }
  return value.status === "unlocated" && typeof value.reason === "string"
    && ["zero_results", "invalid_address", "ambiguous"].includes(value.reason);
}

/** Legacy Google coordinates are still deleted on their original expiry; G-NAF has no timed expiry. */
export async function cleanupExpiredTradeMapLocations(db: D1Database, timestamp?: string) {
  const now = isoNow(timestamp);
  const cleared = await db.prepare(`UPDATE trade_map_location_cache
    SET status='pending', lat=NULL, lng=NULL, approximate=0, reason='', checked_at='', expires_at=''
    WHERE provider='google' AND expires_at<>'' AND expires_at<=?`).bind(now).run();
  return Number(cleared.meta?.changes || 0);
}

async function pendingLocations(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset, now: string) {
  const pending = await db.prepare(`WITH dataset AS (${dataset.sql})
    SELECT COUNT(*) remaining, MIN(CASE WHEN c.provider='gnaf' THEN c.lease_expires_at ELSE '' END) next_at
    FROM dataset d LEFT JOIN trade_map_location_cache c ON c.owner_uid=? AND c.address_key=d.address_key
    WHERE d.address_key<>'' AND length(d.address) BETWEEN 1 AND 1000
      AND (c.address_key IS NULL OR c.provider<>'gnaf' OR c.status NOT IN ('located','unlocated'))`)
    .bind(...dataset.bindings, ownerUid).first<{ remaining: number; next_at: string | null }>();
  return { complete: !pending?.remaining, retryAfterMs: pending?.next_at ? Math.max(0, Date.parse(pending.next_at) - Date.parse(now)) : 0 };
}

/** Server-only leases. Distinct team logins and overlapping customer/job views share the same work. */
export async function claimTradeMapLocations(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset,
  options: { limit?: number; now?: string } = {}): Promise<{ claims: TradeMapLocationClaim[]; retryAfterMs: number }> {
  const limit = validLimit(options.limit), now = isoNow(options.now), leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.parse(now) + TRADE_MAP_LOCATION_LEASE_MS).toISOString();
  await db.prepare(`WITH dataset AS (${dataset.sql}), candidates AS (
      SELECT d.address_key, MIN(d.address) address FROM dataset d
      LEFT JOIN trade_map_location_cache c ON c.owner_uid=? AND c.address_key=d.address_key
      WHERE d.address_key<>'' AND length(d.address) BETWEEN 1 AND 1000
        AND (c.address_key IS NULL OR c.provider<>'gnaf' OR (c.status NOT IN ('located','unlocated') AND c.lease_expires_at<=?))
      GROUP BY d.address_key ORDER BY d.address_key LIMIT ?
    ) INSERT INTO trade_map_location_cache
      (owner_uid,address_key,address,provider,status,lease_token,lease_expires_at)
      SELECT ?,address_key,address,'gnaf','pending',?,? FROM candidates WHERE 1
      ON CONFLICT(owner_uid,address_key) DO UPDATE SET address=excluded.address,provider='gnaf',status='pending',
        source_version='',source_id='',lat=NULL,lng=NULL,approximate=0,reason='',checked_at='',expires_at='',retry_after='',
        lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
      WHERE trade_map_location_cache.provider<>'gnaf' OR (trade_map_location_cache.status NOT IN ('located','unlocated')
        AND trade_map_location_cache.lease_expires_at<=?)`)
    .bind(...dataset.bindings, ownerUid, now, limit, ownerUid, leaseToken, leaseExpiresAt, now).run();
  const claimed = await db.prepare(`SELECT address_key addressKey,address,lease_token leaseToken
    FROM trade_map_location_cache WHERE owner_uid=? AND lease_token=? ORDER BY address_key LIMIT ?`)
    .bind(ownerUid, leaseToken, limit).all<TradeMapLocationClaim>();
  if (claimed.results.length) return { claims: claimed.results, retryAfterMs: 0 };
  return { claims: [], retryAfterMs: (await pendingLocations(db, ownerUid, dataset, now)).retryAfterMs };
}

/** Accept trusted matches while the exact lease is still owned, even after its reclaim deadline. */
export async function saveTradeMapLocations(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset,
  values: readonly PermanentLocationSave[], options: { sourceVersion: string; now?: string }) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_BATCH || typeof options.sourceVersion !== "string"
    || !options.sourceVersion.trim() || options.sourceVersion.length > 180) throw new TradeMapLocationInputError();
  const keys = new Set<string>();
  for (const value of values) {
    if (!object(value) || typeof value.addressKey !== "string" || !value.addressKey || value.addressKey.length > 1000
      || typeof value.leaseToken !== "string" || !/^[a-f0-9-]{36}$/i.test(value.leaseToken)
      || keys.has(value.addressKey) || !validResult(value.result)) throw new TradeMapLocationInputError();
    keys.add(value.addressKey);
  }
  const now = isoNow(options.now);
  const rows = values.map(value => ({ addressKey: value.addressKey, leaseToken: value.leaseToken, status: value.result.status,
    lat: value.result.status === "located" ? value.result.position.lat : null,
    lng: value.result.status === "located" ? value.result.position.lng : null,
    approximate: value.result.status === "located" && value.result.approximate ? 1 : 0,
    sourceId: value.result.status === "located" ? value.result.sourceId : "",
    reason: value.result.status === "unlocated" ? value.result.reason : "" }));
  const updated = await db.prepare(`WITH dataset AS MATERIALIZED (${dataset.sql}), results AS MATERIALIZED (
      SELECT value, json_extract(value,'$.addressKey') address_key, json_extract(value,'$.leaseToken') lease_token FROM json_each(?)
    ) UPDATE trade_map_location_cache
    SET (status,lat,lng,approximate,reason,source_id)=(
      SELECT json_extract(r.value,'$.status'),json_extract(r.value,'$.lat'),json_extract(r.value,'$.lng'),
        json_extract(r.value,'$.approximate'),json_extract(r.value,'$.reason'),json_extract(r.value,'$.sourceId')
      FROM results r WHERE r.address_key=trade_map_location_cache.address_key
    ), source_version=?,checked_at=?,expires_at='',retry_after='',lease_token='',lease_expires_at=''
    WHERE owner_uid=? AND provider='gnaf' AND address_key IN(SELECT address_key FROM results)
      AND EXISTS(SELECT 1 FROM results r WHERE r.address_key=trade_map_location_cache.address_key AND r.lease_token=trade_map_location_cache.lease_token)
      AND EXISTS(SELECT 1 FROM dataset d WHERE d.address_key=trade_map_location_cache.address_key AND d.address=trade_map_location_cache.address)
    RETURNING status`).bind(...dataset.bindings, JSON.stringify(rows), options.sourceVersion, now, ownerUid).all<{ status: string }>();
  const located = updated.results.filter(row => row.status === "located").length;
  return { saved: updated.results.length, ignored: values.length - updated.results.length, located, unlocated: updated.results.length - located };
}

export async function locateTradeMapRecords(db: D1Database, ownerUid: string, dataset: TradeMapAuthorizedDataset,
  options: { directory: GnafDirectory; limit?: number; now?: string }): Promise<TradeMapLocateResult> {
  const now = isoNow(options.now);
  const batch = await claimTradeMapLocations(db, ownerUid, dataset, { limit: options.limit, now });
  if (!batch.claims.length) return { processed: 0, located: 0, unlocated: 0, ...(await pendingLocations(db, ownerUid, dataset, now)) };
  try {
    const matches = await options.directory.resolve(batch.claims.map(claim => claim.address));
    if (!Array.isArray(matches) || matches.length !== batch.claims.length) throw new TradeMapLocationInputError();
    const saved = await saveTradeMapLocations(db, ownerUid, dataset,
      batch.claims.map((claim, index) => ({ ...claim, result: matches[index] })), { sourceVersion: options.directory.version, now: options.now });
    // A record may be edited or unassigned while the directory is read. Count the work attempted,
    // but only report saved results as located/unlocated; the next batch uses the current projection.
    return { processed: batch.claims.length, located: saved.located, unlocated: saved.unlocated,
      ...(await pendingLocations(db, ownerUid, dataset, isoNow(options.now))) };
  } catch (error) {
    // A failed directory read is not a missing address. Release this exact lease so the user can retry.
    await db.prepare(`UPDATE trade_map_location_cache SET lease_token='',lease_expires_at=''
      WHERE owner_uid=? AND provider='gnaf' AND lease_token=? AND status='pending'`)
      .bind(ownerUid, batch.claims[0].leaseToken).run();
    throw error;
  }
}
