import { buildAcceptedInvoiceSnapshot, type AcceptedInvoiceDocumentSnapshot } from "./trade-accepted-invoice";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { reminderProviderFailureOutcome, type ReminderProviderMessage } from "./service-reminder-delivery";
import { acceptedInvoicePdfFilename, renderAcceptedInvoicePdf } from "./trade-accepted-invoice-pdf-server";
import type { ImmutableIssuedPdfReference } from "./trade-issued-document-store";

type Row = Record<string, unknown>;
type Submission = { status: string; provider: string; provider_message_id: string };
type Services = {
  renderPdf: typeof renderAcceptedInvoicePdf;
  storePdf: (invoiceId: string, bytes: Uint8Array) => Promise<ImmutableIssuedPdfReference>;
  readPdf: (invoiceId: string, reference: ImmutableIssuedPdfReference) => Promise<Uint8Array>;
  sendEmail: (ownerUid: string, message: ReminderProviderMessage, beforeSend: () => Promise<void>) => Promise<{ provider: string; providerMessageId: string }>;
};
const MAX_ATTEMPTS = 5, LEASE_MS = 10 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestKey = (invoiceId: string) => `accepted-invoice:${invoiceId}:email:1`;
const pdfIdentity = (invoiceId: string) => ({ kind: "invoice" as const, documentId: `accepted-${invoiceId}`, revision: 1 });

/** Add this statement to the same transaction that records the accepted invoice. */
export function acceptedInvoiceEmailDispatch(db: D1Database, invoiceId: string, now: string) {
  return db.prepare(`INSERT OR IGNORE INTO trade_crm_accepted_invoice_deliveries
    (invoice_id, firebase_uid, quote_link_id, recipient_email, idempotency_key, status, next_attempt_at, created_at, updated_at)
    SELECT invoice.id, invoice.firebase_uid, acceptance.quote_link_id,
      lower(trim(json_extract(version.document_snapshot_json, '$.acceptanceEmail'))), ?, 'queued', ?, ?, ?
    FROM trade_crm_accepted_invoices invoice
    JOIN trade_crm_quote_acceptances acceptance ON acceptance.id = invoice.acceptance_id
      AND acceptance.result_invoice_id = invoice.id AND acceptance.firebase_uid = invoice.firebase_uid
      AND acceptance.quote_version_id = invoice.quote_version_id AND acceptance.work_order_id = invoice.work_order_id
      AND acceptance.crm_customer_id = invoice.crm_customer_id AND acceptance.decision = 'accepted'
    JOIN trade_crm_quote_links link ON link.id = acceptance.quote_link_id
      AND link.firebase_uid = invoice.firebase_uid AND link.quote_version_id = invoice.quote_version_id
      AND link.work_order_id = invoice.work_order_id AND link.crm_customer_id = invoice.crm_customer_id
      AND link.token_issue = acceptance.token_issue AND link.status = 'accepted'
    JOIN trade_crm_quote_versions version ON version.id = invoice.quote_version_id
      AND version.quote_id = invoice.quote_id AND version.firebase_uid = invoice.firebase_uid
    WHERE invoice.id = ? AND invoice.status = 'issued' AND invoice.issue_blocker_code = ''
      AND json_valid(version.document_snapshot_json)
      AND coalesce(json_extract(version.document_snapshot_json, '$.acceptanceEmail'), '') <> ''`)
    .bind(requestKey(invoiceId), now, now, now, invoiceId);
}

export async function acceptedInvoiceEmailStatus(db: D1Database, ownerUid: string, invoiceId: string) {
  const row = await db.prepare(`SELECT status, attempts, next_attempt_at, error_code, submitted_at, recipient_email
    FROM trade_crm_accepted_invoice_deliveries WHERE invoice_id = ? AND firebase_uid = ?`).bind(invoiceId, ownerUid).first<Row>();
  return row ? { status: String(row.status), attempts: Number(row.attempts), nextAttemptAt: String(row.next_attempt_at),
    errorCode: String(row.error_code), submittedAt: String(row.submitted_at), recipientEmail: String(row.recipient_email) } : null;
}

