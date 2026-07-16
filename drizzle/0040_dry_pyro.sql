CREATE TABLE `workspace_list_views` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`owner_scope` text NOT NULL,
	`view_key` text NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_list_views_owner_view_idx` ON `workspace_list_views` (`owner_uid`,`owner_scope`,`view_key`);--> statement-breakpoint
CREATE INDEX `workspace_list_views_owner_idx` ON `workspace_list_views` (`owner_uid`,`owner_scope`,`updated_at`);