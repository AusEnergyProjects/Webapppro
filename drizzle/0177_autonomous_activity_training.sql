-- Course availability comes from the current deployed source-backed curriculum.
-- No curriculum approval row is required. Runtime predicates supply exact course
-- versions and hashes, and explicit safety withdrawals still apply immediately.
-- Declared service states are authoritative. Only legacy accounts with no valid
-- declared state fall back to their business address. This live projection is
-- shared by learning, booking, lead allocation and lead disclosure.
DROP VIEW IF EXISTS trade_training_served_jurisdictions;
CREATE VIEW trade_training_served_jurisdictions AS
SELECT account.firebase_uid owner_uid, upper(trim(served_state.value)) state
FROM trade_accounts account CROSS JOIN json_each(account.service_states) served_state
WHERE upper(trim(served_state.value)) IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')
UNION
SELECT account.firebase_uid owner_uid, upper(trim(account.address_state)) state
FROM trade_accounts account
WHERE upper(trim(account.address_state)) IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')
  AND NOT EXISTS (SELECT 1 FROM json_each(account.service_states) served_state
    WHERE upper(trim(served_state.value)) IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA'));

DROP VIEW IF EXISTS creditex_current_business_jurisdictions;
CREATE VIEW creditex_current_business_jurisdictions AS
SELECT business.owner_uid, jurisdiction.state
FROM creditex_current_business_approvals business
JOIN trade_training_served_jurisdictions jurisdiction ON jurisdiction.owner_uid = business.owner_uid
WHERE EXISTS (SELECT 1 FROM trade_team_members owner_member
  WHERE owner_member.owner_uid = business.owner_uid
    AND owner_member.member_uid = business.owner_uid AND owner_member.status = 'active');

-- Replace only the live completion projection; the category qualification view
-- continues to re-evaluate this view without storing or caching eligibility.
DROP VIEW trade_training_current_completions;
CREATE VIEW trade_training_current_completions AS
SELECT completion.owner_uid, completion.member_id, completion.module_id,
  completion.version, completion.content_hash, requirement.value external_required
FROM trade_training_completions completion
JOIN trade_training_attempts attempt ON attempt.id = completion.attempt_id
  AND (attempt.owner_uid, attempt.member_id, attempt.module_id, attempt.version, attempt.content_hash) =
    (completion.owner_uid, completion.member_id, completion.module_id, completion.version, completion.content_hash)
CROSS JOIN json_each('[0,1]') requirement
WHERE completion.revoked_at = '' AND datetime(completion.expires_at) > datetime('now')
  AND attempt.status = 'passed' AND attempt.score_percent = 100 AND attempt.critical_passed = 1
  AND json_array_length(attempt.assessment_json) = 25
  AND NOT EXISTS (SELECT 1 FROM trade_training_module_reviews withdrawal
    WHERE withdrawal.module_id = completion.module_id AND withdrawal.status = 'withdrawn')
  AND NOT EXISTS (SELECT 1 FROM trade_training_completions newer
    WHERE newer.owner_uid = completion.owner_uid AND newer.member_id = completion.member_id
      AND newer.module_id = completion.module_id
      AND (newer.passed_at > completion.passed_at
        OR (newer.passed_at = completion.passed_at AND newer.rowid > completion.rowid)))
  -- Activity 48 still needs separate verified scheme authority and installer
  -- credentials. These are legal eligibility records, not course activation.
  AND (requirement.value = 0 OR (
    EXISTS (SELECT 1 FROM trade_training_module_reviews authority
      WHERE authority.module_id = completion.module_id AND authority.status = 'active'
        AND authority.scheme_authority_reference <> '' AND authority.reviewed_by_uid <> ''
        AND date(authority.source_reviewed_on) <= date('now')
        AND date(authority.review_expires_on) >= date('now'))
    AND EXISTS (
      SELECT 1 FROM trade_training_external_credentials credential
      JOIN trade_team_member_files evidence ON evidence.id = credential.document_id
        AND evidence.owner_uid = credential.owner_uid AND evidence.team_member_id = credential.member_id
        AND evidence.status = 'active'
      WHERE credential.owner_uid = completion.owner_uid AND credential.member_id = completion.member_id
        AND credential.module_id = completion.module_id AND credential.revoked_at = ''
        AND credential.reviewed_by_uid <> '' AND credential.credential_reference <> ''
        AND credential.scheme_participant_reference <> '' AND date(credential.expires_on) >= date('now')
        AND (evidence.expires_at = '' OR date(evidence.expires_at) >= date('now')))));
