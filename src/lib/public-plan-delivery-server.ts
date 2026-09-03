import { getD1 } from "../../db";
import {
  getCustomerProjectEvidenceBucket,
  type CustomerProjectEvidenceBucket,
} from "@/lib/customer-project-evidence-bucket";
import { loadCustomerPlanPdfFonts } from "@/lib/customer-plan-pdf-fonts";
import {
  createSignedInternalLeadEnvelope,
  internalRelayPayload,
} from "@/lib/public-plan-delivery-payload.mjs";
import { publicPlanDeliveryRetryAt } from "@/lib/public-plan-delivery-retry";
import { cleanupPublicPlanDeliveryObjectsWrite } from "@/lib/public-plan-delivery-cleanup.mjs";
import { recordPublicPlanCustomerPdfWrite } from "@/lib/public-plan-customer-email-write.mjs";
import {
  confirmPublicPlanIntakeOpportunityWrite,
  persistPublicPlanDeliveryIntake,
} from "@/lib/public-plan-intake-write.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";
import {
  PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
} from "@/lib/public-plan-quote-preparation.mjs";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";

type PublicPlanDeliveryDependencies = {
  db?: D1Database;
  bucket?: CustomerProjectEvidenceBucket;
  fetchImpl?: typeof fetch;
  runtime?: Record<string, string | undefined>;
};

type IntakeRow = Record<string, unknown>;

const CALLBACK_URL =
  "https://ausenergyassessments.com/api/service-reminder-provider-events/resend";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PDF_BYTES = 1_500_000;

function clean(value: unknown, maximum = 180) {
  return String(value || "").trim().slice(0, maximum);
}

async function sha256(value: string | ArrayBuffer | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validEmail(value: unknown) {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("PUBLIC_PLAN_CUSTOMER_EMAIL_INVALID");
  }
  return email;
}

function emailDraft(payload: Record<string, unknown>) {
  const reference = clean(payload.reference, 80);
  const name = clean(payload.customerFirstName || payload.name, 80) || "there";
  const subject = `[${reference}] Your personalised home energy plan is attached`;
  const body = `Hi ${name},\n\nWe received your home upgrade enquiry. Your personalised home energy plan is attached.\n\nApproved matched trades that provide your selected services in your area can now review the details you chose to share. Your private plan and PDF are not shared with trades.\n\nReference: ${reference}\n\nAustralian Energy Assessments\n1300 241 149`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef7f4;font-family:Arial,Helvetica,sans-serif;color:#073b3e"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="620" style="max-width:100%;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="background:#063f47;padding:24px 28px;color:#fff"><div style="font-size:12px;letter-spacing:1.4px;color:#61e3c3;font-weight:700">AUSTRALIAN ENERGY ASSESSMENTS</div><h1 style="font-size:27px;margin:10px 0 0">Your plan is ready</h1></td></tr><tr><td style="padding:28px"><p>Hi ${escapeHtml(name)},</p><p>We received your home upgrade enquiry. Your personalised home energy plan is attached.</p><div style="background:#e9f8f3;border-left:4px solid #0aa77b;padding:14px 16px;margin:22px 0"><strong>What happens next</strong><br>Approved matched trades that provide your selected services in your area can review only the details you chose to share.</div><p>Your private plan and PDF are not shared with trades.</p><p style="font-size:13px;color:#4b6b6d">Reference: ${escapeHtml(reference)}</p><p>Australian Energy Assessments<br>1300 241 149</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, body, html };
}

function payloadObjectKey(reference: string, fingerprint: string) {
  return `public-plan/intake/${reference}/${fingerprint}.json`;
}

function pdfObjectKey(reference: string, fingerprint: string) {
  return `public-plan/customer-email/${reference}/${fingerprint}.pdf`;
}

