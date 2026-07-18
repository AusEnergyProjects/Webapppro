import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";
import { sendQuickInvoiceDelivery } from "@/lib/trade-quick-invoice-server";

export const runtime = "edge";

type Row = Record<string, unknown>;

function invoiceError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "This installer account does not currently have invoice access." }, 403);
  if (code === "QUICK_INVOICE_NOT_FOUND") return adminJson({ ok: false, error: "Quick invoice not found." }, 404);
  if (code === "waiting_for_channel") return adminJson({ ok: false, error: "Email delivery is not active yet. The invoice remains saved in the job." }, 503);
  if (code === "QUICK_INVOICE_DELIVERY_FAILED") return adminJson({ ok: false, error: "The invoice remains saved, but the email could not be sent. Try again." }, 502);
  return adminJson({ ok: false, error: "The quick invoice request could not be completed." }, 500);
}

function payload(row: Row) {
  let lines: unknown[] = [];
  try { lines = JSON.parse(String(row.line_items_json || "[]")); }
  catch { lines = []; }
  return {
    id: String(row.id), workOrderId: String(row.work_order_id), invoiceNumber: String(row.invoice_number),
    lines, subtotalCents: Number(row.subtotal_cents), taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents),
    dueAt: String(row.due_at), status: String(row.status), deliveryStatus: String(row.delivery_status),
    attempts: Number(row.attempts), sentAt: String(row.sent_at), createdAt: String(row.created_at),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    if (!workOrderId) return adminJson({ ok: false, error: "Choose a job." }, 400);
    const row = await getD1().prepare(`SELECT * FROM trade_crm_quick_invoices WHERE work_order_id = ? AND firebase_uid = ?`)
      .bind(workOrderId, identity.uid).first<Row>();
    return adminJson({ ok: true, invoice: row ? payload(row) : null });
  } catch (error) { return invoiceError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const body = await request.json().catch(() => ({})) as Row;
    if (body.action !== "retry_delivery" || body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm the customer asked to receive this invoice." }, 400);
    const invoiceId = cleanAdminText(body.invoiceId, 180);
    await sendQuickInvoiceDelivery({ invoiceId, ownerUid: identity.uid, actorUid: identity.uid, origin: new URL(request.url).origin });
    const row = await getD1().prepare("SELECT * FROM trade_crm_quick_invoices WHERE id = ? AND firebase_uid = ?")
      .bind(invoiceId, identity.uid).first<Row>();
    return adminJson({ ok: true, invoice: row ? payload(row) : null });
  } catch (error) { return invoiceError(error); }
}
