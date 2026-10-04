import {hubParticipantContactJoins,hubParticipantJoins,hubQuestions} from "./customer-quote-hub-server";
import {jobMemberSql} from "./trade-job-collaboration";
import type {TeamAccess} from "./trade-team-server";
import type {TradeHubQuestion} from "./customer-quote-hub";

export type TradeHubContext={id:string;release_id:string;recipient_email:string;opportunity_id:string;work_order_id:string;customer_id:string;accepting:number;matched_categories:string;service_categories:string;match_id:string;match_status:string;interested:number;interest_revision:number};
export function tradeHubScope(access:TeamAccess,workOrderId:string,writing=false,matchId='',missingHub=false){
  const owner=access.isOwner&&access.actorUid===access.ownerUid;
  const leadOnly=Boolean(matchId&&owner);
  const customerJob=`FROM trade_work_orders work
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.customer_source='public_lead_released'
    JOIN trade_crm_customers customer ON customer.id=detail.crm_customer_id AND customer.firebase_uid=work.firebase_uid AND customer.record_status='active'
    WHERE work.source_type='public_lead' AND work.source_reference=match.id AND work.firebase_uid=match.firebase_uid AND work.record_status='active'
      AND (?='' OR work.id=?) ORDER BY work.id LIMIT 1`;
  return {sql:`SELECT ${missingHub?"'' id,contact.id release_id,lower(trim(contact.customer_email)) recipient_email,opportunity.id opportunity_id,1 accepting":"hub.id,hub.release_id,hub.recipient_email,hub.opportunity_id,hub.accepting"},match.matched_categories,opportunity.service_categories,match.id match_id,match.status match_status,
    COALESCE((SELECT interested FROM customer_hub_interests WHERE match_id=match.id),0) interested,
    COALESCE((SELECT revision FROM customer_hub_interests WHERE match_id=match.id),0) interest_revision,
    COALESCE((SELECT work.id ${customerJob}),'') work_order_id,
    COALESCE((SELECT customer.id ${customerJob}),'') customer_id
  ${missingHub?`${hubParticipantContactJoins} WHERE match.status IN ('offered','viewed','interested','connected')
    AND NOT EXISTS(SELECT 1 FROM customer_quote_hubs existing WHERE existing.opportunity_id=opportunity.id)`:hubParticipantJoins} AND match.firebase_uid=?
  AND ${leadOnly?'match.id=?':`EXISTS(SELECT 1 FROM trade_work_orders work JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid
    WHERE work.id=? AND work.firebase_uid=match.firebase_uid AND work.source_type='public_lead' AND work.source_reference=match.id
      AND work.record_status='active' AND detail.customer_source='public_lead_released'
      AND ${owner?'1=1':`EXISTS(SELECT 1 FROM trade_team_members member WHERE member.id=? AND member.owner_uid=work.firebase_uid AND member.member_uid=? AND member.status='active'
        AND member.can_view_quotes=1 ${writing?'AND member.can_manage_quotes=1':''}
        AND ((member.job_scope='team' AND NOT EXISTS(SELECT 1 FROM trade_crew_members crew WHERE crew.owner_uid=member.owner_uid AND crew.member_id=member.id)) OR ${jobMemberSql('work','member.id')}))`}
      AND (?<>'own' OR ${jobMemberSql("work")}))`}`,
    values:[workOrderId,workOrderId,workOrderId,workOrderId,access.ownerUid,...(leadOnly?[matchId]:[workOrderId,...(owner?[]:[access.memberId,access.actorUid]),!access.isOwner&&access.jobScope==='own'?'own':'team',access.memberId||''])]};
}
export async function tradeHubContext(db:D1Database,access:TeamAccess,workOrderId:string,matchId=''){
  if(!access.canViewQuotes)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const scope=tradeHubScope(access,workOrderId,false,matchId);
  const current=await db.prepare(scope.sql).bind(...scope.values).first<TradeHubContext>();
  if(current||!matchId||!access.isOwner||access.actorUid!==access.ownerUid)return current;
  const eligible=tradeHubScope(access,workOrderId,false,matchId,true);
  return db.prepare(eligible.sql).bind(...eligible.values).first<TradeHubContext>();
}
export async function tradeHubView(db:D1Database,access:TeamAccess,workOrderId:string,matchId=''){
  const context=await tradeHubContext(db,access,workOrderId,matchId);
  if(!context)return {ok:true,available:false};
  const shared=context.id?await hubQuestions(db,context.opportunity_id,Boolean(context.accepting),JSON.parse(context.matched_categories)):[];
  // Explicit projection keeps other businesses' identities and quote information private.
  const questions:TradeHubQuestion[]=shared.map(q=>({id:q.id,prompt:q.prompt,kind:q.kind,services:q.services,authorType:q.authorType,
    answer:q.answer,revision:q.revision,closed:q.closed,files:q.files,
    replies:q.replies.map(r=>({id:r.id,body:r.body,authorType:r.authorType,createdAt:r.createdAt}))}));
  const current=await tradeHubContext(db,access,workOrderId,matchId);
  if(!current)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return {ok:true,available:true,accepting:Boolean(current.accepting),interested:Boolean(current.interested),interestRevision:current.interest_revision,
    workOrderId:current.work_order_id,customerId:current.customer_id,canManageInterest:access.canManageQuotes,canAsk:access.canManageQuotes&&Boolean(current.id),questions};
}
export async function hubTradeNotifications(db:D1Database,access:TeamAccess){
  if(!access.canViewQuotes||(!access.isOwner&&(!access.canReceiveCustomerQaNotifications||!access.canViewCustomers)))return [];
  const rows=await db.prepare(`SELECT event.id,event.question_id,event.event_type,event.author_match_id,event.created_at,work.id work_order_id,work.work_number,detail.crm_customer_id
    FROM customer_hub_events event JOIN trade_opportunity_matches participation ON participation.opportunity_id=event.opportunity_id AND participation.firebase_uid=?
    JOIN customer_hub_interests interest ON interest.match_id=participation.id AND interest.opportunity_id=event.opportunity_id AND interest.interested=1 AND event.created_at>=interest.interested_since
    JOIN trade_work_orders work ON work.source_reference=participation.id AND work.source_type='public_lead' AND work.firebase_uid=participation.firebase_uid AND work.record_status='active'
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.customer_source='public_lead_released'
    WHERE detail.crm_customer_id<>''
      AND EXISTS(SELECT 1 ${hubParticipantJoins} AND match.id=participation.id)
      AND (?<>'own' OR ${jobMemberSql("work")})
      AND (?=1 OR EXISTS(SELECT 1 FROM trade_team_members member WHERE member.id=? AND member.owner_uid=work.firebase_uid AND member.member_uid=? AND member.status='active'
        AND member.can_receive_customer_qa_notifications=1 AND member.can_view_customers=1))
    ORDER BY event.created_at DESC,event.id DESC LIMIT 80`)
    .bind(access.ownerUid,!access.isOwner&&access.jobScope==='own'?'own':'team',access.memberId||'',access.isOwner?1:0,access.memberId||'',access.actorUid)
    .all<{id:string;question_id:string;event_type:string;author_match_id:string;created_at:string;work_order_id:string;work_number:string;crm_customer_id:string}>();
  const permitted=await Promise.all(rows.results.map(async row=>{const current=await tradeHubContext(db,access,row.work_order_id);return current?.interested?row:null;}));
  if(!access.isOwner&&!await db.prepare(`SELECT 1 FROM trade_team_members WHERE id=? AND owner_uid=? AND member_uid=? AND status='active'
    AND can_receive_customer_qa_notifications=1 AND can_view_customers=1 AND can_view_quotes=1`).bind(access.memberId,access.ownerUid,access.actorUid).first())return [];
  return permitted.filter(row=>row!==null).map(row=>({id:`customer-hub:${row.id}`,targetKind:'customer' as const,targetId:row.crm_customer_id,workOrderId:row.work_order_id,workNumber:row.work_number,questionId:row.question_id,
    title:row.event_type==='asked'?(row.author_match_id?'New shared job question':'Customer asked a shared question'):row.event_type==='replied'?'New reply in Customer Q&A':row.event_type==='answered'?'Customer answered a shared question':row.event_type==='file_added'?'Customer uploaded a file for review':row.event_type==='file_removed'?'Customer removed a shared file':row.event_type==='closed'?'Customer closed quotes and questions':'Customer reopened quotes and questions',
    summary:'Open Customer Q&A to review the update.',createdAt:row.created_at,targetTab:'quote' as const,source:'customer' as const}));
}