export async function enqueuePublicPlanDelivery(
  input: { envelope: Record<string, unknown>; validatedPayload: Record<string, unknown> },
  dependencies: PublicPlanDeliveryDependencies = {},
) {
  const db = dependencies.db || getD1();
  const bucket = dependencies.bucket || getCustomerProjectEvidenceBucket();
  const reference = clean(input.envelope.reference, 80);
  const fingerprint = clean(input.envelope.submissionFingerprint, 64).toLowerCase();
  if (!reference || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("PUBLIC_PLAN_INTAKE_IDENTITY_INVALID");
  }
  const payload = JSON.stringify({
    envelope: input.envelope,
    reportInput: {
      snapshot: input.validatedPayload.planSnapshot,
      name: input.validatedPayload.name,
      postcode: input.validatedPayload.postcode,
      projectCategories: input.validatedPayload.projectCategories,
      preparedAt: input.envelope.submittedAt,
    },
  });
  const payloadBytes = new TextEncoder().encode(payload);
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_TOO_LARGE");
  }
  const objectKey = payloadObjectKey(reference, fingerprint);
  const intakeId = crypto.randomUUID();
  const customerDeliveryId = crypto.randomUUID();
  const relayDeliveryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const customerIdempotencyKey = await sha256(`${reference}|customer-plan-email|v1`);
  const relayIdempotencyKey = await sha256(`${reference}|internal-lead-relay|v1`);

  return persistPublicPlanDeliveryIntake(db, bucket, {
    intakeId,
    customerDeliveryId,
    relayDeliveryId,
    sourceReference: reference,
    submissionFingerprint: fingerprint,
    payloadObjectKey: objectKey,
    payloadBytes: payloadBytes.buffer,
    customerIdempotencyKey,
    relayIdempotencyKey,
    metadata: { purpose: "public-plan-durable-intake", reference, fingerprint },
    now,
  });
}

export async function confirmPublicPlanIntakeOpportunity(
  input: {
    intakeId: string;
    opportunityId: string;
    expectedQuotePreparation: boolean;
  },
  db: D1Database = getD1(),
) {
  return confirmPublicPlanIntakeOpportunityWrite(db, {
    ...input,
    now: new Date().toISOString(),
    contactNoticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    contactConsentPurpose: PUBLIC_PLAN_CONSENT_PURPOSE,
    quotePreparationVersion: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
    quoteNoticeVersion: PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    quoteConsentPurpose: PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  });
}

async function readPayload(row: IntakeRow, bucket: CustomerProjectEvidenceBucket) {
  const object = await bucket.get(clean(row.payload_object_key, 1000));
  if (!object) throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_UNAVAILABLE");
  const text = new TextDecoder().decode(await object.arrayBuffer());
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (!parsed.envelope || !parsed.reportInput) {
    throw new Error("PUBLIC_PLAN_INTAKE_PAYLOAD_INVALID");
  }
  return parsed as {
    envelope: Record<string, unknown>;
    reportInput: {
      snapshot: Record<string, unknown>;
      name?: string;
      postcode?: string;
      projectCategories?: string[];
      preparedAt?: string;
    };
  };
}

async function ensureOpportunity(
  row: IntakeRow,
  payload: { envelope: Record<string, unknown> },
  createOpportunityFromLead: (payload: Record<string, unknown>) => Promise<unknown>,
  db: D1Database,
) {
  if (clean(row.opportunity_id, 80)) return clean(row.opportunity_id, 80);
  const envelope = { ...payload.envelope };
  delete envelope.customerPlanDelivery;
  const result = await createOpportunityFromLead(envelope) as { id?: unknown } | null;
  const opportunityId = clean(result?.id, 80);
  if (!opportunityId) throw new Error("PUBLIC_PLAN_OPPORTUNITY_UNAVAILABLE");
  const now = new Date().toISOString();
  await db.prepare(`UPDATE public_plan_lead_intakes SET opportunity_id = ?, updated_at = ?
    WHERE id = ? AND opportunity_id = ''`).bind(opportunityId, now, row.id).run();
  return opportunityId;
}

