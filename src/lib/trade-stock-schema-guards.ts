// Sites splits migration SQL on semicolons. Install complete trigger bodies with D1 prepared statements.
export const TRADE_STOCK_SCHEMA_OBJECTS: readonly Readonly<{ type: string; name: string; sql: string }>[] = [
  { type: "table", name: "trade_stock_items", sql: `CREATE TABLE trade_stock_items (
  item_id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  tracked integer NOT NULL DEFAULT 1 CHECK (tracked IN (0,1)),
  on_hand_milli integer NOT NULL DEFAULT 0 CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  low_stock_milli integer NOT NULL DEFAULT 0 CHECK (low_stock_milli BETWEEN 0 AND 1000000000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_items_owner_idx", sql: `CREATE INDEX trade_stock_items_owner_idx ON trade_stock_items(firebase_uid, tracked);` },
  { type: "table", name: "trade_stock_reservations", sql: `CREATE TABLE trade_stock_reservations (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  work_order_id text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  updated_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_reservations_item_idx", sql: `CREATE INDEX trade_stock_reservations_item_idx ON trade_stock_reservations(firebase_uid,item_id);` },
  { type: "table", name: "trade_stock_operations", sql: `CREATE TABLE trade_stock_operations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  item_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('enable','configure','receive','count','disable','reserve','release')),
  payload_json text NOT NULL CHECK (json_valid(payload_json)),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  actor_uid text NOT NULL,
  created_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_operations_replay_idx", sql: `CREATE UNIQUE INDEX trade_stock_operations_replay_idx ON trade_stock_operations(firebase_uid,operation_id);` },
  { type: "table", name: "trade_stock_movements", sql: `CREATE TABLE trade_stock_movements (
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
);` },
  { type: "index", name: "trade_stock_movements_item_idx", sql: `CREATE INDEX trade_stock_movements_item_idx ON trade_stock_movements(firebase_uid,item_id,created_at);` },
  { type: "table", name: "trade_stock_actual_issues", sql: `CREATE TABLE trade_stock_actual_issues (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  work_order_id text NOT NULL,
  baseline_milli integer NOT NULL CHECK (baseline_milli BETWEEN 0 AND 1000000000),
  issued_milli integer NOT NULL CHECK (issued_milli BETWEEN 0 AND 1000000000),
  note text NOT NULL DEFAULT '',
  actor_uid text NOT NULL,
  updated_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_actual_issues_item_idx", sql: `CREATE INDEX trade_stock_actual_issues_item_idx ON trade_stock_actual_issues(firebase_uid,item_id);` },
  { type: "view", name: "trade_stock_active_reservations", sql: `CREATE VIEW trade_stock_active_reservations AS
SELECT s.* FROM trade_stock_reservations s
JOIN trade_crm_job_plan_requirements r ON r.id=s.requirement_id AND r.firebase_uid=s.firebase_uid AND r.source_id=s.item_id
JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid AND p.work_order_id=s.work_order_id
JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
JOIN trade_price_book_items i ON i.id=s.item_id AND i.firebase_uid=s.firebase_uid
JOIN trade_stock_items stock ON stock.item_id=s.item_id AND stock.firebase_uid=s.firebase_uid AND stock.tracked=1
WHERE w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND r.status NOT IN ('not_needed','completed')
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1);` },
  { type: "table", name: "trade_stock_locations", sql: `CREATE TABLE IF NOT EXISTS trade_stock_locations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  responsible_member_id text NOT NULL DEFAULT '',
  is_default integer NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_locations_name_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_name_idx ON trade_stock_locations(firebase_uid,name COLLATE NOCASE) WHERE responsible_member_id='';` },
  { type: "index", name: "trade_stock_locations_default_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_default_idx ON trade_stock_locations(firebase_uid) WHERE is_default=1;` },
  { type: "index", name: "trade_stock_locations_member_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_member_idx ON trade_stock_locations(firebase_uid,responsible_member_id) WHERE responsible_member_id<>'';` },
  { type: "table", name: "trade_stock_location_balances", sql: `CREATE TABLE IF NOT EXISTS trade_stock_location_balances (
  item_id text NOT NULL,
  location_id text NOT NULL,
  firebase_uid text NOT NULL,
  on_hand_milli integer NOT NULL DEFAULT 0 CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  updated_at text NOT NULL,
  PRIMARY KEY(item_id,location_id)
);` },
  { type: "index", name: "trade_stock_location_balances_owner_idx", sql: `CREATE INDEX IF NOT EXISTS trade_stock_location_balances_owner_idx ON trade_stock_location_balances(firebase_uid,item_id);` },
  { type: "table", name: "trade_stock_usage_locations", sql: `CREATE TABLE IF NOT EXISTS trade_stock_usage_locations (
  requirement_id text NOT NULL,
  location_id text NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  PRIMARY KEY(requirement_id,location_id)
);` },
  { type: "table", name: "trade_stock_usage_selections", sql: `CREATE TABLE IF NOT EXISTS trade_stock_usage_selections (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  locations_json text NOT NULL CHECK (json_valid(locations_json) AND json_type(locations_json)='array'),
  expected_revision integer NOT NULL CHECK (expected_revision>0)
);` },
  { type: "table", name: "trade_stock_location_operations", sql: `CREATE TABLE IF NOT EXISTS trade_stock_location_operations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  location_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create_location','rename_location')),
  payload_json text NOT NULL CHECK (json_valid(payload_json)),
  expected_revision integer NOT NULL CHECK (expected_revision>=0),
  actor_uid text NOT NULL,
  created_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_location_operations_replay_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_location_operations_replay_idx ON trade_stock_location_operations(firebase_uid,operation_id);` },
  { type: "table", name: "trade_stock_transfers", sql: `CREATE TABLE IF NOT EXISTS trade_stock_transfers (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  item_id text NOT NULL,
  from_location_id text NOT NULL,
  to_location_id text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 1 AND 1000000000),
  on_hand_milli integer NOT NULL CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  expected_revision integer NOT NULL CHECK (expected_revision>0),
  payload_json text NOT NULL CHECK (json_valid(payload_json)),
  note text NOT NULL DEFAULT '',
  actor_uid text NOT NULL,
  created_at text NOT NULL
);` },
  { type: "index", name: "trade_stock_transfers_replay_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_transfers_replay_idx ON trade_stock_transfers(firebase_uid,operation_id);` },
  { type: "table", name: "trade_stock_location_rollout", sql: `CREATE TABLE IF NOT EXISTS trade_stock_location_rollout (
  id integer PRIMARY KEY NOT NULL CHECK(id=1),
  installed_at text NOT NULL
);` }
];

export const TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS: readonly Readonly<{ name: string; sql: string }>[] = [
  { name: "trade_stock_operation_revision_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_operation_revision_guard BEFORE INSERT ON trade_stock_operations
WHEN NOT EXISTS(SELECT 1 FROM trade_stock_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_stock_location_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM trade_stock_transfers WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) THEN RAISE(ABORT,'STOCK_OPERATION_REUSED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_price_book_items WHERE id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND item_type IN ('material','equipment')) THEN RAISE(ABORT,'STOCK_ITEM_NOT_FOUND') END;
  SELECT CASE WHEN COALESCE((SELECT revision FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),0)<>NEW.expected_revision THEN RAISE(ABORT,'STOCK_STALE') END;
  SELECT CASE WHEN NEW.action='enable' AND EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND tracked=1) THEN RAISE(ABORT,'STOCK_STALE') END;
  SELECT CASE WHEN NEW.action NOT IN ('enable','count') AND NOT EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND tracked=1) THEN RAISE(ABORT,'STOCK_NOT_TRACKED') END;
  SELECT CASE WHEN NEW.action='count' AND NOT EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_NOT_TRACKED') END;
  SELECT CASE WHEN NEW.action IN ('enable','reserve') AND NOT EXISTS(SELECT 1 FROM trade_price_book_items WHERE id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND record_status='active') THEN RAISE(ABORT,'STOCK_ITEM_NOT_FOUND') END;
  SELECT CASE WHEN NEW.action='disable' AND (EXISTS(SELECT 1 FROM trade_stock_active_reservations WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND quantity_milli>0)) THEN RAISE(ABORT,'STOCK_NOT_EMPTY') END;
END;` },
  { name: "trade_stock_product_units_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_product_units_guard BEFORE UPDATE OF item_type,unit_label ON trade_price_book_items
WHEN (NEW.item_type<>OLD.item_type OR NEW.unit_label<>OLD.unit_label) AND EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=OLD.id AND firebase_uid=OLD.firebase_uid AND (tracked=1 OR on_hand_milli>0))
BEGIN SELECT RAISE(ABORT,'STOCK_UNITS_LOCKED'); END;` },
  { name: "trade_stock_reservation_insert_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_reservation_insert_guard BEFORE INSERT ON trade_stock_reservations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM trade_crm_job_plan_requirements r
    JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
    JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
    JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    JOIN trade_stock_items i ON i.item_id=r.source_id AND i.firebase_uid=r.firebase_uid AND i.tracked=1
    WHERE r.id=NEW.requirement_id AND r.firebase_uid=NEW.firebase_uid AND r.source_id=NEW.item_id AND p.work_order_id=NEW.work_order_id
    AND r.requirement_type='material' AND r.status NOT IN ('completed','not_needed') AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
    AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
    AND NEW.quantity_milli<=MAX(0,r.quantity_milli-COALESCE((SELECT a.quantity_milli FROM trade_crm_job_actuals a WHERE a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid),0))
  ) THEN RAISE(ABORT,'STOCK_REQUIREMENT_UNAVAILABLE') END;
END;` },
  { name: "trade_stock_actual_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_insert AFTER INSERT ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  INSERT INTO trade_stock_actual_issues(requirement_id,item_id,firebase_uid,work_order_id,baseline_milli,issued_milli,note,actor_uid,updated_at)
  SELECT NEW.job_plan_requirement_id,r.source_id,NEW.firebase_uid,NEW.work_order_id,0,NEW.quantity_milli,NEW.note,NEW.recorded_by_uid,NEW.updated_at FROM trade_crm_job_plan_requirements r WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_actual_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_update AFTER UPDATE OF quantity_milli ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  INSERT INTO trade_stock_actual_issues(requirement_id,item_id,firebase_uid,work_order_id,baseline_milli,issued_milli,note,actor_uid,updated_at)
  SELECT NEW.job_plan_requirement_id,r.source_id,NEW.firebase_uid,NEW.work_order_id,OLD.quantity_milli,MAX(0,NEW.quantity_milli-OLD.quantity_milli),NEW.note,NEW.recorded_by_uid,NEW.updated_at FROM trade_crm_job_plan_requirements r WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid
  ON CONFLICT(requirement_id) DO UPDATE SET issued_milli=MAX(0,NEW.quantity_milli-trade_stock_actual_issues.baseline_milli),note=NEW.note,actor_uid=NEW.recorded_by_uid,updated_at=NEW.updated_at;
END;` },
  { name: "trade_stock_issue_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_issue_insert AFTER INSERT ON trade_stock_actual_issues
BEGIN
  SELECT CASE WHEN COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END) IS NULL THEN RAISE(ABORT,'STOCK_LOCATION_REQUIRED') END;
  SELECT CASE WHEN COALESCE((SELECT SUM(json_extract(value,'$.quantityMilli')) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END))),0)<>NEW.issued_milli THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j WHERE NOT EXISTS(SELECT 1 FROM trade_stock_locations l WHERE l.id=json_extract(j.value,'$.locationId') AND l.firebase_uid=NEW.firebase_uid) OR typeof(json_extract(j.value,'$.quantityMilli'))<>'integer' OR json_extract(j.value,'$.quantityMilli')<0) THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)))<>(SELECT COUNT(DISTINCT json_extract(value,'$.locationId')) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END))) THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j WHERE json_extract(j.value,'$.quantityMilli')>COALESCE((SELECT on_hand_milli FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND location_id=json_extract(j.value,'$.locationId') AND firebase_uid=NEW.firebase_uid),0)+COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND location_id=json_extract(j.value,'$.locationId') AND firebase_uid=NEW.firebase_uid),0)) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_work_orders WHERE id=NEW.work_order_id AND firebase_uid=NEW.firebase_uid AND stage='cancelled') AND EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),'[]')) j WHERE json_extract(j.value,'$.quantityMilli')>COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid AND location_id=json_extract(j.value,'$.locationId')),0)) THEN RAISE(ABORT,'STOCK_REQUIREMENT_UNAVAILABLE') END;
  INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at)
    SELECT NEW.item_id,id,NEW.firebase_uid,0,NEW.updated_at FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid
    ON CONFLICT(item_id,location_id) DO NOTHING;
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
    SELECT lower(hex(randomblob(16))),NEW.item_id,NEW.firebase_uid,
      CASE WHEN COALESCE(u.quantity_milli,0)>COALESCE(json_extract(j.value,'$.quantityMilli'),0) THEN 'return' ELSE 'use' END,
      ABS(COALESCE(u.quantity_milli,0)-COALESCE(json_extract(j.value,'$.quantityMilli'),0)),
      COALESCE(u.quantity_milli,0)-COALESCE(json_extract(j.value,'$.quantityMilli'),0),
      (SELECT on_hand_milli FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid)+COALESCE((SELECT SUM(quantity_milli) FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),0)-NEW.issued_milli,
      NEW.work_order_id,NEW.requirement_id,trim(NEW.note||' ['||l.name||']'),NEW.actor_uid,NEW.updated_at
    FROM trade_stock_locations l LEFT JOIN trade_stock_usage_locations u ON u.location_id=l.id AND u.requirement_id=NEW.requirement_id AND u.firebase_uid=NEW.firebase_uid
    LEFT JOIN json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j ON json_extract(j.value,'$.locationId')=l.id
    WHERE l.firebase_uid=NEW.firebase_uid AND COALESCE(u.quantity_milli,0)<>COALESCE(json_extract(j.value,'$.quantityMilli'),0);
  UPDATE trade_stock_location_balances SET on_hand_milli=on_hand_milli+
    COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND location_id=trade_stock_location_balances.location_id AND firebase_uid=NEW.firebase_uid),0)-
    COALESCE((SELECT json_extract(value,'$.quantityMilli') FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) WHERE json_extract(value,'$.locationId')=trade_stock_location_balances.location_id),0),updated_at=NEW.updated_at
    WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid;
  UPDATE trade_stock_items SET on_hand_milli=(SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),revision=revision+1,updated_at=NEW.updated_at
    WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND EXISTS(
      SELECT 1 FROM trade_stock_locations l LEFT JOIN trade_stock_usage_locations u ON u.location_id=l.id AND u.requirement_id=NEW.requirement_id AND u.firebase_uid=NEW.firebase_uid
      LEFT JOIN json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j ON json_extract(j.value,'$.locationId')=l.id
      WHERE l.firebase_uid=NEW.firebase_uid AND COALESCE(u.quantity_milli,0)<>COALESCE(json_extract(j.value,'$.quantityMilli'),0));
  DELETE FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid;
  INSERT INTO trade_stock_usage_locations(requirement_id,location_id,item_id,firebase_uid,quantity_milli)
    SELECT NEW.requirement_id,json_extract(value,'$.locationId'),NEW.item_id,NEW.firebase_uid,json_extract(value,'$.quantityMilli') FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END));
  DELETE FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_issue_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_issue_update AFTER UPDATE OF issued_milli ON trade_stock_actual_issues
