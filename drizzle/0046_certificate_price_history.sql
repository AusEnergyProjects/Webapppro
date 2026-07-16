CREATE TABLE `certificate_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`certificate_code` text NOT NULL,
	`traded_on` text NOT NULL,
	`price_cents` integer NOT NULL,
	`source_url` text NOT NULL,
	`captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificate_price_history_code_date_idx` ON `certificate_price_history` (`certificate_code`,`traded_on`);--> statement-breakpoint
CREATE INDEX `certificate_price_history_date_idx` ON `certificate_price_history` (`traded_on`);--> statement-breakpoint
CREATE TABLE `certificate_price_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`status` text NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `certificate_price_sync_runs_status_date_idx` ON `certificate_price_sync_runs` (`status`,`fetched_at`);