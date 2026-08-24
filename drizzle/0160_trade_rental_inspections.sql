ALTER TABLE `trade_team_member_credentials` ADD COLUMN `rental_gate` text DEFAULT '' NOT NULL CHECK (`rental_gate` IN ('', 'licensed_electrician', 'licensed_gasfitter', 'suitably_qualified_smoke_alarm_worker'));--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_member_credentials_file_idx` ON `trade_team_member_credentials` (`file_id`) WHERE `file_id` <> '';--> statement-breakpoint

CREATE TABLE `trade_rental_inspections` (
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
	CONSTRAINT `trade_rental_inspections_modules_check` CHECK (json_valid(`module_selection_snapshot`) AND json_type(`module_selection_snapshot`) = 'array' AND json_array_length(`module_selection_snapshot`) BETWEEN 1 AND 4 AND json_extract(`module_selection_snapshot`, '$[0]') = 'minimum_standards' AND coalesce(json_extract(`module_selection_snapshot`, '$[1]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[2]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[3]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check')),
	CONSTRAINT `trade_rental_inspections_snapshots_check` CHECK (json_valid(`property_snapshot`) AND json_type(`property_snapshot`) = 'object' AND json_valid(`assessor_snapshot`) AND json_type(`assessor_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_inspections_revision_check` CHECK (`revision` > 0),
	CONSTRAINT `trade_rental_inspections_lifecycle_check` CHECK ((`status` = 'issued' AND datetime(`issued_at`) IS NOT NULL AND trim(`issued_report_id`) <> '') OR (`status` <> 'issued')),
	CONSTRAINT `trade_rental_inspections_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_inspections_owner_work_idx` ON `trade_rental_inspections` (`firebase_uid`,`work_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_inspections_owner_number_idx` ON `trade_rental_inspections` (`firebase_uid`,`inspection_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_inspections_creation_request_idx` ON `trade_rental_inspections` (`firebase_uid`,`creation_request_id`) WHERE `creation_request_id` <> '';--> statement-breakpoint
CREATE INDEX `trade_rental_inspections_owner_status_idx` ON `trade_rental_inspections` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_inspections_work_idx` ON `trade_rental_inspections` (`work_order_id`,`updated_at`);--> statement-breakpoint

CREATE TABLE `trade_rental_inspection_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`module_key` text NOT NULL,
	`required` integer DEFAULT 0 NOT NULL,
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
	CONSTRAINT `trade_rental_modules_required_check` CHECK ((`module_key` = 'minimum_standards' AND `required` = 1) OR (`module_key` <> 'minimum_standards' AND `required` = 0)),
	CONSTRAINT `trade_rental_modules_status_check` CHECK (`status` IN ('not_started', 'draft', 'complete', 'superseded')),
	CONSTRAINT `trade_rental_modules_snapshot_check` CHECK (json_valid(`template_snapshot`) AND json_type(`template_snapshot`) = 'object' AND json_extract(`template_snapshot`, '$.key') = `module_key` AND json_valid(`answers`) AND json_type(`answers`) = 'object' AND json_valid(`credential_snapshot`) AND json_type(`credential_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_modules_revision_check` CHECK (`template_version` > 0 AND `revision` > 0),
	CONSTRAINT `trade_rental_modules_completion_check` CHECK ((`status` = 'complete' AND trim(`completed_by_uid`) <> '' AND datetime(`completed_at`) IS NOT NULL) OR (`status` <> 'complete' AND `completed_by_uid` = '' AND `completed_at` = '')),
	CONSTRAINT `trade_rental_modules_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_modules_inspection_key_idx` ON `trade_rental_inspection_modules` (`inspection_id`,`module_key`);--> statement-breakpoint
CREATE INDEX `trade_rental_modules_owner_status_idx` ON `trade_rental_inspection_modules` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_modules_inspection_idx` ON `trade_rental_inspection_modules` (`inspection_id`,`updated_at`);--> statement-breakpoint

