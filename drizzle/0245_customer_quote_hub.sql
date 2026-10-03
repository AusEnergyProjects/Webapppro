CREATE TABLE customer_quote_hubs (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL UNIQUE, release_id TEXT NOT NULL,
  email_hash TEXT NOT NULL, recipient_email TEXT NOT NULL, token_hash TEXT NOT NULL, encrypted_token TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  accepting INTEGER NOT NULL DEFAULT 1 CHECK(accepting IN (0,1)), revision INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE customer_hub_questions (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, match_id TEXT NOT NULL,
  service_categories_json TEXT NOT NULL CHECK(json_valid(service_categories_json) AND json_type(service_categories_json)='array' AND json_array_length(service_categories_json)>0),
  kind TEXT NOT NULL CHECK(kind IN ('text','photo','document')), prompt TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '', answer_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX customer_hub_questions_opportunity ON customer_hub_questions(opportunity_id,created_at);
--> statement-breakpoint
CREATE TABLE customer_hub_files (
  id TEXT PRIMARY KEY NOT NULL, question_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
  file_name TEXT NOT NULL, content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=8388608), object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX customer_hub_files_question ON customer_hub_files(question_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_hub_files_duplicate ON customer_hub_files(question_id,sha256);
--> statement-breakpoint
CREATE TABLE customer_hub_events (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, question_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('answered','file_added','opened','closed')), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX customer_hub_events_opportunity ON customer_hub_events(opportunity_id,created_at);
--> statement-breakpoint
CREATE TRIGGER customer_hub_quote_pause BEFORE UPDATE OF status ON trade_crm_quote_versions
WHEN NEW.status IN ('issuing','issued') AND NEW.status<>OLD.status AND EXISTS(
  SELECT 1 FROM trade_crm_quotes quote JOIN trade_work_orders work ON work.id=quote.work_order_id AND work.firebase_uid=quote.firebase_uid
  JOIN trade_opportunity_matches match ON match.id=work.source_reference AND match.firebase_uid=work.firebase_uid
  JOIN customer_quote_hubs hub ON hub.opportunity_id=match.opportunity_id AND hub.accepting=0
  WHERE quote.id=NEW.quote_id AND quote.firebase_uid=NEW.firebase_uid AND work.source_type='public_lead')
BEGIN SELECT RAISE(ABORT,'CUSTOMER_HUB_CLOSED'); END;
