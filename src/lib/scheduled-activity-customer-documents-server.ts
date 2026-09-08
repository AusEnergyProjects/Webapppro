import { getD1 } from "../../db";
import {
  activityConsumerDocuments,
  type ActivityConsumerDocument,
} from "./trade-activity-forms-library.ts";
import { readActivityConsumerDocument } from "./trade-activity-forms-server.ts";
import {
  ReminderProviderDeliveryError,
  reminderProviderFailureOutcome,
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "./service-reminder-delivery";
import {
  scheduledActivityCustomerDocumentReceiptSummary,
} from "./scheduled-activity-customer-document-receipt.ts";

export {
  parseScheduledActivityCustomerDocumentReceipt,
  scheduledActivityCustomerDocumentReceiptSummary,
} from "./scheduled-activity-customer-document-receipt.ts";

type Row = Record<string, unknown>;

export type ScheduledActivityCustomerDocumentActivity = {
  activityTemplateId: string;
  variantId?: string;
};

export type ScheduledActivityCustomerDocumentReceipt = {
  requested: boolean;
  status: "not_required" | "provider_accepted" | "failed" | "unavailable";
  canRetry: boolean;
  message: string;
  acceptedAt: string;
  documentIds: string[];
  documentSha256Set: string[];
};

type LoadedDocument = ActivityConsumerDocument & {
  bytes: Uint8Array;
  fileName: string;
  sha256: string;
};

const ACCEPTED_DELIVERY_STATES = new Set(["provider_accepted", "sent", "delivered"]);
const RESEND_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const RECIPIENT_SUPPRESSION_MESSAGE = "Customer document email is blocked for this address after a complaint or provider suppression. Correct the customer's email in the CRM before trying again.";

function cleanFileName(value: string) {
  const base = value.replace(/\s*\(PDF\)\s*$/i, "").replace(/[^a-z0-9 ._-]+/gi, " ").replace(/\s+/g, " ").trim();
  return `${base || "Customer document"}.pdf`;
}

function customerName(row: Row) {
  return String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "there");
}

function headerText(value: unknown) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: unknown) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  return sha256(new TextEncoder().encode(value));
}

async function idempotencyKey(appointmentId: string, recipient: string, packSha256: string, generation: number) {
  return sha256Text(`tlink-scheduled-activity-documents|${appointmentId}|${recipient}|${packSha256}|${generation}`);
}

export function scheduledActivityCustomerDocumentBindings(
  activities: readonly ScheduledActivityCustomerDocumentActivity[],
) {
  return [...new Map(activities.map((activity) => [
    `${activity.activityTemplateId}:${activity.variantId || ""}`,
    { activityTemplateId: activity.activityTemplateId, variantId: activity.variantId || "" },
  ])).values()].sort((left, right) => `${left.activityTemplateId}:${left.variantId}`.localeCompare(`${right.activityTemplateId}:${right.variantId}`));
}

function exactDocuments(activities: readonly ScheduledActivityCustomerDocumentActivity[]) {
  const documents = scheduledActivityCustomerDocumentBindings(activities).flatMap((activity) =>
    activityConsumerDocuments(activity.activityTemplateId, activity.variantId));
  return [...new Map(documents.map((document) => [document.key, document])).values()];
}

function stringList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch { return []; }
}

async function recipientSuppression(
  db: ReturnType<typeof getD1>,
  ownerUid: string,
  recipientEmailSha256: string,
) {
  return db.prepare(`SELECT id, status FROM trade_activity_customer_document_deliveries
    WHERE firebase_uid = ? AND recipient_email_sha256 = ? AND status IN ('complained','suppressed')
    ORDER BY updated_at DESC LIMIT 1`)
    .bind(ownerUid, recipientEmailSha256).first<{ id: string; status: string }>();
}

function suppressedReceipt(documents: readonly ActivityConsumerDocument[], documentSha256Set: string[] = []) {
  return {
    requested: true,
    status: "unavailable" as const,
    canRetry: false,
    message: RECIPIENT_SUPPRESSION_MESSAGE,
    acceptedAt: "",
    documentIds: documents.map((document) => document.key),
    documentSha256Set,
  };
}

