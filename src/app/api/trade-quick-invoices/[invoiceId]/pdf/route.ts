import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { getD1 } from "../../../../../../db";
import {
  assignedJob,
  requireInstallerTeamAccess,
} from "@/lib/trade-team-server";
import { issuedQuickInvoicePdf } from "@/lib/trade-quick-invoice-server";
import { tradeQuickInvoicePdfFilename } from "@/lib/trade-quick-invoice-pdf-server";

export const runtime = "edge";

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  if (!sameOrigin(request)) {
    return adminJson(
      { ok: false, error: "Request origin was not accepted." },
      403,
    );
  }
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner && !access.canViewInvoices) {
      throw new Error("QUICK_INVOICE_MANAGEMENT_REQUIRED");
    }
    const { invoiceId: rawInvoiceId } = await context.params;
    const invoiceId = cleanAdminText(rawInvoiceId, 180);
    if (!invoiceId) {
      return adminJson({ ok: false, error: "Choose an invoice." }, 400);
    }
    const invoice = await getD1().prepare(`SELECT work_order_id FROM trade_crm_quick_invoices
      WHERE id = ? AND firebase_uid = ?`).bind(invoiceId, access.ownerUid).first<Record<string, unknown>>();
    if (!invoice) throw new Error("QUICK_INVOICE_NOT_FOUND");
    await assignedJob(access, String(invoice.work_order_id));
    const { snapshot, bytes } = await issuedQuickInvoicePdf(
      access.ownerUid,
      invoiceId,
    );
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${tradeQuickInvoicePdfFilename(snapshot)}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") {
      return adminJson({ ok: false, error: "Sign in to continue." }, 401);
    }
    if (
      ["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED"].includes(
        code,
      )
    ) {
      return adminJson(
        {
          ok: false,
          error: "This installer account does not currently have invoice access.",
        },
        403,
      );
    }
    if (code === "QUICK_INVOICE_NOT_FOUND") {
      return adminJson({ ok: false, error: "Invoice not found." }, 404);
    }
    if (code === "QUICK_INVOICE_MANAGEMENT_REQUIRED") {
      return adminJson(
        { ok: false, error: "Only the owner, manager or coordinator can download customer invoices." },
        403,
      );
    }
    if (
      code === "QUICK_INVOICE_DOCUMENT_UNAVAILABLE" ||
      code === "QUICK_INVOICE_PDF_UNAVAILABLE"
    ) {
      return adminJson(
        {
          ok: false,
          error:
            "This historical invoice has no verified issued PDF artifact and cannot be regenerated.",
        },
        409,
      );
    }
    return adminJson(
      { ok: false, error: "The invoice PDF could not be generated." },
      500,
    );
  }
}
