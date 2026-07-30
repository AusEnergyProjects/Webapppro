ALTER TABLE `customer_project_evidence` ADD `capture_slot` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `customer_project_evidence` ADD `privacy_status` text DEFAULT 'not-recorded' NOT NULL;
--> statement-breakpoint
ALTER TABLE `customer_project_evidence` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `customer_project_evidence`
SET `privacy_status` = 'not-applicable'
WHERE `content_type` = 'application/pdf';
--> statement-breakpoint
DROP INDEX `customer_project_evidence_client_idx`;
--> statement-breakpoint
DROP INDEX `customer_project_evidence_project_idx`;
--> statement-breakpoint
ALTER TABLE `customer_project_evidence`
RENAME TO `customer_project_evidence_legacy`;
--> statement-breakpoint
CREATE TABLE `customer_project_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`client_upload_id` text NOT NULL,
	`category` text NOT NULL,
	`capture_slot` text DEFAULT '' NOT NULL,
	`fact_keys` text DEFAULT '[]' NOT NULL,
	`sharing_scope` text DEFAULT 'private-plan' NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`privacy_status` text DEFAULT 'not-recorded' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `customer_project_evidence`
	(`id`, `project_id`, `customer_uid`, `client_upload_id`, `category`,
	 `capture_slot`, `fact_keys`, `sharing_scope`, `file_name`, `content_type`,
	 `size_bytes`, `object_key`, `privacy_status`, `revision`, `status`,
	 `created_at`, `updated_at`)
SELECT
	`id`, `project_id`, `customer_uid`, `client_upload_id`, `category`,
	`capture_slot`, `fact_keys`, `sharing_scope`, `file_name`, `content_type`,
	`size_bytes`, `object_key`, `privacy_status`, `revision`, `status`,
	`created_at`, `updated_at`
FROM `customer_project_evidence_legacy`;
--> statement-breakpoint
DROP TABLE `customer_project_evidence_legacy`;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_client_idx`
ON `customer_project_evidence` (`customer_uid`,`project_id`,`client_upload_id`);
--> statement-breakpoint
CREATE INDEX `customer_project_evidence_project_idx`
ON `customer_project_evidence` (`customer_uid`,`project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_capture_slot_idx`
ON `customer_project_evidence` (`customer_uid`,`project_id`,`capture_slot`)
WHERE `status` = 'active' AND `capture_slot` <> '';
--> statement-breakpoint
CREATE TABLE `customer_project_evidence_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`client_upload_id` text NOT NULL,
	`metadata_hash` text NOT NULL,
	`capture_slot` text DEFAULT '' NOT NULL,
	`replacement_evidence_id` text DEFAULT '' NOT NULL,
	`replacement_object_key` text DEFAULT '' NOT NULL,
	`expected_evidence_revision` integer DEFAULT 0 NOT NULL,
	`staging_object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text NOT NULL,
	`fact_keys` text DEFAULT '[]' NOT NULL,
	`sharing_scope` text DEFAULT 'private-plan' NOT NULL,
	`part_size_bytes` integer NOT NULL,
	`status` text DEFAULT 'initiated' NOT NULL,
	`evidence_id` text NOT NULL,
	`privacy_status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_upload_owner_client_idx`
ON `customer_project_evidence_upload_sessions` (`customer_uid`,`project_id`,`client_upload_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_upload_staging_idx`
ON `customer_project_evidence_upload_sessions` (`staging_object_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_upload_capture_slot_idx`
ON `customer_project_evidence_upload_sessions` (`customer_uid`,`project_id`,`capture_slot`)
WHERE `replacement_evidence_id` = ''
	AND `capture_slot` <> ''
	AND `status` IN ('initiated','uploading','completing');
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_upload_replacement_idx`
ON `customer_project_evidence_upload_sessions` (`customer_uid`,`project_id`,`replacement_evidence_id`)
WHERE `replacement_evidence_id` <> ''
	AND `status` IN ('initiated','uploading','completing');
--> statement-breakpoint
CREATE INDEX `customer_project_evidence_upload_project_idx`
ON `customer_project_evidence_upload_sessions` (`customer_uid`,`project_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `customer_project_evidence_upload_expiry_idx`
ON `customer_project_evidence_upload_sessions` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `customer_project_evidence_upload_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_upload_parts_session_part_idx`
ON `customer_project_evidence_upload_parts` (`session_id`,`part_number`);
--> statement-breakpoint
CREATE INDEX `customer_project_evidence_upload_parts_session_idx`
ON `customer_project_evidence_upload_parts` (`session_id`,`part_number`);
--> statement-breakpoint
CREATE TRIGGER `customer_project_evidence_upload_block_project_delete`
BEFORE DELETE ON `customer_projects`
WHEN EXISTS (
	SELECT 1
	FROM `customer_project_evidence_upload_sessions`
	WHERE `project_id` = OLD.`id`
		AND `customer_uid` = OLD.`firebase_uid`
		AND `status` IN ('initiated','uploading','completing','finalising','abandoning')
)
BEGIN
	SELECT RAISE(ABORT, 'active_customer_evidence_upload');
END;
--> statement-breakpoint
CREATE TRIGGER `customer_project_evidence_upload_cleanup_project_delete`
AFTER DELETE ON `customer_projects`
BEGIN
	DELETE FROM `customer_project_evidence_upload_parts`
	WHERE `session_id` IN (
		SELECT `id`
		FROM `customer_project_evidence_upload_sessions`
		WHERE `project_id` = OLD.`id`
			AND `customer_uid` = OLD.`firebase_uid`
	);
	DELETE FROM `customer_project_evidence_upload_sessions`
	WHERE `project_id` = OLD.`id`
		AND `customer_uid` = OLD.`firebase_uid`;
END;
