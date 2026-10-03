import { getD1 } from "../../../../../../db";
import { authoriseTradeQuoteDecisionLink } from "@/lib/trade-quote-decision-server";
import { quoteDocumentSnapshotForAuthorisedLink, tradeQuoteTokenErrorResponse } from "@/lib/trade-quote-review-server";
import { loadCustomerJobCurrent } from "@/lib/customer-job-journey-server";
import type { CustomerJobJourney } from "@/lib/customer-job-journey";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const link = await authoriseTradeQuoteDecisionLink((await context.params).token);
    const snapshot = await quoteDocumentSnapshotForAuthorisedLink(link);
    const journey: CustomerJobJourney = { decision: link.status, workNumber: snapshot.work.number, title: snapshot.work.title,
      businessName: snapshot.business.name, expiresAt: link.expires_at, current: await loadCustomerJobCurrent(getD1(), link) };
    return Response.json({ ok: true, journey }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return tradeQuoteTokenErrorResponse(error, "job"); }
}