async function ensurePdf(
  row: IntakeRow,
  payload: {
    reportInput: {
      snapshot: Record<string, unknown>;
      name?: string;
      postcode?: string;
      projectCategories?: string[];
      preparedAt?: string;
    };
  },
  bucket: CustomerProjectEvidenceBucket,
  db: D1Database,
) {
  const objectKey = clean(row.attachment_object_key, 1000);
  if (objectKey && await bucket.head(objectKey)) {
    return {
      key: objectKey,
      filename: clean(row.attachment_filename, 160),
      sha256: clean(row.attachment_sha256, 64),
    };
  }
  const [
    fonts,
    { createPublicPlanCustomerPdfBundle },
    { customerPlanPdfFileName },
  ] = await Promise.all([
    loadCustomerPlanPdfFonts(),
    import("@/lib/public-plan-customer-pdf.mjs"),
    import("@/lib/customer-plan-pdf.mjs"),
  ]);
  const { report, bytes } = await createPublicPlanCustomerPdfBundle(payload.reportInput, fonts);
  if (bytes.byteLength < 20_000 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("CUSTOMER_PLAN_PDF_SIZE_INVALID");
  }
  const fingerprint = clean(row.submission_fingerprint, 64);
  const key = pdfObjectKey(clean(row.source_reference, 80), fingerprint);
  const digest = await sha256(bytes);
  const filename = customerPlanPdfFileName(report);
  await bucket.put(key, Uint8Array.from(bytes).buffer, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { purpose: "customer-only-home-plan-pdf", sha256: digest },
  });
  const now = new Date().toISOString();
  await recordPublicPlanCustomerPdfWrite(db, {
    deliveryId: row.customer_delivery_id,
    objectKey: key,
    filename,
    sizeBytes: bytes.byteLength,
    sha256: digest,
    now,
  });
  return { key, filename, sha256: digest };
}

async function dispatchCustomer(
  row: IntakeRow,
  payload: {
    envelope: Record<string, unknown>;
    reportInput: {
      snapshot: Record<string, unknown>;
      name?: string;
      postcode?: string;
      projectCategories?: string[];
      preparedAt?: string;
    };
  },
  dependencies: PublicPlanDeliveryDependencies,
) {
  const db = dependencies.db || getD1();
  const bucket = dependencies.bucket || getCustomerProjectEvidenceBucket();
  const status = clean(row.customer_status, 40);
  if (["sent", "delivered", "bounced", "complained", "suppressed"].includes(status)) return;
  const email = validEmail(payload.envelope.email);
  const emailHash = await sha256(email);
  const suppression = await db.prepare(
    "SELECT email_hash FROM public_plan_customer_email_suppressions WHERE email_hash = ?",
  ).bind(emailHash).first();
  if (suppression) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE public_plan_customer_email_deliveries
      SET status = 'suppressed', provider_status = 'local_suppression', next_attempt_at = '',
        last_error = 'Provider suppression applies to this email address.', updated_at = ? WHERE id = ?`)
      .bind(now, row.customer_delivery_id).run();
    return;
  }
  const provider = serviceReminderProviderConfiguration(dependencies.runtime);
  if (!provider.email.configured) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE public_plan_customer_email_deliveries
      SET status = 'waiting_for_channel', next_attempt_at = ?,
        last_error = 'Resend delivery is not configured.', updated_at = ?
      WHERE id = ?`).bind(publicPlanDeliveryRetryAt(Number(row.customer_attempts) + 1), now, row.customer_delivery_id).run();
    return;
  }

  const pdfAttachment = await ensurePdf(row, payload, bucket, db);
  const pdfKey = pdfAttachment.key;
  const pdf = await bucket.get(pdfKey);
  if (!pdf) throw new Error("CUSTOMER_PLAN_PDF_UNAVAILABLE");
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const expectedDigest = pdfAttachment.sha256 || await sha256(bytes);
  if (await sha256(bytes) !== expectedDigest) throw new Error("CUSTOMER_PLAN_PDF_INTEGRITY_FAILED");
  const attempts = Number(row.customer_attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();
  const draft = emailDraft(payload.envelope);
  const claim = await db.prepare(`UPDATE public_plan_customer_email_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = '', recipient_email_hash = ?,
      subject = ?, body = ?, last_attempt_at = ?, updated_at = ?
    WHERE id = ? AND status = ? AND attempts = ?`)
    .bind(attempts, emailHash, draft.subject, draft.body, attemptedAt, attemptedAt,
      row.customer_delivery_id, row.customer_status, row.customer_attempts).run();
  if (!claim.meta.changes) return;
  try {
    const result = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient: email,
      subject: draft.subject,
      body: draft.body,
      html: draft.html,
      idempotencyKey: clean(row.customer_idempotency_key, 64),
      callbackUrl: CALLBACK_URL,
      messageType: "public_plan_customer",
      attachments: [{
        filename: pdfAttachment.filename || "personalised-home-energy-plan.pdf",
        content: Buffer.from(bytes).toString("base64"),
        contentType: "application/pdf",
      }],
    }, { runtime: dependencies.runtime, fetchImpl: dependencies.fetchImpl || fetch });
    const sentAt = new Date().toISOString();
    const providerStatus = provider.email.callbacks
      ? `${result.providerStatus}_callback_pending`
      : `${result.providerStatus}_callback_unavailable`;
    await db.batch([
      db.prepare(`UPDATE public_plan_customer_email_deliveries
        SET status = 'sent', provider = ?, provider_message_id = ?, provider_status = ?, sent_at = ?,
          failed_at = '', last_error = '', updated_at = ? WHERE id = ? AND status = 'sending'`)
        .bind(result.provider, result.providerMessageId, providerStatus, sentAt, sentAt, row.customer_delivery_id),
      db.prepare(`INSERT OR IGNORE INTO public_plan_customer_email_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'provider_accepted', ?, 'Provider accepted the customer plan email.', ?, ?)`)
        .bind(crypto.randomUUID(), row.customer_delivery_id,
          `accepted:${String(row.customer_delivery_id)}:${attempts}`, providerStatus, sentAt, sentAt),
    ]);
    try {
      await bucket.delete(pdfKey);
      if (await bucket.head(pdfKey)) throw new Error("CUSTOMER_PLAN_PDF_CLEANUP_INCOMPLETE");
      await db.prepare(`UPDATE public_plan_customer_email_deliveries SET attachment_deleted_at = ?, updated_at = ?
        WHERE id = ?`).bind(sentAt, sentAt, row.customer_delivery_id).run();
    } catch (cleanupError) {
      await db.prepare(`UPDATE public_plan_customer_email_deliveries
        SET attachment_cleanup_next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(publicPlanDeliveryRetryAt(1),
          clean(cleanupError instanceof Error ? cleanupError.message : "PDF cleanup failed."),
          sentAt, row.customer_delivery_id).run();
    }
  } catch (error) {
    const failedAt = new Date().toISOString();
    await db.prepare(`UPDATE public_plan_customer_email_deliveries
      SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending'`)
      .bind(failedAt, clean(error instanceof Error ? error.message : "Provider delivery failed."),
        publicPlanDeliveryRetryAt(attempts), failedAt, row.customer_delivery_id).run();
  }
}