async function loadDocument(document: ActivityConsumerDocument, origin: string, fetchImpl: typeof fetch): Promise<LoadedDocument> {
  let bytes: Uint8Array;
  let fileName = cleanFileName(document.title);
  if (document.url === "/api/trade-activity-forms?consumerDocument=veu-rights-v1") {
    const generated = await readActivityConsumerDocument("veu-rights-v1");
    bytes = generated.bytes;
    fileName = generated.fileName;
  } else {
    const url = new URL(document.url, origin);
    if (url.protocol !== "https:") throw new Error("ACTIVITY_CUSTOMER_DOCUMENT_URL_INVALID");
    const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error("ACTIVITY_CUSTOMER_DOCUMENT_UNAVAILABLE");
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.length < 5 || bytes.length > 8 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("ACTIVITY_CUSTOMER_DOCUMENT_INVALID");
  }
  return { ...document, bytes, fileName, sha256: await sha256(bytes) };
}

async function recordEvent(input: { ownerUid: string; workOrderId: string; eventType: string; summary: string; createdAt: string; id?: string }) {
  await getD1().prepare(`INSERT OR IGNORE INTO trade_work_order_events
    (id, work_order_id, firebase_uid, event_type, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(input.id || crypto.randomUUID(), input.workOrderId, input.ownerUid, input.eventType, input.summary, input.createdAt).run();
}

async function matchingAcceptedDelivery(input: {
  ownerUid: string;
  workOrderId: string;
  appointmentId: string;
  recipientEmailSha256: string;
  packSha256: string;
}) {
  const row = await getD1().prepare(`SELECT id, provider_message_id, status, accepted_at, document_ids, document_sha256_set
    FROM trade_activity_customer_document_deliveries
    WHERE work_order_id = ? AND appointment_id = ? AND firebase_uid = ?
      AND recipient_email_sha256 = ? AND pack_sha256 = ?
    ORDER BY delivery_generation DESC LIMIT 1`)
    .bind(input.workOrderId, input.appointmentId, input.ownerUid, input.recipientEmailSha256, input.packSha256).first<Row>();
  return row && ACCEPTED_DELIVERY_STATES.has(String(row.status || "")) ? row : null;
}

export async function selectedScheduledActivityCustomerDocumentAppointment(input: {
  ownerUid: string;
  workOrderId: string;
  visibleAssigneeMemberId?: string;
  now?: string;
}) {
  const requestedNow = String(input.now || "");
  const now = Number.isFinite(Date.parse(requestedNow))
    ? new Date(requestedNow).toISOString()
    : new Date().toISOString();
  const visibleAssigneeMemberId = String(input.visibleAssigneeMemberId || "");
  const appointment = await getD1().prepare(`SELECT id FROM trade_crm_appointments
    WHERE work_order_id = ? AND firebase_uid = ? AND status = 'scheduled'
      AND (? = '' OR assignee_member_id = ?)
    ORDER BY
      CASE WHEN starts_at >= ? THEN 0 ELSE 1 END ASC,
      CASE WHEN starts_at >= ? THEN starts_at END ASC,
      CASE WHEN starts_at < ? THEN starts_at END DESC,
      created_at DESC
    LIMIT 1`)
    .bind(input.workOrderId, input.ownerUid, visibleAssigneeMemberId, visibleAssigneeMemberId,
      now, now, now).first<{ id: string }>();
  return String(appointment?.id || "");
}

export async function currentScheduledActivityCustomerDocumentDelivery(input: {
  ownerUid: string;
  workOrderId: string;
  appointmentId: string;
  recipientEmail: string;
  activities: readonly ScheduledActivityCustomerDocumentActivity[];
}) {
  const bindings = scheduledActivityCustomerDocumentBindings(input.activities);
  const documents = exactDocuments(bindings);
  const recipient = String(input.recipientEmail || "").trim().toLowerCase();
  if (!input.appointmentId || !bindings.length || !documents.length
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  const recipientEmailSha256 = await sha256Text(recipient);
  return getD1().prepare(`SELECT id, appointment_id, status, provider_status,
      document_ids, accepted_at, sent_at, delivered_at, failed_at, last_error, updated_at
    FROM trade_activity_customer_document_deliveries
    WHERE work_order_id = ? AND appointment_id = ? AND firebase_uid = ?
      AND recipient_email_sha256 = ? AND activity_bindings = ? AND document_ids = ?
    ORDER BY created_at DESC, delivery_generation DESC LIMIT 1`)
    .bind(input.workOrderId, input.appointmentId, input.ownerUid, recipientEmailSha256,
      JSON.stringify(bindings), JSON.stringify(documents.map((document) => document.key)))
    .first<Row>();
}

export async function sendScheduledActivityCustomerDocuments(input: {
  appointmentId: string;
  workOrderId: string;
  ownerUid: string;
  origin: string;
  activities: readonly ScheduledActivityCustomerDocumentActivity[];
  fetchImpl?: typeof fetch;
}): Promise<ScheduledActivityCustomerDocumentReceipt> {
  const bindings = scheduledActivityCustomerDocumentBindings(input.activities);
  const documents = exactDocuments(bindings);
  if (!documents.length) return {
    requested: false,
    status: "not_required",
    canRetry: false,
    message: "No booking-time customer documents apply to the selected work.",
    acceptedAt: "",
    documentIds: [],
    documentSha256Set: [],
  };
  const configuration = serviceReminderProviderConfiguration();
  const db = getD1();
  const row = await db.prepare(`SELECT a.id appointment_id,
      w.work_number, customer.customer_type, customer.first_name, customer.last_name,
      customer.business_name, customer.email customer_email, trade.business_name trade_business_name
    FROM trade_crm_appointments a
    JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    JOIN trade_crm_job_details detail ON detail.work_order_id = w.id AND detail.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers customer ON customer.id = detail.crm_customer_id
      AND customer.firebase_uid = w.firebase_uid AND customer.record_status = 'active'
    JOIN trade_accounts trade ON trade.firebase_uid = w.firebase_uid
    WHERE a.id = ? AND a.work_order_id = ? AND a.firebase_uid = ? AND a.status = 'scheduled'
      AND w.record_status = 'active' LIMIT 1`)
    .bind(input.appointmentId, input.workOrderId, input.ownerUid).first<Row>();
  const recipient = String(row?.customer_email || "").trim().toLowerCase();
  if (!row || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return {
    requested: true,
    status: "unavailable",
    canRetry: true,
    message: "The job was saved, but the selected customer does not have a valid email address for required documents.",
    acceptedAt: "",
    documentIds: documents.map((document) => document.key),
    documentSha256Set: [],
  };
  let deliveryId = "";
  let providerAccepted = false;
  let providerRequestStarted = false;
  try {
    const recipientEmailSha256 = await sha256Text(recipient);
    const suppressed = await recipientSuppression(db, input.ownerUid, recipientEmailSha256);
    if (suppressed) return suppressedReceipt(documents);
    const loaded = await Promise.all(documents.map((document) => loadDocument(document, input.origin, input.fetchImpl || fetch)));
    const documentIds = loaded.map((document) => document.key);
    const documentSha256Set = loaded.map((document) => document.sha256);
    const packSha256 = await sha256Text([
      JSON.stringify(bindings),
      ...loaded.map((document) => `${document.key}:${document.sha256}`).sort(),
    ].join("|"));
    const accepted = await matchingAcceptedDelivery({
      ownerUid: input.ownerUid,
      workOrderId: input.workOrderId,
      appointmentId: input.appointmentId,
      recipientEmailSha256,
      packSha256,
    });
    if (accepted) return {
      requested: true,
      status: "provider_accepted",
      canRetry: false,
      message: `${loaded.length} required customer document${loaded.length === 1 ? " was" : "s were"} already accepted for email delivery.`,
      acceptedAt: String(accepted.accepted_at || ""),
      documentIds: stringList(accepted.document_ids),
      documentSha256Set: stringList(accepted.document_sha256_set),
    };

    let latest = await db.prepare(`SELECT id, status, provider_status, delivery_generation, idempotency_key, created_at, updated_at,
        accepted_at, document_ids, document_sha256_set
      FROM trade_activity_customer_document_deliveries
      WHERE work_order_id = ? AND appointment_id = ? AND firebase_uid = ?
        AND recipient_email_sha256 = ? AND pack_sha256 = ?
      ORDER BY delivery_generation DESC LIMIT 1`)
      .bind(input.workOrderId, input.appointmentId, input.ownerUid, recipientEmailSha256, packSha256).first<Row>();
    const latestStatus = String(latest?.status || "");
    const reusePending = latestStatus === "queued" || latestStatus === "sending";
    const generation = reusePending ? Number(latest?.delivery_generation || 1) : Number(latest?.delivery_generation || 0) + 1;
    const proposedDeliveryId = reusePending ? String(latest?.id || "") : crypto.randomUUID();
    const proposedIdempotencyKey = reusePending
      ? String(latest?.idempotency_key || "")
      : await idempotencyKey(input.appointmentId, recipient, packSha256, generation);
    if (!proposedDeliveryId || !proposedIdempotencyKey) throw new Error("ACTIVITY_CUSTOMER_DOCUMENT_DELIVERY_INVALID");
    if (!reusePending) {
      const queuedAt = new Date().toISOString();
      await db.prepare(`INSERT OR IGNORE INTO trade_activity_customer_document_deliveries
        (id, work_order_id, appointment_id, firebase_uid, recipient_email_sha256,
         activity_bindings, document_ids, document_sha256_set, pack_sha256,
         delivery_generation, retry_of_delivery_id, provider, provider_message_id,
         provider_status, idempotency_key, status, accepted_at, sent_at,
         delivered_at, failed_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resend', '', '', ?, 'queued', '', '', '', '', '', ?, ?)`)
        .bind(proposedDeliveryId, input.workOrderId, input.appointmentId, input.ownerUid, recipientEmailSha256,
          JSON.stringify(bindings), JSON.stringify(documentIds), JSON.stringify(documentSha256Set), packSha256,
          generation, String(latest?.id || ""), proposedIdempotencyKey, queuedAt, queuedAt).run();
      latest = await db.prepare(`SELECT id, status, provider_status, delivery_generation, idempotency_key, created_at, updated_at,
          accepted_at, document_ids, document_sha256_set
        FROM trade_activity_customer_document_deliveries
        WHERE work_order_id = ? AND appointment_id = ? AND firebase_uid = ?
          AND recipient_email_sha256 = ? AND pack_sha256 = ? AND delivery_generation = ?
        LIMIT 1`)
        .bind(input.workOrderId, input.appointmentId, input.ownerUid, recipientEmailSha256, packSha256, generation).first<Row>();
    }
    deliveryId = String(latest?.id || proposedDeliveryId);
    const deliveryIdempotencyKey = String(latest?.idempotency_key || proposedIdempotencyKey);
    const storedStatus = String(latest?.status || "queued");
    const storedProviderStatus = String(latest?.provider_status || "");
    if (ACCEPTED_DELIVERY_STATES.has(storedStatus)) return {
      requested: true,
      status: "provider_accepted",
      canRetry: false,
      message: `${loaded.length} required customer document${loaded.length === 1 ? " was" : "s were"} already accepted for email delivery.`,
      acceptedAt: String(latest?.accepted_at || ""),
      documentIds: stringList(latest?.document_ids),
      documentSha256Set: stringList(latest?.document_sha256_set),
    };
    const claimAt = new Date().toISOString();
    const staleBefore = Date.now() - 10 * 60 * 1000;
    const storedCreatedAtMs = Date.parse(String(latest?.created_at || ""));
    const storedUpdatedAt = String(latest?.updated_at || "");
    const storedUpdatedAtMs = Date.parse(storedUpdatedAt);
    const outcomePending = storedStatus === "sending" && storedProviderStatus === "outcome_pending";
    const sendingAge = Date.now() - storedCreatedAtMs;
    if (storedStatus === "sending" && (!Number.isFinite(storedCreatedAtMs) || sendingAge < 0
      || sendingAge >= RESEND_IDEMPOTENCY_RETENTION_MS)) {
      const message = Number.isFinite(storedCreatedAtMs) && sendingAge >= RESEND_IDEMPOTENCY_RETENTION_MS
        ? "This email delivery outcome is more than 24 hours old and cannot be retried safely. Ask an administrator to reconcile the Resend delivery record, or correct the customer's email in the CRM before starting a new send."
        : "This email delivery attempt time cannot be verified, so it cannot be retried safely. Ask an administrator to reconcile the Resend delivery record, or correct the customer's email in the CRM before starting a new send.";
      await db.prepare(`UPDATE trade_activity_customer_document_deliveries
        SET provider_status = 'reconciliation_required', last_error = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'sending' AND created_at = ?`)
        .bind(message, claimAt, deliveryId, input.ownerUid, String(latest?.created_at || "")).run();
      return {
        requested: true,
        status: "unavailable",
        canRetry: false,
        message,
        acceptedAt: "",
        documentIds: stringList(latest?.document_ids),
        documentSha256Set: stringList(latest?.document_sha256_set),
      };
    }
    const staleSending = storedStatus === "sending"
      && Number.isFinite(storedUpdatedAtMs)
      && storedUpdatedAtMs <= staleBefore;
    const claim = staleSending || outcomePending
      ? await db.prepare(`UPDATE trade_activity_customer_document_deliveries
          SET provider_status = '', last_error = '', updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'sending' AND provider_status = ? AND updated_at = ?`)
        .bind(claimAt, deliveryId, input.ownerUid, storedProviderStatus, storedUpdatedAt).run()
      : await db.prepare(`UPDATE trade_activity_customer_document_deliveries
          SET status = 'sending', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'queued'`)
        .bind(claimAt, deliveryId, input.ownerUid).run();
    if (Number(claim.meta.changes || 0) !== 1) return {
      requested: true,
      status: "unavailable",
      canRetry: true,
      message: "The job was saved and customer document delivery is already in progress.",
      acceptedAt: "",
      documentIds,
      documentSha256Set,
    };

    const dispatchAt = new Date().toISOString();
    const dispatch = await db.prepare(`UPDATE trade_activity_customer_document_deliveries
      SET provider_status = 'dispatching', updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = 'sending' AND updated_at = ?
        AND NOT EXISTS (
          SELECT 1 FROM trade_activity_customer_document_deliveries blocked
          WHERE blocked.firebase_uid = ? AND blocked.recipient_email_sha256 = ?
            AND blocked.status IN ('complained','suppressed')
        )`)
      .bind(dispatchAt, deliveryId, input.ownerUid, claimAt, input.ownerUid, recipientEmailSha256).run();
    if (Number(dispatch.meta.changes || 0) !== 1) {
      const blocked = await recipientSuppression(db, input.ownerUid, recipientEmailSha256);
      if (blocked) {
        const blockedAt = new Date().toISOString();
        await db.prepare(`UPDATE trade_activity_customer_document_deliveries
          SET status = 'suppressed', provider_status = 'recipient_suppressed',
            failed_at = CASE WHEN failed_at = '' THEN ? ELSE failed_at END,
            last_error = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status IN ('queued','sending')`)
          .bind(blockedAt, RECIPIENT_SUPPRESSION_MESSAGE, blockedAt, deliveryId, input.ownerUid).run();
        return suppressedReceipt(loaded, documentSha256Set);
      }
      return {
        requested: true,
        status: "unavailable",
        canRetry: true,
        message: "The job was saved and customer document delivery is already in progress.",
        acceptedAt: "",
        documentIds,
        documentSha256Set,
      };
    }

    const businessName = headerText(row.trade_business_name || "Your trade professional");
    const workNumber = headerText(row.work_number);
    const addressee = customerName(row);
    const titles = loaded.map((document) => document.title.replace(/\s*\(PDF\)\s*$/i, ""));
    const body = `Hi ${addressee},\n\n${businessName} has scheduled your job ${workNumber}. The attached documents apply to the selected program activity. Please read them before agreeing to the upgrade.\n\nAttached:\n${titles.map((title) => `- ${title}`).join("\n")}\n\nKeep this email with your job records.`;
    const html = `<p>Hi ${escapeHtml(addressee)},</p><p><strong>${escapeHtml(businessName)}</strong> has scheduled your job <strong>${escapeHtml(workNumber)}</strong>. The attached documents apply to the selected program activity. Please read them before agreeing to the upgrade.</p><p><strong>Attached</strong></p><ul>${titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul><p>Keep this email with your job records.</p>`;
    if (!configuration.email.configured) throw new Error("ACTIVITY_CUSTOMER_DOCUMENT_EMAIL_NOT_CONFIGURED");
    providerRequestStarted = true;
    const providerResult = await sendServiceReminderProviderMessage({
      channel: "email",
      recipient,
      subject: `${businessName} sent your required activity documents`,
      body,
      html,
      idempotencyKey: deliveryIdempotencyKey,
      messageType: "tlink_activity_customer_documents",
      attachments: loaded.map((document) => ({
        filename: document.fileName,
        content: bytesToBase64(document.bytes),
        contentType: "application/pdf",
      })),
      callbackUrl: new URL("/api/service-reminder-provider-events/resend", input.origin).toString(),
    }, { fetchImpl: (input.fetchImpl || fetch) });
    if (providerResult.provider !== "resend" || !providerResult.providerMessageId) {
      throw new ReminderProviderDeliveryError("indeterminate", "ACTIVITY_CUSTOMER_DOCUMENT_PROVIDER_BINDING_INVALID");
    }
    providerAccepted = true;
    const acceptedAt = new Date().toISOString();
    const receiptSummary = scheduledActivityCustomerDocumentReceiptSummary({
      deliveryId,
      providerMessageId: providerResult.providerMessageId,
      acceptedAt,
      recipient,
      appointmentId: input.appointmentId,
      documentIds,
      documentSha256Set,
    });
    const [acceptance] = await db.batch([
      db.prepare(`UPDATE trade_activity_customer_document_deliveries
        SET provider_message_id = ?, provider_status = ?, status = 'provider_accepted',
          accepted_at = ?, sent_at = ?, failed_at = '', last_error = '', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'sending'`)
        .bind(providerResult.providerMessageId, providerResult.providerStatus, acceptedAt, acceptedAt, acceptedAt, deliveryId, input.ownerUid),
      db.prepare(`INSERT OR IGNORE INTO trade_activity_customer_document_delivery_events
        (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
        SELECT ?, id, ?, 'provider_accepted', ?, 'Resend accepted the exact customer document pack.', ?, ?
        FROM trade_activity_customer_document_deliveries
        WHERE id = ? AND firebase_uid = ? AND status = 'provider_accepted' AND provider_message_id = ?`)
        .bind(`activity-doc-accepted:${deliveryId}`, `accepted:${providerResult.providerMessageId}`,
          providerResult.providerStatus, acceptedAt, acceptedAt, deliveryId, input.ownerUid, providerResult.providerMessageId),
      db.prepare(`INSERT OR IGNORE INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        SELECT ?, work_order_id, firebase_uid, 'customer_documents_provider_accepted', ?, ?
        FROM trade_activity_customer_document_deliveries
        WHERE id = ? AND firebase_uid = ? AND status = 'provider_accepted' AND provider_message_id = ?`)
        .bind(`activity-doc-receipt:${deliveryId}`, receiptSummary, acceptedAt,
          deliveryId, input.ownerUid, providerResult.providerMessageId),
    ]);
    if (Number(acceptance.meta.changes || 0) !== 1) {
      const blocked = await recipientSuppression(db, input.ownerUid, recipientEmailSha256);
      if (blocked) {
        await db.batch([
          db.prepare(`UPDATE trade_activity_customer_document_deliveries
            SET provider_message_id = CASE WHEN provider_message_id = '' THEN ? ELSE provider_message_id END,
              last_error = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND status IN ('complained','suppressed')`)
            .bind(providerResult.providerMessageId,
              "The provider accepted this request after the recipient was suppressed; no compliance receipt was issued.",
              acceptedAt, deliveryId, input.ownerUid),
          db.prepare(`INSERT OR IGNORE INTO trade_activity_customer_document_delivery_events
            (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
            VALUES (?, ?, ?, 'provider_accepted_after_suppression', ?, 'Provider acceptance arrived after recipient suppression; no compliance receipt was issued.', ?, ?)`)
            .bind(`activity-doc-suppressed-acceptance:${deliveryId}`, deliveryId,
              `suppressed-acceptance:${providerResult.providerMessageId}`, providerResult.providerStatus, acceptedAt, acceptedAt),
        ]);
        await recordEvent({
          ownerUid: input.ownerUid,
          workOrderId: input.workOrderId,
          eventType: "customer_documents_provider_accepted_after_suppression",
          summary: "The provider accepted a customer document request after the recipient was suppressed. No customer document compliance receipt was issued.",
          createdAt: acceptedAt,
          id: `activity-doc-suppressed-work-event:${deliveryId}`,
        });
        return suppressedReceipt(loaded, documentSha256Set);
      }
      throw new ReminderProviderDeliveryError("indeterminate", "ACTIVITY_CUSTOMER_DOCUMENT_ACCEPTANCE_STATE_CHANGED");
    }
    return {
      requested: true,
      status: "provider_accepted",
      canRetry: false,
      message: `${loaded.length} required customer document${loaded.length === 1 ? " was" : "s were"} accepted for email delivery.`,
      acceptedAt,
      documentIds,
      documentSha256Set,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const recipientEmailSha256 = await sha256Text(recipient);
    const suppressed = deliveryId
      ? await recipientSuppression(db, input.ownerUid, recipientEmailSha256).catch(() => null)
      : null;
    if (suppressed) return suppressedReceipt(documents);
    const receiptPersistencePending = providerAccepted;
    const providerOutcomePending = providerRequestStarted && !providerAccepted
      && reminderProviderFailureOutcome(error) === "indeterminate";
    const deliveryPending = receiptPersistencePending || providerOutcomePending;
    if (deliveryId && deliveryPending) {
      await db.prepare(`UPDATE trade_activity_customer_document_deliveries
        SET provider_status = 'outcome_pending',
          last_error = 'Email provider outcome is not confirmed; retry must reuse this delivery request.', updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND status = 'sending'`)
        .bind(failedAt, deliveryId, input.ownerUid).run().catch(() => undefined);
    }
    const failureMessage = error instanceof Error && error.message === "ACTIVITY_CUSTOMER_DOCUMENT_EMAIL_NOT_CONFIGURED"
      ? "Required customer document email delivery is not configured."
      : "Email provider did not accept the exact customer document pack.";
    if (deliveryId && !deliveryPending) {
      await db.batch([
        db.prepare(`UPDATE trade_activity_customer_document_deliveries
          SET status = 'failed', provider_status = 'send_failed', failed_at = ?,
            last_error = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND status = 'sending'`)
          .bind(failedAt, failureMessage, failedAt, deliveryId, input.ownerUid),
        db.prepare(`INSERT OR IGNORE INTO trade_activity_customer_document_delivery_events
          (id, delivery_id, provider_event_key, event_type, provider_status, summary, occurred_at, created_at)
          VALUES (?, ?, ?, 'send_failed', 'send_failed', 'Customer document email was not accepted by the provider.', ?, ?)`)
          .bind(crypto.randomUUID(), deliveryId, `send-failed:${deliveryId}`, failedAt, failedAt),
      ]).catch(() => undefined);
    }
    await recordEvent({
      ownerUid: input.ownerUid,
      workOrderId: input.workOrderId,
      eventType: receiptPersistencePending
        ? "customer_documents_receipt_persistence_pending"
        : providerOutcomePending
          ? "customer_documents_provider_outcome_pending"
          : "customer_documents_email_failed",
      summary: receiptPersistencePending
        ? "The email provider accepted the required customer documents, but the delivery receipt could not be saved. Retry while online before customer agreement."
        : providerOutcomePending
          ? "The customer document request may have reached the email provider, but its outcome could not be confirmed. Retry while online to reconcile the same delivery request before customer agreement."
          : "Required customer documents were not accepted for email delivery. Retry before customer agreement.",
      createdAt: failedAt,
    }).catch(() => undefined);
    return {
      requested: true,
      status: deliveryPending ? "unavailable" : "failed",
      canRetry: true,
      message: receiptPersistencePending
        ? "The job was saved and the email provider accepted the required documents, but delivery confirmation is still pending. Retry while online before customer agreement."
        : providerOutcomePending
          ? "The job was saved, but the email provider outcome is not confirmed. Retry while online to reconcile the same delivery request before customer agreement."
          : error instanceof Error && error.message === "ACTIVITY_CUSTOMER_DOCUMENT_EMAIL_NOT_CONFIGURED"
            ? "The job was saved, but customer document email delivery is not configured."
            : "The job was saved, but the required customer documents were not accepted for email delivery.",
      acceptedAt: "",
      documentIds: documents.map((document) => document.key),
      documentSha256Set: [],
    };
  }
}
