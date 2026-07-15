CREATE TABLE `admin_usability_pilot_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`pilot_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`slot_number` integer NOT NULL,
	`business_name_snapshot` text NOT NULL,
	`baseline_system` text DEFAULT '' NOT NULL,
	`team_size` integer DEFAULT 1 NOT NULL,
	`primary_trade` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`owner_uid` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`invited_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_usability_pilot_participant_account_idx` ON `admin_usability_pilot_participants` (`pilot_id`,`firebase_uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_usability_pilot_participant_slot_idx` ON `admin_usability_pilot_participants` (`pilot_id`,`slot_number`);--> statement-breakpoint
CREATE INDEX `admin_usability_pilot_participant_status_idx` ON `admin_usability_pilot_participants` (`pilot_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `admin_usability_pilot_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`pilot_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`session_type` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduled_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`tasks_attempted` integer DEFAULT 0 NOT NULL,
	`tasks_completed` integer DEFAULT 0 NOT NULL,
	`ease_score` integer DEFAULT 0 NOT NULL,
	`confidence_score` integer DEFAULT 0 NOT NULL,
	`feedback` text DEFAULT '' NOT NULL,
	`observed_frictions` text DEFAULT '[]' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`facilitator_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_usability_pilot_sessions_participant_idx` ON `admin_usability_pilot_sessions` (`participant_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `admin_usability_pilot_sessions_status_idx` ON `admin_usability_pilot_sessions` (`pilot_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `admin_usability_pilots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`target_participants` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'recruiting' NOT NULL,
	`starts_at` text DEFAULT '' NOT NULL,
	`ends_at` text DEFAULT '' NOT NULL,
	`success_criteria` text DEFAULT '[]' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_usability_pilots_status_idx` ON `admin_usability_pilots` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_data_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`partner_type` text NOT NULL,
	`import_type` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer DEFAULT 0 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`ready_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'preview' NOT NULL,
	`committed_at` text DEFAULT '' NOT NULL,
	`rollback_until` text DEFAULT '' NOT NULL,
	`rolled_back_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_data_import_batches_owner_idx` ON `trade_data_import_batches` (`firebase_uid`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_data_import_batches_status_idx` ON `trade_data_import_batches` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_data_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`row_number` integer NOT NULL,
	`row_key` text DEFAULT '' NOT NULL,
	`normalized_data` text NOT NULL,
	`validation_status` text NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	`resolution` text DEFAULT 'import' NOT NULL,
	`result_status` text DEFAULT 'pending' NOT NULL,
	`target_entity_type` text DEFAULT '' NOT NULL,
	`target_entity_id` text DEFAULT '' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_data_import_rows_batch_row_idx` ON `trade_data_import_rows` (`batch_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `trade_data_import_rows_batch_status_idx` ON `trade_data_import_rows` (`batch_id`,`validation_status`,`result_status`);--> statement-breakpoint
CREATE INDEX `trade_data_import_rows_target_idx` ON `trade_data_import_rows` (`firebase_uid`,`target_entity_type`,`target_entity_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `admin_usability_pilots`
  (`id`, `name`, `goal`, `target_participants`, `status`, `starts_at`, `ends_at`, `success_criteria`, `created_by_uid`, `created_at`, `updated_at`)
VALUES
  ('installer-crm-field-pilot-v1', 'Installer CRM field pilot',
   'Confirm that trade businesses of different sizes can move from setup to real office and field work with minimal help.',
   5, 'recruiting', '', '',
   '["Complete onboarding in 30 minutes or less","Create a customer and job without administrator help","Complete at least 85 percent of observed tasks","Average ease and confidence scores of at least 4 out of 5","Record and assign every material workflow friction"]',
   'system', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z');
