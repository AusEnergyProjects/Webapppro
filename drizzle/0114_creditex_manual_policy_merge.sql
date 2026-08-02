CREATE TABLE compliance_manual_policy_bindings (
  id text PRIMARY KEY NOT NULL,
  organisation_id text NOT NULL,
  activity_template_id text NOT NULL,
  version integer NOT NULL,
  program_id text NOT NULL,
  activity_version_id text NOT NULL,
  evidence_policy_version_id text NOT NULL,
  program_source_binding_id text NOT NULL,
  activity_source_binding_id text NOT NULL,
  evidence_policy_source_binding_id text NOT NULL,
  binding_snapshot text NOT NULL,
  binding_snapshot_sha256 text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'draft',
  requested_by_uid text NOT NULL,
  requested_at text NOT NULL,
  approved_by_uid text NOT NULL DEFAULT '',
  approved_at text NOT NULL DEFAULT '',
  approval_note text NOT NULL DEFAULT '',
  withdrawn_by_uid text NOT NULL DEFAULT '',
  withdrawn_at text NOT NULL DEFAULT '',
  withdrawal_note text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT compliance_manual_policy_version_check
    CHECK (version > 0),
  CONSTRAINT compliance_manual_policy_identity_check
    CHECK (
      trim(id) <> ''
      AND trim(organisation_id) <> ''
      AND trim(activity_template_id) <> ''
      AND trim(program_id) <> ''
      AND trim(activity_version_id) <> ''
      AND trim(evidence_policy_version_id) <> ''
      AND trim(program_source_binding_id) <> ''
      AND trim(activity_source_binding_id) <> ''
      AND trim(evidence_policy_source_binding_id) <> ''
      AND trim(requested_by_uid) <> ''
    ),
  CONSTRAINT compliance_manual_policy_snapshot_check
    CHECK (
      json_valid(binding_snapshot)
      AND json_extract(binding_snapshot, '$.contract')
        = 'creditex-manual-policy-binding-v1'
      AND json_extract(binding_snapshot, '$.organisationId') = organisation_id
      AND json_extract(binding_snapshot, '$.activityTemplate.templateId')
        = activity_template_id
      AND json_extract(binding_snapshot, '$.program.id') = program_id
      AND json_extract(binding_snapshot, '$.activity.id') = activity_version_id
      AND json_extract(binding_snapshot, '$.evidencePolicy.id')
        = evidence_policy_version_id
      AND json_extract(
        binding_snapshot,
        '$.sourceApprovals.programBindingId'
      ) = program_source_binding_id
      AND json_extract(
        binding_snapshot,
        '$.sourceApprovals.activityBindingId'
      ) = activity_source_binding_id
      AND json_extract(
        binding_snapshot,
        '$.sourceApprovals.evidencePolicyBindingId'
      ) = evidence_policy_source_binding_id
      AND json_type(binding_snapshot, '$.requirements') = 'array'
      AND json_array_length(binding_snapshot, '$.requirements') > 0
      AND length(binding_snapshot_sha256) = 64
      AND lower(binding_snapshot_sha256) NOT GLOB '*[^0-9a-f]*'
      AND binding_snapshot_sha256 = lower(binding_snapshot_sha256)
    ),
  CONSTRAINT compliance_manual_policy_state_check
    CHECK (lifecycle_state IN ('draft', 'approved', 'withdrawn')),
  CONSTRAINT compliance_manual_policy_timestamps_check
    CHECK (
      datetime(requested_at) IS NOT NULL
      AND datetime(created_at) IS NOT NULL
      AND datetime(updated_at) IS NOT NULL
    ),
  CONSTRAINT compliance_manual_policy_lifecycle_check
    CHECK (
      (
        lifecycle_state = 'draft'
        AND approved_by_uid = ''
        AND approved_at = ''
        AND approval_note = ''
        AND withdrawn_by_uid = ''
        AND withdrawn_at = ''
        AND withdrawal_note = ''
      )
      OR (
        lifecycle_state = 'approved'
        AND trim(approved_by_uid) <> ''
        AND approved_by_uid <> requested_by_uid
        AND datetime(approved_at) IS NOT NULL
        AND length(trim(approval_note)) BETWEEN 10 AND 1000
        AND withdrawn_by_uid = ''
        AND withdrawn_at = ''
        AND withdrawal_note = ''
      )
      OR (
        lifecycle_state = 'withdrawn'
        AND trim(approved_by_uid) <> ''
        AND approved_by_uid <> requested_by_uid
        AND datetime(approved_at) IS NOT NULL
        AND length(trim(approval_note)) BETWEEN 10 AND 1000
        AND trim(withdrawn_by_uid) <> ''
        AND datetime(withdrawn_at) IS NOT NULL
        AND length(trim(withdrawal_note)) BETWEEN 10 AND 1000
      )
    )
);

CREATE UNIQUE INDEX compliance_manual_policy_template_version_idx
  ON compliance_manual_policy_bindings (
    organisation_id,
    activity_template_id,
    version
  );

CREATE UNIQUE INDEX compliance_manual_policy_current_template_idx
  ON compliance_manual_policy_bindings (
    organisation_id,
    activity_template_id
  )
  WHERE lifecycle_state IN ('draft', 'approved');

