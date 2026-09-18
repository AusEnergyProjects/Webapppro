CREATE TABLE creditex_business_onboarding (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  business_abn TEXT NOT NULL DEFAULT '', business_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','agreement_pending','approved','rejected','suspended')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  application_json TEXT NOT NULL CHECK(json_valid(application_json)),
  insurance_expires_on TEXT NOT NULL DEFAULT '',
  agreement_reference TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by_uid TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  CHECK(status <> 'approved' OR (length(agreement_reference) > 0 AND length(reviewed_by_uid) > 0 AND date(insurance_expires_on) IS NOT NULL))
);
CREATE TABLE creditex_onboarding_documents (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('insurance','contractor_licence','director_id','director_selfie','guarantor_id','guarantor_selfie','prior_proposal')),
  file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 12582912),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64), object_key TEXT NOT NULL UNIQUE,
  uploaded_by_uid TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX creditex_onboarding_documents_owner_idx ON creditex_onboarding_documents(owner_uid,created_at);
CREATE TABLE creditex_onboarding_events (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, actor_uid TEXT NOT NULL,
  event_type TEXT NOT NULL, revision INTEGER NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL
);
CREATE INDEX creditex_onboarding_events_owner_idx ON creditex_onboarding_events(owner_uid,created_at);
CREATE TABLE trade_training_module_reviews (
  module_id TEXT PRIMARY KEY NOT NULL, version TEXT NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  status TEXT NOT NULL CHECK(status IN ('active','withdrawn')), source_reviewed_on TEXT NOT NULL,
  review_expires_on TEXT NOT NULL, scheme_authority_reference TEXT NOT NULL DEFAULT '',
  reviewed_by_uid TEXT NOT NULL, review_note TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE trade_training_attempts (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, member_id TEXT NOT NULL, actor_uid TEXT NOT NULL,
  module_id TEXT NOT NULL, version TEXT NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  status TEXT NOT NULL CHECK(status IN ('in_progress','passed','failed','expired')),
  started_at TEXT NOT NULL, expires_at TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT '',
  assessment_json TEXT NOT NULL CHECK(json_valid(assessment_json)),
  answers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(answers_json)), score_percent INTEGER NOT NULL DEFAULT 0 CHECK(score_percent BETWEEN 0 AND 100),
  critical_passed INTEGER NOT NULL DEFAULT 0 CHECK(critical_passed IN (0,1))
);
CREATE UNIQUE INDEX trade_training_attempts_open_idx ON trade_training_attempts(owner_uid,member_id,module_id) WHERE status='in_progress';
CREATE INDEX trade_training_attempts_member_idx ON trade_training_attempts(owner_uid,member_id,module_id,started_at);
CREATE TABLE trade_training_completions (
  id TEXT PRIMARY KEY NOT NULL, attempt_id TEXT NOT NULL UNIQUE REFERENCES trade_training_attempts(id),
  owner_uid TEXT NOT NULL, member_id TEXT NOT NULL, module_id TEXT NOT NULL, version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64), reference TEXT NOT NULL UNIQUE,
  passed_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT NOT NULL DEFAULT '', revocation_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX trade_training_completions_member_idx ON trade_training_completions(owner_uid,member_id,module_id,passed_at);
