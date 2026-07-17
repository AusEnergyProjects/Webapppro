ALTER TABLE `customer_project_arrival_proposals` ADD `direct_contact_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_project_arrival_proposals` ADD `direct_contact_selected_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_project_arrival_proposals` ADD `crm_work_order_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_project_arrival_proposals` ADD `crm_appointment_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_project_arrival_proposals` ADD `preparation_acknowledged_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_accounts` ADD `abn` text DEFAULT '' NOT NULL;