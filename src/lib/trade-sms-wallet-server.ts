import { getD1 } from "../../db";
import type { SmsActor } from "./trade-sms-server";
import { smsEnvironment, smsPublicOrigin } from "./trade-sms-environment";
import { smsRequestId, smsTopUpAmount } from "./trade-sms-billing";
import { createSmsCheckout, retrieveSmsCheckout, retrieveSmsPaymentIntent, stripeObject, verifySmsStripeEvent } from "./trade-sms-stripe";

type TopUp = {id:string;owner_uid:string;request_id:string;amount_cents:number;status:string;session_id:string;checkout_url:string;payment_intent_id:string;refunded_cents:number;created_at:string};
export async function smsWallet(ownerUid:string,db:D1Database=getD1()) {
  const balance=await db.prepare("SELECT COALESCE(SUM(amount_micro),0) balance FROM trade_sms_ledger WHERE owner_uid=?").bind(ownerUid).first<{balance:number}>();
  const reserved=await db.prepare("SELECT COALESCE(SUM(price_micro),0) total FROM trade_sms_messages WHERE firebase_uid=? AND direction='outbound' AND status='unknown'").bind(ownerUid).first<{total:number}>();
  return {balanceMicro:Number(balance?.balance||0),reservedMicro:Number(reserved?.total||0)};
}
export async function startSmsTopUp(actor:SmsActor,input:Record<string,unknown>,db:D1Database=getD1(),fetchImpl:typeof fetch=fetch) {
  if(!actor.isOwner) throw new Error("SMS_OWNER_REQUIRED");
  const environment=smsEnvironment();
  if(!environment.stripeKey || !environment.stripeWebhookSecret) throw new Error("SMS_BILLING_SETUP_REQUIRED");
  const origin=smsPublicOrigin(), amount=smsTopUpAmount(input.amountCents), requestId=smsRequestId(input.requestId), now=new Date().toISOString();
  const id=crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO trade_sms_topups(id,owner_uid,request_id,amount_cents,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,actor.ownerUid,requestId,amount,now,now).run();
  const row=await db.prepare("SELECT * FROM trade_sms_topups WHERE owner_uid=? AND request_id=?").bind(actor.ownerUid,requestId).first<TopUp>();
  if(!row || row.amount_cents!==amount) throw new Error("SMS_REQUEST_CONFLICT");
  if(row.status==="paid") throw new Error("SMS_TOPUP_ALREADY_PAID");
  if(row.checkout_url && row.status==="open") return {checkoutUrl:row.checkout_url};
  // Stripe retains an idempotency key for at least 24 hours. Never recreate an ambiguous old payment.
  if(Date.now()-Date.parse(row.created_at)>23*60*60*1000) throw new Error("SMS_PAYMENT_RECONCILIATION_REQUIRED");
  const session=await createSmsCheckout(environment.stripeKey,{id:row.id,ownerUid:actor.ownerUid,amountCents:amount,origin},fetchImpl);
  await db.prepare("UPDATE trade_sms_topups SET session_id=?,checkout_url=?,status=CASE WHEN status='paid' THEN status ELSE 'open' END,updated_at=? WHERE id=? AND owner_uid=? AND (session_id='' OR session_id=?)")
    .bind(session.sessionId,session.checkoutUrl,now,row.id,actor.ownerUid,session.sessionId).run();
  return {checkoutUrl:session.checkoutUrl};
}

