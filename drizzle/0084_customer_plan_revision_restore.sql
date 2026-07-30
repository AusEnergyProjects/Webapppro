ALTER TABLE `customer_projects` ADD `plan_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `customer_projects`
SET `plan_revision` = COALESCE((
	SELECT MAX(`revision_number`)
	FROM `customer_project_plan_revisions`
	WHERE `project_id` = `customer_projects`.`id`
		AND `customer_uid` = `customer_projects`.`firebase_uid`
), 1);
--> statement-breakpoint
ALTER TABLE `customer_project_plan_revisions` ADD `restored_from_revision` integer DEFAULT 0 NOT NULL;
