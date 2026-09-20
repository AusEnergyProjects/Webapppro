CREATE TABLE trade_sms_connections (
  id TEXT PRIMARY KEY NOT NULL,
  firebase_uid TEXT NOT NULL,
  account_sid TEXT NOT NULL,
  account_label TEXT NOT NULL,
  account_type TEXT NOT NULL,
  number_sid TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connecting',
  daily_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_limit BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_connections_number_idx ON trade_sms_connections(account_sid, number_sid);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_connections_active_owner_idx ON trade_sms_connections(firebase_uid) WHERE status IN ('connecting', 'connected');
--> statement-breakpoint
CREATE TABLE trade_sms_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES trade_sms_connections(id),
  firebase_uid TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  consent_note TEXT NOT NULL DEFAULT '',
  consent_at TEXT NOT NULL DEFAULT '',
  opted_out_at TEXT NOT NULL DEFAULT '',
  opt_in_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_recipients_number_idx ON trade_sms_recipients(connection_id, phone_number);
--> statement-breakpoint
CREATE INDEX trade_sms_recipients_customer_idx ON trade_sms_recipients(firebase_uid, customer_id);
--> statement-breakpoint
CREATE TABLE trade_sms_messages (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL REFERENCES trade_sms_connections(id),
  recipient_id TEXT NOT NULL REFERENCES trade_sms_recipients(id),
  firebase_uid TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  segments INTEGER NOT NULL CHECK (segments >= 1),
  request_id TEXT NOT NULL DEFAULT '',
  provider_message_sid TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_messages_request_idx ON trade_sms_messages(firebase_uid, request_id) WHERE direction = 'outbound';
--> statement-breakpoint
CREATE UNIQUE INDEX trade_sms_messages_provider_idx ON trade_sms_messages(connection_id, provider_message_sid) WHERE provider_message_sid <> '';
--> statement-breakpoint
CREATE INDEX trade_sms_messages_history_idx ON trade_sms_messages(firebase_uid, customer_id, created_at);
--> statement-breakpoint
CREATE INDEX trade_sms_messages_usage_idx ON trade_sms_messages(firebase_uid, direction, created_at);
