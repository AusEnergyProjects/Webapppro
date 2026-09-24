-- D1 executes each migration in a transaction. Retain all existing account
-- identities and children while extending the allowed scheme keys.
-- Child relationships use NO ACTION; foreign key enforcement remains enabled.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE creditex_registry_accounts_retained_0191 AS
  SELECT * FROM creditex_registry_accounts;

DROP TABLE creditex_registry_accounts;
CREATE TABLE creditex_registry_accounts (
  id TEXT PRIMARY KEY NOT NULL, organisation_id TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK(scheme IN ('veu','nsw_esc','nsw_prc','stc','reps','eeis','lgc','rego','accu')),
  account_reference TEXT NOT NULL, submitter_reference TEXT NOT NULL DEFAULT '', legal_name TEXT NOT NULL,
  finance_email TEXT NOT NULL, results_email TEXT NOT NULL, activity_scope TEXT NOT NULL,
  authority_reference TEXT NOT NULL, authority_expires_on TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_by_uid TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organisation_id,scheme,account_reference), UNIQUE(organisation_id,id)
);

-- Reinsert into the original table name to resolve the deferred references.
INSERT INTO creditex_registry_accounts (
  id, organisation_id, scheme, account_reference, submitter_reference, legal_name,
  finance_email, results_email, activity_scope, authority_reference, authority_expires_on,
  version, enabled, created_by_uid, created_at, updated_at
)
SELECT id, organisation_id, scheme, account_reference, submitter_reference, legal_name,
  finance_email, results_email, activity_scope, authority_reference, authority_expires_on,
  version, enabled, created_by_uid, created_at, updated_at
FROM creditex_registry_accounts_retained_0191;

DROP TABLE creditex_registry_accounts_retained_0191;
