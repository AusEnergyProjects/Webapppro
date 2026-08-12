function clean(value, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

async function canonicalIntake(database, sourceReference) {
  return database.prepare(`SELECT intake.id, intake.submission_fingerprint,
      intake.payload_object_key, intake.status,
      customer.status customer_status,
      CASE WHEN customer.id IS NULL THEN 0 ELSE 1 END customer_exists,
      CASE WHEN relay.id IS NULL THEN 0 ELSE 1 END relay_exists
    FROM public_plan_lead_intakes intake
    LEFT JOIN public_plan_customer_email_deliveries customer ON customer.intake_id = intake.id
    LEFT JOIN public_plan_internal_relay_deliveries relay ON relay.intake_id = intake.id
    WHERE intake.source_reference = ? LIMIT 1`)
    .bind(sourceReference).first();
}

function fingerprintConflict() {
  return Object.assign(new Error("PUBLIC_PLAN_INTAKE_FINGERPRINT_MISMATCH"), {
    status: 409,
  });
}

async function restoreCanonicalPayloadIfNeeded(bucket, existing, payloadBytes, metadata) {
  if (!existing || existing.status === "completed") return;
  const canonicalKey = clean(existing.payload_object_key, 1000);
  if (!canonicalKey) throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_KEY_INVALID");
  if (!await bucket.head(canonicalKey)) {
    await bucket.put(canonicalKey, payloadBytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: metadata,
    });
  }
  if (!await bucket.head(canonicalKey)) {
    throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_UNAVAILABLE");
  }
}

export async function persistPublicPlanDeliveryIntake(database, bucket, record) {
  let existing = await canonicalIntake(database, record.sourceReference);
  if (existing && clean(existing.submission_fingerprint, 64) !== record.submissionFingerprint) {
    throw fingerprintConflict();
  }
  if (existing && Number(existing.customer_exists) === 1 && Number(existing.relay_exists) === 1) {
    await restoreCanonicalPayloadIfNeeded(bucket, existing, record.payloadBytes, record.metadata);
    return { id: String(existing.id), status: String(existing.customer_status || "pending") };
  }

  try {
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO public_plan_lead_intakes
        (id, source_reference, submission_fingerprint, payload_object_key, status, opportunity_id,
         attempts, next_attempt_at, last_attempt_at, completed_at, failed_at, last_error,
         payload_deleted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', '', 0, '', '', '', '', '', '', ?, ?)`)
        .bind(record.intakeId, record.sourceReference, record.submissionFingerprint,
          record.payloadObjectKey, record.now, record.now),
      database.prepare(`INSERT OR IGNORE INTO public_plan_customer_email_deliveries
        (id, intake_id, source_reference, status, attempts, next_attempt_at, provider,
         provider_message_id, provider_status, recipient_email_hash, idempotency_key, subject,
         body, attachment_object_key, attachment_filename, attachment_content_type,
         attachment_size_bytes, attachment_sha256, attachment_deleted_at, attachment_cleanup_next_attempt_at, last_attempt_at,
         sent_at, delivered_at, failed_at, last_error, created_at, updated_at)
        SELECT ?, id, source_reference, 'pending', 0, '', 'resend', '', '', '', ?, '', '', '', '',
          'application/pdf', 0, '', '', '', '', '', '', '', '', ?, ?
        FROM public_plan_lead_intakes WHERE source_reference = ? AND submission_fingerprint = ?`)
        .bind(record.customerDeliveryId, record.customerIdempotencyKey, record.now, record.now,
          record.sourceReference, record.submissionFingerprint),
      database.prepare(`INSERT OR IGNORE INTO public_plan_internal_relay_deliveries
        (id, intake_id, source_reference, status, attempts, next_attempt_at, idempotency_key,
         provider_status, last_attempt_at, sent_at, failed_at, last_error, created_at, updated_at)
        SELECT ?, id, source_reference, 'pending', 0, '', ?, '', '', '', '', '', ?, ?
        FROM public_plan_lead_intakes WHERE source_reference = ? AND submission_fingerprint = ?`)
        .bind(record.relayDeliveryId, record.relayIdempotencyKey, record.now, record.now,
          record.sourceReference, record.submissionFingerprint),
    ]);
  } catch (error) {
    let recovered;
    try {
      recovered = await canonicalIntake(database, record.sourceReference);
    } catch {
      throw error;
    }
    if (
      !recovered
      || clean(recovered.submission_fingerprint, 64) !== record.submissionFingerprint
      || Number(recovered.customer_exists) !== 1
      || Number(recovered.relay_exists) !== 1
    ) {
      if (recovered) throw fingerprintConflict();
      throw error;
    }
    existing = recovered;
  }

  const stored = existing && Number(existing.customer_exists) === 1 && Number(existing.relay_exists) === 1
    ? existing
    : await canonicalIntake(database, record.sourceReference);
  if (!stored || clean(stored.submission_fingerprint, 64) !== record.submissionFingerprint) {
    if (stored) throw fingerprintConflict();
    throw new Error("PUBLIC_PLAN_DURABLE_INTAKE_UNAVAILABLE");
  }
  if (Number(stored.customer_exists) !== 1 || Number(stored.relay_exists) !== 1) {
    throw new Error("PUBLIC_PLAN_DURABLE_OUTBOX_INCOMPLETE");
  }
  if (clean(stored.payload_object_key, 1000) !== record.payloadObjectKey) {
    throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_REFERENCE_MISMATCH");
  }
  await restoreCanonicalPayloadIfNeeded(bucket, stored, record.payloadBytes, record.metadata);
  return { id: String(stored.id), status: String(stored.customer_status || "pending") };
}

