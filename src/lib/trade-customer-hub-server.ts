import {hubParticipantJoins,hubQuestions} from "./customer-quote-hub-server";
import {jobMemberSql} from "./trade-job-collaboration";
import type {TeamAccess} from "./trade-team-server";

export type TradeHubContext={id:string;opportunity_id:string;work_order_id:string;accepting:number;matched_categories:string;service_categories:string};
export function tradeHubScope(access:TeamAccess,workOrderId:string,writing=false){return {sql:`SELECT hub.id,hub.opportunity_id,hub.accepting,match.matched_categories,opportunity.service_categories,? work_order_id
  ${hubParticipantJoins} AND match.firebase_uid=? AND EXISTS(SELECT 1 FROM customer_quote_hubs active_hub WHERE active_hub.opportunity_id=opportunity.id AND active_hub.revoked_at='' AND active_hub.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  AND EXISTS(SELECT 1 FROM trade_work_orders work JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid
    WHERE work.id=? AND work.firebase_uid=match.firebase_uid AND work.source_type='public_lead' AND work.source_reference=match.id
      AND work.record_status='active' AND detail.customer_source='public_lead_released'
      AND ${access.isOwner&&access.actorUid===access.ownerUid?'1=1':`EXISTS(SELECT 1 FROM trade_team_members member WHERE member.id=? AND member.owner_uid=work.firebase_uid AND member.member_uid=? AND member.status='active'
        AND member.can_view_quotes=1 ${writing?'AND member.can_manage_quotes=1':''}
        AND ((member.job_scope='team' AND NOT EXISTS(SELECT 1 FROM trade_crew_members crew WHERE crew.owner_uid=member.owner_uid AND crew.member_id=member.id)) OR ${jobMemberSql('work','member.id')}))`}
      AND (?<>'own' OR ${jobMemberSql("work")}))`,
    values:[workOrderId,access.ownerUid,workOrderId,...(access.isOwner&&access.actorUid===access.ownerUid?[]:[access.memberId,access.actorUid]),!access.isOwner&&access.jobScope==='own'?'own':'team',access.memberId||'']};}
export async function tradeHubContext(db:D1Database,access:TeamAccess,workOrderId:string){
  if(!access.canViewQuotes)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const scope=tradeHubScope(access,workOrderId);
  return db.prepare(scope.sql).bind(...scope.values).first<TradeHubContext>();
}
export async function tradeHubView(db:D1Database,access:TeamAccess,workOrderId:string){const context=await tradeHubContext(db,access,workOrderId);
  if(!context)return {ok:true,available:false};
  const questions=await hubQuestions(db,context.opportunity_id,Boolean(context.accepting),JSON.parse(context.matched_categories));
  if(!await tradeHubContext(db,access,workOrderId))throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return {ok:true,available:true,accepting:Boolean(context.accepting),canAsk:access.canManageQuotes,questions};}

export async function hubTradeNotifications(db:D1Database,access:TeamAccess){
  if(!access.canViewQuotes)return [];
  const rows=await db.prepare(`SELECT event.id,event.event_type,event.created_at,work.id work_order_id,work.work_number
    FROM customer_hub_events event JOIN trade_opportunity_matches participation ON participation.opportunity_id=event.opportunity_id AND participation.firebase_uid=?
    JOIN trade_work_orders work ON work.source_reference=participation.id AND work.source_type='public_lead' AND work.firebase_uid=participation.firebase_uid AND work.record_status='active'
    JOIN customer_quote_hubs hub ON hub.opportunity_id=event.opportunity_id AND hub.revoked_at=''
    WHERE EXISTS(SELECT 1 ${hubParticipantJoins} AND match.id=participation.id)
      AND (?<>'own' OR ${jobMemberSql("work")})
    ORDER BY event.created_at DESC,event.id DESC LIMIT 80`)
    .bind(access.ownerUid,!access.isOwner&&access.jobScope==='own'?'own':'team',access.memberId||'').all<{id:string;event_type:string;created_at:string;work_order_id:string;work_number:string}>();
  const permitted=await Promise.all(rows.results.map(async row=>await tradeHubContext(db,access,row.work_order_id)?row:null));
  return permitted.filter(row=>row!==null).map(row=>({id:`customer-hub:${row.id}`,targetKind:'job' as const,targetId:row.work_order_id,workOrderId:row.work_order_id,workNumber:row.work_number,
    title:row.event_type==='answered'?'Customer answered a shared question':row.event_type==='file_added'?'Customer uploaded a file for review':row.event_type==='closed'?'Customer closed quotes and questions':'Customer reopened quotes and questions',
    summary:'Open the shared customer requests in this job.',createdAt:row.created_at,targetTab:'quote' as const,source:'customer' as const}));
}
