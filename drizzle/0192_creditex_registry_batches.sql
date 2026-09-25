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
CREATE TRIGGER creditex_registry_batch_item_ready_insert
BEFORE INSERT ON creditex_registry_batch_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM compliance_output_action_packets packet
    JOIN compliance_output_action_reviews review ON review.organisation_id=packet.organisation_id
      AND review.packet_id=packet.id AND review.decision='approved' AND review.packet_sha256=packet.packet_sha256
    JOIN creditex_registry_claim_accounts binding ON binding.organisation_id=packet.organisation_id
      AND binding.packet_id=packet.id AND binding.account_id=NEW.account_id AND binding.packet_sha256=packet.packet_sha256
    JOIN creditex_registry_accounts account ON account.organisation_id=binding.organisation_id AND account.id=binding.account_id
    JOIN creditex_registry_batches batch ON batch.organisation_id=NEW.organisation_id AND batch.id=NEW.batch_id
    JOIN compliance_cases compliance_case ON compliance_case.organisation_id=packet.organisation_id AND compliance_case.id=packet.compliance_case_id
    JOIN trade_work_orders work ON work.id=compliance_case.work_order_id AND work.firebase_uid=compliance_case.installer_uid
    WHERE packet.organisation_id=NEW.organisation_id AND packet.id=NEW.packet_id AND packet.packet_sha256=NEW.packet_sha256
      AND account.scheme=NEW.scheme AND account.version=NEW.account_version AND account.enabled=1
      AND work.record_status='active' AND work.stage<>'cancelled'
      AND (account.authority_expires_on='' OR account.authority_expires_on>=substr(batch.created_at,1,10))
      AND EXISTS(SELECT 1 FROM json_each(account.activity_scope) WHERE value=packet.activity_template_id)
      AND NOT EXISTS(SELECT 1 FROM compliance_output_action_events event WHERE event.organisation_id=packet.organisation_id
        AND event.packet_id=packet.id AND event.to_status<>'prepared')
      AND NOT EXISTS(SELECT 1 FROM compliance_output_dispatch_intents intent WHERE intent.organisation_id=packet.organisation_id AND intent.packet_id=packet.id)
  ) THEN RAISE(ABORT,'REGISTRY_BATCH_CLAIM_CHANGED') END;
  SELECT CASE WHEN NEW.scheme IN ('nsw_esc','nsw_prc','stc') AND NOT EXISTS (
    SELECT 1 FROM creditex_registry_exports output
    JOIN creditex_registry_export_reviews review ON review.organisation_id=output.organisation_id AND review.export_id=output.id AND review.decision='approved'
    WHERE output.organisation_id=NEW.organisation_id AND output.id=NEW.export_id AND output.account_id=NEW.account_id
      AND output.account_version=NEW.account_version
      AND EXISTS(SELECT 1 FROM json_each(output.packet_ids) WHERE value=NEW.packet_id)
  ) THEN RAISE(ABORT,'REGISTRY_BATCH_APPROVED_FILE_REQUIRED') END;
END;
