ALTER TABLE `trade_team_members` ADD COLUMN `first_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `last_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `phone` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `capabilities` text NOT NULL DEFAULT '[]' CHECK (json_valid(`capabilities`) AND json_type(`capabilities`) = 'array');
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_create_jobs` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_jobs` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_assign_jobs` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `job_scope` text NOT NULL DEFAULT 'own' CHECK (`job_scope` IN ('own', 'team'));
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_view_customers` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_customers` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_view_quotes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_quotes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_send_quotes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_view_invoices` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_invoices` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_view_price_book` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_price_book` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_apply_discounts` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `schedule_scope` text NOT NULL DEFAULT 'own' CHECK (`schedule_scope` IN ('own', 'team'));
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_reschedule_jobs` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_team` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_edit_team_permissions` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_view_field_evidence` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_manage_field_evidence` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_run_reports` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `trade_team_members` ADD COLUMN `can_search_customers` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `trade_team_members`
SET can_manage_jobs = CASE WHEN role IN ('manager', 'coordinator') THEN 1 ELSE 0 END,
  can_assign_jobs = CASE WHEN role IN ('manager', 'coordinator') THEN 1 ELSE 0 END,
  job_scope = CASE WHEN role IN ('manager', 'coordinator') THEN 'team' ELSE 'own' END,
  schedule_scope = CASE WHEN role IN ('manager', 'coordinator') THEN 'team' ELSE 'own' END,
  can_reschedule_jobs = CASE WHEN role IN ('manager', 'coordinator') THEN 1 ELSE 0 END,
  can_view_field_evidence = 1,
  can_manage_field_evidence = 1;
