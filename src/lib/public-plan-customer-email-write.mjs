export async function recordPublicPlanCustomerPdfWrite(database, input) {
  const now = input.now || new Date().toISOString();
  await database.prepare(`UPDATE public_plan_customer_email_deliveries
    SET attachment_object_key = ?, attachment_filename = ?, attachment_content_type = 'application/pdf',
      attachment_size_bytes = ?, attachment_sha256 = ?, attachment_deleted_at = '',
      attachment_cleanup_next_attempt_at = '', updated_at = ?
    WHERE id = ?`).bind(
      input.objectKey,
      input.filename,
      input.sizeBytes,
      input.sha256,
      now,
      input.deliveryId,
    ).run();
}
