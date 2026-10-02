-- Expand previously implied actions once; explicit new grants remain independently revocable.
-- A JSON rule set keeps the update within D1's compound SELECT limit.
UPDATE compliance_users
SET permissions_json = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(compliance_users.permissions_json)
    UNION
    SELECT json_extract(rule.value, '$.grant') FROM json_each('[
      {"source":"jobs","grant":"jobs_assign","roles":["admin","case_manager","reviewer","auditor"],"also":"submissions"},
      {"source":"audit","grant":"corrections","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"audit","grant":"job_lifecycle","roles":["admin","case_manager"]},
      {"source":"audit","grant":"payouts","roles":["admin"]},
      {"source":"customers","grant":"customer_calls","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"messages","grant":"messages_send","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_create","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_assign","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_edit","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_complete","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_team","roles":["admin"]},
      {"source":"forms","grant":"forms_publish","roles":["admin","case_manager","reviewer"]},
      {"source":"submissions","grant":"submissions_manage","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"governance","grant":"governance_manage","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"team_access","grant":"team_details","roles":["admin"]},
      {"source":"team_access","grant":"voice_setup","roles":["admin"]}
    ]') rule
    WHERE compliance_users.role IN (SELECT value FROM json_each(rule.value, '$.roles'))
      AND EXISTS (SELECT 1 FROM json_each(compliance_users.permissions_json) old_grant WHERE old_grant.value=json_extract(rule.value, '$.source'))
      AND (json_extract(rule.value, '$.also') IS NULL OR EXISTS (
        SELECT 1 FROM json_each(compliance_users.permissions_json) old_grant WHERE old_grant.value=json_extract(rule.value, '$.also')))
  )
)
WHERE permissions_json IS NOT NULL AND json_valid(permissions_json) AND json_type(permissions_json)='array'
  AND NOT EXISTS (SELECT 1 FROM json_each(permissions_json) WHERE type<>'text' OR value NOT IN ('jobs','audit','customers','messages','tasks','calculator','forms','submissions','governance','team_access'));

UPDATE compliance_invitations
SET permissions_json = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(compliance_invitations.permissions_json)
    UNION
    SELECT json_extract(rule.value, '$.grant') FROM json_each('[
      {"source":"jobs","grant":"jobs_assign","roles":["admin","case_manager","reviewer","auditor"],"also":"submissions"},
      {"source":"audit","grant":"corrections","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"audit","grant":"job_lifecycle","roles":["admin","case_manager"]},
      {"source":"audit","grant":"payouts","roles":["admin"]},
      {"source":"customers","grant":"customer_calls","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"messages","grant":"messages_send","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_create","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_assign","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_edit","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_complete","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"tasks","grant":"tasks_team","roles":["admin"]},
      {"source":"forms","grant":"forms_publish","roles":["admin","case_manager","reviewer"]},
      {"source":"submissions","grant":"submissions_manage","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"governance","grant":"governance_manage","roles":["admin","case_manager","reviewer","auditor"]},
      {"source":"team_access","grant":"team_details","roles":["admin"]},
      {"source":"team_access","grant":"voice_setup","roles":["admin"]}
    ]') rule
    WHERE compliance_invitations.role IN (SELECT value FROM json_each(rule.value, '$.roles'))
      AND EXISTS (SELECT 1 FROM json_each(compliance_invitations.permissions_json) old_grant WHERE old_grant.value=json_extract(rule.value, '$.source'))
      AND (json_extract(rule.value, '$.also') IS NULL OR EXISTS (
        SELECT 1 FROM json_each(compliance_invitations.permissions_json) old_grant WHERE old_grant.value=json_extract(rule.value, '$.also')))
  )
)
WHERE permissions_json IS NOT NULL AND json_valid(permissions_json) AND json_type(permissions_json)='array'
  AND NOT EXISTS (SELECT 1 FROM json_each(permissions_json) WHERE type<>'text' OR value NOT IN ('jobs','audit','customers','messages','tasks','calculator','forms','submissions','governance','team_access'));
