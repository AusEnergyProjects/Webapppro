-- Organisation-scoped claiming accounts, original evidence and registry operations.
-- Registration is supported by reviewed or authenticated registry evidence, never fee payment.
CREATE TABLE creditex_registry_accounts (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK(scheme IN ('veu','nsw_esc','nsw_prc','stc','reps','eeis','lgc')),
  account_reference TEXT NOT NULL, submitter_reference TEXT NOT NULL DEFAULT '', legal_name TEXT NOT NULL,
  finance_email TEXT NOT NULL, results_email TEXT NOT NULL, activity_scope TEXT NOT NULL,
  authority_reference TEXT NOT NULL, authority_expires_on TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organisation_id,scheme,account_reference), UNIQUE(organisation_id,id)
);
CREATE TABLE creditex_registry_claim_accounts (
  organisation_id TEXT NOT NULL, packet_id TEXT NOT NULL, account_id TEXT NOT NULL, packet_sha256 TEXT NOT NULL,
  bound_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id,packet_id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id)
);
CREATE TABLE creditex_registry_evidence (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL CHECK(byte_length>0),
  sha256 TEXT NOT NULL CHECK(length(sha256)=71), created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,id)
);
CREATE TABLE creditex_registry_invoices (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, account_id TEXT NOT NULL, reference TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000), due_date TEXT NOT NULL,
  evidence_id TEXT NOT NULL, payload_sha256 TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
  created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,account_id,reference), UNIQUE(organisation_id,id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);
CREATE TABLE creditex_registry_invoice_claims (
  organisation_id TEXT NOT NULL, invoice_id TEXT NOT NULL, packet_id TEXT NOT NULL,
  PRIMARY KEY(organisation_id,invoice_id,packet_id),
  FOREIGN KEY(organisation_id,invoice_id) REFERENCES creditex_registry_invoices(organisation_id,id),
  FOREIGN KEY(organisation_id,packet_id) REFERENCES creditex_registry_claim_accounts(organisation_id,packet_id)
);
CREATE TABLE creditex_registry_payments (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, invoice_id TEXT NOT NULL, reference TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000), paid_at TEXT NOT NULL,
  evidence_id TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,invoice_id,reference),
  FOREIGN KEY(organisation_id,invoice_id) REFERENCES creditex_registry_invoices(organisation_id,id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);
CREATE TABLE creditex_registry_results (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, packet_id TEXT NOT NULL, account_id TEXT NOT NULL,
  external_reference TEXT NOT NULL, registry_status TEXT NOT NULL CHECK(registry_status IN ('submitted','assessment','registered','rejected','withdrawn')),
  quantity TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, evidence_id TEXT NOT NULL, note TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('reviewed_document','rec_public_register')), fingerprint TEXT NOT NULL,
  recorded_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,packet_id,fingerprint), UNIQUE(organisation_id,id),
  FOREIGN KEY(organisation_id,packet_id) REFERENCES creditex_registry_claim_accounts(organisation_id,packet_id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);
CREATE TABLE creditex_registry_result_reviews (
  organisation_id TEXT NOT NULL, result_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  note TEXT NOT NULL, reviewed_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id,result_id),
  FOREIGN KEY(organisation_id,result_id) REFERENCES creditex_registry_results(organisation_id,id)
);
CREATE INDEX creditex_registry_results_claim_idx ON creditex_registry_results(organisation_id,packet_id,occurred_at);
CREATE TABLE creditex_registry_sync_runs (
  organisation_id TEXT NOT NULL, account_id TEXT NOT NULL, source_date TEXT NOT NULL, attempted_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '', source_sha256 TEXT NOT NULL DEFAULT '', matched_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(organisation_id,account_id,source_date),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id)
);
CREATE TABLE creditex_registry_exports (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL, account_id TEXT NOT NULL, format_key TEXT NOT NULL,
  base_vintage TEXT NOT NULL DEFAULT '', packet_ids TEXT NOT NULL, packet_hashes TEXT NOT NULL, evidence_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, account_version INTEGER NOT NULL, format_sha256 TEXT NOT NULL,
  created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organisation_id,account_id,payload_sha256), UNIQUE(organisation_id,id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);
CREATE TABLE creditex_registry_sync_matches (
  organisation_id TEXT NOT NULL, account_id TEXT NOT NULL, source_date TEXT NOT NULL, packet_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL, confirmed INTEGER NOT NULL CHECK(confirmed IN (0,1)), checked_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id,account_id,source_date,packet_id),
  FOREIGN KEY(organisation_id,account_id) REFERENCES creditex_registry_accounts(organisation_id,id),
  FOREIGN KEY(organisation_id,evidence_id) REFERENCES creditex_registry_evidence(organisation_id,id)
);
CREATE TABLE creditex_registry_export_reviews (
  organisation_id TEXT NOT NULL, export_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  note TEXT NOT NULL, reviewed_by_uid TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id,export_id),
  FOREIGN KEY(organisation_id,export_id) REFERENCES creditex_registry_exports(organisation_id,id)
);
