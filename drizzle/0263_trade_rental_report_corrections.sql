-- Correction working copies preserve the original issued assessment and report.
CREATE TABLE `trade_rental_corrections` (
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
	`updated_at` text NOT NULL, `selected_modules_snapshot` text CHECK (`selected_modules_snapshot` IS NULL OR (json_valid(`selected_modules_snapshot`) AND json_type(`selected_modules_snapshot`) = 'array' AND json_array_length(`selected_modules_snapshot`) BETWEEN 1 AND 4 AND json_extract(`selected_modules_snapshot`, '$[0]') IN ('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[1]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[2]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`selected_modules_snapshot`, '$[3]'), '') IN ('', 'minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND (json_array_length(`selected_modules_snapshot`) < 2 OR json_extract(`selected_modules_snapshot`, '$[1]') <> json_extract(`selected_modules_snapshot`, '$[0]')) AND (json_array_length(`selected_modules_snapshot`) < 3 OR json_extract(`selected_modules_snapshot`, '$[2]') NOT IN (json_extract(`selected_modules_snapshot`, '$[0]'), json_extract(`selected_modules_snapshot`, '$[1]'))) AND (json_array_length(`selected_modules_snapshot`) < 4 OR json_extract(`selected_modules_snapshot`, '$[3]') NOT IN (json_extract(`selected_modules_snapshot`, '$[0]'), json_extract(`selected_modules_snapshot`, '$[1]'), json_extract(`selected_modules_snapshot`, '$[2]'))))), `assessment_scope` text DEFAULT 'current_minimum_standards' NOT NULL
  CHECK (`assessment_scope` IN ('current_minimum_standards', 'energy_readiness_2027')),
	FOREIGN KEY (`work_order_id`) REFERENCES `trade_work_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_inspections_identity_check` CHECK (trim(`id`) <> '' AND trim(`work_order_id`) <> '' AND trim(`firebase_uid`) <> '' AND trim(`inspection_number`) <> '' AND `jurisdiction` = 'VIC'),
	CONSTRAINT `trade_rental_inspections_status_check` CHECK (`status` IN ('draft', 'scheduled', 'in_progress', 'submitted', 'issuing', 'issued', 'superseded', 'withdrawn')),
	CONSTRAINT `trade_rental_inspections_template_check` CHECK (`template_key` = 'vic-rental-minimum-standards' AND `template_version` > 0 AND date(`rules_effective_from`) = `rules_effective_from`),
	CONSTRAINT `trade_rental_inspections_modules_check` CHECK (json_valid(`module_selection_snapshot`) AND json_type(`module_selection_snapshot`) = 'array' AND json_array_length(`module_selection_snapshot`) BETWEEN 1 AND 4 AND json_extract(`module_selection_snapshot`, '$[0]') = 'minimum_standards' AND coalesce(json_extract(`module_selection_snapshot`, '$[1]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[2]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check') AND coalesce(json_extract(`module_selection_snapshot`, '$[3]'), '') IN ('', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check')),
	CONSTRAINT `trade_rental_inspections_snapshots_check` CHECK (json_valid(`property_snapshot`) AND json_type(`property_snapshot`) = 'object' AND json_valid(`assessor_snapshot`) AND json_type(`assessor_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_inspections_revision_check` CHECK (`revision` > 0),
	CONSTRAINT `trade_rental_inspections_lifecycle_check` CHECK ((`status` = 'issued' AND datetime(`issued_at`) IS NOT NULL AND trim(`issued_report_id`) <> '') OR (`status` <> 'issued')),
	CONSTRAINT `trade_rental_inspections_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `trade_rental_correction_modules` (
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
	`updated_at` text NOT NULL, `selected_required` integer CHECK (`selected_required` IS NULL OR `selected_required` = 1),
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_modules_key_check` CHECK (`module_key` IN ('minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check')),
	CONSTRAINT `trade_rental_modules_required_check` CHECK ((`module_key` = 'minimum_standards' AND `required` = 1) OR (`module_key` <> 'minimum_standards' AND `required` = 0)),
	CONSTRAINT `trade_rental_modules_status_check` CHECK (`status` IN ('not_started', 'draft', 'complete', 'superseded')),
	CONSTRAINT `trade_rental_modules_snapshot_check` CHECK (json_valid(`template_snapshot`) AND json_type(`template_snapshot`) = 'object' AND json_extract(`template_snapshot`, '$.key') = `module_key` AND json_valid(`answers`) AND json_type(`answers`) = 'object' AND json_valid(`credential_snapshot`) AND json_type(`credential_snapshot`) = 'object'),
	CONSTRAINT `trade_rental_modules_revision_check` CHECK (`template_version` > 0 AND `revision` > 0),
	CONSTRAINT `trade_rental_modules_completion_check` CHECK ((`status` = 'complete' AND trim(`completed_by_uid`) <> '' AND datetime(`completed_at`) IS NOT NULL) OR (`status` <> 'complete' AND `completed_by_uid` = '' AND `completed_at` = '')),
	CONSTRAINT `trade_rental_modules_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `trade_rental_correction_items` (
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
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_correction_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_items_key_check` CHECK (trim(`item_key`) <> '' AND trim(`section_key`) <> '' AND trim(`check_key`) <> '' AND trim(`instance_key`) <> ''),
	CONSTRAINT `trade_rental_items_outcome_check` CHECK (`outcome` IN ('not_assessed', 'meets', 'does_not_meet', 'specialist_verification_required', 'not_accessible', 'not_applicable', 'exemption_evidence_pending')),
	CONSTRAINT `trade_rental_items_response_check` CHECK (json_valid(`response_json`) AND json_type(`response_json`) = 'object'),
	CONSTRAINT `trade_rental_items_bounds_check` CHECK (`required_evidence_count` BETWEEN 0 AND 20 AND `sort_order` BETWEEN 0 AND 10000 AND `revision` > 0 AND length(`public_notes`) <= 4000 AND length(`internal_notes`) <= 4000),
	CONSTRAINT `trade_rental_items_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `trade_rental_correction_events` (
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
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_events_actor_check` CHECK (`actor_type` IN ('assessor', 'owner', 'viewer', 'system')),
	CONSTRAINT `trade_rental_events_metadata_check` CHECK (json_valid(`metadata`) AND json_type(`metadata`) = 'object' AND length(`summary`) <= 2000),
	CONSTRAINT `trade_rental_events_hash_check` CHECK ((`source_ip_sha256` = '' OR (length(`source_ip_sha256`) = 64 AND `source_ip_sha256` = lower(`source_ip_sha256`) AND `source_ip_sha256` NOT GLOB '*[^0-9a-f]*')) AND (`user_agent_sha256` = '' OR (length(`user_agent_sha256`) = 64 AND `user_agent_sha256` = lower(`user_agent_sha256`) AND `user_agent_sha256` NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT `trade_rental_events_time_check` CHECK (datetime(`created_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `trade_rental_correction_evidence_links` (
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
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_correction_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_media_id`) REFERENCES `trade_crm_job_media`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_evidence_type_check` CHECK (`evidence_type` IN ('photo', 'document', 'measurement', 'signature') AND `status` IN ('active', 'superseded')),
	CONSTRAINT `trade_rental_evidence_bounds_check` CHECK (trim(`requirement_key`) <> '' AND length(`purpose`) <= 1000 AND length(`caption_snapshot`) <= 1000 AND `sort_order` BETWEEN 0 AND 10000),
	CONSTRAINT `trade_rental_evidence_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `trade_rental_correction_findings` (
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
	FOREIGN KEY (`inspection_id`) REFERENCES `trade_rental_corrections`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_id`) REFERENCES `trade_rental_correction_modules`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `trade_rental_findings_status_check` CHECK (`finding_status` IN ('compliant', 'recommendation', 'faulty', 'non_compliant', 'safety_issue', 'disconnected', 'not_tested', 'not_applicable')),
	CONSTRAINT `trade_rental_findings_severity_check` CHECK (`severity` IN ('immediate_safety_risk', 'urgent', 'required', 'recommended', 'information')),
	CONSTRAINT `trade_rental_findings_details_check` CHECK (json_valid(`details`) AND json_type(`details`) = 'object'),
	CONSTRAINT `trade_rental_findings_bounds_check` CHECK (trim(`finding_key`) <> '' AND trim(`category`) <> '' AND trim(`title`) <> '' AND `quantity_milli` BETWEEN 0 AND 1000000000 AND length(`description`) <= 8000 AND length(`scope_summary`) <= 8000 AND length(`internal_notes`) <= 4000 AND `revision` > 0),
	CONSTRAINT `trade_rental_findings_time_check` CHECK (datetime(`created_at`) IS NOT NULL AND datetime(`updated_at`) IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE trade_rental_corrections ADD COLUMN source_inspection_id TEXT NOT NULL REFERENCES trade_rental_inspections(id);
ALTER TABLE trade_rental_corrections ADD COLUMN source_report_id TEXT NOT NULL REFERENCES trade_rental_reports(id);
ALTER TABLE trade_rental_corrections ADD COLUMN source_report_sha256 TEXT NOT NULL CHECK(length(source_report_sha256)=64);
ALTER TABLE trade_rental_corrections ADD COLUMN source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64);
ALTER TABLE trade_rental_corrections ADD COLUMN correction_reason TEXT NOT NULL DEFAULT '' CHECK(length(correction_reason)<=1000);
CREATE UNIQUE INDEX trade_rental_corrections_active_job_idx ON trade_rental_corrections(firebase_uid,work_order_id) WHERE status NOT IN ('issued','superseded','withdrawn');
CREATE INDEX trade_rental_corrections_job_idx ON trade_rental_corrections(firebase_uid,work_order_id,created_at);
CREATE UNIQUE INDEX trade_rental_corrections_report_idx ON trade_rental_corrections(issued_report_id) WHERE issued_report_id<>'';
CREATE UNIQUE INDEX trade_rental_correction_modules_key_idx ON trade_rental_correction_modules(inspection_id,module_key);
CREATE UNIQUE INDEX trade_rental_correction_items_key_idx ON trade_rental_correction_items(inspection_id,item_key);
CREATE UNIQUE INDEX trade_rental_correction_findings_key_idx ON trade_rental_correction_findings(inspection_id,finding_key);
CREATE UNIQUE INDEX trade_rental_correction_evidence_key_idx ON trade_rental_correction_evidence_links(inspection_id,requirement_key,job_media_id);
CREATE INDEX trade_rental_correction_events_parent_idx ON trade_rental_correction_events(inspection_id,created_at);
