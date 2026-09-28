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
AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1);` }
];

export const TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS: readonly Readonly<{ name: string; sql: string }>[] = [
  { name: "trade_stock_operation_revision_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_operation_revision_guard BEFORE INSERT ON trade_stock_operations
WHEN NOT EXISTS(SELECT 1 FROM trade_stock_operations WHERE firebase_uid=NEW.firebase_uid AND operation_id=NEW.operation_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM trade_price_book_items WHERE id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND item_type IN ('material','equipment')) THEN RAISE(ABORT,'STOCK_ITEM_NOT_FOUND') END;
  SELECT CASE WHEN COALESCE((SELECT revision FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid),0)<>NEW.expected_revision THEN RAISE(ABORT,'STOCK_STALE') END;
  SELECT CASE WHEN NEW.action='enable' AND EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND tracked=1) THEN RAISE(ABORT,'STOCK_STALE') END;
  SELECT CASE WHEN NEW.action<>'enable' AND NOT EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND tracked=1) THEN RAISE(ABORT,'STOCK_NOT_TRACKED') END;
  SELECT CASE WHEN NEW.action IN ('enable','reserve') AND NOT EXISTS(SELECT 1 FROM trade_price_book_items WHERE id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND record_status='active') THEN RAISE(ABORT,'STOCK_ITEM_NOT_FOUND') END;
  SELECT CASE WHEN NEW.action='disable' AND ((SELECT on_hand_milli FROM trade_stock_items WHERE item_id=NEW.item_id)>0 OR EXISTS(SELECT 1 FROM trade_stock_active_reservations WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND quantity_milli>0)) THEN RAISE(ABORT,'STOCK_NOT_EMPTY') END;
END;` },
  { name: "trade_stock_product_units_guard", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_product_units_guard BEFORE UPDATE OF item_type,unit_label ON trade_price_book_items
WHEN (NEW.item_type<>OLD.item_type OR NEW.unit_label<>OLD.unit_label) AND EXISTS(SELECT 1 FROM trade_stock_items WHERE item_id=OLD.id AND firebase_uid=OLD.firebase_uid AND tracked=1)
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
  SELECT CASE WHEN NEW.quantity_milli>(SELECT on_hand_milli FROM trade_stock_items WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid)-COALESCE((SELECT SUM(quantity_milli) FROM trade_stock_active_reservations WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid AND requirement_id<>NEW.requirement_id),0) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
END;` },
  { name: "trade_stock_actual_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_insert AFTER INSERT ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  INSERT INTO trade_stock_actual_issues(requirement_id,item_id,firebase_uid,work_order_id,baseline_milli,issued_milli,note,actor_uid,updated_at)
  SELECT NEW.job_plan_requirement_id,r.source_id,NEW.firebase_uid,NEW.work_order_id,0,NEW.quantity_milli,NEW.note,NEW.recorded_by_uid,NEW.updated_at FROM trade_crm_job_plan_requirements r WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_actual_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_actual_update AFTER UPDATE OF quantity_milli ON trade_crm_job_actuals
WHEN NEW.actual_type='material' AND NEW.quantity_milli<>OLD.quantity_milli AND EXISTS(SELECT 1 FROM trade_stock_items i JOIN trade_crm_job_plan_requirements r ON r.source_id=i.item_id AND r.firebase_uid=i.firebase_uid WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid AND i.tracked=1)
BEGIN
  INSERT INTO trade_stock_actual_issues(requirement_id,item_id,firebase_uid,work_order_id,baseline_milli,issued_milli,note,actor_uid,updated_at)
  SELECT NEW.job_plan_requirement_id,r.source_id,NEW.firebase_uid,NEW.work_order_id,OLD.quantity_milli,MAX(0,NEW.quantity_milli-OLD.quantity_milli),NEW.note,NEW.recorded_by_uid,NEW.updated_at FROM trade_crm_job_plan_requirements r WHERE r.id=NEW.job_plan_requirement_id AND r.firebase_uid=NEW.firebase_uid
  ON CONFLICT(requirement_id) DO UPDATE SET issued_milli=MAX(0,NEW.quantity_milli-trade_stock_actual_issues.baseline_milli),note=NEW.note,actor_uid=NEW.recorded_by_uid,updated_at=NEW.updated_at;
END;` },
  { name: "trade_stock_issue_insert", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_issue_insert AFTER INSERT ON trade_stock_actual_issues WHEN NEW.issued_milli>0
BEGIN
  SELECT CASE WHEN NEW.issued_milli>(SELECT i.on_hand_milli-COALESCE((SELECT SUM(s.quantity_milli) FROM trade_stock_active_reservations s WHERE s.item_id=i.item_id AND s.firebase_uid=i.firebase_uid AND s.requirement_id<>NEW.requirement_id),0) FROM trade_stock_items i WHERE i.item_id=NEW.item_id AND i.firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
  UPDATE trade_stock_items SET on_hand_milli=on_hand_milli-NEW.issued_milli,revision=revision+1,updated_at=NEW.updated_at WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid;
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),i.item_id,NEW.firebase_uid,'use',NEW.issued_milli,-NEW.issued_milli,i.on_hand_milli,NEW.work_order_id,NEW.requirement_id,NEW.note,NEW.actor_uid,NEW.updated_at FROM trade_stock_items i WHERE i.item_id=NEW.item_id AND i.firebase_uid=NEW.firebase_uid;
END;` },
  { name: "trade_stock_issue_update", sql: `CREATE TRIGGER IF NOT EXISTS trade_stock_issue_update AFTER UPDATE OF issued_milli ON trade_stock_actual_issues WHEN NEW.issued_milli<>OLD.issued_milli
BEGIN
  SELECT CASE WHEN NEW.issued_milli>OLD.issued_milli AND NEW.issued_milli-OLD.issued_milli>(SELECT i.on_hand_milli-COALESCE((SELECT SUM(s.quantity_milli) FROM trade_stock_active_reservations s WHERE s.item_id=i.item_id AND s.firebase_uid=i.firebase_uid AND s.requirement_id<>NEW.requirement_id),0) FROM trade_stock_items i WHERE i.item_id=NEW.item_id AND i.firebase_uid=NEW.firebase_uid) THEN RAISE(ABORT,'STOCK_SHORTAGE') END;
  UPDATE trade_stock_items SET on_hand_milli=on_hand_milli-NEW.issued_milli+OLD.issued_milli,revision=revision+1,updated_at=NEW.updated_at WHERE item_id=NEW.item_id AND firebase_uid=NEW.firebase_uid;
  INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
  SELECT lower(hex(randomblob(16))),i.item_id,NEW.firebase_uid,CASE WHEN NEW.issued_milli>OLD.issued_milli THEN 'use' ELSE 'return' END,ABS(NEW.issued_milli-OLD.issued_milli),OLD.issued_milli-NEW.issued_milli,i.on_hand_milli,NEW.work_order_id,NEW.requirement_id,NEW.note,NEW.actor_uid,NEW.updated_at FROM trade_stock_items i WHERE i.item_id=NEW.item_id AND i.firebase_uid=NEW.firebase_uid;
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
    MIN(NEW.quantity_milli,MAX(0,i.on_hand_milli-COALESCE((SELECT SUM(s.quantity_milli) FROM trade_stock_active_reservations s WHERE s.item_id=i.item_id AND s.firebase_uid=i.firebase_uid),0))),NEW.created_at
  FROM trade_stock_items i
  JOIN trade_price_book_items product ON product.id=i.item_id AND product.firebase_uid=i.firebase_uid AND product.record_status='active'
  JOIN trade_crm_job_plans p ON p.id=NEW.job_plan_id AND p.firebase_uid=NEW.firebase_uid
  JOIN trade_work_orders w ON w.id=p.work_order_id AND w.firebase_uid=p.firebase_uid
  JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  WHERE i.item_id=NEW.source_id AND i.firebase_uid=NEW.firebase_uid AND i.tracked=1 AND NEW.quantity_milli>0
  AND w.partner_type='installer' AND w.record_status='active' AND w.stage NOT IN ('cancelled','completed') AND d.customer_source='trade_owned'
  AND p.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=p.firebase_uid AND h.work_order_id=p.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
  AND i.on_hand_milli>COALESCE((SELECT SUM(s.quantity_milli) FROM trade_stock_active_reservations s WHERE s.item_id=i.item_id AND s.firebase_uid=i.firebase_uid),0);
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
END;` }
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
  for (const definition of TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) {
    const current = installed.get(definition.name);
    if (current && canonicalTradeStockSchemaSql(current) !== canonicalTradeStockSchemaSql(definition.sql)) throw new Error(`TRADE_STOCK_GUARD_MISMATCH:${definition.name}`);
  }
  const missing = TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS.filter(definition => !installed.has(definition.name));
  if (missing.length) await database.batch(missing.map(definition => database.prepare(definition.sql)));
  const verified = await database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all<{ name: string; sql: string | null }>();
  const verifiedMap = new Map(verified.results.map(row => [row.name, row.sql || ""]));
  for (const definition of TRADE_STOCK_SCHEMA_GUARD_DEFINITIONS) {
    if (canonicalTradeStockSchemaSql(verifiedMap.get(definition.name) || "") !== canonicalTradeStockSchemaSql(definition.sql)) throw new Error(`TRADE_STOCK_GUARD_UNAVAILABLE:${definition.name}`);
  }
  // Cache only completed verification. A disconnected request must not block another request's installation.
  ready.add(database);
}
