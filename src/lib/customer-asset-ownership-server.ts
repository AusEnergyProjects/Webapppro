import { getD1 } from "../../db";

export async function canCustomerAccessHandover(customerUid: string, handoverPackId: string) {
  const row = await getD1().prepare(`SELECT CASE
    WHEN EXISTS (SELECT 1 FROM customer_asset_ownerships WHERE handover_pack_id = ?)
      THEN EXISTS (SELECT 1 FROM customer_asset_ownerships
        WHERE handover_pack_id = ? AND customer_uid = ? AND status = 'active')
    ELSE EXISTS (SELECT 1 FROM trade_handover_packs p JOIN customer_projects c ON c.id = p.customer_project_id
      WHERE p.id = ? AND p.status = 'published' AND c.firebase_uid = ?)
    END access`)
    .bind(handoverPackId, handoverPackId, customerUid, handoverPackId, customerUid)
    .first<{ access: number }>();
  return Boolean(row?.access);
}

export async function materializeOriginalOwnership(customerUid: string, handoverPackId: string, now: string) {
  const existing = await getD1().prepare(`SELECT id FROM customer_asset_ownerships
    WHERE handover_pack_id = ? AND customer_uid = ? AND status = 'active'`)
    .bind(handoverPackId, customerUid).first();
  if (existing) return true;
  const eligible = await getD1().prepare(`SELECT p.id FROM trade_handover_packs p
    JOIN customer_projects c ON c.id = p.customer_project_id
    WHERE p.id = ? AND p.status = 'published' AND c.firebase_uid = ?`)
    .bind(handoverPackId, customerUid).first();
  if (!eligible) return false;
  await getD1().prepare(`INSERT INTO customer_asset_ownerships
    (id, handover_pack_id, customer_uid, active_key, status, source_type, transfer_id,
     started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', 'original', '', ?, '', ?, ?)
    ON CONFLICT(active_key) DO NOTHING`)
    .bind(crypto.randomUUID(), handoverPackId, customerUid, handoverPackId, now, now, now).run();
  return canCustomerAccessHandover(customerUid, handoverPackId);
}

export async function expireAssetTransfers(now: string) {
  const db = getD1();
  const expired = await db.prepare(`SELECT id FROM customer_asset_transfer_requests
    WHERE status IN ('awaiting_recipient', 'awaiting_admin') AND expires_at < ? LIMIT 50`)
    .bind(now).all<{ id: string }>();
  if (!expired.results.length) return;
  await db.batch([
    ...expired.results.flatMap((row: { id: string }) => [
      db.prepare(`INSERT INTO customer_asset_transfer_events
        (id, transfer_id, event_type, actor_type, actor_uid, summary, created_at)
        SELECT ?, id, 'transfer_expired', 'system', '', 'The one-time asset transfer invitation expired without an ownership change.', ?
        FROM customer_asset_transfer_requests WHERE id = ?
          AND status IN ('awaiting_recipient', 'awaiting_admin') AND expires_at < ?
          AND NOT EXISTS (SELECT 1 FROM customer_asset_transfer_events e
            WHERE e.transfer_id = customer_asset_transfer_requests.id AND e.event_type = 'transfer_expired')`)
        .bind(crypto.randomUUID(), now, row.id, now),
      db.prepare(`UPDATE admin_notifications SET status = 'resolved', resolved_at = ?,
        resolution_note = 'Asset transfer invitation expired.', updated_at = ?
        WHERE entity_type = 'customer_asset_transfer' AND entity_id = ? AND status != 'resolved'`)
        .bind(now, now, row.id),
    ]),
    db.prepare(`UPDATE customer_asset_transfer_requests SET status = 'expired', updated_at = ?
      WHERE status IN ('awaiting_recipient', 'awaiting_admin') AND expires_at < ?`)
      .bind(now, now),
  ]);
}

export function transferEventStatement(
  db: ReturnType<typeof getD1>,
  transferId: string,
  eventType: string,
  actorType: "customer" | "admin" | "system",
  actorUid: string,
  summary: string,
  createdAt: string,
) {
  return db.prepare(`INSERT INTO customer_asset_transfer_events
    (id, transfer_id, event_type, actor_type, actor_uid, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), transferId, eventType, actorType, actorUid, summary, createdAt);
}
