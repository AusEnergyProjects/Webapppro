CREATE TABLE trade_team_calls (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES trade_message_threads(id),
  mode TEXT NOT NULL CHECK (mode IN ('audio','video')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_by_member_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT NOT NULL DEFAULT '',
  next_signal_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_signal_sequence>=0),
  had_peer INTEGER NOT NULL DEFAULT 0 CHECK (had_peer IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_team_calls_active_thread_idx ON trade_team_calls(owner_uid,thread_id) WHERE status='active';
--> statement-breakpoint
CREATE UNIQUE INDEX trade_team_calls_request_idx ON trade_team_calls(owner_uid,created_by_member_id,request_id);
--> statement-breakpoint
CREATE INDEX trade_team_calls_owner_expiry_idx ON trade_team_calls(owner_uid,status,expires_at);
--> statement-breakpoint
CREATE TABLE trade_team_call_participants (
  call_id TEXT NOT NULL REFERENCES trade_team_calls(id),
  owner_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  left_at TEXT NOT NULL DEFAULT '',
  ice_issued_at TEXT NOT NULL DEFAULT '',
  ice_issued_count INTEGER NOT NULL DEFAULT 0 CHECK (ice_issued_count BETWEEN 0 AND 10),
  PRIMARY KEY (call_id,member_id)
);
--> statement-breakpoint
CREATE INDEX trade_team_call_participants_member_idx ON trade_team_call_participants(owner_uid,member_id,last_seen_at);
--> statement-breakpoint
CREATE TABLE trade_team_call_signals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  call_id TEXT NOT NULL REFERENCES trade_team_calls(id),
  sequence INTEGER NOT NULL CHECK (sequence>0),
  from_member_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL,
  to_member_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('offer','answer','ice')),
  payload TEXT NOT NULL CHECK (length(payload)<=65000),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_team_call_signals_sequence_idx ON trade_team_call_signals(call_id,sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX trade_team_call_signals_request_idx ON trade_team_call_signals(call_id,from_member_id,from_session_id,request_id);
--> statement-breakpoint
CREATE INDEX trade_team_call_signals_recipient_idx ON trade_team_call_signals(owner_uid,call_id,to_member_id,to_session_id,sequence);
