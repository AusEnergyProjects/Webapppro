import { getD1 } from "../../../../../db";
import { sameOrigin } from "@/lib/admin-server";
import { authoriseCustomerHub } from "@/lib/customer-hub-links";
import { hubError,hubJson,hubWriteGuard,loadCustomerQuoteHub } from "@/lib/customer-quote-hub-server";
export const runtime="edge";
export const dynamic="force-dynamic";
type Context={params:Promise<{token:string}>};
export async function GET(_request:Request,context:Context){try{const db=getD1(),hub=await authoriseCustomerHub(db,(await context.params).token);return hubJson({ok:true,hub:await loadCustomerQuoteHub(db,hub)});}catch(error){return hubError(error);}}
export async function PATCH(request:Request,context:Context){
  if(!sameOrigin(request))return hubJson({ok:false,error:"Request origin was not accepted."},403);
  try{const db=getD1(),hub=await authoriseCustomerHub(db,(await context.params).token),body=await request.json();
    if(typeof body.accepting!=="boolean" || !Number.isSafeInteger(body.revision))return hubJson({ok:false,error:"Refresh the project before changing this setting."},400);
    const now=new Date().toISOString();
    await db.batch([hubWriteGuard(db,hub),
      db.prepare("UPDATE customer_quote_hubs SET accepting=?,revision=revision+1 WHERE id=? AND revision=?").bind(body.accepting?1:0,hub.id,body.revision),
      db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,created_at) VALUES(?,?,'',CASE WHEN changes()=1 THEN ? ELSE NULL END,?)`)
        .bind(crypto.randomUUID(),hub.opportunity_id,body.accepting?"opened":"closed",now)]);
    return hubJson({ok:true,hub:await loadCustomerQuoteHub(db,hub)});
  }catch(error){if(error instanceof Error&&error.message.includes("NOT NULL"))return hubJson({ok:false,error:"This changed in another window. Refresh and try again."},409);return hubError(error);}
}
export async function POST(request:Request,context:Context){
  if(!sameOrigin(request))return hubJson({ok:false,error:"Request origin was not accepted."},403);
  try{const db=getD1(),hub=await authoriseCustomerHub(db,(await context.params).token),body=await request.json();
    const answer=typeof body.answer==="string"?body.answer.trim():"";
    if(!answer || answer.length>2000 || typeof body.questionId!=="string" || !Number.isSafeInteger(body.revision))return hubJson({ok:false,error:"Add an answer of up to 2,000 characters."},400);
    const now=new Date().toISOString();
    await db.batch([hubWriteGuard(db,hub,true),
      db.prepare("UPDATE customer_hub_questions SET answer=?,answer_revision=answer_revision+1,updated_at=? WHERE id=? AND opportunity_id=? AND answer_revision=?")
        .bind(answer,now,body.questionId,hub.opportunity_id,body.revision),
      db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,created_at) VALUES(?,?,?,CASE WHEN changes()=1 THEN 'answered' ELSE NULL END,?)`)
        .bind(crypto.randomUUID(),hub.opportunity_id,body.questionId,now)]);
    return hubJson({ok:true,hub:await loadCustomerQuoteHub(db,hub)});
  }catch(error){if(error instanceof Error&&error.message.includes("NOT NULL"))return hubJson({ok:false,error:"The project closed or this answer changed. Refresh before sharing."},409);return hubError(error);}
}
