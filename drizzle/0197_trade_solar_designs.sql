-- Private, editable design geometry. Google imagery remains with its map provider.
CREATE TABLE trade_solar_designs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  work_order_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  panel_count INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by_uid TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT trade_solar_design_identity_check CHECK (length(id) BETWEEN 1 AND 180 AND length(owner_uid) > 0 AND length(trim(title)) BETWEEN 1 AND 180),
  CONSTRAINT trade_solar_design_geometry_check CHECK (panel_count BETWEEN 0 AND 500 AND revision > 0 AND length(data_json) <= 512000 AND json_valid(data_json)),
  CONSTRAINT trade_solar_design_snapshot_check CHECK (COALESCE(json_extract(data_json, '$.customerId') = customer_id AND json_extract(data_json, '$.workOrderId') = work_order_id AND json_extract(data_json, '$.title') = title AND json_array_length(data_json, '$.panels') = panel_count, 0))
);
CREATE INDEX trade_solar_design_owner_updated_idx ON trade_solar_designs(owner_uid, updated_at DESC, id);
CREATE INDEX trade_solar_design_customer_idx ON trade_solar_designs(owner_uid, customer_id, updated_at DESC);
CREATE INDEX trade_solar_design_work_idx ON trade_solar_designs(owner_uid, work_order_id, updated_at DESC);
