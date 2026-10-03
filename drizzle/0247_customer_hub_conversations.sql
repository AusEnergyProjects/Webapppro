CREATE TABLE customer_hub_interests (
  match_id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL,
  interested INTEGER NOT NULL CHECK(interested IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
  interested_since TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_uid TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE customer_hub_questions ADD COLUMN author_type TEXT NOT NULL DEFAULT 'trade' CHECK(author_type IN ('customer','trade'));
--> statement-breakpoint
CREATE TABLE customer_hub_replies (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, question_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK(author_type IN ('customer','trade')), match_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX customer_hub_replies_question ON customer_hub_replies(opportunity_id,question_id,created_at);
--> statement-breakpoint
CREATE TABLE customer_hub_events_next (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, question_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('asked','replied','answered','file_added','opened','closed')),
  author_match_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO customer_hub_events_next(id,opportunity_id,question_id,event_type,created_at)
SELECT id,opportunity_id,question_id,event_type,created_at FROM customer_hub_events;
--> statement-breakpoint
DROP TABLE customer_hub_events;
--> statement-breakpoint
ALTER TABLE customer_hub_events_next RENAME TO customer_hub_events;
--> statement-breakpoint
CREATE INDEX customer_hub_events_opportunity ON customer_hub_events(opportunity_id,created_at);
--> statement-breakpoint
CREATE TABLE customer_hub_email_deliveries (
  event_id TEXT PRIMARY KEY NOT NULL, release_id TEXT NOT NULL, email_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','unknown','stopped')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT '',
  first_attempt_at TEXT NOT NULL DEFAULT '', encrypted_payload TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX customer_hub_email_pending ON customer_hub_email_deliveries(status,next_attempt_at);
