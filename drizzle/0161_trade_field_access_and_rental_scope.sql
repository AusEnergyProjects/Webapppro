CREATE TABLE `__new_trade_rental_inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`service_site_id` text DEFAULT '' NOT NULL,
	`inspection_number` text NOT NULL,
	`jurisdiction` text DEFAULT 'VIC' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`template_key` text NOT NULL,
	`template_version` integer NOT NULL,
	`rules_effective_from` text NOT NULL,
	`module_selection_snapshot` text NOT NULL,
	`property_snapshot` text DEFAULT '{}' NOT NULL,
	`assessor_uid` text DEFAULT '' NOT NULL,
	`assessor_member_id` text DEFAULT '' NOT NULL,
	`assessor_snapshot` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`creation_request_id` text DEFAULT '' NOT NULL,
	`issued_report_id` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`issued_at` text DEFAULT '' NOT NULL,
	`superseded_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `trade_work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_inspections_identity_check` CHECK (trim(`id`) <> '' AND trim(`work_order_id`) <> '' AND trim(`firebase_uid`) <> '' AND trim(`inspection_number`) <> '' AND `jurisdiction` = 'VIC'),
	CONSTRAINT `trade_rental_inspections_status_check` CHECK (`status` IN ('draft', 'scheduled', 'in_progress', 'submitted', 'issuing', 'issued', 'superseded', 'withdrawn')),
	CONSTRAINT `trade_rental_inspections_template_check` CHECK (`template_key` = 'vic-rental-minimum-standards' AND `template_version` > 0 AND date(`rules_effective_from`) = `rules_effective_from`),
	CONSTRAINT `trade_rental_inspections_modules_check` CHECK (json_valid(`module_selection_snapshot`) AND json_type(`module_selection_snapshot`) = 'array' AND json_array_length(`module_selection_snapshot`) BETWEEN 1 AND 4 AND json_extract(`module_selection_snapshot`, '$[0]') IN ('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[1]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[2]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[3]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND (json_array_length(`module_selection_snapshot`) < 2 OR json_extract(`module_selection_snapshot`, '$[1]') <> json_extract(`module_selection_snapshot`, '$[0]')) AND (json_array_length(`module_selection_snapshot`) < 3 OR json_extract(`module_selection_snapshot`, '$[2]') NOT IN (json_extract(`module_selection_snapshot`, '$[0]'), json_extract(`module_selection_snapshot`, '$[1]'))) AND (json_array_length(`module_selection_snapshot`) < 4 OR json_extract(`module_selection_snapshot`, '$[3]') NOT IN (json_extract(`module_selection_snapshot`, '$[0]'), json_extract(`module_selection_snapshot`, '$[1]'), json_extract(`module_selection_snapshot`, '$[2]')))),
	CONSTRAINT `trade_rental_inspections_snapshots_check` CHECK (json_valid(`property_snapshot`) AND json_type(`property_snapshot`) = 'object' AND json_valid(`assessor_snapshot`) AND json_type(`assessor_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_inspections_revision_check` CHECK (`revision` > 0),
	CONSTRAINT `trade_rental_inspections_lifecycle_check` CHECK ((`status` = 'issued' AND datetime(`issued_at`) IS NOT NULL AND trim(`issued_report_id`) <> '') OR (`status` <> 'issued')),
	CONSTRAINT `trade_rental_inspections_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
INSERT INTO `__new_trade_rental_inspections` SELECT * FROM `trade_rental_inspections`;--> statement-breakpoint
DROP TABLE `__new_trade_rental_inspections`;--> statement-breakpoint

CREATE TABLE `__new_trade_rental_inspection_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`module_key` text NOT NULL,
	`required` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`template_version` integer NOT NULL,
	`template_name` text NOT NULL,
	`required_capability` text NOT NULL,
	`template_snapshot` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`credential_snapshot` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`completed_by_uid` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_modules_key_check` CHECK (`module_key` IN ('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check')),
	CONSTRAINT `trade_rental_modules_required_check` CHECK (`required` = 1),
	CONSTRAINT `trade_rental_modules_status_check` CHECK (`status` IN ('not_started', 'draft', 'complete', 'superseded')),
	CONSTRAINT `trade_rental_modules_snapshot_check` CHECK (json_valid(`template_snapshot`) AND json_type(`template_snapshot`) = 'object' AND json_extract(`template_snapshot`, '$.key') = `module_key` AND json_valid(`answers`) AND json_type(`answers`) = 'object' AND json_valid(`credential_snapshot`) AND json_type(`credential_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_modules_revision_check` CHECK (`template_version` > 0 AND `revision` > 0),
	CONSTRAINT `trade_rental_modules_completion_check` CHECK ((`status` = 'complete' AND trim(`completed_by_uid`) <> '' AND datetime(`completed_at`) IS NOT NULL) OR (`status` <> 'complete' AND `completed_by_uid` = '' AND `completed_at` = '')),
	CONSTRAINT `trade_rental_modules_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
INSERT INTO `__new_trade_rental_inspection_modules` (`id`,`inspection_id`,`firebase_uid`,`module_key`,`required`,`status`,`template_version`,`template_name`,`required_capability`,`template_snapshot`,`answers`,`credential_snapshot`,`revision`,`completed_by_uid`,`completed_at`,`created_at`,`updated_at`) SELECT `id`,`inspection_id`,`firebase_uid`,`module_key`,1,`status`,`template_version`,`template_name`,`required_capability`,`template_snapshot`,`answers`,`credential_snapshot`,`revision`,`completed_by_uid`,`completed_at`,`created_at`,`updated_at` FROM `trade_rental_inspection_modules`;--> statement-breakpoint
DROP TABLE `__new_trade_rental_inspection_modules`;--> statement-breakpoint

ALTER TABLE `trade_rental_inspections` ADD COLUMN `selected_modules_snapshot` text CHECK (`selected_modules_snapshot` IS NULL OR (json_valid(`selected_modules_snapshot`) AND json_type(`selected_modules_snapshot`) = 'array' AND json_array_length(`selected_modules_snapshot`) BETWEEN 1 AND 4 AND json_extract(`selected_modules_snapshot`, '$[0]') IN ('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[1]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[2]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[3]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND (json_array_length(`selected_modules_snapshot`) < 2 OR json_extract(`selected_modules_snapshot`, '$[1]') <> json_extract(`selected_modules_snapshot`, '$[0]')) AND (json_array_length(`selected_modules_snapshot`) < 3 OR json_extract(`selected_modules_snapshot`, '$[2]') NOT IN (json_extract(`selected_modules_snapshot`, '$[0]'), json_extract(`selected_modules_snapshot`, '$[1]'))) AND (json_array_length(`selected_modules_snapshot`) < 4 OR json_extract(`selected_modules_snapshot`, '$[3]') NOT IN (json_extract(`selected_modules_snapshot`, '$[0]'), json_extract(`selected_modules_snapshot`, '$[1]'), json_extract(`selected_modules_snapshot`, '$[2]')))));--> statement-breakpoint
ALTER TABLE `trade_rental_inspection_modules` ADD COLUMN `selected_required` integer CHECK (`selected_required` IS NULL OR `selected_required` = 1);--> statement-breakpoint
DROP TRIGGER IF EXISTS `trade_rental_inspections_terminal_immutable`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `trade_rental_modules_parent_guard_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `trade_rental_modules_parent_guard_update`;--> statement-breakpoint

CREATE TABLE `trade_field_access_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`team_member_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_field_access_codes_status_check` CHECK (`status` IN ('active', 'consumed', 'revoked', 'expired')),
	CONSTRAINT `trade_field_access_codes_hash_check` CHECK (length(`pin_salt`) BETWEEN 16 AND 128 AND length(`pin_hash`) = 64 AND lower(`pin_hash`) = `pin_hash` AND `pin_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `trade_field_access_codes_time_check` CHECK (datetime(`expires_at`) IS NOT NULL AND datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL AND (`consumed_at` = '' OR datetime(`consumed_at`) IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX `trade_field_access_codes_name_status_idx` ON `trade_field_access_codes` (`normalized_name`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `trade_field_access_codes_member_status_idx` ON `trade_field_access_codes` (`owner_uid`,`team_member_id`,`status`,`expires_at`);--> statement-breakpoint

CREATE TABLE `trade_field_access_attempts` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`locked_until` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `trade_field_access_attempts_hash_check` CHECK (length(`key_hash`) = 64 AND lower(`key_hash`) = `key_hash` AND `key_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `trade_field_access_attempts_bounds_check` CHECK (`attempts` BETWEEN 0 AND 100),
	CONSTRAINT `trade_field_access_attempts_time_check` CHECK (datetime(`window_started_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL AND (`locked_until` = '' OR datetime(`locked_until`) IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX `trade_field_access_attempts_updated_idx` ON `trade_field_access_attempts` (`updated_at`);--> statement-breakpoint

CREATE TABLE `trade_field_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`team_member_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_id` text NOT NULL,
	`platform` text NOT NULL,
	`app_version` text NOT NULL,
	`device_name` text DEFAULT 'Field device' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_field_sessions_status_check` CHECK (`status` IN ('active', 'revoked', 'expired')),
	CONSTRAINT `trade_field_sessions_platform_check` CHECK (`platform` IN ('ios', 'android')),
	CONSTRAINT `trade_field_sessions_hash_check` CHECK (length(`token_hash`) = 64 AND lower(`token_hash`) = `token_hash` AND `token_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `trade_field_sessions_time_check` CHECK (datetime(`expires_at`) IS NOT NULL AND datetime(`last_seen_at`) IS NOT NULL AND datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL AND (`revoked_at` = '' OR datetime(`revoked_at`) IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_field_sessions_token_idx` ON `trade_field_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `trade_field_sessions_member_status_idx` ON `trade_field_sessions` (`owner_uid`,`team_member_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `trade_field_sessions_device_status_idx` ON `trade_field_sessions` (`owner_uid`,`device_id`,`status`,`expires_at`);--> statement-breakpoint
