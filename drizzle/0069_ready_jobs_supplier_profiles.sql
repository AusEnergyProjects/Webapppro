CREATE TABLE `trade_supplier_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`location_name` text NOT NULL,
	`location_type` text DEFAULT 'warehouse' NOT NULL,
	`address_line_1` text NOT NULL,
	`suburb` text NOT NULL,
	`address_state` text NOT NULL,
	`postcode` text NOT NULL,
	`sales_email` text DEFAULT '' NOT NULL,
	`contact_number` text DEFAULT '' NOT NULL,
	`dispatch_notes` text DEFAULT '' NOT NULL,
	`service_states_json` text DEFAULT '[]' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_supplier_locations_owner_name_idx` ON `trade_supplier_locations` (`firebase_uid`,`location_name`);
--> statement-breakpoint
CREATE INDEX `trade_supplier_locations_owner_status_idx` ON `trade_supplier_locations` (`firebase_uid`,`record_status`,`address_state`,`postcode`);
--> statement-breakpoint
INSERT INTO `trade_supplier_locations` (`id`, `firebase_uid`, `location_name`, `location_type`, `address_line_1`, `suburb`, `address_state`, `postcode`, `sales_email`, `contact_number`, `dispatch_notes`, `service_states_json`, `record_status`, `created_at`, `updated_at`)
SELECT 'primary-' || `firebase_uid`, `firebase_uid`, 'Registered location', 'head_office', `address_line_1`, `suburb`, `address_state`, `postcode`, `email`, `phone`, '', `service_states`, 'active', `created_at`, `updated_at`
FROM `trade_accounts` WHERE `partner_type` = 'supplier' AND `account_status` = 'active';
--> statement-breakpoint
CREATE TABLE `trade_crm_job_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`commercial_handoff_id` text NOT NULL,
	`quote_version_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`commercial_reference` text NOT NULL,
	`source_kind` text DEFAULT 'manual_quote' NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`accepted_subtotal_cents` integer NOT NULL,
	`accepted_tax_cents` integer NOT NULL,
	`accepted_total_cents` integer NOT NULL,
	`budget_cost_cents` integer DEFAULT 0 NOT NULL,
	`budget_margin_cents` integer DEFAULT 0 NOT NULL,
	`expected_duration_minutes` integer DEFAULT 0 NOT NULL,
	`suggested_crew_size` integer DEFAULT 1 NOT NULL,
	`deposit_requirement` text DEFAULT 'optional' NOT NULL,
	`ready_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_plans_handoff_idx` ON `trade_crm_job_plans` (`commercial_handoff_id`);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_plans_work_idx` ON `trade_crm_job_plans` (`firebase_uid`,`work_order_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `trade_crm_job_plan_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`job_plan_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`customer_description` text NOT NULL,
	`source_packet_id` text DEFAULT '' NOT NULL,
	`source_packet_revision` integer DEFAULT 0 NOT NULL,
	`expected_duration_minutes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_plan_phases_position_idx` ON `trade_crm_job_plan_phases` (`job_plan_id`,`position`);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_plan_phases_owner_idx` ON `trade_crm_job_plan_phases` (`firebase_uid`,`job_plan_id`);
--> statement-breakpoint
CREATE TABLE `trade_crm_job_plan_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`job_plan_id` text NOT NULL,
	`job_plan_phase_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`position` integer NOT NULL,
	`requirement_type` text NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`total_cost_cents` integer DEFAULT 0 NOT NULL,
	`expected_duration_minutes` integer DEFAULT 0 NOT NULL,
	`required_capability` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'required' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_job_plan_requirements_position_idx` ON `trade_crm_job_plan_requirements` (`job_plan_id`,`position`);
--> statement-breakpoint
CREATE INDEX `trade_crm_job_plan_requirements_owner_idx` ON `trade_crm_job_plan_requirements` (`firebase_uid`,`job_plan_id`,`requirement_type`);
