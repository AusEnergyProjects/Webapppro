CREATE TABLE trade_activity_field_master_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  organisation_id TEXT NOT NULL,
  activity_template_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL CHECK (revision > 0),
  base_master_version INTEGER NOT NULL CHECK (base_master_version >= 0),
  base_form_sha256 TEXT NOT NULL CHECK (length(base_form_sha256) = 64),
  form_json TEXT NOT NULL CHECK (json_valid(form_json)),
  form_sha256 TEXT NOT NULL CHECK (length(form_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'discarded')),
  created_by_uid TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_master_id TEXT NOT NULL DEFAULT '',
  CHECK (COALESCE(json_extract(form_json, '$.activityTemplateId') = activity_template_id
    AND json_extract(form_json, '$.variantId') = variant_id, 0)),
  CHECK ((status = 'published' AND published_master_id <> '') OR (status <> 'published' AND published_master_id = ''))
);
CREATE INDEX trade_activity_master_drafts_org_status_idx
  ON trade_activity_field_master_drafts (organisation_id, status, updated_at);
