CREATE TABLE `customer_project_quote_acceptance_claims` (
	`project_id` text PRIMARY KEY NOT NULL,
	`customer_uid` text NOT NULL,
	`quote_id` text NOT NULL CHECK (length(`quote_id`) > 0),
	`opportunity_match_id` text NOT NULL,
	`contact_release_id` text NOT NULL,
	`accepted_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_project_quote_acceptance_claims_quote_idx`
ON `customer_project_quote_acceptance_claims` (`quote_id`);
--> statement-breakpoint
CREATE INDEX `customer_project_quote_acceptance_claims_owner_idx`
ON `customer_project_quote_acceptance_claims` (`customer_uid`,`accepted_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `customer_project_quote_acceptance_claims`
	(`project_id`, `customer_uid`, `quote_id`, `opportunity_match_id`,
	 `contact_release_id`, `accepted_at`, `created_at`)
SELECT q.`project_id`, p.`firebase_uid`, q.`id`, q.`opportunity_match_id`,
	r.`id`, q.`updated_at`, q.`updated_at`
FROM `customer_project_quotes` q
JOIN `customer_projects` p
	ON p.`id` = q.`project_id`
JOIN `customer_project_contact_releases` r
	ON r.`project_id` = q.`project_id`
	AND r.`quote_id` = q.`id`
	AND r.`customer_uid` = p.`firebase_uid`
	AND r.`installer_uid` = q.`installer_uid`
WHERE q.`status` = 'submitted'
	AND q.`customer_decision` = 'accepted'
ORDER BY q.`updated_at` DESC;