export async function confirmPublicPlanIntakeOpportunityWrite(database, input) {
  const verified = await database.prepare(`SELECT intake.id,
      CASE WHEN opportunity.id IS NULL THEN 0 ELSE 1 END opportunity_exists,
      CASE WHEN contact.id IS NULL THEN 0 ELSE 1 END contact_exists,
      CASE WHEN preparation.id IS NULL THEN 0 ELSE 1 END preparation_exists
    FROM public_plan_lead_intakes intake
    LEFT JOIN trade_opportunities opportunity ON opportunity.id = ?
      AND opportunity.source_reference = intake.source_reference
      AND opportunity.status = 'open'
      AND opportunity.created_by_uid = 'lead-intake'
      AND datetime(opportunity.expires_at) > datetime(?)
    LEFT JOIN public_trade_lead_contact_releases contact
      ON contact.opportunity_id = opportunity.id
      AND contact.source_reference = intake.source_reference
      AND contact.status = 'active'
      AND contact.notice_version = ?
      AND contact.consent_purpose = ?
      AND datetime(contact.granted_at) IS NOT NULL
      AND contact.withdrawn_at = ''
      AND contact.postcode = opportunity.postcode
      AND contact.customer_address_state = opportunity.state
      AND contact.customer_email <> ''
      AND EXISTS (SELECT 1 FROM json_each(contact.disclosed_fields) WHERE value = 'customer_email')
      AND EXISTS (SELECT 1 FROM json_each(contact.disclosed_fields) WHERE value = 'postcode')
      AND EXISTS (SELECT 1 FROM json_each(contact.disclosed_fields) WHERE value = 'service_categories')
    LEFT JOIN public_trade_lead_quote_preparations preparation
      ON preparation.opportunity_id = opportunity.id
      AND preparation.source_reference = intake.source_reference
      AND preparation.status = 'active'
      AND preparation.version = ?
      AND preparation.notice_version = ?
      AND preparation.consent_purpose = ?
      AND datetime(preparation.granted_at) IS NOT NULL
      AND preparation.withdrawn_at = ''
    WHERE intake.id = ? LIMIT 1`)
    .bind(
      input.opportunityId,
      input.now,
      input.contactNoticeVersion,
      input.contactConsentPurpose,
      input.quotePreparationVersion,
      input.quoteNoticeVersion,
      input.quoteConsentPurpose,
      input.intakeId,
    ).first();
  if (!verified || Number(verified.opportunity_exists) !== 1 || Number(verified.contact_exists) !== 1) {
    throw new Error("PUBLIC_PLAN_OPPORTUNITY_INTAKE_INCOMPLETE");
  }
  if (input.expectedQuotePreparation && Number(verified.preparation_exists) !== 1) {
    throw new Error("PUBLIC_PLAN_QUOTE_PREPARATION_INCOMPLETE");
  }
  await database.prepare(`UPDATE public_plan_lead_intakes SET opportunity_id = ?,
    status = 'pending', failed_at = '', last_error = '', updated_at = ?
    WHERE id = ? AND (opportunity_id = '' OR opportunity_id = ?)`)
    .bind(input.opportunityId, input.now, input.intakeId, input.opportunityId).run();
  const stored = await database.prepare(
    "SELECT opportunity_id FROM public_plan_lead_intakes WHERE id = ?",
  ).bind(input.intakeId).first();
  if (String(stored?.opportunity_id || "") !== input.opportunityId) {
    throw new Error("PUBLIC_PLAN_OPPORTUNITY_REFERENCE_MISMATCH");
  }
  return { opportunityId: input.opportunityId };
}