BEGIN
  SELECT CASE WHEN COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END) IS NULL THEN RAISE(ABORT,'STOCK_LOCATION_REQUIRED') END;
  SELECT CASE WHEN COALESCE((SELECT SUM(json_extract(value,'$.quantityMilli')) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END))),0)<>NEW.issued_milli THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j WHERE NOT EXISTS(SELECT 1 FROM trade_stock_locations l WHERE l.id=json_extract(j.value,'$.locationId') AND l.firebase_uid=NEW.firebase_uid) OR typeof(json_extract(j.value,'$.quantityMilli'))<>'integer' OR json_extract(j.value,'$.quantityMilli')<0) THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)))<>(SELECT COUNT(DISTINCT json_extract(value,'$.locationId')) FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END))) THEN RAISE(ABORT,'STOCK_INVALID_LOCATION') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j WHERE json_extract(j.value,'$.quantityMilli')>COALESCE((SELECT on_hand_milli FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND location_id=json_extract(j.value,'$.locationId') AND firebase_uid=NEW.firebase_uid),0)+COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND location_id=json_extract(j.value,'$.locationId') AND firebase_uid=NEW.firebase_uid),0)) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_work_orders WHERE id=NEW.work_order_id AND firebase_uid=NEW.firebase_uid AND stage='cancelled') AND EXISTS(SELECT 1 FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),'[]')) j WHERE json_extract(j.value,'$.quantityMilli')>COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid AND location_id=json_extract(j.value,'$.locationId')),0)) THEN RAISE(ABORT,'STOCK_REQUIREMENT_UNAVAILABLE') END;
  INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at)
    SELECT NEW.item_id,id,NEW.firebase_uid,0,NEW.updated_at FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid
    ON CONFLICT(item_id,location_id) DO NOTHING;
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
    SELECT lower(hex(randomblob(16))),NEW.item_id,NEW.firebase_uid,
      CASE WHEN COALESCE(u.quantity_milli,0)>COALESCE(json_extract(j.value,'$.quantityMilli'),0) THEN 'return' ELSE 'use' END,
      ABS(COALESCE(u.quantity_milli,0)-COALESCE(json_extract(j.value,'$.quantityMilli'),0)),
      COALESCE(u.quantity_milli,0)-COALESCE(json_extract(j.value,'$.quantityMilli'),0),
      (SELECT on_hand_milli FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid)+COALESCE((SELECT SUM(quantity_milli) FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),0)-NEW.issued_milli,
      NEW.work_order_id,NEW.requirement_id,trim(NEW.note||' ['||l.name||']'),NEW.actor_uid,NEW.updated_at
    FROM trade_stock_locations l LEFT JOIN trade_stock_usage_locations u ON u.location_id=l.id AND u.requirement_id=NEW.requirement_id AND u.firebase_uid=NEW.firebase_uid
    LEFT JOIN json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j ON json_extract(j.value,'$.locationId')=l.id
    WHERE l.firebase_uid=NEW.firebase_uid AND COALESCE(u.quantity_milli,0)<>COALESCE(json_extract(j.value,'$.quantityMilli'),0);
  UPDATE trade_stock_location_balances SET on_hand_milli=on_hand_milli+
    COALESCE((SELECT quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND location_id=trade_stock_location_balances.location_id AND firebase_uid=NEW.firebase_uid),0)-
    COALESCE((SELECT json_extract(value,'$.quantityMilli') FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) WHERE json_extract(value,'$.locationId')=trade_stock_location_balances.location_id),0),updated_at=NEW.updated_at
    WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid;
  UPDATE trade_stock_items SET on_hand_milli=(SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),revision=revision+1,updated_at=NEW.updated_at
    WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND EXISTS(
      SELECT 1 FROM trade_stock_locations l LEFT JOIN trade_stock_usage_locations u ON u.location_id=l.id AND u.requirement_id=NEW.requirement_id AND u.firebase_uid=NEW.firebase_uid
      LEFT JOIN json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END)) j ON json_extract(j.value,'$.locationId')=l.id
      WHERE l.firebase_uid=NEW.firebase_uid AND COALESCE(u.quantity_milli,0)<>COALESCE(json_extract(j.value,'$.quantityMilli'),0));
  DELETE FROM trade_stock_usage_locations WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid;
  INSERT INTO trade_stock_usage_locations(requirement_id,location_id,item_id,firebase_uid,quantity_milli)
    SELECT NEW.requirement_id,json_extract(value,'$.locationId'),NEW.item_id,NEW.firebase_uid,json_extract(value,'$.quantityMilli') FROM json_each(COALESCE((SELECT locations_json FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid),
    CASE WHEN (SELECT COUNT(*) FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid)=1 THEN
      json_array(json_object('locationId',(SELECT id FROM trade_stock_locations WHERE firebase_uid=NEW.firebase_uid AND is_default=1),'quantityMilli',NEW.issued_milli))
    END));
  DELETE FROM trade_stock_usage_selections WHERE requirement_id=NEW.requirement_id AND firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_job_release", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_job_release AFTER UPDATE OF stage,record_status ON trade_work_orders
