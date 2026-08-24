type RentalAppointmentSnapshot = {
  id: string;
  startsAt: string;
  endsAt: string;
};

export type RentalInspectionAssignmentInput = {
  actorType: "owner" | "assessor";
  actorUid: string;
  appointment?: RentalAppointmentSnapshot;
  assigneeLabel: string;
  assigneeMemberId: string;
  changedAt: string;
  jobRevision: number;
  ownerUid: string;
  previousAssigneeMemberId: string;
  workOrderId: string;
};

function appointmentMutation(input: RentalInspectionAssignmentInput) {
  const fields = [
    "'$.appointment.assessorMemberId', ?",
    "'$.appointment.assessorLabel', ?",
  ];
  const values: unknown[] = [input.assigneeMemberId, input.assigneeLabel];
  const checks = [
    "COALESCE(json_extract(synced.property_snapshot, '$.appointment.assessorMemberId'), '') = ?",
    "COALESCE(json_extract(synced.property_snapshot, '$.appointment.assessorLabel'), '') = ?",
  ];
  const checkValues: unknown[] = [input.assigneeMemberId, input.assigneeLabel];

  for (const [key, value] of input.appointment
    ? [
      ["id", input.appointment.id],
      ["startsAt", input.appointment.startsAt],
      ["endsAt", input.appointment.endsAt],
    ] as const
    : []) {
    fields.push(`'$.appointment.${key}', ?`);
    values.push(value);
    checks.push(`COALESCE(json_extract(synced.property_snapshot, '$.appointment.${key}'), '') = ?`);
    checkValues.push(value);
  }

  return {
    sql: `json_set(property_snapshot, ${fields.join(", ")})`,
    values,
    checkSql: checks.join(" AND "),
    checkValues,
  };
}

function appointmentContract(input: RentalInspectionAssignmentInput) {
  if (!input.appointment) return { sql: "", values: [] as unknown[] };
  return {
    sql: `AND EXISTS (
      SELECT 1 FROM trade_crm_appointments authoritative_appointment
      WHERE authoritative_appointment.id = ?
        AND authoritative_appointment.work_order_id = ?
        AND authoritative_appointment.firebase_uid = ?
        AND authoritative_appointment.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
        AND authoritative_appointment.starts_at = ?
        AND authoritative_appointment.ends_at = ?
        AND authoritative_appointment.assignee_member_id = ?
        AND authoritative_appointment.assignee_label = ?
        AND NOT EXISTS (
          SELECT 1 FROM trade_crm_appointments other_active_appointment
          WHERE other_active_appointment.work_order_id = authoritative_appointment.work_order_id
            AND other_active_appointment.firebase_uid = authoritative_appointment.firebase_uid
            AND other_active_appointment.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
            AND other_active_appointment.id <> authoritative_appointment.id
        )
    )`,
    values: [
      input.appointment.id,
      input.workOrderId,
      input.ownerUid,
      input.appointment.startsAt,
      input.appointment.endsAt,
      input.assigneeMemberId,
      input.assigneeLabel,
    ] as unknown[],
  };
}