async function dispatchInternalRelay(
  row: IntakeRow,
  payload: { envelope: Record<string, unknown> },
  dependencies: PublicPlanDeliveryDependencies,
) {
  const db = dependencies.db || getD1();
  const runtime = dependencies.runtime || process.env;
  const status = clean(row.relay_status, 40);
  if (status === "sent") return;
  const webhook = clean(runtime.AEA_LEAD_WEBHOOK_URL, 1000);
  const secret = String(runtime.AEA_LEAD_WEBHOOK_SIGNING_SECRET || "");
  const attempts = Number(row.relay_attempts || 0) + 1;
  if (!webhook || secret.length < 32) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE public_plan_internal_relay_deliveries
      SET status = 'waiting_for_channel', next_attempt_at = ?, last_error = 'Internal relay is not configured.', updated_at = ?
      WHERE id = ?`).bind(publicPlanDeliveryRetryAt(attempts), now, row.relay_delivery_id).run();
    return;
  }
  const attemptedAt = new Date().toISOString();
  const claim = await db.prepare(`UPDATE public_plan_internal_relay_deliveries
    SET status = 'sending', attempts = ?, next_attempt_at = '', last_attempt_at = ?, updated_at = ?
    WHERE id = ? AND status = ? AND attempts = ?`)
    .bind(attempts, attemptedAt, attemptedAt, row.relay_delivery_id, row.relay_status, row.relay_attempts).run();
  if (!claim.meta.changes) return;
  let relayTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const signed = createSignedInternalLeadEnvelope(internalRelayPayload(payload.envelope), secret);
    const controller = new AbortController();
    relayTimeout = setTimeout(() => controller.abort(), 15_000);
    const response = await (dependencies.fetchImpl || fetch)(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Idempotency-Key": clean(row.relay_idempotency_key, 64),
      },
      body: JSON.stringify(signed),
      cache: "no-store",
      signal: controller.signal,
    });
    const acknowledgement = await response.text();
    if (!response.ok || acknowledgement.trim() !== "ok") {
      throw new Error(`Internal relay did not acknowledge delivery with HTTP ${response.status}.`);
    }
    const sentAt = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE public_plan_internal_relay_deliveries SET status = 'sent', provider_status = 'acknowledged',
        sent_at = ?, failed_at = '', last_error = '', updated_at = ? WHERE id = ? AND status = 'sending'`)
        .bind(sentAt, sentAt, row.relay_delivery_id),
      db.prepare(`INSERT OR IGNORE INTO public_plan_internal_relay_delivery_events
        (id, delivery_id, event_key, event_type, summary, occurred_at, created_at)
        VALUES (?, ?, ?, 'processor_acknowledged', 'Google Workspace accepted the internal lead relay.', ?, ?)`)
        .bind(crypto.randomUUID(), row.relay_delivery_id,
          `acknowledged:${String(row.relay_delivery_id)}:${attempts}`, sentAt, sentAt),
    ]);
  } catch (error) {
    const failedAt = new Date().toISOString();
    await db.prepare(`UPDATE public_plan_internal_relay_deliveries
      SET status = 'failed', failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending'`)
      .bind(failedAt, clean(error instanceof Error ? error.message : "Internal relay failed."),
        publicPlanDeliveryRetryAt(attempts), failedAt, row.relay_delivery_id).run();
  } finally {
    if (relayTimeout) clearTimeout(relayTimeout);
  }
}

