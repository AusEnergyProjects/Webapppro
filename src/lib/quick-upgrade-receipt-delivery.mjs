import { normalizeEnergyServiceIds } from "./energy-service-catalogue.mjs";
import { QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE } from "./quick-upgrade-enquiry.mjs";
import { QUICK_UPGRADE_RECEIPT_KIND, QUICK_UPGRADE_RECEIPT_PREFIX, quickUpgradeReceiptDraft } from "./quick-upgrade-receipt.mjs";
import { publicPlanDeliveryRetryAt } from "./public-plan-delivery-retry.ts";
import { ReminderProviderDeliveryError, sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from "./service-reminder-delivery.ts";

const CALLBACK_URL = "https://ausenergyassessments.com/api/service-reminder-provider-events/resend";
const RETRYABLE = new Set(["pending", "failed", "provider_failed", "waiting_for_channel"]);

/**
 * @typedef {object} QuickUpgradeReceiptDependencies
 * @property {D1Database} db
 * @property {import("./customer-project-evidence-bucket").CustomerProjectEvidenceBucket} bucket
 * @property {Record<string, string | undefined>} [runtime]
 * @property {typeof fetch} [fetchImpl]
 * @property {() => string} [now]
 * @property {typeof sendServiceReminderProviderMessage} [sendProvider]
 */

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function currentContact(db, opportunityId, reference) {
  return db.prepare(`SELECT contact.customer_first_name, contact.customer_email, opportunity.service_categories,
      (SELECT COUNT(*) FROM trade_opportunity_matches assignment WHERE assignment.opportunity_id = opportunity.id
        AND assignment.status IN ('offered', 'viewed', 'interested', 'connected')) matched_count,
      EXISTS (SELECT 1 FROM admin_notifications notification
        WHERE notification.event_key = 'quick-upgrade-no-match:' || opportunity.id
          AND notification.entity_type = 'trade_opportunity' AND notification.entity_id = opportunity.id) review_queued
    FROM trade_opportunities opportunity
    JOIN public_trade_lead_contact_releases contact ON contact.opportunity_id = opportunity.id
      AND contact.source_reference = opportunity.source_reference
    WHERE opportunity.id = ? AND opportunity.source_reference = ? AND opportunity.created_by_uid = 'lead-intake'
      AND opportunity.status = 'open' AND contact.status = 'active'
      AND contact.notice_version = ? AND contact.consent_purpose = ?
      AND datetime(contact.granted_at) IS NOT NULL AND contact.withdrawn_at = '' LIMIT 1`)
    .bind(opportunityId, reference, QUICK_UPGRADE_CONSENT_NOTICE_VERSION, QUICK_UPGRADE_CONSENT_PURPOSE).first();
}

async function canonical(db, reference) {
  return db.prepare(`SELECT intake.id, intake.submission_fingerprint, intake.payload_object_key,
      intake.opportunity_id, intake.status, customer.id customer_delivery_id, customer.status customer_status
    FROM public_plan_lead_intakes intake
    LEFT JOIN public_plan_customer_email_deliveries customer ON customer.intake_id = intake.id
    WHERE intake.source_reference = ? LIMIT 1`).bind(reference).first();
}

function verifyCanonical(row, input) {
  if (!row || row.submission_fingerprint !== input.fingerprint || row.opportunity_id !== input.opportunityId
    || !String(row.payload_object_key).startsWith(QUICK_UPGRADE_RECEIPT_PREFIX) || !row.customer_delivery_id) {
    throw new Error("QUICK_UPGRADE_RECEIPT_IDENTITY_CONFLICT");
  }
  return { id: String(row.id), status: String(row.customer_status) };
}

/**
 * Stores only a customer receipt after the opportunity and any required no-match review are durable.
 * @param {{ opportunityId: string, reference: string, fingerprint: string }} input
 * @param {Pick<QuickUpgradeReceiptDependencies, "db" | "bucket" | "now">} dependencies
 */
export async function enqueueQuickUpgradeReceipt(input, { db, bucket, now = () => new Date().toISOString() }) {
  if (!/^AEA-\d{8}-[A-F0-9]{16}$/.test(input.reference) || !/^[a-f0-9]{64}$/.test(input.fingerprint)) {
    throw new Error("QUICK_UPGRADE_RECEIPT_IDENTITY_INVALID");
  }
  const existing = await canonical(db, input.reference);
  if (existing) {
    const result = verifyCanonical(existing, input);
    if (existing.status !== "completed" && !await bucket.head(existing.payload_object_key)) {
      throw new Error("QUICK_UPGRADE_RECEIPT_PAYLOAD_UNAVAILABLE");
    }
    return result;
  }
  const contact = await currentContact(db, input.opportunityId, input.reference);
  if (!contact || (!Number(contact.matched_count) && !Number(contact.review_queued))) {
    throw new Error("QUICK_UPGRADE_RECEIPT_INTAKE_INCOMPLETE");
  }
  const email = String(contact.customer_email).trim().toLowerCase();
  const services = normalizeEnergyServiceIds(JSON.parse(contact.service_categories));
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email) || email.length > 254 || !services?.length) {
    throw new Error("QUICK_UPGRADE_RECEIPT_CONTACT_INVALID");
  }
  const receipt = { kind: QUICK_UPGRADE_RECEIPT_KIND, reference: input.reference, opportunityId: input.opportunityId,
    firstName: String(contact.customer_first_name), email, services,
    matchingState: Number(contact.matched_count) > 0 ? "matched" : "review" };
  // Freeze the complete provider content so matching changes and later deployments cannot change a retry.
  const source = JSON.stringify({ receipt, draft: quickUpgradeReceiptDraft(receipt) });
  // Each writer owns its candidate object, so a failed concurrent writer cannot delete the winner's payload.
  const intakeId = crypto.randomUUID();
  const key = `${QUICK_UPGRADE_RECEIPT_PREFIX}${input.reference}/${intakeId}/${await sha256(source)}.json`;
  await bucket.put(key, new TextEncoder().encode(source).buffer, {
    httpMetadata: { contentType: "application/json" }, customMetadata: { purpose: QUICK_UPGRADE_RECEIPT_KIND },
  });
  if (!await bucket.head(key)) throw new Error("QUICK_UPGRADE_RECEIPT_PAYLOAD_UNAVAILABLE");
  const createdAt = now();
  const customerId = crypto.randomUUID();
  const idempotencyKey = await sha256(`${input.reference}|quick-upgrade-receipt|v1`);
  let failure;
  try {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO public_plan_lead_intakes
        (id, source_reference, submission_fingerprint, payload_object_key, opportunity_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(intakeId, input.reference, input.fingerprint, key, input.opportunityId, createdAt, createdAt),
      db.prepare(`INSERT OR IGNORE INTO public_plan_customer_email_deliveries
        (id, intake_id, source_reference, idempotency_key, attachment_content_type, created_at, updated_at)
        SELECT ?, id, source_reference, ?, '', ?, ? FROM public_plan_lead_intakes
        WHERE source_reference = ? AND submission_fingerprint = ? AND opportunity_id = ? AND payload_object_key LIKE ?`)
        .bind(customerId, idempotencyKey, createdAt, createdAt, input.reference, input.fingerprint,
          input.opportunityId, `${QUICK_UPGRADE_RECEIPT_PREFIX}%`),
    ]);
  } catch (error) { failure = error; }
  // A transport error may occur after commit. Only the canonical database rows establish success.
  const stored = await canonical(db, input.reference);
  if (!stored) {
    await bucket.delete(key);
    throw failure || new Error("QUICK_UPGRADE_RECEIPT_QUEUE_UNAVAILABLE");
  }
  const result = verifyCanonical(stored, input);
  if (stored.payload_object_key !== key) await bucket.delete(key);
  return result;
}

