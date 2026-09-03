import {
  authoriseTradeQuoteDecisionLink,
  storedQuoteDecision,
} from "@/lib/trade-quote-decision-server";
import {
  quoteDocumentSnapshotForAuthorisedLink,
  tradeQuoteTokenErrorResponse,
} from "@/lib/trade-quote-review-server";
import { adminJson } from "@/lib/admin-server";

export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };

function bytesBody(bytes: Uint8Array) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function acceptancePdfError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code !== "QUOTE_ACCEPTANCE_PDF_INVALID" &&
    code !== "QUOTE_DECISION_RECEIPT_INVALID"
  ) {
    return tradeQuoteTokenErrorResponse(error, "acceptance receipt pdf");
  }
  const requestId = crypto.randomUUID();
  const response = adminJson(
    {
      ok: false,
      error:
        "This acceptance PDF could not be verified. Keep this page and ask the trade business to check the accepted quote record.",
      requestId,
    },
    409,
  );
  response.headers.set("X-TLink-Request-Id", requestId);
  return response;
}

export async function GET(request: Request, context: Context) {
  try {
    const link = await authoriseTradeQuoteDecisionLink(
      (await context.params).token,
    );
    if (link.status !== "accepted") {
      return adminJson(
        {
          ok: false,
          error: "Accept this quote before saving its acceptance PDF.",
        },
        409,
      );
    }
    const [stored, quote] = await Promise.all([
      storedQuoteDecision(link),
      quoteDocumentSnapshotForAuthorisedLink(link),
    ]);
    if (!stored || stored.receipt.decision !== "accepted") {
      throw new Error("QUOTE_DECISION_RECEIPT_INVALID");
    }
    const {
      buildTradeQuoteAcceptancePdfSnapshot,
      renderTradeQuoteAcceptancePdf,
      tradeQuoteAcceptancePdfFilename,
    } = await import("@/lib/trade-quote-acceptance-pdf-server");
    const snapshot = buildTradeQuoteAcceptancePdfSnapshot(quote, stored);
    const bytes = await renderTradeQuoteAcceptancePdf(snapshot, {
      origin: new URL(request.url).origin,
    });
    return new Response(bytesBody(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${tradeQuoteAcceptancePdfFilename(snapshot)}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": "application/pdf",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return acceptancePdfError(error);
  }
}
