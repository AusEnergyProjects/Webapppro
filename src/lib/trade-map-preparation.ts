import { tradeMapAddressSql } from "./trade-map-dataset-server.ts";
import { JOB_REGISTER_CUSTOMER_CONTEXT_SQL } from "./trade-crm-job-register.ts";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { locateTradeMapRecords, type TradeMapAuthorizedDataset } from "./trade-map-location-cache.ts";
import type { GnafDirectory } from "./gnaf-directory.ts";

export const TRADE_MAP_PREPARATION_HEADER = "X-TLink-Map-Preparation";
// Leave headroom for remote storage latency within the post-response work window.
export const TRADE_MAP_PREPARATION_BATCH_SIZE = 100;
const LEASE_MS = 120_000;

/** Business-wide address-only projection. Record visibility remains enforced by the map GET. */
export function tradeMapPreparationDataset(ownerUid: string): TradeMapAuthorizedDataset {
  return {
    sql: `SELECT address, LOWER(TRIM(address)) address_key FROM (
      SELECT ${tradeMapAddressSql("c")} address FROM trade_crm_customers c
      WHERE c.firebase_uid=? AND c.record_status='active'
      UNION ALL
      SELECT ${tradeMapAddressSql("ss")} address FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
      JOIN trade_crm_service_sites ss ON ss.id=d.service_site_id AND ss.firebase_uid=w.firebase_uid AND ss.record_status='active'
      WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
        AND ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL}
    ) WHERE EXISTS(SELECT 1 FROM trade_accounts account WHERE account.firebase_uid=?
      AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate("account")})`,
    bindings: [ownerUid, ownerUid, ownerUid],
  };
}

/** Repeated map reads do not reset a lease, retry backoff, or unfinished revision. */
export async function enqueueTradeMapPreparation(db: D1Database, ownerUid: string, now = new Date().toISOString()) {
  await db.prepare(`INSERT INTO trade_map_preparation(owner_uid,requested_revision,updated_at)
    VALUES(?,1,?) ON CONFLICT(owner_uid) DO UPDATE SET
      requested_revision=MAX(trade_map_preparation.requested_revision,trade_map_preparation.completed_revision+1),
      updated_at=excluded.updated_at`).bind(ownerUid, now).run();
}

export function withTradeMapPreparation(response: Response, ownerUid: string) {
  const headers = new Headers(response.headers);
  headers.set(TRADE_MAP_PREPARATION_HEADER, ownerUid);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function queueTradeMapPreparation(response: Response, context: {
  waitUntil: (promise: Promise<unknown>) => void;
  drain: (ownerUid: string) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const ownerUid = response.ok ? response.headers.get(TRADE_MAP_PREPARATION_HEADER) : null;
  if (!response.headers.has(TRADE_MAP_PREPARATION_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(TRADE_MAP_PREPARATION_HEADER);
  if (ownerUid) context.waitUntil(Promise.resolve().then(() => context.drain(ownerUid)).catch(context.onError));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** One small address batch per claim; a cron drain may take more claims within its time budget. */
export async function drainTradeMapPreparation(options: {
  db: D1Database;
  getDirectory: () => Promise<GnafDirectory>;
  ownerUid?: string;
  maxBatches?: number;
  now?: () => Date;
}) {
  const { db } = options;
  const clock = options.now || (() => new Date());
  const startedAt = clock().getTime();
  const maxBatches = Math.min(20, Math.max(1, Math.floor(options.maxBatches || 1)));
  let processed = 0, completed = 0, failed = 0;
  let directory: GnafDirectory | undefined;
  for (let batch = 0; batch < maxBatches && clock().getTime() - startedAt < 20_000; batch++) {
    const now = clock().toISOString(), token = crypto.randomUUID();
    const leaseUntil = new Date(Date.parse(now) + LEASE_MS).toISOString();
    const claim = await db.prepare(`UPDATE trade_map_preparation
      SET lease_token=?,lease_expires_at=?,updated_at=?
      WHERE owner_uid=(SELECT q.owner_uid FROM trade_map_preparation q
        JOIN trade_accounts account ON account.firebase_uid=q.owner_uid
        WHERE q.requested_revision>q.completed_revision AND q.next_attempt_at<=? AND q.lease_expires_at<=?
          AND (?='' OR q.owner_uid=?) AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate("account")}
        ORDER BY q.next_attempt_at,q.updated_at,q.owner_uid LIMIT 1)
        AND lease_expires_at<=?
      RETURNING owner_uid,requested_revision,failures`)
      .bind(token, leaseUntil, now, now, now, options.ownerUid || "", options.ownerUid || "", now)
      .first<{ owner_uid: string; requested_revision: number; failures: number }>();
    if (!claim) break;
    try {
      directory ||= await options.getDirectory();
      const result = await locateTradeMapRecords(db, claim.owner_uid, tradeMapPreparationDataset(claim.owner_uid),
        { limit: TRADE_MAP_PREPARATION_BATCH_SIZE, directory });
      const finishedAt = clock().toISOString();
      const nextAt = result.complete ? "" : new Date(Date.parse(finishedAt) + Math.max(0, result.retryAfterMs)).toISOString();
      await db.prepare(`UPDATE trade_map_preparation SET completed_revision=CASE WHEN ? THEN ? ELSE completed_revision END,
        lease_token='',lease_expires_at='',next_attempt_at=?,failures=0,last_error='',updated_at=?
        WHERE owner_uid=? AND lease_token=?`)
        .bind(result.complete ? 1 : 0, claim.requested_revision, nextAt, finishedAt, claim.owner_uid, token).run();
      processed += result.processed;
      if (result.complete) completed++;
      if (!result.processed && !result.complete) break;
    } catch {
      failed++;
      const delay = Math.min(300_000, 5_000 * 2 ** Math.min(6, claim.failures));
      const nextAt = new Date(clock().getTime() + delay).toISOString();
      await db.prepare(`UPDATE trade_map_preparation SET lease_token='',lease_expires_at='',next_attempt_at=?,
        failures=failures+1,last_error='directory_processing_failed',updated_at=? WHERE owner_uid=? AND lease_token=?`)
        .bind(nextAt, clock().toISOString(), claim.owner_uid, token).run();
      // Leave unresolved addresses pending. The durable cron will retry after backoff.
      break;
    }
  }
  return { processed, completed, failed };
}
