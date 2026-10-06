CREATE TABLE wattzun_usage_events (
  actor_uid TEXT NOT NULL CHECK (length(actor_uid) BETWEEN 1 AND 180),
  portal TEXT NOT NULL CHECK (portal IN ('trade', 'creditex', 'council')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 128),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 16 AND 72),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
  completed_at TEXT NOT NULL CHECK (length(completed_at) = 24 AND completed_at GLOB '????-??-??T??:??:??.???Z' AND julianday(completed_at) IS NOT NULL),
  PRIMARY KEY (actor_uid, portal, scope_id, request_id)
);
--> statement-breakpoint
CREATE INDEX wattzun_usage_events_actor_month_idx ON wattzun_usage_events(actor_uid, portal, scope_id, completed_at, kind);
