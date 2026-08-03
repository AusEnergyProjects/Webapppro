export const TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL = `
  LEFT JOIN trade_crm_appointments selected_appointment
    ON selected_appointment.id = COALESCE(
      (
        SELECT exact_appointment.id
        FROM trade_crm_appointments exact_appointment
        WHERE exact_appointment.work_order_id = w.id
          AND exact_appointment.firebase_uid = w.firebase_uid
          AND exact_appointment.status <> 'cancelled'
          AND exact_appointment.starts_at = w.scheduled_start
        ORDER BY exact_appointment.created_at, exact_appointment.id
        LIMIT 1
      ),
      (
        SELECT fallback_appointment.id
        FROM trade_crm_appointments fallback_appointment
        WHERE fallback_appointment.work_order_id = w.id
          AND fallback_appointment.firebase_uid = w.firebase_uid
          AND fallback_appointment.status <> 'cancelled'
        ORDER BY fallback_appointment.starts_at, fallback_appointment.created_at, fallback_appointment.id
        LIMIT 1
      )
    )
    AND selected_appointment.firebase_uid = w.firebase_uid
`;
