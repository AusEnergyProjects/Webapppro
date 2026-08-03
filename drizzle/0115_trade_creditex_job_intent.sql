CREATE TABLE trade_work_order_compliance_intents (
  id text PRIMARY KEY NOT NULL,
  work_order_id text NOT NULL,
  installer_uid text NOT NULL,
  compliance_organisation_id text NOT NULL DEFAULT '',
  program_template_id text NOT NULL,
  activity_template_id text NOT NULL,
  program_code text NOT NULL,
  registry_activity_code text NOT NULL DEFAULT '',
  service_category text NOT NULL,
  site_jurisdiction text NOT NULL,
  planned_start text NOT NULL DEFAULT '',
  catalogue_reviewed_on text NOT NULL,
  intent_snapshot text NOT NULL,
  intent_snapshot_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  compliance_case_id text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  created_by_uid text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT trade_compliance_intent_identity_check CHECK (
    trim(work_order_id) <> ''
    AND trim(installer_uid) <> ''
    AND trim(compliance_organisation_id) <> ''
    AND trim(program_template_id) <> ''
    AND trim(activity_template_id) <> ''
    AND trim(program_code) <> ''
    AND trim(service_category) <> ''
    AND site_jurisdiction IN ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
    AND revision > 0
  ),
  CONSTRAINT trade_compliance_intent_status_check CHECK (
    status IN ('planned', 'case_linked', 'superseded')
  ),
  CONSTRAINT trade_compliance_intent_case_check CHECK (
    (status = 'case_linked' AND trim(compliance_case_id) <> '')
    OR (status <> 'case_linked' AND compliance_case_id = '')
  ),
  CONSTRAINT trade_compliance_intent_snapshot_check CHECK (
    json_valid(intent_snapshot)
    AND json_extract(intent_snapshot, '$.contract') = 'tlink-creditex-job-intent-v1'
    AND json_extract(intent_snapshot, '$.program.templateId') = program_template_id
    AND json_extract(intent_snapshot, '$.activity.templateId') = activity_template_id
    AND json_extract(intent_snapshot, '$.program.programCode') = program_code
    AND json_extract(intent_snapshot, '$.activity.serviceCategory') = service_category
    AND json_extract(intent_snapshot, '$.siteJurisdiction') = site_jurisdiction
    AND json_extract(intent_snapshot, '$.catalogueReviewedOn') = catalogue_reviewed_on
    AND length(intent_snapshot_sha256) = 64
    AND lower(intent_snapshot_sha256) NOT GLOB '*[^0-9a-f]*'
    AND intent_snapshot_sha256 = lower(intent_snapshot_sha256)
  ),
  CONSTRAINT trade_compliance_intent_time_check CHECK (
    datetime(created_at) IS NOT NULL
    AND datetime(updated_at) IS NOT NULL
  )
);

CREATE UNIQUE INDEX trade_compliance_intent_work_revision_idx
  ON trade_work_order_compliance_intents (work_order_id, revision);

CREATE UNIQUE INDEX trade_compliance_intent_active_work_idx
  ON trade_work_order_compliance_intents (work_order_id)
  WHERE status = 'planned';

CREATE UNIQUE INDEX trade_compliance_intent_case_idx
  ON trade_work_order_compliance_intents (compliance_case_id)
  WHERE compliance_case_id <> '';

CREATE INDEX trade_compliance_intent_installer_status_idx
  ON trade_work_order_compliance_intents (
    installer_uid,
    status,
    updated_at
  );

CREATE INDEX trade_compliance_intent_creditex_queue_idx
  ON trade_work_order_compliance_intents (
    compliance_organisation_id,
    status,
    planned_start,
    updated_at
  );
