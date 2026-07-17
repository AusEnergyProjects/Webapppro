CREATE TABLE `trade_team_unavailability` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`team_member_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`reason` text DEFAULT 'Unavailable' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_team_unavailability_owner_range_idx` ON `trade_team_unavailability` (`owner_uid`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `trade_team_unavailability_member_range_idx` ON `trade_team_unavailability` (`owner_uid`,`team_member_id`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `trade_team_working_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`team_member_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_working_hours_member_day_idx` ON `trade_team_working_hours` (`owner_uid`,`team_member_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `trade_team_working_hours_owner_day_idx` ON `trade_team_working_hours` (`owner_uid`,`weekday`,`team_member_id`);--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `assignee_member_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `trade_crm_appointments_assignee_start_idx` ON `trade_crm_appointments` (`firebase_uid`,`assignee_member_id`,`status`,`starts_at`);