-- Repair the synthetic benchmark so it exercises the same customer project and six-installer flow as production.
UPDATE `trade_opportunities`
SET `source_reference` = `id`
WHERE COALESCE(`is_synthetic`, 0) = 1
  AND `id` LIKE 'customer-project:%';
--> statement-breakpoint
WITH existing_counts AS (
  SELECT opportunity_id, COUNT(*) AS existing_count
  FROM trade_opportunity_matches
  GROUP BY opportunity_id
),
eligible_missing AS (
  SELECT
    o.id AS opportunity_id,
    o.service_categories AS matched_categories,
    a.firebase_uid,
    ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY a.firebase_uid) AS candidate_rank,
    COALESCE(ec.existing_count, 0) AS existing_count
  FROM trade_opportunities o
  JOIN trade_accounts a
    ON a.partner_type = 'installer'
   AND COALESCE(a.is_synthetic, 0) = 1
   AND a.account_status = 'active'
   AND a.verification_status = 'approved'
   AND a.billing_status IN ('trial', 'active', 'active_cancels_at_period_end')
  LEFT JOIN existing_counts ec ON ec.opportunity_id = o.id
  WHERE COALESCE(o.is_synthetic, 0) = 1
    AND NOT EXISTS (
      SELECT 1 FROM trade_opportunity_matches m
      WHERE m.opportunity_id = o.id AND m.firebase_uid = a.firebase_uid
    )
    AND EXISTS (
      SELECT 1
      FROM json_each(o.service_categories) requested
      JOIN json_each(a.capabilities) capability ON capability.value = requested.value
    )
)
INSERT OR IGNORE INTO trade_opportunity_matches
  (id, opportunity_id, firebase_uid, status, admin_note, partner_note, matched_categories,
   distance_metres, allocation_rank, match_source, contact_attempt_count, last_contact_at,
   connected_at, matched_by_uid, matched_at, updated_at)
SELECT
  'ecosystem:' || opportunity_id || ':' || firebase_uid,
  opportunity_id,
  firebase_uid,
  'offered',
  '',
  '',
  matched_categories,
  5000 + ((existing_count + candidate_rank - 1) * 9000),
  existing_count + candidate_rank,
  'synthetic_benchmark',
  0,
  '',
  '',
  'synthetic-system',
  '2026-07-16T19:00:00.000Z',
  '2026-07-16T19:00:00.000Z'
FROM eligible_missing
WHERE candidate_rank <= (6 - existing_count);
