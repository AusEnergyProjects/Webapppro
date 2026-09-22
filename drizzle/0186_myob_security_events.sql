-- No customer, invoice, payment, token, IP address or provider response payloads.
CREATE TABLE myob_security_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_uid TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accounting.read','invoice.export','invoice.refresh','oauth.connect','oauth.callback','oauth.disconnect','access.denied','retention.review','admin.access','compliance.access')),
  resource_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('attempt','success','denied','failure')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX myob_security_events_owner_created_idx ON myob_security_events(owner_uid, created_at);
--> statement-breakpoint
CREATE INDEX myob_security_events_created_idx ON myob_security_events(created_at);
--> statement-breakpoint
CREATE TRIGGER myob_security_events_no_update BEFORE UPDATE ON myob_security_events
BEGIN SELECT RAISE(ABORT, 'MYOB_SECURITY_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER myob_security_events_retention_guard BEFORE DELETE ON myob_security_events
WHEN julianday(OLD.created_at) IS NULL OR julianday(OLD.created_at) > julianday('now','-365 days')
BEGIN SELECT RAISE(ABORT, 'MYOB_SECURITY_EVENT_RETENTION'); END;
--> statement-breakpoint
CREATE TRIGGER myob_security_events_timestamp_guard BEFORE INSERT ON myob_security_events
WHEN julianday(NEW.created_at) IS NULL OR abs(julianday(NEW.created_at) - julianday('now')) > (60.0 / 86400.0)
BEGIN SELECT RAISE(ABORT, 'MYOB_SECURITY_EVENT_TIMESTAMP'); END;
--> statement-breakpoint
ALTER TABLE trade_crm_oauth_states ADD COLUMN mfa_verified_at TEXT NOT NULL DEFAULT '';
