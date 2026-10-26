import { waitUntil } from "cloudflare:workers";
import { adminError, adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { AdminRentalEmailError, adminRentalReportEmailStatus, sendAdminRentalReportEmail } from "@/lib/admin-rental-report-email";

export const runtime = "edge";

function failure(error: unknown) {
  if (error instanceof AdminRentalEmailError || error instanceof BoundedJsonRequestError) {
    return adminJson({ ok: false, code: error.code,
      error: error.code === "REQUEST_TOO_LARGE" ? "The report email request is too large." : error.message }, error.status);
  }
  if (error instanceof Error && error.message === "REPORT_RECIPIENT_CHANGED") {
    return adminJson({ ok: false, code: error.message, error: "The customer email changed. Refresh before sending this report." }, 409);
  }
  return adminError(error);
}

async function handle(request: Request) {
  if (!sameOrigin(request) || request.headers.has("X-TLink-Admin-Job")) {
    return adminJson({ ok: false, error: "Use the administrator report email action for this request." }, 403);
  }
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const url = new URL(request.url);
    if (request.method === "GET") {
      const ids = url.searchParams.getAll("workOrderId");
      if (ids.length !== 1) throw new AdminRentalEmailError("REPORT_EMAIL_INPUT_INVALID", "Choose one job.", 400);
      return adminJson({ ok: true, ...await adminRentalReportEmailStatus(admin, ids[0], url.origin) });
    }
    const body = await readBoundedJsonRequest(request, 4096);
    const delivery = (async () => {
      const reportDelivery = await sendAdminRentalReportEmail(admin, body, url.origin);
      const accepted = reportDelivery.status === "accepted";
      return adminJson({ ok: accepted, reportDelivery, ...(!accepted ? { error: reportDelivery.message } : {}) },
        accepted ? 200 : ["held", "reconciliation_required"].includes(reportDelivery.status) ? 409 : 503);
    })();
    waitUntil(delivery);
    return await delivery;
  } catch (error) { return failure(error); }
}

export const GET = handle;
export const POST = handle;
