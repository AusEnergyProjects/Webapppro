CREATE TABLE `customer_asset_ownerships` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`customer_uid` text NOT NULL,
	`active_key` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'original' NOT NULL,
	`transfer_id` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_asset_ownerships_active_key_idx` ON `customer_asset_ownerships` (`active_key`);--> statement-breakpoint
CREATE INDEX `customer_asset_ownerships_owner_idx` ON `customer_asset_ownerships` (`customer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_asset_ownerships_pack_idx` ON `customer_asset_ownerships` (`handover_pack_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `customer_asset_transfer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_uid` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_events_transfer_idx` ON `customer_asset_transfer_events` (`transfer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_events_actor_idx` ON `customer_asset_transfer_events` (`actor_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_asset_transfer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`from_customer_uid` text NOT NULL,
	`to_customer_uid` text DEFAULT '' NOT NULL,
	`claim_code_hash` text NOT NULL,
	`status` text DEFAULT 'awaiting_recipient' NOT NULL,
	`sender_consent_at` text NOT NULL,
	`recipient_consent_at` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by_uid` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_asset_transfer_requests_code_idx` ON `customer_asset_transfer_requests` (`claim_code_hash`);--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_requests_pack_idx` ON `customer_asset_transfer_requests` (`handover_pack_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_requests_sender_idx` ON `customer_asset_transfer_requests` (`from_customer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_requests_recipient_idx` ON `customer_asset_transfer_requests` (`to_customer_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `customer_asset_transfer_requests_expiry_idx` ON `customer_asset_transfer_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `trade_handover_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`handover_pack_id` text NOT NULL,
	`work_order_id` text NOT NULL,
	`firebase_uid` text NOT NULL,
	`asset_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`field_key` text NOT NULL,
	`previous_value` text DEFAULT '' NOT NULL,
	`proposed_value` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` text NOT NULL,
	`published_at` text DEFAULT '' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by_uid` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_handover_corrections_pack_version_idx` ON `trade_handover_corrections` (`handover_pack_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `trade_handover_corrections_owner_idx` ON `trade_handover_corrections` (`firebase_uid`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `trade_handover_corrections_pack_idx` ON `trade_handover_corrections` (`handover_pack_id`,`status`,`version_number`);--> statement-breakpoint
CREATE INDEX `trade_handover_corrections_asset_idx` ON `trade_handover_corrections` (`asset_id`,`version_number`);