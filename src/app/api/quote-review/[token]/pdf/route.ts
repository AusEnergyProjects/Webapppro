import {
  authoriseTradeQuoteLink,
  quoteDocumentSnapshotForAuthorisedLink,
  tradeQuoteTokenErrorResponse,
} from "@/lib/trade-quote-review-server";
import {
  tradeQuotePdfFilename,
} from "@/lib/trade-quote-pdf-server";
import { issuedTradeQuotePdf } from "@/lib/trade-quote-issued-pdf-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };

function bytesBody(bytes: Uint8Array) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

export async function GET(request: Request, context: Context) {
  try {
    const row = await authoriseTradeQuoteLink((await context.params).token);
    const snapshot = await quoteDocumentSnapshotForAuthorisedLink(row);
    const issuedPdf = await issuedTradeQuotePdf({
      ownerUid: row.firebase_uid,
      quoteVersionId: row.quote_version_id,
      snapshot,
      origin: new URL(request.url).origin,
    });
    const bytes = issuedPdf.bytes;
    const disposition =
      new URL(request.url).searchParams.get("download") === "1"
        ? "attachment"
        : "inline";
    return new Response(bytesBody(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `${disposition}; filename="${tradeQuotePdfFilename(snapshot)}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": "application/pdf",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return tradeQuoteTokenErrorResponse(error, "pdf");
  }
}
