import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { tradeOpportunityOwnerScopeSql } from "./aea-trade-owner-server";
import { certificateLeadEligibilitySql } from "./trade-certificate-leads";
import { publicPlanContactReleaseAccessSql } from "./public-plan-enquiry.mjs";
import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";
import { authoriseCustomerHub, hubAuthorityScope, type HubAuthority } from "./customer-hub-links";
import { recoverQuoteLinkSecret } from "./trade-quote-links";
import { storedQuoteDecision, type AuthorisedTradeQuoteDecisionLink } from "./trade-quote-decision-server";
import type { CustomerQuoteHub, HubQuestion } from "./customer-quote-hub";
import { customerHubBusinessProfile } from "./customer-hub-business-profile";

type Row=Record<string,unknown>;
const strings=(value:unknown):string[]=>{ try { const list=JSON.parse(String(value||"[]")); return Array.isArray(list)?list.filter((item):item is string=>typeof item==="string"):[]; } catch{return [];} };
export const hubParticipantContactJoins=`FROM trade_opportunity_matches match
  JOIN trade_opportunities opportunity ON opportunity.id=match.opportunity_id AND opportunity.status='open' AND opportunity.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND ${tradeOpportunityOwnerScopeSql("opportunity","match.firebase_uid")}
    AND ${certificateLeadEligibilitySql("match.firebase_uid","match.matched_categories","opportunity.state")}
  JOIN trade_accounts trade ON trade.firebase_uid=match.firebase_uid AND trade.partner_type='installer' AND ${verifiedTradeAccountPredicate("trade")}
  JOIN public_trade_lead_contact_releases contact ON contact.opportunity_id=opportunity.id AND contact.source_reference=opportunity.source_reference AND contact.postcode=opportunity.postcode
    AND contact.status='active' AND contact.withdrawn_at='' AND ${publicPlanContactReleaseAccessSql("contact")}
    AND datetime(contact.granted_at) IS NOT NULL`;
export const hubParticipantJoins=`${hubParticipantContactJoins}
  JOIN customer_quote_hubs hub ON hub.opportunity_id=opportunity.id AND hub.release_id=contact.id
    AND hub.recipient_email=lower(trim(contact.customer_email)) AND hub.revoked_at='' AND hub.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE match.status IN ('offered','viewed','interested','connected')`;

export function hubJson(body:object,status=200){return Response.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}
export function hubError(error:unknown){const code=error instanceof Error?error.message:""; const conflict=/CLOSED|CONFLICT|LIMIT/.test(code);
  return hubJson({ok:false,error:code.includes("CLOSED")?"The customer is no longer accepting quotes or questions.":code.includes("CONFLICT")?"This changed in another window. Refresh and try again.":code.includes("LIMIT")?"This request has reached its file limit.":"This private project link is unavailable. Use the latest link in your email."},conflict?409:404);}