/** Explicit owner retry of a definite failure; uncertain submissions stay blocked. */
export async function retryAcceptedInvoiceEmail(db: D1Database, ownerUid: string, invoiceId: string) {
  const row = await db.prepare(`SELECT * FROM trade_crm_accepted_invoice_deliveries WHERE invoice_id = ? AND firebase_uid = ?`)
    .bind(invoiceId, ownerUid).first<Row>();
  if (!row || row.status !== "failed" || row.idempotency_key !== requestKey(invoiceId)) throw new Error("ACCEPTED_INVOICE_RETRY_UNAVAILABLE");
  const proof = await journal(db, row);
  if (proof && proof.status !== "failed") throw new Error("ACCEPTED_INVOICE_RETRY_UNAVAILABLE");
  const invoice = await context(db, invoiceId);
  if (!invoice || invoice.firebase_uid !== ownerUid) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
  await verifiedSnapshot(invoice); await recipient(db, invoice);
  const now = new Date().toISOString();
  const updated = await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET status = 'queued', attempts = 0,
    next_attempt_at = ?, error_code = '', lease_token = '', lease_expires_at = '', updated_at = ?
    WHERE invoice_id = ? AND firebase_uid = ? AND status = 'failed'
      AND NOT EXISTS (SELECT 1 FROM trade_email_submissions submission WHERE submission.owner_uid = ?
        AND submission.request_key = ? AND submission.status <> 'failed')`)
    .bind(now, now, invoiceId, ownerUid, ownerUid, requestKey(invoiceId)).run();
  if (!updated.meta.changes) throw new Error("ACCEPTED_INVOICE_RETRY_UNAVAILABLE");
  return { invoiceId, status: "queued" as const, queuedAt: now };
}

async function context(db: D1Database, invoiceId: string) {
  return db.prepare(`SELECT invoice.*, delivery.recipient_email, delivery.quote_link_id,
      version.document_snapshot_json quote_snapshot_json, version.acceptance_email,
      work.source_type, detail.customer_source, detail.accepted_disclosure_sha256, detail.accepted_disclosure_snapshot,
      customer.email customer_email, account.invoice_payment_account_name, account.invoice_payment_bsb,
      account.invoice_payment_account_number
    FROM trade_crm_accepted_invoice_deliveries delivery
    JOIN trade_crm_accepted_invoices invoice ON invoice.id = delivery.invoice_id AND invoice.firebase_uid = delivery.firebase_uid
    JOIN trade_crm_quote_acceptances acceptance ON acceptance.id = invoice.acceptance_id
      AND acceptance.firebase_uid = invoice.firebase_uid AND acceptance.result_invoice_id = invoice.id
      AND acceptance.work_order_id = invoice.work_order_id AND acceptance.crm_customer_id = invoice.crm_customer_id
      AND acceptance.quote_id = invoice.quote_id AND acceptance.quote_version_id = invoice.quote_version_id
      AND acceptance.quote_link_id = delivery.quote_link_id AND acceptance.decision = 'accepted'
    JOIN trade_crm_quote_links link ON link.id = acceptance.quote_link_id AND link.firebase_uid = invoice.firebase_uid
      AND link.quote_id = invoice.quote_id AND link.quote_version_id = invoice.quote_version_id
      AND link.work_order_id = invoice.work_order_id AND link.crm_customer_id = invoice.crm_customer_id
      AND link.token_issue = acceptance.token_issue AND link.status = 'accepted'
    JOIN trade_crm_quote_versions version ON version.id = invoice.quote_version_id AND version.firebase_uid = invoice.firebase_uid
      AND version.quote_id = invoice.quote_id
    JOIN trade_work_orders work ON work.id = invoice.work_order_id AND work.firebase_uid = invoice.firebase_uid AND work.record_status = 'active'
    JOIN trade_crm_job_details detail ON detail.work_order_id = invoice.work_order_id AND detail.firebase_uid = invoice.firebase_uid
      AND detail.crm_customer_id = invoice.crm_customer_id AND detail.customer_source IN ('trade_owned', 'public_lead_released')
      AND detail.invoiced_value_cents = invoice.total_cents AND detail.paid_value_cents = 0 AND detail.invoice_status IN ('issued', 'exported', 'overdue')
    JOIN trade_crm_customers customer ON customer.id = invoice.crm_customer_id AND customer.firebase_uid = invoice.firebase_uid AND customer.record_status = 'active'
    JOIN trade_accounts account ON account.firebase_uid = invoice.firebase_uid AND account.partner_type = 'installer'
      AND ${verifiedTradeAccountPredicate("account")}
    WHERE delivery.invoice_id = ? AND invoice.status = 'issued' AND invoice.issue_blocker_code = ''
      AND NOT EXISTS (SELECT 1 FROM trade_crm_quick_invoices quick WHERE quick.firebase_uid = invoice.firebase_uid
        AND quick.work_order_id = invoice.work_order_id AND quick.status <> 'void')
      AND NOT EXISTS (SELECT 1 FROM trade_crm_accounting_documents accounting WHERE accounting.firebase_uid = invoice.firebase_uid
        AND accounting.work_order_id = invoice.work_order_id AND accounting.document_type = 'invoice'
        AND accounting.status NOT IN ('void', 'cancelled') AND accounting.commercial_handoff_id <> invoice.commercial_handoff_id)`)
    .bind(invoiceId).first<Row>();
}

async function verifiedSnapshot(row: Row): Promise<AcceptedInvoiceDocumentSnapshot> {
  try {
    const snapshot: AcceptedInvoiceDocumentSnapshot = JSON.parse(String(row.document_snapshot_json));
    const payment = snapshot.payment;
    if (!payment.available) throw new Error("ACCEPTED_INVOICE_PAYMENT_UNAVAILABLE");
    if (!String(row.invoice_payment_account_name || "").trim() || !String(row.invoice_payment_bsb || "").trim()
      || !String(row.invoice_payment_account_number || "").trim()) throw new Error("ACCEPTED_INVOICE_PAYMENT_UNAVAILABLE");
    if (payment.accountName !== String(row.invoice_payment_account_name).trim() || payment.bsb !== String(row.invoice_payment_bsb).trim()
      || payment.accountNumber !== String(row.invoice_payment_account_number).trim()) throw new Error("ACCEPTED_INVOICE_PAYMENT_CHANGED");
    const rebuilt = await buildAcceptedInvoiceSnapshot({ invoiceId: String(row.id), invoiceNumber: String(row.invoice_number),
      acceptanceId: String(row.acceptance_id), commercialHandoffId: String(row.commercial_handoff_id), quoteId: String(row.quote_id),
      quoteVersionId: String(row.quote_version_id), workOrderId: String(row.work_order_id), firebaseUid: String(row.firebase_uid),
      crmCustomerId: String(row.crm_customer_id), issuedAt: snapshot.invoice.issuedAt, dueAt: String(row.due_at),
      scope: snapshot.lines, totals: { subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents) },
      business: snapshot.business, customer: snapshot.customer, site: snapshot.site, work: snapshot.work, payment });
    if (rebuilt.documentSnapshotJson !== row.document_snapshot_json || rebuilt.sourceSnapshotSha256 !== row.source_snapshot_sha256
      || rebuilt.paymentSnapshotJson !== row.payment_snapshot_json) throw new Error("ACCEPTED_INVOICE_DOCUMENT_INVALID");
    return rebuilt.documentSnapshot;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ACCEPTED_INVOICE_PAYMENT_")) throw error;
    throw new Error("ACCEPTED_INVOICE_DOCUMENT_INVALID");
  }
}

async function recipient(db: D1Database, row: Row) {
  const email = String(row.recipient_email), quote: { acceptanceEmail?: string; quoteVersionId?: string; quoteId?: string } = JSON.parse(String(row.quote_snapshot_json));
  if (!EMAIL.test(email) || email.length > 254 || email !== String(quote.acceptanceEmail || "").trim().toLowerCase()
    || email !== String(row.acceptance_email || "").trim().toLowerCase()
    || quote.quoteVersionId !== row.quote_version_id || quote.quoteId !== row.quote_id) throw new Error("ACCEPTED_INVOICE_RECIPIENT_INVALID");
  if (row.source_type === "public_lead") {
    const disclosure: { contract?: string; customer?: { email?: string } } = JSON.parse(String(row.accepted_disclosure_snapshot));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(row.accepted_disclosure_snapshot)));
    const disclosureHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (row.customer_source !== "public_lead_released" || !/^[a-f0-9]{64}$/.test(String(row.accepted_disclosure_sha256))
      || disclosureHash !== row.accepted_disclosure_sha256
      || disclosure.contract !== "tlink-public-lead-accepted-disclosure-v1" || String(disclosure.customer?.email || "").trim().toLowerCase() !== email
      || String(row.customer_email).trim().toLowerCase() !== email) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
  } else {
    const allowed = await db.prepare(`SELECT 1 FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND lower(trim(email)) = ?
      UNION ALL SELECT 1 FROM trade_crm_customer_contacts WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' AND lower(trim(email)) = ? LIMIT 1`)
      .bind(row.crm_customer_id, row.firebase_uid, email, row.crm_customer_id, row.firebase_uid, email).first();
    if (!allowed) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
  }
  const optedOut = await db.prepare(`SELECT 1 FROM trade_crm_quote_deliveries WHERE firebase_uid = ? AND crm_customer_id = ?
    AND channel = 'email' AND status IN ('complained', 'opted_out') LIMIT 1`).bind(row.firebase_uid, row.crm_customer_id).first();
  if (optedOut) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
  return email;
}

