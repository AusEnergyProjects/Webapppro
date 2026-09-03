import {
  authoriseTradeQuoteLink,
  quoteDocumentSnapshotForAuthorisedLink,
  tradeQuoteTokenErrorResponse,
} from "@/lib/trade-quote-review-server";
export const runtime = "edge";

type Context = {
  params: Promise<{ token: string; kind: string }>;
};

function bytesBody(bytes: Uint8Array) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    if (params.kind !== "logo" && params.kind !== "banner") {
      return new Response("Brand image not found.", {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const row = await authoriseTradeQuoteLink(params.token);
    const snapshot = await quoteDocumentSnapshotForAuthorisedLink(row);
    const { loadTradeQuoteBrandAsset } = await import("@/lib/trade-quote-pdf-server");
    const asset = await loadTradeQuoteBrandAsset(snapshot, params.kind);
    if (!asset) {
      return new Response("Brand image not found.", {
        status: 404,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const extension = asset.contentType === "image/png" ? "png" : "jpg";
    return new Response(bytesBody(asset.bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `inline; filename="business-${params.kind}.${extension}"`,
        "Content-Length": String(asset.bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": asset.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return tradeQuoteTokenErrorResponse(error, "media");
  }
}
