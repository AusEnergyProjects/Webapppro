import { getD1 } from "../../db";
import { createAdminNotification } from "@/lib/admin-notifications";

export type TradePaymentProvider = "stripe" | "square";
export type TradePaymentStatus = "processing" | "paid" | "failed";

type ReconciliationInput = {
  provider: TradePaymentProvider;
  eventId: string;
  eventType: string;
  connectedAccountId: string;
  externalId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  workOrderReference?: string;
  status: TradePaymentStatus;
  amountCents: number;
  currency: string;
  occurredAt: string;
  failureCode?: string;
};

type PaymentLinkRow = {
  id: string;
  commercial_handoff_id: string;
  commercial_reference: string;
  purpose: string;
  work_order_id: string;
  firebase_uid: string;
  amount_cents: number;
  status: string;
  failure_code: string;
  business_name: string;
  work_number: string;
  quick_invoice_id: string;
};

export type TradePaymentReconciliation = {
  matched: boolean;
  duplicate?: boolean;
  status?: string;
  paymentLinkId?: string;
};

function cleanReference(value: string, max = 180) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validMoney(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 100_000_000_00 ? value : 0;
}

async function matchingPaymentLink(input: ReconciliationInput) {
  const db = getD1();
  const identifierColumn = input.provider === "stripe" ? "l.external_id" : "l.provider_order_id";
  const identifier = input.provider === "stripe" ? cleanReference(input.externalId || "") : cleanReference(input.providerOrderId || "");
  if (!identifier || !input.connectedAccountId) return undefined;
  const link = await db.prepare(`SELECT l.id, l.commercial_handoff_id, l.commercial_reference, l.purpose,
      l.work_order_id, l.firebase_uid, l.amount_cents, l.status, l.failure_code,
      a.business_name, w.work_number, COALESCE(q.id, '') quick_invoice_id
    FROM trade_crm_payment_links l
    JOIN trade_crm_integrations i ON i.firebase_uid = l.firebase_uid AND i.provider = l.provider
    JOIN trade_accounts a ON a.firebase_uid = l.firebase_uid
    JOIN trade_work_orders w ON w.id = l.work_order_id AND w.firebase_uid = l.firebase_uid
    LEFT JOIN trade_crm_quick_invoices q ON q.firebase_uid = l.firebase_uid AND q.work_order_id = l.work_order_id
      AND q.invoice_number = l.commercial_reference AND l.purpose = 'invoice'
    WHERE l.provider = ? AND ${identifierColumn} = ? AND i.external_account_id = ?
    LIMIT 1`).bind(input.provider, identifier, cleanReference(input.connectedAccountId)).first<PaymentLinkRow>();
  if (link && input.workOrderReference && cleanReference(input.workOrderReference) !== link.work_order_id) return undefined;
  return link;
}

async function notifyPaymentResult(input: ReconciliationInput, link: PaymentLinkRow, status: string, failureCode: string) {
  const providerLabel = input.provider === "stripe" ? "Stripe" : "Square";
  const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(validMoney(input.amountCents) / 100);
  if (status === "paid") {
    await createAdminNotification({
      eventKey: `trade-payment-paid:${input.provider}:${input.eventId}`,
      eventType: "trade.payment_received",
      category: "billing",
      priority: "normal",
      title: "Installer payment received",
      summary: `${link.business_name.slice(0, 160)} received ${amount} through ${providerLabel} for job ${link.work_number.slice(0, 80)}.`,
      entityType: "trade_crm_payment_link",
      entityId: link.id,
      actorType: "system",
      requiresAction: false,
      metadata: { provider: input.provider, workOrderId: link.work_order_id },
    });
    return;
  }
  if (status === "review_required") {
    const summary = failureCode === "duplicate_commercial_payment"
      ? `${providerLabel} reported an additional payment for job ${link.work_number.slice(0, 80)}. Check both provider payments and refund any duplicate. No job balance was changed.`
      : failureCode === "superseded_attempt_paid"
        ? `${providerLabel} reported a payment against a replaced checkout for job ${link.work_number.slice(0, 80)}. Check the provider before taking action. No job balance was changed.`
        : `${providerLabel} reported a payment that did not match the expected AUD amount for job ${link.work_number.slice(0, 80)}. No job balance was changed.`;
    await createAdminNotification({
      eventKey: `trade-payment-review:${input.provider}:${input.eventId}`,
      eventType: "trade.payment_review_required",
      category: "billing",
      priority: "urgent",
      title: "Installer payment needs review",
      summary,
      entityType: "trade_crm_payment_link",
      entityId: link.id,
      actorType: "system",
      requiresAction: true,
      metadata: { provider: input.provider, workOrderId: link.work_order_id, reason: failureCode, expectedAmountCents: link.amount_cents, reportedAmountCents: input.amountCents, currency: input.currency },
    });
    return;
  }
  if (status === "failed") {
    await createAdminNotification({
      eventKey: `trade-payment-failed:${input.provider}:${input.eventId}`,
      eventType: "trade.payment_failed",
      category: "billing",
      priority: "high",
      title: "Installer payment failed",
      summary: `${providerLabel} reported a failed payment for job ${link.work_number.slice(0, 80)}. The installer can issue a fresh payment request if required.`,
      entityType: "trade_crm_payment_link",
      entityId: link.id,
      actorType: "system",
      requiresAction: true,
      metadata: { provider: input.provider, workOrderId: link.work_order_id },
    });
  }
}

