import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import {
  projectTradeInvoiceRegisterFinance,
  TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL,
} from "@/lib/trade-invoice-register";

export const runtime = "edge";

function invoiceError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "This installer account does not currently have invoice access." }, 403);
  }
  return adminJson({ ok: false, error: "Invoices could not be loaded." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const result = await getD1().prepare(`SELECT w.id, w.work_number, w.title, w.stage, w.updated_at,
        d.customer_source, d.invoice_status, d.invoiced_value_cents, d.paid_value_cents, d.payment_due_at,
        c.first_name, c.last_name, c.business_name,
        h.commercial_reference, h.total_cents accepted_total_cents, h.accepted_at,
        ai.invoice_number accepted_invoice_number, ai.total_cents accepted_invoice_total_cents,
        ai.status accepted_invoice_status, ai.issue_blocker_code accepted_invoice_blocker_code,
        ai.due_at accepted_invoice_due_at, ai.created_at accepted_invoice_created_at,
        a.id accounting_document_id, a.provider, a.status accounting_status,
        a.external_number, a.external_url, a.amount_cents accounting_amount_cents,
        a.paid_amount_cents accounting_paid_amount_cents, a.due_at accounting_due_at,
        a.last_error, a.created_at accounting_created_at,
        q.invoice_number quick_invoice_number, q.total_cents quick_total_cents,
        q.due_at quick_due_at, q.status quick_invoice_status,
        COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit
          WHERE credit.invoice_id = q.id AND credit.status = 'issued'), 0) quick_credited_cents,
        q.delivery_status quick_delivery_status, q.sent_at quick_sent_at, q.last_error quick_last_error
      FROM trade_work_orders w
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
        AND c.record_status = 'active'
      ${TRADE_INVOICE_REGISTER_HANDOFF_JOIN_SQL}
      LEFT JOIN trade_crm_accepted_invoices ai ON ai.commercial_handoff_id = h.id
        AND ai.acceptance_id = h.acceptance_id AND ai.quote_version_id = h.quote_version_id
        AND ai.work_order_id = w.id AND ai.firebase_uid = w.firebase_uid
        AND ai.crm_customer_id = d.crm_customer_id
      LEFT JOIN trade_crm_accounting_documents a ON a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid
        AND a.document_type = 'invoice'
      LEFT JOIN trade_crm_quick_invoices q ON q.work_order_id = w.id AND q.firebase_uid = w.firebase_uid AND q.status <> 'void'
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      ORDER BY CASE WHEN a.status IN ('error', 'overdue') THEN 0
                    WHEN COALESCE(h.total_cents, 0) > COALESCE(d.paid_value_cents, 0) THEN 1 ELSE 2 END,
        w.updated_at DESC LIMIT 250`).bind(identity.uid).all<Record<string, unknown>>();
    const invoices = result.results.map((row) => {
      const protectedJob = row.customer_source === "platform_private";
      const customerName = protectedJob
        ? "Australian Energy Assessments protected customer"
        : String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Customer not linked");
      const finance = projectTradeInvoiceRegisterFinance(row);
      return {
        id: row.id, workNumber: row.work_number, title: row.title, customerName, protectedJob,
        stage: row.stage, invoiceStatus: row.invoice_status || "not_started",
        commercialReference: row.commercial_reference || "", ...finance, updatedAt: row.updated_at,
      };
    });
    return adminJson({
      ok: true,
      invoices,
      metrics: {
        ready: invoices.filter((item) => item.status === "ready").length,
        attention: invoices.filter((item) => item.status === "attention" || item.status === "overdue").length,
        paid: invoices.filter((item) => item.status === "paid").length,
        outstandingCents: invoices.reduce((total, item) => total + item.outstandingCents, 0),
      },
    });
  } catch (error) { return invoiceError(error); }
}