CREATE TABLE `trade_rental_inspection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`module_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`item_key` text NOT NULL,
	`section_key` text NOT NULL,
	`check_key` text NOT NULL,
	`instance_key` text DEFAULT 'property' NOT NULL,
	`location_label` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'not_assessed' NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`public_notes` text DEFAULT '' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`required_evidence_count` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`completed_by_uid` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_inspection_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_items_key_check` CHECK (trim(`item_key`) <> '' AND trim(`section_key`) <> '' AND trim(`check_key`) <> '' AND trim(`instance_key`) <> ''),
	CONSTRAINT `trade_rental_items_outcome_check` CHECK (`outcome` IN ('not_assessed', 'meets', 'does_not_meet', 'specialist_verification_required', 'not_accessible', 'not_applicable', 'exemption_evidence_pending')),
	CONSTRAINT `trade_rental_items_response_check` CHECK (json_valid(`response_json`) AND json_type(`response_json`) = 'object'),
	CONSTRAINT `trade_rental_items_bounds_check` CHECK (`required_evidence_count` BETWEEN 0 AND 20 AND `sort_order` BETWEEN 0 AND 10000 AND `revision` > 0 AND length(`public_notes`) <= 4000 AND length(`internal_notes`) <= 4000),
	CONSTRAINT `trade_rental_items_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_items_instance_idx` ON `trade_rental_inspection_items` (`inspection_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `trade_rental_items_section_idx` ON `trade_rental_inspection_items` (`inspection_id`,`section_key`,`sort_order`);--> statement-breakpoint
CREATE INDEX `trade_rental_items_module_idx` ON `trade_rental_inspection_items` (`module_id`,`outcome`,`sort_order`);--> statement-breakpoint

CREATE TABLE `trade_rental_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`module_id` text NOT NULL,
	`item_id` text DEFAULT '' NOT NULL,
	`firebase_uid` text NOT NULL,
	`finding_key` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`standard_reference` text DEFAULT '' NOT NULL,
	`finding_status` text NOT NULL,
	`severity` text DEFAULT 'information' NOT NULL,
	`trade_category` text DEFAULT '' NOT NULL,
	`location_label` text DEFAULT '' NOT NULL,
	`recommended_action` text DEFAULT '' NOT NULL,
	`scope_summary` text DEFAULT '' NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_label` text DEFAULT 'each' NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`internal_notes` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_inspection_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_findings_status_check` CHECK (`finding_status` IN ('compliant', 'recommendation', 'faulty', 'non_compliant', 'safety_issue', 'disconnected', 'not_tested', 'not_applicable')),
	CONSTRAINT `trade_rental_findings_severity_check` CHECK (`severity` IN ('immediate_safety_risk', 'urgent', 'required', 'recommended', 'information')),
	CONSTRAINT `trade_rental_findings_details_check` CHECK (json_valid(`details`) AND json_type(`details`) = 'object'),
	CONSTRAINT `trade_rental_findings_bounds_check` CHECK (trim(`finding_key`) <> '' AND trim(`category`) <> '' AND trim(`title`) <> '' AND `quantity_milli` BETWEEN 0 AND 1000000000 AND length(`description`) <= 8000 AND length(`scope_summary`) <= 8000 AND length(`internal_notes`) <= 4000 AND `revision` > 0),
	CONSTRAINT `trade_rental_findings_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_findings_key_idx` ON `trade_rental_findings` (`inspection_id`,`finding_key`);--> statement-breakpoint
CREATE INDEX `trade_rental_findings_status_idx` ON `trade_rental_findings` (`inspection_id`,`finding_status`,`severity`,`sort_order`);--> statement-breakpoint
CREATE INDEX `trade_rental_findings_trade_idx` ON `trade_rental_findings` (`inspection_id`,`trade_category`,`sort_order`);--> statement-breakpoint
CREATE INDEX `trade_rental_findings_item_idx` ON `trade_rental_findings` (`item_id`,`updated_at`);--> statement-breakpoint

CREATE TABLE `trade_rental_evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`module_id` text NOT NULL,
	`item_id` text DEFAULT '' NOT NULL,
	`finding_id` text DEFAULT '' NOT NULL,
	`job_media_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`requirement_key` text NOT NULL,
	`evidence_type` text DEFAULT 'photo' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`caption_snapshot` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_uid` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_inspection_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_media_id`) REFERENCES `trade_crm_job_media`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_evidence_type_check` CHECK (`evidence_type` IN ('photo', 'document', 'measurement', 'signature') AND `status` IN ('active', 'superseded')),
	CONSTRAINT `trade_rental_evidence_bounds_check` CHECK (trim(`requirement_key`) <> '' AND length(`purpose`) <= 1000 AND length(`caption_snapshot`) <= 1000 AND `sort_order` BETWEEN 0 AND 10000),
	CONSTRAINT `trade_rental_evidence_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_evidence_requirement_media_idx` ON `trade_rental_evidence_links` (`inspection_id`,`requirement_key`,`job_media_id`);--> statement-breakpoint
