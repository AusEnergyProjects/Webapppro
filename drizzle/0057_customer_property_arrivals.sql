CREATE TABLE `customer_project_arrival_events` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`proposal_revision` integer NOT NULL,
	`windows` text DEFAULT '[]' NOT NULL,
	`selected_window` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_project_arrival_events_proposal_idx` ON `customer_project_arrival_events` (`proposal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_project_arrival_events_project_idx` ON `customer_project_arrival_events` (`customer_uid`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_project_arrival_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`windows` text DEFAULT '[]' NOT NULL,
	`installer_note` text DEFAULT '' NOT NULL,
	`selected_window` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`proposed_at` text NOT NULL,
	`selected_at` text DEFAULT '' NOT NULL,
	`withdrawn_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_arrival_proposals_match_idx` ON `customer_project_arrival_proposals` (`opportunity_match_id`);--> statement-breakpoint
CREATE INDEX `customer_project_arrival_proposals_customer_idx` ON `customer_project_arrival_proposals` (`customer_uid`,`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_project_arrival_proposals_installer_idx` ON `customer_project_arrival_proposals` (`installer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `customer_project_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`client_upload_id` text NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_evidence_client_idx` ON `customer_project_evidence` (`customer_uid`,`project_id`,`client_upload_id`);--> statement-breakpoint
CREATE INDEX `customer_project_evidence_project_idx` ON `customer_project_evidence` (`customer_uid`,`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_project_evidence_events` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`installer_uid` text DEFAULT '' NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_project_evidence_events_item_idx` ON `customer_project_evidence_events` (`evidence_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_project_evidence_events_project_idx` ON `customer_project_evidence_events` (`customer_uid`,`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `customer_projects` ADD `property_context` text DEFAULT '{}' NOT NULL;