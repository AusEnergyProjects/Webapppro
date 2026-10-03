import {getD1} from "../../../../../../../../db";
import {hubQuoteRecord,hubError} from "@/lib/customer-quote-hub-server";
import {quoteDocumentSnapshotForAuthorisedLink} from "@/lib/trade-quote-review-server";
import {storedQuoteDecision} from "@/lib/trade-quote-decision-server";
export const runtime='edge';
export async function GET(request:Request,context:{params:Promise<{token:string;id:string}>}){try{
  const {token,id}=await context.params,db=getD1(),{link}=await hubQuoteRecord(db,token,id);
  const [stored,quote]=await Promise.all([storedQuoteDecision(link),quoteDocumentSnapshotForAuthorisedLink(link)]);
  if(!stored||stored.receipt.decision!=='accepted')throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  const {buildTradeQuoteAcceptancePdfSnapshot,renderTradeQuoteAcceptancePdf,tradeQuoteAcceptancePdfFilename}=await import("@/lib/trade-quote-acceptance-pdf-server");
  const snapshot=buildTradeQuoteAcceptancePdfSnapshot(quote,stored),bytes=await renderTradeQuoteAcceptancePdf(snapshot,{origin:new URL(request.url).origin});
  await hubQuoteRecord(db,token,id);
  return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${tradeQuoteAcceptancePdfFilename(snapshot)}"`,
    'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}catch(error){return hubError(error);}}
