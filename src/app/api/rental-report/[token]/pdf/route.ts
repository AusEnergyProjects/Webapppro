import {
  authoriseRentalReportToken,
  recordRentalReportAccess,
  rentalReportPdf,
} from "@/lib/trade-rental-report-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };

function safeName(value: unknown) {
  return String(value || "rental-assessment.pdf").replace(/[\r\n"\\/]/g, "_").slice(0, 180);
}

export async function GET(request: Request, context: Context) {
  try {
    const link = await authoriseRentalReportToken((await context.params).token);
    const bytes = await rentalReportPdf(link);
    await recordRentalReportAccess(link, request, "pdf_downloaded");
    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${safeName(`${link.report_number}.pdf`)}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/pdf",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      },
    });
  } catch {
    return Response.json({ ok: false, error: "This report PDF is not available." }, {
      status: 404,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
}
