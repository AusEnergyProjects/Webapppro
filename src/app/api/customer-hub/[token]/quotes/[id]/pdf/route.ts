import {getD1} from "../../../../../../../../db";
import {hubQuoteRecord,hubError} from "@/lib/customer-quote-hub-server";
import {quoteDocumentSnapshotForAuthorisedLink} from "@/lib/trade-quote-review-server";
import {issuedTradeQuotePdf} from "@/lib/trade-quote-issued-pdf-server";
export const runtime="edge";
export async function GET(request:Request,context:{params:Promise<{token:string;id:string}>}){try{
  const {token,id}=await context.params,db=getD1(),{link}=await hubQuoteRecord(db,token,id);
  const snapshot=await quoteDocumentSnapshotForAuthorisedLink(link),pdf=await issuedTradeQuotePdf({ownerUid:link.firebase_uid,quoteVersionId:link.quote_version_id,snapshot,origin:new URL(request.url).origin});
  await hubQuoteRecord(db,token,id);
  return new Response(Uint8Array.from(pdf.bytes).buffer,{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="quote.pdf"',"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
}catch(error){return hubError(error);}}
