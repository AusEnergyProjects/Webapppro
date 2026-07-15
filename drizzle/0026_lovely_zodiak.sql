CREATE TABLE `trade_offline_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`actor_uid` text NOT NULL,
	`member_id` text DEFAULT '' NOT NULL,
	`device_id` text DEFAULT '' NOT NULL,
	`client_action_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`action_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`base_revision` integer DEFAULT 0 NOT NULL,
	`result_revision` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_offline_actions_owner_client_idx` ON `trade_offline_actions` (`owner_uid`,`client_action_id`);--> statement-breakpoint
CREATE INDEX `trade_offline_actions_actor_idx` ON `trade_offline_actions` (`owner_uid`,`actor_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_offline_actions_entity_idx` ON `trade_offline_actions` (`owner_uid`,`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_team_sync_changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_uid` text NOT NULL,
	`audience_member_id` text DEFAULT '' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_team_sync_changes_owner_sequence_idx` ON `trade_team_sync_changes` (`owner_uid`,`audience_member_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `trade_team_sync_changes_entity_idx` ON `trade_team_sync_changes` (`owner_uid`,`entity_type`,`entity_id`,`sequence`);--> statement-breakpoint
ALTER TABLE `trade_work_order_tasks` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_work_orders` ADD `revision` integer DEFAULT 1 NOT NULL;