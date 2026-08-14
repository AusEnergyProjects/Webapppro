import { getD1 } from "../../db";

export function tradeJobScheduleEligibilitySql(workOrderAlias: string, jobDetailAlias: string) {
  return `${workOrderAlias}.source_type <> 'opportunity'
    AND COALESCE(${jobDetailAlias}.customer_source, 'internal') <> 'platform_private'
    AND (COALESCE(${jobDetailAlias}.customer_source, 'internal') <> 'public_lead_released' OR (
      ${jobDetailAlias}.quote_status = 'accepted' AND EXISTS (
        SELECT 1 FROM trade_crm_quotes schedule_quote
        JOIN trade_crm_quote_versions schedule_version
          ON schedule_version.quote_id = schedule_quote.id
          AND schedule_version.firebase_uid = schedule_quote.firebase_uid
          AND schedule_version.version_number = schedule_quote.current_version_number
        JOIN trade_crm_quote_acceptances schedule_acceptance
          ON schedule_acceptance.quote_id = schedule_quote.id
          AND schedule_acceptance.quote_version_id = schedule_version.id
          AND schedule_acceptance.work_order_id = schedule_quote.work_order_id
          AND schedule_acceptance.firebase_uid = schedule_quote.firebase_uid
          AND schedule_acceptance.crm_customer_id = schedule_quote.crm_customer_id
          AND schedule_acceptance.decision = 'accepted'
        WHERE schedule_quote.work_order_id = ${workOrderAlias}.id
          AND schedule_quote.firebase_uid = ${workOrderAlias}.firebase_uid
          AND schedule_quote.crm_customer_id = ${jobDetailAlias}.crm_customer_id
          AND schedule_quote.status = 'accepted'
          AND schedule_version.status = 'accepted'
      )
    ))`;
}

export async function assertTradeJobReadyForScheduling(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT work_order.id FROM trade_work_orders work_order
    LEFT JOIN trade_crm_job_details job_detail
      ON job_detail.work_order_id = work_order.id AND job_detail.firebase_uid = work_order.firebase_uid
    WHERE work_order.id = ? AND work_order.firebase_uid = ? AND work_order.partner_type = 'installer'
      AND work_order.record_status = 'active' AND ${tradeJobScheduleEligibilitySql("work_order", "job_detail")}`)
    .bind(workOrderId, ownerUid).first();
  if (!row) throw new Error("JOB_SCHEDULE_ACCEPTANCE_REQUIRED");
}

export function tradeJobScheduleEligibilityGuardStatement(
  db: D1Database,
  { ownerUid, workOrderId, changedAt }: { ownerUid: string; workOrderId: string; changedAt: string },
) {
  return db.prepare(`INSERT INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at)
    SELECT ?, ?, ?, NULL, 'Schedule eligibility changed during booking.', ? WHERE NOT EXISTS (
      SELECT 1 FROM trade_work_orders work_order
      LEFT JOIN trade_crm_job_details job_detail
        ON job_detail.work_order_id = work_order.id AND job_detail.firebase_uid = work_order.firebase_uid
      WHERE work_order.id = ? AND work_order.firebase_uid = ? AND work_order.partner_type = 'installer'
        AND work_order.record_status = 'active' AND ${tradeJobScheduleEligibilitySql("work_order", "job_detail")}
    )`).bind(crypto.randomUUID(), workOrderId, ownerUid, changedAt, workOrderId, ownerUid);
}

export function isTradeJobScheduleEligibilityConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT NULL constraint failed: trade_work_order_events.event_type");
}

export async function assertTradeScheduleAvailable({
  ownerUid,
  memberId,
  startsAt,
  endsAt,
  excludeAppointmentId = "",
}: {
  ownerUid: string;
  memberId: string;
  startsAt: string;
  endsAt: string;
  excludeAppointmentId?: string;
}) {
  const db = getD1();
  const [overlap, unavailable] = await Promise.all([
    db.prepare(`SELECT id FROM trade_crm_appointments WHERE firebase_uid = ? AND assignee_member_id = ?
      AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND id <> ? AND starts_at < ?
      AND COALESCE(NULLIF(ends_at, ''), starts_at) > ? LIMIT 1`)
      .bind(ownerUid, memberId, excludeAppointmentId, endsAt, startsAt).first(),
    db.prepare(`SELECT id FROM trade_team_unavailability WHERE owner_uid = ? AND team_member_id = ?
      AND starts_at < ? AND ends_at > ? LIMIT 1`)
      .bind(ownerUid, memberId, endsAt, startsAt).first(),
  ]);
  if (overlap) throw new Error("APPOINTMENT_CONFLICT");
  if (unavailable) throw new Error("UNAVAILABLE_CONFLICT");
}

export function tradeScheduleAvailabilityGuardStatement(
  db: D1Database,
  {
    ownerUid,
    memberId,
    startsAt,
    endsAt,
    changedAt,
    excludeAppointmentId = "",
  }: {
    ownerUid: string;
    memberId: string;
    startsAt: string;
    endsAt: string;
    changedAt: string;
    excludeAppointmentId?: string;
  },
) {
  return db.prepare(`INSERT INTO trade_crm_write_guards
    (id, firebase_uid, operation_id, step_number, verified, created_at)
    VALUES (?, ?, ?, 1, CASE WHEN NOT EXISTS (
      SELECT 1 FROM trade_crm_appointments
      WHERE firebase_uid = ? AND assignee_member_id = ?
        AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND id <> ?
        AND starts_at < ? AND COALESCE(NULLIF(ends_at, ''), starts_at) > ?
    ) AND NOT EXISTS (
      SELECT 1 FROM trade_team_unavailability
      WHERE owner_uid = ? AND team_member_id = ? AND starts_at < ? AND ends_at > ?
    ) THEN 1 ELSE 0 END, ?)`)
    .bind(
      crypto.randomUUID(), ownerUid, `schedule-availability:${crypto.randomUUID()}`,
      ownerUid, memberId, excludeAppointmentId, endsAt, startsAt,
      ownerUid, memberId, endsAt, startsAt, changedAt,
    );
}
