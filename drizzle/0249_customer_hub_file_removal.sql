ALTER TABLE customer_hub_files ADD COLUMN removed_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE customer_hub_files ADD COLUMN storage_deleted_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
DROP INDEX customer_hub_files_duplicate;
--> statement-breakpoint
CREATE UNIQUE INDEX customer_hub_files_duplicate ON customer_hub_files(question_id,sha256) WHERE removed_at='';
--> statement-breakpoint
CREATE TABLE customer_hub_events_next (
  id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, question_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('asked','replied','answered','file_added','file_removed','opened','closed')),
  author_match_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO customer_hub_events_next(id,opportunity_id,question_id,event_type,author_match_id,created_at)
SELECT id,opportunity_id,question_id,event_type,author_match_id,created_at FROM customer_hub_events;
--> statement-breakpoint
DROP TABLE customer_hub_events;
--> statement-breakpoint
ALTER TABLE customer_hub_events_next RENAME TO customer_hub_events;
--> statement-breakpoint
CREATE INDEX customer_hub_events_opportunity ON customer_hub_events(opportunity_id,created_at);
