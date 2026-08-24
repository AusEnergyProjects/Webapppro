import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { authenticatedRentalReportPdf } from "@/lib/trade-rental-report-server";

export const runtime = "edge";

type Context = { params: Promise<{ reportId: string }> };

function safeName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180);
}

export async function GET(request: Request, context: Context) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const reportId = cleanAdminText((await context.params).reportId, 180);
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    if (!reportId || !workOrderId) return adminJson({ ok: false, error: "Choose an issued rental report." }, 400);
    const report = await authenticatedRentalReportPdf({ access, workOrderId, reportId });
    return new Response(report.bytes, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${safeName(`${report.reportNumber}.pdf`)}"`,
        "Content-Length": String(report.bytes.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
    if (code === "RENTAL_REPORT_LINK_NOT_FOUND") return adminJson({ ok: false, error: "Issued rental report not found." }, 404);
    if (code === "ASSESSOR_REQUIRED" || code === "REPORT_PERMISSION_REQUIRED" || code === "JOB_NOT_ASSIGNED") {
      return adminJson({ ok: false, error: "Your team access does not allow this issued report download." }, 403);
    }
    if (code === "ISSUED_PDF_INVALID" || code === "ISSUED_PDF_STORAGE_UNAVAILABLE") {
      return adminJson({ ok: false, error: "The immutable issued PDF could not be verified." }, 409);
    }
    return adminJson({ ok: false, error: "The issued rental report could not be downloaded." }, 500);
  }
}
