import {encryptProtectedPayload,decryptProtectedPayload} from "./trade-integration-crypto";
import { hubParticipantJoins } from './customer-quote-hub-server';
import { authoriseCustomerHub, customerHubEmailUrl } from './customer-hub-links';
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration, serviceReminderRetryAt } from './service-reminder-delivery';

/** Queued with the shared question/reply so email failure cannot lose the conversation. */
export function hubEmailStatement(db:D1Database,eventId:string,opportunityId:string,now:string){
  return db.prepare(`INSERT INTO customer_hub_email_deliveries(event_id,release_id,email_hash,updated_at)
    SELECT ?,hub.release_id,hub.email_hash,? FROM customer_quote_hubs hub WHERE hub.opportunity_id=? AND hub.revoked_at=''`)
    .bind(eventId,now,opportunityId);
}
export async function drainCustomerHubEmails(db:D1Database,eventId=''){
  if(!serviceReminderProviderConfiguration().email.configured)return;
  const now=new Date().toISOString();
  // Retry only inside the provider's 24-hour idempotency window. Never blindly resend old ambiguous attempts.
  await db.prepare(`UPDATE customer_hub_email_deliveries SET status='unknown',updated_at=? WHERE status IN ('sending','failed')
    AND first_attempt_at<>'' AND first_attempt_at<=?`).bind(now,new Date(Date.now()-23*3600000).toISOString()).run();
  const rows=await db.prepare(`SELECT delivery.*,event.opportunity_id,event.event_type,event.author_match_id,opportunity.title
    FROM customer_hub_email_deliveries delivery JOIN customer_hub_events event ON event.id=delivery.event_id
    JOIN trade_opportunities opportunity ON opportunity.id=event.opportunity_id
    WHERE (?='' OR delivery.event_id=?) AND delivery.attempts<4 AND delivery.next_attempt_at<=?
      AND (delivery.status IN ('pending','failed') OR (delivery.status='sending' AND delivery.updated_at<?))
    ORDER BY delivery.updated_at LIMIT 20`).bind(eventId,eventId,now,new Date(Date.now()-10*60000).toISOString())
    .all<{event_id:string;release_id:string;email_hash:string;opportunity_id:string;author_match_id:string;event_type:string;title:string;attempts:number;encrypted_payload:string}>();
  for(const row of rows.results){
    const claim=await db.prepare(`UPDATE customer_hub_email_deliveries SET status='sending',attempts=attempts+1,
      first_attempt_at=CASE WHEN first_attempt_at='' THEN ? ELSE first_attempt_at END,updated_at=?
      WHERE event_id=? AND attempts=? AND (status IN ('pending','failed') OR (status='sending' AND updated_at<?))`)
      .bind(now,now,row.event_id,row.attempts,new Date(Date.now()-10*60000).toISOString()).run();
    if(!claim.meta.changes)continue;
    try{
      const currentRecipient=(tokenHash='')=>db.prepare(`SELECT hub.recipient_email ${hubParticipantJoins} AND match.id=? AND opportunity.id=?
        AND hub.release_id=? AND hub.email_hash=? AND hub.accepting=1 AND (?='' OR hub.token_hash=?)
        AND EXISTS(SELECT 1 FROM customer_hub_email_deliveries claim WHERE claim.event_id=? AND claim.status='sending' AND claim.attempts=?)
        AND NOT EXISTS(SELECT 1 FROM public_plan_customer_email_suppressions WHERE email_hash=hub.email_hash)
        AND NOT EXISTS(SELECT 1 FROM customer_accounts account WHERE lower(trim(account.email))=hub.recipient_email
          AND (account.account_status<>'active' OR account.account_updates=0 OR EXISTS(SELECT 1 FROM customer_service_reminder_opt_outs optout WHERE optout.customer_uid=account.firebase_uid AND optout.channel='email')))`)
        .bind(row.author_match_id,row.opportunity_id,row.release_id,row.email_hash,tokenHash,tokenHash,row.event_id,row.attempts+1).first<{recipient_email:string}>();
      const recipient=await currentRecipient();
      if(!recipient){await db.prepare("UPDATE customer_hub_email_deliveries SET status='stopped',updated_at=? WHERE event_id=? AND status='sending' AND attempts=?").bind(now,row.event_id,row.attempts+1).run();continue;}
      let payload;
      if(row.encrypted_payload){payload=await decryptProtectedPayload(row.encrypted_payload);}
      else{
        const link=await customerHubEmailUrl(db,row.opportunity_id,recipient.recipient_email);
        const action=row.event_type==='asked'?'asked you a question':'replied to a shared question';
        const title=row.title.replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,180);
        payload={eventId:row.event_id,recipient:recipient.recipient_email,link,
          subject:`TLink: a business ${action} about ${title}`,
          body:`A trade business has ${action} about your job: ${title}.\n\nOpen Customer Q&A to view it and reply once for the businesses quoting on your job.\n\n${link}?section=qa\n\nKeep this private link to yourself. You can pause quotes and questions in your hub.`};
        const encrypted=await encryptProtectedPayload(payload);
        const saved=await db.prepare("UPDATE customer_hub_email_deliveries SET encrypted_payload=? WHERE event_id=? AND status='sending' AND encrypted_payload='' AND attempts=?")
          .bind(encrypted,row.event_id,row.attempts+1).run();
        if(!saved.meta.changes)continue;
      }
      if(payload.eventId!==row.event_id||payload.recipient!==recipient.recipient_email||typeof payload.link!=='string'||typeof payload.subject!=='string'||typeof payload.body!=='string')throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      const link=new URL(payload.link);
      if(link.origin!=='https://ausenergyassessments.com'||!link.pathname.startsWith('/customer-hub/'))throw new Error('CUSTOMER_HUB_ACCESS_ENDED');
      const token=decodeURIComponent(link.pathname.split('/').at(-1)!);
      const authority=await authoriseCustomerHub(db,token);
      const latest=await currentRecipient(authority.token_hash);
      if(authority.release_id!==row.release_id||authority.email_hash!==row.email_hash||latest?.recipient_email!==recipient.recipient_email){
        await db.prepare("UPDATE customer_hub_email_deliveries SET status='stopped',updated_at=? WHERE event_id=? AND status='sending' AND attempts=?").bind(now,row.event_id,row.attempts+1).run();continue;
      }
      const result=await sendServiceReminderProviderMessage({channel:'email',recipient:recipient.recipient_email,subject:payload.subject,body:payload.body,
        idempotencyKey:`customer-hub-${row.event_id}`,callbackUrl:'',messageType:'customer_hub_qa'});
      await db.prepare("UPDATE customer_hub_email_deliveries SET status='accepted',provider_id=?,updated_at=? WHERE event_id=? AND status='sending' AND attempts=?")
        .bind(result.providerMessageId,new Date().toISOString(),row.event_id,row.attempts+1).run();
    }catch{
      await db.prepare("UPDATE customer_hub_email_deliveries SET status='failed',next_attempt_at=?,updated_at=? WHERE event_id=? AND status='sending' AND attempts=?")
        .bind(serviceReminderRetryAt(row.attempts+1),new Date().toISOString(),row.event_id,row.attempts+1).run();
    }
  }
}