CREATE TABLE trade_training_external_credentials (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, member_id TEXT NOT NULL, module_id TEXT NOT NULL,
  document_id TEXT NOT NULL, credential_reference TEXT NOT NULL, scheme_participant_reference TEXT NOT NULL, expires_on TEXT NOT NULL,
  reviewed_by_uid TEXT NOT NULL, review_note TEXT NOT NULL, revoked_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX trade_training_external_credentials_member_idx ON trade_training_external_credentials(owner_uid,member_id,module_id,expires_on);
CREATE TABLE trade_training_events (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL DEFAULT '', member_id TEXT NOT NULL DEFAULT '', actor_uid TEXT NOT NULL,
  module_id TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL
);
CREATE INDEX trade_training_events_member_idx ON trade_training_events(owner_uid,member_id,created_at);

-- These views are live authorisation projections. They do not store eligibility,
-- course content or catalogue data: every read rechecks the source records.
CREATE VIEW creditex_current_business_approvals AS
SELECT onboarding.owner_uid
FROM creditex_business_onboarding onboarding
JOIN trade_accounts account ON account.firebase_uid = onboarding.owner_uid
  AND account.abn = onboarding.business_abn AND account.business_name = onboarding.business_name
WHERE onboarding.status = 'approved' AND onboarding.business_abn <> ''
  AND onboarding.agreement_reference <> '' AND onboarding.reviewed_by_uid <> ''
  AND date(onboarding.insurance_expires_on) >= date('now')
  AND EXISTS (SELECT 1 FROM trade_team_members owner
    WHERE owner.owner_uid = onboarding.owner_uid AND owner.member_uid = onboarding.owner_uid AND owner.status = 'active');

-- A latest revoked or expired completion never falls back to an older pass.
-- external_required=1 additionally requires the current, reviewer-verified
-- qualification evidence and the scheme authority reference on the review.
CREATE VIEW trade_training_current_completions AS
SELECT completion.owner_uid, completion.member_id, completion.module_id,
  completion.version, completion.content_hash, requirement.value external_required
FROM trade_training_completions completion
JOIN trade_training_module_reviews review ON review.module_id = completion.module_id
  AND review.version = completion.version AND review.content_hash = completion.content_hash
CROSS JOIN json_each('[0,1]') requirement
WHERE completion.revoked_at = '' AND datetime(completion.expires_at) > datetime('now')
  AND review.status = 'active' AND review.reviewed_by_uid <> ''
  AND date(review.source_reviewed_on) <= date('now') AND date(review.review_expires_on) >= date('now')
  AND NOT EXISTS (SELECT 1 FROM trade_training_completions newer
    WHERE newer.owner_uid = completion.owner_uid AND newer.member_id = completion.member_id
      AND newer.module_id = completion.module_id
      AND (newer.passed_at > completion.passed_at
        OR (newer.passed_at = completion.passed_at AND newer.rowid > completion.rowid)))
  AND (requirement.value = 0 OR (review.scheme_authority_reference <> '' AND EXISTS (
    SELECT 1 FROM trade_training_external_credentials credential
    JOIN trade_team_member_files evidence ON evidence.id = credential.document_id
      AND evidence.owner_uid = credential.owner_uid AND evidence.team_member_id = credential.member_id
      AND evidence.status = 'active'
    WHERE credential.owner_uid = completion.owner_uid AND credential.member_id = completion.member_id
      AND credential.module_id = completion.module_id AND credential.revoked_at = ''
      AND credential.reviewed_by_uid <> '' AND credential.credential_reference <> ''
      AND credential.scheme_participant_reference <> '' AND date(credential.expires_on) >= date('now')
      AND (evidence.expires_at = '' OR date(evidence.expires_at) >= date('now')))));

-- The owner and every active member declaring this business category must have
-- the same current reviewed pass. Removing a service checkbox removes its rows.
-- External installer credentials require at least one active qualified installer;
-- office owners/bookers still need the quiz but not an installer credential.
-- Job mutation guards independently verify the actual assigned installer.
CREATE VIEW trade_training_current_category_qualifications AS
SELECT owner_pass.owner_uid, capability.value category, owner_pass.module_id,
  owner_pass.version, owner_pass.content_hash, requirement.value external_required
FROM trade_training_current_completions owner_pass
JOIN trade_team_members owner ON owner.id = owner_pass.member_id
  AND owner.owner_uid = owner_pass.owner_uid AND owner.member_uid = owner_pass.owner_uid AND owner.status = 'active'
JOIN trade_accounts account ON account.firebase_uid = owner_pass.owner_uid
CROSS JOIN json_each(account.capabilities) capability
CROSS JOIN json_each('[0,1]') requirement
WHERE owner_pass.external_required = 0
  AND (requirement.value = 0 OR EXISTS (
    SELECT 1 FROM trade_training_current_completions installer_pass
    JOIN trade_team_members installer ON installer.id = installer_pass.member_id
      AND installer.owner_uid = installer_pass.owner_uid AND installer.status = 'active'
    WHERE (installer_pass.owner_uid, installer_pass.module_id, installer_pass.version,
      installer_pass.content_hash, installer_pass.external_required) =
      (owner_pass.owner_uid, owner_pass.module_id, owner_pass.version, owner_pass.content_hash, 1)
      AND (installer.member_uid = owner_pass.owner_uid OR EXISTS (
        SELECT 1 FROM json_each(installer.capabilities) installer_capability WHERE installer_capability.value = capability.value))))
  AND NOT EXISTS (SELECT 1 FROM trade_team_members member
  WHERE member.owner_uid = owner_pass.owner_uid AND member.status = 'active'
    AND (member.member_uid = owner_pass.owner_uid OR EXISTS (
      SELECT 1 FROM json_each(member.capabilities) member_capability WHERE member_capability.value = capability.value))
    AND NOT EXISTS (SELECT 1 FROM trade_training_current_completions member_pass
      WHERE (member_pass.owner_uid, member_pass.member_id, member_pass.module_id, member_pass.version,
        member_pass.content_hash, member_pass.external_required) =
        (owner_pass.owner_uid, member.id, owner_pass.module_id, owner_pass.version,
          owner_pass.content_hash, owner_pass.external_required)));
