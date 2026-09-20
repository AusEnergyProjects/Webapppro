CREATE TABLE creditex_voice_connections (
 id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, account_key_hash TEXT NOT NULL,
 account_label TEXT NOT NULL, encrypted_credentials TEXT NOT NULL,
 credential_connection_id TEXT NOT NULL DEFAULT '', call_control_application_id TEXT NOT NULL DEFAULT '',
 outbound_voice_profile_id TEXT NOT NULL DEFAULT '', default_number_id TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'connecting' CHECK(status IN ('connecting','connected','disconnected')),
 provision_stage TEXT NOT NULL DEFAULT 'new' CHECK(provision_stage IN ('new','profile_pending','profile_ready','credential_pending','credential_ready','application_pending','ready')),
 authorised_by_member_id TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_voice_active_org_idx ON creditex_voice_connections(organisation_id) WHERE status IN ('connecting','connected');
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_voice_active_account_idx ON creditex_voice_connections(account_key_hash) WHERE status IN ('connecting','connected');
--> statement-breakpoint
CREATE TABLE creditex_voice_numbers (
 connection_id TEXT NOT NULL REFERENCES creditex_voice_connections(id), number_id TEXT NOT NULL,
 phone_number TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(connection_id,number_id), UNIQUE(connection_id,phone_number)
);
--> statement-breakpoint
CREATE TABLE creditex_voice_assignments (
 connection_id TEXT NOT NULL REFERENCES creditex_voice_connections(id), member_id TEXT NOT NULL, number_id TEXT NOT NULL,
 PRIMARY KEY(connection_id,member_id)
);
--> statement-breakpoint
CREATE TABLE creditex_audit_calls (
 id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES creditex_voice_connections(id),
 case_id TEXT NOT NULL DEFAULT '', job_intent_id TEXT NOT NULL DEFAULT '',
 started_by_uid TEXT NOT NULL, started_by_member_id TEXT NOT NULL, started_by_name TEXT NOT NULL, request_id TEXT NOT NULL,
 customer_phone TEXT NOT NULL, caller_id TEXT NOT NULL, credential_connection_id TEXT NOT NULL, call_control_application_id TEXT NOT NULL,
 telephony_credential_id TEXT NOT NULL DEFAULT '', intent_secret_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','dialing','ringing','awaiting_consent','in_progress','completed','declined','cancelled','expired','failed','busy','no_answer')),
 expires_at TEXT NOT NULL, active_until TEXT NOT NULL,
 agent_call_control_id TEXT NOT NULL DEFAULT '', agent_call_leg_id TEXT NOT NULL DEFAULT '',
 agent_ended INTEGER NOT NULL DEFAULT 0, customer_ended INTEGER NOT NULL DEFAULT 0,
 customer_call_control_id TEXT NOT NULL DEFAULT '', customer_call_leg_id TEXT NOT NULL DEFAULT '', customer_call_session_id TEXT NOT NULL DEFAULT '',
 consent_stage TEXT NOT NULL DEFAULT '' CHECK(consent_stage IN ('','notice','gather','consented')),
 consented_at TEXT NOT NULL DEFAULT '', consent_version TEXT NOT NULL DEFAULT '', consent_notice TEXT NOT NULL DEFAULT '',
 recording_status TEXT NOT NULL DEFAULT 'none' CHECK(recording_status IN ('none','starting','recording','pending','saving','saved','failed','unknown')),
 recording_id TEXT NOT NULL DEFAULT '', recording_object_key TEXT NOT NULL DEFAULT '', recording_sha256 TEXT NOT NULL DEFAULT '',
 recording_size_bytes INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER NOT NULL DEFAULT 0, recording_attempts INTEGER NOT NULL DEFAULT 0,
 next_recording_attempt_at TEXT NOT NULL DEFAULT '', recording_lease_token TEXT NOT NULL DEFAULT '', recording_lease_until TEXT NOT NULL DEFAULT '',
 end_requested INTEGER NOT NULL DEFAULT 0, saved_at TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(case_id <> '' OR job_intent_id <> ''),
 CHECK(recording_status <> 'saved' OR (recording_object_key <> '' AND length(recording_sha256)=64 AND recording_size_bytes>0 AND consented_at<>'' AND recording_id<>''))
);
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_request_idx ON creditex_audit_calls(organisation_id,started_by_uid,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_active_operator_idx ON creditex_audit_calls(started_by_uid) WHERE status IN ('prepared','dialing','ringing','awaiting_consent','in_progress');
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_secret_idx ON creditex_audit_calls(intent_secret_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_agent_idx ON creditex_audit_calls(connection_id,agent_call_control_id) WHERE agent_call_control_id<>'';
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_customer_idx ON creditex_audit_calls(connection_id,customer_call_leg_id) WHERE customer_call_leg_id<>'';
--> statement-breakpoint
CREATE UNIQUE INDEX creditex_audit_call_recording_idx ON creditex_audit_calls(connection_id,recording_id) WHERE recording_id<>'';
--> statement-breakpoint
CREATE INDEX creditex_audit_call_case_idx ON creditex_audit_calls(organisation_id,case_id,created_at);
--> statement-breakpoint
CREATE INDEX creditex_audit_call_job_idx ON creditex_audit_calls(organisation_id,job_intent_id,created_at);
--> statement-breakpoint
CREATE INDEX creditex_audit_call_usage_idx ON creditex_audit_calls(organisation_id,created_at);
--> statement-breakpoint
CREATE INDEX creditex_audit_call_custody_idx ON creditex_audit_calls(recording_status,next_recording_attempt_at);
