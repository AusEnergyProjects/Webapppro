import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { tradeEmailApiError } from "@/lib/trade-email-api";
import { customerDeliveryFailureDiagnostic, loadCustomerDeliveryExceptions } from "@/lib/trade-customer-delivery-exceptions-server";
import { canReviewCustomerDeliveries } from "@/lib/trade-customer-delivery-exceptions";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner && !canReviewCustomerDeliveries(access)) return adminJson({ ok: false, error: "Quote, invoice or booking access is required to review these delivery issues." }, 403);
    const params = new URL(request.url).searchParams;
    const workOrderId = params.get("workOrderId") || "";
    if (workOrderId.length > 180 || /[\u0000-\u001f\u007f]/.test(workOrderId)) throw new Error("EMAIL_INPUT_INVALID");
    const result = await loadCustomerDeliveryExceptions(getD1(), access, { workOrderId, page: Number(params.get("page") || 1) });
    return adminJson({ ok: true, ...result });
  } catch (error) {
    const response = tradeEmailApiError(error);
    if (response.status >= 500) console.error("trade_customer_delivery_exceptions_failed", customerDeliveryFailureDiagnostic(error));
    return response;
  }
}
