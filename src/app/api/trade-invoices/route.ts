import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

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
        d.customer_source, d.invoice_status, d.invoiced_value_cents, d.paid_value_cents,
        c.first_name, c.last_name, c.business_name,
        h.commercial_reference, h.total_cents accepted_total_cents, h.accepted_at,
        a.provider, a.status accounting_status, a.external_number, a.external_url, a.last_error,
        q.invoice_number quick_invoice_number, q.total_cents quick_total_cents, q.status quick_invoice_status,
        COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit
          WHERE credit.invoice_id = q.id AND credit.status = 'issued'), 0) quick_credited_cents,
        COALESCE((SELECT SUM(allocation.amount_cents) FROM trade_crm_invoice_payment_allocations allocation
          WHERE allocation.invoice_id = q.id), 0) quick_paid_cents,
        q.delivery_status quick_delivery_status, q.sent_at quick_sent_at, q.last_error quick_last_error
      FROM trade_work_orders w
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
        AND c.record_status = 'active'
      LEFT JOIN trade_crm_commercial_handovers h ON h.work_order_id = w.id AND h.firebase_uid = w.firebase_uid
        AND h.accepted_at = (SELECT MAX(h2.accepted_at) FROM trade_crm_commercial_handovers h2
          WHERE h2.work_order_id = w.id AND h2.firebase_uid = w.firebase_uid)
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
        ? "AEA protected customer"
        : String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Customer not linked");
      const quickInvoice = Boolean(row.quick_invoice_number);
      const totalCents = quickInvoice
        ? Math.max(0, Number(row.quick_total_cents || 0) - Number(row.quick_credited_cents || 0))
        : Number(row.accepted_total_cents || row.invoiced_value_cents || 0);
      const paidCents = quickInvoice ? Number(row.quick_paid_cents || 0) : Number(row.paid_value_cents || 0);
      const accountingStatus = String(row.accounting_status || "");
      const quickDeliveryStatus = String(row.quick_delivery_status || "");
      const status = accountingStatus === "error" || quickDeliveryStatus === "failed" ? "attention"
        : paidCents >= totalCents && totalCents > 0 ? "paid"
          : row.quick_invoice_status === "part_credited" ? "part_credited"
            : row.quick_invoice_status === "credited" ? "credited"
              : accountingStatus || (totalCents > 0 ? "ready" : "not_ready");
      return {
        id: row.id, workNumber: row.work_number, title: row.title, customerName, protectedJob,
        stage: row.stage, status, invoiceStatus: row.invoice_status || "not_started",
        commercialReference: row.commercial_reference || "", totalCents, paidCents,
        outstandingCents: Math.max(0, totalCents - paidCents), provider: row.quick_invoice_number ? "tlink" : row.provider || "",
        externalNumber: row.quick_invoice_number || row.external_number || "", externalUrl: row.external_url || "",
        lastError: row.quick_last_error || row.last_error || "", acceptedAt: row.quick_sent_at || row.accepted_at || "", updatedAt: row.updated_at,
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