WHEN NEW.stage IN ('cancelled','completed') OR NEW.record_status<>'active'
BEGIN
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),s.item_id,s.firebase_uid,'release',s.quantity_milli,0,i.on_hand_milli,s.work_order_id,s.requirement_id,'Job allocation released',NEW.firebase_uid,NEW.updated_at FROM trade_stock_reservations s JOIN trade_stock_items i ON i.item_id=s.item_id AND i.firebase_uid=s.firebase_uid WHERE s.work_order_id=NEW.id AND s.firebase_uid=NEW.firebase_uid;
  UPDATE trade_stock_items SET revision=revision+1,updated_at=NEW.updated_at WHERE firebase_uid=NEW.firebase_uid AND item_id IN (SELECT item_id FROM trade_stock_reservations WHERE work_order_id=NEW.id AND firebase_uid=NEW.firebase_uid);
  DELETE FROM trade_stock_reservations WHERE work_order_id=NEW.id AND firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_requirement_release", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_requirement_release AFTER UPDATE OF status ON trade_crm_job_plan_requirements
WHEN NEW.status IN ('not_needed','completed')
BEGIN
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),s.item_id,s.firebase_uid,'release',s.quantity_milli,0,i.on_hand_milli,s.work_order_id,s.requirement_id,'Material allocation released',NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM trade_stock_reservations s JOIN trade_stock_items i ON i.item_id=s.item_id AND i.firebase_uid=s.firebase_uid WHERE s.requirement_id=NEW.id AND s.firebase_uid=NEW.firebase_uid;
  UPDATE trade_stock_items SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE firebase_uid=NEW.firebase_uid AND item_id IN (SELECT item_id FROM trade_stock_reservations WHERE requirement_id=NEW.id AND firebase_uid=NEW.firebase_uid);
  DELETE FROM trade_stock_reservations WHERE requirement_id=NEW.id AND firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_superseded_release", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_superseded_release AFTER INSERT ON trade_crm_commercial_handovers
