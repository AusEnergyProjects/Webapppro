CREATE TABLE `trade_crm_enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`firebase_uid` text NOT NULL,
	`source_type` text DEFAULT 'direct' NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`external_record_id` text DEFAULT '' NOT NULL,
	`opportunity_match_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`customer_id` text DEFAULT '' NOT NULL,
	`customer_contact_id` text DEFAULT '' NOT NULL,
	`service_site_id` text DEFAULT '' NOT NULL,
	`customer_type` text DEFAULT 'residential' NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`business_name` text DEFAULT '' NOT NULL,
	`business_number` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address_line_1` text DEFAULT '' NOT NULL,
	`address_line_2` text DEFAULT '' NOT NULL,
	`suburb` text DEFAULT '' NOT NULL,
	`address_state` text DEFAULT '' NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`service_category` text DEFAULT 'other' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`urgency` text DEFAULT 'standard' NOT NULL,
	`preferred_date` text DEFAULT '' NOT NULL,
	`service_region` text DEFAULT '' NOT NULL,
	`assigned_label` text DEFAULT '' NOT NULL,
	`next_follow_up_at` text DEFAULT '' NOT NULL,
	`lost_reason` text DEFAULT '' NOT NULL,
	`protected_source` integer DEFAULT false NOT NULL,
	`duplicate_decision` text DEFAULT 'unchecked' NOT NULL,
	`record_status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_crm_enquiries_owner_source_idx` ON `trade_crm_enquiries` (`firebase_uid`,`source_type`,`source_reference`);--> statement-breakpoint
CREATE INDEX `trade_crm_enquiries_owner_status_idx` ON `trade_crm_enquiries` (`firebase_uid`,`record_status`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_crm_enquiries_owner_external_idx` ON `trade_crm_enquiries` (`firebase_uid`,`external_record_id`);--> statement-breakpoint
CREATE INDEX `trade_crm_enquiries_customer_idx` ON `trade_crm_enquiries` (`firebase_uid`,`customer_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_enquiry_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`enquiry_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`object_key` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'metadata_only' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_enquiry_attachments_owner_idx` ON `trade_crm_enquiry_attachments` (`firebase_uid`,`enquiry_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_enquiry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`enquiry_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_enquiry_events_owner_idx` ON `trade_crm_enquiry_events` (`firebase_uid`,`enquiry_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trade_crm_enquiry_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`enquiry_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`channel` text DEFAULT 'note' NOT NULL,
	`direction` text DEFAULT 'internal' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_crm_enquiry_messages_owner_idx` ON `trade_crm_enquiry_messages` (`firebase_uid`,`enquiry_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `trade_crm_customers` ADD `business_number` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO `trade_crm_enquiries`
(`id`, `firebase_uid`, `source_type`, `source_reference`, `external_record_id`, `opportunity_match_id`, `status`,
 `service_category`, `description`, `urgency`, `service_region`, `protected_source`, `duplicate_decision`,
 `record_status`, `created_at`, `updated_at`)
SELECT 'marketplace-' || m.id, m.firebase_uid, 'tlink_marketplace', m.id, '', m.id,
  CASE
    WHEN m.status IN ('interested', 'connected') THEN 'contacted'
    WHEN m.status IN ('declined', 'closed') THEN 'lost'
    ELSE 'new'
  END,
  COALESCE(NULLIF(o.project_type, ''), 'other'), o.summary, o.priority, o.state, 1, 'protected', 'active', m.matched_at, m.updated_at
FROM `trade_opportunity_matches` m
JOIN `trade_opportunities` o ON o.id = m.opportunity_id
ON CONFLICT (`firebase_uid`, `source_type`, `source_reference`) DO NOTHING;
