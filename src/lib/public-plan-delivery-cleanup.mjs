function clean(value, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

function defaultRetryAt(attempts) {
  void attempts;
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}

export async function cleanupPublicPlanDeliveryObjectsWrite(
  database,
  bucket,
  { now = () => new Date().toISOString(), retryAt = defaultRetryAt } = {},
) {
  const selectedAt = now();
  const attachmentRows = await database.prepare(`SELECT id, attachment_object_key
    FROM public_plan_customer_email_deliveries
    WHERE status IN ('sent', 'delivered') AND attachment_object_key <> ''
      AND attachment_deleted_at = ''
      AND (attachment_cleanup_next_attempt_at = '' OR attachment_cleanup_next_attempt_at <= ?)
    ORDER BY sent_at LIMIT 20`).bind(selectedAt).all();
  let attachmentsDeleted = 0;
  for (const row of attachmentRows.results) {
    const key = clean(row.attachment_object_key, 1000);
    try {
      await bucket.delete(key);
      if (await bucket.head(key)) {
        throw new Error("CUSTOMER_PLAN_PDF_CLEANUP_INCOMPLETE");
      }
      const cleanedAt = now();
      await database.prepare(`UPDATE public_plan_customer_email_deliveries
        SET attachment_deleted_at = ?, attachment_cleanup_next_attempt_at = '',
          last_error = '', updated_at = ? WHERE id = ?`)
        .bind(cleanedAt, cleanedAt, row.id).run();
      attachmentsDeleted += 1;
    } catch (error) {
      const failedAt = now();
      await database.prepare(`UPDATE public_plan_customer_email_deliveries
        SET attachment_cleanup_next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(
          retryAt(1),
          clean(error instanceof Error ? error.message : "PDF cleanup failed."),
          failedAt,
          row.id,
        ).run();
    }
  }

  const payloadRows = await database.prepare(`SELECT intake.id, intake.payload_object_key,
      intake.attempts, customer.status customer_status, relay.status relay_status
    FROM public_plan_lead_intakes intake
    JOIN public_plan_customer_email_deliveries customer ON customer.intake_id = intake.id
    JOIN public_plan_internal_relay_deliveries relay ON relay.intake_id = intake.id
    WHERE intake.payload_deleted_at = '' AND intake.opportunity_id <> ''
      AND (customer.status IN ('delivered', 'bounced', 'complained', 'suppressed')
        OR (customer.status = 'sent'
          AND customer.provider_status LIKE '%_callback_unavailable'
          AND datetime(customer.sent_at) <= datetime(?, '-7 days')))
      AND relay.status = 'sent'
      AND (intake.next_attempt_at = '' OR intake.next_attempt_at <= ?)
    ORDER BY intake.created_at LIMIT 20`).bind(selectedAt, selectedAt).all();
  let payloadsDeleted = 0;
  for (const row of payloadRows.results) {
    const key = clean(row.payload_object_key, 1000);
    try {
      await bucket.delete(key);
      if (await bucket.head(key)) {
        throw new Error("PUBLIC_PLAN_INTAKE_CLEANUP_INCOMPLETE");
      }
      const cleanedAt = now();
      await database.prepare(`UPDATE public_plan_lead_intakes
        SET status = 'completed', completed_at = ?, payload_deleted_at = ?,
          next_attempt_at = '', last_error = '', updated_at = ? WHERE id = ?`)
        .bind(cleanedAt, cleanedAt, cleanedAt, row.id).run();
      payloadsDeleted += 1;
    } catch (error) {
      const failedAt = now();
      await database.prepare(`UPDATE public_plan_lead_intakes
        SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
        WHERE id = ?`).bind(
          failedAt,
          clean(error instanceof Error ? error.message : "Intake cleanup failed."),
          retryAt(Number(row.attempts || 0) + 1),
          failedAt,
          row.id,
        ).run();
    }
  }
  return { attachmentsDeleted, payloadsDeleted };
}
