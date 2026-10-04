import {encryptProtectedPayload,decryptProtectedPayload} from "./trade-integration-crypto";
import { hubParticipantJoins } from './customer-quote-hub-server';
import { authoriseCustomerHub, customerHubEmailUrl } from './customer-hub-links';
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration, serviceReminderRetryAt } from './service-reminder-delivery';
import {customerHubEmailCta,customerHubUpdateEmailHtml} from './customer-hub-email.mjs';

export type CustomerHubEmailRetryState = {
  status:string; attempts:number; provider_id:string; encrypted_payload:string; first_attempt_at:string;
};
const retryWindowMs=23*3600000;
export function customerHubEmailRetryable(row:CustomerHubEmailRetryState,now=Date.now()){
  if(!['stopped','failed','unknown'].includes(row.status)||row.provider_id||!Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>=4)return false;
  // The payload is committed before the provider is called. An empty stopped
  // payload proves this event never reached the provider, even after 23 hours.
  if(row.status==='stopped'&&!row.encrypted_payload)return true;
  const first=Date.parse(row.first_attempt_at);
  return Number.isFinite(first)&&first<=now&&first>now-retryWindowMs;
}

/** Recover one event without changing its recipient, content or attempt budget. */
export async function retryCustomerHubEmail(db:D1Database,eventId:string):Promise<
  {ok:true;status:string}|{ok:false;error:'DELIVERY_NOT_FOUND'|'DELIVERY_NOT_RETRYABLE'}
>{
  const row=await db.prepare('SELECT status,attempts,provider_id,encrypted_payload,first_attempt_at,updated_at FROM customer_hub_email_deliveries WHERE event_id=?')
    .bind(eventId).first<CustomerHubEmailRetryState&{updated_at:string}>();
  if(!row)return {ok:false,error:'DELIVERY_NOT_FOUND'};
  if(!customerHubEmailRetryable(row))return {ok:false,error:'DELIVERY_NOT_RETRYABLE'};
  const claim=await db.prepare(`UPDATE customer_hub_email_deliveries SET status='pending',next_attempt_at='',updated_at=?,
    first_attempt_at=CASE WHEN status='stopped' AND encrypted_payload='' THEN '' ELSE first_attempt_at END
    WHERE event_id=? AND status=? AND attempts=? AND provider_id=? AND encrypted_payload=? AND first_attempt_at=? AND updated_at=?`)
    .bind(new Date().toISOString(),eventId,row.status,row.attempts,row.provider_id,row.encrypted_payload,row.first_attempt_at,row.updated_at).run();
  if(!claim.meta.changes)return {ok:false,error:'DELIVERY_NOT_RETRYABLE'};
  await drainCustomerHubEmails(db,eventId);
  const current=await db.prepare('SELECT status FROM customer_hub_email_deliveries WHERE event_id=?').bind(eventId).first<{status:string}>();
  return current?{ok:true,status:current.status}:{ok:false,error:'DELIVERY_NOT_FOUND'};
}

type DeliveryStage='configuration'|'recipient'|'payload'|'authority'|'provider'|'recording';
function deliveryDiagnostic(eventId:string,stage:DeliveryStage,code:string){
  console.error('Customer Q&A email delivery.',{eventId,stage,code});
}

