CREATE TABLE trade_job_swms (
  id TEXT PRIMARY KEY NOT NULL, firebase_uid TEXT NOT NULL, work_order_id TEXT NOT NULL,
  template_key TEXT NOT NULL, template_name TEXT NOT NULL, template_version INTEGER NOT NULL,
  template_snapshot TEXT NOT NULL, context_json TEXT NOT NULL, answers_json TEXT NOT NULL,
  signature_json TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1,
  last_request_sha256 TEXT NOT NULL DEFAULT '', snapshot_sha256 TEXT NOT NULL DEFAULT '',
  last_actor_uid TEXT NOT NULL, last_actor_member_id TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT '',
  created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CONSTRAINT trade_job_swms_json_check CHECK(json_valid(template_snapshot) AND json_valid(context_json) AND json_valid(answers_json)),
  CONSTRAINT trade_job_swms_revision_check CHECK(revision>=1 AND template_version>=1),
  CONSTRAINT trade_job_swms_completion_check CHECK((status='draft' AND signature_json='' AND completed_at='' AND snapshot_sha256='') OR (status='complete' AND json_valid(signature_json) AND completed_at<>'' AND length(snapshot_sha256)=64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_job_swms_job_idx ON trade_job_swms(firebase_uid,work_order_id);
--> statement-breakpoint
CREATE INDEX trade_job_swms_owner_updated_idx ON trade_job_swms(firebase_uid,updated_at);
--> statement-breakpoint
CREATE TABLE `new_trade_work_time_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`member_id` text NOT NULL,
	`actor_uid` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`form_kind` text DEFAULT '' NOT NULL,
	`form_id` text DEFAULT '' NOT NULL,
	`form_key` text DEFAULT '' NOT NULL,
	`form_title` text DEFAULT '' NOT NULL,
	`page_key` text DEFAULT '' NOT NULL,
	`page_title` text DEFAULT '' NOT NULL,
	`work_order_id` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`observed_completed_at` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "trade_work_time_kind_check" CHECK("new_trade_work_time_sessions"."kind" IN ('app','form') AND "new_trade_work_time_sessions"."source" IN ('web','native')),
	CONSTRAINT "trade_work_time_completion_check" CHECK("new_trade_work_time_sessions"."observed_completed_at"='' OR ("new_trade_work_time_sessions"."kind"='form' AND "new_trade_work_time_sessions"."observed_completed_at"="new_trade_work_time_sessions"."ended_at")),
	CONSTRAINT "trade_work_time_page_check" CHECK(("new_trade_work_time_sessions"."kind"='app' AND "new_trade_work_time_sessions"."page_key"='' AND "new_trade_work_time_sessions"."page_title"='') OR ("new_trade_work_time_sessions"."kind"='form' AND length("new_trade_work_time_sessions"."page_key") BETWEEN 1 AND 180 AND length("new_trade_work_time_sessions"."page_title") BETWEEN 1 AND 160)),
	CONSTRAINT "trade_work_time_form_check" CHECK(("new_trade_work_time_sessions"."kind"='app' AND "new_trade_work_time_sessions"."form_kind"='' AND "new_trade_work_time_sessions"."form_id"='' AND "new_trade_work_time_sessions"."form_key"='') OR ("new_trade_work_time_sessions"."kind"='form' AND "new_trade_work_time_sessions"."form_kind" IN ('job_form','activity_record','work_pack','rental_inspection','swms') AND "new_trade_work_time_sessions"."form_id"<>'' AND "new_trade_work_time_sessions"."form_key"<>'' AND "new_trade_work_time_sessions"."work_order_id"<>'')),
	CONSTRAINT "trade_work_time_range_check" CHECK(julianday("new_trade_work_time_sessions"."started_at") IS NOT NULL AND julianday("new_trade_work_time_sessions"."ended_at") IS NOT NULL AND "new_trade_work_time_sessions"."ended_at">="new_trade_work_time_sessions"."started_at" AND julianday("new_trade_work_time_sessions"."ended_at")-julianday("new_trade_work_time_sessions"."started_at")<=1)
);

--> statement-breakpoint
INSERT INTO new_trade_work_time_sessions (id,owner_uid,member_id,actor_uid,kind,source,form_kind,form_id,form_key,form_title,page_key,page_title,work_order_id,started_at,ended_at,observed_completed_at,received_at,updated_at) SELECT id,owner_uid,member_id,actor_uid,kind,source,form_kind,form_id,form_key,form_title,page_key,page_title,work_order_id,started_at,ended_at,observed_completed_at,received_at,updated_at FROM trade_work_time_sessions;
--> statement-breakpoint
DROP TABLE trade_work_time_sessions;
--> statement-breakpoint
ALTER TABLE new_trade_work_time_sessions RENAME TO trade_work_time_sessions;
--> statement-breakpoint
CREATE INDEX `trade_work_time_owner_end_idx` ON `trade_work_time_sessions` (`owner_uid`,`ended_at`);--> statement-breakpoint
CREATE INDEX `trade_work_time_member_end_idx` ON `trade_work_time_sessions` (`owner_uid`,`member_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `trade_work_time_form_idx` ON `trade_work_time_sessions` (`owner_uid`,`form_key`,`started_at`);