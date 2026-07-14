CREATE TABLE `lead_rate_limits` (
	`client_hash` text PRIMARY KEY NOT NULL,
	`timestamps` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lead_rate_limits_updated_idx` ON `lead_rate_limits` (`updated_at`);