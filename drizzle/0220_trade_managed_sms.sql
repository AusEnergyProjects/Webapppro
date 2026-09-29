ALTER TABLE trade_sms_connections ADD COLUMN provider TEXT NOT NULL DEFAULT 'twilio' CHECK(provider IN ('twilio','clicksend'));
--> statement-breakpoint
ALTER TABLE trade_sms_recipients ADD COLUMN marketing_consent_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trade_sms_recipients ADD COLUMN marketing_consent_note TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trade_sms_messages ADD COLUMN purpose TEXT NOT NULL DEFAULT 'service' CHECK(purpose IN ('service','marketing'));
--> statement-breakpoint
ALTER TABLE trade_sms_messages ADD COLUMN price_micro INTEGER NOT NULL DEFAULT 0 CHECK(price_micro >= 0);
--> statement-breakpoint
CREATE TABLE trade_sms_accounts (
 owner_uid TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'new', subaccount_id TEXT NOT NULL DEFAULT '',
 encrypted_credentials TEXT NOT NULL DEFAULT '', encrypted_registration TEXT NOT NULL DEFAULT '',
 callback_token_hash TEXT NOT NULL DEFAULT '', provisioning_order_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_accounts_provider_idx ON trade_sms_accounts(subaccount_id) WHERE subaccount_id <> '';
--> statement-breakpoint
CREATE TABLE trade_sms_ledger (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, kind TEXT NOT NULL,
 amount_micro INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX trade_sms_ledger_owner_idx ON trade_sms_ledger(owner_uid,created_at);
--> statement-breakpoint
CREATE TABLE trade_sms_topups (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, request_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents IN (5000,10000,20000)),
 status TEXT NOT NULL DEFAULT 'creating', session_id TEXT NOT NULL DEFAULT '', payment_intent_id TEXT NOT NULL DEFAULT '',
 checkout_url TEXT NOT NULL DEFAULT '', refunded_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_topups_request_idx ON trade_sms_topups(owner_uid,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_topups_session_idx ON trade_sms_topups(session_id) WHERE session_id <> '';
--> statement-breakpoint
CREATE TABLE trade_sms_number_orders (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, request_id TEXT NOT NULL, number TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'reserved', setup_micro INTEGER NOT NULL CHECK(setup_micro >= 0), monthly_micro INTEGER NOT NULL CHECK(monthly_micro >= 0),
 initial_reserved_micro INTEGER NOT NULL DEFAULT 0 CHECK(initial_reserved_micro >= 0), initial_charge_micro INTEGER NOT NULL DEFAULT -1 CHECK(initial_charge_micro >= -1),
 connection_id TEXT NOT NULL DEFAULT '', renewal_at TEXT NOT NULL DEFAULT '', inbound_rule_id TEXT NOT NULL DEFAULT '', receipt_rule_id TEXT NOT NULL DEFAULT '',
 error TEXT NOT NULL DEFAULT '', lease_token TEXT NOT NULL DEFAULT '', lease_expires_at TEXT NOT NULL DEFAULT '',
 purchase_attempted_at TEXT NOT NULL DEFAULT '', provider_owned_at TEXT NOT NULL DEFAULT '',
 inbound_rule_attempted_at TEXT NOT NULL DEFAULT '', receipt_rule_attempted_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_number_orders_request_idx ON trade_sms_number_orders(owner_uid,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_number_orders_owner_idx ON trade_sms_number_orders(owner_uid) WHERE status NOT IN ('cancelled','rejected');
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_number_orders_number_idx ON trade_sms_number_orders(number) WHERE status NOT IN ('cancelled','rejected');
--> statement-breakpoint
CREATE TABLE trade_sms_automation_rules (
 owner_uid TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('appointment_reminder','appointment_follow_up','review_request')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), delay_hours INTEGER NOT NULL CHECK(delay_hours BETWEEN 1 AND 1008),
 body TEXT NOT NULL, review_url TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 enabled_at TEXT NOT NULL DEFAULT '', next_scan_at TEXT NOT NULL DEFAULT '', scan_cursor TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_uid,kind)
);
--> statement-breakpoint
CREATE TABLE trade_sms_automation_events (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, rule_kind TEXT NOT NULL, rule_revision INTEGER NOT NULL,
 work_order_id TEXT NOT NULL, customer_id TEXT NOT NULL, appointment_id TEXT NOT NULL, appointment_start TEXT NOT NULL,
 event_key TEXT NOT NULL UNIQUE, due_at TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX trade_sms_automation_events_owner_idx ON trade_sms_automation_events(owner_uid,created_at);
