-- Preserve original onboarding evidence while adding the signed agreement kind.
CREATE TABLE creditex_onboarding_documents_next (
  id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('insurance','contractor_licence','director_id','director_selfie','guarantor_id','guarantor_selfie','prior_proposal','partnership_agreement')),
  file_name TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 12582912),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64), object_key TEXT NOT NULL UNIQUE,
  uploaded_by_uid TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO creditex_onboarding_documents_next SELECT * FROM creditex_onboarding_documents;
DROP TABLE creditex_onboarding_documents;
ALTER TABLE creditex_onboarding_documents_next RENAME TO creditex_onboarding_documents;
CREATE INDEX creditex_onboarding_documents_owner_idx ON creditex_onboarding_documents(owner_uid,created_at);

-- A completion receipt records a validated intake and supplied signed document.
-- It does not claim government accreditation, identity-provider verification or
-- electronic execution of an agreement. Old receipts remain immutable history.
CREATE TABLE creditex_onboarding_completions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
  revision INTEGER NOT NULL CHECK(revision>0),
  business_abn TEXT NOT NULL CHECK(length(business_abn)>0),
  business_name TEXT NOT NULL CHECK(length(business_name)>0),
  agreement_document_id TEXT NOT NULL CHECK(length(agreement_document_id)>0),
  agreement_sha256 TEXT NOT NULL CHECK(length(agreement_sha256)=64 AND agreement_sha256 NOT GLOB '*[^0-9a-f]*'),
  actor_uid TEXT NOT NULL CHECK(length(actor_uid)>0),
  reference TEXT NOT NULL UNIQUE CHECK(length(reference)>0),
  completed_at TEXT NOT NULL CHECK(datetime(completed_at) IS NOT NULL),
  UNIQUE(owner_uid,revision)
);
CREATE TRIGGER creditex_onboarding_completions_no_update BEFORE UPDATE ON creditex_onboarding_completions
BEGIN SELECT RAISE(ABORT,'Onboarding completion receipts are append-only'); END;
CREATE TRIGGER creditex_onboarding_completions_no_delete BEFORE DELETE ON creditex_onboarding_completions
BEGIN SELECT RAISE(ABORT,'Onboarding completion receipts are append-only'); END;

DROP VIEW creditex_current_business_approvals;
CREATE VIEW creditex_current_business_approvals AS
SELECT onboarding.owner_uid
FROM creditex_business_onboarding onboarding
JOIN trade_accounts account ON account.firebase_uid=onboarding.owner_uid
  AND account.abn=onboarding.business_abn AND account.business_name=onboarding.business_name
WHERE onboarding.business_abn<>'' AND date(onboarding.insurance_expires_on)>=date('now')
  -- Intake can finish before the owner's team profile is created. Booking and
  -- lead qualification independently require an active owner and current passes.
  AND (
    (onboarding.status='approved' AND onboarding.agreement_reference<>'' AND onboarding.reviewed_by_uid<>'')
    OR (
      onboarding.status='submitted'
      AND json_extract(onboarding.application_json,'$.acceptedCompliance')=1
      AND json_extract(onboarding.application_json,'$.acceptedPrivacy')=1
      AND EXISTS(SELECT 1 FROM creditex_onboarding_completions receipt
        JOIN creditex_onboarding_documents agreement ON agreement.id=receipt.agreement_document_id
          AND agreement.owner_uid=receipt.owner_uid AND agreement.kind='partnership_agreement'
          AND agreement.sha256=receipt.agreement_sha256
        WHERE receipt.owner_uid=onboarding.owner_uid AND receipt.revision=onboarding.revision
          AND receipt.business_abn=onboarding.business_abn AND receipt.business_name=onboarding.business_name
          AND agreement.id=json_extract(onboarding.application_json,'$.agreementDocumentId'))
      AND EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
        AND document.kind='insurance' AND document.id=json_extract(onboarding.application_json,'$.insuranceDocumentId'))
      AND EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
        AND document.kind='director_id' AND document.id=json_extract(onboarding.application_json,'$.director.idDocumentId'))
      AND EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
        AND document.kind='director_selfie' AND document.id=json_extract(onboarding.application_json,'$.director.selfieDocumentId'))
      AND (json_extract(onboarding.application_json,'$.directorIsGuarantor')=1 OR (
        EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
          AND document.kind='guarantor_id' AND document.id=json_extract(onboarding.application_json,'$.guarantor.idDocumentId'))
        AND EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
          AND document.kind='guarantor_selfie' AND document.id=json_extract(onboarding.application_json,'$.guarantor.selfieDocumentId'))
      ))
      AND (
        (json_extract(onboarding.application_json,'$.doesNswWork')=0
          AND NOT EXISTS(SELECT 1 FROM json_each(account.service_states) WHERE upper(trim(value))='NSW')
          AND (EXISTS(SELECT 1 FROM json_each(account.service_states) WHERE upper(trim(value)) IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')) OR upper(trim(account.address_state))<>'NSW'))
        OR EXISTS(SELECT 1 FROM creditex_onboarding_documents document WHERE document.owner_uid=onboarding.owner_uid
          AND document.kind='contractor_licence' AND document.id=json_extract(onboarding.application_json,'$.contractorLicenceDocumentId'))
      )
    )
  );
