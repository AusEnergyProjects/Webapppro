import {getD1} from "../../../../db";
import {sameOrigin,mfaErrorResponse} from "@/lib/admin-server";
import {requireInstallerTeamAccess} from "@/lib/trade-team-server";
import {tradeHubContext,tradeHubView,tradeHubScope} from "@/lib/trade-customer-hub-server";
import {hubError,hubJson} from "@/lib/customer-quote-hub-server";
import {getCustomerProjectEvidenceBucket} from "@/lib/customer-project-evidence-bucket";
export const runtime='edge';
export async function GET(request:Request){try{
  const access=await requireInstallerTeamAccess(request),db=getD1(),url=new URL(request.url),workOrderId=url.searchParams.get('workOrderId')||'';
  if(!url.searchParams.has('fileId'))return hubJson(await tradeHubView(db,access,workOrderId));
  const context=await tradeHubContext(db,access,workOrderId);if(!context)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  const file=await db.prepare(`SELECT file.file_name,file.content_type,file.object_key FROM customer_hub_files file
    JOIN customer_hub_questions question ON question.id=file.question_id AND question.opportunity_id=file.opportunity_id
    WHERE file.id=? AND file.opportunity_id=? AND EXISTS(SELECT 1 FROM json_each(question.service_categories_json) service
      JOIN json_each(?) allowed ON allowed.value=service.value)`)
    .bind(url.searchParams.get('fileId'),context.opportunity_id,context.matched_categories).first<{file_name:string;content_type:string;object_key:string}>();
  if(!file)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  const object=await getCustomerProjectEvidenceBucket().get(file.object_key);if(!object||!await tradeHubContext(db,access,workOrderId))throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
  return new Response(object.body,{headers:{'Content-Type':file.content_type,'Content-Disposition':`attachment; filename="${file.file_name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`,
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
}catch(error){return mfaErrorResponse(error)||hubError(error);}}
export async function POST(request:Request){
  if(!sameOrigin(request))return hubJson({ok:false,error:'Request origin was not accepted.'},403);
  try{const access=await requireInstallerTeamAccess(request),db=getD1(),body=await request.json();
    if(!access.canManageQuotes)return hubJson({ok:false,error:'Quote management permission is required.'},403);
    const context=await tradeHubContext(db,access,String(body.workOrderId||''));if(!context)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
    if(!context.accepting)throw new Error('CUSTOMER_HUB_CLOSED');
    const prompt=typeof body.prompt==='string'?body.prompt.trim():'';
    if(prompt.length<5||prompt.length>500||!['text','photo','document'].includes(body.kind))return hubJson({ok:false,error:'Add a clear request of 5 to 500 characters.'},400);
    const scope=tradeHubScope(access,context.work_order_id,true),now=new Date().toISOString();
    const write=await db.prepare(`INSERT INTO customer_hub_questions(id,opportunity_id,match_id,service_categories_json,kind,prompt,created_at,updated_at)
      SELECT ?,?,work.source_reference,?,?,?, ?,? FROM trade_work_orders work WHERE work.id=? AND work.firebase_uid=?
        AND EXISTS(SELECT 1 FROM (${scope.sql}) current WHERE current.accepting=1)
        AND (SELECT COUNT(*) FROM customer_hub_questions WHERE opportunity_id=?)<60
        AND NOT EXISTS(SELECT 1 FROM customer_hub_questions WHERE opportunity_id=? AND lower(trim(prompt))=lower(trim(?)))`)
      .bind(crypto.randomUUID(),context.opportunity_id,context.service_categories,body.kind,prompt,now,now,context.work_order_id,access.ownerUid,...scope.values,context.opportunity_id,context.opportunity_id,prompt).run();
    const current=await tradeHubContext(db,access,context.work_order_id);if(!current?.accepting)throw new Error('CUSTOMER_HUB_CLOSED');
    if(!write.meta.changes){
      if(!await db.prepare(scope.sql).bind(...scope.values).first())throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      const duplicate=await db.prepare('SELECT id FROM customer_hub_questions WHERE opportunity_id=? AND lower(trim(prompt))=lower(trim(?))')
        .bind(context.opportunity_id,prompt).first();
      return hubJson({ok:false,error:duplicate?'This request is already in the shared list. Check its answer before asking again.':'This project has reached its limit of 60 shared requests.'},409);
    }
    return hubJson(await tradeHubView(db,access,context.work_order_id));
  }catch(error){return mfaErrorResponse(error)||hubError(error);}
}
