CREATE TABLE `compliance_official_product_refresh_requests` (
	`registry_code` text PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	`not_before` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`last_error` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `compliance_official_product_refresh_requests_registry_code_check` CHECK(length(`registry_code`) BETWEEN 1 AND 80 AND `registry_code` NOT GLOB '*[^a-z0-9_-]*'),
	CONSTRAINT `compliance_official_product_refresh_requests_attempt_count_check` CHECK(`attempt_count` >= 0),
	CONSTRAINT `compliance_official_product_refresh_requests_last_error_check` CHECK(`last_error` IS NULL OR length(`last_error`) <= 500)
);
--> statement-breakpoint
CREATE INDEX `compliance_official_product_refresh_requests_due_idx` ON `compliance_official_product_refresh_requests` (`not_before`,`requested_at`);
