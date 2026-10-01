CREATE TABLE trade_map_preparation (
  owner_uid text PRIMARY KEY NOT NULL,
  requested_revision integer NOT NULL DEFAULT 1,
  completed_revision integer NOT NULL DEFAULT 0,
  lease_token text NOT NULL DEFAULT '',
  lease_expires_at text NOT NULL DEFAULT '',
  next_attempt_at text NOT NULL DEFAULT '',
  failures integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '',
  CHECK(requested_revision>=completed_revision AND completed_revision>=0)
);
--> statement-breakpoint
CREATE INDEX trade_map_preparation_due_idx ON trade_map_preparation(next_attempt_at,lease_expires_at,updated_at)
  WHERE requested_revision>completed_revision;
--> statement-breakpoint
INSERT INTO trade_map_preparation(owner_uid)
  SELECT firebase_uid FROM trade_crm_customers WHERE record_status='active'
  UNION SELECT firebase_uid FROM trade_work_orders WHERE partner_type='installer' AND record_status='active';
