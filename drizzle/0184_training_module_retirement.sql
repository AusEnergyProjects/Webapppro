-- Retirement removes a module from current learning requirements without
-- deleting its authored versions, attempts, completions or submission evidence.
-- Built-in modules may not have a questionnaire row, so this has no parent FK.
CREATE TABLE trade_training_module_retirements (
  module_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=0),
  course_json TEXT NOT NULL CHECK(json_valid(course_json) AND json_type(course_json)='object'),
  assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json) AND json_type(assignment_json)='object'),
  retired_by_uid TEXT NOT NULL CHECK(length(retired_by_uid)>0),
  retired_at TEXT NOT NULL CHECK(datetime(retired_at) IS NOT NULL)
);
CREATE TRIGGER training_module_retirements_no_update BEFORE UPDATE ON trade_training_module_retirements
BEGIN SELECT RAISE(ABORT,'Training retirement history is append-only'); END;
CREATE TRIGGER training_module_retirements_no_delete BEFORE DELETE ON trade_training_module_retirements
BEGIN SELECT RAISE(ABORT,'Training retirement history is append-only'); END;

DROP VIEW trade_training_additional_requirements;
CREATE VIEW trade_training_additional_requirements AS
SELECT published.module_id,published.version,published.content_hash,
  json_extract(published.assignment_json,'$.serviceCategory') category,jurisdiction.value jurisdiction
FROM trade_training_published_questionnaires published
CROSS JOIN json_each(published.assignment_json,'$.jurisdictions') jurisdiction
WHERE json_extract(published.assignment_json,'$.kind')='additional'
  AND NOT EXISTS(SELECT 1 FROM trade_training_module_retirements retired WHERE retired.module_id=published.module_id);