export function rentalInspectionAssignmentStatements(
  db: D1Database,
  input: RentalInspectionAssignmentInput,
) {
  const assignmentChanged = input.previousAssigneeMemberId !== input.assigneeMemberId;
  const appointment = appointmentMutation(input);
  const authoritativeAppointment = appointmentContract(input);
  const hasAppointment = input.appointment !== undefined;
  const memberUidSql = `CASE WHEN ? = '' THEN '' ELSE COALESCE((
    SELECT member_uid FROM trade_team_members selected_member
    WHERE selected_member.id = ? AND selected_member.owner_uid = ?
      AND selected_member.status = 'active'
  ), '') END`;
  const eventType = hasAppointment
    ? "assessment_schedule_synchronised"
    : "assessor_assignment_synchronised";
  const eventSummary = hasAppointment
    ? "Rental assessment appointment and assessor details synchronised."
    : input.assigneeMemberId
      ? `Rental assessment assignment synchronised to ${input.assigneeLabel}.`
      : "Rental assessment assignment cleared.";
  const eventMetadata = JSON.stringify({
    appointment: input.appointment || null,
    assigneeLabel: input.assigneeLabel,
    assigneeMemberId: input.assigneeMemberId,
    previousAssigneeMemberId: input.previousAssigneeMemberId,
    jobAssignmentChanged: assignmentChanged,
    declarationRevalidationChecked: true,
  });

  return [
    db.prepare(`UPDATE trade_rental_inspection_modules
      SET status = CASE WHEN status = 'complete' THEN 'draft' ELSE status END,
        credential_snapshot = '{}', completed_by_uid = '', completed_at = '',
        revision = revision + 1, updated_at = ?
      WHERE firebase_uid = ? AND status <> 'superseded'
        AND EXISTS (
          SELECT 1 FROM trade_rental_inspections inspection
          WHERE inspection.id = trade_rental_inspection_modules.inspection_id
            AND inspection.work_order_id = ? AND inspection.firebase_uid = ?
            AND inspection.status NOT IN ('issuing', 'issued', 'superseded', 'withdrawn')
            AND (
              COALESCE(inspection.assessor_member_id, '') <> ?
              OR (
                trade_rental_inspection_modules.credential_snapshot <> '{}'
                AND COALESCE(json_extract(
                  trade_rental_inspection_modules.credential_snapshot,
                  '$.assessorMemberId'
                ), '') <> ?
              )
            )
        )`)
      .bind(
        input.changedAt,
        input.ownerUid,
        input.workOrderId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeMemberId,
      ),
    db.prepare(`UPDATE trade_rental_inspections
      SET status = CASE
          WHEN COALESCE(assessor_member_id, '') <> ? AND status = 'submitted' THEN 'in_progress'
          WHEN ? = 1 AND status = 'draft' THEN 'scheduled'
          ELSE status
        END,
        assessor_uid = ${memberUidSql},
        assessor_member_id = ?,
        assessor_snapshot = json_object(
          'memberId', ?,
          'uid', ${memberUidSql},
          'displayName', ?
        ),
        property_snapshot = ${appointment.sql},
        submitted_at = CASE WHEN COALESCE(assessor_member_id, '') <> ? THEN '' ELSE submitted_at END,
        revision = revision + 1,
        updated_at = ?
      WHERE work_order_id = ? AND firebase_uid = ?
        AND status NOT IN ('issuing', 'issued', 'superseded', 'withdrawn')
        AND EXISTS (
          SELECT 1 FROM trade_work_orders assigned_job
          WHERE assigned_job.id = trade_rental_inspections.work_order_id
            AND assigned_job.firebase_uid = trade_rental_inspections.firebase_uid
            AND assigned_job.assignee_member_id = ?
            AND assigned_job.assignee_label = ?
            AND assigned_job.revision = ?
            AND assigned_job.updated_at = ?
        )
        AND (? = '' OR EXISTS (
          SELECT 1 FROM trade_team_members active_assessor
          WHERE active_assessor.id = ? AND active_assessor.owner_uid = ?
            AND active_assessor.status = 'active' AND active_assessor.member_uid <> ''
        ))
        ${authoritativeAppointment.sql}`)
      .bind(
        input.assigneeMemberId,
        hasAppointment ? 1 : 0,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.ownerUid,
        input.assigneeLabel,
        ...appointment.values,
        input.assigneeMemberId,
        input.changedAt,
        input.workOrderId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeLabel,
        input.jobRevision,
        input.changedAt,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.ownerUid,
        ...authoritativeAppointment.values,
      ),
    db.prepare(`INSERT INTO trade_rental_inspection_events
      (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid,
       event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
      SELECT ?, inspection.id, '', '', inspection.firebase_uid, ?, ?, ?, '', ?, ?, '', '', ?
      FROM trade_rental_inspections inspection
      WHERE inspection.work_order_id = ? AND inspection.firebase_uid = ?
        AND inspection.assessor_member_id = ? AND inspection.updated_at = ?
        AND inspection.status NOT IN ('issuing', 'issued', 'superseded', 'withdrawn')`)
      .bind(
        crypto.randomUUID(),
        input.actorType,
        input.actorUid,
        eventType,
        eventSummary,
        eventMetadata,
        input.changedAt,
        input.workOrderId,
        input.ownerUid,
        input.assigneeMemberId,
        input.changedAt,
      ),
    db.prepare(`INSERT INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, ?, ?, 'rental_assignment_guard', NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM trade_rental_inspections attached
        WHERE attached.work_order_id = ? AND attached.firebase_uid = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM trade_rental_inspections synced
        WHERE synced.work_order_id = ? AND synced.firebase_uid = ?
          AND synced.status NOT IN ('issuing', 'issued', 'superseded', 'withdrawn')
          AND synced.assessor_member_id = ?
          AND synced.assessor_uid = ${memberUidSql}
          AND COALESCE(json_extract(synced.assessor_snapshot, '$.memberId'), '') = ?
          AND COALESCE(json_extract(synced.assessor_snapshot, '$.displayName'), '') = ?
          AND ${appointment.checkSql}
          AND synced.updated_at = ?
          AND (? = '' OR EXISTS (
            SELECT 1 FROM trade_team_members active_assessor
            WHERE active_assessor.id = ? AND active_assessor.owner_uid = ?
              AND active_assessor.status = 'active' AND active_assessor.member_uid <> ''
          ))
          AND EXISTS (
            SELECT 1 FROM trade_work_orders synced_job
            WHERE synced_job.id = synced.work_order_id
              AND synced_job.firebase_uid = synced.firebase_uid
              AND synced_job.record_status = 'active'
              AND synced_job.assignee_member_id = ?
              AND synced_job.assignee_label = ?
              AND synced_job.revision = ?
              AND synced_job.updated_at = ?
          )
          ${authoritativeAppointment.sql}
          AND NOT EXISTS (
            SELECT 1 FROM trade_rental_inspection_modules assessment_module
            WHERE assessment_module.inspection_id = synced.id
              AND assessment_module.firebase_uid = synced.firebase_uid
              AND assessment_module.status = 'complete'
              AND COALESCE(json_extract(
                assessment_module.credential_snapshot,
                '$.assessorMemberId'
              ), '') <> synced.assessor_member_id
          )
      )`)
      .bind(
        crypto.randomUUID(),
        input.workOrderId,
        input.ownerUid,
        input.changedAt,
        input.workOrderId,
        input.ownerUid,
        input.workOrderId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeLabel,
        ...appointment.checkValues,
        input.changedAt,
        input.assigneeMemberId,
        input.assigneeMemberId,
        input.ownerUid,
        input.assigneeMemberId,
        input.assigneeLabel,
        input.jobRevision,
        input.changedAt,
        ...authoritativeAppointment.values,
      ),
  ];
}

export function isRentalInspectionAssignmentConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT NULL constraint failed: trade_work_order_events.summary")
    && message.includes("trade_work_order_events");
}
