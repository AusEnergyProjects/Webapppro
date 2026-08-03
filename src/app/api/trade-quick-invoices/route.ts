import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import {
  quickInvoiceNumber,
  resolveQuickInvoiceDraft,
  sendQuickInvoiceDelivery,
} from "@/lib/trade-quick-invoice-server";
import { creditTotals, invoiceBalance } from "@/lib/trade-invoice-balance";
import { australiaLocalDateTime } from "@/lib/trade-schedule";

export const runtime = "edge";

type Row = Record<string, unknown>;

function invoiceError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "This installer account does not currently have invoice access." }, 403);
  if (code === "QUICK_INVOICE_NOT_FOUND") return adminJson({ ok: false, error: "Quick invoice not found." }, 404);
  if (code === "QUICK_INVOICE_EXISTS") return adminJson({ ok: false, error: "This job already has a TLink invoice." }, 409);
  if (code === "QUICK_INVOICE_JOB_NOT_FOUND") return adminJson({ ok: false, error: "Choose an active direct-customer job." }, 404);
  if (code === "QUICK_INVOICE_RECIPIENT_INVALID") return adminJson({ ok: false, error: "Add a valid email to the customer record before sending this invoice." }, 409);
  if (code === "waiting_for_channel") return adminJson({ ok: false, error: "Email delivery is not active yet. The invoice remains saved in the job." }, 503);
  if (code === "QUICK_INVOICE_DELIVERY_FAILED") return adminJson({ ok: false, error: "The invoice remains saved, but the email could not be sent. Try again." }, 502);
  if (code === "QUICK_INVOICE_CHANGED") return adminJson({ ok: false, error: "This invoice changed in another session. Reload it before saving." }, 409);
  if (code === "QUICK_INVOICE_ISSUED") return adminJson({ ok: false, error: "An issued invoice cannot be overwritten. Create a credit instead." }, 409);
  if (code === "QUICK_INVOICE_EXTERNAL_ACTIVITY") return adminJson({ ok: false, error: "This invoice already has accounting activity, so its original totals are locked." }, 409);
  if (code === "INVALID_INVOICE_CREDIT") return adminJson({ ok: false, error: "Add a credit description, reason and valid amount." }, 400);
  if (code === "INVOICE_BALANCE_EXCEEDED") return adminJson({ ok: false, error: "The credit cannot exceed the invoice balance still outstanding." }, 409);
  if (code === "INVALID_QUICK_INVOICE") return adminJson({ ok: false, error: "Add one to eight valid invoice lines." }, 400);
  return adminJson({ ok: false, error: "The quick invoice request could not be completed." }, 500);
}

function cleanDate(value: unknown) {
  const date = cleanAdminText(value, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) throw new Error("INVALID_QUICK_INVOICE");
  return date;
}

async function invoiceRow(ownerUid: string, clause: "id" | "work_order_id", value: string) {
  return getD1().prepare(`SELECT q.*,
      COALESCE((SELECT customer.email FROM trade_crm_customers customer
        WHERE customer.id = q.crm_customer_id AND customer.firebase_uid = q.firebase_uid
          AND customer.record_status = 'active'), '') delivery_email,
      COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit
        WHERE credit.invoice_id = q.id AND credit.status = 'issued'), 0) credited_cents,
      EXISTS(SELECT 1 FROM trade_crm_accounting_documents document WHERE document.firebase_uid = q.firebase_uid
        AND document.work_order_id = q.work_order_id AND document.document_type = 'invoice') accounting_activity
    FROM trade_crm_quick_invoices q WHERE q.${clause} = ? AND q.firebase_uid = ?`)
    .bind(value, ownerUid).first<Row>();
}

async function completePayload(row: Row) {
  const db = getD1();
  const [creditRows, revisionRows] = await Promise.all([
    db.prepare(`SELECT credit_number, description, subtotal_cents, tax_cents, total_cents, reason, status, created_at
      FROM trade_crm_quick_invoice_credits WHERE invoice_id = ? AND firebase_uid = ? ORDER BY created_at DESC`)
      .bind(row.id, row.firebase_uid).all<Row>(),
    db.prepare(`SELECT revision, subtotal_cents, tax_cents, total_cents, due_at, change_reason, created_at
      FROM trade_crm_quick_invoice_revisions WHERE invoice_id = ? AND firebase_uid = ? ORDER BY revision DESC`)
      .bind(row.id, row.firebase_uid).all<Row>(),
  ]);
  return payload(row, creditRows.results, revisionRows.results);
}

