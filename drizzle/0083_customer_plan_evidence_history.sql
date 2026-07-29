ALTER TABLE `customer_project_evidence` ADD `fact_keys` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `customer_project_evidence` ADD `sharing_scope` text DEFAULT 'allocated-installers' NOT NULL;
--> statement-breakpoint
CREATE TABLE `customer_project_plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`revision_number` integer NOT NULL,
	`event_type` text DEFAULT 'saved' NOT NULL,
	`plan_version` text DEFAULT '' NOT NULL,
	`goals` text DEFAULT '[]' NOT NULL,
	`home_features` text DEFAULT '[]' NOT NULL,
	`pace` text DEFAULT '' NOT NULL,
	`budget_range` text DEFAULT '' NOT NULL,
	`plan_snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_plan_revisions_number_idx` ON `customer_project_plan_revisions` (`project_id`,`revision_number`);
--> statement-breakpoint
CREATE INDEX `customer_project_plan_revisions_owner_idx` ON `customer_project_plan_revisions` (`customer_uid`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `customer_project_outcome_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`comfort_outcome` text NOT NULL,
	`energy_outcome` text NOT NULL,
	`completed_item_ids` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_project_outcome_checkins_owner_idx` ON `customer_project_outcome_checkins` (`customer_uid`,`project_id`,`recorded_at`);
--> statement-breakpoint
INSERT INTO `customer_project_plan_revisions`
	(`id`, `project_id`, `customer_uid`, `revision_number`, `event_type`, `plan_version`,
	 `goals`, `home_features`, `pace`, `budget_range`, `plan_snapshot`, `created_at`)
SELECT
	'baseline:' || `id`,
	`id`,
	`firebase_uid`,
	1,
	'baseline',
	COALESCE(CAST(json_extract(`plan_snapshot`, '$.version') AS text), ''),
	`goals`,
	`existing_features`,
	`pace`,
	`budget_range`,
	`plan_snapshot`,
	`updated_at`
FROM `customer_projects`;
