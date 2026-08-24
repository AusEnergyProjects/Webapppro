import {
  authoriseRentalReportToken,
  recordRentalReportAccess,
  rentalReportEvidence,
} from "@/lib/trade-rental-report-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string; evidenceId: string }> };

function safeName(value: unknown) {
  return String(value || "assessment-evidence").replace(/[\r\n"\\/]/g, "_").slice(0, 180);
}

function contentDisposition(fileName: string) {
  const asciiName = fileName.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "assessment-evidence";
  const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(request: Request, context: Context) {
  try {
    const params = await context.params;
    const link = await authoriseRentalReportToken(params.token);
    const evidence = await rentalReportEvidence(link, params.evidenceId);
    await recordRentalReportAccess(link, request, "evidence_viewed");
    return new Response(evidence.bytes, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(safeName(evidence.fileName)),
        "Content-Length": String(evidence.bytes.byteLength),
        "Content-Type": evidence.contentType,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      },
    });
  } catch {
    return Response.json({ ok: false, error: "This evidence file is not available." }, {
      status: 404,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
}