BEGIN
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),s.item_id,s.firebase_uid,'release',s.quantity_milli,0,i.on_hand_milli,s.work_order_id,s.requirement_id,'Previous accepted scope replaced',NEW.firebase_uid,NEW.created_at FROM trade_stock_reservations s JOIN trade_stock_items i ON i.item_id=s.item_id AND i.firebase_uid=s.firebase_uid WHERE s.work_order_id=NEW.work_order_id AND s.firebase_uid=NEW.firebase_uid;
  UPDATE trade_stock_items SET revision=revision+1,updated_at=NEW.created_at WHERE firebase_uid=NEW.firebase_uid AND item_id IN (SELECT item_id FROM trade_stock_reservations WHERE work_order_id=NEW.work_order_id AND firebase_uid=NEW.firebase_uid);
  DELETE FROM trade_stock_reservations WHERE work_order_id=NEW.work_order_id AND firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_accepted_requirement_allocate", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_accepted_requirement_allocate AFTER INSERT ON trade_crm_job_plan_requirements
WHEN NEW.requirement_type='material' AND NEW.status NOT IN ('not_needed','completed')
BEGIN
  INSERT INTO trade_stock_reservations(requirement_id,item_id,firebase_uid,work_order_id,quantity_milli,updated_at)
  SELECT NEW.id,NEW.source_id,NEW.firebase_uid,p.work_order_id,
    NEW.quantity_milli,NEW.created_at
  FROM trade_stock_items i
  JOIN trade_price_book_items product ON product.id=i.item_id AND product.firebase_uid=i.firebase_uid AND product.record_status='active'
  JOIN trade_crm_job_plans p ON p.id=NEW.job_plan_id AND p.firebase_uid=NEW.firebase_uid
  JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
  JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  WHERE i.item_id=NEW.source_id AND i.firebase_uid=NEW.firebase_uid AND i.tracked=1 AND NEW.quantity_milli>0
  AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
  AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1);
  UPDATE trade_stock_items SET revision=revision+1,updated_at=NEW.created_at WHERE item_id=NEW.source_id AND firebase_uid=NEW.firebase_uid AND EXISTS(SELECT 1 FROM trade_stock_reservations WHERE requirement_id=NEW.id AND firebase_uid=NEW.firebase_uid);
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),s.item_id,s.firebase_uid,'reserve',s.quantity_milli,0,i.on_hand_milli,s.work_order_id,s.requirement_id,'Allocated from accepted quote',NEW.firebase_uid,NEW.created_at FROM trade_stock_reservations s JOIN trade_stock_items i ON i.item_id=s.item_id AND i.firebase_uid=s.firebase_uid WHERE s.requirement_id=NEW.id AND s.firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_actual_insert_scope", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_insert_scope BEFORE INSERT ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND p.work_order_id=NEW.work_order_id AND w.record_status='active' AND d.customer_source='trade_owned'
    AND ((w.stage<>'cancelled' AND r.status<>'not_needed' AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1))
      OR (w.stage='cancelled' AND EXISTS(SELECT 1 FROM trade_crm_job_actuals a WHERE a.job_plan_requirement_id=NEW.job_plan_requirement_id AND a.firebase_uid=NEW.firebase_uid AND a.quantity_milli>=NEW.quantity_milli)))) THEN RAISE(ABORT,'STOCK_REQUIREMENT_UNAVAILABLE') END;