CREATE INDEX compliance_manual_policy_activity_idx
  ON compliance_manual_policy_bindings (
    organisation_id,
    activity_version_id,
    lifecycle_state
  );

CREATE INDEX compliance_manual_policy_evidence_policy_idx
  ON compliance_manual_policy_bindings (
    organisation_id,
    evidence_policy_version_id,
    lifecycle_state
  );

CREATE TABLE compliance_manual_policy_composition_locks (
  id text PRIMARY KEY NOT NULL,
  organisation_id text NOT NULL,
  binding_id text NOT NULL,
  binding_version integer NOT NULL,
  binding_snapshot_sha256 text NOT NULL,
  activity_template_id text NOT NULL,
  activity_version_id text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  reference_activity_date text NOT NULL,
  reference_updated_at text NOT NULL,
  reference_snapshot_sha256 text NOT NULL,
  revision integer NOT NULL,
  composition_snapshot text NOT NULL,
  composition_sha256 text NOT NULL,
  diff_snapshot text NOT NULL,
  diff_sha256 text NOT NULL,
  locked_by_uid text NOT NULL,
  locked_at text NOT NULL,
  superseded_by_id text NOT NULL DEFAULT '',
  superseded_at text NOT NULL DEFAULT '',
  CONSTRAINT compliance_manual_policy_composition_identity_check
    CHECK (
      trim(id) <> ''
      AND trim(organisation_id) <> ''
      AND trim(binding_id) <> ''
      AND binding_version > 0
      AND trim(activity_template_id) <> ''
      AND trim(activity_version_id) <> ''
      AND reference_type IN ('compliance_case', 'synthetic_pilot_job')
      AND trim(reference_id) <> ''
      AND revision > 0
      AND trim(locked_by_uid) <> ''
    ),
  CONSTRAINT compliance_manual_policy_composition_date_check
    CHECK (
      length(reference_activity_date) = 10
      AND reference_activity_date
        GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(reference_activity_date) = reference_activity_date
      AND datetime(reference_updated_at) IS NOT NULL
    ),
  CONSTRAINT compliance_manual_policy_composition_snapshot_check
    CHECK (
      json_valid(composition_snapshot)
      AND json_extract(composition_snapshot, '$.contract')
        = 'creditex-manual-evidence-form-v2'
      AND json_extract(composition_snapshot, '$.bindingId') = binding_id
      AND json_extract(composition_snapshot, '$.bindingVersion')
        = binding_version
      AND json_extract(
        composition_snapshot,
        '$.bindingSnapshotSha256'
      ) = binding_snapshot_sha256
      AND json_extract(
        composition_snapshot,
        '$.bindingSnapshot.activityTemplate.templateId'
      ) = activity_template_id
      AND json_extract(
        composition_snapshot,
        '$.bindingSnapshot.activity.id'
      ) = activity_version_id
      AND json_extract(
        composition_snapshot,
        '$.activityReference.referenceType'
      ) = reference_type
      AND json_extract(
        composition_snapshot,
        '$.activityReference.referenceId'
      ) = reference_id
      AND json_extract(
        composition_snapshot,
        '$.activityReference.activityDate'
      ) = reference_activity_date
      AND json_extract(
        composition_snapshot,
        '$.activityReference.referenceUpdatedAt'
      ) = reference_updated_at
      AND json_extract(
        composition_snapshot,
        '$.activityReference.referenceSnapshotSha256'
      ) = reference_snapshot_sha256
      AND json_valid(diff_snapshot)
      AND json_type(diff_snapshot) = 'array'
      AND length(binding_snapshot_sha256) = 64
      AND lower(binding_snapshot_sha256) NOT GLOB '*[^0-9a-f]*'
      AND binding_snapshot_sha256 = lower(binding_snapshot_sha256)
      AND length(reference_snapshot_sha256) = 64
      AND lower(reference_snapshot_sha256) NOT GLOB '*[^0-9a-f]*'
      AND reference_snapshot_sha256 = lower(reference_snapshot_sha256)
      AND length(composition_sha256) = 64
      AND lower(composition_sha256) NOT GLOB '*[^0-9a-f]*'
      AND composition_sha256 = lower(composition_sha256)
      AND length(diff_sha256) = 64
      AND lower(diff_sha256) NOT GLOB '*[^0-9a-f]*'
      AND diff_sha256 = lower(diff_sha256)
    ),
  CONSTRAINT compliance_manual_policy_composition_lifecycle_check
    CHECK (
      datetime(locked_at) IS NOT NULL
      AND (
        (superseded_by_id = '' AND superseded_at = '')
        OR (
          trim(superseded_by_id) <> ''
          AND superseded_by_id <> id
          AND datetime(superseded_at) IS NOT NULL
        )
      )
    )
);

CREATE UNIQUE INDEX compliance_manual_policy_composition_revision_idx
  ON compliance_manual_policy_composition_locks (
    organisation_id,
    reference_type,
    reference_id,
    revision
  );

CREATE UNIQUE INDEX compliance_manual_policy_composition_current_idx
  ON compliance_manual_policy_composition_locks (
    organisation_id,
    reference_type,
    reference_id
  )
  WHERE superseded_by_id = '';

CREATE INDEX compliance_manual_policy_composition_binding_idx
  ON compliance_manual_policy_composition_locks (
    organisation_id,
    binding_id,
    revision
  );