/**
 * Uses the existing email outbox, provider idempotency, callbacks and suppression record.
 * @param {Record<string, unknown>} row
 * @param {QuickUpgradeReceiptDependencies} dependencies
 */
export async function dispatchQuickUpgradeReceipt(row, { db, bucket, runtime, fetchImpl,
  now = () => new Date().toISOString(), sendProvider = sendServiceReminderProviderMessage }) {
  const attemptedAt = now();
  const delivery = await db.prepare(`SELECT * FROM public_plan_customer_email_deliveries WHERE id = ?`)
    .bind(row.customer_delivery_id).first();
  if (!delivery || !RETRYABLE.has(delivery.status) || (delivery.next_attempt_at && delivery.next_attempt_at > attemptedAt)) return;
  const object = await bucket.get(row.payload_object_key);
  if (!object) throw new Error("QUICK_UPGRADE_RECEIPT_PAYLOAD_UNAVAILABLE");
  const source = new TextDecoder().decode(await object.arrayBuffer());
  const expectedKey = `${QUICK_UPGRADE_RECEIPT_PREFIX}${row.source_reference}/${row.id}/${await sha256(source)}.json`;
  if (expectedKey !== row.payload_object_key) throw new Error("QUICK_UPGRADE_RECEIPT_PAYLOAD_INTEGRITY_FAILED");
  const { receipt, draft } = JSON.parse(source);
  if (receipt.kind !== QUICK_UPGRADE_RECEIPT_KIND || receipt.reference !== row.source_reference
    || receipt.opportunityId !== row.opportunity_id || !draft.subject || !draft.body || !draft.html) {
    throw new Error("QUICK_UPGRADE_RECEIPT_PAYLOAD_INVALID");
  }
  const emailHash = await sha256(receipt.email);
  const contact = await currentContact(db, row.opportunity_id, row.source_reference);
  const suppression = await db.prepare("SELECT email_hash FROM public_plan_customer_email_suppressions WHERE email_hash = ?")
    .bind(emailHash).first();
  if (!contact || String(contact.customer_email).trim().toLowerCase() !== receipt.email || suppression) {
    await db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'suppressed',
      provider_status = 'local_suppression', next_attempt_at = '', last_error = 'Receipt consent or recipient is unavailable.',
      updated_at = ? WHERE id = ? AND status = ? AND attempts = ?`)
      .bind(attemptedAt, delivery.id, delivery.status, delivery.attempts).run();
    return;
  }
  const provider = serviceReminderProviderConfiguration(runtime);
  if (!provider.email.configured) {
    await db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'waiting_for_channel',
      next_attempt_at = ?, last_error = 'Resend delivery is not configured.', updated_at = ?
      WHERE id = ? AND status = ? AND attempts = ?`)
      .bind(publicPlanDeliveryRetryAt(1, Date.parse(attemptedAt)), attemptedAt, delivery.id, delivery.status, delivery.attempts).run();
    return;
  }
  const attemptKeyPrefix = `receipt-attempt:${delivery.id}:${delivery.idempotency_key}:`;
  const firstAttempt = await db.prepare(`SELECT occurred_at FROM public_plan_customer_email_delivery_events
    WHERE delivery_id = ? AND event_type = 'provider_attempted' AND provider_event_key LIKE ?
      AND provider_status != 'definite_failure' ORDER BY occurred_at LIMIT 1`)
    .bind(delivery.id, `${attemptKeyPrefix}%`).first();
  // Resend retains keys for 24h. A confirmed failure callback rotates the key and begins a new safe window.
  // https://resend.com/docs/dashboard/emails/idempotency-keys
  if (firstAttempt && Date.parse(attemptedAt) - Date.parse(firstAttempt.occurred_at) >= 23 * 60 * 60 * 1000) {
    await db.prepare(`UPDATE public_plan_customer_email_deliveries SET next_attempt_at = '9999-12-31T00:00:00.000Z',
      last_error = 'Receipt retry window expired. Review provider delivery before sending again.', updated_at = ?
      WHERE id = ? AND status = ? AND attempts = ? AND idempotency_key = ?`)
      .bind(attemptedAt, delivery.id, delivery.status, delivery.attempts, delivery.idempotency_key).run();
    return;
  }
  const attempts = Number(delivery.attempts) + 1;
  const claim = await db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'sending', attempts = ?,
      recipient_email_hash = ?, subject = ?, body = ?, last_attempt_at = ?, next_attempt_at = '', updated_at = ?
    WHERE id = ? AND status = ? AND attempts = ? AND idempotency_key = ?`)
    .bind(attempts, emailHash, draft.subject, draft.body, attemptedAt, attemptedAt,
      delivery.id, delivery.status, delivery.attempts, delivery.idempotency_key).run();
  if (!claim.meta.changes) return;
  const attemptKey = `${attemptKeyPrefix}${attempts}`;
  try {
    await db.prepare(`INSERT OR IGNORE INTO public_plan_customer_email_delivery_events
      (id, delivery_id, provider_event_key, event_type, summary, occurred_at, created_at)
      VALUES (?, ?, ?, 'provider_attempted', 'Customer receipt delivery attempted.', ?, ?)`)
      .bind(crypto.randomUUID(), delivery.id, attemptKey, attemptedAt, attemptedAt).run();
    const result = await sendProvider({ channel: "email", recipient: receipt.email,
      subject: draft.subject, body: draft.body, html: draft.html, replyTo: draft.replyTo,
      idempotencyKey: delivery.idempotency_key, callbackUrl: CALLBACK_URL, messageType: "public_plan_customer" }, { runtime, fetchImpl });
    const providerStatus = `${result.providerStatus}_${provider.email.callbacks ? "callback_pending" : "callback_unavailable"}`;
    const sentAt = now();
    await db.batch([
      db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'sent', provider = ?, provider_message_id = ?,
        provider_status = ?, sent_at = ?, failed_at = '', last_error = '', updated_at = ?
        WHERE id = ? AND status = 'sending' AND attempts = ? AND idempotency_key = ?`)
        .bind(result.provider, result.providerMessageId, providerStatus, sentAt, sentAt,
          delivery.id, attempts, delivery.idempotency_key),
      db.prepare(`INSERT OR IGNORE INTO public_plan_customer_email_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?, 'Provider accepted the customer enquiry receipt.', ?, ?)`)
        .bind(crypto.randomUUID(), delivery.id, `receipt-accepted:${delivery.id}:${attempts}`, providerStatus, sentAt, sentAt),
    ]);
  } catch (error) {
    const failedAt = now();
    if (error instanceof ReminderProviderDeliveryError && error.outcome === "definite_failure") {
      await db.prepare(`UPDATE public_plan_customer_email_delivery_events SET provider_status = 'definite_failure'
        WHERE provider_event_key = ?`).bind(attemptKey).run();
    }
    await db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'failed', failed_at = ?,
      last_error = 'Receipt provider delivery could not be confirmed.', next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending' AND attempts = ? AND idempotency_key = ?`)
      .bind(failedAt, publicPlanDeliveryRetryAt(attempts, Date.parse(failedAt)), failedAt,
        delivery.id, attempts, delivery.idempotency_key).run();
  }
}
