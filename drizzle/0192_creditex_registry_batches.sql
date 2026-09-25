CREATE TABLE creditex_registry_batches (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL,
  request_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
  evidence_id TEXT NOT NULL, manifest_snapshot TEXT NOT NULL CHECK(json_valid(manifest_snapshot)),
  manifest_sha256 TEXT NOT NULL, created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,id), UNIQUE(organisation_id,request_id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);

CREATE TABLE creditex_registry_batch_items (
  organisation_id TEXT NOT NULL, batch_id TEXT NOT NULL, packet_id TEXT NOT NULL,
  packet_sha256 TEXT NOT NULL, account_id TEXT NOT NULL, account_version INTEGER NOT NULL CHECK(account_version>0),
  scheme TEXT NOT NULL, group_key TEXT NOT NULL, export_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(organisation_id,packet_id),
  FOREIGN KEY(organisation_id,batch_id) REFERENCES creditex_registry_batches(organisation_id,id),
  FOREIGN KEY(organisation_id,packet_id) REFERENCES creditex_registry_claim_accounts(organisation_id,packet_id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id)
);
CREATE INDEX creditex_registry_batch_items_batch_idx ON creditex_registry_batch_items(organisation_id,batch_id);

-- Readiness is checked again inside the atomic batch transaction. An export
-- cannot win a race against a changed account, submission or dispatch intent.

-- Trigger bodies are installed by ensureCreditexJobLifecycleSchemaGuards through complete D1 prepared statements.
