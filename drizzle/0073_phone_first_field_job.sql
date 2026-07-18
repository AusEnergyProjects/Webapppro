ALTER TABLE `trade_crm_job_details` ADD `building_type` text DEFAULT 'not_sure' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `travel_started_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `arrived_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `work_started_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `completed_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trade_crm_appointments` ADD `last_transition_by_uid` text DEFAULT '' NOT NULL;
