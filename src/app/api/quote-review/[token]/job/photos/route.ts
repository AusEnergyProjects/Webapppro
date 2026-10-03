import { getD1 } from "../../../../../../../db";
import { authoriseTradeQuoteDecisionLink } from "@/lib/trade-quote-decision-server";
import { tradeQuoteTokenErrorResponse } from "@/lib/trade-quote-review-server";
import { customerJobPhotoToken } from "@/lib/customer-job-journey-server";
import { GET as readPhotos, POST as writePhotos, DELETE as removePhoto } from "../../../../job-information/[token]/route";

export const runtime = "edge";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

async function photoContext(context: Context) {
  const link = await authoriseTradeQuoteDecisionLink((await context.params).token, { requireCurrentTradeAccess: true });
  return { params: Promise.resolve({ token: await customerJobPhotoToken(getD1(), link) }), quoteLink: link };
}
export async function GET(request: Request, context: Context) {
  try { return await readPhotos(request, await photoContext(context)); }
  catch (error) { return tradeQuoteTokenErrorResponse(error, "photos"); }
}
export async function POST(request: Request, context: Context) {
  try { return await writePhotos(request, await photoContext(context)); }
  catch (error) { return tradeQuoteTokenErrorResponse(error, "photos"); }
}
export async function DELETE(request: Request, context: Context) {
  try { return await removePhoto(request, await photoContext(context)); }
  catch (error) { return tradeQuoteTokenErrorResponse(error, "photos"); }
}
