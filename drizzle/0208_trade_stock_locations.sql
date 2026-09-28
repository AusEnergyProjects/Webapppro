-- Location balances are physical counts. Job commitments remain business-wide.
CREATE TABLE IF NOT EXISTS trade_stock_locations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  responsible_member_id text NOT NULL DEFAULT '',
  is_default integer NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_name_idx ON trade_stock_locations(firebase_uid,name COLLATE NOCASE) WHERE responsible_member_id='';
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_default_idx ON trade_stock_locations(firebase_uid) WHERE is_default=1;
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_locations_member_idx ON trade_stock_locations(firebase_uid,responsible_member_id) WHERE responsible_member_id<>'';
CREATE TABLE IF NOT EXISTS trade_stock_location_balances (
  item_id text NOT NULL,
  location_id text NOT NULL,
  firebase_uid text NOT NULL,
  on_hand_milli integer NOT NULL DEFAULT 0 CHECK (on_hand_milli BETWEEN 0 AND 1000000000),
  updated_at text NOT NULL,
  PRIMARY KEY(item_id,location_id)
);
CREATE INDEX IF NOT EXISTS trade_stock_location_balances_owner_idx ON trade_stock_location_balances(firebase_uid,item_id);
CREATE TABLE IF NOT EXISTS trade_stock_usage_locations (
  requirement_id text NOT NULL,
  location_id text NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  PRIMARY KEY(requirement_id,location_id)
);
CREATE TABLE IF NOT EXISTS trade_stock_usage_selections (
  requirement_id text PRIMARY KEY NOT NULL,
  item_id text NOT NULL,
  firebase_uid text NOT NULL,
  quantity_milli integer NOT NULL CHECK (quantity_milli BETWEEN 0 AND 1000000000),
  locations_json text NOT NULL CHECK (json_valid(locations_json) AND json_type(locations_json)='array'),
  expected_revision integer NOT NULL CHECK (expected_revision>0)
);
CREATE TABLE IF NOT EXISTS trade_stock_location_operations (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  location_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create_location','rename_location')),
  payload_json text NOT NULL CHECK (json_valid(payload_json)),
  expected_revision integer NOT NULL CHECK (expected_revision>=0),
  actor_uid text NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_location_operations_replay_idx ON trade_stock_location_operations(firebase_uid,operation_id);
INSERT INTO trade_stock_locations(id,firebase_uid,name,is_default,revision,created_at,updated_at)
SELECT 'stock-main-'||firebase_uid,firebase_uid,'Main storage',1,1,MIN(updated_at),MAX(updated_at)
FROM trade_stock_items GROUP BY firebase_uid ON CONFLICT(id) DO NOTHING;
INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at)
SELECT item_id,'stock-main-'||firebase_uid,firebase_uid,on_hand_milli,updated_at FROM trade_stock_items s WHERE NOT EXISTS(SELECT 1 FROM trade_stock_location_balances b WHERE b.item_id=s.item_id AND b.firebase_uid=s.firebase_uid)
ON CONFLICT(item_id,location_id) DO NOTHING;
INSERT INTO trade_stock_usage_locations(requirement_id,location_id,item_id,firebase_uid,quantity_milli)
SELECT requirement_id,'stock-main-'||firebase_uid,item_id,firebase_uid,issued_milli FROM trade_stock_actual_issues i WHERE NOT EXISTS(SELECT 1 FROM trade_stock_usage_locations u WHERE u.requirement_id=i.requirement_id AND u.firebase_uid=i.firebase_uid)
ON CONFLICT(requirement_id,location_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS trade_stock_transfers (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_stock_transfers_replay_idx ON trade_stock_transfers(firebase_uid,operation_id);
CREATE TABLE IF NOT EXISTS trade_stock_location_rollout (
  id integer PRIMARY KEY NOT NULL CHECK(id=1),
  installed_at text NOT NULL
);
