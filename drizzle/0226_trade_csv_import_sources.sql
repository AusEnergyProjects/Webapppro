CREATE TABLE trade_csv_import_files (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  batch_id text NOT NULL,
  file_id text NOT NULL,
  file_name text NOT NULL,
  file_role text NOT NULL CHECK(file_role IN ('customers','jobs')),
  source_sha256 text NOT NULL CHECK(length(source_sha256)=64),
  mapping_json text NOT NULL CHECK(json_valid(mapping_json)),
  options_json text NOT NULL CHECK(json_valid(options_json)),
  row_count integer NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_csv_import_files_batch_idx ON trade_csv_import_files(firebase_uid,batch_id,file_id);
--> statement-breakpoint
CREATE TABLE trade_csv_import_file_chunks (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  file_id text NOT NULL,
  chunk_index integer NOT NULL,
  source_text text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_csv_import_file_chunks_order_idx ON trade_csv_import_file_chunks(firebase_uid,file_id,chunk_index);
--> statement-breakpoint
CREATE TABLE trade_csv_import_sources (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  source_namespace text NOT NULL,
  entity_type text NOT NULL CHECK(entity_type IN ('customer','job')),
  source_id text NOT NULL CHECK(trim(source_id)<>''),
  row_sha256 text NOT NULL CHECK(length(row_sha256)=64),
  mapping_sha256 text NOT NULL CHECK(length(mapping_sha256)=64),
  raw_json text NOT NULL CHECK(json_valid(raw_json)),
  import_batch_id text NOT NULL,
  import_row_id text NOT NULL,
  source_file_id text NOT NULL,
  source_row_number integer NOT NULL,
  work_order_id text NOT NULL DEFAULT '',
  customer_id text NOT NULL,
  service_site_id text NOT NULL DEFAULT '',
  customer_key text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_csv_import_sources_identity_idx ON trade_csv_import_sources(firebase_uid,source_namespace,entity_type,source_id);
--> statement-breakpoint
CREATE INDEX trade_csv_import_sources_batch_idx ON trade_csv_import_sources(firebase_uid,import_batch_id);
--> statement-breakpoint
CREATE INDEX trade_csv_import_sources_work_idx ON trade_csv_import_sources(firebase_uid,work_order_id);
--> statement-breakpoint
CREATE INDEX trade_csv_import_sources_customer_idx ON trade_csv_import_sources(firebase_uid,customer_key,customer_id);
