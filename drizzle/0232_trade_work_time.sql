CREATE TABLE `trade_work_time_sessions` (
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
	CONSTRAINT "trade_work_time_kind_check" CHECK("trade_work_time_sessions"."kind" IN ('app','form') AND "trade_work_time_sessions"."source" IN ('web','native')),
	CONSTRAINT "trade_work_time_completion_check" CHECK("trade_work_time_sessions"."observed_completed_at"='' OR ("trade_work_time_sessions"."kind"='form' AND "trade_work_time_sessions"."observed_completed_at"="trade_work_time_sessions"."ended_at")),
	CONSTRAINT "trade_work_time_page_check" CHECK(("trade_work_time_sessions"."kind"='app' AND "trade_work_time_sessions"."page_key"='' AND "trade_work_time_sessions"."page_title"='') OR ("trade_work_time_sessions"."kind"='form' AND length("trade_work_time_sessions"."page_key") BETWEEN 1 AND 180 AND length("trade_work_time_sessions"."page_title") BETWEEN 1 AND 160)),
	CONSTRAINT "trade_work_time_form_check" CHECK(("trade_work_time_sessions"."kind"='app' AND "trade_work_time_sessions"."form_kind"='' AND "trade_work_time_sessions"."form_id"='' AND "trade_work_time_sessions"."form_key"='') OR ("trade_work_time_sessions"."kind"='form' AND "trade_work_time_sessions"."form_kind" IN ('job_form','activity_record','work_pack','rental_inspection') AND "trade_work_time_sessions"."form_id"<>'' AND "trade_work_time_sessions"."form_key"<>'' AND "trade_work_time_sessions"."work_order_id"<>'')),
	CONSTRAINT "trade_work_time_range_check" CHECK(julianday("trade_work_time_sessions"."started_at") IS NOT NULL AND julianday("trade_work_time_sessions"."ended_at") IS NOT NULL AND "trade_work_time_sessions"."ended_at">="trade_work_time_sessions"."started_at" AND julianday("trade_work_time_sessions"."ended_at")-julianday("trade_work_time_sessions"."started_at")<=1)
);
--> statement-breakpoint
CREATE INDEX `trade_work_time_owner_end_idx` ON `trade_work_time_sessions` (`owner_uid`,`ended_at`);--> statement-breakpoint
CREATE INDEX `trade_work_time_member_end_idx` ON `trade_work_time_sessions` (`owner_uid`,`member_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `trade_work_time_form_idx` ON `trade_work_time_sessions` (`owner_uid`,`form_key`,`started_at`);