/** A no-op for valid authority; the NOT NULL constraint rolls back every write if access changed. */
export function hubWriteGuard(db:D1Database,hub:HubAuthority,requireOpen=false){const scope=hubAuthorityScope(hub);
  return db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,created_at)
    SELECT ?,?,'',NULL,? WHERE NOT (${scope.sql} ${requireOpen?"AND EXISTS(SELECT 1 FROM customer_quote_hubs WHERE id=? AND accepting=1)":""})`)
    .bind(crypto.randomUUID(),hub.opportunity_id,new Date().toISOString(),...scope.values,...(requireOpen?[hub.id]:[]));}

export async function hubQuestions(db:D1Database,opportunityId:string,accepting:boolean,allowed?:string[]):Promise<HubQuestion[]>{
  const [rows,files,replies]=await Promise.all([
    db.prepare(`SELECT question.*,trade.business_name,trade.business_website,trade.google_business_profile_url,match.id business_id FROM customer_hub_questions question
      LEFT JOIN trade_opportunity_matches match ON match.id=question.match_id AND match.opportunity_id=question.opportunity_id
      LEFT JOIN trade_accounts trade ON trade.firebase_uid=match.firebase_uid WHERE question.opportunity_id=? ORDER BY question.created_at,question.id`).bind(opportunityId).all<Row>(),
    db.prepare("SELECT id,question_id,file_name,content_type FROM customer_hub_files WHERE opportunity_id=? ORDER BY created_at,id").bind(opportunityId).all<Row>(),
    db.prepare(`SELECT reply.*,trade.business_name,trade.business_website,trade.google_business_profile_url,match.id business_id FROM customer_hub_replies reply
      LEFT JOIN trade_opportunity_matches match ON match.id=reply.match_id AND match.opportunity_id=reply.opportunity_id
      LEFT JOIN trade_accounts trade ON trade.firebase_uid=match.firebase_uid WHERE reply.opportunity_id=? ORDER BY reply.created_at,reply.id`).bind(opportunityId).all<Row>()]);
  return rows.results.filter(row=>!allowed||strings(row.service_categories_json).some(service=>allowed.includes(service))).map(row=>({id:String(row.id),prompt:String(row.prompt),kind:row.kind as HubQuestion["kind"],
    services:strings(row.service_categories_json),authorType:row.author_type==='customer'?'customer':'trade',business:String(row.business_name||''),
    ...(row.business_id?{businessProfile:customerHubBusinessProfile(row)}:{}),answer:String(row.answer),revision:Number(row.answer_revision),closed:!accepting,
    replies:replies.results.filter(reply=>reply.question_id===row.id).map(reply=>({id:String(reply.id),body:String(reply.body),authorType:reply.author_type==='customer'?'customer':'trade',
      business:String(reply.business_name||''),...(reply.business_id?{businessProfile:customerHubBusinessProfile(reply)}:{}),createdAt:String(reply.created_at)})),
    files:files.results.filter(file=>file.question_id===row.id).map(file=>({id:String(file.id),name:String(file.file_name),type:String(file.content_type)}))}));
}

export async function loadCustomerQuoteHub(db:D1Database,hub:HubAuthority):Promise<CustomerQuoteHub>{
  const scope=hubAuthorityScope(hub);
  const details=await db.prepare(`SELECT opportunity.title,opportunity.source_reference,opportunity.service_categories,hub.accepting,hub.revision
    FROM customer_quote_hubs hub JOIN trade_opportunities opportunity ON opportunity.id=hub.opportunity_id WHERE hub.id=? AND ${scope.sql}`)
    .bind(hub.id,...scope.values).first<Row>();
  if(!details)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const quotes=await db.prepare(`SELECT link.id,trade.business_name,trade.business_website,trade.google_business_profile_url,participation.id business_id,quote.quote_number,version.total_cents,link.status,work.service_categories,
      link.expires_at,version.valid_until,version.status version_status
    FROM trade_crm_quote_links link
    JOIN trade_crm_quote_versions version ON version.id=link.quote_version_id AND version.quote_id=link.quote_id AND version.firebase_uid=link.firebase_uid
    JOIN trade_crm_quotes quote ON quote.id=link.quote_id AND quote.work_order_id=link.work_order_id AND quote.firebase_uid=link.firebase_uid AND quote.crm_customer_id=link.crm_customer_id
    JOIN trade_work_orders work ON work.id=link.work_order_id AND work.firebase_uid=link.firebase_uid AND work.source_type='public_lead'
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.crm_customer_id=link.crm_customer_id AND detail.customer_source='public_lead_released'
    JOIN trade_opportunity_matches participation ON participation.id=work.source_reference AND participation.firebase_uid=work.firebase_uid AND participation.opportunity_id=?
    JOIN trade_accounts trade ON trade.firebase_uid=link.firebase_uid
    WHERE link.revoked_at='' AND link.status IN ('active','accepted','declined') AND version.version_number=quote.current_version_number
      AND (link.status<>'active' OR (work.record_status='active' AND work.stage<>'cancelled' AND detail.pipeline_stage<>'lost'))
      AND EXISTS(SELECT 1 ${hubParticipantJoins} AND match.id=participation.id)
    ORDER BY link.created_at DESC,link.id`).bind(hub.opportunity_id).all<Row>();
  const now=new Date().toISOString();
  const questions=await hubQuestions(db,hub.opportunity_id,Boolean(details.accepting));
  if(!await db.prepare(`SELECT 1 WHERE ${scope.sql}`).bind(...scope.values).first())throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return {title:String(details.title),reference:String(details.source_reference),expiresAt:hub.expires_at,accepting:Boolean(details.accepting),revision:Number(details.revision),
    services:strings(details.service_categories).map(id=>({id,label:ENERGY_SERVICE_LABELS[id]||id})),
    quotes:quotes.results.map(row=>({id:String(row.id),business:String(row.business_name),businessProfile:customerHubBusinessProfile(row),number:String(row.quote_number),services:strings(row.service_categories),
      totalCents:Number(row.total_cents),status:String(row.status),blocked:row.status==='active'&&(String(row.expires_at)<=now || (Boolean(row.valid_until)&&String(row.valid_until)<now.slice(0,10)))})),questions};
}

export async function hubQuoteRecord(db:D1Database,token:string,linkId:string){
  const hub=await authoriseCustomerHub(db,token), scope=hubAuthorityScope(hub);
  const link=await db.prepare(`SELECT link.*,version.version_number,version.status version_status,version.document_snapshot_json,version.valid_until,
      quote.current_version_number,trade.invoice_payment_account_name,trade.invoice_payment_bsb,trade.invoice_payment_account_number,
      trade.invoice_payment_reference,trade.invoice_default_terms
    FROM trade_crm_quote_links link
    JOIN trade_crm_quote_versions version ON version.id=link.quote_version_id AND version.quote_id=link.quote_id AND version.firebase_uid=link.firebase_uid
    JOIN trade_crm_quotes quote ON quote.id=link.quote_id AND quote.firebase_uid=link.firebase_uid AND quote.work_order_id=link.work_order_id AND quote.crm_customer_id=link.crm_customer_id
    JOIN trade_work_orders work ON work.id=link.work_order_id AND work.firebase_uid=link.firebase_uid AND work.source_type='public_lead'
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.crm_customer_id=link.crm_customer_id AND detail.customer_source='public_lead_released'
    JOIN trade_opportunity_matches participation ON participation.id=work.source_reference AND participation.firebase_uid=work.firebase_uid AND participation.opportunity_id=?
    JOIN trade_accounts trade ON trade.firebase_uid=link.firebase_uid
    WHERE link.id=? AND link.revoked_at='' AND link.status IN ('active','accepted','declined') AND ${scope.sql}
      AND (link.status<>'active' OR (work.record_status='active' AND work.stage<>'cancelled' AND detail.pipeline_stage<>'lost'
        AND version.status='issued' AND version.version_number=quote.current_version_number))
      AND EXISTS(SELECT 1 ${hubParticipantJoins} AND match.id=participation.id)`)
    .bind(hub.opportunity_id,linkId,...scope.values).first<AuthorisedTradeQuoteDecisionLink>();
  if(!link)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return {hub,link};
}

export async function hubQuoteView(db:D1Database,token:string,id:string){const {link}=await hubQuoteRecord(db,token,id);
  if(link.status!=="active") { const decision=await storedQuoteDecision(link); if(!decision)throw new Error("CUSTOMER_HUB_ACCESS_ENDED"); await hubQuoteRecord(db,token,id); return {ok:true,receipt:decision.receipt}; }
  const now=new Date().toISOString();
  if(link.expires_at<=now || (link.valid_until&&String(link.valid_until)<now.slice(0,10)) || link.version_status!=="issued" || Number(link.version_number)!==Number(link.current_version_number))throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  const secret=await recoverQuoteLinkSecret(String(link.encrypted_token),link.id,Number(link.token_issue),link.token_hash);
  const current=await hubQuoteRecord(db,token,id);
  if(current.link.status!==link.status || current.link.token_hash!==link.token_hash)throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
  return {ok:true,quoteToken:`${link.id}.${secret}`};
}
