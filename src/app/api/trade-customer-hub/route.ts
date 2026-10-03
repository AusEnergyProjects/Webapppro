import {getD1} from "../../../../db";
import {sameOrigin,mfaErrorResponse} from "@/lib/admin-server";
import {requireInstallerTeamAccess} from "@/lib/trade-team-server";
import {tradeHubContext,tradeHubView,tradeHubScope} from "@/lib/trade-customer-hub-server";
import {hubError,hubJson} from "@/lib/customer-quote-hub-server";
import {getCustomerProjectEvidenceBucket} from "@/lib/customer-project-evidence-bucket";
import {hubEmailStatement,drainCustomerHubEmails} from "@/lib/customer-hub-email-server";
import {startPublicLeadQuoteWorkflow} from "@/lib/public-lead-quote-workflow-server";
export const runtime='edge';
export async function GET(request:Request){try{
  const access=await requireInstallerTeamAccess(request),db=getD1(),url=new URL(request.url),workOrderId=url.searchParams.get('workOrderId')||'';
  if(!url.searchParams.has('fileId'))return hubJson(await tradeHubView(db,access,workOrderId,url.searchParams.get('matchId')||''));
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
export async function PATCH(request:Request){
  if(!sameOrigin(request))return hubJson({ok:false,error:'Request origin was not accepted.'},403);
  try{
    const access=await requireInstallerTeamAccess(request),db=getD1(),body=await request.json();
    if(!access.canManageQuotes)return hubJson({ok:false,error:'Quote management permission is required.'},403);
    if(typeof body.interested!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<0)return hubJson({ok:false,error:'Refresh before changing your interest.'},400);
    const workOrderId=String(body.workOrderId||''),matchId=String(body.matchId||'');
    const context=await tradeHubContext(db,access,workOrderId,matchId);if(!context)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
    if(context.interest_revision!==body.revision)throw new Error('CUSTOMER_HUB_CONFLICT');
    const now=new Date().toISOString();
    if(body.interested&&!context.work_order_id){
      if(!access.isOwner)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      await startPublicLeadQuoteWorkflow(db,access.ownerUid,context.match_id,now,context.match_status);
    }
    const scope=tradeHubScope(access,workOrderId,true,matchId);
    const write=await db.prepare(`INSERT INTO customer_hub_interests(match_id,opportunity_id,interested,interested_since,updated_at,updated_by_uid)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM (${scope.sql}) current WHERE current.interest_revision=?)
      ON CONFLICT(match_id) DO UPDATE SET interested=excluded.interested,revision=customer_hub_interests.revision+1,
        interested_since=CASE WHEN customer_hub_interests.interested=0 AND excluded.interested=1 THEN excluded.interested_since ELSE customer_hub_interests.interested_since END,
        updated_at=excluded.updated_at,updated_by_uid=excluded.updated_by_uid WHERE customer_hub_interests.revision=?`)
      .bind(context.match_id,context.opportunity_id,body.interested?1:0,now,now,access.actorUid,...scope.values,body.revision,body.revision).run();
    if(!write.meta.changes)throw new Error('CUSTOMER_HUB_CONFLICT');
    return hubJson(await tradeHubView(db,access,workOrderId,matchId));
  }catch(error){return mfaErrorResponse(error)||hubError(error);}
}
export async function POST(request:Request){
  if(!sameOrigin(request))return hubJson({ok:false,error:'Request origin was not accepted.'},403);
  try{
    const access=await requireInstallerTeamAccess(request),db=getD1(),body=await request.json();
    if(!access.canManageQuotes)return hubJson({ok:false,error:'Quote management permission is required.'},403);
    const context=await tradeHubContext(db,access,String(body.workOrderId||''));if(!context)throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
    if(!context.accepting)throw new Error('CUSTOMER_HUB_CLOSED');
    if(!context.interested)return hubJson({ok:false,error:'Turn on Interested to join the shared conversation.'},409);
    const reply=body.action==='reply',value=typeof (reply?body.body:body.prompt)==='string'?(reply?body.body:body.prompt).trim():'';
    if(value.length<(reply?1:5)||value.length>(reply?2000:500)||(!reply&&!['text','photo','document'].includes(body.kind)))return hubJson({ok:false,error:reply?'Add a reply of up to 2,000 characters.':'Add a clear request of 5 to 500 characters.'},400);
    const scope=tradeHubScope(access,context.work_order_id,true),now=new Date().toISOString(),id=crypto.randomUUID(),eventId=crypto.randomUUID();
    const questionId=reply?String(body.questionId||''):id;
    const guard=db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,created_at)
      SELECT ?,?,'',NULL,? WHERE NOT EXISTS(SELECT 1 FROM (${scope.sql}) current WHERE current.accepting=1 AND current.interested=1)`)
      .bind(crypto.randomUUID(),context.opportunity_id,now,...scope.values);
    const write=reply?db.prepare(`INSERT INTO customer_hub_replies(id,opportunity_id,question_id,author_type,match_id,body,created_at)
      SELECT ?,?,question.id,'trade',?,?,? FROM customer_hub_questions question WHERE question.id=? AND question.opportunity_id=?
        AND EXISTS(SELECT 1 FROM json_each(question.service_categories_json) service JOIN json_each(?) allowed ON allowed.value=service.value)
        AND (SELECT COUNT(*) FROM customer_hub_replies WHERE question_id=question.id)<60
        AND NOT EXISTS(SELECT 1 FROM customer_hub_replies WHERE question_id=question.id AND match_id=? AND body=?)`)
      .bind(id,context.opportunity_id,context.match_id,value,now,questionId,context.opportunity_id,context.matched_categories,context.match_id,value)
      :db.prepare(`INSERT INTO customer_hub_questions(id,opportunity_id,match_id,service_categories_json,kind,prompt,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM customer_hub_questions WHERE opportunity_id=?)<60
        AND NOT EXISTS(SELECT 1 FROM customer_hub_questions WHERE opportunity_id=? AND lower(trim(prompt))=lower(trim(?)))`)
      .bind(id,context.opportunity_id,context.match_id,context.service_categories,body.kind,value,now,now,context.opportunity_id,context.opportunity_id,value);
    await db.batch([guard,write,
      db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,author_match_id,created_at)
        VALUES(?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?)`).bind(eventId,context.opportunity_id,questionId,reply?'replied':'asked',context.match_id,now),
      hubEmailStatement(db,eventId,context.opportunity_id,now),guard]);
    // Delivery state is durable; provider problems never undo a saved question.
    await drainCustomerHubEmails(db,eventId).catch(()=>console.error('Customer Q&A email remains queued.'));
    return hubJson(await tradeHubView(db,access,context.work_order_id));
  }catch(error){
    if(error instanceof Error&&error.message.includes('NOT NULL'))return hubJson({ok:false,error:'This request is already shared, the conversation limit was reached, or access changed. Refresh Customer Q&A.'},409);
    return mfaErrorResponse(error)||hubError(error);
  }
}
