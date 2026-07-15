CREATE TABLE `trade_mobile_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`actor_uid` text NOT NULL,
	`member_id` text DEFAULT '' NOT NULL,
	`device_id` text NOT NULL,
	`platform` text NOT NULL,
	`device_name` text DEFAULT 'Field device' NOT NULL,
	`app_version` text NOT NULL,
	`push_provider` text DEFAULT 'fcm' NOT NULL,
	`push_token` text DEFAULT '' NOT NULL,
	`push_token_updated_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`registered_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`revoked_by_uid` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_devices_owner_device_idx` ON `trade_mobile_devices` (`owner_uid`,`device_id`);--> statement-breakpoint
CREATE INDEX `trade_mobile_devices_owner_status_idx` ON `trade_mobile_devices` (`owner_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_mobile_devices_actor_status_idx` ON `trade_mobile_devices` (`actor_uid`,`status`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `trade_mobile_devices_member_status_idx` ON `trade_mobile_devices` (`owner_uid`,`member_id`,`status`);--> statement-breakpoint
CREATE TABLE `trade_mobile_push_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`audience_member_id` text NOT NULL,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_push_outbox_event_idx` ON `trade_mobile_push_outbox` (`event_key`);--> statement-breakpoint
CREATE INDEX `trade_mobile_push_outbox_pending_idx` ON `trade_mobile_push_outbox` (`status`,`next_attempt_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_mobile_push_outbox_audience_idx` ON `trade_mobile_push_outbox` (`owner_uid`,`audience_member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_mobile_upload_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_upload_parts_session_part_idx` ON `trade_mobile_upload_parts` (`session_id`,`part_number`);--> statement-breakpoint
CREATE INDEX `trade_mobile_upload_parts_session_idx` ON `trade_mobile_upload_parts` (`session_id`,`part_number`);--> statement-breakpoint
CREATE TABLE `trade_mobile_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`actor_uid` text NOT NULL,
	`member_id` text DEFAULT '' NOT NULL,
	`device_id` text NOT NULL,
	`client_upload_id` text NOT NULL,
	`metadata_hash` text NOT NULL,
	`work_order_id` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text DEFAULT 'progress' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`part_size_bytes` integer NOT NULL,
	`status` text DEFAULT 'initiated' NOT NULL,
	`media_id` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_upload_sessions_owner_client_idx` ON `trade_mobile_upload_sessions` (`owner_uid`,`client_upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_mobile_upload_sessions_object_idx` ON `trade_mobile_upload_sessions` (`object_key`);--> statement-breakpoint
CREATE INDEX `trade_mobile_upload_sessions_device_idx` ON `trade_mobile_upload_sessions` (`owner_uid`,`device_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_mobile_upload_sessions_job_idx` ON `trade_mobile_upload_sessions` (`owner_uid`,`work_order_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_mobile_upload_sessions_expiry_idx` ON `trade_mobile_upload_sessions` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `trade_offline_actions` ADD `lease_until` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_offline_actions` ADD `error_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_offline_actions` ADD `updated_at` text DEFAULT '' NOT NULL;