function payload(row: Row, credits: Row[] = [], revisions: Row[] = []) {
  let lines: unknown[] = [];
  try { lines = JSON.parse(String(row.line_items_json || "[]")); }
  catch { lines = []; }
  const balance = invoiceBalance({ totalCents: Number(row.total_cents), creditedCents: Number(row.credited_cents || 0), paidCents: 0 });
  return {
    id: String(row.id), workOrderId: String(row.work_order_id), invoiceNumber: String(row.invoice_number),
    lines, subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents),
    dueAt: String(row.due_at), status: String(row.status), deliveryStatus: String(row.delivery_status),
    deliveryEmail: String(row.delivery_email || ""),
    attempts: Number(row.attempts), sentAt: String(row.sent_at), createdAt: String(row.created_at), revision: Number(row.revision || 1),
    creditedCents: balance.creditedCents, paidCents: balance.paidCents, netCents: balance.netCents, outstandingCents: balance.outstandingCents,
    canCorrect: row.status === "draft" && row.delivery_status !== "sent" && !Boolean(row.accounting_activity),
    creditBlockedReason: Boolean(row.accounting_activity) ? "A connected accounting draft already uses the current total." : "",
    credits: credits.map((credit) => ({ creditNumber: String(credit.credit_number), description: String(credit.description),
      subtotalCents: Number(credit.subtotal_cents), taxCents: Number(credit.tax_cents), totalCents: Number(credit.total_cents),
      reason: String(credit.reason), status: String(credit.status), createdAt: String(credit.created_at) })),
    revisions: revisions.map((revision) => ({ revision: Number(revision.revision), subtotalCents: Number(revision.subtotal_cents),
      taxCents: Number(revision.tax_cents), totalCents: Number(revision.total_cents), dueAt: String(revision.due_at),
      reason: String(revision.change_reason), createdAt: String(revision.created_at) })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    if (!workOrderId) return adminJson({ ok: false, error: "Choose a job." }, 400);
    const row = await invoiceRow(identity.uid, "work_order_id", workOrderId);
    return adminJson({ ok: true, invoice: row ? await completePayload(row) : null });
  } catch (error) { return invoiceError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const body = await request.json().catch(() => ({})) as Row;
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    const australiaSydneyToday = australiaLocalDateTime(
      "NSW",
      new Date(now),
    ).slice(0, 10);
    if (action === "create_draft") {
      const workOrderId = cleanAdminText(body.workOrderId, 180);
      const job = await db.prepare(`SELECT
          work.id,
          work.work_number,
          details.crm_customer_id
        FROM trade_work_orders work
        JOIN trade_crm_job_details details
          ON details.work_order_id = work.id
          AND details.firebase_uid = work.firebase_uid
        JOIN trade_crm_customers customer
          ON customer.id = details.crm_customer_id
          AND customer.firebase_uid = work.firebase_uid
          AND customer.record_status = 'active'
        WHERE work.id = ?
          AND work.firebase_uid = ?
          AND work.partner_type = 'installer'
          AND work.record_status = 'active'
          AND details.customer_source = 'trade_owned'
        LIMIT 1`)
        .bind(workOrderId, identity.uid)
        .first<Row>();
      if (!job) throw new Error("QUICK_INVOICE_JOB_NOT_FOUND");
      if (await invoiceRow(identity.uid, "work_order_id", workOrderId)) {
        throw new Error("QUICK_INVOICE_EXISTS");
      }
      const draft = await resolveQuickInvoiceDraft(identity.uid, body.lines);
      const dueAt = cleanDate(body.dueAt);
      if (dueAt < australiaSydneyToday) throw new Error("INVALID_QUICK_INVOICE");
      const invoiceId = crypto.randomUUID();
      const invoiceNumber = quickInvoiceNumber(String(job.work_number));
      const linesJson = JSON.stringify(draft.lines);
      try {
        await db.batch([
          db.prepare(`INSERT INTO trade_crm_quick_invoices
            (id, work_order_id, firebase_uid, crm_customer_id, invoice_number, currency,
             line_items_json, subtotal_cents, tax_cents, total_cents, due_at, status,
             delivery_status, delivery_provider, provider_message_id, consent_confirmed_at,
             attempts, last_error, sent_at, created_by_uid, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'draft', 'queued', 'resend', '',
              '', 0, '', '', ?, ?, ?)`)
            .bind(
              invoiceId,
              workOrderId,
              identity.uid,
              job.crm_customer_id,
              invoiceNumber,
              linesJson,
              draft.subtotalCents,
              draft.taxCents,
              draft.totalCents,
              dueAt,
              identity.uid,
              now,
              now,
            ),
          db.prepare(`INSERT INTO trade_crm_quick_invoice_revisions
            (id, invoice_id, firebase_uid, revision, line_items_json, subtotal_cents,
             tax_cents, total_cents, due_at, change_reason, created_by_uid, created_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'Initial invoice snapshot', ?, ?)`)
            .bind(
              crypto.randomUUID(),
              invoiceId,
              identity.uid,
              linesJson,
              draft.subtotalCents,
              draft.taxCents,
              draft.totalCents,
              dueAt,
              identity.uid,
              now,
            ),
          db.prepare(`UPDATE trade_crm_job_details
            SET invoiced_value_cents = ?, invoice_status = 'draft',
              payment_due_at = ?, updated_at = ?
            WHERE work_order_id = ? AND firebase_uid = ?`)
            .bind(draft.totalCents, dueAt, now, workOrderId, identity.uid),
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'quick_invoice_created', ?, ?)`)
            .bind(
              crypto.randomUUID(),
              workOrderId,
              identity.uid,
              `${invoiceNumber} draft created from the saved job.`,
              now,
            ),
        ]);
      } catch (error) {
        if (String(error).includes("UNIQUE")) throw new Error("QUICK_INVOICE_EXISTS");
        throw error;
      }
      const created = await invoiceRow(identity.uid, "id", invoiceId);
      return adminJson({
        ok: true,
        invoice: created ? await completePayload(created) : null,
      }, 201);
    }
    const invoiceId = cleanAdminText(body.invoiceId, 180);
    const current = await invoiceRow(identity.uid, "id", invoiceId);
    if (!current) throw new Error("QUICK_INVOICE_NOT_FOUND");
    if (action === "retry_delivery") {
      if (body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the customer asked to receive this invoice." }, 400);
      await sendQuickInvoiceDelivery({ invoiceId, ownerUid: identity.uid, actorUid: identity.uid, origin: new URL(request.url).origin });
    } else if (action === "correct_draft") {
      if (current.status !== "draft" || current.delivery_status === "sent") throw new Error("QUICK_INVOICE_ISSUED");
      if (Boolean(current.accounting_activity)) throw new Error("QUICK_INVOICE_EXTERNAL_ACTIVITY");
      if (Number(body.expectedRevision) !== Number(current.revision || 1)) throw new Error("QUICK_INVOICE_CHANGED");
      const draft = await resolveQuickInvoiceDraft(identity.uid, body.lines);
      const dueAt = cleanDate(body.dueAt);
      if (dueAt < australiaSydneyToday) throw new Error("INVALID_QUICK_INVOICE");
      const reason = cleanAdminText(body.reason, 240) || "Draft invoice corrected before issue";
      const nextRevision = Number(current.revision || 1) + 1;
      const linesJson = JSON.stringify(draft.lines);
      const results = await db.batch([
        db.prepare(`UPDATE trade_crm_quick_invoices SET line_items_json = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?,
          due_at = ?, revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ? AND status = 'draft'`)
          .bind(linesJson, draft.subtotalCents, draft.taxCents, draft.totalCents, dueAt, nextRevision, now,
            invoiceId, identity.uid, current.revision),
        db.prepare(`INSERT INTO trade_crm_quick_invoice_revisions
          (id, invoice_id, firebase_uid, revision, line_items_json, subtotal_cents, tax_cents, total_cents,
           due_at, change_reason, created_by_uid, created_at)
          SELECT ?, id, firebase_uid, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM trade_crm_quick_invoices
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND line_items_json = ?`)
          .bind(crypto.randomUUID(), nextRevision, linesJson, draft.subtotalCents, draft.taxCents, draft.totalCents,
            dueAt, reason, identity.uid, now, invoiceId, identity.uid, nextRevision, linesJson),
        db.prepare(`UPDATE trade_crm_job_details SET invoiced_value_cents = ?, payment_due_at = ?, updated_at = ?
          WHERE work_order_id = ? AND firebase_uid = ? AND EXISTS
            (SELECT 1 FROM trade_crm_quick_invoices q WHERE q.id = ? AND q.revision = ? AND q.line_items_json = ?)`)
          .bind(draft.totalCents, dueAt, now, current.work_order_id, identity.uid, invoiceId, nextRevision, linesJson),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, ?, ?, 'quick_invoice_corrected', ?, ? WHERE EXISTS
            (SELECT 1 FROM trade_crm_quick_invoices q WHERE q.id = ? AND q.revision = ? AND q.line_items_json = ?)`)
          .bind(crypto.randomUUID(), current.work_order_id, identity.uid, `${current.invoice_number} draft corrected before issue.`, now,
            invoiceId, nextRevision, linesJson),
      ]);
      if (!Number(results[0].meta.changes || 0)) throw new Error("QUICK_INVOICE_CHANGED");
    } else if (action === "issue_credit") {
      if (!['issued', 'part_credited'].includes(String(current.status))) throw new Error("QUICK_INVOICE_ISSUED");
      if (Boolean(current.accounting_activity)) throw new Error("QUICK_INVOICE_EXTERNAL_ACTIVITY");
      const description = cleanAdminText(body.description, 180);
      const reason = cleanAdminText(body.reason, 500);
      const taxCode = cleanAdminText(body.taxCode, 10) === "none" ? "none" : "gst";
      const totals = creditTotals(Number(body.subtotalCents), taxCode);
      if (!description || reason.length < 3) throw new Error("INVALID_INVOICE_CREDIT");
      const creditId = crypto.randomUUID();
      const creditNumber = `CN-${String(current.invoice_number)}-${creditId.slice(0, 8).toUpperCase()}`;
      const results = await db.batch([
        db.prepare(`INSERT INTO trade_crm_quick_invoice_credits
          (id, invoice_id, work_order_id, firebase_uid, credit_number, description, subtotal_cents, tax_cents,
           total_cents, status, reason, created_by_uid, created_at)
          SELECT ?, q.id, q.work_order_id, q.firebase_uid, ?, ?, ?, ?, ?, 'issued', ?, ?, ?
          FROM trade_crm_quick_invoices q WHERE q.id = ? AND q.firebase_uid = ?
            AND ? <= q.total_cents
              - COALESCE((SELECT SUM(c.total_cents) FROM trade_crm_quick_invoice_credits c WHERE c.invoice_id = q.id AND c.status = 'issued'), 0)`)
          .bind(creditId, creditNumber, description, totals.subtotalCents, totals.taxCents, totals.totalCents,
            reason, identity.uid, now, invoiceId, identity.uid, totals.totalCents),
        db.prepare(`UPDATE trade_crm_quick_invoices SET status = CASE
            WHEN total_cents - COALESCE((SELECT SUM(c.total_cents) FROM trade_crm_quick_invoice_credits c WHERE c.invoice_id = trade_crm_quick_invoices.id AND c.status = 'issued'), 0) = 0
              THEN 'credited' ELSE 'part_credited' END, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND EXISTS (SELECT 1 FROM trade_crm_quick_invoice_credits c WHERE c.id = ?)`)
          .bind(now, invoiceId, identity.uid, creditId),
        db.prepare(`UPDATE trade_crm_job_details SET
            invoiced_value_cents = (SELECT q.total_cents - COALESCE((SELECT SUM(c.total_cents) FROM trade_crm_quick_invoice_credits c WHERE c.invoice_id = q.id AND c.status = 'issued'), 0)
              FROM trade_crm_quick_invoices q WHERE q.id = ?),
            invoice_status = CASE WHEN (SELECT q.total_cents - COALESCE((SELECT SUM(c.total_cents) FROM trade_crm_quick_invoice_credits c WHERE c.invoice_id = q.id AND c.status = 'issued'), 0)
              FROM trade_crm_quick_invoices q WHERE q.id = ?) = 0 THEN 'credited' ELSE 'part_credited' END, updated_at = ?
          WHERE work_order_id = ? AND firebase_uid = ? AND EXISTS (SELECT 1 FROM trade_crm_quick_invoice_credits c WHERE c.id = ?)`)
          .bind(invoiceId, invoiceId, now, current.work_order_id, identity.uid, creditId),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          SELECT ?, ?, ?, 'quick_invoice_credit_issued', ?, ? WHERE EXISTS (SELECT 1 FROM trade_crm_quick_invoice_credits c WHERE c.id = ?)`)
          .bind(crypto.randomUUID(), current.work_order_id, identity.uid, `${creditNumber} issued against ${current.invoice_number}.`, now, creditId),
      ]);
      if (!Number(results[0].meta.changes || 0)) throw new Error("INVOICE_BALANCE_EXCEEDED");
    } else return adminJson({ ok: false, error: "Choose an invoice action." }, 400);
    const row = await invoiceRow(identity.uid, "id", invoiceId);
    return adminJson({ ok: true, invoice: row ? await completePayload(row) : null });
  } catch (error) { return invoiceError(error); }
}