/** Queued with the shared question/reply so email failure cannot lose the conversation. */
export function hubEmailStatement(db:D1Database,eventId:string,opportunityId:string,now:string){
  return db.prepare(`INSERT INTO customer_hub_email_deliveries(event_id,release_id,email_hash,updated_at)
    SELECT ?,hub.release_id,hub.email_hash,? FROM customer_quote_hubs hub WHERE hub.opportunity_id=? AND hub.revoked_at=''`)
    .bind(eventId,now,opportunityId);
}
export async function drainCustomerHubEmails(db:D1Database,eventId=''){
  if(!serviceReminderProviderConfiguration().email.configured){
    if(eventId)deliveryDiagnostic(eventId,'configuration','EMAIL_NOT_CONFIGURED');
    return;
  }
  const now=new Date().toISOString();
  // Retry only inside the provider's 24-hour idempotency window. Never blindly resend old ambiguous attempts.
  await db.prepare(`UPDATE customer_hub_email_deliveries SET status='unknown',updated_at=? WHERE status IN ('sending','failed')
    AND first_attempt_at<>'' AND first_attempt_at<=?`).bind(now,new Date(Date.now()-23*3600000).toISOString()).run();
  const rows=await db.prepare(`SELECT delivery.*,event.opportunity_id,event.question_id,event.event_type,event.author_match_id,opportunity.title
    FROM customer_hub_email_deliveries delivery JOIN customer_hub_events event ON event.id=delivery.event_id
    JOIN trade_opportunities opportunity ON opportunity.id=event.opportunity_id
    WHERE (?='' OR delivery.event_id=?) AND delivery.attempts<4 AND delivery.next_attempt_at<=?
      AND (delivery.status IN ('pending','failed') OR (delivery.status='sending' AND delivery.updated_at<?))
    ORDER BY delivery.updated_at LIMIT 20`).bind(eventId,eventId,now,new Date(Date.now()-10*60000).toISOString())
    .all<{event_id:string;release_id:string;email_hash:string;opportunity_id:string;question_id:string;author_match_id:string;event_type:string;title:string;attempts:number;encrypted_payload:string}>();
  for(const row of rows.results){
    const claim=await db.prepare(`UPDATE customer_hub_email_deliveries SET status='sending',attempts=attempts+1,
      first_attempt_at=CASE WHEN first_attempt_at='' THEN ? ELSE first_attempt_at END,updated_at=?
      WHERE event_id=? AND attempts=? AND (status IN ('pending','failed') OR (status='sending' AND updated_at<?))`)
      .bind(now,now,row.event_id,row.attempts,new Date(Date.now()-10*60000).toISOString()).run();
    if(!claim.meta.changes)continue;
    let stage:DeliveryStage='recipient';
    try{
      const currentRecipient=(tokenHash='')=>db.prepare(`SELECT hub.recipient_email ${hubParticipantJoins} AND match.id=? AND opportunity.id=?
        AND hub.release_id=? AND hub.email_hash=? AND hub.accepting=1 AND (?='' OR hub.token_hash=?)
        AND EXISTS(SELECT 1 FROM customer_hub_email_deliveries claim WHERE claim.event_id=? AND claim.status='sending' AND claim.attempts=?)
        AND NOT EXISTS(SELECT 1 FROM public_plan_customer_email_suppressions WHERE email_hash=hub.email_hash)
        AND NOT EXISTS(SELECT 1 FROM customer_accounts account WHERE lower(trim(account.email))=hub.recipient_email
          AND (account.account_status<>'active' OR EXISTS(SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid=account.firebase_uid AND optout.channel='email')))`)
        .bind(row.author_match_id,row.opportunity_id,row.release_id,row.email_hash,tokenHash,tokenHash,row.event_id,row.attempts+1).first<{recipient_email:string}>();
      const recipient=await currentRecipient();
      if(!recipient){
        await db.prepare("UPDATE customer_hub_email_deliveries SET status='stopped',updated_at=? WHERE event_id=? AND status='sending' AND attempts=?").bind(now,row.event_id,row.attempts+1).run();
        deliveryDiagnostic(row.event_id,stage,'DELIVERY_NO_LONGER_ELIGIBLE');continue;
      }
      // A separately consented public enquiry authorises its own replies. The
      // retired household account's optional progress-email flag is unrelated.
      stage='payload';
      let payload;
      if(row.encrypted_payload){payload=await decryptProtectedPayload(row.encrypted_payload);}
      else{
        const link=await customerHubEmailUrl(db,row.opportunity_id,recipient.recipient_email);
        const action=row.event_type==='asked'?'asked you a question':'replied to a shared question';
        const title=row.title.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,180);
        const message=`A trade business has ${action} about your job: ${title}. Reply once to share your answer with the businesses quoting on your job.`;
        payload={eventId:row.event_id,recipient:recipient.recipient_email,link,
          subject:`TLink: a business ${action} about ${title}`,
          body:message+customerHubEmailCta(`${link}?section=qa&question=${encodeURIComponent(row.question_id)}`).text,
          html:customerHubUpdateEmailHtml(message,`${link}?section=qa&question=${encodeURIComponent(row.question_id)}`)};
        const encrypted=await encryptProtectedPayload(payload);
        const saved=await db.prepare("UPDATE customer_hub_email_deliveries SET encrypted_payload=? WHERE event_id=? AND status='sending' AND encrypted_payload='' AND attempts=?")
          .bind(encrypted,row.event_id,row.attempts+1).run();
        if(!saved.meta.changes)continue;
      }
      if(payload.eventId!==row.event_id||payload.recipient!==recipient.recipient_email||typeof payload.link!=='string'||typeof payload.subject!=='string'||typeof payload.body!=='string')throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      const link=new URL(payload.link);
      if(link.origin!=='https://ausenergyassessments.com'||!link.pathname.startsWith('/customer-hub/'))throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      const token=decodeURIComponent(link.pathname.split('/').at(-1)!);
      stage='authority';
      const authority=await authoriseCustomerHub(db,token);
      const latest=await currentRecipient(authority.token_hash);
      if(authority.release_id!==row.release_id||authority.email_hash!==row.email_hash||latest?.recipient_email!==recipient.recipient_email){
        await db.prepare("UPDATE customer_hub_email_deliveries SET status='stopped',updated_at=? WHERE event_id=? AND status='sending' AND attempts=?").bind(now,row.event_id,row.attempts+1).run();
        deliveryDiagnostic(row.event_id,stage,'DELIVERY_NO_LONGER_ELIGIBLE');continue;
      }
      stage='provider';
      const result=await sendServiceReminderProviderMessage({channel:'email',recipient:recipient.recipient_email,subject:payload.subject,body:payload.body,
        html:typeof payload.html==='string'?payload.html:undefined,
        idempotencyKey:`customer-hub-${row.event_id}`,callbackUrl:'',messageType:'customer_hub_qa'});
      stage='recording';
      await db.prepare("UPDATE customer_hub_email_deliveries SET status='accepted',provider_id=?,updated_at=? WHERE event_id=? AND status='sending' AND attempts=?")
        .bind(result.providerMessageId,new Date().toISOString(),row.event_id,row.attempts+1).run();
    }catch{
      deliveryDiagnostic(row.event_id,stage,'DELIVERY_ATTEMPT_FAILED');
      await db.prepare("UPDATE customer_hub_email_deliveries SET status='failed',next_attempt_at=?,updated_at=? WHERE event_id=? AND status='sending' AND attempts=?")
        .bind(serviceReminderRetryAt(row.attempts+1),new Date().toISOString(),row.event_id,row.attempts+1).run();
    }
  }
}
