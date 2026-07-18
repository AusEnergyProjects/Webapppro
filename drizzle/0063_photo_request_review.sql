CREATE TABLE `trade_crm_photo_request_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_request_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`request_revision` integer NOT NULL,
	`completion_revision` integer NOT NULL,
	`checklist_version` text NOT NULL,
	`evidence_key` text NOT NULL,
	`required_count` integer NOT NULL,
	`supplied_count` integer NOT NULL,
	`completed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_request_completions_evidence_idx` ON `trade_crm_photo_request_completions` (`evidence_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_request_completions_revision_idx` ON `trade_crm_photo_request_completions` (`photo_request_id`,`completion_revision`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_completions_request_idx` ON `trade_crm_photo_request_completions` (`photo_request_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_request_completions_job_idx` ON `trade_crm_photo_request_completions` (`firebase_uid`,`work_order_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_photo_requirement_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_request_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`request_revision` integer NOT NULL,
	`review_revision` integer NOT NULL,
	`photo_requirement_id` text NOT NULL,
	`status` text NOT NULL,
	`reason_code` text DEFAULT '' NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`reviewed_upload_count` integer DEFAULT 0 NOT NULL,
	`actor_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_photo_requirement_reviews_revision_idx` ON `trade_crm_photo_requirement_reviews` (`photo_request_id`,`review_revision`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_requirement_reviews_requirement_idx` ON `trade_crm_photo_requirement_reviews` (`photo_request_id`,`photo_requirement_id`,`review_revision`);--> statement-breakpoint
CREATE INDEX `trade_crm_photo_requirement_reviews_job_idx` ON `trade_crm_photo_requirement_reviews` (`firebase_uid`,`work_order_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_photo_request_deliveries` ADD `review_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_photo_request_deliveries` ADD `photo_requirement_id` text DEFAULT '' NOT NULL;