export async function cleanupPublicPlanDeliveryObjects(
  dependencies: Pick<PublicPlanDeliveryDependencies, "db" | "bucket"> = {},
) {
  const db = dependencies.db || getD1();
  const bucket = dependencies.bucket || getCustomerProjectEvidenceBucket();
  return cleanupPublicPlanDeliveryObjectsWrite(db, bucket, {
    retryAt: publicPlanDeliveryRetryAt,
  });
}

export async function drainPublicPlanDeliveries(
  options: {
    intakeId?: string;
    limit?: number;
    createOpportunityFromLead: (payload: Record<string, unknown>) => Promise<unknown>;
    dispatchOpportunityNotifications?: (opportunityId: string) => Promise<unknown>;
  },
  dependencies: PublicPlanDeliveryDependencies = {},
) {
  const db = dependencies.db || getD1();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare(`UPDATE public_plan_lead_intakes SET status = 'failed', last_error = 'Recovered an interrupted intake attempt.',
      next_attempt_at = ?, updated_at = ? WHERE status = 'processing' AND last_attempt_at <= ?`).bind(now, now, stale),
    db.prepare(`UPDATE public_plan_customer_email_deliveries SET status = 'failed', last_error = 'Recovered an interrupted provider attempt.',
      next_attempt_at = ?, updated_at = ? WHERE status IN ('generating', 'sending') AND last_attempt_at <= ?`).bind(now, now, stale),
    db.prepare(`UPDATE public_plan_internal_relay_deliveries SET status = 'failed', last_error = 'Recovered an interrupted relay attempt.',
      next_attempt_at = ?, updated_at = ? WHERE status = 'sending' AND last_attempt_at <= ?`).bind(now, now, stale),
  ]);
  await cleanupPublicPlanDeliveryObjects(dependencies);
  const clauses = ["(intake.status IN ('pending', 'failed', 'completed'))"];
  const bindings: string[] = [];
  if (options.intakeId) {
    clauses.push("intake.id = ?");
    bindings.push(options.intakeId);
  }
  const rows = await db.prepare(`SELECT intake.*,
      customer.id customer_delivery_id, customer.status customer_status,
      customer.attempts customer_attempts, customer.idempotency_key customer_idempotency_key,
      customer.attachment_object_key, customer.attachment_filename, customer.attachment_sha256,
      relay.id relay_delivery_id, relay.status relay_status, relay.attempts relay_attempts,
      relay.idempotency_key relay_idempotency_key
    FROM public_plan_lead_intakes intake
    JOIN public_plan_customer_email_deliveries customer ON customer.intake_id = intake.id
    JOIN public_plan_internal_relay_deliveries relay ON relay.intake_id = intake.id
    WHERE ${clauses.join(" AND ")}
      AND ((intake.status != 'completed' AND (intake.next_attempt_at = '' OR intake.next_attempt_at <= ?))
        OR (customer.status IN ('pending', 'failed', 'provider_failed', 'waiting_for_channel')
          AND (customer.next_attempt_at = '' OR customer.next_attempt_at <= ?))
        OR (relay.status IN ('pending', 'failed', 'waiting_for_channel')
          AND (relay.next_attempt_at = '' OR relay.next_attempt_at <= ?)))
    ORDER BY intake.created_at LIMIT ?`).bind(...bindings, now, now, now, options.limit || 10).all<IntakeRow>();
  let processed = 0;
  for (const row of rows.results) {
    let payload;
    try {
      payload = await readPayload(row, dependencies.bucket || getCustomerProjectEvidenceBucket());
      const attempts = Number(row.attempts || 0) + 1;
      await db.prepare(`UPDATE public_plan_lead_intakes SET status = 'processing', attempts = ?,
        last_attempt_at = ?, next_attempt_at = '', updated_at = ? WHERE id = ? AND status != 'completed'`)
        .bind(attempts, now, now, row.id).run();
      const opportunityId = await ensureOpportunity(row, payload, options.createOpportunityFromLead, db);
      row.opportunity_id = opportunityId;
      await db.prepare(`UPDATE public_plan_lead_intakes SET status = 'pending', failed_at = '', last_error = '', updated_at = ?
        WHERE id = ? AND status = 'processing'`).bind(now, row.id).run();
    } catch (error) {
      const failedAt = new Date().toISOString();
      const attempts = Number(row.attempts || 0) + 1;
      await db.prepare(`UPDATE public_plan_lead_intakes SET status = 'failed', failed_at = ?, last_error = ?,
        next_attempt_at = ?, updated_at = ? WHERE id = ? AND status != 'completed'`)
        .bind(failedAt, clean(error instanceof Error ? error.message : "Intake processing failed."),
          publicPlanDeliveryRetryAt(attempts), failedAt, row.id).run();
      continue;
    }
    const deliveries = await Promise.allSettled([
      dispatchCustomer(row, payload, dependencies),
      dispatchInternalRelay(row, payload, dependencies),
      options.dispatchOpportunityNotifications
        ? options.dispatchOpportunityNotifications(String(row.opportunity_id || ""))
        : Promise.resolve(),
    ]);
    const customerFailure = deliveries[0].status === "rejected" ? deliveries[0].reason : null;
    if (customerFailure) {
      const failedAt = new Date().toISOString();
      const attempts = Number(row.customer_attempts || 0) + 1;
      await db.prepare(`UPDATE public_plan_customer_email_deliveries
        SET status = 'failed', attempts = CASE WHEN attempts < ? THEN ? ELSE attempts END,
          failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'generating', 'sending', 'failed', 'provider_failed', 'waiting_for_channel')`)
        .bind(attempts, attempts, failedAt,
          clean(customerFailure instanceof Error ? customerFailure.message : "Customer plan preparation failed."),
          publicPlanDeliveryRetryAt(attempts), failedAt, row.customer_delivery_id).run();
    }
    const relayFailure = deliveries[1].status === "rejected" ? deliveries[1].reason : null;
    if (relayFailure) {
      const failedAt = new Date().toISOString();
      const attempts = Number(row.relay_attempts || 0) + 1;
      await db.prepare(`UPDATE public_plan_internal_relay_deliveries
        SET status = 'failed', attempts = CASE WHEN attempts < ? THEN ? ELSE attempts END,
          failed_at = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'sending', 'failed', 'waiting_for_channel')`)
        .bind(attempts, attempts, failedAt,
          clean(relayFailure instanceof Error ? relayFailure.message : "Internal relay failed."),
          publicPlanDeliveryRetryAt(attempts), failedAt, row.relay_delivery_id).run();
    }
    processed += 1;
  }
  await cleanupPublicPlanDeliveryObjects(dependencies);
  return { processed };
}