END;` },
  { name: "trade_stock_actual_update_scope", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_update_scope BEFORE UPDATE ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND p.work_order_id=NEW.work_order_id AND w.record_status='active' AND d.customer_source='trade_owned'
    AND ((w.stage<>'cancelled' AND r.status<>'not_needed' AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1))
      OR (w.stage='cancelled' AND OLD.quantity_milli>=NEW.quantity_milli))) THEN RAISE(ABORT,'STOCK_REQUIREMENT_UNAVAILABLE') END;
END;` },
  { name: "trade_stock_location_operation_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_location_operation_guard BEFORE INSERT ON trade_stock_location_operations
WHEN NOT EXISTS(SELECT 1 FROM trade_stock_location_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_stock_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM trade_stock_transfers WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) THEN RAISE(ABORT,'STOCK_OPERATION_REUSED') END;
  SELECT CASE WHEN NEW.action='rename_location' AND NOT EXISTS(SELECT 1 FROM trade_stock_locations WHERE id=NEW.location_id AND firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_LOCATION_NOT_FOUND') END;
  SELECT CASE WHEN NEW.expected_revision<>COALESCE((SELECT revision FROM trade_stock_locations WHERE id=NEW.location_id AND firebase_uid=NEW.firebase_uid),0) THEN RAISE(ABORT,'STOCK_STALE') END;
END;` },
  { name: "trade_stock_usage_selection_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_usage_selection_guard BEFORE INSERT ON trade_stock_usage_selections
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.item_id=NEW.item_id AND i.tracked=1) THEN RAISE(ABORT,'STOCK_NOT_TRACKED') END;
  SELECT CASE WHEN NEW.expected_revision<>(SELECT revision FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_STALE') END;
END;` },
  { name: "trade_stock_paused_actual_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_paused_actual_guard BEFORE UPDATE OF quantity_milli ON trade_crm_job_actuals
WHEN NEW.quantity_milli<>OLD.quantity_milli AND EXISTS(SELECT 1 FROM trade_stock_actual_issues u JOIN trade_stock_items i ON i.item_id=u.item_id AND i.firebase_uid=u.firebase_uid WHERE u.requirement_id=NEW.job_plan_requirement_id AND u.firebase_uid=NEW.firebase_uid AND i.tracked=0)
BEGIN SELECT RAISE(ABORT,'STOCK_TRACKING_PAUSED'); END;` },
  { name: "trade_stock_transfer_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_transfer_guard BEFORE INSERT ON trade_stock_transfers
WHEN NOT EXISTS(SELECT 1 FROM trade_stock_transfers WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id)
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM trade_stock_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM trade_stock_location_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id) THEN RAISE(ABORT,'STOCK_OPERATION_REUSED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND tracked=1) THEN RAISE(ABORT,'STOCK_NOT_TRACKED') END;
  SELECT CASE WHEN NEW.expected_revision<>(SELECT revision FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_STALE') END;
  SELECT CASE WHEN NEW.from_location_id=NEW.to_location_id OR NOT EXISTS(SELECT 1 FROM trade_stock_locations WHERE id=NEW.from_location_id AND firebase_uid=NEW.firebase_uid) OR NOT EXISTS(SELECT 1 FROM trade_stock_locations WHERE id=NEW.to_location_id AND firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_LOCATION_NOT_FOUND') END;
  SELECT CASE WHEN NEW.quantity_milli>COALESCE((SELECT on_hand_milli FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND location_id=NEW.from_location_id AND firebase_uid=NEW.firebase_uid),0) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
END;` },
  { name: "trade_stock_location_member_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_location_member_insert BEFORE INSERT ON trade_stock_locations WHEN NEW.responsible_member_id<>''
BEGIN
  SELECT CASE WHEN NEW.is_default=1 OR NOT EXISTS(SELECT 1 FROM trade_team_members WHERE id=NEW.responsible_member_id AND owner_uid=NEW.firebase_uid AND status='active') THEN RAISE(ABORT,'STOCK_INVALID_MEMBER') END;
END;` },
  { name: "trade_stock_location_member_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_location_member_update BEFORE UPDATE OF responsible_member_id ON trade_stock_locations WHEN NEW.responsible_member_id<>'' AND NEW.responsible_member_id<>OLD.responsible_member_id
BEGIN
  SELECT CASE WHEN NEW.is_default=1 OR NOT EXISTS(SELECT 1 FROM trade_team_members WHERE id=NEW.responsible_member_id AND owner_uid=NEW.firebase_uid AND status='active') THEN RAISE(ABORT,'STOCK_INVALID_MEMBER') END;
END;` },
  { name: "trade_stock_aggregate_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_aggregate_insert BEFORE INSERT ON trade_stock_items WHEN NEW.on_hand_milli<>COALESCE((SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),0)
BEGIN SELECT RAISE(ABORT,'STOCK_REFRESH_REQUIRED'); END;` },
  { name: "trade_stock_aggregate_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_aggregate_update BEFORE UPDATE OF on_hand_milli ON trade_stock_items WHEN NEW.on_hand_milli<>COALESCE((SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),0)
BEGIN SELECT RAISE(ABORT,'STOCK_REFRESH_REQUIRED'); END;` },
  { name: "trade_stock_issue_delete", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_issue_delete BEFORE DELETE ON trade_stock_actual_issues
BEGIN SELECT RAISE(ABORT,'STOCK_REFRESH_REQUIRED'); END;` }
];

// Canonical SHA-256 fingerprints of the released 0207 guards. Only these known definitions may be upgraded.
const PREVIOUS_GUARD_HASHES: Record<string, string> = {
  "trade_stock_operation_revision_guard": "304390effc522aaea5e0502c810378395603befd72c87c386f780feffd631c4f",
  "trade_stock_product_units_guard": "2080e2565be31f68232614ab414e6a68dc9451fa74efb0dc1d9f1d141bc794a5",
  "trade_stock_reservation_insert_guard": "862b42a2258c707968d35704b7200eb6ac5c3213b8cce0ca3c1f84c4912c445b",
  "trade_stock_actual_insert": "2fb8f7bcab0b7374cb9b040b9a3155c661f54cb7f70cd487d36f976530b52ee3",
  "trade_stock_actual_update": "9c5a45588926dfcf0572cdd985262689e29481548e1869218dec8b221f27a135",
  "trade_stock_issue_insert": "6618627a78fd88782dd7114277cb7b59814807026b4bc166d483c14773b35be7",
  "trade_stock_issue_update": "10879e8cd64259bd3e7a899c4f4cb063cf085715a51853ea4a86341b4a49dfdc",
  "trade_stock_job_release": "5c2023496dd6957cf107ddb916d71911c99bc9bea2091120a5a453b05d1b8457",
  "trade_stock_requirement_release": "a9c1c107499eeb02a2b8e66a1746669c41c16572e07515f276778ea8213a8c8d",
  "trade_stock_superseded_release": "3cd4acbada52020a71ae09155db475c21db815917259b75b71a9bce57e5f09f4",
  "trade_stock_accepted_requirement_allocate": "d77dea3b266dc2c02d2484b9fc4b845adffbde0ecab54c368b7021baea75f30f",
  "trade_stock_actual_insert_scope": "0b72bb202906447dfc214a94386caa7a084e3a00e35acfb96e6778777c71dcc9",
  "trade_stock_actual_update_scope": "0b6ed0991e7b868a0821628a73356c5662f2eb468309103b54231e80aab48654"
};

async function schemaHash(sql: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTradeStockSchemaSql(sql)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

const LOCATION_ROLLOUT_STATEMENTS = [
  `INSERT INTO trade_stock_locations(id,firebase_uid,name,is_default,revision,created_at,updated_at) SELECT 'stock-main-'||firebase_uid,firebase_uid,'Main storage',1,1,MIN(updated_at),MAX(updated_at) FROM trade_stock_items WHERE NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1) GROUP BY firebase_uid ON CONFLICT(id) DO NOTHING`,
  `INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at) SELECT item_id,'stock-main-'||firebase_uid,firebase_uid,on_hand_milli,updated_at FROM trade_stock_items WHERE NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1) ON CONFLICT(item_id,location_id) DO UPDATE SET on_hand_milli=excluded.on_hand_milli,updated_at=excluded.updated_at`,
  `INSERT INTO trade_stock_usage_locations(requirement_id,location_id,item_id,firebase_uid,quantity_milli) SELECT requirement_id,'stock-main-'||firebase_uid,item_id,firebase_uid,issued_milli FROM trade_stock_actual_issues WHERE NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1) ON CONFLICT(requirement_id,location_id) DO UPDATE SET quantity_milli=excluded.quantity_milli`,
  `INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at) SELECT lower(hex(randomblob(16))),i.item_id,r.firebase_uid,'reserve',MAX(0,r.quantity_milli-COALESCE(a.quantity_milli,0)),0,i.on_hand_milli,p.work_order_id,r.id,'Full commitment from accepted quote',r.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM trade_crm_job_plan_requirements r
JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
JOIN trade_stock_items i ON i.item_id=r.source_id AND i.firebase_uid=r.firebase_uid AND i.tracked=1
JOIN trade_price_book_items product ON product.id=i.item_id AND product.firebase_uid=i.firebase_uid AND product.record_status='active'
LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
LEFT JOIN trade_stock_reservations s ON s.requirement_id=r.id AND s.firebase_uid=r.firebase_uid
WHERE r.requirement_type='material' AND r.status NOT IN ('not_needed','completed') AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
AND MAX(0,r.quantity_milli-COALESCE(a.quantity_milli,0))>COALESCE(s.quantity_milli,0)
AND NOT EXISTS(SELECT 1 FROM trade_stock_operations o WHERE o.firebase_uid=r.firebase_uid AND o.action IN ('reserve','release') AND json_extract(o.payload_json,'$.requirementId')=r.id)
AND NOT EXISTS(SELECT 1 FROM trade_stock_movements m WHERE m.firebase_uid=r.firebase_uid AND m.requirement_id=r.id AND m.action='release')
AND NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1)`,
  `UPDATE trade_stock_items SET revision=revision+1 WHERE item_id IN (SELECT i.item_id FROM trade_crm_job_plan_requirements r
JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
JOIN trade_stock_items i ON i.item_id=r.source_id AND i.firebase_uid=r.firebase_uid AND i.tracked=1
JOIN trade_price_book_items product ON product.id=i.item_id AND product.firebase_uid=i.firebase_uid AND product.record_status='active'
LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
LEFT JOIN trade_stock_reservations s ON s.requirement_id=r.id AND s.firebase_uid=r.firebase_uid
WHERE r.requirement_type='material' AND r.status NOT IN ('not_needed','completed') AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
AND MAX(0,r.quantity_milli-COALESCE(a.quantity_milli,0))>COALESCE(s.quantity_milli,0)
AND NOT EXISTS(SELECT 1 FROM trade_stock_operations o WHERE o.firebase_uid=r.firebase_uid AND o.action IN ('reserve','release') AND json_extract(o.payload_json,'$.requirementId')=r.id)
AND NOT EXISTS(SELECT 1 FROM trade_stock_movements m WHERE m.firebase_uid=r.firebase_uid AND m.requirement_id=r.id AND m.action='release')
AND NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1))`,
  `INSERT INTO trade_stock_reservations(requirement_id,item_id,firebase_uid,work_order_id,quantity_milli,updated_at) SELECT r.id,i.item_id,r.firebase_uid,p.work_order_id,MAX(0,r.quantity_milli-COALESCE(a.quantity_milli,0)),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM trade_crm_job_plan_requirements r
JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
JOIN trade_stock_items i ON i.item_id=r.source_id AND i.firebase_uid=r.firebase_uid AND i.tracked=1
JOIN trade_price_book_items product ON product.id=i.item_id AND product.firebase_uid=i.firebase_uid AND product.record_status='active'
LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
LEFT JOIN trade_stock_reservations s ON s.requirement_id=r.id AND s.firebase_uid=r.firebase_uid
WHERE r.requirement_type='material' AND r.status NOT IN ('not_needed','completed') AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
AND MAX(0,r.quantity_milli-COALESCE(a.quantity_milli,0))>COALESCE(s.quantity_milli,0)
AND NOT EXISTS(SELECT 1 FROM trade_stock_operations o WHERE o.firebase_uid=r.firebase_uid AND o.action IN ('reserve','release') AND json_extract(o.payload_json,'$.requirementId')=r.id)
AND NOT EXISTS(SELECT 1 FROM trade_stock_movements m WHERE m.firebase_uid=r.firebase_uid AND m.requirement_id=r.id AND m.action='release')
AND NOT EXISTS(SELECT 1 FROM trade_stock_location_rollout WHERE id=1) ON CONFLICT(requirement_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,updated_at=excluded.updated_at`,
  `INSERT INTO trade_stock_location_rollout(id,installed_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING`
];

const ready = new WeakSet<object>();

export function canonicalTradeStockSchemaSql(sql: string) {
  return sql.trim().replace(/^(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER))\s+IF\s+NOT\s+EXISTS\s+/i, "$1 ")
    .replace(/;\s*$/, "")
    .replace(/('(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`)|\s+/g, (match, quoted: string | undefined) => quoted ?? " ");
}

