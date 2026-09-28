CREATE TABLE trade_stock_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  firebase_uid TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK(status IN ('review','received')),
  extraction_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extraction_json)),
  analysis_error TEXT NOT NULL DEFAULT '',
  confirmation_json TEXT NOT NULL DEFAULT '' CHECK(confirmation_json='' OR json_valid(confirmation_json)),
  confirmation_id TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  received_by_uid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by_uid TEXT NOT NULL
);
CREATE UNIQUE INDEX trade_stock_receipts_file_idx ON trade_stock_receipts(firebase_uid,sha256);
CREATE UNIQUE INDEX trade_stock_receipts_reference_idx ON trade_stock_receipts(firebase_uid,lower(trim(supplier)),lower(trim(reference))) WHERE status='received' AND supplier<>'' AND reference<>'';
CREATE INDEX trade_stock_receipts_owner_idx ON trade_stock_receipts(firebase_uid,created_at);
