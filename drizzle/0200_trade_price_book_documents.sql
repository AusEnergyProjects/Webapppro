CREATE TABLE trade_price_book_documents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  price_book_item_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  label TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 8 AND 8388608),
  page_count INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 40),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  object_key TEXT NOT NULL UNIQUE,
  record_status TEXT NOT NULL DEFAULT 'active' CHECK (record_status IN ('active', 'removed')),
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX trade_price_book_documents_item_idx ON trade_price_book_documents(owner_uid, price_book_item_id, record_status, created_at);
CREATE UNIQUE INDEX trade_price_book_documents_active_hash_idx ON trade_price_book_documents(owner_uid, price_book_item_id, sha256) WHERE record_status = 'active';
ALTER TABLE trade_crm_quote_versions ADD COLUMN product_documents_json TEXT NOT NULL DEFAULT '[]';