export async function ensureTradeStockSchemaGuards(database: D1Database) {
  if (ready.has(database)) return;
  const objects = await database.prepare(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${TRADE_STOCK_SCHEMA_OBJECTS.map(() => "?").join(",")})`)
    .bind(...TRADE_STOCK_SCHEMA_OBJECTS.map(object => object.name)).all<{ type: string; name: string; sql: string | null }>();
  const installedObjects = new Map(objects.results.map(object => [object.name, object]));
  for (const expected of TRADE_STOCK_SCHEMA_OBJECTS) {
    const current = installedObjects.get(expected.name);
    if (!current) throw new Error(`TRADE_STOCK_MIGRATIONS_REQUIRED:${expected.name}`);
    if (current.type !== expected.type || canonicalTradeStockSchemaSql(current.sql || "") !== canonicalTradeStockSchemaSql(expected.sql)) {
      throw new Error(`TRADE_STOCK_SCHEMA_MISMATCH:${expected.name}`);
    }
  }
  const rows = await database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all<{ name: string; sql: string | null }>();
  const installed = new Map(rows.results.map(row => [row.name, row.sql || ""]));
  const upgrades: D1PreparedStatement[] = [];
  for (const definition of TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) {
    const current = installed.get(definition.name);
    if (current && canonicalTradeStockSchemaSql(current) !== canonicalTradeStockSchemaSql(definition.sql)) {
      if (!PREVIOUS_GUARD_HASHES[definition.name] || await schemaHash(current) !== PREVIOUS_GUARD_HASHES[definition.name]) throw new Error(`TRADE_STOCK_GUARD_MISMATCH:${definition.name}`);
      upgrades.push(database.prepare(`DROP TRIGGER IF EXISTS ${definition.name}`), database.prepare(definition.sql));
    } else if (!current) upgrades.push(database.prepare(definition.sql));
  }
  const rollout = await database.prepare("SELECT id FROM trade_stock_location_rollout WHERE id=1").all<{id:number}>();
  if (!rollout.results.length) upgrades.push(...LOCATION_ROLLOUT_STATEMENTS.map(sql=>database.prepare(sql)));
  if (upgrades.length) await database.batch(upgrades);
  const verified = await database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all<{ name: string; sql: string | null }>();
  const verifiedMap = new Map(verified.results.map(row => [row.name, row.sql || ""]));
  for (const definition of TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) {
    if (canonicalTradeStockSchemaSql(verifiedMap.get(definition.name) || "") !== canonicalTradeStockSchemaSql(definition.sql)) throw new Error(`TRADE_STOCK_GUARD_UNAVAILABLE:${definition.name}`);
  }
  const rolloutVerified = await database.prepare("SELECT id FROM trade_stock_location_rollout WHERE id=1").all<{id:number}>();
  if (!rolloutVerified.results.length) throw new Error("TRADE_STOCK_GUARD_UNAVAILABLE:location_rollout");
  // Cache only completed verification. A disconnected request must not block another request's installation.
  ready.add(database);
}
