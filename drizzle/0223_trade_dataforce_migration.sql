CREATE TABLE trade_dataforce_sources (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  source_system text NOT NULL DEFAULT 'dataforce' CHECK (source_system = 'dataforce'),
  source_job_id text NOT NULL CHECK (trim(source_job_id) <> ''),
  source_app_id text NOT NULL DEFAULT '',
  row_sha256 text NOT NULL CHECK (length(row_sha256) = 64),
  raw_json text NOT NULL CHECK (json_valid(raw_json)),
  mapping_version text NOT NULL DEFAULT 'dataforce-crm-v1',
  import_batch_id text NOT NULL,
  import_row_id text NOT NULL,
  work_order_id text NOT NULL,
  customer_id text NOT NULL,
  service_site_id text NOT NULL,
  customer_key text NOT NULL,
  site_key text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_dataforce_sources_owner_job_idx ON trade_dataforce_sources(firebase_uid, source_system, source_job_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_dataforce_sources_work_order_idx ON trade_dataforce_sources(work_order_id);
--> statement-breakpoint
CREATE INDEX trade_dataforce_sources_customer_idx ON trade_dataforce_sources(firebase_uid, customer_key);
--> statement-breakpoint
CREATE INDEX trade_dataforce_sources_batch_idx ON trade_dataforce_sources(firebase_uid, import_batch_id);