--> statement-breakpoint
CREATE TRIGGER `trade_team_members_permissions_insert_guard`
BEFORE INSERT ON `trade_team_members`
BEGIN
  SELECT CASE WHEN
    NEW.can_create_jobs NOT IN (0, 1) OR NEW.can_manage_jobs NOT IN (0, 1) OR NEW.can_assign_jobs NOT IN (0, 1)
    OR NEW.can_view_customers NOT IN (0, 1) OR NEW.can_manage_customers NOT IN (0, 1)
    OR NEW.can_view_quotes NOT IN (0, 1) OR NEW.can_manage_quotes NOT IN (0, 1) OR NEW.can_send_quotes NOT IN (0, 1)
    OR NEW.can_view_invoices NOT IN (0, 1) OR NEW.can_manage_invoices NOT IN (0, 1)
    OR NEW.can_view_price_book NOT IN (0, 1) OR NEW.can_manage_price_book NOT IN (0, 1)
    OR NEW.can_apply_discounts NOT IN (0, 1)
    OR NEW.can_reschedule_jobs NOT IN (0, 1) OR NEW.can_manage_team NOT IN (0, 1)
    OR NEW.can_edit_team_permissions NOT IN (0, 1) OR NEW.can_view_field_evidence NOT IN (0, 1)
    OR NEW.can_manage_field_evidence NOT IN (0, 1) OR NEW.can_run_reports NOT IN (0, 1)
    OR NEW.can_search_customers NOT IN (0, 1)
    OR (NEW.can_manage_customers = 1 AND NEW.can_view_customers = 0)
    OR (NEW.can_manage_quotes = 1 AND NEW.can_view_quotes = 0)
    OR (NEW.can_send_quotes = 1 AND NEW.can_manage_quotes = 0)
    OR (NEW.can_manage_invoices = 1 AND NEW.can_view_invoices = 0)
    OR (NEW.can_manage_price_book = 1 AND NEW.can_view_price_book = 0)
    OR (NEW.can_manage_field_evidence = 1 AND NEW.can_view_field_evidence = 0)
    OR (NEW.can_edit_team_permissions = 1 AND NEW.can_manage_team = 0)
  THEN RAISE(ABORT, 'invalid team permissions') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trade_team_members_permissions_update_guard`
BEFORE UPDATE OF can_create_jobs, can_manage_jobs, can_assign_jobs, can_view_customers, can_manage_customers,
  can_view_quotes, can_manage_quotes, can_send_quotes, can_view_invoices, can_manage_invoices,
  can_view_price_book, can_manage_price_book, can_apply_discounts, can_reschedule_jobs,
  can_manage_team, can_edit_team_permissions, can_view_field_evidence, can_manage_field_evidence,
  can_run_reports, can_search_customers ON `trade_team_members`
BEGIN
  SELECT CASE WHEN
    NEW.can_create_jobs NOT IN (0, 1) OR NEW.can_manage_jobs NOT IN (0, 1) OR NEW.can_assign_jobs NOT IN (0, 1)
    OR NEW.can_view_customers NOT IN (0, 1) OR NEW.can_manage_customers NOT IN (0, 1)
    OR NEW.can_view_quotes NOT IN (0, 1) OR NEW.can_manage_quotes NOT IN (0, 1) OR NEW.can_send_quotes NOT IN (0, 1)
    OR NEW.can_view_invoices NOT IN (0, 1) OR NEW.can_manage_invoices NOT IN (0, 1)
    OR NEW.can_view_price_book NOT IN (0, 1) OR NEW.can_manage_price_book NOT IN (0, 1)
    OR NEW.can_apply_discounts NOT IN (0, 1)
    OR NEW.can_reschedule_jobs NOT IN (0, 1) OR NEW.can_manage_team NOT IN (0, 1)
    OR NEW.can_edit_team_permissions NOT IN (0, 1) OR NEW.can_view_field_evidence NOT IN (0, 1)
    OR NEW.can_manage_field_evidence NOT IN (0, 1) OR NEW.can_run_reports NOT IN (0, 1)
    OR NEW.can_search_customers NOT IN (0, 1)
    OR (NEW.can_manage_customers = 1 AND NEW.can_view_customers = 0)
    OR (NEW.can_manage_quotes = 1 AND NEW.can_view_quotes = 0)
    OR (NEW.can_send_quotes = 1 AND NEW.can_manage_quotes = 0)
    OR (NEW.can_manage_invoices = 1 AND NEW.can_view_invoices = 0)
    OR (NEW.can_manage_price_book = 1 AND NEW.can_view_price_book = 0)
    OR (NEW.can_manage_field_evidence = 1 AND NEW.can_view_field_evidence = 0)
    OR (NEW.can_edit_team_permissions = 1 AND NEW.can_manage_team = 0)
  THEN RAISE(ABORT, 'invalid team permissions') END;
END;
--> statement-breakpoint
CREATE TABLE `trade_team_member_files` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_uid` text NOT NULL,
  `team_member_id` text NOT NULL,
  `category` text NOT NULL CHECK (`category` IN ('id', 'licence', 'compliance', 'training', 'insurance', 'other')),
  `description` text NOT NULL DEFAULT '',
  `file_name` text NOT NULL,
  `content_type` text NOT NULL CHECK (`content_type` IN ('application/pdf', 'image/jpeg', 'image/png')),
  `size_bytes` integer NOT NULL CHECK (`size_bytes` > 0 AND `size_bytes` <= 12582912),
  `sha256` text NOT NULL CHECK (
    length(`sha256`) = 64
    AND `sha256` = lower(`sha256`)
    AND `sha256` NOT GLOB '*[^0-9a-f]*'
  ),
  `object_key` text NOT NULL UNIQUE CHECK (
    length(`object_key`) BETWEEN 1 AND 512
    AND `object_key` NOT GLOB '*[^A-Za-z0-9._/-]*'
  ),
  `status` text NOT NULL DEFAULT 'uploading' CHECK (`status` IN ('uploading', 'active', 'cleanup_pending', 'deleted')),
  `cleanup_attempts` integer NOT NULL DEFAULT 0 CHECK (`cleanup_attempts` >= 0),
  `next_cleanup_at` text NOT NULL DEFAULT '',
  `last_cleanup_error` text NOT NULL DEFAULT '',
  `uploaded_by_uid` text NOT NULL,
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL),
  `deleted_at` text NOT NULL DEFAULT '' CHECK (`deleted_at` = '' OR datetime(`deleted_at`) IS NOT NULL),
  FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `trade_team_member_files_member_status_idx`
  ON `trade_team_member_files` (`owner_uid`, `team_member_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `trade_team_member_files_cleanup_idx`
  ON `trade_team_member_files` (`status`, `next_cleanup_at`);
--> statement-breakpoint
CREATE TABLE `trade_team_member_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_uid` text NOT NULL,
  `team_member_id` text NOT NULL,
  `credential_type` text NOT NULL CHECK (`credential_type` IN ('licence', 'registration', 'training', 'insurance', 'other')),
  `name` text NOT NULL,
  `credential_number` text NOT NULL DEFAULT '',
  `issuer` text NOT NULL DEFAULT '',
  `jurisdiction` text NOT NULL DEFAULT '' CHECK (`jurisdiction` IN ('', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NATIONAL')),
  `expires_at` text NOT NULL DEFAULT '' CHECK (`expires_at` = '' OR (date(`expires_at`) = `expires_at` AND length(`expires_at`) = 10)),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'expired', 'suspended', 'archived')),
  `file_id` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL),
  FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `trade_team_member_credentials_member_idx`
  ON `trade_team_member_credentials` (`owner_uid`, `team_member_id`, `status`, `expires_at`);
--> statement-breakpoint
CREATE TABLE `trade_team_member_events` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_uid` text NOT NULL,
  `team_member_id` text NOT NULL,
  `actor_uid` text NOT NULL,
  `entity_type` text NOT NULL CHECK (`entity_type` IN ('member', 'file', 'credential')),
  `entity_id` text NOT NULL,
  `event_type` text NOT NULL,
  `metadata` text NOT NULL DEFAULT '{}' CHECK (json_valid(`metadata`)),
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `trade_team_member_events_member_time_idx`
  ON `trade_team_member_events` (`owner_uid`, `team_member_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `trade_team_member_events_entity_time_idx`
  ON `trade_team_member_events` (`owner_uid`, `entity_type`, `entity_id`, `created_at`);
