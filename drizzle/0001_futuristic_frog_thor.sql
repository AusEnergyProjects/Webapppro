PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trade_accounts` (
	`firebase_uid` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`business_name` text NOT NULL,
	`address_line_1` text DEFAULT '' NOT NULL,
	`suburb` text DEFAULT '' NOT NULL,
	`address_state` text DEFAULT '' NOT NULL,
	`postcode` text DEFAULT '' NOT NULL,
	`contact_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`partner_type` text DEFAULT 'installer' NOT NULL,
	`business_website` text DEFAULT '' NOT NULL,
	`service_states` text DEFAULT '[]' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`account_status` text DEFAULT 'active' NOT NULL,
	`verification_status` text DEFAULT 'not_started' NOT NULL,
	`plan_key` text DEFAULT 'unselected' NOT NULL,
	`billing_status` text DEFAULT 'not_connected' NOT NULL,
	`consent_version` text NOT NULL,
	`consent_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_trade_accounts`("firebase_uid", "email", "business_name", "address_line_1", "suburb", "address_state", "postcode", "contact_name", "phone", "partner_type", "business_website", "service_states", "capabilities", "summary", "account_status", "verification_status", "plan_key", "billing_status", "consent_version", "consent_at", "created_at", "updated_at") SELECT "firebase_uid", "email", "business_name", '', '', '', '', "contact_name", "phone", "partner_type", "business_website", "service_states", "capabilities", "summary", "account_status", "verification_status", 'unselected', 'not_connected', "consent_version", "consent_at", "created_at", "updated_at" FROM `trade_accounts`;--> statement-breakpoint
DROP TABLE `trade_accounts`;--> statement-breakpoint
ALTER TABLE `__new_trade_accounts` RENAME TO `trade_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
