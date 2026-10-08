/** Completion does not require invented travel, arrival or work-start events. */
export function fieldTransitionExpectedStatus(action: string, currentStatus: string, usualFrom: string) {
  return action === "finish" && ["scheduled", "en_route", "arrived", "in_progress"].includes(currentStatus)
    ? currentStatus : usualFrom;
}

/** Explicit completion may close an issued rental or form-less job without changing an ended appointment. */
export function fieldFinishWithoutActiveAppointment(jobStage: string, appointmentStatus: string, hasIssuedRental: boolean,
  hasNoRequiredForms = false) {
  return (hasIssuedRental || hasNoRequiredForms)
    && Boolean(jobStage) && !["completed", "cancelled"].includes(jobStage)
    && ["", "cancelled", "completed", "no_show"].includes(appointmentStatus);
}

/** Saved form-bearing work must use its existing completion pathway. Recheck this guard atomically. */
export function formlessFieldJobGuard(ownerUid: string, workOrderId: string) {
  const scope = [workOrderId, ownerUid];
  return {
    sql: `NOT EXISTS (SELECT 1 FROM trade_job_forms form WHERE form.work_order_id = ? AND form.firebase_uid = ?)
      AND NOT EXISTS (SELECT 1 FROM trade_veu_electrical_assessments assessment WHERE assessment.work_order_id = ? AND assessment.owner_uid = ?)
      AND NOT EXISTS (SELECT 1 FROM trade_rental_inspections rental WHERE rental.work_order_id = ? AND rental.firebase_uid = ?)
      AND NOT EXISTS (SELECT 1 FROM trade_activity_field_records record WHERE record.work_order_id = ? AND record.owner_uid = ?)
      AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances pack
        JOIN compliance_cases pack_case ON pack_case.id = pack.compliance_case_id AND pack_case.organisation_id = pack.organisation_id
          AND pack_case.work_order_id = pack.work_order_id
        WHERE pack.work_order_id = ? AND pack_case.installer_uid = ?)
      AND NOT EXISTS (SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.work_order_id = ? AND intent.installer_uid = ?
        AND intent.status IN ('planned', 'case_linked'))
      AND NOT EXISTS (SELECT 1 FROM compliance_cases active_case WHERE active_case.work_order_id = ? AND active_case.installer_uid = ?
        AND active_case.status NOT IN ('rejected', 'closed'))`,
    values: [...scope, ...scope, ...scope, ...scope, ...scope, ...scope, ...scope],
  };
}
