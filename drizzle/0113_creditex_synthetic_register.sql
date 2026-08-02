CREATE INDEX `compliance_manual_evidence_test_job_register_program_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `program_code`, `status`, `updated_at`, `id`);

CREATE INDEX `compliance_manual_evidence_test_job_register_activity_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `activity_template_id`, `status`, `updated_at`, `id`);

CREATE INDEX `compliance_manual_evidence_test_job_register_personnel_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `installer_id`, `technician_id`, `updated_at`, `id`);

CREATE INDEX `compliance_manual_evidence_test_job_register_postcode_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `site_postcode`, `updated_at`, `id`);

CREATE INDEX `compliance_manual_evidence_test_job_register_created_idx`
  ON `compliance_manual_evidence_test_jobs`
    (`organisation_id`, `created_at`, `id`);

CREATE INDEX `compliance_pilot_jobs_register_review_idx`
  ON `compliance_pilot_jobs`
    (`pilot_run_id`, `review_status`, `updated_at`, `id`);

CREATE INDEX `trade_crm_appointments_register_latest_idx`
  ON `trade_crm_appointments`
    (`work_order_id`, `firebase_uid`, `starts_at`, `id`);