async function defaults(db: D1Database): Promise<Services> {
  const [storage, email] = await Promise.all([import("./trade-issued-document-store"), import("./trade-email-server")]);
  return { renderPdf: renderAcceptedInvoicePdf,
    storePdf: (invoiceId, bytes) => storage.storeImmutableIssuedPdf({ ...pdfIdentity(invoiceId), bytes }),
    readPdf: (invoiceId, reference) => storage.readImmutableIssuedPdf(reference, pdfIdentity(invoiceId)),
    sendEmail: (ownerUid, message, beforeSend) => email.sendTradeCustomerEmail(ownerUid, "system:accepted-invoice", message, { db, beforeSend }),
  };
}

async function journal(db: D1Database, row: Row) {
  return db.prepare(`SELECT status, provider, provider_message_id FROM trade_email_submissions WHERE owner_uid = ? AND request_key = ?`)
    .bind(row.firebase_uid, row.idempotency_key).first<Submission>();
}

function retryAt(attempts: number, now: Date) {
  return attempts >= MAX_ATTEMPTS ? "" : new Date(now.getTime() + [5, 30, 120, 360][Math.max(0, attempts - 1)] * 60_000).toISOString();
}

async function recordAccepted(db: D1Database, row: Row, proof: { provider: string; providerMessageId: string }, now: string) {
  if (!proof.provider || !proof.providerMessageId) throw new Error("ACCEPTED_INVOICE_PROVIDER_RESULT_INVALID");
  await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET status = 'provider_accepted', provider = ?, provider_message_id = ?,
    submitted_at = ?, error_code = '', next_attempt_at = '', lease_token = '', lease_expires_at = '', updated_at = ?
    WHERE invoice_id = ? AND firebase_uid = ? AND status = 'sending' AND lease_token = ?`)
    .bind(proof.provider, proof.providerMessageId, now, now, row.invoice_id, row.firebase_uid, row.lease_token).run();
}

/** Background-safe, bounded drain; the shared transport journal prevents duplicate submissions. */
export async function drainAcceptedInvoiceEmails(options: { db: D1Database; invoiceId?: string; now?: Date; limit?: number; services?: Services }) {
  const { db } = options, now = options.now ?? new Date(), stamp = now.toISOString();
  const limit = Math.min(25, Math.max(1, Math.floor(options.limit ?? 10)));
  const expired = await db.prepare(`SELECT * FROM trade_crm_accepted_invoice_deliveries WHERE status = 'sending'
    AND lease_expires_at <= ? AND (? = '' OR invoice_id = ?) LIMIT ?`).bind(stamp, options.invoiceId || "", options.invoiceId || "", limit).all<Row>();
  for (const row of expired.results) {
    const proof = await journal(db, row);
    if (proof?.status === "accepted") { await recordAccepted(db, row, { provider: proof.provider, providerMessageId: proof.provider_message_id }, stamp); continue; }
    const uncertain = proof?.status === "sending" || proof?.status === "uncertain";
    await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET status = ?, error_code = ?, next_attempt_at = ?,
      lease_token = '', lease_expires_at = '', updated_at = ? WHERE invoice_id = ? AND status = 'sending' AND lease_token = ?`)
      .bind(uncertain ? "reconciliation_required" : "failed", uncertain ? "EMAIL_SEND_UNCERTAIN" : "ACCEPTED_INVOICE_INTERRUPTED",
        uncertain || Number(row.attempts) >= MAX_ATTEMPTS ? "" : stamp, stamp, row.invoice_id, row.lease_token).run();
  }
  const rows = await db.prepare(`SELECT * FROM trade_crm_accepted_invoice_deliveries WHERE status IN ('queued', 'failed')
    AND next_attempt_at <> '' AND next_attempt_at <= ? AND attempts < ? AND (? = '' OR invoice_id = ?) ORDER BY created_at LIMIT ?`)
    .bind(stamp, MAX_ATTEMPTS, options.invoiceId || "", options.invoiceId || "", limit).all<Row>();
  const services = rows.results.length ? options.services ?? await defaults(db) : null;
  for (const candidate of rows.results) {
    if (!services) break;
    const lease = crypto.randomUUID(), until = new Date(now.getTime() + LEASE_MS).toISOString();
    const claim = await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET status = 'sending', attempts = attempts + 1,
      lease_token = ?, lease_expires_at = ?, updated_at = ? WHERE invoice_id = ? AND firebase_uid = ?
      AND status IN ('queued', 'failed') AND attempts = ? AND next_attempt_at <> '' AND next_attempt_at <= ?`)
      .bind(lease, until, stamp, candidate.invoice_id, candidate.firebase_uid, candidate.attempts, stamp).run();
    if (!claim.meta.changes) continue;
    const row: Row = { ...candidate, lease_token: lease, attempts: Number(candidate.attempts) + 1 };
    let transportStarted = false;
    try {
      const invoiceId = String(row.invoice_id), ownerUid = String(row.firebase_uid);
      if (row.idempotency_key !== requestKey(invoiceId)) throw new Error("ACCEPTED_INVOICE_DOCUMENT_INVALID");
      const current = await context(db, invoiceId);
      if (!current) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
      const snapshot = await verifiedSnapshot(current), email = await recipient(db, current);
      let reference: ImmutableIssuedPdfReference;
      if (row.pdf_object_key) reference = { objectKey: String(row.pdf_object_key), sha256: String(row.pdf_sha256), sizeBytes: Number(row.pdf_size_bytes) };
      else {
        reference = await services.storePdf(invoiceId, await services.renderPdf(snapshot));
        const saved = await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET pdf_object_key = ?, pdf_sha256 = ?, pdf_size_bytes = ?
          WHERE invoice_id = ? AND firebase_uid = ? AND status = 'sending' AND lease_token = ? AND pdf_object_key = ''`)
          .bind(reference.objectKey, reference.sha256, reference.sizeBytes, invoiceId, ownerUid, lease).run();
        if (!saved.meta.changes) throw new Error("ACCEPTED_INVOICE_LEASE_LOST");
      }
      const bytes = await services.readPdf(invoiceId, reference);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const message: ReminderProviderMessage = { channel: "email", recipient: email,
        subject: `${snapshot.business.name} | Invoice ${snapshot.invoice.number}`,
        body: `Thank you for accepting your quote. Your invoice ${snapshot.invoice.number} is attached as a PDF.\n\nAmount due: AUD ${(snapshot.totals.totalCents / 100).toFixed(2)}\nDue: ${snapshot.invoice.dueAt}\n\nPlease contact ${snapshot.business.name} if you have any questions.`,
        replyTo: EMAIL.test(snapshot.business.email) ? snapshot.business.email : undefined,
        idempotencyKey: requestKey(invoiceId), callbackUrl: "", messageType: "accepted_invoice",
        attachments: [{ filename: acceptedInvoicePdfFilename(snapshot), content: btoa(binary), contentType: "application/pdf" }] };
      const beforeSend = async () => {
        const held = await db.prepare(`SELECT 1 FROM trade_crm_accepted_invoice_deliveries WHERE invoice_id = ? AND firebase_uid = ?
          AND status = 'sending' AND lease_token = ? AND lease_expires_at > ?`).bind(invoiceId, ownerUid, lease, new Date().toISOString()).first();
        const fresh = held ? await context(db, invoiceId) : null;
        if (!fresh || fresh.document_snapshot_json !== current.document_snapshot_json) throw new Error("ACCEPTED_INVOICE_ACCESS_ENDED");
        await verifiedSnapshot(fresh); await recipient(db, fresh);
      };
      await beforeSend(); transportStarted = true;
      const sent = await services.sendEmail(ownerUid, message, beforeSend);
      await recordAccepted(db, row, sent, stamp);
    } catch (error) {
      const proof = await journal(db, row);
      if (proof?.status === "accepted") { await recordAccepted(db, row, { provider: proof.provider, providerMessageId: proof.provider_message_id }, stamp); continue; }
      const code = error instanceof Error ? error.message : "ACCEPTED_INVOICE_DELIVERY_FAILED";
      const uncertain = proof?.status === "uncertain" || proof?.status === "sending"
        || reminderProviderFailureOutcome(error) === "indeterminate" || (transportStarted && !proof);
      const terminal = /^ACCEPTED_INVOICE_(ACCESS_ENDED|DOCUMENT_INVALID|RECIPIENT_INVALID|PAYMENT_|LEASE_LOST)/.test(code)
        || ["EMAIL_REQUEST_CONFLICT", "EMAIL_CONNECTION_CHANGED", "EMAIL_MESSAGE_TOO_LARGE"].includes(code);
      await db.prepare(`UPDATE trade_crm_accepted_invoice_deliveries SET status = ?, error_code = ?, next_attempt_at = ?,
        lease_token = '', lease_expires_at = '', updated_at = ? WHERE invoice_id = ? AND firebase_uid = ? AND status = 'sending' AND lease_token = ?`)
        .bind(uncertain ? "reconciliation_required" : "failed", /^[A-Z0-9_]{1,100}$/.test(code) ? code : "ACCEPTED_INVOICE_DELIVERY_FAILED",
          uncertain || terminal ? "" : retryAt(Number(row.attempts), now), stamp, row.invoice_id, row.firebase_uid, lease).run();
    }
  }
  return { processed: rows.results.length };
}
