import {
  authoriseRentalReportToken,
  publicRentalReportPayload,
  recordRentalReportAccess,
} from "@/lib/trade-rental-report-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };

function response(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}

function reportError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "RENTAL_REPORT_EXPIRED") return response({ ok: false, error: "This report link expired after 60 days. Ask the assessor for a current copy." }, 410);
  if (code === "RENTAL_REPORT_STOPPED") return response({ ok: false, error: "This report link is no longer active." }, 410);
  return response({ ok: false, error: "This report could not be found." }, 404);
}

export async function GET(request: Request, context: Context) {
  try {
    const token = (await context.params).token;
    const link = await authoriseRentalReportToken(token);
    await recordRentalReportAccess(link, request, "viewed");
    return response({ ok: true, report: publicRentalReportPayload(link, token) });
  } catch (error) {
    return reportError(error);
  }
}