export async function reconcileTradePayment(input: ReconciliationInput): Promise<TradePaymentReconciliation> {
  const eventId = cleanReference(input.eventId);
  const eventType = cleanReference(input.eventType, 120);
  if (!eventId || !eventType) return { matched: false };
  const db = getD1();
  const auditId = `${input.provider}:${eventId}`;
  const existing = await db.prepare("SELECT id FROM trade_crm_payment_events WHERE id = ?")
    .bind(auditId).first<{ id: string }>();
  if (existing) return { matched: true, duplicate: true };
  const link = await matchingPaymentLink(input);
  if (!link) return { matched: false };

  const reportedAmount = validMoney(input.amountCents);
  const currency = cleanReference(input.currency, 8).toUpperCase();
  const related = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN id <> ? AND status = 'paid' THEN 1 ELSE 0 END), 0) other_paid,
      COALESCE(SUM(CASE WHEN id <> ? AND status IN ('creating', 'open', 'processing') THEN 1 ELSE 0 END), 0) other_collectible
    FROM trade_crm_payment_links
    WHERE firebase_uid = ? AND commercial_reference = ? AND purpose = ?`)
    .bind(link.id, link.id, link.firebase_uid, link.commercial_reference, link.purpose)
    .first<{ other_paid: number; other_collectible: number }>();
  const amountMismatch = input.status === "paid" && (currency !== "AUD" || reportedAmount !== Number(link.amount_cents));
  const otherPaid = Number(related?.other_paid || 0) > 0;
  const otherCollectible = Number(related?.other_collectible || 0) > 0;
  let reviewCode = amountMismatch ? "amount_or_currency_mismatch" : "";
  if (input.status === "paid" && otherPaid) reviewCode = "duplicate_commercial_payment";
  else if (input.status === "paid" && (link.status === "superseded" || (link.status === "failed" && otherCollectible))) {
    reviewCode = "superseded_attempt_paid";
  }
  let status = reviewCode ? "review_required" : input.status;
  if (link.status === "paid" && status !== "paid") status = "paid";
  if (link.status === "review_required") {
    status = "review_required";
    reviewCode ||= link.failure_code || "existing_review_required";
  }
  if (link.status === "superseded" && input.status !== "paid") status = "superseded";
  if (link.status === "failed" && input.status !== "paid") status = "failed";
  const becamePaid = status === "paid" && link.status !== "paid";
  const receivedAt = new Date().toISOString();
  const occurredAt = cleanReference(input.occurredAt, 60) || receivedAt;
  const providerPaymentId = cleanReference(input.providerPaymentId || "");
  const failureCode = status === "failed"
    ? input.status === "failed" ? cleanReference(input.failureCode || "provider_failed", 80) : link.failure_code || "provider_failed"
    : status === "review_required" ? reviewCode : "";
  const paidAt = status === "paid" ? occurredAt : "";
  const statements = [
    db.prepare(`INSERT INTO trade_crm_payment_events
      (id, provider, event_id, event_type, payment_link_id, work_order_id, firebase_uid,
       status, amount_cents, provider_payment_id, occurred_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(auditId, input.provider, eventId, eventType, link.id, link.work_order_id, link.firebase_uid,
        status, reportedAmount, providerPaymentId, occurredAt, receivedAt),
    db.prepare(`UPDATE trade_crm_payment_links SET status = ?, provider_payment_id = ?,
      paid_amount_cents = CASE WHEN ? = 'paid' THEN ? ELSE paid_amount_cents END,
      paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
      failure_code = CASE WHEN ? = 'superseded' THEN failure_code ELSE ? END,
      last_event_id = ?, last_event_at = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ?`)
      .bind(status, providerPaymentId, status, reportedAmount, status, paidAt, status, failureCode,
        eventId, occurredAt, receivedAt, link.id, link.firebase_uid),
  ];
  if (becamePaid) {
    if (link.purpose === "deposit" && link.commercial_handoff_id) statements.push(
      db.prepare(`UPDATE trade_crm_commercial_handovers SET status = 'deposit_paid', updated_at = ?
        WHERE id = ? AND firebase_uid = ?`).bind(receivedAt, link.commercial_handoff_id, link.firebase_uid));
    if (link.purpose === "invoice" && link.quick_invoice_id) statements.push(
      db.prepare(`INSERT OR IGNORE INTO trade_crm_invoice_payment_allocations
        (id, invoice_id, work_order_id, firebase_uid, payment_link_id, provider, provider_payment_id,
         amount_cents, allocated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), link.quick_invoice_id, link.work_order_id, link.firebase_uid, link.id, input.provider,
          providerPaymentId, reportedAmount, occurredAt, receivedAt),
      db.prepare(`UPDATE trade_crm_quick_invoices SET status = 'paid', updated_at = ?
        WHERE id = ? AND firebase_uid = ?`).bind(receivedAt, link.quick_invoice_id, link.firebase_uid));
    statements.push(
      db.prepare(`UPDATE trade_crm_job_details SET
        paid_value_cents = CASE WHEN invoiced_value_cents > 0
          THEN MIN(invoiced_value_cents, paid_value_cents + ?)
          ELSE paid_value_cents + ? END,
        invoice_status = CASE
          WHEN invoiced_value_cents > 0 AND paid_value_cents + ? >= invoiced_value_cents THEN 'paid'
          ELSE 'part_paid' END,
        updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(reportedAmount, reportedAmount, reportedAmount, receivedAt, link.work_order_id, link.firebase_uid),
      db.prepare(`UPDATE trade_work_orders SET stage = CASE
          WHEN (SELECT invoice_status FROM trade_crm_job_details WHERE work_order_id = ? AND firebase_uid = ?) = 'paid'
          THEN 'paid' ELSE stage END, updated_at = ? WHERE id = ? AND firebase_uid = ?`)
        .bind(link.work_order_id, link.firebase_uid, receivedAt, link.work_order_id, link.firebase_uid),
      db.prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'payment_received', 'Provider-verified payment added to the job ledger.', ?)`)
        .bind(crypto.randomUUID(), link.work_order_id, link.firebase_uid, receivedAt),
    );
  } else if ((status === "failed" && link.status !== "failed")
    || (status === "review_required" && (link.status !== "review_required" || failureCode !== link.failure_code))) {
    statements.push(db.prepare(`INSERT INTO trade_work_order_events
      (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), link.work_order_id, link.firebase_uid,
        status === "failed" ? "payment_failed" : "payment_review_required",
        status === "failed" ? "Payment provider reported a failed payment." : failureCode === "amount_or_currency_mismatch"
          ? "Payment held for review because provider totals did not match."
          : "Payment held for review because another checkout exists for this commercial reference.", receivedAt));
  }
  await db.batch(statements);
  const shouldNotify = becamePaid
    || (status === "failed" && link.status !== "failed")
    || (status === "review_required" && (link.status !== "review_required" || failureCode !== link.failure_code));
  if (shouldNotify) await notifyPaymentResult(input, link, status, failureCode).catch(() => null);
  return { matched: true, status, paymentLinkId: link.id };
}