export async function applySmsPaidCheckout(session:Record<string,unknown>,live:boolean,db:D1Database) {
  const meta=stripeObject(session.metadata);
  if(session.livemode!==live || session.mode!=="payment" || session.currency!=="aud" || session.payment_status!=="paid" || session.status!=="complete"
    || typeof session.id!=="string" || typeof session.payment_intent!=="string" || !/^pi_[A-Za-z0-9]+$/.test(session.payment_intent)
    || typeof meta.tlink_sms_topup_id!=="string" || session.client_reference_id!==meta.tlink_sms_topup_id) throw new Error("SMS_WEBHOOK_INVALID");
  const row=await db.prepare("SELECT * FROM trade_sms_topups WHERE id=?").bind(meta.tlink_sms_topup_id).first<TopUp>();
  if(!row || meta.tlink_owner_uid!==row.owner_uid || session.amount_total!==row.amount_cents || (row.session_id && row.session_id!==session.id)
    || (row.payment_intent_id && row.payment_intent_id!==session.payment_intent)) throw new Error("SMS_WEBHOOK_INVALID");
  const now=new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE trade_sms_topups SET status='paid',session_id=?,payment_intent_id=?,updated_at=? WHERE id=? AND (session_id='' OR session_id=?) AND (payment_intent_id='' OR payment_intent_id=?)")
      .bind(session.id,session.payment_intent,now,row.id,session.id,session.payment_intent),
    db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
      SELECT ?,owner_uid,'top_up',amount_cents*10000,'SMS credit added',? FROM trade_sms_topups WHERE id=? AND status='paid' AND session_id=? AND payment_intent_id=?`)
      .bind(`stripe:${session.id}`,now,row.id,session.id,session.payment_intent),
  ]);
}
export async function syncSmsPayments(ownerUid:string,db:D1Database=getD1(),fetchImpl:typeof fetch=fetch) {
  const {stripeKey}=smsEnvironment();
  if(!stripeKey) return;
  const rows=(await db.prepare("SELECT * FROM trade_sms_topups WHERE owner_uid=? AND status='open' AND session_id<>'' ORDER BY created_at DESC LIMIT 3").bind(ownerUid).all<TopUp>()).results;
  for(const row of rows) {
    const session=await retrieveSmsCheckout(stripeKey,row.session_id,fetchImpl);
    if(session.payment_status==="paid") await applySmsPaidCheckout(session,/^(sk|rk)_live_/.test(stripeKey),db);
    else if(session.status==="expired") await db.prepare("UPDATE trade_sms_topups SET status='expired',updated_at=? WHERE id=? AND status='open'").bind(new Date().toISOString(),row.id).run();
  }
}
export async function receiveSmsStripeWebhook(request:Request,db:D1Database=getD1(),fetchImpl:typeof fetch=fetch) {
  const environment=smsEnvironment();
  if(!environment.stripeKey || !environment.stripeWebhookSecret) throw new Error("SMS_BILLING_SETUP_REQUIRED");
  if(Number(request.headers.get("content-length")||0)>150000) throw new Error("SMS_WEBHOOK_INVALID");
  const event=await verifySmsStripeEvent(await request.text(),request.headers.get("stripe-signature")||"",environment.stripeWebhookSecret);
  if(event.livemode!==/^(sk|rk)_live_/.test(environment.stripeKey)) throw new Error("SMS_WEBHOOK_INVALID");
  const object=stripeObject(stripeObject(event.data).object);
  if(event.type==="checkout.session.completed" || event.type==="checkout.session.async_payment_succeeded") {
    if(typeof stripeObject(object.metadata).tlink_sms_topup_id!=="string") return;
    if(object.payment_status==="paid") await applySmsPaidCheckout(object,/^(sk|rk)_live_/.test(environment.stripeKey),db);
  } else if(event.type==="charge.refunded") {
    if(object.livemode!==event.livemode) throw new Error("SMS_WEBHOOK_INVALID");
    const meta=stripeObject(object.metadata);
    if(typeof meta.tlink_sms_topup_id!=="string") return;
    const row=await db.prepare("SELECT * FROM trade_sms_topups WHERE id=?").bind(meta.tlink_sms_topup_id).first<TopUp>();
    if(!row || meta.tlink_owner_uid!==row.owner_uid || object.currency!=="aud" || object.amount!==row.amount_cents || typeof object.payment_intent!=="string"
      || (row.payment_intent_id && row.payment_intent_id!==object.payment_intent) || !Number.isSafeInteger(object.amount_refunded)
      || Number(object.amount_refunded)<0 || Number(object.amount_refunded)>row.amount_cents) throw new Error("SMS_WEBHOOK_INVALID");
    const refunded=Number(object.amount_refunded), now=new Date().toISOString();
    // Record cumulative difference in the same transaction. Late or repeated events cannot debit twice.
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO trade_sms_ledger(id,owner_uid,kind,amount_micro,description,created_at)
        SELECT ?,owner_uid,'refund',-(?-refunded_cents)*10000,'SMS credit refunded',? FROM trade_sms_topups WHERE id=? AND refunded_cents<?`)
        .bind(`stripe-refund:${row.id}:${refunded}`,refunded,now,row.id,refunded),
      db.prepare("UPDATE trade_sms_topups SET refunded_cents=MAX(refunded_cents,?),payment_intent_id=?,updated_at=? WHERE id=?").bind(refunded,object.payment_intent,now,row.id),
    ]);
  } else if(event.type==="charge.dispute.created") {
    if(typeof object.payment_intent!=="string" || typeof object.id!=="string") throw new Error("SMS_WEBHOOK_INVALID");
    let row=await db.prepare("SELECT * FROM trade_sms_topups WHERE payment_intent_id=?").bind(object.payment_intent).first<TopUp>();
    if(!row) {
      const intent=await retrieveSmsPaymentIntent(environment.stripeKey,object.payment_intent,fetchImpl);
      const meta=stripeObject(intent.metadata);
      if(typeof meta.tlink_sms_topup_id!=="string") return;
      row=await db.prepare("SELECT * FROM trade_sms_topups WHERE id=?").bind(meta.tlink_sms_topup_id).first<TopUp>();
      if(!row || meta.tlink_owner_uid!==row.owner_uid || intent.id!==object.payment_intent || intent.currency!=="aud" || intent.livemode!==event.livemode
        || intent.amount!==row.amount_cents || (row.payment_intent_id && row.payment_intent_id!==intent.id)) throw new Error("SMS_WEBHOOK_INVALID");
    }
    // A disputed payment freezes managed sends pending a reviewed resolution; no automatic re-credit.
    const now=new Date().toISOString();
    await db.prepare(`INSERT INTO trade_sms_accounts(owner_uid,status,created_at,updated_at) VALUES(?,'payment_review',?,?)
      ON CONFLICT(owner_uid) DO UPDATE SET status='payment_review',updated_at=excluded.updated_at`).bind(row.owner_uid,now,now).run();
  }
}
