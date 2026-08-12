import type { ReminderProviderMessage } from "./service-reminder-delivery.ts";
import {
  boundedTradeQuoteDeliveryFailure,
  TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS,
  tradeQuoteDeliveryLeaseUntil,
  tradeQuoteDeliveryPresentation,
  tradeQuoteDeliveryPublicOrigin,
  tradeQuoteDeliveryRetryAt,
} from "./trade-quote-delivery-policy.mjs";

type Row = Record<string, unknown>;
type SendEmail = (message: ReminderProviderMessage) => Promise<{
  provider: string;
  providerMessageId: string;
  providerStatus: string;
}>;

type DrainOptions = {
  db: D1Database;
  deliveryId?: string;
  now?: Date;
  limit?: number;
  emailConfigured?: boolean;
  sendEmail?: SendEmail;
  prepareMessage?: (row: Row) => Promise<ReminderProviderMessage>;
  loadContext?: (deliveryId: string) => Promise<Row | null>;
};

const CALLBACK_PATH = "/api/service-reminder-provider-events/resend";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function boundedLimit(value: number, maximum = 25) {
  return Math.max(1, Math.min(maximum, Math.floor(Number(value) || 10)));
}

export async function tradeQuoteRecipientEmailSha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordEvent(
  db: D1Database,
  deliveryId: string,
  eventType: string,
  summary: string,
  evidenceKey: string,
  now: string,
) {
  await db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events
    (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid,
     event_type, actor_type, summary, evidence_key, occurred_at)
    SELECT ?, delivery.quote_link_id, link.quote_id, delivery.quote_version_id,
      delivery.work_order_id, delivery.firebase_uid, ?, 'system', ?, ?, ?
    FROM trade_crm_quote_deliveries delivery
    JOIN trade_crm_quote_links link ON link.id = delivery.quote_link_id
    WHERE delivery.id = ?`)
    .bind(crypto.randomUUID(), eventType, summary, evidenceKey, now, deliveryId)
    .run();
}

async function recoverInterrupted(db: D1Database, now: Date) {
  const current = now.toISOString();
  await db.prepare(`UPDATE trade_crm_quote_deliveries
      SET status = 'failed', next_attempt_at = ?, lease_expires_at = '',
        failure_code = 'QUOTE_DELIVERY_INTERRUPTED',
        last_error = 'Delivery was interrupted and will be retried.', updated_at = ?
      WHERE status = 'sending' AND lease_expires_at <> '' AND lease_expires_at <= ?
        AND attempts < ?`)
      .bind(current, current, current, TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS)
      .run();
  await db.prepare(`UPDATE trade_crm_quote_deliveries
      SET status = 'failed', next_attempt_at = '', lease_expires_at = '',
        failure_code = 'QUOTE_DELIVERY_FINAL_ATTEMPT_INTERRUPTED',
        last_error = 'Delivery needs attention.', updated_at = ?
      WHERE status = 'sending' AND lease_expires_at <> '' AND lease_expires_at <= ?
        AND attempts >= ?`)
      .bind(current, current, TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS)
      .run();
}

async function observedDeliveryOutcome(
  db: D1Database,
  deliveryId: string,
  ownerUid: string,
) {
  const observed = await db.prepare(`SELECT status, attempts, next_attempt_at,
      failure_code FROM trade_crm_quote_deliveries
    WHERE id = ? AND firebase_uid = ? LIMIT 1`)
    .bind(deliveryId, ownerUid).first<Row>();
  if (!observed) {
    return {
      outcome: "missing",
      status: "missing",
      attempts: 0,
      nextAttemptAt: "",
      lostOwnership: true,
    };
  }
  return {
    outcome: String(observed.status || "unknown"),
    status: String(observed.status || "unknown"),
    attempts: Number(observed.attempts || 0),
    nextAttemptAt: String(observed.next_attempt_at || ""),
    code: String(observed.failure_code || ""),
    lostOwnership: true,
  };
}

async function deliveryContext(db: D1Database, deliveryId: string) {
  return db.prepare(`SELECT delivery.*, link.quote_id, link.token_issue, link.token_hash,
      link.encrypted_token, link.status link_status, link.expires_at,
      version.version_number, version.status version_status, version.acceptance_email,
      version.document_snapshot_json, version.issued_pdf_object_key,
      version.issued_pdf_sha256, version.issued_pdf_size_bytes,
      quote.quote_number, quote.current_version_number, quote.status quote_status,
      work.record_status work_status, work.source_type,
      detail.customer_source, detail.accepted_disclosure_sha256,
      detail.accepted_disclosure_snapshot, customer.email customer_email,
      customer.record_status customer_status
    FROM trade_crm_quote_deliveries delivery
    JOIN trade_crm_quote_links link
      ON link.id = delivery.quote_link_id
      AND link.firebase_uid = delivery.firebase_uid
      AND link.quote_version_id = delivery.quote_version_id
      AND link.work_order_id = delivery.work_order_id
      AND link.crm_customer_id = delivery.crm_customer_id
    JOIN trade_crm_quote_versions version
      ON version.id = delivery.quote_version_id
      AND version.firebase_uid = delivery.firebase_uid
      AND version.quote_id = link.quote_id
    JOIN trade_crm_quotes quote
      ON quote.id = version.quote_id
      AND quote.firebase_uid = delivery.firebase_uid
      AND quote.work_order_id = delivery.work_order_id
    JOIN trade_work_orders work
      ON work.id = delivery.work_order_id AND work.firebase_uid = delivery.firebase_uid
    JOIN trade_crm_job_details detail
      ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      AND detail.crm_customer_id = delivery.crm_customer_id
    JOIN trade_crm_customers customer
      ON customer.id = delivery.crm_customer_id AND customer.firebase_uid = delivery.firebase_uid
    WHERE delivery.id = ? LIMIT 1`)
    .bind(deliveryId)
    .first<Row>();
}

async function authoritativeRecipient(db: D1Database, row: Row) {
  const email = String(row.acceptance_email || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("QUOTE_DELIVERY_RECIPIENT_INVALID");
  if (await tradeQuoteRecipientEmailSha256(email) !== String(row.recipient_email_sha256 || "")) {
    throw new Error("QUOTE_DELIVERY_RECIPIENT_CHANGED");
  }
  if (String(row.source_type || "") === "public_lead") {
    let acceptedDisclosure: Row = {};
    try { acceptedDisclosure = JSON.parse(String(row.accepted_disclosure_snapshot || "{}")) as Row; }
    catch { throw new Error("QUOTE_DELIVERY_ACCESS_ENDED"); }
    if (
      String(row.customer_source || "") !== "public_lead_released"
      || !/^[0-9a-f]{64}$/.test(String(row.accepted_disclosure_sha256 || ""))
      || acceptedDisclosure.contract !== "tlink-public-lead-accepted-disclosure-v1"
      || String((acceptedDisclosure.customer as Row | undefined)?.email || "").trim().toLowerCase() !== email
      || String(row.customer_email || "").trim().toLowerCase() !== email
    ) throw new Error("QUOTE_DELIVERY_ACCESS_ENDED");
    return email;
  }
  const authorised = await db.prepare(`SELECT 1 authorised
    FROM trade_crm_customers
    WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
      AND lower(trim(email)) = ?
    UNION ALL
    SELECT 1 FROM trade_crm_customer_contacts
    WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active'
      AND lower(trim(email)) = ? LIMIT 1`)
    .bind(row.crm_customer_id, row.firebase_uid, email,
      row.crm_customer_id, row.firebase_uid, email)
    .first<Row>();
  if (!authorised) throw new Error("QUOTE_DELIVERY_ACCESS_ENDED");
  return email;
}

function validateContext(row: Row, now: Date) {
  const initialIdempotencyKey = `quote:${String(row.quote_version_id)}:${Number(row.token_issue)}:email:initial`;
  const deliveryGeneration = Number(row.delivery_generation || 1);
  const expectedIdempotencyKey = deliveryGeneration === 2
    ? `${initialIdempotencyKey}:retry:2`
    : initialIdempotencyKey;
  if (
    row.work_status !== "active"
    || row.customer_status !== "active"
    || row.version_status !== "issued"
    || row.quote_status !== "issued"
    || Number(row.current_version_number) !== Number(row.version_number)
    || row.link_status !== "active"
    || !String(row.token_hash || "")
    || Date.parse(String(row.expires_at || "")) <= now.getTime()
    || String(row.idempotency_key || "") !== expectedIdempotencyKey
    || (deliveryGeneration === 2 && !String(row.retry_of_delivery_id || ""))
    || ![1, 2].includes(deliveryGeneration)
  ) throw new Error("QUOTE_DELIVERY_REVISION_INACTIVE");
}

async function defaultPrepareMessage(db: D1Database, row: Row, now: Date) {
  const [emailModule, issuedPdfModule, linkModule, pdfModule, reviewModule] = await Promise.all([
    import("./trade-quote-email.ts"),
    import("./trade-quote-issued-pdf-server.ts"),
    import("./trade-quote-links.ts"),
    import("./trade-quote-pdf-server.ts"),
    import("./trade-quote-review-server.ts"),
  ]);
  const { buildTradeQuoteEmail, tradeQuoteEmailContentSha256 } = emailModule;
  const { issuedTradeQuotePdf } = issuedPdfModule;
  const { quoteReviewPath, recoverQuoteLinkSecret } = linkModule;
  const { tradeQuotePdfBase64, tradeQuotePdfFilename } = pdfModule;
  const { parseTradeQuoteDocumentSnapshot } = reviewModule;
  validateContext(row, now);
  const recipient = await authoritativeRecipient(db, row);
  const optedOut = await db.prepare(`SELECT 1 stopped FROM trade_crm_quote_deliveries
    WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email'
      AND status IN ('complained', 'opted_out') LIMIT 1`)
    .bind(row.firebase_uid, row.crm_customer_id).first<Row>();
  if (optedOut) throw new Error("QUOTE_DELIVERY_OPTED_OUT");

  const snapshot = parseTradeQuoteDocumentSnapshot(row.document_snapshot_json);
  if (
    !snapshot
    || snapshot.quoteVersionId !== String(row.quote_version_id)
    || snapshot.quoteId !== String(row.quote_id)
    || snapshot.work.id !== String(row.work_order_id)
    || snapshot.acceptanceEmail.trim().toLowerCase() !== recipient
  ) throw new Error("QUOTE_DELIVERY_DOCUMENT_INVALID");

  const origin = tradeQuoteDeliveryPublicOrigin(row.public_origin);
  const secret = await recoverQuoteLinkSecret(
    String(row.encrypted_token),
    String(row.quote_link_id),
    Number(row.token_issue),
    String(row.token_hash),
  );
  const shareUrl = `${origin}${quoteReviewPath(String(row.quote_link_id), secret)}`;
  const content = buildTradeQuoteEmail({ snapshot, shareUrl, expiresAt: String(row.expires_at) });
  const issuedPdf = await issuedTradeQuotePdf({
    ownerUid: String(row.firebase_uid),
    quoteVersionId: String(row.quote_version_id),
    snapshot,
    origin,
  });
  const filename = tradeQuotePdfFilename(snapshot);
  const contentHash = await tradeQuoteEmailContentSha256(content);
  if (
    content.subject !== String(row.subject_snapshot || "")
    || contentHash !== String(row.email_content_sha256 || "")
    || filename !== String(row.attachment_filename || "")
    || issuedPdf.reference.sha256 !== String(row.attachment_sha256 || "")
  ) throw new Error("QUOTE_DELIVERY_CONTENT_CHANGED");
  return {
    channel: "email" as const,
    recipient,
    subject: content.subject,
    body: content.text,
    html: content.html,
    replyTo: content.replyTo,
    attachments: [{
      filename,
      content: tradeQuotePdfBase64(issuedPdf.bytes),
      contentType: "application/pdf",
    }],
    idempotencyKey: String(row.provider_idempotency_key || row.idempotency_key),
    callbackUrl: `${origin}${CALLBACK_PATH}`,
    messageType: "trade_quote",
  } satisfies ReminderProviderMessage;
}

async function finishFailure(
  db: D1Database,
  row: Row,
  attempts: number,
  error: unknown,
  now: Date,
) {
  const current = now.toISOString();
  const code = boundedTradeQuoteDeliveryFailure(error);
  const retryAt = tradeQuoteDeliveryRetryAt(attempts, now.getTime());
  const failed = await db.prepare(`UPDATE trade_crm_quote_deliveries
    SET status = 'failed', next_attempt_at = ?, lease_expires_at = '',
      failure_code = ?, last_error = ?, updated_at = ?
    WHERE id = ? AND firebase_uid = ? AND status = 'sending' AND attempts = ?`)
    .bind(retryAt, code,
      retryAt ? "Delivery was not accepted and will retry automatically." : "Delivery needs attention.",
      current, row.id, row.firebase_uid, attempts)
    .run();
  if (Number(failed.meta.changes || 0) !== 1) {
    return observedDeliveryOutcome(db, String(row.id), String(row.firebase_uid));
  }
  await recordEvent(db, String(row.id), retryAt ? "delivery_retrying" : "delivery_failed",
    retryAt ? "Quote email delivery will retry automatically." : "Quote email delivery needs attention.",
    `quote-delivery:${String(row.id)}:attempt:${attempts}:${code}`, current);
  return { outcome: retryAt ? "retrying" : "failed", status: "failed", code, attempts, nextAttemptAt: retryAt };
}

export async function drainTradeQuoteDeliveries(options: DrainOptions) {
  const db = options.db;
  const now = options.now || new Date();
  const current = now.toISOString();
  const provider = options.emailConfigured === undefined || !options.sendEmail
    ? await import("./service-reminder-delivery.ts")
    : null;
  const configured = options.emailConfigured
    ?? provider?.serviceReminderProviderConfiguration().email.configured
    ?? false;
  const sendEmail: SendEmail = options.sendEmail
    || provider?.sendServiceReminderProviderMessage
    || (async () => { throw new Error("QUOTE_DELIVERY_PROVIDER_UNAVAILABLE"); });
  await recoverInterrupted(db, now);
  const exactId = String(options.deliveryId || "").trim();
  const rows = await db.prepare(`SELECT id, firebase_uid, status, attempts,
      next_attempt_at, created_at
    FROM trade_crm_quote_deliveries
    WHERE channel = 'email'
      AND recipient_email_sha256 <> ''
      AND queued_at <> ''
      AND attempts < ?
      AND status IN ('queued', 'failed', 'waiting_for_channel')
      AND (next_attempt_at = '' OR next_attempt_at <= ?)
      AND (? = '' OR id = ?)
    ORDER BY created_at, id LIMIT ?`)
    .bind(TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS, current, exactId, exactId,
      boundedLimit(options.limit || (exactId ? 1 : 10)))
    .all<Row>();
  const outcomes: Row[] = [];

  for (const candidate of rows.results) {
    if (!configured) {
      const attempts = Number(candidate.attempts || 0) + 1;
      const retryAt = tradeQuoteDeliveryRetryAt(attempts, now.getTime());
      const status = retryAt ? "waiting_for_channel" : "failed";
      const deferred = await db.prepare(`UPDATE trade_crm_quote_deliveries
        SET status = ?, attempts = ?, next_attempt_at = ?, lease_expires_at = '',
          failure_code = 'QUOTE_DELIVERY_CHANNEL_UNAVAILABLE',
          last_error = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = ? AND attempts = ?`)
        .bind(status, attempts, retryAt,
          retryAt ? "Email delivery is temporarily unavailable." : "Delivery needs attention.",
          current, candidate.id, candidate.firebase_uid, candidate.status,
          Number(candidate.attempts || 0)).run();
      if (Number(deferred.meta.changes || 0) === 1) {
        if (!retryAt) {
          await recordEvent(db, String(candidate.id), "delivery_failed",
            "Quote email delivery needs attention.",
            `quote-delivery:${String(candidate.id)}:channel-unavailable:${attempts}`, current);
        }
        outcomes.push({
          deliveryId: candidate.id,
          outcome: retryAt ? "waiting_for_channel" : "failed",
          status,
          attempts,
          nextAttemptAt: retryAt,
        });
      } else {
        outcomes.push({
          deliveryId: candidate.id,
          ...(await observedDeliveryOutcome(db, String(candidate.id), String(candidate.firebase_uid))),
        });
      }
      continue;
    }

    const attempts = Number(candidate.attempts || 0) + 1;
    const claim = await db.prepare(`UPDATE trade_crm_quote_deliveries
      SET status = 'sending', attempts = ?, next_attempt_at = '',
        last_attempt_at = ?, lease_expires_at = ?, failure_code = '',
        last_error = '', updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = ? AND attempts = ?
        AND (next_attempt_at = '' OR next_attempt_at <= ?)`)
      .bind(attempts, current, tradeQuoteDeliveryLeaseUntil(now.getTime()), current,
        candidate.id, candidate.firebase_uid, candidate.status,
        Number(candidate.attempts || 0), current).run();
    if (Number(claim.meta.changes || 0) !== 1) continue;

    const row = options.loadContext
      ? await options.loadContext(String(candidate.id))
      : await deliveryContext(db, String(candidate.id));
    if (!row) {
      outcomes.push(await finishFailure(db, candidate, attempts,
        new Error("QUOTE_DELIVERY_CONTEXT_MISSING"), now));
      continue;
    }
    try {
      const message = options.prepareMessage
        ? await options.prepareMessage(row)
        : await defaultPrepareMessage(db, row, now);
      const sent = await sendEmail(message);
      const accepted = await db.prepare(`UPDATE trade_crm_quote_deliveries
        SET status = 'provider_accepted', provider = ?, provider_message_id = ?,
          provider_status = ?, next_attempt_at = '', lease_expires_at = '',
          failure_code = '', last_error = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'sending' AND attempts = ?`)
        .bind(sent.provider, sent.providerMessageId, sent.providerStatus, current,
          row.id, row.firebase_uid, attempts).run();
      if (Number(accepted.meta.changes || 0) === 1) {
        await recordEvent(db, String(row.id), "provider_accepted",
          "Email accepted for delivery.",
          `provider_accepted:${String(row.idempotency_key)}`, current);
        outcomes.push({ deliveryId: row.id, outcome: "provider_accepted", status: "provider_accepted", attempts, nextAttemptAt: "" });
      } else {
        outcomes.push({ deliveryId: row.id, ...(await observedDeliveryOutcome(db, String(row.id), String(row.firebase_uid))) });
      }
    } catch (error) {
      outcomes.push({ deliveryId: row.id, ...(await finishFailure(db, row, attempts, error, now)) });
      console.error("Trade quote delivery attempt failed", {
        code: boundedTradeQuoteDeliveryFailure(error),
        deliveryId: String(row.id),
        attempt: attempts,
      });
    }
  }
  return {
    attempted: outcomes.length,
    outcomes,
    configured,
  };
}

export async function tradeQuoteDeliveryStatus(
  db: D1Database,
  deliveryId: string,
  ownerUid: string,
) {
  const row = await db.prepare(`SELECT id, status, attempts, next_attempt_at,
      failure_code, delivery_generation, retry_of_delivery_id, updated_at FROM trade_crm_quote_deliveries
    WHERE id = ? AND firebase_uid = ? LIMIT 1`)
    .bind(deliveryId, ownerUid).first<Row>();
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status),
    attempts: Number(row.attempts || 0),
    generation: Number(row.delivery_generation || 1),
    retryOfDeliveryId: String(row.retry_of_delivery_id || ""),
    nextAttemptAt: String(row.next_attempt_at || ""),
    updatedAt: String(row.updated_at || ""),
    presentation: tradeQuoteDeliveryPresentation(String(row.status), Number(row.attempts), String(row.next_attempt_at || ""), String(row.failure_code || ""), Number(row.delivery_generation || 1)),
  };
}

export async function latestTradeQuoteDeliveryStatus(
  db: D1Database,
  quoteVersionId: string,
  ownerUid: string,
) {
  const row = await db.prepare(`SELECT id FROM trade_crm_quote_deliveries
    WHERE quote_version_id = ? AND firebase_uid = ? AND channel = 'email'
    ORDER BY delivery_generation DESC, created_at DESC, id DESC LIMIT 1`)
    .bind(quoteVersionId, ownerUid).first<Row>();
  return row
    ? tradeQuoteDeliveryStatus(db, String(row.id), ownerUid)
    : null;
}
