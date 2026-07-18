WITH ordered_jobs AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS sequence
  FROM trade_work_orders
  WHERE partner_type = 'installer' AND work_type = 'job'
)
UPDATE trade_work_orders
SET work_number = (
  SELECT 'TLJ-' || printf('%08d', ordered_jobs.sequence)
  FROM ordered_jobs
  WHERE ordered_jobs.id = trade_work_orders.id
)
WHERE id IN (SELECT id FROM ordered_jobs);

INSERT INTO trade_crm_counters (firebase_uid, counter_key, last_value, updated_at)
SELECT '__tlink_global__', 'job', COUNT(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM trade_work_orders
WHERE partner_type = 'installer' AND work_type = 'job'
ON CONFLICT(firebase_uid, counter_key) DO UPDATE SET
  last_value = MAX(last_value, excluded.last_value),
  updated_at = excluded.updated_at;

CREATE UNIQUE INDEX `trade_work_orders_tlink_job_number_idx`
ON `trade_work_orders` (`work_number`)
WHERE `work_number` GLOB 'TLJ-*';
