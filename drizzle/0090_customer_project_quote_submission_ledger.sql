CREATE TABLE `customer_project_quote_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_match_id` text NOT NULL,
	`installer_uid` text NOT NULL,
	`submission_request_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`submission_revision` integer NOT NULL CHECK (`submission_revision` > 0),
	`quote_snapshot` text NOT NULL,
	`submitted_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_quote_submissions_request_idx`
ON `customer_project_quote_submissions` (`installer_uid`,`opportunity_match_id`,`submission_request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_quote_submissions_revision_idx`
ON `customer_project_quote_submissions` (`installer_uid`,`opportunity_match_id`,`submission_revision`);
--> statement-breakpoint
CREATE INDEX `customer_project_quote_submissions_quote_idx`
ON `customer_project_quote_submissions` (`quote_id`,`submitted_at`);
