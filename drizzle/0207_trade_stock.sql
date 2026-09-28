-- Trigger bodies are installed and verified by trade-stock-schema-guards.ts before guarded writes.
CREATE TABLE IF NOT EXISTS trade_stock_items (
  item_id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  tracked integer NOT NULL DEFAULT 1 CHECK (tracked IN (0,1)),
  on_hand_milli integer NOT NULL DEFAULT 0 CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  low_stock_milli integer NOT NULL DEFAULT 0 CHECK (low_stock_milli BETWEEN 0 AND 1000000000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trade_stock_items_owner_idx ON trade_stock_items(firebase_uid, tracked);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_stock_reservations (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  work_order_id text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trade_stock_reservations_item_idx ON trade_stock_reservations(firebase_uid,item_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_stock_operations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  item_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('enable','configure','receive','count','disable','reserve','release')),
  payload_json text NOT NULL CHECK (json_valid(payload_json)),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  actor_uid text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_operations_replay_idx ON trade_stock_operations(firebase_uid,operation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_stock_movements (
  id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  action text NOT NULL CHECK (action IN ('enable','configure','receive','count','disable','reserve','release','use','return')),
  quantity_milli integer NOT NULL,
  change_milli integer NOT NULL,
  on_hand_milli integer NOT NULL CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  work_order_id text NOT NULL DEFAULT '',
  requirement_id text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  actor_uid text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trade_stock_movements_item_idx ON trade_stock_movements(firebase_uid,item_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_stock_actual_issues (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  work_order_id text NOT NULL,
  baseline_milli integer NOT NULL CHECK (baseline_milli BETWEEN 0 AND 1000000000),
  issued_milli integer NOT NULL CHECK (issued_milli BETWEEN 0 AND 1000000000),
  note text NOT NULL DEFAULT '',
  actor_uid text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trade_stock_actual_issues_item_idx ON trade_stock_actual_issues(firebase_uid,item_id);
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS trade_stock_active_reservations AS
SELECT s.* FROM trade_stock_reservations s
JOIN trade_crm_job_plan_requirements r ON r.id=s.requirement_id AND r.firebase_uid=s.firebase_uid AND r.source_id=s.item_id
JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid AND p.work_order_id=s.work_order_id
JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
JOIN trade_price_book_items i ON i.id=s.item_id AND i.firebase_uid=s.firebase_uid
JOIN trade_stock_items stock ON stock.item_id=s.item_id AND stock.firebase_uid=s.firebase_uid AND stock.tracked=1
WHERE w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND r.status NOT IN ('not_needed','completed')
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1);