CREATE INDEX `trade_rental_evidence_module_idx` ON `trade_rental_evidence_links` (`inspection_id`,`module_id`,`requirement_key`,`status`);--> statement-breakpoint
CREATE INDEX `trade_rental_evidence_finding_idx` ON `trade_rental_evidence_links` (`finding_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `trade_rental_evidence_media_idx` ON `trade_rental_evidence_links` (`job_media_id`);--> statement-breakpoint

CREATE TABLE `trade_rental_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`report_number` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`report_schema_version` text DEFAULT 'tlink-rental-report-v1' NOT NULL,
	`report_snapshot` text NOT NULL,
	`source_snapshot_sha256` text NOT NULL,
	`pdf_object_key` text DEFAULT '' NOT NULL,
	`pdf_sha256` text DEFAULT '' NOT NULL,
	`pdf_size_bytes` integer DEFAULT 0 NOT NULL,
	`issued_by_uid` text DEFAULT '' NOT NULL,
	`issued_by_member_id` text DEFAULT '' NOT NULL,
	`issuer_snapshot` text DEFAULT '{}' NOT NULL,
	`staged_at` text NOT NULL,
	`issued_at` text DEFAULT '' NOT NULL,
	`superseded_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_reports_status_check` CHECK (`status` IN ('staged', 'issued', 'failed', 'superseded', 'withdrawn')),
	CONSTRAINT `trade_rental_reports_snapshot_check` CHECK (json_valid(`report_snapshot`) AND json_type(`report_snapshot`) = 'object' AND json_extract(`report_snapshot`, '$.schemaVersion') = `report_schema_version` AND json_valid(`issuer_snapshot`) AND json_type(`issuer_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_reports_hash_check` CHECK (length(`source_snapshot_sha256`) = 64 AND `source_snapshot_sha256` = lower(`source_snapshot_sha256`) AND `source_snapshot_sha256` NOT GLOB '*[^0-9a-f]*' AND (`pdf_sha256` = '' OR (length(`pdf_sha256`) = 64 AND `pdf_sha256` = lower(`pdf_sha256`) AND `pdf_sha256` NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT `trade_rental_reports_pdf_check` CHECK ((`status` = 'issued' AND trim(`pdf_object_key`) <> '' AND length(`pdf_sha256`) = 64 AND `pdf_size_bytes` BETWEEN 5 AND 52428800 AND trim(`issued_by_uid`) <> '' AND datetime(`issued_at`) IS NOT NULL) OR (`status` <> 'issued')),
	CONSTRAINT `trade_rental_reports_revision_check` CHECK (`revision` > 0),
	CONSTRAINT `trade_rental_reports_time_check` CHECK (datetime(`staged_at`) IS NOT NULL AND datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_reports_inspection_revision_idx` ON `trade_rental_reports` (`inspection_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_reports_owner_number_idx` ON `trade_rental_reports` (`firebase_uid`,`report_number`);--> statement-breakpoint
CREATE INDEX `trade_rental_reports_owner_status_idx` ON `trade_rental_reports` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_reports_inspection_idx` ON `trade_rental_reports` (`inspection_id`,`status`,`revision`);--> statement-breakpoint

CREATE TABLE `trade_rental_report_links` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`token_hash` text NOT NULL,
	`encrypted_token` text DEFAULT '' NOT NULL,
	`token_issue` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`created_by_uid` text NOT NULL,
	`last_viewed_at` text DEFAULT '' NOT NULL,
	`last_downloaded_at` text DEFAULT '' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `trade_rental_reports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_report_links_hash_check` CHECK (length(`token_hash`) = 64 AND `token_hash` = lower(`token_hash`) AND `token_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `trade_rental_report_links_status_check` CHECK (`status` IN ('active', 'revoked', 'expired', 'superseded') AND `token_issue` > 0),
	CONSTRAINT `trade_rental_report_links_expiry_check` CHECK (datetime(`expires_at`) IS NOT NULL AND datetime(`created_at`) IS NOT NULL AND datetime(`expires_at`) > datetime(`created_at`)),
	CONSTRAINT `trade_rental_report_links_counts_check` CHECK (`view_count` >= 0 AND `download_count` >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_report_links_token_idx` ON `trade_rental_report_links` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_report_links_active_report_idx` ON `trade_rental_report_links` (`report_id`) WHERE `status` = 'active';--> statement-breakpoint
CREATE INDEX `trade_rental_report_links_owner_idx` ON `trade_rental_report_links` (`firebase_uid`,`inspection_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_report_links_expiry_idx` ON `trade_rental_report_links` (`status`,`expires_at`);--> statement-breakpoint

CREATE TABLE `trade_rental_inspection_events` (
	`id` text PRIMARY KEY NOT NULL,
	`inspection_id` text NOT NULL,
	`report_id` text DEFAULT '' NOT NULL,
	`report_link_id` text DEFAULT '' NOT NULL,
	`firebase_uid` text NOT NULL,
	`actor_type` text DEFAULT 'system' NOT NULL,
	`actor_uid` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`source_ip_sha256` text DEFAULT '' NOT NULL,
	`user_agent_sha256` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_inspections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_events_actor_check` CHECK (`actor_type` IN ('assessor', 'owner', 'viewer', 'system')),
	CONSTRAINT `trade_rental_events_metadata_check` CHECK (json_valid(`metadata`) AND json_type(`metadata`) = 'object' AND length(`summary`) <= 2000),
	CONSTRAINT `trade_rental_events_hash_check` CHECK ((`source_ip_sha256` = '' OR (length(`source_ip_sha256`) = 64 AND `source_ip_sha256` = lower(`source_ip_sha256`) AND `source_ip_sha256` NOT GLOB '*[^0-9a-f]*')) AND (`user_agent_sha256` = '' OR (length(`user_agent_sha256`) = 64 AND `user_agent_sha256` = lower(`user_agent_sha256`) AND `user_agent_sha256` NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT `trade_rental_events_time_check` CHECK (datetime(`created_at`) IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_rental_events_request_idx` ON `trade_rental_inspection_events` (`inspection_id`,`request_id`) WHERE `request_id` <> '';--> statement-breakpoint
CREATE INDEX `trade_rental_events_inspection_idx` ON `trade_rental_inspection_events` (`inspection_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_events_report_idx` ON `trade_rental_inspection_events` (`report_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_events_link_idx` ON `trade_rental_inspection_events` (`report_link_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trade_rental_events_owner_type_idx` ON `trade_rental_inspection_events` (`firebase_uid`,`event_type`,`created_at`);
