-- Editable drafts are separate from immutable published versions and learner records.
CREATE TABLE trade_training_questionnaires (
  module_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json) AND json_type(draft_json)='object'),
  assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json) AND json_type(assignment_json)='object'),
  published_version TEXT NOT NULL DEFAULT '',
  published_revision INTEGER NOT NULL DEFAULT 0 CHECK(published_revision BETWEEN 0 AND revision),
  published_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL),
  updated_by_uid TEXT NOT NULL CHECK(length(updated_by_uid)>0)
);
CREATE TABLE trade_training_questionnaire_versions (
  module_id TEXT NOT NULL REFERENCES trade_training_questionnaires(module_id), version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  course_json TEXT NOT NULL CHECK(json_valid(course_json) AND json_type(course_json)='object'),
  assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json) AND json_type(assignment_json)='object'),
  published_by_uid TEXT NOT NULL CHECK(length(published_by_uid)>0),
  published_at TEXT NOT NULL CHECK(datetime(published_at) IS NOT NULL),
  PRIMARY KEY(module_id,version)
);
CREATE TRIGGER training_questionnaire_versions_no_update BEFORE UPDATE ON trade_training_questionnaire_versions
BEGIN SELECT RAISE(ABORT,'Published training forms are append-only'); END;
CREATE TRIGGER training_questionnaire_versions_no_delete BEFORE DELETE ON trade_training_questionnaire_versions
BEGIN SELECT RAISE(ABORT,'Published training forms are append-only'); END;
-- Recomputed publication projections keep lead and booking predicates bounded.
-- Draft changes never replace the pointer to the last immutable published form.
CREATE VIEW trade_training_published_questionnaires AS
SELECT published.module_id,published.version,published.content_hash,published.course_json,published.assignment_json,1 source_complete
FROM trade_training_questionnaires edited JOIN trade_training_questionnaire_versions published
  ON (published.module_id,published.version)=(edited.module_id,edited.published_version);
CREATE VIEW trade_training_additional_requirements AS
SELECT published.module_id,published.version,published.content_hash,
  json_extract(published.assignment_json,'$.serviceCategory') category,jurisdiction.value jurisdiction
FROM trade_training_published_questionnaires published
CROSS JOIN json_each(published.assignment_json,'$.jurisdictions') jurisdiction
WHERE json_extract(published.assignment_json,'$.kind')='additional';
CREATE VIEW trade_training_current_scoped_category_qualifications AS
SELECT qualified.owner_uid,qualified.category,qualified.module_id,qualified.version,qualified.content_hash,qualified.external_required,served.state
FROM trade_training_current_category_qualifications qualified
JOIN trade_training_served_jurisdictions served ON served.owner_uid=qualified.owner_uid
WHERE NOT EXISTS(SELECT 1 FROM trade_training_additional_requirements additional
  WHERE additional.category=qualified.category AND additional.jurisdiction IN ('AU',served.state)
    AND NOT EXISTS(SELECT 1 FROM trade_training_current_category_qualifications extra_pass
      WHERE (extra_pass.owner_uid,extra_pass.category,extra_pass.module_id,extra_pass.version,extra_pass.content_hash,extra_pass.external_required)=
        (qualified.owner_uid,qualified.category,additional.module_id,additional.version,additional.content_hash,0)));
CREATE TABLE trade_training_questionnaire_events (
  id TEXT PRIMARY KEY NOT NULL,module_id TEXT NOT NULL,actor_uid TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('draft_saved','published')),
  revision INTEGER NOT NULL CHECK(revision>0),metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL CHECK(datetime(created_at) IS NOT NULL)
);
CREATE INDEX trade_training_questionnaire_events_module_idx ON trade_training_questionnaire_events(module_id,created_at);
CREATE TRIGGER training_questionnaire_events_no_update BEFORE UPDATE ON trade_training_questionnaire_events
BEGIN SELECT RAISE(ABORT,'Training authoring history is append-only'); END;
CREATE TRIGGER training_questionnaire_events_no_delete BEFORE DELETE ON trade_training_questionnaire_events
BEGIN SELECT RAISE(ABORT,'Training authoring history is append-only'); END;

ALTER TABLE trade_training_attempts ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(progress_json) AND json_type(progress_json)='object');
ALTER TABLE trade_training_attempts ADD COLUMN course_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(course_json) AND json_type(course_json)='object');
CREATE TABLE trade_training_submissions (
  id TEXT PRIMARY KEY NOT NULL, attempt_id TEXT NOT NULL UNIQUE REFERENCES trade_training_attempts(id),
  owner_uid TEXT NOT NULL,member_id TEXT NOT NULL,actor_uid TEXT NOT NULL,
  module_id TEXT NOT NULL,version TEXT NOT NULL,content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  score_percent INTEGER NOT NULL CHECK(score_percent BETWEEN 0 AND 100),
  first_try_score_percent INTEGER NOT NULL CHECK(first_try_score_percent BETWEEN 0 AND 100),
  reference TEXT NOT NULL,completed_at TEXT NOT NULL CHECK(datetime(completed_at) IS NOT NULL),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json) AND json_type(result_json)='object')
);
CREATE INDEX trade_training_submissions_person_idx ON trade_training_submissions(owner_uid,member_id,completed_at);
CREATE INDEX trade_training_submissions_module_idx ON trade_training_submissions(module_id,completed_at);
CREATE TRIGGER training_submissions_identity_check BEFORE INSERT ON trade_training_submissions
WHEN NOT EXISTS(SELECT 1 FROM trade_training_attempts attempt WHERE attempt.id=NEW.attempt_id
  AND (attempt.owner_uid,attempt.member_id,attempt.actor_uid,attempt.module_id,attempt.version,attempt.content_hash)=
    (NEW.owner_uid,NEW.member_id,NEW.actor_uid,NEW.module_id,NEW.version,NEW.content_hash)
  AND attempt.status IN ('passed','failed') AND attempt.score_percent=NEW.score_percent)
BEGIN SELECT RAISE(ABORT,'Training submission must match its completed personal attempt'); END;
CREATE TRIGGER training_submissions_no_update BEFORE UPDATE ON trade_training_submissions
BEGIN SELECT RAISE(ABORT,'Submitted training forms are append-only'); END;
CREATE TRIGGER training_submissions_no_delete BEFORE DELETE ON trade_training_submissions
BEGIN SELECT RAISE(ABORT,'Submitted training forms are append-only'); END;

-- New variable-length forms must match the exact saved course; old attempts
-- retain their original 25-question requirement and can never become a short quiz.
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
  AND ((json_type(attempt.course_json,'$.questions')='array'
      AND json_array_length(attempt.course_json,'$.questions') BETWEEN 1 AND 60
      AND json_array_length(attempt.assessment_json)=json_array_length(attempt.course_json,'$.questions'))
    OR (attempt.course_json='{}' AND json_array_length(attempt.assessment_json)=25))
  AND NOT EXISTS (SELECT 1 FROM trade_training_module_reviews withdrawal
    WHERE withdrawal.module_id = completion.module_id AND withdrawal.status = 'withdrawn')
  AND NOT EXISTS (SELECT 1 FROM trade_training_completions newer
    WHERE newer.owner_uid = completion.owner_uid AND newer.member_id = completion.member_id
      AND newer.module_id = completion.module_id
      AND (newer.passed_at > completion.passed_at
        OR (newer.passed_at = completion.passed_at AND newer.rowid > completion.rowid)))
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
