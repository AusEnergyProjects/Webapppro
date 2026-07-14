CREATE TABLE `verification_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`expiry_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_documents_object_key_unique` ON `verification_documents` (`object_key`);--> statement-breakpoint
CREATE INDEX `verification_documents_owner_idx` ON `verification_documents` (`firebase_uid`);