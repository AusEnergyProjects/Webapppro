CREATE UNIQUE INDEX trade_work_orders_sales_owner_id_idx ON trade_work_orders(firebase_uid, id);
--> statement-breakpoint
CREATE TABLE trade_sales_settings (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  stages_json TEXT NOT NULL CHECK (json_valid(stages_json) AND json_type(stages_json) = 'array' AND json_array_length(stages_json) BETWEEN 1 AND 12),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE trade_sales_job_metadata (
  owner_uid TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  stage_id TEXT NOT NULL DEFAULT '',
  owner_member_id TEXT,
  expected_close_on TEXT NOT NULL DEFAULT '',
  last_contact_on TEXT NOT NULL DEFAULT '',
  next_action_on TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_uid, work_order_id),
  FOREIGN KEY (owner_uid, work_order_id) REFERENCES trade_work_orders(firebase_uid, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_uid, owner_member_id) REFERENCES trade_team_members(owner_uid, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX trade_sales_job_metadata_stage_idx ON trade_sales_job_metadata(owner_uid, stage_id, work_order_id);
--> statement-breakpoint
CREATE INDEX trade_sales_job_metadata_owner_idx ON trade_sales_job_metadata(owner_uid, owner_member_id, next_action_on, work_order_id);
